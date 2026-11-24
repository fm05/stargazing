// Astronomische Berechnungen (ohne externe Bibliothek).
// Genauigkeit: Sonne ~0.01°, Mond ~0.3° – mehr als genug für Fotoplanung.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const E = RAD * 23.4397; // Schiefe der Ekliptik

const toDays = (ms) => ms / 86400000 + 2440587.5 - 2451545.0;

function siderealTime(d, lw) {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

function altAz(ra, dec, d, lat, lng) {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const H = siderealTime(d, lw) - ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // Azimut von Norden aus, im Uhrzeigersinn
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  return { alt: alt * DEG, az: ((az * DEG) % 360 + 360) % 360 };
}

function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return {
    dec: Math.asin(Math.sin(E) * Math.sin(L)),
    ra: Math.atan2(Math.sin(L) * Math.cos(E), Math.cos(L)),
  };
}

function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  const dist = 385001 - 20905 * Math.cos(M);
  return {
    ra: Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l)),
    dec: Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l)),
    dist,
  };
}

// Galaktisches Zentrum (Sgr A*), J2000
const GC = { ra: RAD * 266.40499, dec: RAD * -28.93617 };

/** Mindesthöhe, ab der das Zentrum als "sichtbar" gilt – abhängig von der maximal erreichbaren Höhe am Ort. */
export function gcThreshold(lat) {
  const culmination = 90 - Math.abs(lat - GC.dec * DEG);
  return Math.max(2, Math.min(10, culmination - 3));
}
export function gcCulmination(lat) {
  return 90 - Math.abs(lat - GC.dec * DEG);
}

export function sunPosition(ms, lat, lng) {
  const d = toDays(ms);
  const c = sunCoords(d);
  return altAz(c.ra, c.dec, d, lat, lng);
}

export function moonPosition(ms, lat, lng) {
  const d = toDays(ms);
  const c = moonCoords(d);
  const p = altAz(c.ra, c.dec, d, lat, lng);
  // Horizontale Parallaxe (~0.95°) berücksichtigen
  const pi = Math.asin(6378.14 / c.dist) * DEG;
  p.alt -= pi * Math.cos(p.alt * RAD);
  p.dist = c.dist;
  return p;
}

export function galacticCenterPosition(ms, lat, lng) {
  const d = toDays(ms);
  return altAz(GC.ra, GC.dec, d, lat, lng);
}

export function moonIllumination(ms) {
  const d = toDays(ms);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sdist = 149598000;
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)
  );
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
  );
  return {
    fraction: (1 + Math.cos(inc)) / 2,
    phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI, // 0 Neumond, 0.5 Vollmond
  };
}

export function moonPhaseInfo(phase) {
  const names = [
    [0.03, 'Neumond', '🌑'],
    [0.22, 'Zunehmende Sichel', '🌒'],
    [0.28, 'Erstes Viertel', '🌓'],
    [0.47, 'Zunehmender Mond', '🌔'],
    [0.53, 'Vollmond', '🌕'],
    [0.72, 'Abnehmender Mond', '🌖'],
    [0.78, 'Letztes Viertel', '🌗'],
    [0.97, 'Abnehmende Sichel', '🌘'],
    [1.01, 'Neumond', '🌑'],
  ];
  for (const [lim, name, icon] of names) if (phase < lim) return { name, icon };
  return { name: 'Neumond', icon: '🌑' };
}

export function angularSeparation(a, b) {
  // a, b: {alt, az} in Grad
  const a1 = a.alt * RAD, a2 = b.alt * RAD;
  const dz = (a.az - b.az) * RAD;
  const c = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dz);
  return Math.acos(Math.max(-1, Math.min(1, c))) * DEG;
}

export function azimuthName(az) {
  const dirs = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(az / 22.5) % 16];
}

