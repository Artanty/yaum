/** Minimal DOM helpers. No framework — this app exists to probe the Surge deploy. */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape everything interpolated into an innerHTML template. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** The explicit loader (the twin of web/'s <Loader/>): spinner + label, announced as a status. */
export function loaderHtml(label = 'loading…') {
  return `<p class="loader" role="status"><span class="spinner" aria-hidden="true"></span>${esc(label)}</p>`;
}
