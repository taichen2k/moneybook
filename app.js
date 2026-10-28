(function(){
"use strict";
const COLORS=['#e4572e','#f0a202','#2a9d6f','#2e86ab','#a23b72','#6c5ce7','#d0813c','#5b8c2a','#c44569','#3d6fa5','#8d99ae','#b08968','#17a2b8','#9c6644'];
const FREQ={daily:'매일',weekday:'주중',weekend:'주말',weekly:'매주',w2:'2주마다',w4:'4주마다',monthly:'매월',monthEnd:'월말',m2:'2개월마다',m3:'3개월마다',m4:'4개월마다',m6:'6개월마다',yearly:'매년'};
const CORE_G=['현금','은행','카드','체크카드'];
const GROUPS=['현금','은행','카드','체크카드','선불식카드','저축','투자','마이너스 통장','대출','보험','기타'];
const DEFAULTS={v:1,monthStart:1,
  cats:{exp:['식비/생활용품','교통/차량','패션/미용/문화','주거/통신','건강','교육','경조사/회비','부모님','기타','보험','저축'],
        inc:['월급','부수입','용돈','상여','금융소득','기타']},
  subOn:true,
  subs:{exp:{'식비/생활용품':['식료품','간식','외식','음료'],'교통/차량':['대중교통','택시','주유','정비','렌트'],'패션/미용/문화':['의류','패션잡화','헤어/뷰티','세탁비'],
    '주거/통신':['관리비','공과금','통신비','월세'],'건강':['운동','다이어트','병원','약국'],'교육':['학비','학원비','교재비','육아'],'경조사/회비':['경조사비','회비','선물']},inc:{}},
  accounts:[{id:'cash',name:'현금',group:'현금',init:0},{id:'bank',name:'주거래 통장',group:'은행',init:0},{id:'card',name:'신용카드',group:'카드',init:0}],
  budget:{total:0,cats:{}},favorites:[],recurring:[],months:{},pin:null,lockMin:0};
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
/* ---------- 지문·패턴 잠금 해제 (휴대폰의 화면 잠금 인증 = 패스키 방식) ----------
   지문·패턴 정보는 휴대폰 밖으로 나가지 않아요. 이 기기에 '열쇠'를 하나 만들어 두고, 열 때 휴대폰이 지문·패턴로 본인 확인을 해 줘요. */
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
  const ad=new Uint8Array(a.response.authenticatorData);if(!(ad[32]&0x04))throw new Error('uv');// 지문·패턴(화면잠금)으로 본인 확인이 됐는지
  return true;}
async function bioUnlock(auto){if(S.bioBusy||!lockOn()||!bioGet())return;S.bioBusy=true;
  try{await bioVerify();pinFails(0);S.locked=false;S.unlockedOnce=true;S.pinIn='';S.pinErr='';markActive();render();}
  catch(e){const n=e&&e.name;// 사용자가 취소하거나 시간이 지나면(NotAllowedError) 조용히 비밀번호 화면으로
    if(!auto&&n!=='NotAllowedError'&&n!=='AbortError'){S.pinErr='지문 확인을 하지 못했어요. 다른 방법으로 열어 주세요.';updLock();}}
  finally{S.bioBusy=false;}}
/* ---------- 앱 패턴 잠금: 3×3 점을 이어 그려서 열어요 (휴대폰 패턴과 따로, 티끌모아 전용) ---------- */
function patPadHtml(mode){return `<div class="patpad" data-pat="${mode}"><svg class="patsvg" viewBox="0 0 300 300"><polyline points="" /></svg><div class="pd">${[0,1,2,3,4,5,6,7,8].map(i=>`<i data-i="${i}"></i>`).join('')}</div></div>`;}
let PT=null;
function patHit(e){const pad=PT.pad;const dots=[...pad.querySelectorAll('.pd i')];const pr=pad.getBoundingClientRect();
  for(const d of dots){const r=d.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;const i=+d.dataset.i;
    if(Math.hypot(e.clientX-cx,e.clientY-cy)<pr.width*0.12&&!PT.seq.includes(i)){const l=PT.seq[PT.seq.length-1];
      if(l!=null){const a=[Math.floor(l/3),l%3],b=[Math.floor(i/3),i%3];if((a[0]+b[0])%2===0&&(a[1]+b[1])%2===0){const m=((a[0]+b[0])/2)*3+(a[1]+b[1])/2;if(!PT.seq.includes(m))PT.seq.push(m);}}
      PT.seq.push(i);try{navigator.vibrate&&navigator.vibrate(6);}catch(x){}}}
  const pt=i=>{const d=dots[i].getBoundingClientRect();return [((d.left+d.width/2-pr.left)/pr.width*300).toFixed(1),((d.top+d.height/2-pr.top)/pr.height*300).toFixed(1)];};
  const pts=PT.seq.map(i=>pt(i).join(','));if(PT.seq.length&&e.type!=='pointerup')pts.push(((e.clientX-pr.left)/pr.width*300).toFixed(1)+','+((e.clientY-pr.top)/pr.height*300).toFixed(1));
  pad.querySelector('polyline').setAttribute('points',pts.join(' '));dots.forEach(d=>d.classList.toggle('on',PT.seq.includes(+d.dataset.i)));}
document.addEventListener('pointerdown',e=>{const pad=e.target.closest&&e.target.closest('.patpad');if(!pad)return;e.preventDefault();pad.classList.remove('bad');PT={pad,seq:[]};try{pad.setPointerCapture(e.pointerId);}catch(x){}patHit(e);},{passive:false});
document.addEventListener('pointermove',e=>{if(PT){e.preventDefault();patHit(e);}},{passive:false});
const patEnd=e=>{if(!PT)return;const {pad,seq}=PT;patHit(Object.assign({},{clientX:e.clientX,clientY:e.clientY,type:'pointerup'}));PT=null;patDone(pad,seq);};
document.addEventListener('pointerup',patEnd);document.addEventListener('pointercancel',patEnd);
function patClear(pad,bad){if(bad)pad.classList.add('bad');setTimeout(()=>{if(!pad.isConnected)return;pad.classList.remove('bad');pad.querySelector('polyline').setAttribute('points','');pad.querySelectorAll('.pd i').forEach(d=>d.classList.remove('on'));},bad?600:150);}
async function patDone(pad,seq){const mode=pad.dataset.pat;if(!seq.length)return;
  if(seq.length<4){patClear(pad,true);if(mode==='lock'){S.pinErr='점을 4개 이상 이어 주세요.';updLock();}else{S.patDraft.err='점을 4개 이상 이어 주세요.';renderSheet();}return;}
  if(mode==='lock'&&!(S.settings.pat&&S.settings.pat.salt)){S.pinErr='잠금 정보를 불러오는 중이에요. 잠시 뒤 다시 그려 주세요.';updLock();patClear(pad,true);return;}
  if(mode==='lock'){const wait=lockWait();if(wait){S.pinErr=`여러 번 틀렸어요. ${wait}초 뒤에 다시 그려 주세요.`;updLock();patClear(pad,true);return;}
    const p=S.settings.pat;const h=await hashPin(seq.join('-'),p.salt);if(h===p.hash){pinFails(0);ghostUntil=Date.now()+350;S.locked=false;S.unlockedOnce=true;S.pinIn='';S.pinErr='';markActive();render();}
    else{const n=pinFails(1);S.pinErr=n>=5?`5번 틀렸어요. ${lockWait()}초 뒤에 다시 그려 주세요.`:`패턴이 달라요. (${n}/5)`;updLock();patClear(pad,true);}return;}
  const d=S.patDraft;if(d.step===1){d.first=seq.join('-');d.step=2;d.err='';renderSheet();return;}
  if(seq.join('-')!==d.first){d.step=1;d.first='';d.err='처음 그린 패턴과 달라요. 다시 그려 주세요.';renderSheet();return;}
  const salt=newId();const hash=await hashPin(d.first,salt);saveSettings({pat:{salt,hash}});S.patDraft=null;toast('패턴을 설정했어요');renderSheet();}
function padHtml(){return `<div class="pad">${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-act="pinKey" data-k="${n}">${n}</button>`).join('')}<span></span><button data-act="pinKey" data-k="0">0</button><button data-act="pinKey" data-k="back" aria-label="지우기">⌫</button></div>`;}
function dotsHtml(n,bad){return `<div class="pdots ${bad?'bad':''}">${[0,1,2,3].map(i=>`<i class="${i<n?'on':''}"></i>`).join('')}</div>`;}
function updDraft(){const d=S.pinDraft;const box=document.querySelector('.pinbox .pdots');if(!d||!box){renderSheet();return;}box.outerHTML=dotsHtml(d.cur.length,!!d.err);const e=document.querySelector('.pin-e');if(e)e.textContent=d.err||'';}
const lockOn=()=>!!(S.locked&&(S.settings.pin||S.pinPending));
function markActive(){try{sessionStorage.setItem('moneybook.activeAt',String(Date.now()));}catch(e){}}
function recentlyActive(){try{const a=+sessionStorage.getItem('moneybook.activeAt')||0;const lm=+(localStorage.getItem('moneybook.lockMin')??0);return a&&Date.now()-a<Math.max(lm*60000,15000);}catch(e){return false;}}
// 내용이 같으면 다시 그리지 않아요 (누르는 도중 버튼이 바뀌어 터치가 씹히는 문제 방지)
function setHtml(el,h){if(el._h!==h){el.innerHTML=h;el._h=h;}if(el.id==='top')el.hidden=!h;}
const FPI='<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 11v3.5c0 2-.6 3.8-1.6 5.3M8.5 7.6A5 5 0 0 1 17 11v2.5M7 11a5 5 0 0 1 .2-1.4M15 14.2a14 14 0 0 1-1 5.1M9.6 11a2.4 2.4 0 0 1 4.8 0v1.6M4.6 15.5A11 11 0 0 0 5 11a7 7 0 0 1 12.4-4.4M19 11v1.4"/></svg>';
// 잠금 해제 방법: 지문·패턴(이 기기에서 켰을 때) 또는 비밀번호. 마지막에 고른 쪽을 기억해요
// 지문·패턴을 켠 기기는 먼저 '지문 / 패턴 / 비밀번호' 중 고르게 해요. 저절로 창을 띄우지 않아요
const hasPat=()=>!!(S.settings.pat&&S.settings.pat.hash);// 설정을 받기 전엔 이 기기에 기억해 둔 값으로 판단
const patOn=()=>S.settingsReady?hasPat():(()=>{try{return localStorage.getItem('moneybook.patOn')==='1';}catch(e){return false;}})();
function lockWay(){if(S.lockWay==='pin'||(S.lockWay==='pat'&&patOn()))return S.lockWay;return 'choose';}
function renderLock(){const r=$('#lockRoot');const on=lockOn();document.documentElement.classList.toggle('locked',on);
  // 풀릴 때 잠금 화면을 0.35초 동안 투명하게 남겨 둬서, 마지막 숫자를 누른 손가락이 뒤 화면 버튼을 잘못 누르지 않게 해요
  if(!on){const l=r.querySelector('.lock');if(l&&!l.classList.contains('bye')){l.classList.add('bye');setTimeout(()=>{if(!lockOn())r.innerHTML='';},350);}else if(!l)r.innerHTML='';return;}
  if(r.querySelector('.lock.bye'))r.innerHTML='';
  if(r.querySelector('.lock')){updLock();return;}
  const way=lockWay();const PAT='<svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M5 5h7l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const KEY='<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="7" width="18" height="11" rx="2"/><circle cx="7.5" cy="12.5" r="1" fill="currentColor"/><circle cx="12" cy="12.5" r="1" fill="currentColor"/><circle cx="16.5" cy="12.5" r="1" fill="currentColor"/></svg>';
  const head2=`<div class="lock" role="dialog" aria-label="잠금 해제"><img class="lklogo" src="logo-mark.svg" alt="" width="96" height="96"><h2>티끌모아</h2>`;
  if(way==='choose'){r.innerHTML=head2+`<div>잠금 해제 방법을 선택하세요.</div><div class="lkch"><button data-act="lockWay" data-k="fp">${FPI.replace(/width="26" height="26"/,'width="40" height="40"')}<span>지문</span></button><button data-act="lockWay" data-k="pat">${PAT}<span>패턴</span></button><button data-act="lockWay" data-k="pin">${KEY}<span>비밀번호</span></button></div><div class="perr" id="lockErr">${esc(S.pinErr)}</div><button class="lk-forgot" data-act="pinForgot">비밀번호를 잊었어요</button></div>`;return;}
  const back=true?`<button class="lk-back" data-act="lockWay" data-k="choose">‹ 다른 방법으로 열기</button>`:'';
  if(way==='pat'){r.innerHTML=head2+`<div>패턴을 그려 주세요.</div><div class="perr" id="lockErr">${esc(S.pinErr)}</div>${patPadHtml('lock')}<div class="lkfoot">${back}<button class="lk-forgot" data-act="pinForgot">비밀번호를 잊었어요</button></div></div>`;return;}
  r.innerHTML=head2+`<div>비밀번호 4자리를 입력하세요.</div><div id="lockDots">${dotsHtml(S.pinIn.length,!!S.pinErr)}</div><div class="perr" id="lockErr">${esc(S.pinErr)}</div>${padHtml()}<div class="lkfoot">${back}<button class="lk-forgot" data-act="pinForgot">비밀번호를 잊었어요</button></div></div>`;}
// 틀린 횟수는 기기에 기억해서 새로고침해도 초기화되지 않아요. 5번부터 30초, 60초… 기다려야 해요.
function pinFails(add){let o={n:0,at:0};try{o=JSON.parse(localStorage.getItem('moneybook.pinFail')||'{}');}catch(e){}o.n=add?(o.n||0)+1:0;o.at=Date.now();try{localStorage.setItem('moneybook.pinFail',JSON.stringify(o));}catch(e){}return o.n;}
function lockWait(){let o={};try{o=JSON.parse(localStorage.getItem('moneybook.pinFail')||'{}');}catch(e){}if((o.n||0)<5)return 0;const ms=Math.min(600,30*Math.pow(2,o.n-5))*1000-(Date.now()-(o.at||0));return ms>0?Math.ceil(ms/1000):0;}
function updLock(){const d=document.getElementById('lockDots'),e=document.getElementById('lockErr');if(!d){if(e)e.textContent=S.pinErr||'';if(!document.querySelector('#lockRoot .lock'))renderLock();return;}d.innerHTML=dotsHtml(S.pinIn.length,!!S.pinErr);e.textContent=S.pinErr||'';}
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
  if(t.auto)o.auto=true;if(t.src)o.src=str(t.src,30);if(Array.isArray(t.tags)){const tg=t.tags.map(x=>str(x,20)).filter(x=>x&&!BADK.has(x)).slice(0,10);if(tg.length)o.tags=tg;}return o;}
function normalizeSettings(st){const d=clone(DEFAULTS);st=Object.assign(d,st||{});
  st.monthStart=Math.min(28,Math.max(1,parseInt(st.monthStart,10)||1));
  st.lockMin=[0,1,5,10,30].includes(Number(st.lockMin))?Number(st.lockMin):0;
  st.groupCustom=(Array.isArray(st.groupCustom)?st.groupCustom:[]).filter(g=>g&&/^g_[\w-]{1,40}$/.test(String(g.key||''))).map(g=>({key:String(g.key),name:str(g.name,20)||'그룹'}));const GK=GROUPS.concat(st.groupCustom.map(g=>g.key));
  const normAcc=a=>({id:String(a.id),name:str(a.name,30)||'이름 없음',group:(g=>g==='신용카드'?'카드':GK.includes(g)?g:'기타')(str(a.group,60)),inTotal:a.inTotal!==false,perfBase:['prev','cur','avg3'].includes(a.perfBase)?a.perfBase:'prev',hidden:!!a.hidden,memo:str(a.memo,200),phone:str(a.phone,40),smsKey:str(a.smsKey,60),app:str(a.app,40),pay:str(a.pay,60),cutDay:Math.min(31,Math.max(1,parseInt(a.cutDay,10)||1)),payDay:Math.min(31,Math.max(1,parseInt(a.payDay,10)||1)),perf:Math.max(0,Number(a.perf)||0),init:isFinite(Number(a.init))?Number(a.init):0});
  st.accounts=(Array.isArray(st.accounts)?st.accounts:[]).filter(a=>a&&typeof a==='object'&&/^[\w-]{1,60}$/.test(String(a.id||''))).map(normAcc);
  st.deleted=(Array.isArray(st.deleted)?st.deleted:[]).filter(a=>a&&typeof a==='object'&&/^[\w-]{1,60}$/.test(String(a.id||''))).map(a=>Object.assign(normAcc(a),{perf:Number(a.perf)||0}));
  st.weekStart=st.weekStart===1?1:0;st.firstSub=st.firstSub==='cal'?'cal':'daily';
  st.swipe=st.swipe==='off'?'off':'date';st.autoFill=st.autoFill!==false;st.timeMode=['off-desc','off-asc','on-desc','on-asc'].includes(st.timeMode)?st.timeMode:'off-desc';st.inputOrder=st.inputOrder==='cat'?'cat':'amt';st.memoShow=st.memoShow!==false;st.colorSet=st.colorSet==='B'?'B':'A';st.carry=!!st.carry;
  st.trfExp=(Array.isArray(st.trfExp)?st.trfExp:[]).map(String).filter(x=>/^[\w-]{1,60}$/.test(x));st.groupOrder=uniq((Array.isArray(st.groupOrder)?st.groupOrder:[]).filter(g=>GK.includes(g)).concat(GK));st.groupHidden=(Array.isArray(st.groupHidden)?st.groupHidden:[]).filter(g=>GK.includes(g)&&!CORE_G.includes(g));
  const gn=(st.groupNames&&typeof st.groupNames==='object')?st.groupNames:{};const gn2={};for(const k of Object.keys(gn))if(GK.includes(k)&&!BADK.has(k)&&str(gn[k],20).trim())gn2[k]=str(gn[k],20).trim();st.groupNames=gn2;st.cardMode=st.cardMode==='B'?'B':'A';st.nickname=str(st.nickname,20);if(st.pat&&!(typeof st.pat.salt==='string'&&typeof st.pat.hash==='string'))st.pat=null;st.msWeekend=['none','fri','mon'].includes(st.msWeekend)?st.msWeekend:'none';st.tags=uniq((Array.isArray(st.tags)?st.tags:[]).map(x=>str(x,20).trim().replace(/^#/,'')).filter(x=>x&&!BADK.has(x)));
  if(!st.accounts.length)st.accounts=clone(DEFAULTS.accounts||[]);
  const cats={};for(const ty of ['exp','inc']){const l=((st.cats||{})[ty]);cats[ty]=uniq((Array.isArray(l)?l:[]).filter(okName).map(x=>x.trim().slice(0,20)));if(!cats[ty].length)cats[ty]=clone(DEFAULTS.cats[ty]);}st.cats=cats;
  st.recurring=(Array.isArray(st.recurring)?st.recurring:[]).filter(r=>r&&typeof r==='object'&&isFinite(Number(r.amount))&&Number(r.amount)>0).map(r=>Object.assign({},r,{id:str(r.id,60)||newId(),type:okType(r.type),day:Math.min(31,Math.max(1,parseInt(r.day,10)||1)),amount:Number(r.amount),done:(Array.isArray(r.done)?r.done:[]).filter(okYm)})).map(r=>{if(!FREQ[r.freq]){r.freq='monthly';const dn=r.done.slice().sort();const sm=dn[0]||ymd(new Date()).slice(0,7);r.start=okDate(r.start)?r.start:sm+'-'+pad(Math.min(r.day,daysIn(sm)));const lm=dn[dn.length-1];r.last=okDate(r.last)?r.last:(lm?lm+'-'+pad(Math.min(r.day,daysIn(lm))):'');}if(!okDate(r.start))r.start=ymd(new Date());if(r.last&&!okDate(r.last))r.last='';return r;});
  const ms={};if(st.months&&typeof st.months==='object')for(const k of Object.keys(st.months))if(okYm(k))ms[k]=true;st.months=ms;
  if(!Array.isArray(st.favorites))st.favorites=[];
  if(!st.budget||typeof st.budget!=='object')st.budget={total:0,cats:{}};if(!st.budget.cats||typeof st.budget.cats!=='object')st.budget.cats={};
  if(st.pin&&!(typeof st.pin.salt==='string'&&typeof st.pin.hash==='string'))st.pin=null;
  return st;}
function shiftLabel(l,k){const [y,m]=l.split('-').map(Number);const d=new Date(y,m-1+k,1);return d.getFullYear()+'-'+pad(d.getMonth()+1);}
// 월 시작일이 주말이면 설정에 따라 이전 금요일·다음 월요일로 옮겨요
function msDate(y,m0){const s=S.settings.monthStart||1;const d=new Date(y,m0,Math.min(s,new Date(y,m0+1,0).getDate()));const w=d.getDay(),a=S.settings.msWeekend;if(a==='fri'&&(w===6||w===0))d.setDate(d.getDate()-(w===6?1:2));else if(a==='mon'&&(w===6||w===0))d.setDate(d.getDate()+(w===6?2:1));return d;}
function curLabel(){const t=new Date();t.setHours(0,0,0,0);let y=t.getFullYear(),m=t.getMonth();if(t<msDate(y,m)){m--;if(m<0){m=11;y--;}}else if(t>=msDate(y,m+1)){m++;if(m>11){m=0;y++;}}return y+'-'+pad(m+1);}
function period(l){const [y,m]=l.split('-').map(Number);
  const st=msDate(y,m-1),en=msDate(y,m),last=new Date(en.getFullYear(),en.getMonth(),en.getDate()-1);
  return {start:ymd(st),end:ymd(en),last:ymd(last),months:uniq([ymd(st).slice(0,7),ymd(last).slice(0,7)])};}
function catColor(type,name){const list=(S.settings.cats[type]||[]);let i=list.indexOf(name);if(i<0){i=0;for(const c of String(name))i+=c.charCodeAt(0);}return COLORS[(i+(type==='inc'?5:0))%COLORS.length];}
function accName(id){const a=S.settings.accounts.find(a=>a.id===id)||(S.settings.deleted||[]).find(a=>a.id===id);return a?a.name:'(삭제된 자산)';}
function txOf(ym){return S.live[ym]||S.cache[ym]||[];}
function txIn(p){return p.months.flatMap(txOf).filter(t=>t.date>=p.start&&t.date<p.end);}
// 이체지출: 정해 둔 자산(적금·보험 등)으로 보낸 이체는 지출로 셈
const isTE=t=>t.type==='trf'&&(S.settings.trfExp||[]).includes(t.to);
// 카드지출 반영방법 B(결제대금): 카드로 쓴 건 '카드'로만 두고, 통장에서 카드로 보낸 결제 이체를 지출로 셈
const cardB=()=>S.settings.cardMode==='B';
const kindOf=t=>t.type==='trf'?((isTE(t)||(cardB()&&accGrp(t.to)==='카드'))?'exp':'trf'):(t.type==='exp'&&cardB()&&accGrp(t.acc)==='카드'?'card':t.type);
function totals(list){let inc=0,exp=0;for(const t of list){const k=kindOf(t);if(k==='inc')inc+=t.amount;else if(k==='exp')exp+=t.amount;}return {inc,exp,net:inc-exp};}
const GRP=()=>(S.settings.groupOrder&&S.settings.groupOrder.length?S.settings.groupOrder:GROUPS);
const gName=k=>(S.settings.groupNames||{})[k]||((S.settings.groupCustom||[]).find(g=>g.key===k)||{}).name||k;
let _ag=null,_agS=null;const accGrp=id=>{if(_agS!==S.settings){_agS=S.settings;_ag=Object.create(null);for(const a of S.settings.accounts)_ag[a.id]=a.group;}return _ag[id]||'';};
const GVIS=()=>GRP().filter(g=>!(S.settings.groupHidden||[]).includes(g));
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
window.addEventListener('pagehide',()=>{if(!lockOn()&&(document.visibilityState==='visible'||(S.settings.lockMin??0)>0))markActive();});
window.addEventListener('appinstalled',()=>{deferredInstall=null;try{toast('홈 화면에 설치했어요');render();}catch(x){}});
const isStandalone=()=>(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
const isIOS=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
/* ---------- 구글 Firebase 동기화 ----------
   데이터는 Firestore의 books/main 아래에 저장돼요. 보안 규칙으로 허용된 구글 계정만 읽고 쓸 수 있어요.
   이 기기에도 사본을 저장해서 인터넷이 끊겨도 쓰고, 연결되면 자동으로 보내요. */
const FB_CONFIG={apiKey:"AIzaSyBPSKlEh4SXS_-7w4LwvGrLGUSWGCZSPxw",authDomain:"moneybook-926a4.firebaseapp.com",projectId:"moneybook-926a4",
  storageBucket:"moneybook-926a4.firebasestorage.app",messagingSenderId:"630259263268",appId:"1:630259263268:web:8ba3b8dee9df9dfe5af5b1"};
const BOOK='main';
const APP_VERSION=60; // 판 올릴 때마다 1씩 올림 (index.html의 ?v=, sw.js의 CACHE도 같은 숫자)
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
  if(t.auto)body.auto=true;if(t.src)body.src=t.src;if(Array.isArray(t.tags)&&t.tags.length)body.tags=t.tags.slice(0,10).map(x=>String(x).slice(0,20));
  if(orig&&orig.ym!==ym)await S.db.collection('tx_'+orig.ym).doc(orig.id).delete();
  await S.db.collection('tx_'+ym).doc(id).set(body);
  await markMonth(ym);}
function recNext(r,d){// d 다음에 오는 반복 날짜 (d는 YYYY-MM-DD)
  const D=new Date(d+'T00:00:00');const st=new Date(r.start+'T00:00:00');const sd=st.getDate();
  const mAdd=n=>{let y=D.getFullYear(),m=D.getMonth()+n;const c=new Date(y,m,1);return ymd(new Date(c.getFullYear(),c.getMonth(),Math.min(sd,new Date(c.getFullYear(),c.getMonth()+1,0).getDate())));};
  switch(r.freq){case 'daily':return addDays(d,1);
   case 'weekday':{let x=addDays(d,1);while([0,6].includes(dowOf(x)))x=addDays(x,1);return x;}
   case 'weekend':{let x=addDays(d,1);while(![0,6].includes(dowOf(x)))x=addDays(x,1);return x;}
   case 'weekly':return addDays(d,7);case 'w2':return addDays(d,14);case 'w4':return addDays(d,28);
   case 'monthEnd':{const c=new Date(D.getFullYear(),D.getMonth()+1,1);const e=ymd(new Date(D.getFullYear(),D.getMonth()+1,0));return e>d?e:ymd(new Date(c.getFullYear(),c.getMonth()+1,0));}
   case 'm2':return mAdd(2);case 'm3':return mAdd(3);case 'm4':return mAdd(4);case 'm6':return mAdd(6);case 'yearly':return mAdd(12);
   default:return mAdd(1);}}
function recFirst(r){const s0=r.start;if(r.freq==='weekday'&&[0,6].includes(dowOf(s0)))return recNext(r,s0);if(r.freq==='weekend'&&![0,6].includes(dowOf(s0)))return recNext(r,s0);if(r.freq==='monthEnd'){const [y,m]=s0.split('-').map(Number);return y+'-'+pad(m)+'-'+pad(daysIn(s0.slice(0,7)));}return s0;}
async function applyRecurring(){if(S.recurDone||!S.canWrite)return;S.recurDone=true;const td=today();
  const recs=(S.settings.recurring||[]).map(r=>Object.assign({},r));let n=0,changed=false;const ms=new Set();
  for(const r of recs){let d=r.last?recNext(r,r.last):recFirst(r);let guard=0;
    while(d<=td&&guard++<400){const ym=d.slice(0,7);
      try{const ref=S.fs.doc('books/'+BOOK+'/tx_'+ym+'/r_'+r.id+'_'+d.replace(/-/g,''));const ex=await ref.get().catch(()=>null);if(ex&&ex.exists){r.last=d;changed=true;d=recNext(r,d);continue;}await S.db.collection('tx_'+ym).doc('r_'+r.id+'_'+d.replace(/-/g,'')).set({type:r.type,date:d,amount:r.amount,cat:r.cat||'',sub:r.sub||'',acc:r.acc||'',to:r.to||'',memo:r.memo||'',time:'',auto:true,created:Date.now(),updated:Date.now()});n++;ms.add(ym);}catch(e){break;}
      r.last=d;changed=true;d=recNext(r,d);}}
  if(changed){await saveSettings({recurring:recs});for(const ym of ms)await markMonth(ym);}if(n)toast('반복 내역 '+n+'건을 자동으로 입력했어요');}

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

// 숫자가 칸보다 길면(억 단위 등) 글자를 조금씩 줄여서 잘리지 않게 해요
function fitNums(){document.querySelectorAll('.sum b,.net b,.ovbig b,.scbig b,.big,.grp-h.cc em,.acc .num').forEach(el=>{el.style.fontSize='';let f=parseFloat(getComputedStyle(el).fontSize),n=0;while(el.scrollWidth>el.clientWidth+1&&f>10&&n++<12){f-=1;el.style.fontSize=f+'px';}});}
function render(){renderLock();
  if(lockOn()){setHtml($('#top'),'');$('#view').innerHTML='';$('#tabs').hidden=true;$('#fab').hidden=true;if(S.sheet)closeSheet();return;}
  $('#tabs').hidden=false;renderTop();renderView();if(S.sheet==='filter')renderSheet();
  setHtml($('#tabs .in'),TABS.map(([k,n])=>`<button data-act="tab" data-k="${k}" class="${S.tab===k?'on':''}" aria-label="${n}">${ICONS[k]}<span>${n}</span></button>`).join(''));
  $('#fab').hidden=!S.db||!S.canWrite||S.tab==='more'||(S.tab==='list'&&S.sub==='memo');try{fitNums();}catch(e){}}

function carryBefore(d){const ms=allMonths().filter(ym=>ym<=d.slice(0,7));const miss=ms.filter(ym=>!S.live[ym]&&!S.cache[ym]);if(miss.length)ensureMonths(miss);
  let n=S.settings.accounts.reduce((x,a)=>x+(Number(a.init)||0),0)*0;for(const ym of ms)for(const t of txOf(ym))if(t.date<d){const k=kindOf(t);if(k==='inc')n+=t.amount;else if(k==='exp')n-=t.amount;}return n;}
function sumRow(t,carry){if(carry!=null){const tot=carry+t.net;return `<div class="sum four num"><div><span>이월</span><b>${carry<0?'-':''}${won(Math.abs(carry))}</b></div><div><span>수입</span><b class="inc">${won(t.inc)}</b></div><div><span>지출</span><b class="exp">${won(t.exp)}</b></div><div><span>합계</span><b>${tot<0?'-':''}${won(Math.abs(tot))}</b></div></div>`;}
  return `<div class="sum num"><div><span>수입</span><b class="inc">${won(t.inc)}</b></div><div><span>지출</span><b class="exp">${won(t.exp)}</b></div><div><span>합계</span><b>${t.net<0?'-':''}${won(Math.abs(t.net))}</b></div></div>`;}
function renderTop(){const top=$('#top');const sc=!S.db?'off':GH.err?'off':S.db.pending()?'pending':'ok';const st=!S.db?'연결 안 됨':GH.err?'동기화 끊김':sc==='pending'?'저장 중…':'동기화됨';
  let h='';
  if(S.tab==='list'){const yearMode=S.sub==='month';const [y,m]=S.label.split('-');
    const t=yearMode?totals(yearTx(+y).filter(passFilter)):totals(txIn(period(S.label)).filter(passFilter));
    h+=`<div class="lhead"><div class="lnav"><button data-act="${yearMode?'yprev':'prev'}" aria-label="이전">‹</button><button class="mlab" data-act="mpOpen" data-k="${yearMode?'year':'month'}" aria-label="날짜 고르기">${yearMode?y+'년':y+'년 '+(+m)+'월'}<i>▾</i></button><button data-act="${yearMode?'ynext':'next'}" aria-label="다음">›</button></div>
      <div class="hic"><span class="sync ${sc}" title="${st}"><i></i></span><button data-act="open" data-k="sms" aria-label="문자 붙여넣기">${HICON.sms}</button><button data-act="open" data-k="favorites" aria-label="자주 쓰는 내역">${HICON.fav}</button><button data-act="open" data-k="search" aria-label="검색">${HICON.search}</button><button data-act="open" data-k="filter" aria-label="필터" class="${filterOn()?'fact':''}">${HICON.set}</button></div></div>
    <div class="subtabs">${SUBS.map(([k,n])=>`<button data-act="sub" data-k="${k}" class="${S.sub===k?'on':''}">${n}</button>`).join('')}</div>${sumRow(t,S.settings.carry&&!yearMode?carryBefore(period(S.label).start):null)}`;
    setHtml(top,h);return;}
  if(S.db&&!S.needSetup&&S.tab==='asset'&&S.overview){const [oy,om]=(S.ovLabel||S.label).split('-');h=`<div class="ttl"><b><button class="x back2" data-act="ovw" data-k="0" aria-label="뒤로">←</button>전체통계</b><span class="lnav"><button data-act="ovShift" data-k="-1" aria-label="이전">‹</button><b class="num">${oy}년 ${+om}월</b><button data-act="ovShift" data-k="1" aria-label="다음">›</button></span></div>`;setHtml(top,h);return;}
  if(S.db&&!S.needSetup&&S.tab==='asset'){h=S.av?avTop(sc,st):`<div class="ttl"><b>자산</b><span class="ttl-r"><button class="x" data-act="ovw" data-k="${S.overview?0:1}" aria-label="전체 통계">${HICON.chart}</button><button class="x dots" data-act="amenu" aria-label="자산 메뉴">⋮</button></span>${S.amenu?`<div class="amenu-ov" data-act="amenuClose"></div><div class="amenu"><button data-act="accNew">추가</button><button data-act="open" data-k="accHide">표시/숨김</button><button data-act="open" data-k="accDel">삭제</button><button data-act="open" data-k="accOrder">순서 변경</button></div>`:''}</div>`;setHtml(top,h);return;}
  if(S.db&&!S.needSetup&&S.tab==='more'){h=`<div class="ttl"><b>${S.moreView==='set'?'<button class="x back2" data-act="moreBack" aria-label="뒤로">←</button>설정관리':'설정'}</b></div>`;setHtml(top,h);return;}
  if(!(S.db&&!S.needSetup&&S.tab==='stat'))h=`<div class="brand"><h1><img src="logo-mark.svg" alt="" width="34" height="34">티끌모아</h1><span class="sync ${sc}"><i></i>${st}</span></div>`;
  if(S.tab==='stat'&&S.statCat&&S.db&&!S.needSetup){const sp=statPeriod();const [y,m]=S.label.split('-');const nav=S.sp==='range'?`<b class="num wkl">${dot2(sp.start)} ~ ${dot2(sp.last)}</b>`:`<span class="lnav"><button data-act="sprev" aria-label="이전">‹</button><b class="num">${S.sp==='year'?(S.spYear||y)+'년':S.sp==='week'?dot2(sp.start)+' ~ '+dot2(sp.last):y+'년 '+(+m)+'월'}</b><button data-act="snext" aria-label="다음">›</button></span>`;
    setHtml(top,`<div class="ttl"><b><button class="x back2" data-act="scClose" aria-label="뒤로">←</button>${esc(S.statCat)}</b>${nav}</div>`);return;}
  if(S.tab==='stat'){const sp=statPeriod();const t=totals(txIn(sp));const modes=[['week','주간'],['month','월간'],['year','연간'],['range','기간']];
    let lab;if(S.sp==='month'){const [y,m]=S.label.split('-');lab=`<button class="mlab" data-act="mpOpen" data-k="month">${y}년 ${+m}월<i>▾</i></button>`;}else if(S.sp==='year')lab=`<button class="mlab" data-act="mpOpen" data-k="syear">${S.spYear||S.label.slice(0,4)}년<i>▾</i></button>`;
    else if(S.sp==='week')lab=`<b class="num wkl">${dot2(sp.start)} ~ ${dot2(sp.last)}</b>`;
    else lab=`<span class="rng"><input type="date" id="sp-from" class="in-t" value="${sp.start}" aria-label="시작일"> ~ <input type="date" id="sp-to" class="in-t" value="${sp.last}" aria-label="종료일"></span>`;
    h+=`<div class="snav"><div class="lnav">${S.sp==='range'?'':'<button data-act="sprev" aria-label="이전">‹</button>'}${lab}${S.sp==='range'?'':'<button data-act="snext" aria-label="다음">›</button>'}</div>
      <span class="smw"><button class="smode" data-act="smOpen">${(modes.find(x=>x[0]===S.sp)||modes[1])[1]} <i>⌄</i></button>${S.smOpen?`<span class="amenu-ov" data-act="smClose"></span><span class="amenu sm">${modes.map(([k,n])=>`<button data-act="smPick" data-k="${k}">${n}</button>`).join('')}</span>`:''}</span></div>
    <div class="stabs num"><button data-act="stype" data-k="inc" class="${S.statType==='inc'?'on':''}">수입 <b>${won(t.inc)}원</b></button><button data-act="stype" data-k="exp" class="${S.statType==='exp'?'on':''}">지출 <b>${won(t.exp)}원</b></button></div>`;}
  setHtml(top,h);}

function rowHtml(t){const kd=kindOf(t);const isT=t.type==='trf';const name=isT?'이체':(t.cat||'미분류')+(t.sub?' › '+t.sub:'');
  const tm=(S.settings.timeMode||'').startsWith('on')&&t.time?`<span class="tm num">${esc(t.time.slice(0,5))}</span> `:'';const acc=tm+(isT?`${esc(accName(t.acc))} → ${esc(accName(t.to))}`:esc(accName(t.acc))+(t.note&&S.settings.memoShow?' · '+esc(t.note):'')+(t.auto?' · 반복':''))+(isTE(t)?' · 이체지출':'')+(kd==='card'?' · 결제 때 지출':'')+(t.type==='trf'&&kd==='exp'&&!isTE(t)?' · 카드대금':'');
  const cls=kd==='exp'?'exp':kd==='inc'?'inc':'trf';
  return `<button class="row" data-act="edit" data-id="${esc(t.id)}" data-ym="${esc(String(t.date).slice(0,7))}"><span class="c">${esc(name)}</span><span class="t">${t.memo?`<b>${esc(t.memo)}</b><small>${acc}</small>`:`<small class="solo">${acc}</small>`}</span><span class="a num ${cls}">${won(t.amount)}원</span></button>`;}

function dayGroups(list){const by={};for(const t of list)(by[t.date]=by[t.date]||[]).push(t);
  return Object.keys(by).sort().reverse().map(d=>{const asc=(S.settings.timeMode||'').endsWith('asc');const items=by[d].sort((a,b)=>{const r=(b.time||'').localeCompare(a.time||'')||(b.created||0)-(a.created||0);return asc?-r:r;});const tt=totals(items);const w=dowOf(d);
    return `<div class="dg"><div class="day" data-act="addOn" data-d="${esc(d)}" title="이 날짜로 입력"><span class="dn num">${+d.slice(8)||''}</span><span class="dw ${w===0?'sun':w===6?'sat':''}">${DOW[w]}요일</span><span class="dym num">${esc(d.slice(0,7).replace('-','.'))}</span><span class="ds num"><span class="inc">${won(tt.inc)}원</span><span class="exp">${won(tt.exp)}원</span></span></div><div class="rows">${items.map(rowHtml).join('')}</div></div>`;}).join('');}

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
  const by={};for(const t of ms.flatMap(txOf)){if(t.date<st||t.date>en||!passFilter(t))continue;const o=by[t.date]=by[t.date]||{inc:0,exp:0};const k=kindOf(t);if(k==='inc')o.inc+=t.amount;else if(k==='exp')o.exp+=t.amount;}
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

function memoHtml(){const ym=S.label;if(!S.memo||S.memo.ym!==ym){S.memo={ym,items:[],loaded:false};const mm=S.memo;
    S.db.doc('memo/'+ym).get().then(sn=>{if(S.memo!==mm)return;const d=sn.exists?sn.data():{};mm.items=Array.isArray(d.items)?d.items.slice():[];if(d.text&&!mm.items.some(x=>x.id==='legacy'))mm.items.push({id:'legacy',date:ym+'-01',text:d.text,updated:d.updated||0});mm.loaded=true;render();}).catch(()=>{mm.loaded=true;render();});}
  const m=S.memo;if(!m.loaded)return '<div class="empty"><b>불러오는 중이에요</b></div>';
  const fab=S.canWrite?`<button class="fab memofab" data-act="memoNew" aria-label="메모 쓰기"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="4" y="3" width="13" height="17" rx="2"/><path d="M7 8h7M7 12h7M7 16h3M19 14v6M16 17h6"/></svg></button>`:'';
  if(!m.items.length)return `<div class="empty nodata"><svg viewBox="0 0 64 64" width="84" height="84" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 50c0-12 6-22 18-22l4-10 4 8h4l4-8 2 12c2 4 2 12-4 18H20"/><circle cx="40" cy="26" r="1.5" fill="currentColor"/><path d="M48 14h10v7h-6l-2 3v-3h-2z"/></svg><span>데이터가 없습니다.</span></div>`+fab;
  const list=m.items.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.updated||0)-(a.updated||0));
  return `<div class="rows memos">${list.map(x=>`<button class="memo-i" data-act="memoEdit" data-k="${esc(x.id)}"><span class="num muted">${esc((x.date||'').slice(5).replace('-','.'))}</span><span class="mt">${esc(x.text)}</span></button>`).join('')}</div>`+fab;}