// Geomagnetische Breite (Dipol-Näherung, Nordpol ~80.8°N 72.6°W)
export function geomagneticLatitude(lat, lng) {
  const pLat = 80.8 * RAD, pLng = -72.6 * RAD;
  const s = Math.sin(lat * RAD) * Math.sin(pLat) + Math.cos(lat * RAD) * Math.cos(pLat) * Math.cos(lng * RAD - pLng);
  return Math.asin(s) * DEG;
}

/**
 * Analysiert eine Nacht von 12:00 (lokal) bis 12:00 am Folgetag.
 * startMs: Zeitstempel des Mittags (UTC-ms), stepMin: Auflösung.
 */
export function analyzeNight(startMs, lat, lng, stepMin = 5) {
  const step = stepMin * 60000;
  const samples = [];
  for (let t = startMs; t <= startMs + 24 * 3600000; t += step) {
    const sun = sunPosition(t, lat, lng);
    const moon = moonPosition(t, lat, lng);
    const gc = galacticCenterPosition(t, lat, lng);
    samples.push({ t, sun: sun.alt, moon: moon.alt, moonAz: moon.az, gc: gc.alt, gcAz: gc.az });
  }

  const crossing = (key, thr, dir) => {
    // dir 'down': erstes Unterschreiten; 'up': letztes Überschreiten (Morgen)
    if (dir === 'down') {
      for (let i = 1; i < samples.length; i++) {
        if (samples[i - 1][key] >= thr && samples[i][key] < thr) return interp(samples[i - 1], samples[i], key, thr);
      }
    } else {
      for (let i = samples.length - 1; i > 0; i--) {
        if (samples[i - 1][key] < thr && samples[i][key] >= thr) return interp(samples[i - 1], samples[i], key, thr);
      }
    }
    return null;
  };
  const interp = (a, b, key, thr) => a.t + ((thr - a[key]) / (b[key] - a[key])) * (b.t - a.t);

  const events = {
    sunset: crossing('sun', -0.833, 'down'),
    civilDusk: crossing('sun', -6, 'down'),
    nauticalDusk: crossing('sun', -12, 'down'),
    astroDusk: crossing('sun', -18, 'down'),
    astroDawn: crossing('sun', -18, 'up'),
    nauticalDawn: crossing('sun', -12, 'up'),
    civilDawn: crossing('sun', -6, 'up'),
    sunrise: crossing('sun', -0.833, 'up'),
  };

  // Mondauf-/untergang innerhalb des Fensters (alle Ereignisse)
  const moonEvents = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (a.moon < 0.125 && b.moon >= 0.125) moonEvents.push({ type: 'rise', t: interp(a, b, 'moon', 0.125), az: b.moonAz });
    if (a.moon >= 0.125 && b.moon < 0.125) moonEvents.push({ type: 'set', t: interp(a, b, 'moon', 0.125), az: b.moonAz });
  }

  const sumMinutes = (pred) => samples.filter(pred).length * stepMin;
  const astroDarkMin = sumMinutes((s) => s.sun < -18);
  const nauticalDarkMin = sumMinutes((s) => s.sun < -12);
  const moonFreeDarkMin = sumMinutes((s) => s.sun < -18 && s.moon < 0);

  // Milchstraßenzentrum: sichtbar wenn hoch genug und (fast) astronomisch dunkel
  const thr = gcThreshold(lat);
  const gcDark = samples.filter((s) => s.sun < -15 && s.gc > thr);
  let gcWindow = null;
  if (gcDark.length) {
    gcWindow = { start: gcDark[0].t, end: gcDark[gcDark.length - 1].t + step, minutes: gcDark.length * stepMin };
    let best = gcDark[0];
    for (const s of gcDark) if (s.gc > best.gc) best = s;
    gcWindow.bestT = best.t; gcWindow.bestAlt = best.gc; gcWindow.bestAz = best.gcAz;
    gcWindow.moonFreeMin = gcDark.filter((s) => s.moon < 0).length * stepMin;
  }

  const midT = events.astroDusk && events.astroDawn ? (events.astroDusk + events.astroDawn) / 2 : startMs + 12 * 3600000;
  const illum = moonIllumination(midT);

  return { samples, events, moonEvents, astroDarkMin, nauticalDarkMin, moonFreeDarkMin, gcWindow, illum, midT };
}

