import { apiFetch } from '../api.js';
import { getResource, refresh, state } from '../store.js';
import { notificationText, timeAgo } from '../format.js';
import { esc } from '../ui.js';

export function renderNotifications(main) {
  const res = getResource('/api/library/notifications');
  const items = res.data?.notifications ?? [];
  const unread = res.data?.unread ?? 0;

  let body;
  if (res.loading && !res.data) {
    body = '<p class="muted">loading…</p>';
  } else if (items.length === 0) {
    body =
      '<p class="muted">Nothing here. You get a notification when someone shares a playlist with you, or edits one you share.</p>';
  } else {
    body = `<ul class="list">${items
      .map((n) => {
        const to = n.import_id ? '/imports' : n.playlist_id ? `/playlists/${n.playlist_id}` : null;
        const inner = `<span class="text">${esc(notificationText(n))}</span><span class="when">${esc(
          timeAgo(n.created_at),
        )}</span>`;
        return `<li class="${n.is_read ? '' : 'unread'}">${
          to ? `<a href="${to}" data-link>${inner}</a>` : `<div>${inner}</div>`
        }</li>`;
      })
      .join('')}</ul>`;
  }

  main.innerHTML = `
    <section class="head">
      <h1>Alerts</h1>
      ${unread > 0 ? `<button id="nt-read" class="ghost">mark all read (${unread})</button>` : ''}
    </section>
    ${body}
  `;

  main.querySelector('#nt-read')?.addEventListener('click', async () => {
    try {
      await apiFetch('/api/library/notifications/read', {
        method: 'POST',
        userId: state.userId,
        body: {},
      });
      refresh();
    } catch {
      /* a failed mark-read is not worth surfacing */
    }
  });
}
