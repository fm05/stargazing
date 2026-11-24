// Zusätzliche Ansichten: Himmel (Himmelsansicht, Planeten, Deep-Sky, Satelliten, Polarlicht), Wettermodelle,
// Rechner, Packliste, Fototagebuch, Sichern & Teilen, Spot-Vergleich, Kalender-Export.
import { geomagneticLatitude, activeMeteorShowers, moonPhaseInfo, azimuthName } from './astro.js';
import { planetsTonight, dsoTonight } from './planets.js';
import { skySVG, startCompass, stopCompass } from './compass.js';
import { satellitePasses } from './satellites.js';
import { solarWind, ovationAt, OVAL_IMAGE, auroraVerdict } from './aurora.js';
import { MODELS } from './weather.js';
import { rating } from './score.js';
import { compareFavs } from './spots.js';
import { lightPollutionAt } from './lightpollution.js';
import {
  store, timelapse, panorama, startrails, packingList, makeICS, shareOrDownload,
  photoPut, photoGet, photoDel, resizeImage, exportData, importData, spotLink, parseSpot, shareLink, requestPersist,
} from './tools.js';

let C = null; // Kontext aus app.js
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r0 = (x) => (x == null || isNaN(x) ? '–' : Math.round(x));
const de = (x, d = 1) => (x == null || isNaN(x) ? '–' : x.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d }));

export function initViews(ctx) {
  C = ctx;
  setupCalculators();
  setupPack();
  setupDiary();
  setupData();
  setupSky();
  $('#compareBtn').onclick = runCompare;
  handleIncomingSpot();
  requestPersist().then(renderPersist);
}

/** Wird bei jedem Tab-Wechsel aufgerufen. */
export function onViewShown(v) {
  if (v !== 'sky') { stopCompass(); compassOn = false; $('#skyCompass')?.classList.remove('on'); }
  if (v === 'sky') renderSky();
  if (v === 'pack') renderPack();
  if (v === 'diary') renderDiary();
  if (v === 'data') renderPersist();
  if (v === 'camera') renderCalculators();
}

// =====================================================================
// Wettermodelle
// =====================================================================
/** Vergleicht die Bewölkung der Modelle in den dunklen Stunden. */
export function modelAgreement(sc) {
  const models = C.state.data?.models;
  if (!models || !Object.keys(models).length) return null;
  const hours = sc.hours.filter((h) => h.sun < -12);
  if (!hours.length) return null;
  const ids = MODELS.filter((m) => models[m.id]).map((m) => m.id);
  const rows = ids.map((id) => ({ id, name: MODELS.find((m) => m.id === id).name, vals: hours.map((h) => models[id].get(h.t) ?? null) }));
  const ranges = hours.map((_, k) => {
    const v = rows.map((r) => r.vals[k]).filter((x) => x != null);
    return v.length >= 2 ? Math.max(...v) - Math.min(...v) : null;
  }).filter((x) => x != null);
  if (!ranges.length) return null;
  const spread = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const level = spread < 20 ? { cls: 'good', text: 'hoch', long: 'Die Modelle sind sich weitgehend einig – die Wolkenvorhersage ist verlässlich.' }
    : spread < 40 ? { cls: 'warn', text: 'mittel', long: 'Die Modelle weichen teilweise voneinander ab – kurz vorher noch einmal prüfen.' }
      : { cls: 'serious', text: 'gering', long: 'Die Modelle widersprechen sich deutlich – die Wolken sind schwer vorherzusagen. Satellitenbild auf der Karte im Blick behalten.' };
  return { rows, hours, spread, level };
}

export function modelsCard(sc) {
  const a = modelAgreement(sc);
  const card = document.createElement('div');
  card.className = 'card';
  if (!a) {
    card.innerHTML = '<h2 class="h2">Wettermodelle</h2><p class="small muted">Für diese Nacht liegen keine Modelldaten vor.</p>';
    return card;
  }
  const cls = (v) => (v == null ? 'none' : v <= 20 ? 'good' : v <= 45 ? 'warn' : v <= 70 ? 'serious' : 'crit');
  let html = `<h2 class="h2">Wettermodelle im Vergleich</h2>
    <p class="small">Vorhersage-Sicherheit: <b class="badge ${a.level.cls}">${a.level.text}</b> (Abweichung Ø ${Math.round(a.spread)} %-Punkte). ${a.level.long}</p>
    <div class="gridscroll"><table class="hgrid"><thead><tr><th></th>${a.hours.map((h) => `<th>${C.fmtT(h.t).slice(0, 2)}</th>`).join('')}</tr></thead><tbody>`;
  for (const r of a.rows) html += `<tr><th>${esc(r.name)}</th>${r.vals.map((v) => `<td class="c-${cls(v)}">${v == null ? '·' : Math.round(v)}</td>`).join('')}</tr>`;
  html += '</tbody></table></div><p class="small muted">Bewölkung gesamt in % je Stunde. Die Bewertung oben nutzt das automatisch beste Modell für deinen Ort.</p>';
  card.innerHTML = html;
  return card;
}

