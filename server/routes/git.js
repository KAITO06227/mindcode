const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { spawn } = require('child_process');
const path = require('path');
const db = require('../database/connection');

const router = express.Router();

// Initialize git repository
router.post('/init/:projectId', verifyToken, async (req, res) => {
  try {
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    
    const result = await executeGitCommand('init', [], projectPath);
    
    // Set up initial config
    await executeGitCommand('config', ['user.email', req.user.email], projectPath);
    await executeGitCommand('config', ['user.name', req.user.name], projectPath);
    
    res.json({ message: 'Git repository initialized', ...result });
  } catch (error) {
    res.status(500).json({ message: 'Error initializing git repository', error: error.message });
  }
});

// Get git status
router.get('/status/:projectId', verifyToken, async (req, res) => {
  try {
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    const result = await executeGitCommand('status', ['--porcelain'], projectPath);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error getting git status', error: error.message });
  }
});

// Add files to staging
router.post('/add/:projectId', verifyToken, async (req, res) => {
  try {
    const { files = ['.'] } = req.body;
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    
    const result = await executeGitCommand('add', files, projectPath);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error adding files', error: error.message });
  }
});

// Commit changes
router.post('/commit/:projectId', verifyToken, async (req, res) => {
  try {
    const { message } = req.body;
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    
    if (!message) {
      return res.status(400).json({ message: 'Commit message is required' });
    }
    
    const result = await executeGitCommand('commit', ['-m', message], projectPath);
    
    // Store commit in database
    const commitHash = await getLatestCommitHash(projectPath);
    await db.execute(
      'INSERT INTO git_commits (project_id, commit_hash, commit_message, commit_author, commit_date) VALUES (?, ?, ?, ?, NOW())',
      [req.params.projectId, commitHash, message, req.user.name]
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error committing changes', error: error.message });
  }
});

// Get commit history
router.get('/log/:projectId', verifyToken, async (req, res) => {
  try {
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    const result = await executeGitCommand('log', ['--oneline', '--graph', '-10'], projectPath);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error getting commit history', error: error.message });
  }
});

// Get branches
router.get('/branches/:projectId', verifyToken, async (req, res) => {
  try {
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    const result = await executeGitCommand('branch', ['-a'], projectPath);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error getting branches', error: error.message });
  }
});

// Create branch
router.post('/branch/:projectId', verifyToken, async (req, res) => {
  try {
    const { branchName } = req.body;
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    
    if (!branchName) {
      return res.status(400).json({ message: 'Branch name is required' });
    }
    
    const result = await executeGitCommand('checkout', ['-b', branchName], projectPath);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error creating branch', error: error.message });
  }
});

// Switch branch
router.post('/checkout/:projectId', verifyToken, async (req, res) => {
  try {
    const { branchName } = req.body;
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    
    if (!branchName) {
      return res.status(400).json({ message: 'Branch name is required' });
    }
    
    const result = await executeGitCommand('checkout', [branchName], projectPath);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error switching branch', error: error.message });
  }
});

// Set remote origin
router.post('/remote/:projectId', verifyToken, async (req, res) => {
  try {
    const { remoteUrl } = req.body;
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    
    if (!remoteUrl) {
      return res.status(400).json({ message: 'Remote URL is required' });
    }
    
    // Remove existing origin if it exists
    await executeGitCommand('remote', ['remove', 'origin'], projectPath).catch(() => {});
    
    // Add new origin
    const result = await executeGitCommand('remote', ['add', 'origin', remoteUrl], projectPath);
    
    // Update project git_url in database
    await db.execute(
      'UPDATE projects SET git_url = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
      [remoteUrl, req.params.projectId, req.user.id]
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error setting remote', error: error.message });
  }
});

// Push to remote
router.post('/push/:projectId', verifyToken, async (req, res) => {
  try {
    const { branch = 'main', setUpstream = false } = req.body;
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    
    const args = setUpstream ? ['push', '-u', 'origin', branch] : ['push', 'origin', branch];
    const result = await executeGitCommand('push', args.slice(1), projectPath);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error pushing to remote', error: error.message });
  }
});

// Pull from remote
router.post('/pull/:projectId', verifyToken, async (req, res) => {
  try {
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    const result = await executeGitCommand('pull', [], projectPath);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error pulling from remote', error: error.message });
  }
});

// Helper function to execute git commands
function executeGitCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const gitProcess = spawn('git', [command, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          output: stdout.trim(),
          error: stderr.trim()
        });
      } else {
        reject(new Error(stderr || `Git command failed with exit code ${code}`));
      }
    });
  });
}

// Helper function to get latest commit hash
async function getLatestCommitHash(projectPath) {
  try {
    const result = await executeGitCommand('rev-parse', ['HEAD'], projectPath);
    return result.output.trim();
  } catch (error) {
    return null;
  }
}

module.exports = router;