// Planeten (Keplerbahnen nach JPL "Approximate Positions of the Planets", gültig 1800–2050, Genauigkeit ~ Bogenminuten)
// und ein Katalog lohnender Deep-Sky-Objekte für die Fotografie.
import { horizontal, sunPosition, moonPosition, azimuthName, angularSeparation } from './astro.js';

const RAD = Math.PI / 180;
const OBL = 23.43928 * RAD;

// a [AE], e, I [°], L [°], ϖ [°], Ω [°] und Änderung pro Jahrhundert
const EL = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};

// Helligkeit nach Mallama & Hilton (2018): Grundhelligkeit + Polynom im Phasenwinkel i [°]
const poly = (c, i) => c.reduce((acc, k, n) => acc + k * i ** n, 0);
const MAG = {
  mercury: (i) => poly([-0.613, 6.328e-2, -1.6336e-3, 3.3644e-5, -3.4265e-7, 1.6893e-9, -3.0334e-12], i),
  venus: (i) => (i < 163.7 ? poly([-4.384, -1.044e-3, 3.687e-4, -2.814e-6, 8.938e-9], i) : poly([236.05828, -2.81914, 8.39034e-3], i)),
  mars: (i) => poly([-1.601, 0.02267, -0.0001302], Math.min(i, 50)),
  jupiter: (i) => poly([-9.395, -3.7e-4, 6.16e-4], i),
  saturn: (i) => -8.914 + 0.026 * i,
  uranus: (i) => -7.11 + 6.587e-3 * i,
  neptune: () => -7.0,
};

export const PLANETS = [
  { id: 'mercury', name: 'Merkur', icon: '☿' },
  { id: 'venus', name: 'Venus', icon: '♀' },
  { id: 'mars', name: 'Mars', icon: '♂' },
  { id: 'jupiter', name: 'Jupiter', icon: '♃' },
  { id: 'saturn', name: 'Saturn', icon: '♄' },
  { id: 'uranus', name: 'Uranus', icon: '⛢' },
  { id: 'neptune', name: 'Neptun', icon: '♆' },
];

function helio(id, T) {
  const [e0, rate] = EL[id];
  const [a, e, I, L, wbar, node] = e0.map((v, i) => v + rate[i] * T);
  const w = wbar - node;
  let M = ((L - wbar) % 360 + 540) % 360 - 180;
  M *= RAD;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w * RAD), sw = Math.sin(w * RAD);
  const cO = Math.cos(node * RAD), sO = Math.sin(node * RAD);
  const cI = Math.cos(I * RAD), sI = Math.sin(I * RAD);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: sw * sI * xp + cw * sI * yp,
  };
}

/** Geozentrische Äquatorkoordinaten (Radiant), Entfernung und Helligkeit eines Planeten. */
export function planetEquatorial(id, ms) {
  const T = (ms / 86400000 + 2440587.5 - 2451545.0) / 36525;
  const p = helio(id, T), e = helio('earth', T);
  const x = p.x - e.x, y = p.y - e.y, z = p.z - e.z;
  const xe = x, ye = y * Math.cos(OBL) - z * Math.sin(OBL), ze = y * Math.sin(OBL) + z * Math.cos(OBL);
  const delta = Math.hypot(x, y, z);
  const r = Math.hypot(p.x, p.y, p.z), R = Math.hypot(e.x, e.y, e.z);
  const phase = Math.acos(Math.max(-1, Math.min(1, (r * r + delta * delta - R * R) / (2 * r * delta)))) / RAD;
  return {
    ra: Math.atan2(ye, xe),
    dec: Math.asin(ze / delta),
    dist: delta,
    mag: 5 * Math.log10(r * delta) + MAG[id](phase),
  };
}

const hms = (h, m) => (h + m / 60) * 15 * RAD;
const dms = (d, m) => (d < 0 || Object.is(d, -0) ? -1 : 1) * (Math.abs(d) + m / 60) * RAD;

