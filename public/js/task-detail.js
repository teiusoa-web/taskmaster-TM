import { Auth } from './auth.js';
// task-detail.js - Quản lý trang Chi tiết công việc & Checklist con (Subtasks)
import { Storage } from './storage.js';
import { formatDate, getStatusMeta, getPriorityMeta, isOverdue, getQueryParam, generateId } from './utils.js';
import { showToast, showConfirmModal } from './main.js';
import { Notifications } from './notifications.js';
import { ReportAttachments } from './report-attachments.js';
import { uploadImage } from './uploads.js';

let currentTask = null;
const reportAttachmentUrls = new Set();
const subtaskSelectedFiles = new WeakMap();
const isImageAttachment = file => file.type.startsWith('image/') || /\.(avif|bmp|gif|jpe?g|png|svg|webp|tiff?)$/i.test(file.name);

document.addEventListener('DOMContentLoaded', async () => {
  await Storage.init();
  const taskId = getQueryParam('id');

  if (!taskId) {
    showToast('Thiếu mã công việc!', 'error');
    setTimeout(() => window.location.href = 'tasks.html', 1200);
    return;
  }

  currentTask = Storage.getTaskById(taskId);
  if (!currentTask) {
    showToast('Không tìm thấy công việc này!', 'error');
    setTimeout(() => window.location.href = 'tasks.html', 1200);
    return;
  }

  Storage._normalizeChecklists();
  currentTask = Storage.getTaskById(taskId);

  renderTaskDetail();
  setupSubtaskHandlers();
});

/**
 * Hiển thể chi tiết công việc
 */
function renderTaskDetail() {
  const categories = Storage.getCategories();
  const category = categories.find(c => c.id === currentTask.categoryId);
  const statusMeta = currentTask.requestReview?.status === 'rejected'
    ? { label: 'Yêu cầu bị từ chối', className: 'badge-status-cancelled' }
    : getStatusMeta(currentTask.status);
  const priorityMeta = getPriorityMeta(currentTask.priority);
  const overdue = isOverdue(currentTask.deadline, currentTask.status);

  document.getElementById('detail-title').textContent = currentTask.title;
  document.getElementById('detail-desc').textContent = currentTask.description || 'Chưa có mô tả chi tiết.';
  document.getElementById('detail-category').textContent = category ? category.name : 'Chưa phân loại';
  document.getElementById('detail-category-badge').style.background = category ? category.color : 'var(--primary)';
  
  const statusBadge = document.getElementById('detail-status');
  statusBadge.textContent = statusMeta.label;
  statusBadge.className = `badge ${statusMeta.className}`;
  setupAssigneeActions();
  setupRequestReview();
  const priorityBadge = document.getElementById('detail-priority');
  priorityBadge.textContent = priorityMeta.label;
  priorityBadge.className = `badge ${priorityMeta.className}`;

  document.getElementById('detail-deadline').textContent = formatDate(currentTask.deadline);
  if (overdue) {
    const overdueLabel = document.createElement('span');
    overdueLabel.style.cssText = 'color: var(--danger); font-weight: 700;';
    overdueLabel.textContent = ' (Đã quá hạn!)';
    document.getElementById('detail-deadline').append(overdueLabel);
  }
  document.getElementById('detail-created').textContent = formatDate(currentTask.createdAt);
  const assignee = Auth.getUsers().find(user => user.id === (currentTask.assigneeId || (currentTask.status === 'request-pending' ? '' : currentTask.ownerId)));
  const assigneeContainer = document.getElementById('detail-assignee');
  if (assigneeContainer) {
    assigneeContainer.replaceChildren();
    if (assignee) {
      const assigneeAvatar = document.createElement('span');
      assigneeAvatar.className = `assignee-avatar${assignee.avatar ? ' has-photo' : ''}`;
      if (assignee.avatar) {
        const photo = document.createElement('img');
        photo.src = assignee.avatar;
        photo.alt = '';
        assigneeAvatar.append(photo);
      } else {
        assigneeAvatar.textContent = assignee.name.split(/\s+/).map(part => part[0]).slice(-2).join('').toUpperCase();
      }
      const assigneeName = document.createElement('span');
      assigneeName.textContent = assignee.name;
      assigneeContainer.append(assigneeAvatar, assigneeName);
    } else {
      assigneeContainer.textContent = 'Ch\u01b0a ph\u00e2n c\u00f4ng';
    }
  }

  // Link sửa công việc
  const editLink = document.getElementById('btn-edit-link');
  const deleteButton = document.getElementById('btn-delete-task');
  if (Auth.canEditTask(currentTask)) editLink.href = `task-form.html?id=${currentTask.id}`;
  else { editLink.hidden = true; deleteButton.hidden = true; }

  // Nút xóa công việc
  deleteButton.onclick = null;
  if (!deleteButton.dataset.handlerAttached) deleteButton.addEventListener('click', () => {
    showConfirmModal(
      'Xóa công việc',
      `Bạn có chắc chắn muốn xóa "${currentTask.title}"?`,
      () => {
        const deleted = Storage.deleteTask(currentTask.id);
        if (deleted === false) { showToast('Không thể xóa công việc.', 'error'); return; }
        Promise.resolve(deleted).then(saved => { if (saved) { showToast('Đã xóa công việc.', 'success'); setTimeout(() => window.location.href = 'tasks.html', 700); } else showToast('Không thể đồng bộ thao tác xóa.', 'error'); });
      }
    );
  });
  deleteButton.dataset.handlerAttached = 'true';

  renderSubtaskList();
  setupTaskReports();
  renderTaskComments();
  renderTaskActivity();
  setupTaskComments();
  setupDeadlineChange();
}

