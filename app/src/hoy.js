/* ============================================================
   El día: las llamadas (cada toque en Omega, Gizat o Voiso desde la ficha del CRM), el pool del día y la franja de news por repasar.
   Lo que pide la empresa: un mínimo de llamadas (lo fija el team leader), cada NA (1 a 4), CA, HU, CallBack y Pending
   llamado al menos una vez en el día, y los news del día repasados cada menos de 2 h. Un intento completo es por las tres líneas.
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

/* ---------- en Equipo: las llamadas de hoy de cada agente (texto; el team leader fija el mínimo) ---------- */
function paceTxt(pc){if(pc.exp==null)return 'sin Entrada marcada';if(pc.n>=pc.min)return 'mínimo cumplido';if(pc.exp<10)return 'recién empieza su jornada';return pc.ok?`va bien · a esta altura, ${pc.exp}`:`va atrasado · a esta altura, ${pc.exp}`}
function callsMesaCard(){
  if(callsOk===false)return '';
  const all=sellers(team).filter(m=>!isLeadUid(m.id)).map(m=>({m,pc:dayPace(m.id),P:crm.ok?dayPool(m.id):null})).sort((a,b)=>b.pc.n-a.pc.n||a.m.name.localeCompare(b.m.name));
  const on=all.filter(x=>x.pc.n||(x.P&&x.P.total)),off=all.filter(x=>!(x.pc.n||(x.P&&x.P.total)));
  const row=({m,pc,P})=>`<tr><td><span class="eq-who">${avatar(m.name)}<b>${esc(m.name)}</b></span></td><td title="${esc(paceTxt(pc))}"><b class="${pc.n>=pc.min?'ok':pc.ok===false?'hot':''}">${pc.n}</b><span class="d">/${pc.min}</span></td>
    <td>${P?`${P.done}<span class="d">/${P.total}</span>`:''}</td><td>${P&&P.due.length?sp('hot b',String(P.due.length)):'<span class="d">—</span>'}</td></tr>`;
  return `<div class="card-h"><h3>Llamadas de hoy</h3><span class="p-sub">toques en Omega, Gizat o Voiso (estimado)</span><span class="grow"></span>${isLeader()?`<button type="button" class="btn sm" data-hy="min" title="Llamadas mínimas por día">Mínimo ${minCalls()} ✎</button>`:''}</div>
    ${on.length?`<div class="p-tablewrap"><table class="pt eq-calls"><thead><tr><th>Agente</th><th>Llamadas</th><th>Pool llamado hoy</th><th>News por repasar</th></tr></thead><tbody>${on.map(row).join('')}</tbody></table></div>`:'<div class="p-empty">Todavía nadie llamó hoy.</div>'}
    ${off.length&&on.length?`<p class="p-sub" style="margin:10px 2px 0">Sin llamadas ni pool todavía: ${off.map(x=>esc(first(x.m.id))).join(', ')}</p>`:''}`;
}
function minModal(){
  if(!isLeader())return;
  modal({title:'Llamadas mínimas por día',body:`<p class="mp">Cada toque en Omega, Gizat o Voiso cuenta una (es un estimado). La meta de cada agente.</p><label class="fld" style="max-width:160px"><span>Mínimo</span><input id="mcN" inputmode="numeric" value="${minCalls()}"></label><div class="ebox" id="mcE"></div>`,
    actions:[{l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{const n=parseInt(api.q('#mcN').value,10);if(!(n>=1&&n<=2000)){api.q('#mcE').textContent='Entre 1 y 2000.';return false}
      const r=await B.rpc('set_min_calls',{n});if(!r)return false;teamInfo.min_calls=n;toast(`Mínimo de llamadas: ${n} por día.`);refresh()}}]});
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-hy],[data-hb]');if(!b||!ready)return;
  const a=b.dataset.hy||b.dataset.hb;
  if(a==='ficha')return openFicha(b.dataset.id);
  if(a==='min')return minModal();
});
