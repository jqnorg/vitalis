/* ============================================================
   Clientes del CRM: todos los que se ven, con su status (crm_clients).
   La cola "Ahora" en el orden de la mesa: 1 new, 2 agendas, 3 Call Again · Hang Up · NA
   (hasta el tope, todos; si hay más, solo los registrados en el mes). Nunca Do Not Call ni depositados.
   La ficha del cliente (se abre sola cuando entrás a Vitalis después del aviso de un new),
   la conversión por día de registro, el panel de la cola para el team leader y la calidad de datos.
   ============================================================ */
const ARCH='Trade24Seven',isArch=b=>norm(b)===norm(ARCH); // la marca que quedó como archivo
const GRPS={new:'New (y Talking)',na:'No Answer y NA',callback:'CallBack (con cita)',call_again:'Call Again',hang_up:'Hang Up',low_potential:'Low potential',not_interested:'Not interested',
  pending:'Pending Payment (boleto)',failed:'Depósito trabado (Failed, Bank Block, Declined)',ftd:'FTD',dnc:'Do Not Call',invalid:'Inválido (número, idioma)',crm:'Del CRM (Reassign, Test, FAKE…)',otro:'Otro'};
const G3=['call_again','hang_up','na'],G2=['callback','pending'],DAYS5=['callback','call_again','hang_up','low_potential']; // con cita · los de 5 días seguidos y al 5º pasan a Not interested
let crm={ok:null,rows:new Map(),byId:new Map(),at:0,busy:null,rot:[]};
const ckey=(b,id)=>norm(b||DEF_BRAND)+'|'+norm(id);
// un Talking que desapareció de la lista que se actualiza ya no es new (su status nuevo llega cuando se lo vea)
const gone=r=>!!r.left_new_at&&r.status_group==='new';
const C2X=r=>({brand:r.brand,id:r.client_id,name:r.name||'',country:r.country||'',reg:r.reg||'',status:gone(r)?'Salió de Talking':r.status||'',grp:gone(r)?'gone':r.status_group||'otro',agent:r.crm_agent||'',
  camp:r.camp||'',aff:r.aff||'',call:r.last_call||'',note:r.note||'',ftd:r.ftd_at||'',desk:r.desk||'',firstAgent:r.first_agent||'',first:r.first_seen,firstBy:r.first_seen_by,last:r.last_seen,since:r.status_since});
const crmAll=()=>[...crm.rows.values()];
const regDay=r=>r.reg?r.reg.slice(0,10):(r.first?ymd(new Date(r.first)):'');
const callAt=r=>r.call?parseDue(r.call.slice(0,10)+'T'+r.call.slice(11,16)):null; // "Last Communication Time" del CRM
const regAt=r=>r.reg?(r.reg.length>10?parseDue(r.reg.slice(0,10)+'T'+r.reg.slice(11,16)):parseYMD(r.reg)):(r.first?new Date(r.first):null);
// el team leader no tiene clientes: no llama ni gestiona; su pool es el de toda la mesa
const notLead=u=>u&&!isLeadUid(u)?u:null;
function crmOwner(r){if(r.agent)return notLead(agentUid(r.agent));return notLead(r.firstBy)} // el agente del CRM; si no hay columna, quien lo vio primero
// la conversión del new es del primero que lo llamó (si lo rotaron antes de llamarlo, del que lo llamó); sin llamar todavía, del agente actual
function convOwner(r){if(r.firstAgent)return notLead(agentUid(r.firstAgent));return crmOwner(r)}
// de quién es un cliente del registro de new: el del CRM si se lo vio; si no, quien lo anotó (nunca el team leader)
function leadOwner(l){const r=crmStatusOf(l.id);if(r&&(r.agent||r.firstAgent))return convOwner(r);return notLead(l.uid)}
const soldIdx=perPass(()=>{const m=new Map();for(const f of [...team].sort(byDate)){const k=ckey(f.brand,f.id);if(!m.has(k))m.set(k,f)}return m}); // la primera venta de cada cliente
function soldOf(id,brand){const k=norm(id);let best=null;for(const f of team)if(norm(f.id)===k&&(!brand||norm(f.brand)===norm(brand))&&(!best||byDate(f,best)<0))best=f;return best}
function crmStatusOf(id){let r=crm.rows.get(ckey(DEF_BRAND,id));if(r)return r;return crm.byId.get(norm(id))||null} // por ID, de cualquier marca menos el archivo
const isDnc=id=>{const r=crmStatusOf(id);return !!(r&&r.grp==='dnc')};
// horas desde el registro hasta el depósito (dato: a la empresa le importa new o late, pero se muestra)
function regHrs(f){const r=String(f.reg||'');if(r.length<16||!/^\d{1,2}:\d{2}/.test(f.time||''))return null;
  const h=(parseDue(f.date+'T'+f.time.padStart(5,'0'))-parseDue(r.slice(0,10)+'T'+r.slice(11,16)))/36e5;return h>=0?h:null}
