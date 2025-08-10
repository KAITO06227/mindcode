import React, { useRef, useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import styled from 'styled-components';

const EditorContainer = styled.div`
  height: 100%;
  width: 100%;
`;

const PlaceholderContainer = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  color: #888888;
  background-color: #1e1e1e;
`;

const PlaceholderTitle = styled.h3`
  font-size: 1.25rem;
  margin-bottom: 0.5rem;
  color: #cccccc;
`;

const PlaceholderText = styled.p`
  font-size: 0.875rem;
  text-align: center;
  line-height: 1.5;
`;

const SaveStatusBar = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  background-color: ${props => props.$saved ? '#28a745' : '#ffc107'};
  color: ${props => props.$saved ? '#ffffff' : '#000000'};
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem;
  border-bottom-left-radius: 4px;
  z-index: 10;
  opacity: ${props => props.$show ? 1 : 0};
  transition: opacity 0.3s ease;
`;

const EditorWrapper = styled.div`
  position: relative;
  height: 100%;
  width: 100%;
`;

const CodeEditor = ({ file, onChange, onSave, autoSave = true, autoSaveInterval = 3000 }) => {
  const editorRef = useRef(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [showSaveStatus, setShowSaveStatus] = useState(false);
  const autoSaveTimeoutRef = useRef(null);

  // Save function with status feedback
  const saveFile = useCallback(async () => {
    if (!file || !onSave) return;

    try {
      setSaveStatus('saving');
      setShowSaveStatus(true);
      
      await onSave();
      
      setSaveStatus('saved');
      setHasUnsavedChanges(false);
      
      // Hide save status after 2 seconds
      setTimeout(() => {
        setShowSaveStatus(false);
      }, 2000);
      
    } catch (error) {
      console.error('Error saving file:', error);
      setSaveStatus('error');
      
      // Hide error status after 3 seconds
      setTimeout(() => {
        setShowSaveStatus(false);
      }, 3000);
    }
  }, [file, onSave]);

  // Auto-save functionality
  useEffect(() => {
    if (autoSave && hasUnsavedChanges && file) {
      // Clear existing timeout
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      // Set new timeout
      autoSaveTimeoutRef.current = setTimeout(() => {
        saveFile();
      }, autoSaveInterval);
    }

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [hasUnsavedChanges, autoSave, autoSaveInterval, saveFile, file]);

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;

    // Configure Monaco themes
    monaco.editor.defineTheme('vs-dark-custom', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6A9955' },
        { token: 'keyword', foreground: '569CD6' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'type', foreground: '4EC9B0' }
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editorLineNumber.foreground': '#858585',
        'editorCursor.foreground': '#ffffff',
        'editor.selectionBackground': '#264f78',
        'editor.lineHighlightBackground': '#2a2a2a'
      }
    });

    monaco.editor.setTheme('vs-dark-custom');

    // Configure editor options
    editor.updateOptions({
      fontSize: 14,
      lineHeight: 1.6,
      fontFamily: 'Fira Code, Monaco, Consolas, monospace',
      fontLigatures: true,
      minimap: { enabled: true },
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'on',
      formatOnPaste: true,
      formatOnType: true
    });

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      // Prevent browser default save behavior
      saveFile();
    });
  };

  const handleEditorChange = (value) => {
    if (onChange) {
      onChange(value);
      setHasUnsavedChanges(true);
    }
  };

  // Reset unsaved changes when file changes
  useEffect(() => {
    setHasUnsavedChanges(false);
  }, [file?.id]);

  // Get save status text in Japanese
  const getSaveStatusText = () => {
    switch (saveStatus) {
      case 'saving':
        return '保存中...';
      case 'saved':
        return '保存完了';
      case 'error':
        return '保存エラー';
      default:
        return '';
    }
  };

  const getLanguage = (fileName) => {
    if (!fileName) return 'plaintext';
    
    const extension = fileName.split('.').pop()?.toLowerCase();
    
    const languageMap = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'json': 'json',
      'xml': 'xml',
      'md': 'markdown',
      'markdown': 'markdown',
      'py': 'python',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'cxx': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'php': 'php',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'sh': 'shell',
      'bash': 'shell',
      'sql': 'sql',
      'yml': 'yaml',
      'yaml': 'yaml'
    };

    return languageMap[extension] || 'plaintext';
  };

  if (!file) {
    return (
      <PlaceholderContainer>
        <PlaceholderTitle>ファイルが選択されていません</PlaceholderTitle>
        <PlaceholderText>
          エクスプローラーからファイルを選択して編集を開始してください。
          <br />
          コンテキストメニューを使用して新しいファイルやフォルダを作成できます。
        </PlaceholderText>
      </PlaceholderContainer>
    );
  }

  return (
    <EditorContainer>
      <EditorWrapper>
        <SaveStatusBar 
          $show={showSaveStatus}
          $saved={saveStatus === 'saved'}
        >
          {getSaveStatusText()}
        </SaveStatusBar>
        <Editor
          height="100%"
          language={getLanguage(file.file_name)}
          value={file.content || ''}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          theme="vs-dark-custom"
          options={{
            selectOnLineNumbers: true,
            roundedSelection: false,
            readOnly: false,
            cursorStyle: 'line',
            automaticLayout: true,
            glyphMargin: true,
            folding: true,
            lineNumbersMinChars: 3,
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 14,
              horizontalScrollbarSize: 14
            },
            suggest: {
              showKeywords: true,
              showSnippets: true,
              showClasses: true,
              showFunctions: true,
              showVariables: true
            }
          }}
        />
      </EditorWrapper>
    </EditorContainer>
  );
};

export default CodeEditor;