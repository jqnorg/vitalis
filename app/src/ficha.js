/* ---------- la ficha del cliente y el "cliente actual" ----------
   El cliente actual es el que tenés abierto en el CRM (la extensión lo manda), el último new que entró o el que abriste
   desde una lista. Va en su propia sección (Cliente, tecla L), del tamaño de cualquier otra: solo quedan el menú y la barra.
   La ficha: el cliente, cómo hacerlo depositar (Banking chico), las campañas de su afiliador en su país y los comentarios. */
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
  const [cs,camps,coms,reqs,prof]=await Promise.all([comboStats(aff,camp,country),aff?campsFor(aff,pais,camp):[],commentsOf(id),aff&&bkEd()?reqsFor(aff,pais):[],profileOf(id)]);
  const d={id,r,log,ld,f,name:r&&r.name||ld&&ld.name||f&&f.name||'',country,pais,aff,camp:camN(camp),cs,camps,coms,reqs,prof};
  fichaCache.set(id,{at:Date.now(),d});
  return d;
}
async function commentsOf(id){if(ficOk===false)return [];try{return await Q(sb.from('client_comments').select('*').eq('client_id',String(id)).order('created_at',{ascending:false}).limit(60))}catch(e){return []}}
async function profileOf(id){if(ficOk===false)return null;try{const r=await Q(sb.from('client_profiles').select('*').eq('client_id',String(id)).limit(1));return r[0]||null}catch(e){return null}}
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
    <div class="fi-h"><div><div class="fi-nm">${esc(d.name||'Sin nombre')}</div><div class="fi-meta">${esc(id)}${d.pais?' · '+esc(d.pais):''}${tz?` · son las ${tz} para el cliente`:''}${ra?` · se registró ${esc(rel(ra))}`:''}</div></div>
      <div class="fi-b">${r?stBadge(r):''}${f?`<span class="badge paid">Depositó ${esc(f.date===todayS()?'hoy':dm(f.date))}${f.uid!==me?' con '+esc(first(f.uid)):''}</span>`:r&&paidCrm(r)?`<span class="badge paid">FTD en el CRM${r.ftd?' · '+esc(r.ftd.slice(0,10)===todayS()?'hoy':dm(r.ftd.slice(0,10))):''}</span>`:''}${r&&r.grp==='dnc'?'<span class="badge bad">No se llama</span>':''}</div></div>
    <div class="fi-cols"><div class="fi-col">
      <div class="fi-c"><h4>Cliente</h4>
        ${rw2('Status',r?`${esc(r.status||'—')}${dayTag(r)}`:'<span class="d">todavía no se vio en el CRM</span>')}
        ${rw2('Último contacto',r&&callAt(r)?esc(whenTxt(callAt(r))):'')}${rw2('Última nota',r&&r.note?esc(r.note):'')}
        ${rw2('Registro',ra?esc(whenTxt(ra)):'')}${rw2('Agente en el CRM',r&&r.agent?esc(r.agent):'')}${rw2('Lo llamó primero',r&&r.firstAgent&&norm(r.firstAgent)!==norm(r.agent)?esc(r.firstAgent)+' <span class="d">(la conversión es suya)</span>':'')}
        ${f?rw2('Depósito',`${money(f.amount)} USD · ${isLate(f)?'late':'new'}${demora(f)?' · a '+esc(demora(f))+' del registro':''}`):''}
        ${ags.length?rw2('Agenda',ags.map(p=>esc(whenTxt(parseDue(p.due)))).join(', ')):''}
        ${d.log.length>1?`<div class="fi-log"><span class="p-sub">Historial</span>${d.log.map(x=>`<span>${x.new_agent?`Rotó a ${esc(x.new_agent)}${x.old_agent?` <span class="d">(era de ${esc(x.old_agent)})</span>`:''}`:esc(x.new_status||'')} <span class="d">${esc(whenTxt(new Date(x.seen_at)))}</span></span>`).join('')}</div>`:''}
      </div>
      ${fiPayHTML(d)}${fiCampsHTML(d)}</div>
      <div class="fi-col">${fiProfHTML(d)}${fiComsHTML(d)}${comboHTML(d)}</div>
    </div></div>`;
}
// cómo hacerlo depositar: lo que anda en su país, por tipo de pago, y el flujo de su banco
function fiPayHTML(d){
  const pais=PAISES.includes(d.pais)?d.pais:'';
  if(!bk.ok)return `<div class="fi-c fi-pay"><h4>Cómo hacerlo depositar</h4><p class="p-sub" style="margin:0">Banking todavía no cargó.</p></div>`;
  if(!pais)return `<div class="fi-c fi-pay"><h4>Cómo hacerlo depositar</h4><p class="p-sub" style="margin:0">${d.country?`${esc(d.country)} no está entre los países de la mesa.`:'No sé de qué país es.'}</p></div>`;
  const grp=k=>{const l=bkOptions(pais,k);return `<div class="fi-pk"><span class="fi-pl">${KINDS[k]}</span><div class="bk-chips">${l.length?l.map(o=>`<span class="bk-chip ${o.falla?'avoid':'use'}" title="${esc(o.falla?(failsIn(o.p,pais)?o.p.status_note:o.x.status_note)||'Está fallando':o.p.notes||'')}">${o.falla?'⚠ ':''}${esc(o.x.m.name)} · ${esc(o.p.name)}${o.falla?' · falla':''}</span>`).join(''):'<span class="dim">Nada cargado</span>'}</div></div>`};
  const hasAny=['efectivo','transferencia','tarjeta'].some(k=>bkOptions(pais,k).length);
  const banks=bk.banks.filter(b=>!b.country||b.country===pais);
  return `<div class="fi-c fi-pay"><h4>Cómo hacerlo depositar <span class="fi-v">${esc(pais)}</span></h4>
    ${hasAny?['efectivo','transferencia','tarjeta'].map(grp).join(''):`<p class="p-sub" style="margin:0 0 6px">Todavía no hay métodos cargados para ${esc(pais)}.${bkEd()?' Cargalos en Banking para que el resto de la mesa los tenga.':' Pedíselo a tu team leader para poder ofrecerle cómo pagar.'}</p>`}
    ${banks.length?`<label class="fi-pk"><span class="fi-pl">Su banco</span><select data-fbank><option value="">Elegí el banco del cliente</option>${banks.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label><div class="fi-bflow"></div>`:''}
    <button type="button" class="lnk" data-fa="banking" data-pais="${esc(pais)}">Ver en Banking</button></div>`;
}
function fiBankFlow(b){
  if(!b)return '';
  return `${(b.use_pm||[]).length||(b.avoid_pm||[]).length?`<div class="bk-chips" style="margin:6px 0">${bankChips(b)}</div>`:''}${(b.steps||[]).length?`<ol class="bk-steps">${b.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:''}${b.notes?`<p class="bk-notes">${esc(b.notes)}</p>`:''}${(bkFilesOf('bank',b.id)||[]).length?`<button type="button" class="lnk" data-fa="bankview" data-id="${esc(b.id)}">Ver fotos</button>`:''}`;
}
// las campañas del afiliador en el país: monto mínimo y qué ve la persona en el anuncio
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
  return `<div class="fi-c fi-camps"><h4>Campañas de ${esc(d.aff)}${d.pais?' en '+esc(d.pais):''}</h4>${show.map(row).join('')}${rest.length?`<p class="p-sub fi-crest">${show.length?'Sin datos':'Campañas'}: ${rest.map(c=>esc(c.camp)).join(', ')}</p>`:''}${d.camps.length?'':'<p class="p-sub" style="margin:0">Todavía no vi campañas de este afiliador.</p>'}</div>`;
}
// el perfil que exige la gerencia: edad, ocupación y objetivo siempre; más si tiene el dinero y por qué no depositó
function profFalta(p){const f=[];if(!p||p.edad==null)f.push('edad');if(!p||(!p.ocupacion&&!p.desocupado))f.push('ocupación');if(!p||!p.objetivo)f.push('objetivo');return f}
// cómo terminó la llamada: cada final sugiere un status del CRM y arma su cierre justificado (ES/EN)
const PROF_OUT={
  pending:{l:'Depósito en proceso (boleto creado)',st:'Pending Payment',
    es:'Se avanzó hasta generar el boleto y el depósito quedó en proceso. Se dará seguimiento para confirmar que se complete.',
    en:'We moved forward and the payment slip was generated; the deposit is now in process. We will follow up to confirm it is completed.'},
  failed_proc:{l:'Depósito trabado — procesador',st:'Failed Deposit',
    es:'Se intentó concretar el depósito pero falló por el procesador de pago. Se le ofrecerá otra vía en el próximo contacto.',
    en:'The deposit was attempted but failed due to the payment processor. An alternative method will be offered on the next contact.'},
  failed_bank:{l:'Depósito trabado — banco',st:'Bank Block',
    es:'Se intentó concretar el depósito pero lo bloqueó el banco del cliente. Se le ofrecerá otra vía en el próximo contacto.',
    en:"The deposit was attempted but was blocked by the client's bank. An alternative method will be offered on the next contact."},
  no_money:{l:'No tiene el dinero',st:'Low Potential',note:'con agenda si dio fecha',
    es:'Se le insistió y se le ofrecieron distintas formas de pago, pero no dispone del dinero en este momento. Queda a la espera de una mejor oportunidad.',
    en:'The client was encouraged and offered several payment methods, but does not have the funds at this time. Pending a better opportunity.'},
  not_now:{l:'No quiere invertir ahora / lo está pensando',st:'Call Again',note:'CallBack si dejó una cita concreta',
    es:'Se intentó insistir para que invirtiera, pero por ahora no quiere avanzar. Se continuará insistiendo en los próximos contactos.',
    en:'The client was urged to invest, but does not want to move forward for now. We will keep following up on the next contacts.'},
  not_interested:{l:'No le interesa invertir',st:'Not Interested',
    es:'Se le presentó la propuesta y se insistió, pero el cliente manifiesta que no le interesa invertir.',
    en:'The offer was presented and the client was encouraged, but states no interest in investing.'},
  dnc:{l:'No puede operar (nacionalidad prohibida o menor de 18)',st:'Do Not Call',
    es:'El cliente no puede operar (nacionalidad no admitida o menor de edad). No se vuelve a contactar.',
    en:'The client is not eligible to operate (restricted nationality or under 18). Not to be contacted again.'},
  dropped:{l:'Se cortó la llamada (sin boleto)',st:'Call Again',
    es:'La llamada se cortó antes de poder avanzar. Se intentó retomar el contacto de inmediato y se continuará en el próximo intento.',
    en:'The call dropped before we could make progress. We tried to reconnect right away and will continue on the next attempt.'},
};
const PROF_ORDER=['pending','failed_proc','failed_bank','no_money','not_now','not_interested','dnc','dropped'];
function profStatus(p){const o=p&&p.outcome&&PROF_OUT[p.outcome];return o?o.st+(o.note?` (${o.note})`:''):''}
// el comentario, oración por oración: {es, en, free}. free = tiene texto que escribió el agente (en el CRM va traducido)
function profParts(p){
  if(!p)return [];
  const cl=s=>String(s||'').trim().replace(/\s*[.;,]+$/,''),P=[],add=(es,en,free)=>P.push({es,en,free:!!free});
  const lc=s=>{s=cl(s);return /^[A-ZÁÉÍÓÚÑ][a-záéíóúñü]/.test(s)?s[0].toLowerCase()+s.slice(1):s}; // "Comerciante" → "comerciante" en medio de la oración
  const es1=p.edad!=null?`Cliente de ${p.edad} años`:'Cliente',en1=p.edad!=null?`${p.edad}-year-old client`:'Client';
  let oes='',oen='';
  if(p.desocupado){oes='actualmente desocupado'+(p.desocupado_desde?` desde hace ${cl(p.desocupado_desde)}`:'')+(p.ocupacion?` (anteriormente se desempeñaba como ${lc(p.ocupacion)})`:'');
    oen='currently unemployed'+(p.desocupado_desde?` for ${cl(p.desocupado_desde)}`:'')+(p.ocupacion?` (previously worked as ${cl(p.ocupacion)})`:'')}
  else if(p.ocupacion){oes=`se desempeña como ${lc(p.ocupacion)}`;oen=`works as ${cl(p.ocupacion)}`}
  add(es1+(oes?`, ${oes}.`:'.'),en1+(oen?`, ${oen}.`:'.'),p.ocupacion||(p.desocupado&&p.desocupado_desde));
  if(p.objetivo)add(`Manifiesta que su objetivo es ${lc(p.objetivo)}.`,`States that their goal is ${cl(p.objetivo)}.`,1);
  if(p.anuncio)add(`Se contactó a través del anuncio de ${lc(p.anuncio)}`+(p.vio_min===true?', en el cual vio el monto mínimo de inversión.':p.vio_min===false?', aunque no llegó a ver el monto mínimo de inversión.':'.'),
    `Reached through the ${cl(p.anuncio)} ad`+(p.vio_min===true?', where they saw the minimum investment amount.':p.vio_min===false?', although they did not see the minimum investment amount.':'.'),1);
  else if(p.vio_min===true)add('Tiene presente el monto mínimo de inversión del anuncio.','They are aware of the minimum investment amount from the ad.');
  else if(p.vio_min===false)add('No llegó a ver el monto mínimo de inversión del anuncio.','They did not see the minimum investment amount from the ad.');
  const o=p.outcome&&PROF_OUT[p.outcome];if(o)add(o.es,o.en);
  if(p.motivo)add(`Detalle: ${cl(p.motivo)}.`,`Note: ${cl(p.motivo)}.`,1);
  return P;
}
function profText(p,lang){return profParts(p).map(x=>x[lang==='en'?'en':'es']).join(' ')}
// lo que se pega en el CRM: inglés arriba, español debajo. Sin traductor, lo escrito por el agente queda en español
function profCrm(p){const en=profText(p,'en'),es=profText(p,'es');return en&&es?`${en}\n\n${es}`:(en||es)}
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
// lo que va al CRM con lo escrito por el agente traducido (la oración entera, así queda natural). ok=false: no se pudo traducir
async function profCrmEn(p){
  const P=profParts(p);if(!P.length)return {txt:'',ok:true};
  let ok=true;const en=[],tr=P.some(x=>x.free&&!trCache.has(x.es))?await tmo(trOpen(),2500):null; // se espera una sola vez
  for(const x of P){if(!x.free){en.push(x.en);continue}const t=await trEn(x.es,tr);if(t)en.push(t);else{ok=false;en.push(x.en)}}
  return {txt:`${en.join(' ')}\n\n${P.map(x=>x.es).join(' ')}`,ok};
}
async function profCopyCrm(p){ // copia lo que va al CRM; true si copió
  const r=await profCrmEn(p);if(!r.txt)return false;
  try{await navigator.clipboard.writeText(r.txt)}catch(e){return false}
  if(!r.ok)toast(esc(trWhy()),'warn',{ms:9000,key:'tr'});
  return true;
}
function fiProfHTML(d){
  const p=d.prof,falta=profFalta(p),done=!falta.length,txt=profText(p,'es'),st=profStatus(p);
  return `<div class="fi-c fi-prof${done?'':' fp-falta'}"><h4>Perfil del cliente ${done?'<span class="badge paid">completo</span>':'<span class="badge warn">faltan datos</span>'}</h4>
    ${p&&txt?`<div class="fi-ptext">${esc(txt)}</div>`:'<p class="p-sub" style="margin:0 0 6px">La gerencia pide siempre edad, ocupación y objetivo. Cargalos para que la mesa y el CRM los tengan.</p>'}
    ${st?`<p class="fi-pst">Status sugerido en el CRM: <b>${esc(st)}</b></p>`:''}
    ${!done?`<p class="fi-pfalta">Faltan: ${esc(falta.join(', '))}</p>`:''}
    <div class="fi-prow"><button type="button" class="btn sm pri" data-fa="profEdit">${p?'Editar perfil':'Completar perfil'}</button>${p&&txt?'<button type="button" class="btn sm" data-fa="profCopy">Copiar al CRM (inglés + español)</button>':''}${p&&p.updated_by?`<span class="p-sub">${esc(first(p.updated_by))} · ${esc(rel(new Date(p.updated_at)))}</span>`:''}</div></div>`;
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
    if(a==='profEdit')return profModal(d,rerender);
    if(a==='profCopy'){trOpen();if(!d.prof)return;if(await profCopyCrm(d.prof))toast('Copiado en inglés, con el español debajo. Pegalo en el comentario del CRM.');else toast('No pude copiar. Copialo a mano.','warn');return}
    if(a==='comAdd'){const t=root.querySelector('[data-fcom]'),body=t.value.trim();if(!body)return t.focus();b.disabled=true;
      try{await Q(sb.from('client_comments').insert({client_id:String(d.id),brand:d.r&&d.r.brand||DEF_BRAND,body:body.slice(0,1000)}));t.value='';await rerender(true)}catch(err){toast(esc(errMsg(err)),'err')}finally{b.disabled=false}return}
    if(a==='comDel'){if(!await confirmar('Borrar comentario','¿Borrar este comentario?','borrar',true))return;try{await Q(sb.from('client_comments').delete().eq('id',b.dataset.id));await rerender(true)}catch(err){toast(esc(errMsg(err)),'err')}return}
  });
}
const closeAllModals=()=>modals.slice().forEach(m=>m.close());
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
// el armador del perfil: los campos que pide la gerencia. Al guardar arma el comentario estándar para pegar en el CRM.
function profModal(d,rerender){
  const p=d.prof||{},chk=v=>v?'checked':'';
  // lo que hay en el formulario, con la forma de un perfil guardado (para la vista previa y para guardar)
  const read=api=>{const e=api.q('#pfE').value.trim();return {edad:e===''?null:+e,ocupacion:api.q('#pfO').value.trim(),desocupado:api.q('#pfD').checked,desocupado_desde:api.q('#pfDd').value.trim(),objetivo:api.q('#pfG').value.trim(),anuncio:api.q('#pfA').value.trim(),vio_min:api.q('#pfM').checked?true:null,outcome:api.q('#pfR').value||null,motivo:api.q('#pfMo').value.trim()}};
  const save=async(api,copy)=>{
    const x=read(api);
    if(x.edad!=null&&(!Number.isFinite(x.edad)||x.edad<16||x.edad>110)){api.q('#pfErr').textContent='La edad tiene que estar entre 16 y 110.';return false}
    try{await Q(sb.rpc('prof_save',{p_client:String(d.id),p_brand:d.r&&d.r.brand||DEF_BRAND,p_data:{...x,edad:x.edad==null?'':String(x.edad)}}))}catch(e){api.q('#pfErr').textContent=errMsg(e);return false}
    await rerender(true); // primero se ve guardado; después se copia (traducir puede tardar un poco)
    if(copy){if(await profCopyCrm(x))toast('Perfil guardado y copiado. Pegalo en el comentario del CRM.');else toast('Perfil guardado. No pude copiar: usá "Copiar al CRM" en la ficha.','warn')}
    else toast('Perfil guardado.');
  };
  modal({wide:true,title:`Perfil · ${esc(d.name||d.id)}`,body:`<p class="mp">Lo que la gerencia pide de cada cliente. Lo ve toda la mesa.</p>
    <div class="pf-grid"><div>
      <div class="fgrid">
        <label class="fld"><span>Edad <i>*</i></span><input id="pfE" type="number" min="16" max="110" value="${esc(p.edad!=null?p.edad:'')}" placeholder="Ej.: 34" autofocus></label>
        <label class="fld"><span>Ocupación <i>*</i></span><input id="pfO" maxlength="120" value="${esc(p.ocupacion||'')}" placeholder="Ej.: taxista, comerciante…"></label>
      </div>
      <label class="fck"><input type="checkbox" id="pfD" ${chk(p.desocupado)}> Está desocupado</label>
      <label class="fld" id="pfDwrap" style="${p.desocupado?'':'display:none'}"><span>¿Hace cuánto?</span><input id="pfDd" maxlength="60" value="${esc(p.desocupado_desde||'')}" placeholder="Ej.: 6 meses"></label>
      <label class="fld"><span>Objetivo del cliente <i>*</i></span><input id="pfG" maxlength="200" value="${esc(p.objetivo||'')}" placeholder="Ej.: conseguir un ingreso extra"></label>
      <label class="fld"><span>¿Qué vio en el anuncio?</span><input id="pfA" maxlength="300" value="${esc(p.anuncio||'')}" placeholder="Ej.: inversión con IA"></label>
      <label class="fck"><input type="checkbox" id="pfM" ${chk(p.vio_min===true)}> Vio el monto mínimo</label>
      <label class="fld"><span>¿Cómo terminó la llamada?</span><select id="pfR"><option value="">Elegí cómo terminó…</option>${PROF_ORDER.map(k=>`<option value="${k}" ${p.outcome===k?'selected':''}>${esc(PROF_OUT[k].l)}</option>`).join('')}</select></label>
      <p class="pf-st" id="pfSt"></p>
      <label class="fld"><span>Detalle <small class="dim">(opcional)</small></span><textarea id="pfMo" rows="2" maxlength="400" placeholder="Ej.: quiere consultarlo con la esposa / se le ofreció efectivo y transferencia">${esc(p.motivo||'')}</textarea></label>
    </div>
    <div class="pf-prev"><span class="p-sub">Así queda en Vitalis</span><div id="pfPrev" class="pf-txt"></div>
      <details><summary>Ver lo que va al CRM (inglés + español)</summary><div id="pfPrevEn" class="pf-txt en"></div><p class="p-sub" id="pfTr" style="margin:4px 0 0"></p></details></div></div>
    <div class="ebox" id="pfErr"></div>`,
    onOpen:api=>{
      const draw=()=>{const x=read(api),o=x.outcome&&PROF_OUT[x.outcome],st=profStatus(x),es=profText(x,'es');
        api.q('#pfDwrap').style.display=x.desocupado?'':'none';
        api.q('#pfSt').innerHTML=st?`Status sugerido en el CRM: <b>${esc(st)}</b>`:o?'':'<span class="dim">Al elegir cómo terminó, te digo qué status poner en el CRM.</span>';
        api.q('#pfPrev').textContent=es&&(x.edad!=null||x.ocupacion||x.desocupado||x.objetivo||x.anuncio||x.outcome||x.motivo)?es:'Completá los datos y acá vas viendo el comentario.';
        api.q('#pfPrevEn').textContent=profCrm(x);clearTimeout(api._tr);api._tr=setTimeout(async()=>{ // y con lo escrito ya traducido
          const r=await profCrmEn(x);if(!api.box.isConnected||JSON.stringify(read(api))!==JSON.stringify(x))return;
          api.q('#pfPrevEn').textContent=r.txt;api.q('#pfTr').textContent=r.ok?'':trWhy()},450)};
      trOpen(); // se abrió con un toque: si hace falta, Chrome baja el traductor ahora
      api.mb.addEventListener('input',draw);api.mb.addEventListener('change',draw);draw();
    },
    actions:[{l:'Cancelar'},{l:'Guardar',fn:api=>save(api,false)},{l:'Guardar y copiar al CRM',cls:'pri',fn:api=>save(api,true)}]});
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
  cuHist=[{id,name:curCl.name},...cuHist.filter(h=>h.id!==id)].slice(0,6);local.set('cuHist',cuHist);cliBadge();
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
    <form class="cu-find" data-cu="find"><input name="q" type="search" inputmode="numeric" placeholder="Abrir por ID" aria-label="Abrir un cliente por ID" autocomplete="off"></form>
    ${curCl?`<button type="button" class="btn sm" data-cu="copy">Copiar ID</button><button type="button" class="btn sm" data-cu="ag">Agendar</button><button type="button" class="ib" data-cu="re" title="Actualizar" aria-label="Actualizar">↻</button>`:''}</div>
    ${h.length?`<div class="cu-rec"><span class="p-sub">Recientes</span>${h.map(x=>`<button type="button" class="chip" data-cu="rec" data-id="${esc(x.id)}"><b>${esc(x.id)}</b>${x.name?' '+esc(clip(x.name,22)):''}</button>`).join('')}</div>`:''}`;
}
async function cuRender(force){
  const top=$('#cuTop'),body=$('#cuBody');if(!top||!ready)return;
  if(!top.contains(document.activeElement)||force)top.innerHTML=cuTopHTML(); // sin pisar el ID que estás escribiendo
  if(!curCl){delete body.dataset.fid;body.innerHTML=`<div class="cu-empty"><svg><use href="#i-cliente"/></svg><h2>Abrí un cliente en el CRM</h2><p>Aparece acá con el perfil, cómo hacerlo depositar, las campañas de su afiliador y los comentarios. Cuando entra un new, también.</p></div>`;return}
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
  if(d.name&&!curCl.name){curCl.name=d.name;local.set('curCl',curCl);cuHist=cuHist.map(h=>h.id===id?{id,name:d.name}:h);local.set('cuHist',cuHist);top.innerHTML=cuTopHTML()}
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
      if(a==='ag'){const x=getD();agendarCliente(curCl.id,x&&x.r&&x.r.status||'')}});
  },
  render(o){cuRender(!!o.force)}
};
// en vivo: comentarios y campañas del cliente que tenés abierto
function fichaLive(){if(!curCl)return;fichaCache.delete(curCl.id);if(cur==='cliente')cuRender(true)}
const ficFetch=()=>QN(sb.from('client_comments').select('id').limit(1)).then(r=>!!r);
async function ficInit(){ficOk=await ficFetch()}

/* ---------- cuando entra un new ---------- */
function fichaNew(id){if(id)setCurrent(id,'','new')}
