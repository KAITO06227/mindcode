import React, { useState, useEffect, useCallback, useRef } from 'react';
import styled from 'styled-components';
import axios from 'axios';
import {
  FiGitBranch,
  FiGitCommit,
  FiClock,
  FiUser,
  FiRefreshCw,
  FiCode,
  FiSave
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
  border-left: 3px solid ${props => props.$isActive ? '#007acc' : '#404040'};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background-color: #2d2d30;
  }
`;

const CommitIcon = styled.div`
  color: ${props => props.$isActive ? '#007acc' : '#cccccc'};
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
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitTooltips, setCommitTooltips] = useState({});
  const [lastRestoredHash, setLastRestoredHash] = useState(null);
  const [activeCommitHash, setActiveCommitHash] = useState(null);
  const previousHeadRef = useRef(null);

  // トリップコードデータの取得（初期化は行わない）
  const fetchGitData = useCallback(async () => {
    if (!projectId || loading) return;
    
    try {
      setLoading(true);

      // データを並列で取得
      const [statusRes, historyRes] = await Promise.all([
        axios.get(`/api/version-control/${projectId}/status`).catch((error) => {
          return { data: { initialized: false, hasChanges: false, changes: [] } };
        }),
        axios.get(`/api/version-control/${projectId}/history?limit=all`).catch(() => ({ data: [] }))
      ]);

      setStatus(statusRes.data);

      const newHead = statusRes.data?.head || null;
      const previousHead = previousHeadRef.current;

      if (newHead) {
        setActiveCommitHash(newHead);
        if (lastRestoredHash && previousHead && previousHead !== newHead) {
          setLastRestoredHash(null);
        }
        previousHeadRef.current = newHead;
      } else {
        previousHeadRef.current = null;
      }

      const historyData = historyRes.data || [];
      setHistory(historyData);
      if (historyData.length) {
        try {
          const hashes = historyData.map(commit => commit.hash).join(',');
          const tooltipRes = await axios.get(`/api/version-control/${projectId}/commit-prompts`, {
            params: { hashes }
          });
          setCommitTooltips(tooltipRes.data || {});
        } catch (tooltipError) {
        }
      } else {
        setCommitTooltips({});
      }
      if (lastRestoredHash && !historyData.some(commit => commit.hash === lastRestoredHash)) {
        setLastRestoredHash(null);
      }

    } catch (error) {
      console.error('Tripcode data fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, loading, lastRestoredHash]);

  const handleInitRepository = useCallback(async () => {
    if (!projectId || initializing) {
      return;
    }

    try {
      setInitializing(true);
      await axios.post(`/api/version-control/${projectId}/init`);
      await fetchGitData();
      alert('トリップコードリポジトリを初期化しました');
    } catch (error) {
      console.error('Tripcode init error:', error);
      alert('トリップコード初期化エラー: ' + (error.response?.data?.message || error.message));
    } finally {
      setInitializing(false);
    }
  }, [projectId, initializing, fetchGitData]);

  // 保存（タイムスタンプでコミット作成）
  const handleSave = useCallback(async () => {
    if (!projectId || committing) {
      return;
    }

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

    try {
      setCommitting(true);
      const response = await axios.post(`/api/version-control/${projectId}/commit`, {
        message: timestamp
      });

      if (!response.data?.success) {
        throw new Error(response.data?.message || '保存に失敗しました');
      }

      await fetchGitData();

      if (onRefresh) {
        onRefresh();
      }

      setLastRestoredHash(null);
      window.dispatchEvent(new CustomEvent('mindcode:gitUpdated'));

    } catch (error) {
      console.error('Save commit error:', error);
      const rawMessage = error.response?.data?.message || error.message;
      if (/no changes|nothing to commit/i.test(rawMessage || '')) {
        alert('前回から変更がありません。');
      } else {
        alert('保存に失敗しました: ' + rawMessage);
      }
    } finally {
      setCommitting(false);
    }
  }, [projectId, committing, fetchGitData, onRefresh]);

  // コミットに復元
  const handleRestoreCommit = async (commit) => {
    if (!projectId) {
      return;
    }

    const confirmed = window.confirm(
      `コミット "${commit.message}" (${commit.hash.substring(0, 7)}) に復元しますか？\n現在の変更は保持されます。`
    );

    if (!confirmed) {
      return;
    }

    try {
      setLoading(true);

      const response = await axios.post(`/api/version-control/${projectId}/restore`, {
        commitHash: commit.hash
      });

      if (response.data?.success) {
        setLastRestoredHash(commit.hash);

        // 段階的にUIを更新
        await fetchGitData();

        if (onRefresh) {
          onRefresh();
        }

        // イベントを発火してエディタ等に通知
        window.dispatchEvent(new CustomEvent('mindcode:gitUpdated'));
        window.dispatchEvent(new CustomEvent('mindcode:filesUpdated'));

        alert(`復元が完了しました: ${commit.message.substring(0, 50)}`);
      } else {
        throw new Error(response.data?.message || '復元に失敗しました');
      }
    } catch (error) {
      console.error('Restore error:', error);
      const errorMessage = error.response?.data?.message || error.message;
      alert(`復元エラー: ${errorMessage}`);
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

  useEffect(() => {
    const handleExternalUpdate = () => {
      if (projectId) {
        fetchGitData();
      }
    };

    window.addEventListener('mindcode:gitUpdated', handleExternalUpdate);
    return () => {
      window.removeEventListener('mindcode:gitUpdated', handleExternalUpdate);
    };
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

  const getCommitTooltip = useCallback((hash) => {
    const prompts = commitTooltips?.[hash];
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return undefined;
    }
    return prompts.join('\n');
  }, [commitTooltips]);

  return (
    <Panel>
      <Header>
        <Title>
          <FiGitBranch />
          トリップコード バージョン管理
        </Title>
        <Controls>
          <Button onClick={fetchGitData} title="リフレッシュ">
            <FiRefreshCw />
          </Button>
          {status?.initialized === false && (
            <Button
              $primary
              onClick={handleInitRepository}
              disabled={initializing}
              title="トリップコードリポジトリを初期化"
            >
              {initializing ? '初期化中...' : 'トリップコード初期化'}
            </Button>
          )}
          <Button
            $primary
            onClick={handleSave}
            title="保存（コミット作成）"
          >
            <FiSave />
          </Button>
        </Controls>
      </Header>

      <Content>
        {/* トリップコード状態表示 */}
        {status?.branch && (
          <Section>
            <BranchInfo>
              <FiGitBranch />
              <strong>{status.branch}</strong>
            </BranchInfo>
          </Section>
        )}

        {/* コミット履歴 */}
        <Section>
          <SectionHeader>
            履歴 ({history.length})
          </SectionHeader>
          {history.length === 0 ? (
            <div style={{ color: '#999999', fontSize: '0.75rem', padding: '0.5rem' }}>
              コミットはまだありません。
            </div>
          ) : (
            <CommitList>
              {history.map((commit) => {
                const fallbackHash = lastRestoredHash || activeCommitHash || history[0]?.hash;
                const isActive = commit.hash === fallbackHash;
                return (
                  <CommitItem
                    key={commit.hash}
                    $isActive={isActive}
                    onClick={() => handleRestoreCommit(commit)}
                    style={{ cursor: 'pointer' }}
                    title={getCommitTooltip(commit.hash) || 'クリックでこのコミットに復元'}
                  >
                    <CommitIcon $isActive={isActive}>
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
                );
              })}
            </CommitList>
          )}
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
