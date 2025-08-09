import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import styled from 'styled-components';
import axios from 'axios';
import '@xterm/xterm/css/xterm.css';

const TerminalContainer = styled.div`
  height: 100%;
  background-color: #1e1e1e;
  position: relative;
`;

const TerminalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  background-color: #2d2d2d;
  border-bottom: 1px solid #404040;
  color: #cccccc;
  font-size: 0.75rem;
`;

const TerminalTitle = styled.span`
  font-weight: 500;
`;

const TerminalActions = styled.div`
  display: flex;
  gap: 0.5rem;
`;

const ActionButton = styled.button`
  background: none;
  border: 1px solid #555;
  color: #cccccc;
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.75rem;

  &:hover {
    background-color: #404040;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const TerminalWrapper = styled.div`
  height: calc(100% - 40px);
  padding: 0.5rem;
`;

const ClaudePromptContainer = styled.div`
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  background-color: #2d2d2d;
  border-top: 1px solid #404040;
`;

const PromptInput = styled.input`
  flex: 1;
  background-color: #3c3c3c;
  border: 1px solid #555;
  color: #ffffff;
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.875rem;

  &:focus {
    outline: none;
    border-color: #007acc;
  }

  &::placeholder {
    color: #888;
  }
`;

const SendButton = styled.button`
  background-color: #007acc;
  border: none;
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;

  &:hover:not(:disabled) {
    background-color: #005a9e;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Terminal = ({ projectId }) => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [autoCommit, setAutoCommit] = useState(true);

  useEffect(() => {
    if (terminalRef.current && !xtermRef.current) {
      initializeTerminal();
    }

    return () => {
      if (xtermRef.current) {
        xtermRef.current.dispose();
      }
    };
  }, []);

  const initializeTerminal = () => {
    const terminal = new XTerm({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        selection: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff'
      },
      fontSize: 14,
      fontFamily: 'Fira Code, Monaco, Consolas, monospace',
      rows: 20,
      cols: 80,
      scrollback: 1000,
      cursorBlink: true
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(terminalRef.current);
    fitAddon.fit();

    // Welcome message
    terminal.writeln('\x1b[1;34mWebIDE Terminal with Claude Code Integration\x1b[0m');
    terminal.writeln('\x1b[90mUse the prompt below to send requests to Claude Code\x1b[0m');
    terminal.writeln('\x1b[90mType your prompt and press Enter or click Send\x1b[0m');
    terminal.writeln('');

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle window resize
    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  };

  const writeToTerminal = (message, color = 'white') => {
    if (!xtermRef.current) return;

    const colorCodes = {
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m',
      gray: '\x1b[90m',
      reset: '\x1b[0m'
    };

    xtermRef.current.writeln(`${colorCodes[color] || ''}${message}${colorCodes.reset}`);
  };

  const sendToClaudeCode = async () => {
    if (!prompt.trim() || isLoading) return;

    setIsLoading(true);
    const currentPrompt = prompt;
    setPrompt('');

    writeToTerminal(`\n> ${currentPrompt}`, 'cyan');
    writeToTerminal('Sending to Claude Code...', 'yellow');

    try {
      const response = await axios.post(`/api/claude/execute/${projectId}`, {
        command: currentPrompt,
        autoCommit: autoCommit
      });

      if (response.data.success) {
        writeToTerminal('Claude Code Response:', 'green');
        if (response.data.stdout) {
          writeToTerminal(response.data.stdout);
        }
        if (response.data.stderr) {
          writeToTerminal(response.data.stderr, 'red');
        }
      } else {
        writeToTerminal('Claude Code execution failed:', 'red');
        if (response.data.stderr) {
          writeToTerminal(response.data.stderr, 'red');
        }
      }
    } catch (error) {
      writeToTerminal('Error communicating with Claude Code:', 'red');
      writeToTerminal(error.response?.data?.message || error.message, 'red');
    } finally {
      setIsLoading(false);
      writeToTerminal('', 'white'); // Add empty line
    }
  };

  const clearTerminal = () => {
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendToClaudeCode();
    }
  };

  return (
    <TerminalContainer>
      <TerminalHeader>
        <TerminalTitle>Claude Code Terminal</TerminalTitle>
        <TerminalActions>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem' }}>
            <input
              type="checkbox"
              checked={autoCommit}
              onChange={(e) => setAutoCommit(e.target.checked)}
            />
            Auto-commit
          </label>
          <ActionButton onClick={clearTerminal}>Clear</ActionButton>
        </TerminalActions>
      </TerminalHeader>

      <TerminalWrapper>
        <div ref={terminalRef} style={{ height: 'calc(100% - 60px)' }} />
        
        <ClaudePromptContainer>
          <PromptInput
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter your prompt for Claude Code..."
            disabled={isLoading}
          />
          <SendButton
            onClick={sendToClaudeCode}
            disabled={isLoading || !prompt.trim()}
          >
            {isLoading ? 'Sending...' : 'Send'}
          </SendButton>
        </ClaudePromptContainer>
      </TerminalWrapper>
    </TerminalContainer>
  );
};

export default Terminal;