import { Auth } from './auth.js';
import { Storage } from './storage.js';
import { formatDate, getStatusMeta } from './utils.js';

let weekOffset = 0;

document.addEventListener('DOMContentLoaded', async () => {
  await Storage.init();
  document.getElementById('week-prev')?.addEventListener('click', () => { weekOffset--; renderWeek(); });
  document.getElementById('week-next')?.addEventListener('click', () => { weekOffset++; renderWeek(); });
  document.getElementById('week-today')?.addEventListener('click', () => { weekOffset = 0; renderWeek(); });
  renderWeek();
});

function renderWeek() {
  const user = Auth.getCurrentUser();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
  document.getElementById('week-label').textContent = `${formatShortDate(days[0])} – ${formatShortDate(days[6])}`;

  const tasks = Storage.getTasks().filter(task => task.assigneeId === user?.id);
  const calendar = document.getElementById('week-calendar');
  calendar.innerHTML = days.map(date => {
    const key = toDateKey(date);
    const dayTasks = tasks.filter(task => task.deadline === key);
    const isToday = toDateKey(today) === key;
    const items = dayTasks.length ? dayTasks.map(task => {
      const status = getStatusMeta(task.status);
      return `<a class="calendar-task" href="task-detail.html?id=${encodeURIComponent(task.id)}"><strong>${escapeHtml(task.title)}</strong><span class="badge ${status.className}">${escapeHtml(status.label)}</span></a>`;
    }).join('') : '<p class="calendar-empty-day">Chưa có việc</p>';
    return `<article class="calendar-day${isToday ? ' is-today' : ''}"><header><span>${new Intl.DateTimeFormat('vi-VN', { weekday: 'short' }).format(date)}</span><strong>${date.getDate()}</strong></header><div class="calendar-day-tasks">${items}</div></article>`;
  }).join('');

  const unscheduled = tasks.filter(task => !task.deadline);
  document.getElementById('unscheduled-tasks').innerHTML = unscheduled.length
    ? unscheduled.map(task => `<a href="task-detail.html?id=${encodeURIComponent(task.id)}">${escapeHtml(task.title)}</a>`).join('')
    : '<p class="text-muted">Không có công việc nào.</p>';
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short' }).format(date);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
