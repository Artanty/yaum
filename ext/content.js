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
      const d = r.querySelector("[class*=\"duration\"]")?.textContent?.trim() ?? "";
      const m = d.match(/^(\d+):(\d+)$/);
      out.push({ title: t, artists: a.split(",").map((s) => s.trim()).filter(Boolean), album: al || null, durationS: m ? +m[2] + 60 * +m[1] : null });
    }
    return out;
  };

  // ACCUMULATOR: every rendered row goes in once, keyed by title. This is the only dedup —
  // a second pass over the same rows below would be redundant work.
  const ACC = new Map();
  let stopped = false;
  // Walk-level step counter: down() and up() keep their own local counts, and the log needs one
  // number for "how far did the walk get" when a scan is cut short.
  let steps = 0;
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

  const emit = () => {
    const items = [...ACC.values()];
    // No background script exists, so with the popup closed this rejects every scroll step.
    // It is a progress stream only — never let that become an unhandled rejection.
    chrome.runtime.sendMessage({ type: "SCAN_STEP", names: items.slice(-10).map((t) => t.title), items }).catch(() => {});
  };

  // A content script has no chrome.storage access worth relying on and no popup to show a trace in,
  // so it hands its entries to the popup over the same SCAN_STEP channel the walk already uses.
  // If the popup is closed the popup simply misses them — logging must never break the walk.
  const trace = (level, msg, data) => {
    try {
      const send =
        level === "error" ? yaumLog.error : level === "warn" ? yaumLog.warn : yaumLog.info;
      send("content", msg, data);
      chrome.runtime
        .sendMessage({ type: "SCAN_LOG", level, msg, data })
        .catch(() => {});
    } catch {
      /* logging must never break the walk */
    }
  };

  const down = (scroller) => new Promise((resolve) => {
    scroller.scrollTop = 0;
    absorb();
    let steps = 0;
    const maxSteps = Math.ceil((scroller.scrollHeight - scroller.clientHeight) / STEP_PX) + 3;
    const tick = async () => {
      await wait(1500);
      if (stopped) { resolve(); return; }
      await collectWithRetry();
      emit();
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (!atBottom && steps < maxSteps) {
        scroller.scrollTop = Math.min(scroller.scrollTop + STEP_PX, scroller.scrollHeight);
        steps += 1;
        return tick();
      }
      trace("debug", "down pass finished", { steps, collected: ACC.size, atBottom });
      resolve();
    };
    tick();
  });

  const up = (scroller) => new Promise((resolve) => {
    let steps = 0;
    const maxSteps = Math.ceil((scroller.scrollHeight - scroller.clientHeight) / STEP_PX) + 3;
    const tick = async () => {
      await wait(1500);
      if (stopped) { resolve(); return; }
      await collectWithRetry();
      emit();
      if (scroller.scrollTop <= 0 || steps >= maxSteps) {
        trace("debug", "up pass finished", { steps, collected: ACC.size });
        resolve();
        return;
      }
      scroller.scrollTop = Math.max(0, scroller.scrollTop - STEP_PX);
      steps += 1;
      return tick();
    };
    tick();
  });

  const walk = async () => {
    const scroller = document.querySelector(SCROLLER_SEL);
    // No virtualised scroller (short playlist, or a layout we don't recognise): there is nothing
    // to scroll through, so just read what is already rendered. This must still absorb() — the
    // early return used to skip it and hand back zero tracks for a page full of them.
    if (!scroller) {
      absorb();
      return [...ACC.values()];
    }
    // FIRST RUN: top -> bottom, collecting everything that renders.
    await down(scroller);
    // SECOND RUN: bottom -> top, ADD MISSED ITEMS (re-rendered rows that skipped before).
    await up(scroller);
    absorb();
    return [...ACC.values()];
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sr) => {
    if (msg?.type === "SCAN_STOP") {
      stopped = true;
      trace("warn", "stop requested by the user", { collected: ACC.size });
      sr({ ok: true });
      return;
    }
    if (msg?.type !== "SCAN") return;
    stopped = false;
    ACC.clear();
    steps = 0;

    // The three things that decide whether a scan works at all, logged up front so a failure names
    // its cause instead of just reporting zero: was the script even in the right page, is there a
    // scroller to walk, and does the page have any track rows right now?
    trace("info", "SCAN received", {
      url: location.href.slice(0, 200),
      scroller: (() => {
        const s = document.querySelector(SCROLLER_SEL);
        return s ? { found: true, scrollHeight: s.scrollHeight, clientHeight: s.clientHeight } : { found: false };
      })(),
      trackRows: document.querySelectorAll(TRACK_LIKE).length,
    });

    walk()
      .then((t) => {
        trace("info", "SCAN finished", { tracks: t.length, stopped, steps });
        if (!t.length) {
          // The single most common confusing outcome, called out explicitly.
          trace(
            "warn",
            "SCAN collected 0 tracks — selectors matched nothing, or the list is not rendered yet",
            { trackRows: document.querySelectorAll(TRACK_LIKE).length, url: location.href.slice(0, 200) },
          );
        }
        sr({ ok: true, data: { tracks: t, count: t.length } });
      })
      .catch((e) => {
        trace("error", "SCAN threw", { message: String(e?.message ?? e), stack: e?.stack });
        sr({ ok: false, error: String(e?.message ?? e) });
      });
    return true;
  });
})();