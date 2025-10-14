const express = require('express');
const { verifyToken, isTeacher } = require('../middleware/auth');
const db = require('../database/connection');
const fs = require('fs').promises;
const { getProjectPath } = require('../utils/userWorkspace');

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

// Get Claude prompt history for a project (teachers only)
router.get('/projects/:projectId/claude-prompts', verifyToken, isTeacher, async (req, res) => {
  try {
    const projectId = req.params.projectId;

    const [projects] = await db.execute(`
      SELECT p.id, p.name, p.user_id, u.name AS owner_name, u.email AS owner_email
      FROM projects p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [projectId]);

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const project = projects[0];

    const [logs] = await db.execute(`
      SELECT cpl.id, cpl.prompt, cpl.duration_ms, cpl.created_at, cpl.user_id,
             u.name AS user_name, u.email AS user_email
      FROM claude_prompt_logs cpl
      JOIN users u ON cpl.user_id = u.id
      WHERE cpl.project_id = ?
      ORDER BY cpl.created_at DESC
    `, [projectId]);

    res.json({
      project,
      prompts: logs
    });
  } catch (error) {
    console.error('Error fetching Claude prompts:', error);
    res.status(500).json({ message: 'Error fetching Claude prompt history' });
  }
});

// Delete project (teachers only)
router.delete('/projects/:id', verifyToken, isTeacher, async (req, res) => {
  try {
    const projectId = req.params.id;
    
    // Get project details including user info
    const [projects] = await db.execute(`
      SELECT p.*, u.id as user_id, u.name as user_name, u.email as user_email 
      FROM projects p 
      JOIN users u ON p.user_id = u.id 
      WHERE p.id = ?
    `, [projectId]);

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const project = projects[0];
    const owner = { id: project.user_id, email: project.user_email };
    const projectPath = getProjectPath(owner, projectId);

    try {
      await fs.rm(projectPath, { recursive: true, force: true });
    } catch (error) {
    }

    // Delete from database (CASCADE will handle related records)
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
      projectName: project.name,
      ownerName: project.user_name
    });
  } catch (error) {
    console.error('Error deleting project (admin):', error);
    res.status(500).json({ 
      message: 'Error deleting project',
      error: error.message 
    });
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
