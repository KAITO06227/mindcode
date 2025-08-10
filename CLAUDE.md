# MindCode - 教育用WebIDE - Claude Code Memory

## プロジェクト概要
**MindCode**は青山学院大学の学生・教職員向けに開発された教育用Web開発統合開発環境（IDE）です。

**重要事項：**
- **対象ユーザー**: 日本人学生・教職員（@gsuite.si.aoyama.ac.jpドメイン限定）
- **言語**: すべてのUI、エラーメッセージ、コミュニケーションは日本語
- **Claude Codeとの対話**: 日本語で行う
- フロントエンド: React
- バックエンド: Node.js + Express
- データベース: MySQL
- 認証: Google OAuth
- エディタ: Monaco Editor
- AI支援: Claude Code統合
- バージョン管理: Git統合

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
- スモールブラウザ機能（pikeplaceを参考）
- リアルタイムプレビュー

### Claude Code統合
- xterm.jsを使用したターミナル
- プロンプト送信前の自動Git コミット・プッシュ
- コード生成支援

### Git機能
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

### ファイル (/api/files)
- GET /tree/:projectId - ファイルツリー取得
- GET /:projectId/:fileId - ファイル内容取得
- POST /:projectId - ファイル/フォルダ作成
- PUT /:projectId/:fileId - ファイル更新
- DELETE /:projectId/:fileId - ファイル削除
- PATCH /:projectId/:fileId/rename - ファイルリネーム
- POST /:projectId/upload - ファイルアップロード

### Git (/api/git)
- POST /init/:projectId - Git初期化
- GET /status/:projectId - Git状況取得
- POST /add/:projectId - ファイル追加
- POST /commit/:projectId - コミット
- GET /log/:projectId - コミット履歴
- GET /branches/:projectId - ブランチ一覧
- POST /branch/:projectId - ブランチ作成
- POST /checkout/:projectId - ブランチ切り替え
- POST /remote/:projectId - リモート設定
- POST /push/:projectId - プッシュ
- POST /pull/:projectId - プル

### Claude Code (/api/claude)
- POST /execute/:projectId - Claude Codeコマンド実行
- POST /session/:projectId - インタラクティブセッション開始

### 管理 (/api/admin)
- GET /users - ユーザー一覧取得
- PATCH /users/:id/role - ユーザー役割更新
- GET /projects - 全プロジェクト取得
- GET /users/:userId/projects - 特定ユーザーのプロジェクト取得
- GET /projects/:projectId/preview - プロジェクトプレビュー
- GET /projects/:projectId/live - ライブプロジェクト表示
- GET /projects/:projectId/files - プロジェクトファイル取得
- DELETE /users/:id - ユーザー削除

## データベース設計

### users テーブル
- id (PK), google_id, email, name, role, avatar_url, created_at, updated_at

### projects テーブル
- id (PK), user_id (FK), name, description, git_url, created_at, updated_at

### project_files テーブル
- id (PK), project_id (FK), file_path, file_name, content, file_type, created_at, updated_at

### claude_sessions テーブル
- id (PK), user_id (FK), project_id (FK), session_data, created_at, updated_at

### git_commits テーブル
- id (PK), project_id (FK), commit_hash, commit_message, commit_author, commit_date, created_at

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

```bash
# 全体のセットアップ
npm run install:all

# 🚫 禁止: Claude Codeによるサーバー起動
# npm run dev
# docker compose up
# npm run server:dev
# npm run client:dev

# プロダクションビルド
npm run build

# ✅ Claude Codeが実行可能なコマンド
# - ファイルの読み書き
# - コードの分析・修正
# - データベーススキーマの確認
# - 設定ファイルの編集
```

## 特記事項

### pikeplace参考箇所
- Google OAuth実装: `pikeplace/auth/`
- スモールブラウザ機能: `pikeplace/static/kenya.html` の124行目周辺のiframe実装
- Monaco Editorの使用方法: `pikeplace/static/lib/monaco-editor/`

### Claude Code統合の仕様
- APIキーは先生側で管理、学生からは見えない
- プロンプト送信時に自動でgit add, commit, pushを実行
- 学生は任意のタイミングでもgit操作可能
- コミットメッセージは自動生成（プロンプト送信時）、手動入力（任意実行時）

### セキュリティ考慮事項
- 学生は自分のプロジェクトのみアクセス可能
- 先生は全学生のプロジェクトを閲覧・管理可能
- ファイルアップロードの制限なし（フォルダアップロードも対応）
- JWTトークンでの認証

## 進捗状況
✅ 完了済み：
- プロジェクト構造の設計とDocker環境構築
- Node.js Express サーバーセットアップ
- Google OAuth認証実装
- MySQL データベース設計と接続
- 全APIエンドポイントの実装（auth, projects, files, git, claude, admin）
- React基本構造とAuthContextの設定
- DashboardPageの実装（プロジェクト一覧、作成機能）
- IDEPageの基本レイアウト実装
- Monaco Editorの統合（シンタックスハイライト、テーマ設定）
- ファイルツリーコンポーネント（CRUD操作、アップロード機能）
- スモールブラウザコンポーネント（pikeplaceを参考にした実装）
- Claude Code統合（xterm.jsを使用したターミナル）
- GitPanelコンポーネント（Git操作GUI）
- AdminPageの実装（ユーザー・プロジェクト管理）

🔧 実装完了項目の詳細：

### フロントエンドコンポーネント
1. **LoginPage**: Google OAuth ログイン画面
2. **DashboardPage**: プロジェクト一覧、作成機能
3. **IDEPage**: メインのIDE画面レイアウト
4. **CodeEditor**: Monaco Editor統合
5. **FileTree**: ファイル・フォルダ管理（ツリー表示、CRUD操作）
6. **SmallBrowser**: プレビュー機能（HTML/CSS/JS統合表示）
7. **Terminal**: Claude Code統合ターミナル（xterm.js）
8. **GitPanel**: Git操作パネル
9. **AdminPage**: 先生用管理画面
10. **CreateProjectModal**: プロジェクト作成モーダル

⏳ 次のステップ：
- 開発環境でのテスト実行
- バグ修正と機能調整
- Docker環境での動作確認
- 本番環境デプロイ準備