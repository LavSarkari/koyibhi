const socket = io();
let peerConnection;
let localStream;
let currentRoomId;

// DOM Elements
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const startChatButton = document.getElementById('start-chat');
const nextChatButton = document.getElementById('next-chat');
const disconnectButton = document.getElementById('disconnect');
const cameraStatus = document.getElementById('camera-status');
const micStatus = document.getElementById('mic-status');

// Room code elements
const randomModeBtn = document.getElementById('random-mode');
const codeModeBtn = document.getElementById('code-mode');
const roomCodeContainer = document.getElementById('room-code-container');
const roomCodeInput = document.getElementById('room-code-input');
const joinRoomBtn = document.getElementById('join-room');
const createRoomBtn = document.getElementById('create-room');
const roomCodeDisplay = document.getElementById('room-code-display');
const roomCodeSpan = document.getElementById('room-code');
const copyCodeBtn = document.getElementById('copy-code');

// Configuration for WebRTC
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Chat mode handling
let isRandomMode = true;

randomModeBtn.addEventListener('click', () => {
    isRandomMode = true;
    randomModeBtn.classList.add('active');
    codeModeBtn.classList.remove('active');
    roomCodeContainer.classList.add('hidden');
    startChatButton.textContent = 'Start Random Chat';
    roomCodeDisplay.classList.add('hidden');
    roomCodeInput.value = '';
});

codeModeBtn.addEventListener('click', () => {
    isRandomMode = false;
    codeModeBtn.classList.add('active');
    randomModeBtn.classList.remove('active');
    roomCodeContainer.classList.remove('hidden');
    startChatButton.textContent = 'Start Room Chat';
});

// Room code handling
createRoomBtn.addEventListener('click', () => {
    if (!localStream) {
        showMessage('Please allow camera and microphone access first');
        return;
    }
    socket.emit('create-room');
});

joinRoomBtn.addEventListener('click', () => {
    if (!localStream) {
        showMessage('Please allow camera and microphone access first');
        return;
    }
    const code = roomCodeInput.value.trim().toUpperCase();
    if (code) {
        socket.emit('join-room', code);
    } else {
        showMessage('Please enter a room code');
    }
});

copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(roomCodeSpan.textContent)
        .then(() => {
            const originalText = copyCodeBtn.textContent;
            copyCodeBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyCodeBtn.textContent = originalText;
            }, 2000);
        });
});

socket.on('chat-start', ({ roomId }) => {
    currentRoomId = roomId;
    showMessage('Connected! Starting video chat...');
    setupWebRTC();
    startChatButton.disabled = true;
    nextChatButton.disabled = false;
    disconnectButton.disabled = false;
});

socket.on('initiator', (isInitiator) => {
    if (isInitiator) {
        createAndSendOffer();
    }
});

socket.on('room-created', (roomCode) => {
    roomCodeSpan.textContent = roomCode;
    roomCodeDisplay.classList.remove('hidden');
    showMessage('Room created! Share this code with your partner.');
});

socket.on('room-error', (error) => {
    showMessage(error);
    startChatButton.disabled = false;
    nextChatButton.disabled = true;
    disconnectButton.disabled = true;
});

socket.on('room-joined', ({ roomId, partnerId }) => {
    currentRoomId = roomId;
    showMessage('Connected to room! Starting video chat...');
    setupWebRTC();
});

socket.on('partner-joined', ({ roomId, partnerId }) => {
    currentRoomId = roomId;
    showMessage('Partner joined the room! Starting video chat...');
});

// Initialize buttons
startChatButton.addEventListener('click', startChat);
nextChatButton.addEventListener('click', nextChat);
disconnectButton.addEventListener('click', disconnect);
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// Socket.IO event handlers
socket.on('waiting', () => {
    showMessage('Waiting for a partner...');
});

socket.on('partner-found', ({ roomId, partnerId }) => {
    currentRoomId = roomId;
    showMessage('Partner found! Starting video chat...');
    setupWebRTC();
});

socket.on('partner-disconnected', () => {
    showMessage('Partner disconnected');
    cleanup();
});

socket.on('receive-message', ({ message, timestamp }) => {
    addMessage('Stranger', message);
});

// WebRTC event handlers
socket.on('offer', async (offer) => {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', { roomId: currentRoomId, answer });
    } catch (error) {
        console.error('Error handling offer:', error);
    }
});

socket.on('answer', async (answer) => {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
        console.error('Error handling answer:', error);
    }
});

socket.on('ice-candidate', async (candidate) => {
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
});

// Update status indicators
function updateDeviceStatus(type, isActive) {
    const element = type === 'camera' ? cameraStatus : micStatus;
    const icon = type === 'camera' ? '📷' : '🎤';
    const device = type === 'camera' ? 'Camera' : 'Mic';
    
    element.textContent = `${icon} ${device}: ${isActive ? 'Connected' : 'Not Connected'}`;
    element.className = `status ${isActive ? 'active' : ''}`;
}

