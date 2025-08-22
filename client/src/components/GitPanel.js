import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import axios from 'axios';
import {
  FiGitBranch,
  FiGitCommit,
  FiClock,
  FiUser,
  FiRefreshCw,
  FiPlus,
  FiChevronDown,
  FiChevronRight,
  FiCode
} from 'react-icons/fi';

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #1e1e1e;
  border: 1px solid #404040;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border-bottom: 1px solid #404040;
  background-color: #252526;
`;

const Title = styled.h3`
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: #cccccc;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const Controls = styled.div`
  display: flex;
  gap: 0.25rem;
`;

const Button = styled.button`
  background: ${props => props.$primary ? '#007acc' : 'none'};
  border: 1px solid ${props => props.$primary ? '#007acc' : '#404040'};
  color: ${props => props.$primary ? '#ffffff' : '#cccccc'};
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;

  &:hover:not(:disabled) {
    background-color: ${props => props.$primary ? '#005a9e' : '#404040'};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
`;

const Section = styled.div`
  margin-bottom: 1rem;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: #cccccc;
  text-transform: uppercase;
  cursor: pointer;
  
  &:hover {
    color: #ffffff;
  }
`;

const StatusBar = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background-color: ${props => props.$hasChanges ? '#4a3d00' : '#1a4a1a'};
  border-radius: 4px;
  margin-bottom: 0.5rem;
  font-size: 0.75rem;
`;

const StatusIcon = styled.div`
  color: ${props => props.$hasChanges ? '#ffd700' : '#4caf50'};
`;

const CommitList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const CommitItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem;
  background-color: #252526;
  border-radius: 4px;
  border-left: 3px solid ${props => props.$isCurrent ? '#007acc' : '#404040'};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background-color: #2d2d30;
  }
`;

const CommitIcon = styled.div`
  color: ${props => props.$isCurrent ? '#007acc' : '#cccccc'};
  margin-top: 0.125rem;
`;

const CommitDetails = styled.div`
  flex: 1;
  min-width: 0;
`;

const CommitMessage = styled.div`
  color: #cccccc;
  font-size: 0.75rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CommitMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.625rem;
  color: #999999;
`;

const Input = styled.input`
  background-color: #3c3c3c;
  border: 1px solid #404040;
  color: #ffffff;
  padding: 0.375rem;
  border-radius: 4px;
  font-size: 0.75rem;
  width: 100%;
  margin: 0.25rem 0;

  &:focus {
    outline: none;
    border-color: #007acc;
  }

  &::placeholder {
    color: #999999;
  }
`;

const TextArea = styled.textarea`
  background-color: #3c3c3c;
  border: 1px solid #404040;
  color: #ffffff;
  padding: 0.375rem;
  border-radius: 4px;
  font-size: 0.75rem;
  width: 100%;
  min-height: 60px;
  resize: vertical;
  font-family: inherit;
  margin: 0.25rem 0;

  &:focus {
    outline: none;
    border-color: #007acc;
  }

  &::placeholder {
    color: #999999;
  }
`;

const BranchInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  background-color: #252526;
  border-radius: 4px;
  font-size: 0.75rem;
  color: #cccccc;
  margin-bottom: 0.5rem;
`;

