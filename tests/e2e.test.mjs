/*
 * End-to-end tests: loads the real extension into Chromium and runs it against
 * fixture pages that copy what pop-under / click-hijack sites do.
 *
 *   npm test                 (headless)
 *   npm run screenshots      (also refreshes docs/screenshots/)
 *
 * Two origins are used so "another website" is real:
 *   http://localhost:8765   = the page you're visiting
 *   http://127.0.0.1:8765   = the "ad" site
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(ROOT, '../extension');
const FIX = path.join(ROOT, 'fixtures');
const SHOTS = path.resolve(ROOT, '../docs/screenshots');
const PORT = 8765;
const SITE = `http://localhost:${PORT}/`;
const AD = `http://127.0.0.1:${PORT}/`;

// ---------- static server ----------
const TYPES = { '.html': 'text/html', '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const file = path.join(FIX, decodeURIComponent(new URL(req.url, SITE).pathname));
  if (!file.startsWith(FIX) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

// ---------- browser ----------
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-')), {
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  viewport: { width: 1200, height: 800 },
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
await new Promise((r) => setTimeout(r, 1500));
for (const p of ctx.pages()) if (p.url().includes(extId)) await p.close(); // welcome tab

const storage = {
  set: (obj) => sw.evaluate((o) => chrome.storage.local.set(o), obj),
  get: (key) => sw.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k]), key),
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Opens a fixture, runs an action, and reports what happened. */
async function visit(file, action) {
  const page = await ctx.newPage();
  await page.goto(SITE + file);
  await page.waitForTimeout(400);
  const before = new Set(ctx.pages());
  await action?.(page);
  await page.waitForTimeout(1500);
  const newTabs = ctx.pages().filter((p) => !before.has(p)).map((p) => p.url());
  return { page, newTabs, url: page.url(), done: async () => { for (const p of ctx.pages()) if (!before.has(p)) await p.close(); await page.close(); } };
}

// ---------- tiny runner ----------
const results = [];
async function test(name, fn) {
  try { await fn(); results.push([true, name]); console.log('  ✓', name); }
  catch (e) { results.push([false, name]); console.log('  ✗', name, '\n     ', e.message.split('\n').slice(0,8).join('\n      ')); }
}

console.log('\nPopGuard e2e\n');

await test('blocks a pop-up opened by a click anywhere on the page', async () => {
  const r = await visit('popunder.html', (p) => p.click('#play'));
  assert.deepEqual(r.newTabs, []);
  await r.done();
});

await test('still opens a real link the user clicked', async () => {
  const r = await visit('popunder.html', (p) => p.click('#real'));
  assert.deepEqual(r.newTabs, [AD + 'real.html']);
  await r.done();
});

await test('allows shortcut tiles built with web components (shadow DOM)', async () => {
  const r = await visit('shortcut-tile.html', (p) => p.click('#host', { position: { x: 20, y: 20 } }));
  assert.equal(r.url, AD + 'real.html');
  await r.done();
});

await test('never closes tabs opened by browser pages (New Tab shortcuts)', async () => {
  // Edge reports New Tab shortcuts as opened by "edge://newtab/". Ask the guard to judge such a tab.
  const alive = await sw.evaluate(async (url) => {
    const src = await chrome.tabs.create({ url: 'about:blank', active: false });
    const tab = await chrome.tabs.create({ url, active: false });
    await PGGuard.judgeNewTab(tab.id, src.id, 'edge://newtab/', url);
    await new Promise((r) => setTimeout(r, 500));
    const still = await chrome.tabs.get(tab.id).then(() => true, () => false);
    await chrome.tabs.remove([src.id, tab.id]).catch(() => {});
    return still;
  }, AD + 'real.html');
  assert.equal(alive, true, 'shortcut tab was closed');
});

await test('removes an invisible overlay and passes the click to the Play button', async () => {
  const r = await visit('overlay.html', (p) => p.mouse.click(130, 110));
  assert.deepEqual(r.newTabs, []);
  assert.equal(await r.page.evaluate(() => window.played), 1);
  await r.done();
});

await test('cancels a tab-under redirect of the current tab', async () => {
  const r = await visit('tabunder.html', (p) => p.click('#play'));
  assert.equal(r.url, SITE + 'tabunder.html');
  assert.ok(!r.newTabs.some((u) => u.startsWith(AD)), 'no ad tab');
  await r.done();
});

