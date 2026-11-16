const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const {
  OTP_TTL_MS,
  generateOTP,
  saveOTP,
  sendOTPEmail,
  verifyAndConsumeOTP,
  sendDeadlineReminderEmail
} = require('./otp-service.cjs');

dotenv.config();

const dataDir = path.join(process.cwd(), 'data');
const databasePath = path.join(dataDir, 'database.json');
const usersPath = path.join(dataDir, 'users.json');
const outboxPath = path.join(dataDir, 'mail-outbox.json');
const sessionsPath = path.join(dataDir, 'sessions.json');
const sessions = new Map();
const loginAttempts = new Map();
const recoveryAttempts = new Map();
const verificationAttempts = new Map();
const cookieName = 'tm_session';

function loadSessionsFromDisk() {
  try {
    if (!fs.existsSync(sessionsPath)) return;
    const raw = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    if (raw && typeof raw === 'object') {
      const now = Date.now();
      for (const [token, session] of Object.entries(raw)) {
        if (session && session.userId && session.expiresAt > now) {
          sessions.set(token, session);
        }
      }
    }
  } catch {
    // ignore corrupt session cache
  }
}

function saveSessionsToDisk() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const now = Date.now();
    const obj = {};
    for (const [token, session] of sessions.entries()) {
      if (session && session.expiresAt > now) {
        obj[token] = session;
      }
    }
    fs.writeFileSync(sessionsPath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  } catch {
    // ignore write error
  }
}

loadSessionsFromDisk();

const emailValid = value => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
const phoneValid = value => !value || (/^\+?[0-9\s().-]{7,20}$/.test(String(value)) && String(value).replace(/\D/g, '').length >= 7);
const usernameValid = value => /^[a-zA-Z0-9_.-]{3,40}$/.test(String(value || ''));
const passwordValid = value => typeof value === 'string' && value.length >= 10 && Buffer.byteLength(value, 'utf8') <= 128;

let cachedEtherealAccount = null;

function isRealSmtpConfigured() {
  dotenv.config({ override: true });
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASSWORD || '').trim();
  if (!host || host === 'smtp.example.com') return false;
  if (!user || user === 'your-smtp-user') return false;
  if (!pass || pass === 'your-smtp-password') return false;
  return true;
}

function createRealSmtpTransport(customConfig = null) {
  const host = String(customConfig?.host || process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(customConfig?.port || process.env.SMTP_PORT) || 587;
  const user = String(customConfig?.user || process.env.SMTP_USER || '').trim();
  let pass = String(customConfig?.pass ?? process.env.SMTP_PASSWORD ?? '').trim();
  if (host.toLowerCase().includes('gmail')) {
    pass = pass.replace(/\s+/g, '');
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: customConfig?.secure ?? (process.env.SMTP_SECURE === 'true' || port === 465),
    auth: user ? { user, pass } : undefined
  });
}

