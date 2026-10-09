import { apiFetch, errorText } from '../api.js';
import { getResource, refresh, rerender, state } from '../store.js';
import { artistCredit, durationText, timeAgo } from '../format.js';
import { debounce, esc, qsa } from '../ui.js';
import { navigate } from '../router.js';

const page = {
  id: null,
  editing: false,
  draft: '',
  pickerQuery: '',
  picked: new Set(),
  busy: false,
  message: null,
  report: null,
};

const debouncedRender = debounce(rerender, 200);

export function renderPlaylistDetail(main, path) {
  const id = Number(path.split('/')[2]);
  if (page.id !== id) {
    page.id = id;
    page.editing = false;
    page.draft = '';
    page.pickerQuery = '';
    page.picked = new Set();
    page.message = null;
    page.report = null;
    page.busy = false;
  }

  const res = getResource(`/api/library/playlists/${id}`);
  if (res.loading && !res.data) {
    main.innerHTML = '<p class="muted">loading…</p>';
    return;
  }
  if (res.error) {
    main.innerHTML = `<p class="err">could not load this playlist: ${esc(res.error)}</p>`;
    return;
  }
  const playlist = res.data?.playlist;
  if (!playlist) {
    main.innerHTML = '';
    return;
  }

  if (!page.editing && page.draft !== playlist.name) page.draft = playlist.name;

  const items = playlist.items ?? [];
  const isOwner = playlist.owner_id === state.userId;
  const matched = items.filter((i) => i.song.yt_video_id).length;

  const picker = page.pickerQuery.trim()
    ? getResource(`/api/library/songs?q=${encodeURIComponent(page.pickerQuery.trim())}&limit=20`)
    : { data: null, loading: false, error: null };
  const found = picker.data?.songs ?? [];

  main.innerHTML = `
    <section class="head">
      <a class="back" href="/playlists" data-link>← playlists</a>
      <div class="titleRow">
        ${
          page.editing
            ? `<input id="pd-rename" type="text" value="${esc(page.draft)}" aria-label="Playlist name">
               <button id="pd-save" class="primary" ${page.busy ? 'disabled' : ''}>Save</button>
               <button id="pd-cancel" class="ghost">Cancel</button>`
            : `<h1>${esc(playlist.name)}</h1>${
                playlist.can_edit ? '<button id="pd-edit" class="ghost">rename</button>' : ''
              }`
        }
      </div>
      <p class="meta">by ${esc(playlist.owner_username)} · ${items.length} tracks · ${
        playlist.can_edit ? 'you can edit' : 'view only'
      } · updated ${esc(timeAgo(playlist.updated_at))}</p>
      ${page.message ? `<p class="note">${esc(page.message)}</p>` : ''}
    </section>
    ${isOwner ? '<button id="pd-delete" class="danger">delete playlist</button>' : ''}
    ${
      playlist.can_edit
        ? `<section class="picker">
            <h2>Add tracks</h2>
            <div class="pickerRow">
              <input id="pd-search" type="search" placeholder="find a song by title or artist…"
                value="${esc(page.pickerQuery)}" aria-label="Find a track to add">
              <button id="pd-add" class="primary" ${page.busy || !page.picked.size ? 'disabled' : ''}>Add${
                page.picked.size ? ` (${page.picked.size})` : ''
              }</button>
            </div>
            ${
              page.pickerQuery.trim()
                ? `<ul class="found">${
                    picker.loading && !picker.data
                      ? '<li class="muted">loading…</li>'
                      : found.length
                        ? found
                            .map(
                              (s) => `<li><label>
                                <input type="checkbox" data-pick="${s.id}" ${
                                  page.picked.has(s.id) ? 'checked' : ''
                                }>
                                <span class="t">${esc(s.title)}</span>
                                <span class="a">${esc(
                                  s.artists.map((a) => a.name).join(', '),
                                )}</span>
                              </label></li>`,
                            )
                            .join('')
                        : `<li class="muted">nothing matches “${esc(page.pickerQuery)}”</li>`
                  }</ul>`
                : ''
            }
          </section>`
        : ''
    }
    <section class="yt">
      <div class="ytRow">
        <strong>${matched}</strong> of ${items.length} matched with YouTube Music
        <button id="pd-matchall" ${page.busy || !items.length ? 'disabled' : ''}>match all</button>
        <button id="pd-export" ${page.busy || !items.length ? 'disabled' : ''}>export links</button>
      </div>
      ${page.report ? exportBlock(page.report) : ''}
    </section>
    <ol class="tracks">
      ${items
        .map(
          (item) => `<li>
            <span class="pos">${item.position + 1}</span>
            <span class="t">${esc(item.song.title)}</span>
            <span class="a">${esc(artistCredit(item.song))}</span>
            <span class="d">${durationText(item.song.duration_s)}</span>
            <span class="ytlink">${
              item.song.yt_video_id
                ? `<a href="https://music.youtube.com/watch?v=${esc(
                    item.song.yt_video_id,
                  )}" target="_blank" rel="noopener">yt</a>`
                : `<button class="linky" data-match="${item.song.id}" ${
                    page.busy ? 'disabled' : ''
                  }>find</button>`
            }</span>
            ${
              playlist.can_edit
                ? `<button class="x" data-remove="${item.id}" aria-label="Remove ${esc(
                    item.song.title,
                  )}">×</button>`
                : ''
            }
          </li>`,
        )
        .join('')}
      ${items.length ? '' : '<li class="muted">No tracks yet.</li>'}
    </ol>
  `;

  wire(main, id, playlist.name);
}

