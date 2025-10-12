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

async function resolveExistingProjectPath(user, projectId) {
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
