const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/connection');
const { verifyToken } = require('../middleware/auth');
const { requireProjectAccess, addProjectMember } = require('../middleware/projectAccess');

/**
 * ランダムな招待トークンを生成
 */
function generateInvitationToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * GET /api/projects/:projectId/invitations
 * プロジェクトの招待一覧を取得
 * 必要なロール: editor 以上
 */
router.get('/:projectId/invitations', verifyToken, requireProjectAccess('editor'), async (req, res) => {
  try {
    const { projectId } = req.params;

    const [invitations] = await db.execute(
      `SELECT
        pi.id,
        pi.invited_email,
        pi.role,
        pi.status,
        pi.token,
        pi.expires_at,
        pi.created_at,
        pi.accepted_at,
        u.name as invited_by_name,
        u.email as invited_by_email
       FROM project_invitations pi
       JOIN users u ON pi.invited_by = u.id
       WHERE pi.project_id = ?
       ORDER BY pi.created_at DESC`,
      [projectId]
    );

    res.json({
      success: true,
      invitations
    });
  } catch (error) {
    console.error('Get invitations error:', error);
    res.status(500).json({
      error: '招待一覧の取得に失敗しました',
      details: error.message
    });
  }
});

/**
 * POST /api/projects/:projectId/invitations
 * プロジェクトへの招待を作成
 * 必要なロール: editor 以上（viewer と editor は同等の権限）
 */
