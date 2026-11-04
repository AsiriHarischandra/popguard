/*
 * Smart Ad Learning - core logic (Phase 1: analyse and validate only).
 *
 * Pure functions with no DOM access, so they run anywhere (content script, service worker, tests):
 *   tokenKind()        is a class / id stable, generated, generic layout, or an ad marker?
 *   normalizeNode()    an inspected element -> its stable pattern
 *   fingerprint()      a pattern -> short hash, the same for the same widget on any page
 *   candidates()       a pattern -> possible CSS selectors, most reliable first
 *   score()            a candidate + its validation on the page -> confidence 0-100 and scope
 *   networkScore()     a resource host -> how sure we are it is an ad server (scored separately)
 *   safeSelectorText() rejects anything that isn't a plain, short selector
 *
 * Everything runs locally. Nothing here reads page text, form data, cookies or full URLs.
 */
(() => {
  const g = globalThis;
  if (g.PGLearn) return;

  // ---------- tokens (classes, ids) ----------
  // Words that mark an ad when they appear as a separate word in a class / id / attribute.
  const AD_WORDS = new Set(['ad', 'ads', 'adv', 'advert', 'adverts', 'advertisement', 'advertising', 'sponsor',
    'sponsored', 'sponsors', 'promo', 'promoted', 'banner', 'banners', 'adslot', 'adunit', 'adbox', 'adsense',
    'adsbygoogle', 'dfp', 'gpt', 'taboola', 'outbrain', 'mgid', 'teads', 'adsterra', 'propeller', 'adstudio',
    'betting', 'casino', '1xbet', 'billboard', 'leaderboard', 'skyscraper', 'interstitial', 'preroll']);
  // Words that are only strong ad markers together with others ("promo" can be a site's own offer).
  const WEAK_AD_WORDS = new Set(['promo', 'promoted', 'banner', 'banners', 'billboard', 'leaderboard']);
  // Layout words that thousands of normal elements share.
  const GENERIC = new Set(['row', 'col', 'cols', 'column', 'columns', 'container', 'wrapper', 'wrap', 'inner',
    'outer', 'content', 'contents', 'box', 'item', 'items', 'card', 'cards', 'flex', 'grid', 'block', 'section',
    'clearfix', 'clear', 'left', 'right', 'center', 'top', 'bottom', 'main', 'body', 'text', 'image', 'img',
    'link', 'list', 'active', 'show', 'hidden', 'visible', 'fade', 'in', 'd-flex', 'd-block', 'd-none',
    'widget', 'module', 'component', 'element', 'el', 'container-fluid', 'section-inner', 'mobile', 'desktop']);
  const UTILITY = /^-?(m|p)[trblxyse]?-|^(w|h|min-w|min-h|max-w|max-h|gap|space-[xy]|text|bg|border|rounded|shadow|font|leading|tracking|z|order|col-span|row-span|opacity|justify|items|self|place|overflow)-|^(col|offset)(-[a-z]{2})?-\d+$|^(sm|md|lg|xl|xxl)$/;

  /** "sidebarAdBox" / "sidebar-ad_box" -> ["sidebar", "ad", "box"] */
  const words = (t) => String(t).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  /** 'dynamic' (generated, changes per visit) | 'generic' (layout) | 'ad' | 'stable' */
  function tokenKind(token) {
    const t = String(token || '');
    if (!t || t.length > 60 || /[^\w-]/.test(t)) return 'dynamic';                    // odd characters, Tailwind variants
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return 'dynamic'; // UUID
    if (/^(css|sc|jsx|emotion|styled|svelte|astro|chakra|mui|e)-[a-z0-9]*\d[a-z0-9]*$/i.test(t)) return 'dynamic';
    if (/^sc-[a-z]{5,}$/i.test(t)) return 'dynamic';                                     // styled-components
    if (/_{1,2}[A-Za-z0-9-]{5,}$/.test(t) && /\d/.test(t.split(/_+/).pop())) return 'dynamic'; // CSS modules: title__3xK9a
    if (/^_[a-z0-9]{4,8}$/i.test(t) && /\d/.test(t)) return 'dynamic';                 // _a8f3k
    if (/\d{4,}/.test(t)) return 'dynamic';                                              // timestamps, counters
    const digits = (t.match(/\d/g) || []).length;
    if (digits >= 3 && /[a-z]/i.test(t) && !/^(h[1-6]|x[1-9]|1x|2x|3x)$/i.test(t)) {
      // letters and digits mixed like "a8f3k2b7" (not "col-12" or "300x250")
      if (!/^[a-z]+[-_]?\d{1,3}([-_x]\d{1,3})*$/i.test(t)) return 'dynamic';
    }
    const ws = words(t);
    if (ws.some((w) => AD_WORDS.has(w))) return 'ad';
    if (GENERIC.has(t.toLowerCase()) || UTILITY.test(t) || t.length < 3) return 'generic';
    return 'stable';
  }
  const isStrongAd = (t) => words(t).some((w) => AD_WORDS.has(w) && !WEAK_AD_WORDS.has(w));

  /** Stable part of a generated id: "div-gpt-ad-1700000000-0" -> "div-gpt-ad-" (or null). */
  function idPrefix(id) {
    const m = /^([a-z][a-z_-]*?[-_])(?=[^-_]*\d)/i.exec(String(id || ''));
    if (!m || m[1].length < 4) return null;
    return tokenKind(m[1].replace(/[-_]+$/, '')) === 'dynamic' ? null : m[1];
  }

  // Attribute names worth keeping. Values are kept only for ad markers, never for anything else.
  const AD_ATTR = /^data-(ad|ads|adslot|ad-slot|ad-client|ad-unit|ad-format|google-query-id|ad-name|advert|sponsor|native-ad|taboola|ob-)/i;

  /**
   * An inspected node (see content/learn.js) -> its stable pattern.
   * info: { tag, id, classes[], attrs: {name: value}, role, ariaAd, w, h, hosts: { link, img, frame } }
   */
  function normalizeNode(info) {
    const classes = [...new Set(info.classes || [])];
    const kinds = Object.fromEntries(classes.map((c) => [c, tokenKind(c)]));
    const idKind = info.id ? tokenKind(info.id) : null;
    return {
      tag: String(info.tag || '').toLowerCase(),
      id: idKind && idKind !== 'dynamic' ? info.id : null,
      idKind,
      idPrefix: idKind === 'dynamic' ? idPrefix(info.id) : null,
      adClasses: classes.filter((c) => kinds[c] === 'ad').sort(),
      stableClasses: classes.filter((c) => kinds[c] === 'stable').sort(),
      genericClasses: classes.filter((c) => kinds[c] === 'generic').sort(),
      droppedClasses: classes.filter((c) => kinds[c] === 'dynamic').length,
      adAttrs: Object.keys(info.attrs || {}).filter((n) => AD_ATTR.test(n)).sort(),
      attrNames: Object.keys(info.attrs || {}).filter((n) => /^(data-|aria-|role$)/.test(n) && tokenKind(n) !== 'dynamic').sort(),
      ariaAd: !!info.ariaAd,
      size: [Math.round((info.w || 0) / 10) * 10, Math.round((info.h || 0) / 10) * 10],
      hosts: info.hosts || {},
      children: (info.children || []).map((c) => String(c).toLowerCase()),
    };
  }

  // ---------- fingerprint ----------
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  /** Same widget -> same fingerprint, whatever its generated classes / ids and exact size. */
  function fingerprint(pattern) {
    const p = pattern;
    const sizeBucket = p.size.map((v) => Math.round(v / 50) * 50).join('x');
    const canon = [p.tag, p.id || p.idPrefix || '', p.adClasses.join('.'), p.stableClasses.join('.'),
      p.adAttrs.join(','), p.children.join(','), sizeBucket,
      p.hosts.frame || '', p.hosts.link || '', p.hosts.img || ''].join('|');
    return fnv1a(canon);
  }

  // ---------- candidate selectors ----------
  const esc = (s) => String(s).replace(/[^\w-]/g, (c) => '\\' + c);
  const attrVal = (s) => String(s).replace(/["\\\n\r]/g, '');

  /**
   * Candidate selectors for the ad box, most reliable kind first. Each: { type, selector }.
   * ctx: { parentId } a stable id on an ancestor, used to anchor the weakest kinds.
   */
  function candidates(pattern, ctx = {}) {
    const p = pattern, out = [];
    const add = (type, selector) => { if (selector && !out.some((c) => c.selector === selector)) out.push({ type, selector }); };
    for (const a of p.adAttrs) add('ad-attribute', `${p.tag}[${a}]`);
    if (p.idPrefix) add('id-prefix', `${p.tag}[id^="${attrVal(p.idPrefix)}"]`);
    if (p.id) add('id', `#${esc(p.id)}`);
    if (p.adClasses.length) add('ad-class', `${p.tag}.${p.adClasses.map(esc).join('.')}`);
    if (p.hosts.frame) add('ad-resource', `iframe[src*="${attrVal(p.hosts.frame)}"]`);
    if (p.hosts.link && p.tag === 'a') add('ad-resource', `a[href*="${attrVal(p.hosts.link)}"]`);
    if (p.stableClasses.length) {
      const cls = p.stableClasses.slice(0, 3).map(esc).join('.');
      add('class', `${p.tag}.${cls}`);
      if (ctx.parentId) add('anchored-class', `#${esc(ctx.parentId)} ${p.tag}.${cls}`);
    }
    if (p.genericClasses.length && ctx.parentId) add('anchored-generic', `#${esc(ctx.parentId)} > ${p.tag}.${p.genericClasses.slice(0, 2).map(esc).join('.')}`);
    if (ctx.parentId) add('anchored-tag', `#${esc(ctx.parentId)} > ${p.tag}`);
    return out;
  }

  /** Only short, plain selectors: no braces, semicolons, comments, at-rules or newlines. */
  function safeSelectorText(sel) {
    return typeof sel === 'string' && sel.length > 0 && sel.length <= 200 && !/[{};<@\n\r]|\/\*|\\[0-9a-f]{1,6}\s/i.test(sel);
  }

  // ---------- confidence ----------
  const BASE = { 'ad-attribute': 75, 'id-prefix': 65, 'ad-class': 60, 'ad-resource': 55, id: 45, class: 35,
    'anchored-class': 40, 'anchored-generic': 25, 'anchored-tag': 15 };

  /**
   * candidate: { type, selector } - validation: { valid, matches, reasons[] } (see content/learn.js)
   * signals: { adSize, adText, thirdPartyLink, knownAdHost, adFrame, adAttr }
   * -> { score 0-100, scope 'site' | 'global' | null, reasons[] }
   */
  function score(candidate, validation, pattern, signals = {}) {
    const reasons = [...(validation.reasons || [])];
    if (!validation.valid) return { score: 0, scope: null, reasons };
    let s = BASE[candidate.type] ?? 10;
    if (signals.adSize) { s += 8; reasons.push('standard ad size'); }
    if (signals.adText) { s += 6; reasons.push('labelled "Ad" / "Sponsored"'); }
    if (signals.knownAdHost) { s += 15; reasons.push('loads from a known ad network'); }
    else if (signals.thirdPartyLink) { s += 4; reasons.push('links to another site'); }
    if (pattern.adClasses.some(isStrongAd) || pattern.adAttrs.length || pattern.idPrefix && isStrongAd(pattern.idPrefix)) { s += 8; reasons.push('ad words in its classes / attributes'); }
    if (pattern.ariaAd) { s += 5; reasons.push('marked as an ad for screen readers'); }
    if (validation.matches > 1) { s -= Math.min(30, (validation.matches - 1) * 6); reasons.push(`matches ${validation.matches} elements`); }
    if (pattern.droppedClasses) reasons.push(`ignored ${pattern.droppedClasses} generated class name${pattern.droppedClasses > 1 ? 's' : ''}`);
    s = Math.max(0, Math.min(100, Math.round(s)));
    // Global use needs a marker that means "ad" on any site, not this site's own layout.
    const portable = ['ad-attribute', 'id-prefix', 'ad-class', 'ad-resource'].includes(candidate.type);
    const strongMarker = signals.knownAdHost || pattern.adAttrs.length > 0 ||
      (candidate.type !== 'ad-resource' && (pattern.adClasses.some(isStrongAd) || (pattern.idPrefix && isStrongAd(pattern.idPrefix))));
    const scope = s >= 85 && portable && strongMarker ? 'global' : s >= 60 ? 'site' : null;
    return { score: s, scope, reasons };
  }

  /**
   * How sure are we that blocking requests to this host is right? Scored on its own: hiding an
   * element confidently says nothing about whether its server only serves ads.
   * info: { host, pageSite, sameOwner, knownAdHost, adWordsInHost, cdn }
   */
  function networkScore(info) {
    const reasons = [];
    if (!info.host) return { score: 0, reasons: ['no outside resource'] };
    if (info.sameOwner) return { score: 0, reasons: ['same site or company as the page'] };
    if (info.cdn) return { score: 0, reasons: ['shared content network - blocking it would break other sites'] };
    let s = 0;
    if (info.knownAdHost) { s += 80; reasons.push('on PopGuard\'s ad / betting lists'); }
    if (info.adWordsInHost) { s += 15; reasons.push('ad words in the host name'); }
    if (!s) reasons.push('not a known ad host');
    return { score: Math.min(100, s), reasons };
  }

  // Hosts that serve everyone's files; never a network-rule target.
  const CDN = /(^|\.)(googleapis\.com|gstatic\.com|cloudflare\.com|cloudfront\.net|akamaihd\.net|akamaized\.net|fastly\.net|jsdelivr\.net|unpkg\.com|bootstrapcdn\.com|jquery\.com|wp\.com|wordpress\.com|imgur\.com|githubusercontent\.com|ytimg\.com|fbcdn\.net|twimg\.com)$/i;

  g.PGLearn = Object.freeze({ tokenKind, idPrefix, words, normalizeNode, fingerprint, candidates, safeSelectorText, score, networkScore, CDN, AD_WORDS });
})();
