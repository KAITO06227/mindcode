# Self-hosted Runner セットアップガイド

大学のネットワークポリシーにより外部からのSSHアクセスが制限されているため、Self-hosted Runnerを使用します。

## Self-hosted Runnerとは

サーバー上で動作するGitHub Actionsのエージェントです。
- サーバーからGitHubに接続（外部への接続のみ）
- 外部からサーバーへのSSH接続は不要
- VPNや学内ネットワーク経由のアクセス不要

## セットアップ手順

### 1. GitHubリポジトリでRunnerを追加

1. https://github.com/KAITO06227/mindcode/settings/actions/runners にアクセス
2. **New self-hosted runner** をクリック
3. **Linux** を選択
4. 表示されるコマンドをコピー（次のステップで使用）

### 2. サーバーにSSH接続

```bash
ssh sakamoto@minecode.si.aoyama.ac.jp
```

### 3. Runnerのインストール

GitHubに表示されたコマンドを実行します（例）：

```bash
# Runnerディレクトリを作成
mkdir -p ~/actions-runner && cd ~/actions-runner

# Runnerをダウンロード
curl -o actions-runner-linux-x64-2.311.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz

# 展開
tar xzf ./actions-runner-linux-x64-2.311.0.tar.gz

# 設定（GitHubに表示されたトークンを使用）
./config.sh --url https://github.com/KAITO06227/mindcode --token YOUR_TOKEN_HERE

# 以下の質問に答える
# Enter the name of the runner group: [Press Enter for default]
# Enter the name of runner: minecode-server
# Enter any additional labels: production
# Enter name of work folder: [Press Enter for default]
```

### 4. Runnerをサービスとして登録

```bash
# サービスとしてインストール
sudo ~/actions-runner/svc.sh install

# サービスを起動
sudo ~/actions-runner/svc.sh start

# 状態確認
sudo ~/actions-runner/svc.sh status
```

### 5. Runnerの動作確認

GitHubリポジトリの Settings → Actions → Runners で、Runnerが **Idle** 状態（緑色）になっていることを確認してください。

### 6. 古いワークフローを無効化

```bash
# ローカルマシンで
cd /Users/skmtkit/Desktop/guitaradot/mindcode

# 古いワークフローをリネーム（無効化）
git mv .github/workflows/deploy.yml .github/workflows/deploy.yml.disabled

# 新しいワークフローをコミット
git add .github/workflows/deploy-selfhosted.yml
git commit -m "Switch to self-hosted runner for deployment"
git push origin main
```

## 動作確認

1. ローカルで変更をコミット・プッシュ
```bash
git commit --allow-empty -m "Test self-hosted runner deployment"
git push origin main
```

2. GitHubの Actions タブでワークフローの実行を確認
   - https://github.com/KAITO06227/mindcode/actions

3. サーバー上でもログを確認できます
```bash
tail -f ~/actions-runner/_diag/Runner_*.log
```

## トラブルシューティング

### Runnerがオフラインになる

```bash
# サービスの状態確認
sudo ~/actions-runner/svc.sh status

# 再起動
sudo ~/actions-runner/svc.sh restart
```

### Dockerの権限エラー

```bash
# runnerユーザーをdockerグループに追加
sudo usermod -aG docker $(whoami)

# サービスを再起動
sudo ~/actions-runner/svc.sh restart
```

### Node.jsのバージョンエラー

```bash
# Node.js 18以上が必要
node --version

# 古い場合はアップデート
sudo dnf module install nodejs:18
```

## Runnerの管理

### ログの確認
```bash
# Runnerのログ
tail -f ~/actions-runner/_diag/Runner_*.log

# ワーカーのログ
tail -f ~/actions-runner/_diag/Worker_*.log
```

### サービスの管理
```bash
# 起動
sudo ~/actions-runner/svc.sh start

# 停止
sudo ~/actions-runner/svc.sh stop

# 再起動
sudo ~/actions-runner/svc.sh restart

# 状態確認
sudo ~/actions-runner/svc.sh status
```

### Runnerの削除

```bash
# サービスを停止
sudo ~/actions-runner/svc.sh stop

# サービスをアンインストール
sudo ~/actions-runner/svc.sh uninstall

# Runnerを削除
cd ~/actions-runner
./config.sh remove --token YOUR_REMOVAL_TOKEN
```

## セキュリティ考慮事項

- Self-hosted RunnerはGitHubリポジトリへのアクセス権を持ちます
- プライベートリポジトリでのみ使用することを推奨
- Runnerは定期的にアップデートしてください
- `.env.production`などの機密情報はGitにコミットしないでください

## メリット

✅ 外部からのSSHアクセス不要
✅ VPN接続不要
✅ 大学のファイアウォール設定に影響されない
✅ デプロイが高速（サーバー内部で実行）
✅ ネットワーク転送が最小限

## 注意事項

- サーバーの再起動後、Runnerサービスが自動起動するように設定されています
- Runnerは常時GitHubと通信するため、インターネット接続が必要です
- サーバーのメンテナンス時はRunnerを一時停止してください
