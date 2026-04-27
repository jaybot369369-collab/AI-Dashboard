/* ═══════════════════════════════════════════════════════════
   JAYBOT DASHBOARD — data.js
   CRUD layer on localStorage + CSV/XLSX parsers for:
     1. Notion journal CSV  (_all.csv format)
     2. Binance Transaction History CSV
     3. Binance Spot Order History (save as CSV from XLSX)
════════════════════════════════════════════════════════════ */

const DB = (() => {

  /* ── Storage keys ────────────────────────────────────── */
  const KEYS = {
    trades:   'jb_trades',
    journal:  'jb_journal',
    watch:    'jb_watchlist',
    play:     'jb_playbook',
    mistakes: 'jb_mistakes',
    strength: 'jb_strengths',
    goals:    'jb_goals',
    coachLog: 'jb_coach_log',
    tabs:     'jb_tabs',
    settings: 'jb_settings',
  };

  /* ── Core helpers ────────────────────────────────────── */
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; }
    catch { return null; }
  }
  function save(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ── Settings ────────────────────────────────────────── */
  function getSettings() {
    return load(KEYS.settings) || { theme: 'dark', dateRange: '30' };
  }
  function saveSettings(patch) {
    save(KEYS.settings, { ...getSettings(), ...patch });
  }

  /* ── Tabs ────────────────────────────────────────────── */
  const DEFAULT_TABS = [
    { id: 'dashboard',  label: 'Dashboard',       icon: '📊', builtin: true },
    { id: 'tradelog',   label: 'Trade Log',        icon: '📋', builtin: true },
    { id: 'journal',    label: 'Journal',          icon: '📝', builtin: true },
    { id: 'analytics',  label: 'Analytics',        icon: '📈', builtin: true },
    { id: 'watchlist',  label: 'Watchlist',        icon: '👁', builtin: true },
    { id: 'playbook',   label: 'Playbook',         icon: '📖', builtin: true },
    { id: 'mistakes',   label: 'Mistakes',         icon: '⚠️', builtin: true },
    { id: 'strengths',  label: 'Strengths',        icon: '💪', builtin: true },
    { id: 'goals',      label: 'Goals',            icon: '🎯', builtin: true },
    { id: 'reports',    label: 'Reports',          icon: '📑', builtin: true },
    { id: 'coach',      label: 'Perf Coach',       icon: '🧠', builtin: true },
  ];
  function getTabs() {
    return load(KEYS.tabs) || DEFAULT_TABS;
  }
  function saveTabs(tabs) { save(KEYS.tabs, tabs); }
  function addTab(label, icon) {
    const tabs = getTabs();
    const id = 'custom_' + uid();
    tabs.push({ id, label, icon: icon || '📌', builtin: false });
    saveTabs(tabs);
    return id;
  }
  function deleteTab(id) {
    const tabs = getTabs().filter(t => t.id !== id);
    saveTabs(tabs);
  }

  /* ══════════════════════════════════════════════════════
     TRADES
  ══════════════════════════════════════════════════════ */
  function getTrades() { return load(KEYS.trades) || []; }
  function saveTrades(arr) { save(KEYS.trades, arr); }

  function addTrade(t) {
    const trades = getTrades();
    const trade = { id: uid(), createdAt: new Date().toISOString(), source: 'manual', ...t };
    trades.push(trade);
    saveTrades(trades);
    return trade;
  }
  function updateTrade(id, patch) {
    const trades = getTrades().map(t => t.id === id ? { ...t, ...patch } : t);
    saveTrades(trades);
  }
  function deleteTrade(id) {
    saveTrades(getTrades().filter(t => t.id !== id));
  }
  function getTradeById(id) {
    return getTrades().find(t => t.id === id);
  }

  /* Filter trades by data source mode: 'imported' | 'new' | 'all' */
  function filterByMode(trades, mode) {
    if (!mode || mode === 'all') return trades;
    if (mode === 'new')      return trades.filter(t => !t.source || t.source === 'manual');
    if (mode === 'imported') return trades.filter(t => t.source && t.source !== 'manual');
    return trades;
  }

  /* Filter trades by global date range */
  function filterByRange(trades, rangeStr, from, to) {
    const now = new Date();
    let cutoff = null;
    if (rangeStr === 'custom' && from && to) {
      const f = new Date(from), t2 = new Date(to);
      return trades.filter(tr => {
        const d = new Date(tr.date);
        return d >= f && d <= t2;
      });
    }
    const days = parseInt(rangeStr) || 30;
    cutoff = new Date(now.getTime() - days * 86400000);
    return trades.filter(tr => new Date(tr.date) >= cutoff);
  }

  /* ── Stats helpers ───────────────────────────────────── */
  function calcStats(trades) {
    const closed = trades.filter(t => t.result !== undefined && t.result !== null && t.result !== '');
    const wins   = closed.filter(t => parseFloat(t.result) > 0);
    const losses = closed.filter(t => parseFloat(t.result) < 0);
    const totalPL = closed.reduce((s, t) => s + parseFloat(t.result || 0), 0);
    const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
    const avgR    = closed.length ? closed.reduce((s, t) => s + parseFloat(t.rMultiple || 0), 0) / closed.length : 0;

    // Max drawdown
    let peak = 0, equity = 0, maxDD = 0;
    closed.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(t => {
      equity += parseFloat(t.result || 0);
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    });

    return { total: trades.length, closed: closed.length, wins: wins.length, losses: losses.length,
             totalPL, winRate, avgR, maxDD };
  }

  /* Daily P&L map: { 'YYYY-MM-DD': number }
     Multi-day trades (with dateEnd) attribute their P&L to the close date. */
  function dailyPLMap(trades) {
    const map = {};
    trades.forEach(t => {
      if (t.result === undefined || t.result === null || t.result === '') return;
      const d = (t.dateEnd || t.date || '').slice(0, 10);
      if (!d) return;
      map[d] = (map[d] || 0) + parseFloat(t.result);
    });
    return map;
  }

  /* Equity curve: sorted array of { date, equity } */
  function equityCurve(trades) {
    const sorted = [...trades]
      .filter(t => t.result !== undefined && t.result !== null && t.result !== '')
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    let eq = 0;
    return sorted.map(t => ({ date: t.date.slice(0, 10), equity: (eq += parseFloat(t.result || 0)) }));
  }

  /* Win rate by setup type */
  function winRateBySetup(trades) {
    const map = {};
    trades.filter(t => t.setupType && t.result !== undefined && t.result !== '').forEach(t => {
      if (!map[t.setupType]) map[t.setupType] = { wins: 0, total: 0 };
      map[t.setupType].total++;
      if (parseFloat(t.result) > 0) map[t.setupType].wins++;
    });
    return Object.entries(map).map(([label, v]) => ({
      label, winRate: v.total ? (v.wins / v.total) * 100 : 0, total: v.total
    }));
  }

  /* Performance by session */
  function performanceBySession(trades) {
    const map = {};
    trades.filter(t => t.session && t.result !== undefined && t.result !== '').forEach(t => {
      if (!map[t.session]) map[t.session] = { wins: 0, total: 0, totalR: 0 };
      map[t.session].total++;
      const r = parseFloat(t.rMultiple || 0);
      map[t.session].totalR += r;
      if (parseFloat(t.result) > 0) map[t.session].wins++;
    });
    return Object.entries(map).map(([label, v]) => ({
      label,
      winRate: v.total ? (v.wins / v.total) * 100 : 0,
      avgR: v.total ? v.totalR / v.total : 0,
      total: v.total
    }));
  }

  /* R distribution */
  function rDistribution(trades) {
    const buckets = { '-3+': 0, '-2': 0, '-1': 0, '0': 0, '0.5': 0, '1': 0, '2': 0, '3+': 0 };
    trades.filter(t => t.rMultiple !== undefined && t.rMultiple !== '').forEach(t => {
      const r = parseFloat(t.rMultiple);
      if (r <= -3)      buckets['-3+']++;
      else if (r <= -2) buckets['-2']++;
      else if (r <= -1) buckets['-1']++;
      else if (r < 0.3) buckets['0']++;
      else if (r < 1.5) buckets['1']++;
      else if (r < 2.5) buckets['2']++;
      else              buckets['3+']++;
    });
    return buckets;
  }

  /* Streak calculations */
  function streaks(trades) {
    const sorted = [...trades]
      .filter(t => t.result !== undefined && t.result !== null && t.result !== '')
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Group by day
    const days = {};
    sorted.forEach(t => {
      const d = t.date.slice(0, 10);
      days[d] = (days[d] || 0) + parseFloat(t.result);
    });
    const dayArr = Object.entries(days).sort(([a], [b]) => new Date(a) - new Date(b));

    let curGreen = 0, bestGreen = 0, curLoss = 0, bestLoss = 0;
    dayArr.forEach(([, pnl]) => {
      if (pnl > 0) { curGreen++; curLoss = 0; }
      else if (pnl < 0) { curLoss++; curGreen = 0; }
      else { curGreen = 0; curLoss = 0; }
      if (curGreen > bestGreen) bestGreen = curGreen;
      if (curLoss > bestLoss)  bestLoss = curLoss;
    });
    return { curGreen, bestGreen, curLoss, bestLoss };
  }

  /* ══════════════════════════════════════════════════════
     AUTO-ANALYSIS — detect mistake & strength patterns
  ══════════════════════════════════════════════════════ */
  function analyzePatterns(trades) {
    const mistakes = [];
    const strengths = [];
    const closed = trades.filter(t => t.result !== '' && t.result !== undefined && t.result !== null);
    if (!closed.length) return { mistakes, strengths };

    const totalCount = closed.length;
    const wins   = closed.filter(t => parseFloat(t.result) > 0);
    const losses = closed.filter(t => parseFloat(t.result) < 0);
    const overallWR = (wins.length / totalCount) * 100;

    const idsOf = arr => arr.map(t => t.id).filter(Boolean);

    // ── MISTAKE PATTERNS ─────────────────────────────────
    // 1. Worst session
    const bySession = {};
    closed.forEach(t => {
      const k = t.session || 'unspecified';
      if (!bySession[k]) bySession[k] = [];
      bySession[k].push(t);
    });
    Object.entries(bySession).forEach(([s, arr]) => {
      if (s === 'unspecified' || arr.length < 5) return;
      const w = arr.filter(t => parseFloat(t.result) > 0).length;
      const wr = (w / arr.length) * 100;
      if (wr < overallWR - 10) {
        mistakes.push({
          title: `${s} session underperforms`,
          description: `${arr.length} trades · ${wr.toFixed(0)}% win rate vs ${overallWR.toFixed(0)}% overall. Consider sitting out this session or tightening criteria.`,
          seenCount: arr.length, lastSeen: arr.slice(-1)[0]?.date,
          linkedTradeIds: idsOf(arr.filter(t => parseFloat(t.result) < 0)).slice(0, 10),
        });
      }
    });

    // 2. Worst setup type
    const bySetup = {};
    closed.forEach(t => {
      const k = t.setupType || 'unspecified';
      if (!bySetup[k]) bySetup[k] = [];
      bySetup[k].push(t);
    });
    Object.entries(bySetup).forEach(([s, arr]) => {
      if (s === 'unspecified' || arr.length < 5) return;
      const w = arr.filter(t => parseFloat(t.result) > 0).length;
      const wr = (w / arr.length) * 100;
      if (wr < 35) {
        mistakes.push({
          title: `${s} setup is bleeding capital`,
          description: `${arr.length} trades · ${wr.toFixed(0)}% win rate. Below the 35% break-even threshold. Review criteria or stop trading this setup.`,
          seenCount: arr.length, lastSeen: arr.slice(-1)[0]?.date,
          linkedTradeIds: idsOf(arr.filter(t => parseFloat(t.result) < 0)).slice(0, 10),
        });
      }
    });

    // 3. Same-day re-entry after a loss (revenge trade)
    const sorted = [...closed].sort((a, b) => new Date(a.date) - new Date(b.date));
    const revenge = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i];
      if (prev.date === cur.date && parseFloat(prev.result) < 0) {
        revenge.push(cur);
      }
    }
    if (revenge.length >= 3) {
      mistakes.push({
        title: 'Revenge trading after a loss',
        description: `${revenge.length} trades opened on the same day directly after a loss. Take a break after a red trade — emotion-driven entries are usually low-quality.`,
        seenCount: revenge.length, lastSeen: revenge.slice(-1)[0]?.date,
        linkedTradeIds: idsOf(revenge).slice(0, 10),
      });
    }

    // 4. Trades against HTF bias
    const violations = closed.filter(t => {
      if (!t.htfBias || !t.direction) return false;
      const longBull = t.direction === 'Long'  && t.htfBias === 'Bearish';
      const shortBear = t.direction === 'Short' && t.htfBias === 'Bullish';
      return longBull || shortBear;
    });
    if (violations.length >= 3) {
      const violLosses = violations.filter(t => parseFloat(t.result) < 0).length;
      mistakes.push({
        title: 'Trading against HTF bias',
        description: `${violations.length} trades taken counter to your logged HTF bias (${violLosses} losses). When the higher timeframe disagrees, the setup is fighting the trend.`,
        seenCount: violations.length, lastSeen: violations.slice(-1)[0]?.date,
        linkedTradeIds: idsOf(violations).slice(0, 10),
      });
    }

    // 5. Largest losses
    const bigLosses = closed
      .filter(t => parseFloat(t.result) < 0)
      .sort((a, b) => parseFloat(a.result) - parseFloat(b.result))
      .slice(0, 5);
    if (bigLosses.length) {
      const totalBigLoss = bigLosses.reduce((s, t) => s + parseFloat(t.result), 0);
      mistakes.push({
        title: 'Outsized single-trade losses',
        description: `Top 5 worst trades cost $${Math.abs(totalBigLoss).toFixed(0)}. Tighten stops or reduce size — one blow-up undoes weeks of small wins.`,
        seenCount: bigLosses.length, lastSeen: bigLosses[0]?.date,
        linkedTradeIds: idsOf(bigLosses),
      });
    }

    // 6. Overtrading days (more than 5 trades on a day)
    const tradesByDay = {};
    closed.forEach(t => { tradesByDay[t.date] = (tradesByDay[t.date] || 0) + 1; });
    const heavyDays = Object.entries(tradesByDay).filter(([, n]) => n >= 5);
    if (heavyDays.length >= 2) {
      mistakes.push({
        title: 'Overtrading on volatile days',
        description: `${heavyDays.length} days had 5+ trades. High frequency days correlate with poor decision quality — set a hard daily cap.`,
        seenCount: heavyDays.length, lastSeen: heavyDays.slice(-1)[0]?.[0],
        linkedTradeIds: [],
      });
    }

    // ── STRENGTH PATTERNS ────────────────────────────────
    // 1. Best session
    Object.entries(bySession).forEach(([s, arr]) => {
      if (s === 'unspecified' || arr.length < 5) return;
      const w = arr.filter(t => parseFloat(t.result) > 0).length;
      const wr = (w / arr.length) * 100;
      if (wr >= overallWR + 10 && wr >= 50) {
        strengths.push({
          title: `${s} session is your edge`,
          description: `${arr.length} trades · ${wr.toFixed(0)}% win rate vs ${overallWR.toFixed(0)}% overall. Lean into this killzone.`,
          seenCount: w, lastSeen: arr.slice(-1)[0]?.date,
          linkedTradeIds: idsOf(arr.filter(t => parseFloat(t.result) > 0)).slice(0, 10),
        });
      }
    });

    // 2. Best setup type
    Object.entries(bySetup).forEach(([s, arr]) => {
      if (s === 'unspecified' || arr.length < 5) return;
      const w = arr.filter(t => parseFloat(t.result) > 0).length;
      const wr = (w / arr.length) * 100;
      if (wr >= 60) {
        strengths.push({
          title: `${s} is your best setup`,
          description: `${arr.length} trades · ${wr.toFixed(0)}% win rate. Build your playbook around this.`,
          seenCount: w, lastSeen: arr.slice(-1)[0]?.date,
          linkedTradeIds: idsOf(arr.filter(t => parseFloat(t.result) > 0)).slice(0, 10),
        });
      }
    });

    // 3. Largest wins
    const bigWins = closed
      .filter(t => parseFloat(t.result) > 0)
      .sort((a, b) => parseFloat(b.result) - parseFloat(a.result))
      .slice(0, 5);
    if (bigWins.length) {
      const totalBigWin = bigWins.reduce((s, t) => s + parseFloat(t.result), 0);
      strengths.push({
        title: 'Capable of high-conviction wins',
        description: `Top 5 best trades earned $${totalBigWin.toFixed(0)}. You can press winners — study what was different about these setups.`,
        seenCount: bigWins.length, lastSeen: bigWins[0]?.date,
        linkedTradeIds: idsOf(bigWins),
      });
    }

    // 4. Aligned-with-bias wins
    const aligned = closed.filter(t => {
      if (!t.htfBias || !t.direction) return false;
      const longBull  = t.direction === 'Long'  && t.htfBias === 'Bullish';
      const shortBear = t.direction === 'Short' && t.htfBias === 'Bearish';
      return longBull || shortBear;
    });
    if (aligned.length >= 5) {
      const w = aligned.filter(t => parseFloat(t.result) > 0).length;
      const wr = (w / aligned.length) * 100;
      if (wr >= 55) {
        strengths.push({
          title: 'Strong HTF-bias alignment',
          description: `${aligned.length} trades aligned with your logged HTF bias · ${wr.toFixed(0)}% win rate. Trusting the higher timeframe pays off.`,
          seenCount: aligned.length, lastSeen: aligned.slice(-1)[0]?.date,
          linkedTradeIds: idsOf(aligned.filter(t => parseFloat(t.result) > 0)).slice(0, 10),
        });
      }
    }

    // 5. Best win streak
    const dayPL = {};
    closed.forEach(t => { dayPL[t.date] = (dayPL[t.date] || 0) + parseFloat(t.result); });
    const days = Object.entries(dayPL).sort(([a], [b]) => new Date(a) - new Date(b));
    let streak = 0, best = 0, bestEnd = '';
    days.forEach(([d, pl]) => {
      if (pl > 0) { streak++; if (streak > best) { best = streak; bestEnd = d; } }
      else streak = 0;
    });
    if (best >= 3) {
      strengths.push({
        title: `${best}-day green streak achieved`,
        description: `Longest run of consecutive profitable days. Demonstrates you can string together discipline. Ended on ${bestEnd}.`,
        seenCount: best, lastSeen: bestEnd, linkedTradeIds: [],
      });
    }

    return { mistakes, strengths };
  }

  /* ══════════════════════════════════════════════════════
     JOURNAL
  ══════════════════════════════════════════════════════ */
  function getJournal() { return load(KEYS.journal) || {}; }
  function saveJournal(obj) { save(KEYS.journal, obj); }

  function getJournalEntry(dateStr) {
    return getJournal()[dateStr] || { bias: '', review: '', rating: 0 };
  }
  function saveJournalEntry(dateStr, data) {
    const j = getJournal();
    j[dateStr] = { ...j[dateStr], ...data };
    saveJournal(j);
  }

  /* ══════════════════════════════════════════════════════
     WATCHLIST
  ══════════════════════════════════════════════════════ */
  const DEFAULT_WATCHLIST = [
    { id: 'btc', coin: 'BTC/USDT', htfBias: 'Bullish', levels: { sr: '', ote: '', fvg: '' }, notes: '' },
    { id: 'eth', coin: 'ETH/USDT', htfBias: 'Neutral', levels: { sr: '', ote: '', fvg: '' }, notes: '' },
    { id: 'xrp', coin: 'XRP/USDT', htfBias: 'Bullish', levels: { sr: '', ote: '', fvg: '' }, notes: '' },
  ];
  function getWatchlist() { return load(KEYS.watch) || DEFAULT_WATCHLIST; }
  function saveWatchlist(arr) { save(KEYS.watch, arr); }
  function addWatchCoin(coin) {
    const wl = getWatchlist();
    const item = { id: uid(), coin, htfBias: 'Neutral', levels: { sr: '', ote: '', fvg: '' }, notes: '' };
    wl.push(item);
    saveWatchlist(wl);
    return item;
  }
  function updateWatchCoin(id, patch) {
    saveWatchlist(getWatchlist().map(w => w.id === id ? { ...w, ...patch } : w));
  }
  function deleteWatchCoin(id) {
    saveWatchlist(getWatchlist().filter(w => w.id !== id));
  }

  /* ══════════════════════════════════════════════════════
     PLAYBOOK (setup catalogue)
  ══════════════════════════════════════════════════════ */
  const DEFAULT_PLAYBOOK = [
    {
      id: 'ote', name: 'OTE', description: 'Optimal Trade Entry — Fibonacci retracement into the 62–79% zone after a confirmed displacement.',
      entryRules: 'Enter at 62–79% Fib retracement from the swing low/high. Requires prior BOS or CHOCH.',
      slRules: 'SL below/above the swing low/high that created the OTE zone.',
      tpRules: 'TP1 at previous high/low (1:1 min). TP2 at premium/discount array above/below.',
      checklist: [
        { label: 'HTF bias confirmed (H4/D1)', checked: false },
        { label: 'BOS or CHOCH identified', checked: false },
        { label: 'Price in 62–79% OTE zone', checked: false },
        { label: 'Inside killzone window', checked: false },
        { label: 'No major news in next 30 min', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'fvg', name: 'FVG / IFVG', description: 'Fair Value Gap — 3-candle imbalance. Enter on mitigation of the gap. IFVG = inverted/broken FVG used as support/resistance.',
      entryRules: 'Enter when price returns to fill the FVG (50% of gap minimum). IFVG: enter on retest of broken FVG from opposite side.',
      slRules: 'SL below the FVG (for longs) or above (for shorts).',
      tpRules: 'TP1 at next opposing FVG. TP2 at swing high/low.',
      checklist: [
        { label: 'HTF bias aligned', checked: false },
        { label: 'FVG created by displacement candle', checked: false },
        { label: 'Price returning into FVG', checked: false },
        { label: 'In killzone', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'sweep', name: 'Liquidity Sweep + Reversal', description: 'Equal highs/lows swept (stop hunt), then displacement reversal entry on retracement.',
      entryRules: 'Wait for EQH/EQL sweep. Confirm displacement candle opposite. Enter on OTE retracement of the displacement.',
      slRules: 'SL above the sweep high / below the sweep low.',
      tpRules: 'TP at opposing liquidity pool. Minimum 2:1 R:R.',
      checklist: [
        { label: 'HTF bias aligned with reversal direction', checked: false },
        { label: 'Clear equal highs or equal lows swept', checked: false },
        { label: 'Strong displacement candle confirmed', checked: false },
        { label: 'BOS on LTF after sweep', checked: false },
        { label: 'In killzone', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'orderblock', name: 'Order Block Mitigation', description: 'Last opposing candle before a strong displacement move. Re-enter on retest of the OB body or wick.',
      entryRules: 'Mark the bullish/bearish OB (last down-candle before up-move, or last up-candle before down-move). Enter on retest of the body high/low.',
      slRules: 'SL below the OB low (long) / above the OB high (short).',
      tpRules: 'TP1 at displacement origin. TP2 at next liquidity pool.',
      checklist: [
        { label: 'OB created by impulsive displacement', checked: false },
        { label: 'OB has not been mitigated yet', checked: false },
        { label: 'Aligned with HTF bias', checked: false },
        { label: 'Confluence: OB + FVG or OB + OTE', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'breaker', name: 'Breaker Block', description: 'Failed order block — once an OB is broken through and retested from the other side, it flips polarity (bullish breaker = old bearish OB).',
      entryRules: 'Identify a broken OB. Wait for retest from the new direction. Enter on rejection at the breaker.',
      slRules: 'SL beyond the breaker block extreme.',
      tpRules: 'TP at next liquidity pool / opposing breaker. 2:1 minimum.',
      checklist: [
        { label: 'OB clearly broken with displacement', checked: false },
        { label: 'BOS in new direction confirmed', checked: false },
        { label: 'Retest of breaker happening now', checked: false },
        { label: 'Killzone session active', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'mitigation', name: 'Mitigation Block', description: 'Internal range OB used as a hidden support/resistance during pullbacks within trends. Often invisible without ICT framework.',
      entryRules: 'Within an established trend, mark the last counter-trend OB. Enter on first touch with rejection wick.',
      slRules: 'Tight SL beyond the mitigation block extreme — usually <0.5% on crypto majors.',
      tpRules: 'TP at trend continuation high/low. Trail to BE after 1R.',
      checklist: [
        { label: 'Trending structure (HH/HL or LH/LL)', checked: false },
        { label: 'Mitigation block clearly identified', checked: false },
        { label: 'No conflicting HTF FVG above', checked: false },
        { label: 'Killzone session active', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'turtlesoup', name: 'Turtle Soup (False Breakout)', description: 'Stop hunt above/below a previous high/low followed by immediate reversal. Classic liquidity grab.',
      entryRules: 'Wait for break of prior swing high/low. Re-enter when price closes back inside the range. Confirm with LTF BOS.',
      slRules: 'SL above the swept high / below swept low.',
      tpRules: 'TP at opposite extreme of the range. Often 3R+.',
      checklist: [
        { label: 'Clear prior swing high or low swept', checked: false },
        { label: 'Wick rejection confirmed', checked: false },
        { label: 'LTF BOS in opposite direction', checked: false },
        { label: 'Counter-trend HTF or range condition', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'silver-bullet', name: 'Silver Bullet (15m window)', description: 'ICT 15-min window setup: 10–11 AM NY (and London 03:00–04:00 NY) — fade liquidity sweeps with FVG entries.',
      entryRules: 'Inside the 15-min window, look for a liquidity sweep + FVG creation. Enter on FVG retest.',
      slRules: 'SL above/below the sweep extreme. Tight risk.',
      tpRules: 'TP at next draw on liquidity. 2–4R typical.',
      checklist: [
        { label: 'Inside Silver Bullet window (10–11 AM NY)', checked: false },
        { label: 'Sweep + FVG combo formed', checked: false },
        { label: 'HTF draw on liquidity defined', checked: false },
        { label: 'Risk capped to 0.5% account', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'asian-range', name: 'Asian Range Breakout', description: 'Asian session range marked as liquidity. London/NY breakout takes the range edge then reverses or continues.',
      entryRules: 'Mark Asian high/low (00:00–06:00 UTC). On London open, wait for sweep of one extreme + LTF BOS, then enter retracement.',
      slRules: 'SL beyond the swept Asian extreme.',
      tpRules: 'TP at opposite Asian extreme (full range), then daily liquidity beyond.',
      checklist: [
        { label: 'Asian range clearly defined and tight', checked: false },
        { label: 'London or NY killzone active', checked: false },
        { label: 'Sweep + reversal confirmed', checked: false },
        { label: 'HTF bias provides directional bias', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'pdh-pdl', name: 'Previous Day High/Low Sweep', description: 'PDH/PDL act as magnets for liquidity. Sweep + reversal on the next session is a classic ICT play.',
      entryRules: 'Mark PDH and PDL. Wait for sweep during current session killzone. Enter on rejection candle close.',
      slRules: 'SL just beyond the swept high/low (usually 5–10 pips on crypto).',
      tpRules: 'TP at opposite PDH/PDL or weekly high/low.',
      checklist: [
        { label: 'PDH/PDL clearly marked on chart', checked: false },
        { label: 'Sweep happens in killzone', checked: false },
        { label: 'Rejection candle visible (long wick)', checked: false },
        { label: 'HTF bias confirms reversal direction', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'weekly-bias', name: 'Weekly Bias Continuation (Swing)', description: 'Swing trade aligned with the weekly bias. Enter on H4 OTE/FVG after a daily pullback.',
      entryRules: 'Determine weekly bias from W1 candle structure. On daily pullback, mark H4 OTE or FVG. Enter on H1 confirmation.',
      slRules: 'SL beyond the H4 swing low/high. Wider stops, smaller size.',
      tpRules: 'TP at weekly liquidity (prior weekly high/low). 5R+ targets.',
      checklist: [
        { label: 'Weekly bias clear (W1 close direction)', checked: false },
        { label: 'Daily pullback into discount/premium', checked: false },
        { label: 'H4 OTE or FVG aligned', checked: false },
        { label: 'No major weekly news event ahead', checked: false },
        { label: 'Position size <0.25% per R', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'rebalance', name: 'Rebalance / Equilibrium Trade', description: 'Price tends to return to the 50% of a previous range or impulse leg. Trade the bounce off equilibrium.',
      entryRules: 'Mark the recent impulse leg. Calculate 50% level. Enter on tap with rejection wick.',
      slRules: 'SL at 62% of the same leg.',
      tpRules: 'TP at full retracement back to impulse origin. Usually 1.5–3R.',
      checklist: [
        { label: 'Impulsive leg clearly identified', checked: false },
        { label: '50% equilibrium level marked', checked: false },
        { label: 'Reaction candle on tap', checked: false },
        { label: 'No conflicting OB above 50%', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'power-of-three', name: 'Power of Three (AMD)', description: 'Accumulation → Manipulation → Distribution. Daily candle plays out as an Asian accumulation, London manipulation (sweep), NY distribution (run).',
      entryRules: 'After London sweeps Asian range, enter NY open in direction of HTF bias on confirmation.',
      slRules: 'SL beyond the London manipulation extreme.',
      tpRules: 'TP at NY session high/low or daily target. 3–5R typical.',
      checklist: [
        { label: 'Asian range tight (accumulation)', checked: false },
        { label: 'London swept one side (manipulation)', checked: false },
        { label: 'NY open about to start (distribution)', checked: false },
        { label: 'HTF bias confirms NY direction', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
    {
      id: 'scalp-mss', name: 'Scalp: Market Structure Shift (LTF)', description: '1-min/5-min scalp on shift in market structure inside a killzone. Quick in, quick out.',
      entryRules: 'On 1m/5m, identify CHOCH then BOS in new direction. Enter on first FVG fill.',
      slRules: 'SL above/below the CHOCH high/low. Very tight.',
      tpRules: 'TP at next 5m liquidity pool. 1–2R, take profit aggressively.',
      checklist: [
        { label: 'Inside an active killzone', checked: false },
        { label: 'Clear MSS on 1m/5m', checked: false },
        { label: 'FVG fill within 3 candles', checked: false },
        { label: 'Risk ≤0.25% (small scalp)', checked: false },
      ],
      screenshotUrl: '', winRate: null, avgR: null, tradeCount: 0
    },
  ];

  function getPlaybook() {
    const saved = load(KEYS.play);
    if (!saved) return DEFAULT_PLAYBOOK;
    // Merge: add any DEFAULT setup whose id isn't in saved (one-time top-up for new defaults)
    const savedIds = new Set(saved.map(s => s.id));
    const newDefaults = DEFAULT_PLAYBOOK.filter(d => !savedIds.has(d.id));
    if (newDefaults.length) {
      const merged = [...saved, ...newDefaults];
      save(KEYS.play, merged);
      return merged;
    }
    return saved;
  }
  function savePlaybook(arr) { save(KEYS.play, arr); }
  function addSetup(s) {
    const pb = getPlaybook();
    const item = { id: uid(), winRate: null, avgR: null, tradeCount: 0, checklist: [], ...s };
    pb.push(item);
    savePlaybook(pb);
    return item;
  }
  function updateSetup(id, patch) {
    savePlaybook(getPlaybook().map(s => s.id === id ? { ...s, ...patch } : s));
  }
  function deleteSetup(id) { savePlaybook(getPlaybook().filter(s => s.id !== id)); }

  /* Recompute playbook stats from trades */
  function recomputePlaybookStats() {
    const trades = getTrades().filter(t => t.result !== undefined && t.result !== '');
    const pb = getPlaybook().map(setup => {
      const matching = trades.filter(t => t.setupType === setup.name || t.setupType === setup.id);
      const wins = matching.filter(t => parseFloat(t.result) > 0);
      const avgR  = matching.length
        ? matching.reduce((s, t) => s + parseFloat(t.rMultiple || 0), 0) / matching.length
        : null;
      return {
        ...setup,
        tradeCount: matching.length,
        winRate: matching.length ? (wins.length / matching.length) * 100 : null,
        avgR
      };
    });
    savePlaybook(pb);
    return pb;
  }

  /* Setup names list for dropdowns */
  function getSetupNames() {
    return getPlaybook().map(s => s.name);
  }

  /* ══════════════════════════════════════════════════════
     MISTAKES & STRENGTHS
  ══════════════════════════════════════════════════════ */
  function getMistakes() { return load(KEYS.mistakes) || []; }
  function saveMistakes(arr) { save(KEYS.mistakes, arr); }
  function addMistake(m) {
    const arr = getMistakes();
    const item = { id: uid(), seenCount: 1, lastSeen: new Date().toISOString().slice(0, 10),
                   linkedTradeIds: [], ...m, dateAdded: m.dateAdded || new Date().toISOString().slice(0, 10) };
    arr.push(item);
    saveMistakes(arr);
    return item;
  }
  function updateMistake(id, patch) {
    saveMistakes(getMistakes().map(m => m.id === id ? { ...m, ...patch } : m));
  }
  function deleteMistake(id) { saveMistakes(getMistakes().filter(m => m.id !== id)); }
  function bumpMistake(id) {
    saveMistakes(getMistakes().map(m => m.id === id
      ? { ...m, seenCount: (m.seenCount || 0) + 1, lastSeen: new Date().toISOString().slice(0, 10) }
      : m));
  }

  function getStrengths() { return load(KEYS.strength) || []; }
  function saveStrengths(arr) { save(KEYS.strength, arr); }
  function addStrength(s) {
    const arr = getStrengths();
    const item = { id: uid(), seenCount: 1, lastSeen: new Date().toISOString().slice(0, 10),
                   linkedTradeIds: [], ...s, dateAdded: s.dateAdded || new Date().toISOString().slice(0, 10) };
    arr.push(item);
    saveStrengths(arr);
    return item;
  }
  function updateStrength(id, patch) {
    saveStrengths(getStrengths().map(s => s.id === id ? { ...s, ...patch } : s));
  }
  function deleteStrength(id) { saveStrengths(getStrengths().filter(s => s.id !== id)); }
  function bumpStrength(id) {
    saveStrengths(getStrengths().map(s => s.id === id
      ? { ...s, seenCount: (s.seenCount || 0) + 1, lastSeen: new Date().toISOString().slice(0, 10) }
      : s));
  }

  /* ══════════════════════════════════════════════════════
     GOALS
  ══════════════════════════════════════════════════════ */
  function getGoals() {
    return load(KEYS.goals) || {
      monthlyTarget: 0,
      disciplineRules: [],
      maxTradesDay: 3,
      maxTradesMonth: 30,
      coachGoals: []
    };
  }
  function saveGoals(g) { save(KEYS.goals, g); }

  /* ══════════════════════════════════════════════════════
     COACH LOG
  ══════════════════════════════════════════════════════ */
  function getCoachLog() { return load(KEYS.coachLog) || []; }
  function addCoachLog(entry) {
    const log = getCoachLog();
    log.unshift({ id: uid(), date: new Date().toISOString(), ...entry });
    save(KEYS.coachLog, log.slice(0, 200));
  }
  function clearCoachLog() { save(KEYS.coachLog, []); }

  /* ══════════════════════════════════════════════════════
     EXPORT / IMPORT
  ══════════════════════════════════════════════════════ */
  function exportJSON() {
    const data = {};
    Object.entries(KEYS).forEach(([k, key]) => {
      data[k] = load(key);
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `jaybot_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(jsonStr) {
    const data = JSON.parse(jsonStr);
    Object.entries(KEYS).forEach(([k, key]) => {
      if (data[k] !== undefined) save(key, data[k]);
    });
  }

  /* ══════════════════════════════════════════════════════
     CSV PARSERS
  ══════════════════════════════════════════════════════ */

  /* ── Shared CSV row parser (handles quoted fields) ── */
  function parseCSVRows(text) {
    const lines = text.trim().split('\n');
    const headers = parseCSVLine(lines[0]);
    return lines.slice(1).map(line => {
      const vals = parseCSVLine(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h.trim().replace(/^"|"$/g, '')] = (vals[i] || '').trim().replace(/^"|"$/g, ''); });
      return obj;
    }).filter(r => Object.values(r).some(v => v));
  }

  function parseCSVLine(line) {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
      else { cur += c; }
    }
    result.push(cur);
    return result;
  }

  /* ── Normalise pair to "BASE/QUOTE" form ── */
  function normalisePair(raw) {
    if (!raw) return '';
    raw = raw.trim().toUpperCase();
    // Already slash-delimited
    if (raw.includes('/')) return raw;
    // Ends in known quote currencies
    const quotes = ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'BNB'];
    for (const q of quotes) {
      if (raw.endsWith(q)) return raw.slice(0, raw.length - q.length) + '/' + q;
    }
    return raw;
  }

  /* ── Parse "June 27, 2022 → June 29, 2022" → ISO date (start) ── */
  function parseNotionDate(raw) {
    if (!raw) return '';
    const part = raw.split('→')[0].trim();
    const d = new Date(part);
    if (isNaN(d)) return '';
    return d.toISOString().slice(0, 10);
  }

  /* ── Parse "$-1,234.56" → number ── */
  function parseMoney(raw) {
    if (!raw) return null;
    const n = parseFloat(raw.replace(/[$,\s]/g, ''));
    return isNaN(n) ? null : n;
  }

  /* ─────────────────────────────────────────────────────
     PARSER 1: Notion Journal CSV (_all.csv format)
     Columns: Name, % Risk, Account, Confluences, Date,
              Direction, Fits Plan?, Order Type, Pair,
              Profit, Profit/Loss, R, Session, Trend
  ────────────────────────────────────────────────────── */
  function parseNotionCSV(text) {
    const rows = parseCSVRows(text);
    const trades = [];

    rows.forEach(r => {
      const date = parseNotionDate(r['Date']);
      if (!date) return;

      const result = parseMoney(r['Profit/Loss']);
      const pair   = normalisePair(r['Pair'] || r['Name'] || '');
      const dir    = r['Direction'] || '';
      const session = r['Session'] || '';
      const rVal   = r['R'] ? parseFloat(r['R']) : null;
      const risk   = r['% Risk'] ? parseFloat(r['% Risk']) : null;
      const confluences = r['Confluences'] || '';
      const fitsPlan = r['Fits Plan?'] || '';
      const orderType = r['Order Type'] || '';
      const trend = r['Trend'] || '';
      const name  = r['Name'] || '';

      // Derive session from name if not set
      let derivedSession = session;
      if (!derivedSession) {
        const n = name.toUpperCase();
        if (n.includes('LONDON') || n.includes('LDN')) derivedSession = 'London';
        else if (n.includes('NY') || n.includes('NEW YORK')) derivedSession = 'NY';
        else if (n.includes('ASIAN') || n.includes('ASIA')) derivedSession = 'Asian';
      }

      trades.push({
        id: uid(),
        source: 'notion',
        date,
        symbol: pair,
        direction: dir,
        session: derivedSession,
        setupType: orderType || '',
        htfBias: trend || '',
        result: result !== null ? result : '',
        rMultiple: rVal !== null ? rVal : '',
        entry: '', sl: '', tp: '', size: '',
        exitPrice: '',
        preGrade: '', preGradeNotes: confluences,
        postGrade: '', postGradeNotes: fitsPlan ? `Fits plan: ${fitsPlan}` : '',
        notes: `Risk: ${risk || '-'}% | Confluences: ${confluences} | Trend: ${trend}`,
        screenshotUrl: '',
        linkedMistakeIds: [], linkedStrengthIds: [],
        createdAt: new Date().toISOString()
      });
    });
    return trades;
  }

  /* ─────────────────────────────────────────────────────
     PARSER 2: Binance Transaction History CSV
     Columns: User_ID, UTC_Time, Account, Operation,
              Coin, Change, Remark
     Groups rows by UTC_Time to reconstruct trades.
  ────────────────────────────────────────────────────── */
  function parseBinanceTxCSV(text) {
    const rows = parseCSVRows(text);
    const groups = {};

    rows.forEach(r => {
      const t = r['UTC_Time'] || r['Time'] || '';
      if (!t) return;
      if (!groups[t]) groups[t] = [];
      groups[t].push(r);
    });

    const trades = [];

    Object.entries(groups).forEach(([timestamp, rows]) => {
      const ops = rows.reduce((acc, r) => {
        const op  = (r['Operation'] || '').toLowerCase();
        const coin = r['Coin'] || '';
        const ch   = parseFloat(r['Change'] || 0);
        if (!acc[op]) acc[op] = [];
        acc[op].push({ coin, change: ch });
        return acc;
      }, {});

      // Identify trade type
      const sold = ops['transaction sold'] || [];
      const bought = ops['transaction buy'] || ops['transaction bought'] || [];
      const revenue = ops['transaction revenue'] || [];
      const spent = ops['transaction spent'] || [];
      const fee = ops['transaction fee'] || [];

      if (!sold.length && !bought.length) return; // not a trade row

      let direction, baseQty, quoteCoin, baseCoins, quoteAmt;

      if (sold.length) {
        direction = 'Short';  // selling base for quote
        baseCoins = sold.map(s => s.coin);
        baseQty   = Math.abs(sold.reduce((s, r) => s + r.change, 0));
        quoteAmt  = Math.abs(revenue.reduce((s, r) => s + r.change, 0));
        quoteCoin = revenue[0]?.coin || 'USDT';
      } else {
        direction = 'Long';
        baseCoins = bought.map(b => b.coin);
        baseQty   = Math.abs(bought.reduce((s, r) => s + r.change, 0));
        quoteAmt  = Math.abs(spent.reduce((s, r) => s + r.change, 0));
        quoteCoin = spent[0]?.coin || 'USDT';
      }

      const baseCoin = [...new Set(baseCoins)][0] || '';
      const symbol   = baseCoin ? `${baseCoin}/${quoteCoin}` : '';
      const price    = baseQty > 0 ? quoteAmt / baseQty : 0;
      const feeAmt   = Math.abs(fee.reduce((s, r) => s + r.change, 0));
      const date     = timestamp.slice(0, 10);

      if (!symbol) return;

      trades.push({
        id: uid(),
        source: 'binance_tx',
        date,
        symbol,
        direction: direction === 'Long' ? 'Long' : 'Short',
        entry: price > 0 ? price.toFixed(6) : '',
        sl: '', tp: '',
        size: quoteAmt.toFixed(2),
        session: '', htfBias: '', setupType: '',
        exitPrice: '', result: '', rMultiple: '',
        preGrade: '', preGradeNotes: '',
        postGrade: '', postGradeNotes: '',
        notes: `Fee: ${feeAmt.toFixed(4)} ${quoteCoin} | Imported from Binance TX`,
        screenshotUrl: '',
        linkedMistakeIds: [], linkedStrengthIds: [],
        createdAt: new Date().toISOString()
      });
    });

    return trades;
  }

  /* ─────────────────────────────────────────────────────
     PARSER 3: Binance Spot Order History (saved as CSV)
     Columns: Date(UTC), Order No., Pair, Base Asset,
              Quote Asset, Type, Order Price, Order Amount,
              AvgTrading Price, Filled, Total, Trigger
              Condition, Status
  ────────────────────────────────────────────────────── */
  function parseBinanceOrderCSV(text) {
    const rows = parseCSVRows(text);
    const trades = [];

    rows.forEach(r => {
      const status = (r['Status'] || '').trim().toLowerCase();
      if (status !== 'filled') return;

      const date  = (r['Date(UTC)'] || '').slice(0, 10);
      const pair  = normalisePair(r['Pair'] || '');
      const type  = (r['Type'] || '').trim().toUpperCase();
      const price = parseFloat(r['AvgTrading Price'] || r['Order Price'] || 0);
      const qty   = parseFloat(r['Filled'] || 0);
      const total = parseFloat(r['Total'] || 0);

      if (!date || !pair) return;

      trades.push({
        id: uid(),
        source: 'binance_order',
        date,
        symbol: pair,
        direction: type === 'BUY' ? 'Long' : 'Short',
        entry: price > 0 ? price : '',
        sl: '', tp: '',
        size: total > 0 ? total.toFixed(2) : '',
        session: '', htfBias: '', setupType: '',
        exitPrice: '', result: '', rMultiple: '',
        preGrade: '', preGradeNotes: '',
        postGrade: '', postGradeNotes: '',
        notes: `Qty: ${qty} | Imported from Binance Order History`,
        screenshotUrl: '',
        linkedMistakeIds: [], linkedStrengthIds: [],
        createdAt: new Date().toISOString()
      });
    });
    return trades;
  }

  /* ─────────────────────────────────────────────────────
     AUTO-DETECT CSV format and parse
  ────────────────────────────────────────────────────── */
  function autoParseCSV(text) {
    const firstLine = text.split('\n')[0].toLowerCase();
    if (firstLine.includes('utc_time') || firstLine.includes('operation')) {
      return { format: 'Binance Transaction History', trades: parseBinanceTxCSV(text) };
    }
    if (firstLine.includes('order no') || firstLine.includes('avgtrad') || firstLine.includes('avgtrading')) {
      return { format: 'Binance Order History', trades: parseBinanceOrderCSV(text) };
    }
    if (firstLine.includes('profit') || firstLine.includes('confluences') || firstLine.includes('fits plan')) {
      return { format: 'Notion Journal', trades: parseNotionCSV(text) };
    }
    // Try Notion as fallback if it has Date + Direction columns
    if (firstLine.includes('direction') || firstLine.includes('pair')) {
      return { format: 'Notion Journal', trades: parseNotionCSV(text) };
    }
    return { format: 'Unknown', trades: [] };
  }

  /* Merge imported trades (skip duplicates by source+date+symbol+direction) */
  function mergeImportedTrades(newTrades) {
    const existing = getTrades();
    const existingKeys = new Set(existing.map(t => `${t.source}|${t.date}|${t.symbol}|${t.direction}|${t.entry}`));
    const toAdd = newTrades.filter(t => !existingKeys.has(`${t.source}|${t.date}|${t.symbol}|${t.direction}|${t.entry}`));
    saveTrades([...existing, ...toAdd]);
    return { added: toAdd.length, skipped: newTrades.length - toAdd.length };
  }

  /* ── Public API ──────────────────────────────────────── */
  return {
    // Settings
    getSettings, saveSettings,
    // Tabs
    getTabs, saveTabs, addTab, deleteTab, DEFAULT_TABS,
    // Trades
    getTrades, addTrade, updateTrade, deleteTrade, getTradeById,
    filterByRange, filterByMode,
    calcStats, dailyPLMap, equityCurve, winRateBySetup,
    performanceBySession, rDistribution, streaks,
    analyzePatterns,
    // Journal
    getJournalEntry, saveJournalEntry,
    // Watchlist
    getWatchlist, addWatchCoin, updateWatchCoin, deleteWatchCoin,
    // Playbook
    getPlaybook, addSetup, updateSetup, deleteSetup,
    recomputePlaybookStats, getSetupNames,
    // Mistakes & Strengths
    getMistakes, addMistake, updateMistake, deleteMistake, bumpMistake,
    getStrengths, addStrength, updateStrength, deleteStrength, bumpStrength,
    // Goals
    getGoals, saveGoals,
    // Coach log
    getCoachLog, addCoachLog, clearCoachLog,
    // Export/Import
    exportJSON, importJSON,
    // CSV parsers
    autoParseCSV, mergeImportedTrades,
    parseNotionCSV, parseBinanceTxCSV, parseBinanceOrderCSV,
    // Utils
    uid, parseMoney, normalisePair
  };
})();
