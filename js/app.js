import {
  analyzeNight, moonPhaseInfo, azimuthName, geomagneticLatitude, nextMilkyWaySeason,
  nextNewMoon, activeMeteorShowers, moonIllumination, gcCulmination,
} from './astro.js';
import {
  fetchForecast, fetchUpperWinds, fetchAirQuality, fetchKp, fetchModels, searchPlaces, reverseGeocode,
} from './weather.js';
import { scoreNight, rating, BORTLE, SEEING_TEXT } from './score.js';
import { lightPollutionAt } from './lightpollution.js';
import { setupMap, refreshMapLocation, invalidateMap } from './map.js';
import { initViews, onViewShown, modelsCard, modelAgreement, heroActions, renderSky, shareSpot } from './views.js';

// ---------- Zustand & Speicher ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const state = {
  loc: store.get('loc', null),
  favs: store.get('favs', []),
  bortleByLoc: store.get('bortleByLoc', {}),
  cam: store.get('cam', { crop: 1, mp: 24, focal: 14, aperture: 2.8 }),
  red: store.get('red', false),
  mode: store.get('mode', 'stars'), // 'stars' | 'mw'
  nightIdx: 0,
  data: null,
  nights: [],
  loading: false,
};

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round = (x, d = 0) => (x == null || isNaN(x) ? '–' : (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('de-DE'));
const locKey = (l) => `${l.lat.toFixed(2)},${l.lng.toFixed(2)}`;
// Bortle pro Ort: Zahl (manuell, alte Version) oder { v, auto, zone }
const bortleEntry = (l = state.loc) => {
  const e = l && state.bortleByLoc[locKey(l)];
  if (e == null) return null;
  return typeof e === 'number' ? { v: e, auto: false } : e;
};
const bortle = (l) => bortleEntry(l)?.v || 4;

// Zeitformat in der Zeitzone des Standorts
const off = () => (state.data?.forecast?.utcOffset ?? -new Date().getTimezoneOffset() * 60) * 1000;
const fmtT = (ms) => {
  if (ms == null) return '–';
  const d = new Date(ms + off());
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const fmtD = (ms, opts = { weekday: 'short', day: 'numeric', month: 'numeric' }) =>
  new Date(ms + off()).toLocaleDateString('de-DE', { ...opts, timeZone: 'UTC' });
const fmtDur = (min) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`;


function blockZoom() {
  // iOS Safari ignoriert user-scalable=no teilweise – Pinch- und Doppeltipp-Zoom daher zusätzlich per Script verhindern
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
}

function showFatal(msg) {
  const s = document.getElementById('status');
  if (s) { s.textContent = `Fehler: ${msg} – bitte Screenshot an den Entwickler.`; s.className = 'status err'; s.hidden = false; }
}
window.addEventListener('error', (e) => showFatal(e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason?.message || String(e.reason)));

function init() {
  blockZoom();
  setupTabs();
  setupMap({
    getLoc: () => state.loc,
    onSelect: (loc) => setLocation(loc),
    onSaveFav: (loc) => saveFav(loc),
    onShare: (spot) => shareSpot(spot),
    getNightCtx: () => {
      const n = state.nights[state.nightIdx];
      if (!n) return null;
      return { night: n.night, nightIdx: state.nightIdx, mode: state.mode, notBefore: state.nightIdx === 0 ? Date.now() : null, label: `${fmtD(n.start)} → ${fmtD(n.start + 86400000)}` };
    },
  });
  setupSettings();
  setupCamera();
  initViews({
    state, fmtT, fmtD, locKey, bortle, bortleEntry, toast,
    night: () => state.nights[state.nightIdx] || null,
    setLocation, saveFav, showView,
    currentView: () => currentView,
    setAutoBortle: (loc, z) => { state.bortleByLoc[locKey(loc)] = { v: z.bortle, auto: true, zone: z.zone, sqm: z.sqm }; store.set('bortleByLoc', state.bortleByLoc); },
    reloadFromStorage: () => { state.favs = store.get('favs', []); state.bortleByLoc = store.get('bortleByLoc', {}); updateLocUI(); },
  });
  applyRed();
  $('#refreshBtn').addEventListener('click', () => load(true));
  $('#locBtn').addEventListener('click', () => showView('settings'));
  $('#redBtn').addEventListener('click', () => { state.red = !state.red; store.set('red', state.red); applyRed(); });

  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (ios && !standalone && !store.get('installHidden', false)) $('#installHint').hidden = false;
  $('#installClose').addEventListener('click', () => { $('#installHint').hidden = true; store.set('installHidden', true); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  const cached = store.get('cache2', null);
  if (state.loc) {
    if (cached && cached.key === locKey(state.loc)) {
      state.data = reviveData(cached.data);
      computeNights();
      render();
    }
    load(false);
    autoBortle(state.loc);
    if (state.loc.gps) refreshGPSQuietly();
  } else {
    renderWelcome();
    // Nur automatisch orten, wenn die Erlaubnis schon erteilt ist – sonst per Button (iOS fragt zuverlässiger nach einem Tippen)
    geoPermission().then((st) => { if (st === 'granted') useGPS(); });
  }

  // Bei Rückkehr in die App aktualisieren, wenn Daten älter als 30 min
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (state.loc?.gps) refreshGPSQuietly();
    if (state.data && Date.now() - state.data.fetched > 30 * 60000) load(false);
  });
}

function setStatus(msg, isErr = false) {
  const s = $('#status');
  s.textContent = msg || '';
  s.className = 'status' + (isErr ? ' err' : '');
  s.hidden = !msg;
}

// ---------- Standort ----------
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => !!(window.navigator.standalone || matchMedia('(display-mode: standalone)').matches);
/** iOS-Version aus dem User-Agent (Safari meldet seit iOS 26 eine eingefrorene OS-Version, daher auch "Version/xx" prüfen). */
function iosVersion() {
  const ua = navigator.userAgent;
  const os = ua.match(/OS (\d+)_/);
  const ver = ua.match(/Version\/(\d+)/);
  const v = Math.max(os ? +os[1] : 0, ver ? +ver[1] : 0);
  return v || null;
}
const geoLog = store.get('geoLog', { lastError: null, lastOk: null });
function logGeo(kind, data) {
  geoLog[kind] = { ...data, t: Date.now() };
  store.set('geoLog', geoLog);
  renderGeoDiag();
}

async function geoPermission() {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    return (await navigator.permissions.query({ name: 'geolocation' })).state; // granted | prompt | denied
  } catch { return 'unknown'; }
}

function getPosition(opts) {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, opts));
}

/** Mehrstufige Ortung: schnell/ungenau → genau → watchPosition als letzter Versuch. */
async function locate() {
  if (!navigator.geolocation) throw Object.assign(new Error('unsupported'), { code: 0 });
  try {
    return await getPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 30 * 60000 });
  } catch (e) {
    if (e.code === 1) throw e; // verweigert – nicht erneut versuchen
  }
  try {
    return await getPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  } catch (e) {
    if (e.code === 1) throw e;
  }
  return new Promise((resolve, reject) => {
    let id = null;
    const timer = setTimeout(() => { navigator.geolocation.clearWatch(id); reject(Object.assign(new Error('timeout'), { code: 3 })); }, 20000);
    id = navigator.geolocation.watchPosition(
      (p) => { clearTimeout(timer); navigator.geolocation.clearWatch(id); resolve(p); },
      (e) => { if (e.code === 1) { clearTimeout(timer); navigator.geolocation.clearWatch(id); reject(e); } },
      { enableHighAccuracy: true, maximumAge: 0 }
    );
  });
}

let locating = false;
async function useGPS() {
  if (locating) return;
  locating = true;
  setStatus('📍 Standort wird ermittelt …');
  $('#geoHelp').hidden = true;
  try {
    const p = await locate();
    logGeo('lastOk', { acc: Math.round(p.coords.accuracy) });
    const loc = { lat: p.coords.latitude, lng: p.coords.longitude, name: 'Mein Standort', gps: true };
    setStatus('');
    setLocation(loc);
    const name = await reverseGeocode(loc.lat, loc.lng);
    if (name && state.loc === loc) { loc.name = name; store.set('loc', loc); updateLocUI(); }
  } catch (err) {
    logGeo('lastError', { code: err.code ?? 0, msg: err.message || '' });
    setStatus('');
    showGeoHelp(err.code);
    // Notlösung: ungefährer Standort über die IP-Adresse (bei Mobilfunk oft ungenau → Hinweis auf die Karte)
    if (!state.loc) {
      const ip = await ipLocation();
      if (ip) {
        state.pendingHelp = true;
        setLocation({ ...ip, name: `${ip.name} (ungefähr)`, approx: true });
        setStatus('Kein GPS-Zugriff – vorläufig ungefährer Ort über die Internetverbindung. Für genaue Werte tippe unter „Karte“ auf deinen Ort.', true);
      }
    }
  } finally {
    locating = false;
  }
}

/** Beim Öffnen der App still den Standort aktualisieren (nur wenn erlaubt und weiter als 2 km bewegt). */
async function refreshGPSQuietly() {
  // Die Permissions-API meldet auf iOS oft falsche Werte – daher auch versuchen, wenn GPS hier schon einmal geklappt hat
  if (locating) return;
  if ((await geoPermission()) !== 'granted' && !geoLog.lastOk) return;
  try {
    const p = await getPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 15 * 60000 });
    logGeo('lastOk', { acc: Math.round(p.coords.accuracy) });
    const { latitude: lat, longitude: lng } = p.coords;
    const dist = Math.hypot((lat - state.loc.lat) * 111, (lng - state.loc.lng) * 111 * Math.cos(lat * Math.PI / 180));
    if (dist > 2) {
      const loc = { lat, lng, name: 'Mein Standort', gps: true };
      setLocation(loc);
      const name = await reverseGeocode(lat, lng);
      if (name && state.loc === loc) { loc.name = name; store.set('loc', loc); updateLocUI(); }
    }
  } catch { /* still ignorieren */ }
}

function showGeoHelp(code) {
  const box = $('#geoHelp');
  let html;
  const iv = iosVersion();
  if (code === 1 && isIOS && isStandalone()) {
    html = `<b>iOS verweigert dieser Home-Bildschirm-App den Standort.</b>
      ${!iv || iv >= 26 ? 'Das ist ein bekannter Fehler seit iOS 26: Apps vom Home-Bildschirm bekommen oft keinen Standort, obwohl dieselbe Seite in Safari funktioniert. Die App selbst kann das nicht umgehen.' : ''}
      <p><b>Lösung 1 – am einfachsten:</b> Tippe deinen Ort auf der Karte an oder suche ihn. Er wird gespeichert, und für die Vorhersage reicht eine Genauigkeit von ein paar Kilometern völlig.</p>
      <button class="btn primary" data-goto="map">🗺️ Ort auf der Karte wählen</button>
      <p><b>Lösung 2 – GPS trotzdem nutzen:</b> App so neu hinzufügen, dass sie in Safari öffnet (dort klappt die Ortung):</p>
      <ol>
        <li>App-Symbol auf dem Home-Bildschirm gedrückt halten › <b>App entfernen</b>.</li>
        <li>Seite in <b>Safari</b> öffnen, einmal <b>📍 Standort freigeben</b> antippen und erlauben.</li>
        <li><b>Teilen</b> › <b>Zum Home-Bildschirm</b> › den Schalter <b>„Als Web-App öffnen“</b> <b>ausschalten</b> › Hinzufügen.</li>
      </ol>
      <p><b>Lösung 3 – manchmal hilft:</b></p>
      <ol>
        <li><b>Einstellungen › Datenschutz &amp; Sicherheit › Ortungsdienste</b>: Ortungsdienste an, unten <b>Safari-Websites</b> › <b>„Beim Verwenden der App“</b> und <b>„Genauer Standort“</b> an.</li>
        <li><b>Einstellungen › Allgemein › iPhone übertragen/zurücksetzen › Zurücksetzen › Standort &amp; Datenschutz zurücksetzen</b> – danach fragt iOS wieder nach (gilt für alle Apps).</li>
      </ol>`;
  } else if (code === 1) {
    html = `<b>Ortung wurde nicht erlaubt.</b> So schaltest du sie frei:
      <ol>
        <li><b>Einstellungen › Datenschutz &amp; Sicherheit › Ortungsdienste</b> – Ortungsdienste <b>ein</b>.</li>
        <li>Dort ganz unten <b>Safari-Websites</b> antippen › <b>„Beim Verwenden der App“</b> wählen und <b>„Genauer Standort“</b> einschalten.</li>
        <li><b>Einstellungen › Apps › Safari › Standort</b> (ältere iOS: <b>Einstellungen › Safari › Standort</b>) › <b>„Fragen“</b> oder <b>„Erlauben“</b>.</li>
        ${isStandalone() ? '<li>Hilft das nicht: App-Symbol vom Home-Bildschirm löschen, Seite in Safari öffnen, dort einmal den Standort erlauben und dann erneut <b>„Zum Home-Bildschirm“</b> hinzufügen.</li>' : ''}
      </ol>`;
  } else if (code === 0) {
    html = '<b>Dieses Gerät/dieser Browser unterstützt keine Ortung.</b> Suche deinen Ort unten.';
  } else {
    html = `<b>Standort konnte nicht ermittelt werden</b> (${code === 3 ? 'Zeitüberschreitung' : 'kein Signal'}).
      Prüfe, ob die Ortungsdienste eingeschaltet sind, geh ggf. kurz ins Freie und tippe erneut auf den Button – oder wähle den Ort auf der Karte.
      <button class="btn wide" data-goto="map" style="margin-top:8px">🗺️ Ort auf der Karte wählen</button>`;
  }
  if (!isIOS && code === 1) html = '<b>Ortung wurde nicht erlaubt.</b> Erlaube den Standortzugriff für diese Seite in den Browser-Einstellungen (Schloss-Symbol neben der Adresse) und versuche es erneut.';
  box.innerHTML = html;
  box.hidden = false;
  const w = document.getElementById('welcomeHelp');
  if (w) { w.innerHTML = html; w.hidden = false; }
  // Auf der Nacht-Ansicht ebenfalls anzeigen (dort landet man nach dem Ersatz-Standort)
  state.geoHelpHtml = html;
}

/** Ortungs-Diagnose in den Optionen – hilft herauszufinden, was iOS genau meldet. */
async function renderGeoDiag() {
  const box = document.getElementById('geoDiag');
  if (!box) return;
  const perm = await geoPermission();
  const codeTxt = { 0: 'nicht unterstützt', 1: 'verweigert (PERMISSION_DENIED)', 2: 'Position nicht verfügbar', 3: 'Zeitüberschreitung' };
  const t = (x) => new Date(x).toLocaleString('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  const iv = iosVersion();
  const rows = [
    ['Ansicht', isStandalone() ? 'Home-Bildschirm-App' : 'Browser (Safari o. ä.)'],
    ['Gerät', isIOS ? `iPhone/iPad, iOS ${iv ?? '?'}` : navigator.platform || '–'],
    ['Sichere Verbindung', window.isSecureContext ? 'ja (HTTPS)' : 'nein – Ortung nur über HTTPS möglich!'],
    ['Ortungs-Schnittstelle', 'geolocation' in navigator ? 'vorhanden' : 'fehlt'],
    ['Berechtigung laut Browser', `${{ granted: 'erlaubt', prompt: 'fragen', denied: 'verweigert', unknown: 'unbekannt' }[perm] || perm} <span class="muted">(auf iOS oft ungenau)</span>`],
    ['Letzte Ortung', geoLog.lastOk ? `${t(geoLog.lastOk.t)} · ±${geoLog.lastOk.acc} m` : 'noch nie erfolgreich'],
    ['Letzter Fehler', geoLog.lastError ? `${t(geoLog.lastError.t)} · ${codeTxt[geoLog.lastError.code] || geoLog.lastError.code}${geoLog.lastError.msg ? ` · „${esc(geoLog.lastError.msg)}“` : ''}` : 'keiner'],
  ];
  box.innerHTML = `<table class="diag">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
}

async function ipLocation() {
  try {
    const r = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=de');
    const j = await r.json();
    if (typeof j.latitude !== 'number' || typeof j.longitude !== 'number') return null;
    return { lat: j.latitude, lng: j.longitude, name: j.locality || j.city || j.principalSubdivision || 'Unbekannt' };
  } catch { return null; }
}

function renderWelcome() {
  $('#tonight').innerHTML = `
    <div class="card welcome">
      <div class="welcome-icon" aria-hidden="true">✦</div>
      <h1 class="h1">Willkommen!</h1>
      <p class="muted">Damit die App die Bedingungen für deinen Fotospot berechnen kann, braucht sie deinen Standort. Er wird nur auf deinem Gerät gespeichert.</p>
      <button class="btn primary" id="welcomeGps">📍 Standort freigeben</button>
      <button class="btn wide" data-goto="map">🗺️ Ort auf der Karte wählen</button>
      <button class="btn wide" id="welcomeSearch" style="margin-top:8px">🔍 Ort suchen</button>
      <div id="welcomeHelp" class="geohelp" hidden></div>
    </div>`;
  $('#welcomeGps').onclick = () => useGPS();
  $('#welcomeSearch').onclick = () => { showView('settings'); $('#searchInput').focus(); };
}

function setLocation(loc) {
  const changed = !state.loc || locKey(state.loc) !== locKey(loc);
  state.loc = loc;
  store.set('loc', loc);
  state.nightIdx = 0;
  if (changed) {
    // alte Daten verwerfen, damit nie Werte vom vorherigen Ort angezeigt werden
    state.data = null;
    state.nights = [];
    $('#tonight').innerHTML = '';
    $('#week').innerHTML = '';
  }
  updateLocUI();
  autoBortle(loc);
  load(true);
  refreshMapLocation();
  showView('tonight');
}

/** Bortle-Klasse automatisch aus der Lichtverschmutzungskarte ermitteln (wenn nicht manuell gesetzt). */
async function autoBortle(loc) {
  const e = bortleEntry(loc);
  if (e && !e.auto) return; // manuelle Einstellung hat Vorrang
  try {
    const z = await lightPollutionAt(loc.lat, loc.lng);
    state.bortleByLoc[locKey(loc)] = { v: z.bortle, auto: true, zone: z.zone, sqm: z.sqm };
    store.set('bortleByLoc', state.bortleByLoc);
    if (state.loc && locKey(state.loc) === locKey(loc)) {
      updateLocUI();
      if (state.data) { computeNights(); render(); }
    }
  } catch (err) {
    console.warn('Lichtverschmutzung nicht ermittelbar', err);
  }
}

function updateLocUI() {
  const l = state.loc;
  $('#locName').textContent = l ? l.name : 'Standort wählen';
  $('#locInfo').textContent = l ? `${l.name} · ${l.lat.toFixed(4)}°, ${l.lng.toFixed(4)}°` : 'Noch kein Standort gewählt.';
  if (l) $('#lpLink').href = `https://www.lightpollutionmap.info/#zoom=10.00&lat=${l.lat.toFixed(4)}&lon=${l.lng.toFixed(4)}&state=eyJiYXNlbWFwIjoiTGF5ZXJCaW5nUm9hZCIsIm92ZXJsYXkiOiJ3YV8yMDE1Iiwib3ZlcmxheWNvbG9yIjpmYWxzZSwib3ZlcmxheW9wYWNpdHkiOjYwLCJmZWF0dXJlc29wYWNpdHkiOjg1fQ==`;
  $('#bortle').value = String(bortle());
  const be = bortleEntry();
  $('#bortleSrc').innerHTML = !l ? '' : be?.auto
    ? `✓ Automatisch aus der Lichtverschmutzungskarte: Zone <b>${esc(be.zone)}</b>, Himmelshelligkeit ca. ${esc(be.sqm || '')} mag/″² → Bortle ${be.v}.`
    : be ? `Manuell eingestellt. <button class="link" id="bortleAuto">Automatisch ermitteln</button>` : 'Wird ermittelt …';
  const ba = document.getElementById('bortleAuto');
  if (ba) ba.onclick = () => { delete state.bortleByLoc[locKey(state.loc)]; store.set('bortleByLoc', state.bortleByLoc); updateLocUI(); autoBortle(state.loc); };
  renderFavs();
}

// ---------- Daten laden ----------
let loadSeq = 0;
async function load(force) {
  if (!state.loc) return;
  const { lat, lng } = state.loc;
  if (!force && state.data && state.data.key === locKey(state.loc) && Date.now() - state.data.fetched < 20 * 60000) return;
  const seq = ++loadSeq;
  const key = locKey(state.loc);
  state.loading = true;
  $('#refreshBtn').classList.add('spin');
  setStatus(state.data ? '' : 'Lade Wetter- und Himmelsdaten …');

  const settle = (p) => p.then((v) => v).catch(() => null);
  try {
    const [forecast, upper, aq, kp, models] = await Promise.all([
      fetchForecast(lat, lng),
      settle(fetchUpperWinds(lat, lng)),
      settle(fetchAirQuality(lat, lng)),
      settle(fetchKp()),
      settle(fetchModels(lat, lng)),
    ]);
    if (seq !== loadSeq) return; // inzwischen wurde ein anderer Ort gewählt
    state.data = { key, fetched: Date.now(), forecast, upper, aq, kp, models };
    store.set('cache2', { key: state.data.key, data: serializeData(state.data) });
    setStatus('');
  } catch (e) {
    if (seq !== loadSeq) return;
    if (state.data) setStatus(`Offline – zeige gespeicherte Daten vom ${new Date(state.data.fetched).toLocaleString('de-DE')}.`, true);
    else setStatus('Wetterdaten konnten nicht geladen werden. Prüfe die Internetverbindung und tippe auf ↻.', true);
  } finally {
    if (seq === loadSeq) { state.loading = false; $('#refreshBtn').classList.remove('spin'); }
  }
  if (state.data && state.data.key === locKey(state.loc)) { computeNights(); render(); }
}

function serializeData(d) {
  const m = (x) => (x ? [...x.entries()] : null);
  const models = d.models ? Object.fromEntries(Object.entries(d.models).map(([k, v]) => [k, m(v)])) : null;
  return { ...d, forecast: { ...d.forecast, hourly: m(d.forecast.hourly) }, upper: m(d.upper), aq: m(d.aq), models };
}
function reviveData(d) {
  const m = (x) => (x ? new Map(x) : null);
  const models = d.models ? Object.fromEntries(Object.entries(d.models).map(([k, v]) => [k, m(v)])) : null;
  return { ...d, forecast: { ...d.forecast, hourly: m(d.forecast.hourly) }, upper: m(d.upper), aq: m(d.aq), models };
}

function computeNights() {
  if (!state.data || !state.loc || state.data.key !== locKey(state.loc)) return;
  const { lat, lng } = state.loc;
  const o = off();
  const now = Date.now();
  const localNow = now + o;
  const dayStart = Math.floor(localNow / 86400000) * 86400000;
  let noon = dayStart + 12 * 3600000 - o;
  if ((localNow - dayStart) / 3600000 < 12) {
    // Vor Mittag: noch die vergangene Nacht zeigen – aber nur, bis die Morgendämmerung vorbei ist
    const prev = analyzeNight(noon - 86400000, lat, lng, 10);
    const end = prev.events.civilDawn ?? prev.events.sunrise ?? noon;
    if (now < end) noon -= 86400000;
  }
  state.nights = [];
  for (let i = 0; i < 7; i++) {
    const start = noon + i * 86400000;
    const night = analyzeNight(start, lat, lng, 5);
    const sc = scoreNight(night, state.data, { bortle: bortle(), notBefore: i === 0 ? now : null, gcCulm: gcCulmination(lat) });
    state.nights.push({ start, night, sc });
  }
}

// ---------- Rendering ----------
function render() {
  if (!state.nights.length) return;
  // Jeden Bereich einzeln absichern, damit ein Fehler nicht alle Ansichten leer lässt
  const parts = [['Nacht', renderTonight], ['7 Nächte', renderWeek], ['Kamera', renderCamera]];
  if (currentView === 'sky') parts.push(['Himmel', renderSky]);
  for (const [name, fn] of parts) {
    try { fn(); } catch (e) { console.error(e); showFatal(`${name}: ${e.message}`); }
  }
}

function ringSVG(score, cls) {
  const r = 52, c = 2 * Math.PI * r, p = Math.max(0.001, score / 100);
  return `<svg viewBox="0 0 120 120" class="ring ${cls}" role="img" aria-label="Score ${score} von 100">
    <circle cx="60" cy="60" r="${r}" class="ring-bg"/>
    <circle cx="60" cy="60" r="${r}" class="ring-fg" stroke-dasharray="${c * p} ${c}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" class="ring-num">${score}</text>
    <text x="60" y="80" class="ring-sub">von 100</text></svg>`;
}

const statusIcon = { good: '●', warn: '▲', serious: '◆', crit: '✕' };
function badge(cls, text) { return `<span class="badge ${cls}"><span aria-hidden="true">${statusIcon[cls] || ''}</span> ${esc(text)}</span>`; }
function lvl(x, good, warn, serious, higherIsBad = true) {
  if (x == null || isNaN(x)) return 'none';
  if (higherIsBad) return x <= good ? 'good' : x <= warn ? 'warn' : x <= serious ? 'serious' : 'crit';
  return x >= good ? 'good' : x >= warn ? 'warn' : x >= serious ? 'serious' : 'crit';
}

function renderTonight() {
  const { start, night, sc } = state.nights[state.nightIdx];
  const mode = state.mode;
  const best = mode === 'mw' ? sc.mw : sc.stars;
  const r = rating(best.score);
  const ev = night.events;
  const s = sc.summary;
  const ph = moonPhaseInfo(night.illum.phase);
  const illumPct = Math.round(night.illum.fraction * 100);
  const isToday = state.nightIdx === 0;
  const nightLabel = `${fmtD(start)} → ${fmtD(start + 86400000)}`;
  const hasData = sc.hours.length > 0;

  // Limitierende Faktoren im besten Fenster
  const winHours = sc.hours.filter((h) => best.start != null && h.t >= best.start && h.t < best.end);
  const factorNames = { dark: 'Dämmerung', cloud: 'Wolken', precip: 'Niederschlag', moon: 'Mondlicht', hum: 'Luftfeuchte', vis: 'Dunst/Sicht', transp: 'Transparenz', wind: 'Wind', band: 'Milchstraße steht tief / lichtschwacher Teil' };
  const limits = [];
  if (winHours.length) {
    for (const k of Object.keys(factorNames)) {
      if (k === 'band' && mode !== 'mw') continue;
      const fk = k === 'moon' && mode === 'mw' ? 'moonMW' : k;
      const v = winHours.reduce((a, h) => a + h.f[fk], 0) / winHours.length;
      if (v < 0.9) limits.push({ k, v });
    }
    limits.sort((a, b) => a.v - b.v);
  }
  const bInfo = BORTLE[bortle()];
  if ((mode === 'mw' ? bInfo.mw : bInfo.star) < 0.85) limits.push({ k: 'lp', v: mode === 'mw' ? bInfo.mw : bInfo.star });
  factorNames.lp = `Lichtverschmutzung (Bortle ${bortle()})`;

  const root = $('#tonight');
  root.innerHTML = '';
  if (state.loc?.approx && state.geoHelpHtml) root.append(el('div', 'geohelp', state.geoHelpHtml));

  // Nachtwahl & Modus
  const head = el('div', 'nighthead');
  head.innerHTML = `
    <div class="nightnav">
      <button class="iconbtn" id="prevN" ${state.nightIdx === 0 ? 'disabled' : ''} aria-label="Vorherige Nacht">‹</button>
      <div><div class="muted small">${isToday ? 'Heute Nacht' : 'Nacht'}</div><div class="nightdate">${nightLabel}</div></div>
      <button class="iconbtn" id="nextN" ${state.nightIdx >= state.nights.length - 1 ? 'disabled' : ''} aria-label="Nächste Nacht">›</button>
    </div>
    <div class="seg" role="tablist">
      <button role="tab" class="${mode === 'stars' ? 'on' : ''}" data-mode="stars">Sterne</button>
      <button role="tab" class="${mode === 'mw' ? 'on' : ''}" data-mode="mw">Milchstraße</button>
    </div>`;
  root.append(head);
  head.querySelector('#prevN').onclick = () => { state.nightIdx--; render(); };
  head.querySelector('#nextN').onclick = () => { state.nightIdx++; render(); };
  head.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { state.mode = b.dataset.mode; store.set('mode', state.mode); render(); }));

  // Hero
  const hero = el('div', 'card hero');
  let heroText;
  if (!hasData) heroText = '<p>Für diese Nacht liegen noch keine Wetterdaten vor.</p>';
  else {
    heroText = `<div class="verdict ${r.cls}">${esc(r.text)}</div>
      <div class="besttime">${best.start && best.score >= 10 ? `Beste Zeit: <b>${fmtT(best.start)} – ${fmtT(best.end)}</b>` : best.start ? 'Kein lohnendes Zeitfenster' : 'Keine geeignete Zeit mehr'}</div>
      ${!best.start ? '' : limits.length ? `<div class="limits">Begrenzt durch: ${limits.slice(0, 3).map((l) => `<span>${esc(factorNames[l.k])}</span>`).join('')}</div>` : '<div class="limits ok">Keine nennenswerten Einschränkungen 🎉</div>'}`;
  }
  hero.innerHTML = `${ringSVG(hasData ? best.score : 0, r.cls)}<div class="herotext">
      <div class="muted small">${mode === 'mw' ? 'Chance auf Milchstraßenfotos' : 'Chance auf Sternenfotos'}</div>${heroText}</div>`;
  if (hasData) {
    const ag = modelAgreement(sc);
    if (ag) hero.querySelector('.herotext').insertAdjacentHTML('beforeend', `<div class="conf small">Vorhersage-Sicherheit: <b class="badge ${ag.level.cls}">${ag.level.text}</b></div>`);
  }
  root.append(hero);
  if (hasData && state.loc) root.append(heroActions(state.nights[state.nightIdx], best));

  // Milchstraße-Hinweis
  if (mode === 'mw') {
    const g = night.gcWindow;
    const mwc = el('div', 'card note');
    const bh = winHours.length ? winHours.reduce((a, h) => (h.band > a.band ? h : a), winHours[0]) : null;
    const bandTxt = bh && bh.band > 0
      ? `<b>Im besten Zeitfenster:</b> ${esc(bh.bandName)} – ${round(bh.bandAlt)}° hoch im ${azimuthName(bh.bandAz)} (Helligkeit ${Math.round(bh.band * 100)} % vom Zentrum).<br>`
      : (night.bandBest ? `<b>Hellster Teil in der Dunkelheit:</b> ${esc(night.bandBest.bandName)} um ${fmtT(night.bandBest.t)}, ${round(night.bandBest.bandAlt)}° im ${azimuthName(night.bandBest.bandAz)}.<br>` : '');
    if (g) {
      mwc.innerHTML = `${bandTxt}<b>Milchstraßenzentrum</b> sichtbar ${fmtT(g.start)} – ${fmtT(g.end)}; höchster Stand ${round(g.bestAlt)}° im ${azimuthName(g.bestAz)} um ${fmtT(g.bestT)}.
        ${g.moonFreeMin < g.minutes ? `<br>Davon ohne Mond: ${fmtDur(g.moonFreeMin)}.` : ''}`;
    } else {
      mwc.innerHTML = `${bandTxt}<b>Das Milchstraßenzentrum</b> (hellster Teil) steht in dieser Jahreszeit während der Dunkelheit unter dem Horizont –
        bewertet wird daher der hellste sichtbare Abschnitt des Bandes. Dieser ist lichtschwächer, bei dunklem Himmel aber gut fotografierbar.
        <span id="mwNext" class="muted"></span>`;
      setTimeout(() => {
        const n = nextMilkyWaySeason(start, state.loc.lat, state.loc.lng);
        const t = document.getElementById('mwNext');
        if (t) t.textContent = n ? ` Nächste Saison für das Zentrum ab ca. ${fmtD(n.t, { day: 'numeric', month: 'long', year: 'numeric' })}.` : '';
      }, 0);
    }
    root.append(mwc);
  }

  // Altitude-Chart
  root.append(chartCard(night, sc));

  // Stunden-Matrix
  if (hasData) root.append(hourGrid(sc, mode));
  if (hasData && state.data?.models) root.append(modelsCard(sc));

  // Parameter-Kacheln
  const grid = el('div', 'tiles');
  const moonRise = night.moonEvents.filter((e) => e.type === 'rise');
  const moonSet = night.moonEvents.filter((e) => e.type === 'set');
  const moonDarkUp = night.samples.filter((x) => x.sun < -18 && x.moon > 0).length * 5;

  const tiles = [];
  tiles.push(tile('Wolken', s.cloud != null ? `${round(s.cloud)} %` : '–', lvl(s.cloud, 20, 45, 70),
    `Tief ${round(s.low)} % · Mittel ${round(s.mid)} % · Hoch ${round(s.high)} %<br>Minimum in der Nacht: ${round(s.cloudMin)} %`));
  tiles.push(tile('Niederschlag', s.pp != null ? `${round(s.pp)} %` : '–', lvl(s.pp, 10, 30, 60), 'Höchste Regenwahrscheinlichkeit in den dunklen Stunden'));
  tiles.push(tile('Mond', `${ph.icon} ${illumPct} %`, lvl(illumPct, 15, 40, 70),
    `${ph.name}<br>${moonRise.length ? `Aufgang ${moonRise.map((e) => `${fmtT(e.t)} (${azimuthName(e.az)})`).join(', ')}` : ''}${moonRise.length && moonSet.length ? '<br>' : ''}${moonSet.length ? `Untergang ${moonSet.map((e) => `${fmtT(e.t)} (${azimuthName(e.az)})`).join(', ')}` : ''}${!moonRise.length && !moonSet.length ? (night.samples[Math.floor(night.samples.length / 2)].moon > 0 ? 'Die ganze Nacht über dem Horizont' : 'Die ganze Nacht unter dem Horizont') : ''}<br>Im Dunkeln am Himmel: ${fmtDur(moonDarkUp)}`));
  tiles.push(tile('Dunkelheit', night.astroDarkMin ? fmtDur(night.astroDarkMin) : 'keine', night.astroDarkMin >= 300 ? 'good' : night.astroDarkMin >= 120 ? 'warn' : night.astroDarkMin > 0 ? 'serious' : 'crit',
    `Astronomische Nacht ${ev.astroDusk ? fmtT(ev.astroDusk) : '–'} – ${ev.astroDawn ? fmtT(ev.astroDawn) : '–'}<br>Davon mondfrei: ${fmtDur(night.moonFreeDarkMin)}`));
  tiles.push(tile('Luftfeuchte / Tau', s.rh != null ? `${round(s.rh)} %` : '–', s.spreadMin == null ? 'none' : s.spreadMin < 2 ? 'crit' : s.spreadMin < 4 ? 'warn' : 'good',
    `Min. Abstand Temperatur–Taupunkt: ${round(s.spreadMin, 1)} °C<br>${s.spreadMin != null && s.spreadMin < 3 ? '⚠︎ Objektiv kann beschlagen – Heizmanschette einpacken!' : 'Geringe Beschlaggefahr'}`));
  tiles.push(tile('Wind', s.wind != null ? `${round(s.wind)} km/h` : '–', lvl(s.wind, 12, 20, 30),
    `Böen bis ${round(s.gust)} km/h<br>${(s.gust ?? 0) > 35 ? 'Stativ beschweren, kurze Belichtungen' : 'Ruhig genug fürs Stativ'}`));
  tiles.push(tile('Transparenz', s.aod != null ? `AOD ${round(s.aod, 2)}` : '–',
    s.aod != null ? lvl(s.aod, 0.12, 0.25, 0.45) : 'none',
    s.aod != null
      ? `Aerosol-optische Dicke (Dunst, Staub, Rauch): unter 0,1 sehr klar, über 0,3 trüb${s.dust != null ? `<br>Saharastaub ${round(s.dust)} µg/m³` : ''}`
      : 'Aerosol-Vorhersage reicht nur ~5 Tage'));
  tiles.push(tile('Seeing (geschätzt)', s.seeing != null ? `${round(s.seeing, 1)}/8` : '–', lvl(s.seeing, 3, 5, 6),
    `${s.seeing != null ? `Luftruhe ${SEEING_TEXT[Math.round(s.seeing)]} (1 = beste)<br>` : ''}${s.jet != null ? `Jetstream (250 hPa): ${round(s.jet)} km/h<br>` : ''}<span class="muted">Aus Höhenwinden geschätzt. Wichtig für Teleskop/Tele, kaum für Weitwinkel.</span>`));
  tiles.push(tile('Sichtweite', s.vis != null ? `${round(s.vis / 1000)} km` : '–', lvl(s.vis, 20000, 10000, 5000, false), 'Unter 10 km deutet auf Dunst oder Nebel hin'));
  tiles.push(tile('Temperatur', s.tempMin != null ? `${round(s.tempMin)} °C` : '–', s.tempMin == null ? 'none' : s.tempMin < -10 ? 'warn' : 'good',
    `Nachts ${round(s.tempMin)} bis ${round(s.tempMax)} °C<br>${s.tempMin != null && s.tempMin < 3 ? 'Ersatzakkus warm halten – Kälte leert sie schnell.' : 'Kälte ist kein Problem'}`));
  const be = bortleEntry();
  tiles.push(tile('Lichtverschmutzung', `Bortle ${bortle()}`, bortle() <= 3 ? 'good' : bortle() <= 5 ? 'warn' : bortle() <= 7 ? 'serious' : 'crit',
    `${BORTLE[bortle()].label}<br>${be?.auto ? `Automatisch aus Karte (Zone ${esc(be.zone)})` : be ? 'Manuell eingestellt' : 'Standardwert – noch nicht ermittelt'}<br><a href="#" data-goto="map">Karte ›</a> · <a href="#" data-goto="settings">Ändern ›</a>`));

  // Polarlicht
  const gm = geomagneticLatitude(state.loc.lat, state.loc.lng);
  const kpNeeded = Math.max(0, (60.5 - Math.abs(gm)) / 2);
  const kpTxt = s.kpMax != null ? round(s.kpMax, 1) : '–';
  const auroraLvl = s.kpMax == null ? 'none' : s.kpMax >= kpNeeded + 1 ? 'good' : s.kpMax >= kpNeeded ? 'warn' : 'crit';
  tiles.push(tile('Polarlicht', `Kp ${kpTxt}`, auroraLvl,
    `Für deinen Ort nötig: ca. Kp ${round(kpNeeded, 1)}<br>${s.kpMax == null ? 'Vorhersage nur für ~3 Tage' : s.kpMax >= kpNeeded ? '✨ Polarlicht am Nordhorizont möglich!' : 'Kein Polarlicht zu erwarten'}`, true));

  // Meteorströme
  const showers = activeMeteorShowers(new Date(night.midT));
  tiles.push(tile('Meteorströme', showers.length ? showers[0].name : 'keine', showers.length ? (Math.abs(showers[0].daysToPeak) <= 2 && showers[0].zhr >= 50 ? 'good' : 'warn') : 'none',
    showers.length ? showers.map((m) => `${esc(m.name)}: ${m.daysToPeak === 0 ? 'heute Maximum' : m.daysToPeak > 0 ? `Maximum in ${m.daysToPeak} T.` : `Maximum vor ${-m.daysToPeak} T.`} (ZHR ${m.zhr})`).join('<br>') : 'Gerade kein größerer Strom aktiv', true));

  const nm = nextNewMoon(start);
  tiles.push(tile('Nächster Neumond', nm ? fmtD(nm, { day: 'numeric', month: 'short' }) : '–', 'none',
    nm ? `in ${Math.max(0, Math.round((nm - Date.now()) / 86400000))} Tagen – dunkelste Nächte ±4 Tage` : '', true));

  tiles.forEach((t) => grid.append(t));
  root.append(grid);

  // Dämmerungszeiten
  const tw = el('div', 'card');
  tw.innerHTML = `<h2 class="h2">Sonne &amp; Dämmerung</h2>
    <table class="times">
      <tr><td>Sonnenuntergang</td><td>${fmtT(ev.sunset)}</td><td>Sonnenaufgang</td><td>${fmtT(ev.sunrise)}</td></tr>
      <tr><td>Bürgerl. Dämmerung</td><td>${fmtT(ev.civilDusk)}</td><td></td><td>${fmtT(ev.civilDawn)}</td></tr>
      <tr><td>Naut. Dämmerung</td><td>${fmtT(ev.nauticalDusk)}</td><td></td><td>${fmtT(ev.nauticalDawn)}</td></tr>
      <tr><td>Astron. Nacht ab</td><td>${fmtT(ev.astroDusk)}</td><td>bis</td><td>${fmtT(ev.astroDawn)}</td></tr>
    </table>
    <p class="small muted">Blaue Stunde (Sonne −4° bis −8°) eignet sich für Landschaft mit ersten Sternen.</p>`;
  root.append(tw);

  const foot = el('p', 'small muted center');
  foot.textContent = state.data ? `Stand ${new Date(state.data.fetched).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' })} · Höhe ${round(state.data.forecast.elevation)} m · ${state.data.forecast.timezone}` : '';
  root.append(foot);
}

