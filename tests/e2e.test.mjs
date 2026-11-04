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
import https from 'node:https';
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
const serve = (req, res) => {
  const file = path.join(FIX, decodeURIComponent(new URL(req.url, SITE).pathname));
  if (!file.startsWith(FIX) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
};
const server = http.createServer(serve);
await new Promise((r) => server.listen(PORT, r));
// Real company domains for the "same company" tests. youtube.com and google.com only work over
// HTTPS (HSTS), so they get a second server with a test-only certificate, mapped to 127.0.0.1.
const TLS_PORT = 8766;
const CERTS = path.join(ROOT, 'certs');
const tlsServer = https.createServer({ key: fs.readFileSync(path.join(CERTS, 'test-key.pem')), cert: fs.readFileSync(path.join(CERTS, 'test-cert.pem')) }, serve);
await new Promise((r) => tlsServer.listen(TLS_PORT, r));
const YT = `https://www.youtube.com:${TLS_PORT}/`;
const CLASSROOM = `https://classroom.google.com:${TLS_PORT}/`;

// ---------- browser ----------
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-')), {
  headless: true,
  // Extensions need full Chromium; the default headless shell can't load them.
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  viewport: { width: 1200, height: 800 },
  ignoreHTTPSErrors: true,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--ignore-certificate-errors', '--no-proxy-server',
    '--host-resolver-rules=MAP login.live.com 127.0.0.1, MAP www.youtube.com 127.0.0.1, MAP classroom.google.com 127.0.0.1'],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
await new Promise((r) => setTimeout(r, 1500));
for (const p of ctx.pages()) if (p.url().includes(extId)) await p.close(); // welcome tab

const storage = {
  // When a change rebuilds the network rules, wait for that to finish (slow CI machines can take
  // longer than a fixed pause). Rebuilds run one after another, so awaiting one more means all done.
  set: (obj) => sw.evaluate(async (o) => {
    await chrome.storage.local.set(o);
    if (Object.keys(o).some((k) => ['whitelist', 'customDomains', 'importedLists', 'pausedSites'].includes(k))) {
      await new Promise((r) => setTimeout(r, 50)); // let storage.onChanged start its own rebuild first
      await PGFilters.rebuildDynamic();
    }
  }, obj),
  get: (key) => sw.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k]), key),
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Opens a fixture (a file name, or a full URL), runs an action, and reports what happened. */
async function visit(file, action) {
  const page = await ctx.newPage();
  await page.goto(/^https?:/.test(file) ? file : SITE + file);
  await page.waitForTimeout(400);
  const before = new Set(ctx.pages());
  await action?.(page);
  await page.waitForTimeout(1500);
  const newTabs = ctx.pages().filter((p) => !before.has(p)).map((p) => p.url());
  return { page, newTabs, url: page.url(), done: async () => { for (const p of ctx.pages()) if (!before.has(p)) await p.close(); await page.close(); } };
}

// ---------- tiny runner ----------
const results = [];
const ON_GITHUB = !!process.env.GITHUB_ACTIONS;
async function test(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY, 'i').test(name)) return; // ONLY=pattern npm test
  const short = (e) => e.message.split('\n').slice(0, process.env.FULL_ERRORS ? 60 : 8).join('\n');
  const annotate = (level, title, msg) => { if (ON_GITHUB) console.log(`::${level} title=${title.replace(/[:,\r\n]/g, ' ')}::${msg.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`); };
  try { await fn(); results.push([true, name]); console.log('  ✓', name); return; }
  catch (first) {
    // Browser tests can stall on a busy machine (a click that never gets acknowledged, a page that
    // loads late). Run a failed test once more; a real bug fails both times.
    for (const p of ctx.pages()) if (!p.url().includes(extId)) await p.close().catch(() => {});
    try {
      await fn();
      results.push([true, name]);
      console.log('  ✓', name, '(passed on retry)');
      annotate('warning', `Flaky test: ${name}`, `Failed once, passed on retry:\n${short(first)}`);
    } catch (e) {
      const msg = short(e);
      results.push([false, name, msg]);
      console.log('  ✗', name, '\n     ', msg.split('\n').join('\n      '));
      annotate('error', `Test failed: ${name}`, msg);
    }
  }
}
/** Waits until check() returns something truthy (or time runs out) - for things that settle asynchronously. */
async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await check(); if (last) return last; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}
const hiddenSoon = (page, sel) => until(async () => !(await page.isVisible(sel)));

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

