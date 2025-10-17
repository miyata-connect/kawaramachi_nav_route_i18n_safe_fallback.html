/* ====== あなたのWorkerに変更：ors-proxy を使用（移動のみ） ====== */
const GMAP_PROXY = 'https://ors-proxy.miyata-connect-jp.workers.dev';

/* 要素 */
const $=id=>document.getElementById(id);
const els={
  q:$('q'), mic:$('mic'), search:$('search'), clearHistory:$('clearHistory'),
  results:$('results'), resultList:$('resultList'), closeResults:$('closeResults'),
  startLat:$('startLat'), startLon:$('startLon'), destLat:$('destLat'), destLon:$('destLon'),
  modeShortest:$('modeShortest'), modeEasy:$('modeEasy'), modeStroll:$('modeStroll'),
  msg:$('msg'),
  navStart:$('navStart'), navStop:$('navStop'), gotoStart:$('gotoStart'), gotoDest:$('gotoDest'), reroute:$('reroute'),
  savedList:$('savedList'), openSaveModal:$('openSaveModal'), setFromSaved:$('setFromSaved'), delSaved:$('delSaved'),
  langToggle:$('langToggle'), langList:$('langList'),
  panel:$('panel'), needle:document.getElementById('needle'),
  northUp:$('northUp'), headUp:$('headUp')
};

