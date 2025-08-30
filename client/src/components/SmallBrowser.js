import React, { useState, useRef, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import axios from 'axios';
import ProjectServerController from './ProjectServerController';
import {
  FiArrowLeft,
  FiArrowRight,
  FiRefreshCw,
  FiExternalLink,
  FiPlay,
  FiMonitor,
  FiServer
} from 'react-icons/fi';

const BrowserContainer = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #1e1e1e;
`;

const TabContainer = styled.div`
  display: flex;
  align-items: center;
  background-color: #2d2d2d;
  border-bottom: 1px solid #404040;
`;

const Tab = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background-color: ${props => props.$active ? '#1e1e1e' : '#2d2d2d'};
  border: none;
  border-bottom: ${props => props.$active ? '2px solid #007acc' : '2px solid transparent'};
  color: ${props => props.$active ? '#ffffff' : '#cccccc'};
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.875rem;
  min-width: 140px;
  justify-content: center;

  &:hover {
    background-color: ${props => props.$active ? '#1e1e1e' : '#404040'};
    color: #ffffff;
  }
`;

const BrowserToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background-color: #2d2d2d;
  border-bottom: 1px solid #404040;
  min-height: 40px;
`;

const ToolbarButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background-color: #404040;
  border: none;
  border-radius: 4px;
  color: #cccccc;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    background-color: #555555;
    color: #ffffff;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const BrowserLabel = styled.span`
  color: #cccccc;
  font-size: 0.75rem;
  font-weight: 500;
  margin-left: auto;
  margin-right: 0.5rem;
`;

const ContentContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const IframeContainer = styled.div`
  flex: 1;
  position: relative;
  background-color: #ffffff;
`;

const IFrame = styled.iframe`
  width: 100%;
  height: 100%;
  border: none;
  background-color: #ffffff;
`;


const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.1);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
`;

const LoadingSpinner = styled.div`
  width: 20px;
  height: 20px;
  border: 2px solid #cccccc;
  border-top: 2px solid #007acc;
  border-radius: 50%;
  animation: spin 1s linear infinite;

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const ErrorMessage = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  color: #888888;
  text-align: center;
  padding: 2rem;
`;

const ErrorTitle = styled.h3`
  color: #cccccc;
  margin-bottom: 0.5rem;
`;

const SmallBrowser = ({ projectId, userToken }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [navigationHistory] = useState(['']);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' or 'server'
  const [serverStatus, setServerStatus] = useState({
    status: 'stopped',
    port: null,
    proxyUrl: null
  });
  const iframeRef = useRef(null);

  // Fetch server status
  const fetchServerStatus = useCallback(async () => {
    if (!projectId) return;
    
    try {
      const response = await axios.get(`/api/project-proxy/${projectId}/status`);
      console.log('SmallBrowser: Server status response:', response.data);
      setServerStatus(response.data);
      setError(null);
    } catch (error) {
      console.error('Error fetching server status:', error);
      setServerStatus({
        status: 'stopped',
        port: null,
        proxyUrl: null
      });
    }
  }, [projectId]);



  // Initial server status fetch and periodic refresh
  useEffect(() => {
    fetchServerStatus();
    
    const interval = setInterval(() => {
      fetchServerStatus();
    }, 5000); // Check server status every 5 seconds

    return () => clearInterval(interval);
  }, [fetchServerStatus]);




  const handleBack = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      // In a real implementation, this would navigate back
    }
  };

  const handleForward = () => {
    if (currentIndex < navigationHistory.length - 1) {
      setCurrentIndex(currentIndex + 1);
      // In a real implementation, this would navigate forward
    }
  };

  const handleRefresh = () => {
    console.log('SmallBrowser: Manual refresh triggered');
    
    // Refresh server status and reload preview
    fetchServerStatus();
  };

  const handleOpenInNewTab = () => {
    // Open server URL in new tab if server is running
    if (serverStatus.status === 'running' && serverStatus.port) {
      const serverUrl = `${window.location.protocol}//${window.location.hostname}:${serverStatus.port}`;
      window.open(serverUrl, '_blank');
    } else {
      console.warn('SmallBrowser: Server is not running');
    }
  };

  const handleRunProject = () => {
    fetchServerStatus();
  };

  if (error && activeTab === 'preview') {
    return (
      <BrowserContainer>
        <TabContainer>
          <Tab 
            $active={activeTab === 'preview'} 
            onClick={() => setActiveTab('preview')}
          >
            <FiMonitor size={16} />
            スモールブラウザー
          </Tab>
          <Tab 
            $active={activeTab === 'server'} 
            onClick={() => setActiveTab('server')}
          >
            <FiServer size={16} />
            サーバー
          </Tab>
        </TabContainer>
        <BrowserToolbar>
          <ToolbarButton onClick={handleRunProject}>
            <FiPlay size={14} />
          </ToolbarButton>
          <BrowserLabel>スモールブラウザ</BrowserLabel>
        </BrowserToolbar>
        <ErrorMessage>
          <ErrorTitle>Preview Error</ErrorTitle>
          <p>{error}</p>
          <ToolbarButton onClick={fetchServerStatus} style={{ marginTop: '1rem', width: 'auto', padding: '0.5rem 1rem' }}>
            <FiRefreshCw size={14} style={{ marginRight: '0.5rem' }} />
            Retry
          </ToolbarButton>
        </ErrorMessage>
      </BrowserContainer>
    );
  }

  return (
    <BrowserContainer>
      {/* Tab Navigation */}
      <TabContainer>
        <Tab 
          $active={activeTab === 'preview'} 
          onClick={() => setActiveTab('preview')}
        >
          <FiMonitor size={16} />
          スモールブラウザー
        </Tab>
        <Tab 
          $active={activeTab === 'server'} 
          onClick={() => setActiveTab('server')}
        >
          <FiServer size={16} />
          サーバー
        </Tab>
      </TabContainer>

      {/* Tab Content */}
      <ContentContainer>
        {activeTab === 'preview' && (
          <>
            <BrowserToolbar>
              <ToolbarButton
                onClick={handleBack}
                disabled={currentIndex === 0}
                title="Back"
              >
                <FiArrowLeft size={14} />
              </ToolbarButton>
              
              <ToolbarButton
                onClick={handleForward}
                disabled={currentIndex >= navigationHistory.length - 1}
                title="Forward"
              >
                <FiArrowRight size={14} />
              </ToolbarButton>
              
              <ToolbarButton
                onClick={handleRefresh}
                title="Refresh"
              >
                <FiRefreshCw size={14} />
              </ToolbarButton>
              
              <BrowserLabel>プレビュー</BrowserLabel>
              
              <ToolbarButton
                onClick={handleOpenInNewTab}
                title="Open in new tab"
                disabled={serverStatus.status !== 'running'}
              >
                <FiExternalLink size={14} />
              </ToolbarButton>
            </BrowserToolbar>

            <IframeContainer>
              {loading && (
                <LoadingOverlay>
                  <LoadingSpinner />
                </LoadingOverlay>
              )}
              
              {serverStatus.status === 'running' && serverStatus.proxyUrl ? (
                <>
                  <div style={{ 
                    padding: '0.5rem', 
                    backgroundColor: '#f0f0f0', 
                    borderBottom: '1px solid #ccc',
                    fontSize: '0.75rem',
                    fontFamily: 'monospace'
                  }}>
                    プレビューURL: {`${window.location.protocol}//${window.location.hostname}:${serverStatus.port}`}
                  </div>
                  <IFrame
                    ref={iframeRef}
                    title="Server Preview"
                    sandbox="allow-scripts allow-forms allow-same-origin"
                    src={`${window.location.protocol}//${window.location.hostname}:${serverStatus.port}`}
                    onLoad={() => {
                      const iframeSrc = `${window.location.protocol}//${window.location.hostname}:${serverStatus.port}`;
                      console.log('SmallBrowser: Iframe loaded with src:', iframeSrc);
                      console.log('SmallBrowser: ServerStatus:', serverStatus);
                      console.log('SmallBrowser: Current iframe URL:', iframeRef.current?.src);
                    }}
                  />
                </>
              ) : (
                <ErrorMessage>
                  <ErrorTitle>サーバープレビュー</ErrorTitle>
                  <p>
                    {serverStatus.status === 'starting' ? 
                      'サーバーを起動中です...' : 
                      'プレビューを表示するにはサーバーを起動してください'}
                  </p>
                  <div style={{ marginTop: '1rem', color: '#888888', fontSize: '0.875rem' }}>
                    現在の状態: {
                      serverStatus.status === 'stopped' ? 'サーバー停止中' :
                      serverStatus.status === 'starting' ? 'サーバー起動中' :
                      serverStatus.status === 'error' ? 'サーバーエラー' :
                      '不明な状態'
                    }
                  </div>
                </ErrorMessage>
              )}
            </IframeContainer>
          </>
        )}


        {activeTab === 'server' && (
          <div style={{ 
            padding: '1rem', 
            backgroundColor: '#1e1e1e', 
            height: '100%', 
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ marginBottom: '1rem', color: '#ffffff' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FiServer size={20} />
                Node.js プロジェクトサーバー
              </h3>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <ProjectServerController projectId={projectId} />
            </div>
          </div>
        )}
      </ContentContainer>
    </BrowserContainer>
  );
};

export default SmallBrowser;