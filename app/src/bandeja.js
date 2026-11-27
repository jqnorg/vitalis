/* ---------- la Bandeja (27/11/2026, el dueño: "hay demasiada información distribuida por muchos lugares"): una sola lista de lo que hay que hacer,
   con un botón por cosa. La del agente (vista `bandeja`, primera solapa del Inicio, a donde entra): el new que entró → Copiar ID; la agenda vencida → Ya lo llamé;
   la tarea → Ya la hice; el aviso del team leader → Leído; la falla de pago → Ok. La de la mesa (vista `cmbandeja`, primera solapa del Manager, para team leader y admin):
   el pedido de ayuda → Voy; el new sin llamar, el Talking colgado, el que no llama → Avisarle (un privado); la agenda vencida de un agente → Avisarle;
   el pedido de cambio de campaña → Hecho; la tarea que hicieron → Ok. Nada nuevo en la base: todo sale de lo que ya está cargado. ---------- */
const BJ_KEEP=2*864e5; // lo que marcaste como hecho se recuerda dos días
let bjTab='ahora',bjTabTl='ahora';
const bjDone=()=>{const d=local.get('bjDone',{}),now=Date.now();let ch=false;for(const k in d)if(now-(d[k].at||0)>BJ_KEEP){delete d[k];ch=true}if(ch)local.set('bjDone',d);return d};
function bjMark(key,t){const d=bjDone();d[key]={at:Date.now(),t:String(t||'').slice(0,160)};local.set('bjDone',d);refresh()}
function bjUnmark(key){const d=bjDone();delete d[key];local.set('bjDone',d);refresh()}
const bjAgo=ms=>cmAgo(Math.max(0,ms));
const bjIcon=k=>`<svg class="ic" aria-hidden="true"><use href="#i-${k}"/></svg>`;
// una fila: {key, lv: urg|imp|info, ic, t (html), s (html), acts: [{l, cls, bj, ...data}], done}
function bjRow(x){
  const acts=(x.acts||[]).map(a=>`<button type="button" class="btn ${a.cls||''}" data-bj="${esc(a.bj)}" data-key="${esc(x.key)}"${a.id?` data-id="${esc(a.id)}"`:''}${a.uid?` data-uid="${esc(a.uid)}"`:''}${a.v?` data-v="${esc(a.v)}"`:''}${a.t?` data-t="${esc(a.t)}"`:''}>${esc(a.l)}</button>`).join('');
  return `<div class="bj-i ${x.lv||''}${x.done?' done':''}" data-bjk="${esc(x.key)}"><div class="bj-ic">${bjIcon(x.ic||'alerta')}</div><div><div class="tt">${x.t}</div>${x.s?`<div class="ss">${x.s}</div>`:''}</div><div class="bj-a">${acts}</div></div>`;
}
const bjList=(l,empty)=>l.length?`<div class="bj">${l.map(bjRow).join('')}</div>`:`<div class="bj-empty"><b>${esc(empty[0])}</b>${esc(empty[1])}</div>`;
const bjTabs=(id,tabs,on)=>`<div class="seg" id="${id}">${tabs.map(([k,l,n])=>`<button type="button" class="${k===on?'on':''}" data-bjtab="${k}">${esc(l)}${n?`<span class="bj-cnt">${n}</span>`:''}</button>`).join('')}</div>`;

