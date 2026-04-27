/* ═══════════════════════════════════════════════════════════
   GOALS TAB
════════════════════════════════════════════════════════════ */
const GoalsTab = (() => {

  function render() {
    const content = document.getElementById('content');
    const goals   = DB.getGoals();
    const trades  = DB.getTrades();
    const { curGreen, bestGreen, curLoss, bestLoss } = DB.streaks(trades);

    // Monthly P&L
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthTrades = trades.filter(t => t.date >= monthStart && t.result !== '' && t.result !== undefined);
    const monthPL = monthTrades.reduce((s, t) => s + parseFloat(t.result || 0), 0);
    const target  = parseFloat(goals.monthlyTarget) || 0;
    const progress = target > 0 ? Math.min((monthPL / target) * 100, 100) : 0;

    // Daily/monthly trade counts
    const todayStr = now.toISOString().slice(0, 10);
    const todayCount = trades.filter(t => t.date === todayStr).length;
    const monthCount = trades.filter(t => t.date >= monthStart).length;

    content.innerHTML = `
      <!-- Streak widgets -->
      <div class="streak-row">
        <div class="streak-widget green">
          <div class="streak-icon">🔥</div>
          <div class="streak-info">
            <div class="streak-val">${curGreen}</div>
            <div class="streak-label">Green Day Streak</div>
            <div class="text-xs text-sub">Best: ${bestGreen} days</div>
          </div>
        </div>
        <div class="streak-widget red">
          <div class="streak-icon">❄️</div>
          <div class="streak-info">
            <div class="streak-val">${curLoss}</div>
            <div class="streak-label">Losing Streak</div>
            <div class="text-xs text-sub">Worst: ${bestLoss} days</div>
          </div>
        </div>
        <div class="streak-widget ${todayCount >= goals.maxTradesDay ? 'red' : 'green'}">
          <div class="streak-icon">📊</div>
          <div class="streak-info">
            <div class="streak-val">${todayCount} / ${goals.maxTradesDay || '∞'}</div>
            <div class="streak-label">Trades Today</div>
            ${todayCount >= (goals.maxTradesDay || 999) ? '<div class="text-xs text-red">⚠️ Daily limit reached</div>' : ''}
          </div>
        </div>
        <div class="streak-widget ${monthCount >= goals.maxTradesMonth ? 'red' : 'green'}">
          <div class="streak-icon">📅</div>
          <div class="streak-info">
            <div class="streak-val">${monthCount} / ${goals.maxTradesMonth || '∞'}</div>
            <div class="streak-label">Trades This Month</div>
            ${monthCount >= (goals.maxTradesMonth || 999) ? '<div class="text-xs text-red">⚠️ Monthly limit reached</div>' : ''}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">

        <!-- Monthly P&L target -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">🎯 Monthly P&L Target</div>
            <button class="btn-ghost btn-sm" onclick="GoalsTab._editTarget()">Edit</button>
          </div>
          <div id="targetDisplay">
            <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">
              <span style="font-size:1.8rem;font-weight:800;color:${monthPL >= 0 ? 'var(--green)' : 'var(--red)'}">
                ${monthPL >= 0 ? '+$' : '-$'}${Math.abs(monthPL).toFixed(2)}
              </span>
              <span class="text-sub text-sm">of $${target.toFixed(0)} target</span>
            </div>
            <div class="progress-wrap" style="margin-bottom:8px">
              <div class="progress-bar ${monthPL >= 0 ? 'green' : 'red'}" style="width:${Math.max(0, progress).toFixed(1)}%"></div>
            </div>
            <div class="text-sm text-sub">${progress.toFixed(0)}% of monthly target${target === 0 ? ' — set a target to track progress' : ''}</div>
          </div>
          <div id="targetEdit" class="hidden" style="margin-top:12px">
            <div class="form-group">
              <label>Monthly Target ($)</label>
              <input type="number" id="targetVal" value="${target}" step="100" placeholder="e.g. 1000" />
            </div>
            <div class="form-group">
              <label>Max Trades/Day</label>
              <input type="number" id="maxDay" value="${goals.maxTradesDay || ''}" placeholder="e.g. 3" />
            </div>
            <div class="form-group">
              <label>Max Trades/Month</label>
              <input type="number" id="maxMonth" value="${goals.maxTradesMonth || ''}" placeholder="e.g. 30" />
            </div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn-primary btn-sm" onclick="GoalsTab._saveTarget()">Save</button>
              <button class="btn-ghost btn-sm" onclick="GoalsTab._cancelTarget()">Cancel</button>
            </div>
          </div>
        </div>

        <!-- Discipline rules -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">📏 Discipline Rules</div>
            <button class="btn-ghost btn-sm" onclick="GoalsTab._addRule()">＋ Add Rule</button>
          </div>
          <div id="rulesDisplay">
            ${(goals.disciplineRules || []).length === 0
              ? `<div class="empty-state" style="padding:20px"><div class="empty-icon">📋</div><p>Add your standing trading rules.</p></div>`
              : (goals.disciplineRules || []).map((rule, i) => `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-sub)">
                  <input type="checkbox" id="rule_${i}" ${rule.checkedToday ? 'checked' : ''} onchange="GoalsTab._checkRule(${i},this.checked)" style="accent-color:var(--accent)" />
                  <label for="rule_${i}" style="flex:1;font-size:.85rem;cursor:pointer;${rule.checkedToday ? 'text-decoration:line-through;color:var(--text-dim)' : ''}">${rule.label}</label>
                  <button class="btn-icon" onclick="GoalsTab._delRule(${i})">✕</button>
                </div>
              `).join('')
            }
          </div>
        </div>

        <!-- Coaching goals -->
        <div class="card" style="grid-column:1/-1">
          <div class="card-header">
            <div class="card-title">🧠 Improvement Goals</div>
            <button class="btn-ghost btn-sm" onclick="GoalsTab._addCoachGoal()">＋ Add Goal</button>
          </div>
          ${coachGoalsHtml(goals.coachGoals || [], trades)}
        </div>

      </div>
    `;
  }

  function coachGoalsHtml(cGoals, trades) {
    if (!cGoals.length) return `<div class="empty-state" style="padding:20px"><div class="empty-icon">🎯</div><p>Add a specific improvement goal (e.g. "Improve OTE win rate from 40% to 60% in 30 days").</p></div>`;

    return cGoals.map((g, i) => {
      // Compute current metric value
      let current = null;
      if (g.metric === 'win_rate') {
        const s = DB.calcStats(trades); current = s.winRate;
      } else if (g.metric === 'avg_r') {
        const s = DB.calcStats(trades); current = s.avgR;
      }

      const startVal = parseFloat(g.startValue) || 0;
      const targetVal = parseFloat(g.target) || 0;
      const progress  = current !== null && targetVal !== startVal
        ? Math.min(((current - startVal) / (targetVal - startVal)) * 100, 100) : 0;
      const color = progress >= 100 ? 'var(--green)' : progress >= 50 ? 'var(--accent)' : 'var(--orange)';

      return `
        <div style="padding:12px 0;border-bottom:1px solid var(--border-sub)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div>
              <div style="font-size:.88rem;font-weight:600">${g.label}</div>
              <div class="text-xs text-sub">Target: ${g.target} · Deadline: ${g.deadline || 'No deadline'}</div>
            </div>
            <button class="btn-icon" onclick="GoalsTab._delCoachGoal(${i})">✕</button>
          </div>
          <div class="progress-wrap">
            <div class="progress-bar" style="width:${Math.max(0, progress).toFixed(0)}%;background:${color}"></div>
          </div>
          <div class="text-xs text-sub" style="margin-top:4px">
            ${current !== null ? `Current: ${current.toFixed(1)} · ` : ''}${progress.toFixed(0)}% towards goal
          </div>
        </div>
      `;
    }).join('');
  }

  return {
    render,
    _editTarget: () => {
      document.getElementById('targetDisplay').classList.add('hidden');
      document.getElementById('targetEdit').classList.remove('hidden');
    },
    _cancelTarget: () => {
      document.getElementById('targetDisplay').classList.remove('hidden');
      document.getElementById('targetEdit').classList.add('hidden');
    },
    _saveTarget: () => {
      const g = DB.getGoals();
      DB.saveGoals({
        ...g,
        monthlyTarget: parseFloat(document.getElementById('targetVal')?.value) || 0,
        maxTradesDay:  parseInt(document.getElementById('maxDay')?.value) || 0,
        maxTradesMonth: parseInt(document.getElementById('maxMonth')?.value) || 0,
      });
      App.toast('Goals saved');
      render();
    },
    _addRule: () => {
      const label = prompt('Discipline rule (e.g. "No trades outside killzone"):');
      if (!label?.trim()) return;
      const g = DB.getGoals();
      const rules = [...(g.disciplineRules || []), { label: label.trim(), checkedToday: false }];
      DB.saveGoals({ ...g, disciplineRules: rules });
      App.toast('Rule added');
      render();
    },
    _checkRule: (i, val) => {
      const g = DB.getGoals();
      const rules = [...(g.disciplineRules || [])];
      if (rules[i]) rules[i] = { ...rules[i], checkedToday: val };
      DB.saveGoals({ ...g, disciplineRules: rules });
    },
    _delRule: i => {
      const g = DB.getGoals();
      const rules = (g.disciplineRules || []).filter((_, idx) => idx !== i);
      DB.saveGoals({ ...g, disciplineRules: rules });
      render();
    },
    _addCoachGoal: () => {
      const label  = prompt('Goal description (e.g. "Improve OTE win rate from 40% to 60%"):');
      if (!label?.trim()) return;
      const target = prompt('Target value (e.g. 60 for 60% win rate):');
      const deadline = prompt('Deadline (YYYY-MM-DD or blank):') || '';
      const g = DB.getGoals();
      const coachGoals = [...(g.coachGoals || []), {
        label: label.trim(), metric: 'win_rate',
        target: parseFloat(target) || 0, startValue: 0, deadline
      }];
      DB.saveGoals({ ...g, coachGoals });
      App.toast('Goal added');
      render();
    },
    _delCoachGoal: i => {
      const g = DB.getGoals();
      const coachGoals = (g.coachGoals || []).filter((_, idx) => idx !== i);
      DB.saveGoals({ ...g, coachGoals });
      render();
    }
  };
})();
