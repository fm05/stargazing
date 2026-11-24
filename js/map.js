// Karte: OpenStreetMap + Ebenen (Lichtverschmutzung, Wolken-Satellitenbild, Regenradar)
// + Spot-Suche (beste Spots heute Nacht, beliebte Spots aus OpenStreetMap). Antippen = Ort auswählen.
import { LP_TILE_URL, LP_ATTRIBUTION, LP_ZONES, lightPollutionAt } from './lightpollution.js';
import { reverseGeocode, searchPlaces } from './weather.js';
import { BORTLE, rating } from './score.js';
import { findBestSpots, popularSpots, SPOT_TYPES } from './spots.js';

let map = null, lpLayer = null, locMarker = null, pickMarker = null, opts = null;
let satOverlay = null, satTimer = null, radarLayers = [], radarFrames = [], radarIdx = 0, radarPlay = null;
let spotLayer = null;
let picked = null;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const hhmm = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

export function setupMap(o) {
  opts = o;
  // Panels
  const toggle = (id) => {
    for (const p of ['layersPanel', 'spotsPanel']) $('#' + p).hidden = p === id ? !$('#' + p).hidden : true;
    $('#mapSearchResults').hidden = true;
  };
  $('#mapLayersBtn').onclick = () => toggle('layersPanel');
  $('#mapSpotsBtn').onclick = () => toggle('spotsPanel');
  document.querySelectorAll('.mappanel [data-close]').forEach((b) => (b.onclick = () => (b.closest('.mappanel').hidden = true)));

  // Lichtverschmutzung
  $('#mapLegend').innerHTML = LP_ZONES.map((z) =>
    `<div class="lz"><i style="background:rgb(${z.rgb.join(',')})"></i><b>${z.zone}</b><span>Bortle ${z.bortle}</span></div>`).join('');
  $('#mapLpToggle').checked = store.get('mapLP', true);
  $('#mapLpToggle').onchange = (e) => { store.set('mapLP', e.target.checked); applyLP(); };
  $('#mapOpacity').value = String(store.get('mapOpacity', 0.55));
  $('#mapOpacity').oninput = (e) => { store.set('mapOpacity', parseFloat(e.target.value)); lpLayer?.setOpacity(parseFloat(e.target.value)); };

  // Wolken (Satellit)
  $('#mapSatToggle').onchange = () => applySat();
  $('#satTime').oninput = () => { updateSatLabel(); scheduleSat(300); };
  // Regenradar
  $('#mapRadarToggle').onchange = () => applyRadar();
  $('#radarTime').oninput = (e) => showRadarFrame(parseInt(e.target.value, 10));
  $('#radarPlay').onclick = toggleRadarPlay;

  // Spots
  let spotsMode = 'best';
  document.querySelectorAll('#spotsMode [data-sm]').forEach((b) => (b.onclick = () => {
    spotsMode = b.dataset.sm;
    document.querySelectorAll('#spotsMode [data-sm]').forEach((x) => x.classList.toggle('on', x === b));
    $('#spotsHelp').textContent = spotsMode === 'best'
      ? 'Sucht im Umkreis die dunkelsten Orte und bewertet sie mit der Wettervorhersage für die gewählte Nacht.'
      : 'Sternenparks, Sternwarten, Aussichtspunkte, Aussichtstürme und Gipfel aus OpenStreetMap – sortiert nach Dunkelheit und Entfernung.';
  }));
  $('#spotsRadius').value = String(store.get('spotsRadius', 50));
  $('#spotsRadius').onchange = (e) => store.set('spotsRadius', parseInt(e.target.value, 10));
  $('#spotsGo').onclick = () => runSpots(spotsMode);

  $('#mapLocate').onclick = () => {
    const l = opts.getLoc();
    if (l && map) map.setView([l.lat, l.lng], Math.max(map.getZoom(), 10));
  };
  $('#mapSearch').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#mapSearchInput').value.trim();
    if (q.length < 2) return;
    const ul = $('#mapSearchResults');
    ul.innerHTML = '<li class="muted">Suche …</li>';
    ul.hidden = false;
    $('#layersPanel').hidden = true; $('#spotsPanel').hidden = true;
    try {
      const res = await searchPlaces(q);
      ul.innerHTML = res.length ? '' : '<li class="muted">Nichts gefunden.</li>';
      for (const r of res) {
        const li = document.createElement('li');
        li.innerHTML = `<button class="result"><b>${esc(r.name)}</b><span class="muted small">${esc(r.detail)}</span></button>`;
        li.querySelector('button').onclick = () => {
          ul.hidden = true; $('#mapSearchInput').blur();
          map.setView([r.lat, r.lng], 11);
          pick(r.lat, r.lng, r.name);
        };
        ul.append(li);
      }
    } catch {
      ul.innerHTML = '<li class="muted">Suche fehlgeschlagen – Verbindung prüfen und erneut versuchen.</li>';
      setTimeout(() => { if (ul.textContent.includes('fehlgeschlagen')) ul.hidden = true; }, 4000);
    }
  });
  $('#mapSearchInput').addEventListener('input', (e) => { if (!e.target.value) $('#mapSearchResults').hidden = true; });
  $('#sheetClose').onclick = closeSheet;
  $('#sheetUse').onclick = () => {
    if (!picked) return;
    opts.onSelect({ lat: picked.lat, lng: picked.lng, name: picked.name || `${picked.lat.toFixed(3)}°, ${picked.lng.toFixed(3)}°` });
    closeSheet();
  };
  $('#sheetFav').onclick = () => {
    if (!picked) return;
    if (opts.onSaveFav({ lat: picked.lat, lng: picked.lng, name: picked.name || 'Fotospot' })) $('#sheetFav').textContent = '★';
  };
  $('#sheetShare').onclick = () => { if (picked) opts.onShare({ lat: picked.lat, lng: picked.lng, name: picked.name || 'Fotospot' }); };
  window.addEventListener('resize', () => { if (map) layout(); });
}

