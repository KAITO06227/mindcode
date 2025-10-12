const jwt = require('jsonwebtoken');

let fileEventsNamespace = null;

function initFileTreeEvents(io) {
  fileEventsNamespace = io.of('/file-events');

  fileEventsNamespace.on('connection', (socket) => {
    const { projectId, token } = socket.handshake.query;

    if (!projectId) {
      console.warn('file-events: connection without projectId, disconnecting');
      socket.disconnect();
      return;
    }

    if (!token) {
      console.warn('file-events: connection without token, disconnecting');
      socket.disconnect();
      return;
    }

    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded?.id;
    } catch (error) {
      console.warn('file-events: invalid token, disconnecting');
      socket.disconnect();
      return;
    }

    if (!userId) {
      socket.disconnect();
      return;
    }

    const roomId = `${userId}:${projectId}`;
    socket.join(roomId);
  });
}

function emitFileTreeUpdate(userId, projectId, payload = {}) {
  if (!fileEventsNamespace) {
    return;
  }

  const roomId = `${userId}:${projectId}`;
  fileEventsNamespace.to(roomId).emit('file-tree:update', {
    projectId,
    userId,
    timestamp: Date.now(),
    ...payload
  });
}

module.exports = {
  initFileTreeEvents,
  emitFileTreeUpdate
};
