import { Storage } from './storage.js';
import { Validation } from './validation.js';
import { generateId, getQueryParam } from './utils.js';
import { showConfirmModal, showToast } from './main.js';
import { Auth } from './auth.js';
import { Notifications } from './notifications.js';
import { uploadImage } from './uploads.js';

const MAX_CO_MEMBERS = 2;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const DRAFT_KEY_PREFIX = 'DACK_TASK_FORM_DRAFT_V2_';

let editingTaskId = null;
let duplicateTaskId = null;
let originalEditDeadline = { date: '', time: '' };
let isFormDirty = false;
let canEditCurrentForm = true;
let selectedPrimaryId = '';
const selectedCoMemberIds = new Set();
let taskAttachments = [];

function getDraftStorageKey() {
  const userId = Auth.getCurrentUser()?.id || 'guest';
  return `${DRAFT_KEY_PREFIX}${userId}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function getInitials(name, username) {
  return String(name || username || '?')
    .trim()
    .split(/\s+/)
    .map(part => part[0])
    .slice(-2)
    .join('')
    .toUpperCase() || '?';
}

function getAssignableAccounts() {
  return Auth.getUsers().filter(user => user.active && ['manager', 'user'].includes(user.role));
}

function matchesAccountQuery(user, query) {
  const q = String(query || '').trim().toLowerCase().replace(/^@/, '');
  if (!q) return true;
  return (
    String(user.name || '').toLowerCase().includes(q) ||
    String(user.username || '').toLowerCase().includes(q)
  );
}

function markDirty() {
  isFormDirty = true;
}

document.addEventListener('DOMContentLoaded', async () => {
  await Auth.loadUsers();
  if (!Auth.canCreateTask() && !getQueryParam('id')) {
    showToast('Tài khoản hiện tại không có quyền tạo công việc.', 'error');
    window.location.replace('tasks.html');
    return;
  }
  await Storage.init();

  editingTaskId = getQueryParam('id');
  duplicateTaskId = !editingTaskId ? getQueryParam('duplicate') : null;

  populateCategoryOptions();
  setupQuickCategoryHandlers();
  configureRoleFields();
  setupChecklistHandlers();
  setupRecurrenceHandlers();
  setupAttachmentsHandlers();
  setupFormCustomDropboxes();

  if (editingTaskId) {
    setupEditMode(editingTaskId);
  } else if (duplicateTaskId) {
    setupDuplicateMode(duplicateTaskId);
  } else {
    setupDraftBanner();
  }

  syncFormCustomDropboxes();
  setupForm();
  setupDraftAndUnloadActions();
  isFormDirty = false;
});

function configureRoleFields() {
  const currentUser = Auth.getCurrentUser();
  if (currentUser?.role === 'user' && !editingTaskId) {
    document.getElementById('form-page-title').textContent = 'Gửi yêu cầu công việc';
    document.getElementById('btn-submit-text').textContent = 'Gửi yêu cầu';
  }

  const assigneeGroup = document.getElementById('task-assignee-group');
  if (!assigneeGroup) return;

  if (!Auth.canManageTasks()) {
    assigneeGroup.hidden = true;
    return;
  }

  const primarySearch = document.getElementById('primary-assignee-search');
  const coSearch = document.getElementById('team-members-search');
  const select = document.getElementById('task-assignee');

  primarySearch?.addEventListener('input', () => renderPrimaryAssigneePicker());
  coSearch?.addEventListener('input', () => renderCoMemberCheckboxes());

  select?.addEventListener('change', () => {
    setPrimaryAssignee(select.value, true);
  });

  renderPrimaryAssigneePicker();
  renderCoMemberCheckboxes();
  renderAssigneePreview();
}

function setPrimaryAssignee(userId, fromUser = false) {
  selectedPrimaryId = userId || '';
  if (selectedPrimaryId && selectedCoMemberIds.has(selectedPrimaryId)) {
    selectedCoMemberIds.delete(selectedPrimaryId);
  }
  const select = document.getElementById('task-assignee');
  if (select && select.value !== selectedPrimaryId) {
    select.value = selectedPrimaryId;
  }
  if (fromUser) markDirty();
  renderPrimaryAssigneePicker();
  renderCoMemberCheckboxes();
  renderAssigneePreview();
}

function renderPrimaryAssigneePicker() {
  const select = document.getElementById('task-assignee');
  const listEl = document.getElementById('primary-assignee-list');
  const searchInput = document.getElementById('primary-assignee-search');
  const accounts = getAssignableAccounts();

  if (select) {
    const currentValue = selectedPrimaryId;
    select.replaceChildren(new Option('Chọn người phụ trách chính...', ''));
    accounts.forEach(user => {
      const roleLabel = user.role === 'manager' ? 'Quản lý' : 'Người dùng';
      select.add(new Option(`${user.name} (@${user.username}) - ${roleLabel}`, user.id));
    });
    select.value = currentValue;
  }

  if (!listEl) return;
  const query = searchInput?.value || '';
  const filtered = accounts.filter(user => matchesAccountQuery(user, query));
  listEl.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'assignee-empty-hint';
    empty.textContent = 'Không tìm thấy nhân sự phù hợp.';
    listEl.append(empty);
    return;
  }

  filtered.forEach(user => {
    const isSelected = user.id === selectedPrimaryId;
    const roleLabel = user.role === 'manager' ? 'Quản lý' : 'Thành viên';
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `assignee-option-btn${isSelected ? ' is-selected' : ''}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(isSelected));
    item.disabled = !canEditCurrentForm;
    item.innerHTML = `
      <span class="assignee-option-main">
        <span class="assignee-mini-avatar">${escapeHtml(getInitials(user.name, user.username))}</span>
        <span class="assignee-option-text">
          <strong>${escapeHtml(user.name)}</strong>
          <small>@${escapeHtml(user.username)} &bull; ${roleLabel}</small>
        </span>
      </span>
      ${isSelected ? '<span class="assignee-option-tag">Đã chọn</span>' : ''}
    `;
    item.addEventListener('click', () => {
      if (!canEditCurrentForm) return;
      setPrimaryAssignee(isSelected ? '' : user.id, true);
    });
    listEl.append(item);
  });
}