function layout() {
  // Karte exakt zwischen Kopfzeile und Tableiste einpassen
  const view = $('#view-map');
  const top = $('.topbar').getBoundingClientRect().bottom;
  const bottom = $('.tabbar').offsetHeight;
  view.style.top = `${top}px`;
  view.style.bottom = `${bottom}px`;
  map.invalidateSize();
}

function ensureMap() {
  if (map) return true;
  if (!window.L) {
    $('#map').innerHTML = '<p class="status err" style="margin:16px">Die Kartenbibliothek konnte nicht geladen werden.</p>';
    return false;
  }
  const L = window.L;
  const l = opts.getLoc();
  map = L.map('map', { zoomControl: false, minZoom: 2, maxZoom: 18, worldCopyJump: true })
    .setView(l ? [l.lat, l.lng] : [51.2, 10.4], l ? 9 : 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  map.createPane('satPane').style.zIndex = 250;
  map.createPane('radarPane').style.zIndex = 260;
  lpLayer = L.tileLayer(LP_TILE_URL, {
    minZoom: 2, maxNativeZoom: 8, maxZoom: 19, tileSize: 1024, zoomOffset: -2,
    opacity: store.get('mapOpacity', 0.55), attribution: LP_ATTRIBUTION, className: 'lp-tiles',
  });
  spotLayer = L.layerGroup().addTo(map);
  // Zoom-Knöpfe nur auf Geräten ohne Touch (am iPhone zoomt man mit zwei Fingern)
  if (!('ontouchstart' in window)) L.control.zoom({ position: 'topright' }).addTo(map);
  applyLP();
  map.on('click', (e) => {
    // Offene Listen/Panels zuerst schließen statt gleich einen Ort zu wählen
    if (!$('#mapSearchResults').hidden) { $('#mapSearchResults').hidden = true; return; }
    if (!$('#layersPanel').hidden || !$('#spotsPanel').hidden) { $('#layersPanel').hidden = true; $('#spotsPanel').hidden = true; return; }
    pick(e.latlng.lat, e.latlng.lng);
  });
  map.on('moveend', () => { if ($('#mapSatToggle').checked) scheduleSat(700); });
  refreshMapLocation();
  return true;
}

function applyLP() {
  if (!map) return;
  const on = $('#mapLpToggle').checked;
  if (on && !map.hasLayer(lpLayer)) lpLayer.addTo(map);
  if (!on && map.hasLayer(lpLayer)) map.removeLayer(lpLayer);
  $('#lpCtl').hidden = !on;
}

// ---------- Wolken: Infrarot-Satellitenbild (EUMETSAT, Meteosat MTG / MSG) ----------
// Der Server rendert jedes Bild einzeln (~10–20 s), daher ein Bild pro Kartenausschnitt statt vieler Kacheln.
const SAT_WMS = 'https://view.eumetsat.int/geoserver/wms';
function satTime() {
  const steps = parseInt($('#satTime').value, 10); // 0 = neuestes, -1 = 30 min früher …
  if (steps === 0) return null;
  const base = Math.floor((Date.now() - 30 * 60000) / 600000) * 600000;
  return new Date(base + steps * 30 * 60000);
}
function updateSatLabel(extra = '') {
  const t = satTime();
  $('#satLabel').textContent = (t ? `${hhmm(t)} Uhr` : 'neuestes Bild') + extra;
}
function scheduleSat(ms) { clearTimeout(satTimer); satTimer = setTimeout(loadSat, ms); }
function applySat() {
  const on = $('#mapSatToggle').checked;
  $('#satCtl').hidden = !on;
  if (!on) { satOverlay?.remove(); satOverlay = null; return; }
  updateSatLabel();
  loadSat();
}
function loadSat() {
  if (!map || !$('#mapSatToggle').checked) return;
  const L = window.L;
  const b = map.getBounds();
  const sw = L.CRS.EPSG3857.project(b.getSouthWest()), ne = L.CRS.EPSG3857.project(b.getNorthEast());
  const size = map.getSize();
  const k = Math.min(1, 1024 / Math.max(size.x, size.y));
  const w = Math.round(size.x * k), h = Math.round(size.y * k);
  const t = satTime();
  // Neuer Meteosat (MTG) deckt Europa/Afrika ab; außerhalb weltweites Wolkenkomposit
  const center = b.getCenter();
  const inMtg = Math.abs(center.lng) < 75 && Math.abs(center.lat) < 75;
  const layer = inMtg ? 'mtg_fd:ir105_hrfi' : 'mumi:worldcloudmap_ir108';
  const params = new URLSearchParams({
    service: 'WMS', request: 'GetMap', version: '1.1.1', layers: layer, styles: '', format: 'image/png',
    transparent: 'true', srs: 'EPSG:3857', bbox: [sw.x, sw.y, ne.x, ne.y].map((v) => v.toFixed(0)).join(','), width: w, height: h,
  });
  if (t) params.set('time', t.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const url = `${SAT_WMS}?${params}`;
  updateSatLabel(' · lädt …');
  const slow = setTimeout(() => { if ($('#satLabel').textContent.includes('lädt')) updateSatLabel(' · lädt (der Server rechnet, bis ~30 s) …'); }, 8000);
  const img = new Image();
  img.onload = () => {
    clearTimeout(slow);
    if (!$('#mapSatToggle').checked) return;
    const ov = L.imageOverlay(url, b, { pane: 'satPane', opacity: 0.75, className: 'sat-img', attribution: 'Satellit © EUMETSAT' }).addTo(map);
    satOverlay?.remove();
    satOverlay = ov;
    updateSatLabel(inMtg ? ' · Meteosat' : ' · Weltkomposit (3-stündlich)');
  };
  img.onerror = () => { clearTimeout(slow); updateSatLabel(' · nicht verfügbar – später erneut versuchen'); };
  img.src = url;
}

// ---------- Regenradar (RainViewer) ----------
async function applyRadar() {
  const on = $('#mapRadarToggle').checked;
  $('#radarCtl').hidden = !on;
  if (!on) { stopRadar(); radarLayers.forEach((l) => l.remove()); radarLayers = []; return; }
  $('#radarLabel').textContent = 'lädt …';
  try {
    const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const j = await r.json();
    radarFrames = [...(j.radar?.past || []), ...(j.radar?.nowcast || [])].map((f) => ({ ...f, host: j.host }));
    if (!radarFrames.length) throw new Error('keine Daten');
    const L = window.L;
    radarLayers.forEach((l) => l.remove());
    radarLayers = radarFrames.map((f) => L.tileLayer(`${f.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      pane: 'radarPane', opacity: 0, maxNativeZoom: 7, maxZoom: 19, attribution: 'Radar © RainViewer',
    }).addTo(map));
    $('#radarTime').max = String(radarFrames.length - 1);
    $('#radarTime').value = String(radarFrames.length - 1);
    showRadarFrame(radarFrames.length - 1);
  } catch {
    $('#radarLabel').textContent = 'nicht verfügbar';
  }
}
function showRadarFrame(i) {
  radarIdx = i;
  radarLayers.forEach((l, k) => l.setOpacity(k === i ? 0.75 : 0));
  const f = radarFrames[i];
  if (f) $('#radarLabel').textContent = `${hhmm(new Date(f.time * 1000))} Uhr`;
  $('#radarTime').value = String(i);
}
function toggleRadarPlay() {
  if (radarPlay) { stopRadar(); return; }
  $('#radarPlay').textContent = '⏸';
  radarPlay = setInterval(() => showRadarFrame((radarIdx + 1) % radarLayers.length), 700);
}
function stopRadar() { clearInterval(radarPlay); radarPlay = null; $('#radarPlay').textContent = '▶'; }

// ---------- Spots ----------
async function runSpots(mode) {
  if (!ensureMap()) return;
  const loc = opts.getLoc();
  if (!loc) { $('#spotsStatus').textContent = 'Bitte zuerst einen Standort wählen.'; return; }
  const radiusKm = parseInt($('#spotsRadius').value, 10);
  const ul = $('#spotsList');
  ul.innerHTML = '';
  spotLayer.clearLayers();
  $('#spotsGo').disabled = true;
  const status = (t) => { $('#spotsStatus').textContent = t; };
  try {
    if (mode === 'best') {
      const ctx = opts.getNightCtx();
      if (!ctx) throw new Error('Wetterdaten noch nicht geladen');
      const res = await findBestSpots({ center: loc, radiusKm, night: ctx.night, nightIdx: ctx.nightIdx, mode: ctx.mode, notBefore: ctx.notBefore, onProgress: status });
      status(`${ctx.label} · ${ctx.mode === 'mw' ? 'Milchstraße' : 'Sterne'} · beste ${Math.min(8, res.length)} von ${res.length} geprüften Punkten`);
      const top = res.slice(0, 8);
      top.forEach((s, i) => addSpot(s, i, {
        badge: s.score, cls: rating(s.score).cls,
        line: `Bortle ${s.zone.bortle} · ☁︎ ${s.cloud != null ? Math.round(s.cloud) : '–'} %${s.start ? ` · ab ${hhmm(new Date(s.start))}` : ''}`,
        extra: `<b>Score ${s.score}</b> (${rating(s.score).text}) · Wolken ${s.cloud != null ? Math.round(s.cloud) : '–'} %${s.start ? ` · beste Zeit ${hhmm(new Date(s.start))}–${hhmm(new Date(s.end))}` : ''}`,
      }));
      nameSpots(top);
      // übrige Punkte als kleine Punkte zur Orientierung
      res.slice(8).forEach((s) => window.L.circleMarker([s.lat, s.lng], { radius: 5, weight: 1, color: '#fff', fillColor: scoreColor(s.score), fillOpacity: 0.8 })
        .on('click', () => pick(s.lat, s.lng, null, `<b>Score ${s.score}</b> · Bortle ${s.zone.bortle} · Wolken ${s.cloud != null ? Math.round(s.cloud) : '–'} %`)).addTo(spotLayer));
    } else {
      const res = await popularSpots({ center: loc, radiusKm, onProgress: status });
      if (!res.length) { status('Keine passenden Orte in OpenStreetMap gefunden – größeren Umkreis wählen.'); return; }
      status(`${res.length} Orte gefunden · die ${Math.min(15, res.length)} besten für Fotos`);
      res.slice(0, 15).forEach((s, i) => addSpot(s, i, {
        icon: SPOT_TYPES[s.type].icon,
        line: `${SPOT_TYPES[s.type].label}${s.zone ? ` · Bortle ${s.zone.bortle}` : ''}${s.ele ? ` · ${Math.round(s.ele)} m` : ''}`,
        extra: `${SPOT_TYPES[s.type].label}${s.ele ? ` · ${Math.round(s.ele)} m Höhe` : ''}<br><a href="https://www.openstreetmap.org/${s.osm}" target="_blank" rel="noopener">In OpenStreetMap ansehen ↗</a>`,
      }));
    }
    const pts = spotLayer.getLayers().map((l) => l.getLatLng());
    pts.push(window.L.latLng(loc.lat, loc.lng));
    if (pts.length > 1) map.fitBounds(window.L.latLngBounds(pts).pad(0.15));
  } catch (e) {
    status(`Fehler: ${e.message}`);
  } finally {
    $('#spotsGo').disabled = false;
  }
}

/** Ortsnamen für die gefundenen Spots nachladen (nacheinander, um die Dienste zu schonen). */
async function nameSpots(list) {
  for (const s of list) {
    if (s.name) continue;
    const n = await reverseGeocode(s.lat, s.lng);
    if (!n) continue;
    s.name = `bei ${n}`;
    if (s.li) s.li.querySelector('b').textContent = s.name;
  }
}

function scoreColor(s) { return s >= 55 ? '#0ca30c' : s >= 35 ? '#fab219' : s >= 15 ? '#ec835a' : '#d03b3b'; }

function addSpot(s, i, { badge, cls, icon, line, extra }) {
  const L = window.L;
  const html = icon ? `<span class="spot-pin icon">${icon}</span>` : `<span class="spot-pin ${cls}">${badge}</span>`;
  const m = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html, iconSize: [30, 30], iconAnchor: [15, 15] }) })
    .on('click', () => pick(s.lat, s.lng, s.name || null, extra)).addTo(spotLayer);
  const li = document.createElement('li');
  li.innerHTML = `<button class="result spot-row">
      <span class="spot-badge ${icon ? 'icon' : cls}">${icon || badge}</span>
      <span><b>${esc(s.name || `Spot ${i + 1}`)}</b><span class="muted small">${Math.round(s.dist)} km ${s.dir} · ${line}</span></span>
    </button>`;
  li.querySelector('button').onclick = () => {
    $('#spotsPanel').hidden = true;
    map.setView([s.lat, s.lng], Math.max(map.getZoom(), 11));
    pick(s.lat, s.lng, s.name || null, extra);
  };
  $('#spotsList').append(li);
  s.li = li;
  return m;
}

export function refreshMapLocation() {
  if (!map) return;
  const l = opts.getLoc();
  if (!l) return;
  const L = window.L;
  if (!locMarker) {
    locMarker = L.marker([l.lat, l.lng], {
      icon: L.divIcon({ className: 'loc-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      keyboard: false, title: 'Aktueller Standort', zIndexOffset: 1000,
    }).addTo(map);
  } else {
    locMarker.setLatLng([l.lat, l.lng]);
  }
}

export function invalidateMap() {
  // Erst nach dem Sichtbarwerden initialisieren, sonst kennt Leaflet die Größe nicht
  requestAnimationFrame(() => {
    if (!ensureMap()) return;
    layout();
  });
}

/** Öffnet die Karte mit einem bestimmten Ort (z. B. aus dem Spot-Vergleich). */
export function showOnMap(lat, lng, name) {
  requestAnimationFrame(() => {
    if (!ensureMap()) return;
    layout();
    map.setView([lat, lng], 11);
    pick(lat, lng, name);
  });
}

async function pick(lat, lng, name = null, extra = '') {
  const L = window.L;
  lng = ((((lng + 180) % 360) + 360) % 360) - 180; // nach Weltumrundung normalisieren
  picked = { lat, lng, name };
  if (!pickMarker) pickMarker = L.circleMarker([lat, lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#8fa8ff', fillOpacity: 1 }).addTo(map);
  else pickMarker.setLatLng([lat, lng]);

  $('#mapSheet').hidden = false;
  $('#mapHint').hidden = true;
  $('#mapSearchResults').hidden = true;
  $('#sheetFav').textContent = '☆';
  $('#sheetTitle').textContent = name || 'Ort wird ermittelt …';
  $('#sheetCoords').textContent = `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
  $('#sheetExtra').innerHTML = extra || '';
  $('#sheetLP').innerHTML = '<span class="muted">Lichtverschmutzung wird gelesen …</span>';

  const [place, zone] = await Promise.all([
    name ? Promise.resolve(name) : reverseGeocode(lat, lng),
    lightPollutionAt(lat, lng).catch(() => null),
  ]);
  if (!picked || picked.lat !== lat || picked.lng !== lng) return; // inzwischen anderer Punkt gewählt
  picked.name = place || `${lat.toFixed(3)}°, ${lng.toFixed(3)}°`;
  $('#sheetTitle').textContent = picked.name;
  if (zone) {
    $('#sheetLP').innerHTML = `<div class="lpinfo"><i style="background:rgb(${zone.rgb.join(',')})"></i>
      <div><b>Bortle ${zone.bortle}</b> · Zone ${zone.zone}<br><span class="muted small">${BORTLE[zone.bortle].label} · ${zone.sqm} mag/″² · künstl./natürl. Licht ${zone.lpi}</span></div></div>`;
  } else {
    $('#sheetLP').innerHTML = '<span class="muted">Lichtverschmutzung konnte nicht gelesen werden.</span>';
  }
}

function closeSheet() {
  $('#mapSheet').hidden = true;
  if (pickMarker) { pickMarker.remove(); pickMarker = null; }
  picked = null;
}
