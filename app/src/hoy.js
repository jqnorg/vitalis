/* ============================================================
   El día: las llamadas (cada toque en Omega, Gizat o Voiso desde la ficha del CRM), el pool del día y la franja de los que están en New.
   Un cliente en New es lo más urgente, pase lo que pase y haya pasado el tiempo que haya pasado (lo dijo el dueño): no hay "repaso" ni reloj.
   Lo que pide la empresa: un mínimo de llamadas (lo fija el team leader), cada NA (NA a NA-4: días de llamadas, sin llamarlo no avanza), CA, HU, CallBack y Pending
   llamado al menos una vez en el día, y los news del día repasados cada menos de 2 h. Un intento completo es por las tres líneas.
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
    const inNew=r.grp==='new'&&!/talk|habl/.test(norm(r.status)),news=inNew||(regDay(r)===te&&!NEWS_OUT.includes(r.grp));
    const g=news?'news':['callback','pending'].includes(r.grp)?'cb':(['call_again','hang_up'].includes(r.grp)||(r.grp==='na'&&naNum(r.status)<=NA_MAX))?'g3':null;
    if(!g)continue;
    const k=contactOf(r);
    if(!news&&rotIn.has(norm(r.id))&&k.today)continue; // te lo rotaron hoy y ya lo llamó alguien: no entra en tu meta
    items.push({r,k,g,due:inNew}); // en New: urgente siempre
  }
  const done=items.filter(x=>x.k.today).length,half=items.filter(x=>x.k.today&&!x.k.full&&x.k.lines.size&&now-x.k.last>3*6e4);
  const P={items,done,total:items.length,due:items.filter(x=>x.due).sort((a,b)=>byRegDesc(a.r,b.r)),half,n:callsOf(uid)};
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
  const due=meNeedsDay()&&cur!=='ahora'&&cur!=='agenda'?dayPool(me).due:[]; // en el Panel ya está la cola: ahí no se repite
  if(!due.length){el.hidden=true;el.innerHTML='';return}
  el.hidden=false;
  el.innerHTML=`<span class="hb-dot" aria-hidden="true"></span><b>${due.length===1?'1 cliente en New: llamalo ya':`${due.length} clientes en New: llamalos ya`}</b>
    <span class="hb-list">${due.slice(0,5).map(x=>`<button type="button" class="chip" data-hb="ficha" data-id="${esc(x.r.id)}" title="${esc(x.k.last?'Último contacto '+rel(new Date(x.k.last)):'Sin llamar todavía')}"><b>${esc(x.r.id)}</b> ${esc(clip(x.r.name||'',18))}<small>${x.k.last?esc(rel(new Date(x.k.last))):'sin llamar'}</small></button>`).join('')}${due.length>5?`<span class="d">y ${due.length-5} más</span>`:''}</span>
    <span class="grow"></span><button type="button" class="btn sm" data-go="ahora">Ver la cola</button>`;
}

/* ---------- el ritmo del día: tiempo muerto y franja Q (lo definió el dueño, noviembre 2026) ----------
   Hablar no suma ni resta: no depende del agente que el cliente atienda. Lo que se mide es si, cuando no está hablando, marca al ritmo.
   Una llamada cubre CALL_S (50 s de espera + 3 s para cambiar de línea). Los toques seguidos al mismo cliente (Omega, Gizat, Voiso) son un
   intento. Un intento es conversación si después el cliente pasó a Talking o quedó con un resultado (Call Again, Hang Up, CallBack, Pending,
   Low Potential, Not Interested, Do Not Call, Failed, FTD) antes del siguiente intento. Lo hablado es el tiempo en Talking (o hasta ese
   resultado) menos 50 s por cada línea que hubo que marcar (1 línea: 50 s; 2: 100 s; 3: 150 s): el tiempo que costó llamarlo no es charla.
   Lo demás, sin descanso marcado, es tiempo muerto.
   Requeridas = el mínimo menos lo que no se pudo marcar por hablar (una hora hablada = 68 llamadas). La franja sale del tiempo muerto
   proyectado al día: Q1 menos de 30 min (la mejor) · Q2 hasta 1 h · Q3 más. */
