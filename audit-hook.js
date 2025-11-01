/* ISSUE: aud202511012212 */
/* File: audit-hook.js - Minimal client hooks for WalkNav -> Cloudflare Worker audit API */
export const ISSUE_ID = "aud202511012212";

const Audit = (()=>{
  const state = {
    endpoint: "",
    orderId: "",
    issueTag: ISSUE_ID,
    flushTimer: null,
    flushIntervalMs: 5000,
    enabled: true,
    buffer: [],
    phase: "idle"
  };

  function setEndpoint(url){ state.endpoint = String(url||"").replace(/\/+$/,""); }
  function setOrder(orderId){ state.orderId = String(orderId||""); }
  function setPhase(phase){ state.phase = String(phase||""); }
  function now(){ return Date.now(); }

  function push(kind, data){
    if(!state.enabled) return;
    state.buffer.push({ts:now(), kind, phase:state.phase, ...data});
    arm();
  }
  function arm(){
    if(state.flushTimer) return;
    state.flushTimer = setTimeout(flush, state.flushIntervalMs);
  }
  async function flush(){
    clearTimeout(state.flushTimer); state.flushTimer=null;
    if(!state.buffer.length || !state.endpoint) return;
    const payload = state.buffer.splice(0, state.buffer.length);
    try{
      await fetch(state.endpoint+"/audit/event",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({orderId:state.orderId, issue:state.issueTag, events:payload})
      });
    }catch(_e){ /* swallow */ }
  }

  async function run(score, errorRate){
    if(!state.endpoint) return;
    try{
      await fetch(state.endpoint+"/audit/run",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({score, errorRate, phase:state.phase, meta:{orderId:state.orderId, issue:state.issueTag}})
      });
    }catch(_e){ /* swallow */ }
  }

  return { setEndpoint, setOrder, setPhase, push, flush, run };
})();

export default Audit;