// server.js
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

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('joinRoom', (data) => {
    const { roomId, username, isHost } = data;
    
    // Join the room
    socket.join(roomId);
    
    // Store user data
    if (!rooms[roomId]) {
      rooms[roomId] = {
        host: isHost ? socket.id : null,
        users: {}
      };
    }
    
    rooms[roomId].users[socket.id] = {
      username,
      isHost
    };
    
    // If joining as host, update host id
    if (isHost) {
      rooms[roomId].host = socket.id;
    }
    
    // Broadcast to room that user joined
    socket.to(roomId).emit('userJoined', {
      username,
      isHost
    });
    
    console.log(`${username} joined room ${roomId}`);
  });
  
  socket.on('chatMessage', (data) => {
    const { roomId, username, message } = data;
    
    // Broadcast message to all users in room except sender
    socket.to(roomId).emit('chatMessage', {
      username,
      message
    });
  });
  
  socket.on('videoControl', (data) => {
    const { roomId, currentTime, isPlaying } = data;
    
    // Check if user is host (only host can control video)
    const room = rooms[roomId];
    if (room && room.host === socket.id) {
      // Broadcast video control to all clients except sender
      socket.to(roomId).emit('videoControl', {
        currentTime,
        isPlaying
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Find which room the user was in
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.users[socket.id]) {
        const username = room.users[socket.id].username;
        
        // Notify others that user left
        socket.to(roomId).emit('userLeft', {
          username
        });
        
        // Delete user from room
        delete room.users[socket.id];
        
        // If user was host, assign new host or delete room if empty
        if (room.host === socket.id) {
          const remainingUsers = Object.keys(room.users);
          if (remainingUsers.length > 0) {
            // Assign first remaining user as host
            room.host = remainingUsers[0];
            room.users[room.host].isHost = true;
            
            // Notify new host
            io.to(room.host).emit('becomeHost');
          } else {
            // Delete empty room
            delete rooms[roomId];
          }
        }
        
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});