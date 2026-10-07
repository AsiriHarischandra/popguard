/* PopGuard service worker: wires the modules together. */
importScripts('../shared/defaults.js', 'stats.js', 'filters.js', 'guard.js', 'netstats.js');

async function syncEverything() {
  await PGFilters.applyRulesets();
  await PGFilters.rebuildDynamic();
  await PGGuard.registerMain();
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
  if (c.whitelist) PGGuard.registerMain();
  if (c.whitelist || c.customDomains || c.importedLists) PGFilters.rebuildDynamic();
});

PGGuard.listen();

// ---- Network blocks -> statistics (see netstats.js for the two modes) ----
PGNetStats.start();

// ---- Messages from content scripts, popup and dashboard ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  const site = PG.hostOf(sender.tab?.url || sender.url || '');
  switch (msg.type) {
    case 'click':
      if (tabId != null) PGGuard.noteClick(tabId, msg.href);
      break;
    case 'blocked': // from inject.js (via content.js) or content.js itself
      PGStats.record(msg.kind, { tabId, site, target: msg.url });
      break;
    case 'hidden':
      PGStats.record('banner', { tabId, site, target: msg.url });
      break;
    case 'tabCount':
      sendResponse({ count: PGStats.tabCount(msg.tabId) });
      break;
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
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'popguard-hide' || !tab?.id) return;
  if (info.frameId) {
    chrome.tabs.sendMessage(tab.id, { type: 'hideFrame', url: info.frameUrl }, { frameId: 0 }).catch(() => {});
    chrome.tabs.sendMessage(tab.id, { type: 'pickHide' }, { frameId: info.frameId }).catch(() => {});
  } else {
    chrome.tabs.sendMessage(tab.id, { type: 'pickHide' }, { frameId: 0 }).catch(() => {});
  }
});
