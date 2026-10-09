import { apiFetch, errorText } from '../api.js';
import { getResource, refresh, rerender, state } from '../store.js';
import { artistCredit, durationText, plural, timeAgo } from '../format.js';
import { debounce, esc, qsa } from '../ui.js';

export const PAGE = 50;

// Selection lives at module scope, NOT in the render function: the songs resource is paged, so a
// selection rebuilt from the visible rows would silently drop page-1 ticks on "next".
const lib = {
  query: '',
  offset: 0,
  selection: new Set(),
  name: '',
  target: '',
  busy: false,
  message: null,
  report: null,
  list: [],
};

const debouncedRender = debounce(rerender, 200);

function songsUrl() {
  const params = new URLSearchParams();
  const q = lib.query.trim();
  if (q) params.set('q', q);
  params.set('limit', String(PAGE));
  params.set('offset', String(lib.offset));
  return `/api/library/songs?${params.toString()}`;
}

function songTitle(songId) {
  return lib.list.find((s) => s.id === songId)?.title ?? `#${songId}`;
}

export function renderLibrary(main) {
  const songs = getResource(songsUrl());
  lib.list = songs.data?.songs ?? [];
  const list = lib.list;
  const total = songs.data?.total ?? 0;
  const playlists = getResource('/api/library/playlists');
  const editable = [
    ...(playlists.data?.mine ?? []).map((p) => ({ ...p, shared: false })),
    ...(playlists.data?.shared ?? [])
      .filter((p) => p.can_edit)
      .map((p) => ({ ...p, shared: true })),
  ];

  const pageIds = list.map((s) => s.id);
  const allOn = pageIds.length > 0 && pageIds.every((id) => lib.selection.has(id));
  const from = total === 0 ? 0 : lib.offset + 1;
  const to = Math.min(lib.offset + PAGE, total);

  let body;
  if (songs.loading && !songs.data) {
    body = '<p class="muted">loading…</p>';
  } else if (songs.error) {
    body = `<p class="err">could not load the library: ${esc(songs.error)}</p>`;
  } else {
    body = `
      <p class="count">${
        total === 0 ? 'nothing here yet.' : `showing ${from}–${to} of ${plural(total, 'song')}`
      }</p>
      <table class="songs">
        <thead><tr>
          <th><input id="lib-all" type="checkbox" ${allOn ? 'checked' : ''} ${
            pageIds.length ? '' : 'disabled'
          } aria-label="Select every song on this page"></th>
          <th>Title</th><th>Artists</th><th>Album</th><th>Time</th><th>Seen</th><th>YouTube</th>
        </tr></thead>
        <tbody>
          ${list
            .map(
              (s) => `<tr class="${lib.selection.has(s.id) ? 'picked' : ''}">
                <td><input type="checkbox" data-song="${s.id}" ${
                  lib.selection.has(s.id) ? 'checked' : ''
                } aria-label="Select ${esc(s.title)}"></td>
                <td>${esc(s.title)}</td>
                <td>${esc(artistCredit(s))}</td>
                <td>${esc(s.album_title ?? '—')}</td>
                <td>${durationText(s.duration_s)}</td>
                <td title="first seen ${esc(timeAgo(s.first_seen_at))}">${s.seen_count}×</td>
                <td>${
                  s.yt_video_id
                    ? `<a href="https://music.youtube.com/watch?v=${esc(
                        s.yt_video_id,
                      )}" target="_blank" rel="noopener">link</a>`
                    : `<button class="linky" data-match="${s.id}" ${
                        lib.busy ? 'disabled' : ''
                      }>find match</button>`
                }</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      ${
        total > PAGE
          ? `<div class="pager">
              <button id="lib-prev" class="ghost" ${lib.offset === 0 ? 'disabled' : ''}>← prev</button>
              <button id="lib-next" class="ghost" ${to >= total ? 'disabled' : ''}>next →</button>
            </div>`
          : ''
      }`;
  }

  main.innerHTML = `
    <section class="head">
      <h1>Library</h1>
      <input id="lib-search" class="search" type="search" placeholder="search by title or artist…"
        value="${esc(lib.query)}" aria-label="Search the library by title or artist">
      ${lib.query.trim() ? '<button id="lib-clear" class="ghost">clear</button>' : ''}
    </section>
    ${body}
    ${lib.selection.size ? selbar(editable) : ''}
    ${lib.message && !lib.selection.size ? `<p class="msg standalone">${esc(lib.message)}</p>` : ''}
    ${lib.report ? reportBlock(lib.report) : ''}
  `;

  wire(main, pageIds, total, editable);
}

function selbar(editable) {
  return `
    <div class="selbar">
      <strong>${lib.selection.size}</strong> selected
      <input id="lib-name" class="name" type="text" placeholder="new playlist name…"
        value="${esc(lib.name)}" aria-label="Name for the new playlist">
      <button id="lib-create" ${lib.busy || !lib.name.trim() ? 'disabled' : ''}>create playlist</button>
      <select id="lib-target" aria-label="Add the selection to an existing playlist">
        <option value="">add to…</option>
        ${editable
          .map(
            (p) =>
              `<option value="${p.id}" ${String(p.id) === lib.target ? 'selected' : ''}>${esc(
                p.name,
              )}${p.shared ? ' (shared)' : ''}</option>`,
          )
          .join('')}
      </select>
      <button id="lib-add" ${lib.busy || !lib.target ? 'disabled' : ''}>add</button>
      <button id="lib-clear-sel" class="ghost" ${lib.busy ? 'disabled' : ''}>clear</button>
      <span class="spacer"></span>
      <button id="lib-match" ${lib.busy ? 'disabled' : ''}>match with YouTube</button>
      <button id="lib-export" ${lib.busy ? 'disabled' : ''}>export links</button>
      ${lib.message ? `<span class="msg">${esc(lib.message)}</span>` : ''}
    </div>`;
}

function reportBlock(report) {
  return `
    <div class="export">
      <div class="head">
        <strong>${report.matched}</strong> of ${report.total} matched
        ${report.unmatched.length ? `<span class="warn">${report.unmatched.length} without a match</span>` : ''}
        <span class="spacer"></span>
        <button id="lib-copy">copy links</button>
        <button id="lib-close-report" class="ghost">close</button>
      </div>
      <textarea readonly rows="10" aria-label="The exported links">${esc(report.text)}</textarea>
      ${
        report.uncertain.length
          ? `<p class="warnp">${report.uncertain.length} uncertain match(es) are comments, not links, so pasting skips them: ${report.uncertain
              .map((u) => `<span class="chipgap">${esc(u.title)} → ${esc(u.url)}</span>`)
              .join(' ')}</p>`
          : ''
      }
      ${
        report.unmatched.length
          ? `<p class="muted">Listed but unmatched (kept as comments): ${report.unmatched
              .map((u) => `<span class="chipgap">${esc(u.title)}</span>`)
              .join(' ')}</p>`
          : ''
      }
    </div>`;
}

function wire(main, pageIds, total) {
  const $ = (selector) => main.querySelector(selector);

  $('#lib-search')?.addEventListener('input', (event) => {
    lib.query = event.target.value;
    lib.offset = 0;
    debouncedRender();
  });
  $('#lib-clear')?.addEventListener('click', () => {
    lib.query = '';
    lib.offset = 0;
    rerender();
  });
  $('#lib-all')?.addEventListener('change', (event) => {
    for (const id of pageIds) {
      if (event.target.checked) lib.selection.add(id);
      else lib.selection.delete(id);
    }
    rerender();
  });
  qsa('input[data-song]', main).forEach((box) =>
    box.addEventListener('change', () => {
      const id = Number(box.dataset.song);
      if (box.checked) lib.selection.add(id);
      else lib.selection.delete(id);
      rerender();
    }),
  );
  $('#lib-prev')?.addEventListener('click', () => {
    lib.offset = Math.max(0, lib.offset - PAGE);
    rerender();
  });
  $('#lib-next')?.addEventListener('click', () => {
    if (lib.offset + PAGE < total) {
      lib.offset += PAGE;
      rerender();
    }
  });
  $('#lib-clear-sel')?.addEventListener('click', () => {
    lib.selection = new Set();
    rerender();
  });
  $('#lib-name')?.addEventListener('input', (event) => {
    lib.name = event.target.value;
    const button = $('#lib-create');
    if (button) button.disabled = !lib.name.trim() || lib.busy;
  });
  $('#lib-target')?.addEventListener('change', (event) => {
    lib.target = event.target.value;
    const button = $('#lib-add');
    if (button) button.disabled = !lib.target || lib.busy;
  });
  $('#lib-create')?.addEventListener('click', createPlaylist);
  $('#lib-add')?.addEventListener('click', addToPlaylist);
  $('#lib-match')?.addEventListener('click', matchSelected);
  $('#lib-export')?.addEventListener('click', exportSelected);
  $('#lib-copy')?.addEventListener('click', () => copyText(lib.report.text, lib.report.matched));
  $('#lib-close-report')?.addEventListener('click', () => {
    lib.report = null;
    rerender();
  });
  qsa('button[data-match]', main).forEach((button) =>
    button.addEventListener('click', () => matchOne(Number(button.dataset.match))),
  );
}

async function createPlaylist() {
  const name = lib.name.trim();
  const songIds = [...lib.selection];
  if (!name || !songIds.length || lib.busy) return;
  lib.busy = true;
  lib.message = null;
  rerender();
  try {
    const res = await apiFetch('/api/library/playlists', {
      method: 'POST',
      userId: state.userId,
      body: { name, songIds },
    });
    lib.name = '';
    lib.selection = new Set();
    lib.message = `✓ “${name}” — ${plural(res.added, 'song')} added`;
    lib.busy = false;
    refresh();
  } catch (err) {
    lib.busy = false;
    lib.message = errorText(err);
    rerender();
  }
}

async function addToPlaylist() {
  const target = Number(lib.target);
  const songIds = [...lib.selection];
  if (!target || !songIds.length || lib.busy) return;
  lib.busy = true;
  lib.message = null;
  rerender();
  try {
    const res = await apiFetch(`/api/library/playlists/${target}/items`, {
      method: 'POST',
      userId: state.userId,
      body: { songIds },
    });
    lib.target = '';
    lib.selection = new Set();
    lib.message = `✓ ${plural(res.added, 'song')} added to the playlist`;
    lib.busy = false;
    refresh();
  } catch (err) {
    lib.busy = false;
    lib.message = errorText(err);
    rerender();
  }
}

async function matchOne(songId) {
  if (lib.busy) return;
  lib.busy = true;
  lib.message = 'matching…';
  rerender();
  try {
    const res = await apiFetch(`/api/library/songs/${songId}/match`, {
      method: 'POST',
      userId: state.userId,
      body: {},
    });
    lib.message =
      res.status === 'not_found'
        ? `no YouTube Music match for “${res.ytTitle ?? songTitle(songId)}” — nothing was stored`
        : `✓ matched (${Math.round(res.score * 100)}%)`;
  } catch (err) {
    lib.message = errorText(err);
  }
  lib.busy = false;
  refresh();
}

async function matchSelected() {
  const ids = [...lib.selection];
  if (!ids.length || lib.busy) return;
  lib.busy = true;
  lib.message = `matching ${plural(ids.length, 'song')}…`;
  rerender();
  try {
    for (const id of ids) {
      await apiFetch(`/api/library/songs/${id}/match`, {
        method: 'POST',
        userId: state.userId,
        body: {},
      });
    }
    lib.message = `✓ matched ${plural(ids.length, 'song')}`;
  } catch (err) {
    lib.message = errorText(err);
  }
  lib.busy = false;
  refresh();
}

async function exportSelected() {
  const ids = [...lib.selection];
  if (!ids.length || lib.busy) return;
  lib.busy = true;
  lib.message = null;
  rerender();
  try {
    lib.report = await apiFetch(`/api/library/export/youtube?songIds=${ids.join(',')}`, {
      userId: state.userId,
    });
  } catch (err) {
    lib.message = errorText(err);
  }
  lib.busy = false;
  rerender();
}

async function copyText(text, matched) {
  try {
    await navigator.clipboard.writeText(text);
    lib.message = `✓ copied ${plural(matched, 'link')}`;
  } catch {
    lib.message = 'could not use the clipboard — select the text above instead';
  }
  rerender();
}
