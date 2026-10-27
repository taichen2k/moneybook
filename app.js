(function(){
"use strict";
const COLORS=['#e4572e','#f0a202','#2a9d6f','#2e86ab','#a23b72','#6c5ce7','#d0813c','#5b8c2a','#c44569','#3d6fa5','#8d99ae','#b08968','#17a2b8','#9c6644'];
const GROUPS=['현금','은행','카드','투자','대출','기타'];
const DEFAULTS={v:1,monthStart:1,
  cats:{exp:['식비/생활용품','교통/차량','패션/미용/문화','주거/통신','건강','교육','경조사/회비','부모님','기타','보험','저축'],
        inc:['월급','부수입','용돈','상여','금융소득','기타']},
  subOn:true,
  subs:{exp:{'식비/생활용품':['식료품','간식','외식','음료'],'교통/차량':['대중교통','택시','주유','정비','렌트'],'패션/미용/문화':['의류','패션잡화','헤어/뷰티','세탁비'],
    '주거/통신':['관리비','공과금','통신비','월세'],'건강':['운동','다이어트','병원','약국'],'교육':['학비','학원비','교재비','육아'],'경조사/회비':['경조사비','회비','선물']},inc:{}},
  accounts:[{id:'cash',name:'현금',group:'현금',init:0},{id:'bank',name:'주거래 통장',group:'은행',init:0},{id:'card',name:'신용카드',group:'카드',init:0}],
  budget:{total:0,cats:{}},favorites:[],recurring:[],months:{},pin:null,lockMin:1};
const TYPE_NAME={exp:'지출',inc:'수입',trf:'이체'};
const DOW=['일','월','화','수','목','금','토'];

const S={db:null,noDb:false,canWrite:true,settings:clone(DEFAULTS),settingsReady:false,label:'',tab:'list',
  live:{},cache:{},fetching:new Set(),unsubs:[],loaded:false,sync:'off',selDay:'',statType:'exp',
  sheet:null,form:null,sms:null,search:'',catType:'exp',catEdit:-1,catDelAsk:-1,accDraft:null,recDraft:null,budDraft:null,recurDone:false,downloads:null,
  filter:{inc:[],exp:[],acc:[]},fTab:'exp',favEdit:false,
  sub:'daily',openMonth:'',memo:null,overview:false,locked:false,unlockedOnce:false,pinIn:'',pinErr:'',pinDraft:null,hiddenAt:0,
  sp:'month',spWeek:'',spYear:0,rFrom:'',rTo:'',statCat:''};
try{const t=localStorage.getItem('moneybook.tab');if(t)S.tab=t;const u=localStorage.getItem('moneybook.sub');if(u)S.sub=u;}catch(e){}
if(S.tab==='cal'){S.tab='list';S.sub='cal';}if(!['list','stat','asset','more'].includes(S.tab))S.tab='list';

/* ---------- helpers ---------- */
function clone(o){return JSON.parse(JSON.stringify(o));}
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const today=()=>ymd(new Date());
const won=n=>Math.round(n||0).toLocaleString('ko-KR');
const sgn=n=>(n>0?'+':n<0?'−':'')+won(Math.abs(n));
function compact(n){n=Math.round(n);const a=Math.abs(n);if(a>=1e8)return (n/1e8).toFixed(1).replace(/\.0$/,'')+'억';if(a>=1e6)return won(Math.round(n/1e4))+'만';if(a>=1e4)return (n/1e4).toFixed(1).replace(/\.0$/,'')+'만';return won(n);}
function addDays(s,n){const [y,m,d]=s.split('-').map(Number);return ymd(new Date(y,m-1,d+n));}
function monthsBetween(a,b){const out=[];let l=a.slice(0,7);const e=b.slice(0,7);while(l<=e&&out.length<240){out.push(l);l=shiftLabel(l,1);}return out;}
function mkPeriod(st,en){return {start:st,end:en,last:addDays(en,-1),months:monthsBetween(st,addDays(en,-1))};}
function subsOf(type,cat){return ((S.settings.subs||{})[type]||{})[cat]||[];}
function statPeriod(){if(S.sp==='week'){const a=S.spWeek||today();const st=addDays(a,-dowOf(a));return mkPeriod(st,addDays(st,7));}
  if(S.sp==='year'){const y=S.spYear||+S.label.slice(0,4);return mkPeriod(period(y+'-01').start,period((y+1)+'-01').start);}
  if(S.sp==='range'){const p=period(S.label);const f=S.rFrom||p.start;let t=S.rTo||p.last;if(t<f)t=f;return mkPeriod(f,addDays(t,1));}
  return period(S.label);}
async function hashPin(pin,salt){const txt=salt+':'+pin;try{const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(txt));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');}
  catch(e){let h=2166136261;for(const c of txt){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return 'f'+h.toString(16);}}
function padHtml(){return `<div class="pad">${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-act="pinKey" data-k="${n}">${n}</button>`).join('')}<span></span><button data-act="pinKey" data-k="0">0</button><button data-act="pinKey" data-k="back" aria-label="지우기">⌫</button></div>`;}
function dotsHtml(n,bad){return `<div class="pdots ${bad?'bad':''}">${[0,1,2,3].map(i=>`<i class="${i<n?'f':''}"></i>`).join('')}</div>`;}
function renderLock(){const r=$('#lockRoot');if(!(S.locked&&S.settings.pin)){r.innerHTML='';return;}
  r.innerHTML=`<div class="lock" role="dialog" aria-label="비밀번호 입력"><img src="logo-mark.svg" alt="" width="72" height="72" style="border-radius:18px;box-shadow:0 4px 14px rgba(0,0,0,.18)"><h2>티끌모아</h2><div>비밀번호 4자리를 입력하세요</div>${dotsHtml(S.pinIn.length,!!S.pinErr)}<div class="perr">${esc(S.pinErr)}</div>${padHtml()}</div>`;}
const dot2=s=>s.slice(2).replace(/-/g,'.');
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const uniq=a=>[...new Set(a)];
function daysIn(ym){const [y,m]=ym.split('-').map(Number);return new Date(y,m,0).getDate();}
function shiftLabel(l,k){const [y,m]=l.split('-').map(Number);const d=new Date(y,m-1+k,1);return d.getFullYear()+'-'+pad(d.getMonth()+1);}
function curLabel(){const t=new Date();const s=S.settings.monthStart||1;const d=t.getDate()>=s?t:new Date(t.getFullYear(),t.getMonth()-1,1);return d.getFullYear()+'-'+pad(d.getMonth()+1);}
function period(l){const [y,m]=l.split('-').map(Number);const s=S.settings.monthStart||1;
  const st=new Date(y,m-1,s),en=new Date(y,m,s),last=new Date(y,m,s-1);
  return {start:ymd(st),end:ymd(en),last:ymd(last),months:uniq([ymd(st).slice(0,7),ymd(last).slice(0,7)])};}
function catColor(type,name){const list=(S.settings.cats[type]||[]);let i=list.indexOf(name);if(i<0){i=0;for(const c of String(name))i+=c.charCodeAt(0);}return COLORS[(i+(type==='inc'?5:0))%COLORS.length];}
function accName(id){const a=S.settings.accounts.find(a=>a.id===id);return a?a.name:'(삭제된 자산)';}
function txOf(ym){return S.live[ym]||S.cache[ym]||[];}
function txIn(p){return p.months.flatMap(txOf).filter(t=>t.date>=p.start&&t.date<p.end);}
function totals(list){let inc=0,exp=0;for(const t of list){if(t.type==='inc')inc+=t.amount;else if(t.type==='exp')exp+=t.amount;}return {inc,exp,net:inc-exp};}
function dowOf(s){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d).getDay();}
function toast(msg){const el=$('#toast');el.textContent=msg;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2400);}
function calc(str){const s=String(str).replace(/[,\s원]/g,'').replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');if(!s)return NaN;let i=0;
  function num(){if(s[i]==='('){i++;const v=expr();if(s[i]!==')')throw 0;i++;return v;}if(s[i]==='-'){i++;return -num();}const j=i;while(i<s.length&&/[\d.]/.test(s[i]))i++;if(j===i)throw 0;return parseFloat(s.slice(j,i));}
  function term(){let v=num();while(s[i]==='*'||s[i]==='/'){const op=s[i++];const r=num();v=op==='*'?v*r:v/r;}return v;}
  function expr(){let v=term();while(s[i]==='+'||s[i]==='-'){const op=s[i++];const r=term();v=op==='+'?v+r:v-r;}return v;}
  try{const v=expr();if(i!==s.length||!isFinite(v))return NaN;return Math.round(v);}catch(e){return NaN;}}
function dbErr(e){const c=e&&e.code;if(c==='quota_exceeded')return '저장 공간이 가득 찼어요. 오래된 내역을 정리해 주세요.';if(c==='invalid_argument')return '이 계정은 보기 전용이라 저장할 수 없어요.';if(c==='revoked')return '접근 권한이 바뀌었어요. 페이지를 새로 열어주세요.';return '저장하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.';}

/* ---------- 깃허브 동기화 저장소 ----------
   비공개 저장소(taichen2k/moneybook-backup)의 data/ 폴더에 파일로 저장해요.
   ledger.json(설정) · tx_YYYY-MM.json(월별 내역) · memo.json(월 메모)
   각 기록에 수정 시각(_u)을 붙여, 두 폰이 동시에 고쳐도 최신 것으로 합쳐요. 토큰은 이 기기에만 저장돼요. */
let deferredInstall=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;try{render();}catch(x){}});
window.addEventListener('appinstalled',()=>{deferredInstall=null;try{toast('홈 화면에 설치했어요');render();}catch(x){}});
const isStandalone=()=>(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
const isIOS=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const GH_KEY='moneybook.gh';
function ghCfg(){try{const j=JSON.parse(localStorage.getItem(GH_KEY)||'null');if(j&&j.repo&&j.token)return j;}catch(e){}return null;}
function ghSave(v){try{v?localStorage.setItem(GH_KEY,JSON.stringify(v)):localStorage.removeItem(GH_KEY);}catch(e){}}
function candoitCfg(){try{const j=JSON.parse(localStorage.getItem('candoit.gh')||'null');return j&&j.repo&&j.token?j:null;}catch(e){return null;}}
const b64e=str=>{const b=new TextEncoder().encode(str);let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s);};
const b64d=b=>{const s=atob(String(b).replace(/\s/g,''));const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return new TextDecoder().decode(u);};
const GH={err:'',lastOk:0};
function ghErr(m){if(GH.err!==(m||'')){GH.err=m||'';render();}if(!m)GH.lastOk=Date.now();}
async function ghTest(repo,token){const r=await fetch('https://api.github.com/repos/'+repo,{cache:'no-store',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
  if(r.status===401)throw new Error('토큰이 맞지 않거나 만료됐어요.');if(r.status===404)throw new Error('저장소를 찾을 수 없어요. 이름과 토큰 권한(이 저장소 선택)을 확인하세요.');
  if(!r.ok)throw new Error('깃허브 오류 '+r.status);const j=await r.json();if(j.permissions&&j.permissions.push===false)throw new Error('이 토큰은 읽기만 돼요. Contents 읽기·쓰기 권한이 필요해요.');return j;}
function makeGhDb(cfg){const dir=(cfg.dir||'data').replace(/^\/+|\/+$/g,'');const F={};
  const api=(name,opt)=>fetch(`https://api.github.com/repos/${cfg.repo}/contents/${dir}/${name}.json`,Object.assign({cache:'no-store'},opt||{},{headers:Object.assign({Authorization:'Bearer '+cfg.token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},(opt&&opt.headers)||{})}));
  function file(name){if(!F[name]){let c=null;try{c=JSON.parse(localStorage.getItem('moneybook.f.'+name)||'null');}catch(e){}
    F[name]={name,docs:(c&&c.docs)||{},del:(c&&c.del)||{},sha:(c&&c.sha)||null,etag:null,loaded:!!c,synced:false,dirty:!!(c&&c.dirty),ls:new Set(),pulling:null,pushT:0,pushing:false,again:false};
    if(F[name].dirty)schedulePush(F[name]);}return F[name];}
  function save(f){try{localStorage.setItem('moneybook.f.'+f.name,JSON.stringify({docs:f.docs,del:f.del,sha:f.sha,dirty:f.dirty}));}catch(e){}}
  function mergeIn(f,srv){const sd=srv.docs||{},sx=srv.del||{};
    for(const id in sx)if(!(id in f.del)||f.del[id]<sx[id])f.del[id]=sx[id];
    for(const id in sd){const a=f.docs[id],b=sd[id];if(!a||(b._u||0)>(a._u||0))f.docs[id]=b;}
    for(const id in f.del)if(f.docs[id]&&(f.docs[id]._u||0)<=f.del[id])delete f.docs[id];}
  function ahead(f,srv){const sd=srv.docs||{},sx=srv.del||{};for(const id in f.docs){const b=sd[id];if(!b||(b._u||0)<(f.docs[id]._u||0))return true;}
    for(const id in f.del)if(!(id in sx)||sx[id]<f.del[id])return true;return false;}
  function prune(f){const lim=Date.now()-120*864e5;for(const id in f.del)if(f.del[id]<lim)delete f.del[id];}
  function notify(f){f.ls.forEach(fn=>{try{fn();}catch(e){}});}
  function pull(f,inPush){if(f.pulling)return f.pulling;
    f.pulling=(async()=>{try{const r=await api(f.name,f.etag?{headers:{'If-None-Match':f.etag}}:{});
        if(r.status===304){f.synced=true;ghErr('');return;}
        if(r.status===404){f.sha=null;f.etag=null;f.loaded=true;f.synced=true;ghErr('');if(Object.keys(f.docs).length||Object.keys(f.del).length){f.dirty=true;if(!inPush)schedulePush(f);}notify(f);return;}
        if(r.status===401){ghErr('토큰이 만료됐거나 맞지 않아요. 더보기 → 동기화 연결에서 다시 넣어주세요.');return;}
        if(r.status===403){ghErr('토큰 권한이 부족하거나 요청이 너무 많아요. 잠시 뒤 다시 시도해요.');return;}
        if(!r.ok){ghErr('깃허브 오류 '+r.status);return;}
        const j=await r.json();f.etag=r.headers.get('ETag');f.sha=j.sha;let srv={};
        try{srv=JSON.parse(b64d(j.content||'')||'{}');}catch(e){srv={};}
        mergeIn(f,srv);f.loaded=true;f.synced=true;ghErr('');
        if(ahead(f,srv)){f.dirty=true;if(!inPush)schedulePush(f);}else f.dirty=false;
        save(f);notify(f);
      }catch(e){ghErr('인터넷에 연결되지 않았어요. 연결되면 자동으로 맞춰요.');}finally{f.pulling=null;}})();
    return f.pulling;}
  function schedulePush(f){clearTimeout(f.pushT);f.pushT=setTimeout(()=>push(f),600);}
  async function push(f){if(f.pushing){f.again=true;return;}if(!f.dirty)return;f.pushing=true;
    try{for(let i=0;i<5;i++){prune(f);const body=JSON.stringify({v:1,docs:f.docs,del:f.del});
        const r=await api(f.name,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({message:'티끌모아: '+f.name,content:b64e(body)},f.sha?{sha:f.sha}:{}))});
        if(r.ok){const j=await r.json();f.sha=j.content&&j.content.sha;f.etag=null;f.dirty=false;save(f);ghErr('');notify(f);break;}
        if(r.status===409||r.status===422){f.etag=null;await pull(f,true);continue;}
        if(r.status===401){ghErr('토큰이 만료됐거나 맞지 않아요. 더보기 → 동기화 연결에서 다시 넣어주세요.');break;}
        if(r.status===403||r.status===404){ghErr('이 토큰으로는 저장소에 쓸 수 없어요. Contents 읽기·쓰기 권한을 확인하세요.');break;}
        ghErr('깃허브 오류 '+r.status);break;}
    }catch(e){ghErr('인터넷에 연결되지 않았어요. 연결되면 자동으로 보낼게요.');}
    finally{f.pushing=false;if(f.again){f.again=false;schedulePush(f);}}}
  const strip=o=>{if(!o)return o;const c=Object.assign({},o);delete c._u;return c;};
  const snapDoc=(f,id)=>{const o=f.docs[id];return {id,exists:!!o,data:()=>o?strip(o):undefined,metadata:{hasPendingWrites:f.dirty,fromCache:!f.synced}};};
  const qs=f=>{const ids=Object.keys(f.docs).sort();return {docs:ids.map(id=>snapDoc(f,id)),size:ids.length,empty:!ids.length,metadata:{hasPendingWrites:f.dirty,fromCache:!f.synced}};};
  function write(name,id,data){const f=file(name);f.docs[id]=Object.assign({},data,{_u:Date.now()});delete f.del[id];f.dirty=true;f.loaded=true;save(f);notify(f);schedulePush(f);return Promise.resolve();}
  function remove(name,id){const f=file(name);delete f.docs[id];f.del[id]=Date.now();f.dirty=true;save(f);notify(f);schedulePush(f);return Promise.resolve();}
  function docRef(name,id){return {id,path:name+'/'+id,
    async get(){const f=file(name);if(!f.synced)await pull(f);return snapDoc(f,id);},
    set:d=>write(name,id,d),update:d=>{const f=file(name);return write(name,id,Object.assign({},strip(f.docs[id])||{},d));},delete:()=>remove(name,id),
    onSnapshot(cb){const f=file(name);const fn=()=>cb(snapDoc(f,id));f.ls.add(fn);if(f.loaded)setTimeout(fn,0);pull(f);return ()=>f.ls.delete(fn);}};}
  function colRef(name){return {path:name,doc:id=>docRef(name,id||newId()),
    async get(){const f=file(name);if(!f.synced)await pull(f);return qs(f);},
    onSnapshot(cb){const f=file(name);const fn=()=>cb(qs(f));f.ls.add(fn);if(f.loaded)setTimeout(fn,0);pull(f);return ()=>f.ls.delete(fn);}};}
  function syncAll(){Object.values(F).forEach(f=>{if(f.ls.size)pull(f);if(f.dirty)schedulePush(f);});}
  setInterval(()=>{if(!document.hidden)Object.values(F).forEach(f=>{if(f.ls.size)pull(f);});},20000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncAll();});
  window.addEventListener('online',syncAll);
  return {doc:p=>{const [c,id]=p.split('/');return docRef(c,id);},collection:c=>colRef(c),syncAll,
    pending:()=>Object.values(F).some(f=>f.dirty),cfg};}

