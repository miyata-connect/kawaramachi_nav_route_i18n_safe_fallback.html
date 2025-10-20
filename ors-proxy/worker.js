// v1 Router for Walk-Nav (Cloudflare Worker)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, ""); // trim trailing slash

    // Common CORS (GETのみ短期キャッシュを想定)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (path === "/v1/health") {
        return health(env);
      }

      if (path === "/v1/places") {
        // Google Places Proxy
        return placesProxy(request, url, env);
      }

      if (path === "/v1/weather") {
        // 天候・暑熱情報: まずは 501 スタブ（後で実装）
        return json(
          { message: "weather endpoint not implemented yet" },
          501
        );
      }

      if (path === "/v1/incidents") {
        // 事件・事故サマリ: まずは 501 スタブ（後で実装）
        return json(
          { message: "incidents endpoint not implemented yet" },
          501
        );
      }

      // Not Found
      return json({ error: "Not Found" }, 404);
    } catch (err) {
      return json({ error: "Internal Error", detail: String(err) }, 500);
    }
  },
};

/* ---------- handlers ---------- */

function health(env) {
  const body = {
    status: "ok",
    revision: env.COMMIT_SHA ?? env.GIT_REV ?? "unknown",
    buildTime: env.BUILD_TIME ?? new Date().toISOString(),
  };
  return json(body, 200, { "Cache-Control": "no-store" });
}

async function placesProxy(request, url, env) {
  // 必要パラメータはクエリとしてそのまま転送
  // 例: /v1/places?text=…&lang=ja
  const apiKey = env.GMAPS_API_KEY; // Cloudflareの環境変数に設定
  if (!apiKey) {
    return json({ error: "GMAPS_API_KEY missing" }, 500);
  }

  // Text Search（新しい Places API）にフォワード
  const target = new URL("https://places.googleapis.com/v1/places:searchText");
  // 入力テキスト
  const textQuery = url.searchParams.get("text");
  if (!textQuery) return json({ error: "query `text` is required" }, 400);

  // 言語など任意
  const languageCode = url.searchParams.get("lang") ?? "ja";
  const regionCode = url.searchParams.get("region") ?? "JP";
  const fieldMask =
    url.searchParams.get("fields") ??
    // 安全な既定（必要最小限）
    "places.id,places.displayName,places.formattedAddress,places.location,places.rating";

  const gReq = new Request(target.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify({
      textQuery,
      languageCode,
      regionCode,
    }),
    // キャッシュは短期 or no-store。まずは no-store に統一
    cf: { cacheEverything: false },
  });

  const gRes = await fetch(gReq);
  const body = await gRes.text();

  return new Response(body, {
    status: gRes.status,
    headers: {
      ...corsHeaders(),
      "Content-Type": gRes.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/* ---------- helpers ---------- */

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      ...extra,
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*", // 公開API方針。必要なら制限へ
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Goog-Api-Key, X-Goog-FieldMask",
    "Access-Control-Max-Age": "600",
  };
}
