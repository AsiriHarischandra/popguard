(async () => {
  const $ = (id) => document.getElementById(id);
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;

  // ?tab=<id> lets the tests open the popup for a given tab
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  const host = /^https?:/.test(tab?.url || '') ? PG.hostOf(tab.url) : '';
  $('site').textContent = host || 'not a web page';

  const polled = await chrome.runtime.sendMessage({ type: 'pollNetStats' }).catch(() => null);
  if (polled?.n) await new Promise((r) => setTimeout(r, 1100)); // new blocks are saved in 1-second batches
  const { stats, whitelist = [], pausedSites = {} } = await chrome.storage.local.get(['stats', 'whitelist', 'pausedSites']);
  const todayCounts = stats?.byDay?.[PG.today()] || {};
  $('today').textContent = Object.values(todayCounts).reduce((a, b) => a + b, 0).toLocaleString();
  $('total').textContent = (stats?.total || 0).toLocaleString();
  chrome.runtime.sendMessage({ type: 'tabCount', tabId: tab.id }, (r) => {
    $('tab').textContent = r?.count ?? 0;
    showRecent(r?.recent || []);
  });

  // ---- what was blocked here (helps tell which block broke a page) ----
  function showRecent(items) {
    $('recent').hidden = !items.length;
    $('recentList').replaceChildren(...items.map(({ kind, target }) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = PG.KINDS[kind]?.label || kind;
      li.append(b);
      if (target) { const s = document.createElement('span'); s.textContent = target; s.title = target; li.append(s); }
      return li;
    }));
  }

  // ---- protection on/off for this site ----
  const matches = (d) => host === d || host.endsWith('.' + d);
  const alwaysOff = PG.isWhitelisted(host, whitelist);
  const pauseHost = PG.activePauses(pausedSites).find(matches);
  const pausedUntil = pauseHost ? pausedSites[pauseHost] : 0;
  const builtIn = PG.BUILTIN_TRUSTED.some(matches);
  const reloadAndClose = () => { setTimeout(() => chrome.tabs.reload(tab.id), 150); window.close(); }; // let rules update first

  const toggle = $('toggle');
  toggle.checked = !alwaysOff && !pausedUntil;
  toggle.disabled = !host || builtIn;
  $('offNote').hidden = toggle.checked || !host;
  $('brokeRow').hidden = !toggle.checked || !host;
  if (pausedUntil && !alwaysOff) {
    const time = new Date(pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('offText').textContent = `Paused here until ${time}.`;
    $('resume').hidden = false;
  }

  toggle.addEventListener('change', async () => {
    const { whitelist = [] } = await chrome.storage.local.get('whitelist');
    if (toggle.checked) {
      await chrome.storage.local.set({ whitelist: whitelist.filter((d) => !matches(d)) });
      if (pausedUntil) await chrome.runtime.sendMessage({ type: 'pauseSite', host, resume: true });
    } else {
      await chrome.storage.local.set({ whitelist: [...new Set([...whitelist, host])] });
    }
    reloadAndClose();
  });
  $('pause').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'pauseSite', host });
    reloadAndClose();
  });
  $('resume').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'pauseSite', host, resume: true });
    reloadAndClose();
  });

  $('dash').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });

  $('reset').disabled = !host;
  $('reset').addEventListener('click', async () => {
    const { cosmeticFilters = [] } = await chrome.storage.local.get('cosmeticFilters');
    await chrome.storage.local.set({ cosmeticFilters: cosmeticFilters.filter((f) => !f.startsWith(host + '##')) });
    chrome.tabs.reload(tab.id);
    window.close();
  });
})();
