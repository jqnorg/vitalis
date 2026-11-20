/* ============================================================
   El día: las llamadas (cada toque en Omega, Gizat o Voiso desde la ficha del CRM), el pool del día y el cielo.
   Lo que pide la empresa: un mínimo de llamadas (lo fija el team leader), cada NA (1 a 4), CA, HU, CallBack y Pending
   llamado al menos una vez en el día, y los news del día repasados cada menos de 2 h. Un intento completo es por las tres líneas.
   El cielo: cada cliente de tu pool es una estrella; apagada sin llamar hoy, a medias por una o dos líneas, encendida por las tres.
   ============================================================ */
let calls=[],callsOk=null,callsDay='';
const LINES={omega:'Omega',gizat:'Gizat',voiso:'Voiso'};
const C2C=r=>({uid:r.user_id,id:String(r.client_id),brand:r.brand,line:r.line,at:+new Date(r.at)});
const REPASO=105*6e4; // un new del día pide repaso a la 1 h 45 sin llamada
const minCalls=()=>+(teamInfo&&teamInfo.min_calls)||250;
async function callsFetch(){ // las de hoy de toda la mesa
  const day=todayS(),from=parseYMD(day).toISOString();
  const page=i=>Q(sb.from('calls').select('user_id,client_id,brand,line,at').gte('at',from).order('at').order('id').range(i*1000,i*1000+999));
  try{const pages=await Promise.all([page(0),page(1)]);while(pages[pages.length-1].length===1000)pages.push(await page(pages.length));return {day,rows:pages.flat()}}
  catch(e){return null}
}
function callsApply(x){if(!x){callsOk=false;return}callsOk=true;callsDay=x.day;calls=x.day===todayS()?x.rows.map(C2C):[]}
const sameCall=(a,b)=>a.uid===b.uid&&norm(a.id)===norm(b.id)&&a.line===b.line&&Math.abs(a.at-b.at)<30e3;
function callAdd(c){if(calls.some(x=>sameCall(x,c)))return false;calls.push(c);return true}
function callLive(p){if(p.eventType!=='INSERT'||!p.new||p.new.team_id!==profile.team_id)return;if(callAdd(C2C(p.new)))refresh()}
// lo que mandó la extensión: los toques (pueden venir atrasados si Vitalis estaba cerrado)
async function callsFromExt(rows){
  const list=rows.filter(r=>r&&/^(omega|gizat|voiso)$/.test(r.ln)&&String(r.id||'').trim()).slice(0,500).map(r=>({id:String(r.id).trim().slice(0,60),brand:String(r.brand||'').slice(0,40),line:r.ln,at:r.at}));
  if(!list.length)return true;
  await Q(sb.rpc('calls_add',{rows:list}));
  let ch=false;for(const c of list){const t=+new Date(c.at);if(isFinite(t)&&t>=+parseYMD(todayS()))ch=callAdd({uid:me,id:c.id,brand:c.brand||DEF_BRAND,line:c.line,at:t})||ch}
  if(ch)refresh();return true;
}

