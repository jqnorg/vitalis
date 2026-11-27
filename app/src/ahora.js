/* ============================================================
   Clientes del CRM: solo los news (New y Talking) y los FTDs (crm_clients).
   Nuevo rumbo (el dueño, 24/11/2026): Vitalis es news y FTDs. Nada de otros status, nada de cola.
   Acá vive la carga (entera y solo lo que cambió), los new que entran por la estación, lo que manda la
   extensión, la conversión por día de registro y el registro de accesos.
   ============================================================ */
const ARCH='Trade24Seven',isArch=b=>norm(b)===norm(ARCH); // la marca que quedó como archivo
let crm={ok:null,rows:new Map(),byId:new Map(),at:0,busy:null,rot:[],fullAt:0,seenMs:0,rotMs:0,dBusy:false};
const CRM_FULL=10*6e4; // la carga entera, cada 10 min; en el medio, solo lo que cambió
const ckey=(b,id)=>norm(b||DEF_BRAND)+'|'+norm(id);
// dejó de ser new: desapareció de la lista de news, o se lo vio con otro status (cuál, no se guarda: solo importa que ya no es new)
const gone=r=>!!r.left_new_at&&r.status_group==='new';
const C2X=r=>({brand:r.brand,id:r.client_id,name:'',country:r.country||'',reg:r.reg||'',status:gone(r)?'Dejó de ser new':r.status||'',grp:gone(r)?'gone':r.status_group||'otro',agent:r.crm_agent||'',
  camp:r.camp||'',aff:r.aff||'',call:r.last_call||'',note:r.note||'',ftd:r.ftd_at||'',desk:r.desk||'',firstAgent:r.first_agent||'',first:r.first_seen,firstBy:r.first_seen_by,last:r.last_seen,since:r.status_since,left:r.left_new_at||''});
const crmAll=()=>[...crm.rows.values()];
const regDay=r=>r.reg?r.reg.slice(0,10):(r.first?ymd(new Date(r.first)):'');
const callAt=r=>r.call?parseDue(r.call.slice(0,10)+'T'+r.call.slice(11,16)):null; // "Last Communication Time" del CRM
const regAt=r=>r.reg?(r.reg.length>10?parseDue(r.reg.slice(0,10)+'T'+r.reg.slice(11,16)):parseYMD(r.reg)):(r.first?new Date(r.first):null);
// el team leader no tiene clientes: no llama ni gestiona
const notLead=u=>u&&!isLeadUid(u)?u:null;
function crmOwner(r){if(r.agent)return notLead(agentUid(r.agent));return notLead(r.firstBy)} // el agente del CRM; si no hay columna, quien lo vio primero
// la conversión del new es del primero que lo llamó (si lo rotaron antes de llamarlo, del que lo llamó); sin llamar todavía, del agente actual
function convOwner(r){if(r.firstAgent)return notLead(agentUid(r.firstAgent));return crmOwner(r)}
// de quién es un cliente del registro de new: el del CRM si se lo vio; si no, quien lo anotó (nunca el team leader)
function leadOwner(l){const r=crmStatusOf(l.id);if(r&&(r.agent||r.firstAgent))return convOwner(r);return notLead(l.uid)}
const soldIdx=perPass(()=>{const m=new Map();for(const f of [...team].sort(byDate)){const k=ckey(f.brand,f.id);if(!m.has(k))m.set(k,f)}return m}); // la primera venta de cada cliente
function soldOf(id,brand){const k=norm(id);let best=null;for(const f of team)if(norm(f.id)===k&&(!brand||norm(f.brand)===norm(brand))&&(!best||byDate(f,best)<0))best=f;return best}
function crmStatusOf(id){let r=crm.rows.get(ckey(DEF_BRAND,id));if(r)return r;return crm.byId.get(norm(id))||null} // por ID, de cualquier marca menos el archivo
const paidCrm=r=>r.grp==='ftd'||!!r.ftd; // el CRM ya lo marca con FTD
const isTalking=r=>/talk|habl/.test(norm(r.status||''));
// está en New ahora: new de verdad (no Talking), no dejó de serlo, no depositó
const inNew=r=>r.grp==='new'&&!isArch(r.brand)&&!isTalking(r)&&!paidCrm(r)&&!soldIdx().has(ckey(r.brand,r.id));
// los news de alguien (uid; null = toda la mesa): los que están en New o Talking, y los registrados hoy (ya llamados o no), sin depositar
function newsOf(uid){
  const S=soldIdx(),te=todayS(),own=r=>uid==null||crmOwner(r)===uid;
  return crmAll().filter(r=>!isArch(r.brand)&&own(r)&&!paidCrm(r)&&!S.has(ckey(r.brand,r.id))&&(r.grp==='new'||regDay(r)===te)).sort((a,b)=>(regAt(b)||0)-(regAt(a)||0));
}
// palabra clave de confidencialidad del cliente (la pone el agente, la ve la mesa): dato propio del cliente
let ckw={};
const clientKw=id=>(ckw[norm(id)]||{}).kw||'';
const clientBrand=id=>{const r=crm.byId.get(norm(id));return r&&r.brand||DEF_BRAND};
let kwAt=0,kwBusy=null;
async function kwLoad(force){
  if(!ready||!sb||kwBusy||(!force&&Date.now()-kwAt<20e3))return;
  kwBusy=(async()=>{try{const rows=await Q(sb.from('client_keywords').select('client_id,brand,kw'));const m={};for(const r of rows)m[norm(r.client_id)]={kw:r.kw,brand:r.brand};ckw=m;kwAt=Date.now()}catch(e){}finally{kwBusy=null}})();
  return kwBusy;
}
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
// el status en palabras simples (solo hay tres cosas: en New, en llamada, ya no es new; y depositó)
function sgPlain(r){if(!r)return '';if(paidCrm(r))return 'Ya depositó';if(r.grp==='gone')return 'Dejó de ser new';if(isTalking(r))return 'En llamada (Talking)';if(r.grp==='new')return 'New: llamalo ya';return ''}
const stBadge=r=>{const t=sgPlain(r);return t?`<span class="badge st st-${esc(paidCrm(r)?'ftd':r.grp)}">${esc(t)}</span>`:''};