function setupRequestReview() {
  document.getElementById('task-request-review-panel')?.remove();
  if (Auth.getCurrentUser()?.role !== 'admin' || !['request-pending', 'pending'].includes(currentTask.status) || !currentTask.requestReview) return;
  const panel = document.createElement('section');
  panel.id = 'task-request-review-panel';
  panel.className = 'task-request-review-panel';
  const heading = document.createElement('strong');
  heading.textContent = currentTask.requestReview.status === 'pending' ? 'Yêu cầu công việc đang chờ duyệt' : 'Yêu cầu đã được duyệt';
  panel.append(heading);
  if (currentTask.requestReview.status === 'pending') {
    const assigneeSelect = document.createElement('select');
    assigneeSelect.className = 'form-control';
    assigneeSelect.setAttribute('aria-label', 'Chọn người nhận công việc');
    assigneeSelect.add(new Option('Chọn người nhận công việc', ''));
    Auth.getUsers().filter(user => user.active && ['manager', 'user'].includes(user.role)).forEach(user => assigneeSelect.add(new Option(`${user.name} (@${user.username})`, user.id)));
    const comment = document.createElement('textarea');
    comment.className = 'form-control'; comment.rows = 2; comment.maxLength = 1000;
    comment.placeholder = 'Ghi chú cho người gửi (không bắt buộc)';
    const actions = document.createElement('div'); actions.className = 'task-request-review-actions';
    const approve = document.createElement('button'); approve.type = 'button'; approve.className = 'btn btn-primary btn-sm'; approve.textContent = 'Duyệt và giao việc';
    approve.addEventListener('click', () => {
      if (!assigneeSelect.value) { showToast('Chọn người nhận trước khi duyệt yêu cầu.', 'warning'); return; }
      if (!Storage.reviewTaskRequest(currentTask.id, 'approved', assigneeSelect.value, comment.value)) { showToast('Không thể duyệt yêu cầu.', 'error'); return; }
      currentTask = Storage.getTaskById(currentTask.id); renderTaskDetail(); showToast('Đã duyệt và giao công việc.', 'success');
    });
    const reject = document.createElement('button'); reject.type = 'button'; reject.className = 'btn btn-secondary btn-sm'; reject.textContent = 'Từ chối yêu cầu';
    reject.addEventListener('click', () => {
      if (!Storage.reviewTaskRequest(currentTask.id, 'rejected', '', comment.value)) { showToast('Không thể từ chối yêu cầu.', 'error'); return; }
      currentTask = Storage.getTaskById(currentTask.id); renderTaskDetail(); showToast('Đã từ chối yêu cầu công việc.', 'success');
    });
    actions.append(approve, reject); panel.append(assigneeSelect, comment, actions);
  } else if (currentTask.requestReview.comment) {
    const note = document.createElement('p'); note.textContent = currentTask.requestReview.comment; panel.append(note);
  }
  document.querySelector('.task-detail-card .task-detail-badges')?.after(panel);
}

function renderTaskActivity() {
  const container = document.getElementById('task-activity-list');
  if (!container) return;
  const activity = Array.isArray(currentTask.activity) ? currentTask.activity : [];
  container.innerHTML = activity.length ? activity.slice(0, 30).map(item => `<article class="activity-item"><span class="activity-dot"></span><div><strong>${escapeHtml(item.text || 'Cập nhật công việc')}</strong><p>${escapeHtml(item.userName || 'Người dùng')} · ${formatReportDateTime(item.createdAt)}</p></div></article>`).join('') : '<p class="text-muted">Hoạt động sẽ xuất hiện khi có cập nhật.</p>';
}

function setupAssigneeActions() {
  const actions = document.getElementById('assignee-task-actions');
  const acceptButton = document.getElementById('accept-task-button');
  const cancelButton = document.getElementById('cancel-task-button');
  const assignmentActions = document.getElementById('assignee-assignment-actions');
  const reportActions = document.getElementById('assignee-report-actions');
  const reopenButton = document.getElementById('reopen-task-button');
  const withdrawButton = document.getElementById('withdraw-cancellation-button');
  const user = Auth.getCurrentUser();
  const isAssignee = ['user', 'manager'].includes(user?.role) && currentTask.assigneeId === user.id;
  const isAdmin = user?.role === 'admin';
  if (!actions || !acceptButton || !cancelButton || !assignmentActions || !reportActions || !reopenButton || !withdrawButton) return;
  document.querySelector('.cancellation-pending-note')?.remove();
  document.querySelector('.cancellation-reopen-note')?.remove();
  const cancellationPending = currentTask.cancellationRequest?.status === 'pending';
  const isCancelled = currentTask.status === 'cancelled';
  acceptButton.hidden = !isAssignee || currentTask.status !== 'pending' || cancellationPending;
  cancelButton.hidden = !isAssignee || cancellationPending || isCancelled || currentTask.status === 'completed';
  reopenButton.hidden = !(isAssignee || user?.role === 'admin') || !isCancelled;
  withdrawButton.hidden = !isAssignee || !cancellationPending;
  actions.hidden = !isAssignee && user?.role !== 'admin' || (reopenButton.hidden && withdrawButton.hidden);
  assignmentActions.hidden = !isAssignee || (acceptButton.hidden && cancelButton.hidden);
  reportActions.hidden = !isAssignee || !Auth.canReportTask(currentTask);
  if (cancellationPending) {
    const notice = document.createElement('p');
    notice.className = 'cancellation-pending-note';
    notice.textContent = 'Yêu cầu hủy việc đang chờ admin xem xét.';
    actions.after(notice);
  }
  if (isCancelled && currentTask.cancellationRequest?.status !== 'pending') {
    const note = document.createElement('p');
    note.className = 'cancellation-reopen-note';
    note.textContent = 'Công việc này đã hủy. Có thể mở lại nếu hủy nhầm.';
    actions.after(note);
  }
  acceptButton.onclick = () => {
    if (!Storage.acceptTask(currentTask.id)) { showToast('Không thể xác nhận nhận việc.', 'error'); return; }
    currentTask = Storage.getTaskById(currentTask.id);
    renderTaskDetail();
    showToast('Bạn đã nhận công việc.', 'success');
  };
  cancelButton.onclick = () => {
    const reason = window.prompt('Vui lòng nhập lý do hủy công việc:');
    if (reason === null) return;
    if (!reason.trim()) { showToast('Cần nhập lý do để gửi yêu cầu hủy.', 'warning'); return; }
    if (!Storage.cancelAssignedTask(currentTask.id, reason)) { showToast('Không thể gửi yêu cầu hủy công việc.', 'error'); return; }
    Notifications.taskCancelled(currentTask, reason.trim(), user);
    currentTask = Storage.getTaskById(currentTask.id);
    renderTaskDetail();
    showToast('Yêu cầu hủy đã được gửi admin xem xét; trạng thái công việc chưa thay đổi.', 'success');
  };
  reopenButton.onclick = () => {
    if (!Storage.reopenCancelledTask(currentTask.id)) { showToast('Không thể mở lại công việc.', 'error'); return; }
    currentTask = Storage.getTaskById(currentTask.id);
    renderTaskDetail();
    showToast('Đã mở lại công việc, lịch sử vẫn được giữ.', 'success');
  };
  withdrawButton.onclick = () => {
    if (!Storage.withdrawCancellationRequest(currentTask.id)) { showToast('Không thể rút yêu cầu hủy.', 'error'); return; }
    currentTask = Storage.getTaskById(currentTask.id);
    renderTaskDetail();
    showToast('Đã rút yêu cầu hủy. Công việc tiếp tục với trạng thái hiện tại.', 'success');
  };
}