router.post('/:projectId/invitations', verifyToken, requireProjectAccess('editor'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { email, role } = req.body;
    const invitedBy = req.user.id;

    // バリデーション
    if (!email) {
      return res.status(400).json({ error: 'メールアドレスが必要です' });
    }

    if (role && !['editor', 'viewer'].includes(role)) {
      return res.status(400).json({ error: '無効なロールです（editor または viewer のみ指定可能）' });
    }

    // viewer と editor は同等の権限を持つため、誰でも招待可能

    // 招待するメールアドレスのユーザーが存在するか確認
    const [users] = await db.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: '指定されたメールアドレスのユーザーが見つかりません' });
    }

    const targetUserId = users[0].id;

    // 既にメンバーでないか確認
    const [existingMembers] = await db.execute(
      'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
      [projectId, targetUserId]
    );

    if (existingMembers.length > 0) {
      return res.status(400).json({ error: 'このユーザーは既にプロジェクトメンバーです' });
    }

    // 既存の保留中の招待を確認
    const [existingInvitations] = await db.execute(
      `SELECT id, token FROM project_invitations
       WHERE project_id = ? AND invited_email = ? AND status = 'pending' AND expires_at > NOW()`,
      [projectId, email]
    );

    if (existingInvitations.length > 0) {
      // 既存の招待がある場合はそれを返す
      return res.json({
        success: true,
        message: '既存の招待が存在します',
        invitationId: existingInvitations[0].id,
        token: existingInvitations[0].token,
        existing: true
      });
    }

    // 新しい招待を作成
    const token = generateInvitationToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7日後

    const [result] = await db.execute(
      `INSERT INTO project_invitations (project_id, invited_email, invited_by, role, token, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, email, invitedBy, role || 'viewer', token, expiresAt]
    );

    res.json({
      success: true,
      message: '招待を作成しました',
      invitationId: result.insertId,
      token,
      expiresAt,
      existing: false
    });
  } catch (error) {
    console.error('Create invitation error:', error);
    res.status(500).json({
      error: '招待の作成に失敗しました',
      details: error.message
    });
  }
});

/**
 * GET /api/invitations/my
 * 自分宛ての招待一覧を取得
 */
router.get('/invitations/my', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;

    const [invitations] = await db.execute(
      `SELECT
        pi.id,
        pi.project_id,
        pi.invited_email,
        pi.role,
        pi.status,
        pi.token,
        pi.expires_at,
        pi.created_at,
        p.name as project_name,
        p.description as project_description,
        u.name as invited_by_name,
        u.email as invited_by_email
       FROM project_invitations pi
       JOIN projects p ON pi.project_id = p.id
       JOIN users u ON pi.invited_by = u.id
       WHERE pi.invited_email = ? AND pi.status = 'pending' AND pi.expires_at > NOW()
       ORDER BY pi.created_at DESC`,
      [userEmail]
    );

    res.json({
      success: true,
      invitations
    });
  } catch (error) {
    console.error('Get my invitations error:', error);
    res.status(500).json({
      error: '招待一覧の取得に失敗しました',
      details: error.message
    });
  }
});

/**
 * GET /api/invitations/:token
 * トークンから招待情報を取得（認証不要）
 */
router.get('/invitations/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const [invitations] = await db.execute(
      `SELECT
        pi.id,
        pi.project_id,
        pi.invited_email,
        pi.role,
        pi.status,
        pi.expires_at,
        p.name as project_name,
        p.description as project_description,
        u.name as invited_by_name
       FROM project_invitations pi
       JOIN projects p ON pi.project_id = p.id
       JOIN users u ON pi.invited_by = u.id
       WHERE pi.token = ?`,
      [token]
    );

    if (invitations.length === 0) {
      return res.status(404).json({ error: '招待が見つかりません' });
    }

    const invitation = invitations[0];

    // ステータスチェック
    if (invitation.status !== 'pending') {
      return res.status(400).json({
        error: '招待は既に処理されています',
        status: invitation.status
      });
    }

    // 有効期限チェック
    if (new Date(invitation.expires_at) < new Date()) {
      await db.execute(
        "UPDATE project_invitations SET status = 'expired' WHERE id = ?",
        [invitation.id]
      );
      return res.status(400).json({ error: '招待の有効期限が切れています' });
    }

    res.json({
      success: true,
      invitation: {
        id: invitation.id,
        projectId: invitation.project_id,
        projectName: invitation.project_name,
        projectDescription: invitation.project_description,
        invitedEmail: invitation.invited_email,
        role: invitation.role,
        invitedByName: invitation.invited_by_name,
        expiresAt: invitation.expires_at
      }
    });
  } catch (error) {
    console.error('Get invitation error:', error);
    res.status(500).json({
      error: '招待情報の取得に失敗しました',
      details: error.message
    });
  }
});

/**
 * POST /api/invitations/:token/accept
 * 招待を承認
 */
router.post('/invitations/:token/accept', verifyToken, async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;
    const userEmail = req.user.email;

    // 招待情報を取得
    const [invitations] = await db.execute(
      `SELECT id, project_id, invited_email, role, status, expires_at
       FROM project_invitations
       WHERE token = ?`,
      [token]
    );

    if (invitations.length === 0) {
      return res.status(404).json({ error: '招待が見つかりません' });
    }

    const invitation = invitations[0];

    // ステータスチェック
    if (invitation.status !== 'pending') {
      return res.status(400).json({
        error: '招待は既に処理されています',
        status: invitation.status
      });
    }

    // 有効期限チェック
    if (new Date(invitation.expires_at) < new Date()) {
      await db.execute(
        "UPDATE project_invitations SET status = 'expired' WHERE id = ?",
        [invitation.id]
      );
      return res.status(400).json({ error: '招待の有効期限が切れています' });
    }

    // メールアドレスの一致チェック
    if (invitation.invited_email !== userEmail) {
      return res.status(403).json({
        error: '招待されたメールアドレスと一致しません',
        invitedEmail: invitation.invited_email,
        yourEmail: userEmail
      });
    }

    // トランザクション開始
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // メンバーに追加
      await addProjectMember(invitation.project_id, userId, invitation.role);

      // 招待ステータスを更新
      await connection.execute(
        "UPDATE project_invitations SET status = 'accepted', accepted_at = NOW() WHERE id = ?",
        [invitation.id]
      );

      await connection.commit();

      res.json({
        success: true,
        message: 'プロジェクトに参加しました',
        projectId: invitation.project_id,
        role: invitation.role
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({
      error: '招待の承認に失敗しました',
      details: error.message
    });
  }
});

/**
 * POST /api/invitations/:invitationId/accept-by-id
 * 招待IDで招待を承認
 */
router.post('/invitations/:invitationId/accept-by-id', verifyToken, async (req, res) => {
  try {
    const { invitationId } = req.params;
    const userId = req.user.id;
    const userEmail = req.user.email;

    // 招待情報を取得
    const [invitations] = await db.execute(
      `SELECT id, project_id, invited_email, role, status, expires_at
       FROM project_invitations
       WHERE id = ?`,
      [invitationId]
    );

    if (invitations.length === 0) {
      return res.status(404).json({ error: '招待が見つかりません' });
    }

    const invitation = invitations[0];

    // ステータスチェック
    if (invitation.status !== 'pending') {
      return res.status(400).json({
        error: '招待は既に処理されています',
        status: invitation.status
      });
    }

    // 有効期限チェック
    if (new Date(invitation.expires_at) < new Date()) {
      await db.execute(
        "UPDATE project_invitations SET status = 'expired' WHERE id = ?",
        [invitation.id]
      );
      return res.status(400).json({ error: '招待の有効期限が切れています' });
    }

    // メールアドレスの一致チェック
    if (invitation.invited_email !== userEmail) {
      return res.status(403).json({
        error: '招待されたメールアドレスと一致しません',
        invitedEmail: invitation.invited_email,
        yourEmail: userEmail
      });
    }

    // トランザクション開始
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // メンバーに追加
      await addProjectMember(invitation.project_id, userId, invitation.role);

      // 招待ステータスを更新
      await connection.execute(
        "UPDATE project_invitations SET status = 'accepted', accepted_at = NOW() WHERE id = ?",
        [invitation.id]
      );

      await connection.commit();

      res.json({
        success: true,
        message: 'プロジェクトに参加しました',
        projectId: invitation.project_id,
        role: invitation.role
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Accept invitation by ID error:', error);
    res.status(500).json({
      error: '招待の承認に失敗しました',
      details: error.message
    });
  }
});

/**
 * POST /api/invitations/:invitationId/reject-by-id
 * 招待IDで招待を拒否
 */
router.post('/invitations/:invitationId/reject-by-id', verifyToken, async (req, res) => {
  try {
    const { invitationId } = req.params;
    const userEmail = req.user.email;

    // 招待情報を取得
    const [invitations] = await db.execute(
      `SELECT id, invited_email, status FROM project_invitations WHERE id = ?`,
      [invitationId]
    );

    if (invitations.length === 0) {
      return res.status(404).json({ error: '招待が見つかりません' });
    }

    const invitation = invitations[0];

    // メールアドレスの一致チェック
    if (invitation.invited_email !== userEmail) {
      return res.status(403).json({ error: '招待されたメールアドレスと一致しません' });
    }

    // ステータスチェック
    if (invitation.status !== 'pending') {
      return res.status(400).json({
        error: '招待は既に処理されています',
        status: invitation.status
      });
    }

    // 招待を拒否
    await db.execute(
      "UPDATE project_invitations SET status = 'rejected' WHERE id = ?",
      [invitation.id]
    );

    res.json({
      success: true,
      message: '招待を拒否しました'
    });
  } catch (error) {
    console.error('Reject invitation by ID error:', error);
    res.status(500).json({
      error: '招待の拒否に失敗しました',
      details: error.message
    });
  }
});

/**
 * POST /api/invitations/:token/reject
 * 招待を拒否
 */
router.post('/invitations/:token/reject', verifyToken, async (req, res) => {
  try {
    const { token } = req.params;
    const userEmail = req.user.email;

    // 招待情報を取得
    const [invitations] = await db.execute(
      `SELECT id, invited_email, status FROM project_invitations WHERE token = ?`,
      [token]
    );

    if (invitations.length === 0) {
      return res.status(404).json({ error: '招待が見つかりません' });
    }

    const invitation = invitations[0];

    // メールアドレスの一致チェック
    if (invitation.invited_email !== userEmail) {
      return res.status(403).json({ error: '招待されたメールアドレスと一致しません' });
    }

    // ステータスチェック
    if (invitation.status !== 'pending') {
      return res.status(400).json({
        error: '招待は既に処理されています',
        status: invitation.status
      });
    }

    // 招待を拒否
    await db.execute(
      "UPDATE project_invitations SET status = 'rejected' WHERE id = ?",
      [invitation.id]
    );

    res.json({
      success: true,
      message: '招待を拒否しました'
    });
  } catch (error) {
    console.error('Reject invitation error:', error);
    res.status(500).json({
      error: '招待の拒否に失敗しました',
      details: error.message
    });
  }
});

/**
 * DELETE /api/projects/:projectId/invitations/:invitationId
 * 招待を削除（キャンセル）
 * 必要なロール: editor 以上
 */
router.delete('/:projectId/invitations/:invitationId', verifyToken, requireProjectAccess('editor'), async (req, res) => {
  try {
    const { projectId, invitationId } = req.params;

    const [result] = await db.execute(
      'DELETE FROM project_invitations WHERE id = ? AND project_id = ?',
      [invitationId, projectId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '招待が見つかりません' });
    }

    res.json({
      success: true,
      message: '招待を削除しました'
    });
  } catch (error) {
    console.error('Delete invitation error:', error);
    res.status(500).json({
      error: '招待の削除に失敗しました',
      details: error.message
    });
  }
});

module.exports = router;
