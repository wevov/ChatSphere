const socket = io();
const interestForm = document.getElementById('interestForm');
const chatArea = document.getElementById('chatArea');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const newMatchBtn = document.getElementById('newMatchBtn');
const partnerInfo = document.getElementById('partnerInfo');
const countryFlag = document.getElementById('countryFlag');
const countryName = document.getElementById('countryName');
const onlineCount = document.getElementById('onlineCount');
const attachmentBtn = document.getElementById('attachmentBtn');
const fileInput = document.getElementById('fileInput');

// Video control elements
const localAudioToggle = document.getElementById('localAudioToggle');
const localVideoToggle = document.getElementById('localVideoToggle');
const remoteAudioToggle = document.getElementById('remoteAudioToggle');

let localStream;
let peerConnection;
let userLocation = { country: 'Unknown', countryCode: 'UN' };
let isInitiator = false;
let connectionAttempts = 0;
let iceConnectionTimer;
let connectionTimeout;
let iceCandidatesQueue = [];
let isRemoteDescSet = false;
let currentConfigIndex = 0;
let connectionStartTime;
let connectionProgressInterval;
let partnerId = null;

// Video control state variables
let isLocalAudioMuted = false;
let isLocalVideoOff = false;
let isRemoteAudioMuted = false;

// TURN configurations
const turnConfigurations = [
    {
        iceServers: [
            { urls: "stun:stun.relay.metered.ca:80" }, // Same STUN can be reused
            {
                urls: "turn:global.relay.metered.ca:80",
                username: "51ce19f71e425b82d584c3f9", // Replace with new credentials
                credential: "y3y8M7SKbRnt67UR"
            },
            {
                urls: "turn:global.relay.metered.ca:80?transport=tcp",
                username: "51ce19f71e425b82d584c3f9",
                credential: "y3y8M7SKbRnt67UR"
            },
            {
                urls: "turn:global.relay.metered.ca:443",
                username: "51ce19f71e425b82d584c3f9",
                credential: "y3y8M7SKbRnt67UR"
            },
            {
                urls: "turns:global.relay.metered.ca:443?transport=tcp",
                username: "51ce19f71e425b82d584c3f9",
                credential: "y3y8M7SKbRnt67UR"
            }
        ]
    },
    {
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" },
            { urls: "stun:stun3.l.google.com:19302" },
            { urls: "stun:stun4.l.google.com:19302" }
        ]
    },
    {
        iceServers: [
            { urls: "stun:stun.services.mozilla.com" },
            { urls: "stun:stun.xten.com" }
        ]
    }
];

// Function to get user location from their IP
async function getUserLocation() {
    try {
        const services = [
            'https://ipapi.co/json/',
            'https://ipinfo.io/json',
            'https://api.ipify.org?format=json'
        ];

        for (const service of services) {
            try {
                const response = await fetch(service);
                const data = await response.json();

                if (service.includes('ipapi.co')) {
                    return {
                        country: data.country_name || 'Unknown',
                        countryCode: data.country_code || 'UN'
                    };
                } else if (service.includes('ipinfo.io')) {
                    return {
                        country: data.country || 'Unknown',
                        countryCode: data.country || 'UN'
                    };
                } else if (service.includes('ipify.org')) {
                    const locationResponse = await fetch(`http://ip-api.com/json/${data.ip}`);
                    const locationData = await locationResponse.json();

                    if (locationData.status === 'success') {
                        return {
                            country: locationData.country || 'Unknown',
                            countryCode: locationData.countryCode || 'UN'
                        };
                    }
                }
            } catch (error) {
                console.warn(`Failed to get location from ${service}:`, error);
                continue;
            }
        }

        return { country: 'Unknown', countryCode: 'UN' };
    } catch (error) {
        console.error('Error getting user location:', error);
        return { country: 'Unknown', countryCode: 'UN' };
    }
}

// Initialize user location when the page loads
window.addEventListener('load', async () => {
    userLocation = await getUserLocation();
    console.log('User location detected:', userLocation);
});

// NEW: Listen for online count updates from server
socket.on('onlineCount', (count) => {
    onlineCount.textContent = `Online: ${count}`;
});

