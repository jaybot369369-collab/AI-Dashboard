/* ═══════════════════════════════════════════════════════════
   STRENGTHS / TENDENCIES TAB
════════════════════════════════════════════════════════════ */
const StrengthsTab = (() => {

  function render() {
    const content   = document.getElementById('content');
    const strengths = DB.getStrengths();
    const allTrades = DB.getTrades();

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">💪 Strengths / Tendencies <span class="badge badge-dim">${strengths.length}</span></div>
        <div style="display:flex;gap:8px">
          <button class="btn-ghost btn-sm" onclick="StrengthsTab._analyze()">🔍 Auto-Analyze My Trades</button>
          <button class="btn-ghost btn-sm" onclick="StrengthsTab._add()">＋ Log Strength</button>
        </div>
      </div>
      <p class="text-sub text-sm mb-4">Record positive behavioural patterns. Bump the counter when you repeat a good behaviour to reinforce it.</p>

      <div class="tendency-grid" id="strengthGrid"></div>
    `;

    const grid = document.getElementById('strengthGrid');
    if (!strengths.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🌱</div><p>No strengths logged yet. Add one when you catch yourself trading well.</p></div>`;
      return;
    }
    grid.innerHTML = strengths
      .sort((a, b) => (b.seenCount || 0) - (a.seenCount || 0))
      .map(s => strengthCard(s, allTrades)).join('');
  }

  function strengthCard(s, allTrades) {
    const linked = allTrades.filter(t => (t.linkedStrengthIds || []).includes(s.id));
    return `
      <div class="tendency-card strength" id="sc_${s.id}">
        <div id="scv_${s.id}">
          <div class="tendency-title">${s.title}</div>
          <div class="tendency-desc">${s.description || ''}</div>
          <div class="tendency-meta">
            <div class="seen-counter">
              <button class="seen-bump" onclick="StrengthsTab._bump('${s.id}')" title="Did this again">＋</button>
              <span>Done <span class="seen-count">${s.seenCount || 1}×</span></span>
              ${s.lastSeen ? `<span class="text-dim">· last: ${s.lastSeen}</span>` : ''}
            </div>
            <div class="tendency-actions">
              <button class="btn-icon" onclick="StrengthsTab._edit('${s.id}')" title="Edit">✏️</button>
              <button class="btn-icon" onclick="StrengthsTab._del('${s.id}')" title="Delete">🗑</button>
            </div>
          </div>
          ${linked.length ? `
            <div style="margin-top:10px;border-top:1px solid var(--border-sub);padding-top:8px">
              <div class="text-xs text-dim" style="margin-bottom:4px">LINKED TRADES (${linked.length})</div>
              ${linked.slice(0, 3).map(t => `<div class="text-xs text-sub">${t.date} · ${t.symbol} · ${t.direction}</div>`).join('')}
              ${linked.length > 3 ? `<div class="text-xs text-dim">+${linked.length - 3} more</div>` : ''}
            </div>
          ` : ''}
        </div>
        <div id="sce_${s.id}" style="display:none">
          <div class="form-group"><label>Title</label><input type="text" id="st_${s.id}" value="${s.title}" /></div>
          <div class="form-group"><label>Description</label><textarea id="sd_${s.id}" rows="3">${s.description || ''}</textarea></div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn-primary btn-sm" onclick="StrengthsTab._save('${s.id}')">Save</button>
            <button class="btn-ghost btn-sm" onclick="StrengthsTab._cancel('${s.id}')">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  return {
    render,
    _add: () => {
      const title = prompt('Strength / positive pattern name:');
      if (!title?.trim()) return;
      const desc = prompt('Describe when you do this well:') || '';
      DB.addStrength({ title: title.trim(), description: desc });
      App.toast('Strength logged');
      render();
    },
    _bump: id => {
      DB.bumpStrength(id);
      const card = document.getElementById(`sc_${id}`);
      if (card) {
        const cnt = card.querySelector('.seen-count');
        if (cnt) cnt.textContent = (parseInt(cnt.textContent) + 1) + '×';
      }
      App.toast('Counter bumped');
    },
    _edit: id => {
      document.getElementById(`scv_${id}`).style.display = 'none';
      document.getElementById(`sce_${id}`).style.display = 'block';
    },
    _cancel: id => {
      document.getElementById(`scv_${id}`).style.display = '';
      document.getElementById(`sce_${id}`).style.display = 'none';
    },
    _save: id => {
      DB.updateStrength(id, {
        title: document.getElementById(`st_${id}`)?.value || '',
        description: document.getElementById(`sd_${id}`)?.value || '',
      });
      App.toast('Saved');
      render();
    },
    _del: id => {
      App.confirmDelete('Delete this strength entry?', () => { DB.deleteStrength(id); render(); });
    },
    _analyze: () => {
      const { strengths: detected } = DB.analyzePatterns(DB.getTrades());
      if (!detected.length) { App.toast('No patterns detected — log more trades first', 'error'); return; }
      const existingTitles = new Set(DB.getStrengths().map(s => s.title.toLowerCase()));
      let added = 0;
      detected.forEach(s => {
        if (existingTitles.has(s.title.toLowerCase())) return;
        DB.addStrength(s);
        added++;
      });
      App.toast(`${added} new strength${added !== 1 ? 's' : ''} added (${detected.length - added} already exist)`);
      render();
    }
  };
})();
