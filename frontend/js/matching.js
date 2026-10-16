// Show recommended projects or rank potential teammates for one of the user's projects.
(async function () {
  if (!(await mountShell('matching', 'Smart Matching'))) return;
  const root = document.getElementById('match-root');
  const tabP = document.getElementById('tab-projects');
  const tabT = document.getElementById('tab-people');

  // Display match scores consistently and distinguish matched skills from missing ones.
  const ringColor = (p) => (p >= 75 ? '#16a34a' : '#eab308');
  const ring = (p) => `<div class="ring" style="--p:${p};--ring:${ringColor(p)}"><span>${p}%</span></div><div class="muted small">match</div>`;
  const matchBadges = (m) => badges(m.matchedSkills, 'ok') + badges(m.missingSkills, 'miss');

  function setTab(which) {
    tabP.classList.toggle('active', which === 'projects');
    tabT.classList.toggle('active', which === 'people');
    which === 'projects' ? showProjects() : showPeople();
  }

  /* ---- ranked projects for me ---- */
  async function showProjects() {
    root.innerHTML = loading();
    try {
      const { projects } = await api('/matching/projects');
      if (!projects.length) {
        root.innerHTML = empty('No open projects to match with right now. <a href="create-project.html">Create one</a> or check back later.');
        return;
      }
      root.innerHTML = `<p class="muted small">Ranked by your skills (70%) and interests (30%). Add skills on your <a href="skills.html">Skills page</a> to improve results.</p>
        <div class="match-grid">${projects.map((p) => `
          <div class="card match-card">
            <h3>${esc(p.title)}</h3>
            <div class="muted small">${esc(p.category)} · by ${esc(p.owner_name)} · ${p.spots_left} spot${p.spots_left === 1 ? '' : 's'} left</div>
            ${ring(p.match.percent)}
            <div>${matchBadges(p.match)}</div>
            <div class="explain">${esc(p.match.explanation)}</div>
            ${p.has_pending
              ? '<button class="btn btn-block" disabled>Request pending</button>'
              : `<button class="btn btn-block" data-apply="${p.id}">Send Request</button>`}
          </div>`).join('')}</div>`;
      root.querySelectorAll('[data-apply]').forEach((b) => (b.onclick = () => withButton(b, async () => {
        await api(`/projects/${b.dataset.apply}/apply`, { method: 'POST' });
        toast('Request sent to the project owner.', 'success');
        b.textContent = 'Request pending';
        b.disabled = true;
      })));
    } catch (e) {
      root.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
    }
  }

  /* ---- ranked students for one of my projects ---- */
  async function showPeople() {
    root.innerHTML = loading();
    try {
      const { projects } = await api('/projects/mine');
      const owned = projects.filter((p) => p.is_owner);
      if (!owned.length) {
        root.innerHTML = empty('You have no projects yet. <a href="create-project.html">Create a project</a> to find teammates.');
        return;
      }
      root.innerHTML = `
        <div class="toolbar"><select id="own-select" aria-label="Choose project">
          ${owned.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}
        </select></div>
        <div id="cand-root"></div>`;
      const sel = document.getElementById('own-select');
      const initial = param('project');
      if (initial && owned.some((p) => String(p.id) === initial)) sel.value = initial;
      sel.onchange = () => loadCandidates(sel.value);
      loadCandidates(sel.value);
    } catch (e) {
      root.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
    }
  }

  async function loadCandidates(projectId) {
    const box = document.getElementById('cand-root');
    box.innerHTML = loading();
    try {
      const { project, candidates } = await api(`/matching/projects/${projectId}/candidates`);
      if (!candidates.length) { box.innerHTML = empty('No other students to match yet.'); return; }
      box.innerHTML = `
        <div class="card" style="margin-bottom:16px"><b>${esc(project.title)}</b> needs:
          ${project.skills.length ? badges(project.skills) : '<span class="muted small">no specific skills</span>'}
          ${project.full ? '<div class="alert error" style="margin:10px 0 0">Your team is full – no more invitations can be sent.</div>' : ''}
        </div>
        <div class="match-grid">${candidates.map((c) => `
          <div class="card match-card">
            <div class="who">${avatar(c.name, c.profile_image)}<b>${esc(c.name)}</b>
              <span class="muted small">${esc([c.college, c.semester].filter(Boolean).join(', ')) || 'Student'}</span></div>
            ${ring(c.match.percent)}
            <div>${matchBadges(c.match)}</div>
            <div class="explain">${esc(c.match.explanation)}</div>
            <div class="row" style="gap:8px">
              ${c.has_pending
                ? '<button class="btn btn-block" disabled>Pending</button>'
                : `<button class="btn btn-block" data-invite="${c.id}" ${project.full ? 'disabled' : ''}>Send Request</button>`}
              <a class="btn btn-outline" href="chat.html?user=${c.id}" title="Message">💬</a>
            </div>
          </div>`).join('')}</div>`;
      box.querySelectorAll('[data-invite]').forEach((b) => (b.onclick = () => withButton(b, async () => {
        await api('/invitations', { method: 'POST', body: { projectId: Number(projectId), userId: Number(b.dataset.invite) } });
        toast('Invitation sent.', 'success');
        b.textContent = 'Pending';
        b.disabled = true;
      })));
    } catch (e) {
      box.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
    }
  }

  tabP.onclick = () => setTab('projects');
  tabT.onclick = () => setTab('people');
  setTab(param('project') ? 'people' : 'projects');
})();