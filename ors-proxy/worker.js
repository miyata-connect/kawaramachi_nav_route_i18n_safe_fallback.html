/**
 * walk-nav Cloudflare Worker
 * Endpoints:
 *  - GET  /v1/health
 *  - POST /v1/places
 *  - GET  /v1/weather
 *  - GET  /v1/incidents
 *
 * Secret:
 *  - GMAPS_API_KEY : Google Places API (New)
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Accept-Language,X-Admin-Token",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/v1/health" && request.method === "GET") {
        return j({ status: "ok", time: new Date().toISOString(), region: env.CF?.colo ?? "edge" }, 200, cors);
      }
      if (url.pathname === "/v1/places" && request.method === "POST") {
        return handlePlaces(request, env, cors);
      }
      if (url.pathname === "/v1/weather" && request.method === "GET") {
        return handleWeather(request, env, cors, ctx);
      }
      if (url.pathname === "/v1/incidents" && request.method === "GET") {
        return handleIncidents(request, env, cors, ctx);
      }
      return j({ error: { code: "not_found", message: "route not found" } }, 404, cors);
    } catch (e) {
      return j({ error: { code: "internal_error", message: String(e?.message ?? e) } }, 500, cors);
    }
  },
};

/* ----------------------------- /v1/places ------------------------------ */
async function handlePlaces(request, env, cors) {
  if (!env.GMAPS_API_KEY) {
    return j({ error: { code: "missing_secret", message: "GMAPS_API_KEY is not set" } }, 500, cors);
  }
  const bodyIn = await request.json().catch(() => ({}));
  const { fieldMask, ...body } = bodyIn ?? {};
  const fieldMaskHeader =
    typeof fieldMask === "string" && fieldMask.trim()
      ? fieldMask.trim()
      : "id,displayName,formattedAddress,location";

  const acceptLang = request.headers.get("Accept-Language")?.trim() || "ja-JP";

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Goog-Api-Key": env.GMAPS_API_KEY,
      "X-Goog-FieldMask": fieldMaskHeader,
      "Accept-Language": acceptLang,
    },
    body: JSON.stringify(body ?? {}),
  });

  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { ...cors, "Content-Type": res.headers.get("Content-Type") || "application/json; charset=utf-8" },
  });
}

/* ----------------------------- /v1/weather ----------------------------- */
async function handleWeather(request, env, cors, ctx) {
  const url = new URL(request.url);
  const lat = toNum(url.searchParams.get("lat"));
  const lng = toNum(url.searchParams.get("lng"));
  const lang = normLang(url.searchParams.get("lang") || "ja");
  const units = (url.searchParams.get("units") || "metric").toLowerCase();

  if (!isFinite(lat) || !isFinite(lng)) return j({ error: { code: "bad_request", message: "lat/lng required" } }, 400, cors);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return j({ error: { code: "bad_request", message: "lat [-90,90], lng [-180,180]" } }, 400, cors);
  if (!["ja", "en"].includes(lang)) return j({ error: { code: "bad_request", message: "lang must be 'ja' or 'en'" } }, 400, cors);
  if (!["metric", "imperial"].includes(units)) return j({ error: { code: "bad_request", message: "units must be 'metric' or 'imperial'" } }, 400, cors);

  const latR = roundTo(lat, 0.05);
  const lngR = roundTo(lng, 0.05);

  const cacheKey = new Request(`${url.origin}/__cache/weather?lat=${latR}&lng=${lngR}&lang=${lang}&units=${units}`, { method: "GET" });
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return withCors(hit, cors);

  const tz = "Asia/Tokyo";
  const api = new URL("https://api.open-meteo.com/v1/forecast");
  api.searchParams.set("latitude", String(latR));
  api.searchParams.set("longitude", String(lngR));
  api.searchParams.set("hourly", "temperature_2m,precipitation,weather_code");
  api.searchParams.set("timezone", tz);
  if (units === "imperial") {
    api.searchParams.set("temperature_unit", "fahrenheit");
    api.searchParams.set("precipitation_unit", "inch");
  } else {
    api.searchParams.set("temperature_unit", "celsius");
    api.searchParams.set("precipitation_unit", "mm");
  }

  const upstream = await fetch(api.toString());
  if (!upstream.ok) return j({ error: { code: "upstream_error", message: `open-meteo ${upstream.status}` } }, 502, cors);
  const om = await upstream.json();

  const hourly = om?.hourly || {};
  const times = hourly.time || [];
  const temps = hourly.temperature_2m || [];
  const precs = hourly.precipitation || [];
  const codes = hourly.weather_code || [];

  const nowJST = new Date().toLocaleString("sv-SE", { timeZone: tz });
  const nowIso = new Date(nowJST.replace(" ", "T") + "+09:00");
  const idx = nearestIndex(times, nowIso);

  const make = (i) => {
    if (i < 0 || i >= times.length) return null;
    const t = times[i];
    const temp = numOrNull(temps[i]);
    const precip = numOrNull(precs[i]);
    const code = codes[i];
    return {
      time: `${t}:00+09:00`,
      tempC: units === "imperial" ? undefined : temp,
      tempF: units === "imperial" ? temp : undefined,
      cond: mapWmo(code, lang),
      precipMm: units === "imperial" ? undefined : (precip ?? 0),
      precipIn: units === "imperial" ? (precip ?? 0) : undefined,
    };
  };

  const payload = {
    coord: { lat: latR, lng: lngR },
    now: make(idx),
    "t+3h": make(idx + 3),
    "t+6h": make(idx + 6),
    provider: "open-meteo",
    ttlSec: 300,
  };

  const res = j(payload, 200, { "Cache-Control": "public, s-maxage=300, max-age=60" });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return withCors(res, cors);
}

