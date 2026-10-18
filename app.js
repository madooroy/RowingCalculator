// Rowing Calculator — sister app to the Watt Calculator (cycling).
//
// Pace and watts are linked by the Concept2 formula used by most rowing
// monitors (including the SmartRow):  watts = 2.80 / (seconds per meter)^3

'use strict';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

// Peloton's 10 pace-target levels, in seconds per 500m. For each zone:
// Low (slowest), Mid, High (fastest) — Easy, Moderate, Challenging, Max.
const PELOTON_PACES = {
  10: ['2:07', '1:58', '1:48', '1:48', '1:45', '1:41', '1:41', '1:37', '1:32', '1:32', '1:30', '1:27'],
  9:  ['2:17', '2:07', '1:57', '1:57', '1:53', '1:49', '1:49', '1:45', '1:40', '1:40', '1:37', '1:34'],
  8:  ['2:28', '2:17', '2:06', '2:06', '2:02', '1:57', '1:57', '1:52', '1:47', '1:47', '1:44', '1:41'],
  7:  ['2:38', '2:26', '2:14', '2:14', '2:10', '2:05', '2:05', '2:00', '1:54', '1:54', '1:51', '1:48'],
  6:  ['2:50', '2:37', '2:24', '2:24', '2:20', '2:15', '2:15', '2:09', '2:03', '2:03', '2:00', '1:56'],
  5:  ['3:03', '2:50', '2:36', '2:36', '2:31', '2:25', '2:25', '2:19', '2:13', '2:13', '2:09', '2:05'],
  4:  ['3:17', '3:02', '2:47', '2:47', '2:42', '2:36', '2:36', '2:30', '2:23', '2:23', '2:19', '2:15'],
  3:  ['3:34', '3:18', '3:02', '3:02', '2:56', '2:50', '2:50', '2:43', '2:35', '2:35', '2:31', '2:26'],
  2:  ['3:58', '3:40', '3:22', '3:22', '3:16', '3:09', '3:09', '3:01', '2:52', '2:52', '2:47', '2:42'],
  1:  ['4:31', '4:11', '3:51', '3:51', '3:43', '3:35', '3:35', '3:26', '3:17', '3:17', '3:12', '3:06']
};

const LEVELS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

const PELOTON_ZONES = [
  { name: 'Easy', color: 'var(--r-z2)' },
  { name: 'Moderate', color: 'var(--r-z3)' },
  { name: 'Challenging', color: 'var(--r-z4)' },
  { name: 'Max', color: 'var(--r-z5)' }
];

// Effort zones as % of FTP. These reproduce the Peloton effort bands: at the
// level whose FTP (Challenging midpoint) equals yours, each zone lines up
// with that level's Easy / Moderate / Challenging / Max targets.
const POWER_ZONES = [
  { id: 1, name: 'Recovery', maxPct: 43, color: 'var(--r-z1)' },
  { id: 2, name: 'Easy', maxPct: 71, color: 'var(--r-z2)' },
  { id: 3, name: 'Moderate', maxPct: 87, color: 'var(--r-z3)' },
  { id: 4, name: 'Challenging', maxPct: 114, color: 'var(--r-z4)' },
  { id: 5, name: 'Max', maxPct: null, color: 'var(--r-z5)' }
];

const STORAGE_PREFIX = 'rowing-calc-';
// Watts rounding choices for the Peloton targets. 1 = Peloton's exact paces.
const ROUND_STEPS = [1, 2, 5, 10];

// ---------------------------------------------------------------------------
// Rowing math
// ---------------------------------------------------------------------------

function wattsFromPace(secPer500) {
  return secPer500 > 0 ? 2.8 / Math.pow(secPer500 / 500, 3) : 0;
}

function paceFromWatts(watts) {
  return watts > 0 ? 500 * Math.cbrt(2.8 / watts) : 0;
}

function parseMmSs(text) {
  const [m, s] = text.split(':').map(Number);
  return m * 60 + s;
}

// Targets for one level: 12 { pace, watts } entries in table order.
// Step 1 = Peloton's exact paces, with watts worked out from each pace.
// Steps 2, 5 and 10 round each target's watts and recalculate the pace from
// the rounded watts, so pace and watts always match.
const targetCache = {};

// Round a level's raw watts to `step`. If that makes any zone's Low, Mid and
// High stop rising (e.g. 25, 33, 42 → 30, 30, 40), use the next smaller step
// for that level instead. Returns { watts, step } with the step actually used.
function roundLevelWatts(rawWatts, step) {
  const steps = ROUND_STEPS.filter(s => s > 1 && s <= step).reverse();
  for (const s of steps) {
    const watts = rawWatts.map(w => Math.round(w / s) * s);
    const ok = [0, 3, 6, 9].every(i => watts[i] < watts[i + 1] && watts[i + 1] < watts[i + 2]);
    if (ok) return { watts, step: s };
  }
  return { watts: rawWatts.map(w => Math.round(w)), step: 1 };
}

function levelTargets(level, step) {
  if (level === 'ftp') return ftpTargets(readFtp(), step);
  const key = `${step}-${level}`;
  if (targetCache[key]) return targetCache[key];

  const paces = PELOTON_PACES[level].map(parseMmSs);
  const rawWatts = paces.map(wattsFromPace);
  let targets;
  if (step <= 1) {
    targets = paces.map((pace, i) => ({ pace, watts: Math.round(rawWatts[i]) }));
    targets.step = 1;
  } else {
    const r = roundLevelWatts(rawWatts, step);
    targets = r.watts.map(watts => ({ pace: Math.round(paceFromWatts(watts)), watts }));
    targets.step = r.step;
  }
  targetCache[key] = targets;
  return targets;
}

// "My FTP" targets: a custom level that sits between Peloton's levels, so its
// FTP (Challenging midpoint) equals yours exactly. Each target is interpolated
// between the two levels either side of your FTP (on a ratio scale, since the
// levels are spaced by percentage); beyond Level 1 or 10 the nearest level is
// scaled. Pace is then worked out from the watts.
function ftpTargets(ftp, step) {
  const raw = level => PELOTON_PACES[level].map(text => wattsFromPace(parseMmSs(text)));
  const ascending = [...LEVELS].reverse(); // 1 → 10
  const rawFtp = level => raw(level)[7];

  let watts;
  if (ftp <= rawFtp(1)) {
    watts = raw(1).map(w => w * ftp / rawFtp(1));
  } else if (ftp >= rawFtp(10)) {
    watts = raw(10).map(w => w * ftp / rawFtp(10));
  } else {
    const hiIdx = ascending.findIndex(level => rawFtp(level) >= ftp);
    const lo = ascending[hiIdx - 1];
    const hi = ascending[hiIdx];
    const t = Math.log(ftp / rawFtp(lo)) / Math.log(rawFtp(hi) / rawFtp(lo));
    const a = raw(lo);
    const b = raw(hi);
    watts = a.map((w, i) => Math.exp(Math.log(w) * (1 - t) + Math.log(b[i]) * t));
  }

  // Same rounding as the levels, including the smaller step where needed.
  const r = step > 1 ? roundLevelWatts(watts, step) : { watts: watts.map(w => Math.round(w)), step: 1 };
  const targets = r.watts.map(w => ({ pace: Math.round(paceFromWatts(w)), watts: w }));
  targets.step = r.step;
  return targets;
}

