import { Auth } from './auth.js';
import { startKeepAlivePing } from './api-config.js';
import { applyAvatarCrop } from './uploads.js';
import { Notifications } from './notifications.js';
import { Storage } from './storage.js';
import { formatDate, getStatusMeta, isOverdue } from './utils.js';
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
  startKeepAlivePing();
  setupGlobalTopbar();
  Notifications.initUI();
  setupUserProfileViewer();
  Storage.init().then(() => {
    document.body.dataset.apiReady = Storage.isApiAvailable() ? 'true' : 'false';
    if (!Storage.isApiAvailable()) showToast('Không kết nối được API. Dữ liệu đang dùng cache riêng của trình duyệt.', 'warning', 6000);
    Notifications.checkAndPromptDeadlineTasks();
  });
  document.addEventListener('click', event => {
    const remindBtn = event.target.closest('[data-remind-task]');
    if (!remindBtn) return;
    event.preventDefault();
    event.stopPropagation();
    Notifications.openDeadlineReminderModal(remindBtn.dataset.remindTask);
  });
  const roleLabels = { admin: 'Qu\u1ea3n tr\u1ecb vi\u00ean', manager: 'Qu\u1ea3n l\u00fd', user: 'Ng\u01b0\u1eddi d\u00f9ng' };
  const roleNav = document.querySelector('.sidebar-nav');
  if (roleNav) {
    const icon = path => `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${path}"/></svg>`;
    const primaryItems = [
      { href: 'index.html', label: 'Dashboard Thống kê', path: 'M3 10.5 12 3l9 7.5M5.25 9v11h13.5V9M9 20v-6h6v6' },
      { href: 'tasks.html', label: 'Danh sách công việc', path: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
      { href: 'my-tasks.html', label: 'Việc của tôi', path: 'M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2m8-10a4 4 0 100-8 4 4 0 000 8z' },
      { href: 'my-calendar.html', label: 'Lịch tuần', path: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 012 2v14H3V6a2 2 0 012-2z' }
    ];
    const adminItems = [
      ...(Auth.canManageCategories() ? [{ href: 'categories.html', label: 'Quản lý danh mục', path: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' }] : []),
      ...(Auth.canManageUsers() ? [{ href: 'users.html', label: 'Quản lý tài khoản', path: 'M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2m6-10a4 4 0 100-8 4 4 0 000 8zm8-3v6m3-3h-6' }] : [])
    ];
    const buildNavGroup = (groupTitle, items) => {
      const group = document.createElement('div');
      group.className = 'sidebar-nav-group';
      const label = document.createElement('span');
      label.className = 'sidebar-group-label';
      label.textContent = groupTitle;
      group.append(label);
      items.forEach(item => {
        const link = document.createElement('a');
        link.href = item.href;
        link.className = 'nav-link';
        link.setAttribute('aria-label', item.label);
        link.innerHTML = `${icon(item.path)}<span class="nav-link-label">${item.label}</span>`;
        group.append(link);
      });
      return group;
    };
    const groups = [buildNavGroup('Tổng quan & Công việc', primaryItems)];
    if (adminItems.length) {
      groups.push(buildNavGroup('Quản trị & Quản lý', adminItems));
    }
    roleNav.replaceChildren(...groups);
  }
  const sidebarTooltip = document.createElement('div');
  sidebarTooltip.className = 'sidebar-icon-tooltip';
  sidebarTooltip.setAttribute('role', 'tooltip');
  sidebarTooltip.hidden = true;
  document.body.append(sidebarTooltip);
  const hideSidebarTooltip = () => {
    sidebarTooltip.hidden = true;
    sidebarTooltip.removeAttribute('data-visible');
  };
  const showSidebarTooltip = link => {
    if (document.documentElement.dataset.sidebarCollapsed !== 'true' || link.closest('.sidebar')?.dataset.hoverExpanded === 'true') return hideSidebarTooltip();
    const label = link.querySelector('.nav-link-label')?.textContent.trim() || link.getAttribute('aria-label') || link.title;
    if (!label) return hideSidebarTooltip();
    sidebarTooltip.textContent = label;
    sidebarTooltip.hidden = false;
    const rect = link.getBoundingClientRect();
    sidebarTooltip.style.left = `${rect.right + 10}px`;
    sidebarTooltip.style.top = `${rect.top + rect.height / 2}px`;
    sidebarTooltip.setAttribute('data-visible', 'true');
  };
  document.querySelector('.sidebar-nav')?.addEventListener('pointerover', event => {
    const link = event.target.closest('.nav-link');
    if (link) showSidebarTooltip(link);
  });
  document.querySelector('.sidebar-nav')?.addEventListener('pointerout', event => {
    if (event.target.closest('.nav-link') && !event.relatedTarget?.closest?.('.nav-link')) hideSidebarTooltip();
  });
  document.querySelector('.sidebar-nav')?.addEventListener('focusin', event => {
    const link = event.target.closest('.nav-link');
    if (link) showSidebarTooltip(link);
  });
  document.querySelector('.sidebar-nav')?.addEventListener('focusout', event => {
    if (event.target.closest('.nav-link') && !event.relatedTarget?.closest?.('.nav-link')) hideSidebarTooltip();
  });
  window.addEventListener('resize', hideSidebarTooltip);
  window.addEventListener('scroll', hideSidebarTooltip, true);
  document.querySelector('.sidebar')?.addEventListener('click', event => {
    if (event.target.closest('.sidebar-collapse-toggle')) hideSidebarTooltip();
  });
  const collapsibleSidebar = document.querySelector('.sidebar');
  if (collapsibleSidebar) {
    const brand = collapsibleSidebar.querySelector('.sidebar-brand');
    if (brand && !collapsibleSidebar.querySelector('.sidebar-collapse-toggle')) {
      const collapseButton = document.createElement('button');
      collapseButton.type = 'button';
      collapseButton.className = 'sidebar-collapse-toggle';
      collapseButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12"/></svg>';
      const applyCollapsedState = collapsed => {
        document.documentElement.dataset.sidebarCollapsed = String(collapsed);
        syncTransientExpandedState();
        collapseButton.setAttribute('aria-label', collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên');
        collapseButton.title = collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên';
      };
      let collapsed = document.documentElement.dataset.sidebarCollapsed === 'true';
      const syncTransientExpandedState = () => {
        const alreadyExpandedTransiently = collapsibleSidebar.dataset.hoverExpanded === 'true';
        const transientlyExpanded = collapsed && (
          collapseButton.matches(':hover, :focus-visible') ||
          (alreadyExpandedTransiently && collapsibleSidebar.matches(':hover, :focus-within'))
        );
        collapsibleSidebar.dataset.hoverExpanded = String(transientlyExpanded);
        collapseButton.setAttribute('aria-expanded', String(!collapsed || transientlyExpanded));
      };
      collapseButton.addEventListener('pointerenter', syncTransientExpandedState);
      collapseButton.addEventListener('focusin', syncTransientExpandedState);
      collapsibleSidebar.addEventListener('pointerleave', syncTransientExpandedState);
      collapsibleSidebar.addEventListener('focusout', () => requestAnimationFrame(syncTransientExpandedState));
      applyCollapsedState(collapsed);
      collapseButton.addEventListener('click', () => {
        collapsed = document.documentElement.dataset.sidebarCollapsed !== 'true';
        try { localStorage.setItem('DACK_SIDEBAR_HIDDEN', String(collapsed)); } catch {}
        applyCollapsedState(collapsed);
      });
      const sidebarTopbar = document.createElement('div');
      sidebarTopbar.className = 'sidebar-topbar';
      brand.before(sidebarTopbar);
      sidebarTopbar.append(brand, collapseButton);
    }
  }
  document.querySelectorAll('.brand-icon').forEach(el => {
    const logo = document.createElement('img');
    logo.src = `assets/taskmaster-logo-${document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'}.png?v=5`;
    logo.alt = '';
    logo.draggable = false;
    el.replaceChildren(logo);
  });
  document.querySelectorAll('.btn-quick-add').forEach(link => {
    const label = currentUser.role === 'user' ? 'Gửi yêu cầu việc' : 'Thêm mới công việc';
    link.setAttribute('aria-label', label);
    link.title = label;
    link.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="btn-quick-add-label">${label}</span>`;
  });
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
    const button = document.createElement('button'); button.type = 'button'; button.dataset.logout = ''; button.className = 'sidebar-logout'; button.setAttribute('aria-label', '\u0110\u0103ng xu\u1ea5t'); button.title = '\u0110\u0103ng xu\u1ea5t'; button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3m9-8h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/></svg><span class="sidebar-logout-label">\u0110\u0103ng xu\u1ea5t</span>'; footer.append(button);
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
    sidebar.id = 'app-sidebar';
    const syncMenuButton = () => {
      const expanded = window.innerWidth <= 768
        ? sidebar.classList.contains('open')
        : document.documentElement.dataset.sidebarCollapsed !== 'true';
      mobileBtn.setAttribute('aria-expanded', String(expanded));
      mobileBtn.setAttribute('aria-label', expanded ? 'Ẩn thanh điều hướng' : 'Hiện thanh điều hướng');
    };
    syncMenuButton();
    mobileBtn.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        sidebar.classList.contains('open') ? closeMenu() : openMenu();
        syncMenuButton();
        return;
      }
      const hidden = document.documentElement.dataset.sidebarCollapsed !== 'true';
      document.documentElement.dataset.sidebarCollapsed = String(hidden);
      try { localStorage.setItem('DACK_SIDEBAR_HIDDEN', String(hidden)); } catch {}
      syncMenuButton();
    });
    backdrop.addEventListener('click', closeMenu);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (window.innerWidth <= 768) {
        closeMenu();
        syncMenuButton();
      } else if (document.documentElement.dataset.sidebarCollapsed !== 'true') {
        document.documentElement.dataset.sidebarCollapsed = 'true';
        try { localStorage.setItem('DACK_SIDEBAR_HIDDEN', 'true'); } catch {}
        syncMenuButton();
      }
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) closeMenu();
      syncMenuButton();
    });
  }

  // Đánh dấu active navigation link tự động dựa trên URL hiện tại
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (currentPage === href || (href === 'tasks.html' && (currentPage.startsWith('tasks-') || currentPage === 'task-detail.html'))) {
      link.classList.add('active');
    }
  });
});

function setupGlobalTopbar() {
  const topbar = document.querySelector('.top-navbar');
  const shell = document.querySelector('.app-container');
  const main = document.querySelector('.main-wrapper');
  const left = topbar?.querySelector('.navbar-left');
  const right = topbar?.querySelector('.navbar-right') || topbar?.appendChild(document.createElement('div'));
  if (!topbar || !shell || !main || !left || !right || topbar.dataset.globalTopbar === 'true') return;

  topbar.dataset.globalTopbar = 'true';
  right.classList.add('navbar-right');
  const title = left.querySelector('.page-title');
  const menuButton = left.querySelector('.mobile-menu-btn');
  const themeToggle = right.querySelector('.theme-toggle');
  const pageActions = [...right.children].filter(action => action !== themeToggle);
  let quickAdd = pageActions.find(action => action.matches('.btn-quick-add'));
  if (!quickAdd && Auth.canCreateTask()) {
    quickAdd = document.createElement('a');
    quickAdd.className = 'btn-quick-add';
    quickAdd.href = 'task-form.html';
    quickAdd.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="btn-quick-add-label">Thêm mới công việc</span>';
  } else if (quickAdd) {
    quickAdd.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="btn-quick-add-label">Thêm mới công việc</span>';
  }
  left.replaceChildren();
  right.replaceChildren();

  const brand = document.createElement('a');
  brand.className = 'global-brand';
  brand.href = 'index.html';
  brand.draggable = false;
  brand.setAttribute('aria-label', 'TaskMaster - Trang chủ');
  brand.innerHTML = `<span class="global-brand-mark" aria-hidden="true"><img src="assets/taskmaster-logo-${document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'}.png?v=5" alt="" draggable="false"></span><span class="global-brand-name">Task<span>Master</span></span>`;
  if (menuButton) {
    menuButton.classList.add('sidebar-menu-toggle');
    menuButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>';
    menuButton.setAttribute('aria-label', 'Mở thanh điều hướng');
    left.append(menuButton);
  }
  left.append(brand);
  // Search Container in Topbar (Desktop)
  const searchContainer = document.createElement('div');
  searchContainer.className = 'topbar-search-container';
  searchContainer.innerHTML = `
    <form class="topbar-search" role="search" autocomplete="off">
      <span class="topbar-search-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>
        </svg>
      </span>
      <input type="search" name="q" placeholder="Tìm công việc..." aria-label="Tìm công việc" autocomplete="off">
      <kbd class="topbar-search-kbd" aria-hidden="true">Ctrl K</kbd>
      <button type="button" class="topbar-search-clear" aria-label="Xóa từ khóa" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </form>
    <div class="topbar-search-dropdown" hidden>
      <div class="search-dropdown-section search-live-section" hidden>
        <div class="search-dropdown-header">
          <span class="search-dropdown-label">Kết quả công việc</span>
          <a href="tasks.html" class="search-live-all-link">Xem tất cả</a>
        </div>
        <div class="search-live-results"></div>
      </div>
      <div class="search-dropdown-section">
        <span class="search-dropdown-label">Gợi ý lọc nhanh</span>
        <div class="search-quick-tags">
          <a href="tasks.html?status=all" class="search-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>Tất cả</a>
          <a href="tasks.html?status=in-progress" class="search-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Đang thực hiện</a>
          <a href="tasks.html?status=awaiting-review" class="search-chip is-warning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Chờ duyệt</a>
          <a href="tasks.html?overdue=1" class="search-chip is-danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>Quá hạn</a>
          <a href="tasks.html?status=completed" class="search-chip is-success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>Đã xong</a>
        </div>
      </div>
      <div class="search-dropdown-section search-recent-section" hidden>
        <div class="search-dropdown-header">
          <span class="search-dropdown-label">Lịch sử gần đây</span>
          <button type="button" class="btn-clear-search-history">Xóa lịch sử</button>
        </div>
        <div class="search-recent-chips"></div>
      </div>
    </div>
  `;
  left.append(searchContainer);

  // Mobile Search Toggle Button in Topbar
  const searchToggle = document.createElement('button');
  searchToggle.type = 'button';
  searchToggle.className = 'topbar-search-toggle';
  searchToggle.setAttribute('aria-label', 'Mở tìm kiếm');
  searchToggle.setAttribute('title', 'Tìm kiếm');
  searchToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>';
  left.append(searchToggle);

  // Mobile Fullscreen Search Modal (attached directly to body for 100% crispness, zero blur/clipping)
  let mobileSearchModal = document.getElementById('mobile-search-modal');
  if (!mobileSearchModal) {
    mobileSearchModal = document.createElement('div');
    mobileSearchModal.id = 'mobile-search-modal';
    mobileSearchModal.className = 'mobile-search-modal';
    mobileSearchModal.hidden = true;
    mobileSearchModal.innerHTML = `
      <div class="mobile-search-dialog">
        <header class="mobile-search-header">
          <button type="button" class="btn-mobile-search-back" aria-label="Đóng tìm kiếm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <form class="mobile-search-form" role="search" autocomplete="off">
            <div class="mobile-search-input-box">
              <svg class="mobile-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>
              </svg>
              <input type="search" id="mobile-search-input" name="q" placeholder="Tìm kiếm công việc..." aria-label="Tìm kiếm công việc" autocomplete="off">
              <button type="button" class="btn-mobile-search-clear" aria-label="Xóa từ khóa" hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <button type="submit" class="btn-mobile-search-submit">Tìm</button>
          </form>
        </header>
        <div class="mobile-search-body">
          <div class="mobile-search-section mobile-live-section" hidden>
            <div class="mobile-search-section-header">
              <span class="mobile-search-label">Kết quả công việc</span>
              <a href="tasks.html" class="search-live-all-link">Xem tất cả</a>
            </div>
            <div class="search-live-results"></div>
          </div>
          <div class="mobile-search-section">
            <span class="mobile-search-label">Gợi ý lọc nhanh</span>
            <div class="mobile-search-tags">
              <a href="tasks.html?status=all" class="search-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>Tất cả</a>
              <a href="tasks.html?status=in-progress" class="search-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Đang thực hiện</a>
              <a href="tasks.html?status=awaiting-review" class="search-chip is-warning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Chờ duyệt</a>
              <a href="tasks.html?overdue=1" class="search-chip is-danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>Quá hạn</a>
              <a href="tasks.html?status=completed" class="search-chip is-success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>Đã xong</a>
            </div>
          </div>
          <div class="mobile-search-section mobile-recent-section" hidden>
            <div class="mobile-search-section-header">
              <span class="mobile-search-label">Lịch sử gần đây</span>
              <button type="button" class="btn-clear-mobile-history">Xóa lịch sử</button>
            </div>
            <div class="mobile-recent-chips"></div>
          </div>
          <div class="mobile-search-dismiss-area">
            <span>Chạm vào khoảng trống này hoặc nút mũi tên để đóng</span>
          </div>
        </div>
      </div>
    `;
    document.body.append(mobileSearchModal);
  }

  const RECENT_KEY = 'DACK_RECENT_SEARCHES';
  const getRecent = () => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
  };
  const saveRecent = term => {
    const q = String(term || '').trim();
    if (!q) return;
    try {
      const list = getRecent().filter(item => item.toLowerCase() !== q.toLowerCase());
      list.unshift(q);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
    } catch {}
  };

  // Setup desktop search
  const desktopForm = searchContainer.querySelector('.topbar-search');
  const desktopInput = desktopForm.querySelector('input[name="q"]');
  const desktopKbd = desktopForm.querySelector('.topbar-search-kbd');
  const desktopDropdown = searchContainer.querySelector('.topbar-search-dropdown');
  const desktopClear = desktopForm.querySelector('.topbar-search-clear');
  const desktopLiveSection = desktopDropdown.querySelector('.search-live-section');
  const desktopLiveResults = desktopDropdown.querySelector('.search-live-results');
  const desktopLiveAllLink = desktopDropdown.querySelector('.search-live-all-link');
  const desktopRecentSection = desktopDropdown.querySelector('.search-recent-section');
  const desktopRecentChips = desktopDropdown.querySelector('.search-recent-chips');
  const desktopClearHistory = desktopDropdown.querySelector('.btn-clear-search-history');

  const escapeSearchHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  let searchInitPromise = null;
  const ensureSearchTasksReady = onReady => {
    if (Storage.getTasks().length) return;
    if (!searchInitPromise) {
      searchInitPromise = Storage.init().catch(() => {});
    }
    searchInitPromise.then(() => onReady?.());
  };

  const renderLiveResults = (rawQuery, sectionEl, listEl, allLinkEl, onBeforeNavigate) => {
    if (!sectionEl || !listEl) return;
    const query = String(rawQuery || '').trim();
    if (!query) {
      sectionEl.hidden = true;
      listEl.replaceChildren();
      return;
    }
    const qLower = query.toLowerCase();
    const visibleTasks = Auth.getTasks(Storage.getTasks());
    const matches = visibleTasks
      .filter(task => [task.title, task.description, task.categoryName].some(field =>
        String(field || '').toLowerCase().includes(qLower)
      ))
      .slice(0, 5);

    sectionEl.hidden = false;
    if (allLinkEl) {
      allLinkEl.href = `tasks.html?q=${encodeURIComponent(query)}`;
    }
    if (!matches.length) {
      listEl.innerHTML = `<div class="search-live-empty">Không tìm thấy công việc khớp “${escapeSearchHtml(query)}”</div>`;
      return;
    }

    listEl.innerHTML = matches.map(task => {
      const statusMeta = getStatusMeta(task.status);
      const overdue = isOverdue(task.deadline, task.status);
      const dueText = task.deadline ? formatDate(task.deadline) : 'Không hạn';
      return `
        <a href="task-detail.html?id=${encodeURIComponent(task.id)}" class="search-live-item">
          <div class="search-live-item-main">
            <span class="search-live-title">${escapeSearchHtml(task.title)}</span>
            <span class="search-live-meta${overdue ? ' is-overdue' : ''}">${escapeSearchHtml(task.categoryName || 'Công việc')} &bull; Hạn: ${escapeSearchHtml(dueText)}</span>
          </div>
          <span class="badge ${statusMeta.className}">${escapeSearchHtml(statusMeta.label)}</span>
        </a>
      `;
    }).join('');

    listEl.querySelectorAll('.search-live-item').forEach(link => {
      link.addEventListener('click', () => {
        saveRecent(query);
        onBeforeNavigate?.();
      });
    });
  };

  const renderDesktopRecent = () => {
    const list = getRecent();
    if (!list.length) {
      desktopRecentSection.hidden = true;
      desktopRecentChips.replaceChildren();
      return;
    }
    desktopRecentSection.hidden = false;
    desktopRecentChips.replaceChildren(...list.map(term => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'search-recent-chip';
      chip.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg><span></span>';
      chip.querySelector('span').textContent = term;
      chip.addEventListener('click', () => {
        saveRecent(term);
        desktopDropdown.hidden = true;
        window.location.href = `tasks.html?q=${encodeURIComponent(term)}`;
      });
      return chip;
    }));
  };

  desktopClearHistory?.addEventListener('click', () => {
    try { localStorage.removeItem(RECENT_KEY); } catch {}
    renderDesktopRecent();
  });

  desktopInput.addEventListener('focus', () => {
    renderDesktopRecent();
    ensureSearchTasksReady(() => renderLiveResults(desktopInput.value, desktopLiveSection, desktopLiveResults, desktopLiveAllLink, () => { desktopDropdown.hidden = true; }));
    renderLiveResults(desktopInput.value, desktopLiveSection, desktopLiveResults, desktopLiveAllLink, () => { desktopDropdown.hidden = true; });
    desktopDropdown.hidden = false;
  });
  desktopInput.addEventListener('input', () => {
    const hasText = Boolean(desktopInput.value.trim());
    desktopClear.hidden = !hasText;
    if (desktopKbd) desktopKbd.hidden = hasText;
    desktopDropdown.hidden = false;
    renderLiveResults(desktopInput.value, desktopLiveSection, desktopLiveResults, desktopLiveAllLink, () => { desktopDropdown.hidden = true; });
  });
  desktopClear.addEventListener('click', () => {
    desktopInput.value = '';
    desktopClear.hidden = true;
    if (desktopKbd) desktopKbd.hidden = false;
    renderLiveResults('', desktopLiveSection, desktopLiveResults, desktopLiveAllLink);
    desktopInput.focus();
  });

  document.addEventListener('click', event => {
    if (!searchContainer.contains(event.target)) {
      desktopDropdown.hidden = true;
    }
  });

  desktopForm.addEventListener('submit', event => {
    event.preventDefault();
    const query = desktopInput.value.trim();
    if (query) saveRecent(query);
    desktopDropdown.hidden = true;
    window.location.href = `tasks.html${query ? `?q=${encodeURIComponent(query)}` : ''}`;
  });

  // Setup mobile search modal
  const mobileForm = mobileSearchModal.querySelector('.mobile-search-form');
  const mobileInput = mobileSearchModal.querySelector('#mobile-search-input');
  const mobileBackBtn = mobileSearchModal.querySelector('.btn-mobile-search-back');
  const mobileClearBtn = mobileSearchModal.querySelector('.btn-mobile-search-clear');
  const mobileLiveSection = mobileSearchModal.querySelector('.mobile-live-section');
  const mobileLiveResults = mobileSearchModal.querySelector('.mobile-live-section .search-live-results');
  const mobileLiveAllLink = mobileSearchModal.querySelector('.mobile-live-section .search-live-all-link');
  const mobileRecentSection = mobileSearchModal.querySelector('.mobile-recent-section');
  const mobileRecentChips = mobileSearchModal.querySelector('.mobile-recent-chips');
  const mobileClearHistory = mobileSearchModal.querySelector('.btn-clear-mobile-history');
  const mobileDismissArea = mobileSearchModal.querySelector('.mobile-search-dismiss-area');

  const renderMobileRecent = () => {
    const list = getRecent();
    if (!list.length) {
      mobileRecentSection.hidden = true;
      mobileRecentChips.replaceChildren();
      return;
    }
    mobileRecentSection.hidden = false;
    mobileRecentChips.replaceChildren(...list.map(term => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'search-recent-chip';
      chip.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg><span></span>';
      chip.querySelector('span').textContent = term;
      chip.addEventListener('click', () => {
        saveRecent(term);
        closeMobileSearch();
        window.location.href = `tasks.html?q=${encodeURIComponent(term)}`;
      });
      return chip;
    }));
  };

  mobileClearHistory?.addEventListener('click', () => {
    try { localStorage.removeItem(RECENT_KEY); } catch {}
    renderMobileRecent();
  });

  const openMobileSearch = () => {
    renderMobileRecent();
    ensureSearchTasksReady(() => renderLiveResults(mobileInput.value, mobileLiveSection, mobileLiveResults, mobileLiveAllLink, closeMobileSearch));
    renderLiveResults(mobileInput.value, mobileLiveSection, mobileLiveResults, mobileLiveAllLink, closeMobileSearch);
    mobileSearchModal.hidden = false;
    document.body.classList.add('mobile-search-open');
    setTimeout(() => {
      mobileInput.focus();
    }, 60);
  };

  const closeMobileSearch = () => {
    mobileSearchModal.hidden = true;
    document.body.classList.remove('mobile-search-open');
    mobileInput.blur();
  };

  searchToggle.addEventListener('click', openMobileSearch);
  mobileBackBtn.addEventListener('click', closeMobileSearch);
  mobileDismissArea.addEventListener('click', closeMobileSearch);

  mobileSearchModal.addEventListener('click', event => {
    if (event.target === mobileSearchModal || event.target.classList.contains('mobile-search-body')) {
      closeMobileSearch();
    }
  });

  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (desktopForm && desktopForm.offsetParent !== null) {
        desktopDropdown.hidden = false;
        renderDesktopRecent();
        ensureSearchTasksReady(() => renderLiveResults(desktopInput.value, desktopLiveSection, desktopLiveResults, desktopLiveAllLink, () => { desktopDropdown.hidden = true; }));
        renderLiveResults(desktopInput.value, desktopLiveSection, desktopLiveResults, desktopLiveAllLink, () => { desktopDropdown.hidden = true; });
        desktopInput.focus();
        desktopInput.select();
      } else {
        openMobileSearch();
      }
      return;
    }
    if (event.key === 'Escape') {
      if (!mobileSearchModal.hidden) {
        closeMobileSearch();
      } else if (!desktopDropdown.hidden) {
        desktopDropdown.hidden = true;
        desktopInput.blur();
      }
    }
  });

  mobileInput.addEventListener('input', () => {
    mobileClearBtn.hidden = !mobileInput.value.trim();
    renderLiveResults(mobileInput.value, mobileLiveSection, mobileLiveResults, mobileLiveAllLink, closeMobileSearch);
  });
  mobileClearBtn.addEventListener('click', () => {
    mobileInput.value = '';
    mobileClearBtn.hidden = true;
    renderLiveResults('', mobileLiveSection, mobileLiveResults, mobileLiveAllLink);
    mobileInput.focus();
  });

  mobileForm.addEventListener('submit', event => {
    event.preventDefault();
    const query = mobileInput.value.trim();
    if (query) saveRecent(query);
    closeMobileSearch();
    window.location.href = `tasks.html${query ? `?q=${encodeURIComponent(query)}` : ''}`;
  });
  if (quickAdd) right.append(quickAdd);
  if (themeToggle) right.append(themeToggle);

  const heading = document.createElement('section');
  heading.className = 'page-heading';
  if (title) heading.append(title);
  const actions = document.createElement('div');
  actions.className = 'page-heading-actions';
  pageActions.forEach(action => {
    if (action !== quickAdd && !action.matches('#notification-center, .mobile-menu-btn')) actions.append(action);
  });
  if (actions.childElementCount) heading.append(actions);
  main.insertBefore(heading, main.firstElementChild);

  shell.before(topbar);
  topbar.classList.add('global-topbar');
}

function setupUserProfileViewer() {
  if (window.__userProfileViewerInitialized) return;
  window.__userProfileViewerInitialized = true;

  const escapeViewerHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  const formatViewerBirthDate = value => {
    if (!value) return '—';
    const [year, month, day] = String(value).split('-').map(Number);
    if (!year || !month || !day) return String(value);
    return new Intl.DateTimeFormat('vi-VN').format(new Date(year, month - 1, day));
  };

  const roleMeta = {
    admin: { label: 'Quản trị viên', className: 'role-admin' },
    manager: { label: 'Quản lý', className: 'role-manager' },
    user: { label: 'Người dùng', className: 'role-user' }
  };

  const getInitials = targetUser => {
    const raw = String(targetUser?.name || targetUser?.username || '?').trim();
    return raw.split(/\s+/).map(part => part[0]).slice(-2).join('').toUpperCase() || '?';
  };

  const createViewerAvatar = (targetUser, className = 'user-detail-avatar') => {
    const wrap = document.createElement('span');
    wrap.className = `${className}${targetUser?.avatar ? ' has-photo' : ''}`;
    const initials = getInitials(targetUser);
    if (targetUser?.avatar) {
      const img = document.createElement('img');
      img.src = targetUser.avatar;
      img.alt = targetUser.name || '';
      applyAvatarCrop(img, targetUser.avatarCrop);
      img.addEventListener('error', () => {
        if (!img.isConnected) return;
        wrap.replaceChildren();
        wrap.classList.remove('has-photo');
        wrap.textContent = initials;
      }, { once: true });
      wrap.append(img);
    } else {
      wrap.textContent = initials;
    }
    return wrap;
  };

  const getModal = () => {
    let modal = document.getElementById('user-profile-viewer-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'user-profile-viewer-modal';
      modal.className = 'modal-overlay user-viewer-overlay';
      document.body.appendChild(modal);
      modal.addEventListener('click', event => {
        if (event.target === modal || event.target.closest('[data-viewer-close]')) {
          closeModal();
        }
      });
    }
    return modal;
  };

  const closeModal = () => {
    const modal = document.getElementById('user-profile-viewer-modal');
    if (modal) modal.classList.remove('active');
  };

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const modal = document.getElementById('user-profile-viewer-modal');
    if (modal?.classList.contains('active')) {
      closeModal();
    }
  });

  const ensureDataLoaded = async () => {
    if (!Auth.getUsers().length) {
      await Auth.loadUsers().catch(() => []);
    }
    if (!Storage.isReady()) {
      await Storage.init().catch(() => false);
    }
  };

  const renderGroupListView = (memberIds, context = {}) => {
    const allUsers = Auth.getUsers();
    const members = memberIds.map(id => allUsers.find(u => u.id === id)).filter(Boolean);
    if (!members.length) {
      showToast('Không tìm thấy thông tin thành viên thực hiện.', 'warning');
      return;
    }
    if (members.length === 1) {
      renderSingleUserView(members[0].id, context);
      return;
    }

    const modal = getModal();
    const taskTitleHtml = context.taskTitle
      ? `<p class="user-viewer-subtitle">Công việc: <strong>${escapeViewerHtml(context.taskTitle)}</strong></p>`
      : '';

    modal.innerHTML = `
      <div class="modal-card user-viewer-card" role="dialog" aria-modal="true" aria-labelledby="user-viewer-title">
        <div class="user-viewer-header">
          <div>
            <span class="user-viewer-eyebrow">THÀNH VIÊN THỰC HIỆN</span>
            <h3 class="modal-title" id="user-viewer-title">Nhóm thực hiện (${members.length} người)</h3>
            ${taskTitleHtml}
          </div>
          <button type="button" class="deadline-modal-close" data-viewer-close aria-label="Đóng">&times;</button>
        </div>
        <div class="user-group-list"></div>
        <div class="user-viewer-footer">
          <button type="button" class="btn btn-secondary btn-sm" data-viewer-close>Đóng</button>
        </div>
      </div>
    `;

    const listEl = modal.querySelector('.user-group-list');
    members.forEach(member => {
      const rm = roleMeta[member.role] || { label: member.role, className: 'badge-neutral' };
      const metaParts = [member.active === false ? 'Đã khóa' : 'Đang hoạt động'];
      if (member.hobbies) metaParts.push(member.hobbies);
      else if (member.birthDate) metaParts.push(`NS: ${formatViewerBirthDate(member.birthDate)}`);

      const itemBtn = document.createElement('button');
      itemBtn.type = 'button';
      itemBtn.className = 'user-group-item';
      itemBtn.dataset.viewMemberId = member.id;

      const avatarEl = createViewerAvatar(member, 'user-group-avatar');
      const infoEl = document.createElement('div');
      infoEl.className = 'user-group-item-info';
      infoEl.innerHTML = `
        <div class="user-group-item-top">
          <strong>${escapeViewerHtml(member.name || member.username)}</strong>
          <span class="role-badge ${rm.className}">${escapeViewerHtml(rm.label)}</span>
        </div>
        <div class="user-group-item-sub">@${escapeViewerHtml(member.username)} &bull; ${escapeViewerHtml(metaParts.join(' • '))}</div>
      `;

      const actionHint = document.createElement('span');
      actionHint.className = 'user-group-item-action';
      actionHint.textContent = 'Xem chi tiết ›';

      itemBtn.append(avatarEl, infoEl, actionHint);
      itemBtn.addEventListener('click', () => {
        renderSingleUserView(member.id, { ...context, groupIds: memberIds });
      });
      listEl.append(itemBtn);
    });

    modal.classList.add('active');
  };

  const renderSingleUserView = (userId, context = {}) => {
    const targetUser = Auth.getUsers().find(u => u.id === userId);
    if (!targetUser) {
      showToast('Không tìm thấy thông tin người dùng.', 'warning');
      return;
    }

    const modal = getModal();
    const rm = roleMeta[targetUser.role] || { label: targetUser.role, className: 'badge-neutral' };
    const tasks = Storage.getTasks().filter(t =>
      t.assigneeId === targetUser.id || (Array.isArray(t.assigneeIds) && t.assigneeIds.includes(targetUser.id))
    );
    const activeCount = tasks.filter(t => !['completed', 'cancelled'].includes(t.status)).length;
    const completedCount = tasks.filter(t => t.status === 'completed').length;
    const hasGroupBack = Array.isArray(context.groupIds) && context.groupIds.length > 1;
    const coverHtml = targetUser.coverImage
      ? `<div class="user-viewer-cover"><img src="${escapeViewerHtml(targetUser.coverImage)}" alt="" onerror="this.parentElement.remove()"></div>`
      : '';

    modal.innerHTML = `
      <div class="modal-card user-viewer-card" role="dialog" aria-modal="true" aria-labelledby="user-viewer-title">
        <div class="user-viewer-header">
          <div class="user-viewer-header-left">
            ${hasGroupBack ? '<button type="button" class="btn btn-secondary btn-sm user-viewer-back-btn" id="user-viewer-back">&larr; Danh sách nhóm</button>' : '<span class="user-viewer-eyebrow">CHI TIẾT TÀI KHOẢN</span>'}
          </div>
          <button type="button" class="deadline-modal-close" data-viewer-close aria-label="Đóng">&times;</button>
        </div>

        ${coverHtml}

        <div class="user-detail-hero">
          <div class="user-detail-avatar-slot"></div>
          <div class="user-detail-hero-meta">
            <h3 class="modal-title" id="user-viewer-title">${escapeViewerHtml(targetUser.name || targetUser.username)}</h3>
            <p class="user-detail-username">@${escapeViewerHtml(targetUser.username)}</p>
            <div class="user-detail-badges">
              <span class="role-badge ${rm.className}">${escapeViewerHtml(rm.label)}</span>
              <span class="account-status ${targetUser.active !== false ? 'is-active' : ''}">${targetUser.active !== false ? 'Đang hoạt động' : 'Đã khóa'}</span>
            </div>
          </div>
        </div>

        <div class="user-detail-stats">
          <div class="user-detail-stat"><strong>${tasks.length}</strong><span>Tổng việc</span></div>
          <div class="user-detail-stat"><strong>${activeCount}</strong><span>Đang xử lý</span></div>
          <div class="user-detail-stat"><strong>${completedCount}</strong><span>Hoàn thành</span></div>
        </div>

        <dl class="user-detail-grid">
          <div><dt>Mã tài khoản</dt><dd>${escapeViewerHtml(targetUser.id || '—')}</dd></div>
          <div><dt>Ngày sinh</dt><dd>${escapeViewerHtml(formatViewerBirthDate(targetUser.birthDate))}</dd></div>
          <div><dt>Email</dt><dd>${escapeViewerHtml(targetUser.email || '—')}</dd></div>
          <div><dt>Số điện thoại</dt><dd>${escapeViewerHtml(targetUser.phone || '—')}</dd></div>
          <div class="user-detail-grid-full"><dt>Giới thiệu bản thân</dt><dd>${escapeViewerHtml(targetUser.hobbies || '—')}</dd></div>
        </dl>

        <div class="user-viewer-footer">
          <a href="account.html?userId=${encodeURIComponent(targetUser.id)}" class="btn btn-secondary btn-sm">Mở trang hồ sơ chi tiết</a>
          <button type="button" class="btn btn-primary btn-sm" data-viewer-close>Đóng</button>
        </div>
      </div>
    `;

    const avatarEl = createViewerAvatar(targetUser, 'user-detail-avatar');
    if (Auth.getCurrentUser()?.id === targetUser.id) {
      avatarEl.classList.add('is-viewable-own-avatar');
      avatarEl.setAttribute('role', 'button');
      avatarEl.tabIndex = 0;
      avatarEl.title = 'Nhấn để xem chi tiết ảnh đại diện';
      const triggerLightbox = event => {
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openOwnAvatarLightbox(targetUser);
      };
      avatarEl.addEventListener('click', triggerLightbox);
      avatarEl.addEventListener('keydown', triggerLightbox);
    }
    modal.querySelector('.user-detail-avatar-slot')?.append(avatarEl);
    modal.querySelector('#user-viewer-back')?.addEventListener('click', () => {
      renderGroupListView(context.groupIds, context);
    });
    modal.classList.add('active');
  };

  const handleUserTrigger = async event => {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    const trigger = event.target.closest('[data-user-profile-id], [data-assignee-ids]');
    if (!trigger || event.target.closest('input, select, textarea')) return;

    event.preventDefault();
    event.stopPropagation();

    const directId = trigger.dataset.userProfileId || '';
    const rawIds = trigger.dataset.assigneeIds || trigger.dataset.groupIds || '';
    const groupIds = [...new Set(rawIds.split(',').map(id => id.trim()).filter(Boolean))];
    const context = {
      taskId: trigger.dataset.taskId || '',
      taskTitle: trigger.dataset.taskTitle || '',
      groupIds
    };

    await ensureDataLoaded();
    if (directId) {
      renderSingleUserView(directId, context);
    } else if (groupIds.length > 1) {
      renderGroupListView(groupIds, context);
    } else if (groupIds.length === 1) {
      renderSingleUserView(groupIds[0], context);
    }
  };

  document.addEventListener('click', handleUserTrigger);
  document.addEventListener('keydown', handleUserTrigger);

  let hoverTooltip = document.getElementById('user-hover-tooltip');
  if (!hoverTooltip) {
    hoverTooltip = document.createElement('div');
    hoverTooltip.id = 'user-hover-tooltip';
    hoverTooltip.className = 'user-hover-tooltip';
    hoverTooltip.setAttribute('role', 'tooltip');
    hoverTooltip.hidden = true;
    document.body.append(hoverTooltip);
  }

  const hideHoverTooltip = () => {
    hoverTooltip.hidden = true;
    hoverTooltip.removeAttribute('data-visible');
    hoverTooltip.classList.remove('is-bottom');
  };

  const showHoverTooltip = target => {
    const text = target?.getAttribute('data-tooltip');
    if (!text) {
      hideHoverTooltip();
      return;
    }
    hoverTooltip.textContent = text;
    hoverTooltip.hidden = false;
    const rect = target.getBoundingClientRect();
    const tipRect = hoverTooltip.getBoundingClientRect();
    const showBelow = rect.top < 44;
    hoverTooltip.classList.toggle('is-bottom', showBelow);

    const centerLeft = rect.left + rect.width / 2 - tipRect.width / 2;
    const clampedLeft = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, centerLeft));
    const topPos = showBelow ? rect.bottom + 8 : rect.top - tipRect.height - 8;

    hoverTooltip.style.left = `${Math.round(clampedLeft)}px`;
    hoverTooltip.style.top = `${Math.round(Math.max(8, topPos))}px`;
    hoverTooltip.setAttribute('data-visible', 'true');
  };

  document.addEventListener('pointerover', event => {
    const target = event.target.closest('[data-tooltip]');
    if (target) showHoverTooltip(target);
  });
  document.addEventListener('pointerout', event => {
    const left = event.target.closest('[data-tooltip]');
    if (left && !left.contains(event.relatedTarget)) hideHoverTooltip();
  });
  document.addEventListener('focusin', event => {
    const target = event.target.closest('[data-tooltip]');
    if (target) showHoverTooltip(target);
  });
  document.addEventListener('focusout', event => {
    if (event.target.closest('[data-tooltip]')) hideHoverTooltip();
  });
  window.addEventListener('scroll', hideHoverTooltip, true);
  window.addEventListener('resize', hideHoverTooltip);
  document.addEventListener('click', hideHoverTooltip);
}

export function openOwnAvatarLightbox(user, { onTriggerUpload = null } = {}) {
  const currentUser = Auth.getCurrentUser();
  if (!user || !currentUser || currentUser.id !== user.id) return;

  const escapeLightboxHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const roleLabels = { admin: 'Quản trị viên', manager: 'Quản lý', user: 'Người dùng' };
  const initials = String(user.name || user.username || '?')
    .trim()
    .split(/\s+/)
    .map(part => part[0])
    .slice(-2)
    .join('')
    .toUpperCase() || '?';

  let modal = document.getElementById('own-avatar-lightbox-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'own-avatar-lightbox-modal';
    modal.className = 'modal-overlay avatar-lightbox-overlay';
    document.body.appendChild(modal);
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('[data-lightbox-close]')) {
        modal.classList.remove('active');
      }
    });
  }

  if (!window.__ownAvatarLightboxEscBound) {
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const openModal = document.getElementById('own-avatar-lightbox-modal');
      if (openModal?.classList.contains('active')) {
        openModal.classList.remove('active');
      }
    });
    window.__ownAvatarLightboxEscBound = true;
  }

  const uploadBtnHtml = typeof onTriggerUpload === 'function'
    ? '<button type="button" class="btn btn-secondary btn-sm" id="avatar-lightbox-upload-btn">Đổi ảnh đại diện</button>'
    : '';

  modal.innerHTML = `
    <div class="modal-card avatar-lightbox-card" role="dialog" aria-modal="true" aria-labelledby="avatar-lightbox-title">
      <div class="avatar-lightbox-header">
        <div>
          <span class="user-viewer-eyebrow">ẢNH ĐẠI DIỆN CỦA TÔI</span>
          <h3 class="modal-title" id="avatar-lightbox-title">${escapeLightboxHtml(user.name || user.username)}</h3>
          <p class="avatar-lightbox-sub">@${escapeLightboxHtml(user.username)} &bull; ${escapeLightboxHtml(roleLabels[user.role] || user.role)}</p>
        </div>
        <button type="button" class="deadline-modal-close" data-lightbox-close aria-label="Đóng">&times;</button>
      </div>
      <div class="avatar-lightbox-stage"></div>
      <div class="avatar-lightbox-footer">
        ${uploadBtnHtml}
        <button type="button" class="btn btn-primary btn-sm" data-lightbox-close>Đóng</button>
      </div>
    </div>
  `;

  const stage = modal.querySelector('.avatar-lightbox-stage');
  if (stage) {
    if (user.avatar) {
      const img = document.createElement('img');
      img.src = user.avatar;
      img.alt = user.name || 'Ảnh đại diện';
      applyAvatarCrop(img, user.avatarCrop);
      img.addEventListener('error', () => {
        if (!img.isConnected) return;
        stage.replaceChildren();
        const fallback = document.createElement('span');
        fallback.className = 'avatar-lightbox-initials';
        fallback.textContent = initials;
        stage.append(fallback);
      }, { once: true });
      stage.append(img);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'avatar-lightbox-initials';
      fallback.textContent = initials;
      stage.append(fallback);
    }
  }

  if (typeof onTriggerUpload === 'function') {
    modal.querySelector('#avatar-lightbox-upload-btn')?.addEventListener('click', () => {
      modal.classList.remove('active');
      onTriggerUpload();
    });
  }

  modal.classList.add('active');
}
