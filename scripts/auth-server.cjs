const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config();
const nodemailer = require('nodemailer');

const dataDir = path.join(process.cwd(), 'data');
const databasePath = path.join(dataDir, 'database.json');
const usersPath = path.join(dataDir, 'users.json');
const sessions = new Map();
const loginAttempts = new Map();
const recoveryAttempts = new Map();
const verificationAttempts = new Map();
const cookieName = 'tm_session';
const emailValid = value => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || ''));
const phoneValid = value => !value || (/^\+?[0-9\s().-]{7,20}$/.test(String(value)) && String(value).replace(/\D/g, '').length >= 7);
const emailTransport = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined
}) : null;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return `scrypt$131072$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function verifyPassword(password, encoded) {
  const [scheme, n, r, p, saltText, hashText] = String(encoded || '').split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, 'base64url');
    const actual = crypto.scryptSync(password, Buffer.from(saltText, 'base64url'), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

function publicUser(user) {
  const { passwordHash, password, resetTokenHash, resetExpiresAt, emailVerifyTokenHash, emailVerifyExpiresAt, ...safe } = user;
  return safe;
}

async function sendAccountEmail(to, subject, text, developmentUrl) {
  if (emailTransport && process.env.SMTP_FROM) {
    await emailTransport.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
    return;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('SMTP is not configured.');
  console.info(`[TaskMaster email preview] To: ${to}\n${developmentUrl || text}`);
}

function createToken() {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: crypto.createHash('sha256').update(raw).digest('hex') };
}

async function saveUsers(users) {
  const temporaryPath = `${usersPath}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(users, null, 2)}\n`, 'utf8');
  await fs.promises.rename(temporaryPath, usersPath);
}

async function migrateUsers() {
  fs.mkdirSync(dataDir, { recursive: true });
  let db = {};
  try { db = JSON.parse(await fs.promises.readFile(databasePath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const examplePath = path.join(dataDir, 'database.example.json');
    try { db = JSON.parse(await fs.promises.readFile(examplePath, 'utf8')); }
    catch (exampleError) { if (exampleError.code !== 'ENOENT') throw exampleError; db = { tasks: [], categories: [] }; }
    await fs.promises.writeFile(databasePath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  }
  let users = [];
  try { users = JSON.parse(await fs.promises.readFile(usersPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!Array.isArray(users)) throw new Error('data/users.json must contain an array.');
  for (const user of users) {
    if (user.password) user.passwordHash = hashPassword(String(user.password));
    delete user.password;
  }

  if (Array.isArray(db.users)) {
    const existingIds = new Set(users.map(user => user.id));
    for (const legacy of db.users) {
      if (!legacy?.id || existingIds.has(legacy.id)) continue;
      const { password: plaintext, ...profile } = legacy;
      users.push({ ...profile, passwordHash: hashPassword(String(plaintext || '')) });
    }
    await saveUsers(users);
    delete db.users;
    const tmpDb = `${databasePath}.tmp`;
    await fs.promises.writeFile(tmpDb, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
    await fs.promises.rename(tmpDb, databasePath);
  }
  await saveUsers(users);
}

function send(res, status, data, req, clearCookie = false) {
  const secure = Boolean(req.socket.encrypted) || req.headers['x-forwarded-proto'] === 'https';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (clearCookie) headers['Set-Cookie'] = `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
  res.writeHead(status, headers);
  res.end(data === null ? '' : JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 64 * 1024) { reject(new Error('Request body too large.')); req.destroy(); }
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