/* ---------- carga: los news y los registrados este mes y la semana, y los de la agenda ---------- */
async function crmPage(build,max=20000){const out=[];for(let i=0;i<max;i+=1000){const rows=await Q(build().range(i,i+999));out.push(...rows);if(rows.length<1000)break}return out}
async function crmLoad(force){
  if(!ready||!sb)return;
  if(crm.busy)return crm.busy;
  if(!force&&Date.now()-crm.at<20e3)return;
  if(!force&&crm.ok&&crm.seenMs&&Date.now()-crm.fullAt<CRM_FULL)return crmDelta(); // en el medio, solo lo que cambió (liviano)
  kwLoad(force);
  crm.busy=(async()=>{
    try{
      const te=todayS(),from=[te.slice(0,8)+'01',weekStart(te)].sort()[0],fromTs=parseYMD(from).toISOString();
      const base=()=>sb.from('crm_clients').select('*').neq('brand',ARCH);
      const ids=[...new Set([...pend,...teamAg].filter(p=>!p.done).map(p=>String(p.id)))].slice(0,300);
      // todo junto: los que están en New o Talking, los registrados del mes y la semana, los de la agenda y las rotaciones de hoy
      const [act,coh,cohS,ag,rot]=await Promise.all([
        crmPage(()=>base().eq('status_group','new').is('left_new_at',null).order('client_id')),
        crmPage(()=>base().gte('reg',from).order('client_id')),
        crmPage(()=>base().gte('first_seen',fromTs).order('client_id')),
        ids.length?Q(base().in('client_id',ids)):Promise.resolve([]),
        QO(sb.from('crm_agent_log').select('client_id,brand,old_agent,new_agent,status,seen_at').gte('seen_at',parseYMD(te).toISOString()).order('seen_at').limit(2000)), // las rotaciones de hoy (el reparto de news)
      ]);
      const rows=[...act,...coh,...cohS,...ag];crmApply(rows,rot);crm.fullAt=Date.now();
      if(Date.now()-crmSnapAt>12e4){crmSnapAt=Date.now();snapCrm(rows,rot)} // lo guardado para arrancar rápido: como mucho cada 2 min
    }catch(e){if(/crm_clients|PGRST205|42P01|does not exist/.test(String(e&&(e.message||e.code))))crm.ok=false}
    finally{crm.busy=null}
  })();
  return crm.busy;
}
let crmSnapAt=0;
const tsMax=(L,k)=>{let m=0;for(const r of L){const t=Date.parse(r[k]);if(t>m)m=t}return m};
const CRM_VIEWS=['home','inicio','clientes','campanas','equipo','agenda','callman','gerencia'];
function crmApply(rows,rot){
  const m=new Map();for(const r of rows){const x=C2X(r);m.set(ckey(x.brand,x.id),x)}
  crm.seenMs=tsMax(rows,'last_seen');crm.rotMs=Math.max(tsMax(rot||[],'seen_at'),parseYMD(todayS()).getTime());
  const by=new Map();for(const x of m.values())if(!isArch(x.brand)&&!by.has(norm(x.id)))by.set(norm(x.id),x);
  const was=crm.ok;crm.rows=m;crm.byId=by;crm.rot=rot||[];crm.ok=true;crm.at=Date.now();
  newCheck();
  if(ready&&(!was||CRM_VIEWS.includes(cur)))refresh();
}
let crmT=null;const crmSoon=(ms=1500)=>{clearTimeout(crmT);crmT=setTimeout(()=>crmDelta(),ms)};
/* Solo lo que cambió desde la última vez (last_seen): la estación lee el CRM cada pocos segundos y antes cada lectura recargaba
   todos los clientes en cada Vitalis abierto. Cada 10 min, la carga entera. */
