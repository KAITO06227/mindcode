# MineCode 本番環境デプロイ手順書

## 対象環境
- **OS**: Rocky Linux
- **ドメイン**: minecode.si.aoyama.ac.jp
- **プロトコル**: HTTPS (Let's Encrypt SSL証明書)
- **構成**: Nginx + Docker Compose (Node.js + MySQL)

---

## 目次
1. [サーバー初期設定](#1-サーバー初期設定)
2. [必要なソフトウェアのインストール](#2-必要なソフトウェアのインストール)
3. [ファイアウォール設定](#3-ファイアウォール設定)
4. [プロジェクトのデプロイ](#4-プロジェクトのデプロイ)
5. [SSL証明書の取得](#5-ssl証明書の取得)
6. [アプリケーションの起動](#6-アプリケーションの起動)
7. [動作確認](#7-動作確認)
8. [トラブルシューティング](#8-トラブルシューティング)
9. [メンテナンス](#9-メンテナンス)

---

## 1. サーバー初期設定

### 1.1 サーバーへの接続
```bash
ssh your_username@minecode.si.aoyama.ac.jp
```

### 1.2 システムアップデート
```bash
sudo dnf update -y
sudo dnf upgrade -y
```

### 1.3 必要なユーティリティのインストール
```bash
sudo dnf install -y git wget curl vim
```

---

## 2. 必要なソフトウェアのインストール

### 2.1 Docker のインストール

#### Docker リポジトリの追加
```bash
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
```

#### Docker のインストール
```bash
sudo dnf install -y docker-ce docker-ce-cli containerd.io
```

#### Docker の起動と自動起動設定
```bash
sudo systemctl start docker
sudo systemctl enable docker
```

#### Docker の動作確認
```bash
sudo docker --version
sudo docker run hello-world
```

#### 現在のユーザーを docker グループに追加（sudo なしで実行可能にする）
```bash
sudo usermod -aG docker $USER
```
**注意**: グループ反映のため、一度ログアウト・再ログインが必要です。

### 2.2 Docker Compose のインストール

```bash
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
docker-compose --version
```

### 2.3 Nginx のインストール

```bash
sudo dnf install -y nginx
sudo systemctl enable nginx
```

**注意**: Nginx は後でSSL設定後に起動します。

### 2.4 Certbot (Let's Encrypt) のインストール

```bash
sudo dnf install -y epel-release
sudo dnf install -y certbot python3-certbot-nginx
```

---

## 3. ファイアウォール設定

### 3.1 Firewalld の設定

```bash
# HTTP/HTTPS ポートを開放
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https

# 設定を反映
sudo firewall-cmd --reload

# 設定確認
sudo firewall-cmd --list-all
```

### 3.2 SELinux の設定（必要に応じて）

SELinux が有効な場合、Nginx がプロキシとして動作できるように設定：

```bash
sudo setsebool -P httpd_can_network_connect 1
```

---

## 4. プロジェクトのデプロイ

### 4.1 プロジェクト用ディレクトリの作成

```bash
sudo mkdir -p /var/www/minecode
sudo chown $USER:$USER /var/www/minecode
cd /var/www/minecode
```

### 4.2 Git リポジトリのクローン

```bash
# GitHub などからクローン（例）
git clone https://github.com/your-organization/minecode.git .

# または、ローカルから rsync でアップロード
# ローカルマシンから実行:
# rsync -avz --exclude 'node_modules' --exclude '.git' \
#   /Users/skmtkit/Desktop/guitaradot/mindcode/ \
#   your_username@minecode.si.aoyama.ac.jp:/var/www/minecode/
```

### 4.3 環境変数ファイルの作成

```bash
cd /var/www/minecode
cp .env.production.example .env.production
```

`.env.production` を編集して本番環境の値を設定：

```bash
vim .env.production
```

**設定例**:
```env
# Google OAuth (Google Cloud Console で取得)
GOOGLE_CLIENT_ID=your_production_google_client_id
GOOGLE_CLIENT_SECRET=your_production_google_client_secret
GOOGLE_CALLBACK_URL=https://minecode.si.aoyama.ac.jp/api/auth/google/callback

# JWT Secret (強力なランダム文字列を生成)
JWT_SECRET=your_production_jwt_secret_key

# Claude API Key
CLAUDE_API_KEY=your_claude_api_key

# Database
DB_HOST=db
DB_PORT=3306
DB_NAME=minecode_prod
DB_USER=minecode_user
DB_PASSWORD=your_secure_database_password

# Server
PORT=3001
NODE_ENV=production
```

**JWT_SECRET の生成方法**:
```bash
openssl rand -base64 64
```

### 4.4 データベース初期化スクリプトの確認

```bash
ls -la server/database/*.sql
```

以下のファイルが存在することを確認：
- `init.sql` - 基本スキーマ
- `file_system_schema.sql` - ファイルシステム拡張
- `multi_user_schema.sql` - マルチユーザー機能

### 4.5 user_projects ディレクトリの作成

```bash
mkdir -p /var/www/minecode/user_projects
chmod 755 /var/www/minecode/user_projects
```

---

## 5. SSL証明書の取得

### 5.1 仮の Nginx 設定（証明書取得用）

一時的な Nginx 設定を作成：

```bash
sudo vim /etc/nginx/conf.d/minecode-temp.conf
```

以下の内容を記述：
```nginx
server {
    listen 80;
    server_name minecode.si.aoyama.ac.jp;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
```

### 5.2 Nginx の起動

```bash
sudo mkdir -p /var/www/certbot
sudo nginx -t
sudo systemctl start nginx
sudo systemctl status nginx
```

### 5.3 SSL証明書の取得

```bash
sudo certbot certonly --webroot -w /var/www/certbot \
  -d minecode.si.aoyama.ac.jp \
  --email your-email@aoyama.ac.jp \
  --agree-tos \
  --no-eff-email
```

証明書の保存場所:
- `/etc/letsencrypt/live/minecode.si.aoyama.ac.jp/fullchain.pem`
- `/etc/letsencrypt/live/minecode.si.aoyama.ac.jp/privkey.pem`

### 5.4 証明書の自動更新設定

```bash
sudo systemctl enable certbot-renew.timer
sudo systemctl start certbot-renew.timer
```

---

## 6. アプリケーションの起動

### 6.1 本番用 Nginx 設定の適用

```bash
sudo cp /var/www/minecode/nginx/minecode.conf /etc/nginx/conf.d/
sudo rm /etc/nginx/conf.d/minecode-temp.conf
sudo nginx -t
sudo systemctl reload nginx
```

### 6.2 Docker Compose でアプリケーション起動

```bash
cd /var/www/minecode

# イメージのビルド
docker-compose -f docker-compose.production.yml build

# バックグラウンドで起動
docker-compose -f docker-compose.production.yml up -d
```

### 6.3 起動確認

```bash
# コンテナの状態確認
docker-compose -f docker-compose.production.yml ps

# ログの確認
docker-compose -f docker-compose.production.yml logs -f web
```

### 6.4 データベースの初期化

初回起動時のみ、データベーススキーマを適用：

```bash
# MySQL コンテナに接続
docker-compose -f docker-compose.production.yml exec db mysql -u root -p

# パスワード入力後、以下を実行
USE minecode_prod;
SOURCE /docker-entrypoint-initdb.d/init.sql;
SOURCE /docker-entrypoint-initdb.d/file_system_schema.sql;
SOURCE /docker-entrypoint-initdb.d/multi_user_schema.sql;
EXIT;
```

または、ホストから直接実行：

```bash
docker-compose -f docker-compose.production.yml exec db \
  mysql -u root -p minecode_prod < server/database/init.sql

docker-compose -f docker-compose.production.yml exec db \
  mysql -u root -p minecode_prod < server/database/file_system_schema.sql

docker-compose -f docker-compose.production.yml exec db \
  mysql -u root -p minecode_prod < server/database/multi_user_schema.sql
```

---

## 7. 動作確認

### 7.1 アプリケーションの疎通確認

```bash
# ヘルスチェック
curl -I http://localhost:3001/

# Nginx 経由の確認
curl -I http://localhost/
```

### 7.2 ブラウザでアクセス

1. https://minecode.si.aoyama.ac.jp にアクセス
2. Google ログイン画面が表示されることを確認
3. `@gsuite.si.aoyama.ac.jp` アカウントでログイン

### 7.3 ログの確認

```bash
# アプリケーションログ
docker-compose -f docker-compose.production.yml logs -f web

# Nginx アクセスログ
sudo tail -f /var/log/nginx/access.log

# Nginx エラーログ
sudo tail -f /var/log/nginx/error.log
```

---

## 8. トラブルシューティング

### 8.1 コンテナが起動しない

```bash
# エラーログを確認
docker-compose -f docker-compose.production.yml logs web
docker-compose -f docker-compose.production.yml logs db

# コンテナを再起動
docker-compose -f docker-compose.production.yml restart
```

### 8.2 データベース接続エラー

```bash
# MySQL コンテナの状態確認
docker-compose -f docker-compose.production.yml exec db mysql -u root -p -e "SHOW DATABASES;"

# .env.production の DB 設定を確認
cat .env.production | grep DB_
```

### 8.3 Google OAuth エラー

Google Cloud Console で以下を確認：
1. **承認済みのリダイレクトURI** に以下を追加
   - `https://minecode.si.aoyama.ac.jp/api/auth/google/callback`
2. **承認済みの JavaScript 生成元** に以下を追加
   - `https://minecode.si.aoyama.ac.jp`

### 8.4 ポート競合エラー

```bash
# ポート使用状況の確認
sudo ss -tlnp | grep -E ':(80|443|3001|3306)'

# 競合するプロセスを停止
sudo systemctl stop httpd  # Apache が動いている場合
```

### 8.5 SELinux による拒否

```bash
# SELinux ログの確認
sudo ausearch -m avc -ts recent

# 一時的に無効化（テスト用）
sudo setenforce 0

# 恒久的に無効化する場合（非推奨）
sudo vim /etc/selinux/config
# SELINUX=enforcing を SELINUX=permissive に変更
```

---

## 9. メンテナンス

### 9.1 アプリケーションの更新

```bash
cd /var/www/minecode

# 最新コードを取得
git pull origin main

# コンテナの再ビルドと再起動
docker-compose -f docker-compose.production.yml down
docker-compose -f docker-compose.production.yml build
docker-compose -f docker-compose.production.yml up -d
```

### 9.2 データベースのバックアップ

```bash
# バックアップスクリプトを実行
cd /var/www/minecode
./backup.sh

# バックアップファイルの確認
ls -lh /var/www/minecode/backups/
```

### 9.3 ログのローテーション

Docker のログサイズを制限する設定（docker-compose.production.yml に記載済み）：

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

### 9.4 システムリソースの監視

```bash
# CPU/メモリ使用状況
docker stats

# ディスク使用状況
df -h
du -sh /var/www/minecode/user_projects
```

### 9.5 定期的なメンテナンスタスク

**毎日**: データベースバックアップ（cron で自動化）
```bash
sudo crontab -e

# 毎日午前3時にバックアップ
0 3 * * * /var/www/minecode/backup.sh >> /var/log/minecode-backup.log 2>&1
```

**毎週**: 不要な Docker イメージの削除
```bash
docker system prune -a -f
```

**毎月**: SSL証明書の有効期限確認
```bash
sudo certbot certificates
```

---

## 10. セキュリティ推奨事項

### 10.1 SSH のセキュリティ強化

```bash
sudo vim /etc/ssh/sshd_config

# 以下を設定
PermitRootLogin no
PasswordAuthentication no  # 鍵認証のみ許可
```

### 10.2 自動セキュリティアップデート

```bash
sudo dnf install -y dnf-automatic
sudo systemctl enable --now dnf-automatic.timer
```

### 10.3 fail2ban のインストール（オプション）

```bash
sudo dnf install -y fail2ban
sudo systemctl enable --now fail2ban
```

---

## 11. 緊急時の対応

### 11.1 アプリケーションの停止

```bash
cd /var/www/minecode
docker-compose -f docker-compose.production.yml down
```

### 11.2 データベースのリストア

```bash
# バックアップファイルからリストア
cd /var/www/minecode
docker-compose -f docker-compose.production.yml exec -T db \
  mysql -u root -p minecode_prod < backups/backup-YYYYMMDD-HHMMSS.sql
```

### 11.3 ロールバック

```bash
cd /var/www/minecode
git log --oneline  # コミット履歴を確認
git checkout <commit-hash>  # 特定のコミットに戻る
docker-compose -f docker-compose.production.yml down
docker-compose -f docker-compose.production.yml build
docker-compose -f docker-compose.production.yml up -d
```

---

## 12. 連絡先

- **開発者**: [あなたの連絡先]
- **大学IT部門**: [IT部門の連絡先]
- **緊急時**: [緊急連絡先]

---

## 参考リンク

- [Docker 公式ドキュメント](https://docs.docker.com/)
- [Nginx 公式ドキュメント](https://nginx.org/en/docs/)
- [Let's Encrypt 公式サイト](https://letsencrypt.org/)
- [Rocky Linux 公式ドキュメント](https://docs.rockylinux.org/)
