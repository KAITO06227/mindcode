import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import styled from 'styled-components';
import { FiX, FiFile, FiFolder, FiUpload } from 'react-icons/fi';

const SYSTEM_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const isSystemFile = (file) => {
  const name = file?.name || '';
  if (SYSTEM_FILE_NAMES.has(name)) {
    return true;
  }

  const relativePath = file?.webkitRelativePath || '';
  if (relativePath) {
    const parts = relativePath.split('/');
    const lastPart = parts[parts.length - 1] || '';
    if (SYSTEM_FILE_NAMES.has(lastPart)) {
      return true;
    }
  }

  return false;
};

const filterSystemFiles = (files) => files.filter(file => !isSystemFile(file));

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
`;

const ModalContent = styled.div`
  background-color: #252526;
  border-radius: 8px;
  padding: 1.5rem;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
`;

const ModalTitle = styled.h2`
  color: #ffffff;
  font-size: 1.25rem;
  margin: 0;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: #cccccc;
  cursor: pointer;
  padding: 0.25rem;
  display: flex;
  align-items: center;
  border-radius: 4px;

  &:hover {
    background-color: #404040;
    color: #ffffff;
  }
`;

const UploadTypeContainer = styled.div`
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
`;

const UploadTypeButton = styled.button`
  flex: 1;
  padding: 1rem;
  background-color: ${props => props.$selected ? '#007acc' : '#3c3c3c'};
  border: 2px solid ${props => props.$selected ? '#007acc' : '#555555'};
  border-radius: 8px;
  color: #ffffff;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.2s;

  &:hover {
    background-color: ${props => props.$selected ? '#007acc' : '#4a4a4a'};
    border-color: ${props => props.$selected ? '#007acc' : '#666666'};
  }
`;

const UploadTypeLabel = styled.span`
  font-size: 1rem;
  font-weight: 500;
`;

const FileInputArea = styled.div`
  border: 2px dashed ${props => props.$isDragging ? '#007acc' : '#555555'};
  border-radius: 8px;
  padding: 2rem;
  text-align: center;
  margin-bottom: 1rem;
  background-color: ${props => props.$isDragging ? '#1a3a52' : '#1e1e1e'};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: #007acc;
    background-color: ${props => props.$isDragging ? '#1a3a52' : '#252526'};
  }
`;

const FileInputText = styled.p`
  color: #cccccc;
  margin: 0.5rem 0;
  font-size: 0.875rem;
`;

const SelectedFilesContainer = styled.div`
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 1rem;
  background-color: #1e1e1e;
  border-radius: 4px;
  padding: 0.5rem;
`;

const SelectedFileItem = styled.div`
  color: #cccccc;
  padding: 0.25rem 0.5rem;
  font-size: 0.875rem;
  border-bottom: 1px solid #333333;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;

  &:last-child {
    border-bottom: none;
  }
`;

const FileName = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RemoveFileButton = styled.button`
  background: none;
  border: none;
  color: #888888;
  cursor: pointer;
  padding: 0.25rem;
  display: flex;
  align-items: center;
  border-radius: 4px;
  flex-shrink: 0;

  &:hover {
    background-color: #404040;
    color: #ff6b6b;
  }
`;

const ProgressBarContainer = styled.div`
  width: 100%;
  height: 8px;
  background-color: #3c3c3c;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 1rem;
`;

const ProgressBar = styled.div`
  height: 100%;
  background-color: #007acc;
  transition: width 0.3s ease;
  width: ${props => props.$progress}%;
`;

const ProgressText = styled.p`
  color: #cccccc;
  font-size: 0.875rem;
  text-align: center;
  margin: 0.5rem 0;
`;

const ButtonContainer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
`;

