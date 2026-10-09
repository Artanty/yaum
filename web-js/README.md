# plst web (plain JS, build-free)

A deliberately minimal probe app: the same plst library front end (5 routes + shell) written in
plain ES modules, with **no bundler, no framework, no npm**. It exists to test whether the Surge
deploy failure was caused by the built React bundle — this app ships only a handful of small files.

- Serve the folder with any static server and point `/api` at the backend (`back/`, default
  `http://127.0.0.1:8000`). There is no dev proxy here because there is no build tool.
- `index.html` + `src/*.js` + `styles.css` are served as-is; the Surge workflow publishes the repo
  root and copies `index.html` to `200.html` for the SPA fallback.
- `200.html` is committed too, so a manual `surge publish` gets deep-link fallback as well. It is a
  copy of `index.html` and **must be kept in sync with it** (the workflow's `cp` covers CI, but not a
  local publish).
- The surge CLI can hang on a `CDN: 0%` bar even after the upload lands. Use `./deploy.sh` instead:
  it runs the real publish, polls the live URL for a per-run marker, and prints `OK` + the URL (or a
  failure with the CLI log tail). Requires `surge login` to have been run once.

## Surge CLI hang: a patch we tried and reverted

`surge publish` can reach `upload: 100%` / `CDN: 0–100%` and then **hang** without printing
`Success!`: the server keeps its NDJSON response stream open, and this CLI only declares success when
that stream ends. The files are usually live anyway — **verify by URL, never the bar**:

```
curl -I https://<domain>.surge.sh/index.html     # 200 ⇒ deployed
```

**Patch attempt (2026-10-09):** we edited the global `surge` install's `surge-stream/lib/stream.js`
to (a) send `Connection: close`, and (b) force-emit `success` a few seconds after the `upload`
progress frame hit 100%, so the command would exit. **Removed because it was a false positive**:
upload=100% only proves every byte was received — it does not prove the server accepted the deploy.
The protocol treats success as "an `info` verdict frame arrived" (the same gate the natural
stream-end uses); inventing success without that frame can report a failed deploy as published and
mask a late `fail`/`collect` verdict. No global tools are patched on this machine.

**What to use instead:** `./deploy.sh` — runs the real `surge publish`, then polls the live URL for
a per-run marker before printing `OK`/`FAIL` (exit 0/1). The verdict is the site itself, so it
cannot say `OK` unless the deploy is actually live.

The full React app this was reduced from lives in `web-react/`; the original Angular app in
`web-angular/`. `web/` (repo root) is now only a minimal 3-file smoke-test site (`200.html` +
`ui.js` + `CNAME`) used to confirm a tiny publish goes live.
