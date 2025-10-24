"use strict";

let map, directionsService, directionsRenderer;
let currentPositionMarker = null;
let destinationMarker = null;
let watchId = null;
let isNavigating = false;

let recognition = null;
let recognizing = false;

const PLACES_PROXY = "https://ors-proxy.miyata-connect-jp.workers.dev/places";
const TRAVEL_MODE = google.maps.TravelMode.WALKING;

let gotInitialLocation = false;

// compass state
let compassAlpha = 0;
let targetAlpha = 0;
let lastHeadingFallback = null;

/* ========== init ========== */
function initMap() {
  showLoading(true);

  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 35.681236, lng: 139.767125 },
    zoom: 16,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({ map });

  bindUI();
  installRightControls();
  initCompass();
  locate();
  startLocationWatch();

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) showError("このブラウザは音声認識に対応していません。最新の Chrome などをご利用ください。");
}

/* ========== UI binding ========== */
function bindUI() {
  q("#searchBtn").onclick = searchPlace;
  q("#micBtn").onclick = initVoiceRecognition;
  q("#locBtn").onclick = locate;
  q("#searchBox").addEventListener("keydown", (e) => { if (e.key === "Enter") searchPlace(); });
}

/* ========== Right side controls in map.controls ========== */
let ctrlContainer = null;
function installRightControls() {
  // reuse existing buttons by cloning semantics but using control-specific styling
  ctrlContainer = document.createElement("div");
  ctrlContainer.className = "ctrl-col";

  const btnStart = makeCtrl("▶", ["ctrl-btn","ok"], () => startNav());
  const btnStop  = makeCtrl("■", ["ctrl-btn","danger"], () => stopNav());
  const btnRe    = makeCtrl("⟳", ["ctrl-btn","reroute"], () => reroute(true));
  const btnZp    = makeCtrl("+", ["ctrl-btn"], () => map.setZoom(map.getZoom()+1));
  const btnZm    = makeCtrl("−", ["ctrl-btn"], () => map.setZoom(map.getZoom()-1));

  ctrlContainer.append(btnStart, btnStop, btnRe, btnZp, btnZm);
  map.controls[google.maps.ControlPosition.RIGHT_CENTER].push(ctrlContainer);

  // hide when panel might overlap (optional if panel collapses): observe visibility if needed
  // default: keep visible; developer may toggle via add/remove 'ctrl-hidden' on ctrlContainer
}

/* helper */
function makeCtrl(text, classes, onClick){
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.className = classes.join(" ");
  b.addEventListener("click", (e)=>{ e.stopPropagation(); onClick(); });
  return b;
}

/* ========== Geolocation ========== */
function locate() {
  setStatus("現在地取得中…");
  if (!navigator.geolocation) {
    showError("位置情報が利用できません。");
    showLoading(false);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateCurrentMarker(latlng);
      map.setCenter(latlng);
      setStatus("現在地を更新しました。");
      gotInitialLocation = true;
      showLoading(false);
    },
    (err) => {
      showError("現在地取得失敗: " + err.message);
      showLoading(false);
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

function startLocationWatch() {
  if (!navigator.geolocation) return;
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateCurrentMarker(latlng);
      lastHeadingFallback = typeof pos.coords.heading === "number" ? pos.coords.heading : lastHeadingFallback;
      if (isNavigating) reroute(false);
    },
    (err) => showError("追従エラー: " + err.message),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

function updateCurrentMarker(latlng) {
  if (currentPositionMarker) currentPositionMarker.setPosition(latlng);
  else {
    currentPositionMarker = new google.maps.Marker({
      position: latlng,
      map,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#5fb1ff", fillOpacity: 1, strokeWeight: 1 },
      title: "現在地",
    });
  }
}

/* ========== Search (Places New via Worker) ========== */
async function searchPlace() {
  const qv = q("#searchBox").value.trim();
  if (!qv) return showError("検索ワードを入力してください。");

  // wait for initial location (up to 8s) to improve relevance & avoid premature errors
  if (!gotInitialLocation) {
    setStatus("現在地待機中…");
    try { await waitFor(() => gotInitialLocation, 8000); } catch { /* continue even if timeout */ }
  }

  setStatus("検索中…");

  try {
    const pos = currentPositionMarker?.getPosition();
    const body = {
      textQuery: qv,
      locationBias: pos ? { circle: { center: { latitude: pos.lat(), longitude: pos.lng() }, radius: 20000 } } : undefined
    };

    const res = await fetch(PLACES_PROXY, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask": "places.displayName,places.location"
      },
      body: JSON.stringify(body)
    });

    // Some Workers forward non-200 for ZERO_RESULTS; handle gracefully
    let data = null;
    try { data = await res.json(); } catch { /* ignore parse errors */ }

    if (!res.ok) {
      // if worker returns structured status, read it; otherwise generic
      if (data && data.status === "ZERO_RESULTS") {
        return showError("該当する地点が見つかりませんでした。");
      }
      return showError("検索エラーが発生しました。");
    }

    if (!data?.places?.length) {
      return showError("該当する地点が見つかりませんでした。");
    }

    const p = data.places[0];
    const lat = p.location?.latitude, lng = p.location?.longitude;
    const name = p.displayName?.text || qv;

    if (typeof lat !== "number" || typeof lng !== "number") {
      return showError("検索結果の位置情報を取得できません。");
    }

    if (destinationMarker) destinationMarker.setMap(null);
    destinationMarker = new google.maps.Marker({ position: { lat, lng }, map, title: name });
    map.setCenter({ lat, lng });
    setStatus(`検索完了: ${name}`);
  } catch (e) {
    showError("検索エラーが発生しました。");
  }
}

