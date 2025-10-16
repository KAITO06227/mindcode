const pty = require('node-pty');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const jwt = require('jsonwebtoken');
const db = require('../database/connection');
const GitManager = require('../utils/gitManager');
const { ensureUserRoot, resolveExistingProjectPath } = require('../utils/userWorkspace');
const { randomUUID } = require('crypto');

// Store active terminal sessions
const terminals = {};
const inputBuffers = {};
const sessionState = {};
const pendingPromptsByProject = {};
const commitPromptStore = {};
const claudeLogMonitors = {};
const codexLogMonitors = {};
const geminiLogMonitors = {};

const LOG_POLL_INTERVAL_MS = 250;
const CLAUDE_LOG_POLL_INTERVAL_MS = LOG_POLL_INTERVAL_MS;
const CODEX_LOG_POLL_INTERVAL_MS = LOG_POLL_INTERVAL_MS;
const GEMINI_LOG_POLL_INTERVAL_MS = LOG_POLL_INTERVAL_MS;

// Gemini hash folder mapping helpers
async function saveGeminiHashFolder(projectId, hashFolder, database) {
  try {
    await database.execute(
      `INSERT INTO gemini_project_folders (project_id, hash_folder)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE hash_folder = ?, updated_at = CURRENT_TIMESTAMP`,
      [projectId, hashFolder, hashFolder]
    );
    console.log(`[Gemini] Saved hash folder mapping: ${projectId} -> ${hashFolder}`);
  } catch (error) {
    console.error('[Gemini] Failed to save hash folder mapping:', error);
    throw error;
  }
}

async function getGeminiHashFolder(projectId, database) {
  try {
    const [rows] = await database.execute(
      'SELECT hash_folder FROM gemini_project_folders WHERE project_id = ?',
      [projectId]
    );
    if (rows.length > 0) {
      console.log(`[Gemini] Retrieved hash folder mapping: ${projectId} -> ${rows[0].hash_folder}`);
      return rows[0].hash_folder;
    }
    return null;
  } catch (error) {
    console.error('[Gemini] Failed to get hash folder mapping:', error);
    return null;
  }
}
const DEFAULT_CLAUDE_TEXT_DEBOUNCE_MS = (() => {
  const parsed = Number.parseInt(process.env.CLAUDE_TEXT_DEBOUNCE_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 800;
})();
const DEFAULT_CODEX_TEXT_DEBOUNCE_MS = (() => {
  const parsed = Number.parseInt(process.env.CODEX_TEXT_DEBOUNCE_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 800;
})();
const DEFAULT_GEMINI_TURN_IDLE_MS = (() => {
  const fromMs = Number.parseInt(process.env.GEMINI_TURN_IDLE_MS ?? '', 10);
  if (Number.isFinite(fromMs) && fromMs >= 0) {
    return fromMs;
  }
  const fromS = Number.parseFloat(process.env.GEMINI_TURN_IDLE_S ?? '');
  if (Number.isFinite(fromS) && fromS >= 0) {
    return Math.round(fromS * 1000);
  }
  return 800;
})();
const DEFAULT_GEMINI_SESSION_IDLE_MS = (() => {
  const fromMs = Number.parseInt(process.env.GEMINI_SESSION_IDLE_MS ?? '', 10);
  if (Number.isFinite(fromMs) && fromMs >= 0) {
    return fromMs;
  }
  const fromS = Number.parseFloat(process.env.GEMINI_SESSION_IDLE_S ?? '');
  if (Number.isFinite(fromS) && fromS >= 0) {
    return Math.round(fromS * 1000);
  }
  return 5000;
})();

function parseDurationPreference({ ms, s, defaultValue }) {
  const msValue = ms !== undefined ? Number.parseFloat(ms) : undefined;
  if (Number.isFinite(msValue) && msValue >= 0) {
    return msValue;
  }
  const sValue = s !== undefined ? Number.parseFloat(s) : undefined;
  if (Number.isFinite(sValue) && sValue >= 0) {
    return sValue * 1000;
  }
  return defaultValue;
}

function slugifyForClaudeProjects(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return null;
  }
  const normalized = inputPath
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-');
  return normalized.startsWith('-') ? normalized : `-${normalized}`;
}

function generateClaudeProjectSlugCandidates(homeDir, workspaceDir) {
  const candidates = [];
  const normalizedWorkspace = (workspaceDir || '').replace(/\\/g, '/');
  const directSlug = slugifyForClaudeProjects(normalizedWorkspace);
  if (directSlug) {
    candidates.push(directSlug);
  }

  if (homeDir && workspaceDir) {
    const normalizedHome = homeDir.replace(/\\/g, '/');
    const emailSegment = path.basename(normalizedHome);
    const relative = path.relative(normalizedHome, workspaceDir);
    if (relative && !relative.startsWith('..')) {
      const posixRelative = relative.split(path.sep).join('/');
      const containerPath = `/app/user_projects/${emailSegment}/${posixRelative}`;
      const containerSlug = slugifyForClaudeProjects(containerPath);
      if (containerSlug && !candidates.includes(containerSlug)) {
        candidates.push(containerSlug);
      }
    }
  }

  return candidates;
}

function parseTimestamp(value) {
  if (!value) {
    return Date.now();
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function getRootUserUuid(entry, entryIndex) {
  if (!entry) {
    return null;
  }
  if (entry.type === 'user' && entry.message?.role === 'user') {
    return entry.uuid || null;
  }

  let currentUuid = entry.parentUuid;
  let guard = 0;

  while (currentUuid && guard < 50) {
    const parent = entryIndex.get(currentUuid);
    if (!parent) {
      return null;
    }
    if (parent.type === 'user' && parent.message?.role === 'user') {
      return parent.uuid || null;
    }
    currentUuid = parent.parentUuid;
    guard += 1;
  }

  return null;
}

function entryHasToolUse(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((part) => part?.type === 'tool_use');
}

function entryContainsToolResult(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((part) => part?.type === 'tool_result');
}

function pushTextCandidate(target, value) {
  if (!value) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => pushTextCandidate(target, item));
    return;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      target.push(trimmed);
    }
  }
}

function extractAssistantText(entry) {
  const texts = [];
  const message = entry?.message || {};
  const content = message.content;

  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part) {
        continue;
      }
      if (part.type === 'text') {
        pushTextCandidate(texts, part.text);
      } else if (part.type === 'output_text') {
        pushTextCandidate(texts, part.text ?? part.value);
      } else if (typeof part.value === 'string') {
        pushTextCandidate(texts, part.value);
      } else if (typeof part.text === 'string') {
        pushTextCandidate(texts, part.text);
      }
    }
  }

  pushTextCandidate(texts, message.text);
  pushTextCandidate(texts, entry?.output_text);
  pushTextCandidate(texts, entry?.content);
  pushTextCandidate(texts, message?.result);

  if (texts.length === 0) {
    return null;
  }

  return texts.join('\n').trim();
}

function getStopReason(entry) {
  const candidates = [
    entry?.stop_reason,
    entry?.stopReason,
    entry?.stop_sequence,
    entry?.stopSequence,
    entry?.message?.stop_reason,
    entry?.message?.stopReason,
    entry?.message?.stop_sequence,
    entry?.message?.stopSequence
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.length > 0) {
      return value.toLowerCase();
    }
  }

  return null;
}

