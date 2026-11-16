import { Auth } from './auth.js';
import { showToast } from './main.js';

const labels = { manager: 'Quản lý', user: 'Người dùng' };
const roleClass = { manager: 'role-manager', user: 'role-user' };

let searchQuery = '';
let roleFilter = 'all';
let userSelectSyncHandlers = [];
let userDropboxListenersBound = false;

document.addEventListener('DOMContentLoaded', async () => {
  setupUserCustomSelects();
  setupPasswordToggle();
  setupUserFilters();
  await Auth.loadUsers();
  if (!Auth.getCurrentUser()) { window.location.replace('login.html'); return; }
  if (!Auth.canManageUsers()) { window.location.replace('index.html'); return; }

  const form = document.getElementById('user-form');
  form?.addEventListener('submit', createUser);
  form?.addEventListener('reset', () => {
    requestAnimationFrame(() => {
      userSelectSyncHandlers.forEach(fn => fn());
      resetPasswordVisibility();
    });
  });
  renderUsers();
});

function closeUserDropboxes(exceptWrapper = null) {
  document.querySelectorAll('.custom-dropbox.is-open').forEach(box => {
    if (box === exceptWrapper) return;
    box.classList.remove('is-open');
    const trigger = box.querySelector('.custom-dropbox-trigger');
    const menu = box.querySelector('.custom-dropbox-menu');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (menu) menu.hidden = true;
  });
}

function setupUserCustomSelects() {
  const configs = [
    { id: 'user-role-select', block: true },
    { id: 'user-role-filter', block: false }
  ];

  if (!userDropboxListenersBound) {
    document.addEventListener('click', event => {
      if (!event.target.closest('.custom-dropbox')) closeUserDropboxes();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeUserDropboxes();
    });
    userDropboxListenersBound = true;
  }

  userSelectSyncHandlers = [];

  configs.forEach(({ id, block }) => {
    const select = document.getElementById(id);
    if (!select) return;

    select.classList.add('is-custom-hidden');
    let wrapper = select.nextElementSibling?.classList.contains('custom-dropbox')
      ? select.nextElementSibling
      : null;

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = `custom-dropbox${block ? ' is-block' : ''}`;
      wrapper.dataset.selectId = id;
      wrapper.innerHTML = `
        <button type="button" class="custom-dropbox-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="custom-dropbox-trigger-content">
            <span class="custom-dropbox-dot" aria-hidden="true" hidden></span>
            <span class="custom-dropbox-label"></span>
          </span>
          <svg class="custom-dropbox-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        <div class="custom-dropbox-menu" role="listbox" hidden></div>
      `;
      select.after(wrapper);
    }

    const trigger = wrapper.querySelector('.custom-dropbox-trigger');
    const triggerDot = wrapper.querySelector('.custom-dropbox-trigger .custom-dropbox-dot');
    const triggerLabel = wrapper.querySelector('.custom-dropbox-label');
    const menu = wrapper.querySelector('.custom-dropbox-menu');

    const syncFromSelect = () => {
      const options = Array.from(select.options);
      const selectedOption = options[select.selectedIndex] || options[0];
      const currentVal = selectedOption?.value ?? '';
      const dotColor = /^#[0-9a-f]{3,8}$/i.test(selectedOption?.dataset?.color || '') ? selectedOption.dataset.color : '';

      if (triggerLabel) triggerLabel.textContent = selectedOption?.textContent || '';
      if (triggerDot) {
        triggerDot.style.background = dotColor || '';
        triggerDot.hidden = !dotColor;
      }

      if (menu) {
        menu.innerHTML = options.map(opt => {
          const isSelected = opt.value === currentVal;
          const optColor = /^#[0-9a-f]{3,8}$/i.test(opt.dataset?.color || '') ? opt.dataset.color : '';
          const dotHtml = optColor
            ? `<span class="custom-dropbox-dot" style="background: ${escapeHtml(optColor)};" aria-hidden="true"></span>`
            : '';
          const checkHtml = isSelected
            ? '<svg class="custom-dropbox-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
            : '';
          return `
            <button type="button" class="custom-dropbox-option${isSelected ? ' is-selected' : ''}" role="option" aria-selected="${isSelected}" data-value="${escapeHtml(opt.value)}">
              <span class="custom-dropbox-option-main">${dotHtml}<span>${escapeHtml(opt.textContent)}</span></span>
              ${checkHtml}
            </button>
          `;
        }).join('');

        menu.querySelectorAll('.custom-dropbox-option').forEach(optBtn => {
          optBtn.addEventListener('click', () => {
            const nextVal = optBtn.dataset.value ?? '';
            const changed = select.value !== nextVal;
            select.value = nextVal;
            closeUserDropboxes();
            syncFromSelect();
            if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
          });
        });
      }
    };

    syncFromSelect();
    userSelectSyncHandlers.push(syncFromSelect);

    if (!select.dataset.userDropboxBound) {
      trigger?.addEventListener('click', () => {
        const willOpen = !wrapper.classList.contains('is-open');
        closeUserDropboxes(willOpen ? wrapper : null);
        wrapper.classList.toggle('is-open', willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (menu) menu.hidden = !willOpen;
      });
      select.addEventListener('change', syncFromSelect);
      select.dataset.userDropboxBound = 'true';
    }
  });
}

