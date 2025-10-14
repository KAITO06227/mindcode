const express = require('express');
const { verifyToken } = require('../middleware/auth');
const db = require('../database/connection');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const GitManager = require('../utils/gitManager');
const crypto = require('crypto');
const { resolveExistingProjectPath } = require('../utils/userWorkspace');

const router = express.Router();
const { emitFileTreeUpdate } = require('../sockets/fileTreeEvents');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const projectPath = await resolveExistingProjectPath(req.user, req.params.projectId);
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
    const {
      filePath,
      fileName,
      content = '',
      isFolder = false
    } = req.body;
    const projectId = req.params.projectId;
    
    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    // パス構築：filePathの扱いを修正
    const trimmedFilePath = filePath ? filePath.trim() : '';
    let relativeFilePath;

    if (trimmedFilePath) {
      const normalizedFilePath = trimmedFilePath.replace(/\\/g, '/');

      let shouldTreatAsFullPath = false;
      if (normalizedFilePath.endsWith(`/${fileName}`) || normalizedFilePath === fileName) {
        const [existingPathRecords] = await db.execute(
          'SELECT file_type FROM project_files WHERE project_id = ? AND file_path = ?',
          [projectId, normalizedFilePath]
        );

        if (existingPathRecords.length > 0 && existingPathRecords[0].file_type !== 'folder') {
          shouldTreatAsFullPath = true;
        }
      }

      if (shouldTreatAsFullPath) {
        relativeFilePath = normalizedFilePath;
      } else {
        relativeFilePath = normalizedFilePath ? path.posix.join(normalizedFilePath, fileName) : fileName;
      }
    } else {
      relativeFilePath = fileName;
    }

    // Normalize path to posix-style for DB consistency
    relativeFilePath = relativeFilePath.replace(/\\/g, '/');
    const projectPath = await resolveExistingProjectPath(req.user, projectId);
    const fullFilePath = path.join(projectPath, relativeFilePath);

    if (isFolder) {
      await fs.mkdir(fullFilePath, { recursive: true });
      const fileSize = 0;
      const checksum = '';
      const fileType = 'folder';
      const isBinary = false;

      const [result] = await db.execute(`
        INSERT INTO project_files 
        (project_id, file_path, file_name, content, file_type, file_size, 
         permissions, checksum, is_binary, created_by, updated_by) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [projectId, relativeFilePath, fileName, '', fileType, fileSize, 
         'rwxr-xr-x', checksum, isBinary, req.user.id, req.user.id]
      );

      const folderId = result.insertId;

      await db.execute(`
        INSERT INTO file_versions 
        (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
        VALUES (?, 1, ?, ?, 'create', 'Folder created via API', ?)`,
        [folderId, fileSize, checksum, req.user.id]
      );

      await logFileAccess(folderId, req.user.id, 'write', req);

      if (req.user?.id) {
        emitFileTreeUpdate(req.user.id, projectId, { action: 'create-folder', path: relativeFilePath });
      }

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

    const checksum = calculateChecksum(content);
    const fileSize = Buffer.byteLength(content, 'utf8');
    const fileType = getFileType(fileName);
    const isBinary = isBinaryFile(content);

    const parentDir = path.dirname(fullFilePath);
    await fs.mkdir(parentDir, { recursive: true });

    await fs.writeFile(fullFilePath, content);
    const [existingFiles] = await db.execute(
      'SELECT * FROM project_files WHERE project_id = ? AND file_path = ?',
      [projectId, relativeFilePath]
    );

    let fileId;
    let isUpdate = false;

    if (existingFiles.length > 0) {
      fileId = existingFiles[0].id;
      await db.execute(`
        UPDATE project_files 
        SET content = ?, file_size = ?, checksum = ?, 
            file_type = ?, is_binary = ?, updated_by = ?, updated_at = NOW()
        WHERE id = ?`,
        [content, fileSize, checksum, fileType, isBinary, req.user.id, fileId]
      );

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

      isUpdate = true;
    } else {
      const [result] = await db.execute(`
        INSERT INTO project_files 
        (project_id, file_path, file_name, content, file_type, file_size, 
         permissions, checksum, is_binary, created_by, updated_by) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [projectId, relativeFilePath, fileName, content, fileType, fileSize, 
         'rw-r--r--', checksum, isBinary, req.user.id, req.user.id]
      );

      fileId = result.insertId;

      await db.execute(`
        INSERT INTO file_versions 
        (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
        VALUES (?, 1, ?, ?, 'create', 'File created via API', ?)`,
        [fileId, fileSize, checksum, req.user.id]
      );
    }

    await logFileAccess(fileId, req.user.id, 'write', req);

    if (req.user?.id) {
      emitFileTreeUpdate(req.user.id, projectId, {
        action: isUpdate ? 'update-file' : 'create-file',
        path: relativeFilePath
      });
    }

    res.status(isUpdate ? 200 : 201).json({
      id: fileId,
      filePath: relativeFilePath,
      fileName,
      fileSize,
      checksum,
      fileType,
      isUpdate,
      isFolder: false
    });

  } catch (error) {
    console.error('Error saving file:', error);
    res.status(500).json({ 
      message: 'Error saving file',
      error: error.message 
    });
  }
});