async function setupClaudeLogMonitor({
  homeDir,
  workspaceDir,
  sessionKey,
  finalizeSession,
  socket,
  debounceMs
}) {
  console.log(`[Claude Monitor Setup] homeDir: ${homeDir}`);
  console.log(`[Claude Monitor Setup] workspaceDir: ${workspaceDir}`);

  // Monitor Claude CLI history.jsonl for prompt detection
  const historyFilePath = path.join(homeDir, '.config', 'claude', 'history.jsonl');
  console.log(`[Claude Monitor Setup] Will monitor history file: ${historyFilePath}`);

  // Prepare timeline log directory for response monitoring
  const slugCandidates = generateClaudeProjectSlugCandidates(homeDir, workspaceDir);
  console.log(`[Claude Monitor Setup] slugCandidates:`, slugCandidates);

  if (!slugCandidates || slugCandidates.length === 0) {
    console.error('[Claude Monitor Setup] No slug candidates generated');
    return null;
  }

  const claudeProjectsRoot = path.join(
    homeDir,
    '.config',
    'claude',
    'projects'
  );
  console.log(`[Claude Monitor Setup] claudeProjectsRoot: ${claudeProjectsRoot}`);

  try {
    await fs.mkdir(claudeProjectsRoot, { recursive: true });
  } catch (mkdirError) {
    console.error('[Claude Monitor Setup] Failed to ensure Claude log directory:', mkdirError);
    return null;
  }

  let projectSlug = slugCandidates[0];
  let projectLogDir = path.join(claudeProjectsRoot, projectSlug);

  for (const candidateSlug of slugCandidates) {
    const candidateDir = path.join(claudeProjectsRoot, candidateSlug);
    try {
      await fs.access(candidateDir);
      console.log(`[Claude Monitor Setup] Found existing directory: ${candidateDir}`);
      projectSlug = candidateSlug;
      projectLogDir = candidateDir;
      break;
    } catch {
      // ignore missing directory; will create below if needed
    }
  }

  console.log(`[Claude Monitor Setup] Final projectSlug: ${projectSlug}`);
  console.log(`[Claude Monitor Setup] Final projectLogDir: ${projectLogDir}`);

  try {
    await fs.mkdir(projectLogDir, { recursive: true });
  } catch (mkdirError) {
    console.error('[Claude Monitor Setup] Failed to ensure Claude project log directory:', mkdirError);
    return null;
  }

  // Initialize history file offset to current file size to skip old prompts
  let initialHistoryOffset = 0;
  try {
    const historyStats = await fs.stat(historyFilePath);
    initialHistoryOffset = historyStats.size;
    console.log(`[Claude Monitor Setup] Setting initial history offset to ${initialHistoryOffset} (current file size)`);
  } catch (statError) {
    // File doesn't exist yet, start from 0
    console.log(`[Claude Monitor Setup] history.jsonl doesn't exist yet, starting from offset 0`);
  }

  const monitor = {
    sessionKey,
    socket,
    homeDir,
    workspaceDir,
    historyFilePath,
    historyFileOffset: initialHistoryOffset,
    historyBuffer: '',
    projectLogDir,
    currentFilePath: null,
    fileHandle: null,
    fileOffset: 0,
    buffer: '',
    disposed: false,
    pollTimer: null,
    entryIndex: new Map(),
    promptLogs: new Map(),
    debounceMs: Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : DEFAULT_CLAUDE_TEXT_DEBOUNCE_MS,
    lastPromptText: null, // Track last prompt to avoid duplicates
    lastPromptTimestamp: null, // Track when the last prompt was detected
    sessionStartTime: Date.now() // Session start time
  };

  async function closeFileHandle() {
    if (monitor.fileHandle) {
      try {
        await monitor.fileHandle.close();
      } catch {
        // swallow
      } finally {
        monitor.fileHandle = null;
      }
    }
  }

  async function selectLatestSessionFile() {
    console.log(`[Claude Monitor] Scanning for log files created after session start`);
    console.log(`[Claude Monitor] Session start time: ${monitor.sessionStartTime} (${new Date(monitor.sessionStartTime).toISOString()})`);
    console.log(`[Claude Monitor] Last prompt time: ${monitor.lastPromptTimestamp || 'none'}`);

    let dirEntries;
    try {
      dirEntries = await fs.readdir(projectLogDir);
      console.log(`[Claude Monitor] Found ${dirEntries.length} entries in directory`);
    } catch (readError) {
      console.error('[Claude Monitor] Failed to read Claude project directory:', readError);
      return null;
    }

    if (!dirEntries || dirEntries.length === 0) {
      console.log('[Claude Monitor] Directory is empty, no log files found');
      return null;
    }

    const jsonlFiles = dirEntries.filter(name => name.endsWith('.jsonl'));
    console.log(`[Claude Monitor] Found ${jsonlFiles.length} .jsonl files:`, jsonlFiles);

    let latestPath = null;
    let latestMtime = 0;
    // Allow 2 seconds tolerance for file creation timing
    const minTimestamp = (monitor.lastPromptTimestamp || monitor.sessionStartTime) - 2000;

    for (const entryName of dirEntries) {
      if (!entryName.endsWith('.jsonl')) {
        continue;
      }
      const fullPath = path.join(projectLogDir, entryName);
      let stats;
      try {
        stats = await fs.stat(fullPath);
        console.log(`[Claude Monitor] File: ${entryName}, mtime: ${stats.mtimeMs}, created after threshold (with 2s tolerance): ${stats.mtimeMs >= minTimestamp}`);
      } catch (statError) {
        console.error(`[Claude Monitor] Failed to stat file ${entryName}:`, statError);
        continue;
      }
      // Only consider files created around the last prompt (with 2s tolerance) or after session start
      if (stats.mtimeMs >= minTimestamp && stats.mtimeMs > latestMtime) {
        latestMtime = stats.mtimeMs;
        latestPath = fullPath;
      }
    }

    if (latestPath) {
      console.log(`[Claude Monitor] Selected latest file: ${latestPath}`);
    } else {
      console.log('[Claude Monitor] No valid .jsonl file found created after prompt detection');
    }

    return latestPath;
  }

  function linkPromptState(promptLog) {
    const session = sessionState[sessionKey];
    if (!session || promptLog.statePrompt) {
      return;
    }
    if (!Array.isArray(session.prompts) || session.prompts.length === 0) {
      return;
    }
    const candidate = session.prompts.find((entry) => !entry.claudeLinked);
    if (!candidate) {
      return;
    }
    candidate.claudeLinked = true;
    candidate.claudeUserUuid = promptLog.userEntry?.uuid ?? null;
    const startedAt = parseTimestamp(promptLog.userEntry?.timestamp);
    candidate.startedAt = startedAt;
    promptLog.statePrompt = candidate;
  }

  function getOrCreatePromptLog(userUuid, userEntry) {
    if (!userUuid) {
      return null;
    }
    if (monitor.promptLogs.has(userUuid)) {
      return monitor.promptLogs.get(userUuid);
    }
    const promptLog = {
      userEntry,
      rootUuid: userUuid,
      entries: [],
      startedAt: parseTimestamp(userEntry?.timestamp),
      totalInputTokens: 0,
      totalOutputTokens: 0,
      lastAssistantTimestamp: null,
      lastAssistantEntry: null,
      lastEntryRole: null,
      lastEventTimestamp: parseTimestamp(userEntry?.timestamp),
      debounceTimer: null,
      debounceDueAt: null,
      completed: false,
      statePrompt: null,
      status: 'waiting',
      sawTool: false,
      latestTextEntry: null,
      latestTextValue: null
    };
    monitor.promptLogs.set(userUuid, promptLog);
    linkPromptState(promptLog);
    return promptLog;
  }

  function clearPromptDebounce(promptLog) {
    if (!promptLog) {
      return;
    }
    if (promptLog.debounceTimer) {
      clearTimeout(promptLog.debounceTimer);
      promptLog.debounceTimer = null;
    }
    promptLog.debounceDueAt = null;
  }

  function startPromptDebounce(promptLog, delayOverride) {
    if (!promptLog || promptLog.completed) {
      return;
    }

    const delay = Number.isFinite(delayOverride) && delayOverride >= 0
      ? delayOverride
      : monitor.debounceMs;

    if (delay === 0) {
      clearPromptDebounce(promptLog);
      finalizePromptLog(promptLog);
      return;
    }

    clearPromptDebounce(promptLog);
    promptLog.debounceDueAt = Date.now() + delay;
    promptLog.debounceTimer = setTimeout(() => {
      if (promptLog.completed || monitor.disposed) {
        return;
      }
      if (promptLog.status === 'text_ready') {
        finalizePromptLog(promptLog);
      }
    }, delay);
  }

  function finalizePromptLog(promptLog) {
    if (!promptLog || promptLog.completed) {
      return;
    }
    // Allow completion by next prompt, disconnect, or normal text_ready
    const isCompletedByEvent = promptLog.status === 'completed_by_next_prompt' ||
                                promptLog.status === 'completed_by_disconnect' ||
                                promptLog.status === 'completed_by_provider_change';
    if (!isCompletedByEvent && promptLog.status !== 'text_ready' && !promptLog.latestTextEntry) {
      return;
    }
    const originalStatus = promptLog.status;
    promptLog.completed = true;
    promptLog.status = 'completed';
    clearPromptDebounce(promptLog);

    console.log(`[Claude Monitor] Finalizing prompt with reason: ${originalStatus}`);

    const finishTimestamp = promptLog.lastAssistantTimestamp ?? promptLog.lastEventTimestamp ?? Date.now();
    const durationMs = Math.max(0, finishTimestamp - promptLog.startedAt);

    console.log(`[Claude Monitor] Duration calculation:`);
    console.log(`  Start timestamp: ${promptLog.startedAt} (${new Date(promptLog.startedAt).toISOString()})`);
    console.log(`  Finish timestamp: ${finishTimestamp} (${new Date(finishTimestamp).toISOString()})`);
    console.log(`  Duration: ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`);

    const session = sessionState[sessionKey];
    if (session) {
      session.actualDurationMs = durationMs;
      session.totalApprovalWaitMs = 0;
      session.approvalWaitStartTime = null;
      session.awaitingApproval = false;
      session.responsePending = false;

      // Track the timestamp range of completed prompts for history.jsonl filtering
      if (!session.completedPromptStartTime) {
        session.completedPromptStartTime = promptLog.startedAt;
      }
      session.completedPromptEndTime = finishTimestamp;

      if (promptLog.statePrompt) {
        promptLog.statePrompt.durationMs = durationMs;
        promptLog.statePrompt.completedAt = finishTimestamp;
        promptLog.statePrompt.tokenUsage = {
          inputTokens: promptLog.totalInputTokens,
          outputTokens: promptLog.totalOutputTokens,
          totalTokens: (promptLog.totalInputTokens || 0) + (promptLog.totalOutputTokens || 0)
        };
        if (promptLog.latestTextValue) {
          promptLog.statePrompt.outputText = promptLog.latestTextValue;
        }
      }

      session.lastPromptTokenUsage = {
        inputTokens: promptLog.totalInputTokens,
        outputTokens: promptLog.totalOutputTokens
      };
      session.lastPromptFinishedAt = finishTimestamp;
      if (promptLog.latestTextValue) {
        session.lastPromptOutputText = promptLog.latestTextValue;
      }
    }

    monitor.promptLogs.delete(promptLog.rootUuid);
    for (const timelineEntry of promptLog.entries) {
      if (timelineEntry?.uuid) {
        monitor.entryIndex.delete(timelineEntry.uuid);
      }
    }

    console.log(`[Claude Monitor] Response complete detected for prompt: ${promptLog.rootUuid}`);
    console.log(`[Claude Monitor] Calling finalizeSession for sessionKey: ${sessionKey}`);

    finalizeSession({ reason: 'response-complete' }).catch((error) => {
      console.error('[Claude Monitor] finalize session failed:', error);
      try {
        socket.emit(
          'output',
          '\r\n⚠️ Claudeセッションの終了処理に失敗しました。ログを確認してください。\r\n'
        );
      } catch {
        // ignore
      }
    });
  }

  function handleUsageAccumulation(promptLog, entry) {
    if (!promptLog || !entry?.usage) {
      return;
    }
    const inputTokens = entry.usage.input_tokens || entry.usage.inputTokens || 0;
    const outputTokens = entry.usage.output_tokens || entry.usage.outputTokens || 0;
    promptLog.totalInputTokens += inputTokens;
    promptLog.totalOutputTokens += outputTokens;
  }

  function processEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    if (entry.uuid) {
      monitor.entryIndex.set(entry.uuid, entry);
    }

    if (entry.type === 'file-history-snapshot') {
      return;
    }

    // Skip entries older than the last prompt we detected in history.jsonl
    // Allow 2 second tolerance for clock skew
    const entryTimestamp = parseTimestamp(entry.timestamp);
    if (monitor.lastPromptTimestamp && entryTimestamp < (monitor.lastPromptTimestamp - 2000)) {
      return; // Skip old entries
    }

    const isUserRole = entry.type === 'user' && entry.message?.role === 'user';
    const isToolResultEvent = isUserRole && entryContainsToolResult(entry);

    if (isUserRole && !isToolResultEvent) {
      // Before creating a new prompt log, finalize any previous incomplete prompts
      for (const [existingUuid, existingPromptLog] of monitor.promptLogs.entries()) {
        if (!existingPromptLog.completed && existingPromptLog.uuid !== entry.uuid) {
          console.log(`[Claude Monitor] New user prompt detected in timeline, finalizing previous prompt: ${existingUuid}`);
          existingPromptLog.status = 'completed_by_next_prompt';
          finalizePromptLog(existingPromptLog);
        }
      }

      const promptLog = getOrCreatePromptLog(entry.uuid, entry);
      if (promptLog) {
        promptLog.entries.push(entry);
        promptLog.status = promptLog.status || 'waiting';
        promptLog.startedAt = parseTimestamp(entry.timestamp);
        promptLog.lastEventTimestamp = parseTimestamp(entry.timestamp);
        linkPromptState(promptLog);
      }
      return;
    }

    const rootUserUuid = getRootUserUuid(entry, monitor.entryIndex);
    if (!rootUserUuid) {
      return;
    }

    const rootUserEntry = monitor.entryIndex.get(rootUserUuid) || null;
    const promptLog = getOrCreatePromptLog(rootUserUuid, rootUserEntry);
    if (!promptLog) {
      return;
    }
    linkPromptState(promptLog);

    promptLog.entries.push(entry);
    promptLog.lastEntryRole = entry.message?.role || entry.type || null;
    promptLog.lastEventTimestamp = parseTimestamp(entry.timestamp);

    if (isToolResultEvent) {
      promptLog.lastEntryRole = 'tool_result';
      promptLog.sawTool = true;
      promptLog.status = 'in_progress';
      promptLog.latestTextEntry = null;
      promptLog.latestTextValue = null;
      clearPromptDebounce(promptLog);
      return;
    }

    if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
      handleUsageAccumulation(promptLog, entry);
      promptLog.lastAssistantEntry = entry;
      promptLog.lastAssistantTimestamp = parseTimestamp(entry.timestamp);

      const hasToolUse = entryHasToolUse(entry);
      const textValue = extractAssistantText(entry);
      const stopReason = getStopReason(entry);

      if (hasToolUse) {
        promptLog.sawTool = true;
        promptLog.status = 'in_progress';
        promptLog.latestTextEntry = null;
        promptLog.latestTextValue = null;
        clearPromptDebounce(promptLog);
      }

      if (textValue && !hasToolUse) {
        promptLog.latestTextEntry = entry;
        promptLog.latestTextValue = textValue;
        promptLog.status = 'text_ready';

        // Don't auto-finalize with debounce timer
        // Completion will be triggered by: next user prompt, disconnect, or provider change
        console.log(`[Claude Monitor] Assistant text received, waiting for completion trigger`);
      }
      return;
    }

    if (entry.type === 'assistant') {
      handleUsageAccumulation(promptLog, entry);
    }

    if (entryContainsToolResult(entry)) {
      promptLog.sawTool = true;
      promptLog.status = 'in_progress';
      promptLog.latestTextEntry = null;
      promptLog.latestTextValue = null;
      clearPromptDebounce(promptLog);
    }
  }

  // Monitor history.jsonl for new prompts
  async function pollHistoryFile() {
    try {
      const stats = await fs.stat(monitor.historyFilePath);
      if (stats.size <= monitor.historyFileOffset) {
        return; // No new data
      }

      const chunkSize = stats.size - monitor.historyFileOffset;
      const buffer = Buffer.allocUnsafe(chunkSize);
      const fileHandle = await fs.open(monitor.historyFilePath, 'r');

      try {
        const result = await fileHandle.read(buffer, 0, chunkSize, monitor.historyFileOffset);
        const bytesRead = result.bytesRead;

        if (bytesRead > 0) {
          monitor.historyFileOffset += bytesRead;
          monitor.historyBuffer += buffer.slice(0, bytesRead).toString('utf8');

          let newlineIndex = monitor.historyBuffer.indexOf('\n');
          while (newlineIndex !== -1) {
            const line = monitor.historyBuffer.slice(0, newlineIndex).trim();
            monitor.historyBuffer = monitor.historyBuffer.slice(newlineIndex + 1);

            if (line.length > 0) {
              try {
                const entry = JSON.parse(line);
                // Check if this is a new prompt entry (Claude CLI uses "display" field)
                const promptText = entry.display || entry.prompt;
                if (promptText && promptText !== monitor.lastPromptText) {
                  console.log(`[Claude Monitor] New prompt detected: ${promptText.substring(0, 50)}...`);

                  // Don't finalize here - let the timeline user entry detection handle it
                  // This ensures we have complete assistant responses before finalizing
                  monitor.lastPromptText = promptText;
                  monitor.lastPromptTimestamp = entry.timestamp || Date.now();
                  console.log(`[Claude Monitor] Prompt timestamp: ${monitor.lastPromptTimestamp}`);

                  // Now that we have a prompt, start monitoring timeline file
                  if (!monitor.currentFilePath) {
                    console.log('[Claude Monitor] Starting timeline log monitoring after prompt detection');
                    await openTimelineFile();
                  }
                }
              } catch (parseError) {
                console.error('[Claude Monitor] Failed to parse history line:', parseError);
              }
            }

            newlineIndex = monitor.historyBuffer.indexOf('\n');
          }
        }
      } finally {
        await fileHandle.close();
      }
    } catch (error) {
      // File doesn't exist yet or can't be read - this is normal on first run
      if (error.code !== 'ENOENT') {
        console.error('[Claude Monitor] Error reading history file:', error);
      }
    }
  }

  async function openTimelineFile() {
    const latestPath = await selectLatestSessionFile();
    if (!latestPath) {
      return;
    }
    console.log(`[Claude Monitor] Opening timeline log file: ${latestPath}`);
    await closeFileHandle();
    monitor.currentFilePath = latestPath;
    monitor.entryIndex.clear();
    for (const promptLog of monitor.promptLogs.values()) {
      clearPromptDebounce(promptLog);
    }
    monitor.promptLogs.clear();

    // Start from beginning and filter by timestamp
    // We'll skip entries older than the last prompt timestamp from history.jsonl
    monitor.fileOffset = 0;
    monitor.buffer = '';
    console.log(`[Claude Monitor] Starting from beginning of file, will skip entries older than ${monitor.lastPromptTimestamp}`);

    try {
      monitor.fileHandle = await fs.open(latestPath, 'r');
      console.log(`[Claude Monitor] Successfully opened timeline log file`);
    } catch (openError) {
      console.error('[Claude Monitor] Failed to open Claude timeline log:', openError);
      monitor.currentFilePath = null;
      monitor.fileHandle = null;
    }
  }

  async function pollLog() {
    if (monitor.disposed) {
      return;
    }

    // First, check history.jsonl for new prompts
    await pollHistoryFile();

    // If no timeline file is open yet, we're done for this poll
    if (!monitor.currentFilePath) {
      return;
    }

    let stats;
    try {
      stats = await fs.stat(monitor.currentFilePath);
    } catch (statError) {
      console.error('[Claude Monitor] Failed to stat Claude session log:', statError);
      await closeFileHandle();
      monitor.currentFilePath = null;
      monitor.fileOffset = 0;
      monitor.buffer = '';
      return;
    }

    if (!stats || stats.size === monitor.fileOffset) {
      // No new data to read
      return;
    }

    const chunkSize = stats.size - monitor.fileOffset;
    console.log(`[Claude Monitor] Reading ${chunkSize} bytes from offset ${monitor.fileOffset} (file size: ${stats.size})`);

    const buffer = Buffer.allocUnsafe(chunkSize);
    if (!monitor.fileHandle) {
      try {
        monitor.fileHandle = await fs.open(monitor.currentFilePath, 'r');
      } catch (reopenError) {
        console.error('[Claude Monitor] Failed to reopen Claude session log:', reopenError);
        monitor.currentFilePath = null;
        monitor.fileOffset = 0;
        monitor.buffer = '';
        return;
      }
    }

    let bytesRead = 0;
    try {
      const result = await monitor.fileHandle.read(buffer, 0, chunkSize, monitor.fileOffset);
      bytesRead = result.bytesRead;
      console.log(`[Claude Monitor] Successfully read ${bytesRead} bytes`);
    } catch (readError) {
      console.error('[Claude Monitor] Failed to read Claude session log:', readError);
      return;
    }

    if (bytesRead <= 0) {
      console.log('[Claude Monitor] No bytes read, returning');
      return;
    }

    monitor.fileOffset += bytesRead;
    monitor.buffer += buffer.slice(0, bytesRead).toString('utf8');

    let lineCount = 0;
    let newlineIndex = monitor.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = monitor.buffer.slice(0, newlineIndex).trim();
      monitor.buffer = monitor.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        lineCount++;
        try {
          const entry = JSON.parse(line);
          console.log(`[Claude Monitor] Parsed entry type: ${entry.type}`);
          processEntry(entry);
        } catch (parseError) {
          console.error('[Claude Monitor] Failed to parse Claude log line:', parseError);
        }
      }
      newlineIndex = monitor.buffer.indexOf('\n');
    }

    if (lineCount > 0) {
      console.log(`[Claude Monitor] Processed ${lineCount} log entries`);
    }
  }

  monitor.dispose = async () => {
    monitor.disposed = true;
    if (monitor.pollTimer) {
      clearInterval(monitor.pollTimer);
      monitor.pollTimer = null;
    }

    // Finalize all incomplete prompts before disposing
    console.log(`[Claude Monitor] Disposing monitor, finalizing ${monitor.promptLogs.size} incomplete prompts`);
    for (const promptLog of monitor.promptLogs.values()) {
      if (promptLog.debounceTimer) {
        clearTimeout(promptLog.debounceTimer);
        promptLog.debounceTimer = null;
        promptLog.debounceDueAt = null;
      }
      if (!promptLog.completed) {
        promptLog.status = 'completed_by_disconnect';
        finalizePromptLog(promptLog);
      }
    }

    monitor.promptLogs.clear();
    monitor.entryIndex.clear();
    await closeFileHandle();
  };

  console.log(`[Claude Monitor Setup] Starting polling timer (interval: ${CLAUDE_LOG_POLL_INTERVAL_MS}ms)`);
  monitor.pollTimer = setInterval(() => {
    pollLog().catch((error) => {
      console.error('[Claude Monitor] Polling failed:', error);
    });
  }, CLAUDE_LOG_POLL_INTERVAL_MS);

  console.log('[Claude Monitor Setup] Monitor successfully initialized');
  return monitor;
}

