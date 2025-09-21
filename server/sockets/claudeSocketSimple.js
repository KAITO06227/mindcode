const pty = require('node-pty');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const jwt = require('jsonwebtoken');
const db = require('../database/connection');
const GitManager = require('../utils/gitManager');

// Store active terminal sessions
const terminals = {};
const inputBuffers = {};

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

async function ensureClaudeCliConfig(workspaceDir) {
  try {
    /*
    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return;
    }

    const configDir = path.join(workspaceDir, '.config', 'claude');
    const configPath = path.join(configDir, 'config.json');

    const config = {
      auth: {
        method: 'api-key',
        apiKey,
        createdAt: new Date().toISOString()
      }
    };

    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    */
  } catch (error) {
    console.warn('Failed to ensure Claude CLI config:', error.message);
  }
}

module.exports = (io) => {
  console.log('Socket.IO server initialized for MindCode Terminal');
  
  io.on('connection', async (socket) => {
    console.log('✅ New client connected:', socket.id);

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
    const workspaceDir = path.join(__dirname, '../../user_projects', userId.toString(), projectId);
    console.log('📁 Terminal workspace:', workspaceDir);

    ensureClaudeCliConfig(workspaceDir).catch((error) => {
      console.warn('Unable to prepare Claude CLI config:', error.message);
    });
    
    // Determine shell based on platform
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    
    // Spawn PTY process
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: workspaceDir,
      env: {
        ...process.env,
        CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
        ANTHROPIC_API_KEY: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY,
        XDG_CONFIG_HOME: path.join(workspaceDir, '.config'),
        CLAUDE_CONFIG_DIR: path.join(workspaceDir, '.config', 'claude'),
        HOME: workspaceDir
      }
    });

    terminals[socket.id] = ptyProcess;
    inputBuffers[socket.id] = '';
    const projectRoom = `${userId}:${projectId}`;
    socket.join(projectRoom);
    const gitManager = new GitManager(workspaceDir);

    // Handle PTY spawn event
    ptyProcess.on('spawn', () => {
      console.log('✅ Terminal spawned for socket:', socket.id);
      
      setTimeout(() => {
        // Check if Claude is available and show welcome message
        checkClaudeAvailability().then(available => {
          if (available) {
            socket.emit('output', '\r\n✅ Claude Code が利用可能です\r\n');
            socket.emit('output', `📁 作業ディレクトリ: ${workspaceDir}\r\n\r\n`);
          } else {
            socket.emit('output', '\r\n⚠️  Claude Code が見つかりません。インストールが必要です。\r\n');
            socket.emit('output', '詳細: https://docs.anthropic.com/claude/docs/claude-code\r\n\r\n');
          }
        });
      }, 500);
    });

    // Handle PTY data output
    ptyProcess.on('data', (data) => {
      socket.emit('output', data);
    });

    // Handle user input
    socket.on('input', async (data) => {
      if (terminals[socket.id]) {
        terminals[socket.id].write(data);
      }

      const stringData = data.toString();
      if (!inputBuffers[socket.id]) {
        inputBuffers[socket.id] = '';
      }
      inputBuffers[socket.id] += stringData;

      const containsCR = stringData.includes('\r');
      const containsLF = stringData.includes('\n');

      if (containsCR || containsLF) {
        const segments = inputBuffers[socket.id].split(/\r?\n|\r/);
        inputBuffers[socket.id] = segments.pop();

        if (containsCR && !containsLF) {
          for (const segment of segments) {
            const cleaned = normalizeTerminalInput(segment);

            if (cleaned.length === 0) {
              continue;
            }

            try {
              if (await gitManager.isInitialized()) {
                try {
                  await gitManager.addFile('.');
                  const commitMessage = `Auto-commit before Claude prompt: ${cleaned.slice(0, 60)}`;
                  const commitResult = await gitManager.commit(
                    commitMessage,
                    userInfo.name || 'WebIDE User',
                    userInfo.email || 'webide@example.com'
                  );
                  if (!commitResult.success) {
                    console.log('Auto-commit skipped:', commitResult.message);
                  }
                } catch (gitError) {
                  console.warn('Auto-commit before Claude prompt failed:', gitError.message);
                }
              }

              await db.execute(
                'INSERT INTO claude_prompt_logs (project_id, user_id, prompt) VALUES (?, ?, ?)',
                [projectId, userId, cleaned]
              );
            } catch (logError) {
              console.warn('Failed to log terminal input:', logError.message);
            }
          }
        }
      }
    });

    // Handle terminal resize
    socket.on('resize', (size) => {
      if (terminals[socket.id]) {
        terminals[socket.id].resize(size.cols, size.rows);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('❌ Client disconnected:', socket.id);
      if (terminals[socket.id]) {
        terminals[socket.id].kill();
        delete terminals[socket.id];
      }
      if (inputBuffers[socket.id]) {
        delete inputBuffers[socket.id];
      }
    });
  });
};

// Helper function to check Claude availability
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
    
    // Timeout after 3 seconds
    setTimeout(() => {
      testProcess.kill();
      resolve(false);
    }, 3000);
  });
}
