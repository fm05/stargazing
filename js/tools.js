// Werkzeuge: Rechner, Packliste, Fototagebuch (mit Fotos in IndexedDB), Kalender-Export,
// Datensicherung (Export/Import), Teilen-Links und dauerhafter Speicher.

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

// ---------- Rechner ----------
export function timelapse({ interval, minutes, fps, mp }) {
  const shots = Math.floor((minutes * 60) / interval);
  const clip = shots / fps;
  const rawMB = mp * 1.1; // grob: ~1,1 MB je Megapixel bei 14-Bit-RAW
  return { shots, clip, storageGB: (shots * rawMB) / 1024 };
}

export function panorama({ focal, crop, portrait, overlap, hTarget, vTarget }) {
  const sw = 36 / crop, sh = 24 / crop;
  const fovW = (2 * Math.atan((portrait ? sh : sw) / (2 * focal)) * 180) / Math.PI;
  const fovH = (2 * Math.atan((portrait ? sw : sh) / (2 * focal)) * 180) / Math.PI;
  const stepW = fovW * (1 - overlap), stepH = fovH * (1 - overlap);
  const cols = hTarget >= 360 ? Math.ceil(360 / stepW) : Math.max(1, Math.ceil((hTarget - fovW) / stepW) + 1);
  const rows = Math.max(1, Math.ceil((vTarget - fovH) / stepH) + 1);
  return { fovW, fovH, cols, rows, total: cols * rows, stepW };
}

export function startrails({ minutes, exposure, dec = 0 }) {
  const arc = (15 * (minutes / 60)) * Math.cos((dec * Math.PI) / 180);
  const frames = Math.ceil((minutes * 60) / (exposure + 1));
  return { arc, frames };
}

// ---------- Packliste ----------
const BASE_ITEMS = [
  ['tripod', 'Stabiles Stativ'],
  ['camera', 'Kamera + lichtstarkes (Weitwinkel-)Objektiv'],
  ['batteries', 'Geladene Akkus (+ Ersatz)'],
  ['cards', 'Leere Speicherkarten'],
  ['remote', 'Fernauslöser / Intervallometer'],
  ['redlight', 'Stirnlampe mit Rotlicht'],
  ['phone', 'Handy geladen + Powerbank'],
  ['clothes', 'Warme Kleidung, Mütze, Handschuhe'],
  ['drink', 'Warmes Getränk & Snacks'],
  ['chair', 'Isomatte oder Klappstuhl'],
];

/** Erstellt die Liste passend zu den Bedingungen der Nacht. */
export function packingList(ctx) {
  const items = BASE_ITEMS.map(([id, text]) => ({ id, text }));
  const add = (id, text, why) => items.push({ id, text, why });
  const s = ctx.summary || {};
  if (s.spreadMin != null && s.spreadMin < 4) add('dew', 'Objektivheizung (Heizmanschette) + Powerbank', `Taupunkt-Abstand nur ${s.spreadMin.toFixed(1)} °C`);
  if (s.tempMin != null && s.tempMin < 3) add('cold', 'Handwärmer, Thermoskanne, Akkus am Körper tragen', `bis ${Math.round(s.tempMin)} °C`);
  if (s.tempMin != null && s.tempMin < -5) add('arctic', 'Winterstiefel, Schneehose, zweite Handschuhe', 'starker Frost');
  if ((s.gust ?? 0) > 30) add('wind', 'Stativ beschweren (Tasche/Sandsack), Windschutz', `Böen bis ${Math.round(s.gust)} km/h`);
  if ((s.pp ?? 0) > 20) add('rain', 'Regenschutz für Kamera, Mikrofasertuch', `Regenrisiko ${Math.round(s.pp)} %`);
  if (ctx.mode === 'mw') add('wide', 'Weitwinkel ≤ 24 mm, f/2.8 oder lichtstärker', 'Milchstraße');
  if (ctx.moonPct > 50) add('moon', 'Mond als Landschaftslicht einplanen – oder Spot im Mondschatten', `Mond ${ctx.moonPct} %`);
  if (ctx.aurora) add('aurora', 'Freie Sicht nach Norden suchen, kürzere Belichtung (2–8 s)', 'Polarlicht möglich');
  if (ctx.meteor) add('meteor', 'Zweite Kamera / Intervallaufnahme für Sternschnuppen', ctx.meteor);
  add('tracker', 'Optional: Nachführung (Star Tracker)', null);
  add('torch', 'Taschenlampe für Light-Painting (optional)', null);
  return items;
}

// ---------- Kalender (.ics) ----------
const icsDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c);

