import React, { useState, useRef } from 'react';
import styled from 'styled-components';
import axios from 'axios';
import {
  FiFile,
  FiFolder,
  FiPlus,
  FiEdit2,
  FiTrash2,
  FiUpload,
  FiMoreVertical
} from 'react-icons/fi';

const TreeContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
`;

const TreeItem = styled.div`
  display: flex;
  align-items: center;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  user-select: none;
  color: ${props => props.$selected ? '#ffffff' : '#cccccc'};
  background-color: ${props => props.$selected ? '#094771' : 'transparent'};
  border-radius: 4px;
  margin: 1px 0;
  position: relative;

  &:hover {
    background-color: ${props => props.$selected ? '#094771' : '#2a2a2a'};
  }

  padding-left: ${props => props.$depth * 16 + 8}px;
`;

const ItemIcon = styled.div`
  margin-right: 0.5rem;
  display: flex;
  align-items: center;
  color: ${props => {
    if (props.$type === 'folder') return '#dcb67a';
    if (props.$isOpen) return '#dcb67a';
    return '#6a9955';
  }};
`;

const ItemName = styled.span`
  flex: 1;
  font-size: 0.875rem;
`;

const ActionsButton = styled.button`
  background: none;
  border: none;
  color: #888888;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s;

  ${TreeItem}:hover & {
    opacity: 1;
  }

  &:hover {
    background-color: #404040;
    color: #ffffff;
  }
`;

const ContextMenu = styled.div`
  position: absolute;
  top: ${props => props.y}px;
  left: ${props => props.x}px;
  background-color: #2d2d2d;
  border: 1px solid #404040;
  border-radius: 4px;
  padding: 0.25rem 0;
  z-index: 1000;
  min-width: 150px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
`;

const ContextMenuItem = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  font-size: 0.875rem;
  color: #cccccc;

  &:hover {
    background-color: #404040;
    color: #ffffff;
  }
`;

const ToolbarContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  border-bottom: 1px solid #404040;
`;

const ToolbarButton = styled.button`
  background: none;
  border: none;
  color: #cccccc;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;

  &:hover {
    background-color: #404040;
    color: #ffffff;
  }
`;

const Input = styled.input`
  background-color: #3c3c3c;
  border: 1px solid #007acc;
  color: #ffffff;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.875rem;
  width: 100%;
  margin: 0.25rem 0;

  &:focus {
    outline: none;
  }
