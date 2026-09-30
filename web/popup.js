(() => {
  const msg = document.getElementById("msg");
  const btn = document.getElementById("scan");
  const out = document.getElementById("out");
  const log = document.getElementById("log");
  const openside = document.getElementById("openside");
  const copyBtn = document.getElementById("copyJson");
  const stopBtn = document.getElementById("stopScan");

  const convertBtn = document.getElementById("convert");
  const serverInput = document.getElementById("server");
  const saveServerBtn = document.getElementById("saveServer");
  const sumEl = document.getElementById("sum");
  const resEl = document.getElementById("res");
  const copyLinksBtn = document.getElementById("copyLinks");
  const openJob = document.getElementById("openJob");

  const DEFAULT_SERVER = "http://127.0.0.1:8000";
  // Same rule as cli.ts and job.ejs: a non-perfect score is never "just fine", it wants a human look.
  const PERFECT = 0.9995;
  const POLL_MS = 2000;

  let accumulated = [];
  let links = [];
  let pollTimer = null;

  const setMsg = (s) => { msg.textContent = s; };
  const show = (el, on) => el.classList.toggle("hidden", !on);
  const base = () => serverInput.value.trim().replace(/\/+$/, "") || DEFAULT_SERVER;

  serverInput.value = localStorage.getItem("mush.server") || DEFAULT_SERVER;

  const grow = (items) => {
    accumulated = items;
    out.value = JSON.stringify(accumulated, null, 2);
    out.scrollTop = out.scrollHeight;
    copyBtn.disabled = accumulated.length === 0;
    convertBtn.disabled = accumulated.length === 0;
    if (accumulated.length) setMsg(`✓ ${items.length} tracks (dedup'd). Now press "Convert with mush".`);
  };

  /* ---------- mush conversion ---------- */

  // application/x-www-form-urlencoded is CORS-safelisted, so there is no preflight; it is also what
  // @fastify/formbody on the server already parses.
  const postForm = async (path, fields) => {
    const res = await fetch(base() + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      redirect: "follow",
    });
    if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
    return res;
  };

  // An https:// host outside the static host_permissions needs a grant before fetch will reach it.
  const ensurePermission = async (url) => {
    const origin = new URL(url).origin + "/*";
    const granted = await chrome.permissions.contains({ origins: [origin] });
    if (granted) return true;
    return await chrome.permissions.request({ origins: [origin] });
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
      const res = await fetch(`${base()}/job/${id}?format=json`);
      if (!res.ok) throw new Error(`poll failed: HTTP ${res.status}`);
      const data = await res.json();
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
      const res = await postForm("/migrate", { mode: "json", source: JSON.stringify(accumulated) });
      // The 303 Location header is not readable cross-origin, but response.url is.
      const id = /\/job\/([A-Za-z0-9_-]+)/.exec(res.url)?.[1];
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

  saveServerBtn?.addEventListener("click", () => {
    const v = base();
    serverInput.value = v;
    localStorage.setItem("mush.server", v);
    setMsg(`✓ server URL saved: ${v}`);
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
      const res = await chrome.tabs.sendMessage(tab.id, { type: "SCAN" });
      if (!res?.ok) throw new Error(res?.error ?? "no reply");
      grow(res.data.tracks);
      setMsg(`✓ ${res.data.count} tracks (dedup'd). Press "Copy JSON" to copy.`);
    } catch (e) {
      setMsg(`✗ ${String(e?.message ?? e)} — make sure this tab is a music.yandex page.`);
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

  stopBtn?.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      if (t?.id) chrome.tabs.sendMessage(t.id, { type: "SCAN_STOP" }).catch(() => {});
    });
    log.value += "[stopped by you] — the walk halts on its next scroll check.\n";
    setMsg("Stop requested.");
  });
})();