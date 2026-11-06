// Mock data + layout for the month view. Today = Wed 28 Oct 2026, week starts Monday.
const DAY = 864e5;
const D = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const YEAR = 2026, MONTH = 9, TODAY = '2026-10-28', ROWS = 5;
const FIRST = Date.UTC(YEAR, MONTH, 1);
const LEAD = (new Date(FIRST).getUTCDay() + 6) % 7; // Monday-first offset
const G = FIRST - LEAD * DAY;
const LAST_I = LEAD + new Date(Date.UTC(YEAR, MONTH + 1, 0)).getUTCDate() - 1;
// Cell index -> day index. Month days that don't fit in 5 rows wrap into the top row's leading cells.
const cellDay = (r, c) => { const i = r * 7 + c; return r === 0 && i + ROWS * 7 <= LAST_I ? i + ROWS * 7 : i; };
const idx = s => Math.round((D(s) - G) / DAY);
const iso = i => new Date(G + i * DAY).toISOString().slice(0, 10);

export const CALS = {
  mum: { name: 'Mum', initial: 'M', color: 'var(--color-accent-500)' },
  dad: { name: 'Dad', initial: 'D', color: 'var(--color-accent-2-500)' },
  isla: { name: 'Isla', initial: 'I', color: 'oklch(0.66 0.09 350)' },
  theo: { name: 'Theo', initial: 'T', color: 'oklch(0.64 0.075 235)' },
  poppy: { name: 'Poppy', initial: 'P', color: 'oklch(0.62 0.09 300)' },
  home: { name: 'Household', initial: 'H', color: 'oklch(0.76 0.12 82)' },
};

const NIGHT = 'oklch(0.23 0.035 310)';
// Day art: a date gets an occasion; tiles pick up a tint + a small drawing.
export const DECOR = { '2026-10-31': 'halloween', '2026-10-21': 'birthday' };

export const THEMES = {
  halloween: {
    bg: NIGHT, surface: 'oklch(0.3 0.04 310)', text: 'var(--color-neutral-100)',
    muted: 'oklch(0.8 0.035 310)', faint: 'oklch(0.52 0.03 310)', line: 'oklch(0.3 0.04 310)',
    accent: 'var(--color-accent-400)', accentInk: 'var(--color-accent-300)',
    todayCell: `color-mix(in oklch, var(--color-accent-700) 70%, ${NIGHT})`, todayNumBg: 'var(--color-accent-400)', todayNumFg: 'var(--color-neutral-900)',
    panel: `color-mix(in oklch, var(--color-accent-800) 72%, ${NIGHT})`, panelText: 'var(--color-accent-100)', panelMuted: 'var(--color-accent-300)',
    tile: 'oklch(0.28 0.04 310)', tileOut: 'transparent',
    mixBase: NIGHT, mixPct: '52%', barText: 'var(--color-neutral-100)',
    veil: `color-mix(in oklch, ${NIGHT} 60%, transparent)`,
  },
  light: {
    bg: 'var(--color-bg)', surface: 'var(--color-surface)', text: 'var(--color-text)',
    muted: 'var(--color-neutral-700)', faint: 'var(--color-neutral-500)', line: 'var(--color-neutral-300)',
    accent: 'var(--color-accent)', accentInk: 'var(--color-accent-700)',
    todayCell: 'var(--color-accent-200)', todayNumBg: 'var(--color-accent-600)', todayNumFg: 'var(--color-neutral-100)',
    panel: 'var(--color-accent-2-200)', panelText: 'var(--color-accent-2-900)', panelMuted: 'var(--color-accent-2-700)',
    tile: 'var(--color-surface)', tileOut: 'var(--color-neutral-200)',
    mixBase: 'var(--color-bg)', mixPct: '36%', barText: 'var(--color-text)',
    veil: 'color-mix(in oklch, var(--color-bg) 58%, transparent)',
  },
  dark: {
    bg: 'var(--color-neutral-900)', surface: 'var(--color-neutral-800)', text: 'var(--color-neutral-100)',
    muted: 'var(--color-neutral-400)', faint: 'var(--color-neutral-600)', line: 'var(--color-neutral-800)',
    accent: 'var(--color-accent-400)', accentInk: 'var(--color-accent-300)',
    todayCell: 'color-mix(in oklch, var(--color-accent-800) 70%, var(--color-neutral-900))', todayNumBg: 'var(--color-accent-400)', todayNumFg: 'var(--color-neutral-900)',
    panel: 'var(--color-accent-2-900)', panelText: 'var(--color-accent-2-100)', panelMuted: 'var(--color-accent-2-300)',
    tile: 'color-mix(in oklch, var(--color-neutral-800) 70%, var(--color-neutral-900))', tileOut: 'transparent',
    mixBase: 'var(--color-neutral-900)', mixPct: '52%', barText: 'var(--color-neutral-100)',
    veil: 'color-mix(in oklch, var(--color-neutral-900) 58%, transparent)',
  },
};

