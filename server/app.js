const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
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
const fileRoutes = require('./routes/files');
const claudeRoutes = require('./routes/claude');
const adminRoutes = require('./routes/admin');
const gitRoutes = require('./routes/git');

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/claude', claudeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/git', gitRoutes);

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;