# DECISIONS

Current thread only. Prior sessions: `DECISIONS-archive.md`.

*(Older entries moved to `DECISIONS-archive.md` to stay under the ~250-line limit per AGENTS.md rule 4 — 2026-09-29 cleanup + the 2026-09-30 web paste-mode/match-cache thread.)*

## 2026-09-30 — PLAN (rule 1): show the mush result inside the extension
User: "i want to see result of work in ext". Today the extension is a dead end — it scrapes tracks and
copies JSON for the CLI, and nothing ever contacts mush, so none of the matching work is visible in it.
Now that POST /migrate accepts mode=json, the extension can be the actual front end for the whole thing.

DECISION: additive, not a rewrite. Copy JSON stays (it is the CLI path and is already tested); a
"Convert with mush" flow is added beside it.
1) web/manifest.json
   - host_permissions for loopback: the documented local server case, statically declared.
   - optional_host_permissions ["https://*/*"]: a deployed (Render) host is granted ON DEMAND via
     chrome.permissions.request() when the user types one. Deliberately not a blanket static grant —
     an unpacked admin tool should not ship permanent network reach it does not need.
   - MV3 lets an extension page fetch a host_permissions origin with NO CORS headers, so the server
     needs no @fastify/cors change. POST as application/x-www-form-urlencoded (CORS-safelisted, and it
     is what @fastify/formbody already parses) so there is not even a preflight.
   - name/description: it converts now, it does not merely list.
2) web/popup.html — server URL input (localStorage, default http://127.0.0.1:8000), "Convert with
   mush" button, results pane (summary counts + one row per track with a YouTube Music link, score,
   status) and "Copy links". Reuse the CLI's review rule (0 < score < 0.9995 -> mark) so the extension
   cannot show a confident-looking wrong link, the same invariant job.ejs and the CLI now share.
3) web/popup.js — postForm(); POST /migrate with redirect:'follow' and take the id from
   response.url, because the 303 Location header is NOT readable cross-origin (not in the CORS
   exposed list) while response.url IS. Poll /job/<id>?format=json every 2s to done/failed, render
   processed/total, then the table. Copy links = watch?v= for every item that has a video_id.
   If the typed host is not covered by a granted permission, ask for it first and say so on failure.
4) VERIFY: node --check; existing playwright test stays green; and prove the exact request sequence the
   extension performs (POST -> follow redirect -> poll -> render) against a live server from Node, so
   the contract is verified even though this box cannot run a real Chrome extension.

## 2026-09-30 — RESULT: the extension is now a real mush client
Shipped. The popup no longer dead-ends at "copy JSON": Scan -> "Convert with mush" -> the matching
result is rendered IN the extension (summary counts, one row per track with a clickable YouTube Music
link, score + status), plus "Copy YouTube Music links" and a link to the full server report.
- manifest 0.1.0 -> 0.2.0, renamed "YaMusic Share → YouTube Music"; it converts now, it does not
  merely list. host_permissions = loopback only; an https host is requested on demand, so an unpacked
  admin tool does not permanently ship network reach it does not need.
- Server URL is a saved setting (localStorage), default http://127.0.0.1:8000, which matches
  server.ts:160 (PORT ?? 8000).
- Kept Copy JSON / Stop / step log / side panel — they are the CLI path and already tested. The convert
  button stays disabled until a scan yields tracks, so it cannot post an empty list.

The extension reuses the review invariant rather than inventing its own: score 0<s<0.9995 is rendered
"⚠ review", identical to cli.ts and job.ejs. A confident-looking wrong link is the one failure mode
that silently ships to the user, so all three surfaces now agree on when to distrust a match.

VERIFIED the exact request sequence popup.js performs, against a live server (Node replay, since this
box cannot load a real unpacked extension):
  POST /migrate (form-encoded, redirect:follow) -> 200, id taken from response.url -> cf74fc31f8d9
  -> poll /job/<id>?format=json -> done 16/16 -> summary {"matched":15,"uncertain":1,"links":16}
  -> 16 clipboard links, first https://music.youtube.com/watch?v=f6z2dS5KHgc
  -> 2 rows flagged ⚠ ("I Don't Feel Like Dancin'" 0.70, "Join Me in Death" 0.80)
Also: node --check popup.js content.js clean; playwright 1/1 still green.
Note the id MUST come from response.url, not the 303 Location header: Location is not in the CORS
exposed-headers list, so a cross-origin extension page cannot read it. That is now recorded in code.

Side benefit observed: this run finished in seconds, because "cache only matched" meant 15 cache hits
and just the one uncertain track was re-searched — exactly the intended behaviour from the previous
entry, and further reason the extension is the right front end (re-runs are cheap).
NOT verified here: real Chrome host_permissions/CORS behaviour and chrome.permissions.request — those
need a human to load the unpacked extension. The server contract they depend on IS verified above.
RULE 5: no commit, nothing staged.

## 2026-09-30 — FIXED: server would not start (Node 18 vs undici@7)
Symptom, on `npm run start` from back/: undici/lib/web/webidl/index.js threw
`ReferenceError: File is not defined` and the process died before listening.
Cause: `File` only became a Node GLOBAL in Node 20; undici@7 reads it at import time. The repo
already said `engines:>=20` and back/.nvmrc already said `20`, but npm only WARNs on an engine
mismatch — it does not stop — so the app ran on Node 18 and died with a stack trace that blames a
dependency instead of the real cause. The shell here defaulted to v18.20.8.
Three node installs were competing on PATH: nvm v18.20.8, nvm v20.19.5, and /usr/local/bin/node
v22.14.0 (the last one wins in a LOGIN shell; nvm wins in an interactive one).
FIX (user chose): `nvm alias default 20.19.5`.
VERIFIED with `env -i` (clean env, no inherited PATH):
  clean interactive -> /Users/.../nvm/versions/node/v20.19.5/bin/node, v20.19.5
  clean login       -> /usr/local/bin/node, v22.14.0 (also satisfies >=20)
  `npm run start` on that clean shell -> /healthz 200, / 200, no errors in the log.
So both shell kinds now clear >=20; Node 18 is unreachable from a new terminal.
TWO GOTCHAS recorded so nobody re-derives them:
- `nvm use` printed "Now using node v20.19.5" while leaving v18 first in PATH (three duplicate v18
  entries). A success message from `nvm use` is NOT proof — always check `node -v`.
- The duplicate-v18 PATH here is an artifact of the agent harness, not the user's terminal. Only
  `env -i ... zsh -i -c` reflects a real new terminal. Do not "fix" .zshrc based on the inherited PATH.
STILL TRUE from earlier entries: Yandex API is 403-walled from this host, and YouTube needs
YTM_PROXY=http://127.0.0.1:8080 (local only; Render has no such route).
NOT done, deliberately: the repo still only warns on old Node. A preflight check in `npm start`
that prints one clear line ("needs Node >=20, found v18") was offered and DECLINED in favour of the
nvm default — so a machine with Node 18 and no nvm still gets the cryptic undici trace.
RULE 5: no commit, nothing staged.
