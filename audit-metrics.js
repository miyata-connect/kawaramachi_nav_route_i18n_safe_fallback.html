/* audit-metrics.js
   WalkNav Audit Metrics: preflight / runtime / postflight with numeric visualization
   - Drop-in: <script src="audit-metrics.js"></script> (after body start or end)
   - No dependencies. All UI is injected dynamically.
   - Public API (global): window.WalkNavAudit
*/

(function () {
  const DEFAULT_WEIGHTS = {
    api: 0.25,
    ui: 0.25,
    geolocation: 0.2,
    layout: 0.1,
    audit: 0.1,
    i18n: 0.1,
  };

  const DEFAULT_SCORES = {
    api: 1.0,
    ui: 1.0,
    geolocation: 1.0,
    layout: 1.0,
    audit: 1.0,
    i18n: 1.0,
  };

  const STATE = {
    weights: { ...DEFAULT_WEIGHTS },
    scores: { ...DEFAULT_SCORES },
    events: [],         // {ts, kind, name, ok, impact, note}
    errors: [],         // {ts, type, message, stack}
    warnings: [],       // {ts, message}
    preflight: { done: false, ok: null, notes: [] },
    postflight: { done: false, ok: null, notes: [] },
    startedAt: performance.now(),
    badge: null,
    detailsOpen: false,
  };

  // ---------- Utils ----------
  const now = () => new Date().toISOString();
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function pushEvent(kind, name, ok, impact = 0.02, note = "") {
    STATE.events.push({ ts: now(), kind, name, ok, impact, note });
    // penalize category when failed
    if (ok === false) {
      switch (kind) {
        case "api": STATE.scores.api = clamp01(STATE.scores.api - impact); break;
        case "ui": STATE.scores.ui = clamp01(STATE.scores.ui - impact); break;
        case "geo": STATE.scores.geolocation = clamp01(STATE.scores.geolocation - impact); break;
        case "layout": STATE.scores.layout = clamp01(STATE.scores.layout - impact); break;
        case "audit": STATE.scores.audit = clamp01(STATE.scores.audit - impact); break;
        case "i18n": STATE.scores.i18n = clamp01(STATE.scores.i18n - impact); break;
        default: break;
      }
      render();
    }
  }

  function computeOverall() {
    const s = STATE.scores, w = STATE.weights;
    const total =
      s.api * w.api +
      s.ui * w.ui +
      s.geolocation * w.geolocation +
      s.layout * w.layout +
      s.audit * w.audit +
      s.i18n * w.i18n;
    return clamp01(total) * 100;
  }

  // ---------- Public API ----------
  const API = {
    version: "1.0.0",
    setWeights(weights) {
      STATE.weights = { ...STATE.weights, ...weights };
      render();
    },
    setScore(category, value01) {
      if (category in STATE.scores) {
        STATE.scores[category] = clamp01(value01);
        render();
      }
    },
    record(kind, name, ok, impact = 0.02, note = "") {
      pushEvent(kind, name, ok, impact, note);
    },
    warn(message) {
      STATE.warnings.push({ ts: now(), message });
      render();
    },
    // ---------- Preflight (入口監査) ----------
    async preflight(checks = {}) {
      // HTTPS only
      const httpsOk = location.protocol === "https:";
      if (!httpsOk) pushEvent("api", "https_enforced", false, 0.2, "Non-HTTPS detected");

      // AdvancedMarkerElement
      let advOk = false;
      try {
        advOk = !!(window.google && google.maps && google.maps.marker && google.maps.marker.AdvancedMarkerElement);
      } catch (_) { advOk = false; }
      pushEvent("ui", "advanced_marker_available", advOk, 0.2, advOk ? "" : "AdvancedMarkerElement missing");

      // Places(New) proxy URL reachable (HEAD)
      if (checks.placesProxyUrl) {
        try {
          const r = await fetch(checks.placesProxyUrl.replace(/\/+$/,"") + "/healthz", { method: "GET" });
          pushEvent("api", "proxy_healthz", r.ok, 0.1, r.ok ? "" : "healthz not OK");
        } catch (e) {
          pushEvent("api", "proxy_healthz", false, 0.1, e?.message || "proxy health error");
        }
      }

      // I18N default: expect ja labels presence hint (optional hook)
      if (checks.expectJapanese === true) {
        // Heuristic: if any element with [data-i18n="ja"] exists, treat ok
        const i18nOk = !!document.querySelector('[data-i18n="ja"], [lang="ja"], [data-lang="ja"]');
        pushEvent("i18n", "japanese_ui_present", i18nOk, 0.05, i18nOk ? "" : "Japanese labels missing");
      }

      STATE.preflight.done = true;
      STATE.preflight.ok = httpsOk && advOk;
      STATE.preflight.notes.push(`https:${httpsOk}, adv:${advOk}`);
      render();
      return STATE.preflight.ok;
    },
    // ---------- Layout Overlap Watcher ----------
    watchOverlaps(selectors = []) {
      // Checks every 800ms — if overlap found, record layout fail once.
      let flagged = false;
      setInterval(() => {
        try {
          for (let i = 0; i < selectors.length; i++) {
            const a = document.querySelector(selectors[i][0]);
            const b = document.querySelector(selectors[i][1]);
            if (!a || !b) continue;
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            const overlap = !(ra.right < rb.left || ra.left > rb.right || ra.bottom < rb.top || ra.top > rb.bottom);
            if (overlap) {
              if (!flagged) {
                pushEvent("layout", `overlap:${selectors[i][0]}~${selectors[i][1]}`, false, 0.06, "DOM overlap detected");
                flagged = true;
              }
            }
          }
        } catch (e) {
          // ignore
        }
      }, 800);
    },
    // ---------- Postflight (出口監査) ----------
    async postflight(questions = []) {
      // Ask self-check questions & record as audit events (no prompt UI; purely log).
      questions.forEach(q => {
        // In a real system this could be a modal; here we log “asked”.
        pushEvent("audit", `post_q:${q.id || q}`, true, 0, q.text || String(q));
      });
      STATE.postflight.done = true;
      STATE.postflight.ok = true;
      STATE.postflight.notes.push(`questions:${questions.length}`);
      render();
      return true;
    },
    // ---------- Export ----------
    toJSON() {
      return {
        version: API.version,
        at: now(),
        weights: STATE.weights,
        scores: STATE.scores,
        overall: computeOverall(),
        preflight: STATE.preflight,
        postflight: STATE.postflight,
        events: STATE.events,
        warnings: STATE.warnings,
        errors: STATE.errors,
        elapsedMs: Math.round(performance.now() - STATE.startedAt),
      };
    },
    downloadJSON(filename = "walknav_audit.json") {
      const blob = new Blob([JSON.stringify(API.toJSON(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    // ---------- UI ----------
    openDetails() { STATE.detailsOpen = true; render(); },
    closeDetails() { STATE.detailsOpen = false; render(); },
  };

  // ---------- Error Hooks ----------
  window.addEventListener("error", (e) => {
    STATE.errors.push({ ts: now(), type: "error", message: String(e.message || e), stack: String(e.error?.stack || "") });
    pushEvent("api", "window_error", false, 0.04, e.message || "error");
  });
  window.addEventListener("unhandledrejection", (e) => {
    STATE.errors.push({ ts: now(), type: "unhandledrejection", message: String(e.reason || ""), stack: "" });
    pushEvent("api", "unhandled_rejection", false, 0.04, String(e.reason || ""));
  });

  // ---------- Badge UI ----------
  function render() {
    const overall = computeOverall();
    if (!STATE.badge) {
      STATE.badge = document.createElement("div");
      STATE.badge.id = "walknav-audit-badge";
      document.body.appendChild(STATE.badge);
    }
    STATE.badge.style.cssText = `
      position:fixed; right:12px; top:12px; z-index:99999;
      background:rgba(10,19,33,.9); color:#eaf2ff; border:1px solid rgba(255,255,255,.15);
      border-radius:14px; backdrop-filter:blur(6px); box-shadow:0 10px 30px rgba(0,0,0,.3);
      font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
      min-width:200px; max-width:380px; overflow:hidden;
    `;
    const header = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.12)">
        <div style="font-weight:700;letter-spacing:.3px">WalkNav Audit</div>
        <div style="margin-left:auto;font-variant-numeric:tabular-nums;font-size:22px;font-weight:800">${overall.toFixed(1)}%</div>
        <button id="wna-toggle" style="margin-left:8px;padding:6px 10px;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:transparent;color:inherit;cursor:pointer">
          ${STATE.detailsOpen ? "Close" : "Open"}
        </button>
      </div>
    `;
    const rows = Object.entries(STATE.scores).map(([k,v]) => {
      return `<div style="display:flex;justify-content:space-between;padding:6px 12px">
        <div style="opacity:.9">${k}</div>
        <div style="font-variant-numeric:tabular-nums">${(v*100).toFixed(1)}%</div>
      </div>`;
    }).join("");

    const events = STATE.events.slice(-6).reverse().map(ev =>
      `<div style="opacity:.9;font-size:12px;padding:3px 0">${ev.ts} • ${ev.kind}/${ev.name} • ${ev.ok ? "OK" : "NG"}${ev.note ? " • "+ev.note : ""}</div>`
    ).join("") || `<div style="opacity:.6;font-size:12px">No events yet</div>`;

    const warn = STATE.warnings.slice(-4).reverse().map(w =>
      `<div style="opacity:.9;font-size:12px;padding:3px 0">⚠ ${w.ts} • ${w.message}</div>`
    ).join("");

    const errs = STATE.errors.slice(-3).reverse().map(er =>
      `<div style="opacity:.9;font-size:12px;padding:3px 0">❗ ${er.ts} • ${er.type}: ${er.message}</div>`
    ).join("");

    const details = STATE.detailsOpen ? `
      <div style="padding:8px 12px">
        <div style="display:flex;gap:8px;margin:8px 0">
          <button id="wna-dl" style="padding:6px 10px;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:transparent;color:inherit;cursor:pointer">Export JSON</button>
          <button id="wna-post" style="padding:6px 10px;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:transparent;color:inherit;cursor:pointer">Postflight</button>
        </div>
        <div style="margin:6px 0;opacity:.8">Categories</div>
        ${rows}
        <div style="margin:8px 0;opacity:.8">Recent</div>
        <div>${events}</div>
        ${warn ? `<div style="margin:8px 0;opacity:.8">Warnings</div><div>${warn}</div>` : ""}
        ${errs ? `<div style="margin:8px 0;opacity:.8">Errors</div><div>${errs}</div>` : ""}
      </div>
    ` : "";

    STATE.badge.innerHTML = header + details;

    const tg = STATE.badge.querySelector("#wna-toggle");
    if (tg) tg.onclick = () => { STATE.detailsOpen = !STATE.detailsOpen; render(); };

    const dl = STATE.badge.querySelector("#wna-dl");
    if (dl) dl.onclick = () => API.downloadJSON();

    const pf = STATE.badge.querySelector("#wna-post");
    if (pf) pf.onclick = () => API.postflight([
      { id: "no-suppression", text: "Did we avoid suppressing incidents?" },
      { id: "no-design-drift", text: "Did we avoid unauthorized design drift?" },
      { id: "full-disclosure", text: "Did we fully disclose issues?" },
    ]);
  }

  // initial render
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }

  // expose
  window.WalkNavAudit = API;
})();
