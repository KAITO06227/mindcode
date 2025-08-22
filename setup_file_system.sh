#!/bin/bash

# ファイル保存システムセットアップスクリプト

echo "🚀 MindCode ファイル保存システムセットアップ開始"

# 1. 必要なディレクトリの作成
echo "📁 ディレクトリ構造を作成中..."
mkdir -p user_projects
mkdir -p server/utils
mkdir -p server/routes
chmod 755 user_projects
echo "✅ ディレクトリ構造作成完了"

# 2. Node.jsパッケージの確認
echo "📦 Node.jsパッケージを確認中..."
if [ -f "package.json" ]; then
    # multerとuuidが既にインストールされていることを確認
    node -e "require('multer')" 2>/dev/null && echo "✅ multer: インストール済み" || echo "⚠️  multer: 要インストール"
    node -e "require('crypto')" 2>/dev/null && echo "✅ crypto: Node.js組み込み" || echo "❌ crypto: Node.jsバージョン問題"
    node -e "require('uuid')" 2>/dev/null && echo "✅ uuid: インストール済み" || echo "⚠️  uuid: 要インストール"
    echo "✅ パッケージ確認完了"
else
    echo "❌ package.json が見つかりません"
    exit 1
fi

# 3. データベーススキーマの適用方法を案内
echo "📊 データベーススキーマ適用..."
if docker ps | grep -q "webide-mysql"; then
    echo "✅ MySQLコンテナが起動中です"
    echo "🔧 スキーマを適用するには："
    echo "   ./apply_db_schema.sh"
    echo ""
    echo "または手動で："
    echo "   docker exec -i webide-mysql mysql -u root -ppassword webide < server/database/file_system_schema.sql"
else
    echo "⚠️  MySQLコンテナが起動していません"
    echo "   まず 'docker compose up -d' でコンテナを起動してください"
fi

# 4. Gitがインストールされているかチェック
echo "🔧 Git インストール状況確認..."
if command -v git &> /dev/null; then
    echo "✅ Git インストール確認: $(git --version)"
else
    echo "❌ Git がインストールされていません"
    echo "   以下のコマンドでインストールしてください："
    echo "   Ubuntu/Debian: sudo apt-get install git"
    echo "   macOS: brew install git"
    echo "   Windows: https://git-scm.com/download/win"
    exit 1
fi

# 5. 権限設定
echo "🔒 権限設定中..."
find user_projects -type d -exec chmod 755 {} \; 2>/dev/null || true
find user_projects -type f -exec chmod 644 {} \; 2>/dev/null || true
echo "✅ 権限設定完了"

# 6. テスト用プロジェクトディレクトリの作成
echo "🧪 テスト環境準備中..."
mkdir -p user_projects/test_user/test_project
echo "test file" > user_projects/test_user/test_project/test.txt
echo "✅ テスト環境準備完了"

# 7. 設定確認
echo "⚙️  システム設定確認..."
echo "   Node.js: $(node --version)"
echo "   npm: $(npm --version)"
echo "   Git: $(git --version)"
echo "   データベース: MySQL (要手動確認)"

echo ""
echo "🎉 ファイル保存システムセットアップ完了！"
echo ""
echo "📝 次のステップ："
echo "   1. Dockerコンテナを再起動: docker compose down && docker compose up -d"
echo "   2. ブラウザでログインしてJWTトークンを取得"
echo "   3. APIテストを実行: node test_file_system_api.js <JWT_TOKEN>"
echo ""
echo "🔗 新しいAPIエンドポイント："
echo "   POST   /api/filesystem/:projectId/files      - ファイル作成・更新"
echo "   GET    /api/filesystem/:projectId/files/:id  - ファイル取得"
echo "   DELETE /api/filesystem/:projectId/files/:id  - ファイル削除"
echo "   GET    /api/filesystem/:projectId/tree       - ファイルツリー取得"
echo "   POST   /api/version-control/:projectId/init  - Git初期化"
echo "   GET    /api/version-control/:projectId/status - Git状態取得"
echo "   POST   /api/version-control/:projectId/commit - コミット作成"
echo "   GET    /api/version-control/:projectId/history - コミット履歴"
echo ""
echo "📚 詳細なドキュメントは README_FILE_SYSTEM.md を参照してください。"