function renderCoMemberCheckboxes() {
  const container = document.getElementById('team-members-checkboxes');
  const countBadge = document.getElementById('team-selected-count');
  const searchInput = document.getElementById('team-members-search');
  if (!container) return;

  if (selectedPrimaryId) {
    selectedCoMemberIds.delete(selectedPrimaryId);
  }
  const atLimit = selectedCoMemberIds.size >= MAX_CO_MEMBERS;

  if (countBadge) {
    countBadge.textContent = `${selectedCoMemberIds.size}/${MAX_CO_MEMBERS} phối hợp`;
  }

  const accounts = getAssignableAccounts();
  const query = searchInput?.value || '';
  const candidates = accounts.filter(user => user.id !== selectedPrimaryId && matchesAccountQuery(user, query));
  container.replaceChildren();

  if (!candidates.length) {
    const empty = document.createElement('p');
    empty.className = 'assignee-empty-hint';
    empty.textContent = query ? 'Không tìm thấy thành viên phù hợp.' : 'Không còn thành viên khả dụng khác.';
    container.append(empty);
    return;
  }

  candidates.forEach(user => {
    const checked = selectedCoMemberIds.has(user.id);
    const disabledByLimit = !checked && atLimit;
    const label = document.createElement('label');
    label.className = `co-member-option${checked ? ' is-checked' : ''}${disabledByLimit ? ' is-disabled-limit' : ''}`;

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'team-member-chk';
    chk.value = user.id;
    chk.checked = checked;
    chk.disabled = !canEditCurrentForm || disabledByLimit;

    chk.addEventListener('change', () => {
      if (chk.checked) {
        if (selectedCoMemberIds.size >= MAX_CO_MEMBERS) {
          chk.checked = false;
          showToast(`Chỉ chọn tối đa ${MAX_CO_MEMBERS} người phối hợp (nhóm tối đa 3 người).`, 'warning');
          return;
        }
        selectedCoMemberIds.add(user.id);
      } else {
        selectedCoMemberIds.delete(user.id);
      }
      markDirty();
      renderCoMemberCheckboxes();
      renderAssigneePreview();
    });

    const textWrap = document.createElement('span');
    textWrap.className = 'co-member-option-text';
    textWrap.innerHTML = `<strong>${escapeHtml(user.name)}</strong> <small>@${escapeHtml(user.username)}</small>`;

    label.append(chk, textWrap);
    container.append(label);
  });
}

function getSelectedTeamMembers() {
  return [...selectedCoMemberIds].filter(id => id && id !== selectedPrimaryId);
}

function renderAssigneePreview() {
  const preview = document.getElementById('task-assignee-preview');
  if (!preview) return;
  const users = Auth.getUsers();
  preview.replaceChildren();

  const allSelectedIds = [selectedPrimaryId, ...getSelectedTeamMembers()].filter(Boolean);
  if (!allSelectedIds.length) return;

  allSelectedIds.forEach(userId => {
    const user = users.find(account => account.id === userId);
    if (!user) return;
    const card = document.createElement('div');
    card.className = 'user-profile-trigger';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.dataset.userProfileId = user.id;
    card.title = `Nhấn để xem thông tin của ${user.name || user.username}`;

    const avatar = document.createElement('span');
    avatar.className = 'assignee-avatar';
    avatar.style.cssText = 'width:26px; height:26px; min-width:26px; font-size:0.7rem;';
    avatar.textContent = getInitials(user.name, user.username);

    const info = document.createElement('span');
    info.innerHTML = `<strong>${escapeHtml(user.name)}</strong>`;
    card.append(avatar, info);
    preview.append(card);
  });
}

function populateCategoryOptions(selectedId = '') {
  const select = document.getElementById('task-category');
  if (!select) return;
  const previous = selectedId || select.value;
  select.replaceChildren(new Option('Chọn danh mục / dự án...', ''));
  Storage.getCategories().forEach(category => {
    select.add(new Option(category.name, category.id));
  });
  if (previous && Storage.getCategories().some(c => c.id === previous)) {
    select.value = previous;
  }
  syncFormCustomDropboxes();
}

let formDropboxGlobalsBound = false;

function getFormSelectOptionDot(selectId, value) {
  if (!value) return { className: '', style: '' };
  if (selectId === 'task-category') {
    const category = Storage.getCategories().find(item => item.id === value);
    const color = /^#[0-9a-f]{3,8}$/i.test(category?.color || '') ? category.color : 'var(--primary)';
    return { className: 'is-dynamic-color', style: `background:${color}` };
  }
  if (selectId === 'task-priority') {
    const allowed = ['low', 'medium', 'high'];
    return allowed.includes(value) ? { className: `is-priority-${value}`, style: '' } : { className: '', style: '' };
  }
  if (selectId === 'task-recurrence') {
    if (value === 'none') return { className: '', style: '' };
    return { className: 'is-in-progress', style: '' };
  }
  return { className: '', style: '' };
}