const ALLDAY = [
  { c: 'mum', t: 'Edinburgh with Sarah', s: '2026-10-02', e: '2026-10-04' },
  { c: 'isla', t: 'Inset day', s: '2026-10-09' },
  { c: 'dad', t: 'Leeds work trip', s: '2026-10-13', e: '2026-10-15' },
  { c: 'isla', t: 'Brownies camp', s: '2026-10-17', e: '2026-10-18' },
  { c: 'theo', t: "Theo's birthday", s: '2026-10-21' },
  { c: 'home', t: 'Clocks go back', s: '2026-10-25' },
  { c: 'home', t: 'Half term', s: '2026-10-26', e: '2026-10-30' },
  { c: 'home', t: 'Halloween party', s: '2026-10-31' },
  { c: 'home', t: 'Grandma visiting', s: '2026-11-06', e: '2026-11-08' },
];
for (let i = idx('2026-09-29'), k = 0; i < 42; i += 7, k++) ALLDAY.push({ c: 'home', t: k % 2 ? 'General waste' : 'Recycling', s: iso(i) });

const TIMED = [];
const weekly = (c, t, at, first, skip = []) => { for (let i = idx(first); i < 42; i += 7) if (!skip.includes(iso(i))) TIMED.push({ c, t, at, s: iso(i) }); };
weekly('theo', 'Swimming', '17:30', '2026-09-28', ['2026-10-26']);
weekly('dad', '5-a-side', '20:00', '2026-09-29', ['2026-10-13']);
weekly('isla', 'Ballet', '16:15', '2026-09-30');
weekly('mum', 'Yoga', '19:00', '2026-10-01');
weekly('theo', 'Football', '09:30', '2026-10-03');
weekly('poppy', 'Rhyme time', '10:00', '2026-10-02');
[
  ['mum', 'Work drinks', '2026-10-01', '18:00'], ['mum', 'Book club', '2026-10-06', '19:30'],
  ['mum', 'Dentist', '2026-10-08', '10:30'], ['home', "Parents' evening", '2026-10-08', '18:00'],
  ['dad', 'Tip run', '2026-10-10', '10:00'], ['mum', 'Coffee with Jo', '2026-10-10', '11:00'],
  ['isla', 'Soft play party', '2026-10-10', '14:00'], ['home', "BBQ at Pete's", '2026-10-10', '17:00'],
  ['mum', 'Haircut', '2026-10-13', '12:00'], ['theo', 'Orthodontist', '2026-10-13', '15:40'], ['isla', 'Library', '2026-10-13', '16:30'],
  ['dad', 'Boiler service', '2026-10-16', '08:00'], ['theo', 'Playdate', '2026-10-19', '15:30'],
  ['mum', 'Collect cake', '2026-10-21', '12:00'], ['home', 'Birthday tea', '2026-10-21', '17:30'],
  ['home', "Dinner at Nan's", '2026-10-22', '18:30'], ['isla', "Sleepover at Maya's", '2026-10-24', '17:00'],
  ['mum', 'GP', '2026-10-28', '11:20'], ['dad', 'Call with Sam', '2026-10-28', '13:00'],
  ['theo', 'Cinema', '2026-10-29', '14:00'], ['home', 'Pumpkin carving', '2026-10-30', '15:00'],
  ['isla', 'Costume shop', '2026-10-31', '11:00'], ['home', 'Trick or treat', '2026-10-31', '17:30'],
  ['home', 'Sunday roast', '2026-11-01', '13:00'], ['dad', 'MOT', '2026-11-04', '09:00'],
  ['poppy', 'Jabs', '2026-10-14', '09:40'], ['poppy', 'Playgroup', '2026-10-20', '09:30'], ['poppy', 'Nursery visit', '2026-10-27', '10:00'],
].forEach(([c, t, s, at]) => TIMED.push({ c, t, s, at }));

const WX = [
  { icon: 'rain', hi: 14, lo: 8 }, { icon: 'cloudsun', hi: 13, lo: 7 },
  { icon: 'rain', hi: 11, lo: 6 }, { icon: 'sun', hi: 14, lo: 8 },
].map(w => ({ ...w, isRain: w.icon === 'rain', isSun: w.icon === 'sun', isCloudSun: w.icon === 'cloudsun' }));

function paint(c, T) {
  const C = CALS[c];
  return { color: C.color, initial: C.initial, who: C.name, bg: `color-mix(in oklch, ${C.color} ${T.mixPct}, ${T.mixBase})` };
}

