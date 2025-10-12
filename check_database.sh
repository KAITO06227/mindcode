#!/bin/bash

# データベース状態診断スクリプト

echo "=== MindCode データベース状態診断 ==="
echo ""

echo "🔍 Docker Compose ファイルの確認..."
if [ -f "docker-compose.yml" ]; then
  echo "✅ docker-compose.yml が見つかりました"
else
  echo "❌ docker-compose.yml が見つかりません"
  echo "   正しいディレクトリで実行していますか？"
  exit 1
fi

echo ""
echo "🔍 Docker Compose サービス一覧..."
docker-compose config --services 2>/dev/null || echo "❌ docker-compose config が失敗しました"

echo ""
echo "🔍 コンテナ状態の詳細確認..."
echo "--- docker-compose ps ---"
docker-compose ps 2>/dev/null || echo "❌ docker-compose ps が失敗しました"

echo ""
echo "--- docker ps (すべてのコンテナ) ---"
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | head -20

echo ""
echo "🔍 データベースコンテナの特定..."
DB_CONTAINER=$(docker-compose ps -q db 2>/dev/null)
if [ -n "$DB_CONTAINER" ]; then
  echo "✅ データベースコンテナ ID: $DB_CONTAINER"
  echo "   状態: $(docker inspect --format='{{.State.Status}}' $DB_CONTAINER 2>/dev/null || echo '不明')"
else
  echo "❌ データベースコンテナが見つかりません"
  echo ""
  echo "🔍 他のデータベース関連コンテナを探索..."
  docker ps -a --format "table {{.Names}}\t{{.Status}}" | grep -i "db\|mysql\|maria"
fi

echo ""
echo "🔍 ネットワーク接続確認..."
if [ -n "$DB_CONTAINER" ]; then
  echo "データベースコンテナへの接続テスト:"
  docker exec $DB_CONTAINER mysql -u root -ppassword -e "SELECT 'Connection OK' as status;" 2>/dev/null || echo "❌ 直接接続が失敗しました"

  echo ""
  echo "docker-compose経由での接続テスト:"
  docker-compose exec -T db mysql -u root -ppassword -e "SELECT 'Connection OK' as status;" 2>/dev/null || echo "❌ docker-compose経由の接続が失敗しました"
fi

echo ""
echo "📋 推奨アクション:"
echo "1. データベースを起動: docker-compose up -d db"
echo "2. ログを確認: docker-compose logs db"
echo "3. 全体を再起動: docker-compose restart"
echo "4. 完全にリセット: docker-compose down && docker-compose up -d"