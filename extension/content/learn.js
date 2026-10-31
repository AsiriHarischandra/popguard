/*
 * Smart Ad Learning - page side (Phase 1: analyse and validate only).
 *
 * Injected on demand (chrome.scripting.executeScript) into the frame the user right-clicked,
 * right after shared/learn-core.js - normal pages never load it. It:
 *   1. finds the ad box around the element the user right-clicked (remembered by cosmetic.js),
 *   2. inspects it: tag, classes, ids, ad attributes, size, child tags, resource HOSTS only,
 *   3. builds candidate selectors and validates each one against this page,
 *   4. returns the analysis to the service worker. Nothing is hidden or saved here.
 *
 * Privacy: no page text, form data, cookies, storage, or full URLs are read or returned -
 * only element structure and host names.
 */
(() => {
  const L = globalThis.PGLearn;
  const target = globalThis.PG?.lastContextTarget;
  if (!L) return { error: 'not-loaded' };
  if (!target || !target.isConnected || target.nodeType !== 1) return { error: 'no-element' };

  const hostOf = (u) => { try { return new URL(u, location.href).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const pageHost = location.hostname.replace(/^www\./, '');
  const siteOf = globalThis.PG?.siteOf || ((h) => h.split('.').slice(-2).join('.'));
  const vw = innerWidth || document.documentElement.clientWidth, vh = innerHeight || document.documentElement.clientHeight;
  const AD_SIZES = [[728, 90], [970, 90], [970, 250], [468, 60], [320, 50], [320, 100], [300, 250], [336, 280],
    [160, 600], [300, 600], [120, 600], [250, 250], [200, 200], [300, 100], [300, 50]];
  const isAdSize = (w, h) => AD_SIZES.some(([aw, ah]) => Math.abs(w - aw) <= 10 && Math.abs(h - ah) <= 10);
  // A short visible label like "Ad", "Advertisement", "Sponsored" (checked, never stored).
  const AD_LABEL = /^\s*(ad|ads|advertisement|advertisements|sponsored|sponsored content|promoted|paid content|දැන්වීම)\s*$/i;
  const textLen = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().length;

  // ---------- 1. find the ad box ----------
  const adSignals = (el) => {
    const r = el.getBoundingClientRect();
    const tokens = [el.id, ...el.classList, ...[...el.attributes].map((a) => a.name)];
    return {
      size: isAdSize(r.width, r.height),
      // ad words in a class / id, or in the stable start of a generated id ("ad-unit-1700000000-0")
      words: tokens.some((t) => t && (L.tokenKind(t) === 'ad' || L.tokenKind((L.idPrefix(t) || '').replace(/[-_]+$/, '')) === 'ad')),
      adAttr: [...el.attributes].some((a) => /^data-(ad|ads|ad-slot|adslot|ad-client|google-query-id)/i.test(a.name)),
      inner: !!el.querySelector('iframe, ins'),
      label: [...el.querySelectorAll(':scope > *, :scope > * > *')].some((c) => c.children.length === 0 && AD_LABEL.test(c.textContent || '')),
    };
  };
  const tooBig = (el) => {
    const r = el.getBoundingClientRect();
    return r.width * r.height > vw * vh * 0.5 || textLen(el) > 400 ||
      el.matches('html, body, main, article, nav, header, footer, [role="main"]') || !!el.querySelector('main, article, h1, form, input, textarea');
  };
  let box = target.closest('a[href], iframe, ins, img, video') || target;
  let best = { el: box, s: -1 };
  for (let n = box, depth = 0; n && n !== document.body && depth < 7; n = n.parentElement, depth++) {
    if (tooBig(n)) break;
    const sig = adSignals(n);
    const s = (sig.adAttr ? 5 : 0) + (sig.words ? 4 : 0) + (sig.size ? 3 : 0) + (sig.label ? 2 : 0) + (sig.inner ? 1 : 0) - depth * 0.5;
    if (s > best.s) best = { el: n, s };
  }
  box = best.el;

  // ---------- 2. inspect ----------
  const resourceHosts = (el) => {
    const link = el.closest('a[href]') || el.querySelector('a[href]');
    const img = el.matches('img') ? el : el.querySelector('img');
    const frame = el.matches('iframe') ? el : el.querySelector('iframe');
    const ext = (h) => (h && siteOf(h) !== siteOf(pageHost) ? h : '');
    return { link: ext(link && hostOf(link.href)), img: ext(img && hostOf(img.currentSrc || img.src)), frame: ext(frame && hostOf(frame.src)) };
  };
  const inspect = (el) => {
    const r = el.getBoundingClientRect();
    const attrs = {};
    for (const a of el.attributes) {
      if (a.name === 'id' || a.name === 'class' || a.name === 'style' || /^on/i.test(a.name)) continue;
      // values only for ad markers; everything else is kept as a name
      attrs[a.name] = /^data-(ad|ads|adslot|ad-slot|ad-client|ad-unit|ad-format|ad-name|advert|sponsor)/i.test(a.name) ? String(a.value).slice(0, 40) : '';
    }
    const aria = (el.getAttribute('aria-label') || '').trim();
    return {
      tag: el.tagName.toLowerCase(), id: el.id || '', classes: [...el.classList], attrs,
      ariaAd: AD_LABEL.test(aria), w: Math.round(r.width), h: Math.round(r.height),
      hosts: resourceHosts(el), children: [...el.children].slice(0, 6).map((c) => c.tagName.toLowerCase()),
    };
  };
  const info = inspect(box);
  const pattern = L.normalizeNode(info);
  let parentId = null;
  for (let n = box.parentElement; n && n !== document.body; n = n.parentElement) {
    if (n.id && L.tokenKind(n.id) !== 'dynamic' && L.tokenKind(n.id) !== 'generic') { parentId = n.id; break; }
  }

  // ---------- 3. validate each candidate on this page ----------
  const totalElements = document.getElementsByTagName('*').length;
  function validate(sel) {
    const reasons = [];
    if (!L.safeSelectorText(sel)) return { valid: false, matches: 0, reasons: ['unsafe selector text'] };
    let list;
    try { list = [...document.querySelectorAll(sel)]; } catch { return { valid: false, matches: 0, reasons: ['invalid selector'] }; }
    if (!list.includes(box) && !list.some((m) => m.contains(box))) return { valid: false, matches: list.length, reasons: ['does not match the ad'] };
    if (list.length > 6 || list.length > Math.max(3, totalElements * 0.02)) return { valid: false, matches: list.length, reasons: [`too broad: matches ${list.length} elements`] };
    const bad = list.find(tooBig);
    if (bad) return { valid: false, matches: list.length, reasons: ['would hide page content (a big or text-heavy block)'] };
    // the same selector must not also catch normal content next to the ad
    const contenty = list.filter((m) => m !== box && !m.contains(box) && textLen(m) > 120);
    if (contenty.length) return { valid: false, matches: list.length, reasons: ['also matches normal content'] };
    return { valid: true, matches: list.length, reasons };
  }

  const sig = adSignals(box);
  const hosts = pattern.hosts;
  const signals = {
    adSize: sig.size, adText: sig.label || pattern.ariaAd, adAttr: sig.adAttr,
    thirdPartyLink: !!hosts.link, adFrame: !!hosts.frame,
    knownAdHost: false, // filled in by the service worker, which has the ad lists
  };
  const cands = L.candidates(pattern, { parentId }).map((c) => ({ ...c, validation: validate(c.selector) }));

  return {
    version: 1,
    site: pageHost,                         // host only, never the page URL
    inFrame: window !== window.top,
    fingerprint: L.fingerprint(pattern),
    pattern,                                // structure only: tags, stable classes, attribute names, hosts
    signals,
    candidates: cands,
    clicked: target === box ? 'box' : target.tagName.toLowerCase(),
  };
})();
