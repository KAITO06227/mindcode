const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const SnapshotManager = require('../utils/snapshotManager');
const { verifyToken } = require('../middleware/auth');
const path = require('path');

// データベース接続設定
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'webide',
  charset: 'utf8mb4'
};

/**
 * プロジェクトのスナップショット一覧を取得
 */
router.get('/:projectId', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const userId = req.user.id;

    // プロジェクトの所有者確認
    const connection = await mysql.createConnection(dbConfig);

    try {
      const [projects] = await connection.execute(
        'SELECT user_id FROM projects WHERE id = ?',
        [projectId]
      );

      if (projects.length === 0) {
        return res.status(404).json({ error: 'プロジェクトが見つかりません' });
      }

      // 先生は全てのプロジェクトにアクセス可能、学生は自分のプロジェクトのみ
      if (req.user.role !== 'teacher' && projects[0].user_id !== userId) {
        return res.status(403).json({ error: 'このプロジェクトにアクセスする権限がありません' });
      }

      // プロジェクトパスを構築
      const projectPath = path.join(process.cwd(), 'user_projects', projects[0].user_id.toString(), projectId);

      // スナップショットマネージャーを初期化
      const snapshotManager = new SnapshotManager(projectId, projectPath, connection);

      // スナップショット一覧を取得
      const snapshots = await snapshotManager.getSnapshots(limit);

      res.json({
        success: true,
        snapshots,
        projectId
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error('スナップショット一覧取得エラー:', error);
    res.status(500).json({
      error: 'スナップショット一覧の取得に失敗しました',
      message: error.message
    });
  }
});

/**
 * スナップショットを作成
 */
router.post('/:projectId', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { description = '', type = 'manual' } = req.body;
    const userId = req.user.id;

    // プロジェクトの所有者確認
    const connection = await mysql.createConnection(dbConfig);

    try {
      const [projects] = await connection.execute(
        'SELECT user_id FROM projects WHERE id = ?',
        [projectId]
      );

      if (projects.length === 0) {
        return res.status(404).json({ error: 'プロジェクトが見つかりません' });
      }

      // 先生は全てのプロジェクトにアクセス可能、学生は自分のプロジェクトのみ
      if (req.user.role !== 'teacher' && projects[0].user_id !== userId) {
        return res.status(403).json({ error: 'このプロジェクトにアクセスする権限がありません' });
      }

      // プロジェクトパスを構築
      const projectPath = path.join(process.cwd(), 'user_projects', projects[0].user_id.toString(), projectId);

      // スナップショットマネージャーを初期化
      const snapshotManager = new SnapshotManager(projectId, projectPath, connection);

      // スナップショットを作成
      const result = await snapshotManager.createSnapshot(description, type, userId);

      res.json({
        success: true,
        snapshot: result,
        message: 'スナップショットが作成されました'
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error('スナップショット作成エラー:', error);
    res.status(500).json({
      error: 'スナップショットの作成に失敗しました',
      message: error.message
    });
  }
});

/**
 * スナップショットから復元
 */
router.post('/:projectId/restore/:snapshotId', verifyToken, async (req, res) => {
  try {
    const { projectId, snapshotId } = req.params;
    const userId = req.user.id;

    // プロジェクトの所有者確認
    const connection = await mysql.createConnection(dbConfig);

    try {
      const [projects] = await connection.execute(
        'SELECT user_id FROM projects WHERE id = ?',
        [projectId]
      );

      if (projects.length === 0) {
        return res.status(404).json({ error: 'プロジェクトが見つかりません' });
      }

      // 先生は全てのプロジェクトにアクセス可能、学生は自分のプロジェクトのみ
      if (req.user.role !== 'teacher' && projects[0].user_id !== userId) {
        return res.status(403).json({ error: 'このプロジェクトにアクセスする権限がありません' });
      }

      // プロジェクトパスを構築
      const projectPath = path.join(process.cwd(), 'user_projects', projects[0].user_id.toString(), projectId);

      // スナップショットマネージャーを初期化
      const snapshotManager = new SnapshotManager(projectId, projectPath, connection);

      // スナップショットから復元
      const result = await snapshotManager.restoreFromSnapshot(parseInt(snapshotId));

      res.json({
        success: true,
        restore: result,
        message: 'スナップショットから復元しました'
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error('スナップショット復元エラー:', error);
    res.status(500).json({
      error: 'スナップショットからの復元に失敗しました',
      message: error.message
    });
  }
});

/**
 * スナップショットを削除
 */
router.delete('/:projectId/:snapshotId', verifyToken, async (req, res) => {
  try {
    const { projectId, snapshotId } = req.params;
    const userId = req.user.id;

    // プロジェクトの所有者確認
    const connection = await mysql.createConnection(dbConfig);

    try {
      const [projects] = await connection.execute(
        'SELECT user_id FROM projects WHERE id = ?',
        [projectId]
      );

      if (projects.length === 0) {
        return res.status(404).json({ error: 'プロジェクトが見つかりません' });
      }

      // 先生は全てのプロジェクトにアクセス可能、学生は自分のプロジェクトのみ
      if (req.user.role !== 'teacher' && projects[0].user_id !== userId) {
        return res.status(403).json({ error: 'このプロジェクトにアクセスする権限がありません' });
      }

      // プロジェクトパスを構築
      const projectPath = path.join(process.cwd(), 'user_projects', projects[0].user_id.toString(), projectId);

      // スナップショットマネージャーを初期化
      const snapshotManager = new SnapshotManager(projectId, projectPath, connection);

      // スナップショットを削除
      const result = await snapshotManager.deleteSnapshot(parseInt(snapshotId));

      res.json({
        success: true,
        message: 'スナップショットが削除されました'
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error('スナップショット削除エラー:', error);
    res.status(500).json({
      error: 'スナップショットの削除に失敗しました',
      message: error.message
    });
  }
});

/**
 * 現在の状態とスナップショットを比較
 */
router.get('/:projectId/compare/:snapshotId', verifyToken, async (req, res) => {
  try {
    const { projectId, snapshotId } = req.params;
    const userId = req.user.id;

    // プロジェクトの所有者確認
    const connection = await mysql.createConnection(dbConfig);

    try {
      const [projects] = await connection.execute(
        'SELECT user_id FROM projects WHERE id = ?',
        [projectId]
      );

      if (projects.length === 0) {
        return res.status(404).json({ error: 'プロジェクトが見つかりません' });
      }

      // 先生は全てのプロジェクトにアクセス可能、学生は自分のプロジェクトのみ
      if (req.user.role !== 'teacher' && projects[0].user_id !== userId) {
        return res.status(403).json({ error: 'このプロジェクトにアクセスする権限がありません' });
      }

      // プロジェクトパスを構築
      const projectPath = path.join(process.cwd(), 'user_projects', projects[0].user_id.toString(), projectId);

      // スナップショットマネージャーを初期化
      const snapshotManager = new SnapshotManager(projectId, projectPath, connection);

      // 変更を確認
      const hasChanges = await snapshotManager.hasChangesFromSnapshot(parseInt(snapshotId));

      res.json({
        success: true,
        hasChanges,
        snapshotId: parseInt(snapshotId)
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error('スナップショット比較エラー:', error);
    res.status(500).json({
      error: 'スナップショットとの比較に失敗しました',
      message: error.message
    });
  }
});

/**
 * AI処理完了時の自動スナップショット作成
 */
router.post('/:projectId/auto-ai', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { aiProvider, prompt } = req.body;
    const userId = req.user.id;

    if (!aiProvider || !prompt) {
      return res.status(400).json({
        error: 'aiProviderとpromptは必須です'
      });
    }

    // プロジェクトの所有者確認
    const connection = await mysql.createConnection(dbConfig);

    try {
      const [projects] = await connection.execute(
        'SELECT user_id FROM projects WHERE id = ?',
        [projectId]
      );

      if (projects.length === 0) {
        return res.status(404).json({ error: 'プロジェクトが見つかりません' });
      }

      // 先生は全てのプロジェクトにアクセス可能、学生は自分のプロジェクトのみ
      if (req.user.role !== 'teacher' && projects[0].user_id !== userId) {
        return res.status(403).json({ error: 'このプロジェクトにアクセスする権限がありません' });
      }

      // プロジェクトパスを構築
      const projectPath = path.join(process.cwd(), 'user_projects', projects[0].user_id.toString(), projectId);

      // スナップショットマネージャーを初期化
      const snapshotManager = new SnapshotManager(projectId, projectPath, connection);

      // AI自動スナップショットを作成
      const result = await snapshotManager.createAutoSnapshot(aiProvider, prompt, userId);

      res.json({
        success: true,
        snapshot: result,
        message: 'AI処理完了スナップショットが作成されました'
      });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error('AI自動スナップショット作成エラー:', error);
    res.status(500).json({
      error: 'AI自動スナップショットの作成に失敗しました',
      message: error.message
    });
  }
});

module.exports = router;