// Portrait (PR 5.9) mock data. Same family and today (Wed 28 Oct 2026, 14:24) as wall-data.js,
// plus a few events this week so the week shows overlaps and the "+N" chip.
import { THEMES, CALS, ALLDAY, TIMED, idx, iso, paint, G, DAY, TODAY, buildMonth } from './wall-data.js';

export const EXTRA = [
  { c: 'home', t: 'Park with cousins', s: '2026-10-26', at: '10:00', dur: 120 },
  { c: 'mum', t: 'Lunch with Jo', s: '2026-10-26', at: '12:30', dur: 90 },
  { c: 'poppy', t: 'Toddler group', s: '2026-10-28', at: '09:30', dur: 90 },
  { c: 'theo', t: "Playdate at Sam's", s: '2026-10-28', at: '15:30', dur: 150 },
  { c: 'mum', t: 'Pick up Isla', s: '2026-10-28', at: '17:00', dur: 30 },
  { c: 'poppy', t: 'Soft play', s: '2026-10-29', at: '10:00', dur: 90 },
  { c: 'dad', t: 'Haircut', s: '2026-10-30', at: '09:00', dur: 45 },
];
const DUR = { GP: 30, 'Call with Sam': 45, Ballet: 60, Swimming: 45, '5-a-side': 60, Yoga: 60, Football: 90, 'Rhyme time': 45, Cinema: 150, 'Pumpkin carving': 120, 'Costume shop': 60, 'Trick or treat': 120, 'Sunday roast': 120, 'Nursery visit': 60 };
const mins = at => +at.slice(0, 2) * 60 + +at.slice(3, 5);
const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const ALL_T = TIMED.concat(EXTRA).map(e => ({ ...e, m: mins(e.at), dur: e.dur || DUR[e.t] || 60 }));
const TODAY_I = idx(TODAY), WEEK0 = idx('2026-10-26'), NOW_M = 14 * 60 + 24;
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const WXD = {
  '2026-10-28': ['rain', 14, 8, 'Light showers'], '2026-10-29': ['cloudsun', 13, 7, 'Sunny spells'],
  '2026-10-30': ['rain', 11, 6, 'Rain'], '2026-10-31': ['sun', 14, 8, 'Sunny'], '2026-11-01': ['cloud', 12, 6, 'Cloudy'],
};
export function wx(s) {
  const w = WXD[s];
  if (!w) return { hasWx: false, isRain: false, isSun: false, isCloudSun: false, isCloud: false };
  const [icon, hi, lo, cond] = w;
  return { hasWx: true, isRain: icon === 'rain', isSun: icon === 'sun', isCloudSun: icon === 'cloudsun', isCloud: icon === 'cloud', hi, lo, cond, range: `${hi}° / ${lo}°` };
}
const dateOf = i => new Date(G + i * DAY);
const longDate = i => dateOf(i).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const theme = name => THEMES[name] || THEMES.light;
const tint = (T, c) => `color-mix(in oklch, ${c} 26%, ${T.tile})`;

function dayItems(i, T) {
  const s = iso(i);
  const all = ALLDAY.filter(e => idx(e.s) <= i && idx(e.e || e.s) >= i)
    .map(e => ({ ...paint(e.c, T), c: e.c, isAllDay: true, isTimed: false, isNow: false, time: 'All day', title: e.t, op: 1, m: -1 }));
  const tm = ALL_T.filter(e => e.s === s).sort((a, b) => a.m - b.m).map(e => {
    const end = e.m + e.dur, done = i < TODAY_I || (i === TODAY_I && end <= NOW_M);
    return { ...paint(e.c, T), c: e.c, isAllDay: false, isTimed: true, isNow: false, time: e.at, until: fmt(end), title: e.t, op: done ? 0.45 : 1, ongoing: i === TODAY_I && e.m <= NOW_M && end > NOW_M, m: e.m, dur: e.dur };
  });
  return [...all, ...tm];
}
const capped = (items, n) => ({ shown: items.slice(0, n), more: items.length > n ? `+${items.length - n} more` : '', hasMore: items.length > n });

