/* ---------- estación: las pestañas propias del CRM en el Chrome del team leader ---------- */
// Con dos alcanza: Clientes (todos los status, ordenada por Modified Time: lo que cambia sube arriba) y Transactions. Las de antes
// (News, Cola, Agendables, Cerrados, por grupo de status) siguen andando. Cada vista es una pestaña que la extensión fija, actualiza a su ritmo y
// vuelve a abrir si se cierra, solo en horario. La extensión late cada 30 s por la pestaña de Vitalis de esa compu
// (station_beat); acá se ve hace cuánto se leyó cada vista y se avisa a team leader y admin si algo anda mal.
const ST_VIEWS=[['todo','Clientes',10],['trx','Transactions',15],['news','News',10],['cola','Cola',30],['agen','Agendables',60],['cerr','Cerrados',600]];
const ST_OLD=['news','cola','agen','cerr'];
const stName=v=>(ST_VIEWS.find(x=>x[0]===v)||[0,v])[1];
const ST_HOURS={days:[1,2,3,4,5],from:9*60,to:17*60+30}; // lunes a viernes, 9:00 a 17:30 (igual que la extensión)
const ST_QUIET=3*6e4; // sin latido en horario: la estación se calló
let stRows=[],stAt=0,stSent=0,stOkErr=0,stLoaded=false;
const stInHours=(d=new Date())=>{const m=d.getHours()*60+d.getMinutes();return ST_HOURS.days.includes(d.getDay())&&m>=ST_HOURS.from&&m<ST_HOURS.to};
const stAgo=ms=>{const s=Math.round((Date.now()-ms)/1e3);return s<45?'recién':s<3600?`hace ${Math.max(1,Math.round(s/60))} min`:s<86400?`hace ${Math.round(s/3600)} h`:`hace ${Math.round(s/86400)} días`};
const lc1=t=>t.charAt(0).toLowerCase()+t.slice(1); // "Sin sesión del CRM" → "sin sesión del CRM"
const stEvery=v=>(ST_VIEWS.find(x=>x[0]===v)||[0,0,30])[2];
const stLate=r=>!r.last_ok||Date.now()-Date.parse(r.last_ok)>Math.max(90e3,3*stEvery(r.vista)*1e3); // tres vueltas sin una lectura buena
const stBeatAt=()=>Math.max(0,...stRows.map(r=>Date.parse(r.updated_at)||0));
const stQuiet=()=>stRows.length&&stInHours()&&Date.now()-stBeatAt()>ST_QUIET;

