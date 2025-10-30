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

let localStream;
let peerConnection;
let userLocation = { country: 'Unknown', countryCode: 'UN' };

const configuration = {
  iceServers: [
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "51ce19f71e425b82d584c3f9",
      credential: "y3y8M7SKbRnt67UR",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "51ce19f71e425b82d584c3f9",
      credential: "y3y8M7SKbRnt67UR",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "51ce19f71e425b82d584c3f9",
      credential: "y3y8M7SKbRnt67UR",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "51ce19f71e425b82d584c3f9",
      credential: "y3y8M7SKbRnt67UR",
    },
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

// Function to get user location from their IP
async function getUserLocation() {
  try {
    // Try multiple geolocation services for better reliability
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
          // If we only got the IP, try to get location with another service
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
    
    // If all services fail, return unknown
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
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    alert('Could not get media: ' + err.message);
    return;
  }

  // Send both interests and location to the server
  socket.emit('setInterests', { interests, location: userLocation });
});

newMatchBtn.addEventListener('click', () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
  chatBox.innerHTML = '';
  partnerInfo.style.display = 'none';
  
  // Show a searching message
  appendMessage('Searching for a new match...', 'system-message');
  
  // Request a new match
  socket.emit('newMatch');
});

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(configuration);

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('signal', { candidate: event.candidate });
      console.log('Sent ICE candidate:', event.candidate);
    }
  };

  peerConnection.ontrack = event => {
    console.log('Received remote track:', event.streams[0]);
    if (event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'failed') {
      peerConnection.restartIce();
    }
  };

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
    console.log('Added local track:', track);
  });
}

socket.on('partner', async data => {
  console.log('Partner found:', data.id);
  
  // Clear any previous messages
  chatBox.innerHTML = '';

  partnerInfo.style.display = 'block';
  countryName.textContent = data.country;
  countryFlag.src = `https://flagcdn.com/24x18/${data.countryCode.toLowerCase()}.png`;

  createPeerConnection();

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('signal', { offer });
    console.log('Sent offer:', offer);
  } catch (e) {
    console.error('Error creating offer:', e);
  }
});

socket.on('signal', async data => {
  try {
    if (!peerConnection) {
      createPeerConnection();
    }

    if (data.offer) {
      console.log('Received offer:', data.offer);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('signal', { answer });
      console.log('Sent answer:', answer);
    } else if (data.answer) {
      console.log('Received answer:', data.answer);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.candidate) {
      console.log('Received ICE candidate:', data.candidate);
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (e) {
    console.error('Error handling signal:', e);
  }
});

socket.on('partner-left', () => {
  console.log('Partner disconnected');
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
  partnerInfo.style.display = 'none';
  appendMessage('Your partner disconnected. Click "New Match" to find someone else.', 'system-message');
});

socket.on('onlineCount', count => {
  onlineCount.textContent = `Online: ${count}`;
});

// Handle the clearChat event from the server
socket.on('clearChat', () => {
  chatBox.innerHTML = '';
  partnerInfo.style.display = 'none';
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
});

// Handle the searching event from the server
socket.on('searching', () => {
  appendMessage('Searching for a match with similar interests...', 'system-message');
});

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

function sendMessage() {
  const msg = chatInput.value.trim();
  if (msg === '') return;

  appendMessage('You: ' + msg, 'user-message');
  socket.emit('chatMessage', msg);
  chatInput.value = '';
}

socket.on('chatMessage', msg => {
  appendMessage('Partner: ' + msg, 'stranger-message');
});

function appendMessage(msg, className) {
  const div = document.createElement('div');
  div.textContent = msg;
  div.className = `message ${className}`;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}
