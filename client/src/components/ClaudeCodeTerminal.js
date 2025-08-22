import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import axios from 'axios';

// 将来的にMarkdownレンダリングとシンタックスハイライトを追加する予定

const TerminalContainer = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #0d1117;
  color: #e6edf3;
  font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
`;

const TerminalHeader = styled.div`
  padding: 0.75rem 1rem;
  background-color: #21262d;
  border-bottom: 1px solid #30363d;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const TerminalTitle = styled.h3`
  margin: 0;
  font-size: 0.875rem;
  color: #f0f6fc;
  font-weight: 600;
`;

const ClearButton = styled.button`
  background: none;
  border: 1px solid #30363d;
  color: #f0f6fc;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.75rem;
  
  &:hover {
    background-color: #30363d;
  }
`;

const OutputArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  background-color: #0d1117;
  white-space: pre-wrap;
  font-size: 14px;
  line-height: 1.6;
`;

const ConversationItem = styled.div`
  margin-bottom: 1.5rem;
  
  &:last-child {
    margin-bottom: 0;
  }
`;

const UserInput = styled.div`
  color: #58a6ff;
  margin-bottom: 0.5rem;
  
  &::before {
    content: "user@claudecodeterminal:~$ ";
    color: #7c3aed;
    font-weight: 600;
  }
`;

const ClaudeResponse = styled.div`
  color: #e6edf3;
  background-color: #161b22;
  padding: 1rem;
  border-radius: 6px;
  border-left: 3px solid #238636;
  
  .inline-code {
    background-color: #6e7681;
    color: #f0f6fc;
    padding: 0.125rem 0.25rem;
    border-radius: 3px;
    font-size: 0.875em;
    font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
  }
  
  .code-block {
    background-color: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 1rem;
    overflow-x: auto;
    margin: 0.75rem 0;
    
    code {
      background: none;
      padding: 0;
      color: #e6edf3;
      font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
      font-size: 13px;
      line-height: 1.45;
    }
    
    /* シンタックスハイライト用のスタイル */
    .language-javascript,
    .language-js {
      color: #f7df1e;
    }
    
    .language-python {
      color: #3776ab;
    }
    
    .language-html {
      color: #e34c26;
    }
    
    .language-css {
      color: #1572b6;
    }
    
    .language-json {
      color: #00d4aa;
    }
    
    .language-bash,
    .language-shell {
      color: #89e051;
    }
  }
  
  h1, h2, h3 {
    color: #f0f6fc;
    margin: 1rem 0 0.5rem 0;
    font-weight: 600;
  }
  
  h1 {
    font-size: 1.5em;
    border-bottom: 1px solid #30363d;
    padding-bottom: 0.3rem;
  }
  
  h2 {
    font-size: 1.25em;
  }
  
  h3 {
    font-size: 1.1em;
  }
  
  ul {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }
  
  li {
    margin: 0.25rem 0;
  }
  
  strong {
    font-weight: 600;
    color: #f0f6fc;
  }
  
  em {
    font-style: italic;
    color: #f85149;
  }
  
  br {
    line-height: 1.6;
  }
`;

const InputArea = styled.div`
  background-color: #21262d;
  border-top: 1px solid #30363d;
  padding: 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
`;

const InputPrompt = styled.span`
  color: #7c3aed;
  font-weight: 600;
  white-space: nowrap;
`;

const InputField = styled.input`
  flex: 1;
  background-color: #0d1117;
  border: 1px solid #30363d;
  color: #e6edf3;
  padding: 0.75rem;
  border-radius: 6px;
  font-family: inherit;
  font-size: 14px;
  
  &:focus {
    outline: none;
    border-color: #58a6ff;
    box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.3);
  }
  
  &::placeholder {
    color: #7d8590;
  }
`;

const SendButton = styled.button`
  background-color: #238636;
  border: none;
  color: white;
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  
  &:hover:not(:disabled) {
    background-color: #2ea043;
  }
  
  &:disabled {
    background-color: #30363d;
    color: #7d8590;
    cursor: not-allowed;
  }
`;

const LoadingIndicator = styled.div`
  color: #f85149;
  font-style: italic;
  margin: 0.5rem 0;
  
  &::after {
    content: "...";
    animation: loading 1.5s infinite;
  }
  
  @keyframes loading {
    0%, 20% { opacity: 0; }
    50% { opacity: 1; }
    100% { opacity: 0; }
  }
`;

