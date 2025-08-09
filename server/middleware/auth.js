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
    const token = req.headers.authorization?.split(' ')[1];
    
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

module.exports = {
  generateToken,
  verifyToken,
  isTeacher
};