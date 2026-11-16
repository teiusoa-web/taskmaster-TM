import { Auth } from './auth.js';
// tasks.js - Quản lý trang danh sách công việc (Render, Search, Filter, Sort, Delete, Quick Status Change)
import { Storage } from './storage.js';
import { formatDate, getStatusMeta, getPriorityMeta, isOverdue, getTaskProgress, renderAvatarStackHtml } from './utils.js';
import { getDeadlineInfo } from './notifications.js';

let allTasks = [];
let allCategories = [];
let allAccounts = [];
let overdueOnly = false;

document.addEventListener('DOMContentLoaded', async () => {
  attachTaskViewSwitch();
  applyDashboardFilterFromUrl();
  renderTasksSkeleton();
  setupCustomFilterSelects();
  const usersPromise = Auth.loadUsers().then(() => {
    allAccounts = Auth.getUsers();
    populateAssigneeFilter();
    setupCustomFilterSelects();
  });
  await Promise.all([
    usersPromise,
    Storage.init(),
    new Promise(resolve => setTimeout(resolve, 450))
  ]);
  allTasks = Storage.getTasks();
  allCategories = Storage.getCategories();
  allAccounts = Auth.getUsers();

  populateCategoryFilter();
  populateAssigneeFilter();
  applyDashboardFilterFromUrl();
  setupCustomFilterSelects();
  attachEventListeners();
  applyFiltersAndRender();
});

