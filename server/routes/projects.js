const express = require('express');
const { verifyToken } = require('../middleware/auth');
const db = require('../database/connection');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
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

    // Create initial files for Node.js + Express project
    const packageJson = `{
  "name": "${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}",
  "version": "1.0.0",
  "description": "${description || 'Node.js Express application'}",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "echo \\"Error: no test specified\\" && exit 1"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "keywords": [
    "node",
    "express",
    "web",
    "api"
  ],
  "author": "MindCode User",
  "license": "MIT"
}`;

    const serverJs = `const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware - Allow all origins for external access
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  // Send HTML directly instead of redirecting
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/hello', (req, res) => {
  res.json({ 
    message: 'Hello from ${name} API!',
    timestamp: new Date().toISOString(),
    status: 'success'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(\`🚀 Server running on http://\${HOST}:\${PORT}\`);
  console.log(\`📁 Project: ${name}\`);
});

module.exports = app;`;

    const indexHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name}</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>🚀 ${name}</h1>
            <p>Node.js + Express アプリケーション</p>
        </header>
        
        <main>
            <section class="info-card">
                <h2>📋 プロジェクト情報</h2>
                <ul>
                    <li><strong>フレームワーク:</strong> Express.js</li>
                    <li><strong>ポート:</strong> <span id="current-port">起動時に決定</span></li>
                    <li><strong>状態:</strong> <span id="status">確認中...</span></li>
                </ul>
            </section>
            
            <section class="api-card">
                <h2>🔗 API エンドポイント</h2>
                <div class="api-test">
                    <button id="test-api" onclick="testAPI()">APIテスト実行</button>
                    <div id="api-result"></div>
                </div>
            </section>
            
            <section class="getting-started">
                <h2>🎯 開始方法</h2>
                <ol>
                    <li>ターミナルで <code>npm install</code> を実行</li>
                    <li><code>npm run dev</code> でサーバーを起動</li>
                    <li>MindCodeプレビューでサーバー内容を確認</li>
                </ol>
            </section>
        </main>
        
        <footer>
            <p>Created with ❤️ by MindCode</p>
        </footer>
    </div>
    
    <script src="script.js"></script>
</body>
</html>`;

    const indexCss = `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    line-height: 1.6;
    color: #333;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
}

.container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
}

header {
    text-align: center;
    margin-bottom: 40px;
    color: white;
}

header h1 {
    font-size: 2.5rem;
    margin-bottom: 10px;
    text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
}

header p {
    font-size: 1.2rem;
    opacity: 0.9;
}

main {
    display: grid;
    gap: 20px;
}

.info-card, .api-card, .getting-started {
    background: white;
    border-radius: 12px;
    padding: 25px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.1);
    backdrop-filter: blur(10px);
}

.info-card h2, .api-card h2, .getting-started h2 {
    color: #444;
    margin-bottom: 15px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.info-card ul {
    list-style: none;
}

.info-card li {
    padding: 8px 0;
    border-bottom: 1px solid #eee;
}

.info-card li:last-child {
    border-bottom: none;
}

#status {
    color: #28a745;
    font-weight: bold;
}

.api-test {
    margin-top: 15px;
}

#test-api {
    background: linear-gradient(45deg, #667eea, #764ba2);
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
    transition: transform 0.2s, box-shadow 0.2s;
}

#test-api:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}

#api-result {
    margin-top: 15px;
    padding: 15px;
    background: #f8f9fa;
    border-radius: 6px;
    border-left: 4px solid #007bff;
    display: none;
}

.getting-started ol {
    padding-left: 20px;
}

.getting-started li {
    margin-bottom: 10px;
}

.getting-started code {
    background: #f1f3f4;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    color: #d73a49;
}

footer {
    text-align: center;
    margin-top: 40px;
    color: white;
    opacity: 0.8;
}

@media (max-width: 768px) {
    .container {
        padding: 15px;
    }
    
    header h1 {
        font-size: 2rem;
    }
    
    .info-card, .api-card, .getting-started {
        padding: 20px;
    }
}`;

    const indexJs = `// ${name} - Client-side JavaScript
console.log('🚀 ${name} アプリケーション開始');