async function crmDelta(){
  if(!ready||!sb)return;
  if(!crm.ok||!crm.seenMs||Date.now()-crm.fullAt>=CRM_FULL)return crmLoad(true);
  if(crm.busy||crm.dBusy)return;
  crm.dBusy=true;let full=false;
  try{
    const te=todayS(),from=[te.slice(0,8)+'01',weekStart(te)].sort()[0],fromMs=parseYMD(from).getTime();
    const [rows,rot]=await Promise.all([
      Q(sb.from('crm_clients').select('*').neq('brand',ARCH).gt('last_seen',new Date(crm.seenMs-3000).toISOString()).order('last_seen').limit(1000)),
      QO(sb.from('crm_agent_log').select('client_id,brand,old_agent,new_agent,status,seen_at').gt('seen_at',new Date(Math.max(crm.rotMs,parseYMD(te).getTime())).toISOString()).order('seen_at').limit(500)),
    ]);
    if(rows.length>=1000){full=true;return}
    const ag=new Set([...pend,...teamAg].filter(p=>!p.done).map(p=>norm(p.id)));
    let n=0;
    for(const r of rows){ // los mismos que trae la carga entera (news, registrados o vistos este mes, los de la agenda) o los que ya estaban
      const x=C2X(r),k=ckey(x.brand,x.id),inSet=r.status_group==='new'||(r.reg||'')>=from||Date.parse(r.first_seen)>=fromMs||ag.has(norm(x.id));
      if(!inSet&&!crm.rows.has(k))continue;
      crm.rows.set(k,x);if(!isArch(x.brand))crm.byId.set(norm(x.id),x);n++;
    }
    crm.seenMs=Math.max(crm.seenMs,tsMax(rows,'last_seen'));
    const seenRot=new Set(crm.rot.map(r=>r.client_id+'|'+r.seen_at)),nr=(rot||[]).filter(r=>!seenRot.has(r.client_id+'|'+r.seen_at));
    if(nr.length){crm.rot=[...crm.rot,...nr];crm.rotMs=Math.max(crm.rotMs,tsMax(nr,'seen_at'))}
    crm.at=Date.now();
    if(n||nr.length){newCheck();if(ready&&CRM_VIEWS.includes(cur))refresh()}
  }catch(e){}
  finally{crm.dBusy=false;if(full)crmLoad(true)}
}
/* ---------- los new que entran por la estación ----------
   El CRM del team leader (la estación) lee los new cada 10 s y los guarda en crm_clients: a cada agente le avisa de los
   suyos (Sales Rep), aunque no tenga una pestaña propia vigilando. Uno solo por cliente: lo que ya avisó la pestaña
   vigilada de la extensión (cmd "nuevo") no se repite. El team leader no recibe (no gestiona clientes). */
