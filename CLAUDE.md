# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. Other AI agents (Codex / Gemini) also reference the shared instructions in `AI.md` and `.mindcode/`.

## プロジェクト概要
**MindCode**は青山学院大学の学生・教職員向けに開発された教育用Web開発統合開発環境（IDE）です。

**重要事項：**
- **対象ユーザー**: 日本人学生・教職員（@gsuite.si.aoyama.ac.jpドメイン限定）
- **言語**: すべてのUI、エラーメッセージ、コミュニケーションは日本語
- **Claude / Codex / Gemini との対話**: すべて日本語で行う
- フロントエンド: React (Create React App, ポート3000)
- バックエンド: Node.js + Express (ポート3001) 
- データベース: MySQL (ポート3306)
- 認証: Google OAuth
- エディタ: Monaco Editor
- AI支援: マルチAI CLI統合 (Claude / Codex / Gemini)
- バージョン管理: トリップコード（Git基盤）統合
- 開発プロキシ: クライアント → `http://localhost:3001`

## プロジェクト構造
```
mindcode/
├── server/
│   ├── routes/          # API ルート
│   ├── models/          # データベースモデル
│   ├── middleware/      # 認証等のミドルウェア
│   ├── database/        # DB接続と初期化
│   └── utils/           # ユーティリティ
├── client/
│   ├── src/
│   │   ├── components/  # Reactコンポーネント
│   │   ├── pages/       # ページコンポーネント
│   │   ├── contexts/    # Reactコンテキスト
│   │   ├── hooks/       # カスタムフック
│   │   └── utils/       # フロントエンドユーティリティ
│   └── public/
├── user_projects/       # ユーザープロジェクトのファイル保存
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 主要機能

### 認証システム
- Google OAuth 2.0を使用
- 学生/先生の役割管理
- JWT トークンベースの認証

### プロジェクト管理
- プロジェクトの作成、削除、更新
- ファイル/フォルダの管理（CRUD操作）
- ツリー形式でのファイル表示

### エディタ機能
- Monaco Editor統合
- シンタックスハイライト
- HTML/CSS/JavaScript対応

### ライブプレビュー
- IDEから別タブで開くライブプレビューボタンを提供
- `/api/projects/:id/live` エンドポイント経由で最新状態を表示

### AI CLI統合（Claude / Codex / Gemini）
- xterm.jsを使用した共通ターミナル
- `AI.md` と `.mindcode/` のガイドファイルを読み込み、複数エージェントで共有
- プロンプト終了時にトリップコードへ自動コミット
- コード生成・分析支援

### トリップコード（Git）機能
- リポジトリの初期化
- コミット、プッシュ、プル
- ブランチ管理
- GitHub連携

### 管理機能（先生用）
- 学生アカウント管理
- 学生プロジェクトの閲覧
- 学生のWebサイト表示機能

### ファイル操作
- ファイル/フォルダのアップロード
- 作成、削除、リネーム
- 階層構造の管理

## API エンドポイント

### 認証 (/api/auth)
- GET /google - Google OAuth開始
- GET /google/callback - OAuth コールバック
- GET /me - 現在のユーザー情報取得
- POST /logout - ログアウト

### プロジェクト (/api/projects)
- GET / - プロジェクト一覧取得
- POST / - プロジェクト作成
- GET /:id - プロジェクト詳細取得
- PUT /:id - プロジェクト更新
- DELETE /:id - プロジェクト削除

### File System (/api/filesystem)
- POST /:projectId/files - ファイル作成・更新
- GET /:projectId/files/:fileId - ファイル内容・メタデータ取得
- DELETE /:projectId/files/:fileId - ファイル削除
- GET /:projectId/tree - プロジェクトファイルツリー取得
- POST /:projectId/upload - 複数ファイル/フォルダアップロード
- PATCH /:projectId/files/:fileId/rename - ファイルリネーム
- POST /:projectId/move - ファイル/フォルダ移動
- POST /:projectId/sync - 物理ファイルとDBの同期

### Version Control (/api/version-control)
- POST /:projectId/init - トリップコード初期化
- GET /:projectId/status - トリップコード状況取得
- POST /:projectId/commit - コミット作成
- GET /:projectId/history - コミット履歴取得
- GET /:projectId/branches - ブランチ一覧取得
- POST /:projectId/branch - ブランチ作成
- POST /:projectId/checkout - ブランチ切り替え
- GET /:projectId/diff - ファイル差分取得
- GET /:projectId/file-at-commit - 特定コミットのファイル取得

### AI CLI (/api/claude)
- POST /execute/:projectId - CLIコマンド実行（provider指定でClaude/Codex/Geminiを選択）
- POST /session/:projectId - インタラクティブセッション開始（デフォルトはClaude Code）

### 管理 (/api/admin)
- GET /users - ユーザー一覧取得
- PATCH /users/:id/role - ユーザー役割更新
- GET /projects - 全プロジェクト取得
- GET /users/:userId/projects - 特定ユーザーのプロジェクト取得
- GET /projects/:projectId/preview - プロジェクトプレビュー
- GET /projects/:projectId/live - ライブプロジェクト表示
- GET /projects/:projectId/files - プロジェクトファイル取得
- DELETE /users/:id - ユーザー削除

## アーキテクチャ

### 二重ファイルシステム構造
このプロジェクトは独特の二重ファイルシステムを採用：

1. **物理ファイルシステム** (`user_projects/[userId]/[projectId]/`)
   - 実際のファイルが保存される場所
   - トリップコード（Git）操作の対象
   - Monaco Editorが直接読み込む

2. **データベースファイルシステム** (拡張project_files テーブル)
   - ファイルメタデータ（権限、チェックサム、バージョン）
   - アクセスログとバージョン履歴
   - 検索とインデックス機能

### トリップコード統合戦略
- `GitManager`クラス（`server/utils/gitManager.js`）が物理ファイルの Git 操作を担当
- データベース内の`file_versions`テーブルがコミットハッシュと連携
- エラー処理は厳格モード：失敗時は操作を中止（グレースフル・デグラデーション無し）

### API設計パターン
- **File System API** (`/api/filesystem`): メタデータ・バージョン管理対応のファイル操作
- **Version Control API** (`/api/version-control`): Git専用操作
- **AI CLI API** (`/api/claude`): マルチAIターミナル統合

## データベース設計

### 拡張ファイルシステムスキーマ（必須）
```sql
-- 拡張project_filesテーブル（メタデータ・バージョン管理）
project_files: id, project_id, file_path, file_name, content, file_type, 
               file_size, permissions, checksum, is_binary, created_by, updated_by

