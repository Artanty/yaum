import { getResource, refresh, setRenderer, state, switchUser } from './store.js';
import { esc, loaderHtml } from './ui.js';
import { installLinkHandler, setNavigateHandler } from './router.js';
import { renderLibrary } from './pages/library.js';
import { renderImports } from './pages/imports.js';
import { renderPlaylists } from './pages/playlists.js';
import { renderPlaylistDetail } from './pages/playlist-detail.js';
import { renderNotifications } from './pages/notifications.js';

const app = document.getElementById('app');

// The users API is the app's identity source (who the switcher can act as), so page content
// stays unavailable until it answers: #page shows the loader instead of the route, and the
// switcher is disabled. This is a latched flag, NOT a `!data` check: refresh() wipes the store
// cache, so data would go null on every mutation and re-blank the page.
let usersSeen = false;

function titleFor(path) {
  if (path.startsWith('/imports')) return 'Imports — plst';
  if (/^\/playlists\/\d+/.test(path)) return 'Playlist — plst';
  if (path.startsWith('/playlists')) return 'Playlists — plst';
  if (path.startsWith('/notifications')) return 'Alerts — plst';
  return 'Library — plst';
}

function pageFor(path) {
  if (path.startsWith('/imports')) return renderImports;
  if (/^\/playlists\/\d+/.test(path)) return renderPlaylistDetail;
  if (path.startsWith('/playlists')) return renderPlaylists;
  if (path.startsWith('/notifications')) return renderNotifications;
  return renderLibrary;
}

function activeClass(prefix) {
  const path = location.pathname;
  const active = prefix === '/library' ? path === '/' || path === '/library' : path.startsWith(prefix);
  return active ? ' class="on"' : '';
}

function shellHtml() {
  const me = getResource('/api/library/me').data;
  const users = getResource('/api/library/users').data?.users ?? [];
  const pending = me?.pendingImports ?? 0;
  const unread = me?.unreadNotifications ?? 0;
  const shared = me?.sharedWithMe ?? 0;

  return `
    <div class="shell">
      <header class="bar">
        <a class="brand" href="/library" data-link>plst<span>library</span></a>
        <nav>
          <a href="/library" data-link${activeClass('/library')}>Library</a>
          <a href="/imports" data-link${activeClass('/imports')}>Imports${
            pending ? ` <span class="badge warn">${pending}</span>` : ''
          }</a>
          <a href="/playlists" data-link${activeClass('/playlists')}>Playlists${
            shared ? ` <span class="badge">${shared}</span>` : ''
          }</a>
          <a href="/notifications" data-link${activeClass('/notifications')}>Alerts${
            unread ? ` <span class="badge">${unread}</span>` : ''
          }</a>
        </nav>
        <span class="spacer"></span>
        <span class="stat">${me?.librarySongs ?? 0} songs</span>
        <label class="switcher">
          <span class="sr">acting as</span>
          <select id="user-switch"${usersSeen ? '' : ' disabled'}>
            ${users
              .map(
                (u) =>
                  `<option value="${u.id}"${u.id === state.userId ? ' selected' : ''}>${esc(
                    u.display_name || u.username,
                  )}</option>`,
              )
              .join('')}
          </select>
        </label>
      </header>
      <main id="page"></main>
      ${
        pending
          ? `<div class="toast" role="status">${pending} scan${
              pending === 1 ? '' : 's'
            } waiting — <a href="/imports" data-link>open</a></div>`
          : ''
      }
    </div>`;
}

function render() {
  const active = document.activeElement;
  const focusId = active?.id || null;
  const caret = active && 'selectionStart' in active ? active.selectionStart : null;

  const path = location.pathname;
  document.title = titleFor(path);
  app.innerHTML = shellHtml();

  const usersRes = getResource('/api/library/users');
  if (usersRes.data) usersSeen = true;
  const pageEl = app.querySelector('#page');
  if (!usersSeen) {
    if (usersRes.error) {
      pageEl.innerHTML = `<p class="load-err" role="alert">could not load the user list: ${esc(
        usersRes.error,
      )} <button id="retry-users" class="ghost">retry</button></p>`;
      pageEl.querySelector('#retry-users')?.addEventListener('click', () => refresh());
    } else {
      pageEl.innerHTML = loaderHtml('loading the app…');
    }
  } else {
    pageFor(path)(pageEl, path);
  }

  app.querySelector('#user-switch')?.addEventListener('change', (event) => {
    switchUser(Number(event.target.value));
  });

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (caret != null && typeof el.setSelectionRange === 'function') {
        try {
          el.setSelectionRange(caret, caret);
        } catch {
          /* not a text input */
        }
      }
    }
  }
}

setRenderer(render);
setNavigateHandler(render);
installLinkHandler();

render();
