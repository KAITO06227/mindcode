-- スナップショット機能専用データベーススキーマ
USE webide;

-- プロジェクトスナップショット管理テーブル
CREATE TABLE IF NOT EXISTS project_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  snapshot_timestamp BIGINT NOT NULL,
  description TEXT,
  snapshot_type ENUM('auto_ai', 'manual', 'restore_backup') DEFAULT 'manual',
  file_count INT DEFAULT 0,
  total_size BIGINT DEFAULT 0,
  storage_path VARCHAR(500), -- 物理保存パス
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_project_timestamp (project_id, snapshot_timestamp DESC),
  INDEX idx_snapshot_type (snapshot_type),
  INDEX idx_created_at (created_at DESC)
);

-- アクティブスナップショット状態管理
CREATE TABLE IF NOT EXISTS active_snapshots (
  project_id VARCHAR(36) PRIMARY KEY,
  current_snapshot_id INT,
  last_restored_from INT, -- 最後に復元したスナップショット
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (current_snapshot_id) REFERENCES project_snapshots(id) ON DELETE SET NULL,
  FOREIGN KEY (last_restored_from) REFERENCES project_snapshots(id) ON DELETE SET NULL
);

-- ユーザーごとのレイアウト保存テーブル
CREATE TABLE IF NOT EXISTS user_layouts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  layout JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_layouts_user_id (user_id)
);

-- テーブル作成完了メッセージ
SELECT 'スナップショット機能用テーブルの作成が完了しました' AS status;