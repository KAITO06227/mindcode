const db = require('../database/connection');

// ロール階層: owner > member (editor/viewer は同等)
// viewer と editor を同等に扱い、実質的に owner/member の2段階制御
const ROLE_HIERARCHY = {
  owner: 3,
  editor: 2,
  viewer: 2  // editor と同じ権限レベル
};

/**
 * プロジェクトへのアクセス権限をチェックする
 * @param {number} projectId - プロジェクトID
 * @param {number} userId - ユーザーID
 * @param {string} requiredRole - 必要な最低ロール（'viewer'/'editor' は同等、'owner' のみ特別）
 * @returns {Promise<{hasAccess: boolean, userRole: string|null}>}
 */
async function checkProjectAccess(projectId, userId, requiredRole = 'viewer') {
  try {
    // プロジェクトメンバーシップを確認
    const [members] = await db.execute(
      `SELECT pm.role, pm.user_id, p.user_id as project_owner_id
       FROM project_members pm
       JOIN projects p ON pm.project_id = p.id
       WHERE pm.project_id = ? AND pm.user_id = ?`,
      [projectId, userId]
    );

    if (members.length === 0) {
      // メンバーでない場合、プロジェクト所有者かどうか確認（後方互換性）
      const [projects] = await db.execute(
        'SELECT user_id FROM projects WHERE id = ?',
        [projectId]
      );

      if (projects.length > 0 && projects[0].user_id === userId) {
        return { hasAccess: true, userRole: 'owner' };
      }

      return { hasAccess: false, userRole: null };
    }

    const userRole = members[0].role;
    const hasAccess = ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];

    return { hasAccess, userRole };
  } catch (error) {
    console.error('Access check error:', error);
    throw error;
  }
}

/**
 * プロジェクトアクセス権限チェックミドルウェア
 * @param {string} requiredRole - 必要な最低ロール
 */
function requireProjectAccess(requiredRole = 'viewer') {
  return async (req, res, next) => {
    try {
      const projectId = req.params.projectId || req.params.id;
      const userId = req.user.id;

      if (!projectId) {
        return res.status(400).json({ error: 'プロジェクトIDが指定されていません' });
      }

      const { hasAccess, userRole } = await checkProjectAccess(projectId, userId, requiredRole);

      if (!hasAccess) {
        return res.status(403).json({
          error: 'このプロジェクトへのアクセス権限がありません',
          required: requiredRole,
          current: userRole
        });
      }

      // リクエストにユーザーのロール情報を追加
      req.projectRole = userRole;
      next();
    } catch (error) {
      console.error('Project access middleware error:', error);
      res.status(500).json({ error: 'アクセス権限の確認中にエラーが発生しました' });
    }
  };
}

/**
 * プロジェクトメンバー一覧を取得
 * @param {number} projectId - プロジェクトID
 * @returns {Promise<Array>}
 */
async function getProjectMembers(projectId) {
  try {
    const [members] = await db.execute(
      `SELECT
        pm.id,
        pm.user_id,
        pm.role,
        pm.joined_at,
        u.name,
        u.email,
        u.avatar_url
       FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = ?
       ORDER BY
         FIELD(pm.role, 'owner', 'editor', 'viewer'),
         pm.joined_at ASC`,
      [projectId]
    );

    return members;
  } catch (error) {
    console.error('Get project members error:', error);
    throw error;
  }
}

/**
 * プロジェクトにメンバーを追加
 * @param {number} projectId - プロジェクトID
 * @param {number} userId - ユーザーID
 * @param {string} role - ロール（'editor' or 'viewer'）
 * @returns {Promise<Object>}
 */
async function addProjectMember(projectId, userId, role = 'viewer') {
  try {
    // メンバーが既に存在するか確認
    const [existing] = await db.execute(
      'SELECT id, role FROM project_members WHERE project_id = ? AND user_id = ?',
      [projectId, userId]
    );

    if (existing.length > 0) {
      // 既存メンバーのロールを更新
      await db.execute(
        'UPDATE project_members SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ? AND user_id = ?',
        [role, projectId, userId]
      );
      return { id: existing[0].id, updated: true };
    }

    // 新規メンバーを追加
    const [result] = await db.execute(
      'INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)',
      [projectId, userId, role]
    );

    return { id: result.insertId, updated: false };
  } catch (error) {
    console.error('Add project member error:', error);
    throw error;
  }
}

/**
 * プロジェクトからメンバーを削除
 * @param {number} projectId - プロジェクトID
 * @param {number} userId - ユーザーID
 * @returns {Promise<boolean>}
 */
async function removeProjectMember(projectId, userId) {
  try {
    // オーナーは削除できない
    const [member] = await db.execute(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?',
      [projectId, userId]
    );

    if (member.length === 0) {
      return false;
    }

    if (member[0].role === 'owner') {
      throw new Error('プロジェクトオーナーは削除できません');
    }

    const [result] = await db.execute(
      'DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
      [projectId, userId]
    );

    return result.affectedRows > 0;
  } catch (error) {
    console.error('Remove project member error:', error);
    throw error;
  }
}

/**
 * メンバーのロールを更新
 * @param {number} projectId - プロジェクトID
 * @param {number} userId - ユーザーID
 * @param {string} newRole - 新しいロール
 * @returns {Promise<boolean>}
 */
async function updateMemberRole(projectId, userId, newRole) {
  try {
    // オーナーのロールは変更できない
    const [member] = await db.execute(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?',
      [projectId, userId]
    );

    if (member.length === 0) {
      throw new Error('メンバーが見つかりません');
    }

    if (member[0].role === 'owner') {
      throw new Error('プロジェクトオーナーのロールは変更できません');
    }

    const [result] = await db.execute(
      'UPDATE project_members SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ? AND user_id = ?',
      [newRole, projectId, userId]
    );

    return result.affectedRows > 0;
  } catch (error) {
    console.error('Update member role error:', error);
    throw error;
  }
}

module.exports = {
  checkProjectAccess,
  requireProjectAccess,
  getProjectMembers,
  addProjectMember,
  removeProjectMember,
  updateMemberRole,
  ROLE_HIERARCHY
};
