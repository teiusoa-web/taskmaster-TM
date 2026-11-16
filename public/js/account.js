import { Auth } from './auth.js';
import { openOwnAvatarLightbox, showToast } from './main.js';
import { applyAvatarCrop, renderCoverImageFile, renderCroppedAvatarFile, saveAvatarProfile, saveCoverProfile, uploadImage } from './uploads.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

document.addEventListener('DOMContentLoaded', async () => {
  await Auth.loadUsers();
  const currentUser = Auth.getCurrentUser();
  if (!currentUser) return;

  const requestedUserId = new URLSearchParams(window.location.search).get('userId')?.trim() || '';
  const requestedUser = requestedUserId ? Auth.getUsers().find(account => account.id === requestedUserId) : null;
  if (requestedUserId && !requestedUser) {
    showToast('Không tìm thấy thông tin tài khoản yêu cầu.', 'warning');
  }
  const isOwnProfile = !requestedUser || requestedUser.id === currentUser.id;
  const user = isOwnProfile ? currentUser : requestedUser;

  if (!isOwnProfile) {
    const displayName = user.name || user.username;
    document.title = `${displayName} - Thông tin tài khoản`;
    const pageTitle = document.querySelector('.page-title');
    if (pageTitle) pageTitle.textContent = `Hồ sơ: ${displayName}`;
    const eyebrow = document.querySelector('.account-profile-copy > .eyebrow');
    if (eyebrow) eyebrow.textContent = 'THÔNG TIN THÀNH VIÊN';
    const caption = document.querySelector('.account-profile-caption');
    if (caption) caption.textContent = `Xem thông tin chi tiết và vai trò của ${displayName}`;

    ['profile-photo-input', 'remove-profile-photo', 'profile-photo-help', 'edit-profile-button', 'account-inline-head-actions', 'account-email-verify-box', 'profile-cover-input', 'profile-cover-btn', 'remove-profile-cover', 'cancel-profile-cover', 'save-profile-cover']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
      });
    const photoBtn = document.querySelector('.account-photo-button');
    if (photoBtn) photoBtn.hidden = true;
    const passwordCard = document.querySelector('.account-password-card');
    if (passwordCard) passwordCard.hidden = true;

    const actionsBar = document.querySelector('.account-details-actions');
    if (actionsBar && !actionsBar.querySelector('.account-back-own-link')) {
      const backLink = document.createElement('a');
      backLink.href = 'account.html';
      backLink.className = 'btn btn-secondary btn-sm account-back-own-link';
      backLink.innerHTML = '&larr; Hồ sơ của tôi';
      actionsBar.append(backLink);
    }
  }

  const passwordForm = document.getElementById('password-change-form');
  if (isOwnProfile && passwordForm) {
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
        message.textContent = 'Đã cập nhật mật khẩu thành công.';
        showToast('Đã cập nhật mật khẩu.', 'success');
      } catch (error) {
        message.textContent = error.message || 'Không thể đổi mật khẩu.';
      }
    });
  }

  const roles = {
    admin: 'Quản trị viên',
    manager: 'Quản lý',
    user: 'Người dùng'
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
        photoError.textContent = 'Tệp ảnh đại diện không còn trên máy chủ. Hãy tải lên ảnh mới.';
        photoError.hidden = false;
      }, { once: true });
      avatar.append(image);
      if (isOwnProfile) removePhotoButton.hidden = false;
    }
    if (isOwnProfile) {
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
    }
  };

  const saveAvatar = async (value, crop = avatarCrop) => {
    try {
      await saveAvatarProfile(user, value || null, crop);
      renderAvatar();
      return true;
    } catch {
      photoError.textContent = 'Không thể lưu ảnh. Hãy chọn tệp nhỏ hơn.';
      photoError.hidden = false;
      return false;
    }
  };

  renderAvatar();
  if (isOwnProfile && avatar) {
    avatar.classList.add('is-viewable-own-avatar');
    avatar.setAttribute('role', 'button');
    avatar.tabIndex = 0;
    avatar.title = 'Nhấn để xem chi tiết ảnh đại diện';
    const handleOwnAvatarClick = event => {
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openOwnAvatarLightbox(user, { onTriggerUpload: () => photoInput?.click() });
    };
    avatar.addEventListener('click', handleOwnAvatarClick);
    avatar.addEventListener('keydown', handleOwnAvatarClick);
  }
  if (isOwnProfile && user.avatar) {
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
  document.getElementById('profile-detail-name').textContent = user.name || '—';
  document.getElementById('profile-username').textContent = user.username || '—';
  document.getElementById('profile-role-detail').textContent = roles[user.role] || user.role;
  document.getElementById('profile-id').textContent = user.id || '—';
  document.getElementById('profile-user-code-row').hidden = user.role !== 'user';

  const birthDateValue = document.getElementById('profile-birth-date');
  const hobbiesValue = document.getElementById('profile-hobbies');
  const emailBadge = document.getElementById('profile-email-badge');
  const verifyBox = document.getElementById('account-email-verify-box');
  const verifyStatus = document.getElementById('email-verification-status');
  const verifyBtn = document.getElementById('verify-email-button');
  const verifyOtpForm = document.getElementById('account-verify-otp-form');
  const verifyOtpInput = document.getElementById('account-verify-otp-input');
  const verifyOtpSubmit = document.getElementById('account-verify-otp-submit');
  const otpTimerBadge = document.getElementById('account-otp-timer');
  const otpDigitBoxes = Array.from(verifyOtpForm?.querySelectorAll('.otp-digit-box') || []);

  let otpCountdownInterval = null;
  const startOtpCountdown = (seconds = 300) => {
    if (otpCountdownInterval) clearInterval(otpCountdownInterval);
    if (!otpTimerBadge) return;
    let remaining = seconds;
    otpTimerBadge.hidden = false;
    otpTimerBadge.classList.remove('is-expired');
    const renderTimer = () => {
      const m = String(Math.floor(remaining / 60)).padStart(2, '0');
      const s = String(remaining % 60).padStart(2, '0');
      otpTimerBadge.textContent = `Hiệu lực: ${m}:${s}`;
    };
    renderTimer();
    otpCountdownInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(otpCountdownInterval);
        otpTimerBadge.textContent = 'Đã hết hạn';
        otpTimerBadge.classList.add('is-expired');
        return;
      }
      renderTimer();
    }, 1000);
  };

  const syncAccountOtpDigits = () => {
    const code = otpDigitBoxes.map(box => box.value.replace(/\D/g, '')).join('');
    if (verifyOtpInput) verifyOtpInput.value = code;
    otpDigitBoxes.forEach(box => box.classList.toggle('is-filled', Boolean(box.value)));
    return code;
  };

  const clearAccountOtpDigits = () => {
    otpDigitBoxes.forEach(box => {
      box.value = '';
      box.classList.remove('is-filled');
    });
    if (verifyOtpInput) verifyOtpInput.value = '';
  };

  otpDigitBoxes.forEach((box, idx) => {
    box.addEventListener('input', event => {
      const val = event.target.value.replace(/\D/g, '');
      event.target.value = val.slice(-1);
      syncAccountOtpDigits();
      if (event.target.value && idx < otpDigitBoxes.length - 1) {
        otpDigitBoxes[idx + 1].focus();
      }
    });
    box.addEventListener('keydown', event => {
      if (event.key === 'Backspace' && !box.value && idx > 0) {
        otpDigitBoxes[idx - 1].value = '';
        syncAccountOtpDigits();
        otpDigitBoxes[idx - 1].focus();
      } else if (event.key === 'ArrowLeft' && idx > 0) {
        otpDigitBoxes[idx - 1].focus();
      } else if (event.key === 'ArrowRight' && idx < otpDigitBoxes.length - 1) {
        otpDigitBoxes[idx + 1].focus();
      }
    });
    box.addEventListener('paste', event => {
      event.preventDefault();
      const digits = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (!digits) return;
      digits.split('').forEach((ch, i) => {
        if (otpDigitBoxes[i]) otpDigitBoxes[i].value = ch;
      });
      syncAccountOtpDigits();
      const targetIdx = Math.min(digits.length, otpDigitBoxes.length - 1);
      otpDigitBoxes[targetIdx]?.focus();
    });
  });

  const coverBanner = document.getElementById('account-cover-banner');
  const coverImage = document.getElementById('profile-cover-image');
  const coverInput = document.getElementById('profile-cover-input');
  const coverButton = document.getElementById('profile-cover-btn');
  const removeCoverButton = document.getElementById('remove-profile-cover');
  const cancelCoverButton = document.getElementById('cancel-profile-cover');
  const saveCoverButton = document.getElementById('save-profile-cover');
  let pendingCoverChange = null;

  const clearPendingCover = () => {
    if (pendingCoverChange?.previewUrl) {
      URL.revokeObjectURL(pendingCoverChange.previewUrl);
    }
    pendingCoverChange = null;
  };

  const setCoverBusy = busy => {
    coverBanner?.classList.toggle('is-uploading', busy);
    if (coverInput) coverInput.disabled = busy;
    if (coverButton) coverButton.setAttribute('aria-disabled', String(busy));
    if (removeCoverButton) removeCoverButton.disabled = busy;
    if (cancelCoverButton) cancelCoverButton.disabled = busy;
    if (saveCoverButton) saveCoverButton.disabled = busy;
  };

  const renderCover = () => {
    if (!coverImage || !coverBanner) return;
    const effectiveCoverSrc = pendingCoverChange?.mode === 'remove'
      ? ''
      : (pendingCoverChange?.mode === 'file' ? pendingCoverChange.previewUrl : (user.coverImage || ''));
    const hasPending = Boolean(pendingCoverChange);
    if (cancelCoverButton) cancelCoverButton.hidden = !isOwnProfile || !hasPending;
    if (saveCoverButton) saveCoverButton.hidden = !isOwnProfile || !hasPending;

    if (!effectiveCoverSrc) {
      coverImage.hidden = true;
      coverImage.removeAttribute('src');
      coverBanner.classList.remove('has-cover');
      if (removeCoverButton) removeCoverButton.hidden = true;
      return;
    }
    coverImage.src = effectiveCoverSrc;
    coverImage.hidden = false;
    coverBanner.classList.add('has-cover');
    if (isOwnProfile && removeCoverButton) removeCoverButton.hidden = false;
    coverImage.addEventListener('error', () => {
      if (!coverImage.isConnected) return;
      coverImage.hidden = true;
      coverBanner.classList.remove('has-cover');
    }, { once: true });
  };

  const commitPendingCover = async () => {
    if (!pendingCoverChange) return { changed: false, removed: false };
    const mode = pendingCoverChange.mode;
    if (mode === 'remove') {
      await saveCoverProfile(user, null);
    } else if (mode === 'file') {
      const uploaded = await uploadImage(pendingCoverChange.file, 'avatar');
      await saveCoverProfile(user, uploaded.url);
    }
    clearPendingCover();
    renderCover();
    return { changed: true, removed: mode === 'remove' };
  };

  renderCover();

  const detailsCard = document.getElementById('account-details-card');
  const editButton = document.getElementById('edit-profile-button');
  const inlineHeadActions = document.getElementById('account-inline-head-actions');
  const cancelEditButton = document.getElementById('cancel-profile-edit');
  const saveEditButton = document.getElementById('save-profile-edit');
  const editForm = document.getElementById('profile-edit-form');
  const editNameInput = document.getElementById('profile-edit-name');
  const editEmailInput = document.getElementById('profile-edit-email');
  const editPhoneInput = document.getElementById('profile-edit-phone');
  const editBirthDateInput = document.getElementById('profile-edit-birth-date');
  const editHobbiesInput = document.getElementById('profile-edit-hobbies');

  const toggleInlineEditMode = editing => {
    if (detailsCard) detailsCard.classList.toggle('is-editing', editing);
    detailsCard?.querySelectorAll('.account-view-val').forEach(el => { el.hidden = editing; });
    detailsCard?.querySelectorAll('.account-edit-field').forEach(el => { el.hidden = !editing; });
    if (editButton) editButton.hidden = !isOwnProfile || editing;
    if (inlineHeadActions) inlineHeadActions.hidden = !isOwnProfile || !editing;
  };

  const setProfileFields = () => {
    initials = String(user.name || user.username).trim().split(/\s+/).map(part => part[0]).slice(-2).join('').toUpperCase();
    document.getElementById('profile-name').textContent = user.name || user.username;
    document.getElementById('profile-detail-name').textContent = user.name || '—';
    document.getElementById('profile-email').textContent = user.email || '—';
    document.getElementById('profile-phone').textContent = user.phone || '—';

    if (!user.email) {
      if (emailBadge) emailBadge.hidden = true;
      verifyBox?.classList.remove('is-verified');
      verifyStatus.textContent = 'Chưa có địa chỉ email. Hãy nhấn Chỉnh sửa để thêm email dùng cho đăng nhập và khôi phục mật khẩu.';
      verifyBtn.hidden = true;
      verifyOtpForm.hidden = true;
      if (otpTimerBadge) otpTimerBadge.hidden = true;
    } else if (user.emailVerified) {
      if (emailBadge) {
        emailBadge.hidden = false;
        emailBadge.className = 'badge badge-status-completed';
        emailBadge.textContent = 'Đã xác minh';
      }
      verifyBox?.classList.add('is-verified');
      verifyStatus.textContent = `Địa chỉ email (${user.email}) đã được xác minh và sẵn sàng dùng để đăng nhập hoặc khôi phục mật khẩu.`;
      verifyBtn.hidden = true;
      verifyOtpForm.hidden = true;
      if (otpTimerBadge) otpTimerBadge.hidden = true;
    } else {
      if (emailBadge) {
        emailBadge.hidden = false;
        emailBadge.className = 'badge badge-status-pending';
        emailBadge.textContent = 'Chưa xác minh';
      }
      verifyBox?.classList.remove('is-verified');
      verifyStatus.textContent = `Email (${user.email}) chưa xác minh. Nhấn Nhận mã OTP để nhận 6 chữ số xác thực (hiệu lực 5 phút).`;
      verifyBtn.hidden = false;
    }

    birthDateValue.textContent = formatBirthDate(user.birthDate) || '—';
    hobbiesValue.textContent = user.hobbies || '—';
    renderAvatar();
    renderCover();
    if (isOwnProfile) {
      document.querySelectorAll('.author-info h4').forEach(element => { element.textContent = user.name || user.username; });
    }
  };

  const fillEditForm = () => {
    editNameInput.value = user.name || '';
    editEmailInput.value = user.email || '';
    editPhoneInput.value = user.phone || '';
    editBirthDateInput.value = user.birthDate || '';
    editHobbiesInput.value = user.hobbies || '';
  };

  editButton?.addEventListener('click', () => {
    if (!isOwnProfile) return;
    fillEditForm();
    toggleInlineEditMode(true);
    editNameInput?.focus();
  });

  cancelEditButton?.addEventListener('click', () => {
    toggleInlineEditMode(false);
    fillEditForm();
    if (pendingCoverChange) {
      clearPendingCover();
      renderCover();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && detailsCard?.classList.contains('is-editing')) {
      toggleInlineEditMode(false);
      fillEditForm();
      if (pendingCoverChange) {
        clearPendingCover();
        renderCover();
      }
    }
  });

  editForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const name = editNameInput.value.trim();
    if (!name) {
      showToast('Vui lòng nhập tên hiển thị.', 'warning');
      editNameInput.focus();
      return;
    }
    const previousEmail = String(user.email || '').toLowerCase();
    const profileFields = {
      name,
      email: editEmailInput.value.trim().toLowerCase(),
      phone: editPhoneInput.value.trim(),
      birthDate: editBirthDateInput.value,
      hobbies: editHobbiesInput.value.trim()
    };
    if (saveEditButton) saveEditButton.disabled = true;
    if (pendingCoverChange) setCoverBusy(true);
    try {
      const updated = await Auth.updateUser(user.id, profileFields);
      Object.assign(user, updated);
      if (pendingCoverChange) {
        await commitPendingCover();
      }
      setProfileFields();
      toggleInlineEditMode(false);

      if (profileFields.email !== previousEmail && !user.emailVerified) {
        clearAccountOtpDigits();
        verifyOtpForm.hidden = false;
        startOtpCountdown(300);
        otpDigitBoxes[0]?.focus();
        showToast('Đã cập nhật email và gửi mã OTP xác minh (hiệu lực 5 phút).', 'success');
      } else {
        showToast('Đã cập nhật thông tin tài khoản.', 'success');
      }
    } catch (error) {
      showToast(error.message || 'Không thể lưu thông tin. Vui lòng thử lại.', 'error');
    } finally {
      if (saveEditButton) saveEditButton.disabled = false;
      setCoverBusy(false);
    }
  });

  verifyBtn.addEventListener('click', async event => {
    const btn = event.currentTarget;
    const labelSpan = btn.querySelector('span') || btn;
    btn.disabled = true;
    labelSpan.textContent = 'Đang gửi mã...';
    try {
      const result = await Auth.requestEmailVerification();
      verifyStatus.textContent = result.message || 'Đã gửi mã xác minh email.';
      if (!result.alreadyVerified) {
        clearAccountOtpDigits();
        verifyOtpForm.hidden = false;
        startOtpCountdown(300);
        otpDigitBoxes[0]?.focus();
      } else {
        user.emailVerified = true;
        setProfileFields();
      }
      showToast('Đã gửi mã OTP 6 chữ số (hiệu lực 5 phút).', 'success');
    } catch (error) {
      verifyStatus.textContent = error.message || 'Không thể gửi email xác minh.';
      showToast(error.message || 'Không thể gửi email xác minh.', 'error');
    } finally {
      btn.disabled = false;
      labelSpan.textContent = 'Gửi lại mã OTP';
    }
  });

  verifyOtpForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const code = syncAccountOtpDigits();
    if (code.length !== 6) {
      showToast('Vui lòng nhập đủ 6 chữ số của mã OTP.', 'warning');
      const firstEmpty = otpDigitBoxes.find(box => !box.value) || otpDigitBoxes[0];
      firstEmpty?.focus();
      return;
    }
    const labelSpan = verifyOtpSubmit.querySelector('span') || verifyOtpSubmit;
    verifyOtpSubmit.disabled = true;
    labelSpan.textContent = 'Đang kiểm tra...';
    try {
      const result = await Auth.verifyEmail({ code });
      user.emailVerified = true;
      if (otpCountdownInterval) clearInterval(otpCountdownInterval);
      setProfileFields();
      showToast(result.message || 'Xác minh email thành công!', 'success');
    } catch (error) {
      showToast(error.message || 'Mã xác minh không hợp lệ hoặc đã hết hạn.', 'error');
    } finally {
      verifyOtpSubmit.disabled = false;
      labelSpan.textContent = 'Xác nhận mã OTP';
    }
  });

  setProfileFields();
  const status = document.getElementById('profile-status');
  status.textContent = user.active ? 'Đang hoạt động' : 'Đã khóa';
  status.classList.toggle('is-active', Boolean(user.active));
  if (!isOwnProfile) return;

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
      photoError.textContent = 'Chọn ảnh PNG, JPG, WebP hoặc GIF.';
      photoError.hidden = false;
      photoInput.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      photoError.textContent = 'Ảnh không được vượt quá 5 MB.';
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
      const croppedFile = await renderCroppedAvatarFile(pendingAvatarFile, avatarCrop, 512);
      const uploaded = await uploadImage(croppedFile, 'avatar');
      if (!await saveAvatar(uploaded.url, null)) throw new Error('Không thể lưu ảnh đại diện.');
      closeCropModal();
    } catch (error) {
      photoError.textContent = error.message || 'Không thể tải ảnh lên máy chủ.';
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

  coverInput?.addEventListener('change', async () => {
    const file = coverInput.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      showToast('Ảnh bìa chỉ hỗ trợ PNG, JPG, WebP hoặc GIF.', 'error');
      coverInput.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Ảnh bìa không được vượt quá 5 MB.', 'error');
      coverInput.value = '';
      return;
    }
    setCoverBusy(true);
    try {
      const croppedCover = await renderCoverImageFile(file, 1280, 380);
      clearPendingCover();
      pendingCoverChange = {
        mode: 'file',
        file: croppedCover,
        previewUrl: URL.createObjectURL(croppedCover)
      };
      renderCover();
      showToast('Đã chọn ảnh bìa mới. Nhấn "Lưu ảnh bìa" hoặc "Hủy" để xác nhận.', 'info');
    } catch (error) {
      showToast(error.message || 'Không thể xử lý ảnh bìa.', 'error');
    } finally {
      coverInput.value = '';
      setCoverBusy(false);
    }
  });

  removeCoverButton?.addEventListener('click', () => {
    if (user.coverImage) {
      clearPendingCover();
      pendingCoverChange = { mode: 'remove' };
    } else {
      clearPendingCover();
    }
    renderCover();
  });

  cancelCoverButton?.addEventListener('click', () => {
    clearPendingCover();
    renderCover();
  });

  saveCoverButton?.addEventListener('click', async () => {
    if (!pendingCoverChange) return;
    setCoverBusy(true);
    try {
      const result = await commitPendingCover();
      if (result.changed) {
        showToast(result.removed ? 'Đã gỡ ảnh bìa tài khoản.' : 'Đã lưu ảnh bìa tài khoản.', 'success');
      }
    } catch (error) {
      showToast(error.message || 'Không thể lưu ảnh bìa.', 'error');
    } finally {
      setCoverBusy(false);
    }
  });
});

function formatBirthDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('vi-VN').format(new Date(year, month - 1, day));
}
