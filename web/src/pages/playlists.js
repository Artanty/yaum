import { apiFetch, errorText } from '../api.js';
import { getResource, refresh, rerender, state } from '../store.js';
import { plural, timeAgo } from '../format.js';
import { esc } from '../ui.js';

const page = { name: '', busy: false, message: null };

export function renderPlaylists(main) {
  const res = getResource('/api/library/playlists');
  const mine = res.data?.mine ?? [];
  const shared = res.data?.shared ?? [];

  main.innerHTML = `
    <section class="head">
      <h1>Playlists</h1>
      <form id="pl-form" class="new">
        <input id="pl-name" type="text" placeholder="new playlist name…" value="${esc(page.name)}"
          aria-label="New playlist name">
        <button class="primary" type="submit" ${page.busy || !page.name.trim() ? 'disabled' : ''}>Create</button>
      </form>
      ${page.message ? `<p class="err">${esc(page.message)}</p>` : ''}
    </section>
    ${
      res.loading && !res.data
        ? '<p class="muted">loading…</p>'
        : `
          <h2 class="section">Yours</h2>
          <ul class="list">
            ${mine
              .map(
                (p) => `<li><a href="/playlists/${p.id}" data-link>
                  <span class="name">${esc(p.name)}</span>
                  <span class="meta">${plural(p.item_count, 'track')} · updated ${esc(
                    timeAgo(p.updated_at),
                  )}</span>
                </a></li>`,
              )
              .join('')}
            ${mine.length ? '' : '<li class="muted empty">No playlists yet.</li>'}
          </ul>
          <h2 class="section">Shared with you</h2>
          <ul class="list">
            ${shared
              .map(
                (p) => `<li><a href="/playlists/${p.id}" data-link>
                  <span class="name">${esc(p.name)}</span>
                  <span class="meta">by ${esc(p.owner_username)} · ${plural(
                    p.item_count,
                    'track',
                  )} · ${p.can_edit ? 'you can edit' : 'view only'}</span>
                </a></li>`,
              )
              .join('')}
            ${shared.length ? '' : '<li class="muted empty">Nothing shared with you yet.</li>'}
          </ul>`
    }
  `;

  const $ = (selector) => main.querySelector(selector);
  $('#pl-name')?.addEventListener('input', (event) => {
    page.name = event.target.value;
    const button = $('#pl-form button');
    if (button) button.disabled = !page.name.trim() || page.busy;
  });
  $('#pl-form')?.addEventListener('submit', create);
}

async function create(event) {
  event.preventDefault();
  const name = page.name.trim();
  if (!name || page.busy) return;
  page.busy = true;
  page.message = null;
  rerender();
  try {
    await apiFetch('/api/library/playlists', {
      method: 'POST',
      userId: state.userId,
      body: { name, description: null },
    });
    page.name = '';
    page.busy = false;
    refresh();
  } catch (err) {
    page.busy = false;
    page.message = errorText(err);
    rerender();
  }
}
