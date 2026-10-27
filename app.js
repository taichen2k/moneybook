(function(){
"use strict";
const COLORS=['#e4572e','#f0a202','#2a9d6f','#2e86ab','#a23b72','#6c5ce7','#d0813c','#5b8c2a','#c44569','#3d6fa5','#8d99ae','#b08968','#17a2b8','#9c6644'];
const GROUPS=['현금','은행','카드','체크카드','선불식카드','저축','투자','마이너스 통장','대출','보험','기타'];
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
// 앱을 새로 열면 늘 가계부(일일) 화면으로 시작. 방금 쓰다가 새로고침된 경우만 보던 화면 유지
S.freshOpen=!recentlyActive();
if(recentlyActive())try{const t=localStorage.getItem('moneybook.tab');if(t)S.tab=t;const u=localStorage.getItem('moneybook.sub');if(u)S.sub=u;}catch(e){}
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
const wOff=d=>(dowOf(d)-(S.settings.weekStart||0)+7)%7;
function statPeriod(){if(S.sp==='week'){const a=S.spWeek||today();const st=addDays(a,-wOff(a));return mkPeriod(st,addDays(st,7));}
  if(S.sp==='year'){const y=S.spYear||+S.label.slice(0,4);return mkPeriod(period(y+'-01').start,period((y+1)+'-01').start);}
  if(S.sp==='range'){const p=period(S.label);const f=S.rFrom||p.start;let t=S.rTo||p.last;if(t<f)t=f;return mkPeriod(f,addDays(t,1));}
  return period(S.label);}
async function hashPin(pin,salt){const txt=salt+':'+pin;try{const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(txt));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');}
  catch(e){let h=2166136261;for(const c of txt){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return 'f'+h.toString(16);}}
/* ---------- 지문·얼굴 잠금 해제 (휴대폰의 화면 잠금 인증 = 패스키 방식) ----------
   지문·얼굴 정보는 휴대폰 밖으로 나가지 않아요. 이 기기에 '열쇠'를 하나 만들어 두고, 열 때 휴대폰이 지문·얼굴로 본인 확인을 해 줘요. */
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const ub64u=s2=>Uint8Array.from(atob(s2.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s2.length+3)%4)),c=>c.charCodeAt(0));
function bioGet(){try{const o=JSON.parse(localStorage.getItem('moneybook.bio')||'null');return o&&o.id?o:null;}catch(e){return null;}}
function bioSet(o){try{if(o)localStorage.setItem('moneybook.bio',JSON.stringify(o));else localStorage.removeItem('moneybook.bio');}catch(e){}}
async function bioAvail(){try{return !!(window.PublicKeyCredential&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());}catch(e){return false;}}
async function bioRegister(){const rnd=n=>crypto.getRandomValues(new Uint8Array(n));
  const cred=await navigator.credentials.create({publicKey:{challenge:rnd(32),rp:{name:'티끌모아',id:location.hostname},user:{id:rnd(16),name:'티끌모아 잠금 ('+((S.user&&S.user.email)||'가계부')+')',displayName:'티끌모아 잠금'},
    pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'discouraged',requireResidentKey:false},timeout:60000,attestation:'none'}});
  if(!cred)throw new Error('no');bioSet({id:b64u(cred.rawId),at:Date.now()});}
async function bioVerify(){const b=bioGet();if(!b)throw new Error('none');
  const a=await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rpId:location.hostname,allowCredentials:[{type:'public-key',id:ub64u(b.id),transports:['internal','hybrid']}],userVerification:'required',timeout:60000}});
  const ad=new Uint8Array(a.response.authenticatorData);if(!(ad[32]&0x04))throw new Error('uv');// 지문·얼굴·화면잠금으로 본인 확인이 됐는지
  return true;}
async function bioUnlock(auto){if(S.bioBusy||!lockOn()||!bioGet())return;S.bioBusy=true;
  try{await bioVerify();pinFails(0);S.locked=false;S.unlockedOnce=true;S.pinIn='';S.pinErr='';markActive();render();}
  catch(e){const n=e&&e.name;// 사용자가 취소하거나 시간이 지나면(NotAllowedError) 조용히 비밀번호 화면으로
    if(!auto&&n!=='NotAllowedError'&&n!=='AbortError'){S.pinErr='지문·얼굴 확인을 하지 못했어요. 비밀번호를 눌러 주세요';updLock();}}
  finally{S.bioBusy=false;}}
