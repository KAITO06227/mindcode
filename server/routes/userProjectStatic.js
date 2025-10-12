const express = require('express');
const { resolveExistingProjectPath } = require('../utils/userWorkspace');
const { serveProjectAsset } = require('../utils/projectPreviewUtils');

const router = express.Router();

const encodePathSegment = (value) => encodeURIComponent(String(value));

const handleProjectAssetRequest = (defaultPath) => async (req, res) => {
  try {
    const emailParam = req.params.email || '';
    const projectDirParam = req.params.projectDir || '';
    const requestedPath = defaultPath || req.params[0] || 'index.html';

    if (!emailParam || !projectDirParam) {
      res.status(400).send('<h1>Invalid request</h1>');
      return;
    }

    const projectRoot = await resolveExistingProjectPath({ email: emailParam }, projectDirParam);

    await serveProjectAsset({
      projectRoot,
      requestedPath,
      projectId: projectDirParam,
      token: null,
      res,
      db: null,
      baseHref: `${req.baseUrl}/${encodePathSegment(emailParam)}/${encodePathSegment(projectDirParam)}/`
    });
  } catch (error) {
    console.error('Error serving public project asset:', error);
    res.status(500).send('<h1>Error loading project</h1>');
  }
};

router.get('/:email/:projectDir', handleProjectAssetRequest('index.html'));
router.get('/:email/:projectDir/*', handleProjectAssetRequest());

module.exports = router;
