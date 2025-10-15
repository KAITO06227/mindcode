/**
 * Socket.IO handler for real-time invitation notifications
 */

const { verifyToken } = require('../middleware/auth');

// ユーザーIDとSocket IDのマッピング
const userSockets = new Map(); // userId -> Set of socket.id
const emailSockets = new Map(); // email -> Set of socket.id

module.exports = (io) => {
  // 招待通知専用のnamespace
  const invitationNamespace = io.of('/invitations');

  invitationNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error('認証トークンが必要です'));
    }

    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      socket.user = decoded;
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('認証に失敗しました'));
    }
  });

  invitationNamespace.on('connection', (socket) => {
    console.log(`Invitation socket connected: ${socket.id}, user: ${socket.user?.email}`);

    // ユーザー登録
    socket.on('register:user', (data) => {
      const { userId, email } = data;

      if (userId) {
        if (!userSockets.has(userId)) {
          userSockets.set(userId, new Set());
        }
        userSockets.get(userId).add(socket.id);
        console.log(`User ${userId} registered socket ${socket.id}`);
      }

      if (email) {
        if (!emailSockets.has(email)) {
          emailSockets.set(email, new Set());
        }
        emailSockets.get(email).add(socket.id);
        console.log(`Email ${email} registered socket ${socket.id}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Invitation socket disconnected: ${socket.id}`);

      // 全てのマッピングから削除
      userSockets.forEach((sockets, userId) => {
        if (sockets.has(socket.id)) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            userSockets.delete(userId);
          }
        }
      });

      emailSockets.forEach((sockets, email) => {
        if (sockets.has(socket.id)) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            emailSockets.delete(email);
          }
        }
      });
    });
  });

  /**
   * 特定のメールアドレスに招待通知を送信
   * @param {string} email - 招待されたユーザーのメールアドレス
   * @param {object} invitation - 招待情報
   */
  const notifyInvitation = (email, invitation) => {
    const sockets = emailSockets.get(email);
    if (sockets && sockets.size > 0) {
      console.log(`Sending invitation notification to ${email} (${sockets.size} connections)`);
      sockets.forEach(socketId => {
        invitationNamespace.to(socketId).emit('invitation:received', invitation);
      });
    } else {
      console.log(`No active sockets found for ${email}`);
    }
  };

  // io オブジェクトに招待通知関数を追加
  io.notifyInvitation = notifyInvitation;

  return invitationNamespace;
};