// プロジェクト保存エンドポイントは無効化された状態のまま
// router.post('/:projectId/save', verifyToken, async (req, res) => { ... });

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
          const projectPath = await resolveExistingProjectPath(req.user, projectId);
          const gitManager = new GitManager(projectPath);
          const historicalContent = await gitManager.getFileAtCommit(file.file_path, versionRecord.git_commit_hash);
          if (historicalContent !== null) {
            content = historicalContent;
          }
        } catch (error) {
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
    const projectPath = await resolveExistingProjectPath(req.user, projectId);
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

    if (req.user?.id) {
      emitFileTreeUpdate(req.user.id, projectId, {
        action: 'delete',
        target: file.file_path,
        deletedCount: filesToDelete.length
      });
    }

    res.json({
      message: file.file_type === 'folder' 
        ? `Folder and ${filesToDelete.length} items deleted successfully`
        : 'File deleted successfully',
      fileName: file.file_name,
      filePath: file.file_path,
      deletedCount: filesToDelete.length
    });

  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ 
      message: 'Error deleting file',
      error: error.message 
    });
  }
});

// POST /api/filesystem/:projectId/move - Move file or folder to another directory
router.post('/:projectId/move', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { sourcePath, destinationPath = '' } = req.body;

    if (!sourcePath || typeof sourcePath !== 'string') {
      return res.status(400).json({ message: 'sourcePath is required' });
    }

    if (typeof destinationPath !== 'string') {
      return res.status(400).json({ message: 'destinationPath must be a string' });
    }

    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const projectPath = await resolveExistingProjectPath(req.user, projectId);
    const sourceRelativePath = sourcePath.replace(/^\/+/, '');
    const destinationFolderPath = destinationPath.replace(/^\/+/, '').replace(/\/+$/, '');

    if (!sourceRelativePath) {
      return res.status(400).json({ message: 'Invalid sourcePath' });
    }

    if (destinationFolderPath && (destinationFolderPath === sourceRelativePath || destinationFolderPath.startsWith(`${sourceRelativePath}/`))) {
      return res.status(400).json({ message: 'Cannot move item into itself or its descendant' });
    }

    const [sources] = await db.execute(
      'SELECT * FROM project_files WHERE project_id = ? AND file_path = ?',
      [projectId, sourceRelativePath]
    );

    if (sources.length === 0) {
      return res.status(404).json({ message: 'Source item not found' });
    }

    const sourceItem = sources[0];
    const sourceName = path.posix.basename(sourceRelativePath);
    const currentParent = sourceRelativePath.includes('/')
      ? sourceRelativePath.slice(0, sourceRelativePath.lastIndexOf('/'))
      : '';

    if (currentParent === destinationFolderPath) {
      return res.json({
        success: true,
        message: 'Item already in target location',
        newPath: sourceRelativePath
      });
    }

    const newRelativePath = destinationFolderPath
      ? path.posix.join(destinationFolderPath, sourceName)
      : sourceName;

    if (newRelativePath === sourceRelativePath) {
      return res.json({
        success: true,
        message: 'Item already in target location',
        newPath: sourceRelativePath
      });
    }

    const newFullPath = path.join(projectPath, newRelativePath);
    const sourceFullPath = path.join(projectPath, sourceRelativePath);

    try {
      await fs.access(newFullPath);
      return res.status(409).json({ message: 'An item with the same name already exists in the destination' });
    } catch {
      // Destination free, continue
    }

    await fs.mkdir(path.dirname(newFullPath), { recursive: true });
    await fs.rename(sourceFullPath, newFullPath);

    if (sourceItem.file_type === 'folder') {
      const [descendants] = await db.execute(
        'SELECT id, file_path FROM project_files WHERE project_id = ? AND (file_path = ? OR file_path LIKE ?)',
        [projectId, sourceRelativePath, `${sourceRelativePath}/%`]
      );

      for (const row of descendants) {
        let suffix = '';
        if (row.file_path.length > sourceRelativePath.length) {
          suffix = row.file_path.slice(sourceRelativePath.length);
          if (suffix.startsWith('/')) {
            suffix = suffix.slice(1);
          }
        }

        const updatedPath = suffix ? `${newRelativePath}/${suffix}` : newRelativePath;
        await db.execute(
          'UPDATE project_files SET file_path = ?, updated_at = NOW() WHERE id = ?',
          [updatedPath, row.id]
        );
      }
    } else {
      await db.execute(
        'UPDATE project_files SET file_path = ?, updated_at = NOW() WHERE id = ?',
        [newRelativePath, sourceItem.id]
      );
    }

    emitFileTreeUpdate(req.user.id, projectId, {
      action: 'move',
      from: sourceRelativePath,
      to: newRelativePath,
      isFolder: sourceItem.file_type === 'folder'
    });

    res.json({
      success: true,
      message: 'Item moved successfully',
      newPath: newRelativePath,
      isFolder: sourceItem.file_type === 'folder'
    });
  } catch (error) {
    console.error('Error moving item:', error);
    res.status(500).json({
      message: 'Error moving item',
      error: error.message
    });
  }
});

