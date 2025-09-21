import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import axios from 'axios';
import { 
  FiArrowLeft, 
  FiSave,
  FiFolder,
  FiGitBranch,
  FiGitCommit
} from 'react-icons/fi';
import FileTree from '../components/FileTree';
import CodeEditor from '../components/CodeEditor';
import SmallBrowser from '../components/SmallBrowser';
import ClaudeTerminal from '../components/ClaudeTerminal';
import GitPanel from '../components/GitPanel';

const IDEContainer = styled.div`
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #1e1e1e;
`;

const Header = styled.header`
  background-color: #2d2d2d;
  padding: 0.5rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #404040;
  height: 60px;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const BackButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  color: #cccccc;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.875rem;

  &:hover {
    background-color: #404040;
    color: #ffffff;
  }
`;

const ProjectTitle = styled.h1`
  color: #ffffff;
  font-size: 1.125rem;
  margin: 0;
`;

const Button = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background-color: ${props => {
    switch(props.$variant) {
      case 'primary': return '#007acc';
      case 'success': return '#28a745';
      case 'warning': return '#ffc107';
      default: return '#404040';
    }
  }};
  color: ${props => props.$variant === 'warning' ? '#000' : '#fff'};
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
`;

const MainContent = styled.div`
  display: flex;
  height: calc(100vh - 60px);
`;

const LeftPanel = styled.div`
  width: 300px;
  background-color: #252526;
  border-right: 1px solid #404040;
  display: flex;
  flex-direction: column;
`;

const CenterPanel = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
`;

const RightPanel = styled.div`
  width: 400px;
  background-color: #252526;
  border-left: 1px solid #404040;
  display: flex;
  flex-direction: column;
`;

const PanelHeader = styled.div`
  padding: 0.75rem 1rem;
  background-color: #2d2d30;
  border-bottom: 1px solid #404040;
  color: #ffffff;
  font-size: 0.875rem;
  font-weight: 500;
`;

const EditorContainer = styled.div`
  flex: 1;
  background-color: #1e1e1e;
`;

const TerminalContainer = styled.div`
  height: 40%;
  border-bottom: 1px solid #404040;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const BrowserContainer = styled.div`
  height: 60%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const TabBar = styled.div`
  display: flex;
  background-color: #2d2d2d;
  border-bottom: 1px solid #404040;
`;

const Tab = styled.button`
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  color: ${props => props.$active ? '#ffffff' : '#cccccc'};
  cursor: pointer;
  font-size: 0.875rem;
  border-bottom: 2px solid ${props => props.$active ? '#007acc' : 'transparent'};
  transition: all 0.2s;

  &:hover {
    background-color: #404040;
    color: #ffffff;
  }
`;

const IDEPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  
  const [project, setProject] = useState(null);
  const [fileTree, setFileTree] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('files'); // 'files' or 'git'
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    fetchProject();
    fetchFileTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const fetchProject = async () => {
    try {
      console.log('Fetching project with ID:', projectId);
      const response = await axios.get(`/api/projects/${projectId}`);
      console.log('Project fetched successfully:', response.data);
      setProject(response.data);
      
      // Start Claude Code when project is loaded
      try {
        console.log('Starting Claude Code for project:', projectId);
        const claudeResponse = await axios.post(`/api/claude/start/${projectId}`);
        console.log('Claude Code response:', claudeResponse.data);
        if (claudeResponse.data.success) {
          console.log('✓ Claude Code started');
        }
      } catch (claudeError) {
        console.error('Failed to start Claude Code:', claudeError);
        console.error('Error details:', claudeError.response?.data);
        // Continue even if Claude fails to start
      }
    } catch (error) {
      console.error('Error fetching project:', error);
      console.error('Error response:', error.response);
      console.error('Error status:', error.response?.status);
      console.error('Error data:', error.response?.data);
      if (error.response?.status === 404) {
        console.log('Project not found, navigating to dashboard');
        navigate('/');
      } else if (error.response?.status === 401) {
        console.log('Unauthorized access, user may need to login');
        // Don't navigate away on auth error, let AuthContext handle it
      }
    }
  };

  const fetchFileTree = async () => {
    try {
      console.log('Fetching file tree for project ID:', projectId);
      const response = await axios.get(`/api/filesystem/${projectId}/tree`);
      console.log('File tree fetched successfully:', response.data);
      setFileTree(response.data);
      
      // 現在選択中のファイルがある場合は、そのファイルの内容を再読み込み
      if (selectedFile) {
        try {
          const fileResponse = await axios.get(`/api/files/${projectId}/${selectedFile.id}`);
          setSelectedFile(fileResponse.data);
          console.log('Current file reloaded after tree update');
        } catch (fileError) {
          console.error('Error reloading current file:', fileError);
        }
      }
      
      // Select index.html by default if available and no file is selected
      if (!selectedFile && response.data.index && response.data.index.html) {
        setSelectedFile(response.data['index.html']);
      }
    } catch (error) {
      console.error('Error fetching file tree:', error);
      console.error('File tree error response:', error.response);
      console.error('File tree error status:', error.response?.status);
      console.error('File tree error data:', error.response?.data);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (file) => {
    if (file.type === 'file') {
      try {
        const response = await axios.get(`/api/filesystem/${projectId}/files/${file.id}`);
        setSelectedFile(response.data);
      } catch (error) {
        console.error('Error fetching file content:', error);
      }
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    
    setSaving(true);
    try {
      console.log('Saving file:', {
        fileId: selectedFile.id,
        fileName: selectedFile.file_name,
        filePath: selectedFile.file_path,
        content: selectedFile.content
      });
      
      if (selectedFile.id) {
        // 既存ファイルの場合は、file_pathをそのまま使用
        await axios.post(`/api/filesystem/${projectId}/files`, {
          fileName: selectedFile.file_name,
          filePath: selectedFile.file_path,
          content: selectedFile.content
        });
      } else {
        // 新規ファイルの場合（通常このケースはないはず）
        const pathParts = selectedFile.file_path.split('/');
        pathParts.pop(); // ファイル名を除去
        const parentPath = pathParts.join('/');
        
        await axios.post(`/api/filesystem/${projectId}/files`, {
          fileName: selectedFile.file_name,
          filePath: parentPath,
          content: selectedFile.content
        });
      }
      
      return true; // Return success
    } catch (error) {
      console.error('Error saving file:', error);
      throw error; // Re-throw for CodeEditor to handle
    } finally {
      setSaving(false);
    }
  };

  const handleFileContentChange = (content) => {
    if (selectedFile) {
      setSelectedFile(prev => ({
        ...prev,
        content
      }));
    }
  };

  const handleManualCommit = async () => {
    if (!projectId || committing) return;

    const message = window.prompt('コミットメッセージを入力してください');
    if (message === null) {
      return;
    }

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      alert('コミットメッセージを入力してください。');
      return;
    }

    setCommitting(true);
    try {
      await axios.post(`/api/version-control/${projectId}/commit`, {
        message: trimmedMessage
      });

      window.dispatchEvent(new Event('mindcode:gitUpdated'));
      alert('コミットが完了しました。');
    } catch (error) {
      console.error('Manual commit error:', error);
      alert('コミットに失敗しました: ' + (error.response?.data?.message || error.message));
    } finally {
      setCommitting(false);
    }
  };


  if (loading) {
    return (
      <IDEContainer>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          IDEを読み込み中...
        </div>
      </IDEContainer>
    );
  }

  return (
    <IDEContainer>
      <Header>
        <HeaderLeft>
          <BackButton onClick={() => navigate('/')}>
            <FiArrowLeft size={16} />
            ダッシュボードに戻る
          </BackButton>
          <ProjectTitle>{project?.name}</ProjectTitle>
        </HeaderLeft>
        
        <HeaderRight>
          <Button onClick={handleManualCommit} disabled={committing}>
            <FiGitCommit size={14} />
            {committing ? 'コミット中...' : 'コミット'}
          </Button>
          <Button onClick={handleSave} disabled={!selectedFile || saving}>
            <FiSave size={14} />
            {saving ? '保存中...' : '保存'}
          </Button>
        </HeaderRight>
      </Header>

      <MainContent>
        <LeftPanel>
          <TabBar>
            <Tab 
              $active={activeTab === 'files'}
              onClick={() => setActiveTab('files')}
            >
              <FiFolder size={16} />
              <span style={{ marginLeft: '0.5rem' }}>ファイル</span>
            </Tab>
            <Tab 
              $active={activeTab === 'git'}
              onClick={() => setActiveTab('git')}
            >
              <FiGitBranch size={16} />
              <span style={{ marginLeft: '0.5rem' }}>Git</span>
            </Tab>
          </TabBar>
          
          {activeTab === 'files' ? (
            <FileTree
              fileTree={fileTree}
              selectedFile={selectedFile}
              onFileSelect={handleFileSelect}
              projectId={projectId}
              onTreeUpdate={fetchFileTree}
            />
          ) : (
            <GitPanel
              projectId={projectId}
              onRefresh={fetchFileTree}
            />
          )}
        </LeftPanel>

        <CenterPanel>
          <EditorContainer>
            <CodeEditor
              file={selectedFile}
              onChange={handleFileContentChange}
              onSave={handleSave}
              autoSave={true}
              autoSaveInterval={3000}
            />
          </EditorContainer>
        </CenterPanel>

        <RightPanel>
          {/* Terminal at top */}
          <TerminalContainer>
            <PanelHeader>ターミナル</PanelHeader>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <ClaudeTerminal 
                projectId={projectId}
                userToken={localStorage.getItem('token')}
              />
            </div>
          </TerminalContainer>
          
          {/* Preview at bottom */}
          <BrowserContainer>
            <PanelHeader>プレビュー</PanelHeader>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <SmallBrowser 
                projectId={projectId}
              />
            </div>
          </BrowserContainer>
        </RightPanel>
      </MainContent>
      
    </IDEContainer>
  );
};

export default IDEPage;
