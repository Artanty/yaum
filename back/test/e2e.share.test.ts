import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';

/**
 * E2E contract check for the share/album migrator (DECISIONS.md 2026-09-20).
 *
 * WHAT it verifies (the decision 2026-09-20: OAuth token must OWN the resource):
 *  - GET / renders the form (mode=playlist present)
 *  - POST /migrate follows the 303 -> /job/<id> page which renders
 *  - the job ends in a TERMINAL state (done xor failed) with a coherent
 *    shape (summary/items JSON) — never hangs, 500s, or crashes
 *  - album (the live-known 200 path) is the POSITIVE control: it must be
 *    done with tracks>0
 *
 * NOT asserted: whether any given share is owned by YANDEX_TOKEN (that is
 * network/account dependent and changes 200<->403 legitimately by contract,
 * i.e. exactly what the decision says). We assert the shares resolve to a
 * clean, documented terminal state instead.
 *
 * Reproducibility: runs against a LIVE server (default http://127.0.0.1:8000),
 * skipped entirely when it isn't reachable so the unit suite always stays green.
 */

const BASE = process.env.YT_E2E_BASE ?? 'http://127.0.0.1:8000';
const ALBUM = process.env.YT_E2E_ALBUM ?? 'https://music.yandex.ru/album/1193829';
const SHARE =
  process.env.YT_E2E_SHARE ??
  'https://music.yandex.kz/playlists/4f7b10fe-a3dd-6acd-aece-ce1ffd23ca26?utm_source=web';

let browser: Browser;
let reachable = true;

async function live(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

describe('e2e: share/album migrator via real browser', { skip: true }, () => {});

describe('e2e: share/album migrator via real browser', () => {
  beforeAll(async () => {
    reachable = await live(120_000);
    if (!reachable) return;
    browser = await chromium.launch({ headless: !process.env.PW_HEADED });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('GET / renders the form with playlist mode (has share placeholder)', async () => {
    if (!reachable) return;
    const page = await browser.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const mode = page.locator('#mode');
    await expect(mode).toHaveValue('playlist');
    const ph = await page.locator('#source').getAttribute('placeholder');
    expect(ph).toContain('music.yandex');
  });

  it('album (positive control) -> POST /migrate -> 303 -> job renders -> DONE with tracks', async () => {
    if (!reachable) return;
    const page = await browser.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.fill('#source', ALBUM);
    await page.selectOption('#mode', 'album');
    await page.click('button[type=submit]');
    await page.waitForURL(/\/job\//, { timeout: 20000 });

    // poll the JSON until the job is terminal (done xor failed), max ~60s
    const jid = new URL(page.url()).pathname.split('/').pop()!;
    let job: any = null;
    for (let i = 0; i < 60; i++) {
      const j = (await (await fetch(`${BASE}/job/${jid}?format=json`, { signal: AbortSignal.timeout(8000) })).json()) as any;
      const st = j?.job?.status;
      if (st && st !== 'running' && st !== 'pending') {
        job = j;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(job, 'album job should reach a terminal state within 60s').not.toBeNull();
    expect(job.job.status).toBe('done');
    const items = job.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    const links = items.filter((i: any) => i.yt_video_id).length;
    expect(links).toBeGreaterThan(0);
  });

  it('share (any owner) -> POST /migrate -> job ends TERMINAL (done xor failed) cleanly, never hangs/500s', async () => {
    if (!reachable) return;
    const page = await browser.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.fill('#source', SHARE);
    await page.click('button[type=submit]');
    await page.waitForURL(/\/job\//, { timeout: 20000 });

    const jid = new URL(page.url()).pathname.split('/').pop()!;
    for (let i = 0; i < 70; i++) {
      let j: any;
      try {
        j = (await (await fetch(`${BASE}/job/${jid}?format=json`, { signal: AbortSignal.timeout(8000) })).json()) as any;
      } catch {
        throw new Error(`job ${jid} unreadable (should 200 with JSON)`);
      }
      const st = j?.job?.status;
      if (st === 'done') return; // owned by token -> success, contract satisfied
      if (st === 'failed') {
        // clean, documented terminal state; the decision says 403-by-design when not owned
        expect(j.job.error).toMatch(/HTTP 403|HTTP 401/);
        return;
      }
      if (st && st !== 'running' && st !== 'pending') {
        throw new Error(`unexpected terminal status ${st}: ${j?.job?.error ?? ''}`);
      }
      expect(st, `job must not hang (t=${i}s)`).toBeDefined();
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('share job did not reach terminal state within 70s');
  });
});
