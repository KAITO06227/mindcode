const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { requireProjectAccess, addProjectMember } = require('../middleware/projectAccess');
const db = require('../database/connection');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { serveProjectAsset } = require('../utils/projectPreviewUtils');
const {
  ensureProjectPath,
  resolveExistingProjectPath,
  getProjectPath
} = require('../utils/userWorkspace');
const router = express.Router();

const INITIAL_TEMPLATE_DIR = path.resolve(__dirname, '../../initial_project');
const TEMPLATE_PLACEHOLDER = '{{PROJECT_NAME}}';
const TEMPLATE_SKIP_ENTRIES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const PLACEHOLDER_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.scss',
  '.md',
  '.txt',
  '.json',
  '.yml',
  '.yaml'
]);

async function copyDirectoryRecursive(source, destination) {
  const entries = await fs.readdir(source, { withFileTypes: true });
  await fs.mkdir(destination, { recursive: true });

  for (const entry of entries) {
    if (TEMPLATE_SKIP_ENTRIES.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function applyProjectNamePlaceholders(directory, projectName) {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await applyProjectNamePlaceholders(entryPath, projectName);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!PLACEHOLDER_EXTENSIONS.has(ext)) {
      continue;
    }

    try {
      const content = await fs.readFile(entryPath, 'utf8');
      if (!content.includes(TEMPLATE_PLACEHOLDER)) {
        continue;
      }
      const updatedContent = content.replace(new RegExp(TEMPLATE_PLACEHOLDER, 'g'), projectName);
      if (updatedContent !== content) {
        await fs.writeFile(entryPath, updatedContent);
      }
    } catch (error) {
      console.warn(`Failed to apply project name placeholder for ${entryPath}:`, error);
    }
  }
}

async function applyInitialProjectTemplate(projectPath, projectName) {
  try {
    const stats = await fs.stat(INITIAL_TEMPLATE_DIR);
    if (!stats.isDirectory()) {
      return false;
    }
  } catch (error) {
    return false;
  }

  await copyDirectoryRecursive(INITIAL_TEMPLATE_DIR, projectPath);
  await applyProjectNamePlaceholders(projectPath, projectName);
  return true;
}

// Get user projects (including projects where user is a member)
router.get('/', verifyToken, async (req, res) => {
  try {
    // Get all projects owned by the user
    const [ownedProjects] = await db.execute(
      `SELECT p.*, NULL as user_role
       FROM projects p
       WHERE p.user_id = ?
       ORDER BY p.updated_at DESC`,
      [req.user.id]
    );

    // Get all projects where user is a member (but not owner)
    const [sharedProjects] = await db.execute(
      `SELECT p.*, pm.role as user_role
       FROM projects p
       INNER JOIN project_members pm ON p.id = pm.project_id
       WHERE pm.user_id = ? AND p.user_id != ?
       ORDER BY p.updated_at DESC`,
      [req.user.id, req.user.id]
    );

    // Combine both lists
    const allProjects = [...ownedProjects, ...sharedProjects];
    res.json(allProjects);
  } catch (error) {
    console.error('Error fetching projects:', error);
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
    const projectPath = await ensureProjectPath(req.user, projectId);

    try {
      await applyInitialProjectTemplate(projectPath, name);
    } catch (templateError) {
      console.warn('初期テンプレートの適用に失敗しました:', templateError);
    }

    // データベースの既存ファイルレコードとバージョン履歴をクリア（プロジェクト再作成の場合）
    try {
      // 明示的にfile_versionsから削除
      await db.execute(`
        DELETE fv FROM file_versions fv
        INNER JOIN project_files pf ON fv.file_id = pf.id
        WHERE pf.project_id = ?`, [projectId]);

      // project_filesから削除
      await db.execute('DELETE FROM project_files WHERE project_id = ?', [projectId]);

    } catch (cleanupError) {
    }

    const [newProject] = await db.execute('SELECT * FROM projects WHERE id = ?', [projectId]);

    if (newProject.length === 0) {
      console.error('Project was created but could not be retrieved from database');
      return res.status(500).json({ message: 'Project created but could not be retrieved' });
    }

    // プロジェクトオーナーをproject_membersに追加
    try {
      await addProjectMember(projectId, req.user.id, 'owner');
    } catch (memberError) {
      console.error('Failed to add project owner to members:', memberError);
      // 失敗してもプロジェクト作成は成功とする
    }

    // トリップコード初期化をプロジェクト作成時に実行
    try {
      const GitManager = require('../utils/gitManager');
      const gitManager = new GitManager(projectPath);
      
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

      // 物理ファイルとデータベースを同期
      try {
        const syncResult = await gitManager.syncPhysicalFilesWithDatabase(projectId, req.user.id, db);
      } catch (syncError) {
        console.error('File sync failed after project creation:', syncError);
        // 同期失敗もプロジェクト作成は成功とする
      }
      
    } catch (gitError) {
      console.error('Tripcode initialization failed during project creation:', gitError);
      // トリップコード初期化が失敗してもプロジェクト作成は成功とする
    }
    
    res.status(201).json(newProject[0]);
  } catch (error) {
    console.error('Error in project creation:', error);
    res.status(500).json({
      message: 'Error creating project',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get project details
router.get('/:id', verifyToken, requireProjectAccess('viewer'), async (req, res) => {
  try {
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ?',
      [req.params.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const project = {
      ...projects[0],
      userRole: req.projectRole
    };

    res.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ message: 'Error fetching project' });
  }
});

// Update project (requires editor role)
router.put('/:id', verifyToken, requireProjectAccess('editor'), async (req, res) => {
  try {
    const { name, description } = req.body;

    await db.execute(
      'UPDATE projects SET name = ?, description = ?, updated_at = NOW() WHERE id = ?',
      [name, description, req.params.id]
    );

    const [updatedProject] = await db.execute(
      'SELECT * FROM projects WHERE id = ?',
      [req.params.id]
    );

    res.json({
      ...updatedProject[0],
      userRole: req.projectRole
    });
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ message: 'Error updating project' });
  }
});

// Delete project (requires owner role)
router.delete('/:id', verifyToken, requireProjectAccess('owner'), async (req, res) => {
  try {
    const projectId = req.params.id;

    // Get project info
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ?',
      [projectId]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const project = projects[0];

    // Delete project directory
    // Get owner's email for workspace path resolution
    const [owners] = await db.execute(
      'SELECT id, email FROM users WHERE id = ?',
      [project.user_id]
    );

    if (owners.length === 0) {
      return res.status(500).json({ message: 'Project owner not found' });
    }

    const projectOwner = { id: owners[0].id, email: owners[0].email };
    const projectPath = getProjectPath(projectOwner, projectId);
    try {
      await fs.rm(projectPath, { recursive: true, force: true });
    } catch (error) {
      console.error('Error deleting project directory:', error);
    }

    // Delete from database (CASCADE will handle related records including project_members)
    const [deleteResult] = await db.execute(
      'DELETE FROM projects WHERE id = ?',
      [projectId]
    );

    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    res.json({
      message: 'Project deleted successfully',
      projectId: projectId,
      projectName: project.name
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
      'SELECT p.*, u.id as user_id, u.email as user_email FROM projects p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
      [projectId]
    );

    if (projects.length === 0) {
      return res.status(404).send('<h1>Project not found</h1>');
    }

    const owner = {
      id: projects[0].user_id,
      email: projects[0].user_email
    };

    const projectRoot = await resolveExistingProjectPath(owner, projectId);

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