async function getEtherealTransport() {
  try {
    if (!cachedEtherealAccount) {
      cachedEtherealAccount = await Promise.race([
        nodemailer.createTestAccount(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ethereal timeout')), 3500))
      ]);
    }
    return nodemailer.createTransport({
      host: cachedEtherealAccount.smtp.host,
      port: cachedEtherealAccount.smtp.port,
      secure: cachedEtherealAccount.smtp.secure,
      auth: {
        user: cachedEtherealAccount.user,
        pass: cachedEtherealAccount.pass
      }
    });
  } catch {
    return null;
  }
}

function buildHtmlEmail({ title, greeting, bodyLines = [], code = '', actionText = '', actionUrl = '', footerNote = '' }) {
  const escapedGreeting = escapeHtml(greeting || 'Xin chào,');
  const paragraphs = bodyLines.map(line => `<p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.6;">${escapeHtml(line)}</p>`).join('');
  const codeBlock = code ? `
    <div style="margin:22px 0;padding:16px 20px;background:#f8fafc;border:1px dashed #6366f1;border-radius:12px;text-align:center;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin-bottom:6px;">Mã xác nhận (OTP)</div>
      <div style="font-size:28px;font-weight:800;letter-spacing:0.22em;color:#4f46e5;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${escapeHtml(code)}</div>
      <div style="font-size:12px;color:#64748b;margin-top:6px;">Có hiệu lực trong vòng 30 phút</div>
    </div>` : '';
  const buttonBlock = actionUrl ? `
    <div style="margin:24px 0;text-align:center;">
      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 28px;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;border-radius:10px;">${escapeHtml(actionText || 'Mở liên kết xác nhận')}</a>
    </div>
    <p style="margin:14px 0 0;color:#64748b;font-size:12.5px;line-height:1.5;word-break:break-all;">Hoặc sao chép liên kết sau vào trình duyệt:<br><a href="${escapeHtml(actionUrl)}" style="color:#4f46e5;">${escapeHtml(actionUrl)}</a></p>` : '';
  const footer = footerNote
    ? `<p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;color:#64748b;font-size:13px;line-height:1.5;">${escapeHtml(footerNote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:540px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 10px 25px rgba(15,23,42,0.06);">
    <div style="padding:20px 28px;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#ffffff;">
      <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em;">TaskMaster</div>
      <div style="font-size:13px;opacity:0.9;margin-top:2px;">Hệ thống Quản lý Công việc</div>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 16px;color:#0f172a;font-size:20px;font-weight:800;">${escapeHtml(title)}</h1>
      <p style="margin:0 0 14px;color:#1e293b;font-size:15px;font-weight:600;">${escapedGreeting}</p>
      ${paragraphs}
      ${codeBlock}
      ${buttonBlock}
      ${footer}
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function appendMailOutbox(entry) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    let list = [];
    try {
      list = JSON.parse(await fs.promises.readFile(outboxPath, 'utf8'));
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
    list.unshift({ id: `mail_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, createdAt: new Date().toISOString(), ...entry });
    if (list.length > 30) list = list.slice(0, 30);
    await fs.promises.writeFile(outboxPath, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error('Could not write mail outbox:', error.message);
  }
}

