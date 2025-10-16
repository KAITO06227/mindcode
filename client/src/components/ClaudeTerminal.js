import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import io from 'socket.io-client';
import axios from 'axios';
import '@xterm/xterm/css/xterm.css';
import './ClaudeTerminal.css';

const PROVIDER_OPTIONS = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'OpenAI Codex' },
  { value: 'gemini', label: 'Google Gemini' }
];

const ClaudeTerminal = ({ projectId, userToken, onCommitNotification }) => {
  const [selectedProvider, setSelectedProvider] = useState(() => {
    if (typeof window === 'undefined') {
      return 'claude';
    }
    return localStorage.getItem('mindcode-ai-cli-provider') || 'claude';
  });

  const terminalRef = useRef(null);
  const terminalInstanceRef = useRef(null);
  const fitAddonRef = useRef(null);
  const socketRef = useRef(null);
  // Store callback ref to avoid effect re-trigger
  const onCommitNotificationRef = useRef(onCommitNotification);

  // Update callback ref when it changes
  useEffect(() => {
    onCommitNotificationRef.current = onCommitNotification;
  }, [onCommitNotification]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      localStorage.setItem('mindcode-ai-cli-provider', selectedProvider);
    } catch (error) {
    }
  }, [selectedProvider]);

  const handleProviderChange = (event) => {
    const nextProvider = event.target.value;
    const isValid = PROVIDER_OPTIONS.some((option) => option.value === nextProvider);
    setSelectedProvider(isValid ? nextProvider : 'claude');
  };


  // Initialize terminal and socket connection
  useEffect(() => {
    if (!projectId || !userToken) {
      console.error('ProjectId or userToken missing');
      return;
    }

    const providerMeta = PROVIDER_OPTIONS.find((option) => option.value === selectedProvider) || PROVIDER_OPTIONS[0];

    // Initialize xterm.js terminal
    const terminal = new Terminal({
      fontFamily: '"SFMono-Regular", "Consolas", "Liberation Mono", "Menlo", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selection: '#264f78',
        black: '#21262d',
        red: '#f85149',
        green: '#7ee787',
        yellow: '#f2cc60',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#8b949e',
        brightRed: '#ff7b72',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#58a6ff',
        brightMagenta: '#bc8cff',
        brightCyan: '#39c5cf',
        brightWhite: '#f0f6fc'
      },
      allowTransparency: true,
      scrollback: 10000,
      convertEol: true
    });

    // Add addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    fitAddonRef.current = fitAddon;
    terminalInstanceRef.current = terminal;

    // Open terminal in DOM
    const runFit = (context = 'fit') => {
      const host = terminalRef.current;
      const fitAddon = fitAddonRef.current;

      if (!host || !fitAddon) {
        return;
      }

      const { offsetWidth, offsetHeight } = host;
      if (!offsetWidth || !offsetHeight) {
        return;
      }

      try {
        fitAddon.fit();
      } catch (error) {
      }
    };

    const scheduleFit = (context = 'fit') => {
      if (typeof window === 'undefined') {
        return;
      }
      window.requestAnimationFrame(() => runFit(context));
    };

    const hostElement = terminalRef.current;

    if (hostElement) {
      terminal.open(hostElement);
      scheduleFit('initial-mount');
    }

    // Initialize socket connection
    // Use different URL for development and production
    const socketUrl = process.env.NODE_ENV === 'production' ? '/' : 'http://localhost:3001';
    
    const socket = io(socketUrl, {
      query: { projectId, token: userToken, provider: selectedProvider },
      transports: ['polling', 'websocket'], // Try polling first, then websocket
      forceNew: true,
      reconnection: true,
      timeout: 20000
    });
    
    socketRef.current = socket;

    // Socket event handlers
    socket.on('connect', () => {
      terminal.writeln('\r\n🤖 MindCode Terminal に接続しました');
      terminal.writeln('ターミナルを初期化中...\r\n');
      terminal.writeln(`選択中の AI CLI: ${providerMeta.label}\r\n`);

    });

    socket.on('disconnect', () => {
      terminal.writeln('\r\n\x1b[31m接続が切断されました\x1b[0m\r\n');
    });

    // Handle terminal output
    socket.on('output', (data) => {
      terminal.write(data);
    });

    // Auto-sync filesystem after AI operations complete
    const autoSyncAfterAI = async () => {
      console.log('[ClaudeTerminal] Starting filesystem sync for project:', projectId);
      try {
        const syncResponse = await axios.post(`/api/filesystem/${projectId}/sync`);
        console.log('[ClaudeTerminal] Filesystem sync completed:', syncResponse.data);

        // Trigger file tree refresh if available
        if (window.refreshFileTree) {
          console.log('[ClaudeTerminal] Triggering file tree refresh');
          window.refreshFileTree();
        } else {
          console.warn('[ClaudeTerminal] window.refreshFileTree is not available');
        }
      } catch (error) {
        console.error('[ClaudeTerminal] Failed to sync filesystem:', error);
      }
    };

    const handleCommitNotificationEvent = (payload) => {
      console.log('[ClaudeTerminal] Received commit_notification:', payload);

      if (typeof onCommitNotificationRef.current === 'function') {
        onCommitNotificationRef.current(payload);
      }

      // Auto-sync after commit notification (indicates AI operation completed)
      console.log('[ClaudeTerminal] Triggering auto-sync after commit notification');
      autoSyncAfterAI();
    };

    socket.on('commit_notification', handleCommitNotificationEvent);

    const handleSaveComplete = (payload) => {
      console.log('[ClaudeTerminal] Received save_complete:', payload);

      if (typeof onCommitNotificationRef.current === 'function') {
        onCommitNotificationRef.current({
          status: 'success',
          provider: 'Auto Save',
          count: (payload?.count ?? 0),
          durationMs: null,
          message: payload?.message || '保存が完了しました'
        });
      }

      // Auto-sync after save complete
      console.log('[ClaudeTerminal] Triggering auto-sync after save complete');
      autoSyncAfterAI();
    };

    socket.on('save_complete', handleSaveComplete);

    // Handle terminal input - send directly to server like ../claude
    terminal.onData((data) => {
      socket.emit('input', data);
    });

    // Handle terminal resize - like ../claude
    terminal.onResize(({ cols, rows }) => {
      socket.emit('resize', { cols, rows });
    });

    // Handle window resize
    const handleResize = () => {
      scheduleFit('window-resize');
    };

    window.addEventListener('resize', handleResize);

    const handleBeforeUnload = () => {
      if (!socketRef.current) {
        return;
      }
      try {
        socketRef.current.emit('terminate_session');
      } catch (emitError) {
      }
      try {
        socketRef.current.disconnect();
      } catch (disconnectError) {
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined' && hostElement) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect || {};
          if (width > 0 && height > 0) {
            scheduleFit('resize-observer');
          }
        }
      });
      resizeObserver.observe(hostElement);
    }

    // Initial resize after mount
    setTimeout(() => scheduleFit('initial-resize'), 200);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (resizeObserver && hostElement) {
        resizeObserver.unobserve(hostElement);
        resizeObserver.disconnect();
      }
      if (socketRef.current) {
        try {
          socketRef.current.emit('terminate_session');
        } catch (emitError) {
        }
        socketRef.current.off('commit_notification', handleCommitNotificationEvent);
        socketRef.current.off('save_complete', handleSaveComplete);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.dispose();
        terminalInstanceRef.current = null;
      }
      if (fitAddonRef.current) {
        fitAddonRef.current.dispose?.();
        fitAddonRef.current = null;
      }
    };
  }, [projectId, selectedProvider, userToken]);

  return (
    <div
      className="claude-terminal-container"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '6px 12px',
          backgroundColor: '#161b22',
          borderBottom: '1px solid #30363d',
          fontSize: '12px',
          color: '#c9d1d9'
        }}
      >
        <span style={{ fontWeight: 600 }}>AI CLI</span>
        <select
          value={selectedProvider}
          onChange={handleProviderChange}
          style={{
            backgroundColor: '#0d1117',
            color: '#e6edf3',
            border: '1px solid #30363d',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '12px',
            cursor: 'pointer'
          }}
        >
          {PROVIDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div
        ref={terminalRef}
        className="claude-terminal-host"
        style={{
          flex: 1,
          width: '100%',
          backgroundColor: '#0d1117',
          padding: '8px',
          paddingBottom: '16px',
          boxSizing: 'border-box'
        }}
      />
    </div>
  );
};

export default ClaudeTerminal;
