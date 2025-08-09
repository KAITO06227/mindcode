import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { 
  FiArrowLeft, 
  FiSave, 
  FiPlay, 
  FiGitBranch, 
  FiGitCommit, 
  FiTerminal,
  FiSettings
} from 'react-icons/fi';
import FileTree from '../components/FileTree';
import CodeEditor from '../components/CodeEditor';
import SmallBrowser from '../components/SmallBrowser';
import Terminal from '../components/Terminal';
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
    switch(props.variant) {
      case 'primary': return '#007acc';
      case 'success': return '#28a745';
      case 'warning': return '#ffc107';
      default: return '#404040';
    }
  }};
  color: ${props => props.variant === 'warning' ? '#000' : '#fff'};
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

const BrowserContainer = styled.div`
  height: 60%;
  border-bottom: 1px solid #404040;
`;

const TerminalContainer = styled.div`
  height: 40%;
`;

const TabBar = styled.div`
  display: flex;
  background-color: #2d2d2d;
  border-bottom: 1px solid #404040;
`;

const Tab = styled.button`
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  color: ${props => props.active ? '#ffffff' : '#cccccc'};
  cursor: pointer;
  font-size: 0.875rem;
  border-bottom: 2px solid ${props => props.active ? '#007acc' : 'transparent'};

  &:hover {
    background-color: #404040;
    color: #ffffff;
  }
`;

const IDEPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [project, setProject] = useState(null);
  const [fileTree, setFileTree] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const [activeRightTab, setActiveRightTab] = useState('preview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProject();
    fetchFileTree();
  }, [projectId]);

  const fetchProject = async () => {
    try {
      const response = await axios.get(`/api/projects/${projectId}`);
      setProject(response.data);
    } catch (error) {
      console.error('Error fetching project:', error);
      if (error.response?.status === 404) {
        navigate('/');
      }
    }
  };

  const fetchFileTree = async () => {
    try {
      const response = await axios.get(`/api/files/tree/${projectId}`);
      setFileTree(response.data);
      
      // Select index.html by default if available
      if (response.data.index && response.data.index.html) {
        setSelectedFile(response.data['index.html']);
      }
    } catch (error) {
      console.error('Error fetching file tree:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (file) => {
    if (file.type === 'file') {
      try {
        const response = await axios.get(`/api/files/${projectId}/${file.id}`);
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
      await axios.put(`/api/files/${projectId}/${selectedFile.id}`, {
        content: selectedFile.content
      });
    } catch (error) {
      console.error('Error saving file:', error);
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

  const handleRunProject = () => {
    // This would trigger the preview update
    setActiveRightTab('preview');
  };

  if (loading) {
    return (
      <IDEContainer>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          Loading IDE...
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
            Back to Dashboard
          </BackButton>
          <ProjectTitle>{project?.name}</ProjectTitle>
        </HeaderLeft>
        
        <HeaderRight>
          <Button onClick={handleSave} disabled={!selectedFile || saving}>
            <FiSave size={14} />
            {saving ? 'Saving...' : 'Save'}
          </Button>
          
          <Button variant="success" onClick={handleRunProject}>
            <FiPlay size={14} />
            Run
          </Button>
          
          <Button onClick={() => setActiveRightTab('git')}>
            <FiGitBranch size={14} />
            Git
          </Button>
          
          <Button onClick={() => setActiveRightTab('terminal')}>
            <FiTerminal size={14} />
            Terminal
          </Button>
        </HeaderRight>
      </Header>

      <MainContent>
        <LeftPanel>
          <PanelHeader>Explorer</PanelHeader>
          <FileTree
            fileTree={fileTree}
            selectedFile={selectedFile}
            onFileSelect={handleFileSelect}
            projectId={projectId}
            onTreeUpdate={fetchFileTree}
          />
        </LeftPanel>

        <CenterPanel>
          <EditorContainer>
            <CodeEditor
              file={selectedFile}
              onChange={handleFileContentChange}
            />
          </EditorContainer>
        </CenterPanel>

        <RightPanel>
          <TabBar>
            <Tab 
              active={activeRightTab === 'preview'} 
              onClick={() => setActiveRightTab('preview')}
            >
              Preview
            </Tab>
            <Tab 
              active={activeRightTab === 'git'} 
              onClick={() => setActiveRightTab('git')}
            >
              Git
            </Tab>
            <Tab 
              active={activeRightTab === 'terminal'} 
              onClick={() => setActiveRightTab('terminal')}
            >
              Terminal
            </Tab>
          </TabBar>

          {activeRightTab === 'preview' && (
            <BrowserContainer>
              <SmallBrowser projectId={projectId} />
            </BrowserContainer>
          )}

          {activeRightTab === 'git' && (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <GitPanel projectId={projectId} />
            </div>
          )}

          {activeRightTab === 'terminal' && (
            <TerminalContainer>
              <Terminal projectId={projectId} />
            </TerminalContainer>
          )}
        </RightPanel>
      </MainContent>
    </IDEContainer>
  );
};

export default IDEPage;