import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styled, { createGlobalStyle } from 'styled-components';
import axios from 'axios';
import GridLayoutLib, { WidthProvider } from 'react-grid-layout';
import {
  FiArrowLeft,
  FiSave,
  FiFolder,
  FiGitBranch,
  FiExternalLink,
  FiCode,
  FiTerminal
} from 'react-icons/fi';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import FileTree from '../components/FileTree';
import CodeEditor from '../components/CodeEditor';
import ClaudeTerminal from '../components/ClaudeTerminal';
import GitPanel from '../components/GitPanel';
import { useAuth } from '../contexts/AuthContext';

const ReactGridLayout = WidthProvider(GridLayoutLib);

const PANEL_KEYS = ['fileTree', 'gitPanel', 'editor', 'terminal'];

const defaultLayoutMap = {
  fileTree: { i: 'fileTree', x: 0, y: 0, w: 3, h: 18, minW: 2, minH: 8 },
  gitPanel: { i: 'gitPanel', x: 0, y: 18, w: 3, h: 10, minW: 2, minH: 6 },
  editor: { i: 'editor', x: 3, y: 0, w: 6, h: 28, minW: 4, minH: 12 },
  terminal: { i: 'terminal', x: 9, y: 0, w: 3, h: 28, minW: 3, minH: 8 }
};

const defaultVisibility = {
  fileTree: true,
  gitPanel: true,
  editor: true,
  terminal: true
};

const panelDefinitions = {
  fileTree: { label: 'ファイル', icon: FiFolder },
  gitPanel: { label: 'トリップコード', icon: FiGitBranch },
  editor: { label: 'エディタ', icon: FiCode },
  terminal: { label: 'ターミナル', icon: FiTerminal }
};

const defaultZIndexMap = PANEL_KEYS.reduce((acc, key, index) => {
  acc[key] = index + 1;
  return acc;
}, {});

const defaultHighestZIndex = Math.max(...Object.values(defaultZIndexMap));

const handleHoverColor = 'rgba(255, 255, 255, 0.6)';

const formatDurationLabel = (durationMs) => {
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs) || durationMs < 0) {
    return null;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}分${remainingSeconds}秒`;
};

const notificationStatusColors = {
  success: '#2ecc71',
  warning: '#f1c40f',
  error: '#e74c3c',
  info: '#3498db'
};

const NotificationContainer = styled.ul`
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
`;

const NotificationCard = styled.li`
  background: rgba(18, 18, 20, 0.92);
  color: #ffffff;
  padding: 12px 16px;
  border-radius: 10px;
  min-width: 260px;
  max-width: 360px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  border-left: 4px solid ${({ $status }) => notificationStatusColors[$status] || notificationStatusColors.info};
  backdrop-filter: blur(6px);
`;

const NotificationTitle = styled.div`
  font-size: 0.85rem;
  opacity: 0.8;
  margin-bottom: 4px;
`;

const NotificationMessage = styled.div`
  font-size: 0.95rem;
  line-height: 1.4;
  word-break: break-word;
