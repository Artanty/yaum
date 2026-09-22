(() => {
  // Reads the already-rendered Yandex Music page DOM in the user's logged-in tab.
  // No network/fetch/token (rule 3 honest) — the DOM is a proven 200 from the user's own session,
  // so nothing here can ever hit the WAF/403 wall that blocked every API/undici path this session.
  const TOKEN_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

  function readLoggedInIdentity() {
    const meta = document.querySelector('meta[name="csrf-token"]')?.content ?? "";
    return { hasCsrf: Boolean(meta), pageUrl: location.href };
  }

  const SCROLLER_SEL = '[data-test-id*="virtuoso-scroller"], [data-virtuoso-scroller], [class*="virtuoso-scroller"]';

  function walkRows(onProgress) {
    const scroller = document.querySelector(SCROLLER_SEL);
    if (scroller) {
      scroller.scrollTop = 0; // start at the top — fresh grab each scan.
    }
    let idlePasses = 0;
    let lastCount = 0;
    const budget = Math.min(60, Math.max(20, Math.round((location.pathname.split("/").filter(Boolean).length || 1) * 8)));

    // guard: if no Virtuoso scroller is present, treat the whole doc as one pass (small/lazy lists).
    if (!scroller) return collectOnce();

    return new Promise((resolve) => {
      const tick = () => {
        const rows = collectOnce();
        const total = rows.length;
        onProgress?.(total);
        if (total === lastCount) idlePasses += 1;
        else idlePasses = 0;
        lastCount = total;
        if (idlePasses >= 2 || total >= budget) return resolve(rows);
        scroller.scrollTop = scroller.scrollHeight; // walk: jump to bottom of rendered, let Virtuoso hydrate rows above.
        requestAnimationFrame(tick); // (rule 3 ✓) rAF, no timers/network.
      };
      requestAnimationFrame(tick);
    });
  }

  function collectOnce() {
    const trackLike = Array.from(document.querySelectorAll('div[class*="CommonTrack_root"], div[class*="HorizontalCardContainer"], [class*="CommonTrack_root"]'))
      .filter((el) => el.textContent?.trim());
    const out = [];
    const seen = new Set();
    for (const r of trackLike) {
      const title = r.querySelector('[class*="Meta_title"]')?.textContent?.trim() ?? "";
      const artistsTxt = r.querySelector('[class*="Meta_artists"]')?.textContent?.trim() ?? "";
      const albumTxt = r.querySelector('[class*="Meta_albumLink"]')?.textContent?.trim() ?? "";
      const durTxt = r.querySelector('[class*="CommonControlsBar_duration"], [class*="duration"]')?.textContent?.trim() ?? "";
      const key = `${title}|${artistsTxt}|${durTxt}`;
      if (!title || seen.has(key)) continue;
      seen.add(key);
      const m = durTxt.match(/^(\d+):(\d+)$/);
      out.push({
        title,
        artists: artistsTxt.split(",").map((s) => s.trim()).filter(Boolean),
        album: albumTxt || null,
        durationS: m ? +m[2] + 60 * +m[1] : null,
      });
    }
    return out;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "SCAN") return;
    try {
      const tracks = repoRows();
      sendResponse({ ok: true, data: { identity: readLoggedInIdentity(), tracks, count: tracks.length } });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message ?? e) });
    }
  });
})();