export function makeICS({ start, end, title, location, lat, lng, description }) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sternenhimmel//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${start}-${Math.round(lat * 1000)}-${Math.round(lng * 1000)}@sternenhimmel`,
    `DTSTAMP:${icsDate(Date.now())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(title)}`, `LOCATION:${icsText(location)}`, `GEO:${lat.toFixed(5)};${lng.toFixed(5)}`,
    `DESCRIPTION:${icsText(description)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Bald geht\'s los – Akkus geladen?', 'TRIGGER:-PT2H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

/** Datei teilen (iOS-Teilen-Menü) oder herunterladen. */
export async function shareOrDownload(content, filename, mime) {
  const file = typeof File !== 'undefined' ? new File([content], filename, { type: mime }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'aborted'; }
  }
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

// ---------- Fotos im IndexedDB ----------
const DB = 'sternenhimmel', OS = 'photos';
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(OS);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function photoPut(id, dataUrl) {
  const d = await db();
  return new Promise((res, rej) => { const tx = d.transaction(OS, 'readwrite'); tx.objectStore(OS).put(dataUrl, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
export async function photoGet(id) {
  const d = await db();
  return new Promise((res, rej) => { const r = d.transaction(OS).objectStore(OS).get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
}
export async function photoDel(id) {
  const d = await db();
  return new Promise((res) => { const tx = d.transaction(OS, 'readwrite'); tx.objectStore(OS).delete(id); tx.oncomplete = res; tx.onerror = res; });
}

/** Foto verkleinern (max. 900 px, JPEG), damit viele Einträge in den Speicher passen. */
export function resizeImage(file, max = 900) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}

// ---------- Datensicherung ----------
const BACKUP_KEYS = ['favs', 'bortleByLoc', 'cam', 'diary', 'packCustom', 'mode', 'red', 'mapLP', 'mapOpacity', 'loc'];

export async function exportData(includePhotos = true) {
  const data = {};
  for (const k of BACKUP_KEYS) { const v = store.get(k, null); if (v != null) data[k] = v; }
  if (includePhotos && Array.isArray(data.diary)) {
    data.photos = {};
    for (const e of data.diary) if (e.photo) { try { const p = await photoGet(e.id); if (p) data.photos[e.id] = p; } catch { /* ignore */ } }
  }
  return JSON.stringify({ app: 'sternenhimmel', version: 1, exported: new Date().toISOString(), data }, null, 1);
}

/** Import mit Zusammenführen: vorhandene Spots/Einträge bleiben erhalten. */
export async function importData(text, locKey) {
  const j = JSON.parse(text);
  if (j.app !== 'sternenhimmel' || !j.data) throw new Error('Keine Sicherungsdatei dieser App');
  const d = j.data;
  const stats = { favs: 0, diary: 0 };
  if (Array.isArray(d.favs)) {
    const favs = store.get('favs', []);
    const keys = new Set(favs.map(locKey));
    for (const f of d.favs) if (f && typeof f.lat === 'number' && !keys.has(locKey(f))) { favs.push(f); keys.add(locKey(f)); stats.favs++; }
    store.set('favs', favs);
  }
  if (d.bortleByLoc) store.set('bortleByLoc', { ...d.bortleByLoc, ...store.get('bortleByLoc', {}) });
  if (Array.isArray(d.diary)) {
    const diary = store.get('diary', []);
    const ids = new Set(diary.map((e) => e.id));
    for (const e of d.diary) if (e && !ids.has(e.id)) { diary.push(e); stats.diary++; if (d.photos?.[e.id]) { try { await photoPut(e.id, d.photos[e.id]); } catch { /* ignore */ } } }
    diary.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    store.set('diary', diary);
  }
  if (d.cam && !store.get('cam', null)) store.set('cam', d.cam);
  if (Array.isArray(d.packCustom)) store.set('packCustom', [...new Set([...store.get('packCustom', []), ...d.packCustom])]);
  return stats;
}

// ---------- Teilen-Links ----------
export function spotLink(spot) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('spot', `${spot.lat.toFixed(5)},${spot.lng.toFixed(5)}`);
  if (spot.name) u.searchParams.set('name', spot.name);
  return u.toString();
}

/** Liest einen geteilten Spot aus einem Link oder aus "lat, lng"-Text. */
export function parseSpot(text) {
  if (!text) return null;
  try {
    const u = new URL(text.trim());
    const s = u.searchParams.get('spot');
    if (s) {
      const [lat, lng] = s.split(',').map(Number);
      if (isFinite(lat) && isFinite(lng)) return { lat, lng, name: u.searchParams.get('name') || 'Geteilter Spot' };
    }
    // Google-/Apple-Maps-Links: ...@lat,lng... oder ?q=lat,lng / ll=lat,lng
    const m = text.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    if (m) return { lat: +m[1], lng: +m[2], name: 'Geteilter Spot' };
  } catch {
    const m = text.match(/(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)/);
    if (m) {
      const lat = parseFloat(m[1].replace(',', '.')), lng = parseFloat(m[2].replace(',', '.'));
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, name: 'Spot' };
    }
  }
  return null;
}

export async function shareLink(url, title) {
  if (navigator.share) {
    try { await navigator.share({ title, text: title, url }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'aborted'; }
  }
  try { await navigator.clipboard.writeText(url); return 'copied'; } catch { return 'failed'; }
}

// ---------- Dauerhafter Speicher ----------
export async function requestPersist() {
  try {
    if (!navigator.storage?.persist) return { supported: false };
    const already = await navigator.storage.persisted();
    const granted = already || (await navigator.storage.persist());
    const est = navigator.storage.estimate ? await navigator.storage.estimate() : null;
    return { supported: true, granted, usage: est?.usage, quota: est?.quota };
  } catch { return { supported: false }; }
}