// Katalog: Name, Typ, RA, Dec, Helligkeit, Größe, empfohlene Brennweite (KB)
export const DSO = [
  { id: 'M31', name: 'Andromedagalaxie', type: 'Galaxie', ra: hms(0, 42.7), dec: dms(41, 16), mag: 3.4, size: '3°', focal: '135–300 mm' },
  { id: 'M33', name: 'Dreiecksgalaxie', type: 'Galaxie', ra: hms(1, 33.9), dec: dms(30, 39), mag: 5.7, size: '70′', focal: '400–800 mm' },
  { id: 'NGC869', name: 'Doppelsternhaufen h & χ', type: 'Sternhaufen', ra: hms(2, 20.5), dec: dms(57, 8), mag: 4.3, size: '1°', focal: '200–500 mm' },
  { id: 'IC1805', name: 'Herz- & Seelennebel', type: 'Nebel', ra: hms(2, 40), dec: dms(61, 0), mag: 6.5, size: '3°', focal: '85–200 mm' },
  { id: 'M45', name: 'Plejaden', type: 'Sternhaufen', ra: hms(3, 47), dec: dms(24, 7), mag: 1.6, size: '2°', focal: '135–400 mm' },
  { id: 'M42', name: 'Orionnebel', type: 'Nebel', ra: hms(5, 35.3), dec: dms(-5, 23), mag: 4, size: '1°', focal: '200–600 mm' },
  { id: 'B33', name: 'Pferdekopf & Flammennebel', type: 'Nebel', ra: hms(5, 41), dec: dms(-2, 20), mag: 7, size: '1,5°', focal: '300–600 mm' },
  { id: 'NGC2237', name: 'Rosettennebel', type: 'Nebel', ra: hms(6, 33.8), dec: dms(4, 59), mag: 9, size: '1,3°', focal: '300–600 mm' },
  { id: 'M44', name: 'Praesepe (Krippe)', type: 'Sternhaufen', ra: hms(8, 40.1), dec: dms(19, 59), mag: 3.7, size: '1,5°', focal: '200–400 mm' },
  { id: 'M81', name: 'Bodes Galaxie & Zigarre', type: 'Galaxie', ra: hms(9, 55.6), dec: dms(69, 4), mag: 6.9, size: '30′', focal: '600–1000 mm' },
  { id: 'NGC3372', name: 'Carinanebel', type: 'Nebel', ra: hms(10, 45), dec: dms(-59, 52), mag: 1, size: '2°', focal: '135–400 mm' },
  { id: 'M51', name: 'Whirlpool-Galaxie', type: 'Galaxie', ra: hms(13, 29.9), dec: dms(47, 12), mag: 8.4, size: '11′', focal: '800–1500 mm' },
  { id: 'NGC5139', name: 'Omega Centauri', type: 'Kugelsternhaufen', ra: hms(13, 26.8), dec: dms(-47, 29), mag: 3.9, size: '36′', focal: '500–1000 mm' },
  { id: 'M101', name: 'Feuerradgalaxie', type: 'Galaxie', ra: hms(14, 3.2), dec: dms(54, 21), mag: 7.9, size: '29′', focal: '800–1200 mm' },
  { id: 'M13', name: 'Herkules-Kugelsternhaufen', type: 'Kugelsternhaufen', ra: hms(16, 41.7), dec: dms(36, 28), mag: 5.8, size: '20′', focal: '800–1500 mm' },
  { id: 'M8', name: 'Lagunen- & Trifidnebel', type: 'Nebel', ra: hms(18, 3), dec: dms(-23, 40), mag: 6, size: '1,5°', focal: '300–600 mm' },
  { id: 'M16', name: 'Adler- & Omeganebel', type: 'Nebel', ra: hms(18, 19.5), dec: dms(-15, 0), mag: 6, size: '2°', focal: '300–600 mm' },
  { id: 'M57', name: 'Ringnebel', type: 'Planetarischer Nebel', ra: hms(18, 53.6), dec: dms(33, 2), mag: 8.8, size: '1,4′', focal: '1500+ mm' },
  { id: 'M27', name: 'Hantelnebel', type: 'Planetarischer Nebel', ra: hms(19, 59.6), dec: dms(22, 43), mag: 7.5, size: '8′', focal: '1000–2000 mm' },
  { id: 'NGC6960', name: 'Cirrusnebel (Schleier)', type: 'Nebel', ra: hms(20, 51), dec: dms(30, 40), mag: 7, size: '3°', focal: '200–500 mm' },
  { id: 'NGC7000', name: 'Nordamerika- & Pelikannebel', type: 'Nebel', ra: hms(20, 59.3), dec: dms(44, 31), mag: 4, size: '2°', focal: '135–300 mm' },
  { id: 'IC1396', name: 'Elefantenrüsselnebel', type: 'Nebel', ra: hms(21, 39), dec: dms(57, 30), mag: 3.5, size: '3°', focal: '200–500 mm' },
  { id: 'NGC7293', name: 'Helixnebel', type: 'Planetarischer Nebel', ra: hms(22, 29.6), dec: dms(-20, 50), mag: 7.6, size: '16′', focal: '800–1500 mm' },
  { id: 'LMC', name: 'Große Magellansche Wolke', type: 'Galaxie', ra: hms(5, 23.6), dec: dms(-69, 45), mag: 0.9, size: '10°', focal: '24–50 mm' },
  { id: 'SMC', name: 'Kleine Magellansche Wolke', type: 'Galaxie', ra: hms(0, 52.7), dec: dms(-72, 50), mag: 2.7, size: '5°', focal: '35–85 mm' },
];

