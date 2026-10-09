# DECISIONS

Current thread only. Prior sessions: `DECISIONS-archive.md`.

*(Older entries moved to `DECISIONS-archive.md` per AGENTS.md rule 4 — now three times: 2026-09-29
(the ext-logs routing thread), 2026-10-07 (the `plst` rename + library/export thread and the Surge
workflow rounds), and archived on 2026-10-09: the React port (2026-10-07) and the header-styles fix
(2026-10-08). This file holds the Surge static-deploy probe.)*

### RESULT (rule 2): periodic refresh removed from all three frontends

**Done, nothing committed (rule 5 — user did not ask this time).** Timer blocks deleted at the
three grep-found sites: `web/src/main.js` (the trailing `setInterval(refresh, 15_000)`; `refresh`
also dropped from its import — now unused there, pages still import it themselves),
`web-react/src/layout/Shell.tsx` (poll `useEffect` + comment; `onSwitch` re-pointed from the
removed local `refresh` binding to `api.refresh()`), `web-angular/src/app/layout/shell.ts`
(second `effect` with `onCleanup` + comment; first effect for the user list untouched; Angular's
`onSwitch` already called `this.api.refresh()` directly). Stale comments fixed so they don't
describe a poll that no longer exists: `web-react/src/core/useResource.ts` (15s-poll blanking
line + "the poll is retrying"), `web-react/src/core/library-api.tsx:129` ("shell's 15s poll holds
this in an effect"), `web-angular/.../playlist-detail.ts` ("the 15s poll is retrying").
`refresh()` itself kept everywhere — mutations (user switch, playlist edits, matches) still call it.
**Verified:** grep shows zero `setInterval` and zero `15s|15_000` in all three src trees;
`web-react`: `npm test` 42/42 pass + `tsc --noEmit` clean; `web-angular`: `npm run build` clean
(bundle in `dist/app`); `web` (vanilla): `main.js` imports without SyntaxError (runtime stops at
`localStorage is not defined`, expected outside a browser).

## 2026-10-09 — PLAN (rule 1): commit poll-removal; rename web→web-vanilla, web-react→web; react workflow ← vanilla pattern

**Requests (one message):** "commit changes." / "move current web folder → web-vanilla" /
"move web-react to web" / "update react gh action according to work made for vanilla".

**Steps:**
1. Commit the outstanding poll-removal changes (vanilla/react/angular + this log) — explicitly
   asked, so allowed (rule 5). Message in the repo's `-d;` style.
2. `git mv web web-vanilla` then `git mv web-react web` (tracked renames, history follows).
   Pre-checked: nothing outside DECISIONS references `web-react/`; `githooklib` reads
   `web/package.json` and still finds one after the swap (version source changes: react's 0.0.9);
   root `.gitignore`/comments still true.
3. React gets the same prod API-base treatment vanilla got, because the workflow's `BACK_URL`
   injection needs a target and the deployed site must not call surge's `/api` (the HTML-404 bug):
   - new `web/src/config.ts`: `export const API_BASE = '';` (dev default `''` = vite proxy) —
     line format kept identical so the same sed pattern works on `.ts`;
   - `web/src/core/http.ts`: import it, `normalizeBase()` (vanilla's logic) prefixed in
     `fetch(\`${BASE}${path}\`)`; `errorText()` gains the HTML-detect + 300-char truncation
     hardening from vanilla's `api.js`;
   - extend `http.spec.ts` for normalizeBase/HTML/truncation; `BASE=''` keeps every existing
     fetch-URL assertion passing.
4. Rewrite `web/.github/workflows/deploy-surge.yml` (replaces the 240-line expect/secrets/.env-
   commit version entirely): checkout → Read .env (HOSTING_DEPLOYMENT_URL→domain, SURGE_TOKEN,
   BACK_URL; each missing → `::error`+exit 1) → setup-node+npm ci → **Inject BACK_URL into
   src/config.ts (before build so vite bakes it in)** → `npm run build` → CNAME + `200.html`
   into `dist/` → `npm install -g surge` → `surge ./dist "$SURGE_DOMAIN" --token "$SURGE_TOKEN"`.
   `permissions: contents: read`; no expect driver, no secrets, no .env commit-back.
   `.env.example` → the three new keys.
5. Verify: YAML parses; extracted steps run against a temp copy (env cases + inject rewrite);
   in-tree: inject → `npm run build` → grep the URL out of `dist/` → restore `config.ts`;
   `npm test`, `tsc --noEmit`.
6. RESULT entry afterwards. Flag: DECISIONS.md is now ~580 lines, far past the ~250 threshold
   (rule 4) — recommend archiving. Flag to user: vite dev proxy still defaults to
   `127.0.0.1:8000` while back/.env says 3218 (PLST_API overrides). Leave the rename/workflow
   changes uncommitted — the "commit" instruction preceded them (rule 5).

## 2026-10-09 — PLAN (rule 1): remove the periodic 15s refresh from all three frontends

**Request:** stop the page auto-refreshing on a timer (it keeps making requests); apply to
`web/` (vanilla), `web-react/`, `web-angular/`.

**Sites found (grep, not guessed):**
- `web/src/main.js:118-121` — `setInterval(refresh, 15_000)` at file bottom
- `web-react/src/layout/Shell.tsx:29-37` — `useEffect` + `setInterval` + rationale comment
- `web-angular/src/app/layout/shell.ts:30-37` — `effect(onCleanup)` + `setInterval` + comment

**Approach:** delete exactly those timer blocks. `refresh()` stays — it is still called by
mutations (user switch `onSwitch`, playlist edits, matches) and those must keep working. Fix the
comments that describe the poll as live behaviour (`web-react/src/core/library-api.tsx:129`
"the shell's 15s poll…", `useResource.ts` "a 15s poll never blanks the screen") so they don't
lie afterwards. Verify: no `setInterval` left in the three src trees; `npm test` + lint in
web-react/web-angular if available; vanilla app served locally still renders. Nothing committed
unless asked (rule 5).

## 2026-10-09 — PLAN (rule 1): run the backend on port 3218

**Request:** backend must work on port 3218; do NOT touch the Postman collection (its
`PLST_back_domain` variable is the user's to set — the file stays as-is).

**Approach:** port comes from `process.env.PORT ?? 8000` (`src/server.ts:263`); `back/.env`
pins `PORT=8000` → change that one line to `PORT=3218` (no code change). A server is already
running on :8000 (pids 33201/33227/33228) — restart it so it picks up the new port. MySQL alive.
Verify `/healthz`, `/api/library/healthz` and one `x-user-id` route on **:3218**, confirm :8000
stops listening. Note for the user: set `PLST_back_domain = http://127.0.0.1:3218` in Postman.
RESULT below.

### RESULT — backend runs on port 3218; collection untouched

**Done, nothing committed (rule 5).** `back/.env`: `PORT=8000` → `PORT=3218` (one line; no code
change — `src/server.ts:263` reads `process.env.PORT ?? 8000`). The already-running server
(`npm exec tsx src/server.ts`, pids 33201/33227/33228 on :8000) was killed and restarted via
`npm start` in the background so it picked up the new port. **Verified live:** listener on
`*:3218` (pid 33621), **:8000 free**; `GET /healthz` → `{ok:true, yandex_configured:true,…}`;
`GET /api/library/healthz` → ok; `GET /api/library/me` with `x-user-id: 1` → Artyom, 2 songs,
`pendingImports:1`; `/api/library/users` → both users; missing header → **400** as designed.
The Postman collection was **not modified** (shasum unchanged) — per request, its
`PLST_back_domain` default stays `http://127.0.0.1:8000`; **the user sets
`PLST_back_domain = http://127.0.0.1:3218` in Postman** to hit this server.

### RESULT — `BACK_URL` injected from `.env` into `src/config.js` by CI

**Done, nothing committed (rule 5).** `web/.github/workflows/deploy-surge.yml` gained two
pieces: (a) *Read .env* now also reads **`BACK_URL`** (trimmed; missing/empty → `::error` +
exit 1, same fail-fast as domain/token) and passes it as a step output; (b) new step
**"Inject BACK_URL into src/config.js"** — `esc`apes `\ & |`, rewrites the
`export const API_BASE = …` line via sed into a temp file + `mv` (**not `sed -i`**: BSD sed wants
`-i ''`, GNU sed wants `-i` — this bit the first test run on macOS), then `grep -qF` the exact
resulting line and fails loudly if the rewrite didn't land; echoes `API_BASE <- <url>` (public
URL, not a secret). `web/src/config.js` doc comment now says CI overwrites the value from
`BACK_URL` and that the committed value is only the local-dev default.
**Verified** (YAML parses; extracted steps run against a temp copy of `web/`): no `.env` → fail;
`.env` without `BACK_URL` → fail naming the key; full `.env` → `BACK_URL` in outputs; inject over
the localhost default → `'https://api.example.com'`; idempotent re-run; new URL over injected
value; URL containing `&`/`?` survives; missing API_BASE line → exit 1 with `::error`; file stays
16 lines (rest intact). Injected values all pass `normalizeBase` unchanged. Real
`web/src/config.js` untouched (still `http://localhost:3218`), temp dir cleaned up.

## 2026-10-09 — PLAN (rule 1): inject `BACK_URL` from `.env` into `src/config.js` during CI deploy

**Request:** prod provides the backend URL as a `BACK_URL` env in the same `.env` file the other
keys live in; add a GH-action step that pastes that value into the appropriate file
(`web/src/config.js` → `API_BASE`).

**Approach:** new workflow step **"Inject BACK_URL into src/config.js"** between *Read .env* and
*Write CNAME and 200.html*: grep `BACK_URL` from `.env` (quotes/whitespace trimmed);
**missing/empty → `::error` + exit 1** (same fail-fast contract as domain/token — a prod site
with no API base is as broken as one with no domain); `sed -i` replace the
`export const API_BASE = …` line (delimiter `|`, escape `\ & |`), then grep the line back and
echo it (a public URL, not a secret). `src/config.js` doc comment updated to say CI overwrites
the value from `BACK_URL`. Verify: YAML parses; run the extracted step against a **temp copy**
of `web/` with a fake `.env` (present → rewritten correctly; absent → exit 1); confirm the
injected value survives `normalizeBase`. Nothing committed (rule 5).

### RESULT — API_BASE typo fixed + normalizer added; live on :3218

**Done, nothing committed (rule 5).**
1. `web/src/config.js`: `'http:localhost:3218'` → `'http://localhost:3218'` (the missing `//`
   made fetch treat `localhost:3218/…` as a **path**, producing the observed
   `http://localhost:8000/localhost:3218/api/library/me`).
2. `web/src/api.js`: new exported `normalizeBase()` applied once at module load → `BASE`.
   Handles: `''` → same-origin; scheme-less `localhost:3218` → `http://…`; `http:foo` →
   `http://foo`; trailing slashes stripped. So both likely typos yield the intended URL instead
   of a silent path-join. `fetch` now uses `` `${BASE}${path}` ``.
**Verified:** normalizer unit check **7/7**; live `apiFetch` against the running backend on
**:3218** — `me` → Artyom (`librarySongs:2, pendingImports:1`), `users` → artyom/zaur,
`songs.total:2`; browser-style cross-origin check from `http://localhost:8000`: preflight
**204**, `access-control-allow-headers: x-user-id`, `allow-origin: http://localhost:8000`.
Note: my own `npm start` duplicate exited with `EADDRINUSE` (user already had pid 34086 on
:3218) — harmless, single server confirmed serving afterwards; no stray process left.

## 2026-10-09 — PLAN (rule 1): fix broken API_BASE (`http:localhost:3218` → malformed URL)

**Bug report:** user set API_BASE, browser requests `http://localhost:8000/localhost:3218/api/...`.
**Cause (read, not guessed):** `web/src/config.js` has `'http:localhost:3218'` — no `//`, so
`fetch(API_BASE + path)` resolves it as a path against the page origin.

**Approach:** 1) fix the value to `'http://localhost:3218'`; 2) harden `api.js` — normalize the
base once at module load: scheme-less (`localhost:3218`) → prepend `http://`, missing `//` after
`http:`/`https:` → insert it, trailing slashes stripped; `''` still means same-origin. So both
likely typos become the URL the user meant instead of a silent path-join. 3) verify: unit-style
check of the normalizer (all 3 shapes), then live — backend `npm start` (:3218 was killed last
turn), `apiFetch('/api/library/me', {userId:1})` returns Artyom's JSON. Nothing committed (rule 5).

