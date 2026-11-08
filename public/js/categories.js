import { Auth } from './auth.js';
// categories.js - Quản lý CRUD Danh mục / Dự án (ES6+)
import { Storage } from './storage.js';
import { generateId } from './utils.js';
import { showToast, showConfirmModal } from './main.js';

document.addEventListener('DOMContentLoaded', async () => {
  await Auth.loadUsers();
  if (!Auth.canManageCategories()) { window.location.replace('index.html'); return; }
  await Storage.init();
  renderCategories();
  setupAddCategoryForm();
});

function renderCategories() {
  const categories = Storage.getCategories();
  const tasks = Storage.getTasks();
  const tbody = document.getElementById('categories-table-body');
  if (!tbody) return;

  if (categories.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center" style="padding: 30px;">Chưa có danh mục nào. Hãy tạo danh mục đầu tiên!</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = categories.map(cat => {
    // Đếm số task thuộc danh mục này
    const count = tasks.filter(t => t.categoryId === cat.id || (t.categoryName || '').trim().toLocaleLowerCase() === cat.name.trim().toLocaleLowerCase()).length;

    return `
      <tr>
        <td>
          <span style="display: inline-block; width: 14px; height: 14px; border-radius: 50%; background: ${cat.color || '#4f46e5'}; vertical-align: middle; margin-right: 8px;"></span>
          <strong>${escapeHtml(cat.name)}</strong>
        </td>
        <td>
          <span class="badge" style="background: #f1f5f9; color: #475569;">${count} công việc</span>
        </td>
        <td>
          <code>${escapeHtml(cat.color || '#4f46e5')}</code>
        </td>
        <td>
          <button class="btn-icon delete btn-del-cat" data-id="${escapeHtml(cat.id)}" data-name="${escapeHtml(cat.name)}" title="Xóa danh mục">&#128465;</button>
        </td>
      </tr>
    `;
  }).join('');

  // Gắn sự kiện xóa danh mục
  document.querySelectorAll('.btn-del-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name;

      showConfirmModal(
        'Xóa danh mục',
        `Bạn có chắc chắn muốn xóa danh mục "${name}"? Các công việc thuộc danh mục này sẽ hiển thị là Chưa phân loại.`,
        () => {
          const result = Storage.deleteCategory(id);
          if (result === false) { showToast('Khong the xoa danh muc.', 'error'); return; }
          Promise.resolve(result).then(saved => { if (saved) renderCategories(); else showToast('Khong the dong bo danh muc.', 'error'); });
        }
      );
    });
  });
}

function setupAddCategoryForm() {
  const form = document.getElementById('add-category-form');
  const nameInput = document.getElementById('cat-name');
  const colorInput = document.getElementById('cat-color');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const color = colorInput.value;

    if (!name) {
      showToast('Vui lòng nhập tên danh mục!', 'warning');
      return;
    }
    if (Storage.getCategories().some(category => category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      showToast('Danh m\u1ee5c n\u00e0y \u0111\u00e3 t\u1ed3n t\u1ea1i.', 'warning');
      return;
    }

    const newCat = {
      id: generateId(),
      name,
      color
    };

    const added = Storage.addCategory(newCat);
    if (added === false) {
      showToast('T\u00e0i kho\u1ea3n hi\u1ec7n t\u1ea1i kh\u00f4ng c\u00f3 quy\u1ec1n t\u1ea1o danh m\u1ee5c.', 'error');
      return;
    }
    Promise.resolve(added).then(saved => {
      if (!saved) { showToast('Kh\u00f4ng th\u1ec3 \u0111\u1ed3ng b\u1ed9 danh m\u1ee5c.', 'error'); return; }
      nameInput.value = '';
      renderCategories();
      showToast('\u0110\u00e3 t\u1ea1o danh m\u1ee5c m\u1edbi th\u00e0nh c\u00f4ng!', 'success');
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}


