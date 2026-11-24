// Sichtbare Überflüge von ISS, Tiangong und Hubble sowie frisch gestarteten Starlink-Zügen.
// Bahndaten (TLE) von CelesTrak, Bahnberechnung mit satellite.js (SGP4).
import { sunEquatorial, sunPosition, azimuthName } from './astro.js';

const RAD = Math.PI / 180;
const RE = 6371; // Erdradius km
const CACHE_H = 12;

const TARGETS = [
  { url: 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle', name: 'ISS', std: -1.8 },
  { url: 'https://celestrak.org/NORAD/elements/gp.php?CATNR=48274&FORMAT=tle', name: 'Tiangong', std: -0.6 },
  { url: 'https://celestrak.org/NORAD/elements/gp.php?CATNR=20580&FORMAT=tle', name: 'Hubble', std: 1.5 },
];
const RECENT = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=tle';

function parseTLE(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    if (lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
      out.push({ name: lines[i].trim(), l1: lines[i + 1], l2: lines[i + 2] });
      i += 2;
    }
  }
  return out;
}

async function fetchTLE(url) {
  const key = 'tle:' + url;
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && Date.now() - c.t < CACHE_H * 3600000) return c.d;
  } catch { /* ignore */ }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = parseTLE(await r.text());
    if (!d.length) throw new Error('keine Bahndaten');
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch { /* voll */ }
    return d;
  } catch (e) {
    // veraltete Daten sind besser als keine (TLE bleiben einige Tage brauchbar)
    try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c) return c.d; } catch { /* ignore */ }
    throw e;
  } finally { clearTimeout(timer); }
}

function sunUnit(ms) {
  const s = sunEquatorial(ms);
  return [Math.cos(s.dec) * Math.cos(s.ra), Math.cos(s.dec) * Math.sin(s.ra), Math.sin(s.dec)];
}

function inShadow(pos, ms) {
  // zylindrischer Erdschatten
  const s = sunUnit(ms);
  const dot = pos.x * s[0] + pos.y * s[1] + pos.z * s[2];
  if (dot > 0) return false;
  const px = pos.x - dot * s[0], py = pos.y - dot * s[1], pz = pos.z - dot * s[2];
  return Math.hypot(px, py, pz) < RE;
}

/** Berechnet sichtbare Überflüge in [t0, t1]. */
function passes(sat, satrec, t0, t1, lat, lng, minEl = 10) {
  const S = window.satellite;
  const obs = { latitude: lat * RAD, longitude: lng * RAD, height: 0.1 };
  const out = [];
  let cur = null;
  const step = 20000;
  for (let t = t0; t <= t1; t += step) {
    const d = new Date(t);
    const pv = S.propagate(satrec, d);
    if (!pv || !pv.position) { if (cur) { out.push(cur); cur = null; } continue; }
    const look = S.ecfToLookAngles(obs, S.eciToEcf(pv.position, S.gstime(d)));
    const el = look.elevation / RAD;
    const visible = el > minEl && sunPosition(t, lat, lng).alt < -6 && !inShadow(pv.position, t);
    if (visible) {
      const az = look.azimuth / RAD;
      if (!cur) cur = { name: sat.label || sat.name, start: t, startAz: az, maxEl: el, maxT: t, maxAz: az, range: look.rangeSat };
      if (el > cur.maxEl) { cur.maxEl = el; cur.maxT = t; cur.maxAz = az; cur.range = look.rangeSat; }
      cur.end = t; cur.endAz = az;
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter((p) => p.end - p.start >= 40000).map((p) => ({
    ...p,
    startDir: azimuthName(p.startAz), endDir: azimuthName(p.endAz), maxDir: azimuthName(p.maxAz),
    duration: Math.round((p.end - p.start) / 1000),
    mag: sat.std != null ? Math.round((sat.std + 5 * Math.log10(p.range / 1000)) * 10) / 10 : null,
  }));
}

/**
 * Sichtbare Überflüge in einem Zeitfenster.
 * Ergebnis: { passes: [...], starlink: [...], errors: [...] }
 */
export async function satellitePasses(t0, t1, lat, lng) {
  if (!window.satellite) throw new Error('Bahnberechnungs-Bibliothek nicht geladen');
  const S = window.satellite;
  const res = { passes: [], starlink: [], errors: [] };
  await Promise.all(TARGETS.map(async (tg) => {
    try {
      const [sat] = await fetchTLE(tg.url);
      const rec = S.twoline2satrec(sat.l1, sat.l2);
      res.passes.push(...passes({ ...sat, label: tg.name, std: tg.std }, rec, t0, t1, lat, lng));
    } catch (e) { res.errors.push(`${tg.name}: ${e.message}`); }
  }));
  // Starlink: frisch gestartete Satelliten fliegen als helle "Perlenkette" – je Start ein Vertreter
  try {
    const recent = (await fetchTLE(RECENT)).filter((s) => /STARLINK/i.test(s.name));
    const byLaunch = new Map();
    for (const s of recent) {
      const launch = s.l1.slice(9, 14).trim(); // internationale Kennung JJNNN
      if (!byLaunch.has(launch)) byLaunch.set(launch, s);
    }
    for (const [launch, s] of byLaunch) {
      const rec = S.twoline2satrec(s.l1, s.l2);
      const p = passes({ ...s, label: `Starlink-Zug (Start 20${launch.slice(0, 2)}-${launch.slice(2)})`, std: 2 }, rec, t0, t1, lat, lng, 15);
      res.starlink.push(...p);
    }
  } catch (e) { res.errors.push(`Starlink: ${e.message}`); }
  res.passes.sort((a, b) => a.start - b.start);
  res.starlink.sort((a, b) => a.start - b.start);
  return res;
}