function exportBlock(report) {
  return `
    <div class="export">
      <div class="head">
        <strong>${report.matched}</strong> of ${report.total} matched
        ${report.unmatched.length ? `<span class="warn">${report.unmatched.length} without a match</span>` : ''}
        <span class="spacer"></span>
        <button id="pd-copy">copy links</button>
        <button id="pd-close-report" class="ghost">close</button>
      </div>
      <textarea readonly rows="10" aria-label="The exported links">${esc(report.text)}</textarea>
      ${
        report.uncertain.length
          ? `<p class="warnp">${report.uncertain.length} uncertain match(es) are in the export as comments, not links: ${report.uncertain
              .map((u) => `<span class="chipgap">${esc(u.title)} → ${esc(u.url)}</span>`)
              .join(' ')}</p>`
          : ''
      }
      ${
        report.unmatched.length
          ? `<p class="muted">Unmatched songs are listed as comments: ${report.unmatched
              .map((u) => `<span class="chipgap">${esc(u.title)}</span>`)
              .join(' ')}</p>`
          : ''
      }
    </div>`;
}

function wire(main, id, playlistName) {
  const $ = (selector) => main.querySelector(selector);

  $('#pd-edit')?.addEventListener('click', () => {
    page.draft = playlistName;
    page.editing = true;
    rerender();
  });
  $('#pd-cancel')?.addEventListener('click', () => {
    page.editing = false;
    rerender();
  });
  $('#pd-rename')?.addEventListener('input', (event) => {
    page.draft = event.target.value;
  });
  $('#pd-save')?.addEventListener('click', () => renamePlaylist(id));
  $('#pd-delete')?.addEventListener('click', () => deletePlaylist(id, playlistName));
  $('#pd-search')?.addEventListener('input', (event) => {
    page.pickerQuery = event.target.value;
    debouncedRender();
  });
  $('#pd-add')?.addEventListener('click', () => addPicked(id));
  qsa('input[data-pick]', main).forEach((box) =>
    box.addEventListener('change', () => {
      const songId = Number(box.dataset.pick);
      if (box.checked) page.picked.add(songId);
      else page.picked.delete(songId);
      rerender();
    }),
  );
  $('#pd-matchall')?.addEventListener('click', () => matchAll(id));
  $('#pd-export')?.addEventListener('click', () => exportLinks(id));
  $('#pd-copy')?.addEventListener('click', () => copyText(page.report.text, page.report.matched));
  $('#pd-close-report')?.addEventListener('click', () => {
    page.report = null;
    rerender();
  });
  qsa('[data-remove]', main).forEach((button) =>
    button.addEventListener('click', () => removeTrack(id, Number(button.dataset.remove))),
  );
  qsa('[data-match]', main).forEach((button) =>
    button.addEventListener('click', () => matchOne(Number(button.dataset.match))),
  );
}