function closeFormCustomDropboxes(exceptWrapper = null) {
  document.querySelectorAll('.custom-dropbox.is-block.is-open').forEach(box => {
    if (box === exceptWrapper) return;
    box.classList.remove('is-open');
    const trigger = box.querySelector('.custom-dropbox-trigger');
    const menu = box.querySelector('.custom-dropbox-menu');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (menu) menu.hidden = true;
  });
}

function setupFormCustomDropboxes() {
  const targetIds = ['task-category', 'task-priority', 'task-recurrence'];

  if (!formDropboxGlobalsBound) {
    document.addEventListener('click', event => {
      if (!event.target.closest('.custom-dropbox.is-block')) {
        closeFormCustomDropboxes();
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeFormCustomDropboxes();
      }
    });
    formDropboxGlobalsBound = true;
  }

  targetIds.forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    select.classList.add('is-custom-hidden');

    let wrapper = select.nextElementSibling?.classList.contains('custom-dropbox')
      ? select.nextElementSibling
      : null;

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'custom-dropbox is-block';
      wrapper.dataset.selectId = id;
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

    const trigger = wrapper.querySelector('.custom-dropbox-trigger');
    const triggerDot = wrapper.querySelector('.custom-dropbox-trigger .custom-dropbox-dot');
    const triggerLabel = wrapper.querySelector('.custom-dropbox-label');
    const menu = wrapper.querySelector('.custom-dropbox-menu');

    const syncSelf = () => {
      const options = Array.from(select.options);
      const selectedOption = options[select.selectedIndex] || options[0];
      const currentVal = selectedOption?.value ?? '';

      if (trigger) trigger.disabled = Boolean(select.disabled);
      if (triggerLabel) {
        triggerLabel.textContent = selectedOption?.textContent || '';
        triggerLabel.classList.toggle('is-placeholder', !currentVal);
      }
      if (triggerDot) {
        const dot = getFormSelectOptionDot(select.id, currentVal);
        triggerDot.className = `custom-dropbox-dot${dot.className ? ` ${dot.className}` : ''}`;
        triggerDot.style.cssText = dot.style;
        triggerDot.hidden = !dot.className;
      }

      if (menu) {
        menu.innerHTML = options.map(opt => {
          const isSelected = opt.value === currentVal;
          const dot = getFormSelectOptionDot(select.id, opt.value);
          const dotHtml = dot.className
            ? `<span class="custom-dropbox-dot ${dot.className}"${dot.style ? ` style="${dot.style}"` : ''} aria-hidden="true"></span>`
            : '';
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
            if (select.disabled) return;
            const nextVal = optBtn.dataset.value ?? '';
            const changed = select.value !== nextVal;
            select.value = nextVal;
            closeFormCustomDropboxes();
            syncSelf();
            if (changed) {
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        });
      }
    };

    wrapper._syncCustomDropbox = syncSelf;
    syncSelf();

    if (!select.dataset.formDropboxBound) {
      trigger?.addEventListener('click', () => {
        if (select.disabled) return;
        const willOpen = !wrapper.classList.contains('is-open');
        closeFormCustomDropboxes(willOpen ? wrapper : null);
        wrapper.classList.toggle('is-open', willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (menu) menu.hidden = !willOpen;
      });
      select.addEventListener('change', syncSelf);
      select.dataset.formDropboxBound = 'true';
    }
  });
}

function syncFormCustomDropboxes() {
  document.querySelectorAll('.custom-dropbox.is-block').forEach(wrapper => {
    wrapper._syncCustomDropbox?.();
  });
}

function setupQuickCategoryHandlers() {
  const toggleBtn = document.getElementById('btn-toggle-quick-category');
  const box = document.getElementById('quick-category-box');
  const nameInput = document.getElementById('quick-category-name');
  const colorInput = document.getElementById('quick-category-color');
  const saveBtn = document.getElementById('btn-save-quick-category');
  const cancelBtn = document.getElementById('btn-cancel-quick-category');
  const categorySelect = document.getElementById('task-category');

  if (!toggleBtn || !box) return;
  if (!Auth.canManageCategories()) {
    toggleBtn.hidden = true;
    box.hidden = true;
    return;
  }

  toggleBtn.hidden = false;
  toggleBtn.addEventListener('click', () => {
    box.hidden = !box.hidden;
    if (!box.hidden) nameInput?.focus();
  });

  cancelBtn?.addEventListener('click', () => {
    box.hidden = true;
    if (nameInput) nameInput.value = '';
  });

  const handleQuickCreate = async () => {
    const rawName = String(nameInput?.value || '').trim();
    if (rawName.length < 2) {
      showToast('Tên danh mục cần tối thiểu 2 ký tự.', 'warning');
      nameInput?.focus();
      return;
    }

    const existing = Storage.getCategories().find(
      c => c.name.trim().toLocaleLowerCase() === rawName.toLocaleLowerCase()
    );
    if (existing) {
      populateCategoryOptions(existing.id);
      if (categorySelect) Validation.clearError(categorySelect);
      box.hidden = true;
      if (nameInput) nameInput.value = '';
      showToast(`Đã chọn danh mục có sẵn "${existing.name}".`, 'success');
      markDirty();
      return;
    }

    const newCat = {
      id: generateId(),
      name: rawName,
      color: colorInput?.value || '#4f46e5'
    };
    const ok = await Promise.resolve(Storage.addCategory(newCat));
    if (!ok) {
      showToast('Không thể tạo danh mục mới.', 'error');
      return;
    }
    populateCategoryOptions(newCat.id);
    if (categorySelect) Validation.clearError(categorySelect);
    box.hidden = true;
    if (nameInput) nameInput.value = '';
    markDirty();
    showToast(`Đã tạo danh mục "${newCat.name}".`, 'success');
  };

  saveBtn?.addEventListener('click', handleQuickCreate);
  nameInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleQuickCreate();
    }
  });
}

