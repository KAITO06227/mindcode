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
      escToInterruptVisible: false,
      escToInterruptStartTime: null,
      responseCompleteTimer: null,
      actualDurationMs: null
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
    console.warn('Failed to ensure Claude CLI config:', error.message);
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
    let codexApiKeyInputPending = false;
    let codexOutputBuffer = '';
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
    inputBuffers[socket.id] = '';
    const projectRoom = `${userId}:${projectId}`;
    socket.join(projectRoom);
    const gitManager = new GitManager(workspaceDir);

    // ターミナル画面バッファを保持（最新の部分のみ）
    // "esc to interrupt"は画面の最新部分に表示されるので、古い部分は不要
    let terminalScreenBuffer = '';
    const MAX_BUFFER_SIZE = 2000; // 最新の2000文字のみ保持（"esc to"を含む領域）

    // Handle PTY spawn event
    ptyProcess.on('spawn', () => {
      socket.emit('output', `\r\n✅ ${providerConfig.displayName} セッションを開始しました\r\n`);
      socket.emit('output', `📁 作業ディレクトリ: ${workspaceDir}\r\n`);
    });

    const projectKey = getProjectKey(userId, projectId);

    async function finalizeSession({ reason }) {
      const sessionKey = socket.id;
      const state = sessionState[sessionKey];
      if (!state) {
        return;
      }

      if (state.awaitingApproval && !['exit', 'response-complete'].includes(reason)) {
        return;
      }

      if (state.awaitingApproval) {
        endApprovalWait(state);
      }

      // タイマーをクリア
      if (state.responseCompleteTimer) {
        clearTimeout(state.responseCompleteTimer);
        state.responseCompleteTimer = null;
      }

      state.responsePending = false;
      state.escToInterruptVisible = false;
      state.escToInterruptStartTime = null;

      // Codexの場合、history.jsonlから実際のプロンプトを抽出
      let promptTexts = [];
      if (providerKey === 'codex') {
        try {
          const historyPath = path.join(homeDir, '.codex', 'history.jsonl');
          const historyContent = await fs.readFile(historyPath, 'utf8');
          const lines = historyContent.trim().split('\n');

          // state.promptsに記録されている最初のプロンプトのタイムスタンプを基準にする
          // もしstate.promptsが空なら、セッション開始時刻の少し前（30秒）から取得
          let filterStartTime;
          if (state.prompts.length > 0 && state.prompts[0].startedAt) {
            // 最初のプロンプトの1秒前から取得（タイミングのズレを吸収）
            filterStartTime = (state.prompts[0].startedAt - 1000) / 1000;
          } else {
            // セッション開始の30秒前から取得（広めに取る）
            filterStartTime = (state.startTime - 30000) / 1000;
          }

          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              if (entry.ts >= filterStartTime && entry.text) {
                promptTexts.push(entry.text);
              }
            } catch (parseError) {
              console.warn('Failed to parse history line:', parseError.message);
            }
          }
        } catch (readError) {
          console.warn('Failed to read Codex history, falling back to session prompts:', readError.message);
          const promptsFromSession = state.prompts || [];
          promptTexts = promptsFromSession.map(entry => entry.text);
        }
      } else {
        // Claude / Gemini の場合は従来通り
        const promptsFromSession = state.prompts || [];
        promptTexts = promptsFromSession.map(entry => entry.text);
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
      if (promptTexts.length > 0) {
        // Codexの場合、history.jsonlから取得したプロンプトを保存
        if (providerKey === 'codex') {
          for (const promptText of promptTexts) {
            try {
              await db.execute(
                'INSERT INTO claude_prompt_logs (project_id, user_id, prompt, duration_ms) VALUES (?, ?, ?, ?)',
                [projectId, userId, promptText, durationMs]
              );
            } catch (logError) {
              console.warn('Failed to record Codex prompt log:', logError.message);
            }
          }
        } else {
          // Claude / Gemini の場合は従来通り
          const promptsFromSession = state.prompts || [];
          for (const entry of promptsFromSession) {
            if (state.finalizedPromptIds.has(entry.id)) {
              continue;
            }
            try {
              const promptDuration = Math.max(0, Date.now() - (entry.startedAt || state.startTime));
              await db.execute(
                'INSERT INTO claude_prompt_logs (project_id, user_id, prompt, duration_ms) VALUES (?, ?, ?, ?)',
                [projectId, userId, entry.text, promptDuration]
              );
              state.finalizedPromptIds.add(entry.id);
            } catch (logError) {
              console.warn('Failed to record prompt log:', logError.message);
            }
          }
        }
      }

      // remove processed prompts from current session buffer
      state.prompts = [];
      state.startTime = Date.now();
      state.lastPromptStartedAt = null;

      const existingPending = pendingPromptsByProject[projectKey] || [];
      const promptsForCommit = promptTexts.length > 0
        ? existingPending.concat(promptTexts)
        : existingPending;

      if (promptsForCommit.length > 0) {
        const providerName = state.provider || providerConfig.displayName;

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
            const status = await gitManager.getStatus();
            if (!status?.hasChanges) {
              pendingPromptsByProject[projectKey] = promptsForCommit;
              socket.emit('commit_notification', {
                status: 'info',
                provider: providerName,
                count: promptsForCommit.length,
                durationMs,
                message: 'コード差分が無かったためコミットは保留されました。次回の変更時にまとめてコミットします。'
              });
              return;
            }

            await runWithIndexLockRetry(() => gitManager.addFile('.'));
            const commitMessage = buildCommitMessage(promptsForCommit, providerName);
            const commitResult = await runWithIndexLockRetry(() => gitManager.commit(
              commitMessage,
              userInfo.name || 'WebIDE User',
              userInfo.email || 'webide@example.com'
            ));

            if (commitResult.success) {
              commitPromptStore[commitResult.commitHash] = {
                projectId,
                prompts: promptsForCommit.slice()
              };
              delete pendingPromptsByProject[projectKey];
              const durationLabel = typeof durationMs === 'number'
                ? formatDuration(durationMs)
                : '前回保留分';
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
              console.warn('No changes detected for commit; deferring until next modifications.');
              socket.emit('commit_notification', {
                status: 'info',
                provider: providerName,
                count: promptsForCommit.length,
                durationMs,
                message: '変更がなかったためコミットは保留されました。次回の変更時にまとめてコミットします。'
              });
            } else {
            pendingPromptsByProject[projectKey] = promptsForCommit;
            console.warn('Auto-commit after AI session failed:', gitError.message);
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
        if (inputBuffers[socket.id]) {
          delete inputBuffers[socket.id];
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
      const lowerText = rawText.toLowerCase();

      // ターミナル画面バッファを更新
      terminalScreenBuffer += rawText;
      if (terminalScreenBuffer.length > MAX_BUFFER_SIZE) {
        terminalScreenBuffer = terminalScreenBuffer.slice(-MAX_BUFFER_SIZE);
      }

      // 画面バッファ全体で"esc to interrupt"/"esc to cancel"の有無をチェック
      const state = sessionState[socket.id];
      if (state) {
        const bufferLower = terminalScreenBuffer.toLowerCase();
        // Claude: "esc to interrupt", Codex: "esc to interrupt", Gemini: "esc to cancel"
        const screenHasEscToInterrupt = bufferLower.includes('esc to interrupt') || bufferLower.includes('esc to cancel');

        if (screenHasEscToInterrupt) {
          // 画面に"esc to interrupt"が表示されている = AI処理中
          if (!state.escToInterruptVisible) {
            state.escToInterruptVisible = true;
            state.escToInterruptStartTime = Date.now();
          }

          // タイマーをクリア（まだAI応答中）
          if (state.responseCompleteTimer) {
            clearTimeout(state.responseCompleteTimer);
            state.responseCompleteTimer = null;
          }
        } else if (state.escToInterruptVisible && !state.awaitingApproval) {
          // 認証待ち中は"esc to"の消失を無視（認証画面で"esc to"が消えるため）
          // 以前は表示されていたが、今は画面から消えた可能性
          // ただし、長い応答でバッファから押し出された可能性もあるので、2秒待つ

          // 既存のタイマーをクリア
          if (state.responseCompleteTimer) {
            clearTimeout(state.responseCompleteTimer);
          }

          // 2秒待って、まだ"esc to interrupt"がなければ完了とみなす
          state.responseCompleteTimer = setTimeout(() => {
            // 認証待ち状態になっている場合はスキップ
            if (state.awaitingApproval) {
              state.responseCompleteTimer = null;
              return;
            }

            // 再度バッファをチェック
            const finalBufferCheck = terminalScreenBuffer.toLowerCase();
            const stillHasEscToInterrupt = finalBufferCheck.includes('esc to interrupt') || finalBufferCheck.includes('esc to cancel');

            if (!stillHasEscToInterrupt) {
              const displayDuration = state.escToInterruptStartTime
                ? Math.max(0, Date.now() - state.escToInterruptStartTime - 2000) // 2秒の待機時間を引く
                : 0;

              state.escToInterruptVisible = false;
              state.escToInterruptStartTime = null;
              state.responseCompleteTimer = null;

              const approvalWaitMs = state.totalApprovalWaitMs || 0;
              const adjustedDuration = Math.max(0, displayDuration - approvalWaitMs);

              // 実際の処理時間をstateに保存（finalizeSessionで使用）
              state.actualDurationMs = adjustedDuration;
              state.totalApprovalWaitMs = 0;
              state.approvalWaitStartTime = null;

              // Codexの場合、state.promptsは空でもhistory.jsonlにプロンプトが記録されている可能性があるため
              // responsePendingがtrueであれば自動コミットを実行
              if (state.responsePending) {
                finalizeSession({ reason: 'response-complete' }).catch((err) => {
                  console.error('Failed to finalize after AI response complete:', err);
                });
              }
            } else {
              state.responseCompleteTimer = null;
            }
          }, 2000);
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

        const normalizedChoicePrefix = rawText.replace(/^[^\x1b]*\x1b\[[0-9;]*m/g, '').trim();
        if (
          approvalPatterns.some(pattern => lowerText.includes(pattern)) ||
          normalizedChoicePrefix.startsWith('│ ❯ 1. yes') ||
          normalizedChoicePrefix.startsWith('│   1. yes')
        ) {
          beginApprovalWait(state);
          return;
        }

        if (state.awaitingApproval && /press enter/.test(lowerText)) {
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

          if (state.completionTimer) {
            clearTimeout(state.completionTimer);
            state.completionTimer = null;
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

          // 意味のある内容がない場合（空文字列や数字のみ）はプロンプトとして記録しない
          if (cleaned.length === 0 || /^[0-9\s]+$/.test(cleaned)) {
            continue;
          }

          // 新しいプロンプト送信時は、escToInterruptVisibleをリセット
          // これにより、次に「esc to interrupt」が表示されるまで自動コミットは発火しない
          state.escToInterruptVisible = false;
          state.escToInterruptStartTime = null;

          // 画面バッファもクリア（新しいプロンプトなので過去の画面状態は不要）
          terminalScreenBuffer = '';

          // タイマーもクリア
          if (state.responseCompleteTimer) {
            clearTimeout(state.responseCompleteTimer);
            state.responseCompleteTimer = null;
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
      if (inputBuffers[socket.id]) {
        delete inputBuffers[socket.id];
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
