const express = require('express');
const http = require('http');
const { verifyToken } = require('../middleware/auth');
const db = require('../database/connection');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const url = require('url');

const router = express.Router();

// Get Socket.IO instance (will be set by app.js)
let io = null;
const setSocketIO = (socketIOInstance) => {
  io = socketIOInstance;
};

// Cleanup servers on process exit
process.on('SIGTERM', () => {
  console.log('Cleaning up active project servers...');
  for (const [projectId, serverInfo] of activeServers) {
    if (serverInfo.process) {
      serverInfo.process.kill('SIGTERM');
    }
  }
});

module.exports = router;
module.exports.setSocketIO = setSocketIO;

// Store active project servers
const activeServers = new Map();
const serverPorts = new Map(); // projectId -> port mapping
let portCounter = 4000; // Starting port for project servers

/**
 * Get next available port for project server
 */
function getNextAvailablePort() {
  return portCounter++;
}

/**
 * Start a Node.js project server
 */
async function startProjectServer(projectId, userId, projectPath) {
  try {
    // Check if server is already running
    if (activeServers.has(projectId)) {
      const existingServer = activeServers.get(projectId);
      if (existingServer.process && !existingServer.process.killed) {
        console.log(`Project ${projectId} server already running on port ${existingServer.port}`);
        return existingServer.port;
      }
    }

    // Get available port
    const port = getNextAvailablePort();
    
    // Check if package.json exists
    const packageJsonPath = path.join(projectPath, 'package.json');
    try {
      await fs.access(packageJsonPath);
    } catch (error) {
      throw new Error('package.json not found. This is not a Node.js project.');
    }

    // Check if server.js exists
    const serverJsPath = path.join(projectPath, 'server.js');
    try {
      await fs.access(serverJsPath);
    } catch (error) {
      throw new Error('server.js not found. Please create a server.js file.');
    }

    console.log(`Starting project server for ${projectId} on port ${port}`);

    // Spawn the Node.js process
    const serverProcess = spawn('node', ['server.js'], {
      cwd: projectPath,
      env: {
        ...process.env,
        PORT: port,
        HOST: '0.0.0.0', // Allow external access
        NODE_ENV: 'development'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Store server info
    const serverInfo = {
      process: serverProcess,
      port: port,
      projectId: projectId,
      userId: userId,
      startTime: Date.now(),
      status: 'starting'
    };

    activeServers.set(projectId, serverInfo);
    serverPorts.set(projectId, port);

    // Handle server output
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Project ${projectId}] ${output}`);
      
      // Emit server logs via Socket.IO
      if (io) {
        io.emit(`server_log_${projectId}`, {
          type: 'stdout',
          data: output,
          timestamp: new Date().toISOString()
        });
      }
      
      // Detect when server is ready
      if (output.includes('Server running') || output.includes('listening')) {
        serverInfo.status = 'running';
        console.log(`✅ Project ${projectId} server is ready on port ${port}`);
        console.log(`🌐 External URL: http://[your-domain]:${port}`);
        console.log(`📱 Local access: http://localhost:${port}`);
        console.log(`🔧 Server binding: 0.0.0.0:${port} (external access enabled)`);
        
        // Emit server ready status
        if (io) {
          io.emit(`server_status_${projectId}`, {
            status: 'running',
            port: port,
            message: 'サーバーが正常に起動しました（外部アクセス可能）'
          });
        }
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[Project ${projectId} ERROR] ${output}`);
      
      // Emit server error logs via Socket.IO
      if (io) {
        io.emit(`server_log_${projectId}`, {
          type: 'stderr',
          data: output,
          timestamp: new Date().toISOString()
        });
      }
    });

    serverProcess.on('close', (code) => {
      console.log(`[Project ${projectId}] Server process exited with code ${code}`);
      serverInfo.status = 'stopped';
      
      // Emit server stopped status
      if (io) {
        io.emit(`server_log_${projectId}`, {
          type: 'info',
          data: `Server process exited with code ${code}\n`,
          timestamp: new Date().toISOString()
        });
        
        io.emit(`server_status_${projectId}`, {
          status: 'stopped',
          port: null,
          message: 'サーバーが停止しました'
        });
      }
      
      // Clean up after a delay
      setTimeout(() => {
        activeServers.delete(projectId);
        serverPorts.delete(projectId);
      }, 5000);
    });

    serverProcess.on('error', (error) => {
      console.error(`[Project ${projectId}] Server process error:`, error);
      serverInfo.status = 'error';
      serverInfo.error = error.message;
      
      // Emit server error status
      if (io) {
        io.emit(`server_log_${projectId}`, {
          type: 'stderr',
          data: `Server process error: ${error.message}\n`,
          timestamp: new Date().toISOString()
        });
        
        io.emit(`server_status_${projectId}`, {
          status: 'error',
          port: null,
          message: `サーバーエラー: ${error.message}`
        });
      }
    });

    // Wait a moment for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return port;

  } catch (error) {
    console.error(`Error starting project server ${projectId}:`, error);
    throw error;
  }
}

/**
 * Stop a project server
 */
function stopProjectServer(projectId) {
  const serverInfo = activeServers.get(projectId);
  if (serverInfo && serverInfo.process) {
    console.log(`Stopping project server ${projectId}`);
    serverInfo.process.kill('SIGTERM');
    serverInfo.status = 'stopping';
    
    // Force kill after 5 seconds if not terminated
    setTimeout(() => {
      if (serverInfo.process && !serverInfo.process.killed) {
        serverInfo.process.kill('SIGKILL');
      }
    }, 5000);
  }
}

// GET /api/project-proxy/:projectId/start - Start project server
router.post('/:projectId/start', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    
    try {
      const port = await startProjectServer(projectId, req.user.id, projectPath);
      
      res.json({
        message: 'Project server started successfully',
        port: port,
        proxyUrl: `/api/project-proxy/${projectId}/app`,
        directUrl: `http://localhost:${port}`,
        status: 'starting'
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to start project server',
        error: error.message
      });
    }

  } catch (error) {
    console.error('Error in start project server:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/project-proxy/:projectId/stop - Stop project server
router.post('/:projectId/stop', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    stopProjectServer(projectId);
    
    res.json({
      message: 'Project server stop requested',
      projectId: projectId
    });

  } catch (error) {
    console.error('Error stopping project server:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/project-proxy/:projectId/status - Get project server status
router.get('/:projectId/status', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const serverInfo = activeServers.get(projectId);
    
    if (serverInfo) {
      res.json({
        status: serverInfo.status,
        port: serverInfo.port,
        proxyUrl: `/api/project-proxy/${projectId}/app`,
        startTime: serverInfo.startTime,
        uptime: Date.now() - serverInfo.startTime,
        error: serverInfo.error || null
      });
    } else {
      res.json({
        status: 'stopped',
        port: null,
        proxyUrl: null,
        startTime: null,
        uptime: 0
      });
    }

  } catch (error) {
    console.error('Error getting project server status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * Custom proxy implementation using Node.js http module
 */
function proxyRequest(req, res, targetPort, projectId) {
  // Parse the original request path and remove proxy prefix
  const proxyPrefix = `/api/project-proxy/${projectId}/app`;
  let originalPath = req.path;
  
  // Remove proxy prefix
  if (originalPath.startsWith(proxyPrefix)) {
    originalPath = originalPath.substring(proxyPrefix.length);
  }
  
  // Ensure path starts with /
  if (!originalPath.startsWith('/')) {
    originalPath = '/' + originalPath;
  }
  
  // Handle root path
  if (originalPath === '/') {
    originalPath = '/';
  }
  
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const targetPath = originalPath + queryString;

  console.log(`🔄 Proxying ${req.method} ${req.url} to http://localhost:${targetPort}${targetPath}`);
  console.log(`📝 Path transformation: ${req.path} -> ${originalPath}`);
  console.log(`🔗 Full target URL: http://localhost:${targetPort}${targetPath}`);

  const options = {
    hostname: 'localhost',
    port: targetPort,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: `localhost:${targetPort}`, // Update host header
      'x-forwarded-host': req.get('host'),
      'x-forwarded-proto': req.protocol,
      'x-forwarded-for': req.ip
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Handle redirects
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      const location = proxyRes.headers.location;
      console.log(`Redirect detected: ${location}`);
      
      // Convert absolute redirects to relative redirects within the proxy
      if (location.startsWith('http://localhost:3000/') || location.startsWith('http://localhost:3000')) {
        const redirectPath = location.replace('http://localhost:3000', '');
        const newLocation = `/api/project-proxy/${projectId}/app${redirectPath}`;
        console.log(`Rewriting redirect to: ${newLocation}`);
        res.setHeader('location', newLocation);
      } else if (location.startsWith('/')) {
        // Relative redirect - prepend proxy path
        const newLocation = `/api/project-proxy/${projectId}/app${location}`;
        console.log(`Rewriting relative redirect to: ${newLocation}`);
        res.setHeader('location', newLocation);
      }
    }
    
    // Set response headers
    res.statusCode = proxyRes.statusCode;
    Object.keys(proxyRes.headers).forEach(key => {
      if (key.toLowerCase() !== 'location') {
        // Remove restrictive CSP headers that might block iframe embedding
        if (key.toLowerCase() === 'x-frame-options' || 
            key.toLowerCase() === 'content-security-policy') {
          return; // Skip these headers
        }
        res.setHeader(key, proxyRes.headers[key]);
      }
    });
    
    // Ensure iframe can be embedded
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    console.log(`📤 Proxy response: ${res.statusCode} for ${req.url}`);

    // Pipe the response
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (error) => {
    console.error(`Proxy error for project ${projectId}:`, error.message);
    if (!res.headersSent) {
      res.status(502).json({ 
        message: 'Project server connection error',
        error: error.message 
      });
    }
  });

  // Handle request timeout
  proxyReq.setTimeout(30000, () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ message: 'Project server timeout' });
    }
  });

  // Pipe request body if present
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

// Proxy requests to running project servers
router.use('/:projectId/app*', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    
    console.log(`🔄 Proxy middleware called for project ${projectId}, path: ${req.path}, URL: ${req.url}`);
    console.log(`🔑 Auth headers:`, req.headers.authorization ? 'Token present' : 'No token');
    console.log(`🔑 Session:`, req.session ? 'Session present' : 'No session');
    
    // Try to get user from token or session
    let userId = null;
    
    // Try JWT token from header first
    if (req.headers.authorization) {
      try {
        const jwt = require('jsonwebtoken');
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.id;
        console.log(`🔑 JWT auth successful for user ${userId}`);
      } catch (error) {
        console.log(`🔑 JWT auth failed:`, error.message);
      }
    }
    
    // Try JWT token from URL parameter if header auth failed
    if (!userId && req.query.token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(req.query.token, process.env.JWT_SECRET);
        userId = decoded.id;
        console.log(`🔑 JWT auth (URL param) successful for user ${userId}`);
      } catch (error) {
        console.log(`🔑 JWT auth (URL param) failed:`, error.message);
      }
    }
    
    // Try session if JWT failed
    if (!userId && req.session && req.session.user) {
      userId = req.session.user.id;
      console.log(`🔑 Session auth successful for user ${userId}`);
    }
    
    // If no authentication method worked, return error
    if (!userId) {
      console.log(`❌ No valid authentication found`);
      return res.status(401).json({ message: 'Authentication required for project access' });
    }
    
    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, userId]
    );

    if (projects.length === 0) {
      console.log(`❌ Project ${projectId} not found or access denied`);
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const serverInfo = activeServers.get(projectId);
    
    if (!serverInfo || serverInfo.status !== 'running') {
      console.log(`❌ Project ${projectId} server not running, status: ${serverInfo?.status || 'not found'}`);
      return res.status(503).json({ 
        message: 'Project server is not running',
        hint: 'Start the server first using the Start Server button'
      });
    }

    console.log(`✅ Project ${projectId} server is running on port ${serverInfo.port}`);
    
    // Use custom proxy function
    proxyRequest(req, res, serverInfo.port, projectId);

  } catch (error) {
    console.error('Error in proxy middleware:', error);
    res.status(500).json({ message: 'Proxy error' });
  }
});

// Cleanup servers on process exit
process.on('SIGTERM', () => {
  console.log('Cleaning up active project servers...');
  for (const [projectId, serverInfo] of activeServers) {
    if (serverInfo.process) {
      serverInfo.process.kill('SIGTERM');
    }
  }
});