# DECISIONS

Current thread only. Prior sessions: `DECISIONS-archive.md`.

*(Older entries moved to `DECISIONS-archive.md` per AGENTS.md rule 4 — this file holds the rename to
`plst`, the user rename, and the library playlist/export work. The ext-logs routing thread that was
here before is now in the archive.)*

## 2026-10-01 — PLAN (rule 1): rename to `plst`, rename the two users, and add library
### playlist-creation + YouTube Music link export to the web app

Three requests. Two are mechanical; the third turned out to be mostly absent infrastructure, so the
findings come first — they are what shape the work.

#### What the code actually says (checked before planning, not after)

1. **Two names are in play, not one.** `mush` (backend: `back/package.json` name, the `<title>` and
   `<h1>` in `back/views/partials/head.ejs:6,27`, the description in `back/AGENTS.md`) and `yaum`
   (extension manifest + `ext/package.json`, the five route titles in `web/src/app/app.routes.ts`,
   the session key `yaum.userId` in `web/src/app/core/session.ts:9`, `YAUM_API` in
   `web/proxy.conf.js`, the extension log key `yaum.log` in `ext/log.js:15`, and `mush.server` in
   `ext/popup.js:88,270,364` + `ext/ship.js:37`). Renaming the storage keys is the one risky part:
   it silently drops the saved backend URL and the logged-in user.
2. **The user seed has a typo and a stale key.** `SEED_USERS` is
   `[{username:'artyom', displayName:'Artiom'}, {username:'friend', displayName:'Friend'}]`
   (`back/src/library/store.ts:27`). `seedUsers` upserts on `username` with
   `ON DUPLICATE KEY UPDATE display_name=VALUES(display_name)`, so editing the seed alone would
   **strand** the existing `friend` row instead of renaming it — you would end up with three users.
3. **Playlist creation from the library needs no backend work at all.** `POST /playlists/:id/items`
   (`back/src/library/routes.ts:540`) already validates song ids and `store.addPlaylistItems`
   (`store.ts:544`) already inserts them positionally. The web client already has
   `createPlaylist()` and `addTracks()` (`web/src/app/core/library-api.ts:120,132`). What is missing
   is only the UI: `library.html` renders a plain table with no row selection and calls neither
   method. This is a pure front-end task.
4. **No library song has ever been matched to YouTube.** `songs` has `yt_video_id`, `match_score`,
   `matched_at` (`back/src/library/schema.ts:60-62`, mirrored in `types.ts:15-17`) and **nothing
   writes them** — the only writer of a video id is the old converter (`back/src/db.ts`,
   `pipeline.ts`) which fills a *different* table for the `/migrate` + `/job/:id` flow. So a link
   export on its own would render an empty list, every time.
5. **The matching primitives are reusable.** `matcher.buildQueries()` / `matchTrack()`
   (`back/src/matcher.ts:73,97`) take a `TrackMeta` of exactly the fields a library song already
   has (title, artists[], album, duration) and return `MatchResult` with `videoId` + `score`.
   `pipeline.matchWithSearch()` (`pipeline.ts:33`) wraps that with the match cache, a PQueue and
   injectable deps — the seam that makes mocked testing possible.
6. **This machine cannot reach YouTube.** `back/AGENTS.md:82` is explicit: connections silently drop,
   live matching needs `YTM_PROXY` or another host. So the match work can only be verified with
   mocked search deps here — the same rule the rest of the converter already follows.

#### Decisions taken (confirmed with the user)

- **Scope of the rename: everything**, including `yaum` and the persisted storage keys, with a
  one-time fallback read of the old keys so the saved server URL and logged-in user survive.
- **Users: rename in place, keep ids**, so owned playlists and shares are not orphaned.
- **YouTube links: build the match action, then export** — not a permanently empty export.

#### Work

1. **Rename to `plst`.** `mush` → `plst` in backend package/views/AGENTS; `yaum` → `plst` in the
   extension manifest and package name, the five route titles, the page header; storage keys
   `yaum.log` → `plst.log`, `yaum.userId` → `plst.userId`, `mush.server` → `plst.server` and
   `yaum.logLevel` → `plst.logLevel`, each with a legacy-key fallback on read; `YAUM_API` →
   `PLST_API` with `YAUM_API` still honoured. Rename is done with word-boundary regexes, and
   everything under `node_modules`, `logs/`, `dist/` and `package-lock.json` is left alone.
2. **Users.** A one-time, idempotent migration renames `friend` → `zaur` in place (one `UPDATE`,
   so the id and every playlist/share it owns stay intact) and fixes `Artiom` → `Artyom`; the seed
   becomes `artyom`/`Artyom` + `zaur`/`Zaur` so fresh installs agree. Migration runs once at
   startup next to `seedUsers` and logs what it changed.
3. **Create a playlist from the library.** Selection lives in `LibraryApi` as a signal (a `Set` of
   song ids) so it survives paging and filter changes — otherwise selecting a song on page 1 and
   paging to page 2 silently drops it, which is the kind of bug that only shows up on real data.
   The library page gets a checkbox column, a selection toolbar with "create playlist" and "add to
   playlist", and a per-row menu on the playlist page for adding a single song.