// =====================================================================
// Kalender, Teilen, Packliste-Link (Aktionen in der Nacht-Ansicht)
// =====================================================================
export function heroActions(n, best) {
  const box = document.createElement('div');
  box.className = 'actions';
  box.innerHTML = `
    <button class="btn sm" data-act="cal">📅 In Kalender</button>
    <button class="btn sm" data-goto="pack">🎒 Packliste</button>
    <button class="btn sm" data-act="share">⤴︎ Spot teilen</button>`;
  box.querySelector('[data-act=cal]').onclick = () => exportCalendar(n, best);
  box.querySelector('[data-act=share]').onclick = () => shareSpot(C.state.loc);
  return box;
}

async function exportCalendar(n, best) {
  const loc = C.state.loc;
  const ev = n.night.events;
  const start = best.start ?? ev.astroDusk ?? ev.nauticalDusk ?? n.start + 9 * 3600000;
  const end = best.end ?? start + 2 * 3600000;
  const r = rating(best.score);
  const s = n.sc.summary;
  const ph = moonPhaseInfo(n.night.illum.phase);
  const desc = [
    `${C.state.mode === 'mw' ? 'Milchstraße' : 'Sterne'}: Score ${best.score}/100 (${r.text})`,
    `Wolken ~${r0(s.cloud)} %, Mond ${Math.round(n.night.illum.fraction * 100)} % (${ph.name})`,
    `Astronomische Nacht ${C.fmtT(ev.astroDusk)}–${C.fmtT(ev.astroDawn)}`,
    `Bortle ${C.bortle()} · Temperatur bis ${r0(s.tempMin)} °C`,
    `Ort: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`,
    'Vorhersage kann sich ändern – am Abend noch einmal in der App prüfen.',
  ].join('\n');
  const ics = makeICS({ start, end, title: `✦ Sternenfotos ${loc.name} (${best.score}/100)`, location: loc.name, lat: loc.lat, lng: loc.lng, description: desc });
  const res = await shareOrDownload(ics, 'sternennacht.ics', 'text/calendar');
  if (res === 'downloaded') C.toast('Kalenderdatei erstellt – antippen, um sie in den Kalender zu übernehmen.');
}

export async function shareSpot(spot) {
  if (!spot) return;
  const res = await shareLink(spotLink(spot), `Fotospot: ${spot.name}`);
  if (res === 'copied') C.toast('Link in die Zwischenablage kopiert.');
  if (res === 'failed') C.toast('Teilen nicht möglich.');
}

// =====================================================================
// Himmel
// =====================================================================
let compassOn = false, compassState = { heading: null, pitch: null }, skyT = null;

function nightWindow(n) {
  const ev = n.night.events;
  const t0 = ev.sunset ?? n.start + 4 * 3600000;
  const t1 = ev.sunrise ?? n.start + 20 * 3600000;
  return [t0, t1 > t0 ? t1 : t0 + 12 * 3600000];
}

function setupSky() {
  $('#skyTime').oninput = (e) => {
    const n = C.night(); if (!n) return;
    const [t0, t1] = nightWindow(n);
    skyT = t0 + ((t1 - t0) * parseInt(e.target.value, 10)) / 100;
    drawSky();
  };
  $('#skyNow').onclick = () => { skyT = null; syncSkySlider(); drawSky(); };
  $('#skyDso').onchange = drawSky;
  $('#skyCompass').onclick = async () => {
    if (compassOn) { stopCompass(); compassOn = false; compassState = { heading: null, pitch: null }; $('#skyCompass').classList.remove('on'); drawSky(); return; }
    try {
      await startCompass((s) => { compassState = s; requestAnimationFrame(drawSky); });
      compassOn = true;
      $('#skyCompass').classList.add('on');
      $('#skyHint').textContent = 'Kompass aktiv: Halte das Handy aufrecht vor dich – oben in der Ansicht ist deine Blickrichtung, der weiße Kreis zeigt, wie hoch du zielst.';
    } catch (e) {
      C.toast(e.message);
    }
  };
}

