import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import io from 'socket.io-client';
import axios from 'axios';
import '@xterm/xterm/css/xterm.css';

const ClaudeTerminal = ({ projectId, userToken }) => {
  const terminalRef = useRef(null);
  const terminalInstanceRef = useRef(null);
  const fitAddonRef = useRef(null);
  const socketRef = useRef(null);
  // Track command activity without retriggering effect
  const claudeCommandActiveRef = useRef(false);


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

    // Initialize socket connection
    // Use different URL for development and production
    const socketUrl = process.env.NODE_ENV === 'production' ? '/' : 'http://localhost:3001';
    console.log('Connecting to Socket.IO server:', socketUrl);
    
    const socket = io(socketUrl, {
      query: { projectId, token: userToken },
      transports: ['polling', 'websocket'], // Try polling first, then websocket
      forceNew: true,
      reconnection: true,
      timeout: 20000
    });
    
    socketRef.current = socket;

    // Socket event handlers
    socket.on('connect', () => {
      console.log('✅ Socket.IO connected successfully');
      terminal.writeln('\r\n🤖 MindCode Terminal に接続しました');
      terminal.writeln('ターミナルを初期化中...\r\n');

    });

    socket.on('disconnect', (reason) => {
      console.log('❌ Socket.IO disconnected:', reason);
      terminal.writeln('\r\n\x1b[31m接続が切断されました\x1b[0m\r\n');
    });

    // Auto-sync filesystem after Claude Code commands
    const autoSyncAfterClaude = async () => {
      try {
        console.log('Auto-syncing filesystem after Claude Code command...');
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

    // Handle terminal output
    socket.on('output', (data) => {
      terminal.write(data);
      
      // Detect Claude Code command execution
      const outputText = data.toString();
      
      // Detect when Claude Code command starts
      if (outputText.includes('claude') && !claudeCommandActiveRef.current) {
        claudeCommandActiveRef.current = true;
        console.log('Claude Code command detected, starting monitoring...');
      }
      
      // Detect when Claude Code command ends (prompt returns)
      if (claudeCommandActiveRef.current && (outputText.includes('$') || outputText.includes('>') || outputText.includes('You:'))) {
        claudeCommandActiveRef.current = false;
        console.log('Claude Code command completed, triggering auto-sync...');
        
        // Auto-sync after a short delay to ensure command is fully completed
        setTimeout(autoSyncAfterClaude, 2000);
      }
    });

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
