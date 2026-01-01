const express = require('express');
const fetch = require('node-fetch');
const app = express();
const http = require('http').createServer(app);

// Updated Socket.IO configuration with increased buffer size for video files
const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e8 // 100 MB - increased to handle larger video files
});

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
    'India': 'IN',
    'Germany': 'DE',
    'France': 'FR',
    'Italy': 'IT',
    'Spain': 'ES',
    'Netherlands': 'NL',
    'Brazil': 'BR',
    'Japan': 'JP',
    'China': 'CN',
    'Russia': 'RU',
    'Mexico': 'MX',
    'South Korea': 'KR',
    'Indonesia': 'ID',
    'Turkey': 'TR',
    'Saudi Arabia': 'SA',
    'Switzerland': 'CH',
    'Taiwan': 'TW',
    'Belgium': 'BE',
    'Ireland': 'IE',
    'Israel': 'IL',
    'Austria': 'AT',
    'Norway': 'NO',
    'United Arab Emirates': 'AE',
    'Nigeria': 'NG',
    'Egypt': 'EG',
    'South Africa': 'ZA',
    'Argentina': 'AR',
    'Thailand': 'TH',
    'Poland': 'PL',
    'Malaysia': 'MY',
    'Philippines': 'PH',
    'Colombia': 'CO',
    'Chile': 'CL',
    'Finland': 'FI',
    'Singapore': 'SG',
    'Denmark': 'DK',
    'Hong Kong': 'HK',
    'Sweden': 'SE',
    'Vietnam': 'VN',
    'Portugal': 'PT',
    'Romania': 'RO',
    'Czech Republic': 'CZ',
    'New Zealand': 'NZ',
    'Peru': 'PE',
    'Greece': 'GR',
    'Pakistan': 'PK',
    'Bangladesh': 'BD',
    'Hungary': 'HU',
    'Kuwait': 'KW',
    'Ukraine': 'UA',
    'Iraq': 'IQ',
    'Algeria': 'DZ',
    'Qatar': 'QA',
    'Morocco': 'MA',
    'Slovakia': 'SK',
    'Ecuador': 'EC',
    'Belarus': 'BY',
    'Angola': 'AO',
    'Sudan': 'SD',
    'Azerbaijan': 'AZ',
    'Ethiopia': 'ET',
    'Kazakhstan': 'KZ',
    'Tanzania': 'TZ',
    'Ireland': 'IE',
    'Guatemala': 'GT',
    'Bulgaria': 'BG',
    'Serbia': 'RS',
    'Kenya': 'KE',
    'Croatia': 'HR',
    'Venezuela': 'VE',
    'Uzbekistan': 'UZ',
    'Libya': 'LY',
    'Lebanon': 'LB',
    'Ghana': 'GH',
    'Oman': 'OM',
    'Mozambique': 'MZ',
    'Panama': 'PA',
    'Czech Republic': 'CZ',
    'Nepal': 'NP',
    'Bolivia': 'BO',
    'Côte d\'Ivoire': 'CI',
    'Cameroon': 'CM',
    'Uruguay': 'UY',
    'Luxembourg': 'LU',
    'Senegal': 'SN',
    'Paraguay': 'PY',
    'Jordan': 'JO',
    'Azerbaijan': 'AZ',
    'El Salvador': 'SV',
    'Costa Rica': 'CR',
    'Bahrain': 'BH',
    'Tunisia': 'TN',
    'Estonia': 'EE',
    'Latvia': 'LV',
    'Slovenia': 'SI',
    'Lithuania': 'LT',
    'Macedonia': 'MK',
    'Moldova': 'MD',
    'Armenia': 'AM',
    'Albania': 'AL',
    'Bosnia and Herzegovina': 'BA',
    'Georgia': 'GE',
    'Mongolia': 'MN',
    'Yemen': 'YE',
    'Afghanistan': 'AF',
    'Zimbabwe': 'ZW',
    'Myanmar': 'MM',
    'Cyprus': 'CY',
    'Honduras': 'HN',
    'Nicaragua': 'NI',
    'Cambodia': 'KH',
    'Laos': 'LA',
    'Mali': 'ML',
    'Malta': 'MT',
    'Zambia': 'ZM',
    'Botswana': 'BW',
    'Namibia': 'NA',
    'Gabon': 'GA',
    'Jamaica': 'JM',
    'Trinidad and Tobago': 'TT',
    'Papua New Guinea': 'PG',
    'Fiji': 'FJ',
    'Bhutan': 'BT',
    'Guyana': 'GY',
    'Mongolia': 'MN',
    'Mozambique': 'MZ',
    'Ghana': 'GH',
    'Senegal': 'SN',
    'Zimbabwe': 'ZW',
    'Uganda': 'UG',
    'Gambia': 'GM',
    'Guinea': 'GN',
    'Rwanda': 'RW',
    'Benin': 'BJ',
    'Burundi': 'BI',
    'Togo': 'TG',
    'Sierra Leone': 'SL',
    'Malawi': 'MW',
    'Lesotho': 'LS',
    'Swaziland': 'SZ',
    'Somalia': 'SO',
    'Liberia': 'LR',
    'Djibouti': 'DJ',
    'Comoros': 'KM',
    'Cape Verde': 'CV',
    'São Tomé and Príncipe': 'ST',
    'Seychelles': 'SC',
    'Mauritius': 'MU',
    'Eritrea': 'ER',
    'Unknown': 'UN'
  };
  return countryCodes[country] || 'UN';
}

