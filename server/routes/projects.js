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

module.exports = router;