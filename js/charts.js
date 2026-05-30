/*
 * charts.js — tiny dependency-free SVG line chart.
 *
 * No external libraries so the app works fully offline as a PWA.
 * Renders an SVG string for a series of { date, value } points.
 */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
  }

  /*
   * points: [{ date:'YYYY-MM-DD', value:Number }]
   * opts: { label, color, unit }
   * Returns an SVG string (responsive, viewBox-based).
   */
  function lineChart(points, opts) {
    opts = opts || {};
    const color = opts.color || '#5b8cff';
    const unit = opts.unit || '';
    const W = 640, H = 260;
    const padL = 46, padR = 16, padT = 18, padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    if (!points || points.length === 0) {
      return `<div class="chart-empty">No data yet</div>`;
    }

    const values = points.map((p) => p.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min = min - 1; max = max + 1; }
    // pad the range a little
    const range = max - min;
    min = min - range * 0.08;
    max = max + range * 0.08;

    const n = points.length;
    const x = (i) => padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
    const y = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;

    // gridlines + y labels (4 ticks)
    let grid = '';
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const v = min + ((max - min) * t) / ticks;
      const gy = y(v);
      grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="grid" />`;
      grid += `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" class="ylabel" text-anchor="end">${Math.round(v)}</text>`;
    }

    // x labels: show up to ~6 evenly spaced
    let xlabels = '';
    const maxLabels = 6;
    const step = Math.max(1, Math.ceil(n / maxLabels));
    for (let i = 0; i < n; i += step) {
      const lx = x(i);
      xlabels += `<text x="${lx.toFixed(1)}" y="${H - 10}" class="xlabel" text-anchor="middle">${fmtDate(points[i].date)}</text>`;
    }

    // area + line path
    let d = '';
    points.forEach((p, i) => {
      d += (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(p.value).toFixed(1) + ' ';
    });
    let area = `M${x(0).toFixed(1)} ${(padT + plotH).toFixed(1)} `;
    points.forEach((p, i) => { area += 'L' + x(i).toFixed(1) + ' ' + y(p.value).toFixed(1) + ' '; });
    area += `L${x(n - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

    // dots
    let dots = '';
    points.forEach((p, i) => {
      dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" fill="${color}">` +
        `<title>${escapeHtml(fmtDate(p.date))}: ${p.value}${unit ? ' ' + unit : ''}</title></circle>`;
    });

    const gid = 'g' + Math.random().toString(36).slice(2, 7);
    return `
<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(opts.label || 'chart')}">
  <defs>
    <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  ${grid}
  <path d="${area}" fill="url(#${gid})" stroke="none"/>
  <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  ${xlabels}
</svg>`;
  }

  global.Charts = { lineChart };
})(window);
