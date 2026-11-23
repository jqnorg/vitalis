/* ============================================================
   La Cola del agente: a quién llamar, en orden, y por qué (cada cliente y cada grupo dice su motivo).
   1) Los new, solo si hay más de uno (uno solo ya lo avisa la notificación): sueltos, uno tras otro.
   2) Las agendas que ya llegaron, los Pending Payment y los CallBack: sueltos, uno tras otro.
   3) NA a NA-4, Call Again y Hang Up, agrupados por el motivo para volver a llamarlos
      (campaña caliente, sin llamar hoy, sin tocar hace más de 2 h, llamados hace poco) y en orden.
   4) Los Low potential que el Radar ve con chance hoy.
   El team leader, y quien mira la cola de otro, siguen con la vista de la mesa (ahora.js).
   ============================================================ */
const SG_STALE=2*36e5; // "sin tocar hace más de 2 h"
const sgPlain=r=>{ // el status en palabras simples
  if(!r)return '';const g=r.grp,s=norm(r.status);
  if(g==='new')return /talk|habl/.test(s)?'Nuevo, ya habló':'Nuevo';
  if(g==='na'){const n=naNum(r.status);return `No atendió · ${n} ${n===1?'día':'días'} de llamadas`} // NA-N: N días en que se lo llamó (sin llamarlo, no cambia)
  if(g==='call_again')return 'Volver a llamar';
  if(g==='hang_up')return 'Cortó';
  if(g==='callback')return 'Pidió que lo llamen';
  if(g==='pending')return 'Tiene un boleto sin pagar';
  if(g==='low_potential')return 'No tenía el dinero';
  return r.status||'';
};
const sgPlace=r=>{if(!r||!r.country)return '';const t=cliTime(r.country);return esc(r.country)+(t?` · allá son las ${t}`:'')};
const sgFlame='<svg class="ic sg-fl" aria-hidden="true"><use href="#i-racha"/></svg>';
const sgCalled=k=>k.today&&k.last?`<span class="sg-ok"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Llamado hoy ${hhmm(k.last)}</span>`:'<span class="sg-no">Sin llamar hoy</span>';
const sgDay=r=>{const d=statusDay(r);return d?Math.min(d,5):0};
// en qué días del mes deposita más su país (Radar: días de cobro); '' si hoy no es uno de esos días
function sgPayDay(country){
  const o=payDaysBy().find(x=>norm(x.p)===norm(paisOf(country)));if(!o)return '';
  const day=new Date().getDate(),i=BUCK.findIndex(([a,z])=>day>=a&&day<=z);
  return i>=0&&o.ix[i].ix>=1.25?`en ${o.p} se deposita más ${bTxt(i)} (días de cobro)`:'';
}

/* ---------- 1) y 2): tarjetas sueltas ---------- */
function sgCard({r,p,c,tag,why,k}){ // compacta: arriba el cliente, abajo el porqué; los botones a la derecha
  const id=r?r.id:p.id,name=r?r.name:'',note=r&&r.note,crmSt=r&&r.status&&!(c==='new'&&r.grp==='new'&&!/talk/i.test(r.status))?r.status:'';
  return `<div class="sg-c sg-${c}"${p?` data-pid="${esc(p._id)}"`:''}>
    <div class="sg-m"><div class="sg-t"><span class="sg-tag sg-${c}">${esc(tag)}</span><button type="button" class="lnkp sg-cid" data-ah="ficha" data-id="${esc(id)}" title="Ver la ficha">${esc(id)}</button>${r&&r.hot?sgFlame:''}${name?`<span class="sg-nm">${esc(name)}</span>`:''}${r&&r.country?`<span class="sg-pl">${sgPlace(r)}</span>`:''}${crmSt?`<span class="sg-crm" title="Status en el CRM">${esc(crmSt)}</span>`:''}</div>
      <p class="sg-why">${why}</p>${note?`<p class="sg-note"><span class="d">Nota del CRM:</span> ${esc(note)}</p>`:''}</div>
    <div class="sg-side">${k?sgCalled(k):''}<div class="sg-b">${p?`<button type="button" class="btn pri" data-act="pHecho">Ya lo llamé</button>`:''}<button type="button" class="btn${p?'':' pri'}" data-ah="ficha" data-id="${esc(id)}">Ficha</button>${p?'':`<button type="button" class="btn" data-ah="ag" data-id="${esc(id)}">Agendar</button>`}</div></div>
  </div>`;
}
function sgNewWhy(r,k){
  const now=Date.now(),a=regAt(r),m=a?Math.round((now-a)/6e4):null;
  if(k.last&&now-k.last<REPASO)return `Ya lo llamaste ${esc(rel(new Date(k.last)))}. Volvé a probar antes de las <b>${hhmm(k.last+REPASO)}</b>.`;
  if(k.last)return `Lo llamaste ${esc(rel(new Date(k.last)))} y no depositó: toca repasarlo.`;
  if(m==null)return 'Todavía no lo llamaste.';
  const {w,cold}=newWin(r.country);
  return `Se registró ${esc(rel(a))} y todavía no lo llamaste${m<=w?': <b>es su mejor momento</b>.':m<=cold?': todavía está a tiempo.':'.'}`;
}

