/* ---------- la extensión en el CRM: la mini ficha ----------
   Vitalis le pasa a la extensión lo justo para trabajar sin salir del CRM (no se escribe nada en el CRM):
   el cliente actual en corto (status, palabra clave, agenda, el perfil para completar ahí mismo, comentarios de la mesa, cómo depositar),
   el siguiente de la Cola con su porqué y el turno (baño, 10 y 30 min). El comentario se escribe allá y se copia en inglés.
   Con Vitalis tapado solo dice que está tapado. El team leader no la tiene (no gestiona clientes). */
let dockSig='',dockAt=0,dockT=null,dockRun=false,dockAgain=false;
const PF_KEYS=['edad','ocupacion','desocupado','desocupado_desde','objetivo','anuncio','vio_min','outcome','motivo'];
const dockSoon=()=>{clearTimeout(dockT);dockT=setTimeout(()=>dockSync(),350)};
function dockCl(d){
  const id=String(d.id),r=crmStatusOf(id)||d.r,f=soldOf(id,r&&r.brand),pais=PAISES.includes(d.pais)?d.pais:'';
  const ags=[...pend,...teamAg].filter(p=>norm(p.id)===norm(id)&&!p.done).sort(byDue).map(p=>whenTxt(parseDue(p.due)));
  const opt=o=>({m:o.x.m.name,p:o.p.name,n:clip(o.x.note||'',160)});
  const pay=pais&&bk.ok?{pais,k:Object.fromEntries(['efectivo','transferencia','tarjeta'].map(k=>{const L=bkOptions(pais,k);
    return [k,{ok:L.filter(o=>!o.falla).slice(0,12).map(opt),bad:L.filter(o=>o.falla).slice(0,8).map(o=>o.x.m.name+' · '+o.p.name)}]}))}:null;
  return {id,name:d.name||'',pais:d.pais||d.country||'',hora:cliTime(d.country)||'',
    st:r?(sgPlain(r)||r.status||''):'',crm:r&&r.status||'',
    stop:r&&r.grp==='dnc'?'dnc':(f||(r&&paidCrm(r)))?'paid':'',
    paid:f?`Depositó ${f.date===todayS()?'hoy':dm(f.date)}`:r&&paidCrm(r)?'Tiene FTD en el CRM':'',
    kw:clientKw(id)||'',ag:ags.slice(0,2),falta:profFalta(d.prof),
    prof:d.prof?Object.fromEntries(PF_KEYS.map(k=>[k,d.prof[k]??null])):null,po:PROF_ORDER.map(k=>[k,PROF_OUT[k].l,profStatus({outcome:k})]),
    coms:(d.coms||[]).slice(0,3).map(c=>({w:first(c.created_by),t:rel(new Date(c.created_at)),x:clip(c.body,220)})),pay};
}
async function dockData(){
  if(isLeadUid(me))return {off:1};
  if(locked)return {locked:1};
  const {t,b}=turnoState(),h=turnos[todayS()];
  const tu=!t?{st:h&&h.out?'out':'none'}:b?{st:'br',k:b.k||0,s:b.s}:{st:'in'};
  let next=[];if(crm.ok)try{next=colaNext(queueOf(me),6)}catch(e){}
  let cl=null;
  if(curCl&&curCl.id){
    const c=fichaCache.get(curCl.id),d=c?c.d:await fichaData(curCl.id).catch(()=>null);
    cl=d?dockCl(d):{id:String(curCl.id),name:curCl.name||''};
    if(!cl.name&&curCl.name)cl.name=curCl.name;
  }
  return {tu,next,cl};
}
async function dockSync(beat){
  if(!ready||!profile||!extOk)return; // sin extensión no hay a quién mandarle
  if(dockRun){dockAgain=true;return}
  dockRun=true;
  try{
    const d=await dockData(),sig=JSON.stringify(d);
    if(sig!==dockSig||(beat&&Date.now()-dockAt>45e3)){dockSig=sig;dockAt=Date.now();postTop({type:'ftd-agenda-dock',v:1,d})}
  }catch(e){}
  finally{dockRun=false;if(dockAgain){dockAgain=false;dockSoon()}}
}
// lo que pide la mini ficha: marcar el turno o ver la ficha en Vitalis
function dockCmd(d){
  if(!ready)return;
  if(d.cmd==='turno'){const k=String(d.k||'');if(['bano','d10','d30','vuelta'].includes(k))marcar(k);return}
  if(d.cmd==='ir'&&d.k==='cliente'){go('cliente');return}
}
// el perfil completado en la mini ficha: lo guarda Vitalis (prof_save, como en la ficha) y devuelve sus oraciones para copiarlo en inglés
async function dockProf(m){
  if(!ready||!profile)return {err:'Vitalis está arrancando: probá de nuevo en un momento.'};
  if(locked)return {err:'Vitalis está tapado: poné tu PIN en Vitalis.'};
  if(isLeadUid(me))return {err:'El team leader no gestiona clientes.'};
  const id=String(m&&m.id||'').trim().slice(0,60),p=m&&m.p||{};if(!id)return {err:'No hay cliente.'};
  const s=(v,n)=>String(v??'').trim().slice(0,n),e=p.edad==null||p.edad===''?null:Math.round(+p.edad);
  if(e!=null&&(!Number.isFinite(e)||e<16||e>110))return {err:'La edad tiene que estar entre 16 y 110.'};
  const x={edad:e,ocupacion:s(p.ocupacion,120),desocupado:!!p.desocupado,desocupado_desde:s(p.desocupado_desde,60),objetivo:s(p.objetivo,200),anuncio:s(p.anuncio,300),
    vio_min:p.vio_min===true?true:p.vio_min===false?false:null,outcome:PROF_OUT[p.outcome]?p.outcome:null,motivo:s(p.motivo,400)};
  const c=fichaCache.get(id),r=c&&c.d.r||crmStatusOf(id);
  try{await Q(sb.rpc('prof_save',{p_client:id,p_brand:r&&r.brand||DEF_BRAND,p_data:{...x,edad:x.edad==null?'':String(x.edad)}}))}catch(err){return {err:errMsg(err)}}
  if(c)c.d.prof={...(c.d.prof||{}),...x,updated_by:me,updated_at:new Date().toISOString()};
  if(cur==='cliente'&&curCl&&curCl.id===id)cuRender(true);
  dockSoon();
  return {ok:1,parts:profParts(x)};
}
// el comentario para el CRM: lo traduce el traductor de Chrome de esta pestaña (si en la del CRM no anda)
async function dockTr(txt){
  const s=String(txt||'').trim().slice(0,4000);if(!s)return {en:''};
  const t=await trOpen(),en=t?await trEn(s,t):null;
  return en?{en}:{why:trState==='bajando'?'bajando':'no'};
}
