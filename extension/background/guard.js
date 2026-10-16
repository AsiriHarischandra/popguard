/*
 * Pop-up / redirect guard (background half).
 *  - Registers content/inject.js in the page's MAIN world, skipping whitelisted
 *    sites and prepending flag files for features switched off in Settings.
 *  - Closes new tabs that a page opened without the user clicking a matching link,
 *    and lets the page offer "Open anyway" for them.
 */
const PGGuard = (() => {
  const MAIN_ID = 'popguard-main';
  const lastClick = new Map();   // tabId -> { href, t }
  const watchBlank = new Map();  // new tabId -> { srcTabId, srcUrl, until }
  const strip = (u) => (u || '').split('#')[0].replace(/\/$/, '');

  async function registerMain() {
    const settings = await PG.getSettings();
    const { whitelist = [] } = await chrome.storage.local.get('whitelist');
    try { await chrome.scripting.unregisterContentScripts({ ids: [MAIN_ID] }); } catch {}
    if (!settings.blockPopups && !settings.blockRedirects) return;
    const js = [];
    if (!settings.blockPopups) js.push('content/flags/off-popups.js');
    if (!settings.blockRedirects) js.push('content/flags/off-redirects.js');
    if (!settings.showNotices) js.push('content/flags/off-notices.js');
    js.push('shared/families.js', 'content/inject.js');
    await chrome.scripting.registerContentScripts([{
      id: MAIN_ID, js, matches: ['<all_urls>'],
      excludeMatches: [...whitelist, ...PG.BUILTIN_TRUSTED].map((d) => `*://*.${d}/*`),
      runAt: 'document_start', allFrames: true, world: 'MAIN', persistAcrossSessions: true,
    }]);
  }

  async function judgeNewTab(newTabId, srcTabId, srcUrl, targetUrl) {
    // Only web pages can show ads. Tabs opened by browser pages (edge://newtab, chrome://...,
    // extension pages) are always the user's own choice - e.g. New Tab shortcuts.
    if (!/^https?:/i.test(srcUrl)) return;
    const settings = await PG.getSettings();
    if (!settings.blockPopups) return;
    const { whitelist = [] } = await chrome.storage.local.get('whitelist');
    if (PG.isWhitelisted(PG.hostOf(srcUrl), whitelist)) return;
    if (PG.sameOwner(targetUrl, srcUrl)) return; // same site, or the same company (Classroom -> YouTube)
    if (PG.isSignIn(targetUrl)) return; // "Sign in with ..." windows
    if (userOpened(srcTabId, targetUrl)) return;
    chrome.tabs.remove(newTabId).catch(() => {});
    chrome.tabs.update(srcTabId, { active: true }).catch(() => {});
    PGStats.record('tab', { tabId: srcTabId, site: PG.hostOf(srcUrl), target: targetUrl });
    offerReopen(srcTabId, targetUrl);
  }

  /**
   * Did the user's last click (in any frame of the tab) ask for this tab? Yes when:
   *  - they clicked a link to exactly that address;
   *  - they clicked a link to that site, and either it's a known company's site or the click was
   *    inside an embedded frame of that same site (a player opening its own page - players add
   *    things like "&t=42s", so the address can differ);
   *  - they clicked anywhere inside a known company's embedded player (the YouTube button in a
   *    YouTube player on Google Classroom) and the tab is that company's site.
   * A plain click on the page itself still has to match exactly: pop-under scripts like to open
   * an ad on the same host as the link you clicked.
   */
  function userOpened(tabId, targetUrl) {
    const lc = lastClick.get(tabId);
    if (!lc || Date.now() - lc.t > 3000) return false;
    if (lc.href && strip(lc.href) === strip(targetUrl)) return true;
    const inFrameOf = lc.frameUrl && PG.sameOwner(lc.frameUrl, targetUrl);
    if (lc.href && PG.sameOwner(lc.href, targetUrl) && (PG.isKnownOwner(targetUrl) || inFrameOf)) return true;
    return !!inFrameOf && PG.isKnownOwner(lc.frameUrl);
  }

  // After closing a tab, the page shows "Closed a new tab to X - Open anyway". Only a URL that
  // was just closed in that tab can be reopened, so a page can't use this to open its own tabs.
  const closedRecently = new Map(); // tabId -> { url, until }
  function offerReopen(tabId, url) {
    closedRecently.set(tabId, { url, until: Date.now() + 15000 });
    chrome.tabs.sendMessage(tabId, { type: 'tabClosed', url }, { frameId: 0 }).catch(() => {});
  }
  async function reopen(tabId, url) {
    const c = closedRecently.get(tabId);
    if (!c || c.url !== url || Date.now() > c.until) return false;
    closedRecently.delete(tabId);
    const src = await chrome.tabs.get(tabId).catch(() => null);
    await chrome.tabs.create({ url, openerTabId: tabId, index: src ? src.index + 1 : undefined });
    return true;
  }

  // Safety net for timed redirects the page script couldn't cancel (e.g. started by an ad
  // iframe): if the tab was sitting idle on a page for a while and a script - not the user -
  // moved it to another site, go back.
  const IDLE_MS = 10000;
  const lastPage = new Map(); // tabId -> { url, t }
  async function undoTimedRedirect(d) {
    if (d.frameId !== 0) return;
    const prev = lastPage.get(d.tabId);
    lastPage.set(d.tabId, { url: d.url, t: d.timeStamp });
    const q = d.transitionQualifiers || [];
    // Script redirects arrive as 'client_redirect', but a redirect started by an ad iframe looks
    // exactly like a link click ('link'). What gives both away is that nobody touched the tab.
    const scripted = q.includes('client_redirect') || d.transitionType === 'link';
    if (!prev || !scripted || q.includes('forward_back')) return;
    if (!/^https?:/i.test(prev.url) || !/^https?:/i.test(d.url)) return;
    if (/\.pdf([?#]|$)/i.test(prev.url)) return;                    // PDF viewer: clicks aren't visible to us
    if (PG.sameOwner(prev.url, d.url) || PG.isSignIn(d.url)) return;
    if (d.timeStamp - prev.t < IDLE_MS) return;                     // redirect during page load
    const lc = lastClick.get(d.tabId);
    if (lc && Date.now() - lc.t < IDLE_MS) return;                  // user was just active
    const settings = await PG.getSettings();
    if (!settings.blockRedirects) return;
    const { whitelist = [] } = await chrome.storage.local.get('whitelist');
    if (PG.isWhitelisted(PG.hostOf(prev.url), whitelist)) return;
    lastPage.set(d.tabId, prev);
    chrome.tabs.goBack(d.tabId).catch(() => chrome.tabs.update(d.tabId, { url: prev.url }));
    PGStats.record('redirect', { tabId: d.tabId, site: PG.hostOf(prev.url), target: d.url });
  }

  function listen() {
    chrome.webNavigation.onCreatedNavigationTarget.addListener(async (d) => {
      const src = await chrome.tabs.get(d.sourceTabId).catch(() => null);
      if (!src?.url) return;
      if (!d.url || d.url === 'about:blank') {
        watchBlank.set(d.tabId, { srcTabId: d.sourceTabId, srcUrl: src.url, until: Date.now() + 4000 });
        return;
      }
      judgeNewTab(d.tabId, d.sourceTabId, src.url, d.url);
    });
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      const w = watchBlank.get(tabId);
      if (!w || !info.url || info.url === 'about:blank') return;
      watchBlank.delete(tabId);
      if (Date.now() < w.until) judgeNewTab(tabId, w.srcTabId, w.srcUrl, info.url);
    });
    chrome.webNavigation.onCommitted.addListener((d) => {
      if (d.frameId === 0 && !/reload|auto_subframe/.test(d.transitionType)) PGStats.resetTab(d.tabId);
    });
    chrome.webNavigation.onCommitted.addListener(undoTimedRedirect);
    chrome.tabs.onRemoved.addListener((id) => { lastClick.delete(id); watchBlank.delete(id); lastPage.delete(id); closedRecently.delete(id); PGStats.forgetTab(id); });
  }

  return {
    registerMain, listen, judgeNewTab, reopen,
    noteClick: (tabId, href, frameUrl) => lastClick.set(tabId, { href, frameUrl, t: Date.now() }),
  };
})();
