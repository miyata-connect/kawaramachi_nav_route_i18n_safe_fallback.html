// ===========================
// WalkNav 完全修正版 app.js
// ===========================

let map, marker, currentPositionMarker;
let directionsService, directionsRenderer;
let recognition, isRecognizing = false, isNavigating = false;
let watchId = null;

const PLACES_PROXY = "https://ors-proxy.miyata-connect-jp.workers.dev/places";

/* ====== 起動時処理 ====== */
window.onload = () => {
  const loading = document.getElementById("loading-screen");
  if (!navigator.geolocation) {
    loading.textContent = "位置情報がサポートされていません。";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      window._initialLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
      document.querySelector(".app").style.display = "block";
      loading.remove();
      initMap();
    },
    err => { loading.textContent = `位置情報を取得できません: ${err.message}`; }
  );
};

/* ====== 地図初期化 ====== */
function initMap() {
  const center = window._initialLocation || { lat: 35.681236, lng: 139.767125 };

  map = new google.maps.Map(document.getElementById("map"), {
    center, zoom: 16, mapTypeControl: false, streetViewControl: false, fullscreenControl: false
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({ map });
  setupUI();
  showCurrentLocation(center);
  setupCompass();
}

/* ====== 現在地 ====== */
function showCurrentLocation(latlng) {
  if (currentPositionMarker) currentPositionMarker.setMap(null);
  currentPositionMarker = new google.maps.Marker({
    position: latlng, map,
    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#5fb1ff", fillOpacity: 1, strokeWeight: 1 }
  });
  map.setCenter(latlng);
}

/* ====== UIイベント ====== */
function setupUI() {
  q("#searchBtn").onclick = performSearch;
  q("#micBtn").onclick = toggleMic;
  q("#locBtn").onclick = () => navigator.geolocation.getCurrentPosition(pos => showCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }));
  q("#start-nav").onclick = startNavigation;
  q("#stop-nav").onclick = stopNavigation;
  q("#reroute-btn").onclick = reroute;
  q("#zoomIn").onclick = () => map.setZoom(map.getZoom() + 1);
  q("#zoomOut").onclick = () => map.setZoom(map.getZoom() - 1);
}

/* ====== 検索 ====== */
async function performSearch() {
  const query = q("#searchBox").value.trim();
  if (!query) return showError("検索ワードを入力してください。");
  q("#status").textContent = "検索中…";

  try {
    const loc = currentPositionMarker?.getPosition();
    const body = {
      textQuery: query,
      locationBias: loc ? { circle: { center: { latitude: loc.lat(), longitude: loc.lng() }, radius: 20000 } } : undefined
    };

    const res = await fetch(PLACES_PROXY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.places?.length) return showError("該当する場所が見つかりません。");

    const p = data.places[0];
    const lat = p.location.latitude, lng = p.location.longitude;
    const name = p.displayName?.text || query;

    if (marker) marker.setMap(null);
    marker = new google.maps.Marker({ map, position: { lat, lng }, title: name });
    map.setCenter({ lat, lng });
    q("#status").textContent = `検索完了: ${name}`;
  } catch (e) {
    console.error(e);
    showError("検索中にエラーが発生しました。");
  }
}

/* ====== 案内 ====== */
function startNavigation() {
  if (!marker || !currentPositionMarker) return showError("現在地または目的地が未設定です。");
  const origin = currentPositionMarker.getPosition();
  const dest = marker.getPosition();

  directionsService.route({ origin, destination: dest, travelMode: google.maps.TravelMode.WALKING }, (res, status) => {
    if (status === "OK") {
      directionsRenderer.setDirections(res);
      speak("案内を開始します。");
      isNavigating = true;
    } else showError("経路を取得できません。");
  });
}
function stopNavigation() { directionsRenderer.setDirections({ routes: [] }); speak("案内を終了します。"); isNavigating = false; }
function reroute() { if (isNavigating) startNavigation(); else showError("案内が開始されていません。"); }

/* ====== 音声認識 ====== */
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return showError("音声認識がサポートされていません。");
  if (isRecognizing && recognition) return recognition.stop();

  recognition = new SR();
  recognition.lang = "ja-JP";
  recognition.onstart = () => { isRecognizing = true; q("#micBtn").classList.add("rec"); };
  recognition.onresult = e => { q("#searchBox").value = e.results[0][0].transcript; performSearch(); };
  recognition.onerror = () => showError("音声入力に失敗しました。");
  recognition.onend = () => { isRecognizing = false; q("#micBtn").classList.remove("rec"); };
  recognition.start();
}

/* ====== 方位計 ====== */
async function setupCompass() {
  const needle = document.querySelector(".needle");
  if (!needle) return;

  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== "granted") return showError("方位センサーが許可されませんでした。");
    } catch { return showError("方位センサー許可リクエスト失敗。"); }
  }

  window.addEventListener("deviceorientation", e => {
    if (e.alpha != null) needle.style.transform = `rotate(${e.alpha}deg)`;
  });
}

/* ====== 共通 ====== */
function q(sel) { return document.querySelector(sel); }
function showError(msg) {
  const banner = q("#error-banner");
  const text = q("#error-text");
  text.textContent = msg;
  banner.classList.remove("hidden");
  setTimeout(() => banner.classList.add("hidden"), 4000);
}
function speak(t) { const u = new SpeechSynthesisUtterance(t); u.lang = "ja-JP"; u.rate = 0.88; speechSynthesis.speak(u); }

console.log("WalkNav 修正版起動完了");