async function sendAccountEmail({ to, subject, text, html, actionUrl = '', code = '' }) {
  const fromAddress = (process.env.SMTP_FROM && process.env.SMTP_FROM !== 'TaskMaster <no-reply@example.com>')
    ? process.env.SMTP_FROM
    : `TaskMaster <${process.env.SMTP_USER || 'no-reply@taskmaster.local'}>`;

  if (isRealSmtpConfigured()) {
    try {
      const transport = createRealSmtpTransport();
      await transport.sendMail({ from: fromAddress, to, subject, text, html });
      await appendMailOutbox({ to, subject, text, actionUrl, code, mode: 'smtp' });
      return { delivered: true, mode: 'smtp', previewUrl: '', devLink: '', devCode: '' };
    } catch (smtpError) {
      console.error('[TaskMaster SMTP Error]:', smtpError.message);
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Không thể gửi email qua SMTP: ${smtpError.message}`);
      }
    }
  }

  let previewUrl = '';
  const ethereal = await getEtherealTransport();
  if (ethereal) {
    try {
      const info = await Promise.race([
        ethereal.sendMail({ from: fromAddress, to, subject, text, html }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Send timeout')), 4000))
      ]);
      previewUrl = nodemailer.getTestMessageUrl(info) || '';
    } catch {
      previewUrl = '';
    }
  }

  console.info(`\n========== [TaskMaster Email] ==========\nTo: ${to}\nSubject: ${subject}\n${code ? `OTP Code: ${code}\n` : ''}${actionUrl ? `Link: ${actionUrl}\n` : ''}${previewUrl ? `Webmail Preview: ${previewUrl}\n` : ''}========================================\n`);
  await appendMailOutbox({ to, subject, text, actionUrl, code, previewUrl, mode: previewUrl ? 'ethereal' : 'dev' });

  return {
    delivered: false,
    mode: previewUrl ? 'ethereal' : 'dev',
    previewUrl,
    devLink: actionUrl,
    devCode: code
  };
}

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
  const {
    passwordHash,
    password,
    resetTokenHash,
    resetCodeHash,
    resetExpiresAt,
    emailVerifyTokenHash,
    emailVerifyCodeHash,
    emailVerifyExpiresAt,
    ...safe
  } = user;
  return safe;
}

function createToken() {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: crypto.createHash('sha256').update(raw).digest('hex') };
}

function createOtpCode() {
  const raw = String(crypto.randomInt(100000, 1000000));
  return { raw, hash: crypto.createHash('sha256').update(raw).digest('hex') };
}

function hashTokenValue(raw) {
  return crypto.createHash('sha256').update(String(raw || '').trim()).digest('hex');
}

async function saveUsers(users) {
  const temporaryPath = `${usersPath}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(users, null, 2)}\n`, 'utf8');
  await fs.promises.rename(temporaryPath, usersPath);
}

async function deleteUploadedAssetIfUnused(assetUrl, users) {
  const raw = String(assetUrl || '').trim();
  if (!raw.startsWith('/data/uploads/')) return;
  const stillReferenced = users.some(item => item && (item.avatar === raw || item.coverImage === raw));
  if (stillReferenced) return;
  const relative = raw.slice('/data/uploads/'.length).replace(/^\/+/, '');
  if (!relative) return;
  const uploadsRoot = path.resolve(dataDir, 'uploads');
  const backupsRoot = path.resolve(dataDir, 'backups');
  for (const root of [uploadsRoot, backupsRoot]) {
    const targetPath = path.resolve(root, relative);
    if (targetPath === root || !targetPath.startsWith(root + path.sep)) continue;
    await fs.promises.unlink(targetPath).catch(() => {});
  }
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

  const defaultDemoEmails = {
    admin: 'admin@taskmaster.vn',
    manager: 'manager@taskmaster.vn',
    user: 'user@taskmaster.vn',
    user2: 'user2@taskmaster.vn'
  };

  for (const user of users) {
    if (user.password) user.passwordHash = hashPassword(String(user.password));
    delete user.password;
    if (!user.email && defaultDemoEmails[user.username]) {
      user.email = defaultDemoEmails[user.username];
      user.emailVerified = true;
    }
    if (typeof user.emailVerified !== 'boolean') {
      user.emailVerified = Boolean(user.email && defaultDemoEmails[user.username] === user.email);
    }
  }

  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (users.length === 0 && (adminUsername || adminPassword)) {
    if (!usernameValid(adminUsername) || !passwordValid(adminPassword)) {
      throw new Error('Set a valid ADMIN_USERNAME (3-40 characters) and ADMIN_PASSWORD (10-128 bytes) to bootstrap the first admin.');
    }
    users.push({
      id: 'user_admin',
      name: process.env.ADMIN_NAME || 'Administrator',
      username: adminUsername,
      email: process.env.ADMIN_EMAIL || 'admin@taskmaster.vn',
      emailVerified: true,
      role: 'admin',
      active: true,
      passwordHash: hashPassword(adminPassword)
    });
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
      if (size > 64 * 1024) { reject(new Error('Dữ liệu gửi lên quá lớn.')); req.destroy(); }
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Dữ liệu JSON không hợp lệ.')); }
    });
    req.on('error', reject);
  });
}

function sessionUser(req, users) {
  const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`));
  const token = cookie?.slice(cookieName.length + 1);
  if (!token) return null;
  if (!sessions.has(token)) loadSessionsFromDisk();
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token && sessions.has(token)) {
      sessions.delete(token);
      saveSessionsToDisk();
    }
    return null;
  }
  const user = users.find(item => item.id === session.userId && item.active);
  if (!user) {
    sessions.delete(token);
    saveSessionsToDisk();
    return null;
  }
  session.expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  return user;
}

async function issueVerificationForUser(user, users, appUrl) {
  const token = createToken();
  const otpCode = generateOTP();
  await saveOTP(user.email, otpCode, 'verify-email');

  user.emailVerifyTokenHash = token.hash;
  user.emailVerifyCodeHash = hashTokenValue(otpCode);
  user.emailVerifyExpiresAt = Date.now() + OTP_TTL_MS;
  await saveUsers(users);

  const link = `${appUrl}/verify-email.html?token=${encodeURIComponent(token.raw)}`;
  const otpDelivery = await sendOTPEmail(user.email, otpCode, 'verify-email');
  return {
    delivered: otpDelivery.delivered,
    mode: otpDelivery.mode,
    previewUrl: '',
    devLink: link,
    devCode: otpCode
  };
}

