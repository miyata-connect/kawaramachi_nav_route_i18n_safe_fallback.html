// v1 Router for Walk-Nav (Cloudflare Worker)
// - GET /v1/health  : 稼働確認
// - GET /v1/places  : Google Places(New) 検索の安全プロキシ（POSTに変換）

export default {
  async fetch(request, env, ctx) {
    const url  = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, ""); // trim trailing slash

    // CORS (GET/OPTIONSのみ)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // ルーティング
    try {
      if (request.method !== "GET") {
        return json({ error: "Method Not Allowed" }, 405);
      }

      if (path === "/v1/health") {
        return health(env);
      }

      if (path === "/v1/places") {
        return placesProxy(request, url, env);
      }

      return json({ error: "Not Found" }, 404);
    } catch (err) {
      // 予期せぬ失敗は 500
      return json({ error: "Internal Error", detail: String(err) }, 500);
    }
  },
};

/* ------------------------
   /v1/health
-------------------------*/
function health(env) {
  const body = {
    status: "ok",
    revision: env?.GIT_SHA || env?.CF_PAGES_COMMIT_SHA || null,
    buildTime: env?.BUILD_TIME || new Date().toISOString(),
  };
  return json(body, 200, { "Cache-Control": "no-store" });
}

/* ------------------------
   /v1/places  (Google Places API New)
   クエリ:
     text (必須), lat/lng/radius (任意), fieldmask=X-Goog-FieldMask をヘッダまたはクエリでも可
-------------------------*/
async function placesProxy(_request, url, env) {
  // 受入条件チェック
  const text = url.searchParams.get("text");
  if (!text) return json({ error: "text is required" }, 400);

  const lat    = url.searchParams.get("lat");
  const lng    = url.searchParams.get("lng");
  const radius = url.searchParams.get("radius"); // meters

  // FieldMask は必須（最小応答）
  const fieldMask =
    _request.headers.get("x-goog-fieldmask") ||
    url.searchParams.get("fieldmask");
  if (!fieldMask) {
    return json({ error: "X-Goog-FieldMask header is required" }, 400);
  }

  // API キー
  const apiKey = env?.GMAPS_API_KEY;
  if (!apiKey) return json({ error: "Server misconfig: GMAPS_API_KEY missing" }, 500);

  // Places(New) endpoint
  const endpoint = "https://places.googleapis.com/v1/places:searchText";

  // GET を POST に変換して検索
  const body = { textQuery: text };

  // 位置バイアス（任意）
  if (lat && lng && radius) {
    body.locationBias = {
      circle: {
        center: { latitude: Number(lat), longitude: Number(lng) },
        radius: Number(radius),
      },
    };
  }

  // 外向きリクエスト
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });

  // ステータスの正規化
  if (res.status === 200) {
    // そのままJSONを返却（短期キャッシュ可）
    const data = await res.text();
    return new Response(data, {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=60",
      },
    });
  }

  // 上流由来のエラー → 502 へ丸める（メッセージは透過）
  let detail;
  try {
    detail = await res.json();
  } catch {
    detail = await res.text();
  }

  // レート超過の表現
  if (res.status === 429) {
    return json({ error: "Upstream rate limit", detail }, 429);
  }

  // クエリ不足などは 400 に寄せる
  if (res.status >= 400 && res.status < 500) {
    return json({ error: "Bad Request to upstream", detail }, 400);
  }

  // それ以外は 502
  return json({ error: "Upstream error", detail }, 502);
}

/* ------------------------
   ユーティリティ
-------------------------*/
function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Goog-FieldMask",
    ...extra,
  };
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}
