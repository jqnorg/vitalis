/* ---------- home (27/11/2026, lo definió el dueño): lo de hoy, tuyo y de la mesa, en una sola página con un selector grande de partes.
   1) para hacer ahora: el new en New → copiar ID; la agenda vencida → ya lo llamé; la tarea → ya la hice; el aviso del team leader → leído; la falla de pago → ok
      (lista tipo movimientos, `.mv`; lo marcado ok/leído queda dos días en `local` `hmDone`). Debajo, las acciones redondas (agendar, copiar el new, baño, 10, 30, compartir).
   2) mi turno (lo que era la franja del Inicio, `#iTurno`, con el RMO). 3) la mesa hoy (la mesa contra su target y las ventas de hoy).
   Para el team leader y el admin, en "para hacer ahora" van los avisos de la mesa (`cmData().al`), **uno por tipo** (el dueño, 27/11/2026, sacó "Para atender ya": llamó a otro con uno en Talking · descanso pasado · agendas vencidas sin cerrar · sin llamar o RMO Q3),
   y debajo de "la mesa hoy" el Manager (news en curso y por agente, `V.callman` en `#cmBody`). Se entra siempre acá (`landing`). ---------- */
const HM_KEEP=2*864e5;
const hmDone=()=>{const d=local.get('hmDone',{}),now=Date.now();let ch=false;for(const k in d)if(now-(d[k]||0)>HM_KEEP){delete d[k];ch=true}if(ch)local.set('hmDone',d);return d};
function hmMark(key){const d=hmDone();d[key]=Date.now();local.set('hmDone',d);refresh()}
const hmAgo=ms=>cmAgo(Math.max(0,ms));
const hmRow=(lv,ic,t,s,acts)=>`<div class="mv-i ${lv}"><div class="ic"><svg class="ic" aria-hidden="true"><use href="#i-${ic}"/></svg></div><div><div class="tt">${t}</div>${s?`<div class="ss">${s}</div>`:''}</div><div class="ac">${acts}</div></div>`;
const hmBtn=(l,a,cls='')=>`<button type="button" class="btn ${cls}" ${a}>${esc(l)}</button>`;
// lo que hay que hacer ahora (el agente); el team leader no gestiona clientes
function hmAhora(){
  // lo mínimo (el dueño, 27/11/2026: "hay demasiadas notificaciones"): cada new es una fila (es lo urgente); las agendas vencidas, las tareas y los avisos van en una fila cada uno, con la cuenta
  const now=Date.now(),te=todayS(),D=hmDone(),L=[];
  if(!tlView()){
    const news=newsOf(me).filter(inNew).map(r=>({r,a:assignedAt(r)||+regAt(r)||0})).sort((a,b)=>(a.a||0)-(b.a||0));
    for(const x of news.slice(0,5))L.push({w:0,h:hmRow('urg','cliente',`new <b>${esc(x.r.id)}</b>${x.r.country?` · ${esc(paisOf(x.r.country))}`:''}`,`pasalo a Talking${x.a?` · te llegó hace ${hmAgo(now-x.a)}`:''}${x.r.camp?` · ${esc(x.r.camp)}`:''}`,hmBtn('copiar ID',`data-hm="copiar" data-id="${esc(x.r.id)}"`,'pri'))});
    if(news.length>5)L.push({w:0,h:hmRow('urg','cliente',`y <b>${news.length-5}</b> news más sin gestionar`,'',hmBtn('ver',`data-go="agenda"`))});
    const venc=pend.filter(p=>!p.done&&parseDue(p.due)<=now&&!soldOf(p.id)).sort((a,b)=>parseDue(a.due)-parseDue(b.due));
    if(venc.length===1){const p=venc[0];L.push({w:1,h:hmRow('imp','agenda',`agenda <b>${esc(p.id)}</b>${p.kw?` · ${esc(p.kw)}`:''}`,`era a las ${esc(p.due.slice(11,16))} · hace ${hmAgo(now-parseDue(p.due))}`,hmBtn('ya lo llamé',`data-hm="agHecho" data-id="${esc(p._id)}"`,'pri')+hmBtn('+1 h',`data-hm="agPos" data-id="${esc(p._id)}"`))})}
    else if(venc.length)L.push({w:1,h:hmRow('imp','agenda',`<b>${venc.length}</b> agendas vencidas`,`la más vieja, <b>${esc(venc[0].id)}</b>, era a las ${esc(venc[0].due.slice(11,16))}`,hmBtn('ver agenda',`data-go="agenda"`,'pri'))});
    const tk=pendingTasks();
    if(tk.length===1){const t=tk[0];L.push({w:2,h:hmRow('imp','tareas',`tarea de <b class="nm">${esc(first(t.by))}</b>: ${esc(clip(taskTxt(t),120))}`,t.due?`para ${esc(dueTxt(t.due))}`:'',hmBtn('ya la hice',`data-hm="tkHecha" data-id="${esc(t._id)}"`,'pri'))})}
    else if(tk.length)L.push({w:2,h:hmRow('imp','tareas',`<b>${tk.length}</b> tareas pendientes`,esc(clip(taskTxt(tk[0]),100))+' …',hmBtn('ver tareas',`data-go="tareas"`,'pri'))});
  }
  const av=[];for(const c of chats)for(const m of (msgs[c.id]||[]))if(m.aviso&&m.uid!==me&&now-m.t<12*36e5&&!D['av:'+m._id])av.push({m,c});
  if(av.length){const {m,c}=av[av.length-1],sh=chatShut(),k=sh?null:msgCard(m.body),txt=sh?'abrí el chat para verlo.':k?(k.title||'datos')+(k.rest?': '+k.rest:''):msgTxt(m.body);
    L.push({w:3,h:hmRow('inf','campana',av.length===1?`aviso de <b class="nm">${esc(first(m.uid))}</b>`:`<b>${av.length}</b> avisos, el último de <b class="nm">${esc(first(m.uid))}</b>`,esc(clip(txt,140)),hmBtn('ver',`data-hm="chat" data-id="${esc(c.id)}"`)+hmBtn('leído',`data-hm="ok" data-key="${av.map(x=>'av:'+x.m._id).join(' ')}"`,'pri'))})}
  if(isLeader()&&crm.ok){ // los avisos de la mesa, uno por tipo, con todos los agentes en la misma situación juntos (lo pidió el dueño)
    const by=new Map();for(const a of cmData().al){const k=a.k==='quiet'||a.k==='q3'?'ritmo':a.k;(by.get(k)||by.set(k,[]).get(k)).push(a)}
    const KD={talk:[0,'urg','cliente','llamó a otro con uno en Talking','llamaron a otro con uno en Talking'],rest:[1,'imp','turnos','pasado del descanso','pasados del descanso'],agenda:[1,'imp','agenda','con agendas vencidas sin cerrar','con agendas vencidas sin cerrar'],ritmo:[2,'inf','alerta','sin llamar o RMO Q3','sin llamar o RMO Q3']};
    for(const [k,xs] of by){const d=KD[k];if(!d)continue;const us=[...new Set(xs.map(a=>a.uid))];
      L.push({w:4+d[0],h:hmRow(d[1],d[2],us.length===1?esc(xs[0].t):`<b>${us.length}</b> agentes ${d[4]}`,us.length===1&&xs.length===1?'':esc(xs.map(a=>a.t).join(' · ')),hmBtn('ver',`data-hmsec="cmBody"`))})}}
  L.sort((a,b)=>a.w-b.w);
  return {n:L.length,html:L.length?`<div class="mv">${L.map(x=>x.h).join('')}</div>`:`<div class="mv"><div class="mv-empty"><b>todo al día.</b> cuando entre un new, venza una agenda o te manden una tarea, aparece acá.</div></div>`};
}
function hmActs(){
  const nx=tlView()?null:newsOf(me).filter(inNew)[0];
  return `<button type="button" class="act pri" data-go="agenda" title="Agendar un contacto"><i><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg></i>agendar</button>
    ${nx?`<button type="button" class="act" data-hm="copiar" data-id="${esc(nx.id)}" title="Copiar el ID del próximo new en New"><i>ID</i>copiar new</button>`:''}
    ${turnoState().t?`<button type="button" class="act" data-act="bano"><i><svg class="ic" aria-hidden="true"><use href="#i-turnos"/></svg></i>baño</button><button type="button" class="act" data-act="d10"><i>10</i>10 min</button><button type="button" class="act" data-act="d30"><i>30</i>30 min</button>`:`<button type="button" class="act" data-act="entrada"><i><svg class="ic" aria-hidden="true"><use href="#i-turnos"/></svg></i>entrada</button>`}
    <button type="button" class="act" data-go="chat"><i><svg class="ic" aria-hidden="true"><use href="#i-chat"/></svg></i>chat</button>`;
}
V.home={
  k:'',
  build(){
    V.callman.build();
    document.addEventListener('click',e=>{
      const hs=e.target.closest('[data-hmsec]');if(hs){const el=$('#'+hs.dataset.hmsec);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});return}
      const sl=e.target.closest('#hmSel [data-sec]');if(sl){const el=$('#'+sl.dataset.sec);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});$$('#hmSel button').forEach(b=>b.classList.toggle('on',b===sl));return}
      const b=e.target.closest('[data-hm]');if(!b||!ready)return;
      const {hm,id,key}=b.dataset;
      if(hm==='copiar')openFicha(id);
      else if(hm==='chat')go('chat',{chat:id});
      else if(hm==='ok'){const d=hmDone();for(const k of key.split(' '))d[k]=Date.now();local.set('hmDone',d);refresh()}
      else if(hm==='agHecho'){const p=pend.find(x=>x._id===id);if(p&&noRO())pendHecho(p)}
      else if(hm==='agPos'){const p=pend.find(x=>x._id===id);if(p&&noRO())posponer(p,60)}
      else if(hm==='tkHecha'){if(noRO())B.taskDone(id,true)}
    });
    setInterval(()=>{if(ready&&cur==='home'&&!document.hidden)refresh()},6e4); // los "hace X min" se mueven solos
  },
  render(){
    const now=new Date(),te=todayS(),h=now.getHours(),TL=tlView();
    $('#hmHola').textContent=`${h<13?'buen día':h<20?'buenas tardes':'buenas noches'}, ${profile.name.split(/\s+/)[0]}`;
    $('#hmFecha').textContent=`${DIAL[now.getDay()]} ${+te.slice(8)} de ${MES[now.getMonth()]}`;
    $('#hmActs').innerHTML=hmActs(); // sin "para hacer ahora" (el dueño, 27/11/2026: "no sirve de nada"); `hmAhora` queda sin uso
    $('#hmSel').innerHTML=[['hmTurnoH','mi turno',0],['hmMesaH','la mesa hoy',0]].map(([k,l,n],i)=>`<button type="button" data-sec="${k}"${i===0?' class="on"':''}>${esc(l)}${n?`<span class="n">${n}</span>`:''}</button>`).join('');
    {const b=$('#nbHome');if(b)b.textContent=''}
    $('#iTurno').hidden=TL;$('#hmTurnoH').hidden=TL;
    crmLoad();
    $('#iMesa').hidden=false;$('#iMesa').innerHTML=TL?mesaBoard():mesaCard();
    $('#iHoy').innerHTML=hoyMesaCard();
    const L=isLeader();$('#cmBody').hidden=!L;$('#cmSub').hidden=!L;if(L)V.callman.render({});
    hotNotify();
    this.turno(true);
  },
  turno(force){
    if(cur!=='home'||tlView())return;
    const {t,b,h,key}=turnoState(),now=Date.now(),day=t||h;
    if(force||key!==this.k){
      this.k=key;let bt='';
      if(!t)bt=h&&h.out?'<button type="button" class="btn" data-act="entrada">reabrir turno</button>':'<button type="button" class="btn pri big" data-act="entrada">marcar entrada</button>';
      else if(b)bt=`<button type="button" class="btn pri big" data-act="vuelta">volví ${isBano(b)?'del baño':'del descanso'}</button>`;
      if(day)bt+='<button type="button" class="btn" data-go="turnos" title="Ver, deshacer o corregir las marcas en Turnos">corregir</button>';
      $('#itBtns').innerHTML=bt;
    }
    let st='<span class="dim">todavía no marcaste entrada hoy.</span>';
    if(day){
      const m=metr(day,now);
      if(b&&isBano(b))st=`<span class="big">${mmss(now-b.s)}</span><span>en el baño desde las ${hhmm(b.s)}</span>`;
      else if(b){const left=b.s+b.k*6e4-now;st=`<span class="big${left<0?' hot':''}">${left>=0?mmss(left):'+'+mmss(-left)}</span><span>descanso de ${b.k}': ${left>=0?'volvés a las '+hhmm(b.s+b.k*6e4):sp('hot','te pasaste')}</span>`}
      else if(t){const rest=m.salidaEst-now;st=`<span class="big">${durS(m.total)}</span><span>${rest>0?`salís a las ${hhmm(m.salidaEst)}, faltan ${dur(rest)}`:sp('hot','+'+dur(-rest)+' extra')}</span>`}
      else st=`<span class="big">${durS(m.total)}</span><span>${hhmm(day.in)} a ${hhmm(day.out)}, ${Math.abs(m.extra)<6e4?'justo':m.extra>0?sp('hot','+'+dur(m.extra)+' extra'):dur(-m.extra)+' menos'}</span>`;
    }
    $('#itState').innerHTML=st;
    {const el=$('#itRitmo');if(el){const h=ritmoKpis(me);el.hidden=!h;el.innerHTML=h}}
    $('#itMarks').innerHTML=day?`<span class="marks">${marksHTML(day)}</span>`:'';
    $('#itTl').innerHTML=day?timeline(day,now):'';
    lowerize($('#iTurno'));
  },
};
