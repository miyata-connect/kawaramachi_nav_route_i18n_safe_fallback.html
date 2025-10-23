// ===========================
// WalkNav 完全復元版 app.js
// ===========================

// --- グローバル変数 ---
let map;
let marker;
let directionsService;
let directionsRenderer;
let recognition;
let isNavigating = false;
let currentPositionMarker;
let watchId;

// --- 地図初期化 ---
function initMap() {
  console.log("initMap called");
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 35.681236, lng: 139.767125 }, // 東京駅
    zoom: 15,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({ map });

  setupButtons();
  getCurrentLocation();
}

// --- 現在地取得 ---
function getCurrentLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (currentPositionMarker) currentPositionMarker.setMap(null);
        currentPositionMarker = new google.maps.Marker({
          position: latlng,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#5fb1ff",
            fillOpacity: 1,
            strokeWeight: 1,
          },
        });
        map.setCenter(latlng);
      },
      err => {
        showError(`位置情報を取得できません: ${err.message}`);
      }
    );
  } else {
    showError("この端末では位置情報がサポートされていません。");
  }
}

// --- 検索処理 ---
async function performSearch() {
  const query = document.getElementById("searchBox").value.trim();
  if (!query) return showError("検索ワードを入力してください。");

  try {
    document.getElementById("status").textContent = "検索中...";
    const res = await fetch("https://ors-proxy.miyata-connect-jp.workers.dev/places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ textQuery: query }),
    });

    const data = await res.json();
    if (!data.places || data.places.length === 0) {
      showError("該当する場所が見つかりません。");
      return;
    }

    const place = data.places[0];
    const lat = place.location.latitude;
    const lng = place.location.longitude;
    map.setCenter({ lat, lng });

    if (marker) marker.setMap(null);
    marker = new google.maps.Marker({
      map,
      position: { lat, lng },
      title: place.displayName.text || "目的地",
    });
    document.getElementById("status").textContent = `検索完了: ${place.displayName.text}`;
  } catch (e) {
    showError("検索中にエラーが発生しました。");
    console.error(e);
  }
}

// --- 案内開始 ---
function startNavigation() {
  if (!marker || !currentPositionMarker) {
    showError("現在地または目的地が未設定です。");
    return;
  }

  const origin = currentPositionMarker.getPosition();
  const destination = marker.getPosition();

  directionsService.route(
    {
      origin,
      destination,
      travelMode: google.maps.TravelMode.WALKING,
    },
    (result, status) => {
      if (status === "OK") {
        directionsRenderer.setDirections(result);
        speak("案内を開始します。");
        isNavigating = true;
      } else {
        showError("経路を取得できません。");
      }
    }
  );
}

// --- 案内停止 ---
function stopNavigation() {
  if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
  speak("案内を終了します。");
  isNavigating = false;
}

// --- リルート ---
function reroute() {
  if (!isNavigating) {
    showError("案内が開始されていません。");
    return;
  }
  getCurrentLocation();
  startNavigation();
}

// --- 音声認識 ---
function startMic() {
  if (!("webkitSpeechRecognition" in window)) {
    showError("音声認識がこのブラウザでサポートされていません。");
    return;
  }

  recognition = new webkitSpeechRecognition();
  recognition.lang = "ja-JP";
  recognition.start();

  document.getElementById("micBtn").classList.add("rec");
  recognition.onresult = event => {
    const transcript = event.results[0][0].transcript;
    document.getElementById("searchBox").value = transcript;
    performSearch();
  };
  recognition.onerror = () => showError("音声入力に失敗しました。");
  recognition.onend = () => document.getElementById("micBtn").classList.remove("rec");
}

// --- 音声案内 ---
function speak(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 0.88;
  speechSynthesis.speak(u);
}

// --- エラー表示 ---
function showError(msg) {
  const banner = document.getElementById("error-banner");
  banner.textContent = msg;
  banner.classList.remove("hidden");
  setTimeout(() => banner.classList.add("hidden"), 4000);
}

// --- イベント設定 ---
function setupButtons() {
  document.getElementById("searchBtn").onclick = performSearch;
  document.getElementById("start-nav").onclick = startNavigation;
  document.getElementById("stop-nav").onclick = stopNavigation;
  document.getElementById("reroute-btn").onclick = reroute;
  document.getElementById("locBtn").onclick = getCurrentLocation;
  document.getElementById("micBtn").onclick = startMic;
  document.getElementById("zoomIn").onclick = () => map.setZoom(map.getZoom() + 1);
  document.getElementById("zoomOut").onclick = () => map.setZoom(map.getZoom() - 1);
}

// --- デバッグログ ---
console.log("WalkNav app.js loaded");