/* ═══════════════════════════════════════════════════════════
   WATCHLIST TAB
════════════════════════════════════════════════════════════ */
const WatchlistTab = (() => {

  function render() {
    const content = document.getElementById('content');
    const coins   = DB.getWatchlist();

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Watchlist</div>
        <button class="btn-ghost btn-sm" onclick="WatchlistTab._addCoin()">＋ Add Coin</button>
      </div>

      <div class="watchlist-grid" id="watchlistGrid"></div>

      <div class="divider"></div>

      <div class="section-header">
        <div class="section-title">📅 Daily Macro Notes</div>
      </div>
      <div class="card">
        <div class="form-group">
          <label>Macro events, FOMC, CPI, BTC halving, key catalysts…</label>
          <textarea id="macroNotes" rows="5" placeholder="Apr 30: FOMC rate decision (2:00 PM EST) — expect volatility
May 7: US NFP data
BTC: post-halving period — historically bullish 6-18 months post-halving
XRP: SEC case resolved, watch for institutional inflows">${getMacroNotes()}</textarea>
        </div>
        <button class="btn-primary btn-sm" onclick="WatchlistTab._saveMacro()">Save Notes</button>
      </div>
    `;

    renderCards(coins);
  }

  function getMacroNotes() {
    try { return localStorage.getItem('jb_macro') || ''; } catch { return ''; }
  }

  function renderCards(coins) {
    const grid = document.getElementById('watchlistGrid');
    if (!grid) return;
    grid.innerHTML = coins.map(c => coinCard(c)).join('');
  }

  function coinCard(c) {
    const biasClass = { Bullish: 'badge-green', Bearish: 'badge-red', Neutral: 'badge-dim' }[c.htfBias] || 'badge-dim';
    return `
      <div class="watchlist-card" id="wc_${c.id}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div class="watchlist-coin">${c.coin}</div>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="badge ${biasClass}">${c.htfBias}</span>
            <button class="btn-icon" onclick="WatchlistTab._edit('${c.id}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="WatchlistTab._del('${c.id}')" title="Remove">🗑</button>
          </div>
        </div>

        <div id="wc_view_${c.id}">
          <div class="watchlist-levels">
            ${lvl('S/R Levels', c.levels?.sr)}
            ${lvl('OTE Zone', c.levels?.ote)}
            ${lvl('FVG Level', c.levels?.fvg)}
          </div>
          ${c.notes ? `<div class="text-sub text-sm mt-2" style="border-top:1px solid var(--border-sub);padding-top:8px;margin-top:8px">${c.notes}</div>` : ''}
        </div>

        <div id="wc_edit_${c.id}" class="hidden">
          <div class="form-row" style="margin-top:10px">
            <div class="form-group">
              <label>HTF Bias</label>
              <select id="wb_${c.id}_bias">
                <option ${c.htfBias === 'Bullish' ? 'selected' : ''}>Bullish</option>
                <option ${c.htfBias === 'Bearish' ? 'selected' : ''}>Bearish</option>
                <option ${c.htfBias === 'Neutral' ? 'selected' : ''}>Neutral</option>
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-top:8px">
            <label>S/R Levels</label>
            <input type="text" id="wb_${c.id}_sr" value="${c.levels?.sr || ''}" placeholder="e.g. 62400 / 60800" />
          </div>
          <div class="form-group">
            <label>OTE Zone</label>
            <input type="text" id="wb_${c.id}_ote" value="${c.levels?.ote || ''}" placeholder="e.g. 61200-62100" />
          </div>
          <div class="form-group">
            <label>FVG Level</label>
            <input type="text" id="wb_${c.id}_fvg" value="${c.levels?.fvg || ''}" placeholder="e.g. 59800" />
          </div>
          <div class="form-group">
            <label>Notes</label>
            <textarea id="wb_${c.id}_notes" rows="2">${c.notes || ''}</textarea>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn-primary btn-sm" onclick="WatchlistTab._saveEdit('${c.id}')">Save</button>
            <button class="btn-ghost btn-sm" onclick="WatchlistTab._cancelEdit('${c.id}')">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  function lvl(label, val) {
    return `<div class="level-row">
      <span class="level-label">${label}</span>
      <span class="level-value">${val || '—'}</span>
    </div>`;
  }

  return {
    render,
    _addCoin: () => {
      const coin = prompt('Enter coin pair (e.g. SOL/USDT):');
      if (!coin?.trim()) return;
      DB.addWatchCoin(coin.trim().toUpperCase());
      render();
    },
    _edit: id => {
      document.getElementById(`wc_view_${id}`)?.classList.add('hidden');
      document.getElementById(`wc_edit_${id}`)?.classList.remove('hidden');
    },
    _cancelEdit: id => {
      document.getElementById(`wc_view_${id}`)?.classList.remove('hidden');
      document.getElementById(`wc_edit_${id}`)?.classList.add('hidden');
    },
    _saveEdit: id => {
      const g = s => document.getElementById(`wb_${id}_${s}`)?.value || '';
      DB.updateWatchCoin(id, {
        htfBias: g('bias'),
        levels: { sr: g('sr'), ote: g('ote'), fvg: g('fvg') },
        notes: g('notes')
      });
      App.toast('Watchlist updated');
      render();
    },
    _del: id => {
      App.confirmDelete('Remove this coin from the watchlist?', () => {
        DB.deleteWatchCoin(id);
        render();
      });
    },
    _saveMacro: () => {
      const notes = document.getElementById('macroNotes')?.value || '';
      localStorage.setItem('jb_macro', notes);
      App.toast('Macro notes saved');
    }
  };
})();
