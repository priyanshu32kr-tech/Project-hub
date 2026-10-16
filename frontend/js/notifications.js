// Load incoming project requests and notifications for the signed-in student.
(async function () {
  if (!(await mountShell('notifications', 'Notifications'))) return;
  const reqEl = document.getElementById('requests');
  const listEl = document.getElementById('notif-list');
  const readAll = document.getElementById('read-all');

  /* ---- invitations / join requests ---- */
  // Show invitations and join requests, then refresh lists after a response.
  async function loadRequests() {
    reqEl.innerHTML = loading();
    try {
      const { incoming } = await api('/invitations');
      if (!incoming.length) { reqEl.innerHTML = empty('No pending requests.'); return; }
      reqEl.innerHTML = incoming.map((i) => `
        <div class="notif" data-id="${i.id}">
          <div class="body">${i.type === 'invite'
            ? `<b>${esc(i.sender_name)}</b> invited you to join <b>${esc(i.project_title)}</b>.`
            : `<b>${esc(i.applicant_name)}</b> wants to join your project <b>${esc(i.project_title)}</b>.`}
            <div class="muted small">${esc(fmtTime(i.created_at))}</div></div>
          <div class="row" style="gap:8px">
            <button class="btn btn-sm" data-act="accept">Accept</button>
            <button class="btn btn-outline btn-sm" data-act="reject">Reject</button>
          </div>
        </div>`).join('');
      reqEl.querySelectorAll('.notif').forEach((row) => {
        row.querySelectorAll('button').forEach((b) => (b.onclick = () => withButton(b, async () => {
          const r = await api('/invitations/' + row.dataset.id, { method: 'PATCH', body: { action: b.dataset.act } });
          toast(r.status === 'accepted' ? 'Accepted – the student has been added to the team.' : 'Rejected.', 'success');
          loadRequests();
          loadNotifications();
          refreshUnread();
        })));
      });
    } catch (e) {
      reqEl.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
    }
  }

  /* ---- notifications ---- */
  const ICON = { invitation: '📨', join_request: '🙋', invitation_response: '✅', project_activity: '📌', project_update: '🛠️' };
  // Render updates and let the student mark individual or all notices as read.
  async function loadNotifications() {
    listEl.innerHTML = loading();
    try {
      const { notifications, unread } = await api('/notifications');
      readAll.disabled = unread === 0;
      if (!notifications.length) { listEl.innerHTML = empty('You have no notifications yet.'); return; }
      listEl.innerHTML = notifications.map((n) => `
        <div class="notif ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${esc(n.link)}">
          <div style="font-size:22px">${ICON[n.type] || '🔔'}</div>
          <div class="body">${esc(n.message)}<div class="muted small">${esc(fmtTime(n.created_at))}</div></div>
          ${n.is_read ? '' : '<button class="btn btn-outline btn-sm">Mark read</button>'}
        </div>`).join('');
      listEl.querySelectorAll('.notif').forEach((row) => {
        const btn = row.querySelector('button');
        if (btn) btn.onclick = () => withButton(btn, async () => {
          await api(`/notifications/${row.dataset.id}/read`, { method: 'PATCH' });
          loadNotifications();
          refreshUnread();
        });
        const link = row.dataset.link;
        if (link && /^[a-z-]+\.html(\?[\w=&-]*)?$/i.test(link) && link !== 'notifications.html') {
          row.style.cursor = 'pointer';
          row.onclick = async (e) => {
            if (e.target.closest('button')) return;
            try { await api(`/notifications/${row.dataset.id}/read`, { method: 'PATCH' }); } catch { /* ignore */ }
            location.href = link;
          };
        }
      });
    } catch (e) {
      listEl.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
    }
  }

  readAll.onclick = () => withButton(readAll, async () => {
    await api('/notifications/read-all', { method: 'POST' });
    loadNotifications();
    refreshUnread();
  });

  loadRequests();
  loadNotifications();
})();