/* ---------- data ---------- */
let setQ=Promise.resolve();
function saveSettings(patch){S.settings=Object.assign({},S.settings,patch);render();const body=clone(S.settings);
  setQ=setQ.then(()=>S.db.doc('ledger/settings').set(body)).catch(e=>toast(dbErr(e)));return setQ;}
function subscribePeriod(){S.unsubs.forEach(u=>u());S.unsubs=[];S.live={};S.loaded=false;const p=period(S.label);let got=0;
  p.months.forEach(ym=>{const u=S.db.collection('tx_'+ym).onSnapshot(snap=>{
      S.live[ym]=snap.docs.map(d=>Object.assign({id:d.id},d.data()));S.cache[ym]=S.live[ym];
      if(!S.loaded){got++;if(got>=p.months.length)S.loaded=true;}
      render();
    },e=>{S.sync='off';render();});S.unsubs.push(u);});}
async function ensureMonths(list,force){const need=list.filter(ym=>!S.live[ym]&&(force||!S.cache[ym])&&!S.fetching.has(ym));
  if(!need.length)return;need.forEach(m=>S.fetching.add(m));
  await Promise.all(need.map(async ym=>{try{if(!S.settings.months[ym]){S.cache[ym]=[];return;}const snap=await S.db.collection('tx_'+ym).get();S.cache[ym]=snap.docs.map(d=>Object.assign({id:d.id},d.data()));}catch(e){S.cache[ym]=S.cache[ym]||[];}finally{S.fetching.delete(ym);}}));
  render();}
async function writeTx(t,orig){const ym=t.date.slice(0,7);const id=(orig&&orig.id)||newId();const body={type:t.type,date:t.date,amount:t.amount,cat:t.cat||'',sub:t.sub||'',acc:t.acc||'',to:t.to||'',memo:t.memo||'',time:t.time||'',created:t.created||Date.now(),updated:Date.now()};
  if(t.auto)body.auto=true;
  if(orig&&orig.ym!==ym)await S.db.collection('tx_'+orig.ym).doc(orig.id).delete();
  await S.db.collection('tx_'+ym).doc(id).set(body);
  if(!S.settings.months[ym])await saveSettings({months:Object.assign({},S.settings.months,{[ym]:true})});}
async function applyRecurring(){if(S.recurDone||!S.canWrite)return;S.recurDone=true;const now=new Date();const ym=ymd(now).slice(0,7);const d=now.getDate();
  const recs=(S.settings.recurring||[]).map(r=>Object.assign({},r,{done:(r.done||[]).slice()}));let n=0;
  for(const r of recs){if(r.done.includes(ym)||d<r.day)continue;const day=Math.min(r.day,daysIn(ym));
    try{await S.db.collection('tx_'+ym).doc('r_'+r.id+'_'+ym).set({type:r.type,date:ym+'-'+pad(day),amount:r.amount,cat:r.cat||'',acc:r.acc||'',to:r.to||'',memo:r.memo||'',time:'',auto:true,created:Date.now(),updated:Date.now()});
      r.done=r.done.slice(-5).concat(ym);n++;}catch(e){}}
  if(n){await saveSettings({recurring:recs,months:Object.assign({},S.settings.months,{[ym]:true})});toast('반복 내역 '+n+'건을 자동으로 입력했어요');}}

/* ---------- render ---------- */
const ICONS={list:'<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  cal:'<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  stat:'<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/></svg>',
  asset:'<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/></svg>',
  more:'<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/></svg>'};
const TABS=[['list','가계부'],['stat','통계'],['asset','자산'],['more','더보기']];
const SUBS=[['daily','일일'],['cal','달력'],['month','월별'],['settle','결산'],['memo','메모']];
const HICON={sms:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  fav:'<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.8z"/></svg>',
  search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  set:'<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>'};

function render(){renderLock();renderTop();renderView();if(S.sheet==='filter')renderSheet();
  $('#tabs .in').innerHTML=TABS.map(([k,n])=>`<button data-act="tab" data-k="${k}" class="${S.tab===k?'on':''}" aria-label="${n}">${ICONS[k]}<span>${n}</span></button>`).join('');
  $('#fab').hidden=!S.db||!S.canWrite||S.tab==='more'||(S.tab==='list'&&S.sub==='memo');}

function sumRow(t){return `<div class="sum num"><div><span>수입</span><b class="inc">${won(t.inc)}</b></div><div><span>지출</span><b class="exp">${won(t.exp)}</b></div><div><span>합계</span><b>${t.net<0?'-':''}${won(Math.abs(t.net))}</b></div></div>`;}
function renderTop(){const top=$('#top');const sc=!S.db?'off':GH.err?'off':S.db.pending()?'pending':'ok';const st=!S.db?'연결 안 됨':GH.err?'동기화 끊김':sc==='pending'?'저장 중…':'동기화됨';
  let h='';
  if(S.tab==='list'){const yearMode=S.sub==='month';const [y,m]=S.label.split('-');
    const t=yearMode?totals(yearTx(+y).filter(passFilter)):totals(txIn(period(S.label)).filter(passFilter));
    h+=`<div class="lhead"><div class="lnav"><button data-act="${yearMode?'yprev':'prev'}" aria-label="이전">‹</button><b>${yearMode?y+'년':y+'년 '+(+m)+'월'}</b><button data-act="${yearMode?'ynext':'next'}" aria-label="다음">›</button></div>
      <div class="hic"><span class="sync ${sc}" title="${st}"><i></i></span><button data-act="open" data-k="sms" aria-label="문자 붙여넣기">${HICON.sms}</button><button data-act="open" data-k="favorites" aria-label="자주 쓰는 내역">${HICON.fav}</button><button data-act="open" data-k="search" aria-label="검색">${HICON.search}</button><button data-act="open" data-k="filter" aria-label="필터" class="${filterOn()?'fact':''}">${HICON.set}</button></div></div>
    <div class="subtabs">${SUBS.map(([k,n])=>`<button data-act="sub" data-k="${k}" class="${S.sub===k?'on':''}">${n}</button>`).join('')}</div>${sumRow(t)}`;
    top.innerHTML=h;return;}
  h=`<div class="brand"><h1><img src="logo-mark.svg" alt="" width="28" height="28">티끌모아</h1><span class="sync ${sc}"><i></i>${st}</span></div>`;
  if(S.tab==='stat'){const sp=statPeriod();const t=totals(txIn(sp));const modes=[['week','주간'],['month','월간'],['year','연간'],['range','기간']];
    let lab;if(S.sp==='month'){const [y,m]=S.label.split('-');lab=`<b>${y}년 ${+m}월</b>`;}else if(S.sp==='year')lab=`<b>${S.spYear||S.label.slice(0,4)}년</b>`;
    else if(S.sp==='week')lab=`<b class="num" style="font-size:19px">${dot2(sp.start)} ~ ${dot2(sp.last)}</b>`;
    else lab=`<span class="rng"><input type="date" id="sp-from" class="in-t" value="${sp.start}" aria-label="시작일"> ~ <input type="date" id="sp-to" class="in-t" value="${sp.last}" aria-label="종료일"></span>`;
    h+=`<div class="month spn">${S.sp==='range'?'':'<button data-act="sprev" aria-label="이전">‹</button>'}<div class="m">${lab}</div>${S.sp==='range'?'':'<button data-act="snext" aria-label="다음">›</button>'}
      <select id="smode" class="mode" aria-label="통계 기간">${modes.map(([k,n])=>`<option value="${k}" ${S.sp===k?'selected':''}>${n}</option>`).join('')}</select></div>
    <div class="stabs num"><button data-act="stype" data-k="inc" class="${S.statType==='inc'?'on':''}">수입 <b>${won(t.inc)}원</b></button><button data-act="stype" data-k="exp" class="${S.statType==='exp'?'on':''}">지출 <b>${won(t.exp)}원</b></button></div>`;}
  top.innerHTML=h;}

function rowHtml(t){const isT=t.type==='trf';const name=isT?'이체':(t.cat||'미분류')+(t.sub?' › '+t.sub:'');
  const acc=isT?`${esc(accName(t.acc))} → ${esc(accName(t.to))}`:esc(accName(t.acc))+(t.time?' · '+esc(t.time):'')+(t.auto?' · 반복':'');
  const cls=t.type==='exp'?'exp':t.type==='inc'?'inc':'trf';
  return `<button class="row" data-act="edit" data-id="${esc(t.id)}" data-ym="${t.date.slice(0,7)}"><span class="c">${esc(name)}</span><span class="t">${t.memo?`<b>${esc(t.memo)}</b><small>${acc}</small>`:`<small class="solo">${acc}</small>`}</span><span class="a num ${cls}">${won(t.amount)}원</span></button>`;}

function dayGroups(list){const by={};for(const t of list)(by[t.date]=by[t.date]||[]).push(t);
  return Object.keys(by).sort().reverse().map(d=>{const items=by[d].sort((a,b)=>(b.time||'').localeCompare(a.time||'')||(b.created||0)-(a.created||0));const tt=totals(items);const w=dowOf(d);
    return `<div class="dg"><div class="day"><span class="dn num">${+d.slice(8)}</span><span class="dw ${w===0?'sun':w===6?'sat':''}">${DOW[w]}요일</span><span class="dym num">${d.slice(0,7).replace('-','.')}</span><span class="ds num"><span class="inc">${won(tt.inc)}원</span><span class="exp">${won(tt.exp)}원</span></span></div><div class="rows">${items.map(rowHtml).join('')}</div></div>`;}).join('');}

function filterOn(){const F=S.filter;return !!(F.inc.length||F.exp.length||F.acc.length);}
function passFilter(t){const F=S.filter;if(F.inc.length||F.exp.length){if(t.type==='trf')return false;if(!(F[t.type]||[]).includes(t.cat))return false;}
  if(F.acc.length&&!(F.acc.includes(t.acc)||(t.type==='trf'&&F.acc.includes(t.to))))return false;return true;}
function fBar(){if(!filterOn())return '';const F=S.filter;const n=F.inc.length+F.exp.length+F.acc.length;return `<div class="fon"><span>필터 적용 중 · ${n}개 항목</span><button data-act="open" data-k="filter">바꾸기</button><button data-act="fReset">해제</button></div>`;}
function yearTx(y){return monthsBetween(y+'-01',(y+1)+'-01').flatMap(txOf).filter(t=>{const p0=period(y+'-01'),p1=period((y+1)+'-01');return t.date>=p0.start&&t.date<p1.start;});}

function renderView(){const v=$('#view');
  if(S.needSetup){v.innerHTML=setupHtml();return;}
  if(!S.db){return;}
  if(S.tab==='list'&&S.sub==='memo'&&document.activeElement&&document.activeElement.id==='memo-text')return;
  const ro=!S.canWrite?'<div class="ro">보기 전용으로 열려 있어요. 입력하려면 소유자에게 편집 권한을 받아주세요.</div>':'';
  const p=period(S.label);
  if(S.tab==='list'){v.classList.toggle('flush',S.sub==='daily'||S.sub==='cal'||S.sub==='month');
    if(S.sub==='cal'){v.innerHTML=ro+fBar()+calHtml(p);return;}
    if(S.sub==='month'){v.innerHTML=ro+fBar()+monthlyHtml();return;}
    if(S.sub==='settle'){v.innerHTML=ro+settleHtml(p);return;}
    if(S.sub==='memo'){v.innerHTML=ro+memoHtml();return;}
    const list=txIn(p).filter(passFilter);
    if(!S.loaded&&!list.length){v.innerHTML=ro+'<div class="empty"><b>내역을 불러오는 중이에요</b></div>';return;}
    v.innerHTML=ro+instBanner()+fBar()+(list.length?dayGroups(list):filterOn()?'<div class="empty"><b>필터에 맞는 내역이 없어요</b></div>':`<div class="empty"><b>이번 달 기록이 아직 없어요</b>오른쪽 아래 + 버튼으로 첫 지출을 적거나,<br>카드 문자를 복사해서 붙여넣어 보세요.</div>`);return;}
  v.classList.remove('flush');
  if(S.tab==='stat'){v.innerHTML=statHtml();return;}
  if(S.tab==='asset'){v.innerHTML=assetHtml();return;}
  if(S.tab==='more'){v.innerHTML=moreHtml();return;}}

