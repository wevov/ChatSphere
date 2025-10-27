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

const configuration = {
  iceServers: [
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "776ad264d8d7c2912b8608ca",
      credential: "whgWO39tq3A27jzm",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "776ad264d8d7c2912b8608ca",
      credential: "whgWO39tq3A27jzm",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "776ad264d8d7c2912b8608ca",
      credential: "whgWO39tq3A27jzm",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "776ad264d8d7c2912b8608ca",
      credential: "whgWO39tq3A27jzm",
    },
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

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

  socket.emit('setInterests', interests);
});

newMatchBtn.addEventListener('click', () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
  chatBox.innerHTML = '';
  partnerInfo.style.display = 'none';
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
  alert('Your partner disconnected.');
});

socket.on('onlineCount', count => {
  onlineCount.textContent = `Online: ${count}`;
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