`;

const GridStyleOverrides = createGlobalStyle`
  .react-grid-item {
    transition: none;
  }

  .react-grid-placeholder {
    z-index: 10000 !important;
    pointer-events: none;
    border: 2px dashed rgba(255, 255, 255, 0.65);
    background: rgba(0, 122, 204, 0.2) !important;
    box-shadow: 0 0 12px rgba(0, 122, 204, 0.45);
  }

  .react-grid-item > .react-resizable-handle {
    position: absolute;
    z-index: 6;
    background: transparent !important;
  }

  .react-grid-item > .react-resizable-handle::after {
    content: '';
    position: absolute;
    background: rgba(255, 255, 255, 0.45);
    border-radius: 2px;
    transition: background 0.1s ease, opacity 0.1s ease;
    opacity: 0.85;
  }

  .react-grid-item > .react-resizable-handle:hover::after {
    background: ${handleHoverColor};
    opacity: 1;
  }

  .react-grid-item > .react-resizable-handle-se,
  .react-grid-item > .react-resizable-handle-sw,
  .react-grid-item > .react-resizable-handle-ne,
  .react-grid-item > .react-resizable-handle-nw {
    width: 20px;
    height: 20px;
  }

  .react-grid-item > .react-resizable-handle-se {
    right: -10px;
    bottom: -10px;
    cursor: se-resize;
  }

  .react-grid-item > .react-resizable-handle-se::after {
    inset: 5px;
  }

  .react-grid-item > .react-resizable-handle-sw {
    left: -10px;
    bottom: -10px;
    cursor: sw-resize;
  }

  .react-grid-item > .react-resizable-handle-sw::after {
    inset: 5px;
  }

  .react-grid-item > .react-resizable-handle-ne {
    right: -10px;
    top: -10px;
    cursor: ne-resize;
  }

  .react-grid-item > .react-resizable-handle-ne::after {
    inset: 5px;
  }

  .react-grid-item > .react-resizable-handle-nw {
    left: -10px;
    top: -10px;
    cursor: nw-resize;
  }

  .react-grid-item > .react-resizable-handle-nw::after {
    inset: 5px;
  }

  .react-grid-item > .react-resizable-handle-n,
  .react-grid-item > .react-resizable-handle-s,
  .react-grid-item > .react-resizable-handle-e,
  .react-grid-item > .react-resizable-handle-w {
    position: absolute;
    background: transparent;
    z-index: 6;
  }

  .react-grid-item > .react-resizable-handle-n,
  .react-grid-item > .react-resizable-handle-s {
    left: -16px;
    right: -16px;
    height: 24px;
  }

  .react-grid-item > .react-resizable-handle-n {
    top: -12px;
    cursor: n-resize;
  }

  .react-grid-item > .react-resizable-handle-s {
    bottom: -12px;
    cursor: s-resize;
  }

  .react-grid-item > .react-resizable-handle-n::after,
  .react-grid-item > .react-resizable-handle-s::after {
    left: 0;
    right: 0;
    top: 8px;
    bottom: 8px;
  }

  .react-grid-item > .react-resizable-handle-e,
  .react-grid-item > .react-resizable-handle-w {
    top: -16px;
    bottom: -16px;
    width: 24px;
  }

  .react-grid-item > .react-resizable-handle-e {
    right: -12px;
    cursor: e-resize;
  }

  .react-grid-item > .react-resizable-handle-w {
    left: -12px;
    cursor: w-resize;
  }

  .react-grid-item > .react-resizable-handle-e::after,
  .react-grid-item > .react-resizable-handle-w::after {
    top: 0;
    bottom: 0;
    left: 8px;
    right: 8px;
  }
`;

const IDEContainer = styled.div`
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #1e1e1e;
`;

const Header = styled.header`
  background-color: #2d2d2d;
  padding: 0.5rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #404040;
  height: 60px;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const BackButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  color: #cccccc;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.875rem;

  &:hover {
    background-color: #404040;
    color: #ffffff;
  }
`;

const ProjectTitle = styled.h1`
  color: #ffffff;
  font-size: 1.125rem;
  margin: 0;
`;

const Button = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background-color: ${props => {
    switch (props.$variant) {
      case 'primary':
        return '#007acc';
      case 'success':
        return '#28a745';
      case 'warning':
        return '#ffc107';
      default:
        return '#404040';
    }
  }};
  color: ${props => (props.$variant === 'warning' ? '#000' : '#fff')};
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
`;

const ToggleButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.6rem;
  background-color: ${props => (props.$active ? '#007acc' : '#404040')};
  color: ${props => (props.$active ? '#ffffff' : '#cccccc')};
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.2s;

  &:hover {
    background-color: ${props => (props.$active ? '#1986e6' : '#555555')};
    color: #ffffff;
  }
`;

const HeaderToggleGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-right: 1rem;
`;

const MainContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const LayoutContainer = styled.div`
  flex: 1;
  padding: 0.75rem;
  overflow: auto;
  box-sizing: border-box;
`;

const PanelWrapper = styled.div`
  background-color: #252526;
  border: 1px solid #404040;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: visible;
  position: relative;
`;

const PanelHeader = styled.div`
  padding: 0.6rem 0.9rem;
  background-color: #2d2d30;
  border-bottom: 1px solid #404040;
  color: #ffffff;
  font-size: 0.875rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  cursor: move;
`;

