const express = require('express');
const fetch = require('node-fetch');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);


app.use(express.static('public'));

let waitingUsers = [];
let onlineUsers = 0;

function normalizeIP(ip) {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  return ip;
}

function getCountryCode(country) {
  const countryCodes = {
    'Philippines': 'PH',
    'United States': 'US',
    'United Kingdom': 'GB',
    'Canada': 'CA',
    'Australia': 'AU',
    // Add more country mappings as needed
    'Unknown': 'UN'
  };
  return countryCodes[country] || 'UN';
}

io.on('connection', async socket => {
  console.log('User connected:', socket.id);
  onlineUsers++;
  io.emit('onlineCount', onlineUsers);

  let ip = normalizeIP(socket.handshake.address);
  let country = 'Unknown';
  let countryCode = 'UN';

  const isPrivateIP =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.');

  if (isPrivateIP) {
    try {
      const publicIpRes = await fetch('https://api.ipify.org?format=json');
      const publicIpData = await publicIpRes.json();
      ip = publicIpData.ip;
      console.log(`Detected public IP: ${ip}`);

      const geoRes = await fetch(`http://ip-api.com/json/${ip}`);
      const geoData = await geoRes.json();

      if (geoData.status === 'success') {
        country = geoData.country;
        countryCode = geoData.countryCode || getCountryCode(country);
      } else {
        console.warn(`Geolocation failed for IP ${ip}: ${geoData.message}`);
      }
    } catch (err) {
      console.error('Error fetching public IP or geolocation:', err);
    }
  } else {
    try {
      const response = await fetch(`http://ip-api.com/json/${ip}`);
      const data = await response.json();
      if (data.status === 'success') {
        country = data.country;
        countryCode = data.countryCode || getCountryCode(country);
      } else {
        console.warn(`Geolocation failed for IP ${ip}: ${data.message}`);
      }
    } catch (e) {
      console.error('Geolocation error:', e);
    }
  }

  console.log(`User ${socket.id} detected country: ${country}`);

  socket.on('setInterests', interests => {
    socket.interests = interests;
    socket.country = country;
    socket.countryCode = countryCode;

    console.log(`User ${socket.id} interests:`, interests);

    const partnerIndex = waitingUsers.findIndex(
      u =>
        u.country === country &&
        u.socket.id !== socket.id &&
        u.interests.some(i => interests.includes(i))
    );

    if (partnerIndex !== -1) {
      const partner = waitingUsers[partnerIndex];
      waitingUsers.splice(partnerIndex, 1);

      socket.partner = partner.socket;
      partner.socket.partner = socket;

      socket.emit('partner', { id: partner.socket.id, country: partner.country, countryCode: partner.countryCode });
      partner.socket.emit('partner', { id: socket.id, country: socket.country, countryCode: socket.countryCode });

      console.log(`Matched ${socket.id} with ${partner.socket.id}`);
    } else {
      waitingUsers.push({ socket, country, interests, countryCode });
      console.log(`User ${socket.id} added to waiting queue`);
    }
  });

  socket.on('newMatch', () => {
    if (socket.partner) {
      socket.partner.emit('partner-left');
      socket.partner.partner = null;
      socket.partner = null;
    }
    waitingUsers = waitingUsers.filter(u => u.socket.id !== socket.id);
    socket.emit('setInterests', socket.interests);
  });

  socket.on('signal', data => {
    if (socket.partner) {
      socket.partner.emit('signal', data);
    }
  });

  socket.on('chatMessage', msg => {
    if (socket.partner) {
      socket.partner.emit('chatMessage', msg);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    onlineUsers--;
    io.emit('onlineCount', onlineUsers);

    if (socket.partner) {
      socket.partner.emit('partner-left');
      socket.partner.partner = null;
    }

    waitingUsers = waitingUsers.filter(u => u.socket.id !== socket.id);
  });
});

http.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});