await test('ignores fake script clicks and iframe window.open tricks', async () => {
  const r = await visit('fakeclick.html', (p) => p.click('#play'));
  assert.deepEqual(r.newTabs, []);
  await r.done();
});

await test('hides banner ads but keeps normal content', async () => {
  const r = await visit('banners.html');
  const vis = await r.page.evaluate(() => Object.fromEntries(['chick', 'studio', 'x', 'text', 'still', 'poster', 'imdb', 'yt']
    .map((id) => [id, document.getElementById(id).getBoundingClientRect().height > 0])));
  assert.deepEqual(vis, { chick: false, studio: false, x: false, text: true, still: true, poster: true, imdb: true, yt: true });
  await r.done();
});

await test('blocks trackers and custom domains from the Filters page', async () => {
  await storage.set({ customDomains: ['127.0.0.1'] });
  await wait(500);
  const r = await visit('tracker.html');
  const loaded = await r.page.evaluate(() => document.getElementById('custom').naturalWidth);
  assert.equal(loaded, 0, 'custom-blocked image should not load');
  await r.done();
  await storage.set({ customDomains: [] });
  await wait(500);
});

await test('records statistics by type, site and day', async () => {
  await wait(1500); // stats are batched once per second
  const stats = await storage.get('stats');
  const today = new Date().toLocaleDateString('en-CA');
  for (const kind of ['popup', 'overlay', 'redirect', 'fake-click', 'banner', 'tracker', 'custom']) {
    assert.ok(stats.byKind[kind] > 0, `expected some "${kind}" blocks, got ${JSON.stringify(stats.byKind)}`);
  }
  assert.ok(stats.byDay[today], 'today bucket');
  assert.ok(stats.bySite.localhost > 0, 'site bucket');
});

await test('store installs still count network blocks (getMatchedRules polling)', async () => {
  await sw.evaluate(() => { PGNetStats.setMode('poll'); return chrome.storage.session.set({ netStatsSince: Date.now() }); });
  await sw.evaluate(() => PGStats.reset());
  await storage.set({ customDomains: ['127.0.0.1'] });
  await wait(600);
  try {
    const r = await visit('tracker.html');
    const n = await sw.evaluate(() => PGNetStats.poll()); // poll while the tab is open, as the popup does
    await r.done();
    assert.ok(n >= 1, `poll found ${n} matches`);
    await wait(1500);
    const stats = await storage.get('stats');
    assert.ok(stats.byKind.custom >= 1, JSON.stringify(stats.byKind));
    assert.ok(stats.bySite.localhost >= 1, 'site from tab URL: ' + JSON.stringify(stats.bySite));
    assert.equal(await sw.evaluate(() => PGNetStats.poll()), 0, 'second poll must not double count');
  } finally {
    await sw.evaluate(() => PGNetStats.setMode('debug'));
    await storage.set({ customDomains: [] });
    await wait(600);
  }
});

await test('imports an EasyList / hosts style filter list', async () => {
  const dash = await ctx.newPage();
  await dash.goto(`chrome-extension://${extId}/ui/dashboard.html#filters`);
  const r = await dash.evaluate((url) => chrome.runtime.sendMessage({ type: 'importList', url }), SITE + 'list.txt');
  assert.ok(r.ok, r.error);
  assert.equal(r.count, 4);
  const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  assert.ok(rules.some((x) => x.condition.requestDomains?.includes('ads.example-one.com')));
  await storage.set({ importedLists: [] });
  await dash.close();
});

await test('whitelisted sites are left alone', async () => {
  await storage.set({ whitelist: ['localhost'] });
  await wait(800);
  const r = await visit('popunder.html', (p) => p.click('#play'));
  assert.deepEqual(r.newTabs, [AD + 'ad.html']);
  await r.done();
  await storage.set({ whitelist: [] });
  await wait(800);
});

await test('trusted pages can load things PopGuard would normally block', async () => {
  await storage.set({ whitelist: ['localhost'], customDomains: ['127.0.0.1'] });
  await wait(800);
  const r = await visit('tracker.html');
  const loaded = await r.page.evaluate(() => document.getElementById('custom').naturalWidth);
  assert.ok(loaded > 0, 'image from a blocked domain should load on a trusted page');
  const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  assert.ok(rules.some((x) => x.id === 3 && x.condition.initiatorDomains.includes('ntp.msn.com')), 'start-page allow rule');
  await r.done();
  await storage.set({ whitelist: [], customDomains: [] });
  await wait(800);
});

