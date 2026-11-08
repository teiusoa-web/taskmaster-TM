const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');

const port = Number(process.env.UPLOAD_PORT) || 3002;
const dataRoot = path.join(process.cwd(), 'data');
const uploadRoot = path.join(dataRoot, 'uploads');
const backupRoot = path.join(dataRoot, 'backups');
const imageExtensions = {
  'image/avif': '.avif', 'image/bmp': '.bmp', 'image/gif': '.gif',
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'
};
const attachmentExtensions = {
  ...imageExtensions,
  'application/pdf': '.pdf', 'application/zip': '.zip',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/octet-stream': '.bin', 'text/plain': '.txt', 'text/csv': '.csv'
};
const maxSizes = { avatar: 5 * 1024 * 1024, attachment: 25 * 1024 * 1024 };

for (const kind of Object.keys(maxSizes)) {
  fs.mkdirSync(path.join(uploadRoot, kind === 'avatar' ? 'avatars' : 'attachments'), { recursive: true });
  fs.mkdirSync(path.join(backupRoot, kind === 'avatar' ? 'avatars' : 'attachments'), { recursive: true });
}

function send(res, status, body) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 36 * 1024 * 1024) {
        reject(new Error('Upload request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid upload request.')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && pathname === '/health') { send(res, 200, { ok: true, version: 2 }); return; }
  if (req.method !== 'POST' || pathname !== '/upload') { send(res, 404, { error: 'Not found' }); return; }

  try {
    const input = await readBody(req);
    const kind = input.kind;
    const extension = (kind === 'avatar' ? imageExtensions : attachmentExtensions)[input.type];
    if (!Object.hasOwn(maxSizes, kind) || !extension || typeof input.data !== 'string') {
      send(res, 400, { error: kind === 'avatar' ? 'Only supported image files are accepted for avatars.' : 'This file type is not supported as an attachment.' });
      return;
    }
    const image = Buffer.from(input.data, 'base64');
    if (!image.length || image.length > maxSizes[kind]) {
      send(res, 413, { error: `Image exceeds the ${kind === 'avatar' ? '5 MB' : '25 MB'} size limit.` });
      return;
    }
    const prefix = kind === 'avatar' ? 'avatars' : 'attachments';
    const safeName = path.basename(String(input.name || 'image')).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'image';
    const id = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const filename = `${id}_${safeName.replace(/\.[^.]*$/, '')}${extension}`;
    const relative = path.join(prefix, filename);
    const uploadedPath = path.join(uploadRoot, relative);
    const backupPath = path.join(backupRoot, relative);
    await fs.promises.writeFile(uploadedPath, image, { flag: 'wx' });
    await fs.promises.copyFile(uploadedPath, backupPath, fs.constants.COPYFILE_EXCL);
    send(res, 201, { id, name: safeName, type: input.type, size: image.length, url: `/data/uploads/${relative.replace(/\\/g, '/')}` });
  } catch (error) {
    if (error.code === 'EEXIST') { send(res, 409, { error: 'Could not create a unique upload file.' }); return; }
    if (!res.destroyed) send(res, 400, { error: error.message || 'Upload failed.' });
  }
});

server.listen(port, () => console.log(`Image upload service listening on http://localhost:${port}`));
