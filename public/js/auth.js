const USERS_KEY = 'DACK_USERS';
let usersCache = [];
let currentUser = null;
let usersLoadPromise = null;

async function authRequest(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path, {
      ...options,
      signal: options.signal || controller.signal,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...options.headers }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Authentication request failed (${response.status}).`);
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
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

  getUsers() { return usersCache; },
  getCurrentUser() { return currentUser; },
  async login(username, password) {
    try {
      const result = await authRequest('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      currentUser = result.user;
      usersCache = await authRequest('/auth/users');
      return true;
    } catch { currentUser = null; usersCache = []; return false; }
  },
  async logout() {
    try { await authRequest('/auth/logout', { method: 'POST', body: '{}' }); } finally {
      currentUser = null;
      usersCache = [];
      clearClientCredentials();
      window.location.href = 'login.html';
    }
  },
  async saveUsers(nextUsers) {
    if (!Array.isArray(nextUsers) || !currentUser) return false;
    const previous = usersCache;
    try {
      const previousById = new Map(previous.map(user => [user.id, user]));
      const nextById = new Map(nextUsers.map(user => [user.id, user]));
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
        ['name', 'avatar', 'avatarCrop', 'birthDate', 'hobbies', 'active', 'email', 'phone', 'currentPassword'].forEach(field => {
          if (old[field] !== user[field]) changes[field] = user[field];
        });
        if (Object.keys(changes).length) await authRequest(`/auth/users/${encodeURIComponent(user.id)}`, { method: 'PUT', body: JSON.stringify(changes) });
      }
      usersCache = await authRequest('/auth/users');
      if (currentUser) currentUser = usersCache.find(user => user.id === currentUser.id) || currentUser;
      return true;
    } catch (error) {
      console.error('Could not save accounts to database.', error);
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
  async resetPassword(token, newPassword) {
    return authRequest('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) });
  },
  async requestEmailVerification() {
    return authRequest('/auth/request-email-verification', { method: 'POST', body: '{}' });
  },
  async verifyEmail(token) {
    return authRequest('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
  },
  canManageUsers() { return currentUser?.role === 'admin'; },
  canManageCategories() { return ['admin', 'manager'].includes(currentUser?.role); },
  canCreateTask() { return !!currentUser; },
  canManageTasks() { return ['admin', 'manager'].includes(currentUser?.role); },
  canAccessTask(task) { const current = currentUser; return !!current && (current.role === 'admin' || (current.role === 'manager' && (task?.ownerId === current.id || task?.assigneeId === current.id)) || (current.role === 'user' && (task?.ownerId === current.id || task?.assigneeId === current.id))); },
  canUpdateTaskStatus() { return false; },
  canReportTask(task) { const current = currentUser; return ['user', 'manager'].includes(current?.role) && task?.assigneeId === current.id && ['in-progress', 'needs-revision'].includes(task?.status) && task?.cancellationRequest?.status !== 'pending'; },
  canManageSubtasks(task) { const current = currentUser; return !!current && (current.role === 'admin' ? !['completed', 'cancelled', 'awaiting-review'].includes(task?.status) : (task?.status !== 'awaiting-review' && (this.canEditTask(task) || (['user', 'manager'].includes(current.role) && task?.assigneeId === current.id && !['completed', 'cancelled'].includes(task?.status))))); },
  canEditTask(task) { const current = currentUser; return !!current && (current.role === 'admin' || (current.role === 'manager' && (task?.ownerId === current.id || task?.assigneeId === current.id))); },
  getTasks(tasks) {
    const current = currentUser;
    if (!current || current.role === 'admin') return tasks;
    return tasks.filter(task => task.ownerId === current.id || task.assigneeId === current.id);
  }
};
