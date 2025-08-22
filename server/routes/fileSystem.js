const express = require('express');
const { verifyToken } = require('../middleware/auth');
const db = require('../database/connection');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const GitManager = require('../utils/gitManager');
const crypto = require('crypto');

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

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * Helper function to calculate file checksum
 */
function calculateChecksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Helper function to get file type from extension
 */
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
    '.xml': 'xml',
    '.yml': 'yaml',
    '.yaml': 'yaml'
  };
  return typeMap[ext] || 'text';
}

/**
 * Helper function to check if file is binary
 */
function isBinaryFile(content) {
  // Simple check for binary content
  for (let i = 0; i < Math.min(512, content.length); i++) {
    const charCode = content.charCodeAt(i);
    if (charCode === 0 || (charCode < 32 && charCode !== 9 && charCode !== 10 && charCode !== 13)) {
      return true;
    }
  }
  return false;
}

/**
 * Log file access
 */
async function logFileAccess(fileId, userId, accessType, req) {
  try {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    await db.execute(
      'INSERT INTO file_access_logs (file_id, user_id, access_type, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
      [fileId, userId, accessType, ipAddress, userAgent]
    );
  } catch (error) {
    console.error('Failed to log file access:', error);
    // Don't fail the main operation if logging fails
  }
}

// POST /api/filesystem/:projectId/files - Create or update file/folder
router.post('/:projectId/files', verifyToken, async (req, res) => {
  try {
    const { filePath, fileName, content = '', isFolder = false } = req.body;
    const projectId = req.params.projectId;
    
    console.log('File/Folder save request:', { filePath, fileName, contentLength: content.length, isFolder });
    
    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    // パス構築：filePathの扱いを修正
    let relativeFilePath;
    if (filePath && filePath.trim()) {
      // filePathが既にfileNameを含む完全パスかチェック
      if (filePath.endsWith(fileName)) {
        // 既に完全パス（既存ファイルの更新）
        relativeFilePath = filePath;
      } else {
        // 親ディレクトリのみ（新規ファイル作成）
        relativeFilePath = path.join(filePath, fileName);
      }
    } else {
      // filePathがない場合（ルートディレクトリ）
      relativeFilePath = fileName;
    }
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    const fullFilePath = path.join(projectPath, relativeFilePath);
    
    console.log('Paths:', { projectPath, relativeFilePath, fullFilePath, isFolder });
    
    if (isFolder) {
      // フォルダの場合
      await fs.mkdir(fullFilePath, { recursive: true });
      console.log('Folder created successfully:', fullFilePath);
      
      // フォルダは内容がないのでダミーデータを設定
      const checksum = '';
      const fileSize = 0;
      const fileType = 'folder';
      const isBinary = false;
      
      // フォルダをデータベースに記録する（ファイルとして扱うが、typeで判別）
      const [result] = await db.execute(`
        INSERT INTO project_files 
        (project_id, file_path, file_name, content, file_type, file_size, 
         permissions, checksum, is_binary, created_by, updated_by) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [projectId, relativeFilePath, fileName, '', fileType, fileSize, 
         'rwxr-xr-x', checksum, isBinary, req.user.id, req.user.id]
      );
      
      const folderId = result.insertId;
      
      // Create initial version record
      await db.execute(`
        INSERT INTO file_versions 
        (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
        VALUES (?, 1, ?, ?, 'create', 'Folder created via API', ?)`,
        [folderId, fileSize, checksum, req.user.id]
      );
      
      // Log access
      await logFileAccess(folderId, req.user.id, 'write', req);
      
      return res.status(201).json({
        id: folderId,
        filePath: relativeFilePath,
        fileName,
        fileSize,
        checksum,
        fileType,
        isFolder: true
      });
    }
    
    // ファイルの場合の処理
    // Calculate file metadata
    const checksum = calculateChecksum(content);
    const fileSize = Buffer.byteLength(content, 'utf8');
    const fileType = getFileType(fileName);
    const isBinary = isBinaryFile(content);

    // Create parent directories if needed
    const parentDir = path.dirname(fullFilePath);
    await fs.mkdir(parentDir, { recursive: true });

    // Write file to disk
    await fs.writeFile(fullFilePath, content);
    console.log('File written successfully:', fullFilePath);

    // Check if file exists in database
    const [existingFiles] = await db.execute(
      'SELECT * FROM project_files WHERE project_id = ? AND file_path = ?',
      [projectId, relativeFilePath]
    );

    let fileId;
    let isUpdate = existingFiles.length > 0;

    if (isUpdate) {
      // Update existing file
      fileId = existingFiles[0].id;
      await db.execute(`
        UPDATE project_files 
        SET content = ?, file_size = ?, checksum = ?, 
            file_type = ?, is_binary = ?, updated_by = ?, updated_at = NOW()
        WHERE id = ?`,
        [content, fileSize, checksum, fileType, isBinary, req.user.id, fileId]
      );
      
      // Create version record
      const [versionResult] = await db.execute(
        'SELECT MAX(version_number) as max_version FROM file_versions WHERE file_id = ?',
        [fileId]
      );
      const nextVersion = (versionResult[0].max_version || 0) + 1;
      
      await db.execute(`
        INSERT INTO file_versions 
        (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
        VALUES (?, ?, ?, ?, 'update', 'File updated via API', ?)`,
        [fileId, nextVersion, fileSize, checksum, req.user.id]
      );
    } else {
      // Create new file
      const [result] = await db.execute(`
        INSERT INTO project_files 
        (project_id, file_path, file_name, content, file_type, file_size, 
         permissions, checksum, is_binary, created_by, updated_by) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [projectId, relativeFilePath, fileName, content, fileType, fileSize, 
         'rw-r--r--', checksum, isBinary, req.user.id, req.user.id]
      );
      
      fileId = result.insertId;
      
      // Create initial version record
      await db.execute(`
        INSERT INTO file_versions 
        (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
        VALUES (?, 1, ?, ?, 'create', 'File created via API', ?)`,
        [fileId, fileSize, checksum, req.user.id]
      );
    }

    // Log access
    await logFileAccess(fileId, req.user.id, 'write', req);

    res.status(isUpdate ? 200 : 201).json({
      id: fileId,
      filePath: relativeFilePath,
      fileName,
      fileSize,
      checksum,
      fileType,
      isUpdate
    });

  } catch (error) {
    console.error('Error saving file:', error);
    res.status(500).json({ 
      message: 'Error saving file',
      error: error.message 
    });
  }
});

// GET /api/filesystem/:projectId/files/:fileId - Get file content and metadata
router.get('/:projectId/files/:fileId', verifyToken, async (req, res) => {
  try {
    const { projectId, fileId } = req.params;
    const { version } = req.query; // Optional version parameter
    
    // Get file with project ownership check
    const [files] = await db.execute(`
      SELECT pf.*, p.user_id as project_owner,
             u1.name as created_by_name, u2.name as updated_by_name
      FROM project_files pf
      JOIN projects p ON pf.project_id = p.id
      LEFT JOIN users u1 ON pf.created_by = u1.id
      LEFT JOIN users u2 ON pf.updated_by = u2.id
      WHERE pf.id = ? AND pf.project_id = ? AND p.user_id = ?`,
      [fileId, projectId, req.user.id]
    );

    if (files.length === 0) {
      return res.status(404).json({ message: 'File not found or access denied' });
    }

    const file = files[0];
    
    // Get version history
    const [versions] = await db.execute(`
      SELECT fv.*, u.name as author_name
      FROM file_versions fv
      LEFT JOIN users u ON fv.created_by = u.id
      WHERE fv.file_id = ?
      ORDER BY fv.version_number DESC`,
      [fileId]
    );

    // If specific version requested, get content from Git
    let content = file.content;
    if (version && versions.length > 0) {
      const versionRecord = versions.find(v => v.version_number == version);
      if (versionRecord && versionRecord.git_commit_hash) {
        try {
          const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
          const gitManager = new GitManager(projectPath);
          const historicalContent = await gitManager.getFileAtCommit(file.file_path, versionRecord.git_commit_hash);
          if (historicalContent !== null) {
            content = historicalContent;
          }
        } catch (error) {
          console.warn('Failed to get historical content:', error.message);
        }
      }
    }

    // Log access
    await logFileAccess(fileId, req.user.id, 'read', req);

    res.json({
      ...file,
      content,
      versions,
      currentVersion: version ? parseInt(version) : versions[0]?.version_number
    });

  } catch (error) {
    console.error('Error fetching file:', error);
    res.status(500).json({ 
      message: 'Error fetching file',
      error: error.message 
    });
  }
});

// DELETE /api/filesystem/:projectId/files/:fileId - Delete file
router.delete('/:projectId/files/:fileId', verifyToken, async (req, res) => {
  try {
    const { projectId, fileId } = req.params;
    const { autoCommit = true } = req.body;

    // Get file with project ownership check
    const [files] = await db.execute(`
      SELECT pf.*, p.user_id as project_owner
      FROM project_files pf
      JOIN projects p ON pf.project_id = p.id
      WHERE pf.id = ? AND pf.project_id = ? AND p.user_id = ?`,
      [fileId, projectId, req.user.id]
    );

    if (files.length === 0) {
      return res.status(404).json({ message: 'File not found or access denied' });
    }

    const file = files[0];
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    const fullFilePath = path.join(projectPath, file.file_path);

    // フォルダの場合、中身を再帰的に削除する必要がある
    let filesToDelete = [file];
    if (file.file_type === 'folder') {
      // フォルダ内のすべてのファイル/フォルダを取得
      const [childFiles] = await db.execute(`
        SELECT pf.* FROM project_files pf 
        JOIN projects p ON pf.project_id = p.id 
        WHERE pf.project_id = ? AND p.user_id = ? 
        AND (pf.file_path LIKE ? OR pf.file_path = ?)
        ORDER BY LENGTH(pf.file_path) DESC`,
        [projectId, req.user.id, `${file.file_path}/%`, file.file_path]
      );
      filesToDelete = childFiles;
      console.log(`Found ${childFiles.length} files/folders to delete in folder ${file.file_path}`);
    }

    // Delete from filesystem
    try {
      if (file.file_type === 'folder') {
        // フォルダの場合
        const stats = await fs.stat(fullFilePath);
        if (stats.isDirectory()) {
          await fs.rm(fullFilePath, { recursive: true, force: true });
        }
      } else {
        // ファイルの場合
        await fs.unlink(fullFilePath);
      }
    } catch (error) {
      console.warn('Failed to delete file/folder from filesystem:', error.message);
      // Continue with database deletion even if file doesn't exist
    }

    // Create final version records and delete from database for all files
    for (const fileToDelete of filesToDelete) {
      // Create final version record before deletion
      const [versionResult] = await db.execute(
        'SELECT MAX(version_number) as max_version FROM file_versions WHERE file_id = ?',
        [fileToDelete.id]
      );
      const nextVersion = (versionResult[0].max_version || 0) + 1;
      
      await db.execute(`
        INSERT INTO file_versions 
        (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
        VALUES (?, ?, 0, '', 'delete', ?, ?)`,
        [fileToDelete.id, nextVersion, 
         file.file_type === 'folder' ? 'Folder and contents deleted via API' : 'File deleted via API', 
         req.user.id]
      );

      // Log access
      await logFileAccess(fileToDelete.id, req.user.id, 'delete', req);

      // Delete from database (CASCADE will handle versions and logs)
      await db.execute('DELETE FROM project_files WHERE id = ?', [fileToDelete.id]);
    }

    // Git commit if auto-commit is enabled
    let gitResult = null;
    if (autoCommit) {
      try {
        const gitManager = new GitManager(projectPath);
        if (await gitManager.isInitialized()) {
          // Stage all deleted files for git
          for (const fileToDelete of filesToDelete) {
            await gitManager.addFile(fileToDelete.file_path);
          }
          
          const commitMessage = file.file_type === 'folder' 
            ? `Delete folder ${file.file_name} and its contents (${filesToDelete.length} items)`
            : `Delete ${file.file_name}`;
            
          gitResult = await gitManager.commit(
            commitMessage, 
            req.user.name, 
            req.user.email
          );
        }
      } catch (error) {
        console.warn('Git commit failed:', error.message);
      }
    }

    res.json({
      message: file.file_type === 'folder' 
        ? `Folder and ${filesToDelete.length} items deleted successfully`
        : 'File deleted successfully',
      fileName: file.file_name,
      filePath: file.file_path,
      deletedCount: filesToDelete.length,
      git: gitResult
    });

  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ 
      message: 'Error deleting file',
      error: error.message 
    });
  }
});

