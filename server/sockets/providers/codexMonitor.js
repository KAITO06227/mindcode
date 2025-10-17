const path = require('path');
const fs = require('fs').promises;
const { randomUUID } = require('crypto');
const {
  parseTimestamp,
  entryHasToolUse,
  entryContainsToolResult,
  extractAssistantText,
  getStopReason,
  deriveSessionIdFromFile
} = require('./utils');

const DEFAULT_CODEX_TEXT_DEBOUNCE_MS = (() => {
  const parsed = Number.parseInt(process.env.CODEX_TEXT_DEBOUNCE_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 800;
})();

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
  debounceMs,
  sessionState,
  logPollIntervalMs = 250
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
    fileCheckInterval: 5000, // Check for new files every 5 seconds
    debugRoot: path.join(homeDir, '.codex', 'debug'),
    debugFilePath: null,
    debugFileHandle: null,
    debugFileOffset: 0,
    debugBuffer: ''
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
    const entryTimestamp = parseTimestamp(entry.timestamp);
    prompt.lastEventTimestamp = entryTimestamp;
    const textValue = extractAssistantText(entry);
    const hasText = typeof textValue === 'string' && textValue.length > 0;

    if (hasText) {
      prompt.latestAssistantText = textValue;
      prompt.latestAssistantTimestamp = entryTimestamp;
      prompt.status = 'text_ready';
      monitor.lastActivityTs = Date.now();

      const payload = entry?.payload ?? {};
      const finalizeImmediately = payload.type === 'message' && payload.role === 'assistant';

      if (finalizeImmediately) {
        finalizePrompt(prompt);
        return;
      }

      const stopReason = getStopReason(entry);
      const shouldSkipDebounce = stopReason === 'end_turn' || stopReason === 'stop_sequence';
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
        console.error('[Codex Monitor] Failed to open debug log:', error);
      }
      monitor.debugFileHandle = null;
      monitor.debugFilePath = null;
      monitor.debugFileOffset = 0;
      monitor.debugBuffer = '';
      return false;
    }
  }

  async function reopenLatestFile() {
    const latestPath = await selectLatestSessionFile();
    if (!latestPath) {
      return false;
    }

    if (monitor.currentFilePath === latestPath && monitor.fileHandle) {
      if (!monitor.activeSessionId) {
        const derivedId = deriveSessionIdFromFile(latestPath);
        if (derivedId) {
          monitor.activeSessionId = derivedId;
        }
      }
      await ensureDebugLog();
      return true;
    }

    await closeFileHandle();
    monitor.currentFilePath = latestPath;
    monitor.fileOffset = 0;
    monitor.buffer = '';
    const derivedId = deriveSessionIdFromFile(latestPath);
    monitor.activeSessionId = derivedId || null;
    monitor.lastActivityTs = Date.now();
    expireStalePrompts('session-switch');
    monitor.promptQueue.length = 0;
    monitor.lastUserMessage = null;

    try {
      monitor.fileHandle = await fs.open(latestPath, 'r');
      await ensureDebugLog();
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
      closeDebugLog().catch(() => {});
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
    console.log(`[Codex Monitor] Disposing monitor, finalizing ${pending.length} pending prompts`);
    for (const prompt of pending) {
      console.log(`[Codex Monitor] Finalizing prompt: ${prompt.promptText?.substring(0, 50)}...`);
      finalizePrompt(prompt);
    }
    monitor.promptQueue.length = 0;
    monitor.lastUserMessage = null;
    await closeDebugLog();
    await closeFileHandle();
  };

  monitor.pollTimer = setInterval(() => {
    pollLog().catch((error) => {
      console.error('Codex log polling failed:', error);
    });
  }, logPollIntervalMs);

  return monitor;
}

async function disposeCodexLogMonitor(sessionKey, codexLogMonitors) {
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

module.exports = { setupCodexLogMonitor, disposeCodexLogMonitor };
