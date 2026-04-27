/* ═══════════════════════════════════════════════════════════
   REPORTS TAB — 5 sub-tabs + CSV import
   Sources: Notion journal CSV, Binance TX CSV,
            Binance Order History CSV (from XLSX)
════════════════════════════════════════════════════════════ */
const ReportsTab = (() => {

  let activeSubTab = 'overview';

  function render() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="sub-tabs">
        ${['overview','win-loss','drawdown','compare','tags','import']
          .map(id => `<div class="sub-tab${activeSubTab === id ? ' active' : ''}" onclick="ReportsTab._sub('${id}')">${subLabel(id)}</div>`)
          .join('')}
      </div>
      <div id="reportContent"></div>
    `;
    renderSub();
  }

  function subLabel(id) {
    return { overview: 'Overview', 'win-loss': 'Win vs Loss Days',
             drawdown: 'Drawdown', compare: 'Compare',
             tags: 'Tag Breakdown', import: '⬆ Import' }[id] || id;
  }

  function renderSub() {
    const wrap = document.getElementById('reportContent');
    if (!wrap) return;
    const { range, from, to } = App.getDateFilter();
    const allTrades = DB.getTrades();
    const trades    = DB.filterByRange(allTrades, range, from, to);

    switch (activeSubTab) {
      case 'overview':   renderOverview(wrap, trades); break;
      case 'win-loss':   renderWinLoss(wrap, trades); break;
      case 'drawdown':   renderDrawdown(wrap, trades); break;
      case 'compare':    renderCompare(wrap, allTrades); break;
      case 'tags':       renderTags(wrap, trades); break;
      case 'import':     renderImport(wrap); break;
    }
  }

  /* ── Overview ─────────────────────────────────────────── */
  function renderOverview(wrap, trades) {
    const s  = DB.calcStats(trades);
    const closed = trades.filter(t => t.result !== '' && t.result !== undefined);
    const best   = closed.reduce((b, t) => parseFloat(t.result) > parseFloat(b?.result || -Infinity) ? t : b, null);
    const worst  = closed.reduce((b, t) => parseFloat(t.result) < parseFloat(b?.result || Infinity) ? t : b, null);

    wrap.innerHTML = `
      <div class="report-stats">
        ${rs('Total Trades', s.total)}
        ${rs('Closed Trades', s.closed)}
        ${rs('Win Rate', s.closed ? s.winRate.toFixed(1) + '%' : '—', s.winRate >= 50 ? 'var(--green)' : 'var(--red)')}
        ${rs('Total P&L', s.closed ? fmt$(s.totalPL) : '—', s.totalPL >= 0 ? 'var(--green)' : 'var(--red)')}
        ${rs('Avg R:R', s.closed ? s.avgR.toFixed(2) + 'R' : '—')}
        ${rs('Max Drawdown', s.maxDD ? '-$' + s.maxDD.toFixed(2) : '—', 'var(--red)')}
        ${rs('Best Trade', best ? fmt$(parseFloat(best.result)) : '—', 'var(--green)')}
        ${rs('Worst Trade', worst ? fmt$(parseFloat(worst.result)) : '—', 'var(--red)')}
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header"><div class="card-title">Equity Curve</div></div>
        <div style="height:200px;position:relative"><canvas id="rptEquity"></canvas></div>
      </div>
    `;
    requestAnimationFrame(() => Charts.equityCurve('rptEquity', DB.equityCurve(trades)));
  }

  /* ── Win vs Loss Days ────────────────────────────────── */
  function renderWinLoss(wrap, trades) {
    const dlMap = DB.dailyPLMap(trades);
    const days  = Object.entries(dlMap).sort(([a], [b]) => new Date(a) - new Date(b));
    const green = days.filter(([, v]) => v > 0).length;
    const red   = days.filter(([, v]) => v < 0).length;
    const flat  = days.filter(([, v]) => v === 0).length;

    wrap.innerHTML = `
      <div class="report-stats" style="margin-bottom:16px">
        ${rs('Green Days', green, 'var(--green)')}
        ${rs('Red Days', red, 'var(--red)')}
        ${rs('Flat Days', flat)}
        ${rs('Win Day Rate', days.length ? (green / days.length * 100).toFixed(0) + '%' : '—', 'var(--green)')}
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Daily P&L Distribution</div></div>
        <div style="height:220px;position:relative"><canvas id="rptDaily"></canvas></div>
      </div>
    `;
    requestAnimationFrame(() => Charts.dailyPLBar('rptDaily', dlMap));
  }

  /* ── Drawdown ─────────────────────────────────────────── */
  function renderDrawdown(wrap, trades) {
    const closed = trades.filter(t => t.result !== '' && t.result !== undefined)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    let eq = 0, peak = 0, maxDD = 0, maxDDPct = 0;
    closed.forEach(t => {
      eq += parseFloat(t.result || 0);
      if (eq > peak) peak = eq;
      const dd = peak - eq;
      if (dd > maxDD) { maxDD = dd; maxDDPct = peak > 0 ? (dd / peak) * 100 : 0; }
    });

    // Consecutive losing days
    const dlMap = DB.dailyPLMap(trades);
    const dayArr = Object.values(dlMap);
    let maxLoss = 0, curLoss = 0;
    dayArr.forEach(v => { if (v < 0) { curLoss++; maxLoss = Math.max(maxLoss, curLoss); } else curLoss = 0; });

    wrap.innerHTML = `
      <div class="report-stats" style="margin-bottom:16px">
        ${rs('Max Drawdown $', maxDD ? '-$' + maxDD.toFixed(2) : '—', 'var(--red)')}
        ${rs('Max Drawdown %', maxDDPct ? '-' + maxDDPct.toFixed(1) + '%' : '—', 'var(--red)')}
        ${rs('Max Consec. Loss Days', maxLoss, maxLoss >= 3 ? 'var(--red)' : 'var(--text)')}
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Drawdown Curve</div></div>
        <div style="height:220px;position:relative"><canvas id="rptDD"></canvas></div>
      </div>
    `;
    requestAnimationFrame(() => Charts.drawdownCurve('rptDD', trades));
  }

  /* ── Compare ─────────────────────────────────────────── */
  function renderCompare(wrap, allTrades) {
    wrap.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><div class="card-title">Compare</div></div>
        <div class="form-row" style="margin-bottom:16px">
          <div class="form-group">
            <label>Compare By</label>
            <select id="cmpType" onchange="ReportsTab._runCompare()">
              <option value="month">Month vs Month</option>
              <option value="setup">Setup vs Setup</option>
              <option value="session">Session vs Session</option>
              <option value="direction">Long vs Short</option>
            </select>
          </div>
        </div>
        <div id="cmpResult"></div>
      </div>
    `;
    runCompare(allTrades, 'month');
  }

  function runCompare(trades, type) {
    const wrap = document.getElementById('cmpResult');
    if (!wrap) return;
    const groups = {};

    if (type === 'month') {
      trades.forEach(t => {
        const k = t.date?.slice(0, 7) || 'Unknown';
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
      });
    } else if (type === 'setup') {
      trades.forEach(t => {
        const k = t.setupType || 'Untagged';
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
      });
    } else if (type === 'session') {
      trades.forEach(t => {
        const k = t.session || 'Untagged';
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
      });
    } else if (type === 'direction') {
      trades.forEach(t => {
        const k = t.direction || 'Unknown';
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
      });
    }

    const rows = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([key, grp]) => {
      const s = DB.calcStats(grp);
      return { key, ...s };
    });

    if (!rows.length) { wrap.innerHTML = `<div class="empty-state" style="padding:20px"><p>No data to compare.</p></div>`; return; }

    wrap.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>${type === 'month' ? 'Month' : type === 'setup' ? 'Setup' : type === 'session' ? 'Session' : 'Direction'}</th>
          <th>Trades</th><th>Win Rate</th><th>Total P&L</th><th>Avg R</th><th>Wins</th><th>Losses</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td><strong>${r.key}</strong></td>
            <td>${r.total}</td>
            <td class="${r.winRate >= 50 ? 'text-green' : 'text-red'}">${r.closed ? r.winRate.toFixed(1) + '%' : '—'}</td>
            <td class="${r.totalPL >= 0 ? 'text-green' : 'text-red'}">${r.closed ? fmt$(r.totalPL) : '—'}</td>
            <td>${r.closed ? r.avgR.toFixed(2) + 'R' : '—'}</td>
            <td class="text-green">${r.wins}</td>
            <td class="text-red">${r.losses}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    `;
  }

  /* ── Tag Breakdown ───────────────────────────────────── */
  function renderTags(wrap, trades) {
    const sections = [
      { label: 'By Setup Type', key: 'setupType' },
      { label: 'By Session / Killzone', key: 'session' },
      { label: 'By HTF Bias', key: 'htfBias' },
      { label: 'By Pre-Trade Grade', key: 'preGrade' },
      { label: 'By Post-Trade Grade', key: 'postGrade' },
      { label: 'By Direction', key: 'direction' },
    ];

    wrap.innerHTML = sections.map(sec => {
      const groups = {};
      trades.forEach(t => {
        const k = t[sec.key] || 'Untagged';
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
      });
      const rows = Object.entries(groups).map(([key, grp]) => {
        const s = DB.calcStats(grp);
        return { key, ...s };
      }).sort((a, b) => b.total - a.total);

      if (!rows.length) return '';
      return `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header"><div class="card-title">${sec.label}</div></div>
          <div class="table-wrap"><table>
            <thead><tr><th>${sec.label.replace('By ', '')}</th><th>Trades</th><th>Win Rate</th><th>P&L</th><th>Avg R</th></tr></thead>
            <tbody>
              ${rows.map(r => `<tr>
                <td><strong>${r.key}</strong></td>
                <td>${r.total}</td>
                <td class="${r.winRate >= 50 ? 'text-green' : 'text-red'}">${r.closed ? r.winRate.toFixed(1) + '%' : '—'}</td>
                <td class="${r.totalPL >= 0 ? 'text-green' : 'text-red'}">${r.closed ? fmt$(r.totalPL) : '—'}</td>
                <td>${r.closed ? r.avgR.toFixed(2) + 'R' : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      `;
    }).join('');
  }

  /* ── Import ──────────────────────────────────────────── */
  function renderImport(wrap) {
    wrap.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-title">Import Trade History</div>
        </div>
        <p class="text-sub text-sm" style="margin-bottom:16px">
          Supports: <strong>Notion journal CSV</strong> · <strong>Binance Transaction History CSV</strong> · <strong>Binance Spot Order History CSV</strong> (save your .xlsx as .csv first)
        </p>

        <div class="drop-zone" id="dropZone" onclick="document.getElementById('csvFileInput').click()">
          <div class="dz-icon">⬆</div>
          <p>Drop your CSV file here or <strong>click to browse</strong></p>
          <p class="text-xs text-dim" style="margin-top:6px">Auto-detects format · Skips duplicates</p>
        </div>
        <input type="file" id="csvFileInput" accept=".csv,.xlsx" class="hidden" onchange="ReportsTab._handleFile(event)" />

        <div id="importStatus" style="margin-top:16px"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Import History</div>
          <span class="text-sub text-sm">${DB.getTrades().length} total trades in database</span>
        </div>
        ${sourceSummary()}
      </div>
    `;

    // Drag and drop
    const dz = document.getElementById('dropZone');
    if (dz) {
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
      dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      });
    }
  }

  function sourceSummary() {
    const trades = DB.getTrades();
    const srcs = {};
    trades.forEach(t => { const s = t.source || 'manual'; srcs[s] = (srcs[s] || 0) + 1; });
    if (!Object.keys(srcs).length) return `<div class="empty-state" style="padding:20px"><p>No trades imported yet.</p></div>`;
    return Object.entries(srcs).map(([src, cnt]) => `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-sub);font-size:.85rem">
        <span>${srcLabel(src)}</span>
        <span class="badge badge-accent">${cnt} trades</span>
      </div>
    `).join('');
  }

  function srcLabel(s) {
    return { manual: 'Manual entry', notion: 'Notion Journal', binance_tx: 'Binance TX History',
             binance_order: 'Binance Order History' }[s] || s;
  }

  function handleFile(file) {
    const statusEl = document.getElementById('importStatus');
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      try {
        const { format, trades } = DB.autoParseCSV(text);
        if (!trades.length) {
          if (statusEl) statusEl.innerHTML = `<div class="coach-alert warning"><div class="alert-icon">⚠️</div><div class="alert-body"><div class="alert-title">No trades found</div><div class="alert-desc">The file was read but no valid trades could be extracted. Check the format matches Notion journal or Binance export.</div></div></div>`;
          return;
        }
        const { added, skipped } = DB.mergeImportedTrades(trades);
        DB.recomputePlaybookStats();
        if (statusEl) statusEl.innerHTML = `<div class="coach-alert positive"><div class="alert-icon">✅</div><div class="alert-body"><div class="alert-title">${format} — Import successful</div><div class="alert-desc">${added} trades added · ${skipped} duplicates skipped · ${DB.getTrades().length} total trades now in database.</div></div></div>`;
        App.toast(`${added} trades imported from ${format}`);
      } catch (err) {
        if (statusEl) statusEl.innerHTML = `<div class="coach-alert danger"><div class="alert-icon">❌</div><div class="alert-body"><div class="alert-title">Import failed</div><div class="alert-desc">${err.message}</div></div></div>`;
      }
    };
    reader.readAsText(file);
  }

  /* ── Helpers ─────────────────────────────────────────── */
  function rs(label, value, color) {
    return `<div class="report-stat">
      <div class="rs-label">${label}</div>
      <div class="rs-value" style="${color ? `color:${color}` : ''}">${value ?? '—'}</div>
    </div>`;
  }
  function fmt$(n) {
    return (n < 0 ? '-$' : '+$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return {
    render,
    _sub: id => { activeSubTab = id; render(); },
    _runCompare: () => {
      const type = document.getElementById('cmpType')?.value || 'month';
      runCompare(DB.getTrades(), type);
    },
    _handleFile: e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; }
  };
})();
