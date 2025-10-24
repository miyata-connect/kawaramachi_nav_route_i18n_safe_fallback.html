"use strict";

let map, directionsService, directionsRenderer;
let currentPositionMarker = null, destinationMarker = null;
let watchId = null, isNavigating = false;
let currentHeading = null, hasLocationFix = false;

const PLACES_PROXY = "https://ors-proxy.miyata-connect-jp.workers.dev/places";
const TRAVEL_MODE = google.maps.TravelMode.WALKING;
const TOKYO = { lat: 35.681236, lng: 139.767125 };
const LS_LAST_LOC = "WALKNAV_LAST_LOCATION";

/* ========== 改良版 initMap ========== */
async function initMap() {
  showLoading(true);
  setStatus("位置情報を取得中…");

  // Google Maps APIロードを保証
  await new Promise(resolve => {
    if (window.google?.maps) return resolve();
    const check = setInterval(() => {
      if (window.google?.maps) { clearInterval(check); resolve(); }
    }, 100);
  });

  let here = readLastLocation() || TOKYO;

  try {
    const pos = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) reject(new Error("位置情報が利用できません。"));
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000 });
    });
    here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    hasLocationFix = true;
    saveLastLocation(here);
    setStatus("現在地を取得しました。");
  } catch (err) {
    showError("現在地取得失敗: " + err.message);
    const cached = readLastLocation();
    if (cached) {
      here = cached;
      setStatus("前回位置を表示中。");
    } else {
      setStatus("東京駅周辺を表示中。");
    }
  } finally {
    createMap(here);
    placeOrMoveCurrent(here);
    startLocationWatch();
    setupCompass();
    showLoading(false);
  }
}

