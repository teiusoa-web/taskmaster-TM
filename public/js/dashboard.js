// dashboard.js - Xử lý tính toán KPI, biểu đồ thống kê bằng Array Methods (reduce, filter, map)
import { Storage } from './storage.js';
import { formatDate, getStatusMeta, getPriorityMeta, isOverdue } from './utils.js';
import { Auth } from './auth.js';

document.addEventListener('DOMContentLoaded', async () => {
  await Storage.init();
  renderRoleWelcome();
  renderDashboardStats();
  const tasks = getDashboardTasks();
  renderUpcomingTasks(tasks);
  renderCancelledTasks(tasks);
});

function getDashboardTasks() {
  return Auth.getTasks(Storage.getTasks());
}

function renderRoleWelcome() {
  const user = Auth.getCurrentUser();
  const title = document.getElementById('dashboard-welcome-title');
  const description = document.getElementById('dashboard-welcome-description');
  if (!user || !title || !description) return;
  const copy = {
    admin: ['Trung t\u00e2m qu\u1ea3n tr\u1ecb', 'Theo d\u00f5i t\u1ed5ng quan c\u00f4ng vi\u1ec7c, duy\u1ec7t b\u00e1o c\u00e1o v\u00e0 qu\u1ea3n l\u00fd t\u00e0i kho\u1ea3n.'],
    manager: ['Công việc bạn phụ trách', 'Theo dõi việc bạn tạo hoặc được giao, và cập nhật tiến độ nhóm.'],
    user: ['Công việc của bạn', 'Theo dõi việc được giao và gửi báo cáo tiến độ cho quản lý.']
  }[user.role];
  title.textContent = copy[0];
  description.textContent = copy[1];
  const adminActions = document.getElementById('admin-quick-actions');
  if (adminActions) adminActions.hidden = user.role !== 'admin';
  if (user.role === 'admin') {
    const pageTitle = document.querySelector('.page-title');
    if (pageTitle) pageTitle.textContent = 'Dashboard qu\u1ea3n tr\u1ecb';
    const reviewLabel = document.querySelector('#stat-awaiting-review')?.parentElement?.querySelector('p');
    if (reviewLabel) reviewLabel.textContent = 'Ch\u1edd duy\u1ec7t';
  }
}

/**
 * Tính toán và hiển thị các số liệu thống kê công việc
 * Sử dụng reduce, filter theo yêu cầu mục 13 & 14
 */
function renderDashboardStats() {
  const tasks = getDashboardTasks();

  // 1. Tổng số công việc
  const totalTasks = tasks.length;

  // 2. Số lượng theo từng trạng thái bằng filter()
  const pendingTasks = tasks.filter(t => t.status === 'pending').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in-progress').length;
  const awaitingReviewTasks = tasks.filter(t => t.status === 'awaiting-review').length;
  const needsRevisionTasks = tasks.filter(t => t.status === 'needs-revision').length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const cancelledTasks = tasks.filter(t => t.status === 'cancelled').length;

  // 3. Số công việc quá hạn (deadline < now và chưa hoàn thành)
  const overdueTasks = tasks.filter(t => isOverdue(t.deadline, t.status)).length;

  // 4. Tính tỷ lệ hoàn thành (%) bằng reduce() hoặc phép tính
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Gán vào DOM
  const totalElem = document.getElementById('stat-total');
  const inProgressElem = document.getElementById('stat-in-progress');
  const completedElem = document.getElementById('stat-completed');
  const overdueElem = document.getElementById('stat-overdue');
  const cancelledElem = document.getElementById('stat-cancelled');
  const awaitingReviewElem = document.getElementById('stat-awaiting-review');
  const needsRevisionElem = document.getElementById('stat-needs-revision');

  if (totalElem) totalElem.textContent = totalTasks;
  if (inProgressElem) inProgressElem.textContent = inProgressTasks;
  if (completedElem) completedElem.textContent = `${completedTasks} (${completionRate}%)`;
  if (overdueElem) overdueElem.textContent = overdueTasks;
  if (cancelledElem) cancelledElem.textContent = cancelledTasks;
  if (awaitingReviewElem) awaitingReviewElem.textContent = awaitingReviewTasks;
  if (needsRevisionElem) needsRevisionElem.textContent = needsRevisionTasks;

  // Render thanh thống kê danh mục công việc
  renderCategoryProgress(tasks);
}