async function renamePlaylist(id) {
  const name = page.draft.trim();
  if (!name || page.busy) return;
  page.busy = true;
  page.message = null;
  rerender();
  try {
    await apiFetch(`/api/library/playlists/${id}`, {
      method: 'PATCH',
      userId: state.userId,
      body: { name },
    });
    page.editing = false;
    page.busy = false;
    refresh();
  } catch (err) {
    page.busy = false;
    page.message = errorText(err);
    rerender();
  }
}

async function removeTrack(id, itemId) {
  if (page.busy) return;
  page.busy = true;
  rerender();
  try {
    await apiFetch(`/api/library/playlists/${id}/items/${itemId}`, {
      method: 'DELETE',
      userId: state.userId,
    });
  } catch (err) {
    page.message = errorText(err);
  }
  page.busy = false;
  refresh();
}

async function deletePlaylist(id, name) {
  if (page.busy) return;
  if (!confirm(`Delete “${name}”? The songs stay in your library.`)) return;
  page.busy = true;
  try {
    await apiFetch(`/api/library/playlists/${id}`, { method: 'DELETE', userId: state.userId });
  } catch (err) {
    page.busy = false;
    page.message = errorText(err);
    rerender();
    return;
  }
  page.busy = false;
  refresh();
  navigate('/playlists');
}

async function addPicked(id) {
  const songIds = [...page.picked];
  if (!songIds.length || page.busy) return;
  page.busy = true;
  page.message = null;
  rerender();
  try {
    const res = await apiFetch(`/api/library/playlists/${id}/items`, {
      method: 'POST',
      userId: state.userId,
      body: { songIds },
    });
    page.picked = new Set();
    page.pickerQuery = '';
    page.message = `Added ${res.added} track(s). ${res.notifiedUsers} collaborator(s) notified.`;
  } catch (err) {
    page.message = errorText(err);
  }
  page.busy = false;
  refresh();
}

async function matchOne(songId) {
  if (page.busy) return;
  page.busy = true;
  page.message = 'matching…';
  rerender();
  try {
    const res = await apiFetch(`/api/library/songs/${songId}/match`, {
      method: 'POST',
      userId: state.userId,
      body: {},
    });
    page.message =
      res.status === 'not_found'
        ? `No YouTube Music match for “${res.title ?? 'this song'}”.`
        : `✓ matched (${Math.round(res.score * 100)}%)`;
  } catch (err) {
    page.message = errorText(err);
  }
  page.busy = false;
  refresh();
}

async function matchAll(id) {
  if (page.busy) return;
  page.busy = true;
  page.message = 'matching… this is one YouTube search per song, so it takes a moment';
  rerender();
  try {
    const res = await apiFetch(`/api/library/playlists/${id}/match`, {
      method: 'POST',
      userId: state.userId,
      body: {},
    });
    page.message = `✓ ${res.matched} of ${res.total} songs matched`;
  } catch (err) {
    page.message = errorText(err);
  }
  page.busy = false;
  refresh();
}

async function exportLinks(id) {
  if (page.busy) return;
  page.busy = true;
  page.message = null;
  rerender();
  try {
    page.report = await apiFetch(`/api/library/export/youtube?playlistId=${id}`, {
      userId: state.userId,
    });
  } catch (err) {
    page.message = errorText(err);
  }
  page.busy = false;
  rerender();
}

async function copyText(text, matched) {
  try {
    await navigator.clipboard.writeText(text);
    page.message = `✓ copied ${matched} link(s)`;
  } catch {
    page.message = 'could not use the clipboard — select the text instead';
  }
  rerender();
}
