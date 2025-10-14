const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;

const USER_PROJECTS_ROOT = path.join(__dirname, '../../user_projects');

function sanitizeEmailForPath(email) {
  if (!email || typeof email !== 'string') {
    return null;
  }
  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]/gi, '_');
}

function assertValidUser(user) {
  const folderName = sanitizeEmailForPath(user?.email);
  if (!folderName) {
    throw new Error('User email is required to resolve workspace path');
  }
  return folderName;
}

function getUserFolderName(user) {
  return assertValidUser(user);
}

function getUserRootPath(user) {
  return path.join(USER_PROJECTS_ROOT, getUserFolderName(user));
}

async function ensureDirExists(targetPath) {
  await fsPromises.mkdir(targetPath, { recursive: true });
  return targetPath;
}

async function ensureUserRoot(user) {
  const root = getUserRootPath(user);
  await ensureDirExists(root);
  return root;
}

async function ensureProjectPath(user, projectId) {
  const userRoot = await ensureUserRoot(user);
  const projectPath = path.join(userRoot, projectId);
  await ensureDirExists(projectPath);
  return projectPath;
}

function getProjectPath(user, projectId) {
  return path.join(getUserRootPath(user), projectId);
}

/**
 * Resolve project path for a given user and projectId.
 * For shared projects, this should resolve to the owner's path.
 * @param {Object} user - Current user object (may be member, not owner)
 * @param {String} projectId - Project ID
 * @param {Object} db - Database connection (optional, for fetching owner)
 * @returns {Promise<String>} - Resolved project path
 */
async function resolveExistingProjectPath(user, projectId, db = null) {
  // If db is provided, try to get the project owner
  if (db) {
    try {
      const [projects] = await db.execute(
        'SELECT p.*, u.email as owner_email FROM projects p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
        [projectId]
      );

      if (projects.length > 0) {
        const owner = {
          id: projects[0].user_id,
          email: projects[0].owner_email
        };
        return getProjectPath(owner, projectId);
      }
    } catch (error) {
      console.error('Failed to fetch project owner, falling back to user path:', error);
    }
  }

  // Fallback to user's own path (for backwards compatibility)
  const projectPath = getProjectPath(user, projectId);
  return projectPath;
}

module.exports = {
  USER_PROJECTS_ROOT,
  sanitizeEmailForPath,
  getUserFolderName,
  getUserRootPath,
  ensureUserRoot,
  ensureProjectPath,
  resolveExistingProjectPath,
  getProjectPath
};
