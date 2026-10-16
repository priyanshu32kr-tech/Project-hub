// Load projects the student belongs to and render one selected team's workspace.
(async function () {
  if (!(await mountShell('team', 'My Team'))) return;
  const sel = document.getElementById('team-select');
  const root = document.getElementById('team-root');
  const me = Auth.user;

  let projects;
  try {
    ({ projects } = await api('/projects/mine'));
  } catch (e) {
    root.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
    return;
  }
  if (!projects.length) {
    sel.classList.add('hidden');
    root.innerHTML = empty('You are not on a team yet. <a href="projects.html">Explore projects</a> or <a href="create-project.html">create your own</a>.');
    return;
  }
  sel.innerHTML = projects.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
  const wanted = param('id');
  if (wanted && projects.some((p) => String(p.id) === wanted)) sel.value = wanted;
  sel.onchange = () => load(sel.value);
  load(sel.value);

  // Refresh the team view after choosing a project or changing one of its tasks.
  async function load(projectId) {
    root.innerHTML = loading();
    try {
      render(await api('/teams/' + projectId));
    } catch (e) {
      root.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
    }
  }

  // Render members, skill coverage, progress, and controls for managing team tasks.
  function render(d) {
    const pr = d.progress;
    const isOwner = d.project.owner_id === me.id;
    root.innerHTML = `
      <div class="card row between wrap">
        <div><h3 style="margin:0">${esc(d.project.title)} ${statusBadge(d.project.status)}</h3>
          <div class="muted small">${d.members.length} of ${d.project.team_size} members</div></div>
        <div class="row">
          ${isOwner && d.members.length < d.project.team_size ? `<a class="btn btn-outline btn-sm" href="matching.html?project=${d.project.id}">Find teammates</a>` : ''}
          <a class="btn btn-outline btn-sm" href="projects.html">All projects</a>
        </div>
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="stack">
          <div class="card">
            <h3>Team Members</h3>
            <div class="members">${d.members.map((m) => `
              <div class="member">${m.id !== me.id ? `<a href="chat.html?user=${m.id}" title="Message ${esc(m.name)}">${avatar(m.name, m.profile_image)}</a>` : avatar(m.name, m.profile_image)}
                <div>${esc(m.name.split(' ')[0])}</div>${m.role === 'owner' ? '<div class="muted small">owner</div>' : ''}</div>`).join('')}</div>
          </div>
          <div class="card">
            <h3>Team Skills</h3>
            <div class="team-skills">${d.teamSkills.length ? badges(d.teamSkills, 'ok') : '<span class="muted small">Team members have not added skills yet.</span>'}</div>
            ${d.requiredSkills.length ? `<p class="small" style="margin:8px 0 0;color:${d.skillCoverage.percent === 100 ? 'var(--green)' : 'var(--amber)'}"><b>${d.skillCoverage.percent}% of required skills covered</b> (${d.skillCoverage.covered}/${d.skillCoverage.total})</p>` : ''}
          </div>
        </div>
        <div class="card">
          <div class="row between"><h3 style="margin:0">Project Progress</h3><b id="pct">${pr.percent}%</b></div>
          <div class="progress-bar" style="margin:10px 0"><div id="bar" style="width:${pr.percent}%"></div></div>
          <p class="muted small" id="pr-text">${pr.done} of ${pr.total} tasks done</p>
          <div id="tasks">${d.tasks.length ? d.tasks.map(taskRow).join('') : empty('No tasks yet. Add the first one below.')}</div>
          <form id="task-form" class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">
            <input type="text" id="t-title" maxlength="200" placeholder="New task…" style="flex:2;min-width:140px" required />
            <select id="t-assign" style="flex:1;min-width:120px" aria-label="Assign to">
              <option value="">Unassigned</option>
              ${d.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}
            </select>
            <button class="btn" type="submit">Add</button>
          </form>
        </div>
      </div>`;

    const updateProgress = (p) => {
      document.getElementById('pct').textContent = p.percent + '%';
      document.getElementById('bar').style.width = p.percent + '%';
      document.getElementById('pr-text').textContent = `${p.done} of ${p.total} tasks done`;
    };
    const wireTasks = () => {
      root.querySelectorAll('.task').forEach((row) => {
        const id = row.dataset.id;
        row.querySelector('input').onchange = async (e) => {
          const cb = e.target;
          try {
            const r = await api('/tasks/' + id, { method: 'PATCH', body: { status: cb.checked ? 'done' : 'todo' } });
            row.classList.toggle('done', cb.checked);
            updateProgress(r.progress);
          } catch (err) { cb.checked = !cb.checked; toast(err.message, 'error'); }
        };
        row.querySelector('button').onclick = async () => {
          try {
            const r = await api('/tasks/' + id, { method: 'DELETE' });
            row.remove();
            updateProgress(r.progress);
            if (!root.querySelector('.task')) document.getElementById('tasks').innerHTML = empty('No tasks yet. Add the first one below.');
          } catch (err) { toast(err.message, 'error'); }
        };
      });
    };
    wireTasks();

    document.getElementById('task-form').onsubmit = async (e) => {
      e.preventDefault();
      const title = document.getElementById('t-title').value.trim();
      if (title.length < 2) return toast('Task title is too short.', 'error');
      await withButton(e.submitter, async () => {
        await api(`/projects/${d.project.id}/tasks`, { method: 'POST', body: { title, assigned_to: document.getElementById('t-assign').value || null } });
        load(d.project.id);
      });
    };
  }

  // Build one task row with its completion state and assigned teammate.
  function taskRow(t) {
    return `<div class="task ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
      <input type="checkbox" ${t.status === 'done' ? 'checked' : ''} aria-label="Mark done" />
      <span class="t-title">${esc(t.title)}${t.assigned_name ? ` <span class="muted small">· ${esc(t.assigned_name)}</span>` : ''}</span>
      <button class="btn btn-danger btn-sm" aria-label="Delete task">✕</button>
    </div>`;
  }
})();