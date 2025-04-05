const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users
let users = [];

io.on('connection', (socket) => {
    console.log(`🟢 User ${socket.id} connected`);

    // When user starts looking for a match
    socket.on('start-chat', (userData) => {
        socket.userData = userData;
        users.push(socket);
        findMatch(socket);
    });
    
    // WebRTC Signaling
    socket.on('signal', (data) => {
        console.log(`📡 Received ${data.type} signal from ${socket.id}`);

        if (!socket.partner) {
            console.warn(`⚠️ No partner for ${socket.id}. Ignoring signal.`);
            return;
        }

        // Forward signal to partner
        socket.partner.emit('signal', {
            type: data.type,
            senderId: socket.id,
            ...(data.offer && { offer: data.offer }),
            ...(data.answer && { answer: data.answer }),
            ...(data.candidate && { candidate: data.candidate })
        });
    });

    // Text Chat Messaging
    socket.on('send-message', (message) => {
        if (socket.partner) {
            socket.partner.emit('receive-message', message);
        }
    });

    // Manually disconnect user
    socket.on('disconnect-me', () => {
        disconnectUser(socket);
    });

    // Handle actual disconnection
    socket.on('disconnect', () => {
        disconnectUser(socket);
    });
});

// Match users based on interests
function findMatch(socket) {
    if (!users.includes(socket)) return; // Ensure the user is still online

    const match = users.find(user => 
        user !== socket && 
        !user.partner && 
        user.userData.interests.some(interest => socket.userData.interests.includes(interest))
    );

    if (match) {
        console.log(`✅ Match found between ${socket.id} and ${match.id}`);
        socket.partner = match;
        match.partner = socket;
        socket.emit('matched');
        match.emit('matched');
    } else {
        console.log(`⏳ No match for ${socket.id}, retrying in 5 seconds...`);

        // Ensure we don't create infinite retries
        setTimeout(() => {
            if (!socket.partner && users.includes(socket)) {
                findMatch(socket);
            }
        }, 5000);
    }
}

// Clean up disconnected users
function disconnectUser(socket) {
    if (!socket) return; // Safety check

    console.log(`❌ User ${socket.id} disconnected.`);

    if (socket.partner) {
        console.log(`🔗 Notifying partner ${socket.partner.id} about disconnection.`);
        socket.partner.emit('partner-disconnected');
        socket.partner.partner = null;
    }

    // Remove user from the list
    users = users.filter(user => user !== socket);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
