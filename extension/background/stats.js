/*
 * Statistics engine.
 * Every block is recorded as { kind, site, target } and folded into:
 *   stats.total, stats.byKind, stats.byDay[YYYY-MM-DD][kind], stats.bySite, stats.byTarget
 * Writes are batched (one storage write per second at most) because a busy
 * page can produce dozens of tracker blocks in a burst.
 */
const PGStats = (() => {
  const MAX_DAYS = 90;
  const MAX_KEYS = 300;
  const tabCounts = new Map();
  let pending = [];
  let timer = null;
  let chain = Promise.resolve();

  const empty = () => ({ total: 0, since: Date.now(), byKind: {}, byDay: {}, bySite: {}, byTarget: {} });

  function trimMap(obj, max) {
    const entries = Object.entries(obj);
    if (entries.length <= max) return obj;
    return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, max));
  }

  async function flush() {
    timer = null;
    const batch = pending;
    pending = [];
    if (!batch.length) return;
    const { stats = empty() } = await chrome.storage.local.get('stats');
    for (const e of batch) {
      stats.total++;
      stats.byKind[e.kind] = (stats.byKind[e.kind] || 0) + 1;
      const day = (stats.byDay[e.day] ||= {});
      day[e.kind] = (day[e.kind] || 0) + 1;
      if (e.site) stats.bySite[e.site] = (stats.bySite[e.site] || 0) + 1;
      if (e.target) stats.byTarget[e.target] = (stats.byTarget[e.target] || 0) + 1;
    }
    const days = Object.keys(stats.byDay).sort();
    for (const d of days.slice(0, Math.max(0, days.length - MAX_DAYS))) delete stats.byDay[d];
    stats.bySite = trimMap(stats.bySite, MAX_KEYS);
    stats.byTarget = trimMap(stats.byTarget, MAX_KEYS);
    await chrome.storage.local.set({ stats });
  }

  function setBadge(tabId) {
    const n = tabCounts.get(tabId) || 0;
    chrome.action.setBadgeBackgroundColor({ color: '#2a78d6' }).catch(() => {});
    chrome.action.setBadgeText({ tabId, text: n ? (n > 999 ? '999+' : String(n)) : '' }).catch(() => {});
  }

  return {
    /** kind: one of PG.KINDS; site: page where it happened; target: blocked host */
    record(kind, { tabId, site = '', target = '' } = {}) {
      if (!PG.KINDS[kind]) return;
      pending.push({ kind, site: PG.hostOf('https://' + site) || site, target: target ? PG.hostOf(target.includes('://') ? target : 'https://' + target) : '', day: PG.today() });
      if (tabId != null && tabId >= 0) {
        tabCounts.set(tabId, (tabCounts.get(tabId) || 0) + 1);
        setBadge(tabId);
      }
      if (!timer) timer = setTimeout(() => { chain = chain.then(flush).catch(() => {}); }, 1000);
    },
    tabCount: (tabId) => tabCounts.get(tabId) || 0,
    resetTab(tabId) { tabCounts.delete(tabId); setBadge(tabId); },
    forgetTab(tabId) { tabCounts.delete(tabId); },
    async reset() { pending = []; await chrome.storage.local.set({ stats: empty() }); },
  };
})();
