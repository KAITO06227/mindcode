#!/bin/bash

echo "🔄 MindCode環境を完全リセット中..."

# Docker環境を停止・削除
echo "📦 Dockerコンテナとボリュームを削除中..."
docker compose down -v
docker system prune -f

# データベースボリュームを強制削除
echo "🗄️ データベースボリュームを削除中..."
docker volume rm mindcode_mysql_data 2>/dev/null || true

# ユーザープロジェクトディレクトリを削除
echo "📁 ユーザープロジェクトディレクトリを削除中..."
rm -rf user_projects

# node_modulesを削除して依存関係を再インストール
echo "📦 依存関係を再インストール中..."
rm -rf node_modules
rm -rf client/node_modules
npm install

# クライアント側の依存関係も再インストール
cd client
npm install
cd ..

echo "✅ 環境リセット完了！"
echo ""
echo "次の手順で環境を起動してください："
echo "1. docker compose up -d"
echo "2. ブラウザで http://localhost:3000 にアクセス"
echo "3. Google認証でログイン"
echo ""
echo "⚠️  注意: 既存のプロジェクトとデータは全て削除されました。"