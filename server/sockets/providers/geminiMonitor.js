const path = require('path');
const fs = require('fs').promises;
const { randomUUID } = require('crypto');
const {
  parseDurationPreference,
  extractUniquePromptTexts,
  parseTimestamp
} = require('./utils');

const LOG_POLL_INTERVAL_MS = 250;
const GEMINI_LOG_POLL_INTERVAL_MS = LOG_POLL_INTERVAL_MS;
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

async function setupGeminiLogMonitor({
  homeDir,
  workspaceDir,
  sessionKey,
  finalizeSession,
  socket,
  turnIdleMs,
  sessionIdleMs,
  projectId,
  db,
  sessionState
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
    sessionStartTime: Date.now(), // Track session start time to filter old files
    messageStates: new Map()
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
    monitor.messageStates.clear();

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

    monitor.messageStates.clear();

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

  function updateGeminiResponse(message, messageIndex) {
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

    const messageKey = typeof message?.id === 'string' && message.id.length > 0
      ? `id:${message.id}`
      : `index:${messageIndex}`;

    const previousState = monitor.messageStates.get(messageKey);
    const hasTokens = !!(message?.tokens && typeof message.tokens === 'object');
    const hasModel = typeof message?.model === 'string' && message.model.length > 0;
    const hasToolCalls = Array.isArray(message?.toolCalls) && message.toolCalls.length > 0;
    const isFinalPayload = hasTokens && hasModel && !hasToolCalls;

    const tokensPreviouslySeen = previousState?.hasTokens ?? false;
    const modelPreviouslySeen = previousState?.hasModel ?? false;
    const finalizedPreviously = previousState?.finalized ?? false;
    const sawTokensBeforeModel = (previousState?.seenTokensWithoutModel ?? false) || (hasTokens && !hasModel);

    monitor.messageStates.set(messageKey, {
      hasTokens,
      hasModel,
      finalized: finalizedPreviously,
      seenTokensWithoutModel: sawTokensBeforeModel
    });

    const newlyCompletedFromUpdate = isFinalPayload && !modelPreviouslySeen && (tokensPreviouslySeen || sawTokensBeforeModel);
    const newlyCompletedOnFirstObservation = isFinalPayload && !tokensPreviouslySeen && !modelPreviouslySeen && !finalizedPreviously;

    if (!finalizedPreviously && (newlyCompletedFromUpdate || newlyCompletedOnFirstObservation)) {
      monitor.messageStates.set(messageKey, {
        hasTokens,
        hasModel,
        finalized: true,
        seenTokensWithoutModel: sawTokensBeforeModel
      });
      finalizeActiveTurn('gemini-response-complete');
    }
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
        monitor.messageStates.clear();

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
      monitor.messageStates.clear();
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
      monitor.messageStates.clear();
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
        updateGeminiResponse(message, i);
      }

      const messageTs = parseTimestamp(message?.timestamp);
      monitor.lastActivityMs = Math.max(monitor.lastActivityMs, messageTs);
      monitor.lastFileUpdatedMs = Math.max(monitor.lastFileUpdatedMs, messageTs);
    }

    if (messages.length > 0) {
      if (monitor.lastProcessedIndex === messages.length - 1) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.type === 'gemini') {
          updateGeminiResponse(lastMessage, messages.length - 1);
        }
      }
      monitor.lastProcessedIndex = messages.length - 1;
    }

    // Don't finalize on turn-idle or session-idle - wait for next user prompt (same as Claude/Codex)
    // Only finalize on exit/dispose or next user prompt
    // session-idle is detected but doesn't trigger finalize anymore
  }

  monitor.dispose = async () => {
    monitor.disposed = true;
    monitor.messageStates.clear();
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

async function disposeGeminiLogMonitor(monitor) {
  if (!monitor) {
    return;
  }
  try {
    await monitor.dispose();
  } catch (disposeError) {
    console.error('Failed to dispose Gemini log monitor:', disposeError);
  }
}

module.exports = { 
  setupGeminiLogMonitor, 
  disposeGeminiLogMonitor, 
  saveGeminiHashFolder, 
  getGeminiHashFolder 
};