function levelName(level) {
  return level === 'ftp' ? 'My FTP' : `Level ${level}`;
}

// A level's FTP is its Challenging midpoint.
function levelFtp(level, mode) {
  return levelTargets(level, mode)[7].watts;
}

// Closest level by ratio (levels are spaced roughly evenly in percentage terms).
function closestLevel(ftp, mode) {
  if (!(ftp > 0)) return null;
  let best = null;
  let bestGap = Infinity;
  LEVELS.forEach(level => {
    const gap = Math.abs(Math.log(ftp / levelFtp(level, mode)));
    if (gap < bestGap) { bestGap = gap; best = level; }
  });
  return best;
}

// Continuous watt ranges: each zone starts 1 W above the previous zone's end.
function powerZoneRanges(ftp) {
  let previousMax = 0;
  return POWER_ZONES.map(zone => {
    const min = previousMax + 1;
    const max = zone.maxPct === null ? null : Math.round(ftp * zone.maxPct / 100);
    if (max !== null) previousMax = max;
    return { ...zone, min, max };
  });
}

function powerZoneForWatts(watts, ftp) {
  if (!(watts > 0) || !(ftp > 0)) return null;
  const w = Math.round(watts);
  const ranges = powerZoneRanges(ftp);
  return ranges.find(z => z.max === null || w <= z.max);
}

