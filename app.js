// ===========================
// WalkNav 修正版 app.js（方位更新＋クリック修正＋天気連動）
// 規約：全ファイル差し替え・ワンブロック提出
// ===========================

/* ====== グローバル ====== */
let map;
let marker;                         // 目的地マーカー
let currentPositionMarker;          // 現在地マーカー
let directionsService;
let directionsRenderer;
let recognition;                    // 音声認識
let isRecognizing = false;
let isNavigating = false;
let watchId = null;

const PLACES_PROXY = "https://ors-proxy.miyata-connect-jp.workers.dev/places";

/* ====== 初期化 ====== */
function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 35.681236, lng: 139.767125 }, // 東京駅
    zoom: 15,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: false,
    preserveViewport: false
  });

  // コンパスUIのクリック干渉を無効化（ズームボタン操作を通す）
  const compass = document.querySelector(".compass");
  if (compass) compass.style.pointerEvents = "none";

  // 方位センサーで針を更新
  const oriEvt = ("ondeviceorientationabsolute" in window) ? "deviceorientationabsolute" : "deviceorientation";
  window.addEventListener(oriEvt, (e) => {
    const alpha = (typeof e.alpha === "number") ? e.alpha : null;
    if (alpha === null) return;
    const needle = document.querySelector(".needle");
    if (needle) needle.style.transform = `rotate(${alpha}deg)`;
  });

  bindUI();
  measurePanelHeight();
  getCurrentLocation(true);
  setupGeolocationWatch();
}

/* ====== UIバインド ====== */
function bindUI() {
  qs("#searchBtn")?.addEventListener("click", performSearch);
  qs("#locBtn")?.addEventListener("click", () => getCurrentLocation(false));
  qs("#start-nav")?.addEventListener("click", startNavigation);
  qs("#stop-nav")?.addEventListener("click", stopNavigation);
  qs("#reroute-btn")?.addEventListener("click", () => reroute(true));
  qs("#zoomIn")?.addEventListener("click", () => map.setZoom(map.getZoom() + 1));
  qs("#zoomOut")?.addEventListener("click", () => map.setZoom(map.getZoom() - 1));

  // マイク（トグル：再押下で停止）
  qs("#micBtn")?.addEventListener("click", toggleMic);

  // Enterで検索実行
  qs("#searchBox")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      performSearch();
    }
  });

  // マップタップでパネル復帰
  map.addListener("click", () => restorePanel());
}

/* ====== パネル制御 ====== */
function measurePanelHeight() {
  const glass = qs(".glassbar");
  const h = glass ? Math.ceil(glass.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty("--panelH", `${h}px`);
}
function collapsePanel() {
  const glass = qs(".glassbar");
  if (!glass) return;
  glass.style.display = "none";
  toggleMapWidgetsVisibility(true);
}
function restorePanel() {
  const glass = qs(".glassbar");
  if (!glass) return;
  glass.style.display = "";
  measurePanelHeight();
  toggleMapWidgetsVisibility(false);
}
function toggleMapWidgetsVisibility(show) {
  qs(".fab-col") && (qs(".fab-col").style.display = show ? "" : "none");
  qs(".comp-wrap") && (qs(".comp-wrap").style.display = show ? "" : "none");
  const controls = map.getDiv().querySelectorAll(".gmnoprint, .gm-fullscreen-control, .gm-bundled-control, .gm-svpc");
  controls.forEach(el => el.style.display = show ? "" : "none");
}

/* ====== 現在地 ====== */
function getCurrentLocation(centerMap) {
  if (!navigator.geolocation) {
    return showError("この端末では位置情報がサポートされていません。");
  }
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
      if (centerMap) map.setCenter(latlng);
      // 天気の自動取得（表示はステータス簡易連携）
      updateWeather(latlng).catch(()=>{});
    },
    err => showError(`位置情報を取得できません: ${err.message}`)
  );
}
function setupGeolocationWatch() {
  if (!navigator.geolocation) return;
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(pos => {
    const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (currentPositionMarker) currentPositionMarker.setPosition(latlng);
    if (isNavigating) map.panTo(latlng);
  });
}

