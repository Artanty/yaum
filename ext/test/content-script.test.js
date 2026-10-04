// Exercises the SHIPPED content.js against the virtualised fixture, rather than the copy of the
// walk logic that lives inside fixture.html. content.js is loaded for real and driven through the
// same SCAN message the popup sends, with a minimal chrome.* stub standing in for the extension.
//
// Run: npx playwright test test/content-script.test.js
const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const FIXTURE = "file://" + path.join(__dirname, "fixture.html");
const CONTENT_JS = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const LOG_JS = fs.readFileSync(path.join(__dirname, "..", "log.js"), "utf8");

// Stands in for the extension: captures the SCAN listener content.js registers, and exposes a
// scan() helper that invokes it and resolves with whatever it passes to sendResponse. Installed
// just before content.js is injected, which is the only moment it touches chrome.*.
const installChromeStub = () => {
  const listeners = [];
  window.chrome = {
    runtime: {
      onMessage: {
        addListener: (fn) => listeners.push(fn),
      },
      sendMessage: () => Promise.resolve(),
    },
  };
  window.__scan = () =>
    new Promise((resolve, reject) => {
      const fn = listeners.find(Boolean);
      if (!fn) return reject(new Error("content.js registered no onMessage listener"));
      const timer = setTimeout(() => reject(new Error("SCAN never responded")), 150_000);
      fn({ type: "SCAN" }, { id: 1 }, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      return undefined;
    });
};

test("shipped content.js walks the virtualised fixture and returns every track", async ({ page }) => {
  // the walk deliberately dawdles (1.5s per 400px step, plus a render retry) because a real
  // Yandex page needs time to swap rows in — a full down-then-up pass over the fixture is ~35s
  test.setTimeout(180_000);
  await page.goto(FIXTURE);
  await page.evaluate(installChromeStub);
  await page.addScriptTag({ content: CONTENT_JS });
  // let the fixture's own bookkeeping walk settle so the two walks cannot interleave
  await page.waitForFunction(() => window.__walkDone === true);

  const res = await page.evaluate(() => window.__scan());
  expect(res.ok).toBe(true);

  const titles = res.data.tracks.map((t) => t.title);
  expect(res.data.count).toBe(40);
  expect(titles).toContain("song 1");
  expect(titles).toContain("song 40");
  // dedup by title: one entry per unique song, never a second copy of a re-rendered row
  expect(new Set(titles).size).toBe(40);

  // the parsed shape is what /api/library/scan stores
  const first = res.data.tracks.find((t) => t.title === "song 3");
  expect(first).toMatchObject({ title: "song 3", artists: ["artist 4"], album: "album 1" });
  expect(typeof first.durationS).toBe("number");
});

test("a page with tracks but no scroller still returns them", async ({ page }) => {
  // regression: walk() used to early-return before absorb() when no virtualised scroller was
  // found, so such a page scanned as zero tracks even though rows were rendered.
  await page.setContent(`
    <div class="CommonTrack_root">
      <div class="Meta_title">no scroller song</div>
      <div class="Meta_artists">someone</div>
      <div class="Meta_albumLink">an album</div>
      <div class="CommonControlsBar_duration">2:05</div>
    </div>
  `);
  await page.evaluate(installChromeStub);
  await page.addScriptTag({ content: CONTENT_JS });

  const res = await page.evaluate(() => window.__scan());
  expect(res.ok).toBe(true);
  expect(res.data.count).toBe(1);
  expect(res.data.tracks[0]).toMatchObject({
    title: "no scroller song",
    artists: ["someone"],
    album: "an album",
    durationS: 125,
  });
});

test("an empty page scans as zero tracks rather than throwing", async ({ page }) => {
  await page.setContent("<div>nothing here</div>");
  await page.evaluate(installChromeStub);
  await page.addScriptTag({ content: CONTENT_JS });

  const res = await page.evaluate(() => window.__scan());
  expect(res.ok).toBe(true);
  expect(res.data.count).toBe(0);
  expect(res.data.tracks).toEqual([]);
});

test("a scan leaves a trace explaining what it saw", async ({ page }) => {
  // The point of the trace: a zero-track scan must record WHY, not just return 0.
  await page.setContent(`
    <div class="CommonTrack_root">
      <div class="Meta_title">traced song</div>
      <div class="Meta_artists">someone</div>
    </div>
  `);
  await page.evaluate(installChromeStub);
  await page.addScriptTag({ content: LOG_JS });
  await page.addScriptTag({ content: CONTENT_JS });

  const entries = await page.evaluate(async () => {
    await window.__scan();
    return plstLog.entries();
  });

  const start = entries.find((e) => e.msg === "SCAN received");
  expect(start).toBeTruthy();
  expect(start.scope).toBe("content");
  // The two facts that decide whether a walk can work at all.
  expect(start.data.scroller).toEqual({ found: false });
  expect(start.data.trackRows).toBe(1);

  const done = entries.find((e) => e.msg === "SCAN finished");
  expect(done).toBeTruthy();
  expect(done.data.tracks).toBe(1);
});

test("a zero-track scan is logged as a warning with the row count", async ({ page }) => {
  await page.setContent("<div>no tracks rendered</div>");
  await page.evaluate(installChromeStub);
  await page.addScriptTag({ content: LOG_JS });
  await page.addScriptTag({ content: CONTENT_JS });

  const entries = await page.evaluate(async () => {
    await window.__scan();
    return plstLog.entries();
  });

  const warn = entries.find((e) => e.level === "warn" && /collected 0 tracks/.test(e.msg));
  expect(warn).toBeTruthy();
  expect(warn.data.trackRows).toBe(0);
  // The relay to the popup is fire-and-forget, and must not be able to break the walk.
  expect(entries.some((e) => e.msg === "SCAN finished" && e.data.tracks === 0)).toBe(true);
});
