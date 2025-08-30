import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import io from 'socket.io-client';
import axios from 'axios';
import '@xterm/xterm/css/xterm.css';

const ServerTerminal = ({ projectId, userToken }) => {
  const terminalRef = useRef(null);
  const terminalInstanceRef = useRef(null);
  const fitAddonRef = useRef(null);
  const socketRef = useRef(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [serverStatus, setServerStatus] = useState('initializing');

  // Auto-sync filesystem after server operations
  const autoSyncAfterServerCommand = async () => {
    try {
      console.log('Auto-syncing filesystem after server command...');
      await axios.post(`/api/filesystem/${projectId}/sync`);
      console.log('Auto-sync completed successfully');
      
      // Trigger file tree refresh if available
      if (window.refreshFileTree) {
        window.refreshFileTree();
      }
    } catch (error) {
      console.warn('Auto-sync failed:', error);
    }
  };

  // Initialize terminal and socket connection
  useEffect(() => {
    if (!projectId || !userToken) {
      console.error('ProjectId or userToken missing');
      return;
    }

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
    if (terminalRef.current) {
      terminal.open(terminalRef.current);
      setTimeout(() => fitAddon.fit(), 100);
    }

    // Initialize socket connection for server terminal
    const socketUrl = process.env.NODE_ENV === 'production' ? '/' : 'http://localhost:3001';
    console.log('Connecting to Server Terminal Socket.IO:', socketUrl);
    
    const socket = io(socketUrl, {
      query: { projectId, token: userToken, terminalType: 'server' },
      transports: ['polling', 'websocket'],
      forceNew: true,
      reconnection: true,
      timeout: 20000
    });
    
    socketRef.current = socket;

    // Socket event handlers
    socket.on('connect', () => {
      console.log('✅ Server Terminal Socket.IO connected successfully');
      setConnectionStatus('connected');
      setServerStatus('ready');
      terminal.writeln('\r\n🚀 MindCode Server Terminal に接続しました');
      terminal.writeln('Node.js プロジェクト用ターミナルを初期化中...\r\n');
    });

    socket.on('disconnect', (reason) => {
      console.log('❌ Server Terminal Socket.IO disconnected:', reason);
      setConnectionStatus('disconnected');
      terminal.writeln('\r\n\x1b[31m接続が切断されました\x1b[0m\r\n');
    });

    // Handle terminal output
    socket.on('output', (data) => {
      terminal.write(data);
      
      // Detect common Node.js server commands and auto-sync
      const outputText = data.toString();
      if (outputText.includes('npm install') || 
          outputText.includes('npm run') || 
          outputText.includes('node ') ||
          outputText.includes('Server running')) {
        
        // Auto-sync after command completion (detect prompt return)
        if (outputText.includes('$') || outputText.includes('>')) {
          setTimeout(autoSyncAfterServerCommand, 1000);
        }
      }
    });

    // Handle terminal input
    terminal.onData((data) => {
      socket.emit('input', data);
    });

    // Handle terminal resize
    terminal.onResize(({ cols, rows }) => {
      socket.emit('resize', { cols, rows });
    });

    // Handle window resize
    const handleResize = () => {
      if (fitAddonRef.current && terminalInstanceRef.current) {
        fitAddonRef.current.fit();
      }
    };

    window.addEventListener('resize', handleResize);
    
    // Initial resize
    setTimeout(handleResize, 200);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.dispose();
      }
    };
  }, [projectId, userToken]);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>      
      {/* Terminal container */}
      <div 
        ref={terminalRef} 
        style={{ 
          height: '100%',
          width: '100%',
          padding: '8px'
        }} 
      />
    </div>
  );
};

export default ServerTerminal;