// Function to find a matching user
function findMatchingUser(socket, interests, location) {
  // First try to find a user with the same country and matching interests
  let partnerIndex = waitingUsers.findIndex(
    u =>
      u.country === location.country &&
      u.socket.id !== socket.id &&
      u.interests.some(i => interests.includes(i))
  );

  // If no match in the same country, try to find any user with matching interests
  if (partnerIndex === -1) {
    partnerIndex = waitingUsers.findIndex(
      u =>
        u.socket.id !== socket.id &&
        u.interests.some(i => interests.includes(i))
    );
  }

  return partnerIndex;
}

// Function to create a match between two users
function createMatch(user1, user2) {
  // Remove both users from the waiting queue
  waitingUsers = waitingUsers.filter(u => u.socket.id !== user1.socket.id && u.socket.id !== user2.socket.id);
  
  // Set up the partnership
  user1.socket.partner = user2.socket;
  user2.socket.partner = user1.socket;
  
  // Clear the chat area on both clients
  user1.socket.emit('clearChat');
  user2.socket.emit('clearChat');
  
  // Send partner information to both users
  user1.socket.emit('partner', { 
    id: user2.socket.id, 
    country: user2.country, 
    countryCode: user2.countryCode 
  });
  
  user2.socket.emit('partner', { 
    id: user1.socket.id, 
    country: user1.country, 
    countryCode: user1.countryCode 
  });
  
  console.log(`Matched ${user1.socket.id} with ${user2.socket.id}`);
}

io.on('connection', async socket => {
  console.log('User connected:', socket.id);
  onlineUsers++;
  io.emit('onlineCount', onlineUsers);

  // Extract the real IP address from the request headers
  const request = socket.request;
  let ip = request.headers['x-forwarded-for'] || 
           request.headers['x-real-ip'] || 
           request.connection.remoteAddress || 
           request.socket.remoteAddress ||
           (request.connection.socket ? request.connection.socket.remoteAddress : null);
           
  // If x-forwarded-for contains multiple IPs, take the first one (original client)
  if (ip && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  
  ip = normalizeIP(ip);
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

  console.log(`User ${socket.id} detected country: ${country} (IP: ${ip})`);

  socket.on('setInterests', data => {
    // Handle both old format (array of interests) and new format (object with interests and location)
    let interests;
    let location;
    
    if (Array.isArray(data)) {
      // Old format - just an array of interests
      interests = data;
      location = { country, countryCode };
    } else {
      // New format - object with interests and location
      interests = data.interests;
      location = data.location;
    }
    
    socket.interests = interests;
    socket.country = location.country;
    socket.countryCode = location.countryCode;

    console.log(`User ${socket.id} interests:`, interests);
    console.log(`User ${socket.id} location:`, location);

    // Create a user object
    const user = {
      socket,
      country: location.country,
      interests,
      countryCode: location.countryCode
    };

    // Try to find a matching user
    const partnerIndex = findMatchingUser(socket, interests, location);

    if (partnerIndex !== -1) {
      const partner = waitingUsers[partnerIndex];
      createMatch(user, partner);
    } else {
      waitingUsers.push(user);
      console.log(`User ${socket.id} added to waiting queue`);
      socket.emit('searching');
    }
  });

  socket.on('newMatch', () => {
    console.log(`User ${socket.id} requested a new match`);
    
    if (socket.partner) {
      socket.partner.emit('partner-left');
      socket.partner.partner = null;
      socket.partner = null;
    }
    
    // Remove current user from waiting queue if they're there
    waitingUsers = waitingUsers.filter(u => u.socket.id !== socket.id);
    
    // Try to find a new match immediately
    if (socket.interests && socket.interests.length > 0) {
      const location = { country: socket.country, countryCode: socket.countryCode };
      const partnerIndex = findMatchingUser(socket, socket.interests, location);
      
      if (partnerIndex !== -1) {
        const partner = waitingUsers[partnerIndex];
        const user = {
          socket,
          country: socket.country,
          interests: socket.interests,
          countryCode: socket.countryCode
        };
        createMatch(user, partner);
      } else {
        // No match found, add to waiting queue
        waitingUsers.push({ 
          socket, 
          country: socket.country, 
          interests: socket.interests, 
          countryCode: socket.countryCode 
        });
        console.log(`No match found for ${socket.id}, added to waiting queue`);
        
        // Notify the client that they're in the queue
        socket.emit('searching');
      }
    }
  });

  // Handle WebRTC signaling
  socket.on('signal', data => {
    console.log(`Received signal from ${socket.id}:`, data.type || 'unknown');
    if (socket.partner) {
      console.log(`Forwarding signal to partner: ${socket.partner.id}`);
      socket.partner.emit('signal', data);
    } else {
      console.log(`No partner found for ${socket.id}, signal dropped`);
    }
  });

  // Handle chat messages with file attachments
  socket.on('chatMessage', data => {
    if (socket.partner) {
      // Forward the message with file attachment to the partner
      socket.partner.emit('chatMessage', data);
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