/* Shared browser helpers: API location, login state, safe UI rendering, and page shell. */

// Use the Express origin directly, or port 3000 when a separate local static server is used.
const apiHost = window.location.hostname || 'localhost';
const API_BASE = window.PROJECTHUB_API || (window.location.port === '3000'
  ? window.location.origin
  : 'http://' + apiHost + ':3000');

/* ---------- auth storage: keep the session and account details between pages ---------- */
const Auth = {
  get token() { return localStorage.getItem('ph_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('ph_user') || 'null'); } catch { return null; } },
  set(token, user) { localStorage.setItem('ph_token', token); localStorage.setItem('ph_user', JSON.stringify(user)); },
  clear() { localStorage.removeItem('ph_token'); localStorage.removeItem('ph_user'); },
  require() {
    if (!this.token) {
      location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search));
      return false;
    }
    return true;
  },
  logout() { this.clear(); location.href = 'login.html'; }
};

/* ---------- API wrapper: attach credentials and turn server errors into readable messages ---------- */
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (Auth.token) headers.Authorization = 'Bearer ' + Auth.token;
  let res;
  try {
    res = await fetch(API_BASE + '/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach the server. Is the Node.js backend running on ' + API_BASE + '?');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && Auth.token) {
      Auth.clear();
      location.replace('login.html');
    }
    throw new Error((data && (data.message || data.error)) || 'Something went wrong (' + res.status + ').');
  }
  return data;
}

/* ---------- UI utilities: escape text and build common badges, messages, and modals ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}
const AVATAR_COLORS = ['#16a34a', '#22a447', '#facc15', '#15803d', '#eab308'];
function avatar(name, image, size = '') {
  const color = AVATAR_COLORS[(String(name || '').length + (name ? name.charCodeAt(0) : 0)) % AVATAR_COLORS.length];
  const safe = /^https?:\/\//i.test(image || '') ? `background-image:url('${esc(image).replace(/'/g, '%27')}');` : '';
  return `<span class="avatar ${size}" style="background-color:${color};${safe}">${safe ? '' : esc(initials(name))}</span>`;
}
function badges(list, cls = '') {
  return (list || []).map((s) => `<span class="badge ${cls}">${esc(typeof s === 'string' ? s : s.name)}</span>`).join('');
}
function statusBadge(status) {
  const label = { open: 'Open', in_progress: 'In progress', completed: 'Completed' }[status] || status;
  return `<span class="badge status-${esc(status)}">${label}</span>`;
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(String(ts).replace(' ', 'T'));
  if (isNaN(d)) return ts;
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? time : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + time;
}
function toast(message, type = 'info') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 6000 : 3500);
}
const loading = (text = 'Loading…') => `<div class="spinner" role="status" aria-label="${esc(text)}"></div>`;
const empty = (text) => `<div class="empty">${text}</div>`;
function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
async function withButton(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, 'error'); } finally { if (btn) btn.disabled = false; }
}
function openModal(html) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
  return back;
}
function param(name) { return new URLSearchParams(location.search).get(name); }

/* ---------- app shell: render shared navigation and update the unread-notification count ---------- */
const NAV = [
  ['profile', 'Profile', 'profile.html'],
  ['skills', 'Skills', 'skills.html'],
  ['projects', 'Projects', 'projects.html'],
  ['matching', 'Matching', 'matching.html'],
  ['team', 'Team', 'team.html'],
  ['chat', 'Chat', 'chat.html'],
  ['notifications', 'Notifications', 'notifications.html']
];

async function mountShell(active, title, actionsHtml = '') {
  if (!Auth.require()) return false;
  const user = Auth.user || { name: 'Student' };
  const root = document.getElementById('app');
  const content = root.innerHTML;
  root.innerHTML = `
    <div class="shell" id="shell">
      <aside class="sidebar">
        <a class="brand" href="index.html"><span class="logo">P</span> ProjectHub</a>
        <nav class="nav">
          ${NAV.map(([key, label, href]) => `<a href="${href}" class="${key === active ? 'active' : ''}">${label}${key === 'notifications' ? '<span class="count hidden" id="nav-count"></span>' : ''}</a>`).join('')}
        </nav>
        <button class="logout" id="logout-btn">Logout</button>
      </aside>
      <div class="scrim" id="scrim"></div>
      <main class="main">
        <div class="topbar">
          <div class="row"><button class="menu-btn" id="menu-btn" aria-label="Menu">☰</button><h1>${esc(title)}</h1></div>
          <div class="row">${actionsHtml}<div class="who">${avatar(user.name, '', 'sm')}<span id="who-name">${esc(user.name)}</span></div></div>
        </div>
        <div id="page">${content}</div>
      </main>
    </div>`;
  document.getElementById('logout-btn').onclick = () => Auth.logout();
  const shell = document.getElementById('shell');
  document.getElementById('menu-btn').onclick = () => shell.classList.toggle('open');
  document.getElementById('scrim').onclick = () => shell.classList.remove('open');
  refreshUnread();
  return true;
}

async function refreshUnread() {
  try {
    const { unread } = await api('/notifications/unread-count');
    const el = document.getElementById('nav-count');
    if (el) { el.textContent = unread; el.classList.toggle('hidden', !unread); }
  } catch { /* not critical */ }
}