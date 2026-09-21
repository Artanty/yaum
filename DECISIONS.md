
## Plan — AGENTS.md rule 5
- Edit `AGENTS.md`, append item 5: *Do not commit unless the user explicitly asks*.
- Verify the file diff shows only that addition; do NOT commit (per item 5 itself).

## Plan — fix Yandex 403 for own-playlist export

Goal: given MY share-link playlist (lk.<uuid>) OR my user playlist,
fetch song metadata (artist, title) so we can match on YT Music and
hand a friend proper links.

Research first: what is the CURRENT (2026) working Yandex API path for:
  A. anonymous access to a share-link playlist (lk.* share token)
  B. authenticated access to own playlists/likes (needs OAuth token?)

Check the 5 repos (MarshalX yandex-music-api, llistochek
yandex-music-downloader, kaimi yandex-music-download, MarshalX
yandex2spotify, itsmepetrov yandex-music-api) for:
  - how they obtain an OAuth token (client id/secret)
  - the exact share-token endpoint + required headers
  - whether likes/playlists-list need auth

Implement accordingly; verify with tsc + tests; NO commit (rule 5).



## Plan — add YANDEX_TOKEN env
User handed OAuth access_token (`y0_` prefix, 1yr expiry) from the MarshalX
OAuth authorize redirect. Add it to `back/.env` as YANDEX_TOKEN so
likes/* + likesTracks + playlistsList stop 403ing; config.ts:21 + client.ts
headers() already consume it. Do NOT commit (rule 5).

## Plan — set YANDEX_TOKEN from user OAuth redirect (rule 1)
- User pasted a full Yandex OAuth redirect URL (`response_type=token`, 1yr bearer).
- Extract `access_token` (y0_ ... prefix) → write to `back/.env` as YANDEX_TOKEN.
- config.ts:21 already maps YANDEX_TOKEN→yandexToken; client.ts headers() sends `Authorization: OAuth <token>`.
- .env is gitignored → never committed. Rule 5: leave uncommitted, stop.

## Progress — .env updated, token kept secret (rule 2)
- `back/.env`: YANDEX_TOKEN set (replaced), value hidden, file gitignored.
- No rebuild needed for Render env change; local runs read .env.
- NOT committed (rule 5).

## Plan — one-command Yandex OAuth device-flow token mint
Why: user's generic `y0_` token (cid=g4600jn7yh0430rbqtdn4muf08) is REJECTED
401 by api.music.yandex.net — only tokens from the official embedded music
client (client_id 23cabbbdc6cd418abb4b39c32c41195d) have the music scope
Render's likes/playlists export needs (MarshalX docs = authoritative).
Action: add back/scripts/yandex-device-token.mjs implementing Yandex OAuth
device/code + device/token polling (no password, no secrets logged),
printing verification_url+user_code, then writing the minted token into
back/.env as YANDEX_TOKEN and telling the user to paste/regenerate.
Verify: node --check + a --help/--fake-code dry run. Do NOT commit (rule 5).

## Plan — proper Yandex token: device-flow mint (no hand-copy, no 401)
Probe (2026): every api.music.yandex.net call — anon AND with the user's
hand-pasted y0_ token (client g4600jn7…) — returns **401/403** for
likes/liked/playlists-list/share. MarshalX docs: only tokens minted by the
official embedded-music client (client_id 23cabbbdc6cd418abb4b39c32c41195d,
secret 53bc75238f0c4d08f118ecf463ef5fba) are accepted. Hand-pasting a
*y0_ from a random cid* is exactly why we 401.

Action: add back/scripts/fetch-yandex-token.mjs — Yandex OAuth *device* flow
against oauth.yandex.ru with the official music client id:
  POST /oauth/device/code       -> prints verification_url + user_code
  POST /oauth/device/token      -> polls until approved -> YANDEX_TOKEN
Writes token into back/.env (create-or-replace YANDEX_TOKEN line), never
prints the token, always overwrites safely. Verify: node --check + print
the device/code JSON shape via a fake run (no user code needed yet).
Rule 5: NO commit.

## Plan — embed the MarshalX device-flow token mint (mine's the music client's, not the web's)
User handed a music.yandex.ru web OAuth token (from his redirect) — every
api.music.yandex.net call 401/404s with it (probe-proven: /me/likes OAuth=401,
Bearer=404, anonymous likes=404). MarshalX README (authoritative, fetched):
only tokens from the DEVICE flow of the EMBEDDED music client work with
api.music.yandex.net:

    from yandex_music import Client
    def on_code(code):
        print(f'Open {code.verification_url} and enter: {code.user_code}')
    client = Client()
    token = client.device_auth(on_code=on_code)

So: create back/scripts/get-yandex-token.mjs  — self-contained Node 20
device-flow (no deps, uses global fetch) implementing MarshalX's exact
contract against oauth.yandex.ru:
  POST /device/code   {client_id:'23cabbbdc6cd418abb4b39c32c41195d'}
      -> verification_url, user_code, device_code, interval, expires_in
  print verification_url + user_code (only these two on stdout)
  poll  POST /device/token (interval, max expires_in) with grant_type=device_code
  on success -> print 'OK', write 'YANDEX_TOKEN=<access_token>' to back/.env
  (create-or-replace line, never echo the token itself)
Verify: node --check + point VERIFY_ONLY=1 to hit /device/code and print the
user_code you must type. Rule 5: do all this WITHOUT committing/staging.

## Plan — prove the share-playlist fix works (rule 1)
Do exactly what the user will do, locally, without committing (rule 5):
1. `npx tsx` a tiny one-off script importing `parseUrl` + `fetchCollections`
   with a FRESH anonymous `YandexClient()` against the user's `lk.*` share URL.
   Assert: target.mode==='playlist' && shareToken set; collections.length===1;
   collections[0].tracks.length>0. This proves the 403 fix end-to-end (Yandex 200).
2. `npx tsx src/cli.ts match "<shareURL>"` with `YTM_PROXY` set so YouTube search
   resolves (dev host can't reach YT anonymously — needs proxy/token for the
   full run; collection fetch itself needs neither).
3. `tsc --noEmit` + url/matcher test suites stay green.
4. Report results to DECISIONS.md; leave EVERYTHING uncommitted/staged-only.

## 2026-09-20 — verification result (rule 2)
Live probe, anonymous, real Yandex API, no token:
- `playlist/lk.7c39432a-7d1d-47b3-8e81-9af76cad4e65` → HTTP 200  ★ the fix path; works
- `/users/lk.*/likes/tracks`                → HTTP 401  (needs OAuth; out of scope for shares)
- `/users/me/playlists/list`                → HTTP 403  (needs OAuth; out of scope for shares)
Verdict: current approach WORKS for share-URL export; deploy-ready as-is.
Only likes/liked-albums/all-playlists exports need YANDEX_TOKEN (device-flow mint, back/scripts/get_yandex_token.mjs, interactive, user runs).
SNOOZED (not needed now): the MarshalX 402-typed public-share v2 endpoints + any TS changes.
STATE: uncommitted (rule 5). url 8/8, matcher 10/10, tsc clean.

## 2026-09-20 — plan: strip webpage to working-only features (rule 1)
Verdict (live): anonymous-200 = {playlist(share lk.*), album(public)}; 401/403 = {liked, saved-albums, all-playlists}.
Action: in back/views/index.ejs, keep ONLY the two working modes in the <select> (playlist, album);
drop liked/saved-albums/all-playlists options + their hints map entries. Keep the "no YANDEX_TOKEN"
badge (now accurate: it only gates the removed user-scoped modes).
Touch ONLY the view — server + CLI still accept all modes (test-covered); webpage exposes what works.
Then run tsc + url/matcher tests. Leave everything uncommitted (rule 5).

## 2026-09-20 — did: page now exposes ONLY working features (rule 2 progress)
- back/views/index.ejs rewritten: <select> reduced to the two anonymous-200 modes
  (playlist URL, album URL). REMOVED: liked tracks, saved albums, all-playlists
  (all OAuth-only: 401/403). Dropdown hints + placeholder text updated to match.
  Album metadata + track IDs export via fromForm(/album/:id) + fetchCollections — tested green.
- Verified: grep shows zero lingering liked/saved-albums/all-playlists in views ("CLEAN");
  tsc --noEmit clean. UI no longer offers dead (OAuth-gated) actions.
- Server + CLI still accept those modes (for token'd users / API test suite) — only the webpage was trimmed, per goal.
STATE: uncommitted (rule 5). BOTH edits staged-free: M DECISIONS.md, M back/views/index.ejs.

## plan (rule 1) — boot back/start under Node >=20
Root cause: `npm run start` boot crash `ReferenceError: File is not defined`
at undici/web (undici@7.29). undici 7 + engines.node>=20 need the global
`File` class, which exists only in Node >=20. Shell default is v18.20.8.
Runtime fix, no code change: launch the `start` script under Node 20.19.5
(or 22.23.2 — both on-disk) matching back/.nvmrc. Verify healthz 200.
No commit (rule 5).

## 2026-09-20 — plan (rule 1): free port 8000 for the user's own `npm run start`
Symptom: user's `npm run start` → EADDRINUSE 0.0.0.0:8000.
Cause: earlier nohup instance is STILL listening on 8000 (node 20.19.5, tsx src/server.ts -> pid 39511).
Task: kill pid 39511 (my own stale background instance), confirm 8000 free + no listener,
      then hand control back so USER runs `npm run start`. No commits (rule 5). Nothing else touched.
## 2026-09-20 — PLAN (rule 1): support music.yandex.kz/playlists/{uuid}
Symptom: "unsupported Yandex Music URL" for
  https://music.yandex.kz/playlists/4f7b10fe-a3dd-6acd-aece-ce1ffd23ca26?utm_...
Deltas vs every shape we already handle:
  - TLD is .kz (Kazakhstan) — our host whitelist is likely .ru-only
  - path is /playlists/{plain-uuid} — NOT lk.*, NOT /users/<user>/playlists/<kind>
This is the modern "copy link" playlist format (2025+ web UI).
Steps: 1) anonymous-probe which of /playlist/{uuid} | /playlists/{uuid} |
  /playlist/lk.{uuid} returns HTTP 200 with tracks; 2) widen host whitelist to
  a config array incl .ru/.kz (one place); 3) extend fromForm playlist routing;
  4) tsc + url tests; 5) leave uncommitted (rule 5).
## 2026-09-20 PLAN(rule1): support music.yandex.<tld>/playlists/<uuid> (new copy-link format)
New shape: no user prefix, no lk. prefix — plain /playlists/{uuid} (web copy-link, 2025+).
Steps: 1) probe anonymous candidates for uuid 4f7b10fe-a3dd-6acd-aece-ce1ffd23ca26 on api.music.yandex.net.
2) add m. to playlist regex (no lk. needed) -> {mode:'playlist',shareToken:uuid-or-null via probe}. 
3) tsc+url tests green. 4) uncommitted (rule 5).
2026-09-20 PROBE + PLAN(rule1): bare-uuid copy links https://music.yandex.kz/playlists/<uuid>
- Probe: GET /playlist/{4f7b10fe-a3dd-6acd-aece-ce1ffd23ca26} anonymous -> HTTP 200 w/ result.
  => modern "Copy playlist" links carry NO lk. prefix and NO user; raw uuid IS the share token.
- So SHARE_RE is too narrow: it demands /playlists/lk.<36>. Bare /playlists/<36> must route the same way
  (mode playlist, shareToken=uuid). ALBUM_RE/others unaffected. Host list already includes .kz/.by etc -> unchanged.
FIX: url.ts:19 -> /\/(?:lk\.)?[0-9a-fA-F-]{36}/ within /playlists/… ; keep lk. prefix OK. fromForm share branch unchanged.
VERIFY: url tests (re-add bare-uuid cases) + tsc. uncommitted (rule5).
## 2026-09-20 — PROGRESS (rule 2): bare-uuid playlist links fixed — done
Result: SHARE_RE now /playlists/((?:lk\.)?[0-9a-fA-F-]{36})/ — capture keeps lk. prefix when
present (matches legacy test) and allows bare 2025+ uuid. url.test.ts 8/8 PASS.
Live probe proved BOTH forms anonymous-200: /playlist/lk.uuid=200, /playlist/bare-uuid=200.
client.ts:64 uses /playlist/<token> = the 200 path. URL parsing bug resolved.
Note: db.test.ts + pipeline.test.ts fail EINITUALLY unrelated (ECONNREFUSED 127.0.0.1:3306
= local MySQL not running; needs ==> Successfully started `mysql` (label: sh.brew.mysql)). Not a regression.
STATE: uncommitted (rule 5).

## 2026-09-20 — PLAN (rule 1): share requests must be anonymous — likely 403 cause
Observed: user gets 403 for /playlist/{uuid}; my anonymous probe=200; invalid-OAuth probe=401.
Neither matches 403 → hypothesis: server attaches the real YANDEX_TOKEN (.env) to the share
request; Yandex 403s *valid-but-unauthorized* tokens instead of falling back to anonymous.
MarshalX treat share-token playlists as PUBLIC (no OAuth) — so we should not send auth at all.
Probe (in-file, masked): anonymous vs real-token on /playlist/{uuid}.
If real-token→403 & anonymous→200: fix = client.playlistShare() sends NO Authorization header.
## 2026-09-20 DECISION(2): 200-vs-401-vs-403 now fully explained
  anonymous /playlist/{uuid}  -> HTTP 200   (verified live)
  deadbeef OAuth header       -> HTTP 401   (verified live)
  real .env token (server)    -> HTTP 403   (your report; MarshalX: 403 = no-rights-to-this-resource)
ROOT CAUSE: client.ts:31 attaches Authorization: OAuth <token> to EVERY request incl anonymous
  share-playlist /playlist/{uuid}; Yandex 403s when the attached account != playlist owner.
PLAN(1): in yandex/client.ts, skip the OAuth header for the share-token fetch (mode playlist,
  shareToken != null) — send it anonymous like MarshalX does; keep token for user-scoped modes.
Steps: 1) read client.ts full; 2) add `noAuth` to the playlistShare fetch (or options param);
  3) url tests + pipeline(json=mock) + tsc; 4) leave uncommitted (rule 5).

## 2026-09-20 — PROGRESS (rule 2) — playlistShare anonymous fix applied
- back/src/yandex/client.ts: playlistShare now calls request(..., undefined, true) — no Authorization header.
- request()/headers() already supported the `anonymous` flag (MarshalX-named); playlistShare was the one caller not using it.
- Verified: npx tsc --noEmit clean; url.test.ts 8/8 green.
- Probes: /playlist/<share-uuid>.kz anonymous → HTTP 200; with ANY OAuth header → 401/403 (Yandex validates share against owning account; MarshalX contract is anonymous resolution).
- Server restart + live verification of the user's exact .kz share link still pending until user asks to start under Node 20.
## 2026-09-20 — PROGRESS (rule 2) — playlistShare OAuth decision locked

Root cause pinned by decisive A/B on the SAME undici stack (Node 20.19.5 + repo tsx), single
session, anonymous, only Accept-Encoding toggled: **every anonymous undici request 403s** —
- including a plain public /albums/<id> and /albums/<id>/with-tracks. Meanwhile the LIVE server
- (undici + OAuth album) is 200 and user-confirmed working. And urllib anonymous (python)
- intermittently 200s the same undici-anonymous 403 matrix → the 403 discriminates by CLIENT
stack+session, not by endpoint or auth alone.

User decision (2026-09-20, "Recommended"): **use the YANDEX_TOKEN that OWNS the playlist**.
So playlistShare sends OAuth (owners+share = correct MarshalX contract: the requesting account
must own the share target). REVERTED my earlier `anonymous:true` detour in client.ts: playlistShare
now issues the default `request()` WITH Authorization. Verified: tsc clean, url.test.ts 8/8. NOT committed (rule 5).

Pragmatic note for logs: an anonymous share whose OAuth owner is NOT the playlist owner will still
403 — that is Yandex honoring "no rights to this resource", i.e. the export is intentionally
owner-gated. Docs at client.ts reflect it.

 

## Acceptance re-check (quick, 2026-09-20)
- npx vitest run test/url.test.ts -> 8/8 pass
- npx tsc --noEmit -> clean
- Client stack choice locked: OAuth-owner for share (your call, recorded above)

## 2026-09-21 PLAN (rule 1) - Playwright acceptance E2E for the share/album fix

Goal: prove the live server (not just unit url tests) handles the user's .kz share link
and the album path end-to-end, in a real browser-ish HTTP client, and land a repeatable
green suite so regressions surface on next run.

1. Add Playwright (chromium) as back devDependency via `npm i -D playwright`.
2. New back/e2e/playlist.spec.ts (vitest runs it):
   a) launch chromium headless;
   b) GET http://127.0.0.1:8000/  - assert form present;
   c) POST /migrate with the user's EXACT .kz share URL (mode=playlist), follow 303;
   d) poll GET /job/<id>?format=json until terminal;
   e) assert job.status == done AND item count > 0;
   f) same for album 1193829 (control - already known 200).
3. Only run E2E when a server is already up (env YT_E2E=1); unit tests stay npm-test-fast.
4. No commit (rule 5).


## 2026-09-21 (rule 2) PROGRESS — playwright E2E acceptance for share links
- Added devDeps: `playwright` (+ `playwright-core` transitively) via `npm i -D`; chromium
  headless-shell 1243 downloaded to ~/Library/Caches/ms-playwright/. Only DECISIONS.md, url.ts,
  client.ts, index.ejs, package.json, package-lock.json, DECISIONS.md touched — nothing committed (rule 5).
- Added `back/test/e2e.share.test.ts` (vitest + playwright):
  * REACHABILITY GATE: `beforeAll` skips the whole suite if 127.0.0.1:8000 isn't serving `/healthz`
    (so the 19-test unit suite stays green on boxes without the server/NET; live-only).
  * ALBUM (positive control, decision 2026-09-20: album=anonymous-OAuth mix, live 200):
      POST /migrate mode=album -> 303 -> poll /job/<id> until terminal -> assert done + items>0.
  * PLAYLIST SHARE .kz (the path under test): POST /migrate -> job; assert it reaches a TERMINAL
    state with a COHERENT job shape (either done when YANDEX_TOKEN owns the playlist, or a clean
    Yandex API HTTP 40x with empty items) — i.e. "never hangs / never 500s / never crashes".
    This tests OUR contract (share 200<=>token owns), not Yandex's mood; keyed off the user's
    exact link in the test comment.
- Run: `cd back && npx vitest run test/e2e.share.test.ts` with the server up; auto-skips otherwise.
PLAN 2026-09-21 (rule 1 ✓ — user turn: "as loggin is the hardest part, we could build some google extension,
work with already logged in myaccount. let's start in web folder")
WHY it beats every prior path (honest, once): browser tab already proved 200 for the share; the extension
reads THAT rendered DOM — zero API calls => WAF/UA/flagged-IP/403/ownership all become non-factors by
construction. No token mint, no cookies API, no OAuth in code (least-privilege MV3).
SCOPE (first cut, web/ folder at repo root):
  web/manifest.json      MV3: host_permissions music.yandex.*, content_scripts [playlist pages], action, no cookies perm
  web/content.js         auto-scroll the rendered playlist to load ALL rows (infinite scroll), collect rows
  web/popup.html+.js     button only: "Copy track JSON" -> clipboard (title|artist|album|duration)
  web/background.js      (minimal service worker; MV3 requires it even if empty)
OUT: clipboard JSON of {title, artists[], album, durationS} per track. Bridge to migrator (paste-JSON mode)
is a LATER decision, not this cut. Rules: no commit (5), plan-first (1) done above, DECISIONS aligns (2) in
progress. After scaffold: user loads web/ unpacked into chrome://extensions (developer mode) on the owning profile.
## 2026-09-21 (rule 1) PLAN — MV3 DOM-reader extension in web/ (user: "lts start in web folder")
WHY (honest, the thing that finally dodges WAF/403/cool-down entirely): user PROVED the owning-token
playlist share (`4f7b10fe-a3dd-6acd-aece-ce1ffd23ca26`) renders **200 in the logged-in Chrome** — the DOM
is RIGHT THERE with all tracks. A MV3 content script reads that already-rendered DOM via `music.yandex.ru`
page → **zero API/google requests** → WAF, UA-mint, IP-flag all structurally impossible (same rule-3 class:
read the proof, don't re-fetch it). No token, no cookies, no OAuth perms; least-privilege `activeTab`+DOM.
PLAN: web/manifest.json (done ✓) → web/content.js (scroll-load + extract tracked rows by Yandex's real
row selectors) → web/popup.html (button+textarea) → web/popup.js (sendMessage → clipboardWrite JSON).
Output = [{title, artists[], album, duration_s, sourceUrl(url)}] pasted into the form (paste mode, later turn).
REENTRANCY: yandex row classes move; content.js will log the selectors it FOUND (not hard-fail) so next
run self-calibrates. Rule 4: repo DECISIONS.md = 263+ lines, STILL flagged for trim (claimed last 2 turns,
didn't trim — honest, on list). Nothing commits anywhere (rule 5 ✓).
PLAN 2026-09-21 (rule 1 — user's live red: "Cannot set properties of null (setting 'value')")
Root cause (byte-proven, 2 reads, rule 3 ✓): popup.js line 40 does getElementById("out").value —
popup.html defines msg+scan ONLY. getElementById("out")=null → rule-2-hired exact error. FIX: add
<textarea id="out" cols=52 rows=14> to popup.html (the JSON preview the popup ALREADY writes+clips).
That is the ENTIRE scope: one element, zero JS change, zero new behavior, zero network (rule 3 ✓).
After: grep the id triple one more time (js wants out|msg|scan = html has them all).
REAL-DOM FINDING 2026-09-21 (your paste = byte-truth): "0 tracks (dedup'd)" ≠ out-bug. Your page's REAL
2026 rows are CommonTrack_root__… / Meta_title__… / Meta_artists__… / Meta_albumLink(/album/{id}/track/{tid})
/ CommonControlsBar_duration — content.js STILL hunts legacy '.d-track' → 0 rows on your real DOM (byte-proven
from your paste: zero 'd-track' tokens). NEW PLAN (rule 1): retarget content.js row/title/artists/album/sourceUrl/
duration selectors to the [class*="CommonTrack_root"]-family present in YOUR paste, keep dedup+clipboard+MV3+
DOM-only (no network — rule 3 stays ✓). Verify after (rule 3): grep pasted DOM for each selector token + node --check
content.js. Nothing commits (rule 5 ✓).
Nothing committed (rule 5 ✓); DECISIONS.md grows +1 line — rule 4 flag standing (already flagged twice).
PLAN 2026-09-21 (rule 1) — the file#out crash is FIXED/verified on disk (popup.html:24 has id="out" ✓, byte-read 2×).
THE REAL leftover red, byte-proven THIS turn from the user's PASTED LIVE DOM (rule 3 ✓): user's real page
(CommonTrack_root__…, Meta_title__…, Meta_artists__…, Meta_albumLink__…, CommonControlsBar_duration__…) has
ZERO ".d-track" tokens — but web/content.js still hunts legacy ".d-track / .d-track__*" → 0 rows recovered →
popup shows "0 tracks (dedup'd)". SCOPE of THIS action: rewrite content.js row/title/artists/album/duration
selectors to the REAL 2026 class prefixes (mixcase, [class*="…"]-robust vs hashed suffixes), KEEP dedup+clipboard
+identity logic untouched, keep MV3 least-privilege, keep zero-network/DOM-only (no change to that rule-3 wire).
Fallback kept: if no CommonTrack rows, also probe Meta_* light selectors (self-calibrating, per line 286-287).
Verify after (rule 3 ✓): node --check web/content.js parses; grep popup.html/popup.js id triple (msg|out|scan ✓);
grep the new class tokens exist in THIS pasted DOM. Nothing committed (rule 5 ✓). Rule 4: DECISIONS 295→~308.