function setupTaskReports() {
  const card = document.getElementById('task-reports-card');
  const list = document.getElementById('task-reports-list');
  const form = document.getElementById('task-report-form');
  const input = document.getElementById('task-report-input');
  const fileInput = document.getElementById('task-report-file');
  const fileName = document.getElementById('task-report-file-name');
  const reportLabel = form?.querySelector('label[for="task-report-input"]');
  const progressButton = document.getElementById('submit-progress-report');
  const completionButton = document.getElementById('submit-completion-report');
  const withdrawActions = document.getElementById('completion-withdraw-actions');
  const withdrawCompletionButton = document.getElementById('withdraw-completion-request');
  const revisionButton = document.getElementById('admin-request-revision-button');
  if (!card || !list || !form) return;
  const user = Auth.getCurrentUser();
  const canReport = Auth.canReportTask(currentTask);
  const isAdmin = user?.role === 'admin';
  const canUseAssignmentActions = ['user', 'manager'].includes(user?.role) && currentTask.assigneeId === user.id && currentTask.status === 'pending' && currentTask.cancellationRequest?.status !== 'pending';
  const isAssignee = ['user', 'manager'].includes(user?.role) && currentTask.assigneeId === user.id;
  const cancellationPending = currentTask.cancellationRequest?.status === 'pending';
  const hasPendingCompletionReport = (currentTask.reports || []).some(report => report.type === 'completion' && report.userId === user?.id && !report.review && !report.withdrawnAt);
  const canWithdrawCompletion = isAssignee && currentTask.status === 'awaiting-review' && !cancellationPending && hasPendingCompletionReport;
  const hasReportHistory = (currentTask.reports || []).some(report => !(report.type === 'cancellation' && ['withdrawn', 'rejected'].includes(currentTask.cancellationRequest?.status)));
  const isAdminReviewingCompletedTask = user?.role === 'admin' && currentTask.status === 'completed';
  const showReportSection = canReport || hasReportHistory || isAdminReviewingCompletedTask;
  const adminHasRequestToReview = isAdmin && (currentTask.status === 'awaiting-review' || currentTask.deadlineChangeRequest?.status === 'pending' || currentTask.cancellationRequest?.status === 'pending');
  card.hidden = !showReportSection && !canUseAssignmentActions && !adminHasRequestToReview;
  const heading = card.querySelector('h3');
  if (heading) heading.hidden = !showReportSection;
  list.hidden = !showReportSection;
  form.hidden = isAdmin || (!canReport && !canUseAssignmentActions);
  if (reportLabel) reportLabel.hidden = !canReport;
  if (input) input.hidden = !canReport;
  if (fileInput) fileInput.hidden = !canReport;
  if (fileName) fileName.hidden = !canReport;
  const fileLabel = form.querySelector('label[for="task-report-file"]');
  const fileHelp = document.getElementById('task-report-file-help');
  if (fileLabel) fileLabel.hidden = !canReport;
  if (fileHelp) fileHelp.hidden = !canReport;
  if (progressButton) progressButton.hidden = !canReport;
  if (completionButton) completionButton.hidden = !canReport;
  if (withdrawActions) withdrawActions.hidden = !canWithdrawCompletion;
  if (withdrawCompletionButton) withdrawCompletionButton.onclick = () => {
    if (!window.confirm('B\u1ea1n c\u00f3 mu\u1ed1n thu h\u1ed3i y\u00eau c\u1ea7u ho\u00e0n th\u00e0nh kh\u00f4ng?')) return;
    if (!Storage.withdrawTaskCompletionRequest(currentTask.id)) {
      showToast('Kh\u00f4ng th\u1ec3 thu h\u1ed3i y\u00eau c\u1ea7u ho\u00e0n th\u00e0nh.', 'error');
      return;
    }
    Notifications.completionRequestWithdrawn(currentTask, Auth.getCurrentUser());
    currentTask = Storage.getTaskById(currentTask.id);
    renderTaskDetail();
    showToast('\u0110\u00e3 thu h\u1ed3i y\u00eau c\u1ea7u. C\u00f4ng vi\u1ec7c tr\u1edf l\u1ea1i tr\u1ea1ng th\u00e1i tr\u01b0\u1edbc \u0111\u00f3.', 'success');
  };
  if (revisionButton) {
    revisionButton.hidden = Auth.getCurrentUser()?.role !== 'admin' || currentTask.status !== 'completed';
    revisionButton.onclick = () => {
      const reason = window.prompt('Nhập lý do yêu cầu người dùng làm lại công việc:');
      if (reason === null) return;
      if (!reason.trim()) {
        showToast('Cần nhập lý do trước khi yêu cầu làm lại.', 'warning');
        return;
      }
      if (!Storage.requestTaskRevision(currentTask.id, reason)) {
        showToast('Không thể chuyển công việc sang trạng thái cần làm lại.', 'error');
        return;
      }
      Notifications.reportReviewed(currentTask, { decision: 'rejected', comment: reason.trim() }, Auth.getCurrentUser());
      currentTask = Storage.getTaskById(currentTask.id);
      renderTaskDetail();
      showToast('Đã chuyển công việc sang Cần làm lại và gửi nhận xét cho người dùng.', 'success');
    };
  }
  if (heading) heading.textContent = Auth.canManageTasks() ? 'Báo cáo của người thực hiện' : 'Báo cáo tiến độ công việc';
  renderTaskReports(list);
  if (fileInput && !fileInput.dataset.handlerAttached) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) {
        if (fileName) fileName.textContent = '';
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        showToast('Tệp đính kèm không được vượt quá 25 MB.', 'warning');
        fileInput.value = '';
        if (fileName) fileName.textContent = '';
        return;
      }
      if (isImageAttachment(file) && Auth.getCurrentUser()?.role !== 'user') {
        showToast('Chỉ tài khoản người dùng mới được đính kèm ảnh.', 'warning');
        fileInput.value = '';
        if (fileName) fileName.textContent = '';
        return;
      }
      if (fileName) fileName.textContent = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
    });
    fileInput.dataset.handlerAttached = 'true';
  }
  if (Auth.getCurrentUser()?.role === 'admin') list.onclick = handleReportReview;
  if (!canReport) return;
  if (!form.dataset.handlerAttached) form.addEventListener('submit', async event => {
    event.preventDefault();
    const isCompletion = event.submitter?.id === 'submit-completion-report';
    if (isCompletion) {
      const checklist = Array.isArray(currentTask.subtasks) ? currentTask.subtasks : [];
      if (checklist.length < 1) {
        showToast('Th\u00eam \u00edt nh\u1ea5t m\u1ed9t m\u1ee5c checklist tr\u01b0\u1edbc khi y\u00eau c\u1ea7u ho\u00e0n th\u00e0nh.', 'warning');
        return;
      }
      if (checklist.some(item => !item.done)) {
        showToast('Ho\u00e0n t\u1ea5t t\u1ea5t c\u1ea3 m\u1ee5c checklist tr\u01b0\u1edbc khi y\u00eau c\u1ea7u ho\u00e0n th\u00e0nh.', 'warning');
        return;
      }
    }
    if (!input.value.trim()) {
      showToast('Nh\u1eadp n\u1ed9i dung b\u00e1o c\u00e1o tr\u01b0\u1edbc khi g\u1eedi.', 'warning');
      return;
    }
    const file = fileInput?.files?.[0];
    const attachments = [];
    if (file) {
      if (file.size > 25 * 1024 * 1024) {
        showToast('Tệp đính kèm không được vượt quá 25 MB.', 'warning');
        return;
      }
      const attachmentId = generateId();
      try {
        if (isImageAttachment(file)) {
          const uploaded = await uploadImage(file, 'attachment');
          attachments.push({ ...uploaded, storage: 'disk' });
        } else {
          await ReportAttachments.save(attachmentId, file);
          attachments.push({ id: attachmentId, name: file.name, type: file.type || 'application/octet-stream', size: file.size, storage: 'browser' });
        }
      } catch {
        showToast('Không thể lưu tệp đính kèm trong trình duyệt.', 'error');
        return;
      }
    }
    const saved = isCompletion
      ? Storage.submitTaskForReview(currentTask.id, input.value, attachments)
      : Storage.addTaskReport(currentTask.id, input.value, attachments);
    if (!saved) {
      await Promise.all(attachments.map(item => ReportAttachments.remove(item.id).catch(() => {})));
      showToast('Kh\u00f4ng th\u1ec3 l\u01b0u b\u00e1o c\u00e1o.', 'error');
      return;
    }
    const report = { text: input.value.trim() };
    if (isCompletion) Notifications.completionSubmitted(currentTask, report, Auth.getCurrentUser());
    else Notifications.taskReported(currentTask, report, Auth.getCurrentUser());
    currentTask = Storage.getTaskById(currentTask.id);
    input.value = '';
    if (fileInput) fileInput.value = '';
    if (fileName) fileName.textContent = '';
    renderTaskDetail();
    showToast(isCompletion ? 'Đã gửi yêu cầu hoàn thành, chờ admin duyệt.' : 'Đã gửi báo cáo tiến độ', 'success');
  });
  form.dataset.handlerAttached = 'true';
}