const NEW_FRESH=15*6e4;
let newAl=null,newAt=0,newBusy=false;
const newSeen=()=>newAl||(newAl=new Map(local.get('newAl',[])));
function newMark(id){
  const m=newSeen(),k=norm(id);if(!k||m.has(k))return false;
  m.set(k,Date.now());const cut=Date.now()-2*864e5;for(const [a,t] of m)if(t<cut)m.delete(a);
  local.set('newAl',[...m].slice(-400));return true;
}
function newFresh(x,now,te){
  return x.grp==='new'&&!isArch(x.brand)&&!isTalking(x)&&!paidCrm(x)&&x.first&&now-new Date(x.first)<NEW_FRESH&&(!x.reg||regDay(x)===te);
}
function newCheck(){
  if(!ready||!profile||isLeadUid(me)||readOnly)return;
  const now=Date.now(),te=todayS(),out=[];
  for(const x of crm.rows.values())if(newFresh(x,now,te)&&x.firstBy!==me&&crmOwner(x)===me&&!newSeen().has(norm(x.id))&&!soldOf(x.id))out.push(x); // los que viste vos en tu CRM ya los tenés
  if(!out.length)return;
  out.sort((a,b)=>new Date(b.first)-new Date(a.first));
  for(const x of out)newMark(x.id);
  const away=pageAway();
  fichaNew(out[0].id); // aviso con el ID (y queda como cliente actual para la mini ficha)
  if(out.length>1)toast(`Entraron ${out.length} news: ${out.slice(0,4).map(x=>`<b>${esc(x.id)}</b>`).join(', ')}${out.length>4?'…':''}`,'imp',{key:'news',actions:[{l:'Ver',fn:()=>go('cliente')}]});
  if(away)for(const x of out.slice(0,3))extSocial({k:'crm:id:'+x.id,v:x.id,lvl:'imp',title:'Cliente nuevo en el CRM',id:x.id,kw:x.name||'',meta:[paisOf(x.country),'entró '+hhmm(+new Date(x.first))].filter(Boolean).join(' · '),btns:[['crm','Ver en el CRM',1],['close','Ok']]});
  else beep(1);
}
// consulta liviana (solo los new de los últimos minutos): con la pestaña escondida, la extensión la despierta cada 30 s
async function newPoll(){
  if(!ready||!sb||!profile||isLeadUid(me)||newBusy||crm.ok===false||Date.now()-newAt<25e3)return;
  newBusy=true;newAt=Date.now();
  try{
    const rows=await Q(sb.from('crm_clients').select('*').neq('brand',ARCH).eq('status_group','new').gte('first_seen',new Date(Date.now()-NEW_FRESH).toISOString()).limit(200));
    let n=0;for(const r of rows){const x=C2X(r),k=ckey(x.brand,x.id);if(!crm.rows.has(k))n++;crm.rows.set(k,x);if(!crm.byId.has(norm(x.id)))crm.byId.set(norm(x.id),x)}
    newCheck();if(n&&cur==='home')refresh();
  }catch(e){}finally{newBusy=false}
}
async function crmOne(id){const r=await Q(sb.from('crm_clients').select('*').eq('client_id',String(id)).limit(5));const x=r.map(C2X);return x.find(c=>!isArch(c.brand))||x[0]||null}
async function crmLog(id){ // New ↔ Talking ↔ FTD y rotaciones, en orden
  const [a,b]=await Promise.all([QO(sb.from('crm_status_log').select('*').eq('client_id',String(id)).order('seen_at',{ascending:true}).limit(60)),
    QO(sb.from('crm_agent_log').select('*').eq('client_id',String(id)).order('seen_at',{ascending:true}).limit(30)).catch(()=>[])]);
  return [...a,...b].filter(r=>!isArch(r.brand)).sort((x,y)=>new Date(x.seen_at)-new Date(y.seen_at));
}

// lo que mandó la extensión: los clientes vistos en el CRM (la base se queda solo con los news y los FTDs)
async function crmSeenFromExt(rows){
  if(!ready||readOnly)return {err:'Vitalis todavía está cargando'};
  // las llamadas (toques en Omega, Gizat, Voiso) van aparte
  const callR=rows.slice(0,500).filter(r=>r&&r.ln);
  if(callR.length){try{await callsFromExt(callR)}catch(e){return {err:/calls_add|PGRST202|42883/.test(String(e&&(e.message||e.code)))?'falta actualizar la base':errMsg(e)}}}
  if(callR.length===rows.slice(0,500).length)return {keys:callR.map(r=>String(r.k||''))};
  if(crm.ok===false&&Date.now()-crm.at<5*6e4)return {err:'falta actualizar la base'};
  const s=v=>String(v??'').replace(/\s+/g,' ').trim(),batch=rows.slice(0,500);
  const list=batch.filter(r=>r&&!r.ln&&s(r.id)).map(r=>({id:s(r.id).slice(0,60),brand:s(r.brand).slice(0,40),name:null,country:s(r.country).slice(0,60),status:s(r.status).slice(0,60),
    reg:/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(r.reg||'')?r.reg:'',agent:s(r.agent).slice(0,80),camp:s(r.camp).slice(0,120),aff:s(r.aff).slice(0,60),
    call:/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.call||'')?r.call:'',note:s(r.note).slice(0,200),
    ftd:/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(r.ftd||'')?r.ftd:'',desk:s(r.desk).slice(0,80),...(r.gone?{gone:1}:{})}));
  const keys=batch.map(r=>String(r&&r.k||''));
  if(!list.length)return {keys};
  try{const res=await Q(sb.rpc('crm_seen',{rows:list}));crm.ok=true;if(res&&(res.new||res.changed)){crmSoon();mesaPing('crm')}
    return {keys,added:res&&res.new||0}}
  catch(e){const m=String(e&&(e.message||e.code));if(/crm_seen|PGRST202|42883|crm_clients|does not exist/.test(m)){crm.ok=false;crm.at=Date.now();return {err:'falta actualizar la base'}}return {err:errMsg(e)}}
}
function agendarCliente(id,kw){agendarModal(id,kw)}
const noCrm=()=>'Todavía no llegaron clientes del CRM. '+(extOld()?`Actualizá la extensión a la ${EXT_VER} (Ajustes) y recargá el CRM.`:'Abrí la lista de news del CRM con la extensión.');

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