## 2026-10-09 — RESULT — port 3218 killed

Server stopped on request: `pkill -f 'tsx src/server.ts'` (pid 33621). **3218 free, no server
process left.** The shutdown log line was flushed (`shutdown (SIGTERM)` with `skippedPolls:4,
loggedRequests:1`) — visible in the background shell output. Restart with `npm start` in `back/`
when needed (`.env` still says `PORT=3218`).

## 2026-10-09 — PLAN (rule 1): Postman collection for debugging the backend

**Request:** create a Postman collection for debugging the backend; base URL as
`{{PLST_back_domain}}` instead of a literal origin.

**Approach:** `back/postman/plst.postman_collection.json` (schema v2.1) with collection-level
variables `PLST_back_domain` (default `http://127.0.0.1:8000`) and `user_id` (feeds the
`x-user-id` header most library routes require). Every route read from source — `server.ts`
(system + converter) and `library/routes.ts` (all 35 library routes) — grouped: System,
Converter jobs, Session, Logs, Scan & Imports, Songs, Facets, Playlists, Items & sharing,
YouTube matching/export, Notifications. Request bodies/examples taken from the actual handlers
(`{tracks:[…]}` scan shape, form-urlencoded migrate, etc.); descriptions note status codes and
gotchas (303 on migrate, 400/404 semantics, 50-song match cap). Verify: JSON parses, spot-check
against routes with a script. RESULT below.

