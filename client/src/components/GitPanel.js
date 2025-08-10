import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import axios from 'axios';
import {
  FiGitBranch,
  FiGitCommit,
  FiUpload,
  FiDownload,
  FiPlus,
  FiRefreshCw,
  FiSettings
} from 'react-icons/fi';

const GitContainer = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #1e1e1e;
  color: #cccccc;
`;

const Section = styled.div`
  border-bottom: 1px solid #404040;
  padding: 1rem;

  &:last-child {
    border-bottom: none;
    flex: 1;
  }
`;

const SectionTitle = styled.h4`
  color: #ffffff;
  font-size: 0.875rem;
  margin: 0 0 0.75rem 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const StatusItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  background-color: ${props => props.type === 'modified' ? '#4a3c00' : 
                                  props.type === 'added' ? '#0f3d0f' : 
                                  props.type === 'deleted' ? '#4a0000' : '#2a2a2a'};
  border-radius: 4px;
  margin: 0.25rem 0;
  font-size: 0.75rem;
`;

const StatusIndicator = styled.span`
  color: ${props => props.type === 'modified' ? '#ffd700' : 
                     props.type === 'added' ? '#00ff00' : 
                     props.type === 'deleted' ? '#ff6b6b' : '#cccccc'};
  font-weight: bold;
  margin-right: 0.5rem;
`;

const Input = styled.input`
  width: 100%;
  background-color: #3c3c3c;
  border: 1px solid #555;
  color: #ffffff;
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  margin: 0.5rem 0;

  &:focus {
    outline: none;
    border-color: #007acc;
  }

  &::placeholder {
    color: #888;
  }
`;

const TextArea = styled.textarea`
  width: 100%;
  background-color: #3c3c3c;
  border: 1px solid #555;
  color: #ffffff;
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  margin: 0.5rem 0;
  resize: vertical;
  min-height: 60px;

  &:focus {
    outline: none;
    border-color: #007acc;
  }

  &::placeholder {
    color: #888;
  }
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
      case 'danger': return '#dc3545';
      default: return '#404040';
    }
  }};
  color: ${props => props.$variant === 'warning' ? '#000' : '#fff'};
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  margin: 0.25rem 0.25rem 0.25rem 0;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin: 0.5rem 0;
`;

const BranchList = styled.div`
  max-height: 150px;
  overflow-y: auto;
`;

const BranchItem = styled.div`
  padding: 0.5rem;
  background-color: ${props => props.active ? '#094771' : '#2a2a2a'};
  border-radius: 4px;
  margin: 0.25rem 0;
  font-size: 0.75rem;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;

  &:hover {
    background-color: ${props => props.active ? '#094771' : '#404040'};
  }
`;

const CommitList = styled.div`
  max-height: 200px;
  overflow-y: auto;
`;

const CommitItem = styled.div`
  padding: 0.5rem;
  border-left: 3px solid #007acc;
  margin: 0.5rem 0;
  background-color: #2a2a2a;
  border-radius: 0 4px 4px 0;
  font-size: 0.75rem;