function demora(f){const h=regHrs(f);if(h==null)return isLate(f)?plural(lateDays(f),'día'):'';return h<1?Math.max(1,Math.round(h*60))+' min':h<48?nf(h,1)+' h':plural(Math.round(h/24),'día')}
const TZ={chile:'America/Santiago',colombia:'America/Bogota',mexico:'America/Mexico_City',peru:'America/Lima','costa rica':'America/Costa_Rica',guatemala:'America/Guatemala',
  panama:'America/Panama',ecuador:'America/Guayaquil',argentina:'America/Argentina/Buenos_Aires',uruguay:'America/Montevideo',paraguay:'America/Asuncion',bolivia:'America/La_Paz',
  venezuela:'America/Caracas',brazil:'America/Sao_Paulo',brasil:'America/Sao_Paulo','el salvador':'America/El_Salvador',honduras:'America/Tegucigalpa',nicaragua:'America/Managua',
  'republica dominicana':'America/Santo_Domingo','dominican republic':'America/Santo_Domingo',spain:'Europe/Madrid','espana':'Europe/Madrid'};
const tzFmt=new Map();
function cliTime(country){const tz=TZ[norm(country).trim()];if(!tz)return '';try{let f=tzFmt.get(tz);if(!f)tzFmt.set(tz,f=new Intl.DateTimeFormat('es-UY',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:tz}));return f.format(new Date())}catch(e){return ''}}
const stBadge=r=>`<span class="badge st st-${esc(r.grp)}" title="${esc(GRPS[r.grp]||'')}">${esc(r.status||GRPS[r.grp]||'—')}</span>`;

/* ---------- carga: lo que está en la cola, lo registrado este mes y la semana, y los de la agenda ---------- */
async function crmPage(build,max=20000){const out=[];for(let i=0;i<max;i+=1000){const rows=await Q(build().range(i,i+999));out.push(...rows);if(rows.length<1000)break}return out}
async function crmLoad(force){
  if(!ready||!sb)return;
  if(crm.busy)return crm.busy;
  if(!force&&Date.now()-crm.at<20e3)return;
  crm.busy=(async()=>{
    try{
      const te=todayS(),from=[te.slice(0,8)+'01',weekStart(te)].sort()[0],fromTs=parseYMD(from).toISOString();
      const base=()=>sb.from('crm_clients').select('*').neq('brand',ARCH);
      const ids=[...new Set([...pend,...teamAg].filter(p=>!p.done).map(p=>String(p.id)))].slice(0,300);
      // todo junto: la cola, los registrados del mes y la semana, los de la agenda y (team leader) las rotaciones de hoy
      const [act,coh,cohS,ag,rot]=await Promise.all([
        crmPage(()=>base().in('status_group',['new','na','callback','call_again','hang_up','low_potential','pending','failed']).order('client_id')),
        crmPage(()=>base().gte('reg',from).order('client_id')),
        crmPage(()=>base().gte('first_seen',fromTs).order('client_id')),
        ids.length?Q(base().in('client_id',ids)):Promise.resolve([]),
        QO(sb.from('crm_agent_log').select('client_id,brand,old_agent,new_agent,status,seen_at').gte('seen_at',parseYMD(te).toISOString()).order('seen_at').limit(2000)), // las rotaciones de hoy (el team leader las ve en Equipo; el cielo saca de tu meta a los que te rotaron ya llamados)
      ]);
      const rows=[...act,...coh,...cohS,...ag];crmApply(rows,rot);snapCrm(rows,rot);
    }catch(e){if(/crm_clients|PGRST205|42P01|does not exist/.test(String(e&&(e.message||e.code))))crm.ok=false}
    finally{crm.busy=null}
  })();
  return crm.busy;
}
function crmApply(rows,rot){
  const m=new Map();for(const r of rows){const x=C2X(r);m.set(ckey(x.brand,x.id),x)}
  const by=new Map();for(const x of m.values())if(!isArch(x.brand)&&!by.has(norm(x.id)))by.set(norm(x.id),x);
  const was=crm.ok;crm.rows=m;crm.byId=by;crm.rot=rot||[];crm.ok=true;crm.at=Date.now();
  if(ready&&(!was||['ahora','inicio','clientes','equipo','agenda','cliente'].includes(cur)))refresh();
}
let crmT=null;const crmSoon=()=>{clearTimeout(crmT);crmT=setTimeout(()=>crmLoad(true),2500)};
async function crmOne(id){const r=await Q(sb.from('crm_clients').select('*').eq('client_id',String(id)).limit(5));const x=r.map(C2X);return x.find(c=>!isArch(c.brand))||x[0]||null}
async function crmLog(id){ // status y rotaciones, en orden
  const [a,b]=await Promise.all([QO(sb.from('crm_status_log').select('*').eq('client_id',String(id)).order('seen_at',{ascending:true}).limit(60)),
    QO(sb.from('crm_agent_log').select('*').eq('client_id',String(id)).order('seen_at',{ascending:true}).limit(30)).catch(()=>[])]);
  return [...a,...b].filter(r=>!isArch(r.brand)).sort((x,y)=>new Date(x.seen_at)-new Date(y.seen_at));
}