/* ---------- 3): NA, Call Again y Hang Up, agrupados por el motivo ---------- */
function sgRow(r,k,why){
  return `<div class="sg-r"><div class="sg-rl"><div class="sg-rt"><button type="button" class="lnkp sg-rid" data-ah="ficha" data-id="${esc(r.id)}" title="Ver la ficha">${esc(r.id)}</button>${r.hot?sgFlame:''}<span class="sg-rn">${esc(r.name)}</span></div>
    <div class="sg-rs"><span class="sg-st">${esc(sgPlain(r))}</span> · ${why}</div>${r.note?`<div class="sg-rnote" title="${esc(r.note)}">Nota del CRM: ${esc(clip(r.note,90))}</div>`:''}</div>
    <div class="sg-rb"><button type="button" class="btn sm" data-ah="ficha" data-id="${esc(r.id)}">Ficha</button><button type="button" class="btn sm" data-ah="ag" data-id="${esc(r.id)}">Agendar</button></div></div>`;
}
function sgRowWhy(r,k){
  const now=Date.now(),bits=[];
  if(!k.last)bits.push('sin ningún contacto registrado');
  else if(k.today)bits.push(`lo llamaron a las ${hhmm(k.last)} (${esc(rel(new Date(k.last)))})`);
  else bits.push(`sin tocar ${esc(rel(new Date(k.last)))}`);
  const d=sgDay(r);if(d>=4&&r.grp!=='na')bits.push(`<b>día ${d} de 5</b>: ${d>=5?'hoy':'mañana'} pasa a Not interested`);
  if(r.grp==='na'&&naNum(r.status)>=3)bits.push('probá con las tres líneas');
  return bits.join(' · ');
}
function sgGroup(key,list,head,why,open=true){
  if(!list.length)return '';
  const lim=ahMore[key]?list.length:12;
  const rows=list.slice(0,lim).map(x=>sgRow(x.r,x.k,sgRowWhy(x.r,x.k))).join('');
  const more=list.length>lim?`<button type="button" class="btn sm rk-more" data-ah="more" data-g="${key}">Ver los ${list.length}</button>`:'';
  return `<details class="sg-sub" data-k="sg-${key}"${open?' open':''}><summary><b>${head}</b> <span class="sg-n">${list.length}</span><span class="sg-sw">${why}</span></summary>${rows}${more}</details>`;
}

/* ---------- 4): Low potential con chance según el Radar ---------- */
function sgLowWhy(r,te){
  const out=[];let w=99;
  if(r.hot){out.push(`su campaña lleva ${r.hot.n} FTDs hoy`);w=Math.min(w,0)}
  const rd=regDay(r);
  if(rd&&rd<te){const d=bizDays(rd,te);
    if(d<=1){out.push('se registró ayer: hoy es su mejor día para volver');w=Math.min(w,1)}
    else if(d<=3){out.push(`se registró hace ${d} días hábiles: todavía está a tiempo`);w=Math.min(w,3)}
    else if(d<=7){out.push(`se registró hace ${d} días hábiles: es su última semana con buena chance`);w=Math.min(w,4)}}
  const pd=sgPayDay(r.country);if(pd){out.push(pd);w=Math.min(w,2)}
  return out.length?{why:out.slice(0,2).join(' · '),w}:null;
}

