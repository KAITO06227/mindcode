#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Claude CLI実行時のカレントディレクトリがプロジェクトルート
const projectRoot = process.cwd();
const mindcodeDir = path.join(projectRoot, '.mindcode');

// デバッグログ（グローバルな場所にも書き込んで確認用）
const globalLogFile = '/tmp/claude-hook-debug.log';
const logFile = path.join(mindcodeDir, 'hook-debug.log');

try {
  // グローバルログ（常に書き込める場所）
  fs.appendFileSync(globalLogFile, `\n[${new Date().toISOString()}] Hook script started\n`);
  fs.appendFileSync(globalLogFile, `[${new Date().toISOString()}] Project root: ${projectRoot}\n`);
  fs.appendFileSync(globalLogFile, `[${new Date().toISOString()}] Process argv: ${process.argv.join(' ')}\n`);

  // プロジェクト固有のログ
  fs.mkdirSync(mindcodeDir, { recursive: true });
  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] Hook script started\n`);
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] Project root: ${projectRoot}\n`);
} catch (err) {
  fs.appendFileSync(globalLogFile, `[${new Date().toISOString()}] Error creating logs: ${err.message}\n`);
}

// stdin から JSON データを読み込む
let inputData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  fs.appendFileSync(globalLogFile, `[${new Date().toISOString()}] Received data chunk: ${chunk.length} bytes\n`);
  if (fs.existsSync(logFile)) {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] Received data chunk: ${chunk.length} bytes\n`);
  }
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    fs.appendFileSync(globalLogFile, `[${new Date().toISOString()}] stdin ended, processing data\n`);
    if (fs.existsSync(logFile)) {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] stdin ended, processing data\n`);
    }

    const data = JSON.parse(inputData);
    const prompt = data.prompt || '';
    const timestamp = Date.now();

    fs.appendFileSync(globalLogFile, `[${new Date().toISOString()}] Parsed prompt: "${prompt}"\n`);
    if (fs.existsSync(logFile)) {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] Parsed prompt: "${prompt}"\n`);
    }

    // .mindcodeディレクトリが存在しない場合は作成
    if (!fs.existsSync(mindcodeDir)) {
      fs.mkdirSync(mindcodeDir, { recursive: true });
    }

    // プロンプトデータを保存
    const outputPath = path.join(mindcodeDir, 'prompt-data.json');
    const output = {
      prompt: prompt,
      timestamp: timestamp,
      sessionId: data.session_id || null
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

    fs.appendFileSync(globalLogFile, `[${new Date().toISOString()}] Successfully wrote prompt-data.json to ${outputPath}\n`);
    if (fs.existsSync(logFile)) {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] Successfully wrote prompt-data.json to ${outputPath}\n`);
    }
  } catch (error) {
    fs.appendFileSync(globalLogFile, `[${new Date().toISOString()}] Error: ${error.message}\n`);
    if (fs.existsSync(logFile)) {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] Error: ${error.message}\n`);
    }
    console.error('[HOOK] Failed to process prompt:', error.message);
    process.exit(1);
  }
});