function padHtml(){return `<div class="pad">${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-act="pinKey" data-k="${n}">${n}</button>`).join('')}<span></span><button data-act="pinKey" data-k="0">0</button><button data-act="pinKey" data-k="back" aria-label="지우기">⌫</button></div>`;}
function dotsHtml(n,bad){return `<div class="pdots ${bad?'bad':''}">${[0,1,2,3].map(i=>`<i class="${i<n?'on':''}"></i>`).join('')}</div>`;}
function updDraft(){const d=S.pinDraft;const box=document.querySelector('.pinbox .pdots');if(!d||!box){renderSheet();return;}box.outerHTML=dotsHtml(d.cur.length,!!d.err);const e=document.querySelector('.pin-e');if(e)e.textContent=d.err||'';}
const lockOn=()=>!!(S.locked&&(S.settings.pin||S.pinPending));
function markActive(){try{sessionStorage.setItem('moneybook.activeAt',String(Date.now()));}catch(e){}}
function recentlyActive(){try{const a=+sessionStorage.getItem('moneybook.activeAt')||0;const lm=+(localStorage.getItem('moneybook.lockMin')??1);return a&&Date.now()-a<Math.max(lm*60000,15000);}catch(e){return false;}}
// 내용이 같으면 다시 그리지 않아요 (누르는 도중 버튼이 바뀌어 터치가 씹히는 문제 방지)
function setHtml(el,h){if(el._h!==h){el.innerHTML=h;el._h=h;}if(el.id==='top')el.hidden=!h;}
const FPI='<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 11v3.5c0 2-.6 3.8-1.6 5.3M8.5 7.6A5 5 0 0 1 17 11v2.5M7 11a5 5 0 0 1 .2-1.4M15 14.2a14 14 0 0 1-1 5.1M9.6 11a2.4 2.4 0 0 1 4.8 0v1.6M4.6 15.5A11 11 0 0 0 5 11a7 7 0 0 1 12.4-4.4M19 11v1.4"/></svg>';
function renderLock(){const r=$('#lockRoot');const on=lockOn();document.documentElement.classList.toggle('locked',on);
  // 풀릴 때 잠금 화면을 0.35초 동안 투명하게 남겨 둬서, 마지막 숫자를 누른 손가락이 뒤 화면 버튼을 잘못 누르지 않게 해요
  if(!on){const l=r.querySelector('.lock');if(l&&!l.classList.contains('bye')){l.classList.add('bye');setTimeout(()=>{if(!lockOn())r.innerHTML='';},350);}else if(!l)r.innerHTML='';return;}
  if(r.querySelector('.lock.bye'))r.innerHTML='';
  if(r.querySelector('.lock')){updLock();return;}
  r.innerHTML=`<div class="lock" role="dialog" aria-label="비밀번호 입력"><img src="logo-mark.svg" alt="" width="72" height="72" style="border-radius:18px;box-shadow:0 4px 14px rgba(0,0,0,.18)"><h2>티끌모아</h2><div>비밀번호 4자리를 입력하세요</div><div id="lockDots">${dotsHtml(S.pinIn.length,!!S.pinErr)}</div><div class="perr" id="lockErr">${esc(S.pinErr)}</div>${padHtml()}${bioGet()?`<button class="lk-bio" data-act="bioUnlock">${FPI}<span>지문·얼굴로 열기</span></button>`:''}<button class="lk-forgot" data-act="pinForgot">비밀번호를 잊었어요</button></div>`;
  if(bioGet()&&!document.hidden)setTimeout(()=>bioUnlock(true),250);}
// 틀린 횟수는 기기에 기억해서 새로고침해도 초기화되지 않아요. 5번부터 30초, 60초… 기다려야 해요.
function pinFails(add){let o={n:0,at:0};try{o=JSON.parse(localStorage.getItem('moneybook.pinFail')||'{}');}catch(e){}o.n=add?(o.n||0)+1:0;o.at=Date.now();try{localStorage.setItem('moneybook.pinFail',JSON.stringify(o));}catch(e){}return o.n;}
function lockWait(){let o={};try{o=JSON.parse(localStorage.getItem('moneybook.pinFail')||'{}');}catch(e){}if((o.n||0)<5)return 0;const ms=Math.min(600,30*Math.pow(2,o.n-5))*1000-(Date.now()-(o.at||0));return ms>0?Math.ceil(ms/1000):0;}
function updLock(){const d=document.getElementById('lockDots'),e=document.getElementById('lockErr');if(!d){renderLock();return;}d.innerHTML=dotsHtml(S.pinIn.length,!!S.pinErr);e.textContent=S.pinErr||'';}
const dot2=s=>s.slice(2).replace(/-/g,'.');
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const uniq=a=>[...new Set(a)];
function daysIn(ym){const [y,m]=ym.split('-').map(Number);return new Date(y,m,0).getDate();}
/* ---------- 입력값 검사 (백업 파일·다른 기기 자료도 화면에 넣기 전에 걸러요) ---------- */
const TYPES=['exp','inc','trf'];const okType=t=>TYPES.includes(t)?t:'exp';
const BADK=new Set(['__proto__','constructor','prototype']);
const okYm=v=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const okDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&okYm(v.slice(0,7))&&+v.slice(8)>=1&&+v.slice(8)<=daysIn(v.slice(0,7));
const str=(v,n)=>typeof v==='string'?v.slice(0,n):(typeof v==='number'?String(v).slice(0,n):'');
const okName=v=>typeof v==='string'&&v.trim()&&!BADK.has(v.trim());
function normTx(t,ym){if(!t||typeof t!=='object')return null;const id=String(t.id||'');if(!/^[\w-]{1,60}$/.test(id))return null;
  const amount=Number(t.amount);if(!isFinite(amount)||amount<=0||amount>1e13)return null;if(!okDate(t.date)||(ym&&t.date.slice(0,7)!==ym))return null;
  const o={id,type:okType(t.type),date:t.date,amount:Math.round(amount),cat:str(t.cat,40),sub:str(t.sub,40),acc:str(t.acc,60),to:str(t.to,60),memo:str(t.memo,200),note:str(t.note,200),
    time:/^\d{2}:\d{2}(:\d{2})?$/.test(t.time||'')?t.time:'',created:Number(t.created)||Date.now(),updated:Number(t.updated)||Number(t.created)||Date.now()};
  if(t.auto)o.auto=true;if(t.src)o.src=str(t.src,30);return o;}
function normalizeSettings(st){const d=clone(DEFAULTS);st=Object.assign(d,st||{});
  st.monthStart=Math.min(28,Math.max(1,parseInt(st.monthStart,10)||1));
  st.lockMin=[0,1,5,10,30].includes(Number(st.lockMin))?Number(st.lockMin):1;
  const normAcc=a=>({id:String(a.id),name:str(a.name,30)||'이름 없음',group:(g=>g==='신용카드'?'카드':GROUPS.includes(g)?g:'기타')(str(a.group,20)),hidden:!!a.hidden,memo:str(a.memo,200),phone:str(a.phone,40),smsKey:str(a.smsKey,60),app:str(a.app,40),pay:str(a.pay,60),cutDay:Math.min(31,Math.max(1,parseInt(a.cutDay,10)||1)),payDay:Math.min(31,Math.max(1,parseInt(a.payDay,10)||1)),perf:Math.max(0,Number(a.perf)||0),init:isFinite(Number(a.init))?Number(a.init):0});
  st.accounts=(Array.isArray(st.accounts)?st.accounts:[]).filter(a=>a&&typeof a==='object'&&/^[\w-]{1,60}$/.test(String(a.id||''))).map(normAcc);
  st.deleted=(Array.isArray(st.deleted)?st.deleted:[]).filter(a=>a&&typeof a==='object'&&/^[\w-]{1,60}$/.test(String(a.id||''))).map(a=>Object.assign(normAcc(a),{perf:Number(a.perf)||0}));
  st.weekStart=st.weekStart===1?1:0;st.firstSub=st.firstSub==='cal'?'cal':'daily';
  if(!st.accounts.length)st.accounts=clone(DEFAULTS.accounts||[]);
  const cats={};for(const ty of ['exp','inc']){const l=((st.cats||{})[ty]);cats[ty]=uniq((Array.isArray(l)?l:[]).filter(okName).map(x=>x.trim().slice(0,20)));if(!cats[ty].length)cats[ty]=clone(DEFAULTS.cats[ty]);}st.cats=cats;
  st.recurring=(Array.isArray(st.recurring)?st.recurring:[]).filter(r=>r&&typeof r==='object'&&isFinite(Number(r.amount))&&Number(r.amount)>0).map(r=>Object.assign({},r,{id:str(r.id,60)||newId(),type:okType(r.type),day:Math.min(31,Math.max(1,parseInt(r.day,10)||1)),amount:Number(r.amount),done:(Array.isArray(r.done)?r.done:[]).filter(okYm)}));
  const ms={};if(st.months&&typeof st.months==='object')for(const k of Object.keys(st.months))if(okYm(k))ms[k]=true;st.months=ms;
  if(!Array.isArray(st.favorites))st.favorites=[];
  if(!st.budget||typeof st.budget!=='object')st.budget={total:0,cats:{}};if(!st.budget.cats||typeof st.budget.cats!=='object')st.budget.cats={};
  if(st.pin&&!(typeof st.pin.salt==='string'&&typeof st.pin.hash==='string'))st.pin=null;
  return st;}
function shiftLabel(l,k){const [y,m]=l.split('-').map(Number);const d=new Date(y,m-1+k,1);return d.getFullYear()+'-'+pad(d.getMonth()+1);}
function curLabel(){const t=new Date();const s=S.settings.monthStart||1;const d=t.getDate()>=s?t:new Date(t.getFullYear(),t.getMonth()-1,1);return d.getFullYear()+'-'+pad(d.getMonth()+1);}
function period(l){const [y,m]=l.split('-').map(Number);const s=S.settings.monthStart||1;
  const st=new Date(y,m-1,s),en=new Date(y,m,s),last=new Date(y,m,s-1);
  return {start:ymd(st),end:ymd(en),last:ymd(last),months:uniq([ymd(st).slice(0,7),ymd(last).slice(0,7)])};}
function catColor(type,name){const list=(S.settings.cats[type]||[]);let i=list.indexOf(name);if(i<0){i=0;for(const c of String(name))i+=c.charCodeAt(0);}return COLORS[(i+(type==='inc'?5:0))%COLORS.length];}
function accName(id){const a=S.settings.accounts.find(a=>a.id===id)||(S.settings.deleted||[]).find(a=>a.id===id);return a?a.name:'(삭제된 자산)';}
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
window.addEventListener('pagehide',()=>{if(!lockOn())markActive();});
window.addEventListener('appinstalled',()=>{deferredInstall=null;try{toast('홈 화면에 설치했어요');render();}catch(x){}});
const isStandalone=()=>(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
const isIOS=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
/* ---------- 구글 Firebase 동기화 ----------
   데이터는 Firestore의 books/main 아래에 저장돼요. 보안 규칙으로 허용된 구글 계정만 읽고 쓸 수 있어요.
   이 기기에도 사본을 저장해서 인터넷이 끊겨도 쓰고, 연결되면 자동으로 보내요. */
const FB_CONFIG={apiKey:"AIzaSyBPSKlEh4SXS_-7w4LwvGrLGUSWGCZSPxw",authDomain:"moneybook-926a4.firebaseapp.com",projectId:"moneybook-926a4",
  storageBucket:"moneybook-926a4.firebasestorage.app",messagingSenderId:"630259263268",appId:"1:630259263268:web:8ba3b8dee9df9dfe5af5b1"};
const BOOK='main';
const APP_VERSION=30; // 판 올릴 때마다 1씩 올림 (index.html의 ?v=, sw.js의 CACHE도 같은 숫자)
function footHtml(){return `<footer class="foot"><p>티끌모아 자료는 암호화되어 저장됩니다.</p><p>© 2026 티제이컴퍼니. All rights reserved. · v${APP_VERSION}</p></footer>`;}
const GH={err:'',lastOk:0,denied:false};
function ghErr(m){if(GH.err!==(m||'')){GH.err=m||'';try{render();}catch(e){}}if(!m)GH.lastOk=Date.now();}
function fbErrMsg(e){const c=(e&&e.code)||'';if(c.includes('permission-denied')){GH.denied=true;return '이 구글 계정은 이 가계부에 들어올 수 없어요.';}
  if(c.includes('unavailable'))return '인터넷에 연결되지 않았어요. 이 기기에 먼저 저장하고, 연결되면 보내요.';return '동기화 오류 ('+(c||'알 수 없음')+')';}
function authErr(e){const c=(e&&e.code)||'';if(c==='auth/unauthorized-domain')return '이 주소가 Firebase 승인된 도메인에 없어요.';
  if(c==='auth/network-request-failed')return '인터넷 연결을 확인해 주세요.';if(c==='auth/popup-blocked')return '팝업이 막혔어요. 다시 눌러 주세요.';return '로그인하지 못했어요 ('+c+')';}
function makeFbDb(fs){const base='books/'+BOOK+'/';let pend=0;
  const clean=d=>JSON.parse(JSON.stringify(d||{}));
  function track(p){pend++;try{render();}catch(e){}p.then(()=>{pend--;ghErr('');try{render();}catch(e){}},e=>{pend--;ghErr(fbErrMsg(e));toast(dbErr(e));try{render();}catch(x){}});return Promise.resolve();}
  const watch=(ref,n,e)=>ref.onSnapshot({includeMetadataChanges:true},s=>{if(!s.metadata.fromCache)ghErr('');n(s);},err=>{ghErr(fbErrMsg(err));if(e)e(err);});
  const wrapDoc=r=>({id:r.id,path:r.path,get:()=>r.get(),onSnapshot:(n,e)=>watch(r,n,e),set:d=>track(r.set(clean(d))),update:d=>track(r.set(clean(d),{merge:true})),delete:()=>track(r.delete())});
  const wrapCol=c=>({path:c.path,doc:id=>wrapDoc(id?c.doc(id):c.doc()),get:()=>c.get(),onSnapshot:(n,e)=>watch(c,n,e)});
  return {doc:p=>wrapDoc(fs.doc(base+p)),collection:c=>wrapCol(fs.collection(base+c)),pending:()=>pend>0,syncAll(){}};}

/* ---------- data ---------- */
let setQ=Promise.resolve();
// 바뀐 항목만 저장해요. 두 기기에서 동시에 다른 설정을 바꿔도 서로 덮어쓰지 않아요.
function rawUpdate(body){const ref=S.fs.doc('books/'+BOOK+'/ledger/settings');
  const p=ref.update(body).catch(e=>{if(e&&e.code==='not-found')return ref.set(JSON.parse(JSON.stringify(S.settings)),{merge:true});throw e;});
  p.catch(e=>{ghErr(fbErrMsg(e));toast(dbErr(e));});setQ=p.catch(()=>{});return Promise.resolve();}
function saveSettings(patch){S.settings=Object.assign({},S.settings,patch);render();return rawUpdate(JSON.parse(JSON.stringify(patch)));}
function markMonth(ym){if(!okYm(ym)||(S.settings.months||{})[ym])return Promise.resolve();S.settings.months=Object.assign({},S.settings.months,{[ym]:true});return rawUpdate({['months.'+ym]:true});}
function subscribePeriod(){S.unsubs.forEach(u=>u());S.unsubs=[];S.live={};S.loaded=false;const p=period(S.label);let got=0;
  p.months.forEach(ym=>{const u=S.db.collection('tx_'+ym).onSnapshot(snap=>{
      S.live[ym]=snap.docs.map(d=>Object.assign({id:d.id},d.data()));S.cache[ym]=S.live[ym];
      if(snap.docs.length&&S.settingsReady&&!snap.metadata.fromCache&&S.canWrite&&!(S.settings.months||{})[ym])markMonth(ym);
      if(!S.loaded){got++;if(got>=p.months.length)S.loaded=true;}
      render();
    },e=>{S.sync='off';render();});S.unsubs.push(u);});}
async function ensureMonths(list,force){if(!S.settingsReady)return [];const need=list.filter(ym=>!S.live[ym]&&(force||!S.cache[ym])&&!S.fetching.has(ym));
  if(!need.length)return [];need.forEach(m=>S.fetching.add(m));const fail=[];
  await Promise.all(need.map(async ym=>{try{if(!S.settings.months[ym]){S.cache[ym]=[];return;}const snap=await S.db.collection('tx_'+ym).get();S.cache[ym]=snap.docs.map(d=>Object.assign({id:d.id},d.data()));}catch(e){fail.push(ym);S.cache[ym]=S.cache[ym]||[];}finally{S.fetching.delete(ym);}}));
  render();return fail;}
async function needAll(){const f=await ensureMonths(allMonths(),true);if(f&&f.length)throw new Error('load:'+f.join(','));}
async function writeTx(t,orig){const ym=t.date.slice(0,7);const id=(orig&&orig.id)||newId();const body={type:t.type,date:t.date,amount:t.amount,cat:t.cat||'',sub:t.sub||'',acc:t.acc||'',to:t.to||'',memo:t.memo||'',note:t.note||'',time:t.time||'',created:t.created||Date.now(),updated:Date.now()};
  if(t.auto)body.auto=true;if(t.src)body.src=t.src;
  if(orig&&orig.ym!==ym)await S.db.collection('tx_'+orig.ym).doc(orig.id).delete();
  await S.db.collection('tx_'+ym).doc(id).set(body);
  await markMonth(ym);}
async function applyRecurring(){if(S.recurDone||!S.canWrite)return;S.recurDone=true;const now=new Date();const ym=ymd(now).slice(0,7);const d=now.getDate();
  const recs=(S.settings.recurring||[]).map(r=>Object.assign({},r,{done:(r.done||[]).slice()}));let n=0;
  for(const r of recs){if(r.done.includes(ym)||d<Math.min(r.day,daysIn(ym)))continue;const day=Math.min(r.day,daysIn(ym));
    try{await S.db.collection('tx_'+ym).doc('r_'+r.id+'_'+ym).set({type:r.type,date:ym+'-'+pad(day),amount:r.amount,cat:r.cat||'',acc:r.acc||'',to:r.to||'',memo:r.memo||'',time:'',auto:true,created:Date.now(),updated:Date.now()});
      r.done=r.done.slice(-5).concat(ym);n++;}catch(e){}}
  if(n){await saveSettings({recurring:recs});await markMonth(ym);toast('반복 내역 '+n+'건을 자동으로 입력했어요');}}

/* ---------- render ---------- */
const ICONS={list:'<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  cal:'<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  stat:'<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/></svg>',
  asset:'<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/></svg>',
  more:'<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/></svg>'};
const TABS=[['list','가계부'],['stat','통계'],['asset','자산'],['more','더보기']];
const SUBS=[['daily','일일'],['cal','달력'],['month','월별'],['settle','결산'],['memo','메모']];
const HICON={chart:'<svg viewBox="0 0 24 24"><path d="M4 20h16M7 17v-5M11 17V8M15 17v-7M19 17V5"/></svg>',list:'<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1"/></svg>',pen:'<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/></svg>',sms:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  fav:'<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.8z"/></svg>',
  search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  set:'<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>'};

function render(){renderLock();
  if(lockOn()){setHtml($('#top'),'');$('#view').innerHTML='';$('#tabs').hidden=true;$('#fab').hidden=true;if(S.sheet)closeSheet();return;}
  $('#tabs').hidden=false;renderTop();renderView();if(S.sheet==='filter')renderSheet();
  setHtml($('#tabs .in'),TABS.map(([k,n])=>`<button data-act="tab" data-k="${k}" class="${S.tab===k?'on':''}" aria-label="${n}">${ICONS[k]}<span>${n}</span></button>`).join(''));
  $('#fab').hidden=!S.db||!S.canWrite||S.tab==='more'||(S.tab==='list'&&S.sub==='memo');}

function sumRow(t){return `<div class="sum num"><div><span>수입</span><b class="inc">${won(t.inc)}</b></div><div><span>지출</span><b class="exp">${won(t.exp)}</b></div><div><span>합계</span><b>${t.net<0?'-':''}${won(Math.abs(t.net))}</b></div></div>`;}
function renderTop(){const top=$('#top');const sc=!S.db?'off':GH.err?'off':S.db.pending()?'pending':'ok';const st=!S.db?'연결 안 됨':GH.err?'동기화 끊김':sc==='pending'?'저장 중…':'동기화됨';
  let h='';
  if(S.tab==='list'){const yearMode=S.sub==='month';const [y,m]=S.label.split('-');
    const t=yearMode?totals(yearTx(+y).filter(passFilter)):totals(txIn(period(S.label)).filter(passFilter));
    h+=`<div class="lhead"><div class="lnav"><button data-act="${yearMode?'yprev':'prev'}" aria-label="이전">‹</button><button class="mlab" data-act="mpOpen" data-k="${yearMode?'year':'month'}" aria-label="날짜 고르기">${yearMode?y+'년':y+'년 '+(+m)+'월'}<i>▾</i></button><button data-act="${yearMode?'ynext':'next'}" aria-label="다음">›</button></div>
      <div class="hic"><span class="sync ${sc}" title="${st}"><i></i></span><button data-act="open" data-k="sms" aria-label="문자 붙여넣기">${HICON.sms}</button><button data-act="open" data-k="favorites" aria-label="자주 쓰는 내역">${HICON.fav}</button><button data-act="open" data-k="search" aria-label="검색">${HICON.search}</button><button data-act="open" data-k="filter" aria-label="필터" class="${filterOn()?'fact':''}">${HICON.set}</button></div></div>
    <div class="subtabs">${SUBS.map(([k,n])=>`<button data-act="sub" data-k="${k}" class="${S.sub===k?'on':''}">${n}</button>`).join('')}</div>${sumRow(t)}`;
    setHtml(top,h);return;}
  if(S.db&&!S.needSetup&&S.tab==='asset'){h=S.av?avTop(sc,st):`<div class="ttl"><b>자산</b><span class="ttl-r"><button class="x" data-act="ovw" data-k="${S.overview?0:1}" aria-label="전체 통계">${HICON.chart}</button><button class="x dots" data-act="amenu" aria-label="자산 메뉴">⋮</button></span>${S.amenu?`<div class="amenu-ov" data-act="amenuClose"></div><div class="amenu"><button data-act="accNew">추가</button><button data-act="open" data-k="accHide">표시/숨김</button><button data-act="open" data-k="accDel">삭제</button><button data-act="open" data-k="accOrder">순서 변경</button></div>`:''}</div>`;setHtml(top,h);return;}
  if(S.db&&!S.needSetup&&S.tab==='more'){h=`<div class="ttl"><b>${S.moreView==='set'?'<button class="x back2" data-act="moreBack" aria-label="뒤로">←</button>설정관리':'설정'}</b><span class="muted num" style="font-size:14px">v${APP_VERSION}</span></div>`;setHtml(top,h);return;}
  if(!(S.db&&!S.needSetup&&S.tab==='stat'))h=`<div class="brand"><h1><img src="logo-mark.svg" alt="" width="28" height="28">티끌모아</h1><span class="sync ${sc}"><i></i>${st}</span></div>`;
  if(S.tab==='stat'){const sp=statPeriod();const t=totals(txIn(sp));const modes=[['week','주간'],['month','월간'],['year','연간'],['range','기간']];
    let lab;if(S.sp==='month'){const [y,m]=S.label.split('-');lab=`<button class="mlab" data-act="mpOpen" data-k="month">${y}년 ${+m}월<i>▾</i></button>`;}else if(S.sp==='year')lab=`<button class="mlab" data-act="mpOpen" data-k="syear">${S.spYear||S.label.slice(0,4)}년<i>▾</i></button>`;
    else if(S.sp==='week')lab=`<b class="num wkl">${dot2(sp.start)} ~ ${dot2(sp.last)}</b>`;
    else lab=`<span class="rng"><input type="date" id="sp-from" class="in-t" value="${sp.start}" aria-label="시작일"> ~ <input type="date" id="sp-to" class="in-t" value="${sp.last}" aria-label="종료일"></span>`;
    h+=`<div class="snav"><div class="lnav">${S.sp==='range'?'':'<button data-act="sprev" aria-label="이전">‹</button>'}${lab}${S.sp==='range'?'':'<button data-act="snext" aria-label="다음">›</button>'}</div>
      <span class="smw"><button class="smode" data-act="smOpen">${(modes.find(x=>x[0]===S.sp)||modes[1])[1]} <i>⌄</i></button>${S.smOpen?`<span class="amenu-ov" data-act="smClose"></span><span class="amenu sm">${modes.map(([k,n])=>`<button data-act="smPick" data-k="${k}">${n}</button>`).join('')}</span>`:''}</span></div>
    <div class="stabs num"><button data-act="stype" data-k="inc" class="${S.statType==='inc'?'on':''}">수입 <b>${won(t.inc)}원</b></button><button data-act="stype" data-k="exp" class="${S.statType==='exp'?'on':''}">지출 <b>${won(t.exp)}원</b></button></div>`;}
  setHtml(top,h);}

function rowHtml(t){const isT=t.type==='trf';const name=isT?'이체':(t.cat||'미분류')+(t.sub?' › '+t.sub:'');
  const acc=isT?`${esc(accName(t.acc))} → ${esc(accName(t.to))}`:esc(accName(t.acc))+(t.note?' · '+esc(t.note):'')+(t.auto?' · 반복':'');
  const cls=t.type==='exp'?'exp':t.type==='inc'?'inc':'trf';
  return `<button class="row" data-act="edit" data-id="${esc(t.id)}" data-ym="${esc(String(t.date).slice(0,7))}"><span class="c">${esc(name)}</span><span class="t">${t.memo?`<b>${esc(t.memo)}</b><small>${acc}</small>`:`<small class="solo">${acc}</small>`}</span><span class="a num ${cls}">${won(t.amount)}원</span></button>`;}

function dayGroups(list){const by={};for(const t of list)(by[t.date]=by[t.date]||[]).push(t);
  return Object.keys(by).sort().reverse().map(d=>{const items=by[d].sort((a,b)=>(b.time||'').localeCompare(a.time||'')||(b.created||0)-(a.created||0));const tt=totals(items);const w=dowOf(d);
    return `<div class="dg"><div class="day"><span class="dn num">${+d.slice(8)||''}</span><span class="dw ${w===0?'sun':w===6?'sat':''}">${DOW[w]}요일</span><span class="dym num">${esc(d.slice(0,7).replace('-','.'))}</span><span class="ds num"><span class="inc">${won(tt.inc)}원</span><span class="exp">${won(tt.exp)}원</span></span></div><div class="rows">${items.map(rowHtml).join('')}</div></div>`;}).join('');}

function filterOn(){const F=S.filter;return !!(F.inc.length||F.exp.length||F.acc.length);}
function passFilter(t){const F=S.filter;if(F.inc.length||F.exp.length){if(t.type==='trf')return false;if(!(F[t.type]||[]).includes(t.cat))return false;}
  if(F.acc.length&&!(F.acc.includes(t.acc)||(t.type==='trf'&&F.acc.includes(t.to))))return false;return true;}
function fBar(){if(!filterOn())return '';const F=S.filter;const n=F.inc.length+F.exp.length+F.acc.length;return `<div class="fon"><span>필터 적용 중 · ${n}개 항목</span><button data-act="open" data-k="filter">바꾸기</button><button data-act="fReset">해제</button></div>`;}
function yearTx(y){return monthsBetween(y+'-01',(y+1)+'-01').flatMap(txOf).filter(t=>{const p0=period(y+'-01'),p1=period((y+1)+'-01');return t.date>=p0.start&&t.date<p1.start;});}

function renderView(){const v=$('#view');
  if(S.needSetup){v.innerHTML=setupHtml();return;}
  if(S.user&&GH.denied&&!S.settingsReady){v.innerHTML=deniedHtml();return;}
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

function calHtml(p){const st=addDays(p.start,-wOff(p.start));const en=addDays(p.last,6-wOff(p.last));
  const ms=monthsBetween(st,en);const miss=ms.filter(ym=>!S.live[ym]&&!S.cache[ym]);if(miss.length)ensureMonths(miss);
  const by={};for(const t of ms.flatMap(txOf)){if(t.date<st||t.date>en||!passFilter(t))continue;const o=by[t.date]=by[t.date]||{inc:0,exp:0};if(t.type==='inc')o.inc+=t.amount;else if(t.type==='exp')o.exp+=t.amount;}
  const td=today();let cells='';let d=st;
  while(d<=en){const o=by[d];const out=d<p.start||d>=p.end;const w=dowOf(d);const dn=+d.slice(8);const lab=(dn===1)?(+d.slice(5,7))+'.'+dn:dn;
    cells+=`<button class="cell ${out?'out':''} ${S.selDay===d?'sel':''}" data-act="pickDay" data-d="${d}"><span class="d num ${d===td?'today':''} ${w===0?'sun':w===6?'sat':''}">${lab}</span><span class="cv">${o&&o.inc?'<small class="inc num">'+won(o.inc)+'</small>':''}${o&&o.exp?'<small class="exp num">'+won(o.exp)+'</small>':''}</span></button>`;d=addDays(d,1);}
  let below='';if(S.selDay&&S.selDay>=st&&S.selDay<=en){const items=ms.flatMap(txOf).filter(t=>t.date===S.selDay&&passFilter(t));
    below=items.length?dayGroups(items):`<div class="empty" style="padding:28px 16px"><b>${+S.selDay.slice(5,7)}월 ${+S.selDay.slice(8)}일 내역이 없어요</b>+ 버튼을 누르면 이 날짜로 입력돼요.</div>`;}
  return `<div class="cal"><div class="cal-h">${[0,1,2,3,4,5,6].map(i=>{const k=(i+(S.settings.weekStart||0))%7;return `<span class="${k===0?'sun':k===6?'sat':''}">${DOW[k]}</span>`;}).join('')}</div><div class="cal-g">${cells}</div></div>${below}`;}

function monthlyHtml(){const y=+S.label.slice(0,4);const labels=[];for(let m=12;m>=1;m--)labels.push(y+'-'+pad(m));
  const ms=uniq(labels.flatMap(l=>period(l).months).concat(monthsBetween(addDays(period(y+'-01').start,-6),period(y+'-01').start)));
  const miss=ms.filter(ym=>!S.live[ym]&&!S.cache[ym]);if(miss.length){ensureMonths(miss);return '<div class="empty"><b>불러오는 중이에요</b></div>';}
  const all=ms.flatMap(txOf).filter(passFilter);const sumIn=(a,b)=>totals(all.filter(t=>t.date>=a&&t.date<b));const td=today();const cur=curLabel();
  return '<div class="rows mrows">'+labels.map(l=>{const p=period(l);const t=sumIn(p.start,p.end);const open=(S.openMonth||cur)===l;
    let h=`<button class="mrow ${open?'open':''}" data-act="omonth" data-k="${l}"><span class="ml"><b>${+l.slice(5)}월</b>${open||l===cur?`<small class="num">${p.start.slice(5).replace('-','.')} ~ ${p.last.slice(5).replace('-','.')}</small>`:''}</span><span class="num inc">${won(t.inc)}원</span><span class="mr num"><span class="exp">${won(t.exp)}원</span><small>${t.net<0?'-':''}${won(Math.abs(t.net))}원</small></span></button>`;
    if(open){let ws=addDays(p.start,-wOff(p.start));const wk=[];while(ws<p.end){wk.push(ws);ws=addDays(ws,7);}
      h+=wk.reverse().map(s=>{const e=addDays(s,7);const tt=sumIn(s,e);const now=td>=s&&td<e;
        return `<div class="wrow ${now?'now':''}"><span class="num">${s.slice(5).replace('-','.')} ~ ${addDays(e,-1).slice(5).replace('-','.')}</span><span class="num inc">${won(tt.inc)}원</span><span class="mr num"><span class="exp">${won(tt.exp)}원</span><small>${now?'합계 ':''}${tt.net<0?'-':''}${won(Math.abs(tt.net))}원</small></span></div>`;}).join('');}
    return h;}).join('')+'</div>';}

function settleHtml(p){const prevP=period(shiftLabel(S.label,-1));const miss=prevP.months.filter(ym=>!S.live[ym]&&!S.cache[ym]);if(miss.length)ensureMonths(miss);
  const list=txIn(p);const t=totals(list);const pt=totals(txIn(prevP));const grp=id=>{const a=S.settings.accounts.find(x=>x.id===id);return a?a.group:'';};
  const cb=list.filter(x=>x.type==='exp'&&grp(x.acc)!=='카드').reduce((s,x)=>s+x.amount,0);
  const cd=list.filter(x=>x.type==='exp'&&grp(x.acc)==='카드').reduce((s,x)=>s+x.amount,0);
  const tr=list.filter(x=>x.type==='trf'&&(grp(x.acc)==='현금'||grp(x.acc)==='은행')).reduce((s,x)=>s+x.amount,0);
  const bt=(S.settings.budget||{}).total||0;const bc=(S.settings.budget||{}).cats||{};const byCat={};list.filter(x=>x.type==='exp').forEach(x=>byCat[x.cat]=(byCat[x.cat]||0)+x.amount);
  const bline=(n,used,b)=>{const r=used/b;return `<div class="bl"><div class="blh"><span>${esc(n)}</span><span class="num">${won(used)} / ${won(b)}</span></div><div class="bar ${r>1?'over':''}"><i style="width:${Math.min(100,r*100)}%"></i></div><small class="num">${r>1?'<span class="exp">'+won(used-b)+'원 초과</span>':won(b-used)+'원 남음'}</small></div>`;};
  let bud=bt||Object.keys(bc).length?(bt?bline('전체 예산',t.exp,bt):'')+Object.keys(bc).map(c=>bline(c,byCat[c]||0,bc[c])).join(''):'<p class="muted">예산을 정하면 여기서 얼마나 썼는지 확인할 수 있어요.</p>';
  return `<div class="card"><div class="ovh"><h3>예산</h3><button class="mini" data-act="open" data-k="budget">예산설정 ›</button></div>${bud}</div>
  <div class="card"><div class="ovh"><h3>자산</h3><span class="muted num">${dot2(p.start)} ~ ${dot2(p.last)}</span></div>
  <div class="kv num"><div><span>전월대비 지출 (당월/전월)</span><b>${pt.exp?Math.round(t.exp/pt.exp*100)+'%':'-'}</b></div><div><span>지출 (현금·통장·체크)</span><b>${won(cb)}원</b></div><div><span>지출 (신용카드)</span><b>${won(cd)}원</b></div><div><span>이체 (현금, 은행 →)</span><b>${won(tr)}원</b></div></div></div>
  <button class="btn wide" data-act="export" data-k="month">이번 달 엑셀 파일로 저장</button>`;}

function memoHtml(){const ym=S.label;if(!S.memo||S.memo.ym!==ym){S.memo={ym,text:'',loaded:false,saved:''};const mm=S.memo;
    S.db.doc('memo/'+ym).get().then(sn=>{if(S.memo!==mm)return;mm.text=sn.exists?(sn.data().text||''):'';mm.saved=mm.text;mm.loaded=true;render();}).catch(()=>{mm.loaded=true;render();});}
  const m=S.memo;if(!m.loaded)return '<div class="empty"><b>불러오는 중이에요</b></div>';
  return `<div class="card"><h3>${+ym.slice(5)}월 메모</h3><textarea class="in-t" id="memo-text" style="min-height:260px" placeholder="이번 달에 기억할 것을 적어두세요. 예: 자동차 보험 갱신, 경조사 일정">${esc(m.text)}</textarea>
  <div class="acts" style="margin-top:10px"><span class="muted" id="memo-st" style="flex:1;align-self:center">${m.text===m.saved?'저장됨':'저장 안 됨'}</span><button class="btn pri" style="flex:0 0 110px" data-act="memoSave" ${S.canWrite?'':'disabled'}>저장</button></div></div>`;}

const PIE=['#ff6f61','#ff9a4d','#ffcb45','#f0e030','#bfe04a','#7fcf78','#4cc3b8','#4aa3e0','#7b8ae6','#b27be0','#e07bb4','#a8a29a'];
function pieSvg(items,total){const W=360,H=300,cx=180,cy=150,r=92;let a0=-Math.PI/2;const segs=[],labs=[];
  const pt=(a,rr)=>[cx+rr*Math.cos(a),cy+rr*Math.sin(a)];
  for(const it of items){const f=total?it.v/total:0;const a1=a0+f*2*Math.PI;
    if(f>=0.9999)segs.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${it.c}"/>`);
    else if(f>0){const [x0,y0]=pt(a0,r),[x1,y1]=pt(a1,r);segs.push(`<path d="M${cx},${cy}L${x0.toFixed(1)},${y0.toFixed(1)}A${r},${r} 0 ${f>.5?1:0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}Z" fill="${it.c}" stroke="var(--surface)" stroke-width="1.5"/>`);}
    const am=(a0+a1)/2;const [ex,ey]=pt(am,r);const [mx,my]=pt(am,r+18);labs.push({it,f,ex,ey,mx,my,right:Math.cos(am)>=0});a0=a1;}
  // 왼쪽·오른쪽 따로 위아래 겹치지 않게 벌려요
  for(const side of [true,false]){const L=labs.filter(l=>l.right===side).sort((a,b)=>a.my-b.my);let last=-1e9;for(const l of L){l.ly=Math.max(l.my,last+34);last=l.ly;}const over=last-(H-14);if(over>0)for(const l of L)l.ly-=over;}
  const lines=labs.map(l=>{const tx=l.right?Math.max(l.mx,cx+r+8):Math.min(l.mx,cx-r-8);const anc=l.right?'start':'end';const tx2=l.right?tx+6:tx-6;
    return `<polyline points="${l.ex.toFixed(1)},${l.ey.toFixed(1)} ${l.mx.toFixed(1)},${l.ly.toFixed(1)} ${tx.toFixed(1)},${l.ly.toFixed(1)}" fill="none" stroke="${l.it.c}" stroke-width="1.2"/><text x="${tx2.toFixed(1)}" y="${(l.ly-2).toFixed(1)}" text-anchor="${anc}" class="pl">${esc(l.it.k)}</text><text x="${tx2.toFixed(1)}" y="${(l.ly+14).toFixed(1)}" text-anchor="${anc}" class="pp">${(l.f*100).toFixed(1)} %</text>`;}).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="분류별 비율">${segs.join('')}${lines}</svg>`;}
function donut(items,total){const r=58,C=2*Math.PI*r;let acc=0;const segs=items.map(it=>{const len=total?it.v/total*C:0;const s=`<circle r="${r}" cx="80" cy="80" fill="none" stroke="${it.c}" stroke-width="22" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-acc}"/>`;acc+=len;return s;}).join('');
  return `<svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="분류별 비율"><g transform="rotate(-90 80 80)"><circle r="${r}" cx="80" cy="80" fill="none" stroke="var(--sunk)" stroke-width="22"/>${segs}</g><text x="80" y="76" text-anchor="middle" font-size="12" fill="var(--muted)">${S.statType==='exp'?'총 지출':'총 수입'}</text><text x="80" y="96" text-anchor="middle" font-size="17" font-weight="700" fill="var(--ink)">${compact(total)}원</text></svg>`;}

