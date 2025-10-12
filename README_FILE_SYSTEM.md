# MindCode ファイル保存システム

## 概要
MindCodeのファイル保存システムは、Git（UI上では「トリップコード」）を基盤としたバージョン管理機能を持つ高機能なファイル管理システムです。ファイルのメタデータ管理、アクセスログ、完全なバージョン履歴を提供します。

## アーキテクチャ

### システム構成
```
ファイル保存システム
├── データベース層
│   ├── project_files (ファイルメタデータ)
│   ├── file_versions (バージョン履歴)
│   ├── file_access_logs (アクセスログ)
│   └── git_repositories (Git状態管理)
├── ファイルシステム層
│   └── user_projects/[user_id]/[project_id]/
└── バージョン管理層
    └── Git (.git ディレクトリ)
```

### データフロー
1. **ファイル作成/更新** → ファイルシステム書き込み → DB保存（コミットはトリップコード操作で実行）
2. **ファイル読み出し** → DB検索 → ファイルシステム読み込み → アクセスログ
3. **バージョン管理** → トリップコード（Git）操作 → DB状態更新

## APIエンドポイント

### ファイル管理 (`/api/filesystem`)

#### POST /:projectId/files
ファイルの作成または更新

**リクエスト:**
```json
{
  "fileName": "index.html",
  "filePath": "src", 
  "content": "<!DOCTYPE html>...",
  "permissions": "rw-r--r--"
}
```

**レスポンス:**
```json
{
  "id": 123,
  "filePath": "src/index.html",
  "fileName": "index.html",
  "fileSize": 1024,
  "checksum": "sha256hash...",
  "fileType": "html",
  "permissions": "rw-r--r--",
  "isBinary": false,
  "isUpdate": false
}
```

#### GET /:projectId/files/:fileId
ファイル内容とメタデータの取得

**クエリパラメータ:**
- `version`: 特定バージョンの取得 (オプション)

**レスポンス:**
```json
{
  "id": 123,
  "file_name": "index.html",
  "file_path": "src/index.html",
  "content": "<!DOCTYPE html>...",
  "file_size": 1024,
  "checksum": "sha256hash...",
  "versions": [
    {
      "version_number": 3,
      "git_commit_hash": "abc123...",
      "created_at": "2025-01-15T10:00:00Z",
      "author_name": "John Doe"
    }
  ],
  "currentVersion": 3
}
```

#### DELETE /:projectId/files/:fileId
ファイルの削除

**リクエストボディ:** なし

#### GET /:projectId/tree
プロジェクトのファイルツリー取得（メタデータ付き）

**レスポンス:**
```json
{
  "src": {
    "name": "src",
    "type": "folder",
    "children": {
      "index.html": {
        "name": "index.html",
        "type": "file",
        "id": 123,
        "fileSize": 1024,
        "fileType": "html",
        "versionCount": 3,
        "updatedAt": "2025-01-15T10:00:00Z"
      }
    }
  }
}
```

#### POST /:projectId/upload
複数ファイルのアップロード

**リクエスト:** `multipart/form-data`
- `files`: アップロードするファイル群
- `targetPath`: 対象ディレクトリ

### バージョン管理 (`/api/version-control`)

#### POST /:projectId/init
Gitリポジトリの初期化

**リクエスト:**
```json
{
  "userName": "John Doe",
  "userEmail": "john@example.com"
}
```

#### GET /:projectId/status
Git状態の取得

**レスポンス:**
```json
{
  "initialized": true,
  "branch": "main",
  "hasChanges": false,
  "changes": []
}
```

#### POST /:projectId/commit
変更をコミット

**リクエスト:**
```json
{
  "message": "Add new feature",
  "files": ["src/index.html", "src/style.css"]
}
```

#### GET /:projectId/history
コミット履歴の取得

**クエリパラメータ:**
- `limit`: 取得件数 (デフォルト: 20)

#### GET /:projectId/diff
ファイル差分の取得

**クエリパラメータ:**
- `filePath`: 対象ファイルパス (必須)
- `commitHash`: 比較対象のコミット (オプション)

#### GET /:projectId/file-at-commit
特定コミット時のファイル内容取得

**クエリパラメータ:**
- `filePath`: ファイルパス (必須)
- `commitHash`: コミットハッシュ (必須)

## データベーススキーマ

