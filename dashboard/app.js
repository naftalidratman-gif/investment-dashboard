const SERIES_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
];
const DATA_URL = '../data/dashboard_export.json';
const MAX_PLOTTED = 8; // categorical palette cap; rest available via table

let state = {
  ayalon: [], more: [],
  ayalonSelected: new Set(),
  moreSelected: new Set(),
};

function periodToMonthLabel(p) {
  const s = String(p);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
}

function fmtPct(v) {
  if (v === null || v === undefined) return '–';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function pctClass(v) {
  if (v === null || v === undefined) return '';
  return v > 0 ? 'pos' : (v < 0 ? 'neg' : '');
}

async function main() {
  let payload;
  try {
    const res = await fetch(DATA_URL);
    payload = await res.json();
  } catch (e) {
    document.getElementById('subtitle').textContent =
      'Could not load data/dashboard_export.json — run scraper/run_daily.py first, and serve this folder over HTTP (not file://).';
    return;
  }

  state.ayalon = payload.ayalon_tracks || [];
  state.more = payload.more_funds || [];

  renderSubtitle();
  renderStatRow();
  renderAyalonChart();
  renderAyalonTable();
  renderMoreSection();
}

// Groups rows by id (string-normalized so ids compare consistently whether
// the source data used a number or a string), sorted by period ascending.
function groupBy(rows, idKey, periodKey) {
  const map = new Map();
  for (const r of rows) {
    const id = String(r[idKey]);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(r);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => (a[periodKey] < b[periodKey] ? -1 : a[periodKey] > b[periodKey] ? 1 : 0));
  }
  return map;
}

function groupByTrack(rows) { return groupBy(rows, 'fund_id', 'report_period'); }
function groupByFund(rows) { return groupBy(rows, 'fund_id', 'nav_date'); }

function renderSubtitle() {
  const latest = state.ayalon.reduce((max, r) => Math.max(max, r.report_period), 0);
  const fetchedAt = state.ayalon[0]?.fetched_at;
  const trackCount = new Set(state.ayalon.map(r => r.fund_id)).size;
  const moreDate = state.more.reduce((max, r) => r.nav_date > max ? r.nav_date : max, '');
  document.getElementById('subtitle').textContent =
    `Ayalon: ${trackCount} tracks, monthly (latest ${latest ? periodToMonthLabel(latest) : '–'}) · ` +
    `More: ${new Set(state.more.map(r => r.fund_id)).size} funds, daily (as of ${moreDate || '–'})` +
    (fetchedAt ? ` · fetched ${new Date(fetchedAt).toLocaleString()}` : '');
}

function renderStatRow() {
  const byTrack = groupByTrack(state.ayalon);
  const latestPeriod = state.ayalon.reduce((max, r) => Math.max(max, r.report_period), 0);
  const latestRows = state.ayalon.filter(r => r.report_period === latestPeriod);
  const avgMonthly = latestRows.length
    ? latestRows.reduce((s, r) => s + (r.monthly_yield ?? 0), 0) / latestRows.length
    : null;
  const best = latestRows.reduce((b, r) => (b === null || (r.monthly_yield ?? -Infinity) > b.monthly_yield ? r : b), null);
  const totalAssets = latestRows.reduce((s, r) => s + (r.total_assets ?? 0), 0);

  const tiles = [
    { label: 'Ayalon tracks tracked', value: byTrack.size },
    { label: 'Avg monthly yield (latest month)', value: fmtPct(avgMonthly) },
    { label: 'Best track (latest month)', value: best ? `${fmtPct(best.monthly_yield)}` : '–', sub: best?.fund_name },
    { label: 'Total assets, ₪M (latest month)', value: totalAssets ? totalAssets.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '–' },
  ];
  const el = document.getElementById('statRow');
  el.innerHTML = tiles.map(t => `
    <div class="stat-tile">
      <div class="label">${t.label}</div>
      <div class="value">${t.value}</div>
      ${t.sub ? `<div class="label" style="margin-top:2px">${t.sub}</div>` : ''}
    </div>
  `).join('');
}

// Compounds a track/fund's period-over-period yield into an indexed value
// starting at 100, so differently-scaled series (a ₪100 fund vs. a ₪13,000
// fund; a monthly-report track vs. a daily-report fund) are comparable.
function indexedSeries(rows, periodKey, yieldKey) {
  let v = 100;
  return rows.map(r => {
    v = v * (1 + (r[yieldKey] ?? 0) / 100);
    return { period: r[periodKey], value: v, raw: r };
  });
}

