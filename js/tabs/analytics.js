/* ═══════════════════════════════════════════════════════════
   ANALYTICS TAB
════════════════════════════════════════════════════════════ */
const AnalyticsTab = (() => {
  function render() {
    const content = document.getElementById('content');
    const { range, from, to } = App.getDateFilter();
    const trades  = DB.filterByRange(DB.getTrades(), range, from, to);
    const stats   = DB.calcStats(trades);

    content.innerHTML = `
      <div class="report-stats" style="margin-bottom:20px">
        ${rs('Total Trades', stats.total)}
        ${rs('Win Rate', stats.closed ? stats.winRate.toFixed(1) + '%' : '—', stats.winRate >= 50 ? 'var(--green)' : 'var(--red)')}
        ${rs('Total P&L', stats.closed ? fmt$(stats.totalPL) : '—', stats.totalPL >= 0 ? 'var(--green)' : 'var(--red)')}
        ${rs('Avg R:R', stats.closed ? stats.avgR.toFixed(2) + 'R' : '—')}
        ${rs('Max Drawdown', stats.maxDD ? '-$' + stats.maxDD.toFixed(2) : '—', 'var(--red)')}
        ${rs('Closed Trades', stats.closed)}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">

        <!-- Equity Curve -->
        <div class="card" style="grid-column:1/-1">
          <div class="card-header"><div class="card-title">Cumulative P&L Equity Curve</div></div>
          <div style="height:220px;position:relative"><canvas id="chartEquity"></canvas></div>
        </div>

        <!-- Win Rate by Setup -->
        <div class="card">
          <div class="card-header"><div class="card-title">Win Rate by Setup Type</div></div>
          <div style="height:200px;position:relative"><canvas id="chartSetup"></canvas></div>
        </div>

        <!-- Session Performance -->
        <div class="card">
          <div class="card-header"><div class="card-title">Performance by Session / Killzone</div></div>
          <div style="height:200px;position:relative"><canvas id="chartSession"></canvas></div>
        </div>

        <!-- R:R Distribution -->
        <div class="card" style="grid-column:1/-1">
          <div class="card-header"><div class="card-title">R:R Distribution Histogram</div></div>
          <div style="height:180px;position:relative"><canvas id="chartR"></canvas></div>
        </div>

      </div>
    `;

    const curve   = DB.equityCurve(trades);
    const setups  = DB.winRateBySetup(trades);
    const sessions= DB.performanceBySession(trades);
    const rDist   = DB.rDistribution(trades);

    requestAnimationFrame(() => {
      Charts.equityCurve('chartEquity', curve);
      Charts.winRateBySetup('chartSetup', setups);
      Charts.sessionPerformance('chartSession', sessions);
      Charts.rDistribution('chartR', rDist);
    });
  }

  function rs(label, value, color) {
    return `<div class="report-stat">
      <div class="rs-label">${label}</div>
      <div class="rs-value" style="${color ? `color:${color}` : ''}">${value}</div>
    </div>`;
  }
  function fmt$(n) {
    return (n < 0 ? '-$' : '+$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return { render };
})();