-- ファイルバージョン履歴
file_versions: id, file_id, version_number, git_commit_hash, content_diff,
               file_size, checksum, change_type, change_summary, created_by

-- ファイルアクセスログ
file_access_logs: id, file_id, user_id, access_type, ip_address, user_agent

-- Git リポジトリ情報
git_repositories: id, project_id, is_initialized, current_branch, last_commit_hash,
                  remote_url, git_user_name, git_user_email
```

### コアテーブル
```sql
users: id, google_id, email, name, role, avatar_url
projects: id, user_id, name, description, git_url  
claude_sessions: id, user_id, project_id, session_data
```

## 環境変数
```
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
JWT_SECRET=your_jwt_secret_key
CLAUDE_API_KEY=your_claude_api_key
DB_HOST=db
DB_PORT=3306
DB_NAME=webide
DB_USER=root
DB_PASSWORD=password
```

## 開発コマンド

**⚠️ 重要: サーバー起動について**
- **Claude Codeはサーバーを起動してはいけません**
- **npm run dev、docker compose upなど、サーバー起動コマンドは一切実行禁止**
- **ユーザーがサーバーを起動・管理します**
- Claude Codeの役割はコードの編集・修正・分析のみです

**⚠️ 重要: エラー処理の方針**
- **エラー発生時は厳格に失敗させる（グレースフル・デグラデーション禁止）**
- **「エラーでも動く」修正は行わず、根本原因の修正に専念**
- **データベーススキーマ未適用時は詳細エラーを返す**

### 利用可能なコマンド

```bash
# 依存関係のインストール
npm run install:all          # ルートとclientの両方のnode_modules

# ビルド関連
npm run build                # クライアントのプロダクションビルド

# テスト (クライアントのみ)
cd client && npm test        # Jest テストの実行

# データベーススキーマ適用
mysql -u root -p webide < server/database/init.sql
mysql -u root -p webide < server/database/file_system_schema.sql

# Docker環境でのデータベース初期化
docker-compose exec db mysql -u root -ppassword webide < /docker-entrypoint-initdb.d/init.sql

