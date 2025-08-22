# MindCode セットアップガイド (UUID対応版)

## 🔄 環境リセット完了

既存の環境とデータを完全にクリアし、UUID対応の新しい環境を構築しました。

## 📋 次に必要な手順

### 1. 環境変数の設定

`.env`ファイルを作成し、以下の設定を行ってください：

```bash
cp .env.example .env
```

`.env`ファイルを編集して以下の値を設定：

```env
# Google OAuth (Google Cloud Consoleで取得)
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback

# JWT Secret (安全なランダム文字列)
JWT_SECRET=your_jwt_secret_key_here

# Claude API Key (Anthropicで取得)
CLAUDE_API_KEY=your_claude_api_key_here

# Database (変更不要)
DB_HOST=localhost
DB_PORT=3306
DB_NAME=mindcode
DB_USER=root
DB_PASSWORD=password

# Client URL (変更不要)
CLIENT_URL=http://localhost:3000
```

### 2. Google OAuth設定の確認

Google Cloud Consoleで以下を確認：
- **承認済みのリダイレクトURI**: `http://localhost:3001/api/auth/google/callback`
- **承認済みのJavaScript発行元**: `http://localhost:3000`

### 3. 環境の起動

```bash
docker compose up -d
```

### 4. アクセス確認

- **フロントエンド**: http://localhost:3000
- **バックエンドAPI**: http://localhost:3001
- **MySQL**: localhost:3306

## 🆕 UUID対応の変更点

### プロジェクトID
- **以前**: 整数（1, 2, 3...）
- **現在**: UUID（例: `550e8400-e29b-41d4-a716-446655440000`）

### データベース構造
- すべてのテーブルでUUID外部キーを使用
- インデックスを追加してパフォーマンス向上

### 新機能
- ✅ プロジェクト削除機能
- ✅ 特定バージョンへの復元機能
- ✅ 強化されたGit管理
- ✅ 管理者によるプロジェクト削除

## 🔧 トラブルシューティング

### Google認証が失敗する場合

1. `.env`ファイルの設定確認
2. Google Cloud Consoleの設定確認
3. Docker環境の再起動：
   ```bash
   docker compose down
   docker compose up -d
   ```

### データベース接続エラーの場合

```bash
# データベースコンテナのログ確認
docker logs webide-mysql

# 環境を完全リセット
./reset-environment.sh
```

## 📝 注意事項

- 既存のプロジェクトとユーザーデータは全て削除されました
- 新しくプロジェクトを作成する際はUUIDが自動生成されます
- Git履歴も削除されたため、新規にバージョン管理を開始してください

## 🚀 開発環境の確認

環境が正常に動作していることを確認：

1. Google認証でログイン
2. 新しいプロジェクトを作成
3. ファイルの編集とプレビュー
4. Git機能（初期化、コミット、復元）
5. プロジェクト削除機能