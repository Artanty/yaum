/**
 * The fetch wrapper: every request goes through here, and `x-user-id` is attached only for
 * `/api/library/*` — the same rule the Angular interceptor and the React `apiFetch` used.
 */
const LIBRARY_PREFIX = '/api/library';

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
    response = await fetch(path, {
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

/** Turns the backend's plain-text 4xx bodies into something worth putting in the UI. */
export function errorText(err) {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'cannot reach the plst server — is `npm start` running in back/?';
    return err.body.trim() || `${err.status} ${err.statusText}`;
  }
  return err instanceof Error ? err.message : String(err);
}