function syncSkySlider() {
  const n = C.night(); if (!n) return;
  const [t0, t1] = nightWindow(n);
  let t = skyT;
  if (t == null) {
    const now = Date.now();
    t = now >= t0 && now <= t1 ? now : n.night.midT;
  }
  skyT = t;
  $('#skyTime').value = String(Math.round(((t - t0) / (t1 - t0)) * 100));
}

function drawSky() {
  const n = C.night(); const loc = C.state.loc;
  if (!n || !loc) return;
  if (skyT == null) syncSkySlider();
  $('#skyTimeLabel').textContent = C.fmtT(skyT);
  $('#skyChart').innerHTML = skySVG({ t: skyT, lat: loc.lat, lng: loc.lng, heading: compassOn ? compassState.heading : null, pitch: compassOn ? compassState.pitch : null, showDso: $('#skyDso').checked });
}

let skyKey = null, satCache = new Map(), auroraCache = null;

export function renderSky() {
  const n = C.night(); const loc = C.state.loc;
  if (!n || !loc) { $('#skyNight').textContent = 'Bitte zuerst einen Standort wählen.'; return; }
  const key = `${n.start}|${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}`;
  $('#skyNight').textContent = `${C.state.nightIdx === 0 ? 'Heute Nacht' : 'Nacht'} ${C.fmtD(n.start)} → ${C.fmtD(n.start + 86400000)} · ${loc.name}`;
  if (key !== skyKey) { skyT = null; skyKey = key; }
  syncSkySlider();
  drawSky();
  renderPlanets(n, loc);
  renderDso(n, loc);
  renderSatellites(n, loc, key);
  renderAurora(n, loc);
}

function renderPlanets(n, loc) {
  const list = planetsTonight(n.night, loc.lat, loc.lng);
  const rows = list.map((p) => {
    const v = p.vis;
    let txt, cls;
    if (v && v.maxAlt > 10) { txt = `bis ${r0(v.maxAlt)}° im ${v.dir} · am höchsten ${C.fmtT(v.bestT)}`; cls = v.maxAlt > 30 ? 'good' : 'warn'; }
    else if (p.twilight) { txt = `${p.twilight.kind}: ${r0(p.twilight.alt)}° im ${p.twilight.dir} um ${C.fmtT(p.twilight.t)}`; cls = 'warn'; }
    else { txt = 'nicht sichtbar (zu nah an der Sonne oder unter dem Horizont)'; cls = 'none'; }
    return `<li class="objrow"><span class="objicon">${p.icon}</span><div><b>${p.name}</b> <span class="muted small">${de(p.mag)} mag</span><br><span class="small ${cls === 'none' ? 'muted' : ''}">${txt}</span></div>${cls !== 'none' ? `<span class="dot ${cls}">●</span>` : ''}</li>`;
  }).join('');
  $('#planetCard').innerHTML = `<h2 class="h2">Planeten</h2><ul class="objlist">${rows}</ul>
    <p class="small muted">Helle Planeten sind schöne Blickfänge über der Landschaft. Für Details auf der Planetenscheibe braucht es ≥ 600 mm Brennweite.</p>`;
}

function renderDso(n, loc) {
  const list = dsoTonight(n.night, loc.lat, loc.lng).slice(0, 14);
  if (!list.length) { $('#dsoCard').innerHTML = '<h2 class="h2">Deep-Sky-Objekte</h2><p class="small muted">In dieser Nacht steht kein Objekt aus der Liste hoch genug (oder es wird nicht dunkel).</p>'; return; }
  const moonUp = n.night.illum.fraction > 0.3;
  const rows = list.map((o) => {
    const v = o.vis;
    const moonWarn = moonUp && v.moonSep != null && v.moonSep < 40 ? ` · <span class="warntxt">Mond nur ${r0(v.moonSep)}° entfernt</span>` : '';
    return `<li class="objrow"><span class="objicon dso">◆</span><div><b>${esc(o.name)}</b> <span class="muted small">${o.id} · ${o.type}</span><br>
      <span class="small">am höchsten ${C.fmtT(v.bestT)}: ${r0(v.maxAlt)}° im ${v.dir} · über 20°: ${Math.floor(v.minutesAbove20 / 60)} h ${String(v.minutesAbove20 % 60).padStart(2, '0')}${moonWarn}</span><br>
      <span class="small muted">${o.size} groß · ${de(o.mag)} mag · Brennweite ${o.focal}</span></div></li>`;
  }).join('');
  $('#dsoCard').innerHTML = `<h2 class="h2">Deep-Sky-Objekte heute</h2><ul class="objlist">${rows}</ul>
    <p class="small muted">Sortiert nach Beobachtungsdauer. Galaxien und Nebel brauchen Nachführung oder viele gestackte Aufnahmen.</p>`;
}

