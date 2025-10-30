// worker.js  (Cloudflare Workers - module syntax)
// Purpose: HTTPS-only proxy for Google Places API NEW (v1/places:searchText)
// - Enforces HTTPS origins via allowlist
// - Handles CORS (GET/POST/OPTIONS) with proper preflight
// - Proxies only to Google Places NEW endpoints (searchText + photo render)
// - Forces X-Goog-FieldMask (safe, minimal-but-useful default; overridable via ?fields=)
// - Supports locationBias (circle) & locationRestriction (rectangle), openNow, rankPreference, pageSize, languageCode, regionCode
// - Strong error mapping with opaque upstream details removed

export default {
  async fetch(request, env, ctx) {
    try {
      // ---- Hard HTTPS origin policy with allowlist ----
      const origin = request.headers.get("Origin") || "";
      const isHttpsOrigin = origin.startsWith("https://");
      const allowed = isAllowedOrigin(origin, env);

      // Preflight first
      if (request.method === "OPTIONS") {
        return handlePreflight(origin, isHttpsOrigin && allowed);
      }

      // Health check (no origin required)
      const url = new URL(request.url);
      if (url.pathname === "/healthz") {
        return json({ ok: true, ts: Date.now() }, 200, corsHeaders(origin, isHttpsOrigin && allowed));
      }

      // Only allow HTTPS origins for API routes
      if (!isHttpsOrigin || !allowed) {
        return json(
          {
            ok: false,
            error: "forbidden_origin",
            message: "Only approved HTTPS origins may call this Worker."
          },
          403,
          corsHeaders(origin, false)
        );
      }

      // ---- Routes ----
      if (url.pathname === "/places:searchText") {
        if (request.method !== "POST") {
          return json({ ok: false, error: "method_not_allowed" }, 405, corsHeaders(origin, true));
        }
        if (!env || !env.GMAPS_API_KEY) {
          return json({ ok: false, error: "missing_api_key" }, 500, corsHeaders(origin, true));
        }

        const body = await safeJson(request);
        if (!body || typeof body.textQuery !== "string" || !body.textQuery.trim()) {
          return json(
            { ok: false, error: "invalid_request", message: "Field `textQuery` (string) is required." },
            400,
            corsHeaders(origin, true)
          );
        }

        // Allow client to override pageSize/openNow/rankPreference/languageCode/regionCode/locationBias/locationRestriction
        const payload = {
          textQuery: body.textQuery,
          languageCode: pickString(body.languageCode),
          regionCode: pickString(body.regionCode),
          openNow: typeof body.openNow === "boolean" ? body.openNow : undefined,
          rankPreference: oneOf(body.rankPreference, ["RELEVANCE", "DISTANCE"]),
          pageSize: clampInt(body.pageSize, 1, 20),
          locationBias: normalizeBias(body.locationBias),
          locationRestriction: normalizeRestriction(body.locationRestriction)
        };

        // Remove undefineds
        cleanUndefined(payload);

        // Field mask: either query ?fields=... or default
        const fields = normalizeFieldMask(url.searchParams.get("fields"));

        const upstream = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-Goog-Api-Key": env.GMAPS_API_KEY,
            "X-Goog-FieldMask": fields
          },
          body: JSON.stringify(payload)
        });

        const text = await upstream.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }

        if (!upstream.ok) {
          return json(
            {
              ok: false,
              error: "upstream_error",
              status: upstream.status,
              message: data?.error?.message || "Google Places API error",
              details: sanitizeError(data)
            },
            upstream.status,
            corsHeaders(origin, true)
          );
        }

        return json({ ok: true, ...data }, 200, corsHeaders(origin, true));
      }

      // Photo render proxy:
      // GET /photos:render?name=places/PLACE_ID/photos/PHOTO_ID&maxWidthPx=800&maxHeightPx=600
      if (url.pathname === "/photos:render") {
        if (request.method !== "GET") {
          return json({ ok: false, error: "method_not_allowed" }, 405, corsHeaders(origin, true));
        }
        if (!env || !env.GMAPS_API_KEY) {
          return json({ ok: false, error: "missing_api_key" }, 500, corsHeaders(origin, true));
        }

        const name = url.searchParams.get("name");
        if (!name || !name.startsWith("places/")) {
          return json(
            { ok: false, error: "invalid_request", message: "Query param `name` must be like `places/ID/photos/PHOTO_ID`." },
            400,
            corsHeaders(origin, true)
          );
        }

        const maxWidthPx = url.searchParams.get("maxWidthPx");
        const maxHeightPx = url.searchParams.get("maxHeightPx");

        const mediaUrl = new URL(`https://places.googleapis.com/v1/${encodeURI(name)}/media`);
        if (maxWidthPx) mediaUrl.searchParams.set("maxWidthPx", String(Math.min(parseInt(maxWidthPx) || 0, 1600)));
        if (maxHeightPx) mediaUrl.searchParams.set("maxHeightPx", String(Math.min(parseInt(maxHeightPx) || 0, 1600)));
        mediaUrl.searchParams.set("key", env.GMAPS_API_KEY);

        const upstream = await fetch(mediaUrl.toString(), { method: "GET" });
        if (!upstream.ok) {
          const txt = await upstream.text();
          let err;
          try {
            err = JSON.parse(txt);
          } catch {
            err = { raw: txt };
          }
          return json(
            { ok: false, error: "photo_error", status: upstream.status, details: sanitizeError(err) },
            upstream.status,
            corsHeaders(origin, true)
          );
        }

        const res = new Response(upstream.body, {
          status: 200,
          headers: {
            ...corsHeaders(origin, true),
            "Content-Type": upstream.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400"
          }
        });
        return res;
      }

      // Fallback
      return json({ ok: false, error: "not_found" }, 404, corsHeaders(origin, allowed));
    } catch (e) {
      return json(
        { ok: false, error: "internal_error", message: (e && e.message) || "Unexpected error" },
        500,
        corsHeaders(request.headers.get("Origin") || "", true)
      );
    }
  }
};

