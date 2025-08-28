const jwt = require('jsonwebtoken');
const db = require('../database/connection');

const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      role: user.role 
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

const verifyToken = async (req, res, next) => {
  try {
    // Try to get token from header first, then from query parameter
    let token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      token = req.query.token;
    }
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [decoded.id]);
    
    if (users.length === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = users[0];
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const isTeacher = (req, res, next) => {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ message: 'Teacher access required' });
  }
  next();
};

const verifyTokenSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    
    if (!token) {
      return next(new Error('No token provided'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [decoded.id]);
    
    if (users.length === 0) {
      return next(new Error('User not found'));
    }

    socket.user = users[0];
    next();
  } catch (error) {
    next(new Error('Invalid token'));
  }
};

module.exports = {
  generateToken,
  verifyToken,
  isTeacher,
  verifyTokenSocket
};