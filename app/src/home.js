/* ---------- home (27/11/2026, lo definió el dueño): lo de hoy, tuyo y de la mesa, en una sola página con un selector grande de partes.
   1) para hacer ahora: el new en New → copiar ID; la agenda vencida → ya lo llamé; la tarea → ya la hice; el aviso del team leader → leído; la falla de pago → ok
      (lista tipo movimientos, `.mv`; lo marcado ok/leído queda dos días en `local` `hmDone`). Debajo, las acciones redondas (agendar, copiar el new, baño, 10, 30, compartir).
   2) mi turno (lo que era la franja del Inicio, `#iTurno`, con el RMO). 3) la mesa hoy (la mesa contra su target y las ventas de hoy).
   4) para atender ya (team leader y admin: el Manager entero, `V.callman` en `#cmBody`). Se entra siempre acá (`landing`). ---------- */
const HM_KEEP=2*864e5;
const hmDone=()=>{const d=local.get('hmDone',{}),now=Date.now();let ch=false;for(const k in d)if(now-(d[k]||0)>HM_KEEP){delete d[k];ch=true}if(ch)local.set('hmDone',d);return d};
function hmMark(key){const d=hmDone();d[key]=Date.now();local.set('hmDone',d);refresh()}
const hmAgo=ms=>cmAgo(Math.max(0,ms));
const hmRow=(lv,ic,t,s,acts)=>`<div class="mv-i ${lv}"><div class="ic"><svg class="ic" aria-hidden="true"><use href="#i-${ic}"/></svg></div><div><div class="tt">${t}</div>${s?`<div class="ss">${s}</div>`:''}</div><div class="ac">${acts}</div></div>`;
const hmBtn=(l,a,cls='')=>`<button type="button" class="btn ${cls}" ${a}>${esc(l)}</button>`;
// lo que hay que hacer ahora (el agente); el team leader no gestiona clientes
function hmAhora(){
  const now=Date.now(),te=todayS(),D=hmDone(),L=[];let luego=[];
  if(!tlView()){
    const news=newsOf(me).filter(inNew).map(r=>({r,a:regAt(r),k:contactOf(r)})).sort((a,b)=>(a.k.last?1:0)-(b.k.last?1:0)||(a.a||0)-(b.a||0));
    for(const x of news)L.push({w:0,h:hmRow('urg','cliente',`new <b>${esc(x.r.id)}</b>${x.r.country?` · ${esc(paisOf(x.r.country))}`:''}`,`${x.k.last?`llamado hace ${hmAgo(now-x.k.last)}`:'<b>sin llamar</b>'}${x.a?` · registrado hace ${hmAgo(now-x.a)}`:''}${x.r.camp?` · ${esc(x.r.camp)}`:''}`,hmBtn('copiar ID',`data-hm="copiar" data-id="${esc(x.r.id)}"`,'pri'))});
    for(const p of pend.filter(p=>!p.done).sort((a,b)=>parseDue(a.due)-parseDue(b.due))){
      const d=parseDue(p.due),late=now-d;
      if(soldOf(p.id)){luego.push(`agenda <b>${esc(p.id)}</b> ya depositó`);continue}
      if(late>=0)L.push({w:1,h:hmRow(late>=30*6e4?'urg':'imp','agenda',`agenda <b>${esc(p.id)}</b>${p.kw?` · ${esc(p.kw)}`:''}`,`era a las ${esc(p.due.slice(11,16))}${late>=6e4?` · <b>hace ${hmAgo(late)}</b>`:''}`,hmBtn('ya lo llamé',`data-hm="agHecho" data-id="${esc(p._id)}"`,'pri')+hmBtn('+1 h',`data-hm="agPos" data-id="${esc(p._id)}"`))});
      else if(p.due.slice(0,10)===te)luego.push(`agenda de las ${esc(p.due.slice(11,16))} (<b>${esc(p.id)}</b>${p.kw?` · ${esc(p.kw)}`:''})`);
    }
    for(const t of pendingTasks()){const due=t.due&&t.due<te;L.push({w:2,h:hmRow(due?'urg':'imp','tareas',`tarea de <b class="nm">${esc(first(t.by))}</b>: ${esc(clip(taskTxt(t),140))}`,t.due?`para ${esc(dueTxt(t.due))}${due?' · <b>atrasada</b>':''}`:`mandada ${esc(rel(new Date(t.at)))}`,hmBtn('ya la hice',`data-hm="tkHecha" data-id="${esc(t._id)}"`,'pri')+hmBtn('ver',`data-go="tareas"`))})}
    const hot=typeof hotMine==='function'?hotMine(newsOf(me)):[];for(const h of hot.slice(0,2))luego.push(`campaña caliente <b>${esc(h.txt||h.key||'')}</b>${h.n?`: ${plural(h.n,'FTD')} hoy`:''}${h.cl&&h.cl.length?` y tenés ${plural(h.cl.length,'new')} de esa campaña`:''}`);
  }
  for(const c of chats)for(const m of (msgs[c.id]||[]))if(m.aviso&&m.uid!==me&&now-m.t<12*36e5&&!D['av:'+m._id]){
    const sh=chatShut(),k=sh?null:msgCard(m.body),txt=sh?'abrí el chat para verlo.':k?(k.title||'datos')+(k.rest?': '+k.rest:''):msgTxt(m.body);
    L.push({w:3,h:hmRow('inf','campana',`aviso de <b class="nm">${esc(first(m.uid))}</b>${c.kind==='team'?'':` en ${esc(c.kind==='dm'?'tu privado':chatName(c))}`}`,esc(clip(txt,160)),hmBtn('ver',`data-hm="chat" data-id="${esc(c.id)}"`)+hmBtn('leído',`data-hm="ok" data-key="av:${esc(m._id)}"`,'pri'))});
  }
  for(const f of (typeof bkFallas==='function'?bkFallas():[])){const key='bk:'+(f.mid||f.pid)+':'+(f.at||'');if(D[key])continue;const nm=bkName(f.pid,f.mid)+(f.fc&&f.fc.length&&!f.mid?enTxt(f.fc):'');
    L.push({w:4,h:hmRow('inf','banking',`<b class="nm">${esc(nm)}</b> está fallando`,`${f.note?esc(clip(f.note,120))+' · ':''}no lo ofrezcas por ahora${f.by?` · avisó ${esc(first(f.by))}`:''}`,hmBtn('ver banking',`data-go="banking"`)+hmBtn('ok',`data-hm="ok" data-key="${esc(key)}"`,'pri'))})}
  L.sort((a,b)=>a.w-b.w);
  return {n:L.length,html:(L.length?`<div class="mv">${L.map(x=>x.h).join('')}</div>`:`<div class="mv"><div class="mv-empty"><b>todo al día.</b> cuando entre un new, venza una agenda, te manden una tarea o un aviso, aparece acá.</div></div>`)+(luego.length?`<p class="sub">después · ${luego.join(' · ')}</p>`:'')};
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
      const sl=e.target.closest('#hmSel [data-sec]');if(sl){const el=$('#'+sl.dataset.sec);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});$$('#hmSel button').forEach(b=>b.classList.toggle('on',b===sl));return}
      const b=e.target.closest('[data-hm]');if(!b||!ready)return;
      const {hm,id,key}=b.dataset;
      if(hm==='copiar')openFicha(id);
      else if(hm==='chat')go('chat',{chat:id});
      else if(hm==='ok')hmMark(key);
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
    const A=hmAhora();
    $('#hmAhora').innerHTML=A.html;$('#hmActs').innerHTML=hmActs();
    const al=isLeader()?cmData().al.filter(a=>a.w<=2).length:0;
    $('#hmSel').innerHTML=[['hmAhoraH','para hacer ahora',A.n],['hmTurnoH','mi turno',0],['hmMesaH','la mesa hoy',0],...(isLeader()?[['hmCmH','para atender ya',al]]:[])].map(([k,l,n],i)=>`<button type="button" data-sec="${k}"${i===0?' class="on"':''}>${esc(l)}${n?`<span class="n">${n}</span>`:''}</button>`).join('');
    {const b=$('#nbHome');if(b)b.textContent=(A.n+al)||''}
    $('#iTurno').hidden=TL;$('#hmTurnoH').hidden=TL;
    crmLoad();
    $('#iMesa').hidden=false;$('#iMesa').innerHTML=TL?mesaBoard():mesaCard();
    $('#iHoy').innerHTML=hoyMesaCard();
    const L=isLeader();$('#hmCmH').hidden=!L;$('#cmBody').hidden=!L;$('#cmSub').hidden=!L;if(L)V.callman.render({});
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
      else bt=day?`<span class="marks">${marksHTML(day)}</span>`:'';
      if(day)bt+='<span style="flex:1"></span><button type="button" class="ib" data-go="turnos" title="Ver, deshacer o corregir las marcas en Turnos">corregir</button>';
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
    {const el=$('#itRitmo');if(el){const h=ritmoLine(me);el.hidden=!h;el.innerHTML=h}}
    $('#itTl').innerHTML=day?timeline(day,now):'';
    lowerize($('#iTurno'));
  },
};