function sessionUser(req, users) {
  const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`));
  const token = cookie?.slice(cookieName.length + 1);
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) { if (token) sessions.delete(token); return null; }
  const user = users.find(item => item.id === session.userId && item.active);
  if (!user) { sessions.delete(token); return null; }
  session.expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  return user;
}

function usernameValid(value) { return /^[a-zA-Z0-9_.-]{3,40}$/.test(String(value || '')); }
function passwordValid(value) { return typeof value === 'string' && value.length >= 10 && Buffer.byteLength(value, 'utf8') <= 128; }

function createAuthHandler({ appUrl = process.env.APP_URL || `http://localhost:${process.env.APP_PORT || 3000}` } = {}) {
  return async function handleAuth(req, res, pathname) {
    if (!pathname.startsWith('/auth/')) return false;
    try {
      let users = JSON.parse(await fs.promises.readFile(usersPath, 'utf8'));
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) body = await readJson(req);

      if (req.method === 'POST' && pathname === '/auth/login') {
        const username = String(body.username || '').trim().toLowerCase();
        const attemptKey = `${req.socket.remoteAddress || 'unknown'}:${username}`;
        const attempt = loginAttempts.get(attemptKey) || { count: 0, blockedUntil: 0 };
        if (attempt.blockedUntil > Date.now()) { send(res, 429, { error: 'Quá nhiều lần đăng nhập sai. Hãy thử lại sau 15 phút.' }, req); return true; }
        const user = users.find(item => (String(item.username).toLowerCase() === username || (item.emailVerified && String(item.email || '').toLowerCase() === username)) && item.active);
        if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) {
          attempt.count += 1;
          if (attempt.count >= 5) { attempt.blockedUntil = Date.now() + 15 * 60 * 1000; attempt.count = 0; }
          loginAttempts.set(attemptKey, attempt);
          send(res, 401, { error: 'Tên đăng nhập hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa.' }, req); return true;
        }
        loginAttempts.delete(attemptKey);
        if (!user.passwordHash.startsWith('scrypt$131072$8$1$')) {
          user.passwordHash = hashPassword(String(body.password));
          await saveUsers(users);
        }
        const token = crypto.randomBytes(32).toString('base64url');
        sessions.set(token, { userId: user.id, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
        const secure = Boolean(req.socket.encrypted) || req.headers['x-forwarded-proto'] === 'https';
        res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure ? '; Secure' : ''}`);
        send(res, 200, { user: publicUser(user) }, req); return true;
      }

      if (req.method === 'POST' && pathname === '/auth/logout') {
        const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
        if (token) sessions.delete(token);
        send(res, 200, { ok: true }, req, true); return true;
      }

      if (req.method === 'POST' && pathname === '/auth/forgot-password') {
        const email = String(body.email || '').trim().toLowerCase();
        const responseMessage = 'If the verified email is registered, password reset instructions will be sent.';
        const rateKey = req.socket.remoteAddress || 'unknown';
        const rate = recoveryAttempts.get(rateKey) || { count: 0, blockedUntil: 0 };
        if (rate.blockedUntil > Date.now()) { send(res, 200, { message: responseMessage }, req); return true; }
        rate.count += 1;
        if (rate.count >= 3) { rate.count = 0; rate.blockedUntil = Date.now() + 15 * 60 * 1000; }
        recoveryAttempts.set(rateKey, rate);
        if (emailValid(email)) {
          const user = users.find(item => item.active && item.emailVerified === true && String(item.email || '').toLowerCase() === email);
          if (user) {
            const token = createToken();
            user.resetTokenHash = token.hash;
            user.resetExpiresAt = Date.now() + 30 * 60 * 1000;
            await saveUsers(users);
            const link = `${appUrl}/reset-password.html?token=${encodeURIComponent(token.raw)}`;
            void sendAccountEmail(email, 'TaskMaster password reset', `Use this one-time link within 30 minutes to reset your password:\n${link}`, link)
              .catch(error => console.error('Could not send password reset email:', error.message));
          }
        }
        send(res, 200, { message: responseMessage }, req); return true;
      }

      if (req.method === 'POST' && pathname === '/auth/reset-password') {
        const tokenHash = crypto.createHash('sha256').update(String(body.token || '')).digest('hex');
        const user = users.find(item => item.resetTokenHash && item.resetTokenHash === tokenHash && item.resetExpiresAt > Date.now());
        if (!user || !passwordValid(body.newPassword)) { send(res, 400, { error: 'The reset link is invalid or expired, or the new password is too short.' }, req); return true; }
        user.passwordHash = hashPassword(body.newPassword);
        delete user.resetTokenHash; delete user.resetExpiresAt;
        await saveUsers(users);
        for (const [sessionToken, session] of sessions) if (session.userId === user.id) sessions.delete(sessionToken);
        if (user.emailVerified && user.email) {
          try { await sendAccountEmail(user.email, 'TaskMaster password changed', 'Your TaskMaster password was changed. If you did not make this change, contact your administrator.'); }
          catch (error) { console.error('Could not send password change notice:', error.message); }
        }
        send(res, 200, { ok: true }, req); return true;
      }

      if (req.method === 'POST' && pathname === '/auth/verify-email') {
        const tokenHash = crypto.createHash('sha256').update(String(body.token || '')).digest('hex');
        const user = users.find(item => item.emailVerifyTokenHash === tokenHash && item.emailVerifyExpiresAt > Date.now());
        if (!user) { send(res, 400, { error: 'The verification link is invalid or expired.' }, req); return true; }
        user.emailVerified = true;
        delete user.emailVerifyTokenHash; delete user.emailVerifyExpiresAt;
        await saveUsers(users);
        send(res, 200, { ok: true }, req); return true;
      }

      const current = sessionUser(req, users);
      if (req.method === 'GET' && pathname === '/auth/me') {
        send(res, current ? 200 : 401, current ? { user: publicUser(current) } : { error: 'Unauthorized' }, req); return true;
      }
      if (!current) { send(res, 401, { error: 'Unauthorized' }, req); return true; }

      if (req.method === 'GET' && pathname === '/auth/users') {
        const visibleUsers = users.map(user => {
          const safe = publicUser(user);
          if (current.role !== 'admin' && user.id !== current.id) { delete safe.email; delete safe.phone; delete safe.emailVerified; }
          return safe;
        });
        send(res, 200, visibleUsers, req); return true;
      }
      if (req.method === 'POST' && pathname === '/auth/users') {
        if (current.role !== 'admin') { send(res, 403, { error: 'Forbidden' }, req); return true; }
        const username = String(body.username || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const phone = String(body.phone || '').trim();
        if (!usernameValid(username) || users.some(user => user.username.toLowerCase() === username.toLowerCase())) { send(res, 400, { error: 'Tên đăng nhập không hợp lệ hoặc đã được sử dụng.' }, req); return true; }
        if (!emailValid(email) || users.some(user => String(user.email || '').toLowerCase() === email)) { send(res, 400, { error: 'A valid, unused email address is required.' }, req); return true; }
        if (!phoneValid(phone)) { send(res, 400, { error: 'Invalid phone number.' }, req); return true; }
        if (!passwordValid(body.password)) { send(res, 400, { error: 'Mật khẩu phải có ít nhất 10 ký tự và không quá 128 byte.' }, req); return true; }
        if (!['user', 'manager'].includes(body.role)) { send(res, 400, { error: 'Vai trò không hợp lệ.' }, req); return true; }
        const user = { id: `user_${crypto.randomUUID()}`, name: String(body.name || '').trim(), username, email, phone, emailVerified: false, role: body.role, active: true, passwordHash: hashPassword(body.password) };
        if (user.name.length < 2 || user.name.length > 100) { send(res, 400, { error: 'Tên phải có từ 2 đến 100 ký tự.' }, req); return true; }
        users.push(user); await saveUsers(users); send(res, 201, publicUser(user), req); return true;
      }

      if (req.method === 'PUT' && pathname.startsWith('/auth/users/')) {
        const id = decodeURIComponent(pathname.slice('/auth/users/'.length));
        const index = users.findIndex(user => user.id === id);
        if (index < 0) { send(res, 404, { error: 'User not found.' }, req); return true; }
        const target = users[index];
        if (current.id !== target.id && current.role !== 'admin') { send(res, 403, { error: 'Forbidden' }, req); return true; }
        const allowed = current.role === 'admin' && current.id !== target.id ? ['active'] : ['name', 'avatar', 'avatarCrop', 'birthDate', 'hobbies', 'email', 'phone'];
        for (const field of allowed) {
          if (!Object.hasOwn(body, field)) continue;
          if (field === 'active' && typeof body.active !== 'boolean') { send(res, 400, { error: 'Trạng thái không hợp lệ.' }, req); return true; }
          if (field === 'email') {
            const email = String(body.email || '').trim().toLowerCase();
            if (!emailValid(email) || users.some(user => user.id !== target.id && String(user.email || '').toLowerCase() === email)) { send(res, 400, { error: 'A valid, unused email address is required.' }, req); return true; }
            if (email !== String(target.email || '').toLowerCase()) {
              if (!verifyPassword(String(body.currentPassword || ''), target.passwordHash)) { send(res, 400, { error: 'Enter your current password to change your email.' }, req); return true; }
              const oldEmail = target.email;
              target.email = email;
              target.emailVerified = false;
              delete target.emailVerifyTokenHash;
              delete target.emailVerifyExpiresAt;
              if (oldEmail && target.emailVerified === false) {
                try { await sendAccountEmail(oldEmail, 'TaskMaster email changed', 'The email address on your account was changed. If you did not make this change, contact your administrator.'); }
                catch (error) { console.error('Could not send email change notice:', error.message); }
              }
            }
          } else if (field === 'phone') {
            const phone = String(body.phone || '').trim();
            if (!phoneValid(phone)) { send(res, 400, { error: 'Invalid phone number.' }, req); return true; }
            target.phone = phone;
          } else if (field === 'avatarCrop') {
            const crop = body.avatarCrop;
            if (crop === null) {
              delete target.avatarCrop;
              continue;
            }
            if (!crop || !Number.isFinite(Number(crop.x)) || !Number.isFinite(Number(crop.y)) || !Number.isFinite(Number(crop.zoom)) || Math.abs(Number(crop.x)) > 100 || Math.abs(Number(crop.y)) > 100 || Number(crop.zoom) < 1 || Number(crop.zoom) > 3) { send(res, 400, { error: 'Invalid avatar crop settings.' }, req); return true; }
            target.avatarCrop = { x: Number(crop.x), y: Number(crop.y), zoom: Number(crop.zoom) };
          } else if (field === 'avatar' && body.avatar === null) {
            delete target.avatar;
          } else target[field] = body[field];
        }
        if (typeof target.name !== 'string' || target.name.trim().length < 2 || target.name.length > 100) { send(res, 400, { error: 'Tên phải có từ 2 đến 100 ký tự.' }, req); return true; }
        users[index] = target; await saveUsers(users); send(res, 200, publicUser(target), req); return true;
      }

      if (req.method === 'POST' && pathname === '/auth/request-email-verification') {
        if (!emailValid(current.email)) { send(res, 400, { error: 'Add a valid email address to your profile first.' }, req); return true; }
        if (current.emailVerified) { send(res, 200, { ok: true, message: 'Email is already verified.' }, req); return true; }
        const lastSent = verificationAttempts.get(current.id) || 0;
        if (Date.now() - lastSent < 60 * 1000) { send(res, 429, { error: 'Wait one minute before requesting another verification email.' }, req); return true; }
        verificationAttempts.set(current.id, Date.now());
        const token = createToken();
        current.emailVerifyTokenHash = token.hash;
        current.emailVerifyExpiresAt = Date.now() + 30 * 60 * 1000;
        await saveUsers(users);
        const link = `${appUrl}/verify-email.html?token=${encodeURIComponent(token.raw)}`;
        try { await sendAccountEmail(current.email, 'Verify your TaskMaster email', `Use this one-time link within 30 minutes to verify your email:\n${link}`, link); }
        catch (error) { console.error('Could not send email verification:', error.message); }
        send(res, 200, { ok: true, message: 'If email delivery is configured, a verification link has been sent.' }, req); return true;
      }

      if (req.method === 'POST' && pathname === '/auth/change-password') {
        if (!verifyPassword(String(body.currentPassword || ''), current.passwordHash)) { send(res, 400, { error: 'Mật khẩu hiện tại không đúng.' }, req); return true; }
        if (!passwordValid(body.newPassword)) { send(res, 400, { error: 'Mật khẩu mới phải có ít nhất 10 ký tự và không quá 128 byte.' }, req); return true; }
        current.passwordHash = hashPassword(body.newPassword); await saveUsers(users);
        send(res, 200, { ok: true }, req); return true;
      }

      send(res, 404, { error: 'Not found' }, req); return true;
    } catch (error) {
      if (!res.headersSent) send(res, 500, { error: error.message || 'Authentication service error.' }, req);
      else res.destroy();
      return true;
    }
  };
}

module.exports = { migrateUsers, createAuthHandler };

if (process.argv.includes('--migrate')) {
  migrateUsers().catch(error => { console.error(error.message); process.exitCode = 1; });
}
