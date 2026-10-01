(() => {
  const msg = document.getElementById("msg");
  const btn = document.getElementById("scan");
  const out = document.getElementById("out");
  const log = document.getElementById("log");
  const openside = document.getElementById("openside");
  const copyBtn = document.getElementById("copyJson");
  const stopBtn = document.getElementById("stopScan");

  const convertBtn = document.getElementById("convert");
  const importBtn = document.getElementById("import");
  const serverInput = document.getElementById("server");
  const saveServerBtn = document.getElementById("saveServer");
  const userIdInput = document.getElementById("userId");
  const sumEl = document.getElementById("sum");
  const resEl = document.getElementById("res");
  const copyLinksBtn = document.getElementById("copyLinks");
  const openJob = document.getElementById("openJob");
  const diaglog = document.getElementById("diaglog");
  const copyLogBtn = document.getElementById("copyLog");
  const shipLogBtn = document.getElementById("shipLog");
  const logShip = document.getElementById("logship");
  const openLogBtn = document.getElementById("openLog");
  const clearLogBtn = document.getElementById("clearLog");

  const DEFAULT_SERVER = "http://127.0.0.1:8000";
  // No login yet: the yaum web app just switches a user id, so the popup does the same.
  const DEFAULT_USER_ID = 1;
  // Same rule as cli.ts and job.ejs: a non-perfect score is never "just fine", it wants a human look.
  const PERFECT = 0.9995;
  const POLL_MS = 2000;

  let accumulated = [];
  let links = [];
  let pollTimer = null;
  // Ships the log on a timer while the popup is open; the interval dies with the page.
  let shipTimer = null;

  const setMsg = (s) => {
    msg.textContent = s;
    yaumLog.info("popup", "status", { text: s });
  };
  const show = (el, on) => el.classList.toggle("hidden", !on);
  const base = () => serverInput.value.trim().replace(/\/+$/, "") || DEFAULT_SERVER;
  const userId = () => {
    const n = Number(userIdInput.value);
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_USER_ID;
  };

  // Every network call goes through here, so a failure always has the URL, the status and the
  // body that came back. "It did nothing" is nearly always one of these four facts.
  const call = async (url, init) => {
    const started = Date.now();
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      // A network-level throw (DNS, refused connection, blocked by permissions) never produces a
      // status, so log the cause explicitly — this is the "is the server even running" branch.
      yaumLog.error("popup", "fetch failed before any response", {
        url,
        method: init?.method ?? "GET",
        server: base(),
        error: String(e?.message ?? e),
      });
      throw e;
    }
    const ms = Date.now() - started;
    const body = await res.text();
    if (res.ok) {
      yaumLog.info("popup", `${init?.method ?? "GET"} ${new URL(url).pathname}`, {
        status: res.status,
        ms,
      });
    } else {
      yaumLog.error("popup", `${init?.method ?? "GET"} ${new URL(url).pathname} failed`, {
        status: res.status,
        ms,
        // The server sends plain text for every deliberate 4xx, so this is the reason.
        body: body.slice(0, 500),
      });
    }
    if (!res.ok) throw new Error(body.trim() || `HTTP ${res.status}`);
    // url is the post-redirect URL, which is the only place a 303's target is visible cross-origin.
    return { text: body, url: res.url };
  };

  serverInput.value = localStorage.getItem("mush.server") || DEFAULT_SERVER;
  userIdInput.value = localStorage.getItem("yaum.userId") || String(DEFAULT_USER_ID);

  const grow = (items) => {
    accumulated = items;
    out.value = JSON.stringify(accumulated, null, 2);
    out.scrollTop = out.scrollHeight;
    copyBtn.disabled = accumulated.length === 0;
    convertBtn.disabled = accumulated.length === 0;
    importBtn.disabled = accumulated.length === 0;
    // Both next steps matter and neither one happens on its own, so name both. Leaving out the
    // import here is what makes a successful scan look like it should already be in the database.
    if (accumulated.length) {
      setMsg(
        `✓ ${items.length} tracks (dedup'd), read from the page — not saved yet. ` +
        `Press "2 · Import into my library" to store them, or "3 · Convert with mush" for links.`
      );
    }
  };

  /* ---------- mush conversion ---------- */

  // application/x-www-form-urlencoded is CORS-safelisted, so there is no preflight; it is also what
  // @fastify/formbody on the server already parses.
  const postForm = async (path, fields) => {
    const body = new URLSearchParams(fields).toString();
    return await call(base() + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "follow",
    });
  };

  // An https:// host outside the static host_permissions needs a grant before fetch will reach it.
  const ensurePermission = async (url) => {
    const origin = new URL(url).origin + "/*";
    const granted = await chrome.permissions.contains({ origins: [origin] });
    if (granted) {
      yaumLog.info("popup", "host permission already granted", { origin });
      return true;
    }
    // A denied prompt is silent in the UI otherwise, and it is the reason a fetch that works in a
    // terminal fails here.
    yaumLog.warn("popup", "host permission not granted, prompting", { origin });
    const ok = await chrome.permissions.request({ origins: [origin] });
    yaumLog.info("popup", "host permission result", { origin, granted: ok });
    return ok;
  };

  const escapeHtml = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const render = (job, items) => {
    const s = (job.summary_json ? JSON.parse(job.summary_json) : [{}])[0] || {};
    sumEl.textContent =
      `job ${job.id} · ${job.status} · ${job.processed}/${job.total} tracks\n` +
      `matched ${s.matched ?? 0}  uncertain ${s.uncertain ?? 0}  not found ${s.not_found ?? 0}` +
      (s.skipped_dup ? `  dups ${s.skipped_dup}` : "");
    links = items.filter((i) => i.yt_video_id)
      .map((i) => `https://music.youtube.com/watch?v=${i.yt_video_id}`);
    resEl.textContent = "";
    for (const it of items) {
      const li = document.createElement("li");
      const flag = it.score != null && it.score > 0 && it.score < PERFECT;
      const name = it.yt_video_id
        ? `<a href="https://music.youtube.com/watch?v=${it.yt_video_id}" target="_blank">${escapeHtml(it.yt_artist)} — ${escapeHtml(it.yt_title)}</a>`
        : `<span class="no">— nothing found —</span>`;
      li.innerHTML =
        `${escapeHtml(it.src_artist)} — ${escapeHtml(it.src_title)}<br>` +
        `↳ ${name} <span class="meta">${it.score != null ? it.score.toFixed(2) : ""}` +
        `${flag ? ' <span class="flag">⚠ review</span>' : ""} · ${escapeHtml(it.status)}</span>`;
      resEl.appendChild(li);
    }
    show(sumEl, true);
    show(resEl, true);
    show(copyLinksBtn, links.length > 0);
    openJob.href = `${base()}/job/${job.id}`;
    openJob.classList.remove("hidden");
  };

  const poll = async (id) => {
    try {
      const data = JSON.parse((await call(`${base()}/job/${id}?format=json`)).text);
      setMsg(`matching on the server… ${data.job.processed}/${data.job.total} tracks`);
      if (data.job.status === "done" || data.job.status === "failed") {
        render(data.job, data.items ?? []);
        const bad = (data.items ?? []).filter((i) => i.score != null && i.score > 0 && i.score < PERFECT).length;
        setMsg(
          `✓ ${data.job.status} — ${links.length} links` +
          (bad ? `, ${bad} flagged ⚠ for review (a wrong-but-confident match must never hide).` : ".")
        );
        return;
      }
      pollTimer = setTimeout(() => poll(id), POLL_MS);
    } catch (e) {
      setMsg(`✗ ${String(e?.message ?? e)} — the job ${id} may still be running on the server.`);
    }
  };

  convertBtn.addEventListener("click", async () => {
    clearTimeout(pollTimer);
    convertBtn.disabled = true;
    setMsg("Sending tracks to mush…");
    try {
      if (!(await ensurePermission(base()))) throw new Error("permission denied for this server");
      const { url } = await postForm("/migrate", { mode: "json", source: JSON.stringify(accumulated) });
      const id = /\/job\/([A-Za-z0-9_-]+)/.exec(url ?? "")?.[1];
      if (!id) throw new Error(`no job id in ${res.url}`);
      setMsg("accepted — waiting for the server…");
      await poll(id);
    } catch (e) {
      setMsg(`✗ ${String(e?.message ?? e)} — is the mush server running at ${base()}?`);
    } finally {
      convertBtn.disabled = accumulated.length === 0;
    }
  });

  copyLinksBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(links.join("\n"));
      setMsg(`✓ ${links.length} YouTube Music links copied.`);
    } catch (e) {
      setMsg("✗ " + String(e?.message ?? e));
    }
  });

  /* ---------- yaum library import ---------- */

  // Unlike /migrate this needs a JSON body, so it does preflight: that is why the app server
  // carries CORS headers and the popup asks for the host permission first.
  importBtn.addEventListener("click", async () => {
    importBtn.disabled = true;
    setMsg("Importing into the yaum library…");
    // Logged before the request: if the popup is closed mid-flight, the log still shows that an
    // import was ATTEMPTED, which is what makes "I clicked it and nothing happened" answerable.
    yaumLog.info("popup", "import requested", {
      server: base(),
      userId: userId(),
      tracks: accumulated.length,
    });
    try {
      if (!(await ensurePermission(base()))) throw new Error("permission denied for this server");
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const body = JSON.stringify({
        userId: userId(),
        pageUrl: tab?.url ?? null,
        label: tab?.title ?? null,
        tracks: accumulated,
      });
      const { text } = await call(`${base()}/api/library/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const r = JSON.parse(text);
      void globalThis.yaumShip.ship().then(showShipStatus);
      yaumLog.info("popup", "import accepted", {
        importId: r.importId,
        newCount: r.newCount,
        dupCount: r.dupCount,
        skippedCount: r.skippedCount,
        pendingImports: r.pendingImports,
        user: r.user?.username,
      });
      setMsg(
        `✓ import #${r.importId} — ${r.newCount} new, ${r.dupCount} already in the library` +
        (r.skippedCount ? `, ${r.skippedCount} skipped` : "") +
        `. Open the web app → Imports to review and turn it into a playlist.`
      );
    } catch (e) {
      yaumLog.error("popup", "import failed", { error: String(e?.message ?? e), server: base() });
    void globalThis.yaumShip.ship().then(showShipStatus);
      setMsg(`✗ ${String(e?.message ?? e)} — is the yaum server running at ${base()}?`);
    } finally {
      importBtn.disabled = accumulated.length === 0;
    }
  });

  saveServerBtn?.addEventListener("click", () => {
    const v = base();
    serverInput.value = v;
    localStorage.setItem("mush.server", v);
    setMsg(`✓ server URL saved: ${v}`);
  });

  userIdInput?.addEventListener("change", () => {
    const v = userId();
    userIdInput.value = String(v);
    localStorage.setItem("yaum.userId", String(v));
    setMsg(`✓ importing as user ${v} (${userId() === DEFAULT_USER_ID ? "the default" : "set in this popup"}).`);
  });

  openside?.addEventListener("click", async () => {
    openside.disabled = true;
    setMsg("Opening the side panel…");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.sidePanel.open({ tabId: tab?.id });
      setMsg("Side panel opened → use its Scan button.");
    } catch (e) {
      setMsg(`✗ ${String(e?.message ?? e)} — side panel needs Chrome 116+ and this popup's gesture.`);
    } finally {
      openside.disabled = false;
    }
  });

  chrome.runtime.onMessage.addListener((m) => {
    // The content script's own trace, relayed into this buffer so a scan that failed inside the
    // page is visible from the popup's log.
    if (m?.type === "SCAN_LOG") {
      const send = m.level === "error" ? yaumLog.error : m.level === "warn" ? yaumLog.warn : yaumLog.info;
      send("page", m.msg, m.data);
      return;
    }
    if (m?.type !== "SCAN_STEP") return;
    for (const nm of m.names ?? []) log.value += `parsed "${nm}"\n`;
    log.scrollTop = log.scrollHeight;
    grow(m.items);
  });

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    setMsg("Scanning the rendered page in your tab…");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("no active tab");
      yaumLog.info("popup", "scan requested", { tabId: tab.id, url: tab.url?.slice(0, 200) });
      const res = await chrome.tabs.sendMessage(tab.id, { type: "SCAN" });
      if (!res?.ok) throw new Error(res?.error ?? "no reply");
      grow(res.data.tracks);
      // grow() already set the right next-step message; don't overwrite it with a vaguer one.
      if (!res.data.count) setMsg("✗ no tracks found on this page — is the tracklist rendered?");
    } catch (e) {
      // "Receiving end does not exist" means the content script is not in that tab at all — the
      // single most common scan failure, so it gets its own line in the log.
      const msgText = String(e?.message ?? e);
      void globalThis.yaumShip.ship().then(showShipStatus);
      yaumLog.error("popup", "scan failed", {
        error: msgText,
        hint: /Receiving end does not exist/i.test(msgText)
          ? "the content script is not in that tab (not a music.yandex.ru/.kz page?)"
          : undefined,
      });
      setMsg(`✗ ${msgText} — make sure this tab is a music.yandex page.`);
    } finally {
      btn.disabled = false;
    }
  });

  copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(out.value || "[]");
      setMsg(`✓ JSON copied (${accumulated.length} tracks).`);
    } catch (e) {
      setMsg("✗ " + String(e?.message ?? e));
    }
  });

  /* ---------- diagnostics log ---------- */

  // Loaded from storage first so a trace from a previous popup session is already on screen —
  // the whole point is that the evidence outlives the surface that produced it.
  yaumLog.init().then((entries) => {
    if (entries.length) {
      diaglog.value = yaumLog.text();
      diaglog.scrollTop = diaglog.scrollHeight;
    }
    // A boot line, so the log records that the popup was opened at all and — crucially — WHICH
    // server and user it resolved to. A report of "I clicked import and nothing happened" is
    // unanswerable without this: the usual cause is a popup pointed at the wrong server.
    yaumLog.info("popup", "opened", {
      version: chrome.runtime.getManifest().version,
      server: base(),
      userId: userId(),
      // From storage, not the inputs: this is what a previous session actually chose.
      savedServer: localStorage.getItem("mush.server"),
      savedUserId: localStorage.getItem("yaum.userId"),
      restoredEntries: entries.length,
      extensionId: chrome.runtime.id,
    });
    // Ship what is already here (including the line just written above), then start the timer.
    void globalThis.yaumShip.ship().then(showShipStatus);
    shipTimer = setInterval(() => void globalThis.yaumShip.ship().then(showShipStatus), 45_000);
    // pagehide rather than unload: keepalive fetches are the only ones allowed to finish on close.
    globalThis.addEventListener("pagehide", () => void globalThis.yaumShip.ship({ force: true }));
  });
  // Re-render as things happen, throttled: the walk logs per step and a textarea rewrite per
  // entry would be the slowest thing in the popup.
  let logPaint = null;
  const repaint = () => {
    if (logPaint) return;
    logPaint = setTimeout(() => {
      logPaint = null;
      const atBottom = diaglog.scrollTop + diaglog.clientHeight >= diaglog.scrollHeight - 8;
      diaglog.value = yaumLog.text();
      if (atBottom) diaglog.scrollTop = diaglog.scrollHeight;
    }, 250);
  };
  const origInfo = yaumLog.info;
  yaumLog.info = (...a) => { const r = origInfo.apply(yaumLog, a); repaint(); return r; };
  const origWarn = yaumLog.warn;
  yaumLog.warn = (...a) => { const r = origWarn.apply(yaumLog, a); repaint(); return r; };
  const origError = yaumLog.error;
  yaumLog.error = (...a) => { const r = origError.apply(yaumLog, a); repaint(); return r; };

  // ---------------------------------------------------------------- ship to backend
  //
  // The log above dies with this browser profile. Shipping it to the backend is what makes it
  // checkable later ("the extension really did log nothing") instead of a claim. Automatic on open
  // (so leftovers from a previous session go out) and after a scan or import (so the interesting
  // part is not left sitting in storage), plus this button for "send it now".
  const showShipStatus = () => {
    if (logShip) logShip.textContent = globalThis.yaumShip?.describe?.() ?? "shipping unavailable";
  };
  shipLogBtn?.addEventListener("click", async () => {
    showShipStatus();
    await globalThis.yaumShip.ship({ force: true });
    showShipStatus();
  });

  copyLogBtn?.addEventListener("click", async () => {
    try {
      await yaumLog.flush();
      await navigator.clipboard.writeText(yaumLog.text() || "(log is empty)");
      setMsg("✓ logs copied — paste them into the bug report.");
    } catch (e) {
      setMsg("✗ " + String(e?.message ?? e));
    }
  });
  openLogBtn?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("logs.html") });
  });
  clearLogBtn?.addEventListener("click", () => {
    yaumLog.clear();
    diaglog.value = "–– log cleared ––";
  });

  stopBtn?.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      if (t?.id) chrome.tabs.sendMessage(t.id, { type: "SCAN_STOP" }).catch(() => {});
    });
    log.value += "[stopped by you] — the walk halts on its next scroll check.\n";
    setMsg("Stop requested.");
  });
})();