function handleReportReview(event) {
  const cancellationButton = event.target.closest('[data-review-cancellation]');
  if (cancellationButton) {
    const decision = cancellationButton.dataset.decision;
    const commentInput = document.getElementById('cancellation-review-comment');
    if (!Storage.reviewCancellationRequest(currentTask.id, decision, commentInput?.value || '')) {
      showToast('Không thể lưu quyết định về yêu cầu hủy.', 'error');
      return;
    }
    Notifications.cancellationReviewed(currentTask, decision, Auth.getCurrentUser());
    currentTask = Storage.getTaskById(currentTask.id);
    renderTaskDetail();
    showToast(decision === 'approved' ? 'Đã duyệt hủy; công việc được giữ lại với trạng thái Đã hủy.' : 'Đã từ chối yêu cầu hủy; công việc tiếp tục.', 'success');
    return;
  }
  const button = event.target.closest('[data-review-report]');
  if (!button) return;
  const report = (currentTask.reports || []).find(item => item.id === button.dataset.reviewReport);
  if (!report) return;
  const decision = button.dataset.decision;
  const commentInput = document.getElementById(`review-comment-${report.id}`);
  const scoreInput = document.getElementById(`review-score-${report.id}`);
  if (decision === 'rejected' && !commentInput?.value.trim()) {
    showToast('Hãy ghi rõ nội dung cần chỉnh sửa trước khi yêu cầu làm lại.', 'warning');
    commentInput?.focus();
    return;
  }
  if (!Storage.reviewTaskReport(currentTask.id, report.id, { decision, comment: commentInput?.value || '', score: scoreInput?.value || null })) {
    showToast('Không thể lưu đánh giá báo cáo.', 'error');
    return;
  }
  Notifications.reportReviewed(currentTask, { decision, score: scoreInput?.value || null, comment: commentInput?.value || '' }, Auth.getCurrentUser());
  currentTask = Storage.getTaskById(currentTask.id);
  renderTaskDetail();
  showToast(decision === 'approved' ? '\u0110\u00e3 duy\u1ec7t ho\u00e0n th\u00e0nh c\u00f4ng vi\u1ec7c.' : '\u0110\u00e3 chuy\u1ec3n c\u00f4ng vi\u1ec7c sang C\u1ea7n l\u00e0m l\u1ea1i.' , 'success');
}

function renderTaskComments() {
  const list = document.getElementById('task-comments-list');
  if (!list) return;
  const comments = Array.isArray(currentTask.comments) ? currentTask.comments : [];
  list.innerHTML = comments.length ? comments.map(comment => `<article class="task-comment"><div><strong>${escapeHtml(comment.name || comment.username || 'User')}</strong><time>${formatReportDateTime(comment.createdAt)}</time></div><p>${escapeHtml(comment.text)}</p></article>`).join('') : '<p class="text-muted">Ch\u01b0a c\u00f3 trao \u0111\u1ed5i n\u00e0o.</p>';
}

function setupTaskComments() {
  const form = document.getElementById('task-comment-form');
  const input = document.getElementById('task-comment-input');
  if (!form || form.dataset.handlerAttached) return;
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!Storage.addTaskComment(currentTask.id, input.value)) { showToast('Kh\u00f4ng th\u1ec3 g\u1eedi trao \u0111\u1ed5i.', 'error'); return; }
    Notifications.taskCommented(currentTask, input.value.trim(), Auth.getCurrentUser());
    currentTask = Storage.getTaskById(currentTask.id);
    input.value = '';
    renderTaskComments();
    renderTaskActivity();
  });
  form.dataset.handlerAttached = 'true';
}

