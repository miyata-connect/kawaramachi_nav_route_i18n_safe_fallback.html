/* ISSUE: aud202511011958 */
/* File: audit-hook.js - Minimal client hooks for WalkNav -> Cloudflare Worker audit API */

export const ISSUE_ID = "aud202511011958";

const Audit = (() => {
  const state = {
    endpoint: "",
    orderId: "",
    issueTag: ISSUE_ID,
    buffer: [],
    runErrors: 0,
    runOps: 0,
    flushTimer: null,
    flushIntervalMs: 5000,
    enabled: true,
  };

  function setEndpoint(url){ state.endpoint = String(url || "").replace(/\/+$/, ""); }
  function setOrder(orderId){ state.orderId = String(orderId||""); }
  function setIssueTag(tag){ if(tag) state.issueTag = String(tag); }

  function now(){ return Date.now(); }

  function safeMeta(extra={}){
    return {
      orderId: state.orderId || undefined,
      issue: state.issueTag,
      ...extra,
    };
  }

  function sendBeaconJSON(url, obj){
    try{
      const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
      if (navigator.sendBeacon && navigator.sendBeacon(url, blob)) return Promise.resolve(true);
    }catch{}
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj), keepalive: true })
      .then(()=>true).catch(()=>false);
  }

  function queue(kind, payload){
    if(!state.enabled || !state.endpoint) return;
    state.buffer.push({ kind, payload, ts: now() });
    scheduleFlush();
  }

  function scheduleFlush(){
    if(state.flushTimer) return;
    state.flushTimer = setTimeout(async ()=>{
      state.flushTimer = null;
      await flush();
    }, state.flushIntervalMs);
  }

  async function flush(){
    if(!state.enabled || !state.endpoint) return;
    if(!state.buffer.length) return;
    const batch = state.buffer.splice(0, state.buffer.length);
    for(const item of batch){
      if(item.kind === "event"){
        await sendBeaconJSON(`${state.endpoint}/audit/event`, item.payload);
      }else if(item.kind === "run"){
        await sendBeaconJSON(`${state.endpoint}/audit/run`, item.payload);
      }
    }
  }

  /* ---------------- Public API ---------------- */

  function init({ endpoint, orderId, issue }){
    setEndpoint(endpoint);
    setOrder(orderId);
    setIssueTag(issue || ISSUE_ID);
    // safety: flush before unload
    window.addEventListener("pagehide", ()=>flush(), { capture: true });
    window.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="hidden") flush(); });
  }

  /** Entry self-check (auto) */
  function autoEntry({ uiLang = "ja", advancedMarkerRequired = true } = {}){
    const isHttps = location.protocol === "https:";
    const hasAdvMarker = !!(window.google && google.maps && google.maps.marker && google.maps.marker.AdvancedMarkerElement);
    const uiOk = (uiLang === "ja");

    const penalties = {
      nonHttps: isHttps ? 0 : 1,
      noAdvancedMarker: advancedMarkerRequired && !hasAdvMarker ? 1 : 0,
      uiLanguageWrong: uiOk ? 0 : 1,
    };

    const payload = {
      phase: "entry",
      id: crypto.randomUUID(),
      ts: now(),
      errorRate: 0,
      penalties,
      extra: safeMeta({ uiLang, isHttps, hasAdvMarker })
    };
    queue("run", payload);
  }

  /** Mark one successful operation during run phase (search, directions, etc.) */
  function markOp(){ state.runOps++; scheduleRun(); }

  /** Mark one error during run phase */
  function markError(tag){
    state.runErrors++;
    queue("event", {
      id: crypto.randomUUID(),
      ts: now(),
      kind: "error",
      message: tag || "runtime error",
      meta: safeMeta({ tag })
    });
    scheduleRun();
  }

  let runDebounce = null;
  function scheduleRun(){
    if(runDebounce) return;
    runDebounce = setTimeout(()=>{ runDebounce = null; pushRun(); }, 1000);
  }

  function pushRun(){
    const total = Math.max(1, state.runOps);
    const errRate = Math.round((state.runErrors / total) * 100);
    const payload = {
      phase: "run",
      id: crypto.randomUUID(),
      ts: now(),
      errorRate: errRate,
      penalties: {},
      extra: safeMeta({ runOps: state.runOps, runErrors: state.runErrors })
    };
    queue("run", payload);
  }

  /** Exit report with final penalties/notes */
  function exit({ penalties = {}, ok = true } = {}){
    const total = Math.max(1, state.runOps);
    const errRate = Math.round((state.runErrors / total) * 100);
    const payload = {
      phase: "exit",
      id: crypto.randomUUID(),
      ts: now(),
      errorRate: errRate,
      penalties,
      extra: safeMeta({ ok, runOps: state.runOps, runErrors: state.runErrors })
    };
    queue("run", payload);
  }

  /** Free-form event (info/warn/error) */
  function event(kind, message, meta){
    queue("event", {
      id: crypto.randomUUID(),
      ts: now(),
      kind: kind || "info",
      message: message || "",
      meta: safeMeta(meta || {})
    });
  }

  /** Helpers for wrapping async ops to auto-mark */
  async function wrap(op, { tag } = {}){
    try{
      const r = await op();
      markOp();
      return r;
    }catch(e){
      markError(tag || (e && e.message));
      throw e;
    }
  }

  return {
    init, autoEntry, markOp, markError, exit, event, wrap,
    flush,
    _state: state, // for diagnostics if needed
  };
})();

/* ---------- Optional glue for Places/Directions calls ---------- */
/* Call these wrappers from your app, or ignore and call Audit.markOp()/markError() manually. */
export async function placesSearch(endpoint, body){
  const url = `${endpoint.replace(/\/+$/,"")}/places:searchText`;
  return Audit.wrap(async ()=>{
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if(!r.ok) { throw new Error(`places ${r.status}`); }
    return r.json();
  }, { tag: "places" });
}

export async function directions(endpoint, params){
  const url = new URL(`${endpoint.replace(/\/+$/,"")}/directions`);
  Object.entries(params || {}).forEach(([k,v])=> url.searchParams.set(k, v));
  return Audit.wrap(async ()=>{
    const r = await fetch(url.toString());
    if(!r.ok){ throw new Error(`directions ${r.status}`); }
    return r.json();
  }, { tag: "directions" });
}

export default Audit;
