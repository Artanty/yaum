(() => {
  const msg = document.getElementById("msg");
  const btn = document.getElementById("scan");
  const out = document.getElementById("out");
  const log = document.getElementById("log");
  const openside = document.getElementById("openside");
  const copyBtn = document.getElementById("copyJson");
  const stopBtn = document.getElementById("stopScan");

  let accumulated = [];

  const setMsg = (s) => { msg.textContent = s; };

  const grow = (items) => {
    accumulated = items ?? accumulated;
    out.value = JSON.stringify(accumulated, null, 2);
    out.scrollTop = out.scrollHeight;
    copyBtn.disabled = accumulated.length === 0;
  };

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