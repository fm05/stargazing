// Lichtverschmutzung aus dem "World Atlas of the Artificial Night Sky Brightness"
// (Neuberechnung von David Lorenz mit Satellitendaten 2025, https://djlorenz.github.io/astronomy/lp/).
// Die Kacheln sind farbcodierte Zonen; wir lesen die Farbe am Standort aus und rechnen in Bortle um.

export const LP_TILE_URL = 'https://djlorenz.github.io/astronomy/image_tiles/tiles2025/tile_{z}_{x}_{y}.png';
export const LP_ATTRIBUTION = 'Lichtverschmutzung © <a href="https://djlorenz.github.io/astronomy/lp/" target="_blank" rel="noopener">D. Lorenz</a> (VIIRS 2025)';
const NATIVE_Z = 6; // Kacheln mit 1024 px; z=6 ist die höchste native Auflösung (~0,5 km/Pixel in Mitteleuropa)

// Zone, Farbe, Bortle, Himmelshelligkeit (mag/arcsec², Bereich), Verhältnis künstlich/natürlich
export const LP_ZONES = [
  { zone: '0', rgb: [0, 0, 0], bortle: 1, sqm: '> 21,99', lpi: '< 0,01' },
  { zone: '1a', rgb: [34, 34, 34], bortle: 2, sqm: '21,93–21,99', lpi: '0,01–0,06' },
  { zone: '1b', rgb: [66, 66, 66], bortle: 2, sqm: '21,89–21,93', lpi: '0,06–0,11' },
  { zone: '2a', rgb: [20, 47, 114], bortle: 3, sqm: '21,81–21,89', lpi: '0,11–0,19' },
  { zone: '2b', rgb: [33, 84, 216], bortle: 3, sqm: '21,69–21,81', lpi: '0,19–0,33' },
  { zone: '3a', rgb: [15, 87, 20], bortle: 4, sqm: '21,51–21,69', lpi: '0,33–0,58' },
  { zone: '3b', rgb: [31, 161, 42], bortle: 4, sqm: '21,25–21,51', lpi: '0,58–1,0' },
  { zone: '4a', rgb: [110, 100, 30], bortle: 4, sqm: '20,91–21,25', lpi: '1,0–1,7' },
  { zone: '4b', rgb: [184, 166, 37], bortle: 5, sqm: '20,49–20,91', lpi: '1,7–3,0' },
  { zone: '5a', rgb: [191, 100, 30], bortle: 5, sqm: '20,02–20,49', lpi: '3–5' },
  { zone: '5b', rgb: [253, 150, 80], bortle: 6, sqm: '19,50–20,02', lpi: '5–9' },
  { zone: '6a', rgb: [251, 90, 73], bortle: 6, sqm: '18,95–19,50', lpi: '9–16' },
  { zone: '6b', rgb: [251, 153, 138], bortle: 7, sqm: '18,38–18,95', lpi: '16–27' },
  { zone: '7a', rgb: [160, 160, 160], bortle: 8, sqm: '17,80–18,38', lpi: '27–47' },
  { zone: '7b', rgb: [242, 242, 242], bortle: 9, sqm: '< 17,80', lpi: '> 47' },
];

const tileCache = new Map();

function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        resolve(ctx);
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('Kachel nicht geladen'));
    img.src = LP_TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  });
  tileCache.set(key, p);
  p.catch(() => tileCache.delete(key));
  return p;
}

function nearestZone(r, g, b) {
  let best = LP_ZONES[0], bd = Infinity;
  for (const z of LP_ZONES) {
    const d = (z.rgb[0] - r) ** 2 + (z.rgb[1] - g) ** 2 + (z.rgb[2] - b) ** 2;
    if (d < bd) { bd = d; best = z; }
  }
  return best;
}

/**
 * Liefert die Lichtverschmutzungszone am Ort.
 * Wertet ein 3×3-Pixel-Feld aus (~1,5 km) und nimmt die häufigste Zone (robust gegen Kantenpixel).
 */
export async function lightPollutionAt(lat, lng) {
  const n = 2 ** NATIVE_Z;
  const latR = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  const fx = ((lng + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const ctx = await loadTile(NATIVE_Z, ((tx % n) + n) % n, ty);
  const px = Math.min(1023, Math.max(0, Math.floor((fx - tx) * 1024)));
  const py = Math.min(1023, Math.max(0, Math.floor((fy - ty) * 1024)));
  const x0 = Math.max(0, px - 1), y0 = Math.max(0, py - 1);
  const data = ctx.getImageData(x0, y0, 3, 3).data;
  const counts = new Map();
  let center = null;
  for (let i = 0; i < data.length; i += 4) {
    const z = nearestZone(data[i], data[i + 1], data[i + 2]);
    counts.set(z, (counts.get(z) || 0) + 1);
    if (i === 16) center = z; // mittleres Pixel
  }
  let mode = center, mc = 0;
  for (const [z, c] of counts) if (c > mc || (c === mc && z === center)) { mode = z; mc = c; }
  return mode;
}