// Month (Soft): six lanes a day, a today band on top and the next three days in a strip below.
export function buildPortraitMonth(name = 'light', opts = {}) {
  const T = theme(name);
  const d = buildMonth(name, { ...opts, lanes: 6, extraTimed: EXTRA });
  const ti = idx(opts.today || TODAY);
  const band = { ...capped(dayItems(ti, T), 6), ...wx(iso(ti)) };
  const strip = [1, 2, 3].map(k => {
    const i = ti + k, dt = dateOf(i);
    return { label: k === 1 ? 'Tomorrow' : dt.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }), ...capped(dayItems(i, T), 5), ...wx(iso(i)) };
  });
  return { ...d, band, strip };
}

// Week: seven columns on an hour scale. Past maxTracks, events collapse into a "+N" chip at their start.
export function buildWeek(name = 'light', o = {}) {
  const T = theme(name);
  const maxTracks = o.maxTracks ?? 2, H0 = o.start ?? 8, H1 = o.end ?? 21, R = (H1 - H0) * 60;
  const pct = m => `${(Math.max(0, Math.min(R, m)) / R * 100).toFixed(3)}%`;
  const nowPos = NOW_M - H0 * 60;
  const hours = [];
  for (let h = H0; h <= H1; h++) hours.push({ label: `${String(h).padStart(2, '0')}:00`, top: pct((h - H0) * 60), ty: h === H0 ? '-8%' : h === H1 ? '-92%' : '-50%', vis: Math.abs((h - H0) * 60 - nowPos) < 25 ? 'hidden' : 'visible' });
  const days = [];
  for (let k = 0; k < 7; k++) {
    const i = WEEK0 + k, s = iso(i), isToday = i === TODAY_I, past = i < TODAY_I;
    const evs = ALL_T.filter(e => e.s === s).sort((a, b) => a.m - b.m);
    const ends = [], placed = [];
    let cluster = [], cEnd = -1;
    const close = () => { const n = Math.min(maxTracks, Math.max(0, ...cluster.map(p => p.t + 1))); cluster.forEach(p => { p.tracks = n; }); cluster = []; };
    for (const e of evs) {
      if (e.m >= cEnd) { close(); ends.length = 0; }
      let t = 0; while (ends[t] > e.m) t++;
      ends[t] = e.m + e.dur; const p = { e, t }; placed.push(p); cluster.push(p); cEnd = Math.max(cEnd, e.m + e.dur);
    }
    close();
    const blocks = placed.filter(p => p.t < maxTracks).map(({ e, t, tracks }) => {
      const done = past || (isToday && e.m + e.dur <= NOW_M);
      return { ...paint(e.c, T), title: e.t, time: e.at, top: pct(e.m - H0 * 60), height: pct(e.dur), left: `${t / tracks * 100}%`, width: `${100 / tracks}%`,
        oneLine: e.dur < 50, multi: e.dur >= 50, showTime: !(e.dur < 50 && tracks > 1), op: done ? 0.45 : 1 };
    });
    const over = {};
    placed.filter(p => p.t >= maxTracks).forEach(({ e }) => { over[e.m] = (over[e.m] || 0) + 1; });
    const chips = Object.entries(over).map(([m, n]) => ({ top: pct(+m - H0 * 60), label: `+${n}` }));
    const occ = DECORISH[s];
    days.push({
      n: dateOf(i).getUTCDate(), wd: WD[k], col: k + 2, isToday,
      tileBg: isToday ? T.todayCell : occ ? `color-mix(in oklch, ${occ} 16%, ${T.tile})` : T.tile,
      numBg: isToday ? T.todayNumBg : 'transparent', numFg: isToday ? T.todayNumFg : T.text,
      ...wx(s), blocks, chips, rules: hours, hasNow: isToday, nowTop: pct(nowPos),
      items: dayItems(i, T), isHalloween: s === '2026-10-31',
    });
  }
  const segs = ALLDAY.map(e => {
    const s0 = idx(e.s), e0 = idx(e.e || e.s), a = Math.max(s0, WEEK0), b = Math.min(e0, WEEK0 + 6);
    return a <= b ? { e, a: a - WEEK0, b: b - WEEK0, contL: s0 < WEEK0, contR: e0 > WEEK0 + 6 } : null;
  }).filter(Boolean).sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a));
  const lanes = [];
  segs.forEach(sg => { let l = 0; while ((lanes[l] || []).some(o2 => o2.a <= sg.b && o2.b >= sg.a)) l++; (lanes[l] = lanes[l] || []).push(sg); sg.lane = l; });
  const bars = segs.filter(sg => sg.lane < 3).map(sg => {
    const L = !sg.contL, Rr = !sg.contR;
    return { ...paint(sg.e.c, T), title: sg.e.t, col: `${sg.a + 1} / span ${sg.b - sg.a + 1}`, row: sg.lane + 1,
      rl: L ? '999px' : '8px', rr: Rr ? '999px' : '8px', ml: L ? '8px' : '0px', mr: Rr ? '8px' : '0px' };
  });
  const laneCount = Math.min(3, lanes.length);
  return {
    t: T, days, bars, hours, laneCount, stripRows: `repeat(${laneCount}, 34px)`,
    veilCol: `2 / span ${TODAY_I - WEEK0}`, nowTop: pct(nowPos), nowTime: fmt(NOW_M),
    range: '26 October – 1 November', rangeShort: '26 Oct – 1 Nov', year: '2026',
  };
}
const DECORISH = { '2026-10-31': 'var(--color-accent-400)', '2026-10-21': CALS.theo.color };

