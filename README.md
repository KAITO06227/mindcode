# MindCode - 教育用Web開発統合環境

<div align="center">
  <h3>青山学院大学学生・教職員向け Web開発IDE</h3>
  <p>Claude Code AI支援機能付き</p>
</div>

---

## 📖 概要

**MindCode**は、青山学院大学の学生と教職員を対象とした教育用Web開発統合開発環境（IDE）です。ブラウザ上で直接コーディング、プレビュー、バージョン管理、AI支援を行うことができます。

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
- **Claude Code統合**: AI助手によるコード生成・デバッグ支援
- **日本語対応**: すべての対話を日本語で実行
- **自動Git連携**: AI相談前に自動でコード保存

### 📁 プロジェクト管理
- **複数プロジェクト対応**: 個人プロジェクトの作成・管理
- **ファイルアップロード**: 既存ファイルの一括アップロード
- **Git統合**: バージョン管理とGitHub連携

### 👨‍🏫 教師機能
- **学生管理**: 全学生アカウントの閲覧・管理
- **プロジェクト監視**: 学生プロジェクトの進捗確認
- **ライブプレビュー**: 学生の作成サイトをリアルタイム表示

## 🚀 クイックスタート

### 必要環境
- Node.js 16+ 
- MySQL 8.0+
- Google Cloud Console アカウント

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

# Claude API Key
CLAUDE_API_KEY=your_claude_api_key

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
SOURCE server/database/init.sql;
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
│   │   ├── pages/         # ページコンポーネント
│   │   ├── contexts/      # React Context
│   │   └── utils/         # ユーティリティ
│   └── public/
├── server/                 # Node.js バックエンド
│   ├── routes/            # API ルート
│   ├── middleware/        # 認証ミドルウェア
│   ├── database/          # DB接続・スキーマ
│   └── utils/             # サーバーユーティリティ
├── user_projects/          # ユーザープロジェクト保存
├── docker-compose.yml      # Docker設定
└── package.json           # プロジェクト設定
```

## 🔧 開発コマンド

```bash
# 開発サーバー起動（フロント+バック同時）
npm run dev

# サーバーのみ起動
npm run server:dev

# クライアントのみ起動  
npm run client:dev

# プロダクションビルド
npm run build

# プロダクション起動
npm start

# 全依存関係インストール
npm run install:all
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

### 主要テーブル

- **users**: ユーザー情報（Google OAuth）
- **projects**: プロジェクトメタデータ
- **project_files**: ファイル内容と構造
- **claude_sessions**: AI対話履歴
- **git_commits**: バージョン管理履歴

## 🤝 トラブルシューティング

### よくある問題

1. **ログインできない**
   - Google Cloud Consoleの設定を確認
   - 大学メールアドレスでアクセスしているか確認
   - テストユーザーに追加されているか確認

2. **データベース接続エラー**
   - MySQLサービスが起動しているか確認
   - `.env`の設定が正しいか確認
   - データベースとテーブルが作成されているか確認

3. **ポート競合エラー**
   - 3000番・3001番ポートが使用中でないか確認
   - 他のアプリケーションを停止

## 🔄 アップデート履歴

### v1.0.0 (2024年)
- 初回リリース
- 基本IDE機能実装
- Claude Code統合
- Google OAuth認証
- 日本語UI完全対応

## 📞 サポート

### 技術サポート
- **CLAUDE.md**: 技術詳細ドキュメント参照
- **GitHub Issues**: バグ報告・機能要望

### 教育サポート
- **教師向け**: 管理機能の使い方
- **学生向け**: プロジェクト作成ガイド

---

<div align="center">
  <p><strong>MindCode</strong> - 青山学院大学</p>
  <p>Powered by Claude Code AI</p>
</div>