const CALL_S=53e3,RING_S=50e3,TALK_MAX=3*36e5,Q_MIN=[30*6e4,60*6e4],TALK_G=['call_again','hang_up','callback','pending','low_potential','not_interested','dnc','failed','ftd','invalid'];
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
    const isTalk=l=>/talk|habl/.test(l.st); // Talking: tiempo de llamada justificado
    const talked=(id,from,until)=>{ // pasó a Talking (o ya lo estaba) o quedó con un resultado antes del siguiente intento
      const k=norm(id),cur=crmStatusOf(id);
      if(cur&&/talk|habl/.test(norm(cur.status))&&cur.since&&Date.parse(cur.since)<=until+10*6e4)return true;
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
    const req=Math.max(0,Math.round(minCalls()-talk/CALL_S));
    R={n:L.length,dead,talk,proj,req,useful,q:proj<Q_MIN[0]?1:proj<Q_MIN[1]?2:3,young:useful<30*6e4,segs,in:t.in,end,open:!t.out};
  }
  ritmoMemo.m.set(uid,R);return R;
}
const qCls=q=>q===1?'ok':q===2?'warn':'hot';
const minsTxt=ms=>{const m=Math.round(ms/6e4);return m<60?`${m} min`:`${Math.floor(m/60)} h ${z(m%60)}`};
const qBadge=(R,full)=>!R?'<span class="d">sin entrada</span>':R.young?'<span class="d">recién empieza</span>':`<span class="qb q${R.q}">Q${R.q}</span>${full?` <span class="d">${R.q===1?'muy bien':R.q===2?'justo':'mucho tiempo muerto'}</span>`:''}`;
function ritmoLine(uid){ // en palabras: "180 llamadas · 25 min muertos · Q1"
  const R=ritmo(uid);if(!R)return '';
  return `<span class="rt-n"><b>${R.n}</b> ${R.n===1?'llamada':'llamadas'}${R.req!==minCalls()?` <span class="d">(hoy se piden ${R.req}: hablaste ${esc(minsTxt(R.talk))})</span>`:` <span class="d">de ${R.req}</span>`}</span> · <span class="rt-d"><b class="${R.dead>=Q_MIN[1]?'hot':R.dead>=Q_MIN[0]?'warn':''}">${esc(minsTxt(R.dead))}</b> muertos</span> · ${qBadge(R,true)} <button type="button" class="lnk" data-hy="ritmo" data-uid="${esc(uid)}">Ver qué pasó</button>`;
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
  modal({wide:true,title:`${esc(nm)} · ${qBadge(R,true)}`,body:`
    <div class="rt-sum"><span><b>${R.n}</b> llamadas <span class="d">de ${R.req}</span></span><span><b>${esc(minsTxt(R.talk))}</b> hablando</span><span><b class="${R.dead>=Q_MIN[1]?'hot':R.dead>=Q_MIN[0]?'warn':''}">${esc(minsTxt(R.dead))}</b> muertos${R.open?` <span class="d">(a fin de día serían ${esc(minsTxt(R.proj))})</span>`:''}</span></div>
    <div class="rt-tl" role="img" aria-label="Línea de tiempo del día">${tl}</div><div class="tll"><span>${hhmm(R.in)}</span><span>${R.open?'ahora':'salida'} ${hhmm(R.end)}</span></div>
    <div class="legend rt-lg"><span><i class="sw call"></i>Llamada</span><span><i class="sw talk"></i>Conversación</span><span><i class="sw br"></i>Descanso</span><span><i class="sw dead"></i>Sin marcar</span></div>
    <h4 class="rt-h">Huecos sin marcar</h4>${holes.length?`<ul class="rt-list">${holes.map(s=>`<li><b>${esc(minsTxt(s.d))}</b> de ${hhmm(s.a)} a ${hhmm(s.b)}, ${before(s)}</li>`).join('')}</ul>`:'<p class="p-sub" style="margin:0">Ninguno de más de 3 minutos.</p>'}
    ${talks.length?`<h4 class="rt-h">Conversaciones</h4><ul class="rt-list">${talks.map(s=>`<li><b>${esc(minsTxt(s.b-s.a))}</b> desde las ${hhmm(s.a)} con <b>${esc(s.id)}</b> ${esc(name(s.id))}${s.n>1?` <span class="d">(atendió a la ${s.n}ª línea)</span>`:''}</li>`).join('')}</ul>`:''}
    <p class="p-sub" style="margin:10px 0 0">Cada línea marcada cubre 50 s. Es conversación si después el cliente pasó a Talking o quedó con un status de resultado antes del siguiente intento; se le restan 50 s por línea marcada. Los descansos marcados no cuentan.</p>`,
    actions:[{l:'Listo',cls:'pri'}]});
}

/* ---------- en Equipo: las llamadas de hoy de cada agente (texto; el team leader fija el mínimo) ---------- */
function paceTxt(pc){if(pc.exp==null)return 'sin Entrada marcada';if(pc.n>=pc.min)return 'mínimo cumplido';if(pc.exp<10)return 'recién empieza su jornada';return pc.ok?`va bien · a esta altura, ${pc.exp}`:`va atrasado · a esta altura, ${pc.exp}`}
function callsMesaCard(){
  if(callsOk===false)return '';
  const all=sellers(team).filter(m=>!isLeadUid(m.id)).map(m=>({m,pc:dayPace(m.id),P:crm.ok?dayPool(m.id):null})).sort((a,b)=>b.pc.n-a.pc.n||a.m.name.localeCompare(b.m.name));
  const on=all.filter(x=>x.pc.n||(x.P&&x.P.total)),off=all.filter(x=>!(x.pc.n||(x.P&&x.P.total)));
  const row=({m,pc,P})=>{const R=ritmo(m.id);return `<tr><td><span class="eq-who">${avatar(m.name)}<b>${esc(m.name)}</b></span></td><td><b class="${R&&pc.n>=R.req?'ok':''}">${pc.n}</b><span class="d">/${R?R.req:pc.min}</span></td>
    <td>${R?`<button type="button" class="lnkp" data-hy="ritmo" data-uid="${esc(m.id)}" title="Ver qué pasó">${esc(minsTxt(R.dead))}</button>`:'<span class="d">—</span>'}</td><td>${qBadge(R)}</td><td>${P?`${P.done}<span class="d">/${P.total}</span>`:''}</td><td>${P&&P.due.length?sp('hot b',String(P.due.length)):'<span class="d">—</span>'}</td></tr>`};
  return `<div class="card-h"><h3>Llamadas de hoy</h3><span class="p-sub">llamadas, tiempo muerto y franja: Q1 menos de 30 min muertos en el día · Q2 hasta 1 h · Q3 más</span><span class="grow"></span>${isLeader()?`<button type="button" class="btn sm" data-hy="min" title="Llamadas mínimas por día">Mínimo ${minCalls()} ✎</button>`:''}</div>
    ${on.length?`<div class="p-tablewrap"><table class="pt eq-calls"><thead><tr><th>Agente</th><th>Llamadas</th><th>Tiempo muerto</th><th>Franja</th><th>Pool llamado hoy</th><th>En New</th></tr></thead><tbody>${on.map(row).join('')}</tbody></table></div>`:'<div class="p-empty">Todavía nadie llamó hoy.</div>'}
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
