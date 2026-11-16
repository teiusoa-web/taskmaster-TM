import { Auth } from './auth.js';

const form = document.getElementById('reset-password-form');
const params = new URLSearchParams(window.location.search);
const token = params.get('token') || '';
const presetEmail = params.get('email') || '';
const manualCodeFields = document.getElementById('manual-code-fields');
const resetEmailInput = document.getElementById('reset-email');
const resetCodeInput = document.getElementById('reset-code');
const resetSubtitle = document.getElementById('reset-subtitle');
const message = document.getElementById('reset-message');
const submitBtn = document.getElementById('reset-submit-btn');

if (presetEmail && resetEmailInput) {
  resetEmailInput.value = presetEmail;
}

if (!token) {
  manualCodeFields.hidden = false;
  resetEmailInput.required = true;
  resetCodeInput.required = true;
  resetSubtitle.textContent = 'Nhập địa chỉ email, mã xác nhận (OTP) 6 chữ số và mật khẩu mới của bạn.';
} else if (presetEmail) {
  resetSubtitle.textContent = `Thiết lập mật khẩu mới cho tài khoản ${presetEmail}.`;
}

function setAlert(text, type = 'info') {
  if (!text) {
    message.hidden = true;
    message.textContent = '';
    message.className = 'auth-alert';
    return;
  }
  message.hidden = false;
  message.className = `auth-alert is-${type}`;
  message.textContent = text;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(form);
  const newPassword = String(data.get('newPassword') || '');
  const confirmPassword = String(data.get('confirmPassword') || '');
  const email = String(data.get('email') || presetEmail || '').trim();
  const code = String(data.get('code') || '').trim();

  if (!token && (!email || code.length !== 6)) {
    setAlert('Vui lòng nhập đầy đủ email và mã xác nhận gồm 6 chữ số.', 'error');
    return;
  }
  if (newPassword.length < 10) {
    setAlert('Mật khẩu mới phải có ít nhất 10 ký tự.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    setAlert('Mật khẩu nhập lại không khớp.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang cập nhật...';
  setAlert('');

  try {
    const res = await Auth.resetPassword({ token, email, code, newPassword });
    setAlert(res.message || 'Đã đổi mật khẩu thành công! Đang chuyển hướng về trang đăng nhập...', 'success');
    form.reset();
    history.replaceState(null, '', window.location.pathname);
    setTimeout(() => {
      window.location.href = 'login.html';
    }, 1200);
  } catch (error) {
    setAlert(error.message || 'Liên kết hoặc mã xác nhận đã hết hạn hoặc không hợp lệ.', 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Cập nhật mật khẩu';
  }
});
