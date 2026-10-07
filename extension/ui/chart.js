/*
 * Tiny dependency-free stacked bar chart (extension pages can't load CDN scripts).
 * renderStackedBars(container, tooltipEl, { days, series })
 *   days:   [{ date: 'YYYY-MM-DD', values: { [seriesId]: number } }]
 *   series: [{ id, label, color }]  - color is a CSS var(), so light/dark both work
 */
var PGChart = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };

  function niceMax(v) {
    if (v <= 4) return 4;
    const pow = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
    return 10 * pow;
  }

  // rectangle with only the top corners rounded (data-end), anchored to the baseline
  function topRounded(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  const fmtDate = (iso, opts) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, opts);

  function renderStackedBars(container, tooltip, { days, series }) {
    container.textContent = '';
    const totals = days.map((d) => series.reduce((s, sr) => s + (d.values[sr.id] || 0), 0));
    const maxTotal = Math.max(0, ...totals);
    if (!maxTotal) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Nothing blocked in this range yet. Browse as usual and check back.';
      container.appendChild(p);
      return;
    }

    const W = 820, H = 260, m = { t: 18, r: 8, b: 26, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const yMax = niceMax(maxTotal);
    const y = (v) => m.t + ih - (v / yMax) * ih;
    const step = iw / days.length;
    const bw = Math.max(4, Math.min(28, step * 0.62));
    const GAP = 2;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Stacked bar chart of blocks per day' }, container);

    // recessive grid + y labels
    const grid = el('g', { class: 'grid' }, svg);
    const axis = el('g', { class: 'axis' }, svg);
    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i, yy = y(v);
      if (i > 0) el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy }, grid);
      const t = el('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end' }, axis);
      t.textContent = v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : String(v);
    }
    el('line', { class: 'base', x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }, svg);

    const every = days.length > 20 ? 5 : days.length > 10 ? 2 : 1;
    const peak = totals.indexOf(maxTotal);

    days.forEach((d, i) => {
      const cx = m.l + step * i + step / 2;
      const g = el('g', { class: 'col', tabindex: '0', 'aria-label': `${fmtDate(d.date, { month: 'short', day: 'numeric' })}: ${totals[i]} blocked` }, svg);
      el('rect', { class: 'hit', x: cx - step / 2, y: m.t, width: step, height: ih, rx: 4 }, g);

      // stack segments bottom-up, 2px surface gap between them
      let acc = 0;
      const visible = series.filter((s) => d.values[s.id] > 0);
      visible.forEach((s, k) => {
        const v = d.values[s.id];
        const y0 = y(acc), y1 = y(acc + v);
        acc += v;
        let h = y0 - y1 - (k > 0 ? GAP : 0);
        if (h < 1) h = 1;
        const top = y0 - (k > 0 ? GAP : 0) - h;
        if (k === visible.length - 1) el('path', { d: topRounded(cx - bw / 2, top, bw, h, 4), fill: s.color }, g);
        else el('rect', { x: cx - bw / 2, y: top, width: bw, height: h, fill: s.color }, g);
      });

      // selective direct label: only the peak day
      if (i === peak) {
        const t = el('text', { class: 'total', x: cx, y: y(totals[i]) - 6, 'text-anchor': 'middle' }, svg);
        t.textContent = totals[i].toLocaleString();
      }
      if (i % every === 0 || i === days.length - 1) {
        const t = el('text', { x: cx, y: H - 6, 'text-anchor': 'middle' }, axis);
        t.textContent = fmtDate(d.date, { month: 'short', day: 'numeric' });
      }

      const show = () => {
        tooltip.textContent = '';
        const head = document.createElement('div');
        head.className = 'tt-date';
        head.textContent = `${fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${totals[i].toLocaleString()} total`;
        tooltip.appendChild(head);
        for (const s of [...series].reverse()) {
          const row = document.createElement('div');
          row.className = 'tt-row';
          const key = document.createElement('i'); key.style.background = s.color;
          const val = document.createElement('b'); val.className = 'num'; val.textContent = (d.values[s.id] || 0).toLocaleString();
          const lab = document.createElement('span'); lab.textContent = s.label;
          row.append(key, val, lab);
          tooltip.appendChild(row);
        }
        tooltip.hidden = false;
        const card = container.closest('.chart-card').getBoundingClientRect();
        const svgBox = svg.getBoundingClientRect();
        const scale = svgBox.width / W;
        let left = svgBox.left - card.left + cx * scale + 14;
        if (left + tooltip.offsetWidth > card.width - 8) left = svgBox.left - card.left + cx * scale - tooltip.offsetWidth - 14;
        tooltip.style.left = left + 'px';
        tooltip.style.top = (svgBox.top - card.top + m.t * scale) + 'px';
      };
      const hide = () => { tooltip.hidden = true; };
      g.addEventListener('pointerenter', show);
      g.addEventListener('focus', show);
      g.addEventListener('pointerleave', hide);
      g.addEventListener('blur', hide);
    });
  }

  return { renderStackedBars };
})();