function renderTasksSkeleton() {
  const tbody = document.getElementById('task-table-body');
  if (tbody) {
    tbody.innerHTML = Array.from({ length: 6 }).map(() => `
      <tr class="skeleton-table-row">
        <td>
          <div class="skeleton-cell-flow">
            <div class="skeleton-shimmer skeleton-text w-80" style="height: 15px;"></div>
            <div class="skeleton-shimmer skeleton-text w-50" style="height: 11px;"></div>
          </div>
        </td>
        <td><div class="skeleton-shimmer skeleton-pill" style="width: 82px;"></div></td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="skeleton-shimmer skeleton-avatar"></div>
            <div class="skeleton-shimmer skeleton-text" style="width: 72px;"></div>
          </div>
        </td>
        <td><div class="skeleton-shimmer skeleton-pill" style="width: 68px;"></div></td>
        <td><div class="skeleton-shimmer skeleton-pill" style="width: 85px;"></div></td>
        <td><div class="skeleton-shimmer skeleton-pill" style="width: 90px; height: 8px; border-radius: 999px;"></div></td>
        <td><div class="skeleton-shimmer skeleton-pill" style="width: 80px;"></div></td>
      </tr>
    `).join('');
  }

  const kanbanBoard = document.getElementById('task-kanban-board');
  if (kanbanBoard) {
    const skeletonCols = ['Yêu cầu', 'Chờ', 'Đang làm', 'Chờ duyệt', 'Cần làm lại', 'Hoàn thành', 'Đã hủy'];
    kanbanBoard.innerHTML = skeletonCols.map(label => `
      <section class="kanban-column">
        <header>
          <div class="kanban-col-title-wrap"><span class="skeleton-shimmer" style="width:8px;height:8px;border-radius:50%;"></span><h3>${label}</h3></div>
          <span class="skeleton-shimmer" style="width: 24px; height: 24px; border-radius: 999px;">0</span>
        </header>
        <div class="kanban-cards">
          ${Array.from({ length: 2 }).map(() => `
            <div class="skeleton-kanban-card">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div class="skeleton-shimmer skeleton-pill" style="width: 68px; height: 18px;"></div>
                <div class="skeleton-shimmer skeleton-pill" style="width: 52px; height: 18px;"></div>
              </div>
              <div class="skeleton-shimmer skeleton-text w-100" style="height: 16px;"></div>
              <div class="skeleton-shimmer skeleton-text w-65" style="height: 10px;"></div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
                <div class="skeleton-shimmer skeleton-avatar" style="width: 24px; height: 24px;"></div>
                <div class="skeleton-shimmer skeleton-pill" style="width: 64px; height: 18px;"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </section>
    `).join('');
  }
}

function attachTaskViewSwitch() {
  const kanbanPanel = document.getElementById('task-kanban-panel');
  const listPanel = document.getElementById('task-list-panel');
  const buttons = document.querySelectorAll('[data-task-view]');
  if (!kanbanPanel || !listPanel || !buttons.length) return;
  const setView = view => {
    const selected = view === 'list' ? 'list' : 'kanban';
    kanbanPanel.hidden = selected !== 'kanban';
    listPanel.hidden = selected !== 'list';
    buttons.forEach(button => {
      const active = button.dataset.taskView === selected;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    try { localStorage.setItem('DACK_TASK_VIEW', selected); } catch {}
  };
  buttons.forEach(button => button.addEventListener('click', () => setView(button.dataset.taskView)));
  let savedView = 'kanban';
  try { savedView = localStorage.getItem('DACK_TASK_VIEW') || savedView; } catch {}
  setView(savedView);
}

function applyDashboardFilterFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const keyword = document.getElementById('search-task');
  if (keyword) keyword.value = params.get('q') || '';
  const view = document.body.dataset.taskView;
  const pageStatus = view && view !== 'overdue' ? view : null;
  const status = params.get('status') || pageStatus;
  const statusFilter = document.getElementById('filter-status');
  const allowedStatuses = ['request-pending', 'pending', 'in-progress', 'awaiting-review', 'needs-revision', 'completed', 'cancelled'];
  if (statusFilter && (status === 'all' || allowedStatuses.includes(status))) statusFilter.value = status;
  overdueOnly = params.get('overdue') === '1' || view === 'overdue';
  if (overdueOnly && statusFilter) statusFilter.value = 'all';
  const pageTitles = {
    all: 'T\u1ea5t c\u1ea3 c\u00f4ng vi\u1ec7c',
    'in-progress': 'C\u00f4ng vi\u1ec7c \u0111ang th\u1ef1c hi\u1ec7n',
    completed: 'C\u00f4ng vi\u1ec7c \u0111\u00e3 ho\u00e0n th\u00e0nh',
    'awaiting-review': 'C\u00f4ng vi\u1ec7c ch\u1edd duy\u1ec7t',
    'needs-revision': 'C\u00f4ng vi\u1ec7c c\u1ea7n l\u00e0m l\u1ea1i',
    overdue: 'C\u00f4ng vi\u1ec7c qu\u00e1 h\u1ea1n',
    cancelled: 'C\u00f4ng vi\u1ec7c b\u1ecb h\u1ee7y',
    'my-tasks': 'Vi\u1ec7c c\u1ee7a t\u00f4i',
  };
  if (pageTitles[view]) {
    const title = document.querySelector('.page-title');
    if (title) title.textContent = pageTitles[view];
    document.title = `${pageTitles[view]} - TaskMaster`;
  }
}

/**
 * Đếmdanh sách Categories vào ô select lọc
 */
function populateCategoryFilter() {
  const categorySelect = document.getElementById('filter-category');
  if (!categorySelect) return;
  categorySelect.replaceChildren(new Option('Danh m\u1ee5c', 'all'));
  const registeredIds = new Set(allCategories.map(category => category.id));
  allCategories.forEach(category => {
    const option = new Option(category.name, category.id);
    if (category.color) option.dataset.color = category.color;
    categorySelect.add(option);
  });
  const customNames = [...new Set(allTasks.filter(task => task.categoryName && !registeredIds.has(task.categoryId)).map(task => task.categoryName))];
  customNames.forEach(name => {
    const option = new Option(name, name);
    option.dataset.color = '#6366f1';
    categorySelect.add(option);
  });
}

function populateAssigneeFilter() {
  const select = document.getElementById('filter-assignee');
  if (!select || Auth.getCurrentUser()?.role !== 'admin') return;
  select.hidden = false;
  select.replaceChildren(new Option('Người dùng', 'all'));
  allAccounts.filter(account => account.role === 'user' || account.role === 'manager')
    .forEach(account => select.add(new Option(`${account.name} (@${account.username})`, account.id)));
}

/**
 * Đăng ký các sự kiện input, change, click (Thỏa mãn mục 7.2 Event)
 */
function attachEventListeners() {
  const searchInput = document.getElementById('search-task');
  const statusFilter = document.getElementById('filter-status');
  const categoryFilter = document.getElementById('filter-category');
  const priorityFilter = document.getElementById('filter-priority');
  const sortBySelect = document.getElementById('sort-by');
  const assigneeFilter = document.getElementById('filter-assignee');

  if (searchInput) searchInput.addEventListener('input', applyFiltersAndRender);
  if (statusFilter) statusFilter.addEventListener('change', () => {
    overdueOnly = false;
    applyFiltersAndRender();
  });
  if (categoryFilter) categoryFilter.addEventListener('change', applyFiltersAndRender);
  if (priorityFilter) priorityFilter.addEventListener('change', applyFiltersAndRender);
  if (sortBySelect) sortBySelect.addEventListener('change', applyFiltersAndRender);
  if (assigneeFilter && Auth.getCurrentUser()?.role === 'admin') assigneeFilter.addEventListener('change', applyFiltersAndRender);
}

/**
 * Lọc và sắp xếp danh sách theo tiêu chí (Thỏa mãn mục 9: Tìm kiếm - Lọc - Sắp xếp)
 */
function applyFiltersAndRender() {
  const keyword = (document.getElementById('search-task')?.value || '').toLowerCase().trim();
  const selectedStatus = document.getElementById('filter-status')?.value || 'all';
  const selectedCategory = document.getElementById('filter-category')?.value || 'all';
  const selectedPriority = document.getElementById('filter-priority')?.value || 'all';
  const sortBy = document.getElementById('sort-by')?.value || 'deadline-asc';
  const selectedAssignee = Auth.getCurrentUser()?.role === 'admin' ? (document.getElementById('filter-assignee')?.value || 'all') : 'all';

  // 1. Lọc (Filter)
  let result = allTasks.filter(task => {
    // Tìm kiếm theo tên hoặc mô tả (không phân biệt chữ hoa thường)
    const matchKeyword = !keyword || 
      task.title.toLowerCase().includes(keyword) || 
      (task.description && task.description.toLowerCase().includes(keyword));

    // Lọc theo trạng thái
    const matchStatus = selectedStatus === 'all' || task.status === selectedStatus;

    // Lọc theo danh mục
    const matchCategory = selectedCategory === 'all' || task.categoryId === selectedCategory || task.categoryName === selectedCategory;

    // Lọc theo mức độ ưu tiên & người thực hiện (hỗ trợ cả thành viên nhóm)
    const matchPriority = selectedPriority === 'all' || task.priority === selectedPriority;
    const matchAssignee = selectedAssignee === 'all' || task.assigneeId === selectedAssignee || (Array.isArray(task.assigneeIds) && task.assigneeIds.includes(selectedAssignee));
    const matchOverdue = !overdueOnly || isOverdue(task.deadline, task.status);
    const currentId = Auth.getCurrentUser()?.id;
    const matchMine = document.body.dataset.taskView !== 'my-tasks' || task.assigneeId === currentId || (Array.isArray(task.assigneeIds) && task.assigneeIds.includes(currentId));

    return matchKeyword && matchStatus && matchCategory && matchPriority && matchAssignee && matchOverdue && matchMine;
  });

  // 2. Sắp xếp (Sort)
  result.sort((a, b) => {
    switch (sortBy) {
      case 'deadline-asc':
        return new Date(a.deadline) - new Date(b.deadline);
      case 'deadline-desc':
        return new Date(b.deadline) - new Date(a.deadline);
      case 'title-az':
        return a.title.localeCompare(b.title);
      case 'title-za':
        return b.title.localeCompare(a.title);
      case 'priority-desc': {
        const pOrder = { high: 3, medium: 2, low: 1 };
        return (pOrder[b.priority] || 0) - (pOrder[a.priority] || 0);
      }
      default:
        return 0;
    }
  });

  renderTaskList(result);
  renderKanban(result);
  renderCompletionProgress();
}

function renderCompletionProgress() {
  const count = document.getElementById('task-completion-count');
  const percentLabel = document.getElementById('task-completion-percent');
  const progress = document.getElementById('task-completion-bar');
  if (!count || !percentLabel || !progress) return;

  const total = allTasks.length;
  const completed = allTasks.filter(task => task.status === 'completed').length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  count.textContent = `${completed} / ${total} công việc đã hoàn thành`;
  percentLabel.textContent = `${percent}%`;
  progress.setAttribute('aria-valuenow', String(percent));
  progress.setAttribute('aria-valuetext', `${percent}% (${completed}/${total} công việc)`);
  progress.querySelector('span').style.width = `${percent}%`;
}

function renderCategoryChipHtml(task, emptyLabel = 'Chưa phân loại') {
  const category = allCategories.find(item => item.id === task?.categoryId)
    || allCategories.find(item => task?.categoryName && item.name.trim().toLocaleLowerCase() === String(task.categoryName).trim().toLocaleLowerCase());
  const rawName = category?.name || task?.categoryName || '';
  const displayName = rawName || task?.categoryId || emptyLabel;
  const rawColor = String(category?.color || '').trim();
  const normalizedColor = /^#[0-9a-f]{3}$/i.test(rawColor)
    ? `#${rawColor[1]}${rawColor[1]}${rawColor[2]}${rawColor[2]}${rawColor[3]}${rawColor[3]}`
    : (/^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : '');
  const color = normalizedColor || ((rawName || category) ? '#6366f1' : '#64748b');
  return `<span class="task-category-chip" style="border-color: ${color}44; background: ${color}14;"><span class="cat-preview-dot" style="background: ${color};"></span><strong>${escapeHtml(displayName)}</strong></span>`;
}

const KANBAN_STATUSES = ['request-pending', 'pending', 'in-progress', 'awaiting-review', 'needs-revision', 'completed', 'cancelled'];
const KANBAN_PAGE_SIZE = 4;
const kanbanPages = Object.create(null);
function renderKanban(tasks) {
  const board = document.getElementById('task-kanban-board');
  if (!board) return;
  const labels = { 'request-pending': 'Yêu cầu', pending: 'Chờ', 'in-progress': 'Đang làm', 'awaiting-review': 'Chờ duyệt', 'needs-revision': 'Cần làm lại', completed: 'Hoàn thành', cancelled: 'Đã hủy' };
  board.innerHTML = KANBAN_STATUSES.map(status => {
    const items = tasks.filter(task => task.status === status);
    const pageCount = Math.max(1, Math.ceil(items.length / KANBAN_PAGE_SIZE));
    const page = Math.min(Math.max(0, kanbanPages[status] || 0), pageCount - 1);
    kanbanPages[status] = page;
    const pageItems = items.slice(page * KANBAN_PAGE_SIZE, (page + 1) * KANBAN_PAGE_SIZE);
    const cards = pageItems.map(task => {
      const categoryChipHtml = renderCategoryChipHtml(task);
      const priority = getPriorityMeta(task.priority);
      const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
      const doneCount = subtasks.filter(s => s?.done).length;
      const progress = getTaskProgress(task);
      const overdue = isOverdue(task.deadline, task.status);
      const avatarHtml = renderAvatarStackHtml(task, allAccounts, { compact: true });
      const checklistMeta = subtasks.length ? `${doneCount}/${subtasks.length}` : `${progress}%`;
      return `
        <a class="kanban-card content-loaded-fade" href="task-detail.html?id=${encodeURIComponent(task.id)}">
          <div class="kanban-card-top">
            ${categoryChipHtml}
            <span class="badge ${priority.className}">${escapeHtml(priority.label)}</span>
          </div>
          <strong>${escapeHtml(task.title)}</strong>
          <div class="kanban-card-progress" aria-label="Tiến độ checklist ${progress}%">
            <div class="kanban-card-progress-track"><span style="width:${progress}%"></span></div>
            <small>${escapeHtml(checklistMeta)} &bull; ${progress}%</small>
          </div>
          <footer>
            ${avatarHtml}
            <small class="kanban-deadline${overdue ? ' is-overdue' : ''}">${escapeHtml(formatDate(task.deadline))}</small>
          </footer>
        </a>`;
    }).join('') || '<p class="kanban-empty">Không có công việc</p>';
    const pagination = pageCount > 1 ? `<nav class="kanban-pagination" aria-label="Phân trang ${labels[status]}"><button type="button" class="kanban-page-btn" data-status="${status}" data-step="-1" aria-label="Trang trước" ${page === 0 ? 'disabled' : ''}>&lsaquo;</button><span aria-live="polite">Trang ${page + 1} / ${pageCount}</span><button type="button" class="kanban-page-btn" data-status="${status}" data-step="1" aria-label="Trang sau" ${page === pageCount - 1 ? 'disabled' : ''}>&rsaquo;</button></nav>` : '';
    return `<section class="kanban-column" data-status="${status}"><header><div class="kanban-col-title-wrap"><span class="kanban-status-dot is-${status}" aria-hidden="true"></span><h3>${labels[status]}</h3></div><span>${items.length}</span></header><div class="kanban-cards">${cards}</div>${pagination}</section>`;
  }).join('');
  board.querySelectorAll('.kanban-page-btn').forEach(button => button.addEventListener('click', () => {
    const status = button.dataset.status;
    kanbanPages[status] = (kanbanPages[status] || 0) + Number(button.dataset.step);
    renderKanban(tasks);
  }));
}

/**
 * Hiển thể danh sách task ra bảng HTML DOM (Thỏa mãn mục 7.1 Thao tác DOM)
 */
function renderTaskList(tasks) {
  const tbody = document.getElementById('task-table-body');
  const countBadge = document.getElementById('task-count-badge');
  if (!tbody) return;

  if (countBadge) {
    countBadge.textContent = `${tasks.length} công việc`;
  }

  // Trường hợp không có dữ liệu (Mục 17)
  if (tasks.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state task-empty-state">
            <div class="empty-state-art" aria-hidden="true"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M8 7h8m-8 4h8m-8 4h4m7-11v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2h8l4 4z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M15 3v4h4"/></svg></div>
            <span class="empty-state-eyebrow">DANH SÁCH CÔNG VIỆC</span>
            <h3>Bạn chưa có công việc được giao</h3>
            <p>Các công việc được giao cho bạn sẽ xuất hiện ở đây.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  const html = tasks.map(task => {
    const statusMeta = task.requestReview?.status === 'rejected'
      ? { label: 'Yêu cầu bị từ chối', className: 'badge-status-cancelled' }
      : getStatusMeta(task.status);
    const priorityMeta = getPriorityMeta(task.priority);
    const progress = getTaskProgress(task);
    const overdue = isOverdue(task.deadline, task.status);
    const deadlineInfo = getDeadlineInfo(task);
    const taskId = encodeURIComponent(task.id);
    const title = escapeHtml(task.title || 'Công việc không tên');
    const description = escapeHtml(task.description || '');
    const categoryChipHtml = renderCategoryChipHtml(task);
    const safeStatus = escapeHtml(statusMeta.label);
    const safePriority = escapeHtml(priorityMeta.label);
    const assigneeStackHtml = renderAvatarStackHtml(task, allAccounts, { compact: false });
    const remindActionHtml = deadlineInfo.isNear
      ? `<button type="button" class="task-remind-inline-btn is-${escapeHtml(deadlineInfo.urgency)}" data-remind-task="${escapeHtml(task.id)}" title="Mở form nhắn nhắc hạn">${escapeHtml(deadlineInfo.label)}</button>`
      : '';
    return `
      <tr class="task-clickable-row content-loaded-fade" data-task-href="task-detail.html?id=${taskId}" tabindex="0" aria-label="Open task details: ${title}">
        <td class="task-name-cell">
          <a href="task-detail.html?id=${taskId}" class="task-title-cell">${title}</a>
          ${description ? `<span class="task-desc-sub">${description}</span>` : ''}
        </td>
        <td>${categoryChipHtml}</td>
        <td>${assigneeStackHtml}</td>
        <td><span class="badge ${priorityMeta.className}">${safePriority}</span></td>
        <td><div class="task-deadline-wrap"><span class="task-deadline${overdue ? ' is-overdue' : ''}">${escapeHtml(formatDate(task.deadline))}</span>${remindActionHtml}</div></td>
        <td><div class="task-row-progress" role="progressbar" aria-label="Tiến độ công việc ${title}" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><strong>${progress}%</strong><span class="task-row-progress-track"><span style="width:${progress}%"></span></span></div></td>
        <td><span class="badge ${statusMeta.className}">${safeStatus}</span></td>
      </tr>
    `;
  }).join('');
  tbody.innerHTML = html;
  attachTaskRowNavigation();
}

/**
 * Mở trang chi tiết khi người dùng chọn một hàng trong bảng.
 */
function attachTaskRowNavigation() {
  const tbody = document.getElementById('task-table-body');
  if (tbody && !tbody.dataset.rowNavigationAttached) {
    const openTaskFromRow = event => {
      const row = event.target.closest('tr[data-task-href]');
      if (!row || event.target.closest('a, button, input, select, textarea, [data-assignee-ids], [data-user-profile-id]')) return;
      window.location.href = row.dataset.taskHref;
    };
    tbody.addEventListener('click', openTaskFromRow);
    tbody.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('tr[data-task-href]');
      if (!row || event.target.closest('a, button, input, select, textarea, [data-assignee-ids], [data-user-profile-id]')) return;
      event.preventDefault();
      window.location.href = row.dataset.taskHref;
    });
    tbody.dataset.rowNavigationAttached = 'true';
  }

}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[char]));
}