/* ========== Map Factory ========== */
function createMap(center) {
  map = new google.maps.Map(document.getElementById("map"), {
    center,
    zoom: 16,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({ map });

  mountRightControls();
  bindUI();
}

/* ========== Right Controls ========== */
function mountRightControls(){
  const c = document.createElement("div");
  c.className = "gm-fab-col";

  const btnStart = mkBtn("案内開始", "ok", "gm-start-nav");
  const btnStop = mkBtn("案内を停止", "danger", "gm-stop-nav");
  const btnReroute = mkBtn("リルート", "reroute", "gm-reroute");

  const zooms = document.createElement("div");
  zooms.className = "zooms";
  zooms.append(mkBtn("＋","btn-zoom","gm-zoom-in"), mkBtn("－","btn-zoom","gm-zoom-out"));

  c.append(btnStart, btnStop, btnReroute, zooms);
  map.controls[google.maps.ControlPosition.RIGHT_CENTER].push(c);

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

/* ========== UI Events ========== */
function bindUI() {
  q("#searchBtn").onclick = searchPlace;
  q("#micBtn").onclick = initVoiceRecognition;
  q("#locBtn").onclick = relocalize;
  q("#searchBox").addEventListener("keydown", e => { if (e.key === "Enter") searchPlace(); });

  document.addEventListener("click", e=>{
    const id = e.target?.id || "";
    if (id === "gm-start-nav") startNav();
    else if (id === "gm-stop-nav") stopNav();
    else if (id === "gm-reroute") reroute(true);
    else if (id === "gm-zoom-in") map.setZoom(map.getZoom()+1);
    else if (id === "gm-zoom-out") map.setZoom(map.getZoom()-1);
  });
}

/* ========== 現在地再取得 ========== */
function relocalize(){
  setStatus("現在地を再取得中…");
  if (!navigator.geolocation) { showError("位置情報が利用できません。"); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      hasLocationFix = true;
      saveLastLocation(here);
      placeOrMoveCurrent(here);
      map.panTo(here);
      setStatus("現在地を更新しました。");
    },
    err => showError("現在地取得失敗: " + err.message),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

/* ========== 現在地追従 ========== */
function startLocationWatch(){
  if (!navigator.geolocation) return;
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    pos => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      hasLocationFix = true;
      saveLastLocation(here);
      placeOrMoveCurrent(here);
      if (isNavigating) reroute(false);
    },
    err => console.warn("watchPosition:", err.message),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

/* ========== マーカー ========== */
function placeOrMoveCurrent(latlng){
  if (currentPositionMarker) currentPositionMarker.setPosition(latlng);
  else {
    currentPositionMarker = new google.maps.Marker({
      position: latlng, map,
      icon:{ path:google.maps.SymbolPath.CIRCLE, scale:8, fillColor:"#5fb1ff", fillOpacity:1, strokeWeight:1 },
      title:"現在地",
    });
  }
}

/* ========== 検索 ========== */
async function searchPlace() {
  const qv = q("#searchBox").value.trim();
  if (!qv) return showError("検索ワードを入力してください。");
  if (!hasLocationFix && !currentPositionMarker) return showError("現在地の取得を待っています。");

  setStatus("検索中…");
  try {
    const pos = currentPositionMarker?.getPosition();
    const payload = {
      textQuery: qv,
      locationBias: pos ? { circle: { center: { latitude: pos.lat(), longitude: pos.lng() }, radius: 20000 } } : undefined,
    };

    const res = await fetch(PLACES_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-FieldMask": "places.displayName,places.location" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const place = data?.places?.[0];
    if (!place) return showError("該当する地点が見つかりません。");

    const lat = place.location?.latitude, lng = place.location?.longitude;
    const name = place.displayName?.text || qv;
    if (destinationMarker) destinationMarker.setMap(null);
    destinationMarker = new google.maps.Marker({ position:{lat,lng}, map, title:name });
    map.panTo({ lat,lng });
    setStatus(`検索完了: ${name}`);
  } catch (e) {
    console.error(e);
    showError("検索エラーが発生しました。");
  }
}

/* ========== 経路案内 ========== */
function startNav(){
  if (!currentPositionMarker || !destinationMarker)
    return showError("現在地または目的地が未設定です。");
  const origin=currentPositionMarker.getPosition(), dest=destinationMarker.getPosition();
  setStatus("経路計算中…");
  directionsService.route({ origin, destination:dest, travelMode:TRAVEL_MODE },
    (res,status)=>{
      if (status!=="OK") return showError("経路を取得できません。");
      directionsRenderer.setDirections(res);
      isNavigating=true;
      speak("案内を開始します。");
      setStatus("案内中");
    });
}
function stopNav(){
  directionsRenderer.setDirections({ routes:[] });
  isNavigating=false;
  speak("案内を終了します。");
  setStatus("案内を停止しました。");
}
function reroute(manual){
  if (!isNavigating) { if (manual) showError("案内が開始されていません。"); return; }
  const origin=currentPositionMarker.getPosition(), dest=destinationMarker.getPosition();
  directionsService.route({ origin, destination:dest, travelMode:TRAVEL_MODE },
    (res,status)=>{
      if (status!=="OK") return showError("リルートに失敗しました。");
      directionsRenderer.setDirections(res);
      if (manual) speak("リルートしました。");
      setStatus("案内更新中");
    });
}

/* ========== コンパス ========== */
let compassAlpha=0, targetAlpha=0;
function setupCompass(){
  const needle=document.querySelector(".needle");
  if(!needle) return;
  function animate(){
    compassAlpha=compassAlpha*0.8+targetAlpha*0.2;
    needle.style.transform=`rotate(${compassAlpha}deg)`;
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  const useAlpha=a=>{ if(typeof a==="number") targetAlpha=a; };
  if(typeof DeviceOrientationEvent!=="undefined"){
    window.addEventListener("deviceorientation",e=>{ if(typeof e.alpha==="number") useAlpha(e.alpha); });
  }
}

/* ========== ユーティリティ ========== */
function q(s){ return document.querySelector(s); }
function setStatus(s){ const el=q("#status"); if(el) el.textContent=s||""; }
function showError(msg){
  const b=q("#error-banner"), t=q("#error-text");
  if(t) t.textContent=msg;
  if(b){ b.classList.remove("hidden"); setTimeout(()=>b.classList.add("hidden"),4000); }
  speak(msg);
}
function speak(t){ try{ const u=new SpeechSynthesisUtterance(t); u.lang="ja-JP"; speechSynthesis.speak(u);}catch{} }
function showLoading(show){
  const el=document.getElementById("loading");
  if(!el) return;
  if(show){ el.classList.remove("hide"); el.style.display="flex"; }
  else { el.classList.add("hide"); setTimeout(()=>el.style.display="none",400); }
}
function saveLastLocation(latlng){ try{ localStorage.setItem(LS_LAST_LOC, JSON.stringify(latlng)); }catch{} }
function readLastLocation(){ try{ const s=localStorage.getItem(LS_LAST_LOC); if(!s) return null; const v=JSON.parse(s); if(typeof v?.lat==="number"&&typeof v?.lng==="number") return v; }catch{} return null; }

window.addEventListener("load", initMap);