async function renderSatellites(n, loc, key) {
  const card = $('#satCard');
  const [w0, w1] = nightWindow(n);
  const t0 = Math.max(w0, Date.now() - 600000), t1 = w1;
  if (t1 <= t0) { card.innerHTML = '<h2 class="h2">ISS &amp; Satelliten</h2><p class="small muted">Diese Nacht ist schon vorbei.</p>'; return; }
  const draw = (res) => {
    const pass = (p, starlink) => `<li class="objrow"><span class="objicon">${starlink ? '⋯' : '🛰'}</span><div><b>${esc(p.name)}</b> <span class="muted small">${C.fmtT(p.start)}–${C.fmtT(p.end)}</span><br>
      <span class="small">von ${p.startDir} über ${p.maxDir} (${r0(p.maxEl)}° hoch) nach ${p.endDir} · ${Math.round(p.duration / 60)} min${p.mag != null && !starlink ? ` · ca. ${de(p.mag)} mag` : ''}</span></div>${p.maxEl > 40 ? '<span class="dot good">●</span>' : ''}</li>`;
    let html = '<h2 class="h2">ISS &amp; Satelliten</h2>';
    html += res.passes.length ? `<ul class="objlist">${res.passes.map((p) => pass(p, false)).join('')}</ul>` : '<p class="small muted">Keine sichtbaren Überflüge von ISS, Tiangong oder Hubble in dieser Nacht.</p>';
    if (res.starlink.length) html += `<p class="small"><b class="warntxt">⚠︎ Frisch gestartete Starlink-Züge sichtbar</b> – helle Lichterketten, die Langzeitbelichtungen durchqueren können:</p><ul class="objlist">${res.starlink.slice(0, 6).map((p) => pass(p, true)).join('')}</ul>`;
    else if (!res.errors.some((e) => e.startsWith('Starlink'))) html += '<p class="small muted">Keine frisch gestarteten Starlink-Züge sichtbar.</p>';
    if (res.errors.length) html += `<p class="small muted">Nicht verfügbar: ${res.errors.map(esc).join('; ')}</p>`;
    html += '<p class="small muted">Sichtbar heißt: Satellit von der Sonne beleuchtet, bei dir ist es dunkel. Tipp: 10–30 s belichten – die ISS zieht eine helle Spur.</p>';
    card.innerHTML = html;
  };
  if (satCache.has(key)) { draw(satCache.get(key)); return; }
  card.innerHTML = '<h2 class="h2">ISS &amp; Satelliten</h2><p class="small muted">Überflüge werden berechnet …</p>';
  try {
    const res = await satellitePasses(t0, t1, loc.lat, loc.lng);
    satCache.set(key, res);
    if (skyKey === key) draw(res);
  } catch (e) {
    card.innerHTML = `<h2 class="h2">ISS &amp; Satelliten</h2><p class="small muted">Bahndaten nicht verfügbar (${esc(e.message)}).</p>`;
  }
}

