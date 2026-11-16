import { Auth } from './auth.js';
import { warmUpBackend } from './api-config.js';

// Đánh thức backend Render sớm trong nền ngay khi mở trang đăng nhập
warmUpBackend();

await Auth.loadUsers();
if (Auth.getCurrentUser()) window.location.replace('index.html');

const passwordInput = document.getElementById('password');
const togglePasswordBtn = document.getElementById('toggle-password-btn');
const errorEl = document.getElementById('login-error');

if (togglePasswordBtn && passwordInput) {
  const eyeOpen = togglePasswordBtn.querySelector('.eye-open-icon');
  const eyeClosed = togglePasswordBtn.querySelector('.eye-closed-icon');
  togglePasswordBtn.addEventListener('click', () => {
    const reveal = passwordInput.type === 'password';
    passwordInput.type = reveal ? 'text' : 'password';
    togglePasswordBtn.setAttribute('aria-pressed', String(reveal));
    togglePasswordBtn.setAttribute('aria-label', reveal ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    if (eyeOpen) eyeOpen.hidden = reveal;
    if (eyeClosed) eyeClosed.hidden = !reveal;
  });
}

const loginForm = document.getElementById('login-form');
const retryBox = document.getElementById('login-retry-box');
const retryBtn = document.getElementById('login-retry-btn');

async function submitLogin() {
  const data = new FormData(loginForm);
  const button = document.getElementById('login-submit-btn') || loginForm.querySelector('[type="submit"]');
  const label = document.getElementById('login-submit-label');
  button.disabled = true;
  if (label) label.textContent = 'Đang đăng nhập...';
  errorEl.textContent = '';
  if (retryBox) retryBox.hidden = true;

  const coldStartNoticeId = window.setTimeout(() => {
    if (button.disabled && label) {
      label.textContent = 'Đang đánh thức máy chủ...';
    }
  }, 4000);

  try {
    if (await Auth.login(data.get('username'), data.get('password'))) {
      window.location.href = 'index.html';
      return;
    }
    const errText = Auth.lastError || 'Tên đăng nhập hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa.';
    errorEl.textContent = errText;
    if (retryBox && /khởi động|phản hồi chậm|Cold Start/i.test(errText)) {
      retryBox.hidden = false;
    }
  } finally {
    window.clearTimeout(coldStartNoticeId);
    button.disabled = false;
    if (label) label.textContent = 'Đăng nhập';
  }
}

loginForm.addEventListener('submit', event => {
  event.preventDefault();
  submitLogin();
});

retryBtn?.addEventListener('click', () => {
  warmUpBackend();
  submitLogin();
});