/* パネル高さをCSSへ反映（地図UIと干渉回避） */
function updatePanelAnchors(){
  const h = Math.ceil(els.panel.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--panelH', h + 'px');
}
new ResizeObserver(updatePanelAnchors).observe(els.panel);
window.addEventListener('load', updatePanelAnchors);
window.addEventListener('resize', updatePanelAnchors);

/* 言語（Directions/TTS のみ切替） */
const LANGS = [
  {code:'ja', tts:'ja-JP', label:'日本語'},
  {code:'en', tts:'en-US', label:'English'},
  {code:'de', tts:'de-DE', label:'Deutsch'},
  {code:'it', tts:'it-IT', label:'Italiano'},
  {code:'fr', tts:'fr-FR', label:'Français'},
  {code:'es', tts:'es-ES', label:'Español'},
  {code:'ko', tts:'ko-KR', label:'한국어'},
  {code:'zh', tts:'zh-CN', label:'中文'}
];
let currentLang='ja', currentTTS='ja-JP';
function buildLang(){
  els.langList.innerHTML='';
  LANGS.forEach(x=>{
    const b=document.createElement('button');
    b.textContent=x.label;
    b.addEventListener('click',()=>{
      currentLang=x.code; currentTTS=x.tts;
      [...els.langList.children].forEach(c=>c.classList.remove('active'));
      b.classList.add('active');
      els.langToggle.open=false;
      if(lastDestination) reroute();
    });
    if(x.code===currentLang) b.classList.add('active');
    els.langList.appendChild(b);
  });
}

/* Google Maps */
let map, gDirectionsService, gDirectionsRenderer;
let currentMarker=null, destMarker=null;
let lastRoutes=null, lastLeg=null, lastOrigin=null, lastDestination=null;
let watchId=null;

/* コンパス（見た目用） */
let compassMode='heading';
const compass={angle:0,target:0,lastUpdate:0,raf:null};
const norm=x=>((x%360)+360)%360;
const diff=(a,b)=>{let d=norm(b)-norm(a);if(d>180)d-=360;if(d<-180)d+=360;return d;}
function setCompassTarget(deg){
  const now=Date.now(); if(now-compass.lastUpdate<200) return;
  compass.lastUpdate=now; compass.target=norm(deg);
  if(!compass.raf){
    const step=()=>{
      const d=diff(compass.angle,compass.target);
      if(Math.abs(d)<0.15){ compass.raf=null; return; }
      compass.angle=norm(compass.angle+d*0.12);
      els.needle.style.transform=`rotate(${compass.angle}deg)`;
      compass.raf=requestAnimationFrame(step);
    };
    compass.raf=requestAnimationFrame(step);
  }
}
$('northUp').addEventListener('click',()=>{compassMode='north';$('northUp').classList.add('primary');$('headUp').classList.remove('primary');setCompassTarget(0);});
$('headUp').addEventListener('click',()=>{compassMode='heading';$('headUp').classList.add('primary');$('northUp').classList.remove('primary');});

/* Map 初期化 */
window.initMap = function(){
  map = new google.maps.Map(document.getElementById('map'), {
    center:{lat:34.342, lng:134.046}, zoom:16, mapTypeControl:false, streetViewControl:false
  });
  gDirectionsService = new google.maps.DirectionsService();
  gDirectionsRenderer = new google.maps.DirectionsRenderer({
    map, suppressMarkers:true, preserveViewport:false,
    polylineOptions:{strokeColor:'#39b6ff', strokeOpacity:0.9, strokeWeight:6}
  });
  buildLang(); refreshSaveList(); initGeolocation(); $('headUp').classList.add('primary');
};
window.addEventListener('load',()=>{
  if(typeof google==='object' && google.maps){
    if(!window.initMapCalled){window.initMap(); window.initMapCalled=true;}
  }
});

/* 位置の初期化と追跡 */
let prevPos=null;
function initGeolocation(){
  if(!navigator.geolocation){ els.msg.textContent='位置情報に未対応です'; return; }
  navigator.geolocation.getCurrentPosition(pos=>{
    const {latitude,longitude,heading}=pos.coords;
    setStart(longitude,latitude); updateCurrent({lat:latitude,lng:longitude});
    map.setCenter({lat:latitude,lng:longitude}); map.setZoom(17);
    if(compassMode==='heading'){ if(Number.isFinite(heading)) setCompassTarget(heading); else setCompassTarget(0); }
    prevPos={lat:latitude,lng:longitude};
  }, err=>{ els.msg.textContent='現在地エラー：'+err.message }, {enableHighAccuracy:true,maximumAge:1500,timeout:7000});

  if(watchId) navigator.geolocation.clearWatch(watchId);
  watchId=navigator.geolocation.watchPosition(pos=>{
    const {latitude,longitude,heading}=pos.coords;
    const cur={lat:latitude,lng:longitude};
    updateCurrent(cur);
    if(compassMode==='heading'){
      if(Number.isFinite(heading)) setCompassTarget(heading);
      else if(prevPos) setCompassTarget(bearing(prevPos,cur));
    }
    prevPos=cur;
    onPosition(cur);
  },()=>{}, {enableHighAccuracy:true,maximumAge:3000,timeout:10000});
}
function bearing(a,b){
  const R=Math.PI/180, φ1=a.lat*R, φ2=b.lat*R, λ1=a.lng*R, λ2=b.lng*R;
  const y=Math.sin(λ2-λ1)*Math.cos(φ2);
  const x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
  return norm(Math.atan2(y,x)/R);
}
function updateCurrent(latlng){
  if(!currentMarker){ currentMarker = new google.maps.Marker({position:latlng, map, title:'現在地'}); }
  else{ currentMarker.setPosition(latlng); }
}
function setStart(lon,lat){ els.startLon.value=lon??''; els.startLat.value=lat??''; }
function setDest(lon,lat){
  els.destLon.value=lon??''; els.destLat.value=lat??'';
  if(Number.isFinite(lat)&&Number.isFinite(lon)){
    const pos={lat, lng:lon};
    if(!destMarker) destMarker = new google.maps.Marker({position:pos, map, title:'目的地'});
    else destMarker.setPosition(pos);
    lastDestination={lat,lng:lon};
  }
}

/* Places 検索（Worker経由で v1 Text Search） */
async function placesTextSearch(text, lat, lon){
  const body={
    textQuery:text,
    languageCode:currentLang||'ja',
    locationBias:(Number.isFinite(lat)&&Number.isFinite(lon))?{circle:{center:{latitude:lat,longitude:lon},radius:20000}}:undefined,
    fieldMask:"places.displayName,places.formattedAddress,places.location,places.types"
  };
  const r=await fetch(GMAP_PROXY+'/places',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok){
    const t=await r.text().catch(()=>String(r.status));
    els.msg.textContent='検索に失敗：'+r.status+' '+t.slice(0,140);
    throw new Error('Places HTTP '+r.status+' '+t);
  }
  const j=await r.json();
  const here={lat:lat||0,lng:lon||0};
  const items=(j.places||[]).map(p=>{
    const name=p.displayName?.text||'名称不明';
    const addr=p.formattedAddress||'';
    const plat=p.location?.latitude, plon=p.location?.longitude;
    const dist=distanceMeters(here,{lat:plat,lng:plon});
    return {name,addr,lat:plat,lon:plon,dist};
  }).sort((a,b)=>a.dist-b.dist);
  return items.slice(0,5);
}

/* Directions（Maps JS）とAi風選択 */
let navState={active:false, routeIndex:0, stepIndex:0, steps:[], lastSpoken:null};
function asLatLng(v){ return (typeof v==='string')?v: new google.maps.LatLng(v.lat, v.lng); }
async function getRoute(){
  const slon=Number(els.startLon.value), slat=Number(els.startLat.value);
  const dlon=Number(els.destLon.value),  dlat=Number(els.destLat.value);
  if(![slon,slat,dlon,dlat].every(Number.isFinite)){ els.msg.textContent='座標が不足しています'; return null; }

  els.msg.textContent='ルート取得中…';
  lastOrigin={lat:slat,lng:slon}; lastDestination={lat:dlat,lng:dlon};

  const req={
    origin: asLatLng(lastOrigin),
    destination: asLatLng(lastDestination),
    travelMode: google.maps.TravelMode.WALKING,
    provideRouteAlternatives: true,
  };

  return new Promise((resolve)=>{
    gDirectionsService.route(req,(res,status)=>{
      if(status!=='OK' || !res?.routes?.length){ els.msg.textContent='ルート取得に失敗（'+status+'）'; resolve(null); return; }
      const chosenIndex = chooseRouteIndex(res.routes);
      gDirectionsRenderer.setDirections(res);
      gDirectionsRenderer.setRouteIndex(chosenIndex);

      lastRoutes = res.routes;
      const leg = res.routes[chosenIndex].legs[0];
      lastLeg = leg;

      const sec=leg.duration?.value||0, dist=leg.distance?.value||0;
      const eta=new Date(Date.now()+sec*1000);
      els.msg.textContent=`徒歩 ${Math.round(dist)}m / 約${Math.round(sec/60)}分　到着 ${eta.toLocaleTimeString()}`;

      navState = {active:false, routeIndex:chosenIndex, stepIndex:0, steps:leg.steps||[], lastSpoken:null};
      resolve(res);
    });
  });
}

let mode='shortest';
function chooseRouteIndex(routes){
  const legs=routes.map(r=>r.legs?.[0]).filter(Boolean);
  if(!legs.length) return 0;
  if(mode==='shortest'){
    let best=0, bestD=Infinity; legs.forEach((l,i)=>{const d=l.distance?.value||Infinity;if(d<bestD){bestD=d;best=i;}}); return best;
  }
  if(mode==='easy'){
    let best=0, bestN=Infinity; legs.forEach((l,i)=>{const n=(l.steps||[]).length;if(n<bestN){bestN=n;best=i;}}); return best;
  }
  if(mode==='stroll'){
    const dists=legs.map(l=>l.distance?.value||Infinity);
    const minD=Math.min(...dists), limit=minD*1.3;
    let best=0, bestD=0; legs.forEach((l,i)=>{const d=l.distance?.value||0;if(d<=limit && d>bestD){bestD=d;best=i;}}); return best;
  }
  return 0;
}

/* 音声（Web Speech） */
function speakOnce(text){
  try{
    if(!text) return;
    window.speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.lang=currentTTS; window.speechSynthesis.speak(u);
  }catch{}
}
function html2text(h){const d=document.createElement('div');d.innerHTML=h;return (d.textContent||'').trim();}
function stepToSpeech(step){
  const base = html2text(step.instructions||'');
  const dist = step.distance?.value||0;
  if(currentLang==='ja') return `${base}（約${Math.round(dist)}メートル）`;
  return `${base} (${Math.round(dist)} meters)`;
}

/* 現在地で指示を読む */
function onPosition(cur){
  if(!navState.active || !navState.steps.length) return;
  const idx = navState.stepIndex;
  const step = navState.steps[idx];
  if(!step) return;
  const target = step.end_location;
  const dx = distanceMeters(cur, {lat:target.lat(), lng:target.lng()});
  const threshold = 30; // 30m以内で次の指示へ
  if(dx<=threshold && navState.lastSpoken!==idx){
    navState.lastSpoken=idx;
    const nextStep = navState.steps[idx];
    if(nextStep) speakOnce(stepToSpeech(nextStep));
    navState.stepIndex = Math.min(navState.steps.length-1, idx+1);
  }
}
function distanceMeters(a,b){
  const R=6371000;
  const φ1=a.lat*Math.PI/180, φ2=b.lat*Math.PI/180;
  const dφ=(b.lat-a.lat)*Math.PI/180, dλ=(b.lng-a.lng)*Math.PI/180;
  const s = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}

/* ナビ開始・停止・リルート */
function startNavigation(){
  if(!lastLeg){ els.msg.textContent='先にルートを取得してください'; return; }
  navState.active=true; navState.stepIndex=0; navState.lastSpoken=null;
  const s0=navState.steps[0]; speakOnce(stepToSpeech(s0));
  els.msg.textContent='案内を開始しました';
  document.getElementById('map').scrollIntoView({behavior:'smooth', block:'start'});
}
function stopNavigation(){
  window.speechSynthesis?.cancel?.();
  navState={active:false, routeIndex:0, stepIndex:0, steps:[], lastSpoken:null};
  gDirectionsRenderer.setDirections({routes: []});
  if(destMarker){ destMarker.setMap(null); destMarker=null; }
  els.destLat.value=els.destLon.value='';
  lastRoutes=null; lastLeg=null;
  els.msg.textContent='案内を停止し、目的地をクリアしました';
}
async function reroute(){
  if(!lastOrigin||!lastDestination){els.msg.textContent='目的地を設定してください';return;}
  els.msg.textContent='リルート中…';
  const res=await getRoute(); if(res) startNavigation();
}

/* 検索（音声含む） */
function setMicBusy(b){ els.mic.classList.toggle('rec', !!b); }
async function searchNearby(){
  const raw=els.q.value.trim(); if(!raw){ els.msg.textContent='検索ワードを入力してください'; return; }
  let lat=Number(els.startLat.value), lon=Number(els.startLon.value);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)){ const c=map.getCenter(); lat=c.lat(); lon=c.lng(); }

  setMicBusy(true); $('busy').style.display='inline'; els.msg.textContent='検索中…';
  try{
    const items=await placesTextSearch(raw, lat, lon);
    showResults(items);
    els.msg.textContent = items.length ? '候補を選択してください' : '候補が見つかりません';
    saveHistory(raw);
    document.getElementById('results').scrollIntoView({behavior:'smooth', block:'end'});
  }catch(e){console.error(e); /* msgはplacesTextSearch内で表示済み */}
  finally{$('busy').style.display='none'; setMicBusy(false);}
}
function showResults(items){
  els.results.style.display='block'; els.resultList.innerHTML='';
  if(!items.length){ els.resultList.innerHTML='<div class="hint">該当なし</div>'; return; }
  items.forEach((it,i)=>{
    const div=document.createElement('div'); div.className='result';
    div.innerHTML=`<div><strong>${i+1}. ${escapeHtml(it.name)}</strong></div>
      <small>${(isFinite(it.dist)?(it.dist/1000).toFixed(2)+' km　':'')+escapeHtml(it.addr||'')}
      <span class="badge">${it.lat.toFixed(5)}, ${it.lon.toFixed(5)}</span></small>`;
    div.addEventListener('click', async ()=>{
      setDest(it.lon,it.lat); map.panTo({lat:it.lat,lng:it.lon}); map.setZoom(17);
      const res=await getRoute(); if(res) startNavigation();
    }, {passive:true});
    els.resultList.appendChild(div);
  });
}
const escapeHtml=s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