async function startChat() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Your browser does not support video/audio capabilities');
        }

        showMessage('Requesting camera and microphone permissions...');
        updateDeviceStatus('camera', false);
        updateDeviceStatus('mic', false);

        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: true 
        }).catch(handleMediaError);

        updateDeviceStatus('camera', true);
        updateDeviceStatus('mic', true);
        localVideo.srcObject = localStream;
        
        if (isRandomMode) {
            socket.emit('find-random-partner');
        } else {
            showMessage('Please create a room or enter a room code to join');
            roomCodeContainer.classList.remove('hidden');
        }

    } catch (error) {
        handleMediaError(error);
    }
}

function setupWebRTC() {
    peerConnection = new RTCPeerConnection(configuration);

    // Add local stream to peer connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Handle remote stream
    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { roomId: currentRoomId, candidate: event.candidate });
        }
    };

    // Create and send offer if we're the initiator
    createAndSendOffer();
}

async function createAndSendOffer() {
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { roomId: currentRoomId, offer });
    } catch (error) {
        console.error('Error creating offer:', error);
        showMessage('Failed to create connection offer');
    }
}

function nextChat() {
    cleanup();
    if (isRandomMode) {
        socket.emit('find-random-partner');
    } else {
        showMessage('Please enter a new room code or create a new room');
        roomCodeInput.value = '';
        roomCodeDisplay.classList.add('hidden');
        startChatButton.disabled = false;
    }
}

function disconnect() {
    cleanup();
    startChatButton.disabled = false;
    nextChatButton.disabled = true;
    disconnectButton.disabled = true;
    showMessage('Disconnected from chat');
}

function cleanup() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
    }
    if (currentRoomId) {
        socket.emit('leave-room');
        currentRoomId = null;
    }
    roomCodeDisplay.classList.add('hidden');
    roomCodeInput.value = '';
}

function sendMessage() {
    const messageInput = document.getElementById('message-input');
    const message = messageInput.value.trim();
    
    if (!message) return;
    
    if (currentRoomId) {
        try {
            socket.emit('send-message', { 
                roomId: currentRoomId, 
                message: message 
            });
            addMessage('You', message);
            messageInput.value = '';
        } catch (error) {
            console.error('Error sending message:', error);
            showMessage('Failed to send message');
        }
    }
}

function addMessage(sender, text) {
    const messagesDiv = document.getElementById('messages');
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    
    const time = new Date().toLocaleTimeString();
    messageElement.innerHTML = `
        <span class="time">[${time}]</span>
        <span class="sender">${sender}:</span>
        <span class="text">${escapeHtml(text)}</span>
    `;
    
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showMessage(message) {
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
        const messageElement = document.createElement('div');
        messageElement.className = 'status-message';
        messageElement.textContent = message;
        statusDiv.appendChild(messageElement);
        statusDiv.scrollTop = statusDiv.scrollHeight;
        
        // Remove message after 5 seconds
        setTimeout(() => {
            messageElement.remove();
        }, 5000);
    }
}

// Update online user count
socket.on('user-count', (count) => {
    const onlineUsers = document.getElementById('online-users');
    if (onlineUsers) {
        onlineUsers.textContent = count;
    }
});

// Handle room code input formatting
roomCodeInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

// Show permissions help when needed
function showPermissionsHelp() {
    document.querySelector('.permissions-help').classList.remove('hidden');
}

// Handle media access errors
function handleMediaError(error) {
    console.error('Media access error:', error);
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        showPermissionsHelp();
    }
    showMessage(error.message || 'Error accessing camera and microphone');
    startChatButton.disabled = false;
    nextChatButton.disabled = true;
    disconnectButton.disabled = true;
    updateDeviceStatus('camera', false);
    updateDeviceStatus('mic', false);
}

// Add error handling for socket events
socket.on('error', (errorMessage) => {
    console.error('Socket error:', errorMessage);
    showMessage(`Error: ${errorMessage}`);
});

// Helper function to escape HTML and prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Update error handling for media access
async function setupMedia() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Your browser does not support video chat');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: true
        });

        document.getElementById('local-video').srcObject = stream;
        return stream;
    } catch (error) {
        let errorMessage = 'Failed to access camera/microphone';
        
        if (error.name === 'NotAllowedError') {
            errorMessage = 'Please allow camera and microphone access';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'Camera or microphone not found';
        } else if (error.name === 'NotReadableError') {
            errorMessage = 'Camera or microphone is already in use';
        }
        
        showMessage(errorMessage);
        throw error;
    }
} 