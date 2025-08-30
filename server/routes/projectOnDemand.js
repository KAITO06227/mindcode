const express = require('express');
const { verifyToken } = require('../middleware/auth');
const db = require('../database/connection');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

const router = express.Router();

// Cache for recent executions (with TTL)
const executionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Execute project on-demand without persistent server
 */
async function executeProjectOnDemand(projectPath, requestPath = '/', method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Execution timeout'));
    }, 15000); // 15 second timeout

    // Create a temporary HTTP server for the project
    const serverProcess = spawn('node', ['-e', `
      const express = require('express');
      const cors = require('cors');
      const path = require('path');
      require('dotenv').config();

      const app = express();
      const PORT = process.env.PORT || 3000;

      // Middleware
      app.use(cors());
      app.use(express.json());
      app.use(express.urlencoded({ extended: true }));

      // Load and execute the student's server.js
      try {
        delete require.cache[require.resolve('./server.js')];
        const studentApp = require('./server.js');
        
        // Create a single request handler
        app.use('*', (req, res, next) => {
          // Simulate the specific request
          if (req.method === '${method}' && req.originalUrl === '${requestPath}') {
            // Forward to student app
            studentApp(req, res, next);
          } else if (req.originalUrl === '${requestPath}') {
            studentApp(req, res, next);
          } else {
            res.status(404).json({ error: 'Route not found in on-demand execution' });
          }
        });

        const server = app.listen(PORT, () => {
          console.log('Temporary server ready on port', PORT);
          
          // Make the actual request
          const http = require('http');
          const options = {
            hostname: 'localhost',
            port: PORT,
            path: '${requestPath}',
            method: '${method}',
            headers: {
              'Content-Type': 'application/json'
            }
          };

          const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              server.close();
              process.exit(0);
            });
          });

          if (body && method !== 'GET') {
            req.write(JSON.stringify(body));
          }
          req.end();
        });

      } catch (error) {
        console.error('Error loading student server:', error.message);
        process.exit(1);
      }
    `], {
      cwd: projectPath,
      env: {
        ...process.env,
        PORT: 0, // Let system assign port
        NODE_ENV: 'development'
      }
    });

    let responseData = '';
    let errorData = '';

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[OnDemand]', output);
      
      // Detect when we have response data
      if (output.includes('HTTP/') || output.includes('Content-Type')) {
        responseData += output;
      }
    });

    serverProcess.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    serverProcess.on('close', (code) => {
      clearTimeout(timeout);
      
      if (code === 0) {
        resolve({
          success: true,
          data: responseData || 'Request completed successfully',
          executionTime: Date.now()
        });
      } else {
        reject(new Error(`Execution failed with code ${code}: ${errorData}`));
      }
    });

    serverProcess.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * Enhanced static file serving for on-demand execution
 */
async function serveProjectStaticFile(projectPath, requestPath) {
  try {
    const publicDir = path.join(projectPath, 'public');
    const filePath = path.join(publicDir, requestPath === '/' ? 'index.html' : requestPath);

    // Check if file exists
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Get content type
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml'
    };

    return {
      success: true,
      content,
      contentType: contentTypes[ext] || 'text/plain',
      isStatic: true
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// GET /api/project-ondemand/:projectId - Execute project on-demand
router.all('/:projectId/*', verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const requestPath = '/' + (req.params[0] || '');
    const method = req.method;
    const body = req.body;
    
    console.log(`On-demand execution: ${method} ${requestPath} for project ${projectId}`);

    // Verify project ownership
    const [projects] = await db.execute(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?',
      [projectId, req.user.id]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: 'Project not found or access denied' });
    }

    const projectPath = path.join(__dirname, '../../user_projects', req.user.id.toString(), projectId);
    
    // Check cache first
    const cacheKey = `${projectId}-${method}-${requestPath}`;
    const cached = executionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('Returning cached result');
      if (cached.data.isStatic) {
        res.set('Content-Type', cached.data.contentType);
        return res.send(cached.data.content);
      }
      return res.json(cached.data);
    }

    try {
      // First try static file serving
      if (method === 'GET') {
        const staticResult = await serveProjectStaticFile(projectPath, requestPath);
        if (staticResult.success) {
          // Cache static files
          executionCache.set(cacheKey, {
            data: staticResult,
            timestamp: Date.now()
          });
          
          res.set('Content-Type', staticResult.contentType);
          return res.send(staticResult.content);
        }
      }

      // If not static file, execute on-demand
      const result = await executeProjectOnDemand(projectPath, requestPath, method, body);
      
      // Cache successful results
      executionCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      res.json({
        message: 'Project executed successfully',
        result: result.data,
        cached: false,
        executionTime: new Date().toISOString()
      });

    } catch (error) {
      console.error(`On-demand execution failed for ${projectId}:`, error);
      
      res.status(500).json({
        message: 'Project execution failed',
        error: error.message,
        hint: 'Check if your server.js file is valid and all dependencies are installed'
      });
    }

  } catch (error) {
    console.error('Error in on-demand execution:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Clean up cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of executionCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      executionCache.delete(key);
    }
  }
}, 60000); // Clean every minute

module.exports = router;