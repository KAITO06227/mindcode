const express = require('express');
const { verifyToken } = require('../middleware/auth');
const db = require('../database/connection');
const GitManager = require('../utils/gitManager');
const path = require('path');
const fs = require('fs').promises;

const router = express.Router();

/**
 * Helper function to get or create git repository record
 */
async function getOrCreateGitRepo(projectId, userId) {
  try {
    let [repos] = await db.execute(
      'SELECT * FROM git_repositories WHERE project_id = ?',
      [projectId]
    );

    if (repos.length === 0) {
      await db.execute(
        'INSERT INTO git_repositories (project_id) VALUES (?)',
        [projectId]
      );
      [repos] = await db.execute(
        'SELECT * FROM git_repositories WHERE project_id = ?',
        [projectId]
      );
    }

    return repos[0];
  } catch (error) {
    console.error('git_repositories table not found:', error.message);
    throw new Error(`Database schema not properly initialized. Please run database migration: ${error.message}`);
  }
}

// POST /api/version-control/:projectId/init - Initialize Git repository
router.post('/:projectId/init', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { userName, userEmail } = req.body;

    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    const gitManager = new GitManager(projectPath);

    // Check if already initialized
    if (await gitManager.isInitialized()) {
      return res.status(400).json({ message: 'Git repository already initialized' });
    }

    // Initialize repository
    const result = await gitManager.initRepository(
      userName || req.user.name,
      userEmail || req.user.email
    );

    // Update database
    await db.execute(`
      UPDATE git_repositories 
      SET is_initialized = TRUE, 
          git_user_name = ?, 
          git_user_email = ?, 
          current_branch = 'main',
          updated_at = NOW()
      WHERE project_id = ?`,
      [userName || req.user.name, userEmail || req.user.email, projectId]
    );

    res.json({
      message: 'Git repository initialized successfully',
      ...result
    });

  } catch (error) {
    console.error('Error initializing Git repository:', error);
    res.status(500).json({ 
      message: 'Error initializing Git repository',
      error: error.message 
    });
  }
});

// GET /api/version-control/:projectId/status - Get Git status
router.get('/:projectId/status', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;

    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    const gitManager = new GitManager(projectPath);

    if (!await gitManager.isInitialized()) {
      return res.status(400).json({ 
        message: 'Git repository not initialized',
        initialized: false 
      });
    }

    const status = await gitManager.getStatus();
    const gitRepo = await getOrCreateGitRepo(projectId, req.user.id);

    res.json({
      initialized: true,
      ...status,
      gitRepo
    });

  } catch (error) {
    console.error('Error getting Git status:', error);
    res.status(500).json({ 
      message: 'Error getting Git status',
      error: error.message 
    });
  }
});

// POST /api/version-control/:projectId/commit - Create commit
router.post('/:projectId/commit', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { message, files = [] } = req.body; // files array is optional, commits all if empty

    if (!message) {
      return res.status(400).json({ message: 'Commit message is required' });
    }

    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    const gitManager = new GitManager(projectPath);

    if (!await gitManager.isInitialized()) {
      return res.status(400).json({ message: 'Git repository not initialized' });
    }

    // Add files to staging area
    if (files.length > 0) {
      for (const filePath of files) {
        await gitManager.addFile(filePath);
      }
    } else {
      // Add all changes
      await gitManager.addFile('.');
    }

    // Commit changes
    const result = await gitManager.commit(message, req.user.name, req.user.email);

    if (result.success) {
      // Update database records
      await db.execute(`
        UPDATE git_repositories 
        SET last_commit_hash = ?, updated_at = NOW()
        WHERE project_id = ?`,
        [result.commitHash, projectId]
      );

      // Update file versions with commit hash
      if (files.length > 0) {
        for (const filePath of files) {
          await db.execute(`
            UPDATE file_versions fv
            JOIN project_files pf ON fv.file_id = pf.id
            SET fv.git_commit_hash = ?
            WHERE pf.project_id = ? AND pf.file_path = ? 
            AND fv.version_number = (
              SELECT MAX(version_number) FROM file_versions fv2 WHERE fv2.file_id = fv.file_id
            )`,
            [result.commitHash, projectId, filePath]
          );
        }
      } else {
        await db.execute(`
          UPDATE file_versions fv
          JOIN project_files pf ON fv.file_id = pf.id
          SET fv.git_commit_hash = ?
          WHERE pf.project_id = ? AND fv.git_commit_hash IS NULL`,
          [result.commitHash, projectId]
        );
      }

      // Save commit to database
      await db.execute(`
        INSERT INTO git_commits 
        (project_id, commit_hash, commit_message, commit_author, commit_date)
        VALUES (?, ?, ?, ?, NOW())`,
        [projectId, result.commitHash, message, req.user.name]
      );
    }

    res.json(result);

  } catch (error) {
    console.error('Error creating commit:', error);
    res.status(500).json({ 
      message: 'Error creating commit',
      error: error.message 
    });
  }
});