async function stLoad(force){
  if(!ready||!isLeader())return;
  if(!force&&Date.now()-stAt<50e3)return;
  stAt=Date.now();
  try{stRows=await Q(sb.from('station_state').select('vista,last_ok,last_try,n,total,off_pct,problem,updated_at,sweep_at,sweep_n,sweep_pages,sweep_ms,sweep_err,sweep_gone,pager'))||[];stLoaded=true}catch(e){}
}
// lo que manda la extensión de esta compu (si es la estación): a la base, como mucho cada 20 s
async function stationFromExt(views){
  if(!ready||readOnly||!isLeader()||Date.now()-stSent<2e4&&views.length)return;
  stSent=Date.now();
  const clean=views.slice(0,10).map(v=>({vista:String(v.vista||'').slice(0,8),ok:v.ok||null,try:v.try||null,n:+v.n||0,total:v.total==null?null:+v.total,problem:String(v.problem||'').slice(0,12),
    sweep:v.sweep&&typeof v.sweep==='object'?{busy:!!v.sweep.busy,pager:v.sweep.pager==='no'?'no':'',err:String(v.sweep.err||'').slice(0,20)}:undefined,
    statuses:v.statuses&&typeof v.statuses==='object'?Object.fromEntries(Object.entries(v.statuses).slice(0,80).map(([k,n])=>[String(k).slice(0,60),Math.max(0,Math.min(999999,+n||0))])):{}}));
  try{await Q(sb.rpc('station_beat',{p:clean}));stAt=0;if(cur==='equipo')stDraw()}catch(e){if(Date.now()-stOkErr>36e5){stOkErr=Date.now();toast('La estación no pudo avisar su estado a la base.','warn')}}
}
// el pase completo de la pestaña de Clientes (todas las páginas, una vez por hora): la lista entera de la mesa → station_sweep marca a los que ya no están
let swMsg=0;
async function sweepFromExt(w){
  if(!ready||readOnly||!isLeader())return {ok:false,err:'sin sesión'};
  try{
    const r=await Q(sb.rpc('station_sweep',{p:{started:w.started,ended:w.ended,n:+w.n||0,total:w.total==null?null:+w.total,pages:+w.pages||0,ms:+w.ms||0,bounded:!!w.bounded,cutoff:w.cutoff||null,brand:w.brand||'',ids:(w.ids||[]).slice(0,20000)}}));
    stAt=0;if(cur==='equipo')stDraw();
    if(r&&r.ok){if(r.gone||r.back){mesaPing('crm');crmDelta()}if(r.gone&&Date.now()-swMsg>36e5){swMsg=Date.now();toast(`Pase del CRM: ${plural(r.gone,'cliente ya no está','clientes ya no están')} en la mesa (los tiene otra mesa). Salen de las colas.`,'info')}}
    return {ok:true};
  }catch(e){return {ok:false,err:String(e&&e.message||e).slice(0,80)}}
}
const swTxt=r=>{ // la línea del pase para la tarjeta Estación
  if(r.pager==='no')return ['err','No encuentra el paginado: en el panel del CRM, "Copiar diagnóstico"'];
  if(!r.sweep_at)return ['d',r.sweep_err==='busy'?'Pase en marcha…':'Sin pase todavía'];
  const t=`${esc(stAgo(Date.parse(r.sweep_at)))} · ${nf(r.sweep_n||0)} clientes · ${plural(r.sweep_pages||0,'página','páginas')}${r.sweep_ms?' · '+Math.max(1,Math.round(r.sweep_ms/6e4))+' min':''}${r.sweep_gone?' · '+plural(r.sweep_gone,'se fue','se fueron'):''}`;
  if(r.sweep_err==='busy')return ['d','Pase en marcha… (último '+t+')'];
  if(r.sweep_err)return ['hot','Último pase incompleto, no marcó a nadie: '+t];
  return ['ok',t];
};
const swLate=r=>stInHours()&&(new Date().getHours()*60+new Date().getMinutes())>=ST_HOURS.from+90&&(!r.sweep_at||Date.now()-Date.parse(r.sweep_at)>3*36e5); // sin pase en 3 h en horario (desde las 10:30)
function stState(r){
  if(r.problem==='login')return ['err','Sin sesión del CRM'];
  if(r.problem==='cerrada')return ['err','Pestaña cerrada'];
  if(r.problem==='sin-tabla')return ['hot','No ve la lista'];
  if(r.problem==='filtro')return ['hot',`Perdió el filtro (${r.off_pct}% no son de acá)`];
  if(r.problem==='orden')return ['hot','Sin orden: ordená por Modified Time'];
  if(stInHours()&&stLate(r))return ['hot','Atrasada'];
  return ['ok','Al día'];
}
function stationCard(){
  if(!isLeader())return '';
  const head=`<div class="card-h"><h3>Estación</h3><span class="p-sub">las pestañas del CRM que lee el Chrome del team leader</span></div>`;
  const how='dos pestañas del CRM: <b>Clientes</b> con todos los status, ordenada por Modified Time (la más nueva arriba) y 100 por página, y <b>Transactions</b>. Elegí cada una en el botón de Vitalis del CRM';
  if(!stRows.length)return head+`<p class="p-sub" style="margin:4px 2px 0">Sin estación. En el Chrome del team leader, abrí ${how}. Desde ahí se actualizan solas, solo en horario.</p>`;
  const by=Object.fromEntries(stRows.map(r=>[r.vista,r])),old=!by.todo&&stRows.some(r=>ST_OLD.includes(r.vista));
  const line=!stInHours()?'<span class="d">Fuera de horario: quieta hasta el próximo día hábil a las 9.</span>'
    :stQuiet()?`<b class="err">Callada ${esc(stAgo(stBeatAt()))}</b>: fijate que el Chrome del team leader esté prendido y con Vitalis abierto.`
    :`<span class="ok">Leyendo</span> <span class="d">· último aviso ${esc(stAgo(stBeatAt()))}</span>`;
  const rows=ST_VIEWS.filter(([v])=>by[v]||v==='todo'||v==='trx').map(([v,name,every])=>{
    const r=by[v];
    if(!r)return `<tr class="st-off"><td><b>${esc(name)}</b></td><td class="d">Sin pestaña</td><td></td><td></td><td></td></tr>`;
    const [cls,txt]=stState(r);
    return `<tr><td><b>${esc(name)}</b><span class="d"> · cada ${every<60?every+' s':every/60+' min'}</span></td><td><span class="${cls}">${esc(txt)}</span></td><td>${nf(r.n||0)}</td><td>${r.total==null?'<span class="d">—</span>':nf(r.total)}</td><td>${r.last_ok?esc(stAgo(Date.parse(r.last_ok))):'<span class="d">nunca</span>'}</td></tr>`;
  }).join('');
  const sw=by.todo?swTxt(by.todo):null;
  return head+`<p class="st-line">${line}</p>${sw?`<p class="st-line"><b>Pase completo</b> <span class="d">(todas las páginas de Clientes, cada hora: así se sabe quién sigue en la mesa)</span> · <span class="${sw[0]}">${sw[1]}</span></p>`:''}${old?`<p class="p-sub" style="margin:0 2px 8px">Más simple: una sola pestaña de <b>Clientes</b> con todos los status, ordenada por Modified Time (la más nueva arriba) y 100 por página, reemplaza a News, Cola, Agendables y Cerrados. Elegila en el botón de Vitalis del CRM.</p>`:''}<div class="p-tablewrap"><table class="pt st-t"><thead><tr><th>Vista</th><th>Estado</th><th>Vio</th><th>Total en el CRM</th><th>Última lectura buena</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function stDraw(){const el=$('#eqStation');if(!el)return;const h=stLoaded?stationCard():'';el.hidden=!h;el.innerHTML=h}
// cada minuto, para team leader y admin: avisos si la estación se calla, queda sin sesión, se cierra una pestaña o pierde el filtro
let stWarn={};
async function stationCheck(){
  if(!ready||!isLeader())return;
  await stLoad(true);
  if(cur==='equipo')stDraw();
  if(!stRows.length||!stInHours()){stWarn={};return}
  const once=(k,html,kind,card)=>{if(stWarn[k])return;stWarn[k]=Date.now();toast(html,kind,{key:'st-'+k,sticky:kind==='alert',actions:[{l:'Ver Equipo',fn:()=>go('equipo')}]});if(card)extSocial({k:'so:st:'+k,lvl:kind==='alert'?'urg':'imp',title:'Estación del CRM',id:card,kw:'Abrí Equipo en Vitalis para ver qué vista.',meta:'',btns:[['close','Ok',1]]})};
  const quiet=stQuiet(),dead=stRows.filter(r=>r.problem==='login'||r.problem==='cerrada'),soft=stRows.filter(r=>r.problem==='filtro'||r.problem==='sin-tabla'||r.problem==='orden');
  if(quiet)once('quiet','<b>La estación dejó de leer el CRM.</b> Fijate que el Chrome del team leader esté prendido y con Vitalis abierto.','alert','Dejó de leer el CRM');else delete stWarn.quiet;
  if(!quiet&&dead.length)once('dead:'+dead.map(r=>r.vista+r.problem).join(),`<b>La estación tiene un problema:</b> ${dead.map(r=>esc(stName(r.vista))+': '+esc(lc1(stState(r)[1]))).join(' · ')}.`,'alert',dead.some(r=>r.problem==='login')?'Quedó sin sesión del CRM':'Se cerró una pestaña');
  if(!dead.length)for(const k of Object.keys(stWarn))if(k.startsWith('dead:'))delete stWarn[k];
  const td=stRows.find(r=>r.vista==='todo');
  if(!quiet&&td&&!td.problem&&td.pager==='no')once('pager','La estación no encuentra el paginado de la lista de Clientes: sin el pase completo no se sabe quién sigue en la mesa. En el panel del CRM, "Copiar diagnóstico".','warn');
  else if(!quiet&&td&&!td.problem&&swLate(td))once('sweep','La pestaña de Clientes no hizo el pase completo en las últimas 3 h: los clientes que se fueron a otra mesa pueden seguir en las colas.','warn');
  if(!quiet&&soft.length)once('soft:'+soft.map(r=>r.vista+r.problem).join(),`La estación: ${soft.map(r=>esc(stName(r.vista))+' '+esc(lc1(stState(r)[1]))).join(' · ')}. Revisá esa pestaña en el Chrome del team leader.`,'warn');
}
