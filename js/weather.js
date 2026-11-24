// Datenquellen (alle kostenlos, ohne API-Schlüssel, CORS-fähig):
//  - Open-Meteo Forecast  (Wolken in 3 Schichten, Feuchte, Taupunkt, Wind, Sicht, Niederschlag)
//  - Open-Meteo Air Quality (Aerosol-optische Dicke, Staub -> Transparenz)
//  - 7Timer! ASTRO        (Seeing & Transparenz, optional)
//  - NOAA SWPC            (Kp-Index-Vorhersage -> Polarlicht)
//  - Open-Meteo Geocoding (Ortssuche), BigDataCloud (Ortsname zum GPS-Standort)

async function getJSON(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const HOURLY = [
  'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'precipitation_probability', 'precipitation',
  'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'visibility',
  'wind_speed_10m', 'wind_gusts_10m', 'is_day',
];

export async function fetchForecast(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&hourly=${HOURLY.join(',')}&timezone=auto&timeformat=unixtime&forecast_days=8&wind_speed_unit=kmh`;
  const j = await getJSON(url);
  return {
    utcOffset: j.utc_offset_seconds || 0,
    timezone: j.timezone,
    elevation: j.elevation,
    hourly: toRows(j.hourly),
  };
}

export async function fetchJetStream(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&hourly=wind_speed_250hPa&timeformat=unixtime&forecast_days=8&wind_speed_unit=kmh`;
  const j = await getJSON(url);
  return toRows(j.hourly);
}

export async function fetchAirQuality(lat, lng) {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&hourly=aerosol_optical_depth,dust,pm2_5&timeformat=unixtime&forecast_days=5`;
  const j = await getJSON(url);
  return toRows(j.hourly);
}

function toRows(h) {
  const map = new Map();
  if (!h || !h.time) return map;
  h.time.forEach((t, i) => {
    const row = {};
    for (const k of Object.keys(h)) if (k !== 'time') row[k] = h[k][i];
    map.set(t * 1000, row);
  });
  return map;
}

// 7Timer! ASTRO: 3-stündlich, 72 h. seeing/transparency 1 (sehr gut) … 8 (sehr schlecht)
export async function fetchSevenTimer(lat, lng) {
  const url = `https://www.7timer.info/bin/astro.php?lon=${lng.toFixed(3)}&lat=${lat.toFixed(3)}&ac=0&unit=metric&output=json&tzshift=0`;
  const j = await getJSON(url, 12000);
  const init = j.init; // "YYYYMMDDHH" (UTC)
  const base = Date.UTC(+init.slice(0, 4), +init.slice(4, 6) - 1, +init.slice(6, 8), +init.slice(8, 10));
  return j.dataseries.map((d) => ({
    t: base + d.timepoint * 3600000,
    seeing: d.seeing,
    transparency: d.transparency,
    liftedIndex: d.lifted_index,
  }));
}

export const SEEING_ARCSEC = ['', '< 0.5″', '0.5–0.75″', '0.75–1″', '1–1.25″', '1.25–1.5″', '1.5–2″', '2–2.5″', '> 2.5″'];
export const TRANSP_MAG = ['', '< 0.3', '0.3–0.4', '0.4–0.5', '0.5–0.6', '0.6–0.7', '0.7–0.85', '0.85–1', '> 1'];

// NOAA Kp-Vorhersage (3-stündlich). Unterstützt Array-of-Arrays und Array-of-Objects.
export async function fetchKp() {
  const j = await getJSON('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', 12000);
  let rows = [];
  if (Array.isArray(j) && Array.isArray(j[0])) {
    const head = j[0];
    const it = head.indexOf('time_tag'), ik = head.indexOf('kp'), io = head.indexOf('observed');
    rows = j.slice(1).map((r) => ({ time: r[it], kp: parseFloat(r[ik]), observed: r[io] }));
  } else if (Array.isArray(j)) {
    rows = j.map((r) => ({ time: r.time_tag, kp: parseFloat(r.kp ?? r.Kp), observed: r.observed }));
  }
  return rows
    .filter((r) => r.time && !isNaN(r.kp))
    .map((r) => ({ t: Date.parse(r.time.replace(' ', 'T') + (r.time.endsWith('Z') ? '' : 'Z')), kp: r.kp, observed: r.observed }));
}

export async function searchPlaces(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=de&format=json`;
  const j = await getJSON(url);
  return (j.results || []).map((r) => ({
    name: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lng: r.longitude,
  }));
}

export async function reverseGeocode(lat, lng) {
  try {
    const j = await getJSON(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=de`, 8000);
    return j.locality || j.city || j.principalSubdivision || null;
  } catch {
    return null;
  }
}
