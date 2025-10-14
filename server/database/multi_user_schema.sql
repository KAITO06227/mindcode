-- Multi-user collaboration feature schema
-- Run this after init.sql and file_system_schema.sql

-- プロジェクトメンバーテーブル
CREATE TABLE IF NOT EXISTS project_members (
  id INT PRIMARY KEY AUTO_INCREMENT,
  project_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  user_id INT NOT NULL,
  role ENUM('owner', 'editor', 'viewer') NOT NULL DEFAULT 'viewer',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_project_user (project_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- project_membersのインデックス
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);

-- プロジェクト招待テーブル
CREATE TABLE IF NOT EXISTS project_invitations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  project_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  invited_email VARCHAR(255) NOT NULL,
  invited_by INT NOT NULL,
  role ENUM('editor', 'viewer') NOT NULL DEFAULT 'viewer',
  token VARCHAR(255) UNIQUE NOT NULL,
  status ENUM('pending', 'accepted', 'rejected', 'expired') DEFAULT 'pending',
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMP NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- project_invitationsのインデックス
CREATE INDEX IF NOT EXISTS idx_project_invitations_project_id ON project_invitations(project_id);
CREATE INDEX IF NOT EXISTS idx_project_invitations_token ON project_invitations(token);
CREATE INDEX IF NOT EXISTS idx_project_invitations_invited_email ON project_invitations(invited_email);
CREATE INDEX IF NOT EXISTS idx_project_invitations_status ON project_invitations(status);

-- 既存プロジェクトの所有者をproject_membersに移行
INSERT IGNORE INTO project_members (project_id, user_id, role)
SELECT id, user_id, 'owner'
FROM projects
WHERE NOT EXISTS (
  SELECT 1 FROM project_members
  WHERE project_members.project_id = projects.id
  AND project_members.user_id = projects.user_id
);
