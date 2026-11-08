const THEME_KEY = 'DACK_THEME';
const root = document.documentElement;
let activeTheme = 'light';
try {
  activeTheme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
} catch {}
root.dataset.theme = activeTheme;

function createThemeToggle() {
  if (document.querySelector('.theme-toggle')) return;
  const header = document.querySelector('.top-navbar');
  let host = header?.querySelector('.navbar-right');
  if (!host && header) {
    host = document.createElement('div');
    host.className = 'navbar-right';
    header.append(host);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `theme-toggle${host ? '' : ' theme-toggle-floating'}`;
  button.innerHTML = '<svg class="theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.7 8.7 0 0 1 8.8 3.5 8.8 8.8 0 1 0 20.5 15.2Z"/></svg><svg class="theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg><span class="theme-toggle-label"></span>';
  button.addEventListener('click', () => {
    activeTheme = activeTheme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = activeTheme;
    try { localStorage.setItem(THEME_KEY, activeTheme); } catch {}
    updateThemeButton(button);
  });
  host ? host.append(button) : document.body.append(button);
  updateThemeButton(button);
}

function updateThemeButton(button) {
  const dark = activeTheme === 'dark';
  button.setAttribute('aria-label', dark ? 'Chuy\u1ec3n sang giao di\u1ec7n s\u00e1ng' : 'Chuy\u1ec3n sang giao di\u1ec7n t\u1ed1i');
  button.setAttribute('aria-pressed', String(dark));
  button.title = dark ? 'Giao di\u1ec7n s\u00e1ng' : 'Giao di\u1ec7n t\u1ed1i';
  button.querySelector('.theme-toggle-label').textContent = dark ? 'S\u00e1ng' : 'T\u1ed1i';
  button.querySelector('.theme-icon-moon').hidden = dark;
  button.querySelector('.theme-icon-sun').hidden = !dark;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createThemeToggle, { once: true });
else createThemeToggle();
