/* ═══════════════════════════════════════════════════════════
   JOURNAL TAB
════════════════════════════════════════════════════════════ */
const JournalTab = (() => {

  let selectedDate = new Date().toISOString().slice(0, 10);
  let currentRating = 0;

  function render() {
    const content = document.getElementById('content');
    const entry   = DB.getJournalEntry(selectedDate);
    const trades  = DB.getTrades().filter(t => t.date === selectedDate);
    currentRating = entry.rating || 0;

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Trading Journal</div>
      </div>

      <div class="journal-nav">
        <button class="btn-ghost btn-sm" onclick="JournalTab._prevDay()">&#8249; Prev</button>
        <input type="date" id="journalDate" value="${selectedDate}" onchange="JournalTab._setDate(this.value)" />
        <button class="btn-ghost btn-sm" onclick="JournalTab._nextDay()">Next &#8250;</button>
        <button class="btn-ghost btn-sm" onclick="JournalTab._today()">Today</button>
      </div>

      <div style="display:grid;gap:20px;grid-template-columns:1fr 1fr;">

        <!-- Pre-market bias -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">🌅 Pre-Market Bias</div>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label>HTF Bias &amp; Key Levels (write your analysis before the session)</label>
            <textarea id="jBias" rows="8" placeholder="BTC: Bearish — D1 below 200 EMA, targeting $58k liquidity pool…
XRP: Neutral — watching $0.48 FVG fill
ETH: Bullish — above W1 OTE zone

Key levels to watch:
• BTC: 62,400 (H4 EQH), 60,800 (D1 FVG)
• XRP: 0.4820 (OTE), 0.4550 (SL region)">${entry.bias || ''}</textarea>
          </div>
          <button class="btn-primary btn-sm" onclick="JournalTab._saveBias()">Save Bias</button>
        </div>

        <!-- Post-session review -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">🌇 Post-Session Review</div>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label>Review (what worked, what didn't, rule adherence)</label>
            <textarea id="jReview" rows="8" placeholder="What went well:
• Waited for proper OTE entry on BTC long ✓
• Respected SL, didn't move it ✓

What went wrong:
• Overtrade — 3rd trade was FOMO ✗
• Exited early on XRP, missed 2R ✗

Rule check:
• No trades outside killzone: ✓
• Max 2 trades/session: ✗ (took 3)">${entry.review || ''}</textarea>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div class="card-title" style="margin-bottom:6px">Discipline Rating</div>
              <div class="rating-stars" id="ratingStars">
                ${[1,2,3,4,5].map(n => `<span class="star${n <= currentRating ? ' active' : ''}" data-n="${n}" onclick="JournalTab._setRating(${n})">⭐</span>`).join('')}
              </div>
            </div>
            <button class="btn-primary btn-sm" onclick="JournalTab._saveReview()">Save Review</button>
          </div>
        </div>

      </div>

      <!-- Trades today -->
      <div class="card mt-4">
        <div class="card-header">
          <div class="card-title">📋 Trades on ${selectedDate}</div>
          <button class="btn-ghost btn-sm" onclick="App.openTradeModal()">＋ Add Trade</button>
        </div>
        ${tradesTodayHtml(trades)}
      </div>
    `;
  }

  function tradesTodayHtml(trades) {
    if (!trades.length) return `<div class="empty-state" style="padding:30px"><div class="empty-icon">📭</div><p>No trades logged for this day.</p></div>`;
    return `<div class="table-wrap"><table>
      <thead><tr>
        <th>Symbol</th><th>Dir</th><th>Setup</th><th>Session</th>
        <th>Entry</th><th>Exit</th><th>P&L</th><th>R</th><th>Grade</th>
      </tr></thead>
      <tbody>
        ${trades.map(t => {
          const pl = t.result !== '' && t.result !== undefined ? parseFloat(t.result) : null;
          return `<tr>
            <td><strong>${t.symbol}</strong></td>
            <td>${t.direction === 'Long' ? '<span class="badge badge-green">▲ Long</span>' : '<span class="badge badge-red">▼ Short</span>'}</td>
            <td>${t.setupType || '—'}</td>
            <td>${t.session || '—'}</td>
            <td class="mono-num">${t.entry || '—'}</td>
            <td class="mono-num">${t.exitPrice || '—'}</td>
            <td class="${pl !== null ? (pl >= 0 ? 'text-green' : 'text-red') : ''} font-bold mono-num">${pl !== null ? (pl >= 0 ? '+' : '') + '$' + Math.abs(pl).toFixed(2) : '—'}</td>
            <td class="mono-num">${t.rMultiple !== '' && t.rMultiple !== undefined ? parseFloat(t.rMultiple).toFixed(2) + 'R' : '—'}</td>
            <td>${t.postGrade ? `<span class="badge badge-${t.postGrade === 'A' ? 'green' : t.postGrade === 'B' ? 'accent' : t.postGrade === 'C' ? 'orange' : 'red'}">${t.postGrade}</span>` : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  }

  return {
    render,
    _prevDay: () => {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() - 1);
      selectedDate = d.toISOString().slice(0, 10);
      render();
    },
    _nextDay: () => {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + 1);
      selectedDate = d.toISOString().slice(0, 10);
      render();
    },
    _today: () => {
      selectedDate = new Date().toISOString().slice(0, 10);
      render();
    },
    _setDate: (val) => { selectedDate = val; render(); },
    _setRating: (n) => {
      currentRating = n;
      document.querySelectorAll('.rating-stars .star').forEach(s => {
        s.classList.toggle('active', parseInt(s.dataset.n) <= n);
      });
    },
    _saveBias: () => {
      const bias = document.getElementById('jBias')?.value || '';
      DB.saveJournalEntry(selectedDate, { bias });
      App.toast('Pre-market bias saved');
    },
    _saveReview: () => {
      const review = document.getElementById('jReview')?.value || '';
      DB.saveJournalEntry(selectedDate, { review, rating: currentRating });
      App.toast('Review saved');
    }
  };
})();
