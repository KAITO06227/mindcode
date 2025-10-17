const path = require('path');
const fs = require('fs').promises;
const {
  parseTimestamp,
  getRootUserUuid,
  entryHasToolUse,
  entryContainsToolResult,
  extractAssistantText,
  getStopReason
} = require('./utils');

const LOG_POLL_INTERVAL_MS = 250;
const CLAUDE_LOG_POLL_INTERVAL_MS = LOG_POLL_INTERVAL_MS;
const DEFAULT_CLAUDE_TEXT_DEBOUNCE_MS = (() => {
  const parsed = Number.parseInt(process.env.CLAUDE_TEXT_DEBOUNCE_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 800;
})();

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

async function setupClaudeLogMonitor({
  homeDir,
  workspaceDir,
  sessionKey,
  finalizeSession,
  socket,
  debounceMs,
  sessionState
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
  ,
    debugRoot: path.join(homeDir, '.config', 'claude', 'debug'),
    debugFilePath: null,
    debugFileHandle: null,
    debugFileOffset: 0,
    debugBuffer: ''
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

  async function closeDebugLog() {
    if (monitor.debugFileHandle) {
      try {
        await monitor.debugFileHandle.close();
      } catch {
        // ignore close errors
      }
    }
    monitor.debugFileHandle = null;
    monitor.debugFilePath = null;
    monitor.debugFileOffset = 0;
    monitor.debugBuffer = '';
  }

  async function ensureDebugLog() {
    if (!monitor.activeSessionId) {
      await closeDebugLog();
      return false;
    }

    const expectedPath = path.join(monitor.debugRoot, `${monitor.activeSessionId}.txt`);
    if (monitor.debugFilePath === expectedPath && monitor.debugFileHandle) {
      return true;
    }

    await closeDebugLog();

    try {
      const fileHandle = await fs.open(expectedPath, 'r');
      monitor.debugFileHandle = fileHandle;
      monitor.debugFilePath = expectedPath;
      try {
        const stats = await fs.stat(expectedPath);
        monitor.debugFileOffset = stats.size;
      } catch {
        monitor.debugFileOffset = 0;
      }
      monitor.debugBuffer = '';
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[Claude Monitor] Failed to open debug log:', error);
      }
      monitor.debugFileHandle = null;
      monitor.debugFilePath = null;
      monitor.debugFileOffset = 0;
      monitor.debugBuffer = '';
      return false;
    }
  }

  function finalizePromptLogsFromDebug() {
    let finalized = false;
    for (const promptLog of monitor.promptLogs.values()) {
      if (promptLog.completed) {
        continue;
      }
      if (!promptLog.latestTextEntry && promptLog.status !== 'text_ready') {
        continue;
      }
      if (promptLog.status !== 'completed_by_debug_stop') {
        promptLog.status = 'completed_by_debug_stop';
      }
      finalizePromptLog(promptLog);
      finalized = true;
    }
    return finalized;
  }

  function processDebugLine(line) {
    if (!line) {
      return;
    }
    if (line.includes('SubagentStop')) {
      return;
    }

    const isStopHook = line.includes('Getting matching hook commands for Stop') ||
                        line.includes('Executing hooks for Stop');

    if (!isStopHook) {
      return;
    }

    const finalized = finalizePromptLogsFromDebug();
    if (!finalized) {
      console.log('[Claude Monitor] Stop hook detected but no pending prompt to finalize');
    }
  }

  async function pollDebugLog() {
    if (!monitor.activeSessionId) {
      await closeDebugLog();
      return;
    }

    const ready = await ensureDebugLog();
    if (!ready || !monitor.debugFilePath || !monitor.debugFileHandle) {
      return;
    }

    let stats;
    try {
      stats = await fs.stat(monitor.debugFilePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await closeDebugLog();
        return;
      }
      console.error('[Claude Monitor] Failed to stat debug log:', error);
      return;
    }

    if (!stats || stats.size <= monitor.debugFileOffset) {
      return;
    }

    const chunkSize = stats.size - monitor.debugFileOffset;
    const buffer = Buffer.allocUnsafe(chunkSize);
    let bytesRead = 0;
    try {
      const result = await monitor.debugFileHandle.read(buffer, 0, chunkSize, monitor.debugFileOffset);
      bytesRead = result.bytesRead;
    } catch (error) {
      console.error('[Claude Monitor] Failed to read debug log:', error);
      return;
    }

    if (bytesRead <= 0) {
      return;
    }

    monitor.debugFileOffset += bytesRead;
    monitor.debugBuffer += buffer.slice(0, bytesRead).toString('utf8');

    let newlineIndex = monitor.debugBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const rawLine = monitor.debugBuffer.slice(0, newlineIndex);
      const line = rawLine.trim();
      monitor.debugBuffer = monitor.debugBuffer.slice(newlineIndex + 1);
      processDebugLine(line);
      newlineIndex = monitor.debugBuffer.indexOf('\n');
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

  function deriveSessionIdFromFile(pathname) {
    if (!pathname) {
      return null;
    }
    const base = path.basename(pathname, '.jsonl');
    if (!base || base.length < 30) {
      return null;
    }
    return base;
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
    await closeDebugLog();
    monitor.currentFilePath = latestPath;
    const derivedId = deriveSessionIdFromFile(latestPath);
    if (derivedId) {
      monitor.activeSessionId = derivedId;
    }
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
      await ensureDebugLog();
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
      await ensureDebugLog();
      await pollDebugLog();
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
      await ensureDebugLog();
      await pollDebugLog();
      return;
    }

    if (!stats || stats.size === monitor.fileOffset) {
      // No new data to read
      await ensureDebugLog();
      await pollDebugLog();
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
        await ensureDebugLog();
        await pollDebugLog();
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
      await ensureDebugLog();
      await pollDebugLog();
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

    await ensureDebugLog();
    await pollDebugLog();
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
    await closeDebugLog();
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

async function disposeClaudeLogMonitor(monitor) {
  if (!monitor) {
    return;
  }
  try {
    await monitor.dispose();
  } catch (disposeError) {
    console.error('Failed to dispose Claude log monitor:', disposeError);
  }
}

module.exports = { setupClaudeLogMonitor, disposeClaudeLogMonitor };
