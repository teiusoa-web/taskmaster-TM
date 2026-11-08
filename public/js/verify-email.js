import { Auth } from './auth.js';

const token = new URLSearchParams(window.location.search).get('token') || '';
const message = document.getElementById('verify-message');
if (!token) message.textContent = 'Lien ket xac minh khong hop le.';
else {
  try {
    await Auth.verifyEmail(token);
    message.textContent = 'Email da xac minh. Email nay co the dung de dang nhap va khoi phuc mat khau.';
    history.replaceState(null, '', window.location.pathname);
  } catch (error) {
    message.textContent = error.message || 'Lien ket da het han hoac khong hop le.';
  }
}
