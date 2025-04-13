const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const Filter = require('bad-words');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
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
    const user = users.get(socket.id);
    if (user.state !== UserState.DISCONNECTED) {
      leaveCurrentRoom(socket);
    }

    const roomId = generateRoomCode();
    rooms.set(roomId, { 
      users: [socket.id],
      type: 'code'
    });

    user.state = UserState.WAITING;
    user.roomId = roomId;
    socket.roomId = roomId;
    socket.join(roomId);
    socket.emit('room-created', roomId);
  });

  // Handle joining a room with code
  socket.on('join-room', (roomId) => {
    if (!rooms.has(roomId)) {
      socket.emit('room-error', 'Room not found');
      return;
    }

    const room = rooms.get(roomId);
    if (room.users.length >= 2) {
      socket.emit('room-error', 'Room is full');
      return;
    }

    const user = users.get(socket.id);
    if (user.state !== UserState.DISCONNECTED) {
      leaveCurrentRoom(socket);
    }

    const partnerId = room.users[0];
    room.users.push(socket.id);
    
    // Update both users' states
    user.state = UserState.IN_CHAT;
    user.roomId = roomId;
    user.partnerId = partnerId;
    
    const partner = users.get(partnerId);
    partner.state = UserState.IN_CHAT;
    partner.partnerId = socket.id;

    socket.roomId = roomId;
    socket.join(roomId);
    
    io.to(roomId).emit('chat-start', { roomId });
    socket.emit('initiator', true);
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
        socket.to(roomId).emit('offer', { offer });
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
        socket.to(roomId).emit('answer', { answer });
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
        socket.to(roomId).emit('ice-candidate', { candidate });
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