4. **Match + export.** A new library match step that runs the existing matcher over a song and
   persists `yt_video_id` / `match_score` / `matched_at`, exposed as an endpoint for one song and for
   a whole playlist (batch, capped, per-song outcome reported). Export renders the plain
   `https://music.youtube.com/watch?v=<videoId>` line list, and **lists unmatched songs by name
   rather than dropping them silently** — a short export that looks complete is the dangerous case.
   UI: match/copy per song, match-all + export on the playlist page.
5. **Verify.** Backend `tsc` + tests, web tests, then exercise the new endpoints against the running
   server with `curl` (match steps mocked or expected to fail as not-found on this host, and that
   is reported as such rather than claimed as a success).

Open risk to watch: renaming `friend` → `zaur` in place assumes no *other* row already claims
`zaur`; the migration must check that first and skip with a log line if it does.

### RESULT — all three shipped and verified

**1. Renamed to `plst`.** 187 occurrences across 31 files. Two names were in play (`mush` in the
backend, `yaum` in the extension and web app), plus the storage keys, the `YAUM_API`/`MUSH_RUN` env
vars, and the `yaumLog`/`yaumShip` globals. Renamed package names to `plst`, `plst-ext`, `plst-web`;
manifest name `plst`. **`DECISIONS*.md` deliberately keep the old names** — they are a historical
record of what things were called, not product-facing docs.

The risky part was the persisted keys, and each one gets a fallback read so nothing is lost:
`plst.server`←`mush.server`, `plst.userId`←`yaum.userId`, `plst.logLevel`←`yaum.logLevel`, and
`plst.log` adopts the old `yaum.log` **buffer** (otherwise the rename silently discards up to 300
unshipped entries). `PLST_API` still honours `YAUM_API`; `PLST_RUN` still honours `MUSH_RUN`.

*Process note:* the first rename attempt used `sed -i '' -e 's/\bmush\b/…'`. **BSD sed has no `\b`**,
so those rules silently matched nothing while looking like they ran. A leftover grep caught it, and
the fix was perl with real word boundaries. Nothing was half-renamed — the failing sed wrote no file.

**2. Users.** The real DB now returns `1/artyom/Artyom` and `2/zaur/Zaur` — **id 2 preserved**, which
was the whole point: playlists and shares owned by the old `friend` row stay attached. Done with a
one-time migration (`library/migrations.ts`) rather than by editing the seed, because `seedUsers`
upserts on `username` and would have inserted a *third* user beside the old row. The migration
checks for a taken name first and skips loudly rather than violating `uq_users_username`, and is
silent when there is nothing to rename — a first draft logged "target name already taken" on every
fresh boot, which a test caught.

Side effect worth knowing: the earlier `library: scan imported {tracks:3}` line I could not account
for came from **the test suite**, not from you. The live DB had no songs.

**3a. Playlist from the library.** Backend already had `POST /playlists/:id/items`; the web client
already had `createPlaylist()`/`addTracks()`. What was missing was the UI. Added a checkbox column, a
selection toolbar ("create playlist" / "add to…" / "match" / "export"), and
`POST /playlists {songIds}` as **one transaction** — create-then-add over HTTP leaves an empty
playlist behind whenever the second call fails. Selection state lives in `LibraryApi`, not the page,
because the songs resource is paged and a page-held selection is rebuilt from the visible rows.

**3b. YouTube Music links.** The blocker was real: `songs.yt_video_id` existed but **nothing had ever
written it**, so the export would have been permanently empty. `library/match.ts` reuses the existing
`matcher.ts` rather than reimplementing scoring, with `searchSongs` injected for tests. Endpoints:
`POST /songs/:id/match`, `POST /playlists/:id/match` (capped 50), `GET /export/youtube`.

**Two findings that changed the work:**

- **`back/AGENTS.md:82` was wrong.** It claimed this machine cannot reach YouTube, so matching had to
  be mocked. It can: `YTM_PROXY` is set in `.env`, and a live search returned 20 real candidates,
  `Roxanne → fZheUzgIFEk` at score **1.00**. Only *direct* connections are blocked. Corrected in
  AGENTS.md — that line was actively steering work away from real verification.
- **My first export was quietly wrong.** A live playlist match produced `Roxanne → WMl1xKJeuuQ`, which
  is **"Message In A Bottle — The Police"** (score 0.568, `uncertain`), and the export pasted it as
  if it were Roxanne. Cause: I treated any stored `yt_video_id` as good. Now derived from the score:
  confident matches are links, `uncertain` ones are listed separately and **commented out** of the
  text, and unmatched songs are still named. Verified after the fix — pasting yields only
  `KJEzFvXx3Xw`, with the bad one flagged for review.

Verified live on a throwaway MySQL DB (dropped afterwards; the real DB was not used for test tracks):
create-from-selection preserves order and rejects unknown ids with a 400 naming them; the export lists
unmatched songs instead of dropping them; a real match stores the video id.

`back` 86 tests (11 files), `ext` 27, `web` 25; `tsc` clean in both TS projects. Nothing committed.
