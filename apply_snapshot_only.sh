#!/bin/bash

# スナップショット機能専用スキーマ適用スクリプト

echo "=== スナップショット機能専用スキーマを適用 ==="

# スキーマファイル確認
if [ ! -f "server/database/snapshot_schema.sql" ]; then
  echo "❌ スナップショット専用スキーマファイルが見つかりません"
  exit 1
fi

echo "🔄 スナップショット専用スキーマを適用中..."

# 重複エラーを無視してスキーマを適用
if docker-compose exec -T db mysql -u root -ppassword webide < server/database/snapshot_schema.sql; then
  echo "✅ スナップショット機能専用スキーマの適用が完了しました！"
  echo ""

  # テーブル確認
  echo "📊 作成されたテーブル:"
  docker-compose exec -T db mysql -u root -ppassword webide -e "
    SELECT table_name, table_comment
    FROM information_schema.tables
    WHERE table_schema = 'webide'
    AND table_name IN ('project_snapshots', 'active_snapshots', 'user_layouts')
    ORDER BY table_name;
  " 2>/dev/null || echo "  テーブル一覧の取得をスキップしました"

  echo ""
  echo "🎉 スナップショット機能が利用可能になりました:"
  echo "   ✓ AI処理完了時の自動スナップショット"
  echo "   ✓ 手動プロジェクト保存スナップショット"
  echo "   ✓ ワンクリック復元機能"
  echo "   ✓ スナップショット管理UI"
  echo ""
  echo "📝 次の手順:"
  echo "   docker-compose restart webide-app"
  echo "   または"
  echo "   docker-compose up -d webide-app"

else
  echo "❌ スキーマの適用に失敗しました。"
  echo ""
  echo "🔧 エラーログ確認:"
  docker-compose exec -T db mysql -u root -ppassword webide < server/database/snapshot_schema.sql
  exit 1
fi