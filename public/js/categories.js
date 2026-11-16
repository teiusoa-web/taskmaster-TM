import { Auth } from './auth.js';
// categories.js - Quản lý CRUD Danh mục / Dự án (ES6+)
import { Storage } from './storage.js';
import { generateId } from './utils.js';
import { showToast, showConfirmModal } from './main.js';

const COLOR_PRESETS = [
  '#6366f1', '#0ea5e9', '#14b8a6', '#10b981',
  '#f59e0b', '#f97316', '#ec4899', '#ef4444'
];

let editingCategoryId = null;
let searchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
  await Auth.loadUsers();
  if (!Auth.canManageCategories()) {
    window.location.replace('index.html');
    return;
  }
  await Storage.init();
  setupColorPickerUI();
  setupSearch();
  setupCategoryForm();
  syncLivePreview();
  renderCategories();
});

function syncColorUI(hexColor) {
  const safeColor = /^#[0-9a-f]{6}$/i.test(hexColor || '') ? hexColor.toLowerCase() : '#6366f1';
  const colorInput = document.getElementById('cat-color');
  const swatchEl = document.getElementById('cat-color-swatch');
  const hexEl = document.getElementById('cat-color-hex');

  if (colorInput) colorInput.value = safeColor;
  if (swatchEl) swatchEl.style.background = safeColor;
  if (hexEl) hexEl.textContent = safeColor.toUpperCase();

  document.querySelectorAll('.cat-swatch-btn').forEach(btn => {
    const active = btn.dataset.color?.toLowerCase() === safeColor;
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  syncLivePreview();
}

function syncLivePreview() {
  const name = document.getElementById('cat-name')?.value.trim() || 'Tên danh mục';
  const color = document.getElementById('cat-color')?.value || '#6366f1';
  const dot = document.getElementById('cat-preview-dot');
  const chip = document.getElementById('cat-preview-chip');
  const textEl = document.getElementById('cat-preview-name');

  if (textEl) textEl.textContent = name;
  if (dot) dot.style.background = color;
  if (chip) {
    chip.style.borderColor = `${color}44`;
    chip.style.background = `${color}14`;
  }
}

function setupColorPickerUI() {
  const container = document.getElementById('cat-color-presets');
  const colorInput = document.getElementById('cat-color');
  const nameInput = document.getElementById('cat-name');

  if (container) {
    container.replaceChildren(...COLOR_PRESETS.map(hex => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-swatch-btn';
      btn.dataset.color = hex;
      btn.style.background = hex;
      btn.setAttribute('aria-label', `Chọn màu ${hex}`);
      btn.title = hex.toUpperCase();
      btn.addEventListener('click', () => syncColorUI(hex));
      return btn;
    }));
  }

  colorInput?.addEventListener('input', () => syncColorUI(colorInput.value));
  nameInput?.addEventListener('input', syncLivePreview);
  syncColorUI(colorInput?.value || '#6366f1');
}

function setupSearch() {
  const searchInput = document.getElementById('cat-search-input');
  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderCategories();
  });
}

function enterEditMode(category) {
  editingCategoryId = category.id;
  document.getElementById('cat-form-title').textContent = 'Chỉnh sửa danh mục';
  document.getElementById('cat-form-subtitle').textContent = `Đang sửa: ${category.name}`;
  document.getElementById('cat-submit-btn').textContent = 'Lưu thay đổi';
  document.getElementById('cat-cancel-edit-btn').hidden = false;

  const nameInput = document.getElementById('cat-name');
  if (nameInput) {
    nameInput.value = category.name || '';
    nameInput.focus();
  }
  syncColorUI(category.color || '#6366f1');
}

function exitEditMode() {
  editingCategoryId = null;
  document.getElementById('cat-form-title').textContent = '+ Thêm Danh Mục Mới';
  document.getElementById('cat-form-subtitle').textContent = 'Phân loại công việc và dự án theo màu sắc';
  document.getElementById('cat-submit-btn').textContent = 'Tạo danh mục';
  document.getElementById('cat-cancel-edit-btn').hidden = true;

  const nameInput = document.getElementById('cat-name');
  if (nameInput) nameInput.value = '';
  syncColorUI('#6366f1');
}

