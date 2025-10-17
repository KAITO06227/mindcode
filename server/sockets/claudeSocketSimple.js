const pty = require('node-pty');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const jwt = require('jsonwebtoken');
const db = require('../database/connection');
const GitManager = require('../utils/gitManager');
const { ensureUserRoot, resolveExistingProjectPath } = require('../utils/userWorkspace');
const { randomUUID } = require('crypto');
const {
  parseDurationPreference,
  extractUniquePromptTexts
} = require('./providers/utils');
const { setupClaudeLogMonitor } = require('./providers/claudeMonitor');
const { setupCodexLogMonitor, disposeCodexLogMonitor } = require('./providers/codexMonitor');
const {
  setupGeminiLogMonitor,
  getGeminiHashFolder
} = require('./providers/geminiMonitor');

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

async function disposeGeminiLogMonitor(sessionKey) {
  const monitor = geminiLogMonitors[sessionKey];
  if (!monitor) {
    return;
  }
  delete geminiLogMonitors[sessionKey];

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
    await disposeCodexLogMonitor(sessionKey, codexLogMonitors);
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
          debounceMs: effectiveDebounceMs,
          sessionState,
          logPollIntervalMs: CLAUDE_LOG_POLL_INTERVAL_MS
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
          debounceMs: effectiveDebounceMs,
          sessionState,
          logPollIntervalMs: CODEX_LOG_POLL_INTERVAL_MS
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
          db,
          sessionState,
          logPollIntervalMs: GEMINI_LOG_POLL_INTERVAL_MS
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

          // Don't reset the timestamp range - allow accumulation for multiple finalize calls
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

      if (providerKey === 'codex' && promptTexts.length === 0) {
        const fallbackPrompts = extractUniquePromptTexts(state.prompts);
        if (fallbackPrompts.length > 0) {
          console.log('[finalizeSession] Using Codex session prompts as fallback because history.jsonl was empty during assistant completion');
          promptTexts = fallbackPrompts;
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
        }
      }

      // Reset state instead of deleting - allowing multiple finalize calls
      state.prompts = [];
      state.completedPromptStartTime = null;
      state.completedPromptEndTime = null;
      state.actualDurationMs = null;
      state.responsePending = false;
    }

    let sessionClosed = false;
    const handleProcessExit = async (code, signal) => {
      if (sessionClosed) {
        return;
      }
      sessionClosed = true;

      try {
        if (providerKey === 'claude') {
          await finalizeSession({ reason: 'exit' });
        }
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
        await disposeCodexLogMonitor(sessionKey, codexLogMonitors);
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
      disposeCodexLogMonitor(socket.id, codexLogMonitors).catch((error) => {
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
