/* Project browsing, search filters, project details, and create/edit forms. */

/* ---------------- Explorer: fetch filtered results and open project details ---------------- */
async function initExplorer() {
  if (!(await mountShell('projects', 'Project Explorer', '<a class="btn" href="create-project.html">+ Create Project</a>'))) return;
  const list = document.getElementById('project-list');
  const q = document.getElementById('q');
  const catSel = document.getElementById('f-category');
  const skillSel = document.getElementById('f-skill');
  const statusSel = document.getElementById('f-status');

  try {
    const [{ categories }, { skills }] = await Promise.all([api('/projects/categories'), api('/skills')]);
    catSel.innerHTML += categories.map((c) => `<option>${esc(c)}</option>`).join('');
    skillSel.innerHTML += skills.map((s) => `<option>${esc(s.name)}</option>`).join('');
  } catch { /* filters are optional */ }

  // Ignore older search responses when a newer filter request has already started.
  let seq = 0;
  async function load() {
    const mine = ++seq;
    list.innerHTML = loading();
    const qs = new URLSearchParams();
    if (q.value.trim()) qs.set('q', q.value.trim());
    if (catSel.value) qs.set('category', catSel.value);
    if (skillSel.value) qs.set('skill', skillSel.value);
    if (statusSel.value) qs.set('status', statusSel.value);
    try {
      const { projects } = await api('/projects?' + qs);
      if (mine !== seq) return; // a newer search is running
      render(projects);
    } catch (e) {
      if (mine === seq) list.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
    }
  }

  function render(projects) {
    if (!projects.length) {
      list.innerHTML = empty('No projects found. Try a different search, or <a href="create-project.html">create one</a>.');
      return;
    }
    list.innerHTML = projects.map((p) => `
      <div class="project-row">
        <div class="project-icon" style="${/^https?:\/\//i.test(p.image_url) ? `background-image:url('${esc(p.image_url).replace(/'/g, '%27')}')` : ''}"></div>
        <div class="info">
          <h3>${esc(p.title)} ${statusBadge(p.status)}</h3>
          <div class="desc">${esc(p.description.length > 110 ? p.description.slice(0, 110) + '…' : p.description)}</div>
          <div>${badges(p.skills)}</div>
        </div>
        <div class="side">
          <span class="muted small">Team needed: ${p.team_size} (${p.member_count} joined)</span>
          <button class="btn btn-outline btn-sm" data-id="${p.id}">View Project</button>
        </div>
      </div>`).join('');
    list.querySelectorAll('button[data-id]').forEach((b) => (b.onclick = () => showDetails(Number(b.dataset.id))));
  }

  async function showDetails(id) {
    const modal = openModal(loading());
    try {
      const { project: p } = await api('/projects/' + id);
      const deadline = p.deadline ? new Date(p.deadline + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : 'No deadline';
      let action = '';
      if (p.is_owner) {
        action = `<a class="btn btn-outline" href="create-project.html?id=${p.id}">Edit</a>
                  <button class="btn btn-danger" id="del-btn">Delete</button>
                  <a class="btn" href="team.html?id=${p.id}">Open team</a>`;
      } else if (p.is_member) {
        action = `<a class="btn" href="team.html?id=${p.id}">Open team</a>`;
      } else if (p.has_pending) {
        action = '<button class="btn" disabled>Request pending</button>';
      } else if (p.status === 'completed') {
        action = '<button class="btn" disabled>Project completed</button>';
      } else if (p.spots_left <= 0) {
        action = '<button class="btn" disabled>Team is full</button>';
      } else {
        action = '<button class="btn" id="apply-btn">Apply to join</button>';
      }
      modal.querySelector('.modal').innerHTML = `
        <div class="row between"><h2>${esc(p.title)}</h2><button class="btn btn-outline btn-sm" id="close-modal">Close</button></div>
        <p>${statusBadge(p.status)} <span class="badge">${esc(p.category)}</span> <span class="muted small">by ${esc(p.owner_name)}</span></p>
        <p style="white-space:pre-wrap">${esc(p.description)}</p>
        <h4>Required skills</h4>
        <div>${p.skills.length ? badges(p.skills) : '<span class="muted small">No specific skills listed.</span>'}</div>
        <p class="small muted">Team: ${p.member_count} of ${p.team_size} members · Deadline: ${esc(deadline)}</p>
        <h4>Members</h4>
        <div class="row wrap">${p.members.map((m) => `<span class="row" style="gap:6px">${avatar(m.name, m.profile_image, 'sm')}<span class="small">${esc(m.name)}${m.role === 'owner' ? ' (owner)' : ''}</span></span>`).join('')}</div>
        <div class="row wrap" style="margin-top:20px">${action}</div>`;
      modal.querySelector('#close-modal').onclick = () => modal.remove();
      const apply = modal.querySelector('#apply-btn');
      if (apply) apply.onclick = () => withButton(apply, async () => {
        await api(`/projects/${id}/apply`, { method: 'POST' });
        toast('Request sent to the project owner.', 'success');
        modal.remove();
        load();
      });
      const del = modal.querySelector('#del-btn');
      if (del) del.onclick = () => withButton(del, async () => {
        if (!confirm('Delete this project permanently? Tasks and requests will be removed too.')) return;
        await api('/projects/' + id, { method: 'DELETE' });
        toast('Project deleted.', 'success');
        modal.remove();
        load();
      });
    } catch (e) {
      modal.querySelector('.modal').innerHTML = `<div class="alert error">${esc(e.message)}</div><button class="btn btn-outline" onclick="this.closest('.modal-back').remove()">Close</button>`;
    }
  }

  q.addEventListener('input', debounce(load, 300));
  [catSel, skillSel, statusSel].forEach((el) => el.addEventListener('change', load));
  load();
}

/* ---------------- Create / edit: load skills and submit a validated project form ---------------- */
async function initCreate() {
  const editId = param('id');
  if (!(await mountShell('projects', editId ? 'Edit Project' : 'Create New Project'))) return;
  const chips = document.getElementById('skill-chips');
  const selected = new Set();

  try {
    const { skills } = await api('/skills');
    chips.innerHTML = skills.map((s) => `<span class="chip" data-id="${s.id}" role="button" tabindex="0">${esc(s.name)}</span>`).join('');
    const toggle = (c) => { const id = Number(c.dataset.id); selected.has(id) ? selected.delete(id) : selected.add(id); c.classList.toggle('on'); };
    chips.querySelectorAll('.chip').forEach((c) => {
      c.onclick = () => toggle(c);
      c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(c); } };
    });
  } catch (e) {
    chips.innerHTML = `<span class="alert error">${esc(e.message)}</span>`;
  }

  if (editId) {
    document.getElementById('submit-btn').textContent = 'Save changes';
    document.getElementById('status-wrap').classList.remove('hidden');
    try {
      const { project: p } = await api('/projects/' + encodeURIComponent(editId));
      if (!p.is_owner) { toast('Only the owner can edit this project.', 'error'); return setTimeout(() => (location.href = 'projects.html'), 1200); }
      document.getElementById('p-title').value = p.title;
      document.getElementById('p-desc').value = p.description;
      document.getElementById('p-category').value = p.category;
      document.getElementById('p-size').value = p.team_size;
      document.getElementById('p-deadline').value = p.deadline || '';
      document.getElementById('p-image').value = p.image_url || '';
      document.getElementById('p-status').value = p.status;
      p.skills.forEach((s) => { selected.add(s.id); const c = chips.querySelector(`[data-id="${s.id}"]`); if (c) c.classList.add('on'); });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  document.getElementById('project-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      title: document.getElementById('p-title').value.trim(),
      description: document.getElementById('p-desc').value.trim(),
      category: document.getElementById('p-category').value.trim(),
      team_size: Number(document.getElementById('p-size').value),
      deadline: document.getElementById('p-deadline').value || null,
      image_url: document.getElementById('p-image').value.trim(),
      skillIds: [...selected]
    };
    if (editId) body.status = document.getElementById('p-status').value;
    if (body.title.length < 3) return toast('Project name must be at least 3 characters.', 'error');
    if (body.description.length < 10) return toast('Please describe your project (at least 10 characters).', 'error');
    if (!Number.isInteger(body.team_size) || body.team_size < 2 || body.team_size > 20) return toast('Team size must be between 2 and 20.', 'error');
    if (body.image_url && !/^https?:\/\//i.test(body.image_url)) return toast('Image URL must start with http:// or https://', 'error');
    await withButton(e.submitter, async () => {
      if (editId) await api('/projects/' + encodeURIComponent(editId), { method: 'PUT', body });
      else await api('/projects', { method: 'POST', body });
      toast(editId ? 'Project updated.' : 'Project created!', 'success');
      setTimeout(() => (location.href = 'projects.html'), 700);
    });
  };
}