interestForm.addEventListener('submit', async e => {
    e.preventDefault();

    const interests = Array.from(document.querySelectorAll('input[name="interest"]:checked')).map(
        cb => cb.value
    );

    if (interests.length === 0) {
        alert('Please select at least one interest');
        return;
    }

    interestForm.style.display = 'none';
    chatArea.style.display = 'block';

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: true
        });
        localVideo.srcObject = localStream;

        localVideo.play().catch(e => console.error('Error playing local video:', e));
    } catch (err) {
        alert('Could not get media: ' + err.message);
        return;
    }

    socket.emit('setInterests', { interests, location: userLocation });
});

// Partner matching handlers
socket.on('partner', (data) => {
    partnerId = data.id;

    partnerInfo.style.display = 'block';
    countryFlag.src = `https://flagcdn.com/32x24/${data.countryCode.toLowerCase()}.png`;
    countryName.textContent = data.country;

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    chatBox.innerHTML = '';
    appendMessage(`Connected with a stranger from ${data.country}!`, 'system-message');
    appendMessage('Establishing video connection...', 'system-message');

    connectionAttempts = 0;
    currentConfigIndex = 0;
    iceCandidatesQueue = [];
    isRemoteDescSet = false;
    stopConnectionProgress();
    resetVideoControls();

    chatBox.innerHTML = '';

    if (socket.id.localeCompare(partnerId) < 0) {
        isInitiator = true;
        initiateCall(0);
    } else {
        isInitiator = false;
        createPeerConnection(0);
    }
});

socket.on('partner-left', () => {
    appendMessage('Stranger has disconnected.', 'system-message');
    remoteVideo.srcObject = null;
    partnerInfo.style.display = 'none';
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    resetVideoControls();
});

socket.on('searching', () => {
    appendMessage('Searching for someone with similar interests...', 'system-message');
});

// Video control event listeners
localAudioToggle.addEventListener('click', toggleLocalAudio);
localVideoToggle.addEventListener('click', toggleLocalVideo);
remoteAudioToggle.addEventListener('click', toggleRemoteAudio);

newMatchBtn.addEventListener('click', () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    chatBox.innerHTML = '';
    partnerInfo.style.display = 'none';
    connectionAttempts = 0;
    currentConfigIndex = 0;
    iceCandidatesQueue = [];
    isRemoteDescSet = false;
    
    resetVideoControls();

    if (iceConnectionTimer) clearTimeout(iceConnectionTimer);
    if (connectionTimeout) clearTimeout(connectionTimeout);
    if (connectionProgressInterval) clearInterval(connectionProgressInterval);

    appendMessage('Searching for a new match...', 'system-message');

    socket.emit('newMatch');
});

function startConnectionProgress() {
    connectionStartTime = Date.now();

    connectionProgressInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - connectionStartTime) / 1000);

        if (elapsed < 10) {
            // Silent
        } else if (elapsed < 20) {
            // Silent
        } else if (elapsed < 30) {
            // Silent
        }
    }, 10000);
}

function stopConnectionProgress() {
    if (connectionProgressInterval) {
        clearInterval(connectionProgressInterval);
        connectionProgressInterval = null;
    }
}

