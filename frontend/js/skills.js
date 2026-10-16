// Load selectable skills, track checkbox changes, and save the student's choices.
(async function () {
  if (!(await mountShell('skills', 'Skills'))) return;
  const grid = document.getElementById('skill-grid');
  const saveBtn = document.getElementById('save-skills');
  const count = document.getElementById('skill-count');
  const addForm = document.getElementById('add-skill-form');
  const addInput = document.getElementById('new-skill');
  const addBtn = document.getElementById('add-skill');
  grid.innerHTML = loading();

  // Keep the selected-skill count in sync with the checkboxes.
  function updateCount() {
    const n = grid.querySelectorAll('input:checked').length;
    count.textContent = n + ' selected';
  }

  // Rebuild the list while preserving any selections made before adding a new skill.
  function renderSkills(skills, selectedIds = new Set()) {
    grid.innerHTML = skills.map((s) => `
      <label class="skill-option"><input type="checkbox" value="${s.id}" ${s.selected || selectedIds.has(s.id) ? 'checked' : ''} /> ${esc(s.name)}</label>`).join('');
    updateCount();
  }

  try {
    const { skills } = await api('/skills');
    renderSkills(skills);
    saveBtn.disabled = false;
    grid.addEventListener('change', updateCount);
  } catch (e) {
    grid.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
    return;
  }

  saveBtn.onclick = () => withButton(saveBtn, async () => {
    const ids = [...grid.querySelectorAll('input:checked')].map((i) => Number(i.value));
    await api('/skills/me', { method: 'PUT', body: { skillIds: ids } });
    toast('Skills saved.', 'success');
  });

  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    withButton(addBtn, async () => {
      const name = addInput.value.trim();
      const selectedIds = new Set([...grid.querySelectorAll('input:checked')].map((input) => Number(input.value)));
      const { skill, created } = await api('/skills', { method: 'POST', body: { name } });
      selectedIds.add(skill.id);
      const { skills } = await api('/skills');
      renderSkills(skills, selectedIds);
      addInput.value = '';
      toast(created ? 'Skill added and selected.' : 'That skill already exists; it has been selected.', 'success');
    });
  });
})();