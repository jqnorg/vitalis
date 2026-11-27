/* ---------- la ficha del cliente y el "cliente actual" ----------
   El cliente actual es el que tenés abierto en el CRM (la extensión lo manda) o el último new que entró: alimenta la mini ficha del CRM.
   La sección Cliente se fue el 26/11/2026 (lo decidió el dueño); quedan los datos (fichaData) y los editores de campaña. */
let curCl=local.get('curCl',null),ficOk=null;
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
const closeAllModals=()=>modals.slice().forEach(m=>m.close());
async function setClientKw(id,brand,kw){
  const r=await Q(sb.rpc('client_kw_set',{p_client:String(id),p_brand:brand||clientBrand(id),p_kw:kw||''}));
  const k=norm(id);if(r&&r.kw)ckw[k]={kw:r.kw,brand:brand||clientBrand(id)};else delete ckw[k];
  return r;
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
    const fresh=l.filter(q=>+new Date(q.created_at)>reqSeen&&q.created_by!==me);campReqs=l;if(cur==='cmbandeja')refresh();
    if(l.length)reqSeen=Math.max(reqSeen,...l.map(q=>+new Date(q.created_at)));local.set('reqSeen',reqSeen);
    if(!quiet)for(const q of fresh.slice(0,3))toast(`✏️ <b>${esc(first(q.created_by))}</b> pidió un cambio en la campaña <b>${esc(q.camp)}</b>: ${esc(clip(q.body,140))}`,'imp',{key:'cr'+q.id,ms:15000});
  }catch(e){}
}

/* ---------- el cliente actual (sin sección Cliente desde el 26/11/2026: el dueño sacó la ficha; el depósito y la campaña viven en la mini ficha del CRM) ---------- */
// desde cualquier lista: tocar el ID lo copia
async function openFicha(id){id=String(id||'').trim();if(!id)return;try{await navigator.clipboard.writeText(id);toast(`<b>${esc(id)}</b> copiado.`,'ok')}catch(e){toast(`ID <b>${esc(id)}</b>`,'info')}}
function setCurrent(id,name,src){ // el cliente que tenés abierto en el CRM o el último new: para la mini ficha
  id=String(id||'').trim();if(!id)return;
  const same=curCl&&curCl.id===id;
  curCl={id,name:name||(same&&curCl.name)||'',src,at:Date.now()};local.set('curCl',curCl);cliBadge();dockSoon();
  if(src==='new'&&!same&&ready&&!isLeadUid(me))toast(`Entró un new: <b>${esc(id)}</b>. Llamalo ya.`,'imp',{sticky:1,key:'ficha',actions:[{l:'Copiar ID',fn:()=>openFicha(id)}]});
}
// en vivo: comentarios y campañas del cliente que tenés abierto
function fichaLive(){if(!curCl)return;fichaCache.delete(curCl.id);dockSoon()}
const ficFetch=()=>QN(sb.from('client_comments').select('id').limit(1)).then(r=>!!r);
async function ficInit(){ficOk=await ficFetch()}

/* ---------- cuando entra un new ---------- */
function fichaNew(id){if(id)setCurrent(id,'','new')}
