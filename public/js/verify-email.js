import { Auth } from './auth.js';

const token = new URLSearchParams(window.location.search).get('token') || '';
const message = document.getElementById('verify-message');
const otpForm = document.getElementById('verify-otp-form');
const otpInput = document.getElementById('verify-code-input');
const otpSubmit = document.getElementById('verify-otp-submit');
const otpDigitBoxes = Array.from(otpForm?.querySelectorAll('.otp-digit-box') || []);

function setStatus(text, type = 'info') {
  message.className = `auth-alert is-${type}`;
  message.textContent = text;
}

function syncVerifyDigits() {
  const code = otpDigitBoxes.map(box => box.value.replace(/\D/g, '')).join('');
  if (otpInput) otpInput.value = code;
  otpDigitBoxes.forEach(box => box.classList.toggle('is-filled', Boolean(box.value)));
  return code;
}

otpDigitBoxes.forEach((box, idx) => {
  box.addEventListener('input', event => {
    const val = event.target.value.replace(/\D/g, '');
    event.target.value = val.slice(-1);
    syncVerifyDigits();
    if (event.target.value && idx < otpDigitBoxes.length - 1) {
      otpDigitBoxes[idx + 1].focus();
    }
  });
  box.addEventListener('keydown', event => {
    if (event.key === 'Backspace' && !box.value && idx > 0) {
      otpDigitBoxes[idx - 1].value = '';
      syncVerifyDigits();
      otpDigitBoxes[idx - 1].focus();
    } else if (event.key === 'ArrowLeft' && idx > 0) {
      otpDigitBoxes[idx - 1].focus();
    } else if (event.key === 'ArrowRight' && idx < otpDigitBoxes.length - 1) {
      otpDigitBoxes[idx + 1].focus();
    }
  });
  box.addEventListener('paste', event => {
    event.preventDefault();
    const digits = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    digits.split('').forEach((ch, i) => {
      if (otpDigitBoxes[i]) otpDigitBoxes[i].value = ch;
    });
    syncVerifyDigits();
    const targetIdx = Math.min(digits.length, otpDigitBoxes.length - 1);
    otpDigitBoxes[targetIdx]?.focus();
  });
});

if (token) {
  try {
    const res = await Auth.verifyEmail(token);
    setStatus(res.message || 'Email đã được xác minh thành công! Bạn có thể dùng email này để đăng nhập và khôi phục mật khẩu.', 'success');
    history.replaceState(null, '', window.location.pathname);
  } catch (error) {
    setStatus(error.message || 'Liên kết xác minh đã hết hạn hoặc không hợp lệ. Bạn có thể nhập mã OTP 6 chữ số bên dưới.', 'error');
    otpForm.hidden = false;
    otpDigitBoxes[0]?.focus();
  }
} else {
  setStatus('Nhập mã xác minh gồm 6 chữ số (OTP) đã được gửi tới email của bạn.', 'info');
  otpForm.hidden = false;
  otpDigitBoxes[0]?.focus();
}

otpForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const code = syncVerifyDigits();
  if (code.length !== 6) {
    setStatus('Vui lòng nhập đủ 6 chữ số của mã OTP.', 'error');
    const firstEmpty = otpDigitBoxes.find(box => !box.value) || otpDigitBoxes[0];
    firstEmpty?.focus();
    return;
  }
  const btnSpan = otpSubmit.querySelector('span') || otpSubmit;
  otpSubmit.disabled = true;
  btnSpan.textContent = 'Đang xác minh...';
  try {
    const res = await Auth.verifyEmail({ code });
    setStatus(res.message || 'Email đã được xác minh thành công!', 'success');
    otpForm.hidden = true;
  } catch (error) {
    setStatus(error.message || 'Mã xác minh không hợp lệ hoặc đã hết hạn.', 'error');
    otpSubmit.disabled = false;
    btnSpan.textContent = 'Xác nhận mã OTP';
  }
});