function resetPasswordVisibility() {
  const input = document.getElementById('user-password-input');
  const toggleBtn = document.getElementById('toggle-user-password');
  if (!input || !toggleBtn) return;
  input.type = 'password';
  toggleBtn.setAttribute('aria-pressed', 'false');
  toggleBtn.setAttribute('aria-label', 'Hiện mật khẩu');
  const eyeOpen = toggleBtn.querySelector('.eye-open-icon');
  const eyeClosed = toggleBtn.querySelector('.eye-closed-icon');
  if (eyeOpen) eyeOpen.hidden = false;
  if (eyeClosed) eyeClosed.hidden = true;
}

function setupPasswordToggle() {
  const input = document.getElementById('user-password-input');
  const toggleBtn = document.getElementById('toggle-user-password');
  if (!input || !toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    toggleBtn.setAttribute('aria-pressed', String(reveal));
    toggleBtn.setAttribute('aria-label', reveal ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    const eyeOpen = toggleBtn.querySelector('.eye-open-icon');
    const eyeClosed = toggleBtn.querySelector('.eye-closed-icon');
    if (eyeOpen) eyeOpen.hidden = reveal;
    if (eyeClosed) eyeClosed.hidden = !reveal;
  });
}

function setupUserFilters() {
  const searchInput = document.getElementById('user-search-input');
  const filterSelect = document.getElementById('user-role-filter');

  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderUsers();
  });

  filterSelect?.addEventListener('change', () => {
    roleFilter = filterSelect.value || 'all';
    renderUsers();
  });
}

async function createUser(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const users = Auth.getUsers();
  const username = data.get('username').trim();
  const email = data.get('email').trim().toLowerCase();
  const phone = data.get('phone').trim();
  const role = data.get('role');
  if (!['user', 'manager'].includes(role)) {
    showToast('Chỉ có thể tạo tài khoản người dùng hoặc quản lý.', 'error');
    return;
  }
  if (users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
    showToast('Tên đăng nhập này đã được sử dụng.', 'error');
    return;
  }
  if (users.some(user => String(user.email || '').toLowerCase() === email)) {
    showToast('Email này đã được sử dụng.', 'error');
    return;
  }
  users.push({ id: `pending_${crypto.randomUUID()}`, name: data.get('name').trim(), username, email, phone, password: data.get('password'), role, active: true });
  if (!await Auth.saveUsers(users)) {
    showToast(Auth.lastError || 'Không thể lưu tài khoản vào database.', 'error');
    return;
  }
  event.currentTarget.reset();
  userSelectSyncHandlers.forEach(fn => fn());
  resetPasswordVisibility();
  renderUsers();
  showToast('Tạo tài khoản thành công và đã gửi email xác minh.', 'success');
}

function getInitials(user) {
  const raw = String(user?.name || user?.username || '?').trim();
  return raw.split(/\s+/).map(part => part[0]).slice(-2).join('').toUpperCase() || '?';
}

