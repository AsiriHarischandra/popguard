(async () => {
  const $ = (id) => document.getElementById(id);
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = /^https?:/.test(tab?.url || '') ? PG.hostOf(tab.url) : '';
  $('site').textContent = host || 'not a web page';

  const { stats, whitelist = [] } = await chrome.storage.local.get(['stats', 'whitelist']);
  const todayCounts = stats?.byDay?.[PG.today()] || {};
  $('today').textContent = Object.values(todayCounts).reduce((a, b) => a + b, 0).toLocaleString();
  $('total').textContent = (stats?.total || 0).toLocaleString();
  chrome.runtime.sendMessage({ type: 'tabCount', tabId: tab.id }, (r) => { $('tab').textContent = r?.count ?? 0; });

  const toggle = $('toggle');
  const paused = PG.isWhitelisted(host, whitelist);
  toggle.checked = !paused;
  toggle.disabled = !host;
  $('offNote').hidden = !paused;
  toggle.addEventListener('change', async () => {
    const { whitelist = [] } = await chrome.storage.local.get('whitelist');
    const next = toggle.checked
      ? whitelist.filter((d) => !(host === d || host.endsWith('.' + d)))
      : [...new Set([...whitelist, host])];
    await chrome.storage.local.set({ whitelist: next });
    setTimeout(() => chrome.tabs.reload(tab.id), 150); // let rules update first
    window.close();
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