function createPeerConnection(configIndex = 0) {
    console.log(`Creating peer connection with config ${configIndex}`);
    currentConfigIndex = configIndex;

    if (peerConnection) {
        peerConnection.close();
    }

    const config = turnConfigurations[configIndex] || turnConfigurations[0];

    peerConnection = new RTCPeerConnection(config);

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log('Added local track:', track.kind);
        });
    }

    peerConnection.onicecandidate = event => {
        socket.emit('signal', {
            type: 'ice-candidate',
            candidate: event.candidate || null
        });
        if (event.candidate) {
            console.log('Sent ICE candidate:', event.candidate);
        } else {
            console.log('All ICE candidates have been sent');
        }
    };

    peerConnection.ontrack = event => {
        console.log('Received remote track:', event.streams[0]);
        if (event.streams[0] && event.streams[0].getTracks().length > 0) {
            remoteVideo.srcObject = event.streams[0];

            remoteVideo.play().catch(e => console.error('Error playing remote video:', e));
            
            appendMessage('Video connected!', 'system-message');
            stopConnectionProgress();
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        console.log('ICE connection state:', state);

        if (iceConnectionTimer) clearTimeout(iceConnectionTimer);

        if (state === 'connected' || state === 'completed') {
            appendMessage('Connection established successfully!', 'system-message');
            stopConnectionProgress();
        } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
            appendMessage('Connection failed. This might be due to network restrictions.', 'system-message');
            stopConnectionProgress();

            if (connectionAttempts < turnConfigurations.length - 1) {
                connectionAttempts++;
                console.log(`Connection failed with config ${configIndex}, trying config ${connectionAttempts}`);
                appendMessage('Connection issue, retrying with different configuration...', 'system-message');

                if (isInitiator) {
                    setTimeout(() => initiateCall(connectionAttempts), 1000);
                }
            } else {
                appendMessage('All connection attempts failed. Please check your network or try again later.', 'system-message');
            }
        } else if (state === 'checking') {
            iceConnectionTimer = setTimeout(() => {
                if (peerConnection && peerConnection.iceConnectionState === 'checking') {
                    console.log('ICE connection stuck in checking state, trying next configuration');

                    if (connectionAttempts < turnConfigurations.length - 1) {
                        connectionAttempts++;
                        if (isInitiator) {
                            initiateCall(connectionAttempts);
                        }
                    } else {
                        appendMessage('Unable to establish connection. Please try again later.', 'system-message');
                        stopConnectionProgress();
                    }
                }
            }, 20000);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed') {
            appendMessage('Connection failed. Click "New Match" to try again.', 'system-message');
            stopConnectionProgress();
        }
    };
}

async function initiateCall(configIndex = 0) {
    console.log(`Initiating call with config ${configIndex}`);
    isInitiator = true;
    createPeerConnection(configIndex);

    startConnectionProgress();

    connectionTimeout = setTimeout(() => {
        if (peerConnection && peerConnection.iceConnectionState !== 'connected' &&
            peerConnection.iceConnectionState !== 'completed') {
            appendMessage('Connection taking too long. This might be due to network restrictions.', 'system-message');

            if (connectionAttempts < turnConfigurations.length - 1) {
                connectionAttempts++;
                initiateCall(connectionAttempts);
            } else {
                stopConnectionProgress();
            }
        }
    }, 45000);

    try {
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });

        await peerConnection.setLocalDescription(offer);
        console.log('Created and set local offer');

        socket.emit('signal', {
            type: 'offer',
            sdp: peerConnection.localDescription
        });
        console.log('Sent offer');
    } catch (err) {
        console.error('Error in initiateCall:', err);
    }
}

// Robust signal handler
socket.on('signal', async (data) => {
    if (!peerConnection) return;

    try {
        if (data.type === 'offer') {
            console.log('Received offer');
            if (isInitiator) return;

            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            isRemoteDescSet = true;

            while (iceCandidatesQueue.length) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidatesQueue.shift()));
            }

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('signal', {
                type: 'answer',
                sdp: peerConnection.localDescription
            });
            console.log('Sent answer');

        } else if (data.type === 'answer') {
            console.log('Received answer');
            if (!isInitiator) return;

            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            isRemoteDescSet = true;

            while (iceCandidatesQueue.length) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidatesQueue.shift()));
            }

        } else if (data.type === 'ice-candidate') {
            if (data.candidate) {
                if (isRemoteDescSet) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                } else {
                    iceCandidatesQueue.push(data.candidate);
                }
            }
        } else if (data.type === 'audio-state' || data.type === 'video-state') {
            handlePartnerStateChange(data);
        }
    } catch (err) {
        console.error('Signal handling error:', err);
    }
});

// Binary file transfer
attachmentBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    if (file.size > 80 * 1024 * 1024) {
        if (!confirm('File is very large (>80MB) and may take time to send. Continue?')) {
            fileInput.value = '';
            return;
        }
    }

    const reader = new FileReader();
    reader.onload = () => {
        const messageData = {
            file: {
                name: file.name,
                type: file.type,
                size: file.size,
                data: reader.result
            }
        };

        socket.emit('chatMessage', messageData);

        appendFileMessage(messageData.file, 'user-message');

        fileInput.value = '';
    };
    reader.readAsArrayBuffer(file);
});

// Receive files and text messages
socket.on('chatMessage', (data) => {
    if (data.file) {
        const blob = new Blob([data.file.data], { type: data.file.type });
        const url = URL.createObjectURL(blob);
        const fileInfo = { ...data.file, url };

        appendFileMessage(fileInfo, 'stranger-message');
    } else if (data.text) {
        appendMessage(data.text, 'stranger-message');
    }
});

