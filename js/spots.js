// Spot-Finder (dunkel + klar im Umkreis), beliebte Spots aus OpenStreetMap und Vergleich gespeicherter Spots.
import { fetchMulti } from './weather.js';
import { lightPollutionAt } from './lightpollution.js';
import { analyzeNight, azimuthName, gcCulmination } from './astro.js';
import { scoreNight } from './score.js';

const KM_LAT = 111.32;
const kmLng = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);

export function distanceKm(a, b) {
  const dLat = (b.lat - a.lat) * KM_LAT;
  const dLng = (b.lng - a.lng) * kmLng((a.lat + b.lat) / 2);
  return Math.hypot(dLat, dLng);
}
export function bearing(a, b) {
  const y = (b.lng - a.lng) * kmLng((a.lat + b.lat) / 2);
  const x = (b.lat - a.lat) * KM_LAT;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Ab wie vielen Tagen Vorlauf liegt die gewählte Nacht in der Vorhersage? */
const daysFor = (nightIdx) => Math.min(8, nightIdx + 3);

/**
 * Spot-Finder: legt ein 5×5-Raster um den Ort, sucht in jeder Zelle den dunkelsten Punkt
 * (3×3 Stichproben im Lichtverschmutzungs-Atlas) und bewertet alle 25 Kandidaten mit der Wettervorhersage.
 */
export async function findBestSpots({ center, radiusKm, night, nightIdx, mode, notBefore, onProgress }) {
  const N = 5;
  const cell = (2 * radiusKm) / N;
  const cand = [];
  onProgress?.('Lichtverschmutzung wird ausgewertet …');
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const cy = -radiusKm + cell * (i + 0.5), cx = -radiusKm + cell * (j + 0.5);
      let best = null;
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const p = { lat: center.lat + (cy + (a * cell) / 3) / KM_LAT, lng: center.lng + (cx + (b * cell) / 3) / kmLng(center.lat) };
          try {
            const z = await lightPollutionAt(p.lat, p.lng);
            if (!best || z.bortle < best.zone.bortle) best = { ...p, zone: z };
          } catch { /* Kachel fehlt (z. B. Meer) */ }
        }
      }
      if (best) cand.push(best);
    }
  }
  if (!cand.length) throw new Error('Lichtverschmutzungsdaten nicht verfügbar');
  onProgress?.(`Wetter für ${cand.length} Punkte wird geladen …`);
  const wx = await fetchMulti(cand, daysFor(nightIdx));
  const gcCulm = gcCulmination(center.lat);
  const results = cand.map((c, k) => {
    const sc = scoreNight(night, { forecast: { hourly: wx[k]?.hourly || new Map() } }, { bortle: c.zone.bortle, notBefore, gcCulm });
    const best = mode === 'mw' ? sc.mw : sc.stars;
    return {
      ...c,
      score: best.score, start: best.start, end: best.end,
      cloud: sc.summary.cloud,
      dist: distanceKm(center, c), dir: azimuthName(bearing(center, c)),
    };
  });
  // gleich gute Spots: der nähere gewinnt
  results.sort((a, b) => b.score - a.score || a.dist - b.dist);
  return results;
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const TYPE = {
  darksky: { label: 'Sternenpark / Dark-Sky-Gebiet', icon: '✦', bonus: 0.35 },
  observatory: { label: 'Sternwarte / Observatorium', icon: '🔭', bonus: 0.15 },
  planetarium: { label: 'Planetarium', icon: '🪐', bonus: 0 },
  tower: { label: 'Aussichtsturm', icon: '🗼', bonus: 0.1 },
  viewpoint: { label: 'Aussichtspunkt', icon: '⛰️', bonus: 0.1 },
  peak: { label: 'Gipfel', icon: '🏔️', bonus: 0.08 },
};
export const SPOT_TYPES = TYPE;