// Every checkbox is always clickable -- no disabled state to get stuck on.
// Checking a track past the MAX_PLOTTED cap bumps the oldest-selected one
// off automatically (selectedSet is a Set, so insertion order is preserved
// and .values().next().value is always the oldest).
function renderTrackLegend(containerId, entries, selectedSet, onChange) {
  const legend = document.getElementById(containerId);
  const clearBtn = selectedSet.size > 0
    ? `<button type="button" class="legend-clear" id="${containerId}-clear">Clear all</button>`
    : '<span class="legend-clear legend-clear-empty">Nothing selected — check tracks below</span>';
  legend.innerHTML = clearBtn + entries.map(([id, rows], i) => {
    const color = SERIES_COLORS[i % SERIES_COLORS.length];
    const isSelected = selectedSet.has(id);
    return `<label>
      <input type="checkbox" data-id="${id}" ${isSelected ? 'checked' : ''}>
      <span class="swatch" style="background:${color}"></span>
      ${rows[0].fund_name}
    </label>`;
  }).join('');

  const clearEl = document.getElementById(`${containerId}-clear`);
  if (clearEl && selectedSet.size > 0) {
    clearEl.addEventListener('click', () => {
      selectedSet.clear();
      onChange();
    });
  }

  legend.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) {
        if (selectedSet.size >= MAX_PLOTTED) {
          selectedSet.delete(selectedSet.values().next().value);
        }
        selectedSet.add(id);
      } else {
        selectedSet.delete(id);
      }
      onChange();
    });
  });
}

