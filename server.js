const http = require('node:http');
const path = require('node:path');
require('dotenv').config();

// Import auth handler từ file hiện có của bạn
const { createAuthHandler, migrateUsers } = require('./scripts/auth-server.cjs');

// Chạy migrate database/users trước khi start server
migrateUsers().catch(err => {
  console.error('Migration failed:', err);
});

const authHandler = createAuthHandler();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Xử lý các request auth
  const handled = await authHandler(req, res, pathname);
  if (handled) return;

  // Nếu không phải route auth, trả về thông báo hoặc phục vụ static file tùy ý
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// QUAN TRỌNG: Render bắt buộc dùng process.env.PORT và bind '0.0.0.0'
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
