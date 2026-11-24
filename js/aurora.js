// Polarlicht: aktueller Sonnenwind (NOAA SWPC), OVATION-Wahrscheinlichkeit, Kp-Vorhersage.
const BASE = 'https://services.swpc.noaa.gov';

async function getJSON(url, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

/** Aktuelle Werte am Lagrange-Punkt L1 (~30–60 min Vorlauf zur Erde). */
export async function solarWind() {
  const [mag, speed] = await Promise.all([
    getJSON(`${BASE}/products/summary/solar-wind-mag-field.json`).catch(() => null),
    getJSON(`${BASE}/products/summary/solar-wind-speed.json`).catch(() => null),
  ]);
  const m = Array.isArray(mag) ? mag[0] : mag;
  const s = Array.isArray(speed) ? speed[0] : speed;
  return {
    bz: m?.bz_gsm != null ? +m.bz_gsm : null,
    bt: m?.bt != null ? +m.bt : null,
    speed: s?.proton_speed != null ? +s.proton_speed : null,
    time: m?.time_tag || s?.time_tag || null,
  };
}

let ovCache = null;
/**
 * OVATION-Modell: Wahrscheinlichkeit für Polarlicht über dem Ort und am Horizont
 * (Polarlicht in 100–300 km Höhe ist bis ca. 800 km entfernt noch am Horizont sichtbar ≈ 7–8° Breite).
 */
export async function ovationAt(lat, lng) {
  if (!ovCache || Date.now() - ovCache.t > 15 * 60000) {
    const j = await getJSON(`${BASE}/json/ovation_aurora_latest.json`, 30000);
    const grid = new Map();
    for (const [lo, la, v] of j.coordinates) grid.set(`${lo},${la}`, v);
    ovCache = { t: Date.now(), grid, forecast: j['Forecast Time'] };
  }
  const lon0 = Math.round(((lng % 360) + 360) % 360);
  const lat0 = Math.round(lat);
  const get = (lo, la) => ovCache.grid.get(`${((lo % 360) + 360) % 360},${la}`) ?? 0;
  const overhead = get(lon0, lat0);
  const dir = lat >= 0 ? 1 : -1;
  let horizon = 0;
  for (let d = 0; d <= 8; d++) for (let dl = -4; dl <= 4; dl++) horizon = Math.max(horizon, get(lon0 + dl, lat0 + dir * d));
  return { overhead, horizon, forecast: ovCache.forecast };
}

export const OVAL_IMAGE = (lat) =>
  `${BASE}/images/animations/ovation/${lat >= 0 ? 'north' : 'south'}/latest.jpg`;

/** Einschätzung in Worten. */
export function auroraVerdict({ kpNeeded, kpMax, bz, speed, horizon }) {
  let pts = 0;
  if (kpMax != null) pts += kpMax >= kpNeeded + 1 ? 3 : kpMax >= kpNeeded ? 2 : kpMax >= kpNeeded - 1 ? 1 : 0;
  if (bz != null) pts += bz <= -10 ? 2 : bz <= -5 ? 1 : 0;
  if (speed != null) pts += speed >= 600 ? 1 : 0;
  if (horizon != null) pts += horizon >= 30 ? 3 : horizon >= 10 ? 2 : horizon >= 3 ? 1 : 0;
  if (pts >= 6) return { cls: 'good', text: 'Gute Chance – Kamera Richtung Pol ausrichten!' };
  if (pts >= 4) return { cls: 'warn', text: 'Möglich – mit Langzeitbelichtung am Horizont' };
  if (pts >= 2) return { cls: 'serious', text: 'Eher unwahrscheinlich' };
  return { cls: 'crit', text: 'Kein Polarlicht zu erwarten' };
}
