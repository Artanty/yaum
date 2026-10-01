# DECISIONS

Current thread only. Prior sessions: `DECISIONS-archive.md`.

*(Older entries moved to `DECISIONS-archive.md` to stay under the ~250-line limit per AGENTS.md
rule 4 — everything up to and including the first logging thread is there; this file holds the
ext-logs routing work.)*

## 2026-10-01 — PLAN (rule 1): route ext logs to the backend — `POST/GET /api/library/ext-logs`

The extension log persists 300 entries in `chrome.storage.local`, which fixed "the popup closed and
the evidence went with it". It is still trapped on the machine that produced it: not greppable, not
readable over HTTP when the box is remote, and gone with the browser profile. The backend already
speaks JSON lines and is the thing a bug report is answered from. So: ship the trace there.

**Separate file, not the server log.** `logs/ext.log`, written through a second `Logger` instance
(`filename: 'ext.log'`, and `errorFilename: 'ext.log'` too, so all levels stay in one filterable
stream). Rotation, sanitizing and reading come free from the existing class. Mixing 200 extension
lines into `app.log` per batch would bury the server trace, which is the signal.

**`POST /api/library/ext-logs`** — `{ extensionId?, userId?, entries: [{ts, level, scope, msg, stack?, data?}] }`
- cap 200 entries per request, cap `msg` at 500 chars, drop non-objects instead of failing the batch;
  response carries `{received, stored, dropped, capped}` so truncation is never silent
- `data` runs through the existing `sanitize`, so a token is masked **on ingest**, not just on read
- one summary line into `app.log` per request (who shipped how many), so the server log can always
  tell you whether the extension's logging is arriving at all
- no auth, consistent with every other library route (`x-user-id` optional)

**`GET /api/library/ext-logs?last&level&extensionId&userId`** — reads `ext.log`, `hideSensitive`,
and returns the file path plus counts, so "nothing here" is explainable rather than mysterious.

**Client: `ext/ship.js`, loaded in the popup only.** Deliberately *not* inside `log.js`: log.js is
also a content script, and shipping from there would POST the same batch once per frame.
- only entries not already marked shipped (the flag lives on the entry, so it survives popup closes)
- ships on popup open (so leftovers go out), on a timer while open, after a scan/import, and once
  more on `pagehide` with `keepalive` so the closing popup still delivers
- backoff 5s → 15s → 60s → 5min, stop after 6 attempts: a backend that is down must not become an
  infinite "logging failed" loop, which is the failure mode a logging feature is most prone to
- its own diagnostics stay at `debug`; a failure is recorded once per backoff step as a `warn`,
  which is itself shippable — so the backend eventually learns its logs are not arriving
- the popup shows the last ship result and has an explicit **Upload logs** button

**Timestamp fix.** Entries store `t: "HH:MM:SS.mmm"` only, which is fine for a session and wrong now
that the buffer survives days — yesterday 12:00 and today 12:00 are indistinguishable. Add a full
ISO `ts` at push time and ship that; keep `t` for display so the copy/paste format is unchanged.

**Also:** `npm run logs -- --ext` tails `ext.log`; `AGENTS.md` gains both endpoints.

Rejected: writing into `app.log` (noise); a MySQL table (heavier than a rotating append-only file for
diagnostics, and the files already exist); shipping from the content script (duplicate batches).

### RESULT — shipped, and the round trip is verified end to end

`back/src/lib/ext-log.ts` adds a second `Logger` instance writing `logs/ext.log` (`errorFilename`
the same file, `console: false`), so extension chatter gets its own rotated stream instead of
burying the server trace. `POST /api/library/ext-logs` caps at 200 entries per request and keeps
the **newest** (a truncated trace is most useful at its end), bounds `msg` to 500 chars, drops
non-objects, and folds the client's `debug` into `log`. `data` is sanitized on **ingest**, so a
token is masked on the way in, not only on the way out. `GET /api/library/ext-logs?last&level&
extensionId&userId` reads it back with `hideSensitive`.

