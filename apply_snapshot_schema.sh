#!/bin/bash

# スナップショット機能用データベーススキーマ適用スクリプト

echo "=== MindCode スナップショット機能のデータベーススキーマを適用します ==="

# Dockerコンテナが起動しているか確認
echo "🔍 データベースコンテナの状態を確認中..."

# より確実な方法でコンテナ状態をチェック
if ! docker-compose ps db 2>/dev/null | grep -q "Up\|running"; then
  echo "❌ データベースコンテナが起動していません。"
  echo ""
  echo "現在のコンテナ状態:"
  docker-compose ps 2>/dev/null || echo "docker-compose が利用できません"
  echo ""
  echo "📋 解決方法:"
  echo "1. データベースを起動: docker-compose up -d db"
  echo "2. 全体を起動: docker-compose up -d"
  echo ""
  exit 1
fi

echo "✅ データベースコンテナが起動しています。"

# データベース接続テスト
echo "🔌 データベース接続をテスト中..."
if docker-compose exec -T db mysql -u root -ppassword -e "SELECT 1;" >/dev/null 2>&1; then
  echo "✅ データベースに接続できました。"
else
  echo "❌ データベースへの接続に失敗しました。"
  echo "   データベースが完全に起動するまで少し待ってから再試行してください。"
  exit 1
fi

echo "📋 適用するスキーマ:"
echo "  - project_snapshots (スナップショット管理)"
echo "  - active_snapshots (アクティブスナップショット状態)"
echo "  - user_layouts (ユーザーレイアウト)"
echo ""

# スキーマファイルの存在確認
if [ ! -f "server/database/file_system_schema.sql" ]; then
  echo "❌ スキーマファイルが見つかりません: server/database/file_system_schema.sql"
  exit 1
fi

echo "🔄 スナップショット機能用スキーマを適用中..."

# Docker経由でスキーマを適用
if docker-compose exec -T db mysql -u root -ppassword webide < server/database/file_system_schema.sql; then
  echo "✅ スナップショット機能用スキーマの適用が完了しました！"
  echo ""
  echo "📊 適用されたテーブル:"
  docker-compose exec -T db mysql -u root -ppassword webide -e "
    SELECT table_name, table_comment
    FROM information_schema.tables
    WHERE table_schema = 'webide'
    AND table_name IN ('project_snapshots', 'active_snapshots', 'user_layouts')
    ORDER BY table_name;
  "
  echo ""
  echo "🎉 スナップショット機能が使用可能になりました！"
  echo "   - AI処理完了時の自動スナップショット"
  echo "   - 手動プロジェクト保存スナップショット"
  echo "   - ワンクリック復元機能"
else
  echo "❌ スキーマの適用に失敗しました。"
  echo "データベース接続を確認してください。"
  exit 1
fi