import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import axios from 'axios';
import {
  FiClock,
  FiSave,
  FiTrash2,
  FiRefreshCw,
  FiUser,
  FiFile,
  FiHardDrive
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
  background: ${props => props.$primary ? '#007acc' : props.$danger ? '#d73a49' : 'none'};
  border: 1px solid ${props => props.$primary ? '#007acc' : props.$danger ? '#d73a49' : '#404040'};
  color: ${props => props.$primary || props.$danger ? '#ffffff' : '#cccccc'};
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;

  &:hover:not(:disabled) {
    background-color: ${props =>
      props.$primary ? '#005a9e' :
      props.$danger ? '#b73e47' :
      '#404040'
    };
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
`;

const SnapshotList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const SnapshotItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem;
  background-color: #252526;
  border-radius: 4px;
  border-left: 3px solid ${props =>
    props.$isCurrent ? '#28a745' :
    props.$isLastRestored ? '#007acc' :
    '#404040'
  };
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background-color: #2d2d30;
  }
`;

const SnapshotIcon = styled.div`
  color: ${props =>
    props.$isCurrent ? '#28a745' :
    props.$isLastRestored ? '#007acc' :
    '#cccccc'
  };
  margin-top: 0.125rem;
`;

const SnapshotDetails = styled.div`
  flex: 1;
  min-width: 0;
`;

const SnapshotDescription = styled.div`
  color: #cccccc;
  font-size: 0.75rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SnapshotMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.625rem;
  color: #999999;
  flex-wrap: wrap;
`;

const SnapshotActions = styled.div`
  display: flex;
  gap: 0.25rem;
  align-items: center;
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

const TypeBadge = styled.span`
  background-color: ${props =>
    props.$type === 'auto_ai' ? '#28a745' :
    props.$type === 'restore_backup' ? '#ffc107' :
    '#6c757d'
  };
  color: white;
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  font-size: 0.6rem;
  font-weight: 500;
`;

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

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

const getTypeLabel = (type) => {
  switch (type) {
    case 'auto_ai': return 'AI自動';
    case 'restore_backup': return '復元前';
    case 'manual': return '手動';
    default: return type;
  }
};

const SnapshotPanel = ({ projectId, onRefresh }) => {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // スナップショット一覧を取得
  const fetchSnapshots = useCallback(async () => {
    if (!projectId || loading) return;

    try {
      setLoading(true);
      const response = await axios.get(`/api/snapshots/${projectId}`);
      setSnapshots(response.data.snapshots || []);
    } catch (error) {
      console.error('スナップショット取得エラー:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, loading]);

  // スナップショット作成
  const handleCreateSnapshot = async () => {
    if (!description.trim()) {
      alert('スナップショットの説明を入力してください');
      return;
    }

    try {
      setCreating(true);
      await axios.post(`/api/snapshots/${projectId}`, {
        description: description.trim(),
        type: 'manual'
      });

      setDescription('');
      setShowCreateForm(false);
      await fetchSnapshots();

      if (onRefresh) {
        onRefresh();
      }
    } catch (error) {
      console.error('スナップショット作成エラー:', error);
      alert('スナップショット作成エラー: ' + (error.response?.data?.message || error.message));
    } finally {
      setCreating(false);
    }
  };

  // スナップショットから復元
  const handleRestoreSnapshot = async (snapshot) => {
    if (!projectId) return;

    const confirmed = window.confirm(
      `スナップショット "${snapshot.description}" から復元しますか？\n現在の作業内容は復元前バックアップとして自動保存されます。`
    );

    if (!confirmed) return;

    try {
      setLoading(true);
      await axios.post(`/api/snapshots/${projectId}/restore/${snapshot.id}`);

      await fetchSnapshots();

      if (onRefresh) {
        onRefresh();
      }

      window.dispatchEvent(new CustomEvent('mindcode:snapshotRestored'));
    } catch (error) {
      console.error('スナップショット復元エラー:', error);
      alert('スナップショット復元エラー: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  // スナップショット削除
  const handleDeleteSnapshot = async (snapshot) => {
    const confirmed = window.confirm(
      `スナップショット "${snapshot.description}" を削除しますか？\nこの操作は元に戻せません。`
    );

    if (!confirmed) return;

    try {
      setLoading(true);
      await axios.delete(`/api/snapshots/${projectId}/${snapshot.id}`);

      await fetchSnapshots();
    } catch (error) {
      console.error('スナップショット削除エラー:', error);
      alert('スナップショット削除エラー: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  // 初回データ読み込み
  useEffect(() => {
    if (projectId) {
      fetchSnapshots();
    }
  }, [projectId, fetchSnapshots]);

  // 外部からの更新イベントを監視
  useEffect(() => {
    const handleExternalUpdate = () => {
      if (projectId) {
        fetchSnapshots();
      }
    };

    window.addEventListener('mindcode:snapshotCreated', handleExternalUpdate);
    window.addEventListener('mindcode:snapshotRestored', handleExternalUpdate);

    return () => {
      window.removeEventListener('mindcode:snapshotCreated', handleExternalUpdate);
      window.removeEventListener('mindcode:snapshotRestored', handleExternalUpdate);
    };
  }, [projectId, fetchSnapshots]);

  return (
    <Panel>
      <Header>
        <Title>
          <FiHardDrive />
          スナップショット
        </Title>
        <Controls>
          <Button onClick={fetchSnapshots} disabled={loading} title="リフレッシュ">
            <FiRefreshCw />
          </Button>
          <Button
            $primary
            onClick={() => setShowCreateForm(!showCreateForm)}
            disabled={loading}
            title="スナップショット作成"
          >
            <FiSave />
          </Button>
        </Controls>
      </Header>

      <Content>
        {/* スナップショット作成フォーム */}
        {showCreateForm && (
          <Section>
            <SectionHeader>新しいスナップショット</SectionHeader>
            <TextArea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="スナップショットの説明を入力..."
              rows={3}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button $primary onClick={handleCreateSnapshot} disabled={creating}>
                {creating ? '作成中...' : '作成'}
              </Button>
              <Button onClick={() => setShowCreateForm(false)}>
                キャンセル
              </Button>
            </div>
          </Section>
        )}

        {/* スナップショット一覧 */}
        <Section>
          <SectionHeader>
            スナップショット履歴 ({snapshots.length})
          </SectionHeader>
          {snapshots.length === 0 ? (
            <div style={{ color: '#999999', fontSize: '0.75rem', padding: '0.5rem' }}>
              スナップショットはまだありません。
            </div>
          ) : (
            <SnapshotList>
              {snapshots.map((snapshot) => (
                <SnapshotItem
                  key={snapshot.id}
                  $isCurrent={snapshot.isCurrent}
                  $isLastRestored={snapshot.isLastRestored}
                  onClick={() => handleRestoreSnapshot(snapshot)}
                  title="クリックでこのスナップショットに復元"
                >
                  <SnapshotIcon
                    $isCurrent={snapshot.isCurrent}
                    $isLastRestored={snapshot.isLastRestored}
                  >
                    <FiClock />
                  </SnapshotIcon>
                  <SnapshotDetails>
                    <SnapshotDescription title={snapshot.description}>
                      {snapshot.description || '説明なし'}
                    </SnapshotDescription>
                    <SnapshotMeta>
                      <TypeBadge $type={snapshot.type}>
                        {getTypeLabel(snapshot.type)}
                      </TypeBadge>
                      {snapshot.createdBy && (
                        <>
                          <FiUser size={10} />
                          <span>{snapshot.createdBy}</span>
                        </>
                      )}
                      <FiClock size={10} />
                      <span>{getRelativeTime(snapshot.createdAt)}</span>
                      <FiFile size={10} />
                      <span>{snapshot.fileCount}ファイル</span>
                      <FiHardDrive size={10} />
                      <span>{formatFileSize(snapshot.totalSize)}</span>
                    </SnapshotMeta>
                  </SnapshotDetails>
                  <SnapshotActions onClick={(e) => e.stopPropagation()}>
                    {snapshot.type === 'manual' && (
                      <Button
                        $danger
                        onClick={() => handleDeleteSnapshot(snapshot)}
                        disabled={loading}
                        title="スナップショットを削除"
                      >
                        <FiTrash2 size={12} />
                      </Button>
                    )}
                  </SnapshotActions>
                </SnapshotItem>
              ))}
            </SnapshotList>
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

export default SnapshotPanel;