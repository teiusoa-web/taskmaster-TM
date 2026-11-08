import { Auth } from './auth.js';

document.getElementById('forgot-password-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  const message = document.getElementById('forgot-message');
  button.disabled = true;
  try {
    const result = await Auth.forgotPassword(new FormData(event.currentTarget).get('email'));
    message.textContent = result.message;
  } catch {
    message.textContent = 'Khong the xu ly yeu cau. Vui long thu lai sau.';
  } finally { button.disabled = false; }
});