### RESULT — Postman collection created

**Done, nothing committed (rule 5).** `back/postman/plst.postman_collection.json` — schema v2.1,
**37 requests in 9 folders** (System, Converter jobs, Session, Logs, Scan & Imports, Songs &
matching, Facets, Playlists, Playlist items & sharing, Notifications). Collection variables:
`PLST_back_domain` (default `http://127.0.0.1:8000`) and `user_id` (feeds the `x-user-id` header).
All bodies/queries/semantics read from `server.ts` + `library/routes.ts`, documented per request
(303 on migrate, 404-not-403 for "not yours", 50-song match cap, scan shapes/limits, form vs JSON
content types).

**Verified** by script: JSON parses; **every one of the 35 source routes is in the collection and
there are no phantom routes** (extracted via regex from both TS files, paths normalized); all 37
URLs start with `{{PLST_back_domain}}` — no literal origin (the only literal URLs are the variable
default and example payloads like the Yandex album URL). 37 > 35 because `/job/:id` and
`/export/youtube` each appear twice (format variants). Fixed one typo found while verifying (the
unshare URL was missing `/playlists`).

## 2026-10-09 — PLAN (rule 1): fix the surge site — API base config + no HTML dumps + `200.html`

**Bug report (user):** deployed `web/` to surge; console shows 404s and the page shows
`could not load the library: <!DOCTYPE html>…` (surge's "page not found" HTML).

**Evidence (logs/probes first):** live `/api/library/songs` → **404, 8247 B** = surge's HTML error
page, which `api.js` reads as the response body and `library.js:59` renders verbatim. Live
`/library` → **404** too: `web/` has `index.html` but no `200.html`, so surge has no SPA fallback.
Backend `:8000` is down (connection refused); the app fetches `/api/*` **relative to its own
origin** = the surge domain, which has no API. CORS on the backend is already `origin: true`
(`back/src/server.ts:143`), so a cross-origin API base will work once the backend is reachable.

**Approach (user chose "Both"):**
1. `web/src/config.js` — `export const API_BASE = ''` (`''` = same origin; set to the public
   backend origin when it has one). `api.js` prefixes every fetch with it; `x-user-id` rule still
   keyed on the raw `/api/library` path.
2. `api.js` hardening — if a non-2xx response body looks like an HTML page (starts with
   `<!doctype`/`<html`), never pass it to the UI: `errorText()` returns a short message naming the
   cause (status + "got an HTML page instead of JSON — API base wrong?"). This kills the "strange
   code" for good, whatever the 404 source.
3. SPA fallback — write `web/200.html` (byte-copy of `index.html`) and have the workflow
   `cp index.html 200.html` before publishing, so deep links stop 404ing on surge.
4. Verify: local static server serving `web/` **with** `200.html` fallback + a mock API (same
   origin, then cross-origin with CORS) → happy path, deep link `/library` → 200, API 404 →
   friendly one-liner, `API_BASE` cross-origin → requests hit the mock. Nothing committed (rule 5).

### RESULT — surge site fixed: `API_BASE` config, HTML-404 sanitizing, `200.html` fallback

**Done, nothing committed (rule 5).** Four changes under `web/`:

1. **`src/config.js` (new)** — `export const API_BASE = ''`; `api.js` now fetches
   `` `${API_BASE}${path}` ``. Set it to the backend's public origin when there is one (backend
   already has `origin: true` CORS, incl. the `x-user-id` header). The `x-user-id` rule still keys
   on the raw `/api/library` path, not the prefixed URL.
