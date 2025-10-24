// ===========================
// WalkNav 第2段階改修版 app.js（完全差し替え）
// 要件：音声検索 / 現在地追従 / 検索（Places New via Worker） / 経路案内 / 案内制御
// index.html は変更禁止
// ===========================

"use strict";

/* ====== グローバル ====== */
let map;
let directionsService;
let directionsRenderer;

let currentPositionMarker = null;
let destinationMarker = null;

let watchId = null;
let isNavigating = false;

let recognition = null;
let recognizing = false;

const PLACES_PROXY = "https://ors-proxy.miyata-connect-jp.workers.dev/places";
const TRAVEL_MODE = google.maps.TravelMode.WALKING;

// 自動リルートのスロットリング
let lastRerouteAt = 0;
const REROUTE_MIN_INTERVAL_MS = 5000;

/* ====== 初期化 ====== */
function initMap() {
  // 既存レイアウトを壊さずに地図を初期化（地図は既に表示済み前提）
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 35.681236, lng: 139.767125 },
    zoom: 15,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({ map });

  // イベントバインド
  const $ = (sel) => document.querySelector(sel);
  $("#searchBtn")?.addEventListener("click", searchPlace);
  $("#micBtn")?.addEventListener("click", initVoiceRecognition);
  $("#locBtn")?.addEventListener("click", locate);
  $("#start-nav")?.addEventListener("click", startNav);
  $("#stop-nav")?.addEventListener("click", stopNav);
  $("#reroute-btn")?.addEventListener("click", reroute);
  $("#searchBox")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchPlace();
    }
  });

  // 音声認識非対応ブラウザ警告（自動）
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showError("このブラウザは音声認識に対応していません。最新の Chrome などをご利用ください。");
  }

  // 起動時に現在地追従を開始
  locate();
  startLocationWatch();
}

/* ====== 現在地取得（単発） ====== */
function locate() {
  setStatus("現在地を取得中…");
  if (!navigator.geolocation) {
    showError("位置情報がサポートされていません。");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateCurrentMarker(latlng);
      map.setCenter(latlng);
      setStatus("現在地を更新しました。");
    },
    (err) => {
      showError(`位置情報を取得できません: ${err.message}`);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

/* ====== 現在地追従（watchPosition） ====== */
function startLocationWatch() {
  if (!navigator.geolocation) return;
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateCurrentMarker(latlng);
      // 案内中は一定間隔で自動リルート
      if (isNavigating) {
        const now = Date.now();
        if (now - lastRerouteAt >= REROUTE_MIN_INTERVAL_MS) {
          lastRerouteAt = now;
          reroute(false);
        }
      }
    },
    (err) => {
      showError(`位置情報の監視に失敗しました: ${err.message}`);
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );
}

function updateCurrentMarker(latlng) {
  if (currentPositionMarker) {
    currentPositionMarker.setPosition(latlng);
  } else {
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
      title: "現在地",
    });
  }
}

/* ====== 検索（Places Text Search via Worker） ====== */
async function searchPlace() {
  const input = document.querySelector("#searchBox");
  const query = (input?.value || "").trim();
  if (!query) {
    showError("検索ワードを入力してください。");
    return;
  }

  setStatus("検索中…");

  // locationBias（任意）
  let bias;
  if (currentPositionMarker?.getPosition) {
    const p = currentPositionMarker.getPosition();
    bias = {
      circle: {
        center: { latitude: p.lat(), longitude: p.lng() },
        radius: 20000,
      },
    };
  }

  try {
    const res = await fetch(PLACES_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        textQuery: query,
        locationBias: bias,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data?.places?.length) {
      showError("該当する場所が見つかりません。");
      setStatus("");
      return;
    }

    const place = data.places[0];
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    const name = place.displayName?.text || query;

    if (typeof lat !== "number" || typeof lng !== "number") {
      showError("検索結果の位置情報を取得できません。");
      setStatus("");
      return;
    }

    // 目的地マーカー更新
    const dest = { lat, lng };
    if (destinationMarker) destinationMarker.setMap(null);
    destinationMarker = new google.maps.Marker({
      position: dest,
      map,
      title: name,
    });

    map.panTo(dest);
    setStatus(`検索完了：${name}`);
  } catch (e) {
    console.error(e);
    showError("検索中にエラーが発生しました。");
    setStatus("");
  }
}