/* ====== 検索（Places New via Worker） ====== */
async function performSearch() {
  const query = (qs("#searchBox")?.value || "").trim();
  if (!query) return showError("検索ワードを入力してください。");

  setStatus("検索中...");
  try {
    const body = {
      textQuery: query,
      locationBias: currentPositionMarker
        ? {
            circle: {
              center: {
                latitude: currentPositionMarker.getPosition().lat(),
                longitude: currentPositionMarker.getPosition().lng(),
              },
              radius: 20000
            }
          }
        : undefined
    };

    const res = await fetch(PLACES_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.places || !data.places.length) {
      setStatus("");
      return showError("該当する場所が見つかりません。");
    }

    const p = data.places[0];
    const lat = p.location.latitude;
    const lng = p.location.longitude;

    map.setCenter({ lat, lng });
    if (marker) marker.setMap(null);
    marker = new google.maps.Marker({
      map,
      position: { lat, lng },
      title: p.displayName?.text || "目的地",
    });

    setStatus(`検索完了: ${p.displayName?.text || ""}`);
    collapsePanel(); // 検索確定で自動収納
  } catch (e) {
    console.error(e);
    showError("検索中にエラーが発生しました。");
    setStatus("");
  }
}

/* ====== ルート計算・案内 ====== */
function startNavigation() {
  if (!marker || !currentPositionMarker) {
    return showError("現在地または目的地が未設定です。");
  }

  const origin = currentPositionMarker.getPosition();
  const destination = marker.getPosition();

  directionsService.route(
    {
      origin,
      destination,
      travelMode: google.maps.TravelMode.WALKING,
      provideRouteAlternatives: true
    },
    (result, status) => {
      if (status !== "OK" || !result?.routes?.length) {
        return showError("経路を取得できません。");
      }
      // 最短を優先（代替案があれば距離短いもの）
      const idx = selectShortest(result.routes);
      directionsRenderer.setDirections(result);
      directionsRenderer.setRouteIndex(idx);

      speak("案内を開始します。");
      isNavigating = true;
    }
  );
}
function stopNavigation() {
  if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
  speak("案内を終了します。");
  isNavigating = false;
}
function reroute(center) {
  if (!isNavigating) {
    return showError("案内が開始されていません。");
  }
  getCurrentLocation(!!center);
  startNavigation();
}

/* ====== 音声認識（トグル） ====== */
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return showError("音声認識がこのブラウザでサポートされていません。");

  if (isRecognizing && recognition) {
    recognition.stop();
    return;
  }

  recognition = new SR();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => {
    isRecognizing = true;
    qs("#micBtn")?.classList.add("rec");
  };
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const box = qs("#searchBox");
    if (box) box.value = transcript;
    performSearch();
  };
  recognition.onerror = () => showError("音声入力に失敗しました。");
  recognition.onend = () => {
    isRecognizing = false;
    qs("#micBtn")?.classList.remove("rec");
  };
  recognition.start();
}

/* ====== 音声案内 ====== */
function speak(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 0.88; // 規約：低速
  speechSynthesis.speak(u);
}

/* ====== 天気（OpenWeather連動・視覚UI変更なし） ====== */
async function updateWeather(latlng) {
  // OpenWeatherのAPIキーは localStorage "WALKNAV_OPENWEATHER_KEY" に保存しておく想定（UI変更禁止のため）
  const key = localStorage.getItem("WALKNAV_OPENWEATHER_KEY");
  if (!key || !latlng) return;

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latlng.lat}&lon=${latlng.lng}&appid=${key}&units=metric&lang=ja`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`weather ${r.status}`);
    const w = await r.json();
    const desc = (w.weather && w.weather[0] && w.weather[0].description) ? w.weather[0].description : "";
    const temp = (w.main && typeof w.main.temp === "number") ? Math.round(w.main.temp) : null;
    if (temp !== null) setStatus(`現在地の天気：${desc}／${temp}℃`);
  } catch (e) {
    // サイレント運用（UI変更禁止のため、致命ではない）
    console.warn(e);
  }
}

/* ====== ユーティリティ ====== */
function qs(sel){ return document.querySelector(sel); }
function setStatus(t){ const s = qs("#status"); if (s) s.textContent = t || ""; }
function showError(msg) {
  const banner = document.getElementById("error-banner");
  const text = document.getElementById("error-text");
  if (text) text.textContent = msg;
  if (banner) {
    banner.classList.remove("hidden");
    setTimeout(() => banner.classList.add("hidden"), 4000);
  }
}
function selectShortest(routes){
  let idx = 0, best = Infinity;
  routes.forEach((r, i) => {
    const d = r.legs?.reduce((a,b)=>a+(b.distance?.value||0),0) || Infinity;
    if (d < best){ best = d; idx = i; }
  });
  return idx;
}

// デバッグ
console.log("WalkNav app.js loaded (rev: orientation+weather+clickfix)");