function renderCancelledTasks(tasks) {
  const tbody = document.getElementById('cancelled-tasks-list');
  if (!tbody) return;
  const cancelled = tasks.filter(task => task.status === 'cancelled');
  if (!cancelled.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">Chưa có công việc bị hủy.</td></tr>';
    return;
  }
  const users = Auth.getUsers();
  tbody.innerHTML = cancelled
    .sort((a, b) => new Date(b.cancelledAt || b.updatedAt || b.createdAt || 0) - new Date(a.cancelledAt || a.updatedAt || a.createdAt || 0))
    .slice(0, 5)
    .map(task => {
      const assignee = users.find(user => user.id === task.assigneeId);
      return `<tr><td><a class="task-title-cell" href="task-detail.html?id=${encodeURIComponent(task.id)}">${escapeHtml(task.title)}</a></td><td>${escapeHtml(assignee?.name || 'Chưa phân công')}</td><td>${formatDate(task.deadline)}</td><td><a class="btn btn-secondary btn-sm" href="task-detail.html?id=${encodeURIComponent(task.id)}">Chi tiết</a></td></tr>`;
    }).join('');
}

/**
 * Thống kê số lượng công việc theo từng danh mục
 */
let categoryProgressPage = 1;
const CATEGORY_PROGRESS_PAGE_SIZE = 3;