// GET /api/filesystem/:projectId/tree - Get project file tree with metadata
router.get('/:projectId/tree', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Get all files with metadata
    const [files] = await db.execute(`
      SELECT pf.*, 
             u1.name as created_by_name, 
             u2.name as updated_by_name,
             (SELECT COUNT(*) FROM file_versions WHERE file_id = pf.id) as version_count
      FROM project_files pf 
      JOIN projects p ON pf.project_id = p.id 
      LEFT JOIN users u1 ON pf.created_by = u1.id
      LEFT JOIN users u2 ON pf.updated_by = u2.id
      WHERE pf.project_id = ? AND p.user_id = ?
      ORDER BY pf.file_path`,
      [projectId, req.user.id]
    );

    // Build enhanced tree structure
    const tree = {};
    
    files.forEach(file => {
      const parts = file.file_path.split('/');
      let current = tree;
      
      parts.forEach((part, index) => {
        if (!current[part]) {
          const isLastPart = index === parts.length - 1;
          const matchesFileName = file.file_name === part;
          const isActualItem = isLastPart && matchesFileName;
          
          // フォルダかファイルかを判定
          let itemType = 'folder'; // デフォルトはフォルダ
          if (isActualItem) {
            itemType = file.file_type === 'folder' ? 'folder' : 'file';
          }
          
          current[part] = {
            name: part,
            type: itemType,
            path: parts.slice(0, index + 1).join('/'),
            children: {},
            ...(isActualItem && { 
              id: file.id,
              fileSize: file.file_size,
              fileType: file.file_type,
              permissions: file.permissions,
              checksum: file.checksum,
              isBinary: file.is_binary,
              versionCount: file.version_count,
              createdAt: file.created_at,
              updatedAt: file.updated_at,
              createdBy: file.created_by_name,
              updatedBy: file.updated_by_name
            })
          };
        } else if (parts.length === index + 1 && file.file_name === part) {
          // 既存のエントリを更新（実際のファイル/フォルダ情報で上書き）
          current[part] = {
            ...current[part],
            type: file.file_type === 'folder' ? 'folder' : 'file',
            id: file.id,
            fileSize: file.file_size,
            fileType: file.file_type,
            permissions: file.permissions,
            checksum: file.checksum,
            isBinary: file.is_binary,
            versionCount: file.version_count,
            createdAt: file.created_at,
            updatedAt: file.updated_at,
            createdBy: file.created_by_name,
            updatedBy: file.updated_by_name
          };
        }
        current = current[part].children;
      });
    });
    
    res.json(tree);
  } catch (error) {
    console.error('Error fetching file tree:', error);
    res.status(500).json({ 
      message: 'Error fetching file tree',
      error: error.message 
    });
  }
});