const PIE=['#ff6f61','#ff9a4d','#ffcb45','#f0e030','#bfe04a','#7fcf78','#4cc3b8','#4aa3e0','#7b8ae6','#b27be0','#e07bb4','#a8a29a'];
function pieSvg(items,total){const W=420,H=300,cx=210,cy=150,r=92;let a0=-Math.PI/2;const segs=[],labs=[];
  const pt=(a,rr)=>[cx+rr*Math.cos(a),cy+rr*Math.sin(a)];
  for(const it of items){const f=total?it.v/total:0;const a1=a0+f*2*Math.PI;
    if(f>=0.9999)segs.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${it.c}"/>`);
    else if(f>0){const [x0,y0]=pt(a0,r),[x1,y1]=pt(a1,r);segs.push(`<path d="M${cx},${cy}L${x0.toFixed(1)},${y0.toFixed(1)}A${r},${r} 0 ${f>.5?1:0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}Z" fill="${it.c}" stroke="var(--surface)" stroke-width="1.5"/>`);}
    const am=(a0+a1)/2;const [ex,ey]=pt(am,r);const [mx,my]=pt(am,r+18);labs.push({it,f,ex,ey,mx,my,right:Math.cos(am)>=0});a0=a1;}
  // 왼쪽·오른쪽 따로 위아래 겹치지 않게 벌려요
  for(const side of [true,false]){const L=labs.filter(l=>l.right===side).sort((a,b)=>a.my-b.my);let last=-1e9;for(const l of L){l.ly=Math.max(l.my,last+34);last=l.ly;}const over=last-(H-14);if(over>0)for(const l of L)l.ly-=over;}
  const lines=labs.map(l=>{const tx=l.right?Math.min(Math.max(l.mx,cx+r+8),W-112):Math.max(Math.min(l.mx,cx-r-8),112);const anc=l.right?'start':'end';const tx2=l.right?tx+6:tx-6;
    return `<polyline points="${l.ex.toFixed(1)},${l.ey.toFixed(1)} ${l.mx.toFixed(1)},${l.ly.toFixed(1)} ${tx.toFixed(1)},${l.ly.toFixed(1)}" fill="none" stroke="${l.it.c}" stroke-width="1.2"/><text x="${tx2.toFixed(1)}" y="${(l.ly-2).toFixed(1)}" text-anchor="${anc}" class="pl">${esc(l.it.k)}</text><text x="${tx2.toFixed(1)}" y="${(l.ly+14).toFixed(1)}" text-anchor="${anc}" class="pp">${(l.f*100).toFixed(1)} %</text>`;}).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="piesvg" role="img" aria-label="분류별 비율">${segs.join('')}${lines}</svg>`;}
function donut(items,total){const r=58,C=2*Math.PI*r;let acc=0;const segs=items.map(it=>{const len=total?it.v/total*C:0;const s=`<circle r="${r}" cx="80" cy="80" fill="none" stroke="${it.c}" stroke-width="22" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-acc}"/>`;acc+=len;return s;}).join('');
  return `<svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="분류별 비율"><g transform="rotate(-90 80 80)"><circle r="${r}" cx="80" cy="80" fill="none" stroke="var(--sunk)" stroke-width="22"/>${segs}</g><text x="80" y="76" text-anchor="middle" font-size="12" fill="var(--muted)">${S.statType==='exp'?'총 지출':'총 수입'}</text><text x="80" y="96" text-anchor="middle" font-size="17" font-weight="700" fill="var(--ink)">${compact(total)}원</text></svg>`;}

function scHtml(){const sp=statPeriod();const ty=S.statType;const cat=S.statCat;const miss=sp.months.filter(ym=>!S.live[ym]&&!S.cache[ym]);if(miss.length){ensureMonths(miss);return '<div class="empty"><b>불러오는 중이에요</b></div>';}
  const conv=t=>t.type==='trf'?Object.assign({},t,{cat:accName(t.to)+(accGrp(t.to)==='카드'&&cardB()?'(카드대금)':'(이체)')}):t;
  const its=txIn(sp).filter(t=>kindOf(t)===ty).map(conv).filter(t=>(t.cat||'미분류')===cat);const tot=its.reduce((x,t)=>x+t.amount,0);
  const sb=Object.create(null);its.forEach(t=>{const k=t.sub||'기타';sb[k]=(sb[k]||0)+t.amount;});const sk=Object.keys(sb).sort((a,b)=>sb[b]-sb[a]);const fs=S.statSub||'';
  const lab=S.sp==='year'?'연총액':S.sp==='week'?'주총액':S.sp==='range'?'기간 총액':'월총액';
  // 최근 8개월(연간은 6년) 이 분류 금액 추이
  const pts=[];if(S.sp==='year'){const y0=S.spYear||+S.label.slice(0,4);for(let k=5;k>=0;k--){const y=y0-k;pts.push({lab:String(y).slice(2)+'년',r:{start:y+'-01-01',end:(y+1)+'-01-01'}});}}else{let l=S.label;for(let k=0;k<8;k++){pts.unshift({lab:(+l.slice(5))+'월',r:period(l)});l=shiftLabel(l,-1);}}
  const need=uniq(pts.flatMap(p=>monthsBetween(p.r.start,addDays(p.r.end,-1)))).filter(ym=>!S.live[ym]&&!S.cache[ym]&&(S.settings.months||{})[ym]);if(need.length)ensureMonths(need);
  const vals=pts.map(p=>monthsBetween(p.r.start,addDays(p.r.end,-1)).flatMap(txOf).filter(t=>t.date>=p.r.start&&t.date<p.r.end&&kindOf(t)===ty).map(conv).filter(t=>(t.cat||'미분류')===cat&&(!fs||(t.sub||'기타')===fs)).reduce((x,t)=>x+t.amount,0));
  const W=360,H=190,mx=Math.max(1,...vals)*1.15;const X=i=>36+(W-50)*i/Math.max(1,pts.length-1),Y=v=>12+(H-40)*(1-v/mx);
  const fk=v=>v>=1e4?Math.round(v/1e3)+'k':won(v);
  const svg=`<svg viewBox="0 0 ${W} ${H}" width="100%" class="lc"><rect x="30" y="0" width="${W-30}" height="${H-28}" fill="var(--sunk)" rx="4"/>${[0,1,2,3].map(g=>{const v=mx*g/3;return `<line x1="30" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="26" y="${Y(v)+3}" text-anchor="end" class="ax">${fk(v)}</text>`;}).join('')}<polyline points="${vals.map((v,i)=>X(i).toFixed(1)+','+Y(v).toFixed(1)).join(' ')}" fill="none" stroke="var(--exp)" stroke-width="2.2"/>${vals.map((v,i)=>`<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="4.5" fill="var(--exp)"/><text x="${X(i).toFixed(1)}" y="${H-8}" text-anchor="middle" class="ax2">${pts[i].lab}</text>`).join('')}</svg>`;
  const list=fs?its.filter(t=>(t.sub||'기타')===fs):its;
  return `<div class="scbig"><small class="muted">${lab}</small><b class="num">${won(tot)}원</b></div><div class="rows scsub"><button class="${!fs?'on':''}" data-act="ssub" data-k=""><span>전체</span><span class="num muted">100%</span><b class="num">${won(tot)}원</b></button>${sk.map(k=>`<button class="${fs===k?'on':''}" data-act="ssub" data-k="${esc(k)}"><span>${esc(k)}</span><span class="num muted">${tot?Math.round(sb[k]/tot*100):0}%</span><b class="num">${won(sb[k])}원</b></button>`).join('')}</div><div class="card charts">${svg}</div>${list.length?dayGroups(list):'<div class="empty"><b>내역이 없어요</b></div>'}`;}
