import { DEFAULT_API_TIMEOUT_MS, fetchWithRetry } from './api-config.js';

const USERS_KEY = 'DACK_USERS';
let usersCache = [];
let currentUser = null;
let usersLoadPromise = null;

async function authRequest(path, options = {}) {
  const response = await fetchWithRetry(
    path,
    {
      ...options,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...options.headers }
    },
    {
      timeoutMs: Number(options.timeoutMs) || DEFAULT_API_TIMEOUT_MS,
      retries: Number.isInteger(options.retries) ? options.retries : 2
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Authentication request failed (${response.status}).`);
  return payload;
}

function clearClientCredentials() {
  localStorage.removeItem(USERS_KEY);
  localStorage.removeItem('DACK_SESSION');
}

export const Auth = {
  init() {
    clearClientCredentials();
    let tasks;
    try {
      tasks = JSON.parse(localStorage.getItem('DACK_TASKS_LIST') || '[]');
      if (!Array.isArray(tasks)) throw new Error('Invalid cached tasks');
    } catch {
      tasks = [];
      localStorage.setItem('DACK_TASKS_LIST', '[]');
    }
    let changed = false;
    tasks.forEach(task => {
      if (!task.ownerId) { task.ownerId = 'user_admin'; changed = true; }
    });
    if (changed) localStorage.setItem('DACK_TASKS_LIST', JSON.stringify(tasks));
  },

  async loadUsers() {
    this.init();
    if (usersLoadPromise) return usersLoadPromise;
    usersLoadPromise = (async () => {
      try {
        const session = await authRequest('/auth/me');
        currentUser = session.user;
        usersCache = await authRequest('/auth/users');
      } catch {
        currentUser = null;
        usersCache = [];
      }
      return usersCache;
    })();
    return usersLoadPromise;
  },

  getUsers() { return usersCache.map(user => ({ ...user })); },
  getCurrentUser() { return currentUser; },
  async updateUser(userId, changes) {
    this.lastError = '';
    this.lastVerificationPreview = null;
    const updated = await authRequest(`/auth/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify(changes)
    });
    if (updated?.verificationPreview) {
      this.lastVerificationPreview = updated.verificationPreview;
    }
    usersCache = await authRequest('/auth/users');
    if (currentUser && currentUser.id === userId) {
      currentUser = usersCache.find(user => user.id === userId) || { ...currentUser, ...updated };
    }
    return updated;
  },
  async login(username, password) {
    this.lastError = '';
    try {
      const result = await authRequest('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      currentUser = result.user;
      usersCache = await authRequest('/auth/users');
      return true;
    } catch (error) {
      currentUser = null;
      usersCache = [];
      this.lastError = error?.message || '';
      return false;
    }
  },
  async logout() {
    try { await authRequest('/auth/logout', { method: 'POST', body: '{}' }); } finally {
      currentUser = null;
      usersCache = [];
      clearClientCredentials();
      window.location.href = 'login.html';
    }
  },
  lastError: '',
  lastVerificationPreview: null,
  async saveUsers(nextUsers) {
    if (!Array.isArray(nextUsers) || !currentUser) return false;
    const previous = usersCache;
    this.lastError = '';
    this.lastVerificationPreview = null;
    try {
      const previousById = new Map(previous.map(user => [user.id, user]));
      for (const user of nextUsers) {
        const old = previousById.get(user.id);
        if (!old) {
          const { id, password, ...newUser } = user;
          const created = await authRequest('/auth/users', { method: 'POST', body: JSON.stringify({ ...newUser, password }) });
          const index = nextUsers.findIndex(item => item.id === id);
          if (index >= 0) nextUsers[index] = created;
          continue;
        }
        const changes = {};
        ['name', 'avatar', 'avatarCrop', 'coverImage', 'birthDate', 'hobbies', 'active', 'emailVerified', 'email', 'phone', 'currentPassword'].forEach(field => {
          if (old[field] !== user[field]) changes[field] = user[field];
        });
        if (Object.keys(changes).length) {
          const updated = await authRequest(`/auth/users/${encodeURIComponent(user.id)}`, { method: 'PUT', body: JSON.stringify(changes) });
          if (updated?.verificationPreview) {
            this.lastVerificationPreview = updated.verificationPreview;
          }
        }
      }
      usersCache = await authRequest('/auth/users');
      if (currentUser) currentUser = usersCache.find(user => user.id === currentUser.id) || currentUser;
      return true;
    } catch (error) {
      console.error('Could not save accounts to database.', error);
      this.lastError = error.message || 'Không thể lưu thông tin tài khoản.';
      usersCache = previous;
      return false;
    }
  },
  async changePassword(currentPassword, newPassword) {
    await authRequest('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    return true;
  },
  async forgotPassword(email) {
    return authRequest('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  },
  async resetPassword(tokenOrOptions, newPassword) {
    const payload = typeof tokenOrOptions === 'object' && tokenOrOptions !== null
      ? tokenOrOptions
      : { token: tokenOrOptions, newPassword };
    return authRequest('/auth/reset-password', { method: 'POST', body: JSON.stringify(payload) });
  },
  async requestEmailVerification() {
    return authRequest('/auth/request-email-verification', { method: 'POST', body: '{}' });
  },
  async verifyEmail(tokenOrOptions) {
    const payload = typeof tokenOrOptions === 'object' && tokenOrOptions !== null
      ? tokenOrOptions
      : { token: tokenOrOptions };
    return authRequest('/auth/verify-email', { method: 'POST', body: JSON.stringify(payload) });
  },
  async sendDeadlineReminder(payload) {
    return authRequest('/auth/deadline-reminder', { method: 'POST', body: JSON.stringify(payload || {}) });
  },
  canManageUsers() { return currentUser?.role === 'admin'; },
  canManageCategories() { return ['admin', 'manager'].includes(currentUser?.role); },
  canCreateTask() { return !!currentUser; },
  canManageTasks() { return ['admin', 'manager'].includes(currentUser?.role); },
  canAccessTask(task) {
    const current = currentUser;
    if (!current) return false;
    if (current.role === 'admin') return true;
    const isOwner = task?.ownerId === current.id;
    const isAssignee = task?.assigneeId === current.id || (Array.isArray(task?.assigneeIds) && task.assigneeIds.includes(current.id));
    return isOwner || isAssignee;
  },
  canUpdateTaskStatus() { return false; },
  canReportTask(task) {
    const current = currentUser;
    const isAssignee = task?.assigneeId === current?.id || (Array.isArray(task?.assigneeIds) && task.assigneeIds.includes(current?.id));
    return ['user', 'manager'].includes(current?.role) && isAssignee && ['in-progress', 'needs-revision'].includes(task?.status) && task?.cancellationRequest?.status !== 'pending';
  },
  canManageSubtasks(task) {
    const current = currentUser;
    if (!current) return false;
    const isAssignee = task?.assigneeId === current.id || (Array.isArray(task?.assigneeIds) && task.assigneeIds.includes(current.id));
    return current.role === 'admin'
      ? !['completed', 'cancelled', 'awaiting-review'].includes(task?.status)
      : (task?.status !== 'awaiting-review' && (this.canEditTask(task) || (['user', 'manager'].includes(current.role) && isAssignee && !['completed', 'cancelled'].includes(task?.status))));
  },
  canEditTask(task) {
    const current = currentUser;
    if (!current) return false;
    if (current.role === 'admin') return true;
    const isOwner = task?.ownerId === current.id;
    const isAssignee = task?.assigneeId === current.id || (Array.isArray(task?.assigneeIds) && task.assigneeIds.includes(current.id));
    return current.role === 'manager' && (isOwner || isAssignee);
  },
  getTasks(tasks) {
    const current = currentUser;
    if (!current || current.role === 'admin') return tasks;
    return tasks.filter(task => {
      const isOwner = task.ownerId === current.id;
      const isAssignee = task.assigneeId === current.id || (Array.isArray(task.assigneeIds) && task.assigneeIds.includes(current.id));
      return isOwner || isAssignee;
    });
  }
};