function tile(title, value, cls, detail, wide = false) {
  const t = el('div', `tile ${wide ? 'wide' : ''}`);
  const label = { good: 'gut', warn: 'mittel', serious: 'schlecht', crit: 'sehr schlecht' }[cls];
  t.innerHTML = `<div class="tile-h">${esc(title)}${label ? ` <span class="dot ${cls}" title="${label}" aria-label="${label}">${statusIcon[cls]}</span>` : ''}</div>
    <div class="tile-v">${value}</div><div class="tile-d">${detail || ''}</div>`;
  return t;
}

// ---------- Höhen-Diagramm (Mond & galaktisches Zentrum) ----------
function chartCard(night, sc) {
  const card = el('div', 'card');
  card.innerHTML = '<h2 class="h2">Höhe über dem Horizont</h2>';
  const ev = night.events;
  const t0 = (ev.sunset ?? night.samples[0].t) - 3600000;
  const t1 = (ev.sunrise ?? night.samples[night.samples.length - 1].t) + 3600000;
  const pts = night.samples.filter((s) => s.t >= t0 && s.t <= t1);
  const W = 640, H = 220, L = 34, R = 10, T = 12, B = 26;
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (a) => T + ((90 - Math.max(-20, a)) / 110) * (H - T - B);

  // Hintergrund nach Sonnenstand
  let bg = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i].sun;
    const cls = s > -0.8 ? 'sky-day' : s > -6 ? 'sky-civil' : s > -12 ? 'sky-naut' : s > -18 ? 'sky-astro' : 'sky-night';
    bg += `<rect x="${x(pts[i].t)}" y="${T}" width="${x(pts[i + 1].t) - x(pts[i].t) + 0.5}" height="${H - T - B}" class="${cls}"/>`;
  }
  const path = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  let grid = '';
  for (const a of [0, 30, 60, 90]) grid += `<line x1="${L}" x2="${W - R}" y1="${y(a)}" y2="${y(a)}" class="${a === 0 ? 'base' : 'grid'}"/><text x="${L - 6}" y="${y(a) + 4}" class="axis" text-anchor="end">${a}°</text>`;
  let ticks = '';
  const firstH = Math.ceil(t0 / 3600000) * 3600000;
  for (let t = firstH; t <= t1; t += 3600000) {
    const hh = new Date(t + off()).getUTCHours();
    if (hh % 2 === 0) ticks += `<text x="${x(t)}" y="${H - 8}" class="axis" text-anchor="middle">${String(hh).padStart(2, '0')}</text>`;
  }
  const nowX = Date.now() >= t0 && Date.now() <= t1 ? `<line x1="${x(Date.now())}" x2="${x(Date.now())}" y1="${T}" y2="${H - B}" class="nowline"/>` : '';
  const maxMoon = pts.reduce((a, p) => (p.moon > a.moon ? p : a), pts[0]);
  const maxGc = pts.reduce((a, p) => (p.gc > a.gc ? p : a), pts[0]);

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Höhe von Mond und Milchstraßenzentrum im Verlauf der Nacht">
    ${bg}${grid}${ticks}${nowX}
    <path d="${path('gc')}" class="line s1"/>
    <path d="${path('moon')}" class="line s2"/>
    ${maxGc.gc > -15 ? `<text x="${Math.min(W - 90, x(maxGc.t))}" y="${y(maxGc.gc) - 6}" class="dlabel">Milchstraße</text>` : ''}
    ${maxMoon.moon > -15 ? `<text x="${Math.min(W - 50, x(maxMoon.t))}" y="${y(maxMoon.moon) - 6}" class="dlabel">Mond</text>` : ''}
    <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
    <circle class="cdot s1" r="5" visibility="hidden"/><circle class="cdot s2" r="5" visibility="hidden"/>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
  </svg>`;
  const wrap = el('div', 'chartwrap', svg);
  card.append(wrap);
  card.append(el('div', 'legend', `<span><i class="sw s1"></i>Milchstraßenzentrum</span><span><i class="sw s2"></i>Mond (${Math.round(night.illum.fraction * 100)} %)</span>
    <span><i class="sw sky-astro"></i>Astron. Dämmerung</span><span><i class="sw sky-night"></i>Nacht</span>`));

  // Interaktion (Touch/Hover)
  const svgEl = wrap.querySelector('svg');
  const cross = svgEl.querySelector('.cross');
  const d1 = svgEl.querySelector('.cdot.s1'), d2 = svgEl.querySelector('.cdot.s2');
  const tip = $('#tip');
  const move = (ev2) => {
    const pt = ev2.touches ? ev2.touches[0] : ev2;
    const rect = svgEl.getBoundingClientRect();
    const sx = ((pt.clientX - rect.left) / rect.width) * W;
    const t = t0 + ((sx - L) / (W - L - R)) * (t1 - t0);
    const p = pts.reduce((a, q) => (Math.abs(q.t - t) < Math.abs(a.t - t) ? q : a), pts[0]);
    const px = x(p.t);
    [cross].forEach((c) => { c.setAttribute('x1', px); c.setAttribute('x2', px); c.setAttribute('visibility', 'visible'); });
    d1.setAttribute('cx', px); d1.setAttribute('cy', y(p.gc)); d1.setAttribute('visibility', p.gc > -20 ? 'visible' : 'hidden');
    d2.setAttribute('cx', px); d2.setAttribute('cy', y(p.moon)); d2.setAttribute('visibility', p.moon > -20 ? 'visible' : 'hidden');
    const h = sc.hours.find((hh) => p.t >= hh.t && p.t < hh.t + 3600000);
    tip.innerHTML = `<b>${fmtT(p.t)}</b><br>Sonne ${round(p.sun)}°<br><i class="sw s1"></i> Milchstraße ${round(p.gc)}° ${azimuthName(p.gcAz)}<br><i class="sw s2"></i> Mond ${round(p.moon)}° ${azimuthName(p.moonAz)}${h ? `<br>Wolken ${round(h.effCloud)} %<br>Score ${Math.round(state.mode === 'mw' ? h.mw : h.stars)}` : ''}`;
    tip.hidden = false;
    const tx = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, pt.clientX - tip.offsetWidth / 2));
    tip.style.left = `${tx}px`;
    tip.style.top = `${rect.top + window.scrollY - tip.offsetHeight - 8 < window.scrollY ? rect.bottom + 8 : rect.top - tip.offsetHeight - 8}px`;
  };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); d1.setAttribute('visibility', 'hidden'); d2.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const hit = svgEl.querySelector('.hit');
  hit.addEventListener('mousemove', move);
  hit.addEventListener('mouseleave', leave);
  hit.addEventListener('touchstart', move, { passive: true });
  hit.addEventListener('touchmove', move, { passive: true });
  hit.addEventListener('touchend', leave);
  return card;
}

// ---------- Stunden-Matrix ----------
function hourGrid(sc, mode) {
  const card = el('div', 'card');
  card.innerHTML = '<h2 class="h2">Stunde für Stunde</h2><p class="small muted">Wische seitlich für alle Stunden. Farben: <span class="dot good">●</span> gut <span class="dot warn">▲</span> mittel <span class="dot serious">◆</span> schlecht <span class="dot crit">✕</span> sehr schlecht</p>';
  const hours = sc.hours;
  const rows = [
    ['Score', (h) => Math.round(mode === 'mw' ? h.mw : h.stars), (v) => lvl(v, 55, 35, 15, false), ''],
    ['Wolken', (h) => Math.round(h.effCloud), (v) => lvl(v, 20, 45, 70), '%'],
    ['· tief', (h) => h.low, (v) => lvl(v, 15, 40, 70), '%'],
    ['· mittel', (h) => h.midc, (v) => lvl(v, 15, 40, 70), '%'],
    ['· hoch', (h) => h.high, (v) => lvl(v, 25, 50, 80), '%'],
    ['Regen', (h) => h.pp, (v) => lvl(v, 10, 30, 60), '%'],
    ['Mond', (h) => Math.round(h.moon), (v) => (v < 0 ? 'good' : lvl(v * state.nights[state.nightIdx].night.illum.fraction, 5, 15, 30)), '°'],
    ['Milchstr.', (h) => Math.round((h.band ?? 0) * 100), (v) => lvl(v, 70, 45, 20, false), '%'],
    ['MW-Zentrum', (h) => Math.round(h.gc), (v) => lvl(v, 20, 10, 3, false), '°'],
    ['Dunkelheit', (h) => Math.round(h.f.dark * 100), (v) => lvl(v, 99, 70, 40, false), '%'],
    ['Feuchte', (h) => h.rh, (v) => lvl(v, 75, 85, 95), '%'],
    ['Tau-Abst.', (h) => (h.temp != null && h.dew != null ? Math.round((h.temp - h.dew) * 10) / 10 : null), (v) => lvl(v, 4, 2, 1, false), '°'],
    ['Wind', (h) => Math.round(h.wind), (v) => lvl(v, 12, 20, 30), ''],
    ['Böen', (h) => Math.round(h.gust), (v) => lvl(v, 25, 40, 55), ''],
    ['Sicht', (h) => (h.vis != null ? Math.round(h.vis / 1000) : null), (v) => lvl(v, 20, 10, 5, false), 'km'],
    ['AOD', (h) => (h.aod != null ? Math.round(h.aod * 100) / 100 : null), (v) => lvl(v, 0.12, 0.25, 0.45), ''],
    ['Seeing', (h) => (h.seeing != null ? Math.round(h.seeing) : null), (v) => lvl(v, 3, 5, 6), ''],
    ['Jetstream', (h) => (h.jet != null ? Math.round(h.jet) : null), (v) => lvl(v, 90, 150, 200), ''],
    ['Temp.', (h) => (h.temp != null ? Math.round(h.temp) : null), () => 'none', '°'],
  ].filter(([, fn]) => hours.some((h) => fn(h) != null));

  let html = '<div class="gridscroll"><table class="hgrid"><thead><tr><th></th>';
  for (const h of hours) {
    const past = h.t + 3600000 < Date.now();
    html += `<th class="${past ? 'past' : ''}">${fmtT(h.t).slice(0, 2)}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const [name, fn, lv, unit] of rows) {
    html += `<tr><th>${name}</th>`;
    for (const h of hours) {
      const v = fn(h);
      const c = v == null ? 'none' : lv(v);
      const past = h.t + 3600000 < Date.now();
      html += `<td class="c-${c}${past ? ' past' : ''}" title="${name} ${fmtT(h.t)}: ${v ?? '–'}${unit}">${v == null ? '·' : String(v).replace('.', ',')}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div><p class="small muted">Wind/Böen/Jetstream in km/h · Mond/MW-Zentrum = Höhe in Grad · Milchstr. = Sichtbarkeit des hellsten Abschnitts · Tau-Abst. = Temperatur minus Taupunkt · Seeing geschätzt: 1 = beste, 8 = schlechteste · AOD = Dunst/Aerosole</p>';
  card.insertAdjacentHTML('beforeend', html);
  return card;
}

// ---------- Wochenübersicht ----------
function renderWeek() {
  const root = $('#week');
  root.innerHTML = '';
  let bestIdx = -1, bestScore = -1;
  state.nights.forEach((n, i) => { const s = state.mode === 'mw' ? n.sc.mw.score : n.sc.stars.score; if (n.sc.hours.length && s > bestScore) { bestScore = s; bestIdx = i; } });

  state.nights.forEach((n, i) => {
    const ph = moonPhaseInfo(n.night.illum.phase);
    const st = n.sc.stars, mw = n.sc.mw;
    const has = n.sc.hours.length > 0;
    const main = state.mode === 'mw' ? mw : st;
    const r = rating(main.score);
    const row = el('div', `card weekrow ${i === bestIdx && bestScore >= 35 ? 'best' : ''}`);
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    // Mini-Verlauf: Score je Stunde ab nautischer Dämmerung
    const strip = n.sc.hours.filter((h) => h.sun < -12).map((h) => {
      const v = Math.round(state.mode === 'mw' ? h.mw : h.stars);
      return `<i class="c-${lvl(v, 55, 35, 15, false)}" title="${fmtT(h.t)}: ${v}"></i>`;
    }).join('');
    row.innerHTML = `
      <div class="wk-date"><b>${i === 0 ? 'Heute' : i === 1 ? 'Morgen' : fmtD(n.start, { weekday: 'short' }).replace('.', '')}</b><span class="muted small">${fmtD(n.start, { day: 'numeric', month: 'numeric' })}</span></div>
      <div class="wk-score ${r.cls}">${has ? main.score : '–'}</div>
      <div class="wk-info">
        <div>${has ? badge(r.cls, r.text) : '<span class="muted">keine Daten</span>'}${i === bestIdx && bestScore >= 35 ? ' <span class="tag">Beste Nacht</span>' : ''}</div>
        <div class="small">☁︎ ${round(n.sc.summary.cloud)} % · ${ph.icon} ${Math.round(n.night.illum.fraction * 100)} % · Dunkel ${fmtDur(n.night.astroDarkMin)}</div>
        <div class="small muted">Sterne ${has ? st.score : '–'} · Milchstraße ${has ? mw.score : '–'}${has && main.start ? ` · beste Zeit ${fmtT(main.start)}–${fmtT(main.end)}` : ''}</div>
        ${strip ? `<div class="strip" aria-hidden="true">${strip}</div>` : ''}
      </div>`;
    const open = () => { state.nightIdx = i; render(); showView('tonight'); };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    root.append(row);
  });

  // Mondkalender der nächsten 30 Tage (dunkle Nächte)
  const mc = el('div', 'card');
  let cells = '';
  const start = state.nights[0].start;
  for (let d = 0; d < 30; d++) {
    const t = start + d * 86400000 + 12 * 3600000; // Mitternacht
    const il = moonIllumination(t);
    const ph = moonPhaseInfo(il.phase);
    const dark = il.fraction < 0.25;
    cells += `<div class="mcell ${dark ? 'dark' : ''}" title="${fmtD(t - 43200000)}: ${Math.round(il.fraction * 100)} %"><span>${ph.icon}</span><small>${fmtD(t - 43200000, { day: 'numeric' })}.</small></div>`;
  }
  mc.innerHTML = `<h2 class="h2">Mondkalender (30 Nächte)</h2><p class="small muted">Hervorgehoben: Nächte mit unter 25 % Mondbeleuchtung.</p><div class="mgrid">${cells}</div>`;
  $('#mwSeason').innerHTML = '';
  $('#mwSeason').append(mc);
}

// ---------- Kamera ----------
function setupCamera() {
  const ids = { crop: '#camCrop', mp: '#camMP', focal: '#camFocal', aperture: '#camAperture' };
  for (const [k, sel] of Object.entries(ids)) {
    const inp = $(sel);
    inp.value = String(state.cam[k]);
    inp.addEventListener('input', () => {
      const v = parseFloat(String(inp.value).replace(',', '.'));
      if (!isNaN(v) && v > 0) { state.cam[k] = v; store.set('cam', state.cam); renderCamera(); }
    });
  }
  renderCamera();
}

function renderCamera() {
  const c = state.cam;
  const sensorW = 36 / c.crop;
  const pxW = Math.sqrt(c.mp * 1e6 * 1.5);
  const pitch = (sensorW * 1000) / pxW; // µm
  const eqF = c.focal * c.crop;
  const t500 = 500 / eqF;
  const tNPF = (35 * c.aperture + 30 * pitch) / c.focal;
  const n = state.nights[state.nightIdx];
  const b = bortle();
  const moonBright = n ? n.night.illum.fraction : 0;

  // ISO-Empfehlung (für Einzelbelichtung im NPF-Zeitrahmen)
  let iso = c.aperture <= 2 ? 3200 : c.aperture <= 2.8 ? 6400 : 12800;
  if (b >= 5) iso /= 2;
  if (b >= 7) iso /= 2;
  if (moonBright > 0.5) iso /= 2;
  iso = Math.max(800, Math.min(12800, iso));

  const fov = 2 * Math.atan(sensorW / (2 * c.focal)) * 180 / Math.PI;
  const trailsInterval = Math.max(15, Math.round(tNPF * 2));

  $('#camResult').innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="tile-h">NPF-Regel</div><div class="tile-v">${round(tNPF, 1)} s</div><div class="tile-d">Punktförmige Sterne, auch bei hoher Auflösung. Pixelgröße ≈ ${round(pitch, 1)} µm</div></div>
      <div class="tile"><div class="tile-h">500er-Regel</div><div class="tile-v">${round(t500, 1)} s</div><div class="tile-d">Klassische Faustregel (${round(eqF)} mm KB-äquivalent). Leichte Strichspuren möglich.</div></div>
      <div class="tile"><div class="tile-h">ISO</div><div class="tile-v">${iso}</div><div class="tile-d">Startwert für Bortle ${b}${moonBright > 0.5 ? ' und hellen Mond' : ''}. Histogramm ca. ⅓ von links.</div></div>
      <div class="tile"><div class="tile-h">Bildwinkel</div><div class="tile-v">${round(fov)}°</div><div class="tile-d">horizontal. Für die ganze Milchstraße: ≤ 14 mm KB oder Panorama.</div></div>
    </div>
    <div class="card">
      <h2 class="h2">Empfohlene Einstellungen</h2>
      <ul class="list small">
        <li><b>Modus:</b> Manuell (M), <b>RAW</b>, Bildstabilisator aus auf dem Stativ</li>
        <li><b>Blende:</b> f/${round(c.aperture, 1)} (offen oder ⅓–1 Stufe abgeblendet gegen Koma)</li>
        <li><b>Belichtung:</b> ${round(Math.min(tNPF, t500), 0)} s · <b>ISO</b> ${iso}</li>
        <li><b>Weißabgleich:</b> 3800–4200 K</li>
        <li><b>Fokus:</b> Manuell, im Live-View auf hellen Stern vergrößern (10×) und scharfstellen</li>
        <li><b>Auslösung:</b> 2-s-Selbstauslöser oder Fernauslöser, Langzeit-Rauschreduzierung aus (für Stacking)</li>
        <li><b>Rauschen reduzieren:</b> 10–20 Bilder stacken (z. B. Sequator, Starry Landscape Stacker)</li>
        <li><b>Strichspuren:</b> Intervall ${trailsInterval} s, 100–300 Bilder, Richtung Polarstern</li>
        <li><b>Mit Nachführung:</b> 1–4 min bei ISO 800–1600 möglich</li>
      </ul>
    </div>`;
}

// ---------- Einstellungen ----------
function setupSettings() {
  const sel = $('#bortle');
  for (let i = 1; i <= 9; i++) sel.append(new Option(`${i} – ${BORTLE[i].label}`, String(i)));
  sel.addEventListener('change', () => {
    if (!state.loc) return;
    state.bortleByLoc[locKey(state.loc)] = { v: parseInt(sel.value, 10), auto: false };
    store.set('bortleByLoc', state.bortleByLoc);
    updateLocUI();
    if (state.data) { computeNights(); render(); }
  });

  $('#gpsBtn').addEventListener('click', () => useGPS());
  $('#searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    const ul = $('#searchResults');
    if (q.length < 2) return;
    ul.innerHTML = '<li class="muted">Suche …</li>';
    try {
      const res = await searchPlaces(q);
      ul.innerHTML = res.length ? '' : '<li class="muted">Nichts gefunden.</li>';
      for (const r of res) {
        const li = el('li', null, `<button class="result"><b>${esc(r.name)}</b><span class="muted small">${esc(r.detail)}</span></button>`);
        li.querySelector('button').onclick = () => { ul.innerHTML = ''; $('#searchInput').value = ''; setLocation({ lat: r.lat, lng: r.lng, name: r.name }); };
        ul.append(li);
      }
    } catch {
      ul.innerHTML = '<li class="muted">Suche fehlgeschlagen (offline?).</li>';
    }
  });
  $('#manBtn').addEventListener('click', () => {
    const lat = parseFloat($('#manLat').value.replace(',', '.')), lng = parseFloat($('#manLng').value.replace(',', '.'));
    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return alert('Bitte gültige Koordinaten eingeben.');
    setLocation({ lat, lng, name: `${lat.toFixed(3)}°, ${lng.toFixed(3)}°` });
  });
  $('#favAdd').addEventListener('click', () => { if (state.loc) saveFav(state.loc); });
  $('#mapPickBtn').addEventListener('click', () => showView('map'));
  $('#geoTestBtn').addEventListener('click', () => useGPS());
  renderGeoDiag();
  $('#redToggle').addEventListener('change', (e) => { state.red = e.target.checked; store.set('red', state.red); applyRed(); });
  updateLocUI();
}

