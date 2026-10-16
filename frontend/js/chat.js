// Manage the contact list, one-to-one conversations, and polling for new messages.
(async function () {
  if (!(await mountShell('chat', 'Chat'))) return;
  const me = Auth.user;
  const wrap = document.getElementById('chat-wrap');
  const listEl = document.getElementById('contact-list');
  const head = document.getElementById('conv-head');
  const msgsEl = document.getElementById('messages');
  const input = document.getElementById('msg-input');
  const sendBtn = document.getElementById('send-btn');
  const search = document.getElementById('contact-search');

  let contacts = [];
  let current = null;     // contact object we are chatting with
  let lastId = 0;         // last message id shown

  /* ---------- contacts ---------- */
  async function loadContacts() {
    try {
      const { contacts: c } = await api('/chat/contacts?q=' + encodeURIComponent(search.value.trim()));
      contacts = c;
      renderContacts();
    } catch (e) {
      listEl.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
    }
  }
  function renderContacts() {
    if (!contacts.length) { listEl.innerHTML = empty('No students found.'); return; }
    listEl.innerHTML = contacts.map((c) => `
      <div class="contact ${current && current.id === c.id ? 'active' : ''}" data-id="${c.id}">
        ${avatar(c.name, c.profile_image, 'sm')}
        <div><div class="name">${esc(c.name)}</div>
          <div class="sub"><span class="dot ${c.online ? 'on' : ''}"></span>${c.last_message ? esc(c.last_message) : (c.online ? 'Online' : 'Offline')}</div></div>
      </div>`).join('');
    listEl.querySelectorAll('.contact').forEach((el) => (el.onclick = () => open(Number(el.dataset.id))));
  }

  /* ---------- conversation ---------- */
  function bubble(m) {
    const mine = m.sender_id === me.id;
    return `<div class="msg ${mine ? 'me' : ''}" data-id="${m.id}">${esc(m.body)}<time>${esc(fmtTime(m.created_at))}</time></div>`;
  }
  // Append only unseen messages and keep the conversation pinned to the latest reply.
  function addMessages(list) {
    const atBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80;
    const placeholder = msgsEl.querySelector('.empty');
    if (placeholder && list.length) placeholder.remove();
    for (const m of list) {
      if (m.id <= lastId || msgsEl.querySelector(`[data-id="${m.id}"]`)) continue;
      msgsEl.insertAdjacentHTML('beforeend', bubble(m));
      lastId = Math.max(lastId, m.id);
    }
    if (atBottom || list.some((m) => m.sender_id === me.id)) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  // Select a contact and load the conversation history from the API.
  async function open(userId) {
    current = contacts.find((c) => c.id === userId) || { id: userId, name: 'Student' };
    wrap.classList.add('in-chat');
    renderContacts();
    head.innerHTML = `<button class="btn btn-outline btn-sm back-btn" id="back-btn">← Back</button>
      ${avatar(current.name, current.profile_image, 'sm')}
      <div><b>${esc(current.name)}</b><div class="muted small"><a href="#" id="view-profile">View profile</a></div></div>`;
    document.getElementById('back-btn').onclick = () => { wrap.classList.remove('in-chat'); current = null; renderContacts(); };
    document.getElementById('view-profile').onclick = (e) => { e.preventDefault(); showProfile(userId); };
    msgsEl.innerHTML = loading();
    input.disabled = sendBtn.disabled = false;
    lastId = 0;
    try {
      const { messages } = await api(`/chat/with/${userId}/messages`);
      msgsEl.innerHTML = '';
      if (!messages.length) msgsEl.innerHTML = empty('No messages yet. Say hello 👋');
      addMessages(messages);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      input.focus();
    } catch (e) {
      msgsEl.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
    }
  }

  async function showProfile(userId) {
    const modal = openModal(loading());
    try {
      const { profile: p } = await api('/profile/' + userId);
      modal.querySelector('.modal').innerHTML = `
        <div class="center">${avatar(p.name, p.profile_image, 'lg')}<h2 style="margin-top:10px">${esc(p.name)}</h2>
        <p class="muted small">${esc([p.college, p.semester].filter(Boolean).join(', '))}</p>
        <p class="small">${esc(p.bio)}</p>
        <div>${badges(p.skills)}</div>
        <button class="btn btn-outline" style="margin-top:12px" onclick="this.closest('.modal-back').remove()">Close</button></div>`;
    } catch (e) {
      modal.querySelector('.modal').innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
    }
  }

  // Send the message and show it immediately after the server confirms it was saved.
  document.getElementById('composer').onsubmit = async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || !current) return;
    sendBtn.disabled = true;
    try {
      const { message } = await api(`/chat/with/${current.id}/messages`, { method: 'POST', body: { body } });
      input.value = '';
      addMessages([message]);
      loadContacts();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  };

  search.addEventListener('input', debounce(loadContacts, 300));

  /* ---------- Poll for new messages ---------- */
  function onIncoming(m) {
    const other = m.sender_id === me.id ? null : m.sender_id;
    if (current && (m.sender_id === current.id || m.sender_id === me.id)) addMessages([m]);
    else if (other) toast('New message', 'info');
    loadContacts();
  }
  setInterval(async () => {
    if (!current || document.hidden) return;
    try {
      const { messages } = await api(`/chat/with/${current.id}/messages?after=${lastId}`);
      if (messages.length) {
        messages.forEach(onIncoming);
      }
    } catch { /* ignore transient errors */ }
  }, 4000);

  await loadContacts();
  const target = Number(param('user'));
  if (target) open(target);
})();