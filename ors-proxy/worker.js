// Walk-Nav Cloudflare Worker v1 Router
// Endpoints:
// - GET /v1/health
// - GET /v1/places  : Google Places(New) Text Search を安全にプロキシ

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    // CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      if (path === "/v1/health") {
        return health(env);
      }

      if (path === "/v1/places") {
        if (request.method !== "GET") {
          return withCORS(json({ error: "method_not_allowed" }), 405);
        }
        return placesProxy(request, env);
      }

      return withCORS(json({ error: "not_found" }), 404);
    } catch (err) {
      return withCORS(json({ error: "bad_gateway" }), 502);
    }
  },
};

// -------------------- /v1/health --------------------
function health(env) {
  const body = {
    status: "ok",
    revision: env?.COMMIT_SHA || env?.CF_PAGES_COMMIT_SHA || "",
    buildTime: env?.BUILD_TIME || new Date().toISOString(),
  };
  return withCORS(json(body), 200, shortCache());
}

// -------------------- /v1/places --------------------
async function placesProxy(request, env) {
  const url = new URL(request.url);

  // 必須: text
  const text = (url.searchParams.get("text") || "").trim();
  if (!text) return withCORS(json({ error: "missing_text" }), 400);

  // 必須: FieldMask（最小応答）
  const fieldMask =
    request.headers.get("x-goog-fieldmask") ||
    url.searchParams.get("fieldmask") ||
    "";
  if (!fieldMask) return withCORS(json({ error: "missing_fieldmask" }), 400);

  // サーバ側 API キー
  if (!env?.GMAPS_API_KEY) {
    return withCORS(json({ error: "server_misconfigured" }), 502);
  }

  // 受信ヘッダの Accept-Language を優先採用（なければ ja 固定）
  const acceptLang = (request.headers.get("accept-language") || "").toLowerCase();
  const lang = pickLang(acceptLang) || "ja";   // 例: "ja", "en"
  const region = "JP";                         // 日本の結果を優先

  // 任意: 位置バイアス
  const lat = parseFloat(url.searchParams.get("lat"));
  const lng = parseFloat(url.searchParams.get("lng"));
  const radius = parseInt(url.searchParams.get("radius") || "0", 10);

  const body = {
    textQuery: text,
    languageCode: lang,  // ★ 日本語優先（Accept-Language があればそれを優先）
    regionCode: region,  // ★ 日本の結果を優先
  };

  if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radius) && radius > 0) {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radius,
      },
    };
  }

  const gmUrl = "https://places.googleapis.com/v1/places:searchText";
  const gmReq = new Request(gmUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.GMAPS_API_KEY,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });

  const gmRes = await fetch(gmReq);

  let status = 200;
  if (gmRes.status === 400) status = 400;
  else if (gmRes.status === 429) status = 429;
  else if (gmRes.status >= 500) status = 502;

  const data = await gmRes.text();
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    ...shortCache(),
  };
  return withCORS(new Response(data, { status, headers }));
}

// -------------------- ヘルパ --------------------
function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With, X-Goog-FieldMask",
    Vary: "Origin",
  };
}

function withCORS(res, status, extraHeaders = {}) {
  const base = res instanceof Response ? res : new Response(res?.body || "", res);
  const headers = new Headers(base.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
  Object.entries(extraHeaders).forEach(([k, v]) => headers.set(k, v));
  return new Response(base.body, { status: status ?? base.status, headers });
}

function shortCache() {
  return { "Cache-Control": "public, max-age=60, must-revalidate" };
}

// Accept-Language 文字列から "ja" や "en" など最有力の言語コードを抽出
function pickLang(al) {
  if (!al) return "";
  // "ja, en;q=0.8" → ["ja","en"]
  const items = al.split(",").map(s => s.trim().split(";")[0]);
  for (const it of items) {
    const m = it.match(/^[a-z]{2}/i);
    if (m) return m[0].toLowerCase();
  }
  return "";
}
