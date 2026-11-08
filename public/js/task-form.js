import { Storage } from './storage.js';
import { Validation } from './validation.js';
import { generateId, getQueryParam } from './utils.js';
import { showToast } from './main.js';
import { Auth } from './auth.js';
import { Notifications } from './notifications.js';

let editingTaskId = null;

 document.addEventListener('DOMContentLoaded', async () => {
  await Auth.loadUsers();
  if (!Auth.canCreateTask() && !getQueryParam('id')) {
    showToast('Tài khoản hiện tại không có quyền tạo công việc.', 'error');
    window.location.replace('tasks.html');
    return;
  }
  await Storage.init();
  populateCategoryOptions();
  configureRoleFields();
  editingTaskId = getQueryParam('id');
  if (editingTaskId) setupEditMode(editingTaskId);
  setupForm();
});

function configureRoleFields() {
  const currentUser = Auth.getCurrentUser();
  if (currentUser?.role === 'user' && !editingTaskId) {
    document.getElementById('form-page-title').textContent = 'Gửi yêu cầu công việc';
    document.getElementById('btn-submit-text').textContent = 'Gửi yêu cầu';
  }
  const assigneeGroup = document.getElementById('task-assignee-group');
  if (assigneeGroup && !Auth.canManageTasks()) assigneeGroup.hidden = true;
  if (assigneeGroup && Auth.canManageTasks()) {
    const select = document.getElementById('task-assignee');
    const accounts = Auth.getUsers().filter(user => user.active && ['manager', 'user'].includes(user.role));
    select.replaceChildren(new Option('Ch\u1ecdn t\u00e0i kho\u1ea3n nh\u1eadn vi\u1ec7c', ''));
    accounts.forEach(user => select.add(new Option(`${user.name} (@${user.username}) - ${user.role === 'manager' ? 'Qu\u1ea3n l\u00fd' : 'Ng\u01b0\u1eddi d\u00f9ng'}`, user.id)));
    select.addEventListener('change', () => renderAssigneePreview(select.value));
    renderAssigneePreview(select.value);
  }
}

function renderAssigneePreview(userId) {
  const preview = document.getElementById('task-assignee-preview');
  if (!preview) return;
  const user = Auth.getUsers().find(account => account.id === userId);
  preview.replaceChildren();
  if (!user) return;
  const avatar = document.createElement('span');
  avatar.className = 'avatar assignee-avatar';
  avatar.textContent = user.name.split(/\s+/).map(part => part[0]).slice(-2).join('').toUpperCase();
  const info = document.createElement('span');
  info.className = 'assignee-preview-info';
  const name = document.createElement('strong');
  name.textContent = `${user.name} (@${user.username})`;
  const role = document.createElement('small');
  role.textContent = user.role === 'manager' ? 'Qu\u1ea3n l\u00fd' : 'Ng\u01b0\u1eddi d\u00f9ng';
  info.append(name, role);
  preview.append(avatar, info);
}

function populateCategoryOptions() {
  const list = document.getElementById('category-suggestions');
  if (!list) return;
  list.replaceChildren(...Storage.getCategories().map(category => {
    const option = document.createElement('option');
    option.value = category.name;
    return option;
  }));
}

function setupEditMode(id) {
  const initialChecklist = document.getElementById('initial-checklist-group');
  if (initialChecklist) initialChecklist.hidden = true;
  const task = Storage.getTaskById(id);
  if (!task) {
    showToast('Kh\u00f4ng t\u00ecm th\u1ea5y c\u00f4ng vi\u1ec7c c\u1ea7n s\u1eeda.', 'error');
    setTimeout(() => window.location.href = 'tasks.html', 1200);
    return;
  }
  document.getElementById('form-page-title').textContent = 'Ch\u1ec9nh s\u1eeda c\u00f4ng vi\u1ec7c';
  document.getElementById('btn-submit-text').textContent = 'L\u01b0u thay \u0111\u1ed5i';
  document.getElementById('task-title').value = task.title || '';
  const category = Storage.getCategories().find(item => item.id === task.categoryId);
  document.getElementById('task-category').value = category?.name || task.categoryName || task.categoryId || '';
  document.getElementById('task-priority').value = task.priority || 'medium';
  document.getElementById('task-deadline').value = task.deadline || '';
  document.getElementById('task-description').value = task.description || '';
  const recurrenceSelect = document.getElementById('task-recurrence');
  if (recurrenceSelect) { recurrenceSelect.value = task.recurrence?.frequency || 'none'; recurrenceSelect.disabled = true; }
  const assignee = document.getElementById('task-assignee');
  if (assignee) { assignee.value = task.assigneeId || ''; renderAssigneePreview(assignee.value); }
  if (!Auth.canEditTask(task)) {
    ['task-title', 'task-category', 'task-priority', 'task-deadline', 'task-description'].forEach(field => {
      document.getElementById(field).disabled = true;
    });
    const assigneeGroup = document.getElementById('task-assignee-group');
    if (assigneeGroup) assigneeGroup.hidden = true;
    const submitText = document.getElementById('btn-submit-text');
    if (submitText) submitText.textContent = 'Lưu thay đổi';
  }
}

