/* ---------- Manager: la mesa en vivo, para el team leader (y el admin) ----------
   Su botón brillante del menú (el team leader no tiene clientes: en vez de "Cliente" tiene esto).
   Arriba lo que hay que atender ya; después los news en curso (New y Talking) con su agente; abajo, cada agente:
   su turno, sus news (ahora y los que recibió hoy), FTDs de hoy, llamadas contra el mínimo, la última llamada,
   y las agendas vencidas. Sale todo de lo que Vitalis ya tiene: sin tablas nuevas. */
const CM_NEW=5*6e4,CM_QUIET=20*6e4; // un new sin gestionar a los 5 min (salvo que su agente tenga otro en Talking) · en turno y sin llamar hace 20 min
const cmAgo=ms=>{const m=Math.max(0,Math.round(ms/6e4));return m<1?'recién':m<60?`${m} min`:m<48*60?`${Math.floor(m/60)} h ${z(m%60)}`:`${Math.round(m/1440)} días`};
const CM_AG=30*6e4; // una agenda vencida hace más de 30 min sin cerrar: aviso al team leader
const cmHace=ms=>ms<6e4?'recién':`hace ${cmAgo(ms)}`; // "recién", nunca "hace recién"
const cmInCall=(R,now)=>!!(R&&R.segs&&R.segs.some(s=>s.k==='talk'&&now-s.b<9e4)); // el sistema ya sabe que está en llamada (conversación abierta)
function cmTurno(uid){ // el turno de hoy de alguien, con el descanso que tiene abierto
  const t=(teamSh[uid]||{})[todayS()]||(uid===me?openTurno():null),now=Date.now();
  if(!t||!t.in)return {k:'none',txt:'Sin entrada',cls:'d'};
  if(t.out)return {k:'out',txt:`Salió ${hhmm(t.out)}`,cls:'d'};
  const b=(t.breaks||[]).find(x=>!x.e);
  if(b){const d=now-b.s,ex=!isBano(b)&&d>b.k*6e4;return {k:'br',b,d,ex,txt:`${isBano(b)?'Baño':`Descanso ${b.k}'`} · ${cmAgo(d)}`,cls:ex?'hot b':'warn'}}
  return {k:'in',txt:`En turno desde ${hhmm(t.in)}`,cls:'ok',at:t.in};
}
// a quién le llegó cada new de hoy: si lo rotaron, el primero que lo tuvo
const cmFirstAgent=perPass(()=>{const m=new Map();for(const x of [...(crm.rot||[])].sort((a,b)=>Date.parse(a.seen_at)-Date.parse(b.seen_at))){const k=norm(x.client_id);if(!m.has(k))m.set(k,x.old_agent)}return m});
const cmIsTalk=r=>/talk|habl/.test(norm(r.status));
function cmData(){
  const now=Date.now(),te=todayS(),S=soldIdx(),fa=cmFirstAgent();
  const ag=sellers(team).filter(m=>!isLeadUid(m.id)),per=new Map(ag.map(m=>[m.id,{m,newN:0,talk:0,hoy:0,ftd:0,last:0,list:[]}]));
  const cur=[];let hoyMesa=0;
  for(const r of crm.rows.values()){
    if(isArch(r.brand))continue;
    const paid=paidCrm(r)||S.has(ckey(r.brand,r.id)),reg=regDay(r)===te;
    if(reg){hoyMesa++;const o=fa.get(norm(r.id)),u=notLead(o?agentUid(o):crmOwner(r));const p=u&&per.get(u);if(p)p.hoy++}
    if(r.grp!=='new'||paid)continue;
    const u=crmOwner(r),k=contactOf(r),a=assignedAt(r)||+regAt(r)||0,talk=cmIsTalk(r),x={r,u,k,a,talk,wait:!!(!talk&&a&&now-a>=CM_NEW)};
    cur.push(x);const p=u&&per.get(u);if(p){if(talk)p.talk++;else p.newN++;p.list.push(x)}
  }
  {const busy=new Set(cur.filter(x=>x.talk&&x.u).map(x=>x.u));for(const x of cur)if(x.wait&&x.u&&busy.has(x.u))x.wait=false} // con otro cliente en Talking, el new puede esperar (lo dijo el dueño)
  for(const f of team)if(f.date===te){const p=per.get(f.uid);if(p){p.ftd++;if(!isLate(f))p.ftdNew=(p.ftdNew||0)+1}} // ftdNew: depositó el mismo día que se registró (la conversión del día)
  for(const c of calls){const p=per.get(c.uid);if(p&&c.at>p.last)p.last=c.at}
  cur.sort((a,b)=>(b.wait?1:0)-(a.wait?1:0)||(a.talk?1:0)-(b.talk?1:0)||(a.k.last?1:0)-(b.k.last?1:0)||(a.a||now)-(b.a||now));
  const rows=[...per.values()].map(p=>({...p,tu:cmTurno(p.m.id),pc:dayPace(p.m.id),R:ritmo(p.m.id),venc:agStats(p.m.id).venc,sp:newSpeedOf(p.m.id,te,te)}));
  const ord={br:0,in:0,none:2,out:3};
  rows.sort((a,b)=>ord[a.tu.k]-ord[b.tu.k]||(b.newN+b.talk)-(a.newN+a.talk)||a.m.name.localeCompare(b.m.name));
  // lo que hay que atender (el dueño, 27/11/2026, sacó la tarjeta "Para atender ya" y dejó solo esto; home lo muestra en "para hacer ahora", una fila por tipo): cada aviso lleva `t` (texto corto) para esa fila
  const al=[];
  // con uno en Talking no se llama a otro (lo dijo el dueño, 27/11/2026): un toque en Omega/Gizat/Voiso a otro cliente mientras tiene uno en Talking es un aviso. El primer contacto puede durar lo que sea.
  {const byU=new Map();for(const x of cur)if(x.talk&&x.u&&x.r.since){const s=Date.parse(x.r.since);const o=byU.get(x.u);if(!o||s>o.s)byU.set(x.u,{x,s})}
    for(const [u,{x,s}] of byU){const others=calls.filter(c=>c.uid===u&&c.at>s&&norm(c.id)!==norm(x.r.id));if(!others.length)continue;const ids=[...new Set(others.map(c=>c.id))],last=Math.max(...others.map(c=>c.at));
      al.push({w:2,k:'talk',uid:u,key:'talk:'+u+':'+norm(x.r.id)+':'+ids.join(','),msg:`Tenés a ${x.r.id} en Talking y llamaste a ${ids.join(', ')}. Con uno en Talking no se llama a otro: cerralo primero.`,id:x.r.id,t:`${memberName(u)}: ${x.r.id} en Talking ${cmHace(now-s)} y llamó a ${ids.length===1?ids[0]:ids.length+' más'}`,html:`<b>${esc(memberName(u))}</b> tiene a <b>${esc(x.r.id)}</b> en <b>Talking</b> ${cmHace(now-s)} y llamó a ${ids.length===1?`<b>${esc(ids[0])}</b>`:`<b>${ids.length}</b> clientes más`} (${cmHace(now-last)}): con uno en Talking no se llama a otro`})}}
  for(const p of rows){
    const nm=`<b>${esc(p.m.name)}</b>`;
    if(p.tu.ex)al.push({w:2,k:'rest',uid:p.m.id,key:'rest:'+p.m.id+':'+(p.tu.at||''),msg:`Llevás ${cmAgo(p.tu.d)} en un descanso de ${p.tu.b.k} min. ¿Volvés?`,t:`${p.m.name}: ${cmAgo(p.tu.d)} en un descanso de ${p.tu.b.k} min`,html:`${nm} lleva ${cmAgo(p.tu.d)} en un descanso de ${p.tu.b.k}'`});
    const vz=agOf(p.m.id).filter(x=>!x.done&&now-parseDue(x.due)>=CM_AG&&!soldOf(x.id)).sort((a,b)=>parseDue(a.due)-parseDue(b.due)); // agendas vencidas sin "Ya lo llamé"
    if(vz.length===1)al.push({w:2,k:'agenda',uid:p.m.id,key:'agenda:'+p.m.id+':'+vz[0]._id,msg:`Tenés la agenda de ${vz[0].id} (${vz[0].due.slice(11,16)}) vencida y sin cerrar. ¿Lo llamaste?`,id:vz[0].id,t:`${p.m.name}: ${vz[0].id} (${vz[0].due.slice(11,16)}) hace ${cmAgo(now-parseDue(vz[0].due))}`,html:`${nm} tiene la agenda de <b>${esc(vz[0].id)}</b> (${esc(vz[0].due.slice(11,16))}) vencida <b>${cmHace(now-parseDue(vz[0].due))}</b> y sin cerrar`});
    else if(vz.length)al.push({w:2,k:'agenda',uid:p.m.id,key:'agenda:'+p.m.id+':'+vz.map(x=>x._id).join(','),msg:`Tenés ${vz.length} agendas vencidas sin cerrar (${vz.map(x=>x.id).join(', ')}). ¿Las llamaste?`,t:`${p.m.name}: ${vz.length} vencidas, la más vieja hace ${cmAgo(now-parseDue(vz[0].due))}`,html:`<details class="cm-g"><summary>${nm} tiene <b>${vz.length}</b> agendas vencidas sin cerrar, la más vieja <b>${cmHace(now-parseDue(vz[0].due))}</b></summary><ul>${vz.map(x=>`<li><button type="button" class="lnkp" data-hy="ficha" data-id="${esc(x.id)}"><b>${esc(x.id)}</b></button> agenda de las ${esc(x.due.slice(11,16))} · ${cmHace(now-parseDue(x.due))}${x.kw?` · ${esc(x.kw)}`:''}</li>`).join('')}</ul></details>`});
    if(p.R&&!p.R.young&&p.R.q===3&&p.tu.k!=='out')al.push({w:3,k:'q3',uid:p.m.id,key:'q3:'+p.m.id+':'+te,msg:`Vas RMO Q3 hoy: ${minsTxt(p.R.dead)} de tiempo muerto. Mantené el ritmo.`,t:`${p.m.name}: RMO Q3, ${minsTxt(p.R.dead)} muertos`,html:`${nm} va <b>RMO Q3</b>: ${esc(minsTxt(p.R.dead))} de tiempo muerto hoy <button type="button" class="lnk" data-hy="ritmo" data-uid="${esc(p.m.id)}">Ver qué pasó</button>`});
    if(p.tu.k==='in'&&!cmInCall(p.R,now)&&now-Math.max(p.last,p.tu.at||0)>=CM_QUIET)al.push({w:3,k:'quiet',uid:p.m.id,key:'quiet:'+p.m.id+':'+Math.floor(now/36e5),msg:p.last?`Hace ${cmAgo(now-p.last)} que no llamás. ¿Todo bien?`:'No llamaste todavía. ¿Todo bien?',t:`${p.m.name}: ${p.last?`no llama hace ${cmAgo(now-p.last)}`:'no llamó todavía'}`,html:`${nm} está en turno y ${p.last?`no llama hace ${cmAgo(now-p.last)}`:'no llamó todavía'}`}); // en llamada no se avisa: el tiempo está justificado
  }
  al.sort((a,b)=>a.w-b.w);
  return {now,cur,rows,al,hoyMesa,newN:cur.filter(x=>!x.talk).length,talk:cur.filter(x=>x.talk).length,wait:cur.filter(x=>x.wait).length,callsN:calls.length};
}
function cmBadge(){const b=$('#nbCm');if(!b)return;if(!ready||!isLeader()||!crm.ok){b.textContent='';return}const n=cmData().al.filter(a=>a.w<=2).length;b.textContent=n||''}
V.callman={
  build(){setInterval(()=>{if(ready&&cur==='home'&&!document.hidden&&isLeader())V.callman.render({})},3e4)}, // los "hace X min" se mueven solos
  render(){
    const body=$('#cmBody');if(!body||!isLeader())return;
    $('#cmSub').textContent=`la mesa en vivo · ${hhmm(Date.now())}`;$('#cmSub').hidden=false;
    if(crm.ok===false){body.innerHTML='<div class="card"><div class="p-empty">Sin clientes del CRM todavía: hace falta la estación o la extensión.</div></div>';return}
    const D=cmData(),op=openKeys(body);
    const k=kpi('En new ahora',`${D.newN}`,D.wait?`<span class="hot b">${D.wait} sin gestionar hace +5 min</span>`:'nadie espera','')+kpi('Talking',`${D.talk}`,'ya lo tiene un agente')+
      kpi('News de hoy',`${D.hoyMesa}`,'registrados hoy en la mesa')+kpi('Llamadas de hoy',`${nf(D.callsN)}`,`mínimo ${minCalls()} por agente`)+
      (sp0=>kpi('Al new en',sp0.n?esc(minTxt2(sp0.med)):'—',sp0.n?`de que lo tiene el agente a Talking · ${sp0.slow?`${sp0.slow} de ${sp0.n} tardaron +5 min`:'todos antes de 5 min'}`:'sin news gestionados hoy'))(newSpeedOf(null,todayS(),todayS()));
    // dos listas (lo pidió el dueño, 27/11/2026): clientes en New con su agente, clientes en Talking con su agente
    const who=x=>x.u?`<span class="eq-who">${avatar(memberName(x.u))}${esc(first(x.u))}</span>`:'<span class="hot">sin agente</span>';
    const cli=r=>`<button type="button" class="lnkp" data-hy="ficha" data-id="${esc(r.id)}"><b>${esc(r.id)}</b></button><div class="d">${esc(paisOf(r.country||'')||'')}${r.camp?' · '+esc(clip(r.camp,22)):''}</div>`;
    const nRow=x=>`<tr class="${x.wait?'cm-wait':''}"><td>${cli(x.r)}</td><td>${who(x)}</td><td>${x.a?`<span class="${x.wait?'hot b':''}">${cmHace(D.now-x.a)}</span>`:'—'}</td></tr>`;
    const tRow=x=>{const s=x.r.since?Date.parse(x.r.since):0;return `<tr><td>${cli(x.r)}</td><td>${who(x)}</td><td>${s?cmHace(D.now-s):'—'}</td></tr>`};
    const lista=(t,sub,rows,row,th,empty)=>`<section class="card"><div class="card-h"><h3>${t}</h3><span class="p-sub">${sub}</span></div>
      ${rows.length?`<div class="p-tablewrap"><table class="pt cm-t"><thead><tr><th>Cliente</th><th>Agente</th><th>${th}</th></tr></thead><tbody>${rows.slice(0,60).map(row).join('')}</tbody></table></div>${rows.length>60?`<p class="p-sub" style="margin:8px 2px 0">Y ${rows.length-60} más.</p>`:''}`:`<div class="p-empty">${empty}</div>`}</section>`;
    const nws=D.cur.filter(x=>!x.talk),tks=D.cur.filter(x=>x.talk).sort((a,b)=>(Date.parse(b.r.since)||0)-(Date.parse(a.r.since)||0));
    const cur=lista(`En New <span class="d">${nws.length}</span>`,'sin gestionar · primero los más viejos',nws,nRow,'Sin gestionar hace','Nadie en New ahora.')+
      lista(`En Talking <span class="d">${tks.length}</span>`,'lo está gestionando su agente',tks,tRow,'Gestionando hace','Nadie en Talking ahora.');
    const aRow=p=>`<tr><td><button type="button" class="eq-who lnkp" data-act="ficha" data-uid="${esc(p.m.id)}" title="Ver la ficha de ${esc(p.m.name)}">${avatar(p.m.name)}<b>${esc(p.m.name)}</b></button></td>
      <td><span class="${p.tu.cls}">${esc(p.tu.txt)}</span></td>
      <td>${p.newN?sp(p.list.some(x=>x.wait)?'hot b':'b',String(p.newN)):'<span class="d">0</span>'}</td><td>${p.talk?sp('ok b',String(p.talk)):'<span class="d">0</span>'}</td>
      <td>${p.hoy}</td><td>${p.ftd?`<b>${p.ftd}</b>`:'<span class="d">0</span>'}</td><td>${p.hoy?`<b>${p.ftdNew||0}</b><span class="d">/${p.hoy} · ${Math.round(100*(p.ftdNew||0)/p.hoy)}%</span>`:'<span class="d">—</span>'}</td>
      <td><b class="${p.R&&p.pc.n>=p.R.req?'ok':''}">${p.pc.n}</b><span class="d">/${p.R?p.R.req:p.pc.min}</span>${p.R?` <span class="d">· <b class="${p.R.talkOk?'ok':''}">${esc(minsTxt(p.R.talk))}</b> hablados</span>`:''}</td><td>${p.R?`<button type="button" class="lnkp" data-hy="ritmo" data-uid="${esc(p.m.id)}" title="Ver qué pasó">${esc(minsTxt(p.R.dead))}</button>`:'<span class="d">—</span>'}</td><td>${qBadge(p.R)}</td>
      <td>${p.sp&&p.sp.n?`<b class="${p.sp.med>5?'hot':'ok'}">${esc(minTxt2(p.sp.med))}</b>${p.sp.slow?` <span class="d">· ${p.sp.slow} +5 min</span>`:''}`:'<span class="d">—</span>'}</td>
      <td>${p.last?cmHace(D.now-p.last):'<span class="d">—</span>'}</td>
      <td>${p.venc?sp('hot b',String(p.venc)):'<span class="d">—</span>'}</td></tr>`;
    const act=p=>p.tu.k!=='none'||p.newN||p.talk||p.hoy||p.ftd||p.pc.n||p.venc,on=D.rows.filter(act),off=D.rows.filter(p=>!act(p)); // sin entrada ni nada hoy: en una línea
    const ags=`<section class="card"><div class="card-h"><h3>Por agente</h3><span class="p-sub">tocá uno para ver su ficha</span></div>
      ${on.length?`<div class="p-tablewrap"><table class="pt cm-t"><thead><tr><th>Agente</th><th>Turno</th><th>New</th><th>Talking</th><th title="News registrados hoy que le llegaron (si lo rotaron, al primero)">News hoy</th><th>FTD hoy</th><th title="CR (%) de hoy: de los news que le llegaron hoy, cuántos depositaron hoy">CR (%) hoy</th><th>Llamadas</th><th title="RMO: tiempo muerto del día">Muerto</th><th title="RMO: franja del día (Q1 la mejor, Q3 la peor)">RMO</th><th title="Velocidad al new: de que lo tiene el agente a Talking (mediana de sus news de hoy)">Al new en</th><th>Última llamada</th><th>Agendas vencidas</th></tr></thead><tbody>${on.map(aRow).join('')}</tbody></table></div>`:'<div class="p-empty">Todavía nadie marcó la entrada hoy.</div>'}
      ${off.length?`<p class="p-sub" style="margin:10px 2px 0">Sin entrada ni actividad hoy: ${off.map(p=>`<button type="button" class="lnkp" data-act="ficha" data-uid="${esc(p.m.id)}">${esc(p.m.name.split(/\s+/)[0])}</button>`).join(', ')}</p>`:''}</section>`;
    body.innerHTML=`<div class="kpis">${k}</div>${cur}${ags}`;reopen(body,op);
  }
};