/* ---- la del agente ---- */
function bjAgente(){
  const now=Date.now(),te=todayS(),D=bjDone(),ahora=[],luego=[],hechas=[];
  // el new que entró: lo más urgente, pase lo que pase (el dueño). Primero el que nadie llamó, el más viejo arriba
  const news=newsOf(me).filter(inNew).map(r=>({r,a:regAt(r),k:contactOf(r)})).sort((a,b)=>(a.k.last?1:0)-(b.k.last?1:0)||(a.a||0)-(b.a||0));
  for(const x of news)ahora.push({key:'new:'+norm(x.r.id),lv:'urg',ic:'cliente',t:`New: <b class="id">${esc(x.r.id)}</b>${x.r.country?` <span class="d">· ${esc(paisOf(x.r.country))}</span>`:''}`,
    s:`${x.k.last?`llamado hace ${bjAgo(now-x.k.last)}`:'<b>sin llamar</b>'}${x.a?` · registrado hace ${bjAgo(now-x.a)}`:''}${x.r.camp?` · ${esc(x.r.camp)}`:''}`,acts:[{l:'Copiar ID',cls:'pri',bj:'copiar',id:x.r.id}]});
  // la agenda: vencida → ahora; de hoy y de después → más adelante; hecha hoy → hechas
  for(const p of pend.slice().sort((a,b)=>parseDue(a.due)-parseDue(b.due))){
    if(p.done){if(p.doneAt&&ymd(new Date(p.doneAt))===te)hechas.push({key:'ag:'+p._id,ic:'agenda',t:`Agenda: <b class="id">${esc(p.id)}</b>${p.kw?` · ${esc(p.kw)}`:''}`,s:`hecha a las ${hhmm(+new Date(p.doneAt))}`,done:true,acts:[{l:'Deshacer',cls:'sm',bj:'agDeshacer',id:p._id}]});continue}
    const d=parseDue(p.due),sold=soldOf(p.id);
    if(sold){luego.push({key:'ag:'+p._id,lv:'info',ic:'agenda',t:`Agenda: <b class="id">${esc(p.id)}</b> · <span class="ok">ya depositó</span>`,s:`${esc(whenTxt(d))}${p.kw?` · ${esc(p.kw)}`:''}`,acts:[{l:'Cerrar',cls:'sm',bj:'agHecho',id:p._id}]});continue}
    const late=now-d;
    if(late>=0)ahora.push({key:'ag:'+p._id,lv:late>=30*6e4?'urg':'imp',ic:'agenda',t:`Agenda: <b class="id">${esc(p.id)}</b>${p.kw?` · ${esc(p.kw)}`:''}`,s:`para las ${esc(p.due.slice(11,16))}${late>=6e4?`, <b>hace ${bjAgo(late)}</b>`:''}`,
      acts:[{l:'Ya lo llamé',cls:'pri',bj:'agHecho',id:p._id},{l:'Copiar ID',bj:'copiar',id:p.id},{l:'+1 h',cls:'sm',bj:'agPos',id:p._id}]});
    else luego.push({key:'ag:'+p._id,ic:'agenda',t:`Agenda: <b class="id">${esc(p.id)}</b>${p.kw?` · ${esc(p.kw)}`:''}`,s:esc(whenTxt(d)),acts:[{l:'Copiar ID',cls:'sm',bj:'copiar',id:p.id},{l:'Ya lo llamé',cls:'sm',bj:'agHecho',id:p._id}]});
  }
  // tareas: las pendientes → ahora; las que hiciste hoy → hechas
  for(const t of tasks){const r=myTk(t);if(!r)continue;
    if(r.done_at){if(ymd(new Date(r.done_at))===te)hechas.push({key:'tk:'+t._id,ic:'tareas',t:`Tarea de ${esc(first(t.by))}: ${esc(clip(taskTxt(t),120))}`,s:`hecha a las ${hhmm(+new Date(r.done_at))}`,done:true});continue}
    const due=t.due&&t.due<te;
    ahora.push({key:'tk:'+t._id,lv:due?'urg':'imp',ic:'tareas',t:`Tarea de <b>${esc(first(t.by))}</b>: ${esc(clip(taskTxt(t),140))}`,s:t.due?`para ${esc(dueTxt(t.due))}${due?' · <b>atrasada</b>':''}`:`mandada ${esc(rel(new Date(t.at)))}`,acts:[{l:'Ya la hice',cls:'pri',bj:'tkHecha',id:t._id},{l:'Ver',cls:'sm',bj:'ir',v:'tareas'}]});
  }
  // avisos del team leader (últimas 12 h): quedan hasta que digas Leído
  for(const c of chats)for(const m of (msgs[c.id]||[]))if(m.aviso&&m.uid!==me&&now-m.t<12*36e5){
    const key='av:'+m._id,sh=chatShut(),k=sh?null:msgCard(m.body),txt=sh?'Abrí el chat para verlo.':k?(k.title||'Datos')+(k.rest?': '+k.rest:''):msgTxt(m.body);
    const x={key,lv:'info',ic:'campana',t:`Aviso de <b>${esc(first(m.uid))}</b>${c.kind==='team'?'':` en ${esc(c.kind==='dm'?'tu privado':chatName(c))}`}`,s:esc(clip(txt,160)),acts:[{l:'Ver',cls:'sm',bj:'chat',id:c.id},{l:'Leído',cls:'pri',bj:'ok',t:'Aviso de '+first(m.uid)}]};
    if(D[key])hechas.push({...x,done:true,s:`leído · ${esc(clip(txt,100))}`,acts:[]});else ahora.push(x);
  }
  // fallas de pago: lo que está fallando ahora, hasta que digas Ok
  for(const f of (typeof bkFallas==='function'?bkFallas():[])){
    const key='bk:'+(f.mid||f.pid)+':'+(f.at||''),nm=bkName(f.pid,f.mid)+(f.fc&&f.fc.length&&!f.mid?enTxt(f.fc):''),x={key,lv:'imp',ic:'banking',t:`<b>${esc(nm)}</b> está fallando`,s:`${f.note?esc(clip(f.note,120))+' · ':''}no lo ofrezcas por ahora${f.by?` · avisó ${esc(first(f.by))}`:''}`,acts:[{l:'Ver Banking',cls:'sm',bj:'ir',v:'banking'},{l:'Ok',cls:'pri',bj:'ok',t:nm+' está fallando'}]};
    if(!D[key])ahora.push(x);
  }
  // lo que marcaste Ok/Leído hoy
  for(const k in D)if(ymd(new Date(D[k].at))===te&&!hechas.some(h=>h.key===k)&&!/^(ag|tk):/.test(k))hechas.push({key:k,ic:k.startsWith('bk')?'banking':'campana',t:esc(D[k].t||'Hecho'),s:`a las ${hhmm(D[k].at)}`,done:true});
  const ord={urg:0,imp:1,info:2};ahora.sort((a,b)=>(ord[a.lv]??3)-(ord[b.lv]??3));
  hechas.sort((a,b)=>(D[b.key]?D[b.key].at:0)-(D[a.key]?D[a.key].at:0));
  return {ahora,luego,hechas};
}
V.bandeja={
  build(){
    setInterval(()=>{if(ready&&(cur==='bandeja'||cur==='cmbandeja')&&!document.hidden)refresh()},6e4); // los "hace X min" se mueven solos
    document.addEventListener('click',async e=>{
      const tb=e.target.closest('[data-bjtab]');if(tb&&ready){if(cur==='cmbandeja')bjTabTl=tb.dataset.bjtab;else bjTab=tb.dataset.bjtab;refresh();return}
      const b=e.target.closest('[data-bj]');if(!b||!ready)return;
      const {bj,key,id,uid,v,t}=b.dataset;
      if(bj==='copiar')openFicha(id);
      else if(bj==='ir')go(v);
      else if(bj==='chat')go('chat',{chat:id});
      else if(bj==='ok')bjMark(key,t);
      else if(bj==='undo')bjUnmark(key);
      else if(bj==='agHecho'){const p=pend.find(x=>x._id===id);if(p&&noRO())pendHecho(p)}
      else if(bj==='agDeshacer'){const p=pend.find(x=>x._id===id);if(p&&noRO())B.updPend(p,{done:false,doneAt:null})}
      else if(bj==='agPos'){const p=pend.find(x=>x._id===id);if(p&&noRO())posponer(p,60)}
      else if(bj==='tkHecha'){if(noRO())B.taskDone(id,true)}
      else if(bj==='voy'){if(noRO())B.replyPing(id,'si')}
      else if(bj==='avisar')bjAvisar(uid,t,key,b);
      else if(bj==='reqHecho'){if(!noRO())return;try{await Q(sb.from('campaign_requests').update({done:true,done_by:me,done_at:new Date().toISOString()}).eq('id',id));campReqs=campReqs.filter(q=>q.id!==id);bjMark(key,t);toast('Pedido hecho.','ok')}catch(err){toast(esc(errMsg(err)),'err')}}
    });
  },
  render(){
    const body=$('#bjBody');if(!body)return;
    if(tlView()){go('cmbandeja');return}
    const L=bjAgente(),n=L.ahora.length;
    $('#bjSub').textContent=n?`${n} ${n===1?'cosa':'cosas'} para hacer ahora`:'Nada pendiente ahora';
    const on=bjTab;
    body.innerHTML=bjTabs('bjTabs',[['ahora','Ahora',n],['luego','Más adelante',L.luego.length],['hechas','Hechas',L.hechas.length]],on)+
      (on==='ahora'?bjList(L.ahora,['Todo al día','Cuando entre un new, una agenda, una tarea o un aviso, aparece acá.']):on==='luego'?bjList(L.luego,['Nada agendado','Agendá un cliente y lo vas a ver acá.']):bjList(L.hechas,['Nada hecho todavía hoy','Lo que marques como hecho queda acá hasta mañana.']));
  }
};

