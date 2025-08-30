const pty = require('node-pty');
const path = require('path');
const { spawn } = require('child_process');

// Store active terminal sessions
const terminals = {};

module.exports = (io) => {
  console.log('Socket.IO server initialized for MindCode Terminal');
  
  io.on('connection', (socket) => {
    console.log('✅ New client connected:', socket.id);
    
    const { projectId, terminalType } = socket.handshake.query;
    
    if (!projectId) {
      console.error('❌ No project ID provided');
      socket.emit('claude_error', { message: 'Project ID is required' });
      socket.disconnect();
      return;
    }

    // Create project workspace directory
    const workspaceDir = path.join(__dirname, '../../user_projects/1', projectId);
    console.log('📁 Terminal workspace:', workspaceDir);
    console.log('🔧 Terminal type:', terminalType || 'claude');
    
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
        CLAUDE_API_KEY: process.env.CLAUDE_API_KEY
      }
    });

    terminals[socket.id] = ptyProcess;

    // Handle PTY spawn event
    ptyProcess.on('spawn', () => {
      console.log('✅ Terminal spawned for socket:', socket.id);
      
      setTimeout(() => {
        if (terminalType === 'server') {
          // Server terminal welcome message
          socket.emit('output', '\r\n🚀 MindCode Server Terminal が利用可能です\r\n');
          socket.emit('output', `📁 作業ディレクトリ: ${workspaceDir}\r\n`);
          socket.emit('output', '💡 Node.js コマンドの実行が可能です:\r\n');
          socket.emit('output', '   - npm install    (依存関係をインストール)\r\n');
          socket.emit('output', '   - npm run dev    (開発サーバー起動)\r\n');
          socket.emit('output', '   - npm start      (プロダクションサーバー起動)\r\n');
          socket.emit('output', '   - node server.js (サーバー直接起動)\r\n\r\n');
        } else {
          // Claude Code terminal welcome message
          checkClaudeAvailability().then(available => {
            if (available) {
              socket.emit('output', '\r\n✅ Claude Code が利用可能です\r\n');
              socket.emit('output', `📁 作業ディレクトリ: ${workspaceDir}\r\n\r\n`);
            } else {
              socket.emit('output', '\r\n⚠️  Claude Code が見つかりません。インストールが必要です。\r\n');
              socket.emit('output', '詳細: https://docs.anthropic.com/claude/docs/claude-code\r\n\r\n');
            }
          });
        }
      }, 500);
    });

    // Handle PTY data output
    ptyProcess.on('data', (data) => {
      socket.emit('output', data);
    });

    // Handle user input
    socket.on('input', (data) => {
      if (terminals[socket.id]) {
        terminals[socket.id].write(data);
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