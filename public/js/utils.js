// utils.js - Các hàm tiện ích hỗ trợ tính toán, định dạng dữ liệu (ES6+)

function parseLocalCalendarDate(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const d = new Date(year, month, day);
  return (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) ? d : null;
}

/**
 * Định dạng ngày giờ chuẩn hiển thị thân thiện (DD/MM/YYYY hoặc DD/MM/YYYY HH:mm)
 * @param {string|Date} dateStr 
 * @param {string} timeStr
 * @returns {string}
 */
export const formatDate = (dateStr, timeStr = '') => {
  if (!dateStr) return 'N/A';
  const d = (typeof dateStr === 'string' && parseLocalCalendarDate(dateStr)) || new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const cleanTime = /^(\d{2}:\d{2})/.exec(String(timeStr || '').trim())?.[1];
  return cleanTime ? `${day}/${month}/${year} ${cleanTime}` : `${day}/${month}/${year}`;
};

/**
 * Tạo ID ngẫu nhiên duy nhất cho task / category
 * @returns {string}
 */
export const generateId = () => {
  return 'task_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
};

/**
 * Kiểm tra xem một hạn chót (deadline + giờ) đã quá hạn hay chưa
 * @param {string} deadlineStr 
 * @param {string} status 
 * @param {string} deadlineTime
 * @returns {boolean}
 */
export const isOverdue = (deadlineStr, status, deadlineTime = '') => {
  if (!deadlineStr || ['completed', 'cancelled'].includes(status)) return false;
  const deadline = (typeof deadlineStr === 'string' && parseLocalCalendarDate(deadlineStr)) || new Date(deadlineStr);
  if (isNaN(deadline.getTime())) return false;
  const timeMatch = /^(\d{2}):(\d{2})/.exec(String(deadlineTime || '').trim());
  if (timeMatch) {
    deadline.setHours(Math.min(23, Number(timeMatch[1])), Math.min(59, Number(timeMatch[2])), 59, 999);
  } else {
    deadline.setHours(23, 59, 59, 999);
  }
  return deadline < new Date();
};

export const getTaskProgress = task => {
  if (task?.status === 'completed') return 100;
  const subtasks = Array.isArray(task?.subtasks) ? task.subtasks : [];
  if (!subtasks.length) return 0;
  return Math.round((subtasks.filter(item => item?.done).length / subtasks.length) * 100);
};

/**
 * Chuyển đổi tên status tiếng Anh sang label tiếng Việt hiển thị
 * @param {string} status 
 * @returns {{ label: string, className: string }}
 */
export const getStatusMeta = (status) => {
  const metaMap = {
    'request-pending': { label: 'Yêu cầu chờ duyệt', className: 'badge-status-awaiting-review' },
    'pending': { label: 'Ch\u1edd', className: 'badge-status-pending' },
    'in-progress': { label: '\u0110ang l\u00e0m', className: 'badge-status-in-progress' },
    'awaiting-review': { label: 'Ch\u1edd duy\u1ec7t', className: 'badge-status-awaiting-review' },
    'needs-revision': { label: 'C\u1EA7n l\u00e0m l\u1EA1i', className: 'badge-status-needs-revision' },
    'completed': { label: 'Ho\u00e0n th\u00e0nh', className: 'badge-status-completed' },
    'cancelled': { label: '\u0110\u00e3 h\u1EE7y', className: 'badge-status-cancelled' }
  };
  return metaMap[status] || { label: status || 'Not updated', className: 'badge-status-pending' };
};

/**
 * Chuyển đổi mức độ ưu tiên sang label tiếng Việt hiển thị
 * @param {string} priority 
 * @returns {{ label: string, className: string }}
 */
export const getPriorityMeta = (priority) => {
  const metaMap = {
    'low': { label: 'Th\u1EA5p', className: 'badge-priority-low' },
    'medium': { label: 'Trung b\u00ecnh', className: 'badge-priority-medium' },
    'high': { label: 'Cao', className: 'badge-priority-high' }
  };
  return metaMap[priority] || { label: priority, className: '' };
};

/**
 * Lấy tham số truy vấn trên thanh URL (Query parameter)
 * @param {string} param 
 * @returns {string|null}
 */
export const getQueryParam = (param) => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
};

function escapeAttrAndText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

/**
 * Tạo HTML cụm Avatar xếp chồng (Stacked Avatar Group) cho công việc cá nhân hoặc nhóm
 * @param {object} task
 * @param {Array<object>} users
 * @param {{ compact?: boolean }} options
 * @returns {string}
 */
export const renderAvatarStackHtml = (task, users = [], { compact = false } = {}) => {
  const ids = Array.isArray(task?.assigneeIds) && task.assigneeIds.length
    ? [...new Set(task.assigneeIds.filter(Boolean))]
    : (task?.assigneeId ? [task.assigneeId] : (task?.status === 'request-pending' ? [] : (task?.ownerId ? [task.ownerId] : [])));

  if (task?.status === 'request-pending' || !ids.length) {
    return '<span class="assignee-unassigned">Chờ phân công</span>';
  }

  const members = ids.map(id => users.find(u => u.id === id)).filter(Boolean);
  if (!members.length) {
    return '<span class="assignee-unassigned">Đang cập nhật</span>';
  }

  const visibleMembers = members.slice(0, 3);
  const avatarsHtml = visibleMembers.map(member => {
    const label = escapeAttrAndText(`${member.name || member.username}${member.username ? ` (@${member.username})` : ''}`);
    const initials = escapeAttrAndText(
      String(member.name || member.username || '?')
        .trim()
        .split(/\s+/)
        .map(part => part[0])
        .slice(-2)
        .join('')
        .toUpperCase() || '?'
    );
    const hasPhoto = Boolean(member.avatar);
    return `<span class="assignee-avatar stack-item${hasPhoto ? ' has-photo' : ''}" data-tooltip="${label}">${
      hasPhoto ? `<img src="${escapeAttrAndText(member.avatar)}" alt="${escapeAttrAndText(member.name || '')}">` : initials
    }</span>`;
  }).join('');

  const teamBadge = members.length > 1
    ? `<span class="team-count-pill" data-tooltip="${escapeAttrAndText(members.map(m => m.name || m.username).join(', '))}">Nhóm ${members.length}</span>`
    : '';
  const assigneeIdsAttr = escapeAttrAndText(members.map(m => m.id).join(','));
  const taskIdAttr = escapeAttrAndText(task?.id || '');
  const taskTitleAttr = escapeAttrAndText(task?.title || '');
  const triggerHint = members.length > 1
    ? 'Nhấn để xem danh sách người thực hiện'
    : 'Nhấn để xem thông tin chi tiết';

  return `<span class="task-assignee is-interactive" role="button" tabindex="0" aria-label="${triggerHint}" data-assignee-ids="${assigneeIdsAttr}" data-task-id="${taskIdAttr}" data-task-title="${taskTitleAttr}"><span class="avatar-stack">${avatarsHtml}</span>${teamBadge}</span>`;
};