let customDropboxGlobalListenersBound = false;

function getFilterOptionDotClass(selectId, value) {
  if (!value || value === 'all') return '';
  if (selectId === 'filter-status') {
    const allowed = ['request-pending', 'pending', 'in-progress', 'awaiting-review', 'needs-revision', 'completed', 'cancelled'];
    return allowed.includes(value) ? `is-${value}` : '';
  }
  if (selectId === 'filter-priority') {
    const allowed = ['high', 'medium', 'low'];
    return allowed.includes(value) ? `is-priority-${value}` : '';
  }
  return '';
}

function closeAllCustomDropboxes(exceptWrapper = null) {
  document.querySelectorAll('.custom-dropbox.is-open').forEach(box => {
    if (box === exceptWrapper) return;
    box.classList.remove('is-open');
    const trigger = box.querySelector('.custom-dropbox-trigger');
    const menu = box.querySelector('.custom-dropbox-menu');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (menu) menu.hidden = true;
  });
}

function setupCustomFilterSelects() {
  const selects = document.querySelectorAll('select.filter-select');
  if (!selects.length) return;

  if (!customDropboxGlobalListenersBound) {
    document.addEventListener('click', event => {
      if (!event.target.closest('.custom-dropbox')) {
        closeAllCustomDropboxes();
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeAllCustomDropboxes();
      }
    });
    customDropboxGlobalListenersBound = true;
  }

  selects.forEach(select => {
    select.classList.add('is-custom-hidden');
    let wrapper = select.nextElementSibling?.classList.contains('custom-dropbox')
      ? select.nextElementSibling
      : null;

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'custom-dropbox';
      if (select.id) wrapper.dataset.selectId = select.id;
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

    wrapper.hidden = Boolean(select.hidden);
    const trigger = wrapper.querySelector('.custom-dropbox-trigger');
    const triggerDot = wrapper.querySelector('.custom-dropbox-trigger .custom-dropbox-dot');
    const triggerLabel = wrapper.querySelector('.custom-dropbox-label');
    const menu = wrapper.querySelector('.custom-dropbox-menu');

    const syncFromSelect = () => {
      const options = Array.from(select.options);
      const selectedOption = options[select.selectedIndex] || options[0];
      const currentVal = selectedOption?.value ?? '';
      if (triggerLabel) {
        triggerLabel.textContent = selectedOption?.textContent || '';
      }
      const selectedColor = /^#[0-9a-f]{3,8}$/i.test(selectedOption?.dataset?.color || '') ? selectedOption.dataset.color : '';
      if (triggerDot) {
        const dotClass = getFilterOptionDotClass(select.id, currentVal);
        triggerDot.className = `custom-dropbox-dot${dotClass ? ` ${dotClass}` : ''}`;
        triggerDot.style.background = !dotClass && selectedColor ? selectedColor : '';
        triggerDot.hidden = !dotClass && !selectedColor;
      }

      if (menu) {
        menu.innerHTML = options.map(opt => {
          const isSelected = opt.value === currentVal;
          const dotClass = getFilterOptionDotClass(select.id, opt.value);
          const optColor = /^#[0-9a-f]{3,8}$/i.test(opt.dataset?.color || '') ? opt.dataset.color : '';
          const dotHtml = dotClass
            ? `<span class="custom-dropbox-dot ${dotClass}" aria-hidden="true"></span>`
            : (optColor ? `<span class="custom-dropbox-dot" style="background: ${escapeHtml(optColor)};" aria-hidden="true"></span>` : '');
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
            closeAllCustomDropboxes();
            syncFromSelect();
            if (changed) {
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        });
      }
    };

    syncFromSelect();

    if (!select.dataset.customDropboxBound) {
      trigger?.addEventListener('click', () => {
        const willOpen = !wrapper.classList.contains('is-open');
        closeAllCustomDropboxes(willOpen ? wrapper : null);
        wrapper.classList.toggle('is-open', willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (menu) menu.hidden = !willOpen;
      });
      select.addEventListener('change', syncFromSelect);
      select.dataset.customDropboxBound = 'true';
    }
  });
}