`;

const FileTree = ({ fileTree, selectedFile, onFileSelect, projectId, onTreeUpdate }) => {
  const [expandedFolders, setExpandedFolders] = useState(new Set(['']));
  const [contextMenu, setContextMenu] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const fileInputRef = useRef(null);

  const handleItemClick = (item, event) => {
    event.stopPropagation();
    
    if (item.type === 'folder') {
      const newExpanded = new Set(expandedFolders);
      if (expandedFolders.has(item.path)) {
        newExpanded.delete(item.path);
      } else {
        newExpanded.add(item.path);
      }
      setExpandedFolders(newExpanded);
    } else {
      onFileSelect(item);
    }
  };

  const handleRightClick = (item, event) => {
    event.preventDefault();
    event.stopPropagation();
    
    setContextMenu({
      item,
      x: event.clientX,
      y: event.clientY
    });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const handleCreateFile = async (parentPath = '') => {
    try {
      const fileName = prompt('ファイル名を入力してください:');
      if (!fileName) return;

      await axios.post(`/api/files/${projectId}`, {
        fileName,
        filePath: parentPath,
        content: '',
        fileType: getFileType(fileName)
      });

      onTreeUpdate();
    } catch (error) {
      console.error('Error creating file:', error);
      alert('ファイルの作成に失敗しました');
    }
    closeContextMenu();
  };

  const handleCreateFolder = async (parentPath = '') => {
    try {
      const folderName = prompt('フォルダ名を入力してください:');
      if (!folderName) return;

      await axios.post(`/api/files/${projectId}`, {
        fileName: folderName,
        filePath: parentPath,
        isFolder: true
      });

      onTreeUpdate();
      setExpandedFolders(prev => new Set([...prev, parentPath ? `${parentPath}/${folderName}` : folderName]));
    } catch (error) {
      console.error('Error creating folder:', error);
      alert('フォルダの作成に失敗しました');
    }
    closeContextMenu();
  };

  const handleRename = (item) => {
    setEditingItem(item);
    setNewItemName(item.name);
    closeContextMenu();
  };

  const handleRenameSubmit = async () => {
    if (!editingItem || !newItemName.trim()) {
      setEditingItem(null);
      return;
    }

    try {
      await axios.patch(`/api/files/${projectId}/${editingItem.id}/rename`, {
        newName: newItemName.trim()
      });

      onTreeUpdate();
    } catch (error) {
      console.error('Error renaming item:', error);
      alert('名前の変更に失敗しました');
    }

    setEditingItem(null);
    setNewItemName('');
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`${item.name}を削除しますか？`)) {
      return;
    }

    try {
      await axios.delete(`/api/files/${projectId}/${item.id}`);
      onTreeUpdate();
    } catch (error) {
      console.error('Error deleting item:', error);
      alert('アイテムの削除に失敗しました');
    }
    closeContextMenu();
  };

  const handleFileUpload = (event) => {
    const files = Array.from(event.target.files);
    uploadFiles(files);
  };

  const uploadFiles = async (files) => {
    try {
      const formData = new FormData();
      files.forEach(file => {
        formData.append('files', file);
      });

      await axios.post(`/api/files/${projectId}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      onTreeUpdate();
    } catch (error) {
      console.error('Error uploading files:', error);
      alert('ファイルのアップロードに失敗しました');
    }
  };

  const getFileType = (fileName) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    const typeMap = {
      'js': 'javascript',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'md': 'markdown',
      'txt': 'text'
    };
    return typeMap[extension] || 'text';
  };

  const renderTreeItem = (item, depth = 0, parentPath = '') => {
    const currentPath = parentPath ? `${parentPath}/${item.name}` : item.name;
    const isExpanded = expandedFolders.has(currentPath);
    const isSelected = selectedFile && selectedFile.id === item.id;

    return (
      <div key={currentPath}>
        <TreeItem
          $depth={depth}
          $selected={isSelected}
          onClick={(e) => handleItemClick({ ...item, path: currentPath }, e)}
          onContextMenu={(e) => handleRightClick({ ...item, path: currentPath }, e)}
        >
          <ItemIcon $type={item.type} $isOpen={isExpanded}>
            {item.type === 'folder' ? (
              <FiFolder size={16} />
            ) : (
              <FiFile size={16} />
            )}
          </ItemIcon>
          
          {editingItem && editingItem.id === item.id ? (
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit();
                if (e.key === 'Escape') setEditingItem(null);
              }}
              autoFocus
            />
          ) : (
            <ItemName>{item.name}</ItemName>
          )}
          
          <ActionsButton onClick={(e) => handleRightClick({ ...item, path: currentPath }, e)}>
            <FiMoreVertical size={14} />
          </ActionsButton>
        </TreeItem>

        {item.type === 'folder' && isExpanded && item.children && (
          Object.values(item.children).map(child =>
            renderTreeItem(child, depth + 1, currentPath)
          )
        )}
      </div>
    );
  };

  return (
    <>
      <ToolbarContainer>
        <div>
          <ToolbarButton onClick={() => handleCreateFile()}>
            <FiPlus size={16} />
          </ToolbarButton>
          <ToolbarButton onClick={() => handleCreateFolder()}>
            <FiFolder size={16} />
          </ToolbarButton>
          <ToolbarButton onClick={() => fileInputRef.current?.click()}>
            <FiUpload size={16} />
          </ToolbarButton>
        </div>
      </ToolbarContainer>

      <TreeContainer onClick={closeContextMenu}>
        {Object.values(fileTree).map(item => renderTreeItem(item))}
      </TreeContainer>

      {contextMenu && (
        <>
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 999
            }}
            onClick={closeContextMenu}
          />
          <ContextMenu x={contextMenu.x} y={contextMenu.y}>
            <ContextMenuItem onClick={() => handleCreateFile(contextMenu.item.path)}>
              <FiFile size={14} />
              新しいファイル
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleCreateFolder(contextMenu.item.path)}>
              <FiFolder size={14} />
              新しいフォルダ
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleRename(contextMenu.item)}>
              <FiEdit2 size={14} />
              名前を変更
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleDelete(contextMenu.item)}>
              <FiTrash2 size={14} />
              削除
            </ContextMenuItem>
          </ContextMenu>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />
    </>
  );
};

export default FileTree;