function appendMessage(text, type = 'system-message') {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', type);
    messageDiv.textContent = text;
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function appendFileMessage(fileInfo, type) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', type, 'file-attachment');

    if (fileInfo.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = fileInfo.url;
        img.style.maxWidth = '200px';
        img.style.cursor = 'pointer';
        img.onclick = () => viewImageFullscreen(fileInfo.url, fileInfo.name);
        messageDiv.appendChild(img);
    } else if (fileInfo.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = fileInfo.url;
        video.controls = true;
        video.style.maxWidth = '300px';
        video.style.cursor = 'pointer';
        video.onclick = () => viewVideoFullscreen(fileInfo.url, fileInfo.name);
        messageDiv.appendChild(video);
    } else if (fileInfo.type === 'application/pdf') {
        const link = document.createElement('a');
        link.href = fileInfo.url;
        link.textContent = `📄 ${fileInfo.name}`;
        link.onclick = (e) => {
            e.preventDefault();
            viewPdfFullscreen(fileInfo.url, fileInfo.name);
        };
        messageDiv.appendChild(link);
    } else {
        const link = document.createElement('a');
        link.href = fileInfo.url;
        link.download = fileInfo.name;
        link.textContent = `📎 ${fileInfo.name} (${(fileInfo.size / 1024 / 1024).toFixed(2)} MB)`;
        messageDiv.appendChild(link);
    }

    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// Fullscreen viewer functions (your original code - unchanged)
function viewImageFullscreen(imageSrc, imageName) {
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.display = 'block';
    modal.style.backgroundColor = 'rgba(0,0,0,0.9)';
    modal.tabIndex = '-1';

    const modalDialog = document.createElement('div');
    modalDialog.className = 'modal-dialog modal-dialog-centered modal-xl';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content bg-transparent border-0';

    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header border-0';

    const modalTitle = document.createElement('h5');
    modalTitle.className = 'modal-title text-white';
    modalTitle.textContent = imageName;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn-close btn-close-white';
    closeButton.onclick = () => document.body.removeChild(modal);

    modalHeader.appendChild(modalTitle);
    modalHeader.appendChild(closeButton);

    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body p-0 text-center position-relative';

    const fullscreenImage = document.createElement('img');
    fullscreenImage.src = imageSrc;
    fullscreenImage.className = 'img-fluid';
    fullscreenImage.style.maxHeight = '90vh';
    fullscreenImage.style.cursor = 'zoom-in';

    let zoomLevel = 1;
    fullscreenImage.onclick = () => {
        zoomLevel = zoomLevel === 1 ? 2 : 1;
        fullscreenImage.style.transform = `scale(${zoomLevel})`;
        fullscreenImage.style.cursor = zoomLevel === 1 ? 'zoom-in' : 'zoom-out';
        fullscreenImage.style.transition = 'transform 0.3s';
        zoomBtn.innerHTML = zoomLevel === 1 ? '<i class="bi bi-zoom-in"></i>' : '<i class="bi bi-zoom-out"></i>';
    };

    modalBody.appendChild(fullscreenImage);

    const zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'btn btn-light position-absolute';
    zoomBtn.style.top = '10px';
    zoomBtn.style.right = '10px';
    zoomBtn.innerHTML = '<i class="bi bi-zoom-in"></i>';
    zoomBtn.title = 'Zoom in/out';
    zoomBtn.onclick = () => fullscreenImage.click();
    modalBody.appendChild(zoomBtn);

    const modalFooter = document.createElement('div');
    modalFooter.className = 'modal-footer border-0 justify-content-center';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'btn btn-primary d-inline-flex align-items-center gap-2';
    downloadBtn.innerHTML = '<i class="bi bi-download"></i>Download';
    downloadBtn.onclick = () => downloadImage(imageSrc, imageName);

    modalFooter.appendChild(downloadBtn);

    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modalContent.appendChild(modalFooter);
    modalDialog.appendChild(modalContent);
    modal.appendChild(modalDialog);

    document.body.appendChild(modal);

    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            document.body.removeChild(modal);
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);

    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
            document.removeEventListener('keydown', handleEscape);
        }
    };
}

