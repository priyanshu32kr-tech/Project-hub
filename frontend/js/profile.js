// Load the signed-in student's profile and switch between viewing and editing it.
(async function () {
  if (!(await mountShell('profile', 'My Profile'))) return;
  const root = document.getElementById('profile-root');
  root.innerHTML = loading();
  let profile;

  // Convert the comma-separated interests field into display badges.
  function csvBadges(csv) {
    const list = String(csv || '').split(',').map((s) => s.trim()).filter(Boolean);
    return list.length ? badges(list) : '<span class="muted small">None added yet.</span>';
  }

  // Show the saved profile details and provide a button to open the edit form.
  function renderView() {
    root.innerHTML = `
      <div class="grid grid-profile">
        <div class="card center">
          ${avatar(profile.name, profile.profile_image, 'lg')}
          <h2 style="margin-top:12px">${esc(profile.name)}</h2>
          <p class="muted small">${esc([profile.college, profile.semester].filter(Boolean).join(', ')) || 'Add your college and semester'}</p>
          <p class="small" style="margin:12px 0">${esc(profile.bio) || '<span class="muted">Write a short bio so teammates know you.</span>'}</p>
          <button class="btn btn-outline" id="edit-btn">Edit Profile</button>
        </div>
        <div class="stack">
          <div class="card">
            <div class="row between"><h3>Skills</h3><a href="skills.html" class="small">Edit</a></div>
            ${profile.skills.length ? badges(profile.skills) : '<span class="muted small">No skills yet. <a href="skills.html">Choose your skills</a>.</span>'}
          </div>
          <div class="card">
            <h3>Interests</h3>
            ${csvBadges(profile.interests)}
          </div>
        </div>
      </div>`;
    document.getElementById('edit-btn').onclick = renderEdit;
  }

  // Save edits through the API and refresh the name shown in the shared navigation.
  function renderEdit() {
    root.innerHTML = `
      <div class="card" style="max-width:720px">
        <h3>Edit profile</h3>
        <form id="profile-form" novalidate>
          <label for="f-name">Full name *</label>
          <input id="f-name" type="text" maxlength="100" value="${esc(profile.name)}" required />
          <div class="form-row">
            <div><label for="f-college">College</label><input id="f-college" type="text" maxlength="150" value="${esc(profile.college)}" /></div>
            <div><label for="f-sem">Semester / Year</label><input id="f-sem" type="text" maxlength="30" placeholder="e.g. 3rd Sem" value="${esc(profile.semester)}" /></div>
          </div>
          <label for="f-bio">Bio</label>
          <textarea id="f-bio" maxlength="1000" placeholder="Tell others about yourself">${esc(profile.bio)}</textarea>
          <label for="f-interests">Interests <span class="muted">(comma separated)</span></label>
          <input id="f-interests" type="text" maxlength="500" placeholder="Web Development, AI/ML, Open Source" value="${esc(profile.interests)}" />
          <label for="f-image">Profile image URL <span class="muted">(optional)</span></label>
          <input id="f-image" type="url" placeholder="https://…" value="${esc(profile.profile_image)}" />
          <div class="row" style="margin-top:20px">
            <button class="btn" type="submit">Save changes</button>
            <button class="btn btn-outline" type="button" id="cancel-btn">Cancel</button>
          </div>
        </form>
      </div>`;
    document.getElementById('cancel-btn').onclick = renderView;
    document.getElementById('profile-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('f-name').value.trim();
      const image = document.getElementById('f-image').value.trim();
      if (name.length < 2) return toast('Please enter your name.', 'error');
      if (image && !/^https?:\/\//i.test(image)) return toast('Image URL must start with http:// or https://', 'error');
      await withButton(e.submitter, async () => {
        const { profile: saved } = await api('/profile', {
          method: 'PUT',
          body: {
            name,
            college: document.getElementById('f-college').value,
            semester: document.getElementById('f-sem').value,
            bio: document.getElementById('f-bio').value,
            interests: document.getElementById('f-interests').value,
            profile_image: image
          }
        });
        profile = saved;
        Auth.set(Auth.token, { ...Auth.user, name: saved.name });
        document.getElementById('who-name').textContent = saved.name;
        toast('Profile saved.', 'success');
        renderView();
      });
    };
  }

  try {
    profile = (await api('/profile')).profile;
    renderView();
  } catch (e) {
    root.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
  }
})();