function saveFav(loc) {
  const name = prompt('Name für diesen Ort:', loc.name);
  if (!name) return false;
  state.favs = state.favs.filter((f) => locKey(f) !== locKey(loc));
  state.favs.push({ lat: loc.lat, lng: loc.lng, name });
  store.set('favs', state.favs);
  if (state.loc && locKey(state.loc) === locKey(loc)) { state.loc = { ...state.loc, name }; store.set('loc', state.loc); }
  updateLocUI();
  return true;
}

function renderFavs() {
  const ul = $('#favList');
  ul.innerHTML = state.favs.length ? '' : '<li class="muted small">Noch keine Orte gespeichert.</li>';
  state.favs.forEach((f, i) => {
    const li = el('li', 'fav', `<button class="result"><b>${esc(f.name)}</b><span class="muted small">Bortle ${bortleEntry(f)?.v ?? '–'} · ${f.lat.toFixed(2)}°, ${f.lng.toFixed(2)}°</span></button><button class="iconbtn del" aria-label="Löschen">✕</button>`);
    li.querySelector('.result').onclick = () => setLocation({ ...f });
    li.querySelector('.del').onclick = () => { state.favs.splice(i, 1); store.set('favs', state.favs); renderFavs(); };
    ul.append(li);
  });
}

function applyRed() {
  document.body.classList.toggle('red', state.red);
  $('#redToggle').checked = state.red;
  $('#redBtn').classList.toggle('on', state.red);
}

// ---------- Tabs ----------
function setupTabs() {
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  // Links mit data-goto="…" wechseln den Tab (überall in der App)
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (a) { e.preventDefault(); showView(a.dataset.goto); }
  });
  try { localStorage.removeItem('cache'); } catch { /* alter Cache der ersten Version */ }
}
let currentView = 'tonight';
const PARENT_TAB = { camera: 'more', settings: 'more', pack: 'more', diary: 'more', data: 'more' };
function showView(v) {
  currentView = v;
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === `view-${v}`));
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === (PARENT_TAB[v] || v)));
  document.body.classList.toggle('mapmode', v === 'map');
  $('#tip').hidden = true;
  window.scrollTo({ top: 0 });
  if (v === 'map') invalidateMap();
  try { onViewShown(v); } catch (e) { console.error(e); showFatal(e.message); }
}

/** Kurze Hinweismeldung unten am Bildschirm. */
let toastTimer = null;
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ---------- Start ----------
// Erst ganz am Ende aufrufen: Alle Konstanten/Variablen oben müssen initialisiert sein,
// sonst bricht das Rendern mit gespeicherten Daten ab (das ließ früher die 7-Nächte-Ansicht leer).
init();
