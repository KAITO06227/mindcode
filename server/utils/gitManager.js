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
   * プロジェクトでGitリポジトリを初期化
   */
  async initRepository(userName = 'WebIDE User', userEmail = 'webide@example.com') {
    try {
      console.log(`Initializing Git repository at: ${this.projectPath}`);
      
      // 既に初期化済みかチェック
      if (await this.isInitialized()) {
        console.log('Git repository already initialized, skipping...');
        return {
          success: true,
          message: 'Git repository already initialized',
          branch: 'main'
        };
      }
      
      // プロジェクトディレクトリの存在確認
      try {
        await fs.access(this.projectPath);
        console.log('Project directory exists');
      } catch (error) {
        console.error('Project directory does not exist:', this.projectPath);
        throw new Error(`Project directory not found: ${this.projectPath}`);
      }

      // 既存の.gitディレクトリを完全に削除してクリーンアップ
      try {
        const { stdout: rmOutput } = await execAsync(`rm -rf "${this.gitPath}"`, { cwd: this.projectPath });
        console.log('Cleaned up existing .git directory with rm -rf');
        
        // 削除完了まで少し待機
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (cleanupError) {
        console.log('No existing .git directory to cleanup or rm failed, continuing...');
      }

      // .gitignoreファイルを作成
      const gitignore = `# WebIDE generated files
.DS_Store
node_modules/
*.log
.env
.bash_history
.config/
.backup/
`;
      await fs.writeFile(path.join(this.projectPath, '.gitignore'), gitignore);
      console.log('Created .gitignore file');

      // Git初期化（クリーンな状態から、テンプレート使用せず）
      console.log('Running git init...');
      const initResult = await execAsync('git init --initial-branch=main --template=""', { cwd: this.projectPath });
      console.log('Git init result:', initResult.stdout);

      console.log('Configuring git user...');
      await execAsync(`git config user.name "${userName}"`, { cwd: this.projectPath });
      await execAsync(`git config user.email "${userEmail}"`, { cwd: this.projectPath });
      console.log('Git user configured');

      // ファイルの存在確認
      const { stdout: files } = await execAsync('ls -la', { cwd: this.projectPath });
      console.log('Files in project directory:', files);
      
      // 初期コミット
      console.log('Adding files to git...');
      const addResult = await execAsync('git add .', { cwd: this.projectPath });
      console.log('Git add result:', addResult.stdout);

      console.log('Creating initial commit...');
      const commitResult = await execAsync('git commit -m "Initial commit: Project created via WebIDE"', { cwd: this.projectPath });
      console.log('Git commit result:', commitResult.stdout);

      return {
        success: true,
        message: 'Git repository initialized successfully',
        branch: 'main'
      };
    } catch (error) {
      console.error('Git initialization error:', error);
      console.error('Error stdout:', error.stdout);
      console.error('Error stderr:', error.stderr);
      console.error('Project path:', this.projectPath);
      throw new Error(`Git initialization failed: ${error.message}. Stdout: ${error.stdout || 'none'}. Stderr: ${error.stderr || 'none'}`);
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
      throw new Error(`Failed to add file to git: ${error.message}`);
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

      throw new Error('Git index.lock file exists. Another git process may be running.');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return; // No lock file
      }
      throw error;
    }
  }

  /**
   * Git状態取得
   */
  async getStatus() {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: this.projectPath });
      const { stdout: branch } = await execAsync('git branch --show-current', { cwd: this.projectPath });
      
      return {
        branch: branch.trim(),
        hasChanges: stdout.trim().length > 0,
        changes: stdout.trim().split('\n').filter(line => line.length > 0)
      };
    } catch (error) {
      throw new Error(`Failed to get git status: ${error.message}`);
    }
  }

  /**
   * コミット履歴取得
   */
  async getCommitHistory(limit = 20) {
    try {
      const { stdout } = await execAsync(
        `git log --oneline --max-count=${limit} --pretty=format:"%H|%an|%ae|%ad|%s" --date=iso`,
        { cwd: this.projectPath }
      );

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