function statHtml(){const sp=statPeriod();const miss=sp.months.filter(ym=>!S.live[ym]&&!S.cache[ym]);
  if(miss.length){ensureMonths(miss);return '<div class="empty"><b>불러오는 중이에요</b></div>';}
  const ty=S.statType;const list=txIn(sp).filter(t=>t.type===ty);const by=Object.create(null);for(const t of list)by[t.cat||'미분류']=(by[t.cat||'미분류']||0)+t.amount;
  const total=list.reduce((s,t)=>s+t.amount,0);const items=Object.keys(by).map(k=>({k,v:by[k],c:catColor(ty,k)})).sort((a,b)=>b.v-a.v);
  const bc=(S.sp==='month'&&ty==='exp'&&S.settings.budget&&S.settings.budget.cats)||{};
  if(!items.length)return `<div class="empty"><b>이 기간의 ${TYPE_NAME[ty]} 기록이 없어요</b>위에서 기간을 바꿔 보세요.</div>`;
  items.forEach((it,i)=>it.c=PIE[i%PIE.length]);
  let h=`<div class="card pie">${pieSvg(items,total)}</div><div class="rows" style="border-radius:var(--r)">`;
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
// 카드 사용 기간: 정산일부터 다음 정산일 전날까지, 결제는 그 뒤 처음 오는 결제일
const dayOf=(y,m,d)=>{const dt=new Date(y,m,1);const last=new Date(y,m+1,0).getDate();return new Date(y,m,Math.min(d,last));};
function cardCycles(a,base){const b=base?new Date(base+'T00:00:00'):new Date();const cd=a.cutDay||1,pd=a.payDay||1;
  let st=dayOf(b.getFullYear(),b.getMonth(),cd);if(st>b)st=dayOf(b.getFullYear(),b.getMonth()-1,cd);
  const mk=(s)=>{const nx=dayOf(s.getFullYear(),s.getMonth()+1,cd);const en=new Date(nx.getTime()-864e5);let py=dayOf(en.getFullYear(),en.getMonth(),pd);if(py<=en)py=dayOf(en.getFullYear(),en.getMonth()+1,pd);return {start:ymd(s),end:ymd(en),pay:ymd(py)};};
  const cur=mk(st);const prev=mk(dayOf(st.getFullYear(),st.getMonth()-1,cd));return {cur,prev};}
function accBalances(){const accs=S.settings.accounts;const bal=Object.create(null);accs.forEach(a=>bal[a.id]=Number(a.init)||0);const td=today();
  // 오늘 이후 날짜(할부 2/3회차처럼 미리 적어 둔 내역)는 그날이 되어야 잔액에 들어가요
  for(const ym of allMonths())for(const t of txOf(ym)){if(t.date>td)continue;if(t.type==='inc'){if(t.acc in bal)bal[t.acc]+=t.amount;}else if(t.type==='exp'){if(t.acc in bal)bal[t.acc]-=t.amount;}else{if(t.acc in bal)bal[t.acc]-=t.amount;if(t.to in bal)bal[t.to]+=t.amount;}}
  return bal;}
/* ---------- 자산 상세 (편한가계부 자산 화면처럼 일일·월별·연별) ---------- */
function accFlow(id){// 이 자산의 내역을 날짜순으로, 들어오면 +, 나가면 −
  const a=S.settings.accounts.find(x=>x.id===id)||{};const out=[];
  for(const ym of allMonths())for(const t of txOf(ym)){let v=0;if(t.type==='inc'&&t.acc===id)v=t.amount;else if(t.type==='exp'&&t.acc===id)v=-t.amount;else if(t.type==='trf'){if(t.acc===id)v-=t.amount;if(t.to===id)v+=t.amount;}if(v)out.push({t,v});}
  out.sort((x,y)=>x.t.date.localeCompare(y.t.date)||(x.t.time||'').localeCompare(y.t.time||'')||(x.t.created||0)-(y.t.created||0));
  let b=Number(a.init)||0;for(const o of out){b+=o.v;o.bal=b;}return {init:Number(a.init)||0,list:out};}
function avRange(){const v=S.av;if(v.tab==='d'){const p=period(v.label);return {start:p.start,end:p.end,last:p.last};}const y=v.year;return {start:y+'-01-01',end:(y+1)+'-01-01',last:y+'-12-31'};}
function avTop(){const v=S.av;const a=S.settings.accounts.find(x=>x.id===v.id)||{name:''};const [y,m]=v.label.split('-');
  const nav=v.tab==='d'?`<span class="lnav"><button data-act="avShift" data-k="-1" aria-label="이전">‹</button><b class="num">${y}년 ${+m}월</b><button data-act="avShift" data-k="1" aria-label="다음">›</button></span>`:`<span class="lnav"><button data-act="avShift" data-k="-1" aria-label="이전">‹</button><b class="num">${v.year}년</b><button data-act="avShift" data-k="1" aria-label="다음">›</button></span>`;
  return `<div class="ttl"><b><button class="x back2" data-act="avClose" aria-label="뒤로">←</button>${esc(a.name)}</b>${nav}</div><div class="subtabs three">${[['d','일일'],['m','월별'],['y','연별']].map(([k,n])=>`<button data-act="avTab" data-k="${k}" class="${v.tab===k?'on':''}">${n}</button>`).join('')}</div>`;}
function avHtml(a){const v=S.av;const F=accFlow(a.id);const R=avRange();const isCard=a.group==='카드';
  const inR=F.list.filter(o=>o.t.date>=R.start&&o.t.date<R.end);const inn=inR.reduce((x,o)=>x+(o.v>0?o.v:0),0),out=inR.reduce((x,o)=>x+(o.v<0?-o.v:0),0);
  const balAt=d=>{let b=F.init;for(const o of F.list){if(o.t.date>d)break;b=o.bal;}return b;};const endBal=balAt(R.last);
  const f2=d=>d.slice(2,4)+'.'+(+d.slice(5,7))+'.'+(+d.slice(8));
  let h=`<div class="avh"><div><small class="muted">사용기간</small><b class="num">${f2(R.start)} ~ ${f2(R.last)}</b></div><span class="avi"><button class="x" data-act="avChart" aria-label="${v.chart?'목록 보기':'그래프 보기'}">${v.chart?HICON.list:HICON.chart}</button><button class="x" data-act="accOpen" data-k="${esc(a.id)}" aria-label="자산 정보 수정">${HICON.pen}</button></span></div>
   <div class="net four num"><div><span>입금</span><b class="inc">${won(inn)}</b></div><div><span>출금</span><b class="exp">${won(out)}</b></div><div><span>합계</span><b>${inn-out<0?'-':''}${won(Math.abs(inn-out))}</b></div>${v.tab==='y'?'':`<div><span>누적잔액</span><b class="${endBal<0?'exp':'inc'}">${won(Math.abs(endBal))}</b></div>`}</div>`;
  if(v.chart){// 실적 + 최근 6개 기간 잔액선·출금막대
    if(isCard&&a.perf&&v.tab==='d'){const cy=cardCycles(a,R.last<today()?R.last:today());const used=F.list.filter(o=>o.v<0&&o.t.date>=cy.cur.start&&o.t.date<=cy.cur.end).reduce((x,o)=>x-o.v,0);
      h+=`<div class="perf"><div><small class="muted">실적 (${f2(cy.cur.start)} ~ ${f2(cy.cur.end)})</small><b class="num">${won(a.perf)}원 ${used>=a.perf?'<span class="okc">✓</span>':''}</b></div><div><small class="muted">실적사용금액</small><b class="num">${won(used)}원</b></div><div><small class="muted">남은금액</small><b class="num muted">${used>=a.perf?'0':won(a.perf-used)}원</b></div></div>`;}
    const per=[];if(v.tab==='d'){let l=v.label;for(let i=0;i<6;i++){per.unshift({lab:(+l.slice(5))+'월',r:period(l)});l=shiftLabel(l,-1);}}else{for(let i=5;i>=0;i--){const y=v.year-i;per.push({lab:String(y).slice(2)+'년',r:{start:y+'-01-01',end:(y+1)+'-01-01',last:y+'-12-31'}});}}
    const pts=per.map(p=>({lab:p.lab,bal:balAt(p.r.last),out:F.list.filter(o=>o.v<0&&o.t.date>=p.r.start&&o.t.date<p.r.end).reduce((x,o)=>x-o.v,0),inn:F.list.filter(o=>o.v>0&&o.t.date>=p.r.start&&o.t.date<p.r.end).reduce((x,o)=>x+o.v,0)}));
    h+=lineBars(pts);return h;}
  if(v.tab==='d'){const rows=inR.slice().reverse();if(!rows.length)return h+`<div class="empty"><b>이 기간 내역이 없어요</b></div>`+avFab(a);
    const by={};rows.forEach(o=>(by[o.t.date]=by[o.t.date]||[]).push(o));let first=true;
    h+=Object.keys(by).sort().reverse().map(d=>{const its=by[d];const di=its.reduce((x,o)=>x+(o.v>0?o.v:0),0),dx=its.reduce((x,o)=>x+(o.v<0?-o.v:0),0);const w=dowOf(d);
      return `<div class="dg"><div class="day"><span class="dn num">${+d.slice(8)}</span><span class="dw ${w===0?'sun':w===6?'sat':''}">${DOW[w]}요일</span><span class="dym num">${esc(d.slice(0,7).replace('-','.'))}</span><span class="ds num"><span class="inc">${won(di)}원</span><span class="exp">${won(dx)}원</span></span></div><div class="rows">${its.map(o=>{const t=o.t;const isT=t.type==='trf';const name=isT?'이체':(t.cat||'미분류');
        const r=`<button class="row avr" data-act="edit" data-id="${esc(t.id)}" data-ym="${esc(t.date.slice(0,7))}"><span class="c">${esc(name)}</span><span class="t"><b>${esc(t.memo||t.note||(isT?accName(t.acc)+' → '+accName(t.to):''))}</b><small>${esc(isT?(o.v>0?accName(t.acc)+'에서':accName(t.to)+'으로'):accName(t.acc))}</small></span><span class="a num"><span class="${o.v<0?'exp':'inc'}">${won(Math.abs(o.v))}원</span><small>(${first?'누적잔액 ':''}${o.bal<0?'-':''}${won(Math.abs(o.bal))})</small></span></button>`;first=false;return r;}).join('')}</div></div>`;}).join('');
    return h+avFab(a);}
  // 월별: 그 해 12달, 연별: 해마다
  const rowsP=[];if(v.tab==='m'){for(let m=12;m>=1;m--){const l=v.year+'-'+pad(m);const p=period(l);rowsP.push({lab:m+'월',r:p,k:l});}}else{const ys=uniq(F.list.map(o=>+o.t.date.slice(0,4))).sort((a,b)=>b-a);for(const y of ys)rowsP.push({lab:y+'년',r:{start:y+'-01-01',end:(y+1)+'-01-01',last:y+'-12-31'},ky:y});}
  h+='<div class="rows mrows">'+rowsP.map(x=>{const L=F.list.filter(o=>o.t.date>=x.r.start&&o.t.date<x.r.end);const i2=L.reduce((s2,o)=>s2+(o.v>0?o.v:0),0),o2=L.reduce((s2,o)=>s2+(o.v<0?-o.v:0),0);const eb=balAt(x.r.last);
    return `<button class="mrow" data-act="avGo" data-k="${x.k||''}" data-y="${x.ky||''}"><span class="ml"><b>${x.lab}</b></span><span class="num inc">${won(i2)}원</span><span class="mr num"><span class="exp">${won(o2)}원</span><small>${eb<0?'-':''}${won(Math.abs(eb))}원</small></span></button>`;}).join('')+'</div>';
  return h+avFab(a);}
function avFab(a){return a.group==='카드'?`<button class="fab2" data-act="avPay">결제</button>`:'';}
function lineBars(pts){const W=360,H1=200,H2=150,padL=8,padR=8,n=pts.length;const xs=pts.map((_,i)=>padL+30+(W-padL-padR-60)*i/Math.max(1,n-1));
  const bs=pts.map(p=>p.bal);let lo=Math.min(...bs),hi=Math.max(...bs);if(lo===hi){lo-=1;hi+=1;}const pad2=(hi-lo)*.15;lo-=pad2;hi+=pad2;const y=v=>18+(H1-48)*(1-(v-lo)/(hi-lo));
  const fm=v=>{const a=Math.abs(v);return (v<0?'-':'')+(a>=1e8?(a/1e8).toFixed(1)+'억':a>=1e4?Math.round(a/1e4)+'만':won(a));};
  let s1=`<svg viewBox="0 0 ${W} ${H1}" width="100%" class="lc"><rect x="0" y="0" width="${W}" height="${H1-30}" fill="var(--sunk)" rx="6"/>`;
  for(let g=0;g<=3;g++){const gv=lo+(hi-lo)*g/3;const gy=y(gv);s1+=`<line x1="0" x2="${W}" y1="${gy}" y2="${gy}" stroke="var(--line)"/><text x="4" y="${gy-3}" class="ax">${fm(gv)}</text>`;}
  s1+=`<polyline points="${xs.map((x,i)=>x.toFixed(1)+','+y(bs[i]).toFixed(1)).join(' ')}" fill="none" stroke="var(--exp)" stroke-width="2"/>`+xs.map((x,i)=>`<circle cx="${x.toFixed(1)}" cy="${y(bs[i]).toFixed(1)}" r="4.5" fill="var(--exp)"/><text x="${x.toFixed(1)}" y="${H1-14}" text-anchor="middle" class="ax2">${pts[i].lab}</text><text x="${x.toFixed(1)}" y="${H1}" text-anchor="middle" class="ax3">${bs[i]<0?'-':''}${won(Math.abs(bs[i]))}</text>`).join('')+'</svg>';
  const mo=Math.max(1,...pts.map(p=>p.out));const yb=v=>16+(H2-64)*(1-v/mo);
  let s2=`<svg viewBox="0 0 ${W} ${H2}" width="100%" class="lc"><rect x="0" y="0" width="${W}" height="${H2-48}" fill="var(--sunk)" rx="6"/>`+xs.map((x,i)=>`<rect x="${(x-9).toFixed(1)}" y="${yb(pts[i].out).toFixed(1)}" width="18" height="${(H2-48-yb(pts[i].out)).toFixed(1)}" fill="var(--exp)" opacity=".45"/><text x="${x.toFixed(1)}" y="${H2-32}" text-anchor="middle" class="ax2">${pts[i].lab}</text><text x="${x.toFixed(1)}" y="${H2-17}" text-anchor="middle" class="ax3 inc">${won(pts[i].inn)}</text><text x="${x.toFixed(1)}" y="${H2-2}" text-anchor="middle" class="ax3 exp">${won(pts[i].out)}</text>`).join('')+'</svg>';
  return `<div class="card charts">${s1}${s2}</div>`;}
function assetHtml(){const ms=allMonths();const pending=ms.some(ym=>!S.live[ym]&&!S.cache[ym]);
  if(pending){ensureMonths(ms);return '<div class="empty"><b>잔액을 계산하는 중이에요</b></div>';}
  if(S.av){const a=S.settings.accounts.find(x=>x.id===S.av.id);if(a)return avHtml(a);S.av=null;}
  if(S.overview)return `<button class="back" data-act="ovw" data-k="0">‹ 자산으로 돌아가기</button>`+overviewHtml();
  const accs=S.settings.accounts.filter(a=>!a.hidden);const bal=accBalances();
  const cur=curLabel();const td=today();const use=(lab)=>{const u=Object.create(null);for(const t of txIn(period(lab)))if(t.type==='exp'&&t.date<=td)u[t.acc]=(u[t.acc]||0)+t.amount;return u;};
  const u0=use(cur),u1=use(shiftLabel(cur,-1));
  const all=allMonths().flatMap(txOf);const useIn=(id,c)=>all.reduce((x,t)=>x+(t.type==='exp'&&t.acc===id&&t.date>=c.start&&t.date<=c.end&&t.date<=td?t.amount:0),0);
  const card=Object.create(null);for(const a of accs)if(a.group==='카드'){const cy=cardCycles(a);const out=Math.max(0,-bal[a.id]);const mi=Math.min(useIn(a.id,cy.cur),out);const due=Math.min(useIn(a.id,cy.prev),out-mi);card[a.id]={mi,due,old:out-mi-due};}
  let pos=0,neg=0;for(const a of accs){if(a.group==='체크카드')continue;const v=bal[a.id];if(v>=0)pos+=v;else neg+=-v;}
  const amt=v=>`<b class="num ${v<0?'exp':v>0?'inc':''}">${won(Math.abs(v))}원</b>`;
  const row=(a,inner)=>`<button class="acc ${inner.cc?'cc':''}" data-act="avOpen" data-k="${esc(a.id)}"><span>${esc(a.name)}</span>${inner.h}</button>`;
  let h=`<div class="card"><div class="net num"><div><span>자산</span><b class="inc">${won(pos)}</b></div><div><span>부채</span><b class="exp">${won(neg)}</b></div><div><span>합계</span><b>${pos-neg<0?'-':''}${won(Math.abs(pos-neg))}</b></div></div></div>`;
  const mlab=+cur.slice(5,7)+'월';
  for(const g of GROUPS){const list=accs.filter(a=>(a.group||'기타')===g);if(!list.length)continue;
    if(g==='카드'){const sDue=list.reduce((x,a)=>x+card[a.id].due+card[a.id].old,0),sMi=list.reduce((x,a)=>x+card[a.id].mi,0);
      h+=`<div class="grp"><div class="grp-h cc"><span>카드</span><span class="num"><small>결제예정금액</small><em class="${sDue?'exp':''}">${won(sDue)}원</em></span><span class="num"><small>미결제금액</small><em class="${sMi?'exp':''}">${won(sMi)}원</em></span></div><div class="rows" style="border-radius:var(--r)">${list.map(a=>{const c=card[a.id];const over=bal[a.id]>0?bal[a.id]:0;
        return row(a,{cc:1,h:`<span class="num c2"><b class="${c.due?'exp':''}">${won(c.due)}원</b>${c.old?`<small>-${won(c.old)}원</small>`:over?`<small class="inc">+${won(over)}원</small>`:''}</span><span class="num c3"><b class="${c.mi?'exp':''}">${won(c.mi)}원</b></span>`});}).join('')}</div></div>`;continue;}
    if(g==='체크카드'){const sum=list.reduce((x,a)=>x+(u0[a.id]||0),0);
      h+=`<div class="grp"><div class="grp-h"><span>체크카드(${mlab})</span><span class="num ${sum?'exp':''}">${won(sum)}원</span></div><div class="rows" style="border-radius:var(--r)">${list.map(a=>row(a,{h:`<b class="num ${u0[a.id]?'exp':''}">${won(u0[a.id]||0)}원</b>`})).join('')}</div></div>`;continue;}
    const sum=list.reduce((x,a)=>x+bal[a.id],0);
    h+=`<div class="grp"><div class="grp-h"><span>${g}</span><span class="num ${sum<0?'exp':sum>0?'inc':''}">${won(Math.abs(sum))}원</span></div><div class="rows" style="border-radius:var(--r)">${list.map(a=>row(a,{h:amt(bal[a.id])})).join('')}</div></div>`;}
  const nh=S.settings.accounts.length-accs.length;
  h+=`<div class="menu">${nh?`<button data-act="open" data-k="accHide"><span>숨긴 자산</span><small>${nh}개 ›</small></button>`:''}</div><p style="font-size:12px;color:var(--muted);padding:0 4px;line-height:1.6">빨간 숫자는 쓴 돈이 들어온 돈보다 많은 금액(부채)이에요. 카드: 미결제금액 = 이번 사용 기간 사용액, 결제예정금액 = 지난 사용 기간 사용액(카드마다 정산일 기준), 아래 회색 = 그 전부터 남은 금액. 오늘 이후 날짜의 내역(할부 다음 회차 등)은 그날이 되면 들어가요. 체크카드는 이번 달 사용액만 보여주고 합계에는 넣지 않아요. 자산을 누르면 그 자산의 내역과 추이를 볼 수 있어요. 오른쪽 위 그래프 단추는 전체 통계예요.</p>`;
  return h;}

function moreHtml(){const st=S.settings;const bt=st.budget&&st.budget.total;
  if(S.moreView==='set')return setMgmtHtml();
  const sc=!S.db?'off':GH.err?'off':S.db.pending()?'pending':'ok';
  const G=(act,k,ic,n)=>`<button class="gi" data-act="${act}" data-k="${k}">${ic}<span>${n}</span></button>`;
  return `<div class="card acct"><button class="acct-h" data-act="open" data-k="sync"><span><b>${esc((S.user&&S.user.displayName)||'내 가계부')}</b><small class="muted">${esc((S.user&&S.user.email)||'')}</small></span><i>›</i></button>
   <div class="acct-s"><span><span class="muted">실시간 동기화</span> <em class="sync-b ${sc}">${sc==='off'?'끊김':sc==='pending'?'저장 중':'사용 중'}</em><br><small class="muted">다른 폰·PC와 바로 맞춰져요</small></span><button class="btn sm" data-act="open" data-k="sync">백업·계정</button></div></div>
  <div class="grid3">${isStandalone()?'':G('install','', MICON.install,'앱 설치')}${G('moreGo','set',MICON.gear,'설정관리')}${G('open','sms',MICON.sms,'문자 붙여넣기')}${G('open','search',MICON.search,'내역 검색')}${G('open','sync',MICON.backup,'백업/복원')}${G('export','month',MICON.xls,'이번 달 엑셀')}${G('export','all',MICON.xls,'전체 엑셀')}</div>
  <div class="card help"><h3>여러 휴대폰에서 같이 쓰기</h3>`+moreHelp();}
const MI=d=>`<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const MICON={gear:MI('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
 sms:MI('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),search:MI('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
 backup:MI('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),xls:MI('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 13l4 5M13 13l-4 5"/>'),
 install:MI('<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>')};
function setMgmtHtml(){const st=S.settings;const bt=st.budget&&st.budget.total;const nd=(st.deleted||[]).length;const nc=st.accounts.filter(a=>a.group==='카드').length;
  const it=(act,k,n,v,extra)=>`<button data-act="${act}" data-k="${k}" ${extra||''}><span>${n}</span><small class="sv">${v||''}</small></button>`;
  return `<div class="smg"><div class="smh">자산관리</div>
   ${it('open','accounts','자산설정',st.accounts.length+'개')}${it('open','accHide','표시/숨김',st.accounts.filter(a=>a.hidden).length?st.accounts.filter(a=>a.hidden).length+'개 숨김':'')}${it('open','accOrder','자산 순서 변경','')}${it('open','accDeleted','삭제된 자산',nd?nd+'개':'')}${it('open','cardPerf','카드 이용실적',nc+'장')}
   <div class="smh">분류/반복</div>
   ${it('catsOf','inc','수입분류 관리',st.cats.inc.length+'개')}${it('catsOf','exp','지출분류 관리',st.cats.exp.length+'개')}${it('setToggle','subOn','소분류 기능',st.subOn===false?'OFF':'ON')}${it('open','budget','예산설정',bt?'월 '+won(bt)+'원':'')}${it('open','favorites','자주 쓰는 내역',(st.favorites||[]).length+'건')}${it('open','recurring','반복관리',(st.recurring||[]).length+'건')}
   <div class="smh">설정관리</div>
   ${it('setToggle','firstSub','가계부탭 첫화면 (일일/달력)',st.firstSub==='cal'?'달력':'일일')}${it('open','monthStart','월 시작일',(parseInt(st.monthStart,10)||1)+' 일')}${it('setToggle','weekStart','주간 시작일 설정',st.weekStart===1?'월요일':'일요일')}
   <div class="smh">기타</div>
   ${it('open','pin','비밀번호',st.pin?'ON':'OFF')}${it('open','sync','계정·동기화·백업','')}</div>`;}
function moreHelp(){return `
  <p><b>내 폰·PC 여러 대</b> — 각 기기에서 이 주소를 열고 같은 구글 계정으로 로그인하면 끝이에요. 한쪽에서 입력하면 다른 기기에 바로 나타나요.</p>
  <p><b>가족과 함께</b> — 가족 구글 계정을 허용 목록에 넣으면 같은 장부에 함께 적을 수 있어요. 필요하면 Claude에게 부탁하세요.</p>
  <p><b>앱처럼 쓰기</b> — 휴대폰 브라우저에서 링크를 연 뒤 ‘홈 화면에 추가’를 누르면 아이콘으로 바로 열려요.</p></div>${footHtml()}`;}

/* ---------- sheets ---------- */
function openSheet(k){if(!S.sheet&&!S.histSheet){try{history.pushState({mbSheet:1},'');S.histSheet=true;}catch(e){}}S.sheet=k;renderSheet();}
function closeSheet(){S.sheet=null;$('#sheetRoot').innerHTML='';if(S.histSheet){S.histSheet=false;try{history.back();}catch(e){}}}
window.addEventListener('popstate',()=>{if(S.histSheet){S.histSheet=false;if(S.sheet){S.sheet=null;$('#sheetRoot').innerHTML='';render();}}});
function renderSheet(){if(!S.sheet){closeSheet();return;}const fn=SHEETS[S.sheet];if(!fn)return;
  const sc=$('.sheet')?$('.sheet').scrollTop:0;
  const full=['tx','search','favorites','filter','accEdit'].includes(S.sheet);const sc2=$('.txb')?$('.txb').scrollTop:0;const sc3=$('.sres')?$('.sres').scrollTop:0;
  $('#sheetRoot').innerHTML=`<div class="ov ${full?'full':''}" data-act="ovClose"><div class="sheet ${full?'full':''}" role="dialog" aria-modal="true">${(full?'':'<div class="grab"></div>')+fn()}</div></div>`;
  const sh=$('.sheet');if(sh)sh.scrollTop=sc;const tb=$('.txb');if(tb)tb.scrollTop=sc2;const sr=$('.sres');if(sr)sr.scrollTop=sc3;}
function head(t,extra){return `<div class="sh-h"><h2>${t}</h2>${extra||''}<button class="x" data-act="close" aria-label="닫기">×</button></div>`;}
function accOptions(sel){return GROUPS.map(g=>{const a=S.settings.accounts.filter(x=>(x.group||'기타')===g&&(!x.hidden||x.id===sel));return a.length?`<optgroup label="${g}">${a.map(x=>`<option value="${esc(x.id)}" ${x.id===sel?'selected':''}>${esc(x.name)}</option>`).join('')}</optgroup>`:'';}).join('');}
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
    `<div class="pg">${GROUPS.flatMap(g=>S.settings.accounts.filter(a=>(a.group||'기타')===g&&(!a.hidden||a.id===sel))).map(a=>`<button data-act="pickAcc" data-k="${esc(a.id)}" class="${sel===a.id?'on':''}">${esc(a.name)}<small>${esc(a.group||'')}</small></button>`).join('')}</div>`;}
  if(p==='rep'){const opt=(v,l,on)=>`<button data-act="repSet" data-k="${v}" class="${on?'on':''}">${l}</button>`;
    return kpHead('반복 / 할부')+`<div class="pg">${opt('none','없음',!f.rep&&!(f.inst>1))}${opt('monthly','매월 반복',f.rep==='monthly')}${[2,3,4,5,6,10,12].map(n=>opt('inst'+n,n+'개월 할부',f.inst===n)).join('')}</div>
    <p class="muted" style="padding:8px 16px 12px;margin:0">매월 반복은 다음 달부터 같은 날짜에 자동으로 적혀요. 할부는 금액을 나눠 달마다 한 건씩 적어요.</p>`;}
  return '';}

// 검색 결과만 다시 그려요. 검색창은 건드리지 않아서 한글 조합(ㄱ+ㅏ→가)이 끊기지 않아요.
function searchResults(){const q=S.search.trim();const ms=allMonths();const loading=ms.some(ym=>!S.live[ym]&&!S.cache[ym]);
  if(loading)return '<div class="empty">전체 내역을 불러오는 중…</div>';if(!q)return '<div class="empty">검색어를 입력하세요</div>';
  const words=q.normalize('NFC').toLowerCase().replace(/,/g,'').split(/\s+/).filter(Boolean);
  const hay=t=>[t.memo,t.note,t.cat,t.sub,accName(t.acc),t.to?accName(t.to):'',String(t.amount),won(t.amount),t.date].join(' ').normalize('NFC').toLowerCase().replace(/,/g,'');
  const all=ms.flatMap(txOf).filter(t=>{const h=hay(t);return words.every(w=>h.includes(w));}).sort((a,b)=>b.date.localeCompare(a.date)||(b.time||'').localeCompare(a.time||''));
  if(!all.length)return '<div class="empty">찾는 내역이 없어요</div>';const sum=totals(all);const res=all.slice(0,300);
  return `<div class="sinfo num">${all.length}건 · 수입 <span class="inc">${won(sum.inc)}원</span> · 지출 <span class="exp">${won(sum.exp)}원</span>${all.length>res.length?` · 최근 ${res.length}건만 표시`:''}</div>`+dayGroups(res);}
function updateSearch(){const r=document.getElementById('sres');if(r&&S.sheet==='search')r.innerHTML=searchResults();}
/* ---------- 날짜(달) 고르기 창 ---------- */
function mpRender(){let r=document.getElementById('mpRoot');if(!r){r=document.createElement('div');r.id='mpRoot';document.body.appendChild(r);}
  const m=S.mp;if(!m){r.innerHTML='';return;}const [cy,cm]=(m.mode==='syear'?[String(S.spYear||S.label.slice(0,4)),'00']:S.label.split('-'));const now=curLabel();
  const months=m.mode==='month'?`<div class="mp-g">${Array.from({length:12},(_,i)=>{const l=m.y+'-'+pad(i+1);return `<button data-act="mpPick" data-k="${l}" class="${l===S.label?'on':''} ${l===now?'now':''}">${i+1}월</button>`;}).join('')}</div>`
    :`<div class="mp-g">${Array.from({length:12},(_,i)=>{const yy=m.y0+i;return `<button data-act="mpPickY" data-k="${yy}" class="${String(yy)===cy?'on':''} ${String(yy)===now.slice(0,4)?'now':''}">${yy}</button>`;}).join('')}</div>`;
  r.innerHTML=`<div class="mp-ov" data-act="mpClose"></div><div class="mp" role="dialog" aria-label="날짜 고르기"><div class="mp-h"><span>날짜</span><button data-act="mpNow">${m.mode==='month'?'이번 달':'올해'}</button><button data-act="mpClose" aria-label="닫기">×</button></div>
    <div class="mp-y"><button data-act="mpY" data-k="-1" aria-label="이전">‹</button><b>${m.mode==='month'?m.y:(m.y0+' – '+(m.y0+11))}</b><button data-act="mpY" data-k="1" aria-label="다음">›</button></div>${months}</div>`;}
function goLabel(l){if(l===S.label)return;S.label=l;S.selDay='';S.statCat='';subscribePeriod();render();}
const accGrouped=(fn)=>GROUPS.map(g=>{const l=S.settings.accounts.filter(a=>(a.group||'기타')===g);return l.length?`<div class="agh">${g}</div>`+l.map(fn).join(''):'';}).join('');
const EYE='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYEX='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const SHEETS={
 accEdit(){const d=S.accEd;const isNew=!d.id;const g=d.group;
  const sms=['은행','카드','체크카드','선불식카드','마이너스 통장'].includes(g);const amt=g!=='체크카드';const pay=g==='카드'||g==='체크카드';
  const row=(lab,inner,cls)=>`<div class="frow ae ${cls||''}"><span class="fl">${lab}</span>${inner}</div>`;
  const inp=(id,v,ph,extra)=>`<input class="fv" id="${id}" value="${esc(v||'')}" placeholder="${ph||''}" autocomplete="off" ${extra||''}>`;
  const days=(id,v)=>`<select class="fv" id="${id}">${Array.from({length:31},(_,i)=>`<option value="${i+1}" ${+v===i+1?'selected':''}>${i===30?'말일':(i+1)+' 일'}</option>`).join('')}</select>`;
  let h=`<div class="txb aeb"><div class="txh"><button class="x" data-act="close" aria-label="닫기">←</button><h2>${isNew?'자산추가':'자산수정'}</h2></div><div class="aebody">`;
  h+=row('그룹',`<button class="fv" data-act="aeGroupOpen">${esc(g)}</button>`);
  h+=row('이름',inp('ae-name',d.name,'','maxlength="30"'));
  if(amt)h+=row('금액',inp('ae-init',d.init?(d.init<0?'-':'')+won(Math.abs(d.init)):'','0원','inputmode="text"'));
  if(g==='마이너스 통장'||g==='대출')h+=`<p class="aenote">${g}을 입력하실 때에는 금액에 '-' 를 함께 입력하셔야 부채에 합산돼요. '-' 가 없으면 자산에 합산돼요.</p>`;
  if(pay)h+=row('결제',`<select class="fv" id="ae-pay"><option value="">선택 안 함</option>${S.settings.accounts.filter(a=>['은행','마이너스 통장','현금','저축'].includes(a.group)&&a.id!==d.id).map(a=>`<option value="${esc(a.id)}" ${a.id===d.pay?'selected':''}>${esc(a.name)}</option>`).join('')}</select>`);
  h+=row('메모',inp('ae-memo',d.memo,'','maxlength="200"'));
  if(sms){h+=`<div class="aesep"></div>`+row('전화번호',inp('ae-phone',d.phone,'문자 보내는 번호','inputmode="tel"'))+row('<small>문자연결어</small>',inp('ae-key',d.smsKey,'예: 삼성1234'))+row('어플',inp('ae-app',d.app,'예: 삼성카드 앱'));
    h+=`<p class="aenote">문자 붙여넣기 할 때 이 번호나 연결어가 들어 있으면 이 자산으로 자동 선택돼요. 연결어는 쉼표(,)로 여러 개 적을 수 있어요.</p>`;}
  if(g==='카드'){h+=`<div class="aesep"></div>`+row('정산일',days('ae-cut',d.cutDay||1))+row('결제일',days('ae-payday',d.payDay||1));
    const cy=cardCycles({cutDay:d.cutDay||1,payDay:d.payDay||1});const f=x=>x.slice(5).replace('-','.');
    h+=`<div class="aecy"><div><span>결제예정금액</span><b class="num">${f(cy.prev.start)} ~ ${f(cy.prev.end)} (결제: ${f(cy.prev.pay)})</b></div><div><span>미결제금액</span><b class="num">${f(cy.cur.start)} ~ ${f(cy.cur.end)} (결제: ${f(cy.cur.pay)})</b></div></div>`;}
  if(g==='체크카드')h+=`<p class="aenote">체크카드 그룹은 이월·누적되지 않고 이번 달 사용액만 보여줘요. 누적 금액은 연결된 은행 자산에서 볼 수 있어요. 금액 이월·누적을 원하면 그룹을 은행으로 정하세요.</p>`;
  h+=`<div class="acts">${isNew?'':`<button class="btn" data-act="aeHide">${d.hidden?'다시 표시':'숨기기'}</button>`}<button class="btn pri" data-act="aeSave">저장하기</button></div></div>`;
  if(S.aeGP)h+=`<div class="gdlg-ov" data-act="aeGroupClose"></div><div class="gdlg" role="dialog" aria-label="자산그룹"><h3>자산그룹</h3>${GROUPS.map(x=>`<button data-act="aeGroup" data-k="${x}" class="${x===g?'on':''}">${x}</button>`).join('')}</div>`;
  return h+'</div>';},
 accDeleted(){const d=S.settings.deleted||[];return head('삭제된 자산')+(d.length?`<p class="muted" style="margin:0 0 10px;font-size:13px">되살리면 원래 그룹 맨 끝에 다시 생기고, 그 자산으로 적은 내역도 그대로 이어져요.</p><div class="alist">${d.map(a=>`<div class="ali"><span>${esc(a.name)}<small class="muted" style="display:block;font-size:12px">${esc(a.group)}</small></span><button class="btn sm" data-act="aRestore" data-k="${esc(a.id)}">되살리기</button></div>`).join('')}</div>`:'<div class="empty"><b>삭제된 자산이 없어요</b></div>');},
 cardPerf(){const l=S.settings.accounts.filter(a=>a.group==='카드');return head('카드 이용실적')+`<p class="muted" style="margin:0 0 10px;font-size:13px">카드마다 한 달에 채워야 하는 실적 금액을 적어 두면, 자산 › 카드 › 그래프 화면에서 얼마 남았는지 보여줘요.</p><div class="alist">${l.map(a=>`<div class="ali"><span>${esc(a.name)}</span><input class="in-t num perfin" data-perf="${esc(a.id)}" inputmode="numeric" value="${a.perf?won(a.perf):''}" placeholder="0원"></div>`).join('')}</div><div class="acts"><button class="btn pri" data-act="perfSave">저장</button></div>`;},
 accHide(){return head('표시/숨김')+`<p class="muted" style="margin:0 0 10px;font-size:13px">눈을 끄면 자산 화면과 입력할 때 고르는 목록에서 숨겨요. 내역은 그대로 남아요.</p><div class="alist">${accGrouped(a=>`<button class="ali" data-act="aHide" data-k="${esc(a.id)}"><span class="${a.hidden?'muted':''}">${esc(a.name)}</span><i class="eye ${a.hidden?'off':''}">${a.hidden?EYEX:EYE}</i></button>`)}</div>`;},
 accDel(){const ask=S.accDelAsk;const cnt=ask?allMonths().flatMap(txOf).filter(t=>t.acc===ask||t.to===ask).length:0;
  return head('삭제')+`<div class="alist">${accGrouped(a=>`<div class="ali"><button class="minus" data-act="aDel" data-k="${esc(a.id)}" aria-label="${esc(a.name)} 삭제">−</button><span>${esc(a.name)}</span>${ask===a.id?`<button class="btn danger sm" data-act="aDelOk" data-k="${esc(a.id)}">삭제</button>`:''}</div>${ask===a.id?`<div class="adwarn">${cnt?`이 자산으로 적은 내역 ${cnt}건은 그대로 남아요. 삭제한 자산은 설정관리 › 삭제된 자산에서 되살릴 수 있어요.`:'이 자산으로 적은 내역이 없어요.'}</div>`:''}`)}</div>`;},
 accOrder(){const sel=S.accSel;return head('순서 변경',`<span class="ordbtn"><button class="x" data-act="aMove" data-k="-1" aria-label="위로" ${sel?'':'disabled'}>▲</button><button class="x" data-act="aMove" data-k="1" aria-label="아래로" ${sel?'':'disabled'}>▼</button></span>`)+`<p class="muted" style="margin:0 0 10px;font-size:13px">옮길 자산을 누르고 ▲▼로 움직여요. 같은 그룹 안에서 움직여요.</p><div class="alist">${accGrouped(a=>`<button class="ali ${sel===a.id?'sel':''}" data-act="aSel" data-k="${esc(a.id)}"><span>${esc(a.name)}</span>${sel===a.id?'<i class="chk">✓</i>':''}</button>`)}</div>`;},
 tx(){const f=S.form;const edit=!!f.orig;const val=calc(f.amountStr);const ops=/[+\-*/×÷−]/.test(f.amountStr.replace(/^-/,''));
  const [yy,mm,dd]=f.date.split('-');const dl=esc(`${String(yy).slice(2)}. ${mm}. ${dd}. (${DOW[dowOf(f.date)]||''})`);
  const catTxt=f.cat?esc(f.cat)+(f.sub?' <span class="muted">› '+esc(f.sub)+'</span>':''):'';
  const frow=(lab,k,txt)=>`<div class="frow ${f.panel===k?'act':''}"><span class="fl">${lab}</span><button class="fv" data-act="panel" data-k="${k}">${txt||'<span class="ph">선택</span>'}</button></div>`;
  let h=`<div class="txb t-${okType(f.type)}"><div class="txh"><button class="x" data-act="close" aria-label="닫기">←</button><h2>${edit?'내역 수정':TYPE_NAME[f.type]}</h2>
    ${edit?'':`<button class="x hx" data-act="open" data-k="sms" aria-label="문자 붙여넣기">${HICON.sms}</button><button class="x hx" data-act="txFav" aria-label="자주 쓰는 내역">${HICON.fav}</button>`}</div>
  <div class="tseg">${['inc','exp','trf'].map(k=>`<button data-act="ftype" data-k="${k}" class="${f.type===k?'on '+k:''}">${TYPE_NAME[k]}</button>`).join('')}</div>
  <div class="frow"><span class="fl">날짜</span><label class="fv date num"><span>${dl}</span><input type="date" id="f-date" value="${esc(f.date)}" aria-label="날짜"></label>
    ${edit?'':`<button class="repb ${f.inst>1||f.rep?'on':''}" data-act="panel" data-k="rep"><svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4"/></svg><small>${f.inst>1?f.inst+'개월 할부':f.rep?'매월 반복':'반복/할부'}</small></button>`}</div>
  <div class="frow ${f.panel==='amt'?'act':''}"><span class="fl">금액</span><button class="fv amtv num" data-act="panel" data-k="amt">${f.amountStr?fmtExpr(f.amountStr)+(ops&&!isNaN(val)?` <small>= ${won(val)}원</small>`:'원'):'<span class="ph">&nbsp;</span>'}</button>${f.type==='trf'?`<button class="feeb num ${f.panel==='fee'||calc(f.feeStr||'')>0?'on':''}" data-act="panel" data-k="fee">${calc(f.feeStr||'')>0?'수수료 '+won(calc(f.feeStr)):'수수료'}</button>`:''}</div>
  ${f.type==='trf'?`<div class="swapw">${frow('출금','acc',f.acc?esc(accName(f.acc)):'')+frow('입금','to',f.to?esc(accName(f.to)):'')}<button class="swapb" data-act="swapAcc" aria-label="출금과 입금 바꾸기">↓↑</button></div>`:frow('분류','cat',catTxt)+frow('자산','acc',f.acc?esc(accName(f.acc)):'')}
  <div class="frow"><span class="fl">내용</span><input class="fv" id="f-memo" placeholder="" value="${esc(f.memo)}" autocomplete="off" data-act="memoFocus"></div>
  <div class="frow"><span class="fl">메모</span><input class="fv" id="f-note" placeholder="가게 이름 등" value="${esc(f.note||'')}" autocomplete="off" data-act="memoFocus"></div>
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

 search(){return `<div class="txb fl0"><div class="txh"><button class="x" data-act="close" aria-label="닫기">←</button><h2>검색</h2></div>
  <div class="sbox">${HICON.search}<input id="q" type="search" placeholder="가게 이름, 분류, 금액, 카드" value="${esc(S.search)}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"></div></div>
  <div class="sres" id="sres">${searchResults()}</div>`;},

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
  ${list.length?`<div class="lst" style="margin-top:12px">${list.map((x,i)=>`<div class="li"><span class="g">${esc(x.memo||x.cat)}<small class="num">매월 ${parseInt(x.day,10)||1}일 · ${TYPE_NAME[okType(x.type)]} ${won(x.amount)}원 · ${esc(accName(x.acc))}</small></span><button class="mini" data-act="recDel" data-i="${i}">삭제</button></div>`).join('')}</div>`:''}
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
  if(d){return head('비밀번호 잠금')+`<div class="pinbox"><img src="logo-mark.svg" alt="" width="56" height="56"><div class="pin-step"><span class="${d.step===1?'on':''}">1</span><i></i><span class="${d.step===2?'on':''}">2</span></div>
    <b class="pin-t">${d.step===1?'새 비밀번호 4자리':'한 번 더 입력해 주세요'}</b><span class="pin-s">${d.step===1?'가계부를 열 때 쓸 번호예요':'확인을 위해 같은 번호를 눌러 주세요'}</span>
    ${dotsHtml(d.cur.length,!!d.err)}<div class="err pin-e">${esc(d.err||'')}</div>${padHtml()}</div>`;}
  return head('비밀번호 잠금')+`<p style="margin:0;font-size:14px;color:var(--muted)">가계부를 열 때 4자리 비밀번호를 물어봐요. 모든 휴대폰에 똑같이 적용돼요.</p>${st.pin?`<div class="card bioc"><div><b>지문·얼굴로 열기</b><small class="muted">${bioGet()?'이 기기에서 켜져 있어요. 비밀번호 대신 지문이나 얼굴로 바로 열려요.':S.bioOk===false?'이 기기(브라우저)는 지문·얼굴 확인을 지원하지 않아요.':'이 기기에서만 켜져요. 기기마다 한 번씩 켜 주세요.'}</small></div>${S.bioOk===false?'':`<button class="btn ${bioGet()?'':'pri'} sm" data-act="${bioGet()?'bioOff':'bioOn'}">${bioGet()?'끄기':'켜기'}</button>`}</div>`:''}
  ${st.pin?`<div class="f"><label for="lockMin">다시 잠그기</label><select class="in-t" id="lockMin">${[[0,'화면을 벗어나면 바로'],[1,'1분 뒤'],[5,'5분 뒤'],[30,'30분 뒤']].map(([v,n])=>`<option value="${v}" ${(st.lockMin??1)===v?'selected':''}>${n}</option>`).join('')}</select></div>
  <div class="acts"><button class="btn danger" data-act="pinOff">잠금 끄기</button><button class="btn" data-act="pinStart">비밀번호 바꾸기</button></div>`:
  `<div class="acts"><button class="btn pri" data-act="pinStart">비밀번호 설정</button></div>`}`;},
