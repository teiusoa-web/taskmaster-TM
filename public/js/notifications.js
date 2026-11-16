import { Auth } from './auth.js';
import { Storage } from './storage.js';
import { showConfirmModal, showToast } from './main.js';

const NOTIFICATIONS_KEY = 'DACK_NOTIFICATIONS_V1';
const DEADLINE_REMINDERS_KEY = 'DACK_DEADLINE_REMINDERS_V2';
const SESSION_PROMPT_KEY = 'DACK_DEADLINE_FORM_PROMPTED';

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
  items.unshift({
    id: `notice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    message,
    taskId,
    type,
    recipientIds: recipients,
    readBy: [],
    createdAt: new Date().toISOString()
  });
  saveAll(items.slice(0, 300));
  window.dispatchEvent(new Event('task-notifications-updated'));
}

function relevantManagers(excludeId) {
  return Auth.getUsers()
    .filter(user => user.active && ['admin', 'manager'].includes(user.role) && user.id !== excludeId)
    .map(user => user.id);
}

function getAllActiveTasks() {
  if (Storage.isReady()) {
    return Storage.getTasks();
  }
  try { return JSON.parse(localStorage.getItem('DACK_TASKS_LIST') || '[]'); }
  catch { return []; }
}

export function getDeadlineInfo(task) {
  if (!task?.deadline || ['completed', 'cancelled'].includes(task.status)) {
    return { isNear: false, daysLeft: null, label: '', urgency: 'normal' };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${task.deadline}T00:00:00`);
  if (Number.isNaN(due.getTime())) {
    return { isNear: false, daysLeft: null, label: '', urgency: 'normal' };
  }
  const daysLeft = Math.round((due - today) / 86400000);
  if (daysLeft > 3) {
    return { isNear: false, daysLeft, label: `Còn ${daysLeft} ngày`, urgency: 'normal' };
  }
  if (daysLeft < 0) {
    return {
      isNear: true,
      daysLeft,
      label: `Quá hạn ${Math.abs(daysLeft)} ngày`,
      urgency: 'overdue'
    };
  }
  if (daysLeft === 0) {
    return {
      isNear: true,
      daysLeft: 0,
      label: 'Hạn chót hôm nay!',
      urgency: 'today'
    };
  }
  return {
    isNear: true,
    daysLeft,
    label: 'Sắp đến hạn',
    urgency: 'soon'
  };
}

function getTaskAssigneeIds(task) {
  if (Array.isArray(task?.assigneeIds) && task.assigneeIds.length) {
    return [...new Set(task.assigneeIds.filter(Boolean))];
  }
  return task?.assigneeId ? [task.assigneeId] : [];
}

function getNearDeadlineTasksForUser(user) {
  if (!user) return [];
  const tasks = getAllActiveTasks();
  return tasks
    .filter(task => {
      const info = getDeadlineInfo(task);
      if (!info.isNear) return false;
      if (user.role === 'admin') return true;
      return getTaskAssigneeIds(task).includes(user.id) || task.ownerId === user.id;
    })
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
}

function createDeadlineReminders(user) {
  if (!user) return [];
  let sent = {};
  try { sent = JSON.parse(localStorage.getItem(DEADLINE_REMINDERS_KEY) || '{}'); }
  catch { sent = {}; }

  const nearTasks = getNearDeadlineTasksForUser(user);
  nearTasks.forEach(task => {
    const info = getDeadlineInfo(task);
    const kind = info.daysLeft < 0 ? 'overdue' : 'upcoming';
    const reminderId = `${user.id}:${task.id}:${kind}:${task.deadline}`;
    if (sent[reminderId]) return;
    sent[reminderId] = true;
    addNotification({
      recipientIds: [user.id],
      title: info.daysLeft < 0 ? 'Công việc đã quá hạn hoàn thành' : 'Công việc gần đến hạn hoàn thành',
      message: `${task.title} (${info.label} - hạn ${task.deadline}). Nhấn để gửi lời nhắn hoặc cập nhật.`,
      taskId: task.id,
      type: `deadline-${kind}`
    });
  });

  try { localStorage.setItem(DEADLINE_REMINDERS_KEY, JSON.stringify(sent)); } catch {}
  return nearTasks;
}