// lo que mandó la extensión: todos los clientes vistos en el CRM
async function crmSeenFromExt(rows){
  if(!ready||readOnly)return {err:'Vitalis todavía está cargando'};
  // las llamadas (toques en Omega, Gizat, Voiso) van aparte
  const callR=rows.slice(0,500).filter(r=>r&&r.ln);
  if(callR.length){try{await callsFromExt(callR)}catch(e){return {err:/calls_add|PGRST202|42883/.test(String(e&&(e.message||e.code)))?'falta actualizar la base':errMsg(e)}}}
  if(callR.length===rows.slice(0,500).length)return {keys:callR.map(r=>String(r.k||''))};
  if(crm.ok===false&&Date.now()-crm.at<5*6e4)return {err:'falta actualizar la base'};
  const s=v=>String(v??'').replace(/\s+/g,' ').trim(),batch=rows.slice(0,500);
  const list=batch.filter(r=>r&&!r.ln&&s(r.id)).map(r=>({id:s(r.id).slice(0,60),brand:s(r.brand).slice(0,40),name:s(r.name).slice(0,120),country:s(r.country).slice(0,60),status:s(r.status).slice(0,60),
    reg:/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(r.reg||'')?r.reg:'',agent:s(r.agent).slice(0,80),camp:s(r.camp).slice(0,120),aff:s(r.aff).slice(0,60),
    call:/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.call||'')?r.call:'',note:s(r.note).slice(0,200),
    ftd:/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(r.ftd||'')?r.ftd:'',desk:s(r.desk).slice(0,80),...(r.gone?{gone:1}:{})}));
  const keys=batch.map(r=>String(r&&r.k||''));
  if(!list.length)return {keys};
  try{const res=await Q(sb.rpc('crm_seen',{rows:list}));crm.ok=true;crmSoon();return {keys,added:res&&res.new||0}}
  catch(e){const m=String(e&&(e.message||e.code));if(/crm_seen|PGRST202|42883|crm_clients|does not exist/.test(m)){crm.ok=false;crm.at=Date.now();return {err:'falta actualizar la base'}}return {err:errMsg(e)}}
}

