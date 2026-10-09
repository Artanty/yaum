/** The current user, in localStorage, with no login (the backend trusts x-user-id). */
const STORAGE_KEY = 'plst.userId';
// Renamed with the app; read the old key so an existing browser keeps its user.
const LEGACY_KEY = 'yaum.userId';
const DEFAULT_USER_ID = 1;

export function readUserId() {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_USER_ID;
}

export function writeUserId(id) {
  localStorage.setItem(STORAGE_KEY, String(id));
}