async function renderAurora(n, loc) {
  const card = $('#auroraCard');
  const s = n.sc.summary;
  const gm = geomagneticLatitude(loc.lat, loc.lng);
  const kpNeeded = Math.max(0, (60.5 - Math.abs(gm)) / 2);
  const kp = C.state.data?.kp || [];
  const now = Date.now();
  const nowKp = [...kp].reverse().find((k) => k.t <= now);
  const draw = (sw, ov) => {
    const v = auroraVerdict({ kpNeeded, kpMax: s.kpMax, bz: sw?.bz, speed: sw?.speed, horizon: ov?.horizon });
    const fut = kp.filter((k) => k.t >= now - 3 * 3600000).slice(0, 24);
    const bars = fut.map((k) => {
      const h = Math.max(4, (k.kp / 9) * 60);
      const c = k.kp >= kpNeeded ? 'good' : k.kp >= kpNeeded - 1 ? 'warn' : 'none';
      return `<div class="kpbar" title="${C.fmtD(k.t, { weekday: 'short' })} ${C.fmtT(k.t)}: Kp ${de(k.kp)}"><i class="c-${c}" style="height:${h}px"></i><small>${C.fmtT(k.t).slice(0, 2)}</small></div>`;
    }).join('');
    card.innerHTML = `<h2 class="h2">Polarlicht</h2>
      <p><b class="badge ${v.cls}">${v.text}</b></p>
      <table class="diag">
        <tr><td>Kp jetzt / max. in der Nacht</td><td>${nowKp ? de(nowKp.kp) : '–'} / ${s.kpMax != null ? de(s.kpMax) : '–'} <span class="muted">(nötig ≈ ${de(kpNeeded)})</span></td></tr>
        <tr><td>Magnetfeld Bz</td><td>${sw?.bz != null ? `${de(sw.bz)} nT` : '–'} <span class="muted">(negativ = günstig, unter −5 gut)</span></td></tr>
        <tr><td>Sonnenwind</td><td>${sw?.speed != null ? `${r0(sw.speed)} km/s` : '–'} <span class="muted">(über 500 = schnell)</span></td></tr>
        <tr><td>OVATION: am Horizont / über dir</td><td>${ov ? `${ov.horizon} % / ${ov.overhead} %` : '–'}</td></tr>
      </table>
      ${bars ? `<div class="small muted">Kp-Vorhersage (3-Stunden-Werte), grün = für deinen Ort ausreichend</div><div class="kpbars">${bars}</div>` : ''}
      <img class="oval" src="${OVAL_IMAGE(loc.lat)}" alt="Polarlicht-Oval (NOAA)" loading="lazy">
      <p class="small muted">Bz und Sonnenwind sind Echtzeitwerte (≈ 30–60 min Vorlauf). Polarlicht zeigt sich in Mitteleuropa meist als rötlicher Schimmer am Nordhorizont – die Kamera sieht mehr als das Auge.</p>`;
  };
  if (auroraCache && now - auroraCache.t < 10 * 60000 && auroraCache.key === `${loc.lat.toFixed(1)},${loc.lng.toFixed(1)}`) { draw(auroraCache.sw, auroraCache.ov); return; }
  draw(null, null);
  const [sw, ov] = await Promise.all([solarWind().catch(() => null), ovationAt(loc.lat, loc.lng).catch(() => null)]);
  auroraCache = { t: Date.now(), sw, ov, key: `${loc.lat.toFixed(1)},${loc.lng.toFixed(1)}` };
  if (C.currentView() === 'sky') draw(sw, ov);
}

// =====================================================================
// Rechner
// =====================================================================
function setupCalculators() {
  ['tlInterval', 'tlMinutes', 'tlFps', 'panoFocal', 'panoPortrait', 'panoH', 'panoV', 'panoOverlap', 'stMinutes', 'stExposure', 'stDec', 'stackN']
    .forEach((id) => $('#' + id).addEventListener('input', renderCalculators));
  renderCalculators();
}
const num = (id) => parseFloat(String($('#' + id).value).replace(',', '.'));

function renderCalculators() {
  const cam = C.state.cam;
  const tl = timelapse({ interval: num('tlInterval') || 25, minutes: num('tlMinutes') || 60, fps: num('tlFps') || 25, mp: cam.mp });
  $('#tlResult').innerHTML = `<b>${tl.shots}</b> Aufnahmen → <b>${de(tl.clip)} s</b> Video · ca. <b>${de(tl.storageGB)} GB</b> RAW-Speicher<br>
    <span class="muted">Intervall = Belichtungszeit + 1–2 s Pause. Bei 20 s Belichtung also ca. 22 s.</span>`;
  const p = panorama({ focal: num('panoFocal') || 24, crop: cam.crop, portrait: $('#panoPortrait').value === '1', overlap: num('panoOverlap'), hTarget: num('panoH'), vTarget: num('panoV') });
  $('#panoResult').innerHTML = `Bildwinkel je Foto ${Math.round(p.fovW)}° × ${Math.round(p.fovH)}°<br>
    <b>${p.cols} Spalte${p.cols > 1 ? 'n' : ''} × ${p.rows} Reihe${p.rows > 1 ? 'n' : ''} = ${p.total} Fotos</b> · Kamera je Schritt um ca. ${Math.round(p.stepW)}° drehen<br>
    <span class="muted">Zügig arbeiten (Sterne wandern), Fokus und Belichtung manuell fixieren, Nodalpunkt-Adapter hilft bei Vordergrund.</span>`;
  const st = startrails({ minutes: num('stMinutes') || 60, exposure: num('stExposure') || 30, dec: num('stDec') });
  $('#stResult').innerHTML = `Spurlänge ca. <b>${Math.round(st.arc)}°</b> · <b>${st.frames}</b> Einzelbilder (1 s Pause)<br>
    <span class="muted">Richtung Polarstern entstehen Kreise, Richtung Süden lange Bögen. Lücken vermeiden: Langzeit-Rauschreduzierung aus.</span>`;
  const n = parseInt($('#stackN').value, 10);
  $('#stackNLabel').textContent = String(n);
  $('#stackResult').innerHTML = `Rauschen sinkt auf <b>${Math.round(100 / Math.sqrt(n))} %</b> (Signal-Rausch-Verhältnis × ${de(Math.sqrt(n))})<br>
    <span class="muted">Verdopplung der Bildanzahl bringt jeweils ×1,4. Ab ~30 Bildern lohnt sich mehr kaum noch für Weitwinkel.</span>`;
}

