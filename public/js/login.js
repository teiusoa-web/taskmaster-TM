import { Auth } from './auth.js';

await Auth.loadUsers();
if (Auth.getCurrentUser()) window.location.replace('index.html');

document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('[type="submit"]');
  const error = document.getElementById('login-error');
  button.disabled = true;
  error.textContent = '';
  if (await Auth.login(data.get('username'), data.get('password'))) window.location.href = 'index.html';
  else {
    error.textContent = 'Tên đăng nhập hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa.';
    button.disabled = false;
  }
});
