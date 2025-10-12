import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import {
  FiArrowLeft,
  FiFolder,
  FiEye,
  FiEdit,
  FiTrash2,
  FiLogOut,
  FiMessageSquare,
  FiX
} from 'react-icons/fi';

const AdminContainer = styled.div`
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

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
`;

const BackButton = styled(Link)`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #cccccc;
  text-decoration: none;
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.875rem;

  &:hover {
    background-color: #404040;
    color: #ffffff;
  }
`;

const Title = styled.h1`
  color: #ffffff;
  font-size: 1.5rem;
  margin: 0;
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

const Avatar = styled.img`
  width: 32px;
  height: 32px;
  border-radius: 50%;
`;

const Button = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background-color: ${props => props.$variant === 'danger' ? '#dc3545' : '#404040'};
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;

  &:hover {
    background-color: ${props => props.$variant === 'danger' ? '#c82333' : '#555'};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Main = styled.main`
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
`;

const ContentArea = styled.div`
  background-color: #2d2d2d;
  border-radius: 8px;
  padding: 1.5rem;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const TableHeader = styled.th`
  text-align: left;
  padding: 0.75rem;
  color: #ffffff;
  font-weight: 500;
  border-bottom: 1px solid #404040;
`;

const TableRow = styled.tr`
  &:hover {
    background-color: #404040;
  }
`;

const TableCell = styled.td`
  padding: 0.75rem;
  color: #cccccc;
  border-bottom: 1px solid #333;
  vertical-align: middle;
`;

const ActionButton = styled.button`
  background: none;
  border: none;
  color: #cccccc;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  margin: 0 0.25rem;

  &:hover {
    background-color: #555;
    color: #ffffff;
  }
`;

const RoleBadge = styled.span`
  background-color: ${props => props.role === 'teacher' ? '#28a745' : '#6c757d'};
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  font-size: 0.75rem;
  text-transform: capitalize;
`;

const Select = styled.select`
  background-color: #3c3c3c;
  border: 1px solid #555;
  color: #ffffff;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;

  &:focus {
    outline: none;
    border-color: #007acc;
  }
`;

const ProjectCard = styled.div`
  background-color: #404040;
  border-radius: 8px;
  padding: 1rem;
  margin: 0.5rem 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ProjectInfo = styled.div`
  flex: 1;
`;

const ProjectTitle = styled.h4`
  color: #ffffff;
  margin: 0 0 0.5rem 0;
`;

const ProjectMeta = styled.div`
  color: #888;
  font-size: 0.75rem;
  display: flex;
  gap: 1rem;
`;

const ProjectActions = styled.div`
  display: flex;
  gap: 0.5rem;
`;

const SelectedUserSection = styled.div`
  margin-top: 2rem;
`;

const SectionTitle = styled.h3`
  color: #ffffff;
  margin-bottom: 1rem;
`;

const EmptyMessage = styled.div`
  color: #cccccc;
  padding: 1rem;
  background-color: #333;
  border-radius: 6px;
`;

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  z-index: 2000;
`;

const ModalContent = styled.div`
  background-color: #2d2d2d;
  border-radius: 8px;
  width: 90%;
  max-width: 720px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ModalHeader = styled.div`
  padding: 1rem;
  border-bottom: 1px solid #3a3a3a;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #ffffff;
`;

const ModalBody = styled.div`
  padding: 1rem;
  overflow-y: auto;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: #cccccc;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;

  &:hover {
    background-color: #555;
    color: #ffffff;
  }
`;

const PromptList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`;

const PromptItem = styled.div`
  background-color: #3a3a3a;
  border-radius: 6px;
  padding: 0.75rem;
  color: #e0e0e0;
`;

const PromptMeta = styled.div`
  font-size: 0.75rem;
  color: #9e9e9e;
  margin-bottom: 0.5rem;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
`;

const getApiOrigin = () => {
  const envOrigin = process.env.REACT_APP_API_ORIGIN || process.env.REACT_APP_BACKEND_URL;
  if (envOrigin) {
    return envOrigin;
  }

  if (window.location.origin.includes('3000')) {
    return window.location.origin.replace('3000', '3001');
  }

  return window.location.origin;
};

