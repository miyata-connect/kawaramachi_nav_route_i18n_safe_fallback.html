// ===========================
// WalkNav app.js（現在地=東京固定を解消）
// 変更点：マップ生成前に現在地を取得→取得成功座標で初期化
// ・initMap() で先に geolocation を実行し、成功座標で createMap() を呼ぶ
// ・失敗時はエラーバナー表示＋キャッシュ座標（なければ東京）で初期化
// ・ローディングは成功/失敗いずれでも createMap 後に明示的に閉じる
// ===========================

"use strict";

/* Globals */
let map, directionsService, directionsRenderer;
let currentPositionMarker = null, destinationMarker = null;
let watchId = null, isNavigating = false;
let recognition = null, recognizing = false;
let currentHeading = null;

let hasLocationFix = false;

const PLACES_PROXY = "https://ors-proxy.miyata-connect-jp.workers.dev/places";
const TRAVEL_MODE = google.maps.TravelMode.WALKING;
const TOKYO = { lat: 35.681236, lng: 139.767125 };
const LS_LAST_LOC = "WALKNAV_LAST_LOCATION";

/* ========== Boot ========== */
function initMap() {
  // ローディング文面（三行）
  const sub = document.querySelector(".loading-sub");
  if (sub) sub.textContent = "データ通信料削減のため、\n現在地地図表示まで、\nもう少しだけお待ちください...";

  showLoading(true);

  // 先に現在地取得 → 成功座標で地図生成
  if (!navigator.geolocation) {
    showError("位置情報が利用できません。");
    const cached = readLastLocation();
    createMap(cached || TOKYO);
    showLoading(false);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      hasLocationFix = true;
      saveLastLocation(here);
      createMap(here);
      placeOrMoveCurrent(here);
      showLoading(false);
      setStatus("現在地を更新しました。");
      startLocationWatch();
      setupCompass();
    },
    err => {
      showError("現在地取得失敗: " + err.message);
      const cached = readLastLocation();
      // 失敗時：キャッシュ座標→なければ東京
      createMap(cached || TOKYO);
      if (cached) {
        placeOrMoveCurrent(cached);
        setStatus("前回位置を表示中。");
      }
      showLoading(false);
      startLocationWatch();
      setupCompass();
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

/* ========== Map factory (一度だけ呼ぶ) ========== */
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

  // 音声認識非対応警告
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) showError("このブラウザは音声認識に対応していません。最新の Chrome などをご利用ください。");
}

/* ========== Controls on RIGHT_CENTER ========== */
let ctrlContainer;
function mountRightControls(){
  ctrlContainer = document.createElement("div");
  ctrlContainer.className = "gm-fab-col";

  const btnStart = document.createElement("button");
  btnStart.className = "btn-wide ok";
  btnStart.id = "gm-start-nav";
  btnStart.textContent = "案内開始";

  const btnStop = document.createElement("button");
  btnStop.className = "btn-wide danger";
  btnStop.id = "gm-stop-nav";
  btnStop.textContent = "案内を停止";

  const btnReroute = document.createElement("button");
  btnReroute.className = "btn-wide reroute";
  btnReroute.id = "gm-reroute";
  btnReroute.textContent = "リルート";

  const zooms = document.createElement("div");
  zooms.className = "zooms";
  const zIn = document.createElement("button");
  zIn.className = "btn-zoom";
  zIn.id = "gm-zoom-in";
  zIn.textContent = "＋";
  const zOut = document.createElement("button");
  zOut.className = "btn-zoom";
  zOut.id = "gm-zoom-out";
  zOut.textContent = "－";
  zooms.append(zIn, zOut);

  ctrlContainer.append(btnStart, btnStop, btnReroute, zooms);
  map.controls[google.maps.ControlPosition.RIGHT_CENTER].push(ctrlContainer);

  // パネル可視時は右列非表示（干渉回避）
  const gb = q("#glassbar");
  const toggle = ()=> {
    const visible = gb && getComputedStyle(gb).display !== "none";
    if (ctrlContainer) ctrlContainer.style.display = visible ? "none" : "";
  };
  new MutationObserver(toggle).observe(document.body, { attributes:true, childList:true, subtree:true });
  addEventListener("resize", toggle);
  setTimeout(toggle, 100);
}

/* ========== UI binding ========== */
function bindUI() {
  q("#searchBtn").onclick = searchPlace;
  q("#micBtn").onclick = initVoiceRecognition;
  q("#locBtn").onclick = relocalize;
  q("#searchBox").addEventListener("keydown", e => { if (e.key === "Enter") searchPlace(); });

  // Right controls
  document.addEventListener("click", (e)=>{
    const id = (e.target && e.target.id) || "";
    if (id === "gm-start-nav") startNav();
    else if (id === "gm-stop-nav") stopNav();
    else if (id === "gm-reroute") reroute(true);
    else if (id === "gm-zoom-in") map.setZoom(map.getZoom()+1);
    else if (id === "gm-zoom-out") map.setZoom(map.getZoom()-1);
  });
}

/* ========== Relocalize (手動現在地更新) ========== */
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
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

/* ========== Watch (追従) ========== */
function startLocationWatch() {
  if (!navigator.geolocation) return;
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    pos => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      hasLocationFix = true;
      saveLastLocation(here);
      placeOrMoveCurrent(here);
      if (typeof pos.coords.heading === "number") currentHeading = pos.coords.heading;
      if (isNavigating) reroute(false);
    },
    err => console.warn("watchPosition error:", err.message),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

