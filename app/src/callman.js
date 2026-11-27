/* ---------- Manager: la mesa en vivo, para el team leader (y el admin) ----------
   Su botón brillante del menú (el team leader no tiene clientes: en vez de "Cliente" tiene esto).
   Arriba lo que hay que atender ya; después los news en curso (New y Talking) con su agente; abajo, cada agente:
   su turno, sus news (ahora y los que recibió hoy), FTDs de hoy, llamadas contra el mínimo, la última llamada,
   y las agendas vencidas. Sale todo de lo que Vitalis ya tiene: sin tablas nuevas. */
const CM_NEW=5*6e4,CM_QUIET=20*6e4; // un New sin llamar a los 5 min · en turno y sin llamar hace 20 min
const cmAgo=ms=>{const m=Math.max(0,Math.round(ms/6e4));return m<1?'recién':m<60?`${m} min`:m<48*60?`${Math.floor(m/60)} h ${z(m%60)}`:`${Math.round(m/1440)} días`};
const CM_AG=30*6e4; // una agenda vencida hace más de 30 min sin cerrar: aviso al team leader
const CM_STUCK=2*36e5; // un cliente en Talking hace más de 2 h quedó colgado: al cortar tiene que salir de Talking (lo dijo el dueño)
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
    const u=crmOwner(r),k=contactOf(r),a=regAt(r),talk=cmIsTalk(r),x={r,u,k,a:a?+a:0,talk,wait:!!(!talk&&!k.last&&a&&now-a>=CM_NEW)};
    cur.push(x);const p=u&&per.get(u);if(p){if(talk)p.talk++;else p.newN++;p.list.push(x)}
  }
  for(const f of team)if(f.date===te){const p=per.get(f.uid);if(p){p.ftd++;if(!isLate(f))p.ftdNew=(p.ftdNew||0)+1}} // ftdNew: depositó el mismo día que se registró (la conversión del día)
  for(const c of calls){const p=per.get(c.uid);if(p&&c.at>p.last)p.last=c.at}
  cur.sort((a,b)=>(b.wait?1:0)-(a.wait?1:0)||(a.talk?1:0)-(b.talk?1:0)||(a.k.last?1:0)-(b.k.last?1:0)||(a.a||now)-(b.a||now));
  const rows=[...per.values()].map(p=>({...p,tu:cmTurno(p.m.id),pc:dayPace(p.m.id),R:ritmo(p.m.id),venc:agStats(p.m.id).venc,sp:newSpeedOf(p.m.id,te,te)}));
  const ord={br:0,in:0,none:2,out:3};
  rows.sort((a,b)=>ord[a.tu.k]-ord[b.tu.k]||(b.newN+b.talk)-(a.newN+a.talk)||a.m.name.localeCompare(b.m.name));
  // lo que hay que atender ya, lo más urgente primero
  const al=[];
  for(const p of pings)if(p.kind==='ayuda'&&!p.reply&&now-Date.parse(p.at)<30*6e4)al.push({w:0,k:'ayuda',pid:p._id,uid:p.from,key:'ayuda:'+p._id,html:`<b>${esc(first(p.from))}</b> pidió ayuda ${cmHace(now-Date.parse(p.at))} y nadie fue todavía`});
  // New sin llamar y Talking colgados, agrupados por agente (una fila por agente, desplegable), lo más viejo primero
  const grp=(list,k,one,many,kind,msg)=>{const by=new Map();for(const x of list)(by.get(x.u||'')||by.set(x.u||'',[]).get(x.u||'')).push(x);
    for(const [u,xs] of by){xs.sort((a,b)=>a.a-b.a);const nm=u?esc(memberName(u)):'<span class="hot">Sin agente</span>';
      const li=x=>`<li><button type="button" class="lnkp" data-hy="ficha" data-id="${esc(x.r.id)}"><b>${esc(x.r.id)}</b></button> ${esc(clip(x.r.name,26))}${x.r.country?` <span class="d">(${esc(x.r.country)})</span>`:''} · ${cmHace(now-x.a)}</li>`;
      if(xs.length===1)al.push({w:k,k:kind,uid:u,key:kind+':'+u+':'+norm(xs[0].r.id),msg:msg(xs),id:xs[0].r.id,html:`${nm}: ${one(xs[0])}`});
      else al.push({w:k,k:kind,uid:u,key:kind+':'+u+':'+xs.map(x=>norm(x.r.id)).join(','),msg:msg(xs),html:`<details class="cm-g"><summary><b>${nm}</b>: ${many(xs)}</summary><ul>${xs.map(li).join('')}</ul></details>`});}};
  grp(cur.filter(x=>x.wait),1,x=>`New sin llamar <b>${cmHace(now-x.a)}</b>: <b>${esc(x.r.id)}</b> ${esc(x.r.name)}${x.r.country?` (${esc(x.r.country)})`:''}`,xs=>`<b>${xs.length}</b> new sin llamar, el más viejo <b>${cmHace(now-xs[0].a)}</b>`,'new',xs=>xs.length===1?`Tenés el new ${xs[0].r.id} sin llamar desde hace ${cmAgo(now-xs[0].a)}. Llamalo ya.`:`Tenés ${xs.length} news sin llamar (${xs.map(x=>x.r.id).join(', ')}). Llamalos ya.`);
  const stuck=cur.filter(x=>x.talk&&x.r.since&&now-Date.parse(x.r.since)>CM_STUCK).map(x=>({...x,a:Date.parse(x.r.since)}));
  grp(stuck,2,x=>`<b>${esc(x.r.id)}</b> ${esc(x.r.name)} quedó en <b>Talking</b> ${cmHace(now-x.a)}: al cortar tiene que salir de Talking`,xs=>`<b>${xs.length}</b> clientes quedaron en <b>Talking</b> (el más viejo ${cmHace(now-xs[0].a)}): al cortar tienen que salir de Talking`,'talk',xs=>`${xs.length===1?`El cliente ${xs[0].r.id} quedó`:`Los clientes ${xs.map(x=>x.r.id).join(', ')} quedaron`} en Talking. Al cortar, sacalo de Talking.`);
  for(const p of rows){
    const nm=`<b>${esc(p.m.name)}</b>`;
    if(p.tu.ex)al.push({w:2,k:'rest',uid:p.m.id,key:'rest:'+p.m.id+':'+(p.tu.at||''),msg:`Llevás ${cmAgo(p.tu.d)} en un descanso de ${p.tu.b.k} min. ¿Volvés?`,html:`${nm} lleva ${cmAgo(p.tu.d)} en un descanso de ${p.tu.b.k}'`});
    const vz=agOf(p.m.id).filter(x=>!x.done&&now-parseDue(x.due)>=CM_AG&&!soldOf(x.id)).sort((a,b)=>parseDue(a.due)-parseDue(b.due)); // agendas vencidas sin "Ya lo llamé"
    if(vz.length===1)al.push({w:2,k:'agenda',uid:p.m.id,key:'agenda:'+p.m.id+':'+vz[0]._id,msg:`Tenés la agenda de ${vz[0].id} (${vz[0].due.slice(11,16)}) vencida y sin cerrar. ¿Lo llamaste?`,id:vz[0].id,html:`${nm} tiene la agenda de <b>${esc(vz[0].id)}</b> (${esc(vz[0].due.slice(11,16))}) vencida <b>${cmHace(now-parseDue(vz[0].due))}</b> y sin cerrar`});
    else if(vz.length)al.push({w:2,k:'agenda',uid:p.m.id,key:'agenda:'+p.m.id+':'+vz.map(x=>x._id).join(','),msg:`Tenés ${vz.length} agendas vencidas sin cerrar (${vz.map(x=>x.id).join(', ')}). ¿Las llamaste?`,html:`<details class="cm-g"><summary>${nm} tiene <b>${vz.length}</b> agendas vencidas sin cerrar, la más vieja <b>${cmHace(now-parseDue(vz[0].due))}</b></summary><ul>${vz.map(x=>`<li><button type="button" class="lnkp" data-hy="ficha" data-id="${esc(x.id)}"><b>${esc(x.id)}</b></button> agenda de las ${esc(x.due.slice(11,16))} · ${cmHace(now-parseDue(x.due))}${x.kw?` · ${esc(x.kw)}`:''}</li>`).join('')}</ul></details>`});
    if(p.R&&!p.R.young&&p.R.q===3&&p.tu.k!=='out')al.push({w:3,k:'q3',uid:p.m.id,key:'q3:'+p.m.id+':'+te,msg:`Vas RMO Q3 hoy: ${minsTxt(p.R.dead)} de tiempo muerto. Mantené el ritmo.`,html:`${nm} va <b>RMO Q3</b>: ${esc(minsTxt(p.R.dead))} de tiempo muerto hoy <button type="button" class="lnk" data-hy="ritmo" data-uid="${esc(p.m.id)}">Ver qué pasó</button>`});
    if(p.tu.k==='in'&&!cmInCall(p.R,now)&&now-Math.max(p.last,p.tu.at||0)>=CM_QUIET)al.push({w:3,k:'quiet',uid:p.m.id,key:'quiet:'+p.m.id+':'+Math.floor(now/36e5),msg:p.last?`Hace ${cmAgo(now-p.last)} que no llamás. ¿Todo bien?`:'No llamaste todavía. ¿Todo bien?',html:`${nm} está en turno y ${p.last?`no llama hace ${cmAgo(now-p.last)}`:'no llamó todavía'}`}); // en llamada no se avisa: el tiempo está justificado
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
    const k=kpi('En new ahora',`${D.newN}`,D.wait?`<span class="hot b">${D.wait} sin llamar hace +5 min</span>`:'todos llamados','')+kpi('Talking',`${D.talk}`,'ya lo tiene un agente')+
      kpi('News de hoy',`${D.hoyMesa}`,'registrados hoy en la mesa')+kpi('Llamadas de hoy',`${nf(D.callsN)}`,`mínimo ${minCalls()} por agente`)+
      (sp0=>kpi('Al new en',sp0.n?esc(minTxt2(sp0.med)):'—',sp0.n?`del registro a la primera llamada · ${sp0.slow?`${sp0.slow} de ${sp0.n} tardaron +5 min`:'todos antes de 5 min'}`:'sin news llamados hoy'))(newSpeedOf(null,todayS(),todayS()));
    const alerts=D.al.length?`<section class="card cm-al"><div class="card-h"><h3>Para atender ya</h3><span class="p-sub">${plural(D.al.length,'cosa','cosas')}</span></div>
      <ul class="cm-list">${D.al.slice(0,20).map(a=>`<li class="w${a.w}"><svg class="ic" aria-hidden="true"><use href="#i-alerta"/></svg><span>${a.html}</span>${a.id?`<button type="button" class="btn sm" data-hy="ficha" data-id="${esc(a.id)}">Ficha</button>`:''}</li>`).join('')}</ul></section>`:'';
    const cRow=x=>{const r=x.r,c=x.k;
      return `<tr class="${x.wait?'cm-wait':''}"><td><button type="button" class="lnkp" data-hy="ficha" data-id="${esc(r.id)}"><b>${esc(r.id)}</b></button> ${esc(clip(r.name,26))}<div class="d">${esc(r.country||'')}${r.camp?' · '+esc(clip(r.camp,22)):''}</div></td>
        <td>${x.u?`<span class="eq-who">${avatar(memberName(x.u))}${esc(first(x.u))}</span>`:'<span class="hot">sin agente</span>'}</td>
        <td>${x.talk?sp('ok b','Talking'):sp(x.wait?'hot b':'b','New')}</td>
        <td>${x.a?cmHace(D.now-x.a):'—'}</td>
        <td>${c.last?`${c.lines.size?`${c.lines.size} línea${c.lines.size===1?'':'s'} · `:''}${cmHace(D.now-c.last)}`:sp(x.wait?'hot':'d','sin llamar')}</td></tr>`};
    const cur=`${D.al.length>20?`<p class="p-sub" style="margin:-8px 2px 12px">Y ${D.al.length-20} avisos más.</p>`:''}<section class="card"><div class="card-h"><h3>News en curso</h3><span class="p-sub">New y Talking, sin depositar · primero los que nadie llamó</span></div>
      ${D.cur.length?`<div class="p-tablewrap"><table class="pt cm-t"><thead><tr><th>Cliente</th><th>Agente</th><th>Estado</th><th>Registro</th><th>Llamadas</th></tr></thead><tbody>${D.cur.slice(0,40).map(cRow).join('')}</tbody></table></div>${D.cur.length>40?`<p class="p-sub" style="margin:8px 2px 0">Y ${D.cur.length-40} más.</p>`:''}`:'<div class="p-empty">Nadie en New ni en Talking ahora.</div>'}</section>`;
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
      ${on.length?`<div class="p-tablewrap"><table class="pt cm-t"><thead><tr><th>Agente</th><th>Turno</th><th>New</th><th>Talking</th><th title="News registrados hoy que le llegaron (si lo rotaron, al primero)">News hoy</th><th>FTD hoy</th><th title="CR (%) de hoy: de los news que le llegaron hoy, cuántos depositaron hoy">CR (%) hoy</th><th>Llamadas</th><th title="RMO: tiempo muerto del día">Muerto</th><th title="RMO: franja del día (Q1 la mejor, Q3 la peor)">RMO</th><th title="Velocidad al new: del registro a la primera llamada (mediana de sus news de hoy)">Al new en</th><th>Última llamada</th><th>Agendas vencidas</th></tr></thead><tbody>${on.map(aRow).join('')}</tbody></table></div>`:'<div class="p-empty">Todavía nadie marcó la entrada hoy.</div>'}
      ${off.length?`<p class="p-sub" style="margin:10px 2px 0">Sin entrada ni actividad hoy: ${off.map(p=>`<button type="button" class="lnkp" data-act="ficha" data-uid="${esc(p.m.id)}">${esc(p.m.name.split(/\s+/)[0])}</button>`).join(', ')}</p>`:''}</section>`;
    body.innerHTML=`<div class="kpis">${k}</div>${alerts}${cur}${ags}`;reopen(body,op);
  }
};
