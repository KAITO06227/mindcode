const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('../database/connection');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

// Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('Google OAuth Strategy - Profile received:', {
      id: profile.id,
      email: profile.emails[0]?.value,
      name: profile.displayName
    });

    const email = profile.emails[0].value;
    const name = profile.displayName;
    const googleId = profile.id;
    const avatarUrl = profile.photos[0]?.value;

    // 教育用セキュリティ: 青山学院大学のドメインのみ許可
    const allowedDomain = '@gsuite.si.aoyama.ac.jp';

    if (!email.endsWith(allowedDomain)) {
      console.log('Access denied for unauthorized domain:', email);
      return done(new Error('Access denied: You are not authorized to use this application'), null);
    }

    // Check if user exists
    const [existingUsers] = await db.execute(
      'SELECT * FROM users WHERE google_id = ? OR email = ?',
      [googleId, email]
    );

    let user;
    if (existingUsers.length > 0) {
      // Update existing user
      user = existingUsers[0];
      console.log('Updating existing user:', user.email);
      await db.execute(
        'UPDATE users SET name = ?, avatar_url = ?, updated_at = NOW() WHERE id = ?',
        [name, avatarUrl, user.id]
      );
    } else {
      // Create new user
      console.log('Creating new user:', email);
      const [result] = await db.execute(
        'INSERT INTO users (google_id, email, name, avatar_url) VALUES (?, ?, ?, ?)',
        [googleId, email, name, avatarUrl]
      );
      
      const [newUsers] = await db.execute('SELECT * FROM users WHERE id = ?', [result.insertId]);
      user = newUsers[0];
    }

    console.log('OAuth Strategy - User processed:', user.email);
    return done(null, user);
  } catch (error) {
    console.error('OAuth Strategy Error:', error);
    return done(error, null);
  }
}));

// Initiate Google OAuth
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// Google OAuth callback
router.get('/google/callback', 
  (req, res, next) => {
    passport.authenticate('google', { session: false }, (err, user, info) => {
      if (err) {
        console.log('OAuth authentication error:', err.message);
        return res.redirect(`${process.env.CLIENT_URL || 'http://localhost:3000'}/login?error=unauthorized`);
      }
      
      if (!user) {
        console.log('OAuth failed - No user found');
        return res.redirect(`${process.env.CLIENT_URL || 'http://localhost:3000'}/login?error=auth_failed`);
      }
      
      console.log('OAuth callback - User:', user);
      const token = generateToken(user);
      console.log('Generated token for user:', user.email);
      
      // Redirect to frontend with token
      res.redirect(`${process.env.CLIENT_URL || 'http://localhost:3000'}?token=${token}`);
    })(req, res, next);
  }
);

// Get current user
router.get('/me', require('../middleware/auth').verifyToken, (req, res) => {
  const { password, ...userWithoutPassword } = req.user;
  res.json(userWithoutPassword);
});

// Logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;