`ext/ship.js` ships from the popup only — deliberately not from `log.js`, which is also a content
script, where every frame would POST an identical batch. Only unshipped entries go, marked shipped
**after** the server accepts (an entry lost to a failed request is the worst outcome), 100 per
request, one request in flight, backoff 5s→15s→60s→5min then stop. It ships on popup open, on a
45s timer, after a scan or import, and once on `pagehide` with `keepalive`. Its own diagnostics
stay at `debug`: a `warn` there would become an entry that must itself be shipped, which is exactly
how a logging feature turns into the noise it was added to prevent.

**Four bugs of my own, all found by testing rather than reasoning:**

1. `ship()` sent the remainder by recursing into itself while `inFlight` still pointed at the
   promise it was running inside — so the second batch awaited itself and the **first upload never
   resolved at all**. Now an explicit loop; the 30s test timeout is what exposed it.
2. `normalizeExtEntries` kept the *first* 200 entries of an oversized batch, while the plan (and
   the reason you ship a log at all) says the newest. Slipped through because the first test batch
   was under the cap.
3. The client's timestamp was normalized and then **thrown away** — `Logger` stamps its own arrival
   time, so every shipped entry claimed the second it arrived and true ordering was unrecoverable.
   It is now kept as `data.extTs`.
4. The stack was written as a separate `log`-level line, so `?level=error` — the one query you run
   when something crashed — **dropped the stack**. It now rides on the error entry as
   `data.extStack`, deliberately not named `stack`, because `Logger.error` treats a top-level
   `stack` as an Error and then discards the whole payload.

Also fixed: the GET reported `count` as everything matched rather than what it returned, so
`?last=3` claimed 10; and entries only had a time-of-day `t`, which is now meaningless since the
buffer survives days, so each entry also stores a full ISO `ts`.

Verified against the **real extension and a real server**, not stubs: popup opened, logged a
warning with a marker and a deliberate `TypeError`, pressed "Upload logs to server" → status line
`✓ 2 entry(s) accepted by the server at 09:28:22`, and `GET /api/library/ext-logs` returned both
with `extensionId`, `userId`, `extTs` and the full `extStack`, alongside the `ext logs ingested
{received: 2, stored: 2}` line in `app.log`. `npm run logs -- --ext` tails it, and explains itself
when the file is absent ("open the popup, or press Upload logs to server").

Tests: `back` 61 (9 new for the endpoint), `ext` 27 (8 new for shipping), `web` 17.

### "`(Object.<anonymous>)` on startup" — a useless caller, found by counting

Reported as strange, and it was: `server ready (Object.<anonymous>)`. Following it up properly
(counting attributions across the whole log rather than looking at one line) showed **1004 lines —
a third of the log — carried `Object.<anonymous>`**, the most common attribution in the file and a
label that names nothing. The cause was mine: the `preHandler` and `onReady` hooks are anonymous
arrows, so `captureCaller()` fell back to V8's rendering of an unnamed function. Every other hook
already passed an explicit `fn` (`onResponse`, `notFound`, `preHandler` on its own error path), which
is also why those were fine.

Two things followed from looking instead of guessing:

- **Poll suppression was not broken.** Most of the 1004 were poll requests, which should never be
  logged — so the obvious theory was "suppression broke and floods the log". The timestamps said
  otherwise: they all fall between 22:45 on 30 Sep and 09:04 today, i.e. before suppression existed.
  Confirmed live — 3× `/me` + 1× `/users` against the running server produced **zero** lines. The
  rest of the `Object.<anonymous>` lines are the extension's own uploads.
- **The log tail was genuinely out of order**, which is what made the output look strange:
  `npm run logs` printed `app.log` and then `error.log` file by file, so an error from *yesterday*
  (20:47) appeared after today's startup lines. It now merges by timestamp and sorts. While fixing
  that, `--last N` was found to mean N *per file* — `--last 200` printed 400 and could show an older
  error below a newer one. It is now the newest N of the merged timeline.

Both have tests (`test/logs-tail.test.ts`, 7 cases) because the tailer is what AGENTS.md tells you to
run first: an output that reorders history is worse than no output. Startup now reads:

```
users seeded        (LibraryStore.seedUsers)
genre provider      (describeProvider)
server ready        (onReady)
HTTP POST …/ext-logs (preHandler)
ext logs ingested   (ext-logs)
-> 200 POST …/ext-logs in 2ms  (onResponse)
```

`back` 68 tests, `ext` 27, `web` 17.
