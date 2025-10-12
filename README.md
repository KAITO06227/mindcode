# MindCode - 教育用Web開発統合環境

<div align="center">
  <h3>青山学院大学学生・教職員向け Web開発IDE</h3>
  <p>AI支援（Claude / Codex / Gemini）機能付き</p>
</div>

---

## 📖 概要

**MindCode**は、青山学院大学の学生と教職員を対象とした教育用Web開発統合開発環境（IDE）です。ブラウザ上で直接コーディング、プレビュー、バージョン管理、AI支援を行うことができます。

### 🏛️ アーキテクチャの特徴
- **二重ファイルシステム構造**: 物理ファイルシステムとデータベースファイルシステムの統合管理
- **拡張トリップコード統合**: GitManagerクラスによるバージョン管理とメタデータ同期
- **Socket.IO ベースAI統合**: WebSocketでの Claude / Codex / Gemini 連携
- **ドメイン限定認証**: 青山学院大学専用のセキュアな環境

### 🎯 対象ユーザー
- **学生**: Web開発の学習とプロジェクト作成
- **教師**: 学生のプロジェクト管理と進捗確認
- **制限**: `@gsuite.si.aoyama.ac.jp` ドメインのみアクセス可能

## ✨ 主な機能

### 🔐 認証・セキュリティ
- **Google OAuth 2.0認証**: 大学アカウントでのシングルサインオン
- **ドメイン制限**: 青山学院大学のアカウントのみアクセス許可
- **役割ベース制御**: 学生・教師の権限管理

### 💻 開発環境
- **Monaco Editor**: Visual Studio Codeと同じエディタエンジン
- **シンタックスハイライト**: HTML、CSS、JavaScript対応
- **ライブプレビュー**: リアルタイムでWebページを確認
- **ファイル管理**: フォルダ構造でのプロジェクト管理

### 🤖 AI支援
- **マルチAI CLI対応**: Claude Code / OpenAI Codex / Google Gemini の各CLIを切り替えて利用可能
- **統一エージェントガイド**: `.mindcode/` 配下のガイドファイルと `AI.md` で複数エージェントに共通指示を適用
- **日本語完全対応**: すべてのUI・エラーメッセージ・AI対話を日本語で実行
- **自動トリップコード連携**: プロンプト送信後の自動コミット・履歴管理
- **Socket.IO アーキテクチャ**: WebSocketによるリアルタイムAI通信
- **セッション管理**: プロジェクト別AIプロセス管理

### 📁 プロジェクト管理
- **二重ファイルシステム**: 物理ファイルとデータベースの統合管理
- **拡張メタデータ**: ファイル権限・チェックサム・バージョン履歴
- **アクセスログ**: 詳細なファイル操作履歴
- **ファイルアップロード**: フォルダ構造を維持した一括アップロード
- **トリップコード統合**: Gitを基盤としたバージョン管理をUI上で「トリップコード」として提供

### 👨‍🏫 教師機能
- **学生管理**: 全学生アカウントの閲覧・管理
- **プロジェクト監視**: 学生プロジェクトの進捗確認
- **ライブプレビュー**: 学生の作成サイトをリアルタイム表示

## 🏗️ システム技術仕様

### フロントエンド
- **React**: Create React App (ポート3000)
- **Monaco Editor**: VS Code エンジンベースのコードエディタ
- **Socket.IO Client**: マルチAI統合のWebSocket通信
- **Styled Components**: CSS-in-JS スタイリング

### バックエンド  
- **Node.js + Express**: APIサーバー (ポート3001)
- **Socket.IO**: WebSocketベースのリアルタイム通信
- **Passport + Google OAuth 2.0**: 認証システム
- **JWT**: セキュアなセッション管理

### データベース
- **MySQL**: メインデータベース (ポート3306)
- **拡張ファイルシステムスキーマ**: メタデータ・バージョン管理対応

### 開発プロキシ
- クライアント → `http://localhost:3001` (自動プロキシ設定)

## 🚀 クイックスタート

### 必要環境
- Node.js 16+ 
- MySQL 8.0+
- Google Cloud Console アカウント
- Claude CLI / Codex CLI / Gemini CLI (オプション: それぞれのAI機能使用時)

### インストール

1. **リポジトリのクローン**
```bash
git clone [repository-url]
cd mindcode
```

2. **依存関係のインストール**
```bash
npm run install:all
```

