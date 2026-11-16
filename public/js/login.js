import { Auth } from './auth.js';

// Đánh thức backend Render sớm trong nền ngay khi mở trang đăng nhập
fetch('/health', { cache: 'no-store' }).catch(() => {});

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

document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const button = document.getElementById('login-submit-btn') || event.currentTarget.querySelector('[type="submit"]');
  const label = document.getElementById('login-submit-label');
  button.disabled = true;
  if (label) label.textContent = 'Đang đăng nhập...';
  errorEl.textContent = '';

  if (await Auth.login(data.get('username'), data.get('password'))) {
    window.location.href = 'index.html';
  } else {
    errorEl.textContent = Auth.lastError || 'Tên đăng nhập hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa.';
    button.disabled = false;
    if (label) label.textContent = 'Đăng nhập';
  }
});
