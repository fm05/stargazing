// Karte mit OpenStreetMap + Lichtverschmutzungs-Overlay. Antippen = Ort auswählen.
import { LP_TILE_URL, LP_ATTRIBUTION, LP_ZONES, lightPollutionAt } from './lightpollution.js';
import { reverseGeocode, searchPlaces } from './weather.js';
import { BORTLE } from './score.js';

let map = null, lpLayer = null, locMarker = null, pickMarker = null, opts = null;
let picked = null;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export function setupMap(o) {
  opts = o;
  // Legende
  $('#mapLegend').innerHTML = LP_ZONES.map((z) =>
    `<div class="lz"><i style="background:rgb(${z.rgb.join(',')})"></i><b>${z.zone}</b><span>Bortle ${z.bortle}</span></div>`).join('');
  $('#mapLegendBtn').onclick = () => { $('#mapLegendBox').hidden = !$('#mapLegendBox').hidden; };
  const lpOn = store.get('mapLP', true);
  $('#mapLpToggle').checked = lpOn;
  $('#mapLpToggle').onchange = (e) => { store.set('mapLP', e.target.checked); applyLP(); };
  $('#mapOpacity').value = String(store.get('mapOpacity', 0.55));
  $('#mapOpacity').oninput = (e) => { store.set('mapOpacity', parseFloat(e.target.value)); lpLayer?.setOpacity(parseFloat(e.target.value)); };
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
      ul.innerHTML = '<li class="muted">Suche fehlgeschlagen (offline?).</li>';
    }
  });
  $('#sheetClose').onclick = closeSheet;
  $('#sheetUse').onclick = () => {
    if (!picked) return;
    opts.onSelect({ lat: picked.lat, lng: picked.lng, name: picked.name || `${picked.lat.toFixed(3)}°, ${picked.lng.toFixed(3)}°` });
    closeSheet();
  };
  $('#sheetFav').onclick = () => {
    if (!picked) return;
    if (opts.onSaveFav({ lat: picked.lat, lng: picked.lng, name: picked.name || 'Fotospot' })) $('#sheetFav').textContent = '★ Gemerkt';
  };
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
  lpLayer = L.tileLayer(LP_TILE_URL, {
    minZoom: 2, maxNativeZoom: 8, maxZoom: 19, tileSize: 1024, zoomOffset: -2,
    opacity: store.get('mapOpacity', 0.55), attribution: LP_ATTRIBUTION, className: 'lp-tiles',
  });
  // Zoom-Knöpfe nur auf Geräten ohne Touch (am iPhone zoomt man mit zwei Fingern)
  if (!('ontouchstart' in window)) L.control.zoom({ position: 'topright' }).addTo(map);
  applyLP();
  map.on('click', (e) => pick(e.latlng.lat, e.latlng.lng));
  refreshMapLocation();
  return true;
}

function applyLP() {
  if (!map) return;
  const on = $('#mapLpToggle').checked;
  if (on && !map.hasLayer(lpLayer)) lpLayer.addTo(map);
  if (!on && map.hasLayer(lpLayer)) map.removeLayer(lpLayer);
  $('#mapLpControls').classList.toggle('off', !on);
}

export function refreshMapLocation() {
  if (!map) return;
  const l = opts.getLoc();
  if (!l) return;
  const L = window.L;
  if (!locMarker) {
    locMarker = L.marker([l.lat, l.lng], {
      icon: L.divIcon({ className: 'loc-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      keyboard: false, title: 'Aktueller Standort',
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

async function pick(lat, lng, name = null) {
  const L = window.L;
  lng = ((((lng + 180) % 360) + 360) % 360) - 180; // nach Weltumrundung normalisieren
  picked = { lat, lng, name };
  if (!pickMarker) pickMarker = L.circleMarker([lat, lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#8fa8ff', fillOpacity: 1 }).addTo(map);
  else pickMarker.setLatLng([lat, lng]);

  const sheet = $('#mapSheet');
  sheet.hidden = false;
  $('#mapHint').hidden = true;
  $('#mapSearchResults').hidden = true;
  $('#sheetFav').textContent = '☆ Merken';
  $('#sheetTitle').textContent = name || 'Ort wird ermittelt …';
  $('#sheetCoords').textContent = `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
  $('#sheetLP').innerHTML = '<span class="muted">Lichtverschmutzung wird gelesen …</span>';

  const [place, zone] = await Promise.all([
    name ? Promise.resolve(name) : reverseGeocode(lat, lng),
    lightPollutionAt(lat, lng).catch(() => null),
  ]);
  if (picked.lat !== lat || picked.lng !== lng) return; // inzwischen anderer Punkt gewählt
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
