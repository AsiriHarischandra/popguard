/*
 * Generates the store screenshots (1280x800) and promo tiles into docs/store/images/.
 * Uses a fictional demo site (StreamBox) and demo statistics; nothing here is real user data.
 *   npm run store-images
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');
const FIX = path.join(ROOT, 'tests/fixtures');
const OUT = path.join(ROOT, 'docs/store/images');
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  const f = path.join(FIX, new URL(req.url, 'http://x').pathname);
  if (!f.startsWith(FIX) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8765, r));

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-img-')), {
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
    '--host-resolver-rules=MAP *.example 127.0.0.1'],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
await new Promise((r) => setTimeout(r, 1500));
for (const p of ctx.pages()) if (p.url().includes(extId)) await p.close();

// ---- demo statistics ----
const demo = { total: 0, since: Date.now() - 30 * 864e5, byKind: {}, byDay: {}, bySite: {}, byTarget: {} };
let seed = 7; const rnd = (a, b) => { seed = (seed * 9301 + 49297) % 233280; return Math.round(a + (seed / 233280) * (b - a)); };
for (let i = 29; i >= 0; i--) {
  const d = new Date(); d.setDate(d.getDate() - i);
  const day = { popup: rnd(2, 14), redirect: rnd(1, 8), tab: rnd(0, 4), overlay: rnd(0, 5), 'fake-click': rnd(0, 3),
    ad: rnd(20, 90), betting: rnd(0, 12), tracker: rnd(30, 140), banner: rnd(5, 35) };
  if (d.getDay() === 0 || d.getDay() === 6) for (const k in day) day[k] = Math.round(day[k] * 1.6);
  demo.byDay[d.toLocaleDateString('en-CA')] = day;
  for (const [k, v] of Object.entries(day)) { demo.byKind[k] = (demo.byKind[k] || 0) + v; demo.total += v; }
}
demo.bySite = { 'streambox.example': 1840, 'subtitles.example': 1210, 'news-site.example': 640, 'recipes.example': 410, 'tech-blog.example': 260, 'forum.example': 140 };
demo.byTarget = { 'google-analytics.com': 980, 'doubleclick.net': 760, 'adstudio.cloud': 520, 'propellerads.com': 410, 'hotjar.com': 300, 'win-big-prizes.example': 220, 'taboola.com': 150 };
const setStorage = (o) => sw.evaluate((x) => chrome.storage.local.set(x), o);

async function shot(url, { w = 1200, h = 750, scheme = 'light', before } = {}) {
  const p = await ctx.newPage();
  await p.emulateMedia({ colorScheme: scheme });
  await p.setViewportSize({ width: w, height: h });
  await p.goto(url);
  await p.waitForTimeout(700);
  if (before) await before(p);
  const buf = await p.screenshot();
  await p.close();
  return buf.toString('base64');
}

// 1. demo site with a blocked pop-up notice
const site = await shot('http://streambox.example:8765/demo-video.html', {
  before: async (p) => { await p.click('#play'); await p.waitForTimeout(600); },
});
// 2-3. dashboard light / dark, 4. filters
await setStorage({ stats: demo, customDomains: ['ads.example.net'], cosmeticFilters: ['subtitles.example##.sidebar-ad', '##.sponsored-box'] });
const dash = (scheme) => shot(`chrome-extension://${extId}/ui/dashboard.html`, { scheme, before: async (p) => {
  await p.click('[data-range="30"]'); await p.waitForTimeout(400);
  const box = await p.$('#chart svg').then((s) => s.boundingBox());
  await p.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.6); await p.waitForTimeout(200);
} });
const dashLight = await dash('light');
const dashDark = await dash('dark');
const filters = await shot(`chrome-extension://${extId}/ui/dashboard.html#filters`);
// 5. popup, as seen on the demo site
const demoTab = await ctx.newPage();
await demoTab.goto('http://streambox.example:8765/demo-video.html');
await demoTab.waitForTimeout(500);
await demoTab.click('#play'); // so the popup's "this page" count matches the notice
await demoTab.waitForTimeout(800);
const popupPage = await ctx.newPage();
await popupPage.addInitScript(() => {
  const q = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async () => (await q({})).filter((t) => (t.url || '').includes('streambox')).slice(0, 1);
});
await popupPage.setViewportSize({ width: 300, height: 318 });
await popupPage.goto(`chrome-extension://${extId}/ui/popup.html`);
await popupPage.waitForTimeout(1500);
const popup = (await popupPage.screenshot()).toString('base64');
await popupPage.close(); await demoTab.close();

// ---- compose slides ----
const icon = fs.readFileSync(path.join(ROOT, 'extension/icons/icon128.png')).toString('base64');
const slideCss = `
  *{box-sizing:border-box} body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:system-ui,"Segoe UI",sans-serif;
  background:linear-gradient(160deg,#eaf2fd 0%,#f7f9fc 55%,#fdf1ea 100%);color:#0b0b0b}
  .top{display:flex;align-items:center;gap:14px;padding:34px 48px 0}
  .top img{width:44px} .top span{font-weight:700;font-size:22px;color:#1c5cab}
  h1{font-size:42px;letter-spacing:-.5px;margin:14px 48px 6px} p{font-size:20px;color:#52514e;margin:0 48px}
  .frame{position:absolute;left:50%;transform:translateX(-50%);bottom:-6px;width:930px;border-radius:14px 14px 0 0;overflow:hidden;
  box-shadow:0 20px 60px rgba(16,66,129,.28);border:1px solid #d6dbe4;background:#fff}
  .chrome{height:30px;background:#e9ecf1;display:flex;align-items:center;gap:7px;padding:0 12px}
  .chrome i{width:11px;height:11px;border-radius:50%;background:#c9ced6;display:block}
  .frame img{display:block;width:100%}`;
async function slide(name, title, sub, img, extra = '') {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.setContent(`<html><head><style>${slideCss}</style></head><body>
    <div class="top"><img src="data:image/png;base64,${icon}"><span>PopGuard</span></div>
    <h1>${title}</h1><p>${sub}</p>
    <div class="frame"><div class="chrome"><i></i><i></i><i></i></div><img src="data:image/png;base64,${img}"></div>${extra}</body></html>`);
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(OUT, name) });
  await p.close();
}
await slide('screenshot-1-blocks.png', 'Click Play. Get Play.', 'Pop-ups, click-redirects and invisible ad layers are stopped, and PopGuard tells you what it blocked.', site);
await slide('screenshot-2-dashboard.png', 'See everything it blocked', 'Blocks per day, the sites where it worked hardest, and the domains it stopped most.', dashLight);
await slide('screenshot-3-popup.png', 'Trust a site with one click', 'Every page shows what was blocked. Turn protection off anywhere you trust.', site,
  `<img src="data:image/png;base64,${popup}" style="position:absolute;right:190px;top:330px;width:300px;border-radius:10px;box-shadow:0 16px 48px rgba(0,0,0,.35);border:1px solid #d6dbe4">`);
await slide('screenshot-4-filters.png', 'Your rules, your lists', 'Switch built-in lists on or off, import EasyPrivacy, or add your own domains and hiding rules.', filters);
await slide('screenshot-5-dark.png', 'Looks right in dark mode too', 'The dashboard follows your system theme.', dashDark);

// ---- promo tiles ----
async function tile(name, w, h, iconSize, titleSize, subSize) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;gap:${iconSize * 0.3}px;
    background:linear-gradient(135deg,#1c5cab,#2a78d6 55%,#3987e5);font-family:system-ui,'Segoe UI',sans-serif;color:#fff">
    <div style="width:${iconSize * 1.25}px;height:${iconSize * 1.25}px;border-radius:28%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(0,0,0,.25);flex:none">
      <img src="data:image/png;base64,${icon}" style="width:${iconSize * 0.85}px"></div>
    <div><div style="font-weight:800;font-size:${titleSize}px;letter-spacing:-1px">PopGuard</div>
    <div style="font-size:${subSize}px;opacity:.92;max-width:${w * 0.5}px;line-height:1.3">Stops sites from hijacking your clicks</div></div></body></html>`);
  await p.screenshot({ path: path.join(OUT, name) });
  await p.close();
}
await tile('promo-small-440x280.png', 440, 280, 96, 44, 17);
await tile('promo-marquee-1400x560.png', 1400, 560, 230, 110, 40);
fs.copyFileSync(path.join(ROOT, 'docs/store/images/icon-128.png'), path.join(OUT, 'icon-128.png'));

await ctx.close();
server.close();
console.log('store images written to docs/store/images/');
