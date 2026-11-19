/* ---------- la ficha del cliente y el "cliente actual" ----------
   El cliente actual es el que tenés abierto en el CRM (la extensión lo manda) o el último new que entró.
   Queda siempre a mano: en pantallas anchas, en un panel a la derecha; si no, en un botón abajo que abre la ficha.
   La ficha: el cliente, cómo hacerlo depositar (Banking chico), las campañas de su afiliado en su país y los comentarios. */
let curCl=local.get('curCl',null),dockOpen=local.get('dockOpen',true),ficOk=null,dockGen=0;
const fichaCache=new Map(); // id → {at, d}
const paisOf=c=>{const k=norm(c).trim();return PAISES.find(p=>norm(p)===k)||String(c||'').trim()};
const dockWide=()=>innerWidth>=1280,fiMobile=()=>innerWidth<=820;
const dockShown=()=>!!curCl&&dockOpen&&!fiMobile();

/* ---------- números de la campaña y del afiliado ---------- */
async function dimStats(col,val){
  const k=norm(val),get=f=>col==='camp'?f.camp:String(f.aff||'');
  const sales=team.filter(f=>norm(get(f))===k&&!isArch(f.brand));
  const d30=addDays(todayS(),-29),s30=sales.filter(f=>f.date>=d30),lat=sales.filter(isLate).length,last=sales.reduce((a,f)=>!a||byDate(f,a)>0?f:a,null);
  let seen=null;
  if(crm.ok!==false){try{const rows=(await crmPage(()=>sb.from('crm_clients').select('*').neq('brand',ARCH).eq(col,String(val)).order('client_id'),5000)).map(C2X),S=soldIdx();
    let dep=0,nw=0;for(const r of rows){const f=S.get(ckey(r.brand,r.id));if(f){dep++;if(!isLate(f))nw++}else if(paidCrm(r)){dep++;if(r.ftd&&r.ftd.slice(0,10)===regDay(r))nw++}}seen={n:rows.length,dep,nw}}catch(e){}}
  return {n:sales.length,n30:s30.length,lat,last,seen};
}
function statHTML(t,val,s){
  if(!val)return `<div class="fi-c"><h4>${t}</h4><p class="p-sub" style="margin:0">El CRM no la muestra en la lista.</p></div>`;
  const rw2=(k,v)=>`<div class="fi-r"><span>${k}</span><b>${v}</b></div>`;
  return `<div class="fi-c"><h4>${t} <span class="fi-v" title="${esc(val)}">${esc(val)}</span></h4>${s&&s.n?
    rw2('FTDs en 30 días',s.n30)+rw2('FTDs en total',`${s.n} · ${pct(s.lat/s.n)} late`)+(s.last?rw2('Último FTD',`${esc(s.last.date===todayS()?'hoy':dm(s.last.date))} ${esc(s.last.time||'')}`):'')
    :'<p class="p-sub" style="margin:0 0 6px">Sin FTDs en Novara todavía.</p>'}${s&&s.seen&&s.seen.n?rw2('Depositaron',`${s.seen.dep} · ${pct(s.seen.dep/s.seen.n)}`)+rw2('Mismo día (new)',s.seen.nw):''}</div>`;
}

