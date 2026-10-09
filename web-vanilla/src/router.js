/** A tiny history-API router; Surge's 200.html fallback serves deep links. */
import { esc } from './ui.js';

let onNavigate = () => {};

export function setNavigateHandler(fn) {
  onNavigate = fn;
}

export function navigate(path, { replace = false } = {}) {
  if (path !== location.pathname + location.search) {
    history[replace ? 'replaceState' : 'pushState']({}, '', path);
  }
  onNavigate();
}

export function link(href, text, cls = '') {
  return `<a href="${esc(href)}" data-link${cls ? ` class="${esc(cls)}"` : ''}>${esc(text)}</a>`;
}

export function installLinkHandler() {
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[data-link]');
    if (!anchor) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || anchor.target === '_blank') return;
    event.preventDefault();
    navigate(anchor.getAttribute('href'));
  });
  window.addEventListener('popstate', () => onNavigate());
}
