document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const startScreen = document.getElementById('start-screen');
    const waitingScreen = document.getElementById('waiting-screen');
    const chatScreen = document.getElementById('chat-screen');
    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    const muteBtn = document.getElementById('mute-btn');
    const videoBtn = document.getElementById('video-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const chatMessages = document.getElementById('chat-messages');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const startBtn = document.getElementById('start-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    let localStream;
    let peerConnection;
    let isMuted = false;
    let isVideoOff = false;

    // WebRTC Configuration (STUN Servers)
    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]
    };

    // Get User Media (Ensure it's called properly)
    async function getUserMediaStream() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            console.log("✅ Local stream initialized.");
        } catch (err) {
            alert("Error accessing camera/microphone: " + err.message);
            console.error("❌ getUserMedia error:", err);
        }
    }

    // Start Chat Button
    startBtn.addEventListener('click', async () => {
        const interests = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
            .map(checkbox => checkbox.value);

        if (interests.length === 0) {
            alert("Please select at least one interest!");
            return;
        }

        await getUserMediaStream(); // ✅ Ensure media is available before starting

        // Emit 'start-chat' to server
        socket.emit('start-chat', { interests });
        startScreen.classList.add('hidden');
        waitingScreen.classList.remove('hidden');
    });

    // Cancel Button
    cancelBtn.addEventListener('click', () => {
        stopLocalStream();
        socket.emit('disconnect-me');
        waitingScreen.classList.add('hidden');
        startScreen.classList.remove('hidden');
    });

    // Disconnect Button
    disconnectBtn.addEventListener('click', () => {
        stopLocalStream();
        if (peerConnection) peerConnection.close();
        socket.emit('disconnect-me');
        chatScreen.classList.add('hidden');
        startScreen.classList.remove('hidden');
    });

    // Mute/Unmute
    muteBtn.addEventListener('click', () => {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => track.enabled = !track.enabled);
            isMuted = !isMuted;
            muteBtn.textContent = isMuted ? "Unmute" : "Mute";
        }
    });

    // Toggle Video
    videoBtn.addEventListener('click', () => {
        if (localStream) {
            localStream.getVideoTracks().forEach(track => track.enabled = !track.enabled);
            isVideoOff = !isVideoOff;
            videoBtn.textContent = isVideoOff ? "Start Video" : "Stop Video";
        }
    });

    // Send Message
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    function sendMessage() {
        const message = messageInput.value.trim();
        if (message) {
            socket.emit('send-message', message);
            addMessage("You", message);
            messageInput.value = "";
        }
    }

    function addMessage(sender, message) {
        const msgElement = document.createElement('div');
        msgElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
        chatMessages.appendChild(msgElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function stopLocalStream() {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localVideo.srcObject = null;
        }
    }

    // WebRTC Peer Connection
    async function createPeerConnection() {
        peerConnection = new RTCPeerConnection(rtcConfig);

        // Add local stream tracks
        if (localStream) {
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        }

        // ICE Candidate Handling
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('signal', { type: 'candidate', candidate: event.candidate });
            }
        };

        // Remote Stream Handling
        peerConnection.ontrack = (event) => {
            console.log("🎥 Received remote stream", event.streams[0]);
            remoteVideo.srcObject = event.streams[0];  // ✅ Show stranger's video
        };

        // Error Handling
        peerConnection.oniceconnectionstatechange = () => {
            console.log("ICE Connection State:", peerConnection.iceConnectionState);
        };

        return peerConnection;
    }

    // Socket Events
    socket.on('matched', async () => {
        waitingScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');
        
        await getUserMediaStream(); // ✅ Ensure media is available
        await createPeerConnection();

        // Create Offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('signal', { type: 'offer', offer, senderId: socket.id });

    });

    socket.on('signal', async (data) => {
        if (!peerConnection) await createPeerConnection();
    
        try {
            if (data.type === 'offer') {
                console.log("📡 Received Offer");
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
    
                socket.emit('signal', {
                    type: 'answer',
                    answer,
                    senderId: socket.id
                });
            }
    
            else if (data.type === 'answer') {
                console.log("📡 Received Answer");
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
    
            else if (data.type === 'candidate') {
                console.log("📡 Received ICE Candidate");
                if (data.candidate) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
            }
    
        } catch (err) {
            console.error("❌ WebRTC Error:", err);
        }
    });

    socket.on('receive-message', (message) => {
        addMessage("Stranger", message);
    });

    socket.on('partner-disconnected', () => {
        console.log("⚠️ Partner Disconnected");
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
        }
        if (peerConnection) peerConnection.close();
        chatMessages.innerHTML += '<div>Partner disconnected. Reconnecting...</div>';
        setTimeout(() => {
            chatScreen.classList.add('hidden');
            startScreen.classList.remove('hidden');
        }, 3000);
    });
});
