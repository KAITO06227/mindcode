const express = require('express');
const { verifyToken, isTeacher } = require('../middleware/auth');
const db = require('../database/connection');

const router = express.Router();

// Get all users (teachers only)
router.get('/users', verifyToken, isTeacher, async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT id, google_id, email, name, role, avatar_url, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// Update user role (teachers only)
router.patch('/users/:id/role', verifyToken, isTeacher, async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!['student', 'teacher'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    await db.execute(
      'UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?',
      [role, req.params.id]
    );

    res.json({ message: 'User role updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating user role' });
  }
});

// Get all projects (teachers only)
router.get('/projects', verifyToken, isTeacher, async (req, res) => {
  try {
    const [projects] = await db.execute(`
      SELECT p.*, u.name as user_name, u.email as user_email 
      FROM projects p 
      JOIN users u ON p.user_id = u.id 
      ORDER BY p.updated_at DESC
    `);
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching projects' });
  }
});

// Get specific user's projects (teachers only)
router.get('/users/:userId/projects', verifyToken, isTeacher, async (req, res) => {
  try {
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC',
      [req.params.userId]
    );
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user projects' });
  }
});

// Get project preview URL for teacher viewing (teachers only)
router.get('/projects/:projectId/preview', verifyToken, isTeacher, async (req, res) => {
  try {
    const [projects] = await db.execute(`
      SELECT p.*, u.id as user_id, u.name as user_name 
      FROM projects p 
      JOIN users u ON p.user_id = u.id 
      WHERE p.id = ?
    `, [req.params.projectId]);

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const project = projects[0];
    const previewUrl = `/api/admin/projects/${project.id}/live`;
    
    res.json({
      project,
      previewUrl,
      message: 'Project preview available'
    });
  } catch (error) {
    res.status(500).json({ message: 'Error getting project preview' });
  }
});

// Serve live project preview (teachers only)
router.get('/projects/:projectId/live', verifyToken, isTeacher, async (req, res) => {
  try {
    const [files] = await db.execute(`
      SELECT pf.* 
      FROM project_files pf 
      JOIN projects p ON pf.project_id = p.id 
      WHERE p.id = ? AND pf.file_name = 'index.html'
    `, [req.params.projectId]);

    if (files.length === 0) {
      return res.status(404).send('<h1>No index.html found in this project</h1>');
    }

    // Serve the HTML content
    res.setHeader('Content-Type', 'text/html');
    res.send(files[0].content);
  } catch (error) {
    res.status(500).send('<h1>Error loading project</h1>');
  }
});

// Get project files for teacher viewing (teachers only)
router.get('/projects/:projectId/files', verifyToken, isTeacher, async (req, res) => {
  try {
    const [files] = await db.execute(
      'SELECT * FROM project_files WHERE project_id = ? ORDER BY file_path',
      [req.params.projectId]
    );
    res.json(files);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching project files' });
  }
});

// Delete user (teachers only)
router.delete('/users/:id', verifyToken, isTeacher, async (req, res) => {
  try {
    // Prevent deleting yourself
    if (req.params.id == req.user.id) {
      return res.status(400).json({ message: 'Cannot delete yourself' });
    }

    await db.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting user' });
  }
});

module.exports = router;