/* ========== Navigation ========== */
function startNav() {
  if (!currentPositionMarker || !destinationMarker)
    return showError("現在地または目的地が未設定です。");
  const origin = currentPositionMarker.getPosition();
  const dest = destinationMarker.getPosition();
  setStatus("経路計算中…");
  directionsService.route({ origin, destination: dest, travelMode: TRAVEL_MODE }, (res, status) => {
    if (status !== "OK") return showError("経路を取得できません。");
    directionsRenderer.setDirections(res);
    isNavigating = true;
    speak("案内を開始します。");
    setStatus("案内中");
  });
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
  directionsService.route({ origin, destination: dest, travelMode: TRAVEL_MODE }, (res, status) => {
    if (status !== "OK") return showError("リルートに失敗しました。");
    directionsRenderer.setDirections(res);
    if (manual) speak("リルートしました。");
    setStatus("案内更新中");
  });
}

/* ========== Voice ========== */
function initVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return showError("音声認識に対応していません。");
  if (recognizing && recognition) { recognition.stop(); return; }
  recognition = new SR();
  recognition.lang = "ja-JP";
  recognition.onstart = () => { recognizing = true; setStatus("音声入力中…"); q("#micBtn")?.classList.add("rec"); };
  recognition.onresult = (e) => { q("#searchBox").value = e.results[0][0].transcript; searchPlace(); };
  recognition.onerror = () => showError("音声入力に失敗しました。");
  recognition.onend = () => { recognizing = false; q("#micBtn")?.classList.remove("rec"); setStatus(""); };
  recognition.start();
}

/* ========== Error / Status / Loading ========== */
function showError(msg) {
  const b = q("#error-banner");
  const t = q("#error-text");
  if (t) t.textContent = msg;
  if (b) {
    b.classList.remove("hidden");
    setTimeout(()=>b.classList.add("hidden"), 4000);
  }
  speak(msg);
}

function setStatus(s) { const el = q("#status"); if (el) el.textContent = s; }

function speak(t) {
  try {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "ja-JP";
    u.rate = 0.88;
    speechSynthesis.speak(u);
  } catch {}
}

function showLoading(show){
  const el = document.getElementById("loading");
  if (!el) return;
  if (show){ el.classList.remove("hide"); el.style.display = "flex"; }
  else { el.classList.add("hide"); setTimeout(()=>{ el.style.display = "none"; }, 400); }
}

/* ========== Compass ========== */
function initCompass(){
  const needle = document.querySelector(".needle");
  if (!needle) return;

  const onOri = (e)=>{
    if (typeof e.alpha === "number") targetAlpha = e.alpha;
  };
  window.addEventListener("deviceorientation", onOri, { capture:false, passive:true });

  function anim(){
    // smoothing
    compassAlpha = compassAlpha*0.8 + targetAlpha*0.2;
    let heading = compassAlpha;
    if (!Number.isFinite(heading) && Number.isFinite(lastHeadingFallback)) {
      heading = lastHeadingFallback;
    }
    if (Number.isFinite(heading)) {
      needle.style.transform = `rotate(${heading}deg)`;
    }
    requestAnimationFrame(anim);
  }
  requestAnimationFrame(anim);
}

/* ========== utils ========== */
function q(sel){ return document.querySelector(sel); }

function waitFor(predicate, timeoutMs=8000){
  return new Promise((resolve,reject)=>{
    const start = Date.now();
    (function tick(){
      if (predicate()) return resolve();
      if (Date.now()-start > timeoutMs) return reject(new Error("timeout"));
      setTimeout(tick, 100);
    })();
  });
}

window.initMap = initMap;