// GET /api/version-control/:projectId/history - Get commit history
router.get('/:projectId/history', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { limit = 20 } = req.query;

    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    const gitManager = new GitManager(projectPath);

    if (!await gitManager.isInitialized()) {
      return res.status(400).json({ message: 'Git repository not initialized' });
    }

    // Get history from Git
    const gitHistory = await gitManager.getCommitHistory(parseInt(limit));
    
    // Get additional info from database
    const limitValue = parseInt(limit) || 20;
    const [dbCommits] = await db.execute(`
      SELECT commit_hash, commit_message, commit_author, commit_date, created_at
      FROM git_commits 
      WHERE project_id = ? 
      ORDER BY commit_date DESC 
      LIMIT ${limitValue}`,
      [projectId]
    );

    // Merge Git and database information
    const history = gitHistory.map(gitCommit => {
      const dbCommit = dbCommits.find(db => db.commit_hash === gitCommit.hash);
      return {
        ...gitCommit,
        storedInDb: !!dbCommit,
        ...(dbCommit && { dbCreatedAt: dbCommit.created_at })
      };
    });

    res.json(history);

  } catch (error) {
    console.error('Error getting commit history:', error);
    res.status(500).json({ 
      message: 'Error getting commit history',
      error: error.message 
    });
  }
});

// GET /api/version-control/:projectId/diff - Get file diff
router.get('/:projectId/diff', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { filePath, commitHash } = req.query;

    if (!filePath) {
      return res.status(400).json({ message: 'filePath query parameter is required' });
    }

    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    const gitManager = new GitManager(projectPath);

    if (!await gitManager.isInitialized()) {
      return res.status(400).json({ message: 'Git repository not initialized' });
    }

    const diff = await gitManager.getDiff(filePath, commitHash);

    res.json({
      filePath,
      commitHash: commitHash || 'current',
      diff
    });

  } catch (error) {
    console.error('Error getting diff:', error);
    res.status(500).json({ 
      message: 'Error getting diff',
      error: error.message 
    });
  }
});

// GET /api/version-control/:projectId/file-at-commit - Get file content at specific commit
router.get('/:projectId/file-at-commit', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { filePath, commitHash } = req.query;

    if (!filePath || !commitHash) {
      return res.status(400).json({ 
        message: 'filePath and commitHash query parameters are required' 
      });
    }

    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    const gitManager = new GitManager(projectPath);

    if (!await gitManager.isInitialized()) {
      return res.status(400).json({ message: 'Git repository not initialized' });
    }

    const content = await gitManager.getFileAtCommit(filePath, commitHash);

    if (content === null) {
      return res.status(404).json({ message: 'File not found at specified commit' });
    }

    res.json({
      filePath,
      commitHash,
      content
    });

  } catch (error) {
    console.error('Error getting file at commit:', error);
    res.status(500).json({ 
      message: 'Error getting file at commit',
      error: error.message 
    });
  }
});

// GET /api/version-control/:projectId/branches - Get branches
router.get('/:projectId/branches', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;

    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    const gitManager = new GitManager(projectPath);

    if (!await gitManager.isInitialized()) {
      return res.status(400).json({ message: 'Git repository not initialized' });
    }

    const branches = await gitManager.getBranches();

    res.json(branches);

  } catch (error) {
    console.error('Error getting branches:', error);
    res.status(500).json({ 
      message: 'Error getting branches',
      error: error.message 
    });
  }
});

// POST /api/version-control/:projectId/checkout - Switch branch
router.post('/:projectId/checkout', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { branchName } = req.body;

    if (!branchName) {
      return res.status(400).json({ message: 'branchName is required' });
    }

    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    const gitManager = new GitManager(projectPath);

    if (!await gitManager.isInitialized()) {
      return res.status(400).json({ message: 'Git repository not initialized' });
    }

    const result = await gitManager.switchBranch(branchName);

    // Update current branch in database
    await db.execute(`
      UPDATE git_repositories 
      SET current_branch = ?, updated_at = NOW()
      WHERE project_id = ?`,
      [branchName, projectId]
    );

    res.json(result);

  } catch (error) {
    console.error('Error switching branch:', error);
    res.status(500).json({ 
      message: 'Error switching branch',
      error: error.message 
    });
  }
});