function classify(tags) {
  const name = (tags.name || '').toLowerCase();
  if (tags.dark_sky || /sternenpark|sternpark|dark sky|lichtschutzgebiet|sternenregion|starlight/.test(name)) return 'darksky';
  if (tags.amenity === 'planetarium' || /planetarium/.test(name)) return 'planetarium';
  if (tags.man_made === 'observatory' || /sternwarte|observatori/.test(name)) return 'observatory';
  if (tags.man_made === 'tower') return 'tower';
  if (tags.natural === 'peak') return 'peak';
  return 'viewpoint';
}

/**
 * Beliebte Orte aus OpenStreetMap: Sternenparks, Sternwarten, Aussichtspunkte, Aussichtstürme, Gipfel.
 * Bewertet nach Dunkelheit (Atlas), Typ (freie Sicht) und Entfernung.
 */
export async function popularSpots({ center, radiusKm, onProgress }) {
  const r = Math.round(radiusKm * 1000), r2 = Math.round(radiusKm * 1500);
  const a = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
  const q = `[out:json][timeout:25];(
    nwr["man_made"="observatory"](around:${r2},${a});
    nwr["amenity"="planetarium"](around:${r2},${a});
    nwr["name"~"Sternwarte|Sternenpark|Sternpark|Dark Sky|Lichtschutzgebiet|Observatorium|Sternenregion",i](around:${r2},${a});
    nwr["dark_sky"](around:${r2},${a});
    nwr["tourism"="viewpoint"]["name"](around:${r},${a});
    nwr["man_made"="tower"]["tower:type"="observation"](around:${r},${a});
    node["natural"="peak"]["name"]["ele"](around:${r},${a});
  );out center tags 600;`;
  onProgress?.('Spots werden in OpenStreetMap gesucht …');
  let data = null, lastErr = null;
  for (const ep of OVERPASS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      break;
    } catch (e) { lastErr = e; }
  }
  if (!data) throw new Error(`OpenStreetMap-Suche fehlgeschlagen (${lastErr?.message || 'offline?'})`);

  const seen = new Set();
  const items = [];
  for (const el of data.elements || []) {
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const tags = el.tags || {};
    const type = classify(tags);
    const name = tags.name || TYPE[type].label;
    const key = `${name}|${lat.toFixed(2)}|${lng.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ lat, lng, name, type, ele: tags.ele ? parseFloat(tags.ele) : null, tags, osm: `${el.type}/${el.id}` });
  }
  onProgress?.(`${items.length} Orte gefunden – Dunkelheit wird geprüft …`);
  for (const it of items) {
    try { it.zone = await lightPollutionAt(it.lat, it.lng); } catch { it.zone = null; }
    it.dist = distanceKm(center, it);
    it.dir = azimuthName(bearing(center, it));
    const dark = it.zone ? (9 - it.zone.bortle) / 8 : 0.3;
    const ele = it.ele && it.ele > 600 ? 0.05 : 0;
    it.rank = dark + TYPE[it.type].bonus + ele - 0.25 * Math.min(1.5, it.dist / radiusKm);
  }
  items.sort((x, y) => y.rank - x.rank);
  return items;
}

/** Vergleicht gespeicherte Spots für die nächsten Nächte (eigene Nacht-Berechnung je Spot). */
export async function compareFavs({ favs, bortleOf, nightStarts, mode, notBefore }) {
  const list = favs.slice(0, 12);
  const wx = await fetchMulti(list, Math.min(8, nightStarts.length + 1));
  return list.map((f, k) => {
    const bortle = bortleOf(f);
    const nights = nightStarts.map((start, i) => {
      const night = analyzeNight(start, f.lat, f.lng, 10);
      const sc = scoreNight(night, { forecast: { hourly: wx[k]?.hourly || new Map() } }, { bortle, notBefore: i === 0 ? notBefore : null, gcCulm: gcCulmination(f.lat) });
      const b = mode === 'mw' ? sc.mw : sc.stars;
      return { score: sc.hours.length ? b.score : null, start: b.start, cloud: sc.summary.cloud };
    });
    return { fav: f, bortle, nights };
  });
}
