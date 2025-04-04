const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Store active rooms
const rooms = {};

app.get('/', (req, res) => {
  res.send('Watch Together server is running');
});

// Add a health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    activeRooms: Object.keys(rooms).length
  });
});

// Debug endpoint to view active rooms
app.get('/rooms', (req, res) => {
  const roomsInfo = {};
  
  for (const roomId in rooms) {
    roomsInfo[roomId] = {
      hostId: rooms[roomId].host,
      userCount: Object.keys(rooms[roomId].users).length,
      usernames: Object.values(rooms[roomId].users).map(u => u.username)
    };
  }
  
  res.json(roomsInfo);
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Handle joining a room
  socket.on('joinRoom', (data) => {
    const { roomId, username, isHost } = data;
    console.log(`${username} (${socket.id}) is joining room ${roomId} as ${isHost ? 'host' : 'guest'}`);
    
    // Join the socket to the room
    socket.join(roomId);
    
    // Initialize room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        host: isHost ? socket.id : null,
        users: {}
      };
    }
    
    // Store user data
    rooms[roomId].users[socket.id] = {
      username,
      isHost
    };
    
    // If joining as host, update host id
    if (isHost) {
      rooms[roomId].host = socket.id;
    }
    
    // Notify everyone in the room that a new user joined
    // Important: this must use "to" not "in" to broadcast to all clients including the sender
    io.to(roomId).emit('userJoined', {
      username,
      isHost
    });
    
    console.log(`${username} joined room ${roomId}`);
    console.log(`Room ${roomId} now has ${Object.keys(rooms[roomId].users).length} users`);
  });
  
  // Handle chat messages
  socket.on('chatMessage', (data) => {
    const { roomId, username, message } = data;
    console.log(`Chat message in room ${roomId} from ${username}: ${message}`);
    
    // Broadcast message to all OTHER users in room
    socket.to(roomId).emit('chatMessage', {
      username,
      message
    });
  });
  
  // Handle video control events
  socket.on('videoControl', (data) => {
    const { roomId, currentTime, isPlaying } = data;
    
    // Check if room exists
    if (!rooms[roomId]) {
      console.log(`Room ${roomId} not found for video control`);
      return;
    }
    
    // Check if user is host (only host can control video)
    if (rooms[roomId].host === socket.id) {
      console.log(`Host (${socket.id}) sending video control: time=${currentTime}, playing=${isPlaying}`);
      
      // Forward control to everyone else in room
      socket.to(roomId).emit('videoControl', {
        currentTime,
        isPlaying
      });
    } else {
      console.log(`Non-host user (${socket.id}) attempted video control`);
    }
  });

  // Handle disconnections
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Find which room this user was in
    let userRoom = null;
    let wasHost = false;
    
    for (const roomId in rooms) {
      if (rooms[roomId].users[socket.id]) {
        userRoom = roomId;
        wasHost = rooms[roomId].host === socket.id;
        
        // Store username before removing user
        const username = rooms[roomId].users[socket.id].username;
        
        // Remove user from room
        delete rooms[roomId].users[socket.id];
        
        // Notify room that user left
        socket.to(roomId).emit('userLeft', {
          username
        });
        
        console.log(`${username} left room ${roomId}`);
        
        // If room is empty, delete it
        if (Object.keys(rooms[roomId].users).length === 0) {
          console.log(`Deleting empty room ${roomId}`);
          delete rooms[roomId];
        } 
        // If user was host, assign a new host
        else if (wasHost) {
          // Pick first remaining user as new host
          const newHostId = Object.keys(rooms[roomId].users)[0];
          rooms[roomId].host = newHostId;
          rooms[roomId].users[newHostId].isHost = true;
          
          // Notify new host
          io.to(newHostId).emit('becomeHost');
          
          console.log(`New host for room ${roomId}: ${newHostId}`);
        }
        
        break;
      }
    }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
