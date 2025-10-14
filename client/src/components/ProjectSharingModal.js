import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import styled from 'styled-components';
import { FiX, FiUserPlus, FiUsers, FiMail, FiTrash2 } from 'react-icons/fi';
import axios from 'axios';

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
`;

const ModalContent = styled.div`
  background-color: #252526;
  border-radius: 8px;
  padding: 1.5rem;
  width: 90%;
  max-width: 700px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
`;

const ModalTitle = styled.h2`
  color: #ffffff;
  font-size: 1.25rem;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: #cccccc;
  cursor: pointer;
  padding: 0.25rem;
  display: flex;
  align-items: center;
  border-radius: 4px;

  &:hover {
    background-color: #404040;
    color: #ffffff;
  }
`;

const TabContainer = styled.div`
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid #3c3c3c;
`;

const Tab = styled.button`
  background: none;
  border: none;
  color: ${props => props.$active ? '#ffffff' : '#cccccc'};
  padding: 0.75rem 1rem;
  cursor: pointer;
  font-size: 0.9rem;
  border-bottom: 2px solid ${props => props.$active ? '#007acc' : 'transparent'};
  transition: all 0.2s;

  &:hover {
    color: #ffffff;
  }
`;

const Section = styled.div`
  margin-bottom: 1.5rem;
`;

const SectionTitle = styled.h3`
  color: #ffffff;
  font-size: 1rem;
  margin: 0 0 1rem 0;
`;

const InviteForm = styled.form`
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
`;

const Input = styled.input`
  flex: 1;
  background-color: #3c3c3c;
  border: 1px solid #555555;
  color: #ffffff;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  font-size: 0.875rem;

  &:focus {
    outline: none;
    border-color: #007acc;
  }

  &::placeholder {
    color: #999999;
  }
`;

const Button = styled.button`
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 0.5rem;

  ${props => props.$primary ? `
    background-color: #007acc;
    color: #ffffff;
    &:hover:not(:disabled) {
      background-color: #005a9e;
    }
  ` : props.$danger ? `
    background-color: #c53030;
    color: #ffffff;
    &:hover:not(:disabled) {
      background-color: #9b2c2c;
    }
  ` : `
    background-color: #3c3c3c;
    color: #cccccc;
    &:hover {
      background-color: #4a4a4a;
    }
  `}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const MemberList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const MemberItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #1e1e1e;
  padding: 0.75rem;
  border-radius: 4px;
  border: 1px solid #3c3c3c;
`;

const MemberInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
`;

const Avatar = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: #007acc;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-weight: bold;
  font-size: 0.875rem;
`;

const MemberDetails = styled.div`
  display: flex;
  flex-direction: column;
`;

const MemberName = styled.span`
  color: #ffffff;
  font-size: 0.9rem;
`;

const MemberEmail = styled.span`
  color: #999999;
  font-size: 0.75rem;
`;

const MemberActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const RoleBadge = styled.span`
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  background-color: ${props =>
    props.$role === 'owner' ? '#2d3748' :
    props.$role === 'editor' ? '#2c5282' :
    '#4a5568'
  };
  color: ${props =>
    props.$role === 'owner' ? '#fbbf24' :
    props.$role === 'editor' ? '#63b3ed' :
    '#cbd5e0'
  };
`;

const InvitationItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #1e1e1e;
  padding: 0.75rem;
  border-radius: 4px;
  border: 1px solid #3c3c3c;
  margin-bottom: 0.5rem;
`;

const InvitationInfo = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`;

const InvitationEmail = styled.span`
  color: #ffffff;
  font-size: 0.9rem;
`;

const InvitationStatus = styled.span`
  color: #999999;
  font-size: 0.75rem;
