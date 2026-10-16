/* Home page setup and the browser-side validation for login and registration forms. */

// Display form errors next to the form instead of losing the user's entered values.
function showFormError(msg) {
  const box = document.getElementById('form-error');
  box.textContent = msg;
  box.classList.toggle('hidden', !msg);
}

// Only allow local page names as redirects so a login URL cannot redirect externally.
function safeNext() {
  const next = param('next') || '';
  // only allow simple same-folder page names, never external URLs
  return /^[a-z-]+\.html(\?[\w=&-]*)?$/i.test(next) ? next : 'profile.html';
}

// Fill the landing-page links and fetch the project counters from the backend.
function initHome() {
  const nav = document.getElementById('nav-auth');
  if (Auth.token) {
    nav.innerHTML = '<a class="btn btn-sm btn-light" href="profile.html">Dashboard</a>';
    document.getElementById('cta-start').href = 'projects.html';
  } else {
    nav.innerHTML = '<a class="btn btn-sm btn-light" href="login.html">Login</a> <a class="btn btn-sm" href="register.html">Sign Up</a>';
  }
  fetch(API_BASE + '/api/stats')
    .then((r) => r.json())
    .then((s) => {
      document.getElementById('stat-active').textContent = s.activeProjects;
      document.getElementById('stat-matched').textContent = s.projectsMatched;
      document.getElementById('stat-teams').textContent = s.teamsForming;
    })
    .catch(() => { /* backend offline: leave dashes */ });
}

// Validate credentials, call the login API, and save the returned session.
function initLogin() {
  if (Auth.token) return location.replace(safeNext());
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showFormError('');
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showFormError('Please enter a valid email address.');
    if (!password) return showFormError('Please enter your password.');
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Logging in…';
    try {
      const { token, user } = await api('/auth/login', { method: 'POST', body: { email, password } });
      Auth.set(token, user);
      location.href = safeNext();
    } catch (err) {
      showFormError(err.message);
      btn.disabled = false; btn.textContent = 'Login';
    }
  });
}

// Check matching passwords and minimum requirements before creating an account.
function initRegister() {
  if (Auth.token) return location.replace('profile.html');
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showFormError('');
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('confirm').value;
    if (name.length < 2) return showFormError('Please enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showFormError('Please enter a valid email address.');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return showFormError('Password must be at least 8 characters and include a letter and a number.');
    }
    if (password !== confirm) return showFormError('Passwords do not match.');
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Creating account…';
    try {
      const { token, user } = await api('/auth/register', { method: 'POST', body: { name, email, password } });
      Auth.set(token, user);
      location.href = 'profile.html';
    } catch (err) {
      showFormError(err.message);
      btn.disabled = false; btn.textContent = 'Create account';
    }
  });
}