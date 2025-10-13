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
const sessionState = {};
const pendingPromptsByProject = {};
const idleTimers = {};
const commitPromptStore = {};

const STATUS_RETRY_ATTEMPTS = 5;
const STATUS_RETRY_DELAY_MS = 400;
const PROCESSING_INDICATOR_CLEAR_DELAY_MS = 500;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ensureSessionState(sessionKey, defaultProvider) {
  if (!sessionState[sessionKey]) {
    sessionState[sessionKey] = {
      startTime: Date.now(),
      prompts: [],
      provider: defaultProvider,
      completionTimer: null,
      awaitingApproval: false,
      lastPromptStartedAt: null,
      responsePending: false,
      finalizedPromptIds: new Set(),
      approvalStartTime: null,    // 承認待ち開始時刻
      totalApprovalTime: 0,       // 累積承認待ち時間（ミリ秒）
      approvalCooldownUntil: 0,   // 承認完了後の再検知抑制時刻
      processingIndicatorActive: false,
      processingIndicatorTimeout: null,
      processingIndicatorLastSeenAt: 0,
      processingIndicatorStartedAt: null,
      processingIndicatorAccumulatedMs: 0,
      processingIndicatorPromptText: null,
      currentProcessingPromptId: null,
      processingIndicatorEverSeen: false,
      lastCapturedPrompt: null,
      lastInputPrompt: null,
      processingIndicatorLastLine: null
    };
  }
  return sessionState[sessionKey];
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
    console.warn('Failed to ensure Claude CLI config:', error.message);
  }
}

/**
 * Claude CLIのフック設定を行い、プロンプトテキストを保存するスクリプトを作成
 *
 * 重要: Claude CLIは実際のシステムHOMEディレクトリから設定を読み込むため、
 * PTYで設定したHOME環境変数ではなく、実際のユーザーホームに設定を書き込む必要がある
 */
