/* ═══════════════════════════════════════════════════════════
   DASHBOARD TAB
════════════════════════════════════════════════════════════ */
const DashboardTab = (() => {

  let calMonth, calYear;
  let dragStart = null;     // 'YYYY-MM-DD' anchor
  let dragEnd   = null;     // 'YYYY-MM-DD' current end (for visual range)

  function render() {
    const content = document.getElementById('content');
    const { range, from, to } = App.getDateFilter();
    const allTrades = DB.getTrades();
    const trades    = DB.filterByRange(allTrades, range, from, to);
    const stats     = DB.calcStats(trades);
    const dlMap     = DB.dailyPLMap(allTrades); // calendar uses full history

    // Today's P&L
    const today  = new Date().toISOString().slice(0, 10);
    const todayPL = dlMap[today] || 0;

    content.innerHTML = `
      <div class="stat-cards">
        ${statCard('Daily P&L', fmt$(todayPL), todayPL >= 0 ? 'pos' : 'neg', 'Today')}
        ${statCard('Win Rate', stats.closed ? stats.winRate.toFixed(1) + '%' : '—', '', `${stats.wins}W / ${stats.losses}L of ${stats.closed} closed`)}
        ${statCard('Avg R:R', stats.closed ? stats.avgR.toFixed(2) + 'R' : '—', '', `${stats.closed} closed trades`)}
        ${statCard('Max Drawdown', stats.maxDD ? '-$' + stats.maxDD.toFixed(2) : '—', stats.maxDD > 0 ? 'neg' : '', `Over selected period`)}
      </div>

      <div class="dash-split" style="margin-top:18px">
        <!-- LEFT: Recent trades -->
        <div>
          <div class="section-header">
            <div class="section-title">Recent Trades</div>
            <button class="btn-ghost btn-sm" onclick="App.navigate('tradelog')">View all →</button>
          </div>
          ${recentTradesHtml(trades)}
        </div>

        <!-- RIGHT: Calendar -->
        <div id="calendarSection"></div>
      </div>
    `;

    renderCalendar(dlMap);
    renderWinRateChip();
  }

  function statCard(label, value, cls, sub) {
    return `<div class="stat-card">
      <div class="label">${label}</div>
      <div class="value ${cls}">${value}</div>
      <div class="sub">${sub}</div>
    </div>`;
  }

  function renderWinRateChip() {
    const wr = document.querySelector('.stat-card:nth-child(2)');
    if (!wr) return;
    const chips = document.createElement('div');
    chips.style.cssText = 'display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;';
    ['7', '30', '90'].forEach(d => {
      const trades = DB.filterByRange(DB.getTrades(), d);
      const s = DB.calcStats(trades);
      const btn = document.createElement('button');
      btn.className = 'chip' + (d === '30' ? ' active' : '');
      btn.textContent = `${d}d: ${s.closed ? s.winRate.toFixed(0) + '%' : '—'}`;
      chips.appendChild(btn);
    });
    wr.appendChild(chips);
  }

  function recentTradesHtml(trades) {
    const recent = [...trades].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
    if (!recent.length) return `<div class="empty-state"><div class="empty-icon">📭</div><p>No trades in this period. Add your first trade with the + button.</p></div>`;

    return `<div class="table-wrap"><table>
      <thead><tr>
        <th>Date</th><th>Symbol</th><th>Dir</th><th>Setup</th><th>Result</th><th>R</th>
      </tr></thead>
      <tbody>
        ${recent.map(t => `<tr onclick="App.navigate('tradelog')">
          <td>${t.date}</td>
          <td><strong>${t.symbol}</strong></td>
          <td>${dirBadge(t.direction)}</td>
          <td><span class="badge badge-accent">${t.setupType || '—'}</span></td>
          <td class="${parseFloat(t.result) >= 0 ? 'text-green' : 'text-red'} font-bold">${t.result !== '' && t.result !== undefined ? fmt$(parseFloat(t.result)) : '—'}</td>
          <td>${t.rMultiple !== '' && t.rMultiple !== undefined ? parseFloat(t.rMultiple).toFixed(2) + 'R' : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  }

  /* ── Calendar heatmap ─────────────────────────────────── */
  function renderCalendar(dlMap) {
    const sec = document.getElementById('calendarSection');
    if (!sec) return;
    if (calMonth === undefined) {
      calMonth = new Date().getMonth();
      calYear  = new Date().getFullYear();
    }
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    sec.innerHTML = `
      <div class="calendar-wrap">
        <div class="calendar-nav">
          <button onclick="DashboardTab._prevMonth()">&#8249;</button>
          <h3>${monthNames[calMonth]} ${calYear}</h3>
          <button onclick="DashboardTab._nextMonth()">&#8250;</button>
        </div>
        <div class="calendar-grid-header">
          ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div>${d}</div>`).join('')}
        </div>
        <div class="calendar-grid" id="calGrid"></div>
        <div class="text-xs text-sub" style="margin-top:8px;text-align:center;">
          Click a day for trades · Drag across days to log a multi-day position
        </div>
      </div>
    `;
    buildCalGrid(dlMap);
  }

  function buildCalGrid(dlMap) {
    const grid  = document.getElementById('calGrid');
    if (!grid) return;
    const today = new Date().toISOString().slice(0, 10);
    const first = new Date(calYear, calMonth, 1);
    const last  = new Date(calYear, calMonth + 1, 0);
    const startDay = first.getDay();
    let html = '';
    for (let i = 0; i < startDay; i++) html += `<div class="cal-day empty"></div>`;
    for (let d = 1; d <= last.getDate(); d++) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const pnl     = dlMap[dateStr];
      const cls     = calClass(pnl);
      const isToday = dateStr === today ? ' today' : '';
      html += `<div class="cal-day ${cls}${isToday}" data-date="${dateStr}"
                    title="${dateStr}${pnl !== undefined ? ': ' + fmt$(pnl) : ''}">
        <span class="cal-num">${d}</span>
        ${pnl !== undefined ? `<span class="cal-pnl">${pnl >= 0 ? '+' : ''}${Math.abs(pnl) >= 1000 ? (pnl / 1000).toFixed(1) + 'k' : pnl.toFixed(0)}</span>` : ''}
      </div>`;
    }
    grid.innerHTML = html;
    wireCalEvents(grid);
  }

  /* ── Calendar interactions: click + drag-to-stretch ──── */
  function wireCalEvents(grid) {
    grid.querySelectorAll('.cal-day:not(.empty)').forEach(cell => {
      cell.addEventListener('mousedown', e => {
        dragStart = cell.dataset.date;
        dragEnd   = dragStart;
      });
      cell.addEventListener('mouseenter', e => {
        if (dragStart) {
          dragEnd = cell.dataset.date;
          paintRange();
        }
      });
      cell.addEventListener('mouseup', e => {
        const startDate = dragStart, endDate = cell.dataset.date;
        clearRange();
        dragStart = null; dragEnd = null;
        if (!startDate) return;
        if (startDate === endDate) {
          openDayTradesModal(startDate);
        } else {
          // multi-day drag → open new trade with date range
          const [d1, d2] = [startDate, endDate].sort();
          App.openTradeModal();
          setTimeout(() => {
            const fDate = document.getElementById('fDate');
            if (fDate) fDate.value = d1;
            // Stash end date on form for save handler to pick up
            window._jb_pendingEndDate = d2;
            App.toast(`New multi-day trade: ${d1} → ${d2}`);
          }, 100);
        }
      });
    });
    document.addEventListener('mouseup', () => { dragStart = null; dragEnd = null; clearRange(); }, { once: true });
  }

  function paintRange() {
    if (!dragStart || !dragEnd) return;
    const grid = document.getElementById('calGrid');
    if (!grid) return;
    const [a, b] = [dragStart, dragEnd].sort();
    grid.querySelectorAll('.cal-day:not(.empty)').forEach(cell => {
      const d = cell.dataset.date;
      cell.classList.toggle('range-mid', d >= a && d <= b);
    });
  }
  function clearRange() {
    document.querySelectorAll('.cal-day.range-mid').forEach(c => c.classList.remove('range-mid'));
    document.querySelectorAll('.cal-day.drag-over').forEach(c => c.classList.remove('drag-over'));
  }

  /* ── Day-trades modal ─────────────────────────────────── */
  function openDayTradesModal(dateStr) {
    const allTrades = DB.getTrades();
    // Include any trade where date <= dateStr <= dateEnd (multi-day) or date == dateStr
    const dayTrades = allTrades.filter(t => {
      if (t.date === dateStr) return true;
      if (t.dateEnd && t.date <= dateStr && t.dateEnd >= dateStr) return true;
      return false;
    }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const totalPL = dayTrades.reduce((s, t) => {
      const r = parseFloat(t.result);
      return s + (isNaN(r) ? 0 : r);
    }, 0);

    const html = `
      <div class="modal-overlay" id="dayModal" onclick="if(event.target.id==='dayModal')DashboardTab._closeDayModal()">
        <div class="modal modal-sm">
          <div class="modal-header">
            <h2>📅 Trades on ${dateStr}</h2>
            <button class="modal-close" onclick="DashboardTab._closeDayModal()">✕</button>
          </div>
          <div class="modal-body">
            ${dayTrades.length ? `
              <div style="margin-bottom:12px;padding:8px 12px;background:var(--bg-mid);border-radius:8px;display:flex;justify-content:space-between;">
                <span class="text-sub text-sm">${dayTrades.length} trade${dayTrades.length>1?'s':''}</span>
                <strong class="${totalPL >= 0 ? 'text-green' : 'text-red'}">${fmt$(totalPL)}</strong>
              </div>
              <div class="day-trades-list">
                ${dayTrades.map(t => `
                  <div class="day-trade-row">
                    <div>
                      <div><strong>${t.symbol || '—'}</strong> ${dirBadge(t.direction)}</div>
                      <div class="text-xs text-sub">
                        ${t.setupType || 'No setup'} · ${t.session || 'No session'}
                        ${t.dateEnd && t.dateEnd !== t.date ? `· ${t.date} → ${t.dateEnd}` : ''}
                      </div>
                    </div>
                    <div style="text-align:right">
                      <div class="${parseFloat(t.result) >= 0 ? 'text-green' : 'text-red'} font-bold">
                        ${t.result !== '' && t.result !== undefined ? fmt$(parseFloat(t.result)) : '—'}
                      </div>
                      ${t.rMultiple !== '' && t.rMultiple !== undefined ? `<div class="text-xs text-sub">${parseFloat(t.rMultiple).toFixed(2)}R</div>` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div class="empty-state" style="padding:30px;text-align:center;">
                <div class="empty-icon">📭</div>
                <p>No trades logged on this day.</p>
              </div>
            `}
          </div>
          <div class="modal-footer">
            <button class="btn-ghost" onclick="DashboardTab._closeDayModal()">Close</button>
            <button class="btn-primary" onclick="DashboardTab._newTradeForDay('${dateStr}')">＋ New trade</button>
          </div>
        </div>
      </div>
    `;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
  }

  function calClass(pnl) {
    if (pnl === undefined || pnl === null) return 'flat';
    if (pnl === 0) return 'flat';
    if (pnl > 0) {
      if (pnl > 500) return 'win-3';
      if (pnl > 100) return 'win-2';
      return 'win';
    }
    if (pnl < -500) return 'loss-3';
    if (pnl < -100) return 'loss-2';
    return 'loss';
  }

  /* ── Helpers ─────────────────────────────────────────── */
  function fmt$(n) {
    const abs = Math.abs(n);
    const str = abs >= 1000 ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : abs.toFixed(2);
    return (n < 0 ? '-$' : '+$') + str;
  }
  function dirBadge(dir) {
    if (!dir) return '—';
    return dir === 'Long'
      ? `<span class="badge badge-green">▲ Long</span>`
      : `<span class="badge badge-red">▼ Short</span>`;
  }

  /* ── Public ──────────────────────────────────────────── */
  return {
    render,
    _prevMonth: () => {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      render();
    },
    _nextMonth: () => {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      render();
    },
    _closeDayModal: () => {
      const m = document.getElementById('dayModal');
      if (m) m.remove();
    },
    _newTradeForDay: (dateStr) => {
      const m = document.getElementById('dayModal');
      if (m) m.remove();
      App.openTradeModal();
      setTimeout(() => {
        const fDate = document.getElementById('fDate');
        if (fDate) fDate.value = dateStr;
      }, 100);
    }
  };
})();