function calHtml(p){const st=addDays(p.start,-dowOf(p.start));const en=addDays(p.last,6-dowOf(p.last));
  const ms=monthsBetween(st,en);const miss=ms.filter(ym=>!S.live[ym]&&!S.cache[ym]);if(miss.length)ensureMonths(miss);
  const by={};for(const t of ms.flatMap(txOf)){if(t.date<st||t.date>en||!passFilter(t))continue;const o=by[t.date]=by[t.date]||{inc:0,exp:0};if(t.type==='inc')o.inc+=t.amount;else if(t.type==='exp')o.exp+=t.amount;}
  const td=today();let cells='';let d=st;
  while(d<=en){const o=by[d];const out=d<p.start||d>=p.end;const w=dowOf(d);const dn=+d.slice(8);const lab=(dn===1)?(+d.slice(5,7))+'.'+dn:dn;
    cells+=`<button class="cell ${out?'out':''} ${S.selDay===d?'sel':''}" data-act="pickDay" data-d="${d}"><span class="d num ${d===td?'today':''} ${w===0?'sun':w===6?'sat':''}">${lab}</span><span class="cv">${o&&o.inc?'<small class="inc num">'+won(o.inc)+'</small>':''}${o&&o.exp?'<small class="exp num">'+won(o.exp)+'</small>':''}</span></button>`;d=addDays(d,1);}
  let below='';if(S.selDay&&S.selDay>=st&&S.selDay<=en){const items=ms.flatMap(txOf).filter(t=>t.date===S.selDay&&passFilter(t));
    below=items.length?dayGroups(items):`<div class="empty" style="padding:28px 16px"><b>${+S.selDay.slice(5,7)}월 ${+S.selDay.slice(8)}일 내역이 없어요</b>+ 버튼을 누르면 이 날짜로 입력돼요.</div>`;}
  return `<div class="cal"><div class="cal-h">${DOW.map(x=>'<span>'+x+'</span>').join('')}</div><div class="cal-g">${cells}</div></div>${below}`;}

function monthlyHtml(){const y=+S.label.slice(0,4);const labels=[];for(let m=12;m>=1;m--)labels.push(y+'-'+pad(m));
  const ms=uniq(labels.flatMap(l=>period(l).months).concat(monthsBetween(addDays(period(y+'-01').start,-6),period(y+'-01').start)));
  const miss=ms.filter(ym=>!S.live[ym]&&!S.cache[ym]);if(miss.length){ensureMonths(miss);return '<div class="empty"><b>불러오는 중이에요</b></div>';}
  const all=ms.flatMap(txOf).filter(passFilter);const sumIn=(a,b)=>totals(all.filter(t=>t.date>=a&&t.date<b));const td=today();const cur=curLabel();
  return '<div class="rows mrows">'+labels.map(l=>{const p=period(l);const t=sumIn(p.start,p.end);const open=S.openMonth===l;
    let h=`<button class="mrow ${open?'open':''}" data-act="omonth" data-k="${l}"><span class="ml"><b>${+l.slice(5)}월</b>${open||l===cur?`<small class="num">${p.start.slice(5).replace('-','.')} ~ ${p.last.slice(5).replace('-','.')}</small>`:''}</span><span class="num inc">${won(t.inc)}원</span><span class="mr num"><span class="exp">${won(t.exp)}원</span><small>${t.net<0?'-':''}${won(Math.abs(t.net))}원</small></span></button>`;
    if(open){let ws=addDays(p.start,-dowOf(p.start));const wk=[];while(ws<p.end){wk.push(ws);ws=addDays(ws,7);}
      h+=wk.reverse().map(s=>{const e=addDays(s,7);const tt=sumIn(s,e);const now=td>=s&&td<e;
        return `<div class="wrow ${now?'now':''}"><span class="num">${s.slice(5).replace('-','.')} ~ ${addDays(e,-1).slice(5).replace('-','.')}</span><span class="num inc">${won(tt.inc)}원</span><span class="mr num"><span class="exp">${won(tt.exp)}원</span><small>${now?'합계 ':''}${tt.net<0?'-':''}${won(Math.abs(tt.net))}원</small></span></div>`;}).join('');}
    return h;}).join('')+'</div>';}

function settleHtml(p){const prevP=period(shiftLabel(S.label,-1));const miss=prevP.months.filter(ym=>!S.live[ym]&&!S.cache[ym]);if(miss.length)ensureMonths(miss);
  const list=txIn(p);const t=totals(list);const pt=totals(txIn(prevP));const grp=id=>{const a=S.settings.accounts.find(x=>x.id===id);return a?a.group:'';};
  const cb=list.filter(x=>x.type==='exp'&&(grp(x.acc)==='현금'||grp(x.acc)==='은행')).reduce((s,x)=>s+x.amount,0);
  const cd=list.filter(x=>x.type==='exp'&&grp(x.acc)==='카드').reduce((s,x)=>s+x.amount,0);
  const tr=list.filter(x=>x.type==='trf'&&(grp(x.acc)==='현금'||grp(x.acc)==='은행')).reduce((s,x)=>s+x.amount,0);
  const bt=(S.settings.budget||{}).total||0;const bc=(S.settings.budget||{}).cats||{};const byCat={};list.filter(x=>x.type==='exp').forEach(x=>byCat[x.cat]=(byCat[x.cat]||0)+x.amount);
  const bline=(n,used,b)=>{const r=used/b;return `<div class="bl"><div class="blh"><span>${esc(n)}</span><span class="num">${won(used)} / ${won(b)}</span></div><div class="bar ${r>1?'over':''}"><i style="width:${Math.min(100,r*100)}%"></i></div><small class="num">${r>1?'<span class="exp">'+won(used-b)+'원 초과</span>':won(b-used)+'원 남음'}</small></div>`;};
  let bud=bt||Object.keys(bc).length?(bt?bline('전체 예산',t.exp,bt):'')+Object.keys(bc).map(c=>bline(c,byCat[c]||0,bc[c])).join(''):'<p class="muted">예산을 정하면 여기서 얼마나 썼는지 확인할 수 있어요.</p>';
  return `<div class="card"><div class="ovh"><h3>예산</h3><button class="mini" data-act="open" data-k="budget">예산설정 ›</button></div>${bud}</div>
  <div class="card"><div class="ovh"><h3>자산</h3><span class="muted num">${dot2(p.start)} ~ ${dot2(p.last)}</span></div>
  <div class="kv num"><div><span>전월대비 지출 (당월/전월)</span><b>${pt.exp?Math.round(t.exp/pt.exp*100)+'%':'-'}</b></div><div><span>지출 (현금, 은행)</span><b>${won(cb)}원</b></div><div><span>지출 (카드)</span><b>${won(cd)}원</b></div><div><span>이체 (현금, 은행 →)</span><b>${won(tr)}원</b></div></div></div>
  <button class="btn wide" data-act="export" data-k="month">이번 달 엑셀(CSV) 파일로 저장</button>`;}

function memoHtml(){const ym=S.label;if(!S.memo||S.memo.ym!==ym){S.memo={ym,text:'',loaded:false,saved:''};const mm=S.memo;
    S.db.doc('memo/'+ym).get().then(sn=>{if(S.memo!==mm)return;mm.text=sn.exists?(sn.data().text||''):'';mm.saved=mm.text;mm.loaded=true;render();}).catch(()=>{mm.loaded=true;render();});}
  const m=S.memo;if(!m.loaded)return '<div class="empty"><b>불러오는 중이에요</b></div>';
  return `<div class="card"><h3>${+ym.slice(5)}월 메모</h3><textarea class="in-t" id="memo-text" style="min-height:260px" placeholder="이번 달에 기억할 것을 적어두세요. 예: 자동차 보험 갱신, 경조사 일정">${esc(m.text)}</textarea>
  <div class="acts" style="margin-top:10px"><span class="muted" id="memo-st" style="flex:1;align-self:center">${m.text===m.saved?'저장됨':'저장 안 됨'}</span><button class="btn pri" style="flex:0 0 110px" data-act="memoSave" ${S.canWrite?'':'disabled'}>저장</button></div></div>`;}

function donut(items,total){const r=58,C=2*Math.PI*r;let acc=0;const segs=items.map(it=>{const len=total?it.v/total*C:0;const s=`<circle r="${r}" cx="80" cy="80" fill="none" stroke="${it.c}" stroke-width="22" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-acc}"/>`;acc+=len;return s;}).join('');
  return `<svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="분류별 비율"><g transform="rotate(-90 80 80)"><circle r="${r}" cx="80" cy="80" fill="none" stroke="var(--sunk)" stroke-width="22"/>${segs}</g><text x="80" y="76" text-anchor="middle" font-size="12" fill="var(--muted)">${S.statType==='exp'?'총 지출':'총 수입'}</text><text x="80" y="96" text-anchor="middle" font-size="17" font-weight="700" fill="var(--ink)">${compact(total)}원</text></svg>`;}

function statHtml(){const sp=statPeriod();const miss=sp.months.filter(ym=>!S.live[ym]&&!S.cache[ym]);
  if(miss.length){ensureMonths(miss);return '<div class="empty"><b>불러오는 중이에요</b></div>';}
  const ty=S.statType;const list=txIn(sp).filter(t=>t.type===ty);const by={};for(const t of list)by[t.cat||'미분류']=(by[t.cat||'미분류']||0)+t.amount;
  const total=list.reduce((s,t)=>s+t.amount,0);const items=Object.keys(by).map(k=>({k,v:by[k],c:catColor(ty,k)})).sort((a,b)=>b.v-a.v);
  const bc=(S.sp==='month'&&ty==='exp'&&S.settings.budget&&S.settings.budget.cats)||{};
  if(!items.length)return `<div class="empty"><b>이 기간의 ${TYPE_NAME[ty]} 기록이 없어요</b>위에서 기간을 바꿔 보세요.</div>`;
  let h=`<div class="card"><div class="donut">${donut(items,total)}</div></div><div class="rows" style="border-radius:var(--r)">`;
  h+=items.map(it=>{const pct=it.v/total*100;const b=bc[it.k];const r=b?it.v/b:0;const open=S.statCat===it.k;
    let row=`<button class="lg2" data-act="scat" data-k="${esc(it.k)}" aria-expanded="${open}"><span class="pct num" style="background:${it.c}">${pct>=99.5?100:Math.round(pct)}%</span><span class="n">${esc(it.k)}</span><b class="num">${won(it.v)}원</b>
      ${b?`<span class="bud num">예산 ${won(b)} · ${r>1?'<span class="exp">'+won(it.v-b)+' 초과</span>':won(b-it.v)+' 남음'}<span class="bar ${r>1?'over':''}"><i style="width:${Math.min(100,r*100)}%"></i></span></span>`:''}</button>`;
    if(open){const its=list.filter(t=>(t.cat||'미분류')===it.k);const sb={};its.forEach(t=>{const k=t.sub||'(소분류 없음)';sb[k]=(sb[k]||0)+t.amount;});
      const sk=Object.keys(sb);row+=`<div class="drill">${sk.length>1||(sk[0]&&sk[0]!=='(소분류 없음)')?`<div class="subs">${sk.sort((a,b)=>sb[b]-sb[a]).map(k=>`<div class="sl"><span>${esc(k)}</span><span class="num">${Math.round(sb[k]/it.v*100)}% · ${won(sb[k])}원</span></div>`).join('')}</div>`:''}${dayGroups(its)}</div>`;}
    return row;}).join('');
  return h+'</div><p style="font-size:12px;color:var(--muted);padding:8px 4px">분류를 누르면 내역을 볼 수 있어요.</p>';}

