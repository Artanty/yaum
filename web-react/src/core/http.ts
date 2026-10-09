/**
 * The fetch wrapper: every request the app makes goes through here, and the `x-user-id` header is
 * attached inside it for `/api/library/*` paths — the equivalent of Angular's interceptor, and
 * testable the same way (call it, assert on what reached `fetch`).
 *
 * A header, not a cookie, so there is no CSRF surface to reason about while auth is still a
 * dropdown — and the extension sends the identical header, so the browser and the scanner share
 * one server-side code path.
 */

const LIBRARY_PREFIX = '/api/library';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly body: string,
  ) {
    super(body || `${status} ${statusText}`);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Current user; required for library calls, ignored for everything else. */
  userId?: number;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (path.startsWith(LIBRARY_PREFIX) && options.userId !== undefined) {
    headers['x-user-id'] = String(options.userId);
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (err) {
    // fetch() only rejects on network-level failures — the "server is not running" case.
    throw new ApiError(0, '', err instanceof Error ? err.message : String(err));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(response.status, response.statusText, body);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Turns the backend's plain-text 4xx bodies into something worth putting in the UI. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'cannot reach the plst server — is `npm start` running in back/?';
    return err.body.trim() || `${err.status} ${err.statusText}`;
  }
  return err instanceof Error ? err.message : String(err);
}
