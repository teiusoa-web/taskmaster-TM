const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { migrateUsers, createAuthHandler } = require('./auth-server.cjs');

const preferredAppPort = Number(process.env.APP_PORT) || 3000;
const preferredApiPort = Number(process.env.API_PORT) || 3001;
const preferredUploadPort = Number(process.env.UPLOAD_PORT) || 3002;
const mimeTypes = {
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.css': 'text/css; charset=utf-8', '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.webp': 'image/webp', '.woff2': 'font/woff2'
};

function canBind(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

function get(port, route) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: route, timeout: 500 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', part => { body += part; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.once('timeout', () => req.destroy(new Error('Request timed out')));
    req.once('error', reject);
  });
}

async function servesApi(port) {
  try { const result = await get(port, '/tasks'); return result.status === 200 && Array.isArray(JSON.parse(result.body)); }
  catch { return false; }
}

async function servesUpload(port) {
  try { const result = await get(port, '/health'); return result.status === 200 && JSON.parse(result.body).ok === true && JSON.parse(result.body).version === 2; }
  catch { return false; }
}

async function availablePort(start) {
  for (let port = start; port < start + 50; port += 1) if (await canBind(port)) return port;
  throw new Error('No available port found for TaskMaster.');
}

function launch(command, args, extraEnv = {}) {
  const child = spawn(command, args, { stdio: 'inherit', cwd: process.cwd(), env: { ...process.env, ...extraEnv } });
  child.once('error', error => console.error('Could not start TaskMaster service:', error.message));
  return child;
}

function monitor(child) {
  child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 0;
  });
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForService(check, child = null, attempts = 35) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return true;
    if (child && (child.exitCode !== null || child.signalCode !== null)) return false;
    await delay(120);
  }
  return false;
}

async function ensureService(startPort, check, command, args, extraEnv = {}) {
  let port = startPort;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!(await canBind(port))) {
      if (await waitForService(() => check(port), null, 8)) {
        console.log(`Using existing TaskMaster service at http://localhost:${port}/`);
        return port;
      }
      port = await availablePort(port + 1);
      continue;
    }

    const child = launch(command(port), args(port), extraEnv(port));
    if (await waitForService(() => check(port), child)) {
      monitor(child);
      return port;
    }

    if (child.exitCode === null && child.signalCode === null) child.kill();
    if (await waitForService(() => check(port), null, 8)) {
      console.log(`Using existing TaskMaster service at http://localhost:${port}/`);
      return port;
    }
    port = await availablePort(port + 1);
  }
  throw new Error(`Could not start TaskMaster service near port ${startPort}.`);
}

function serveStatic(port) {
  const projectRoot = process.cwd();
  const root = path.join(projectRoot, 'public');
  const handleAuth = createAuthHandler({ appUrl: process.env.APP_URL || `http://localhost:${port}` });
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400).end('Bad request'); return; }
    if (pathname.startsWith('/auth/')) { handleAuth(req, res, pathname); return; }
    if (pathname.toLowerCase() === '/.env' || pathname.toLowerCase().startsWith('/.env/')) { res.writeHead(404).end('Not found'); return; }
    if (pathname.toLowerCase().startsWith('/data/') && !pathname.toLowerCase().startsWith('/data/uploads/')) { res.writeHead(404).end('Not found'); return; }
    if (pathname === '/') pathname = '/index.html';
    const isUpload = pathname.toLowerCase().startsWith('/data/uploads/');
    const target = path.resolve(isUpload ? projectRoot : root, `.${pathname}`);
    const allowedRoot = isUpload ? path.join(projectRoot, 'data', 'uploads') : root;
    if (target !== allowedRoot && !target.startsWith(`${allowedRoot}${path.sep}`)) { res.writeHead(403).end('Forbidden'); return; }
    fs.readFile(target, (error, data) => {
      if (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      server.on('error', error => console.error('TaskMaster web server error:', error.message));
      console.log(`TaskMaster: http://localhost:${port}/`);
      resolve(server);
    });
  });
}

async function start() {
  await migrateUsers();
  const apiPort = await ensureService(
    preferredApiPort,
    servesApi,
    () => process.execPath,
    port => [require.resolve('json-server/lib/bin.js'), 'data/database.json', '--port', String(port)],
    () => ({})
  );
  const uploadPort = await ensureService(
    preferredUploadPort,
    servesUpload,
    () => process.execPath,
    () => [path.join(process.cwd(), 'scripts', 'upload-server.cjs')],
    port => ({ UPLOAD_PORT: String(port) })
  );

  const configPath = path.join(process.cwd(), 'public', 'js', 'api-config.js');
  fs.writeFileSync(configPath, `export const API_BASE = 'http://localhost:${apiPort}';\nexport const UPLOAD_BASE = 'http://localhost:${uploadPort}';\n`);
  let appPort = preferredAppPort;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!(await canBind(appPort))) appPort = await availablePort(appPort + 1);
    try { await serveStatic(appPort); return; }
    catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      appPort = await availablePort(appPort + 1);
    }
  }
  throw new Error('Could not find an available port for the TaskMaster web app.');
}

start().catch(error => { console.error(error.message); process.exitCode = 1; });