// GET /api/filesystem/:projectId/tree - Get project file tree with metadata
router.get('/:projectId/tree', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { sync } = req.query; // ?sync=true で同期を実行

    // 同期オプションが指定されている場合、物理ファイルとDBを同期
    if (sync === 'true') {
      try {
        const GitManager = require('../utils/gitManager');
        const projectPath = await resolveExistingProjectPath(req.user, projectId);
        const gitManager = new GitManager(projectPath);

        const syncResult = await gitManager.syncPhysicalFilesWithDatabase(projectId, req.user.id, db);
      } catch (syncError) {
        console.error('Manual sync failed:', syncError);
        // 同期失敗してもファイルツリー取得は続行
      }
    }

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
    const relativePaths = req.body.relativePaths || [];

    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const uploadedFiles = [];
    const createdFolders = new Set();
    const projectPath = await resolveExistingProjectPath(req.user, projectId);

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const relativePath = Array.isArray(relativePaths) ? relativePaths[i] : relativePaths;

      try {
        const content = await fs.readFile(file.path, 'utf-8').catch(() => '');

        // フォルダ構造を考慮したファイルパス
        let fullFilePath;
        if (relativePath && relativePath !== '') {
          // webkitRelativePathがある場合（フォルダアップロード）
          fullFilePath = targetPath ? `${targetPath}/${relativePath}` : relativePath;
        } else {
          // 通常のファイルアップロード
          fullFilePath = targetPath ? `${targetPath}/${file.filename}` : file.filename;
        }

        // フォルダ構造を作成
        const fileDirPath = path.dirname(fullFilePath);
        if (fileDirPath && fileDirPath !== '.' && !createdFolders.has(fileDirPath)) {
          const dirParts = fileDirPath.split('/');
          let currentPath = '';

          for (const part of dirParts) {
            const parentPath = currentPath;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            if (!createdFolders.has(currentPath)) {
              // フォルダがDBに存在するか確認
              const [existingFolders] = await db.execute(
                'SELECT id FROM project_files WHERE project_id = ? AND file_path = ? AND file_type = ?',
                [projectId, currentPath, 'folder']
              );

              if (existingFolders.length === 0) {
                // フォルダを作成
                const folderFullPath = path.join(projectPath, currentPath);
                await fs.mkdir(folderFullPath, { recursive: true });

                const [folderResult] = await db.execute(`
                  INSERT INTO project_files
                  (project_id, file_path, file_name, content, file_type, file_size,
                   permissions, checksum, is_binary, created_by, updated_by)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [projectId, currentPath, part, '', 'folder', 0,
                   'rwxr-xr-x', '', false, req.user.id, req.user.id]
                );

                const folderId = folderResult.insertId;

                await db.execute(`
                  INSERT INTO file_versions
                  (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
                  VALUES (?, 1, 0, '', 'create', 'Folder created during upload', ?)`,
                  [folderId, req.user.id]
                );

                createdFolders.add(currentPath);
              } else {
                createdFolders.add(currentPath);
              }
            }
          }
        }

        // ファイルを物理的に正しい場所に移動
        const finalFilePath = path.join(projectPath, fullFilePath);
        await fs.mkdir(path.dirname(finalFilePath), { recursive: true });
        await fs.rename(file.path, finalFilePath);

        // Calculate metadata
        const checksum = calculateChecksum(content);
        const fileType = getFileType(file.filename);
        const isBinary = isBinaryFile(content);
        const fileName = path.basename(fullFilePath);

        // Save to database
        const [result] = await db.execute(`
          INSERT INTO project_files
          (project_id, file_path, file_name, content, file_type, file_size,
           checksum, is_binary, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [projectId, fullFilePath, fileName, content, fileType, file.size,
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
          filename: fileName,
          size: file.size,
          path: fullFilePath,
          checksum
        });

      } catch (fileError) {
        console.error(`Error processing file ${file.filename}:`, fileError);
        // Continue with other files
      }
    }

    if (req.user?.id) {
      emitFileTreeUpdate(req.user.id, projectId, {
        action: 'upload',
        uploadedCount: uploadedFiles.length,
        createdFolders: createdFolders.size
      });
    }

    res.json({
      files: uploadedFiles,
      createdFolders: createdFolders.size
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
    const projectPath = await resolveExistingProjectPath(req.user, projectId);
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

    if (req.user?.id) {
      emitFileTreeUpdate(req.user.id, projectId, {
        action: 'rename',
        oldPath: file.file_path,
        newPath: newFilePath
      });
    }

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

// POST /api/filesystem/:projectId/sync - Sync physical filesystem with database
router.post('/:projectId/sync', verifyToken, async (req, res) => {
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

    const projectPath = await resolveExistingProjectPath(req.user, projectId);
    
    
    // Get existing files from database
    const [existingFiles] = await db.execute(
      'SELECT file_path, checksum FROM project_files WHERE project_id = ?',
      [projectId]
    );
    
    const dbFiles = new Map();
    existingFiles.forEach(file => {
      dbFiles.set(file.file_path, file.checksum);
    });

    const syncResult = {
      created: [],
      updated: [],
      deleted: [],
      errors: []
    };

    // Recursively scan physical directory
    async function scanDirectory(dirPath, relativePath = '') {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativeFilePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
          
          // Skip hidden files and node_modules
          if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
          }
          
          if (entry.isDirectory()) {
            // Handle directory
            const dirExists = dbFiles.has(relativeFilePath);
            if (!dirExists) {
              try {
                // Create folder in database
                const [result] = await db.execute(`
                  INSERT INTO project_files 
                  (project_id, file_path, file_name, content, file_type, file_size, 
                   permissions, checksum, is_binary, created_by, updated_by) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [projectId, relativeFilePath, entry.name, '', 'folder', 0, 
                   'rwxr-xr-x', '', false, req.user.id, req.user.id]
                );
                
                const folderId = result.insertId;
                
                // Create version record
                await db.execute(`
                  INSERT INTO file_versions 
                  (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
                  VALUES (?, 1, 0, '', 'create', 'Folder created via sync', ?)`,
                  [folderId, req.user.id]
                );
                
                syncResult.created.push({
                  type: 'folder',
                  path: relativeFilePath,
                  id: folderId
                });
                
              } catch (error) {
                syncResult.errors.push({
                  path: relativeFilePath,
                  error: `Failed to create folder: ${error.message}`
                });
              }
            }
            
            // Recursively scan subdirectory
            await scanDirectory(fullPath, relativeFilePath);
            
          } else if (entry.isFile()) {
            // Handle file
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const checksum = calculateChecksum(content);
              const fileSize = Buffer.byteLength(content, 'utf8');
              const fileType = getFileType(entry.name);
              const isBinary = isBinaryFile(content);
              
              const existingChecksum = dbFiles.get(relativeFilePath);
              
              if (!existingChecksum) {
                // Create new file in database
                const [result] = await db.execute(`
                  INSERT INTO project_files 
                  (project_id, file_path, file_name, content, file_type, file_size, 
                   permissions, checksum, is_binary, created_by, updated_by) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [projectId, relativeFilePath, entry.name, content, fileType, fileSize, 
                   'rw-r--r--', checksum, isBinary, req.user.id, req.user.id]
                );
                
                const fileId = result.insertId;
                
                // Create version record
                await db.execute(`
                  INSERT INTO file_versions 
                  (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
                  VALUES (?, 1, ?, ?, 'create', 'File created via sync', ?)`,
                  [fileId, fileSize, checksum, req.user.id]
                );
                
                syncResult.created.push({
                  type: 'file',
                  path: relativeFilePath,
                  id: fileId,
                  size: fileSize
                });
                
                
              } else if (existingChecksum !== checksum) {
                // Update existing file
                const [fileResult] = await db.execute(
                  'SELECT id FROM project_files WHERE project_id = ? AND file_path = ?',
                  [projectId, relativeFilePath]
                );
                
                if (fileResult.length > 0) {
                  const fileId = fileResult[0].id;
                  
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
                    VALUES (?, ?, ?, ?, 'update', 'File updated via sync', ?)`,
                    [fileId, nextVersion, fileSize, checksum, req.user.id]
                  );
                  
                  syncResult.updated.push({
                    type: 'file',
                    path: relativeFilePath,
                    id: fileId,
                    size: fileSize
                  });
                  
                }
              }
              
            } catch (error) {
              syncResult.errors.push({
                path: relativeFilePath,
                error: `Failed to process file: ${error.message}`
              });
            }
          }
        }
      } catch (error) {
        syncResult.errors.push({
          path: dirPath,
          error: `Failed to read directory: ${error.message}`
        });
      }
    }

    // Check if project directory exists
    try {
      await fs.access(projectPath);
      await scanDirectory(projectPath);
    } catch (error) {
      return res.status(404).json({ 
        message: 'Project directory not found',
        path: projectPath 
      });
    }


    if (req.user?.id) {
      emitFileTreeUpdate(req.user.id, projectId, {
        action: 'sync',
        result: syncResult
      });
    }

    res.json({
      message: 'Filesystem sync completed',
      result: syncResult,
      totalCreated: syncResult.created.length,
      totalUpdated: syncResult.updated.length,
      totalDeleted: syncResult.deleted.length,
      totalErrors: syncResult.errors.length
    });

  } catch (error) {
    console.error('Error syncing filesystem:', error);
    res.status(500).json({ 
      message: 'Error syncing filesystem',
      error: error.message 
    });
  }
});

module.exports = router;
