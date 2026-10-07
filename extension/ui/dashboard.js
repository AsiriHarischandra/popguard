/* PopGuard dashboard: Overview (stats), Filters, Whitelist, Settings. */
(() => {
  const $ = (id) => document.getElementById(id);
  const store = chrome.storage.local;
  const SERIES = PG.CATEGORIES.map((c, i) => ({ ...c, color: `var(--series-${i + 1})` }));
  const colorOf = (cat) => SERIES.find((s) => s.id === cat).color;

  const setStatus = (id, text, kind = '') => { const n = $(id); n.textContent = text; n.className = 'status ' + kind; };
  const make = (tag, props = {}, ...children) => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    n.append(...children);
    return n;
  };

  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;

  // ---------------- tabs ----------------
  function showTab() {
    let name = location.hash.slice(1) || 'overview';
    if (name === 'welcome') { $('welcome').hidden = false; name = 'overview'; }
    if (!document.querySelector(`[data-panel="${name}"]`)) name = 'overview';
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    document.querySelectorAll('nav a').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.tab === name)));
  }
  window.addEventListener('hashchange', showTab);
  $('welcomeClose').onclick = () => { $('welcome').hidden = true; history.replaceState(null, '', '#overview'); };
  showTab();

  // ================= OVERVIEW =================
  let range = 14;
  try { range = Number(localStorage.getItem('pg-range')) || 14; } catch {}

  function lastNDays(n) {
    const out = [];
    const d = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      out.push(x.toLocaleDateString('en-CA'));
    }
    return out;
  }

  function renderBars(container, obj, emptyText) {
    container.textContent = '';
    const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!rows.length) { container.append(make('p', { className: 'empty', textContent: emptyText })); return; }
    const max = rows[0][1];
    for (const [name, v] of rows) {
      const fill = make('div', { className: 'fill' });
      fill.style.width = Math.max(2, (v / max) * 100) + '%';
      container.append(make('div', { className: 'bar-row' },
        make('span', { className: 'name', textContent: name, title: name }),
        make('span', { className: 'val', textContent: v.toLocaleString() }),
        make('div', { className: 'track' }, fill)));
    }
  }

  async function renderOverview() {
    const { stats } = await store.get('stats');
    const s = stats || { total: 0, byKind: {}, byDay: {}, bySite: {}, byTarget: {} };
    document.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.range) === range)));

    const dates = lastNDays(range);
    const days = dates.map((date) => {
      const raw = s.byDay[date] || {};
      const values = {};
      for (const [kind, n] of Object.entries(raw)) {
        const cat = PG.KINDS[kind]?.category;
        if (cat) values[cat] = (values[cat] || 0) + n;
      }
      return { date, values, raw };
    });
    const sumCat = (cat) => days.reduce((a, d) => a + (d.values[cat] || 0), 0);
    const inRange = days.reduce((a, d) => a + Object.values(d.values).reduce((x, y) => x + y, 0), 0);
    const todayTotal = Object.values(days[days.length - 1].values).reduce((a, b) => a + b, 0);
    const yesterday = days.length > 1 ? Object.values(days[days.length - 2].values).reduce((a, b) => a + b, 0) : 0;

    $('tRange').textContent = inRange.toLocaleString();
    $('tAll').textContent = `${(s.total || 0).toLocaleString()} all time`;
    $('tToday').textContent = todayTotal.toLocaleString();
    $('tTodayVs').textContent = `${yesterday.toLocaleString()} yesterday`;
    $('tPopups').textContent = sumCat('popups').toLocaleString();
    $('tTrackers').textContent = sumCat('trackers').toLocaleString();

    // legend (always present for >= 2 series), same order as the stack
    $('legend').textContent = '';
    for (const sr of SERIES) {
      const key = make('i'); key.style.background = sr.color;
      $('legend').append(make('span', {}, key, sr.label));
    }
    PGChart.renderStackedBars($('chart'), $('tooltip'), { days, series: SERIES });

    // table view of the same data
    const table = make('table');
    const head = make('tr', {}, make('th', { textContent: 'Date' }), ...SERIES.map((sr) => make('th', { className: 'n', textContent: sr.label })), make('th', { className: 'n', textContent: 'Total' }));
    table.append(make('thead', {}, head));
    const tbody = make('tbody');
    for (const d of [...days].reverse()) {
      const tot = SERIES.reduce((a, sr) => a + (d.values[sr.id] || 0), 0);
      tbody.append(make('tr', {}, make('td', { textContent: d.date }),
        ...SERIES.map((sr) => make('td', { className: 'n', textContent: (d.values[sr.id] || 0).toLocaleString() })),
        make('td', { className: 'n', textContent: tot.toLocaleString() })));
    }
    table.append(tbody);
    $('chartTable').textContent = '';
    $('chartTable').append(table);

    renderBars($('topSites'), s.bySite, 'No sites yet.');
    renderBars($('topTargets'), s.byTarget, 'No blocked domains yet.');

    // by type
    $('byTypeRange').textContent = `last ${range} days`;
    const kindTotals = {};
    for (const d of days) for (const [k, n] of Object.entries(d.raw)) kindTotals[k] = (kindTotals[k] || 0) + n;
    const kt = $('kinds');
    kt.textContent = '';
    kt.append(make('thead', {}, make('tr', {}, make('th', { textContent: 'What was stopped' }), make('th', { textContent: 'Group' }), make('th', { className: 'n', textContent: 'Count' }))));
    const kb = make('tbody');
    const order = Object.keys(PG.KINDS).sort((a, b) => (kindTotals[b] || 0) - (kindTotals[a] || 0));
    for (const k of order) {
      const info = PG.KINDS[k];
      const sw = make('i'); sw.style.background = colorOf(info.category);
      const td = make('td', {}, sw, info.label);
      kb.append(make('tr', {}, td,
        make('td', { className: 'secondary', textContent: SERIES.find((x) => x.id === info.category).label }),
        make('td', { className: 'n', textContent: (kindTotals[k] || 0).toLocaleString() })));
    }
    kt.append(kb);
  }

  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    range = Number(b.dataset.range);
    try { localStorage.setItem('pg-range', String(range)); } catch {}
    renderOverview();
  }));
  $('tableToggle').addEventListener('click', () => {
    const show = $('chartTable').hidden;
    $('chartTable').hidden = !show;
    $('tableToggle').textContent = show ? 'Hide table' : 'Show table';
    $('tableToggle').setAttribute('aria-pressed', String(show));
  });

  // ================= FILTERS =================
  const BUILTINS = [
    { id: 'ads', name: 'Ad networks', desc: 'Pop-under networks, Google ads, Taboola, Outbrain and other ad servers' },
    { id: 'trackers', name: 'Trackers', desc: 'Google Analytics, Facebook Pixel, Hotjar, Clarity, Mixpanel and more' },
    { id: 'betting', name: 'Betting & casino ads', desc: '1xBet, Melbet, Mostbet and affiliate redirect domains' },
  ];

  async function renderFilters() {
    const settings = await PG.getSettings();
    let counts = {};
    try { counts = await (await fetch(chrome.runtime.getURL('rules/counts.json'))).json(); } catch {}
    const box = $('builtins');
    box.textContent = '';
    for (const b of BUILTINS) {
      const input = make('input', { type: 'checkbox', checked: settings.lists[b.id], id: 'list-' + b.id });
      input.addEventListener('change', async () => {
        const s = await PG.getSettings();
        s.lists[b.id] = input.checked;
        await store.set({ settings: s });
      });
      box.append(make('div', { className: 'list-row' },
        make('div', { className: 'info' }, make('b', { textContent: b.name }), make('span', { textContent: `${b.desc} · ${counts[b.id] ?? '?'} rules` })),
        make('label', { className: 'switch', title: 'Enable ' + b.name }, input, make('span'))));
    }

    const { importedLists = [], customDomains = [], cosmeticFilters = [] } = await store.get(['importedLists', 'customDomains', 'cosmeticFilters']);
    const imp = $('imported');
    imp.textContent = '';
    importedLists.forEach((l, i) => {
      const refresh = make('button', { className: 'btn small', textContent: 'Update' });
      refresh.onclick = async () => {
        refresh.disabled = true;
        setStatus('importStatus', 'Updating…');
        const r = await chrome.runtime.sendMessage({ type: 'importList', url: l.url, index: i });
        setStatus('importStatus', r.ok ? `Updated: ${r.count.toLocaleString()} domains.` : r.error, r.ok ? 'ok' : 'err');
        renderFilters();
      };
      const remove = make('button', { className: 'btn small danger', textContent: 'Remove' });
      remove.onclick = async () => {
        const { importedLists = [] } = await store.get('importedLists');
        importedLists.splice(i, 1);
        await store.set({ importedLists });
        renderFilters();
      };
      const toggle = make('input', { type: 'checkbox', checked: l.enabled !== false });
      toggle.onchange = async () => {
        const { importedLists = [] } = await store.get('importedLists');
        importedLists[i].enabled = toggle.checked;
        await store.set({ importedLists });
      };
      imp.append(make('div', { className: 'list-row' },
        make('div', { className: 'info' }, make('b', { textContent: l.name }),
          make('span', { textContent: `${l.count.toLocaleString()} domains · updated ${new Date(l.updated).toLocaleDateString()}` })),
        refresh, remove, make('label', { className: 'switch', title: 'Enable list' }, toggle, make('span'))));
    });

    $('customDomains').value = customDomains.join('\n');
    $('cosmetic').value = cosmeticFilters.join('\n');
  }

  $('importForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('importUrl').value.trim();
    $('importBtn').disabled = true;
    setStatus('importStatus', 'Downloading and reading the list…');
    const r = await chrome.runtime.sendMessage({ type: 'importList', url });
    $('importBtn').disabled = false;
    if (r.ok) {
      setStatus('importStatus', `Imported ${r.count.toLocaleString()} domains (${r.skipped.toLocaleString()} other rules skipped).`, 'ok');
      $('importUrl').value = '';
      renderFilters();
    } else setStatus('importStatus', r.error, 'err');
  });
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    $('importUrl').value = b.dataset.preset;
    $('importUrl').focus();
  }));

  $('saveDomains').addEventListener('click', async () => {
    const lines = $('customDomains').value.split('\n').map((l) => l.trim()).filter(Boolean);
    const clean = [], bad = [];
    for (const l of lines) {
      const d = l.toLowerCase().replace(/^https?:\/\//, '').replace(/^\*?\.?/, '').replace(/^www\./, '').replace(/[/:].*$/, '');
      (/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d) || /^\d+\.\d+\.\d+\.\d+$/.test(d) ? clean : bad).push(d || l);
    }
    await store.set({ customDomains: [...new Set(clean)] });
    $('customDomains').value = [...new Set(clean)].join('\n');
    setStatus('domainsStatus', bad.length ? `Saved ${clean.length}. Skipped invalid: ${bad.join(', ')}` : `Saved ${clean.length} domain${clean.length === 1 ? '' : 's'}.`, bad.length ? 'err' : 'ok');
  });

  $('saveCosmetic').addEventListener('click', async () => {
    const lines = $('cosmetic').value.split('\n').map((l) => l.trim()).filter(Boolean);
    const good = [], bad = [];
    for (const l of lines) {
      const sel = l.slice(l.indexOf('##') + 2);
      let ok = l.includes('##') && sel.length > 0;
      if (ok) { try { document.createDocumentFragment().querySelector(sel); } catch { ok = false; } }
      (ok ? good : bad).push(l);
    }
    await store.set({ cosmeticFilters: [...new Set(good)] });
    setStatus('cosmeticStatus', bad.length ? `Saved ${good.length}. Not valid: ${bad.join(' | ')}` : `Saved ${good.length} filter${good.length === 1 ? '' : 's'}.`, bad.length ? 'err' : 'ok');
  });

  // ================= WHITELIST =================
  async function renderWhitelist() {
    const { whitelist = [] } = await store.get('whitelist');
    const ul = $('wlList');
    ul.textContent = '';
    if (!whitelist.length) ul.append(make('li', { className: 'muted', textContent: 'No trusted sites yet. PopGuard protects every site.' }));
    for (const d of [...whitelist].sort()) {
      const rm = make('button', { className: 'btn small danger', textContent: 'Remove' });
      rm.onclick = async () => {
        const { whitelist = [] } = await store.get('whitelist');
        await store.set({ whitelist: whitelist.filter((x) => x !== d) });
        renderWhitelist();
      };
      ul.append(make('li', {}, make('span', { textContent: d }), rm));
    }
  }
  $('wlForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = $('wlInput').value.trim().toLowerCase();
    const d = PG.hostOf(raw.includes('://') ? raw : 'https://' + raw);
    if (!d || !d.includes('.')) { setStatus('wlStatus', 'That doesn’t look like a website address.', 'err'); return; }
    const { whitelist = [] } = await store.get('whitelist');
    await store.set({ whitelist: [...new Set([...whitelist, d])] });
    $('wlInput').value = '';
    setStatus('wlStatus', `${d} added. Reload its tabs for the change to apply.`, 'ok');
    renderWhitelist();
  });

  // ================= SETTINGS =================
  const FEATURES = [
    { key: 'blockPopups', name: 'Block pop-ups and ad tabs', desc: 'Stops windows and tabs a page opens when you didn’t click a matching link' },
    { key: 'blockRedirects', name: 'Block click-redirects', desc: 'Stops the page jumping to another site after a click' },
    { key: 'removeOverlays', name: 'Remove invisible overlays', desc: 'Removes see-through layers that catch your clicks' },
    { key: 'hideBanners', name: 'Hide banner ads', desc: 'Hides known ad boxes and banner-shaped links to other sites' },
    { key: 'showNotices', name: 'Show “blocked” notices', desc: 'Shows a small corner message with an “Open anyway” button' },
  ];
  async function renderSettings() {
    const settings = await PG.getSettings();
    const box = $('featureToggles');
    box.textContent = '';
    for (const f of FEATURES) {
      const input = make('input', { type: 'checkbox', checked: settings[f.key], id: 'feat-' + f.key });
      input.addEventListener('change', async () => {
        const s = await PG.getSettings();
        s[f.key] = input.checked;
        await store.set({ settings: s });
        setStatus('dataStatus', 'Saved. Reload open tabs for the change to apply.', 'ok');
      });
      box.append(make('div', { className: 'list-row' },
        make('div', { className: 'info' }, make('b', { textContent: f.name }), make('span', { textContent: f.desc })),
        make('label', { className: 'switch', title: f.name }, input, make('span'))));
    }
  }

  const EXPORT_KEYS = ['settings', 'whitelist', 'customDomains', 'cosmeticFilters', 'importedLists'];
  $('exportBtn').addEventListener('click', async () => {
    const data = await store.get(EXPORT_KEYS);
    if (data.importedLists) data.importedLists = data.importedLists.map(({ domains, ...rest }) => rest); // URLs only
    const blob = new Blob([JSON.stringify({ app: 'PopGuard', version: 2, ...data }, null, 2)], { type: 'application/json' });
    const a = make('a', { href: URL.createObjectURL(blob), download: `popguard-settings-${PG.today()}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'PopGuard') throw new Error('Not a PopGuard settings file');
      const { importedLists = [], ...rest } = data;
      const save = {};
      for (const k of EXPORT_KEYS) if (k in rest) save[k] = rest[k];
      await store.set(save);
      for (const l of importedLists) await chrome.runtime.sendMessage({ type: 'importList', url: l.url });
      setStatus('dataStatus', 'Settings imported.', 'ok');
      renderAll();
    } catch (err) {
      setStatus('dataStatus', 'Could not import: ' + err.message, 'err');
    }
    e.target.value = '';
  });
  $('resetStats').addEventListener('click', async () => {
    if ($('resetStats').dataset.confirm !== '1') {
      $('resetStats').dataset.confirm = '1';
      $('resetStats').textContent = 'Click again to confirm';
      setTimeout(() => { $('resetStats').dataset.confirm = ''; $('resetStats').textContent = 'Reset statistics'; }, 4000);
      return;
    }
    await chrome.runtime.sendMessage({ type: 'resetStats' });
    $('resetStats').dataset.confirm = '';
    $('resetStats').textContent = 'Reset statistics';
    setStatus('dataStatus', 'Statistics cleared.', 'ok');
    renderOverview();
  });

  // ---------------- boot + live refresh ----------------
  function renderAll() { renderOverview(); renderFilters(); renderWhitelist(); renderSettings(); }
  renderAll();
  let t = null;
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if (c.stats) { clearTimeout(t); t = setTimeout(renderOverview, 400); }
    if (c.whitelist) renderWhitelist();
  });
})();