/* ---------- los datos de la ficha ---------- */
async function fichaData(id,force){
  const c=fichaCache.get(id);if(c&&!force&&Date.now()-c.at<30e3)return c.d;
  let r=null,log=[];
  try{[r,log]=await Promise.all([crm.ok===false?null:crmOne(id),crm.ok===false?[]:crmLog(id)])}catch(e){}
  if(!r)r=crmStatusOf(id);
  const ld=leads.find(l=>norm(l.id)===norm(id)),f=soldOf(id,r&&r.brand);
  const country=r&&r.country||ld&&ld.country||f&&f.country||'',aff=String(r&&r.aff||f&&f.aff||''),camp=r&&r.camp||f&&f.camp||'',pais=paisOf(country);
  if(bk.ok==null)await bkLoad(true);
  const [sc,sa,camps,coms,reqs]=await Promise.all([camp?dimStats('camp',camp):null,aff?dimStats('aff',aff):null,aff?campsFor(aff,pais,camp):[],commentsOf(id),aff&&bkEd()?reqsFor(aff,pais):[]]);
  const d={id,r,log,ld,f,name:r&&r.name||ld&&ld.name||f&&f.name||'',country,pais,aff,camp,sc,sa,camps,coms,reqs};
  fichaCache.set(id,{at:Date.now(),d});
  return d;
}
async function commentsOf(id){if(ficOk===false)return [];try{return await Q(sb.from('client_comments').select('*').eq('client_id',String(id)).order('created_at',{ascending:false}).limit(60))}catch(e){return []}}
async function reqsFor(aff,pais){try{return await Q(sb.from('campaign_requests').select('*').eq('aff',aff).eq('country',pais).eq('done',false).order('created_at'))}catch(e){return []}}
// las campañas del mismo afiliado en el mismo país: las vistas en el CRM, las de las ventas y las ya cargadas
async function campsFor(aff,pais,mine){
  const names=new Map();const add=c=>{c=String(c??'').trim();if(c&&!/^(null|undefined|-|—)$/i.test(c)&&!names.has(norm(c)))names.set(norm(c),c)};
  if(mine)add(mine);
  try{for(const x of await crmPage(()=>sb.from('crm_clients').select('camp,country').neq('brand',ARCH).eq('aff',aff).order('client_id'),5000))if(paisOf(x.country)===pais)add(x.camp)}catch(e){}
  for(const f of team)if(String(f.aff||'')===aff&&!isArch(f.brand)&&paisOf(f.country)===pais)add(f.camp);
  let info=[];if(ficOk!==false){try{info=await Q(sb.from('campaign_info').select('*').eq('aff',aff).eq('country',pais))}catch(e){}}
  for(const i of info)add(i.camp);
  const byK=new Map(info.map(i=>[norm(i.camp),i]));
  return [...names.values()].map(c=>({camp:c,info:byK.get(norm(c))||null,mine:mine&&norm(c)===norm(mine)})).sort((a,b)=>(b.mine?1:0)-(a.mine?1:0)||(b.info?1:0)-(a.info?1:0)||a.camp.localeCompare(b.camp));
}

