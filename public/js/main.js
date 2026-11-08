import { Auth } from './auth.js';
import { applyAvatarCrop } from './uploads.js';
import { Notifications } from './notifications.js';
import { Storage } from './storage.js';
// main.js - Xử lý thanh điều hướng, Toast Notification, Modal xác nhận dùng chung (ES6+)

/**
 * Hiển thị thông báo Toast góc màn hình (success, error, warning)
 * @param {string} message 
 * @param {'success'|'error'|'warning'} type 
 * @param {number} duration 
 */
export const showToast = (message, type = 'success', duration = 3000) => {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const iconPaths = {
    success: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12l4 4L19 6"/>',
    error: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6l12 12M18 6L6 18"/>',
    warning: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.3 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.7 3.86a2 2 0 00-3.4 0z"/>'
  };
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = iconPaths[type] || iconPaths.success;
  const iconWrapper = document.createElement('strong');
  iconWrapper.append(icon);
  const messageText = document.createElement('span');
  messageText.textContent = message;
  toast.append(iconWrapper, messageText);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
};

/**
 * Hiển thị Modal xác nhận hành động (VD: Xóa dữ liệu - thỏa mãn mục 17)
 * @param {string} title 
 * @param {string} message 
 * @param {Function} onConfirm 
 */
export const showConfirmModal = (title, message, onConfirm) => {
  let modalOverlay = document.getElementById('confirm-modal');
  if (!modalOverlay) {
    modalOverlay = document.createElement('div');
    modalOverlay.id = 'confirm-modal';
    modalOverlay.className = 'modal-overlay';
    modalOverlay.innerHTML = `
      <div class="modal-card">
        <h3 class="modal-title" id="modal-title">Xác nhận</h3>
        <p class="modal-body" id="modal-desc"></p>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-btn-cancel">Hủy bỏ</button>
          <button class="btn btn-danger" id="modal-btn-confirm">Đồng ý</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalOverlay);
  }

  const titleElem = document.getElementById('modal-title');
  const descElem = document.getElementById('modal-desc');
  const cancelBtn = document.getElementById('modal-btn-cancel');
  const confirmBtn = document.getElementById('modal-btn-confirm');

  titleElem.textContent = title;
  descElem.textContent = message;

  modalOverlay.classList.add('active');

  const closeModal = () => {
    modalOverlay.classList.remove('active');
    cancelBtn.onclick = null;
    confirmBtn.onclick = null;
  };

  cancelBtn.onclick = () => closeModal();
  confirmBtn.onclick = () => {
    closeModal();
    if (typeof onConfirm === 'function') {
      onConfirm();
    }
  };
};

function setupPageTransitionLoader() {
  const loader = document.createElement('div');
  loader.className = 'page-transition-loader';
  loader.setAttribute('role', 'status');
  loader.setAttribute('aria-label', 'Đang chuyển trang');
  loader.innerHTML = '<span class="page-transition-spinner"></span>';
  document.body.append(loader);

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.closest('.sidebar')) return;
    if (link.target && link.target !== '_self' || link.hasAttribute('download')) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || `${url.pathname}${url.search}${url.hash}` === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    loader.classList.add('is-visible');
    window.setTimeout(() => loader.classList.remove('is-visible'), 1200);
  });

  const clearLoader = () => loader.classList.remove('is-visible');
  window.addEventListener('pageshow', clearLoader);
  window.addEventListener('popstate', clearLoader);
}

// Khởi chạy khi tài liệu HTML tải xong
document.addEventListener('DOMContentLoaded', async () => {
  setupPageTransitionLoader();
  try {
    Auth.init();
    await Auth.loadUsers();
  } catch (error) {
    console.error('Could not initialize the user session.', error);
  }
  const currentUser = Auth.getCurrentUser();
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.body.classList.remove('auth-pending');
  if (!currentUser && currentPage !== 'login.html') { window.location.replace('login.html'); return; }
  if (currentUser && currentPage === 'login.html') { window.location.replace('index.html'); return; }
  if (!currentUser) return;
  Notifications.initUI();
  Storage.init().then(() => {
    document.body.dataset.apiReady = Storage.isApiAvailable() ? 'true' : 'false';
    if (!Storage.isApiAvailable()) showToast('Không kết nối được API. Dữ liệu đang dùng cache riêng của trình duyệt.', 'warning', 6000);
  });
  const roleLabels = { admin: 'Qu\u1ea3n tr\u1ecb vi\u00ean', manager: 'Qu\u1ea3n l\u00fd', user: 'Ng\u01b0\u1eddi d\u00f9ng' };
  const roleNav = document.querySelector('.sidebar-nav');
  if (roleNav) {
    const icon = path => `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${path}"/></svg>`;
    const items = [
      { href: 'index.html', label: 'Dashboard Thống Kê', path: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1-1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
      { href: 'tasks.html', label: 'Danh sách công việc', path: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
      ...(Auth.canCreateTask() ? [{ href: 'task-form.html', label: currentUser.role === 'user' ? 'Gửi yêu cầu công việc' : 'Thêm mới công việc', path: 'M12 4v16m8-8H4' }] : []),
      ...(Auth.canManageCategories() ? [{ href: 'categories.html', label: 'Quản lý danh mục', path: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' }] : []),
      { href: 'my-tasks.html', label: 'Việc của tôi', path: 'M9 5h10M9 12h10M9 19h10M4 5h.01M4 12h.01M4 19h.01' },
      ...(Auth.canManageUsers() ? [{ href: 'users.html', label: 'Quản lý tài khoản', path: 'M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2m6-10a4 4 0 100-8 4 4 0 000 8zm8-3v6m3-3h-6' }] : []),
      { href: 'my-calendar.html', label: 'Lịch tuần', path: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 012 2v14H3V6a2 2 0 012-2z' }
    ];
    roleNav.replaceChildren(...items.map(item => {
      const link = document.createElement('a');
      link.href = item.href;
      link.className = 'nav-link';
      link.innerHTML = `${icon(item.path)}${item.label}`;
      return link;
    }));
  }
  document.querySelectorAll('.brand-icon').forEach(el => el.textContent = 'TM');
  if (currentUser.role === 'user') document.querySelectorAll('.btn-quick-add span').forEach(el => { el.textContent = '+ Gửi yêu cầu công việc'; });
  document.querySelectorAll('.author-info h4').forEach(el => el.textContent = currentUser.name);
  document.querySelectorAll('.author-info p').forEach(el => el.textContent = roleLabels[currentUser.role]);
  document.querySelectorAll('.avatar').forEach(el => {
    el.replaceChildren();
    if (currentUser.avatar) {
      const image = document.createElement('img');
      image.src = currentUser.avatar;
      image.alt = '';
      applyAvatarCrop(image, currentUser.avatarCrop);
      image.addEventListener('error', () => {
        if (!image.isConnected) return;
        el.replaceChildren();
        el.textContent = String(currentUser.name || currentUser.username).trim().split(/\s+/).map(word => word[0]).slice(-2).join('').toUpperCase();
        el.classList.remove('has-profile-photo');
      }, { once: true });
      el.append(image);
      el.classList.add('has-profile-photo');
    } else {
      el.textContent = currentUser.name.split(/\s+/).map(word => word[0]).slice(-2).join('').toUpperCase();
      el.classList.remove('has-profile-photo');
    }
  });
  document.querySelectorAll('.author-card').forEach(card => {
    if (card.closest('a')) return;
    const accountLink = document.createElement('a');
    accountLink.href = 'account.html';
    accountLink.className = `${card.className} account-card-link`;
    accountLink.setAttribute('aria-label', 'Xem th\u00f4ng tin t\u00e0i kho\u1ea3n c\u1ee7a t\u00f4i');
    while (card.firstChild) accountLink.append(card.firstChild);
    card.replaceWith(accountLink);
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-logout]')) {
      event.preventDefault();
      if (window.confirm('B\u1ea1n c\u00f3 mu\u1ed1n \u0111\u0103ng xu\u1ea5t kh\u00f4ng?')) Auth.logout();
    }
  });
  document.querySelectorAll('.sidebar-footer').forEach(footer => {
    const accountCard = footer.querySelector('.author-card, .account-card-link');
    if (accountCard && !accountCard.parentElement.classList.contains('account-card-shell')) {
      const shell = document.createElement('div');
      shell.className = 'account-card-shell';
      accountCard.replaceWith(shell);
      shell.append(accountCard);
    }
    const accountShell = footer.querySelector('.account-card-shell');
    if (accountShell && !accountShell.querySelector('.account-hover-card')) {
      const preview = document.createElement('div');
      preview.className = 'account-hover-card';
      preview.setAttribute('role', 'tooltip');
      const previewName = document.createElement('strong');
      previewName.textContent = currentUser.name;
      const previewRole = document.createElement('span');
      previewRole.textContent = roleLabels[currentUser.role];
      const previewUsername = document.createElement('small');
      previewUsername.textContent = `@${currentUser.username}`;
      preview.append(previewName, previewRole, previewUsername);
      if (currentUser.role === 'user') {
        const previewUserCode = document.createElement('small');
        previewUserCode.textContent = `M\u00e3 s\u1ed1 ng\u01b0\u1eddi d\u00f9ng: ${currentUser.id}`;
        preview.append(previewUserCode);
      }
      accountShell.append(preview);
    }
    if (footer.querySelector('[data-logout]')) return;
    const button = document.createElement('button'); button.type = 'button'; button.dataset.logout = ''; button.className = 'sidebar-logout'; button.textContent = '\u0110\u0103ng xu\u1ea5t'; footer.append(button);
  });
  // Mobile sidebar toggle
  const mobileBtn = document.querySelector('.mobile-menu-btn');
  const sidebar = document.querySelector('.sidebar');
  if (mobileBtn && sidebar) {
    let backdrop = document.querySelector('.sidebar-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('button');
      backdrop.type = 'button';
      backdrop.className = 'sidebar-backdrop';
      backdrop.setAttribute('aria-label', '\u0110\u00f3ng menu');
      document.body.append(backdrop);
    }

    const closeMenu = () => {
      sidebar.classList.remove('open');
      backdrop.classList.remove('is-visible');
      mobileBtn.setAttribute('aria-expanded', 'false');
      mobileBtn.setAttribute('aria-label', 'M\u1edf menu');
      document.body.classList.remove('menu-open');
    };
    const openMenu = () => {
      sidebar.classList.add('open');
      backdrop.classList.add('is-visible');
      mobileBtn.setAttribute('aria-expanded', 'true');
      mobileBtn.setAttribute('aria-label', '\u0110\u00f3ng menu');
      document.body.classList.add('menu-open');
    };

    mobileBtn.setAttribute('aria-controls', 'app-sidebar');
    mobileBtn.setAttribute('aria-label', 'M\u1edf menu');
    mobileBtn.setAttribute('aria-expanded', 'false');
    sidebar.id = 'app-sidebar';
    mobileBtn.addEventListener('click', () => sidebar.classList.contains('open') ? closeMenu() : openMenu());
    backdrop.addEventListener('click', closeMenu);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
    window.addEventListener('resize', () => { if (window.innerWidth > 768) closeMenu(); });
  }

  // Đánh dấu active navigation link tự động dựa trên URL hiện tại
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (currentPage === href || (href === 'tasks.html' && currentPage.startsWith('tasks-'))) {
      link.classList.add('active');
    }
  });
});
