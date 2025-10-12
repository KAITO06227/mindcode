const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

class SnapshotManager {
  constructor(projectId, projectPath, dbConnection) {
    this.projectId = projectId;
    this.projectPath = projectPath;
    this.db = dbConnection;
    this.snapshotDir = path.join(process.cwd(), 'snapshots', projectId);
  }

  /**
   * プロジェクトのスナップショットを作成
   */
  async createSnapshot(description = '', type = 'manual', userId = null) {
    try {
      // テーブル存在確認
      try {
        await this.db.execute('SELECT 1 FROM project_snapshots LIMIT 1');
      } catch (tableError) {
        if (tableError.code === 'ER_NO_SUCH_TABLE') {
          throw new Error('スナップショット機能を使用するには、データベーススキーマファイル (server/database/file_system_schema.sql) を適用してください。');
        }
        throw tableError;
      }

      console.log(`[SNAPSHOT] Creating snapshot for project ${this.projectId}`);

      // スナップショットディレクトリを作成
      await fs.mkdir(this.snapshotDir, { recursive: true });

      // タイムスタンプを生成
      const timestamp = Date.now();
      const snapshotPath = path.join(this.snapshotDir, `snapshot_${timestamp}`);

      // プロジェクトファイルを再帰的にコピー
      const { fileCount, totalSize } = await this.copyDirectory(this.projectPath, snapshotPath);

      // データベースにスナップショット情報を保存
      const [result] = await this.db.execute(`
        INSERT INTO project_snapshots
        (project_id, snapshot_timestamp, description, snapshot_type, file_count, total_size, storage_path, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [this.projectId, timestamp, description, type, fileCount, totalSize, snapshotPath, userId]);

      const snapshotId = result.insertId;

      // アクティブスナップショット状態を更新
      await this.db.execute(`
        INSERT INTO active_snapshots (project_id, current_snapshot_id, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE current_snapshot_id = ?, updated_at = CURRENT_TIMESTAMP
      `, [this.projectId, snapshotId, snapshotId]);

      console.log(`[SNAPSHOT] Created snapshot ${snapshotId} with ${fileCount} files (${totalSize} bytes)`);

      return {
        success: true,
        snapshotId,
        timestamp,
        fileCount,
        totalSize,
        path: snapshotPath
      };
    } catch (error) {
      console.error(`[SNAPSHOT] Failed to create snapshot:`, error);
      throw new Error(`スナップショット作成に失敗しました: ${error.message}`);
    }
  }

  /**
   * スナップショットからプロジェクトを復元
   */
  async restoreFromSnapshot(snapshotId) {
    try {
      console.log(`[SNAPSHOT] Restoring project ${this.projectId} from snapshot ${snapshotId}`);

      // スナップショット情報を取得
      const [snapshots] = await this.db.execute(`
        SELECT * FROM project_snapshots
        WHERE id = ? AND project_id = ?
      `, [snapshotId, this.projectId]);

      if (snapshots.length === 0) {
        throw new Error(`スナップショット ${snapshotId} が見つかりません`);
      }

      const snapshot = snapshots[0];
      const snapshotPath = snapshot.storage_path;

      // スナップショットディレクトリの存在確認
      try {
        await fs.access(snapshotPath);
      } catch (error) {
        throw new Error(`スナップショットファイルが見つかりません: ${snapshotPath}`);
      }

      // 現在のプロジェクトディレクトリをバックアップ（復元前スナップショット）
      const backupSnapshot = await this.createSnapshot('復元前自動バックアップ', 'restore_backup');

      // プロジェクトディレクトリを削除
      await this.removeDirectory(this.projectPath);

      // スナップショットからファイルを復元
      const { fileCount, totalSize } = await this.copyDirectory(snapshotPath, this.projectPath);

      // 最後の復元スナップショットを記録
      await this.db.execute(`
        UPDATE active_snapshots
        SET last_restored_from = ?, updated_at = CURRENT_TIMESTAMP
        WHERE project_id = ?
      `, [snapshotId, this.projectId]);

      console.log(`[SNAPSHOT] Restored ${fileCount} files (${totalSize} bytes) from snapshot ${snapshotId}`);

      return {
        success: true,
        snapshotId,
        fileCount,
        totalSize,
        backupSnapshotId: backupSnapshot.snapshotId
      };
    } catch (error) {
      console.error(`[SNAPSHOT] Failed to restore from snapshot:`, error);
      throw new Error(`スナップショット復元に失敗しました: ${error.message}`);
    }
  }

  /**
   * スナップショット一覧を取得
   */
  async getSnapshots(limit = 50) {
    try {
      // まずテーブルの存在確認
      try {
        await this.db.execute('SELECT 1 FROM project_snapshots LIMIT 1');
      } catch (tableError) {
        if (tableError.code === 'ER_NO_SUCH_TABLE') {
          console.warn('[SNAPSHOT] project_snapshots table does not exist. Please apply database schema.');
          return [];
        }
        throw tableError;
      }

      const [snapshots] = await this.db.execute(`
        SELECT
          ps.*,
          u.name as created_by_name,
          CASE WHEN as_current.current_snapshot_id = ps.id THEN 1 ELSE 0 END as is_current,
          CASE WHEN as_restored.last_restored_from = ps.id THEN 1 ELSE 0 END as is_last_restored
        FROM project_snapshots ps
        LEFT JOIN users u ON ps.created_by = u.id
        LEFT JOIN active_snapshots as_current ON as_current.project_id = ps.project_id
        LEFT JOIN active_snapshots as_restored ON as_restored.project_id = ps.project_id
        WHERE ps.project_id = ?
        ORDER BY ps.created_at DESC
        LIMIT ?
      `, [this.projectId, parseInt(limit)]);

      return snapshots.map(snapshot => ({
        id: snapshot.id,
        timestamp: snapshot.snapshot_timestamp,
        description: snapshot.description,
        type: snapshot.snapshot_type,
        fileCount: snapshot.file_count,
        totalSize: snapshot.total_size,
        createdAt: snapshot.created_at,
        createdBy: snapshot.created_by_name,
        isCurrent: !!snapshot.is_current,
        isLastRestored: !!snapshot.is_last_restored
      }));
    } catch (error) {
      console.error(`[SNAPSHOT] Failed to get snapshots:`, error);
      throw new Error(`スナップショット一覧取得に失敗しました: ${error.message}`);
    }
  }

  /**
   * スナップショットを削除
   */
  async deleteSnapshot(snapshotId) {
    try {
      console.log(`[SNAPSHOT] Deleting snapshot ${snapshotId}`);

      // スナップショット情報を取得
      const [snapshots] = await this.db.execute(`
        SELECT storage_path FROM project_snapshots
        WHERE id = ? AND project_id = ?
      `, [snapshotId, this.projectId]);

      if (snapshots.length === 0) {
        throw new Error(`スナップショット ${snapshotId} が見つかりません`);
      }

      const snapshotPath = snapshots[0].storage_path;

      // 物理ファイルを削除
      await this.removeDirectory(snapshotPath);

      // データベースから削除
      await this.db.execute(`
        DELETE FROM project_snapshots
        WHERE id = ? AND project_id = ?
      `, [snapshotId, this.projectId]);

      console.log(`[SNAPSHOT] Deleted snapshot ${snapshotId}`);

      return { success: true };
    } catch (error) {
      console.error(`[SNAPSHOT] Failed to delete snapshot:`, error);
      throw new Error(`スナップショット削除に失敗しました: ${error.message}`);
    }
  }

  /**
   * ディレクトリを再帰的にコピー
   */
  async copyDirectory(source, destination) {
    let fileCount = 0;
    let totalSize = 0;

    await fs.mkdir(destination, { recursive: true });

    const entries = await fs.readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const destPath = path.join(destination, entry.name);

      if (entry.isDirectory()) {
        // .gitディレクトリはスキップ
        if (entry.name === '.git') {
          continue;
        }
        const subResult = await this.copyDirectory(sourcePath, destPath);
        fileCount += subResult.fileCount;
        totalSize += subResult.totalSize;
      } else {
        await fs.copyFile(sourcePath, destPath);
        const stats = await fs.stat(sourcePath);
        fileCount++;
        totalSize += stats.size;
      }
    }

    return { fileCount, totalSize };
  }

  /**
   * ディレクトリを再帰的に削除
   */
  async removeDirectory(dirPath) {
    try {
      await fs.access(dirPath);
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * 自動スナップショット作成（AI処理完了時）
   */
  async createAutoSnapshot(aiProvider, prompt, userId = null) {
    const description = `AI処理完了 (${aiProvider}): ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`;
    return await this.createSnapshot(description, 'auto_ai', userId);
  }

  /**
   * プロジェクトの現在の状態とスナップショットを比較
   */
  async hasChangesFromSnapshot(snapshotId) {
    try {
      // スナップショット情報を取得
      const [snapshots] = await this.db.execute(`
        SELECT storage_path FROM project_snapshots
        WHERE id = ? AND project_id = ?
      `, [snapshotId, this.projectId]);

      if (snapshots.length === 0) {
        return true; // スナップショットが見つからない場合は変更ありと判定
      }

      const snapshotPath = snapshots[0].storage_path;

      // ファイル構造とハッシュを比較
      const currentHash = await this.calculateDirectoryHash(this.projectPath);
      const snapshotHash = await this.calculateDirectoryHash(snapshotPath);

      return currentHash !== snapshotHash;
    } catch (error) {
      console.error(`[SNAPSHOT] Failed to compare with snapshot:`, error);
      return true; // エラー時は安全側に倒して変更ありと判定
    }
  }

  /**
   * ディレクトリのハッシュを計算
   */
  async calculateDirectoryHash(dirPath) {
    const hash = crypto.createHash('sha256');
    const entries = await this.getDirectoryEntries(dirPath);

    // ファイルパスとコンテンツでソート
    entries.sort((a, b) => a.path.localeCompare(b.path));

    for (const entry of entries) {
      hash.update(entry.path);
      hash.update(entry.content);
    }

    return hash.digest('hex');
  }

  /**
   * ディレクトリの全エントリを取得
   */
  async getDirectoryEntries(dirPath, basePath = '') {
    const entries = [];

    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);
        const relativePath = path.join(basePath, item.name);

        if (item.isDirectory()) {
          // .gitディレクトリはスキップ
          if (item.name === '.git') {
            continue;
          }
          const subEntries = await this.getDirectoryEntries(itemPath, relativePath);
          entries.push(...subEntries);
        } else {
          const content = await fs.readFile(itemPath);
          entries.push({
            path: relativePath,
            content: content
          });
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    return entries;
  }
}

module.exports = SnapshotManager;