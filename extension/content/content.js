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
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    return a ? a.href : null;
  };
  for (const t of ['mousedown', 'auxclick', 'contextmenu', 'keydown']) {
    window.addEventListener(t, (e) => {
      if (!e.isTrusted || Date.now() < swallowUntil) return;
      const href = t === 'keydown' ? (e.key === 'Enter' ? linkFrom({ target: document.activeElement }) : null) : linkFrom(e);
      send({ type: 'click', href });
    }, true);
  }
})();
