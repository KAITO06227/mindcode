const express = require('express');
const { verifyToken } = require('../middleware/auth');
const db = require('../database/connection');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    await fs.mkdir(projectPath, { recursive: true });
    cb(null, projectPath);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

// Get project file tree
router.get('/tree/:projectId', verifyToken, async (req, res) => {
  try {
    const [files] = await db.execute(
      `SELECT pf.*, p.user_id FROM project_files pf 
       JOIN projects p ON pf.project_id = p.id 
       WHERE pf.project_id = ? AND p.user_id = ?
       ORDER BY pf.file_path`,
      [req.params.projectId, req.user.id]
    );

    // Build tree structure
    const tree = buildFileTree(files);
    res.json(tree);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching file tree' });
  }
});

// Get file content
router.get('/:projectId/:fileId', verifyToken, async (req, res) => {
  try {
    const [files] = await db.execute(
      `SELECT pf.*, p.user_id FROM project_files pf 
       JOIN projects p ON pf.project_id = p.id 
       WHERE pf.id = ? AND pf.project_id = ? AND p.user_id = ?`,
      [req.params.fileId, req.params.projectId, req.user.id]
    );

    if (files.length === 0) {
      return res.status(404).json({ message: 'File not found' });
    }

    res.json(files[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching file' });
  }
});

// Create new file/folder
router.post('/:projectId', verifyToken, async (req, res) => {
  try {
    const { fileName, filePath, content = '', fileType, isFolder = false } = req.body;
    
    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [req.params.projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const fullPath = filePath ? `${filePath}/${fileName}` : fileName;
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    const fullFilePath = path.join(projectPath, fullPath);

    if (isFolder) {
      await fs.mkdir(fullFilePath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(fullFilePath), { recursive: true });
      await fs.writeFile(fullFilePath, content);
    }

    // Save to database
    const [result] = await db.execute(
      'INSERT INTO project_files (project_id, file_path, file_name, content, file_type) VALUES (?, ?, ?, ?, ?)',
      [req.params.projectId, fullPath, fileName, isFolder ? '' : content, fileType || getFileType(fileName)]
    );

    const [newFile] = await db.execute('SELECT * FROM project_files WHERE id = ?', [result.insertId]);
    res.status(201).json(newFile[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating file' });
  }
});

// Update file content
router.put('/:projectId/:fileId', verifyToken, async (req, res) => {
  try {
    const { content } = req.body;
    
    const [files] = await db.execute(
      `SELECT pf.*, p.user_id FROM project_files pf 
       JOIN projects p ON pf.project_id = p.id 
       WHERE pf.id = ? AND pf.project_id = ? AND p.user_id = ?`,
      [req.params.fileId, req.params.projectId, req.user.id]
    );

    if (files.length === 0) {
      return res.status(404).json({ message: 'File not found' });
    }

    const file = files[0];
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    const fullFilePath = path.join(projectPath, file.file_path);

    // Update file system
    await fs.writeFile(fullFilePath, content);

    // Update database
    await db.execute(
      'UPDATE project_files SET content = ?, updated_at = NOW() WHERE id = ?',
      [content, req.params.fileId]
    );

    // Update project timestamp
    await db.execute(
      'UPDATE projects SET updated_at = NOW() WHERE id = ?',
      [req.params.projectId]
    );

    res.json({ message: 'File updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating file' });
  }
});

// Delete file/folder
router.delete('/:projectId/:fileId', verifyToken, async (req, res) => {
  try {
    const [files] = await db.execute(
      `SELECT pf.*, p.user_id FROM project_files pf 
       JOIN projects p ON pf.project_id = p.id 
       WHERE pf.id = ? AND pf.project_id = ? AND p.user_id = ?`,
      [req.params.fileId, req.params.projectId, req.user.id]
    );

    if (files.length === 0) {
      return res.status(404).json({ message: 'File not found' });
    }

    const file = files[0];
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    const fullFilePath = path.join(projectPath, file.file_path);

    // Delete from file system
    try {
      const stats = await fs.stat(fullFilePath);
      if (stats.isDirectory()) {
        await fs.rmdir(fullFilePath, { recursive: true });
      } else {
        await fs.unlink(fullFilePath);
      }
    } catch (error) {
      // File might not exist, continue with database deletion
    }

    // Delete from database
    await db.execute('DELETE FROM project_files WHERE id = ?', [req.params.fileId]);

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting file' });
  }
});

// Rename file/folder
router.patch('/:projectId/:fileId/rename', verifyToken, async (req, res) => {
  try {
    const { newName } = req.body;
    
    const [files] = await db.execute(
      `SELECT pf.*, p.user_id FROM project_files pf 
       JOIN projects p ON pf.project_id = p.id 
       WHERE pf.id = ? AND pf.project_id = ? AND p.user_id = ?`,
      [req.params.fileId, req.params.projectId, req.user.id]
    );

    if (files.length === 0) {
      return res.status(404).json({ message: 'File not found' });
    }

    const file = files[0];
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.projectId);
    const oldPath = path.join(projectPath, file.file_path);
    const newPath = path.join(projectPath, path.dirname(file.file_path), newName);

    // Rename in file system
    await fs.rename(oldPath, newPath);

    // Update database
    const newFilePath = path.join(path.dirname(file.file_path), newName).replace(/\\/g, '/');
    await db.execute(
      'UPDATE project_files SET file_path = ?, file_name = ?, updated_at = NOW() WHERE id = ?',
      [newFilePath, newName, req.params.fileId]
    );

    res.json({ message: 'File renamed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error renaming file' });
  }
});

// Upload files
router.post('/:projectId/upload', verifyToken, upload.array('files'), async (req, res) => {
  try {
    const uploadedFiles = [];

    for (const file of req.files) {
      const content = await fs.readFile(file.path, 'utf-8').catch(() => ''); // Binary files will be empty string
      
      const [result] = await db.execute(
        'INSERT INTO project_files (project_id, file_path, file_name, content, file_type) VALUES (?, ?, ?, ?, ?)',
        [req.params.projectId, file.filename, file.filename, content, getFileType(file.filename)]
      );

      uploadedFiles.push({
        id: result.insertId,
        filename: file.filename,
        size: file.size
      });
    }

    res.json({ files: uploadedFiles });
  } catch (error) {
    res.status(500).json({ message: 'Error uploading files' });
  }
});

// Helper functions
function buildFileTree(files) {
  const tree = {};
  
  files.forEach(file => {
    const parts = file.file_path.split('/');
    let current = tree;
    
    parts.forEach((part, index) => {
      if (!current[part]) {
        current[part] = {
          name: part,
          type: index === parts.length - 1 ? 'file' : 'folder',
          path: parts.slice(0, index + 1).join('/'),
          children: {},
          ...(index === parts.length - 1 && { 
            id: file.id,
            content: file.content,
            fileType: file.file_type 
          })
        };
      }
      current = current[part].children;
    });
  });
  
  return tree;
}

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const typeMap = {
    '.js': 'javascript',
    '.html': 'html',
    '.css': 'css',
    '.json': 'json',
    '.md': 'markdown',
    '.txt': 'text',
    '.py': 'python',
    '.java': 'java',
    '.php': 'php',
    '.xml': 'xml'
  };
  return typeMap[ext] || 'text';
}

module.exports = router;