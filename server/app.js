const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files only in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
}

// Database connection
const db = require('./database/connection');

// Routes
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const fileRoutes = require('./routes/files'); // Legacy - will be phased out
const claudeRoutes = require('./routes/claude');
const adminRoutes = require('./routes/admin');
const fileSystemRoutes = require('./routes/fileSystem');
const versionControlRoutes = require('./routes/versionControl');
const projectProxyRoutes = require('./routes/projectProxy');

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/files', fileRoutes); // Legacy support
app.use('/api/claude', claudeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/filesystem', fileSystemRoutes); // New filesystem API
app.use('/api/version-control', versionControlRoutes); // New Git API
app.use('/api/project-proxy', projectProxyRoutes); // Project proxy server

// Set Socket.IO instance for project proxy
projectProxyRoutes.setSocketIO(io);

// Initialize Socket.IO for terminal sessions (using fallback without node-pty)
const claudeSocket = require('./sockets/claudeSocketSimple');
claudeSocket(io);

// Serve React app for all other routes (only in production)
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ message: 'Internal server error' });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.IO enabled for Claude Terminal`);
});

module.exports = app;