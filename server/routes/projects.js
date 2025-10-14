const express = require('express');
const { verifyToken } = require('../middleware/auth');
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
    const projectPath = await ensureProjectPath(req.user, projectId);

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

    const indexJs = `// Customize your project "${name}" here\n`;

    const aiSharedGuide = [
      '# MindCode AI 協調ガイド',
      '',
      'このファイルは複数の AI エージェントが共通で参照する指示書です。',
      '',
      '## 共通原則',
      '- 作業開始前に現在の課題と目的を整理し、必要であればここにメモを残すこと',
      '- 変更内容は簡潔に記録し、他のエージェントが状況を把握できるようにすること',
      '- 競合する提案がある場合は、優先度と根拠を明示して調整案を提示すること',
      '',
      '## 実装手順の共有',
      '- ファイル構成や重要な設定が変わる場合は、このファイルに追記して共有してください',
      '- 追加の指示や注意事項があれば、箇条書きで分かりやすくまとめてください',
      '',
      '## レビューと検証',
      '- 可能であれば、テスト手順や確認方法を記載し、他のエージェントも同じ手順を再利用できるようにしてください',
      '- 完了報告の際は、何を実施し、未完了のタスクがあるかどうかを明示してください'
    ].join('\n');

    const buildAgentPrompt = (agentLabel) => [
      `# ${agentLabel} Agent ワークフロー`,
      '',
      'プロジェクトルートの `AI.md` を読み込み、共通指示を反映しながら対応してください。',
      '',
      '## 行動ガイドライン',
      '- `AI.md` に記載された原則を優先して判断すること',
      '- 作業内容や決定事項があれば `AI.md` へ追記し、他エージェントと共有すること',
      '- 必要に応じて補助的なメモや TODO を `AI.md` に残してください'
    ].join('\n');

    const hiddenAgentFiles = [
      { filePath: '.mindcode/CLAUDE.md', content: buildAgentPrompt('Claude'), type: 'markdown', isHidden: true },
      { filePath: '.mindcode/AGENTS.md', content: buildAgentPrompt('Agents'), type: 'markdown', isHidden: true },
      { filePath: '.mindcode/GEMINI.md', content: buildAgentPrompt('Gemini'), type: 'markdown', isHidden: true }
    ];

    const gitignore = ['node_modules/', '.env', '.config/', '.backup/', '.mindcode/', '.codex/', '.gemini/'].join('\n');

    const filesToCreate = [
      { filePath: 'index.html', content: indexHtml, type: 'html' },
      { filePath: 'style.css', content: indexCss, type: 'css' },
      { filePath: 'script.js', content: indexJs, type: 'javascript' },
      { filePath: 'AI.md', content: aiSharedGuide, type: 'markdown' },
      ...hiddenAgentFiles,
      { filePath: '.gitignore', content: gitignore, type: 'text', isHidden: true }
    ];

    // Write files to disk
    try {
      await fs.mkdir(projectPath, { recursive: true });

      for (const file of filesToCreate) {
        const relativeDir = path.dirname(file.filePath);
        if (relativeDir && relativeDir !== '.') {
          await fs.mkdir(path.join(projectPath, relativeDir), { recursive: true });
        }
        await fs.writeFile(path.join(projectPath, file.filePath), file.content);
      }
    } catch (fileError) {
      console.error('Error creating files:', fileError);
      throw new Error(`Failed to create project files: ${fileError.message}`);
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
    
    // トリップコード初期化は別途APIで実行するため、ここでは処理しない

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
    const projectPath = getProjectPath(req.user, projectId);
    try {
      await fs.rm(projectPath, { recursive: true, force: true });
    } catch (error) {
    }

    // Delete from database (CASCADE will handle related records)
    const [deleteResult] = await db.execute(
      'DELETE FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

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