// =====================================================================
// Packliste
// =====================================================================
function setupPack() {
  $('#packAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#packAddInput').value.trim();
    if (!v) return;
    store.set('packCustom', [...store.get('packCustom', []), v]);
    $('#packAddInput').value = '';
    renderPack();
  });
  $('#packReset').onclick = () => { const st = store.get('packState', {}); st.checked = []; store.set('packState', st); renderPack(); };
}

function renderPack() {
  const n = C.night();
  const loc = C.state.loc;
  const s = n?.sc.summary || {};
  const gm = loc ? geomagneticLatitude(loc.lat, loc.lng) : 0;
  const kpNeeded = Math.max(0, (60.5 - Math.abs(gm)) / 2);
  const showers = n ? activeMeteorShowers(new Date(n.night.midT)).filter((m) => Math.abs(m.daysToPeak) <= 2) : [];
  const items = packingList({
    summary: s, mode: C.state.mode,
    moonPct: n ? Math.round(n.night.illum.fraction * 100) : 0,
    aurora: s.kpMax != null && s.kpMax >= kpNeeded,
    meteor: showers.length ? `${showers[0].name} (Maximum ${showers[0].daysToPeak === 0 ? 'heute' : `in ${showers[0].daysToPeak} T.`})` : null,
  });
  store.get('packCustom', []).forEach((t, i) => items.push({ id: `c${i}`, text: t, custom: i }));
  const st = store.get('packState', {});
  const key = n ? String(n.start) : 'x';
  if (st.key !== key) { st.key = key; st.checked = []; store.set('packState', st); }
  const checked = new Set(st.checked || []);
  $('#packNight').textContent = n ? `Für die Nacht ${C.fmtD(n.start)} → ${C.fmtD(n.start + 86400000)} · ${loc?.name || ''}` : '';
  $('#packList').innerHTML = items.map((it) => `<li><label class="check"><input type="checkbox" data-id="${it.id}" ${checked.has(it.id) ? 'checked' : ''}>
      <span>${esc(it.text)}${it.why ? `<small class="why">${esc(it.why)}</small>` : ''}</span></label>${it.custom != null ? `<button class="iconbtn del" data-del="${it.custom}" aria-label="Entfernen">✕</button>` : ''}</li>`).join('');
  $('#packList').querySelectorAll('input[data-id]').forEach((cb) => (cb.onchange = () => {
    const s2 = store.get('packState', {});
    const set = new Set(s2.checked || []);
    cb.checked ? set.add(cb.dataset.id) : set.delete(cb.dataset.id);
    s2.checked = [...set]; store.set('packState', s2);
  }));
  $('#packList').querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    const c = store.get('packCustom', []); c.splice(parseInt(b.dataset.del, 10), 1); store.set('packCustom', c); renderPack();
  }));
}

// =====================================================================
// Fototagebuch
// =====================================================================
function setupDiary() {
  $('#diaryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = `d${Date.now()}`;
    const n = C.night();
    const loc = C.state.loc;
    const entry = {
      id, date: $('#dDate').value, place: $('#dPlace').value.trim() || loc?.name || '',
      lat: loc?.lat, lng: loc?.lng, rating: parseInt($('#dRating').value, 10),
      settings: $('#dSettings').value.trim(), notes: $('#dNotes').value.trim(), photo: false,
    };
    if ($('#dCond').checked && n) {
      const best = C.state.mode === 'mw' ? n.sc.mw : n.sc.stars;
      entry.cond = { score: best.score, mode: C.state.mode, cloud: n.sc.summary.cloud != null ? Math.round(n.sc.summary.cloud) : null, moon: Math.round(n.night.illum.fraction * 100), bortle: C.bortle(), temp: n.sc.summary.tempMin != null ? Math.round(n.sc.summary.tempMin) : null };
    }
    const file = $('#dPhoto').files?.[0];
    if (file) {
      try { await photoPut(id, await resizeImage(file)); entry.photo = true; } catch (err) { C.toast(`Foto nicht gespeichert: ${err.message}`); }
    }
    const diary = store.get('diary', []);
    diary.unshift(entry);
    diary.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!store.set('diary', diary)) { C.toast('Speicher voll – bitte alte Einträge exportieren und löschen.'); return; }
    $('#diaryForm').reset();
    prefillDiary();
    renderDiary();
    C.toast('Eintrag gespeichert.');
  });
  prefillDiary();
}