async function disposeClaudeLogMonitor(sessionKey) {
  const monitor = claudeLogMonitors[sessionKey];
  if (!monitor) {
    return;
  }
  delete claudeLogMonitors[sessionKey];
  try {
    await monitor.dispose();
  } catch (disposeError) {
    console.error('Failed to dispose Claude log monitor:', disposeError);
  }
}

const CODEX_INTERMEDIATE_TYPES = new Set([
  'function_call',
  'function_call_output',
  'custom_tool_call',
  'custom_tool_call_output',
  'reasoning'
]);

async function setupCodexLogMonitor({
  homeDir,
  workspaceDir,
  sessionKey,
  finalizeSession,
  socket,
  debounceMs
}) {
  const sessionsRoot = path.join(homeDir, '.codex', 'sessions');
  try {
    await fs.mkdir(sessionsRoot, { recursive: true });
  } catch (mkdirError) {
    console.error('Failed to ensure Codex session directory:', mkdirError);
    return null;
  }

  const emailSegment = path.basename(homeDir);
  const relativeToHome = path.relative(homeDir, workspaceDir);
  const normalizedRelative = !relativeToHome || relativeToHome.startsWith('..')
    ? null
    : relativeToHome.split(path.sep).join('/');
  const containerWorkspaceDir = normalizedRelative
    ? `/app/user_projects/${emailSegment}/${normalizedRelative}`
    : null;

  const acceptedCwds = new Set([workspaceDir]);
  if (containerWorkspaceDir) {
    acceptedCwds.add(containerWorkspaceDir);
  }

  const monitor = {
    sessionKey,
    socket,
    sessionsRoot,
    acceptedCwds,
    currentFilePath: null,
    fileHandle: null,
    fileOffset: 0,
    buffer: '',
    disposed: false,
    pollTimer: null,
    debounceMs: Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : DEFAULT_CODEX_TEXT_DEBOUNCE_MS,
    promptQueue: [],
    activeSessionId: null,
    lastActivityTs: Date.now(),
    skippedFiles: new Set(),
    lastUserMessage: null,
    lastFileCheckTime: 0,
    fileCheckInterval: 5000 // Check for new files every 5 seconds
  };

  function clearPromptDebounce(prompt) {
    if (!prompt) {
      return;
    }
    if (prompt.debounceTimer) {
      clearTimeout(prompt.debounceTimer);
      prompt.debounceTimer = null;
    }
    prompt.debounceDueAt = null;
  }

  function markPromptInProgress(prompt) {
    if (!prompt || prompt.status === 'completed') {
      return;
    }
    prompt.status = 'in_progress';
    prompt.sawTool = true;
    prompt.latestAssistantText = null;
    prompt.latestAssistantTimestamp = null;
    clearPromptDebounce(prompt);
  }

  function linkPromptState(prompt) {
    if (!prompt || prompt.statePrompt) {
      return;
    }
    const session = sessionState[sessionKey];
    if (!session || !Array.isArray(session.prompts) || session.prompts.length === 0) {
      return;
    }
    const candidate = session.prompts.find((entry) => !entry.codexLinked);
    if (!candidate) {
      return;
    }
    candidate.codexLinked = true;
    candidate.codexPromptId = prompt.id;
    if (typeof prompt.startedAt === 'number') {
      candidate.startedAt = prompt.startedAt;
    }
    prompt.statePrompt = candidate;
  }

  function startPromptDebounce(prompt, delayOverride) {
    if (!prompt || prompt.status === 'completed') {
      return;
    }

    const delay = Number.isFinite(delayOverride) && delayOverride >= 0
      ? delayOverride
      : monitor.debounceMs;

    if (delay === 0) {
      clearPromptDebounce(prompt);
      finalizePrompt(prompt);
      return;
    }

    clearPromptDebounce(prompt);
    prompt.debounceDueAt = Date.now() + delay;
    prompt.debounceTimer = setTimeout(() => {
      if (monitor.disposed || prompt.status !== 'text_ready') {
        return;
      }
      finalizePrompt(prompt);
    }, delay);
  }

  function getActivePrompt() {
    if (monitor.promptQueue.length === 0) {
      return null;
    }
    return monitor.promptQueue[0];
  }

  function removePrompt(prompt) {
    const index = monitor.promptQueue.indexOf(prompt);
    if (index !== -1) {
      monitor.promptQueue.splice(index, 1);
    }
  }

  function updateTokenUsage(prompt, info) {
    if (!prompt || !info) {
      return;
    }
    const usageSource = info.last_token_usage || info.total_token_usage;
    if (!usageSource) {
      return;
    }
    prompt.tokenUsage = {
      inputTokens: usageSource.input_tokens ?? usageSource.inputTokens ?? null,
      outputTokens: usageSource.output_tokens ?? usageSource.outputTokens ?? null,
      reasoningTokens: usageSource.reasoning_output_tokens ?? usageSource.reasoningOutputTokens ?? null,
      totalTokens: usageSource.total_tokens ?? usageSource.totalTokens ?? null
    };
  }

  function finalizePrompt(prompt) {
    if (!prompt || prompt.status === 'completed') {
      return;
    }

    prompt.status = 'completed';
    clearPromptDebounce(prompt);

    const finishTimestamp = prompt.lastAssistantTimestamp
      ?? prompt.lastEventTimestamp
      ?? Date.now();
    const startedAt = prompt.startedAt ?? finishTimestamp;
    const durationMs = Math.max(0, finishTimestamp - startedAt);

    const session = sessionState[sessionKey];
    if (session) {
      session.actualDurationMs = durationMs;
      session.totalApprovalWaitMs = 0;
      session.approvalWaitStartTime = null;
      session.awaitingApproval = false;
      session.responsePending = false;

      // Track the timestamp range of completed prompts for history.jsonl filtering (same as Claude)
      if (!session.completedPromptStartTime) {
        session.completedPromptStartTime = prompt.startedAt;
      }
      session.completedPromptEndTime = finishTimestamp;

      if (prompt.statePrompt) {
        prompt.statePrompt.durationMs = durationMs;
        prompt.statePrompt.completedAt = finishTimestamp;
        if (prompt.latestAssistantText) {
          prompt.statePrompt.outputText = prompt.latestAssistantText;
        }
        if (prompt.tokenUsage) {
          prompt.statePrompt.tokenUsage = {
            inputTokens: prompt.tokenUsage.inputTokens ?? 0,
            outputTokens: prompt.tokenUsage.outputTokens ?? 0,
            reasoningTokens: prompt.tokenUsage.reasoningTokens ?? 0,
            totalTokens: prompt.tokenUsage.totalTokens ?? 0
          };
        }
      }

      if (prompt.tokenUsage) {
        session.lastPromptTokenUsage = {
          inputTokens: prompt.tokenUsage.inputTokens ?? 0,
          outputTokens: prompt.tokenUsage.outputTokens ?? 0,
          reasoningTokens: prompt.tokenUsage.reasoningTokens ?? 0,
          totalTokens: prompt.tokenUsage.totalTokens ?? 0
        };
      } else {
        session.lastPromptTokenUsage = undefined;
      }
      session.lastPromptFinishedAt = finishTimestamp;
      if (prompt.latestAssistantText) {
        session.lastPromptOutputText = prompt.latestAssistantText;
      }
    }

    removePrompt(prompt);

    console.log(`[Codex Monitor] Response complete detected for prompt`);
    console.log(`[Codex Monitor] Calling finalizeSession for sessionKey: ${sessionKey}`);

    finalizeSession({ reason: 'response-complete' }).catch((error) => {
      console.error('[Codex Monitor] finalize session failed:', error);
      try {
        socket.emit(
          'output',
          '\r\n⚠️ Codexセッションの終了処理に失敗しました。ログを確認してください。\r\n'
        );
      } catch {
        // ignore
      }
    });
  }

  function expireStalePrompts(reason) {
    if (monitor.promptQueue.length === 0) {
      return;
    }
    const snapshot = [...monitor.promptQueue];
    for (const prompt of snapshot) {
      if (prompt.status === 'completed') {
        continue;
      }
      if (reason === 'session-switch' || reason === 'dispose') {
        finalizePrompt(prompt);
      } else if (reason === 'new-user-message') {
        finalizePrompt(prompt);
      }
    }
  }

  function pushUserPrompt(entry, messageText) {
    const trimmed = typeof messageText === 'string' ? messageText.trim() : '';
    if (!trimmed || trimmed.startsWith('<environment_context')) {
      return;
    }

    const timestampMs = parseTimestamp(entry.timestamp);
    if (monitor.lastUserMessage && monitor.lastUserMessage.text === trimmed) {
      const delta = Math.abs(timestampMs - monitor.lastUserMessage.timestamp);
      if (delta <= 200) {
        return;
      }
    }

    expireStalePrompts('new-user-message');

    const prompt = {
      id: randomUUID(),
      userEntry: entry,
      promptText: trimmed,
      startedAt: timestampMs,
      lastEventTimestamp: timestampMs,
      status: 'pending',
      sawTool: false,
      latestAssistantText: null,
      latestAssistantTimestamp: null,
      debounceTimer: null,
      debounceDueAt: null,
      statePrompt: null,
      tokenUsage: null
    };

    monitor.promptQueue.push(prompt);
    monitor.lastActivityTs = Date.now();
    monitor.lastUserMessage = { text: trimmed, timestamp: timestampMs };
    linkPromptState(prompt);
    const session = sessionState[sessionKey];
    if (session) {
      session.responsePending = true;
    }
  }

  function handleAssistantMessage(entry) {
    const prompt = getActivePrompt();
    if (!prompt) {
      return;
    }

    linkPromptState(prompt);
    prompt.lastEventTimestamp = parseTimestamp(entry.timestamp);
    const textValue = extractAssistantText(entry);
    const stopReason = getStopReason(entry);
    const shouldSkipDebounce = stopReason === 'end_turn' || stopReason === 'stop_sequence';
    const hasText = typeof textValue === 'string' && textValue.length > 0;

    if (hasText) {
      prompt.latestAssistantText = textValue;
      prompt.latestAssistantTimestamp = parseTimestamp(entry.timestamp);
      prompt.status = 'text_ready';
      monitor.lastActivityTs = Date.now();
      startPromptDebounce(prompt, shouldSkipDebounce ? 0 : undefined);
    }
  }

  async function selectLatestSessionFile() {
    let latestPath = null;
    let latestMtime = 0;

    async function safeReadDir(target) {
      try {
        return await fs.readdir(target, { withFileTypes: true });
      } catch {
        return [];
      }
    }

    const yearEntries = await safeReadDir(sessionsRoot);
    const years = yearEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));

    for (const year of years) {
      const yearDir = path.join(sessionsRoot, year);
      const monthEntries = await safeReadDir(yearDir);
      const months = monthEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a));

      for (const month of months) {
        const monthDir = path.join(yearDir, month);
        const dayEntries = await safeReadDir(monthDir);
        const days = dayEntries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort((a, b) => b.localeCompare(a));

        for (const day of days) {
          const dayDir = path.join(monthDir, day);
          const fileEntries = await safeReadDir(dayDir);
          const files = fileEntries
            .filter((entry) => entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl'))
            .map((entry) => entry.name)
            .sort((a, b) => b.localeCompare(a));

          for (const fileName of files) {
            const fullPath = path.join(dayDir, fileName);
            if (monitor.skippedFiles.has(fullPath)) {
              continue;
            }
            let stats;
            try {
              stats = await fs.stat(fullPath);
            } catch {
              continue;
            }
            if (stats.mtimeMs > latestMtime) {
              latestMtime = stats.mtimeMs;
              latestPath = fullPath;
            }
          }

          if (latestPath) {
            return latestPath;
          }
        }
      }
    }

    return latestPath;
  }

  async function closeFileHandle() {
    if (monitor.fileHandle) {
      try {
        await monitor.fileHandle.close();
      } catch {
        // ignore
      } finally {
        monitor.fileHandle = null;
      }
    }
  }

  async function reopenLatestFile() {
    const latestPath = await selectLatestSessionFile();
    if (!latestPath) {
      return false;
    }

    if (monitor.currentFilePath === latestPath && monitor.fileHandle) {
      return true;
    }

    await closeFileHandle();
    monitor.currentFilePath = latestPath;
    monitor.fileOffset = 0;
    monitor.buffer = '';
    monitor.activeSessionId = null;
    monitor.lastActivityTs = Date.now();
    expireStalePrompts('session-switch');
    monitor.promptQueue.length = 0;
    monitor.lastUserMessage = null;

    try {
      monitor.fileHandle = await fs.open(latestPath, 'r');
      return true;
    } catch (openError) {
      console.error('Failed to open Codex session log:', openError);
      monitor.currentFilePath = null;
      monitor.fileHandle = null;
      return false;
    }
  }

  function handleSessionMeta(entry) {
    const payload = entry?.payload || {};
    const cwd = payload.cwd;
    if (cwd && !monitor.acceptedCwds.has(cwd)) {
      if (monitor.currentFilePath) {
        monitor.skippedFiles.add(monitor.currentFilePath);
      }
      monitor.currentFilePath = null;
      monitor.fileOffset = 0;
      monitor.buffer = '';
      monitor.activeSessionId = null;
      monitor.lastUserMessage = null;
      closeFileHandle().catch(() => {});
      expireStalePrompts('session-switch');
      return;
    }

    monitor.activeSessionId = payload.id || monitor.activeSessionId;
  }

  function processEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    monitor.lastActivityTs = Date.now();

    switch (entry.type) {
      case 'session_meta':
        handleSessionMeta(entry);
        return;
      case 'event_msg': {
        const payload = entry.payload || {};
        const eventType = payload.type;
        if (eventType === 'user_message') {
          pushUserPrompt(entry, payload.message);
        } else if (eventType === 'token_count') {
          const prompt = getActivePrompt();
          if (prompt) {
            updateTokenUsage(prompt, payload.info);
            prompt.lastEventTimestamp = parseTimestamp(entry.timestamp);
            markPromptInProgress(prompt);
          }
        }
        return;
      }
      case 'response_item': {
        const payload = entry.payload || {};
        const itemType = payload.type;
        const role = payload.role;

        if (role === 'assistant') {
          if (itemType === 'message') {
            handleAssistantMessage(entry);
          } else if (CODEX_INTERMEDIATE_TYPES.has(itemType)) {
            const prompt = getActivePrompt();
            if (prompt) {
              prompt.lastEventTimestamp = parseTimestamp(entry.timestamp);
              markPromptInProgress(prompt);
            }
          }
        } else if (role === 'user' && itemType === 'message') {
          const content = Array.isArray(payload.content) ? payload.content : [];
          const parts = [];
          for (const part of content) {
            if (part?.type === 'input_text' && typeof part.text === 'string') {
              parts.push(part.text);
            }
          }
          if (parts.length > 0) {
            pushUserPrompt(entry, parts.join('\n'));
          }
        } else if (CODEX_INTERMEDIATE_TYPES.has(itemType)) {
          const prompt = getActivePrompt();
          if (prompt) {
            prompt.lastEventTimestamp = parseTimestamp(entry.timestamp);
            markPromptInProgress(prompt);
          }
        }

        return;
      }
      default:
        return;
    }
  }

  async function pollLog() {
    if (monitor.disposed) {
      return;
    }

    // Periodically check for newer log files
    const now = Date.now();
    const shouldCheckForNewFiles = !monitor.currentFilePath || (now - monitor.lastFileCheckTime >= monitor.fileCheckInterval);

    if (shouldCheckForNewFiles) {
      monitor.lastFileCheckTime = now;
      const opened = await reopenLatestFile();
      if (!opened && !monitor.currentFilePath) {
        return;
      }
    }

    if (!monitor.currentFilePath) {
      return;
    }

    let stats;
    try {
      stats = await fs.stat(monitor.currentFilePath);
    } catch (statError) {
      console.error('Failed to stat Codex session log:', statError);
      monitor.skippedFiles.add(monitor.currentFilePath);
      monitor.currentFilePath = null;
      monitor.fileOffset = 0;
      monitor.buffer = '';
      await closeFileHandle();
      expireStalePrompts('session-switch');
      return;
    }

    if (!stats || stats.size <= monitor.fileOffset) {
      return;
    }

    const chunkSize = stats.size - monitor.fileOffset;
    const buffer = Buffer.allocUnsafe(chunkSize);
    if (!monitor.fileHandle) {
      try {
        monitor.fileHandle = await fs.open(monitor.currentFilePath, 'r');
      } catch (openError) {
        console.error('Failed to reopen Codex session log:', openError);
        monitor.skippedFiles.add(monitor.currentFilePath);
        monitor.currentFilePath = null;
        monitor.fileOffset = 0;
        monitor.buffer = '';
        expireStalePrompts('session-switch');
        return;
      }
    }

    let bytesRead = 0;
    try {
      const result = await monitor.fileHandle.read(buffer, 0, chunkSize, monitor.fileOffset);
      bytesRead = result.bytesRead;
    } catch (readError) {
      console.error('Failed to read Codex session log:', readError);
      return;
    }

    if (bytesRead <= 0) {
      return;
    }

    monitor.fileOffset += bytesRead;
    monitor.buffer += buffer.slice(0, bytesRead).toString('utf8');

    let newlineIndex = monitor.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = monitor.buffer.slice(0, newlineIndex).trim();
      monitor.buffer = monitor.buffer.slice(newlineIndex + 1);

      if (line.length > 0) {
        try {
          const entry = JSON.parse(line);
          processEntry(entry);
        } catch (parseError) {
          console.error('Failed to parse Codex log line:', parseError);
        }
      }

      newlineIndex = monitor.buffer.indexOf('\n');
    }
  }

  monitor.dispose = async () => {
    monitor.disposed = true;
    if (monitor.pollTimer) {
      clearInterval(monitor.pollTimer);
      monitor.pollTimer = null;
    }
    const pending = [...monitor.promptQueue];
    for (const prompt of pending) {
      finalizePrompt(prompt);
    }
    monitor.promptQueue.length = 0;
    monitor.lastUserMessage = null;
    await closeFileHandle();
  };

  monitor.pollTimer = setInterval(() => {
    pollLog().catch((error) => {
      console.error('Codex log polling failed:', error);
    });
  }, CODEX_LOG_POLL_INTERVAL_MS);

  return monitor;
}

