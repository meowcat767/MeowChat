let nickname = localStorage.getItem('nickname');
let secret = '';
if (!nickname) {
  nickname = prompt('Enter your nickname:');
  if (nickname === 'Meowcat') {
    secret = prompt('Enter user secret:');
  }
  localStorage.setItem('nickname', nickname);
} else {
  if (nickname === 'Meowcat') {
    secret = prompt('Enter user secret:');
  }
}

const socket = io();
const messages = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const filterInput = document.getElementById('filter-input');
const topicSpan = document.getElementById('topic');
const userCountSpan = document.getElementById('user-count');

let allMessages = [];

// Receive and display topic
socket.on('topic', (topic) => {
  topicSpan.textContent = topic;
});

// Receive and display messages
socket.on('chat message', (msgObj) => {
  allMessages.push(msgObj);
  renderMessages();
});

socket.on('chat message', (msgObj) => {
  // System messages for admin commands
  if (msgObj.nickname === 'System') {
    allMessages.push(msgObj);
    renderMessages();
  }
});

// Update user count
socket.on('user count', count => {
  userCountSpan.textContent = count;
});

function renderMessages() {
  const filter = filterInput.value.toLowerCase();
  messages.innerHTML = '';
  allMessages.filter(m => m.text && m.text.toLowerCase().includes(filter)).forEach(m => {
    const div = document.createElement('div');
    let time = '';
    if (m.timestamp) {
      if (typeof m.timestamp === 'string' && m.timestamp.length > 0) {
        // Try to format ISO string
        if (!isNaN(Date.parse(m.timestamp))) {
          time = new Date(m.timestamp).toLocaleString();
        } else {
          time = m.timestamp;
        }
      }
    }
    div.innerHTML = `<strong>${m.nickname}</strong>${time ? ' <span style=\'color:gray\'>[' + time + ']</span>' : ''}: ${m.text}`;
    messages.appendChild(div);
  });
  if (allMessages.length === 0) {
    messages.innerHTML = '<div style="color:gray">No messages yet.</div>';
  }
  document.getElementById('total-messages').textContent = allMessages.length;
  messages.scrollTop = messages.scrollHeight;
}

filterInput.addEventListener('input', renderMessages);

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = messageInput.value;
  if (msg.trim()) {
    // Ban command (only for protected nicknames)
    if (nickname === 'Meowcat' && msg.startsWith('/ban ')) {
      const ipToBan = msg.split(' ')[1];
      socket.emit('ban ip', { ip: ipToBan, nickname, secret });
      messageInput.value = '';
      return;
    }
    // List IPs command (only for protected nicknames)
    if (nickname === 'Meowcat' && msg === '/listips') {
      socket.emit('list ips', { nickname, secret });
      messageInput.value = '';
      return;
    }
    socket.emit('chat message', { nickname, text: msg, secret });
    messageInput.value = '';
  }
});

// On page load, request topic and recent messages
socket.emit('get topic');
socket.emit('get messages');

socket.on('messages', (msgs) => {
  allMessages = msgs;
  renderMessages();
});
