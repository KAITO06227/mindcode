import React, { useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import { FiBell, FiX } from 'react-icons/fi';

const slideIn = keyframes`
  from {
    transform: translateX(400px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
`;

const slideOut = keyframes`
  from {
    transform: translateX(0);
    opacity: 1;
  }
  to {
    transform: translateX(400px);
    opacity: 0;
  }
`;

const ToastContainer = styled.div`
  position: fixed;
  top: 80px;
  right: 20px;
  background-color: #2d2d2d;
  border: 1px solid #007acc;
  border-radius: 8px;
  padding: 1rem;
  min-width: 300px;
  max-width: 400px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  z-index: 10000;
  animation: ${props => props.$isClosing ? slideOut : slideIn} 0.3s ease-out;
`;

const ToastHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
`;

const ToastTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #007acc;
  font-weight: 500;
  font-size: 0.875rem;
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

const ToastContent = styled.div`
  color: #ffffff;
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
`;

const ToastMessage = styled.p`
  margin: 0 0 0.5rem 0;
  color: #cccccc;
`;

const ToastMeta = styled.div`
  font-size: 0.75rem;
  color: #888888;
`;

const ToastNotification = ({ invitation, onClose, autoClose = 5000 }) => {
  const [isClosing, setIsClosing] = React.useState(false);

  useEffect(() => {
    if (autoClose > 0) {
      const timer = setTimeout(() => {
        handleClose();
      }, autoClose);

      return () => clearTimeout(timer);
    }
  }, [autoClose]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300); // アニメーション時間と一致
  };

  return (
    <ToastContainer $isClosing={isClosing}>
      <ToastHeader>
        <ToastTitle>
          <FiBell size={16} />
          新しい招待
        </ToastTitle>
        <CloseButton onClick={handleClose}>
          <FiX size={16} />
        </CloseButton>
      </ToastHeader>
      <ToastContent>
        <ToastMessage>
          <strong>{invitation.invited_by_name}</strong> さんから
          プロジェクト「<strong>{invitation.project_name}</strong>」に招待されました
        </ToastMessage>
        <ToastMeta>
          ロール: {invitation.role === 'editor' ? '編集者' : '閲覧者'}
        </ToastMeta>
      </ToastContent>
    </ToastContainer>
  );
};

export default ToastNotification;
