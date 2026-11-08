// utils.js - Các hàm tiện ích hỗ trợ tính toán, định dạng dữ liệu (ES6+)

/**
 * Định dạng ngày giờ chuẩn hiển thị thân thiện (DD/MM/YYYY)
 * @param {string|Date} dateStr 
 * @returns {string}
 */
export const formatDate = (dateStr) => {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

/**
 * Tạo ID ngẫu nhiên duy nhất cho task / category
 * @returns {string}
 */
export const generateId = () => {
  return 'task_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
};

/**
 * Kiểm tra xem một hạn chót (deadline) đã quá hạn hay chưa
 * @param {string} deadlineStr 
 * @param {string} status 
 * @returns {boolean}
 */
export const isOverdue = (deadlineStr, status) => {
  if (!deadlineStr || ['completed', 'cancelled'].includes(status)) return false;
  const deadline = new Date(deadlineStr);
  const now = new Date();
  // So sánh đến cuối ngày của deadline
  deadline.setHours(23, 59, 59, 999);
  return deadline < now;
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

