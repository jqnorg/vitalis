/* ============================================================
   El día: las llamadas (cada toque en Omega, Gizat o Voiso desde la ficha del CRM), los news del día y la pastilla de los que están en New.
   Un cliente en New es lo más urgente, pase lo que pase y haya pasado el tiempo que haya pasado (lo dijo el dueño): no hay "repaso" ni reloj.
   Lo que pide la empresa: un mínimo de llamadas (lo fija el team leader) o 2 h 30 habladas, y cada new llamado. Un intento completo es por las tres líneas.
   ============================================================ */
let calls=[],callsOk=null,callsDay='',stLog=[]; // stLog: los cambios de status de hoy (para saber qué llamadas fueron conversación)
const LINES={omega:'Omega',gizat:'Gizat',voiso:'Voiso'};
const C2C=r=>({uid:r.user_id,id:String(r.client_id),brand:r.brand,line:r.line,at:+new Date(r.at)});
const minCalls=()=>+(teamInfo&&teamInfo.min_calls)||250;
async function callsFetch(){ // las de hoy de toda la mesa
  const day=todayS(),from=parseYMD(day).toISOString();
  const page=i=>Q(sb.from('calls').select('user_id,client_id,brand,line,at').gte('at',from).order('at').order('id').range(i*1000,i*1000+999));
  try{const [pages,log]=await Promise.all([Promise.all([page(0),page(1)]),QO(sb.from('crm_status_log').select('client_id,new_status,new_group,seen_at').gte('seen_at',from).order('seen_at').limit(5000))]);
    while(pages[pages.length-1].length===1000)pages.push(await page(pages.length));return {day,rows:pages.flat(),log}}
  catch(e){return null}
}
function callsApply(x){if(!x){callsOk=false;return}callsOk=true;callsDay=x.day;calls=x.day===todayS()?x.rows.map(C2C):[];stLog=(x.log||[]).map(l=>({id:norm(l.client_id),grp:l.new_group||'',st:norm(l.new_status),at:+new Date(l.seen_at)}))}
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
// los news del día de alguien: los que están en New o Talking y los registrados hoy, sin los depositados
const poolMemo={p:-1,m:new Map()};
function dayPool(uid){
  if(poolMemo.p!==pass){poolMemo.p=pass;poolMemo.m.clear()}
  if(poolMemo.m.has(uid))return poolMemo.m.get(uid);
  const now=Date.now(),items=[];
  for(const r of newsOf(uid)){const k=contactOf(r);items.push({r,k,g:'news',due:inNew(r)})} // en New: urgente siempre
  const done=items.filter(x=>managedAt(x.r)!=null).length,half=items.filter(x=>x.k.today&&!x.k.full&&x.k.lines.size&&now-x.k.last>3*6e4);
  const P={items,done,total:items.length,due:items.filter(x=>x.due),half,n:callsOf(uid)};
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
function hoyBand(){ // los clientes en New, como pastilla en la barra (lo pidió el dueño): se ve en todas las secciones y lleva a la Cola
  const el=$('#hoyBand');if(el){el.hidden=true;el.innerHTML=''}
  const p=$('#sNew');if(!p)return;
  const due=meNeedsDay()?dayPool(me).due:[];
  p.hidden=!due.length;if(!due.length)return;
  p.innerHTML=`<span class="hb-dot" aria-hidden="true"></span>${due.length===1?'<b>1</b> en New':`<b>${due.length}</b> en New`}`;
  p.title=`${plural(due.length,'cliente')} en New, sin gestionar: ${due.length===1?'pasalo':'pasalos'} a Talking. ${due.slice(0,6).map(x=>x.r.id).join(', ')}${due.length>6?'…':''}`;
}

/* ---------- el ritmo del día: tiempo muerto y franja Q (lo definió el dueño, noviembre 2026) ----------
   Hablar no suma ni resta: no depende del agente que el cliente atienda. Lo que se mide es si, cuando no está hablando, marca al ritmo.
   Una llamada cubre CALL_S (50 s de espera + 3 s para cambiar de línea). Los toques seguidos al mismo cliente (Omega, Gizat, Voiso) son un
   intento. Un intento es conversación si después el cliente pasó a Talking (o depositó) antes del siguiente intento. Lo hablado es el tiempo
   en Talking menos 50 s por cada línea que hubo que marcar (1 línea: 50 s; 2: 100 s; 3: 150 s): el tiempo que costó llamarlo no es charla.
   Lo demás, sin descanso marcado, es tiempo muerto.
   El día se cumple con una de dos, sin compensar (lo corrigió el dueño, 24/11/2026): 250 llamadas (teams.min_calls) o 2 h 30 habladas
   (TALK_MIN). La franja sale del tiempo muerto proyectado al día: Q1 menos de 30 min (la mejor) · Q2 hasta 1 h · Q3 más. */
const TALK_MIN=150*6e4,CALL_S=53e3,RING_S=50e3,TALK_MAX=3*36e5,Q_MIN=[30*6e4,60*6e4],TALK_G=['ftd']; // solo news y FTDs: el resultado que se ve es Talking (o el depósito)
const isTalk=l=>/talk|habl/.test(l.st); // Talking: tiempo de llamada justificado
const ritmoMemo={p:-1,m:new Map()};
function ritmo(uid){
  if(ritmoMemo.p!==pass){ritmoMemo.p=pass;ritmoMemo.m.clear()}
  if(ritmoMemo.m.has(uid))return ritmoMemo.m.get(uid);
  const te=todayS(),now=Date.now(),t=uid===me?(openTurno()||turnos[te]):(teamSh[uid]||{})[te];
  let R=null;
  if(t&&t.in){
    const end=t.out||now,brs=(t.breaks||[]).map(b=>[b.s,b.e||now]);
    const brIn=(a,b)=>{let x=0;for(const [s,e] of brs){const lo=Math.max(a,s),hi=Math.min(b,e);if(hi>lo)x+=hi-lo}return x}; // descanso dentro de un tramo
    const L=calls.filter(c=>c.uid===uid&&c.at>=t.in&&c.at<=end).sort((a,b)=>a.at-b.at);
    const talked=(id,from,until)=>{ // pasó a Talking (o ya lo estaba) o depositó antes del siguiente intento
      const k=norm(id),cur=crmStatusOf(id);
      if(cur&&/talk|habl/.test(norm(cur.status))&&cur.since){const t=Date.parse(cur.since);if(t>=from-10*6e4&&t<=until+10*6e4)return true} // pasó a Talking alrededor del intento (uno colgado de días es un error del CRM, no charla)
      return stLog.some(l=>l.id===k&&l.at>=from&&l.at<=until+10*6e4&&(isTalk(l)||TALK_G.includes(l.grp)));
    };
    let dead=0,talk=0,cur=t.in;const segs=[]; // segs: qué pasó en cada tramo del día (para el detalle)
    const seg=(k,a,b,x)=>{if(b-a>=1000)segs.push({k,a,b,...x})}; // k: call · talk · dead · br
    const deadSeg=(a,b)=>{const d=Math.max(0,b-a-brIn(a,b));dead+=d;if(d>0)seg('dead',a,b,{d})};
    // los toques seguidos al mismo cliente son un intento (1, 2 o 3 líneas)
    const G=[];for(const c of L){const g=G[G.length-1];if(g&&norm(g.id)===norm(c.id)&&c.at-g.last<2*6e4){g.n++;g.last=c.at;g.lines.push(c.line)}else G.push({id:c.id,at:c.at,last:c.at,n:1,lines:[c.line]})}
    for(let i=0;i<G.length;i++){
      const g=G[i],nx=G[i+1],until=nx?nx.at:end;
      deadSeg(cur,g.at); // antes de este intento: nada cubría
      const ring=Math.min(until-g.at,g.last-g.at+CALL_S),gap=Math.max(0,until-g.at-ring); // lo que cubren las líneas marcadas; después, el hueco
      seg('call',g.at,g.at+ring,{id:g.id,line:g.lines.join('+'),n:g.n});
      if(gap>0){
        if(talked(g.id,g.at,until)){const x=Math.min(Math.max(0,until-g.at-RING_S*g.n),TALK_MAX);talk+=x;seg('talk',g.at+ring,g.at+ring+Math.max(0,x-(ring-RING_S*g.n)),{id:g.id,n:g.n})} // hablado: el hueco menos 50 s por línea marcada
        else deadSeg(g.at+ring,until);
      }
      cur=until;
    }
    if(!L.length)deadSeg(t.in,end);
    for(const [s,e] of brs)seg('br',s,e,{});
    const brTot=brIn(t.in,end),useful=Math.max(1,end-t.in-brTot),full=t.out?useful:Math.max(useful,jorMs()-brTot);
    const proj=t.out?dead:Math.round(dead/useful*full);
    const req=minCalls(),ok=L.length>=req||talk>=TALK_MIN; // una de las dos, sin compensar
    R={n:L.length,dead,talk,proj,req,ok,talkOk:talk>=TALK_MIN,useful,q:proj<Q_MIN[0]?1:proj<Q_MIN[1]?2:3,young:useful<30*6e4,segs,in:t.in,end,open:!t.out};
  }
  ritmoMemo.m.set(uid,R);return R;
}
// la historia del RMO (rmo_days): se guarda cada 5 min —lo propio; el team leader y el admin, lo de todos— y se lee en Equipo y en Turnos
let rmoLastSig='',rmoRows={},rmoAt={};
function rmoSave(){
  if(!ready||!sb||readOnly||!me)return;
  const te=todayS(),rows=[];
  const add=uid=>{const R=ritmo(uid);if(!R||!R.in)return;rows.push({uid,date:te,n:R.n,talk:Math.round(R.talk),dead:Math.round(R.dead),req:R.req,q:R.q,open:!!R.open})};
  if(isLeader())for(const m of members.filter(m=>m.active&&!isLeadUid(m.id)))add(m.id);else add(me);
  if(!rows.length)return;
  const sig=JSON.stringify(rows.map(r=>[r.uid,r.n,Math.round(r.talk/6e4),Math.round(r.dead/6e4),r.q,r.open]));
  if(sig===rmoLastSig)return;rmoLastSig=sig;
  Q(sb.rpc('rmo_save',{rows})).catch(()=>{rmoLastSig=''});
}
setInterval(()=>{if(!document.hidden)rmoSave()},5*6e4);
async function rmoLoad(from,to){ // los días guardados de la mesa en un rango (cache de 2 min por rango)
  const k=from+'|'+to;if(Date.now()-(rmoAt[k]||0)<12e4)return rmoRows[k]||[];rmoAt[k]=Date.now();
  try{rmoRows[k]=await Q(sb.from('rmo_days').select('user_id,date,n,talk_ms,dead_ms,req,q,open').gte('date',from).lte('date',to).limit(2000))||[]}catch(e){rmoRows[k]=rmoRows[k]||[]}
  return rmoRows[k];
}
const rmoCell=r=>r?`<span class="qb q${r.q}" title="${esc(`${r.n} llamadas de ${r.req??'—'} · ${minsTxt(r.talk_ms)} hablando · ${minsTxt(r.dead_ms)} muertos${r.open?' · en curso':''}`)}">Q${r.q}</span>`:'<span class="d">—</span>';
function rmoHistCard(rows,people,title){ // una tabla agentes × días (los últimos 10 con datos)
  const days=[...new Set(rows.map(r=>r.date))].sort().slice(-10);if(!days.length)return '';
  const by=new Map(rows.map(r=>[r.user_id+'|'+r.date,r]));
  const tr=people.map(m=>{const cells=days.map(d=>`<td>${rmoCell(by.get(m.id+'|'+d))}</td>`).join('');if(!days.some(d=>by.has(m.id+'|'+d)))return '';
    const mine=days.map(d=>by.get(m.id+'|'+d)).filter(Boolean),avg=mine.reduce((a,r)=>a+r.dead_ms,0)/mine.length;
    return `<tr><td><span class="eq-who">${avatar(m.name)}${esc(m.name)}</span></td>${cells}<td class="r"><span class="${avg>=Q_MIN[1]?'hot':avg>=Q_MIN[0]?'warn':''}">${esc(minsTxt(avg))}</span></td></tr>`}).join('');
  return `<div class="card-h"><h3>${esc(title)}</h3><span class="p-sub">la franja de cada día (Q1 la mejor, Q3 la peor) · tocá una para ver llamadas, hablado y muerto</span></div>
    <div class="p-tablewrap"><table class="pt rmo-t"><thead><tr><th>Agente</th>${days.map(d=>`<th title="${esc(dm(d))}">${DIA[parseYMD(d).getDay()]} ${+d.slice(8)}</th>`).join('')}<th class="r">Muerto prom.</th></tr></thead><tbody>${tr}</tbody></table></div>`;
}
const qCls=q=>q===1?'ok':q===2?'warn':'hot';
const minsTxt=ms=>{const m=Math.round(ms/6e4);return m<60?`${m} min`:`${Math.floor(m/60)} h ${z(m%60)}`};
const qBadge=(R,full)=>!R?'<span class="d">sin entrada</span>':R.young?'<span class="d">recién empieza</span>':`<span class="qb q${R.q}">Q${R.q}</span>${full?` <span class="d">${R.q===1?'muy bien':R.q===2?'justo':'mucho tiempo muerto'}</span>`:''}`;
function ritmoLine(uid){ // en palabras: "180 llamadas · 25 min muertos · Q1"
  const R=ritmo(uid);if(!R)return '';
  return `<b class="rmo-t" title="RMO: tu ritmo del día">RMO</b> · <span class="rt-n"><b>${R.n}</b> ${R.n===1?'llamada':'llamadas'}<span class="d"> de ${R.req}</span></span> · <span class="rt-t"><b class="${R.talkOk?'ok':''}">${esc(minsTxt(R.talk))}</b> <span class="d">hablados de 2 h 30</span></span>${R.ok?' <span class="ok" title="Cumplido: 250 llamadas o 2 h 30 habladas">✓</span>':''} · <span class="rt-d"><b class="${R.dead>=Q_MIN[1]?'hot':R.dead>=Q_MIN[0]?'warn':''}">${esc(minsTxt(R.dead))}</b> muertos</span> · ${qBadge(R,true)} <button type="button" class="lnk" data-hy="ritmo" data-uid="${esc(uid)}">Ver qué pasó</button>`;
}
// el detalle del día: la línea de tiempo (llamadas, conversaciones, descansos y huecos) y los huecos más largos, para entender qué pasó
function ritmoModal(uid){
  const R=ritmo(uid);if(!R)return toast('Sin entrada marcada hoy.','warn');
  const nm=uid===me?'Tu día':first(uid),span=Math.max(1,R.end-R.in),P=ms=>Math.max(0,Math.min(100,(ms-R.in)/span*100));
  const name=id=>{const r=crmStatusOf(id);return r&&r.name?clip(r.name,22):''};
  const tl=R.segs.map(s=>`<div class="rs ${s.k}" style="left:${P(s.a)}%;width:${Math.max(.3,P(s.b)-P(s.a))}%" title="${esc(s.k==='call'?`Llamada ${hhmm(s.a)} · ${s.id}`:s.k==='talk'?`Conversación ${hhmm(s.a)}–${hhmm(s.b)} · ${s.id} ${name(s.id)}`:s.k==='br'?`Descanso ${hhmm(s.a)}–${hhmm(s.b)}`:`Sin marcar ${hhmm(s.a)}–${hhmm(s.b)}`)}"></div>`).join('');
  const holes=R.segs.filter(s=>s.k==='dead'&&s.d>=3*6e4).sort((a,b)=>b.d-a.d).slice(0,8);
  const talks=R.segs.filter(s=>s.k==='talk').sort((a,b)=>(b.b-b.a)-(a.b-a.a)).slice(0,6);
  const before=(s)=>{const prev=[...R.segs].filter(x=>x.k==='call'&&x.b<=s.a+1000).sort((x,y)=>y.a-x.a)[0];return prev?`después de llamar a <b>${esc(prev.id)}</b> ${esc(name(prev.id))}${prev.n>1?` (${prev.n} líneas)`:''}`:'antes de la primera llamada'};
  modal({wide:true,title:`RMO · ${esc(nm)} · ${qBadge(R,true)}`,body:`
    <div class="rt-sum"><span><b>${R.n}</b> llamadas <span class="d">de ${R.req}</span></span><span><b class="${R.talkOk?'ok':''}">${esc(minsTxt(R.talk))}</b> hablando <span class="d">de 2 h 30</span></span><span><b class="${R.dead>=Q_MIN[1]?'hot':R.dead>=Q_MIN[0]?'warn':''}">${esc(minsTxt(R.dead))}</b> muertos${R.open?` <span class="d">(a fin de día serían ${esc(minsTxt(R.proj))})</span>`:''}</span></div>
    <div class="rt-tl" role="img" aria-label="Línea de tiempo del día">${tl}</div><div class="tll"><span>${hhmm(R.in)}</span><span>${R.open?'ahora':'salida'} ${hhmm(R.end)}</span></div>
    <div class="legend rt-lg"><span><i class="sw call"></i>Llamada</span><span><i class="sw talk"></i>Conversación</span><span><i class="sw br"></i>Descanso</span><span><i class="sw dead"></i>Sin marcar</span></div>
    <h4 class="rt-h">Huecos sin marcar</h4>${holes.length?`<ul class="rt-list">${holes.map(s=>`<li><b>${esc(minsTxt(s.d))}</b> de ${hhmm(s.a)} a ${hhmm(s.b)}, ${before(s)}</li>`).join('')}</ul>`:'<p class="p-sub" style="margin:0">Ninguno de más de 3 minutos.</p>'}
    ${talks.length?`<h4 class="rt-h">Conversaciones</h4><ul class="rt-list">${talks.map(s=>`<li><b>${esc(minsTxt(s.b-s.a))}</b> desde las ${hhmm(s.a)} con <b>${esc(s.id)}</b> ${esc(name(s.id))}${s.n>1?` <span class="d">(atendió a la ${s.n}ª línea)</span>`:''}</li>`).join('')}</ul>`:''}
    <p class="p-sub" style="margin:10px 0 0">Cada línea marcada cubre 50 s. Es conversación si después el cliente pasó a Talking antes del siguiente intento; se le restan 50 s por línea marcada. Los descansos marcados no cuentan.</p>`,
    actions:[{l:'Listo',cls:'pri'}]});
}

/* ---------- en Equipo: las llamadas de hoy de cada agente (texto; el team leader fija el mínimo) ---------- */
function paceTxt(pc){if(pc.exp==null)return 'sin Entrada marcada';if(pc.n>=pc.min)return 'mínimo cumplido';if(pc.exp<10)return 'recién empieza su jornada';return pc.ok?`va bien · a esta altura, ${pc.exp}`:`va atrasado · a esta altura, ${pc.exp}`}
function callsMesaCard(){
  if(callsOk===false)return '';
  const all=sellers(team).filter(m=>!isLeadUid(m.id)).map(m=>({m,pc:dayPace(m.id),P:crm.ok?dayPool(m.id):null})).sort((a,b)=>b.pc.n-a.pc.n||a.m.name.localeCompare(b.m.name));
  const on=all.filter(x=>x.pc.n||(x.P&&x.P.total)),off=all.filter(x=>!(x.pc.n||(x.P&&x.P.total)));
  const row=({m,pc,P})=>{const R=ritmo(m.id),sp2=crm.ok?newSpeedOf(m.id,todayS(),todayS()):null;return `<tr><td><span class="eq-who">${avatar(m.name)}<b>${esc(m.name)}</b></span></td><td><b class="${R&&pc.n>=R.req?'ok':''}">${pc.n}</b><span class="d">/${R?R.req:pc.min}</span>${R?` <span class="d">· <b class="${R.talkOk?'ok':''}">${esc(minsTxt(R.talk))}</b> hablados</span>`:''}</td>
    <td>${R?`<button type="button" class="lnkp" data-hy="ritmo" data-uid="${esc(m.id)}" title="Ver qué pasó">${esc(minsTxt(R.dead))}</button>`:'<span class="d">—</span>'}</td><td>${qBadge(R)}</td><td>${P?`${P.done}<span class="d">/${P.total}</span>`:''}</td><td>${P&&P.due.length?sp('hot b',String(P.due.length)):'<span class="d">—</span>'}</td><td title="De que lo tiene el agente a Talking (mediana de los news de hoy)">${sp2&&sp2.n?`<b class="${sp2.med>5?'hot':'ok'}">${esc(minTxt2(sp2.med))}</b>`:'<span class="d">—</span>'}</td></tr>`};
  return `<div class="card-h"><h3>Llamadas de hoy</h3><span class="p-sub">llamadas, tiempo muerto y franja: Q1 menos de 30 min muertos en el día · Q2 hasta 1 h · Q3 más</span><span class="grow"></span>${isLeader()?`<button type="button" class="btn sm" data-hy="min" title="Llamadas mínimas por día">Mínimo ${minCalls()} ✎</button>`:''}</div>
    ${on.length?`<div class="p-tablewrap"><table class="pt eq-calls"><thead><tr><th>Agente</th><th>Llamadas</th><th title="RMO: tiempo muerto del día">Muerto</th><th title="RMO: franja del día (Q1 la mejor, Q3 la peor)">RMO</th><th title="De sus news de hoy, cuántos ya pasó a Talking">News de hoy gestionados</th><th>En New</th><th title="Velocidad al new: de que lo tiene el agente a Talking">Al new en</th></tr></thead><tbody>${on.map(row).join('')}</tbody></table></div>`:'<div class="p-empty">Todavía nadie llamó hoy.</div>'}
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
  if(a==='ritmo')return ritmoModal(b.dataset.uid||me);
});

/* ---------- el cierre del día (pedido del dueño, noviembre 2026) ----------
   Al marcar Salida, el agente ve su resumen (cierreModal: llamadas, hablado, muerto y franja, FTDs y CR (%) del día, agendas).
   A las 17:35 (CIERRE_HM) el Vitalis del team leader o del admin arma el de la mesa (cierreTxt) y lo manda por el chat como Vitalis
   (day_close: lo guarda en day_closes —uno por día, así no se repite aunque haya varios abiertos— y lo escribe en el privado de
   cada team leader y admin con Vitalis). Los viernes va con el ranking de la semana. */
const CIERRE_HM='17:35',CIERRE_MAX='23:30';
function diaDe(uid){ // los números del día de alguien
  const te=todayS(),R=ritmo(uid),cv=convPeriod(te,te,uid),ag=agStats(uid),F=team.filter(f=>f.uid===uid&&f.date===te);
  const talks=R?new Set(R.segs.filter(s=>s.k==='talk').map(s=>norm(s.id))).size:0;
  const hechas=agOf(uid).filter(p=>p.done&&p.doneAt&&ymd(new Date(p.doneAt))===te).length;
  return {R,ftd:F.length,ftdNew:F.filter(f=>!isLate(f)).length,news:cv.leads,cr:cv.leads?cv.ftd/cv.leads:null,talks,venc:ag.venc,hechas};
}
function cierreFrase(D){ // una línea, en buena onda
  const R=D.R;if(!R)return '';
  const out=[];
  if(D.ftd)out.push(D.ftd===1?'Cerraste una venta.':`Cerraste ${D.ftd} ventas.`);
  if(R.ok)out.push(R.n>=R.req?'Llegaste a las llamadas del día.':'Cumpliste el día con lo hablado.');else out.push(`Te faltaron ${R.req-R.n} llamadas (o ${esc(minsTxt(TALK_MIN-R.talk))} de charla) para cumplir el día.`);
  if(!R.young&&R.q===3)out.push(`Mucho tiempo muerto (${minsTxt(R.dead)}): mirá en "Ver qué pasó" dónde se fue.`);
  if(D.venc)out.push(`Tenés ${plural(D.venc,'agenda vencida','agendas vencidas')} sin cerrar.`);
  return out.join(' ');
}
async function cierreModal(){ // "Tu día", al marcar Salida
  if(!meNeedsDay())return;
  const D=diaDe(me),R=D.R;
  const li=(k,v,c)=>`<li><span>${k}</span><b class="${c||''}">${v}</b></li>`;
  modal({title:'Tu día',body:`<ul class="dia-l">
    ${li('Llamadas',R?`${R.n} de ${R.req}`:'—',R?(R.n>=R.req?'ok':R.ok?'':'hot'):'')}
    ${li('Hablado',R?`${esc(minsTxt(R.talk))} de 2 h 30 · ${plural(D.talks,'conversación','conversaciones')}`:'—',R?(R.talkOk?'ok':R.ok?'':'hot'):'')}
    ${li('Tiempo muerto',R?`${esc(minsTxt(R.dead))} ${qBadge(R)}`:'—',R?(R.young?'':R.q===3?'hot':R.q===2?'warn':'ok'):'')}
    ${li('FTDs',`${D.ftd}${D.cr!=null?` <span class="d">· CR (%) del día ${pct(D.cr)}: ${D.ftdNew} de ${plural(D.news,'new')}</span>`:''}`,D.ftd?'ok':'')}
    ${li('Agendas',`${D.hechas} hechas${D.venc?` · <span class="hot">${D.venc} vencidas sin cerrar</span>`:''}`)}
  </ul><p class="dia-f">${esc(cierreFrase(D))}</p>`,
  actions:[...(R?[{l:'Ver qué pasó',fn:()=>{setTimeout(()=>ritmoModal(me),50)}}]:[]),{l:'Listo',cls:'pri'}]});
}
const nombres=L=>L.map(x=>first(x.m.id)).join(', ');
async function cierreTxt(){ // el resumen de la mesa, en texto plano para el chat
  const te=todayS(),ym=ymNow(),D=cmData(),rows=D.rows.filter(p=>p.tu.k!=='none'||p.ftd||p.pc.n);
  const mes=team.filter(f=>f.date.slice(0,7)===ym).length,T=+targets[ym]||0,hoy=team.filter(f=>f.date===te);
  const L=[`Cierre del ${AG_DIA[parseYMD(te).getDay()].toLowerCase()} ${dm(te)}`];
  const porAg=rows.filter(p=>p.ftd).sort((a,b)=>b.ftd-a.ftd).map(p=>`${first(p.m.id)} ${p.ftd}`).join(', ');
  L.push(`FTDs de hoy: ${hoy.length}${porAg?` (${porAg})`:''} · el mes: ${mes}${T?` de ${T}`:''}`);
  const done=p=>p.pc.n>=minCalls()||(p.R&&p.R.talkOk),ok=rows.filter(done),no=rows.filter(p=>!done(p)); // 250 llamadas o 2 h 30 habladas
  L.push(`Llamadas: ${nf(D.callsN)}${ok.length?` · cumplieron el día (250 llamadas o 2 h 30 habladas): ${nombres(ok)}`:''}${no.length?` · no llegaron: ${no.map(p=>`${first(p.m.id)} ${p.pc.n} llamadas${p.R?`, ${minsTxt(p.R.talk)} hablados`:''}`).join(', ')}`:''}`);
  const q=n=>rows.filter(p=>p.R&&!p.R.young&&p.R.q===n);
  if(q(1).length+q(2).length+q(3).length)L.push(`RMO: ${[q(1).length&&`Q1 ${nombres(q(1))}`,q(2).length&&`Q2 ${nombres(q(2))}`,q(3).length&&`Q3 ${q(3).map(p=>`${first(p.m.id)} (${minsTxt(p.R.dead)} muertos)`).join(', ')}`].filter(Boolean).join(' · ')}`);
  const cv=convPeriod(te,te,null);if(cv.leads)L.push(`CR (%) del día: ${pct(cv.ftd/cv.leads)} (${cv.ftd} de ${plural(cv.leads,'new')})`);
  const sp2=newSpeedOf(null,te,te);if(sp2.n)L.push(`Velocidad al new: ${minTxt2(sp2.med)} de que lo tiene el agente a Talking (mediana de ${plural(sp2.n,'new')}${sp2.slow?`; ${sp2.slow} tardaron más de 5 min`:''})`);
  const venc=rows.filter(p=>p.venc).map(p=>`${first(p.m.id)} ${p.venc}`).join(', ');
  L.push(`Agendas vencidas: ${venc||'ninguna'}`);
  if(parseYMD(te).getDay()===5){ // viernes: el ranking de la semana
    const w0=weekStart(te),W=new Map();for(const f of team)if(f.date>=w0&&f.date<=te&&!isLeadUid(f.uid))W.set(f.uid,(W.get(f.uid)||0)+1);
    let C=new Map();try{for(const r of await rmoLoad(w0,te))C.set(r.user_id,(C.get(r.user_id)||0)+(+r.n||0))}catch(e){}
    const rk=members.filter(m=>m.active&&!isLeadUid(m.id)).map(m=>({m,f:W.get(m.id)||0,c:C.get(m.id)||0})).sort((a,b)=>b.f-a.f||b.c-a.c);
    if(rk.length)L.push(`Ranking de la semana: ${rk.map((x,i)=>`${i+1}) ${first(x.m.id)} ${plural(x.f,'FTD')}${x.c?`, ${nf(x.c)} llamadas`:''}`).join(' · ')}`);
  }
  return L.join('\n');
}
let cierreBusy=false;
async function cierreCheck(){ // a las 17:35 de un día de trabajo, una vez por día (day_closes lo frena si otro ya lo mandó)
  if(!ready||!sb||readOnly||!isLeader()||cierreBusy)return;
  const te=todayS(),w=noTrabajo(te);if(w&&w!=='falta')return;
  const hm=nowHM();if(hm<CIERRE_HM||hm>CIERRE_MAX||local.get('cierre')===te)return;
  cierreBusy=true;
  try{const txt=await cierreTxt();const r=await Q(sb.rpc('day_close',{d:te,txt}));local.set('cierre',te);if(r&&!r.dup)toast('Vitalis mandó el cierre del día de la mesa al chat.','ok')}
  catch(e){}finally{cierreBusy=false}
}
setInterval(cierreCheck,6e4);
