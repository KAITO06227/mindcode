import React, { useState } from 'react';
import styled from 'styled-components';
import { FiMail, FiCheck, FiX, FiUsers } from 'react-icons/fi';
import axios from 'axios';

const NotificationCard = styled.div`
  background-color: #2d2d2d;
  border: 1px solid #007acc;
  border-left: 4px solid #007acc;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1rem;
  transition: all 0.2s;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 122, 204, 0.2);
  }
`;

const NotificationHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
`;

const IconWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background-color: #007acc;
  border-radius: 50%;
  color: #ffffff;
`;

const HeaderText = styled.div`
  flex: 1;
`;

const Title = styled.h4`
  color: #ffffff;
  font-size: 1rem;
  margin: 0 0 0.25rem 0;
`;

const Subtitle = styled.p`
  color: #cccccc;
  font-size: 0.875rem;
  margin: 0;
`;

const ProjectInfo = styled.div`
  background-color: #1e1e1e;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  padding: 1rem;
  margin-bottom: 1rem;
`;

const ProjectName = styled.div`
  color: #ffffff;
  font-size: 1rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const ProjectDescription = styled.div`
  color: #cccccc;
  font-size: 0.875rem;
  line-height: 1.4;
`;

const RoleBadge = styled.span`
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  background-color: #2c5282;
  color: #63b3ed;
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
`;

const Button = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s;

  ${props => props.$accept ? `
    background-color: #38a169;
    color: #ffffff;
    &:hover:not(:disabled) {
      background-color: #2f855a;
    }
  ` : `
    background-color: #3c3c3c;
    color: #cccccc;
    &:hover:not(:disabled) {
      background-color: #c53030;
      color: #ffffff;
    }
  `}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Message = styled.div`
  background-color: ${props => props.$type === 'error' ? '#c53030' : '#38a169'};
  color: #ffffff;
  padding: 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  font-size: 0.875rem;
`;

const InvitationNotification = ({ invitation, onResponse }) => {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const handleAccept = async () => {
    setProcessing(true);
    setError('');

    try {
      const authToken = localStorage.getItem('token');
      await axios.post(
        `http://localhost:3001/api/invitations/${invitation.id}/accept-by-id`,
        {},
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      onResponse('accepted', invitation.id);
    } catch (error) {
      console.error('Failed to accept invitation:', error);
      setError(error.response?.data?.error || '招待の承認に失敗しました');
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!window.confirm('この招待を拒否しますか？')) {
      return;
    }

    setProcessing(true);
    setError('');

    try {
      const authToken = localStorage.getItem('token');
      await axios.post(
        `http://localhost:3001/api/invitations/${invitation.id}/reject-by-id`,
        {},
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      onResponse('rejected', invitation.id);
    } catch (error) {
      console.error('Failed to reject invitation:', error);
      setError(error.response?.data?.error || '招待の拒否に失敗しました');
      setProcessing(false);
    }
  };

  return (
    <NotificationCard>
      <NotificationHeader>
        <IconWrapper>
          <FiMail size={20} />
        </IconWrapper>
        <HeaderText>
          <Title>プロジェクト招待</Title>
          <Subtitle>
            {invitation.invited_by_name} さんからの招待
          </Subtitle>
        </HeaderText>
      </NotificationHeader>

      {error && <Message $type="error">{error}</Message>}

      <ProjectInfo>
        <ProjectName>
          <FiUsers size={16} />
          {invitation.project_name}
          <RoleBadge>メンバー</RoleBadge>
        </ProjectName>
        {invitation.project_description && (
          <ProjectDescription>{invitation.project_description}</ProjectDescription>
        )}
      </ProjectInfo>

      <ButtonGroup>
        <Button
          $accept
          onClick={handleAccept}
          disabled={processing}
        >
          <FiCheck size={16} />
          {processing ? '処理中...' : '承諾'}
        </Button>
        <Button
          onClick={handleReject}
          disabled={processing}
        >
          <FiX size={16} />
          拒否
        </Button>
      </ButtonGroup>
    </NotificationCard>
  );
};

export default InvitationNotification;
