import React, { useState } from 'react';
import styled from 'styled-components';
import { FiX } from 'react-icons/fi';

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
`;

const Modal = styled.div`
  background-color: #2d2d2d;
  border-radius: 8px;
  padding: 2rem;
  max-width: 500px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
`;

const Title = styled.h2`
  color: #ffffff;
  font-size: 1.25rem;
  margin: 0;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: #888888;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;

  &:hover {
    color: #ffffff;
    background-color: #404040;
  }
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const Label = styled.label`
  color: #ffffff;
  font-size: 0.875rem;
  font-weight: 500;
`;

const Input = styled.input`
  background-color: #3c3c3c;
  border: 1px solid #555555;
  color: #ffffff;
  padding: 0.75rem;
  border-radius: 4px;
  font-size: 0.875rem;

  &:focus {
    outline: none;
    border-color: #007acc;
  }

  &::placeholder {
    color: #888888;
  }
`;

const TextArea = styled.textarea`
  background-color: #3c3c3c;
  border: 1px solid #555555;
  color: #ffffff;
  padding: 0.75rem;
  border-radius: 4px;
  font-size: 0.875rem;
  resize: vertical;
  min-height: 80px;

  &:focus {
    outline: none;
    border-color: #007acc;
  }

  &::placeholder {
    color: #888888;
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1rem;
`;

const Button = styled.button`
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: background-color 0.2s;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const PrimaryButton = styled(Button)`
  background-color: #007acc;
  color: #ffffff;

  &:hover:not(:disabled) {
    background-color: #005a9e;
  }
`;

const SecondaryButton = styled(Button)`
  background-color: #404040;
  color: #ffffff;

  &:hover:not(:disabled) {
    background-color: #555555;
  }
`;

const ErrorMessage = styled.div`
  color: #ff6b6b;
  font-size: 0.875rem;
  margin-top: 0.25rem;
`;

const CreateProjectModal = ({ onClose, onCreate }) => {
  const [formData, setFormData] = useState({
    name: '',
    description: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear error when user starts typing
    if (error) {
      setError('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      setError('プロジェクト名が必要です');
      return;
    }

    if (formData.name.length < 3) {
      setError('プロジェクト名は3文字以上で入力してください');
      return;
    }

    if (!/^[a-zA-Z0-9\s\-_]+$/.test(formData.name)) {
      setError('プロジェクト名には英数字、スペース、ハイフン、アンダースコアのみ使用できます');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onCreate(formData);
    } catch (error) {
      setError(error.response?.data?.message || 'プロジェクトの作成に失敗しました');
      setLoading(false);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <Overlay onClick={handleOverlayClick}>
      <Modal>
        <Header>
          <Title>新しいプロジェクトを作成</Title>
          <CloseButton onClick={onClose}>
            <FiX size={20} />
          </CloseButton>
        </Header>

        <Form onSubmit={handleSubmit}>
          <FormGroup>
            <Label htmlFor="name">プロジェクト名 *</Label>
            <Input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="プロジェクト名を入力"
              maxLength={100}
              disabled={loading}
            />
          </FormGroup>

          <FormGroup>
            <Label htmlFor="description">説明</Label>
            <TextArea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="プロジェクトの説明（任意）"
              maxLength={500}
              disabled={loading}
            />
          </FormGroup>

          {error && <ErrorMessage>{error}</ErrorMessage>}

          <ButtonGroup>
            <SecondaryButton 
              type="button" 
              onClick={onClose}
              disabled={loading}
            >
              キャンセル
            </SecondaryButton>
            <PrimaryButton 
              type="submit"
              disabled={loading}
            >
              {loading ? '作成中...' : 'プロジェクトを作成'}
            </PrimaryButton>
          </ButtonGroup>
        </Form>
      </Modal>
    </Overlay>
  );
};

export default CreateProjectModal;