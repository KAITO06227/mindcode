import React, { useState, useRef, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import {
  FiArrowLeft,
  FiArrowRight,
  FiRefreshCw,
  FiExternalLink,
  FiPlay
} from 'react-icons/fi';

const BrowserContainer = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #1e1e1e;
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

const getApiOrigin = () => {
  const envOrigin = process.env.REACT_APP_API_ORIGIN || process.env.REACT_APP_BACKEND_URL;
  if (envOrigin) {
    return envOrigin;
  }

  if (window.location.origin.includes('3000')) {
    return window.location.origin.replace('3000', '3001');
  }

  return window.location.origin;
};

const arraysEqual = (a, b) => {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
};

const SmallBrowser = ({ projectId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [iframeSrc, setIframeSrc] = useState('');
  const [navigationHistory, setNavigationHistory] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const iframeRef = useRef(null);

  const buildPreviewUrl = useCallback(() => {
    if (!projectId) {
      return '';
    }

    const baseOrigin = getApiOrigin();
    const url = new URL(`/api/projects/${projectId}/live`, baseOrigin);
    url.searchParams.set('ts', Date.now());
    return url.toString();
  }, [projectId]);

  const loadProject = useCallback(() => {
    if (!projectId) {
      setError('プロジェクトが選択されていません');
      setIframeSrc('');
      setNavigationHistory([]);
      setCurrentIndex(-1);
      return;
    }

    setError(null);
    setLoading(true);
    const url = buildPreviewUrl();
    setIframeSrc(url);
    setNavigationHistory([url]);
    setCurrentIndex(0);
  }, [projectId, buildPreviewUrl]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  const handleIframeLoad = useCallback(() => {
    setLoading(false);

    try {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow) {
        return;
      }

      const url = iframeWindow.location.href;
      if (!url) {
        return;
      }

      if (
        currentIndex >= 0 &&
        currentIndex < navigationHistory.length &&
        navigationHistory[currentIndex] === url
      ) {
        return;
      }

      const baseLength = currentIndex >= 0 ? currentIndex + 1 : 0;
      const baseHistory = navigationHistory.slice(0, baseLength);
      let updatedHistory = baseHistory;

      if (updatedHistory.length === 0 || updatedHistory[updatedHistory.length - 1] !== url) {
        updatedHistory = [...updatedHistory, url];
      }

      if (!arraysEqual(updatedHistory, navigationHistory)) {
        setNavigationHistory(updatedHistory);
      }
      setCurrentIndex(updatedHistory.length - 1);
    } catch (iframeError) {
      console.warn('SmallBrowser: Unable to access iframe location', iframeError);
    }
  }, [currentIndex, navigationHistory]);

  const handleIframeError = () => {
    setLoading(false);
    setError('プレビューの読み込みに失敗しました');
  };

  const navigateTo = useCallback((url, newIndex) => {
    if (!url) {
      return;
    }

    setError(null);
    setLoading(true);
    setIframeSrc(url);
    setCurrentIndex(newIndex);
  }, []);

  const handleBack = () => {
    if (currentIndex > 0) {
      const targetIndex = currentIndex - 1;
      navigateTo(navigationHistory[targetIndex], targetIndex);
    }
  };

  const handleForward = () => {
    if (currentIndex < navigationHistory.length - 1) {
      const targetIndex = currentIndex + 1;
      navigateTo(navigationHistory[targetIndex], targetIndex);
    }
  };

  const handleRefresh = () => {
    if (currentIndex >= 0 && navigationHistory[currentIndex]) {
      const url = new URL(navigationHistory[currentIndex]);
      url.searchParams.set('ts', Date.now());
      const refreshed = url.toString();

      const updatedHistory = [...navigationHistory];
      updatedHistory[currentIndex] = refreshed;

      setNavigationHistory(updatedHistory);
      navigateTo(refreshed, currentIndex);
    } else {
      loadProject();
    }
  };

  const handleOpenInNewTab = () => {
    const url =
      (currentIndex >= 0 && navigationHistory[currentIndex]) || buildPreviewUrl();

    if (url) {
      window.open(url, '_blank', 'noopener');
    }
  };

  const handleRunProject = () => {
    loadProject();
  };

  if (error) {
    return (
      <BrowserContainer>
        <BrowserToolbar>
          <ToolbarButton onClick={handleRunProject} title="Run">
            <FiPlay size={14} />
          </ToolbarButton>
          <BrowserLabel>スモールブラウザ</BrowserLabel>
        </BrowserToolbar>
        <ErrorMessage>
          <ErrorTitle>Preview Error</ErrorTitle>
          <p>{error}</p>
          <ToolbarButton
            onClick={loadProject}
            style={{ marginTop: '1rem', width: 'auto', padding: '0.5rem 1rem' }}
            title="Retry"
          >
            <FiRefreshCw size={14} style={{ marginRight: '0.5rem' }} />
            Retry
          </ToolbarButton>
        </ErrorMessage>
      </BrowserContainer>
    );
  }

  return (
    <BrowserContainer>
      <BrowserToolbar>
        <ToolbarButton
          onClick={handleBack}
          disabled={currentIndex <= 0}
          title="Back"
        >
          <FiArrowLeft size={14} />
        </ToolbarButton>

        <ToolbarButton
          onClick={handleForward}
          disabled={currentIndex < 0 || currentIndex >= navigationHistory.length - 1}
          title="Forward"
        >
          <FiArrowRight size={14} />
        </ToolbarButton>

        <ToolbarButton
          onClick={handleRefresh}
          title="Refresh"
          disabled={!iframeSrc}
        >
          <FiRefreshCw size={14} />
        </ToolbarButton>

        <BrowserLabel>スモールブラウザ</BrowserLabel>

        <ToolbarButton
          onClick={handleOpenInNewTab}
          title="Open in new tab"
          disabled={!iframeSrc}
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

        <IFrame
          ref={iframeRef}
          title="Project Preview"
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          src={iframeSrc}
          onLoad={handleIframeLoad}
          onError={handleIframeError}
        />
      </IframeContainer>
    </BrowserContainer>
  );
};

export default SmallBrowser;
