import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import axios from 'axios';
import { io as ioClient } from 'socket.io-client';
import {
  FiFile,
  FiFolder,
  FiFolderMinus,
  FiEdit2,
  FiTrash2,
  FiUpload,
  FiFolderPlus,
  FiRefreshCcw
} from 'react-icons/fi';
import UploadModal from './UploadModal';

const TreeContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  outline: ${props => props.$isRootDropTarget ? '1px dashed #007acc' : 'none'};
  outline-offset: -4px;
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
  outline: ${props => props.$isDropTarget ? '1px dashed #007acc' : 'none'};

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

  &:hover:not(:disabled) {
    background-color: #404040;
    color: #ffffff;
  }

  &:disabled {
    color: #666666;
    cursor: not-allowed;
    opacity: 0.5;
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
  const [editingItem, setEditingItem] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const socketRef = useRef(null);
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverPath, setDragOverPath] = useState(null);

  const isHiddenName = (name) => {
    if (!name) return false;
    return name.startsWith('.');
  };

  // Set up global file tree refresh function
  useEffect(() => {
    window.refreshFileTree = () => {
      if (onTreeUpdate) {
        onTreeUpdate();
      }
    };

    // Gitイベントとファイルイベントのリスナーを追加
    const handleGitUpdate = () => {
      if (onTreeUpdate) {
        onTreeUpdate();
      }
    };

    const handleFilesUpdate = () => {
      if (onTreeUpdate) {
        onTreeUpdate();
      }
    };

    window.addEventListener('mindcode:gitUpdated', handleGitUpdate);
    window.addEventListener('mindcode:filesUpdated', handleFilesUpdate);

    // Cleanup on unmount
    return () => {
      if (window.refreshFileTree) {
        delete window.refreshFileTree;
      }
      window.removeEventListener('mindcode:gitUpdated', handleGitUpdate);
      window.removeEventListener('mindcode:filesUpdated', handleFilesUpdate);
    };
  }, [onTreeUpdate]);

  useEffect(() => {
    if (!projectId) {
      return undefined;
    }

    const baseUrl = process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3001';
    const namespaceUrl = baseUrl ? `${baseUrl}/file-events` : '/file-events';
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

    const socket = ioClient(namespaceUrl, {
      query: {
        projectId,
        token
      },
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;

    socket.on('file-tree:update', (event) => {
      if (event?.projectId?.toString() === projectId?.toString()) {
        if (onTreeUpdate) {
          onTreeUpdate();
        }
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [projectId, onTreeUpdate]);

  const handleItemClick = (item, event) => {
    event.stopPropagation();
    
    // Always update selected item for toolbar operations
    setSelectedItem(item);
    
    if (item.type === 'folder') {
      const newExpanded = new Set(expandedFolders);
      if (expandedFolders.has(item.path)) {
        newExpanded.delete(item.path);
      } else {
        newExpanded.add(item.path);
      }
      setExpandedFolders(newExpanded);
    } else {
      // For files, also update the file editor selection
      onFileSelect(item);
    }
  };

  // Get target path for operations based on selected item
  const getTargetPath = () => {
    if (!selectedItem) return '';
    
    if (selectedItem.type === 'folder') {
      return selectedItem.path;
    } else {
      // For files, get the parent directory
      const pathParts = selectedItem.path.split('/');
      pathParts.pop(); // Remove the file name
      return pathParts.join('/');
    }
  };

  const handleCreateFile = async () => {
    try {
      const input = prompt('ファイル名を入力してください:');
      if (!input) return;

      const fileName = input.trim();
      if (!fileName) {
        alert('ファイル名が空です');
        return;
      }

      const targetPath = getTargetPath();

      await axios.post(`/api/filesystem/${projectId}/files`, {
        fileName,
        filePath: targetPath,
        content: ''
      });

      onTreeUpdate();
      
      // Expand the target folder if it's a folder
      if (selectedItem?.type === 'folder') {
        setExpandedFolders(prev => new Set([...prev, selectedItem.path]));
      }
    } catch (error) {
      console.error('Error creating file:', error);
      alert('ファイルの作成に失敗しました');
    }
  };

  const handleCreateFolder = async () => {
    try {
      const folderName = prompt('フォルダ名を入力してください:');
      if (!folderName) return;

      const targetPath = getTargetPath();

      await axios.post(`/api/filesystem/${projectId}/files`, {
        fileName: folderName,
        filePath: targetPath,
        isFolder: true
      });

      onTreeUpdate();
      
      const newFolderPath = targetPath ? `${targetPath}/${folderName}` : folderName;
      setExpandedFolders(prev => new Set([...prev, newFolderPath]));
      
      // Expand the parent folder if it's a folder
      if (selectedItem?.type === 'folder') {
        setExpandedFolders(prev => new Set([...prev, selectedItem.path]));
      }
    } catch (error) {
      console.error('Error creating folder:', error);
      alert('フォルダの作成に失敗しました');
    }
  };

  const handleRename = () => {
    if (!selectedItem) {
      alert('名前を変更するファイル/フォルダを選択してください');
      return;
    }
    setEditingItem(selectedItem);
    setNewItemName(selectedItem.name);
  };

  const handleRenameSubmit = async () => {
    if (!editingItem || !newItemName.trim()) {
      setEditingItem(null);
      return;
    }

    try {
      await axios.patch(`/api/filesystem/${projectId}/files/${editingItem.id}/rename`, {
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

  const handleDelete = async () => {
    if (!selectedItem || !selectedItem.id) {
      alert('削除するファイル/フォルダを選択してください');
      return;
    }

    const confirmMessage = selectedItem.type === 'folder' 
      ? `フォルダ "${selectedItem.name}" とその中身をすべて削除しますか？この操作は元に戻せません。`
      : `ファイル "${selectedItem.name}" を削除しますか？`;
      
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      const response = await axios.delete(`/api/filesystem/${projectId}/files/${selectedItem.id}`);
      onTreeUpdate();
      setSelectedItem(null); // Clear selection after delete
      
      // Show success message with deletion count for folders
      if (response.data.deletedCount > 1) {
        alert(`フォルダと${response.data.deletedCount}個のアイテムを削除しました`);
      }
    } catch (error) {
      console.error('Error deleting item:', error);
      alert('アイテムの削除に失敗しました');
    }
  };

  const handleUploadModalOpen = () => {
    setIsUploadModalOpen(true);
  };

  const handleUploadModalClose = () => {
    setIsUploadModalOpen(false);
  };

  const handleUpload = async (files) => {
    try {
      const targetPath = getTargetPath();

      const formData = new FormData();
      const relativePaths = [];
      files.forEach(file => {
        formData.append('files', file);
        // webkitRelativePathがある場合（フォルダアップロード）、それも送信
        relativePaths.push(file.webkitRelativePath || '');
      });
      formData.append('relativePaths', JSON.stringify(relativePaths));

      // Add target path to form data
      formData.append('targetPath', targetPath);

      await axios.post(`/api/filesystem/${projectId}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      onTreeUpdate();

      // Expand the target folder if it's a folder
      if (selectedItem?.type === 'folder') {
        setExpandedFolders(prev => new Set([...prev, selectedItem.path]));
      }
    } catch (error) {
      console.error('Error uploading files:', error);
      throw error;
    }
  };

  const getParentPath = (pathString) => {
    if (!pathString) return '';
    const lastSlash = pathString.lastIndexOf('/');
    return lastSlash === -1 ? '' : pathString.slice(0, lastSlash);
  };

  const isDescendant = (source, target) => {
    if (!source || !target) return false;
    return target.startsWith(`${source}/`);
  };

  const moveItem = async (source, destination) => {
    if (!projectId || !source) {
      return;
    }

    const trimmedDestination = destination || '';

    if (trimmedDestination && (trimmedDestination === source || isDescendant(source, trimmedDestination))) {
      alert('同じアイテムまたはその配下には移動できません');
      setDraggedItem(null);
      setDragOverPath(null);
      return;
    }

    const currentParent = getParentPath(source);
    if (currentParent === trimmedDestination) {
      setDraggedItem(null);
      setDragOverPath(null);
      return;
    }

    try {
      await axios.post(`/api/filesystem/${projectId}/move`, {
        sourcePath: source,
        destinationPath: trimmedDestination
      });

      if (trimmedDestination) {
        setExpandedFolders(prev => new Set([...prev, trimmedDestination]));
      }

      if (onTreeUpdate) {
        onTreeUpdate();
      }
    } catch (error) {
      console.error('Error moving item:', error);
      const message = error.response?.data?.message || error.message;
      alert(`移動に失敗しました: ${message}`);
    } finally {
      setDraggedItem(null);
      setDragOverPath(null);
    }
  };

  const handleDragStart = (item, event) => {
    setDraggedItem(item);
    setDragOverPath(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.path);
    }
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverPath(null);
  };

  const handleDragEnter = (item, event) => {
    if (event.stopPropagation) {
      event.stopPropagation();
    }
    if (!draggedItem || !item || item.type !== 'folder') {
      return;
    }

    if (draggedItem.path === item.path || isDescendant(draggedItem.path, item.path)) {
      return;
    }

    setDragOverPath(item.path);
  };

  const handleDragLeave = (item) => {
    if (dragOverPath === item?.path) {
      setDragOverPath(null);
    }
  };

  const handleDragOverItem = (item, event) => {
    if (!draggedItem || !item || item.type !== 'folder') {
      return;
    }

    if (event.preventDefault) {
      event.preventDefault();
    }
    if (event.stopPropagation) {
      event.stopPropagation();
    }

    if (draggedItem.path === item.path || isDescendant(draggedItem.path, item.path)) {
      setDragOverPath(null);
      return;
    }

    setDragOverPath(item.path);
  };

  const handleDropOnFolder = async (item, event) => {
    if (!draggedItem || !item || item.type !== 'folder') {
      return;
    }

    if (event.preventDefault) {
      event.preventDefault();
    }
    if (event.stopPropagation) {
      event.stopPropagation();
    }

    await moveItem(draggedItem.path, item.path || '');
  };

  const handleRootDragOver = (event) => {
    if (!draggedItem) {
      return;
    }

    if (event.target === event.currentTarget) {
      if (event.preventDefault) {
        event.preventDefault();
      }
      setDragOverPath('__ROOT__');
    }
  };

  const handleRootDragLeave = (event) => {
    if (event.target === event.currentTarget && dragOverPath === '__ROOT__') {
      setDragOverPath(null);
    }
  };

  const handleRootDrop = async (event) => {
    if (!draggedItem) {
      return;
    }

    if (event.target === event.currentTarget) {
      if (event.preventDefault) {
        event.preventDefault();
      }
      if (event.stopPropagation) {
        event.stopPropagation();
      }

      await moveItem(draggedItem.path, '');
    }
  };

  const handleSync = async () => {
    if (!projectId) {
      return;
    }

    try {
      const response = await axios.post(`/api/filesystem/${projectId}/sync`);
      const result = response.data;

      if (onTreeUpdate) {
        onTreeUpdate();
      }

      const message = `同期が完了しました:\n` +
        `新規作成: ${result.totalCreated} 件\n` +
        `更新: ${result.totalUpdated} 件\n` +
        `削除: ${result.totalDeleted} 件\n` +
        `エラー: ${result.totalErrors} 件`;

      alert(message);
    } catch (error) {
      console.error('Error syncing filesystem:', error);
      alert('ファイルシステムの同期に失敗しました');
    }
  };

  const renderTreeItem = (item, depth = 0, parentPath = '') => {
    const itemName = item.name || item.file_name || '';
    if (isHiddenName(itemName)) {
      return null;
    }

    const resolvedPath = item.path || (parentPath ? `${parentPath}/${itemName}` : itemName);
    const isExpanded = expandedFolders.has(resolvedPath);
    const isSelected = selectedItem && selectedItem.id === item.id;
    const itemWithPath = { ...item, name: itemName, path: resolvedPath };

    return (
      <div key={resolvedPath}>
        <TreeItem
          $depth={depth}
          $selected={isSelected}
          $isDropTarget={dragOverPath === resolvedPath}
          draggable={!!projectId}
          onClick={(e) => handleItemClick(itemWithPath, e)}
          onDragStart={(e) => handleDragStart(itemWithPath, e)}
          onDragEnd={handleDragEnd}
          onDragEnter={(e) => handleDragEnter(itemWithPath, e)}
          onDragOver={(e) => handleDragOverItem(itemWithPath, e)}
          onDragLeave={() => handleDragLeave(itemWithPath)}
          onDrop={(e) => handleDropOnFolder(itemWithPath, e)}
        >
          <ItemIcon $type={item.type} $isOpen={isExpanded}>
            {item.type === 'folder' ? (
              isExpanded ? <FiFolderMinus size={16} /> : <FiFolder size={16} />
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
            <ItemName>{itemName}</ItemName>
          )}
        </TreeItem>

        {item.type === 'folder' && isExpanded && item.children && (
          Object.values(item.children)
            .map(child => renderTreeItem(child, depth + 1, resolvedPath))
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <ToolbarContainer>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <ToolbarButton onClick={handleCreateFile} title="新規ファイル">
            <FiFile size={16} />
          </ToolbarButton>
          <ToolbarButton onClick={handleCreateFolder} title="新規フォルダ">
            <FiFolderPlus size={16} />
          </ToolbarButton>
          <ToolbarButton onClick={handleUploadModalOpen} title="ファイル/フォルダアップロード">
            <FiUpload size={16} />
          </ToolbarButton>
          <ToolbarButton onClick={handleSync} title="ファイルシステム同期（Claude Codeで作成されたファイルを表示）">
            <FiRefreshCcw size={16} />
          </ToolbarButton>
          <ToolbarButton onClick={handleRename} disabled={!selectedItem} title="名前変更">
            <FiEdit2 size={16} />
          </ToolbarButton>
          <ToolbarButton onClick={handleDelete} disabled={!selectedItem || !selectedItem.id} title="削除">
            <FiTrash2 size={16} />
          </ToolbarButton>
        </div>
      </ToolbarContainer>

      <TreeContainer
        $isRootDropTarget={dragOverPath === '__ROOT__'}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {Object.values(fileTree)
          .map(item => renderTreeItem(item))
          .filter(Boolean)}
      </TreeContainer>

      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={handleUploadModalClose}
        onUpload={handleUpload}
      />
    </div>
  );
};

export default FileTree;