### project_files テーブル
```sql
CREATE TABLE project_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content LONGTEXT,
  file_type VARCHAR(50),
  file_size INT DEFAULT 0,
  permissions VARCHAR(10) DEFAULT 'rw-r--r--',
  checksum VARCHAR(64),
  is_binary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by INT,
  updated_by INT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

### file_versions テーブル
```sql
CREATE TABLE file_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_id INT NOT NULL,
  version_number INT NOT NULL,
  git_commit_hash VARCHAR(40),
  content_diff LONGTEXT,
  file_size INT DEFAULT 0,
  checksum VARCHAR(64),
  change_type ENUM('create', 'update', 'delete', 'rename') DEFAULT 'update',
  change_summary TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE
);
```

### file_access_logs テーブル
```sql
CREATE TABLE file_access_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_id INT NOT NULL,
  user_id INT NOT NULL,
  access_type ENUM('read', 'write', 'delete', 'rename') NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE
);
```

### git_repositories テーブル
```sql
CREATE TABLE git_repositories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  is_initialized BOOLEAN DEFAULT FALSE,
  current_branch VARCHAR(255) DEFAULT 'main',
  last_commit_hash VARCHAR(40),
  remote_url TEXT,
  git_user_name VARCHAR(255),
  git_user_email VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

## セットアップ手順

### 1. 環境準備
```bash
# GitManager.jsの依存関係確認
node --version  # v14 以上
git --version   # 2.0 以上

# 必要なパッケージのインストール
npm install multer crypto
```

### 2. データベーススキーマ適用
```bash
# MySQLにスキーマを適用
mysql -h localhost -u root -p webide < server/database/file_system_schema.sql
```

### 3. セットアップスクリプト実行
```bash
# 自動セットアップ
./setup_file_system.sh

# または手動セットアップ
mkdir -p user_projects
chmod 755 user_projects
```

### 4. システム再起動
```bash
# Dockerコンテナ再起動
docker compose down
docker compose up -d
```

## 使用例

### JavaScript (Node.js)
```javascript
const axios = require('axios');

// ファイル作成
const createFile = async (projectId, token) => {
  const response = await axios.post(`/api/filesystem/${projectId}/files`, {
    fileName: 'app.js',
    filePath: 'src',
    content: 'console.log("Hello, World!");'
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  return response.data;
};

// Git初期化
const initGit = async (projectId, token) => {
  await axios.post(`/api/version-control/${projectId}/init`, {
    userName: 'Developer',
    userEmail: 'dev@example.com'
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });
};
```

### cURL
```bash
# ファイル作成
curl -X POST http://localhost:3001/api/filesystem/PROJECT_ID/files \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "test.html",
    "content": "<h1>Hello</h1>"
  }'

# ファイル取得
curl -X GET http://localhost:3001/api/filesystem/PROJECT_ID/files/FILE_ID \
  -H "Authorization: Bearer YOUR_TOKEN"

# Git履歴取得
curl -X GET http://localhost:3001/api/version-control/PROJECT_ID/history \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 特徴

### 1. バージョン管理
- ファイル保存時にデータベース上のバージョン履歴を自動作成
- GitコミットはGitパネルやAPI経由で明示的に実行
- コミットハッシュとDBレコードの関連付けに対応

### 2. 完全なメタデータ管理
- ファイルサイズ、チェックサム、権限
- 作成・更新ユーザーの追跡
- バイナリファイルの判定

### 3. 包括的なアクセスログ
- 読み書き操作の完全なログ
- IPアドレス、ユーザーエージェントの記録
- アクセス時刻の精密な管理

### 4. 柔軟なファイル操作
- 単一ファイルと複数ファイルのアップロード
- ディレクトリ構造の自動作成
- ファイル権限の管理

## セキュリティ考慮事項

### ファイルアクセス制御
- プロジェクト所有者のみアクセス可能
- JWTトークンベースの認証
- ファイル操作の完全なログ記録

### データ整合性
- SHA256チェックサムによる整合性確認
- トランザクション処理によるデータ一貫性
- Git履歴との同期保証

## パフォーマンス最適化

### データベース最適化
- 適切なインデックス設計
- クエリの最適化
- CASCADE削除による整合性保証

### ファイルシステム最適化
- 階層ディレクトリ構造
- バイナリファイルの効率的処理
- 大容量ファイルの制限設定

## トラブルシューティング

### よくある問題

#### 1. Gitコミットが失敗する
```bash
# Git設定確認
git config --list

# ユーザー情報設定
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

#### 2. ファイル権限エラー
```bash
# ディレクトリ権限確認・修正
chmod -R 755 user_projects/
```

#### 3. データベース接続エラー
```bash
# MySQL接続確認
mysql -h localhost -u root -p -e "SHOW DATABASES;"
```

## 今後の拡張予定

### 1. リモートリポジトリ連携
- GitHub/GitLab統合
- プッシュ/プル機能
- ブランチ管理の強化

### 2. 差分ベースのストレージ
- 大容量ファイルの効率的保存
- 増分バックアップ
- 圧縮機能

### 3. コラボレーション機能
- リアルタイム編集
- コンフリクト解決
- マージリクエスト機能

---

このファイル保存システムにより、MindCodeは教育現場での本格的な開発体験を提供できます。
