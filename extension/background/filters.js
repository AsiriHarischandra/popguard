/*
 * Network filtering.
 *  - Static rulesets (rules/ads.json, trackers.json, betting.json) switched on/off from Settings.
 *  - Dynamic rules rebuilt from storage:
 *      id 1          allowAllRequests for whitelisted sites (beats every block rule)
 *      id 2          the user's custom blocked domains
 *      id 10..       one rule per imported filter list
 */
const PGFilters = (() => {
  const SUB = ['sub_frame', 'script', 'xmlhttprequest', 'image', 'ping', 'media', 'websocket', 'font', 'stylesheet', 'other'];
  const MAX_IMPORTED_DOMAINS = 50000;
  const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

  const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
  const isHost = (d) => DOMAIN_RE.test(d) || IP_RE.test(d);
  const cleanDomain = (d) => d.trim().toLowerCase().replace(/^\*?\.?/, '').replace(/^www\./, '').replace(/\/.*$/, '');

  async function applyRulesets() {
    const { lists } = await PG.getSettings();
    const ids = Object.keys(lists);
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: ids.filter((id) => lists[id]),
      disableRulesetIds: ids.filter((id) => !lists[id]),
    });
  }

  async function rebuildDynamic() {
    const { whitelist = [], customDomains = [], importedLists = [] } =
      await chrome.storage.local.get(['whitelist', 'customDomains', 'importedLists']);
    const rules = [];
    const trusted = [...whitelist, ...PG.BUILTIN_TRUSTED];
    if (trusted.length) {
      rules.push({ id: 1, priority: 100, action: { type: 'allowAllRequests' },
        condition: { requestDomains: trusted, resourceTypes: ['main_frame', 'sub_frame'] } });
    }
    const custom = [...new Set(customDomains.map(cleanDomain).filter(isHost))];
    if (custom.length) {
      rules.push({ id: 2, priority: 2, action: { type: 'block' },
        condition: { requestDomains: custom, resourceTypes: ['main_frame', ...SUB] } });
    }
    importedLists.forEach((list, i) => {
      if (list.enabled !== false && list.domains?.length) {
        rules.push({ id: 10 + i, priority: 1, action: { type: 'block' },
          condition: { requestDomains: list.domains, resourceTypes: SUB } });
      }
    });
    const old = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules: rules });
  }

  /**
   * Understands the network-blocking subset of common list formats:
   *   ||example.com^            (Adblock Plus / uBlock / EasyList)
   *   ||example.com^$third-party
   *   0.0.0.0 example.com       (hosts files)
   *   example.com               (plain domain lists)
   * Everything else (cosmetic rules, paths, exceptions) is skipped and counted.
   */
  function parseList(text) {
    const domains = new Set();
    let skipped = 0;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || /^[!#\[]/.test(line)) continue;
      let m = line.match(/^\|\|([a-z0-9.-]+)\^(\$(third-party|3p|all|important)(,(third-party|3p|all|important))*)?$/i)
        || line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9.-]+)\s*(#.*)?$/i)
        || line.match(/^([a-z0-9.-]+)$/i);
      const d = m && cleanDomain(m[1]);
      if (d && DOMAIN_RE.test(d) && d !== 'localhost') domains.add(d);
      else skipped++;
    }
    return { domains: [...domains].slice(0, MAX_IMPORTED_DOMAINS), skipped };
  }

  async function importList(url, existingIndex = -1) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    const { domains, skipped } = parseList(await res.text());
    if (!domains.length) throw new Error('No blockable domains found in that list');
    const { importedLists = [] } = await chrome.storage.local.get('importedLists');
    const entry = { url, name: new URL(url).hostname + new URL(url).pathname.replace(/\/$/, ''), count: domains.length,
      skipped, updated: Date.now(), enabled: true, domains };
    if (existingIndex >= 0) importedLists[existingIndex] = entry;
    else {
      if (importedLists.some((l) => l.url === url)) throw new Error('That list is already imported');
      importedLists.push(entry);
    }
    await chrome.storage.local.set({ importedLists });
    await rebuildDynamic();
    return { count: domains.length, skipped };
  }

  return { applyRulesets, rebuildDynamic, parseList, importList, cleanDomain };
})();
