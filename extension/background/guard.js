/*
 * Pop-up / redirect guard (background half).
 *  - Registers content/inject.js in the page's MAIN world, skipping whitelisted
 *    sites and prepending flag files for features switched off in Settings.
 *  - Closes new tabs that a page opened without the user clicking a matching link.
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
    js.push('content/inject.js');
    await chrome.scripting.registerContentScripts([{
      id: MAIN_ID, js, matches: ['<all_urls>'],
      excludeMatches: whitelist.map((d) => `*://*.${d}/*`),
      runAt: 'document_start', allFrames: true, world: 'MAIN', persistAcrossSessions: true,
    }]);
  }

  async function judgeNewTab(newTabId, srcTabId, srcUrl, targetUrl) {
    const settings = await PG.getSettings();
    if (!settings.blockPopups) return;
    const { whitelist = [] } = await chrome.storage.local.get('whitelist');
    if (PG.isWhitelisted(PG.hostOf(srcUrl), whitelist)) return;
    if (PG.siteOf(targetUrl) === PG.siteOf(srcUrl)) return;
    const lc = lastClick.get(srcTabId);
    if (lc && Date.now() - lc.t < 3000 && lc.href && strip(lc.href) === strip(targetUrl)) return;
    chrome.tabs.remove(newTabId).catch(() => {});
    chrome.tabs.update(srcTabId, { active: true }).catch(() => {});
    PGStats.record('tab', { tabId: srcTabId, site: PG.hostOf(srcUrl), target: targetUrl });
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
    chrome.tabs.onRemoved.addListener((id) => { lastClick.delete(id); watchBlank.delete(id); PGStats.forgetTab(id); });
  }

  return { registerMain, listen, noteClick: (tabId, href) => lastClick.set(tabId, { href, t: Date.now() }) };
})();
