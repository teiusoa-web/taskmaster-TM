import { Auth } from './auth.js';
// tasks.js - Quản lý trang danh sách công việc (Render, Search, Filter, Sort, Delete, Quick Status Change)
import { Storage } from './storage.js';
import { formatDate, getStatusMeta, getPriorityMeta, isOverdue } from './utils.js';
import { showToast, showConfirmModal } from './main.js';

let allTasks = [];
let allCategories = [];
let allAccounts = [];
let overdueOnly = false;

document.addEventListener('DOMContentLoaded', async () => {
  await Storage.init();
  allTasks = Storage.getTasks();
  allCategories = Storage.getCategories();
  allAccounts = Auth.getUsers();

  populateCategoryFilter();
  populateAssigneeFilter();
  applyDashboardFilterFromUrl();
  attachEventListeners();
  attachTaskViewSwitch();
  applyFiltersAndRender();
});

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
  categorySelect.replaceChildren(new Option('T\u1ea5t c\u1ea3 danh m\u1ee5c', 'all'));
  const registeredIds = new Set(allCategories.map(category => category.id));
  allCategories.forEach(category => categorySelect.add(new Option(category.name, category.id)));
  const customNames = [...new Set(allTasks.filter(task => task.categoryName && !registeredIds.has(task.categoryId)).map(task => task.categoryName))];
  customNames.forEach(name => categorySelect.add(new Option(name, name)));
}

function populateAssigneeFilter() {
  const select = document.getElementById('filter-assignee');
  if (!select || Auth.getCurrentUser()?.role !== 'admin') return;
  select.hidden = false;
  select.replaceChildren(new Option('Tất cả người dùng', 'all'));
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

    // Lọc theo mức độ ưu tiên
    const matchPriority = selectedPriority === 'all' || task.priority === selectedPriority;
    const matchAssignee = selectedAssignee === 'all' || task.assigneeId === selectedAssignee;
    const matchOverdue = !overdueOnly || isOverdue(task.deadline, task.status);
    const matchMine = document.body.dataset.taskView !== 'my-tasks' || task.assigneeId === Auth.getCurrentUser()?.id;

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
}