const PanelContent = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const PanelHeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const PanelHeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: default;
`;

const HeaderActionButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.55rem;
  background-color: ${props => props.$primary ? '#007acc' : '#404040'};
  color: #ffffff;
  border: none;
  border-radius: 3px;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background 0.2s ease;

  &:hover:not(:disabled) {
    background-color: ${props => props.$primary ? '#1986e6' : '#555555'};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const panelLabel = key => panelDefinitions[key]?.label || key;

const panelIcon = key => panelDefinitions[key]?.icon || null;

const coerceNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sanitizeLayoutItem = (item, fallback) => {
  const base = fallback || defaultLayoutMap[item.i];
  if (!base) {
    return item;
  }

  return {
    i: item.i,
    x: coerceNumber(item.x, base.x),
    y: coerceNumber(item.y, base.y),
    w: Math.max(base.minW || 1, coerceNumber(item.w, base.w)),
    h: Math.max(base.minH || 1, coerceNumber(item.h, base.h)),
    minW: base.minW,
    minH: base.minH
  };
};

const coerceLayoutMap = layout => {
  if (!layout) {
    return { ...defaultLayoutMap };
  }

  const source = Array.isArray(layout)
    ? layout.reduce((acc, entry) => {
        if (entry?.i) {
          acc[entry.i] = entry;
        }
        return acc;
      }, {})
    : layout;

  const normalized = {};
  PANEL_KEYS.forEach(key => {
    const incoming = source?.[key];
    if (incoming && typeof incoming === 'object') {
      normalized[key] = sanitizeLayoutItem({ ...incoming, i: key }, defaultLayoutMap[key]);
    } else {
      normalized[key] = { ...defaultLayoutMap[key] };
    }
  });

  return normalized;
};

const IDEPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [project, setProject] = useState(null);
  const [fileTree, setFileTree] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [manualCommitting, setManualCommitting] = useState(false);
  const notificationIdRef = useRef(0);
  const [panelVisibility, setPanelVisibility] = useState(() => ({ ...defaultVisibility }));
  const [layoutMap, setLayoutMap] = useState(() => coerceLayoutMap(defaultLayoutMap));
  const [panelZIndex, setPanelZIndex] = useState(() => ({ ...defaultZIndexMap }));
  const [layoutInitialized, setLayoutInitialized] = useState(false);

  const zCounterRef = useRef(defaultHighestZIndex);
  const previousLayoutRef = useRef(null);
  const codeEditorRef = useRef(null);

  const buildPreviewUrl = useCallback(() => {
    if (!projectId || !user?.email) {
      return '';
    }

    const envOrigin = process.env.REACT_APP_API_ORIGIN || process.env.REACT_APP_BACKEND_URL;
    let baseOrigin = envOrigin;

    if (!baseOrigin && typeof window !== 'undefined') {
      baseOrigin = window.location.origin.includes('3000')
        ? window.location.origin.replace('3000', '3001')
        : window.location.origin;
    }

    if (!baseOrigin) {
      return '';
    }

    const encodedEmail = encodeURIComponent(user.email);
    const encodedProjectDir = encodeURIComponent(projectId);
    const url = new URL(`/user_projects/${encodedEmail}/${encodedProjectDir}/index.html`, baseOrigin);
    return url.toString();
  }, [projectId, user?.email]);

  const pushNotification = useCallback((payload, durationMs = 5000) => {
    notificationIdRef.current += 1;
    const id = notificationIdRef.current;
    const entry = {
      id,
      status: payload?.status || 'info',
      provider: payload?.provider || '通知',
      message: payload?.message || ''
    };

    setNotifications((prev) => [...prev, entry]);

    if (durationMs > 0) {
      setTimeout(() => {
        setNotifications((current) => current.filter((item) => item.id !== id));
      }, durationMs);
    }

    return id;
  }, [setNotifications]);

  const handleSave = useCallback(async () => {
    if (!selectedFile) {
      return;
    }

    setSaving(true);
    try {
      if (selectedFile.id) {
        await axios.post(`/api/filesystem/${projectId}/files`, {
          fileName: selectedFile.file_name,
          filePath: selectedFile.file_path,
          content: selectedFile.content
        });
      } else {
        const pathParts = selectedFile.file_path.split('/');
        pathParts.pop();
        const parentPath = pathParts.join('/');

        await axios.post(`/api/filesystem/${projectId}/files`, {
          fileName: selectedFile.file_name,
          filePath: parentPath,
          content: selectedFile.content
        });
      }

      return true;
    } catch (error) {
      throw error;
    } finally {
      setSaving(false);
    }
  }, [selectedFile, projectId]);

  const saveCurrentFileIfNeeded = useCallback(async (options = {}) => {
    if (!selectedFile) {
      return false;
    }

    try {
      if (codeEditorRef.current?.save) {
        return await codeEditorRef.current.save(options);
      }
      return await handleSave();
    } catch (error) {
      console.error('Auto-save failed:', error);
      throw error;
    }
  }, [selectedFile, handleSave]);


  const bringPanelToFront = useCallback((panelKey) => {
    if (!PANEL_KEYS.includes(panelKey)) {
      return;
    }

    setPanelZIndex((prev) => {
      const values = Object.values(prev);
      const highest = values.length ? Math.max(...values) : 0;
      const currentValue = prev[panelKey] ?? 0;

      if (currentValue === highest && highest !== 0) {
        return prev;
      }

      const nextValue = highest + 1;
      zCounterRef.current = nextValue;
      return {
        ...prev,
        [panelKey]: nextValue
      };
    });
  }, []);

  const saveLayoutConfig = useCallback(
    async (config) => {
      if (!user) {
        return;
      }

      try {
        await axios.post('/api/user-settings/layout', { layout: config });
      } catch (error) {
        console.error('レイアウトの保存に失敗しました:', error);
      }
    },
    [user]
  );

  const applyLayoutConfig = useCallback((config) => {
    const normalizedLayout = coerceLayoutMap(config?.layout);
    const nextVisibility = {
      ...defaultVisibility,
      ...(config?.visibility && typeof config.visibility === 'object' ? config.visibility : {})
    };

    const normalizedZIndex = { ...defaultZIndexMap };
    if (config?.zIndex && typeof config.zIndex === 'object') {
      PANEL_KEYS.forEach((key) => {
        const value = Number(config.zIndex[key]);
        if (Number.isFinite(value)) {
          normalizedZIndex[key] = value;
        }
      });
    }

    const zValues = Object.values(normalizedZIndex);
    zCounterRef.current = zValues.length ? Math.max(...zValues) : defaultHighestZIndex;

    setLayoutMap(normalizedLayout);
    setPanelVisibility(nextVisibility);
    setPanelZIndex(normalizedZIndex);

    previousLayoutRef.current = {
      layout: normalizedLayout,
      visibility: nextVisibility,
      zIndex: normalizedZIndex
    };
    setLayoutInitialized(true);
  }, []);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    const fetchProject = async () => {
      try {
        const response = await axios.get(`/api/projects/${projectId}`);
        setProject(response.data);

        try {
          await axios.post(`/api/claude/start/${projectId}`);
        } catch (claudeError) {
          // Claude起動失敗は無視
        }
      } catch (error) {
        if (error.response?.status === 404) {
          navigate('/');
        }
      }
    };

    fetchProject();
  }, [projectId, navigate]);

  const fetchFileTree = useCallback(async (forceSync = false) => {
    if (!projectId) {
      return;
    }

    try {
      // 初回読み込み時またはforceSync=trueの場合は同期を実行
      const shouldSync = forceSync || !fileTree || Object.keys(fileTree).length === 0;
      const syncParam = shouldSync ? '?sync=true' : '';

      console.log(`[IDE] Fetching file tree${shouldSync ? ' with sync' : ''}`);
      const response = await axios.get(`/api/filesystem/${projectId}/tree${syncParam}`);
      setFileTree(response.data);

      const defaultFile = response.data['index.html'];
      if (defaultFile) {
        setSelectedFile(prev => prev || defaultFile);
      }
    } catch (error) {
      console.error('Error fetching file tree:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, fileTree]);

  useEffect(() => {
    fetchFileTree();
  }, [fetchFileTree]);

  // Git復元後のファイルツリー更新（強制同期）
  const handleGitRefresh = useCallback(() => {
    console.log('[IDE] Git refresh requested - forcing sync');
    fetchFileTree(true);
  }, [fetchFileTree]);

  useEffect(() => {
    if (!user || authLoading) {
      if (!authLoading && !user) {
        applyLayoutConfig({ layout: defaultLayoutMap, visibility: defaultVisibility });
      }
      return;
    }

    const loadLayout = async () => {
      try {
        const response = await axios.get('/api/user-settings/layout');
        const rawLayout = response.data?.layout;
        if (rawLayout) {
          const parsed = typeof rawLayout === 'string' ? JSON.parse(rawLayout) : rawLayout;
          applyLayoutConfig(parsed);
          return;
        }
      } catch (error) {
        console.warn('レイアウトの取得に失敗しました。デフォルトを使用します:', error.message);
      }

      applyLayoutConfig({ layout: defaultLayoutMap, visibility: defaultVisibility });
    };

    loadLayout();
  }, [user, authLoading, applyLayoutConfig]);

  useEffect(() => {
    if (!layoutInitialized || !user) {
      return;
    }

    const currentConfig = {
      layout: layoutMap,
      visibility: panelVisibility,
      zIndex: panelZIndex
    };

    const previous = previousLayoutRef.current;
    const haveChanged = JSON.stringify(previous) !== JSON.stringify(currentConfig);

    if (haveChanged) {
      previousLayoutRef.current = currentConfig;
      saveLayoutConfig(currentConfig);
    }
  }, [layoutMap, panelVisibility, panelZIndex, layoutInitialized, user, saveLayoutConfig]);

  useEffect(() => {
    if (!layoutInitialized) {
      return;
    }

    window.dispatchEvent(new Event('resize'));
  }, [layoutMap, panelVisibility, layoutInitialized]);

  const handleOpenPreview = useCallback(async () => {
    try {
      await saveCurrentFileIfNeeded();
    } catch (error) {
      console.error('Failed to save before preview:', error);
      return;
    }

    const url = buildPreviewUrl();
    if (url) {
      window.open(url, '_blank', 'noopener');
    }
  }, [buildPreviewUrl, saveCurrentFileIfNeeded]);

  const handleCommitNotification = useCallback((payload = {}) => {
    const durationLabel = formatDurationLabel(payload.durationMs);
    const providerLabel = payload.provider || 'AI CLI';
    const fallbackMessage = `トリップコードへコミットしました (${payload.count ?? 0}件${durationLabel ? `, ${durationLabel}` : ''})`;

    pushNotification({
      status: payload.status || 'info',
      provider: providerLabel,
      message: payload.message || fallbackMessage
    });

    if (payload.status === 'success') {
      fetchFileTree();
    }
    window.dispatchEvent(new CustomEvent('mindcode:gitUpdated'));
  }, [fetchFileTree, pushNotification]);

  const handleManualCommit = useCallback(async () => {
    if (!projectId || manualCommitting) {
      return;
    }

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

    try {
      try {
        await saveCurrentFileIfNeeded();
      } catch (error) {
        console.error('Failed to save before project commit:', error);
        return;
      }

      setManualCommitting(true);
      const response = await axios.post(`/api/version-control/${projectId}/commit`, {
        message: timestamp
      });

      if (!response.data?.success) {
        throw new Error(response.data?.message || '保存に失敗しました');
      }

      fetchFileTree();
      window.dispatchEvent(new CustomEvent('mindcode:gitUpdated'));
      handleCommitNotification({
        status: 'success',
        provider: 'Manual Commit',
        count: 1,
        durationMs: null,
        message: timestamp
      });
    } catch (error) {
      console.error('Manual commit error:', error);
      const rawMessage = error.response?.data?.message || error.message;
      if (/no changes|nothing to commit/i.test(rawMessage || '')) {
        alert('前回から変更がありません。');
      } else {
        alert('保存に失敗しました: ' + rawMessage);
      }
    } finally {
      setManualCommitting(false);
    }
  }, [projectId, manualCommitting, handleCommitNotification, fetchFileTree, saveCurrentFileIfNeeded]);

  const handleLayoutChange = useCallback((currentLayout) => {
    setLayoutMap(prev => {
      const updated = { ...prev };
      currentLayout.forEach(item => {
        if (item?.i && PANEL_KEYS.includes(item.i)) {
          updated[item.i] = sanitizeLayoutItem(item, prev[item.i] || defaultLayoutMap[item.i]);
        }
      });
      return updated;
    });
  }, []);

  const handleTogglePanel = useCallback((panelKey) => {
    if (!PANEL_KEYS.includes(panelKey)) {
      return;
    }

    setPanelVisibility(prev => {
      const currentlyVisible = Object.values(prev).filter(Boolean).length;
      if (prev[panelKey] && currentlyVisible <= 1) {
        return prev;
      }

      const next = { ...prev, [panelKey]: !prev[panelKey] };

      if (!prev[panelKey]) {
        bringPanelToFront(panelKey);
      }

      setLayoutMap(layoutPrev => {
        if (layoutPrev[panelKey]) {
          return layoutPrev;
        }
        return { ...layoutPrev, [panelKey]: { ...defaultLayoutMap[panelKey] } };
      });

      return next;
    });
  }, [bringPanelToFront]);

  const handleFileSelect = async (file) => {
    if (file.type !== 'file') {
      return;
    }

    if (selectedFile?.id && selectedFile.id !== file.id) {
      try {
        await saveCurrentFileIfNeeded();
      } catch (error) {
        console.error('Failed to save before switching file:', error);
        return;
      }
    }

    try {
      const response = await axios.get(`/api/filesystem/${projectId}/files/${file.id}`);
      setSelectedFile(response.data);
    } catch (error) {
      console.error('Error fetching file content:', error);
    }
  };

  const handleFileContentChange = (content) => {
    if (selectedFile) {
      setSelectedFile(prev => ({
        ...prev,
        content
      }));
    }
  };

  // 現在のファイルを再読み込み
  const refreshCurrentFile = useCallback(async () => {
    if (!selectedFile?.id || !projectId) {
      return;
    }

    try {
      const response = await axios.get(`/api/filesystem/${projectId}/files/${selectedFile.id}`);
      if (response.data) {
        console.log('[IDE] Refreshing current file content after Git restore');
        setSelectedFile(prev => ({
          ...prev,
          content: response.data.content
        }));
      }
    } catch (error) {
      console.error('Failed to refresh current file:', error);
    }
  }, [selectedFile?.id, projectId]);

  // Git復元後のファイル更新イベントリスナー
  useEffect(() => {
    const handleRefreshCurrentFile = () => {
      refreshCurrentFile();
    };

    window.addEventListener('mindcode:refreshCurrentFile', handleRefreshCurrentFile);
    return () => {
      window.removeEventListener('mindcode:refreshCurrentFile', handleRefreshCurrentFile);
    };
  }, [refreshCurrentFile]);

  const handleEditorPanelSave = useCallback(async (event) => {
    if (event) {
      event.stopPropagation();
      if ('preventDefault' in event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
    }

    if (!selectedFile || saving) {
      return;
    }

    bringPanelToFront('editor');

    try {
      await saveCurrentFileIfNeeded({ force: true });
    } catch (error) {
      console.error('Editor panel save failed:', error);
    }
  }, [selectedFile, saving, bringPanelToFront, saveCurrentFileIfNeeded]);

  const visiblePanels = useMemo(
    () => PANEL_KEYS.filter(key => panelVisibility[key]),
    [panelVisibility]
  );

  const activeLayout = useMemo(
    () =>
      visiblePanels
        .map(key => {
          const item = layoutMap[key];
          return item ? { ...item } : null;
        })
        .filter(Boolean),
    [visiblePanels, layoutMap]
  );

  if (loading) {
    return (
      <IDEContainer>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          IDEを読み込み中...
        </div>
      </IDEContainer>
    );
  }

  return (
    <IDEContainer>
      <GridStyleOverrides />
      <NotificationContainer>
        {notifications.map((item) => (
          <NotificationCard key={item.id} $status={item.status}>
            <NotificationTitle>{item.provider}</NotificationTitle>
            <NotificationMessage>{item.message}</NotificationMessage>
          </NotificationCard>
        ))}
      </NotificationContainer>
      <Header>
        <HeaderLeft>
          <BackButton onClick={() => navigate('/')}>
            <FiArrowLeft size={16} />
            ダッシュボードに戻る
          </BackButton>
          <ProjectTitle>{project?.name}</ProjectTitle>
        </HeaderLeft>

        <HeaderRight>
          <HeaderToggleGroup>
            {PANEL_KEYS.map(key => {
              const Icon = panelIcon(key);
              const active = panelVisibility[key];
              return (
                <ToggleButton
                  key={key}
                  type="button"
                  onClick={() => handleTogglePanel(key)}
                  $active={active}
                >
                  {Icon && <Icon size={14} />}
                  {panelLabel(key)}
                </ToggleButton>
              );
            })}
          </HeaderToggleGroup>
          <Button
            onClick={handleManualCommit}
            disabled={!projectId || manualCommitting}
            title="コミットを手動で保存"
          >
            <FiSave size={14} />
            プロジェクト保存
          </Button>
          <Button onClick={handleOpenPreview} disabled={!projectId || !user?.email}>
            <FiExternalLink size={14} />
            プレビュー
          </Button>
        </HeaderRight>
      </Header>

      <MainContent>
        <LayoutContainer>
          <ReactGridLayout
            layout={activeLayout}
            cols={12}
            rowHeight={30}
            margin={[16, 16]}
            compactType={null}
            preventCollision={false}
            allowOverlap
            onLayoutChange={handleLayoutChange}
            onDragStart={(layout, oldItem, newItem) => {
              if (newItem?.i) {
                bringPanelToFront(newItem.i);
              }
            }}
            onResizeStart={(layout, oldItem, newItem) => {
              if (newItem?.i) {
                bringPanelToFront(newItem.i);
              }
            }}
            draggableHandle=".panel-header"
            containerPadding={[0, 0]}
            resizeHandles={['s', 'e', 'w', 'n', 'se', 'sw', 'ne', 'nw']}
            isDraggable
            isResizable
          >
            {visiblePanels.map(key => {
              const Icon = panelIcon(key);
              const zIndex = panelZIndex[key] ?? 1;
              return (
                <div
                  key={key}
                  data-grid={{ ...layoutMap[key] }}
                  style={{ zIndex }}
                >
                  <PanelWrapper
                    onMouseDown={() => bringPanelToFront(key)}
                    onTouchStart={() => bringPanelToFront(key)}
                  >
                    <PanelHeader className="panel-header">
                      <PanelHeaderLeft>
                        {Icon && <Icon size={16} />}
                        {panelLabel(key)}
                      </PanelHeaderLeft>
                      {key === 'editor' && (
                        <PanelHeaderActions
                          onMouseDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                        >
                          <HeaderActionButton
                            type="button"
                            onClick={handleEditorPanelSave}
                            disabled={!selectedFile || saving}
                            $primary
                          >
                            <FiSave size={14} />
                            {saving ? '保存中...' : '保存'}
                          </HeaderActionButton>
                        </PanelHeaderActions>
                      )}
                    </PanelHeader>
                    <PanelContent>
                      {key === 'fileTree' && (
                        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                          <FileTree
                            fileTree={fileTree}
                            selectedFile={selectedFile}
                            onFileSelect={handleFileSelect}
                            projectId={projectId}
                            onTreeUpdate={fetchFileTree}
                          />
                        </div>
                      )}
                      {key === 'gitPanel' && (
                        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                          <GitPanel
                            projectId={projectId}
                            onRefresh={handleGitRefresh}
                          />
                        </div>
                      )}
                      {key === 'editor' && (
                        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                          <CodeEditor
                            file={selectedFile}
                            onChange={handleFileContentChange}
                            onSave={handleSave}
                            ref={codeEditorRef}
                          />
                    </div>
                  )}
                      {key === 'terminal' && (
                        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                          <ClaudeTerminal
                            projectId={projectId}
                            userToken={localStorage.getItem('token')}
                            onCommitNotification={handleCommitNotification}
                          />
                        </div>
                      )}
                    </PanelContent>
                  </PanelWrapper>
                </div>
              );
            })}
          </ReactGridLayout>
        </LayoutContainer>
      </MainContent>
    </IDEContainer>
  );
};

export default IDEPage;