// Which Peloton effort band a wattage falls in at the given level.
function pelotonZoneForWatts(watts, level, mode) {
  if (!(watts > 0)) return null;
  const t = levelTargets(level, mode);
  const w = Math.round(watts);
  if (w < t[0].watts) {
    return { name: 'Below Easy', color: 'var(--r-z1)', lowIdx: null, highIdx: 0 };
  }
  for (let z = 0; z < 4; z++) {
    if (w <= t[z * 3 + 2].watts) {
      return { ...PELOTON_ZONES[z], lowIdx: z * 3, highIdx: z * 3 + 2 };
    }
  }
  return { name: 'Above Max', color: 'var(--r-z5)', lowIdx: 11, highIdx: null };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

// 128.46 -> "2:08.5"  (tenths)   or  "2:08" (whole seconds)
function formatPace(seconds, tenths = true) {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return '—';
  if (!tenths) {
    const total = Math.round(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }
  const t = Math.round(seconds * 10);
  const m = Math.floor(t / 600);
  const s = (t % 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// 3725.4 -> "1:02:05.4"; 520 -> "8:40.0"
function formatDuration(seconds, tenths = true) {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return '—';
  const scale = tenths ? 10 : 1;
  const t = Math.round(seconds * scale);
  const h = Math.floor(t / (3600 * scale));
  const m = Math.floor((t % (3600 * scale)) / (60 * scale));
  const s = (t % (60 * scale)) / scale;
  const sText = tenths ? s.toFixed(1).padStart(4, '0') : String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sText}` : `${m}:${sText}`;
}

const nf = new Intl.NumberFormat();
function formatMeters(m) { return `${nf.format(Math.round(m))} m`; }

// ---------------------------------------------------------------------------
// State and storage
// ---------------------------------------------------------------------------

function storageGet(key) {
  try { return localStorage.getItem(STORAGE_PREFIX + key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(STORAGE_PREFIX + key, String(value)); } catch {}
}

const state = {
  tab: 'convert',
  convertMode: 'p2w',
  solve: 'pace',
  targetMode: 1,     // watts rounding step: 1 (Peloton exact), 2, 5 or 10
  // 'auto'   = the Peloton level closest to your FTP
  // 'ftp'    = custom targets built from your exact FTP (between levels)
  // 'pinned' = a level chosen by hand
  levelMode: 'auto',
  pinnedLevel: 6,
  level: 6           // the level in use: a number, or 'ftp' (see updateLevel)
};

// The level in use: the one closest to your FTP in Auto, otherwise the pinned one.
function autoLevel() {
  return closestLevel(readFtp(), state.targetMode) ?? 6;
}
function updateLevel() {
  if (state.levelMode === 'pinned') state.level = state.pinnedLevel;
  else if (state.levelMode === 'ftp' && readFtp() > 0) state.level = 'ftp';
  else state.level = autoLevel();
}
function levelTag() {
  if (state.level === 'ftp') return `${Math.round(readFtp())}W`;
  return state.levelMode === 'pinned' ? 'Pinned' : 'Auto';
}

const $ = id => document.getElementById(id);

// Inputs remembered between visits.
const SAVED_INPUTS = [
  'cv-pace-min', 'cv-pace-sec', 'cv-watts', 'ftp-in',
  'wo-distance', 'wo-hours', 'wo-minutes', 'wo-seconds', 'wo-pace-min', 'wo-pace-sec'
];

function readNumber(id) {
  const raw = $(id).value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function readFtp() {
  const ftp = readNumber('ftp-in');
  return ftp && ftp > 0 ? ftp : 0;
}

// Pace from minute + second boxes; returns { seconds } or { error }.
function readPace(minId, secId) {
  const m = readNumber(minId) ?? 0;
  const s = readNumber(secId) ?? 0;
  if (s >= 60) return { error: 'Pace seconds must be below 60.' };
  const total = m * 60 + s;
  if (total <= 0) return { error: 'Enter a pace.' };
  if (total < 60) return { error: 'That pace is faster than 1:00/500m. Check the minutes.' };
  return { seconds: total };
}

function readWorkoutTime() {
  const h = readNumber('wo-hours') ?? 0;
  const m = readNumber('wo-minutes') ?? 0;
  const s = readNumber('wo-seconds') ?? 0;
  if (m >= 60) return { error: 'Minutes must be below 60.' };
  if (s >= 60) return { error: 'Seconds must be below 60.' };
  const total = h * 3600 + m * 60 + s;
  if (total <= 0) return { error: 'Enter a time.' };
  return { seconds: total };
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function setBadgeEmpty(el, text) {
  el.className = 'calc-badge badge-empty';
  el.style.backgroundColor = '';
  el.textContent = text;
}

function updateZoneBadge(el, watts, ftp, seconds = 0) {
  const zone = powerZoneForWatts(watts, ftp);
  if (!zone) {
    setBadgeEmpty(el, ftp > 0 ? 'Zone: —' : 'Zone: set your FTP in Effort Zones');
    return;
  }
  const pct = (watts / ftp) * 100;
  let sub = '';
  if (seconds > 0) {
    const intensity = watts / ftp;
    const tss = (seconds / 3600) * intensity * intensity * 100;
    sub = `<span class="badge-subline">IF ${intensity.toFixed(2)} · Training load ${Math.round(tss)}</span>`;
  }
  el.className = 'calc-badge';
  el.style.backgroundColor = zone.color;
  el.innerHTML = `Zone ${zone.id}: ${zone.name} (${pct.toFixed(1)}% of ${Math.round(ftp)}W)${sub}`;
}

function updateLevelBadge(el, watts) {
  const zone = pelotonZoneForWatts(watts, state.level, state.targetMode);
  if (!zone) { setBadgeEmpty(el, `${levelName(state.level)}: —`); return; }

  const t = levelTargets(state.level, state.targetMode);
  let range = '';
  if (zone.lowIdx !== null && zone.highIdx !== null) {
    const lo = t[zone.lowIdx];
    const hi = t[zone.highIdx];
    range = `${lo.watts}–${hi.watts}W · ${formatPace(lo.pace, false)}–${formatPace(hi.pace, false)}/500m`;
  } else if (zone.lowIdx === null) {
    range = `Easy starts at ${t[0].watts}W · ${formatPace(t[0].pace, false)}/500m`;
  } else {
    range = `Max tops out at ${t[11].watts}W · ${formatPace(t[11].pace, false)}/500m`;
  }
  const roundText = t.step > 1 ? `rounded to ${t.step}W` : '';
  const modeText = state.level === 'ftp'
    ? (roundText ? `from your FTP, ${roundText}` : 'from your FTP')
    : (roundText || 'Peloton');
  el.className = 'calc-badge';
  el.style.backgroundColor = zone.color;
  el.innerHTML = `${levelName(state.level)} (${levelTag()}): ${zone.name}<span class="badge-subline">${range} (${modeText})</span>`;
}

// ---------------------------------------------------------------------------
// Pace ⇄ Watts
// ---------------------------------------------------------------------------

function calcConvert() {
  const ftp = readFtp();
  let watts = 0;
  let pace = 0;

  if (state.convertMode === 'p2w') {
    const p = readPace('cv-pace-min', 'cv-pace-sec');
    if (!p.error) { pace = p.seconds; watts = wattsFromPace(pace); }
    $('cv-out').textContent = watts ? `${Math.round(watts)}` : '—';
    $('cv-out-lbl').textContent = 'Watts';
  } else {
    const w = readNumber('cv-watts');
    if (w && w > 0) { watts = w; pace = paceFromWatts(w); }
    $('cv-out').textContent = pace ? formatPace(pace) : '—';
    $('cv-out-lbl').textContent = 'Pace per 500m';
  }

  if (watts > 0) {
    const twoK = pace * 4;
    const halfHourMeters = (1800 / pace) * 500;
    const kjHour = (watts * 3600) / 1000;
    $('cv-out-sub').innerHTML =
      `2,000 m in ${formatDuration(twoK)} · 30 min ≈ ${formatMeters(halfHourMeters)}<br>` +
      `${nf.format(Math.round(kjHour))} kJ per hour (≈ ${nf.format(Math.round(kjHour))} kcal)`;
  } else {
    $('cv-out-sub').textContent = '';
  }

  updateZoneBadge($('cv-zone-badge'), watts, ftp);
  updateLevelBadge($('cv-level-badge'), watts);
}

// ---------------------------------------------------------------------------
// Workout: find pace, time or distance
// ---------------------------------------------------------------------------

const SOLVE_FIELDS = {
  pace: ['distance', 'time'],
  time: ['distance', 'pace'],
  distance: ['time', 'pace']
};

function calcWorkout() {
  const ftp = readFtp();
  const fields = SOLVE_FIELDS[state.solve];
  let error = '';
  let distance = 0;
  let time = 0;
  let pace = 0;

  if (fields.includes('distance')) {
    distance = readNumber('wo-distance') ?? 0;
    if (!(distance > 0)) error = 'Enter a distance.';
  }
  if (!error && fields.includes('time')) {
    const t = readWorkoutTime();
    if (t.error) error = t.error; else time = t.seconds;
  }
  if (!error && fields.includes('pace')) {
    const p = readPace('wo-pace-min', 'wo-pace-sec');
    if (p.error) error = p.error; else pace = p.seconds;
  }

  $('wo-error').textContent = error;

  if (!error) {
    if (state.solve === 'pace') pace = (time / distance) * 500;
    if (state.solve === 'time') time = (distance / 500) * pace;
    if (state.solve === 'distance') distance = (time / pace) * 500;
  }

  const ok = !error && pace > 0 && time > 0 && distance > 0;
  const watts = ok ? wattsFromPace(pace) : 0;

  const out = $('wo-out');
  const lbl = $('wo-out-lbl');
  if (state.solve === 'pace') { out.textContent = ok ? formatPace(pace) : '—'; lbl.textContent = 'Pace per 500m'; }
  if (state.solve === 'time') { out.textContent = ok ? formatDuration(time) : '—'; lbl.textContent = 'Time'; }
  if (state.solve === 'distance') { out.textContent = ok ? formatMeters(distance) : '—'; lbl.textContent = 'Distance'; }

  if (ok) {
    const kj = (watts * time) / 1000;
    const parts = [`${Math.round(watts)} W average`];
    if (state.solve !== 'pace') parts.push(`${formatPace(pace)}/500m`);
    if (state.solve !== 'time') parts.push(formatDuration(time));
    if (state.solve !== 'distance') parts.push(formatMeters(distance));
    $('wo-out-sub').textContent = parts.join(' · ');
    $('wo-out-sub2').textContent = `${nf.format(Math.round(kj))} kJ (≈ ${nf.format(Math.round(kj))} kcal)`;
  } else {
    $('wo-out-sub').textContent = '';
    $('wo-out-sub2').textContent = '';
  }

  updateZoneBadge($('wo-zone-badge'), watts, ftp, ok ? time : 0);
  updateLevelBadge($('wo-level-badge'), watts);
}

// ---------------------------------------------------------------------------
// Effort zones
// ---------------------------------------------------------------------------

function renderZones() {
  const ftp = readFtp();
  document.querySelectorAll('[data-ftp-display]').forEach(el => {
    el.textContent = ftp ? `${Math.round(ftp)}W` : '—';
  });
  $('threshold-pace').textContent = ftp ? `${formatPace(paceFromWatts(ftp))} /500m` : '—';
  $('zones-export-title').textContent = ftp
    ? `Rowing Effort Zones · FTP ${Math.round(ftp)}W · Threshold ${formatPace(paceFromWatts(ftp), false)}/500m`
    : 'Rowing Effort Zones';

  const body = $('zones-body');
  if (!ftp) {
    body.innerHTML = '<tr><td colspan="4" style="color:var(--muted);font-weight:500">Enter your rowing FTP to see your zones.</td></tr>';
  } else {
    let previousPct = -1;
    body.innerHTML = powerZoneRanges(ftp).map(z => {
      const pctText = z.maxPct === null ? `${previousPct + 1}%+` : `${previousPct + 1}–${z.maxPct}%`;
      if (z.maxPct !== null) previousPct = z.maxPct;
      const wattText = z.max === null ? `${z.min}+` : `${z.min}–${z.max}`;
      const slow = formatPace(paceFromWatts(z.min), false);
      const fast = z.max === null ? null : formatPace(paceFromWatts(z.max), false);
      const paceText = z.id === 1 ? `${fast}+` : (fast === null ? `&lt;&nbsp;${slow}` : `${slow}–${fast}`);
      return `<tr>
        <td><span class="zone-chip" style="background:${z.color}">${z.name}<small>Zone ${z.id}</small></span></td>
        <td>${pctText}</td>
        <td>${wattText}</td>
        <td>${paceText}</td>
      </tr>`;
    }).join('');
  }

}

// Explains which level is in use and why, in both places the level is shown.
function renderLevelStatus() {
  const ftp = readFtp();
  const lf = levelFtp(state.level, state.targetMode);
  const f = Math.round(ftp);
  let text;
  if (state.level === 'ftp') {
    // Name the levels either side of your FTP.
    const mode = state.targetMode;
    const below = [...LEVELS].find(l => levelFtp(l, mode) <= ftp);
    const above = [...LEVELS].reverse().find(l => levelFtp(l, mode) > ftp);
    const where = below && above
      ? (levelFtp(below, mode) === f ? `the same as Level ${below}` : `between Level ${below} (${levelFtp(below, mode)}W) and Level ${above} (${levelFtp(above, mode)}W)`)
      : below ? `above Level 10` : `below Level 1`;
    text = `Peloton badges compare you with targets built from your exact ${f}W FTP, ${where}. They match your effort zones. Tap Auto to compare with the closest Peloton level instead.`;
  } else if (state.levelMode !== 'pinned') {
    text = ftp
      ? `Peloton badges compare you with Level ${state.level} (FTP ${lf}W), the closest level to your ${f}W FTP. Tap My FTP to compare with targets built from your exact FTP instead.`
      : `Enter your FTP to have a Peloton level chosen for you.`;
  } else {
    const closest = closestLevel(ftp, state.targetMode);
    text = `Peloton badges compare you with Level ${state.level} (FTP ${lf}W), pinned by hand.` +
      (ftp && closest && closest !== state.level ? ` Auto would choose Level ${closest} for your ${f}W FTP.` : '');
  }
  document.querySelectorAll('[data-level-status]').forEach(el => { el.textContent = text; });
  document.querySelectorAll('[data-level-mode]').forEach(btn => {
    btn.hidden = btn.dataset.levelMode === state.levelMode || !(ftp > 0);
  });
}

// ---------------------------------------------------------------------------
// Peloton levels table
// ---------------------------------------------------------------------------

function renderLevels() {
  const mode = state.targetMode;
  const zoneHead = PELOTON_ZONES.map(z =>
    `<th colspan="3" style="background:${z.color}">${z.name}</th>`).join('');
  const subHead = PELOTON_ZONES.map((z, i) =>
    `<th>Low</th><th class="mid" style="background:${z.color}">${i === 2 ? 'FTP' : 'Mid'}</th><th>High</th>`).join('');
  $('levels-head').innerHTML =
    `<tr class="zone-head"><th class="lvl" rowspan="2" style="color:var(--text);font-style:normal">Level</th>${zoneHead}</tr>` +
    `<tr class="sub-head">${subHead}</tr>`;

  // In "My FTP" mode, add your custom row where it falls among the levels.
  const rows = [...LEVELS];
  if (state.level === 'ftp') {
    const ftp = readFtp();
    const at = rows.findIndex(level => levelFtp(level, mode) <= ftp);
    rows.splice(at === -1 ? rows.length : at, 0, 'ftp');
  }

  $('levels-body').innerHTML = rows.map(level => {
    const cells = levelTargets(level, mode).map((t, i) => {
      const isMid = i % 3 === 1;
      const style = isMid ? ` style="background:${PELOTON_ZONES[Math.floor(i / 3)].color}"` : '';
      return `<td class="${isMid ? 'mid' : ''}"${style}><span class="cell-pace">${formatPace(t.pace, false)}</span><span class="cell-watts">${t.watts}</span></td>`;
    }).join('');
    const selected = level === state.level;
    const mine = level === 'ftp';
    const label = mine ? `My FTP<small>${Math.round(readFtp())}W</small>` : `Level ${level}`;
    return `<tr data-level="${level}" tabindex="${mine ? -1 : 0}" class="${selected ? 'selected' : ''}${mine ? ' my-ftp' : ''}" aria-selected="${selected}"><td class="lvl">${label}</td>${cells}</tr>`;
  }).join('');

  $('levels-export-title').textContent = mode > 1
    ? `Rowing Pace/Output Targets (per 500 meters) · Watts rounded to ${mode}`
    : 'Rowing Pace/Output Targets (per 500 meters) · Peloton paces';

  // Levels where the chosen step would have made targets identical.
  const smaller = LEVELS.filter(l => levelTargets(l, mode).step < mode)
    .map(l => `Level ${l} (${levelTargets(l, mode).step}W)`);
  const fallback = smaller.length
    ? ` ${smaller.join(', ')} ${smaller.length === 1 ? 'uses' : 'use'} a smaller step, because rounding to ${mode}W would make some of ${smaller.length === 1 ? 'its' : 'their'} targets identical.`
    : '';
  $('levels-note').textContent = mode > 1
    ? `Watts rounded to the nearest ${mode} with pace recalculated from the rounded watts, so pace and watts always match.${fallback} Each cell shows pace per 500m above watts. A level’s FTP is its Challenging midpoint.`
    : 'Peloton’s pace targets, with watts calculated from each pace. Each cell shows pace per 500m above watts. A level’s FTP is its Challenging midpoint.';
}

// ---------------------------------------------------------------------------
// Heart rate zones (ported from the Watt Calculator)
//
// Two zone sets: % of Max HR and % of Lactate Threshold HR. A "ranges" object
// maps zone ids to { min, max } percentages; the first zone has no min and the
// last has no max. Zones are continuous: each starts 1 point above the
// previous zone's end.
// ---------------------------------------------------------------------------

const HR_ZONE_ORDER = ['z1', 'z2', 'z3', 'z4', 'z5'];

const HR_ZONE_DEFS = [
  { num: 1, desc: 'Active Recovery', colorVar: 'hr-z1' },
  { num: 2, desc: 'Aerobic Capacity', colorVar: 'hr-z2' },
  { num: 3, desc: 'Tempo', colorVar: 'hr-z3' },
  { num: 4, desc: 'Threshold', colorVar: 'hr-z4' },
  { num: 5, desc: 'VO2 Max', colorVar: 'hr-z5' }
];

const DEFAULT_HR_PERCENTS = {
  max: {
    z1: { min: null, max: 65 },
    z2: { min: 66, max: 75 },
    z3: { min: 76, max: 85 },
    z4: { min: 86, max: 95 },
    z5: { min: 96, max: null }
  },
  lthr: {
    z1: { min: null, max: 68 },
    z2: { min: 69, max: 83 },
    z3: { min: 84, max: 94 },
    z4: { min: 95, max: 105 },
    z5: { min: 106, max: null }
  }
};

const HR_METRICS = {
  max: { label: 'Max HR', cap: 100 },
  lthr: { label: 'LTHR', cap: 150 }
};

const deepClone = obj => JSON.parse(JSON.stringify(obj));
const clampNonNegative = value => { const n = parseFloat(value); return Number.isFinite(n) && n >= 0 ? n : 0; };

let hrSubtab = 'default';
let customHr = deepClone(DEFAULT_HR_PERCENTS);

function hrCellBg(colorVar, alpha = 0.5) {
  return `linear-gradient(rgba(255,255,255,${alpha}), rgba(255,255,255,${alpha})), var(--${colorVar})`;
}

// Re-chain every zone's start to 1 above the previous zone's end.
function syncRanges(ranges) {
  const out = deepClone(ranges);
  for (let i = 1; i < HR_ZONE_ORDER.length; i++) {
    const prev = HR_ZONE_ORDER[i - 1];
    const curr = HR_ZONE_ORDER[i];
    if (out[prev].max != null && out[curr].min != null) out[curr].min = out[prev].max + 1;
  }
  return out;
}

// Apply one edited boundary and move the neighbouring zone's boundary with it.
function applyBoundaryEdit(ranges, zoneId, side, rawValue, cap) {
  const out = deepClone(ranges);
  const value = Math.round(Math.min(clampNonNegative(rawValue), cap));
  const index = HR_ZONE_ORDER.indexOf(zoneId);
  if (index === -1) return out;

  if (side === 'max' && out[zoneId].max != null) {
    out[zoneId].max = value;
    const next = HR_ZONE_ORDER[index + 1];
    if (next && out[next].min != null) out[next].min = value + 1;
  }
  if (side === 'min' && out[zoneId].min != null) {
    out[zoneId].min = value;
    const prev = HR_ZONE_ORDER[index - 1];
    if (prev && out[prev].max != null) out[prev].max = value - 1;
  }
  return syncRanges(out);
}

// Return the first problem with a zone set, or ''.
function validateRangeChain(ranges, label, cap) {
  const inBounds = v => v > 0 && v <= cap;
  const bounds = `between 1% and ${cap}%`;
  const first = HR_ZONE_ORDER[0];
  const last = HR_ZONE_ORDER[HR_ZONE_ORDER.length - 1];
  const name = key => `Zone ${key.slice(1)}`;

  for (const key of HR_ZONE_ORDER) {
    const r = ranges[key];
    if (key === first) {
      if (!inBounds(r.max)) return `${label}: ${name(key)} must end ${bounds}.`;
    } else if (key === last) {
      if (!inBounds(r.min)) return `${label}: ${name(key)} must start ${bounds}.`;
    } else {
      if (!(inBounds(r.min) && inBounds(r.max))) return `${label}: ${name(key)} must have start and end values ${bounds}.`;
      if (!(r.min < r.max)) return `${label}: ${name(key)} must end above its start value.`;
    }
  }
  for (let i = 1; i < HR_ZONE_ORDER.length; i++) {
    if (ranges[HR_ZONE_ORDER[i]].min !== ranges[HR_ZONE_ORDER[i - 1]].max + 1) {
      return `${label}: ${name(HR_ZONE_ORDER[i])} must start exactly 1 point above ${name(HR_ZONE_ORDER[i - 1])}.`;
    }
  }
  return '';
}

function validateHrBaseInputs(maxHr, lthr) {
  if (maxHr > 0 && lthr > 0 && lthr > maxHr) return 'Lactate Threshold HR cannot be higher than Max HR.';
  return '';
}

function validateHrSet(values, maxHr, lthr) {
  const baseError = validateHrBaseInputs(maxHr, lthr);
  if (baseError) return baseError;
  for (const metric of ['max', 'lthr']) {
    const { label, cap } = HR_METRICS[metric];
    const error = validateRangeChain(values[metric], `Custom ${label}`, cap);
    if (error) return error;
  }
  // LTHR-based zones must not work out to more BPM than Max HR.
  if (maxHr > 0 && lthr > 0) {
    const maxAllowedPct = Math.floor((maxHr / lthr) * 100);
    const exceeds = Object.values(values.lthr).some(r => r.min > maxAllowedPct || r.max > maxAllowedPct);
    if (exceeds) return 'Custom LTHR: One or more zone values would calculate above your Max HR. Increase Max HR or lower the LTHR percentages.';
  }
  return '';
}

// Saved custom zones fall back to the defaults if anything is missing or invalid.
function normalizeHr(value) {
  const source = value && typeof value === 'object' ? value : {};
  const out = deepClone(DEFAULT_HR_PERCENTS);
  for (const metric of ['max', 'lthr']) {
    const cap = HR_METRICS[metric].cap;
    for (const zone of HR_ZONE_ORDER) {
      for (const side of ['min', 'max']) {
        const raw = source[metric]?.[zone]?.[side];
        if (out[metric][zone][side] !== null && raw != null && raw !== '') {
          out[metric][zone][side] = Math.round(Math.min(clampNonNegative(raw), cap));
        }
      }
    }
  }
  return out;
}

function loadCustomHr() {
  try {
    const parsed = JSON.parse(storageGet('custom-hr') || 'null');
    if (!parsed) return deepClone(DEFAULT_HR_PERCENTS);
    const candidate = normalizeHr(parsed);
    return validateHrSet(candidate, 0, 0) ? deepClone(DEFAULT_HR_PERCENTS) : candidate;
  } catch {
    return deepClone(DEFAULT_HR_PERCENTS);
  }
}

function readHrBase() {
  const maxHr = readNumber('hr-max-in') ?? 0;
  const lthr = readNumber('hr-lthr-in') ?? 0;
  return { maxHr, lthr, error: validateHrBaseInputs(maxHr, lthr) };
}

// Continuous BPM ranges from a zone set and a base heart rate.
function bpmRangeTexts(metricCfg, base) {
  if (!(base > 0)) return ['—', '—', '—', '—', '—'];
  const z1Max = Math.round(base * metricCfg.z1.max / 100);
  const z2Max = Math.max(z1Max + 1, Math.round(base * metricCfg.z2.max / 100));
  const z3Max = Math.max(z2Max + 1, Math.round(base * metricCfg.z3.max / 100));
  const z4Max = Math.max(z3Max + 1, Math.round(base * metricCfg.z4.max / 100));
  return [`≤ ${z1Max}`, `${z1Max + 1}–${z2Max}`, `${z2Max + 1}–${z3Max}`, `${z3Max + 1}–${z4Max}`, `≥ ${z4Max + 1}`];
}

function pctText({ min, max }) {
  if (min == null) return `≤ ${max}%`;
  if (max == null) return `≥ ${min}%`;
  return `${min}%–${max}%`;
}

function hrPctInput(metric, zone, side, value) {
  const { label, cap } = HR_METRICS[metric];
  return `<input class="input-small hr-pct-input" data-metric="${metric}" data-zone="${zone}" data-side="${side}" type="number" inputmode="numeric" enterkeyhint="done" min="1" max="${cap}" step="1" value="${value}" aria-label="${label} ${zone.replace('z', 'Zone ')} ${side === 'max' ? 'upper' : 'lower'} percentage">`;
}

// Editable cell: first zone has only an upper value, last only a lower value.
function hrRangeEditor(metric, zone, range) {
  if (zone === 'z1') return `<span class="hr-range-edit"><span>≤</span>${hrPctInput(metric, zone, 'max', range.max)}<span>%</span></span>`;
  if (zone === 'z5') return `<span class="hr-range-edit"><span>≥</span>${hrPctInput(metric, zone, 'min', range.min)}<span>%</span></span>`;
  return `<span class="hr-range-edit">${hrPctInput(metric, zone, 'min', range.min)}<span>to</span>${hrPctInput(metric, zone, 'max', range.max)}<span>%</span></span>`;
}

function hrRows(metric, cfg, base, editable) {
  const bpm = bpmRangeTexts(cfg[metric], base);
  return HR_ZONE_DEFS.map((z, i) => {
    const key = `z${z.num}`;
    const pctCell = editable ? hrRangeEditor(metric, key, cfg[metric][key]) : pctText(cfg[metric][key]);
    return `<tr>
      <td><span class="zone-chip" style="background:${hrCellBg(z.colorVar)}">${z.desc}<small>Zone ${z.num}</small></span></td>
      <td>${pctCell}</td>
      <td${editable ? ` data-bpm="${metric}-${i}"` : ''}>${bpm[i]}</td>
    </tr>`;
  }).join('');
}

function renderHrZones() {
  const { maxHr, lthr, error } = readHrBase();
  $('hr-input-error').textContent = error;
  if (error) $('custom-hr-error').textContent = '';
  const useMax = error ? 0 : maxHr;
  const useLthr = error ? 0 : lthr;

  $('hr-default-max-body').innerHTML = hrRows('max', DEFAULT_HR_PERCENTS, useMax, false);
  $('hr-default-lthr-body').innerHTML = hrRows('lthr', DEFAULT_HR_PERCENTS, useLthr, false);

  // While a custom box has focus, update values in place rather than
  // rebuilding the table under the cursor.
  const editing = document.activeElement?.classList.contains('hr-pct-input');
  if (!editing) {
    $('hr-custom-max-body').innerHTML = hrRows('max', customHr, useMax, true);
    $('hr-custom-lthr-body').innerHTML = hrRows('lthr', customHr, useLthr, true);
  } else {
    document.querySelectorAll('.hr-pct-input').forEach(input => {
      const { metric, zone, side } = input.dataset;
      const value = String(customHr[metric][zone][side]);
      // Edits only commit on Enter or leaving a box, so every box can be
      // refreshed, including the one just tabbed into.
      if (input.value !== value) input.value = value;
    });
    for (const [metric, base] of [['max', useMax], ['lthr', useLthr]]) {
      bpmRangeTexts(customHr[metric], base).forEach((text, i) => {
        const cell = document.querySelector(`[data-bpm="${metric}-${i}"]`);
        if (cell) cell.textContent = text;
      });
    }
  }

  const parts = [];
  if (maxHr > 0) parts.push(`Max HR ${Math.round(maxHr)}`);
  if (lthr > 0) parts.push(`LTHR ${Math.round(lthr)}`);
  document.querySelectorAll('[data-hr-title]').forEach(el => {
    const base = el.closest('#hr-custom-export') ? 'Custom Heart Rate Zones' : 'Heart Rate Zones';
    el.textContent = parts.length ? `${base} · ${parts.join(' · ')}` : base;
  });
}

// A custom percentage was changed: move its neighbour, validate, save.
function applyCustomHrEdit(input) {
  const { maxHr, lthr, error: baseError } = readHrBase();
  if (baseError) { renderHrZones(); return; }

  const { metric, zone, side } = input.dataset;
  const next = deepClone(customHr);
  next[metric] = applyBoundaryEdit(next[metric], zone, side, input.value, HR_METRICS[metric].cap);

  const error = validateHrSet(next, maxHr, lthr);
  $('custom-hr-error').textContent = error;
  if (!error) {
    customHr = normalizeHr(next);
    storageSet('custom-hr', JSON.stringify(customHr));
  }
  // Show the saved value in the edited box too (an invalid edit reverts).
  input.value = String(customHr[metric][zone][side]);
  // Wait for focus to settle (Tab moves it after this event), so the table is
  // updated in place rather than rebuilt under the next box.
  setTimeout(renderHrZones, 0);
}

function resetCustomHr() {
  customHr = deepClone(DEFAULT_HR_PERCENTS);
  storageSet('custom-hr', JSON.stringify(customHr));
  $('custom-hr-error').textContent = '';
  renderHrZones();
}

function setHrSubtab(value) {
  hrSubtab = value;
  const buttons = [...document.querySelectorAll('[data-hr-subtab]')];
  setTabGroup(buttons, buttons.find(b => b.dataset.hrSubtab === value));
  $('hr-default-export').hidden = value !== 'default';
  $('hr-custom-export').hidden = value !== 'custom';
  storageSet('hr-subtab', value);
}

// ---------------------------------------------------------------------------
// UI state changes
// ---------------------------------------------------------------------------

function setTabGroup(buttons, activeBtn) {
  buttons.forEach(btn => {
    const on = btn === activeBtn;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
  });
}

function switchTab(tab) {
  state.tab = tab;
  const buttons = [...document.querySelectorAll('.tabs .tab')];
  setTabGroup(buttons, buttons.find(b => b.dataset.tab === tab));
  ['convert', 'workout', 'zones', 'hr', 'levels'].forEach(name => {
    $(`${name}-view`).hidden = name !== tab;
  });
  // The "about" note applies to the calculators only.
  document.querySelector('.tss-note').hidden = !(tab === 'convert' || tab === 'workout');
  storageSet('tab', tab);
}

function setConvertMode(mode) {
  state.convertMode = mode;
  const buttons = [...document.querySelectorAll('[data-convert]')];
  setTabGroup(buttons, buttons.find(b => b.dataset.convert === mode));
  $('convert-pace-row').hidden = mode !== 'p2w';
  $('convert-watts-row').hidden = mode !== 'w2p';
  storageSet('convert', mode);
  calcConvert();
}

function setSolve(solve) {
  state.solve = solve;
  const buttons = [...document.querySelectorAll('[data-solve]')];
  setTabGroup(buttons, buttons.find(b => b.dataset.solve === solve));
  document.querySelectorAll('#workout-view [data-field]').forEach(row => {
    row.hidden = !SOLVE_FIELDS[solve].includes(row.dataset.field);
  });
  storageSet('solve', solve);
  calcWorkout();
}

function setTargetMode(mode) {
  mode = ROUND_STEPS.includes(Number(mode)) ? Number(mode) : 1;
  state.targetMode = mode;
  const buttons = [...document.querySelectorAll('[data-targets]')];
  setTabGroup(buttons, buttons.find(b => Number(b.dataset.targets) === mode));
  const label = mode > 1 ? `Targets: Rounded to ${mode}W` : 'Targets: Peloton exact';
  document.querySelectorAll('[data-target-toggle]').forEach(btn => {
    btn.textContent = label;
  });
  storageSet('targets', mode);
  refreshAll();
}

// Pin a level by hand ('auto' returns to following your FTP).
// 'auto', 'ftp', or a level number to pin.
function setLevel(level) {
  if (level === 'auto' || level === 'ftp') {
    state.levelMode = level;
  } else {
    state.levelMode = 'pinned';
    state.pinnedLevel = level;
    storageSet('level', level);
  }
  storageSet('level-mode', state.levelMode);
  refreshAll();
}

function renderLevelSelect() {
  const select = $('level-select');
  const auto = autoLevel();
  const ftp = readFtp();
  select.innerHTML =
    `<option value="auto">Auto · Level ${auto} (closest to FTP)</option>` +
    (ftp > 0 ? `<option value="ftp">My FTP · ${Math.round(ftp)}W (between levels)</option>` : '') +
    LEVELS.map(l => `<option value="${l}">Level ${l} · FTP ${levelFtp(l, state.targetMode)}W</option>`).join('');
  const value = state.levelMode === 'pinned' ? String(state.level)
    : (state.levelMode === 'ftp' && ftp > 0 ? 'ftp' : 'auto');
  select.value = value;
  $('level-select-lbl').textContent =
    value === 'auto' ? `Auto · Level ${state.level}` : value === 'ftp' ? `My FTP · ${Math.round(ftp)}W` : `Level ${state.level}`;
}

function refreshAll() {
  updateLevel();
  renderLevelSelect();
  renderLevelStatus();
  renderZones();
  renderLevels();
  calcConvert();
  calcWorkout();
}

// Arrow keys move between tabs in a tab list.
function bindArrowKeys(container) {
  container.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const buttons = [...container.querySelectorAll('[role="tab"]')];
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    next.focus();
    next.click();
    e.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// Print and Save Image
// ---------------------------------------------------------------------------

function printSection(name) {
  const card = $(`${name}-export`);
  const parent = card.closest('.view');
  card.classList.add('print-target');
  parent.classList.add('print-target-parent');
  const cleanup = () => {
    card.classList.remove('print-target');
    parent.classList.remove('print-target-parent');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 1000);
}

let html2canvasLoader = null;
function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (html2canvasLoader) return html2canvasLoader;
  html2canvasLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/html2canvas.min.js'; // bundled so Save Image works offline
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => { html2canvasLoader = null; reject(new Error('Could not load image library')); };
    document.head.appendChild(script);
  });
  return html2canvasLoader;
}

// ---------------------------------------------------------------------------
// Phones: Print and Save Image both open the share sheet (Save Image, Print,
// Messages ...). Home-screen web apps on iPhone can't use the browser's print
// dialog or file downloads reliably, but the share sheet works. Same approach
// as the Watt Calculator.
// ---------------------------------------------------------------------------

const EXPORT_FILE_NAMES = {
  levels: 'rowing-peloton-levels.png',
  zones: 'rowing-effort-zones.png',
  'hr-default': 'rowing-heart-rate-zones.png',
  'hr-custom': 'rowing-custom-heart-rate-zones.png'
};

let pendingShare = null; // { button, file } waiting for one more tap
const exportLabels = new Map();

function useShareSheet() {
  if (!navigator.share || !navigator.canShare) return false;
  if (!window.matchMedia('(pointer: coarse)').matches) return false;
  try {
    return navigator.canShare({ files: [new File([''], 'zones.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

function exportButtons() {
  return [...document.querySelectorAll('[data-print], [data-save]')];
}

function restoreExportLabels() {
  exportButtons().forEach(btn => {
    if (!exportLabels.has(btn)) exportLabels.set(btn, btn.textContent);
    if (pendingShare?.button !== btn) btn.textContent = exportLabels.get(btn);
  });
}

async function renderSectionBlob(name) {
  const html2canvas = await loadHtml2Canvas();
  const source = $(`${name}-export`);
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;';
  try {
    const clone = source.cloneNode(true);
    clone.removeAttribute('id');
    clone.hidden = false;
    // Show editable boxes as plain numbers in the image.
    clone.querySelectorAll('input').forEach(input => {
      const span = document.createElement('span');
      span.className = 'export-value';
      span.textContent = source.querySelector(`[data-metric="${input.dataset.metric}"][data-zone="${input.dataset.zone}"][data-side="${input.dataset.side}"]`)?.value ?? input.value;
      input.replaceWith(span);
    });
    clone.classList.add('exporting');
    holder.appendChild(clone);
    document.body.appendChild(holder);
    const canvas = await html2canvas(clone, { backgroundColor: '#ffffff', scale: 2, logging: false });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Image export failed.');
    return blob;
  } finally {
    holder.remove();
  }
}

async function shareImageFile(file, button) {
  try {
    await navigator.share({ files: [file], title: file.name.replace(/\.png$/, '') });
  } catch (error) {
    if (error.name === 'AbortError') return; // share sheet closed without choosing
    // iPhone only opens the share sheet straight after a tap. If preparing the
    // image took too long, keep it ready and ask for one more tap.
    if (error.name === 'NotAllowedError' && !pendingShare) {
      pendingShare = { button, file };
      button.textContent = 'Tap to Share';
      return;
    }
    throw error;
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function saveSectionImage(name, button) {
  const fileName = EXPORT_FILE_NAMES[name];
  exportButtons().forEach(btn => { btn.disabled = true; });
  button.textContent = 'Preparing…';
  try {
    const blob = await renderSectionBlob(name);
    if (useShareSheet()) {
      await shareImageFile(new File([blob], fileName, { type: 'image/png' }), button);
    } else {
      downloadBlob(blob, fileName);
    }
  } catch (err) {
    console.warn(err);
    alert('Sorry, the image could not be created. Please try again.');
  } finally {
    exportButtons().forEach(btn => { btn.disabled = false; });
    restoreExportLabels();
  }
}

// Print and Save Image buttons. On phones both open the share sheet, which
// includes Print; on computers Print opens the normal print dialog.
function onExportClick(action, name, button) {
  if (pendingShare?.button === button) {
    const { file } = pendingShare;
    pendingShare = null;
    restoreExportLabels();
    shareImageFile(file, button).catch(error => {
      console.warn(error);
      alert('Sharing the image failed. Please try again.');
    });
    return;
  }
  pendingShare = null;
  restoreExportLabels();

  if (action === 'save' || useShareSheet()) saveSectionImage(name, button);
  else printSection(name);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function bindEvents() {
  document.querySelectorAll('.tabs .tab').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.querySelectorAll('[data-convert]').forEach(btn =>
    btn.addEventListener('click', () => setConvertMode(btn.dataset.convert)));
  document.querySelectorAll('[data-solve]').forEach(btn =>
    btn.addEventListener('click', () => setSolve(btn.dataset.solve)));
  document.querySelectorAll('[data-targets]').forEach(btn =>
    btn.addEventListener('click', () => setTargetMode(btn.dataset.targets)));
  document.querySelectorAll('[data-target-toggle]').forEach(btn =>
    // Each tap moves to the next rounding step: 1 → 2 → 5 → 10 → 1
    btn.addEventListener('click', () =>
      setTargetMode(ROUND_STEPS[(ROUND_STEPS.indexOf(state.targetMode) + 1) % ROUND_STEPS.length])));
  document.querySelectorAll('[role="tablist"]').forEach(bindArrowKeys);

  SAVED_INPUTS.forEach(id => {
    $(id).addEventListener('input', () => {
      storageSet(`in-${id}`, $(id).value);
      if (id === 'ftp-in') refreshAll();
      else if (id.startsWith('cv-')) calcConvert();
      else calcWorkout();
    });
  });

  // Tapping a numeric box selects its contents for quick replacement.
  document.querySelectorAll('input[type="number"]').forEach(input => {
    input.addEventListener('focus', () => setTimeout(() => input.select(), 0));
  });

  $('level-select').addEventListener('change', e => {
    const v = e.target.value;
    setLevel(v === 'auto' || v === 'ftp' ? v : Number(v));
  });
  document.querySelectorAll('[data-level-mode]').forEach(btn =>
    btn.addEventListener('click', () => setLevel(btn.dataset.levelMode)));

  const levelsBody = $('levels-body');
  levelsBody.addEventListener('click', e => {
    const row = e.target.closest('tr[data-level]');
    if (row && row.dataset.level !== 'ftp') setLevel(Number(row.dataset.level));
  });
  levelsBody.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('tr[data-level]');
    if (!row || row.dataset.level === 'ftp') return;
    e.preventDefault();
    const level = Number(row.dataset.level);
    setLevel(level);
    levelsBody.querySelector(`tr[data-level="${level}"]`)?.focus();
  });

  ['hr-max-in', 'hr-lthr-in'].forEach(id => {
    $(id).addEventListener('input', () => {
      storageSet(`in-${id}`, $(id).value);
      $('custom-hr-error').textContent = '';
      renderHrZones();
    });
  });
  document.querySelectorAll('[data-hr-subtab]').forEach(btn =>
    btn.addEventListener('click', () => setHrSubtab(btn.dataset.hrSubtab)));
  $('reset-custom-hr').addEventListener('click', resetCustomHr);
  $('hr-custom-export').addEventListener('change', e => {
    const input = e.target.closest('.hr-pct-input');
    if (input) applyCustomHrEdit(input);
  });
  $('hr-custom-export').addEventListener('focusin', e => {
    if (e.target.classList.contains('hr-pct-input')) setTimeout(() => e.target.select(), 0);
  });

  document.querySelectorAll('[data-print]').forEach(btn =>
    btn.addEventListener('click', () => onExportClick('print', btn.dataset.print, btn)));
  document.querySelectorAll('[data-save]').forEach(btn =>
    btn.addEventListener('click', () => onExportClick('save', btn.dataset.save, btn)));
  restoreExportLabels();
  // Load the image library early so the share sheet opens quickly after a tap.
  setTimeout(() => loadHtml2Canvas().catch(() => {}), 1200);
}

function loadSaved() {
  SAVED_INPUTS.forEach(id => {
    const saved = storageGet(`in-${id}`);
    if (saved !== null) $(id).value = saved;
  });
  const level = Number(storageGet('level'));
  if (LEVELS.includes(level)) state.pinnedLevel = level;
  const levelMode = storageGet('level-mode');
  if (['auto', 'ftp', 'pinned'].includes(levelMode)) state.levelMode = levelMode;
  // Earlier versions saved 'exact' or 'rounded' (5W).
  const targets = storageGet('targets');
  if (targets === 'rounded') state.targetMode = 5;
  else if (ROUND_STEPS.includes(Number(targets))) state.targetMode = Number(targets);
  const convert = storageGet('convert');
  if (convert === 'p2w' || convert === 'w2p') state.convertMode = convert;
  const solve = storageGet('solve');
  if (SOLVE_FIELDS[solve]) state.solve = solve;
  const tab = storageGet('tab');
  if (['convert', 'workout', 'zones', 'hr', 'levels'].includes(tab)) state.tab = tab;

  // Heart rate (this app's own saved values only).
  ['hr-max-in', 'hr-lthr-in'].forEach(id => {
    const saved = storageGet(`in-${id}`);
    if (saved !== null) $(id).value = saved;
  });
  customHr = loadCustomHr();
  if (storageGet('hr-subtab') === 'custom') hrSubtab = 'custom';
}

// ---------------------------------------------------------------------------
// Offline support and updates (see sw.js), same approach as the Watt Calculator.
// ---------------------------------------------------------------------------

function showUpdateNotice(registration) {
  if (document.getElementById('update-notice')) return;
  const notice = document.createElement('div');
  notice.id = 'update-notice';
  notice.className = 'update-notice no-export';
  notice.setAttribute('role', 'status');
  notice.innerHTML = '<span>Update available</span><button type="button">Refresh</button>';
  notice.querySelector('button').addEventListener('click', () => {
    notice.querySelector('button').disabled = true;
    registration.waiting?.postMessage('skipWaiting');
  });
  document.body.appendChild(notice);
}

function registerOfflineSupport() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  const watchForUpdates = registration => {
    const hasPreviousVersion = () => Boolean(navigator.serviceWorker.controller);
    if (registration.waiting && hasPreviousVersion()) showUpdateNotice(registration);
    registration.addEventListener('updatefound', () => {
      const incoming = registration.installing;
      incoming?.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && hasPreviousVersion()) showUpdateNotice(registration);
      });
    });
    // Only check when online: trying offline makes iPhone show an Airplane Mode warning.
    const checkForUpdate = () => { if (navigator.onLine) registration.update().catch(() => {}); };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    window.addEventListener('online', checkForUpdate);
  };

  const ready = navigator.onLine
    ? navigator.serviceWorker.register('sw.js')
    : navigator.serviceWorker.getRegistration();
  ready.then(registration => { if (registration) watchForUpdates(registration); })
    .catch(error => console.warn('Offline support unavailable:', error));

  if (!navigator.onLine) {
    window.addEventListener('online', () => {
      navigator.serviceWorker.getRegistration().then(existing => {
        if (!existing) navigator.serviceWorker.register('sw.js').then(watchForUpdates).catch(() => {});
      });
    }, { once: true });
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Keep the pinned sub-tab rows just below the main tab bar, whatever its
// height (it grows when its labels wrap onto two lines).
function measureTabBar() {
  const bar = document.querySelector('.tabs');
  if (bar) document.documentElement.style.setProperty('--tabs-h', `${bar.offsetHeight}px`);
}
window.addEventListener('resize', measureTabBar);
window.addEventListener('orientationchange', () => setTimeout(measureTabBar, 200));

window.addEventListener('DOMContentLoaded', () => {
  measureTabBar();
  loadSaved();
  bindEvents();
  setTargetMode(state.targetMode);   // also renders everything
  setConvertMode(state.convertMode);
  setSolve(state.solve);
  renderHrZones();
  setHrSubtab(hrSubtab);
  switchTab(state.tab);
  registerOfflineSupport();
});
