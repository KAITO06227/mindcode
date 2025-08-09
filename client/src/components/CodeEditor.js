import React, { useRef } from 'react';
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

const CodeEditor = ({ file, onChange }) => {
  const editorRef = useRef(null);

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
      // Trigger save - this would be handled by parent component
      if (onChange && file) {
        onChange(editor.getValue());
      }
    });
  };

  const handleEditorChange = (value) => {
    if (onChange) {
      onChange(value);
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
        <PlaceholderTitle>No file selected</PlaceholderTitle>
        <PlaceholderText>
          Select a file from the explorer to start editing.
          <br />
          You can create new files and folders using the context menu.
        </PlaceholderText>
      </PlaceholderContainer>
    );
  }

  return (
    <EditorContainer>
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
    </EditorContainer>
  );
};

export default CodeEditor;