/** Sucht die nächste Nacht (ab startMs), in der das Milchstraßenzentrum mind. 30 min sichtbar ist. */
export function nextMilkyWaySeason(startMs, lat, lng, maxDays = 370) {
  const thr = gcThreshold(lat);
  if (gcCulmination(lat) < 4) return null;
  for (let day = 0; day < maxDays; day++) {
    const base = startMs + day * 86400000;
    let minutes = 0;
    for (let m = 0; m < 24 * 60; m += 15) {
      const t = base + m * 60000;
      if (sunPosition(t, lat, lng).alt < -15 && galacticCenterPosition(t, lat, lng).alt > thr) minutes += 15;
    }
    if (minutes >= 30) return { t: base, day };
  }
  return null;
}

/** Nächster Neumond ab ms (Näherung über Phasensuche). */
export function nextNewMoon(ms) {
  let prev = moonIllumination(ms).phase;
  for (let h = 1; h < 24 * 31; h++) {
    const p = moonIllumination(ms + h * 3600000).phase;
    if (p < prev - 0.5) return ms + h * 3600000;
    prev = p;
  }
  return null;
}

// Meteorströme (Daten: IMO, Maximum jährlich wiederkehrend)
export const METEOR_SHOWERS = [
  { name: 'Quadrantiden', peak: [1, 3], start: [12, 28], end: [1, 12], zhr: 110 },
  { name: 'Lyriden', peak: [4, 22], start: [4, 14], end: [4, 30], zhr: 18 },
  { name: 'Eta-Aquariiden', peak: [5, 6], start: [4, 19], end: [5, 28], zhr: 50 },
  { name: 'Südliche Delta-Aquariiden', peak: [7, 30], start: [7, 12], end: [8, 23], zhr: 25 },
  { name: 'Perseiden', peak: [8, 12], start: [7, 17], end: [8, 24], zhr: 100 },
  { name: 'Draconiden', peak: [10, 8], start: [10, 6], end: [10, 10], zhr: 10 },
  { name: 'Orioniden', peak: [10, 21], start: [10, 2], end: [11, 7], zhr: 20 },
  { name: 'Südliche Tauriden', peak: [11, 5], start: [9, 10], end: [11, 20], zhr: 5 },
  { name: 'Nördliche Tauriden', peak: [11, 12], start: [10, 20], end: [12, 10], zhr: 5 },
  { name: 'Leoniden', peak: [11, 17], start: [11, 6], end: [11, 30], zhr: 15 },
  { name: 'Geminiden', peak: [12, 14], start: [12, 4], end: [12, 20], zhr: 150 },
  { name: 'Ursiden', peak: [12, 22], start: [12, 17], end: [12, 26], zhr: 10 },
];

export function activeMeteorShowers(date) {
  const y = date.getFullYear();
  const res = [];
  for (const s of METEOR_SHOWERS) {
    for (const yy of [y - 1, y, y + 1]) {
      const startY = s.start[0] > s.end[0] ? yy - 1 : yy;
      const start = new Date(startY, s.start[0] - 1, s.start[1]);
      const end = new Date(yy, s.end[0] - 1, s.end[1], 23, 59);
      const peakY = s.peak[0] < s.start[0] ? yy : startY;
      const peak = new Date(peakY, s.peak[0] - 1, s.peak[1]);
      if (date >= start && date <= end) {
        const daysToPeak = Math.round((peak - date) / 86400000);
        res.push({ ...s, peakDate: peak, daysToPeak });
      }
    }
  }
  return res.sort((a, b) => Math.abs(a.daysToPeak) - Math.abs(b.daysToPeak));
}