function overviewHtml(){const labels=[];for(let i=5;i>=0;i--)labels.push(shiftLabel(S.label,-i));
  const all=allMonths().flatMap(txOf);const init=S.settings.accounts.reduce((s,a)=>s+(Number(a.init)||0),0);
  const data=labels.map(l=>{const p=period(l);const t=totals(txIn(p));let cum=init;for(const x of all){if(x.date<p.end){if(x.type==='inc')cum+=x.amount;else if(x.type==='exp')cum-=x.amount;}}return Object.assign({l,cum},t);});
  const W=600,H=210,L=92,R=24,T=18,B=24;let mn=Math.min(...data.map(d=>d.cum)),mx=Math.max(...data.map(d=>d.cum));if(mn===mx){mn-=1e5;mx+=1e5;}
  const span=mx-mn;mn-=span*.12;mx+=span*.12;const X=i=>L+i*(W-L-R)/5,Y=v=>T+(mx-v)/(mx-mn)*(H-T-B);
  const ticks=[0,1,2,3].map(k=>mn+(mx-mn)*k/3);
  const line=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="누적잔액 추이">${ticks.map(v=>`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L-10}" y="${Y(v)+6}" text-anchor="end" font-size="17" fill="var(--muted)">${compact(v)}</text>`).join('')}
    <polyline fill="none" stroke="var(--accent)" stroke-width="3" points="${data.map((d,i)=>X(i)+','+Y(d.cum)).join(' ')}"/>${data.map((d,i)=>`<circle cx="${X(i)}" cy="${Y(d.cum)}" r="${d.l===S.label?7:5}" fill="var(--accent)"/>`).join('')}</svg>`;
  const bm=Math.max(1,...data.map(d=>Math.max(d.inc,d.exp)));const last=data[5];const [y,m]=S.label.split('-');
  return `<div class="card"><div class="ovh"><h3>전체 통계</h3><div class="mini-nav"><button data-act="prev" aria-label="이전 달">‹</button><span>${y}년 ${+m}월</span><button data-act="next" aria-label="다음 달">›</button></div></div>
  <span class="lbl">누적잔액</span><div class="big num ${last.cum<0?'exp':''}">${won(last.cum)}원</div>${line}
  <div class="vals num">${data.map(d=>`<div class="${d.l===S.label?'cur':''}"><small>${+d.l.slice(5)}월</small><b class="${d.cum<0?'exp':''}">${compact(d.cum)}</b></div>`).join('')}</div>
  <div class="trend">${data.map(d=>`<div class="tc ${d.l===S.label?'cur':''}"><div class="tb"><i class="ii" style="height:${d.inc/bm*100}%"></i><i class="ie" style="height:${d.exp/bm*100}%"></i></div></div>`).join('')}</div>
  <div class="vals num">${data.map(d=>`<div class="${d.l===S.label?'cur':''}"><small>${+d.l.slice(5)}월</small><b class="inc">${compact(d.inc)}</b><b class="exp">${compact(d.exp)}</b></div>`).join('')}</div></div>`;}

function allMonths(){return Object.keys(S.settings.months||{}).sort();}
function assetHtml(){const ms=allMonths();const pending=ms.some(ym=>!S.live[ym]&&!S.cache[ym]);
  if(pending){ensureMonths(ms);return '<div class="empty"><b>잔액을 계산하는 중이에요</b></div>';}
  const bal={};S.settings.accounts.forEach(a=>bal[a.id]=Number(a.init)||0);
  for(const ym of ms)for(const t of txOf(ym)){if(t.type==='inc'){if(t.acc in bal)bal[t.acc]+=t.amount;}else if(t.type==='exp'){if(t.acc in bal)bal[t.acc]-=t.amount;}else{if(t.acc in bal)bal[t.acc]-=t.amount;if(t.to in bal)bal[t.to]+=t.amount;}}
  let pos=0,neg=0;Object.values(bal).forEach(v=>v>=0?pos+=v:neg+=v);
  if(S.overview)return `<button class="back" data-act="ovw" data-k="0">‹ 자산으로 돌아가기</button>`+overviewHtml();
  let h=`<div class="card"><div class="net num"><div><span>자산</span><b class="inc">${won(pos)}</b></div><div><span>부채</span><b class="exp">${won(-neg)}</b></div><div><span>순자산</span><b>${sgn(pos+neg)}</b></div></div></div>`;
  for(const g of GROUPS){const accs=S.settings.accounts.filter(a=>(a.group||'기타')===g);if(!accs.length)continue;const sum=accs.reduce((s,a)=>s+bal[a.id],0);
    h+=`<div class="grp"><div class="grp-h"><span>${g}</span><span class="num">${sgn(sum)}</span></div><div class="rows" style="border-radius:var(--r)">${accs.map(a=>`<div class="acc"><span>${esc(a.name)}</span><b class="num ${bal[a.id]<0?'exp':''}">${won(bal[a.id])}</b></div>`).join('')}</div></div>`;}
  h+=`<div class="menu"><button data-act="ovw" data-k="1"><span>전체 통계 보기</span><small>누적잔액 · 월별 추이 ›</small></button><button data-act="open" data-k="accounts"><span>계좌·카드 추가 및 수정</span><small>›</small></button></div><p style="font-size:12px;color:var(--muted);padding:0 4px">잔액 = 시작 잔액 + 수입 − 지출 ± 이체. 카드는 쓴 만큼 마이너스로 쌓이고, 카드값을 통장에서 ‘이체’로 넣으면 0으로 돌아와요.</p>`;
  return h;}

function moreHtml(){const st=S.settings;const bt=st.budget&&st.budget.total;
  return `${isStandalone()?'':`<div class="card inst"><img src="logo-mark.svg" alt="" width="56" height="56"><div><b>티끌모아를 앱으로 설치</b><span class="muted">홈 화면 아이콘으로 바로 열려요</span></div><button class="btn pri" data-act="install">설치</button></div>`}<div class="menu">
  <button data-act="open" data-k="search"><span>내역 검색</span><small>›</small></button>
  <button data-act="open" data-k="sms"><span>카드 문자 붙여넣기</span><small>여러 건 한 번에</small></button></div>
  <div class="menu">
  <button data-act="open" data-k="budget"><span>예산</span><small class="num">${bt?'월 '+won(bt)+'원':'설정 안 함'}</small></button>
  <button data-act="open" data-k="cats"><span>분류 편집</span><small>지출 ${st.cats.exp.length} · 수입 ${st.cats.inc.length}</small></button>
  <button data-act="open" data-k="accounts"><span>계좌·카드</span><small>${st.accounts.length}개</small></button>
  <button data-act="open" data-k="recurring"><span>반복 입력</span><small>${(st.recurring||[]).length}건</small></button>
  <button data-act="open" data-k="favorites"><span>자주 쓰는 내역</span><small>${(st.favorites||[]).length}건</small></button>
  <button data-act="open" data-k="monthStart"><span>월 시작일</span><small>매월 ${st.monthStart||1}일</small></button>
  <button data-act="open" data-k="sync"><span>동기화 연결</span><small>${GH.err?'<span class="exp">끊김</span>':'정상'}</small></button>
  <button data-act="open" data-k="pin"><span>비밀번호 잠금</span><small>${st.pin?'사용 중':'사용 안 함'}</small></button></div>
  <div class="menu">
  <button data-act="export" data-k="month"><span>이번 달 엑셀(CSV) 내보내기</span><small>›</small></button>
  <button data-act="export" data-k="all"><span>전체 내역 엑셀(CSV) 내보내기</span><small>›</small></button></div>
  <div class="card help"><h3>여러 휴대폰에서 같이 쓰기</h3>
  <p><b>내 폰 여러 대</b> — 각 폰에서 이 주소를 열고 같은 저장소·토큰으로 한 번 연결하면 끝이에요. 한쪽에서 입력하면 다른 폰에는 20초 안에, 앱을 열 때는 바로 맞춰져요.</p>
  <p><b>가족과 함께</b> — 가족 폰에도 같은 저장소 토큰으로 연결하면 같은 장부에 함께 적을 수 있어요.</p>
  <p><b>앱처럼 쓰기</b> — 휴대폰 브라우저에서 링크를 연 뒤 ‘홈 화면에 추가’를 누르면 아이콘으로 바로 열려요.</p></div>`;}

/* ---------- sheets ---------- */
function openSheet(k){S.sheet=k;renderSheet();}
function closeSheet(){S.sheet=null;$('#sheetRoot').innerHTML='';}
function renderSheet(){if(!S.sheet){closeSheet();return;}const fn=SHEETS[S.sheet];if(!fn)return;
  const sc=$('.sheet')?$('.sheet').scrollTop:0;
  const full=['tx','search','favorites','filter'].includes(S.sheet);const sc2=$('.txb')?$('.txb').scrollTop:0;const sc3=$('.sres')?$('.sres').scrollTop:0;
  $('#sheetRoot').innerHTML=`<div class="ov ${full?'full':''}" data-act="ovClose"><div class="sheet ${full?'full':''}" role="dialog" aria-modal="true">${(full?'':'<div class="grab"></div>')+fn()}</div></div>`;
  const sh=$('.sheet');if(sh)sh.scrollTop=sc;const tb=$('.txb');if(tb)tb.scrollTop=sc2;const sr=$('.sres');if(sr)sr.scrollTop=sc3;}
function head(t,extra){return `<div class="sh-h"><h2>${t}</h2>${extra||''}<button class="x" data-act="close" aria-label="닫기">×</button></div>`;}
function accOptions(sel){return GROUPS.map(g=>{const a=S.settings.accounts.filter(x=>(x.group||'기타')===g);return a.length?`<optgroup label="${g}">${a.map(x=>`<option value="${esc(x.id)}" ${x.id===sel?'selected':''}>${esc(x.name)}</option>`).join('')}</optgroup>`:'';}).join('');}
function catOptions(type,sel){return (S.settings.cats[type]||[]).map(c=>`<option ${c===sel?'selected':''}>${esc(c)}</option>`).join('');}

function lastAcc(){try{const a=localStorage.getItem('moneybook.acc');if(a&&S.settings.accounts.some(x=>x.id===a))return a;}catch(e){}const c=S.settings.accounts.find(a=>a.group==='카드');return (c||S.settings.accounts[0]||{}).id||'';}
function defaultDate(){if(S.tab==='list'&&S.sub==='cal'&&S.selDay)return S.selDay;const p=period(S.label);const t=today();return (t>=p.start&&t<p.end)?t:p.start;}
function openTx(t){if(t){S.form=Object.assign({},t,{amountStr:String(t.amount),orig:t.id?{id:t.id,ym:t.date.slice(0,7)}:null,panel:''});}
  else S.form={type:'exp',amountStr:'',date:defaultDate(),cat:'',sub:'',acc:lastAcc(),to:'',memo:'',time:'',fav:false,panel:'amt',rep:'',inst:0,calcOn:false};
  S.form.confirmDel=false;S.form.err='';S.form.subPick=false;openSheet('tx');}

function fmtExpr(s){return esc(String(s).replace(/,/g,'').replace(/\d+/g,m=>won(Number(m))).replace(/\*/g,'×').replace(/\//g,'÷').replace(/-/g,'−'));}
function addMonths(s,i){const [y,m,d]=s.split('-').map(Number);const b=new Date(y,m-1+i,1);const ym=b.getFullYear()+'-'+pad(b.getMonth()+1);return ym+'-'+pad(Math.min(d,daysIn(ym)));}
function kpHead(t,extra){return `<div class="kp-h"><span>${t}</span><span class="kp-r">${extra||''}<button data-act="panel" data-k="" aria-label="닫기">×</button></span></div>`;}
function panelHtml(f){const p=f.panel;
  if(p==='amt'||p==='fee'){const k=(v,l,c)=>`<button data-act="kp" data-k="${v}" class="${c||''}">${l||v}</button>`;
    return kpHead(p==='fee'?'수수료':'금액')+(f.calcOn?`<div class="kpg ops">${k('+','+','op')}${k('−','−','op')}${k('×','×','op')}${k('÷','÷','op')}</div>`:'')+
    `<div class="kpg">${k('1')}${k('2')}${k('3')}${k('back','⌫','op')}${k('4')}${k('5')}${k('6')}${k('−','−','op')}${k('7')}${k('8')}${k('9')}${k('calc','<svg viewBox="0 0 24 24" class="ic"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2"/></svg>','op '+(f.calcOn?'on':''))}${k('00')}${k('0')}${k('000')}${k('done','완료','done')}</div>`;}
  if(p==='cat'){if(f.subPick){const subs=subsOf(f.type,f.cat);return kpHead(esc(f.cat),`<button class="kp-l" data-act="subBack">‹ 분류</button>`)+`<div class="pg"><button data-act="pickSub" data-k="" class="${!f.sub?'on':''}">없음</button>${subs.map(s=>`<button data-act="pickSub" data-k="${esc(s)}" class="${f.sub===s?'on':''}">${esc(s)}</button>`).join('')}</div>`;}
    const cats=S.settings.cats[f.type]||[];return kpHead('분류',`<button class="kp-l" data-act="open" data-k="cats">편집</button>`)+`<div class="pg">${cats.map(c=>`<button data-act="pickCat" data-k="${esc(c)}" class="${f.cat===c?'on':''}">${esc(c)}${S.settings.subOn&&subsOf(f.type,c).length?'<small>›</small>':''}</button>`).join('')}</div>`;}
  if(p==='acc'||p==='to'){const sel=p==='acc'?f.acc:f.to;return kpHead(f.type==='trf'?(p==='acc'?'출금':'입금'):'자산',`<button class="kp-l" data-act="open" data-k="accounts">편집</button>`)+
    `<div class="pg">${GROUPS.flatMap(g=>S.settings.accounts.filter(a=>(a.group||'기타')===g)).map(a=>`<button data-act="pickAcc" data-k="${esc(a.id)}" class="${sel===a.id?'on':''}">${esc(a.name)}<small>${esc(a.group||'')}</small></button>`).join('')}</div>`;}
  if(p==='rep'){const opt=(v,l,on)=>`<button data-act="repSet" data-k="${v}" class="${on?'on':''}">${l}</button>`;
    return kpHead('반복 / 할부')+`<div class="pg">${opt('none','없음',!f.rep&&!(f.inst>1))}${opt('monthly','매월 반복',f.rep==='monthly')}${[2,3,4,5,6,10,12].map(n=>opt('inst'+n,n+'개월 할부',f.inst===n)).join('')}</div>
    <p class="muted" style="padding:8px 16px 12px;margin:0">매월 반복은 다음 달부터 같은 날짜에 자동으로 적혀요. 할부는 금액을 나눠 달마다 한 건씩 적어요.</p>`;}
  return '';}

const SHEETS={
 tx(){const f=S.form;const edit=!!f.orig;const val=calc(f.amountStr);const ops=/[+\-*/×÷−]/.test(f.amountStr.replace(/^-/,''));
  const [yy,mm,dd]=f.date.split('-');const dl=`${yy.slice(2)}. ${mm}. ${dd}. (${DOW[dowOf(f.date)]})`;
  const catTxt=f.cat?esc(f.cat)+(f.sub?' <span class="muted">› '+esc(f.sub)+'</span>':''):'';
  const frow=(lab,k,txt)=>`<div class="frow ${f.panel===k?'act':''}"><span class="fl">${lab}</span><button class="fv" data-act="panel" data-k="${k}">${txt||'<span class="ph">선택</span>'}</button></div>`;
  let h=`<div class="txb t-${f.type}"><div class="txh"><button class="x" data-act="close" aria-label="닫기">←</button><h2>${edit?'내역 수정':TYPE_NAME[f.type]}</h2>
    ${edit?'':`<button class="x hx" data-act="open" data-k="sms" aria-label="문자 붙여넣기">${HICON.sms}</button><button class="x hx" data-act="txFav" aria-label="자주 쓰는 내역">${HICON.fav}</button>`}</div>
  <div class="tseg">${['inc','exp','trf'].map(k=>`<button data-act="ftype" data-k="${k}" class="${f.type===k?'on '+k:''}">${TYPE_NAME[k]}</button>`).join('')}</div>
  <div class="frow"><span class="fl">날짜</span><label class="fv date num"><span>${dl}</span><input type="date" id="f-date" value="${esc(f.date)}" aria-label="날짜"></label>
    ${edit?'':`<button class="repb ${f.inst>1||f.rep?'on':''}" data-act="panel" data-k="rep"><svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4"/></svg><small>${f.inst>1?f.inst+'개월 할부':f.rep?'매월 반복':'반복/할부'}</small></button>`}</div>
  <div class="frow ${f.panel==='amt'?'act':''}"><span class="fl">금액</span><button class="fv amtv num" data-act="panel" data-k="amt">${f.amountStr?fmtExpr(f.amountStr)+(ops&&!isNaN(val)?` <small>= ${won(val)}원</small>`:'원'):'<span class="ph">&nbsp;</span>'}</button>${f.type==='trf'?`<button class="feeb num ${f.panel==='fee'||calc(f.feeStr||'')>0?'on':''}" data-act="panel" data-k="fee">${calc(f.feeStr||'')>0?'수수료 '+won(calc(f.feeStr)):'수수료'}</button>`:''}</div>
  ${f.type==='trf'?`<div class="swapw">${frow('출금','acc',f.acc?esc(accName(f.acc)):'')+frow('입금','to',f.to?esc(accName(f.to)):'')}<button class="swapb" data-act="swapAcc" aria-label="출금과 입금 바꾸기">↓↑</button></div>`:frow('분류','cat',catTxt)+frow('자산','acc',f.acc?esc(accName(f.acc)):'')}
  <div class="frow"><span class="fl">내용</span><input class="fv" id="f-memo" placeholder="" value="${esc(f.memo)}" autocomplete="off" data-act="memoFocus"></div>
  ${edit?'':`<label class="chk"><input type="checkbox" id="f-fav" ${f.fav?'checked':''}> 자주 쓰는 내역에 추가</label>`}
  <div class="err" id="f-err">${esc(f.err)}</div>
  ${f.panel?'':`<div class="acts">${edit?`<button class="btn danger ${f.confirmDel?'go':''}" data-act="delTx">${f.confirmDel?'정말 삭제':'삭제'}</button>`:'<button class="btn" data-act="saveTx" data-k="more">계속 입력</button>'}<button class="btn pri" data-act="saveTx">저장</button></div>`}</div>`;
  if(f.panel)h+=`<div class="kp">${panelHtml(f)}</div>`;
  return h;},

 sms(){const s=S.sms||(S.sms={text:'',items:null});
  let h=head('카드 문자 붙여넣기')+`<p style="margin:0;font-size:14px;color:var(--muted)">카드·은행 문자를 복사해 붙여넣으세요. 여러 건을 한꺼번에 넣어도 한 건씩 나눠서 읽어요.</p>
  <div class="f"><textarea class="in-t" id="sms-text" placeholder="[Web발신]&#10;신한카드(1234)승인 김*진 12,500원(일시불)10/27 11:01 스타벅스 누적1,234,560원">${esc(s.text)}</textarea></div>
  <div class="acts" style="margin-top:10px"><button class="btn pri" data-act="smsParse">문자 읽기</button></div>`;
  if(s.items){if(!s.items.length)h+='<div class="err">금액을 찾지 못했어요. 카드 승인·출금·입금 문자인지 확인해 주세요.</div>';
   else{h+=s.items.map((it,i)=>`<div class="prev ${it.dup?'dup':''}"><input type="checkbox" data-act="smsChk" data-i="${i}" ${it.on?'checked':''} aria-label="선택"><div class="m"><b>${esc(it.memo||'(내용 없음)')}</b><small class="num">${it.date.slice(5).replace('-','.')} ${esc(it.time)} · ${it.dup?'이미 입력된 내역':TYPE_NAME[it.type]}</small></div><b class="num ${it.type}">${it.type==='exp'?'−':'+'}${won(it.amount)}</b>
     <div class="sel2"><select data-sms="cat" data-i="${i}" aria-label="분류">${catOptions(it.type,it.cat)}</select><select data-sms="acc" data-i="${i}" aria-label="자산">${accOptions(it.acc)}</select></div></div>`).join('');
    const n=s.items.filter(x=>x.on).length;h+=`<div class="acts"><button class="btn pri" data-act="smsSave" ${n?'':'disabled'}>선택한 ${n}건 저장</button></div>`;}}
  return h;},

 search(){const q=S.search.trim();const ms=allMonths();const loading=ms.some(ym=>!S.live[ym]&&!S.cache[ym]);
  let res=[];if(q&&!loading){const ql=q.toLowerCase().replace(/,/g,'');res=ms.flatMap(txOf).filter(t=>(t.memo||'').toLowerCase().includes(ql)||(t.cat||'').toLowerCase().includes(ql)||(t.sub||'').toLowerCase().includes(ql)||String(t.amount).includes(ql)||accName(t.acc).toLowerCase().includes(ql)).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,200);}
  const sum=totals(res);
  return `<div class="txb fl0"><div class="txh"><button class="x" data-act="close" aria-label="닫기">←</button><h2>검색</h2></div>
  <div class="sbox">${HICON.search}<input id="q" placeholder="가게 이름, 분류, 금액, 카드" value="${esc(S.search)}" autocomplete="off" enterkeyhint="search"></div></div>
  <div class="sres">${loading?'<div class="empty">전체 내역을 불러오는 중…</div>':q?(res.length?`<div class="sinfo num">${res.length}건 · 수입 <span class="inc">${won(sum.inc)}원</span> · 지출 <span class="exp">${won(sum.exp)}원</span></div>`+dayGroups(res):'<div class="empty">찾는 내역이 없어요</div>'):'<div class="empty">검색어를 입력하세요</div>'}</div>`;},

 budget(){const d=S.budDraft;return head('예산')+`<p style="margin:0;font-size:14px;color:var(--muted)">한 달 지출 목표예요. 0이면 표시하지 않아요.</p>
  <div class="f"><label for="b-total">월 전체 예산</label><input class="in-t num" id="b-total" inputmode="numeric" value="${d.total?won(d.total):''}" placeholder="예: 2,500,000"></div>
  <div class="f"><span class="lbl">분류별 예산</span>${S.settings.cats.exp.map(c=>`<div class="bud-row"><span>${esc(c)}</span><input class="in-t num" inputmode="numeric" data-bud="${esc(c)}" value="${d.cats[c]?won(d.cats[c]):''}" placeholder="0"></div>`).join('')}</div>
  <div class="acts"><button class="btn pri" data-act="saveBudget">저장</button></div>`;},

 cats(){const t=S.catType;const list=S.settings.cats[t];const on=!!S.settings.subOn;return head('분류 편집')+`<div class="seg">${['exp','inc'].map(k=>`<button data-act="ctype" data-k="${k}" class="${t===k?'on '+k:''}">${TYPE_NAME[k]}</button>`).join('')}</div>
  <label class="chk sw"><span>소분류 기능</span><input type="checkbox" data-act="subToggle" ${on?'checked':''}></label>
  <div class="lst" style="margin-top:12px">${list.map((c,i)=>{const subs=subsOf(t,c);const ed=S.catEdit===i;
    return `<div class="li"><i class="dot" style="width:10px;height:10px;border-radius:3px;background:${catColor(t,c)}"></i><span class="g">${esc(c)}${on&&subs.length?' ('+subs.length+')':''}${on&&subs.length?`<small>${esc(subs.join(', '))}</small>`:''}</span>
      <button class="mini" data-act="catEdit" data-i="${i}">${ed?'닫기':'수정'}</button><button class="mini" data-act="catUp" data-i="${i}" ${i?'':'disabled'} aria-label="위로">↑</button><button class="mini ${S.catDelAsk===i?'exp':''}" data-act="catDel" data-i="${i}">${S.catDelAsk===i?'정말 삭제':'삭제'}</button></div>
      ${ed?`<div class="ce"><div style="display:flex;gap:8px"><input class="in-t" id="c-name" value="${esc(c)}" aria-label="분류 이름"><button class="btn" style="flex:0 0 96px" data-act="catRename" data-i="${i}">이름 저장</button></div>
        <span class="lbl">소분류${on?'':' (소분류 기능을 켜야 입력할 때 보여요)'}</span><div class="chips">${subs.map((x,j)=>`<span class="chip">${esc(x)}<button class="del" data-act="subDel" data-i="${i}" data-j="${j}" aria-label="${esc(x)} 삭제">×</button></span>`).join('')||'<span style="color:var(--muted);font-size:13px">없음</span>'}</div>
        <div style="display:flex;gap:8px"><input class="in-t" id="s-new" placeholder="새 소분류"><button class="btn pri" style="flex:0 0 80px" data-act="subAdd" data-i="${i}">추가</button></div></div>`:''}`;}).join('')}</div>
  <div class="f"><label for="c-new">새 분류</label><div style="display:flex;gap:8px"><input class="in-t" id="c-new" placeholder="예: 반려동물"><button class="btn pri" style="flex:0 0 80px" data-act="catAdd">추가</button></div></div>
  <p style="font-size:12px;color:var(--muted)">분류 이름을 바꾸거나 지워도 이미 적은 내역은 예전 이름 그대로 남아요.</p>`;},

 accounts(){const d=S.accDraft;return head('계좌·카드')+`<p style="margin:0;font-size:14px;color:var(--muted)">시작 잔액에는 가계부를 처음 쓰는 날의 잔액을 적으세요. 대출은 마이너스로 적으면 돼요.</p>
  <div class="lst" style="margin-top:12px">${d.map((a,i)=>`<div class="ar"><input class="in-t" data-acc="name" data-i="${i}" value="${esc(a.name)}" placeholder="이름" aria-label="이름"><select class="in-t" data-acc="group" data-i="${i}" aria-label="종류">${GROUPS.map(g=>`<option ${g===a.group?'selected':''}>${g}</option>`).join('')}</select>
   <div class="full"><input class="in-t num" data-acc="init" data-i="${i}" inputmode="numeric" value="${a.init?won(a.init):''}" placeholder="시작 잔액 0" aria-label="시작 잔액"><button class="mini btn" style="flex:0 0 64px;padding:8px" data-act="accDel" data-i="${i}">삭제</button></div></div>`).join('')}</div>
  <div class="acts"><button class="btn" data-act="accAdd">+ 계좌·카드 추가</button><button class="btn pri" data-act="saveAcc">저장</button></div>`;},

 recurring(){const r=S.recDraft;const list=S.settings.recurring||[];return head('반복 입력')+`<p style="margin:0;font-size:14px;color:var(--muted)">월세, 통신비, 적금처럼 매달 같은 날 나가는 돈을 등록하면 그날이 되면 가계부를 열 때 자동으로 적혀요.</p>
  ${list.length?`<div class="lst" style="margin-top:12px">${list.map((x,i)=>`<div class="li"><span class="g">${esc(x.memo||x.cat)}<small class="num">매월 ${x.day}일 · ${TYPE_NAME[x.type]} ${won(x.amount)}원 · ${esc(accName(x.acc))}</small></span><button class="mini" data-act="recDel" data-i="${i}">삭제</button></div>`).join('')}</div>`:''}
  <div class="card" style="background:var(--bg);margin-top:14px"><h3>새 반복 내역</h3>
  <div class="seg">${['exp','inc','trf'].map(k=>`<button data-act="rtype" data-k="${k}" class="${r.type===k?'on '+k:''}">${TYPE_NAME[k]}</button>`).join('')}</div>
  <div class="two"><div class="f"><label for="r-day">매월</label><select class="in-t" id="r-day">${Array.from({length:31},(_,i)=>`<option value="${i+1}" ${r.day===i+1?'selected':''}>${i+1}일</option>`).join('')}</select></div>
  <div class="f"><label for="r-amt">금액</label><input class="in-t num" id="r-amt" inputmode="numeric" value="${r.amount?won(r.amount):''}" placeholder="0"></div></div>
  ${r.type==='trf'?'':`<div class="f"><label for="r-cat">분류</label><select class="in-t" id="r-cat">${catOptions(r.type,r.cat)}</select></div>`}
  <div class="two"><div class="f"><label for="r-acc">${r.type==='trf'?'보내는 곳':'자산'}</label><select class="in-t" id="r-acc">${accOptions(r.acc)}</select></div>
  ${r.type==='trf'?`<div class="f"><label for="r-to">받는 곳</label><select class="in-t" id="r-to">${accOptions(r.to)}</select></div>`:'<div></div>'}</div>
  <div class="f"><label for="r-memo">내용</label><input class="in-t" id="r-memo" value="${esc(r.memo)}" placeholder="예: 휴대폰 요금"></div>
  <label class="chk"><input type="checkbox" id="r-now" ${r.now?'checked':''}> 이번 달 것도 바로 입력 (날짜가 이미 지났을 때)</label>
  <div class="err">${esc(r.err||'')}</div>
  <div class="acts"><button class="btn pri" data-act="recAdd">등록</button></div></div>`;},

 favorites(){const list=S.settings.favorites||[];const ed=S.favEdit;
  return `<div class="txb fl0"><div class="txh"><button class="x" data-act="close" aria-label="닫기">←</button><h2>자주 사용하는 내역</h2>${list.length?`<button class="x hx" data-act="favEditT" aria-label="편집">${ed?'<span style="font-size:16px;font-weight:600">완료</span>':'<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>'}</button>`:''}</div></div>
  <div class="sres">${list.length?`<div class="rows">${list.map((x,i)=>{const isT=x.type==='trf';const cls=x.type==='exp'?'exp':x.type==='inc'?'inc':'trf';const name=isT?'이체':(x.cat||'')+(x.sub?' › '+x.sub:'');
    return `<div class="frw">${ed?`<button class="fdel" data-act="favDel" data-i="${i}" aria-label="삭제">−</button>`:''}<button class="row" data-act="${ed?'':'favUse'}" data-i="${i}"><span class="c">${esc(name)}</span><span class="t"><b>${esc(x.memo||name)}</b><small class="${cls}">${esc(accName(x.acc))}${isT?' → '+esc(accName(x.to)):''}</small></span><span class="a num ${cls}">${won(x.amount)}원</span></button></div>`;}).join('')}</div>
    <p class="muted" style="padding:10px 16px">${ed?'− 버튼으로 지울 수 있어요.':'누르면 그 내용으로 입력 화면이 열려요.'}</p>`:'<div class="empty"><b>아직 없어요</b>새 내역을 적을 때 ‘자주 쓰는 내역에 추가’를 체크하면 여기에 쌓여요.</div>'}</div>`;},
 filter(){const p=period(S.label);const all=txIn(p);const vis=all.filter(passFilter);const ta=totals(all),tv=totals(vis);const [y,m]=S.label.split('-');const F=S.filter;const tab=S.fTab;
  const ring=(pct,c,soft,lab,amt)=>{const r=38,C=2*Math.PI*r;return `<div class="ring"><span class="muted">${lab}</span><svg viewBox="0 0 100 100" width="96" height="96"><circle cx="50" cy="50" r="${r}" fill="none" stroke="${soft}" stroke-width="12"/><circle cx="50" cy="50" r="${r}" fill="none" stroke="${c}" stroke-width="12" stroke-dasharray="${C*pct} ${C}" transform="rotate(-90 50 50)" stroke-linecap="round"/><text x="50" y="56" text-anchor="middle" font-size="17" fill="var(--ink)">${Math.round(pct*100)}%</text></svg><b class="num">${won(amt)}원</b></div>`;};
  const pI=ta.inc?tv.inc/ta.inc:0,pE=ta.exp?tv.exp/ta.exp:0;
  const chk=(g,k,lab)=>`<label class="fck"><input type="checkbox" data-fg="${g}" value="${esc(k)}" ${F[g].includes(k)?'checked':''}><span>${esc(lab)}</span></label>`;
  let items='';
  if(tab==='acc'){items=GROUPS.map(g=>{const a=S.settings.accounts.filter(x=>(x.group||'기타')===g);return a.length?`<div class="fgh">${g}</div>${a.map(x=>chk('acc',x.id,x.name)).join('')}`:'';}).join('');}
  else items=(S.settings.cats[tab]||[]).map(c=>chk(tab,c,c)).join('');
  const allKeys=tab==='acc'?S.settings.accounts.map(a=>a.id):(S.settings.cats[tab]||[]);const allOn=allKeys.length&&allKeys.every(k=>F[tab].includes(k));
  return `<div class="txb fl0"><div class="txh"><button class="x" data-act="close" aria-label="닫기">←</button><div class="lnav" style="flex:1"><button data-act="prev" aria-label="이전 달">‹</button><b>${y}년 ${+m}월</b><button data-act="next" aria-label="다음 달">›</button></div><button class="link" data-act="fReset">초기화</button></div>
  <div class="fbar">필터링 할 항목을 선택하세요.${filterOn()?' 선택한 항목만 보여요.':' 아무것도 고르지 않으면 전체가 보여요.'}</div>
  <div class="rings">${ring(pI,'var(--inc)','color-mix(in srgb, var(--inc) 22%, transparent)','수입',tv.inc)}${ring(pE,'var(--exp)','color-mix(in srgb, var(--exp) 22%, transparent)','지출',tv.exp)}<div class="ring"><span class="muted">합계</span><b class="num" style="font-size:19px;margin-top:30px">${tv.net<0?'-':''}${won(Math.abs(tv.net))}원</b></div></div>
  <div class="stabs ftabs">${[['inc','수입'],['exp','지출'],['acc','자산']].map(([k,n])=>`<button data-act="fTab" data-k="${k}" class="${tab===k?'on':''}">${n}${F[k].length?' <small>'+F[k].length+'</small>':''}</button>`).join('')}</div></div>
  <div class="sres"><label class="fck fall"><input type="checkbox" data-fg="all" ${allOn?'checked':''}><span>전체</span></label>${items}</div>
  <div class="kp" style="padding:10px max(16px,env(safe-area-inset-left,0px)) calc(10px + env(safe-area-inset-bottom,0px));display:flex;gap:8px"><button class="btn pri" data-act="close">적용</button></div>`;},

 pin(){const d=S.pinDraft;const st=S.settings;
  if(d){return head(d.step===1?'새 비밀번호':'한 번 더 입력')+`<p style="margin:0;text-align:center;color:var(--muted)">${d.step===1?'숫자 4자리를 입력하세요':'확인을 위해 같은 번호를 입력하세요'}</p>${dotsHtml(d.cur.length,!!d.err)}<div class="err" style="text-align:center">${esc(d.err||'')}</div>${padHtml()}`;}
  return head('비밀번호 잠금')+`<p style="margin:0;font-size:14px;color:var(--muted)">가계부를 열 때 4자리 비밀번호를 물어봐요. 모든 휴대폰에 똑같이 적용돼요. 지문·얼굴 인식은 이 화면에서 쓸 수 없어요.</p>
  ${st.pin?`<div class="f"><label for="lockMin">다시 잠그기</label><select class="in-t" id="lockMin">${[[0,'화면을 벗어나면 바로'],[1,'1분 뒤'],[5,'5분 뒤'],[30,'30분 뒤']].map(([v,n])=>`<option value="${v}" ${(st.lockMin??1)===v?'selected':''}>${n}</option>`).join('')}</select></div>
  <div class="acts"><button class="btn danger" data-act="pinOff">잠금 끄기</button><button class="btn" data-act="pinStart">비밀번호 바꾸기</button></div>`:
  `<div class="acts"><button class="btn pri" data-act="pinStart">비밀번호 설정</button></div>`}`;},
install(){const ios=isIOS();const pc=isPC();return head('앱으로 설치')+`<div style="text-align:center;margin:4px 0 14px"><img src="logo.png" alt="티끌모아" style="width:100%;max-width:320px;border-radius:12px"></div>
  ${pc?`<ol class="steps"><li><b>크롬</b>이나 <b>엣지</b>로 이 주소를 열어주세요.</li><li>주소창 오른쪽 끝의 <b>설치 아이콘</b>(모니터에 화살표)을 누르세요. 안 보이면 메뉴 ⋮ → <b>저장 및 공유 → 페이지를 앱으로 설치</b> (엣지는 … → <b>앱 → 이 사이트를 앱으로 설치</b>)</li><li><b>설치</b>를 누르면 바탕화면과 시작 메뉴에 티끌모아가 생겨요.</li></ol>`:ios?`<ol class="steps"><li><b>사파리</b>로 이 주소를 열어주세요.</li><li>아래쪽 <b>공유 버튼</b>(네모에 화살표)을 누르세요.</li><li><b>홈 화면에 추가</b>를 누르고 <b>추가</b>를 누르면 끝이에요.</li></ol>`:
  `<ol class="steps"><li><b>크롬</b>이나 <b>삼성 인터넷</b>으로 이 주소를 열어주세요.</li><li>오른쪽 위(삼성 인터넷은 아래) <b>메뉴 ⋮ / ≡</b>를 누르세요.</li><li><b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누르면 끝이에요.</li></ol>`}
  <p class="muted">설치하면 주소창 없이 앱처럼 열리고, 기기마다 처음 한 번만 동기화 연결을 하면 돼요. 업데이트는 앱을 열 때 자동으로 받아요.</p>`;},
 sync(){const c=ghCfg()||{};const t=GH.lastOk?new Date(GH.lastOk):null;return head('동기화 연결')+`<div class="kv num"><div><span>저장소</span><b>${esc(c.repo||'-')}</b></div><div><span>폴더</span><b>${esc(c.dir||'data')}</b></div>
  <div><span>상태</span><b class="${GH.err?'exp':''}">${GH.err?'끊김':S.db&&S.db.pending()?'보내는 중':'정상'}</b></div><div><span>마지막 확인</span><b>${t?pad(t.getHours())+':'+pad(t.getMinutes())+':'+pad(t.getSeconds()):'-'}</b></div></div>
  ${GH.err?`<div class="err">${esc(GH.err)}</div>`:''}<p class="muted">폰들은 20초마다, 그리고 앱을 다시 열 때마다 서로 맞춰요. 인터넷이 끊겨도 이 폰에 먼저 저장하고, 연결되면 보내요.</p>
  <div class="card" style="background:var(--bg);margin-top:14px"><h3>하루 백업</h3><p class="muted" style="margin:0 0 8px">하루에 한 번, 앱을 열 때 전체 장부를 backups 폴더에 통째로 저장해요. 최근 7일치를 보관해요.</p>
  ${S.bkList?(S.bkList.length?`<div class="chips">${S.bkList.map(d=>`<button class="chip ${S.bkPick===d?'on':''}" data-act="bkPick" data-k="${d}">${d.slice(5).replace('-','.')}</button>`).join('')}</div>
    ${S.bkPick?`<p class="muted">${S.bkPick} 백업으로 되돌리면 그날 상태의 내역·설정이 다시 써져요. 그 뒤에 새로 적은 내역은 지워지지 않아요.</p><button class="btn danger ${S.bkAsk?'go':''} wide2" data-act="bkRestore">${S.bkAsk?'정말 되돌리기':S.bkPick+' 백업으로 되돌리기'}</button>`:''}`:'<p class="muted">아직 백업이 없어요.</p>'):'<p class="muted">불러오는 중…</p>'}
  <button class="btn wide2" style="margin-top:8px" data-act="bkNow">지금 백업</button></div>
  <div class="acts"><button class="btn danger ${S.ghOffAsk?'go':''}" data-act="ghOff">${S.ghOffAsk?'정말 연결 끊기':'연결 끊기'}</button><button class="btn pri" data-act="ghSyncNow">지금 동기화</button></div>`;},
 monthStart(){const s=S.settings.monthStart||1;return head('월 시작일')+`<p style="margin:0;font-size:14px;color:var(--muted)">월급날에 맞춰 한 달을 계산하고 싶을 때 바꾸세요. 예를 들어 25일로 하면 ‘10월’은 10월 25일부터 11월 24일까지예요.</p>
  <div class="f"><label for="ms">매월</label><select class="in-t" id="ms">${Array.from({length:28},(_,i)=>`<option value="${i+1}" ${s===i+1?'selected':''}>${i+1}일부터</option>`).join('')}</select></div>
  <div class="acts"><button class="btn pri" data-act="saveMs">저장</button></div>`;}
};

/* ---------- SMS parser ---------- */
const CARD_KEYS=[['신한','신한'],['KB','국민'],['국민','국민'],['삼성','삼성'],['현대','현대'],['롯데','롯데'],['우리','우리'],['하나','하나'],['NH','농협'],['농협','농협'],['BC','비씨'],['비씨','비씨'],['카카오','카카오'],['토스','토스'],['IBK','기업'],['기업','기업'],['씨티','씨티'],['케이뱅크','케이뱅크'],['새마을','새마을'],['우체국','우체국'],['SC','제일']];
const CAT_HINTS=[[/스타벅스|커피|카페|투썸|이디야|메가엠지씨|메가커피|컴포즈|빽다방|폴바셋|할리스|베이커리|파리바게뜨|뚜레쥬르|배스킨|던킨|설빙/,['카페·간식','식비/생활용품']],
 [/GS25|CU|씨유|세븐일레븐|이마트24|편의점|식당|김밥|치킨|피자|배달의민족|배민|요기요|쿠팡이츠|맥도날드|버거|롯데리아|맘스터치|국밥|분식|고기|횟집|반점|푸드/,['식비','식비/생활용품']],
 [/택시|카카오T|카카오모빌리티|티머니|버스|지하철|코레일|SRT|고속|하이패스|주차|타다/,['교통','교통/차량']],
 [/주유|칼텍스|S-OIL|에쓰오일|SK에너지|현대오일|오일뱅크|세차|정비|타이어/,['자동차','교통/차량']],
 [/약국|병원|의원|치과|한의원|안과|피부과|정형외과/,['의료·건강','건강']],
 [/CGV|메가박스|롯데시네마|넷플릭스|NETFLIX|유튜브|YOUTUBE|멜론|스포티파이|티빙|웨이브|디즈니|왓챠|골프|PC방/,['문화·여가','패션/미용/문화']],
 [/다이소|쿠팡|올리브영|이마트|홈플러스|코스트코|롯데마트|하나로마트|트레이더스|마켓컬리|컬리|네이버페이|11번가|G마켓|옥션/,['생활용품','식비/생활용품']],
 [/SKT|SK텔레콤|KT|LGU|LG유플러스|관리비|한국전력|도시가스|수도/,['주거·통신','주거/통신']],
 [/유니클로|자라|ZARA|무신사|미용실|헤어|네일/,['의류·미용','패션/미용/문화']]];
function guessCat(memo,type){const cats=S.settings.cats[type]||[];if(memo){const ms=allMonths().slice(-3).flatMap(txOf).concat(Object.values(S.live).flat());
  const prev=ms.filter(t=>t.type===type&&t.memo&&t.memo===memo).sort((a,b)=>(b.created||0)-(a.created||0))[0];if(prev&&cats.includes(prev.cat))return prev.cat;
  if(type==='exp')for(const [re,cs] of CAT_HINTS)if(re.test(memo)){const c=cs.find(x=>cats.includes(x));if(c)return c;}}
  return cats.includes('기타')?'기타':(cats[0]||'');}
function parseOne(raw){const s=raw.replace(/\r/g,'').trim();let amount=0,m;const re=/([\d,]{1,15})\s*원/g;
  while((m=re.exec(s))){const before=s.slice(Math.max(0,m.index-6),m.index);if(/누적|잔액|한도|포인트|잔고/.test(before))continue;amount=Number(m[1].replace(/,/g,''));if(amount)break;}
  if(!amount)return null;const cancel=/취소/.test(s);
  let type=(/입금|급여|이자/.test(s)&&!/출금|승인|결제|사용|이체출금/.test(s))?'inc':'exp';if(cancel)type='inc';
  const now=new Date();let date=today(),time='';
  const dm=s.match(/(?:^|[^\d])(\d{1,2})[\/.](\d{1,2})(?:[^\d]|$)/)||s.match(/(\d{1,2})월\s?(\d{1,2})일/);
  if(dm){const mo=+dm[1],da=+dm[2];if(mo>=1&&mo<=12&&da>=1&&da<=31){let y=now.getFullYear();let c=y+'-'+pad(mo)+'-'+pad(da);if(c>ymd(new Date(now.getTime()+864e5)))c=(y-1)+'-'+pad(mo)+'-'+pad(da);date=c;}}
  const tm=s.match(/(\d{1,2}):(\d{2})/);if(tm)time=pad(tm[1])+':'+tm[2];
  let memo='';if(tm){const lines=s.slice(tm.index+tm[0].length).split('\n').map(x=>x.trim()).filter(Boolean);
    for(const l of lines){const c=l.replace(/\s*(누적|잔액|잔고|한도).*$/,'').trim();if(c&&!/^[\d,]+\s*원/.test(c)){memo=c;break;}}}
  if(!memo){const lines=s.split('\n').map(x=>x.trim()).filter(x=>x&&!/원|승인|\d{1,2}[\/:]\d{2}|님$|Web발신|누적|잔액|체크|카드/.test(x));memo=lines[lines.length-1]||'';}
  for(let k=0;k<4;k++)memo=memo.replace(/^\(?(일시불|할부\d*개?월?)\)?\s*/,'').replace(/^(입금|출금|이체|승인|결제|사용|체크)\s*/,'').replace(/^[\d,]+\s*원\s*/,'');
  memo=memo.trim().slice(0,40);
  let acc='';for(const [k,n] of CARD_KEYS){if(s.includes(k)){const a=S.settings.accounts.find(a=>a.name.includes(n)||a.name.toUpperCase().includes(k));if(a){acc=a.id;break;}}}
  if(!acc&&type==='inc'){const b=S.settings.accounts.find(a=>a.group==='은행');if(b)acc=b.id;}
  if(!acc)acc=lastAcc();
  const it={type,amount,date,time,memo:memo+(cancel?' (취소)':''),acc,cat:guessCat(memo,type),on:true,dup:false};
  const ex=txOf(date.slice(0,7)).some(t=>t.date===date&&t.amount===amount&&(t.memo||'')===it.memo);if(ex){it.dup=true;it.on=false;}return it;}
function parseSms(text){return text.split(/\[Web발신\]|\n\s*\n/).map(x=>x.trim()).filter(x=>/[\d,]+\s*원/.test(x)).map(parseOne).filter(Boolean);}

/* ---------- export ---------- */
async function doExport(scope){
  let list,name;if(scope==='month'){list=txIn(period(S.label));name='가계부_'+S.label+'.csv';}
  else{await ensureMonths(allMonths(),true);list=allMonths().flatMap(txOf);name='가계부_전체_'+today()+'.csv';}
  if(!list.length){toast('내보낼 내역이 없어요');return;}
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const rows=[['날짜','시간','구분','분류','소분류','금액','자산','받는 자산','내용']].concat(list.sort((a,b)=>a.date.localeCompare(b.date)).map(t=>[t.date,t.time||'',TYPE_NAME[t.type],t.cat||'',t.sub||'',t.amount,accName(t.acc),t.to?accName(t.to):'',t.memo||'']));
  const csv='﻿'+rows.map(r=>r.map(q).join(',')).join('\r\n');
  try{const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);toast('파일을 저장했어요');}catch(e){toast('파일을 저장하지 못했어요');}}

/* ---------- actions ---------- */
function readForm(){const f=S.form;if(!f)return;const g=id=>document.getElementById(id);
  if(g('f-amt'))f.amountStr=g('f-amt').value;if(g('f-date'))f.date=g('f-date').value;if(g('f-acc'))f.acc=g('f-acc').value;
  if(g('f-to'))f.to=g('f-to').value;if(g('f-memo'))f.memo=g('f-memo').value;if(g('f-fav'))f.fav=g('f-fav').checked;}
function readRec(){const r=S.recDraft;if(!r)return;const g=id=>document.getElementById(id);
  if(g('r-day'))r.day=+g('r-day').value;if(g('r-amt'))r.amount=calc(g('r-amt').value)||0;if(g('r-cat'))r.cat=g('r-cat').value;if(g('r-acc'))r.acc=g('r-acc').value;if(g('r-to'))r.to=g('r-to').value;if(g('r-memo'))r.memo=g('r-memo').value;if(g('r-now'))r.now=g('r-now').checked;}
function readAcc(){document.querySelectorAll('[data-acc]').forEach(el=>{const a=S.accDraft[+el.dataset.i];const k=el.dataset.acc;a[k]=k==='init'?(calc(el.value)||0):el.value;});}

const ACT={
 tab(el){S.tab=el.dataset.k;S.overview=false;try{localStorage.setItem('moneybook.tab',S.tab);}catch(e){}if(S.tab==='asset')ensureMonths(allMonths(),true);window.scrollTo(0,0);render();},
 prev(){S.label=shiftLabel(S.label,-1);S.selDay='';subscribePeriod();render();},
 next(){S.label=shiftLabel(S.label,1);S.selDay='';subscribePeriod();render();},
 add(){openTx(null);},
 edit(el){const t=txOf(el.dataset.ym).find(x=>x.id===el.dataset.id);if(!t)return;if(!S.canWrite){toast('보기 전용이에요');return;}openTx(t);},
 pickDay(el){S.selDay=S.selDay===el.dataset.d?'':el.dataset.d;render();},
 stype(el){S.statType=el.dataset.k;render();},
 close(){closeSheet();},
 ovClose(el,e){if(e.target===el)closeSheet();},
 ftype(el){readForm();const f=S.form;f.type=el.dataset.k;f.sub='';f.subPick=false;if(f.panel==='cat'&&f.type==='trf')f.panel='acc';if(f.type!=='trf'&&!(S.settings.cats[f.type]||[]).includes(f.cat))f.cat='';renderSheet();},
 fcat(el){readForm();if(S.form.cat!==el.dataset.k)S.form.sub='';S.form.cat=el.dataset.k;renderSheet();},
 panel(el){readForm();const k=el.dataset.k;const f=S.form;f.panel=(f.panel===k||!k)?'':k;f.subPick=false;if(document.activeElement)document.activeElement.blur();renderSheet();},
 memoFocus(){if(S.form&&S.form.panel){readForm();S.form.panel='';renderSheet();const m=document.getElementById('f-memo');if(m){m.focus();m.setSelectionRange(m.value.length,m.value.length);}}},
 kp(el){const f=S.form;const k=el.dataset.k;const tk=f.panel==='fee'?'feeStr':'amountStr';let a=f[tk]||'';
  if(k==='back')a=a.slice(0,-1);else if(k==='calc'){f.calcOn=!f.calcOn;}
  else if(k==='done'){const v=calc(a);if(a&&!isNaN(v))a=String(v);f[tk]=a;f.calcOn=false;f.panel=tk==='feeStr'?'':f.type==='trf'?(f.acc?(f.to?'':'to'):'acc'):'cat';renderSheet();return;}
  else if(/^[+−×÷]$/.test(k)){if(!a)return;if(/[+−×÷]$/.test(a))a=a.slice(0,-1);a+=k;}
  else{if(a==='0')a='';if(a.replace(/[^\d]/g,'').length>12)return;if(!a&&/^0+$/.test(k))return;a+=k;}
  f[tk]=a;renderSheet();},
 swapAcc(){readForm();const f=S.form;const a=f.acc;f.acc=f.to;f.to=a;renderSheet();},
 pickCat(el){const f=S.form;const c=el.dataset.k;if(f.cat!==c)f.sub='';f.cat=c;if(S.settings.subOn&&subsOf(f.type,c).length){f.subPick=true;}else{f.panel='acc';f.subPick=false;}f.err='';renderSheet();},
 pickSub(el){const f=S.form;f.sub=el.dataset.k;f.subPick=false;f.panel='acc';renderSheet();},
 subBack(){S.form.subPick=false;renderSheet();},
 pickAcc(el){const f=S.form;const id=el.dataset.k;if(f.panel==='to')f.to=id;else f.acc=id;f.err='';f.panel=(f.type==='trf'&&f.panel==='acc'&&!f.to)?'to':'';renderSheet();if(!f.panel){const m=document.getElementById('f-memo');if(m)m.focus();}},
 repSet(el){const f=S.form;const k=el.dataset.k;f.rep=k==='monthly'?'monthly':'';f.inst=k.startsWith('inst')?+k.slice(4):0;f.panel='';renderSheet();},
 txFav(){readForm();if(!(S.settings.favorites||[]).length){toast('자주 쓰는 내역이 아직 없어요');return;}openSheet('favorites');},
 fsub(el){readForm();S.form.sub=S.form.sub===el.dataset.k?'':el.dataset.k;renderSheet();},
 sub(el){S.sub=el.dataset.k;S.selDay='';try{localStorage.setItem('moneybook.sub',S.sub);}catch(e){}if(S.sub==='month'&&!S.openMonth)S.openMonth=curLabel();window.scrollTo(0,0);render();},
 yprev(){S.label=shiftLabel(S.label,-12);S.openMonth='';subscribePeriod();render();},ynext(){S.label=shiftLabel(S.label,12);S.openMonth='';subscribePeriod();render();},
 omonth(el){S.openMonth=S.openMonth===el.dataset.k?'':el.dataset.k;render();},
 async memoSave(){const t=document.getElementById('memo-text');if(!t||!S.memo)return;const v=t.value;try{await S.db.doc('memo/'+S.memo.ym).set({text:v,updated:Date.now()});S.memo.text=v;S.memo.saved=v;const st=document.getElementById('memo-st');if(st)st.textContent='저장됨';toast('메모를 저장했어요');}catch(e){toast(dbErr(e));}},
 favUse(el){const x=S.settings.favorites[+el.dataset.i];if(!x)return;openTx(null);Object.assign(S.form,{type:x.type,amountStr:String(x.amount),cat:x.cat||'',sub:x.sub||'',acc:x.acc||S.form.acc,to:x.to||'',memo:x.memo||''});renderSheet();},
 async ghConnect(){const repo=(document.getElementById('gh-repo').value||'').trim().replace(/^https?:\/\/github\.com\//,'').replace(/\/$/,'');const token=(document.getElementById('gh-token').value||'').trim();
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo)){S.setupErr='저장소는 아이디/저장소 형식으로 적어주세요.';render();return;}if(!token){S.setupErr='토큰을 붙여넣어 주세요.';render();return;}
  S.setupBusy=true;S.setupErr='';render();try{await ghTest(repo,token);ghSave({repo,token,dir:'data'});S.setupBusy=false;startDb(ghCfg());toast('연결했어요');}catch(e){S.setupBusy=false;S.setupErr=e.message;render();}},
 async ghUseCandoit(){const c=candoitCfg();if(!c)return;const repo=((document.getElementById('gh-repo')||{}).value||'taichen2k/moneybook-backup').trim();S.setupBusy=true;render();try{await ghTest(repo,c.token);ghSave({repo,token:c.token,dir:'data'});S.setupBusy=false;startDb(ghCfg());toast('연결했어요');}catch(e){S.setupBusy=false;S.setupErr=e.message;render();}},
 bkPick(el){S.bkPick=S.bkPick===el.dataset.k?'':el.dataset.k;S.bkAsk=false;renderSheet();},
 async bkNow(){toast('백업하는 중이에요');const ok=await dailyBackup(true);toast(ok?'백업했어요':'백업하지 못했어요. 연결 상태를 확인해 주세요');S.bkList=await listBackups().catch(()=>S.bkList);if(S.sheet==='sync')renderSheet();},
 async bkRestore(){if(!S.bkAsk){S.bkAsk=true;renderSheet();return;}S.bkAsk=false;toast('되돌리는 중이에요');try{const n=await restoreBackup(S.bkPick);toast(n+'건을 '+S.bkPick+' 상태로 되돌렸어요');closeSheet();}catch(e){toast(e.message||'되돌리지 못했어요');}},
 ghSyncNow(){if(S.db){S.db.syncAll();toast('동기화하는 중이에요');}},
 ghOff(el){if(!S.ghOffAsk){S.ghOffAsk=true;renderSheet();return;}S.ghOffAsk=false;ghSave(null);try{Object.keys(localStorage).filter(k=>k.startsWith('moneybook.f.')).forEach(k=>localStorage.removeItem(k));}catch(e){}location.reload();},
 instHide(){try{localStorage.setItem('moneybook.instHide',today());}catch(e){}render();},
 async install(){if(deferredInstall){const e=deferredInstall;deferredInstall=null;try{e.prompt();await e.userChoice;}catch(x){}render();return;}openSheet('install');},
 fTab(el){S.fTab=el.dataset.k;renderSheet();},
 fReset(){S.filter={inc:[],exp:[],acc:[]};render();if(S.sheet==='filter')renderSheet();},
 favEditT(){S.favEdit=!S.favEdit;renderSheet();},
 ovw(el){S.overview=el.dataset.k==='1';window.scrollTo(0,0);render();},
 sprev(){ACT._sshift(-1);}, snext(){ACT._sshift(1);},
 _sshift(k){S.statCat='';if(S.sp==='month'){S.label=shiftLabel(S.label,k);subscribePeriod();}
  else if(S.sp==='week')S.spWeek=addDays(statPeriod().start,7*k);else if(S.sp==='year')S.spYear=(S.spYear||+S.label.slice(0,4))+k;render();},
 scat(el){S.statCat=S.statCat===el.dataset.k?'':el.dataset.k;render();},
 subToggle(el){saveSettings({subOn:el.checked});renderSheet();},
 catEdit(el){const i=+el.dataset.i;S.catEdit=S.catEdit===i?-1:i;S.catDelAsk=-1;renderSheet();},
 catRename(el){const i=+el.dataset.i;const t=S.catType;const old=S.settings.cats[t][i];const v=(document.getElementById('c-name').value||'').trim().slice(0,20);
  if(!v||v===old)return;if(S.settings.cats[t].includes(v)){toast('이미 있는 분류예요');return;}
  const l=S.settings.cats[t].slice();l[i]=v;const subsT=Object.assign({},(S.settings.subs||{})[t]||{});if(subsT[old]){subsT[v]=subsT[old];delete subsT[old];}
  saveSettings({cats:Object.assign({},S.settings.cats,{[t]:l}),subs:Object.assign({},S.settings.subs||{},{[t]:subsT})});toast('이름을 바꿨어요');renderSheet();},
 subAdd(el){const t=S.catType;const cat=S.settings.cats[t][+el.dataset.i];const inp=document.getElementById('s-new');const v=(inp.value||'').trim().slice(0,20);if(!v)return;
  const arr=subsOf(t,cat);if(arr.includes(v)){toast('이미 있는 소분류예요');return;}
  const subsT=Object.assign({},(S.settings.subs||{})[t]||{},{[cat]:arr.concat(v)});saveSettings({subs:Object.assign({},S.settings.subs||{},{[t]:subsT})});renderSheet();
  const n=document.getElementById('s-new');if(n)n.focus();},
 subDel(el){const t=S.catType;const cat=S.settings.cats[t][+el.dataset.i];const arr=subsOf(t,cat).filter((x,j)=>j!==+el.dataset.j);
  const subsT=Object.assign({},(S.settings.subs||{})[t]||{},{[cat]:arr});saveSettings({subs:Object.assign({},S.settings.subs||{},{[t]:subsT})});renderSheet();},
 op(el){readForm();const f=S.form;const k=el.dataset.k;
  if(k==='back')f.amountStr=f.amountStr.slice(0,-1);else if(k==='='){const v=calc(f.amountStr);if(!isNaN(v))f.amountStr=won(v);}
  else{if(/[+−×÷]$/.test(f.amountStr))f.amountStr=f.amountStr.slice(0,-1);if(f.amountStr)f.amountStr+=k;}
  renderSheet();const a=document.getElementById('f-amt');if(a){a.focus();a.setSelectionRange(a.value.length,a.value.length);}},
 useFav(el){const x=S.settings.favorites[+el.dataset.i];if(!x)return;readForm();Object.assign(S.form,{type:x.type,amountStr:String(x.amount),cat:x.cat||'',sub:x.sub||'',acc:x.acc||S.form.acc,to:x.to||'',memo:x.memo||''});renderSheet();},
 async saveTx(el){readForm();const f=S.form;const amount=calc(f.amountStr);
  const err=m=>{f.err=m;renderSheet();};
  if(!(amount>0))return err('금액을 입력해 주세요.');if(!f.date)return err('날짜를 골라주세요.');if(!f.acc)return err('자산을 골라주세요.');
  if(f.type==='trf'){if(!f.to)return err('받는 곳을 골라주세요.');if(f.to===f.acc)return err('보내는 곳과 받는 곳이 같아요.');}
  else if(!f.cat)return err('분류를 골라주세요.');
  const t={type:f.type,date:f.date,amount,cat:f.type==='trf'?'':f.cat,sub:f.type==='trf'?'':(f.sub||''),acc:f.acc,to:f.type==='trf'?f.to:'',memo:f.memo.trim(),time:f.time||'',created:f.created,auto:f.auto};
  try{if(!f.orig&&f.inst>1){const n=f.inst;const base=Math.floor(amount/n);for(let i=0;i<n;i++)await writeTx(Object.assign({},t,{date:addMonths(f.date,i),amount:i===n-1?amount-base*(n-1):base,memo:(t.memo||t.cat)+` (할부 ${i+1}/${n})`}));}
    else await writeTx(t,f.orig);}catch(e){return err(dbErr(e));}
  const fee=f.type==='trf'?calc(f.feeStr||''):0;
  if(fee>0){const ec=S.settings.cats.exp||[];try{await writeTx({type:'exp',date:f.date,amount:fee,cat:ec.includes('기타')?'기타':(ec[0]||''),sub:'',acc:f.acc,to:'',memo:'이체 수수료'+(t.memo?' ('+t.memo+')':''),time:''});}catch(e){}}
  if(!f.orig&&f.rep==='monthly'){const rec={id:newId(),type:t.type,day:+f.date.slice(8),amount,cat:t.cat,acc:t.acc,to:t.to,memo:t.memo,done:uniq([f.date.slice(0,7),today().slice(0,7)])};
    saveSettings({recurring:(S.settings.recurring||[]).concat(rec)});}
  try{localStorage.setItem('moneybook.acc',f.acc);}catch(e){}
  if(f.fav&&!f.orig){const fav={type:t.type,amount,cat:t.cat,sub:t.sub,acc:t.acc,to:t.to,memo:t.memo};saveSettings({favorites:(S.settings.favorites||[]).concat(fav).slice(-30)});}
  toast(f.orig?'수정했어요':'저장했어요');
  const p=period(S.label);if(t.date<p.start||t.date>=p.end){/* 다른 달에 저장됨 */toast(`${+t.date.slice(5,7)}월 ${+t.date.slice(8)}일에 저장했어요`);}
  if(el.dataset.k==='more'){S.form={type:f.type,amountStr:'',date:f.date,cat:'',sub:'',acc:f.acc,to:'',memo:'',time:'',fav:false,err:'',confirmDel:false,panel:'amt',rep:'',inst:0,calcOn:false,subPick:false};renderSheet();}
  else closeSheet();},
 async delTx(){const f=S.form;if(!f.confirmDel){readForm();f.confirmDel=true;renderSheet();return;}
  try{await S.db.collection('tx_'+f.orig.ym).doc(f.orig.id).delete();toast('삭제했어요');closeSheet();}catch(e){f.err=dbErr(e);renderSheet();}},
 open(el){const k=el.dataset.k;
  if(k==='sms'){if(S.sheet==='tx')readForm();S.sms={text:'',items:null};}
  if(k==='search'){S.search='';ensureMonths(allMonths(),true).then(()=>{if(S.sheet==='search')renderSheet();});}
  if(k==='budget')S.budDraft={total:(S.settings.budget||{}).total||0,cats:Object.assign({},(S.settings.budget||{}).cats||{})};
  if(k==='accounts')S.accDraft=clone(S.settings.accounts);
  if(k==='recurring')S.recDraft={type:'exp',day:new Date().getDate(),amount:0,cat:'',acc:lastAcc(),to:'',memo:'',now:false};
  if(k==='pin')S.pinDraft=null;
  if(k==='sync'){S.ghOffAsk=false;S.bkList=null;S.bkPick='';S.bkAsk=false;listBackups().then(l=>{S.bkList=l;if(S.sheet==='sync')renderSheet();}).catch(()=>{S.bkList=[];if(S.sheet==='sync')renderSheet();});}
  if(k==='favorites')S.favEdit=false;
  if(k==='cats'){S.catType='exp';S.catEdit=-1;S.catDelAsk=-1;}
  openSheet(k);setTimeout(()=>{const t=document.getElementById(k==='sms'?'sms-text':k==='search'?'q':'');if(t)t.focus();},60);},
 smsParse(){const t=document.getElementById('sms-text');S.sms.text=t?t.value:'';S.sms.items=parseSms(S.sms.text);renderSheet();},
 smsChk(el){S.sms.items[+el.dataset.i].on=el.checked;const sc=$('.sheet').scrollTop;renderSheet();$('.sheet').scrollTop=sc;},
 async smsSave(){const items=S.sms.items.filter(x=>x.on);let ok=0;
  for(const it of items){try{await writeTx({type:it.type,date:it.date,amount:it.amount,cat:it.cat,acc:it.acc,to:'',memo:it.memo,time:it.time});ok++;}catch(e){toast(dbErr(e));break;}}
  if(ok){try{localStorage.setItem('moneybook.acc',items[0].acc);}catch(e){}toast(ok+'건 저장했어요');closeSheet();}},
 ctype(el){S.catType=el.dataset.k;S.catEdit=-1;S.catDelAsk=-1;renderSheet();},
 catUp(el){const i=+el.dataset.i;const t=S.catType;const l=S.settings.cats[t].slice();[l[i-1],l[i]]=[l[i],l[i-1]];saveSettings({cats:Object.assign({},S.settings.cats,{[t]:l})});renderSheet();},
 catDel(el){const i=+el.dataset.i;if(S.catDelAsk!==i){S.catDelAsk=i;renderSheet();return;}S.catDelAsk=-1;S.catEdit=-1;const t=S.catType;const l=S.settings.cats[t].slice();if(l.length<=1){toast('분류는 하나 이상 있어야 해요');return;}l.splice(i,1);saveSettings({cats:Object.assign({},S.settings.cats,{[t]:l})});renderSheet();},
 catAdd(){const el=document.getElementById('c-new');const v=(el.value||'').trim();const t=S.catType;if(!v)return;if(S.settings.cats[t].includes(v)){toast('이미 있는 분류예요');return;}
  saveSettings({cats:Object.assign({},S.settings.cats,{[t]:S.settings.cats[t].concat(v.slice(0,20))})});renderSheet();},
 accAdd(){readAcc();S.accDraft.push({id:newId(),name:'',group:'카드',init:0});renderSheet();const els=document.querySelectorAll('[data-acc="name"]');if(els.length)els[els.length-1].focus();},
 accDel(el){readAcc();if(S.accDraft.length<=1){toast('자산은 하나 이상 있어야 해요');return;}S.accDraft.splice(+el.dataset.i,1);renderSheet();},
 saveAcc(){readAcc();const list=S.accDraft.filter(a=>a.name.trim()).map(a=>({id:a.id||newId(),name:a.name.trim().slice(0,30),group:a.group||'기타',init:Number(a.init)||0}));
  if(!list.length){toast('이름을 하나 이상 적어주세요');return;}saveSettings({accounts:list});toast('저장했어요');closeSheet();},
 saveBudget(){const tot=calc(document.getElementById('b-total').value)||0;const cats={};document.querySelectorAll('[data-bud]').forEach(el=>{const v=calc(el.value);if(v>0)cats[el.dataset.bud]=v;});
  saveSettings({budget:{total:tot>0?tot:0,cats}});toast('예산을 저장했어요');closeSheet();},
 rtype(el){readRec();S.recDraft.type=el.dataset.k;S.recDraft.cat='';renderSheet();},
 recAdd(){readRec();const r=S.recDraft;if(!(r.amount>0)){r.err='금액을 입력해 주세요.';renderSheet();return;}
  if(r.type==='trf'&&(!r.to||r.to===r.acc)){r.err='받는 곳을 다르게 골라주세요.';renderSheet();return;}
  const ym=today().slice(0,7);const done=(!r.now&&new Date().getDate()>=r.day)?[ym]:[];
  const rec={id:newId(),type:r.type,day:r.day,amount:r.amount,cat:r.type==='trf'?'':(r.cat||(S.settings.cats[r.type]||[])[0]||''),acc:r.acc,to:r.type==='trf'?r.to:'',memo:r.memo.trim(),done};
  saveSettings({recurring:(S.settings.recurring||[]).concat(rec)}).then(()=>{S.recurDone=false;applyRecurring();});
  S.recDraft={type:'exp',day:new Date().getDate(),amount:0,cat:'',acc:lastAcc(),to:'',memo:'',now:false};toast('등록했어요');renderSheet();},
 recDel(el){const l=(S.settings.recurring||[]).slice();l.splice(+el.dataset.i,1);saveSettings({recurring:l});renderSheet();},
 favDel(el){const l=(S.settings.favorites||[]).slice();l.splice(+el.dataset.i,1);saveSettings({favorites:l});renderSheet();},
 saveMs(){const v=+document.getElementById('ms').value;saveSettings({monthStart:v});S.label=curLabel();subscribePeriod();toast('월 시작일을 바꿨어요');closeSheet();},
 export(el){doExport(el.dataset.k);},
 pinStart(){S.pinDraft={step:1,first:'',cur:'',err:''};renderSheet();},
 pinOff(){saveSettings({pin:null});toast('잠금을 껐어요');renderSheet();},
 async pinKey(el){const k=el.dataset.k;
  if(S.locked&&S.settings.pin){if(k==='back'){S.pinIn=S.pinIn.slice(0,-1);S.pinErr='';renderLock();return;}if(S.pinIn.length>=4)return;S.pinIn+=k;S.pinErr='';renderLock();
    if(S.pinIn.length===4){const h=await hashPin(S.pinIn,S.settings.pin.salt);if(h===S.settings.pin.hash){S.locked=false;S.unlockedOnce=true;S.pinIn='';render();}else{S.pinIn='';S.pinErr='비밀번호가 달라요';renderLock();}}return;}
  const d=S.pinDraft;if(!d)return;if(k==='back'){d.cur=d.cur.slice(0,-1);d.err='';renderSheet();return;}if(d.cur.length>=4)return;d.cur+=k;d.err='';renderSheet();
  if(d.cur.length===4){if(d.step===1){d.first=d.cur;d.cur='';d.step=2;setTimeout(renderSheet,150);}
    else if(d.cur===d.first){const salt=newId();const hash=await hashPin(d.cur,salt);saveSettings({pin:{salt,hash}});S.unlockedOnce=true;S.pinDraft=null;toast('비밀번호를 설정했어요');closeSheet();}
    else{S.pinDraft={step:1,first:'',cur:'',err:'두 번 입력한 번호가 달라요. 처음부터 다시 입력하세요.'};renderSheet();}}}
};
document.addEventListener('click',e=>{const el=e.target.closest('[data-act]');if(!el)return;if(el.tagName==='INPUT'&&el.type==='checkbox'&&e.type==='click'){ACT[el.dataset.act]&&ACT[el.dataset.act](el,e);return;}const f=ACT[el.dataset.act];if(f)f(el,e);});
document.addEventListener('input',e=>{const t=e.target;
  if(t.id==='f-amt'&&S.form){S.form.amountStr=t.value;const v=calc(t.value);const c=document.getElementById('f-calc');if(c)c.textContent=/[+\-*/×÷−]/.test(t.value.replace(/^-/,''))&&!isNaN(v)?'= '+won(v)+'원':'';}
  if(t.id==='q'){S.search=t.value;clearTimeout(ACT._qt);ACT._qt=setTimeout(()=>{renderSheet();const q=document.getElementById('q');if(q){q.focus();q.setSelectionRange(q.value.length,q.value.length);}},250);}
  if(t.id==='sms-text'&&S.sms)S.sms.text=t.value;
  if(t.id==='memo-text'&&S.memo){S.memo.text=t.value;const st=document.getElementById('memo-st');if(st)st.textContent=t.value===S.memo.saved?'저장됨':'저장 안 됨';}});
document.addEventListener('change',e=>{const t=e.target;
  if(t.dataset&&t.dataset.fg){const g=t.dataset.fg;const tab=S.fTab;const F=Object.assign({},S.filter);
    if(g==='all'){const keys=tab==='acc'?S.settings.accounts.map(a=>a.id):(S.settings.cats[tab]||[]);F[tab]=t.checked?keys.slice():[];}
    else{const set=new Set(F[g]);if(t.checked)set.add(t.value);else set.delete(t.value);F[g]=[...set];}
    S.filter=F;render();return;}
  if(t.id==='f-date'&&S.form){readForm();S.form.date=t.value||S.form.date;renderSheet();return;}
  if(t.id==='lockMin'){saveSettings({lockMin:+t.value});return;}
  if(t.id==='smode'){S.sp=t.value;S.statCat='';if(S.sp==='week')S.spWeek=today();if(S.sp==='year')S.spYear=+S.label.slice(0,4);if(S.sp==='range'){const p=period(S.label);S.rFrom=p.start;S.rTo=p.last;}render();return;}
  if(t.id==='sp-from'||t.id==='sp-to'){if(t.value){if(t.id==='sp-from')S.rFrom=t.value;else S.rTo=t.value;}render();return;}if(t.dataset.sms&&S.sms){S.sms.items[+t.dataset.i][t.dataset.sms]=t.value;}});
document.addEventListener('keydown',e=>{if(S.sheet==='tx'&&S.form&&(S.form.panel==='amt'||S.form.panel==='fee')&&!/INPUT|TEXTAREA/.test((e.target||{}).tagName||'')){const m={'Backspace':'back','Enter':'done','+':'+','-':'−','*':'×','/':'÷'};const k=/^[0-9]$/.test(e.key)?e.key:m[e.key];if(k){e.preventDefault();ACT.kp({dataset:{k}});return;}}if(S.locked&&S.settings.pin&&/^[0-9]$|^Backspace$/.test(e.key)){ACT.pinKey({dataset:{k:e.key==='Backspace'?'back':e.key}});return;}if(e.key==='Escape'&&S.sheet)closeSheet();if(e.key==='Enter'&&e.target.id==='c-new'){e.preventDefault();ACT.catAdd();}});

document.addEventListener('visibilitychange',()=>{if(document.hidden){S.hiddenAt=Date.now();return;}
  if(S.settings.pin&&!S.locked&&S.hiddenAt&&Date.now()-S.hiddenAt>=(S.settings.lockMin??1)*60000){S.locked=true;S.pinIn='';S.pinErr='';closeSheet();renderLock();}});
/* ---------- boot ---------- */
S.label=curLabel();render();
const isPC=()=>!/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)&&!(navigator.maxTouchPoints>1&&/Mac/.test(navigator.platform));
function instBanner(){if(isStandalone())return '';try{if(localStorage.getItem('moneybook.instHide')===today())return '';}catch(e){}
  return `<div class="ibar"><img src="logo-mark.svg" alt="" width="40" height="40"><div><b>티끌모아 앱 설치</b><span>${isPC()?'PC 바탕화면·작업표시줄에서':'홈 화면 아이콘으로'} 바로 열려요</span></div><button class="btn pri" data-act="install">설치</button><button class="x" data-act="instHide" aria-label="오늘 그만 보기">×</button></div>`;}
function setupHtml(){const c=candoitCfg();return instBanner()+`<div class="setup-logo"><img src="logo.png" alt="티끌모아"></div><div class="card setup"><h3>깃허브 동기화 연결</h3>
  <p class="muted">가계부는 내 깃허브 <b>비공개 저장소</b>(moneybook-backup)에 저장돼요. 폰마다 한 번만 연결하면 여러 폰에서 같은 장부를 써요. 토큰은 이 기기에만 저장돼요.</p>
  <div class="f"><label for="gh-repo">저장소 (아이디/저장소)</label><input class="in-t" id="gh-repo" value="taichen2k/moneybook-backup" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
  <div class="f"><label for="gh-token">토큰</label><input class="in-t" id="gh-token" type="password" placeholder="github_pat_로 시작" autocomplete="off"></div>
  <div class="err">${esc(S.setupErr||'')}</div><div class="acts"><button class="btn pri" data-act="ghConnect">${S.setupBusy?'확인 중…':'연결'}</button></div>
  ${c?`<button class="btn wide2" style="margin-top:10px" data-act="ghUseCandoit">할수있어에 넣어 둔 토큰으로 연결</button><p class="muted" style="margin:6px 2px 0">그 토큰에 moneybook-backup 저장소도 허용돼 있어야 해요.</p>`:''}
  <details class="howto"><summary>토큰 만드는 법</summary><ol>
  <li>깃허브 → 오른쪽 위 프로필 → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token</li>
  <li>Repository access: <b>Only select repositories</b> → 위 저장소 하나만 선택</li>
  <li>Permissions → Repository permissions → <b>Contents: Read and write</b></li>
  <li>만든 토큰(github_pat_…)을 복사해서 위 칸에 붙여넣기</li></ol></details></div>`;}
const ghH=cfg=>({Authorization:'Bearer '+cfg.token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'});
async function dailyBackup(force){const cfg=ghCfg();if(!cfg||!S.db)return false;const d=today();if(!force){try{if(localStorage.getItem('moneybook.lastBackup')===d)return false;}catch(e){}}
  try{const ms=allMonths();await ensureMonths(ms,true);const snap={v:1,at:new Date().toISOString(),settings:S.settings,tx:{},memo:[]};
    ms.forEach(ym=>{snap.tx[ym]=txOf(ym);});try{const m=await S.db.collection('memo').get();snap.memo=m.docs.map(x=>Object.assign({ym:x.id},x.data()));}catch(e){}
    const H=ghH(cfg);const base=`https://api.github.com/repos/${cfg.repo}/contents/backups`;
    let sha=null;const ex=await fetch(base+'/'+d+'.json',{headers:H,cache:'no-store'});if(ex.ok)sha=(await ex.json()).sha;
    const r=await fetch(base+'/'+d+'.json',{method:'PUT',headers:H,body:JSON.stringify(Object.assign({message:'티끌모아 하루 백업 '+d,content:b64e(JSON.stringify(snap))},sha?{sha}:{}))});
    if(!r.ok)return false;try{localStorage.setItem('moneybook.lastBackup',d);}catch(e){}
    const l=await fetch(base,{headers:H,cache:'no-store'});if(l.ok){const list=(await l.json()).filter(x=>/^\d{4}-\d{2}-\d{2}\.json$/.test(x.name)).sort((a,b)=>b.name.localeCompare(a.name));
      for(const old of list.slice(7))await fetch(base+'/'+old.name,{method:'DELETE',headers:H,body:JSON.stringify({message:'오래된 백업 정리',sha:old.sha})}).catch(()=>{});}
    return true;}catch(e){return false;}}
