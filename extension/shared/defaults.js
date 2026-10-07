/*
 * PopGuard shared helpers.
 * Loaded by the service worker (importScripts), content scripts and UI pages,
 * so it must stay plain script (no ES module syntax).
 */
var PG = globalThis.PG || (globalThis.PG = {});

PG.DEFAULT_SETTINGS = {
  blockPopups: true,     // window.open, fake clicks, ad tabs
  blockRedirects: true,  // click-redirects / tab-unders
  removeOverlays: true,  // invisible click-jacking layers
  hideBanners: true,     // cosmetic banner hiding
  showNotices: true,     // "Blocked ... Open anyway" toast
  lists: { ads: true, trackers: true, betting: true },
};

/** Every kind of block PopGuard records, grouped into dashboard categories. */
PG.KINDS = {
  popup:        { label: 'Pop-up windows',        category: 'popups' },
  redirect:     { label: 'Click redirects',       category: 'popups' },
  tab:          { label: 'Ad tabs closed',        category: 'popups' },
  'fake-click': { label: 'Fake link clicks',      category: 'popups' },
  overlay:      { label: 'Invisible overlays',    category: 'popups' },
  ad:           { label: 'Ad network requests',   category: 'ads' },
  betting:      { label: 'Betting / casino ads',  category: 'ads' },
  custom:       { label: 'Custom & imported rules', category: 'ads' },
  tracker:      { label: 'Tracker requests',      category: 'trackers' },
  banner:       { label: 'Banner ads hidden',     category: 'banners' },
};

PG.CATEGORIES = [
  { id: 'popups',   label: 'Pop-ups & redirects' },
  { id: 'ads',      label: 'Ads blocked' },
  { id: 'trackers', label: 'Trackers blocked' },
  { id: 'banners',  label: 'Banners hidden' },
];

PG.hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/** Rough registrable domain (good enough without a public-suffix list). */
PG.siteOf = (hostOrUrl) => {
  const h = hostOrUrl.includes('/') ? PG.hostOf(hostOrUrl) : hostOrUrl.replace(/^www\./, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return h;
  const p = h.split('.');
  const twoPartTld = /^(co|com|org|net|gov|edu|ac)\.[a-z]{2}$/.test(p.slice(-2).join('.'));
  return p.slice(twoPartTld ? -3 : -2).join('.');
};

PG.isWhitelisted = (host, whitelist) =>
  !!host && (whitelist || []).some((d) => host === d || host.endsWith('.' + d));

PG.today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

PG.getSettings = async () => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return {
    ...PG.DEFAULT_SETTINGS,
    ...settings,
    lists: { ...PG.DEFAULT_SETTINGS.lists, ...(settings.lists || {}) },
  };
};

/** "example.com##.ad, ##.sponsored" style element-hiding filters -> selectors for this host. */
PG.cosmeticSelectorsFor = (host, filters) => {
  const out = [];
  for (const raw of filters || []) {
    const line = raw.trim();
    const i = line.indexOf('##');
    if (i < 0 || line.startsWith('!')) continue;
    const domains = line.slice(0, i).split(',').map((d) => d.trim()).filter(Boolean);
    const sel = line.slice(i + 2).trim();
    if (!sel) continue;
    if (!domains.length || domains.some((d) => host === d || host.endsWith('.' + d))) out.push(sel);
  }
  return out;
};