const ClaudeCodeTerminal = ({ projectId }) => {
  const [conversations, setConversations] = useState([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const outputRef = useRef(null);

  // スクロールを最下部に移動
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [conversations, isLoading]);

  // Markdownレンダリング関数
  const renderMarkdown = (text) => {
    let rendered = text;

    // HTMLエスケープ（ただしコードブロック内は除く）
    const escapeHtml = (str) => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    // コードブロックを一時的に保護
    const codeBlocks = [];
    rendered = rendered.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, language, code) => {
      const index = codeBlocks.length;
      const trimmedCode = code.trim();
      
      // シンタックスハイライトのためのクラス
      const langClass = language ? `language-${language}` : '';
      
      codeBlocks.push(`<pre class="code-block"><code class="${langClass}">${escapeHtml(trimmedCode)}</code></pre>`);
      return `__CODE_BLOCK_${index}__`;
    });

    // インラインコードを一時的に保護
    const inlineCodes = [];
    rendered = rendered.replace(/`([^`\n]+)`/g, (match, code) => {
      const index = inlineCodes.length;
      inlineCodes.push(`<code class="inline-code">${escapeHtml(code)}</code>`);
      return `__INLINE_CODE_${index}__`;
    });

    // 残りの部分をエスケープ
    rendered = escapeHtml(rendered);

    // 太字
    rendered = rendered.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // 斜体
    rendered = rendered.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // リスト項目
    rendered = rendered.replace(/^[\s]*[-*+]\s+(.+)$/gm, '<li>$1</li>');
    rendered = rendered.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    // 見出し
    rendered = rendered.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    rendered = rendered.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    rendered = rendered.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    
    // 改行を<br>に変換（ただしブロック要素の前後は除く）
    rendered = rendered.replace(/\n(?![<])/g, '<br>');
    
    // コードブロックを復元
    codeBlocks.forEach((block, index) => {
      rendered = rendered.replace(`__CODE_BLOCK_${index}__`, block);
    });
    
    // インラインコードを復元
    inlineCodes.forEach((code, index) => {
      rendered = rendered.replace(`__INLINE_CODE_${index}__`, code);
    });

    return rendered;
  };

  const sendMessage = async () => {
    if (!currentInput.trim() || isLoading) return;

    const userMessage = currentInput.trim();
    setCurrentInput('');
    setIsLoading(true);

    // ユーザーメッセージを会話に追加
    const newConversation = {
      id: Date.now(),
      userInput: userMessage,
      claudeResponse: null,
      isLoading: true
    };

    setConversations(prev => [...prev, newConversation]);

    try {
      // Claude Code APIを呼び出し（仮の実装）
      const response = await axios.post(`/api/claude/execute/${projectId}`, {
        command: userMessage,
        autoCommit: true
      });

      let claudeResponse = '';
      if (response.data.success) {
        claudeResponse = response.data.stdout || response.data.result || 'コマンドが正常に実行されました。';
        if (response.data.stderr) {
          claudeResponse += '\n\nエラー出力:\n' + response.data.stderr;
        }
      } else {
        claudeResponse = 'エラー: ' + (response.data.stderr || response.data.error || 'コマンドの実行に失敗しました。');
      }

      // 会話を更新
      setConversations(prev => 
        prev.map(conv => 
          conv.id === newConversation.id 
            ? { ...conv, claudeResponse, isLoading: false }
            : conv
        )
      );
    } catch (error) {
      console.error('Claude Code API error:', error);
      const errorMessage = `エラー: ${error.response?.data?.message || error.message}`;
      
      setConversations(prev => 
        prev.map(conv => 
          conv.id === newConversation.id 
            ? { ...conv, claudeResponse: errorMessage, isLoading: false }
            : conv
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const clearConversations = () => {
    setConversations([]);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <TerminalContainer>
      <TerminalHeader>
        <TerminalTitle>Claude Code Terminal</TerminalTitle>
        <ClearButton onClick={clearConversations}>
          Clear
        </ClearButton>
      </TerminalHeader>

      <OutputArea ref={outputRef}>
        {conversations.length === 0 && (
          <div style={{ color: '#7d8590', fontStyle: 'italic' }}>
            Claude Code統合ターミナルへようこそ。<br />
            下のコマンドラインにプロンプトを入力してClaudeと対話できます。
          </div>
        )}
        
        {conversations.map((conversation) => (
          <ConversationItem key={conversation.id}>
            <UserInput>{conversation.userInput}</UserInput>
            {conversation.isLoading ? (
              <LoadingIndicator>Claude Codeが応答を生成中</LoadingIndicator>
            ) : conversation.claudeResponse && (
              <ClaudeResponse 
                dangerouslySetInnerHTML={{ 
                  __html: renderMarkdown(conversation.claudeResponse) 
                }} 
              />
            )}
          </ConversationItem>
        ))}
        
        {isLoading && conversations.length > 0 && (
          <LoadingIndicator>応答を待機中</LoadingIndicator>
        )}
      </OutputArea>

      <InputArea>
        <InputPrompt>user@claudecodeterminal:~$</InputPrompt>
        <InputField
          value={currentInput}
          onChange={(e) => setCurrentInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Claude Codeにコマンドまたは質問を入力..."
          disabled={isLoading}
        />
        <SendButton
          onClick={sendMessage}
          disabled={isLoading || !currentInput.trim()}
        >
          {isLoading ? '送信中...' : '送信'}
        </SendButton>
      </InputArea>
    </TerminalContainer>
  );
};

export default ClaudeCodeTerminal;