const classroom = (base, player) =>
  `${base}classroom.html?player=${encodeURIComponent(player)}&yt=${encodeURIComponent(YT + 'watch.html?v=abc')}`;

await test("an embedded player's own buttons open its site (YouTube in Google Classroom)", async () => {
  // The YouTube logo is a link, but the player opens it with "&t=42s" added.
  let r = await visit(classroom(SITE, YT + 'player.html'), (p) => p.frameLocator('#player').locator('#logo').click());
  assert.deepEqual(r.newTabs, [YT + 'watch.html?v=abc&t=42s']);
  await r.done();
  // "Watch on YouTube" isn't a link at all.
  r = await visit(classroom(SITE, YT + 'player.html'), (p) => p.frameLocator('#player').locator('#watch').click());
  assert.deepEqual(r.newTabs, [YT + 'watch.html?v=abc']);
  await r.done();
});

await test('the same kind of button in an unknown iframe still cannot open tabs', async () => {
  const r = await visit(classroom(SITE, AD + 'player.html'), (p) => p.frameLocator('#player').locator('#watch').click());
  assert.deepEqual(r.newTabs, []);
  await r.done();
});

await test("a company's sites can open each other (Google Classroom -> YouTube), other sites can't", async () => {
  let r = await visit(classroom(CLASSROOM, 'about:blank'), (p) => p.click('#openyt'));
  assert.deepEqual(r.newTabs, [YT + 'watch.html?v=abc']);
  await r.done();
  r = await visit(classroom(SITE, 'about:blank'), (p) => p.click('#openyt'));
  assert.deepEqual(r.newTabs, []);
  await r.done();
});

