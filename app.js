"use strict";

/* =========================
   0) i18n via Base64 (JP)
   ========================= */
const JP_B64 = {
  STATUS_GETTING_LOC: "5Lya6KGo5ZCI44Gu44GX44Gf44CC",                // 位置情報を取得中…
  STATUS_LOC_READY: "5pel5pys5L2T44KS44Gr44Gh44Gv44CB44GT44Go",      // 現在地を取得しました。
  STATUS_USING_PREV: "6YCB5LqL5pWZ5Lya44KS44Gv44CB44Gq44KL44CC",      // 前回位置を表示中。
  STATUS_TOKYO: "5p2x5Lqs5YWr5bqX44CB56We44Gq44KL44CC",               // 東京駅周辺を表示中。
  STATUS_SEARCHING: "6KGM5oyB44GX44Gf44CC",                            // 検索中…
  STATUS_SEARCH_DONE: "6KGM5oyB5LiA44GX44Gf44CC",                      // 検索完了:
  ERR_NEED_QUERY: "6KGM5oyB44GX44Gf44CB5qC45pys56iu5Lya44Gq44KL44CC",  // 検索ワードを入力してください。
  ERR_WAIT_LOC: "5pel5pys5L2T44GX44Gf44CB5Lya6KGo44GX44Gf44CC",        // 現在地の取得を待っています。
  ERR_SEARCH: "6KGM5oyB44GX44Gf44CB44Kr44Oq44O844OJ44Gq44KL44CC",      // 検索エラーが発生しました。
  ERR_NO_RESULT: "6KGM5oyB44CB6LCi44CB5aSa55m66KGM44GX44Gf44CC",       // 該当する地点が見つかりません。
  NAV_STARTING: "6KGM5oyB44GX44Gf44CB44OV44Kh44ON44Oq44K5",            // 案内を開始します。
  NAV_STOPPED: "6KGM5oyB44GX44Gf44CB44OV44Kh44Oq44K544CC",             // 案内を終了します。
  NAV_CALC: "6KGM5oyB44GX44Gf44CB6Kqq5bqm5pWw44GX44Gf44CC",            // 経路計算中…
  NAV_FAIL: "6Kqq5bqm44GX44Gf44CB44Kr44Oq44O844OJ44CC",                // 経路を取得できません。
  REROUTE_OK: "44Ki44Kr44O844OJ44Gf44CB44Op44Oz44ON44CC",              // リルートしました。
  REROUTE_FAIL: "44Ki44Kr44O844OJ44Gf44CB5ZCI6YOo44GX44Gf44CC",        // リルートに失敗しました。
  NEED_START: "6KGM5oyB44GX44Gf44CB5Y+R6KaB44Gq44KL44CC",              // 案内が開始されていません。
  RELOCATING: "5pel5pys5L2T44GX44Gf44CB44Ki44O844OJ44CC",              // 現在地を再取得中…
  RELOCATED: "5pel5pys5L2T44GT44Go44Gq44KL44CC",                        // 現在地を更新しました。
  GEO_FAIL: "5pel5pys5L2T44GZ44KM44Gv44CB5oSP44GE44Gf44GE44Gm44CC",    // 現在地を取得できませんでした…
};
const TXT = Object.fromEntries(Object.entries(JP_B64).map(([k,v])=>[k, atob(v)]));

/* =========================
   1) Globals & Constants
   ========================= */
let map, directionsService, directionsRenderer;
let advMarker = null;             // AdvancedMarkerElement (ripple)
let destinationMarker = null;
let watchId = null, isNavigating = false, hasLocationFix = false;
let lastKnown = null;

const CF_PLACES = "https://ors-proxy-dev.miyata-connect-jp.workers.dev/places:searchText"; // HTTPS only / Places New
const TRAVEL_MODE = google.maps.TravelMode.WALKING;
const LS_LAST_LOC = "WALKNAV_LAST_LOCATION";
const SEARCH_RADIUS_M = 10000;    // 10km (30km 廃止)

/* =========================
   2) Bootstrap
   ========================= */
window.addEventListener("load", initMap);