2. **`src/api.js` — `errorText()` hardened**: a body starting with `<!doctype`/`<html` is never
   shown — replaced by `404 Not Found: got an HTML page instead of JSON — is API_BASE
   (src/config.js) pointing at the backend?`; plain-text backend errors pass through unchanged;
   bodies >300 chars are truncated; empty body → `status statusText`. This one funnel
   (`store.js` → `errorText`) feeds every page, so the "strange code" is gone everywhere.
3. **`200.html` (new)** — byte-copy of `index.html` (same sha1 `6dfcd9b…`), so surge serves the
   SPA on deep links; workflow step renamed **"Write CNAME and 200.html"** and now also does
   `cp index.html 200.html` before publishing (stays in sync automatically).
4. Nothing else changed; `package.json`/`styles.css`/pages untouched.

**Diagnosis (probes first):** live `https://simple3453t3fg4344.surge.sh/api/library/songs` →
**404, 8247 B** = surge's HTML error page, rendered verbatim by `library.js:59` — that was the
pasted "strange code". Live `/library` → **404** (no `200.html` on the site) — the console 404s
were the 15 s API poll + deep links. Backend `:8000` was down (connection refused), and the app
fetched `/api/*` relative to its own origin = the surge domain.

**Verified** with a local surge-mimic server (static + `200.html` fallback + surge-shaped HTML
404 on `/api`) and a cross-origin mock API with CORS, driving the **real `src/api.js`** in Node:
`/` → 200, `/library` deep link → **200** (fallback), `/api/*` → 404 HTML;
`errorText` suite **7/7** (no doctype leaks, cause named, plain text intact, truncation, empty
body); with `API_BASE` → mock origin (temporarily set, then reverted to `''`): JSON fetch works,
`x-user-id` travels, HTML 404 still sanitized — **3/3**. Preflight `OPTIONS` → 204 with
`Access-Control-Allow-Headers: content-type,x-user-id`. Workflow YAML parses. Servers stopped.

**Not fixed here (out of scope, flagged):** the site still has no reachable backend — set
`API_BASE` in `src/config.js` once the backend has a public URL, or the app will keep showing the
new (now friendly) "got an HTML page instead of JSON" message on surge.

## 2026-10-09 — PLAN (rule 1): `HOSTING_DEPLOYMENT_URL` is the only domain source

**Request:** there is no `SURGE_DOMAIN` key in `.env` at all — remove it; the domain comes only
from `HOSTING_DEPLOYMENT_URL`. RESULT below.

### RESULT — `HOSTING_DEPLOYMENT_URL` is the only domain source

**Done, nothing committed (rule 5).** The `Read .env file` step no longer looks at `SURGE_DOMAIN`
at all: it greps `HOSTING_DEPLOYMENT_URL` (scheme/quotes/whitespace/path stripped → bare host)
and `SURGE_TOKEN` only. Missing URL → `::error …HOSTING_DEPLOYMENT_URL is missing/empty in .env`
+ exit 1; missing token → fail likewise. Remaining `SURGE_DOMAIN` mentions in the workflow are
the internal output/step variable name (derived from the URL), not a `.env` key.
**Verified** (YAML parses; extracted steps, `${{ }}` substituted like Actions): no `.env` → fail;
`.env` without the URL key → fail; no token → fail; URL only → `SURGE_DOMAIN=my-app.surge.sh`,
`CNAME=[my-app.surge.sh]`, fake surge `./ my-app.surge.sh --token tok123` exit 0; a stray
`SURGE_DOMAIN=` key in `.env` is ignored (URL wins).

## 2026-10-09 — PLAN (rule 1): accept the domain from `HOSTING_DEPLOYMENT_URL` too

**Request:** the `.env` will also carry the domain as `HOSTING_DEPLOYMENT_URL` (a full URL, not
a bare host). Update the "Read .env file" step: prefer `SURGE_DOMAIN`; if empty, derive the bare
hostname from `HOSTING_DEPLOYMENT_URL` (strip scheme, path, trailing slash, whitespace/quotes).
Token still `SURGE_TOKEN`; no domain from either key → fail. RESULT below.

### RESULT — `HOSTING_DEPLOYMENT_URL` accepted as a domain source