install(){const ios=isIOS();const pc=isPC();return head('앱으로 설치')+`<div style="text-align:center;margin:4px 0 14px"><img src="logo.png" alt="티끌모아" style="width:100%;max-width:320px;border-radius:12px"></div>
  ${pc?`<ol class="steps"><li><b>크롬</b>이나 <b>엣지</b>로 이 주소를 열어주세요.</li><li>주소창 오른쪽 끝의 <b>설치 아이콘</b>(모니터에 화살표)을 누르세요. 안 보이면 메뉴 ⋮ → <b>저장 및 공유 → 페이지를 앱으로 설치</b> (엣지는 … → <b>앱 → 이 사이트를 앱으로 설치</b>)</li><li><b>설치</b>를 누르면 바탕화면과 시작 메뉴에 티끌모아가 생겨요.</li></ol>`:ios?`<ol class="steps"><li><b>사파리</b>로 이 주소를 열어주세요.</li><li>아래쪽 <b>공유 버튼</b>(네모에 화살표)을 누르세요.</li><li><b>홈 화면에 추가</b>를 누르고 <b>추가</b>를 누르면 끝이에요.</li></ol>`:
  `<ol class="steps"><li><b>크롬</b>이나 <b>삼성 인터넷</b>으로 이 주소를 열어주세요.</li><li>오른쪽 위(삼성 인터넷은 아래) <b>메뉴 ⋮ / ≡</b>를 누르세요.</li><li><b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누르면 끝이에요.</li></ol>`}
  <p class="muted">설치하면 주소창 없이 앱처럼 열리고, 기기마다 처음 한 번만 동기화 연결을 하면 돼요. 업데이트는 앱을 열 때 자동으로 받아요.</p>`;},
 sync(){const u=S.user||{};const t=GH.lastOk?new Date(GH.lastOk):null;return head('계정·동기화')+`<div class="kv num"><div><span>로그인 계정</span><b>${esc(u.email||'-')}</b></div>
  <div><span>상태</span><b class="${GH.err?'exp':''}">${GH.err?'끊김':S.db&&S.db.pending()?'보내는 중':'정상'}</b></div><div><span>마지막 확인</span><b>${t?pad(t.getHours())+':'+pad(t.getMinutes())+':'+pad(t.getSeconds()):'-'}</b></div></div>
  ${GH.err?`<div class="err">${esc(GH.err)}</div>`:''}<p class="muted">입력하면 다른 폰·PC에 바로 나타나요. 인터넷이 끊겨도 이 기기에 먼저 저장하고, 연결되면 자동으로 보내요.</p>
  <div class="card" style="background:var(--bg);margin-top:14px"><h3>백업 파일</h3><p class="muted" style="margin:0 0 8px">전체 장부를 파일 하나로 받아 보관하거나, 그 파일로 되돌릴 수 있어요. 한 달에 한 번쯤 받아두면 안심이에요.</p>
  <div class="acts" style="margin-top:6px"><button class="btn" data-act="bkFile">백업 파일 받기</button><label class="btn" for="bk-in" style="text-align:center;cursor:pointer">파일로 되돌리기</label></div><input type="file" id="bk-in" accept="application/json,.json" hidden>
  ${S.bkInfo?`<p class="muted">${esc(S.bkInfo)}</p>${S.bkData?`<button class="btn danger ${S.bkAsk?'go':''} wide2" data-act="bkRestore">${S.bkAsk?(S.bkData.merge?'정말 넣기':'정말 되돌리기'):(S.bkData.merge?'이 파일 내역 넣기':'이 파일로 되돌리기')}</button>`:''}`:''}</div>
  <div class="acts"><button class="btn danger ${S.ghOffAsk?'go':''}" data-act="logout">${S.ghOffAsk?'정말 로그아웃':'로그아웃'}</button></div>`;},
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
  if(dm){const mo=+dm[1],da=+dm[2];if(mo>=1&&mo<=12&&da>=1&&da<=new Date(2024,mo,0).getDate()){let y=now.getFullYear();let c=y+'-'+pad(mo)+'-'+pad(da);if(c>ymd(new Date(now.getTime()+864e5)))c=(y-1)+'-'+pad(mo)+'-'+pad(da);date=c;}}
  const tm=s.match(/(\d{1,2}):(\d{2})/);if(tm)time=pad(tm[1])+':'+tm[2];
  let memo='';if(tm){const lines=s.slice(tm.index+tm[0].length).split('\n').map(x=>x.trim()).filter(Boolean);
    for(const l of lines){const c=l.replace(/\s*(누적|잔액|잔고|한도).*$/,'').trim();if(c&&!/^[\d,]+\s*원/.test(c)){memo=c;break;}}}
  if(!memo){const lines=s.split('\n').map(x=>x.trim()).filter(x=>x&&!/원|승인|\d{1,2}[\/:]\d{2}|님$|Web발신|누적|잔액|체크|카드/.test(x));memo=lines[lines.length-1]||'';}
  for(let k=0;k<4;k++)memo=memo.replace(/^\(?(일시불|할부\d*개?월?)\)?\s*/,'').replace(/^(입금|출금|이체|승인|결제|사용|체크)\s*/,'').replace(/^[\d,]+\s*원\s*/,'');
  memo=memo.trim().slice(0,40);
  let acc='';const byKey=S.settings.accounts.find(a=>(a.smsKey&&a.smsKey.split(',').map(x=>x.trim()).filter(Boolean).some(k=>s.includes(k)))||(a.phone&&a.phone.replace(/\D/g,'').length>=8&&s.replace(/\D/g,'').includes(a.phone.replace(/\D/g,''))));if(byKey)acc=byKey.id;
  if(!acc)for(const [k,n] of CARD_KEYS){if(s.includes(k)){const a=S.settings.accounts.find(a=>a.name.includes(n)||a.name.toUpperCase().includes(k));if(a){acc=a.id;break;}}}
  if(!acc&&type==='inc'){const b=S.settings.accounts.find(a=>a.group==='은행');if(b)acc=b.id;}
  if(!acc)acc=lastAcc();
  const it={type,amount,date,time,memo:memo+(cancel?' (취소)':''),acc,cat:guessCat(memo,type),on:true,dup:false};
  const ex=txOf(date.slice(0,7)).some(t=>t.date===date&&t.amount===amount&&(t.memo||'')===it.memo);if(ex){it.dup=true;it.on=false;}return it;}