const Button = styled.button`
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: all 0.2s;

  ${props => props.$primary ? `
    background-color: #007acc;
    color: #ffffff;
    &:hover:not(:disabled) {
      background-color: #005a9e;
    }
  ` : `
    background-color: #3c3c3c;
    color: #cccccc;
    &:hover {
      background-color: #4a4a4a;
    }
  `}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const UploadModal = ({ isOpen, onClose, onUpload }) => {
  const [uploadType, setUploadType] = useState('file'); // 'file' or 'folder'
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  if (!isOpen) return null;

  const handleFileSelect = (event) => {
    const files = filterSystemFiles(Array.from(event.target.files));
    setSelectedFiles(files);
  };

  const handleUploadAreaClick = () => {
    if (uploadType === 'file') {
      fileInputRef.current?.click();
    } else {
      folderInputRef.current?.click();
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // シミュレーション用のプログレス更新
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 100);

      await onUpload(selectedFiles);

      clearInterval(progressInterval);
      setUploadProgress(100);

      // 完了後、少し待ってからモーダルを閉じる
      setTimeout(() => {
        handleClose();
      }, 500);

    } catch (error) {
      console.error('Upload error:', error);
      setIsUploading(false);
      setUploadProgress(0);
      alert('アップロードに失敗しました');
    }
  };

  const handleClose = () => {
    setSelectedFiles([]);
    setUploadProgress(0);
    setIsUploading(false);
    setUploadType('file');
    onClose();
  };

  const handleTypeChange = (type) => {
    setUploadType(type);
    setSelectedFiles([]);
    setUploadProgress(0);
  };

  const handleRemoveFile = (index) => {
    setSelectedFiles(prevFiles => prevFiles.filter((_, i) => i !== index));
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // relatedTargetがnullの場合（モーダル外に出た場合）のみfalseにする
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isUploading) return;

    const items = Array.from(e.dataTransfer.items);
    const droppedFiles = Array.from(e.dataTransfer.files);

    console.log('=== ドロップイベント詳細 ===');
    console.log('items数:', items.length);
    console.log('files数:', droppedFiles.length);
    console.log('droppedFiles:', droppedFiles);

    const files = [];

    // DataTransferItemListから全ファイルを収集
    const processEntry = async (entry, path = '') => {
      console.log('processEntry:', entry.name, 'isFile:', entry.isFile, 'isDirectory:', entry.isDirectory);

      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file((file) => {
            console.log('ファイル追加:', file.name);
            // webkitRelativePathを設定してフォルダ構造を保持
            Object.defineProperty(file, 'webkitRelativePath', {
              value: path + file.name,
              writable: false
            });
            if (!isSystemFile(file)) {
              files.push(file);
            }
            resolve();
          });
        });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();

        // readEntriesは一度に全てのエントリを返さない可能性があるため、繰り返し呼び出す
        const readAllEntries = async () => {
          const allEntries = [];
          let entries;

          do {
            entries = await new Promise((resolve) => {
              reader.readEntries(resolve);
            });
            console.log('readEntries結果:', entries.length, '個のエントリ');
            allEntries.push(...entries);
          } while (entries.length > 0);

          return allEntries;
        };

        const entries = await readAllEntries();
        console.log('ディレクトリ内の全エントリ数:', entries.length);
        for (const childEntry of entries) {
          await processEntry(childEntry, path + entry.name + '/');
        }
      }
    };

    try {
      // itemsが存在する場合はFileSystem APIを試行
      if (items.length > 0 && items[0].webkitGetAsEntry) {
        console.log('FileSystem API使用');
        const processedIndices = new Set();

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const entry = item.webkitGetAsEntry();
          console.log(`entry[${i}]:`, entry);

          if (entry) {
            await processEntry(entry);
            processedIndices.add(i);
          }
        }

        // webkitGetAsEntryがnullを返したファイルはdataTransfer.filesから取得
        console.log('処理できなかったファイルのインデックス数:', items.length - processedIndices.size);
        for (let i = 0; i < droppedFiles.length; i++) {
          if (!processedIndices.has(i)) {
            console.log('フォールバックで追加:', droppedFiles[i].name);
            if (!isSystemFile(droppedFiles[i])) {
              files.push(droppedFiles[i]);
            }
          }
        }
      } else {
        // フォールバック: 通常のFileオブジェクトとして処理
        console.log('フォールバック: dataTransfer.files使用');
        droppedFiles.forEach(file => {
          if (!isSystemFile(file)) {
            files.push(file);
          }
        });
      }

      console.log('最終的なfiles配列の長さ:', files.length);
      console.log('files配列:', files);

      // ファイルタイプで、かつフォルダがドロップされた場合は警告
      if (uploadType === 'file' && files.some(f => f.webkitRelativePath && f.webkitRelativePath.includes('/'))) {
        alert('フォルダをアップロードするには、「フォルダ」タブを選択してください');
        return;
      }

      const filteredFiles = filterSystemFiles(files);

      if (filteredFiles.length > 0) {
        // 既存のファイルに追加（重複チェック）
        setSelectedFiles(prevFiles => {
          const existingPaths = new Set(
            prevFiles.map(f => f.webkitRelativePath || f.name)
          );
          const newFiles = filteredFiles.filter(
            f => !existingPaths.has(f.webkitRelativePath || f.name)
          );
          console.log('既存ファイル数:', prevFiles.length);
          console.log('新規ファイル数:', newFiles.length);
          console.log('重複除外後の追加ファイル数:', newFiles.length);
          return [...prevFiles, ...newFiles];
        });
      }
    } catch (error) {
      console.error('ドロップ処理エラー:', error);
      alert('ファイルの読み込みに失敗しました');
    }
  };

  const modalContent = (
    <ModalOverlay onClick={handleClose}>
      <ModalContent
        onClick={(e) => e.stopPropagation()}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <ModalHeader>
          <ModalTitle>ファイルアップロード</ModalTitle>
          <CloseButton onClick={handleClose}>
            <FiX size={20} />
          </CloseButton>
        </ModalHeader>

        <UploadTypeContainer>
          <UploadTypeButton
            $selected={uploadType === 'file'}
            onClick={() => handleTypeChange('file')}
            disabled={isUploading}
          >
            <FiFile size={32} />
            <UploadTypeLabel>ファイル</UploadTypeLabel>
          </UploadTypeButton>
          <UploadTypeButton
            $selected={uploadType === 'folder'}
            onClick={() => handleTypeChange('folder')}
            disabled={isUploading}
          >
            <FiFolder size={32} />
            <UploadTypeLabel>フォルダ</UploadTypeLabel>
          </UploadTypeButton>
        </UploadTypeContainer>

        <FileInputArea
          onClick={handleUploadAreaClick}
          $isDragging={isDragging}
        >
          <FiUpload size={48} color="#007acc" />
          <FileInputText>
            {isDragging
              ? uploadType === 'file'
                ? 'ファイルをドロップしてください'
                : 'フォルダをドロップしてください'
              : uploadType === 'file'
              ? 'クリックまたはドラッグ&ドロップでファイルを選択'
              : 'クリックまたはドラッグ&ドロップでフォルダを選択'}
          </FileInputText>
          <FileInputText style={{ fontSize: '0.75rem', color: '#999999' }}>
            {uploadType === 'file'
              ? '複数ファイルの選択が可能です'
              : 'フォルダ構造がそのまま保持されます'}
          </FileInputText>
        </FileInputArea>

        {selectedFiles.length > 0 && (
          <SelectedFilesContainer>
            {selectedFiles.map((file, index) => (
              <SelectedFileItem key={index}>
                <FileName title={file.webkitRelativePath || file.name}>
                  {file.webkitRelativePath || file.name}
                </FileName>
                <RemoveFileButton
                  onClick={() => handleRemoveFile(index)}
                  disabled={isUploading}
                  title="削除"
                >
                  <FiX size={16} />
                </RemoveFileButton>
              </SelectedFileItem>
            ))}
          </SelectedFilesContainer>
        )}

        {isUploading && (
          <>
            <ProgressBarContainer>
              <ProgressBar $progress={uploadProgress} />
            </ProgressBarContainer>
            <ProgressText>
              アップロード中... {uploadProgress}%
            </ProgressText>
          </>
        )}

        <ButtonContainer>
          <Button onClick={handleClose} disabled={isUploading}>
            キャンセル
          </Button>
          <Button
            $primary
            onClick={handleUpload}
            disabled={selectedFiles.length === 0 || isUploading}
          >
            アップロード
          </Button>
        </ButtonContainer>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          webkitdirectory=""
          directory=""
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
      </ModalContent>
    </ModalOverlay>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default UploadModal;
