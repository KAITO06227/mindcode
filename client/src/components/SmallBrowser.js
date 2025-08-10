import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import axios from 'axios';
import {
  FiArrowLeft,
  FiArrowRight,
  FiRefreshCw,
  FiExternalLink,
  FiPlay
} from 'react-icons/fi';

const BrowserContainer = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #1e1e1e;
`;

const BrowserToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background-color: #2d2d2d;
  border-bottom: 1px solid #404040;
  min-height: 40px;
`;

const ToolbarButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background-color: #404040;
  border: none;
  border-radius: 4px;
  color: #cccccc;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    background-color: #555555;
    color: #ffffff;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const BrowserLabel = styled.span`
  color: #cccccc;
  font-size: 0.75rem;
  font-weight: 500;
  margin-left: auto;
  margin-right: 0.5rem;
`;

const IframeContainer = styled.div`
  flex: 1;
  position: relative;
  background-color: #ffffff;
`;

const IFrame = styled.iframe`
  width: 100%;
  height: 100%;
  border: none;
  background-color: #ffffff;
`;

const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.1);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
`;

const LoadingSpinner = styled.div`
  width: 20px;
  height: 20px;
  border: 2px solid #cccccc;
  border-top: 2px solid #007acc;
  border-radius: 50%;
  animation: spin 1s linear infinite;

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const ErrorMessage = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  color: #888888;
  text-align: center;
  padding: 2rem;
`;

const ErrorTitle = styled.h3`
  color: #cccccc;
  margin-bottom: 0.5rem;
`;