async function ensureClaudeHooks(homeDir, workspaceDir) {
  // Claude CLIが実際に読み込む設定ファイルパス（実際のシステムホーム）
  const realHome = require('os').homedir();
  const realConfigDir = path.join(realHome, '.config', 'claude');
  const realConfigPath = path.join(realConfigDir, 'config.json');

  const mindcodeDir = path.join(workspaceDir, '.mindcode');

  try {
    // .mindcode ディレクトリを作成（フックが書き込むファイル用）
    await fs.mkdir(mindcodeDir, { recursive: true });

    // 実際のシステムホームに.configディレクトリを作成
    await fs.mkdir(realConfigDir, { recursive: true });

    // グローバルフックスクリプトのパス（コンテナ内）
    const containerHookScriptPath = path.join('/app', '.global-hooks', 'capture-prompt.js');

    // Docker環境の場合、コンテナ内パスをホストパスに変換
    const hostHookScriptPath = process.env.HOST_PROJECT_ROOT
      ? containerHookScriptPath.replace('/app', process.env.HOST_PROJECT_ROOT)
      : containerHookScriptPath;

    console.log('[HOOK] Container hook path:', containerHookScriptPath);
    console.log('[HOOK] Host hook path for CLI:', hostHookScriptPath);
    console.log('[HOOK] Real system home:', realHome);
    console.log('[HOOK] Writing config to:', realConfigPath);

    // 実際のシステムホームからClaude CLI設定ファイルを読み込み
    let config = {};
    try {
      const existingRaw = await fs.readFile(realConfigPath, 'utf8');
      config = JSON.parse(existingRaw);
    } catch (readError) {
      console.warn('[HOOK] No existing config found, creating new one');
    }

    // フック設定を追加（全プロジェクト共通のグローバルフック）
    config.hooks = config.hooks || {};
    config.hooks.UserPromptSubmit = [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: `node "${hostHookScriptPath}"`
          }
        ]
      }
    ];

    // 実際のシステムホームに設定ファイルを書き込み
    await fs.writeFile(realConfigPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('[HOOK] Claude CLI hooks configured successfully');
    console.log('[HOOK] Global hook script:', hostHookScriptPath);
    console.log('[HOOK] Prompt data will be saved to:', path.join(mindcodeDir, 'prompt-data.json'));
  } catch (error) {
    console.warn('[HOOK] Failed to configure Claude CLI hooks:', error.message);
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

      // フック設定を追加
      await ensureClaudeHooks(homeDir, workspaceDir);

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
      console.error('❌ No project ID provided');
      socket.emit('claude_error', { message: 'Project ID is required' });
      socket.disconnect();
      return;
    }

    if (!token) {
      console.error('❌ No auth token provided');
      socket.emit('claude_error', { message: 'Authentication required' });
      socket.disconnect();
      return;
    }

    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded?.id;
    } catch (error) {
      console.error('❌ Invalid auth token:', error.message);
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
      const [projects] = await db.execute(
        'SELECT id FROM projects WHERE id = ? AND user_id = ?',
        [projectId, userId]
      );
      if (projects.length === 0) {
        socket.emit('claude_error', { message: 'Project not found or access denied' });
        socket.disconnect();
        return;
      }
      projectRecord = projects[0];
    } catch (projectError) {
      console.error('❌ Failed to verify project ownership:', projectError);
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
      console.warn('Failed to load user info for commits:', userError.message);
    }

    // Create project workspace directory
    const homeDir = await ensureUserRoot({ id: userId, email: userInfo.email });
    const workspaceDir = await resolveExistingProjectPath(
      { id: userId, email: userInfo.email },
      projectId
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
      console.error(`❌ Failed to prepare ${providerConfig.displayName} CLI:`, prepError.message);
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
      console.error(`❌ Failed to launch ${providerConfig.displayName} CLI:`, spawnError.message);

      let errorMessage = `\r\n❌ ${providerConfig.displayName} CLI を起動できませんでした。サーバー管理者にお問い合わせください。\r\n`;

      if (spawnError.code === 'ENOENT' || /ENOENT/.test(spawnError.message)) {
        errorMessage = `\r\n❌ ${providerConfig.displayName} CLI コマンド \"${providerConfig.command}\" が見つかりません。\r\n` +
          'CLI をサーバーにインストールするか、別のプロバイダを選択してください。\r\n';
      }

      socket.emit('output', `${errorMessage}\r\n別のプロバイダを選択するか、環境を確認してから再試行してください。\r\n`);
      return;
    }

    terminals[socket.id] = ptyProcess;
    const projectRoom = `${userId}:${projectId}`;
    socket.join(projectRoom);
    const gitManager = new GitManager(workspaceDir);

    // Handle PTY spawn event
    ptyProcess.on('spawn', () => {
      socket.emit('output', `\r\n✅ ${providerConfig.displayName} セッションを開始しました\r\n`);
      socket.emit('output', `📁 作業ディレクトリ: ${workspaceDir}\r\n`);
    });

    const projectKey = getProjectKey(userId, projectId);

    // 承認プロンプト検知用の出力バッファ（最近の出力を保持）
    let outputBuffer = '';

    // プロンプト入力バッファ（ユーザーの入力を蓄積）
    let inputBuffer = '';

    // プロンプト抽出用の正規表現パターン
    // Claude Codeは "> prompt text" の形式でプロンプトを表示する
    let lastPromptLine = '';

    const queueCommitAfterIdle = () => {
      const state = sessionState[socket.id];
      if (!state || state.prompts.length === 0) {
        return;
      }

      if (!state.responsePending) {
        return;
      }

      if (state.awaitingApproval) {
        return;
      }

      if (state.processingIndicatorEverSeen) {
        return;
      }

      if (state.processingIndicatorActive) {
        if (idleTimers[socket.id]) {
          clearTimeout(idleTimers[socket.id]);
          delete idleTimers[socket.id];
        }
        return;
      }

      if (idleTimers[socket.id]) {
        clearTimeout(idleTimers[socket.id]);
      }

      if (state.completionTimer) {
        clearTimeout(state.completionTimer);
        state.completionTimer = null;
      }

      // 非プロンプト出力が1秒間ない場合、処理完了と判定
      // 処理時間から1秒を減算して正確な処理時間を記録
      idleTimers[socket.id] = setTimeout(() => {
        const currentState = sessionState[socket.id];
        if (!currentState) {
          return;
        }

        // 承認待ち状態ならコミットしない
        if (currentState.awaitingApproval) {
          return;
        }
        const fallbackPromptText = currentState.processingIndicatorPromptText
          || currentState.prompts[currentState.prompts.length - 1]?.text
          || null;
        const fallbackDuration = typeof currentState.processingIndicatorAccumulatedMs === 'number'
          ? currentState.processingIndicatorAccumulatedMs
          : null;

        finalizeSession({
          reason: 'processing-complete',
          timeAdjustmentMs: -1000,
          processingMetrics: fallbackDuration !== null
            ? { durationMs: fallbackDuration, promptText: fallbackPromptText }
            : { promptText: fallbackPromptText }
        }).catch((idleError) => {
          console.error('Failed to finalize AI session on idle:', idleError);
        });
      }, 1000);
    };

    async function finalizeSession({ reason, timeAdjustmentMs = 0, processingMetrics = null }) {
      const sessionKey = socket.id;
      const state = sessionState[sessionKey];
      if (!state) {
        return;
      }

      if (state.completionTimer) {
        clearTimeout(state.completionTimer);
        state.completionTimer = null;
      }

      if (state.processingIndicatorTimeout) {
        clearTimeout(state.processingIndicatorTimeout);
        state.processingIndicatorTimeout = null;
      }

      const nowTs = Date.now();
      if (state.processingIndicatorActive && typeof state.processingIndicatorStartedAt === 'number') {
        const segmentDuration = Math.max(0, nowTs - state.processingIndicatorStartedAt);
        state.processingIndicatorAccumulatedMs = (state.processingIndicatorAccumulatedMs || 0) + segmentDuration;
        const promptEntryDuringFinalize = state.prompts.find((entry) => entry.id === state.currentProcessingPromptId)
          || state.prompts[state.prompts.length - 1];
        if (promptEntryDuringFinalize) {
          promptEntryDuringFinalize.processingDurationMs = (promptEntryDuringFinalize.processingDurationMs || 0) + segmentDuration;
        }
      }

      state.processingIndicatorActive = false;
      state.processingIndicatorStartedAt = null;

      if (idleTimers[sessionKey]) {
        clearTimeout(idleTimers[sessionKey]);
        delete idleTimers[sessionKey];
      }

      if (state.awaitingApproval && !['exit', 'prompt-ready', 'approval-idle'].includes(reason)) {
        return;
      }

      state.responsePending = false;

      const promptsFromSession = state.prompts || [];
      const promptTexts = promptsFromSession.map(entry => entry.text);
      const lastPrompt = promptsFromSession[promptsFromSession.length - 1];

      if (promptsFromSession.length === 0 && !pendingPromptsByProject[projectKey]?.length) {
        state.lastInputPrompt = null;
        state.processingIndicatorPromptText = null;
        state.processingIndicatorLastLine = null;
        return;
      }

      // 承認待ち中の場合は現在の承認時間も加算
      let totalApprovalTime = state.totalApprovalTime || 0;
      if (state.approvalStartTime) {
        totalApprovalTime += nowTs - state.approvalStartTime;
      }

      // 実際の処理時間 = 全体時間 - 承認待ち時間 + 時間調整
      const totalDurationMs = lastPrompt ? Math.max(0, nowTs - (lastPrompt.startedAt || state.startTime)) : null;
      const durationMs = totalDurationMs !== null ? Math.max(0, totalDurationMs - totalApprovalTime + timeAdjustmentMs) : null;

      let reportedDurationMs = durationMs;
      let processingPromptText = processingMetrics?.promptText
        || state.processingIndicatorPromptText
        || state.lastCapturedPrompt
        || lastPrompt?.text
        || null;

      if (typeof processingMetrics?.durationMs === 'number') {
        reportedDurationMs = Math.max(0, processingMetrics.durationMs);
      } else if (typeof state.processingIndicatorAccumulatedMs === 'number' && state.processingIndicatorAccumulatedMs > 0) {
        reportedDurationMs = Math.max(0, state.processingIndicatorAccumulatedMs);
      }

      const duringTimeMs = Number.isFinite(reportedDurationMs) ? reportedDurationMs : null;

      if (promptsFromSession.length > 0) {
        for (const entry of promptsFromSession) {
          if (state.finalizedPromptIds.has(entry.id)) {
            continue;
          }
          try {
            // プロンプト個別の処理時間も承認待ち時間と待機時間を除外
            const promptDurationForLog = typeof entry.processingDurationMs === 'number' && entry.processingDurationMs >= 0
              ? entry.processingDurationMs
              : Math.max(0, nowTs - (entry.startedAt || state.startTime) - totalApprovalTime + timeAdjustmentMs);

            await db.execute(
              'INSERT INTO claude_prompt_logs (project_id, user_id, prompt, duration_ms) VALUES (?, ?, ?, ?)',
              [projectId, userId, entry.text, promptDurationForLog]
            );
            state.finalizedPromptIds.add(entry.id);
          } catch (logError) {
            console.warn('Failed to record prompt log:', logError.message);
          }
        }
      }

      // remove processed prompts from current session buffer
      state.prompts = [];
      state.startTime = nowTs;
      state.lastPromptStartedAt = null;
      state.processingIndicatorAccumulatedMs = 0;
      state.processingIndicatorPromptText = null;
      state.currentProcessingPromptId = null;
      state.processingIndicatorLastSeenAt = nowTs;
      state.processingIndicatorEverSeen = false;
      state.lastCapturedPrompt = null;
      state.lastInputPrompt = null;
      state.processingIndicatorLastLine = null;
      state.approvalStartTime = null;
      state.totalApprovalTime = 0;

      const existingPending = pendingPromptsByProject[projectKey] || [];
      const promptsForCommit = promptTexts.length > 0
        ? existingPending.concat(promptTexts)
        : existingPending;
      const providerName = state.provider || providerConfig.displayName;
      const commitTexts = promptsForCommit.length > 0
        ? promptsForCommit
        : ['AI自動コミット (プロンプト記録なし)'];

      const runWithIndexLockRetry = async (operation) => {
        try {
          return await operation();
        } catch (error) {
          if (/index\.lock/.test(error.message || '')) {
            try {
              await gitManager.clearIndexLock();
            } catch (lockError) {
              console.warn('Failed to clear git index.lock:', lockError.message);
            }
            return await operation();
          }
          throw error;
        }
      };

      if (await gitManager.isInitialized()) {
        try {
          const detectChangesWithRetry = async () => {
            let statusResult = await gitManager.getStatus();

            if (statusResult?.hasChanges) {
              return statusResult;
            }

            for (let attempt = 1; attempt <= STATUS_RETRY_ATTEMPTS; attempt += 1) {
              await delay(STATUS_RETRY_DELAY_MS);
              statusResult = await gitManager.getStatus();

              if (statusResult?.hasChanges) {
                return statusResult;
              }
            }

            return statusResult;
          };

          const status = await detectChangesWithRetry();

          if (!status?.hasChanges) {
            if (promptsForCommit.length > 0) {
              pendingPromptsByProject[projectKey] = promptsForCommit;
            }
            socket.emit('commit_notification', {
              status: 'info',
              provider: providerName,
              count: promptsForCommit.length,
              durationMs: reportedDurationMs,
              duringTimeMs,
              prompt: processingPromptText,
              message: 'コード差分が無かったためコミットは保留されました。次回の変更時にまとめてコミットします。'
            });
            return;
          }

          await runWithIndexLockRetry(() => gitManager.addFile('.'));
          const commitMessage = buildCommitMessage(commitTexts, providerName);
          const commitResult = await runWithIndexLockRetry(() => gitManager.commit(
            commitMessage,
            userInfo.name || 'WebIDE User',
            userInfo.email || 'webide@example.com'
          ));

          if (commitResult.success) {
            if (promptsForCommit.length > 0) {
              commitPromptStore[commitResult.commitHash] = {
                projectId,
                prompts: promptsForCommit.slice()
              };
            }
            delete pendingPromptsByProject[projectKey];
            const durationLabel = typeof reportedDurationMs === 'number'
              ? formatDuration(reportedDurationMs)
              : '前回保留分';
            socket.emit('commit_notification', {
              status: 'success',
              provider: providerName,
              count: promptsForCommit.length,
              durationMs: reportedDurationMs,
              duringTimeMs,
              prompt: processingPromptText,
              message: `トリップコードへコミットしました (${promptsForCommit.length}件, ${durationLabel})`
            });
            socket.emit('save_complete', {
              message: '保存が完了しました',
              timestamp: new Date().toISOString()
            });
          } else {
            const noChanges = /no changes/i.test(commitResult.message || '');
            if (promptsForCommit.length > 0) {
              pendingPromptsByProject[projectKey] = promptsForCommit;
            }
            socket.emit('commit_notification', {
              status: noChanges ? 'info' : 'warning',
              provider: providerName,
              count: promptsForCommit.length,
              durationMs: reportedDurationMs,
              duringTimeMs,
              prompt: processingPromptText,
              message: noChanges
                ? '変更がなかったためコミットは保留されました。次回の変更時にまとめてコミットします。'
                : `コミットをスキップしました: ${commitResult.message}`
            });
          }
        } catch (gitError) {
          if (/nothing to commit/i.test(gitError.message || '')) {
            if (promptsForCommit.length > 0) {
              pendingPromptsByProject[projectKey] = promptsForCommit;
            }
            console.warn('No changes detected for commit; deferring until next modifications.');
            socket.emit('commit_notification', {
              status: 'info',
              provider: providerName,
              count: promptsForCommit.length,
              durationMs: reportedDurationMs,
              duringTimeMs,
              prompt: processingPromptText,
              message: '変更がなかったためコミットは保留されました。次回の変更時にまとめてコミットします。'
            });
          } else {
            if (promptsForCommit.length > 0) {
              pendingPromptsByProject[projectKey] = promptsForCommit;
            }
            console.warn('Auto-commit after AI session failed:', gitError.message);
            socket.emit('commit_notification', {
              status: 'error',
              provider: providerName,
              count: promptsForCommit.length,
              durationMs: reportedDurationMs,
              duringTimeMs,
              prompt: processingPromptText,
              message: `コミットに失敗しました: ${gitError.message}`
            });
          }
        }
      } else if (promptsForCommit.length > 0) {
        pendingPromptsByProject[projectKey] = promptsForCommit;
        socket.emit('commit_notification', {
          status: 'info',
          provider: providerName,
          count: promptsForCommit.length,
          durationMs: reportedDurationMs,
          duringTimeMs,
          prompt: processingPromptText,
          message: 'トリップコードが未初期化のため、プロンプトを保留しました'
        });
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
        console.error('Failed to finalize AI session:', finalizeError);
        socket.emit(
          'output',
          `\r\n⚠️ セッション後処理に失敗しました: ${finalizeError.message}\r\n`
        );
      } finally {
        if (terminals[socket.id] === ptyProcess) {
          delete terminals[socket.id];
        }
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
      socket.emit('output', rawText);
      const state = ensureSessionState(socket.id, providerConfig.displayName);

      // エスケープシーケンスを除去した正規化テキスト
      const cleanText = rawText.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
      const lowerText = cleanText.toLowerCase();
      const indicatorRegex = /\(esc to (?:interrupt|cancel)\)/i;
      const indicatorScanText = (outputBuffer + cleanText).slice(-200);
      const hasProcessingIndicator = indicatorRegex.test(indicatorScanText);
      let indicatorPromptCandidate = null;
      let indicatorDetectedInChunk = false;
      let indicatorMatchText = null;

      // プロンプト行の検出 ("> prompt text" パターン)
      // Claude Codeは確定したプロンプトの後にスピナー記号と "(esc to interrupt)" を表示する
      // このパターンを検出してプロンプトが確定したと判断する
      const lines = rawText.split(/\r?\n/);
      let foundConfirmedPrompt = false;
      let confirmedPromptText = '';

      for (let i = 0; i < lines.length; i++) {
        const cleanLine = lines[i].replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();

        // 処理中インジケーターパターン（プロンプト確定の証拠）
        // "(esc to interrupt)" または "(esc to cancel)" が表示されている間はAI処理中とみなす
        const hasSpinner = /[·✢*✶✻✽✺✹✸✷✵✴✳✲✱]/.test(cleanLine);
        const hasEscIndicator = /\(esc to (?:interrupt|cancel)\)/i.test(cleanLine);
        const isProcessing = hasEscIndicator;

        if (isProcessing) {
          indicatorDetectedInChunk = true;
          if (!indicatorMatchText) {
            indicatorMatchText = cleanLine;
          }
        }

        if (isProcessing && i > 0) {
          // 前の行からプロンプトを探す
          const prevLine = lines[i - 1].replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
          const promptMatch = prevLine.match(/^>\s+(.+)$/);

          if (promptMatch && promptMatch[1].length > 0) {
            const potentialPrompt = promptMatch[1].trim();

            // "Try "how..." などのヒントメッセージは無視
            if (!potentialPrompt.startsWith('Try ') &&
                potentialPrompt !== lastPromptLine &&
                potentialPrompt.length > 5) {
              foundConfirmedPrompt = true;
              confirmedPromptText = potentialPrompt;
              if (!indicatorPromptCandidate) {
                indicatorPromptCandidate = potentialPrompt;
              }
              break;
            }
          }
        }
      }

      if (!indicatorPromptCandidate && (hasProcessingIndicator || indicatorDetectedInChunk)) {
        indicatorPromptCandidate = state.processingIndicatorPromptText
          || state.lastCapturedPrompt
          || state.lastInputPrompt
          || state.prompts[state.prompts.length - 1]?.text
          || lastPromptLine
          || null;
      }

      const indicatorSeenThisChunk = hasProcessingIndicator || indicatorDetectedInChunk;
      const indicatorWasActive = state.processingIndicatorActive;

      if (indicatorSeenThisChunk) {
        const nowTs = Date.now();
        let resolvedPrompt = indicatorPromptCandidate
          || state.processingIndicatorPromptText
          || state.lastCapturedPrompt
          || state.lastInputPrompt
          || state.prompts[state.prompts.length - 1]?.text
          || lastPromptLine
          || null;

        if (indicatorMatchText) {
          state.processingIndicatorLastLine = indicatorMatchText;
        }

        if (!indicatorWasActive) {
          state.processingIndicatorActive = true;
          state.processingIndicatorStartedAt = nowTs;
          state.processingIndicatorAccumulatedMs = state.processingIndicatorAccumulatedMs || 0;
          if (!state.currentProcessingPromptId && state.prompts.length > 0) {
            state.currentProcessingPromptId = state.prompts[state.prompts.length - 1].id;
          }
        }

        if (!resolvedPrompt && state.lastInputPrompt) {
          resolvedPrompt = state.lastInputPrompt;
        }

        if (resolvedPrompt) {
          state.processingIndicatorPromptText = resolvedPrompt;
        }

        state.processingIndicatorEverSeen = true;
        state.processingIndicatorLastSeenAt = nowTs;
        if (state.processingIndicatorTimeout) {
          clearTimeout(state.processingIndicatorTimeout);
          state.processingIndicatorTimeout = null;
        }
        if (idleTimers[socket.id]) {
          clearTimeout(idleTimers[socket.id]);
          delete idleTimers[socket.id];
        }

        if (!indicatorWasActive) {
          console.log('[AI-DIAG] indicator_visible', {
            prompt: state.processingIndicatorPromptText
              || resolvedPrompt
              || state.lastInputPrompt
              || null,
            promptsTracked: state.prompts.length,
            lastInputPrompt: state.lastInputPrompt,
            indicatorLine: state.processingIndicatorLastLine
          });
        }
      } else if (state.processingIndicatorActive && !state.processingIndicatorTimeout) {
        state.processingIndicatorTimeout = setTimeout(() => {
          const currentState = sessionState[socket.id];
          if (!currentState) {
            return;
          }
          currentState.processingIndicatorTimeout = null;
          if (!currentState.processingIndicatorActive) {
            return;
          }
          const nowTs = Date.now();
          const startedAt = currentState.processingIndicatorStartedAt;
          const segmentDuration = typeof startedAt === 'number'
            ? Math.max(0, nowTs - startedAt)
            : 0;

          currentState.processingIndicatorAccumulatedMs =
            (currentState.processingIndicatorAccumulatedMs || 0) + segmentDuration;

          if (typeof startedAt === 'number') {
            const promptEntry = currentState.prompts.find((entry) => entry.id === currentState.currentProcessingPromptId)
              || currentState.prompts[currentState.prompts.length - 1];
            if (promptEntry) {
              promptEntry.processingDurationMs = (promptEntry.processingDurationMs || 0) + segmentDuration;
            }
          }

          currentState.processingIndicatorStartedAt = null;
          currentState.processingIndicatorActive = false;
          currentState.processingIndicatorLastSeenAt = nowTs;

          const totalDuration = currentState.processingIndicatorAccumulatedMs;
          const promptText = currentState.processingIndicatorPromptText
            || currentState.lastCapturedPrompt
            || currentState.lastInputPrompt
            || currentState.prompts[currentState.prompts.length - 1]?.text
            || null;

          console.log('[AI-DIAG] indicator_hidden', {
            prompt: promptText,
            durationMs: totalDuration,
            promptsTracked: currentState.prompts.length,
            lastInputPrompt: currentState.lastInputPrompt,
            indicatorLine: currentState.processingIndicatorLastLine
          });

          currentState.processingIndicatorLastLine = null;

          finalizeSession({
            reason: 'indicator-cleared',
            processingMetrics: {
              durationMs: totalDuration,
              promptText
            }
          }).catch((indicatorError) => {
            console.error('Failed to finalize AI session on indicator clear:', indicatorError);
          });
        }, PROCESSING_INDICATOR_CLEAR_DELAY_MS);
      }

      // 確定したプロンプトを記録
      if (foundConfirmedPrompt) {
        lastPromptLine = confirmedPromptText;

        // プロンプトを記録
        if (state.completionTimer) {
          clearTimeout(state.completionTimer);
          state.completionTimer = null;
        }

        const nowTs = Date.now();
        if (state.prompts.length === 0) {
          state.startTime = nowTs;
        }

        const promptEntry = {
          id: randomUUID(),
          text: confirmedPromptText,
          startedAt: nowTs,
          processingDurationMs: 0
        };

        state.prompts.push(promptEntry);
        state.currentProcessingPromptId = promptEntry.id;
        state.processingIndicatorAccumulatedMs = 0;
        state.processingIndicatorPromptText = confirmedPromptText;
        state.processingIndicatorStartedAt = null;
        state.processingIndicatorEverSeen = false;
        state.lastCapturedPrompt = confirmedPromptText;
        state.lastInputPrompt = confirmedPromptText;
        state.responsePending = true;
        state.lastPromptAt = nowTs;

        console.log('[AI-DIAG] prompt_captured', {
          source: 'output',
          prompt: confirmedPromptText
        });
      }

      // 出力バッファに追加（最新500文字を保持）
      outputBuffer += cleanText;
      if (outputBuffer.length > 500) {
        outputBuffer = outputBuffer.slice(-500);
      }
      const lowerBuffer = outputBuffer.toLowerCase();

      // デバッグ: 承認プロンプトの可能性がある行を検出
      const approvalPatterns = [
        'allow command?',
        'approval required',
        'always approve this session',
        'always yes',
        'use arrow keys',
        'select an option',
        'apply this change?',
        'apply these changes?',
        'allow this edit?',
        'allow these edits?',
        'do you want to',
        '1. yes',
        '2. yes, allow all edits',
        '3. no, and tell claude',
        'press enter to continue',
        'waiting for approval',
        'requires approval'
      ];

      const normalizedChoicePrefix = rawText.replace(/^[^\x1b]*\x1b\[[0-9;]*m/g, '').trim();

      // 複合的な承認プロンプト検知
      const hasApprovalChoice =
        normalizedChoicePrefix.includes('❯ 1. yes') ||
        normalizedChoicePrefix.includes('  1. yes') ||
        normalizedChoicePrefix.includes('❯ 2. yes') ||
        normalizedChoicePrefix.includes('  2. yes') ||
        lowerText.includes('❯ 1. yes') ||
        lowerText.includes('❯ 2. yes');

      const hasApprovalContext =
        (lowerText.includes('do you want') && lowerText.includes('yes')) ||
        (lowerText.includes('create file') && lowerText.includes('1. yes')) ||
        (lowerText.includes('write(') && lowerText.includes('1. yes')) ||
        (lowerText.includes('edit(') && lowerText.includes('1. yes'));

      // バッファベースの検知（複数チャンクに分割された承認プロンプト対応）
      const hasApprovalInBuffer =
        (lowerBuffer.includes('do you want') && lowerBuffer.includes('1. yes')) ||
        (lowerBuffer.includes('create file') && lowerBuffer.includes('1. yes')) ||
        (lowerBuffer.includes('write(') && lowerBuffer.includes('1. yes')) ||
        (lowerBuffer.includes('❯ 1. yes'));

      const isApprovalPrompt =
        approvalPatterns.some(pattern => lowerText.includes(pattern)) ||
        hasApprovalChoice ||
        hasApprovalContext ||
        hasApprovalInBuffer;

      if (isApprovalPrompt) {
        if (state.approvalCooldownUntil && Date.now() < state.approvalCooldownUntil) {
          return;
        }
        const wasAwaitingApproval = state.awaitingApproval;
        state.awaitingApproval = true;
        state.approvalCooldownUntil = 0;

        if (!wasAwaitingApproval) {
          // 承認待ち開始 - 時間計測を停止
          state.approvalStartTime = Date.now();
        }

        if (idleTimers[socket.id]) {
          clearTimeout(idleTimers[socket.id]);
          delete idleTimers[socket.id];
        }
        if (state.completionTimer) {
          clearTimeout(state.completionTimer);
          state.completionTimer = null;
        }
        return;
      }

      if (state.awaitingApproval && /press enter/.test(lowerText)) {
        // 承認完了 - 時間計測を再開
        if (state.approvalStartTime) {
          const approvalDuration = Date.now() - state.approvalStartTime;
          state.totalApprovalTime += approvalDuration;
          state.approvalStartTime = null;
        }
        state.awaitingApproval = false;
        state.responsePending = true;
        state.approvalCooldownUntil = Date.now() + 1500;
        outputBuffer = '';
        return;
      }

      // プロンプト入力行以外の出力でアイドルタイマーをリセット（処理中の判定）
      // プロンプト入力行（"> text"）の更新はタイマーをリセットしない
      const isPromptInputLine = lines.some(line => {
        const clean = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
        return /^>\s+/.test(clean);
      });

      const hasNonPromptOutput = !isPromptInputLine && cleanText.trim().length > 0;

      if (state.prompts.length > 0 && state.responsePending && !state.awaitingApproval && hasNonPromptOutput) {
        queueCommitAfterIdle();
      }
    });

    ptyProcess.on('exit', handleProcessExit);
    ptyProcess.on('close', handleProcessExit);

    // Handle user input - capture prompts from terminal input
    socket.on('input', (data) => {
      // PTYにデータを書き込む（ターミナルエミュレーション用）
      if (terminals[socket.id]) {
        terminals[socket.id].write(data);
      }

      const sessionKey = socket.id;
      const currentState = ensureSessionState(sessionKey, providerConfig.displayName);

      // Enter キーが押されたかチェック
      const containsEnter = data.includes(0x0d) || data.includes(0x0a);

      // 承認プロンプト応答の処理
      if (currentState.awaitingApproval && containsEnter) {
        // 承認完了 - 時間計測を再開
        if (currentState.approvalStartTime) {
          const approvalDuration = Date.now() - currentState.approvalStartTime;
          currentState.totalApprovalTime += approvalDuration;
          currentState.approvalStartTime = null;
        }
        currentState.awaitingApproval = false;
        currentState.responsePending = true;
        currentState.approvalCooldownUntil = Date.now() + 1500;
        outputBuffer = '';
        return;
      }

      // 承認待ち中はプロンプト入力を無視
      if (currentState.awaitingApproval) {
        return;
      }

      // 入力バッファにデータを追加
      const inputText = normalizeTerminalInput(data);

      // 表示可能な文字のみをバッファに追加
      if (inputText.length > 0) {
        inputBuffer += inputText;
      }

      // Enterキーが押されたらプロンプトとして記録
      if (containsEnter && inputBuffer.trim().length > 0) {
        const promptText = inputBuffer.trim();

        // プロンプトを記録
        if (currentState.completionTimer) {
          clearTimeout(currentState.completionTimer);
          currentState.completionTimer = null;
        }

        const nowTs = Date.now();
        if (currentState.prompts.length === 0) {
          currentState.startTime = nowTs;
        }

        const promptEntry = {
          id: randomUUID(),
          text: promptText,
          startedAt: nowTs,
          processingDurationMs: 0
        };

        currentState.prompts.push(promptEntry);
        currentState.currentProcessingPromptId = promptEntry.id;
        currentState.processingIndicatorAccumulatedMs = 0;
        currentState.processingIndicatorPromptText = promptText;
        currentState.processingIndicatorStartedAt = null;
        currentState.processingIndicatorEverSeen = false;
        currentState.lastCapturedPrompt = promptText;
        currentState.lastInputPrompt = promptText;
        currentState.responsePending = true;
        currentState.lastPromptAt = nowTs;

        console.log('[AI-DIAG] prompt_captured', {
          source: 'input',
          prompt: promptText
        });

        // 入力バッファをクリア
        inputBuffer = '';

        // アイドルタイマーを設定（処理完了検知用）
        queueCommitAfterIdle();
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
        console.warn('Failed to resize PTY session:', resizeError.message);
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
        console.warn('Failed to terminate PTY on explicit request:', terminateError.message);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      if (terminals[socket.id]) {
        try {
          terminals[socket.id].kill();
        } catch (killError) {
          console.warn('Failed to terminate PTY on disconnect:', killError.message);
        }
        delete terminals[socket.id];
      }
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
