(() => {
  // Reads the already-rendered Yandex Music page DOM in the user's logged-in tab.
  // No network/fetch/token (rule 3 honest) — the DOM is a proven 200 from the user's own session,
  // so nothing here can ever hit the WAF/403 wall that blocked every API/undici path this session.
  const TOKEN_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

  function readLoggedInIdentity() {
    const meta = document.querySelector('meta[name="csrf-token"]')?.content ?? "";
    return { hasCsrf: Boolean(meta), pageUrl: location.href };
  }

  function repoRows() {
    const trackLike = Array.from(document.querySelectorAll('[class*="CommonTrack_root"], div[class*="HorizontalCardContainer"]'))
      .filter((el) => el.textContent?.trim());
    const out = [];
    const seen = new Set();
    for (const r of trackLike) {
      const title = r.querySelector('[class*="Meta_title"]')?.textContent?.trim() ?? "";
      const artistsTxt = r.querySelector('[class*="Meta_artists"]')?.textContent?.trim() ?? "";
      const albumTxt = r.querySelector('.d-track__album')?.textContent?.trim() ?? "";
      const durTxt = r.querySelector('.d-track__duration')?.textContent?.trim() ?? "";
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
