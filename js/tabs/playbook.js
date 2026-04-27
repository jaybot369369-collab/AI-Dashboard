/* ═══════════════════════════════════════════════════════════
   PLAYBOOK TAB
════════════════════════════════════════════════════════════ */
const PlaybookTab = (() => {

  function render() {
    const content  = document.getElementById('content');
    const setups   = DB.recomputePlaybookStats();

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Playbook — Setup Catalogue</div>
        <button class="btn-ghost btn-sm" onclick="PlaybookTab._addSetup()">＋ Add Setup</button>
      </div>
      <div class="playbook-grid" id="playbookGrid"></div>
    `;

    document.getElementById('playbookGrid').innerHTML = setups.map(s => setupCard(s)).join('');
  }

  function setupCard(s) {
    const wr = s.winRate !== null ? s.winRate.toFixed(0) + '%' : '—';
    const wrColor = s.winRate !== null ? (s.winRate >= 50 ? 'var(--green)' : 'var(--red)') : 'var(--text-sub)';
    const ar = s.avgR !== null ? s.avgR.toFixed(2) + 'R' : '—';

    return `
      <div class="playbook-card" id="pb_${s.id}">
        <div class="playbook-card-header">
          <div class="playbook-card-name">${s.name}</div>
          <div style="display:flex;gap:6px">
            <button class="btn-icon" onclick="PlaybookTab._edit('${s.id}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="PlaybookTab._del('${s.id}')" title="Delete">🗑</button>
          </div>
        </div>

        <div id="pb_view_${s.id}">
          <div class="playbook-stats">
            <div class="playbook-stat">Win Rate: <strong style="color:${wrColor}">${wr}</strong></div>
            <div class="playbook-stat">Avg R: <strong>${ar}</strong></div>
            <div class="playbook-stat">Trades: <strong>${s.tradeCount}</strong></div>
          </div>

          <div class="playbook-rules" style="font-size:.78rem">
            <div style="margin-bottom:4px"><strong style="color:var(--text-sub);font-size:.68rem;text-transform:uppercase">Description</strong></div>
            <div>${s.description || '—'}</div>
          </div>
          <div class="playbook-rules" style="font-size:.78rem">
            <div style="margin-bottom:4px"><strong style="color:var(--text-sub);font-size:.68rem;text-transform:uppercase">Entry Rules</strong></div>
            <div>${s.entryRules || '—'}</div>
          </div>
          <div class="playbook-rules" style="font-size:.78rem">
            <div style="margin-bottom:4px"><strong style="color:var(--text-sub);font-size:.68rem;text-transform:uppercase">SL / TP</strong></div>
            <div>SL: ${s.slRules || '—'}</div>
            <div>TP: ${s.tpRules || '—'}</div>
          </div>

          ${s.screenshotUrl ? `<img src="${s.screenshotUrl}" style="width:100%;border-radius:6px;margin-bottom:10px" onerror="this.style.display='none'" />` : ''}

          <div style="border-top:1px solid var(--border-sub);padding-top:10px;margin-top:4px">
            <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;color:var(--text-sub);margin-bottom:8px">Pre-Trade Checklist</div>
            ${(s.checklist || []).map((item, i) => `
              <div class="checklist-item${item.checked ? ' checked' : ''}">
                <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="PlaybookTab._check('${s.id}',${i},this.checked)" />
                ${item.label}
              </div>
            `).join('')}
          </div>
        </div>

        <div id="pb_edit_${s.id}" class="hidden">
          ${editForm(s)}
        </div>
      </div>
    `;
  }

  function editForm(s) {
    const cl = (s.checklist || []).map((item, i) =>
      `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <input type="text" value="${item.label}" id="pb_cl_${s.id}_${i}" style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:4px;font-size:.8rem" />
        <button class="btn-icon" onclick="PlaybookTab._removeCheck('${s.id}',${i})">✕</button>
      </div>`
    ).join('');

    return `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="form-group"><label>Name</label><input type="text" id="pbe_name_${s.id}" value="${s.name}" /></div>
        <div class="form-group"><label>Description</label><textarea id="pbe_desc_${s.id}" rows="2">${s.description || ''}</textarea></div>
        <div class="form-group"><label>Entry Rules</label><textarea id="pbe_entry_${s.id}" rows="2">${s.entryRules || ''}</textarea></div>
        <div class="form-group"><label>SL Rules</label><input type="text" id="pbe_sl_${s.id}" value="${s.slRules || ''}" /></div>
        <div class="form-group"><label>TP Rules</label><input type="text" id="pbe_tp_${s.id}" value="${s.tpRules || ''}" /></div>
        <div class="form-group"><label>Screenshot URL</label><input type="url" id="pbe_ss_${s.id}" value="${s.screenshotUrl || ''}" /></div>
        <div>
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--text-sub);margin-bottom:6px">Checklist Items</div>
          <div id="pb_cllist_${s.id}">${cl}</div>
          <button class="btn-ghost btn-sm" onclick="PlaybookTab._addCheck('${s.id}')" style="margin-top:6px">＋ Add Item</button>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary btn-sm" onclick="PlaybookTab._save('${s.id}')">Save</button>
          <button class="btn-ghost btn-sm" onclick="PlaybookTab._cancelEdit('${s.id}')">Cancel</button>
        </div>
      </div>
    `;
  }

  return {
    render,
    _edit: id => {
      document.getElementById(`pb_view_${id}`)?.classList.add('hidden');
      document.getElementById(`pb_edit_${id}`)?.classList.remove('hidden');
    },
    _cancelEdit: id => {
      document.getElementById(`pb_view_${id}`)?.classList.remove('hidden');
      document.getElementById(`pb_edit_${id}`)?.classList.add('hidden');
    },
    _save: id => {
      const g = s => document.getElementById(`pbe_${s}_${id}`)?.value || '';
      const setup = DB.getPlaybook().find(s => s.id === id);
      if (!setup) return;
      const cl = (setup.checklist || []).map((item, i) => ({
        label: document.getElementById(`pb_cl_${id}_${i}`)?.value || item.label,
        checked: item.checked
      }));
      DB.updateSetup(id, {
        name: g('name'), description: g('desc'),
        entryRules: g('entry'), slRules: g('sl'), tpRules: g('tp'),
        screenshotUrl: g('ss'), checklist: cl
      });
      App.toast('Setup saved');
      render();
    },
    _check: (id, idx, val) => {
      const setup = DB.getPlaybook().find(s => s.id === id);
      if (!setup) return;
      const cl = [...(setup.checklist || [])];
      if (cl[idx]) cl[idx] = { ...cl[idx], checked: val };
      DB.updateSetup(id, { checklist: cl });
    },
    _addCheck: id => {
      const list = document.getElementById(`pb_cllist_${id}`);
      if (!list) return;
      const idx = list.children.length;
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px';
      div.innerHTML = `<input type="text" id="pb_cl_${id}_${idx}" placeholder="Checklist item…" style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:4px;font-size:.8rem" /><button class="btn-icon" onclick="PlaybookTab._removeCheck('${id}',${idx})">✕</button>`;
      list.appendChild(div);
    },
    _removeCheck: (id, idx) => {
      document.getElementById(`pb_cl_${id}_${idx}`)?.closest('div')?.remove();
    },
    _del: id => {
      App.confirmDelete('Delete this setup from the catalogue?', () => {
        DB.deleteSetup(id);
        App.toast('Setup deleted');
        render();
      });
    },
    _addSetup: () => {
      const name = prompt('Setup name:');
      if (!name?.trim()) return;
      DB.addSetup({ name: name.trim(), description: '', entryRules: '', slRules: '', tpRules: '', checklist: [], screenshotUrl: '' });
      render();
    }
  };
})();
