// PopGuard - hides banner ads on the page.
// 1) A list of well-known ad selectors (Google ads, AdStudio, betting links...).
// 2) A smart scan: images/iframes that look like banners and link to another site.
// 3) Your own "Hide this ad" picks from the right-click menu (saved per site).
(() => {
  const host = PG.hostOf(location.href);
  const siteOf = PG.siteOf;
  const mySite = siteOf(host);

  // Betting / casino / ad-network words that show up in ad links and image names.
  const AD_WORDS = /1x(bet|lite|slot|games)|melbet|betwinner|mostbet|linebet|22bet|bet365|parimatch|pin-?up|stake\.com|1win|casino|betting|refpa|promocode|adstudio|adsterra|propeller|popads|exoclick|juicyads|hilltop|clickadu|adcash|doubleclick|googlesyndication|taboola|outbrain/i;

  const AD_SELECTORS = [
    'ins.adsbygoogle', '[id^="google_ads"]', '[id^="div-gpt-ad"]', '[data-ad-slot]', '[data-ad-client]',
    'iframe[src*="googlesyndication"]', 'iframe[src*="doubleclick"]',
    'iframe[src*="adstudio"]', 'a[href*="adstudio.cloud"]', '[id*="adstudio" i]', '[class*="adstudio" i]',
    '[id*="taboola" i]', '[class*="taboola" i]', '[class*="OUTBRAIN" i]',
    'a[href*="1xbet" i]', 'a[href*="1xlite" i]', 'a[href*="melbet" i]', 'a[href*="betwinner" i]',
    'a[href*="mostbet" i]', 'a[href*="1win" i]', 'a[href*="refpa" i]', 'a[href*="linebet" i]',
    'img[src*="1xbet" i]', 'img[alt*="1xbet" i]', 'img[src*="casino" i]',
    '.adsbox', '.ad-banner', '.ad-container', '.ad-wrapper', '.ads-banner', '.banner-ads', '.adsense',
    '[aria-label="Advertisement" i]', '[aria-label="Ads" i]',
  ];

  // Standard ad banner sizes (width x height)
  const AD_SIZES = [[728, 90], [970, 90], [970, 250], [468, 60], [320, 50], [320, 100], [300, 250],
    [336, 280], [160, 600], [300, 600], [120, 600], [250, 250], [200, 200], [300, 100], [300, 50]];
  const isAdSize = (w, h) => AD_SIZES.some(([aw, ah]) => Math.abs(w - aw) <= 8 && Math.abs(h - ah) <= 8);

  let enabled = true;        // built-in banner hiding (Settings > Hide banner ads)
  let whitelisted = false;
  let userHides = [];        // from custom element-hiding filters + right-click picks
  let styleEl = null;
  let hiddenCount = 0;

  const send = (m) => { try { chrome.runtime.sendMessage(m).catch(() => {}); } catch {} };

  function writeCss() {
    const selectors = whitelisted ? [] : [...(enabled ? AD_SELECTORS : []), ...userHides];
    if (!selectors.length) { styleEl?.remove(); return; }
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'popguard-cosmetic'; }
    // one rule per selector, so a single invalid custom selector can't break the rest
    styleEl.textContent = selectors.map((sel) => `${sel} { display: none !important; visibility: hidden !important; }`).join('\n') + '\n' +
      '[data-popguard-hidden] { display: none !important; }';
    (document.head || document.documentElement).appendChild(styleEl);
  }

  // Hide an element, plus wrapper boxes that only exist to hold it.
  function hide(el) {
    let target = el;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const onlyChild = p.children.length === 1 && !(p.textContent || '').replace(/\s+/g, '').length
        || [...p.children].every((c) => c === target || c.matches('br,script,style,ins,noscript') || c.hasAttribute('data-popguard-hidden'));
      if (!onlyChild || (p.textContent || '').trim().length > 40) break;
      target = p;
    }
    if (target.hasAttribute('data-popguard-hidden')) return;
    target.setAttribute('data-popguard-hidden', '');
    hiddenCount++;
    const a = target.matches('a[href]') ? target : target.querySelector('a[href], iframe[src], img[src]');
    send({ type: 'hidden', url: a ? (a.href || a.src || '') : '' });
  }

  const linkHostOf = (a) => { try { return new URL(a.href).hostname; } catch { return ''; } };

  function looksLikeAd(el) {
    const r = el.getBoundingClientRect();
    const w = r.width, h = r.height;
    if (w < 100 || h < 30) return false;
    const src = el.currentSrc || el.src || '';
    const a = el.closest('a[href]');
    const href = a ? a.href : '';

    if (AD_WORDS.test(src) || AD_WORDS.test(href) || AD_WORDS.test(el.alt || '')) return true;

    if (el.tagName === 'IFRAME') {
      let ih = '';
      try { ih = new URL(src, location.href).hostname; } catch {}
      if (!ih || siteOf(ih) === mySite) return false;
      if (/youtube|vimeo|dailymotion|player|embed|video|stream|disqus|recaptcha|facebook|twitter/i.test(src)) return false;
      return isAdSize(w, h);
    }

    // image inside a link to ANOTHER site, shaped like a banner
    if (a) {
      const lh = linkHostOf(a);
      if (!lh || siteOf(lh) === mySite) return false;
      if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(href)) return false; // link to a full-size image
      if ((a.textContent || '').trim().length > 30) return false;    // normal text link with picture
      return isAdSize(w, h) || (w >= 300 && w / h >= 2.2) || /\.gif(\?|$)/i.test(src);
    }
    return false;
  }

  function scan() {
    if (!enabled || !document.body) return;
    for (const el of document.querySelectorAll('img, iframe, video[src*="banner" i]')) {
      if (el.closest('[data-popguard-hidden]')) continue;
      try { if (looksLikeAd(el)) hide(el.closest('a[href]') || el); } catch {}
    }
    // elements that carry a background-image banner inside a betting link
    for (const a of document.querySelectorAll('a[href]')) {
      if (!a.closest('[data-popguard-hidden]') && AD_WORDS.test(a.href)) hide(a);
    }
  }

  let timer = null;
  const scheduleScan = () => { if (!timer) timer = setTimeout(() => { timer = null; scan(); }, 300); };

  // ---- Right-click "Hide this ad" ----
  let lastRightClicked = null;
  window.addEventListener('contextmenu', (e) => { lastRightClicked = e.target; }, true);

  function selectorFor(el) {
    const a = el.closest('a[href]');
    if (a) { const lh = linkHostOf(a); if (lh && siteOf(lh) !== mySite) return `a[href*="${lh.replace(/^www\./, '')}"]`; }
    const fr = el.closest('iframe[src]');
    if (fr) { try { return `iframe[src*="${new URL(fr.src).hostname}"]`; } catch {} }
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      if (n.id && /^[a-z][\w-]{2,}$/i.test(n.id) && !/\d{4,}/.test(n.id)) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let part = n.tagName.toLowerCase();
      const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(n) + 1})`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  }

  const saveHide = (sel) => chrome.storage.local.get('cosmeticFilters', ({ cosmeticFilters = [] }) => {
    chrome.storage.local.set({ cosmeticFilters: [...new Set([...cosmeticFilters, `${host}##${sel}`])] });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'pickHide' && lastRightClicked) {
      const el = lastRightClicked.closest('a[href], iframe, ins') || lastRightClicked;
      saveHide(selectorFor(el));
      hide(el);
      lastRightClicked = null;
    }
    if (msg.type === 'hideFrame' && window === window.top) {
      // the ad was inside an iframe: hide that iframe from the top page
      let fh = '';
      try { fh = new URL(msg.url).hostname; } catch { return; }
      const frames = [...document.querySelectorAll('iframe')].filter((f) => { try { return new URL(f.src, location.href).hostname === fh; } catch { return false; } });
      frames.forEach(hide);
      if (frames.length) saveHide(`iframe[src*="${fh}"]`);
    }
  });

  // ---- start ----
  const load = async () => {
    const { whitelist = [], cosmeticFilters = [] } = await chrome.storage.local.get(['whitelist', 'cosmeticFilters']);
    const settings = await PG.getSettings();
    whitelisted = PG.isWhitelisted(host, whitelist);
    enabled = settings.hideBanners;
    userHides = PG.cosmeticSelectorsFor(host, cosmeticFilters);
    writeCss();
  };
  load().then(() => {
    if (whitelisted || !enabled) return;
    const start = () => {
      scan();
      new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] });
      window.addEventListener('load', scan);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && (c.cosmeticFilters || c.whitelist || c.settings)) load();
  });
})();