async function disposeCodexLogMonitor(sessionKey) {
  const monitor = codexLogMonitors[sessionKey];
  if (!monitor) {
    return;
  }
  delete codexLogMonitors[sessionKey];
  try {
    await monitor.dispose();
  } catch (disposeError) {
    console.error('Failed to dispose Codex log monitor:', disposeError);
  }
}

async function setupGeminiLogMonitor({
  homeDir,
  workspaceDir,
  sessionKey,
  finalizeSession,
  socket,
  turnIdleMs,
  sessionIdleMs,
  projectId,
  db
}) {
  const geminiTmpRoot = path.join(homeDir, '.gemini', 'tmp');

  try {
    await fs.mkdir(geminiTmpRoot, { recursive: true });
  } catch (mkdirError) {
    console.error('Failed to ensure Gemini session directory:', mkdirError);
    return null;
  }

  const emailSegment = path.basename(homeDir);
  const relativeToHome = path.relative(homeDir, workspaceDir);
  const normalizedRelative = !relativeToHome || relativeToHome.startsWith('..')
    ? null
    : relativeToHome.split(path.sep).join('/');
  const containerWorkspaceDir = normalizedRelative
    ? `/app/user_projects/${emailSegment}/${normalizedRelative}`
    : null;

  const monitor = {
    sessionKey,
    socket,
    geminiTmpRoot,
    currentFilePath: null,
    disposed: false,
    pollTimer: null,
    turnIdleMs: Number.isFinite(turnIdleMs) && turnIdleMs >= 0 ? turnIdleMs : DEFAULT_GEMINI_TURN_IDLE_MS,
    sessionIdleMs: Number.isFinite(sessionIdleMs) && sessionIdleMs >= 0 ? sessionIdleMs : DEFAULT_GEMINI_SESSION_IDLE_MS,
    activeTurn: null,
    lastProcessedIndex: -1,
    lastFileUpdatedMs: 0,
    lastActivityMs: Date.now(),
    skippedFiles: new Set(),
    lastUserMessage: null,
    acceptedWorkspaces: new Set([workspaceDir]),
    lastFileCheckTime: 0,
    fileCheckInterval: 5000, // Check for new files every 5 seconds
    projectId,
    db,
    sessionStartTime: Date.now() // Track session start time to filter old files
  };

  if (containerWorkspaceDir) {
    monitor.acceptedWorkspaces.add(containerWorkspaceDir);
  }

  function linkTurnState(turn) {
    if (!turn || turn.statePrompt) {
      return;
    }
    const session = sessionState[sessionKey];
    if (!session || !Array.isArray(session.prompts) || session.prompts.length === 0) {
      return;
    }
    const candidate = session.prompts.find((entry) => !entry.geminiLinked);
    if (!candidate) {
      return;
    }
    candidate.geminiLinked = true;
    candidate.geminiPromptId = turn.id;
    if (typeof candidate.startedAt === 'number') {
      turn.startedAt = candidate.startedAt;
    }
    turn.statePrompt = candidate;
  }

  function applyTokenUsageFromMessage(message) {
    if (!message || !message.tokens) {
      return null;
    }
    const tokens = message.tokens;
    return {
      inputTokens: tokens.input ?? tokens.prompt ?? tokens.total_input ?? 0,
      outputTokens: tokens.output ?? tokens.completion ?? tokens.total_output ?? 0,
      reasoningTokens: tokens.thoughts ?? tokens.reasoning ?? 0,
      totalTokens: tokens.total ?? (tokens.input ?? 0) + (tokens.output ?? 0)
    };
  }

  function finalizeActiveTurn(reason) {
    const turn = monitor.activeTurn;
    if (!turn || turn.completed) {
      monitor.activeTurn = null;
      return;
    }

    turn.completed = true;

    const finishMs = turn.lastActivityMs ?? monitor.lastFileUpdatedMs ?? Date.now();
    const startedAt = turn.startedAt ?? finishMs;
    const durationMs = Math.max(0, finishMs - startedAt);
    const outputText = turn.lastGeminiMessage?.content ?? '';
    const tokenUsage = turn.lastGeminiTokens ?? null;

    const session = sessionState[sessionKey];
    if (session) {
      session.actualDurationMs = durationMs;
      session.totalApprovalWaitMs = 0;
      session.approvalWaitStartTime = null;
      session.awaitingApproval = false;
      session.responsePending = false;

      // Track the timestamp range of completed prompts for logs.json filtering (same as Claude/Codex)
      if (!session.completedPromptStartTime) {
        session.completedPromptStartTime = startedAt;
      }
      session.completedPromptEndTime = finishMs;

      if (turn.statePrompt) {
        turn.statePrompt.durationMs = durationMs;
        turn.statePrompt.completedAt = finishMs;
        turn.statePrompt.outputText = outputText;
        if (tokenUsage) {
          turn.statePrompt.tokenUsage = {
            inputTokens: tokenUsage.inputTokens ?? 0,
            outputTokens: tokenUsage.outputTokens ?? 0,
            reasoningTokens: tokenUsage.reasoningTokens ?? 0,
            totalTokens: tokenUsage.totalTokens ?? 0
          };
        }
      }

      if (tokenUsage) {
        session.lastPromptTokenUsage = {
          inputTokens: tokenUsage.inputTokens ?? 0,
          outputTokens: tokenUsage.outputTokens ?? 0,
          reasoningTokens: tokenUsage.reasoningTokens ?? 0,
          totalTokens: tokenUsage.totalTokens ?? 0
        };
      } else {
        session.lastPromptTokenUsage = undefined;
      }
      session.lastPromptFinishedAt = finishMs;
      session.lastPromptOutputText = outputText;
    }

    monitor.activeTurn = null;

    console.log(`[Gemini Monitor] Turn finalized with reason: ${reason || 'response-complete'}`);
    console.log(`[Gemini Monitor] Calling finalizeSession for sessionKey: ${sessionKey}`);

    finalizeSession({ reason: reason || 'response-complete' }).catch((error) => {
      console.error('[Gemini Monitor] finalize session failed:', error);
      try {
        socket.emit(
          'output',
          '\r\n⚠️ Geminiセッションの終了処理に失敗しました。ログを確認してください。\r\n'
        );
      } catch {
        // ignore
      }
    });
  }

  function startNewTurn(message) {
    if (!message) {
      return;
    }

    const rawContent = typeof message.content === 'string' ? message.content.trim() : '';
    if (!rawContent || rawContent.startsWith('<environment_context')) {
      return;
    }

    const timestampMs = parseTimestamp(message.timestamp);
    if (monitor.lastUserMessage && monitor.lastUserMessage.text === rawContent) {
      const delta = Math.abs(timestampMs - monitor.lastUserMessage.timestamp);
      if (delta <= 200) {
        return;
      }
    }

    if (monitor.activeTurn) {
      finalizeActiveTurn('next-user');
    }

    monitor.activeTurn = {
      id: randomUUID(),
      userMessage: message,
      startedAt: timestampMs,
      lastActivityMs: timestampMs,
      lastGeminiMessage: null,
      lastGeminiTokens: null,
      statePrompt: null,
      completed: false
    };

    monitor.lastUserMessage = { text: rawContent, timestamp: timestampMs };
    monitor.lastActivityMs = Math.max(monitor.lastActivityMs, timestampMs);
    monitor.lastFileUpdatedMs = Math.max(monitor.lastFileUpdatedMs, timestampMs);

    const session = sessionState[sessionKey];
    if (session) {
      session.responsePending = true;
    }

    linkTurnState(monitor.activeTurn);
  }

  function updateGeminiResponse(message) {
    const turn = monitor.activeTurn;
    if (!turn) {
      return;
    }

    const timestampMs = parseTimestamp(message.timestamp);
    turn.lastGeminiMessage = message;
    turn.lastGeminiTokens = applyTokenUsageFromMessage(message);
    turn.lastActivityMs = timestampMs;
    monitor.lastActivityMs = Math.max(monitor.lastActivityMs, timestampMs);
    monitor.lastFileUpdatedMs = Math.max(monitor.lastFileUpdatedMs, timestampMs);
  }

  async function safeReadDir(target) {
    try {
      return await fs.readdir(target, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  async function selectLatestSessionFile() {
    console.log(`[Gemini Monitor] Scanning for log files created after session start`);
    console.log(`[Gemini Monitor] Session start time: ${monitor.sessionStartTime} (${new Date(monitor.sessionStartTime).toISOString()})`);
    console.log(`[Gemini Monitor] Last user message time: ${monitor.lastUserMessage?.timestamp || 'none'}`);

    let latestPath = null;
    let latestMtime = 0;
    // Allow 2 seconds tolerance for file creation timing (same as Claude)
    const minTimestamp = (monitor.lastUserMessage?.timestamp || monitor.sessionStartTime) - 2000;

    const hashEntries = await safeReadDir(geminiTmpRoot);
    const hashDirs = hashEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));

    console.log(`[Gemini Monitor] Found ${hashDirs.length} hash directories`);

    for (const hash of hashDirs) {
      const chatsDir = path.join(geminiTmpRoot, hash, 'chats');
      const chatEntries = await safeReadDir(chatsDir);
      const files = chatEntries
        .filter((entry) => entry.isFile() && entry.name.startsWith('session-') && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a));

      console.log(`[Gemini Monitor] Found ${files.length} session files in hash ${hash}`);

      for (const fileName of files) {
        const fullPath = path.join(chatsDir, fileName);
        if (monitor.skippedFiles.has(fullPath)) {
          continue;
        }
        let stats;
        try {
          stats = await fs.stat(fullPath);
          console.log(`[Gemini Monitor] File: ${fileName}, mtime: ${stats.mtimeMs}, created after threshold (with 2s tolerance): ${stats.mtimeMs >= minTimestamp}`);
        } catch {
          continue;
        }

        // Only consider files created around the last user message (with 2s tolerance) or after session start
        if (stats.mtimeMs >= minTimestamp && stats.mtimeMs > latestMtime) {
          latestMtime = stats.mtimeMs;
          latestPath = fullPath;
        }
      }

      if (latestPath) {
        console.log(`[Gemini Monitor] Selected latest file: ${latestPath}`);
        return latestPath;
      }
    }

    if (!latestPath) {
      console.log('[Gemini Monitor] No valid session file found created after session start or last user message');
    }

    return latestPath;
  }

  async function pollLog() {
    if (monitor.disposed) {
      return;
    }

    // Periodically check for newer log files
    const now = Date.now();
    const shouldCheckForNewFiles = !monitor.currentFilePath || (now - monitor.lastFileCheckTime >= monitor.fileCheckInterval);

    let latestPath = monitor.currentFilePath;

    if (shouldCheckForNewFiles) {
      monitor.lastFileCheckTime = now;
      latestPath = await selectLatestSessionFile();

      if (!latestPath) {
        if (now - monitor.lastActivityMs >= monitor.sessionIdleMs) {
          finalizeActiveTurn('session-idle');
        }
        return;
      }

      if (monitor.currentFilePath !== latestPath) {
        console.log(`[Gemini Monitor] Switching to new log file: ${latestPath}`);
        console.log(`[Gemini Monitor] Previous file: ${monitor.currentFilePath || 'none'}`);
        finalizeActiveTurn('session-switch');
        monitor.currentFilePath = latestPath;
        monitor.lastProcessedIndex = -1;
        monitor.activeTurn = null;
        monitor.lastFileUpdatedMs = 0;
        monitor.lastUserMessage = null;

        // Extract and save hash folder mapping to database
        const match = latestPath.match(/\.gemini\/tmp\/([^\/]+)\//);
        if (match && match[1] && monitor.projectId && monitor.db) {
          const hashFolder = match[1];
          saveGeminiHashFolder(monitor.projectId, hashFolder, monitor.db).catch(err => {
            console.error('[Gemini Monitor] Failed to save hash folder mapping:', err);
          });
        }

        // Reset timestamp range when switching to new session file
        const session = sessionState[sessionKey];
        if (session) {
          session.completedPromptStartTime = null;
          session.completedPromptEndTime = null;
        }
      }
    }

    if (!monitor.currentFilePath) {
      return;
    }

    let fileContent;
    try {
      fileContent = await fs.readFile(monitor.currentFilePath, 'utf8');
    } catch (readError) {
      console.error('Failed to read Gemini session log:', readError);
      monitor.skippedFiles.add(monitor.currentFilePath);
      monitor.currentFilePath = null;
      monitor.lastProcessedIndex = -1;
      return;
    }

    if (!fileContent) {
      return;
    }

    let json;
    try {
      json = JSON.parse(fileContent);
    } catch (parseError) {
      // Partial write or in-progress update: wait for next poll
      return;
    }

    const workspaceMatches = typeof json?.cwd === 'string'
      ? monitor.acceptedWorkspaces.has(json.cwd)
      : true;

    if (!workspaceMatches) {
      monitor.skippedFiles.add(monitor.currentFilePath);
      monitor.currentFilePath = null;
      monitor.lastProcessedIndex = -1;
      monitor.activeTurn = null;
      monitor.lastUserMessage = null;
      return;
    }

    const messages = Array.isArray(json?.messages) ? json.messages : [];
    const lastUpdatedMs = json?.lastUpdated ? parseTimestamp(json.lastUpdated) : null;

    if (lastUpdatedMs) {
      monitor.lastFileUpdatedMs = Math.max(monitor.lastFileUpdatedMs, lastUpdatedMs);
      monitor.lastActivityMs = Math.max(monitor.lastActivityMs, lastUpdatedMs);
    }

    const startIndex = Math.max(monitor.lastProcessedIndex + 1, 0);
    for (let i = startIndex; i < messages.length; i += 1) {
      const message = messages[i];
      const type = message?.type;

      if (type === 'user') {
        startNewTurn(message);
      } else if (type === 'gemini') {
        updateGeminiResponse(message);
      }

      const messageTs = parseTimestamp(message?.timestamp);
      monitor.lastActivityMs = Math.max(monitor.lastActivityMs, messageTs);
      monitor.lastFileUpdatedMs = Math.max(monitor.lastFileUpdatedMs, messageTs);
    }

    if (messages.length > 0) {
      monitor.lastProcessedIndex = messages.length - 1;
    }

    // Don't finalize on turn-idle or session-idle - wait for next user prompt (same as Claude/Codex)
    // Only finalize on exit/dispose or next user prompt
    // session-idle is detected but doesn't trigger finalize anymore
  }

  monitor.dispose = async () => {
    monitor.disposed = true;
    if (monitor.pollTimer) {
      clearInterval(monitor.pollTimer);
      monitor.pollTimer = null;
    }
    finalizeActiveTurn('dispose');
  };

  monitor.pollTimer = setInterval(() => {
    pollLog().catch((error) => {
      console.error('Gemini log polling failed:', error);
    });
  }, GEMINI_LOG_POLL_INTERVAL_MS);

  return monitor;
}

async function disposeGeminiLogMonitor(sessionKey) {
  const monitor = geminiLogMonitors[sessionKey];
  if (!monitor) {
    return;
  }
  delete geminiLogMonitors[sessionKey];

  // Reset Gemini timestamp range when disposing monitor
  const session = sessionState[sessionKey];
  if (session) {
    session.completedPromptStartTime = null;
    session.completedPromptEndTime = null;
  }

  try {
    await monitor.dispose();
  } catch (disposeError) {
    console.error('Failed to dispose Gemini log monitor:', disposeError);
  }
}

function ensureSessionState(sessionKey, defaultProvider) {
  if (!sessionState[sessionKey]) {
    sessionState[sessionKey] = {
      startTime: Date.now(),
      prompts: [],
      provider: defaultProvider,
      awaitingApproval: false,
      approvalWaitStartTime: null,
      totalApprovalWaitMs: 0,
      lastPromptStartedAt: null,
      responsePending: false,
      finalizedPromptIds: new Set(),
      actualDurationMs: null,
      completedPromptStartTime: null,
      completedPromptEndTime: null
    };
  }
  return sessionState[sessionKey];
}

function beginApprovalWait(state) {
  if (!state || state.awaitingApproval) {
    return;
  }
  state.awaitingApproval = true;
  state.approvalWaitStartTime = Date.now();
}

function endApprovalWait(state) {
  if (!state || !state.awaitingApproval) {
    return;
  }
  if (typeof state.approvalWaitStartTime === 'number') {
    const elapsed = Date.now() - state.approvalWaitStartTime;
    if (Number.isFinite(elapsed) && elapsed > 0) {
      state.totalApprovalWaitMs = (state.totalApprovalWaitMs || 0) + elapsed;
    }
  }
  state.awaitingApproval = false;
  state.approvalWaitStartTime = null;
}

function getProjectKey(userId, projectId) {
  return `${userId}:${projectId}`;
}

function buildCommitMessage(prompts, providerName) {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  if (!prompts || prompts.length === 0) {
    return timestamp;
  }
  const list = Array.isArray(prompts) ? prompts : [prompts];
  const normalized = list
    .map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')).trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return timestamp;
  }

  const previewParts = normalized.map((text) => {
    const snippet = text.replace(/\s+/g, ' ');
    return snippet.length > 80 ? `${snippet.slice(0, 77)}...` : snippet;
  });

  return [timestamp, ...normalized].join('\n');
}

