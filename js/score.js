// Bewertungslogik: jede Stunde der Nacht bekommt Teilfaktoren (0…1) und einen Gesamtscore (0…100).
const RAD = Math.PI / 180;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

export const BORTLE = [
  null,
  { label: 'Exzellenter dunkler Himmel', star: 1.0, mw: 1.0 },
  { label: 'Typisch dunkler Himmel', star: 1.0, mw: 0.98 },
  { label: 'Ländlicher Himmel', star: 0.95, mw: 0.9 },
  { label: 'Übergang Land/Vorort', star: 0.88, mw: 0.78 },
  { label: 'Vorort', star: 0.78, mw: 0.6 },
  { label: 'Heller Vorort', star: 0.66, mw: 0.4 },
  { label: 'Übergang Vorort/Stadt', star: 0.55, mw: 0.22 },
  { label: 'Stadt', star: 0.45, mw: 0.1 },
  { label: 'Innenstadt', star: 0.35, mw: 0.04 },
];

export function darknessFactor(sun) {
  if (sun < -18) return 1;
  if (sun < -12) return 0.55 + (0.45 * (-12 - sun)) / 6;
  if (sun < -6) return 0.12 + (0.43 * (-6 - sun)) / 6;
  return 0;
}

export function cloudFactor(low, mid, high) {
  const eff = 1 - (1 - low / 100) * (1 - mid / 100) * (1 - (0.8 * high) / 100);
  return { f: Math.pow(clamp(1 - eff), 1.3), eff: eff * 100 };
}

export function moonBrightness(alt, fraction) {
  if (alt > 0) return fraction * clamp(0.25 + Math.sin(alt * RAD) * 1.2);
  if (alt > -4) return fraction * 0.1;
  return 0;
}

function precipFactor(pp, mm) {
  let f = 1 - (0.6 * (pp ?? 0)) / 100;
  if ((mm ?? 0) >= 0.2) f *= 0.2;
  return clamp(f);
}

function humidityFactor(rh) {
  if (rh == null) return 1;
  if (rh > 95) return 0.7;
  if (rh > 85) return 0.85;
  if (rh > 75) return 0.95;
  return 1;
}

function visibilityFactor(v) {
  if (v == null) return 1;
  if (v < 5000) return 0.6;
  if (v < 10000) return 0.8;
  if (v < 20000) return 0.92;
  return 1;
}

function aodFactor(aod) {
  if (aod == null) return null;
  if (aod < 0.1) return 1;
  if (aod < 0.2) return 0.95;
  if (aod < 0.3) return 0.88;
  if (aod < 0.5) return 0.78;
  return 0.65;
}

const TRANSP_F = [1, 1, 1, 0.97, 0.93, 0.88, 0.82, 0.75, 0.7];

function windFactor(w, g) {
  if (w == null) return 1;
  let f = w < 12 ? 1 : w < 20 ? 0.93 : w < 30 ? 0.82 : 0.65;
  if ((g ?? 0) > 45) f *= 0.85;
  return f;
}

function gcFactor(alt, culm) {
  if (alt <= 0) return 0;
  // Ziel: 20° oder – wo das Zentrum nie so hoch steigt – nahe der Kulmination
  const target = Math.max(4, Math.min(20, culm - 1));
  return alt >= target ? 1 : Math.pow(alt / target, 0.8);
}

export function rating(score) {
  if (score >= 75) return { text: 'Hervorragend', cls: 'good' };
  if (score >= 55) return { text: 'Gut', cls: 'good' };
  if (score >= 35) return { text: 'Mäßig', cls: 'warn' };
  if (score >= 15) return { text: 'Schlecht', cls: 'serious' };
  return { text: 'Keine Chance', cls: 'crit' };
}

function nearest(list, t, maxDiff) {
  let best = null, bd = Infinity;
  for (const x of list) {
    const d = Math.abs(x.t - t);
    if (d < bd) { bd = d; best = x; }
  }
  return bd <= maxDiff ? best : null;
}

/**
 * Baut die Stunden-Bewertungen für eine Nacht.
 * night: Ergebnis von analyzeNight; data: { forecast, aq, jet, seven, kp }
 */
