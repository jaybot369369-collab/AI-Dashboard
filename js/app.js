/* ═══════════════════════════════════════════════════════════
   JAYBOT DASHBOARD — app.js
   Router · Tab switcher · Global state · Theme · FAB
════════════════════════════════════════════════════════════ */

const App = (() => {

  /* ── State ───────────────────────────────────────────── */
  let currentTab    = 'dashboard';
  let dateRange     = '30';
  let dateFrom      = '';
  let dateTo        = '';
  let dataMode      = 'all';   // 'imported' | 'new' | 'all'
  let confirmCallback = null;

  // Pending trade-form state (reset each time modal opens)
  let _pendingScreenshots = [];  // array of data-URL / http URL strings
  let _pendingSetups      = [];  // array of setup name strings

  /* ── Cached DOM refs ─────────────────────────────────── */
  const $ = id => document.getElementById(id);

  /* ── Tab renderers map ───────────────────────────────── */
  const RENDERERS = {
    dashboard: () => DashboardTab.render(),
    tradelog:  () => TradeLogTab.render(),
    journal:   () => JournalTab.render(),
    analytics: () => AnalyticsTab.render(),
    watchlist: () => WatchlistTab.render(),
    playbook:  () => PlaybookTab.render(),
    mistakes:  () => MistakesTab.render(),
    strengths: () => StrengthsTab.render(),
    goals:     () => GoalsTab.render(),
    reports:   () => ReportsTab.render(),
    coach:     () => CoachTab.render(),
    dojo:      () => DojoTab.render(),
  };

  /* ══════════════════════════════════════════════════════
     NAVIGATION
  ══════════════════════════════════════════════════════ */
  function buildNav() {
    const nav  = $('sidebarNav');
    const tabs = DB.getTabs();
    nav.innerHTML = '';
    tabs.forEach(tab => {
      const item = document.createElement('div');
      item.className = `nav-item${tab.id === currentTab ? ' active' : ''}`;
      item.dataset.tab = tab.id;
      item.innerHTML = `
        <span class="icon">${tab.icon}</span>
        <span class="nav-label">${tab.label}</span>
        ${!tab.builtin ? `<button class="nav-item-delete btn-icon" data-id="${tab.id}" title="Remove tab">✕</button>` : ''}
      `;
      item.addEventListener('click', e => {
        if (e.target.closest('.nav-item-delete')) {
          e.stopPropagation();
          confirmDelete(`Remove the "${tab.label}" tab?`, () => {
            DB.deleteTab(tab.id);
            if (currentTab === tab.id) navigate('dashboard');
            else buildNav();
          });
          return;
        }
        navigate(tab.id);
      });
      nav.appendChild(item);
    });
  }

  function navigate(tabId) {
    currentTab = tabId;
    buildNav();
    renderTab(tabId);

    // Update page title
    const tab = DB.getTabs().find(t => t.id === tabId);
    if (tab) $('pageTitle').textContent = tab.label;

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.body.classList.remove('sidebar-overlay');
  }

  function renderTab(tabId) {
    const content = $('content');
    content.innerHTML = '';
    const renderer = RENDERERS[tabId];
    if (renderer) {
      renderer();
    } else {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">📌</div><p>Custom tab — add your own content.</p></div>`;
    }
  }

  /* ══════════════════════════════════════════════════════
     THEME
  ══════════════════════════════════════════════════════ */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    $('themeToggle').textContent = theme === 'dark' ? '🌙' : '☀️';
    DB.saveSettings({ theme });
  }

  /* ══════════════════════════════════════════════════════
     DATE FILTER
  ══════════════════════════════════════════════════════ */
  function getDateFilter() {
    return { range: dateRange, from: dateFrom, to: dateTo };
  }

  function getDataMode() { return dataMode; }

  function applyDateFilter(range) {
    dateRange = range;
    document.querySelectorAll('#dateFilter .date-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === range);
    });
    const customDiv = $('customDates');
    customDiv.classList.toggle('hidden', range !== 'custom');
    DB.saveSettings({ dateRange: range });
    renderTab(currentTab);
  }

  function applyDataMode(mode) {
    dataMode = mode;
    document.querySelectorAll('#dataModeFilter .date-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    DB.saveSettings({ dataMode: mode });
    renderTab(currentTab);
  }

  /* ══════════════════════════════════════════════════════
     TRADE MODAL
  ══════════════════════════════════════════════════════ */
  /* ── Screenshot helpers ─────────────────────────────── */
  function renderScreenshotPrev() {
    const el = $('fScreenshotPreview');
    if (!el) return;
    el.innerHTML = _pendingScreenshots.map((u, i) =>
      `<div class="screenshot-thumb">
        <img src="${u}" onerror="this.style.opacity=0.3" />
        <button type="button" class="thumb-remove" onclick="App._removeScreenshot(${i})">✕</button>
      </div>`
    ).join('');
  }

  function addScreenshotUrl(raw) {
    const urls = raw.split(/,(?=https?:|data:)/).map(s => s.trim()).filter(Boolean);
    urls.forEach(u => { if (!_pendingScreenshots.includes(u)) _pendingScreenshots.push(u); });
    renderScreenshotPrev();
  }

  /* ── Setup chip helpers ──────────────────────────────── */
  function renderSetupChips() {
    const el = $('fSetupChips');
    if (!el) return;
    el.innerHTML = _pendingSetups.map((s, i) =>
      `<span class="setup-chip">${s}<button type="button" class="chip-rm" onclick="App._removeSetup(${i})">✕</button></span>`
    ).join('');
  }

  function addSetup(name) {
    if (!name || name === '__custom__') return;
    if (!_pendingSetups.includes(name)) {
      _pendingSetups.push(name);
      renderSetupChips();
    }
  }

  function openTradeModal(editId) {
    const modal = $('tradeModal');
    const form  = $('tradeForm');
    form.reset();

    // Reset pending state
    _pendingScreenshots = [];
    _pendingSetups      = [];

    // Populate setup picker from playbook
    const picker = $('fSetupPicker');
    if (picker) {
      picker.innerHTML = '<option value="">— select setup —</option>';
      DB.getSetupNames().forEach(name => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = name;
        picker.appendChild(opt);
      });
      const customOpt = document.createElement('option');
      customOpt.value = '__custom__'; customOpt.textContent = '＋ Custom setup name…';
      picker.appendChild(customOpt);
      picker.onchange = () => {
        $('fSetupCustomGroup').classList.toggle('hidden', picker.value !== '__custom__');
      };
    }
    $('fSetupCustomGroup').classList.add('hidden');
    $('fSetupCustom').value = '';
    renderSetupChips();

    // Wire setup Add buttons (re-wire each open to avoid stale closures)
    const setupAddBtn = $('fSetupAdd');
    const customAddBtn = $('fSetupCustomAdd');
    if (setupAddBtn) {
      setupAddBtn.onclick = () => {
        const v = picker ? picker.value : '';
        if (v === '__custom__') {
          $('fSetupCustomGroup').classList.remove('hidden');
          $('fSetupCustom').focus();
        } else {
          addSetup(v);
        }
      };
    }
    if (customAddBtn) {
      customAddBtn.onclick = () => {
        const v = $('fSetupCustom').value.trim();
        if (v) { addSetup(v); $('fSetupCustom').value = ''; $('fSetupCustomGroup').classList.add('hidden'); }
      };
    }

    // Wire URL paste input → add to screenshot array on blur / Enter
    const urlEl = $('fScreenshotUrl');
    if (urlEl) {
      urlEl._wired = false; // always re-wire
      const commitUrl = () => {
        const v = urlEl.value.trim();
        if (v) { addScreenshotUrl(v); urlEl.value = ''; }
      };
      urlEl.onblur = commitUrl;
      urlEl.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); commitUrl(); } };
    }
    renderScreenshotPrev();

    // Default date to today
    $('fDate').value = new Date().toISOString().slice(0, 10);

    if (editId) {
      $('tradeModalTitle').textContent = 'Edit Trade';
      $('tradeId').value = editId;
      const t = DB.getTradeById(editId);
      if (t) populateTradeForm(t);
    } else {
      $('tradeModalTitle').textContent = 'New Trade';
      $('tradeId').value = '';
    }
    modal.classList.remove('hidden');
  }

  function populateTradeForm(t) {
    const fields = {
      fSymbol: t.symbol, fDirection: t.direction,
      fEntry: t.entry, fSl: t.sl, fTp: t.tp, fSize: t.size,
      fSession: t.session, fHtfBias: t.htfBias,
      fPreGrade: t.preGrade, fPreGradeNotes: t.preGradeNotes,
      fExitPrice: t.exitPrice, fResult: t.result, fRMultiple: t.rMultiple,
      fPostGrade: t.postGrade, fPostGradeNotes: t.postGradeNotes,
      fNotes: t.notes, fDate: t.date, fDateEnd: t.dateEnd || '',
    };
    Object.entries(fields).forEach(([id, val]) => {
      const el = $(id);
      if (el && val !== undefined && val !== null) el.value = val;
    });
    // Load setup chips
    _pendingSetups = t.setupTypes || (t.setupType ? [t.setupType] : []);
    renderSetupChips();
    // Load screenshots
    _pendingScreenshots = DB.getScreenshots(t);
    renderScreenshotPrev();
  }

  function closeTradeModal() {
    $('tradeModal').classList.add('hidden');
  }

  function saveTradeForm() {
    const f = id => $(id)?.value?.trim() ?? '';
    const sym = f('fSymbol') === 'custom' ? f('fSymbolCustom') : f('fSymbol');

    // Also commit any URL still typed in the box
    const urlEl = $('fScreenshotUrl');
    if (urlEl && urlEl.value.trim()) {
      addScreenshotUrl(urlEl.value.trim());
      urlEl.value = '';
    }

    const setupTypes = [..._pendingSetups];
    const setupType  = setupTypes[0] || '';   // keep backward-compat single field

    // Auto-compute R if entry+sl+exitPrice given but rMultiple empty
    let rMultiple = f('fRMultiple');
    if (!rMultiple && f('fEntry') && f('fSl') && f('fExitPrice')) {
      const entry = parseFloat(f('fEntry')), sl = parseFloat(f('fSl'));
      const exit  = parseFloat(f('fExitPrice'));
      const risk  = Math.abs(entry - sl);
      if (risk > 0) rMultiple = (((exit - entry) / risk) * (f('fDirection') === 'Long' ? 1 : -1)).toFixed(2);
    }

    const data = {
      symbol: sym, direction: f('fDirection'),
      entry: f('fEntry'), sl: f('fSl'), tp: f('fTp'), size: f('fSize'),
      session: f('fSession'), htfBias: f('fHtfBias'),
      setupType, setupTypes,
      dateEnd: f('fDateEnd') || window._jb_pendingEndDate || '',
      preGrade: f('fPreGrade'), preGradeNotes: f('fPreGradeNotes'),
      exitPrice: f('fExitPrice'), result: f('fResult'), rMultiple,
      postGrade: f('fPostGrade'), postGradeNotes: f('fPostGradeNotes'),
      notes: f('fNotes'),
      screenshotUrls: [..._pendingScreenshots],
      screenshotUrl: '',   // clear legacy field on save
      date: f('fDate'),
    };

    const editId = f('tradeId');
    if (editId) {
      DB.updateTrade(editId, data);
      toast('Trade updated');
    } else {
      DB.addTrade(data);
      toast('Trade saved');
    }
    window._jb_pendingEndDate = '';
    closeTradeModal();
    DB.recomputePlaybookStats();
    renderTab(currentTab);
  }

  /* ══════════════════════════════════════════════════════
     ADD TAB MODAL
  ══════════════════════════════════════════════════════ */
  function openAddTabModal() {
    $('newTabName').value = '';
    $('newTabIcon').value = '';
    $('addTabModal').classList.remove('hidden');
    $('newTabName').focus();
  }
  function closeAddTabModal() { $('addTabModal').classList.add('hidden'); }
  function confirmAddTab() {
    const name = $('newTabName').value.trim();
    const icon = $('newTabIcon').value.trim();
    if (!name) { toast('Enter a tab name', 'error'); return; }
    DB.addTab(name, icon);
    closeAddTabModal();
    buildNav();
    toast(`"${name}" tab added`);
  }

  /* ══════════════════════════════════════════════════════
     CONFIRM MODAL
  ══════════════════════════════════════════════════════ */
  function confirmDelete(message, cb) {
    $('confirmMessage').textContent = message;
    confirmCallback = cb;
    $('confirmModal').classList.remove('hidden');
  }
  function closeConfirmModal() {
    $('confirmModal').classList.add('hidden');
    confirmCallback = null;
  }

  /* ══════════════════════════════════════════════════════
     SIDEBAR TOGGLE
  ══════════════════════════════════════════════════════ */
  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed');
  }

  /* ══════════════════════════════════════════════════════
     TOAST
  ══════════════════════════════════════════════════════ */
  function toast(msg, type = 'success') {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast ${type}`;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
  }

  /* ══════════════════════════════════════════════════════
     EXPORT / IMPORT
  ══════════════════════════════════════════════════════ */
  function handleImport(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      try {
        // Try JSON first
        if (file.name.endsWith('.json')) {
          DB.importJSON(text);
          toast('Backup restored');
          renderTab(currentTab);
          return;
        }
        // CSV import
        const { format, trades } = DB.autoParseCSV(text);
        if (!trades.length) { toast('No trades found in file', 'error'); return; }
        const { added, skipped } = DB.mergeImportedTrades(trades);
        DB.recomputePlaybookStats();
        toast(`${format}: ${added} trades imported, ${skipped} duplicates skipped`);
        renderTab(currentTab);
      } catch (err) {
        toast('Import failed: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  /* ══════════════════════════════════════════════════════
     INIT — wire up all events
  ══════════════════════════════════════════════════════ */
  /* ══════════════════════════════════════════════════════
     FIRST-RUN SEED — auto-load historical trades if empty
  ══════════════════════════════════════════════════════ */
  async function autoSeedIfEmpty() {
    try {
      const existing = JSON.parse(localStorage.getItem('jb_trades') || '[]');
      if (existing.length > 0) return; // already have trades; do nothing
      const res = await fetch('assets/seed_trades.json');
      if (!res.ok) return;
      const trades = await res.json();
      if (Array.isArray(trades) && trades.length) {
        localStorage.setItem('jb_trades', JSON.stringify(trades));
        console.log(`[JayBot] Auto-seeded ${trades.length} trades on first visit`);
      }
    } catch (e) {
      console.warn('[JayBot] Auto-seed skipped:', e.message);
    }
  }

  async function init() {
    // First-run: load seed data if localStorage is empty
    await autoSeedIfEmpty();

    // Apply saved settings
    const s = DB.getSettings();
    applyTheme(s.theme);
    dateRange = s.dateRange || '30';
    dataMode  = s.dataMode  || 'all';
    document.querySelectorAll('#dateFilter .date-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === dateRange);
    });
    document.querySelectorAll('#dataModeFilter .date-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === dataMode);
    });

    // Monkey-patch DB.getTrades for tab consumers — applies the data-mode filter
    // automatically. Internal CRUD inside data.js uses the closure-bound original
    // getTrades, so writes still see all trades (read-side filter only).
    const _origGetTrades = DB.getTrades;
    DB.getTradesRaw = _origGetTrades;
    DB.getTrades    = () => DB.filterByMode(_origGetTrades(), dataMode);

    // Build nav and render default tab
    buildNav();
    navigate('dashboard');

    // Theme toggle
    $('themeToggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    });

    // Privacy toggle (eye button) — hides all dollar values
    const applyPrivacy = on => {
      document.body.classList.toggle('privacy-mode', on);
      const btn = $('privacyToggle');
      btn.textContent = on ? '🙈' : '👁';
      btn.classList.toggle('active', on);
      btn.title = on ? 'Show balances' : 'Hide all balances';
      DB.saveSettings({ privacy: on });
    };
    applyPrivacy(!!s.privacy);
    $('privacyToggle').addEventListener('click', () => {
      applyPrivacy(!document.body.classList.contains('privacy-mode'));
    });

    // Sidebar toggles
    $('sidebarToggle').addEventListener('click', toggleSidebar);
    $('hamburger').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('mobile-open');
    });

    // Date range
    document.querySelectorAll('#dateFilter .date-btn').forEach(btn => {
      btn.addEventListener('click', () => applyDateFilter(btn.dataset.range));
    });

    // Data mode toggle (Past / New / Both)
    document.querySelectorAll('#dataModeFilter .date-btn').forEach(btn => {
      btn.addEventListener('click', () => applyDataMode(btn.dataset.mode));
    });
    $('dateFrom').addEventListener('change', e => { dateFrom = e.target.value; if (dateRange === 'custom') renderTab(currentTab); });
    $('dateTo').addEventListener('change', e => { dateTo = e.target.value; if (dateRange === 'custom') renderTab(currentTab); });

    // FAB + sidebar new trade button
    $('fab').addEventListener('click', () => openTradeModal());
    $('sidebarNewTrade').addEventListener('click', () => openTradeModal());

    // Trade modal
    $('tradeModalClose').addEventListener('click', closeTradeModal);
    $('tradeFormCancel').addEventListener('click', closeTradeModal);
    $('tradeFormSave').addEventListener('click', saveTradeForm);
    $('tradeModal').addEventListener('click', e => { if (e.target === $('tradeModal')) closeTradeModal(); });

    // Symbol custom field toggle
    $('fSymbol').addEventListener('change', e => {
      $('fSymbolCustomGroup').classList.toggle('hidden', e.target.value !== 'custom');
    });

    // Add tab modal
    $('addTabBtn').addEventListener('click', openAddTabModal);
    $('addTabClose').addEventListener('click', closeAddTabModal);
    $('addTabCancel').addEventListener('click', closeAddTabModal);
    $('addTabConfirm').addEventListener('click', confirmAddTab);
    $('addTabModal').addEventListener('click', e => { if (e.target === $('addTabModal')) closeAddTabModal(); });
    $('newTabName').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAddTab(); });

    // Confirm modal
    $('confirmClose').addEventListener('click', closeConfirmModal);
    $('confirmCancel').addEventListener('click', closeConfirmModal);
    $('confirmOk').addEventListener('click', () => {
      if (confirmCallback) confirmCallback();
      closeConfirmModal();
    });

    // Export
    $('exportBtn').addEventListener('click', () => { DB.exportJSON(); toast('Backup exported'); });

    // Import (JSON or CSV)
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) { handleImport(file); e.target.value = ''; }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeTradeModal();
        closeAddTabModal();
        closeConfirmModal();
      }
      // Ctrl/Cmd + N = new trade
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        openTradeModal();
      }
    });
  }

  /* ── Public API ──────────────────────────────────────── */
  return {
    init,
    navigate,
    getDateFilter,
    getDataMode,
    _handleScreenshotFiles: (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      let pending = files.length;
      const newUrls = [];
      files.forEach((f, idx) => {
        if (f.size > 4 * 1024 * 1024) {
          toast(`${f.name} too large (max 4 MB)`, 'error');
          if (--pending === 0) finish();
          return;
        }
        const reader = new FileReader();
        reader.onload = ev => {
          newUrls[idx] = ev.target.result;
          if (--pending === 0) finish();
        };
        reader.readAsDataURL(f);
      });
      function finish() {
        const filtered = newUrls.filter(Boolean);
        filtered.forEach(u => { if (!_pendingScreenshots.includes(u)) _pendingScreenshots.push(u); });
        renderScreenshotPrev();
        toast(`${filtered.length} image${filtered.length !== 1 ? 's' : ''} attached`);
        e.target.value = '';
      }
    },
    _removeScreenshot: (idx) => {
      _pendingScreenshots.splice(idx, 1);
      renderScreenshotPrev();
    },
    _removeSetup: (idx) => {
      _pendingSetups.splice(idx, 1);
      renderSetupChips();
    },
    openTradeModal,
    closeTradeModal,
    confirmDelete,
    toast,
    buildNav,
    renderTab,
  };

})();

/* ── Boot ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', App.init);
