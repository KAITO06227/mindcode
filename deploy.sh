#!/bin/bash

# ============================================
# MineCode デプロイスクリプト
# ============================================
# 使用方法:
#   ./deploy.sh [オプション]
#
# オプション:
#   --build      イメージを再ビルドしてデプロイ
#   --restart    アプリケーションを再起動
#   --logs       ログを表示
#   --stop       アプリケーションを停止
#   --status     ステータスを表示
# ============================================

set -e  # エラーが発生したら即座に終了

# 色付きメッセージ用
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 関数: メッセージ出力
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 関数: 環境チェック
check_environment() {
    info "環境をチェック中..."

    # Docker のチェック
    if ! command -v docker &> /dev/null; then
        error "Docker がインストールされていません"
        exit 1
    fi

    # Docker Compose のチェック
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose がインストールされていません"
        exit 1
    fi

    # .env.production の存在確認
    if [ ! -f .env.production ]; then
        error ".env.production ファイルが見つかりません"
        info ".env.production.example をコピーして作成してください"
        exit 1
    fi

    info "環境チェック完了"
}

# 関数: バックアップ作成
create_backup() {
    info "データベースのバックアップを作成中..."

    if [ -f ./backup.sh ]; then
        ./backup.sh
        info "バックアップ完了"
    else
        warn "backup.sh が見つかりません。バックアップをスキップします"
    fi
}

# 関数: イメージビルド
build_images() {
    info "Docker イメージをビルド中..."
    docker-compose --env-file .env.production -f docker-compose.production.yml build --no-cache
    info "ビルド完了"
}

# 関数: アプリケーション起動
start_application() {
    info "アプリケーションを起動中..."
    docker-compose --env-file .env.production -f docker-compose.production.yml up -d
    info "起動完了"
}

# 関数: アプリケーション停止
stop_application() {
    info "アプリケーションを停止中..."
    docker-compose --env-file .env.production -f docker-compose.production.yml down
    info "停止完了"
}

# 関数: アプリケーション再起動
restart_application() {
    info "アプリケーションを再起動中..."
    docker-compose --env-file .env.production -f docker-compose.production.yml restart
    info "再起動完了"
}

# 関数: ステータス表示
show_status() {
    info "アプリケーションのステータス:"
    docker-compose --env-file .env.production -f docker-compose.production.yml ps
}

# 関数: ログ表示
show_logs() {
    info "ログを表示中（Ctrl+C で終了）:"
    docker-compose --env-file .env.production -f docker-compose.production.yml logs -f
}

# 関数: ヘルスチェック
health_check() {
    info "ヘルスチェック中..."

    sleep 5  # サービス起動を待つ

    # アプリケーションのヘルスチェック
    if curl -f http://localhost:3001/api/health > /dev/null 2>&1; then
        info "✓ アプリケーションは正常に動作しています"
    else
        warn "✗ アプリケーションへの接続に失敗しました"
    fi
}

# 関数: 通常デプロイ
deploy() {
    info "=== MineCode デプロイ開始 ==="

    check_environment
    create_backup

    # 既存のコンテナを停止
    if docker-compose --env-file .env.production -f docker-compose.production.yml ps -q 2>/dev/null | grep -q .; then
        info "既存のコンテナを停止中..."
        docker-compose --env-file .env.production -f docker-compose.production.yml down
    fi

    start_application
    health_check
    show_status

    info "=== デプロイ完了 ==="
    info "アプリケーションURL: https://minecode.si.aoyama.ac.jp"
    info "ログを確認: ./deploy.sh --logs"
}

# 関数: ビルド付きデプロイ
deploy_with_build() {
    info "=== MineCode ビルド＆デプロイ開始 ==="

    check_environment
    create_backup

    # 既存のコンテナを停止
    if docker-compose --env-file .env.production -f docker-compose.production.yml ps -q 2>/dev/null | grep -q .; then
        info "既存のコンテナを停止中..."
        docker-compose --env-file .env.production -f docker-compose.production.yml down
    fi

    build_images
    start_application
    health_check
    show_status

    info "=== ビルド＆デプロイ完了 ==="
    info "アプリケーションURL: https://minecode.si.aoyama.ac.jp"
    info "ログを確認: ./deploy.sh --logs"
}

# メイン処理
main() {
    case "${1:-}" in
        --build)
            deploy_with_build
            ;;
        --restart)
            restart_application
            health_check
            ;;
        --stop)
            stop_application
            ;;
        --logs)
            show_logs
            ;;
        --status)
            show_status
            ;;
        --help)
            echo "使用方法: ./deploy.sh [オプション]"
            echo ""
            echo "オプション:"
            echo "  --build      イメージを再ビルドしてデプロイ"
            echo "  --restart    アプリケーションを再起動"
            echo "  --logs       ログを表示"
            echo "  --stop       アプリケーションを停止"
            echo "  --status     ステータスを表示"
            echo "  --help       このヘルプを表示"
            echo ""
            echo "オプションなし: 通常デプロイ（既存イメージを使用）"
            ;;
        "")
            deploy
            ;;
        *)
            error "不明なオプション: $1"
            echo "ヘルプ: ./deploy.sh --help"
            exit 1
            ;;
    esac
}

main "$@"