/* 音声検索（ブラウザ依存） */
function startVoice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ els.msg.textContent='音声入力に未対応のブラウザです'; return; }
  const rec=new SR();
  rec.lang = (LANGS.find(l=>l.code===currentLang)?.tts) || 'ja-JP';
  rec.interimResults=false; rec.maxAlternatives=1;
  let text='';
  rec.onstart=()=>setMicBusy(true);
  rec.onresult=e=>{ text=(e.results[0][0].transcript||'').trim(); };
  rec.onerror=()=>{ setMicBusy(false); els.msg.textContent='音声入力に失敗しました'; };
  rec.onend=()=>{ setMicBusy(false); if(text){ els.q.value=text; searchNearby(); } };
  rec.start();
}

/* 履歴＆保存（削除不能の対策込み） */
const HISTORY_KEY='mc_search_history';
const loadHistory=()=>{try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]')}catch{return []}};
function saveHistory(q){ if(!q) return; const arr=loadHistory().filter(x=>x!==q); arr.unshift(q); localStorage.setItem(HISTORY_KEY,JSON.stringify(arr.slice(0,20))); }
function clearHistory(){
  localStorage.removeItem(HISTORY_KEY);
  els.q.value=''; els.results.style.display='none'; els.resultList.innerHTML='';
  els.msg.textContent='履歴をクリアしました';
  stopNavigation();
  if(currentMarker) map.panTo(currentMarker.getPosition());
}

