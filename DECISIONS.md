# DECISIONS

Current thread only. Prior sessions: `DECISIONS-archive.md`.

*(Older entries moved to `DECISIONS-archive.md` per AGENTS.md rule 4 — now three times: 2026-09-29
(the ext-logs routing thread), 2026-10-07 (the `plst` rename + library/export thread and the Surge
workflow rounds), and archived on 2026-10-09: the React port (2026-10-07) and the header-styles fix
(2026-10-08). This file holds the Surge static-deploy probe.)*

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
