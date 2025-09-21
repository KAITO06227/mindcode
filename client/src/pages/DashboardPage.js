import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { FiPlus, FiFolder, FiSettings, FiLogOut, FiGithub, FiTrash2 } from 'react-icons/fi';
import CreateProjectModal from '../components/CreateProjectModal';

const DashboardContainer = styled.div`
  min-height: 100vh;
  background-color: #1e1e1e;
`;

const Header = styled.header`
  background-color: #2d2d2d;
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #404040;
`;

const Logo = styled.h1`
  color: #007acc;
  font-size: 1.5rem;
  font-weight: bold;
`;

const UserSection = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
`;

const UserInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #ffffff;
`;

const Button = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background-color: ${props => props.$variant === 'primary' ? '#007acc' : '#404040'};
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;

  &:hover {
    background-color: ${props => props.$variant === 'primary' ? '#005a9e' : '#555'};
  }
`;

const Main = styled.main`
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
`;

const WelcomeSection = styled.div`
  margin-bottom: 2rem;
`;

const WelcomeTitle = styled.h2`
  color: #ffffff;
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
`;

const WelcomeText = styled.p`
  color: #cccccc;
  font-size: 1rem;
`;

const ProjectsSection = styled.div`
  margin-bottom: 2rem;
`;

const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
`;

const SectionTitle = styled.h3`
  color: #ffffff;
  font-size: 1.25rem;
`;

const ProjectsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
`;

const ProjectCard = styled.div`
  background-color: #2d2d2d;
  border: 1px solid #404040;
  border-radius: 8px;
  padding: 1.5rem;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;

  &:hover {
    border-color: #007acc;
    transform: translateY(-2px);
  }
`;

const ProjectActions = styled.div`
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: none;
  background-color: #404040;
  border-radius: 4px;
  border: 1px solid #555;
  
  ${ProjectCard}:hover & {
    display: block;
  }
`;

const ActionButton = styled.button`
  background: none;
  border: none;
  color: #cccccc;
  padding: 0.5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  border-radius: 4px;
  width: 100%;
  text-align: left;

  &:hover {
    background-color: #555;
    color: #ffffff;
  }

  &.danger:hover {
    background-color: #dc3545;
    color: #ffffff;
  }
`;

const ProjectTitle = styled.h4`
  color: #ffffff;
  font-size: 1.125rem;
  margin-bottom: 0.5rem;
`;

const ProjectDescription = styled.p`
  color: #cccccc;
  font-size: 0.875rem;
  margin-bottom: 1rem;
  line-height: 1.4;
`;

const ProjectMeta = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #888888;
  font-size: 0.75rem;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 3rem 1rem;
  color: #888888;
`;

const EmptyIcon = styled.div`
  font-size: 3rem;
  margin-bottom: 1rem;
`;

const DashboardPage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await axios.get('/api/projects');
      setProjects(response.data);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProjectClick = (projectId) => {
    navigate(`/ide/${projectId}`);
  };

  const handleCreateProject = async (projectData) => {
    try {
      const response = await axios.post('/api/projects', projectData);
      setProjects(prev => [response.data, ...prev]);
      setShowCreateModal(false);
    } catch (error) {
      console.error('Error creating project:', error);
    }
  };

  const handleDeleteProject = async (projectId, projectName, event) => {
    event.stopPropagation(); // Prevent card click
    
    const confirmMessage = `本当にプロジェクト「${projectName}」を削除しますか？\n\n⚠️ この操作は取り消すことができません。\n・すべてのファイルが削除されます\n・Git履歴も削除されます\n・関連するデータもすべて削除されます`;
    
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      await axios.delete(`/api/projects/${projectId}`);
      setProjects(prev => prev.filter(p => p.id !== projectId));
      alert(`プロジェクト「${projectName}」を削除しました。`);
    } catch (error) {
      console.error('Error deleting project:', error);
      alert('プロジェクトの削除に失敗しました: ' + (error.response?.data?.message || error.message));
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <DashboardContainer>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <div>読み込み中...</div>
        </div>
      </DashboardContainer>
    );
  }

  return (
    <DashboardContainer>
      <Header>
        <Logo>MindCode</Logo>
        <UserSection>
          <UserInfo>
            <span>{user?.name}</span>
            <span style={{ color: '#888', fontSize: '0.75rem' }}>
              ({user?.role})
            </span>
          </UserInfo>
          
          {user?.role === 'teacher' && (
            <Button onClick={() => navigate('/admin')}>
              <FiSettings size={16} />
              管理
            </Button>
          )}
          
          <Button onClick={logout}>
            <FiLogOut size={16} />
            ログアウト
          </Button>
        </UserSection>
      </Header>

      <Main>
        <WelcomeSection>
          <WelcomeTitle>MindCodeへようこそ</WelcomeTitle>
          <WelcomeText>
            新しいプロジェクトを作成するか、既存のプロジェクトを継続してください。
          </WelcomeText>
        </WelcomeSection>

        <ProjectsSection>
          <SectionHeader>
            <SectionTitle>あなたのプロジェクト</SectionTitle>
            <Button $variant="primary" onClick={() => setShowCreateModal(true)}>
              <FiPlus size={16} />
              新規プロジェクト
            </Button>
          </SectionHeader>

          {projects.length === 0 ? (
            <EmptyState>
              <EmptyIcon>
                <FiFolder size={48} />
              </EmptyIcon>
              <h3 style={{ color: '#ffffff', marginBottom: '0.5rem' }}>まだプロジェクトがありません</h3>
              <p>最初のプロジェクトを作成して始めましょう！</p>
            </EmptyState>
          ) : (
            <ProjectsGrid>
              {projects.map(project => (
                <ProjectCard 
                  key={project.id}
                  onClick={() => handleProjectClick(project.id)}
                >
                  <ProjectActions>
                    <ActionButton 
                      className="danger"
                      onClick={(e) => handleDeleteProject(project.id, project.name, e)}
                      title="プロジェクトを削除"
                    >
                      <FiTrash2 size={14} />
                      削除
                    </ActionButton>
                  </ProjectActions>
                  
                  <ProjectTitle>{project.name}</ProjectTitle>
                  <ProjectDescription>
                    {project.description || '説明がありません'}
                  </ProjectDescription>
                  <ProjectMeta>
                    <span>更新日 {formatDate(project.updated_at)}</span>
                    {project.git_url && (
                      <FiGithub title="Gitリポジトリ接続済み" />
                    )}
                  </ProjectMeta>
                </ProjectCard>
              ))}
            </ProjectsGrid>
          )}
        </ProjectsSection>
      </Main>

      {showCreateModal && (
        <CreateProjectModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateProject}
        />
      )}
    </DashboardContainer>
  );
};

export default DashboardPage;
