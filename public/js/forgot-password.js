import { Auth } from './auth.js';

const forgotForm = document.getElementById('forgot-password-form');
const emailInput = document.getElementById('email');
const forgotMessage = document.getElementById('forgot-message');
const forgotSubmitBtn = document.getElementById('forgot-submit-btn');
const otpResetForm = document.getElementById('otp-reset-form');
const otpCodeInput = document.getElementById('otp-code');
const otpResetMessage = document.getElementById('otp-reset-message');
const otpResetSubmit = document.getElementById('otp-reset-submit');
const otpResendBtn = document.getElementById('otp-resend-btn');
const otpTargetEmailLabel = document.getElementById('otp-target-email-label');
const otpTimerBadge = document.getElementById('forgot-otp-timer');
const stepPill1 = document.getElementById('step-pill-1');
const stepPill2 = document.getElementById('step-pill-2');
const otpDigitBoxes = Array.from(otpResetForm?.querySelectorAll('.otp-digit-box') || []);

let activeAccountEmail = '';
let countdownInterval = null;

function setAlert(element, text, type = 'info') {
  if (!element) return;
  if (!text) {
    element.hidden = true;
    element.textContent = '';
    element.className = 'auth-alert';
    return;
  }
  element.hidden = false;
  element.className = `auth-alert is-${type}`;
  element.textContent = text;
}

function startCountdown(seconds = 300) {
  if (countdownInterval) clearInterval(countdownInterval);
  if (!otpTimerBadge) return;
  let remaining = seconds;
  otpTimerBadge.classList.remove('is-expired');
  const render = () => {
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    otpTimerBadge.textContent = `${m}:${s}`;
  };
  render();
  countdownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      otpTimerBadge.textContent = 'Hết hạn';
      otpTimerBadge.classList.add('is-expired');
      return;
    }
    render();
  }, 1000);
}

function syncOtpDigits() {
  const code = otpDigitBoxes.map(box => box.value.replace(/\D/g, '')).join('');
  if (otpCodeInput) otpCodeInput.value = code;
  otpDigitBoxes.forEach(box => box.classList.toggle('is-filled', Boolean(box.value)));
  return code;
}

function clearOtpDigits() {
  otpDigitBoxes.forEach(box => {
    box.value = '';
    box.classList.remove('is-filled');
  });
  if (otpCodeInput) otpCodeInput.value = '';
}

otpDigitBoxes.forEach((box, idx) => {
  box.addEventListener('input', event => {
    const val = event.target.value.replace(/\D/g, '');
    event.target.value = val.slice(-1);
    syncOtpDigits();
    if (event.target.value && idx < otpDigitBoxes.length - 1) {
      otpDigitBoxes[idx + 1].focus();
    }
  });
  box.addEventListener('keydown', event => {
    if (event.key === 'Backspace' && !box.value && idx > 0) {
      otpDigitBoxes[idx - 1].value = '';
      syncOtpDigits();
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
    syncOtpDigits();
    const targetIdx = Math.min(digits.length, otpDigitBoxes.length - 1);
    otpDigitBoxes[targetIdx]?.focus();
  });
});

async function requestForgotOtp(identifier) {
  const btnSpan = forgotSubmitBtn.querySelector('span') || forgotSubmitBtn;
  forgotSubmitBtn.disabled = true;
  btnSpan.textContent = 'Đang gửi mã OTP...';
  setAlert(forgotMessage, '');
  setAlert(otpResetMessage, '');

  try {
    const result = await Auth.forgotPassword(identifier);
    activeAccountEmail = result.email || identifier;
    if (otpTargetEmailLabel) {
      otpTargetEmailLabel.textContent = `Mã OTP đã gửi tới ${result.maskedEmail || activeAccountEmail}`;
    }
    stepPill1?.classList.add('is-done');
    stepPill2?.classList.add('is-active');
    clearOtpDigits();
    otpResetForm.hidden = false;
    startCountdown(result.expiresInSeconds || 300);
    otpDigitBoxes[0]?.focus();
  } catch (error) {
    setAlert(forgotMessage, error.message || 'Không thể xử lý yêu cầu. Vui lòng kiểm tra lại email.', 'error');
  } finally {
    forgotSubmitBtn.disabled = false;
    btnSpan.textContent = 'Gửi lại mã xác thực OTP';
  }
}

forgotForm.addEventListener('submit', async event => {
  event.preventDefault();
  const identifier = emailInput.value.trim();
  if (!identifier) return;
  await requestForgotOtp(identifier);
});

otpResendBtn?.addEventListener('click', async () => {
  const identifier = activeAccountEmail || emailInput.value.trim();
  if (!identifier) return;
  await requestForgotOtp(identifier);
});

otpResetForm.addEventListener('submit', async event => {
  event.preventDefault();
  const code = syncOtpDigits();
  const data = new FormData(otpResetForm);
  const newPassword = String(data.get('newPassword') || '');
  const confirmPassword = String(data.get('confirmPassword') || '');

  if (code.length !== 6) {
    setAlert(otpResetMessage, 'Vui lòng nhập đủ 6 chữ số của mã OTP.', 'error');
    const firstEmpty = otpDigitBoxes.find(box => !box.value) || otpDigitBoxes[0];
    firstEmpty?.focus();
    return;
  }
  if (newPassword.length < 10) {
    setAlert(otpResetMessage, 'Mật khẩu mới phải có ít nhất 10 ký tự.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    setAlert(otpResetMessage, 'Mật khẩu nhập lại không khớp.', 'error');
    return;
  }

  const btnSpan = otpResetSubmit.querySelector('span') || otpResetSubmit;
  otpResetSubmit.disabled = true;
  btnSpan.textContent = 'Đang cập nhật...';
  setAlert(otpResetMessage, '');

  try {
    const res = await Auth.resetPassword({
      email: activeAccountEmail || emailInput.value.trim(),
      code,
      newPassword
    });
    if (countdownInterval) clearInterval(countdownInterval);
    setAlert(otpResetMessage, res.message || 'Đã đặt lại mật khẩu thành công! Đang chuyển về trang đăng nhập...', 'success');
    otpResetForm.reset();
    clearOtpDigits();
    setTimeout(() => {
      window.location.href = 'login.html';
    }, 1200);
  } catch (error) {
    setAlert(otpResetMessage, error.message || 'Mã OTP không hợp lệ hoặc đã hết hạn (5 phút).', 'error');
    otpResetSubmit.disabled = false;
    btnSpan.textContent = 'Xác nhận đổi mật khẩu';
  }
});
