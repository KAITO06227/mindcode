const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const execAsync = promisify(exec);

class GitManager {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.gitPath = path.join(projectPath, '.git');
    this.indexLockPath = path.join(this.gitPath, 'index.lock');
  }

  /**
   * プロジェクトでトリップコードリポジトリを初期化
   */
  async initRepository(userName = 'WebIDE User', userEmail = 'webide@example.com') {
    try {
      // 既に初期化済みかチェック
      if (await this.isInitialized()) {
        return {
          success: true,
          message: 'Tripcode repository already initialized',
          branch: 'main'
        };
      }
      
      // プロジェクトディレクトリの存在確認
      try {
        await fs.access(this.projectPath);
      } catch (error) {
        console.error('Project directory does not exist:', this.projectPath);
        throw new Error(`Project directory not found: ${this.projectPath}`);
      }

      // 既存の.gitディレクトリを完全に削除してクリーンアップ
      try {
        const { stdout: rmOutput } = await execAsync(`rm -rf "${this.gitPath}"`, { cwd: this.projectPath });
        
        // 削除完了まで少し待機
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (cleanupError) {
      }

      // 既存の .gitignore を尊重し、存在しないときのみテンプレートを作成
      const gitignorePath = path.join(this.projectPath, '.gitignore');
      try {
        await fs.access(gitignorePath);
      } catch (ignoreError) {
        const gitignore = `# WebIDE generated files
.DS_Store
node_modules/
*.log
.env
.bash_history
.config/
.backup/
`;
        await fs.writeFile(gitignorePath, gitignore);
      }

      // Git初期化（クリーンな状態から、テンプレート使用せず）
      const initResult = await execAsync('git init --initial-branch=main --template=""', { cwd: this.projectPath });

      await execAsync(`git config user.name "${userName}"`, { cwd: this.projectPath });
      await execAsync(`git config user.email "${userEmail}"`, { cwd: this.projectPath });

      // ファイルの存在確認
      const { stdout: files } = await execAsync('ls -la', { cwd: this.projectPath });
      
      // 初期コミット
      const addResult = await execAsync('git add .', { cwd: this.projectPath });

      const commitResult = await execAsync('git commit -m "Initial commit: Project created via WebIDE"', { cwd: this.projectPath });

      return {
        success: true,
        message: 'Tripcode repository initialized successfully',
        branch: 'main'
      };
    } catch (error) {
      console.error('Tripcode initialization error:', error);
      console.error('Error stdout:', error.stdout);
      console.error('Error stderr:', error.stderr);
      console.error('Project path:', this.projectPath);
      throw new Error(`Tripcode repository initialization failed: ${error.message}. Stdout: ${error.stdout || 'none'}. Stderr: ${error.stderr || 'none'}`);
    }
  }

  /**
   * Gitリポジトリが初期化されているかチェック
   */
  async isInitialized() {
    try {
      await fs.access(this.gitPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ファイルをステージングエリアに追加
   */
  async addFile(filePath) {
    try {
      await execAsync(`git add "${filePath}"`, { cwd: this.projectPath });
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to add file to Tripcode repository: ${error.message}`);
    }
  }

  /**
   * 変更をコミット
   */
  async commit(message, authorName = 'WebIDE User', authorEmail = 'webide@example.com') {
    try {
      await this.ensureIndexLock();

      const commitMessage = typeof message === 'string' ? message : String(message ?? '');
      const sanitizedMessage = commitMessage.replace(/"/g, '\\"');
      const { stdout } = await execAsync(
        `git -c user.name="${authorName}" -c user.email="${authorEmail}" commit -m "${sanitizedMessage}"`,
        { cwd: this.projectPath }
      );
      
      // コミットハッシュを取得
      const { stdout: commitHash } = await execAsync('git rev-parse HEAD', { cwd: this.projectPath });
      
      return {
        success: true,
        commitHash: commitHash.trim(),
        message: stdout.trim()
      };
    } catch (error) {
      if (error.message.includes('nothing to commit')) {
        return { success: false, message: 'No changes to commit' };
      }
      throw new Error(`Commit failed: ${error.message}`);
    }
  }

  /**
   * index.lock の存在をチェックし、古いロックであれば削除
   */
  async ensureIndexLock(maxLockAgeMs = 2 * 60 * 1000) {
    try {
      const stats = await fs.stat(this.indexLockPath);
      const ageMs = Date.now() - stats.mtimeMs;

      if (ageMs > maxLockAgeMs) {
        console.warn(`Stale git index.lock detected (age ${ageMs}ms). Removing...`);
        await fs.unlink(this.indexLockPath);
        return;
      }

      throw new Error('Tripcode index.lock file exists. Another git process may be running.');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return; // No lock file
      }
      throw error;
    }
  }

  async clearIndexLock() {
    try {
      await fs.unlink(this.indexLockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Git状態取得
   */
  async getStatus() {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: this.projectPath });
      const { stdout: branch } = await execAsync('git branch --show-current', { cwd: this.projectPath });
      const { stdout: head } = await execAsync('git rev-parse HEAD', { cwd: this.projectPath });

      return {
        branch: branch.trim(),
        head: head.trim(),
        hasChanges: stdout.trim().length > 0,
        changes: stdout.trim().split('\n').filter(line => line.length > 0)
      };
    } catch (error) {
      throw new Error(`Failed to get git status: ${error.message}`);
    }
  }

  /**
   * 作業ツリーと最後のコミットを内容比較（スマートコミット判定）
   */
  async hasContentChanges() {
    try {
      console.log(`[GIT] Checking content changes in ${this.projectPath}`);

      // 作業ツリーの変更をチェック
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: this.projectPath });
      const hasWorkingChanges = statusOutput && statusOutput.trim().length > 0;

      if (!hasWorkingChanges) {
        console.log(`[GIT] No working tree changes detected`);
        return false;
      }

      // 最後のコミットのツリーハッシュを取得
      let lastCommitTree;
      try {
        const { stdout: lastTree } = await execAsync('git rev-parse HEAD^{tree}', { cwd: this.projectPath });
        lastCommitTree = lastTree.trim();
      } catch (headError) {
        // 初期コミットがない場合（空のリポジトリ）
        console.log(`[GIT] No HEAD found, treating as initial commit`);
        return true;
      }

      // 現在の作業ツリーのハッシュを計算
      // まずインデックスに追加（一時的に）
      await execAsync('git add .', { cwd: this.projectPath });
      const { stdout: currentTree } = await execAsync('git write-tree', { cwd: this.projectPath });

      const hasContentDifference = lastCommitTree !== currentTree.trim();

      console.log(`[GIT] Last commit tree: ${lastCommitTree}`);
      console.log(`[GIT] Current tree: ${currentTree.trim()}`);
      console.log(`[GIT] Content difference: ${hasContentDifference}`);

      return hasContentDifference;
    } catch (error) {
      console.error(`[GIT] Error checking content changes:`, error);
      // エラーが発生した場合は安全側に倒して変更があると判定
      return true;
    }
  }

  /**
   * コミット履歴取得
   */
  async getCommitHistory(limit = 20) {
    try {
      const limitArg = Number.isFinite(limit) && limit > 0 ? `--max-count=${limit}` : '';
      const command = `git log --oneline ${limitArg} --pretty=format:"%H|%an|%ae|%ad|%s" --date=iso`;
      const { stdout } = await execAsync(command.trim(), { cwd: this.projectPath });

      const commits = stdout.trim().split('\n').map(line => {
        const [hash, author, email, date, message] = line.split('|');
        return {
          hash,
          author,
          email,
          date: new Date(date),
          message
        };
      });

      return commits;
    } catch (error) {
      throw new Error(`Failed to get commit history: ${error.message}`);
    }
  }

  /**
   * ファイルの差分取得
   */
  async getDiff(filePath, commitHash = null) {
    try {
      let command = `git diff "${filePath}"`;
      if (commitHash) {
        command = `git diff ${commitHash} "${filePath}"`;
      }

      const { stdout } = await execAsync(command, { cwd: this.projectPath });
      return stdout;
    } catch (error) {
      throw new Error(`Failed to get diff: ${error.message}`);
    }
  }


  /**
   * 特定のコミットからファイル内容を取得
   */
  async getFileAtCommit(filePath, commitHash) {
    try {
      const { stdout } = await execAsync(
        `git show ${commitHash}:"${filePath}"`,
        { cwd: this.projectPath }
      );
      return stdout;
    } catch (error) {
      if (error.message.includes('does not exist')) {
        return null;
      }
      throw new Error(`Failed to get file at commit: ${error.message}`);
    }
  }

  /**
   * 指定したコミットに作業ツリーを安全に復元（HEADは変更しない）
   */
  async restoreToCommit(commitHash) {
    try {
      console.log(`[GIT] Safely restoring working tree to commit ${commitHash} in ${this.projectPath}`);

      // 現在のHEADを記録（保護）
      const { stdout: currentHead } = await execAsync('git rev-parse HEAD', { cwd: this.projectPath });
      console.log(`[GIT] Current HEAD (preserved): ${currentHead.trim()}`);

      // ステップ1: 作業ツリーのファイルを全削除（.gitディレクトリなどは除外）
      console.log(`[GIT] Cleaning working tree (preserving .git)`);
      await this.cleanWorkingTree();

      // ステップ2: 指定コミットの状態を復元
      // git checkout {commit} -- . を使用（HEADは変更しない）
      console.log(`[GIT] Executing git checkout ${commitHash} -- .`);
      const { stdout: checkoutOutput } = await execAsync(`git checkout ${commitHash} -- .`, { cwd: this.projectPath });
      console.log(`[GIT] Checkout completed: ${checkoutOutput || 'Working tree restored'}`);

      // 復元後の状態を確認
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: this.projectPath });
      const { stdout: headAfter } = await execAsync('git rev-parse HEAD', { cwd: this.projectPath });

      console.log(`[GIT] HEAD after restore: ${headAfter.trim()} (should be unchanged)`);
      console.log(`[GIT] Working tree status: ${statusOutput ? 'has staged changes' : 'clean'}`);

      const hasChanges = statusOutput && statusOutput.trim().length > 0;

      // HEADが変更されていないことを確認
      const headUnchanged = currentHead.trim() === headAfter.trim();
      if (!headUnchanged) {
        console.warn(`[GIT] WARNING: HEAD changed unexpectedly from ${currentHead.trim()} to ${headAfter.trim()}`);
      }

      return {
        success: true,
        message: `Successfully restored working tree to commit ${commitHash}`,
        commitHash,
        originalHead: currentHead.trim(),
        currentHead: headAfter.trim(),
        headUnchanged,
        hasChanges
      };
    } catch (error) {
      console.error(`[GIT] Failed to restore to commit ${commitHash}:`, error);
      throw new Error(`Failed to restore to commit: ${error.message}`);
    }
  }

  /**
   * 作業ツリーのファイルを全削除（.gitなどの重要ディレクトリは保護）
   */
  async cleanWorkingTree() {
    try {
      const items = await fs.readdir(this.projectPath, { withFileTypes: true });

      // 保護するディレクトリ/ファイル
      const protectedItems = new Set(['.git', '.gitignore']);

      for (const item of items) {
        if (protectedItems.has(item.name)) {
          continue;
        }

        const itemPath = path.join(this.projectPath, item.name);

        try {
          if (item.isDirectory()) {
            // ディレクトリを再帰的に削除
            await fs.rm(itemPath, { recursive: true, force: true });
            console.log(`[GIT] Removed directory: ${item.name}`);
          } else {
            // ファイルを削除
            await fs.unlink(itemPath);
            console.log(`[GIT] Removed file: ${item.name}`);
          }
        } catch (deleteError) {
          console.warn(`[GIT] Failed to remove ${item.name}: ${deleteError.message}`);
        }
      }

      console.log(`[GIT] Working tree cleaned successfully`);
    } catch (error) {
      console.error(`[GIT] Failed to clean working tree:`, error);
      throw new Error(`Failed to clean working tree: ${error.message}`);
    }
  }

  /**
   * 未コミット変更を一時的に保存（git stash）
   */
  async stashChanges(message = 'Auto-stash before restore') {
    try {
      console.log(`[GIT] Stashing changes: ${message}`);
      const { stdout } = await execAsync(`git stash push -m "${message}"`, { cwd: this.projectPath });
      console.log(`[GIT] Stash result: ${stdout.trim()}`);

      return {
        success: true,
        message: stdout.trim()
      };
    } catch (error) {
      if (error.message.includes('No local changes to save')) {
        console.log(`[GIT] No changes to stash`);
        return { success: true, message: 'No changes to stash' };
      }
      throw new Error(`Failed to stash changes: ${error.message}`);
    }
  }

  /**
   * 物理ファイルとデータベースを同期する
   */
  async syncPhysicalFilesWithDatabase(projectId, userId, db) {
    const fs = require('fs').promises;
    const path = require('path');
    const crypto = require('crypto');

    try {
      console.log(`[SYNC] Starting file sync for project ${projectId}`);

      // 物理ファイルシステムを走査
      const physicalFiles = await this.scanPhysicalFiles(this.projectPath);

      // データベースの現在のファイル一覧を取得
      const [dbFiles] = await db.execute(
        'SELECT * FROM project_files WHERE project_id = ?',
        [projectId]
      );

      const dbFileMap = new Map();
      dbFiles.forEach(file => {
        dbFileMap.set(file.file_path, file);
      });

      let syncedCount = 0;
      let addedCount = 0;
      let removedCount = 0;

      // 物理ファイルをデータベースに追加/更新
      for (const physicalFile of physicalFiles) {
        const dbFile = dbFileMap.get(physicalFile.filePath);
        const checksum = this.calculateChecksum(physicalFile.content);

        if (!dbFile) {
          // 新しいファイルをデータベースに追加
          console.log(`[SYNC] Adding new file: ${physicalFile.filePath}`);
          try {
            await this.addFileToDatabase(projectId, physicalFile, userId, db);
            addedCount++;
          } catch (addError) {
            if (addError.code === 'ER_DUP_ENTRY') {
              console.log(`[SYNC] File ${physicalFile.filePath} already exists in DB, skipping`);
            } else {
              throw addError;
            }
          }
        } else if (dbFile.checksum !== checksum) {
          // ファイル内容が変更された場合は更新
          console.log(`[SYNC] Updating changed file: ${physicalFile.filePath}`);
          await this.updateFileInDatabase(dbFile.id, physicalFile, userId, db);
          syncedCount++;
        }

        dbFileMap.delete(physicalFile.filePath);
      }

      // データベースにあるが物理ファイルに存在しないファイルを削除
      for (const [filePath, dbFile] of dbFileMap) {
        // .gitignoreやHiddenファイルは除外
        if (!filePath.startsWith('.git') && !filePath.startsWith('.mindcode/')) {
          console.log(`[SYNC] Removing deleted file from DB: ${filePath}`);
          await db.execute('DELETE FROM project_files WHERE id = ?', [dbFile.id]);
          removedCount++;
        }
      }

      console.log(`[SYNC] Sync completed: ${addedCount} added, ${syncedCount} updated, ${removedCount} removed`);

      return {
        success: true,
        fileCount: physicalFiles.length,
        folderCount: physicalFiles.filter(f => f.isFolder).length,
        addedCount,
        syncedCount,
        removedCount
      };
    } catch (error) {
      console.error('[SYNC] Failed to sync files:', error);
      throw new Error(`File sync failed: ${error.message}`);
    }
  }

  /**
   * 物理ファイルシステムをスキャンする
   */
  async scanPhysicalFiles(dirPath, relativePath = '') {
    const fs = require('fs').promises;
    const path = require('path');
    const files = [];

    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);
        const relativeFilePath = relativePath ? `${relativePath}/${item.name}` : item.name;

        // .gitディレクトリと.mindcodeディレクトリの一部をスキップ
        if (item.name === '.git' || (relativePath === '' && item.name === '.mindcode')) {
          continue;
        }

        if (item.isDirectory()) {
          // フォルダを追加
          files.push({
            filePath: relativeFilePath,
            fileName: item.name,
            content: '',
            fileType: 'folder',
            isFolder: true,
            fileSize: 0
          });

          // サブディレクトリを再帰的にスキャン
          const subFiles = await this.scanPhysicalFiles(itemPath, relativeFilePath);
          files.push(...subFiles);
        } else {
          // ファイルを追加
          try {
            const content = await fs.readFile(itemPath, 'utf8');
            const fileSize = Buffer.byteLength(content, 'utf8');
            const fileType = this.getFileType(item.name);

            files.push({
              filePath: relativeFilePath,
              fileName: item.name,
              content,
              fileType,
              isFolder: false,
              fileSize
            });
          } catch (readError) {
            console.warn(`[SYNC] Could not read file ${itemPath}: ${readError.message}`);
          }
        }
      }
    } catch (error) {
      console.warn(`[SYNC] Could not scan directory ${dirPath}: ${error.message}`);
    }

    return files;
  }

  /**
   * ファイルをデータベースに追加
   */
  async addFileToDatabase(projectId, file, userId, db) {
    const checksum = this.calculateChecksum(file.content);
    const isBinary = this.isBinaryFile(file.content);

    const [result] = await db.execute(`
      INSERT INTO project_files
      (project_id, file_path, file_name, content, file_type, file_size,
       permissions, checksum, is_binary, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [projectId, file.filePath, file.fileName, file.content, file.fileType, file.fileSize,
       file.isFolder ? 'rwxr-xr-x' : 'rw-r--r--', checksum, isBinary, userId, userId]
    );

    const fileId = result.insertId;

    // 既存のバージョンレコードを確認してから追加
    const [existingVersions] = await db.execute(
      'SELECT * FROM file_versions WHERE file_id = ? AND version_number = 1',
      [fileId]
    );

    if (existingVersions.length === 0) {
      // バージョン履歴を追加（重複がない場合のみ）
      await db.execute(`
        INSERT INTO file_versions
        (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
        VALUES (?, 1, ?, ?, 'create', 'Initial sync', ?)`,
        [fileId, file.fileSize, checksum, userId]
      );
    } else {
      console.log(`[SYNC] Version 1 already exists for file ${fileId}, skipping`);
    }

    return fileId;
  }

  /**
   * データベースのファイル情報を更新
   */
  async updateFileInDatabase(fileId, file, userId, db) {
    const checksum = this.calculateChecksum(file.content);
    const isBinary = this.isBinaryFile(file.content);

    await db.execute(`
      UPDATE project_files
      SET content = ?, file_size = ?, checksum = ?, is_binary = ?, updated_by = ?, updated_at = NOW()
      WHERE id = ?`,
      [file.content, file.fileSize, checksum, isBinary, userId, fileId]
    );

    // バージョン履歴を追加
    const [versions] = await db.execute(
      'SELECT MAX(version_number) as maxVersion FROM file_versions WHERE file_id = ?',
      [fileId]
    );
    const nextVersion = (versions[0]?.maxVersion || 0) + 1;

    await db.execute(`
      INSERT INTO file_versions
      (file_id, version_number, file_size, checksum, change_type, change_summary, created_by)
      VALUES (?, ?, ?, ?, 'update', 'File sync update', ?)`,
      [fileId, nextVersion, file.fileSize, checksum, userId]
    );
  }

  /**
   * ファイルタイプを判定
   */
  getFileType(filename) {
    const ext = require('path').extname(filename).toLowerCase();
    const typeMap = {
      '.js': 'javascript',
      '.html': 'html',
      '.css': 'css',
      '.json': 'json',
      '.md': 'markdown',
      '.txt': 'text',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.php': 'php',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.yml': 'yaml',
      '.yaml': 'yaml',
      '.xml': 'xml',
      '.svg': 'svg',
      '.png': 'image',
      '.jpg': 'image',
      '.jpeg': 'image',
      '.gif': 'image',
      '.pdf': 'pdf'
    };
    return typeMap[ext] || 'text';
  }

  /**
   * バイナリファイルかどうかを判定
   */
  isBinaryFile(content) {
    // 簡単なバイナリ判定（NULL文字の存在をチェック）
    return content.includes('\0');
  }

  /**
   * チェックサムを計算
   */
  calculateChecksum(content) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * 最新のstashを復元（git stash pop）
   */
  async popStash() {
    try {
      console.log(`[GIT] Popping latest stash`);
      const { stdout } = await execAsync('git stash pop', { cwd: this.projectPath });
      console.log(`[GIT] Stash pop result: ${stdout.trim()}`);

      return {
        success: true,
        message: stdout.trim()
      };
    } catch (error) {
      if (error.message.includes('No stash entries found')) {
        console.log(`[GIT] No stash to pop`);
        return { success: true, message: 'No stash to pop' };
      }
      throw new Error(`Failed to pop stash: ${error.message}`);
    }
  }

  /**
   * ファイルのチェックサムを計算
   */
  static calculateChecksum(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * ブランチ作成
   */
  async createBranch(branchName) {
    try {
      await execAsync(`git checkout -b "${branchName}"`, { cwd: this.projectPath });
      return { success: true, branch: branchName };
    } catch (error) {
      throw new Error(`Failed to create branch: ${error.message}`);
    }
  }

  /**
   * ブランチ切り替え
   */
  async switchBranch(branchName) {
    try {
      await execAsync(`git checkout "${branchName}"`, { cwd: this.projectPath });
      return { success: true, branch: branchName };
    } catch (error) {
      throw new Error(`Failed to switch branch: ${error.message}`);
    }
  }

  /**
   * ブランチ一覧取得
   */
  async getBranches() {
    try {
      const { stdout } = await execAsync('git branch -a', { cwd: this.projectPath });
      const branches = stdout.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => ({
          name: line.replace(/^\*\s+/, '').replace(/^remotes\/origin\//, ''),
          current: line.startsWith('*')
        }));
      
      return branches;
    } catch (error) {
      throw new Error(`Failed to get branches: ${error.message}`);
    }
  }
}

module.exports = GitManager;
