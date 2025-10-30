// Cloudflare Worker (Module Worker) — Places API (New) only, HTTPS enforced.
// Paste this entire file into the Dashboard > Edit code as `_worker.js`

/**
 * Environment: set GMAPS_API_KEY as a Secret in Cloudflare dashboard.
 * Optional: set ALLOW_ORIGINS as a comma-separated list of allowed origins.
 */
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Preflight
      if (request.method === "OPTIONS") {
        return corsPreflight(request, env);
      }

      // Health check
      if (url.pathname === "/healthz") {
        return withCors(
          request,
          json({ ok: true, ts: Date.now() }, 200),
          env
        );
      }

      // Endpoint: Places New searchText (HTTPS only)
      if (request.method === "POST" && url.pathname === "/places:searchText") {
        return await handleSearchText(request, env);
      }

      return withCors(
        request,
        json(
          {
            error: {
              code: 404,
              message: "Not Found",
              details: "Use POST /places:searchText or GET /healthz",
            },
          },
          404
        ),
        env
      );
    } catch (err) {
      return withCors(
        request,
        json(
          {
            error: {
              code: 500,
              message: "Worker internal error",
              details: String(err?.message || err),
            },
          },
          500
        ),
        null
      );
    }
  },
};

/* -------------------------- Core Handlers -------------------------- */

async function handleSearchText(request, env) {
  if (!env || !env.GMAPS_API_KEY) {
    return json(
      {
        error: {
          code: 500,
          message: "Missing GMAPS_API_KEY",
          details:
            "Set Secret GMAPS_API_KEY in Cloudflare > Workers > Variables & Secrets.",
        },
      },
      500
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return withCors(
      request,
      json(
        {
          error: {
            code: 400,
            message: "Invalid JSON body",
            details: "Request body must be a valid JSON object.",
          },
        },
        400
      ),
      env
    );
  }

  // -------- Validation & sane defaults --------
  const errs = [];
  if (!payload || typeof payload !== "object") {
    errs.push("Body must be a JSON object.");
  }
  if (!payload?.textQuery || typeof payload.textQuery !== "string") {
    errs.push("Property `textQuery` is required (string).");
  }

  if (errs.length) {
    return withCors(
      request,
      json({ error: { code: 400, message: "Bad Request", details: errs } }, 400),
      env
    );
  }

  // Defaults (override only if not provided by client)
  const merged = structuredClone(payload);

  // Language & region defaults (can be overridden by client)
  if (!merged.languageCode) merged.languageCode = "ja";
  if (!merged.regionCode) merged.regionCode = "JP";

  // Results limit hard cap (Places New allows up to 20). We default to 5.
  const max = clampNumber(merged.pageSize ?? 5, 1, 20);
  merged.pageSize = max;

  // Rank preference default if client asked for "高レビュー順" semantics
  // Client should set rankPreference explicitly; otherwise we do not force it.

  // Safety caps for bias/restriction radii
  // If client gave locationBias.circle.radius, clamp to 50km
  if (merged.locationBias?.circle?.radius != null) {
    merged.locationBias.circle.radius = clampNumber(
      merged.locationBias.circle.radius,
      1, // meters
      50000
    );
  }

  // If client gave a rectangle, trust it as-is (you already clamp on the UI side)

  // -------- Field mask (STRICT) --------
  // Keep responses lean; adjust as needed.
  // docs: https://developers.google.com/maps/documentation/places/web-service/field-masks
  const FIELD_MASK =
    "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.nationalPhoneNumber,places.internationalPhoneNumber,places.currentOpeningHours,places.photos";

  // -------- Build request to Places New (HTTPS only) --------
  const endpoint = "https://places.googleapis.com/v1/places:searchText";

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "X-Goog-Api-Key": env.GMAPS_API_KEY,
    "X-Goog-FieldMask": FIELD_MASK,
  };

  // Extra defense-in-depth: disallow accidental http (should never happen)
  if (!endpoint.startsWith("https://")) {
    return withCors(
      request,
      json(
        {
          error: {
            code: 500,
            message: "Endpoint must be HTTPS",
          },
        },
        500
      ),
      env
    );
  }

  let apiRes;
  try {
    apiRes = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(merged),
      // Cloudflare fetch defaults to HTTP/2 over TLS; no need to tweak.
    });
  } catch (e) {
    return withCors(
      request,
      json(
        {
          error: {
            code: 502,
            message: "Failed to reach Google Places API (New)",
            details: String(e?.message || e),
          },
        },
        502
      ),
      env
    );
  }

  // Handle non-2xx with clear messaging
  if (!apiRes.ok) {
    const text = await safeText(apiRes);
    const status = apiRes.status;

    // Map common issues to clearer advice
    let hint = undefined;
    if (status === 400) {
      hint =
        "Check your payload (textQuery, bias/restriction, pageSize). Ensure it matches Places New schema.";
    } else if (status === 401 || status === 403) {
      hint =
        "API key invalid or restricted. Confirm GMAPS_API_KEY and that Places API (New) is enabled on this key.";
    } else if (status === 429) {
      hint = "Rate limit exceeded. Slow down or add usage quotas.";
    } else if (status >= 500) {
      hint = "Upstream service error at Google. Retry later.";
    }

    return withCors(
      request,
      json(
        {
          error: {
            code: status,
            message: "Places API error",
            upstream: tryParseJSON(text) ?? text,
            hint,
          },
        },
        status
      ),
      env
    );
  }

  // Success
  const data = await apiRes.json();

  // Always return JSON with CORS
  return withCors(
    request,
    new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }),
    env
  );
}

/* ----------------------------- CORS ------------------------------ */

function allowedOrigins(env) {
  // Comma-separated origins in env.ALLOW_ORIGINS, or default to GitHub Pages + localhost dev.
  const defaults = [
    "https://miyata-connect.github.io",
    "https://miyata-connect.github.io/walk-nav",
    "https://miyata-connect.github.io/",
    "http://localhost:5173",
    "http://localhost:8080",
    "https://localhost:5173",
    "https://localhost:8080",
  ];
  if (!env?.ALLOW_ORIGINS) return new Set(defaults);
  return new Set(
    String(env.ALLOW_ORIGINS)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "3600",
    Vary: "Origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function withCors(request, response, env) {
  try {
    const origin = request.headers.get("Origin");
    const allow = allowedOrigins(env);
    const hdrs = new Headers(response.headers);

    if (origin && allow.has(origin)) {
      const c = corsHeaders(origin);
      for (const [k, v] of Object.entries(c)) hdrs.set(k, v);
    } else {
      // No origin or not whitelisted: do NOT echo back wildcard.
      // Still return the response (useful for direct curl), but without CORS perms.
      hdrs.set("Referrer-Policy", "strict-origin-when-cross-origin");
      hdrs.set("X-Content-Type-Options", "nosniff");
      hdrs.set("X-Frame-Options", "DENY");
    }
    return new Response(response.body, { status: response.status, headers: hdrs });
  } catch {
    return response;
  }
}

function corsPreflight(request, env) {
  const origin = request.headers.get("Origin");
  const allow = allowedOrigins(env);
  const headers = new Headers();

  if (origin && allow.has(origin)) {
    const c = corsHeaders(origin);
    for (const [k, v] of Object.entries(c)) headers.set(k, v);
  } else {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
  }

  // Short-circuit preflight
  return new Response(null, { status: 204, headers });
}

/* --------------------------- Utilities --------------------------- */

function clampNumber(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function tryParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
