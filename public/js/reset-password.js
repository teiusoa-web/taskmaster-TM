import { Auth } from './auth.js';

const form = document.getElementById('reset-password-form');
const token = new URLSearchParams(window.location.search).get('token') || '';
form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(form);
  const message = document.getElementById('reset-message');
  const button = form.querySelector('[type="submit"]');
  if (!token) { message.textContent = 'Lien ket dat lai mat khau khong hop le.'; return; }
  if (data.get('newPassword') !== data.get('confirmPassword')) { message.textContent = 'Mat khau nhap lai khong khop.'; return; }
  button.disabled = true;
  try {
    await Auth.resetPassword(token, data.get('newPassword'));
    message.textContent = 'Da doi mat khau. Ban co the dang nhap lai.';
    form.reset();
    setTimeout(() => { window.location.href = 'login.html'; }, 1200);
  } catch (error) {
    message.textContent = error.message || 'Lien ket da het han hoac khong hop le.';
    button.disabled = false;
  }
});