function buildDefaultReminderMessage(task, currentUser) {
  const info = getDeadlineInfo(task);
  const users = Auth.getUsers();
  const assignee = users.find(u => u.id === task.assigneeId);
  const isStaffSender = ['admin', 'manager'].includes(currentUser?.role) && !getTaskAssigneeIds(task).includes(currentUser?.id);

  if (isStaffSender) {
    return `Xin chào ${assignee?.name || 'bạn'}, công việc "${task.title}" ${info.daysLeft < 0 ? `đã quá hạn (${task.deadline})` : `sắp đến hạn hoàn thành vào ngày ${task.deadline} (${info.label})`}. Vui lòng kiểm tra các mục checklist và gửi báo cáo tiến độ sớm nhé!`;
  }
  return `Báo cáo nhanh về công việc "${task.title}" (hạn ${task.deadline}): Tôi đã nắm được thời hạn và đang tập trung hoàn thiện để bàn giao đúng tiến độ.`;
}

export const Notifications = {
  getDeadlineInfo,
  taskAssigned(task, actor) {
    const assigneeIds = getTaskAssigneeIds(task);
    if (!assigneeIds.length) return;
    const users = Auth.getUsers();
    const recipientIds = [...assigneeIds, ...relevantManagers(actor?.id)];
    const assigneeNames = assigneeIds
      .map(id => users.find(u => u.id === id)?.name)
      .filter(Boolean)
      .join(', ');
    const isTeam = assigneeIds.length > 1;
    addNotification({
      recipientIds,
      title: isTeam ? `Công việc nhóm mới (${assigneeIds.length} người)` : 'Công việc mới được giao',
      message: `${actor?.name || 'Tài khoản'} đã giao “${task.title}” cho ${assigneeNames || 'bạn'}.`,
      taskId: task.id,
      type: 'assignment'
    });
  },
  taskReported(task, report, actor) {
    if (!task || !actor) return;
    const recipientIds = [...relevantManagers(actor.id), task.ownerId].filter(id => id && id !== actor.id);
    addNotification({ recipientIds, title: 'Có báo cáo công việc mới', message: `@${actor.username} đã báo cáo “${task.title}”.`, taskId: task.id, type: 'report' });
  },
  taskCommented(task, comment, actor, replyTo = null) {
    if (!task || !actor) return;
    const recipients = [...new Set([task.ownerId, ...getTaskAssigneeIds(task), replyTo?.userId, ...relevantManagers(actor.id)].filter(id => id && id !== actor.id))];
    const title = replyTo?.name ? 'Phản hồi mới trong công việc' : 'Bình luận mới trong công việc';
    addNotification({ recipientIds: recipients, title, message: `@${actor.username}: ${String(comment || '').slice(0, 120)} - ${task.title}`, taskId: task.id, type: 'comment' });
  },
  subtaskCommented(task, subtaskTitle, preview, actor, replyToUserId = null) {
    if (!task || !actor) return;
    const recipients = [...new Set([task.ownerId, ...getTaskAssigneeIds(task), replyToUserId, ...relevantManagers(actor.id)].filter(id => id && id !== actor.id))];
    addNotification({
      recipientIds: recipients,
      title: `Trao đổi mới ở checklist: ${subtaskTitle || task.title}`,
      message: `@${actor.username}: ${String(preview || 'Đã gửi tệp đính kèm').slice(0, 120)} - ${task.title}`,
      taskId: task.id,
      type: 'comment'
    });
  },
  deadlineReminderSent(task, message, actor, recipientIds) {
    if (!task || !actor) return;
    const targets = recipientIds?.length
      ? recipientIds
      : [...new Set([...getTaskAssigneeIds(task), task.ownerId, ...relevantManagers(actor.id)].filter(id => id && id !== actor.id))];
    addNotification({
      recipientIds: targets,
      title: `Nhắc hạn công việc: ${task.title}`,
      message: `${actor.name || actor.username}: "${String(message || '').slice(0, 140)}"`,
      taskId: task.id,
      type: 'deadline-message'
    });
  },
  completionRequestWithdrawn(task, actor) {
    if (!task || !actor) return;
    const admins = Auth.getUsers().filter(user => user.active && user.role === 'admin').map(user => user.id);
    addNotification({ recipientIds: admins, title: 'Yêu cầu hoàn thành đã thu hồi', message: `@${actor.username} đã thu hồi yêu cầu hoàn thành “${task.title}”.`, taskId: task.id, type: 'completion-withdrawn' });
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
    const assigneeIds = getTaskAssigneeIds(task);
    if (!assigneeIds.length || !actor) return;
    const activeRecipients = Auth.getUsers().filter(user => assigneeIds.includes(user.id) && user.active).map(user => user.id);
    if (!activeRecipients.length) return;
    const result = decision === 'approved' ? 'đã duyệt yêu cầu hủy' : 'đã từ chối yêu cầu hủy; bạn cần tiếp tục công việc';
    addNotification({ recipientIds: activeRecipients, title: 'Yêu cầu hủy đã được xem xét', message: `${actor.name} ${result} “${task.title}”.`, taskId: task.id, type: 'cancellation-review' });
  },
  reportReviewed(task, review, actor) {
    const assigneeIds = getTaskAssigneeIds(task);
    if (!assigneeIds.length || !actor) return;
    const activeRecipients = Auth.getUsers().filter(user => assigneeIds.includes(user.id) && user.active).map(user => user.id);
    if (!activeRecipients.length) return;
    const outcome = review.decision === 'approved' ? 'Đã duyệt hoàn thành' : 'yêu cầu bạn làm lại công việc';
    const score = review.score ? ` Điểm đánh giá: ${review.score}/10.` : '';
    addNotification({ recipientIds: activeRecipients, title: 'Admin đã đánh giá công việc', message: `${actor.name} ${outcome} báo cáo “${task.title}”.${score}${review.comment ? ` Nhận xét: ${review.comment}` : ''}`, taskId: task.id, type: 'review' });
  },
  deadlineChangeRequested(task, actor) {
    if (!task || !actor) return;
    const admins = Auth.getUsers().filter(user => user.active && user.role === 'admin').map(user => user.id);
    addNotification({ recipientIds: admins, title: 'Yêu cầu đổi hạn chót', message: `@${actor.username} xin dời hạn công việc: ${task.title}`, taskId: task.id, type: 'deadline-change' });
  },
  deadlineChangeReviewed(task, decision, actor) {
    const assigneeIds = getTaskAssigneeIds(task);
    if (!assigneeIds.length || !actor) return;
    addNotification({ recipientIds: assigneeIds, title: 'Yêu cầu đổi hạn đã được xem xét', message: `${actor.name} ${decision === 'approved' ? 'đã duyệt' : 'đã từ chối'} yêu cầu đổi hạn cho: ${task.title}`, taskId: task.id, type: 'deadline-change-review' });
  },

  openDeadlineReminderModal(targetTaskOrId = null, customTaskList = null) {
    const currentUser = Auth.getCurrentUser();
    if (!currentUser) return;

    const allTasks = getAllActiveTasks();
    let nearTasks = Array.isArray(customTaskList) && customTaskList.length
      ? customTaskList
      : getNearDeadlineTasksForUser(currentUser);

    let initialTask = null;
    if (targetTaskOrId && typeof targetTaskOrId === 'object') {
      initialTask = targetTaskOrId;
    } else if (typeof targetTaskOrId === 'string' && targetTaskOrId) {
      initialTask = allTasks.find(t => t.id === targetTaskOrId) || null;
    }

    if (initialTask && !nearTasks.some(t => t.id === initialTask.id)) {
      nearTasks = [initialTask, ...nearTasks];
    }
    if (!initialTask && nearTasks.length) {
      initialTask = nearTasks[0];
    }
    if (!initialTask) {
      showToast('Hiện không có công việc nào sắp đến hạn hoàn thành.', 'success');
      return;
    }

    let modal = document.getElementById('deadline-reminder-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'deadline-reminder-modal';
      modal.className = 'modal-overlay deadline-reminder-overlay';
      document.body.appendChild(modal);
    }

    const users = Auth.getUsers();
    const renderModalForTask = selectedTask => {
      const info = getDeadlineInfo(selectedTask);
      const assignee = users.find(u => u.id === selectedTask.assigneeId);
      const owner = users.find(u => u.id === selectedTask.ownerId) || users.find(u => u.role === 'admin');
      const isStaffRemindingAssignee = ['admin', 'manager'].includes(currentUser.role) && !getTaskAssigneeIds(selectedTask).includes(currentUser.id);
      const recipientUser = isStaffRemindingAssignee ? (assignee || owner) : (owner || assignee);
      const defaultMsg = buildDefaultReminderMessage(selectedTask, currentUser);

      const quickPresets = isStaffRemindingAssignee
        ? [
            {
              label: 'Nhắc cập nhật & gửi báo cáo',
              text: 'Công việc sắp đến hạn hoàn thành, vui lòng cập nhật tiến độ và gửi báo cáo.'
            },
            {
              label: 'Nhắc hoàn tất checklist',
              text: 'Nhắc nhở: Hạn chót sắp tới, hãy hoàn tất các mục checklist còn lại.'
            },
            {
              label: 'Gợi ý xin gia hạn sớm',
              text: 'Nếu gặp khó khăn cần gia hạn, vui lòng gửi yêu cầu đổi hạn chót sớm.'
            }
          ]
        : [
            {
              label: 'Đang hoàn thiện bước cuối',
              text: 'Tôi đang hoàn thiện các bước cuối và sẽ nộp báo cáo đúng hạn.'
            },
            {
              label: 'Đang kiểm tra trước khi nộp',
              text: 'Đã hoàn thành phần chính, đang kiểm tra lại trước khi gửi duyệt.'
            },
            {
              label: 'Cập nhật tiến độ phát sinh',
              text: 'Công việc phát sinh thêm hạng mục, tôi xin phép cập nhật tiến độ hiện tại.'
            }
          ];

      const taskSelectHtml = nearTasks.length > 1
        ? `
          <label class="form-group deadline-modal-task-select-group">
            <span class="form-label">Chọn công việc sắp đến hạn (${nearTasks.length} công việc)</span>
            <select id="deadline-modal-task-select" class="form-control">
              ${nearTasks.map(item => {
                const itemInfo = getDeadlineInfo(item);
                return `<option value="${escapeHtml(item.id)}" ${item.id === selectedTask.id ? 'selected' : ''}>${escapeHtml(item.title)} — ${escapeHtml(itemInfo.label || item.deadline)}</option>`;
              }).join('')}
            </select>
          </label>
        `
        : '';

      modal.innerHTML = `
        <div class="modal-card deadline-reminder-card" role="dialog" aria-modal="true" aria-labelledby="deadline-modal-title">
          <div class="deadline-modal-header">
            <div class="deadline-modal-icon is-${escapeHtml(info.urgency)}" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
            </div>
            <div class="deadline-modal-heading-text">
              <span class="deadline-modal-eyebrow">CẢNH BÁO TIẾN ĐỘ &bull; NHẮC HẠN</span>
              <h3 class="modal-title" id="deadline-modal-title">
                ${isStaffRemindingAssignee ? 'Gửi Form Nhắn Nhắc Hạn Công Việc' : 'Công Việc Gần Đến Hạn Hoàn Thành'}
              </h3>
            </div>
            <button type="button" class="deadline-modal-close" id="deadline-modal-close" aria-label="Đóng">&times;</button>
          </div>

          ${taskSelectHtml}

          <div class="deadline-task-summary">
            <div class="deadline-task-summary-top">
              <strong class="deadline-task-name">${escapeHtml(selectedTask.title)}</strong>
              <span class="deadline-urgency-pill is-${escapeHtml(info.urgency)}">${escapeHtml(info.label || `Hạn: ${selectedTask.deadline}`)}</span>
            </div>
            <div class="deadline-task-meta">
              <span><strong>Hạn hoàn thành:</strong> ${escapeHtml(selectedTask.deadline || '—')}</span>
              <span><strong>Người nhận tin:</strong> ${escapeHtml(recipientUser?.name || 'Quản trị viên')}${recipientUser?.email ? ` (${escapeHtml(recipientUser.email)})` : ''}</span>
            </div>
          </div>

          <form id="deadline-reminder-form" class="deadline-reminder-form">
            <div class="deadline-presets-wrap">
              <span class="form-label">Chọn mẫu câu nhắn nhanh:</span>
              <div class="deadline-preset-chips">
                ${quickPresets.map(preset => `<button type="button" class="deadline-preset-chip" data-preset-msg="${escapeHtml(preset.text)}">${escapeHtml(preset.label)}</button>`).join('')}
              </div>
            </div>

            <label class="form-group">
              <span class="form-label">Nội dung lời nhắn / phản hồi tiến độ</span>
              <textarea id="deadline-reminder-message" class="form-control" rows="2" maxlength="1500" required>${escapeHtml(defaultMsg)}</textarea>
            </label>

            <label class="deadline-email-check">
              <input type="checkbox" id="deadline-send-email-checkbox" checked>
              <span>Đồng thời gửi thông báo nhắc hạn tới Email của <strong>${escapeHtml(recipientUser?.name || 'người nhận')}</strong></span>
            </label>

            <div class="deadline-modal-actions">
              <a href="task-detail.html?id=${encodeURIComponent(selectedTask.id)}" class="btn btn-secondary btn-sm">Xem chi tiết việc</a>
              <div class="deadline-modal-submit-group">
                <button type="button" class="btn btn-secondary" id="deadline-modal-cancel">Để sau</button>
                <button type="submit" class="btn btn-primary" id="deadline-modal-submit">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg>
                  <span>Gửi lời nhắn</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      `;

      modal.classList.add('active');

      const close = () => {
        modal.classList.remove('active');
      };

      modal.querySelector('#deadline-modal-close')?.addEventListener('click', close);
      modal.querySelector('#deadline-modal-cancel')?.addEventListener('click', close);
      modal.onclick = event => {
        if (event.target === modal) close();
      };

      const taskSelect = modal.querySelector('#deadline-modal-task-select');
      taskSelect?.addEventListener('change', () => {
        const nextTask = nearTasks.find(t => t.id === taskSelect.value) || allTasks.find(t => t.id === taskSelect.value);
        if (nextTask) renderModalForTask(nextTask);
      });

      const msgInput = modal.querySelector('#deadline-reminder-message');
      modal.querySelectorAll('.deadline-preset-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          if (msgInput) {
            msgInput.value = chip.dataset.presetMsg || '';
            msgInput.focus();
          }
        });
      });

      const form = modal.querySelector('#deadline-reminder-form');
      form?.addEventListener('submit', async event => {
        event.preventDefault();
        const message = String(msgInput?.value || '').trim();
        if (!message) {
          showToast('Vui lòng nhập nội dung lời nhắn.', 'warning');
          return;
        }
        const sendEmail = Boolean(modal.querySelector('#deadline-send-email-checkbox')?.checked);
        const submitBtn = modal.querySelector('#deadline-modal-submit');
        const submitSpan = submitBtn?.querySelector('span') || submitBtn;
        if (submitBtn) submitBtn.disabled = true;
        if (submitSpan) submitSpan.textContent = 'Đang gửi...';

        try {
          const taggedComment = `[Nhắc hạn hoàn thành · ${info.label || selectedTask.deadline}] ${message}`;
          Storage.addTaskComment(selectedTask.id, taggedComment);

          const teamIds = isStaffRemindingAssignee ? getTaskAssigneeIds(selectedTask) : [];
          const recipientIds = [...new Set([...teamIds, recipientUser?.id].filter(Boolean))];
          this.deadlineReminderSent(selectedTask, message, currentUser, recipientIds);

          if (sendEmail) {
            await Auth.sendDeadlineReminder({
              taskId: selectedTask.id,
              taskTitle: selectedTask.title,
              deadline: selectedTask.deadline,
              daysLeftText: info.label || 'Sắp đến hạn',
              message,
              recipientId: recipientUser?.id || ''
            }).catch(() => null);
          }

          window.dispatchEvent(new CustomEvent('task-deadline-message-sent', {
            detail: { taskId: selectedTask.id }
          }));

          close();
          showToast(`Đã gửi form nhắn nhắc hạn cho công việc "${selectedTask.title}"!`, 'success');
        } catch (error) {
          showToast(error.message || 'Không thể gửi lời nhắn nhắc hạn.', 'error');
          if (submitBtn) submitBtn.disabled = false;
          if (submitSpan) submitSpan.textContent = 'Gửi lời nhắn';
        }
      });
    };

    renderModalForTask(initialTask);
  },

  checkAndPromptDeadlineTasks() {
    const current = Auth.getCurrentUser();
    if (!current) return;
    const nearTasks = createDeadlineReminders(current);
    if (!nearTasks.length) return;

    // Tự động hiển thị Form Nhắn Nhắc Hạn 1 lần trong phiên làm việc khi phát hiện công việc gần đến hạn
    let alreadyPrompted = false;
    try { alreadyPrompted = sessionStorage.getItem(SESSION_PROMPT_KEY) === 'true'; } catch {}
    if (!alreadyPrompted) {
      try { sessionStorage.setItem(SESSION_PROMPT_KEY, 'true'); } catch {}
      setTimeout(() => {
        this.openDeadlineReminderModal(nearTasks[0], nearTasks);
      }, 450);
    }
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
    const themeToggle = host.querySelector('.theme-toggle');
    host.insertBefore(center, themeToggle || null);
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
      const remindBtn = event.target.closest('[data-open-deadline-form]');
      if (remindBtn) {
        event.preventDefault();
        event.stopPropagation();
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        this.openDeadlineReminderModal(remindBtn.dataset.openDeadlineForm);
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
      const toggle = center.querySelector('.notification-toggle');
      if (unread > 0) {
        badge.hidden = false;
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.classList.add('is-pulsing');
        toggle.classList.add('has-unread');
      } else {
        badge.hidden = true;
        badge.textContent = '';
        badge.classList.remove('is-pulsing');
        toggle.classList.remove('has-unread');
      }
      const list = center.querySelector('.notification-list');
      list.innerHTML = notices.length ? notices.map(item => {
        const isDeadlineType = String(item.type || '').startsWith('deadline-');
        const quickFormBtn = isDeadlineType && item.taskId
          ? `<button type="button" class="notification-remind-btn" data-open-deadline-form="${escapeHtml(item.taskId)}">Mở form nhắn nhắc hạn</button>`
          : '';
        return `<article class="notification-item${item.readBy.includes(current.id) ? '' : ' is-unread'}"><div class="notification-item-body"><button type="button" class="notification-item-content" data-notification-id="${escapeHtml(item.id)}" data-notification-task="${escapeHtml(item.taskId || '')}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message)}</span><time>${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.createdAt))}</time></button>${quickFormBtn}</div><button type="button" class="notification-delete" data-delete-notification="${escapeHtml(item.id)}" aria-label="Xóa thông báo">×</button></article>`;
      }).join('') : '<p class="notification-empty">Chưa có thông báo.</p>';
    }
  }
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
