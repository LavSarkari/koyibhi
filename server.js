const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const Filter = require('bad-words');
const rateLimit = require('express-rate-limit');

const app = express();

// Trust proxy - required for Render deployment
app.set('trust proxy', 1);

// Rate limiting with proxy support
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  trustProxy: true // Trust the X-Forwarded-For header
});

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Apply rate limiter to all requests
app.use(limiter);

// Middleware
app.use(cors());
app.use(express.static('public'));

// User states
const UserState = {
  DISCONNECTED: 'disconnected',
  WAITING: 'waiting',
  IN_CHAT: 'in_chat'
};

// Store active users and their states
const users = new Map(); // Maps socket.id to user state object
const rooms = new Map(); // Maps room ID to room object
const waitingUsers = new Set();
const filter = new Filter();
let userCount = 0;

// Generate a random 6-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);
  
  // Initialize user state
  users.set(socket.id, {
    state: UserState.DISCONNECTED,
    roomId: null,
    partnerId: null
  });
  
  userCount++;
  io.emit('user-count', userCount);

  // Handle creating a new room with code
  socket.on('create-room', () => {
    try {
      const user = users.get(socket.id);
      if (!user) {
        socket.emit('room-error', 'User not found');
        return;
      }

      if (user.state !== UserState.DISCONNECTED) {
        leaveCurrentRoom(socket);
      }

      const roomId = generateRoomCode();
      
      // Create new room
      rooms.set(roomId, { 
        users: [socket.id],
        type: 'code',
        createdAt: Date.now()
      });

      // Update user state
      user.state = UserState.WAITING;
      user.roomId = roomId;
      user.partnerId = null;
      
      // Join socket.io room
      socket.join(roomId);
      socket.roomId = roomId;
      
      console.log(`Room ${roomId} created by user ${socket.id}`);
      socket.emit('room-created', roomId);
    } catch (error) {
      console.error('Error creating room:', error);
      socket.emit('room-error', 'Failed to create room');
    }
  });

  // Handle joining a room with code
  socket.on('join-room', ({ roomId }) => {
    try {
      if (!roomId || typeof roomId !== 'string') {
        socket.emit('room-error', 'Invalid room code');
        return;
      }

      const normalizedRoomId = roomId.toUpperCase();
      if (!rooms.has(normalizedRoomId)) {
        socket.emit('room-error', 'Room not found');
        return;
      }

      const room = rooms.get(normalizedRoomId);
      if (room.users.length >= 2) {
        socket.emit('room-error', 'Room is full');
        return;
      }

      const user = users.get(socket.id);
      if (!user) {
        socket.emit('room-error', 'User not found');
        return;
      }

      // Check if user is trying to join their own room
      if (room.users.includes(socket.id)) {
        socket.emit('room-error', 'Cannot join your own room');
        return;
      }

      if (user.state !== UserState.DISCONNECTED) {
        leaveCurrentRoom(socket);
      }

      const partnerId = room.users[0];
      room.users.push(socket.id);
      
      // Update both users' states
      user.state = UserState.IN_CHAT;
      user.roomId = normalizedRoomId;
      user.partnerId = partnerId;
      
      const partner = users.get(partnerId);
      if (partner) {
        partner.state = UserState.IN_CHAT;
        partner.partnerId = socket.id;
      }

      socket.roomId = normalizedRoomId;
      socket.join(normalizedRoomId);
      
      // Notify both users
      io.to(normalizedRoomId).emit('chat-start', { roomId: normalizedRoomId });
      socket.emit('initiator', true);

      console.log(`User ${socket.id} joined room ${normalizedRoomId}`);
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('room-error', 'Failed to join room');
    }
  });

  // Handle random chat matchmaking
  socket.on('find-random-partner', () => {
    const user = users.get(socket.id);
    if (user.state !== UserState.DISCONNECTED) {
      leaveCurrentRoom(socket);
    }
    
    if (waitingUsers.size > 0) {
      const partnerId = waitingUsers.values().next().value;
      waitingUsers.delete(partnerId);
      
      const roomId = generateRoomCode();
      rooms.set(roomId, { 
        users: [socket.id, partnerId],
        type: 'random'
      });
      
      // Update both users' states
      user.state = UserState.IN_CHAT;
      user.roomId = roomId;
      user.partnerId = partnerId;
      
      const partner = users.get(partnerId);
      partner.state = UserState.IN_CHAT;
      partner.roomId = roomId;
      partner.partnerId = socket.id;
      
      socket.roomId = roomId;
      const partnerSocket = io.sockets.sockets.get(partnerId);
      partnerSocket.roomId = roomId;
      
      socket.join(roomId);
      partnerSocket.join(roomId);
      
      io.to(roomId).emit('chat-start', { roomId });
      socket.emit('initiator', true);
    } else {
      user.state = UserState.WAITING;
      waitingUsers.add(socket.id);
      socket.emit('waiting');
    }
  });

  // Handle text messages
  socket.on('send-message', ({ roomId, message }) => {
    const user = users.get(socket.id);
    if (user.state === UserState.IN_CHAT && user.roomId === roomId) {
      try {
        // Only filter if message is a non-empty string
        const filteredMessage = typeof message === 'string' && message.trim() ? 
          filter.clean(message.trim()) : 
          '[invalid message]';
        
        // Emit the filtered message to the room
        socket.to(roomId).emit('receive-message', { 
          message: filteredMessage,
          timestamp: Date.now()
        });
      } catch (error) {
        console.error('Error processing message:', error);
        socket.emit('error', 'Failed to send message');
      }
    }
  });

  // Handle WebRTC signaling with better error handling
  socket.on('offer', ({ roomId, offer }) => {
    const user = users.get(socket.id);
    if (user?.state === UserState.IN_CHAT && user.roomId === roomId) {
      try {
        // Send offer to the other user in the room
        socket.to(roomId).emit('offer', { offer });
        console.log(`Offer sent in room ${roomId}`);
      } catch (error) {
        console.error('Error sending offer:', error);
        socket.emit('error', 'Failed to send offer');
      }
    }
  });

  socket.on('answer', ({ roomId, answer }) => {
    const user = users.get(socket.id);
    if (user?.state === UserState.IN_CHAT && user.roomId === roomId) {
      try {
        // Send answer to the other user in the room
        socket.to(roomId).emit('answer', { answer });
        console.log(`Answer sent in room ${roomId}`);
      } catch (error) {
        console.error('Error sending answer:', error);
        socket.emit('error', 'Failed to send answer');
      }
    }
  });

  socket.on('ice-candidate', ({ roomId, candidate }) => {
    const user = users.get(socket.id);
    if (user?.state === UserState.IN_CHAT && user.roomId === roomId) {
      try {
        // Send ICE candidate to the other user in the room
        socket.to(roomId).emit('ice-candidate', { candidate });
        console.log(`ICE candidate sent in room ${roomId}`);
      } catch (error) {
        console.error('Error sending ICE candidate:', error);
        socket.emit('error', 'Failed to send ICE candidate');
      }
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    userCount--;
    io.emit('user-count', userCount);
    
    console.log('User disconnected:', socket.id);
    const user = users.get(socket.id);
    
    if (user) {
      if (user.state === UserState.WAITING) {
        waitingUsers.delete(socket.id);
      } else if (user.state === UserState.IN_CHAT) {
        const room = rooms.get(user.roomId);
        if (room) {
          const partner = users.get(user.partnerId);
          if (partner) {
            partner.state = UserState.DISCONNECTED;
            partner.partnerId = null;
            io.to(partner.roomId).emit('partner-disconnected');
          }
          rooms.delete(user.roomId);
        }
      }
      users.delete(socket.id);
    }
  });

  socket.on('leave-room', () => {
    leaveCurrentRoom(socket);
  });
});

function leaveCurrentRoom(socket) {
  const user = users.get(socket.id);
  if (!user) return;

  if (user.state === UserState.WAITING) {
    waitingUsers.delete(socket.id);
  } else if (user.state === UserState.IN_CHAT) {
    const room = rooms.get(user.roomId);
    if (room) {
      const partner = users.get(user.partnerId);
      if (partner) {
        partner.state = UserState.DISCONNECTED;
        partner.partnerId = null;
        io.to(partner.roomId).emit('partner-disconnected');
      }
      rooms.delete(user.roomId);
    }
  }

  user.state = UserState.DISCONNECTED;
  user.roomId = null;
  user.partnerId = null;
  
  if (socket.roomId) {
    socket.leave(socket.roomId);
    socket.roomId = null;
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 