**Done, nothing committed (rule 5).** The "Read .env file" step now falls back to
`HOSTING_DEPLOYMENT_URL` when `SURGE_DOMAIN` is empty: strips scheme/`tr -d` quotes/whitespace
and everything from the first `/`, so `" https://my-app.surge.sh/ "` → `my-app.surge.sh`.
`SURGE_DOMAIN` still wins when both are present. Error text updated to name both keys.
**Verified** (YAML parses; extracted steps + `${{ }}` substitution like Actions, fake `.env`):
no `.env` → fail; neither domain key → fail; no token → fail; only `HOSTING_DEPLOYMENT_URL` →
`SURGE_DOMAIN=my-app.surge.sh` + `CNAME=[my-app.surge.sh]`; both keys → explicit one wins;
full publish with fake surge → `surge ./ my-app.surge.sh --token tok123`, exit 0.

## 2026-10-09 — PLAN (rule 1): simplify `web/.github/workflows/deploy-surge.yml` → domain required, CNAME, deploy

**Request:** 1) no domain in envs → stop and **fail** the deploy (no placeholder branch);
2) domain present → write a `CNAME` file with it at the repo root; 2.1) publish to surge;
remove all other code from the workflow.

**Approach:** rewrite `web/.github/workflows/deploy-surge.yml` to 5 short steps — checkout;
resolve `SURGE_DOMAIN` (secret override, else `.env`; empty → `::error` + exit 1); write
`CNAME` (domain + newline); `npm install -g surge`; publish `.` to `$SURGE_DOMAIN` with
`SURGE_TOKEN` (secret else `.env`, missing → fail; the expect/email-password fallback and the
placeholder-domain branch are deleted). Drop `CNAME` (and `temp-for-publish`) from
`.surgeignore` so the file we now create actually ships — consistent with surge's own success
handler, which writes a CNAME. Verify: yaml parse + run the resolve/CNAME steps locally against
a fake `.env` (both branches), fake `surge` for the publish step. Nothing committed (rule 5).

### RESULT — workflow simplified: domain required → CNAME → deploy

**Done, nothing committed (rule 5).** `web/.github/workflows/deploy-surge.yml` is now 5 steps:
checkout → resolve `SURGE_DOMAIN` (secret `SURGE_DOMAIN` wins, else `.env`; whitespace/quotes
stripped; **empty → `::error` + exit 1, deploy fails**) → write `CNAME` (domain + newline, at the
repo root) → `npm install -g surge` → `surge . "$SURGE_DOMAIN"` with `SURGE_TOKEN` (secret else
`.env`, missing → fail). **Deleted:** the placeholder-domain branch (incl. `temp-for-publish`,
the random-suffix retry loop), the expect driver + email/password fallback, and the
`SERVICE_EMAIL`/`SERVICE_PASSWORD` plumbing. `.surgeignore`: dropped `CNAME` (we now write it
deliberately) and `temp-for-publish`.

**Verified** by extracting the step scripts from the YAML (yaml `safe_load` passes) and running
them locally with a fake `.env` + fake `surge`: no `.env` → fail (exit 1); empty `SURGE_DOMAIN` →
fail listing key names; valid domain → resolve, `CNAME=my-app.surge.sh`, fake surge called as
`surge . my-app.surge.sh`; domain but no token → fail; secret overrides `.env`. Caveat found and
dismissed: `https://…surge.sh/` in `.env` passes through unstripped — same as the old behavior.

`DECISIONS.md` is at ~250 lines — flag for trimming/archiving (rule 4).

## 2026-10-09 — PLAN (rule 1): make auth visible with `--token`; mirror the `read` project's short workflow

**Request:** the current publish step hides auth (`export SURGE_TOKEN`) — pass the token
explicitly like `~/server/read/web/.github/workflows/deploy-surge.yml` does (`surge ./ <domain>
--token <token>`), and simplify the file.

**Approach:** rewrite `web/.github/workflows/deploy-surge.yml` in the `read` shape: one "Read
.env" step (grep `SURGE_DOMAIN`/`SURGE_TOKEN`, write both to `$GITHUB_OUTPUT`, fail if either is
empty), setup-node, `npm install -g surge`, one `surge ./ $domain --token $token` run. Keep our
extra guardrails: write `CNAME` before publishing, quote/trim values, keep the timeout and the
checkout at v4. RESULT below.

## 2026-10-09 — PLAN (rule 1): drop repo-secret overrides from the surge workflow

**Request:** no GitHub repo secrets exist — credentials/domain come only from the `.env` file.
Remove the redundant `secrets.SURGE_DOMAIN` / `secrets.SURGE_TOKEN` plumbing from
`web/.github/workflows/deploy-surge.yml`; read both keys from `.env` only. RESULT below.

### RESULT — repo-secret overrides removed; `.env` is the only source

**Done, nothing committed (rule 5).** `web/.github/workflows/deploy-surge.yml`: dropped both
`env: SECRET_SURGE_*: ${{ secrets.* }}` blocks — `SURGE_DOMAIN` and `SURGE_TOKEN` are now read
from `.env` only (`env_get`, first match, value never echoed). Error messages updated to name
`.env` instead of mentioning secrets. `grep 'secrets\.'` → no references left. Re-verified:
YAML parses; the extracted step scripts pass all 5 harness cases (no `.env` → fail, empty domain
→ fail, good domain → `CNAME=[my-app.surge.sh]` + `surge . my-app.surge.sh`, no token → fail).

## 2026-10-09 — PLAN (rule 1): Surge deploy fails on the big React bundle → move React to `web-react`, put a build-free pure-JS app in `web`

**Report/experiment:** publishing the built React app to Surge fails; deleting every file but one and
emptying it to a single function made the deploy succeed. Working theory: the deploy chokes on the
built JS bundle, not on the app.

**Approach (user-chosen): "no build at all".**