// ---------------- helpers ----------------

function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  if (!origin.startsWith("https://")) return false;

  // Default allowlist; can be overridden by env.ORIGIN_ALLOWLIST (comma-separated)
  const defaults = [
    "https://miyata-connect.github.io",
    "https://miyata-connect.github.io" // GitHub Pages origin (path is not part of Origin)
  ];

  let allow = defaults;
  if (env && typeof env.ORIGIN_ALLOWLIST === "string" && env.ORIGIN_ALLOWLIST.trim()) {
    allow = env.ORIGIN_ALLOWLIST.split(",").map(s => s.trim()).filter(Boolean);
  }
  return allow.includes(origin);
}

function corsHeaders(origin, allow) {
  const headers = {
    "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
  };
  if (allow) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

function handlePreflight(origin, allow) {
  const reqMethod = "GET,POST,OPTIONS";
  const reqHeaders = "Content-Type,Authorization,X-Requested-With";
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin, allow),
      "Access-Control-Allow-Methods": reqMethod,
      "Access-Control-Allow-Headers": reqHeaders,
      "Access-Control-Max-Age": "86400"
    }
  });
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

async function safeJson(request) {
  try {
    const txt = await request.text();
    if (!txt) return {};
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function pickString(v) {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function oneOf(val, arr) {
  if (typeof val !== "string") return undefined;
  const up = val.toUpperCase();
  return arr.includes(up) ? up : undefined;
}

function clampInt(v, min, max) {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(Math.max(Math.floor(n), min), max);
}

function normalizeBias(bias) {
  if (!bias || typeof bias !== "object") return undefined;
  // Expecting { circle: { center: { latitude, longitude }, radius } }
  if (bias.circle && bias.circle.center && Number.isFinite(bias.circle.center.latitude) && Number.isFinite(bias.circle.center.longitude)) {
    const radius = clampInt(bias.circle.radius, 1, 50000); // cap 50km
    return { circle: { center: { latitude: +bias.circle.center.latitude, longitude: +bias.circle.center.longitude }, radius: radius ?? 10000 } };
  }
  return undefined;
}

function normalizeRestriction(r) {
  if (!r || typeof r !== "object") return undefined;
  // Expecting { rectangle: { low: { latitude, longitude }, high: { latitude, longitude } } }
  if (
    r.rectangle &&
    r.rectangle.low &&
    r.rectangle.high &&
    Number.isFinite(r.rectangle.low.latitude) &&
    Number.isFinite(r.rectangle.low.longitude) &&
    Number.isFinite(r.rectangle.high.latitude) &&
    Number.isFinite(r.rectangle.high.longitude)
  ) {
    return {
      rectangle: {
        low: { latitude: +r.rectangle.low.latitude, longitude: +r.rectangle.low.longitude },
        high: { latitude: +r.rectangle.high.latitude, longitude: +r.rectangle.high.longitude }
      }
    };
  }
  return undefined;
}

function normalizeFieldMask(raw) {
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  // Sensible default mask (compact but useful)
  return [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.shortFormattedAddress",
    "places.location",
    "places.primaryType",
    "places.types",
    "places.rating",
    "places.userRatingCount",
    "places.nationalPhoneNumber",
    "places.internationalPhoneNumber",
    "places.websiteUri",
    "places.googleMapsUri",
    "places.businessStatus",
    "places.currentOpeningHours",
    "places.regularOpeningHours",
    "places.priceLevel",
    "places.photos"
  ].join(",");
}

function cleanUndefined(obj) {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) delete obj[k];
  }
}

function sanitizeError(e) {
  if (!e || typeof e !== "object") return {};
  const out = {};
  if (e.error && typeof e.error === "object") {
    out.code = e.error.status || e.error.code || undefined;
    out.message = e.error.message || undefined;
  }
  if (e.status) out.status = e.status;
  return out;
}
