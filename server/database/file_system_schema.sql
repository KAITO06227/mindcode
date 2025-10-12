-- ファイル保存システム用拡張DBスキーマ
USE webide;

-- 拡張されたproject_filesテーブル（メタデータとバージョン管理対応）
DROP TABLE IF EXISTS project_files;
CREATE TABLE project_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content LONGTEXT,
  file_type VARCHAR(50),
  file_size INT DEFAULT 0,
  permissions VARCHAR(10) DEFAULT 'rw-r--r--', -- Unix形式の権限
  checksum VARCHAR(64), -- SHA256ハッシュ
  is_binary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by INT,
  updated_by INT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY unique_project_file (project_id, file_path),
  INDEX idx_file_path (file_path),
  INDEX idx_file_type (file_type),
  INDEX idx_checksum (checksum)
);

-- ファイルバージョン履歴テーブル
CREATE TABLE IF NOT EXISTS file_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_id INT NOT NULL,
  version_number INT NOT NULL,
  git_commit_hash VARCHAR(40), -- Gitコミットハッシュ
  content_diff LONGTEXT, -- 差分データ（必要に応じて）
  file_size INT DEFAULT 0,
  checksum VARCHAR(64),
  change_type ENUM('create', 'update', 'delete', 'rename') DEFAULT 'update',
  change_summary TEXT, -- 変更の要約
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY unique_file_version (file_id, version_number),
  INDEX idx_git_commit (git_commit_hash),
  INDEX idx_version_date (created_at)
);

-- ファイルアクセスログテーブル
CREATE TABLE IF NOT EXISTS file_access_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_id INT NOT NULL,
  user_id INT NOT NULL,
  access_type ENUM('read', 'write', 'delete', 'rename') NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_access_time (accessed_at),
  INDEX idx_access_user (user_id),
  INDEX idx_access_file (file_id)
);

-- Git リポジトリ情報テーブル（プロジェクトのGit状態管理）
CREATE TABLE IF NOT EXISTS git_repositories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  is_initialized BOOLEAN DEFAULT FALSE,
  current_branch VARCHAR(255) DEFAULT 'main',
  last_commit_hash VARCHAR(40),
  last_restored_commit_hash VARCHAR(40), -- 最後に復元したコミットのハッシュ
  remote_url TEXT,
  git_user_name VARCHAR(255),
  git_user_email VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY unique_project_git (project_id)
);

-- Git コミット履歴テーブル
CREATE TABLE IF NOT EXISTS git_commits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  commit_hash VARCHAR(40) NOT NULL,
  commit_message TEXT,
  commit_author VARCHAR(255),
  commit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY unique_project_commit (project_id, commit_hash),
  INDEX idx_commit_date (commit_date),
  INDEX idx_project_date (project_id, commit_date DESC)
);

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

-- インデックス作成
CREATE INDEX idx_project_files_project_updated ON project_files(project_id, updated_at);
CREATE INDEX idx_file_versions_file_version ON file_versions(file_id, version_number DESC);
CREATE INDEX idx_git_repositories_project ON git_repositories(project_id);
