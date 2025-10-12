#!/bin/bash

# シンプル版: スナップショット機能用データベーススキーマ適用

echo "=== スナップショット機能のデータベーススキーマを適用 ==="

# スキーマファイル確認
if [ ! -f "server/database/file_system_schema.sql" ]; then
  echo "❌ スキーマファイルが見つかりません: server/database/file_system_schema.sql"
  exit 1
fi

echo "🔄 スキーマを適用中..."

# 直接適用（エラーチェックをスキップ）
if docker-compose exec -T db mysql -u root -ppassword webide < server/database/file_system_schema.sql 2>/dev/null; then
  echo "✅ スナップショット機能用スキーマの適用が完了しました！"
  echo ""
  echo "🎉 以下の機能が利用可能になりました:"
  echo "   - AI処理完了時の自動スナップショット"
  echo "   - 手動プロジェクト保存スナップショット"
  echo "   - ワンクリック復元機能"
  echo ""
  echo "📝 アプリケーションを再起動してください:"
  echo "   docker-compose restart webide-app"
else
  echo "❌ スキーマの適用に失敗しました。"
  echo ""
  echo "🔧 トラブルシューティング:"
  echo "1. データベース状態確認: ./check_database.sh"
  echo "2. データベース起動: docker-compose up -d db"
  echo "3. 詳細診断版実行: ./apply_snapshot_schema.sh"
  exit 1
fi