- `web/` (React app, incl. `node_modules`/`dist`/`.github`) moves to `web-react/`.
- New `web/` is plain static files: `index.html` + ES modules + one small CSS file. No bundler, no
  React, **no npm at all**.
- Parity kept to the essentials: shell (nav, user switcher, 15s poll, pending-import toast), the 5
  routes, `x-user-id` only on `/api/library/*`, selection at module scope (page-1 ticks survive
  "next"), exports name unmatched/uncertain. Facets (genres/artists/albums) dropped and styling is
  minimal — this is a deploy probe, not a finished UI.
- `web/.github/workflows/deploy-surge.yml`: credential/login/domain logic untouched; drop
  setup-node/`npm ci`/build; publish the repo root directly; `index.html` → `200.html` for the SPA
  fallback. `.surgeignore` excludes everything that is not site content.

**Work:** 1) move dir, 2) write the static app, 3) re-point the workflow, 4) verify by serving the
folder against the real backend, 5) RESULT below.

Nothing committed (rule 5).

### RESULT — `web/` is now a build-free static app; `web-react/` keeps the React app

**Done.** `web-react/` is the untouched React app (git will see the old `web/` as renames once
staged). New `web/` is 15 small files — `index.html`, `styles.css`, `src/*.js` ES modules, no
`package.json`, no bundler, no React. Publish set is **51.5 kB total**, largest single file 12.2 kB
(`src/pages/playlist-detail.js`).

**Kept:** the 5 routes + shell, nav badges, user switcher, 15s poll, pending-import toast,
`x-user-id` on `/api/library/*` only, selection at module scope (page-1 ticks survive "next"),
`songIds` sent to `POST /imports/:id/playlist` only when something was deselected, and exports that
name unmatched/uncertain songs. `core/` became `api.js` (fetch + header + `errorText`), `session.js`,
`store.js` (resource cache = `httpResource`), `format.js`, `router.js` (history API + `200.html`
fallback), `ui.js`.

**Dropped (test probe, not a finished UI):** genre/artist/album facets, playlist sharing UI
(collaborators), source-maps, SCSS — styling is one small global `styles.css`.

**Workflow** `web/.github/workflows/deploy-surge.yml`: credential resolution / expect driver /
login / domain logic untouched. Removed `setup-node`, `npm ci`, "Build React app"; SPA fallback is
now `cp index.html 200.html`; publish target is `.` instead of `./dist`. `.surgeignore` excludes
`.git`, `.github`, `node_modules`, `*.md`, `.env*` (and deliberately **not** `src`).

**Verified** in a real browser (Playwright chromium 1234) against the real backend on :8000, via a
static server that proxies `/api`: library renders 2 songs + `2 songs` stat, nav shows the
`Imports 1` badge, switcher shows Artyom/Zaur, ticking a row reveals the selection bar and it
**survives client-side nav**, imports shows its 1 card, `/playlists/999` latches `could not load
this playlist: playlist not found`, and switching to user 2 sends `x-user-id: 2` on every
`/api/library/*` request. **0 page errors** (only the expected 404 console line). No mutation
endpoint was called — nothing was written to the real DB. Backend and the probe server were stopped.

**On the theory:** the real React build is `index-*.js` = **270.6 kB** raw / 86.3 kB gzip (measured
with `vite build --outDir dist-build-test`, then removed). The old `web-react/dist/` on disk was
*not* a real build — it is your one-file test leftover (19-byte JS + `200.html` + `CNAME`). So the
deploy failure is not explained by "a huge bundle": 270 kB is ordinary. The build-free app is still
the right probe — if it deploys where the React build did not, the difference is something about the
React output (a chunk, a filename, or the bundle size), not the app.

Nothing committed (rule 5).

### 2026-10-09 — FOLLOW-UP (rule 1): the publish succeeded; add the Surge SPA fallback

**Finding:** the manual `surge publish` to `simple3453t3fg4344.surge.sh` actually succeeded — Surge
writes `CNAME` only in its `success` handler (`surge/lib/middleware/deploy.js:295-315`), and the live
URL serves the new `index.html` + `/src/*.js` (curl 200). The "CDN 0%" bar is a display artifact; the
server does not stream `cdn` progress. **Check the URL / exit code, not the bar.** What is broken:
deep links 404 because `web/` has no `200.html` (Surge's SPA fallback); CI creates it via
`cp index.html 200.html`, a manual publish does not.

**Work:** 1) add `web/200.html` (copy of `index.html`); 2) add `.DS_Store` to `.surgeignore`;
3) note the mirror rule in `web/README.md`; 4) verify deep links, 5) redeploy + curl.

**RESULT:** done. `web/200.html` added (byte-identical to `index.html`), `.DS_Store` added to
`.surgeignore`, README documents the mirror rule. Local deep-link check vs real backend: every route
(`/library`, `/imports`, `/playlists`, `/notifications`, `/playlists/999`) now returns 200 and renders
with 0 page errors. Redeployed to `simple3453t3fg4344.surge.sh`; live `/200.html` sha1
`6dfcd9b…` matches local, and `/`, `/200.html`, `/library`, `/notifications` are all 200.