const SAVE_KEY='mc_saved_places';
const loadSaves=()=>{try{return JSON.parse(localStorage.getItem(SAVE_KEY)||'[]')}catch{return []}};
const saveSaves=arr=>localStorage.setItem(SAVE_KEY,JSON.stringify(arr));
function refreshSaveList(){
  const arr=loadSaves(); els.savedList.innerHTML='';
  const opt=document.createElement('option'); opt.value=''; opt.textContent='（未選択）'; els.savedList.appendChild(opt);
  arr.forEach((p,i)=>{ const o=document.createElement('option'); o.value=String(i); o.textContent=`${p.name} — ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`; els.savedList.appendChild(o); });
}
function openSave(){
  let lat=Number(els.startLat.value), lon=Number(els.startLon.value);
  if((!Number.isFinite(lat)||!Number.isFinite(lon)) && currentMarker){ const c=currentMarker.getPosition(); lat=c.lat(); lon=c.lng(); }
  const name=prompt('地点名（例：自宅・公園）','');
  if(name==null) return;
  const arr=loadSaves(); arr.unshift({name:name||'地点',lat,lon}); saveSaves(arr.slice(0,50)); refreshSaveList();
  els.msg.textContent='現在地を保存しました';
}
function setFromSaved(){
  const val=els.savedList.value;
  const arr=loadSaves();
  if(!val){ els.msg.textContent='地点を選んでください'; return; }
  const idx=parseInt(val,10); if(Number.isNaN(idx)||!arr[idx]){ els.msg.textContent='地点が不正です'; return; }
  setDest(arr[idx].lon,arr[idx].lat); map.panTo({lat:arr[idx].lat,lng:arr[idx].lon}); map.setZoom(17);
  getRoute().then(res=>{ if(res) startNavigation(); });
}
function delSaved(){
  const val=els.savedList.value;
  const arr=loadSaves();
  if(!val){ els.msg.textContent='削除する地点を選んでください'; return; }
  const idx=parseInt(val,10); if(Number.isNaN(idx)||!arr[idx]){ els.msg.textContent='地点が不正です'; return; }
  arr.splice(idx,1); saveSaves(arr); refreshSaveList(); els.msg.textContent='削除しました';
}