function viewPdfFullscreen(pdfUrl, pdfName) {
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.display = 'block';
    modal.style.backgroundColor = 'rgba(0,0,0,0.9)';
    modal.tabIndex = '-1';

    const modalDialog = document.createElement('div');
    modalDialog.className = 'modal-dialog modal-dialog-centered modal-xl';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content bg-transparent border-0';

    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header border-0';

    const modalTitle = document.createElement('h5');
    modalTitle.className = 'modal-title text-white';
    modalTitle.textContent = pdfName;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn-close btn-close-white';
    closeButton.onclick = () => document.body.removeChild(modal);

    modalHeader.appendChild(modalTitle);
    modalHeader.appendChild(closeButton);

    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body p-0';
    modalBody.style.height = '80vh';

    const fullscreenPdf = document.createElement('iframe');
    fullscreenPdf.src = pdfUrl;
    fullscreenPdf.className = 'w-100 h-100';
    fullscreenPdf.style.border = 'none';

    modalBody.appendChild(fullscreenPdf);

    const modalFooter = document.createElement('div');
    modalFooter.className = 'modal-footer border-0 justify-content-center';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'btn btn-primary d-inline-flex align-items-center gap-2';
    downloadBtn.innerHTML = '<i class="bi bi-download"></i>Download';
    downloadBtn.onclick = () => {
        const link = document.createElement('a');
        link.href = pdfUrl;
        link.download = pdfName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const openNewTabBtn = document.createElement('button');
    openNewTabBtn.type = 'button';
    openNewTabBtn.className = 'btn btn-secondary d-inline-flex align-items-center gap-2';
    openNewTabBtn.innerHTML = '<i class="bi bi-box-arrow-up-right"></i>Open in New Tab';
    openNewTabBtn.onclick = () => window.open(pdfUrl, '_blank');

    modalFooter.appendChild(downloadBtn);
    modalFooter.appendChild(openNewTabBtn);

    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modalContent.appendChild(modalFooter);
    modalDialog.appendChild(modalContent);
    modal.appendChild(modalDialog);

    document.body.appendChild(modal);

    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            document.body.removeChild(modal);
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);

    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
            document.removeEventListener('keydown', handleEscape);
        }
    };
}

function viewVideoFullscreen(videoSrc, videoName) {
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.display = 'block';
    modal.style.backgroundColor = 'rgba(0,0,0,0.9)';
    modal.tabIndex = '-1';

    const modalDialog = document.createElement('div');
    modalDialog.className = 'modal-dialog modal-dialog-centered modal-xl';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content bg-transparent border-0';

    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header border-0';

    const modalTitle = document.createElement('h5');
    modalTitle.className = 'modal-title text-white';
    modalTitle.textContent = videoName;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn-close btn-close-white';
    closeButton.onclick = () => document.body.removeChild(modal);

    modalHeader.appendChild(modalTitle);
    modalHeader.appendChild(closeButton);

    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body p-0 text-center';

    const fullscreenVideo = document.createElement('video');
    fullscreenVideo.src = videoSrc;
    fullscreenVideo.className = 'img-fluid';
    fullscreenVideo.style.maxHeight = '80vh';
    fullscreenVideo.controls = true;
    fullscreenVideo.autoplay = true;

    modalBody.appendChild(fullscreenVideo);

    const modalFooter = document.createElement('div');
    modalFooter.className = 'modal-footer border-0 justify-content-center';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'btn btn-primary d-inline-flex align-items-center gap-2';
    downloadBtn.innerHTML = '<i class="bi bi-download"></i>Download';
    downloadBtn.onclick = () => downloadVideo(videoSrc, videoName);

    modalFooter.appendChild(downloadBtn);

    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modalContent.appendChild(modalFooter);
    modalDialog.appendChild(modalContent);
    modal.appendChild(modalDialog);

    document.body.appendChild(modal);

    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            document.body.removeChild(modal);
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);

    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
            document.removeEventListener('keydown', handleEscape);
        }
    };
}

