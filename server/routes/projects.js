const express = require('express');
const { verifyToken } = require('../middleware/auth');
const db = require('../database/connection');
const fs = require('fs').promises;
const path = require('path');

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
    
    const [result] = await db.execute(
      'INSERT INTO projects (user_id, name, description) VALUES (?, ?, ?)',
      [req.user.id, name, description || '']
    );

    // Create project directory
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), result.insertId.toString());
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

    await fs.writeFile(path.join(projectPath, 'index.html'), indexHtml);
    await fs.writeFile(path.join(projectPath, 'style.css'), indexCss);
    await fs.writeFile(path.join(projectPath, 'script.js'), indexJs);

    // Save files to database
    const files = [
      { path: 'index.html', content: indexHtml, type: 'html' },
      { path: 'style.css', content: indexCss, type: 'css' },
      { path: 'script.js', content: indexJs, type: 'javascript' }
    ];

    for (const file of files) {
      await db.execute(
        'INSERT INTO project_files (project_id, file_path, file_name, content, file_type) VALUES (?, ?, ?, ?, ?)',
        [result.insertId, file.path, path.basename(file.path), file.content, file.type]
      );
    }

    const [newProject] = await db.execute('SELECT * FROM projects WHERE id = ?', [result.insertId]);
    res.status(201).json(newProject[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating project' });
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

    res.json(projects[0]);
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
    // Delete project directory
    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), req.params.id);
    try {
      await fs.rmdir(projectPath, { recursive: true });
    } catch (error) {
      // Directory might not exist, continue
    }

    // Delete from database (cascade will handle files)
    await db.execute(
      'DELETE FROM projects WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting project' });
  }
});

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