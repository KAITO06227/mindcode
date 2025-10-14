const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  requireProjectAccess,
  getProjectMembers,
  addProjectMember,
  removeProjectMember,
  updateMemberRole
} = require('../middleware/projectAccess');

/**
 * GET /api/projects/:projectId/members
 * プロジェクトメンバー一覧を取得
 */
router.get('/:projectId/members', verifyToken, requireProjectAccess('viewer'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const members = await getProjectMembers(projectId);

    res.json({
      success: true,
      members,
      currentUserRole: req.projectRole
    });
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({
      error: 'メンバー一覧の取得に失敗しました',
      details: error.message
    });
  }
});

/**
 * POST /api/projects/:projectId/members
 * プロジェクトにメンバーを追加
 * 必要なロール: owner または editor（viewer も同等の権限）
 */
router.post('/:projectId/members', verifyToken, requireProjectAccess('editor'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { userId, role } = req.body;

    // バリデーション
    if (!userId) {
      return res.status(400).json({ error: 'ユーザーIDが必要です' });
    }

    if (role && !['editor', 'viewer'].includes(role)) {
      return res.status(400).json({ error: '無効なロールです（editor または viewer のみ指定可能）' });
    }

    // viewer と editor は同等の権限を持つため、制限なし

    const result = await addProjectMember(projectId, userId, role || 'viewer');

    res.json({
      success: true,
      message: result.updated ? 'メンバーのロールを更新しました' : 'メンバーを追加しました',
      memberId: result.id,
      updated: result.updated
    });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(500).json({
      error: 'メンバーの追加に失敗しました',
      details: error.message
    });
  }
});

/**
 * PATCH /api/projects/:projectId/members/:userId
 * メンバーのロールを更新
 * 必要なロール: owner
 */
router.patch('/:projectId/members/:userId', verifyToken, requireProjectAccess('owner'), async (req, res) => {
  try {
    const { projectId, userId } = req.params;
    const { role } = req.body;

    // バリデーション
    if (!role || !['editor', 'viewer'].includes(role)) {
      return res.status(400).json({ error: '有効なロールを指定してください（editor または viewer）' });
    }

    const updated = await updateMemberRole(projectId, parseInt(userId), role);

    if (!updated) {
      return res.status(404).json({ error: 'メンバーが見つかりません' });
    }

    res.json({
      success: true,
      message: 'メンバーのロールを更新しました'
    });
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({
      error: 'ロールの更新に失敗しました',
      details: error.message
    });
  }
});

/**
 * DELETE /api/projects/:projectId/members/:userId
 * プロジェクトからメンバーを削除
 * 必要なロール: owner（または本人が退出する場合）
 */
router.delete('/:projectId/members/:userId', verifyToken, requireProjectAccess('viewer'), async (req, res) => {
  try {
    const { projectId, userId } = req.params;
    const targetUserId = parseInt(userId);
    const currentUserId = req.user.id;

    // 自分自身を削除する場合は viewer 権限で OK
    // 他人を削除する場合は owner 権限が必要
    if (targetUserId !== currentUserId && req.projectRole !== 'owner') {
      return res.status(403).json({
        error: '他のメンバーを削除するにはオーナー権限が必要です'
      });
    }

    const removed = await removeProjectMember(projectId, targetUserId);

    if (!removed) {
      return res.status(404).json({ error: 'メンバーが見つかりません' });
    }

    res.json({
      success: true,
      message: targetUserId === currentUserId ? 'プロジェクトから退出しました' : 'メンバーを削除しました'
    });
  } catch (error) {
    console.error('Remove member error:', error);

    if (error.message === 'プロジェクトオーナーは削除できません') {
      return res.status(400).json({
        error: error.message,
        hint: 'プロジェクトを削除するか、他のメンバーにオーナー権限を譲渡してください'
      });
    }

    res.status(500).json({
      error: 'メンバーの削除に失敗しました',
      details: error.message
    });
  }
});

module.exports = router;