export function buildMonth(theme = 'light', opts = {}) {
  const MAXL = opts.lanes || 4;
  const TM = opts.extraTimed ? TIMED.concat(opts.extraTimed) : TIMED;
  const T = THEMES[theme] || THEMES.light;
  const todayI = idx(opts.today || TODAY);
  const weeks = [];
  for (let w = 0; w < ROWS; w++) {
    const cells = [0, 1, 2, 3, 4, 5, 6].map(c => cellDay(w, c));
    const days = [], past = [];
    for (let d = 0; d < 7; d++) {
      const i = cells[d], dt = new Date(G + i * DAY), inMonth = dt.getUTCMonth() === MONTH, isToday = i === todayI;
      const occ = DECOR[iso(i)];
      const tint = occ === 'halloween' ? 'var(--color-accent-400)' : occ === 'birthday' ? CALS.theo.color : null;
      days.push({
        n: dt.getUTCDate(), col: d + 1, inMonth, isToday,
        isHalloween: occ === 'halloween', isBirthday: occ === 'birthday',
        cellBg: isToday ? T.todayCell : 'transparent',
        tileBg: isToday ? T.todayCell : tint ? `color-mix(in oklch, ${tint} 26%, ${T.tile})` : inMonth ? T.tile : T.tileOut,
        numBg: isToday ? T.todayNumBg : 'transparent',
        numFg: isToday ? T.todayNumFg : inMonth ? T.text : T.faint,
      });
    }
    // one veil per contiguous run of past days, so spanning bars dim evenly
    for (let d = 0; d < 7; d++) {
      if (cells[d] >= todayI) continue;
      let e = d; while (e + 1 < 7 && cells[e + 1] < todayI && cells[e + 1] === cells[e] + 1) e++;
      past.push({ col: `${d + 1} / span ${e - d + 1}` }); d = e;
    }
    const segs = [];
    for (const e of ALLDAY) {
      const s0 = idx(e.s), e0 = idx(e.e || e.s);
      let run = null;
      for (let d = 0; d <= 7; d++) {
        const hit = d < 7 && cells[d] >= s0 && cells[d] <= e0 && (!run || cells[d] === cells[d - 1] + 1);
        if (hit) { if (!run) run = { e, a: d }; run.b = d; continue; }
        if (run) { segs.push({ ...run, contL: s0 < cells[run.a], contR: e0 > cells[run.b] }); run = null; if (d < 7 && cells[d] >= s0 && cells[d] <= e0) { run = { e, a: d, b: d }; } }
      }
    }
    segs.sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a));
    const occ = Array.from({ length: 7 }, () => []);
    for (const s of segs) {
      let lane = 0;
      for (;;) { let free = true; for (let d = s.a; d <= s.b; d++) if (occ[d][lane]) { free = false; break; } if (free) break; lane++; }
      s.lane = lane; for (let d = s.a; d <= s.b; d++) occ[d][lane] = { kind: 'bar' };
    }
    const timedPlaced = [];
    for (let d = 0; d < 7; d++) {
      TM.filter(e => idx(e.s) === cells[d]).sort((x, y) => x.at.localeCompare(y.at)).forEach(e => {
        let lane = 0; while (occ[d][lane]) lane++;
        occ[d][lane] = { kind: 'timed' }; timedPlaced.push({ e, d, lane });
      });
    }
    const limit = occ.map(arr => arr.some((x, l) => x && l >= MAXL) ? MAXL - 1 : MAXL);
    const bars = [];
    for (const s of segs) {
      let run = null;
      const flush = () => {
        if (!run) return;
        const L = run.a === s.a && !s.contL, R = run.b === s.b && !s.contR;
        bars.push({
          ...paint(s.e.c, T), title: s.e.t, col: `${run.a + 1} / span ${run.b - run.a + 1}`, row: s.lane + 2,
          rl: L ? '999px' : '8px', rr: R ? '999px' : '8px', ml: L ? '8px' : '0px', mr: R ? '8px' : '0px',
        });
        run = null;
      };
      for (let d = s.a; d <= s.b; d++) { if (s.lane < limit[d]) { if (!run) run = { a: d, b: d }; else run.b = d; } else flush(); }
      flush();
    }
    const timed = timedPlaced.filter(p => p.lane < limit[p.d]).map(p => ({ ...paint(p.e.c, T), title: p.e.t, time: p.e.at, col: p.d + 1, row: p.lane + 2 }));
    const more = [];
    for (let d = 0; d < 7; d++) if (limit[d] < MAXL) {
      const hidden = occ[d].filter((x, l) => x && l >= limit[d]).length;
      more.push({ col: d + 1, row: limit[d] + 2, label: `+${hidden} more` });
    }
    weeks.push({ days, bars, timed, more, past });
  }
  const agenda = [0, 1, 2, 3].map(k => {
    const i = todayI + k, s = iso(i), dt = new Date(G + i * DAY);
    const wd = dt.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    const date = dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const items = [
      ...ALLDAY.filter(e => idx(e.s) <= i && idx(e.e || e.s) >= i).map(e => ({ ...paint(e.c, T), time: 'All day', title: e.t })),
      ...TM.filter(e => e.s === s).sort((x, y) => x.at.localeCompare(y.at)).map(e => ({ ...paint(e.c, T), time: e.at, title: e.t })),
    ];
    return { label: k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : wd, date, items, labelColor: k === 0 ? T.accentInk : T.text, ...WX[k] };
  });
  const forecast = WX.slice(1).map((w, k) => ({ ...w, short: agenda[k + 1].date.slice(0, 3) }));
  return { t: T, weeks, agenda, forecast, legend: Object.values(CALS) };
}

export { ALLDAY, TIMED, idx, iso, paint, G, DAY, TODAY };