/* ---------------------------- /v1/incidents ---------------------------- */
/**
 * v1: 軽量スタブ（将来: provider連携）
 * Query:
 *  - lat (required), lng (required)
 *  - radius (m) default 1000, max 5000
 *  - limit default 20, max 100
 * Cache: s-maxage=300
 */
async function handleIncidents(request, env, cors, ctx) {
  const url = new URL(request.url);
  const lat = toNum(url.searchParams.get("lat"));
  const lng = toNum(url.searchParams.get("lng"));
  let radius = toNum(url.searchParams.get("radius") ?? 1000);
  let limit = toNum(url.searchParams.get("limit") ?? 20);

  if (!isFinite(lat) || !isFinite(lng)) return j({ error: { code: "bad_request", message: "lat/lng required" } }, 400, cors);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return j({ error: { code: "bad_request", message: "lat [-90,90], lng [-180,180]" } }, 400, cors);

  if (!isFinite(radius) || radius <= 0) radius = 1000;
  radius = Math.min(Math.max(radius, 10), 5000);

  if (!isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(Math.max(limit, 1), 100);

  const payload = {
    items: [], // v1はスタブ（将来: open-data / provider / manual）
    ttlSec: 300,
    provider: "stub",
  };

  const res = j(payload, 200, { "Cache-Control": "public, s-maxage=300, max-age=60" });
  return withCors(res, cors);
}

/* -------------------------------- utils -------------------------------- */
function j(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
function withCors(res, cors) {
  const out = new Response(res.body, res);
  Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
function roundTo(x, step) { return Math.round(x / step) * step; }
function normLang(x) { return String(x || "").toLowerCase().replace("_", "-").startsWith("ja") ? "ja" : "en"; }
function numOrNull(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function nearestIndex(arr, target) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  let k = 0, d = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const t = new Date(arr[i] + ":00+09:00");
    const dd = Math.abs(t.getTime() - target.getTime());
    if (dd < d) { d = dd; k = i; }
  }
  return k;
}
function mapWmo(code, lang) {
  const ja = {
    0: "晴れ", 1: "薄曇り", 2: "一時くもり", 3: "くもり", 45: "霧", 48: "霧氷を伴う霧",
    51: "霧雨（弱）", 53: "霧雨（中）", 55: "霧雨（強）", 56: "着氷性霧雨（弱）", 57: "着氷性霧雨（強）",
    61: "雨（弱）", 63: "雨（中）", 65: "雨（強）", 66: "着氷性の雨（弱）", 67: "着氷性の雨（強）",
    71: "雪（弱）", 73: "雪（中）", 75: "雪（強）", 77: "雪あられ",
    80: "にわか雨（弱）", 81: "にわか雨（中）", 82: "にわか雨（強）",
    85: "にわか雪（弱）", 86: "にわか雪（強）",
    95: "雷雨", 96: "ひょうを伴う雷雨（弱/中）", 99: "ひょうを伴う雷雨（強）",
  };
  const en = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Depositing rime fog",
    51: "Drizzle: light", 53: "Drizzle: moderate", 55: "Drizzle: dense", 56: "Freezing drizzle: light", 57: "Freezing drizzle: dense",
    61: "Rain: slight", 63: "Rain: moderate", 65: "Rain: heavy", 66: "Freezing rain: light", 67: "Freezing rain: heavy",
    71: "Snow fall: slight", 73: "Snow fall: moderate", 75: "Snow fall: heavy", 77: "Snow grains",
    80: "Rain showers: slight", 81: "Rain showers: moderate", 82: "Rain showers: violent",
    85: "Snow showers: slight", 86: "Snow showers: heavy",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
  };
  const t = lang === "ja" ? ja : en;
  return t?.[code] ?? (lang === "ja" ? "不明" : "Unknown");
}
