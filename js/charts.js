/* ═══════════════════════════════════════════════════════════
   CHARTS — Chart.js wrappers
════════════════════════════════════════════════════════════ */
const Charts = (() => {

  const instances = {};

  function isDark() {
    return document.documentElement.getAttribute('data-theme') !== 'light';
  }

  function gridColor()  { return isDark() ? 'rgba(42,51,85,0.8)' : 'rgba(200,210,230,0.6)'; }
  function textColor()  { return isDark() ? '#7b8db3' : '#5a6a8a'; }
  function fgColor()    { return isDark() ? '#e8edf5' : '#1a202c'; }

  function defaults() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textColor(), font: { size: 11 } } },
        tooltip: {
          backgroundColor: isDark() ? '#1e2435' : '#fff',
          titleColor: fgColor(), bodyColor: textColor(),
          borderColor: isDark() ? '#2a3355' : '#dde3f0', borderWidth: 1,
        }
      },
      scales: {
        x: { ticks: { color: textColor(), font: { size: 10 } }, grid: { color: gridColor() } },
        y: { ticks: { color: textColor(), font: { size: 10 } }, grid: { color: gridColor() } }
      }
    };
  }

  function destroy(id) {
    if (instances[id]) { instances[id].destroy(); delete instances[id]; }
  }

  /* ── Equity curve ────────────────────────────────────── */
  function equityCurve(canvasId, data) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx || !data.length) return;

    const labels = data.map(d => d.date);
    const values = data.map(d => d.equity);
    const positive = values[values.length - 1] >= 0;
    const color    = positive ? '#00c896' : '#ff4d6a';

    instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Equity ($)',
          data: values,
          borderColor: color,
          backgroundColor: positive ? 'rgba(0,200,150,0.08)' : 'rgba(255,77,106,0.08)',
          fill: true,
          tension: 0.3,
          pointRadius: data.length > 60 ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: color,
        }]
      },
      options: {
        ...defaults(),
        plugins: {
          ...defaults().plugins,
          legend: { display: false }
        }
      }
    });
  }

  /* ── Win rate by setup ───────────────────────────────── */
  function winRateBySetup(canvasId, data) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx || !data.length) return;

    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          label: 'Win Rate %',
          data: data.map(d => d.winRate.toFixed(1)),
          backgroundColor: data.map(d => d.winRate >= 50 ? 'rgba(0,200,150,0.7)' : 'rgba(255,77,106,0.7)'),
          borderColor:     data.map(d => d.winRate >= 50 ? '#00c896' : '#ff4d6a'),
          borderWidth: 1,
          borderRadius: 4,
        }]
      },
      options: {
        ...defaults(),
        scales: {
          ...defaults().scales,
          y: { ...defaults().scales.y, min: 0, max: 100,
               ticks: { ...defaults().scales.y.ticks, callback: v => v + '%' } }
        },
        plugins: {
          ...defaults().plugins,
          tooltip: { ...defaults().plugins.tooltip, callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}%`
          }}
        }
      }
    });
  }

  /* ── Performance by session ─────────────────────────── */
  function sessionPerformance(canvasId, data) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx || !data.length) return;

    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [
          {
            label: 'Win Rate %',
            data: data.map(d => d.winRate.toFixed(1)),
            backgroundColor: 'rgba(79,142,247,0.7)',
            borderColor: '#4f8ef7', borderWidth: 1, borderRadius: 4,
            yAxisID: 'y',
          },
          {
            label: 'Avg R',
            data: data.map(d => d.avgR.toFixed(2)),
            backgroundColor: 'rgba(0,212,200,0.7)',
            borderColor: '#00d4c8', borderWidth: 1, borderRadius: 4,
            yAxisID: 'y1',
          }
        ]
      },
      options: {
        ...defaults(),
        scales: {
          x: defaults().scales.x,
          y: { ...defaults().scales.y, position: 'left',
               ticks: { ...defaults().scales.y.ticks, callback: v => v + '%' } },
          y1: { ...defaults().scales.y, position: 'right', grid: { drawOnChartArea: false },
                ticks: { ...defaults().scales.y.ticks, callback: v => v + 'R' } },
        }
      }
    });
  }

  /* ── R:R distribution ───────────────────────────────── */
  function rDistribution(canvasId, data) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    const labels = Object.keys(data);
    const values = Object.values(data);
    const colors = labels.map(l => parseFloat(l) >= 0 ? 'rgba(0,200,150,0.7)' : 'rgba(255,77,106,0.7)');

    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.map(l => l + 'R'),
        datasets: [{
          label: 'Trades',
          data: values,
          backgroundColor: colors,
          borderColor: labels.map(l => parseFloat(l) >= 0 ? '#00c896' : '#ff4d6a'),
          borderWidth: 1, borderRadius: 4,
        }]
      },
      options: {
        ...defaults(),
        scales: { ...defaults().scales, y: { ...defaults().scales.y, ticks: { ...defaults().scales.y.ticks, stepSize: 1 } } },
        plugins: { ...defaults().plugins, legend: { display: false } }
      }
    });
  }

  /* ── Daily P&L bar ───────────────────────────────────── */
  function dailyPLBar(canvasId, dlMap) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    const entries = Object.entries(dlMap).sort(([a], [b]) => new Date(a) - new Date(b)).slice(-60);
    const labels  = entries.map(([d]) => d.slice(5));
    const values  = entries.map(([, v]) => v);

    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Daily P&L ($)',
          data: values,
          backgroundColor: values.map(v => v >= 0 ? 'rgba(0,200,150,0.7)' : 'rgba(255,77,106,0.7)'),
          borderColor: values.map(v => v >= 0 ? '#00c896' : '#ff4d6a'),
          borderWidth: 1, borderRadius: 3,
        }]
      },
      options: {
        ...defaults(),
        plugins: { ...defaults().plugins, legend: { display: false } }
      }
    });
  }

  /* ── Drawdown curve ──────────────────────────────────── */
  function drawdownCurve(canvasId, trades) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    const sorted = [...trades].filter(t => t.result !== undefined && t.result !== '')
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    let eq = 0, peak = 0;
    const ddData = sorted.map(t => {
      eq += parseFloat(t.result || 0);
      if (eq > peak) peak = eq;
      return { date: t.date.slice(0, 10), dd: Math.min(0, eq - peak) };
    });

    instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ddData.map(d => d.date),
        datasets: [{
          label: 'Drawdown ($)',
          data: ddData.map(d => d.dd.toFixed(2)),
          borderColor: '#ff4d6a',
          backgroundColor: 'rgba(255,77,106,0.08)',
          fill: true, tension: 0.2, pointRadius: 0,
        }]
      },
      options: {
        ...defaults(),
        plugins: { ...defaults().plugins, legend: { display: false } },
        scales: {
          ...defaults().scales,
          y: { ...defaults().scales.y, ticks: { ...defaults().scales.y.ticks, callback: v => '$' + v } }
        }
      }
    });
  }

  return { equityCurve, winRateBySetup, sessionPerformance, rDistribution, dailyPLBar, drawdownCurve, destroy };
})();