export function scoreNight(night, data, settings) {
  const { samples, illum } = night;
  const bortle = BORTLE[settings.bortle] || BORTLE[4];
  const hours = [];
  const firstHour = Math.floor(samples[0].t / 3600000) * 3600000;

  for (let t = firstHour; t < samples[samples.length - 1].t; t += 3600000) {
    const inHour = samples.filter((s) => s.t >= t && s.t < t + 3600000);
    if (!inHour.length) continue;
    const avg = (k) => inHour.reduce((a, s) => a + s[k], 0) / inHour.length;
    const sun = avg('sun');
    if (sun > -4) continue; // nur Dämmerung/Nacht
    const moon = avg('moon');
    const gc = avg('gc');
    const mid = inHour[Math.floor(inHour.length / 2)];

    const w = data.forecast?.hourly.get(t);
    if (!w) continue;
    const aq = data.aq?.get(t);
    const jet = data.jet?.get(t);
    const seven = data.seven ? nearest(data.seven, t + 1800000, 1.6 * 3600000) : null;

    const dark = darknessFactor(sun);
    const cloud = cloudFactor(w.cloud_cover_low ?? 0, w.cloud_cover_mid ?? 0, w.cloud_cover_high ?? 0);
    const precip = precipFactor(w.precipitation_probability, w.precipitation);
    const bright = moonBrightness(moon, illum.fraction);
    const moonF = 1 - 0.75 * bright;
    const moonMW = 1 - 0.92 * bright;
    const hum = humidityFactor(w.relative_humidity_2m);
    const vis = visibilityFactor(w.visibility);
    const aodF = aodFactor(aq?.aerosol_optical_depth);
    const sevenF = seven ? TRANSP_F[seven.transparency] ?? 1 : null;
    const transp = Math.min(aodF ?? 1, sevenF ?? 1);
    const wind = windFactor(w.wind_speed_10m, w.wind_gusts_10m);
    const gcF = gcFactor(gc, settings.gcCulm ?? 30);

    const base = dark * cloud.f * precip * hum * vis * transp * wind;
    const stars = 100 * base * moonF * bortle.star;
    const mw = 100 * base * moonMW * bortle.mw * gcF;

    hours.push({
      t, sun, moon, gc, gcAz: mid.gcAz, moonAz: mid.moonAz,
      temp: w.temperature_2m, dew: w.dew_point_2m, rh: w.relative_humidity_2m,
      pp: w.precipitation_probability, mm: w.precipitation,
      cloud: w.cloud_cover, low: w.cloud_cover_low, midc: w.cloud_cover_mid, high: w.cloud_cover_high, effCloud: cloud.eff,
      vis: w.visibility, wind: w.wind_speed_10m, gust: w.wind_gusts_10m,
      jet: jet?.wind_speed_250hPa, aod: aq?.aerosol_optical_depth, dust: aq?.dust, pm25: aq?.pm2_5,
      seeing: seven?.seeing, transparency: seven?.transparency,
      f: { dark, cloud: cloud.f, precip, moon: moonF, hum, vis, transp, wind, gc: gcF },
      stars, mw,
    });
  }

  const future = settings.notBefore ? hours.filter((h) => h.t + 3600000 > settings.notBefore) : hours;
  const best = (key) => bestWindow(future, key);
  const darkHours = hours.filter((h) => h.sun < -12);
  const pool = darkHours.length ? darkHours : hours;
  const mean = (k) => (pool.length ? pool.reduce((a, h) => a + (h[k] ?? 0), 0) / pool.length : null);
  const minOf = (k) => (pool.length ? Math.min(...pool.map((h) => h[k] ?? Infinity)) : null);
  const maxOf = (k) => (pool.length ? Math.max(...pool.map((h) => h[k] ?? -Infinity)) : null);
  const valid = (k) => pool.filter((h) => h[k] != null);
  const meanValid = (k) => { const v = valid(k); return v.length ? v.reduce((a, h) => a + h[k], 0) / v.length : null; };

  // Kp während der Nacht
  let kpMax = null;
  if (data.kp?.length && night.events.nauticalDusk) {
    const end = night.events.nauticalDawn || night.events.nauticalDusk + 8 * 3600000;
    const inNight = data.kp.filter((k) => k.t + 3 * 3600000 >= night.events.nauticalDusk && k.t <= end);
    if (inNight.length) kpMax = Math.max(...inNight.map((k) => k.kp));
  }

  return {
    hours,
    stars: best('stars'),
    mw: best('mw'),
    summary: {
      cloud: mean('effCloud'), cloudMin: minOf('effCloud'),
      low: mean('low'), mid: mean('midc'), high: mean('high'),
      pp: maxOf('pp'), rh: mean('rh'), tempMin: minOf('temp'), tempMax: maxOf('temp'),
      spreadMin: pool.length ? Math.min(...pool.map((h) => (h.temp ?? 99) - (h.dew ?? -99))) : null,
      wind: mean('wind'), gust: maxOf('gust'), vis: meanValid('vis'),
      jet: meanValid('jet'), aod: meanValid('aod'), dust: meanValid('dust'),
      seeing: meanValid('seeing'), transparency: meanValid('transparency'),
      kpMax,
    },
  };
}

function bestWindow(hours, key, len = 2) {
  if (!hours.length) return { score: 0, start: null, end: null };
  let best = { score: -1, start: null, end: null };
  for (let i = 0; i < hours.length; i++) {
    const win = hours.slice(i, i + len).filter((h) => h.t - hours[i].t < len * 3600000);
    const s = win.reduce((a, h) => a + h[key], 0) / win.length;
    // kürzere Fenster am Rand leicht abwerten
    const adj = win.length < len ? s * 0.9 : s;
    if (adj > best.score) best = { score: adj, start: hours[i].t, end: win[win.length - 1].t + 3600000 };
  }
  best.score = Math.round(clamp(best.score, 0, 100));
  return best;
}
