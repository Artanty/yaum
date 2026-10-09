import { apiFetch, errorText } from '../api.js';
import { getResource, refresh, rerender, state } from '../store.js';
import { durationText, plural, timeAgo } from '../format.js';
import { esc, qsa } from '../ui.js';
import { navigate } from '../router.js';

const page = {
  openId: null,
  name: '',
  excluded: new Set(),
  busy: false,
  message: null,
};

export function renderImports(main) {
  const pending = getResource('/api/library/imports/pending');
  const list = pending.data?.imports ?? [];
  const detail =
    page.openId !== null
      ? getResource(`/api/library/imports/${page.openId}`)
      : { data: null, loading: false, error: null };

  let body;
  if (pending.loading && !pending.data) {
    body = '<p class="muted">loading…</p>';
  } else if (list.length === 0) {
    body = `<p class="muted">Nothing pending for user ${state.userId}. Scan a playlist in the extension and press “Import to my library”, and it will show up here.</p>`;
  } else {
    body = `<ul class="cards">${list
      .map(
        (imp) => `<li class="card">
          <div class="row">
            <div>
              <h2>${esc(imp.source_label ?? 'Scanned playlist')}</h2>
              <p class="meta">${plural(imp.item_count, 'track')} · ${imp.new_song_count} new to the library · scanned ${esc(
                timeAgo(imp.created_at),
              )}${
                imp.page_url
                  ? ` · <a href="${esc(imp.page_url)}" target="_blank" rel="noopener">source</a>`
                  : ''
              }</p>
            </div>
            <button class="primary" data-open="${imp.id}" data-label="${esc(
              imp.source_label ?? '',
            )}" data-count="${imp.item_count}">Build playlist</button>
          </div>
        </li>`,
      )
      .join('')}</ul>`;
  }

  main.innerHTML = `
    <section class="head">
      <h1>Imports</h1>
      <p class="muted">Every scan the extension sends lands here first. Nothing is in a playlist until you say so.</p>
    </section>
    ${body}
    ${page.openId !== null ? drawer(detail) : ''}
  `;

  wire(main);
}

function drawer(detail) {
  if (detail.loading && !detail.data) {
    return '<div class="overlay" data-close></div><section class="drawer"><p class="muted">loading tracks…</p></section>';
  }
  if (detail.error) {
    return `<div class="overlay" data-close></div><section class="drawer"><p class="err">could not load this import: ${esc(
      detail.error,
    )}</p></section>`;
  }
  const tracks = detail.data?.tracks ?? [];
  const selected = tracks.filter((t) => !page.excluded.has(t.id)).length;
  const suggested = detail.data
    ? `${detail.data.import.source_label ?? 'Scanned playlist'} (${selected} tracks)`
    : '';

  return `
    <div class="overlay" data-close></div>
    <section class="drawer" role="dialog" aria-label="Build a playlist from this import">
      <header><h2>Build a playlist</h2><button class="ghost" data-close>close</button></header>
      <label class="field"><span>Playlist name</span>
        <input id="imp-name" type="text" value="${esc(page.name)}" placeholder="${esc(suggested)}">
      </label>
      <p class="meta">${selected} of ${tracks.length} selected · untick anything you do not want</p>
      <ul class="tracks">
        ${tracks
          .map(
            (t) => `<li><label>
              <input type="checkbox" data-track="${t.id}" ${page.excluded.has(t.id) ? '' : 'checked'}>
              <span class="t">${esc(t.title)}</span>
              <span class="a">${t.artists.map((a) => `<span>${esc(a.name)}</span>`).join(' ')}</span>
              <span class="d">${durationText(t.duration_s)}</span>
              ${t.isNew ? '<span class="new">new</span>' : ''}
            </label></li>`,
          )
          .join('')}
      </ul>
      ${page.message ? `<p class="err">${esc(page.message)}</p>` : ''}
      <footer><button id="imp-build" class="primary" ${
        page.busy || selected === 0 ? 'disabled' : ''
      }>${page.busy ? 'creating…' : 'Create playlist'}</button></footer>
    </section>`;
}

function wire(main) {
  qsa('[data-open]', main).forEach((button) =>
    button.addEventListener('click', () => {
      page.openId = Number(button.dataset.open);
      page.excluded = new Set();
      page.name = button.dataset.label
        ? `${button.dataset.label} (${button.dataset.count} tracks)`
        : '';
      page.message = null;
      rerender();
    }),
  );
  qsa('[data-close]', main).forEach((el) =>
    el.addEventListener('click', () => {
      page.openId = null;
      page.message = null;
      rerender();
    }),
  );
  main.querySelector('#imp-name')?.addEventListener('input', (event) => {
    page.name = event.target.value;
  });
  qsa('[data-track]', main).forEach((box) =>
    box.addEventListener('change', () => {
      const id = Number(box.dataset.track);
      if (box.checked) page.excluded.delete(id);
      else page.excluded.add(id);
      rerender();
    }),
  );
  main.querySelector('#imp-build')?.addEventListener('click', build);
}

async function build() {
  if (page.openId === null || page.busy) return;
  const detail = getResource(`/api/library/imports/${page.openId}`).data;
  if (!detail) return;
  const tracks = detail.tracks ?? [];

  // songIds is sent only when the user deselected something — otherwise the backend's own
  // "all new songs" default wins, so an untouched form cannot go stale.
  const songIds = page.excluded.size
    ? tracks.filter((t) => !page.excluded.has(t.id)).map((t) => t.id)
    : undefined;
  const chosen = songIds ?? tracks.filter((t) => t.isNew).map((t) => t.id);
  if (!chosen.length) {
    page.message = 'Nothing selected — deselect nothing, or pick at least one track.';
    rerender();
    return;
  }

  const fallbackName = `${detail.import.source_label ?? 'Scanned playlist'} (${chosen.length} tracks)`;
  const importId = page.openId;
  page.busy = true;
  page.message = null;
  rerender();
  try {
    const res = await apiFetch(`/api/library/imports/${importId}/playlist`, {
      method: 'POST',
      userId: state.userId,
      body: { name: page.name.trim() || fallbackName, ...(songIds ? { songIds } : {}) },
    });
    page.openId = null;
    page.busy = false;
    page.excluded = new Set();
    page.name = '';
    refresh();
    navigate(`/playlists/${res.playlistId}`);
  } catch (err) {
    page.busy = false;
    page.message = errorText(err);
    rerender();
  }
}