const GitPanel = ({ projectId, onRefresh }) => {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [showCommitForm, setShowCommitForm] = useState(false);
  const [showBranchForm, setShowBranchForm] = useState(false);

  // Gitデータの取得（初期化は行わない）
  const fetchGitData = useCallback(async () => {
    if (!projectId || loading) return;
    
    try {
      setLoading(true);
      
      // データを並列で取得
      const [statusRes, historyRes, branchesRes] = await Promise.all([
        axios.get(`/api/version-control/${projectId}/status`).catch(() => ({ data: { initialized: false } })),
        axios.get(`/api/version-control/${projectId}/history?limit=10`).catch(() => ({ data: [] })),
        axios.get(`/api/version-control/${projectId}/branches`).catch(() => ({ data: [] }))
      ]);
      
      setStatus(statusRes.data);
      setHistory(historyRes.data || []);
      setBranches(branchesRes.data || []);
      
    } catch (error) {
      console.error('Git data fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, loading]);

  // コミット作成
  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      alert('コミットメッセージを入力してください');
      return;
    }

    try {
      setLoading(true);
      
      await axios.post(`/api/version-control/${projectId}/commit`, {
        message: commitMessage.trim()
      });
      
      setCommitMessage('');
      setShowCommitForm(false);
      await fetchGitData();
      
      if (onRefresh) {
        onRefresh(); // ファイルツリーをリフレッシュ
      }
      
    } catch (error) {
      console.error('Commit error:', error);
      alert('コミットエラー: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  // ブランチ作成
  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) {
      alert('ブランチ名を入力してください');
      return;
    }

    try {
      setLoading(true);
      
      await axios.post(`/api/version-control/${projectId}/branch`, {
        branchName: newBranchName.trim()
      });
      
      setNewBranchName('');
      setShowBranchForm(false);
      await fetchGitData();
      
    } catch (error) {
      console.error('Branch creation error:', error);
      alert('ブランチ作成エラー: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  // ブランチ切り替え
  const handleSwitchBranch = async (branchName) => {
    try {
      setLoading(true);
      
      await axios.post(`/api/version-control/${projectId}/checkout`, {
        branchName
      });
      
      await fetchGitData();
      
      if (onRefresh) {
        onRefresh(); // ファイルツリーをリフレッシュ
      }
      
    } catch (error) {
      console.error('Branch switch error:', error);
      alert('ブランチ切り替えエラー: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  // コミットに復元
  const handleRestoreCommit = async (commit) => {
    if (!window.confirm(`コミット "${commit.message}" にファイルを復元しますか？\n現在の変更は失われる可能性があります。`)) {
      return;
    }

    try {
      setLoading(true);
      
      const response = await axios.post(`/api/version-control/${projectId}/restore`, {
        commitHash: commit.hash
      });
      
      alert(`復元完了: ${response.data.restoredCount} ファイルが復元されました`);
      
      if (onRefresh) {
        onRefresh(); // ファイルツリーをリフレッシュ
      }
      
    } catch (error) {
      console.error('Restore error:', error);
      alert('復元エラー: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  // 初回データ読み込み
  useEffect(() => {
    if (projectId) {
      fetchGitData();
    }
  }, [projectId, fetchGitData]);

  // 相対時間の計算
  const getRelativeTime = (date) => {
    const now = new Date();
    const diffMs = now - new Date(date);
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'たった今';
    if (diffMins < 60) return `${diffMins}分前`;
    if (diffHours < 24) return `${diffHours}時間前`;
    if (diffDays < 7) return `${diffDays}日前`;
    
    return new Date(date).toLocaleDateString('ja-JP');
  };

  return (
    <Panel>
      <Header>
        <Title>
          <FiGitBranch />
          Git バージョン管理
        </Title>
        <Controls>
          <Button onClick={fetchGitData} disabled={loading} title="リフレッシュ">
            <FiRefreshCw />
          </Button>
          <Button 
            $primary 
            onClick={() => setShowCommitForm(!showCommitForm)}
            disabled={loading || !status?.initialized}
            title="コミット作成"
          >
            <FiGitCommit />
          </Button>
        </Controls>
      </Header>

      <Content>
        {/* Git状態表示 */}
        {status && (
          <Section>
            <StatusBar $hasChanges={status.hasChanges}>
              <StatusIcon $hasChanges={status.hasChanges}>
                {status.hasChanges ? <FiClock /> : <FiGitCommit />}
              </StatusIcon>
              <span>
                {status.hasChanges 
                  ? `変更あり (${status.changes?.length || 0}ファイル)` 
                  : '変更なし'
                }
              </span>
            </StatusBar>

            {/* 現在のブランチ */}
            {status.branch && (
              <BranchInfo>
                <FiGitBranch />
                <strong>{status.branch}</strong>
              </BranchInfo>
            )}
          </Section>
        )}

        {/* コミットフォーム */}
        {showCommitForm && (
          <Section>
            <SectionHeader>新しいコミット</SectionHeader>
            <TextArea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="コミットメッセージを入力..."
              rows={3}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button $primary onClick={handleCommit} disabled={loading}>
                コミット
              </Button>
              <Button onClick={() => setShowCommitForm(false)}>
                キャンセル
              </Button>
            </div>
          </Section>
        )}

        {/* ブランチ管理 */}
        <Section>
          <SectionHeader
            onClick={() => setShowBranchForm(!showBranchForm)}
          >
            {showBranchForm ? <FiChevronDown /> : <FiChevronRight />}
            ブランチ ({branches.length})
            <Button
              onClick={(e) => {
                e.stopPropagation();
                setShowBranchForm(!showBranchForm);
              }}
            >
              <FiPlus />
            </Button>
          </SectionHeader>
          
          {showBranchForm && (
            <>
              <Input
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="新しいブランチ名..."
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <Button $primary onClick={handleCreateBranch} disabled={loading}>
                  作成
                </Button>
                <Button onClick={() => setShowBranchForm(false)}>
                  キャンセル
                </Button>
              </div>
            </>
          )}

          {/* ブランチ一覧 */}
          <div style={{ marginTop: '0.5rem' }}>
            {branches.map((branch) => (
              <CommitItem
                key={branch.name}
                $isCurrent={branch.current}
                onClick={() => !branch.current && handleSwitchBranch(branch.name)}
                style={{ cursor: branch.current ? 'default' : 'pointer' }}
              >
                <CommitIcon $isCurrent={branch.current}>
                  <FiGitBranch />
                </CommitIcon>
                <CommitDetails>
                  <CommitMessage>
                    {branch.name} {branch.current && '(現在)'}
                  </CommitMessage>
                </CommitDetails>
              </CommitItem>
            ))}
          </div>
        </Section>

        {/* コミット履歴 */}
        <Section>
          <SectionHeader>
            履歴 ({history.length})
          </SectionHeader>
          <CommitList>
            {history.map((commit, index) => (
              <CommitItem
                key={commit.hash}
                $isCurrent={index === 0}
                onClick={() => handleRestoreCommit(commit)}
                style={{ cursor: 'pointer' }}
                title="クリックでこのコミットに復元"
              >
                <CommitIcon $isCurrent={index === 0}>
                  <FiGitCommit />
                </CommitIcon>
                <CommitDetails>
                  <CommitMessage title={commit.message}>
                    {commit.message}
                  </CommitMessage>
                  <CommitMeta>
                    <FiUser size={10} />
                    <span>{commit.author}</span>
                    <FiClock size={10} />
                    <span>{getRelativeTime(commit.date)}</span>
                    <FiCode size={10} />
                    <span>{commit.hash.substring(0, 7)}</span>
                  </CommitMeta>
                </CommitDetails>
              </CommitItem>
            ))}
          </CommitList>
        </Section>

        {loading && (
          <div style={{ 
            textAlign: 'center', 
            padding: '1rem', 
            color: '#999999',
            fontSize: '0.75rem'
          }}>
            読み込み中...
          </div>
        )}
      </Content>
    </Panel>
  );
};

export default GitPanel;