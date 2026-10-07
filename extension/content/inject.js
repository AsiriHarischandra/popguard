// PopGuard - runs in the page's MAIN world, before any site script.
// Blocks: window.open pop-ups/pop-unders, fake programmatic link clicks,
// and "tab-under" / click-redirects of the current tab to another site.
(() => {
  if (window.__popguardActive) return;
  Object.defineProperty(window, '__popguardActive', { value: true });

  const OFF = window.__popguardOff || {};   // set by content/flags/*.js from Settings
  const CLICK_WINDOW_MS = 2000;
  const here = location;
  let lastClick = { t: 0, href: null, el: null, openedSelf: false };

  // ---------- helpers ----------
  const abs = (u) => { try { return new URL(String(u ?? ''), here.href).href; } catch { return null; } };
  const siteOf = (u) => {
    try {
      const h = new URL(u).hostname.replace(/^www\./, '');
      const p = h.split('.');
      return p.length > 2 ? p.slice(-2).join('.') : h; // rough eTLD+1
    } catch { return ''; }
  };
  const isSafeScheme = (u) => /^(blob:|data:|javascript:|mailto:|tel:)/i.test(u || '');
  const sameSite = (u) => {
    if (!u || isSafeScheme(u)) return true;
    if (u === 'about:blank') return false;
    return siteOf(u) === siteOf(here.href);
  };
  const strip = (u) => (u || '').split('#')[0].replace(/\/$/, '');
  const freshClick = () => Date.now() - lastClick.t < CLICK_WINDOW_MS;
  const matchesClickedLink = (u) => freshClick() && lastClick.href && strip(lastClick.href) === strip(u);
  // composedPath() sees links inside shadow DOM (web-component pages like Edge's New Tab)
  const linkOf = (e) => {
    for (const n of (e.composedPath ? e.composedPath() : [e.target])) {
      if (n && n.matches && n.matches('a[href],area[href]')) return n;
    }
    return null;
  };

  const report = (kind, url) => {
    try {
      document.dispatchEvent(new CustomEvent('popguard:blocked', { detail: JSON.stringify({ kind, url: String(url || '') }) }));
    } catch {}
  };

  // Record what the user REALLY clicked (trusted events only).
  for (const type of ['pointerdown', 'mousedown', 'click', 'auxclick', 'touchstart']) {
    window.addEventListener(type, (e) => {
      if (!e.isTrusted) return;
      const a = linkOf(e);
      if (type === 'pointerdown' || type === 'mousedown' || type === 'touchstart') {
        lastClick = { t: Date.now(), href: a ? abs(a.getAttribute('href')) : null, el: e.target, openedSelf: false };
      } else {
        lastClick.t = Date.now();
      }
    }, true);
  }

  // ---------- small notice with "open anyway" ----------
  let toastHost = null;
  const toast = (msg, actionLabel, action) => {
    if (OFF.notices) return;
    try {
      if (toastHost) toastHost.remove();
      toastHost = document.createElement('popguard-toast');
      const root = toastHost.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>
          .t{position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;
             font:13px/1.4 system-ui,sans-serif;background:#111827;color:#f9fafb;border-radius:10px;
             padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center}
          .m{flex:1;word-break:break-all} b{color:#93c5fd}
          button{all:unset;cursor:pointer;padding:4px 8px;border-radius:6px;background:#2563eb;color:#fff;font-weight:600;white-space:nowrap}
          .x{background:transparent;color:#9ca3af;font-weight:400}
        </style>
        <div class="t"><div class="m"></div><button class="go"></button><button class="x">✕</button></div>`;
      root.querySelector('.m').innerHTML = msg;
      const go = root.querySelector('.go');
      if (actionLabel) { go.textContent = actionLabel; go.onclick = (e) => { if (e.isTrusted) { toastHost.remove(); action(); } }; }
      else go.remove();
      root.querySelector('.x').onclick = () => toastHost.remove();
      (document.body || document.documentElement).appendChild(toastHost);
      const me = toastHost;
      setTimeout(() => me.remove(), 7000);
    } catch {}
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hostLabel = (u) => { try { return new URL(u).hostname || u; } catch { return u; } };

  // ---------- 1. window.open ----------
  if (!OFF.popups) {
  const realOpen = window.open;
  const fakeWin = new Proxy(function () {}, {
    get: (t, k) => (k === 'closed' ? true : k === Symbol.toPrimitive ? () => '' : fakeWin),
    set: () => true,
    apply: () => fakeWin,
  });

  function guardedOpen(url, name, features) {
    const u = abs(url) || 'about:blank';
    if (sameSite(u) && u !== 'about:blank') {
      if (freshClick()) lastClick.openedSelf = true; // possible tab-under setup
      return realOpen.apply(window, arguments);
    }
    if (matchesClickedLink(u)) return realOpen.apply(window, arguments);
    report('popup', u);
    if (u !== 'about:blank') {
      toast(`Blocked pop-up to <b>${esc(hostLabel(u))}</b>`, 'Open anyway', () => realOpen.call(window, u, '_blank'));
    }
    return fakeWin;
  }
  try { Object.defineProperty(window, 'open', { value: guardedOpen, writable: false, configurable: false }); }
  catch { window.open = guardedOpen; }

  // Scripts often grab a "clean" window.open from a fresh iframe.
  try {
    const cw = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      ...cw,
      get() {
        const w = cw.get.call(this);
        try { if (w && w.open !== guardedOpen) Object.defineProperty(w, 'open', { value: guardedOpen }); } catch {}
        return w;
      },
    });
  } catch {}

  // ---------- 2. fake clicks on hidden ad links ----------
  const suspiciousAnchor = (a) => {
    const u = abs(a.getAttribute('href'));
    if (!u || sameSite(u)) return false;
    return !matchesClickedLink(u);
  };
  const realAClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (suspiciousAnchor(this)) { report('fake-click', this.href); return; }
    return realAClick.call(this);
  };
  const realDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && this instanceof HTMLAnchorElement && suspiciousAnchor(this)) {
      report('fake-click', this.href);
      return false;
    }
    return realDispatch.call(this, ev);
  };

  } // end popups

  // ---------- 3. click-redirect of the current tab ----------
  if (!OFF.redirects && window.top === window && window.navigation) {
    window.navigation.addEventListener('navigate', (e) => {
      if (!e.cancelable || e.hashChange || e.downloadRequest) return;
      if (e.navigationType === 'reload' || e.navigationType === 'traverse') return;
      const dest = e.destination.url;
      if (sameSite(dest)) return;
      if (!freshClick()) return;                 // only redirects caused by a click
      if (e.userInitiated && !lastClick.openedSelf) return; // real link the user clicked
      if (matchesClickedLink(dest) && !lastClick.openedSelf) return;
      e.preventDefault();
      report('redirect', dest);
      toast(`Blocked redirect to <b>${esc(hostLabel(dest))}</b>`, 'Go anyway', () => { lastClick.t = 0; location.href = dest; });
    });
  }
})();