/* ====== 経路案内 ====== */
function startNav() {
  if (!currentPositionMarker || !destinationMarker) {
    showError("現在地または目的地が未設定です。");
    return;
  }
  const origin = currentPositionMarker.getPosition();
  const destination = destinationMarker.getPosition();
  setStatus("経路を計算中…");

  directionsService.route(
    {
      origin,
      destination,
      travelMode: TRAVEL_MODE,
      provideRouteAlternatives: true,
    },
    (result, status) => {
      if (status !== "OK" || !result?.routes?.length) {
        showError("経路を取得できません。");
        return;
      }
      directionsRenderer.setDirections(result);
      directionsRenderer.setRouteIndex(selectShortest(result.routes));
      isNavigating = true;
      speak("案内を開始します。");
      setStatus("案内中");
    }
  );
}

function stopNav() {
  directionsRenderer?.setDirections({ routes: [] });
  isNavigating = false;
  speak("案内を終了します。");
  setStatus("案内を停止しました。");
}

function reroute(manual = true) {
  if (!isNavigating) {
    if (manual) showError("案内が開始されていません。");
    return;
  }
  if (!currentPositionMarker || !destinationMarker) return;

  const origin = currentPositionMarker.getPosition();
  const destination = destinationMarker.getPosition();
  setStatus("リルート中…");

  directionsService.route(
    {
      origin,
      destination,
      travelMode: TRAVEL_MODE,
      provideRouteAlternatives: true,
    },
    (result, status) => {
      if (status !== "OK" || !result?.routes?.length) {
        showError("リルートに失敗しました。");
        return;
      }
      directionsRenderer.setDirections(result);
      directionsRenderer.setRouteIndex(selectShortest(result.routes));
      if (manual) speak("リルートしました。");
      setStatus("案内中（更新）");
    }
  );
}

function selectShortest(routes) {
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < routes.length; i++) {
    const d =
      routes[i].legs?.reduce((acc, leg) => acc + (leg.distance?.value || 0), 0) ??
      Infinity;
    if (d < best) {
      best = d;
      idx = i;
    }
  }
  return idx;
}

/* ====== 音声検索 ====== */
function initVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showError("このブラウザは音声認識に対応していません。最新の Chrome などをご利用ください。");
    return;
  }

  if (recognizing && recognition) {
    recognition.stop();
    return;
  }

  recognition = new SR();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => {
    recognizing = true;
    setStatus("音声入力中…");
    document.querySelector("#micBtn")?.classList.add("rec");
  };

  recognition.onresult = (e) => {
    const text = e.results?.[0]?.[0]?.transcript || "";
    const box = document.querySelector("#searchBox");
    if (box) box.value = text;
    searchPlace();
  };

  recognition.onerror = () => {
    showError("音声入力に失敗しました。");
  };

  recognition.onend = () => {
    recognizing = false;
    document.querySelector("#micBtn")?.classList.remove("rec");
    setStatus("");
  };

  recognition.start();
}

/* ====== エラー共通処理 ====== */
function showError(msg) {
  const banner = document.getElementById("error-banner");
  const text = document.getElementById("error-text");
  if (text) text.textContent = msg;
  if (banner) {
    banner.classList.remove("hidden");
    setTimeout(() => banner.classList.add("hidden"), 4000);
  }
  speak(msg);
}

/* ====== ステータス表示 ====== */
function setStatus(t) {
  const el = document.getElementById("status");
  if (el) el.textContent = t || "";
}

/* ====== 音声合成 ====== */
function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 0.88;
    window.speechSynthesis.speak(u);
  } catch {}
}

// デバッグログ
console.log("WalkNav app.js 第2段階改修版ロード完了");

// グローバル公開（Maps callback から参照）
window.initMap = initMap;