/* ---------- la cola, en el orden de la mesa ---------- */
const naNum=s=>{const m=norm(s).match(/(?:^|[^a-z])na\D*([2-9])/);return m?+m[1]:1};
const NA_MAX=4; // los NA se llaman del día 1 al 4; el 5 queda para repasos
const paidCrm=r=>r.grp==='ftd'||!!r.ftd; // el CRM ya lo marca con FTD
// día del status para los de "5 días seguidos" (cuenta desde que Vitalis lo vio cambiar)
const statusDay=r=>{if(!DAYS5.includes(r.grp)||!r.since)return 0;return Math.max(1,Math.round((parseYMD(todayS())-parseYMD(ymd(new Date(r.since))))/864e5)+1)};
const dayTag=r=>{const n=statusDay(r);return n?` <span class="d${n>=5?' hot b':''}" title="Al 5º día seguido pasa a Not interested">día ${Math.min(n,5)}/5</span>`:''};
const g3rank=r=>r.grp==='call_again'?0:r.grp==='hang_up'?10:20+naNum(r.status);
const byRegDesc=(a,b)=>(regAt(b)||0)-(regAt(a)||0);
const qCap=()=>+(teamInfo&&teamInfo.queue_cap)||60;
function queueOf(uid){ // uid: me | null (toda la mesa) | otro
  const S=soldIdx(),te=todayS(),ym=te.slice(0,7),own=r=>uid==null||crmOwner(r)===uid;
  const mineAll=crmAll().filter(r=>!isArch(r.brand)&&own(r)),live=mineAll.filter(r=>!S.has(ckey(r.brand,r.id))&&!paidCrm(r));
  // dentro de cada grupo, primero los que no se llamaron hoy (los news: los que piden repaso)
  const hoyRank=r=>{const k=contactOf(r);return k.today?1:0},repRank=r=>{const k=contactOf(r);return !k.last||Date.now()-k.last>REPASO?0:1};
  const g1=live.filter(r=>r.grp==='new').sort((a,b)=>repRank(a)-repRank(b)||byRegDesc(a,b));
  const ags=uid===me?pend:uid==null?[...pend,...(isLeader()?teamAg:[])]:agOf(uid);
  const ag=ags.filter(p=>!p.done&&p.due.slice(0,10)<=te&&!soldOf(p.id)&&!isDnc(p.id)).sort(byDue);
  const agIds=new Set(ags.filter(p=>!p.done).map(p=>norm(p.id)));
  const cb=live.filter(r=>G2.includes(r.grp)&&!agIds.has(norm(r.id))).sort((a,b)=>hoyRank(a)-hoyRank(b)||(a.grp==='pending'?0:1)-(b.grp==='pending'?0:1)||byRegDesc(a,b)); // con cita en el CRM y sin agenda en Vitalis
  const rep=live.filter(r=>r.grp==='na'&&naNum(r.status)>NA_MAX).sort(byRegDesc);
  const all3=live.filter(r=>G3.includes(r.grp)&&!(r.grp==='na'&&naNum(r.status)>NA_MAX)),cap=qCap(),many=all3.length>cap;
  const g3=(many?all3.filter(r=>regDay(r).slice(0,7)===ym):all3).sort((a,b)=>hoyRank(a)-hoyRank(b)||g3rank(a)-g3rank(b)||byRegDesc(a,b));
  const cnt=g=>mineAll.filter(r=>r.grp===g).length;
  const low=live.filter(r=>r.grp==='low_potential').sort(byRegDesc);
  return {g1,ag,cb,g3,n3:all3.length,cap,many,rep,low,lowSin:low.filter(r=>!agIds.has(norm(r.id))).length,failed:live.filter(r=>r.grp==='failed').sort(byRegDesc),
    ni:cnt('not_interested'),dnc:cnt('dnc'),inv:cnt('invalid'),otro:cnt('otro')+cnt('crm')};
}
function ahRow(r,i,who){
  const ra=regAt(r),ca=callAt(r),tz=cliTime(r.country);
  return `<tr><td class="d">${i}</td><td><button type="button" class="lnkp" data-ah="ficha" data-id="${esc(r.id)}" title="Ver la ficha"><b>${esc(r.id)}</b></button> <span class="ah-nm">${esc(r.name)}</span></td><td>${stBadge(r)}${dayTag(r)}</td>
    <td class="d" title="${ca?esc(whenTxt(ca)):''}">${ca?esc(rel(ca)):'—'}${r.note?`<div class="ah-nt trunc" title="${esc(r.note)}">${esc(r.note)}</div>`:''}</td>
    <td class="d" title="${ra?esc(whenTxt(ra)):''}">${ra?esc(rel(ra)):''}</td><td>${esc(r.country)}${tz?` <span class="d" title="Hora del cliente">${tz}</span>`:''}</td><td class="trunc d" title="${esc(r.camp)}">${esc(r.camp)}</td>
    ${who?`<td class="trunc">${esc(crmOwner(r)?memberName(crmOwner(r)):r.agent||'—')}</td>`:''}<td class="act wr"><button type="button" class="ib" data-ah="ficha" data-id="${esc(r.id)}">Ficha</button><button type="button" class="ib" data-ah="ag" data-id="${esc(r.id)}" data-nm="${esc(r.status)}">Agendar</button></td></tr>`;
}
function ahTable(list,who,lim){
  if(!list.length)return '';
  return `<div class="p-tablewrap"><table class="pt ah-t"><thead><tr><th></th><th>Cliente</th><th>Status</th><th>Último contacto</th><th>Registro</th><th>País</th><th>Campaña</th>${who?'<th>Agente</th>':''}<th class="act"></th></tr></thead><tbody>${list.slice(0,lim||list.length).map((r,i)=>ahRow(r,i+1,who)).join('')}</tbody></table></div>`;
}
const noCrm=()=>'Todavía no llegaron clientes del CRM. '+(extOld()?`Actualizá la extensión a la ${EXT_VER} (Ajustes) y recargá el CRM.`:'Abrí la lista de clientes del CRM con la extensión.');
let ahWho='',ahLow=false,ahRep=false,ahFail=false,ahMore={};
V.ahora={
  build(){
    $('#ahWho').addEventListener('change',e=>{ahWho=e.target.value;ahMore={};this.render({})});
    $('#ahBody').addEventListener('click',e=>{
      const b=e.target.closest('[data-ah]');if(!b)return;
      const a=b.dataset.ah,id=b.dataset.id;
      if(a==='ficha')return openFicha(id);
      if(a==='ag')return agendarCliente(id,b.dataset.nm||'');
      if(a==='low'){ahLow=!ahLow;this.render({});return}
      if(a==='rep'){ahRep=!ahRep;this.render({});return}
      if(a==='fail'){ahFail=!ahFail;this.render({});return}
      if(a==='more'){ahMore[b.dataset.g]=1;this.render({});return}
      if(a==='cap')return capModal();
    });
  },
  render(){
    crmLoad();
    if(!ahWho||(ahWho==='me'&&isLeadUid(me)))ahWho=tlView()||isLeadUid(me)?'all':'me';
    const sel=$('#ahWho');
    if(sel!==document.activeElement){
      const ms=isLeader()?members.filter(m=>m.active&&m.id!==me):[];
      sel.innerHTML=(isLeadUid(me)?'':`<option value="me">Mis clientes</option>`)+`<option value="all">Toda la mesa</option>`+ms.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
      if(![...sel.options].some(o=>o.value===ahWho))ahWho=isLeadUid(me)?'all':'me';sel.value=ahWho;
    }
    const uid=ahWho==='me'?me:ahWho==='all'?null:ahWho,who=uid!==me;
    if(crm.ok===false){$('#ahSub').textContent='';$('#ahBody').innerHTML='<section class="card"><div class="p-empty">La cola se activa en un rato (falta actualizar la base).</div></section>';return}
    const q=queueOf(uid),now=new Date();
    $('#ahSub').innerHTML=`En el orden de la mesa: new, agendas, y después Call Again, Hang Up y NA del día 1 al ${NA_MAX}. ${extOn()?'':sp('hot','Abrí el CRM con la extensión para que lleguen los clientes.')}`;
    const sec=(n,t,sub,body,empty)=>`<section class="card ah-g"><div class="card-h"><span class="ah-n">${n}</span><h3>${t}</h3><span class="p-sub">${sub}</span></div>${body||`<div class="p-empty" style="padding:10px 0">${empty}</div>`}</section>`;
    const lim=g=>ahMore[g]?0:40,more=(g,l)=>l.length>40&&!ahMore[g]?`<button type="button" class="btn sm rk-more" data-ah="more" data-g="${g}">Ver los ${l.length}</button>`:'';
    const agBody=q.ag.length?`<div class="alist">${q.ag.map(p=>uid===me||pend.includes(p)?pendItem(p,now,true):`<div class="ai"><span class="wh">${esc(whenTxt(parseDue(p.due)))}</span><span class="id">${esc(p.id)}</span><span class="kw">${esc(p.kw)}<small>${esc(memberName(p.uid))}</small></span><span></span></div>`).join('')}</div>`:'';
    const g3sub=q.many?`Son ${q.n3}: más que el tope de ${q.cap}, así que van solo los registrados en ${MES[now.getMonth()]} (${q.g3.length})`:`${plural(q.n3,'cliente')} · hasta ${q.cap} se llaman todos`;
    $('#ahBody').innerHTML=
      sec(1,'New',`${q.g1.length} sin depositar`,ahTable(q.g1,who,lim('g1'))+more('g1',q.g1),crm.rows.size?'No hay new sin depositar.':esc(noCrm()))+
      sec(2,'Agendas',plural(q.ag.length,'para hoy o vencida','para hoy o vencidas')+(q.cb.length?` · ${plural(q.cb.length,'CallBack o Pending Payment','CallBack o Pending Payment')} sin agenda en Vitalis`:''),
        agBody+(q.cb.length?`<p class="p-sub" style="margin:10px 0 6px">Tienen cita en el CRM: agendalos en Vitalis para que te avise.</p>`+ahTable(q.cb,who,lim('cb'))+more('cb',q.cb):''),'Nada agendado para ahora.')+
      sec(3,'Call Again, Hang Up y NA',g3sub+(isLeader()?` · <button type="button" class="lnk" data-ah="cap">cambiar el tope</button>`:''),ahTable(q.g3,who,lim('g3'))+more('g3',q.g3),'Nadie para volver a llamar.')+
      `<section class="card ah-g ah-out"><div class="card-h"><h3>Fuera de la cola</h3><span class="p-sub">NA día 5 ${q.rep.length} · Low potential ${q.low.length}${q.lowSin?` (${q.lowSin} sin agenda)`:''} · depósito trabado ${q.failed.length} · Not interested ${q.ni} · Do Not Call ${q.dnc}${q.inv?` · inválidos ${q.inv}`:''}${q.otro?` · otros ${q.otro}`:''}</span><span class="grow"></span>
        ${q.rep.length?`<button type="button" class="btn sm" data-ah="rep">${ahRep?'Ocultar':'Ver'} NA día 5</button>`:''}${q.low.length?`<button type="button" class="btn sm" data-ah="low">${ahLow?'Ocultar':'Ver'} los Low potential</button>`:''}${q.failed.length?`<button type="button" class="btn sm" data-ah="fail">${ahFail?'Ocultar':'Ver'} depósitos trabados</button>`:''}</div>
        ${ahRep&&q.rep.length?`<p class="p-sub" style="margin:0 0 8px">NA del día 5 en adelante: solo para repasos.</p>`+ahTable(q.rep,who):''}
        ${ahLow&&q.low.length?`<p class="p-sub" style="margin:0 0 8px">No tienen el dinero ahora: van agendados para el día que dijeron.${q.lowSin?` <span class="hot">${plural(q.lowSin,'está','están')} sin agenda: sin cita, CRM los puede mover.</span>`:''}</p>`+ahTable(q.low,who):''}
        ${ahFail&&q.failed.length?`<p class="p-sub" style="margin:0 0 8px">Failed Deposit, Bank Block y Declined: quisieron depositar y no se pudo.</p>`+ahTable(q.failed,who):''}<p class="note" style="margin-top:6px">Do Not Call no aparece nunca y no se puede agendar.</p></section>`;
  },
};
function capModal(){
  if(!isLeader())return;
  modal({title:'Tope del grupo 3',body:`<p class="mp">Si hay hasta este número de Call Again, Hang Up y NA, se llaman todos. Si hay más, solo los registrados en el mes, hasta que se limpie.</p><label class="fld" style="max-width:160px"><span>Tope</span><input id="capN" inputmode="numeric" value="${qCap()}"></label><div class="ebox" id="capE"></div>`,
    actions:[{l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{const n=parseInt(api.q('#capN').value,10);if(!(n>=1&&n<=1000)){api.q('#capE').textContent='Entre 1 y 1000.';return false}
      const r=await B.rpc('set_queue_cap',{n});if(!r)return false;teamInfo.queue_cap=n;toast(`Tope del grupo 3: ${n}.`);refresh()}}]});
}
function agendarCliente(id,kw){if(isDnc(id))return toast(`<b>${esc(id)}</b> está en Do Not Call: no se agenda.`,'err');agendarModal(id,kw)}
async function dncBlock(id){
  let r=crmStatusOf(id);
  if(!r&&crm.ok!==false){try{r=await crmOne(id)}catch(e){}}
  if(r&&r.grp==='dnc'){toast(`<b>${esc(id)}</b> está en Do Not Call: no se agenda.`,'err');return true}
  return false;
}
// lo de ahora, en el inicio (para el team leader, la mesa)
function ahoraCard(){
  if(crm.ok===false)return '';
  const q=queueOf(tlView()||isLeadUid(me)?null:me),te=todayS();
  const top=[...q.g1.slice(0,3).map(r=>({t:'new',r})),...q.ag.slice(0,2).map(p=>({t:'ag',p})),...q.g3.slice(0,3).map(r=>({t:'g3',r}))].slice(0,6);
  const li=x=>x.t==='ag'?`<div class="li"><span class="t">${esc(whenTxt(parseDue(x.p.due)))}</span><span class="n"><b>${esc(x.p.id)}</b> ${esc(x.p.kw)}<small>agenda</small></span><span></span><span></span><span></span></div>`
    :`<div class="li"><span class="t">${regAt(x.r)?esc(rel(regAt(x.r))):''}</span><span class="n"><button type="button" class="lnkp" data-act="fichaCl" data-id="${esc(x.r.id)}"><b>${esc(x.r.id)}</b></button> ${esc(x.r.name)}<small>${esc(x.r.country)}${x.r.camp?' · '+esc(x.r.camp):''}</small></span><span></span><span>${stBadge(x.r)}</span><span></span></div>`;
  return `<div class="card-h"><h3>${tlView()?'La cola de la mesa':'Ahora'}</h3><span class="p-sub">${plural(q.g1.length,'new')} · ${plural(q.ag.length,'agenda')} · ${q.g3.length} para volver a llamar</span><span class="grow"></span><button type="button" class="btn sm" data-go="ahora">Ver la cola</button></div>`+
    (top.length?`<div class="lst">${top.map(li).join('')}</div>`:`<div class="p-empty" style="padding:8px 0">${crm.rows.size?'Nada pendiente en la cola.':'Abrí el CRM con la extensión: los clientes que veas entran solos.'}</div>`);
}

