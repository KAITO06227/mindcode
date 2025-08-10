import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import {
  FiArrowLeft,
  FiUsers,
  FiFolder,
  FiExternalLink,
  FiEye,
  FiEdit,
  FiTrash2,
  FiLogOut
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

const TabContainer = styled.div`
  display: flex;
  gap: 2px;
  margin-bottom: 2rem;
`;

const Tab = styled.button`
  padding: 0.75rem 1.5rem;
  background-color: ${props => props.active ? '#007acc' : '#2d2d2d'};
  color: ${props => props.active ? '#ffffff' : '#cccccc'};
  border: none;
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  font-size: 0.875rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;

  &:hover {
    background-color: ${props => props.active ? '#007acc' : '#404040'};
  }
`;

const ContentArea = styled.div`
  background-color: #2d2d2d;
  border-radius: 0 8px 8px 8px;
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

const AdminPage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
    } else if (activeTab === 'projects') {
      fetchProjects();
    }
  }, [activeTab]);

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

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/admin/projects');
      setProjects(response.data);
    } catch (error) {
      console.error('Error fetching projects:', error);
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
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('ユーザーの削除に失敗しました');
    }
  };

  const viewProject = (projectId) => {
    navigate(`/ide/${projectId}`);
  };

  const viewProjectPreview = async (projectId) => {
    try {
      const response = await axios.get(`/api/admin/projects/${projectId}/preview`);
      const previewUrl = `${window.location.origin}${response.data.previewUrl}`;
      window.open(previewUrl, '_blank');
    } catch (error) {
      console.error('Error opening project preview:', error);
      alert('プロジェクトのプレビューを開けませんでした');
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString();
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
        <TabContainer>
          <Tab 
            active={activeTab === 'users'} 
            onClick={() => setActiveTab('users')}
          >
            <FiUsers size={16} />
            ユーザー管理
          </Tab>
          <Tab 
            active={activeTab === 'projects'} 
            onClick={() => setActiveTab('projects')}
          >
            <FiFolder size={16} />
            プロジェクト一覧
          </Tab>
        </TabContainer>

        <ContentArea>
          {activeTab === 'users' && (
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
                    {users.map(user => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <img 
                              src={user.avatar_url} 
                              alt={user.name} 
                              style={{ width: '24px', height: '24px', borderRadius: '50%' }}
                            />
                            {user.name}
                          </div>
                        </TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <Select
                            value={user.role}
                            onChange={(e) => updateUserRole(user.id, e.target.value)}
                          >
                            <option value="student">学生</option>
                            <option value="teacher">教師</option>
                          </Select>
                        </TableCell>
                        <TableCell>{formatDate(user.created_at)}</TableCell>
                        <TableCell>
                          <ActionButton
                            onClick={() => deleteUser(user.id)}
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
          )}

          {activeTab === 'projects' && (
            <div>
              <h3 style={{ color: '#ffffff', marginBottom: '1rem' }}>
                プロジェクト一覧 ({projects.length} projects)
              </h3>
              
              {loading ? (
                <div style={{ color: '#cccccc', textAlign: 'center', padding: '2rem' }}>
                  プロジェクトを読み込み中...
                </div>
              ) : (
                projects.map(project => (
                  <ProjectCard key={project.id}>
                    <ProjectInfo>
                      <ProjectTitle>{project.name}</ProjectTitle>
                      <ProjectMeta>
                        <span>所有者: {project.user_name} ({project.user_email})</span>
                        <span>更新: {formatDate(project.updated_at)}</span>
                        {project.git_url && <span>Git: 接続済み</span>}
                      </ProjectMeta>
                    </ProjectInfo>
                    <ProjectActions>
                      <ActionButton
                        onClick={() => viewProject(project.id)}
                        title="プロジェクトを編集"
                      >
                        <FiEdit size={16} />
                      </ActionButton>
                      <ActionButton
                        onClick={() => viewProjectPreview(project.id)}
                        title="プロジェクトをプレビュー"
                      >
                        <FiEye size={16} />
                      </ActionButton>
                      <ActionButton
                        onClick={() => viewProjectPreview(project.id)}
                        title="新しいタブで開く"
                      >
                        <FiExternalLink size={16} />
                      </ActionButton>
                    </ProjectActions>
                  </ProjectCard>
                ))
              )}
            </div>
          )}
        </ContentArea>
      </Main>
    </AdminContainer>
  );
};

export default AdminPage;