# ユーティリティスクリプト
./apply_db_schema.sh         # データベーススキーマ適用スクリプト
./setup_file_system.sh       # ファイルシステム設定スクリプト
./reset-environment.sh       # 環境リセットスクリプト
```

**🚫 Claude Code実行禁止コマンド**
```bash
# これらのコマンドは実行してはいけません
# npm run dev, docker compose up, npm run server:dev, npm run client:dev, npm start
```

## 特記事項

### pikeplace参考箇所
- Google OAuth実装: `pikeplace/auth/`
- Monaco Editorの使用方法: `pikeplace/static/lib/monaco-editor/`

### Claude Code統合の仕様
- APIキーは先生側で管理、学生からは見えない
- プロンプト送信時に自動でgit add, commit, pushを実行
- 学生は任意のタイミングでもgit操作可能
- コミットメッセージは自動生成（プロンプト送信時）、手動入力（任意実行時）

### Socket.IO アーキテクチャ
Claude Code統合はWebSocketベースの`claudeSocket.js`で実装：

- **セッション管理**: `activeSessions` Mapがプロジェクト別Claude プロセスを管理
- **プロセス起動**: `claude` コマンドを各プロジェクトディレクトリで子プロセスとして実行
- **通信フロー**: 
  1. クライアント → `claude_input` イベント → Claude プロセス stdin
  2. Claude プロセス stdout/stderr → `claude_output` イベント → クライアント
- **エラーハンドリング**: ENOENT エラーで Claude CLI 未インストールを検出

### セキュリティ考慮事項
- 学生は自分のプロジェクトのみアクセス可能
- 先生は全学生のプロジェクトを閲覧・管理可能
- ファイルアップロードの制限なし（フォルダアップロードも対応）
- JWTトークンでの認証

## 重要な実装詳細

### ファイル操作の流れ
1. **プロジェクト作成時**: 物理ディレクトリ作成 → 初期ファイル生成 → データベース記録
2. **ファイル編集時**: 物理ファイル更新 → データベース更新 → バージョン記録 → Git コミット（オプション）
3. **Git操作時**: GitManager経由で物理ファイル操作 → データベース同期

### 認証・認可パターン
- `verifyToken` ミドルウェアで JWT 検証
- プロジェクト所有者チェックを各APIで実行
- Google OAuth制限: `@gsuite.si.aoyama.ac.jp` ドメインのみ

### エラー処理の実装
- データベーススキーマエラー時は詳細メッセージ付きで500エラー
- Git初期化失敗時は具体的なstdout/stderrを含む  
- ファイルシステム操作失敗時は物理的原因を報告

### フロントエンド統合ポイント
- `GitPanel` コンポーネントが Version Control API を呼び出し
- `FileTree` コンポーネントが File System API を呼び出し（ファイル/フォルダアップロード、ドラッグ&ドロップ移動対応）
- `UploadModal` コンポーネントでファイル/フォルダ選択とプログレスバー表示
- Monaco Editor は物理ファイルパスから直接読み込み

### データベース移行が必要な機能
拡張ファイルシステムスキーマ（`server/database/file_system_schema.sql`）を適用する必要があります：
- Git統合機能
- ファイルバージョン管理  
- アクセスログ機能
- メタデータ追跡

### コンポーネント構造
**主要React コンポーネント**:
- `LoginPage`: Google OAuth認証
- `DashboardPage`: プロジェクト一覧・作成
- `IDEPage`: メインIDE画面（プレビューボタンを含む）
- `FileTree`: ファイル管理（CRUD、アップロード対応）
- `GitPanel`: バージョン管理GUI  
- `ClaudeCodeTerminal`: xterm.jsベースのClaude統合ターミナル
- `AdminPage`: 教師用管理機能

### フロントエンド主要ライブラリ
- **`@monaco-editor/react`**: コードエディタ（VS Code エンジン）
- **`@xterm/xterm`**: ターミナルUI (`@xterm/addon-fit`, `@xterm/addon-web-links`)
- **`socket.io-client`**: Claude Code統合のWebSocket通信
- **`react-router-dom`**: SPA ルーティング
- **`styled-components`**: CSS-in-JS スタイリング
- **`react-icons`**: アイコンコンポーネント

### バックエンド主要ライブラリ
- **`mysql2`**: MySQL データベース接続
- **`passport` + `passport-google-oauth20`**: Google OAuth 認証
- **`express-session` + `jsonwebtoken`**: セッション・JWT 管理
- **`socket.io`**: Claude Code統合のWebSocket サーバー
- **`multer`**: ファイルアップロード処理
- **`node-pty`**: ターミナルエミュレーション（プロセス制御）
- **`uuid`**: 一意ID生成（プロジェクト・ファイル識別）
