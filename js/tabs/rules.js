/* ═══════════════════════════════════════════════════════════
   RULES TAB
   Editable trading rules for scalp / swing / long-term
   + Daily Pre-Trade Checklist (checkbox panel, resets daily)
   + Red Flags reference panel
════════════════════════════════════════════════════════════ */
const RulesTab = (() => {

  let _draft = null;          // working copy of rules being edited
  let _checklistDraft = null; // working copy of today's checklist

  function load() {
    _draft = DB.getRules();
    _checklistDraft = DB.getChecklist();
  }

  function render() {
    load();
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Trading Rules <span class="badge badge-dim">your rulebook</span></div>
        <div style="display:flex;gap:8px">
          <button class="btn-ghost btn-sm" onclick="RulesTab._reset()">↺ Reset to defaults</button>
          <button class="btn-primary btn-sm" id="rulesSaveBtn" onclick="RulesTab._save()">💾 Save Changes</button>
        </div>
      </div>

      <div class="rules-layout">
        ${renderChecklist()}
        ${renderRedFlags()}
        ${renderRuleSet('scalp',    '⚡ Scalp Rules',     'Intraday positions held minutes to a few hours')}
        ${renderRuleSet('swing',    '🌊 Swing Rules',     'Multi-day positions held 1-5 days')}
        ${renderRuleSet('longterm', '🐢 Long-Term Rules', 'Macro positions held 1-4 weeks')}
      </div>
    `;
  }

  function renderChecklist() {
    const items = _checklistDraft.items;
    const done = items.filter(i => i.checked).length;
    const total = items.length;
    const pct = Math.round((done/total)*100);
    return `<div class="rules-panel rules-checklist">
      <div class="rules-panel-hdr">
        <div>
          <div class="rules-panel-title">📋 Daily Pre-Trade Checklist</div>
          <div class="rules-panel-sub">Run through every time you sit down. Resets at midnight.</div>
        </div>
        <div class="rules-checklist-progress">
          <div class="rules-progress-bar"><div class="rules-progress-fill" style="width:${pct}%"></div></div>
          <span>${done}/${total}</span>
        </div>
      </div>
      <div class="rules-checklist-items">
        ${items.map((item, i) => `
          <label class="rules-check-row${item.checked?' checked':''}">
            <input type="checkbox" ${item.checked?'checked':''} onchange="RulesTab._toggleCheck(${i})" />
            <span class="rules-check-num">${i+1}</span>
            <span class="rules-check-text">${item.text}</span>
          </label>
        `).join('')}
      </div>
    </div>`;
  }

  function renderRedFlags() {
    return `<div class="rules-panel rules-redflags">
      <div class="rules-panel-hdr">
        <div>
          <div class="rules-panel-title">🚫 When to NOT Trade — Red Flags</div>
          <div class="rules-panel-sub">If any of these are true, stand aside</div>
        </div>
      </div>
      <ul class="rules-redflag-list">
        ${(_draft.redFlags || []).map(f => `<li>⛔ ${f}</li>`).join('')}
      </ul>
    </div>`;
  }

  function renderRuleSet(key, title, sub) {
    const items = _draft[key] || [];
    return `<div class="rules-panel" data-set="${key}">
      <div class="rules-panel-hdr">
        <div>
          <div class="rules-panel-title">${title}</div>
          <div class="rules-panel-sub">${sub}</div>
        </div>
        <button class="btn-ghost btn-sm" onclick="RulesTab._addRule('${key}')">＋ Add Rule</button>
      </div>
      <div class="rules-list" id="rules-list-${key}">
        ${items.map((item, i) => ruleRow(key, item, i)).join('')}
      </div>
    </div>`;
  }

  function ruleRow(key, item, i) {
    return `<div class="rules-rule-row${item.enabled===false?' disabled':''}" data-key="${key}" data-idx="${i}">
      <input type="checkbox" ${item.enabled!==false?'checked':''} onchange="RulesTab._toggleRule('${key}',${i})" />
      <input type="text" class="rules-rule-input" value="${(item.text||'').replace(/"/g,'&quot;')}"
             oninput="RulesTab._editRule('${key}',${i},this.value)" placeholder="Type a rule…" />
      <button class="btn-icon" title="Delete" onclick="RulesTab._removeRule('${key}',${i})">🗑</button>
    </div>`;
  }

  function flashSaved() {
    const btn = document.getElementById('rulesSaveBtn');
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ Saved';
    btn.classList.add('saved');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('saved'); }, 1500);
  }

  return {
    render,
    _toggleCheck: i => {
      _checklistDraft.items[i].checked = !_checklistDraft.items[i].checked;
      DB.saveChecklist(_checklistDraft.items);
      render();
    },
    _toggleRule: (key, i) => {
      _draft[key][i].enabled = !(_draft[key][i].enabled !== false);
    },
    _editRule: (key, i, val) => {
      _draft[key][i].text = val;
    },
    _addRule: key => {
      _draft[key].push({ text: '', enabled: true });
      const el = document.getElementById(`rules-list-${key}`);
      if (el) el.insertAdjacentHTML('beforeend', ruleRow(key, _draft[key].at(-1), _draft[key].length-1));
      // Focus the new input
      setTimeout(() => {
        const inputs = document.querySelectorAll(`[data-set="${key}"] .rules-rule-input`);
        inputs[inputs.length-1]?.focus();
      }, 50);
    },
    _removeRule: (key, i) => {
      _draft[key].splice(i, 1);
      render();
    },
    _save: () => {
      // Strip empty rules
      ['scalp','swing','longterm'].forEach(k => {
        _draft[k] = (_draft[k]||[]).filter(r => r.text && r.text.trim());
      });
      DB.saveRules(_draft);
      App.toast('Rules saved');
      flashSaved();
    },
    _reset: () => {
      App.confirmDelete('Reset all rules back to the defaults? Your edits will be lost.', () => {
        DB.resetRules();
        App.toast('Rules reset to defaults');
        render();
      });
    },
  };
})();