function parseSms(text){return text.split(/\[Web발신\]|\n\s*\n/).map(x=>x.trim()).filter(x=>/[\d,]+\s*원/.test(x)).map(parseOne).filter(Boolean);}

/* ---------- export ---------- */
const XLSX_URL='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
function loadXLSX(){if(window.XLSX)return Promise.resolve(window.XLSX);return new Promise((ok,no)=>{const sc=document.createElement('script');sc.src=XLSX_URL;sc.crossOrigin='anonymous';sc.integrity='sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';sc.onload=()=>ok(window.XLSX);sc.onerror=no;document.head.appendChild(sc);});}
function stamp(){const n=new Date();return n.getFullYear()+pad(n.getMonth()+1)+pad(n.getDate())+'_'+pad(n.getHours())+pad(n.getMinutes())+pad(n.getSeconds());}
async function doExport(scope){if(S.exporting)return;S.exporting=true;toast('엑셀 파일을 만드는 중이에요');
  try{let list;if(scope==='month'){list=txIn(period(S.label));}else{await needAll();list=allMonths().flatMap(txOf);}
    if(!list.length){toast('내보낼 내역이 없어요');return;}
    let X;try{X=await loadXLSX();}catch(e){toast('엑셀 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요');return;}
    list=list.slice().sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
    const money=ws=>{for(const k in ws){if(k[0]!=='!'&&ws[k].t==='n')ws[k].z='#,##0';}return ws;};
    const wb=X.utils.book_new();
    // 1. 내역 — 편한가계부 내보내기와 같은 양식
    const xdt=t=>{let y,mo,d,h=0,mi=0,se=0;[y,mo,d]=t.date.split('-').map(Number);
      if(t.src==='편한가계부'&&t.created){const c=new Date(t.created);if(ymd(c)===t.date){h=c.getHours();mi=c.getMinutes();se=c.getSeconds();}}
      else if(t.time){[h,mi]=t.time.split(':').map(Number);}
      return {sort:t.date+' '+pad(h)+':'+pad(mi)+':'+pad(se),serial:Date.UTC(y,mo-1,d,h,mi,se)/864e5+25569};};
    const kind=t=>t.type==='inc'?'수입':t.type==='exp'?'지출':'이체';
    const recs=list.map(t=>({t,x:xdt(t)})).sort((a,b)=>b.x.sort.localeCompare(a.x.sort));
    const aoa=[['날짜','자산','분류','소분류','내용','금액(원)','수입/지출','메모','금액','화폐']].concat(recs.map(({t,x})=>[x.serial,accName(t.acc),t.type==='trf'?accName(t.to):(t.cat||''),t.sub||'',t.memo||'',t.amount,kind(t),t.note||'',t.amount,'KRW']));
    const w1=X.utils.aoa_to_sheet(aoa);for(let r=1;r<aoa.length;r++){const c=w1[X.utils.encode_cell({r,c:0})];if(c){c.t='n';c.z='yyyy. mm. dd hh:mm:ss';}}
    w1['!cols']=[20,16,13,10,30,16,10,30,16,8].map(wch=>({wch}));
    X.utils.book_append_sheet(wb,w1,'내역');
    // 2. 월별 합계
    const mon={};list.forEach(t=>{const k=t.date.slice(0,7);const o=mon[k]=mon[k]||{i:0,e:0};if(t.type==='inc')o.i+=t.amount;else if(t.type==='exp')o.e+=t.amount;});
    const mrows=Object.keys(mon).sort().map(k=>({'월':k,'수입':mon[k].i,'지출':mon[k].e,'합계':mon[k].i-mon[k].e}));
    const tot=mrows.reduce((a,r)=>({i:a.i+r['수입'],e:a.e+r['지출']}),{i:0,e:0});mrows.push({'월':'합계','수입':tot.i,'지출':tot.e,'합계':tot.i-tot.e});
    const w2=money(X.utils.json_to_sheet(mrows));w2['!cols']=[{wch:10},{wch:14},{wch:14},{wch:14}];X.utils.book_append_sheet(wb,w2,'월별 합계');
    // 3. 분류별 지출 (연도별)
    const exps=list.filter(t=>t.type==='exp');const years=[...new Set(exps.map(t=>t.date.slice(0,4)))].sort();const by=Object.create(null);
    exps.forEach(t=>{const c=t.cat||'미분류';const y=t.date.slice(0,4);(by[c]=by[c]||{})[y]=(by[c][y]||0)+t.amount;});
    const crows=Object.keys(by).map(c=>{const r={'분류':c};let sum=0;years.forEach(y=>{r[y+'년']=by[c][y]||0;sum+=by[c][y]||0;});r['합계']=sum;return r;}).sort((a,b)=>b['합계']-a['합계']);
    if(crows.length){const tr={'분류':'합계'};years.forEach(y=>tr[y+'년']=crows.reduce((a,r)=>a+r[y+'년'],0));tr['합계']=crows.reduce((a,r)=>a+r['합계'],0);crows.push(tr);}
    const w3=money(X.utils.json_to_sheet(crows));w3['!cols']=[{wch:16}].concat(years.map(()=>({wch:13})),[{wch:14}]);X.utils.book_append_sheet(wb,w3,'분류별 지출');
    const name='티끌모아_'+stamp()+'.xlsx';X.writeFile(wb,name,{compression:true});toast('내역 '+list.length+'건을 엑셀로 저장했어요');
  }catch(e){toast(String(e&&e.message||'').startsWith('load')?'일부 달을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.':'엑셀 파일을 만들지 못했어요');}finally{S.exporting=false;}}