function prefillDiary() {
  const n = C.night();
  const d = new Date(n ? n.start + 43200000 - 86400000 / 2 : Date.now());
  $('#dDate').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  $('#dPlace').placeholder = C.state.loc?.name || 'Ort';
  const cam = C.state.cam;
  $('#dSettings').placeholder = `z. B. ${cam.focal} mm · f/${cam.aperture} · 20 s · ISO 3200`;
}

async function renderDiary() {
  prefillDiary();
  const diary = store.get('diary', []);
  const box = $('#diaryList');
  if (!diary.length) { box.innerHTML = '<p class="small muted center">Noch keine Einträge.</p>'; return; }
  box.innerHTML = diary.map((e) => `<div class="card diary" data-id="${e.id}">
      <div class="diary-h"><b>${esc(new Date(e.date + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }))}</b>
        <span class="stars">${'★'.repeat(e.rating || 0)}${'☆'.repeat(5 - (e.rating || 0))}</span></div>
      <div class="small">${esc(e.place)}</div>
      ${e.photo ? '<img class="diary-img" alt="Foto">' : ''}
      ${e.settings ? `<div class="small"><b>Einstellungen:</b> ${esc(e.settings)}</div>` : ''}
      ${e.notes ? `<div class="small">${esc(e.notes).replace(/\n/g, '<br>')}</div>` : ''}
      ${e.cond ? `<div class="small muted">Vorhersage: ${e.cond.mode === 'mw' ? 'Milchstraße' : 'Sterne'} ${e.cond.score}/100 · Wolken ${e.cond.cloud ?? '–'} % · Mond ${e.cond.moon} % · Bortle ${e.cond.bortle}${e.cond.temp != null ? ` · ${e.cond.temp} °C` : ''}</div>` : ''}
      <div class="diary-btns">${e.lat != null ? `<button class="link" data-show="${e.id}">Ort öffnen</button>` : ''}<button class="link danger" data-del="${e.id}">Löschen</button></div>
    </div>`).join('');
  box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Eintrag wirklich löschen?')) return;
    const id = b.dataset.del;
    store.set('diary', store.get('diary', []).filter((x) => x.id !== id));
    try { await photoDel(id); } catch { /* ignore */ }
    renderDiary();
  }));
  box.querySelectorAll('[data-show]').forEach((b) => (b.onclick = () => {
    const e = diary.find((x) => x.id === b.dataset.show);
    if (e) C.setLocation({ lat: e.lat, lng: e.lng, name: e.place || 'Tagebuch-Ort' });
  }));
  for (const e of diary.filter((x) => x.photo)) {
    try {
      const src = await photoGet(e.id);
      const img = box.querySelector(`[data-id="${e.id}"] .diary-img`);
      if (img && src) img.src = src; else img?.remove();
    } catch { /* ignore */ }
  }
}

// =====================================================================
// Sichern & Teilen
// =====================================================================
function setupData() {
  $('#exportBtn').onclick = async () => {
    const json = await exportData(true);
    const d = new Date();
    const res = await shareOrDownload(json, `sternenhimmel-sicherung-${d.toISOString().slice(0, 10)}.json`, 'application/json');
    $('#dataMsg').textContent = res === 'shared' ? 'Sicherung geteilt – z. B. in „Dateien“ › iCloud Drive speichern.' : res === 'downloaded' ? 'Sicherungsdatei wurde erstellt.' : '';
  };
  $('#importFile').onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const stats = await importData(await f.text(), C.locKey);
      C.reloadFromStorage();
      $('#dataMsg').textContent = `Import erfolgreich: ${stats.favs} neue Spots, ${stats.diary} neue Tagebucheinträge.`;
    } catch (err) {
      $('#dataMsg').textContent = `Import fehlgeschlagen: ${err.message}`;
    }
    e.target.value = '';
  };
  $('#linkForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const spot = parseSpot($('#linkInput').value);
    if (!spot) { C.toast('Kein Ort im Link oder Text gefunden.'); return; }
    $('#linkInput').value = '';
    showSpotBanner(spot);
    C.showView('tonight');
  });
  $('#shareCurrent').onclick = () => shareSpot(C.state.loc);
}