/* ---------- cuentas del día ---------- */
const callIdx=perPass(()=>{
  const te=todayS();if(callsDay!==te){calls=[];callsDay=te}
  const by=new Map(),n=new Map();
  for(const c of calls){const k=norm(c.id);let o=by.get(k);if(!o)by.set(k,o={lines:new Set(),last:0,first:Infinity,uids:new Set()});o.lines.add(c.line);o.last=Math.max(o.last,c.at);o.first=Math.min(o.first,c.at);o.uids.add(c.uid);n.set(c.uid,(n.get(c.uid)||0)+1)}
  return {by,n};
});
const callsOf=uid=>callIdx().n.get(uid)||0;
// contacto de hoy: las llamadas registradas y, de respaldo, el último contacto que muestra el CRM
function contactOf(r){
  const c=callIdx().by.get(norm(r.id)),ca=callAt(r),crmHoy=!!ca&&ymd(ca)===todayS();
  return {lines:c?c.lines:new Set(),last:Math.max(c?c.last:0,ca?+ca:0),first:c?c.first:Infinity,today:!!c||crmHoy,full:!!c&&c.lines.size>=3};
}
const NEWS_OUT=['dnc','invalid','not_interested','ftd','crm','failed','otro','low_potential'];
// el pool del día de alguien: news registrados hoy + NA 1 a 4, CA, HU, CallBack y Pending (sin los depositados)
const poolMemo={p:-1,m:new Map()};
function dayPool(uid){
  if(poolMemo.p!==pass){poolMemo.p=pass;poolMemo.m.clear()}
  if(poolMemo.m.has(uid))return poolMemo.m.get(uid);
  const S=soldIdx(),te=todayS(),now=Date.now();
  const rotIn=new Set((crm.rot||[]).filter(x=>agentUid(x.new_agent)===uid).map(x=>norm(x.client_id)));
  const items=[];
  for(const r of crm.rows.values()){
    if(isArch(r.brand)||crmOwner(r)!==uid||paidCrm(r)||S.has(ckey(r.brand,r.id)))continue;
    const news=regDay(r)===te&&!NEWS_OUT.includes(r.grp);
    const g=news?'news':['callback','pending'].includes(r.grp)?'cb':(['call_again','hang_up'].includes(r.grp)||(r.grp==='na'&&naNum(r.status)<=NA_MAX))?'g3':null;
    if(!g)continue;
    const k=contactOf(r);
    if(!news&&rotIn.has(norm(r.id))&&k.today)continue; // te lo rotaron hoy y ya lo llamó alguien: no entra en tu meta
    items.push({r,k,g,due:news&&(!k.last||now-k.last>REPASO)});
  }
  const done=items.filter(x=>x.k.today).length,half=items.filter(x=>x.k.today&&!x.k.full&&x.k.lines.size&&now-x.k.last>3*6e4);
  const P={items,done,total:items.length,due:items.filter(x=>x.due).sort((a,b)=>(a.k.last||0)-(b.k.last||0)),half,n:callsOf(uid)};
  poolMemo.m.set(uid,P);return P;
}
// el ritmo: desde tu entrada (o tu primera llamada) hasta el fin de tu jornada
function dayPace(uid){
  const n=callsOf(uid),min=minCalls(),te=todayS();
  const t=uid===me?(openTurno()||turnos[te]):(teamSh[uid]||{})[te];
  let start=t&&t.in;if(!start){for(const c of calls)if(c.uid===uid)start=Math.min(start||Infinity,c.at)}
  if(!start||!isFinite(start))return {n,min,exp:null,ok:null};
  const end=t&&t.out?t.out:Date.now(),f=Math.max(0,Math.min(1,(end-start)/jorMs())),exp=Math.round(min*f);
  return {n,min,exp,ok:n>=exp*.9,f};
}
const meNeedsDay=()=>!!profile&&!isLeadUid(me)&&crm.ok;

/* ---------- la franja: los news del día que piden repaso (sin sonido; se ve estando en Vitalis) ---------- */
function hoyBand(){
  const el=$('#hoyBand');if(!el)return;
  const due=meNeedsDay()?dayPool(me).due:[];
  if(!due.length){el.hidden=true;el.innerHTML='';return}
  el.hidden=false;
  el.innerHTML=`<span class="hb-dot" aria-hidden="true"></span><b>${due.length===1?'Falta 1 new por repasar':`Faltan ${due.length} news por repasar`}</b>
    <span class="hb-list">${due.slice(0,5).map(x=>`<button type="button" class="chip" data-hb="ficha" data-id="${esc(x.r.id)}" title="${esc(x.k.last?'Último contacto '+rel(new Date(x.k.last)):'Sin llamar todavía')}"><b>${esc(x.r.id)}</b> ${esc(clip(x.r.name||'',18))}<small>${x.k.last?esc(rel(new Date(x.k.last))):'sin llamar'}</small></button>`).join('')}${due.length>5?`<span class="d">y ${due.length-5} más</span>`:''}</span>
    <span class="grow"></span><button type="button" class="btn sm" data-go="ahora">Ver la cola</button>`;
}

