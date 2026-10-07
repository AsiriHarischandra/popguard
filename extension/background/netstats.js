/*
 * Network-block statistics, in two modes:
 *
 *  'debug'  Unpacked / developer-mode installs. declarativeNetRequest.onRuleMatchedDebug fires
 *           for every blocked request and includes its URL, so "most-blocked domains" works.
 *
 *  'poll'   Store installs, where onRuleMatchedDebug does not exist. Every minute an alarm calls
 *           declarativeNetRequest.getMatchedRules({ minTimeStamp }) and records what matched
 *           since the last poll. Chrome allows 20 calls per 10 minutes, so once a minute leaves
 *           room for the popup and dashboard to ask for a fresh poll when they open.
 *           Matches carry no URL, so these blocks count by type and site but not by domain.
 *           Chrome reports tabId -1 once a tab is closed, so blocks from a tab closed before the
 *           next poll still count by type, just without a site.
 */
const PGNetStats = (() => {
  const RULESET_KIND = { ads: 'ad', trackers: 'tracker', betting: 'betting', _dynamic: 'custom' };
  const ALLOW_RULES = new Set([1, 3]); // dynamic whitelist "allow" rules - not blocks
  const ALARM = 'popguard-netstats';
  let mode = chrome.declarativeNetRequest.onRuleMatchedDebug ? 'debug' : 'poll';
  let polling = null;

  // Which page each tab showed, and since when, so a block can be credited to the right site
  // even if the tab has navigated away or been closed before the next poll.
  const history = new Map(); // tabId -> [{ t, url }] (newest last, short)
  function remember(tabId, url, t = Date.now()) {
    if (tabId < 0 || !/^https?:/.test(url || '')) return;
    const h = history.get(tabId) || [];
    h.push({ t, url });
    history.set(tabId, h.slice(-10));
  }
  async function urlAt(tabId, t) {
    const h = history.get(tabId) || [];
    for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t) return h[i].url;
    return chrome.tabs.get(tabId).then((tab) => tab.url || '', () => '');
  }

  const isAllow = (rule) => rule.rulesetId === '_dynamic' && ALLOW_RULES.has(rule.ruleId);

  function onDebugMatch({ request, rule }) {
    if (mode !== 'debug' || isAllow(rule)) return;
    PGStats.record(RULESET_KIND[rule.rulesetId] || 'custom', {
      tabId: request.tabId,
      site: PG.hostOf(request.initiator || request.documentUrl || ''),
      target: request.url,
    });
  }

  async function poll() {
    if (polling) return polling;
    polling = (async () => {
      const { netStatsSince = Date.now() - 60_000 } = await chrome.storage.session.get('netStatsSince');
      let info;
      try {
        info = await chrome.declarativeNetRequest.getMatchedRules({ minTimeStamp: netStatsSince + 1 });
      } catch (e) {
        return 0; // quota exceeded or no permission - try again next minute
      }
      const matches = (info.rulesMatchedInfo || []).filter((m) => !isAllow(m.rule));
      if (!matches.length) return 0;
      for (const m of matches) {
        PGStats.record(RULESET_KIND[m.rule.rulesetId] || 'custom', {
          tabId: m.tabId,
          site: m.tabId >= 0 ? PG.hostOf(await urlAt(m.tabId, m.timeStamp)) : '',
        });
      }
      const newest = Math.max(...matches.map((m) => m.timeStamp));
      await chrome.storage.session.set({ netStatsSince: newest });
      return matches.length;
    })().finally(() => { polling = null; });
    return polling;
  }

  function start() {
    if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
      chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(onDebugMatch);
    }
    // navigation starts before its requests, so record the URL at onBeforeNavigate time
    chrome.webNavigation.onBeforeNavigate.addListener((d) => { if (d.frameId === 0) remember(d.tabId, d.url, d.timeStamp); });
    chrome.tabs.onRemoved.addListener((id) => setTimeout(() => history.delete(id), 10 * 60_000));
    chrome.alarms.create(ALARM, { periodInMinutes: 1 });
    chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM && mode === 'poll') poll(); });
  }

  return {
    start,
    poll,
    get mode() { return mode; },
    /** tests only: exercise the store-install code path inside an unpacked build */
    setMode(m) { mode = m; },
  };
})();