function getChecklistContainerElements() {
  return {
    container: document.getElementById('initial-checklist-items'),
    error: document.getElementById('initial-checklist-error'),
    count: document.getElementById('initial-checklist-count')
  };
}

function refreshChecklistRows() {
  const { container, count } = getChecklistContainerElements();
  if (!container) return;
  const rows = [...container.querySelectorAll('.initial-checklist-row')];
  rows.forEach((row, index) => {
    const label = row.querySelector('.form-label');
    const input = row.querySelector('.initial-checklist-input');
    if (input) {
      input.id = `initial-checklist-${index + 1}`;
      input.required = index === 0;
    }
    if (label) label.textContent = `Mục ${index + 1}`;
    if (label && input) row.querySelector('label').htmlFor = input.id;
    const remove = row.querySelector('.initial-checklist-remove');
    if (remove) remove.hidden = rows.length <= 1 || !canEditCurrentForm;
    const handle = row.querySelector('.checklist-drag-handle');
    if (handle) handle.disabled = rows.length <= 1 || !canEditCurrentForm;
  });
  if (count) count.textContent = `${rows.length} mục`;
}

function createChecklistRow({ id = '', text = '', done = false, comments = [] } = {}) {
  const row = document.createElement('div');
  row.className = 'initial-checklist-row';
  if (id) row.dataset.subtaskId = id;
  row._subtaskMeta = {
    done: Boolean(done),
    comments: Array.isArray(comments) ? comments : []
  };

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'checklist-drag-handle';
  handle.title = 'Kéo để thay đổi thứ tự';
  handle.setAttribute('aria-label', 'Kéo để sắp xếp');
  handle.innerHTML = '&#9776;';
  handle.addEventListener('pointerdown', () => {
    if (canEditCurrentForm) row.draggable = true;
  });
  const resetDraggable = () => { row.draggable = false; };
  handle.addEventListener('pointerup', resetDraggable);
  row.addEventListener('dragend', resetDraggable);

  const label = document.createElement('label');
  label.className = 'form-group';
  const fieldLabel = document.createElement('span');
  fieldLabel.className = 'form-label';

  const input = document.createElement('input');
  input.className = 'form-control initial-checklist-input';
  input.type = 'text';
  input.maxLength = 180;
  input.placeholder = 'Mô tả bước checklist (nhấn Enter để thêm bước tiếp theo)';
  input.value = String(text || '');
  input.disabled = !canEditCurrentForm;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-secondary btn-sm initial-checklist-remove';
  remove.textContent = 'Xóa';

  label.append(fieldLabel, input);
  row.append(handle, label, remove);
  return row;
}

function renderChecklistFromItems(items = []) {
  const { container } = getChecklistContainerElements();
  if (!container) return;
  const rowsData = Array.isArray(items) && items.length ? items : [{ text: '' }];
  container.replaceChildren(...rowsData.map(item => createChecklistRow(item)));
  refreshChecklistRows();
}

function readChecklistPayload(resetStatus = false) {
  const { container } = getChecklistContainerElements();
  if (!container) return [];
  return [...container.querySelectorAll('.initial-checklist-row')]
    .map(row => {
      const text = row.querySelector('.initial-checklist-input')?.value.trim() || '';
      if (!text) return null;
      const existingId = !resetStatus ? row.dataset.subtaskId : '';
      const meta = !resetStatus && row._subtaskMeta ? row._subtaskMeta : { done: false, comments: [] };
      return {
        id: existingId || generateId(),
        text,
        done: resetStatus ? false : Boolean(meta.done),
        comments: resetStatus ? [] : meta.comments
      };
    })
    .filter(Boolean);
}

function setupChecklistHandlers() {
  const { container, error } = getChecklistContainerElements();
  if (!container) return;

  let draggedRow = null;

  const existingRow = container.querySelector('.initial-checklist-row');
  if (existingRow) {
    const existingInput = existingRow.querySelector('.initial-checklist-input');
    const text = existingInput?.value || '';
    renderChecklistFromItems([{ text }]);
  } else {
    refreshChecklistRows();
  }

  container.addEventListener('input', () => {
    if (error) error.hidden = true;
    markDirty();
  });

  container.addEventListener('keydown', event => {
    const input = event.target.closest('.initial-checklist-input');
    if (!input || event.key !== 'Enter') return;
    event.preventDefault();
    if (!canEditCurrentForm) return;
    const currentRow = input.closest('.initial-checklist-row');
    const nextRow = createChecklistRow();
    if (currentRow) currentRow.after(nextRow);
    else container.append(nextRow);
    refreshChecklistRows();
    markDirty();
    nextRow.querySelector('.initial-checklist-input')?.focus();
  });

  container.addEventListener('click', event => {
    const remove = event.target.closest('.initial-checklist-remove');
    if (!remove || !canEditCurrentForm) return;
    remove.closest('.initial-checklist-row')?.remove();
    refreshChecklistRows();
    if (error) error.hidden = true;
    markDirty();
  });

  container.addEventListener('dragstart', event => {
    const row = event.target.closest('.initial-checklist-row');
    if (!row || !row.draggable) {
      event.preventDefault();
      return;
    }
    draggedRow = row;
    row.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', event => {
    if (!draggedRow) return;
    event.preventDefault();
    const targetRow = event.target.closest('.initial-checklist-row');
    if (!targetRow || targetRow === draggedRow) return;
    const rect = targetRow.getBoundingClientRect();
    const insertBefore = event.clientY < rect.top + rect.height / 2;
    container.insertBefore(draggedRow, insertBefore ? targetRow : targetRow.nextSibling);
  });

  container.addEventListener('dragend', () => {
    if (draggedRow) {
      draggedRow.classList.remove('is-dragging');
      draggedRow.draggable = false;
      draggedRow = null;
      refreshChecklistRows();
      markDirty();
    }
  });

  document.getElementById('add-initial-checklist-item')?.addEventListener('click', () => {
    if (!canEditCurrentForm) return;
    const nextRow = createChecklistRow();
    container.append(nextRow);
    refreshChecklistRows();
    markDirty();
    nextRow.querySelector('.initial-checklist-input')?.focus();
  });
}

