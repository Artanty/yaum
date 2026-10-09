/**
 * App state + a tiny resource cache. `getResource` is the `httpResource` analogue: it fetches on
 * first use, caches per (url, user, version), and asks the renderer to redraw when it settles.
 * `refresh()` clears the cache and bumps the version, which is what every mutation calls.
 */
import { apiFetch, errorText } from './api.js';
import { readUserId, writeUserId } from './session.js';

export const state = {
  userId: readUserId(),
  version: 0,
};

const cache = new Map();
let renderer = () => {};

export function setRenderer(fn) {
  renderer = fn;
}

export function rerender() {
  renderer();
}

export function refresh() {
  cache.clear();
  state.version += 1;
  renderer();
}

export function getResource(path, userId = state.userId) {
  if (!path) return { data: null, error: null, loading: false };
  const key = `${path}\u0000${userId}\u0000${state.version}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = { data: null, error: null, loading: true };
    cache.set(key, entry);
    apiFetch(path, { userId }).then(
      (data) => {
        entry.data = data;
        entry.error = null;
        entry.loading = false;
        renderer();
      },
      (err) => {
        entry.error = errorText(err);
        entry.loading = false;
        renderer();
      },
    );
  }
  return entry;
}

export function switchUser(id) {
  if (!Number.isInteger(id) || id <= 0) return;
  state.userId = id;
  writeUserId(id);
  refresh();
}
