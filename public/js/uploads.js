import { UPLOAD_BASE, fetchWithRetry } from './api-config.js';
import { Auth } from './auth.js';

export async function uploadImage(file, kind = 'attachment') {
  const reader = new FileReader();
  const dataUrl = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
  const response = await fetchWithRetry(
    `${UPLOAD_BASE}/upload`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, type: file.type, kind, data: String(dataUrl).split(',')[1] })
    },
    { timeoutMs: 90000, retries: 1 }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not upload image.');
  return result;
}

export async function renderCroppedAvatarFile(file, crop = { x: 0, y: 0, zoom: 1 }, size = 512) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không thể đọc dữ liệu ảnh để cắt.'));
      el.src = objectUrl;
    });

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) {
      throw new Error('Kích thước ảnh không hợp lệ.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');
    }

    const zoom = Math.max(1, Math.min(3, Number(crop?.zoom) || 1));
    const bound = Math.max(0, (zoom - 1) * 50);
    const x = Math.max(-bound, Math.min(bound, Number(crop?.x) || 0));
    const y = Math.max(-bound, Math.min(bound, Number(crop?.y) || 0));

    const coverScale = Math.max(size / width, size / height);
    const drawWidth = width * coverScale;
    const drawHeight = height * coverScale;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2 + (x / 100) * size, size / 2 + (y / 100) * size);
    ctx.scale(zoom, zoom);
    ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => {
        if (result) resolve(result);
        else reject(new Error('Không thể tạo tệp ảnh đã cắt.'));
      }, 'image/png', 0.92);
    });

    const baseName = String(file.name || 'avatar').replace(/\.[^.]*$/, '') || 'avatar';
    return new File([blob], `${baseName}-cropped.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function saveAvatarProfile(user, avatar) {
  const users = Auth.getUsers();
  const index = users.findIndex(item => item.id === user.id);
  if (index < 0) throw new Error('Could not find the account in the database.');
  const nextUsers = users.map(item => ({ ...item }));
  // Send explicit nulls when clearing fields. JSON.stringify omits properties
  // whose value is undefined, so deleting these keys here would make the API
  // interpret the request as "leave the current avatar unchanged".
  nextUsers[index].avatar = avatar || null;
  nextUsers[index].avatarCrop = null;
  if (!await Auth.saveUsers(nextUsers)) throw new Error('Could not save avatar settings to the database.');
  user.avatar = avatar || '';
  user.avatarCrop = null;
  return Auth.getUsers().find(item => item.id === user.id);
}

export async function renderCoverImageFile(file, width = 1280, height = 380) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không thể đọc dữ liệu ảnh bìa.'));
      el.src = objectUrl;
    });

    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) {
      throw new Error('Kích thước ảnh bìa không hợp lệ.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');
    }

    const coverScale = Math.max(width / naturalW, height / naturalH);
    const drawW = naturalW * coverScale;
    const drawH = naturalH * coverScale;
    const offsetX = (width - drawW) / 2;
    const offsetY = (height - drawH) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => {
        if (result) resolve(result);
        else reject(new Error('Không thể tạo tệp ảnh bìa đã căn chỉnh.'));
      }, 'image/jpeg', 0.9);
    });

    const baseName = String(file.name || 'cover').replace(/\.[^.]*$/, '') || 'cover';
    return new File([blob], `${baseName}-cover.jpg`, { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function saveCoverProfile(user, coverImage) {
  const updated = await Auth.updateUser(user.id, { coverImage: coverImage || null });
  user.coverImage = updated?.coverImage || (coverImage || '');
  return updated;
}

export function applyAvatarCrop(image, crop) {
  image.style.objectFit = 'cover';
  if (!crop) {
    image.style.transform = '';
    image.style.transformOrigin = 'center';
    return;
  }
  const x = Math.max(-100, Math.min(100, Number(crop.x) || 0));
  const y = Math.max(-100, Math.min(100, Number(crop.y) || 0));
  const zoom = Math.max(1, Math.min(3, Number(crop.zoom) || 1));
  image.style.transform = `translate(${x}%, ${y}%) scale(${zoom})`;
  image.style.transformOrigin = 'center';
}
