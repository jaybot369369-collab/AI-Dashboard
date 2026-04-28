/* ═══════════════════════════════════════════════════════════
   ICT DOJO TAB — Live Binance market conditions  (v2)
   Pairs: user-managed list (persisted)  |  TFs: 4H · 1H · 15m · 1D
   Poll: every 60s via Binance public REST API
════════════════════════════════════════════════════════════ */
const DojoTab = (() => {

  /* ── Constants ──────────────────────────────────────── */
  const PROTECTED = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT'];
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const TFS  = ['1h', '4h', '1d', '1w'];
  const TF_LABEL = { '1h':'1H', '4h':'4H', '1d':'1D', '1w':'1W' };

  /* ── State ──────────────────────────────────────────── */
  let _pair        = 'BTCUSDT';
  let _tf          = localStorage.getItem('jb_dojo_tf') || '4h';
  let _customPairs = JSON.parse(localStorage.getItem('jb_dojo_pairs') || 'null') || [...PROTECTED];
  let _panels      = JSON.parse(localStorage.getItem('jb_dojo_panels') || '{"pdDetails":true}'); // {id: collapsed-bool}; PD details closed by default
  let _candles     = {};
  let _ticker      = null;
  let _signals     = null;
  let _pollTimer   = null;
  let _clockTimer  = null;
  let _lastFetch   = null;
  let _fetchErr    = null;
  let _lastDinoFire= 0;
  let _dinoArmed   = true;  // toggled off after firing, re-armed when confluence drops

  function savePairs()  { localStorage.setItem('jb_dojo_pairs', JSON.stringify(_customPairs)); }
  function savePanels() { localStorage.setItem('jb_dojo_panels', JSON.stringify(_panels)); }
  function isCollapsed(id) { return _panels[id] === true; }

  /* ── Utils ──────────────────────────────────────────── */
  const dp = s => s && s.includes('BTC') ? 2 : 4;
  const fmtP = (n, sym) => n == null ? '—' : '$' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: dp(sym||_pair), maximumFractionDigits: dp(sym||_pair) });
  const ago  = ms => { const s = Math.round((Date.now()-ms)/1000); return s < 60 ? `${s}s ago` : `${Math.round(s/60)}m ago`; };

  /* ══════════════════════════════════════════════════════
     CLOCKS & SESSIONS
  ══════════════════════════════════════════════════════ */
  function getCityTimes() {
    const now = new Date();
    const fmt = tz => now.toLocaleTimeString('en-US', { timeZone: tz, hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return [
      { flag: '🇯🇵', label: 'Tokyo',    time: fmt('Asia/Tokyo') },
      { flag: '🇬🇧', label: 'London',   time: fmt('Europe/London') },
      { flag: '🗽',   label: 'New York', time: fmt('America/New_York') },
    ];
  }

  // Killzones defined in NEW YORK local time (the canonical ICT reference frame).
  // These auto-convert to UTC at runtime, handling EST↔EDT (DST) transitions.
  const KZS_NY = [
    { name: 'Asian KZ',         startNY: 20, endNY: 24, color: 'var(--teal)'   },
    { name: 'London Open KZ',   startNY: 2,  endNY: 5,  color: 'var(--accent)' },
    { name: 'NY Open KZ',       startNY: 7,  endNY: 10, color: 'var(--orange)' },
    { name: 'London Close KZ',  startNY: 10, endNY: 12, color: 'var(--gold)'   },
  ];

  // Returns NY UTC offset in hours (e.g. -4 for EDT, -5 for EST)
  function nyOffsetHours() {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', timeZoneName: 'longOffset'
      }).formatToParts(new Date());
      const tz = parts.find(p => p.type === 'timeZoneName').value;
      const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
      if (!m) return -5;
      const sign = m[1] === '+' ? 1 : -1;
      return sign * (parseInt(m[2]) + (parseInt(m[3] || '0') / 60));
    } catch { return -5; }
  }

  // Converts NY-local killzones into UTC bounds for current DST state
  function KZS() {
    const off = nyOffsetHours(); // -4 EDT, -5 EST
    return KZS_NY.map(kz => ({
      ...kz,
      start: ((kz.startNY - off) + 24) % 24,
      end:   ((kz.endNY   - off) + 24) % 24,
    }));
  }

  function kzStatus() {
    const now = new Date();
    const h = now.getUTCHours() + now.getUTCMinutes() / 60;
    return KZS().map(kz => {
      const active = kz.start > kz.end ? (h >= kz.start || h < kz.end) : (h >= kz.start && h < kz.end);
      let minsTo = 0;
      if (!active) {
        const nowM = now.getUTCHours() * 60 + now.getUTCMinutes();
        const startM = kz.start * 60;
        minsTo = startM - nowM;
        if (minsTo < 0) minsTo += 1440;
      }
      return { ...kz, active, minsTo };
    });
  }

  const fmtCD = m => m <= 0 ? 'NOW' : m < 60 ? `${Math.floor(m)}m` : `${Math.floor(m/60)}h ${Math.floor(m%60)}m`;

  /* ══════════════════════════════════════════════════════
     FORMATION SIGNAL METADATA
  ══════════════════════════════════════════════════════ */
  const SIG_META = {
    'Bearish RSI Div': { bestTF: ['15m','1h'], bestDays: ['Tue','Wed','Thu'], holdTime: '1-4 bars (~30m-4h)',
      why: 'NY-AM displacement creates breaker + fresh FVG on same leg; Tue/Wed carry week\'s widest range' },
    'Bullish RSI Div': { bestTF: ['15m','1h'], bestDays: ['Tue','Wed','Thu'], holdTime: '1-4 bars (~30m-4h)',
      why: 'Asia/London sweep into NY FVG; weekends thin, Mon gap-risky' },
    'Wick Rejection':  { bestTF: ['1h','4h'],  bestDays: ['Tue','Wed','Thu'], holdTime: '2-6 bars (~4h-1d)',
      why: 'HTF OB tap after London sweep; midweek liquidity pool largest' },
    'Liq Sweep':       { bestTF: ['15m','1h'], bestDays: ['Tue','Wed','Thu'], holdTime: '30-90 min',
      why: '10-11 ET window fills prior NY-AM FVG; drops sharply Mon/Fri' },
    'Engulfing':       { bestTF: ['1h','4h'],  bestDays: ['Wed','Thu'],       holdTime: '4-12 bars (~8h-2d)',
      why: 'Late-week continuation after structure shift; Friday often fades' },
    'Vol Divergence':  { bestTF: ['4h','1d'],  bestDays: ['Wed','Thu'],       holdTime: '4-12 bars (~16h-3d)',
      why: 'Stacked stops drawn down by Wed midpoint; weekly flushes cluster' },
  };

  function tierFor(sig, formations) {
    const today = DAYS[new Date().getUTCDay()];
    const meta = SIG_META[sig.type];
    if (!meta) return 'B';
    const inDay = meta.bestDays.includes(today);
    const inKZ  = kzStatus().some(k => k.active);
    const sameType = formations.filter(f => f.type === sig.type).length;
    if ((inKZ && inDay) || sameType >= 2) return 'A';
    return 'B';
  }

  /* ══════════════════════════════════════════════════════
     BINANCE FETCH
  ══════════════════════════════════════════════════════ */
  async function fetchCandles(sym, interval, limit = 120) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`);
    if (!r.ok) throw new Error(`Binance ${interval}: HTTP ${r.status}`);
    return (await r.json()).map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  }
  async function fetchTicker(sym) {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`);
    if (!r.ok) throw new Error(`Ticker: HTTP ${r.status}`);
    return r.json();
  }

  async function loadData() {
    _fetchErr = null;
    updateStatus('Fetching…');
    try {
      const [c4h, c1h, c15m, c1d, c1w, tick] = await Promise.all([
        fetchCandles(_pair, '4h', 100),
        fetchCandles(_pair, '1h', 100),
        fetchCandles(_pair, '15m', 100),
        fetchCandles(_pair, '1d', 90),
        fetchCandles(_pair, '1w', 60),
        fetchTicker(_pair),
      ]);
      _candles = { '4h': c4h, '1h': c1h, '15m': c15m, '1d': c1d, '1w': c1w };
      _ticker  = tick;
      _lastFetch = Date.now();
      _signals = runAnalysis();
    } catch (e) {
      _fetchErr = e.message;
    }
    updateBody();
  }

  /* ══════════════════════════════════════════════════════
     ICT ANALYSIS — base helpers
  ══════════════════════════════════════════════════════ */
  function calcRSI(closes, p = 14) {
    if (closes.length < p + 1) return closes.map(() => 50);
    const rsi = new Array(closes.length).fill(null);
    let ag = 0, al = 0;
    for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i-1]; d >= 0 ? ag += d : al -= d; }
    ag /= p; al /= p;
    rsi[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = p + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i-1];
      ag = (ag * (p-1) + Math.max(d, 0)) / p;
      al = (al * (p-1) + Math.max(-d, 0)) / p;
      rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return rsi;
  }

  function swingHighs(c, lb = 2) {
    const out = [];
    for (let i = lb; i < c.length - lb; i++) {
      let ok = true;
      for (let j = 1; j <= lb; j++) if (c[i].h <= c[i-j].h || c[i].h <= c[i+j].h) { ok = false; break; }
      if (ok) out.push({ idx: i, price: c[i].h, t: c[i].t });
    }
    return out;
  }
  function swingLows(c, lb = 2) {
    const out = [];
    for (let i = lb; i < c.length - lb; i++) {
      let ok = true;
      for (let j = 1; j <= lb; j++) if (c[i].l >= c[i-j].l || c[i].l >= c[i+j].l) { ok = false; break; }
      if (ok) out.push({ idx: i, price: c[i].l, t: c[i].t });
    }
    return out;
  }

  /* ── PD Array detectors (unchanged) ──────────────────── */
  function findFVGs(candles) {
    const res = [], cur = candles.at(-1).c;
    for (let i = 2; i < candles.length; i++) {
      const [c1,,c3] = [candles[i-2], candles[i-1], candles[i]];
      if (c3.l > c1.h && cur > c1.h * 0.97)  res.push({ type:'FVG', dir:'bull', top:c3.l, bot:c1.h, label:'FVG ↑', tf:'' });
      if (c3.h < c1.l && cur < c1.l * 1.03)  res.push({ type:'FVG', dir:'bear', top:c1.l, bot:c3.h, label:'FVG ↓', tf:'' });
    }
    return res.slice(-6);
  }

  function findOBs(candles) {
    const res = [], cur = candles.at(-1).c;
    for (let i = 2; i < candles.length - 1; i++) {
      const c = candles[i], nx = candles[i+1];
      if (c.c < c.o && nx.c > nx.o && (nx.c-nx.o) > (c.o-c.c) * 1.4) {
        const [top,bot] = [c.o, c.l];
        if (cur > bot * 0.94 && cur < top * 1.06) res.push({ type:'OB', dir:'bull', top, bot, label:'Bullish OB', tf:'' });
      }
      if (c.c > c.o && nx.c < nx.o && (nx.o-nx.c) > (c.c-c.o) * 1.4) {
        const [top,bot] = [c.h, c.c];
        if (cur > bot * 0.94 && cur < top * 1.06) res.push({ type:'OB', dir:'bear', top, bot, label:'Bearish OB', tf:'' });
      }
    }
    return res.slice(-4);
  }

  function findBBs(candles) {
    const old = findOBs(candles.slice(0, -15));
    const recent = candles.slice(-15);
    return old.filter(ob => {
      const broke = recent.some(c => ob.dir === 'bull' ? c.l < ob.bot : c.h > ob.top);
      if (broke) { ob.dir = ob.dir === 'bull' ? 'bear' : 'bull'; ob.label = 'Breaker Block'; ob.type = 'BB'; }
      return broke;
    });
  }

  function findEQ(candles, tol = 0.0025) {
    const res = [];
    const sH = swingHighs(candles, 3).slice(-10);
    const sL = swingLows(candles, 3).slice(-10);
    for (let i = 0; i < sH.length - 1; i++)
      for (let j = i+1; j < sH.length; j++)
        if (Math.abs(sH[i].price - sH[j].price) / sH[i].price < tol)
          res.push({ type:'EQ', dir:'bear', top:Math.max(sH[i].price,sH[j].price), bot:Math.min(sH[i].price,sH[j].price), label:'EQ Highs', tf:'' });
    for (let i = 0; i < sL.length - 1; i++)
      for (let j = i+1; j < sL.length; j++)
        if (Math.abs(sL[i].price - sL[j].price) / sL[i].price < tol)
          res.push({ type:'EQ', dir:'bull', top:Math.max(sL[i].price,sL[j].price), bot:Math.min(sL[i].price,sL[j].price), label:'EQ Lows', tf:'' });
    return res;
  }

  function findRBs(candles) {
    const res = [], cur = candles.at(-1).c;
    candles.slice(-20).forEach(c => {
      const rng = c.h - c.l; if (!rng) return;
      const uw = c.h - Math.max(c.o,c.c), lw = Math.min(c.o,c.c) - c.l;
      if (uw/rng > 0.6 && cur < c.h * 1.02) res.push({ type:'RB', dir:'bear', top:c.h, bot:c.h-uw*0.3, label:'Rejection Block ↓', tf:'' });
      if (lw/rng > 0.6 && cur > c.l * 0.98) res.push({ type:'RB', dir:'bull', top:c.l+lw*0.3, bot:c.l, label:'Rejection Block ↑', tf:'' });
    });
    return res.slice(-3);
  }

  function findPBs(candles) {
    const res = [];
    for (let i = 2; i < candles.length; i++) {
      const [c1,c2,c3] = [candles[i-2],candles[i-1],candles[i]];
      if (c1.c>c1.o && c2.c>c2.o && c3.c>c3.o && c3.c>c2.c && c2.c>c1.c)
        res.push({ type:'PB', dir:'bull', top:c3.c, bot:c1.o, label:'Propulsion Block ↑', tf:'' });
      if (c1.c<c1.o && c2.c<c2.o && c3.c<c3.o && c3.c<c2.c && c2.c<c1.c)
        res.push({ type:'PB', dir:'bear', top:c1.o, bot:c3.c, label:'Propulsion Block ↓', tf:'' });
    }
    return res.slice(-3);
  }

  function findSIBI(candles) {
    const res = [];
    for (let i = 1; i < candles.length - 1; i++) {
      const [prev, c] = [candles[i-1], candles[i]];
      if (c.l > prev.h) res.push({ type:'BISI', dir:'bull', top:c.l, bot:prev.h, label:'BISI (gap ↑)', tf:'' });
      if (c.h < prev.l) res.push({ type:'SIBI', dir:'bear', top:prev.l, bot:c.h, label:'SIBI (gap ↓)', tf:'' });
    }
    return res.slice(-4);
  }

  function allPD() {
    const c4 = _candles['4h'] || [], c1 = _candles['1h'] || [];
    if (!c4.length) return [];
    const tag = (arr, tf) => arr.map(x => ({ ...x, tf }));
    return [
      ...tag(findFVGs(c4), '4H'), ...tag(findFVGs(c1), '1H'),
      ...tag(findOBs(c4),  '4H'), ...tag(findOBs(c1),  '1H'),
      ...tag(findBBs(c4),  '4H'),
      ...tag(findEQ(c4),   '4H'),
      ...tag(findRBs(c4),  '4H'),
      ...tag(findPBs(c4),  '4H'),
      ...tag(findSIBI(c4), '4H'),
    ];
  }

  function detectConfluence(pdArrays) {
    const cur = (_candles['4h'] || []).at(-1)?.c || 0;
    const near = pdArrays.filter(p => Math.abs(((p.top+p.bot)/2 - cur) / cur) < 0.015);
    const bulls = near.filter(p => p.dir === 'bull').length;
    const bears = near.filter(p => p.dir === 'bear').length;
    const total = Math.max(bulls, bears);
    return { bulls, bears, total, near, dino: total >= 5 };
  }

  function pdDirection(conf) {
    const { bulls, bears } = conf;
    const tot = bulls + bears;
    if (tot < 3) return { label: 'UNSURE', icon: '❓', color: 'var(--text-sub)', desc: 'Not enough PD arrays nearby — hold off' };
    const ratio = bulls / tot;
    if (ratio >= 0.65) return { label: 'BULL DOMINANT', icon: '▲', color: 'var(--green)', desc: 'Bullish bias — look for longs in discount' };
    if (ratio <= 0.35) return { label: 'BEAR DOMINANT', icon: '▼', color: 'var(--red)',   desc: 'Bearish bias — look for shorts in premium' };
    return                 { label: 'NEUTRAL',        icon: '◆', color: 'var(--gold)',  desc: 'Forces balanced — wait for a sweep to commit' };
  }

  /* ── Existing condition detectors ────────────────────── */
  function detectPremDisc(candles) {
    const s = candles.slice(-50);
    const hi = Math.max(...s.map(c=>c.h)), lo = Math.min(...s.map(c=>c.l));
    const cur = s.at(-1).c, pct = ((cur-lo)/(hi-lo))*100;
    const zone = pct > 62 ? 'Premium' : pct < 38 ? 'Discount' : 'Equilibrium';
    const color = pct > 62 ? 'var(--red)' : pct < 38 ? 'var(--green)' : 'var(--gold)';
    return { zone, pct, hi, lo, mid:(hi+lo)/2, cur, color };
  }

  function detectStructure(candles) {
    const sH = swingHighs(candles, 3).slice(-4), sL = swingLows(candles, 3).slice(-4);
    const cur = candles.at(-1).c;
    if (sH.length < 2 || sL.length < 2) return { label:'Building structure…', color:'var(--text-sub)' };
    const lH = sH.at(-1).price, pH = sH.at(-2).price;
    const lL = sL.at(-1).price, pL = sL.at(-2).price;
    if (cur > lH * 1.001) return { label:'BOS ↑ Bullish break', color:'var(--green)' };
    if (cur < lL * 0.999) return { label:'BOS ↓ Bearish break', color:'var(--red)' };
    if (lH > pH && lL > pL)  return { label:'HH / HL — Uptrend', color:'var(--green)' };
    if (lH < pH && lL < pL)  return { label:'LH / LL — Downtrend', color:'var(--red)' };
    return { label:'Consolidation / CHoCH watch', color:'var(--gold)' };
  }

  function detectTrend(candles) {
    const s = candles.slice(-30);
    const sH = swingHighs(s, 2).slice(-3), sL = swingLows(s, 2).slice(-3);
    if (sH.length >= 2 && sL.length >= 2) {
      if (sH.at(-1).price > sH.at(-2).price && sL.at(-1).price > sL.at(-2).price)
        return { label:'Trending Up ↑', color:'var(--green)', icon:'📈' };
      if (sH.at(-1).price < sH.at(-2).price && sL.at(-1).price < sL.at(-2).price)
        return { label:'Trending Down ↓', color:'var(--red)', icon:'📉' };
    }
    const avgRng = s.reduce((a,c)=>a+(c.h-c.l),0)/s.length;
    const totRng = Math.max(...s.map(c=>c.h)) - Math.min(...s.map(c=>c.l));
    return totRng < avgRng * 9
      ? { label:'Ranging / Consolidation', color:'var(--gold)',     icon:'↔️' }
      : { label:'Choppy — No clear trend', color:'var(--text-sub)', icon:'〰️' };
  }

  function detectAMD() {
    const h = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
    if (h >= 20 || h < 2)   return { phase:'Accumulation',  desc:'Asian session — SM building positions',         color:'var(--teal)' };
    if (h < 7)               return { phase:'Late Asian',    desc:'Thin liquidity — avoid new entries',            color:'var(--text-sub)' };
    if (h < 9.5)             return { phase:'Manipulation',  desc:'London Open — stop hunts likely, wait for sweep',color:'var(--orange)' };
    if (h < 13.5)            return { phase:'Continuation',  desc:'London mid — established trend playing out',    color:'var(--accent)' };
    if (h < 16)              return { phase:'Distribution',  desc:'NY Open — high-volatility delivery of the move',color:'var(--red)' };
    if (h < 19)              return { phase:'Consolidation', desc:'NY afternoon — reduced volatility, wait',       color:'var(--text-sub)' };
    return                          { phase:'NY Close / Setup',desc:'Session wrap — next range setting up',        color:'var(--gold)' };
  }

  function detectLiqSweep(candles) {
    const eq = findEQ(candles.slice(-50));
    const recent = candles.slice(-8);
    const sweeps = [];
    eq.forEach(lv => {
      recent.slice(1,-1).forEach(c => {
        if (lv.dir === 'bear' && c.h > lv.top && c.c < lv.top)
          sweeps.push({ dir:'bear', label:'↓ Swept EQ Highs — short watch', color:'var(--red)', price:lv.top });
        if (lv.dir === 'bull' && c.l < lv.bot && c.c > lv.bot)
          sweeps.push({ dir:'bull', label:'↑ Swept EQ Lows — long watch',  color:'var(--green)', price:lv.bot });
      });
    });
    return sweeps.slice(-2);
  }

  function detectRSIDiv(candles, tf) {
    if (candles.length < 22) return [];
    const rsi = calcRSI(candles.map(c=>c.c));
    const sH = swingHighs(candles,2).slice(-3), sL = swingLows(candles,2).slice(-3);
    const out = [];
    if (sH.length >= 2) {
      const [h1,h2] = [sH.at(-2), sH.at(-1)];
      const [r1,r2] = [rsi[h1.idx], rsi[h2.idx]];
      if (r1!=null && r2!=null && h2.price > h1.price && r2 < r1 - 3)
        out.push({ type:'Bearish RSI Div', color:'var(--red)', tf,
          desc:`${tf}: Price HH but RSI lower high (${r2.toFixed(0)} < ${r1.toFixed(0)})` });
    }
    if (sL.length >= 2) {
      const [l1,l2] = [sL.at(-2), sL.at(-1)];
      const [r1,r2] = [rsi[l1.idx], rsi[l2.idx]];
      if (r1!=null && r2!=null && l2.price < l1.price && r2 > r1 + 3)
        out.push({ type:'Bullish RSI Div', color:'var(--green)', tf,
          desc:`${tf}: Price LL but RSI higher low (${r2.toFixed(0)} > ${r1.toFixed(0)})` });
    }
    return out;
  }

  function detectFormations() {
    const c4 = _candles['4h']||[], c1 = _candles['1h']||[], c15 = _candles['15m']||[];
    const c1d = _candles['1d']||[], c1w = _candles['1w']||[];
    const sigs = [];
    [['4H',c4],['1H',c1],['15m',c15],['1D',c1d],['1W',c1w]].forEach(([tf,cc]) => { if(cc.length>20) sigs.push(...detectRSIDiv(cc,tf)); });
    const eq4 = findEQ(c4.slice(-60));
    [c4.at(-1), c1.at(-1)].filter(Boolean).forEach((c, i) => {
      const tf = i === 0 ? '4H' : '1H';
      const rng = c.h - c.l; if (!rng) return;
      const uw = c.h - Math.max(c.o,c.c), lw = Math.min(c.o,c.c) - c.l;
      if (uw/rng > 0.55 && eq4.some(l => Math.abs(c.h-l.top)/c.h < 0.004))
        sigs.push({ type:'Wick Rejection', color:'var(--red)', tf, desc:`Bearish wick rejection at HTF EQ level (${tf})` });
      if (lw/rng > 0.55 && eq4.some(l => Math.abs(c.l-l.bot)/c.l < 0.004))
        sigs.push({ type:'Wick Rejection', color:'var(--green)', tf, desc:`Bullish wick rejection at HTF EQ level (${tf})` });
    });
    detectLiqSweep(c1.length ? c1 : c4).forEach(s => sigs.push({ type:'Liq Sweep', color:s.color, tf:'1H', desc:s.label }));
    if (c4.length >= 2) {
      const [prev,last] = [c4.at(-2), c4.at(-1)];
      const bullE = last.c > prev.o && last.o < prev.c && last.c > last.o;
      const bearE = last.c < prev.o && last.o > prev.c && last.c < last.o;
      findOBs(c4.slice(-60)).forEach(ob => {
        const atOB = last.c >= ob.bot*0.998 && last.c <= ob.top*1.002;
        if (bullE && ob.dir==='bull' && atOB) sigs.push({ type:'Engulfing', color:'var(--green)', tf:'4H', desc:'Bullish engulfing at 4H OB' });
        if (bearE && ob.dir==='bear' && atOB) sigs.push({ type:'Engulfing', color:'var(--red)',   tf:'4H', desc:'Bearish engulfing at 4H OB' });
      });
    }
    if (c4.length >= 6) {
      const last3 = c4.slice(-3), prev3 = c4.slice(-6,-3);
      const avgBodyNow  = last3.reduce((a,c) => a + Math.abs(c.c-c.o),0)/3;
      const avgBodyPrev = prev3.reduce((a,c) => a + Math.abs(c.c-c.o),0)/3;
      const pd = detectPremDisc(c4);
      if (avgBodyNow < avgBodyPrev * 0.55) {
        if (pd.pct > 65) sigs.push({ type:'Vol Divergence', color:'var(--red)',   tf:'4H', desc:'Shrinking candle bodies in premium — momentum fading' });
        if (pd.pct < 35) sigs.push({ type:'Vol Divergence', color:'var(--green)', tf:'4H', desc:'Shrinking candle bodies in discount — momentum fading' });
      }
    }
    return sigs.slice(0,8);
  }

  /* ══════════════════════════════════════════════════════
     NEW: EXTENDED CONDITION DETECTORS
  ══════════════════════════════════════════════════════ */

  /* 1. Volatility regime via ATR(14) ratio */
  function detectVolatility(c4) {
    if (c4.length < 30) return { label: 'Loading…', color: 'var(--text-sub)', desc: '' };
    const tr = [];
    for (let i = 1; i < c4.length; i++) {
      tr.push(Math.max(c4[i].h - c4[i].l, Math.abs(c4[i].h - c4[i-1].c), Math.abs(c4[i].l - c4[i-1].c)));
    }
    const atr14 = tr.slice(-14).reduce((a,b)=>a+b,0) / 14;
    const atr50 = tr.slice(-50).reduce((a,b)=>a+b,0) / Math.min(50, tr.length);
    const ratio = atr14 / atr50;
    if (ratio < 0.6)      return { label:'Low Vol',   color:'var(--text-sub)', desc:'Compression — breakout watch', ratio };
    if (ratio < 0.9)      return { label:'Below Avg', color:'var(--accent)',   desc:'Quiet — wait for expansion',   ratio };
    if (ratio < 1.3)      return { label:'Normal',    color:'var(--green)',    desc:'Healthy ATR — typical range',  ratio };
    if (ratio < 1.7)      return { label:'High Vol',  color:'var(--orange)',   desc:'Expanded range — size down',   ratio };
    return                       { label:'EXTREME',   color:'var(--red)',      desc:'Stay flat or scalp only',      ratio };
  }

  /* 2. Today's daily range completion vs 20-day avg */
  function detectDailyRange(c1h, c1d) {
    if (!c1d || c1d.length < 21 || !c1h.length) return { label:'Loading…', color:'var(--text-sub)', desc:'' };
    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const todayBars = c1h.filter(c => c.t >= todayStart);
    if (!todayBars.length) return { label:'No data yet', color:'var(--text-sub)', desc:'' };
    const todayHi  = Math.max(...todayBars.map(c=>c.h));
    const todayLo  = Math.min(...todayBars.map(c=>c.l));
    const todayRng = todayHi - todayLo;
    const avgDaily = c1d.slice(-21,-1).reduce((s,c)=>s+(c.h-c.l),0) / 20;
    const pct = (todayRng / avgDaily) * 100;
    if (pct < 50) return { label:`${pct.toFixed(0)}% used`, color:'var(--green)', desc:'Plenty of room left in day', pct };
    if (pct < 90) return { label:`${pct.toFixed(0)}% used`, color:'var(--gold)',  desc:'Most of avg range done',     pct };
    return              { label:`${pct.toFixed(0)}% used`, color:'var(--red)',   desc:'Range exhausted — fade extremes', pct };
  }

  /* 3. Previous Day High / Low + distance */
  function detectPDHPDL(c1h) {
    if (c1h.length < 30) return null;
    const now = new Date();
    const todayStart     = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const yesterdayStart = todayStart - 86400000;
    const ydayBars = c1h.filter(c => c.t >= yesterdayStart && c.t < todayStart);
    if (!ydayBars.length) return null;
    const pdh = Math.max(...ydayBars.map(c=>c.h));
    const pdl = Math.min(...ydayBars.map(c=>c.l));
    const cur = c1h.at(-1).c;
    const distH = ((pdh - cur) / cur * 100);
    const distL = ((cur - pdl) / cur * 100);
    let status, color;
    if (cur > pdh)         { status = 'Above PDH (swept high)';  color = 'var(--green)'; }
    else if (cur < pdl)    { status = 'Below PDL (swept low)';   color = 'var(--red)'; }
    else if (distH < 0.5)  { status = 'Approaching PDH';         color = 'var(--orange)'; }
    else if (distL < 0.5)  { status = 'Approaching PDL';         color = 'var(--orange)'; }
    else                   { status = 'Inside yesterday range';  color = 'var(--text-sub)'; }
    return { pdh, pdl, status, color, distH, distL };
  }

  /* 4. Weekly open bias */
  function detectWeeklyOpen(c4) {
    if (c4.length < 10) return null;
    const now = new Date();
    const dow = now.getUTCDay();
    const offsetDays = dow === 0 ? 6 : dow - 1;
    const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offsetDays);
    const weekBars = c4.filter(c => c.t >= monday);
    if (!weekBars.length) return null;
    const wkOpen = weekBars[0].o;
    const cur = c4.at(-1).c;
    const pct = ((cur - wkOpen) / wkOpen) * 100;
    const above = cur > wkOpen;
    return {
      wkOpen, cur, pct, above,
      label: above ? `Above WO ▲ +${pct.toFixed(2)}%` : `Below WO ▼ ${pct.toFixed(2)}%`,
      color: above ? 'var(--green)' : 'var(--red)',
      desc:  above ? 'Bullish weekly bias' : 'Bearish weekly bias',
    };
  }

  /* 5. Day-of-week seasonality */
  function detectSeasonality(c1d) {
    if (!c1d || c1d.length < 30) return null;
    const map = DAYS.map(() => ({ wins: 0, total: 0 }));
    c1d.forEach(c => {
      const d = new Date(c.t).getUTCDay();
      map[d].total++;
      if (c.c > c.o) map[d].wins++;
    });
    const todayDow = new Date().getUTCDay();
    const todayWR  = map[todayDow].total ? (map[todayDow].wins / map[todayDow].total) * 100 : 50;
    const all = map.map((m,i)=>({ day: DAYS[i], wr: m.total ? m.wins/m.total*100 : 50, n: m.total }));
    const weekdays = all.slice(1,6);
    const best  = [...weekdays].sort((a,b)=>b.wr-a.wr).slice(0,2);
    const worst = [...weekdays].sort((a,b)=>a.wr-b.wr).slice(0,2);
    const color = todayWR >= 55 ? 'var(--green)' : todayWR <= 45 ? 'var(--red)' : 'var(--text-sub)';
    return {
      todayDay: DAYS[todayDow], todayWR, best, worst, color,
      label: `${DAYS[todayDow]}: ${todayWR.toFixed(0)}% green`,
      desc:  `Best: ${best.map(b=>b.day).join(', ')} · Worst: ${worst.map(w=>w.day).join(', ')}`,
    };
  }

  /* 6. Asian range (last completed Asian session) */
  function detectAsianRange(c1h) {
    if (c1h.length < 30) return null;
    const now = new Date();
    const utcH = now.getUTCHours();
    const asianEnd = utcH >= 9
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9)
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 9);
    const asianStart = asianEnd - 13 * 3600 * 1000;
    const bars = c1h.filter(c => c.t >= asianStart && c.t < asianEnd);
    if (!bars.length) return null;
    const aHi = Math.max(...bars.map(c=>c.h));
    const aLo = Math.min(...bars.map(c=>c.l));
    const cur = c1h.at(-1).c;
    let status, color;
    if (cur > aHi)      { status = 'Above Asian high — bullish breakout'; color = 'var(--green)'; }
    else if (cur < aLo) { status = 'Below Asian low — bearish breakdown'; color = 'var(--red)'; }
    else                { status = 'Inside Asian range — wait for break';  color = 'var(--text-sub)'; }
    return { aHi, aLo, status, color };
  }

  /* ── Best / worst personal hours from trade log ──────── */
  function getBestWorst() {
    const raw = (typeof DB !== 'undefined' && DB.getTradesRaw) ? DB.getTradesRaw() : (typeof DB !== 'undefined' ? DB.getTrades() : []);
    const closed = (raw||[]).filter(t => t.result !== '' && t.result != null);
    const hmap = {};
    closed.forEach(t => {
      const d = new Date(t.date); if (isNaN(d)) return;
      const h = d.getUTCHours();
      if (!hmap[h]) hmap[h] = { wins:0, total:0 };
      hmap[h].total++;
      if (parseFloat(t.result) > 0) hmap[h].wins++;
    });
    const hours = Object.entries(hmap).filter(([,v])=>v.total>=3)
      .map(([h,v])=>({ h:+h, wr:v.wins/v.total, n:v.total })).sort((a,b)=>b.wr-a.wr);
    // ICT rating from current killzone status (NY-local-aware)
    const inKZ = kzStatus().some(k => k.active && (k.name === 'London Open KZ' || k.name === 'NY Open KZ'));
    const inOffHours = (() => {
      // 'avoid' window = 03:00–06:00 NY (between Asian close and London open) and 12:30–15:30 NY (NY lunch)
      const nyParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
      const nyH = parseInt(nyParts.find(p => p.type === 'hour').value);
      const nyM = parseInt(nyParts.find(p => p.type === 'minute').value);
      const h = nyH + nyM/60;
      return (h >= 3 && h < 6) || (h >= 12.5 && h < 15.5);
    })();
    const ict = inKZ ? 'good' : inOffHours ? 'avoid' : 'neutral';
    return { best:hours.slice(0,2), worst:hours.slice(-2).reverse(), ict };
  }

  /* ══════════════════════════════════════════════════════
     RUN ANALYSIS
  ══════════════════════════════════════════════════════ */
  function runAnalysis() {
    const c4  = _candles['4h']  || [];
    const c1  = _candles['1h']  || [];
    const c1d = _candles['1d']  || [];
    const c1w = _candles['1w']  || [];
    if (!c4.length) return null;

    // Pick "primary" candle set based on user's TF toggle — drives Trend, Structure, P/D, Volatility
    const primaryMap = { '1h': c1, '4h': c4, '1d': c1d, '1w': c1w };
    const primary = (primaryMap[_tf] && primaryMap[_tf].length) ? primaryMap[_tf] : c4;

    const pd = allPD();
    const formations = detectFormations();
    const enriched = formations.map(f => ({ ...f, meta: SIG_META[f.type] || null, tier: tierFor(f, formations) }));
    const conf = detectConfluence(pd);
    return {
      // active analysis TF
      tf: _tf,
      // core (driven by selected TF)
      trend:      detectTrend(primary),
      premDisc:   detectPremDisc(primary),
      structure:  detectStructure(primary),
      amd:        detectAMD(),
      // extended
      volatility: detectVolatility(primary),
      dailyRange: detectDailyRange(c1, c1d),
      pdhPdl:     detectPDHPDL(c1),
      weeklyOpen: detectWeeklyOpen(c4),
      seasonality:detectSeasonality(c1d),
      asianRange: detectAsianRange(c1),
      // pd + signals
      pdArrays:   pd,
      confluence: conf,
      pdDir:      pdDirection(conf),
      formations: enriched,
      liqSweeps:  detectLiqSweep(c1.length ? c1 : c4),
      bestWorst:  getBestWorst(),
    };
  }

  /* ══════════════════════════════════════════════════════
     RENDERERS
  ══════════════════════════════════════════════════════ */
  function renderClocks() {
    const ct = getCityTimes();
    const kz = kzStatus();
    const activeKZ = kz.find(k => k.active);
    return `<div class="dojo-clocks">
      ${ct.map(c => `<div class="dojo-clock-card"><span class="dojo-flag">${c.flag}</span><span class="dojo-clk-label">${c.label}</span><span class="dojo-clk-time">${c.time}</span></div>`).join('')}
      <div class="dojo-clock-card${activeKZ?' kz-lit':''}">
        <span class="dojo-flag">⚡</span>
        <span class="dojo-clk-label">Killzone</span>
        <span class="dojo-clk-time" style="color:${activeKZ?'var(--green)':'var(--text-sub)'};font-size:.85rem">${activeKZ ? activeKZ.name : 'Off-hours'}</span>
      </div>
    </div>`;
  }

  function renderTimeline() {
    const now = new Date();
    const h = now.getUTCHours() + now.getUTCMinutes()/60;
    const pct = v => (v/24*100).toFixed(2)+'%';
    const wid = (s,e) => ((e>s?e-s:24-s+e)/24*100).toFixed(2)+'%';

    // Sessions in NY-local terms, converted to UTC dynamically
    const off = nyOffsetHours();
    const ny2utc = nyH => ((nyH - off) + 24) % 24;
    // Tokyo session 19:00-04:00 NY (overlaps midnight); London 03:00-12:00 NY; NY 08:00-17:00 NY
    const sessions = [
      { name:'Tokyo',  sNY:19, eNY:28,  bg:'rgba(0,212,200,.18)',  bd:'var(--teal)' },     // wraps midnight
      { name:'London', sNY:3,  eNY:12,  bg:'rgba(79,142,247,.18)', bd:'var(--accent)' },
      { name:'NY',     sNY:8,  eNY:17,  bg:'rgba(255,140,66,.18)', bd:'var(--orange)' },
    ];

    const sessionBlocks = sessions.map(s => {
      const su = ny2utc(s.sNY), eu = ny2utc(s.eNY % 24);
      // Handle wrap (e.g. Tokyo crosses midnight)
      if (s.eNY > 24 || eu < su) {
        return [
          { name:s.name, s:su, e:24,  bg:s.bg, bd:s.bd },
          { name:s.name, s:0,  e:eu, bg:s.bg, bd:s.bd },
        ];
      }
      return [{ name:s.name, s:su, e:eu, bg:s.bg, bd:s.bd }];
    }).flat();

    // Killzones (already UTC-converted via KZS())
    const kzColorMap = { 'Asian KZ':'rgba(0,212,200,.45)', 'London Open KZ':'rgba(79,142,247,.5)', 'NY Open KZ':'rgba(255,140,66,.5)', 'London Close KZ':'rgba(245,200,66,.5)' };
    const kzBlocks = KZS().map(kz => {
      if (kz.start < kz.end) return [{ s:kz.start, e:kz.end, bg:kzColorMap[kz.name] }];
      return [
        { s:kz.start, e:24,     bg:kzColorMap[kz.name] },
        { s:0,        e:kz.end, bg:kzColorMap[kz.name] },
      ];
    }).flat().filter(b => b.e > b.s);

    return `<div class="dojo-timeline-wrap">
      <div class="dojo-tl-label">24h UTC Session Map · NY offset ${off>=0?'+':''}${off}h</div>
      <div class="dojo-timeline">
        ${sessionBlocks.map(s=>`<div class="dojo-sess-block" style="left:${pct(s.s)};width:${wid(s.s,s.e)};background:${s.bg};border-top:2px solid ${s.bd}" title="${s.name}"><span>${s.name}</span></div>`).join('')}
        ${kzBlocks.map(k=>`<div class="dojo-kz-block" style="left:${pct(k.s)};width:${wid(k.s,k.e)};background:${k.bg}"></div>`).join('')}
        <div class="dojo-now-line" style="left:${pct(h)}"><span class="dojo-now-label">NOW</span></div>
        ${[0,3,6,9,12,15,18,21].map(t=>`<span class="dojo-hr-tick" style="left:${pct(t)}">${String(t).padStart(2,'0')}</span>`).join('')}
      </div>
    </div>`;
  }

  /* ── Core conditions (4 cards) ──────────────────────── */
  function renderCoreCards(s) {
    const tfTag = `<span class="dojo-tf-tag">${TF_LABEL[s.tf]}</span>`;
    const closed = isCollapsed('core');
    return `<div class="dojo-section" data-panel="core">
      <div class="dojo-sec-hdr"><span>Core Conditions</span>${panelToggle('core','core conditions')}</div>
      <div class="${closed?'panel-hidden':''}">
      <div class="dojo-cards">
      <div class="dojo-card">
        <div class="dojo-card-lbl">Market Condition ${tfTag}</div>
        <div class="dojo-card-val" style="color:${s.trend.color}">${s.trend.icon} ${s.trend.label}</div>
      </div>
      <div class="dojo-card">
        <div class="dojo-card-lbl">Premium / Discount ${tfTag}</div>
        <div class="dojo-card-val" style="color:${s.premDisc.color}">${s.premDisc.zone}</div>
        <div class="dojo-progress"><div class="dojo-progress-fill" style="width:${s.premDisc.pct.toFixed(0)}%;background:${s.premDisc.color}"></div></div>
        <div class="dojo-card-sub">${s.premDisc.pct.toFixed(0)}% of range · EQ: ${fmtP(s.premDisc.mid)}</div>
      </div>
      <div class="dojo-card">
        <div class="dojo-card-lbl">AMD Phase</div>
        <div class="dojo-card-val" style="color:${s.amd.color}">${s.amd.phase}</div>
        <div class="dojo-card-sub">${s.amd.desc}</div>
      </div>
      <div class="dojo-card">
        <div class="dojo-card-lbl">Market Structure ${tfTag}</div>
        <div class="dojo-card-val" style="color:${s.structure.color}">${s.structure.label}</div>
      </div>
    </div></div></div>`;
  }

  /* ── Extended conditions (6 cards) ──────────────────── */
  function renderExtendedCards(s) {
    const closed = isCollapsed('extended');
    const card = (lbl, val, sub, color) =>
      `<div class="dojo-card">
        <div class="dojo-card-lbl">${lbl}</div>
        <div class="dojo-card-val" style="color:${color||'var(--text)'}">${val}</div>
        ${sub ? `<div class="dojo-card-sub">${sub}</div>` : ''}
      </div>`;

    const pdhl = s.pdhPdl;
    const pdhSub = pdhl ? `PDH ${fmtP(pdhl.pdh)} · PDL ${fmtP(pdhl.pdl)}` : '';
    const wo   = s.weeklyOpen;
    const woSub= wo ? `Open: ${fmtP(wo.wkOpen)} · ${wo.desc}` : '';
    const ar   = s.asianRange;
    const arSub= ar ? `Asia Hi ${fmtP(ar.aHi)} · Lo ${fmtP(ar.aLo)}` : '';
    const seas = s.seasonality;

    return `<div class="dojo-section" data-panel="extended" style="margin-top:18px">
      <div class="dojo-sec-hdr"><span>Extended Conditions</span>${panelToggle('extended','extended conditions')}</div>
      <div class="${closed?'panel-hidden':''}">
        <div class="dojo-cards dojo-cards-6">
          ${card(`Volatility (${TF_LABEL[s.tf]} ATR)`, s.volatility.label, s.volatility.desc, s.volatility.color)}
          ${card('Daily Range Used',     s.dailyRange.label, s.dailyRange.desc, s.dailyRange.color)}
          ${card('Previous Day H/L',     pdhl ? pdhl.status : '—', pdhSub, pdhl ? pdhl.color : 'var(--text-sub)')}
          ${card('Weekly Open Bias',     wo ? wo.label : '—', woSub, wo ? wo.color : 'var(--text-sub)')}
          ${card('Day-of-Week Bias',     seas ? seas.label : '—', seas ? seas.desc : '', seas ? seas.color : 'var(--text-sub)')}
          ${card('Asian Range',          ar ? ar.status : '—', arSub, ar ? ar.color : 'var(--text-sub)')}
        </div>
      </div>
    </div>`;
  }

  /* ── Generic panel collapse helpers ────────────────── */
  function panelToggle(panelId, label) {
    const closed = isCollapsed(panelId);
    return `<button class="panel-toggle" onclick="DojoTab._togglePanel('${panelId}')" title="${closed?'Show':'Hide'} ${label}">${closed?'▶':'▼'}</button>`;
  }

  /* ── Email link generator for dinosaur fire ─────────── */
  function buildSetupEmail(s) {
    const cur = parseFloat(_ticker?.lastPrice || 0);
    const dir = s.pdDir.label.includes('BULL') ? 'Long' : s.pdDir.label.includes('BEAR') ? 'Short' : 'Neutral';
    const bulls = s.pdArrays.filter(p => p.dir === 'bull');
    const bears = s.pdArrays.filter(p => p.dir === 'bear');
    let stop = cur;
    if (dir === 'Long' && bulls.length)       stop = Math.min(...bulls.map(p => p.bot)) * 0.998;
    else if (dir === 'Short' && bears.length) stop = Math.max(...bears.map(p => p.top)) * 1.002;
    const risk = Math.abs(cur - stop) || cur * 0.005;
    const tp1 = dir === 'Long' ? cur + risk     : cur - risk;
    const tp2 = dir === 'Long' ? cur + 2 * risk : cur - 2 * risk;
    const tp3 = dir === 'Long' ? cur + 3 * risk : cur - 3 * risk;
    const topSig = s.formations.find(f => f.tier === 'A') || s.formations[0];
    const grade  = topSig?.tier || 'B';
    const hold   = topSig?.meta?.holdTime || 'Variable';
    const fmt    = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp(_pair), maximumFractionDigits: dp(_pair) });

    const subj = `🦖 ${_pair} Confluence Alert — ${s.pdDir.label}`;
    const body =