// API テスト関数
async function testAPI() {
    const button = document.getElementById('test-api');
    const resultDiv = document.getElementById('api-result');
    
    button.textContent = 'テスト実行中...';
    button.disabled = true;
    
    try {
        const response = await fetch('/api/hello');
        const data = await response.json();
        
        resultDiv.innerHTML = \`
            <h3>✅ API レスポンス成功</h3>
            <pre>\${JSON.stringify(data, null, 2)}</pre>
        \`;
        resultDiv.style.display = 'block';
        resultDiv.style.borderLeftColor = '#28a745';
        
        // ステータス更新
        document.getElementById('status').textContent = '正常動作中';
        document.getElementById('status').style.color = '#28a745';
        
    } catch (error) {
        console.error('API テストエラー:', error);
        
        resultDiv.innerHTML = \`
            <h3>❌ API エラー</h3>
            <p>エラー: \${error.message}</p>
            <p>サーバーが起動しているか確認してください。</p>
        \`;
        resultDiv.style.display = 'block';
        resultDiv.style.borderLeftColor = '#dc3545';
        
        // ステータス更新
        document.getElementById('status').textContent = 'エラー';
        document.getElementById('status').style.color = '#dc3545';
    } finally {
        button.textContent = 'APIテスト実行';
        button.disabled = false;
    }
}

// ページロード時の初期化
document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOM読み込み完了');
    
    // 現在のポートを表示
    const portElement = document.getElementById('current-port');
    if (portElement) {
        const currentPort = window.location.port || '不明';
        portElement.textContent = currentPort;
        portElement.style.color = '#007bff';
        portElement.style.fontWeight = 'bold';
        console.log('Current port detected:', currentPort);
    }
    
    // 自動でAPIテストを実行
    setTimeout(() => {
        testAPI();
    }, 1000);
});`;

    const envFile = `# Environment Variables for ${name}
NODE_ENV=development
PORT=3000

# Database (if needed)
# DB_HOST=localhost
# DB_PORT=3306
# DB_NAME=myapp
# DB_USER=root
# DB_PASSWORD=

# JWT Secret (if using authentication)
# JWT_SECRET=your-secret-key-here

# API Keys (add your API keys here)
# API_KEY=your-api-key
`;

    const readmeFile = `# ${name}

${description || 'Node.js + Express アプリケーション'}

## 📋 概要

このプロジェクトはNode.js + Expressを使用したWebアプリケーションです。

## 🚀 開始方法

### 1. 依存関係のインストール
\`\`\`bash
npm install
\`\`\`

### 2. 開発サーバーの起動
\`\`\`bash
npm run dev
\`\`\`

### 3. アクセス
ブラウザで [http://localhost:3000](http://localhost:3000) にアクセスしてください。

## 📁 プロジェクト構造

\`\`\`
${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}/
├── server.js          # メインサーバーファイル
├── package.json       # プロジェクト設定
├── .env              # 環境変数
├── README.md         # このファイル
└── public/           # 静的ファイル
    ├── index.html    # メインHTML
    ├── style.css     # スタイルシート
    └── script.js     # クライアントサイドJS
\`\`\`

## 🔗 API エンドポイント

- \`GET /\` - メインページ
- \`GET /api/hello\` - APIテスト用エンドポイント

## 🛠️ 使用技術

- **Node.js** - JavaScript実行環境
- **Express** - Webフレームワーク
- **CORS** - クロスオリジンリソース共有
- **dotenv** - 環境変数管理

## 📝 開発メモ

- \`npm run dev\` で開発サーバー起動（nodemon使用）
- \`npm start\` で本番サーバー起動
- 環境変数は \`.env\` ファイルで管理

## 📄 ライセンス

MIT
`;

    const gitignoreFile = `# Node.js
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs
*.log

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# Mac
.DS_Store

# Windows
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# Temporary files
tmp/
temp/
`;

    // Write files to disk
    try {
      console.log('Project path:', projectPath);
      
      // Ensure project directory exists
      await fs.mkdir(projectPath, { recursive: true });
      console.log('Project directory created/verified');
      
      // Create public directory for static files
      const publicPath = path.join(projectPath, 'public');
      await fs.mkdir(publicPath, { recursive: true });
      console.log('Public directory created');
      
      // Create root files
      await fs.writeFile(path.join(projectPath, 'package.json'), packageJson);
      console.log('Created package.json');
      
      await fs.writeFile(path.join(projectPath, 'server.js'), serverJs);
      console.log('Created server.js');
      
      await fs.writeFile(path.join(projectPath, '.env'), envFile);
      console.log('Created .env');
      
      await fs.writeFile(path.join(projectPath, 'README.md'), readmeFile);
      console.log('Created README.md');
      
      await fs.writeFile(path.join(projectPath, '.gitignore'), gitignoreFile);
      console.log('Created .gitignore');
      
      // Create public files
      await fs.writeFile(path.join(publicPath, 'index.html'), indexHtml);
      console.log('Created public/index.html');
      
      await fs.writeFile(path.join(publicPath, 'style.css'), indexCss);
      console.log('Created public/style.css');
      
      await fs.writeFile(path.join(publicPath, 'script.js'), indexJs);
      console.log('Created public/script.js');
      
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
      // Public directory (folder)
      { path: 'public', name: 'public', content: '', type: 'folder', isFolder: true },
      
      // Root files
      { path: 'package.json', name: 'package.json', content: packageJson, type: 'json' },
      { path: 'server.js', name: 'server.js', content: serverJs, type: 'javascript' },
      { path: '.env', name: '.env', content: envFile, type: 'text' },
      { path: 'README.md', name: 'README.md', content: readmeFile, type: 'markdown' },
      { path: '.gitignore', name: '.gitignore', content: gitignoreFile, type: 'text' },
      
      // Public directory files
      { path: 'public/index.html', name: 'index.html', content: indexHtml, type: 'html' },
      { path: 'public/style.css', name: 'style.css', content: indexCss, type: 'css' },
      { path: 'public/script.js', name: 'script.js', content: indexJs, type: 'javascript' }
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
          const permissions = file.isFolder ? 'rwxr-xr-x' : 'rw-r--r--';
          
          // Try new filesystem database structure
          const [result] = await db.execute(`
            INSERT INTO project_files 
            (project_id, file_path, file_name, content, file_type, file_size, 
             permissions, checksum, is_binary, created_by, updated_by) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [projectId, file.path, file.name, file.content, file.type, fileSize, 
             permissions, checksum, false, req.user.id, req.user.id]
          );

          const fileId = result.insertId;
          
          // Create initial version record
          const changeType = file.isFolder ? 'Folder created' : 'Initial file creation';
          await db.execute(`
            INSERT INTO file_versions 
            (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
            VALUES (?, 1, ?, ?, 'create', ?, ?)`,
            [fileId, fileSize, checksum, changeType, req.user.id]
          );
          
          console.log(`Saved ${file.name} to database with new structure`);
        } catch (newStructureError) {
          console.log(`New structure failed for ${file.name}, trying legacy structure:`, newStructureError.message);
          
          // Fallback to old database structure
          await db.execute(
            'INSERT INTO project_files (project_id, file_path, file_name, content, file_type) VALUES (?, ?, ?, ?, ?)',
            [projectId, file.path, file.name, file.content, file.type]
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