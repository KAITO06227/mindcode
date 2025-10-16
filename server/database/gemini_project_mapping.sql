-- Gemini project to hash folder mapping
-- This table maps project IDs to their corresponding Gemini hash folders
-- ensuring consistent log file reading across sessions

USE webide;

CREATE TABLE IF NOT EXISTS gemini_project_folders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL UNIQUE,
  hash_folder VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_gemini_project_folders_project_id ON gemini_project_folders(project_id);
CREATE INDEX idx_gemini_project_folders_hash_folder ON gemini_project_folders(hash_folder);