/* ---------- conversión por día de registro (new = depositó el mismo día; late = después) ---------- */
function cohort(from,to,uid){
  const S=soldIdx(),own=r=>uid==null||convOwner(r)===uid;
  const rows=crmAll().filter(r=>!isArch(r.brand)&&own(r)&&(()=>{const d=regDay(r);return d>=from&&d<=to})());
  let nw=0,lt=0;for(const r of rows){const f=S.get(ckey(r.brand,r.id));if(f){if(isLate(f))lt++;else nw++}else if(paidCrm(r)&&r.ftd){if(r.ftd.slice(0,10)!==regDay(r))lt++;else nw++}}
  return {n:rows.length,nw,lt,rate:rows.length?nw/rows.length:null,lrate:rows.length?lt/rows.length:null};
}
const cohortCovers=(from,to)=>crm.ok&&crmAll().some(r=>!isArch(r.brand)&&(()=>{const d=regDay(r);return d>=from&&d<=to})());
function cohortOn(){const te=todayS();return crm.ok&&crmAll().some(r=>!isArch(r.brand)&&regDay(r)>=te.slice(0,8)+'01')}
function convCardsX(uid){ // con el registro del CRM: conversión de verdad; sin él, la cuenta vieja
  if(!cohortOn())return convCards(uid);
  const te=todayS(),P=[['Hoy',te,te],['Esta semana',weekStart(te),te],['Este mes',te.slice(0,8)+'01',te]];
  return `<div class="conv3">${P.map(([l,a,b])=>{const c=cohort(a,b,uid);
    return `<div class="cv"><div class="lb">${l}</div><div class="v${c.rate==null?' none':''}">${c.rate==null?'—':pct(c.rate)}</div><div class="s">${c.nw} new de ${plural(c.n,'registrado')}${c.lt?` · ${c.lt} late`:''}</div><div class="bar"><i style="width:${c.rate==null?0:Math.min(100,c.rate*100)}%"></i></div></div>`}).join('')}</div>`;
}
const convSubX=tl=>cohortOn()?(tl?'de la mesa: ':'')+'de los registrados, cuántos depositaron el mismo día (new)':(tl?'de la mesa: ':'')+'FTDs sobre clientes vistos (cuenta aproximada)';