async function listBackups(){const cfg=ghCfg();if(!cfg)return [];const r=await fetch(`https://api.github.com/repos/${cfg.repo}/contents/backups`,{headers:ghH(cfg),cache:'no-store'});
  if(!r.ok)return [];return (await r.json()).filter(x=>/^\d{4}-\d{2}-\d{2}\.json$/.test(x.name)).map(x=>x.name.slice(0,10)).sort().reverse();}
async function restoreBackup(d){const cfg=ghCfg();const r=await fetch(`https://api.github.com/repos/${cfg.repo}/contents/backups/${d}.json`,{headers:ghH(cfg),cache:'no-store'});
  if(!r.ok)throw new Error('백업 파일을 열 수 없어요');const j=await r.json();const snap=JSON.parse(b64d(j.content));
  if(snap.settings)await S.db.doc('ledger/settings').set(snap.settings);let n=0;
  for(const ym in (snap.tx||{}))for(const t of snap.tx[ym]){const b=Object.assign({},t);delete b.id;await S.db.collection('tx_'+ym).doc(t.id).set(b);n++;}
  for(const m of (snap.memo||[])){const b=Object.assign({},m);delete b.ym;await S.db.doc('memo/'+m.ym).set(b);}return n;}
function startDb(cfg){S.needSetup=false;S.db=makeGhDb(cfg);let firstMs=null;
  S.db.doc('ledger/settings').onSnapshot(snap=>{const d=snap.exists?snap.data():{};S.settings=Object.assign(clone(DEFAULTS),clone(d));
    if(firstMs===null){firstMs=S.settings.monthStart;S.label=curLabel();subscribePeriod();}
    else if(firstMs!==S.settings.monthStart){firstMs=S.settings.monthStart;subscribePeriod();}
    if(!S.settingsReady&&S.settings.pin&&!S.unlockedOnce)S.locked=true;
    S.settingsReady=true;if(!snap.metadata.fromCache){applyRecurring();if(!S.bkTimer)S.bkTimer=setTimeout(()=>dailyBackup(false),8000);}render();});
  render();}
(function boot(){if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});
  const cfg=ghCfg();if(!cfg){S.needSetup=true;render();return;}startDb(cfg);
})();
})();
