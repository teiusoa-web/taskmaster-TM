const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');

dotenv.config();

const dataDir = path.join(process.cwd(), 'data');
const otpStorePath = path.join(dataDir, 'otps.json');
const OTP_TTL_MS = 5 * 60 * 1000; // 5 phút theo đúng quy trình chuẩn

/**
 * 1. Hàm tạo mã OTP 6 chữ số ngẫu nhiên
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Đọc danh sách OTP đang lưu tạm thời trong Database (data/otps.json)
 */
async function readOtpStore() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const raw = await fs.promises.readFile(otpStorePath, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Ghi danh sách OTP vào Database (data/otps.json)
 */
async function writeOtpStore(list) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmpPath = `${otpStorePath}.tmp`;
  await fs.promises.writeFile(tmpPath, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  await fs.promises.rename(tmpPath, otpStorePath);
}

/**
 * 2. Lưu trữ tạm thời mã OTP kèm email và thời gian hết hạn (5 phút) vào Database
 */
async function saveOTP(email, otpCode, purpose = 'verify-email') {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const now = Date.now();
  const expiresAt = now + OTP_TTL_MS;

  let store = await readOtpStore();
  // Xóa các mã OTP đã hết hạn hoặc mã cũ của cùng email + mục đích
  store = store.filter(item => item.expiresAt > now && !(item.email === normalizedEmail && item.purpose === purpose));

  const record = {
    email: normalizedEmail,
    otpCode: String(otpCode).trim(),
    purpose,
    createdAt: now,
    expiresAt
  };

  store.push(record);
  await writeOtpStore(store);
  return record;
}

/**
 * 3. Cấu hình Nodemailer với Gmail và gửi mã OTP đến hòm thư của người dùng
 */
function createGmailTransporter(customConfig = null) {
  dotenv.config({ override: true });
  const host = String(customConfig?.host || process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(customConfig?.port || process.env.SMTP_PORT) || 587;
  const user = String(customConfig?.user || process.env.SMTP_USER || '').trim();
  let pass = String(customConfig?.pass ?? process.env.SMTP_PASSWORD ?? '').trim();

  // Tự động loại bỏ khoảng trắng trong Mật khẩu ứng dụng (App Password) 16 ký tự của Gmail
  if (host.toLowerCase().includes('gmail')) {
    pass = pass.replace(/\s+/g, '');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true cho port 465, false cho port 587
    auth: {
      user,
      pass
    }
  });
}

function hasValidSmtpCredentials() {
  dotenv.config({ override: true });
  const host = String(process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASSWORD || '').trim();
  return Boolean(
    host &&
    host !== 'smtp.example.com' &&
    user &&
    user !== 'your-smtp-user' &&
    pass &&
    pass !== 'your-smtp-password'
  );
}

const sendOTPEmail = async (toEmail, otpCode, purpose = 'verify-email') => {
  dotenv.config({ override: true });
  const smtpUser = String(process.env.SMTP_USER || 'your-email@gmail.com').trim();
  const fromHeader = process.env.SMTP_FROM && process.env.SMTP_FROM !== 'TaskMaster <no-reply@example.com>'
    ? process.env.SMTP_FROM
    : `"TaskMaster Support" <${smtpUser}>`;

  const actionTitle = purpose === 'reset-password'
    ? 'Khôi phục mật khẩu tài khoản TaskMaster'
    : 'Xác thực địa chỉ Email tài khoản TaskMaster';

  const digitCellsHtml = String(otpCode)
    .split('')
    .map(d => `<span style="display:inline-block;width:44px;height:52px;line-height:52px;margin:0 4px;border-radius:10px;background:#ffffff;border:2px solid #6366f1;color:#4f46e5;font-size:24px;font-weight:800;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:center;box-shadow:0 2px 6px rgba(79,70,229,0.12);">${d}</span>`)
    .join('');

  const mailOptions = {
    from: fromHeader,
    to: toEmail,
    subject: `[TaskMaster] Mã xác thực OTP: ${otpCode}`,
    text: `Mã OTP của bạn là: ${otpCode}. Mã này có hiệu lực trong vòng 5 phút.`,
    html: `
      <div style="background:#f1f5f9;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 12px 32px rgba(15,23,42,0.08);">
          <div style="background:linear-gradient(135deg,#4f46e5 0%,#6366f1 100%);padding:26px 28px;color:#ffffff;text-align:center;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;opacity:0.9;margin-bottom:6px;">BẢO MẬT TÀI KHOẢN</div>
            <h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:-0.01em;">TaskMaster</h1>
          </div>
          <div style="padding:28px 28px 24px;color:#1e293b;">
            <p style="margin:0 0 8px;font-size:15px;color:#475569;">Xin chào,</p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">
              Bạn vừa yêu cầu <strong>${actionTitle}</strong>. Vui lòng nhập mã gồm 6 chữ số dưới đây để hoàn tất:
            </p>
            <div style="margin:22px 0;padding:22px 12px;background:#f8fafc;border:1px solid #e0e7ff;border-radius:14px;text-align:center;">
              <div style="margin-bottom:10px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6366f1;">MÃ XÁC THỰC OTP</div>
              <div>${digitCellsHtml}</div>
              <div style="margin-top:12px;font-size:13px;color:#64748b;">Thời hạn hiệu lực: <strong style="color:#4f46e5;">05 phút</strong></div>
            </div>
            <p style="margin:0;font-size:13px;line-height:1.5;color:#64748b;text-align:center;">
              Tuyệt đối không chia sẻ mã này cho bất kỳ ai. Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email này.
            </p>
          </div>
          <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8;">
            &copy; ${new Date().getFullYear()} TaskMaster &bull; Hệ thống quản lý công việc
          </div>
        </div>
      </div>
    `
  };

  let mode = 'dev';
  let delivered = false;
  let smtpError = '';

  if (hasValidSmtpCredentials()) {
    try {
      const transporter = createGmailTransporter();
      await transporter.sendMail(mailOptions);
      delivered = true;
      mode = 'smtp';
      console.info(`[TaskMaster OTP] Đã gửi OTP (${otpCode}) từ ${smtpUser} -> ${toEmail}`);
    } catch (error) {
      smtpError = error.message;
      console.error(`[TaskMaster OTP SMTP Error]: ${error.message}`);
    }
  }

  if (!delivered) {
    console.info(`\n========== [TaskMaster Mail Log] ==========\nFrom   : ${fromHeader}\nTo     : ${toEmail}\nPurpose: ${purpose}\nSubject: ${mailOptions.subject}\nOTP    : ${otpCode} (Hiệu lực: 5 phút)\n===========================================\n`);
  }

  try {
    const outboxPath = path.join(dataDir, 'mail-outbox.json');
    let outbox = [];
    try {
      outbox = JSON.parse(await fs.promises.readFile(outboxPath, 'utf8'));
      if (!Array.isArray(outbox)) outbox = [];
    } catch {
      outbox = [];
    }
    outbox.unshift({
      id: `mail_${Date.now()}`,
      createdAt: new Date().toISOString(),
      from: fromHeader,
      to: toEmail,
      purpose,
      subject: mailOptions.subject,
      code: otpCode,
      text: mailOptions.text,
      mode
    });
    await fs.promises.writeFile(outboxPath, `${JSON.stringify(outbox.slice(0, 50), null, 2)}\n`, 'utf8');
  } catch {
    // ignore log write failure
  }

  return {
    delivered,
    mode,
    ...(smtpError ? { smtpError } : {}),
    otpCode,
    expiresInSeconds: 300
  };
};

/**
 * 4. Xác thực mã OTP:
 * - Kiểm tra mã có trùng khớp không?
 * - Kiểm tra mã đã hết hạn (5 phút) chưa?
 * - Nếu hợp lệ thì xóa mã OTP cũ khỏi Database và trả về { valid: true }
 */
async function verifyAndConsumeOTP(email, inputOtp, purpose = 'verify-email') {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedCode = String(inputOtp || '').trim();
  const now = Date.now();

  const store = await readOtpStore();
  const record = store.find(item =>
    item.email === normalizedEmail &&
    item.purpose === purpose &&
    item.otpCode === normalizedCode
  );

  if (!record) {
    return { valid: false, reason: 'Mã OTP không chính xác hoặc không tồn tại.' };
  }

  if (record.expiresAt <= now) {
    // Xóa mã đã hết hạn
    const cleaned = store.filter(item => item !== record && item.expiresAt > now);
    await writeOtpStore(cleaned);
    return { valid: false, reason: 'Mã OTP đã hết hạn (quá 5 phút). Vui lòng yêu cầu gửi mã mới.' };
  }

  // Hợp lệ -> Xóa mã OTP cũ khỏi Database ngay lập tức
  const remaining = store.filter(item => item !== record && item.expiresAt > now);
  await writeOtpStore(remaining);
  return { valid: true, email: normalizedEmail };
}

/**
 * 5. Gửi Email form nhắn nhắc hạn công việc
 */
async function sendDeadlineReminderEmail({
  toEmail,
  recipientName = 'Bạn',
  senderName = 'Hệ thống TaskMaster',
  taskTitle = '',
  deadline = '',
  daysLeftText = 'Sắp đến hạn',
  message = '',
  taskUrl = ''
}) {
  dotenv.config({ override: true });
  const smtpUser = String(process.env.SMTP_USER || 'your-email@gmail.com').trim();
  const fromHeader = process.env.SMTP_FROM && process.env.SMTP_FROM !== 'TaskMaster <no-reply@example.com>'
    ? process.env.SMTP_FROM
    : `"TaskMaster Support" <${smtpUser}>`;

  const subject = `[TaskMaster] Nhắc hạn công việc: ${taskTitle} (${daysLeftText})`;
  const text = `Xin chào ${recipientName},\n\n${senderName} vừa gửi lời nhắn nhắc hạn cho công việc "${taskTitle}" (Hạn hoàn thành: ${deadline} - ${daysLeftText}):\n\n"${message}"\n\nXem chi tiết tại: ${taskUrl}`;

  const mailOptions = {
    from: fromHeader,
    to: toEmail,
    subject,
    text,
    html: `
      <div style="background:#f1f5f9;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 12px 32px rgba(15,23,42,0.08);">
          <div style="background:linear-gradient(135deg,#f59e0b 0%,#ea580c 100%);padding:24px 28px;color:#ffffff;">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;opacity:0.92;margin-bottom:6px;">NHẮC HẠN HOÀN THÀNH CÔNG VIỆC</div>
            <h1 style="margin:0;font-size:20px;font-weight:800;line-height:1.35;">${taskTitle}</h1>
          </div>
          <div style="padding:26px 28px 24px;color:#1e293b;">
            <p style="margin:0 0 12px;font-size:15px;color:#334155;">Xin chào <strong>${recipientName}</strong>,</p>
            <p style="margin:0 0 16px;font-size:14.5px;line-height:1.6;color:#475569;">
              <strong>${senderName}</strong> đã gửi một lời nhắn nhắc nhở đối với công việc sắp đến hạn hoàn thành:
            </p>
            <div style="margin:0 0 18px;padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;font-size:13.5px;color:#92400e;">
              <div><strong>Hạn chót:</strong> ${deadline} &bull; <strong style="color:#d97706;">${daysLeftText}</strong></div>
            </div>
            <div style="margin:0 0 22px;padding:16px 18px;background:#f8fafc;border-left:4px solid #4f46e5;border-radius:10px;font-size:14.5px;line-height:1.6;color:#1e293b;white-space:pre-wrap;">${message}</div>
            ${taskUrl ? `<div style="text-align:center;margin:20px 0 8px;"><a href="${taskUrl}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;">Mở xem công việc ngay</a></div>` : ''}
          </div>
          <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8;">
            &copy; ${new Date().getFullYear()} TaskMaster &bull; Hệ thống quản lý công việc
          </div>
        </div>
      </div>
    `
  };

  let mode = 'dev';
  let delivered = false;
  if (hasValidSmtpCredentials() && toEmail) {
    try {
      const transporter = createGmailTransporter();
      await transporter.sendMail(mailOptions);
      delivered = true;
      mode = 'smtp';
      console.info(`[TaskMaster Reminder] Đã gửi mail nhắc hạn tới: ${toEmail}`);
    } catch (error) {
      console.error(`[TaskMaster Reminder SMTP Error]: ${error.message}`);
    }
  }

  if (!delivered) {
    console.info(`\n========== [TaskMaster Deadline Reminder] ==========\nTo      : ${toEmail || '(in-app only)'}\nTask    : ${taskTitle} (${deadline} - ${daysLeftText})\nFrom    : ${senderName}\nMessage : ${message}\n====================================================\n`);
  }

  try {
    const outboxPath = path.join(dataDir, 'mail-outbox.json');
    let outbox = [];
    try {
      outbox = JSON.parse(await fs.promises.readFile(outboxPath, 'utf8'));
      if (!Array.isArray(outbox)) outbox = [];
    } catch {
      outbox = [];
    }
    outbox.unshift({
      id: `mail_${Date.now()}`,
      createdAt: new Date().toISOString(),
      from: fromHeader,
      to: toEmail || '',
      purpose: 'deadline-reminder',
      subject,
      text,
      mode
    });
    await fs.promises.writeFile(outboxPath, `${JSON.stringify(outbox.slice(0, 50), null, 2)}\n`, 'utf8');
  } catch {
    // ignore log write failure
  }

  return { delivered, mode };
}

module.exports = {
  OTP_TTL_MS,
  generateOTP,
  saveOTP,
  sendOTPEmail,
  verifyAndConsumeOTP,
  sendDeadlineReminderEmail,
  createGmailTransporter,
  hasValidSmtpCredentials
};

