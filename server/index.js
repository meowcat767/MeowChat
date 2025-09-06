require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.use(express.static(path.join(__dirname, '../client')));

// Sample topics for rotation
const topics = [
  'Favorite childhood memory',
  'Best book you have ever read',
  'Dream travel destination',
  'A skill you wish you had',
  'Most inspiring person you know',
  'Funniest thing that happened to you',
  'A food you can’t live without',
  'Worst movie you ever saw',
  'A movie you recommend',
  'Your favorite hobby',
  'Anything!',
  'Best anime?',
  "Liminal Spaces",
  "Favorite video game",
  "If you could have any superpower, what would it be?",
"What fictional character do you relate to the most?",
"Ignore this message",
]; 

function getCurrentTopic() {
  const now = Date.now();
  const topicIndex = Math.floor(now / 86400000) % topics.length;
  return topics[topicIndex];
}

// Moderation filter
const bannedWords = [
  'nigger', 'faggot', 'retard', 'cunt', 'bitch', 'whore', 'slut', 'kike', 'chink', 'spic', 'gook', 'tranny', 'twat', 'dyke', 'paki', 'coon', 'tard', 'homo', 'pedo', 'rapist', 'molester', 'incest', 'zoophile', 'necrophile', 'terrorist', 'isis', 'hitler', 'nazis', 'heil', 'jihad', 'bomb', 'kill', 'murder', 'suicide', 'hang', 'lynch', 'shoot', 'stab', 'abuse', 'abuser', 'abusing', 'abused', 'slave', 'slavery', 'racist', 'racism', 'sexist', 'sexism', 'homophobic', 'homophobia', 'transphobic', 'transphobia', 'antisemitic', 'antisemitism', 'islamophobic', 'islamophobia', 'hateful', 'hatecrime', 'hate crime', 'hate speech', 'hatespeech', 'hate-speech', 'niggers', 'bashar Al Assad', 'nigga', 'Nigga', 'Nigge𝐫',
];
function moderateMessage(msg) {
  let filtered = typeof msg === 'string' ? msg : '';
  bannedWords.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    filtered = filtered.replace(regex, '[FILTERED]');
  });
  return filtered;
}

const protectedNicknames = ['Meowcat', "cameronscene"];
let ownerSecret = '';

// Load owner secret from database
async function loadOwnerSecret() {
  try {
    const res = await pool.query("SELECT value FROM settings WHERE key = 'owner_secret' LIMIT 1");
    if (res.rows.length > 0) {
      ownerSecret = res.rows[0].value;
    }
  } catch (err) {
    console.error('Error loading owner secret from DB:', err);
  }
}

function isProtectedNickname(nickname, secret) {
  return protectedNicknames.includes(nickname) && secret === ownerSecret;
}

// Load secret on server start
loadOwnerSecret();

const bannedIPs = new Set();

io.on('connection', async (socket) => {
  const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;
  if (bannedIPs.has(ip)) {
    socket.disconnect(true);
    return;
  }

  // Send topic immediately on connect
  socket.emit('topic', getCurrentTopic());

  // Send recent messages immediately on connect
  try {
    const res = await pool.query('SELECT nickname, content, created_at FROM messages ORDER BY created_at ASC LIMIT 100');
    const msgs = res.rows.map(row => ({ nickname: row.nickname || 'Anonymous', text: row.content, timestamp: row.created_at ? new Date(row.created_at).toISOString() : '' }));
    socket.emit('messages', msgs);
  } catch (err) {
    socket.emit('messages', []);
  }

  socket.on('get topic', () => {
    socket.emit('topic', getCurrentTopic());
  });

  socket.on('get messages', async () => {
    try {
      const res = await pool.query('SELECT nickname, content, created_at FROM messages ORDER BY created_at ASC LIMIT 100');
      const msgs = res.rows.map(row => ({ nickname: row.nickname || 'Anonymous', text: row.content, timestamp: row.created_at ? new Date(row.created_at).toISOString() : '' }));
      socket.emit('messages', msgs);
    } catch (err) {
      socket.emit('messages', []);
    }
  });

  socket.on('chat message', async (msgObj) => {
    let nickname = msgObj.nickname || 'Anonymous';
    // Check for protected nickname
    if (protectedNicknames.includes(nickname)) {
      if (!isProtectedNickname(nickname, msgObj.secret)) {
        nickname = 'Anonymous';
      }
    }
    // If not protected, allow any nickname
    else if (!nickname.trim()) {
      nickname = 'Anonymous';
    }
    const cleanMsg = moderateMessage(msgObj.text);
    const timestamp = new Date().toISOString();
    const msgToSend = { nickname, text: cleanMsg, timestamp };
    io.emit('chat message', msgToSend);
    try {
      await pool.query('INSERT INTO messages (nickname, content, created_at) VALUES ($1, $2, $3)', [nickname, cleanMsg, timestamp]);
    } catch (err) {
      console.error('DB error:', err);
    }
  });

  socket.on('ban ip', ({ ip, nickname, secret }) => {
    if (protectedNicknames.includes(nickname) && isProtectedNickname(nickname, secret)) {
      bannedIPs.add(ip);
      io.emit('chat message', { nickname: 'System', text: `IP ${ip} has been banned.`, timestamp: new Date().toISOString() });
    }
  });

  // Only protected nicknames can request IP list
  socket.on('list ips', ({ nickname, secret }) => {
    if (protectedNicknames.includes(nickname) && isProtectedNickname(nickname, secret)) {
      const clients = Array.from(io.sockets.sockets.values());
      if (clients.length === 0) {
        socket.emit('chat message', { nickname: 'System', text: 'No users connected.', timestamp: new Date().toISOString() });
      }
      clients.forEach(client => {
        const ip = client.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || client.handshake.address;
        socket.emit('chat message', { nickname: 'System', text: `User IP: ${ip}`, timestamp: new Date().toISOString() });
      });
    } else {
      socket.emit('chat message', { nickname: 'System', text: 'Permission denied.', timestamp: new Date().toISOString() });
    }
  });
});

// API endpoint: Get recent messages
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pool.query('SELECT nickname, content, created_at FROM messages ORDER BY created_at DESC LIMIT 100');
    const messages = result.rows.map(row => ({
      nickname: row.nickname || 'Anonymous',
      text: row.content,
      timestamp: row.created_at ? new Date(row.created_at).toISOString() : ''
    }));
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// API endpoint: Get current topic
app.get('/api/topic', (req, res) => {
  res.json({ topic: getCurrentTopic() });
});

// API endpoint: Get total message count
app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM messages');
    res.json({ totalMessages: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