function drawIndexedChart({ svgId, tooltipId, entries, selectedSet, periodKey, yieldKey, formatPeriod, yieldNoun }) {
  const svg = document.getElementById(svgId);
  const W = 1000, H = 320, padL = 44, padR = 12, padT = 12, padB = 28;
  svg.innerHTML = '';

  const selectedSeries = entries
    .filter(([id]) => selectedSet.has(id))
    .map(([id, rows]) => ({
      id,
      name: rows[0].fund_name,
      points: indexedSeries(rows, periodKey, yieldKey),
      colorIdx: entries.findIndex(e => e[0] === id),
    }));

  if (selectedSeries.length === 0) return;

  const allPeriods = [...new Set(selectedSeries.flatMap(s => s.points.map(p => p.period)))].sort();
  const allValues = selectedSeries.flatMap(s => s.points.map(p => p.value));
  const yMin = Math.min(...allValues, 100) * 0.98;
  const yMax = Math.max(...allValues, 100) * 1.02;
  const yRange = (yMax - yMin) || 1;

  const x = period => allPeriods.length > 1
    ? padL + (allPeriods.indexOf(period) / (allPeriods.length - 1)) * (W - padL - padR)
    : padL + (W - padL - padR) / 2; // single data point: center it rather than divide by zero
  const y = v => padT + (1 - (v - yMin) / yRange) * (H - padT - padB);

  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');

  // gridlines (4 horizontal)
  for (let i = 0; i <= 4; i++) {
    const v = yMin + (i / 4) * (yMax - yMin);
    const ly = y(v);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', padL); line.setAttribute('x2', W - padR);
    line.setAttribute('y1', ly); line.setAttribute('y2', ly);
    line.setAttribute('class', 'gridline');
    g.appendChild(line);
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', 4); label.setAttribute('y', ly + 4);
    label.setAttribute('class', 'axis-label');
    label.textContent = v.toFixed(0);
    g.appendChild(label);
  }
  // baseline at 100
  const base = document.createElementNS(ns, 'line');
  base.setAttribute('x1', padL); base.setAttribute('x2', W - padR);
  base.setAttribute('y1', y(100)); base.setAttribute('y2', y(100));
  base.setAttribute('class', 'baseline');
  g.appendChild(base);

  // x labels (start, mid, end)
  [0, Math.floor((allPeriods.length - 1) / 2), allPeriods.length - 1].forEach(i => {
    if (allPeriods[i] === undefined) return;
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', x(allPeriods[i]));
    label.setAttribute('y', H - 6);
    label.setAttribute('class', 'axis-label');
    label.setAttribute('text-anchor', i === 0 ? 'start' : i === allPeriods.length - 1 ? 'end' : 'middle');
    label.textContent = formatPeriod(allPeriods[i]);
    g.appendChild(label);
  });

  const tooltip = document.getElementById(tooltipId);

  selectedSeries.forEach(s => {
    const color = SERIES_COLORS[s.colorIdx % SERIES_COLORS.length];
    const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.period)} ${y(p.value)}`).join(' ');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'line-path');
    path.setAttribute('stroke', color);
    g.appendChild(path);

    s.points.forEach(p => {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', x(p.period));
      c.setAttribute('cy', y(p.value));
      c.setAttribute('class', 'point');
      c.setAttribute('fill', color);
      c.addEventListener('mouseenter', () => {
        tooltip.style.display = 'block';
        tooltip.innerHTML = `<div class="t-date">${formatPeriod(p.period)}</div>
          <div class="t-row"><span class="swatch" style="background:${color}"></span>${s.name}: ${p.value.toFixed(1)} (${fmtPct(p.raw[yieldKey])} ${yieldNoun})</div>`;
      });
      c.addEventListener('mousemove', (evt) => {
        const rect = svg.getBoundingClientRect();
        tooltip.style.left = (evt.clientX - rect.left + 12) + 'px';
        tooltip.style.top = (evt.clientY - rect.top - 8) + 'px';
      });
      c.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
      g.appendChild(c);
    });
  });

  svg.appendChild(g);
}

function renderAyalonChart() {
  const byTrack = groupByTrack(state.ayalon);
  const entries = [...byTrack.entries()].sort((a, b) => a[1][0].fund_name.localeCompare(b[1][0].fund_name, 'he'));
  if (state.ayalonSelected.size === 0) {
    entries.slice(0, MAX_PLOTTED).forEach(([id]) => state.ayalonSelected.add(id));
  }

  const rerender = () => {
    renderTrackLegend('legend', entries, state.ayalonSelected, rerender);
    drawIndexedChart({
      svgId: 'chart', tooltipId: 'tooltip', entries, selectedSet: state.ayalonSelected,
      periodKey: 'report_period', yieldKey: 'monthly_yield',
      formatPeriod: periodToMonthLabel, yieldNoun: 'that month',
    });
  };
  rerender();
}

function renderMoreChart(entries) {
  if (state.moreSelected.size === 0) {
    entries.slice(0, MAX_PLOTTED).forEach(([id]) => state.moreSelected.add(id));
  }

  const rerender = () => {
    renderTrackLegend('moreLegend', entries, state.moreSelected, rerender);
    drawIndexedChart({
      svgId: 'moreChart', tooltipId: 'moreTooltip', entries, selectedSet: state.moreSelected,
      periodKey: 'nav_date', yieldKey: 'daily_change_pct',
      formatPeriod: d => d, yieldNoun: 'that day',
    });
  };
  rerender();
}

const AYALON_COLUMNS = [
  { key: 'fund_name', label: 'Track', fmt: v => v },
  { key: 'report_period', label: 'Latest month', fmt: periodToMonthLabel },
  { key: 'monthly_yield', label: 'Monthly yield', fmt: fmtPct, cls: pctClass },
  { key: 'year_to_date_yield', label: 'YTD yield', fmt: fmtPct, cls: pctClass },
  { key: 'yield_trailing_3_yrs', label: '3yr yield', fmt: fmtPct, cls: pctClass },
  { key: 'yield_trailing_5_yrs', label: '5yr yield', fmt: fmtPct, cls: pctClass },
  { key: 'standard_deviation', label: 'Std. dev.', fmt: v => v ?? '–' },
  { key: 'avg_annual_management_fee', label: 'Mgmt fee', fmt: v => v != null ? `${v}%` : '–' },
  { key: 'total_assets', label: 'Assets, ₪M', fmt: v => v != null ? v.toLocaleString() : '–' },
];

let sortState = { key: 'fund_name', dir: 1 };

function renderAyalonTable() {
  const byTrack = groupByTrack(state.ayalon);
  const latestRows = [...byTrack.values()].map(rows => rows[rows.length - 1]);

  const table = document.getElementById('ayalonTable');
  const thead = table.querySelector('thead');
  thead.innerHTML = `<tr>${AYALON_COLUMNS.map(c =>
    `<th data-key="${c.key}">${c.label}${sortState.key === c.key ? (sortState.dir === 1 ? ' ↑' : ' ↓') : ''}</th>`
  ).join('')}</tr>`;
  thead.querySelectorAll('th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sortState.key === key) sortState.dir *= -1;
      else sortState = { key, dir: 1 };
      renderAyalonTable();
    });
  });

  const sorted = [...latestRows].sort((a, b) => {
    const av = a[sortState.key], bv = b[sortState.key];
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'string') return av.localeCompare(bv, 'he') * sortState.dir;
    return (av - bv) * sortState.dir;
  });

  const tbody = table.querySelector('tbody');
  tbody.innerHTML = sorted.map(r => `<tr>${AYALON_COLUMNS.map(c =>
    `<td class="${c.cls ? c.cls(r[c.key]) : ''}">${c.fmt(r[c.key])}</td>`
  ).join('')}</tr>`).join('');
}

const MORE_COLUMNS = [
  { key: 'fund_name', label: 'Fund', fmt: v => v },
  { key: 'nav_date', label: 'As of', fmt: v => v },
  { key: 'redemption_price', label: 'Price (₪)', fmt: v => v != null ? v.toLocaleString() : '–' },
  { key: 'daily_change_pct', label: 'Daily change', fmt: fmtPct, cls: pctClass },
  { key: 'monthly_change_pct', label: 'Monthly change', fmt: fmtPct, cls: pctClass },
  { key: 'yearly_change_pct', label: 'Yearly change', fmt: fmtPct, cls: pctClass },
  { key: 'assets', label: 'Assets, ₪M', fmt: v => v != null ? v.toLocaleString() : '–' },
];

let moreSortState = { key: 'fund_name', dir: 1 };

function renderMoreSection() {
  const desc = document.getElementById('moreDesc');
  const content = document.getElementById('moreContent');

  if (state.more.length === 0) {
    desc.textContent = 'Not connected yet.';
    content.innerHTML = `<div class="empty-state">
      No More Investment fund data yet &mdash; run <code>scraper/run_daily.py</code>.
    </div>`;
    return;
  }

  const byFund = groupByFund(state.more);
  const entries = [...byFund.entries()].sort((a, b) => a[1][0].fund_name.localeCompare(b[1][0].fund_name, 'he'));
  const latestRows = entries.map(([, rows]) => rows[rows.length - 1]);
  const latestDate = latestRows.reduce((max, r) => r.nav_date > max ? r.nav_date : max, '');
  const daysOfHistory = Math.max(...entries.map(([, rows]) => rows.length));
  const avgDaily = latestRows.reduce((s, r) => s + (r.daily_change_pct ?? 0), 0) / latestRows.length;
  const best = latestRows.reduce((b, r) => (b === null || (r.daily_change_pct ?? -Infinity) > b.daily_change_pct ? r : b), null);

  desc.textContent = `${entries.length} More Investment funds, priced as of ${latestDate} (updates daily — mutual funds report NAV every trading day).`;

  content.innerHTML = `
    <div class="stat-row">
      <div class="stat-tile"><div class="label">Funds tracked</div><div class="value">${entries.length}</div></div>
      <div class="stat-tile"><div class="label">Avg daily change</div><div class="value">${fmtPct(avgDaily)}</div></div>
      <div class="stat-tile"><div class="label">Best mover today</div><div class="value">${best ? fmtPct(best.daily_change_pct) : '–'}</div><div class="label" style="margin-top:2px">${best?.fund_name ?? ''}</div></div>
    </div>
    <p class="desc">Indexed value (start = 100), compounding each fund's daily change.${daysOfHistory < 2 ? ' Only one day of history so far — the line fills in as more days accumulate.' : ''}</p>
    <div class="legend" id="moreLegend"></div>
    <div style="position:relative">
      <svg class="chart" id="moreChart" viewBox="0 0 1000 320" preserveAspectRatio="none"></svg>
      <div class="tooltip" id="moreTooltip"></div>
    </div>
    <div class="table-scroll" style="margin-top:20px"><table id="moreTable"><thead></thead><tbody></tbody></table></div>
  `;

  renderMoreChart(entries);

  const table = document.getElementById('moreTable');
  const renderTable = () => {
    const thead = table.querySelector('thead');
    thead.innerHTML = `<tr>${MORE_COLUMNS.map(c =>
      `<th data-key="${c.key}">${c.label}${moreSortState.key === c.key ? (moreSortState.dir === 1 ? ' ↑' : ' ↓') : ''}</th>`
    ).join('')}</tr>`;
    thead.querySelectorAll('th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (moreSortState.key === key) moreSortState.dir *= -1;
        else moreSortState = { key, dir: 1 };
        renderTable();
      });
    });

    const sorted = [...latestRows].sort((a, b) => {
      const av = a[moreSortState.key], bv = b[moreSortState.key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return av.localeCompare(bv, 'he') * moreSortState.dir;
      return (av - bv) * moreSortState.dir;
    });

    table.querySelector('tbody').innerHTML = sorted.map(r => `<tr>${MORE_COLUMNS.map(c =>
      `<td class="${c.cls ? c.cls(r[c.key]) : ''}">${c.fmt(r[c.key])}</td>`
    ).join('')}</tr>`).join('');
  };
  renderTable();
}

main();