/* ---- la de la mesa (team leader y admin) ---- */
let campReqs=[]; // los pedidos de cambio de campaña sin hacer (los trae campReqPoll)
async function bjAvisar(uid,txt,key,btn){
  if(!uid||!noRO())return;
  const nm=memberName(uid).split(/\s+/)[0];
  modal({title:`Avisarle a ${esc(nm)}`,body:`<p class="mp">Le llega a su privado y le suena.</p><label class="fld"><span>Mensaje</span><textarea id="bjMsg" rows="3" maxlength="500" autofocus>${esc(txt||'')}</textarea></label>`,
    actions:[{l:'Cancelar'},{l:'Mandar',cls:'pri',fn:async api=>{const m=api.q('#bjMsg').value.trim();if(!m)return false;
      const cid=await B.chatDm(uid);if(!cid)return false;if(await B.sendMsg(cid,m)){toast(`Le avisaste a <b>${esc(nm)}</b>.`,'ok');bjMark(key,`Le avisaste a ${nm}: ${clip(m,80)}`)}}}]});
}
function bjMesa(){
  const now=Date.now(),te=todayS(),D=bjDone(),d=cmData(),ahora=[],hechas=[];
  const IC={ayuda:'ayuda',new:'cliente',talk:'cliente',rest:'alerta',agenda:'agenda',q3:'alerta',quiet:'alerta'},LV={0:'urg',1:'urg',2:'imp',3:'info'};
  for(const a of d.al){
    const key=a.key||('al:'+a.w+':'+(a.uid||'')+':'+clip(String(a.html).replace(/<[^>]+>/g,''),40));
    const acts=[];
    if(a.k==='ayuda')acts.push({l:'Voy',cls:'pri',bj:'voy',id:a.pid});
    else{if(a.uid)acts.push({l:'Avisarle',cls:'pri',bj:'avisar',uid:a.uid,t:a.msg||''});if(a.id)acts.push({l:'Copiar ID',cls:'sm',bj:'copiar',id:a.id});acts.push({l:'Ok',cls:'sm',bj:'ok',t:String(a.html).replace(/<[^>]+>/g,'')})}
    const x={key,lv:LV[a.w]||'info',ic:IC[a.k]||'alerta',t:a.html,s:a.s||'',acts};
    if(D[key]&&a.k!=='ayuda')continue;ahora.push(x);
  }
  for(const q of campReqs){const key='req:'+q.id,x={key,lv:'imp',ic:'campana',t:`<b>${esc(first(q.created_by))}</b> pidió un cambio en la campaña <b>${esc(q.camp)}</b>`,s:`${esc(clip(q.body,160))} · ${esc(q.aff||'')}${q.country?` · ${esc(paisOf(q.country))}`:''}`,acts:[{l:'Ver campañas',cls:'sm',bj:'ir',v:'campanas'},{l:'Hecho',cls:'pri',bj:'reqHecho',id:q.id,t:`Cambio en ${q.camp} hecho`}]};if(!D[key])ahora.push(x)}
  // tareas que hicieron hoy (las que mandaste vos o cualquiera de la mesa)
  for(const r of taskPeople)if(r.done_at&&ymd(new Date(r.done_at))===te&&r.user_id!==me){const t=taskOf(r.task_id);if(!t)continue;const key='tkd:'+r.task_id+':'+r.user_id,x={key,lv:'info',ic:'tareas',t:`<b>${esc(first(r.user_id))}</b> hizo la tarea: ${esc(clip(taskTxt(t),120))}`,s:`a las ${hhmm(+new Date(r.done_at))}`,acts:[{l:'Ok',cls:'pri',bj:'ok',t:`${first(r.user_id)} hizo la tarea`}]};if(!D[key])ahora.push(x)}
  for(const k in D)if(ymd(new Date(D[k].at))===te)hechas.push({key:k,ic:'alerta',t:esc(D[k].t||'Hecho'),s:`a las ${hhmm(D[k].at)}`,done:true,acts:[{l:'Volver a mostrar',cls:'sm',bj:'undo'}]});
  hechas.sort((a,b)=>D[b.key].at-D[a.key].at);
  return {ahora,hechas};
}
V.cmbandeja={
  build(){},
  render(){
    const body=$('#cmbBody');if(!body||!isLeader())return;
    const L=bjMesa(),n=L.ahora.length;
    $('#cmbSub').textContent=n?`${n} ${n===1?'cosa':'cosas'} para atender · ${hhmm(Date.now())}`:`Nada para atender ahora · ${hhmm(Date.now())}`;
    const on=bjTabTl;
    body.innerHTML=bjTabs('cmbTabs',[['ahora','Ahora',n],['hechas','Hechas',L.hechas.length]],on)+
      (on==='ahora'?bjList(L.ahora,['La mesa está al día','Pedidos de ayuda, news sin llamar, agendas vencidas y pedidos de campaña aparecen acá.']):bjList(L.hechas,['Nada todavía hoy','Lo que marques como atendido queda acá hasta mañana.']));
  }
};
