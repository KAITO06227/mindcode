const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { spawn } = require('child_process');
const path = require('path');

const router = express.Router();

// Execute Claude Code command
router.post('/execute/:projectId', verifyToken, async (req, res) => {
  try {
    const { command, autoCommit = false } = req.body;
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);

    // Auto-commit before Claude Code execution if requested
    if (autoCommit) {
      await executeGitCommit(projectPath, 'Auto-commit before Claude Code execution');
    }

    // Execute Claude Code command
    const claudeProcess = spawn('claude-code', command.split(' '), {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    claudeProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    claudeProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    claudeProcess.on('close', (code) => {
      res.json({
        success: code === 0,
        stdout,
        stderr,
        exitCode: code
      });
    });

    // Send input to Claude Code if provided
    if (req.body.input) {
      claudeProcess.stdin.write(req.body.input);
      claudeProcess.stdin.end();
    }

  } catch (error) {
    res.status(500).json({ message: 'Error executing Claude Code' });
  }
});

// Start interactive Claude Code session
router.post('/session/:projectId', verifyToken, (req, res) => {
  try {
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    
    // This would require WebSocket implementation for real-time communication
    // For now, return session info
    res.json({
      sessionId: `claude_${req.user.id}_${req.params.projectId}_${Date.now()}`,
      projectPath,
      message: 'Claude Code session ready'
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting Claude Code session' });
  }
});

// Helper function for git commit
async function executeGitCommit(projectPath, message) {
  return new Promise((resolve, reject) => {
    const gitAdd = spawn('git', ['add', '.'], { cwd: projectPath });
    
    gitAdd.on('close', (code) => {
      if (code !== 0) return reject(new Error('Git add failed'));
      
      const gitCommit = spawn('git', ['commit', '-m', message], { cwd: projectPath });
      
      gitCommit.on('close', (code) => {
        // Code 0 = success, Code 1 = nothing to commit (both are fine)
        if (code === 0 || code === 1) {
          resolve();
        } else {
          reject(new Error('Git commit failed'));
        }
      });
    });
  });
}

module.exports = router;