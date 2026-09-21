(() => {
  const msg = document.getElementById("msg");
  const btn = document.getElementById("scan");
  const out = document.getElementById("out");

  function setMsg(s) {
    msg.textContent = s;
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    setMsg("Scanning the rendered page in your tab…");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("no active tab");
      const res = await chrome.tabs.sendMessage(tab.id, { type: "SCAN" });
      if (!res?.ok) throw new Error(res?.error ?? "no reply");
      const d = res.data;
      out.value = JSON.stringify(d.tracks, null, 2);
      const json = JSON.stringify(d.tracks);
      await navigator.clipboard.writeText(json);
      setMsg(`✓ ${d.count} tracks (dedup'd) copied to clipboard → paste into the migrator.`);
    } catch (e) {
      setMsg(`✗ ${String(e?.message ?? e)} — make sure this tab is a music.yandex page.`);
    } finally {
      btn.disabled = false;
    }
  });
})();
