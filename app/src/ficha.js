/* ---------- la ficha del cliente y el "cliente actual" ----------
   El cliente actual es el que tenés abierto en el CRM (la extensión lo manda), el último new que entró o el que abriste
   desde una lista. Va en su propia sección (Cliente, tecla L), del tamaño de cualquier otra: solo quedan el menú y la barra.
   La ficha: el cliente, el depósito (el camino de Banking, con su país), las campañas de su afiliador en su país y los comentarios. */
let curCl=local.get('curCl',null),cuHist=local.get('cuHist',[]),ficOk=null,cuGen=0,cuAt=0;
const fichaCache=new Map(); // id → {at, d}
const paisOf=c=>{const k=norm(c).trim();return PAISES.find(p=>norm(p)===k)||String(c||'').trim()};

/* ---------- los datos de la ficha ---------- */
async function fichaData(id,force){
  const c=fichaCache.get(id);if(c&&!force&&Date.now()-c.at<30e3)return c.d;
  let r=null,log=[];
  try{[r,log]=await Promise.all([crm.ok===false?null:crmOne(id),crm.ok===false?[]:crmLog(id)])}catch(e){}
  if(!r)r=crmStatusOf(id);
  const ld=leads.find(l=>norm(l.id)===norm(id)),f=soldOf(id,r&&r.brand);
  const country=r&&r.country||ld&&ld.country||f&&f.country||'',aff=String(r&&r.aff||f&&f.aff||''),camp=r&&r.camp||f&&f.camp||'',pais=paisOf(country);
  if(bk.ok==null)await bkLoad(true);
  const [cs,camps,coms,reqs]=await Promise.all([comboStats(aff,camp,country),aff?campsFor(aff,pais,camp):[],commentsOf(id),aff&&bkEd()?reqsFor(aff,pais):[]]);
  const d={id,r,log,ld,f,name:'',country,pais,aff,camp:camN(camp),cs,camps,coms,reqs,kw:clientKw(id)};
  fichaCache.set(id,{at:Date.now(),d});
  return d;
}
async function commentsOf(id){if(ficOk===false)return [];try{return await Q(sb.from('client_comments').select('*').eq('client_id',String(id)).order('created_at',{ascending:false}).limit(60))}catch(e){return []}}
async function reqsFor(aff,pais){try{return await Q(sb.from('campaign_requests').select('*').eq('aff',aff).eq('country',pais).eq('done',false).order('created_at'))}catch(e){return []}}
// las campañas del mismo afiliador en el mismo país: las vistas en el CRM, las de las ventas y las ya cargadas
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
function fichaHTML(d){
  const {id,r,f}=d,ra=r?regAt(r):null,tz=cliTime(d.country),ags=[...pend,...teamAg].filter(p=>norm(p.id)===norm(id)&&!p.done);
  const rw2=(k,v)=>v?`<div class="fi-r"><span>${k}</span><b>${v}</b></div>`:'';
  return `<div class="fi" data-fid="${esc(id)}">
    <div class="fi-h"><div><div class="fi-nm">${esc(id)}</div><div class="fi-meta">${d.pais?esc(d.pais):''}${tz?` · son las ${tz} para el cliente`:''}${ra?` · se registró ${esc(rel(ra))}`:''}</div></div>
      <div class="fi-b">${r?stBadge(r):''}${f?`<span class="badge paid">Depositó ${esc(f.date===todayS()?'hoy':dm(f.date))}${f.uid!==me?' con '+esc(first(f.uid)):''}</span>`:r&&paidCrm(r)?`<span class="badge paid">FTD en el CRM${r.ftd?' · '+esc(r.ftd.slice(0,10)===todayS()?'hoy':dm(r.ftd.slice(0,10))):''}</span>`:''}</div></div>
    <div class="fi-cols"><div class="fi-col fi-main">${comboHTML(d)}${fiComsHTML(d)}</div>
      <div class="fi-col">
      <div class="fi-c"><h4>Cliente</h4>
        ${rw2('En el CRM',r?esc(sgPlain(r)||'—'):'<span class="d">todavía no se vio en el CRM</span>')}
        <div class="fi-r fi-kw"><span>Palabra clave</span><b>${d.kw?esc(d.kw):'<span class="d">sin asignar</span>'} <button type="button" class="lnk" data-fa="kwEdit">${d.kw?'editar':'agregar'}</button></b></div>
        ${rw2('Último contacto',r&&callAt(r)?esc(whenTxt(callAt(r))):'')}${rw2('Última nota',r&&r.note?esc(r.note):'')}
        ${rw2('Registro',ra?esc(whenTxt(ra)):'')}${rw2('Agente en el CRM',r&&r.agent?esc(r.agent):'')}${rw2('Lo llamó primero',r&&r.firstAgent&&norm(r.firstAgent)!==norm(r.agent)?esc(r.firstAgent)+' <span class="d">(la conversión es suya)</span>':'')}
        ${f?rw2('Depósito',`${money(f.amount)} USD · ${isLate(f)?'late':'new'}${demora(f)?' · a '+esc(demora(f))+' del registro':''}`):''}
        ${ags.length?rw2('Agenda',ags.map(p=>esc(whenTxt(parseDue(p.due)))).join(', ')):''}
        ${d.log.length>1?`<div class="fi-log"><span class="p-sub">Historial</span>${d.log.map(x=>`<span>${x.new_agent?`Rotó a ${esc(x.new_agent)}${x.old_agent?` <span class="d">(era de ${esc(x.old_agent)})</span>`:''}`:esc(x.new_status||'')} <span class="d">${esc(whenTxt(new Date(x.seen_at)))}</span></span>`).join('')}</div>`:''}
      </div>
      ${fiPayHTML(d)}</div>
    </div></div>`;
}
// Depósito: el camino, con el país del cliente (no se pregunta): ¿efectivo o digital? → ¿tarjeta o transferencia? → qué ofrecerle (lo que anda primero)
let fiPayT={id:'',t:'',bank:'',all:false};
const FI_OPTS=6; // las primeras que andan; el resto, con "Ver todas"
function fiPayHTML(d){
  const pais=PAISES.includes(d.pais)?d.pais:'',H=`<h4>Depósito${pais?` <span class="fi-v">${esc(pais)}</span>`:''}</h4>`;
  if(!bk.ok)return `<div class="fi-c fi-pay">${H}<p class="p-sub" style="margin:0">Banking todavía no cargó.</p></div>`;
  if(!pais)return `<div class="fi-c fi-pay">${H}<p class="p-sub" style="margin:0">${d.country?`${esc(d.country)} no está entre los países de la mesa.`:'No sé de qué país es.'}</p></div>`;
  if(fiPayT.id!==String(d.id))fiPayT={id:String(d.id),t:'',bank:'',all:false}; // otro cliente: el camino arranca de cero
  const KS=['efectivo','transferencia','tarjeta'],has=k=>bkOptions(pais,k).some(o=>!o.falla);
  if(!KS.some(k=>bkOptions(pais,k).length))return `<div class="fi-c fi-pay">${H}<p class="p-sub" style="margin:0 0 6px">Todavía no hay métodos cargados para ${esc(pais)}.${bkEd()?' Cargalos en Banking para que el resto de la mesa los tenga.':' Pedíselo a tu team leader para poder ofrecerle cómo pagar.'}</p></div>`;
  const t=fiPayT.t,dig=['digital','transferencia','tarjeta'].includes(t),fin=KS.includes(t);
  const seg=(lab,items,on)=>`<div class="fi-step"><span class="fi-pl">${lab}</span><div class="seg" role="group" aria-label="${esc(lab)}">${items.map(([k,l,ok])=>`<button type="button" data-fpt="${k}" class="${on(k)?'on':''}"${ok?'':' title="No hay nada que ande ahora"'}>${esc(l)}${ok?'':' <span class="dim">(no hay)</span>'}</button>`).join('')}</div></div>`;
  let h=seg('1. ¿Paga en efectivo o digital?',[['efectivo','Efectivo',has('efectivo')],['digital','Digital',has('transferencia')||has('tarjeta')]],k=>k==='digital'?dig:t===k);
  if(dig)h+=seg('2. ¿Con tarjeta o transferencia?',[['tarjeta','Tarjeta',has('tarjeta')],['transferencia','Transferencia',has('transferencia')]],k=>t===k);
  if(fin){
    const L=bkOptions(pais,t),ok=L.filter(o=>!o.falla),bad=L.filter(o=>o.falla),show=fiPayT.all?ok:ok.slice(0,FI_OPTS);
    h+=`<div class="fi-opts"><span class="fi-pl">${dig?'3':'2'}. Ofrecele ${esc(KINDS[t].toLowerCase())}:</span>
      ${ok.length?show.map(bkOptHTML).join('')+(ok.length>show.length?`<button type="button" class="lnk" data-fpall>Ver las ${ok.length} que andan</button>`:''):`<p class="p-sub" style="margin:0">Ahora no anda ningún${t==='tarjeta'?'a tarjeta':t==='efectivo'?' efectivo':'a transferencia'} en ${esc(pais)}. Probá con otra forma de pago.</p>`}
      ${bad.length?`<p class="fi-bad"><b>No ofrecer ahora (fallan):</b> ${bad.map(o=>esc(o.m.name+' · '+procName(o.p))).join(', ')}</p>`:''}</div>`;
  }
  const banks=bk.banks.filter(b=>!b.country||b.country===pais),bk1=banks.find(b=>b.id===fiPayT.bank);
  return `<div class="fi-c fi-pay">${H}${h}
    ${banks.length?`<label class="fi-pk"><span class="fi-pl">¿Sabés su banco? (opcional)</span><select data-fbank><option value="">Elegí el banco del cliente</option>${banks.map(b=>`<option value="${esc(b.id)}"${b.id===fiPayT.bank?' selected':''}>${esc(b.name)}</option>`).join('')}</select></label><div class="fi-bflow">${bk1?fiBankFlow(bk1):''}</div>`:''}
    <button type="button" class="lnk" data-fa="banking" data-pais="${esc(pais)}">Ver todo en Banking</button></div>`;
}
function fiBankFlow(b){
  if(!b)return '';
  return `${(b.use_pm||[]).length?`<div class="bk-chips" style="margin:6px 0">${bankChips(b)}</div>`:''}${(b.steps||[]).length?`<ol class="bk-steps">${b.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:''}${b.notes?`<p class="bk-notes">${esc(b.notes)}</p>`:''}${(bkFilesOf('bank',b.id)||[]).length?`<button type="button" class="lnk" data-fa="bankview" data-id="${esc(b.id)}">Ver fotos</button>`:''}`;
}
// las campañas del afiliador en el país: monto mínimo y qué ve la persona en el anuncio
function fiCampsHTML(d){ // el anuncio de la campaña del cliente (y las otras del afiliador en una línea): va adentro de la tarjeta Campaña
  if(!d.aff)return '';
  const ed=bkEd(),nReq=c=>d.reqs.filter(q=>norm(q.camp)===norm(c)).length;
  const row=c=>{const i=c.info,n=nReq(c.camp);
    return `<div class="fi-camp${c.mine?' mine':''}"><div class="fi-ch"><b>${esc(c.camp)}</b>${c.mine?'<span class="badge paid">la del cliente</span>':''}<span class="grow"></span>
      ${i?(ed?`<button type="button" class="lnk" data-fa="campEdit" data-c="${esc(c.camp)}">Editar</button>`:`<button type="button" class="lnk" data-fa="campReq" data-c="${esc(c.camp)}">Pedir un cambio</button>`):`<button type="button" class="btn sm" data-fa="campAdd" data-c="${esc(c.camp)}">Agregar</button>`}</div>
      ${i?`<div class="fi-r"><span>Monto mínimo</span><b>${esc(i.min_amount||'—')}</b></div>${i.ad_text?`<p class="fi-ad">${esc(i.ad_text)}</p>`:''}`:'<p class="p-sub" style="margin:2px 0 0">Todavía no sabemos el monto mínimo ni qué ve en el anuncio. Si lo sabés, agregalo.</p>'}
      ${ed&&n?`<button type="button" class="lnk hot" data-fa="campReqs" data-c="${esc(c.camp)}">${plural(n,'pedido de cambio','pedidos de cambio')}</button>`:''}</div>`};
  // para cargar datos solo aparece la campaña del cliente; las otras sin datos van en una línea
  const show=d.camps.filter(c=>c.info||c.mine),rest=d.camps.filter(c=>!c.info&&!c.mine);
  return `<div class="fi-camps"><span class="p-sub">El anuncio</span>${show.map(row).join('')}${rest.length?`<p class="p-sub fi-crest">Otras de ${esc(d.aff)}${d.pais?' en '+esc(d.pais):''}: ${rest.map(c=>esc(c.camp)).join(', ')}</p>`:''}</div>`;
}
// el traductor de Chrome (corre en la computadora: no manda nada afuera). La primera vez baja el idioma: hay que llamarlo con un toque
let trP=null,trState='';const trCache=new Map(),TR_O={sourceLanguage:'es',targetLanguage:'en'}; // trState: '' · bajando · listo · no
function trOpen(){
  if(trP)return trP;
  if(!('Translator' in self)){trState='no';return trP=Promise.resolve(null)}
  trP=(async()=>{const a=await Translator.availability(TR_O);if(a==='unavailable'){trState='no';return null}
    if(a!=='available')trState='bajando';const t=await Translator.create(TR_O);trState='listo';return t})()
    .catch(()=>{trP=null;if(trState!=='no')trState='';return null}); // sin toque falla: se reintenta en el próximo
  return trP;
}
const tmo=(p,ms)=>Promise.race([p,new Promise(ok=>setTimeout(()=>ok(null),ms))]); // nunca esperar de más: mientras baja, va en español
async function trEn(s,t){ // t: el traductor ya abierto
  if(trCache.has(s))return trCache.get(s);
  if(!t)return null;
  try{const r=String(await tmo(t.translate(s),5000)||'').trim();if(r){trCache.set(s,r);return r}}catch(e){}
  return null;
}
const trWhy=()=>trState==='bajando'?'Chrome está bajando el traductor: lo que escribiste quedó en español. Probá de nuevo en un minuto.':'Este Chrome no tiene el traductor: lo que escribiste queda en español (hay que actualizar Chrome).';
function fiComsHTML(d){
  return `<div class="fi-c fi-coms"><h4>Comentarios</h4>
    <div class="fi-cadd"><textarea data-fcom rows="2" maxlength="1000" placeholder="Algo para recordar de este cliente (lo ve la mesa)"></textarea><button type="button" class="btn sm pri" data-fa="comAdd">Comentar</button></div>
    ${d.coms.length?`<div class="fi-cl">${d.coms.map(c=>`<div class="fi-cm"><div class="fi-cmh"><b>${esc(first(c.created_by))}</b><span class="d">${esc(rel(new Date(c.created_at)))}</span><span class="grow"></span>${c.created_by===me||bkEd()?`<button type="button" class="ib" data-fa="comDel" data-id="${esc(c.id)}" title="Borrar">✕</button>`:''}</div><p>${esc(c.body)}</p></div>`).join('')}</div>`:'<p class="p-sub" style="margin:4px 0 0">Sin comentarios todavía.</p>'}</div>`;
}
// los botones de la ficha (en el modal y en el panel)
function fichaWire(root,getD,rerender){
  root.addEventListener('change',e=>{const s=e.target.closest('[data-fbank]');if(!s)return;fiPayT.bank=s.value;const box=s.closest('.fi-pay').querySelector('.fi-bflow');box.innerHTML=fiBankFlow(bk.banks.find(b=>b.id===s.value))});
  root.addEventListener('click',e=>{ // el camino del depósito
    const pt=e.target.closest('[data-fpt]'),pa=e.target.closest('[data-fpall]');if(!pt&&!pa)return;const d=getD(),box=e.target.closest('.fi-pay');if(!d||!box)return;
    if(pt){const v=pt.dataset.fpt;fiPayT.t=v==='digital'&&['tarjeta','transferencia'].includes(fiPayT.t)?fiPayT.t:v;fiPayT.all=false}else fiPayT.all=true;
    box.outerHTML=fiPayHTML(d);
  });
  root.addEventListener('click',async e=>{
    const b=e.target.closest('[data-fa]');if(!b)return;const a=b.dataset.fa,d=getD();if(!d)return;
    if(a==='banking'){bkPais=b.dataset.pais||'';bkTipo='';bkWay='';closeAllModals();go('banking');return}
    if(a==='bankview')return bankView(bk.banks.find(x=>x.id===b.dataset.id));
    if(a==='campAdd'||a==='campEdit')return campModal(d,b.dataset.c,a==='campEdit',rerender);
    if(a==='campReq')return campReqModal(d,b.dataset.c);
    if(a==='campReqs')return campReqsModal(d,b.dataset.c,rerender);
    if(a==='comAdd'){const t=root.querySelector('[data-fcom]'),body=t.value.trim();if(!body)return t.focus();b.disabled=true;
      try{await Q(sb.from('client_comments').insert({client_id:String(d.id),brand:d.r&&d.r.brand||DEF_BRAND,body:body.slice(0,1000)}));t.value='';await rerender(true)}catch(err){toast(esc(errMsg(err)),'err')}finally{b.disabled=false}return}
    if(a==='kwEdit')return kwModal(d,rerender);
    if(a==='comDel'){if(!await confirmar('Borrar comentario','¿Borrar este comentario?','borrar',true))return;try{await Q(sb.from('client_comments').delete().eq('id',b.dataset.id));await rerender(true)}catch(err){toast(esc(errMsg(err)),'err')}return}
  });
}
const closeAllModals=()=>modals.slice().forEach(m=>m.close());
async function setClientKw(id,brand,kw){
  const r=await Q(sb.rpc('client_kw_set',{p_client:String(id),p_brand:brand||clientBrand(id),p_kw:kw||''}));
  const k=norm(id);if(r&&r.kw)ckw[k]={kw:r.kw,brand:brand||clientBrand(id)};else delete ckw[k];
  return r;
}
function kwModal(d,rerender){
  const cur=d.kw||'';
  modal({title:`Palabra clave de ${esc(d.name||d.id)}`,
    body:`<p class="mp">La palabra de confidencialidad que acordaste con el cliente para verificarlo en las próximas llamadas.</p>
      <label class="fld"><span>Palabra clave</span><input id="kwIn" maxlength="80" value="${esc(cur)}" placeholder="Ej.: montevideo" autocomplete="off"></label><div class="ebox" id="kwErr"></div>`,
    onOpen:api=>{const i=api.q('#kwIn');i.focus();i.select()},
    actions:[...(cur?[{l:'Borrar',cls:'danger',fn:async api=>{try{await setClientKw(d.id,d.r&&d.r.brand,'');await rerender(true);toast('Palabra clave borrada.')}catch(e){api.q('#kwErr').textContent=errMsg(e);return false}}}]:[]),
      {l:'Cancelar'},
      {l:'Guardar',cls:'pri',fn:async api=>{const v=api.q('#kwIn').value.trim();if(v===cur)return;try{await setClientKw(d.id,d.r&&d.r.brand,v);await rerender(true);toast(v?'Palabra clave guardada.':'Palabra clave borrada.')}catch(e){api.q('#kwErr').textContent=errMsg(e);return false}}}]});
}
function campModal(d,camp,edit,rerender){
  const i=(d.camps.find(c=>norm(c.camp)===norm(camp))||{}).info;
  modal({title:`${edit?'Editar':'Agregar'} campaña · ${esc(camp)}`,body:`<p class="mp">Afiliador ${esc(d.aff)}${d.pais?' · '+esc(d.pais):''}.</p>
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

/* ---------- la sección Cliente ---------- */
// desde cualquier lista: la ficha se abre en la sección Cliente
function openFicha(id){id=String(id||'').trim();if(!id)return;closeAllModals();setCurrent(id,'','lista');go('cliente')}
function setCurrent(id,name,src){
  id=String(id||'').trim();if(!id)return;
  const same=curCl&&curCl.id===id;
  curCl={id,name:name||(same&&curCl.name)||'',src,at:Date.now()};local.set('curCl',curCl);
  cuHist=[{id,name:curCl.name},...cuHist.filter(h=>h.id!==id)].slice(0,6);local.set('cuHist',cuHist);cliBadge();dockSoon();
  if(src!=='lista'&&!same)cuShow(src);
  else if(cur==='cliente')cuRender(!same);
}
// un cliente nuevo del CRM o un new: la sección Cliente pasa adelante (salvo para el team leader, o si estás escribiendo en Vitalis)
let lastKey=0;
document.addEventListener('keydown',()=>{lastKey=Date.now()},true);
function cuShow(src){
  if(!ready)return;
  const t=src==='new'?`Entró un new: <b>${esc(curCl.id)}</b>`:`Cliente actual: <b>${esc(curCl.id)}</b>${curCl.name?' '+esc(clip(curCl.name,30)):''}`;
  if(isLeadUid(me)||modals.length||Date.now()-lastKey<4000){if(cur==='cliente')cuRender(true);toast(t,src==='new'?'imp':'info',{key:'ficha',actions:[{l:'Ver',fn:()=>go('cliente')}]});return}
  closeToast('ficha');if(src==='new')toast(t,'imp',{key:'ficha'});
  if(cur==='cliente')cuRender(true);else go('cliente');
}
const cuSrc=c=>c.src==='crm'?'abierto en el CRM':c.src==='new'?'entró un new':'abierto desde Vitalis';
function cuTopHTML(){
  const h=cuHist.filter(x=>!curCl||x.id!==curCl.id);
  return `<div class="cu-bar">${curCl?`<span class="cu-src"><span class="cu-dot ${esc(curCl.src||'')}"></span>Cliente actual · ${cuSrc(curCl)} · ${esc(rel(new Date(curCl.at)))}</span>`:'<span class="cu-src">Cliente actual</span>'}
    <span class="grow"></span>
    ${curCl?`<button type="button" class="btn sm pri" data-cu="ag">Agendar</button><button type="button" class="btn sm" data-cu="copy">Copiar ID</button><button type="button" class="ib" data-cu="re" title="Actualizar" aria-label="Actualizar">↻</button>`:''}</div>
    <details class="cu-more" data-k="cu-more"${curCl?'':' open'}><summary>Otro cliente</summary><div class="cu-rec"><form class="cu-find" data-cu="find"><input name="q" type="search" inputmode="numeric" placeholder="Abrir por ID" aria-label="Abrir un cliente por ID" autocomplete="off"></form>${h.length?`<span class="p-sub">Recientes</span>${h.map(x=>`<button type="button" class="chip" data-cu="rec" data-id="${esc(x.id)}"><b>${esc(x.id)}</b></button>`).join('')}`:''}</div></details>`;
}
async function cuRender(force){
  const top=$('#cuTop'),body=$('#cuBody');if(!top||!ready)return;
  if(!top.contains(document.activeElement)||force){const ok=openKeys(top);top.innerHTML=cuTopHTML();reopen(top,ok)} // sin pisar el ID que estás escribiendo ni plegar "Otro cliente"
  if(!curCl){delete body.dataset.fid;body.innerHTML=`<div class="cu-empty"><svg><use href="#i-cliente"/></svg><h2>Abrí un cliente en el CRM</h2><p>Aparece acá con la campaña, el depósito y los comentarios. Cuando entra un new, también.</p></div>`;return}
  const id=curCl.id;
  // con la misma ficha a la vista, los refrescos de la app no la vuelven a dibujar (así no se pierde lo que estás escribiendo)
  if(!force&&body.dataset.fid===id&&Date.now()-cuAt<30e3)return;
  const gen=++cuGen;
  if(body.dataset.fid!==id)body.innerHTML='<div class="p-empty">Cargando la ficha…</div>';
  const d=await fichaData(id,force);if(gen!==cuGen||!curCl||curCl.id!==id)return;
  const ta=body.querySelector('[data-fcom]'),txt=ta&&body.dataset.fid===id?ta.value:'',foc=ta&&document.activeElement===ta,bs=body.querySelector('[data-fbank]'),bv=bs&&body.dataset.fid===id?bs.value:'';
  const opened=body.dataset.fid===id?openKeys(body):new Set();
  body.dataset.fid=id;cuAt=Date.now();body.innerHTML=fichaHTML(d);reopen(body,opened);bkHydrate(body);
  const t2=body.querySelector('[data-fcom]');if(t2&&txt){t2.value=txt;if(foc)t2.focus()}
  const b2=body.querySelector('[data-fbank]');if(b2&&bv){b2.value=bv;b2.dispatchEvent(new Event('change',{bubbles:true}))}
  if(d.name&&!curCl.name){curCl.name=d.name;local.set('curCl',curCl);cuHist=cuHist.map(h=>h.id===id?{id,name:d.name}:h);local.set('cuHist',cuHist);const ok=openKeys(top);top.innerHTML=cuTopHTML();reopen(top,ok)}
}
V.cliente={
  build(){
    const getD=()=>curCl&&(fichaCache.get(curCl.id)||{}).d;
    fichaWire($('#cuBody'),getD,force=>cuRender(force===undefined?true:force));
    $('#cuTop').addEventListener('submit',e=>{const f=e.target.closest('[data-cu=find]');if(!f)return;e.preventDefault();const q=f.q.value.replace(/\D/g,'');if(q)setCurrent(q,'','lista')});
    $('#cuTop').addEventListener('click',async e=>{const b=e.target.closest('[data-cu]');if(!b||b.tagName==='FORM')return;const a=b.dataset.cu;
      if(a==='re')return cuRender(true);
      if(a==='rec'){const h=cuHist.find(x=>x.id===b.dataset.id);return setCurrent(b.dataset.id,h&&h.name||'','lista')}
      if(!curCl)return;
      if(a==='copy'){try{await navigator.clipboard.writeText(curCl.id);toast(`<b>${esc(curCl.id)}</b> copiado.`)}catch(err){toast('No pude copiar.','err')}return}
      if(a==='ag')return agendarCliente(curCl.id);});
  },
  render(o){cuRender(!!o.force)}
};
// en vivo: comentarios y campañas del cliente que tenés abierto
function fichaLive(){if(!curCl)return;fichaCache.delete(curCl.id);if(cur==='cliente')cuRender(true);dockSoon()}
const ficFetch=()=>QN(sb.from('client_comments').select('id').limit(1)).then(r=>!!r);
async function ficInit(){ficOk=await ficFetch()}

/* ---------- cuando entra un new ---------- */
function fichaNew(id){if(id)setCurrent(id,'','new')}
