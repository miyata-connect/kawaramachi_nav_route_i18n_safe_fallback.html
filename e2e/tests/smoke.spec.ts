<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Map Smoke</title>
  <style>
    html,body,#map{height:100%;margin:0;padding:0}
  </style>
  <script>
    // ★テストが待てる“準備完了フラグ”。実装への影響はありません。
    window.__MAP_READY__ = false;

    // Maps コールバック（既存の init と同名で OK。内容は触らない）
    function initMap() {
      const center = { lat: 35.681236, lng: 139.767125 };
      const map = new google.maps.Map(document.getElementById('map'), {
        center, zoom: 15, disableDefaultUI: false
      });
      // 重要: タイルが1枚でも描画されたら準備完了にする（google.maps の出現より堅牢）
      const idleOnce = google.maps.event.addListenerOnce(map, 'idle', () => {
        window.__MAP_READY__ = true;
      });
      // 念のための 20s セーフティ
      setTimeout(() => { window.__MAP_READY__ ||= !!(window.google && google.maps); }, 20000);
    }
    window.initMap = initMap; // ★callback が参照できるようグローバル公開
  </script>
</head>
<body>
  <div id="map" data-testid="map"></div>

  <!-- ★あなたの“ブラウザ用 API キー”を埋め込み。callback=initMap は必須 -->
  <script async
    src="https://maps.googleapis.com/maps/api/js?key=YOUR_BROWSER_API_KEY&callback=initMap&v=weekly"></script>
</body>
</html>