/* ---------- el new y su reloj (lo definió el dueño, 27/11/2026) ----------
   New = sin gestionar. Talking = lo está gestionando ahora. El agente, apenas lo ve, lo pasa a Talking (conteste o no) y al terminar el primer contacto a otro status: nunca vuelve a New.
   El reloj corre desde que lo tiene el agente (cuando Vitalis lo vio por primera vez, o la última rotación de hoy hacia él), no desde que el cliente existe en el CRM.
   Gestionado = pasó a Talking (o ya a otro status). Las llamadas de Omega/Gizat/Voiso son un dato más (RMO), no la prueba. */
function assignedAt(r){ // desde cuándo lo tiene su agente
  const k=norm(r.id);let t=r.first?Date.parse(r.first):0;
  for(const x of (crm.rot||[]))if(norm(x.client_id)===k){const s=Date.parse(x.seen_at);if(s>t)t=s}
  return t||null;
}
function managedAt(r){ // cuándo lo gestionaron: el paso a Talking (si está en Talking, desde cuándo; si no, el primer Talking del log de hoy) o cuando dejó de ser new
  const a=assignedAt(r)||0;
  if(isTalking(r)&&r.since){const s=Date.parse(r.since);if(s>=a)return s}
  const l=stLog.filter(x=>x.id===norm(r.id)&&isTalk(x)&&x.at>=a).sort((p,q)=>p.at-q.at)[0];if(l)return l.at;
  if(r.left){const s=Date.parse(r.left);if(s>=a)return s}
  return null;
}
function newSpeed(r){ // minutos desde que lo tiene el agente hasta que lo gestionó; null si sigue sin gestionar o no hay hora
  const a=assignedAt(r),t=managedAt(r);if(!a||!t)return null;const m=(t-a)/6e4;return m>=0&&m<24*60?m:null;
}
function newSpeedOf(uid,from,to){ // {n, med, p90, slow} de los news registrados en el rango que ya se gestionaron
  const own=r=>uid==null||convOwner(r)===uid,ms=[];
  for(const r of crmAll()){if(isArch(r.brand)||!own(r))continue;const d=regDay(r);if(d<from||d>to)continue;const m=newSpeed(r);if(m!=null)ms.push(m)}
  ms.sort((a,b)=>a-b);const q=p=>ms.length?ms[Math.min(ms.length-1,Math.floor(ms.length*p))]:null;
  return {n:ms.length,med:q(.5),p90:q(.9),slow:ms.filter(m=>m>5).length};
}
const minTxt2=m=>m==null?'—':m<1?'<1 min':m<60?Math.round(m)+' min':nf(m/60,1)+' h';

/* ---------- calidad de datos y registro de accesos (Ajustes) ---------- */
let datosAt=0,auditAt=0;
async function datosCard(force){
  const el=$('#cfDatos');if(!el)return;
  el.hidden=!isAdmin();if(!isAdmin())return;
  if(!force&&Date.now()-datosAt<30e3)return;datosAt=Date.now();
  const sinTx=team.filter(f=>!f.tx),sinHora=team.filter(f=>String(f.reg||'').length<16),nullC=team.filter(f=>!flVal(f.camp));
  const byU=l=>{const m={};for(const f of l)m[f.uid]=(m[f.uid]||0)+1;return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([u,n])=>`${esc(memberName(u))} ${n}`).join(' · ')};
  el.innerHTML=`<div class="card-h"><h3>Calidad de datos</h3><span class="p-sub">solo el admin</span></div>
    <div class="fi-r"><span>Ventas sin transacción</span><b>${sinTx.length}</b></div>${sinTx.length?`<p class="p-sub" style="margin:0 0 8px">${byU(sinTx)}</p>`:''}
    <div class="fi-r"><span>Ventas sin hora de registro</span><b>${sinHora.length}</b></div>
    <div class="fi-r"><span>Ventas sin campaña (o "null")</span><b>${nullC.length}</b></div>`;
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