/* ---------- actions ---------- */
function readForm(){const f=S.form;if(!f)return;const g=id=>document.getElementById(id);
  if(g('f-amt'))f.amountStr=g('f-amt').value;if(g('f-date')&&okDate(g('f-date').value))f.date=g('f-date').value;if(g('f-acc'))f.acc=g('f-acc').value;
  if(g('f-to'))f.to=g('f-to').value;if(g('f-memo'))f.memo=g('f-memo').value;if(g('f-note'))f.note=g('f-note').value;if(g('f-fav'))f.fav=g('f-fav').checked;}
function readRec(){const r=S.recDraft;if(!r)return;const g=id=>document.getElementById(id);
  if(g('r-day'))r.day=+g('r-day').value;if(g('r-amt'))r.amount=calc(g('r-amt').value)||0;if(g('r-cat'))r.cat=g('r-cat').value;if(g('r-acc'))r.acc=g('r-acc').value;if(g('r-to'))r.to=g('r-to').value;if(g('r-memo'))r.memo=g('r-memo').value;if(g('r-now'))r.now=g('r-now').checked;}
function readAcc(){document.querySelectorAll('[data-acc]').forEach(el=>{const a=S.accDraft[+el.dataset.i];const k=el.dataset.acc;a[k]=k==='init'?(calc(el.value)||0):el.value;});}