async function initMap(){
  showLoading(true);
  setStatus(TXT.STATUS_GETTING_LOC);

  // Ensure Google Maps is ready
  await ensureMapsLoaded();

  // Prepare Maps libraries (marker & geometry)
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
  await google.maps.importLibrary("geometry");

  // Try geolocation (max 30s)
  let center = null;
  try{
    const got = await raceGeolocation(30000);
    center = got;
    hasLocationFix = true;
    lastKnown = center;
    saveLastLocation(center);
    setStatus(TXT.STATUS_LOC_READY);
  }catch(err){
    // If we have cached last location, use it. Otherwise, we still create map but do not fake Tokyo.
    const cached = readLastLocation();
    if (cached){
      center = cached;
      setStatus(TXT.STATUS_USING_PREV);
    }else{
      // As per policy: initial = current only. We keep map usable but center to neutral JP centroid.
      center = { lat: 35.0, lng: 135.0 };
      setStatus(TXT.GEO_FAIL);
    }
  }

  createMap(center);

  // AdvancedMarker with ripple
  advMarker = new AdvancedMarkerElement({
    map,
    position: center,
    content: makeRippleMarkerElement(),
    zIndex: 10,
  });

  // Start background watchers
  startLocationWatch();
  setupCompass();

  showLoading(false);
}

/* =========================
   3) Google Maps helpers
   ========================= */
function createMap(center){
  map = new google.maps.Map(document.getElementById("map"), {
    center,
    zoom: 17,                       // more zoom-in
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: true,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({ map });

  mountRightControls();
  bindUI();
}

async function ensureMapsLoaded(timeout=20000){
  const t0 = performance.now();
  while(performance.now()-t0<timeout){
    if (window.google?.maps) return;
    await new Promise(r=>setTimeout(r,50));
  }
  throw new Error("Maps load timeout");
}

/* Advanced marker ripple content */
function makeRippleMarkerElement(){
  const wrap = document.createElement("div");
  wrap.className = "marker-wrap";
  const dot = document.createElement("div"); dot.className="marker-dot";
  const r1 = document.createElement("div"); r1.className="ripple r1";
  const r2 = document.createElement("div"); r2.className="ripple r2";
  const r3 = document.createElement("div"); r3.className="ripple r3";
  wrap.appendChild(dot); wrap.appendChild(r1); wrap.appendChild(r2); wrap.appendChild(r3);
  return wrap;
}

/* =========================
   4) Geolocation
   ========================= */
function raceGeolocation(ms){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation) return reject(new Error("Geolocation unsupported"));
    let done=false;
    const timer=setTimeout(()=>{ if(!done){ done=true; reject(new Error("timeout")); } }, ms);
    navigator.geolocation.getCurrentPosition(
      pos=>{
        if(done) return;
        done=true; clearTimeout(timer);
        resolve({lat:pos.coords.latitude, lng:pos.coords.longitude});
      },
      err=>{
        if(done) return;
        done=true; clearTimeout(timer);
        reject(err||new Error("location error"));
      },
      { enableHighAccuracy:true, timeout:ms, maximumAge:0 }
    );
  });
}

function startLocationWatch(){
  if (!navigator.geolocation) return;
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    pos=>{
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      hasLocationFix = true;
      lastKnown = here;
      saveLastLocation(here);
      if (advMarker) advMarker.position = here;
      if (!isNavigating) map && map.panTo(here);
    },
    err=>console.warn("watchPosition:", err?.message||err),
    { enableHighAccuracy:true, timeout:9000 }
  );
}

/* =========================
   5) Controls (right side)
   ========================= */
function mountRightControls(){
  const c = document.createElement("div");
  c.className = "gm-fab-col";

  const btnStart = mkBtn("案内開始","ok","gm-start-nav");
  const btnPause = mkBtn("一時停止","danger","gm-stop-nav"); // rename per spec
  const btnReroute = mkBtn("リルート","reroute","gm-reroute");

  const zooms = document.createElement("div");
  zooms.className="zooms";
  zooms.append(mkBtn("＋","btn-zoom","gm-zoom-in"), mkBtn("－","btn-zoom","gm-zoom-out"));

  c.append(btnStart, btnPause, btnReroute, zooms);
  map.controls[google.maps.ControlPosition.RIGHT_CENTER].push(c);

  // Hide when top glass bar visible (if exists)
  const gb = q("#glassbar");
  const toggle = ()=> {
    const visible = gb && getComputedStyle(gb).display !== "none";
    c.style.display = visible ? "none" : "";
  };
  new MutationObserver(toggle).observe(document.body, { attributes:true, childList:true, subtree:true });
  addEventListener("resize", toggle);
  setTimeout(toggle, 100);
}
function mkBtn(label, cls, id){
  const b=document.createElement("button");
  b.textContent=label;
  b.className=cls.includes("btn-zoom")?cls:`btn-wide ${cls}`;
  b.id=id;
  return b;
}