const SmallBrowser = ({ projectId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(['']);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [htmlContent, setHtmlContent] = useState('');
  const iframeRef = useRef(null);

  useEffect(() => {
    loadProject();
  }, [projectId]);

  // Update iframe when htmlContent changes
  useEffect(() => {
    if (htmlContent) {
      updateIframe(htmlContent);
    }
  }, [htmlContent]);

  const loadProject = async () => {
    if (!projectId) return;
    
    console.log('SmallBrowser: loadProject called for projectId:', projectId);
    setLoading(true);
    setError(null);

    try {
      // Get the project's HTML content
      const response = await axios.get(`/api/files/tree/${projectId}`);
      const fileTree = response.data;

      // Look for index.html
      const indexFile = findFile(fileTree, 'index.html');
      
      if (indexFile) {
        const fileResponse = await axios.get(`/api/files/${projectId}/${indexFile.id}`);
        let htmlContent = fileResponse.data.content;

        // Get CSS and JS files to embed
        const cssFiles = findFilesByExtension(fileTree, 'css');
        const jsFiles = findFilesByExtension(fileTree, 'js');

        // Embed CSS files
        for (const cssFile of cssFiles) {
          try {
            const cssResponse = await axios.get(`/api/files/${projectId}/${cssFile.id}`);
            const cssContent = cssResponse.data.content;
            
            // Replace various CSS link patterns
            const fileName = cssFile.name || cssFile.file_name;
            
            // Simple string replacements first
            const exactPatterns = [
              `<link rel="stylesheet" href="${fileName}">`,
              `<link rel="stylesheet" href="${fileName}" />`,
              `<link href="${fileName}" rel="stylesheet">`,
              `<link href="${fileName}" rel="stylesheet" />`,
              `<link rel="stylesheet" href="./${fileName}">`,
              `<link rel="stylesheet" href="./${fileName}" />`
            ];
            
            exactPatterns.forEach(pattern => {
              htmlContent = htmlContent.replace(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 
                `<style>\n${cssContent}\n</style>`);
            });
            
            console.log(`Embedded CSS file: ${fileName}`);
          } catch (error) {
            console.warn(`Failed to embed CSS file ${cssFile.name}:`, error);
          }
        }

        // Embed JS files
        for (const jsFile of jsFiles) {
          try {
            const jsResponse = await axios.get(`/api/files/${projectId}/${jsFile.id}`);
            const jsContent = jsResponse.data.content;
            
            // Replace various script src patterns
            const fileName = jsFile.name || jsFile.file_name;
            
            const exactPatterns = [
              `<script src="${fileName}"></script>`,
              `<script src="${fileName}"></script>`,
              `<script src="./${fileName}"></script>`,
              `<script type="text/javascript" src="${fileName}"></script>`,
              `<script type="text/javascript" src="./${fileName}"></script>`
            ];
            
            exactPatterns.forEach(pattern => {
              htmlContent = htmlContent.replace(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 
                `<script>\n${jsContent}\n</script>`);
            });
            
            console.log(`Embedded JS file: ${fileName}`);
          } catch (error) {
            console.warn(`Failed to embed JS file ${jsFile.name}:`, error);
          }
        }

        // Clean up any remaining external references that couldn't be embedded
        // Remove broken CSS links
        htmlContent = htmlContent.replace(/<link[^>]*href=['"'][^'"]*\.css['"][^>]*>/gi, 
          '<!-- CSS file not found and removed -->');
        
        // Remove broken script sources  
        htmlContent = htmlContent.replace(/<script[^>]*src=['"'][^'"]*\.js['"][^>]*><\/script>/gi, 
          '<!-- JS file not found and removed -->');

        console.log('SmallBrowser: Setting HTML content:', htmlContent.length, 'characters');
        setHtmlContent(htmlContent);
      } else {
        setError('No index.html file found in project');
      }
    } catch (error) {
      console.error('Error loading project:', error);
      setError('Failed to load project preview');
    } finally {
      setLoading(false);
    }
  };

  const findFile = (tree, fileName) => {
    for (const key in tree) {
      const item = tree[key];
      if (item.type === 'file' && item.name === fileName) {
        return item;
      }
      if (item.type === 'folder' && item.children) {
        const found = findFile(item.children, fileName);
        if (found) return found;
      }
    }
    return null;
  };

  const findFilesByExtension = (tree, extension) => {
    const files = [];
    
    const traverse = (node) => {
      for (const key in node) {
        const item = node[key];
        if (item.type === 'file' && item.name.endsWith(`.${extension}`)) {
          files.push(item);
        }
        if (item.type === 'folder' && item.children) {
          traverse(item.children);
        }
      }
    };
    
    traverse(tree);
    return files;
  };

  const updateIframe = (content) => {
    if (iframeRef.current && content) {
      const iframe = iframeRef.current;
      
      console.log('SmallBrowser: updateIframe called with content length:', content.length);
      
      // Always update - remove the content comparison that might be causing issues
      console.log('SmallBrowser: Updating iframe with fresh content');
      
      // Clear existing content first
      iframe.removeAttribute('srcdoc');
      
      // Add timestamp to force refresh
      const timestampedContent = content.replace(
        '<html',
        `<html data-timestamp="${Date.now()}"`
      );
      
      // Set new content
      iframe.setAttribute('srcdoc', timestampedContent);
      
      console.log('SmallBrowser: Iframe updated successfully');
    } else {
      console.log('SmallBrowser: updateIframe - no iframe or content');
    }
  };

  const handleBack = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      // In a real implementation, this would navigate back
    }
  };

  const handleForward = () => {
    if (currentIndex < history.length - 1) {
      setCurrentIndex(currentIndex + 1);
      // In a real implementation, this would navigate forward
    }
  };

  const handleRefresh = () => {
    console.log('SmallBrowser: Manual refresh triggered');
    console.log('SmallBrowser: Current htmlContent:', htmlContent ? htmlContent.length : 'none');
    
    // Always reload the project to get fresh content
    loadProject();
  };

  const handleOpenInNewTab = () => {
    if (projectId) {
      // Use server-side preview endpoint for persistent URL
      const previewUrl = `/api/projects/${projectId}/preview`;
      window.open(previewUrl, '_blank');
    } else if (htmlContent) {
      // Fallback to data URL
      const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
      window.open(dataUrl, '_blank');
    }
  };

  const handleRunProject = () => {
    loadProject();
  };

  if (error) {
    return (
      <BrowserContainer>
        <BrowserToolbar>
          <ToolbarButton onClick={handleRunProject}>
            <FiPlay size={14} />
          </ToolbarButton>
          <BrowserLabel>スモールブラウザ</BrowserLabel>
        </BrowserToolbar>
        <ErrorMessage>
          <ErrorTitle>Preview Error</ErrorTitle>
          <p>{error}</p>
          <ToolbarButton onClick={loadProject} style={{ marginTop: '1rem', width: 'auto', padding: '0.5rem 1rem' }}>
            <FiRefreshCw size={14} style={{ marginRight: '0.5rem' }} />
            Retry
          </ToolbarButton>
        </ErrorMessage>
      </BrowserContainer>
    );
  }

  return (
    <BrowserContainer>
      <BrowserToolbar>
        <ToolbarButton
          onClick={handleBack}
          disabled={currentIndex === 0}
          title="Back"
        >
          <FiArrowLeft size={14} />
        </ToolbarButton>
        
        <ToolbarButton
          onClick={handleForward}
          disabled={currentIndex >= history.length - 1}
          title="Forward"
        >
          <FiArrowRight size={14} />
        </ToolbarButton>
        
        <ToolbarButton
          onClick={handleRefresh}
          title="Refresh"
        >
          <FiRefreshCw size={14} />
        </ToolbarButton>
        
        <BrowserLabel>スモールブラウザ</BrowserLabel>
        
        <ToolbarButton
          onClick={handleOpenInNewTab}
          title="Open in new tab"
          disabled={!htmlContent}
        >
          <FiExternalLink size={14} />
        </ToolbarButton>
      </BrowserToolbar>

      <IframeContainer>
        {loading && (
          <LoadingOverlay>
            <LoadingSpinner />
          </LoadingOverlay>
        )}
        
        <IFrame
          ref={iframeRef}
          title="Project Preview"
          sandbox="allow-scripts allow-forms allow-same-origin"
          srcDoc={htmlContent}
        />
      </IframeContainer>
    </BrowserContainer>
  );
};

export default SmallBrowser;