/* モード切替（Aiルート選択） */
function setMode(m){
  mode=m; [els.modeShortest,els.modeEasy,els.modeStroll].forEach(b=>b.classList.remove('active'));
  ({shortest:els.modeShortest, easy:els.modeEasy, stroll:els.modeStroll}[m]).classList.add('active');
  if(lastDestination) reroute();
}
els.modeShortest.addEventListener('click',()=>setMode('shortest'));
els.modeEasy.addEventListener('click',()=>setMode('easy'));
els.modeStroll.addEventListener('click',()=>setMode('stroll'));

/* UIイベント */
els.search.addEventListener('click',searchNearby);
els.mic.addEventListener('click',startVoice);
els.clearHistory.addEventListener('click',clearHistory);
els.closeResults.addEventListener('click',()=>els.results.style.display='none');
els.navStart.addEventListener('click',startNavigation);
els.navStop.addEventListener('click',stopNavigation);
els.gotoStart.addEventListener('click',()=>{ if(currentMarker) map.panTo(currentMarker.getPosition()); });
els.gotoDest.addEventListener('click',()=>{ if(destMarker) map.panTo(destMarker.getPosition()); else els.msg.textContent='目的地が未設定です'; });
els.reroute.addEventListener('click',reroute);
els.openSaveModal.addEventListener('click',openSave);
els.setFromSaved.addEventListener('click',setFromSaved);
els.delSaved.addEventListener('click',delSaved);

/* 右クリックで目的地設定（簡易：地図中心） */
document.addEventListener('contextmenu',e=>{
  const mapRect = document.getElementById('map').getBoundingClientRect();
  if(e.clientY<mapRect.top || e.clientY>mapRect.bottom || e.clientX<mapRect.left || e.clientX>mapRect.right) return;
  e.preventDefault();
  const c = map.getCenter(); setDest(c.lng(), c.lat());
  els.msg.textContent='目的地を設定しました（地図中心）';
});
