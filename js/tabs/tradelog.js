/* ═══════════════════════════════════════════════════════════
   TRADE LOG TAB
════════════════════════════════════════════════════════════ */
const TradeLogTab = (() => {

  let sortCol = 'date', sortDir = 'desc', expandedId = null;
  let filterSymbol = '', filterSession = '', filterDirection = '', filterSetup = '';

  function render() {
    const content = document.getElementById('content');
    const { range, from, to } = App.getDateFilter();
    const allTrades = DB.getTrades();
    const trades = DB.filterByRange(allTrades, range, from, to);
    const setups = DB.getSetupNames();

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Trade Log <span class="badge badge-dim">${trades.length}</span></div>
        <button class="btn-primary btn-sm" onclick="App.openTradeModal()">＋ New Trade</button>
      </div>

      <div class="filter-bar">
        <input type="text" class="filter-search" id="tlSearch" placeholder="Search symbol, notes…" value="${filterSymbol}" oninput="TradeLogTab._filter()" />
        <select id="tlSession" onchange="TradeLogTab._filter()">
          <option value="">All Sessions</option>
          <option value="London">London</option>
          <option value="NY">NY</option>
          <option value="Asian">Asian</option>
          <option value="Other">Other</option>
        </select>
        <select id="tlDirection" onchange="TradeLogTab._filter()">
          <option value="">All Directions</option>
          <option value="Long">Long</option>
          <option value="Short">Short</option>
        </select>
        <select id="tlSetup" onchange="TradeLogTab._filter()">
          <option value="">All Setups</option>
          ${setups.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
        <button class="btn-ghost btn-sm" onclick="TradeLogTab._clearFilters()">Clear</button>
      </div>

      <div class="table-wrap" id="tlTableWrap"></div>
    `;

    // Restore filter values
    const tlSession = document.getElementById('tlSession');
    const tlDir = document.getElementById('tlDirection');
    const tlSetup = document.getElementById('tlSetup');
    if (tlSession) tlSession.value = filterSession;
    if (tlDir) tlDir.value = filterDirection;
    if (tlSetup) tlSetup.value = filterSetup;

    renderTable(trades);
  }

  function renderTable(trades) {
    const wrap = document.getElementById('tlTableWrap');
    if (!wrap) return;

    // Apply text search filter
    const q = (document.getElementById('tlSearch')?.value || '').toLowerCase();
    let filtered = trades.filter(t => {
      if (filterSession && t.session !== filterSession) return false;
      if (filterDirection && t.direction !== filterDirection) return false;
      if (filterSetup && t.setupType !== filterSetup) return false;
      if (q && !`${t.symbol} ${t.notes} ${t.setupType}`.toLowerCase().includes(q)) return false;
      return true;
    });

    // Sort
    filtered = filtered.sort((a, b) => {
      let va = a[sortCol] ?? '', vb = b[sortCol] ?? '';
      if (sortCol === 'date') { va = new Date(va); vb = new Date(vb); }
      else if (sortCol === 'result' || sortCol === 'rMultiple') { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    if (!filtered.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No trades match the current filters.</p></div>`;
      return;
    }

    const th = (col, label) => {
      let cls = sortCol === col ? (sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
      return `<th class="${cls}" onclick="TradeLogTab._sort('${col}')">${label}</th>`;
    };

    wrap.innerHTML = `<table id="tlTable">
      <thead><tr>
        ${th('date', 'Date')}
        ${th('symbol', 'Symbol')}
        ${th('direction', 'Dir')}
        ${th('setupType', 'Setup')}
        ${th('session', 'Session')}
        ${th('entry', 'Entry')}
        ${th('result', 'P&L')}
        ${th('rMultiple', 'R')}
        <th>Grade</th>
        <th>Source</th>
        <th></th>
      </tr></thead>
      <tbody id="tlTbody"></tbody>
    </table>`;

    const tbody = document.getElementById('tlTbody');
    filtered.forEach(t => {
      const pl = t.result !== '' && t.result !== undefined ? parseFloat(t.result) : null;
      const isExpanded = expandedId === t.id;

      const row = document.createElement('tr');
      row.className = isExpanded ? 'expanded' : '';
      row.dataset.id = t.id;
      row.innerHTML = `
        <td>${t.date}</td>
        <td><strong>${t.symbol}</strong></td>
        <td>${dirBadge(t.direction)}</td>
        <td><span class="badge badge-accent">${t.setupType || '—'}</span></td>
        <td>${sessionBadge(t.session)}</td>
        <td class="mono-num">${t.entry ? parseFloat(t.entry).toLocaleString() : '—'}</td>
        <td class="${pl !== null ? (pl >= 0 ? 'text-green' : 'text-red') : ''} font-bold mono-num">${pl !== null ? fmt$(pl) : '—'}</td>
        <td class="mono-num">${t.rMultiple !== '' && t.rMultiple !== undefined ? parseFloat(t.rMultiple).toFixed(2) + 'R' : '—'}</td>
        <td>${gradeBadge(t.postGrade || t.preGrade)}</td>
        <td><span class="badge badge-dim" style="font-size:.65rem">${t.source || 'manual'}</span></td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="btn-icon" title="Edit" onclick="TradeLogTab._edit('${t.id}',event)">✏️</button>
            <button class="btn-icon" title="Delete" onclick="TradeLogTab._del('${t.id}',event)">🗑</button>
          </div>
        </td>
      `;
      row.addEventListener('click', e => {
        if (e.target.tagName === 'BUTTON') return;
        expandedId = expandedId === t.id ? null : t.id;
        renderTable(filtered);
      });
      tbody.appendChild(row);

      if (isExpanded) {
        const expRow = document.createElement('tr');
        expRow.className = 'trade-expand-row';
        expRow.innerHTML = `<td colspan="11"><div class="trade-expand-inner">${expandHTML(t)}</div></td>`;
        tbody.appendChild(expRow);
      }
    });
  }

  function expandHTML(t) {
    const fields = [
      ['SL', t.sl], ['TP', t.tp], ['Exit', t.exitPrice], ['Size ($)', t.size],
      ['HTF Bias', t.htfBias], ['Pre-Grade', t.preGrade], ['Pre-Notes', t.preGradeNotes],
      ['Post-Grade', t.postGrade], ['Post-Notes', t.postGradeNotes],
      ['Linked Mistakes', (t.linkedMistakeIds || []).length],
      ['Source', t.source],
    ];
    const fieldHtml = fields.map(([l, v]) => v !== undefined && v !== '' && v !== null
      ? `<div class="expand-field"><span class="ef-label">${l}</span><span class="ef-val">${v}</span></div>` : ''
    ).join('');

    const notes = t.notes ? `<div class="expand-field" style="grid-column:1/-1"><span class="ef-label">Notes</span><span class="ef-val">${t.notes}</span></div>` : '';
    const ss = t.screenshotUrl ? `<div class="expand-field" style="grid-column:1/-1"><span class="ef-label">Screenshot</span><span class="ef-val"><a href="${t.screenshotUrl}" target="_blank" rel="noopener">${t.screenshotUrl.slice(0, 60)}…</a></span></div>` : '';

    return fieldHtml + notes + ss;
  }

  /* ── Helpers ─────────────────────────────────────────── */
  function fmt$(n) {
    const abs = Math.abs(n);
    const str = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-$' : '+$') + str;
  }
  function dirBadge(dir) {
    if (!dir) return '<span class="text-dim">—</span>';
    return dir === 'Long'
      ? `<span class="badge badge-green">▲ Long</span>`
      : `<span class="badge badge-red">▼ Short</span>`;
  }
  function sessionBadge(s) {
    if (!s) return '<span class="text-dim">—</span>';
    const map = { London: 'badge-accent', NY: 'badge-orange', Asian: 'badge-teal', Other: 'badge-dim' };
    return `<span class="badge ${map[s] || 'badge-dim'}">${s}</span>`;
  }
  function gradeBadge(g) {
    if (!g) return '<span class="text-dim">—</span>';
    const map = { A: 'badge-green', B: 'badge-accent', C: 'badge-orange', D: 'badge-red' };
    return `<span class="badge ${map[g] || 'badge-dim'}">${g}</span>`;
  }

  return {
    render,
    _sort: col => {
      if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortCol = col; sortDir = 'desc'; }
      const { range, from, to } = App.getDateFilter();
      const trades = DB.filterByRange(DB.getTrades(), range, from, to);
      renderTable(trades);
    },
    _filter: () => {
      filterSymbol    = document.getElementById('tlSearch')?.value || '';
      filterSession   = document.getElementById('tlSession')?.value || '';
      filterDirection = document.getElementById('tlDirection')?.value || '';
      filterSetup     = document.getElementById('tlSetup')?.value || '';
      const { range, from, to } = App.getDateFilter();
      const trades = DB.filterByRange(DB.getTrades(), range, from, to);
      renderTable(trades);
    },
    _clearFilters: () => {
      filterSymbol = filterSession = filterDirection = filterSetup = '';
      render();
    },
    _edit: (id, e) => { e.stopPropagation(); App.openTradeModal(id); },
    _del: (id, e) => {
      e.stopPropagation();
      App.confirmDelete('Delete this trade permanently?', () => {
        DB.deleteTrade(id);
        DB.recomputePlaybookStats();
        App.toast('Trade deleted');
        render();
      });
    }
  };
})();