/* la ficha del cliente y el cliente actual viven en ficha.js */

/* ---------- el team leader: la cola de cada agente ---------- */
function colaMesaCard(){
  if(crm.ok===false||!isLeader())return '';
  const te=todayS(),ym=te.slice(0,7),act=sellers(team.filter(f=>f.date.slice(0,7)===ym));
  const med=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]};
  const rows=act.map(m=>{const q=queueOf(m.id),c=cohort(te,te,m.id),ag=agStats(m.id);
    const sal=crmAll().filter(r=>!isArch(r.brand)&&crmOwner(r)===m.id&&regDay(r)===te&&r.grp!=='new'&&r.grp!=='gone'&&r.since&&r.first&&new Date(r.since)>new Date(r.first)).map(r=>(new Date(r.since)-new Date(r.first))/6e4);
    const rin=crm.rot.filter(x=>agentUid(x.new_agent)===m.id).length,rout=crm.rot.filter(x=>agentUid(x.old_agent)===m.id).length;
    return {m,q,c,ag,rin,rout,t:med(sal),late:team.filter(f=>f.uid===m.id&&f.date.slice(0,7)===ym&&isLate(f)).length}});
  const sinDueno=crmAll().filter(r=>!isArch(r.brand)&&!crmOwner(r)&&G3.concat('new').includes(r.grp)).length;
  return `<div class="card-h"><h3>La cola de cada uno</h3><span class="p-sub">hoy, en el orden de la mesa · tope del grupo 3: ${qCap()}</span><span class="grow"></span><button type="button" class="btn sm" data-go="ahora">Ver la cola</button></div>
    <div class="p-tablewrap"><table class="pt"><thead><tr><th>Agente</th><th class="r">New sin depositar</th><th class="r">Agendas vencidas</th><th class="r">Grupo 3</th><th class="r">Registrados hoy</th><th class="r">New hoy</th><th class="r">Late del mes</th><th class="r" title="Clientes que CRM le pasó hoy / que le sacó hoy">Rotados hoy</th><th class="r" title="Mediana del tiempo hasta que el cliente deja New (aprox.: es cuando alguien lo vio cambiar)">Deja New en</th></tr></thead><tbody>`+
    rows.map(x=>`<tr><td><button type="button" class="who-cell lnkp" data-prof="${esc(x.m.id)}">${avatar(x.m.name)}${esc(x.m.name)}</button></td><td class="r">${x.q.g1.length||'<span class="d">0</span>'}</td><td class="r">${x.ag.venc?`<span class="hot b">${x.ag.venc}</span>`:'<span class="d">0</span>'}</td>
      <td class="r">${x.q.g3.length}${x.q.many?` <span class="d">de ${x.q.n3}</span>`:''}</td><td class="r">${x.c.n}</td><td class="r">${x.c.n?`${x.c.nw} · ${pct(x.c.nw/x.c.n)}`:'<span class="d">—</span>'}</td><td class="r">${x.late}</td><td class="r">${x.rin||x.rout?`${x.rin?'+'+x.rin:''}${x.rin&&x.rout?' · ':''}${x.rout?'−'+x.rout:''}`:'<span class="d">0</span>'}</td><td class="r d">${x.t==null?'—':x.t<60?Math.round(x.t)+' min':nf(x.t/60,1)+' h'}</td></tr>`).join('')+
    `</tbody></table></div>${sinDueno?`<p class="note">${plural(sinDueno,'cliente')} de la cola sin agente asignado (la lista del CRM no trae la columna de agente).</p>`:''}`;
}