const KANBAN_STATUSES = ['request-pending', 'pending', 'in-progress', 'awaiting-review', 'needs-revision', 'completed', 'cancelled'];
const KANBAN_PAGE_SIZE = 4;
const kanbanPages = Object.create(null);
function renderKanban(tasks) {
  const board = document.getElementById('task-kanban-board');
  if (!board) return;
  const labels = { 'request-pending': 'Yêu cầu', pending: 'Ch\u1edd', 'in-progress': '\u0110ang l\u00e0m', 'awaiting-review': 'Ch\u1edd duy\u1ec7t', 'needs-revision': 'C\u1ea7n l\u00e0m l\u1ea1i', completed: 'Ho\u00e0n th\u00e0nh', cancelled: '\u0110\u00e3 h\u1ee7y' };
  board.innerHTML = KANBAN_STATUSES.map(status => {
    const items = tasks.filter(task => task.status === status);
    const pageCount = Math.max(1, Math.ceil(items.length / KANBAN_PAGE_SIZE));
    const page = Math.min(Math.max(0, kanbanPages[status] || 0), pageCount - 1);
    kanbanPages[status] = page;
    const pageItems = items.slice(page * KANBAN_PAGE_SIZE, (page + 1) * KANBAN_PAGE_SIZE);
    const cards = pageItems.map(task => {
      const user = allAccounts.find(account => account.id === (task.assigneeId || (task.status === 'request-pending' ? '' : task.ownerId)));
      const priority = getPriorityMeta(task.priority);
      return `<a class="kanban-card" href="task-detail.html?id=${encodeURIComponent(task.id)}"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.categoryName || 'Ch\u01b0a ph\u00e2n lo\u1ea1i')}</span><footer><span class="badge ${priority.className}">${escapeHtml(priority.label)}</span><small>${escapeHtml(user?.name || 'Ch\u01b0a ph\u00e2n c\u00f4ng')} \u00b7 ${escapeHtml(formatDate(task.deadline))}</small></footer></a>`;
    }).join('') || '<p class="kanban-empty">Kh\u00f4ng c\u00f3 c\u00f4ng vi\u1ec7c</p>';
    const pagination = pageCount > 1 ? `<nav class="kanban-pagination" aria-label="Ph\u00e2n trang ${labels[status]}"><button type="button" class="kanban-page-btn" data-status="${status}" data-step="-1" aria-label="Trang tr\u01b0\u1edbc" ${page === 0 ? 'disabled' : ''}>&lsaquo;</button><span aria-live="polite">Trang ${page + 1} / ${pageCount}</span><button type="button" class="kanban-page-btn" data-status="${status}" data-step="1" aria-label="Trang sau" ${page === pageCount - 1 ? 'disabled' : ''}>&rsaquo;</button></nav>` : '';
    return `<section class="kanban-column" data-status="${status}"><header><h3>${labels[status]}</h3><span>${items.length}</span></header><div class="kanban-cards">${cards}</div>${pagination}</section>`;
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
            <span class="empty-state-eyebrow">DANH S\u00c1CH C\u00d4NG VI\u1ec6C</span>
            <h3>B\u1ea1n ch\u01b0a c\u00f3 c\u00f4ng vi\u1ec7c \u0111\u01b0\u1ee3c giao</h3>
            <p>C\u00e1c c\u00f4ng vi\u1ec7c \u0111\u01b0\u1ee3c giao cho b\u1ea1n s\u1ebd xu\u1ea5t hi\u1ec7n \u1edf \u0111\u00e2y.</p>
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
    const overdue = isOverdue(task.deadline, task.status);
    const category = allCategories.find(item => item.id === task.categoryId);
    const categoryName = category?.name || task.categoryName || task.categoryId || '\u2014';
    const assignee = allAccounts.find(account => account.id === (task.assigneeId || (task.status === 'request-pending' ? '' : task.ownerId)));
    const assigneeName = task.status === 'request-pending' ? 'Chờ phân công' : (assignee?.name || '\u0110ang c\u1eadp nh\u1eadt');
    const assigneeInitials = assigneeName.split(/\s+/).map(part => part[0]).slice(-2).join('').toUpperCase();
    const taskId = encodeURIComponent(task.id);
    const title = escapeHtml(task.title || 'C\u00f4ng vi\u1ec7c kh\u00f4ng t\u00ean');
    const description = escapeHtml(task.description || '');
    const safeCategory = escapeHtml(categoryName);
    const safeAssignee = escapeHtml(assigneeName);
    const safeStatus = escapeHtml(statusMeta.label);
    const safePriority = escapeHtml(priorityMeta.label);
    const safeInitials = escapeHtml(assigneeInitials);
    const safeId = escapeHtml(task.id);

    return `
      <tr class="task-clickable-row" data-task-href="task-detail.html?id=${taskId}" tabindex="0" aria-label="Open task details: ${title}">
        <td class="task-name-cell">
          <a href="task-detail.html?id=${taskId}" class="task-title-cell">${title}</a>
          ${description ? `<span class="task-desc-sub">${description}</span>` : ''}
        </td>
        <td><span class="task-category-chip">${safeCategory}</span></td>
        <td><span class="task-assignee"><span class="assignee-avatar${assignee?.avatar ? ' has-photo' : ''}">${assignee?.avatar ? `<img src="${escapeHtml(assignee.avatar)}" alt="">` : safeInitials}</span><span>${safeAssignee}</span></span></td>
        <td><span class="badge ${priorityMeta.className}">${safePriority}</span></td>
        <td><span class="task-deadline${overdue ? ' is-overdue' : ''}">${escapeHtml(formatDate(task.deadline))}${overdue ? ' <small>(Qu\u00e1 h\u1ea1n)</small>' : ''}</span></td>
        <td><span class="badge ${statusMeta.className}">${safeStatus}</span></td>
        <td>
          <div class="action-btns">
            <a href="task-detail.html?id=${taskId}" class="btn-icon" title="Xem chi ti\u1ebft" aria-label="Xem chi ti\u1ebft"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 3h7l5 5v13H7a2 2 0 01-2-2V5a2 2 0 012-2z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 3v6h6M9 13h6m-6 4h6"/></svg></a>
            ${Auth.canEditTask(task) ? `<a href="task-form.html?id=${taskId}" class="btn-icon" title="S\u1eeda" aria-label="S\u1eeda"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L8 18l-4 1 1-4 11.5-11.5z"/></svg></a><button class="btn-icon delete btn-delete-task" data-id="${safeId}" data-title="${title}" title="X\u00f3a" aria-label="X\u00f3a"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6h18m-2 0l-1 14H6L5 6m3 0V4h8v2m-7 4v6m4-6v6"/></svg></button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
  tbody.innerHTML = html;
  attachRowActionListeners();
}

/**
 * Gắn sự kiện cho các nút hành động trong bảng (Checkbox hoàn thành nhanh, Nút Xóa)
 */
function attachRowActionListeners() {
  const tbody = document.getElementById('task-table-body');
  if (tbody && !tbody.dataset.rowNavigationAttached) {
    const openTaskFromRow = event => {
      const row = event.target.closest('tr[data-task-href]');
      if (!row || event.target.closest('a, button, input, select, textarea')) return;
      window.location.href = row.dataset.taskHref;
    };
    tbody.addEventListener('click', openTaskFromRow);
    tbody.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('tr[data-task-href]');
      if (!row || event.target.closest('a, button, input, select, textarea')) return;
      event.preventDefault();
      window.location.href = row.dataset.taskHref;
    });
    tbody.dataset.rowNavigationAttached = 'true';
  }

  // Nút xóa (Hiển thể Modal xác nhận - Thỏa mãn mục 17 & 18)
  document.querySelectorAll('.btn-delete-task').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const title = btn.dataset.title;

      showConfirmModal(
        'Xác nhận xóa công việc',
        `Bạn có chắc chắn muốn xóa vĩnh viễn công việc "${title}" không? Thao tác này không thể hoàn tác.`,
        () => {
          const deleted = Storage.deleteTask(id);
          if (deleted === false) { showToast('Khong the xoa cong viec.', 'error'); return; }
          Promise.resolve(deleted).then(saved => { if (!saved) { showToast('Khong the dong bo cong viec.', 'error'); return; } allTasks = Storage.getTasks(); applyFiltersAndRender(); showToast('Da xoa cong viec.', 'success'); });
        }
      );
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[char]));
}