// POST /api/filesystem/:projectId/upload - Upload multiple files
router.post('/:projectId/upload', verifyToken, upload.array('files'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const targetPath = req.body.targetPath || '';
    const autoCommit = req.body.autoCommit !== 'false';
    
    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const uploadedFiles = [];
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);

    for (const file of req.files) {
      try {
        const content = await fs.readFile(file.path, 'utf-8').catch(() => '');
        const fullFilePath = targetPath ? `${targetPath}/${file.filename}` : file.filename;
        
        // Calculate metadata
        const checksum = calculateChecksum(content);
        const fileType = getFileType(file.filename);
        const isBinary = isBinaryFile(content);
        
        // Save to database
        const [result] = await db.execute(`
          INSERT INTO project_files 
          (project_id, file_path, file_name, content, file_type, file_size, 
           checksum, is_binary, created_by, updated_by) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [projectId, fullFilePath, file.filename, content, fileType, file.size, 
           checksum, isBinary, req.user.id, req.user.id]
        );

        const fileId = result.insertId;

        // Create version record
        await db.execute(`
          INSERT INTO file_versions 
          (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
          VALUES (?, 1, ?, ?, 'create', 'File uploaded via API', ?)`,
          [fileId, file.size, checksum, req.user.id]
        );

        // Log access
        await logFileAccess(fileId, req.user.id, 'write', req);

        uploadedFiles.push({
          id: fileId,
          filename: file.filename,
          size: file.size,
          path: fullFilePath,
          checksum
        });

      } catch (fileError) {
        console.error(`Error processing file ${file.filename}:`, fileError);
        // Continue with other files
      }
    }

    // Git commit if auto-commit is enabled
    let gitResult = null;
    if (autoCommit && uploadedFiles.length > 0) {
      try {
        const gitManager = new GitManager(projectPath);
        if (await gitManager.isInitialized()) {
          // Add all uploaded files
          for (const uploadedFile of uploadedFiles) {
            await gitManager.addFile(uploadedFile.path);
          }
          
          const message = uploadedFiles.length === 1 
            ? `Upload ${uploadedFiles[0].filename}`
            : `Upload ${uploadedFiles.length} files`;
          
          gitResult = await gitManager.commit(message, req.user.name, req.user.email);
        }
      } catch (error) {
        console.warn('Git commit failed:', error.message);
      }
    }

    res.json({ 
      files: uploadedFiles,
      git: gitResult
    });

  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).json({ 
      message: 'Error uploading files',
      error: error.message 
    });
  }
});

// PATCH /api/filesystem/:projectId/files/:fileId/rename - Rename file
router.patch('/:projectId/files/:fileId/rename', verifyToken, async (req, res) => {
  try {
    const { projectId, fileId } = req.params;
    const { newName } = req.body;

    if (!newName || !newName.trim()) {
      return res.status(400).json({ message: 'New name is required' });
    }

    // Get file with project ownership check
    const [files] = await db.execute(`
      SELECT pf.*, p.user_id as project_owner
      FROM project_files pf
      JOIN projects p ON pf.project_id = p.id
      WHERE pf.id = ? AND pf.project_id = ? AND p.user_id = ?`,
      [fileId, projectId, req.user.id]
    );

    if (files.length === 0) {
      return res.status(404).json({ message: 'File not found or access denied' });
    }

    const file = files[0];
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    const oldFilePath = path.join(projectPath, file.file_path);
    
    // Calculate new paths
    const pathParts = file.file_path.split('/');
    pathParts[pathParts.length - 1] = newName.trim(); // Replace filename
    const newFilePath = pathParts.join('/');
    const newFullPath = path.join(projectPath, newFilePath);

    // Rename in filesystem
    await fs.rename(oldFilePath, newFullPath);

    // Update database
    const newChecksum = calculateChecksum(file.content || '');
    await db.execute(`
      UPDATE project_files 
      SET file_path = ?, file_name = ?, checksum = ?, updated_by = ?, updated_at = NOW()
      WHERE id = ?`,
      [newFilePath, newName.trim(), newChecksum, req.user.id, fileId]
    );

    // Create version record
    const [versionResult] = await db.execute(
      'SELECT MAX(version_number) as max_version FROM file_versions WHERE file_id = ?',
      [fileId]
    );
    const nextVersion = (versionResult[0].max_version || 0) + 1;
    
    await db.execute(`
      INSERT INTO file_versions 
      (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
      VALUES (?, ?, ?, ?, 'rename', ?, ?)`,
      [fileId, nextVersion, file.file_size || 0, newChecksum, `Renamed to ${newName.trim()}`, req.user.id]
    );

    // Log access
    await logFileAccess(fileId, req.user.id, 'rename', req);

    res.json({
      message: 'File renamed successfully',
      oldName: file.file_name,
      newName: newName.trim(),
      newPath: newFilePath
    });

  } catch (error) {
    console.error('Error renaming file:', error);
    res.status(500).json({ 
      message: 'Error renaming file',
      error: error.message 
    });
  }
});

module.exports = router;