/* ---------- la extensión en el CRM: la mini ficha ----------
   Vitalis le pasa a la extensión lo justo para trabajar sin salir del CRM (no se escribe nada en el CRM):
   el cliente actual en corto (status, palabra clave, agenda, comentarios de la mesa, cómo depositar),
   el siguiente new y el turno (baño, 10 y 30 min). El comentario se escribe allá y se copia en inglés.
   Con Vitalis tapado solo dice que está tapado. El team leader no la tiene (no gestiona clientes). */
let dockSig='',dockAt=0,dockT=null,dockRun=false,dockAgain=false;
const PF_KEYS=['edad','ocupacion','desocupado','desocupado_desde','objetivo','anuncio','vio_min','outcome','motivo'];
const dockSoon=()=>{clearTimeout(dockT);dockT=setTimeout(()=>dockSync(),350)};
function dockCl(d){
  const id=String(d.id),r=crmStatusOf(id)||d.r,f=soldOf(id,r&&r.brand),pais=PAISES.includes(d.pais)?d.pais:'';
  const ags=[...pend,...teamAg].filter(p=>norm(p.id)===norm(id)&&!p.done).sort(byDue).map(p=>whenTxt(parseDue(p.due)));
  const opt=o=>({m:o.m.name,p:procName(o.p),n:clip(o.m.note||'',160)});
  const pay=pais&&bk.ok?{pais,k:Object.fromEntries(['efectivo','transferencia','tarjeta'].map(k=>{const L=bkOptions(pais,k);
    return [k,{ok:L.filter(o=>!o.falla).slice(0,12).map(opt),bad:L.filter(o=>o.falla).slice(0,8).map(o=>o.m.name+' · '+procName(o.p))}]}))}:null;
  const aff=String((r&&r.aff)||d.aff||'').trim(),camp=String((r&&r.camp)||d.camp||'').trim();
  return {id,name:d.name||'',pais:d.pais||d.country||'',country:d.pais||d.country||'',hora:cliTime(d.country)||'',aff,camp,camps:dockCamps(aff,camp,d.pais||d.country||''),
    st:r?(sgPlain(r)||r.status||''):'',crm:r&&r.status||'',
    stop:(f||(r&&paidCrm(r)))?'paid':'',
    paid:f?`Depositó ${f.date===todayS()?'hoy':dm(f.date)}`:r&&paidCrm(r)?'Tiene FTD en el CRM':'',
    kw:clientKw(id)||'',ag:ags.slice(0,2),
    coms:(d.coms||[]).slice(0,3).map(c=>({w:first(c.created_by),t:rel(new Date(c.created_at)),x:clip(c.body,220)})),pay};
}
// el tablero del ícono de la extensión (lo mismo que tenía la extensión de prueba, lo pidió el dueño el 27/11/2026): el team leader ve a todos los
// que están en New (con agente y hace cuánto, sin gestionar en rojo) y en Talking, y hoy por agente; el agente ve sus news en New y sus números.
// El team leader además recibe una tarjeta urgente por cada New sin gestionar a los 5 min (`wait`, ya descuenta al agente que tiene otro en Talking).
function dockBoard(){
  if(!crm.ok)return null;
  const now=Date.now(),te=todayS(),mins=a=>a?Math.max(0,Math.round((now-a)/6e4)):0;
  try{
    if(isLeader()){const D=cmData();
      return {tl:1,news:D.cur.map(x=>({id:String(x.r.id),agent:x.u?first(x.u):'',talking:!!x.talk,wait:!!x.wait,min:x.talk?mins(x.r.since?Date.parse(x.r.since):0):mins(x.a),country:paisOf(x.r.country||'')||''})),
        agents:D.rows.map(p=>({name:p.m.name,news:p.hoy,inNew:p.newN,talk:p.talk,calls:p.pc.n,med:p.sp.n?p.sp.med:null,slow:p.sp.slow||0}))}}
    const mine=newsOf(me).filter(inNew).map(r=>({id:String(r.id),country:paisOf(r.country||'')||'',min:mins(assignedAt(r)||+regAt(r)||0)})).sort((a,b)=>b.min-a.min);
    const P=dayPool(me),sp=newSpeedOf(me,te,te);
    return {news:mine,stats:{news:P.total,done:P.done,calls:P.n,med:sp.n?sp.med:null}};
  }catch(e){return null}
}
// la campaña del cliente para la mini ficha: la suya (con mínimo y anuncio de `campaign_info`) y las otras de su afiliador en su país; cache de 2 min por afiliador · país
const dkCamps=new Map();
function dockCamps(aff,camp,pais){
  if(!aff||ficOk===false)return camp?[{camp,mine:true,min:'',ad:''}]:[];
  const k=aff+'|'+pais,c=dkCamps.get(k);
  if(!c||Date.now()-c.at>12e4){dkCamps.set(k,{at:Date.now(),rows:c?c.rows:[]});Q(sb.from('campaign_info').select('*').eq('aff',aff).eq('country',pais)).then(rows=>{dkCamps.set(k,{at:Date.now(),rows:rows||[]});dockSoon()}).catch(()=>{})}
  const rows=(dkCamps.get(k)||{}).rows||[],mine=rows.find(i=>norm(i.camp)===norm(camp));
  return [...(camp?[{camp,mine:true,min:mine&&mine.min_amount||'',ad:mine&&mine.ad_text||''}]:[]),...rows.filter(i=>norm(i.camp)!==norm(camp)).map(i=>({camp:i.camp,mine:false,min:i.min_amount||'',ad:i.ad_text||''}))];
}
async function dockCampSet(r){ // "Guardar" en la mini ficha: el monto mínimo y el anuncio de esa afiliador · campaña · país
  const aff=String(r.aff||'').trim().slice(0,60),camp=String(r.camp||'').trim().slice(0,120),pais=String(r.country||'').trim().slice(0,60),min_amount=String(r.min||'').trim().slice(0,60)||null,ad_text=String(r.ad||'').trim().slice(0,2000)||null;
  if(!aff||!camp||!(min_amount||ad_text))return;
  try{const ex=await Q(sb.from('campaign_info').select('aff').eq('aff',aff).eq('camp',camp).eq('country',pais));
    if(ex&&ex.length)await Q(sb.from('campaign_info').update({min_amount,ad_text,updated_by:me,updated_at:new Date().toISOString()}).eq('aff',aff).eq('camp',camp).eq('country',pais));
    else await Q(sb.from('campaign_info').insert({aff,camp,country:pais,min_amount,ad_text}));
    dkCamps.delete(aff+'|'+pais);toast('Campaña guardada.');dockSoon()}
  catch(e){toast('No pude guardar la campaña: '+errMsg(e),'err')}
}
async function dockData(){
  if(isLeadUid(me))return {off:1,board:dockBoard()};
  if(locked)return {locked:1};
  const {t,b}=turnoState(),h=turnos[todayS()];
  const tu=!t?{st:h&&h.out?'out':'none'}:b?{st:'br',k:b.k||0,s:b.s}:{st:'in'};
  let next=[];if(crm.ok)try{next=newsOf(me).filter(inNew).slice(0,6).map(r=>({id:r.id,name:'',why:'En New: llamalo ya'}))}catch(e){}
  let cl=null;
  if(curCl&&curCl.id){
    const c=fichaCache.get(curCl.id),d=c?c.d:await fichaData(curCl.id).catch(()=>null);
    cl=d?dockCl(d):{id:String(curCl.id),name:curCl.name||''};
    if(!cl.name&&curCl.name)cl.name=curCl.name;
  }
  return {tu,next,cl,board:dockBoard()};
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
  if(d.cmd==='campset'&&d.r&&typeof d.r==='object'){dockCampSet(d.r);return}
}
// el comentario para el CRM: lo traduce el traductor de Chrome de esta pestaña (si en la del CRM no anda)
async function dockTr(txt){
  const s=String(txt||'').trim().slice(0,4000);if(!s)return {en:''};
  const t=await trOpen(),en=t?await trEn(s,t):null;
  return en?{en}:{why:trState==='bajando'?'bajando':'no'};
}