function setupRecurrenceHandlers() {
  const select = document.getElementById('task-recurrence');
  const endWrap = document.getElementById('task-recurrence-end-wrap');
  const endInput = document.getElementById('task-recurrence-end');
  if (!select || !endWrap) return;

  const syncVisibility = () => {
    const isNone = !select.value || select.value === 'none';
    endWrap.hidden = isNone;
    if (isNone && endInput) {
      endInput.value = '';
      Validation.clearError(endInput);
    }
  };
  select.addEventListener('change', () => {
    syncVisibility();
    markDirty();
  });
  endInput?.addEventListener('input', () => Validation.clearError(endInput));
  syncVisibility();
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderTaskAttachmentsList() {
  const listEl = document.getElementById('task-attachments-list');
  if (!listEl) return;
  listEl.replaceChildren();

  if (!taskAttachments.length) {
    return;
  }

  taskAttachments.forEach(item => {
    const row = document.createElement('div');
    row.className = 'task-attachment-chip';

    const icon = document.createElement('span');
    icon.className = 'task-attachment-kind';
    icon.textContent = item.kind === 'link' ? 'Link' : 'Tệp';

    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'task-attachment-name';
    link.textContent = item.name || item.url;

    const meta = document.createElement('span');
    meta.className = 'task-attachment-meta';
    meta.textContent = item.kind === 'link' ? item.url : formatFileSize(item.size);

    row.append(icon, link, meta);

    if (canEditCurrentForm) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'task-attachment-remove';
      removeBtn.setAttribute('aria-label', `Xóa ${item.name}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        taskAttachments = taskAttachments.filter(entry => entry.id !== item.id);
        renderTaskAttachmentsList();
        markDirty();
      });
      row.append(removeBtn);
    }

    listEl.append(row);
  });
}

function setupAttachmentsHandlers() {
  const fileInput = document.getElementById('task-attachment-file');
  const titleInput = document.getElementById('task-link-title');
  const urlInput = document.getElementById('task-link-url');
  const addLinkBtn = document.getElementById('btn-add-task-link');

  fileInput?.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    fileInput.disabled = true;
    document.getElementById('task-attachment-file-btn')?.classList.add('is-disabled');

    try {
      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          showToast(`Tệp "${file.name}" vượt quá giới hạn 25 MB.`, 'warning');
          continue;
        }
        const uploaded = await uploadImage(file, 'attachment');
        taskAttachments.push({
          id: generateId(),
          kind: 'file',
          name: uploaded.name || file.name,
          url: uploaded.url,
          type: uploaded.type || file.type,
          size: uploaded.size || file.size
        });
      }
      renderTaskAttachmentsList();
      markDirty();
    } catch (error) {
      showToast(error.message || 'Không thể tải tệp đính kèm lên máy chủ.', 'error');
    } finally {
      fileInput.disabled = !canEditCurrentForm;
      document.getElementById('task-attachment-file-btn')?.classList.toggle('is-disabled', !canEditCurrentForm);
      fileInput.value = '';
    }
  });

  const handleAddLink = () => {
    const rawUrl = String(urlInput?.value || '').trim();
    if (!rawUrl) {
      showToast('Vui lòng nhập đường dẫn liên kết (https://...).', 'warning');
      urlInput?.focus();
      return;
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      parsedUrl = null;
    }
    if (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol)) {
      showToast('Liên kết phải bắt đầu bằng http:// hoặc https://.', 'warning');
      urlInput?.focus();
      return;
    }
    const label = String(titleInput?.value || '').trim() || parsedUrl.hostname;
    taskAttachments.push({
      id: generateId(),
      kind: 'link',
      name: label,
      url: parsedUrl.href,
      size: 0
    });
    if (titleInput) titleInput.value = '';
    if (urlInput) urlInput.value = '';
    renderTaskAttachmentsList();
    markDirty();
  };

  addLinkBtn?.addEventListener('click', handleAddLink);
  [titleInput, urlInput].forEach(input => {
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleAddLink();
      }
    });
  });
}

function applyPayloadToForm(payload, { preserveSubtaskStatus = false, skipPastDeadlineCheck = false } = {}) {
  document.getElementById('task-title').value = payload.title || '';

  const categorySelect = document.getElementById('task-category');
  if (categorySelect) {
    const matched = Storage.getCategories().find(
      c => c.id === payload.categoryId || c.name.trim().toLocaleLowerCase() === String(payload.categoryName || '').trim().toLocaleLowerCase()
    );
    categorySelect.value = matched ? matched.id : '';
  }

  document.getElementById('task-priority').value = payload.priority || 'medium';
  const deadlineInput = document.getElementById('task-deadline');
  const deadlineTimeInput = document.getElementById('task-deadline-time');
  const nextTime = payload.deadlineTime || '17:00';
  if (deadlineTimeInput) deadlineTimeInput.value = nextTime;

  if (deadlineInput) {
    const canKeepDate = payload.deadline && (skipPastDeadlineCheck || Validation.isFutureOrToday(payload.deadline, nextTime));
    deadlineInput.value = canKeepDate ? payload.deadline : '';
  }

  document.getElementById('task-description').value = payload.description || '';

  const recurrenceSelect = document.getElementById('task-recurrence');
  const recurrenceEndInput = document.getElementById('task-recurrence-end');
  const recurrenceEndWrap = document.getElementById('task-recurrence-end-wrap');
  const freq = payload.recurrence?.frequency || payload.recurrence || 'none';
  if (recurrenceSelect) {
    recurrenceSelect.value = freq;
  }
  if (recurrenceEndWrap) recurrenceEndWrap.hidden = !freq || freq === 'none';
  if (recurrenceEndInput) recurrenceEndInput.value = payload.recurrence?.endDate || payload.recurrenceEnd || '';

  if (Auth.canManageTasks()) {
    selectedPrimaryId = payload.assigneeId || '';
    selectedCoMemberIds.clear();
    const rawGroup = Array.isArray(payload.assigneeIds) ? payload.assigneeIds : payload.coMemberIds;
    if (Array.isArray(rawGroup)) {
      rawGroup.filter(id => id && id !== selectedPrimaryId).slice(0, MAX_CO_MEMBERS).forEach(id => selectedCoMemberIds.add(id));
    }
    const select = document.getElementById('task-assignee');
    if (select) select.value = selectedPrimaryId;
    renderPrimaryAssigneePicker();
    renderCoMemberCheckboxes();
    renderAssigneePreview();
  }

  const checklists = Array.isArray(payload.subtasks)
    ? payload.subtasks
    : (Array.isArray(payload.checklists) ? payload.checklists : []);
  if (checklists.length) {
    renderChecklistFromItems(checklists.map(item => (
      typeof item === 'string'
        ? { text: item }
        : {
            id: preserveSubtaskStatus ? item.id : '',
            text: item.text || '',
            done: preserveSubtaskStatus ? Boolean(item.done) : false,
            comments: preserveSubtaskStatus ? item.comments : []
          }
    )));
  }

  taskAttachments = Array.isArray(payload.attachments)
    ? payload.attachments.map(att => ({ ...att, id: att.id || generateId() }))
    : [];
  renderTaskAttachmentsList();
  syncFormCustomDropboxes();
}

function setupEditMode(id) {
  const task = Storage.getTaskById(id);
  if (!task) {
    showToast('Không tìm thấy công việc cần sửa.', 'error');
    setTimeout(() => window.location.href = 'tasks.html', 1200);
    return;
  }

  canEditCurrentForm = Auth.canEditTask(task);
  originalEditDeadline = { date: task.deadline || '', time: task.deadlineTime || '17:00' };

  document.getElementById('form-page-title').textContent = 'Chỉnh sửa công việc';
  document.getElementById('btn-submit-text').textContent = 'Lưu thay đổi';

  applyPayloadToForm(task, { preserveSubtaskStatus: true, skipPastDeadlineCheck: true });

  const draftBtn = document.getElementById('btn-save-draft');
  if (draftBtn) draftBtn.hidden = true;

  if (!canEditCurrentForm) {
    [
      'task-title', 'task-category', 'task-priority', 'task-deadline', 'task-deadline-time',
      'task-recurrence', 'task-recurrence-end', 'task-description',
      'task-attachment-file', 'task-link-title', 'task-link-url', 'btn-add-task-link'
    ].forEach(fieldId => {
      const el = document.getElementById(fieldId);
      if (el) el.disabled = true;
    });
    const fileBtn = document.getElementById('task-attachment-file-btn');
    if (fileBtn) fileBtn.classList.add('is-disabled');
    const quickCatBtn = document.getElementById('btn-toggle-quick-category');
    if (quickCatBtn) quickCatBtn.hidden = true;
    const addChecklistBtn = document.getElementById('add-initial-checklist-item');
    if (addChecklistBtn) addChecklistBtn.hidden = true;
    const assigneeGroup = document.getElementById('task-assignee-group');
    if (assigneeGroup) assigneeGroup.hidden = true;
    renderPrimaryAssigneePicker();
    renderCoMemberCheckboxes();
    refreshChecklistRows();
    renderTaskAttachmentsList();
    syncFormCustomDropboxes();
  }
}

function setupDuplicateMode(sourceId) {
  const source = Storage.getTaskById(sourceId);
  if (!source) {
    showToast('Không tìm thấy công việc mẫu để nhân bản.', 'warning');
    return;
  }

  document.getElementById('form-page-title').textContent = 'Nhân bản công việc';
  document.getElementById('btn-submit-text').textContent = 'Tạo từ bản sao';

  applyPayloadToForm({
    ...source,
    title: `[Bản sao] ${source.title || ''}`
  }, { preserveSubtaskStatus: false, skipPastDeadlineCheck: false });

  markDirty();
  showToast('Đã nạp dữ liệu bản sao. Hãy kiểm tra tên và chọn hạn chót mới.', 'success');
}

function setupDraftBanner() {
  const raw = localStorage.getItem(getDraftStorageKey());
  if (!raw) return;
  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    localStorage.removeItem(getDraftStorageKey());
    return;
  }
  if (!draft || typeof draft !== 'object') return;

  const banner = document.getElementById('task-draft-banner');
  const timeEl = document.getElementById('task-draft-time');
  const restoreBtn = document.getElementById('btn-restore-draft');
  const discardBtn = document.getElementById('btn-discard-draft');
  if (!banner) return;

  if (timeEl && draft.savedAt) {
    const savedDate = new Date(draft.savedAt);
    timeEl.textContent = !isNaN(savedDate.getTime())
      ? `Đã lưu lúc ${savedDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ngày ${savedDate.toLocaleDateString('vi-VN')}.`
      : 'Bạn có bản nháp đã lưu từ trước.';
  }
  banner.hidden = false;

  restoreBtn?.addEventListener('click', () => {
    applyPayloadToForm(draft, { preserveSubtaskStatus: false, skipPastDeadlineCheck: true });
    banner.hidden = true;
    markDirty();
    showToast('Đã khôi phục bản nháp công việc.', 'success');
  });

  discardBtn?.addEventListener('click', () => {
    localStorage.removeItem(getDraftStorageKey());
    banner.hidden = true;
    showToast('Đã xóa bản nháp đã lưu.', 'success');
  });
}

function setupDraftAndUnloadActions() {
  const form = document.getElementById('task-form');
  const draftBtn = document.getElementById('btn-save-draft');
  const cancelBtn = document.getElementById('btn-cancel-form');

  form?.addEventListener('input', event => {
    if (event.target.matches('#primary-assignee-search, #team-members-search, #quick-category-name, #task-link-title, #task-link-url')) return;
    markDirty();
  });
  form?.addEventListener('change', event => {
    if (event.target.matches('#task-attachment-file')) return;
    markDirty();
  });

  draftBtn?.addEventListener('click', () => {
    if (editingTaskId) return;
    const categoryId = document.getElementById('task-category')?.value || '';
    const category = Storage.getCategories().find(c => c.id === categoryId);
    const payload = {
      title: document.getElementById('task-title')?.value.trim() || '',
      categoryId,
      categoryName: category?.name || '',
      deadline: document.getElementById('task-deadline')?.value || '',
      deadlineTime: document.getElementById('task-deadline-time')?.value || '17:00',
      priority: document.getElementById('task-priority')?.value || 'medium',
      recurrence: {
        frequency: document.getElementById('task-recurrence')?.value || 'none',
        endDate: document.getElementById('task-recurrence-end')?.value || ''
      },
      description: document.getElementById('task-description')?.value || '',
      assigneeId: selectedPrimaryId,
      assigneeIds: [selectedPrimaryId, ...getSelectedTeamMembers()].filter(Boolean),
      checklists: readChecklistPayload(true).map(item => item.text),
      attachments: taskAttachments,
      savedAt: new Date().toISOString()
    };

    try {
      localStorage.setItem(getDraftStorageKey(), JSON.stringify(payload));
      isFormDirty = false;
      const banner = document.getElementById('task-draft-banner');
      if (banner) banner.hidden = true;
      showToast('Đã lưu bản nháp công việc.', 'success');
    } catch {
      showToast('Không thể lưu bản nháp vào trình duyệt.', 'error');
    }
  });

  cancelBtn?.addEventListener('click', event => {
    if (!isFormDirty) return;
    event.preventDefault();
    showConfirmModal(
      'Rời khỏi biểu mẫu?',
      'Bạn có dữ liệu chưa lưu. Nếu thoát ngay bây giờ, các thay đổi chưa lưu sẽ bị mất.',
      () => {
        isFormDirty = false;
        window.location.href = cancelBtn.href || 'tasks.html';
      }
    );
  });

  window.addEventListener('beforeunload', event => {
    if (!isFormDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

function setupForm() {
  const form = document.getElementById('task-form');
  const titleInput = document.getElementById('task-title');
  const categorySelect = document.getElementById('task-category');
  const deadlineInput = document.getElementById('task-deadline');
  const deadlineTimeInput = document.getElementById('task-deadline-time');
  const recurrenceSelect = document.getElementById('task-recurrence');
  const recurrenceEndInput = document.getElementById('task-recurrence-end');
  const descriptionInput = document.getElementById('task-description');
  const { error: checklistError } = getChecklistContainerElements();

  [titleInput, categorySelect, deadlineInput, deadlineTimeInput, recurrenceEndInput].forEach(el => {
    el?.addEventListener('input', () => Validation.clearError(el));
    el?.addEventListener('change', () => Validation.clearError(el));
  });

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

    if (!Validation.isRequired(titleInput.value) || !Validation.minLength(titleInput.value, 3)) {
      Validation.showError(titleInput, 'Nhập tên công việc (tối thiểu 3 ký tự).');
      valid = false;
    } else {
      Validation.clearError(titleInput);
    }

    const selectedCategory = Storage.getCategories().find(item => item.id === categorySelect.value);
    if (!selectedCategory) {
      Validation.showError(categorySelect, 'Vui lòng chọn danh mục / dự án từ danh sách.');
      valid = false;
    } else {
      Validation.clearError(categorySelect);
    }

    const deadlineDate = deadlineInput.value;
    const deadlineTime = deadlineTimeInput?.value || '17:00';
    const deadlineChanged = !editingTaskId || deadlineDate !== originalEditDeadline.date || deadlineTime !== originalEditDeadline.time;

    if (!Validation.isRequired(deadlineDate) || !Validation.isValidDate(deadlineDate)) {
      Validation.showError(deadlineInput, 'Chọn ngày hạn chót hợp lệ.');
      valid = false;
    } else if (deadlineChanged && !Validation.isFutureOrToday(deadlineDate, deadlineTime)) {
      Validation.showError(deadlineInput, 'Không thể chọn hạn chót trong quá khứ.');
      valid = false;
    } else {
      Validation.clearError(deadlineInput);
    }

    const freq = recurrenceSelect?.value || 'none';
    const recurrenceEnd = recurrenceEndInput?.value || '';
    if (freq !== 'none' && recurrenceEnd) {
      if (!Validation.isValidDate(recurrenceEnd) || (deadlineDate && recurrenceEnd < deadlineDate)) {
        Validation.showError(recurrenceEndInput, 'Ngày kết thúc lặp phải sau hoặc bằng ngày hạn chót.');
        valid = false;
      } else {
        Validation.clearError(recurrenceEndInput);
      }
    } else if (recurrenceEndInput) {
      Validation.clearError(recurrenceEndInput);
    }

    const checklistPayload = readChecklistPayload(!editingTaskId);
    const checklistInputs = [...document.querySelectorAll('.initial-checklist-input')];
    const rawChecklistTexts = checklistInputs.map(input => input.value.trim()).filter(Boolean);
    const distinctChecklistTexts = new Set(rawChecklistTexts.map(text => text.toLocaleLowerCase()));
    const checklistValid = checklistPayload.length >= 1 && distinctChecklistTexts.size === rawChecklistTexts.length;

    if (!checklistValid) {
      if (checklistError) {
        checklistError.hidden = false;
        checklistError.textContent = checklistPayload.length < 1
          ? 'Vui lòng nhập ít nhất một mục checklist.'
          : 'Các mục checklist cần có nội dung khác nhau.';
      }
      checklistInputs.find(input => !input.value.trim())?.focus();
      valid = false;
    } else if (checklistError) {
      checklistError.hidden = true;
    }

    if (!valid) {
      showToast('Vui lòng kiểm tra lại thông tin đã nhập.', 'warning');
      return;
    }

    let finalPrimaryId = null;
    let finalTeamIds = [];
    if (Auth.canManageTasks() && Auth.canEditTask(existingTask || {})) {
      const target = getAssignableAccounts().find(user => user.id === selectedPrimaryId);
      if (!editingTaskId && !target) {
        showToast('Vui lòng chọn người phụ trách chính cho công việc.', 'warning');
        return;
      }
      finalPrimaryId = target?.id || null;
      const coMembers = getSelectedTeamMembers().filter(id => id !== finalPrimaryId);
      if (coMembers.length > MAX_CO_MEMBERS) {
        showToast('Nhóm thực hiện tối đa 3 người (1 phụ trách chính + 2 phối hợp).', 'warning');
        return;
      }
      finalTeamIds = finalPrimaryId ? [finalPrimaryId, ...coMembers] : [];
    }

    const taskData = {
      title: titleInput.value.trim(),
      categoryId: selectedCategory.id,
      categoryName: selectedCategory.name,
      priority: document.getElementById('task-priority').value,
      deadline: deadlineDate,
      deadlineTime,
      description: descriptionInput.value.trim(),
      attachments: taskAttachments.slice(),
      subtasks: checklistPayload,
      recurrence: freq !== 'none'
        ? { frequency: freq, ...(recurrenceEnd ? { endDate: recurrenceEnd } : {}) }
        : null
    };

    if (!editingTaskId && !Auth.canManageTasks()) {
      taskData.assigneeId = null;
      taskData.assigneeIds = [];
    } else if (Auth.canManageTasks() && Auth.canEditTask(existingTask || {})) {
      taskData.assigneeId = finalPrimaryId;
      taskData.assigneeIds = finalTeamIds;
    }

    const previousAssigneeIds = new Set(
      Array.isArray(existingTask?.assigneeIds) && existingTask.assigneeIds.length
        ? existingTask.assigneeIds
        : (existingTask?.assigneeId ? [existingTask.assigneeId] : [])
    );

    const taskToSave = editingTaskId ? null : {
      id: generateId(),
      ...taskData,
      ownerId: Auth.getCurrentUser()?.id,
      createdAt: new Date().toISOString().slice(0, 10)
    };

    Promise.resolve(editingTaskId ? Storage.updateTask(editingTaskId, taskData) : Storage.addTask(taskToSave)).then(ok => {
      if (!ok) {
        showToast('Không thể đồng bộ công việc lên API.', 'error');
        return;
      }
      isFormDirty = false;
      if (!editingTaskId) {
        localStorage.removeItem(getDraftStorageKey());
      }

      const assignmentTask = taskToSave || { ...existingTask, ...taskData, id: existingTask?.id || editingTaskId };
      const currentTeam = Array.isArray(assignmentTask.assigneeIds) ? assignmentTask.assigneeIds : (assignmentTask.assigneeId ? [assignmentTask.assigneeId] : []);
      const hasNewAssignee = currentTeam.some(id => !previousAssigneeIds.has(id));
      if (hasNewAssignee) {
        Notifications.taskAssigned(assignmentTask, Auth.getCurrentUser());
      }

      const msg = editingTaskId
        ? 'Đã cập nhật công việc.'
        : (Auth.getCurrentUser()?.role === 'user' ? 'Đã gửi yêu cầu công việc, chờ admin duyệt.' : 'Đã tạo công việc mới.');
      showToast(msg, 'success');
      setTimeout(() => window.location.href = 'tasks.html', 700);
    });
  });
}