function renderCategories() {
  const allCategories = Storage.getCategories();
  const tasks = Storage.getTasks();
  const tbody = document.getElementById('categories-table-body');
  const totalBadge = document.getElementById('cat-total-badge');
  if (!tbody) return;

  if (totalBadge) {
    totalBadge.textContent = `${allCategories.length} danh mục`;
  }

  const categories = searchQuery
    ? allCategories.filter(c => String(c.name || '').toLowerCase().includes(searchQuery))
    : allCategories;

  if (categories.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center" style="padding: 36px 20px; color: var(--text-muted);">
          ${searchQuery ? `Không tìm thấy danh mục khớp "${escapeHtml(searchQuery)}".` : 'Chưa có danh mục nào. Hãy tạo danh mục đầu tiên!'}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = categories.map(cat => {
    const color = /^#[0-9a-f]{3,8}$/i.test(cat.color || '') ? cat.color : '#6366f1';
    const catTasks = tasks.filter(
      t => t.categoryId === cat.id || (t.categoryName || '').trim().toLocaleLowerCase() === cat.name.trim().toLocaleLowerCase()
    );
    const totalCount = catTasks.length;
    const completedCount = catTasks.filter(t => t.status === 'completed').length;
    const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    return `
      <tr>
        <td>
          <div class="cat-table-name-cell">
            <span class="cat-preview-chip" style="border-color: ${color}44; background: ${color}14;">
              <span class="cat-preview-dot" style="background: ${color};"></span>
              <strong>${escapeHtml(cat.name)}</strong>
            </span>
          </div>
        </td>
        <td>
          <div class="cat-progress-cell">
            <div class="cat-progress-meta">
              <strong>${totalCount}</strong><span>công việc</span>
              <small>${completedCount}/${totalCount} xong (${pct}%)</small>
            </div>
            <div class="cat-progress-mini" aria-label="Tiến độ ${pct}%">
              <span style="width: ${pct}%; background: ${color};"></span>
            </div>
          </div>
        </td>
        <td>
          <span class="cat-hex-pill">
            <span class="cat-hex-dot" style="background: ${color};"></span>
            <code>${escapeHtml(color.toUpperCase())}</code>
          </span>
        </td>
        <td style="text-align: right;">
          <div class="cat-row-actions">
            <button type="button" class="cat-action-btn is-edit btn-edit-cat" data-id="${escapeHtml(cat.id)}" title="Chỉnh sửa danh mục" aria-label="Chỉnh sửa ${escapeHtml(cat.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button type="button" class="cat-action-btn is-delete btn-del-cat" data-id="${escapeHtml(cat.id)}" data-name="${escapeHtml(cat.name)}" title="Xóa danh mục" aria-label="Xóa ${escapeHtml(cat.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-edit-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = allCategories.find(item => item.id === btn.dataset.id);
      if (cat) enterEditMode(cat);
    });
  });

  tbody.querySelectorAll('.btn-del-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name;

      showConfirmModal(
        'Xóa danh mục',
        `Bạn có chắc chắn muốn xóa danh mục "${name}"? Các công việc thuộc danh mục này sẽ hiển thị là Chưa phân loại.`,
        () => {
          const result = Storage.deleteCategory(id);
          if (result === false) {
            showToast('Không thể xóa danh mục.', 'error');
            return;
          }
          Promise.resolve(result).then(saved => {
            if (!saved) {
              showToast('Không thể đồng bộ thao tác xóa danh mục.', 'error');
              return;
            }
            if (editingCategoryId === id) exitEditMode();
            renderCategories();
            showToast(`Đã xóa danh mục "${name}".`, 'success');
          });
        }
      );
    });
  });
}

function setupCategoryForm() {
  const form = document.getElementById('add-category-form');
  const nameInput = document.getElementById('cat-name');
  const colorInput = document.getElementById('cat-color');
  const cancelEditBtn = document.getElementById('cat-cancel-edit-btn');
  if (!form) return;

  cancelEditBtn?.addEventListener('click', exitEditMode);

  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const color = colorInput.value;

    if (!name) {
      showToast('Vui lòng nhập tên danh mục!', 'warning');
      nameInput.focus();
      return;
    }

    const duplicate = Storage.getCategories().some(
      category => category.id !== editingCategoryId && category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    if (duplicate) {
      showToast('Danh mục này đã tồn tại.', 'warning');
      nameInput.focus();
      return;
    }

    if (editingCategoryId) {
      const updated = Storage.updateCategory(editingCategoryId, { name, color });
      if (updated === false) {
        showToast('Tài khoản hiện tại không có quyền sửa danh mục.', 'error');
        return;
      }
      Promise.resolve(updated).then(saved => {
        if (!saved) {
          showToast('Không thể đồng bộ cập nhật danh mục.', 'error');
          return;
        }
        exitEditMode();
        renderCategories();
        showToast('Đã cập nhật danh mục thành công!', 'success');
      });
      return;
    }

    const newCat = {
      id: generateId(),
      name,
      color
    };

    const added = Storage.addCategory(newCat);
    if (added === false) {
      showToast('Tài khoản hiện tại không có quyền tạo danh mục.', 'error');
      return;
    }
    Promise.resolve(added).then(saved => {
      if (!saved) {
        showToast('Không thể đồng bộ danh mục.', 'error');
        return;
      }
      exitEditMode();
      renderCategories();
      showToast('Đã tạo danh mục mới thành công!', 'success');
    });
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