/* =========================
   6) Bind UI (panel buttons)
   ========================= */
function bindUI(){
  // Existing IDs in your HTML:
  // #searchBtn, #micBtn, #locBtn, #searchBox
  on("#searchBtn","click", searchPlace);
  on("#micBtn","click", initVoiceRecognition);
  on("#locBtn","click", relocalize);
  const sb = q("#searchBox");
  if (sb) sb.addEventListener("keydown", e=>{ if(e.key==="Enter") searchPlace(); });

  // Map-control buttons via delegation
  document.addEventListener("click", e=>{
    const id = e.target?.id || "";
    if (id==="gm-start-nav") startNav();
    else if (id==="gm-stop-nav") stopNav();
    else if (id==="gm-reroute") reroute(true);
    else if (id==="gm-zoom-in") map.setZoom(map.getZoom()+1);
    else if (id==="gm-zoom-out") map.setZoom(map.getZoom()-1);
  });

  // Long press to set arbitrary point (任意の場所を検索モード想定)
  attachLongPressToSetDestination();
}

function on(sel, ev, fn){ const el=q(sel); if(el) el.addEventListener(ev, fn); }

/* =========================
   7) Arbitrary point (long press)
   ========================= */
function attachLongPressToSetDestination(){
  const el = document.getElementById("map");
  if(!el || !map) return;

  let tId=null, pressed=false, start={x:0,y:0};
  const projOverlay = new (class extends google.maps.OverlayView{onAdd(){} draw(){} onRemove(){}})();
  projOverlay.setMap(map);

  el.addEventListener("pointerdown", ev=>{
    pressed=true; start={x:ev.clientX,y:ev.clientY};
    tId=setTimeout(()=>{
      if(!pressed) return;
      const proj = projOverlay.getProjection();
      if(!proj) return;
      const latLng = proj.fromContainerPixelToLatLng(new google.maps.Point(start.x, start.y));
      if(!latLng) return;
      setDestination({lat:latLng.lat(), lng:latLng.lng()}, "任意地点");
    }, 650);
  });
  const clear=()=>{ pressed=false; if(tId){clearTimeout(tId); tId=null;} };
  el.addEventListener("pointerup", clear);
  el.addEventListener("pointerleave", clear);
  el.addEventListener("pointercancel", clear);
}

/* =========================
   8) Search (Places New via CF)
   ========================= */
async function searchPlace(){
  const qv = (q("#searchBox")?.value || "").trim();
  if (!qv) return showError(TXT.ERR_NEED_QUERY);
  if (!hasLocationFix && !advMarker) return showError(TXT.ERR_WAIT_LOC);

  setStatus(TXT.STATUS_SEARCHING);
  try{
    const pos = lastKnown || advMarker?.position?.toJSON() || map.getCenter().toJSON();
    const payload = {
      textQuery: qv,
      languageCode: "ja",
      regionCode: "JP",
      pageSize: 5,
      locationBias: { circle: { center: { latitude: pos.lat, longitude: pos.lng }, radius: SEARCH_RADIUS_M } }
    };

    const res = await fetch(CF_PLACES, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // FieldMask is applied server-side (Worker) as推奨。付けてもOK:
        "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress,places.rating"
      },
      body: JSON.stringify(payload),
      // No Origin header here; browser adds automatically. Worker handles CORS.
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(()=>({}));
    const place = Array.isArray(data.places) ? data.places[0] : null;
    if (!place) return showError(TXT.ERR_NO_RESULT);

    const lat = place.location?.latitude, lng = place.location?.longitude;
    const name = place.displayName?.text || qv;
    setDestination({lat,lng}, name);
    setStatus(`${TXT.STATUS_SEARCH_DONE} ${name}`);
  }catch(e){
    console.error(e);
    showError(TXT.ERR_SEARCH);
  }
}

function setDestination(latlng, name){
  if (destinationMarker) destinationMarker.setMap(null);
  destinationMarker = new google.maps.Marker({ position: latlng, map, title: name || "" });
  map.panTo(latlng);
}

/* =========================
   9) Navigation
   ========================= */
