import React, { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import axios from 'axios';
import io from 'socket.io-client';
import {
  FiPlay,
  FiSquare,
  FiRefreshCcw,
  FiExternalLink,
  FiActivity,
  FiAlertCircle
} from 'react-icons/fi';

const ControllerContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background-color: #2d2d2d;
  border-radius: 6px;
  border: 1px solid #404040;

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`;

const ServerStatus = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background-color: ${props => {
    switch (props.$status) {
      case 'running': return '#1e3a2e';
      case 'starting': return '#3a2e1e';
      case 'stopped': return '#3a1e1e';
      default: return '#1e1e1e';
    }
  }};
  border-radius: 4px;
  border-left: 4px solid ${props => {
    switch (props.$status) {
      case 'running': return '#28a745';
      case 'starting': return '#ffc107';
      case 'stopped': return '#6c757d';
      default: return '#dc3545';
    }
  }};
`;

const StatusIcon = styled.div`
  color: ${props => {
    switch (props.$status) {
      case 'running': return '#28a745';
      case 'starting': return '#ffc107';
      case 'stopped': return '#6c757d';
      default: return '#dc3545';
    }
  }};
`;

const StatusText = styled.div`
  color: #ffffff;
  font-size: 0.875rem;
  flex: 1;
`;

const StatusDetails = styled.div`
  color: #cccccc;
  font-size: 0.75rem;
  margin-top: 0.25rem;
`;

const ControlButtons = styled.div`
  display: flex;
  gap: 0.5rem;
`;

const ControlButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background-color: ${props => {
    if (props.$primary) return '#007acc';
    if (props.$danger) return '#dc3545';
    return '#404040';
  }};
  border: none;
  border-radius: 4px;
  color: #ffffff;
  cursor: pointer;
  font-size: 0.875rem;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    background-color: ${props => {
      if (props.$primary) return '#0056b3';
      if (props.$danger) return '#c82333';
      return '#555555';
    }};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;


const ServerLogContainer = styled.div`
  margin-top: 1rem;
  background-color: #0d1117;
  border-radius: 4px;
  border: 1px solid #30363d;
  max-height: 300px;
  overflow-y: auto;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
`;

const LogHeader = styled.div`
  padding: 0.5rem 0.75rem;
  background-color: #161b22;
  border-bottom: 1px solid #30363d;
  color: #8b949e;
  font-size: 0.75rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const LogContent = styled.div`
  padding: 0.5rem;
  color: #e6edf3;
  font-size: 0.75rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
`;

const LogLine = styled.div`
  margin-bottom: 0.25rem;
  color: ${props => {
    if (props.$type === 'error') return '#f85149';
    if (props.$type === 'warning') return '#f0883e';
    if (props.$type === 'success') return '#3fb950';
    return '#e6edf3';
  }};
`;

const ProjectServerController = ({ projectId }) => {
  const [serverStatus, setServerStatus] = useState({
    status: 'stopped',
    port: null,
    proxyUrl: null,
    uptime: 0,
    error: null
  });
  const [loading, setLoading] = useState(false);
  const [serverLogs, setServerLogs] = useState([]);
  const [socket, setSocket] = useState(null);
  const logContainerRef = useRef(null);

  // Add log message with auto-scroll
  const addLogMessage = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      id: Date.now() + Math.random(),
      timestamp,
      message,
      type
    };
    
    setServerLogs(prev => {
      const newLogs = [...prev, logEntry];
      // Keep only last 100 log entries to prevent memory issues
      return newLogs.slice(-100);
    });
    
    // Auto-scroll to bottom
    setTimeout(() => {
      if (logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      }
    }, 10);
  };

  // Clear logs
  const clearLogs = () => {
    setServerLogs([]);
  };

  // Format uptime
  const formatUptime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };


  // Fetch server status
  const fetchServerStatus = async () => {
    try {
      const response = await axios.get(`/api/project-proxy/${projectId}/status`);
      const newStatus = response.data;
      
      // Log status changes only if not already logged by Socket.IO
      if (serverStatus.status !== newStatus.status && !socket) {
        switch (newStatus.status) {
          case 'running':
            addLogMessage(`✅ サーバーが正常に起動しました (ポート: ${newStatus.port})`, 'success');
            break;
          case 'stopped':
            addLogMessage('🔴 サーバーが停止しました', 'info');
            break;
          case 'error':
            addLogMessage(`❌ サーバーエラー: ${newStatus.error}`, 'error');
            break;
        }
      }
      
      setServerStatus(newStatus);
    } catch (error) {
      console.error('Error fetching server status:', error);
      setServerStatus(prev => ({ 
        ...prev, 
        status: 'error', 
        error: error.response?.data?.message || 'Failed to fetch status' 
      }));
    }
  };

  // Start server
  const startServer = async () => {
    setLoading(true);
    clearLogs(); // Clear previous logs
    addLogMessage('🚀 サーバーを起動しています...', 'info');
    
    try {
      const response = await axios.post(`/api/project-proxy/${projectId}/start`);
      console.log('Server start response:', response.data);
      addLogMessage(`✅ サーバー起動コマンドを送信しました (ポート: ${response.data.port})`, 'success');
      addLogMessage(`📁 プロジェクトディレクトリ: user_projects/1/${projectId}`, 'info');
      addLogMessage(`🔧 Node.js サーバープロセスを開始中...`, 'info');
      
      // Update status immediately and then poll for running status
      setServerStatus(prev => ({ ...prev, status: 'starting' }));
      
      // Poll for server status
      let attempts = 0;
      const maxAttempts = 15; // 30 seconds with 2-second intervals
      
      const checkStatus = async () => {
        try {
          await fetchServerStatus();
          attempts++;
          
          if (attempts < maxAttempts) {
            setTimeout(checkStatus, 2000);
          }
        } catch (error) {
          console.error('Error checking server status:', error);
          addLogMessage(`❌ 状態確認エラー: ${error.message}`, 'error');
        }
      };
      
      setTimeout(checkStatus, 1000);
      
    } catch (error) {
      console.error('Error starting server:', error);
      const errorMessage = error.response?.data?.message || 'Failed to start server';
      addLogMessage(`❌ サーバー起動エラー: ${errorMessage}`, 'error');
      setServerStatus(prev => ({ 
        ...prev, 
        status: 'error', 
        error: errorMessage 
      }));
    } finally {
      setLoading(false);
    }
  };

  // Stop server
  const stopServer = async () => {
    setLoading(true);
    addLogMessage('🔴 サーバーを停止しています...', 'info');
    
    try {
      await axios.post(`/api/project-proxy/${projectId}/stop`);
      setServerStatus(prev => ({ ...prev, status: 'stopping' }));
      addLogMessage('✅ サーバー停止コマンドを送信しました', 'success');
      
      // Check status after a delay
      setTimeout(fetchServerStatus, 2000);
      
    } catch (error) {
      console.error('Error stopping server:', error);
      addLogMessage(`❌ サーバー停止エラー: ${error.response?.data?.message || error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Refresh status
  const refreshStatus = async () => {
    setLoading(true);
    await fetchServerStatus();
    setLoading(false);
  };


  // Socket.IO connection for real-time server logs
  useEffect(() => {
    if (!projectId) return;

    // Create socket connection
    const newSocket = io();
    setSocket(newSocket);

    // Listen for server logs
    newSocket.on(`server_log_${projectId}`, (logData) => {
      const logType = logData.type === 'stderr' ? 'error' : 
                     logData.type === 'info' ? 'info' : 'success';
      
      // Clean and format log data (remove extra newlines)
      const cleanData = logData.data.replace(/\n+$/, '');
      if (cleanData.trim()) {
        addLogMessage(cleanData, logType);
      }
    });

    // Listen for server status updates
    newSocket.on(`server_status_${projectId}`, (statusData) => {
      setServerStatus(prev => ({
        ...prev,
        status: statusData.status,
        port: statusData.port || prev.port,
        proxyUrl: statusData.port ? `/api/project-proxy/${projectId}/app` : null
      }));
      
      if (statusData.message) {
        addLogMessage(statusData.message, statusData.status === 'error' ? 'error' : 'success');
      }
    });

    return () => {
      newSocket.disconnect();
      setSocket(null);
    };
  }, [projectId]);

  // Initial load and periodic refresh
  useEffect(() => {
    fetchServerStatus();
    
    // Refresh status every 10 seconds when server is running or starting
    const interval = setInterval(() => {
      if (serverStatus.status === 'running' || serverStatus.status === 'starting') {
        fetchServerStatus();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [projectId]);

  // Status icon and text
  const getStatusIcon = () => {
    switch (serverStatus.status) {
      case 'running':
        return <FiActivity size={16} />;
      case 'starting':
        return <FiRefreshCcw size={16} className="spinning" />;
      case 'stopped':
        return <FiSquare size={16} />;
      default:
        return <FiAlertCircle size={16} />;
    }
  };

  const getStatusMessage = () => {
    switch (serverStatus.status) {
      case 'running':
        return `サーバー稼働中 (ポート: ${serverStatus.port})`;
      case 'starting':
        return 'サーバー起動中...';
      case 'stopping':
        return 'サーバー停止中...';
      case 'stopped':
        return 'サーバー停止中';
      case 'error':
        return 'サーバーエラー';
      default:
        return '状態不明';
    }
  };

  return (
    <ControllerContainer>
      <ServerStatus $status={serverStatus.status}>
        <StatusIcon $status={serverStatus.status}>
          {getStatusIcon()}
        </StatusIcon>
        <StatusText>
          {getStatusMessage()}
          {serverStatus.uptime > 0 && (
            <StatusDetails>稼働時間: {formatUptime(serverStatus.uptime)}</StatusDetails>
          )}
          {serverStatus.error && (
            <StatusDetails style={{ color: '#ff6b6b' }}>
              エラー: {serverStatus.error}
            </StatusDetails>
          )}
        </StatusText>
      </ServerStatus>


      <ControlButtons>
        {serverStatus.status === 'running' ? (
          <ControlButton 
            $danger 
            onClick={stopServer} 
            disabled={loading}
          >
            <FiSquare size={16} />
            サーバー停止
          </ControlButton>
        ) : (
          <ControlButton 
            $primary 
            onClick={startServer} 
            disabled={loading || serverStatus.status === 'starting'}
          >
            <FiPlay size={16} />
            サーバー開始
          </ControlButton>
        )}
        
        <ControlButton onClick={refreshStatus} disabled={loading}>
          <FiRefreshCcw size={16} />
          状態更新
        </ControlButton>
      </ControlButtons>

      {/* Server Logs */}
      {(serverStatus.status === 'running' || serverStatus.status === 'starting' || serverLogs.length > 0) && (
        <ServerLogContainer>
          <LogHeader>
            <FiActivity size={14} />
            サーバーログ
            <div style={{ marginLeft: 'auto' }}>
              <button
                onClick={clearLogs}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#8b949e',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  padding: '0.25rem',
                }}
                title="ログをクリア"
              >
                クリア
              </button>
            </div>
          </LogHeader>
          <LogContent ref={logContainerRef}>
            {serverLogs.length === 0 ? (
              <LogLine>ログはまだありません...</LogLine>
            ) : (
              serverLogs.map((log) => (
                <LogLine key={log.id} $type={log.type}>
                  <span style={{ color: '#8b949e' }}>[{log.timestamp}]</span> {log.message}
                </LogLine>
              ))
            )}
          </LogContent>
        </ServerLogContainer>
      )}
    </ControllerContainer>
  );
};

export default ProjectServerController;