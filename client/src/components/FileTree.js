import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import axios from 'axios';
import {
  FiFile,
  FiFolder,
  FiFolderMinus,
  FiEdit2,
  FiTrash2,
  FiUpload,
  FiFolderPlus
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
  const fileInputRef = useRef(null);

  // Set up global file tree refresh function
  useEffect(() => {
    window.refreshFileTree = () => {
      if (onTreeUpdate) {
        onTreeUpdate();
      }
    };

    // Cleanup on unmount
    return () => {
      if (window.refreshFileTree) {
        delete window.refreshFileTree;
      }
    };
  }, [onTreeUpdate]);

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
      const fileName = prompt('ファイル名を入力してください:');
      if (!fileName) return;

      const targetPath = getTargetPath();

      await axios.post(`/api/filesystem/${projectId}/files`, {
        fileName,
        filePath: targetPath,
        content: '',
        fileType: getFileType(fileName)
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

  const handleFileUpload = (event) => {
    const files = Array.from(event.target.files);
    uploadFiles(files);
  };

  const uploadFiles = async (files) => {
    try {
      const targetPath = getTargetPath();
      
      const formData = new FormData();
      files.forEach(file => {
        formData.append('files', file);
      });
      
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
    // Only use selectedItem for highlighting (toolbar selection)
    const isSelected = selectedItem && selectedItem.id === item.id;

    return (
      <div key={currentPath}>
        <TreeItem
          $depth={depth}
          $selected={isSelected}
          onClick={(e) => handleItemClick({ ...item, path: currentPath }, e)}
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
            <ItemName>{item.name}</ItemName>
          )}
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
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <ToolbarButton onClick={handleCreateFile} title="新規ファイル">
            <FiFile size={16} />
          </ToolbarButton>
          <ToolbarButton onClick={handleCreateFolder} title="新規フォルダ">
            <FiFolderPlus size={16} />
          </ToolbarButton>
          <ToolbarButton onClick={() => fileInputRef.current?.click()} title="ファイルアップロード">
            <FiUpload size={16} />
          </ToolbarButton>
          <ToolbarButton onClick={handleRename} disabled={!selectedItem} title="名前変更">
            <FiEdit2 size={16} />
          </ToolbarButton>
          <ToolbarButton onClick={handleDelete} disabled={!selectedItem || !selectedItem.id} title="削除">
            <FiTrash2 size={16} />
          </ToolbarButton>
        </div>
      </ToolbarContainer>

      <TreeContainer>
        {Object.values(fileTree).map(item => renderTreeItem(item))}
      </TreeContainer>

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