await test('a closed tab can be reopened from the notice, but only that tab', async () => {
  const page = await ctx.newPage();
  await page.goto(SITE + 'real.html');
  await page.waitForTimeout(400);
  const res = await sw.evaluate(async ({ src, target }) => {
    const [srcTab] = await chrome.tabs.query({ url: src });
    const tab = await chrome.tabs.create({ url: target, active: false });
    await PGGuard.judgeNewTab(tab.id, srcTab.id, src, target);
    await new Promise((r) => setTimeout(r, 500));
    const closed = await chrome.tabs.get(tab.id).then(() => false, () => true);
    const other = await PGGuard.reopen(srcTab.id, target.replace('ad.html', 'other.html'));
    const ok = await PGGuard.reopen(srcTab.id, target);
    const again = await PGGuard.reopen(srcTab.id, target);
    return { closed, other, ok, again };
  }, { src: SITE + 'real.html', target: AD + 'ad.html' });
  assert.deepEqual(res, { closed: true, other: false, ok: true, again: false });
  assert.ok(await page.$('popguard-notice'), 'no "Open anyway" notice on the page');
  await wait(500);
  for (const p of ctx.pages()) if (p.url() === AD + 'ad.html') await p.close();
  await page.close();
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

await test('never blocks sign-in pages (e.g. Microsoft account picker -> login.live.com)', async () => {
  const r = await visit('signin.html', (p) => p.click('#account'));
  assert.notEqual(r.url, SITE + 'signin.html', 'sign-in redirect was blocked');
  await r.done();
});

await test('still blocks the same kind of script redirect to an unknown site', async () => {
  const r = await visit('signin.html', (p) => p.click('#other'));
  assert.equal(r.url, SITE + 'signin.html');
  await r.done();
});

await test('blocks a timed redirect that fires long after the page loaded', async () => {
  const p = await ctx.newPage();
  await p.goto(SITE + 'timed-redirect.html');
  await p.waitForTimeout(13000);
  assert.equal(p.url(), SITE + 'timed-redirect.html');
  await p.close();
});

await test('blocks a delayed meta-refresh redirect to another site', async () => {
  const p = await ctx.newPage();
  await p.goto(SITE + 'timed-meta.html');
  await p.waitForTimeout(13000);
  assert.equal(p.url(), SITE + 'timed-meta.html');
  await p.close();
});

await test('undoes a timed redirect started by an ad iframe', async () => {
  const p = await ctx.newPage();
  await p.goto(SITE + 'iframe-timed.html');
  await p.waitForTimeout(500);
  await p.click('#ad', { position: { x: 50, y: 50 } }); // the user once clicked the ad box
  await p.waitForTimeout(14000);
  assert.equal(p.url(), SITE + 'iframe-timed.html');
  await p.close();
});

await test('a link clicked after reading for a while still opens', async () => {
  const p = await ctx.newPage();
  await p.goto(SITE + 'article-link.html');
  await p.waitForTimeout(12000);           // idle longer than the timed-redirect window
  await p.click('#out');
  await p.waitForTimeout(2500);
  assert.equal(p.url(), AD + 'real.html');
  await p.close();
});

await test('still allows normal redirects while a page is loading', async () => {
  const p = await ctx.newPage();
  await p.goto(SITE + 'load-redirect.html');
  await p.waitForTimeout(2000);
  assert.equal(p.url(), AD + 'real.html');
  await p.close();
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

/** Right-clicks an element and runs the "PopGuard: Hide this ad" menu item on it. */
async function hideThisAd(page, selector, frameId = 0, frameUrl) {
  await page.click(selector, { button: 'right' });
  // the newest tab showing this page (an earlier test may have left one open)
  const tabId = await sw.evaluate((u) => chrome.tabs.query({ url: u }).then((ts) => Math.max(...ts.map((t) => t.id))), page.url());
  const out = await sw.evaluate(([tabId, frameId, frameUrl]) => onHideMenu({ menuItemId: 'popguard-hide', frameId, frameUrl }, { id: tabId }), [tabId, frameId, frameUrl]);
  return { ...out.hid, learned: out.learned };
}

await test('"Hide this ad" on a normal link hides only that link, not every link to the site', async () => {
  await storage.set({ cosmeticFilters: [] });
  const r = await visit('hide-pick.html');
  const res = await hideThisAd(r.page, '#normal img');
  assert.doesNotMatch(res.selector, /href\*=/, `too broad: ${res.selector}`);
  assert.equal(await hiddenSoon(r.page, '#normal'), true);
  await r.page.waitForTimeout(400);
  assert.equal(await r.page.isVisible('#normal2'), true, 'other links to the same site were hidden');
  await r.page.reload();
  assert.equal(await hiddenSoon(r.page, '#normal'), true, 'not hidden again after reload');
  assert.equal(await r.page.isVisible('#normal2'), true);
  await r.done();
});

await test('"Hide this ad" on an ad-network link hides every link to that ad network', async () => {
  await storage.set({ cosmeticFilters: [] });
  const r = await visit('hide-pick.html');
  const res = await hideThisAd(r.page, '#adlink img');
  assert.equal(res.selector, 'a[href*="ads.onclkds.com"]');
  assert.equal(await hiddenSoon(r.page, '#adlink2'), true, 'other links to the ad network still visible');
  assert.equal(await r.page.isVisible('#normal'), true);
  await r.done();
});

await test('"Hide this ad" never builds a rule on a generated id, and it still works after reload', async () => {
  await storage.set({ cosmeticFilters: [] });
  const r = await visit('hide-pick.html');
  const res = await hideThisAd(r.page, '#dyn');
  assert.doesNotMatch(res.selector, /a8f3k2b7/, `built on a generated id: ${res.selector}`);
  await r.page.reload();
  assert.equal(await hiddenSoon(r.page, '#dyn'), true, 'not hidden again after reload');
  assert.equal(await r.page.isVisible('#keep'), true);
  await r.done();
  await storage.set({ cosmeticFilters: [] });
});

await test('"Hide this ad" inside an embedded frame hides that frame only, not every frame from its site', async () => {
  await storage.set({ cosmeticFilters: [] });
  const r = await visit('frames-pick.html');
  const url = AD + 'real.html?video=a';
  const tabId = await sw.evaluate((u) => chrome.tabs.query({ url: u }).then(([t]) => t.id), r.page.url());
  const frameId = await sw.evaluate(([t, u]) => chrome.webNavigation.getAllFrames({ tabId: t }).then((fs) => fs.find((f) => f.url === u).frameId), [tabId, url]);
  await r.page.frameLocator('#fa').locator('h1, body').first().click({ button: 'right' });
  await sw.evaluate(([t, f, u]) => onHideMenu({ menuItemId: 'popguard-hide', frameId: f, frameUrl: u }, { id: t }), [tabId, frameId, url]);
  assert.equal(await hiddenSoon(r.page, '#fa'), true);
  assert.equal(await r.page.isVisible('#fb'), true, 'the other frame from the same site was hidden');
  await r.done();
  await storage.set({ cosmeticFilters: [] });
});

await test('"Hide this ad" never hides the video player or the whole page', async () => {
  await storage.set({ cosmeticFilters: [] });
  const r = await visit('stream-player.html');
  const url = AD + 'player.html';
  const tabId = await sw.evaluate((u) => chrome.tabs.query({ url: u }).then((ts) => Math.max(...ts.map((t) => t.id))), r.page.url());
  const frameId = await sw.evaluate(([t, u]) => chrome.webNavigation.getAllFrames({ tabId: t }).then((fs) => fs.find((f) => f.url === u).frameId), [tabId, url]);
  // right-click on the player's empty area (its <body>), like right-clicking the video
  await r.page.frameLocator('#player').locator('body').click({ button: 'right', position: { x: 600, y: 400 } });
  const out = await sw.evaluate(([t, f, u]) => onHideMenu({ menuItemId: 'popguard-hide', frameId: f, frameUrl: u }, { id: t }), [tabId, frameId, url]);
  assert.equal(out.refused, true, JSON.stringify(out.hid));
  await r.page.waitForTimeout(400);
  assert.equal(await r.page.isVisible('#player'), true, 'the player was hidden');
  assert.equal(await r.page.isVisible('#root'), true, 'the page was hidden');
  assert.deepEqual(await storage.get('cosmeticFilters'), [], 'a rule was saved');
  // a small thing inside the player is still fine to hide
  await r.page.frameLocator('#player').locator('#watch').click({ button: 'right' });
  await sw.evaluate(([t, f, u]) => onHideMenu({ menuItemId: 'popguard-hide', frameId: f, frameUrl: u }, { id: t }), [tabId, frameId, url]);
  assert.equal(await until(async () => !(await r.page.frameLocator('#player').locator('#watch').isVisible())), true);
  assert.equal(await r.page.isVisible('#player'), true);
  await r.done();
  await storage.set({ cosmeticFilters: [] });
});

await test('"Hide this ad" on a banner in full-page wrappers hides the banner, not the page', async () => {
  await storage.set({ cosmeticFilters: [] });
  const r = await visit('stream-ad.html');
  await hideThisAd(r.page, '#banner img');
  assert.equal(await hiddenSoon(r.page, '#banner'), true);
  assert.equal(await r.page.isVisible('#stage'), true, 'the full-page wrapper was hidden (black page)');
  assert.equal(await r.page.isVisible('#root'), true);
  await r.done();
  await storage.set({ cosmeticFilters: [] });
});

await test('a saved rule that hides the page itself is removed automatically', async () => {
  await storage.set({ cosmeticFilters: ['localhost###root', 'localhost##.player-wrap > iframe', 'localhost##.slot'] });
  const r = await visit('stream-player.html');
  assert.equal(await until(() => r.page.isVisible('#player')), true, 'player still hidden by a saved rule');
  assert.equal(await r.page.isVisible('#root'), true);
  const left = await until(async () => { const f = await storage.get('cosmeticFilters'); return f.length === 1 && f; });
  assert.deepEqual(left, ['localhost##.slot'], 'only the harmless rule should be kept');
  await r.done();
  await storage.set({ cosmeticFilters: [] });
});

// ---------- Smart ad learning (Phase 1: analyse + validate only) ----------
/** Runs learn-core.js in a plain page so its pure functions can be checked directly. */
async function learnCore(fn, arg) {
  const page = await ctx.newPage();
  await page.goto(SITE + 'real.html');
  await page.addScriptTag({ path: path.join(EXT, 'shared/learn-core.js') });
  const r = await page.evaluate(fn, arg);
  await page.close();
  return r;
}

await test('learning: tells generated class names and ids from stable and ad ones', async () => {
  const kinds = await learnCore((tokens) => tokens.map((t) => PGLearn.tokenKind(t)), [
    'css-1x2y3z', 'sc-bdVaJa', 'a8f3k2b7', 'Header_title__3xK9a', '550e8400-e29b-41d4-a716-446655440000', 'ad_1700000000',
    'sidebar-ad', 'adContainer', 'ad-300x250', 'sponsored', 'header', 'add-to-cart', 'shadow', 'navbar', 'row', 'mb-4', 'col-12']);
  assert.deepEqual(kinds, ['dynamic', 'dynamic', 'dynamic', 'dynamic', 'dynamic', 'dynamic',
    'ad', 'ad', 'ad', 'ad', 'stable', 'stable', 'stable', 'stable', 'generic', 'generic', 'generic']);
});

await test('learning: fingerprints ignore generated names but change with the structure; unsafe selectors are rejected', async () => {
  const r = await learnCore(() => {
    const node = (classes, id, children) => PGLearn.normalizeNode({ tag: 'div', id, classes, attrs: {}, w: 300, h: 250, hosts: { link: 'ads.example' }, children });
    const a = PGLearn.fingerprint(node(['sidebar-ad', 'css-1a2b3c'], 'ad-x9f8k2l1', ['span', 'a']));
    const b = PGLearn.fingerprint(node(['sidebar-ad', 'css-9z8y7x'], 'ad-q1w2e3r4', ['span', 'a']));
    const c = PGLearn.fingerprint(node(['sidebar-ad'], '', ['a', 'img', 'p']));
    const safe = ['div.ad', 'div{}', 'a;b', 'x<y', '@import', 'a/*x*/', 'a'.repeat(201)].map(PGLearn.safeSelectorText);
    return { same: a === b, diff: a !== c, safe };
  });
  assert.equal(r.same, true, 'same widget with different generated names got different fingerprints');
  assert.equal(r.diff, true, 'different structure got the same fingerprint');
  assert.deepEqual(r.safe, [true, false, false, false, false, false, false]);
});

await test('learning: right-clicking a missed ad finds a safe, stable rule and keeps it as a draft only', async () => {
  await storage.set({ cosmeticFilters: [] });
  await sw.evaluate(() => chrome.storage.session.set({ learnDrafts: [] }));
  const r = await visit('learn-ads.html');
  const { learned } = await hideThisAd(r.page, '#adimg');
  assert.equal(learned.status, 'validated');
  assert.equal(learned.best.selector, 'div.sidebar-ad');
  assert.ok(learned.best.score >= 85, `score ${learned.best.score}`);
  assert.equal(learned.best.scope, 'global');
  assert.doesNotMatch(JSON.stringify(learned.candidates.map((c) => c.selector)), /css-8f3k2a|x9f8k2l1/, 'used a generated name');
  assert.deepEqual([learned.network.host, learned.network.eligible], ['ads.onclkds.com', true]);
  // privacy: host only, no URL, no page text
  const json = JSON.stringify(learned);
  assert.doesNotMatch(json, /learn-ads\.html|c\?id=1|Article title|normal card/);
  // Phase 1: a draft in session storage, not an active rule
  const drafts = await sw.evaluate(() => PGLearning.drafts());
  assert.equal(drafts[0].id, learned.id);
  assert.equal(drafts[0].active, false);
  assert.ok(!(await storage.get('learnedRules')), 'learning saved a permanent rule in Phase 1');
  assert.ok(!(await storage.get('cosmeticFilters')).some((f) => f.includes('sidebar-ad')), 'learning added a hiding rule in Phase 1');
  await r.done();
  await storage.set({ cosmeticFilters: [] });
});

await test('learning: a generated slot id becomes a stable prefix rule, kept to this site', async () => {
  const r = await visit('learn-ads.html');
  const { learned } = await hideThisAd(r.page, '#slotinner');
  assert.equal(learned.best?.selector, 'div[id^="ad-unit-"]');
  // no ad network or ad label to prove it: good enough here, not for every site
  assert.equal(learned.best.scope, 'site');
  await r.done();
  await storage.set({ cosmeticFilters: [] });
});

await test('learning: normal content and too-broad patterns are rejected, not learned', async () => {
  let r = await visit('learn-ads.html');
  let { learned } = await hideThisAd(r.page, '#storyimg');
  assert.equal(learned.status, 'rejected', `learned from normal content: ${learned.best?.selector}`);
  assert.equal(learned.network, null, 'a link to the same site is not a network-rule candidate');
  await r.done();
  r = await visit('learn-ads.html');
  ({ learned } = await hideThisAd(r.page, '#cardad'));
  const card = learned.candidates.find((c) => c.selector.endsWith('div.card') || c.selector === 'div.card');
  if (card) assert.equal(card.validation.valid, false, '"div.card" would also hide normal cards');
  assert.ok(!learned.best || !/^div\.card$/.test(learned.best.selector));
  await r.done();
  await storage.set({ cosmeticFilters: [] });
});

await test('learning: the same ad studied twice is recognised as a duplicate', async () => {
  await sw.evaluate(() => chrome.storage.session.set({ learnDrafts: [] }));
  let r = await visit('learn-ads.html');
  const first = (await hideThisAd(r.page, '#adimg')).learned;
  await r.done();
  await storage.set({ cosmeticFilters: [] });
  r = await visit('learn-ads.html');
  const second = (await hideThisAd(r.page, '#adimg')).learned;
  assert.equal(second.fingerprint, first.fingerprint);
  assert.equal(second.duplicateOf, first.id);
  await r.done();
  await storage.set({ cosmeticFilters: [] });
});

await test('learning: works inside a cross-origin ad frame, and fails gracefully with nothing selected', async () => {
  const r = await visit(classroom(SITE, AD + 'player.html'));
  const tabId = await sw.evaluate((u) => chrome.tabs.query({ url: u }).then(([t]) => t.id), r.page.url());
  const frameUrl = AD + 'player.html';
  const frameId = await sw.evaluate(([t, u]) => chrome.webNavigation.getAllFrames({ tabId: t }).then((fs) => fs.find((f) => f.url === u).frameId), [tabId, frameUrl]);
  await r.page.frameLocator('#player').locator('#watch').click({ button: 'right' });
  const learned = await sw.evaluate(([t, f]) => PGLearning.analyze(t, f), [tabId, frameId]);
  assert.equal(learned.inFrame, true, JSON.stringify(learned).slice(0, 200));
  assert.equal(learned.site, '127.0.0.1');
  const none = await sw.evaluate(([t]) => PGLearning.analyze(t, 0), [tabId]);
  assert.equal(none.error, 'no-element');
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

await test("a company's own trackers are allowed on its own site, blocked everywhere else", async () => {
  const check = (url, initiator) => sw.evaluate(({ url, initiator }) =>
    chrome.declarativeNetRequest.testMatchOutcome({ url, initiator, type: 'script', tabId: -1 })
      .then((r) => r.matchedRules.some((m) => m.rulesetId === 'trackers')), { url, initiator });
  const cases = [
    // [tracker, page it loads on, should it be blocked?]
    ['https://snap.licdn.com/li.lms-analytics/insight.min.js', 'https://www.linkedin.com', false],
    ['https://px.ads.linkedin.com/collect', 'https://www.linkedin.com', false],
    ['https://snap.licdn.com/li.lms-analytics/insight.min.js', 'https://news-site.example', true],
    ['https://www.google-analytics.com/analytics.js', 'https://accounts.google.com', false],
    ['https://www.google-analytics.com/analytics.js', 'https://news-site.example', true],
    ['https://www.facebook.com/tr?id=1', 'https://www.facebook.com', false],
    ['https://www.facebook.com/tr?id=1', 'https://shop.example', true],
    ['https://static.hotjar.com/c/hotjar.js', 'https://www.linkedin.com', true],  // other companies still blocked
  ];
  for (const [url, page, blocked] of cases) {
    assert.equal(await check(url, page), blocked, `${url} on ${page} should be ${blocked ? 'blocked' : 'allowed'}`);
  }
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

await test('"Pause for 1 hour" turns PopGuard off on a site until the pause runs out', async () => {
  await storage.set({ pausedSites: { localhost: Date.now() + 3600e3 } });
  await wait(800);
  let r = await visit('popunder.html', (p) => p.click('#play'));
  assert.equal(r.newTabs.length, 1, 'pop-up should be allowed while paused');
  await r.done();
  // The pause runs out: the expiry alarm drops it and protection is back.
  await storage.set({ pausedSites: { localhost: Date.now() - 1 } });
  await wait(800);
  assert.deepEqual(await storage.get('pausedSites'), {});
  r = await visit('popunder.html', (p) => p.click('#play'));
  assert.deepEqual(r.newTabs, []);
  await r.done();
});

await test('popup shows the last blocks on the page, and can pause and resume the site', async () => {
  const r = await visit('popunder.html', (p) => p.click('#play'));
  const tabId = await sw.evaluate((u) => chrome.tabs.query({ url: u }).then(([t]) => t.id), SITE + 'popunder.html');
  let pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${extId}/ui/popup.html?tab=${tabId}`);
  await pop.waitForTimeout(500);
  assert.equal(await pop.isVisible('#recent'), true, 'recent blocks list is hidden');
  assert.match(await pop.textContent('#recentList'), /Pop-up windows/);
  await pop.click('#pause');
  await wait(600);
  const until = (await storage.get('pausedSites'))?.localhost || 0;
  assert.ok(Math.abs(until - Date.now() - 3600e3) < 60e3, 'site not paused for about an hour');
  pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${extId}/ui/popup.html?tab=${tabId}`);
  await pop.waitForTimeout(500);
  assert.match(await pop.textContent('#offText'), /Paused here until/);
  assert.equal(await pop.isChecked('#toggle'), false);
  await pop.click('#resume');
  await wait(600);
  assert.deepEqual(await storage.get('pausedSites'), {});
  for (const p of ctx.pages()) if (p.url().includes('popup.html')) await p.close();
  await r.done();
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
tlsServer.close();
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map(([ok, name, msg]) => `| ${ok ? '✅' : '❌'} | ${name.replace(/\|/g, '\\|')} | ${ok ? '' : (msg || '').split('\n')[0].replace(/\|/g, '\\|').slice(0, 200)} |`);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## PopGuard tests: ${results.length - failed} passed, ${failed} failed\n\n| | Test | Error |\n|---|---|---|\n${rows.join('\n')}\n`);
}
process.exit(failed ? 1 : 0);
