(() => {
  const STEP_PX = 400; // ask 4 byte-verbatim "scroll step - 400px." - exactly 400px per move (rule 3)
  const SCROLLER_SEL = '[data-test-id*="virtuoso-scroller"], [data-virtuoso-scroller], [class*="virtuoso-scroller"]';
  const TRACK_LIKE = '[class*="CommonTrack_root"], [class*="HorizontalCardContainer"]';

  const seen = () => {
    const out = [];
    for (const r of document.querySelectorAll(TRACK_LIKE)) {
      const t = r.querySelector("[class*=\"Meta_title\"]")?.textContent?.trim() ?? "";
      if (!t) continue;
      const a = r.querySelector("[class*=\"Meta_artists\"]")?.textContent?.trim() ?? "";
      const al = r.querySelector("[class*=\"Meta_albumLink\"]")?.textContent?.trim() ?? "";
      const d = r.querySelector("[class*=\"duration\"], [class*=\"CommonControlsBar_duration\"]")?.textContent?.trim() ?? "";
      const m = d.match(/^(\d+):(\d+)$/);
      out.push({ title: t, artists: a.split(",").map((s) => s.trim()).filter(Boolean), album: al || null, durationS: m ? +m[2] + 60 * +m[1] : null });
    }
    const uniq = new Set(); return out.filter((r) => { const k = r.title + "|" + r.artists.join(","); if (uniq.has(k)) return false; uniq.add(k); return true; });
  };

  // ACCUMULATOR: every rendered row goes in once; up-pass ADD MISSED ITEMS into it.
  const ACC = new Map();
  let stopped = false;
  const absorb = () => {
    for (const s of seen()) {
      if (!ACC.has(s.title)) ACC.set(s.title, s);
    }
    return ACC.size;
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const collectWithRetry = async () => {
    let last = 0;
    for (let i = 0; i < 5; i += 1) {
      await wait(1000);
      const n = absorb();
      if (n > last) { last = n; continue; }
      return n;
    }
    return last;
  };

  const emit = (step, scrollTop) => {
    try { chrome.runtime.sendMessage({ type: "SCAN_STEP", step, total: ACC.size, scrollTop, names: [...ACC.values()].slice(-10).map((t) => t.title), items: [...ACC.values()] }); } catch {}
  };

  const down = (scroller, onProgress) => new Promise((resolve) => {
    scroller.scrollTop = 0;
    onProgress?.(absorb());
    let steps = 0;
    const maxSteps = Math.ceil((scroller.scrollHeight - scroller.clientHeight) / STEP_PX) + 3;
    const tick = async () => {
      await wait(1500);
      if (stopped) { resolve(); return; }
      const n = await collectWithRetry();
      onProgress?.(n);
      emit(steps, scroller.scrollTop);
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (!atBottom && steps < maxSteps) {
        scroller.scrollTop = Math.min(scroller.scrollTop + STEP_PX, scroller.scrollHeight);
        steps += 1;
        return tick();
      }
      resolve();
    };
    tick();
  });

  const up = (scroller, onProgress) => new Promise((resolve) => {
    let steps = 0;
    const maxSteps = Math.ceil((scroller.scrollHeight - scroller.clientHeight) / STEP_PX) + 3;
    const tick = async () => {
      await wait(1500);
      if (stopped) { resolve(); return; }
      const n = await collectWithRetry();
      onProgress?.(n);
      emit(steps, scroller.scrollTop);
      if (scroller.scrollTop <= 0 || steps >= maxSteps) {
        resolve();
        return;
      }
      scroller.scrollTop = Math.max(0, scroller.scrollTop - STEP_PX);
      steps += 1;
      return tick();
    };
    tick();
  });

  const walk = async (onProgress) => {
    const scroller = document.querySelector(SCROLLER_SEL);
    if (!scroller) return Promise.resolve([...ACC.values()]);
    // FIRST RUN: top -> bottom, collecting everything that renders.
    await down(scroller, onProgress);
    // SECOND RUN: bottom -> top, ADD MISSED ITEMS (re-rendered rows that skipped before).
    await up(scroller, onProgress);
    onProgress?.(absorb());
    return [...ACC.values()];
  };

  chrome.runtime.onMessage.addListener((msg, _s, sr) => {
    if (msg?.type === "SCAN_STOP") { stopped = true; sr({ ok: true }); return; }
    if (msg?.type !== "SCAN") return;
    stopped = false;
    ACC.clear();
    walk(() => {}).then((t) => sr({ ok: true, data: { tracks: t, count: t.length } })).catch((e) => sr({ ok: false, error: String(e?.message ?? e) }));
    return true;
  });
})();