const AdminPage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userProjects, setUserProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [promptLogs, setPromptLogs] = useState([]);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptProject, setPromptProject] = useState(null);
  const [promptError, setPromptError] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/admin/users');
      setUsers(response.data);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateUserRole = async (userId, newRole) => {
    try {
      await axios.patch(`/api/admin/users/${userId}/role`, { role: newRole });
      setUsers(users.map(user => 
        user.id === userId ? { ...user, role: newRole } : user
      ));
      if (selectedUser?.id === userId) {
        setSelectedUser({ ...selectedUser, role: newRole });
      }
    } catch (error) {
      console.error('Error updating user role:', error);
      alert('ユーザーの役割更新に失敗しました');
    }
  };

  const deleteUser = async (userId) => {
    if (!window.confirm('このユーザーを削除しますか？')) {
      return;
    }

    try {
      await axios.delete(`/api/admin/users/${userId}`);
      setUsers(users.filter(user => user.id !== userId));
      if (selectedUser?.id === userId) {
        setSelectedUser(null);
        setUserProjects([]);
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('ユーザーの削除に失敗しました');
    }
  };

  const handleViewProjects = async (targetUser) => {
    if (selectedUser?.id === targetUser.id) {
      setSelectedUser(null);
      setUserProjects([]);
      return;
    }

    setSelectedUser(targetUser);
    setProjectsLoading(true);
    setUserProjects([]);

    try {
      const response = await axios.get(`/api/admin/users/${targetUser.id}/projects`);
      setUserProjects(response.data);
    } catch (error) {
      console.error('Error fetching user projects:', error);
      alert('プロジェクトの取得に失敗しました');
    } finally {
      setProjectsLoading(false);
    }
  };

  const viewProject = (projectId) => {
    navigate(`/ide/${projectId}`);
  };

  const viewProjectPreview = (project) => {
    if (!project?.id || !selectedUser?.email) {
      alert('プレビュー用の情報が不足しています');
      return;
    }

    try {
      const baseOrigin = getApiOrigin();
      const encodedEmail = encodeURIComponent(selectedUser.email);
      const encodedProjectId = encodeURIComponent(project.id);
      const url = new URL(`/user_projects/${encodedEmail}/${encodedProjectId}/index.html`, baseOrigin);
      window.open(url.toString(), '_blank', 'noopener');
    } catch (error) {
      console.error('Error building project preview URL:', error);
      alert('プロジェクトのプレビュー URL を生成できませんでした');
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatDateTime = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const closePromptModal = () => {
    setPromptModalOpen(false);
    setPromptLogs([]);
    setPromptProject(null);
    setPromptError('');
  };

  const openPromptHistory = async (project) => {
    setPromptModalOpen(true);
    setPromptProject(project);
    setPromptLoading(true);
    setPromptError('');
    setPromptLogs([]);

    try {
      const response = await axios.get(`/api/admin/projects/${project.id}/claude-prompts`);
      if (response.data?.project) {
        setPromptProject(prev => ({ ...prev, ...response.data.project }));
      }
      setPromptLogs(response.data?.prompts || []);
    } catch (error) {
      console.error('Error fetching Claude prompt history:', error);
      setPromptError('プロンプト履歴の取得に失敗しました');
    } finally {
      setPromptLoading(false);
    }
  };

  return (
    <AdminContainer>
      <Header>
        <HeaderLeft>
          <BackButton to="/">
            <FiArrowLeft size={16} />
            ダッシュボードに戻る
          </BackButton>
          <Title>管理パネル</Title>
        </HeaderLeft>
        
        <UserSection>
          <UserInfo>
            <Avatar src={user?.avatar_url} alt={user?.name} />
            <span>{user?.name}</span>
            <RoleBadge role={user?.role}>{user?.role}</RoleBadge>
          </UserInfo>
          
          <Button onClick={logout}>
            <FiLogOut size={16} />
            ログアウト
          </Button>
        </UserSection>
      </Header>

      <Main>
        <ContentArea>
          <div>
            <h3 style={{ color: '#ffffff', marginBottom: '1rem' }}>
              ユーザー管理 ({users.length}人)
            </h3>

            {loading ? (
              <div style={{ color: '#cccccc', textAlign: 'center', padding: '2rem' }}>
                ユーザーを読み込み中...
              </div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <TableHeader>ユーザー</TableHeader>
                    <TableHeader>メール</TableHeader>
                    <TableHeader>役割</TableHeader>
                    <TableHeader>登録日</TableHeader>
                    <TableHeader>操作</TableHeader>
                  </tr>
                </thead>
                <tbody>
                  {users.map(currentUser => (
                    <TableRow key={currentUser.id}>
                      <TableCell>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <img
                            src={currentUser.avatar_url}
                            alt={currentUser.name}
                            style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                          />
                          {currentUser.name}
                        </div>
                      </TableCell>
                      <TableCell>{currentUser.email}</TableCell>
                      <TableCell>
                        <Select
                          value={currentUser.role}
                          onChange={(e) => updateUserRole(currentUser.id, e.target.value)}
                        >
                          <option value="student">学生</option>
                          <option value="teacher">教師</option>
                        </Select>
                      </TableCell>
                      <TableCell>{formatDate(currentUser.created_at)}</TableCell>
                      <TableCell>
                        <ActionButton
                          onClick={() => handleViewProjects(currentUser)}
                          title="このユーザーのプロジェクトを見る"
                        >
                          <FiFolder size={14} />
                        </ActionButton>
                        <ActionButton
                          onClick={() => deleteUser(currentUser.id)}
                          title="ユーザーを削除"
                        >
                          <FiTrash2 size={14} />
                        </ActionButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            )}
          </div>

          {selectedUser && (
            <SelectedUserSection>
              <SectionTitle>
                {selectedUser.name} さんのプロジェクト ({userProjects.length}件)
              </SectionTitle>

              {projectsLoading ? (
                <div style={{ color: '#cccccc', textAlign: 'center', padding: '2rem' }}>
                  プロジェクトを読み込み中...
                </div>
              ) : userProjects.length === 0 ? (
                <EmptyMessage>プロジェクトがありません。</EmptyMessage>
              ) : (
                userProjects.map(project => (
                  <ProjectCard key={project.id}>
                    <ProjectInfo>
                      <ProjectTitle>{project.name}</ProjectTitle>
                      <ProjectMeta>
                        <span>更新: {formatDate(project.updated_at)}</span>
                        {project.git_url && <span>トリップコード: 接続済み</span>}
                      </ProjectMeta>
                    </ProjectInfo>
                    <ProjectActions>
                      <Button
                        onClick={() => openPromptHistory(project)}
                        title="Claudeプロンプト履歴"
                      >
                        <FiMessageSquare size={16} />
                        プロンプト
                      </Button>
                      <Button
                        onClick={() => viewProjectPreview(project)}
                        title="プロジェクトを表示"
                      >
                        <FiEye size={16} />
                        表示
                      </Button>
                      <Button
                        onClick={() => viewProject(project.id)}
                        title="プロジェクトを編集"
                      >
                        <FiEdit size={16} />
                        編集
                      </Button>
                    </ProjectActions>
                  </ProjectCard>
                ))
              )}
            </SelectedUserSection>
          )}
        </ContentArea>
      </Main>

      {promptModalOpen && (
        <ModalOverlay onClick={closePromptModal}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <div>
                <div style={{ fontSize: '0.875rem', color: '#aaaaaa' }}>Claude プロンプト履歴</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                  {promptProject?.name || 'プロジェクト'}
                </div>
              </div>
              <CloseButton onClick={closePromptModal}>
                <FiX size={18} />
              </CloseButton>
            </ModalHeader>
            <ModalBody>
              {promptLoading ? (
                <div style={{ color: '#cccccc', textAlign: 'center', padding: '1.5rem' }}>
                  プロンプト履歴を読み込み中...
                </div>
              ) : promptError ? (
                <EmptyMessage>{promptError}</EmptyMessage>
              ) : promptLogs.length === 0 ? (
                <EmptyMessage>保存されたプロンプトはありません。</EmptyMessage>
              ) : (
                <PromptList>
                  {promptLogs.map((log) => (
                    <PromptItem key={log.id}>
                      <PromptMeta>
                        <span>{log.user_name || '不明なユーザー'} ({log.user_email})</span>
                        <span>{formatDateTime(log.created_at)}</span>
                      </PromptMeta>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{log.prompt}</div>
                    </PromptItem>
                  ))}
                </PromptList>
              )}
            </ModalBody>
          </ModalContent>
        </ModalOverlay>
      )}
    </AdminContainer>
  );
};

export default AdminPage;
