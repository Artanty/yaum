/**
 * Where the API lives.
 *
 * `''` (default) sends `/api/...` requests to the origin serving this page — correct behind a
 * reverse proxy, and for the local `static-server + proxy` setup. A static host like Surge has
 * no `/api`, so set this to the backend's public origin (e.g. `'https://api.example.com'`);
 * the backend already answers cross-origin requests (`origin: true` in `back/src/server.ts`).
 *
 * In CI the deploy workflow overwrites this value with `BACK_URL` from the root `.env`
 * ("Inject BACK_URL into src/config.js" step) — what is committed here is only the local-dev
 * default and is never what ships to prod.
 *
 * `api.js` normalizes the value through `normalizeBase()` (scheme-less or `http:`-without-`//`
 * typos still end up as a proper absolute URL).
 */
export const API_BASE = 'http://localhost:3218';
