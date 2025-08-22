#!/usr/bin/env node

/**
 * プロジェクト構造移行スクリプト
 * 既存のプロジェクトを新しいfiles/サブディレクトリ構造に移行します
 */

const fs = require('fs').promises;
const path = require('path');
const mysql = require('mysql2/promise');

async function migrateProjectStructure() {
  let connection;
  
  try {
    console.log('🔄 プロジェクト構造移行を開始します...');

    // データベース接続
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'password',
      database: process.env.DB_NAME || 'webide'
    });

    console.log('✅ データベースに接続しました');

    // 既存プロジェクトを取得
    const [projects] = await connection.execute('SELECT * FROM projects');
    console.log(`📊 ${projects.length}個のプロジェクトを確認しました`);

    if (projects.length === 0) {
      console.log('✅ 移行対象のプロジェクトがありません');
      return;
    }

    let migratedCount = 0;
    let skippedCount = 0;

    for (const project of projects) {
      const userId = project.user_id;
      const projectId = project.id;
      
      console.log(`\n📁 プロジェクト移行中: ${project.name} (${projectId})`);

      const oldProjectPath = path.join(__dirname, 'user_projects', userId.toString(), projectId);
      const newProjectPath = path.join(__dirname, 'user_projects', userId.toString(), projectId, 'files');

      try {
        // 古いプロジェクトディレクトリが存在するかチェック
        await fs.access(oldProjectPath);
        
        // プロジェクトファイルを取得
        const [files] = await connection.execute(
          'SELECT * FROM project_files WHERE project_id = ?',
          [projectId]
        );

        if (files.length === 0) {
          console.log(`⚠️  プロジェクト ${projectId} にファイルがありません - スキップ`);
          skippedCount++;
          continue;
        }

        // 新しいfiles/ディレクトリが既に存在するかチェック
        try {
          await fs.access(newProjectPath);
          console.log(`✅ プロジェクト ${projectId} は既に移行済みです - スキップ`);
          skippedCount++;
          continue;
        } catch (error) {
          // files/ディレクトリが存在しない場合は移行が必要
        }

        // 新しいディレクトリ構造を作成
        await fs.mkdir(newProjectPath, { recursive: true });

        // ファイルを移動
        const oldFiles = await fs.readdir(oldProjectPath);
        let movedFiles = 0;

        for (const fileName of oldFiles) {
          const oldFilePath = path.join(oldProjectPath, fileName);
          const newFilePath = path.join(newProjectPath, fileName);

          try {
            const stats = await fs.stat(oldFilePath);
            
            if (stats.isFile()) {
              await fs.rename(oldFilePath, newFilePath);
              movedFiles++;
              console.log(`  ✅ 移動: ${fileName}`);
            }
          } catch (fileError) {
            console.error(`  ❌ ファイル移動エラー ${fileName}:`, fileError.message);
          }
        }

        console.log(`✅ プロジェクト ${project.name}: ${movedFiles}個のファイルを移行しました`);
        migratedCount++;

      } catch (error) {
        if (error.code === 'ENOENT') {
          console.log(`⚠️  プロジェクトディレクトリが見つかりません: ${oldProjectPath}`);
          
          // データベースからファイル内容を復元
          const [files] = await connection.execute(
            'SELECT * FROM project_files WHERE project_id = ?',
            [projectId]
          );

          if (files.length > 0) {
            await fs.mkdir(newProjectPath, { recursive: true });
            
            for (const file of files) {
              const filePath = path.join(newProjectPath, file.file_path);
              await fs.mkdir(path.dirname(filePath), { recursive: true });
              await fs.writeFile(filePath, file.content || '');
              console.log(`  ✅ 復元: ${file.file_path}`);
            }
            
            console.log(`✅ プロジェクト ${project.name}: データベースから${files.length}個のファイルを復元しました`);
            migratedCount++;
          } else {
            skippedCount++;
          }
        } else {
          console.error(`❌ プロジェクト ${projectId} の移行エラー:`, error.message);
          skippedCount++;
        }
      }
    }

    console.log('\n🎉 移行完了!');
    console.log(`✅ 移行成功: ${migratedCount}個のプロジェクト`);
    console.log(`⚠️  スキップ: ${skippedCount}個のプロジェクト`);

  } catch (error) {
    console.error('❌ 移行中にエラーが発生しました:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 環境変数を読み込み
require('dotenv').config();

// スクリプト実行
if (require.main === module) {
  migrateProjectStructure()
    .then(() => {
      console.log('\n✨ 移行スクリプトが正常に完了しました');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ 移行スクリプトでエラーが発生しました:', error);
      process.exit(1);
    });
}

module.exports = { migrateProjectStructure };