function statHtml(){if(S.statCat)return scHtml();const sp=statPeriod();const miss=sp.months.filter(ym=>!S.live[ym]&&!S.cache[ym]);
  if(miss.length){ensureMonths(miss);return '<div class="empty"><b>불러오는 중이에요</b></div>';}
  const ty=S.statType;const list=txIn(sp).filter(t=>kindOf(t)===ty).map(t=>t.type==='trf'?Object.assign({},t,{cat:accName(t.to)+(accGrp(t.to)==='카드'&&cardB()?'(카드대금)':'(이체)')}):t);const by=Object.create(null);for(const t of list)by[t.cat||'미분류']=(by[t.cat||'미분류']||0)+t.amount;
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

function overviewHtml(){const L=S.ovLabel||S.label;const labels=[];for(let i=5;i>=0;i--)labels.push(shiftLabel(L,-i));
  // 누적잔액 = 체크카드·총액반영 끈 자산을 뺀 모든 자산 잔액의 합 (자산 화면의 '합계'와 같아요)
  const accs=S.settings.accounts.filter(a=>a.group!=='체크카드'&&a.inTotal!==false);const ids=new Set(accs.map(a=>a.id));const init=accs.reduce((x,a)=>x+(Number(a.init)||0),0);
  const all=allMonths().flatMap(txOf).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const balAt=d=>{let b=init;for(const t of all){if(t.date>d)break;if(t.type==='inc'&&ids.has(t.acc))b+=t.amount;else if(t.type==='exp'&&ids.has(t.acc))b-=t.amount;else if(t.type==='trf'){if(ids.has(t.acc))b-=t.amount;if(ids.has(t.to))b+=t.amount;}}return b;};
  const pts=labels.map(l=>{const p=period(l);const tt=totals(txIn(p));return {lab:(+l.slice(5))+'월',bal:balAt(p.last<today()?p.last:today()),out:tt.exp,inn:tt.inc};});
  const cur=pts[5].bal;return `<div class="ovbig"><small class="muted">누적잔액</small><b class="num">${cur<0?'-':''}${won(Math.abs(cur))}</b></div>`+lineBars(pts);}

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
    if(isCard&&a.perf&&v.tab==='d'){
      // 할부는 첫 달에 할부 총 금액을 실적으로 (편한가계부와 같게). 내용 끝의 (할부 1/3)·(1/3) 표시로 알아봐요
      const IR=/\s*\((?:할부\s*)?(\d{1,2})\/(\d{1,2})\)\s*$/;const grp=Object.create(null);
      for(const o of F.list){if(o.t.type!=='exp')continue;const m=(o.t.memo||'').match(IR);if(!m)continue;const k=(o.t.memo||'').replace(IR,'')+'|'+m[2];const g=grp[k]=grp[k]||{tot:0,first:null};g.tot+=o.t.amount;if(m[1]==='1')g.first=o.t.id;}
      const pv=t=>{const m=(t.memo||'').match(IR);if(!m)return t.amount;const g=grp[(t.memo||'').replace(IR,'')+'|'+m[2]];if(!g||!g.first)return t.amount;return g.first===t.id?g.tot:0;};
      const mon=l=>{const s0=l+'-01',e0=l+'-'+pad(daysIn(l));return {s0,e0,u:F.list.filter(o=>o.v<0&&o.t.type==='exp'&&o.t.date>=s0&&o.t.date<=e0).reduce((x,o)=>x+pv(o.t),0)};};const L=v.label;
      let cy={cur:{start:L+'-01',end:L+'-'+pad(daysIn(L))}};let used=mon(L).u;// 편한가계부처럼 이번 달(1일~말일) 사용액을 실적으로 보여줘요. 3개월 평균은 이번 달 포함 3달
      if(a.perfBase==='avg3'){const ls=[shiftLabel(L,-2),shiftLabel(L,-1),L];cy={cur:{start:ls[0]+'-01',end:ls[2]+'-'+pad(daysIn(ls[2]))}};used=Math.round(ls.reduce((x,l)=>x+mon(l).u,0)/3);}
      h+=`<div class="perf"><div><small class="muted">${a.perfBase==='avg3'?'3개월 평균 ':''}실적 (${f2(cy.cur.start)} ~ ${f2(cy.cur.end)})</small><b class="num">${won(a.perf)}원 ${used>=a.perf?'<span class="okc">✓</span>':''}</b></div><div><small class="muted">실적사용금액</small><b class="num">${won(used)}원</b></div><div><small class="muted">남은금액</small><b class="num muted">${a.perf-used<0?'-':''}${won(Math.abs(a.perf-used))}원</b></div></div>`;}
    const per=[];if(v.tab==='d'){let l=v.label;for(let i=0;i<6;i++){per.unshift({lab:(+l.slice(5))+'월',r:period(l)});l=shiftLabel(l,-1);}}else{for(let i=5;i>=0;i--){const y=v.year-i;per.push({lab:String(y).slice(2)+'년',r:{start:y+'-01-01',end:(y+1)+'-01-01',last:y+'-12-31'}});}}
    const pts=per.map(p=>({lab:p.lab,bal:balAt(p.r.last),out:F.list.filter(o=>o.v<0&&o.t.date>=p.r.start&&o.t.date<p.r.end).reduce((x,o)=>x-o.v,0),inn:F.list.filter(o=>o.v>0&&o.t.date>=p.r.start&&o.t.date<p.r.end).reduce((x,o)=>x+o.v,0)}));
    h+=lineBars(pts);return h;}
  if(v.tab==='d'){const rows=inR.slice().reverse();if(!rows.length)return h+`<div class="empty"><b>이 기간 내역이 없어요</b></div>`+avFab(a);
    const by={};rows.forEach(o=>(by[o.t.date]=by[o.t.date]||[]).push(o));let first=true;
    h+=Object.keys(by).sort().reverse().map(d=>{const its=by[d];const di=its.reduce((x,o)=>x+(o.v>0?o.v:0),0),dx=its.reduce((x,o)=>x+(o.v<0?-o.v:0),0);const w=dowOf(d);
      return `<div class="dg"><div class="day" data-act="addOn" data-d="${esc(d)}" title="이 날짜로 입력"><span class="dn num">${+d.slice(8)}</span><span class="dw ${w===0?'sun':w===6?'sat':''}">${DOW[w]}요일</span><span class="dym num">${esc(d.slice(0,7).replace('-','.'))}</span><span class="ds num"><span class="inc">${won(di)}원</span><span class="exp">${won(dx)}원</span></span></div><div class="rows">${its.map(o=>{const t=o.t;const isT=t.type==='trf';const name=isT?'이체':(t.cat||'미분류');
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
  if(S.overview)return overviewHtml();
  const accs=S.settings.accounts.filter(a=>!a.hidden&&GVIS().includes(a.group||'기타'));const bal=accBalances();
  const cur=curLabel();const td=today();const use=(lab)=>{const u=Object.create(null);for(const t of txIn(period(lab)))if(t.type==='exp'&&t.date<=td)u[t.acc]=(u[t.acc]||0)+t.amount;return u;};
  const u0=use(cur),u1=use(shiftLabel(cur,-1));
  const all=allMonths().flatMap(txOf);const useIn=(id,c)=>all.reduce((x,t)=>x+(t.type==='exp'&&t.acc===id&&t.date>=c.start&&t.date<=c.end&&t.date<=td?t.amount:0),0);
  const card=Object.create(null);for(const a of accs)if(a.group==='카드'){const cy=cardCycles(a);const out=Math.max(0,-bal[a.id]);const mi=Math.min(useIn(a.id,cy.cur),out);const due=Math.min(useIn(a.id,cy.prev),out-mi);card[a.id]={mi,due,old:out-mi-due};}
  let pos=0,neg=0;for(const a of accs){if(a.group==='체크카드'||a.inTotal===false)continue;const v=bal[a.id];if(v>=0)pos+=v;else neg+=-v;}
  const amt=v=>`<b class="num ${v<0?'exp':v>0?'inc':''}">${won(Math.abs(v))}원</b>`;
  const row=(a,inner)=>`<button class="acc ${inner.cc?'cc':''}" data-act="avOpen" data-k="${esc(a.id)}"><span>${esc(a.name)}</span>${inner.h}</button>`;
  let h=`<div class="card"><div class="net num"><div><span>자산</span><b class="inc">${won(pos)}</b></div><div><span>부채</span><b class="exp">${won(neg)}</b></div><div><span>합계</span><b>${pos-neg<0?'-':''}${won(Math.abs(pos-neg))}</b></div></div></div>`;
  const mlab=+cur.slice(5,7)+'월';
  for(const g of GVIS()){const list=accs.filter(a=>(a.group||'기타')===g);if(!list.length)continue;
    if(g==='카드'){const sDue=list.reduce((x,a)=>x+card[a.id].due+card[a.id].old,0),sMi=list.reduce((x,a)=>x+card[a.id].mi,0);
      h+=`<div class="grp"><div class="grp-h cc"><span>${esc(gName('카드'))}</span><span class="num"><small>결제예정금액</small><em class="${sDue?'exp':''}">${won(sDue)}원</em></span><span class="num"><small>미결제금액</small><em class="${sMi?'exp':''}">${won(sMi)}원</em></span></div><div class="rows" style="border-radius:var(--r)">${list.map(a=>{const c=card[a.id];const over=bal[a.id]>0?bal[a.id]:0;
        return row(a,{cc:1,h:`<span class="num c2"><b class="${c.due?'exp':''}">${won(c.due)}원</b>${c.old?`<small>-${won(c.old)}원</small>`:over?`<small class="inc">+${won(over)}원</small>`:''}</span><span class="num c3"><b class="${c.mi?'exp':''}">${won(c.mi)}원</b></span>`});}).join('')}</div></div>`;continue;}
    if(g==='체크카드'){const sum=list.reduce((x,a)=>x+(u0[a.id]||0),0);
      h+=`<div class="grp"><div class="grp-h"><span>${esc(gName('체크카드'))}(${mlab})</span><span class="num ${sum?'exp':''}">${won(sum)}원</span></div><div class="rows" style="border-radius:var(--r)">${list.map(a=>row(a,{h:`<b class="num ${u0[a.id]?'exp':''}">${won(u0[a.id]||0)}원</b>`})).join('')}</div></div>`;continue;}
    const sum=list.reduce((x,a)=>x+bal[a.id],0);
    h+=`<div class="grp"><div class="grp-h"><span>${esc(gName(g))}</span><span class="num ${sum<0?'exp':sum>0?'inc':''}">${won(Math.abs(sum))}원</span></div><div class="rows" style="border-radius:var(--r)">${list.map(a=>row(a,{h:amt(bal[a.id])})).join('')}</div></div>`;}
  const nh=S.settings.accounts.length-accs.length;
  h+=`<div class="menu">${nh?`<button data-act="open" data-k="accHide"><span>숨긴 자산</span><small>${nh}개 ›</small></button>`:''}</div><p style="font-size:12px;color:var(--muted);padding:0 4px;line-height:1.6">빨간 숫자는 쓴 돈이 들어온 돈보다 많은 금액(부채)이에요. 카드: 미결제금액 = 이번 사용 기간 사용액, 결제예정금액 = 지난 사용 기간 사용액(카드마다 정산일 기준), 아래 회색 = 그 전부터 남은 금액. 오늘 이후 날짜의 내역(할부 다음 회차 등)은 그날이 되면 들어가요. 체크카드는 이번 달 사용액만 보여주고 합계에는 넣지 않아요. 자산을 누르면 그 자산의 내역과 추이를 볼 수 있어요. 오른쪽 위 그래프 단추는 전체 통계예요.</p>`;
  return h;}

function moreHtml(){const st=S.settings;const bt=st.budget&&st.budget.total;
  if(S.moreView==='set')return setMgmtHtml();
  const sc=!S.db?'off':GH.err?'off':S.db.pending()?'pending':'ok';
  const G=(act,k,ic,n)=>`<button class="gi" data-act="${act}" data-k="${k}">${ic}<span>${n}</span></button>`;
  return `<div class="card acct"><button class="acct-h" data-act="open" data-k="mypage"><span><b>${esc(S.settings.nickname||(S.user&&S.user.displayName)||'내 가계부')}</b><small class="muted">${esc((S.user&&S.user.email)||'')}</small></span><i>›</i></button>
   <div class="acct-s"><span><span class="muted">실시간 동기화</span> <em class="sync-b ${sc}">${sc==='off'?'끊김':sc==='pending'?'저장 중':'사용 중'}</em><br><small class="muted">다른 폰·PC와 바로 맞춰져요</small></span><button class="btn sm" data-act="open" data-k="sync">⟳ 동기화</button></div></div>
  <div class="grid3">${isStandalone()?'':G('install','', MICON.install,'앱 설치')}${G('moreGo','set',MICON.gear,'설정관리')}${G('open','sms',MICON.sms,'문자 붙여넣기')}${G('open','search',MICON.search,'내역 검색')}${G('open','backup',MICON.backup,'백업/복원')}${G('export','month',MICON.xls,'이번 달 엑셀')}${G('export','all',MICON.xls,'전체 엑셀')}</div>
  <div class="card help"><h3>여러 휴대폰에서 같이 쓰기</h3>`+moreHelp();}
const MI=d=>`<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const MICON={gear:MI('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
 sms:MI('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),search:MI('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
 backup:MI('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),xls:MI('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 13l4 5M13 13l-4 5"/>'),
 install:MI('<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>')};
function setMgmtHtml(){const st=S.settings;const bt=st.budget&&st.budget.total;const nd=(st.deleted||[]).length;const nc=st.accounts.filter(a=>a.group==='카드').length;
  const it=(act,k,n,v,extra)=>`<button data-act="${act}" data-k="${esc(k)}" ${extra||''}><span>${n}</span><small class="sv">${v||''}</small></button>`;const OX=b=>b?'ON':'OFF';
  const TM={'off-desc':'사용안함 - 내림차순','off-asc':'사용안함 - 오름차순','on-desc':'사용함 - 내림차순','on-asc':'사용함 - 오름차순'};
  return `<div class="smg"><div class="smh">자산관리</div>
   ${it('open','groups','자산그룹',(st.groupHidden||[]).length?(st.groupHidden.length+'개 숨김'):'')}${it('open','accList','자산설정',st.accounts.length+'개')}${it('open','accHide','표시/숨김',st.accounts.filter(a=>a.hidden).length?st.accounts.filter(a=>a.hidden).length+'개 숨김':'')}${it('open','accOrder','자산 순서 변경','')}${it('open','accDeleted','삭제된 자산',nd?nd+'개':'')}${it('open','trfExp','이체지출 설정',(st.trfExp||[]).length?st.trfExp.length+'개':'')}${it('choose','cardMode','카드지출 반영방법',st.cardMode==='B'?'B. 결제대금':'A. 사용시점')}${it('open','cardPerf','카드 이용실적',nc+'장')}
   <div class="smh">분류/반복</div>
   ${it('catsOf','inc','수입분류 관리',st.cats.inc.length+'개')}${it('catsOf','exp','지출분류 관리',st.cats.exp.length+'개')}${it('setToggle','subOn','소분류 기능',st.subOn===false?'OFF':'ON')}${it('open','budget','예산설정',bt?'월 '+won(bt)+'원':'')}${it('open','tags','태그관리','')}${it('open','recurring','반복관리',(st.recurring||[]).length+'건')}${it('open','favorites','자주 쓰는 내역',(st.favorites||[]).length+'건')}
   <div class="smh">설정관리</div>
   ${it('info','원화(KRW)만 써요.','주 화폐 설정','KRW (원)')}${it('choose','firstSub','가계부탭 첫화면 (일일/달력)',st.firstSub==='cal'?'달력':'일일')}${it('open','monthStart','월 시작일',(parseInt(st.monthStart,10)||1)+' 일')}${it('choose','weekStart','주간 시작일 설정',st.weekStart===1?'월요일':'일요일')}${it('choose','carry','이월 설정',OX(st.carry))}${it('choose','swipe','스와이프',st.swipe==='off'?'사용 안 함':'날짜이동')}${it('choose','colorSet','수입-지출 색상 설정','Set. '+(st.colorSet||'A'))}${it('choose','timeMode','시간 입력',TM[st.timeMode]||TM['off-desc'])}${it('setToggle','memoShow','내역 > 메모 표시하기',OX(st.memoShow))}${it('setToggle','autoFill','내역 자동 완성',OX(st.autoFill))}${it('choose','inputOrder','입력순서',st.inputOrder==='cat'?'분류부터':'금액부터')}
   <div class="smh">기타</div>
   ${it('open','pin','비밀번호',OX(st.pin))}${it('open','backup','백업/복원','')}${it('open','sync','계정·동기화','')}</div>`;}
function moreHelp(){return `
  <p><b>내 폰·PC 여러 대</b> — 각 기기에서 이 주소를 열고 같은 구글 계정으로 로그인하면 끝이에요. 한쪽에서 입력하면 다른 기기에 바로 나타나요.</p>
  <p><b>가족과 함께</b> — 가족 구글 계정을 허용 목록에 넣으면 같은 장부에 함께 적을 수 있어요. 필요하면 Claude에게 부탁하세요.</p>
  <p><b>앱처럼 쓰기</b> — 휴대폰 브라우저에서 링크를 연 뒤 ‘홈 화면에 추가’를 누르면 아이콘으로 바로 열려요.</p></div><div class="card ainfo"><div class="ainfo-h"><b>앱 정보</b><span class="vchip num">v${APP_VERSION}</span></div><p>© 2026 티제이컴퍼니. All rights reserved.</p></div>`;}

/* ---------- sheets ---------- */
function openSheet(k){if(!S.sheet&&!S.histSheet){try{history.pushState({mbSheet:1},'');S.histSheet=true;}catch(e){}}S.sheet=k;renderSheet();}
function closeSheet(){S.sheet=null;$('#sheetRoot').innerHTML='';if(S.histSheet){S.histSheet=false;S.ignorePop=true;try{history.back();}catch(e){S.ignorePop=false;}}}
/* ---------- 휴대폰 뒤로 가기 ----------
   앱 맨 처음 화면 위에 '보초' 기록을 하나 깔아 두고, 뒤로 가기를 누르면 앱 안에서 한 단계씩 돌아가요.
   (창 닫기 → 상세 화면 닫기 → 가계부 탭으로) 가계부 첫 화면에서는 한 번 더 눌러야 앱이 닫혀요. */
let exitAt=0;
function backStep(){if(lockOn())return false;
  if(S.mp){S.mp=null;mpRender();return true;}
  if(S.amenu||S.smOpen){S.amenu=false;S.smOpen=false;render();return true;}
  if(S.tab==='asset'&&S.av){S.av=null;render();return true;}
  if(S.tab==='asset'&&S.overview){S.overview=false;render();return true;}
  if(S.tab==='stat'&&S.statCat){S.statCat='';S.statSub='';render();return true;}
  if(S.tab==='more'&&S.moreView){S.moreView='';render();return true;}
  if(S.tab!=='list'){S.tab='list';try{localStorage.setItem('moneybook.tab','list');}catch(e){}window.scrollTo(0,0);render();return true;}
  if(S.sub!=='daily'){S.sub='daily';S.selDay='';try{localStorage.setItem('moneybook.sub','daily');}catch(e){}window.scrollTo(0,0);render();return true;}
  if(S.label!==curLabel()){goLabel(curLabel());return true;}
  return false;}
window.addEventListener('popstate',()=>{if(S.ignorePop){S.ignorePop=false;return;}
  if(S.histSheet){S.histSheet=false;if(S.sheet){S.sheet=null;$('#sheetRoot').innerHTML='';render();}return;}
  if(backStep()){try{history.pushState({mbGuard:1},'');}catch(e){}return;}
  // 첫 화면: 보초를 다시 깔지 않아요. 바로 한 번 더 누르면 휴대폰이 앱을 닫고, 그 사이 화면을 만지면 보초를 다시 깔아요
  exitAt=Date.now();S.guardOff=true;toast('뒤로 버튼을 한 번 더 누르면 닫혀요.');});
document.addEventListener('pointerdown',()=>{if(S.guardOff){S.guardOff=false;try{history.pushState({mbGuard:1},'');}catch(e){}}},true);
setInterval(()=>{if(S.guardOff&&Date.now()-exitAt>2500){S.guardOff=false;try{history.pushState({mbGuard:1},'');}catch(e){}}},1000);
try{if(!(history.state&&history.state.mbGuard))history.pushState({mbGuard:1},'');}catch(e){}
function renderSheet(){if(!S.sheet){closeSheet();return;}const fn=SHEETS[S.sheet];if(!fn)return;
  const sc=$('.sheet')?$('.sheet').scrollTop:0;
  const full=['tx','search','favorites','filter','accEdit'].includes(S.sheet);const sc2=$('.txb')?$('.txb').scrollTop:0;const sc3=$('.sres')?$('.sres').scrollTop:0;
  $('#sheetRoot').innerHTML=`<div class="ov ${full?'full':''}" data-act="ovClose"><div class="sheet ${full?'full':''}" role="dialog" aria-modal="true">${(full?'':'<div class="grab"></div>')+fn()}</div></div>`;
  const sh=$('.sheet');if(sh)sh.scrollTop=sc;const tb=$('.txb');if(tb)tb.scrollTop=sc2;const sr=$('.sres');if(sr)sr.scrollTop=sc3;}
function head(t,extra){return `<div class="sh-h"><h2>${t}</h2>${extra||''}<button class="x" data-act="close" aria-label="닫기">×</button></div>`;}
function accOptions(sel){return GRP().map(g=>{const a=S.settings.accounts.filter(x=>(x.group||'기타')===g&&((!x.hidden&&GVIS().includes(g))||x.id===sel));return a.length?`<optgroup label="${esc(gName(g))}">${a.map(x=>`<option value="${esc(x.id)}" ${x.id===sel?'selected':''}>${esc(x.name)}</option>`).join('')}</optgroup>`:'';}).join('');}
function recLabel(x){const f=x.freq||'monthly';if(f==='monthly')return '매월 '+(+String(x.start||'').slice(8)||x.day||1)+'일';if(f==='yearly')return '매년 '+(+String(x.start).slice(5,7))+'월 '+(+String(x.start).slice(8))+'일';if(['weekly','w2','w4'].includes(f))return FREQ[f]+' '+DOW[dowOf(x.start)]+'요일';return FREQ[f]||'반복';}
function catOptions(type,sel){return (S.settings.cats[type]||[]).map(c=>`<option ${c===sel?'selected':''}>${esc(c)}</option>`).join('');}

function lastAcc(){try{const a=localStorage.getItem('moneybook.acc');if(a&&S.settings.accounts.some(x=>x.id===a))return a;}catch(e){}const c=S.settings.accounts.find(a=>a.group==='카드');return (c||S.settings.accounts[0]||{}).id||'';}
function defaultDate(){if(S.tab==='list'&&S.sub==='cal'&&S.selDay)return S.selDay;const p=period(S.label);const t=today();return (t>=p.start&&t<p.end)?t:p.start;}
const nowHM=()=>{const n=new Date();return pad(n.getHours())+':'+pad(n.getMinutes());};
function openTx(t){if(t){S.form=Object.assign({},t,{tags:Array.isArray(t.tags)?t.tags.slice():[],tagPick:false,amountStr:String(t.amount),orig:t.id?{id:t.id,ym:t.date.slice(0,7)}:null,panel:''});}
  else S.form={type:'exp',amountStr:'',date:defaultDate(),cat:'',sub:'',acc:lastAcc(),to:'',memo:'',time:(S.settings.timeMode||'').startsWith('on')?nowHM():'',fav:false,panel:S.settings.inputOrder==='cat'?'cat':'amt',rep:'',inst:0,calcOn:false};
  S.sugOff=false;S.form.snap=S.form.orig?txSig(S.form):'';S.form.copyAsk=false;S.form.confirmDel=false;S.form.err='';S.form.subPick=false;openSheet('tx');if(S.settings.autoFill)ensureMonths(allMonths().slice().sort().slice(-12));}

function fmtExpr(s){return esc(String(s).replace(/,/g,'').replace(/\d+/g,m=>won(Number(m))).replace(/\*/g,'×').replace(/\//g,'÷').replace(/-/g,'−'));}
function addMonths(s,i){const [y,m,d]=s.split('-').map(Number);const b=new Date(y,m-1+i,1);const ym=b.getFullYear()+'-'+pad(b.getMonth()+1);return ym+'-'+pad(Math.min(d,daysIn(ym)));}
function kpHead(t,extra){return `<div class="kp-h"><span>${t}</span><span class="kp-r">${extra||''}<button data-act="panel" data-k="" aria-label="닫기">×</button></span></div>`;}
function panelHtml(f){const p=f.panel;
  if(p==='amt'||p==='fee'){const k=(v,l,c)=>`<button data-act="kp" data-k="${v}" class="${c||''}">${l||v}</button>`;
    return kpHead(p==='fee'?'수수료':'금액')+(f.calcOn?`<div class="kpg ops">${k('+','+','op')}${k('−','−','op')}${k('×','×','op')}${k('÷','÷','op')}</div>`:'')+
    `<div class="kpg">${k('1')}${k('2')}${k('3')}${k('back','⌫','op')}${k('4')}${k('5')}${k('6')}${k('−','−','op')}${k('7')}${k('8')}${k('9')}${k('calc','<svg viewBox="0 0 24 24" class="ic"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2"/></svg>','op '+(f.calcOn?'on':''))}${k('00')}${k('0')}${k('000')}${k('done','완료','done')}</div>`;}
  if(p==='cat'){if(f.subPick){const subs=subsOf(f.type,f.cat);return kpHead(esc(f.cat),`<button class="kp-l" data-act="subBack">‹ 분류</button>`)+`<div class="pg"><button data-act="pickSub" data-k="" class="${!f.sub?'on':''}">없음</button>${subs.map(s=>`<button data-act="pickSub" data-k="${esc(s)}" class="${f.sub===s?'on':''}">${esc(s)}</button>`).join('')}</div>`;}
    const cats=S.settings.cats[f.type]||[];return kpHead('분류',`<button class="kp-l" data-act="open" data-k="cats">편집</button>`)+`<div class="pg">${cats.map(c=>`<button data-act="pickCat" data-k="${esc(c)}" class="${f.cat===c?'on':''}">${esc(c)}${S.settings.subOn&&subsOf(f.type,c).length?'<small>›</small>':''}</button>`).join('')}</div>`;}
  if(p==='acc'||p==='to'){const sel=p==='acc'?f.acc:f.to;return kpHead(f.type==='trf'?(p==='acc'?'출금':'입금'):'자산',`<button class="kp-l" data-act="open" data-k="accList">편집</button>`)+
    `<div class="pg">${GRP().flatMap(g=>S.settings.accounts.filter(a=>(a.group||'기타')===g&&((!a.hidden&&GVIS().includes(g))||a.id===sel))).map(a=>`<button data-act="pickAcc" data-k="${esc(a.id)}" class="${sel===a.id?'on':''}">${esc(a.name)}<small>${esc(gName(a.group||''))}</small></button>`).join('')}</div>`;}
  if(p==='rep'){const opt=(v,l,on)=>`<button data-act="repSet" data-k="${v}" class="${on?'on':''}">${l}</button>`;
    if(f.repMode==='inst'){const v=f.instStr||'';return kpHead('할부',`<button class="kp-l" data-act="repMode" data-k="">‹ 반복</button>`)+`<div class="instv num">${v?esc(v)+' 개월':'<span class="ph">할부 입력 (개월수)</span>'}</div><div class="kpg">${[1,2,3,'back',4,5,6,'C',7,8,9,'',' ',0,' ','ok'].map(k=>k==='back'?`<button data-act="instKey" data-k="back" class="op">⌫</button>`:k==='C'?`<button data-act="instKey" data-k="C" class="op">C</button>`:k==='ok'?`<button data-act="instKey" data-k="ok" class="done">저장</button>`:String(k).trim()===''?'<span class="kpx"></span>':`<button data-act="instKey" data-k="${k}">${k}</button>`).join('')}</div>`;}
    return kpHead('반복 / 할부',`<button class="kp-l" data-act="repMode" data-k="inst">할부 ›</button>`)+`<div class="pg">${opt('none','없음',!f.rep&&!(f.inst>1))}${Object.keys(FREQ).map(k=>opt(k,FREQ[k],f.rep===k)).join('')}</div>${f.inst>1?`<p class="muted" style="padding:6px 16px;margin:0">${f.inst}개월 할부로 적혀요</p>`:''}`;}
  return '';}

// 검색 결과만 다시 그려요. 검색창은 건드리지 않아서 한글 조합(ㄱ+ㅏ→가)이 끊기지 않아요.
function searchResults(){const q=S.search.trim();const ms=allMonths();const loading=ms.some(ym=>!S.live[ym]&&!S.cache[ym]);
  if(loading)return '<div class="empty">전체 내역을 불러오는 중…</div>';if(!q)return '<div class="empty">검색어를 입력하세요</div>';
  const words=q.normalize('NFC').toLowerCase().replace(/,/g,'').split(/\s+/).filter(Boolean);
  const hay=t=>[(t.tags||[]).map(g=>'#'+g).join(' '),t.memo,t.note,t.cat,t.sub,accName(t.acc),t.to?accName(t.to):'',String(t.amount),won(t.amount),t.date].join(' ').normalize('NFC').toLowerCase().replace(/,/g,'');
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
const accGrouped=(fn)=>GRP().map(g=>{const l=S.settings.accounts.filter(a=>(a.group||'기타')===g);return l.length?`<div class="agh">${esc(gName(g))}</div>`+l.map(fn).join(''):'';}).join('');
const TRASH='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
const EYE='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYEX='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const SHEETS={
 accEdit(){const d=S.accEd;const isNew=!d.id;const g=d.group;
  const sms=['은행','카드','체크카드','선불식카드','마이너스 통장'].includes(g);const amt=g!=='체크카드';const pay=g==='카드'||g==='체크카드';
  const row=(lab,inner,cls)=>`<div class="frow ae ${cls||''}"><span class="fl">${lab}</span>${inner}</div>`;
  const inp=(id,v,ph,extra)=>`<input class="fv" id="${id}" value="${esc(v||'')}" placeholder="${ph||''}" autocomplete="off" ${extra||''}>`;
  const days=(id,v)=>`<select class="fv" id="${id}">${Array.from({length:31},(_,i)=>`<option value="${i+1}" ${+v===i+1?'selected':''}>${i===30?'말일':(i+1)+' 일'}</option>`).join('')}</select>`;
  let h=`<div class="txb aeb"><div class="txh"><button class="x" data-act="close" aria-label="닫기">←</button><h2>${isNew?'자산추가':'자산정보'}</h2>${isNew?'':`<button class="x hx ${S.aeDelAsk?'danger-on':''}" data-act="aeDel" aria-label="삭제">${S.aeDelAsk?'<b style="font-size:14px;color:var(--exp)">삭제?</b>':TRASH}</button>`}</div><div class="aebody">`;
  h+=row('그룹',`<button class="fv" data-act="aeGroupOpen">${esc(gName(g))}</button>`);
  h+=row('이름',inp('ae-name',d.name,'','maxlength="30"'));
  if(amt){const bv=isNew?(Number(d.init)||0):(d.bal!=null?d.bal:(accBalances()[d.id]||0));h+=row('금액',inp('ae-init',bv?(bv<0?'-':'')+won(Math.abs(bv)):'','0원','inputmode="text"')+`<span class="wonb">원</span>`,'amt');if(!isNew)h+=`<p class="aenote" style="margin-top:4px">지금 잔액이에요. 바꾸면 그 차이만큼 시작 잔액이 맞춰져요.</p>`;}
  if(g==='마이너스 통장'||g==='대출')h+=`<p class="aenote">${g}을 입력하실 때에는 금액에 '-' 를 함께 입력하셔야 부채에 합산돼요. '-' 가 없으면 자산에 합산돼요.</p>`;
  if(pay)h+=row('결제',`<select class="fv" id="ae-pay"><option value="">선택 안 함</option>${S.settings.accounts.filter(a=>['은행','마이너스 통장','현금','저축'].includes(a.group)&&a.id!==d.id).map(a=>`<option value="${esc(a.id)}" ${a.id===d.pay?'selected':''}>${esc(a.name)}</option>`).join('')}</select>`);
  h+=row('메모',inp('ae-memo',d.memo,'','maxlength="200"'));
  if(sms){h+=`<div class="aesep"></div>`+row('전화번호',inp('ae-phone',d.phone,'문자 보내는 번호','inputmode="tel"'))+row('<small>문자연결어</small>',inp('ae-key',d.smsKey,'예: 삼성1234'))+row('어플',inp('ae-app',d.app,'예: 삼성카드 앱'));
    h+=`<p class="aenote">문자 붙여넣기 할 때 이 번호나 연결어가 들어 있으면 이 자산으로 자동 선택돼요. 연결어는 쉼표(,)로 여러 개 적을 수 있어요.</p>`;}
  if(g==='카드'){h+=`<div class="aesep"></div>`+row('정산일',days('ae-cut',d.cutDay||1))+row('결제일',days('ae-payday',d.payDay||1));
    const cy=cardCycles({cutDay:d.cutDay||1,payDay:d.payDay||1});const f=x=>x.slice(5).replace('-','.');
    h+=`<div class="aecy"><div><span>결제예정금액</span><b class="num">${f(cy.prev.start)} ~ ${f(cy.prev.end)} (결제: ${f(cy.prev.pay)})</b></div><div><span>미결제금액</span><b class="num">${f(cy.cur.start)} ~ ${f(cy.cur.end)} (결제: ${f(cy.cur.pay)})</b></div></div>`;}
  if(!['카드','체크카드'].includes(g))h+=`<div class="aesep"></div><div class="frow ae"><span class="fl wide">총액반영 설정</span><label class="tgl"><input type="checkbox" id="ae-tot" ${d.inTotal!==false?'checked':''}><i></i></label></div><div class="frow ae"><span class="fl wide">표시/숨김 설정</span><button class="eyeb ${d.hidden?'off':''}" data-act="aeEye" aria-label="표시/숨김">${d.hidden?EYEX:EYE}</button></div>`;
  if(g==='체크카드')h+=`<p class="aenote">체크카드 그룹은 이월·누적되지 않고 이번 달 사용액만 보여줘요. 누적 금액은 연결된 은행 자산에서 볼 수 있어요. 금액 이월·누적을 원하면 그룹을 은행으로 정하세요.</p>`;
  h+=`<div class="acts"><button class="btn pri" data-act="aeSave">저장하기</button></div></div>`;
  if(S.aeGP)h+=`<div class="gdlg-ov" data-act="aeGroupClose"></div><div class="gdlg" role="dialog" aria-label="자산그룹"><h3>자산그룹</h3>${GVIS().map(x=>`<button data-act="aeGroup" data-k="${esc(x)}" class="${x===g?'on':''}">${esc(gName(x))}</button>`).join('')}</div>`;
  return h+'</div>';},
 memoEd(){const d=S.memoEd||{};return head(d.id?'메모 수정':'메모 쓰기')+`<div class="f"><label for="me-date">날짜</label><input class="in-t" type="date" id="me-date" value="${esc(d.date||today())}"></div>
  <div class="f"><label for="me-text">내용</label><textarea class="in-t" id="me-text" style="min-height:200px" placeholder="기억할 것을 적어두세요">${esc(d.text||'')}</textarea></div>
  <div class="acts">${d.id?'<button class="btn danger" data-act="memoPut" data-k="del">삭제</button>':''}<button class="btn pri" data-act="memoPut">저장</button></div>`;},
 trfExp(){const sel=new Set(S.settings.trfExp||[]);return head('이체지출 설정')+`<p class="muted" style="margin:0 0 10px;font-size:14px">여기 고른 자산으로 보낸 '이체'는 지출로 셈해요. 적금·보험·저축처럼 통장에서 빠져나가지만 쓴 돈으로 보고 싶을 때 쓰세요. 통계에는 "자산이름(이체)"로 나와요.</p><div class="alist">${accGrouped(a=>`<label class="ali"><span>${esc(a.name)}</span><input type="checkbox" data-te="${esc(a.id)}" ${sel.has(a.id)?'checked':''}></label>`)}</div><div class="acts"><button class="btn pri" data-act="teSave">저장</button></div>`;},
 accList(){return head('자산설정',`<button class="x" data-act="accNew" aria-label="자산 추가" style="font-size:28px">+</button>`)+`<div class="alist">${accGrouped(a=>`<button class="ali" data-act="accOpen" data-k="${esc(a.id)}"><span class="${a.hidden?'muted':''}">${esc(a.name)}${a.hidden?' <small>(숨김)</small>':''}</span><i class="chev">›</i></button>`)}</div>`;},
 groups(){const o=GRP();const hid=new Set(S.settings.groupHidden||[]);const vis=o.filter(g=>!hid.has(g));const sel=S.grpSel;const cnt=g=>S.settings.accounts.filter(a=>a.group===g).length;const ed=S.grpEd;
  const COIN='<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.4"><ellipse cx="9" cy="8" rx="6" ry="2.5"/><path d="M3 8v3c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V8M3 11v3c0 1.4 2.7 2.5 6 2.5"/><ellipse cx="15" cy="13" rx="6" ry="2.5"/><path d="M9 13v3c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-3"/></svg>';
  return head('자산그룹',`<span class="ordbtn"><button class="x" data-act="gMove" data-k="-1" ${sel?'':'disabled'} aria-label="위로">▲</button><button class="x" data-act="gMove" data-k="1" ${sel?'':'disabled'} aria-label="아래로">▼</button><button class="x" data-act="gAdd" aria-label="그룹 추가">+</button></span>`)+
  `<p class="muted" style="margin:0 0 10px;font-size:14px">이름 줄을 누르고 ▲▼로 순서를 바꿔요. 연필로 이름을 바꾸고, 빨간 − 로 그룹을 지워요(자산이 들어 있으면 못 지워요). 현금·은행·카드·체크카드는 기본 그룹이라 지울 수 없어요.</p>
  ${ed?`<div class="card gedit"><input class="in-t" id="g-name" value="${esc(ed.name)}" maxlength="20" placeholder="그룹 이름"><button class="btn sm" data-act="gEdCancel">취소</button><button class="btn pri sm" data-act="gEdSave">저장</button></div>`:''}
  <div class="alist">${vis.map(g=>`<div class="ali grow ${sel===g?'sel':''}">${CORE_G.includes(g)?`<span class="gi2">${COIN}</span>`:`<button class="minus" data-act="gDel" data-k="${esc(g)}" aria-label="${esc(gName(g))} 지우기">−</button>`}<button class="gsel" data-act="gSel" data-k="${esc(g)}"><span>${esc(gName(g))}${gName(g)!==g&&GROUPS.includes(g)?`<small class="muted" style="display:block;font-size:12px">${esc(g)}</small>`:''}</span><small class="muted">${cnt(g)}개</small>${sel===g?'<i class="chk">✓</i>':''}</button><button class="eye" data-act="gEdit" data-k="${esc(g)}" aria-label="이름 바꾸기">${HICON.pen.replace('<svg ','<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" ')}</button></div>`).join('')}</div>
  ${hid.size?`<div class="agh" style="margin-top:14px;background:none">삭제된 자산그룹</div><div class="alist">${[...hid].map(g=>`<div class="ali"><span>${esc(gName(g))}</span><button class="btn sm" data-act="gRestore" data-k="${esc(g)}">되살리기</button></div>`).join('')}</div>`:''}`;},
 tags(){const all=allMonths().flatMap(txOf);const m=Object.create(null);for(const g of (S.settings.tags||[]))m['#'+g]={n:0,exp:0,inc:0,saved:true};for(const t of all){const tg=uniq(((t.memo||'')+' '+(t.note||'')).match(/#[^\s#,]+/g)||[]).concat((t.tags||[]).map(g=>'#'+g));for(const g of uniq(tg)){const o=m[g]=m[g]||{n:0,exp:0,inc:0};o.n++;const k=kindOf(t);if(k==='exp')o.exp+=t.amount;else if(k==='inc')o.inc+=t.amount;}}
  const ks=Object.keys(m).sort((a,b)=>m[b].n-m[a].n||a.localeCompare(b));return head('태그관리',`<button class="x" data-act="tagAddOpen" aria-label="태그 추가" style="font-size:28px">+</button>`)+`${S.tagAdd?`<div class="card gedit"><input class="in-t" id="tag-new" placeholder="태그 추가" maxlength="20"><button class="btn sm" data-act="tagAddCancel">취소</button><button class="btn pri sm" data-act="tagAddOk">확인</button></div>`:''}<p class="muted" style="margin:0 0 10px;font-size:14px">입력할 때 <b>+ 태그</b>로 붙이거나, 내용·메모에 <b>#여행</b>처럼 적어도 태그가 돼요. 누르면 그 태그 내역만 모아 봐요.</p>${ks.length?`<div class="alist">${ks.map(k=>`<div class="ali"><button class="gsel" data-act="tagGo" data-k="${esc(k)}"><span>${esc(k)}</span><small class="num muted">${m[k].n}건${m[k].exp?' · 지출 '+won(m[k].exp)+'원':''}</small></button>${m[k].saved?`<button class="eye" data-act="tagDel" data-k="${esc(k.slice(1))}" aria-label="태그 지우기">×</button>`:''}</div>`).join('')}</div>`:`<div class="empty nodata"><span>데이터가 없습니다.</span></div>`}`;},
 choice(){const c=S.choice;return head(c.title)+`${c.note?`<p class="muted" style="margin:0 0 10px;font-size:14px">${c.note}</p>`:''}<div class="alist">${c.opts.map(([v,n])=>`<button class="ali" data-act="choicePick" data-k="${esc(String(v))}"><span>${n}</span>${String(S.settings[c.key])===String(v)?'<i class="chk">✓</i>':''}</button>`).join('')}</div>`;},
 accDeleted(){const d=S.settings.deleted||[];return head('삭제된 자산')+(d.length?`<p class="muted" style="margin:0 0 10px;font-size:14px">되살리면 원래 그룹 맨 끝에 다시 생기고, 그 자산으로 적은 내역도 그대로 이어져요.</p><div class="alist">${d.map(a=>`<div class="ali"><span>${esc(a.name)}<small class="muted" style="display:block;font-size:12px">${esc(gName(a.group))}</small></span><button class="btn sm" data-act="aRestore" data-k="${esc(a.id)}">되살리기</button></div>`).join('')}</div>`:'<div class="empty"><b>삭제된 자산이 없어요</b></div>');},
 cardPerf(){const l=S.settings.accounts.filter(a=>a.group==='카드');const B=[['prev','전월실적'],['avg3','3개월 평균']];
  return head('카드 이용실적')+`<div class="perfinfo">신용카드 실적기준(예: 전월, 3개월 평균)과 실적금액(예: 300,000)을 정해요.<br><br>1. 카드 실적은 1일부터 말일까지의 금액이에요.<br>2. 할부는 첫 달에 할부 총 금액이 실적으로 합산돼요.<br>3. 실적 금액을 비우면 그 카드는 실적을 보지 않아요.<p class="exp" style="margin:10px 0 0">※ 카드사마다 실적 정책이 달라서 티끌모아의 카드 실적은 참고용으로만 써 주세요.</p></div><div class="alist">${l.map(a=>`<div class="ali prow"><span>${esc(a.name)}</span><select class="in-t pb" data-pb="${esc(a.id)}">${B.map(([k,n])=>`<option value="${k}" ${a.perfBase===k?'selected':''}>${n}</option>`).join('')}</select><input class="in-t num perfin" data-perf="${esc(a.id)}" inputmode="numeric" value="${a.perf?won(a.perf):''}" placeholder="0"></div>`).join('')}</div><div class="acts"><button class="btn pri" data-act="perfSave">저장</button></div>`;},
 accHide(){return head('표시/숨김')+`<p class="muted" style="margin:0 0 10px;font-size:14px">눈을 끄면 자산 화면과 입력할 때 고르는 목록에서 숨겨요. 내역은 그대로 남아요.</p><div class="alist">${accGrouped(a=>`<button class="ali" data-act="aHide" data-k="${esc(a.id)}"><span class="${a.hidden?'muted':''}">${esc(a.name)}</span><i class="eye ${a.hidden?'off':''}">${a.hidden?EYEX:EYE}</i></button>`)}</div>`;},
 accDel(){const ask=S.accDelAsk;const cnt=ask?allMonths().flatMap(txOf).filter(t=>t.acc===ask||t.to===ask).length:0;
  return head('삭제')+`<div class="alist">${accGrouped(a=>`<div class="ali"><button class="minus" data-act="aDel" data-k="${esc(a.id)}" aria-label="${esc(a.name)} 삭제">−</button><span>${esc(a.name)}</span>${ask===a.id?`<button class="btn danger sm" data-act="aDelOk" data-k="${esc(a.id)}">삭제</button>`:''}</div>${ask===a.id?`<div class="adwarn">${cnt?`이 자산으로 적은 내역 ${cnt}건은 그대로 남아요. 삭제한 자산은 설정관리 › 삭제된 자산에서 되살릴 수 있어요.`:'이 자산으로 적은 내역이 없어요.'}</div>`:''}`)}</div>`;},
 accOrder(){const sel=S.accSel;return head('순서 변경',`<span class="ordbtn"><button class="x" data-act="aMove" data-k="-1" aria-label="위로" ${sel?'':'disabled'}>▲</button><button class="x" data-act="aMove" data-k="1" aria-label="아래로" ${sel?'':'disabled'}>▼</button></span>`)+`<p class="muted" style="margin:0 0 10px;font-size:14px">옮길 자산을 누르고 ▲▼로 움직여요. 같은 그룹 안에서 움직여요.</p><div class="alist">${accGrouped(a=>`<button class="ali ${sel===a.id?'sel':''}" data-act="aSel" data-k="${esc(a.id)}"><span>${esc(a.name)}</span>${sel===a.id?'<i class="chk">✓</i>':''}</button>`)}</div>`;},
 tx(){const f=S.form;const edit=!!f.orig;const val=calc(f.amountStr);const ops=/[+\-*/×÷−]/.test(f.amountStr.replace(/^-/,''));
  const [yy,mm,dd]=f.date.split('-');const dl=esc(`${yy}. ${mm}. ${dd} (${DOW[dowOf(f.date)]||''})`);
  const catTxt=f.cat?esc(f.cat)+(f.sub?' <span class="muted">› '+esc(f.sub)+'</span>':''):'';
  const frow=(lab,k,txt)=>`<div class="frow ${f.panel===k?'act':''}"><span class="fl">${lab}</span><button class="fv" data-act="panel" data-k="${k}">${txt||'<span class="ph">선택</span>'}</button></div>`;
  let h=`<div class="txb t-${okType(f.type)}"><div class="txh"><button class="x" data-act="close" aria-label="닫기">←</button><h2>${edit?'내역 수정':TYPE_NAME[f.type]}</h2>
    ${edit?'':`<button class="x hx" data-act="open" data-k="sms" aria-label="문자 붙여넣기">${HICON.sms}</button><button class="x hx" data-act="txFav" aria-label="자주 쓰는 내역">${HICON.fav}</button>`}</div>
  <div class="tseg">${['inc','exp','trf'].map(k=>`<button data-act="ftype" data-k="${k}" class="${f.type===k?'on '+k:''}">${TYPE_NAME[k]}</button>`).join('')}</div>
  <div class="frow"><span class="fl">날짜</span><label class="fv date num"><span>${dl}</span><input type="date" id="f-date" value="${esc(f.date)}" aria-label="날짜"></label>
    ${edit?'':`<button class="repb ${f.inst>1||f.rep?'on':''}" data-act="panel" data-k="rep"><svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4"/></svg><small>${f.inst>1?f.inst+'개월 할부':f.rep&&FREQ[f.rep]?FREQ[f.rep]+' 반복':'반복/할부'}</small></button>`}</div>
  <div class="frow ${f.panel==='amt'?'act':''}"><span class="fl">금액</span><button class="fv amtv num" data-act="panel" data-k="amt">${f.amountStr?(f.fresh==='amt'?'<span class="selv">':'<span>')+fmtExpr(f.amountStr)+'</span>'+(ops&&!isNaN(val)?` <small>= ${won(val)}원</small>`:'원'):'<span class="ph">&nbsp;</span>'}</button>${f.type==='trf'?`<button class="feeb num ${f.panel==='fee'||calc(f.feeStr||'')>0?'on':''}" data-act="panel" data-k="fee">${calc(f.feeStr||'')>0?'수수료 '+won(calc(f.feeStr)):'수수료'}</button>`:''}</div>
  ${f.type==='trf'?`<div class="swapw">${frow('출금','acc',f.acc?esc(accName(f.acc)):'')+frow('입금','to',f.to?esc(accName(f.to)):'')}<button class="swapb" data-act="swapAcc" aria-label="출금과 입금 바꾸기">↓↑</button></div>`:frow('분류','cat',catTxt)+frow('자산','acc',f.acc?esc(accName(f.acc)):'')}
  ${(S.settings.timeMode||'').startsWith('on')?`<div class="frow"><span class="fl">시간</span><input class="fv num" type="time" id="f-time" value="${esc((f.time||'').slice(0,5))}" aria-label="시간"></div>`:''}
  <div class="frow sugw"><span class="fl">내용</span><input class="fv" id="f-memo" placeholder="" value="${esc(f.memo)}" autocomplete="off" data-act="memoFocus"></div><div id="f-sug" class="sug" hidden></div>
  <div class="frow"><span class="fl">메모</span><input class="fv" id="f-note" placeholder="가게 이름 등" value="${esc(f.note||'')}" autocomplete="off" data-act="memoFocus"></div>
  <div class="tagrow">${(f.tags||[]).map(g=>`<button class="tagc on" data-act="tagTog" data-k="${esc(g)}">#${esc(g)} ×</button>`).join('')}<button class="tagc" data-act="tagPick">+ 태그</button></div>${f.tagPick?`<div class="tagpick">${(S.settings.tags||[]).filter(g=>!(f.tags||[]).includes(g)).map(g=>`<button class="tagc" data-act="tagTog" data-k="${esc(g)}">#${esc(g)}</button>`).join('')}<span class="tagnew"><input class="in-t" id="f-tagnew" placeholder="새 태그" maxlength="20"><button class="btn sm" data-act="tagNewF">추가</button></span></div>`:''}
  ${edit?'':`<label class="chk"><input type="checkbox" id="f-fav" ${f.fav?'checked':''}> 자주 쓰는 내역에 추가</label>`}
  <div class="err" id="f-err">${esc(f.err)}</div>
  ${f.panel?'':`${edit?`<div class="acts" id="f-save" ${txDirty(f)?'':'hidden'}><button class="btn pri" data-act="saveTx">저장하기</button></div><div class="acts acts3" id="f-tools" ${txDirty(f)?'hidden':''}><button class="btn danger ${f.confirmDel?'go':''}" data-act="delTx"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>${f.confirmDel?'정말 삭제':'삭제'}</button><button class="btn" data-act="txCopy"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>복사</button><button class="btn" data-act="txFavAdd"><svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>자주사용</button></div>${f.copyAsk?`<div class="cpov" data-act="copyX"></div><div class="cpw"><div class="cpbox" role="dialog"><b>복사하기</b><button class="${f.copyMode==='today'?'on':''}" data-act="copyMode" data-k="today">오늘 날짜로 복사${f.copyMode==='today'?'<i>✓</i>':''}</button><button class="${f.copyMode!=='today'?'on':''}" data-act="copyMode" data-k="orig">작성한 날짜로 복사${f.copyMode!=='today'?'<i>✓</i>':''}</button></div><button class="cpok" data-act="copyGo">확인</button></div>`:''}`:`<div class="acts"><button class="btn pri" data-act="saveTx">저장하기</button><button class="btn cont" data-act="saveTx" data-k="more">계속</button></div>`}`}</div>`;
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

 budget(){const b=S.settings.budget||{total:0,cats:{}};const rows=[];if(b.total)rows.push(['',b.total]);for(const c of Object.keys(b.cats||{}))if(b.cats[c]>0)rows.push([c,b.cats[c]]);
  return head('예산설정',`<button class="x" data-act="budNew" aria-label="예산 추가" style="font-size:28px">+</button>`)+`<div class="budinfo"><span class="bi">✎</span><span>추가된 예산은 <b>가계부탭 - 결산</b>에서 확인하실 수 있어요.</span></div>${rows.length?`<div class="alist">${rows.map(([c,v])=>`<button class="ali" data-act="budEdit" data-k="${esc(c)}"><span>${c?esc(c):'전체'}</span><b class="num">${won(v)}원</b></button>`).join('')}</div>`:''}`;},
 budEd(){const d=S.budEd;return head(d.isNew?'예산추가':'예산수정')+`<div class="frow ae"><span class="fl">분류</span><select class="fv" id="bd-cat" ${d.isNew?'':'disabled'}><option value="" ${!d.cat?'selected':''}>전체</option>${S.settings.cats.exp.map(c=>`<option ${c===d.cat?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
  <div class="frow ae"><span class="fl">금액</span><input class="fv num" id="bd-amt" inputmode="numeric" value="${d.amt?won(d.amt):''}" placeholder=""></div>
  <div class="acts" style="margin-top:18px">${d.isNew?'':'<button class="btn danger" data-act="budDel">삭제</button>'}<button class="btn pri" data-act="budSave">저장하기</button></div>`;},

 cats(){const t=S.catType;const list=S.settings.cats[t];const on=S.settings.subOn!==false;const sel=S.catSel;
  return head(t==='inc'?'수입분류':'지출분류',`<span class="ordbtn"><button class="x" data-act="catMv" data-k="-1" ${sel!=null&&sel>=0?'':'disabled'} aria-label="위로">▲</button><button class="x" data-act="catMv" data-k="1" ${sel!=null&&sel>=0?'':'disabled'} aria-label="아래로">▼</button><button class="x" data-act="catNew" aria-label="분류 추가">+</button></span>`)+
  `<div class="frow ae swrow"><span class="fl wide">소분류 기능</span><label class="tgl"><input type="checkbox" data-act="subToggle" ${on?'checked':''}><i></i></label></div>
  <div class="alist" style="margin-top:10px">${list.map((c,i)=>{const subs=subsOf(t,c);return `<div class="ali grow ${sel===i?'sel':''}"><button class="minus ${S.catDelAsk===i?'ask':''}" data-act="catDel" data-i="${i}" aria-label="${esc(c)} 지우기">${S.catDelAsk===i?'삭제':'−'}</button><button class="gsel" data-act="catSel" data-i="${i}"><span>${esc(c)}${on&&subs.length?' ('+subs.length+')':''}${on&&subs.length?`<small class="muted" style="display:block;font-size:12px">${esc(subs.join(', '))}</small>`:''}</span>${sel===i?'<i class="chk">✓</i>':''}</button><button class="eye" data-act="catEdOpen" data-i="${i}" aria-label="고치기">${HICON.pen.replace('<svg ','<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" ')}</button></div>`;}).join('')}</div>
  <p style="font-size:12px;color:var(--muted)">분류 이름을 바꾸거나 지워도 이미 적은 내역은 예전 이름 그대로 남아요. 줄을 누르고 ▲▼로 순서를 바꿔요.</p>`;},
 catEd(){const d=S.catEd;return head(d.i<0?(d.type==='inc'?'수입분류 추가':'지출분류 추가'):'분류 고치기')+`<div class="frow ae"><span class="fl">이름</span><input class="fv" id="ce-name" value="${esc(d.name)}" maxlength="20"></div>
  ${S.settings.subOn!==false?`<div class="f"><span class="lbl">소분류</span><div class="chips">${d.subs.map((x,j)=>`<span class="chip">${esc(x)}<button class="del" data-act="ceSubDel" data-j="${j}" aria-label="${esc(x)} 지우기">×</button></span>`).join('')||'<span style="color:var(--muted);font-size:14px">없음</span>'}</div><div style="display:flex;gap:8px;margin-top:8px"><input class="in-t" id="ce-sub" placeholder="새 소분류" maxlength="20"><button class="btn" style="flex:0 0 80px" data-act="ceSubAdd">추가</button></div></div>`:''}
  <div class="acts" style="margin-top:18px"><button class="btn pri" data-act="ceSave">저장하기</button></div>`;},

 accounts(){const d=S.accDraft;return head('계좌·카드')+`<p style="margin:0;font-size:14px;color:var(--muted)">시작 잔액에는 가계부를 처음 쓰는 날의 잔액을 적으세요. 대출은 마이너스로 적으면 돼요.</p>
  <div class="lst" style="margin-top:12px">${d.map((a,i)=>`<div class="ar"><input class="in-t" data-acc="name" data-i="${i}" value="${esc(a.name)}" placeholder="이름" aria-label="이름"><select class="in-t" data-acc="group" data-i="${i}" aria-label="종류">${GROUPS.map(g=>`<option ${g===a.group?'selected':''}>${g}</option>`).join('')}</select>
   <div class="full"><input class="in-t num" data-acc="init" data-i="${i}" inputmode="numeric" value="${a.init?won(a.init):''}" placeholder="시작 잔액 0" aria-label="시작 잔액"><button class="mini btn" style="flex:0 0 64px;padding:8px" data-act="accDel" data-i="${i}">삭제</button></div></div>`).join('')}</div>
  <div class="acts"><button class="btn" data-act="accAdd">+ 계좌·카드 추가</button><button class="btn pri" data-act="saveAcc">저장</button></div>`;},

 recurring(){const r=S.recDraft;const list=S.settings.recurring||[];return head('반복 입력')+`<p style="margin:0;font-size:14px;color:var(--muted)">월세, 통신비, 적금처럼 주기적으로 나가는 돈을 등록하면 그날이 되어 가계부를 열 때 자동으로 적혀요.</p>
  ${list.length?`<div class="lst" style="margin-top:12px">${list.map((x,i)=>`<div class="li"><span class="g">${esc(x.memo||x.cat)}<small class="num">${esc(recLabel(x))} · ${TYPE_NAME[okType(x.type)]} ${won(x.amount)}원 · ${esc(accName(x.acc))}</small></span><button class="mini" data-act="recDel" data-i="${i}">삭제</button></div>`).join('')}</div>`:''}
  <div class="card" style="background:var(--bg);margin-top:14px"><h3>새 반복 내역</h3>
  <div class="seg">${['exp','inc','trf'].map(k=>`<button data-act="rtype" data-k="${k}" class="${r.type===k?'on '+k:''}">${TYPE_NAME[k]}</button>`).join('')}</div>
  <div class="two"><div class="f"><label for="r-freq">반복</label><select class="in-t" id="r-freq">${Object.keys(FREQ).map(k=>`<option value="${k}" ${(r.freq||'monthly')===k?'selected':''}>${FREQ[k]}</option>`).join('')}</select></div><div class="f"><label for="r-start">시작일</label><input class="in-t" type="date" id="r-start" value="${esc(r.start||today())}"></div></div><div class="two">
  <div class="f"><label for="r-amt">금액</label><input class="in-t num" id="r-amt" inputmode="numeric" value="${r.amount?won(r.amount):''}" placeholder="0"></div></div>
  ${r.type==='trf'?'':`<div class="f"><label for="r-cat">분류</label><select class="in-t" id="r-cat">${catOptions(r.type,r.cat)}</select></div>`}
  <div class="two"><div class="f"><label for="r-acc">${r.type==='trf'?'보내는 곳':'자산'}</label><select class="in-t" id="r-acc">${accOptions(r.acc)}</select></div>
  ${r.type==='trf'?`<div class="f"><label for="r-to">받는 곳</label><select class="in-t" id="r-to">${accOptions(r.to)}</select></div>`:'<div></div>'}</div>
  <div class="f"><label for="r-memo">내용</label><input class="in-t" id="r-memo" value="${esc(r.memo)}" placeholder="예: 휴대폰 요금"></div>
  <label class="chk"><input type="checkbox" id="r-now" ${r.now?'checked':''}> 시작일이 지났으면 지난 것도 모두 입력</label>
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
  if(tab==='acc'){items=GRP().map(g=>{const a=S.settings.accounts.filter(x=>(x.group||'기타')===g);return a.length?`<div class="fgh">${esc(gName(g))}</div>${a.map(x=>chk('acc',x.id,x.name)).join('')}`:'';}).join('');}
  else items=(S.settings.cats[tab]||[]).map(c=>chk(tab,c,c)).join('');
  const allKeys=tab==='acc'?S.settings.accounts.map(a=>a.id):(S.settings.cats[tab]||[]);const allOn=allKeys.length&&allKeys.every(k=>F[tab].includes(k));
  return `<div class="txb fl0"><div class="txh"><button class="x" data-act="close" aria-label="닫기">←</button><div class="lnav" style="flex:1"><button data-act="prev" aria-label="이전 달">‹</button><b>${y}년 ${+m}월</b><button data-act="next" aria-label="다음 달">›</button></div><button class="link" data-act="fReset">초기화</button></div>
  <div class="fbar">필터링 할 항목을 선택하세요.${filterOn()?' 선택한 항목만 보여요.':' 아무것도 고르지 않으면 전체가 보여요.'}</div>
  <div class="rings">${ring(pI,'var(--inc)','color-mix(in srgb, var(--inc) 22%, transparent)','수입',tv.inc)}${ring(pE,'var(--exp)','color-mix(in srgb, var(--exp) 22%, transparent)','지출',tv.exp)}<div class="ring"><span class="muted">합계</span><b class="num" style="font-size:20px;margin-top:30px">${tv.net<0?'-':''}${won(Math.abs(tv.net))}원</b></div></div>
  <div class="stabs ftabs">${[['inc','수입'],['exp','지출'],['acc','자산']].map(([k,n])=>`<button data-act="fTab" data-k="${k}" class="${tab===k?'on':''}">${n}${F[k].length?' <small>'+F[k].length+'</small>':''}</button>`).join('')}</div></div>
  <div class="sres"><label class="fck fall"><input type="checkbox" data-fg="all" ${allOn?'checked':''}><span>전체</span></label>${items}</div>
  <div class="kp" style="padding:10px max(16px,env(safe-area-inset-left,0px)) calc(10px + env(safe-area-inset-bottom,0px));display:flex;gap:8px"><button class="btn pri" data-act="close">적용</button></div>`;},

 pin(){const d=S.pinDraft;const st=S.settings;
  if(S.patDraft){const pd=S.patDraft;return head('패턴 설정')+`<div class="pinbox"><div class="pin-step"><span class="${pd.step===1?'on':''}">1</span><i></i><span class="${pd.step===2?'on':''}">2</span></div><b class="pin-t">${pd.step===1?'새 패턴을 그려 주세요':'한 번 더 그려 주세요'}</b><span class="pin-s">점을 4개 이상 이어서 그려요.</span><div class="err pin-e">${esc(pd.err||'')}</div>${patPadHtml('set')}<button class="btn" data-act="patCancel" style="margin-top:10px">취소</button></div>`;}
  if(d){return head('비밀번호 잠금')+`<div class="pinbox"><img src="logo-mark.svg" alt="" width="56" height="56"><div class="pin-step"><span class="${d.step===1?'on':''}">1</span><i></i><span class="${d.step===2?'on':''}">2</span></div>
    <b class="pin-t">${d.step===1?'새 비밀번호 4자리':'한 번 더 입력해 주세요'}</b><span class="pin-s">${d.step===1?'가계부를 열 때 쓸 번호예요':'확인을 위해 같은 번호를 눌러 주세요'}</span>
    ${dotsHtml(d.cur.length,!!d.err)}<div class="err pin-e">${esc(d.err||'')}</div>${padHtml()}</div>`;}
  return head('비밀번호 잠금')+`<p style="margin:0;font-size:14px;color:var(--muted)">가계부를 열 때 4자리 비밀번호를 물어봐요. 모든 휴대폰에 똑같이 적용돼요.</p>${st.pin?`<div class="card bioc"><div><b>패턴으로 열기</b><small class="muted">${st.pat?'켜져 있어요. 잠금 화면에서 \'패턴\'을 고르면 그린 패턴으로 열려요. 모든 휴대폰에 똑같이 적용돼요.':'티끌모아 전용 패턴(3×3 점)을 정해 두면 잠금 화면에서 패턴만 그려서 열 수 있어요.'}</small></div><span class="bioc-b">${st.pat?'<button class="btn sm" data-act="patStart">바꾸기</button><button class="btn sm" data-act="patOff">끄기</button>':'<button class="btn pri sm" data-act="patStart">켜기</button>'}</span></div>`:''}${st.pin?`<div class="card bioc"><div><b>지문으로 열기</b><small class="muted">${bioGet()?'이 기기에서 켜져 있어요. 잠금 화면에서 \'지문\'을 고르면 지문으로 열려요.':S.bioOk===false?'이 기기(브라우저)는 지문 확인을 지원하지 않아요.':'이 기기에서만 켜져요. 기기마다 한 번씩 켜 주세요.'}</small></div>${S.bioOk===false?'':`<button class="btn ${bioGet()?'':'pri'} sm" data-act="${bioGet()?'bioOff':'bioOn'}">${bioGet()?'끄기':'켜기'}</button>`}</div>`:''}
  ${st.pin?`<div class="f"><label for="lockMin">다시 잠그기</label><select class="in-t" id="lockMin">${[[0,'화면을 벗어나면 바로'],[1,'1분 뒤'],[5,'5분 뒤'],[30,'30분 뒤']].map(([v,n])=>`<option value="${v}" ${(st.lockMin??0)===v?'selected':''}>${n}</option>`).join('')}</select></div>
  <div class="acts"><button class="btn danger" data-act="pinOff">잠금 끄기</button><button class="btn" data-act="pinStart">비밀번호 바꾸기</button></div>`:
  `<div class="acts"><button class="btn pri" data-act="pinStart">비밀번호 설정</button></div>`}`;},
install(){const ios=isIOS();const pc=isPC();return head('앱으로 설치')+`<div style="text-align:center;margin:4px 0 14px"><img src="logo.png" alt="티끌모아" style="width:100%;max-width:320px;border-radius:12px"></div>
  ${pc?`<ol class="steps"><li><b>크롬</b>이나 <b>엣지</b>로 이 주소를 열어주세요.</li><li>주소창 오른쪽 끝의 <b>설치 아이콘</b>(모니터에 화살표)을 누르세요. 안 보이면 메뉴 ⋮ → <b>저장 및 공유 → 페이지를 앱으로 설치</b> (엣지는 … → <b>앱 → 이 사이트를 앱으로 설치</b>)</li><li><b>설치</b>를 누르면 바탕화면과 시작 메뉴에 티끌모아가 생겨요.</li></ol>`:ios?`<ol class="steps"><li><b>사파리</b>로 이 주소를 열어주세요.</li><li>아래쪽 <b>공유 버튼</b>(네모에 화살표)을 누르세요.</li><li><b>홈 화면에 추가</b>를 누르고 <b>추가</b>를 누르면 끝이에요.</li></ol>`:
  `<ol class="steps"><li><b>크롬</b>이나 <b>삼성 인터넷</b>으로 이 주소를 열어주세요.</li><li>오른쪽 위(삼성 인터넷은 아래) <b>메뉴 ⋮ / ≡</b>를 누르세요.</li><li><b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누르면 끝이에요.</li></ol>`}
  <p class="muted">설치하면 주소창 없이 앱처럼 열리고, 기기마다 처음 한 번만 동기화 연결을 하면 돼요. 업데이트는 앱을 열 때 자동으로 받아요.</p>`;},
 mypage(){const u=S.user||{};const nk=S.settings.nickname||u.displayName||'';
  const row=(act,lab,v,extra)=>`<button data-act="${act}" ${extra||''}><span>${lab}</span><small class="sv2">${v||''}</small><i class="chev">›</i></button>`;
  return head('마이페이지')+`<div class="smg mp2">${S.nkEdit?`<div class="gedit card"><input class="in-t" id="nk-in" value="${esc(nk)}" maxlength="20" placeholder="닉네임"><button class="btn sm" data-act="nkCancel">취소</button><button class="btn pri sm" data-act="nkSave">저장</button></div>`:row('nkEdit','닉네임',esc(nk||'정하지 않음'))}
   <div class="acrow"><span>계정</span><span class="acv"><b>${esc(u.email||'')}</b><span class="gic">${GICON}</span></span></div></div>
   <div class="smg">${row('open','비밀번호 변경',S.settings.pin?'사용 중':'사용 안 함','data-k="pin"')}${row('open','동기화','','data-k="sync"')}${row('logout',S.ghOffAsk?'<b class="exp">한 번 더 누르면 로그아웃</b>':'로그아웃','')}</div>
   <p class="muted" style="font-size:12px;margin:4px 2px">로그아웃하면 이 기기에 저장된 가계부 사본도 지워져요. 다시 로그인하면 클라우드에서 그대로 불러와요.</p>`;},
 backup(){const it=(act,n,v,extra)=>`<button data-act="${act}" ${extra||''}><span>${n}</span><small class="sv">${v||''}</small></button>`;
  return head('백업/복원')+`<div class="smg">${it('info','장치에 백업/복원','','data-k="" data-open="sync"')}${it('bkShare','메일로 백업파일 내보내기')}${it('export','메일로 엑셀파일 내보내기','','data-k="all" data-share="1"')}${it('xlsIn','엑셀 파일 가져오기','편한가계부 엑셀')}${it('help','도움말(백업/복원)')}
   <div class="smh">초기화</div>${it('resetAsk','전체 초기화','','data-k="all"')}${it('resetAsk','가계부 내역만 초기화','','data-k="tx"')}</div><input type="file" id="xl-in" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
   ${S.xlInfo?`<div class="card" style="background:var(--bg)"><p class="muted" style="white-space:pre-line;margin:0 0 8px">${esc(S.xlInfo)}</p>${S.bkData&&S.bkData.source==='편한가계부 엑셀'?`<button class="btn danger ${S.bkAsk?'go':''} wide2" data-act="bkRestore">${S.bkAsk?'정말 넣기':'이 엑셀 내역 넣기'}</button>`:''}</div>`:''}
   ${S.resetMode?`<div class="card rsbox"><b>${S.resetMode==='all'?'전체 초기화':'가계부 내역만 초기화'}</b><p class="muted" style="margin:6px 0 10px">${S.resetMode==='all'?'모든 내역·메모·설정(계좌·분류·예산 등)을 지우고 처음 상태로 돌려요. 비밀번호는 남겨요.':'모든 가계부 내역을 지워요. 계좌·분류·설정은 그대로 남아요.'} 지우기 전에 백업 파일을 먼저 받아요. 되돌릴 수 없으니 확실하면 아래에 <b>초기화</b> 라고 적어 주세요.</p><input class="in-t" id="rs-in" placeholder="초기화" autocomplete="off"><div class="acts"><button class="btn" data-act="resetCancel">취소</button><button class="btn danger go" data-act="resetGo">지우기</button></div></div>`:''}`;},
 help(){return head('도움말 (백업/복원)')+`<div class="perfinfo" style="color:var(--ink)"><b>자동 저장</b><br>티끌모아는 입력하는 순간 구글 클라우드에 저장되고 다른 폰·PC에 바로 나타나요. 폰을 잃어버려도 같은 구글 계정으로 로그인하면 그대로 있어요.<br><br><b>장치에 백업/복원</b><br>장부 전체를 파일 하나(티끌모아_날짜.json)로 받아 두거나, 그 파일로 되돌려요. 되돌릴 때 이미 있는 내역은 겹치지 않게 합쳐요.<br><br><b>메일로 내보내기</b><br>휴대폰 공유창이 열리면 메일·카톡·드라이브 중 보낼 곳을 고르세요. PC에서는 파일로 받아져요.<br><br><b>엑셀 파일 가져오기</b><br>편한가계부에서 내보낸 엑셀(날짜·자산·분류·소분류·내용·금액·수입/지출·메모)을 그대로 넣을 수 있어요. 이미 있는 내역과 같은 건 건너뛰어요.<br><br><b>초기화</b><br>지우기 전에 백업 파일을 자동으로 먼저 받아요.</div>`;},
 sync(){const u=S.user||{};const t=GH.lastOk?new Date(GH.lastOk):null;return head('동기화')+`<div class="kv num"><div><span>로그인 계정</span><b>${esc(u.email||'-')}</b></div>
  <div><span>상태</span><b class="${GH.err?'exp':''}">${GH.err?'끊김':S.db&&S.db.pending()?'보내는 중':'정상'}</b></div><div><span>마지막 확인</span><b>${t?pad(t.getHours())+':'+pad(t.getMinutes())+':'+pad(t.getSeconds()):'-'}</b></div></div>
  ${GH.err?`<div class="err">${esc(GH.err)}</div>`:''}<p class="muted">입력하면 다른 폰·PC에 바로 나타나요. 인터넷이 끊겨도 이 기기에 먼저 저장하고, 연결되면 자동으로 보내요.</p>
  <div class="card" style="background:var(--bg);margin-top:14px"><h3>백업 파일</h3><p class="muted" style="margin:0 0 8px">전체 장부를 파일 하나로 받아 보관하거나, 그 파일로 되돌릴 수 있어요. 한 달에 한 번쯤 받아두면 안심이에요.</p>
  <div class="acts" style="margin-top:6px"><button class="btn" data-act="bkFile">백업 파일 받기</button><label class="btn" for="bk-in" style="text-align:center;cursor:pointer">파일로 되돌리기</label></div><input type="file" id="bk-in" accept="application/json,.json" hidden>
  ${S.bkInfo?`<p class="muted">${esc(S.bkInfo)}</p>${S.bkData?`<button class="btn danger ${S.bkAsk?'go':''} wide2" data-act="bkRestore">${S.bkAsk?(S.bkData.merge?'정말 넣기':'정말 되돌리기'):(S.bkData.merge?'이 파일 내역 넣기':'이 파일로 되돌리기')}</button>`:''}`:''}</div>
  <div class="acts"><button class="btn danger ${S.ghOffAsk?'go':''}" data-act="logout">${S.ghOffAsk?'정말 로그아웃':'로그아웃'}</button></div>`;},
 monthStart(){const s=S.settings.monthStart||1;return head('월 시작일')+`<p style="margin:0;font-size:14px;color:var(--muted)">월급날에 맞춰 한 달을 계산하고 싶을 때 바꾸세요. 예를 들어 25일로 하면 ‘10월’은 10월 25일부터 11월 24일까지예요.</p>
  <div class="f"><label for="ms">시작일</label><select class="in-t" id="ms">${Array.from({length:28},(_,i)=>`<option value="${i+1}" ${s===i+1?'selected':''}>${i+1} 일</option>`).join('')}</select></div>
  <div class="f"><span class="lbl">월 시작일이 주말인 경우</span>${[['none','변경없음'],['fri','이전 금요일'],['mon','다음 월요일']].map(([k,n])=>`<label class="rad"><input type="radio" name="msw" value="${k}" ${(S.settings.msWeekend||'none')===k?'checked':''}><span>${n}</span></label>`).join('')}</div>
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
// 편한가계부 엑셀(날짜·자산·분류·소분류·내용·금액(원)·수입/지출·메모)을 티끌모아 가져오기 형식으로 바꿔요
function xlsToSnap(X,buf){const wb=X.read(buf,{type:'array',cellDates:false});const ws=wb.Sheets[wb.SheetNames[0]];const rows=X.utils.sheet_to_json(ws,{header:1,raw:true,defval:''});
  const hi=rows.findIndex(r=>r.some(c=>String(c).trim()==='날짜'));if(hi<0)throw new Error('날짜 열이 없어요');const H=rows[hi].map(c=>String(c).trim());
  const col=(...ns)=>{for(const n of ns){const i=H.indexOf(n);if(i>=0)return i;}return -1;};
  const cD=col('날짜'),cA=col('자산'),cC=col('분류'),cS=col('소분류'),cM=col('내용'),cAm=col('금액(원)','KRW','금액'),cT=col('수입/지출','구분'),cN=col('메모');
  const byName=Object.create(null);for(const a of S.settings.accounts)byName[a.name]=a.id;const newAcc=[];
  const guess=n=>/체크/.test(n)?'체크카드':/카드/.test(n)?'카드':/페이|pay/i.test(n)?'선불식카드':/은행|뱅크|증권|통장/.test(n)?'은행':'현금';
  const accId=n=>{n=String(n||'').trim()||'현금';if(byName[n])return byName[n];const id='x'+newId();byName[n]=id;newAcc.push({id,name:n.slice(0,30),group:guess(n),init:0});return id;};
  const dt=v=>{if(v instanceof Date&&!isNaN(v))return [ymd(v),pad(v.getHours())+':'+pad(v.getMinutes())];if(typeof v==='number'){const sec=Math.round(v*86400);const d=X.SSF.parse_date_code(sec/86400);if(d)return [d.y+'-'+pad(d.m)+'-'+pad(d.d),pad(d.H||0)+':'+pad(d.M||0)];}
    const m=String(v).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?/);return m?[m[1]+'-'+pad(+m[2])+'-'+pad(+m[3]),m[4]!=null?pad(+m[4])+':'+m[5]:'']:[null,''];};
  const tx={};const cats={exp:new Set(),inc:new Set()};let k=0,skipped=0;const seen=Object.create(null);
  for(const r of rows.slice(hi+1)){const [d,tm]=dt(r[cD]);if(!d||!okDate(d))continue;const amt=Math.abs(Math.round(Number(String(r[cAm]).replace(/[^\d.-]/g,''))));if(!amt)continue;
    const ty=String(r[cT]||'').trim();let type=/수입/.test(ty)?'inc':/이체/.test(ty)?'trf':'exp';if(type==='trf'&&/입금/.test(ty)){skipped++;continue;}
    const cat=String(cS>=0?r[cC]:r[cC]||'').trim();const t={type,date:d,time:tm==='00:00'?'':tm,amount:amt,acc:accId(r[cA]),cat:type==='trf'?'':cat,sub:type==='trf'?'':String(cS>=0?r[cS]:'').trim(),to:type==='trf'?accId(cat):'',memo:String(cM>=0?r[cM]:'').trim().slice(0,200),note:String(cN>=0?r[cN]:'').trim().slice(0,200),src:'편한가계부',created:Date.now(),updated:Date.now()};
    if(type!=='trf'&&cat)cats[type].add(cat);const key=[t.type,t.date,t.time,t.amount,t.acc,t.memo].join('|');seen[key]=(seen[key]||0)+1;
    t.id='x'+(Math.abs([...key].reduce((h,c)=>(h*31+c.charCodeAt(0))|0,7))).toString(36)+'_'+seen[key];(tx[d.slice(0,7)]=tx[d.slice(0,7)]||[]).push(t);k++;}
  return {app:'moneybook',v:1,source:'편한가계부 엑셀',merge:{accounts:newAcc,cats:{exp:[...cats.exp],inc:[...cats.inc]}},tx,memo:[],skipped};}
async function shareFile(blob,name,title){// 메일·카톡 등으로 보내기 (휴대폰 공유창). 안 되면 파일로 받아요
  try{const f=new File([blob],name,{type:blob.type});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:title||name});return 'shared';}}catch(e){if(e&&e.name==='AbortError')return 'cancel';}
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);return 'saved';}
async function doExport(scope,share){if(S.exporting)return;S.exporting=true;toast('엑셀 파일을 만드는 중이에요');
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
    const name='티끌모아_'+stamp()+'.xlsx';if(share){const buf=X.write(wb,{bookType:'xlsx',type:'array',compression:true});const r=await shareFile(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),name,'티끌모아 엑셀');if(r!=='cancel')toast(r==='shared'?'보낼 곳을 고르세요':'내역 '+list.length+'건을 엑셀로 저장했어요');}else{X.writeFile(wb,name,{compression:true});toast('내역 '+list.length+'건을 엑셀로 저장했어요');}
  }catch(e){toast(String(e&&e.message||'').startsWith('load')?'일부 달을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.':'엑셀 파일을 만들지 못했어요');}finally{S.exporting=false;}}

/* ---------- actions ---------- */
function txSig(f){return JSON.stringify([f.type,f.date,calc(f.amountStr||''),f.cat||'',f.sub||'',f.acc||'',f.type==='trf'?f.to||'':'',(f.memo||'').trim(),(f.note||'').trim(),(f.time||'').slice(0,5),(f.tags||[]).join(',')]);}
function txDirty(f){return !!(f&&f.orig&&f.snap&&txSig(f)!==f.snap);}
function updDirty(){const f=S.form;if(!f||!f.orig)return;readForm();const b=document.getElementById('f-save');const d=txDirty(f);if(b)b.hidden=!d;const t=document.getElementById('f-tools');if(t)t.hidden=d;}
function readForm(){const f=S.form;if(!f)return;const g=id=>document.getElementById(id);
  if(g('f-amt'))f.amountStr=g('f-amt').value;if(g('f-date')&&okDate(g('f-date').value))f.date=g('f-date').value;if(g('f-acc'))f.acc=g('f-acc').value;
  if(g('f-to'))f.to=g('f-to').value;if(g('f-time'))f.time=g('f-time').value;if(g('f-memo'))f.memo=g('f-memo').value;if(g('f-note'))f.note=g('f-note').value;if(g('f-fav'))f.fav=g('f-fav').checked;}
function readRec(){const r=S.recDraft;if(!r)return;const g=id=>document.getElementById(id);
  if(g('r-freq'))r.freq=g('r-freq').value;if(g('r-start')&&okDate(g('r-start').value)){r.start=g('r-start').value;r.day=+r.start.slice(8);}if(g('r-amt'))r.amount=calc(g('r-amt').value)||0;if(g('r-cat'))r.cat=g('r-cat').value;if(g('r-acc'))r.acc=g('r-acc').value;if(g('r-to'))r.to=g('r-to').value;if(g('r-memo'))r.memo=g('r-memo').value;if(g('r-now'))r.now=g('r-now').checked;}
function readAcc(){document.querySelectorAll('[data-acc]').forEach(el=>{const a=S.accDraft[+el.dataset.i];const k=el.dataset.acc;a[k]=k==='init'?(calc(el.value)||0):el.value;});}

const ACT={
 tab(el){if(S.tab===el.dataset.k){S.av=null;S.moreView='';}S.tab=el.dataset.k;S.overview=false;S.amenu=false;S.smOpen=false;try{localStorage.setItem('moneybook.tab',S.tab);}catch(e){}if(S.tab==='asset'&&Date.now()-(S.fullAt||0)>300000){S.fullAt=Date.now();ensureMonths(allMonths(),true);};window.scrollTo(0,0);render();},
 prev(){S.label=shiftLabel(S.label,-1);S.selDay='';subscribePeriod();render();},
 next(){S.label=shiftLabel(S.label,1);S.selDay='';subscribePeriod();render();},
 addOn(el){const d=el.dataset.d;if(!okDate(d)||!S.canWrite)return;openTx(null);S.form.date=d;if(S.tab==='asset'&&S.av){const a=S.settings.accounts.find(x=>x.id===S.av.id);if(a)S.form.acc=a.id;}renderSheet();},
 add(){openTx(null);if(S.tab==='asset'&&S.av&&S.form){const a=S.settings.accounts.find(x=>x.id===S.av.id);if(a)S.form.acc=a.id;renderSheet();}},
 edit(el){const t=txOf(el.dataset.ym).find(x=>x.id===el.dataset.id);if(!t)return;if(!S.canWrite){toast('보기 전용이에요');return;}openTx(t);},
 pickDay(el){S.selDay=S.selDay===el.dataset.d?'':el.dataset.d;render();},
 stype(el){S.statType=el.dataset.k;render();},
 close(){closeSheet();},
 ovClose(el,e){if(e.target===el&&downOnOv===el)closeSheet();},
 ftype(el){readForm();const f=S.form;f.type=el.dataset.k;f.sub='';f.subPick=false;if(f.panel==='cat'&&f.type==='trf')f.panel='acc';if(f.type!=='trf'&&!(S.settings.cats[f.type]||[]).includes(f.cat))f.cat='';renderSheet();},
 fcat(el){readForm();if(S.form.cat!==el.dataset.k)S.form.sub='';S.form.cat=el.dataset.k;renderSheet();},
 panel(el){readForm();const k=el.dataset.k;const f=S.form;f.panel=(f.panel===k||!k)?'':k;f.fresh=(f.panel==='amt'&&f.amountStr)||(f.panel==='fee'&&f.feeStr)?f.panel:'';f.subPick=false;if(document.activeElement)document.activeElement.blur();renderSheet();},
 tagPick(){readForm();S.form.tagPick=!S.form.tagPick;S.form.panel='';renderSheet();},
 tagTog(el){readForm();const f=S.form;const g=el.dataset.k;const l=f.tags||[];f.tags=l.includes(g)?l.filter(x=>x!==g):l.concat(g);renderSheet();},
 tagNewF(){readForm();const v=((document.getElementById('f-tagnew')||{}).value||'').trim().replace(/^#/,'').slice(0,20);if(!v||BADK.has(v))return;const f=S.form;if(!(f.tags||[]).includes(v))f.tags=(f.tags||[]).concat(v);if(!(S.settings.tags||[]).includes(v))saveSettings({tags:(S.settings.tags||[]).concat(v)});renderSheet();},
 sugOffAll(){saveSettings({autoFill:false});ACT.sugClose();toast('자동 완성을 껐어요. 설정관리 › 내역 자동 완성에서 다시 켤 수 있어요.');},
 sugClose(){const b=document.getElementById('f-sug');if(b){b.hidden=true;b.innerHTML='';}S.sugOff=true;},
 sugPick(el){const t=(S._sug||[])[+el.dataset.i];if(!t||!S.form)return;readForm();const f=S.form;f.memo=t.memo;if(t.type==='trf'){f.acc=t.acc;f.to=t.to;}else{f.cat=t.cat||'';f.sub=t.sub||'';if(t.acc&&S.settings.accounts.some(a=>a.id===t.acc))f.acc=t.acc;}if(!f.amountStr)f.amountStr=String(t.amount);if(!f.note&&t.note)f.note=t.note;f.panel='';renderSheet();},
 memoFocus(){if(S.form&&S.form.panel){readForm();S.form.panel='';renderSheet();const m=document.getElementById('f-memo');if(m){m.focus();m.setSelectionRange(m.value.length,m.value.length);}}},
 kp(el){const f=S.form;const k=el.dataset.k;const tk=f.panel==='fee'?'feeStr':'amountStr';let a=f[tk]||'';const fr=f.fresh&&f.fresh===f.panel;f.fresh='';
  if(fr&&!/^[+−×÷]$/.test(k)&&k!=='done'&&k!=='calc')a='';
  if(k==='back')a=a.slice(0,-1);else if(k==='calc'){f.calcOn=!f.calcOn;}
  else if(k==='done'){const v=calc(a);if(a&&!isNaN(v))a=String(v);f[tk]=a;f.calcOn=false;f.panel=tk==='feeStr'?'':f.type==='trf'?(f.acc?(f.to?'':'to'):'acc'):(f.cat?(f.acc?'':'acc'):'cat');renderSheet();return;}
  else if(/^[+−×÷]$/.test(k)){if(!a)return;if(/[+−×÷]$/.test(a))a=a.slice(0,-1);a+=k;}
  else{if(a==='0')a='';if(a.replace(/[^\d]/g,'').length>12)return;if(!a&&/^0+$/.test(k))return;a+=k;}
  f[tk]=a;renderSheet();},
 swapAcc(){readForm();const f=S.form;const a=f.acc;f.acc=f.to;f.to=a;renderSheet();},
 pickCat(el){const f=S.form;const c=el.dataset.k;if(f.cat!==c)f.sub='';f.cat=c;if(S.settings.subOn&&subsOf(f.type,c).length){f.subPick=true;}else{f.panel='acc';f.subPick=false;}f.err='';renderSheet();},
 pickSub(el){const f=S.form;f.sub=el.dataset.k;f.subPick=false;f.panel='acc';renderSheet();},
 subBack(){S.form.subPick=false;renderSheet();},
 pickAcc(el){const f=S.form;const id=el.dataset.k;if(f.panel==='to')f.to=id;else f.acc=id;f.err='';f.panel=(f.type==='trf'&&f.panel==='acc'&&!f.to)?'to':(!f.amountStr?'amt':'');renderSheet();if(!f.panel){const m=document.getElementById('f-memo');if(m)m.focus();}},
 repSet(el){const f=S.form;const k=el.dataset.k;f.rep=FREQ[k]?k:'';f.inst=0;f.panel='';renderSheet();},
 repMode(el){const f=S.form;f.repMode=el.dataset.k;f.instStr=f.inst>1?String(f.inst):'';renderSheet();},
 instKey(el){const f=S.form;const k=el.dataset.k;let v=f.instStr||'';if(k==='back')v=v.slice(0,-1);else if(k==='C')v='';else if(k==='ok'){const n=parseInt(v,10)||0;if(n>1&&n<=60){f.inst=n;f.rep='';}else if(!n){f.inst=0;}else{toast('2~60개월로 적어주세요');return;}f.repMode='';f.panel='';renderSheet();return;}else if(v.length<2)v+=k;f.instStr=v;renderSheet();},
 txCopy(){readForm();const f=S.form;if(!f||!f.orig)return;f.copyAsk=true;f.copyMode=f.copyMode||'orig';renderSheet();},
 copyMode(el){if(S.form){S.form.copyMode=el.dataset.k;renderSheet();}},
 copyX(){if(S.form){S.form.copyAsk=false;renderSheet();}},
 copyGo(){const f=S.form;if(!f||!f.orig)return;const d=f.copyMode==='today'?today():f.date;S.form=Object.assign({},f,{orig:null,snap:'',copyAsk:false,id:undefined,created:undefined,auto:undefined,date:d,confirmDel:false,err:'',panel:'',fav:false,inst:0,rep:''});renderSheet();toast('복사했어요. 저장하기를 눌러야 기록돼요.');},
 txFavAdd(){readForm();const f=S.form;const amount=calc(f.amountStr);if(!(amount>0)){toast('금액을 먼저 넣어주세요.');return;}const fav={type:f.type,amount,cat:f.type==='trf'?'':f.cat,sub:f.type==='trf'?'':(f.sub||''),acc:f.acc,to:f.type==='trf'?f.to:'',memo:(f.memo||'').trim()};const l=S.settings.favorites||[];if(l.some(x=>x.type===fav.type&&x.amount===fav.amount&&x.cat===fav.cat&&x.acc===fav.acc&&x.memo===fav.memo)){toast('이미 자주 쓰는 내역에 있어요.');return;}saveSettings({favorites:l.concat(fav).slice(-30)});toast('자주 쓰는 내역에 추가했어요.');},
 txFav(){readForm();if(!(S.settings.favorites||[]).length){toast('자주 쓰는 내역이 아직 없어요');return;}openSheet('favorites');},
 fsub(el){readForm();S.form.sub=S.form.sub===el.dataset.k?'':el.dataset.k;renderSheet();},
 sub(el){S.sub=el.dataset.k;S.selDay='';try{localStorage.setItem('moneybook.sub',S.sub);}catch(e){}if(S.sub==='month'&&!S.openMonth)S.openMonth=curLabel();window.scrollTo(0,0);render();},
 yprev(){S.label=shiftLabel(S.label,-12);S.openMonth='';subscribePeriod();render();},ynext(){S.label=shiftLabel(S.label,12);S.openMonth='';subscribePeriod();render();},
 omonth(el){S.openMonth=(S.openMonth||curLabel())===el.dataset.k?'none':el.dataset.k;render();},
 memoNew(){S.memoEd={id:'',date:(()=>{const p=period(S.label);const t=today();return t>=p.start&&t<p.end?t:p.start;})(),text:''};openSheet('memoEd');setTimeout(()=>{const t=document.getElementById('me-text');if(t)t.focus();},80);},
 memoEdit(el){const x=(S.memo.items||[]).find(i=>i.id===el.dataset.k);if(!x)return;S.memoEd=Object.assign({},x);openSheet('memoEd');},
 async memoPut(el){const del=el&&el.dataset.k==='del';const d=S.memoEd;if(!d)return;const tx=(document.getElementById('me-text')||{}).value||'';const dt=(document.getElementById('me-date')||{}).value||d.date;
  if(!del&&!tx.trim()){toast('내용을 적어주세요');return;}const ym=dt.slice(0,7);const ym0=d.id?(d.date||'').slice(0,7)||S.memo.ym:ym;
  const load=async y=>{const sn=await S.db.doc('memo/'+y).get();const v=sn.exists?sn.data():{};const it=Array.isArray(v.items)?v.items.slice():[];if(v.text&&!it.some(x=>x.id==='legacy'))it.push({id:'legacy',date:y+'-01',text:v.text,updated:v.updated||0});return it;};
  try{let a=await load(ym0);a=a.filter(x=>x.id!==d.id);if(!del){const it={id:d.id||newId(),date:dt,text:tx.slice(0,5000),updated:Date.now()};if(ym===ym0)a.push(it);else{const b=await load(ym);b.push(it);await S.db.doc('memo/'+ym).set({items:b,text:'',updated:Date.now()});}}
    await S.db.doc('memo/'+ym0).set({items:a,text:'',updated:Date.now()});S.memo=null;closeSheet();toast(del?'메모를 지웠어요':'메모를 저장했어요');render();}catch(e){toast(dbErr(e));}},
 async memoSave(){const t=document.getElementById('memo-text');if(!t||!S.memo)return;const v=t.value;try{await S.db.doc('memo/'+S.memo.ym).set({text:v,updated:Date.now()});S.memo.text=v;S.memo.saved=v;const st=document.getElementById('memo-st');if(st)st.textContent='저장됨';toast('메모를 저장했어요');}catch(e){toast(dbErr(e));}},
 favUse(el){const x=S.settings.favorites[+el.dataset.i];if(!x)return;openTx(null);Object.assign(S.form,{type:x.type,amountStr:String(x.amount),cat:x.cat||'',sub:x.sub||'',acc:x.acc||S.form.acc,to:x.to||'',memo:x.memo||''});renderSheet();},
 instHide(){try{localStorage.setItem('moneybook.instHide',today());}catch(e){}render();},
 async install(){if(deferredInstall){const e=deferredInstall;deferredInstall=null;try{e.prompt();await e.userChoice;}catch(x){}render();return;}openSheet('install');},
 async login(){if(!window.firebase)return;S.loginBusy=true;S.loginErr='';render();const p=new firebase.auth.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});
  try{await firebase.auth().signInWithPopup(p);}catch(e){if(['auth/popup-blocked','auth/operation-not-supported-in-this-environment','auth/cancelled-popup-request','auth/web-storage-unsupported'].includes(e.code)){try{await firebase.auth().signInWithRedirect(p);return;}catch(e2){e=e2;}}
    if(e.code!=='auth/popup-closed-by-user')S.loginErr=authErr(e);}S.loginBusy=false;render();},
 async pinForgot(){// 구글 계정으로 한 번 더 확인되면 잠금을 풀고 비밀번호를 지워요
  if(!S.user||!window.firebase)return;try{const pr=new firebase.auth.GoogleAuthProvider();pr.setCustomParameters({prompt:'select_account',max_age:'0',login_hint:S.user.email||''});
   const r=await firebase.auth().currentUser.reauthenticateWithPopup(pr);if(!r||!r.user||r.user.uid!==S.user.uid)throw 0;
   pinFails(0);bioSet(null);S.locked=false;S.unlockedOnce=true;S.pinIn='';S.pinErr='';markActive();render();S.pinDraft={step:1,first:'',cur:'',err:''};setTimeout(()=>{openSheet('pin');toast('새 비밀번호를 정해 주세요.');},300);}
  catch(e){const c=(e&&e.code)||'';if(c==='auth/popup-closed-by-user'||c==='auth/cancelled-popup-request')return;S.pinErr=c==='auth/user-mismatch'?'가계부 주인 계정으로 확인해야 해요.':'구글 확인을 하지 못했어요.';updLock();}},
 async logoutNow(){try{await firebase.auth().signOut();}catch(e){}try{await S.fs.terminate();await S.fs.clearPersistence();}catch(e){}
  try{Object.keys(localStorage).filter(k=>k.startsWith('moneybook.f.')||k==='moneybook.pinOn').forEach(k=>localStorage.removeItem(k));}catch(e){}location.reload();},
 nkEdit(){S.nkEdit=true;renderSheet();setTimeout(()=>{const i=document.getElementById('nk-in');if(i){i.focus();i.select();}},50);},
 nkCancel(){S.nkEdit=false;renderSheet();},
 nkSave(){const v=((document.getElementById('nk-in')||{}).value||'').trim().slice(0,20);saveSettings({nickname:v});S.nkEdit=false;renderSheet();},
 logout(){if(!S.ghOffAsk){S.ghOffAsk=true;renderSheet();setTimeout(()=>{S.ghOffAsk=false;if(S.sheet)renderSheet();},4000);return;}S.ghOffAsk=false;ACT.logoutNow();},
 async bkFile(){toast('백업 파일을 만드는 중이에요');try{const snap=await fullSnapshot();const n=Object.values(snap.tx).reduce((a,l)=>a+l.length,0);
  const url=URL.createObjectURL(new Blob([JSON.stringify(snap)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='티끌모아_'+stamp()+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);toast('내역 '+n+'건을 백업 파일로 저장했어요');}catch(e){toast(String(e&&e.message||'').startsWith('load')?'일부 달을 불러오지 못해 백업을 멈췄어요. 인터넷 연결을 확인해 주세요.':'백업 파일을 만들지 못했어요');}},
 async bkRestore(){if(!S.bkData)return;if(!S.bkAsk){S.bkAsk=true;renderSheet();return;}S.bkAsk=false;toast('넣는 중이에요. 화면을 닫지 마세요');try{const p=await restoreSnapshot(S.bkData,(d,t)=>{S.bkInfo=`넣는 중… ${d} / ${t}`;if(S.sheet==='sync')renderSheet();});const n=p.add+p.same;S.bkData=null;S.bkInfo='';toast(`새로 ${p.add}건 추가, ${p.same}건 확인, 중복 ${p.dup}건 건너뜀`);S.xlInfo='';closeSheet();ensureMonths(allMonths(),true);}catch(e){toast('되돌리지 못했어요');}},
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
  const amt=Math.max(0,-bal);openTx({type:'trf',date:today(),amount:amt,cat:'',sub:'',acc:a.pay||'',to:a.id,memo:'카드정산 결제',note:'',time:''});if(!amt)S.form.amountStr='';},
 teSave(){const l=[];document.querySelectorAll('[data-te]').forEach(el=>{if(el.checked)l.push(el.dataset.te);});saveSettings({trfExp:l});toast('저장했어요');closeSheet();},
 gSel(el){S.grpSel=S.grpSel===el.dataset.k?'':el.dataset.k;renderSheet();},
 gMove(el){const g=S.grpSel;if(!g)return;const o=GRP().slice();const i=o.indexOf(g),j=i+(+el.dataset.k);if(j<0||j>=o.length)return;[o[i],o[j]]=[o[j],o[i]];saveSettings({groupOrder:o});renderSheet();},
 gDel(el){const g=el.dataset.k;if(CORE_G.includes(g))return;if(S.settings.accounts.some(a=>a.group===g)){toast('이 그룹에 자산이 있어서 지울 수 없어요. 자산을 먼저 옮기거나 지워 주세요');return;}saveSettings({groupHidden:uniq((S.settings.groupHidden||[]).concat(g))});toast(gName(g)+' 그룹을 지웠어요');renderSheet();},
 gRestore(el){const g=el.dataset.k;saveSettings({groupHidden:(S.settings.groupHidden||[]).filter(x=>x!==g)});renderSheet();},
 gEdit(el){const g=el.dataset.k;S.grpEd={key:g,name:gName(g)};renderSheet();setTimeout(()=>{const i=document.getElementById('g-name');if(i){i.focus();i.select();}},50);},
 gAdd(){S.grpEd={key:'',name:''};renderSheet();setTimeout(()=>{const i=document.getElementById('g-name');if(i)i.focus();},50);},
 gEdCancel(){S.grpEd=null;renderSheet();},
 gEdSave(){const e=S.grpEd;const n=(document.getElementById('g-name').value||'').trim().slice(0,20);if(!n){toast('이름을 적어주세요');return;}if(BADK.has(n)){toast('쓸 수 없는 이름이에요');return;}
  const keys=GRP();if(keys.some(k=>k!==e.key&&gName(k)===n)){toast('같은 이름의 그룹이 있어요');return;}
  if(!e.key){const key='g_'+newId();saveSettings({groupCustom:(S.settings.groupCustom||[]).concat({key,name:n}),groupOrder:GRP().concat(key)});}
  else if(e.key.startsWith('g_'))saveSettings({groupCustom:(S.settings.groupCustom||[]).map(g=>g.key===e.key?{key:g.key,name:n}:g)});
  else{const gn=Object.assign({},S.settings.groupNames||{});if(n===e.key)delete gn[e.key];else gn[e.key]=n;saveSettings({groupNames:gn});}
  S.grpEd=null;toast('저장했어요');renderSheet();},
 gHide(el){const g=el.dataset.k;const h=new Set(S.settings.groupHidden||[]);if(h.has(g))h.delete(g);else h.add(g);saveSettings({groupHidden:[...h]});renderSheet();},
 tagAddOpen(){S.tagAdd=true;renderSheet();setTimeout(()=>{const i=document.getElementById('tag-new');if(i)i.focus();},50);},
 tagAddCancel(){S.tagAdd=false;renderSheet();},
 tagAddOk(){const v=((document.getElementById('tag-new')||{}).value||'').trim().replace(/^#/,'').slice(0,20);if(!v||BADK.has(v))return;if(!(S.settings.tags||[]).includes(v))saveSettings({tags:(S.settings.tags||[]).concat(v)});S.tagAdd=false;renderSheet();},
 tagDel(el){saveSettings({tags:(S.settings.tags||[]).filter(x=>x!==el.dataset.k)});renderSheet();},
 tagGo(el){closeSheet();S.search=el.dataset.k;ACT.open({dataset:{k:'search'}});S.search=el.dataset.k;setTimeout(()=>{const q=document.getElementById('q');if(q){q.value=el.dataset.k;}ensureMonths(allMonths(),true).then(updateSearch);},80);},
 choose(el){const k=el.dataset.k;const C={timeMode:{title:'시간 입력',opts:[['off-desc','사용안함 - 내림차순'],['off-asc','사용안함 - 오름차순'],['on-desc','사용함 - 내림차순'],['on-asc','사용함 - 오름차순']],note:'사용함을 고르면 입력 화면에 시간 칸이 생기고 목록에 시간이 보여요. 내림차순은 하루 안에서 나중 것부터, 오름차순은 먼저 것부터 보여줘요.'},
   inputOrder:{title:'입력순서',opts:[['amt','금액부터'],['cat','분류부터']],note:'새 내역을 적을 때 먼저 열리는 칸이에요.'},
   swipe:{title:'스와이프',opts:[['date','날짜이동'],['off','사용 안 함']],note:'가계부·통계 화면을 좌우로 밀면 이전·다음 달(기간)로 넘어가요.'},
   colorSet:{title:'수입-지출 색상 설정',opts:[['A','Set. A — 수입 파랑, 지출 빨강'],['B','Set. B — 수입 빨강, 지출 파랑']]},
   carry:{title:'이월 설정',opts:[['false','OFF'],['true','ON']],note:`이월 설정은 '가계부탭'에서 이전 달의 남은 금액을 이번 달로 '이월'시키는 기능이에요. 이월된 금액은 '가계부탭'의 합계에만 반영돼요.<br><br>지난달 금액이 마이너스면 이월 금액은 지출로, 반대면 수입으로 셈해요.<br><br>자산(체크카드 제외)은 이월 설정과 상관없이 늘 이어져요.`},
   cardMode:{title:'카드지출 반영방법',opts:[['A','A. 사용시점'],['B','B. 결제대금']],note:`카드를 사용하는 시점에 가계부탭에 '지출'로 반영하거나, 카드 사용금액이 아닌 카드 결제대금을 '지출'로 반영할 수 있어요.<br><br>A. 카드 사용시점에 지출로 5,000원을 반영<br>B. 카드대금 결제 시, 결제대금 5,000원을 지출로 반영<br><br><small>B를 고르면 카드로 쓴 내역은 목록에 그대로 보이지만 합계·통계에서는 빠지고, 통장에서 카드로 보내는 '이체'(자산 › 카드 › 결제)가 지출로 잡혀요.</small>`},
   firstSub:{title:'가계부탭 첫화면',opts:[['daily','일일'],['cal','달력']]},weekStart:{title:'주간 시작일 설정',opts:[[0,'일요일'],[1,'월요일']]}}[k];
  if(!C)return;S.choice=Object.assign({key:k},C);openSheet('choice');},
 choicePick(el){const c=S.choice;let v=el.dataset.k;if(c.key==='weekStart')v=+v;if(c.key==='carry'){v=v==='true';if(v)ensureMonths(allMonths());}saveSettings({[c.key]:v});if(c.key==='colorSet')applyColors();closeSheet();},
 info(el){if(el.dataset.open){openSheet(el.dataset.open);return;}toast(el.dataset.k);},
 resetCancel(){S.resetMode='';renderSheet();},
 moreGo(el){S.moreView=el.dataset.k;window.scrollTo(0,0);render();},
 moreBack(){S.moreView='';window.scrollTo(0,0);render();},
 smOpen(){S.smOpen=!S.smOpen;render();},smClose(){S.smOpen=false;render();},
 smPick(el){S.smOpen=false;S.sp=el.dataset.k;S.statCat='';if(S.sp==='week')S.spWeek=today();if(S.sp==='year')S.spYear=+S.label.slice(0,4);if(S.sp==='range'){const p=period(S.label);S.rFrom=p.start;S.rTo=p.last;}render();},
 catsOf(el){ACT.open({dataset:{k:'cats'}});S.catType=el.dataset.k;renderSheet();},
 setToggle(el){const k=el.dataset.k;const st=S.settings;if(k==='memoShow'||k==='autoFill'||k==='carry'){saveSettings({[k]:!st[k]});if(k==='carry'&&!st.carry)ensureMonths(allMonths());return;}if(k==='subOn')saveSettings({subOn:st.subOn===false});else if(k==='firstSub')saveSettings({firstSub:st.firstSub==='cal'?'daily':'cal'});else if(k==='weekStart')saveSettings({weekStart:st.weekStart===1?0:1});},
 aRestore(el){const id=el.dataset.k;const d=(S.settings.deleted||[]).find(a=>a.id===id);if(!d)return;const a=Object.assign({},d);delete a.deletedAt;const list=S.settings.accounts.slice();let at=-1;list.forEach((x,i)=>{if(x.group===a.group)at=i;});if(at<0)list.push(a);else list.splice(at+1,0,a);
  saveSettings({accounts:list,deleted:S.settings.deleted.filter(x=>x.id!==id)});toast(a.name+' 되살렸어요');renderSheet();},
 perfSave(){const m={},b={};document.querySelectorAll('[data-perf]').forEach(el=>m[el.dataset.perf]=calc(el.value.replace(/원|,/g,''))||0);document.querySelectorAll('[data-pb]').forEach(el=>b[el.dataset.pb]=el.value);saveSettings({accounts:S.settings.accounts.map(a=>m[a.id]!=null?Object.assign({},a,{perf:m[a.id],perfBase:b[a.id]||'prev'}):a)});toast('저장했어요');closeSheet();},
 amenu(){S.amenu=!S.amenu;render();},
 amenuClose(){S.amenu=false;render();},
 accNew(){if(S.sheet)closeSheet();S.amenu=false;S.accEd={id:'',name:'',group:'현금',init:0,hidden:false,cutDay:1,payDay:1};S.aeGP=false;render();openSheet('accEdit');setTimeout(()=>{const t=document.getElementById('ae-name');if(t)t.focus();},60);},
 async accOpen(el){const id=el.dataset.k;const ms=allMonths();if(ms.some(ym=>!S.live[ym]&&!S.cache[ym])){toast('잔액을 계산하는 중이에요');const f=await ensureMonths(ms,true);if(f&&f.length){toast('내역을 다 불러오지 못했어요. 인터넷 연결을 확인해 주세요');return;}}const a=S.settings.accounts.find(x=>x.id===id);if(!a)return;S.accEd=clone(a);S.aeGP=false;S.aeDelAsk=false;openSheet('accEdit');},
 aeRead(){const d=S.accEd;const g=id=>document.getElementById(id);if(!d)return;if(g('ae-name'))d.name=g('ae-name').value;
  if(g('ae-init')){const v=g('ae-init').value.trim();const n=(calc(v.replace(/^-/,'').replace(/원|,/g,''))||0)*(v.startsWith('-')?-1:1);if(d.id)d.bal=n;else d.init=n;}
  if(g('ae-tot'))d.inTotal=g('ae-tot').checked;
  for(const [k,id] of [['memo','ae-memo'],['phone','ae-phone'],['smsKey','ae-key'],['app','ae-app'],['pay','ae-pay']])if(g(id))d[k]=g(id).value;
  if(g('ae-cut'))d.cutDay=+g('ae-cut').value;if(g('ae-payday'))d.payDay=+g('ae-payday').value;},
 aeGroupOpen(){ACT.aeRead();S.aeGP=true;renderSheet();},
 aeGroupClose(){S.aeGP=false;renderSheet();},
 aeGroup(el){ACT.aeRead();S.accEd.group=el.dataset.k;S.aeGP=false;renderSheet();},
 aeSave(){ACT.aeRead();const d=S.accEd;const n=(d.name||'').trim().slice(0,30);
  if(!n){toast('이름을 적어주세요');return;}if(S.settings.accounts.some(a=>a.name===n&&a.id!==d.id)){toast('같은 이름의 자산이 있어요');return;}
  let init=Number(d.init)||0;if(d.id&&d.bal!=null&&d.group!=='체크카드'){const cur=accBalances()[d.id]||0;init=init+(d.bal-cur);}
  const body={name:n,group:d.group,inTotal:d.inTotal!==false,hidden:!!d.hidden,init:d.group==='체크카드'?0:init,memo:(d.memo||'').slice(0,200),phone:(d.phone||'').slice(0,40),smsKey:(d.smsKey||'').slice(0,60),app:(d.app||'').slice(0,40),pay:d.pay||'',cutDay:d.cutDay||1,payDay:d.payDay||1};
  let list=S.settings.accounts.slice();if(d.id){list=list.map(a=>a.id===d.id?Object.assign({},a,body):a);}else{const nw=Object.assign({id:newId(),hidden:false},body);let at=-1;list.forEach((a,i)=>{if(a.group===d.group)at=i;});if(at<0){const gi=GRP().indexOf(d.group);list.forEach((a,i)=>{if(GRP().indexOf(a.group)<gi)at=i;});}list.splice(at+1,0,nw);}
  saveSettings({accounts:list});toast(d.id?'저장했어요':'추가했어요');closeSheet();},
 aeEye(){ACT.aeRead();S.accEd.hidden=!S.accEd.hidden;renderSheet();},
 aeDel(){const d=S.accEd;if(!S.aeDelAsk){S.aeDelAsk=true;renderSheet();setTimeout(()=>{S.aeDelAsk=false;if(S.sheet==='accEdit')renderSheet();},3000);return;}S.aeDelAsk=false;if(S.settings.accounts.length<=1){toast('자산은 하나 이상 있어야 해요');return;}const del=S.settings.accounts.find(a=>a.id===d.id);if(!del)return;saveSettings({accounts:S.settings.accounts.filter(a=>a.id!==d.id),deleted:(S.settings.deleted||[]).concat(Object.assign({},del,{deletedAt:Date.now()}))});if(S.av&&S.av.id===d.id)S.av=null;toast('삭제했어요. 설정관리 › 삭제된 자산에서 되살릴 수 있어요');closeSheet();render();},
 aeHide(){const d=S.accEd;saveSettings({accounts:S.settings.accounts.map(a=>a.id===d.id?Object.assign({},a,{hidden:!a.hidden}):a)});toast(d.hidden?'다시 보이게 했어요':'숨겼어요');closeSheet();},
 aHide(el){const id=el.dataset.k;const vis=S.settings.accounts.filter(a=>!a.hidden);const a=S.settings.accounts.find(x=>x.id===id);if(!a)return;if(!a.hidden&&vis.length<=1){toast('하나는 보여야 해요');return;}
  saveSettings({accounts:S.settings.accounts.map(x=>x.id===id?Object.assign({},x,{hidden:!x.hidden}):x)});renderSheet();},
 aDel(el){S.accDelAsk=S.accDelAsk===el.dataset.k?'':el.dataset.k;ensureMonths(allMonths()).then(()=>{if(S.sheet==='accDel')renderSheet();});renderSheet();},
 aDelOk(el){const id=el.dataset.k;if(S.settings.accounts.length<=1){toast('자산은 하나 이상 있어야 해요');return;}S.accDelAsk='';const del=S.settings.accounts.find(a=>a.id===id);saveSettings({accounts:S.settings.accounts.filter(a=>a.id!==id),deleted:(S.settings.deleted||[]).concat(Object.assign({},del,{deletedAt:Date.now()}))});toast('삭제했어요. 설정관리 › 삭제된 자산에서 되살릴 수 있어요');renderSheet();},
 aSel(el){S.accSel=S.accSel===el.dataset.k?'':el.dataset.k;renderSheet();},
 aMove(el){const id=S.accSel;if(!id)return;const d=+el.dataset.k;const l=S.settings.accounts.slice();const i=l.findIndex(a=>a.id===id);if(i<0)return;const g=l[i].group;let j=i+d;while(j>=0&&j<l.length&&l[j].group!==g)j+=d;if(j<0||j>=l.length)return;[l[i],l[j]]=[l[j],l[i]];saveSettings({accounts:l});renderSheet();const b=document.querySelector('.ali.sel');if(b)b.scrollIntoView({block:'nearest'});},
 ovShift(el){S.ovLabel=shiftLabel(S.ovLabel||S.label,+el.dataset.k);render();},
 ovw(el){S.overview=el.dataset.k==='1';S.ovLabel=S.label;S.av=null;window.scrollTo(0,0);render();},
 sprev(){ACT._sshift(-1);}, snext(){ACT._sshift(1);},
 _sshift(k){if(S.sp==='month'){S.label=shiftLabel(S.label,k);subscribePeriod();}
  else if(S.sp==='week')S.spWeek=addDays(statPeriod().start,7*k);else if(S.sp==='year')S.spYear=(S.spYear||+S.label.slice(0,4))+k;render();},
 scat(el){S.statCat=el.dataset.k;S.statSub='';window.scrollTo(0,0);render();},
 scClose(){S.statCat='';S.statSub='';render();},
 ssub(el){S.statSub=el.dataset.k;render();},
 subToggle(el){saveSettings({subOn:!!el.checked});renderSheet();},
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
  const t={type:f.type,date:f.date,amount,cat:f.type==='trf'?'':f.cat,sub:f.type==='trf'?'':(f.sub||''),acc:f.acc,to:f.type==='trf'?f.to:'',memo:f.memo.trim(),note:(f.note||'').trim(),time:f.time||'',created:f.created,auto:f.auto,tags:(f.tags||[]).slice()};
  try{if(!f.orig&&f.inst>1){const n=f.inst;const base=Math.floor(amount/n);for(let i=0;i<n;i++)await writeTx(Object.assign({},t,{date:addMonths(f.date,i),amount:i===n-1?amount-base*(n-1):base,memo:(t.memo||t.cat)+` (할부 ${i+1}/${n})`}));}
    else await writeTx(t,f.orig);}catch(e){return err(dbErr(e));}
  const fee=f.type==='trf'?calc(f.feeStr||''):0;
  if(fee>0){const ec=S.settings.cats.exp||[];try{await writeTx({type:'exp',date:f.date,amount:fee,cat:ec.includes('기타')?'기타':(ec[0]||''),sub:'',acc:f.acc,to:'',memo:'이체 수수료'+(t.memo?' ('+t.memo+')':''),time:''});}catch(e){}}
  if(!f.orig&&f.rep&&FREQ[f.rep]){const rec={id:newId(),type:t.type,day:+f.date.slice(8),amount,cat:t.cat,sub:t.sub,acc:t.acc,to:t.to,memo:t.memo,freq:f.rep,start:f.date,last:f.date,done:[]};
    saveSettings({recurring:(S.settings.recurring||[]).concat(rec)}).then(()=>{S.recurDone=false;applyRecurring();});}
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
  if(k==='groups'){S.grpSel='';S.grpEd=null;}
  if(k==='backup'){S.resetMode='';S.xlInfo='';}
  if(k==='mypage'){S.nkEdit=false;S.ghOffAsk=false;}
  if(k==='pin')S.patDraft=null;
  if(k==='pin'&&S.bioOk==null)bioAvail().then(ok=>{S.bioOk=ok;if(S.sheet==='pin')renderSheet();});
  if(k==='accounts')S.accDraft=clone(S.settings.accounts);
  if(k==='accHide'||k==='accDel'||k==='accOrder'){S.amenu=false;S.accDelAsk='';S.accSel='';render();}
  if(k==='recurring')S.recDraft={type:'exp',day:new Date().getDate(),freq:'monthly',start:today(),amount:0,cat:'',acc:lastAcc(),to:'',memo:'',now:false};
  if(k==='pin')S.pinDraft=null;
  if(k==='sync'){S.ghOffAsk=false;S.bkInfo='';S.bkData=null;S.bkAsk=false;}
  if(k==='favorites')S.favEdit=false;
  if(k==='cats'){S.catType=S.catType||'exp';S.catEdit=-1;S.catDelAsk=-1;S.catSel=null;}
  openSheet(k);setTimeout(()=>{const t=document.getElementById(k==='sms'?'sms-text':k==='search'?'q':'');if(t)t.focus();},60);},
 smsParse(){const t=document.getElementById('sms-text');S.sms.text=t?t.value:'';S.sms.items=parseSms(S.sms.text);renderSheet();},
 smsChk(el){S.sms.items[+el.dataset.i].on=el.checked;const sc=$('.sheet').scrollTop;renderSheet();$('.sheet').scrollTop=sc;},
 async smsSave(){const items=S.sms.items.filter(x=>x.on);let ok=0;
  for(const it of items){try{await writeTx({type:it.type,date:it.date,amount:it.amount,cat:it.cat,acc:it.acc,to:'',memo:it.memo,time:it.time});ok++;}catch(e){toast(dbErr(e));break;}}
  if(ok){try{localStorage.setItem('moneybook.acc',items[0].acc);}catch(e){}toast(ok+'건 저장했어요');closeSheet();}},
 catSel(el){const i=+el.dataset.i;S.catSel=S.catSel===i?null:i;renderSheet();},
 catMv(el){const i=S.catSel;if(i==null)return;const t=S.catType;const l=S.settings.cats[t].slice();const j=i+(+el.dataset.k);if(j<0||j>=l.length)return;[l[i],l[j]]=[l[j],l[i]];S.catSel=j;saveSettings({cats:Object.assign({},S.settings.cats,{[t]:l})});renderSheet();},
 catNew(){S.catEd={type:S.catType,i:-1,name:'',subs:[]};openSheet('catEd');setTimeout(()=>{const x=document.getElementById('ce-name');if(x)x.focus();},60);},
 catEdOpen(el){const i=+el.dataset.i;const t=S.catType;const c=S.settings.cats[t][i];S.catEd={type:t,i,name:c,old:c,subs:subsOf(t,c).slice()};openSheet('catEd');},
 ceSubAdd(){const d=S.catEd;d.name=document.getElementById('ce-name').value;const v=(document.getElementById('ce-sub').value||'').trim().slice(0,20);if(!v||BADK.has(v)||d.subs.includes(v))return;d.subs.push(v);renderSheet();const x=document.getElementById('ce-sub');if(x)x.focus();},
 ceSubDel(el){const d=S.catEd;d.name=document.getElementById('ce-name').value;d.subs.splice(+el.dataset.j,1);renderSheet();},
 ceSave(){const d=S.catEd;const t=d.type;const v=(document.getElementById('ce-name').value||'').trim().slice(0,20);if(!v){toast('이름을 적어주세요');return;}if(BADK.has(v)){toast('쓸 수 없는 이름이에요');return;}
  const l=S.settings.cats[t].slice();if(l.some((c,i)=>c===v&&i!==d.i)){toast('이미 있는 분류예요');return;}
  const subsT=Object.assign({},(S.settings.subs||{})[t]||{});const bud=clone(S.settings.budget||{total:0,cats:{}});
  if(d.i<0)l.push(v);else{l[d.i]=v;if(d.old!==v){delete subsT[d.old];if(t==='exp'&&bud.cats&&bud.cats[d.old]!=null){bud.cats[v]=bud.cats[d.old];delete bud.cats[d.old];}}}
  subsT[v]=d.subs.slice();saveSettings({cats:Object.assign({},S.settings.cats,{[t]:l}),subs:Object.assign({},S.settings.subs||{},{[t]:subsT}),budget:bud});toast('저장했어요');S.catSel=null;openSheet('cats');},
 ctype(el){S.catType=el.dataset.k;S.catEdit=-1;S.catDelAsk=-1;renderSheet();},
 catUp(el){const i=+el.dataset.i;const t=S.catType;const l=S.settings.cats[t].slice();[l[i-1],l[i]]=[l[i],l[i-1]];saveSettings({cats:Object.assign({},S.settings.cats,{[t]:l})});renderSheet();},
 catDel(el){const i=+el.dataset.i;if(S.catDelAsk!==i){S.catDelAsk=i;renderSheet();return;}S.catDelAsk=-1;S.catEdit=-1;const t=S.catType;const l=S.settings.cats[t].slice();if(l.length<=1){toast('분류는 하나 이상 있어야 해요');return;}l.splice(i,1);saveSettings({cats:Object.assign({},S.settings.cats,{[t]:l})});renderSheet();},
 catAdd(){const el=document.getElementById('c-new');const v=(el.value||'').trim();const t=S.catType;if(!v)return;if(BADK.has(v)){toast('쓸 수 없는 이름이에요');return;}if(S.settings.cats[t].includes(v)){toast('이미 있는 분류예요');return;}
  saveSettings({cats:Object.assign({},S.settings.cats,{[t]:S.settings.cats[t].concat(v.slice(0,20))})});renderSheet();},
 accAdd(){readAcc();S.accDraft.push({id:newId(),name:'',group:'카드',init:0});renderSheet();const els=document.querySelectorAll('[data-acc="name"]');if(els.length)els[els.length-1].focus();},
 accDel(el){readAcc();if(S.accDraft.length<=1){toast('자산은 하나 이상 있어야 해요');return;}S.accDraft.splice(+el.dataset.i,1);renderSheet();},
 saveAcc(){readAcc();const list=S.accDraft.filter(a=>a.name.trim()).map(a=>Object.assign({},S.settings.accounts.find(o=>o.id===a.id)||{},{id:a.id||newId(),name:a.name.trim().slice(0,30),group:a.group||'기타',init:Number(a.init)||0,hidden:!!a.hidden}));
  if(!list.length){toast('이름을 하나 이상 적어주세요');return;}saveSettings({accounts:list});toast('저장했어요');closeSheet();},
 budNew(){S.budEd={isNew:true,cat:'',amt:0};openSheet('budEd');},
 budEdit(el){const c=el.dataset.k;const b=S.settings.budget||{};S.budEd={isNew:false,cat:c,amt:c?(b.cats||{})[c]||0:b.total||0};openSheet('budEd');},
 budSave(){const d=S.budEd;const c=d.isNew?document.getElementById('bd-cat').value:d.cat;const v=calc((document.getElementById('bd-amt').value||'').replace(/,/g,''))||0;const b=clone(S.settings.budget||{total:0,cats:{}});b.cats=b.cats||{};if(c){if(v>0)b.cats[c]=v;else delete b.cats[c];}else b.total=v;saveSettings({budget:b});toast('저장했어요');openSheet('budget');},
 budDel(){const d=S.budEd;const b=clone(S.settings.budget||{total:0,cats:{}});b.cats=b.cats||{};if(d.cat)delete b.cats[d.cat];else b.total=0;saveSettings({budget:b});toast('지웠어요');openSheet('budget');},
 saveBudget(){const tot=calc(document.getElementById('b-total').value)||0;const cats={};document.querySelectorAll('[data-bud]').forEach(el=>{const v=calc(el.value);if(v>0)cats[el.dataset.bud]=v;});
  saveSettings({budget:{total:tot>0?tot:0,cats}});toast('예산을 저장했어요');closeSheet();},
 rtype(el){readRec();S.recDraft.type=el.dataset.k;S.recDraft.cat='';renderSheet();},
 recAdd(){readRec();const r=S.recDraft;if(!(r.amount>0)){r.err='금액을 입력해 주세요.';renderSheet();return;}
  if(r.type==='trf'&&(!r.to||r.to===r.acc)){r.err='받는 곳을 다르게 골라주세요.';renderSheet();return;}
  const st=okDate(r.start)?r.start:today();let last='';if(!r.now&&st<today()){const tmp={freq:r.freq||'monthly',start:st};let d=recFirst(tmp),pv='';while(d<today()){pv=d;d=recNext(tmp,d);}last=pv;}
  const rec={id:newId(),type:r.type,day:+st.slice(8),amount:r.amount,cat:r.type==='trf'?'':(r.cat||(S.settings.cats[r.type]||[])[0]||''),acc:r.acc,to:r.type==='trf'?r.to:'',memo:r.memo.trim(),freq:r.freq||'monthly',start:st,last,done:[]};
  saveSettings({recurring:(S.settings.recurring||[]).concat(rec)}).then(()=>{S.recurDone=false;applyRecurring();});
  S.recDraft={type:'exp',day:new Date().getDate(),freq:'monthly',start:today(),amount:0,cat:'',acc:lastAcc(),to:'',memo:'',now:false};toast('등록했어요');renderSheet();},
 recDel(el){const l=(S.settings.recurring||[]).slice();l.splice(+el.dataset.i,1);saveSettings({recurring:l});renderSheet();},
 favDel(el){const l=(S.settings.favorites||[]).slice();l.splice(+el.dataset.i,1);saveSettings({favorites:l});renderSheet();},
 saveMs(){const v=+document.getElementById('ms').value;const w=(document.querySelector('input[name=msw]:checked')||{}).value||'none';saveSettings({monthStart:v,msWeekend:w});S.label=curLabel();subscribePeriod();toast('월 시작일을 바꿨어요');closeSheet();},
 export(el){doExport(el.dataset.k,el.dataset.share==='1');},
 async bkShare(){toast('백업 파일을 만드는 중이에요');try{const snap=await fullSnapshot();const r=await shareFile(new Blob([JSON.stringify(snap)],{type:'application/json'}),'티끌모아_'+stamp()+'.json','티끌모아 백업');if(r==='saved')toast('백업 파일을 저장했어요');}catch(e){toast('백업 파일을 만들지 못했어요');}},
 resetAsk(el){S.resetMode=el.dataset.k;renderSheet();setTimeout(()=>{const i=document.getElementById('rs-in');if(i)i.focus();},60);},
 async resetGo(){const mode=S.resetMode;const v=(document.getElementById('rs-in')||{}).value||'';if(v.trim()!=='초기화'){toast("'초기화'라고 적어 주세요");return;}
  toast('먼저 백업 파일을 받아요');try{const snap=await fullSnapshot();const url=URL.createObjectURL(new Blob([JSON.stringify(snap)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='티끌모아_초기화전_'+stamp()+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),8000);await new Promise(r=>setTimeout(r,1200));}catch(e){toast('백업을 못 받아서 멈췄어요. 인터넷 연결을 확인해 주세요.');return;}
  const fs=S.fs;const base='books/'+BOOK+'/';let n=0;
  try{for(const ym of allMonths()){const sn=await fs.collection(base+'tx_'+ym).get();for(let i=0;i<sn.docs.length;i+=400){const bt=fs.batch();sn.docs.slice(i,i+400).forEach(d=>bt.delete(d.ref));await bt.commit();n+=Math.min(400,sn.docs.length-i);}}
    if(mode==='all'){const m=await fs.collection(base+'memo').get();for(let i=0;i<m.docs.length;i+=400){const bt=fs.batch();m.docs.slice(i,i+400).forEach(d=>bt.delete(d.ref));await bt.commit();}
      const keep={pin:S.settings.pin||null,lockMin:S.settings.lockMin??0};await fs.doc(base+'ledger/settings').set(Object.assign(clone(DEFAULTS),keep));}
    else await fs.doc(base+'ledger/settings').update({months:{},recurring:(S.settings.recurring||[]).map(r=>Object.assign({},r,{last:today()}))});
    S.cache={};S.live={};S.resetMode='';closeSheet();toast((mode==='all'?'전체를':'가계부 내역 '+n+'건을')+' 초기화했어요');subscribePeriod();render();}catch(e){toast(dbErr(e));}},
 xlsIn(){const i=document.getElementById('xl-in');if(i)i.click();},
 pinStart(){S.pinDraft={step:1,first:'',cur:'',err:''};renderSheet();},
 bioUnlock(){bioUnlock(false);},
 lockWay(el){const k=el.dataset.k;S.pinErr='';if(k==='fp'){if(!bioGet()){S.afterUnlock='fp';S.lockWay='pin';S.pinErr='이 기기에 아직 지문이 등록되지 않았어요. 비밀번호로 연 다음 바로 등록해요.';S.pinIn='';$('#lockRoot').innerHTML='';renderLock();return;}bioUnlock(false);return;}if(k==='pat'&&!patOn()){S.afterUnlock='pat';S.lockWay='pin';S.pinErr='아직 패턴이 없어요. 비밀번호로 연 다음 바로 패턴을 정해요.';S.pinIn='';$('#lockRoot').innerHTML='';renderLock();return;}S.lockWay=k==='pin'||k==='pat'?k:'';S.pinIn='';$('#lockRoot').innerHTML='';renderLock();},
 async bioOn(){if(!(await bioAvail())){S.bioOk=false;renderSheet();toast('이 기기에서는 지문·패턴 확인을 쓸 수 없어요');return;}
  try{await bioRegister();toast('지문으로 열기를 켰어요');}catch(e){toast(e&&e.name==='NotAllowedError'?'취소했어요':'켜지 못했어요 ('+((e&&e.name)||'오류')+')');}renderSheet();},
 bioOff(){bioSet(null);toast('지문으로 열기를 껐어요');renderSheet();},
 patStart(){S.patDraft={step:1,first:'',err:''};renderSheet();},
 patCancel(){S.patDraft=null;renderSheet();},
 patOff(){saveSettings({pat:null});toast('패턴 잠금을 껐어요');renderSheet();},
 pinOff(){bioSet(null);saveSettings({pin:null,pat:null});toast('잠금을 껐어요');renderSheet();},
 async pinKey(el){const k=el.dataset.k;
  if(lockOn()){const wait=lockWait();if(wait){S.pinIn='';S.pinErr=`여러 번 틀렸어요. ${wait}초 뒤에 다시 입력하세요.`;updLock();return;}if(k==='back'){S.pinIn=S.pinIn.slice(0,-1);S.pinErr='';updLock();return;}if(S.pinIn.length>=4)return;S.pinIn+=k;S.pinErr='';updLock();
    if(S.pinIn.length===4){if(!S.settings.pin){S.pinIn='';S.pinErr='잠금 정보를 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요.';updLock();return;}const h=await hashPin(S.pinIn,S.settings.pin.salt);if(h===S.settings.pin.hash){pinFails(0);S.locked=false;S.unlockedOnce=true;S.pinIn='';S.pinErr='';markActive();render();if(S.afterUnlock==='pat'){S.afterUnlock='';setTimeout(()=>{S.patDraft={step:1,first:'',err:''};openSheet('pin');},400);}else if(S.afterUnlock==='fp'){S.afterUnlock='';setTimeout(()=>{S.patDraft=null;ACT.open({dataset:{k:'pin'}});},400);}}else{const n=pinFails(1);S.pinIn='';S.pinErr=n>=5?`5번 틀렸어요. ${lockWait()}초 뒤에 다시 입력하세요.`:`비밀번호가 달라요. (${n}/5)`;updLock();}}return;}
  const d=S.pinDraft;if(!d)return;if(k==='back'){d.cur=d.cur.slice(0,-1);d.err='';updDraft();return;}if(d.cur.length>=4)return;d.cur+=k;d.err='';updDraft();
  if(d.cur.length===4){if(d.step===1){d.first=d.cur;d.cur='';d.step=2;setTimeout(renderSheet,150);}
    else if(d.cur===d.first){const salt=newId();const hash=await hashPin(d.cur,salt);saveSettings({pin:{salt,hash}});S.unlockedOnce=true;markActive();S.pinDraft=null;toast('비밀번호를 설정했어요');closeSheet();}
    else{S.pinDraft={step:1,first:'',cur:'',err:'두 번 입력한 번호가 달라요. 처음부터 다시 입력하세요.'};renderSheet();}}}
};
const FAST=new Set(['pinKey','kp','sugPick','sugClose','sugOffAll']);
// 숫자 키는 닿는 순간 입력돼요. 그 손가락을 뗄 때 생기는 클릭이 다른 버튼에 떨어지지 않게 잠깐 막아요
// 날짜·시간 칸을 누르면 휴대폰 달력 창을 확실히 띄워요(일부 폰에서 투명한 날짜 칸이 안 열리는 문제 대비)
document.addEventListener('click',e=>{const t=e.target;if(t&&t.matches&&t.matches('input[type=date],input[type=time],input[type=month]')&&typeof t.showPicker==='function'){try{t.showPicker();}catch(x){}}},true);
let downOnOv=null;document.addEventListener('pointerdown',e=>{downOnOv=e.target&&e.target.classList&&e.target.classList.contains('ov')?e.target:null;},true);
let ghostUntil=0;document.addEventListener('click',e=>{if(Date.now()<ghostUntil&&!(e.target.closest&&e.target.closest('[data-act]')&&FAST.has(e.target.closest('[data-act]').dataset.act))){e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('pointerdown',e=>{if(e.button>0)return;const el=e.target.closest('[data-act]');if(!el||!FAST.has(el.dataset.act))return;e.preventDefault();ghostUntil=Date.now()+350;
  el.classList.add('press');setTimeout(()=>el.classList.remove('press'),130);try{navigator.vibrate&&navigator.vibrate(8);}catch(x){}ACT[el.dataset.act](el,e);});
document.addEventListener('click',e=>{const el=e.target.closest('[data-act]');if(!el)return;if(FAST.has(el.dataset.act))return;if(el.tagName==='INPUT'&&el.type==='checkbox'&&e.type==='click'){ACT[el.dataset.act]&&ACT[el.dataset.act](el,e);return;}const f=ACT[el.dataset.act];if(f)f(el,e);});
// 내역 자동 완성: 예전에 적은 '내용'을 보여주고, 고르면 분류·자산·금액까지 채워요
function sugList(q){q=(q||'').trim();if(q.length<2||!S.settings.autoFill||!S.form)return [];const f=S.form;const seen=new Set();const out=[];
  const ms=Object.keys(Object.assign({},S.cache,S.live)).sort().reverse();
  for(const ym of ms){for(const t of txOf(ym).slice().sort((a,b)=>b.date.localeCompare(a.date))){if(t.type!==f.type||!t.memo)continue;const m=t.memo.trim();if(seen.has(m)||!m.includes(q)||m===q)continue;seen.add(m);out.push(t);if(out.length>=4)return out;}}return out;}
function updSug(){const box=document.getElementById('f-sug');const inp=document.getElementById('f-memo');if(!box||!inp)return;const l=sugList(inp.value);S._sug=l;
  if(!l.length){box.hidden=true;box.innerHTML='';return;}box.hidden=false;box.innerHTML=`<button class="sgc x" data-act="sugClose" aria-label="추천 닫기">×</button><button class="sgc off" data-act="sugOffAll">끄기</button>`+l.map((t,i)=>`<button class="sgc" data-act="sugPick" data-i="${i}" title="${esc((t.cat||'')+' · '+accName(t.acc))}">${esc(t.memo)} <small>${won(t.amount)}</small></button>`).join('');}
document.addEventListener('input',e=>{const t=e.target;if(S.sheet==='tx'&&S.form&&S.form.orig&&/^f-/.test(t.id||''))updDirty();
  if(t.id==='f-memo'&&S.form&&!S.sugOff){clearTimeout(ACT._sgt);ACT._sgt=setTimeout(updSug,250);}
  if(t.id==='f-amt'&&S.form){S.form.amountStr=t.value;const v=calc(t.value);const c=document.getElementById('f-calc');if(c)c.textContent=/[+\-*/×÷−]/.test(t.value.replace(/^-/,''))&&!isNaN(v)?'= '+won(v)+'원':'';}
  if(t.id==='q'){S.search=t.value;clearTimeout(ACT._qt);ACT._qt=setTimeout(updateSearch,200);}
  if(t.id==='sms-text'&&S.sms)S.sms.text=t.value;
  if(t.id==='memo-text'&&S.memo){S.memo.text=t.value;const st=document.getElementById('memo-st');if(st)st.textContent=t.value===S.memo.saved?'저장됨':'저장 안 됨';}});
document.addEventListener('focusout',e=>{if(e.target&&e.target.id==='f-memo')setTimeout(()=>{const b=document.getElementById('f-sug');if(b&&!b.contains(document.activeElement)){b.hidden=true;}},180);});
document.addEventListener('keydown',e=>{if(e.target&&e.target.id==='f-memo'&&(e.key==='Escape'||e.key==='Enter')){const b=document.getElementById('f-sug');if(b&&!b.hidden){b.hidden=true;e.stopPropagation();}}},true);
document.addEventListener('compositionend',e=>{if(e.target&&e.target.id==='q'){S.search=e.target.value;clearTimeout(ACT._qt);ACT._qt=setTimeout(updateSearch,50);}});
document.addEventListener('change',e=>{const t=e.target;
  if(t.dataset&&t.dataset.fg){const g=t.dataset.fg;const tab=S.fTab;const F=Object.assign({},S.filter);
    if(g==='all'){const keys=tab==='acc'?S.settings.accounts.map(a=>a.id):(S.settings.cats[tab]||[]);F[tab]=t.checked?keys.slice():[];}
    else{const set=new Set(F[g]);if(t.checked)set.add(t.value);else set.delete(t.value);F[g]=[...set];}
    S.filter=F;render();return;}
  if(t.id==='f-date'&&S.form){readForm();S.form.date=okDate(t.value)?t.value:S.form.date;renderSheet();return;}// PC에서 날짜를 치는 동안 화면을 다시 그리면 입력이 끊겨서 그리지 않아요
  if(t.id==='xl-in'&&t.files&&t.files[0]){const file=t.files[0];t.value='';S.bkData=null;S.bkAsk=false;S.xlInfo='엑셀을 읽는 중이에요…';renderSheet();
    (async()=>{try{const X=await loadXLSX();const buf=await file.arrayBuffer();const snap=xlsToSnap(X,buf);const n=Object.values(snap.tx).reduce((a,l)=>a+l.length,0);if(!n)throw new Error('empty');
      const j=cleanSnap(snap);const plan=await analyzeSnapshot(j);j._plan=plan;S.bkData=j;
      S.xlInfo=`${file.name} · 내역 ${n}건${snap.skipped?` (이체입금 ${snap.skipped}건은 이체출금과 짝이라 뺐어요)`:''}\n새로 추가 ${plan.add}건 · 이미 있음 ${plan.same}건 · 같은 내역이라 건너뜀 ${plan.dup}건${snap.merge.accounts.length?`\n새 자산 ${snap.merge.accounts.length}개: ${snap.merge.accounts.map(a=>a.name).join(', ')}`:''}`;}
     catch(e){S.bkData=null;S.xlInfo=e&&e.message==='empty'?'읽을 내역이 없어요. 편한가계부에서 내보낸 엑셀이 맞는지 확인해 주세요.':'엑셀을 읽지 못했어요. ('+((e&&e.message)||'오류')+')';}renderSheet();})();return;}
  if(t.id==='bk-in'&&t.files&&t.files[0]){const fr=new FileReader();fr.onload=async()=>{let j;try{j=JSON.parse(fr.result);if(!j||typeof j!=='object'||(j.app!=='moneybook'&&!j.tx))throw 0;j=cleanSnap(j);}catch(e){S.bkData=null;S.bkInfo='티끌모아 백업 파일이 아니에요.';renderSheet();return;}
      S.bkData=null;S.bkInfo='지금 장부와 비교하는 중…';renderSheet();
      try{const plan=await analyzeSnapshot(j);j._plan=plan;S.bkData=j;const n=Object.values(j.tx||{}).reduce((a,l)=>a+l.length,0);
        S.bkInfo=`${j.merge?(j.source||'가져오기')+' 파일':String(j.at||'').slice(0,10)+' 백업'} · 내역 ${n}건\n새로 추가 ${plan.add}건 · 이미 있음 ${plan.same}건(그대로 하나만 남음) · 중복이라 건너뜀 ${plan.dup}건\n${j.merge?'계좌·분류는 지금 것과 합쳐요.':'설정은 백업 때 것으로 돌아가고, 그 뒤에 만든 계좌·분류는 그대로 남아요.'} 백업 뒤에 새로 적은 내역은 지워지지 않아요.${j.bad?`\n형식이 맞지 않는 ${j.bad}건은 빼고 넣어요.`:''}`;}
      catch(e){S.bkData=null;S.bkInfo='비교하지 못했어요. 인터넷 연결을 확인해 주세요.';}S.bkAsk=false;renderSheet();};fr.readAsText(t.files[0]);t.value='';return;}
  if(t.id==='lockMin'){saveSettings({lockMin:+t.value});return;}
  if(t.id==='smode'){S.sp=t.value;S.statCat='';if(S.sp==='week')S.spWeek=today();if(S.sp==='year')S.spYear=+S.label.slice(0,4);if(S.sp==='range'){const p=period(S.label);S.rFrom=p.start;S.rTo=p.last;}render();return;}
  if(t.id==='sp-from'||t.id==='sp-to'){if(t.value){if(t.id==='sp-from')S.rFrom=t.value;else S.rTo=t.value;}render();return;}if(t.dataset.sms&&S.sms){S.sms.items[+t.dataset.i][t.dataset.sms]=t.value;}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&S.mp){ACT.mpClose();return;}if(S.sheet==='tx'&&S.form&&(S.form.panel==='amt'||S.form.panel==='fee')&&!/INPUT|TEXTAREA/.test((e.target||{}).tagName||'')){const m={'Backspace':'back','Enter':'done','+':'+','-':'−','*':'×','/':'÷'};const k=/^[0-9]$/.test(e.key)?e.key:m[e.key];if(k){e.preventDefault();ACT.kp({dataset:{k}});return;}}if(S.locked&&S.settings.pin&&/^[0-9]$|^Backspace$/.test(e.key)){if(!document.getElementById('lockDots')){S.lockWay='pin';$('#lockRoot').innerHTML='';renderLock();}ACT.pinKey({dataset:{k:e.key==='Backspace'?'back':e.key}});return;}if(e.key==='Escape'&&S.sheet)closeSheet();if(e.key==='Enter'&&e.target.id==='c-new'){e.preventDefault();ACT.catAdd();}});

document.addEventListener('touchmove',e=>{if(lockOn())e.preventDefault();},{passive:false});
// 스와이프: 좌우로 밀면 이전·다음 달(통계는 기간, 자산 상세는 그 화면 기간)로 이동
let sw=null;document.addEventListener('touchstart',e=>{if(S.settings.swipe==='off'||S.sheet||S.mp||lockOn()||e.touches.length!==1){sw=null;return;}const v=$('#view');if(!v.contains(e.target)||e.target.closest('input,textarea,select,.cal-g svg,.charts')){sw=null;return;}const p0=e.touches[0];sw={x:p0.clientX,y:p0.clientY,t:Date.now()};},{passive:true});
document.addEventListener('touchend',e=>{if(!sw)return;const p1=e.changedTouches[0];const dx=p1.clientX-sw.x,dy=p1.clientY-sw.y,dt=Date.now()-sw.t;sw=null;if(Math.abs(dx)<70||Math.abs(dy)>Math.abs(dx)*0.6||dt>700)return;const k=dx<0?1:-1;
  if(S.tab==='list'){if(S.sub==='month')goLabel((+S.label.slice(0,4)+k)+'-'+S.label.slice(5,7));else goLabel(shiftLabel(S.label,k));}
  else if(S.tab==='stat'&&S.sp!=='range')ACT._sshift(k);
  else if(S.tab==='asset'&&S.av)ACT.avShift({dataset:{k}});},{passive:true});
// 새 판이 올라오면 저절로 바꿔요: 앱을 다시 볼 때·30분마다 확인하고, 입력 창이 열려 있지 않을 때만 새로 불러요
let updAt=0;async function checkUpdate(){if(Date.now()-updAt<60000||!navigator.onLine)return;updAt=Date.now();
  try{const t=await fetch('./sw.js?t='+Date.now(),{cache:'no-store'}).then(r=>r.ok?r.text():'');const m=t.match(/moneybook-v(\d+)/);
    if(m&&+m[1]>APP_VERSION&&!S.sheet){try{if(sessionStorage.getItem('moneybook.updTo')===m[1])return;sessionStorage.setItem('moneybook.updTo',m[1]);}catch(e){}try{const r=await navigator.serviceWorker.getRegistration();if(r)await r.update();}catch(e){}if(!lockOn())markActive();location.reload();}}catch(e){}}
setInterval(checkUpdate,30*60000);
document.addEventListener('visibilitychange',()=>{if(document.hidden){S.hiddenAt=Date.now();if(S.settings.pin)document.documentElement.classList.add('veil');if(!lockOn()){if((S.settings.lockMin??0)>0)markActive();else try{sessionStorage.removeItem('moneybook.activeAt');}catch(e){}}return;}
  document.documentElement.classList.remove('veil');checkUpdate();
  if(S.settings.pin&&!S.locked&&S.hiddenAt&&Date.now()-S.hiddenAt>=(S.settings.lockMin??0)*60000){S.locked=true;S.lockWay='';$('#lockRoot').innerHTML='';try{sessionStorage.removeItem('moneybook.activeAt');}catch(e){}S.pinIn='';S.pinErr='';closeSheet();render();}});
function applyColors(){const r=document.documentElement;r.style.removeProperty('--exp');r.style.removeProperty('--inc');if(S.settings.colorSet!=='B')return;const cs=getComputedStyle(r);const e=cs.getPropertyValue('--exp'),i=cs.getPropertyValue('--inc');r.style.setProperty('--exp',i);r.style.setProperty('--inc',e);}
try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>applyColors());}catch(e){}
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
async function fullSnapshot(){const ms=allMonths();await needAll();const st0=clone(S.settings);delete st0.pin;delete st0.pat;const snap={app:'moneybook',v:1,at:new Date().toISOString(),settings:st0,tx:{},memo:[]};
  ms.forEach(ym=>{snap.tx[ym]=txOf(ym);});try{const m=await S.db.collection('memo').get();snap.memo=m.docs.map(x=>Object.assign({ym:x.id},x.data()));}catch(e){}return snap;}
// 파일 내역과 지금 장부를 비교: 같은 번호는 '이미 있음'(덮어써도 하나), 번호는 다르지만 날짜·금액·자산·내용이 같으면 '중복'으로 건너뜀
const txKey=t=>[t.type,t.date,t.amount,t.acc||'',t.to||'',(t.memo||'').trim()].join('|');
// 백업 파일 검사: 형식이 틀린 내역은 빼고, 날짜와 달이 맞는 것만 남겨요
function cleanSnap(j){const tx={};let bad=0;const src=(j.tx&&typeof j.tx==='object')?j.tx:{};
  for(const ym of Object.keys(src)){if(!okYm(ym)||!Array.isArray(src[ym])){bad++;continue;}for(const t of src[ym]){const n=normTx(t,ym);if(n)(tx[ym]=tx[ym]||[]).push(n);else bad++;}}
  const memo=(Array.isArray(j.memo)?j.memo:[]).filter(m=>m&&okYm(m.ym)).map(m=>({ym:m.ym,text:str(m.text,5000),updated:Number(m.updated)||Date.now(),items:(Array.isArray(m.items)?m.items:[]).filter(x=>x&&typeof x==='object').slice(0,500).map(x=>({id:str(x.id,60)||newId(),date:okDate(x.date)?x.date:m.ym+'-01',text:str(x.text,5000),updated:Number(x.updated)||0}))}));
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
  if(st){st=normalizeSettings(clone(st));st.pin=S.settings.pin||null;st.pat=S.settings.pat||null;st.lockMin=S.settings.lockMin??0;}
  const ops=[];if(st)ops.push([fs.doc(base+'ledger/settings'),JSON.parse(JSON.stringify(st))]);
  for(const ym in (snap.tx||{}))for(const t of snap.tx[ym]){const b=Object.assign({},t);delete b.id;ops.push([fs.collection(base+'tx_'+ym).doc(t.id),JSON.parse(JSON.stringify(b))]);}
  for(const m of (snap.memo||[])){let cur={};try{const sn=await fs.doc(base+'memo/'+m.ym).get();cur=sn.exists?sn.data():{};}catch(e){}
    const it=(Array.isArray(cur.items)?cur.items.slice():[]);if(cur.text&&!it.some(x=>x.id==='legacy'))it.push({id:'legacy',date:m.ym+'-01',text:cur.text,updated:cur.updated||0});
    const add=(Array.isArray(m.items)?m.items:[]).concat(m.text&&!(m.items||[]).some(x=>x.id==='legacy')?[{id:'legacy',date:m.ym+'-01',text:m.text,updated:m.updated||0}]:[]);
    for(const x of add){const i=it.findIndex(y=>y.id===x.id);if(i<0)it.push(x);else if((x.updated||0)>(it[i].updated||0))it[i]=x;}
    ops.push([fs.doc(base+'memo/'+m.ym),{items:it,text:'',updated:Date.now()}]);}
  let done=0;for(let i=0;i<ops.length;i+=400){const bt=fs.batch();ops.slice(i,i+400).forEach(([r,d])=>bt.set(r,d));await bt.commit();done=Math.min(ops.length,i+400);if(onProg)onProg(done,ops.length);}
  return plan;}
function startDb(){S.needSetup=false;S.db=makeFbDb(S.fs);let firstMs=null;
  S.db.doc('ledger/settings').onSnapshot(snap=>{const d=snap.exists?snap.data():{};S.settings=normalizeSettings(clone(d));GH.denied=false;
    if(firstMs===null){firstMs=S.settings.monthStart;S.label=curLabel();subscribePeriod();if(S.freshOpen&&S.tab==='list')S.sub=S.settings.firstSub==='cal'?'cal':'daily';}
    else if(firstMs!==S.settings.monthStart){firstMs=S.settings.monthStart;subscribePeriod();}
    const wasWay=lockOn()?lockWay():'';try{if(S.settings.pat)localStorage.setItem('moneybook.patOn','1');else localStorage.removeItem('moneybook.patOn');}catch(e){}
    try{if(S.settings.pin)localStorage.setItem('moneybook.pinOn','1');else localStorage.removeItem('moneybook.pinOn');localStorage.setItem('moneybook.lockMin',String(S.settings.lockMin??0));}catch(e){}
    if(!S.settings.pin&&S.pinPending){S.locked=false;}S.pinPending=false;
    if(!S.settingsReady&&S.settings.pin&&!S.unlockedOnce)S.locked=true;
    S.settingsReady=true;if(lockOn()&&wasWay&&wasWay!==lockWay()&&!S.pinIn){$('#lockRoot').innerHTML='';}applyColors();if(!snap.metadata.fromCache)applyRecurring();render();},()=>render());
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
