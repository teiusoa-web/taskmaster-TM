import { Auth } from './auth.js';
import { showToast } from './main.js';
import { applyAvatarCrop, saveAvatarProfile, uploadImage } from './uploads.js';

document.addEventListener('DOMContentLoaded', async () => {
  await Auth.loadUsers();
  const user = Auth.getCurrentUser();
  if (!user) return;

  const passwordForm = document.getElementById('password-change-form');
  passwordForm.addEventListener('submit', async event => {
    event.preventDefault();
    const formData = new FormData(passwordForm);
    const message = document.getElementById('password-change-message');
    if (formData.get('newPassword') !== formData.get('confirmPassword')) {
      message.textContent = 'Mật khẩu nhập lại không khớp.';
      return;
    }
    try {
      await Auth.changePassword(formData.get('currentPassword'), formData.get('newPassword'));
      passwordForm.reset();
      message.textContent = 'Đã cập nhật mật khẩu.';
    } catch (error) {
      message.textContent = error.message || 'Không thể đổi mật khẩu.';
    }
  });

  const roles = {
    admin: 'Qu\u1ea3n tr\u1ecb vi\u00ean',
    manager: 'Qu\u1ea3n l\u00fd',
    user: 'Ng\u01b0\u1eddi d\u00f9ng'
  };
  const avatar = document.getElementById('profile-avatar');
  const photoInput = document.getElementById('profile-photo-input');
  const photoButton = document.querySelector('.account-photo-button');
  const avatarWrap = document.querySelector('.account-profile-avatar-wrap');
  const removePhotoButton = document.getElementById('remove-profile-photo');
  const photoError = document.getElementById('profile-photo-error');
  const cropModal = document.getElementById('avatar-crop-modal');
  const cropViewport = document.getElementById('avatar-crop-viewport');
  const cropImage = document.getElementById('avatar-crop-image');
  const cropZoom = document.getElementById('avatar-crop-zoom');
  const cropZoomValue = document.getElementById('avatar-crop-zoom-value');
  const cropSaveButton = document.getElementById('avatar-crop-save');
  let pendingAvatarFile = null;
  let cropPreviewUrl = '';
  let avatarCrop = { x: 0, y: 0, zoom: 1 };
  let dragState = null;
  let initials = String(user.name || user.username).trim().split(/\s+/).map(part => part[0]).slice(-2).join('').toUpperCase();

  const setAvatarBusy = busy => {
    avatar.classList.toggle('is-uploading', busy);
    avatar.setAttribute('aria-busy', String(busy));
    if (avatarWrap) avatarWrap.classList.toggle('is-uploading', busy);
    photoInput.disabled = busy;
    photoButton?.setAttribute('aria-disabled', String(busy));
    removePhotoButton.disabled = busy;
    if (cropSaveButton) cropSaveButton.disabled = busy;
  };

  const renderAvatar = () => {
    avatar.replaceChildren();
    if (!user.avatar) {
      avatar.textContent = initials;
      removePhotoButton.hidden = true;
    } else {
      const image = document.createElement('img');
      image.src = user.avatar;
      image.alt = '';
      applyAvatarCrop(image, user.avatarCrop);
      image.addEventListener('error', () => {
        if (!image.isConnected) return;
        avatar.replaceChildren();
        avatar.textContent = initials;
        photoError.textContent = 'T\u1ec7p \u1ea3nh \u0111\u1ea1i di\u1ec7n kh\u00f4ng c\u00f2n tr\u00ean m\u00e1y ch\u1ee7. H\u00e3y t\u1ea3i l\u00ean \u1ea3nh m\u1edbi.';
        photoError.hidden = false;
      }, { once: true });
      avatar.append(image);
      removePhotoButton.hidden = false;
    }
    document.querySelectorAll('.avatar').forEach(sidebarAvatar => {
      sidebarAvatar.replaceChildren();
      if (user.avatar) {
        const image = document.createElement('img');
        image.src = user.avatar;
        image.alt = '';
        applyAvatarCrop(image, user.avatarCrop);
        image.addEventListener('error', () => {
          if (!image.isConnected) return;
          sidebarAvatar.replaceChildren();
          sidebarAvatar.textContent = initials;
          sidebarAvatar.classList.remove('has-profile-photo');
        }, { once: true });
        sidebarAvatar.append(image);
      } else {
        sidebarAvatar.textContent = initials;
      }
    });
  };

  const saveAvatar = async (value, crop = avatarCrop) => {
    try {
      await saveAvatarProfile(user, value || null, crop);
      renderAvatar();
      return true;
    } catch {
      photoError.textContent = 'Kh\u00f4ng th\u1ec3 l\u01b0u \u1ea3nh. H\u00e3y ch\u1ecdn t\u1ec7p nh\u1ecf h\u01a1n.';
      photoError.hidden = false;
      return false;
    }
  };

  renderAvatar();
  if (user.avatar) {
    const syncAvatar = async () => {
      setAvatarBusy(true);
      try {
        if (user.avatar.startsWith('data:image/')) {
          const response = await fetch(user.avatar);
          const blob = await response.blob();
          const extension = blob.type.split('/')[1] || 'png';
          const uploaded = await uploadImage(new File([blob], `${user.username}.${extension}`, { type: blob.type }), 'avatar');
          if (!await saveAvatar(uploaded.url)) throw new Error('Không thể lưu ảnh đại diện vào database.');
          return;
        }
        await saveAvatarProfile(user, user.avatar, user.avatarCrop);
      } finally {
        setAvatarBusy(false);
      }
    };
    syncAvatar().catch(error => {
      photoError.textContent = error.message || 'Không thể đồng bộ ảnh đại diện vào database.';
      photoError.hidden = false;
    });
  }
  document.getElementById('profile-name').textContent = user.name || user.username;
  document.getElementById('profile-role').textContent = roles[user.role] || user.role;
  document.getElementById('profile-detail-name').textContent = user.name || '\u2014';
  document.getElementById('profile-username').textContent = user.username || '\u2014';
  document.getElementById('profile-role-detail').textContent = roles[user.role] || user.role;
  document.getElementById('profile-id').textContent = user.id || '\u2014';
  document.getElementById('profile-user-code-row').hidden = user.role !== 'user';
  const birthDateValue = document.getElementById('profile-birth-date');
  const hobbiesValue = document.getElementById('profile-hobbies');
  const editForm = document.getElementById('profile-edit-form');
  const editNameInput = document.getElementById('profile-edit-name');
  const editEmailInput = document.getElementById('profile-edit-email');
  const editPhoneInput = document.getElementById('profile-edit-phone');
  const editCurrentPasswordInput = document.getElementById('profile-edit-current-password');
  const editBirthDateInput = document.getElementById('profile-edit-birth-date');
  const editHobbiesInput = document.getElementById('profile-edit-hobbies');
  const setProfileFields = () => {
    initials = String(user.name || user.username).trim().split(/\s+/).map(part => part[0]).slice(-2).join('').toUpperCase();
    document.getElementById('profile-name').textContent = user.name || user.username;
    document.getElementById('profile-detail-name').textContent = user.name || '\u2014';
    document.getElementById('profile-email').textContent = user.email || '\u2014';
    document.getElementById('profile-phone').textContent = user.phone || '\u2014';
     document.getElementById('email-verification-status').textContent = user.emailVerified ? 'Email đã xác minh.' : 'Email chưa xác minh; hãy xác minh để khôi phục mật khẩu.';
    document.getElementById('verify-email-button').hidden = Boolean(user.emailVerified);
    birthDateValue.textContent = formatBirthDate(user.birthDate) || '\u2014';
    hobbiesValue.textContent = user.hobbies || '\u2014';
    renderAvatar();
    document.querySelectorAll('.author-info h4').forEach(element => { element.textContent = user.name || user.username; });
  };
  const fillEditForm = () => {
    editNameInput.value = user.name || '';
    editEmailInput.value = user.email || '';
    editPhoneInput.value = user.phone || '';
    editCurrentPasswordInput.value = '';
    editBirthDateInput.value = user.birthDate || '';
    editHobbiesInput.value = user.hobbies || '';
  };
  document.getElementById('edit-profile-button').addEventListener('click', () => {
    fillEditForm();
    editForm.hidden = false;
    editNameInput.focus();
  });
  document.getElementById('cancel-profile-edit').addEventListener('click', () => {
    editForm.hidden = true;
    fillEditForm();
  });
  editForm.addEventListener('submit', async event => {
    event.preventDefault();
    const name = editNameInput.value.trim();
    if (!name) {
      showToast('Vui lòng nhập tên hiển thị.', 'warning');
      editNameInput.focus();
      return;
    }
    const users = Auth.getUsers();
    const index = users.findIndex(item => item.id === user.id);
    if (index < 0) {
      showToast('Không tìm thấy tài khoản để cập nhật.', 'error');
      return;
    }
    const profileFields = {
      name,
      email: editEmailInput.value.trim().toLowerCase(),
      phone: editPhoneInput.value.trim(),
      birthDate: editBirthDateInput.value,
      hobbies: editHobbiesInput.value.trim()
    };
    const emailChanged = profileFields.email !== String(user.email || '').toLowerCase();
    if (emailChanged && !editCurrentPasswordInput.value) {
      showToast('Nhập mật khẩu hiện tại để đổi email.', 'warning');
      editCurrentPasswordInput.focus();
      return;
    }
    users[index] = { ...users[index], ...profileFields, ...(emailChanged ? { currentPassword: editCurrentPasswordInput.value } : {}) };
    try {
      if (!await Auth.saveUsers(users)) throw new Error('Account could not be saved.');
      Object.assign(user, profileFields);
      const savedUser = Auth.getUsers().find(item => item.id === user.id);
      if (savedUser) Object.assign(user, savedUser);
      setProfileFields();
      editForm.hidden = true;
      showToast('Đã cập nhật thông tin tài khoản.', 'success');
    } catch {
      showToast('Không thể lưu thông tin. Vui lòng thử lại.', 'error');
    }
  });
  document.getElementById('verify-email-button').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    const statusMessage = document.getElementById('email-verification-status');
    try {
      const result = await Auth.requestEmailVerification();
      statusMessage.textContent = result.message;
    } catch (error) {
      statusMessage.textContent = error.message || 'Could not send email verification.';
    } finally { event.currentTarget.disabled = false; }
  });
  setProfileFields();
  const status = document.getElementById('profile-status');
  status.textContent = user.active ? '\u0110ang ho\u1ea1t \u0111\u1ed9ng' : '\u0110\u00e3 kh\u00f3a';
  status.classList.toggle('is-active', Boolean(user.active));

  const updateCropPreview = () => {
    cropImage.style.setProperty('--crop-x', `${avatarCrop.x}%`);
    cropImage.style.setProperty('--crop-y', `${avatarCrop.y}%`);
    cropImage.style.setProperty('--crop-zoom', avatarCrop.zoom);
    cropZoom.value = String(avatarCrop.zoom);
    cropZoomValue.value = `${Math.round(avatarCrop.zoom * 100)}%`;
  };
  const closeCropModal = () => {
    cropModal.hidden = true;
    pendingAvatarFile = null;
    photoInput.value = '';
    if (cropPreviewUrl) URL.revokeObjectURL(cropPreviewUrl);
    cropPreviewUrl = '';
    cropImage.removeAttribute('src');
  };
  const clampCropOffset = value => {
    const bound = Math.max(0, (avatarCrop.zoom - 1) * 50);
    return Math.max(-bound, Math.min(bound, value));
  };

  photoInput.addEventListener('change', () => {
    photoError.hidden = true;
    const file = photoInput.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      photoError.textContent = 'Ch?n ?nh PNG, JPG, WebP ho?c GIF.';
      photoError.hidden = false;
      photoInput.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      photoError.textContent = '?nh kh?ng ???c v??t qu? 5 MB.';
      photoError.hidden = false;
      photoInput.value = '';
      return;
    }
    pendingAvatarFile = file;
    avatarCrop = { x: 0, y: 0, zoom: 1 };
    if (cropPreviewUrl) URL.revokeObjectURL(cropPreviewUrl);
    cropPreviewUrl = URL.createObjectURL(file);
    cropImage.src = cropPreviewUrl;
    updateCropPreview();
    cropModal.hidden = false;
    document.getElementById('avatar-crop-cancel').focus();
  });

  cropZoom.addEventListener('input', () => {
    avatarCrop.zoom = Number(cropZoom.value);
    avatarCrop.x = clampCropOffset(avatarCrop.x);
    avatarCrop.y = clampCropOffset(avatarCrop.y);
    updateCropPreview();
  });
  cropViewport.addEventListener('pointerdown', event => {
    if (!pendingAvatarFile || event.button !== 0) return;
    dragState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, cropX: avatarCrop.x, cropY: avatarCrop.y };
    cropViewport.setPointerCapture(event.pointerId);
  });
  cropViewport.addEventListener('pointermove', event => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const bounds = cropViewport.getBoundingClientRect();
    avatarCrop.x = clampCropOffset(dragState.cropX + (event.clientX - dragState.x) / bounds.width * 100);
    avatarCrop.y = clampCropOffset(dragState.cropY + (event.clientY - dragState.y) / bounds.height * 100);
    updateCropPreview();
  });
  cropViewport.addEventListener('pointerup', () => { dragState = null; });
  cropViewport.addEventListener('pointercancel', () => { dragState = null; });

  document.getElementById('avatar-crop-cancel').addEventListener('click', closeCropModal);
  document.getElementById('avatar-crop-close').addEventListener('click', closeCropModal);
  cropModal.addEventListener('click', event => { if (event.target === cropModal) closeCropModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !cropModal.hidden) closeCropModal(); });
  cropSaveButton.addEventListener('click', async () => {
    if (!pendingAvatarFile) return;
    photoError.hidden = true;
    setAvatarBusy(true);
    try {
      const uploaded = await uploadImage(pendingAvatarFile, 'avatar');
      if (!await saveAvatar(uploaded.url, avatarCrop)) throw new Error('Kh?ng th? l?u ?nh ??i di?n.');
      closeCropModal();
    } catch (error) {
      photoError.textContent = error.message || 'Kh?ng th? t?i ?nh l?n m?y ch?.';
      photoError.hidden = false;
    } finally {
      setAvatarBusy(false);
    }
  });

  removePhotoButton.addEventListener('click', async () => {
    photoError.hidden = true;
    setAvatarBusy(true);
    try {
      if (!await saveAvatar('')) {
        photoError.textContent = 'Không thể xóa ảnh đại diện khỏi database.';
        photoError.hidden = false;
      }
    } finally {
      setAvatarBusy(false);
    }
  });
});

function formatBirthDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('vi-VN').format(new Date(year, month - 1, day));
}
