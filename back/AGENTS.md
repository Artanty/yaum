# AGENTS.md

Context for AI agents working in this repository. Read this before making changes.

## What this project is

**mush** — a web service that converts Yandex Music collections (playlist URL, album URL, liked tracks, saved albums, all-playlists) into **YouTube Music links**. There is deliberately **no YouTube Music auth or writes**: output is a per-track match report and a plain list of `https://music.youtube.com/watch?v=<videoId>` links (links work anonymously).

Originally built in Python (FastAPI + yandex-music + ytmusicapi); **fully rewritten to Node.js/TypeScript** in-place — no Python code remains (except historical mention in git-less tree; don't resurrect it).

## Commands

```bash
npm test                 # vitest (19 tests: url, matcher, db, pipeline-with-mocks)
npm run lint             # tsc --noEmit
npm run build            # tsc -> dist/
npm start                # tsx src/server.ts (no build step; HOST/PORT env, default 0.0.0.0:8000)
npm run dev              # tsx src/server.ts
npx tsx src/cli.ts match <yandex-url>   # CLI dry-run, prints link report
```

Not a git repo (no commits/PRs unless the user initializes one).

## File map

```
src/config.ts          env settings (dotenv): tokens, proxies, thresholds, MySQL connection
src/model.ts           TrackMeta / MatchResult / Candidate / Collection + helpers
src/url.ts             Yandex URL parser + modes: playlist|album|liked|saved-albums|all-playlists
src/matcher.ts         normalize/transliterate/queries/WRatio scoring (ported from Python original)
src/db.ts              mysql2 Store: jobs / items / match_cache (MySQL, async API)
src/pipeline.ts        job runner: runJob/runCollection/matchWithSearch/startJob; deps injection via PipelineDeps
src/yandex/client.ts   hand-rolled Yandex HTTP client (undici fetch) + fetchCollections + trackMeta
src/ytmusic/search.ts  ytmusic-api singleton wrapper: searchSongs -> Candidate[], retry + axios timeout setup
src/server.ts          Fastify app (buildApp exported for tests) + startup guard
src/cli.ts             match dry-run CLI
views/*.ejs            3 pages (index/job/jobs) + partials/head.ejs, partials/tail.ejs
scripts/get_yandex_token.mjs  one-time Yandex OAuth Device Flow token fetch (public app creds inside)
test/*.test.ts         vitest suites; DB tests run against local MySQL (brew), one throwaway schema each
```

## Data flow

```
POST /migrate {mode, source} -> startJob() -> store.createJob + fire-and-forget runJob()
runJob: fromForm() -> fetchCollections() [Yandex] -> per collection:
  sequential per track: dedupe by title|artists|duration -> matchWithSearch
    (check match_cache -> for each query in buildQueries(): search via p-queue
     -> matchTrack score; stop early on 'matched'; cache only when videoId found)
  -> write items rows -> summary counts
UI polls GET /job/:id every 3s; ?format=json and ?format=links (text) exports.
```

Match status: `matched` (score ≥ MATCH_ACCEPT 0.75) / `uncertain` (≥ 0.55) / `not_found` / `skipped_dup`. Scoring: `0.6*title WRatio + 0.4*artist WRatio` on normalized strings, `×0.3` penalty when duration differs > max(5s, 10%). Queries include a Cyrillic→Latin transliteration variant.

## Hard-won knowledge (don't rediscover)

### Yandex Music API (raw HTTP)
- Base: `https://api.music.yandex.ru`, responses are `{result}` or `{error:{name,message}}` — **HTTP status is often 200 with an error body**; client throws on `error`.
- **`User-Agent: Yandex-Music-API` is required** for anonymous requests (other UAs get `not-found` errors!). Token requests: `Authorization: OAuth <token>` (yes, `OAuth` prefix, not `AuthToken`).
- Endpoints used: `/users/{uid}/playlists/{kind}`, `/users/{uid}/playlists/list`, `/users/{uid}/likes/tracks`, `/users/{uid}/likes/albums?rich=true`, `/tracks?trackIds=a,b,c&with=pos` (batch ≤50), `/albums/{id}/with-tracks` (hyphen — `with/tracks` 404s).
- Anonymous: public playlists/albums work; likes and private playlists need a token (`ownerOtherwiseUserBindingError` / `playlistIdBindingError` otherwise). `uid="me"` works with token.
- Raw track JSON: `title`, `artists[].name`, `durationMs` (milliseconds), `albums[]`, `realId`. Likes `/likes/tracks` returns only `trackId`s → must batch-fetch `/tracks`.
- Device Flow (token script): `https://oauth.yandex.ru/device/code` + `/token`, public Android app client_id/secret are in `scripts/get_yandex_token.mjs` and `yandex-music` Python lib history.

### YouTube Music side
- `ytmusic-api@5.3.1` (npm, zS1L3NT/ts-npm-ytmusic-api) — **read-only** (search etc., NO playlist writes/OAuth). `initialize({HL, GL})` only; anonymous search.
- Internally uses **axios**: it honours `HTTP(S)_PROXY`/`http_proxy` env vars (set via `applyYtmProxy()`), and **has NO default timeout** → blocked YouTube hangs forever. Fix already in `ytmusic/search.ts`: `axios.defaults.timeout = settings.ytmTimeout` before constructing the client (its `axios.create()` inherits global defaults).
- `searchSongs()` returns `{videoId, name, artist:{name}, duration (seconds|null)}` — mapped to `Candidate{videoId,title,artists,duration}` in `search.ts`.
- **The dev machine for this project cannot reach YouTube** (connections silently drop, curl times out; Yandex is reachable). Search behavior is therefore verified with mocked deps only; live match quality must be checked behind `YTM_PROXY` or on another host. Expect long wall-clock times when YouTube is unreachable (retries × timeouts) — this is correct behavior, not a bug.

### Environment quirks (this dev box)
- Node v24 + npm 11 present; npm registry reachable. Python 3.10 exists but system python has **no ensurepip** (use `~/.local/bin/virtualenv` if python tooling ever needed).
- Server smoke-test pattern: `PORT=xxxx nohup node dist/server.js >log 2>&1 & echo $! >pid` then curl, `kill $(cat pid)`. Avoid `pkill -f <pattern>` where the pattern matches the command itself (it killed its own shell once).
- `mush.db*` SQLite files may linger from old dev runs (gitignored). The app now stores everything in **MySQL** (see `.env`: `DB_HOST`/`DB_PORT` (3306)/`DB_DATABASE`/`DB_USERNAME`/`DB_PASSWORD`); tables auto-create on startup via `openStore()`. Local MySQL (`brew services start mysql`, root/no password) is used by the test suite (`test/mysql.ts` creates a throwaway `mush_test_*` database).

## Conventions & gotchas
- ESM + TS NodeNext: **relative imports need `.js` extensions** (`./config.js`) in `src/`.
- `npm start` runs `tsx src/server.ts` — the render.yaml deploy is `npm install` + `npm run start` with **no build step**, so `dist/` is optional there. `tsx` is a runtime dependency by design (survives `NODE_ENV=production` installs).
- `src/server.ts` starts listening only when run directly (`node dist/server.js` / `tsx src/server.ts` / `MUSH_RUN=1`); `buildApp(store)` is exported so tests could import it — tests currently don't need a server.
- Views resolved from `process.cwd()/views` — run server from repo root.
- Pipeline is testable by passing `{fetchCollections, searchSongs}` fakes as `PipelineDeps` — keep this pattern; no network in tests.
- Fastify v5: reply.view via `@fastify/view` with `engine: { ejs }` (object form); pass all template vars through `reply.view(name, data)` (no `global` option in v11).
- Jobs run in-process (`startJob` fire-and-forget); a restart abandons `running` jobs (match_cache makes re-runs cheap). No auth/rate limiting — designed for admin-run deployment.
- Tuning envs: `MATCH_ACCEPT`, `MATCH_UNCERTAIN`, `DURATION_TOLERANCE`, `SEARCH_CONCURRENCY`, `YTM_TIMEOUT` (ms!), `YTM_PROXY`, `YANDEX_PROXY`, `YANDEX_TOKEN`, `HOST`; DB via `DB_HOST`/`DB_PORT` (3306)/`DB_DATABASE`/`DB_USERNAME`/`DB_PASSWORD`. Note `YTM_TIMEOUT` is **milliseconds** (default 20000).

## Verifying changes
1. `npm test` (must stay green; 19 tests) and `npm run lint`.
2. Yandex-side changes: live-check against album `1193829` ("Colour", Andy Hunter, 12 tracks, anonymous) — CLI `match` will hang-ish on searches (no YouTube here); prefer a tiny tsx script importing `fetchCollections` with a fresh `YandexClient(null, null)`.
3. Server changes: build, start on a test port, curl `/healthz`, `/`, `/jobs`, POST `/migrate` (album 1193829) expecting `303`, poll `/job/<id>?format=json` expecting eventual `done` with 12 `not_found` items when YouTube is blocked.
4. Matcher changes: run test suite; scoring uses fuzzball `WRatio` (0–100, divided by 100) — rapidfuzz-equivalent but values differ slightly from the old Python implementation; thresholds 0.75/0.55 tuned for it.

## Never do
- Commit `.env` or tokens (gitignored; YANDEX_TOKEN is a secret).
- Add YTM write/auth unless the user explicitly asks — links-only was a deliberate decision.
- Trust that public playlist fetching needs auth (it doesn't, with the right UA) or that YouTube is reachable from the dev host (it isn't).