`;

const GitPanel = ({ projectId }) => {
  const [status, setStatus] = useState(null);
  const [branches, setBranches] = useState([]);
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [currentBranch, setCurrentBranch] = useState('main');

  useEffect(() => {
    fetchGitStatus();
    fetchBranches();
    fetchCommits();
  }, [projectId]);

  const fetchGitStatus = async () => {
    try {
      const response = await axios.get(`/api/git/status/${projectId}`);
      setStatus(response.data.output);
    } catch (error) {
      console.error('Error fetching git status:', error);
    }
  };

  const fetchBranches = async () => {
    try {
      const response = await axios.get(`/api/git/branches/${projectId}`);
      setBranches(response.data.output.split('\n').filter(b => b.trim()));
      
      // Extract current branch
      const current = response.data.output.split('\n').find(b => b.startsWith('*'));
      if (current) {
        setCurrentBranch(current.replace('* ', '').trim());
      }
    } catch (error) {
      console.error('Error fetching branches:', error);
    }
  };

  const fetchCommits = async () => {
    try {
      const response = await axios.get(`/api/git/log/${projectId}`);
      setCommits(response.data.output.split('\n').filter(c => c.trim()));
    } catch (error) {
      console.error('Error fetching commits:', error);
    }
  };

  const initializeGit = async () => {
    setLoading(true);
    try {
      await axios.post(`/api/git/init/${projectId}`);
      fetchGitStatus();
      fetchBranches();
    } catch (error) {
      alert('Gitリポジトリの初期化に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const addFiles = async () => {
    setLoading(true);
    try {
      await axios.post(`/api/git/add/${projectId}`, { files: ['.'] });
      fetchGitStatus();
    } catch (error) {
      alert('ファイルの追加に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const commitChanges = async () => {
    if (!commitMessage.trim()) {
      alert('コミットメッセージを入力してください');
      return;
    }

    setLoading(true);
    try {
      await axios.post(`/api/git/commit/${projectId}`, {
        message: commitMessage
      });
      setCommitMessage('');
      fetchGitStatus();
      fetchCommits();
    } catch (error) {
      alert('変更のコミットに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const createBranch = async () => {
    if (!newBranch.trim()) {
      alert('ブランチ名を入力してください');
      return;
    }

    setLoading(true);
    try {
      await axios.post(`/api/git/branch/${projectId}`, {
        branchName: newBranch
      });
      setNewBranch('');
      fetchBranches();
    } catch (error) {
      alert('ブランチの作成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const switchBranch = async (branchName) => {
    setLoading(true);
    try {
      await axios.post(`/api/git/checkout/${projectId}`, {
        branchName: branchName.replace('* ', '').trim()
      });
      fetchBranches();
      fetchGitStatus();
    } catch (error) {
      alert('ブランチの切り替えに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const setRemote = async () => {
    if (!remoteUrl.trim()) {
      alert('リモートURLを入力してください');
      return;
    }

    setLoading(true);
    try {
      await axios.post(`/api/git/remote/${projectId}`, {
        remoteUrl: remoteUrl
      });
      alert('リモートURLを正常に設定しました');
    } catch (error) {
      alert('リモートURLの設定に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const pushChanges = async () => {
    setLoading(true);
    try {
      await axios.post(`/api/git/push/${projectId}`, {
        branch: currentBranch,
        setUpstream: true
      });
      alert('変更を正常にプッシュしました');
    } catch (error) {
      alert('変更のプッシュに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const pullChanges = async () => {
    setLoading(true);
    try {
      await axios.post(`/api/git/pull/${projectId}`);
      fetchGitStatus();
      fetchCommits();
      alert('変更を正常にプルしました');
    } catch (error) {
      alert('変更のプルに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const parseGitStatus = (statusText) => {
    if (!statusText) return [];
    
    return statusText.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const status = line.substring(0, 2);
        const file = line.substring(3);
        let type = 'unknown';
        
        if (status.includes('M')) type = 'modified';
        else if (status.includes('A')) type = 'added';
        else if (status.includes('D')) type = 'deleted';
        else if (status.includes('??')) type = 'untracked';
        
        return { file, type, status };
      });
  };

  const statusItems = parseGitStatus(status);

  return (
    <GitContainer>
      <Section>
        <SectionTitle>
          <FiGitBranch size={14} />
          リポジトリステータス
          <Button size="sm" onClick={fetchGitStatus} style={{ marginLeft: 'auto', padding: '0.25rem' }}>
            <FiRefreshCw size={12} />
          </Button>
        </SectionTitle>
        
        {statusItems.length === 0 ? (
          <div style={{ fontSize: '0.75rem', color: '#888' }}>
            作業ディレクトリはクリーンです
          </div>
        ) : (
          statusItems.map((item, index) => (
            <StatusItem key={index} type={item.type}>
              <span>
                <StatusIndicator type={item.type}>
                  {item.status}
                </StatusIndicator>
                {item.file}
              </span>
            </StatusItem>
          ))
        )}
        
        <ButtonGroup>
          <Button onClick={initializeGit} disabled={loading} $variant="primary">
            <FiSettings size={12} />
            Git初期化
          </Button>
          <Button onClick={addFiles} disabled={loading}>
            <FiPlus size={12} />
            全てステージング
          </Button>
        </ButtonGroup>
      </Section>

      <Section>
        <SectionTitle>
          <FiGitCommit size={14} />
          変更をコミット
        </SectionTitle>
        
        <TextArea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="コミットメッセージを入力..."
          disabled={loading}
        />
        
        <Button onClick={commitChanges} disabled={loading || !commitMessage.trim()} $variant="success">
          <FiGitCommit size={12} />
          コミット
        </Button>
      </Section>

      <Section>
        <SectionTitle>
          <FiGitBranch size={14} />
          ブランチ
        </SectionTitle>
        
        <BranchList>
          {branches.map((branch, index) => (
            <BranchItem
              key={index}
              active={branch.includes('*')}
              onClick={() => !branch.includes('*') && switchBranch(branch)}
            >
              <span>{branch}</span>
              {branch.includes('*') && <span style={{ color: '#007acc' }}>現在</span>}
            </BranchItem>
          ))}
        </BranchList>
        
        <Input
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          placeholder="新しいブランチ名..."
          disabled={loading}
        />
        
        <Button onClick={createBranch} disabled={loading || !newBranch.trim()}>
          <FiPlus size={12} />
          ブランチ作成
        </Button>
      </Section>

      <Section>
        <SectionTitle>
          リモートリポジトリ
        </SectionTitle>
        
        <Input
          value={remoteUrl}
          onChange={(e) => setRemoteUrl(e.target.value)}
          placeholder="https://github.com/user/repo.git"
          disabled={loading}
        />
        
        <ButtonGroup>
          <Button onClick={setRemote} disabled={loading || !remoteUrl.trim()}>
            <FiSettings size={12} />
            リモート設定
          </Button>
          <Button onClick={pushChanges} disabled={loading} $variant="warning">
            <FiUpload size={12} />
            プッシュ
          </Button>
          <Button onClick={pullChanges} disabled={loading}>
            <FiDownload size={12} />
            プル
          </Button>
        </ButtonGroup>
      </Section>

      <Section>
        <SectionTitle>最近のコミット</SectionTitle>
        <CommitList>
          {commits.map((commit, index) => (
            <CommitItem key={index}>
              {commit}
            </CommitItem>
          ))}
        </CommitList>
      </Section>
    </GitContainer>
  );
};

export default GitPanel;