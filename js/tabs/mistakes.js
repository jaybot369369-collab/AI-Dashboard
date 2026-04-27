/* ═══════════════════════════════════════════════════════════
   MISTAKES / TENDENCIES TAB
════════════════════════════════════════════════════════════ */
const MistakesTab = (() => {

  function render() {
    const content   = document.getElementById('content');
    const mistakes  = DB.getMistakes();
    const allTrades = DB.getTrades();

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">⚠️ Mistakes / Tendencies <span class="badge badge-dim">${mistakes.length}</span></div>
        <div style="display:flex;gap:8px">
          <button class="btn-ghost btn-sm" onclick="MistakesTab._analyze()">🔍 Auto-Analyze My Trades</button>
          <button class="btn-ghost btn-sm" onclick="MistakesTab._add()">＋ Log Mistake</button>
        </div>
      </div>
      <p class="text-sub text-sm mb-4">Track recurring behavioural patterns. Claude cross-checks your trade log against these. Bump the counter each time a pattern repeats.</p>

      <div class="tendency-grid" id="mistakeGrid"></div>
    `;

    const grid = document.getElementById('mistakeGrid');
    if (!mistakes.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><p>No mistakes logged yet. Add one when you spot a recurring pattern.</p></div>`;
      return;
    }
    grid.innerHTML = mistakes
      .sort((a, b) => (b.seenCount || 0) - (a.seenCount || 0))
      .map(m => mistakeCard(m, allTrades)).join('');
  }

  function mistakeCard(m, allTrades) {
    const linked = allTrades.filter(t => (t.linkedMistakeIds || []).includes(m.id));
    return `
      <div class="tendency-card mistake" id="mc_${m.id}">
        <div id="mcv_${m.id}">
          <div class="tendency-title">${m.title}</div>
          <div class="tendency-desc">${m.description || ''}</div>
          <div class="tendency-meta">
            <div class="seen-counter">
              <button class="seen-bump" onclick="MistakesTab._bump('${m.id}')" title="Seen again">＋</button>
              <span>Seen <span class="seen-count">${m.seenCount || 1}×</span></span>
              ${m.lastSeen ? `<span class="text-dim">· last: ${m.lastSeen}</span>` : ''}
            </div>
            <div class="tendency-actions">
              <button class="btn-icon" onclick="MistakesTab._edit('${m.id}')" title="Edit">✏️</button>
              <button class="btn-icon" onclick="MistakesTab._del('${m.id}')" title="Delete">🗑</button>
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
        <div id="mce_${m.id}" class="hidden" style="display:none">
          <div class="form-group"><label>Title</label><input type="text" id="mt_${m.id}" value="${m.title}" /></div>
          <div class="form-group"><label>Description</label><textarea id="md_${m.id}" rows="3">${m.description || ''}</textarea></div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn-primary btn-sm" onclick="MistakesTab._save('${m.id}')">Save</button>
            <button class="btn-ghost btn-sm" onclick="MistakesTab._cancel('${m.id}')">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  return {
    render,
    _add: () => {
      const title = prompt('Mistake / tendency name:');
      if (!title?.trim()) return;
      const desc = prompt('Brief description (what triggers it?):') || '';
      DB.addMistake({ title: title.trim(), description: desc });
      App.toast('Mistake logged');
      render();
    },
    _bump: id => {
      DB.bumpMistake(id);
      const card = document.getElementById(`mc_${id}`);
      if (card) {
        const cnt = card.querySelector('.seen-count');
        const cur = parseInt(cnt?.textContent || '1');
        if (cnt) cnt.textContent = (cur + 1) + '×';
      }
      App.toast('Counter bumped');
    },
    _edit: id => {
      document.getElementById(`mcv_${id}`).style.display = 'none';
      const edit = document.getElementById(`mce_${id}`);
      edit.style.display = 'block';
      edit.classList.remove('hidden');
    },
    _cancel: id => {
      document.getElementById(`mcv_${id}`).style.display = '';
      document.getElementById(`mce_${id}`).style.display = 'none';
    },
    _save: id => {
      DB.updateMistake(id, {
        title: document.getElementById(`mt_${id}`)?.value || '',
        description: document.getElementById(`md_${id}`)?.value || '',
      });
      App.toast('Saved');
      render();
    },
    _del: id => {
      App.confirmDelete('Delete this mistake entry?', () => { DB.deleteMistake(id); render(); });
    },
    _analyze: () => {
      const { mistakes: detected } = DB.analyzePatterns(DB.getTrades());
      if (!detected.length) { App.toast('No patterns detected — log more trades first', 'error'); return; }
      const existingTitles = new Set(DB.getMistakes().map(m => m.title.toLowerCase()));
      let added = 0;
      detected.forEach(m => {
        if (existingTitles.has(m.title.toLowerCase())) return;
        DB.addMistake(m);
        added++;
      });
      App.toast(`${added} new pattern${added !== 1 ? 's' : ''} added (${detected.length - added} already exist)`);
      render();
    }
  };
})();
