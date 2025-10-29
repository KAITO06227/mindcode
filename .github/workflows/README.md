# GitHub Actions CI/CD セットアップガイド

## 概要

このワークフローは、`main`ブランチへのプッシュ時に自動的に本番サーバー（minecode.si.aoyama.ac.jp）へデプロイします。

## セットアップ手順

### 1. SSH鍵の準備

本番サーバーにパスワードなしでSSH接続できるようにSSH鍵を設定します。

#### ローカルマシンで実行（既にSSH鍵がある場合はスキップ）

```bash
# SSH鍵ペアを生成（既存の鍵がない場合）
ssh-keygen -t ed25519 -C "github-actions@minecode" -f ~/.ssh/minecode_deploy

# 公開鍵をサーバーにコピー
ssh-copy-id -i ~/.ssh/minecode_deploy.pub your_username@minecode.si.aoyama.ac.jp
```

#### 秘密鍵の内容を取得

```bash
cat ~/.ssh/minecode_deploy
```

この内容をコピーします（`-----BEGIN OPENSSH PRIVATE KEY-----`から`-----END OPENSSH PRIVATE KEY-----`まで全て）。

### 2. GitHubリポジトリのSecretsを設定

GitHubリポジトリの **Settings** → **Secrets and variables** → **Actions** → **New repository secret** で以下を追加：

#### SSH_PRIVATE_KEY
- **Name**: `SSH_PRIVATE_KEY`
- **Value**: 上記でコピーしたSSH秘密鍵の内容を貼り付け

#### SERVER_USER
- **Name**: `SERVER_USER`
- **Value**: サーバーのユーザー名（例: `sakamoto`）

### 3. サーバー側の準備

サーバー上でGitリポジトリをセットアップします。

```bash
# サーバーにSSH接続
ssh your_username@minecode.si.aoyama.ac.jp

# プロジェクトディレクトリに移動
cd /var/www/minecode

# Gitリモートを設定（まだの場合）
git remote add origin https://github.com/your-organization/minecode.git

# または既存のリモートを確認
git remote -v

# mainブランチに切り替え
git checkout main
git pull origin main
```

### 4. デプロイテスト

#### ローカルで変更をプッシュ

```bash
git add .
git commit -m "test: CI/CD deployment"
git push origin main
```

#### GitHub Actionsの確認

GitHubリポジトリの **Actions** タブでワークフローの実行状況を確認できます。

### 5. トラブルシューティング

#### エラー: Permission denied (publickey)

SSH鍵が正しく設定されていません。以下を確認：

```bash
# サーバー上で
cat ~/.ssh/authorized_keys
```

GitHub Actionsで使用した公開鍵が含まれているか確認してください。

#### エラー: Docker command not found

サーバー上でDockerがインストールされていないか、ユーザーがdockerグループに追加されていません。

```bash
# サーバー上で
sudo usermod -aG docker $USER
# ログアウト・再ログインが必要
```

#### エラー: npm install fails

サーバー上のNode.jsバージョンが古い可能性があります。

```bash
# サーバー上で
node --version
npm --version
```

Node.js 18以上が必要です。

## ワークフローの動作

1. **Checkout code**: 最新のコードを取得
2. **Setup SSH**: SSH鍵を設定
3. **Add server to known hosts**: サーバーをknown_hostsに追加
4. **Deploy to server**:
   - サーバー上で`git pull`
   - クライアントを再ビルド
   - Dockerコンテナを再起動
   - ヘルスチェック
5. **Notify deployment status**: デプロイ結果を通知

## デプロイ時間

通常、デプロイには5-10分程度かかります。

## 手動デプロイ

GitHub Actionsを使わずに手動でデプロイする場合：

```bash
# サーバーにSSH接続
ssh your_username@minecode.si.aoyama.ac.jp
cd /var/www/minecode
./deploy.sh --build
```

## セキュリティ注意事項

- SSH秘密鍵はGitHub Secretsに保存され、リポジトリの外部からはアクセスできません
- `.env.production`はGitにコミットしないでください（機密情報が含まれるため）
- デプロイ用のSSH鍵は専用のものを使用し、他の用途と共用しないでください