async function renderPersist() {
  const p = await requestPersist();
  const el = $('#persistInfo');
  if (!el) return;
  if (!p.supported) { el.textContent = 'Dieser Browser kann keinen dauerhaften Speicher zusagen – regelmäßig exportieren.'; return; }
  const mb = (x) => (x / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  el.innerHTML = `${p.granted ? '✓ <b>Dauerhafter Speicher aktiv</b> – der Browser löscht die Daten nicht automatisch.' : '⚠︎ Der Browser hat dauerhaften Speicher (noch) nicht zugesagt – bitte gelegentlich exportieren.'}
    ${p.usage != null ? `<br><span class="muted">Belegt: ${mb(p.usage)} MB</span>` : ''}`;
}

// Geteilter Spot über ?spot=lat,lng&name=…
function handleIncomingSpot() {
  const spot = parseSpot(location.href);
  if (!spot || !new URL(location.href).searchParams.get('spot')) return;
  history.replaceState(null, '', location.pathname);
  showSpotBanner(spot);
}

function showSpotBanner(spot) {
  const b = $('#spotBanner');
  b.innerHTML = `<b>📍 ${esc(spot.name)}</b> <span class="muted small">${spot.lat.toFixed(4)}°, ${spot.lng.toFixed(4)}°</span>
    <div class="actions"><button class="btn sm primary" data-a="use">Als Standort verwenden</button><button class="btn sm" data-a="fav">☆ Merken</button><button class="btn sm" data-a="x">✕</button></div>`;
  b.hidden = false;
  b.querySelector('[data-a=use]').onclick = () => { b.hidden = true; C.setLocation(spot); };
  b.querySelector('[data-a=fav]').onclick = () => { if (C.saveFav(spot)) b.querySelector('[data-a=fav]').textContent = '★ Gemerkt'; };
  b.querySelector('[data-a=x]').onclick = () => { b.hidden = true; };
}

// =====================================================================
// Spot-Vergleich
// =====================================================================
async function runCompare() {
  const box = $('#compareResult');
  const favs = [...C.state.favs];
  const loc = C.state.loc;
  if (loc && !favs.some((f) => C.locKey(f) === C.locKey(loc))) favs.unshift({ ...loc, name: `${loc.name} (aktuell)` });
  if (favs.length < 2) { box.innerHTML = '<p class="small muted">Merke dir mindestens einen weiteren Ort (Karte › Ort antippen › ☆), um zu vergleichen.</p>'; return; }
  box.innerHTML = '<p class="small muted">Lade Vorhersagen …</p>';
  $('#compareBtn').disabled = true;
  try {
    // Bortle für Orte ohne Wert nachschlagen
    for (const f of favs) {
      if (!C.bortleEntry(f)) {
        try { const z = await lightPollutionAt(f.lat, f.lng); C.setAutoBortle(f, z); } catch { /* ignore */ }
      }
    }
    const nightStarts = C.state.nights.slice(0, 3).map((n) => n.start);
    const res = await compareFavs({ favs, bortleOf: (f) => C.bortle(f), nightStarts, mode: C.state.mode, notBefore: Date.now() });
    const best = Math.max(...res.flatMap((r) => r.nights.map((x) => x.score ?? -1)));
    const head = nightStarts.map((t, i) => `<th>${i === 0 ? 'Heute' : i === 1 ? 'Morgen' : C.fmtD(t, { weekday: 'short' })}</th>`).join('');
    const rows = res.map((r, k) => `<tr data-k="${k}"><th><b>${esc(r.fav.name)}</b><br><span class="muted small">Bortle ${r.bortle}</span></th>${r.nights.map((x) => {
      const cls = x.score == null ? 'none' : rating(x.score).cls;
      return `<td class="c-${cls}${x.score === best && best > 0 ? ' top' : ''}">${x.score ?? '–'}<small>${x.cloud != null ? `☁︎${Math.round(x.cloud)}` : ''}</small></td>`;
    }).join('')}</tr>`).join('');
    box.innerHTML = `<div class="gridscroll"><table class="hgrid compare"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="small muted">${C.state.mode === 'mw' ? 'Milchstraße' : 'Sterne'}-Score je Nacht, darunter Bewölkung in %. Zeile antippen, um den Ort zu öffnen.</p>`;
    box.querySelectorAll('tr[data-k]').forEach((tr) => (tr.onclick = () => {
      const f = res[parseInt(tr.dataset.k, 10)].fav;
      C.setLocation({ lat: f.lat, lng: f.lng, name: f.name.replace(/ \(aktuell\)$/, '') });
    }));
  } catch (e) {
    box.innerHTML = `<p class="small muted">Vergleich fehlgeschlagen: ${esc(e.message)}</p>`;
  } finally {
    $('#compareBtn').disabled = false;
  }
}

export { azimuthName };