`🦖 PD Array Confluence Alert — ${_pair}
${new Date().toUTCString()}

DIRECTION:    ${dir}
GRADE:        ${grade}
HOLD TIME:    ${hold}
CONFLUENCE:   ${s.confluence.bulls}↑ bull · ${s.confluence.bears}↓ bear arrays near price

SUGGESTED SETUP
  Entry:      ${fmt(cur)}
  Stop:       ${fmt(stop)}  (${(risk/cur*100).toFixed(2)}% risk)
  TP1 (1R):   ${fmt(tp1)}
  TP2 (2R):   ${fmt(tp2)}
  TP3 (3R):   ${fmt(tp3)}

CURRENT CONDITIONS
  Trend:      ${s.trend.label}
  P/D:        ${s.premDisc.zone} (${s.premDisc.pct.toFixed(0)}%)
  Structure:  ${s.structure.label}
  AMD Phase:  ${s.amd.phase}
  Volatility: ${s.volatility.label}
  Day Bias:   ${s.seasonality ? s.seasonality.label : '—'}

PD ARRAYS NEAR PRICE
${s.pdArrays.slice(0, 10).map(p => `  · ${p.tf}  ${p.label}  @  ${fmt((p.top+p.bot)/2)}`).join('\n')}

TOP FORMATION SIGNALS
${s.formations.slice(0, 5).map(f => `  · [${f.tier}] ${f.type}  (${f.tf})  ${f.desc}`).join('\n')}

— Generated by AI Dashboard ICT Dojo`;

    return `mailto:jamalpeace@live.co.uk?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
  }

  /* ── Dinosaur beep (Web Audio — no file needed) ─────── */
  function playDinoBeep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const tones = [880, 1320, 1760]; // A5, E6, A6
      tones.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value = 0.0001;
        osc.connect(gain); gain.connect(ctx.destination);
        const start = ctx.currentTime + i * 0.16;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
        osc.start(start); osc.stop(start + 0.15);
      });
      setTimeout(() => ctx.close(), 1000);
    } catch (e) { console.warn('Beep failed:', e); }
  }

  function maybeFireDino(conf, signals) {
    if (!conf || !conf.dino) {
      if (!conf || !conf.dino) _dinoArmed = true; // re-arm when confluence drops
      return;
    }
    if (!_dinoArmed) return;
    // fired in last 10 minutes? skip
    if (Date.now() - _lastDinoFire < 10 * 60 * 1000) return;
    _lastDinoFire = Date.now();
    _dinoArmed = false;
    playDinoBeep();
    // Browser notification (if user previously allowed)
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification(`🦖 ${_pair} confluence — ${signals.pdDir.label}`, { body: 'Open ICT Dojo for full setup' }); } catch {}
    }
  }

  /* ── PD Arrays section (collapsible details) ─────────── */
  function renderPD(s) {
    const conf = s.confluence;
    const dir  = s.pdDir;
    const bulls = s.pdArrays.filter(p=>p.dir==='bull');
    const bears = s.pdArrays.filter(p=>p.dir==='bear');
    const row = p => `<div class="dojo-pd-row"><span class="badge badge-dim" style="font-size:.6rem">${p.tf}</span><span class="dojo-pd-lbl">${p.label}</span><span class="dojo-pd-price">${fmtP((p.top+p.bot)/2)}</span></div>`;

    const dirClass = dir.label === 'BULL DOMINANT' ? 'dir-bull'
                   : dir.label === 'BEAR DOMINANT' ? 'dir-bear'
                   : dir.label === 'NEUTRAL'       ? 'dir-neutral'
                   : 'dir-unsure';

    const dino = conf.dino ? `
      <div class="dojo-dino">
        <div style="flex:1">🦖 ${conf.total}+ PD ARRAY CONFLUENCE — High probability area!</div>
        <a href="${buildSetupEmail(s)}" class="btn-primary btn-sm dino-email-btn" target="_blank">📧 Email Setup</a>
      </div>` : '';

    const detailsClosed = isCollapsed('pdDetails');
    return `<div class="dojo-section" data-panel="pd">
      <div class="dojo-sec-hdr">
        <span>Active PD Arrays <span class="badge badge-dim" style="font-size:.65rem">${conf.bulls}↑ bull · ${conf.bears}↓ bear near price</span></span>
      </div>
      <div class="dojo-dir-badge ${dirClass}">
        <div class="dojo-dir-icon">${dir.icon}</div>
        <div class="dojo-dir-text">
          <div class="dojo-dir-label">${dir.label}</div>
          <div class="dojo-dir-desc">${dir.desc}</div>
        </div>
      </div>
      ${dino}
      <div class="dojo-pd-details-toggle">
        <button class="btn-ghost btn-sm" onclick="DojoTab._togglePanel('pdDetails')">
          ${detailsClosed ? '▶ Show PD array details' : '▼ Hide PD array details'}
        </button>
      </div>
      <div class="dojo-pd-grid${detailsClosed?' panel-hidden':''}">
        <div class="dojo-pd-col"><div class="dojo-pd-col-hdr" style="color:var(--green)">▲ Bullish (${bulls.length})</div>${bulls.length?bulls.map(row).join(''):'<p class="text-dim" style="font-size:.8rem;padding:8px 0">None nearby</p>'}</div>
        <div class="dojo-pd-col"><div class="dojo-pd-col-hdr" style="color:var(--red)">▼ Bearish (${bears.length})</div>${bears.length?bears.map(row).join(''):'<p class="text-dim" style="font-size:.8rem;padding:8px 0">None nearby</p>'}</div>
      </div>
    </div>`;
  }

  /* ── Rich Formation Signals table ───────────────────── */
  function renderFormationsTable(s) {
    const closed = isCollapsed('formations');
    if (!s.formations.length) {
      return `<div class="dojo-section" data-panel="formations">
        <div class="dojo-sec-hdr"><span>Formation Signals</span>${panelToggle('formations','formation signals')}</div>
        <div class="${closed?'panel-hidden':''}"><p class="text-dim" style="font-size:.85rem">No formation signals on current candles</p></div>
      </div>`;
    }
    const tfChip = (tf) => {
      const colors = { '15m':'var(--gold)', '1h':'var(--accent)', '4h':'var(--orange)', '1d':'var(--red)' };
      const col = colors[tf] || 'var(--text-sub)';
      return `<span class="dojo-tf-chip">${tf} <span class="dojo-tf-diamond" style="color:${col}">◆</span></span>`;
    };
    const tierBadge = (t) => `<span class="dojo-tier dojo-tier-${t.toLowerCase()}">${t}</span>`;
    return `<div class="dojo-section" data-panel="formations">
      <div class="dojo-sec-hdr"><span>Formation Signals</span>${panelToggle('formations','formation signals')}</div>
      <div class="${closed?'panel-hidden':''}">
      <table class="dojo-sig-table">
        <thead>
          <tr>
            <th>Signal</th>
            <th>Best TF</th>
            <th>Best days</th>
            <th>Hold time</th>
            <th>Why this day/TF</th>
            <th>Tier</th>
          </tr>
        </thead>
        <tbody>
          ${s.formations.map(f => {
            const m = f.meta;
            const sigCell = `<div style="display:flex;align-items:center;gap:6px"><span style="color:${f.color};font-weight:600">${f.type}</span></div><div class="text-dim" style="font-size:.7rem;margin-top:2px">${f.desc}</div>`;
            return `<tr>
              <td>${sigCell}</td>
              <td>${m ? m.bestTF.map(tfChip).join(' ') : '—'}</td>
              <td>${m ? m.bestDays.join(', ') : '—'}</td>
              <td>${m ? m.holdTime : '—'}</td>
              <td class="dojo-why-cell">${m ? m.why : '—'}</td>
              <td>${tierBadge(f.tier)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
    </div>`;
  }

  /* ── Times to Trade — split into 2 cards ─────────────── */
  function renderTimesAndSweeps(s) {
    const closed = isCollapsed('times');
    const bw = s.bestWorst;
    const ictMap = {
      good:    ['✅ Good time — killzone active', 'var(--green)'],
      avoid:   ['⛔ Avoid — off-hours',           'var(--red)'],
      neutral: ['🟡 Neutral — low conviction',    'var(--gold)'],
    };
    const [ictLabel, ictColor] = ictMap[bw.ict];
    const activeKZ = kzStatus().find(k => k.active);
    const nextKZ   = kzStatus().filter(k => !k.active).sort((a,b) => a.minsTo - b.minsTo)[0];
    const hLabel = h => `${String(h).padStart(2,'0')}:00 UTC`;

    const sweepHtml = s.liqSweeps.length
      ? s.liqSweeps.map(sw=>`<div class="dojo-sig-row" style="color:${sw.color}">⚡ ${sw.label}</div>`).join('')
      : '<p class="text-dim" style="font-size:.8rem">No active sweep detected</p>';

    return `<div class="dojo-section" data-panel="times">
      <div class="dojo-sec-hdr"><span>Timing &amp; Sweeps</span>${panelToggle('times','timing cards')}</div>
      <div class="${closed?'panel-hidden':''}">
      <div class="dojo-sig-grid">
      <div class="dojo-card">
        <div class="dojo-card-lbl">ICT Killzone Status</div>
        <div class="dojo-card-val" style="color:${ictColor}">${ictLabel}</div>
        <div class="dojo-card-sub" style="margin-top:8px">${activeKZ ? `🟢 <strong>${activeKZ.name}</strong> active now` : 'No killzone active'}</div>
        <div class="dojo-card-sub">${nextKZ ? `Next: ${nextKZ.name} in ${fmtCD(nextKZ.minsTo)}` : ''}</div>
      </div>
      <div class="dojo-card">
        <div class="dojo-card-lbl">Your Personal Hours</div>
        <div class="dojo-card-val" style="font-size:.85rem">📊 From your trade log</div>
        <div class="dojo-card-sub" style="margin-top:8px;color:var(--green)">📈 Best: ${bw.best.length ? bw.best.map(x=>`${hLabel(x.h)} (${(x.wr*100).toFixed(0)}% WR · ${x.n} trades)`).join('<br>') : 'Log more trades'}</div>
        <div class="dojo-card-sub" style="color:var(--red);margin-top:6px">📉 Worst: ${bw.worst.length ? bw.worst.map(x=>`${hLabel(x.h)} (${(x.wr*100).toFixed(0)}% WR · ${x.n} trades)`).join('<br>') : '—'}</div>
      </div>
      <div class="dojo-card">
        <div class="dojo-card-lbl">Liquidity Sweeps</div>
        ${sweepHtml}
      </div>
      </div>
      </div>
    </div>`;
  }

  /* ── Pair selector (chips) ──────────────────────────── */
  function renderPairChips() {
    return `<div class="dojo-pair-chips">
      ${_customPairs.map(p => {
        const active = p === _pair;
        const isProtected = PROTECTED.includes(p);
        return `<div class="dojo-pair-chip${active?' active':''}">
          <span onclick="DojoTab._pair('${p}')" style="cursor:pointer">${p.replace('USDT','')}</span>
          ${!isProtected ? `<button onclick="DojoTab._removePair('${p}')" class="chip-rm" title="Remove">✕</button>` : ''}
        </div>`;
      }).join('')}
      <div class="dojo-pair-add">
        <input type="text" id="dojoCustomPair" placeholder="+ Add pair (e.g. SOL)" maxlength="20"
          onkeydown="if(event.key==='Enter'){DojoTab._addPair(this.value);this.value=''}" />
      </div>
    </div>`;
  }

  /* ── Partial updates ─────────────────────────────────── */
  function updateStatus(msg) {
    const el = document.getElementById('dojoStatus');
    if (el) el.innerHTML = msg || (_fetchErr ? `<span style="color:var(--red)">⚠ ${_fetchErr}</span>` : `<span class="text-dim">Updated ${_lastFetch ? ago(_lastFetch) : '…'}</span>`);
  }

  function updateBody() {
    updateStatus();
    const el = document.getElementById('dojoBody');
    if (!el) return;
    if (_fetchErr) { el.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><p>Could not reach Binance: ${_fetchErr}</p><p class="text-dim" style="font-size:.85rem">Check your pair name (must be a valid Binance USDT pair) and connection.</p></div>`; return; }
    if (!_signals) { el.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p>Waiting for data…</p></div>`; return; }
    const tickEl = document.getElementById('dojoTicker');
    if (tickEl && _ticker) {
      const chg = parseFloat(_ticker.priceChangePercent);
      tickEl.innerHTML = `<span class="dojo-price">${fmtP(parseFloat(_ticker.lastPrice))}</span> <span style="color:${chg>=0?'var(--green)':'var(--red)'}">${chg>=0?'+':''}${chg.toFixed(2)}% 24h</span>`;
    }
    el.innerHTML =
      renderCoreCards(_signals) +
      renderExtendedCards(_signals) +
      renderPD(_signals) +
      renderFormationsTable(_signals) +
      renderTimesAndSweeps(_signals);

    // 🦖 Dinosaur alert side-effects (sound + browser notification)
    maybeFireDino(_signals.confluence, _signals);
  }

  function startTick() {
    if (_clockTimer) clearInterval(_clockTimer);
    _clockTimer = setInterval(() => {
      const cl = document.getElementById('dojoClocks');
      if (!cl) { clearInterval(_clockTimer); return; }
      cl.innerHTML = renderClocks();
    }, 1000);
  }

  /* ── Full render ─────────────────────────────────────── */
  function render() {
    if (_pollTimer)  clearInterval(_pollTimer);
    if (_clockTimer) clearInterval(_clockTimer);

    const content = document.getElementById('content');
    content.innerHTML = `<div class="dojo-wrap">

      <div class="dojo-top-bar">
        ${renderPairChips()}
        <div id="dojoTicker" class="dojo-ticker">—</div>
        <div id="dojoStatus" class="text-dim" style="font-size:.78rem">Connecting…</div>
        <button class="btn-ghost btn-sm" onclick="DojoTab._refresh()">↻ Refresh</button>
      </div>

      <div id="dojoClocks">${renderClocks()}</div>
      ${renderTimeline()}

      <div class="dojo-tf-bar">
        <span class="dojo-tf-label">Analysis Timeframe:</span>
        <div class="dojo-tf-tabs">
          ${TFS.map(tf => `<button class="dojo-tf-btn${_tf===tf?' active':''}" data-tf="${tf}" onclick="DojoTab._setTF('${tf}')">${TF_LABEL[tf]}</button>`).join('')}
        </div>
        <span class="text-dim" style="font-size:.75rem;margin-left:auto">Drives Trend, Structure, P/D, Volatility ↓</span>
      </div>

      <div id="dojoBody" style="margin-top:16px">
        <div class="loading-state">Fetching live data from Binance…</div>
      </div>

    </div>`;

    // Request browser notification permission on first render (one-time prompt)
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch {}
    }

    startTick();
    loadData();
    _pollTimer = setInterval(loadData, 60000);
  }

  return {
    render,
    _pair:    p   => { _pair = p; render(); },
    _refresh: ()  => loadData(),
    _addPair: raw => {
      const sym = (raw||'').trim().toUpperCase().replace('/', '');
      if (!sym) return;
      const full = sym.endsWith('USDT') ? sym : sym + 'USDT';
      if (!_customPairs.includes(full)) {
        _customPairs.push(full);
        savePairs();
      }
      _pair = full;
      render();
    },
    _removePair: sym => {
      if (PROTECTED.includes(sym)) return;
      _customPairs = _customPairs.filter(p => p !== sym);
      savePairs();
      if (_pair === sym) _pair = PROTECTED[0];
      render();
    },
    _setTF: tf => {
      if (_tf === tf || !TFS.includes(tf)) return;
      _tf = tf;
      localStorage.setItem('jb_dojo_tf', tf);
      // Toggle active button without full re-render
      document.querySelectorAll('.dojo-tf-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tf === tf);
      });
      // Re-run analysis with new primary TF (no re-fetch needed — we have all candles)
      if (_candles['4h'] && _candles['4h'].length) {
        _signals = runAnalysis();
        updateBody();
      }
    },
    _togglePanel: id => {
      _panels[id] = !_panels[id];
      savePanels();
      updateBody();
    },
    _testDino: () => { _dinoArmed = true; _lastDinoFire = 0; playDinoBeep(); },
  };

})();
