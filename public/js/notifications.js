import { Auth } from './auth.js';
import { showConfirmModal, showToast } from './main.js';

const NOTIFICATIONS_KEY = 'DACK_NOTIFICATIONS_V1';

function readAll() {
  try { return JSON.parse(localStorage.getItem(NOTIFICATIONS_KEY) || '[]'); }
  catch { return []; }
}

function saveAll(items) {
  try { localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(items)); return true; }
  catch { return false; }
}

function addNotification({ recipientIds, title, message, taskId, type }) {
  const recipients = [...new Set((recipientIds || []).filter(Boolean))];
  if (!recipients.length) return;
  const items = readAll();
  items.unshift({ id: `notice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, title, message, taskId, type, recipientIds: recipients, readBy: [], createdAt: new Date().toISOString() });
  saveAll(items.slice(0, 300));
  window.dispatchEvent(new Event('task-notifications-updated'));
}

function relevantManagers(excludeId) {
  return Auth.getUsers().filter(user => user.active && ['admin', 'manager'].includes(user.role) && user.id !== excludeId).map(user => user.id);
}

function createDeadlineReminders(user) {
  if (!['user', 'manager'].includes(user.role)) return;
  const key = 'DACK_DEADLINE_REMINDERS_V1';
  let sent = {};
  try { sent = JSON.parse(localStorage.getItem(key) || '{}'); } catch { sent = {}; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  StorageTasks().filter(task => task.assigneeId === user.id && task.deadline && !['completed', 'cancelled'].includes(task.status)).forEach(task => {
    const due = new Date(`${task.deadline}T00:00:00`);
    const days = Math.round((due - today) / 86400000);
    const kind = days < 0 ? 'overdue' : days <= 1 ? 'upcoming' : null;
    if (!kind) return;
    const reminderId = `${task.id}:${kind}:${task.deadline}`;
    if (sent[reminderId]) return;
    sent[reminderId] = true;
    addNotification({ recipientIds: [user.id], title: kind === 'overdue' ? 'C\u00f4ng vi\u1ec7c \u0111\u00e3 qu\u00e1 h\u1ea1n' : 'C\u00f4ng vi\u1ec7c s\u1eafp \u0111\u1ebfn h\u1ea1n', message: `${task.title} - h\u1ea1n ${task.deadline}`, taskId: task.id, type: `deadline-${kind}` });
  });
  localStorage.setItem(key, JSON.stringify(sent));
}

function StorageTasks() {
  try { return JSON.parse(localStorage.getItem('DACK_TASKS_LIST') || '[]'); }
  catch { return []; }
}

export const Notifications = {
  taskAssigned(task, actor) {
    if (!task?.assigneeId) return;
    const users = Auth.getUsers();
    const assignee = users.find(user => user.id === task.assigneeId && user.active);
    const recipientIds = [task.assigneeId, ...relevantManagers(actor?.id)];
    addNotification({ recipientIds, title: 'Công việc mới được giao', message: `${actor?.name || 'Tài khoản'} đã giao “${task.title}”${assignee ? ` cho ${assignee.name}` : ''}.`, taskId: task.id, type: 'assignment' });
  },
  taskReported(task, report, actor) {
    if (!task || !actor) return;
    const recipientIds = [...relevantManagers(actor.id), task.ownerId].filter(id => id && id !== actor.id);
    addNotification({ recipientIds, title: 'Có báo cáo công việc mới', message: `@${actor.username} đã báo cáo “${task.title}”.`, taskId: task.id, type: 'report' });
  },
  taskCommented(task, comment, actor) {
    if (!task || !actor) return;
    const recipients = [...new Set([task.ownerId, task.assigneeId, ...relevantManagers(actor.id)].filter(id => id && id !== actor.id))];
    addNotification({ recipientIds: recipients, title: 'Bình luận mới trong công việc', message: `@${actor.username}: ${String(comment || '').slice(0, 120)} - ${task.title}`, taskId: task.id, type: 'comment' });
  },
  completionRequestWithdrawn(task, actor) {
    if (!task || !actor) return;
    const admins = Auth.getUsers().filter(user => user.active && user.role === 'admin').map(user => user.id);
    addNotification({ recipientIds: admins, title: 'Y\u00eau c\u1ea7u ho\u00e0n th\u00e0nh \u0111\u00e3 thu h\u1ed3i', message: `@${actor.username} \u0111\u00e3 thu h\u1ed3i y\u00eau c\u1ea7u ho\u00e0n th\u00e0nh \u201c${task.title}\u201d.`, taskId: task.id, type: 'completion-withdrawn' });
  },
  completionSubmitted(task, report, actor) {
    if (!task || !actor) return;
    const admins = Auth.getUsers().filter(user => user.active && user.role === 'admin').map(user => user.id);
    addNotification({ recipientIds: admins, title: 'Công việc chờ duyệt hoàn thành', message: `@${actor.username} gửi yêu cầu hoàn thành “${task.title}”.`, taskId: task.id, type: 'completion-review' });
  },
  taskCancelled(task, reason, actor) {
    if (!task || !actor) return;
    const admins = Auth.getUsers().filter(user => user.active && user.role === 'admin').map(user => user.id);
    addNotification({ recipientIds: admins, title: 'Người dùng yêu cầu hủy công việc', message: `@${actor.username} yêu cầu hủy “${task.title}”: ${reason}`, taskId: task.id, type: 'cancellation' });
  },
  cancellationReviewed(task, decision, actor) {
    if (!task?.assigneeId || !actor) return;
    const assignee = Auth.getUsers().find(user => user.id === task.assigneeId && user.active);
    if (!assignee) return;
    const result = decision === 'approved' ? 'đã duyệt yêu cầu hủy' : 'đã từ chối yêu cầu hủy; bạn cần tiếp tục công việc';
    addNotification({ recipientIds: [assignee.id], title: 'Yêu cầu hủy đã được xem xét', message: `${actor.name} ${result} “${task.title}”.`, taskId: task.id, type: 'cancellation-review' });
  },
  reportReviewed(task, review, actor) {
    if (!task?.assigneeId || !actor) return;
    const assignee = Auth.getUsers().find(user => user.id === task.assigneeId && user.active);
    if (!assignee) return;
    const outcome = review.decision === 'approved' ? '\u0110\u00e3 duy\u1ec7t ho\u00e0n th\u00e0nh' : 'y\u00eau c\u1ea7u b\u1ea1n l\u00e0m l\u1ea1i c\u00f4ng vi\u1ec7c';
    const score = review.score ? ` Điểm đánh giá: ${review.score}/10.` : '';
    addNotification({ recipientIds: [assignee.id], title: 'Admin đã đánh giá công việc', message: `${actor.name} ${outcome} báo cáo “${task.title}”.${score}${review.comment ? ` Nhận xét: ${review.comment}` : ''}`, taskId: task.id, type: 'review' });
  },
  deadlineChangeRequested(task, actor) {
    if (!task || !actor) return;
    const admins = Auth.getUsers().filter(user => user.active && user.role === 'admin').map(user => user.id);
    addNotification({ recipientIds: admins, title: 'Y\u00eau c\u1ea7u \u0111\u1ed5i h\u1ea1n ch\u00f3t', message: `@${actor.username} xin d\u1eddi h\u1ea1n c\u00f4ng vi\u1ec7c: ${task.title}`, taskId: task.id, type: 'deadline-change' });
  },
  deadlineChangeReviewed(task, decision, actor) {
    if (!task?.assigneeId || !actor) return;
    addNotification({ recipientIds: [task.assigneeId], title: 'Y\u00eau c\u1ea7u \u0111\u1ed5i h\u1ea1n \u0111\u00e3 \u0111\u01b0\u1ee3c xem x\u00e9t', message: `${actor.name} ${decision === 'approved' ? '\u0111\u00e3 duy\u1ec7t' : '\u0111\u00e3 t\u1eeb ch\u1ed1i'} y\u00eau c\u1ea7u \u0111\u1ed5i h\u1ea1n cho: ${task.title}`, taskId: task.id, type: 'deadline-change-review' });
  },
  initUI() {
    const current = Auth.getCurrentUser();
    if (!current || document.getElementById('notification-center')) return;
    createDeadlineReminders(current);
    const topNavbar = document.querySelector('.top-navbar');
    let host = topNavbar?.querySelector('.navbar-right');
    if (!host && topNavbar) {
      host = document.createElement('div');
      host.className = 'navbar-right';
      topNavbar.append(host);
    }
    if (!host) return;
    const center = document.createElement('div');
    center.id = 'notification-center';
    center.className = 'notification-center';
    center.innerHTML = `<button type="button" class="notification-toggle" aria-label="Mở thông báo" aria-expanded="false"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 004 0"/></svg><span class="notification-count" hidden></span></button><section class="notification-panel" hidden><div class="notification-panel-heading"><strong>Thông báo</strong><div class="notification-tools"><button type="button" class="notification-mark-read">Đánh dấu đã đọc</button><button type="button" class="notification-clear-all">Xóa hết</button></div></div><div class="notification-list"></div></section>`;
    host.prepend(center);
    const toggle = center.querySelector('.notification-toggle');
    const panel = center.querySelector('.notification-panel');
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) renderList();
    });
    center.querySelector('.notification-mark-read').addEventListener('click', () => {
      const items = readAll();
      items.forEach(item => { if (item.recipientIds.includes(current.id) && !item.readBy.includes(current.id)) item.readBy.push(current.id); });
      saveAll(items);
      renderList();
    });
    center.querySelector('.notification-clear-all').addEventListener('click', () => {
      const notices = readAll().filter(item => item.recipientIds.includes(current.id));
      if (!notices.length) return;
      showConfirmModal('Xóa tất cả thông báo', 'Bạn có chắc muốn xóa toàn bộ thông báo của tài khoản này?', () => {
        const remaining = readAll().map(item => ({ ...item, recipientIds: item.recipientIds.filter(id => id !== current.id), readBy: item.readBy.filter(id => id !== current.id) })).filter(item => item.recipientIds.length);
        saveAll(remaining);
        renderList();
        showToast('Đã xóa toàn bộ thông báo.', 'success');
      });
    });
    center.querySelector('.notification-list').addEventListener('click', event => {
      const deleteButton = event.target.closest('[data-delete-notification]');
      if (deleteButton) {
        event.preventDefault();
        event.stopPropagation();
        const id = deleteButton.dataset.deleteNotification;
        const remaining = readAll().map(item => item.id !== id ? item : ({ ...item, recipientIds: item.recipientIds.filter(userId => userId !== current.id), readBy: item.readBy.filter(userId => userId !== current.id) })).filter(item => item.recipientIds.length);
        saveAll(remaining);
        renderList();
        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        return;
      }
      const link = event.target.closest('[data-notification-task]');
      if (!link) return;
      const items = readAll();
      const item = items.find(notice => notice.id === link.dataset.notificationId);
      if (item && !item.readBy.includes(current.id)) item.readBy.push(current.id);
      saveAll(items);
      window.location.href = `task-detail.html?id=${encodeURIComponent(link.dataset.notificationTask)}`;
    });
    document.addEventListener('click', event => {
      if (!center.contains(event.target)) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
    });
    window.addEventListener('storage', renderList);
    window.addEventListener('task-notifications-updated', renderList);
    renderList();

    function renderList() {
      const notices = readAll().filter(item => item.recipientIds.includes(current.id));
      const unread = notices.filter(item => !item.readBy.includes(current.id)).length;
      const badge = center.querySelector('.notification-count');
      badge.hidden = unread === 0;
      badge.textContent = unread > 99 ? '99+' : String(unread);
      const list = center.querySelector('.notification-list');
      list.innerHTML = notices.length ? notices.map(item => `<article class="notification-item${item.readBy.includes(current.id) ? '' : ' is-unread'}"><button type="button" class="notification-item-content" data-notification-id="${escapeHtml(item.id)}" data-notification-task="${escapeHtml(item.taskId || '')}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message)}</span><time>${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.createdAt))}</time></button><button type="button" class="notification-delete" data-delete-notification="${escapeHtml(item.id)}" aria-label="Xóa thông báo">×</button></article>`).join('') : '<p class="notification-empty">Chưa có thông báo.</p>';
    }
  }
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
