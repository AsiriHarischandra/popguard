/* PopGuard service worker: wires the modules together. */
importScripts('../shared/families.js', '../shared/defaults.js', 'stats.js', 'filters.js', 'guard.js', 'netstats.js', 'pause.js');

async function syncEverything() {
  await PGFilters.applyRulesets();
  await PGFilters.rebuildDynamic();
  await PGGuard.registerMain();
  await PGPause.schedule();
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.create({ id: 'popguard-hide', title: 'PopGuard: Hide this ad', contexts: ['all'] });
  await syncEverything();
  if (reason === 'install') chrome.tabs.create({ url: 'ui/dashboard.html#welcome' });
});
chrome.runtime.onStartup.addListener(syncEverything);

chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local') return;
  if (c.settings) { PGFilters.applyRulesets(); PGGuard.registerMain(); }
  if (c.whitelist || c.pausedSites) PGGuard.registerMain();
  if (c.whitelist || c.pausedSites || c.customDomains || c.importedLists) PGFilters.rebuildDynamic();
  if (c.pausedSites) PGPause.schedule();
});

PGGuard.listen();
PGPause.listen();

// ---- Network blocks -> statistics (see netstats.js for the two modes) ----
PGNetStats.start();

// ---- Messages from content scripts, popup and dashboard ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  const site = PG.hostOf(sender.tab?.url || sender.url || '');
  switch (msg.type) {
    case 'click':
      if (tabId != null) PGGuard.noteClick(tabId, msg.href, sender.frameId ? sender.url : null);
      break;
    case 'reopenTab': // "Open anyway" on the closed-tab notice
      if (tabId != null) PGGuard.reopen(tabId, msg.url).then((ok) => sendResponse({ ok }));
      return true;
    case 'blocked': // from inject.js (via content.js) or content.js itself
      PGStats.record(msg.kind, { tabId, site, target: msg.url });
      break;
    case 'isAdHost': // "Hide this ad": is the clicked link / frame an ad network?
      PGFilters.isAdHost(msg.host).then((ad) => sendResponse({ ad }));
      return true;
    case 'hidden':
      PGStats.record('banner', { tabId, site, target: msg.url });
      break;
    case 'tabCount':
      sendResponse({ count: PGStats.tabCount(msg.tabId), recent: PGStats.tabRecent(msg.tabId) });
      break;
    case 'pauseSite': // popup: "Pause for 1 hour" / "Resume now"
      (msg.resume ? PGPause.resume(msg.host) : PGPause.pause(msg.host)).then(() => sendResponse({ ok: true }));
      return true;
    case 'pollNetStats': // popup / dashboard opened: pull in the latest network blocks first
      (PGNetStats.mode === 'poll' ? PGNetStats.poll() : Promise.resolve(0)).then((n) => sendResponse({ n }));
      return true;
    case 'resetStats':
      PGStats.reset().then(() => sendResponse({ ok: true }));
      return true;
    case 'importList':
      PGFilters.importList(msg.url, msg.index ?? -1)
        .then((r) => sendResponse({ ok: true, ...r }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'parseListPreview':
      sendResponse(PGFilters.parseList(msg.text || ''));
      break;
  }
});

// ---- Right-click "Hide this ad" ----
// (a named function so the tests can run exactly what the menu click runs)
function onHideMenu(info, tab) {
  if (info.menuItemId !== 'popguard-hide' || !tab?.id) return Promise.resolve(null);
  const send = (msg, frameId) => chrome.tabs.sendMessage(tab.id, msg, { frameId }).catch(() => null);
  if (info.frameId) {
    return Promise.all([send({ type: 'hideFrame', url: info.frameUrl }, 0), send({ type: 'pickHide' }, info.frameId)]);
  }
  return send({ type: 'pickHide' }, 0);
}
chrome.contextMenus.onClicked.addListener((info, tab) => { onHideMenu(info, tab); });