// Agenda: today above tomorrow, with a now marker among today's timed events.
export function buildAgenda(name = 'light') {
  const T = theme(name);
  const days = [TODAY_I, TODAY_I + 1].map((i, k) => {
    let items = dayItems(i, T), rows = items;
    if (k === 0) {
      const at = items.findIndex(it => it.isTimed && it.m >= NOW_M && !it.ongoing);
      const pos = at < 0 ? items.length : at;
      rows = [...items.slice(0, pos), { isNow: true, isAllDay: false, isTimed: false }, ...items.slice(pos)];
    }
    const w = wx(iso(i));
    return { label: k === 0 ? 'Today' : 'Tomorrow', longDate: longDate(i), rows, ...w, wxText: k === 0 ? `12° · ${w.cond}` : w.cond };
  });
  return { t: T, today: days[0], tomorrow: days[1], clock: fmt(NOW_M) };
}

// Compact month for the month_week hybrid: date, today, special day tint and a dot per person.
export function buildCompactMonth(name = 'light') {
  const T = theme(name);
  const d = buildMonth(name, { extraTimed: EXTRA });
  const order = Object.keys(CALS);
  const weeks = d.weeks.map((w, r) => ({
    days: w.days.map((day, c) => {
      const i = r * 7 + c;
      const who = [...new Set(dayItems(i, T).map(it => it.c))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      return { ...day, dots: who.map(k => ({ color: CALS[k].color })), veil: i < TODAY_I ? T.veil : 'transparent' };
    }),
  }));
  return { t: T, weeks };
}

// Exploration: today by person (columns per family member), as on Skylight / Hearth day views.
export function buildPeopleDay(name = 'light') {
  const T = theme(name);
  const H0 = 8, H1 = 21, R = (H1 - H0) * 60, pct = m => `${(m / R * 100).toFixed(3)}%`;
  const items = dayItems(TODAY_I, T);
  const people = Object.entries(CALS).map(([k, C]) => ({
    name: C.name, initial: C.initial, color: C.color, headBg: `color-mix(in oklch, ${C.color} ${T.mixPct}, ${T.mixBase})`,
    allday: items.filter(it => it.c === k && it.isAllDay),
    blocks: items.filter(it => it.c === k && it.isTimed).map(it => ({ ...it, top: pct(it.m - H0 * 60), height: pct(it.dur), oneLine: it.dur < 50, multi: it.dur >= 50 })),
  }));
  const hours = [];
  for (let h = H0; h <= H1; h++) hours.push({ label: `${String(h).padStart(2, '0')}:00`, top: pct((h - H0) * 60), ty: h === H0 ? '-8%' : h === H1 ? '-92%' : '-50%', vis: Math.abs((h - H0) * 60 - (NOW_M - H0 * 60)) < 25 ? 'hidden' : 'visible' });
  return { t: T, people, hours, nowTop: pct(NOW_M - H0 * 60), nowTime: fmt(NOW_M), date: longDate(TODAY_I), ...wx(TODAY) };
}
