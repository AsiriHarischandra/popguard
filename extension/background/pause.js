/*
 * "Pause on this site for 1 hour" from the popup.
 * Paused sites live in storage as pausedSites = { host: untilMs } and are treated exactly like
 * whitelisted sites while the pause lasts (see PG.getAllowList). An alarm removes each pause
 * when it runs out, which rebuilds the rules and turns protection back on.
 */
const PGPause = (() => {
  const ALARM = 'pause-expire';
  const HOUR = 60 * 60 * 1000;

  /** Drops finished pauses and sets the alarm for the next one to finish. */
  async function schedule() {
    const { pausedSites = {} } = await chrome.storage.local.get('pausedSites');
    const now = Date.now();
    const live = Object.fromEntries(Object.entries(pausedSites).filter(([, until]) => until > now));
    if (Object.keys(live).length !== Object.keys(pausedSites).length) {
      await chrome.storage.local.set({ pausedSites: live }); // storage.onChanged calls schedule() again
      return;
    }
    await chrome.alarms.clear(ALARM);
    const next = Math.min(...Object.values(live));
    if (Number.isFinite(next)) chrome.alarms.create(ALARM, { when: next + 1000 });
  }

  async function pause(host, ms = HOUR) {
    const { pausedSites = {} } = await chrome.storage.local.get('pausedSites');
    await chrome.storage.local.set({ pausedSites: { ...pausedSites, [host]: Date.now() + ms } });
  }

  async function resume(host) {
    const { pausedSites = {} } = await chrome.storage.local.get('pausedSites');
    const next = { ...pausedSites };
    for (const h of Object.keys(next)) if (host === h || host.endsWith('.' + h)) delete next[h];
    await chrome.storage.local.set({ pausedSites: next });
  }

  function listen() {
    chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) schedule(); });
  }

  return { schedule, pause, resume, listen, HOUR };
})();
