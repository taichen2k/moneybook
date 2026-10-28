/* 티끌모아 서비스워커: 화면 파일은 인터넷 우선, 끊기면 저장해 둔 것 사용. 깃허브 API(데이터)는 건드리지 않음. 같은 주소의 다른 앱(할수있어·정수리 Cam) 캐시는 지우지 않음 */
const CACHE='moneybook-v60';
const SHELL=['./','./index.html','./style.css','./app.js','./manifest.webmanifest','./fonts/PretendardVariable.woff2','./icon-192.png','./favicon.svg','./logo-mark.svg','./logo.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('moneybook-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const req=e.request;if(req.method!=='GET')return;const u=new URL(req.url);
  if((u.host==='www.gstatic.com'&&u.pathname.startsWith('/firebasejs/'))||(u.host==='cdn.jsdelivr.net'&&u.pathname.startsWith('/npm/xlsx@'))){e.respondWith(caches.open(CACHE).then(c=>c.match(req).then(m=>m||fetch(req).then(res=>{if(res.ok)c.put(req,res.clone());return res;}))));return;}
  if(u.origin!==self.location.origin||!u.pathname.startsWith(new URL('./',self.location).pathname))return;
  if(u.pathname.endsWith('.woff2')){e.respondWith(caches.match(req).then(m=>m||fetch(req)));return;}
  if(u.pathname.endsWith('/sw.js'))return;// 새 판 확인용 요청은 저장하지 않아요
  // 인터넷 우선. 단, 4초 안에 답이 없으면(신호 약함) 저장해 둔 화면을 먼저 보여줘요
  const net=fetch(req,{cache:'no-cache'}).then(res=>{if(res.ok){const c=res.clone();caches.open(CACHE).then(x=>x.put(req,c));}return res;});
  const fallback=()=>caches.match(req,{ignoreSearch:true}).then(m=>m||caches.match('./'));
  e.respondWith(new Promise(ok=>{let done=false;const t=setTimeout(()=>{fallback().then(m=>{if(m&&!done){done=true;ok(m);}});},4000);
    net.then(r=>{clearTimeout(t);if(!done){done=true;ok(r);}}).catch(()=>{clearTimeout(t);fallback().then(m=>{if(!done){done=true;ok(m||Response.error());}});});}));});