`;

const InvitationActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const IconButton = styled.button`
  background: none;
  border: none;
  color: #cccccc;
  cursor: pointer;
  padding: 0.25rem;
  display: flex;
  align-items: center;
  border-radius: 4px;

  &:hover {
    background-color: #404040;
    color: #ffffff;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const EmptyMessage = styled.p`
  color: #999999;
  text-align: center;
  padding: 2rem;
  font-size: 0.875rem;
`;

const ErrorMessage = styled.div`
  background-color: #c53030;
  color: #ffffff;
  padding: 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  font-size: 0.875rem;
`;

const SuccessMessage = styled.div`
  background-color: #38a169;
  color: #ffffff;
  padding: 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  font-size: 0.875rem;
`;

const ProjectSharingModal = ({ isOpen, onClose, projectId, currentUserRole }) => {
  const [activeTab, setActiveTab] = useState('members');
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (isOpen && projectId) {
      fetchMembers();
      fetchInvitations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, projectId]);

  const fetchMembers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`http://localhost:3001/api/projects/${projectId}/members`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMembers(response.data.members || []);
    } catch (error) {
      console.error('Failed to fetch members:', error);
      setError('メンバー一覧の取得に失敗しました');
    }
  };

  const fetchInvitations = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`http://localhost:3001/api/projects/${projectId}/invitations`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setInvitations(response.data.invitations || []);
    } catch (error) {
      console.error('Failed to fetch invitations:', error);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!inviteEmail.trim()) {
      setError('メールアドレスを入力してください');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      await axios.post(
        `http://localhost:3001/api/projects/${projectId}/invitations`,
        {
          email: inviteEmail,
          role: 'viewer'  // デフォルトでviewer（実質的にeditorと同等の権限）
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      setSuccess(`${inviteEmail} に招待を送信しました`);
      setInviteEmail('');
      fetchInvitations();
    } catch (error) {
      console.error('Failed to send invitation:', error);
      setError(error.response?.data?.error || '招待の送信に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteInvitation = async (invitationId) => {
    if (!window.confirm('この招待を削除しますか？')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(
        `http://localhost:3001/api/projects/${projectId}/invitations/${invitationId}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      setSuccess('招待を削除しました');
      fetchInvitations();
    } catch (error) {
      console.error('Failed to delete invitation:', error);
      setError('招待の削除に失敗しました');
    }
  };

  const handleRemoveMember = async (userId) => {
    if (!window.confirm('このメンバーを削除しますか？')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(
        `http://localhost:3001/api/projects/${projectId}/members/${userId}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      setSuccess('メンバーを削除しました');
      fetchMembers();
    } catch (error) {
      console.error('Failed to remove member:', error);
      setError(error.response?.data?.error || 'メンバーの削除に失敗しました');
    }
  };

  const handleClose = () => {
    setError('');
    setSuccess('');
    setInviteEmail('');
    onClose();
  };

  if (!isOpen) return null;

  const canInvite = currentUserRole === 'owner' || currentUserRole === 'editor';
  const canManageMembers = currentUserRole === 'owner';

  const modalContent = (
    <ModalOverlay onClick={handleClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>
            <FiUsers size={20} />
            プロジェクト共有
          </ModalTitle>
          <CloseButton onClick={handleClose}>
            <FiX size={20} />
          </CloseButton>
        </ModalHeader>

        {error && <ErrorMessage>{error}</ErrorMessage>}
        {success && <SuccessMessage>{success}</SuccessMessage>}

        <TabContainer>
          <Tab $active={activeTab === 'members'} onClick={() => setActiveTab('members')}>
            メンバー ({members.length})
          </Tab>
          <Tab $active={activeTab === 'invitations'} onClick={() => setActiveTab('invitations')}>
            招待 ({invitations.length})
          </Tab>
        </TabContainer>

        {activeTab === 'members' && (
          <Section>
            {canInvite && (
              <>
                <SectionTitle>メンバーを招待</SectionTitle>
                <InviteForm onSubmit={handleInvite}>
                  <Input
                    type="email"
                    placeholder="メールアドレス"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    disabled={loading}
                  />
                  <Button $primary type="submit" disabled={loading}>
                    <FiUserPlus size={16} />
                    招待
                  </Button>
                </InviteForm>
              </>
            )}

            <SectionTitle>現在のメンバー</SectionTitle>
            <MemberList>
              {members.length === 0 ? (
                <EmptyMessage>メンバーがいません</EmptyMessage>
              ) : (
                members.map(member => (
                  <MemberItem key={member.id}>
                    <MemberInfo>
                      <Avatar>
                        {member.name ? member.name.charAt(0).toUpperCase() : 'U'}
                      </Avatar>
                      <MemberDetails>
                        <MemberName>{member.name}</MemberName>
                        <MemberEmail>{member.email}</MemberEmail>
                      </MemberDetails>
                    </MemberInfo>
                    <MemberActions>
                      {canManageMembers && member.role !== 'owner' ? (
                        <>
                          <RoleBadge $role={member.role}>
                            メンバー
                          </RoleBadge>
                          <IconButton onClick={() => handleRemoveMember(member.user_id)}>
                            <FiTrash2 size={16} />
                          </IconButton>
                        </>
                      ) : (
                        <RoleBadge $role={member.role}>
                          {member.role === 'owner' ? 'オーナー' : 'メンバー'}
                        </RoleBadge>
                      )}
                    </MemberActions>
                  </MemberItem>
                ))
              )}
            </MemberList>
          </Section>
        )}

        {activeTab === 'invitations' && (
          <Section>
            <SectionTitle>保留中の招待</SectionTitle>
            {invitations.length === 0 ? (
              <EmptyMessage>保留中の招待はありません</EmptyMessage>
            ) : (
              invitations.filter(inv => inv.status === 'pending').map(invitation => (
                <InvitationItem key={invitation.id}>
                  <InvitationInfo>
                    <InvitationEmail>
                      <FiMail size={14} style={{ marginRight: '0.5rem' }} />
                      {invitation.invited_email}
                    </InvitationEmail>
                    <InvitationStatus>
                      有効期限: {new Date(invitation.expires_at).toLocaleDateString('ja-JP')}
                    </InvitationStatus>
                  </InvitationInfo>
                  <InvitationActions>
                    <RoleBadge $role={invitation.role}>
                      メンバー
                    </RoleBadge>
                    {canInvite && (
                      <IconButton onClick={() => handleDeleteInvitation(invitation.id)}>
                        <FiTrash2 size={16} />
                      </IconButton>
                    )}
                  </InvitationActions>
                </InvitationItem>
              ))
            )}
          </Section>
        )}
      </ModalContent>
    </ModalOverlay>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default ProjectSharingModal;