/**
 * Sichtbarkeit eines Objekts in einer Nacht: höchster Stand während der Dunkelheit,
 * Zeitraum über 20°, Abstand zum Mond.
 * getEq(ms) -> {ra, dec}
 */
function visibility(getEq, night, lat, lng, fixed) {
  const darkSamples = night.samples.filter((s, i) => s.sun < -12 && i % 2 === 0); // 10-min-Raster
  if (!darkSamples.length) return null;
  let best = null, aboveMin = 0, first = null, last = null;
  const eq0 = fixed ? getEq() : null;
  for (const s of darkSamples) {
    const eq = eq0 || getEq(s.t);
    const h = horizontal(eq.ra, eq.dec, s.t, lat, lng);
    if (!best || h.alt > best.alt) best = { t: s.t, alt: h.alt, az: h.az, moonAlt: s.moon, moonAz: s.moonAz };
    if (h.alt > 20) { aboveMin += 10; if (!first) first = s.t; last = s.t; }
  }
  const moonSep = best.moonAlt > 0 ? angularSeparation({ alt: best.alt, az: best.az }, { alt: best.moonAlt, az: best.moonAz }) : null;
  return { bestT: best.t, maxAlt: best.alt, az: best.az, dir: azimuthName(best.az), minutesAbove20: aboveMin, from: first, to: last, moonSep };
}

/** Planeten für eine Nacht – sortiert nach Sichtbarkeit. */
export function planetsTonight(night, lat, lng) {
  const mid = night.midT;
  return PLANETS.map((p) => {
    const eq = planetEquatorial(p.id, mid);
    const v = visibility((t) => planetEquatorial(p.id, t), night, lat, lng, false);
    // Abendstern/Morgenstern: Venus/Merkur in der Dämmerung
    let twilight = null;
    if ((p.id === 'venus' || p.id === 'mercury') && night.events.sunset) {
      const t = night.events.civilDusk ?? night.events.sunset + 1800000;
      const h = horizontal(planetEquatorial(p.id, t).ra, planetEquatorial(p.id, t).dec, t, lat, lng);
      const t2 = night.events.civilDawn ?? (night.events.sunrise ? night.events.sunrise - 1800000 : null);
      const h2 = t2 ? horizontal(planetEquatorial(p.id, t2).ra, planetEquatorial(p.id, t2).dec, t2, lat, lng) : { alt: -90 };
      if (h.alt > 5 && h.alt >= h2.alt) twilight = { kind: 'Abendhimmel', t, alt: h.alt, dir: azimuthName(h.az) };
      else if (h2.alt > 5) twilight = { kind: 'Morgenhimmel', t: t2, alt: h2.alt, dir: azimuthName(h2.az) };
    }
    return { ...p, mag: eq.mag, dist: eq.dist, vis: v, twilight };
  }).sort((a, b) => {
    // erst gut sichtbare (nach Helligkeit), dann Dämmerungsplaneten, dann unsichtbare
    const g = (p) => (p.vis && p.vis.maxAlt > 10 ? 0 : p.twilight ? 1 : 2);
    return g(a) - g(b) || a.mag - b.mag;
  });
}

/** Deep-Sky-Objekte für eine Nacht – nur die, die mindestens 20° hoch steigen. */
export function dsoTonight(night, lat, lng) {
  return DSO.map((o) => ({ ...o, vis: visibility(() => ({ ra: o.ra, dec: o.dec }), night, lat, lng, true) }))
    .filter((o) => o.vis && o.vis.maxAlt > 20)
    .sort((a, b) => b.vis.minutesAbove20 - a.vis.minutesAbove20 || b.vis.maxAlt - a.vis.maxAlt);
}

/** Aktuelle Position für die Himmelsansicht. */
export function skyObjectsAt(ms, lat, lng) {
  const out = [];
  for (const p of PLANETS) {
    const eq = planetEquatorial(p.id, ms);
    const h = horizontal(eq.ra, eq.dec, ms, lat, lng);
    out.push({ kind: 'planet', name: p.name, icon: p.icon, alt: h.alt, az: h.az, mag: eq.mag });
  }
  for (const o of DSO) {
    const h = horizontal(o.ra, o.dec, ms, lat, lng);
    out.push({ kind: 'dso', name: o.name, id: o.id, alt: h.alt, az: h.az, mag: o.mag });
  }
  const m = moonPosition(ms, lat, lng);
  out.push({ kind: 'moon', name: 'Mond', alt: m.alt, az: m.az });
  const s = sunPosition(ms, lat, lng);
  out.push({ kind: 'sun', name: 'Sonne', alt: s.alt, az: s.az });
  return out;
}