3. **環境変数の設定**
`.env`ファイルを作成し、以下を設定：
```env
# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback

# JWT Secret
JWT_SECRET=your_jwt_secret_key

# Claude / Codex / Gemini API Keys（必要なもののみ）
CLAUDE_API_KEY=your_claude_api_key
CODEX_API_KEY=your_openai_api_key
GEMINI_API_KEY=your_google_api_key

# Database
DB_HOST=localhost
DB_PORT=3306
DB_NAME=mindcode
DB_USER=root
DB_PASSWORD=password

# Client URL
CLIENT_URL=http://localhost:3000
```

4. **データベースの設定**
```bash
mysql -u root -p
CREATE DATABASE mindcode;
USE mindcode;

# 基本スキーマ
SOURCE server/database/init.sql;

# 拡張ファイルシステムスキーマ（必須）
SOURCE server/database/file_system_schema.sql;
```

5. **開発サーバーの起動**
```bash
npm run dev
```

アプリケーションは `http://localhost:3000` で利用可能になります。

## 🛠️ Google OAuth設定

1. [Google Cloud Console](https://console.cloud.google.com/)でプロジェクトを作成
2. **APIs & Services** → **Credentials**へ移動
3. **OAuth 2.0 Client IDs**を作成
4. **承認済みリダイレクトURI**に追加：
   - `http://localhost:3001/api/auth/google/callback`
5. **OAuth同意画面**を「テスト中」に設定
6. **テストユーザー**に青山学院大学のメールアドレスを追加

## 📋 利用方法

### 学生の使い方

1. **ログイン**: 大学のGoogleアカウントでログイン
2. **プロジェクト作成**: 「新規プロジェクト」ボタンでプロジェクト開始
3. **コーディング**: Monaco Editorでコードを編集
4. **プレビュー**: 右側パネルでリアルタイム確認
5. **AI支援**: ターミナルでClaude Codeに日本語で質問
6. **保存**: 自動保存 & Git統合

### 教師の使い方

1. **管理画面**: 右上の「管理」ボタンでアクセス
2. **学生管理**: ユーザー一覧で学生の状況確認
3. **プロジェクト確認**: 学生のプロジェクト一覧を表示
4. **ライブプレビュー**: 学生のWebサイトを即座に表示

## 🏗️ プロジェクト構造

```
mindcode/
├── client/                 # React フロントエンド
│   ├── src/
│   │   ├── components/     # UIコンポーネント
│   │   │   ├── FileTree    # ファイル管理UI
│   │   │   ├── GitPanel    # Git統合UI
│   │   ├── pages/         # ページコンポーネント
│   │   │   ├── IDEPage     # メインIDE画面
│   │   │   ├── AdminPage   # 教師管理画面
│   │   │   └── DashboardPage # プロジェクト一覧
│   │   ├── contexts/      # React Context
│   │   ├── hooks/         # カスタムフック
│   │   └── utils/         # フロントエンドユーティリティ
│   └── public/
├── server/                 # Node.js バックエンド
│   ├── routes/            # API ルート
│   │   ├── auth.js        # Google OAuth認証
│   │   ├── files.js       # Legacy File API
│   │   ├── filesystem.js  # Enhanced File API
│   │   ├── version-control.js # Git統合API
│   │   ├── claude.js      # Claude Code API
│   │   └── admin.js       # 管理機能API
│   ├── middleware/        # 認証ミドルウェア
│   ├── database/          # DB接続・スキーマ
│   │   ├── init.sql       # 基本スキーマ
│   │   └── file_system_schema.sql # 拡張スキーマ
│   ├── utils/             # サーバーユーティリティ
│   │   ├── gitManager.js  # Git操作管理
│   │   └── claudeSocket.js # Claude統合Socket.IO
│   └── models/            # データベースモデル
├── user_projects/          # 物理ファイルシステム
│   └── [userId]/          # ユーザー別プロジェクト
│       └── [projectId]/   # プロジェクト別フォルダ
├── docker-compose.yml      # Docker設定
└── package.json           # プロジェクト設定
```

## 🔧 開発コマンド

**⚠️ 重要: Claude Code使用時の制限**
- **Claude Codeはサーバー起動コマンドを実行してはいけません**
- **npm run dev、docker compose upなど、サーバー起動コマンドは一切実行禁止**
- **ユーザーがサーバーを起動・管理します**

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

### 🚫 Claude Code実行禁止コマンド
```bash
# これらのコマンドは実行してはいけません
# npm run dev, docker compose up, npm run server:dev, npm run client:dev, npm start
```

## 🐳 Docker環境

```bash
# Docker環境起動
docker-compose up -d

# ログ確認
docker-compose logs -f

# 環境停止
docker-compose down
```

## 🔒 セキュリティ機能

- **ドメイン認証**: `@gsuite.si.aoyama.ac.jp`のみアクセス許可
- **JWTトークン**: セキュアなセッション管理
- **役割ベース認可**: 学生・教師権限の分離
- **入力検証**: XSS・SQLインジェクション対策
- **CORS設定**: 適切なオリジン制限

## 📊 データベース構造

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

### 二重ファイルシステム構造
このプロジェクトは独特の二重ファイルシステムを採用：

1. **物理ファイルシステム** (`user_projects/[userId]/[projectId]/`)
   - 実際のファイルが保存される場所
   - Git操作の対象
   - Monaco Editorが直接読み込む

2. **データベースファイルシステム** (拡張project_files テーブル)
   - ファイルメタデータ（権限、チェックサム、バージョン）
   - アクセスログとバージョン履歴
   - 検索とインデックス機能

## 🤝 トラブルシューティング

## 🔌 API エンドポイント

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

### ファイル操作
**Legacy API** (`/api/files`): 従来のシンプルなファイル操作
**Enhanced API** (`/api/filesystem`): メタデータ・バージョン管理対応

### Version Control (/api/version-control)
- POST /:projectId/init - Git初期化
- GET /:projectId/status - Git状況取得
- POST /:projectId/commit - コミット作成
- GET /:projectId/history - コミット履歴取得

### AI CLI (/api/claude)
- POST /execute/:projectId - CLIコマンド実行（provider指定でClaude/Codex/Geminiを選択）
- POST /session/:projectId - インタラクティブセッション開始（デフォルトはClaude Code）

### 管理 (/api/admin)
- GET /users - ユーザー一覧取得
- PATCH /users/:id/role - ユーザー役割更新
- GET /projects - 全プロジェクト取得

## 🤝 トラブルシューティング

### よくある問題

1. **ログインできない**
   - Google Cloud Consoleの設定を確認
   - 大学メールアドレス（@gsuite.si.aoyama.ac.jp）でアクセス
   - OAuth同意画面でテストユーザーに追加されているか確認

2. **データベース接続エラー**
   - MySQLサービスが起動しているか確認
   - 拡張ファイルシステムスキーマが適用されているか確認
   - Docker環境の場合、コンテナが正常に起動しているか確認

3. **AI CLI統合エラー**
   - それぞれのCLI（Claude / Codex / Gemini）がインストール済みか確認（`ENOENT` エラー）
   - 対象プロジェクトでCLIプロセスが起動・終了できるか確認
   - Socket.IO 接続が正常に確立されているか確認

4. **トリップコード操作エラー**
   - GitManager の厳格なエラー処理により操作が中止される
   - 物理ファイルとデータベースの同期状態を確認
   - トリップコード初期化が正常に完了しているか確認

## 🔄 アップデート履歴

### v1.0.0 (2024年)
- 初回リリース
- 二重ファイルシステム構造実装
- 拡張トリップコード統合（GitManager）
- Socket.IO ベースAI CLI統合
- Google OAuth認証（青山学院大学ドメイン限定）
- 日本語UI完全対応
- xterm.js ベースターミナル
- Monaco Editor統合
- 拡張ファイルシステムスキーマ

## 🛠️ 技術詳細

### pikeplace参考箇所
- **Google OAuth実装**: `pikeplace/auth/`
- **スモールブラウザ機能**: `pikeplace/static/kenya.html` の124行目周辺のiframe実装
- **Monaco Editorの使用方法**: `pikeplace/static/lib/monaco-editor/`

### AI CLI統合の仕様
- APIキーは先生側で管理し、利用者からは見えない設計
- プロンプト完了時に自動で `git add` / `commit` を実行しトリップコード履歴を更新
- 学生は任意のタイミングでもトリップコード操作（コミットなど）が可能
- コミットメッセージはプロンプト内容から自動生成（必要に応じて手動追記も可能）

### エラー処理の方針
- **厳格に失敗させる方針**（グレースフル・デグラデーション禁止）
- データベーススキーマ未適用時は詳細エラーを返す
- Git操作失敗時は具体的なstdout/stderrを含む

## 📞 サポート

### 技術サポート
- **CLAUDE.md**: 詳細な技術仕様とアーキテクチャ
- **GitHub Issues**: バグ報告・機能要望
- **Socket.IO デバッグ**: AI CLI統合の通信問題

### 教育サポート
- **教師向け**: 管理機能・学生プロジェクト監視
- **学生向け**: プロジェクト作成・AI支援活用ガイド

---

<div align="center">
  <p><strong>MindCode</strong> - 青山学院大学</p>
  <p>Powered by AI CLI Integrations</p>
</div>