function renderCategoryProgress(tasks) {
  const categories = Storage.getCategories();
  const container = document.getElementById('category-stats-list');
  if (!container) return;

  const stats = new Map();
  categories.forEach(category => stats.set(category.id, { name: category.name, color: category.color, tasks: [] }));
  tasks.forEach(task => {
    const key = task.categoryId || task.categoryName || 'uncategorized';
    if (!stats.has(key)) stats.set(key, { name: task.categoryName || task.categoryId || 'Chưa phân loại', color: '', tasks: [] });
    stats.get(key).tasks.push(task);
  });

  const rows = [...stats.values()].filter(category => category.tasks.length > 0);
  if (!rows.length) {
    categoryProgressPage = 1;
    container.innerHTML = '<p class="text-muted">Chưa có công việc theo từng mục.</p>';
    return;
  }
  rows.sort((a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name, 'vi'));
  const pageCount = Math.ceil(rows.length / CATEGORY_PROGRESS_PAGE_SIZE);
  categoryProgressPage = Math.min(categoryProgressPage, pageCount);
  const start = (categoryProgressPage - 1) * CATEGORY_PROGRESS_PAGE_SIZE;
  const pageRows = rows.slice(start, start + CATEGORY_PROGRESS_PAGE_SIZE);

  const cards = pageRows.map(category => {
    const total = category.tasks.length;
    const completed = category.tasks.filter(task => task.status === 'completed').length;
    const inProgress = category.tasks.filter(task => task.status === 'in-progress').length;
    const pending = total - completed - inProgress;
    const percent = Math.round(completed / total * 100);
    const name = escapeHtml(category.name);
    const color = /^#[0-9a-f]{3,8}$/i.test(category.color || '') ? category.color : 'var(--primary)';
    return `<article class="category-progress-card">
      <div class="category-progress-heading"><h3>${name}</h3><span>${total} c\u00f4ng vi\u1ec7c</span></div>
      <div class="category-progress-counts"><span>Ho\u00e0n th\u00e0nh <strong>${completed}</strong></span><span>\u0110ang l\u00e0m <strong>${inProgress}</strong></span><span>Ch\u1edd x\u1eed l\u00fd <strong>${pending}</strong></span></div>
      <div class="category-progress-track" role="progressbar" aria-label="Ti\u1ebfn \u0111\u1ed9 ${name}" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%;background:${color}"></span></div>
      <small>${percent}% ho\u00e0n th\u00e0nh</small>
    </article>`;
  }).join('');

  const pagination = pageCount > 1 ? `<nav class="category-pagination" aria-label="Trang ti\u1ebfn \u0111\u1ed9 danh m\u1ee5c">${Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1;
    return `<button type="button" class="category-page-button${page === categoryProgressPage ? ' is-active' : ''}" data-page="${page}" aria-current="${page === categoryProgressPage ? 'page' : 'false'}">${page}</button>`;
  }).join('')}</nav>` : '';
  container.innerHTML = `${cards}${pagination}`;
  container.querySelectorAll('.category-page-button').forEach(button => button.addEventListener('click', () => {
    categoryProgressPage = Number(button.dataset.page);
    renderCategoryProgress(tasks);
  }));
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
/**
 * Hiển thị danh sách các việc cần làm gấp (sắp đến hạn)
 */
function renderUpcomingTasks(tasks) {
  const upcomingContainer = document.getElementById('upcoming-tasks-list');
  if (!upcomingContainer) return;

  // Lọc các task chưa xong, sắp xếp theo deadline tăng dần (ưu tiên việc gần nhất)
  const pendingTasks = tasks
    .filter(t => t.status !== 'completed')
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, 5); // Lấy top 5

  if (pendingTasks.length === 0) {
    const isAdmin = Auth.getCurrentUser()?.role === 'admin';
    upcomingContainer.innerHTML = `
      <tr class="dashboard-empty-row"><td colspan="5">
        <div class="empty-state dashboard-clear-state">
          <div class="clear-state-icon" aria-hidden="true"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 12l4 4L19 6"/></svg></div>
          <span class="empty-state-eyebrow">${isAdmin ? 'T\u1ed4NG QUAN C\u00d4NG VI\u1ec6C' : 'TI\u1ebeN \u0110\u1ed8 C\u00d4NG VI\u1ec6C'}</span>
          <h3>${isAdmin ? 'Hi\u1ec7n kh\u00f4ng c\u00f3 c\u00f4ng vi\u1ec7c c\u1ea7n x\u1eed l\u00fd' : 'Tuy\u1ec7t v\u1eddi! B\u1ea1n \u0111\u00e3 ho\u00e0n t\u1ea5t m\u1ecdi vi\u1ec7c'}</h3>
          <p>${isAdmin ? 'C\u00e1c c\u00f4ng vi\u1ec7c c\u1ea7n theo d\u00f5i s\u1ebd hi\u1ec3n th\u1ecb t\u1ea1i \u0111\u00e2y.' : 'Hi\u1ec7n kh\u00f4ng c\u00f2n c\u00f4ng vi\u1ec7c n\u00e0o c\u1ea7n x\u1eed l\u00fd. H\u00e3y t\u1eadn h\u01b0\u1edfng kho\u1ea3ng ngh\u1ec9 c\u1ee7a b\u1ea1n.'}</p>
        </div>
      </td></tr>
    `;
    return;
  }

  const html = pendingTasks.map(task => {
    const statusMeta = getStatusMeta(task.status);
    const priorityMeta = getPriorityMeta(task.priority);
    const overdue = isOverdue(task.deadline, task.status);

    return `
      <tr>
        <td>
          <a href="task-detail.html?id=${task.id}" class="task-title-cell" style="color: var(--primary);">
            ${task.title}
          </a>
          <span class="task-desc-sub">${task.description ? task.description.substring(0, 50) + '...' : ''}</span>
        </td>
        <td>
          <span class="badge ${priorityMeta.className}">${priorityMeta.label}</span>
        </td>
        <td>
          <span style="color: ${overdue ? 'var(--danger)' : 'inherit'}; font-weight: ${overdue ? '700' : 'normal'}">
            ${formatDate(task.deadline)} ${overdue ? '(Quá hạn)' : ''}
          </span>
        </td>
        <td>
          <span class="badge ${statusMeta.className}">${statusMeta.label}</span>
        </td>
        <td>
          <a href="task-detail.html?id=${task.id}" class="btn btn-secondary btn-sm">Chi tiết</a>
        </td>
      </tr>
    `;
  }).join('');

  upcomingContainer.innerHTML = html;
}
