#!/bin/bash

echo "🔧 Docker環境でのデータベーススキーマ適用"

# Dockerコンテナが起動しているか確認
if ! docker ps | grep -q "webide-mysql"; then
    echo "❌ MySQLコンテナが起動していません"
    echo "   以下のコマンドで起動してください: docker compose up -d"
    exit 1
fi

echo "📊 MySQLコンテナにスキーマを適用中..."

# Dockerコンテナ内でMySQLコマンドを実行
docker exec -i webide-mysql mysql -u root -ppassword webide < server/database/file_system_schema.sql

if [ $? -eq 0 ]; then
    echo "✅ データベーススキーマ適用完了"
else
    echo "❌ スキーマ適用エラー"
    echo ""
    echo "🔧 手動で適用する場合："
    echo "1. docker exec -it webide-mysql mysql -u root -ppassword"
    echo "2. USE webide;"
    echo "3. スキーマファイルの内容をコピー&ペーストして実行"
fi