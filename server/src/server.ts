import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:5174"],
    methods: ["GET", "POST"]
  }
});

const totalRooms: { [key: string]: { users: string[] } } = {};

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('join', (data: { room: string }) => {
    if (!data?.room) return;

    socket.join(data.room);

    if (!totalRooms[data.room]) totalRooms[data.room] = { users: [] };
    totalRooms[data.room].users.push(socket.id);
    (socket as any).room = data.room;

    console.log(`Socket ${socket.id} joined room ${data.room}`);
  });

  socket.on('offer', (data: { sdp: string; room: string }) => {
    socket.to(data.room).emit('offer', { sdp: data.sdp, sender: socket.id });
  });

  socket.on('answer', (data: { sdp: string; room: string }) => {
    socket.to(data.room).emit('answer', { sdp: data.sdp, sender: socket.id });
  });

  socket.on('candidate', (data: { candidate: string; room: string }) => {
    socket.to(data.room).emit('candidate', { candidate: data.candidate, sender: socket.id });
  });

  socket.on('disconnect', () => {
    const room = (socket as any).room;
    if (room && totalRooms[room]) {
      totalRooms[room].users = totalRooms[room].users.filter((id) => id !== socket.id);
      if (totalRooms[room].users.length === 0) delete totalRooms[room];
    }
    console.log(`Client disconnected: ${socket.id}`);
  });
});

server.listen(5000, "0.0.0.0"
  , () => {
  console.log('Server listening on port 5000');
});
