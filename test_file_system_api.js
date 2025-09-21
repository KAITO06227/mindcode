// ファイル保存システムAPIのテストスクリプト
const axios = require('axios');

const API_BASE = 'http://localhost:3001/api';
let authToken = '';
let projectId = '';

// テスト用のユーザー認証（実際のトークンに置き換えてください）
async function authenticate() {
  try {
    // 実際の認証フローでトークンを取得
    console.log('⚠️  認証トークンを手動で設定してください');
    console.log('   ブラウザでログイン後、開発者ツールでJWTトークンを取得');
    process.exit(1);
  } catch (error) {
    console.error('認証エラー:', error.message);
    process.exit(1);
  }
}

// プロジェクト作成
async function createTestProject() {
  try {
    const response = await axios.post(`${API_BASE}/projects`, {
      name: 'Test File System Project',
      description: 'ファイル保存システムのテストプロジェクト'
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    projectId = response.data.id;
    console.log('✅ プロジェクト作成成功:', projectId);
  } catch (error) {
    console.error('❌ プロジェクト作成エラー:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Git初期化
async function initializeGit() {
  try {
    const response = await axios.post(`${API_BASE}/version-control/${projectId}/init`, {
      userName: 'Test User',
      userEmail: 'test@example.com'
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ Git初期化成功:', response.data.message);
  } catch (error) {
    console.error('❌ Git初期化エラー:', error.response?.data || error.message);
  }
}

// ファイル作成テスト
async function testFileCreation() {
  try {
    const fileContent = `<!DOCTYPE html>
<html>
<head>
    <title>Test File</title>
</head>
<body>
    <h1>Hello, File System!</h1>
    <p>このファイルはAPIテストで作成されました。</p>
</body>
</html>`;

    const response = await axios.post(`${API_BASE}/filesystem/${projectId}/files`, {
      fileName: 'test.html',
      filePath: '',
      content: fileContent,
      permissions: 'rw-r--r--'
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ ファイル作成成功:', {
      fileId: response.data.id,
      fileName: response.data.fileName,
      checksum: response.data.checksum
    });
    
    return response.data.id;
  } catch (error) {
    console.error('❌ ファイル作成エラー:', error.response?.data || error.message);
  }
}

// ファイル読み出しテスト
async function testFileRetrieval(fileId) {
  try {
    const response = await axios.get(`${API_BASE}/filesystem/${projectId}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ ファイル読み出し成功:', {
      fileName: response.data.file_name,
      fileSize: response.data.file_size,
      versionCount: response.data.versions.length,
      latestVersion: response.data.versions[0]?.version_number
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ ファイル読み出しエラー:', error.response?.data || error.message);
  }
}

// ファイル更新テスト
async function testFileUpdate(fileId) {
  try {
    const updatedContent = `<!DOCTYPE html>
<html>
<head>
    <title>Updated Test File</title>
</head>
<body>
    <h1>Hello, Updated File System!</h1>
    <p>このファイルは更新されました。</p>
    <p>更新時刻: ${new Date().toISOString()}</p>
</body>
</html>`;

    const response = await axios.post(`${API_BASE}/filesystem/${projectId}/files`, {
      fileName: 'test.html',
      filePath: '',
      content: updatedContent
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ ファイル更新成功:', {
      isUpdate: response.data.isUpdate,
      newChecksum: response.data.checksum
    });
  } catch (error) {
    console.error('❌ ファイル更新エラー:', error.response?.data || error.message);
  }
}

// ファイルツリー取得テスト
async function testFileTree() {
  try {
    const response = await axios.get(`${API_BASE}/filesystem/${projectId}/tree`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ ファイルツリー取得成功:', {
      fileCount: Object.keys(response.data).length,
      files: Object.keys(response.data).map(key => ({
        name: key,
        type: response.data[key].type,
        size: response.data[key].fileSize || 'N/A'
      }))
    });
  } catch (error) {
    console.error('❌ ファイルツリー取得エラー:', error.response?.data || error.message);
  }
}

// Git履歴テスト
async function testGitHistory() {
  try {
    const response = await axios.get(`${API_BASE}/version-control/${projectId}/history?limit=5`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ Git履歴取得成功:', {
      commitCount: response.data.length,
      latestCommit: response.data[0] ? {
        hash: response.data[0].hash.substring(0, 8),
        message: response.data[0].message,
        author: response.data[0].author
      } : 'No commits'
    });
  } catch (error) {
    console.error('❌ Git履歴取得エラー:', error.response?.data || error.message);
  }
}

// Git状態テスト
async function testGitStatus() {
  try {
    const response = await axios.get(`${API_BASE}/version-control/${projectId}/status`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    console.log('✅ Git状態取得成功:', {
      initialized: response.data.initialized,
      branch: response.data.branch,
      hasChanges: response.data.hasChanges,
      changeCount: response.data.changes ? response.data.changes.length : 0
    });
  } catch (error) {
    console.error('❌ Git状態取得エラー:', error.response?.data || error.message);
  }
}

// メインテスト実行
async function runTests() {
  console.log('🚀 ファイル保存システムAPIテスト開始\n');
  
  // 認証が必要な場合は手動で設定
  if (!authToken) {
    await authenticate();
  }
  
  try {
    await createTestProject();
    await initializeGit();
    
    const fileId = await testFileCreation();
    if (fileId) {
      await testFileRetrieval(fileId);
      await testFileUpdate(fileId);
    }
    
    await testFileTree();
    await testGitHistory();
    await testGitStatus();
    
    console.log('\n🎉 すべてのテストが完了しました！');
    console.log(`📁 プロジェクトID: ${projectId}`);
    
  } catch (error) {
    console.error('\n💥 テスト実行中にエラーが発生しました:', error.message);
  }
}

// コマンドライン引数でトークンを受け取る
if (process.argv[2]) {
  authToken = process.argv[2];
  runTests();
} else {
  console.log('使用方法: node test_file_system_api.js <JWT_TOKEN>');
  console.log('JWTトークンはブラウザでログイン後、開発者ツールから取得してください。');
}