function createAuthHandler({ appUrl = process.env.APP_URL || `http://localhost:${process.env.APP_PORT || 3000}` } = {}) {
  return async function handleAuth(req, res, pathname) {
    if (!pathname.startsWith('/auth/')) return false;
    try {
      let users = JSON.parse(await fs.promises.readFile(usersPath, 'utf8'));
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) body = await readJson(req);

      if (req.method === 'POST' && pathname === '/auth/login') {
        const identifier = String(body.username || '').trim().toLowerCase();
        const attemptKey = `${req.socket.remoteAddress || 'unknown'}:${identifier}`;
        const attempt = loginAttempts.get(attemptKey) || { count: 0, blockedUntil: 0 };
        if (attempt.blockedUntil > Date.now()) {
          send(res, 429, { error: 'Quá nhiều lần đăng nhập sai. Hãy thử lại sau 15 phút.' }, req);
          return true;
        }
        const user = users.find(item => (
          String(item.username || '').toLowerCase() === identifier ||
          (item.email && String(item.email || '').toLowerCase() === identifier)
        ) && item.active);

        if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) {
          attempt.count += 1;
          if (attempt.count >= 5) { attempt.blockedUntil = Date.now() + 15 * 60 * 1000; attempt.count = 0; }
          loginAttempts.set(attemptKey, attempt);
          send(res, 401, { error: 'Tên đăng nhập/email hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa.' }, req);
          return true;
        }
        loginAttempts.delete(attemptKey);
        if (!user.passwordHash.startsWith('scrypt$131072$8$1$')) {
          user.passwordHash = hashPassword(String(body.password));
          await saveUsers(users);
        }
        const token = crypto.randomBytes(32).toString('base64url');
        sessions.set(token, { userId: user.id, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
        saveSessionsToDisk();
        const secure = Boolean(req.socket.encrypted) || req.headers['x-forwarded-proto'] === 'https';
        res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure ? '; Secure' : ''}`);
        send(res, 200, { user: publicUser(user) }, req);
        return true;
      }

      if (req.method === 'POST' && pathname === '/auth/logout') {
        const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
        if (token) {
          sessions.delete(token);
          saveSessionsToDisk();
        }
        send(res, 200, { ok: true }, req, true);
        return true;
      }

      if (req.method === 'POST' && pathname === '/auth/forgot-password') {
        const identifier = String(body.email || '').trim().toLowerCase();
        if (!identifier) {
          send(res, 400, { error: 'Vui lòng nhập địa chỉ email hoặc tên đăng nhập của bạn.' }, req);
          return true;
        }

        const rateKey = `${req.socket.remoteAddress || 'unknown'}:${identifier}`;
        const rate = recoveryAttempts.get(rateKey) || { count: 0, blockedUntil: 0 };
        if (rate.blockedUntil > Date.now()) {
          send(res, 429, { error: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.' }, req);
          return true;
        }
        rate.count += 1;
        if (rate.count >= 10) { rate.count = 0; rate.blockedUntil = Date.now() + 5 * 60 * 1000; }
        recoveryAttempts.set(rateKey, rate);

        const user = users.find(item => item.active && (
          (item.email && String(item.email).toLowerCase() === identifier) ||
          String(item.username || '').toLowerCase() === identifier
        ));

        if (!user || !emailValid(user.email)) {
          send(res, 404, { error: 'Không tìm thấy tài khoản đang hoạt động nào khớp với email này.' }, req);
          return true;
        }

        const token = createToken();
        const otpCode = generateOTP();
        await saveOTP(user.email, otpCode, 'reset-password');

        user.resetTokenHash = token.hash;
        user.resetCodeHash = hashTokenValue(otpCode);
        user.resetExpiresAt = Date.now() + OTP_TTL_MS;
        await saveUsers(users);

        await sendOTPEmail(user.email, otpCode, 'reset-password');
        const maskedEmail = user.email.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => `${a}${'*'.repeat(Math.min(5, Math.max(2, b.length)))}${c}`);

        send(res, 200, {
          ok: true,
          email: user.email,
          maskedEmail,
          expiresInSeconds: 300,
          message: `Đã gửi mã xác thực OTP (6 chữ số, hiệu lực 5 phút) tới hộp thư ${maskedEmail}. Vui lòng kiểm tra email.`
        }, req);
        return true;
      }

      if (req.method === 'POST' && pathname === '/auth/reset-password') {
        const rawToken = String(body.token || '').trim();
        const rawCode = String(body.code || '').trim();
        const rawEmail = String(body.email || '').trim().toLowerCase();
        const newPassword = String(body.newPassword || '');

        if (!passwordValid(newPassword)) {
          send(res, 400, { error: 'Mật khẩu mới phải có từ 10 ký tự trở lên (tối đa 128 byte).' }, req);
          return true;
        }

        let user = null;
        if (rawCode) {
          const targetUser = users.find(item =>
            item.active && (
              !rawEmail ||
              String(item.email || '').toLowerCase() === rawEmail ||
              String(item.username || '').toLowerCase() === rawEmail
            )
          );
          if (targetUser && targetUser.email) {
            const otpResult = await verifyAndConsumeOTP(targetUser.email, rawCode, 'reset-password');
            if (otpResult.valid) {
              user = targetUser;
            } else {
              const codeHash = hashTokenValue(rawCode);
              if (targetUser.resetCodeHash === codeHash && targetUser.resetExpiresAt > Date.now()) {
                user = targetUser;
              } else {
                send(res, 400, { error: otpResult.reason || 'Mã OTP không hợp lệ hoặc đã hết hạn (5 phút).' }, req);
                return true;
              }
            }
          }
        } else if (rawToken) {
          const tokenHash = hashTokenValue(rawToken);
          user = users.find(item => item.resetTokenHash && item.resetTokenHash === tokenHash && item.resetExpiresAt > Date.now());
        }

        if (!user) {
          send(res, 400, { error: 'Mã OTP hoặc liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn (5 phút).' }, req);
          return true;
        }

        user.passwordHash = hashPassword(newPassword);
        user.emailVerified = true;
        delete user.resetTokenHash;
        delete user.resetCodeHash;
        delete user.resetExpiresAt;
        await saveUsers(users);

        for (const [sessionToken, session] of sessions) {
          if (session.userId === user.id) sessions.delete(sessionToken);
        }

        if (user.email) {
          const subject = 'Mật khẩu TaskMaster của bạn đã được cập nhật';
          const text = `Xin chào ${user.name || user.username},\n\nMật khẩu tài khoản TaskMaster (${user.username}) của bạn vừa được thay đổi thành công.\nNếu bạn không thực hiện thao tác này, vui lòng liên hệ Quản trị viên ngay lập tức.`;
          const html = buildHtmlEmail({
            title: 'Mật khẩu đã được thay đổi',
            greeting: `Xin chào ${user.name || user.username},`,
            bodyLines: [
              `Mật khẩu cho tài khoản "${user.username}" trên hệ thống TaskMaster vừa được đặt lại thành công.`,
              'Bây giờ bạn có thể đăng nhập bằng mật khẩu mới.'
            ],
            actionText: 'Đăng nhập ngay',
            actionUrl: `${appUrl}/login.html`,
            footerNote: 'Nếu bạn không thực hiện thay đổi này, vui lòng liên hệ quản trị viên ngay lập tức.'
          });
          void sendAccountEmail({ to: user.email, subject, text, html, actionUrl: `${appUrl}/login.html` })
            .catch(error => console.error('Could not send password change notice:', error.message));
        }

        send(res, 200, { ok: true, message: 'Đã cập nhật mật khẩu mới thành công! Đang chuyển hướng về trang đăng nhập...' }, req);
        return true;
      }

      if (req.method === 'POST' && pathname === '/auth/verify-email') {
        const rawToken = String(body.token || '').trim();
        const rawCode = String(body.code || '').trim();
        const current = sessionUser(req, users);

        let user = null;
        if (rawCode && current && current.email) {
          const otpResult = await verifyAndConsumeOTP(current.email, rawCode, 'verify-email');
          if (otpResult.valid) {
            user = users.find(item => item.id === current.id);
          } else {
            const codeHash = hashTokenValue(rawCode);
            if (current.emailVerifyCodeHash === codeHash && current.emailVerifyExpiresAt > Date.now()) {
              user = users.find(item => item.id === current.id);
            } else {
              send(res, 400, { error: otpResult.reason || 'Mã OTP không hợp lệ hoặc đã hết hạn (5 phút).' }, req);
              return true;
            }
          }
        } else if (rawToken) {
          const tokenHash = hashTokenValue(rawToken);
          user = users.find(item => item.emailVerifyTokenHash && item.emailVerifyTokenHash === tokenHash && item.emailVerifyExpiresAt > Date.now());
        } else if (rawCode) {
          const codeHash = hashTokenValue(rawCode);
          user = users.find(item => item.emailVerifyCodeHash && item.emailVerifyCodeHash === codeHash && item.emailVerifyExpiresAt > Date.now());
          if (user && user.email) {
            await verifyAndConsumeOTP(user.email, rawCode, 'verify-email');
          }
        }

        if (!user) {
          send(res, 400, { error: 'Mã xác thực OTP không hợp lệ hoặc đã hết hạn (5 phút).' }, req);
          return true;
        }

        user.emailVerified = true;
        delete user.emailVerifyTokenHash;
        delete user.emailVerifyCodeHash;
        delete user.emailVerifyExpiresAt;
        await saveUsers(users);
        send(res, 200, {
          ok: true,
          message: 'Xác thực OTP thành công! Địa chỉ email đã được xác minh (emailVerified = true) và mã OTP cũ đã được xóa.',
          user: publicUser(user)
        }, req);
        return true;
      }

      const current = sessionUser(req, users);
      if (req.method === 'GET' && pathname === '/auth/me') {
        send(res, current ? 200 : 401, current ? { user: publicUser(current) } : { error: 'Chưa đăng nhập.' }, req);
        return true;
      }
      if (!current) {
        send(res, 401, { error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' }, req);
        return true;
      }

      if (req.method === 'GET' && pathname === '/auth/users') {
        const visibleUsers = users.map(user => {
          const safe = publicUser(user);
          if (current.role !== 'admin' && user.id !== current.id) {
            delete safe.email;
            delete safe.phone;
            delete safe.emailVerified;
          }
          return safe;
        });
        send(res, 200, visibleUsers, req);
        return true;
      }

      if (req.method === 'POST' && pathname === '/auth/users') {
        if (current.role !== 'admin') { send(res, 403, { error: 'Bạn không có quyền tạo tài khoản.' }, req); return true; }
        const username = String(body.username || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const phone = String(body.phone || '').trim();
        if (!usernameValid(username) || users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
          send(res, 400, { error: 'Tên đăng nhập không hợp lệ hoặc đã được sử dụng.' }, req);
          return true;
        }
        if (!emailValid(email) || users.some(user => String(user.email || '').toLowerCase() === email)) {
          send(res, 400, { error: 'Địa chỉ email không hợp lệ hoặc đã được sử dụng bởi tài khoản khác.' }, req);
          return true;
        }
        if (!phoneValid(phone)) { send(res, 400, { error: 'Số điện thoại không hợp lệ.' }, req); return true; }
        if (!passwordValid(body.password)) { send(res, 400, { error: 'Mật khẩu phải có ít nhất 10 ký tự và không quá 128 byte.' }, req); return true; }
        if (!['user', 'manager'].includes(body.role)) { send(res, 400, { error: 'Vai trò không hợp lệ.' }, req); return true; }
        const user = {
          id: `user_${crypto.randomUUID()}`,
          name: String(body.name || '').trim(),
          username,
          email,
          phone,
          emailVerified: false,
          role: body.role,
          active: true,
          passwordHash: hashPassword(body.password)
        };
        if (user.name.length < 2 || user.name.length > 100) {
          send(res, 400, { error: 'Họ và tên phải có từ 2 đến 100 ký tự.' }, req);
          return true;
        }
        users.push(user);
        await saveUsers(users);
        void issueVerificationForUser(user, users, appUrl).catch(err => console.error('Could not send welcome verification email:', err.message));
        send(res, 201, publicUser(user), req);
        return true;
      }

      if (req.method === 'PUT' && pathname.startsWith('/auth/users/')) {
        const id = decodeURIComponent(pathname.slice('/auth/users/'.length));
        const index = users.findIndex(user => user.id === id);
        if (index < 0) { send(res, 404, { error: 'Không tìm thấy tài khoản.' }, req); return true; }
        const target = users[index];
        const previousAvatar = target.avatar || '';
        const previousCoverImage = target.coverImage || '';
        if (current.id !== target.id && current.role !== 'admin') { send(res, 403, { error: 'Bạn không có quyền chỉnh sửa tài khoản này.' }, req); return true; }
        const allowed = current.role === 'admin' && current.id !== target.id
          ? ['active', 'emailVerified']
          : ['name', 'avatar', 'avatarCrop', 'coverImage', 'birthDate', 'hobbies', 'email', 'phone'];

        let emailChangedTo = '';
        for (const field of allowed) {
          if (!Object.hasOwn(body, field)) continue;
          if (field === 'active' && typeof body.active !== 'boolean') {
            send(res, 400, { error: 'Trạng thái hoạt động không hợp lệ.' }, req);
            return true;
          }
          if (field === 'emailVerified' && typeof body.emailVerified === 'boolean') {
            target.emailVerified = body.emailVerified;
            continue;
          }
          if (field === 'email') {
            const email = String(body.email || '').trim().toLowerCase();
            if (!emailValid(email) || users.some(user => user.id !== target.id && String(user.email || '').toLowerCase() === email)) {
              send(res, 400, { error: 'Vui lòng nhập địa chỉ email hợp lệ và chưa được sử dụng.' }, req);
              return true;
            }
            const previousEmail = String(target.email || '').toLowerCase();
            if (email !== previousEmail) {
              if (body.currentPassword && !verifyPassword(String(body.currentPassword || ''), target.passwordHash)) {
                send(res, 400, { error: 'Mật khẩu hiện tại không đúng.' }, req);
                return true;
              }
              const oldEmail = target.email;
              target.email = email;
              target.emailVerified = false;
              delete target.emailVerifyTokenHash;
              delete target.emailVerifyCodeHash;
              delete target.emailVerifyExpiresAt;
              emailChangedTo = email;
              if (oldEmail) {
                const noticeHtml = buildHtmlEmail({
                  title: 'Thông báo thay đổi địa chỉ Email',
                  greeting: `Xin chào ${target.name || target.username},`,
                  bodyLines: [
                    `Địa chỉ email gắn với tài khoản "${target.username}" vừa được đổi từ ${oldEmail} sang ${email}.`,
                    'Nếu bạn không thực hiện thay đổi này, vui lòng liên hệ Quản trị viên ngay lập tức.'
                  ]
                });
                void sendAccountEmail({
                  to: oldEmail,
                  subject: 'Địa chỉ email tài khoản TaskMaster đã thay đổi',
                  text: `Địa chỉ email tài khoản ${target.username} đã được đổi sang ${email}.`,
                  html: noticeHtml
                }).catch(error => console.error('Could not send email change notice:', error.message));
              }
            }
          } else if (field === 'phone') {
            const phone = String(body.phone || '').trim();
            if (!phoneValid(phone)) { send(res, 400, { error: 'Số điện thoại không hợp lệ (7–20 chữ số).' }, req); return true; }
            target.phone = phone;
          } else if (field === 'avatarCrop') {
            const crop = body.avatarCrop;
            if (crop === null) {
              delete target.avatarCrop;
              continue;
            }
            if (!crop || !Number.isFinite(Number(crop.x)) || !Number.isFinite(Number(crop.y)) || !Number.isFinite(Number(crop.zoom)) || Math.abs(Number(crop.x)) > 100 || Math.abs(Number(crop.y)) > 100 || Number(crop.zoom) < 1 || Number(crop.zoom) > 3) {
              send(res, 400, { error: 'Thông số căn chỉnh ảnh đại diện không hợp lệ.' }, req);
              return true;
            }
            target.avatarCrop = { x: Number(crop.x), y: Number(crop.y), zoom: Number(crop.zoom) };
          } else if (field === 'avatar' && body.avatar === null) {
            delete target.avatar;
          } else if (field === 'coverImage') {
            if (body.coverImage === null || body.coverImage === '') {
              delete target.coverImage;
            } else {
              target.coverImage = String(body.coverImage);
            }
          } else {
            target[field] = body[field];
          }
        }
        if (typeof target.name !== 'string' || target.name.trim().length < 2 || target.name.length > 100) {
          send(res, 400, { error: 'Tên hiển thị phải có từ 2 đến 100 ký tự.' }, req);
          return true;
        }
        users[index] = target;
        await saveUsers(users);
        if (previousAvatar && previousAvatar !== (target.avatar || '')) {
          await deleteUploadedAssetIfUnused(previousAvatar, users);
        }
        if (previousCoverImage && previousCoverImage !== (target.coverImage || '')) {
          await deleteUploadedAssetIfUnused(previousCoverImage, users);
        }

        if (emailChangedTo) {
          try {
            await issueVerificationForUser(target, users, appUrl);
          } catch (error) {
            console.error('Could not auto-send verification email:', error.message);
          }
        }

        send(res, 200, publicUser(target), req);
        return true;
      }

      if (req.method === 'POST' && pathname === '/auth/request-email-verification') {
        if (!emailValid(current.email)) {
          send(res, 400, { error: 'Vui lòng cập nhật địa chỉ email hợp lệ vào hồ sơ trước khi xác minh.' }, req);
          return true;
        }
        if (current.emailVerified) {
          send(res, 200, { ok: true, alreadyVerified: true, message: 'Địa chỉ email của bạn đã được xác minh.' }, req);
          return true;
        }
        const cooldownMs = process.env.NODE_ENV === 'production' ? 60 * 1000 : 10 * 1000;
        const lastSent = verificationAttempts.get(current.id) || 0;
        if (Date.now() - lastSent < cooldownMs) {
          const waitSec = Math.ceil((cooldownMs - (Date.now() - lastSent)) / 1000);
          send(res, 429, { error: `Vui lòng đợi ${waitSec} giây trước khi yêu cầu gửi lại email xác minh.` }, req);
          return true;
        }
        verificationAttempts.set(current.id, Date.now());
        await issueVerificationForUser(current, users, appUrl);

        send(res, 200, {
          ok: true,
          message: `Đã gửi mã xác thực OTP (6 chữ số, hiệu lực 5 phút) tới ${current.email}. Vui lòng kiểm tra hộp thư.`
        }, req);
        return true;
      }

      if (req.method === 'POST' && pathname === '/auth/deadline-reminder') {
        const taskId = String(body.taskId || '').trim();
        const taskTitle = String(body.taskTitle || 'Công việc').trim();
        const deadline = String(body.deadline || '').trim();
        const daysLeftText = String(body.daysLeftText || 'Sắp đến hạn').trim();
        const message = String(body.message || '').trim();
        const recipientId = String(body.recipientId || '').trim();

        if (!message) {
          send(res, 400, { error: 'Vui lòng nhập nội dung lời nhắn nhắc hạn.' }, req);
          return true;
        }

        const recipient = users.find(u => u.id === recipientId && u.active) || current;
        const taskUrl = taskId ? `${appUrl}/task-detail.html?id=${encodeURIComponent(taskId)}` : appUrl;

        const delivery = await sendDeadlineReminderEmail({
          toEmail: recipient?.email || '',
          recipientName: recipient?.name || recipient?.username || 'Bạn',
          senderName: current.name || current.username,
          taskTitle,
          deadline,
          daysLeftText,
          message,
          taskUrl
        });

        send(res, 200, {
          ok: true,
          delivered: delivery.delivered,
          mode: delivery.mode,
          message: `Đã gửi form nhắn nhắc hạn cho ${recipient?.name || 'người nhận'}.`
        }, req);
        return true;
      }

      if (req.method === 'POST' && pathname === '/auth/change-password') {
        if (!verifyPassword(String(body.currentPassword || ''), current.passwordHash)) {
          send(res, 400, { error: 'Mật khẩu hiện tại không đúng.' }, req);
          return true;
        }
        if (!passwordValid(body.newPassword)) {
          send(res, 400, { error: 'Mật khẩu mới phải có ít nhất 10 ký tự và không quá 128 byte.' }, req);
          return true;
        }
        current.passwordHash = hashPassword(body.newPassword);
        await saveUsers(users);
        send(res, 200, { ok: true, message: 'Đã cập nhật mật khẩu thành công.' }, req);
        return true;
      }

      send(res, 404, { error: 'Không tìm thấy đường dẫn yêu cầu.' }, req);
      return true;
    } catch (error) {
      if (!res.headersSent) send(res, 500, { error: error.message || 'Lỗi dịch vụ xác thực.' }, req);
      else res.destroy();
      return true;
    }
  };
}

module.exports = { migrateUsers, createAuthHandler };

if (process.argv.includes('--migrate')) {
  migrateUsers().catch(error => { console.error(error.message); process.exitCode = 1; });
}