function setupDeadlineChange() {
  const form = document.getElementById('deadline-change-form');
  const review = document.getElementById('deadline-change-review');
  const status = document.getElementById('deadline-change-status');
  if (!form || !status) return;
  const user = Auth.getCurrentUser();
  const request = currentTask.deadlineChangeRequest;
  const isAssignee = ['user', 'manager'].includes(user?.role) && currentTask.assigneeId === user.id;
  form.hidden = !isAssignee || ['completed', 'cancelled'].includes(currentTask.status) || request?.status === 'pending';
  const dateInput = document.getElementById('requested-deadline');
  dateInput.min = new Date().toISOString().slice(0, 10);
  if (request) status.textContent = request.status === 'pending'
    ? `Y\u00eau c\u1ea7u h\u1ea1n ${formatDate(request.requestedDeadline)} \u0111ang ch\u1edd admin duy\u1ec7t. L\u00fd do: ${request.reason}`
    : `Y\u00eau c\u1ea7u g\u1ea7n nh\u1ea5t \u0111\u00e3 ${request.status === 'approved' ? '\u0111\u01b0\u1ee3c duy\u1ec7t' : 'b\u1ecb t\u1eeb ch\u1ed1i'}.${request.comment ? ` Ph\u1ea3n h\u1ed3i: ${request.comment}` : ''}`;
  else status.textContent = isAssignee ? 'G\u1eedi y\u00eau c\u1ea7u n\u1ebfu b\u1ea1n c\u1ea7n th\u00eam th\u1eddi gian.' : 'Hi\u1ec7n ch\u01b0a c\u00f3 y\u00eau c\u1ea7u \u0111\u1ed5i h\u1ea1n.';
  review.hidden = user?.role !== 'admin' || request?.status !== 'pending';
  if (!form.dataset.handlerAttached) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!Storage.requestDeadlineChange(currentTask.id, dateInput.value, document.getElementById('deadline-change-reason').value)) { showToast('Kh\u00f4ng th\u1ec3 g\u1eedi y\u00eau c\u1ea7u.', 'error'); return; }
      Notifications.deadlineChangeRequested(currentTask, Auth.getCurrentUser());
      currentTask = Storage.getTaskById(currentTask.id);
      renderTaskDetail();
      showToast('\u0110\u00e3 g\u1eedi y\u00eau c\u1ea7u \u0111\u1ed5i h\u1ea1n.', 'success');
    });
    form.dataset.handlerAttached = 'true';
  }
  review.querySelectorAll('[data-deadline-decision]').forEach(button => {
    button.onclick = () => {
      const decision = button.dataset.deadlineDecision;
      const comment = document.getElementById('deadline-review-comment').value;
      if (!Storage.reviewDeadlineChange(currentTask.id, decision, comment)) { showToast('Kh\u00f4ng th\u1ec3 l\u01b0u quy\u1ebft \u0111\u1ecbnh.', 'error'); return; }
      Notifications.deadlineChangeReviewed(currentTask, decision, Auth.getCurrentUser());
      currentTask = Storage.getTaskById(currentTask.id);
      renderTaskDetail();
      showToast(decision === 'approved' ? '\u0110\u00e3 duy\u1ec7t h\u1ea1n m\u1edbi.' : '\u0110\u00e3 t\u1eeb ch\u1ed1i y\u00eau c\u1ea7u.', 'success');
    };
  });
}

function renderTaskReports(container) {
  reportAttachmentUrls.forEach(url => URL.revokeObjectURL(url));
  reportAttachmentUrls.clear();
  const reports = Array.isArray(currentTask.reports) ? currentTask.reports.filter(report => !(report.type === 'cancellation' && ['withdrawn', 'rejected'].includes(currentTask.cancellationRequest?.status))) : [];
  const canReview = Auth.getCurrentUser()?.role === 'admin';
  const cancellation = currentTask.cancellationRequest;
  const cancellationHtml = cancellation && ['pending', 'approved'].includes(cancellation.status) ? `<article class="task-report-entry cancellation-request"><div><strong>Yêu cầu hủy việc · ${cancellation.status === 'pending' ? 'Đang chờ admin' : 'Đã được duyệt'}</strong><time>${formatReportDateTime(cancellation.requestedAt)}</time></div><p>${escapeHtml(cancellation.reason)}</p>${cancellation.comment ? `<p class="text-muted">Phản hồi admin: ${escapeHtml(cancellation.comment)}</p>` : ''}${canReview && cancellation.status === 'pending' ? `<label class="form-group"><span class="form-label">Phản hồi admin</span><textarea id="cancellation-review-comment" class="form-control" rows="2" maxlength="1000" placeholder="Nhập nhận xét"></textarea></label><div class="report-review-actions"><button type="button" class="btn btn-danger btn-sm" data-review-cancellation="true" data-decision="approved">Duyệt hủy việc</button><button type="button" class="btn btn-secondary btn-sm" data-review-cancellation="true" data-decision="rejected">Từ chối, tiếp tục việc</button></div>` : ''}</article>` : '';
  const reportItems = reports.map(report => {
    const review = report.review;
    const reviewTag = review ? `<span class="admin-review-tag ${review.decision === 'approved' ? 'is-approved' : 'is-rework'}">${review.decision === 'approved' ? 'ĐẠT · Đã duyệt hoàn thành' : 'CHƯA ỔN · Yêu cầu làm lại'}</span>` : '';
    const reviewHtml = review ? `<div class="report-review">${reviewTag}<strong>Đánh giá của ${escapeHtml(review.reviewerName || 'Admin')}${review.score ? ` · ${escapeHtml(review.score)}/10` : ''}</strong><p>${escapeHtml(review.comment || (review.decision === 'approved' ? 'Công việc đạt yêu cầu.' : 'Vui lòng chỉnh sửa và gửi báo cáo lại.'))}</p><time>${formatReportDateTime(review.reviewedAt)}</time></div>` : '';
    const reviewForm = canReview && currentTask.status === 'awaiting-review' && currentTask.cancellationRequest?.status !== 'pending' && !review && !report.withdrawnAt && report.type === 'completion' ? `<label class="form-group"><span class="form-label">Đánh giá công việc (1–10)</span><select id="review-score-${escapeHtml(report.id)}" class="form-control"><option value="">Chọn điểm</option>${Array.from({ length: 10 }, (_, index) => `<option value="${index + 1}">${index + 1}/10</option>`).join('')}</select></label><label class="form-group"><span class="form-label">Nhận xét của admin</span><textarea id="review-comment-${escapeHtml(report.id)}" class="form-control" rows="2" maxlength="1000" placeholder="Nêu rõ điểm đạt hoặc nội dung cần làm lại"></textarea></label><div class="report-review-actions"><button type="button" class="btn btn-primary btn-sm" data-review-report="${escapeHtml(report.id)}" data-decision="approved">Đạt · Duyệt hoàn thành</button><button type="button" class="btn btn-secondary btn-sm" data-review-report="${escapeHtml(report.id)}" data-decision="rejected">Chưa ổn · Yêu cầu làm lại</button></div>` : '';
    const reportType = report.type === 'completion' ? 'Yêu cầu hoàn thành' : report.type === 'cancellation' ? 'Yêu cầu hủy việc' : report.type === 'admin-review' ? 'Đánh giá của admin' : 'Báo cáo tiến độ';
    const withdrawnNote = report.withdrawnAt ? `<p class="text-muted">${report.withdrawnReason === 'assignee-withdrawal' ? 'Ngu\u1eddi g\u1eedi \u0111\u00e3 thu h\u1ed3i y\u00eau c\u1ea7u ho\u00e0n th\u00e0nh.' : 'Y\u00eau c\u1ea7u ho\u00e0n th\u00e0nh \u0111\u00e3 \u0111\u00f3ng khi c\u00f4ng vi\u1ec7c b\u1ecb h\u1ee7y.'}</p>` : '';
    return `<article class="task-report-entry"><div><strong>${reportType} · @${escapeHtml(report.username || 'user')}</strong><time>${formatReportDateTime(report.createdAt)}</time></div><p>${escapeHtml(report.text)}</p>${withdrawnNote}${reviewHtml}${reviewForm}</article>`;
  }).join('');
  container.innerHTML = `${cancellationHtml}${reportItems || (!cancellationHtml ? '<p class="text-muted">Chưa có báo cáo nào.</p>' : '')}`;
  container.querySelectorAll('.task-report-entry:not(.cancellation-request)').forEach((entry, index) => {
    const report = reports[index];
    if (!report?.attachments?.length) return;
    const attachmentList = document.createElement('div');
    attachmentList.className = 'report-attachments';
    report.attachments.forEach(metadata => {
      const link = document.createElement('a');
      link.className = 'report-attachment';
      link.textContent = `${metadata.name} (${(metadata.size / (1024 * 1024)).toFixed(2)} MB)`;
      link.download = metadata.name;
      link.href = metadata.url || '#';
      if (!metadata.url) link.addEventListener('click', event => { if (link.href.endsWith('#')) event.preventDefault(); });
      attachmentList.append(link);
      if (metadata.url) return;
      ReportAttachments.get(metadata.id).then(file => {
        if (!file || !link.isConnected) return;
        const url = URL.createObjectURL(file);
        reportAttachmentUrls.add(url);
        link.href = url;
      }).catch(() => {
        if (link.isConnected) link.textContent = `${metadata.name} (tệp không khả dụng)`;
      });
    });
    entry.append(attachmentList);
  });
}

function formatReportDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value || '');
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

/**
 * Hiển thể danh sách nhiệm vụ con (Subtasks / Checklist)
 */
function renderSubtaskList() {
  const container = document.getElementById('subtasks-container');
  const progressElem = document.getElementById('subtasks-progress');
  if (!container) return;

  setupSubtaskHandlers();
  const subtasks = Array.isArray(currentTask.subtasks) ? currentTask.subtasks : [];
  const user = Auth.getCurrentUser();
  const canEdit = (user?.role === 'admin' && !['completed', 'cancelled'].includes(currentTask.status)) || Auth.canManageSubtasks(currentTask);
  const canToggle = Auth.canManageSubtasks(currentTask);
  const canDiscuss = Boolean(user && ['admin', 'manager', 'user'].includes(user.role) && Auth.canAccessTask(currentTask));
  const completedSubtasks = subtasks.filter(item => item.done).length;
  const percent = subtasks.length ? Math.round(completedSubtasks / subtasks.length * 100) : 0;
  if (progressElem) progressElem.textContent = `${completedSubtasks}/${subtasks.length} m\u1ee5c (${percent}%)`;

  if (!subtasks.length) {
    container.innerHTML = '<p class="subtask-empty">Ch\u01b0a c\u00f3 checklist. Th\u00eam \u00edt nh\u1ea5t m\u1ed9t m\u1ee5c \u0111\u1ec3 b\u1eaft \u0111\u1ea7u c\u00f4ng vi\u1ec7c.</p>';
    updateCompletionChecklistHint();
    return;
  }

  container.innerHTML = subtasks.map((item, index) => {
    const messages = Array.isArray(item.comments) ? item.comments : [];
    const messageMarkup = messages.map(message => {
      const attachments = (Array.isArray(message.attachments) ? message.attachments : []).map(file => {
        const url = typeof file.url === 'string' && /^\/data\/uploads\/(attachments|avatars)\/[a-zA-Z0-9._/-]+$/.test(file.url) ? file.url : '';
        if (!url) return '';
        const safeUrl = escapeHtml(url);
        const name = escapeHtml(file.name || 'T\u1ec7p \u0111\u00ednh k\u00e8m');
        if (String(file.type || '').startsWith('image/')) return `<a class="subtask-chat-image" href="${safeUrl}" target="_blank" rel="noopener noreferrer"><img src="${safeUrl}" alt="${name}" loading="lazy"></a>`;
        const size = file.size ? ` \u00b7 ${(file.size / (1024 * 1024)).toFixed(2)} MB` : '';
        return `<a class="report-attachment" href="${safeUrl}" download="${name}">${name}${size}</a>`;
      }).join('');
      const replyTarget = messages.find(item => item.id === message.replyToId);
      const replyName = message.replyToName || replyTarget?.name || replyTarget?.username || 'Ng\u01b0\u1eddi d\u00f9ng';
      const replyText = message.replyPreview || replyTarget?.text || (replyTarget?.attachments?.length ? 'T\u1ec7p \u0111\u00ednh k\u00e8m' : '');
      const replyMarkup = message.replyToId
        ? '<blockquote class="subtask-chat-reply-quote"><strong>' + escapeHtml(replyName) + '</strong><span>' + escapeHtml(replyText) + '</span></blockquote>'
        : '';
      const replyButton = canDiscuss
        ? '<button type="button" class="subtask-chat-reply-button" data-reply-to="' + escapeHtml(message.id) + '" data-reply-name="' + escapeHtml(message.name || message.username || 'Ng\u01b0\u1eddi d\u00f9ng') + '">Tr\u1ea3 l\u1eddi</button>'
        : '';
      return '<article class="subtask-chat-message" id="subtask-message-' + escapeHtml(message.id) + '">' + replyMarkup + '<div class="subtask-chat-message-meta"><strong>' + escapeHtml(message.name || message.username || 'Ng\u01b0\u1eddi d\u00f9ng') + '</strong><time>' + formatReportDateTime(message.createdAt) + '</time></div>' + (message.text ? '<p>' + escapeHtml(message.text) + '</p>' : '') + (attachments ? '<div class="subtask-chat-files">' + attachments + '</div>' : '') + replyButton + '</article>';
    }).join('');
    const chatToggle = canDiscuss ? '<button type="button" class="subtask-chat-toggle" aria-expanded="false" aria-label="M\u1edf trao \u0111\u1ed5i" title="M\u1edf trao \u0111\u1ed5i"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.7-3A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01"/></svg>' + ((item.comments || []).length ? '<span class="subtask-chat-count">' + item.comments.length + '</span>' : '') + '</button>' : '';
    const chat = canDiscuss ? `<form class="subtask-chat-form" data-sub-id="${escapeHtml(item.id)}"><div class="subtask-reply-context" hidden><span></span><button type="button" class="subtask-reply-cancel" aria-label="H\u1ee7y tr\u1ea3 l\u1eddi">&times;</button></div><textarea class="form-control" name="message" rows="2" maxlength="2000" placeholder="Trao \u0111\u1ed5i v\u1ec1 m\u1ee5c n\u00e0y..."></textarea><div class="subtask-chat-toolbar"><label class="subtask-file-picker"><input type="file" name="attachments" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,application/pdf,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/octet-stream,text/plain,text/csv"><span>Th\u00eam \u1ea3nh / t\u1ec7p</span></label><small class="subtask-file-list">T\u1ed1i \u0111a 5 t\u1ec7p, 25 MB / t\u1ec7p</small><button class="btn btn-primary btn-sm" type="submit">G\u1eedi</button></div><div class="subtask-file-preview-list" aria-live="polite"></div></form>` : '';
    return `<article class="subtask-item"><div class="subtask-item-heading"><label class="subtask-check-label"><input type="checkbox" class="subtask-checkbox" data-sub-id="${escapeHtml(item.id)}" ${item.done ? 'checked' : ''} ${canToggle ? '' : 'disabled'}><span class="subtask-number">${index + 1}</span><span class="subtask-title${item.done ? ' is-done' : ''}">${escapeHtml(item.text)}</span></label>${canEdit && subtasks.length > 1 ? `<button type="button" class="btn-icon delete btn-del-subtask" data-sub-id="${escapeHtml(item.id)}" title="X\u00f3a m\u1ee5c checklist" aria-label="X\u00f3a m\u1ee5c checklist">&times;</button>` : ''}${chatToggle}</div><section class="subtask-discussion" ${canDiscuss ? 'hidden' : ''}><div class="subtask-chat-history">${messageMarkup || '<p class="subtask-chat-empty">Ch\u01b0a c\u00f3 trao \u0111\u1ed5i. Ng\u01b0\u1eddi ph\u1ee5 tr\u00e1ch v\u00e0 admin c\u00f3 th\u1ec3 nh\u1eafn tin ho\u1eb7c g\u1eedi t\u1ec7p t\u1ea1i \u0111\u00e2y.</p>'}</div>${chat}</section></article>`;
  }).join('');

  container.querySelectorAll('.subtask-checkbox').forEach(checkbox => checkbox.addEventListener('change', event => {
    const subtaskId = event.currentTarget.dataset.subId;
    const item = currentTask.subtasks.find(subtask => subtask.id === subtaskId);
    if (!item) return;
    const nextSubtasks = currentTask.subtasks.map(subtask => subtask.id === subtaskId ? { ...subtask, done: event.currentTarget.checked } : subtask);
    if (!Storage.updateTask(currentTask.id, { subtasks: nextSubtasks })) {
      showToast('B\u1ea1n kh\u00f4ng c\u00f3 quy\u1ec1n c\u1eadp nh\u1eadt checklist.', 'error');
    } else {
      currentTask = Storage.getTaskById(currentTask.id);
    }
    renderSubtaskList();
    setupTaskReports();
  }));

  container.querySelectorAll('.btn-del-subtask').forEach(button => button.addEventListener('click', event => {
    if (currentTask.subtasks.length <= 1) {
      showToast('M\u1ed7i c\u00f4ng vi\u1ec7c ph\u1ea3i c\u00f3 \u00edt nh\u1ea5t m\u1ed9t m\u1ee5c checklist.', 'warning');
      return;
    }
    const nextSubtasks = currentTask.subtasks.filter(item => item.id !== event.currentTarget.dataset.subId);
    if (!Storage.updateTask(currentTask.id, { subtasks: nextSubtasks })) {
      showToast('Kh\u00f4ng th\u1ec3 x\u00f3a m\u1ee5c checklist.', 'error');
      return;
    }
    currentTask = Storage.getTaskById(currentTask.id);
    renderSubtaskList();
    setupTaskReports();
  }));

  container.querySelectorAll('.subtask-chat-form').forEach(form => form.addEventListener('submit', handleSubtaskMessage));
  container.querySelectorAll('.subtask-chat-reply-button').forEach(button => button.addEventListener('click', () => {
    const form = button.closest('.subtask-item')?.querySelector('.subtask-chat-form');
    if (!form) return;
    form.dataset.replyTo = button.dataset.replyTo || '';
    const context = form.querySelector('.subtask-reply-context');
    context.hidden = false;
    context.querySelector('span').textContent = '\u0110ang tr\u1ea3 l\u1eddi ' + (button.dataset.replyName || 'Ng\u01b0\u1eddi d\u00f9ng');
    form.elements.message.focus();
  }));
  container.querySelectorAll('.subtask-reply-cancel').forEach(button => button.addEventListener('click', () => {
    const form = button.closest('.subtask-chat-form');
    if (!form) return;
    delete form.dataset.replyTo;
    form.querySelector('.subtask-reply-context').hidden = true;
    form.elements.message.focus();
  }));
  container.querySelectorAll('input[type="file"][name="attachments"]').forEach(input => input.addEventListener('change', () => {
    const form = input.closest('.subtask-chat-form');
    const selected = subtaskSelectedFiles.get(input) || [];
    const unique = new Map(selected.map(file => [`${file.name}:${file.size}:${file.lastModified}`, file]));
    [...(input.files || [])].forEach(file => unique.set(`${file.name}:${file.size}:${file.lastModified}`, file));
    const next = [...unique.values()];
    if (next.length > 5) showToast('M\u1ed7i tin nh\u1eafn g\u1eedi t\u1ed1i \u0111a 5 t\u1ec7p. B\u1ecf ch\u1ecdn b\u1edbt t\u1ec7p r\u1ed3i th\u1eed l\u1ea1i.', 'warning');
    subtaskSelectedFiles.set(input, next.slice(0, 5));
    renderSubtaskFilePreviews(form, next.slice(0, 5));
    input.value = '';
  }));
  container.querySelectorAll('.subtask-chat-toggle').forEach(button => button.addEventListener('click', () => {
    const discussion = button.closest('.subtask-item')?.querySelector('.subtask-discussion');
    if (!discussion) return;
    discussion.hidden = !discussion.hidden;
    const expanded = !discussion.hidden;
    discussion.classList.toggle('is-open', expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', expanded ? 'Thu g?n trao ??i' : 'M? trao ??i');
    button.title = expanded ? 'Thu g?n trao ??i' : 'M? trao ??i';
    if (expanded) discussion.querySelector('textarea[name="message"]')?.focus();
  }));
  container.querySelectorAll('.subtask-file-preview-list').forEach(list => list.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-file]');
    if (!remove) return;
    const form = remove.closest('.subtask-chat-form');
    const input = form?.elements.attachments;
    if (!input) return;
    const files = subtaskSelectedFiles.get(input) || [];
    files.splice(Number(remove.dataset.removeFile), 1);
    subtaskSelectedFiles.set(input, files);
    renderSubtaskFilePreviews(form, files);
  }));
  updateCompletionChecklistHint();
}