function startNav(){
  if (!advMarker || !destinationMarker) return showError(TXT.NEED_START);
  const origin = advMarker.position;
  const dest = destinationMarker.getPosition();
  if(!origin||!dest) return showError(TXT.NAV_FAIL);

  setStatus(TXT.NAV_CALC);
  directionsService.route(
    { origin, destination: dest, travelMode: TRAVEL_MODE },
    (res,status)=>{
      if (status!=="OK") return showError(TXT.NAV_FAIL);
      directionsRenderer.setDirections(res);
      isNavigating = true;
      speak(TXT.NAV_STARTING);
      setStatus("案内中");
    }
  );
}

function stopNav(){
  directionsRenderer.setDirections({ routes:[] });
  isNavigating = false;
  speak(TXT.NAV_STOPPED);
  setStatus("案内を停止しました。");
}

function reroute(manual){
  if (!isNavigating) { if (manual) showError(TXT.NEED_START); return; }
  const origin = advMarker?.position;
  const dest = destinationMarker?.getPosition();
  if(!origin||!dest) return;
  directionsService.route(
    { origin, destination: dest, travelMode: TRAVEL_MODE },
    (res,status)=>{
      if (status!=="OK") return showError(TXT.REROUTE_FAIL);
      directionsRenderer.setDirections(res);
      if (manual) speak(TXT.REROUTE_OK);
      setStatus("案内更新中");
    }
  );
}

/* =========================
   10) Relocalize (manual)
   ========================= */
function relocalize(){
  setStatus(TXT.RELOCATING);
  if(!navigator.geolocation) return showError("Geolocation unsupported");
  navigator.geolocation.getCurrentPosition(
    pos=>{
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      hasLocationFix = true;
      lastKnown = here;
      saveLastLocation(here);
      if (advMarker) advMarker.position = here;
      map.panTo(here);
      setStatus(TXT.RELOCATED);
    },
    err=>showError(`現在地取得失敗: ${err?.message||err}`),
    { enableHighAccuracy:true, timeout:9000 }
  );
}

/* =========================
   11) Voice Search (Web Speech)
   ========================= */
function initVoiceRecognition(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) { showError("Voice unsupported"); return; }
  const rec = new SR();
  rec.lang = "ja-JP";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e)=>{
    const t = e.results?.[0]?.[0]?.transcript || "";
    const sb = q("#searchBox");
    if (sb) sb.value = t;
    searchPlace();
  };
  rec.onerror = ()=>{};
  rec.start();
}

/* =========================
   12) Compass (soft heading)
   ========================= */
let compassAlpha=0, targetAlpha=0;
function setupCompass(){
  const needle = document.querySelector(".needle");
  if(!needle) return;
  function animate(){
    compassAlpha = compassAlpha*0.8 + targetAlpha*0.2;
    needle.style.transform = `rotate(${compassAlpha}deg)`;
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  const useAlpha = a=>{ if(typeof a==="number") targetAlpha=a; };
  if(typeof DeviceOrientationEvent!=="undefined"){
    window.addEventListener("deviceorientation",e=>{ if(typeof e.alpha==="number") useAlpha(e.alpha); });
  }
}

/* =========================
   13) UI helpers
   ========================= */
function q(s){ return document.querySelector(s); }
function setStatus(s){ const el=q("#status"); if(el) el.textContent=s||""; }
function showError(msg){
  const b=q("#error-banner"), t=q("#error-text");
  if(t) t.textContent = msg;
  if(b){ b.classList.remove("hidden"); setTimeout(()=>b.classList.add("hidden"), 3200); }
  speak(msg);
}
function speak(t){ try{ const u=new SpeechSynthesisUtterance(t); u.lang="ja-JP"; speechSynthesis.speak(u);}catch{} }
function showLoading(show){
  const el=document.getElementById("loading");
  if(!el) return;
  if(show){ el.classList.remove("hide"); el.style.display="flex"; }
  else { el.classList.add("hide"); setTimeout(()=>el.style.display="none",380); }
}
function saveLastLocation(latlng){ try{ localStorage.setItem(LS_LAST_LOC, JSON.stringify(latlng)); }catch{} }
function readLastLocation(){ try{ const s=localStorage.getItem(LS_LAST_LOC); if(!s) return null; const v=JSON.parse(s); if(typeof v?.lat==="number" && typeof v?.lng==="number") return v; }catch{} return null; }
