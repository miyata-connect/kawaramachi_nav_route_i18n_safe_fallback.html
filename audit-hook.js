/* ISSUE: aud202511012306 */
/* File: audit-hook.js - Minimal client hooks for WalkNav -> Cloudflare Worker audit API (JST) */

export const ISSUE_ID = "aud202511012306";

const Audit = (() => {
  const state = {
    endpoint: "",
    orderId: "",
    issueTag: ISSUE_ID,
    buffer: [],
    flushTimer: null,
    flushIntervalMs: 5000,
    enabled: true,
  };

  function setEndpoint(url){ state.endpoint = String(url||"").replace(/\/+$/,""); }
  function setOrder(orderId){ state.orderId = String(orderId||""); }
  function setIssueTag(tag){ if(tag) state.issueTag = String(tag); }
  function now(){ return Date.now(); }

  async function post(path, payload){
    if(!state.enabled || !state.endpoint) return;
    try{
      const r = await fetch(`${state.endpoint}${path}`,{
        method: "POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      // Non-2xx silently ignored but queued is not required here
      return r.ok;
    }catch(_){ return false; }
  }

  function pushRun(partial){
    const base = {
      ts: now(),
      phase: partial?.phase || "-",
      score: Number(partial?.score ?? 0),
      errorRate: Number(partial?.errorRate ?? 0),
      entry: Number(partial?.entry ?? 0),
      run: Number(partial?.run ?? 0),
      exit: Number(partial?.exit ?? 0),
      orderId: state.orderId,
      issue: state.issueTag,
      meta: partial?.meta || {}
    };
    state.buffer.push({kind:"run", data: base});
    schedule();
  }

  function pushEvent(evt){
    const base = {
      ts: now(),
      type: String(evt?.type||"event"),
      severity: String(evt?.severity||"info"),
      title: String(evt?.title||""),
      message: String(evt?.message||""),
      issue: state.issueTag,
      orderId: state.orderId,
      meta: evt?.meta || {}
    };
    state.buffer.push({kind:"event", data: base});
    schedule();
  }

  function schedule(){
    if(state.flushTimer) return;
    state.flushTimer = setTimeout(flush, state.flushIntervalMs);
  }

  async function flush(){
    clearTimeout(state.flushTimer); state.flushTimer = null;
    const items = state.buffer.splice(0);
    if(!items.length || !state.endpoint) return;

    const runs = items.filter(x=>x.kind==="run").map(x=>x.data);
    const events = items.filter(x=>x.kind==="event").map(x=>x.data);

    if(runs.length){
      await post("/audit/run", runs[runs.length-1]); // latest only
    }
    if(events.length){
      for(const e of events.slice(-25)){
        await post("/audit/event", e);
      }
    }
  }

  // public api
  return {
    setEndpoint, setOrder, setIssueTag,
    run: pushRun,
    event: pushEvent,
    flush,
  };
})();

export default Audit;