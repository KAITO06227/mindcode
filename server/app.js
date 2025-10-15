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
const claudeRoutes = require('./routes/claude');
const adminRoutes = require('./routes/admin');
const fileSystemRoutes = require('./routes/fileSystem');
const versionControlRoutes = require('./routes/versionControl');
const userSettingsRoutes = require('./routes/userSettings');
const userProjectStaticRoutes = require('./routes/userProjectStatic');
const projectMembersRoutes = require('./routes/projectMembers');
const projectInvitationsRoutes = require('./routes/projectInvitations');
const { initFileTreeEvents } = require('./sockets/fileTreeEvents');

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', projectMembersRoutes); // Multi-user collaboration: members
app.use('/api/projects', projectInvitationsRoutes); // Multi-user collaboration: invitations
app.use('/api', projectInvitationsRoutes); // Invitation acceptance routes without /projects prefix
app.use('/api/claude', claudeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/filesystem', fileSystemRoutes); // New filesystem API
app.use('/api/version-control', versionControlRoutes); // New Git API
app.use('/api/user-settings', userSettingsRoutes);
app.use('/user_projects', userProjectStaticRoutes);

// Initialize Socket.IO for terminal sessions (using fallback without node-pty)
const claudeSocket = require('./sockets/claudeSocketSimple');
claudeSocket(io);
initFileTreeEvents(io);

// Initialize Socket.IO for invitation notifications
const invitationSocket = require('./sockets/invitationSocket');
invitationSocket(io);

// Make io accessible in routes
app.set('io', io);

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

server.listen(PORT);

module.exports = app;
