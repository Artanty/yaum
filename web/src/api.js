/**
 * The fetch wrapper: every request goes through here, and `x-user-id` is attached only for
 * `/api/library/*` — the same rule the Angular interceptor and the React `apiFetch` used.
 * The URL is prefixed with `API_BASE` so the app can live on a static host (Surge) and still
 * talk to the backend on another origin.
 */
import { API_BASE } from './config.js';

const LIBRARY_PREFIX = '/api/library';

/**
 * Make a configured base into a real absolute URL (or '' for same-origin).
 * `fetch('localhost:3218/api/…')` is a *path*, not a host — the browser resolves it against the
 * page origin and every request silently lands on the wrong URL (seen live as
 * `http://localhost:8000/localhost:3218/api/…`). Normalize the two likely typos instead of
 * letting that happen: scheme-less base gets `http://`, and `http:foo` gets its missing `//`.
 */
export function normalizeBase(base) {
  const value = String(base ?? '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '');
  if (/^https?:/i.test(value)) return `${value.slice(0, value.indexOf(':') + 1)}//${value.slice(value.indexOf(':') + 1)}`;
  return `http://${value}`.replace(/\/+$/, '');
}

const BASE = normalizeBase(API_BASE);

export class ApiError extends Error {
  constructor(status, statusText, body) {
    super(body || `${status} ${statusText}`);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export async function apiFetch(path, { method, body, userId } = {}) {
  const headers = {};
  if (path.startsWith(LIBRARY_PREFIX) && userId !== undefined) {
    headers['x-user-id'] = String(userId);
  }
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: method ?? 'GET',
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // fetch() only rejects on network-level failures — the "server is not running" case.
    throw new ApiError(0, '', err instanceof Error ? err.message : String(err));
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ApiError(response.status, response.statusText, text);
  }

  if (response.status === 204) return undefined;
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

/**
 * Turns the backend's plain-text 4xx bodies into something worth putting in the UI.
 * A body that looks like an HTML page is never shown: static hosts (Surge) answer missing
 * paths with their own branded 404 page, and dumping that markup into the app was the
 * "could not load the library: <!DOCTYPE html>…" bug. Long bodies are truncated too.
 */
export function errorText(err) {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'cannot reach the plst server — is `npm start` running in back/?';
    const body = (err.body || '').trim();
    if (/^<(!doctype|html)/i.test(body)) {
      return `${err.status} ${err.statusText}: got an HTML page instead of JSON — is API_BASE (src/config.js) pointing at the backend?`;
    }
    if (!body) return `${err.status} ${err.statusText}`;
    return body.length > 300 ? `${body.slice(0, 300)}…` : body;
  }
  return err instanceof Error ? err.message : String(err);
}