/* ---------- el cielo ---------- */
const fnv=s=>{let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
const rnd=seed=>()=>{seed=Math.imul(seed^seed>>>15,2246822507)^Math.imul(seed^seed>>>13,3266489909);return ((seed^=seed>>>16)>>>0)/4294967296};
const linesTxt=k=>k.lines.size?[...k.lines].map(l=>LINES[l]).join(' · '):k.today?'en el CRM':'sin llamar hoy';
function skySVG(P,uid,o={}){
  const W=o.w||1000,H=o.h||250,mini=!!o.mini,pad=mini?6:18;
  const R=rnd(fnv(uid||'mesa')),dust=Array.from({length:mini?18:70},()=>`<circle cx="${(R()*W).toFixed(1)}" cy="${(R()*H).toFixed(1)}" r="${(R()*.9+.25).toFixed(2)}" class="dust"/>`).join('');
  const pos=x=>{const h=fnv(norm(x.r.id)),h2=fnv(x.r.id+'·');return [pad+(h%10007)/10007*(W-2*pad),pad+(h2%10009)/10009*(H-2*pad)]};
  const sz=x=>(mini?{news:3.2,cb:2.6,g3:2.1}:{news:6.5,cb:5,g3:4})[x.g];
  const st=x=>x.k.full?'full':x.k.today?'half':'off';
  // el recorrido del día: las estrellas en el orden en que las llamaste
  const trail=!mini&&P.items.filter(x=>isFinite(x.k.first)).sort((a,b)=>a.k.first-b.k.first).map(x=>pos(x).map(v=>v.toFixed(1)).join(',')).join(' ');
  const stars=P.items.map(x=>{const [cx,cy]=pos(x),r=sz(x),s=st(x);
    const tip=`${x.r.id} ${x.r.name||''} · ${x.r.status||''} · ${x.g==='news'?'new de hoy · ':''}${linesTxt(x.k)}${x.k.last?' · '+rel(new Date(x.k.last)):''}`;
    return `<g class="st ${s} ${x.g}${x.due?' due':''}" data-id="${esc(x.r.id)}" transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)})"${mini?'':` tabindex="0" role="button" aria-label="${esc(tip)}"`}><title>${esc(tip)}</title>
      ${s!=='off'?`<circle class="halo" r="${(r*(s==='full'?3.4:2.2)).toFixed(1)}"/>`:''}${x.due?`<circle class="ring" r="${(r*2.1).toFixed(1)}"/>`:''}<circle class="core" r="${r}"/>${s==='half'&&!mini?`<circle class="part" r="${(r+2.2).toFixed(1)}" pathLength="3" stroke-dasharray="${x.k.lines.size} 3"/>`:''}</g>`}).join('');
  return `<svg class="sky${mini?' mini':''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(`${P.done} de ${P.total} clientes llamados hoy`)}">
    <defs><radialGradient id="skg"><stop offset="0" stop-color="currentColor" stop-opacity=".55"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient></defs>
    ${dust}${trail?`<polyline class="trail" points="${trail}"/>`:''}${stars}</svg>`;
}
const pctOf=(a,b)=>b?Math.round(a/b*100):0;
function meter(lb,v,max,sub,mark){const p=Math.min(100,pctOf(v,max));return `<div class="hm"><div class="hm-l"><span>${lb}</span><b>${v}<small>/${max}</small></b></div><div class="hm-b"><i style="width:${p}%"></i>${mark!=null?`<s style="left:${Math.min(100,pctOf(mark,max))}%" title="A esta altura de tu jornada"></s>`:''}</div><div class="hm-s">${sub}</div></div>`}
function paceTxt(pc){if(pc.exp==null)return 'marcá Entrada para medir tu ritmo';if(pc.n>=pc.min)return 'mínimo cumplido';if(pc.exp<10)return 'recién empieza tu jornada';return pc.ok?`vas bien · a esta altura, ${pc.exp}`:`vas atrasado · a esta altura, ${pc.exp}`}
// en el inicio: tu cielo arriba y el de cada uno de la mesa; el team leader ve la mesa entera
function cieloCard(){
  if(crm.ok===false)return '';
  const TL=isLeadUid(me),ag=sellers(team).filter(m=>!isLeadUid(m.id));
  const minBtn=isLeader()?`<button type="button" class="btn sm" data-hy="min" title="Llamadas mínimas por día">Mínimo ${minCalls()} ✎</button>`:'';
  const legend=`<div class="sky-leg"><span><i class="lg off"></i>sin llamar hoy</span><span><i class="lg half"></i>a medias (1 o 2 líneas)</span><span><i class="lg full"></i>las 3 líneas</span><span><i class="lg news"></i>new de hoy</span></div>`;
  // los que todavía no tienen pool ni llamadas van en una línea (sin cielos vacíos)
  const act=m=>{const P=dayPool(m.id);return P.total||P.n},grid=L=>{const on=L.filter(act),off=L.filter(m=>!act(m));
    return (on.length?`<div class="sky-grid${TL?' big':''}">${on.map(mini).join('')}</div>`:'')+(off.length?`<p class="sky-off">Sin pool ni llamadas todavía: ${off.map(m=>`<button type="button" class="lnkp" data-hy="ver" data-uid="${esc(m.id)}">${esc(first(m.id))}</button>`).join(', ')}</p>`:'')};
  const mini=m=>{const P=dayPool(m.id),pc=dayPace(m.id);return `<button type="button" class="sky-mini" data-hy="ver" data-uid="${esc(m.id)}" title="Ver el cielo de ${esc(m.name)}">
      <span class="smh">${avatar(m.name)}<b>${esc(first(m.id))}</b><span class="d">${pc.n}/${pc.min}</span><span class="d">${P.done}/${P.total}</span>${P.due.length?`<span class="badge bad" title="News por repasar">${P.due.length}</span>`:''}</span>${skySVG(P,m.id,{mini:true,w:320,h:90})}</button>`};
  if(TL){
    const tot=ag.reduce((a,m)=>{const P=dayPool(m.id);a.d+=P.done;a.t+=P.total;a.n+=P.n;a.r+=P.due.length;return a},{d:0,t:0,n:0,r:0});
    return `<div class="card-h"><h3>El cielo de la mesa</h3><span class="p-sub">${tot.n} llamadas · ${tot.d}/${tot.t} del pool llamados hoy${tot.r?` · ${sp('hot',plural(tot.r,'new por repasar','news por repasar'))}`:''}</span><span class="grow"></span>${minBtn}</div>
      ${grid(ag)||'<div class="p-empty">Todavía no hay agentes con clientes.</div>'}${legend}`;
  }
  const P=dayPool(me),pc=dayPace(me);
  const halfTxt=P.half.length?`<div class="sky-half"><span class="d">Quedaron a medias:</span>${P.half.slice(0,6).map(x=>`<button type="button" class="chip" data-hy="ficha" data-id="${esc(x.r.id)}" title="Te falta ${esc(Object.keys(LINES).filter(l=>!x.k.lines.has(l)).map(l=>LINES[l]).join(' y '))}"><b>${esc(x.r.id)}</b> ${esc([...x.k.lines].map(l=>LINES[l]).join(' · '))}</button>`).join('')}${P.half.length>6?`<span class="d">y ${P.half.length-6} más</span>`:''}</div>`:'';
  const others=ag.filter(m=>m.id!==me);
  return `<div class="card-h"><h3>Tu cielo de hoy</h3><span class="p-sub">${P.total?`${P.done} de ${P.total} encendidas`:'Tu pool aparece cuando la extensión ve tus clientes en el CRM'}</span><span class="grow"></span>${minBtn}</div>
    <div class="hmeters">${meter('Llamadas',pc.n,pc.min,esc(paceTxt(pc)),pc.exp)}${meter('Pool del día',P.done,P.total||0,'NA 1 a 4, CA, HU, CallBack y Pending: una vez por día')}${meter('News por repasar',P.due.length,P.items.filter(x=>x.g==='news').length,'cada menos de 2 h')}</div>
    <div class="sky-wrap" data-hy="sky">${skySVG(P,me)}</div>${legend}${halfTxt}
    ${others.length?`<h4 class="sky-h">La mesa hoy</h4>${grid(others)}`:''}`;
}
function cieloModal(uid){
  const m=members.find(x=>x.id===uid);if(!m)return;
  const P=dayPool(uid),pc=dayPace(uid);
  modal({title:`El cielo de ${esc(m.name)}`,wide:true,body:`<div class="hmeters">${meter('Llamadas',pc.n,pc.min,esc(paceTxt(pc)),pc.exp)}${meter('Pool del día',P.done,P.total,'llamados hoy')}${meter('News por repasar',P.due.length,P.items.filter(x=>x.g==='news').length,'cada menos de 2 h')}</div>
    <div class="sky-wrap" data-hy="sky">${skySVG(P,uid)}</div>`,
    onOpen:api=>api.box.addEventListener('click',e=>{const s=e.target.closest('.st[data-id]');if(s){api.close();openFicha(s.dataset.id)}}),actions:[{l:'Cerrar'}]});
}
function minModal(){
  if(!isLeader())return;
  modal({title:'Llamadas mínimas por día',body:`<p class="mp">Cada toque en Omega, Gizat o Voiso cuenta una (es un estimado). La meta de cada agente en su cielo de hoy.</p><label class="fld" style="max-width:160px"><span>Mínimo</span><input id="mcN" inputmode="numeric" value="${minCalls()}"></label><div class="ebox" id="mcE"></div>`,
    actions:[{l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{const n=parseInt(api.q('#mcN').value,10);if(!(n>=1&&n<=2000)){api.q('#mcE').textContent='Entre 1 y 2000.';return false}
      const r=await B.rpc('set_min_calls',{n});if(!r)return false;teamInfo.min_calls=n;toast(`Mínimo de llamadas: ${n} por día.`);refresh()}}]});
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-hy],[data-hb]');if(!b||!ready)return;
  const a=b.dataset.hy||b.dataset.hb;
  if(a==='ficha')return openFicha(b.dataset.id);
  if(a==='ver')return cieloModal(b.dataset.uid);
  if(a==='min')return minModal();
  if(a==='sky'){const s=e.target.closest('.st[data-id]');if(s)openFicha(s.dataset.id)}
});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('.sky .st[data-id]')){e.preventDefault();openFicha(e.target.dataset.id)}});