// POST /api/version-control/:projectId/restore - Restore to specific commit
router.post('/:projectId/restore', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { commitHash } = req.body;

    if (!commitHash) {
      return res.status(400).json({ message: 'commitHash is required' });
    }

    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    const gitManager = new GitManager(projectPath);

    if (!await gitManager.isInitialized()) {
      return res.status(400).json({ message: 'Git repository not initialized' });
    }

    // Get list of files in the commit
    const { promisify } = require('util');
    const exec = promisify(require('child_process').exec);
    const { stdout: fileList } = await exec(
      `git ls-tree -r --name-only ${commitHash}`,
      { cwd: projectPath }
    );

    const files = fileList.trim().split('\n').filter(file => file);
    const commitFileSet = new Set(files);
    const [existingRecords] = await db.execute(
      'SELECT id, file_path, file_type FROM project_files WHERE project_id = ?',
      [projectId]
    );

    const existingFileRecords = existingRecords.filter(record => record.file_type !== 'folder');
    const existingFolderRecords = existingRecords.filter(record => record.file_type === 'folder');

    const restoredFiles = [];

    // Restore each file from the commit
    for (const filePath of files) {
      try {
        const fileContent = await gitManager.getFileAtCommit(filePath, commitHash);
        if (fileContent !== null) {
          // Write to filesystem
          const fullPath = path.join(projectPath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, fileContent);

          // Update database
          const fileName = path.basename(filePath);
          const checksum = require('crypto').createHash('sha256').update(fileContent).digest('hex');
          const fileSize = Buffer.byteLength(fileContent, 'utf8');

          const [existingFiles] = await db.execute(
            'SELECT * FROM project_files WHERE project_id = ? AND file_path = ?',
            [projectId, filePath]
          );

          if (existingFiles.length > 0) {
            // Update existing file
            await db.execute(`
              UPDATE project_files 
              SET content = ?, file_size = ?, checksum = ?, updated_by = ?, updated_at = NOW()
              WHERE project_id = ? AND file_path = ?`,
              [fileContent, fileSize, checksum, req.user.id, projectId, filePath]
            );
          } else {
            // Create new file record
            const fileType = path.extname(fileName).slice(1) || 'text';
            await db.execute(`
              INSERT INTO project_files 
              (project_id, file_path, file_name, content, file_type, file_size, 
               checksum, is_binary, created_by, updated_by) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [projectId, filePath, fileName, fileContent, fileType, fileSize, 
               checksum, false, req.user.id, req.user.id]
            );
          }

          restoredFiles.push(filePath);
        }
      } catch (fileError) {
        console.error(`Failed to restore file ${filePath}:`, fileError);
      }
    }

    // Remove files that are not part of the target commit
    for (const record of existingFileRecords) {
      if (!commitFileSet.has(record.file_path)) {
        const absolutePath = path.join(projectPath, record.file_path);
        try {
          await fs.rm(absolutePath, { force: true });
        } catch (removeError) {
          console.warn(`Failed to remove file ${absolutePath}:`, removeError.message);
        }
        await db.execute('DELETE FROM project_files WHERE id = ?', [record.id]);
      }
    }

    // Ensure folder records exist for all directories in the commit
    const folderPaths = new Set();
    for (const filePath of files) {
      let currentDir = path.posix.dirname(filePath);
      while (currentDir && currentDir !== '.' && !folderPaths.has(currentDir)) {
        folderPaths.add(currentDir);
        const parent = path.posix.dirname(currentDir);
        if (parent === currentDir) {
          break;
        }
        currentDir = parent;
      }
    }

    const existingFolderMap = new Map(existingFolderRecords.map(record => [record.file_path, record]));

    for (const folderPath of folderPaths) {
      if (!existingFolderMap.has(folderPath)) {
        await db.execute(`
          INSERT INTO project_files 
          (project_id, file_path, file_name, content, file_type, file_size, 
           permissions, checksum, is_binary, created_by, updated_by) 
          VALUES (?, ?, ?, '', 'folder', 0, 'rwxr-xr-x', '', false, ?, ?)
        `,
        [projectId, folderPath, path.posix.basename(folderPath), req.user.id, req.user.id]);
      }
    }

    // Remove folders that no longer exist in the target commit
    const foldersToRemove = existingFolderRecords
      .filter(record => record.file_path && !folderPaths.has(record.file_path))
      .sort((a, b) => b.file_path.length - a.file_path.length);

    for (const folderRecord of foldersToRemove) {
      await db.execute('DELETE FROM project_files WHERE id = ?', [folderRecord.id]);
      const absoluteFolderPath = path.join(projectPath, folderRecord.file_path);
      try {
        await fs.rm(absoluteFolderPath, { recursive: true, force: true });
      } catch (removeFolderError) {
        console.warn(`Failed to remove folder ${absoluteFolderPath}:`, removeFolderError.message);
      }
    }

    res.json({
      message: 'Files restored successfully',
      commitHash,
      restoredFiles,
      restoredCount: restoredFiles.length
    });

  } catch (error) {
    console.error('Error restoring commit:', error);
    res.status(500).json({ 
      message: 'Error restoring commit',
      error: error.message 
    });
  }
});

module.exports = router;
