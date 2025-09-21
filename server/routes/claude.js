const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const db = require('../database/connection');

const router = express.Router();

// Store active Claude processes
const claudeProcesses = new Map();

async function ensureClaudeCliConfig(projectPath) {
  try {
    /*
    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return;
    }

    const configDir = path.join(projectPath, '.config', 'claude');
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

// Start Claude Code for a project
router.post('/start/:projectId', verifyToken, async (req, res) => {
  try {
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    const processKey = `${req.user.id}_${req.params.projectId}`;

    console.log(`Starting Claude Code for project: ${req.params.projectId} at ${projectPath}`);

    // Check if project directory exists
    try {
      await fs.access(projectPath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Project directory not found'
      });
    }

    // Check if already running
    const existingProcess = claudeProcesses.get(processKey);
    if (existingProcess && !existingProcess.killed) {
      return res.json({
        success: true,
        message: 'Claude Code already running'
      });
    }

    await ensureClaudeCliConfig(projectPath);

    // Start Claude Code
    const claudeProcess = spawn('npx', ['claude'], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
        ANTHROPIC_API_KEY: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY,
        XDG_CONFIG_HOME: path.join(projectPath, '.config'),
        CLAUDE_CONFIG_DIR: path.join(projectPath, '.config', 'claude'),
        HOME: projectPath
      }
    });

    // Log stdout for debugging
    claudeProcess.stdout.on('data', (data) => {
      console.log(`Claude stdout [${processKey}]:`, data.toString());
    });

    // Log stderr for debugging
    claudeProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`Claude stderr [${processKey}]:`, output);
      
      // Check for specific errors
      if (output.includes('command not found')) {
        console.error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
      }
      if (output.includes('ENOENT')) {
        console.error('npx or claude command not found in PATH');
      }
    });

    claudeProcess.on('error', (error) => {
      console.error(`Claude process error for ${processKey}:`, error);
      console.error('Error code:', error.code);
      console.error('Error signal:', error.signal);
      claudeProcesses.delete(processKey);
    });

    claudeProcess.on('close', (code, signal) => {
      console.log(`Claude process ${processKey} exited with code: ${code}, signal: ${signal}`);
      claudeProcesses.delete(processKey);
    });

    // Store the process with metadata
    claudeProcess.spawnedAt = new Date().toISOString();
    claudeProcesses.set(processKey, claudeProcess);

    res.json({
      success: true,
      message: 'Claude Code started'
    });

  } catch (error) {
    console.error('Error starting Claude Code:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error starting Claude Code',
      error: error.message
    });
  }
});

// Send message to Claude Code
router.post('/send/:projectId', verifyToken, async (req, res) => {
  try {
    const { message } = req.body;
    const processKey = `${req.user.id}_${req.params.projectId}`;

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Verify project ownership before forwarding to Claude
    const [projects] = await db.execute(
      'SELECT id FROM projects WHERE id = ? AND user_id = ?',
      [req.params.projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Project not found or access denied'
      });
    }

    console.log(`Sending message to Claude: ${message}`);

    // Get Claude process
    const claudeProcess = claudeProcesses.get(processKey);
    
    if (!claudeProcess || claudeProcess.killed) {
      return res.status(400).json({
        success: false,
        message: 'Claude Code not running'
      });
    }

    // Log prompt before sending
    try {
      await db.execute(
        'INSERT INTO claude_prompt_logs (project_id, user_id, prompt) VALUES (?, ?, ?)',
        [req.params.projectId, req.user.id, message.trim()]
      );
    } catch (logError) {
      console.warn('Failed to log Claude prompt:', logError.message);
    }

    // Send message
    claudeProcess.stdin.write(message + '\n');

    res.json({
      success: true,
      message: 'Message sent to Claude Code'
    });

  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error sending message',
      error: error.message
    });
  }
});

// Check Claude Code status
router.get('/status/:projectId', verifyToken, (req, res) => {
  try {
    const processKey = `${req.user.id}_${req.params.projectId}`;
    const claudeProcess = claudeProcesses.get(processKey);
    
    console.log(`Status check for: ${processKey}`);
    console.log(`Active processes:`, Array.from(claudeProcesses.keys()));
    
    if (!claudeProcess) {
      return res.json({
        success: false,
        status: 'not_started',
        message: 'Claude Code has not been started for this project',
        activeProcesses: Array.from(claudeProcesses.keys())
      });
    }
    
    if (claudeProcess.killed) {
      return res.json({
        success: false,
        status: 'terminated',
        message: 'Claude Code process has been terminated'
      });
    }
    
    res.json({
      success: true,
      status: 'running',
      message: 'Claude Code is running',
      pid: claudeProcess.pid,
      processKey: processKey,
      spawnedAt: claudeProcess.spawnedAt || 'unknown'
    });
    
  } catch (error) {
    console.error('Error checking Claude status:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Error checking Claude Code status',
      error: error.message
    });
  }
});

// Get Claude Code output (Server-Sent Events)
router.get('/stream/:projectId', verifyToken, (req, res) => {
  try {
    const processKey = `${req.user.id}_${req.params.projectId}`;
    console.log(`SSE connection request for: ${processKey}`);
    
    const claudeProcess = claudeProcesses.get(processKey);
    
    if (!claudeProcess) {
      console.log(`No Claude process found for: ${processKey}`);
      return res.status(400).json({
        success: false,
        message: 'Claude Code not started'
      });
    }
    
    if (claudeProcess.killed) {
      console.log(`Claude process killed for: ${processKey}`);
      return res.status(400).json({
        success: false,
        message: 'Claude Code process terminated'
      });
    }

    console.log(`Setting up SSE for: ${processKey}, PID: ${claudeProcess.pid}`);

    // Set up Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection message
    console.log(`Sending connected message for: ${processKey}`);
    res.write('data: {"type": "connected"}\n\n');

    // Send heartbeat every 30 seconds
    const heartbeatInterval = setInterval(() => {
      if (!res.destroyed) {
        res.write('data: {"type": "heartbeat"}\n\n');
      }
    }, 30000);

    // Forward stdout
    const onStdout = (data) => {
      const message = JSON.stringify({
        type: 'stdout',
        data: data.toString()
      });
      if (!res.destroyed) {
        res.write(`data: ${message}\n\n`);
      }
    };

    // Forward stderr
    const onStderr = (data) => {
      const message = JSON.stringify({
        type: 'stderr', 
        data: data.toString()
      });
      if (!res.destroyed) {
        res.write(`data: ${message}\n\n`);
      }
    };

    claudeProcess.stdout.on('data', onStdout);
    claudeProcess.stderr.on('data', onStderr);

    // Handle process end
    const onClose = () => {
      console.log(`Claude process closed for: ${processKey}`);
      if (!res.destroyed) {
        res.write('data: {"type": "closed"}\n\n');
        res.end();
      }
    };

    claudeProcess.on('close', onClose);

    // Clean up on client disconnect
    req.on('close', () => {
      console.log(`Client disconnected from SSE: ${processKey}`);
      clearInterval(heartbeatInterval);
      claudeProcess.stdout.removeListener('data', onStdout);
      claudeProcess.stderr.removeListener('data', onStderr);
      claudeProcess.removeListener('close', onClose);
      if (!res.destroyed) {
        res.end();
      }
    });

    req.on('aborted', () => {
      console.log(`Client aborted SSE connection: ${processKey}`);
      clearInterval(heartbeatInterval);
      claudeProcess.stdout.removeListener('data', onStdout);
      claudeProcess.stderr.removeListener('data', onStderr);
      claudeProcess.removeListener('close', onClose);
      if (!res.destroyed) {
        res.end();
      }
    });

  } catch (error) {
    console.error('Error streaming output:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error streaming output',
      error: error.message
    });
  }
});

// Simple Claude Code execution endpoint
router.post('/execute/:projectId', verifyToken, async (req, res) => {
  try {
    const { prompt } = req.body;
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);

    console.log(`Executing Claude Code for project: ${req.params.projectId}`);
    console.log(`Prompt: ${prompt}`);

    // Check if project directory exists
    try {
      await fs.access(projectPath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: 'プロジェクトディレクトリが見つかりません'
      });
    }

    // Execute Claude Code command
    const claudeProcess = spawn('claude', [prompt], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000 // 30秒タイムアウト
    });

    let stdout = '';
    let stderr = '';

    // Collect output
    claudeProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    claudeProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Handle process completion
    claudeProcess.on('close', (code) => {
      console.log(`Claude process exited with code: ${code}`);
      
      if (code === 0) {
        res.json({
          success: true,
          output: stdout,
          error: stderr || null,
          files_changed: [] // TODO: ファイル変更検出を実装
        });
      } else {
        res.json({
          success: false,
          error: stderr || 'Claude Code実行エラー',
          output: stdout
        });
      }
    });

    // Handle process errors
    claudeProcess.on('error', (error) => {
      console.error('Claude process error:', error);
      
      if (error.code === 'ENOENT') {
        res.json({
          success: false,
          error: 'Claude CLIがインストールされていません。\nnpm install -g @anthropic-ai/claude-code でインストールしてください。'
        });
      } else {
        res.json({
          success: false,
          error: `Claude実行エラー: ${error.message}`
        });
      }
    });

    // Handle timeout
    setTimeout(() => {
      if (!claudeProcess.killed) {
        claudeProcess.kill('SIGTERM');
        res.json({
          success: false,
          error: 'Claude Code実行がタイムアウトしました（30秒）'
        });
      }
    }, 30000);

  } catch (error) {
    console.error('Error executing Claude Code:', error);
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