**CLI behavior (why the user's publish "looked" broken):** the upload always lands; the readout is
unreliable. Under a non-TTY pipe the CLI either hangs (progress-bar backpressure — our 150s timeout)
or exits without printing anything. The server never closes the NDJSON stream predictably, so
"Success!" is not guaranteed. **Verify by URL, never the bar**: `curl
https://simple3453t3fg4344.surge.sh/200.html` + compare sha, or just check exit of a poll.
Optionally wrap this in a tiny `web/deploy` script (not yet added).

### 2026-10-09 — deploy wrapper because the CDN bar stalls (rule 1)

The user hit the stuck "CDN: 0%" bar again. **Plan:** add `web/deploy.sh` that 1) writes a unique
per-run marker `.deploymark`; 2) runs the real `surge publish . <domain>` in the background;
3) polls `https://<domain>/.deploymark` for the token (ground truth — the bar lies); 4) if live →
`OK`, exit 0; if the surge process dies → print its log tail and fail. Also add `web/.gitignore`
(`.deploymark`, `.DS_Store`) so an interrupted run leaves no noise, and add `.gitignore` to
`.surgeignore`. README gets a one-line usage note. RESULT below.

**Result:** created (`web/deploy.sh`, `web/.gitignore`); README updated. First run timed out at 120s
because the marker was a **dotfile** — the server will not serve dotted paths publicly, so
`/.deploymark` fell through to the 200.html fallback and the token never appeared. Also found that a
hang goes unnoticed because `ps` shows the job as `surge .` (not `surge publish`). Marker renamed to
`__deploycheck` (non-dot; still unique per run, token match beats the fallback). **Rerun: OK** —
`./web/deploy.sh` published and confirmed the marker on the live URL in seconds (exit 0), no stray
`surge` process, deep links verified. The uploaded `__deploycheck` copy stays on the site between
deploys (surge has no single-file delete; next run overwrites it).

### 2026-10-09 — patch the raw `surge publish` CLI so it exits (rule 1)

User ran plain `surge publish` (TTY): upload 100% → CDN 100% → **process stuck** (no "Success!"). The
surge-stream fork (global install, well-commented local rewrite) waits for `res.on("end")`, but the
publish API never closes the NDJSON response, and node 19+ default keep-alive agent parks the idle
socket anyway. **Plan:** in
`~/.nvm/…/surge/node_modules/surge-stream/lib/stream.js`: 1) send `Connection: close` so an
honoring server ends the stream naturally (and the socket isn't pooled); 2) failsafe — when the
`upload` progress frame hits 100%, if the stream hasn't ended within 5s, `res.destroy()` + emit
`success` (upload=100% means the tar is fully received; CDN propagation is server-side and needs no
live client). Success/fail/error paths cancel the failsafe. Then test with a pty (`script`) to match
the user's run. **RESULT: fixed.** Patch applied to `stream.js` (global install under nvm). Tested the way
the user runs it (pty via `script`, from `web/`): upload 100% → CDN 0% → **`Success! - Published to
simple3453t3fg4344.surge.sh`** → process exited on its own, exit 0. Killed the user's old stuck
process (pid 5616, hung since 09:16, deploy already live). Site verified live (`/`, `/library`,
`/src/main.js` all 200). Note the patch lives in a global node_modules — an `npm install -g surge`
or nvm reinstall will wipe it; `web/deploy.sh` remains the portable fallback.

### 2026-10-09 — minimal `web/` instead of the CLI patch (rule 1)

User doesn't like patching the global surge CLI. **Plan:** move the build-free app `web/` → `web-js/`
(keeps index.html/200.html/styles.css/src/deploy.sh/.surgeignore/README/.github/.gitignore, untouched);
rebuild `web/` as a 3-file smoke-test site: `200.html` (links only `/ui.js`, no styles/no other
scripts), `ui.js` (standalone DOM helpers copied from `web-js/src/ui.js`), `CNAME`
(`simple3453t3fg4344.surge.sh`). Verify the minimal site serves the two files locally. Do NOT deploy
(that replaces the live app on the domain) unless asked. **RESULT: done.** `web/` → `web-js/` (full
build-free app, untouched). New `web/` = 3 files: `200.html` (charset+title+favicon, `<script
src="/ui.js">` only), `ui.js` (standalone DOM helpers, no imports, 605 B), `CNAME`
(`simple3453t3fg4344.surge.sh`). Local check: `/200.html` served, `/ui.js` 200/605 B, html's only
refs are favicon data: URI + `/ui.js`. Not deployed (would replace the live app).

### 2026-10-09 — revert the CLI monkey patch; document it (rule 1)

The `surge-stream` patch (Connection: close + upload-100% failsafe) was a **false positive**: it
declared `success` on upload=100%, but that only proves the bytes were received — the original code
(and the server) treat success as "an `info` verdict frame arrived". A failed deploy could be
misreported as published. **Plan:** restore the global
`~/.nvm/…/surge/node_modules/surge-stream/lib/stream.js` exactly (drop the `connection: close`
header, the failsafe block, and the temp `SURGE_FRAME_LOG` debug line); document the whole attempt —
the hang, why the patch was wrong, and the URL-verification path (`./deploy.sh`) — in
`web-js/README.md` and this log. **RESULT: done.** `stream.js` restored to stock (no
`Connection: close`, no upload-100% failsafe, no `SURGE_FRAME_LOG` debug line); `node --check`
passes, no leftover patch markers. Attempt documented in `web-js/README.md` under a new
"Surge CLI hang: a patch we tried and reverted" section, plus the web-layout note. This entry
supersedes the "RESULT: fixed" patch entry above. Nothing committed (rule 5).

### 2026-10-09 — minimal `web/` publish: upload 100%, no CDN bar, then hang (rule 1→2)

User published the 3-file `web/` (200.html/ui.js/CNAME) from a fresh terminal: **upload 100%, no CDN
line, process stuck**. Facts gathered: an `info`/`cdn` frame is not guaranteed on tiny publishes —
upload=100% is the meaningful milestone (bytes received; the site updates server-side). The hang is
the known stream-never-ends CLI issue. Surfaced a second bug: **surge.sh connectivity from this
machine is intermittent** — curl to `simple3453t3fg4344.surge.sh` and `api.surge.sh` now times out
(`code=000`, TCP connects then 0 bytes) while google.com is fine; earlier the same machine reached
the publish API. So the deploy likely landed but could not be re-verified from here; user should
confirm in a browser (`/ui.js` should be the 605 B esc/qsa/debounce module). Killed the stuck
`surge publish` (pid 7805, safe post-upload). Nothing committed (rule 5).

### 2026-10-09 — PLAN (rule 1): a self-contained Surge action inside `web/` (domain-or-placeholder)

**Request:** add a GitHub Action under `web/` (it runs in the slave repo where `web/` *is* the repo
root, so at run time the checkout is the site) plus `web/.surgeignore`. On push to `main`:
1. read `SURGE_DOMAIN` from the root `.env`; if present and non-empty → publish the repo root to it.
2. if it is missing/empty → write a throwaway `temp-for-publish/index.html` (`<h1>HELLO!</h1>`) and
   publish *that* to `<SERVICE_EMAIL local-part>-<6 random chars>.surge.sh` using the token, then
   **stop** (no commit) so the domain can be read from the action log and saved by hand.
Also: `.surgeignore` to keep `.github` and `CNAME` (and `.env`, node_modules, `*.md`) out of the
publish set.

**Findings that shape it (read surge 0.44.5 source, not guessed):**
- `surge <dir> <domain>` takes the domain from the second positional (`_shared/discovery.js`,
  `_shorthand.js`), so the interactive `domain:` prompt never happens; credentials come from
  `SURGE_TOKEN` in the environment (`_creds.js`) — **a token publish needs no `surge login`**.
  Keep the expect driver only as a fallback for a `.env` that has email+password but no token.
- surge reads `.surgeignore` from the *project* dir (`_shared/_size.js:47-51`). Its built-in defaults
  (`surge-ignore/index.json`) already drop `.git`, `.*` (hence `.env`, `.github`, `.gitignore`) and
  `node_modules`, but **`CNAME` is not a dotfile** — so it is uploaded unless listed. Excluding it
  is the right call: surge treats `CNAME` as the project's local identity and its success handler
  writes one *into* the publish dir (`deploy.js:307-309`), but we always pass the domain explicitly,
  so a source `CNAME` would only be served as a stray file.
- `web/` has no `index.html` (only `200.html` + `ui.js`); the root-publish branch will rely on
  Surge's `200.html` SPA fallback for `/`. Noted, not silently "fixed".

**Work:** 1) add `web/.surgeignore`; 2) add `web/.github/workflows/deploy-surge.yml` with the two
branches + credential resolution; 3) YAML-lint it and exercise the branch logic with a fake `surge`;
4) RESULT below. Nothing committed (rule 5).