await test('turning a feature off in Settings disables it', async () => {
  await storage.set({ settings: { blockPopups: false } });
  await wait(800);
  const r = await visit('popunder.html', (p) => p.click('#play'));
  assert.deepEqual(r.newTabs, [AD + 'ad.html']);
  await r.done();
  await storage.set({ settings: {} });
  await wait(800);
});

await test('dashboard renders tiles, chart and tables', async () => {
  const dash = await ctx.newPage();
  await dash.goto(`chrome-extension://${extId}/ui/dashboard.html`);
  await dash.waitForTimeout(600);
  assert.ok(Number((await dash.textContent('#tRange')).replace(/\D/g, '')) > 0);
  assert.ok(await dash.$('#chart svg'));
  assert.ok((await dash.$$('#kinds tbody tr')).length >= 9);
  await dash.close();
});

// ---------- screenshots for the README (demo data) ----------
if (process.env.SCREENSHOTS || process.argv.includes('--screenshots')) {
  const demo = { total: 0, since: Date.now() - 30 * 864e5, byKind: {}, byDay: {}, bySite: {}, byTarget: {} };
  const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const day = { popup: rnd(2, 14), redirect: rnd(1, 8), tab: rnd(0, 4), overlay: rnd(0, 5), 'fake-click': rnd(0, 3),
      ad: rnd(20, 90), betting: rnd(0, 12), tracker: rnd(30, 140), banner: rnd(5, 35) };
    if (d.getDay() === 0 || d.getDay() === 6) for (const k in day) day[k] = Math.round(day[k] * 1.6);
    demo.byDay[d.toLocaleDateString('en-CA')] = day;
    for (const [k, v] of Object.entries(day)) { demo.byKind[k] = (demo.byKind[k] || 0) + v; demo.total += v; }
  }
  demo.bySite = { 'movie-streams.example': 1840, 'subtitles.example': 1210, 'news-site.example': 640, 'recipes.example': 410, 'tech-blog.example': 260, 'forum.example': 140 };
  demo.byTarget = { 'google-analytics.com': 980, 'doubleclick.net': 760, 'adstudio.cloud': 520, 'propellerads.com': 410, 'hotjar.com': 300, '1xbet.com': 220, 'taboola.com': 150 };
  await storage.set({ stats: demo, whitelist: ['bank.example', 'school.example'], customDomains: ['ads.example.net'],
    cosmeticFilters: ['subtitles.example##.sidebar-ad', '##.sponsored-box'] });
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [scheme, suffix] of [['light', ''], ['dark', '-dark']]) {
    const dash = await ctx.newPage();
    await dash.emulateMedia({ colorScheme: scheme });
    await dash.setViewportSize({ width: 1200, height: 1000 });
    await dash.goto(`chrome-extension://${extId}/ui/dashboard.html`);
    await dash.waitForTimeout(700);
    await dash.click('[data-range="30"]');
    await dash.waitForTimeout(400);
    const box = await dash.$('#chart svg').then((s) => s.boundingBox());
    await dash.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.6);
    await dash.waitForTimeout(200);
    await dash.screenshot({ path: path.join(SHOTS, `dashboard${suffix}.png`), fullPage: true });
    if (!suffix) {
      await dash.goto(`chrome-extension://${extId}/ui/dashboard.html#filters`);
      await dash.waitForTimeout(500);
      await dash.screenshot({ path: path.join(SHOTS, 'filters.png'), fullPage: true });
      await dash.goto(`chrome-extension://${extId}/ui/dashboard.html#settings`);
      await dash.waitForTimeout(400);
      await dash.screenshot({ path: path.join(SHOTS, 'settings.png'), fullPage: true });
      const pop = await ctx.newPage();
      await pop.setViewportSize({ width: 300, height: 330 });
      await pop.goto(`chrome-extension://${extId}/ui/popup.html`);
      await pop.waitForTimeout(400);
      await pop.screenshot({ path: path.join(SHOTS, 'popup.png') });
      await pop.close();
    }
    await dash.close();
  }
  console.log('\n  screenshots written to docs/screenshots/');
}

await ctx.close();
server.close();
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
