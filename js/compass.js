// Himmelsansicht: Draufsicht auf den Himmel wie ein Kompass (Norden oben, Osten rechts, Zenit in der Mitte).
// Optional dreht sich die Ansicht mit dem Handy-Kompass, sodass oben immer die Blickrichtung ist.
import { horizontal, milkyWayPoints, GALACTIC_CENTER, moonIllumination } from './astro.js';
import { skyObjectsAt } from './planets.js';

const RAD = Math.PI / 180;
const R = 150;

function proj(alt, az, rot) {
  const r = (R * (90 - alt)) / 90;
  const th = (az - rot) * RAD;
  return [r * Math.sin(th), -r * Math.cos(th)];
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Zeichnet die Himmelsansicht als SVG-String. */
export function skySVG({ t, lat, lng, heading = null, pitch = null, showDso = true }) {
  const rot = heading ?? 0;
  const objs = skyObjectsAt(t, lat, lng);
  const sun = objs.find((o) => o.kind === 'sun');
  const sky = sun.alt > -0.8 ? '#2b3a5c' : sun.alt > -6 ? '#1f2b48' : sun.alt > -12 ? '#172038' : sun.alt > -18 ? '#111829' : '#0a0f1c';
  let svg = `<svg viewBox="-170 -170 340 340" class="skysvg" role="img" aria-label="Himmelsansicht">`;
  svg += `<circle r="${R}" fill="${sky}" stroke="#4a5578" stroke-width="1.5"/>`;
  for (const a of [30, 60]) svg += `<circle r="${(R * (90 - a)) / 90}" fill="none" stroke="#2a3350" stroke-dasharray="3 4"/>`;
  // Milchstraße als durchgehendes Band (zusammenhängende Abschnitte über dem Horizont)
  const pts = milkyWayPoints();
  const band = pts.map((p) => ({ ...horizontal(p.ra, p.dec, t, lat, lng), w: p.w }));
  // Startpunkt unter dem Horizont suchen, damit kein Abschnitt am Array-Ende zerschnitten wird
  let s0 = band.findIndex((b) => b.alt < -2);
  if (s0 < 0) s0 = 0;
  const runs = [];
  let run = [];
  for (let k = 0; k <= band.length; k++) {
    const b = band[(s0 + k) % band.length];
    if (b.alt >= -2) run.push(b);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  const pathOf = (r) => r.map((b, i) => { const [x, y] = proj(Math.max(b.alt, -2), b.az, rot); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('');
  for (const r of runs) {
    svg += `<path d="${pathOf(r)}" fill="none" stroke="#c9c3ff" stroke-opacity="0.16" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>`;
    // hellere Abschnitte (Zentrum, Schwan, Kiel) zusätzlich hervorheben
    let bright = [];
    for (const b of r) {
      if (b.w >= 0.7) bright.push(b);
      else { if (bright.length > 1) svg += `<path d="${pathOf(bright)}" fill="none" stroke="#e2ddff" stroke-opacity="0.2" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`; bright = []; }
    }
    if (bright.length > 1) svg += `<path d="${pathOf(bright)}" fill="none" stroke="#e2ddff" stroke-opacity="0.2" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const gc = horizontal(GALACTIC_CENTER.ra, GALACTIC_CENTER.dec, t, lat, lng);
  if (gc.alt > 0) {
    const [x, y] = proj(gc.alt, gc.az, rot);
    svg += `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#e8e3ff" stroke-width="1.5"/><text x="${x + 7}" y="${y + 4}" class="sky-l mw">Zentrum</text>`;
  }
  // Deep-Sky-Objekte
  if (showDso) {
    for (const o of objs.filter((x) => x.kind === 'dso' && x.alt > 5)) {
      const [x, y] = proj(o.alt, o.az, rot);
      svg += `<g><title>${esc(o.name)} – ${Math.round(o.alt)}°</title><rect x="${x - 2.5}" y="${y - 2.5}" width="5" height="5" transform="rotate(45 ${x} ${y})" fill="#7fb7ff"/><text x="${x + 5}" y="${y + 3}" class="sky-l dso">${esc(o.id)}</text></g>`;
    }
  }
  // Planeten
  for (const o of objs.filter((x) => x.kind === 'planet' && x.alt > 0)) {
    const [x, y] = proj(o.alt, o.az, rot);
    const r = Math.max(2.5, Math.min(6, 4.5 - o.mag * 0.6));
    svg += `<g><title>${esc(o.name)} – ${Math.round(o.alt)}°, ${o.mag.toFixed(1)} mag</title><circle cx="${x}" cy="${y}" r="${r}" fill="#ffd27a"/><text x="${x + r + 3}" y="${y + 4}" class="sky-l pl">${esc(o.name)}</text></g>`;
  }
  // Mond & Sonne
  const moon = objs.find((o) => o.kind === 'moon');
  if (moon.alt > 0) {
    const [x, y] = proj(moon.alt, moon.az, rot);
    const f = moonIllumination(t).fraction;
    svg += `<g><title>Mond – ${Math.round(moon.alt)}°, ${Math.round(f * 100)} %</title><circle cx="${x}" cy="${y}" r="9" fill="#3a3f52"/><circle cx="${x}" cy="${y}" r="9" fill="#f4efd8" fill-opacity="${0.25 + 0.75 * f}"/><text x="${x + 12}" y="${y + 4}" class="sky-l moon">Mond</text></g>`;
  }
  if (sun.alt > 0) {
    const [x, y] = proj(sun.alt, sun.az, rot);
    svg += `<circle cx="${x}" cy="${y}" r="10" fill="#ffcc33"/>`;
  }
  // Himmelsrichtungen
  for (const [az, l] of [[0, 'N'], [45, 'NO'], [90, 'O'], [135, 'SO'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']]) {
    const [x, y] = proj(-8, az, rot);
    svg += `<text x="${x}" y="${y + 4}" class="sky-dir ${l.length === 1 ? 'main' : ''}" text-anchor="middle">${l}</text>`;
  }
  svg += `<text x="0" y="4" class="sky-l zen" text-anchor="middle">Zenit</text>`;
  // Blickrichtung (Kompassmodus)
  if (heading != null) {
    svg += `<path d="M0,0 L${-R * Math.sin(20 * RAD)},${-R * Math.cos(20 * RAD)} A${R},${R} 0 0 1 ${R * Math.sin(20 * RAD)},${-R * Math.cos(20 * RAD)} Z" fill="#8fa8ff" fill-opacity="0.12" stroke="#8fa8ff" stroke-opacity="0.5"/>`;
    if (pitch != null && pitch > -5 && pitch < 90) {
      const r = (R * (90 - Math.max(0, pitch))) / 90;
      svg += `<circle cx="0" cy="${-r}" r="7" fill="none" stroke="#fff" stroke-width="2"/>`;
    }
  }
  svg += '</svg>';
  return svg;
}

// ---------- Kompass (Geräteausrichtung) ----------
let handler = null;
export async function startCompass(cb) {
  if (typeof DeviceOrientationEvent === 'undefined') throw new Error('Dieses Gerät hat keinen Kompass');
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    const r = await DeviceOrientationEvent.requestPermission(); // iOS: muss durch Tippen ausgelöst werden
    if (r !== 'granted') throw new Error('Zugriff auf Bewegung & Ausrichtung wurde nicht erlaubt');
  }
  stopCompass();
  let last = 0;
  handler = (e) => {
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading; // iOS
    else if (e.absolute && e.alpha != null) heading = (360 - e.alpha) % 360; // Android
    if (heading == null) return;
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    heading = (heading + angle + 360) % 360;
    const now = performance.now();
    if (now - last < 60) return; // ~15 Bilder/s genügen
    last = now;
    cb({ heading, pitch: e.beta != null ? e.beta - 90 : null });
  };
  window.addEventListener('deviceorientationabsolute', handler);
  window.addEventListener('deviceorientation', handler);
}
export function stopCompass() {
  if (!handler) return;
  window.removeEventListener('deviceorientationabsolute', handler);
  window.removeEventListener('deviceorientation', handler);
  handler = null;
}