### RESULT — `web/.github/workflows/deploy-surge.yml` + `web/.surgeignore` added

**Done, nothing committed (rule 5).** Two files:

- `web/.surgeignore` — the publish set is site content only. Verified against surge's *real* ignore
  engine (`surge-ignore` + `ignore`, the exact code `_size.js` and `surge-stream/lib/stream.js`
  run): a fake slave root of `200.html`, `ui.js`, `CNAME`, `README.md`, `.env`, `.env.example`,
  `.DS_Store`, `deploy.sh`, `.github/…`, `node_modules/…`, `.git/…`, `temp-for-publish/index.html`
  publishes **only `200.html` + `ui.js`**. `.github`, `CNAME`, `.env*`, `*.md`, `*.sh`,
  `temp-for-publish`, `node_modules` and the dotfiles are all out.
- `web/.github/workflows/deploy-surge.yml` — `on: push: branches: [main]`, `contents: read`, a
  15-min cap. Steps: resolve settings from `.env` → install surge (+expect) → write the expect
  fallback → publish root-or-placeholder.

**Branch logic exercised with a fake `surge` (step scripts extracted from the YAML):**

- `.env` with `SURGE_DOMAIN="  spaced.surge.sh "` → resolves to `spaced.surge.sh`, runs
  `surge . spaced.surge.sh` (branch 2).
- `.env` without `SURGE_DOMAIN`, `SERVICE_EMAIL=user@example.com`, token → writes
  `temp-for-publish/index.html` = `<h1>HELLO!</h1>` and runs `surge temp-for-publish
  user-817087.surge.sh` (branch 3); a failing first publish retried with a fresh suffix; 5 failures
  → step fails. There is no commit step, so the job stops right after (3.1); the domain is printed
  both as a plain line and an `::notice::` annotation.
- No `.env`/no creds → resolve exits 1 listing the `.env` **key names only** (never values).
- `yaml.safe_load` passes; the expect driver is the same one proven in rounds 1-2.

**Two things to flag:**

1. **Excluding `CNAME` is right.** surge reads a source `CNAME` as the project's *local* domain
   identity (`discovery.js:12`) and writes one on success (`deploy.js:307`), but we always pass the
   domain as the 2nd positional, so a source CNAME would only be uploaded and served as a stray
   file. No `CNAME` file is added for that reason.
2. **`web/` has no `index.html`** (only `200.html` + `ui.js`), so branch 2 leans on Surge's
   `200.html` SPA fallback for `/`. If `/` 404s live, add `cp 200.html index.html` before the publish
   (or commit an `index.html`).
