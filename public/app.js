const socket = io();
let peerConnection;
let localStream;
let currentRoomId;

// DOM Elements
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const startChatButton = document.getElementById('start-chat');
const nextChatButton = document.getElementById('next-chat');
const disconnectButton = document.getElementById('disconnect');
const cameraStatus = document.getElementById('camera-status');
const micStatus = document.getElementById('mic-status');
const autoConnectCheckbox = document.getElementById('auto-connect');

// Initialize controls
messageInput.disabled = true;
sendButton.disabled = true;

// Configuration for WebRTC
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Initialize buttons
startChatButton.addEventListener('click', startChat);
nextChatButton.addEventListener('click', nextChat);
disconnectButton.addEventListener('click', disconnect);
sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !messageInput.disabled) {
        sendMessage();
    }
});

// Socket.IO event handlers
socket.on('waiting', () => {
    showMessage('Waiting for a partner...');
});

socket.on('chat-start', ({ roomId }) => {
    currentRoomId = roomId;
    showMessage('Connected! Starting video chat...');
    setupWebRTC();
    startChatButton.disabled = true;
    nextChatButton.disabled = false;
    disconnectButton.disabled = false;
    messageInput.disabled = false;
    sendButton.disabled = false;
});

socket.on('initiator', (isInitiator) => {
    if (isInitiator) {
        createAndSendOffer();
    }
});

socket.on('partner-disconnected', () => {
    showMessage('Partner disconnected');
    cleanup();
    startChatButton.disabled = false;
    nextChatButton.disabled = true;
    disconnectButton.disabled = true;
    messageInput.disabled = true;
    sendButton.disabled = true;

    // Auto-connect if enabled
    if (autoConnectCheckbox.checked) {
        showMessage('Auto-connecting in 1 second...');
        autoConnectTimeout = setTimeout(() => {
            if (autoConnectCheckbox.checked) {
                socket.emit('find-random-partner');
            }
        }, 1000);
    }
});

socket.on('receive-message', ({ message, timestamp }) => {
    addMessage('Stranger', message);
});

// WebRTC event handlers
socket.on('offer', async ({ offer }) => {
    try {
        if (!peerConnection) {
            setupWebRTC();
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', { roomId: currentRoomId, answer });
    } catch (error) {
        console.error('Error handling offer:', error);
        showMessage('Failed to establish video connection');
    }
});

socket.on('answer', async ({ answer }) => {
    try {
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
    } catch (error) {
        console.error('Error handling answer:', error);
        showMessage('Failed to establish video connection');
    }
});

socket.on('ice-candidate', async ({ candidate }) => {
    try {
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
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
        
        socket.emit('find-random-partner');

    } catch (error) {
        handleMediaError(error);
    }
}

function setupWebRTC() {
    try {
        if (peerConnection) {
            peerConnection.close();
        }
        peerConnection = new RTCPeerConnection(configuration);

        // Add local stream to peer connection
        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }

        // Handle remote stream
        peerConnection.ontrack = (event) => {
            console.log('Received remote track:', event.track.kind);
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
            }
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', {
                    roomId: currentRoomId,
                    candidate: event.candidate
                });
            }
        };

        // Log connection state changes
        peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE Connection State:', peerConnection.iceConnectionState);
        };

        peerConnection.onconnectionstatechange = () => {
            console.log('Connection State:', peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') {
                showMessage('Video connection established!');
            }
        };

    } catch (error) {
        console.error('Error setting up WebRTC:', error);
        showMessage('Failed to setup video chat');
    }
}

async function createAndSendOffer() {
    try {
        if (!peerConnection) {
            setupWebRTC();
        }
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { roomId: currentRoomId, offer });
    } catch (error) {
        console.error('Error creating offer:', error);
        showMessage('Failed to create connection offer');
    }
}

function nextChat() {
    cleanup();
    socket.emit('find-random-partner');
    if (!autoConnectCheckbox.checked) {
        // Only show this message if not auto-connecting
        showMessage('Looking for a new partner...');
    }
}

function disconnect() {
    cleanup();
    startChatButton.disabled = false;
    nextChatButton.disabled = true;
    disconnectButton.disabled = true;
    messageInput.disabled = true;
    sendButton.disabled = true;
    showMessage('Disconnected from chat');
    
    // Clear any pending auto-connect
    if (autoConnectTimeout) {
        clearTimeout(autoConnectTimeout);
        autoConnectTimeout = null;
    }
}

function cleanup() {
    if (peerConnection) {
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onconnectionstatechange = null;
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
    messageInput.disabled = true;
    sendButton.disabled = true;

    // Clear any pending auto-connect
    if (autoConnectTimeout) {
        clearTimeout(autoConnectTimeout);
        autoConnectTimeout = null;
    }
}

function sendMessage() {
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
    console.log('Status message:', message);
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
        const messageElement = document.createElement('div');
        messageElement.className = 'status-message';
        messageElement.textContent = message;
        statusDiv.appendChild(messageElement);
        statusDiv.scrollTop = statusDiv.scrollHeight;
        
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

// Add after socket event handlers
let autoConnectTimeout;