function formatDuration(durationMs) {
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs) || durationMs < 0) {
    return 'unknown duration';
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}分${remainingSeconds}秒`;
}

function normalizeTerminalInput(segment) {
  let result = '';
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i];

    if (char === '\u001b') {
      const remaining = segment.slice(i);
      const match = remaining.match(/^\u001b\[[0-9;]*[A-Za-z]/);
      if (match) {
        i += match[0].length - 1;
        continue;
      }
      continue;
    }

    if (char === '\b' || char === '\x7f') {
      result = result.slice(0, -1);
      continue;
    }

    if (char === '\u0015') {
      result = '';
      continue;
    }

    if (char === '\u0017') {
      result = result.replace(/\S+\s*$/, '');
      continue;
    }

    if (char === '\r' || char === '\n') {
      continue;
    }

    const code = char.charCodeAt(0);
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      continue;
    }

    result += char;
  }

  return result.trim();
}

async function ensureClaudeCliConfig(homeDir, apiKey) {
  try {
    const configDir = path.join(homeDir, '.config', 'claude');
    const configPath = path.join(configDir, 'config.json');

    await fs.mkdir(configDir, { recursive: true });

    let needsWrite = true;
    try {
      const existingRaw = await fs.readFile(configPath, 'utf8');
      const existing = JSON.parse(existingRaw);
      if (existing?.auth?.method === 'api-key' && existing?.auth?.apiKey === apiKey) {
        needsWrite = false;
      }
    } catch (readError) {
      // Ignore missing or invalid config and overwrite below
    }

    if (!needsWrite) {
      return;
    }

    const config = {
      auth: {
        method: 'api-key',
        apiKey,
        createdAt: new Date().toISOString()
      }
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    // Silent failure - will be handled by CLI itself
  }
}

const PROVIDERS = {
  claude: {
    displayName: 'Claude Code',
    command: process.platform === 'win32' ? 'claude.cmd' : 'claude',
    async prepare({ workspaceDir, homeDir } = {}) {
      const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return {
          error:
            'Claude CLI を利用するには環境変数 CLAUDE_API_KEY または ANTHROPIC_API_KEY を設定してください。'
        };
      }

      await ensureClaudeCliConfig(homeDir, apiKey);

      return {
        env: {
          CLAUDE_API_KEY: apiKey,
          ANTHROPIC_API_KEY: apiKey,
          XDG_CONFIG_HOME: path.join(homeDir, '.config'),
          CLAUDE_CONFIG_DIR: path.join(homeDir, '.config', 'claude')
        }
      };
    }
  },
  codex: {
    displayName: 'OpenAI Codex',
    command: process.platform === 'win32' ? 'codex.cmd' : 'codex',
    async prepare() {
      const apiKey = process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
      if (!apiKey) {
        return {
          error:
            'Codex CLI を利用するには環境変数 OPENAI_API_KEY または CODEX_API_KEY を設定してください。'
        };
      }

      return {
        env: {
          OPENAI_API_KEY: apiKey,
          CODEX_API_KEY: apiKey
        }
      };
    }
  },
  gemini: {
    displayName: 'Google Gemini',
    command: process.platform === 'win32' ? 'gemini.cmd' : 'gemini',
    async prepare() {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        return {
          error:
            'Gemini CLI を利用するには環境変数 GEMINI_API_KEY または GOOGLE_API_KEY を設定してください。'
        };
      }

      return {
        env: {
          GEMINI_API_KEY: apiKey,
          GOOGLE_API_KEY: apiKey
        }
      };
    }
  }
};

module.exports = (io) => {
  io.on('connection', async (socket) => {
    const { projectId, token } = socket.handshake.query;

    if (!projectId) {
      socket.emit('claude_error', { message: 'Project ID is required' });
      socket.disconnect();
      return;
    }

    if (!token) {
      socket.emit('claude_error', { message: 'Authentication required' });
      socket.disconnect();
      return;
    }

    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded?.id;
    } catch (error) {
      socket.emit('claude_error', { message: 'Invalid authentication token' });
      socket.disconnect();
      return;
    }

    if (!userId) {
      socket.emit('claude_error', { message: 'Invalid user information' });
      socket.disconnect();
      return;
    }

    let projectRecord;
    try {
      // Check if user is owner or member
      const [projects] = await db.execute(
        `SELECT p.id FROM projects p
         LEFT JOIN project_members pm ON p.id = pm.project_id
         WHERE p.id = ? AND (p.user_id = ? OR pm.user_id = ?)
         LIMIT 1`,
        [projectId, userId, userId]
      );
      if (projects.length === 0) {
        socket.emit('claude_error', { message: 'Project not found or access denied' });
        socket.disconnect();
        return;
      }
      projectRecord = projects[0];
    } catch (projectError) {
      socket.emit('claude_error', { message: 'Failed to verify project access' });
      socket.disconnect();
      return;
    }

    let userInfo = { name: 'WebIDE User', email: 'webide@example.com' };
    try {
      const [userRows] = await db.execute(
        'SELECT name, email FROM users WHERE id = ?',
        [userId]
      );
      if (userRows.length > 0) {
        userInfo = userRows[0];
      }
    } catch (userError) {
      // User info is optional for commits
    }

    // Create project workspace directory
    const homeDir = await ensureUserRoot({ id: userId, email: userInfo.email });
    const workspaceDir = await resolveExistingProjectPath(
      { id: userId, email: userInfo.email },
      projectId,
      db
    );
    await fs.mkdir(workspaceDir, { recursive: true });

    const requestedProvider = (socket.handshake.query?.provider || 'claude').toString().toLowerCase();
    let providerKey = requestedProvider;
    if (!PROVIDERS[providerKey]) {
      socket.emit(
        'output',
        `\r\n⚠️ 未対応の CLI プロバイダ「${requestedProvider}」が指定されたため、Claude Code を利用します。\r\n`
      );
      providerKey = 'claude';
    }

    const providerConfig = PROVIDERS[providerKey];

    let preparation;
    try {
      preparation = await providerConfig.prepare({ workspaceDir, homeDir });
    } catch (prepError) {
      socket.emit(
        'output',
        `\r\n❌ ${providerConfig.displayName} の準備に失敗しました。サーバー管理者にお問い合わせください。\r\n`
      );
      socket.disconnect();
      return;
    }

    if (preparation?.error) {
      socket.emit(
        'output',
        `\r\n❌ ${preparation.error}\r\n別のプロバイダを選択するか、環境変数を設定してから再試行してください。\r\n`
      );
      return;
    }

    const providerEnv = preparation?.env || {};

    let ptyProcess;
    let autoApprovalHandled = false;
    let codexApiKeyInputPending = false;
    let codexOutputBuffer = '';
    let claudeAuthCodeInputPending = false;
    let claudeAuthCodeBuffer = '';
    let claudeApiKeyConfirmPending = false;
    let claudeApiKeyConfirmBuffer = '';
    let claudeLoginSuccessful = false;
    try {
      // Spawn the selected AI CLI directly so no other commands can execute
      ptyProcess = pty.spawn(providerConfig.command, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: workspaceDir,
        env: {
          ...process.env,
          HOME: homeDir,
          PWD: workspaceDir,
          XDG_CONFIG_HOME: path.join(homeDir, '.config'),
          AI_TERMINAL_PROVIDER: providerKey,
          ...providerEnv
        }
      });
    } catch (spawnError) {
      let errorMessage = `\r\n❌ ${providerConfig.displayName} CLI を起動できませんでした。サーバー管理者にお問い合わせください。\r\n`;

      if (spawnError.code === 'ENOENT' || /ENOENT/.test(spawnError.message)) {
        errorMessage = `\r\n❌ ${providerConfig.displayName} CLI コマンド \"${providerConfig.command}\" が見つかりません。\r\n` +
          'CLI をサーバーにインストールするか、別のプロバイダを選択してください。\r\n';
      }

      socket.emit('output', `${errorMessage}\r\n別のプロバイダを選択するか、環境を確認してから再試行してください。\r\n`);
      return;
    }

    terminals[socket.id] = ptyProcess;
    inputBuffers[socket.id] = '';
    const projectRoom = `${userId}:${projectId}`;
    socket.join(projectRoom);
    const gitManager = new GitManager(workspaceDir);

    const sessionKey = socket.id;
    const initialState = ensureSessionState(sessionKey, providerConfig.displayName);
    initialState.provider = providerConfig.displayName;

    // Dispose existing monitors when switching providers
    console.log(`[Socket Connection] Disposing existing monitors before starting ${providerKey}`);
    await disposeClaudeLogMonitor(sessionKey);
    await disposeCodexLogMonitor(sessionKey);
    await disposeGeminiLogMonitor(sessionKey);

    if (providerKey === 'claude') {
      try {
        console.log('[Socket Connection] Initializing Claude log monitor...');
        const handshakeDebounceMs = Number.parseInt(socket.handshake.query?.claudeDebounceMs ?? '', 10);
        const effectiveDebounceMs = Number.isFinite(handshakeDebounceMs) && handshakeDebounceMs >= 0
          ? handshakeDebounceMs
          : undefined;
        const monitor = await setupClaudeLogMonitor({
          homeDir,
          workspaceDir,
          sessionKey,
          finalizeSession,
          socket,
          debounceMs: effectiveDebounceMs
        });
        if (monitor) {
          claudeLogMonitors[sessionKey] = monitor;
          console.log(`[Socket Connection] Claude log monitor initialized for session: ${sessionKey}`);
        } else {
          console.warn('[Socket Connection] Claude log monitor setup returned null');
        }
      } catch (monitorError) {
        console.error('[Socket Connection] Failed to initialize Claude log monitor:', monitorError);
      }
    } else if (providerKey === 'codex') {
      try {
        const handshakeDebounceMs = Number.parseInt(socket.handshake.query?.codexDebounceMs ?? '', 10);
        const effectiveDebounceMs = Number.isFinite(handshakeDebounceMs) && handshakeDebounceMs >= 0
          ? handshakeDebounceMs
          : undefined;
        const monitor = await setupCodexLogMonitor({
          homeDir,
          workspaceDir,
          sessionKey,
          finalizeSession,
          socket,
          debounceMs: effectiveDebounceMs
        });
        if (monitor) {
          codexLogMonitors[sessionKey] = monitor;
        }
      } catch (monitorError) {
        console.error('Failed to initialize Codex log monitor:', monitorError);
      }
    } else if (providerKey === 'gemini') {
      try {
        const turnIdleMs = parseDurationPreference({
          ms: socket.handshake.query?.geminiTurnIdleMs,
          s: socket.handshake.query?.geminiTurnIdleS,
          defaultValue: DEFAULT_GEMINI_TURN_IDLE_MS
        });
        const sessionIdleMs = parseDurationPreference({
          ms: socket.handshake.query?.geminiSessionIdleMs,
          s: socket.handshake.query?.geminiSessionIdleS,
          defaultValue: DEFAULT_GEMINI_SESSION_IDLE_MS
        });
        const monitor = await setupGeminiLogMonitor({
          homeDir,
          workspaceDir,
          sessionKey,
          finalizeSession,
          socket,
          turnIdleMs,
          sessionIdleMs,
          projectId,
          db
        });
        if (monitor) {
          geminiLogMonitors[sessionKey] = monitor;
        }
      } catch (monitorError) {
        console.error('Failed to initialize Gemini log monitor:', monitorError);
      }
    }

    // Handle PTY spawn event
    ptyProcess.on('spawn', () => {
      socket.emit('output', `\r\n✅ ${providerConfig.displayName} セッションを開始しました\r\n`);
      socket.emit('output', `📁 作業ディレクトリ: ${workspaceDir}\r\n`);
    });

    const projectKey = getProjectKey(userId, projectId);

    async function finalizeSession({ reason }) {
      console.log(`[finalizeSession] Called with reason: ${reason}, sessionKey: ${socket.id}`);
      const sessionKey = socket.id;
      const state = sessionState[sessionKey];
      if (!state) {
        console.log(`[finalizeSession] No state found for sessionKey: ${sessionKey}`);
        return;
      }

      console.log(`[finalizeSession] State found. Provider: ${state.provider}, awaitingApproval: ${state.awaitingApproval}`);

      if (state.awaitingApproval && !['exit', 'response-complete'].includes(reason)) {
        console.log(`[finalizeSession] Skipping due to awaiting approval`);
        return;
      }

      // Skip if already processing a commit to avoid race conditions
      // This must be checked and set BEFORE any await to be atomic
      if (state.isCommitting) {
        console.log(`[finalizeSession] Skipping - already processing a commit`);
        return;
      }
      state.isCommitting = true;

      if (state.awaitingApproval) {
        endApprovalWait(state);
      }

      // タイマーをクリア
      state.responsePending = false;

      // Claude / Codex / Gemini の場合、履歴ファイルから実際のプロンプトを抽出
      let promptTexts = [];

      if (providerKey === 'codex') {
        // For Codex, read from history.jsonl using the timestamp range of completed prompts (same as Claude)
        try {
          const historyPath = path.join(homeDir, '.codex', 'history.jsonl');
          const historyContent = await fs.readFile(historyPath, 'utf8');
          const lines = historyContent.trim().split('\n');

          // Use the timestamp range tracked by finalizePrompt
          const startTime = state.completedPromptStartTime;
          const endTime = state.completedPromptEndTime;

          if (startTime && endTime) {
            // Add tolerance for timestamp matching (5 seconds before start, 2 seconds after end)
            // Note: Codex uses seconds, not milliseconds
            const toleranceStart = (startTime - 5000) / 1000;
            const toleranceEnd = (endTime + 2000) / 1000;
            console.log(`[finalizeSession] Reading Codex history.jsonl from ${toleranceStart} (${startTime / 1000} - 5s) to ${toleranceEnd} (${endTime / 1000} + 2s)`);

            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                const timestamp = entry.ts; // Codex uses 'ts' in seconds
                const text = entry.text;

                // Only include prompts within the completed range (with tolerance)
                if (timestamp >= toleranceStart && timestamp <= toleranceEnd && text) {
                  console.log(`[finalizeSession] Found Codex prompt at ${timestamp}: "${text.substring(0, 50)}..."`);
                  promptTexts.push(text);
                }
              } catch (parseError) {
                // Skip invalid lines
              }
            }
          }

          // Reset the timestamp range after reading
          state.completedPromptStartTime = null;
          state.completedPromptEndTime = null;

          console.log(`[finalizeSession] Found ${promptTexts.length} prompts from Codex history.jsonl`);
        } catch (readError) {
          console.error('[finalizeSession] Failed to read Codex history.jsonl:', readError);
        }
      } else if (providerKey === 'claude') {
        // For Claude, read from history.jsonl using the timestamp range of completed prompts
        try {
          const historyPath = path.join(homeDir, '.config', 'claude', 'history.jsonl');
          const historyContent = await fs.readFile(historyPath, 'utf8');
          const lines = historyContent.trim().split('\n');

          // Use the timestamp range tracked by finalizePromptLog
          const startTime = state.completedPromptStartTime;
          const endTime = state.completedPromptEndTime;

          if (startTime && endTime) {
            // Add tolerance for timestamp matching (5 seconds before start, 2 seconds after end)
            const toleranceStart = startTime - 5000;
            const toleranceEnd = endTime + 2000;
            console.log(`[finalizeSession] Reading history.jsonl from ${toleranceStart} (${startTime} - 5s) to ${toleranceEnd} (${endTime} + 2s)`);

            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                const timestamp = entry.timestamp || entry.ts || entry.time || entry.created_at;
                const text = entry.display || entry.text || entry.prompt || entry.message || entry.content;

                // Only include prompts within the completed range (with tolerance)
                if (timestamp >= toleranceStart && timestamp <= toleranceEnd && text) {
                  console.log(`[finalizeSession] Found prompt at ${timestamp}: "${text.substring(0, 50)}..."`);
                  promptTexts.push(text);
                }
              } catch (parseError) {
                // Skip invalid lines
              }
            }
          }

          // Reset the timestamp range after reading
          state.completedPromptStartTime = null;
          state.completedPromptEndTime = null;

          console.log(`[finalizeSession] Found ${promptTexts.length} prompts from history.jsonl`);
        } catch (readError) {
          console.error('[finalizeSession] Failed to read history.jsonl:', readError);
        }
      } else if (providerKey === 'gemini') {
        // For Gemini, read from logs.json (user prompts only) using the timestamp range of completed prompts (same as Claude/Codex)
        try {
          let logsPath = null;
          let hashFolder = null;

          // First, try to get hash folder from database (persistent mapping)
          hashFolder = await getGeminiHashFolder(projectId, db);

          // If not in database, try to get from current monitor session
          if (!hashFolder) {
            const monitor = geminiLogMonitors[sessionKey];
            if (monitor && monitor.currentFilePath) {
              // Extract hash from currentFilePath: /path/.gemini/tmp/{hash}/chats/session-*.json
              const match = monitor.currentFilePath.match(/\.gemini\/tmp\/([^\/]+)\//);
              if (match && match[1]) {
                hashFolder = match[1];
                console.log(`[finalizeSession] Using Gemini hash folder from monitor: ${hashFolder}`);
              }
            }
          } else {
            console.log(`[finalizeSession] Using Gemini hash folder from database: ${hashFolder}`);
          }

          if (hashFolder) {
            logsPath = path.join(homeDir, '.gemini', 'tmp', hashFolder, 'logs.json');
          } else {
            console.log(`[finalizeSession] No Gemini hash folder found for project ${projectId}`);
          }

          if (logsPath) {
            try {
              await fs.access(logsPath);
              console.log(`[finalizeSession] Reading Gemini logs.json: ${logsPath}`);
              const logsContent = await fs.readFile(logsPath, 'utf8');
              const logs = JSON.parse(logsContent);

              // Use the timestamp range tracked by finalizeTurn
              const startTime = state.completedPromptStartTime;
              const endTime = state.completedPromptEndTime;

              if (startTime && endTime) {
                // Add tolerance for timestamp matching (5 seconds before start, 2 seconds after end)
                const toleranceStart = startTime - 5000;
                const toleranceEnd = endTime + 2000;
                console.log(`[finalizeSession] Reading Gemini logs.json from ${toleranceStart} (${startTime} - 5s) to ${toleranceEnd} (${endTime} + 2s)`);

                // logs.json is an array of user prompts
                if (Array.isArray(logs)) {
                  for (const entry of logs) {
                    if (entry.type === 'user' && entry.message) {
                      const entryTimestamp = new Date(entry.timestamp).getTime();

                      // Only include prompts within the completed range (with tolerance)
                      if (entryTimestamp >= toleranceStart && entryTimestamp <= toleranceEnd) {
                        console.log(`[finalizeSession] Found Gemini prompt at ${entryTimestamp}: "${entry.message.substring(0, 50)}..."`);
                        promptTexts.push(entry.message);
                      }
                    }
                  }
                }
              }

              // Reset the timestamp range after reading
              state.completedPromptStartTime = null;
              state.completedPromptEndTime = null;

              console.log(`[finalizeSession] Found ${promptTexts.length} prompts from Gemini logs.json`);
            } catch (accessError) {
              console.log(`[finalizeSession] Cannot access Gemini logs.json: ${logsPath}`);
            }
          } else {
            console.log(`[finalizeSession] No Gemini monitor or currentFilePath available`);
          }
        } catch (readError) {
          console.error('[finalizeSession] Failed to read Gemini logs.json:', readError);
        }
      }

      // actualDurationMsが設定されていればそれを使用（2秒の待機時間を引いた正確な時間）
      // 設定されていなければ従来通りの計算
      let durationMs = state.actualDurationMs !== null && state.actualDurationMs !== undefined
        ? state.actualDurationMs
        : (state.prompts?.[state.prompts.length - 1]
          ? Math.max(0, Date.now() - (state.prompts[state.prompts.length - 1].startedAt || state.startTime))
          : null);

      if (typeof durationMs === 'number') {
        const approvalWaitMs = state.totalApprovalWaitMs || 0;
        if (approvalWaitMs > 0) {
          durationMs = Math.max(0, durationMs - approvalWaitMs);
        }
      }
      state.totalApprovalWaitMs = 0;
      state.approvalWaitStartTime = null;

      // プロンプトログをデータベースに保存
      // すべてのプロバイダ（Claude / Codex / Gemini）で履歴ファイルから取得したプロンプトを保存
      if (promptTexts.length > 0) {
        for (const promptText of promptTexts) {
          try {
            await db.execute(
              'INSERT INTO claude_prompt_logs (project_id, user_id, prompt, duration_ms) VALUES (?, ?, ?, ?)',
              [projectId, userId, promptText, durationMs]
            );
          } catch (logError) {
            // Silent failure - prompt log is not critical
          }
        }
      }

      // remove processed prompts from current session buffer
      state.prompts = [];
      state.startTime = Date.now();
      state.lastPromptStartedAt = null;

      const existingPending = pendingPromptsByProject[projectKey] || [];

      // Current prompts from this finalization
      const currentPrompts = promptTexts.length > 0 ? promptTexts : [];

      if (currentPrompts.length > 0) {
        const providerName = state.provider || providerConfig.displayName;
        // Commit message includes: pending prompts + current prompts
        const promptsForCommit = existingPending.concat(currentPrompts);

        const runWithIndexLockRetry = async (operation) => {
          try {
            return await operation();
          } catch (error) {
            if (/index\.lock/.test(error.message || '')) {
              try {
                await gitManager.clearIndexLock();
              } catch (lockError) {
                console.error('Lock cleanup failed:', lockError);
              }
              return await operation();
            }
            throw error;
          }
        };

        try {
          const isGitInitialized = await gitManager.isInitialized();
          console.log(`[finalizeSession] Git initialized: ${isGitInitialized}, gitManager.projectPath: ${gitManager.projectPath}`);

          if (isGitInitialized) {
            try {
              const status = await gitManager.getStatus();
              console.log(`[finalizeSession] Git status:`, JSON.stringify(status, null, 2));

            if (!status?.hasChanges) {
              console.log(`[finalizeSession] No changes detected, accumulating current prompts to pending`);
              // Add current prompts to pending (accumulate)
              pendingPromptsByProject[projectKey] = existingPending.concat(currentPrompts);
              socket.emit('commit_notification', {
                status: 'info',
                provider: providerName,
                count: currentPrompts.length,
                durationMs,
                message: 'コード差分が無かったためコミットは保留されました。次回の変更時にまとめてコミットします。'
              });
              return;
            }

            await runWithIndexLockRetry(() => gitManager.addFile('.'));
            const commitMessage = buildCommitMessage(promptsForCommit, providerName);
            console.log(`[finalizeSession] Committing with ${existingPending.length} pending + ${currentPrompts.length} current prompts`);

            const commitResult = await runWithIndexLockRetry(() => gitManager.commit(
              commitMessage,
              userInfo.name || 'WebIDE User',
              userInfo.email || 'webide@example.com'
            ));

            if (commitResult.success) {
              console.log(`[finalizeSession] Commit successful! Hash: ${commitResult.commitHash}`);
              commitPromptStore[commitResult.commitHash] = {
                projectId,
                prompts: promptsForCommit.slice()
              };
              // Clear pending prompts after successful commit
              delete pendingPromptsByProject[projectKey];
              const durationLabel = typeof durationMs === 'number'
                ? formatDuration(durationMs)
                : '前回保留分';
              console.log(`[finalizeSession] Emitting commit_notification (success) and save_complete`);
              socket.emit('commit_notification', {
                status: 'success',
                provider: providerName,
                count: promptsForCommit.length,
                durationMs,
                message: `トリップコードへコミットしました (${promptsForCommit.length}件, ${durationLabel})`
              });
              socket.emit('save_complete', {
                message: '保存が完了しました',
                timestamp: new Date().toISOString()
              });
            } else {
              const noChanges = /no changes/i.test(commitResult.message || '');
              pendingPromptsByProject[projectKey] = promptsForCommit;
              socket.emit('commit_notification', {
                status: noChanges ? 'info' : 'warning',
                provider: providerName,
                count: promptsForCommit.length,
                durationMs,
                message: noChanges
                  ? '変更がなかったためコミットは保留されました。次回の変更時にまとめてコミットします。'
                  : `コミットをスキップしました: ${commitResult.message}`
              });
            }
          } catch (gitError) {
            if (/nothing to commit/i.test(gitError.message || '')) {
              pendingPromptsByProject[projectKey] = promptsForCommit;
              socket.emit('commit_notification', {
                status: 'info',
                provider: providerName,
                count: promptsForCommit.length,
                durationMs,
                message: '変更がなかったためコミットは保留されました。次回の変更時にまとめてコミットします。'
              });
            } else {
            pendingPromptsByProject[projectKey] = promptsForCommit;
            socket.emit('commit_notification', {
              status: 'error',
              provider: providerName,
              count: promptsForCommit.length,
              durationMs,
              message: `コミットに失敗しました: ${gitError.message}`
            });
            }
          }
        } else {
          pendingPromptsByProject[projectKey] = promptsForCommit;
          socket.emit('commit_notification', {
            status: 'info',
            provider: providerName,
            count: promptsForCommit.length,
            durationMs,
            message: 'トリップコードが未初期化のため、プロンプトを保留しました'
          });
        }
        } finally {
          // Clear the committing flag
          state.isCommitting = false;
        }
      } else {
        // No prompts to commit, clear the flag
        state.isCommitting = false;
      }

      delete sessionState[sessionKey];
    }

    let sessionClosed = false;
    const handleProcessExit = async (code, signal) => {
      if (sessionClosed) {
        return;
      }
      sessionClosed = true;

      try {
        await finalizeSession({ reason: 'exit' });
      } catch (finalizeError) {
        socket.emit(
          'output',
          `\r\n⚠️ セッション後処理に失敗しました: ${finalizeError.message}\r\n`
        );
      } finally {
        if (terminals[socket.id] === ptyProcess) {
          delete terminals[socket.id];
        }
        if (inputBuffers[socket.id]) {
          delete inputBuffers[socket.id];
        }
        await disposeClaudeLogMonitor(sessionKey);
        await disposeCodexLogMonitor(sessionKey);
        await disposeGeminiLogMonitor(sessionKey);
      }

      const reasonParts = [];
      if (typeof code === 'number') {
        reasonParts.push(`code ${code}`);
      }
      if (signal) {
        reasonParts.push(`signal ${signal}`);
      }
      if (reasonParts.length > 0) {
        socket.emit('output', `\r\n⚠️ セッションが終了しました (${reasonParts.join(', ')})\r\n`);
      }
    };

    // Handle PTY data output
    ptyProcess.on('data', (data) => {
      const rawText = data.toString();
      const lowerText = rawText.toLowerCase();
      const state = sessionState[socket.id];

      // Claude Code auth code detection
      if (providerKey === 'claude') {
        if (lowerText.includes('paste code here if prompted')) {
          claudeAuthCodeInputPending = true;
          claudeAuthCodeBuffer = rawText;
          socket.emit('output', rawText);
          return;
        }

        if (claudeAuthCodeInputPending) {
          claudeAuthCodeBuffer += rawText;

          // ANSIエスケープシーケンスを削除してから検索
          const cleanBuffer = claudeAuthCodeBuffer.replace(/\x1b\[[0-9;]*m/g, '');
          const bufferLower = cleanBuffer.toLowerCase();

          // 認証完了を検知: "Login successful. Press Enter to continue…"
          if (bufferLower.includes('login successful') && bufferLower.includes('press enter')) {
            claudeAuthCodeInputPending = false;
            claudeAuthCodeBuffer = '';
            claudeLoginSuccessful = true;
          }
          socket.emit('output', rawText);
          return;
        }

        // APIキー確認画面を検知（Login successful後のEnter入力後）
        if (claudeLoginSuccessful && lowerText.includes('detected a custom api key')) {
          claudeApiKeyConfirmPending = true;
          claudeLoginSuccessful = false;

          // 「1」を入力（選択完了）
          setTimeout(() => {
            ptyProcess.write('1');

            // 「1」入力後、少し待ってからClaude Code CLIを再起動
            setTimeout(() => {
              // 現在のプロセスを終了
              try {
                ptyProcess.kill();
              } catch (killError) {
                // Process kill failed - will be handled by spawn
              }

              // 新しいプロセスを起動
              setTimeout(() => {
                try {
                  const newPtyProcess = pty.spawn(providerConfig.command, [], {
                    name: 'xterm-color',
                    cols: 80,
                    rows: 30,
                    cwd: workspaceDir,
                    env: {
                      ...process.env,
                      HOME: homeDir,
                      PWD: workspaceDir,
                      XDG_CONFIG_HOME: path.join(homeDir, '.config'),
                      AI_TERMINAL_PROVIDER: providerKey,
                      ...providerEnv
                    }
                  });

                  terminals[socket.id] = newPtyProcess;
                  ptyProcess = newPtyProcess;

                  // イベントハンドラを再設定
                  newPtyProcess.on('spawn', () => {
                    socket.emit('output', `\r\n✅ ${providerConfig.displayName} セッションを再起動しました\r\n`);
                  });

                  newPtyProcess.on('data', (data) => {
                    socket.emit('output', data.toString());
                  });

                  newPtyProcess.on('exit', handleProcessExit);
                  newPtyProcess.on('close', handleProcessExit);

                  claudeApiKeyConfirmPending = false;
                } catch (restartError) {
                  socket.emit('output', '\r\n❌ Claude Code CLIの再起動に失敗しました\r\n');
                }
              }, 500);
            }, 1000);
          }, 300);
        }
      }

      // Codex API key input detection and auto-fill
      if (providerKey === 'codex') {
        if (lowerText.includes('use your own openai api key for usage-based billing')) {
          codexApiKeyInputPending = true;
          codexOutputBuffer = rawText;

          if (!autoApprovalHandled) {
            setTimeout(() => {
              ptyProcess.write('\r');
            }, 200);
            autoApprovalHandled = true;
          }

          return;
        }

        if (codexApiKeyInputPending) {
          codexOutputBuffer += rawText;

          if (lowerText.includes('api key configured') ||
              lowerText.includes('what can i help')) {

            let cleanedOutput = codexOutputBuffer;
            cleanedOutput = cleanedOutput.replace(/╭[^\╯]*╯/gs, '');
            cleanedOutput = cleanedOutput.replace(/Paste or type your API key[^\n]*\n?/gi, '');
            cleanedOutput = cleanedOutput.replace(/It will be stored locally[^\n]*\n?/gi, '');
            cleanedOutput = cleanedOutput.replace(/sk-[A-Za-z0-9_\-]{20,}/g, '');
            cleanedOutput = cleanedOutput.replace(/[╭╮╰╯│─]+/g, '');
            cleanedOutput = cleanedOutput.replace(/\n{3,}/g, '\n\n');

            codexApiKeyInputPending = false;
            codexOutputBuffer = '';

            socket.emit('output', cleanedOutput);
            return;
          }

          return;
        }
      }

      socket.emit('output', rawText);

      // Approval detection (state must exist)
      if (state) {
        // ANSIエスケープシーケンスを削除してからチェック
        const cleanText = rawText.replace(/\x1b\[[0-9;]*m/g, '');
        const cleanLower = cleanText.toLowerCase();

        const approvalPatterns = [
          'allow command?',
          'approval required',
          'always approve this session',
          'always yes',
          'use arrow keys',
          'select an option',
          'waiting for user confirmation',
          '1. yes',
          '2. yes, allow all edits',
          '3. no, and tell claude'
        ];

        const normalizedChoicePrefix = cleanText.replace(/^[^\x1b]*\x1b\[[0-9;]*m/g, '').trim();
        const patternMatched = approvalPatterns.some(pattern => cleanLower.includes(pattern));
        const choiceMatched = normalizedChoicePrefix.startsWith('│ ❯ 1. yes') || normalizedChoicePrefix.startsWith('│   1. yes');

        if (patternMatched || choiceMatched) {
          beginApprovalWait(state);
          return;
        }

        if (state.awaitingApproval && /press enter/.test(cleanLower)) {
          endApprovalWait(state);
          state.responsePending = true;
          return;
        }
      }
    });

    ptyProcess.on('exit', handleProcessExit);
    ptyProcess.on('close', handleProcessExit);

    // Handle user input
    socket.on('input', async (data) => {
      if (terminals[socket.id]) {
        terminals[socket.id].write(data);
      }

      if (!terminals[socket.id]) {
        return;
      }

      const sessionKey = socket.id;
      const currentState = ensureSessionState(sessionKey, providerConfig.displayName);
      currentState.provider = providerConfig.displayName;

      const stringData = data.toString();
      if (!inputBuffers[socket.id]) {
        inputBuffers[socket.id] = '';
      }
      inputBuffers[socket.id] += stringData;

      if (currentState.awaitingApproval && stringData.includes('\r')) {
        endApprovalWait(currentState);
        currentState.responsePending = true;
      }

      const containsCR = stringData.includes('\r');
      const containsLF = stringData.includes('\n');

      if (containsCR || containsLF) {
        const segments = inputBuffers[socket.id].split(/\r?\n|\r/);
        inputBuffers[socket.id] = segments.pop();
        for (const segment of segments) {
          const state = ensureSessionState(sessionKey, providerConfig.displayName);
          let cleaned = normalizeTerminalInput(segment);

          if (cleaned.length === 0) {
            if (state.awaitingApproval) {
              endApprovalWait(state);
              state.responsePending = true;
            }
            continue;
          }

          if (/^\[\?[0-9;]*[A-Za-z]/.test(cleaned)) {
            cleaned = cleaned.replace(/^\[\?[0-9;]*[A-Za-z]/, '');
          }

          cleaned = cleaned.trimStart();

          if (cleaned.length === 0) {
            continue;
          }

          const isDeviceAttrResponse = /^\[\?[0-9;]*[A-Za-z]$/.test(cleaned);
          const isArrowKey = cleaned.length === 1 && ['A', 'B', 'C', 'D'].includes(cleaned);
          const isArrowLabel = /^(?:←|↑|→|↓)$/.test(cleaned);
          const hasMeaningfulContent = /[A-Za-z0-9\u3000-\u303F\u3040-\u30FF\u31F0-\u31FF\u4E00-\u9FFF]/.test(cleaned);

          if (isDeviceAttrResponse || isArrowKey || isArrowLabel || !hasMeaningfulContent) {
            continue;
          }

          const nowTs = Date.now();
          if (state.prompts.length === 0) {
            state.startTime = nowTs;
          }
          const normalizedText = cleaned.trim().toLowerCase();
          const approvalResponses = new Set([
            'y', 'yes', 'n', 'no', 'a', 'always', 'always yes',
            '1', '2', '3', 'cancel', 'esc', 'shift+tab'
          ]);

          if (state.awaitingApproval && approvalResponses.has(normalizedText)) {
            endApprovalWait(state);
            continue;
          }

          // Claude認証コード入力中はプロンプトとして記録しない
          if (providerKey === 'claude' && claudeAuthCodeInputPending) {
            continue;
          }

          // Codex API key入力中はプロンプトとして記録しない
          if (providerKey === 'codex' && codexApiKeyInputPending) {
            continue;
          }

          // 意味のある内容がない場合（空文字列や数字のみ）はプロンプトとして記録しない
          if (cleaned.length === 0 || /^[0-9\s]+$/.test(cleaned)) {
            continue;
          }

          state.prompts.push({
            id: randomUUID(),
            text: cleaned,
            startedAt: nowTs
          });
          state.responsePending = true;
          state.provider = providerConfig.displayName;
          state.lastPromptAt = nowTs;
        }
      }
    });

    // Handle terminal resize
    socket.on('resize', (size) => {
      const terminalInstance = terminals[socket.id];
      if (!terminalInstance) {
        return;
      }
      try {
        terminalInstance.resize(size.cols, size.rows);
      } catch (resizeError) {
        socket.emit('output', '\r\n⚠️ ターミナルのサイズ変更に失敗しました。セッションを再接続してください。\r\n');
      }
    });

    socket.on('terminate_session', () => {
      if (!ptyProcess) {
        return;
      }
      try {
        ptyProcess.kill();
      } catch (terminateError) {
        // Process termination failed - already dead or zombie
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      if (terminals[socket.id]) {
        try {
          terminals[socket.id].kill();
        } catch (killError) {
          // Process termination failed - already dead or zombie
        }
        delete terminals[socket.id];
      }
      if (inputBuffers[socket.id]) {
        delete inputBuffers[socket.id];
      }
      disposeClaudeLogMonitor(socket.id).catch((error) => {
        console.error('Failed to dispose Claude monitor on disconnect:', error);
      });
      disposeCodexLogMonitor(socket.id).catch((error) => {
        console.error('Failed to dispose Codex monitor on disconnect:', error);
      });
      disposeGeminiLogMonitor(socket.id).catch((error) => {
        console.error('Failed to dispose Gemini monitor on disconnect:', error);
      });
    });
  });
};

// Helper function retained for backwards compatibility in case other modules import it
async function checkClaudeAvailability() {
  return new Promise((resolve) => {
    const testProcess = spawn('claude', ['--version'], {
      stdio: 'pipe',
      shell: true
    });

    testProcess.on('close', (code) => {
      resolve(code === 0);
    });

    testProcess.on('error', () => {
      resolve(false);
    });

    setTimeout(() => {
      testProcess.kill();
      resolve(false);
    }, 3000);
  });
}

module.exports.commitPromptStore = commitPromptStore;