// qué va en cada paso (lo usan la Cola y el "Siguiente" de la extensión en el CRM)
function colaPlan(q){
  const now=Date.now(),te=todayS(),H=hotMine(q),hot=new Map();
  for(const h of H)for(const r of h.cl)hot.set(norm(r.id),h);
  const mark=r=>{r.hot=hot.get(norm(r.id))||null;return r};
  const kOf=new Map(),K=r=>{let k=kOf.get(r);if(!k)kOf.set(r,k=contactOf(r));return k};
  // 1) los new (en la Cola, solo si hay más de uno)
  const news=q.g1.map(mark),due=r=>{const k=K(r);return !k.last||now-k.last>=REPASO};
  const newsL=[...news].sort((a,b)=>(due(b)?1:0)-(due(a)?1:0)||(b.hot?1:0)-(a.hot?1:0)||byRegDesc(a,b));
  // 2) agendas que ya llegaron, Pending Payment y CallBack
  const agNow=q.ag.filter(p=>parseDue(p.due)<=new Date()),agLater=q.ag.filter(p=>parseDue(p.due)>new Date());
  const cb=q.cb.map(mark),cbRank=r=>(K(r).today?2:0)+(r.grp==='pending'?0:1);
  const two=[...agNow.map(p=>{const r=crmStatusOf(p.id);return {p,r:r?mark(r):null}}),...[...cb].sort((a,b)=>cbRank(a)-cbRank(b)||byRegDesc(a,b)).map(r=>({r}))];
  // 3) NA, Call Again y Hang Up, por el motivo. Un cliente va en un solo lugar: los que tienen agenda abierta los avisa la agenda
  const agIds=new Set(pend.filter(p=>!p.done).map(p=>norm(p.id)));
  const g3=q.g3.filter(r=>!agIds.has(norm(r.id))).map(mark).map(r=>({r,k:K(r)})),by=(a,b)=>(a.k.last||0)-(b.k.last||0); // primero el que hace más que nadie toca (a la par, queda el orden de la mesa: Call Again, Hang Up, NA)
  const recent=x=>x.k.today&&x.k.last&&now-x.k.last<=SG_STALE;
  const hotL=g3.filter(x=>x.r.hot&&!recent(x)).sort(by),rest=g3.filter(x=>!(x.r.hot&&!recent(x)));
  const nunca=rest.filter(x=>!x.k.today).sort(by),viejos=rest.filter(x=>x.k.today&&!recent(x)).sort(by),poco=rest.filter(recent).sort(by);
  // 4) Low potential con chance
  const low=q.low.filter(r=>!agIds.has(norm(r.id))).map(mark).map(r=>({r,k:K(r),x:sgLowWhy(r,te)})).filter(o=>o.x)
    .sort((a,b)=>(recent(a)?1:0)-(recent(b)?1:0)||a.x.w-b.x.w||byRegDesc(a.r,b.r));
  return {now,te,H,K,news,newsL,due,agNow,agLater,cb,two,g3,hotL,nunca,viejos,poco,low,recent};
}
// el próximo a llamar, en el orden de la Cola, con su porqué en una línea (para la extensión en el CRM)
function colaNext(q,n=6){
  const P=colaPlan(q),out=[],seen=new Set(),add=(id,name,why)=>{const k=norm(id);if(!id||seen.has(k))return;seen.add(k);out.push({id:String(id),name:name||'',why})};
  for(const r of P.newsL.filter(P.due)){const k=P.K(r);add(r.id,r.name,k.last?`Nuevo: lo llamaste ${rel(new Date(k.last))}, toca repasarlo`:'Nuevo: todavía no lo llamaste')}
  for(const {p,r} of P.two){
    if(p)add(p.id,r&&r.name,`Agenda de las ${p.due.slice(11,16)}`);
    else add(r.id,r.name,r.grp==='pending'?'Tiene un boleto sin pagar':'Pidió que lo llamen');
  }
  for(const x of P.hotL)add(x.r.id,x.r.name,'Su campaña está depositando hoy');
  for(const x of P.nunca)add(x.r.id,x.r.name,`${sgPlain(x.r)} · sin llamar hoy`);
  for(const x of P.viejos)add(x.r.id,x.r.name,`${sgPlain(x.r)} · sin tocar hace más de 2 h`);
  for(const o of P.low)add(o.r.id,o.r.name,'Low potential: '+o.x.why.replace(/<[^>]+>/g,''));
  return out.slice(0,n);
}
function colaSug(q){
  const P=colaPlan(q),{now,H,K,news,newsL,due,agNow,agLater,cb,two,g3,hotL,nunca,viejos,poco,low,recent}=P;
  let html='',step=0;
  const stepH=(t,sub)=>`<div class="sg-step"><span class="sg-sn">${++step}</span><div><h3>${t}</h3><p>${sub}</p></div></div>`;

  // 1) los new: solo si hay más de uno
  if(news.length>1){
    const L=newsL,n=L.filter(due).length;
    html+=stepH('Primero, los nuevos',`Tenés ${plural(news.length,'nuevo','nuevos')} sin depositar${n?`; ${n===news.length?'a todos':`a ${n}`} toca llamarlos ahora`:''}. Depositan más en las primeras horas, y se repasan cada menos de 2 horas.`)+
      `<div class="sg-list">${L.map(r=>sgCard({r,c:'new',tag:'Nuevo',k:K(r),why:sgNewWhy(r,K(r))})).join('')}</div>`;
  }
  document.body.classList.toggle('sg-news',news.length>1);

  // 2) agendas que ya llegaron, Pending Payment y CallBack
  if(two.length){
    html+=stepH('Después, los que esperan tu llamada',`${[agNow.length&&plural(agNow.length,'agenda que ya llegó','agendas que ya llegaron'),cb.filter(r=>r.grp==='pending').length&&plural(cb.filter(r=>r.grp==='pending').length,'boleto sin pagar','boletos sin pagar'),cb.filter(r=>r.grp==='callback').length&&plural(cb.filter(r=>r.grp==='callback').length,'cliente que pidió que lo llamen','clientes que pidieron que los llamen')].filter(Boolean).join(', ')}. Ya tienen un compromiso: no los dejes esperando.`)+
      `<div class="sg-list">${two.map(({p,r})=>{
        if(p){const d=parseDue(p.due),late=now-d>5*6e4;
          return sgCard({p,r:r||null,c:'ag',tag:'Agenda',k:r?K(r):null,why:`Quedaste en llamarlo a las <b>${esc(p.due.slice(11,16))}</b>${late?` (${esc(rel(d))})`:''}.${p.kw?` Palabra clave: <b>${esc(p.kw)}</b>.`:''}`})}
        const k=K(r),d=sgDay(r),called=k.today?` Ya lo llamaste hoy a las ${hhmm(k.last)}.`:'';
        if(r.grp==='pending')return sgCard({r,c:'pend',tag:'Boleto',k,why:`Tiene un boleto sin pagar: preguntale si ya pudo pagar y ayudalo a terminar.${called}`});
        return sgCard({r,c:'cb',tag:'Pidió que lo llamen',k,why:`Tiene cita en el CRM${d?` (día ${d} de 5)`:''}. Si te da una hora, agendalo para que Vitalis te avise.${called}`});
      }).join('')}</div>`;
  }
  if(agLater.length)html+=`<p class="sg-later"><svg class="ic" aria-hidden="true"><use href="#i-campana"/></svg>Más tarde: ${agLater.map(p=>`<b>${esc(p.due.slice(11,16))}</b> ${esc(p.id)}`).join(' · ')}. <span class="d">Te avisa a la hora.</span></p>`;

  // 3) NA, Call Again y Hang Up, por el motivo
  if(g3.length){
    const pend3=hotL.length+nunca.length+viejos.length;
    html+=stepH('Volver a llamar: No Answer, Call Again y Hang Up',`${pend3?`${plural(pend3,'cliente')} para repasar, en orden: primero el que hace más tiempo que nadie toca.`:'Ya los llamaste a todos hace poco.'}${q.many?` Son tantos que van solo los registrados en ${MES[new Date().getMonth()]}.`:''}`)+
      `<section class="card sg-g3">`+
      sgGroup('hot',hotL,`${sgFlame}Su campaña está depositando hoy`,`${H.map(h=>esc(h.txt)+` lleva ${h.n} FTDs hoy`).join(' · ')}: es el mejor momento para esos clientes.`)+
      sgGroup('nunca',nunca,'Sin llamar hoy','Nadie los llamó todavía hoy.')+
      sgGroup('viejos',viejos,'Sin tocar hace más de 2 horas','Los llamaron hoy pero hace rato: probá otra vez.')+
      sgGroup('poco',poco,'Llamados hace poco','Los llamaron hace menos de 2 horas: dejalos para más tarde.',!(hotL.length+nunca.length+viejos.length))+
      `</section>`;
  }

  // 4) Low potential con chance
  if(low.length){
    html+=stepH('Low potential con chance hoy','No tenían el dinero, pero según el Radar hoy pueden entrar. Los que tienen agenda no van acá: te avisa la agenda.')+
      `<section class="card sg-g3">${low.slice(0,ahMore.low4?low.length:12).map(o=>sgRow(o.r,o.k,o.x.why+(o.k.today?` · lo llamaron a las ${hhmm(o.k.last)}`:''))).join('')}${low.length>12&&!ahMore.low4?`<button type="button" class="btn sm rk-more" data-ah="more" data-g="low4">Ver los ${low.length}</button>`:''}</section>`;
  }
  if(!step)html+=`<section class="card"><div class="p-empty">${crm.rows.size?'Nada pendiente: tu cola está al día.':esc(noCrm())}</div></section>`;
  return html;
}