/* ---------- calidad de datos y registro de accesos (Ajustes) ---------- */
let datosAt=0,auditAt=0;
async function datosCard(force){
  const el=$('#cfDatos');if(!el)return;
  el.hidden=!isAdmin();if(!isAdmin())return;
  if(!force&&Date.now()-datosAt<30e3)return;datosAt=Date.now();
  const sinTx=team.filter(f=>!f.tx),sinHora=team.filter(f=>String(f.reg||'').length<16),nullC=team.filter(f=>!flVal(f.camp));
  const byU=l=>{const m={};for(const f of l)m[f.uid]=(m[f.uid]||0)+1;return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([u,n])=>`${esc(memberName(u))} ${n}`).join(' · ')};
  let otros=[];
  if(crm.ok!==false){try{const rows=await crmPage(()=>sb.from('crm_clients').select('*').eq('status_group','otro').order('client_id'),3000);const m={};for(const r of rows){const k=r.status||'(vacío)';m[k]=(m[k]||0)+1}otros=Object.entries(m).sort((a,b)=>b[1]-a[1])}catch(e){}}
  const opts=Object.entries(GRPS).map(([k,l])=>`<option value="${k}">${esc(l)}</option>`).join('');
  el.innerHTML=`<div class="card-h"><h3>Calidad de datos</h3><span class="p-sub">solo el admin</span></div>
    <div class="fi-r"><span>Ventas sin transacción</span><b>${sinTx.length}</b></div>${sinTx.length?`<p class="p-sub" style="margin:0 0 8px">${byU(sinTx)}</p>`:''}
    <div class="fi-r"><span>Ventas sin hora de registro</span><b>${sinHora.length}</b></div>
    <div class="fi-r"><span>Ventas sin campaña (o "null")</span><b>${nullC.length}</b></div>
    <div class="fld" style="margin-top:12px"><span>Status del CRM sin clasificar</span></div>
    ${otros.length?`<div class="dq-st">${otros.slice(0,30).map(([s,n])=>`<div class="frow"><span style="flex:1">${esc(s)} <span class="d">· ${n}</span></span><select data-dq="${esc(s)}" aria-label="Grupo de ${esc(s)}"><option value="">Elegí un grupo…</option>${opts}</select></div>`).join('')}</div>`:`<p class="p-sub" style="margin:4px 0 0">${crm.ok===false?'Se activa cuando se actualice la base.':'Ninguno: todos los status tienen grupo.'}</p>`}`;
  $$('[data-dq]',el).forEach(s=>s.addEventListener('change',async()=>{const g=s.value;if(!g)return;const r=await B.rpc('crm_map_status',{st:s.dataset.dq,grp:g});if(r){toast(`"${esc(s.dataset.dq)}" va como ${esc(GRPS[g])} (${plural(r.clientes||0,'cliente')}).`);crmLoad(true);datosCard(true)}}));
}
async function auditCard(force){
  const el=$('#cfAudit');if(!el)return;
  el.hidden=!isLeader();if(!isLeader())return;
  if(!force&&Date.now()-auditAt<30e3)return;auditAt=Date.now();
  const rows=await QO(sb.from('audit_log').select('*').order('at',{ascending:false}).limit(40));
  const dt=r=>{const d=r.detail||{};return [d.client_id&&('cliente '+d.client_id),d.de&&d.de!==r.user_id&&('de '+memberName(d.de)),d.a&&d.a!==d.de&&('a '+memberName(d.a)),Array.isArray(d.campos)&&d.campos.length&&d.campos.join(', '),d.filas!=null&&plural(d.filas,'fila')].filter(Boolean).join(' · ')};
  el.innerHTML=`<div class="card-h"><h3>Registro de accesos</h3><span class="p-sub">exportaciones y cambios a ventas ajenas</span></div>`+(rows.length?`<div class="p-tablewrap"><table class="pt"><tbody>${rows.map(r=>`<tr><td class="d">${esc(whenTxt(new Date(r.at)))}</td><td>${esc(memberName(r.user_id))}</td><td>${esc(r.action)}</td><td class="d">${esc(dt(r))}</td></tr>`).join('')}</tbody></table></div>`:'<p class="p-sub" style="margin:0">Nada registrado todavía.</p>');
}
const auditNote=(act,detail)=>{try{sb.rpc('audit_note',{act,detail:detail||null}).then(()=>{},()=>{})}catch(e){}};
