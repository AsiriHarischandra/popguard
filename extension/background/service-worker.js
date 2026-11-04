/* PopGuard service worker: wires the modules together. */
importScripts('../shared/families.js', '../shared/defaults.js', 'stats.js', 'filters.js', 'guard.js', 'netstats.js', 'pause.js',
  '../shared/learn-core.js', 'learning.js');

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
    case 'unsafeRulesDropped': // cosmetic.js removed a saved hide rule that was hiding the page itself
      if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'notice', text: 'PopGuard removed a saved "Hide this ad" rule that was hiding part of this page.' }, { frameId: 0 }).catch(() => {});
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
async function onHideMenu(info, tab) {
  if (info.menuItemId !== 'popguard-hide' || !tab?.id) return null;
  const send = (msg, frameId) => chrome.tabs.sendMessage(tab.id, msg, { frameId }).catch(() => null);
  // Smart learning (Phase 1): study the ad first, while it's still visible. Analysis only - the
  // result is a draft in session storage and never changes what gets hidden.
  const learned = await PGLearning.analyze(tab.id, info.frameId || 0).catch(() => null);
  const hid = info.frameId
    ? await Promise.all([send({ type: 'hideFrame', url: info.frameUrl }, 0), send({ type: 'pickHide' }, info.frameId)])
    : await send({ type: 'pickHide' }, 0);
  // Nothing hidden because the right-click landed on the page itself (e.g. the video player)?
  const refused = info.frameId ? hid.every((r) => !r || r.refused) && hid.some((r) => r?.refused) : !!hid?.refused;
  const text = refused
    ? 'That looks like part of the page (like the video player), not an ad, so PopGuard left it alone. Right-click the ad itself, or use "Pause for 1 hour" if the page is not working.'
    : PGLearning.summary(learned);
  if (text) send({ type: 'notice', text }, 0);
  return { hid, learned, refused };
}
chrome.contextMenus.onClicked.addListener((info, tab) => { onHideMenu(info, tab); });