/* ========== Markers ========== */
function placeOrMoveCurrent(latlng){
  if (currentPositionMarker) {
    currentPositionMarker.setPosition(latlng);
  } else {
    currentPositionMarker = new google.maps.Marker({
      position: latlng,
      map,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#5fb1ff", fillOpacity: 1, strokeWeight: 1 },
      title: "現在地",
    });
  }
}

/* ========== Search (Places via Worker) ========== */
async function searchPlace() {
  const qv = q("#searchBox").value.trim();
  if (!qv) return showError("検索ワードを入力してください。");
  if (!hasLocationFix && !currentPositionMarker) return showError("現在地の取得を待っています。少しお待ちください。");

  setStatus("検索中…");
  try {
    const pos = currentPositionMarker?.getPosition();
    const payload = {
      textQuery: qv,
      locationBias: pos ? { circle: { center: { latitude: pos.lat(), longitude: pos.lng() }, radius: 20000 } } : undefined,
    };

    const res = await fetch(PLACES_PROXY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask": "places.displayName,places.location"
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn("Places not OK:", res.status, await res.text().catch(()=> ""));
      showError("検索エラーが発生しました。");
      setStatus("");
      return;
    }

    const data = await res.json().catch(()=> ({}));
    const places = data?.places || [];
    if (!places.length) {
      setStatus("");
      showError("該当する地点が見つかりませんでした。");
      return;
    }

    const p = places[0];
    const lat = p.location?.latitude, lng = p.location?.longitude;
    const name = p.displayName?.text || qv;
    if (typeof lat !== "number" || typeof lng !== "number") {
      showError("検索結果の位置情報を取得できません。");
      setStatus("");
      return;
    }

    if (destinationMarker) destinationMarker.setMap(null);
    destinationMarker = new google.maps.Marker({ position: { lat, lng }, map, title: name });
    map.panTo({ lat, lng });
    setStatus(`検索完了: ${name}`);
  } catch (e) {
    console.error(e);
    showError("検索エラーが発生しました。");
    setStatus("");
  }
}

/* ========== Directions ========== */
function startNav() {
  if (!currentPositionMarker || !destinationMarker)
    return showError("現在地または目的地が未設定です。");

  const origin = currentPositionMarker.getPosition();
  const dest = destinationMarker.getPosition();
  setStatus("経路計算中…");

  directionsService.route(
    { origin, destination: dest, travelMode: TRAVEL_MODE, provideRouteAlternatives: true },
    (res, status) => {
      if (status !== "OK") return showError("経路を取得できません。");
      directionsRenderer.setDirections(res);
      isNavigating = true;
      speak("案内を開始します。");
      setStatus("案内中");
    }
  );
}

function stopNav() {
  directionsRenderer.setDirections({ routes: [] });
  isNavigating = false;
  speak("案内を終了します。");
  setStatus("案内を停止しました。");
}

function reroute(manual) {
  if (!isNavigating) { if (manual) showError("案内が開始されていません。"); return; }
  if (!currentPositionMarker || !destinationMarker) return;
  const origin = currentPositionMarker.getPosition();
  const dest = destinationMarker.getPosition();
  directionsService.route(
    { origin, destination: dest, travelMode: TRAVEL_MODE, provideRouteAlternatives: true },
    (res, status) => {
      if (status !== "OK") return showError("リルートに失敗しました。");
      directionsRenderer.setDirections(res);
      if (manual) speak("リルートしました。");
      setStatus("案内更新中");
    }
  );
}

/* ========== Compass (smoothing + fallback) ========== */
let compassAlpha = 0, targetAlpha = 0, rAFId = null;
function setupCompass() {
  const needle = document.querySelector(".needle");
  if (!needle) return;

  function animate(){
    compassAlpha = compassAlpha * 0.8 + targetAlpha * 0.2;
    needle.style.transform = `rotate(${compassAlpha}deg)`;
    rAFId = requestAnimationFrame(animate);
  }
  rAFId = requestAnimationFrame(animate);

  const useAlpha = (a)=> { if (typeof a === "number") targetAlpha = a; };

  if (typeof DeviceOrientationEvent !== "undefined") {
    const handler = (e)=> { if (e && typeof e.alpha === "number") useAlpha(e.alpha); };
    window.addEventListener("deviceorientation", handler, { capture:false });
  }
  setInterval(()=>{ if (typeof currentHeading === "number") useAlpha(currentHeading); }, 300);
}

/* ========== Helpers ========== */
function q(sel){ return document.querySelector(sel); }
function setStatus(s){ const el=q("#status"); if(el) el.textContent=s||""; }
function showError(msg){
  const b=q("#error-banner"), t=q("#error-text");
  if(t) t.textContent=msg;
  if(b){ b.classList.remove("hidden"); setTimeout(()=>b.classList.add("hidden"),4000); }
  speak(msg);
}
function speak(t){ try{ const u=new SpeechSynthesisUtterance(t); u.lang="ja-JP"; u.rate=0.88; speechSynthesis.speak(u);}catch{} }
function showLoading(show){
  const el=document.getElementById("loading");
  if(!el) return;
  if(show){ el.classList.remove("hide"); el.style.display="flex"; }
  else { el.classList.add("hide"); setTimeout(()=>{ el.style.display="none"; }, 400); }
}
function saveLastLocation(latlng){
  try{ localStorage.setItem(LS_LAST_LOC, JSON.stringify(latlng)); }catch{}
}
function readLastLocation(){
  try{
    const s = localStorage.getItem(LS_LAST_LOC);
    if (!s) return null;
    const v = JSON.parse(s);
    if (typeof v?.lat === "number" && typeof v?.lng === "number") return v;
  }catch{}
  return null;
}

window.initMap = initMap;