const ACT={
 tab(el){if(S.tab===el.dataset.k){S.av=null;S.moreView='';}S.tab=el.dataset.k;S.overview=false;S.amenu=false;S.smOpen=false;try{localStorage.setItem('moneybook.tab',S.tab);}catch(e){}if(S.tab==='asset')ensureMonths(allMonths(),true);window.scrollTo(0,0);render();},
 prev(){S.label=shiftLabel(S.label,-1);S.selDay='';subscribePeriod();render();},
 next(){S.label=shiftLabel(S.label,1);S.selDay='';subscribePeriod();render();},
 add(){openTx(null);if(S.tab==='asset'&&S.av&&S.form){const a=S.settings.accounts.find(x=>x.id===S.av.id);if(a)S.form.acc=a.id;renderSheet();}},
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
 omonth(el){S.openMonth=(S.openMonth||curLabel())===el.dataset.k?'none':el.dataset.k;render();},
 async memoSave(){const t=document.getElementById('memo-text');if(!t||!S.memo)return;const v=t.value;try{await S.db.doc('memo/'+S.memo.ym).set({text:v,updated:Date.now()});S.memo.text=v;S.memo.saved=v;const st=document.getElementById('memo-st');if(st)st.textContent='저장됨';toast('메모를 저장했어요');}catch(e){toast(dbErr(e));}},
 favUse(el){const x=S.settings.favorites[+el.dataset.i];if(!x)return;openTx(null);Object.assign(S.form,{type:x.type,amountStr:String(x.amount),cat:x.cat||'',sub:x.sub||'',acc:x.acc||S.form.acc,to:x.to||'',memo:x.memo||''});renderSheet();},
 instHide(){try{localStorage.setItem('moneybook.instHide',today());}catch(e){}render();},
 async install(){if(deferredInstall){const e=deferredInstall;deferredInstall=null;try{e.prompt();await e.userChoice;}catch(x){}render();return;}openSheet('install');},
 async login(){if(!window.firebase)return;S.loginBusy=true;S.loginErr='';render();const p=new firebase.auth.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});
  try{await firebase.auth().signInWithPopup(p);}catch(e){if(['auth/popup-blocked','auth/operation-not-supported-in-this-environment','auth/cancelled-popup-request','auth/web-storage-unsupported'].includes(e.code)){try{await firebase.auth().signInWithRedirect(p);return;}catch(e2){e=e2;}}
    if(e.code!=='auth/popup-closed-by-user')S.loginErr=authErr(e);}S.loginBusy=false;render();},
 async pinForgot(){// 구글 계정으로 한 번 더 확인되면 잠금을 풀고 비밀번호를 지워요
  if(!S.user||!window.firebase)return;try{const pr=new firebase.auth.GoogleAuthProvider();pr.setCustomParameters({prompt:'select_account',login_hint:S.user.email||''});
   const r=await firebase.auth().currentUser.reauthenticateWithPopup(pr);if(!r||!r.user||r.user.uid!==S.user.uid)throw 0;
   pinFails(0);bioSet(null);await saveSettings({pin:null});S.locked=false;S.unlockedOnce=true;S.pinIn='';S.pinErr='';markActive();render();toast('잠금을 껐어요. 설정에서 새 비밀번호를 정해 주세요');}
  catch(e){const c=(e&&e.code)||'';if(c==='auth/popup-closed-by-user'||c==='auth/cancelled-popup-request')return;S.pinErr=c==='auth/user-mismatch'?'가계부 주인 계정으로 확인해야 해요':'구글 확인을 하지 못했어요';updLock();}},
 async logoutNow(){try{await firebase.auth().signOut();}catch(e){}try{await S.fs.terminate();await S.fs.clearPersistence();}catch(e){}
  try{Object.keys(localStorage).filter(k=>k.startsWith('moneybook.f.')||k==='moneybook.pinOn').forEach(k=>localStorage.removeItem(k));}catch(e){}location.reload();},
 logout(){if(!S.ghOffAsk){S.ghOffAsk=true;renderSheet();return;}S.ghOffAsk=false;ACT.logoutNow();},
 async bkFile(){toast('백업 파일을 만드는 중이에요');try{const snap=await fullSnapshot();const n=Object.values(snap.tx).reduce((a,l)=>a+l.length,0);
  const url=URL.createObjectURL(new Blob([JSON.stringify(snap)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='티끌모아_'+stamp()+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);toast('내역 '+n+'건을 백업 파일로 저장했어요');}catch(e){toast(String(e&&e.message||'').startsWith('load')?'일부 달을 불러오지 못해 백업을 멈췄어요. 인터넷 연결을 확인해 주세요.':'백업 파일을 만들지 못했어요');}},
 async bkRestore(){if(!S.bkData)return;if(!S.bkAsk){S.bkAsk=true;renderSheet();return;}S.bkAsk=false;toast('넣는 중이에요. 화면을 닫지 마세요');try{const p=await restoreSnapshot(S.bkData,(d,t)=>{S.bkInfo=`넣는 중… ${d} / ${t}`;if(S.sheet==='sync')renderSheet();});const n=p.add+p.same;S.bkData=null;S.bkInfo='';toast(`새로 ${p.add}건 추가, ${p.same}건 확인, 중복 ${p.dup}건 건너뜀`);closeSheet();ensureMonths(allMonths(),true);}catch(e){toast('되돌리지 못했어요');}},
 fTab(el){S.fTab=el.dataset.k;renderSheet();},
 fReset(){S.filter={inc:[],exp:[],acc:[]};render();if(S.sheet==='filter')renderSheet();},
 favEditT(){S.favEdit=!S.favEdit;renderSheet();},
 mpOpen(el){const k=el.dataset.k;if(k==='month')S.mp={mode:'month',y:+S.label.slice(0,4)};else{const y=k==='syear'?(S.spYear||+S.label.slice(0,4)):+S.label.slice(0,4);S.mp={mode:k,y0:y-6};}mpRender();},
 mpClose(){S.mp=null;mpRender();},
 mpY(el){const d=+el.dataset.k;if(S.mp.mode==='month')S.mp.y+=d;else S.mp.y0+=12*d;mpRender();},
 mpPick(el){S.mp=null;mpRender();goLabel(el.dataset.k);},
 mpPickY(el){const y=+el.dataset.k;const mode=S.mp.mode;S.mp=null;mpRender();if(mode==='syear'){S.spYear=y;S.statCat='';render();}else goLabel(y+'-'+S.label.slice(5,7));},
 mpNow(){const mode=S.mp.mode;S.mp=null;mpRender();if(mode==='syear'){S.spYear=+today().slice(0,4);render();}else if(mode==='year')goLabel(today().slice(0,4)+'-'+S.label.slice(5,7));else goLabel(curLabel());},
 avOpen(el){const id=el.dataset.k;S.av={id,tab:'d',label:curLabel(),year:+today().slice(0,4),chart:false};window.scrollTo(0,0);render();},
 avClose(){S.av=null;window.scrollTo(0,0);render();},
 avTab(el){S.av.tab=el.dataset.k;render();},
 avShift(el){const k=+el.dataset.k;if(S.av.tab==='d'){S.av.label=shiftLabel(S.av.label,k);S.av.year=+S.av.label.slice(0,4);}else S.av.year+=k;render();},
 avChart(){S.av.chart=!S.av.chart;render();},
 avGo(el){if(el.dataset.k){S.av.tab='d';S.av.label=el.dataset.k;}else if(el.dataset.y){S.av.tab='m';S.av.year=+el.dataset.y;}window.scrollTo(0,0);render();},
 avPay(){const a=S.settings.accounts.find(x=>x.id===S.av.id);if(!a)return;const bal=accBalances()[a.id]||0;const cy=cardCycles(a);
  const due=allMonths().flatMap(txOf).filter(t=>t.type==='exp'&&t.acc===a.id&&t.date>=cy.prev.start&&t.date<=cy.prev.end).reduce((x,t)=>x+t.amount,0);
  const amt=Math.max(0,Math.min(due||-bal,-bal));openTx({type:'trf',date:today(),amount:amt,cat:'',sub:'',acc:a.pay||'',to:a.id,memo:a.name+' 결제',note:'',time:''});if(!amt)S.form.amountStr='';},
 moreGo(el){S.moreView=el.dataset.k;window.scrollTo(0,0);render();},
 moreBack(){S.moreView='';window.scrollTo(0,0);render();},
 smOpen(){S.smOpen=!S.smOpen;render();},smClose(){S.smOpen=false;render();},
 smPick(el){S.smOpen=false;S.sp=el.dataset.k;S.statCat='';if(S.sp==='week')S.spWeek=today();if(S.sp==='year')S.spYear=+S.label.slice(0,4);if(S.sp==='range'){const p=period(S.label);S.rFrom=p.start;S.rTo=p.last;}render();},
 catsOf(el){ACT.open({dataset:{k:'cats'}});S.catType=el.dataset.k;renderSheet();},
 setToggle(el){const k=el.dataset.k;const st=S.settings;if(k==='subOn')saveSettings({subOn:st.subOn===false});else if(k==='firstSub')saveSettings({firstSub:st.firstSub==='cal'?'daily':'cal'});else if(k==='weekStart')saveSettings({weekStart:st.weekStart===1?0:1});},
 aRestore(el){const id=el.dataset.k;const d=(S.settings.deleted||[]).find(a=>a.id===id);if(!d)return;const a=Object.assign({},d);delete a.deletedAt;const list=S.settings.accounts.slice();let at=-1;list.forEach((x,i)=>{if(x.group===a.group)at=i;});if(at<0)list.push(a);else list.splice(at+1,0,a);
  saveSettings({accounts:list,deleted:S.settings.deleted.filter(x=>x.id!==id)});toast(a.name+' 되살렸어요');renderSheet();},
 perfSave(){const m={};document.querySelectorAll('[data-perf]').forEach(el=>m[el.dataset.perf]=calc(el.value.replace(/원/g,''))||0);saveSettings({accounts:S.settings.accounts.map(a=>m[a.id]!=null?Object.assign({},a,{perf:m[a.id]}):a)});toast('저장했어요');closeSheet();},
 amenu(){S.amenu=!S.amenu;render();},
 amenuClose(){S.amenu=false;render();},
 accNew(){S.amenu=false;S.accEd={id:'',name:'',group:'현금',init:0,hidden:false,cutDay:1,payDay:1};S.aeGP=false;render();openSheet('accEdit');setTimeout(()=>{const t=document.getElementById('ae-name');if(t)t.focus();},60);},
 accOpen(el){const a=S.settings.accounts.find(x=>x.id===el.dataset.k);if(!a)return;S.accEd=clone(a);S.aeGP=false;openSheet('accEdit');},
 aeRead(){const d=S.accEd;const g=id=>document.getElementById(id);if(!d)return;if(g('ae-name'))d.name=g('ae-name').value;
  if(g('ae-init')){const v=g('ae-init').value.trim();d.init=(calc(v.replace(/^-/,'').replace(/원/g,''))||0)*(v.startsWith('-')?-1:1);}
  for(const [k,id] of [['memo','ae-memo'],['phone','ae-phone'],['smsKey','ae-key'],['app','ae-app'],['pay','ae-pay']])if(g(id))d[k]=g(id).value;
  if(g('ae-cut'))d.cutDay=+g('ae-cut').value;if(g('ae-payday'))d.payDay=+g('ae-payday').value;},
 aeGroupOpen(){ACT.aeRead();S.aeGP=true;renderSheet();},
 aeGroupClose(){S.aeGP=false;renderSheet();},
 aeGroup(el){ACT.aeRead();S.accEd.group=el.dataset.k;S.aeGP=false;renderSheet();},
 aeSave(){ACT.aeRead();const d=S.accEd;const n=(d.name||'').trim().slice(0,30);
  if(!n){toast('이름을 적어주세요');return;}if(S.settings.accounts.some(a=>a.name===n&&a.id!==d.id)){toast('같은 이름의 자산이 있어요');return;}
  const body={name:n,group:d.group,init:d.group==='체크카드'?0:(Number(d.init)||0),memo:(d.memo||'').slice(0,200),phone:(d.phone||'').slice(0,40),smsKey:(d.smsKey||'').slice(0,60),app:(d.app||'').slice(0,40),pay:d.pay||'',cutDay:d.cutDay||1,payDay:d.payDay||1};
  let list=S.settings.accounts.slice();if(d.id){list=list.map(a=>a.id===d.id?Object.assign({},a,body):a);}else{const nw=Object.assign({id:newId(),hidden:false},body);let at=-1;list.forEach((a,i)=>{if(a.group===d.group)at=i;});if(at<0){const gi=GROUPS.indexOf(d.group);list.forEach((a,i)=>{if(GROUPS.indexOf(a.group)<gi)at=i;});}list.splice(at+1,0,nw);}
  saveSettings({accounts:list});toast(d.id?'저장했어요':'추가했어요');closeSheet();},
 aeHide(){const d=S.accEd;saveSettings({accounts:S.settings.accounts.map(a=>a.id===d.id?Object.assign({},a,{hidden:!a.hidden}):a)});toast(d.hidden?'다시 보이게 했어요':'숨겼어요');closeSheet();},
 aHide(el){const id=el.dataset.k;const vis=S.settings.accounts.filter(a=>!a.hidden);const a=S.settings.accounts.find(x=>x.id===id);if(!a)return;if(!a.hidden&&vis.length<=1){toast('하나는 보여야 해요');return;}
  saveSettings({accounts:S.settings.accounts.map(x=>x.id===id?Object.assign({},x,{hidden:!x.hidden}):x)});renderSheet();},
 aDel(el){S.accDelAsk=S.accDelAsk===el.dataset.k?'':el.dataset.k;ensureMonths(allMonths()).then(()=>{if(S.sheet==='accDel')renderSheet();});renderSheet();},
 aDelOk(el){const id=el.dataset.k;if(S.settings.accounts.length<=1){toast('자산은 하나 이상 있어야 해요');return;}S.accDelAsk='';const del=S.settings.accounts.find(a=>a.id===id);saveSettings({accounts:S.settings.accounts.filter(a=>a.id!==id),deleted:(S.settings.deleted||[]).concat(Object.assign({},del,{deletedAt:Date.now()}))});toast('삭제했어요. 설정관리 › 삭제된 자산에서 되살릴 수 있어요');renderSheet();},
 aSel(el){S.accSel=S.accSel===el.dataset.k?'':el.dataset.k;renderSheet();},
 aMove(el){const id=S.accSel;if(!id)return;const d=+el.dataset.k;const l=S.settings.accounts.slice();const i=l.findIndex(a=>a.id===id);if(i<0)return;const g=l[i].group;let j=i+d;while(j>=0&&j<l.length&&l[j].group!==g)j+=d;if(j<0||j>=l.length)return;[l[i],l[j]]=[l[j],l[i]];saveSettings({accounts:l});renderSheet();const b=document.querySelector('.ali.sel');if(b)b.scrollIntoView({block:'nearest'});},
 ovw(el){S.overview=el.dataset.k==='1';S.av=null;window.scrollTo(0,0);render();},
 sprev(){ACT._sshift(-1);}, snext(){ACT._sshift(1);},
 _sshift(k){S.statCat='';if(S.sp==='month'){S.label=shiftLabel(S.label,k);subscribePeriod();}
  else if(S.sp==='week')S.spWeek=addDays(statPeriod().start,7*k);else if(S.sp==='year')S.spYear=(S.spYear||+S.label.slice(0,4))+k;render();},
 scat(el){S.statCat=S.statCat===el.dataset.k?'':el.dataset.k;render();},
 subToggle(el){saveSettings({subOn:el.checked});renderSheet();},
 catEdit(el){const i=+el.dataset.i;S.catEdit=S.catEdit===i?-1:i;S.catDelAsk=-1;renderSheet();},
 catRename(el){const i=+el.dataset.i;const t=S.catType;const old=S.settings.cats[t][i];const v=(document.getElementById('c-name').value||'').trim().slice(0,20);
  if(!v||v===old)return;if(BADK.has(v)){toast('쓸 수 없는 이름이에요');return;}if(S.settings.cats[t].includes(v)){toast('이미 있는 분류예요');return;}
  const l=S.settings.cats[t].slice();l[i]=v;const subsT=Object.assign({},(S.settings.subs||{})[t]||{});if(subsT[old]){subsT[v]=subsT[old];delete subsT[old];}
  const bud=clone(S.settings.budget||{total:0,cats:{}});if(t==='exp'&&bud.cats&&bud.cats[old]!=null){bud.cats[v]=bud.cats[old];delete bud.cats[old];}
  saveSettings({cats:Object.assign({},S.settings.cats,{[t]:l}),subs:Object.assign({},S.settings.subs||{},{[t]:subsT}),budget:bud});toast('이름을 바꿨어요');renderSheet();},
 subAdd(el){const t=S.catType;const cat=S.settings.cats[t][+el.dataset.i];const inp=document.getElementById('s-new');const v=(inp.value||'').trim().slice(0,20);if(!v)return;if(BADK.has(v)){toast('쓸 수 없는 이름이에요');return;}
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
  const t={type:f.type,date:f.date,amount,cat:f.type==='trf'?'':f.cat,sub:f.type==='trf'?'':(f.sub||''),acc:f.acc,to:f.type==='trf'?f.to:'',memo:f.memo.trim(),note:(f.note||'').trim(),time:f.time||'',created:f.created,auto:f.auto};
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
  if(k==='search'){S.search='';ensureMonths(allMonths(),true).then(updateSearch);}
  if(k==='budget')S.budDraft={total:(S.settings.budget||{}).total||0,cats:Object.assign({},(S.settings.budget||{}).cats||{})};
  if(k==='pin'&&S.bioOk==null)bioAvail().then(ok=>{S.bioOk=ok;if(S.sheet==='pin')renderSheet();});
  if(k==='accounts')S.accDraft=clone(S.settings.accounts);
  if(k==='accHide'||k==='accDel'||k==='accOrder'){S.amenu=false;S.accDelAsk='';S.accSel='';render();}
  if(k==='recurring')S.recDraft={type:'exp',day:new Date().getDate(),amount:0,cat:'',acc:lastAcc(),to:'',memo:'',now:false};
  if(k==='pin')S.pinDraft=null;
  if(k==='sync'){S.ghOffAsk=false;S.bkInfo='';S.bkData=null;S.bkAsk=false;}
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
 catAdd(){const el=document.getElementById('c-new');const v=(el.value||'').trim();const t=S.catType;if(!v)return;if(BADK.has(v)){toast('쓸 수 없는 이름이에요');return;}if(S.settings.cats[t].includes(v)){toast('이미 있는 분류예요');return;}
  saveSettings({cats:Object.assign({},S.settings.cats,{[t]:S.settings.cats[t].concat(v.slice(0,20))})});renderSheet();},
 accAdd(){readAcc();S.accDraft.push({id:newId(),name:'',group:'카드',init:0});renderSheet();const els=document.querySelectorAll('[data-acc="name"]');if(els.length)els[els.length-1].focus();},
 accDel(el){readAcc();if(S.accDraft.length<=1){toast('자산은 하나 이상 있어야 해요');return;}S.accDraft.splice(+el.dataset.i,1);renderSheet();},
 saveAcc(){readAcc();const list=S.accDraft.filter(a=>a.name.trim()).map(a=>({id:a.id||newId(),name:a.name.trim().slice(0,30),group:a.group||'기타',init:Number(a.init)||0,hidden:!!a.hidden}));
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
 bioUnlock(){bioUnlock(false);},
 async bioOn(){if(!(await bioAvail())){S.bioOk=false;renderSheet();toast('이 기기에서는 지문·얼굴 확인을 쓸 수 없어요');return;}
  try{await bioRegister();toast('지문·얼굴로 열기를 켰어요');}catch(e){toast(e&&e.name==='NotAllowedError'?'취소했어요':'켜지 못했어요 ('+((e&&e.name)||'오류')+')');}renderSheet();},
 bioOff(){bioSet(null);toast('지문·얼굴로 열기를 껐어요');renderSheet();},
 pinOff(){bioSet(null);saveSettings({pin:null});toast('잠금을 껐어요');renderSheet();},
 async pinKey(el){const k=el.dataset.k;
  if(lockOn()){const wait=lockWait();if(wait){S.pinIn='';S.pinErr=`여러 번 틀렸어요. ${wait}초 뒤에 다시 입력하세요`;updLock();return;}if(k==='back'){S.pinIn=S.pinIn.slice(0,-1);S.pinErr='';updLock();return;}if(S.pinIn.length>=4)return;S.pinIn+=k;S.pinErr='';updLock();
    if(S.pinIn.length===4){if(!S.settings.pin){S.pinIn='';S.pinErr='잠금 정보를 불러오는 중이에요. 잠시 뒤 다시 눌러주세요';updLock();return;}const h=await hashPin(S.pinIn,S.settings.pin.salt);if(h===S.settings.pin.hash){pinFails(0);S.locked=false;S.unlockedOnce=true;S.pinIn='';markActive();render();}else{const n=pinFails(1);S.pinIn='';S.pinErr=n>=5?`5번 틀렸어요. ${lockWait()}초 뒤에 다시 입력하세요`:`비밀번호가 달라요 (${n}/5)`;updLock();}}return;}
  const d=S.pinDraft;if(!d)return;if(k==='back'){d.cur=d.cur.slice(0,-1);d.err='';updDraft();return;}if(d.cur.length>=4)return;d.cur+=k;d.err='';updDraft();
  if(d.cur.length===4){if(d.step===1){d.first=d.cur;d.cur='';d.step=2;setTimeout(renderSheet,150);}
    else if(d.cur===d.first){const salt=newId();const hash=await hashPin(d.cur,salt);saveSettings({pin:{salt,hash}});S.unlockedOnce=true;markActive();S.pinDraft=null;toast('비밀번호를 설정했어요');closeSheet();}
    else{S.pinDraft={step:1,first:'',cur:'',err:'두 번 입력한 번호가 달라요. 처음부터 다시 입력하세요.'};renderSheet();}}}
};
const FAST=new Set(['pinKey','kp']);
// 숫자 키는 닿는 순간 입력돼요. 그 손가락을 뗄 때 생기는 클릭이 다른 버튼에 떨어지지 않게 잠깐 막아요
let ghostUntil=0;document.addEventListener('click',e=>{if(Date.now()<ghostUntil&&!(e.target.closest&&e.target.closest('[data-act]')&&FAST.has(e.target.closest('[data-act]').dataset.act))){e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('pointerdown',e=>{if(e.button>0)return;const el=e.target.closest('[data-act]');if(!el||!FAST.has(el.dataset.act))return;e.preventDefault();ghostUntil=Date.now()+350;
  el.classList.add('press');setTimeout(()=>el.classList.remove('press'),130);try{navigator.vibrate&&navigator.vibrate(8);}catch(x){}ACT[el.dataset.act](el,e);});
document.addEventListener('click',e=>{const el=e.target.closest('[data-act]');if(!el)return;if(FAST.has(el.dataset.act))return;if(el.tagName==='INPUT'&&el.type==='checkbox'&&e.type==='click'){ACT[el.dataset.act]&&ACT[el.dataset.act](el,e);return;}const f=ACT[el.dataset.act];if(f)f(el,e);});
document.addEventListener('input',e=>{const t=e.target;
  if(t.id==='f-amt'&&S.form){S.form.amountStr=t.value;const v=calc(t.value);const c=document.getElementById('f-calc');if(c)c.textContent=/[+\-*/×÷−]/.test(t.value.replace(/^-/,''))&&!isNaN(v)?'= '+won(v)+'원':'';}
  if(t.id==='q'){S.search=t.value;clearTimeout(ACT._qt);ACT._qt=setTimeout(updateSearch,200);}
  if(t.id==='sms-text'&&S.sms)S.sms.text=t.value;
  if(t.id==='memo-text'&&S.memo){S.memo.text=t.value;const st=document.getElementById('memo-st');if(st)st.textContent=t.value===S.memo.saved?'저장됨':'저장 안 됨';}});
document.addEventListener('compositionend',e=>{if(e.target&&e.target.id==='q'){S.search=e.target.value;clearTimeout(ACT._qt);ACT._qt=setTimeout(updateSearch,50);}});
document.addEventListener('change',e=>{const t=e.target;
  if(t.dataset&&t.dataset.fg){const g=t.dataset.fg;const tab=S.fTab;const F=Object.assign({},S.filter);
    if(g==='all'){const keys=tab==='acc'?S.settings.accounts.map(a=>a.id):(S.settings.cats[tab]||[]);F[tab]=t.checked?keys.slice():[];}
    else{const set=new Set(F[g]);if(t.checked)set.add(t.value);else set.delete(t.value);F[g]=[...set];}
    S.filter=F;render();return;}
  if(t.id==='f-date'&&S.form){readForm();S.form.date=okDate(t.value)?t.value:S.form.date;renderSheet();return;}
  if(t.id==='bk-in'&&t.files&&t.files[0]){const fr=new FileReader();fr.onload=async()=>{let j;try{j=JSON.parse(fr.result);if(!j||typeof j!=='object'||(j.app!=='moneybook'&&!j.tx))throw 0;j=cleanSnap(j);}catch(e){S.bkData=null;S.bkInfo='티끌모아 백업 파일이 아니에요.';renderSheet();return;}
      S.bkData=null;S.bkInfo='지금 장부와 비교하는 중…';renderSheet();
      try{const plan=await analyzeSnapshot(j);j._plan=plan;S.bkData=j;const n=Object.values(j.tx||{}).reduce((a,l)=>a+l.length,0);
        S.bkInfo=`${j.merge?(j.source||'가져오기')+' 파일':String(j.at||'').slice(0,10)+' 백업'} · 내역 ${n}건\n새로 추가 ${plan.add}건 · 이미 있음 ${plan.same}건(그대로 하나만 남음) · 중복이라 건너뜀 ${plan.dup}건\n${j.merge?'계좌·분류는 지금 것과 합쳐요.':'설정은 백업 때 것으로 돌아가고, 그 뒤에 만든 계좌·분류는 그대로 남아요.'} 백업 뒤에 새로 적은 내역은 지워지지 않아요.${j.bad?`\n형식이 맞지 않는 ${j.bad}건은 빼고 넣어요.`:''}`;}
      catch(e){S.bkData=null;S.bkInfo='비교하지 못했어요. 인터넷 연결을 확인해 주세요.';}S.bkAsk=false;renderSheet();};fr.readAsText(t.files[0]);t.value='';return;}
  if(t.id==='lockMin'){saveSettings({lockMin:+t.value});return;}
  if(t.id==='smode'){S.sp=t.value;S.statCat='';if(S.sp==='week')S.spWeek=today();if(S.sp==='year')S.spYear=+S.label.slice(0,4);if(S.sp==='range'){const p=period(S.label);S.rFrom=p.start;S.rTo=p.last;}render();return;}
  if(t.id==='sp-from'||t.id==='sp-to'){if(t.value){if(t.id==='sp-from')S.rFrom=t.value;else S.rTo=t.value;}render();return;}if(t.dataset.sms&&S.sms){S.sms.items[+t.dataset.i][t.dataset.sms]=t.value;}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&S.mp){ACT.mpClose();return;}if(S.sheet==='tx'&&S.form&&(S.form.panel==='amt'||S.form.panel==='fee')&&!/INPUT|TEXTAREA/.test((e.target||{}).tagName||'')){const m={'Backspace':'back','Enter':'done','+':'+','-':'−','*':'×','/':'÷'};const k=/^[0-9]$/.test(e.key)?e.key:m[e.key];if(k){e.preventDefault();ACT.kp({dataset:{k}});return;}}if(S.locked&&S.settings.pin&&/^[0-9]$|^Backspace$/.test(e.key)){ACT.pinKey({dataset:{k:e.key==='Backspace'?'back':e.key}});return;}if(e.key==='Escape'&&S.sheet)closeSheet();if(e.key==='Enter'&&e.target.id==='c-new'){e.preventDefault();ACT.catAdd();}});

document.addEventListener('touchmove',e=>{if(lockOn())e.preventDefault();},{passive:false});
// 새 판이 올라오면 저절로 바꿔요: 앱을 다시 볼 때·30분마다 확인하고, 입력 창이 열려 있지 않을 때만 새로 불러요
let updAt=0;async function checkUpdate(){if(Date.now()-updAt<60000||!navigator.onLine)return;updAt=Date.now();
  try{const t=await fetch('./sw.js?t='+Date.now(),{cache:'no-store'}).then(r=>r.ok?r.text():'');const m=t.match(/moneybook-v(\d+)/);
    if(m&&+m[1]>APP_VERSION&&!S.sheet){try{if(sessionStorage.getItem('moneybook.updTo')===m[1])return;sessionStorage.setItem('moneybook.updTo',m[1]);}catch(e){}try{const r=await navigator.serviceWorker.getRegistration();if(r)await r.update();}catch(e){}if(!lockOn())markActive();location.reload();}}catch(e){}}
setInterval(checkUpdate,30*60000);
document.addEventListener('visibilitychange',()=>{if(document.hidden){S.hiddenAt=Date.now();if(S.settings.pin)document.documentElement.classList.add('veil');if(!lockOn())markActive();return;}
  document.documentElement.classList.remove('veil');checkUpdate();if(lockOn()&&bioGet()&&document.getElementById('lockDots'))setTimeout(()=>bioUnlock(true),300);
  if(S.settings.pin&&!S.locked&&S.hiddenAt&&Date.now()-S.hiddenAt>=(S.settings.lockMin??1)*60000){S.locked=true;S.pinIn='';S.pinErr='';closeSheet();render();}});
/* ---------- boot ---------- */
S.label=curLabel();render();
const isPC=()=>!/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)&&!(navigator.maxTouchPoints>1&&/Mac/.test(navigator.platform));
function instBanner(){if(isStandalone())return '';try{if(localStorage.getItem('moneybook.instHide')===today())return '';}catch(e){}
  return `<div class="ibar"><img src="logo-mark.svg" alt="" width="40" height="40"><div><b>티끌모아 앱 설치</b><span>${isPC()?'PC 바탕화면·작업표시줄에서':'홈 화면 아이콘으로'} 바로 열려요</span></div><button class="btn pri" data-act="install">설치</button><button class="x" data-act="instHide" aria-label="오늘 그만 보기">×</button></div>`;}
const GICON='<svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function setupHtml(){if(S.fbMissing)return `<div class="notice"><b>로그인 도구를 불러오지 못했어요.</b><br>인터넷 연결을 확인한 뒤 다시 열어주세요.</div>`;
  return instBanner()+`<div class="setup-logo"><img src="logo.png" alt="티끌모아"></div><div class="card setup"><h3>구글로 로그인</h3>
  <p class="muted">로그인하면 휴대폰과 PC 어디서든 같은 가계부를 써요. 기기마다 처음 한 번만 하면 돼요.</p>
  <button class="btn gbtn wide2" data-act="login" ${S.loginBusy?'disabled':''}>${GICON}<span>${S.loginBusy?'로그인 중…':'구글 계정으로 로그인'}</span></button>
  <div class="err">${esc(S.loginErr||'')}</div></div>`+footHtml();}
function deniedHtml(){return `<div class="card setup"><h3>들어올 수 없는 계정이에요</h3><p class="muted"><b>${esc((S.user&&S.user.email)||'')}</b> 계정은 이 가계부에 허용되지 않았어요. 가계부 주인 계정으로 다시 로그인해 주세요.</p>
  <button class="btn pri wide2" data-act="logoutNow">다른 계정으로 로그인</button></div>`;}
async function fullSnapshot(){const ms=allMonths();await needAll();const snap={app:'moneybook',v:1,at:new Date().toISOString(),settings:S.settings,tx:{},memo:[]};
  ms.forEach(ym=>{snap.tx[ym]=txOf(ym);});try{const m=await S.db.collection('memo').get();snap.memo=m.docs.map(x=>Object.assign({ym:x.id},x.data()));}catch(e){}return snap;}
// 파일 내역과 지금 장부를 비교: 같은 번호는 '이미 있음'(덮어써도 하나), 번호는 다르지만 날짜·금액·자산·내용이 같으면 '중복'으로 건너뜀
const txKey=t=>[t.type,t.date,t.amount,t.acc||'',t.to||'',(t.memo||'').trim()].join('|');
// 백업 파일 검사: 형식이 틀린 내역은 빼고, 날짜와 달이 맞는 것만 남겨요
function cleanSnap(j){const tx={};let bad=0;const src=(j.tx&&typeof j.tx==='object')?j.tx:{};
  for(const ym of Object.keys(src)){if(!okYm(ym)||!Array.isArray(src[ym])){bad++;continue;}for(const t of src[ym]){const n=normTx(t,ym);if(n)(tx[ym]=tx[ym]||[]).push(n);else bad++;}}
  const memo=(Array.isArray(j.memo)?j.memo:[]).filter(m=>m&&okYm(m.ym)).map(m=>({ym:m.ym,text:str(m.text,5000),updated:Number(m.updated)||Date.now()}));
  const out={app:'moneybook',at:str(j.at,40),merge:j.merge?{accounts:(Array.isArray(j.merge.accounts)?j.merge.accounts:[]),cats:j.merge.cats||{}}:null,source:str(j.source,30),tx,memo,bad};
  if(j.settings&&typeof j.settings==='object')out.settings=j.settings;if(out.merge)out.merge.accounts=normalizeSettings({accounts:out.merge.accounts}).accounts.filter(a=>out.merge.accounts.some(x=>x&&x.id===a.id));
  return out;}
async function analyzeSnapshot(snap){await needAll();const fileIds=new Set();Object.values(snap.tx||{}).forEach(l=>l.forEach(t=>fileIds.add(t.id)));
  const curIds=new Set();const curUpd={};const cnt=Object.create(null);for(const ym of allMonths())for(const t of txOf(ym)){curIds.add(t.id);curUpd[t.id]=Number(t.updated)||0;if(!fileIds.has(t.id)){const k=txKey(t);cnt[k]=(cnt[k]||0)+1;}}
  const write={};let add=0,same=0,dup=0;
  for(const ym in (snap.tx||{}))for(const t of snap.tx[ym]){if(curIds.has(t.id)){same++;if(curUpd[t.id]<=(Number(t.updated)||0))(write[ym]=write[ym]||[]).push(t);continue;}
    const k=txKey(t);if(cnt[k]>0){cnt[k]--;dup++;continue;}add++;(write[ym]=write[ym]||[]).push(t);}
  return {add,same,dup,write};}
async function restoreSnapshot(snap,onProg){const fs=S.fs;const base='books/'+BOOK+'/';const plan=snap._plan||await analyzeSnapshot(snap);snap=Object.assign({},snap,{tx:plan.write});
  // 설정: 합치기 모드면 계좌·분류·월 목록을 지금 설정과 합치고, 아니면 파일 설정으로 바꿔요
  let st=snap.settings||null;
  if(snap.merge){const cur=clone(S.settings);const used=new Set();Object.values(snap.tx||{}).forEach(l=>l.forEach(t=>{used.add(t.acc);if(t.to)used.add(t.to);}));
    const hasOld=Object.keys(cur.months||{}).length>0;
    let accs=(cur.accounts||[]).filter(a=>hasOld||used.has(a.id)||!['bank','card'].includes(a.id));
    for(const a of (snap.merge.accounts||[]))if(!accs.some(x=>x.id===a.id))accs.push(a);
    const cats=clone(cur.cats||DEFAULTS.cats);for(const ty of ['exp','inc'])for(const c of ((snap.merge.cats||{})[ty]||[]))if(!cats[ty].includes(c))cats[ty].push(c);
    const months=Object.assign({},cur.months||{});Object.keys(snap.tx||{}).forEach(ym=>months[ym]=true);
    st=Object.assign(cur,{accounts:accs,cats,months});}
  else if(st){const cur=clone(S.settings);const accs=(st.accounts||[]).slice();for(const a of (cur.accounts||[]))if(!accs.some(x=>x.id===a.id))accs.push(a);
    const cats=clone(st.cats||DEFAULTS.cats);for(const ty of ['exp','inc'])for(const c of ((cur.cats||{})[ty]||[]))if(!cats[ty].includes(c))cats[ty].push(c);
    st=Object.assign({},st,{accounts:accs,cats,months:Object.assign({},cur.months||{},st.months||{},Object.fromEntries(Object.keys(snap.tx||{}).map(ym=>[ym,true])))});}
  if(st){st=normalizeSettings(clone(st));st.pin=S.settings.pin||null;st.lockMin=S.settings.lockMin??1;}
  const ops=[];if(st)ops.push([fs.doc(base+'ledger/settings'),JSON.parse(JSON.stringify(st))]);
  for(const ym in (snap.tx||{}))for(const t of snap.tx[ym]){const b=Object.assign({},t);delete b.id;ops.push([fs.collection(base+'tx_'+ym).doc(t.id),JSON.parse(JSON.stringify(b))]);}
  for(const m of (snap.memo||[])){const b=Object.assign({},m);delete b.ym;ops.push([fs.doc(base+'memo/'+m.ym),b]);}
  let done=0;for(let i=0;i<ops.length;i+=400){const bt=fs.batch();ops.slice(i,i+400).forEach(([r,d])=>bt.set(r,d));await bt.commit();done=Math.min(ops.length,i+400);if(onProg)onProg(done,ops.length);}
  return plan;}
function startDb(){S.needSetup=false;S.db=makeFbDb(S.fs);let firstMs=null;
  S.db.doc('ledger/settings').onSnapshot(snap=>{const d=snap.exists?snap.data():{};S.settings=normalizeSettings(clone(d));GH.denied=false;
    if(firstMs===null){firstMs=S.settings.monthStart;S.label=curLabel();subscribePeriod();if(S.freshOpen&&S.tab==='list')S.sub=S.settings.firstSub==='cal'?'cal':'daily';}
    else if(firstMs!==S.settings.monthStart){firstMs=S.settings.monthStart;subscribePeriod();}
    try{if(S.settings.pin)localStorage.setItem('moneybook.pinOn','1');else localStorage.removeItem('moneybook.pinOn');localStorage.setItem('moneybook.lockMin',String(S.settings.lockMin??1));}catch(e){}
    if(!S.settings.pin&&S.pinPending){S.locked=false;}S.pinPending=false;
    if(!S.settingsReady&&S.settings.pin&&!S.unlockedOnce)S.locked=true;
    S.settingsReady=true;if(!snap.metadata.fromCache)applyRecurring();render();},()=>render());
  render();}
function startAuth(){if(!window.firebase||!firebase.initializeApp){S.fbMissing=true;S.needSetup=true;render();return;}
  firebase.initializeApp(FB_CONFIG);const fs=firebase.firestore();try{fs.enablePersistence({synchronizeTabs:true}).catch(()=>{});}catch(e){}S.fs=fs;
  firebase.auth().getRedirectResult().catch(e=>{S.loginErr=authErr(e);render();});
  firebase.auth().onAuthStateChanged(u=>{S.user=u;S.loginBusy=false;if(u){if(!S.db)startDb();}else{S.needSetup=true;}render();});}
(function boot(){if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});
  const fresh=recentlyActive();if(fresh)S.unlockedOnce=true;
  try{if(localStorage.getItem('moneybook.pinOn')==='1'&&!fresh){S.locked=true;S.pinPending=true;}}catch(e){}
  render();startAuth();setTimeout(checkUpdate,8000);
})();
})();
