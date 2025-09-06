const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_GZWLbUl63BKm@ep-falling-pine-abg0ri0f-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
});

app.use(express.static(path.join(__dirname, '../client')));

// Sample topics for rotation
const topics = [
  'Favorite childhood memory',
  'Best book you ever read',
  'Dream travel destination',
  'A skill you wish you had',
  'Most inspiring person you know',
  'Funniest thing that happened to you',
  'A food you can’t live without',
  'What motivates you?',
  'A movie you recommend',
  'Your favorite hobby'
];

function getCurrentTopic() {
  const now = Date.now();
  const topicIndex = Math.floor(now / 86400000) % topics.length;
  return topics[topicIndex];
}

// Moderation filter
const bannedWords = ['badword1', 'badword2', 'offensive'];
function moderateMessage(msg) {
  let filtered = typeof msg === 'string' ? msg : '';
  bannedWords.forEach(word => {
    const regex = new RegExp(word, 'gi');
    filtered = filtered.replace(regex, '***');
  });
  return filtered;
}

const protectedNicknames = ['Meowcat'];
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

io.on('connection', async (socket) => {
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