function setupForm() {
  const form = document.getElementById('task-form');
  const titleInput = document.getElementById('task-title');
  const categoryInput = document.getElementById('task-category');
  const deadlineInput = document.getElementById('task-deadline');
  const descriptionInput = document.getElementById('task-description');
  const checklistContainer = document.getElementById('initial-checklist-items');
  const checklistError = document.getElementById('initial-checklist-error');
  const checklistCount = document.getElementById('initial-checklist-count');
  const checklistInputs = () => [...(checklistContainer?.querySelectorAll('.initial-checklist-input') || [])];
  const refreshChecklistRows = () => {
    const rows = [...(checklistContainer?.querySelectorAll('.initial-checklist-row') || [])];
    rows.forEach((row, index) => {
      const label = row.querySelector('.form-label');
      const input = row.querySelector('.initial-checklist-input');
      if (input) { input.id = `initial-checklist-${index + 1}`; input.required = index === 0; }
      if (label) label.textContent = `M\u1ee5c ${index + 1}`;
      if (label && input) row.querySelector('label').htmlFor = input.id;
      const remove = row.querySelector('.initial-checklist-remove');
      if (remove) remove.hidden = rows.length <= 1;
    });
    if (checklistCount) checklistCount.textContent = `${rows.length} m\u1ee5c`;
  };
  checklistContainer?.addEventListener('input', () => { if (checklistError) checklistError.hidden = true; });
  checklistContainer?.addEventListener('click', event => {
    const remove = event.target.closest('.initial-checklist-remove');
    if (!remove) return;
    remove.closest('.initial-checklist-row')?.remove();
    refreshChecklistRows();
    if (checklistError) checklistError.hidden = true;
  });
  document.getElementById('add-initial-checklist-item')?.addEventListener('click', () => {
    if (!checklistContainer) return;
    const row = document.createElement('div');
    row.className = 'initial-checklist-row';
    const label = document.createElement('label');
    label.className = 'form-group';
    const fieldLabel = document.createElement('span');
    fieldLabel.className = 'form-label';
    const input = document.createElement('input');
    input.className = 'form-control initial-checklist-input';
    input.type = 'text';
    input.maxLength = 180;
    input.placeholder = 'M\u00f4 t\u1ea3 b\u01b0\u1edbc checklist';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-secondary btn-sm initial-checklist-remove';
    remove.textContent = 'X\u00f3a';
    label.append(fieldLabel, input);
    row.append(label, remove);
    checklistContainer.append(row);
    refreshChecklistRows();
    input.focus();
  });
  refreshChecklistRows();
  [titleInput, categoryInput, deadlineInput].forEach(input => input.addEventListener('input', () => Validation.clearError(input)));

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!Auth.canCreateTask() && !editingTaskId) {
      showToast('Tài khoản hiện tại không có quyền tạo công việc.', 'error');
      return;
    }
    const existingTask = editingTaskId ? Storage.getTaskById(editingTaskId) : null;
    if (editingTaskId && !existingTask) {
      showToast('Không tìm thấy công việc hoặc bạn không có quyền sửa.', 'error');
      return;
    }
    if (editingTaskId && !Auth.canEditTask(existingTask)) {
      showToast('Bạn không có quyền sửa công việc này.', 'error');
      return;
    }
    let valid = true;
    if ((!Validation.isRequired(titleInput.value) || !Validation.minLength(titleInput.value, 3))) {
      Validation.showError(titleInput, 'Nh\u1eadp t\u00ean c\u00f4ng vi\u1ec7c (t\u1ed1i thi\u1ec3u 3 k\u00fd t\u1ef1).'); valid = false;
    } else Validation.clearError(titleInput);
    if (!Validation.isRequired(categoryInput.value)) {
      Validation.showError(categoryInput, 'Nh\u1eadp ho\u1eb7c ch\u1ecdn danh m\u1ee5c / d\u1ef1 \u00e1n.'); valid = false;
    } else Validation.clearError(categoryInput);
    if ((!Validation.isRequired(deadlineInput.value) || !Validation.isValidDate(deadlineInput.value))) {
      Validation.showError(deadlineInput, 'Ch\u1ecdn ng\u00e0y h\u1ea1n h\u1ee3p l\u1ec7.'); valid = false;
    } else Validation.clearError(deadlineInput);
    const checklistFields = checklistInputs();
    const checklistTexts = checklistFields.map(input => input.value.trim()).filter(Boolean);
    const distinctChecklistTexts = new Set(checklistTexts.map(text => text.toLocaleLowerCase()));
    const checklistValid = editingTaskId || (checklistTexts.length >= 1 && distinctChecklistTexts.size === checklistTexts.length);
    if (!checklistValid) {
      if (checklistError) {
        checklistError.hidden = false;
        checklistError.textContent = checklistTexts.length < 1
          ? 'V\u00fui l\u00f2ng nh\u1eadp \u00edt nh\u1ea5t m\u1ed9t m\u1ee5c checklist.'
          : 'C\u00e1c m\u1ee5c checklist c\u1ea7n c\u00f3 n\u1ed9i dung kh\u00e1c nhau.';
      }
      checklistFields.find(input => !input.value.trim())?.focus();
      valid = false;
    } else if (checklistError) checklistError.hidden = true;
    if (!valid) { showToast('Vui l\u00f2ng ki\u1ec3m tra l\u1ea1i th\u00f4ng tin.', 'warning'); return; }

    if (!editingTaskId && Auth.canManageTasks()) {
      const assigneeSelect = document.getElementById('task-assignee');
      const target = Auth.getUsers().find(user => user.id === assigneeSelect.value && user.active && ['manager', 'user'].includes(user.role));
      if (!target) { showToast('Ch\u1ecdn t\u00e0i kho\u1ea3n qu\u1ea3n l\u00fd ho\u1eb7c ng\u01b0\u1eddi d\u00f9ng nh\u1eadn vi\u1ec7c.', 'warning'); return; }
    }

    const categoryName = categoryInput.value.trim();
    let category = Storage.getCategories().find(item => item.name.trim().toLocaleLowerCase() === categoryName.toLocaleLowerCase());
    if (!category && Auth.canManageCategories()) {
      category = { id: generateId(), name: categoryName, color: '#4f46e5' };
      Storage.addCategory(category);
      populateCategoryOptions();
    }
    let taskData = {
      title: titleInput.value.trim(),
      categoryId: category?.id || categoryName,
      categoryName: category?.name || categoryName,
      priority: document.getElementById('task-priority').value,
      deadline: deadlineInput.value,
      description: descriptionInput.value.trim(),
      ...(!editingTaskId ? { subtasks: checklistTexts.map(text => ({ id: generateId(), text, done: false, comments: [] })) } : {})
    };
    if (!editingTaskId && !Auth.canManageTasks()) taskData.assigneeId = null;
    if (!editingTaskId) {
      const frequency = document.getElementById('task-recurrence')?.value || 'none';
      if (frequency !== 'none') taskData.recurrence = { frequency };
    }
    const previousAssigneeId = existingTask?.assigneeId || null;
    const assignee = document.getElementById('task-assignee');
    if (assignee && Auth.canManageTasks() && Auth.canEditTask(existingTask || {})) taskData.assigneeId = assignee.value || null;

    const taskToSave = editingTaskId ? null : {
      id: generateId(), ...taskData, ownerId: Auth.getCurrentUser()?.id, createdAt: new Date().toISOString().slice(0, 10), subtasks: taskData.subtasks
    };
    Promise.resolve(editingTaskId ? Storage.updateTask(editingTaskId, taskData) : Storage.addTask(taskToSave)).then(ok => {
      if (!ok) { showToast('Kh\u00f4ng th\u1ec3 \u0111\u1ed3ng b\u1ed9 c\u00f4ng vi\u1ec7c l\u00ean API.', 'error'); return; }
    const assignmentTask = taskToSave || { ...existingTask, ...taskData, id: existingTask?.id || editingTaskId };
    if (assignmentTask.assigneeId && assignmentTask.assigneeId !== previousAssigneeId) Notifications.taskAssigned(assignmentTask, Auth.getCurrentUser());
      showToast(editingTaskId ? '\u0110\u00e3 c\u1eadp nh\u1eadt c\u00f4ng vi\u1ec7c.' : (Auth.getCurrentUser()?.role === 'user' ? '\u0110\u00e3 g\u1eedi y\u00eau c\u1ea7u c\u00f4ng vi\u1ec7c, ch\u1edd admin duy\u1ec7t.' : '\u0110\u00e3 t\u1ea1o c\u00f4ng vi\u1ec7c m\u1edbi.'), 'success');
      setTimeout(() => window.location.href = 'tasks.html', 700);
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