function renderSubtaskFilePreviews(form, files) {
  const list = form?.querySelector('.subtask-file-preview-list');
  if (!list) return;
  list.querySelectorAll('img[data-preview-url]').forEach(image => URL.revokeObjectURL(image.dataset.previewUrl));
  list.replaceChildren();
  files.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'subtask-file-preview';
    if (file.type.startsWith('image/')) {
      const image = document.createElement('img');
      image.className = 'subtask-file-preview-thumb';
      image.alt = '';
      image.src = URL.createObjectURL(file);
      image.dataset.previewUrl = image.src;
      item.append(image);
    } else {
      const icon = document.createElement('span');
      icon.className = 'subtask-file-preview-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="M7 3.75h7l5 5v11.5H7a2 2 0 0 1-2-2v-12a2.5 2.5 0 0 1 2-2.5Z"/><path d="M14 3.75v5h5M9 13h6M9 16.5h6"/></svg>'; 
      item.append(icon);
    }
    const details = document.createElement('span');
    details.className = 'subtask-file-preview-details';
    const name = document.createElement('strong');
    name.textContent = file.name;
    const size = document.createElement('small');
    size.textContent = file.size >= 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(file.size / 1024))} KB`;
    details.append(name, size);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'subtask-file-preview-remove';
    remove.dataset.removeFile = String(index);
    remove.setAttribute('aria-label', `X\u00f3a ${file.name}`);
    remove.textContent = '\u00d7';
    item.append(details, remove);
    list.append(item);
  });
}

const SUBTASK_ATTACHMENT_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp',
  'application/pdf', 'application/zip', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream', 'text/plain', 'text/csv'
]);

async function handleSubtaskMessage(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const subtaskId = form.dataset.subId;
  const history = [...document.querySelectorAll('.subtask-item')].find(item => item.querySelector('.subtask-chat-form')?.dataset.subId === subtaskId)?.querySelector('.subtask-chat-history');
  const text = form.elements.message.value.trim();
  const input = form.elements.attachments;
  const files = subtaskSelectedFiles.get(input) || [...(input.files || [])];
  if (!text && !files.length) { showToast('Nh\u1eadp tin nh\u1eafn ho\u1eb7c ch\u1ecdn t\u1ec7p tr\u01b0\u1edbc khi g\u1eedi.', 'warning'); return; }
  if (files.length > 5) { showToast('M\u1ed7i tin nh\u1eafn \u0111\u01b0\u1ee3c g\u1eedi t\u1ed1i \u0111a 5 t\u1ec7p.', 'warning'); return; }
  const invalidFile = files.find(file => !SUBTASK_ATTACHMENT_TYPES.has(file.type) || file.size > 25 * 1024 * 1024);
  if (invalidFile) {
    showToast(invalidFile.size > 25 * 1024 * 1024 ? 'M\u1ed7i t\u1ec7p kh\u00f4ng \u0111\u01b0\u1ee3c v\u01b0\u1ee3t qu\u00e1 25 MB.' : 'Lo\u1ea1i t\u1ec7p n\u00e0y ch\u01b0a \u0111\u01b0\u1ee3c h\u1ed7 tr\u1ee3.', 'warning');
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = '\u0110ang g\u1eedi...';
  const attachments = [];
  try {
    for (const file of files) {
      const uploaded = await uploadImage(file, 'attachment');
      attachments.push({ ...uploaded, storage: 'disk' });
    }
    if (!Storage.addSubtaskMessage(currentTask.id, subtaskId, text, attachments, form.dataset.replyTo || null)) {
      showToast('Kh\u00f4ng th\u1ec3 l\u01b0u trao \u0111\u1ed5i cho checklist n\u00e0y.', 'error');
      return;
    }
    currentTask = Storage.getTaskById(currentTask.id);
    renderSubtaskFilePreviews(form, []);
    renderSubtaskList();
    const refreshedForm = [...document.querySelectorAll('.subtask-chat-form')].find(item => item.dataset.subId === subtaskId);
    if (refreshedForm) {
      refreshedForm.elements.message.value = '';
      refreshedForm.elements.attachments.value = '';
      renderSubtaskFilePreviews(refreshedForm, []);
    }
    subtaskSelectedFiles.delete(input);
    if (history) {
      const nextHistory = [...document.querySelectorAll('.subtask-item')].find(item => item.querySelector('.subtask-chat-form')?.dataset.subId === subtaskId)?.querySelector('.subtask-chat-history');
      nextHistory?.scrollTo(0, nextHistory.scrollHeight);
    }
    showToast('\u0110\u00e3 g\u1eedi trao \u0111\u1ed5i.', 'success');
  } catch (error) {
    showToast(error.message || 'Kh\u00f4ng th\u1ec3 t\u1ea3i t\u1ec7p l\u00ean.', 'error');
  } finally {
    const currentForm = [...document.querySelectorAll('.subtask-chat-form')].find(item => item.dataset.subId === subtaskId);
    const currentSubmit = currentForm?.querySelector('button[type=\"submit\"]');
    if (currentSubmit) { currentSubmit.disabled = false; currentSubmit.textContent = 'G\u1eedi'; }
  }
}

function updateCompletionChecklistHint() {
  const hint = document.getElementById('completion-checklist-hint');
  const subtasks = Array.isArray(currentTask.subtasks) ? currentTask.subtasks : [];
  const canReport = Auth.canReportTask(currentTask);
  const ready = subtasks.length >= 1 && subtasks.every(item => item.done);
  const completionButton = document.getElementById('submit-completion-report');
  if (completionButton) completionButton.disabled = canReport && !ready;
  if (!hint) return;
  hint.hidden = !canReport || ready;
  hint.textContent = subtasks.length < 1
    ? 'C\u1ea7n c\u00f3 \u00edt nh\u1ea5t m\u1ed9t m\u1ee5c checklist tr\u01b0\u1edbc khi g\u1eedi ho\u00e0n th\u00e0nh.'
    : 'H\u00e3y ho\u00e0n t\u1ea5t t\u1ea5t c\u1ea3 m\u1ee5c checklist tr\u01b0\u1edbc khi g\u1eedi ho\u00e0n th\u00e0nh.';
}

function setupSubtaskHandlers() {
  const form = document.getElementById('add-subtask-form');
  const input = document.getElementById('new-subtask-input');
  if (!form || !input) return;
  const canEdit = Auth.canManageSubtasks(currentTask);
  form.hidden = !canEdit;
  if (!canEdit || form.dataset.handlerAttached) return;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const nextSubtasks = [...(currentTask.subtasks || []), { id: generateId(), text, done: false, comments: [] }];
    if (currentTask.status === 'request-pending' && nextSubtasks.length < 1) {
      showToast('Y\u00eau c\u1ea7u c\u00f4ng vi\u1ec7c c\u1ea7n \u00edt nh\u1ea5t m\u1ed9t m\u1ee5c checklist.', 'warning');
      return;
    }
    if (!Storage.updateTask(currentTask.id, { subtasks: nextSubtasks })) {
      showToast('Kh\u00f4ng th\u1ec3 th\u00eam m\u1ee5c checklist.', 'error');
      return;
    }
    currentTask = Storage.getTaskById(currentTask.id);
    input.value = '';
    renderSubtaskList();
    setupTaskReports();
    showToast('\u0110\u00e3 th\u00eam m\u1ee5c checklist.', 'success');
  });
  form.dataset.handlerAttached = 'true';
}