function renderUsers() {
  const allManageableUsers = Auth.getUsers().filter(user => user.role !== 'admin');
  document.getElementById('user-count').textContent = `${allManageableUsers.length} tài khoản`;

  const users = allManageableUsers.filter(user => {
    const matchRole = roleFilter === 'all' || user.role === roleFilter;
    const matchSearch = !searchQuery || [user.name, user.username, user.email, user.phone].some(field =>
      String(field || '').toLowerCase().includes(searchQuery)
    );
    return matchRole && matchSearch;
  });

  const tbody = document.getElementById('users-table-body');
  if (!users.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center" style="padding: 36px 20px; color: var(--text-muted);">
          ${searchQuery || roleFilter !== 'all' ? 'Không tìm thấy tài khoản phù hợp với bộ lọc hiện tại.' : 'Chưa có tài khoản người dùng nào.'}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = users.map(user => {
    const initials = getInitials(user);
    const hasPhoto = Boolean(user.avatar);
    const avatarHtml = `<span class="assignee-avatar${hasPhoto ? ' has-photo' : ''}" data-tooltip="${escapeHtml(`${user.name} (@${user.username})`)}">${
      hasPhoto ? `<img src="${escapeHtml(user.avatar)}" alt="${escapeHtml(user.name || '')}">` : escapeHtml(initials)
    }</span>`;
    return `
      <tr>
        <td>
          <button type="button" class="user-identity-cell" data-user-profile-id="${escapeHtml(user.id)}" title="Nhấn để xem thông tin chi tiết">
            ${avatarHtml}
            <span class="user-identity-meta">
              <strong>${escapeHtml(user.name)}</strong>
              <small>@${escapeHtml(user.username)}</small>
            </span>
          </button>
        </td>
        <td>
          <div class="user-contact-cell">
            <span>${escapeHtml(user.email || '—')}</span>
            ${user.phone ? `<small class="user-phone-sub">${escapeHtml(user.phone)}</small>` : ''}
            ${user.email ? `<span class="badge ${user.emailVerified ? 'badge-status-completed' : 'badge-status-pending'}">${user.emailVerified ? 'Đã xác minh' : 'Chưa xác minh'}</span>` : ''}
          </div>
        </td>
        <td><span class="role-badge ${roleClass[user.role]}">${labels[user.role]}</span></td>
        <td><span class="status-dot ${user.active ? 'is-active' : 'is-inactive'}">${user.active ? 'Đang hoạt động' : 'Đã khóa'}</span></td>
        <td style="text-align: right;">
          <div class="action-btns" style="justify-content: flex-end;">
            ${user.email && !user.emailVerified ? `<button type="button" class="btn btn-secondary btn-sm" data-verify-user="${escapeHtml(user.id)}">Xác minh email</button>` : ''}
            <button type="button" class="btn btn-secondary btn-sm" data-toggle-user="${escapeHtml(user.id)}">${user.active ? 'Khóa' : 'Mở khóa'}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  document.querySelectorAll('[data-toggle-user]').forEach(button => button.addEventListener('click', async () => {
    const target = allManageableUsers.find(user => user.id === button.dataset.toggleUser);
    if (!target) return;
    target.active = !target.active;
    const saved = await Auth.saveUsers(Auth.getUsers().map(user => user.id === target.id ? target : user));
    if (!saved) { showToast(Auth.lastError || 'Không thể cập nhật tài khoản trong database.', 'error'); return; }
    renderUsers();
    showToast(target.active ? 'Đã mở khóa tài khoản.' : 'Đã khóa tài khoản.', 'success');
  }));

  document.querySelectorAll('[data-verify-user]').forEach(button => button.addEventListener('click', async () => {
    const target = allManageableUsers.find(user => user.id === button.dataset.verifyUser);
    if (!target) return;
    target.emailVerified = true;
    const saved = await Auth.saveUsers(Auth.getUsers().map(user => user.id === target.id ? target : user));
    if (!saved) { showToast(Auth.lastError || 'Không thể xác minh email tài khoản.', 'error'); return; }
    renderUsers();
    showToast(`Đã xác minh email cho tài khoản ${target.username}.`, 'success');
  }));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
