#!/bin/bash

# ============================================
# MineCode データベースバックアップスクリプト
# ============================================
# 使用方法:
#   ./backup.sh
#
# cronで自動化する場合:
#   0 3 * * * /var/www/minecode/backup.sh >> /var/log/minecode-backup.log 2>&1
# ============================================

set -e  # エラーが発生したら即座に終了

# 設定
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
BACKUP_FILE="backup-${TIMESTAMP}.sql"
KEEP_DAYS=30  # バックアップ保持日数

# .env.production から環境変数を読み込む
if [ -f .env.production ]; then
    export $(grep -v '^#' .env.production | xargs)
else
    echo "ERROR: .env.production が見つかりません"
    exit 1
fi

# 色付きメッセージ用
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# バックアップディレクトリの作成
mkdir -p "${BACKUP_DIR}"

info "=== MineCode データベースバックアップ開始 ==="
info "タイムスタンプ: ${TIMESTAMP}"
info "データベース: ${DB_NAME}"

# データベースのバックアップ
info "データベースをバックアップ中..."

docker-compose -f docker-compose.production.yml exec -T db \
    mysqldump -u root -p"${DB_PASSWORD}" \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    "${DB_NAME}" > "${BACKUP_DIR}/${BACKUP_FILE}"

if [ $? -eq 0 ]; then
    info "✓ データベースバックアップ完了: ${BACKUP_DIR}/${BACKUP_FILE}"
else
    error "✗ データベースバックアップ失敗"
    exit 1
fi

# バックアップの圧縮
info "バックアップを圧縮中..."
gzip "${BACKUP_DIR}/${BACKUP_FILE}"

if [ $? -eq 0 ]; then
    info "✓ 圧縮完了: ${BACKUP_DIR}/${BACKUP_FILE}.gz"
else
    warn "✗ 圧縮失敗（非圧縮バックアップは保存されています）"
fi

# ファイルサイズの表示
BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}.gz" 2>/dev/null | cut -f1 || echo "N/A")
info "バックアップサイズ: ${BACKUP_SIZE}"

# user_projectsディレクトリのバックアップ（オプション）
if [ -d "./user_projects" ]; then
    info "ユーザープロジェクトをバックアップ中..."
    tar -czf "${BACKUP_DIR}/user_projects-${TIMESTAMP}.tar.gz" ./user_projects

    if [ $? -eq 0 ]; then
        USER_PROJECTS_SIZE=$(du -h "${BACKUP_DIR}/user_projects-${TIMESTAMP}.tar.gz" | cut -f1)
        info "✓ ユーザープロジェクトバックアップ完了: ${USER_PROJECTS_SIZE}"
    else
        warn "✗ ユーザープロジェクトのバックアップ失敗"
    fi
fi

# 古いバックアップの削除
info "古いバックアップを削除中（${KEEP_DAYS}日以上前）..."

find "${BACKUP_DIR}" -name "backup-*.sql.gz" -type f -mtime +${KEEP_DAYS} -delete
find "${BACKUP_DIR}" -name "user_projects-*.tar.gz" -type f -mtime +${KEEP_DAYS} -delete

REMAINING_BACKUPS=$(find "${BACKUP_DIR}" -name "backup-*.sql.gz" | wc -l)
info "保持中のバックアップ数: ${REMAINING_BACKUPS}"

# バックアップファイルの一覧表示
info "最新のバックアップファイル（最新5件）:"
ls -lht "${BACKUP_DIR}" | head -6

info "=== バックアップ完了 ==="

# バックアップの整合性チェック（オプション）
if command -v gunzip &> /dev/null; then
    info "バックアップファイルの整合性をチェック中..."
    if gunzip -t "${BACKUP_DIR}/${BACKUP_FILE}.gz" 2>/dev/null; then
        info "✓ バックアップファイルは正常です"
    else
        error "✗ バックアップファイルが破損している可能性があります"
        exit 1
    fi
fi

exit 0
