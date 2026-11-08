import { Auth } from './auth.js';
import { showToast } from './main.js';

const labels = { manager: 'Qu\u1ea3n l\u00fd', user: 'Ng\u01b0\u1eddi d\u00f9ng' };
const roleClass = { manager: 'role-manager', user: 'role-user' };

document.addEventListener('DOMContentLoaded', async () => {
  await Auth.loadUsers();
  if (!Auth.getCurrentUser()) { window.location.replace('login.html'); return; }
  if (!Auth.canManageUsers()) { window.location.replace('index.html'); return; }
  document.getElementById('user-form').addEventListener('submit', createUser);
  renderUsers();
});

async function createUser(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const users = Auth.getUsers();
  const username = data.get('username').trim();
  const email = data.get('email').trim().toLowerCase();
  const phone = data.get('phone').trim();
  const role = data.get('role');
  if (!['user', 'manager'].includes(role)) {
    showToast('Ch\u1ec9 c\u00f3 th\u1ec3 t\u1ea1o t\u00e0i kho\u1ea3n ng\u01b0\u1eddi d\u00f9ng ho\u1eb7c qu\u1ea3n l\u00fd.', 'error');
    return;
  }
  if (users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
    showToast('T\u00ean \u0111\u0103ng nh\u1eadp n\u00e0y \u0111\u00e3 \u0111\u01b0\u1ee3c s\u1eed d\u1ee5ng.', 'error');
    return;
  }
  if (users.some(user => String(user.email || '').toLowerCase() === email)) {
    showToast('Email này đã được sử dụng.', 'error');
    return;
  }
  users.push({ id: `pending_${crypto.randomUUID()}`, name: data.get('name').trim(), username, email, phone, password: data.get('password'), role, active: true });
  if (!await Auth.saveUsers(users)) { showToast('Không thể lưu tài khoản vào database.', 'error'); return; }
  event.currentTarget.reset();
  renderUsers();
  showToast('T\u1ea1o t\u00e0i kho\u1ea3n th\u00e0nh c\u00f4ng.', 'success');
}

function renderUsers() {
  // Keep all admin accounts out of this screen, including the signed-in admin.
  const users = Auth.getUsers().filter(user => user.role !== 'admin');
  document.getElementById('user-count').textContent = `${users.length} t\u00e0i kho\u1ea3n`;
  document.getElementById('users-table-body').innerHTML = users.map(user => `
    <tr>
      <td><strong>${escapeHtml(user.name)}</strong></td>
      <td>${escapeHtml(user.username)}</td>
      <td><span class="role-badge ${roleClass[user.role]}">${labels[user.role]}</span></td>
      <td><span class="status-dot ${user.active ? 'is-active' : 'is-inactive'}">${user.active ? '\u0110ang ho\u1ea1t \u0111\u1ed9ng' : '\u0110\u00e3 kh\u00f3a'}</span></td>
      <td><button class="btn btn-secondary btn-sm" data-toggle-user="${user.id}">${user.active ? 'Kh\u00f3a' : 'M\u1edf kh\u00f3a'}</button></td>
    </tr>`).join('');
  document.querySelectorAll('[data-toggle-user]').forEach(button => button.addEventListener('click', async () => {
    const target = users.find(user => user.id === button.dataset.toggleUser);
    if (!target) return;
    target.active = !target.active;
    const saved = await Auth.saveUsers(Auth.getUsers().map(user => user.id === target.id ? target : user));
    if (!saved) { showToast('Không thể cập nhật tài khoản trong database.', 'error'); return; }
    renderUsers();
    showToast(target.active ? '\u0110\u00e3 m\u1edf kh\u00f3a t\u00e0i kho\u1ea3n.' : '\u0110\u00e3 kh\u00f3a t\u00e0i kho\u1ea3n.', 'success');
  }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
