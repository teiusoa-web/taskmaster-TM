import { UPLOAD_BASE } from './api-config.js';
import { Auth } from './auth.js';

export async function uploadImage(file, kind = 'attachment') {
  const reader = new FileReader();
  const dataUrl = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
  const response = await fetch(`${UPLOAD_BASE}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, type: file.type, kind, data: String(dataUrl).split(',')[1] })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not upload image.');
  return result;
}

export async function saveAvatarProfile(user, avatar, crop = user.avatarCrop || null) {
  const users = Auth.getUsers();
  const index = users.findIndex(item => item.id === user.id);
  if (index < 0) throw new Error('Could not find the account in the database.');
  const nextUsers = users.map(item => ({ ...item }));
  // Send explicit nulls when clearing fields. JSON.stringify omits properties
  // whose value is undefined, so deleting these keys here would make the API
  // interpret the request as "leave the current avatar unchanged".
  nextUsers[index].avatar = avatar || null;
  if (avatar && crop) {
    nextUsers[index].avatarCrop = {
      x: Math.max(-100, Math.min(100, Number(crop.x) || 0)),
      y: Math.max(-100, Math.min(100, Number(crop.y) || 0)),
      zoom: Math.max(1, Math.min(3, Number(crop.zoom) || 1))
    };
  } else nextUsers[index].avatarCrop = null;
  if (!await Auth.saveUsers(nextUsers)) throw new Error('Could not save avatar settings to the database.');
  user.avatar = avatar || '';
  user.avatarCrop = avatar ? nextUsers[index].avatarCrop || null : null;
  return Auth.getUsers().find(item => item.id === user.id);
}

export function applyAvatarCrop(image, crop) {
  const x = Math.max(-100, Math.min(100, Number(crop?.x) || 0));
  const y = Math.max(-100, Math.min(100, Number(crop?.y) || 0));
  const zoom = Math.max(1, Math.min(3, Number(crop?.zoom) || 1));
  image.style.objectFit = 'cover';
  image.style.transform = `translate(${x}%, ${y}%) scale(${zoom})`;
  image.style.transformOrigin = 'center';
}
