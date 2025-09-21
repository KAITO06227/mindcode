const express = require('express');
const { verifyToken } = require('../middleware/auth');
const db = require('../database/connection');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { serveProjectAsset } = require('../utils/projectPreviewUtils');
const router = express.Router();

// Get user projects
router.get('/', verifyToken, async (req, res) => {
  try {
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching projects' });
  }
});

// Create new project
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    const projectId = uuidv4();
    
    const [result] = await db.execute(
      'INSERT INTO projects (id, user_id, name, description) VALUES (?, ?, ?, ?)',
      [projectId, req.user.id, name, description || '']
    );

    // Create project directory structure
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    await fs.mkdir(projectPath, { recursive: true });

    // Create initial files
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name}</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <h1>Welcome to ${name}</h1>
    <script src="script.js"></script>
</body>
</html>`;

    const indexCss = `body {
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 20px;
    background-color: #f0f0f0;
}

h1 {
    color: #333;
    text-align: center;
}`;

    const indexJs = `// Your JavaScript code here
console.log('Welcome to ${name}!');`;

    const claudeMd = [
      `# ${name}`,
      '',
      'このプロジェクトは MindCode で作成されました。Claude Code に関する注意点:',
      '',
      '- Claude CLI を利用する場合は、ターミナルで `claude` コマンドを実行します。',
      '- 重要な変更前後に自動コミットが実行されます。',
      '- Claude に送信するプロンプトは教育目的で保存される可能性があります。',
      '',
      '## フォルダ構成',
      '',
      '- `index.html`',
      '- `style.css`',
      '- `script.js`',
      '',
      '必要に応じて内容を更新してください。'
    ].join('\n');

    // Write files to disk
    try {
      console.log('Project path:', projectPath);
      
      // Ensure project directory exists
      await fs.mkdir(projectPath, { recursive: true });
      console.log('Project directory created/verified');
      
      // Create initial files
      await fs.writeFile(path.join(projectPath, 'index.html'), indexHtml);
      console.log('Created index.html');
      
      await fs.writeFile(path.join(projectPath, 'style.css'), indexCss);
      console.log('Created style.css');
      
      await fs.writeFile(path.join(projectPath, 'script.js'), indexJs);
      console.log('Created script.js');

      await fs.writeFile(path.join(projectPath, 'CLAUDE.md'), claudeMd);
      console.log('Created CLAUDE.md');

      console.log('All files created successfully');
      
    } catch (fileError) {
      console.error('Error creating files:', fileError);
      console.error('Error details:', {
        code: fileError.code,
        errno: fileError.errno,
        syscall: fileError.syscall,
        path: fileError.path
      });
      throw new Error(`Failed to create project files: ${fileError.message}`);
    }

    // Initialize filesystem records for created files
    const crypto = require('crypto');
    const calculateChecksum = (content) => crypto.createHash('sha256').update(content).digest('hex');
    
    const initialFiles = [
      { name: 'index.html', content: indexHtml, type: 'html' },
      { name: 'style.css', content: indexCss, type: 'css' },
      { name: 'script.js', content: indexJs, type: 'javascript' },
      { name: 'CLAUDE.md', content: claudeMd, type: 'markdown' }
    ];

    try {
      // Clean up existing files for this project first (in case of retry)
      // file_versions will be deleted automatically due to CASCADE constraint
      await db.execute('DELETE FROM project_files WHERE project_id = ?', [projectId]);
      console.log('Cleaned up existing project files from database');

      for (const file of initialFiles) {
        // Try new database structure first, fallback to old structure
        try {
          const checksum = calculateChecksum(file.content);
          const fileSize = Buffer.byteLength(file.content, 'utf8');
          
          // Try new filesystem database structure
          const [result] = await db.execute(`
            INSERT INTO project_files 
            (project_id, file_path, file_name, content, file_type, file_size, 
             permissions, checksum, is_binary, created_by, updated_by) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [projectId, file.name, file.name, file.content, file.type, fileSize, 
             'rw-r--r--', checksum, false, req.user.id, req.user.id]
          );

          const fileId = result.insertId;
          
          // Create initial version record
          await db.execute(`
            INSERT INTO file_versions 
            (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
            VALUES (?, 1, ?, ?, 'create', 'Initial file creation', ?)`,
            [fileId, fileSize, checksum, req.user.id]
          );
          
          console.log(`Saved ${file.name} to database with new structure`);
        } catch (newStructureError) {
          console.log(`New structure failed for ${file.name}, trying legacy structure:`, newStructureError.message);
          
          // Fallback to old database structure
          await db.execute(
            'INSERT INTO project_files (project_id, file_path, file_name, content, file_type) VALUES (?, ?, ?, ?, ?)',
            [projectId, file.name, file.name, file.content, file.type]
          );
          
          console.log(`Saved ${file.name} to database with legacy structure`);
        }
      }
    } catch (dbError) {
      console.error('Error saving files to database:', dbError);
      // Don't fail project creation if database save fails - files exist on disk
      console.warn('Files created on disk but database save failed - will be synced on first access');
    }

    const [newProject] = await db.execute('SELECT * FROM projects WHERE id = ?', [projectId]);
    
    if (newProject.length === 0) {
      console.error('Project was created but could not be retrieved from database');
      return res.status(500).json({ message: 'Project created but could not be retrieved' });
    }
    
    // Git初期化をプロジェクト作成時に実行
    try {
      const GitManager = require('../utils/gitManager');
      const gitManager = new GitManager(projectPath);
      
      console.log('Initializing Git repository for new project...');
      await gitManager.initRepository(req.user.name, req.user.email);
      
      // データベースの git_repositories レコードを作成/更新
      await db.execute(`
        INSERT INTO git_repositories (project_id, is_initialized, git_user_name, git_user_email, current_branch)
        VALUES (?, TRUE, ?, ?, 'main')
        ON DUPLICATE KEY UPDATE 
        is_initialized = TRUE, 
        git_user_name = VALUES(git_user_name),
        git_user_email = VALUES(git_user_email),
        current_branch = 'main'`,
        [projectId, req.user.name, req.user.email]
      );
      
      console.log('Git repository initialized successfully for project:', projectId);
    } catch (gitError) {
      console.error('Git initialization failed during project creation:', gitError);
      // Git初期化が失敗してもプロジェクト作成は成功とする
    }
    
    console.log('Project creation completed successfully:', newProject[0]);
    res.status(201).json(newProject[0]);
  } catch (error) {
    console.error('Error in project creation:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Error creating project',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get project details
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const project = projects[0];
    
    // Git初期化は別途Git APIで実行するため、ここでは処理しない

    res.json(project);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching project' });
  }
});

// Update project
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    
    await db.execute(
      'UPDATE projects SET name = ?, description = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
      [name, description, req.params.id, req.user.id]
    );

    const [updatedProject] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    res.json(updatedProject[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error updating project' });
  }
});

// Delete project
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const projectId = req.params.id;
    
    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    // Delete project directory
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    try {
      await fs.rm(projectPath, { recursive: true, force: true });
      console.log(`Deleted project directory: ${projectPath}`);
    } catch (error) {
      console.warn(`Could not delete project directory: ${error.message}`);
      // Continue with database deletion even if file deletion fails
    }

    // Delete from database (CASCADE will handle related records)
    const [deleteResult] = await db.execute(
      'DELETE FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    console.log(`Project ${projectId} deleted successfully by user ${req.user.id}`);
    res.json({ 
      message: 'Project deleted successfully',
      projectId: projectId,
      projectName: projects[0].name
    });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ 
      message: 'Error deleting project',
      error: error.message 
    });
  }
});

const handleLiveAssetRequest = async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const requestedPath = req.params[0] || 'index.html';

    const [projects] = await db.execute(
      'SELECT p.*, u.id as user_id FROM projects p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
      [projectId]
    );

    if (projects.length === 0) {
      return res.status(404).send('<h1>Project not found</h1>');
    }

    const projectRoot = path.join(
      __dirname,
      '../../user_projects',
      projects[0].user_id.toString(),
      projectId
    );

    await serveProjectAsset({
      projectRoot,
      requestedPath,
      projectId,
      token: req.query.token,
      res,
      db,
      baseHref: `${req.baseUrl}/${projectId}/live/`
    });
  } catch (error) {
    console.error('Error serving live preview asset:', error);
    res.status(500).send('<h1>Error loading project</h1>');
  }
};

router.get('/:projectId/live', handleLiveAssetRequest);
router.get('/:projectId/live/*', handleLiveAssetRequest);

// Public shared preview (no authentication required)
router.get('/:id/preview', async (req, res) => {
  try {
    const projectId = req.params.id;
    
    // Get project (no user verification - public access)
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ?',
      [projectId]
    );

    if (projects.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>プロジェクトが見つかりません</title></head>
        <body>
          <h1>プロジェクトが見つかりません</h1>
          <p>指定されたプロジェクトは存在しません。</p>
        </body>
        </html>
      `);
    }

    // Get all files for the project
    const [files] = await db.execute(
      'SELECT * FROM project_files WHERE project_id = ? ORDER BY file_path, file_name',
      [projectId]
    );

    // Build file tree structure
    const fileTree = {};
    files.forEach(file => {
      const pathParts = file.file_path ? file.file_path.split('/') : [];
      let current = fileTree;
      
      pathParts.forEach(part => {
        if (part && !current[part]) {
          current[part] = { type: 'folder', children: {} };
        }
        if (part) current = current[part].children;
      });
      
      if (file.file_name) {
        current[file.file_name] = {
          ...file,
          type: 'file'
        };
      }
    });

    // Find index.html
    const indexFile = findFileInTree(fileTree, 'index.html');
    if (!indexFile) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>No Preview Available</title></head>
        <body>
          <h1>No Preview Available</h1>
          <p>No index.html file found in this project.</p>
        </body>
        </html>
      `);
    }

    let htmlContent = indexFile.content;

    // Get CSS and JS files
    const cssFiles = findFilesByExtension(fileTree, 'css');
    const jsFiles = findFilesByExtension(fileTree, 'js');

    // Embed CSS files
    for (const cssFile of cssFiles) {
      const patterns = [
        `<link rel="stylesheet" href="${cssFile.file_name}">`,
        `<link rel="stylesheet" href="${cssFile.file_name}" />`,
        `<link href="${cssFile.file_name}" rel="stylesheet">`,
        `<link href="${cssFile.file_name}" rel="stylesheet" />`,
        `<link rel="stylesheet" href="./${cssFile.file_name}">`,
        `<link rel="stylesheet" href="./${cssFile.file_name}" />`
      ];
      
      patterns.forEach(pattern => {
        htmlContent = htmlContent.replace(
          new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
          `<style>\n${cssFile.content}\n</style>`
        );
      });
    }

    // Embed JS files
    for (const jsFile of jsFiles) {
      const patterns = [
        `<script src="${jsFile.file_name}"></script>`,
        `<script src="./${jsFile.file_name}"></script>`,
        `<script type="text/javascript" src="${jsFile.file_name}"></script>`,
        `<script type="text/javascript" src="./${jsFile.file_name}"></script>`
      ];
      
      patterns.forEach(pattern => {
        htmlContent = htmlContent.replace(
          new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
          `<script>\n${jsFile.content}\n</script>`
        );
      });
    }

    // Add timestamp for cache busting
    htmlContent = htmlContent.replace(
      '<head>',
      `<head>\n<meta name="timestamp" content="${Date.now()}">`
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlContent);

  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Preview Error</title></head>
      <body>
        <h1>Preview Error</h1>
        <p>Failed to generate preview: ${error.message}</p>
      </body>
      </html>
    `);
  }
});

// Helper functions for file operations
function findFileInTree(tree, fileName) {
  for (const key in tree) {
    const item = tree[key];
    if (item.type === 'file' && item.file_name === fileName) {
      return item;
    }
    if (item.type === 'folder' && item.children) {
      const found = findFileInTree(item.children, fileName);
      if (found) return found;
    }
  }
  return null;
}

function findFilesByExtension(tree, extension) {
  const files = [];
  
  const traverse = (node) => {
    for (const key in node) {
      const item = node[key];
      if (item.type === 'file' && item.file_name && item.file_name.endsWith(`.${extension}`)) {
        files.push(item);
      }
      if (item.type === 'folder' && item.children) {
        traverse(item.children);
      }
    }
  };
  
  traverse(tree);
  return files;
}

module.exports = router;
