// PopGuard - isolated-world content script.
// 1) Removes invisible full-page overlays that hijack your clicks.
// 2) Tells the background which link you really clicked (so it can close fake new tabs).
// 3) Forwards "blocked" reports from inject.js to the badge counter.
(() => {
  let enabled = true;
  const host = PG.hostOf(location.href);
  try {
    chrome.storage.local.get('whitelist', async ({ whitelist = [] }) => {
      const settings = await PG.getSettings();
      enabled = settings.removeOverlays && !PG.isWhitelisted(host, whitelist);
    });
  } catch {}

  const send = (msg) => { try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch {} };

  document.addEventListener('popguard:blocked', (e) => {
    try { send({ type: 'blocked', ...JSON.parse(e.detail) }); } catch {}
  });

  // ---- Invisible overlay detection ----
  const isTransparent = (c) => c === 'transparent' || /rgba\(.*,\s*0(\.0+)?\)$/.test(c);
  const hasVisibleContent = (n) =>
    n.querySelector('img,video,canvas,svg,iframe,input,button,textarea,select') || (n.innerText || '').trim().length > 0;

  function findOverlay(el) {
    const area = innerWidth * innerHeight;
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      const r = n.getBoundingClientRect();
      if (r.width * r.height < area * 0.4) continue;
      const invisible =
        parseFloat(cs.opacity) < 0.1 ||
        (isTransparent(cs.backgroundColor) && cs.backgroundImage === 'none' && !hasVisibleContent(n));
      if (!invisible) continue;
      const z = parseInt(cs.zIndex, 10) || 0;
      const a = n.tagName === 'A' ? n : n.querySelector('a[href]');
      const crossSiteLink = a && a.hostname && PG.siteOf(a.hostname) !== PG.siteOf(host);
      if (crossSiteLink || (cs.position === 'fixed' && z >= 1000)) return n;
    }
    return null;
  }

  let swallowUntil = 0;
  const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };

  const onDown = (e) => {
    if (!enabled || !e.isTrusted) return;
    const ov = findOverlay(e.target);
    if (!ov) return;
    swallow(e);
    ov.style.setProperty('display', 'none', 'important');
    ov.style.setProperty('pointer-events', 'none', 'important');
    swallowUntil = Date.now() + 800;
    send({ type: 'blocked', kind: 'overlay', url: ov.href || '' });
  };
  const onRest = (e) => {
    if (Date.now() > swallowUntil) return;
    swallow(e);
    if (e.type === 'click') {
      swallowUntil = 0;
      // pass the click to whatever was really underneath (e.g. the video play button)
      const under = document.elementFromPoint(e.clientX, e.clientY);
      if (under && !under.closest('a[href]')) under.click();
    }
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('mousedown', onDown, true);
  for (const t of ['pointerup', 'mouseup', 'click']) window.addEventListener(t, onRest, true);

  // ---- Report genuine link clicks to background ----
  const linkFrom = (e) => {
    const path = e.composedPath ? e.composedPath() : [e.target];
    const a = path.find((n) => n && n.matches && n.matches('a[href]'));
    return a ? a.href : null;
  };
  for (const t of ['mousedown', 'auxclick', 'contextmenu', 'keydown']) {
    window.addEventListener(t, (e) => {
      if (!e.isTrusted || Date.now() < swallowUntil) return;
      const href = t === 'keydown' ? (e.key === 'Enter' ? linkFrom({ target: document.activeElement, composedPath: null }) : null) : linkFrom(e);
      send({ type: 'click', href });
    }, true);
  }

  // ---- "Closed a new tab - Open anyway" (top frame only) ----
  // Drawn here in the isolated world, inside a closed shadow root, so the page can't press the
  // button itself. The background only reopens the exact URL it just closed in this tab.
  if (window.top !== window) return;
  let noticeHost = null;
  const showClosedNotice = (url) => {
    noticeHost?.remove();
    noticeHost = document.createElement('popguard-notice');
    const root = noticeHost.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .t{position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;
           font:13px/1.4 system-ui,sans-serif;background:#111827;color:#f9fafb;border-radius:10px;
           padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center}
        .m{flex:1;overflow-wrap:anywhere} b{color:#93c5fd}
        button{all:unset;cursor:pointer;padding:4px 8px;border-radius:6px;background:#2563eb;color:#fff;font-weight:600;white-space:nowrap}
        .x{background:transparent;color:#9ca3af;font-weight:400}
      </style>
      <div class="t" role="status"><div class="m">Closed a new tab to <b></b></div><button class="go">Open anyway</button><button class="x" aria-label="Dismiss">✕</button></div>`;
    root.querySelector('b').textContent = PG.hostOf(url) || url;
    const me = noticeHost;
    root.querySelector('.go').addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      me.remove();
      send({ type: 'reopenTab', url });
    });
    root.querySelector('.x').addEventListener('click', () => me.remove());
    (document.body || document.documentElement).appendChild(me);
    setTimeout(() => me.remove(), 12000);
  };
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type !== 'tabClosed') return;
      PG.getSettings().then((s) => { if (s.showNotices) showClosedNotice(msg.url); });
    });
  } catch {}
})();