function downloadImage(imageSrc, imageName) {
    const link = document.createElement('a');
    link.href = imageSrc;
    link.download = imageName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function downloadVideo(videoSrc, videoName) {
    const link = document.createElement('a');
    link.href = videoSrc;
    link.download = videoName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Video controls
function toggleLocalAudio() {
    if (!localStream) return;
    
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
        isLocalAudioMuted = !isLocalAudioMuted;
        audioTracks[0].enabled = !isLocalAudioMuted;
        
        const icon = localAudioToggle.querySelector('i');
        if (isLocalAudioMuted) {
            icon.className = 'bi bi-mic-mute-fill';
            localAudioToggle.classList.add('muted');
            localAudioToggle.title = 'Unmute Audio';
        } else {
            icon.className = 'bi bi-mic-fill';
            localAudioToggle.classList.remove('muted');
            localAudioToggle.title = 'Mute Audio';
        }
        
        if (peerConnection) {
            socket.emit('signal', {
                type: 'audio-state',
                isMuted: isLocalAudioMuted
            });
        }
    }
}

function toggleLocalVideo() {
    if (!localStream) return;
    
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
        isLocalVideoOff = !isLocalVideoOff;
        videoTracks[0].enabled = !isLocalVideoOff;
        
        const icon = localVideoToggle.querySelector('i');
        if (isLocalVideoOff) {
            icon.className = 'bi bi-camera-video-off-fill';
            localVideoToggle.classList.add('video-off');
            localVideoToggle.title = 'Turn On Video';
            localVideo.style.background = 'url("https://picsum.photos/seed/avatar/640/480.jpg") center/cover';
        } else {
            icon.className = 'bi bi-camera-video-fill';
            localVideoToggle.classList.remove('video-off');
            localVideoToggle.title = 'Turn Off Video';
            localVideo.style.background = '';
        }
        
        if (peerConnection) {
            socket.emit('signal', {
                type: 'video-state',
                isOff: isLocalVideoOff
            });
        }
    }
}

function toggleRemoteAudio() {
    isRemoteAudioMuted = !isRemoteAudioMuted;
    remoteVideo.muted = isRemoteAudioMuted;
    
    const icon = remoteAudioToggle.querySelector('i');
    if (isRemoteAudioMuted) {
        icon.className = 'bi bi-mic-mute-fill';
        remoteAudioToggle.classList.add('muted');
        remoteAudioToggle.title = 'Unmute Partner\'s Audio';
    } else {
        icon.className = 'bi bi-mic-fill';
        remoteAudioToggle.classList.remove('muted');
        remoteAudioToggle.title = 'Mute Partner\'s Audio';
    }
}

function handlePartnerStateChange(data) {
    if (data.type === 'audio-state') {
        if (data.isMuted) {
            appendMessage('Partner muted their microphone', 'system-message');
        } else {
            appendMessage('Partner unmuted their microphone', 'system-message');
        }
    } else if (data.type === 'video-state') {
        if (data.isOff) {
            appendMessage('Partner turned off their camera', 'system-message');
            remoteVideo.style.background = 'url("https://picsum.photos/seed/partner/640/480.jpg") center/cover';
        } else {
            appendMessage('Partner turned on their camera', 'system-message');
            remoteVideo.style.background = '';
        }
    }
}

function resetVideoControls() {
    isLocalAudioMuted = false;
    const localAudioIcon = localAudioToggle.querySelector('i');
    localAudioIcon.className = 'bi bi-mic-fill';
    localAudioToggle.classList.remove('muted');
    localAudioToggle.title = 'Mute Audio';
    
    isLocalVideoOff = false;
    const localVideoIcon = localVideoToggle.querySelector('i');
    localVideoIcon.className = 'bi bi-camera-video-fill';
    localVideoToggle.classList.remove('video-off');
    localVideoToggle.title = 'Turn Off Video';
    localVideo.style.background = '';
    
    isRemoteAudioMuted = false;
    const remoteAudioIcon = remoteAudioToggle.querySelector('i');
    remoteAudioIcon.className = 'bi bi-mic-fill';
    remoteAudioToggle.classList.remove('muted');
    remoteAudioToggle.title = 'Mute Partner\'s Audio';
    remoteVideo.style.background = '';
    
    if (localStream) {
        localStream.getAudioTracks().forEach(track => track.enabled = true);
        localStream.getVideoTracks().forEach(track => track.enabled = true);
    }
}

// Text message sending
sendBtn.addEventListener('click', () => {
    if (chatInput.value.trim()) {
        const data = { text: chatInput.value.trim() };
        socket.emit('chatMessage', data);
        appendMessage(chatInput.value.trim(), 'user-message');
        chatInput.value = '';
    }
});

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendBtn.click();
    }
});
