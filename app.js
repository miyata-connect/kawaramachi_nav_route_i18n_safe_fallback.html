"use strict";

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

function initMap() {
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
  locate();
  startLocationWatch();
}

function bindUI() {
  const $ = (s) => document.querySelector(s);
  $("#searchBtn").onclick = searchPlace;
  $("#micBtn").onclick = initVoiceRecognition;
  $("#locBtn").onclick = locate;
  $("#start-nav").onclick = startNav;
  $("#stop-nav").onclick = stopNav;
  $("#reroute-btn").onclick = () => reroute(true);
  $("#searchBox").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchPlace();
  });
}

function locate() {
  setStatus("現在地取得中…");
  if (!navigator.geolocation) {
    showError("位置情報が利用できません。");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateCurrentMarker(latlng);
      map.setCenter(latlng);
      setStatus("現在地を更新しました。");
    },
    (err) => showError("現在地取得失敗: " + err.message),
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
  );
}

function startLocationWatch() {
  if (!navigator.geolocation) return;
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateCurrentMarker(latlng);
      if (isNavigating) reroute(false);
    },
    (err) => showError("追従エラー: " + err.message),
    { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
  );
}

function updateCurrentMarker(latlng) {
  if (currentPositionMarker) currentPositionMarker.setPosition(latlng);
  else {
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
  }
}

async function searchPlace() {
  const q = document.querySelector("#searchBox").value.trim();
  if (!q) return showError("検索ワードを入力してください。");
  setStatus("検索中…");

  try {
    const loc = currentPositionMarker?.getPosition();
    const res = await fetch(PLACES_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        textQuery: q,
        locationBias: loc
          ? { circle: { center: { latitude: loc.lat(), longitude: loc.lng() }, radius: 20000 } }
          : undefined,
      }),
    });
    const data = await res.json();
    if (!data?.places?.length) return showError("該当する場所が見つかりません。");

    const p = data.places[0];
    const lat = p.location.latitude;
    const lng = p.location.longitude;
    const name = p.displayName?.text || q;

    if (destinationMarker) destinationMarker.setMap(null);
    destinationMarker = new google.maps.Marker({ position: { lat, lng }, map, title: name });
    map.setCenter({ lat, lng });
    setStatus(`検索完了: ${name}`);
  } catch {
    showError("検索エラーが発生しました。");
  }
}

function startNav() {
  if (!currentPositionMarker || !destinationMarker)
    return showError("現在地または目的地が未設定です。");

  const origin = currentPositionMarker.getPosition();
  const dest = destinationMarker.getPosition();
  setStatus("経路計算中…");

  directionsService.route(
    { origin, destination: dest, travelMode: TRAVEL_MODE },
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
  if (!isNavigating) {
    if (manual) showError("案内が開始されていません。");
    return;
  }
  if (!currentPositionMarker || !destinationMarker) return;
  const origin = currentPositionMarker.getPosition();
  const dest = destinationMarker.getPosition();
  directionsService.route(
    { origin, destination: dest, travelMode: TRAVEL_MODE },
    (res, status) => {
      if (status !== "OK") return showError("リルートに失敗しました。");
      directionsRenderer.setDirections(res);
      if (manual) speak("リルートしました。");
      setStatus("案内更新中");
    }
  );
}

function initVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return showError("音声認識に対応していません。");
  if (recognizing && recognition) {
    recognition.stop();
    return;
  }
  recognition = new SR();
  recognition.lang = "ja-JP";
  recognition.onstart = () => {
    recognizing = true;
    setStatus("音声入力中…");
    document.querySelector("#micBtn")?.classList.add("rec");
  };
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    document.querySelector("#searchBox").value = text;
    searchPlace();
  };
  recognition.onerror = () => showError("音声入力に失敗しました。");
  recognition.onend = () => {
    recognizing = false;
    document.querySelector("#micBtn")?.classList.remove("rec");
    setStatus("");
  };
  recognition.start();
}

function showError(msg) {
  const b = document.getElementById("error-banner");
  const t = document.getElementById("error-text");
  t.textContent = msg;
  b.classList.remove("hidden");
  setTimeout(() => b.classList.add("hidden"), 4000);
  speak(msg);
}

function setStatus(s) {
  const el = document.getElementById("status");
  if (el) el.textContent = s;
}

function speak(t) {
  const u = new SpeechSynthesisUtterance(t);
  u.lang = "ja-JP";
  u.rate = 0.88;
  speechSynthesis.speak(u);
}

window.initMap = initMap;