/* ---------- la ficha ---------- */
function fichaHTML(d,o={}){
  const {id,r,f}=d,ra=r?regAt(r):null,tz=cliTime(d.country),ags=[...pend,...teamAg].filter(p=>norm(p.id)===norm(id)&&!p.done);
  const rw2=(k,v)=>v?`<div class="fi-r"><span>${k}</span><b>${v}</b></div>`:'';
  return `<div class="fi${o.dock?' dock':''}" data-fid="${esc(id)}">
    <div class="fi-h"><div><div class="fi-nm">${esc(d.name||'Sin nombre')}</div><div class="fi-meta">${esc(id)}${d.country?' · '+esc(d.country):''}${tz?` · son las ${tz} para el cliente`:''}${ra?` · se registró ${esc(rel(ra))}`:''}</div></div>
      <div class="fi-b">${r?stBadge(r):''}${f?`<span class="badge paid">Depositó ${esc(f.date===todayS()?'hoy':dm(f.date))}${f.uid!==me?' con '+esc(first(f.uid)):''}</span>`:r&&paidCrm(r)?`<span class="badge paid">FTD en el CRM${r.ftd?' · '+esc(r.ftd.slice(0,10)===todayS()?'hoy':dm(r.ftd.slice(0,10))):''}</span>`:''}${r&&r.grp==='dnc'?'<span class="badge bad">No se llama</span>':''}</div></div>
    <div class="fi-grid">
      <div class="fi-c"><h4>Cliente</h4>
        ${rw2('Status',r?`${esc(r.status||'—')}${dayTag(r)}`:'<span class="d">todavía no se vio en el CRM</span>')}
        ${rw2('Último contacto',r&&callAt(r)?esc(whenTxt(callAt(r))):'')}${rw2('Última nota',r&&r.note?esc(r.note):'')}
        ${rw2('Registro',ra?esc(whenTxt(ra)):'')}${rw2('Agente en el CRM',r&&r.agent?esc(r.agent):'')}${rw2('Lo llamó primero',r&&r.firstAgent&&norm(r.firstAgent)!==norm(r.agent)?esc(r.firstAgent)+' <span class="d">(la conversión es suya)</span>':'')}
        ${f?rw2('Depósito',`${money(f.amount)} USD · ${isLate(f)?'late':'new'}${demora(f)?' · a '+esc(demora(f))+' del registro':''}`):''}
        ${ags.length?rw2('Agenda',ags.map(p=>esc(whenTxt(parseDue(p.due)))).join(', ')):''}
        ${d.log.length>1?`<div class="fi-log"><span class="p-sub">Historial</span>${d.log.map(x=>`<span>${x.new_agent?`Rotó a ${esc(x.new_agent)}${x.old_agent?` <span class="d">(era de ${esc(x.old_agent)})</span>`:''}`:esc(x.new_status||'')} <span class="d">${esc(whenTxt(new Date(x.seen_at)))}</span></span>`).join('')}</div>`:''}
      </div>
      ${fiPayHTML(d)}${fiCampsHTML(d)}${fiComsHTML(d)}
      ${statHTML('Campaña',d.camp,d.sc)}${statHTML('Afiliado',d.aff,d.sa)}
    </div></div>`;
}
// cómo hacerlo depositar: lo que anda en su país, por tipo de pago, y el flujo de su banco
function fiPayHTML(d){
  const pais=PAISES.includes(d.pais)?d.pais:'';
  if(!bk.ok)return `<div class="fi-c fi-pay"><h4>Cómo hacerlo depositar</h4><p class="p-sub" style="margin:0">Banking todavía no cargó.</p></div>`;
  if(!pais)return `<div class="fi-c fi-pay"><h4>Cómo hacerlo depositar</h4><p class="p-sub" style="margin:0">${d.country?`${esc(d.country)} no está entre los países de la mesa.`:'No sé de qué país es.'}</p></div>`;
  const grp=k=>{const l=bkOptions(pais,k);return `<div class="fi-pk"><span class="fi-pl">${KINDS[k]}</span><div class="bk-chips">${l.length?l.map(o=>`<span class="bk-chip ${o.falla?'avoid':'use'}" title="${esc(o.falla?(o.p.status==='falla'?o.p.status_note:o.x.status_note)||'Está fallando':o.p.notes||'')}">${o.falla?'⚠ ':''}${esc(o.x.m.name)} · ${esc(o.p.name)}${o.falla?' · falla':''}</span>`).join(''):'<span class="dim">Nada cargado</span>'}</div></div>`};
  const banks=bk.banks.filter(b=>!b.country||b.country===pais);
  return `<div class="fi-c fi-pay"><h4>Cómo hacerlo depositar <span class="fi-v">${esc(pais)}</span></h4>
    ${['efectivo','transferencia','tarjeta'].map(grp).join('')}
    ${banks.length?`<label class="fi-pk"><span class="fi-pl">Su banco</span><select data-fbank><option value="">Elegí el banco del cliente</option>${banks.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label><div class="fi-bflow"></div>`:''}
    <button type="button" class="lnk" data-fa="banking" data-pais="${esc(pais)}">Ver en Banking</button></div>`;
}
function fiBankFlow(b){
  if(!b)return '';
  return `${(b.use_pm||[]).length||(b.avoid_pm||[]).length?`<div class="bk-chips" style="margin:6px 0">${bankChips(b)}</div>`:''}${(b.steps||[]).length?`<ol class="bk-steps">${b.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:''}${b.notes?`<p class="bk-notes">${esc(b.notes)}</p>`:''}${(bkFilesOf('bank',b.id)||[]).length?`<button type="button" class="lnk" data-fa="bankview" data-id="${esc(b.id)}">Ver fotos</button>`:''}`;
}
// las campañas del afiliado en el país: monto mínimo y qué ve la persona en el anuncio
function fiCampsHTML(d){
  if(!d.aff)return '';
  const ed=bkEd(),nReq=c=>d.reqs.filter(q=>norm(q.camp)===norm(c)).length;
  const row=c=>{const i=c.info,n=nReq(c.camp);
    return `<div class="fi-camp${c.mine?' mine':''}"><div class="fi-ch"><b>${esc(c.camp)}</b>${c.mine?'<span class="badge paid">la del cliente</span>':''}<span class="grow"></span>
      ${i?(ed?`<button type="button" class="lnk" data-fa="campEdit" data-c="${esc(c.camp)}">Editar</button>`:`<button type="button" class="lnk" data-fa="campReq" data-c="${esc(c.camp)}">Pedir un cambio</button>`):`<button type="button" class="btn sm" data-fa="campAdd" data-c="${esc(c.camp)}">Agregar</button>`}</div>
      ${i?`<div class="fi-r"><span>Monto mínimo</span><b>${esc(i.min_amount||'—')}</b></div>${i.ad_text?`<p class="fi-ad">${esc(i.ad_text)}</p>`:''}`:'<p class="p-sub" style="margin:2px 0 0">Sin datos: agregá el monto mínimo y qué ve en el anuncio.</p>'}
      ${ed&&n?`<button type="button" class="lnk hot" data-fa="campReqs" data-c="${esc(c.camp)}">${plural(n,'pedido de cambio','pedidos de cambio')}</button>`:''}</div>`};
  // para cargar datos solo aparece la campaña del cliente; las otras sin datos van en una línea
  const show=d.camps.filter(c=>c.info||c.mine),rest=d.camps.filter(c=>!c.info&&!c.mine);
  return `<div class="fi-c fi-camps"><h4>Campañas de ${esc(d.aff)}${d.pais?' en '+esc(d.pais):''}</h4>${show.map(row).join('')}${rest.length?`<p class="p-sub fi-crest">${show.length?'Sin datos':'Campañas'}: ${rest.map(c=>esc(c.camp)).join(', ')}</p>`:''}${d.camps.length?'':'<p class="p-sub" style="margin:0">Todavía no vi campañas de este afiliado.</p>'}</div>`;
}
function fiComsHTML(d){
  return `<div class="fi-c fi-coms"><h4>Comentarios</h4>
    <div class="fi-cadd"><textarea data-fcom rows="2" maxlength="1000" placeholder="Algo para recordar de este cliente (lo ve la mesa)"></textarea><button type="button" class="btn sm pri" data-fa="comAdd">Comentar</button></div>
    ${d.coms.length?`<div class="fi-cl">${d.coms.map(c=>`<div class="fi-cm"><div class="fi-cmh"><b>${esc(first(c.created_by))}</b><span class="d">${esc(rel(new Date(c.created_at)))}</span><span class="grow"></span>${c.created_by===me||bkEd()?`<button type="button" class="ib" data-fa="comDel" data-id="${esc(c.id)}" title="Borrar">✕</button>`:''}</div><p>${esc(c.body)}</p></div>`).join('')}</div>`:'<p class="p-sub" style="margin:4px 0 0">Sin comentarios todavía.</p>'}</div>`;
}
// los botones de la ficha (en el modal y en el panel)
function fichaWire(root,getD,rerender){
  root.addEventListener('change',e=>{const s=e.target.closest('[data-fbank]');if(!s)return;const box=s.closest('.fi-pay').querySelector('.fi-bflow');box.innerHTML=fiBankFlow(bk.banks.find(b=>b.id===s.value))});
  root.addEventListener('click',async e=>{
    const b=e.target.closest('[data-fa]');if(!b)return;const a=b.dataset.fa,d=getD();if(!d)return;
    if(a==='banking'){bkPais=b.dataset.pais||'';bkTipo='';closeAllModals();go('banking');return}
    if(a==='bankview')return bankView(bk.banks.find(x=>x.id===b.dataset.id));
    if(a==='campAdd'||a==='campEdit')return campModal(d,b.dataset.c,a==='campEdit',rerender);
    if(a==='campReq')return campReqModal(d,b.dataset.c);
    if(a==='campReqs')return campReqsModal(d,b.dataset.c,rerender);
    if(a==='comAdd'){const t=root.querySelector('[data-fcom]'),body=t.value.trim();if(!body)return t.focus();b.disabled=true;
      try{await Q(sb.from('client_comments').insert({client_id:String(d.id),brand:d.r&&d.r.brand||DEF_BRAND,body:body.slice(0,1000)}));t.value='';await rerender(true)}catch(err){toast(esc(errMsg(err)),'err')}finally{b.disabled=false}return}
    if(a==='comDel'){if(!await confirmar('Borrar comentario','¿Borrar este comentario?','borrar',true))return;try{await Q(sb.from('client_comments').delete().eq('id',b.dataset.id));await rerender(true)}catch(err){toast(esc(errMsg(err)),'err')}return}
  });
}
const closeAllModals=()=>modals.slice().forEach(m=>m.close());
function campModal(d,camp,edit,rerender){
  const i=(d.camps.find(c=>norm(c.camp)===norm(camp))||{}).info;
  modal({title:`${edit?'Editar':'Agregar'} campaña · ${esc(camp)}`,body:`<p class="mp">Afiliado ${esc(d.aff)}${d.pais?' · '+esc(d.pais):''}.</p>
    <label class="fld"><span>Monto mínimo del anuncio</span><input id="caM" maxlength="60" value="${esc(i&&i.min_amount||'')}" placeholder="Ej.: 250 USD" autofocus></label>
    <label class="fld"><span>Qué ve la persona en el anuncio</span><textarea id="caA" rows="4" maxlength="2000" placeholder="Ej.: Invertí con IA desde 250 USD y…">${esc(i&&i.ad_text||'')}</textarea></label><div class="ebox" id="caE"></div>`,
    actions:[{l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
      const min_amount=api.q('#caM').value.trim()||null,ad_text=api.q('#caA').value.trim()||null;
      if(!min_amount&&!ad_text){api.q('#caE').textContent='Completá el monto o lo que ve en el anuncio.';return false}
      try{if(edit)await Q(sb.from('campaign_info').update({min_amount,ad_text,updated_by:me,updated_at:new Date().toISOString()}).eq('aff',d.aff).eq('camp',camp).eq('country',d.pais));
        else await Q(sb.from('campaign_info').insert({aff:d.aff,camp,country:d.pais,min_amount,ad_text}));}
      catch(e){api.q('#caE').textContent=/duplicate|23505/.test(String(e&&(e.message||e.code)))?'Alguien ya la cargó: cerrá y volvé a abrir la ficha.':errMsg(e);return false}
      toast(edit?'Campaña actualizada.':'Campaña cargada.');await rerender(true)}}]});
}
function campReqModal(d,camp){
  modal({title:`Pedir un cambio · ${esc(camp)}`,body:`<p class="mp">Le llega al administrador y al team leader.</p><label class="fld"><span>¿Qué hay que cambiar?</span><textarea id="crB" rows="4" maxlength="1000" placeholder="Ej.: ahora el mínimo es 300 USD" autofocus></textarea></label><div class="ebox" id="crE"></div>`,
    actions:[{l:'Cancelar'},{l:'Pedir el cambio',cls:'pri',fn:async api=>{const body=api.q('#crB').value.trim();if(!body){api.q('#crE').textContent='Contá qué hay que cambiar.';return false}
      try{await Q(sb.from('campaign_requests').insert({aff:d.aff,camp,country:d.pais,body}));toast('Pedido enviado.')}catch(e){api.q('#crE').textContent=errMsg(e);return false}}}]});
}
function campReqsModal(d,camp,rerender){
  const l=d.reqs.filter(q=>norm(q.camp)===norm(camp));
  modal({title:`Pedidos de cambio · ${esc(camp)}`,body:l.map(q=>`<div class="fi-cm"><div class="fi-cmh"><b>${esc(first(q.created_by))}</b><span class="d">${esc(rel(new Date(q.created_at)))}</span><span class="grow"></span><button type="button" class="btn sm" data-done="${esc(q.id)}">Hecho</button></div><p>${esc(q.body)}</p></div>`).join('')||'<p class="dim">No hay pedidos.</p>',
    onOpen:api=>api.box.addEventListener('click',async e=>{const b=e.target.closest('[data-done]');if(!b)return;
      try{await Q(sb.from('campaign_requests').update({done:true,done_by:me,done_at:new Date().toISOString()}).eq('id',b.dataset.done));b.closest('.fi-cm').remove();await rerender(true);campReqPoll(true)}catch(err){toast(esc(errMsg(err)),'err')}}),
    actions:[{l:'Editar la campaña',fn:()=>{setTimeout(()=>campModal(d,camp,true,rerender),0)}},{l:'Listo',cls:'pri'}]});
}
// al admin y al team leader les avisa cuando alguien pide un cambio de campaña
let reqSeen=+local.get('reqSeen',0)||0;
async function campReqPoll(quiet){
  if(!ready||!bkEd()||ficOk===false)return;
  try{const l=await Q(sb.from('campaign_requests').select('id,camp,aff,country,body,created_by,created_at').eq('done',false).order('created_at',{ascending:false}).limit(20));
    const fresh=l.filter(q=>+new Date(q.created_at)>reqSeen&&q.created_by!==me);
    if(l.length)reqSeen=Math.max(reqSeen,...l.map(q=>+new Date(q.created_at)));local.set('reqSeen',reqSeen);
    if(!quiet)for(const q of fresh.slice(0,3))toast(`✏️ <b>${esc(first(q.created_by))}</b> pidió un cambio en la campaña <b>${esc(q.camp)}</b>: ${esc(clip(q.body,140))}`,'imp',{key:'cr'+q.id,ms:15000});
  }catch(e){}
}

/* ---------- la ficha en un modal (desde cualquier lista) ---------- */
async function openFicha(id,o={}){
  if(!id)return;
  let d=null;
  const acts=[{l:'Copiar ID',fn:async()=>{try{await navigator.clipboard.writeText(id);toast(`<b>${esc(id)}</b> copiado.`)}catch(e){toast('No pude copiar.','err')}return false}},
    {l:'Agendar',fn:()=>{setTimeout(()=>agendarCliente(id,d&&d.r&&d.r.status||''),0)}},{l:fichaQ.length?`Siguiente (${fichaQ.length})`:'Listo',cls:'pri',fn:()=>{if(fichaQ.length)setTimeout(()=>openFicha(fichaQ.shift()),0)}}];
  const api=modal({title:`${o.auto?'Entró un new · ':''}Cliente ${esc(id)}`,wide:1,body:'<div class="p-empty">Cargando la ficha…</div>',actions:acts});
  const draw=async force=>{d=await fichaData(id,force);if(document.body.contains(api.box)){api.mb.innerHTML=fichaHTML(d);bkHydrate(api.mb)}if(curCl&&curCl.id===id)dockRender()};
  fichaWire(api.mb,()=>d,draw);
  await draw();
}

/* ---------- el cliente actual ---------- */
function setCurrent(id,name,src){
  id=String(id||'').trim();if(!id)return;
  const same=curCl&&curCl.id===id;
  curCl={id,name:name||(same&&curCl.name)||'',src,at:Date.now()};local.set('curCl',curCl);
  if(!same)dockOpen=true,local.set('dockOpen',true);
  dockRender(!same);
}
async function dockRender(force){
  const dock=$('#dock'),chip=$('#dockChip');if(!dock)return;
  const on=ready&&dockShown();
  document.body.classList.toggle('dock-on',on&&dockWide());
  dock.hidden=!on;chip.hidden=!(ready&&curCl&&!on);
  if(curCl)chip.innerHTML=`<svg><use href="#i-clientes"/></svg><span><b>${esc(curCl.id)}</b>${curCl.name?' '+esc(clip(curCl.name,22)):''}</span>`;
  if(!on)return;
  const gen=++dockGen,id=curCl.id;
  $('#dockH').innerHTML=`<div class="dk-t"><span class="dk-k">${curCl.src==='new'?'Entró un new':'Cliente actual'}</span><span class="dk-s">${curCl.src==='crm'?'abierto en el CRM':curCl.src==='new'?'recién llegado':''} · ${esc(rel(new Date(curCl.at)))}</span></div>
    <button type="button" class="btn sm" data-dk="ag">Agendar</button><button type="button" class="ib" data-dk="re" title="Actualizar" aria-label="Actualizar">↻</button><button type="button" class="ib" data-dk="min" title="Achicar" aria-label="Achicar">—</button>`;
  if(!$('#dockB').dataset.fid||$('#dockB').dataset.fid!==id)$('#dockB').innerHTML='<div class="p-empty">Cargando la ficha…</div>';
  const d=await fichaData(id,force);if(gen!==dockGen)return;
  $('#dockB').dataset.fid=id;$('#dockB').innerHTML=fichaHTML(d,{dock:1});bkHydrate($('#dockB'));
}
function dockInit(){
  const dock=$('#dock');if(!dock||dock.dataset.wired)return;dock.dataset.wired=1;
  let d=null;const getD=()=>curCl&&(fichaCache.get(curCl.id)||{}).d;
  fichaWire($('#dockB'),getD,async force=>{await dockRender(force)});
  $('#dockH').addEventListener('click',e=>{const b=e.target.closest('[data-dk]');if(!b)return;
    if(b.dataset.dk==='min'){dockOpen=false;local.set('dockOpen',false);dockRender()}
    else if(b.dataset.dk==='re')dockRender(true);
    else if(b.dataset.dk==='ag'&&curCl){const x=getD();agendarCliente(curCl.id,x&&x.r&&x.r.status||'')}});
  $('#dockChip').addEventListener('click',()=>{if(!curCl)return;if(fiMobile())return openFicha(curCl.id);dockOpen=true;local.set('dockOpen',true);dockRender()});
  addEventListener('resize',()=>{clearTimeout(dock._rt);dock._rt=setTimeout(()=>dockRender(),200)});
}
// en vivo: comentarios y campañas del cliente que tenés abierto
function fichaLive(){if(!curCl)return;fichaCache.delete(curCl.id);if(dockShown())dockRender(true)}
async function ficInit(){try{await Q(sb.from('client_comments').select('id').limit(1));ficOk=true}catch(e){ficOk=false}}

/* ---------- cuando entra un new ---------- */
let fichaQ=[],lastKey=0;
document.addEventListener('keydown',()=>{lastKey=Date.now()},true);
function fichaNew(id){if(!id)return;setCurrent(id,'','new');if(dockShown()){toast(`Entró un new: <b>${esc(id)}</b>`,'imp',{key:'ficha'});return}if(!fichaQ.includes(id))fichaQ.push(id);setTimeout(fichaTry,400)}
function fichaTry(){ // sin el panel a la vista: la ficha se abre cuando entrás a Vitalis (o enseguida si ya estás, salvo que estés escribiendo)
  if(!ready||!fichaQ.length||modals.length)return;
  if(document.hidden||!document.hasFocus())return;
  if(Date.now()-lastKey<4000){toast(`Entró un new: <b>${esc(fichaQ[0])}</b>`,'imp',{key:'ficha',actions:[{l:'Ver ficha',fn:()=>{if(fichaQ.length)openFicha(fichaQ.shift())}}]});return}
  closeToast('ficha');openFicha(fichaQ.shift(),{auto:1});
}
addEventListener('focus',()=>setTimeout(fichaTry,300));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(fichaTry,300)});
