/* ============================================================
   La mesa: target del mes (lo fija el team leader), cómo viene la mesa en el inicio
   y la ficha de cada persona para el team leader (todo menos el sueldo).
   ============================================================ */
let targets={},teamAg=[],teamSh={},teamAdj={},teamDays={},mesaOk=false; // mesaOk: la base ya tiene la tabla de targets
let utargets={},utOk=false; // target individual: uid → {ym: FTDs} (cada uno ve el suyo; el team leader, los de todos)
const utOf=(uid,ym=ymNow())=>(utargets[uid]||{})[ym]||0;

/* ---------- carga ---------- */
// buscar y aplicar van separados: así el arranque lo pide todo junto y lo puede guardar para la próxima vez
async function mesaFetch(lead){
  const desde=addDays(todayS().slice(0,8)+'01',-62),N=()=>Promise.resolve(null);
  const [tg,ut,ag,sh,adj,dd]=await Promise.all([QN(sb.from('targets').select('*')),QN(sb.from('user_targets').select('user_id,ym,ftds')),
    lead?QO(sb.from('agenda').select('*').neq('user_id',me).limit(5000)):N(),
    lead?QO(sb.from('shifts').select('*').neq('user_id',me).gte('date',desde)):N(),
    lead?QO(sb.from('adjustments').select('*').neq('user_id',me)):N(),
    lead?QO(sb.rpc('team_days')):N()]);
  return {lead:!!lead,tg,ut,ag,sh,adj,dd};
}
async function loadMesa(){mesaApply(await mesaFetch(isLeader()))}
function mesaApply(x){
  mesaOk=!!x.tg;targets=Object.fromEntries((x.tg||[]).filter(r=>r.team_id===profile.team_id).map(r=>[r.ym,+r.ftds]));
  utOk=!!x.ut;utargets={};for(const r of x.ut||[])(utargets[r.user_id]||(utargets[r.user_id]={}))[r.ym]=+r.ftds;
  if(!isLeader()||!x.lead){teamAg=[];teamSh={};teamAdj={};teamDays={};return}
  const {ag,sh,adj,dd}=x;
  teamAg=ag.map(r=>({...A2P(r),uid:r.user_id}));
  teamSh={};for(const r of sh)(teamSh[r.user_id]||(teamSh[r.user_id]={}))[r.date]=shiftOf(r);
  teamAdj={};for(const r of adj)(teamAdj[r.user_id]||(teamAdj[r.user_id]={}))[r.ym]=+r.n||0;
  teamDays=Object.fromEntries(dd.map(r=>[r.user_id,{faltas:r.faltas||[],laborables:r.laborables,libres:r.libres}]));
}
const shiftOf=r=>{const t={...r.data};t.date=t.date||r.date;t.breaks=t.breaks||[];return t};
async function mesaPoll(){if(!ready||!sb)return;try{await loadMesa();refresh()}catch(e){}}
// en vivo (el team leader recibe los cambios de agenda y turnos de todos; los suyos los maneja core)
function mesaLive(table,p){
  const r=p.new||{},o=p.old||{};
  if(table==='targets'){if(p.eventType==='DELETE'){if(o.ym&&(!o.team_id||o.team_id===profile.team_id))delete targets[o.ym]}else if(r.team_id===profile.team_id)targets[r.ym]=+r.ftds;refresh();return}
  if(table==='user_targets'){if(p.eventType==='DELETE'){if(o.user_id&&utargets[o.user_id])delete utargets[o.user_id][o.ym]}else if(r.user_id)(utargets[r.user_id]||(utargets[r.user_id]={}))[r.ym]=+r.ftds;refresh();return}
  if(!isLeader())return;
  if(table==='agenda'){if(p.eventType==='DELETE'){teamAg=teamAg.filter(x=>x._id!==o.id)}else if(r.user_id!==me){teamAg=teamAg.filter(x=>x._id!==r.id);teamAg.push({...A2P(r),uid:r.user_id})}}
  else if(table==='shifts'){if(p.eventType==='DELETE'){if(o.user_id&&teamSh[o.user_id])delete teamSh[o.user_id][o.date]}else if(r.user_id!==me)(teamSh[r.user_id]||(teamSh[r.user_id]={}))[r.date]=shiftOf(r)}
  else if(table==='adjustments'){if(p.eventType==='DELETE'){if(o.user_id&&teamAdj[o.user_id])delete teamAdj[o.user_id][o.ym]}else if(r.user_id!==me)(teamAdj[r.user_id]||(teamAdj[r.user_id]={}))[r.ym]=+r.n||0}
  refresh();
}
Object.assign(B,{
  async setUTargets(ym,map){ // {uid: FTDs}; 0 = sin target
    const up=Object.entries(map).filter(([,n])=>n>0).map(([user_id,n])=>({user_id,ym,ftds:n,set_by:me,updated_at:new Date().toISOString()}));
    const del=Object.entries(map).filter(([,n])=>!(n>0)).map(([u])=>u);
    try{if(up.length)await Q(sb.from('user_targets').upsert(up,{onConflict:'user_id,ym'}));
      if(del.length)await Q(sb.from('user_targets').delete().eq('ym',ym).in('user_id',del));
      for(const r of up)(utargets[r.user_id]||(utargets[r.user_id]={}))[ym]=r.ftds;for(const u of del)if(utargets[u])delete utargets[u][ym];
      refresh();return true}
    catch(e){if(/user_targets|PGRST205|42P01/.test(String(e&&(e.message||e.code))))toast('Los targets por agente se activan en un rato (falta actualizar la base).','warn');else dbErr(e);return false}
  },
  async setTarget(ym,n){
    try{if(n)await Q(sb.from('targets').upsert({team_id:profile.team_id,ym,ftds:n,set_by:me,updated_at:new Date().toISOString()},{onConflict:'team_id,ym'}));
      else await Q(sb.from('targets').delete().eq('team_id',profile.team_id).eq('ym',ym));
      if(n)targets[ym]=n;else delete targets[ym];refresh();return true}catch(e){dbErr(e);return false}
  },
});

/* ---------- cálculos ---------- */
const tlView=()=>!!profile&&profile.role==='leader'; // el team leader no vende: su inicio es el de la mesa
function sellers(list){return members.filter(m=>m.active&&(m.role!=='leader'||list.some(f=>f.uid===m.id)))} // agentes: sin el team leader (salvo que venda)
const habil=d=>{const r=noTrabajo(d);return !r||r==='falta'}; // día hábil de la mesa (mis faltas no le cambian el mes a la mesa)
function mesaMes(ym){
  const te=todayS(),list=team.filter(f=>f.date.slice(0,7)===ym),T=targets[ym]||0;
  const [Y,M]=ym.split('-').map(Number),last=new Date(Y,M,0).getDate();
  let tot=0,pas=0;for(let d=1;d<=last;d++){const k=`${ym}-${z(d)}`;if(!habil(k))continue;tot++;if(k<=te)pas++}
  const enCurso=ym===te.slice(0,7),hh=enCurso&&habil(te),hechos=pas-(hh?1:0),quedan=enCurso?tot-hechos:ym>te.slice(0,7)?tot:0; // hoy todavía cuenta como día que queda
  const n=list.length,falta=Math.max(0,T-n),antes=list.filter(f=>f.date<te).length;
  const ritmo=enCurso?(hechos?Math.max(n,Math.round(antes/hechos*tot)):null):n; // promedio de los días hábiles ya cerrados
  const ideal=T&&tot?Math.round(T*(enCurso?pas:ym<te.slice(0,7)?tot:0)/tot):0; // dónde deberíamos cerrar hoy para ir al día
  const per=sellers(list).map(m=>({m,n:list.filter(f=>f.uid===m.id).length})).sort((a,b)=>b.n-a.n||a.m.name.localeCompare(b.m.name));
  return {list,n,T,falta,tot,pas,quedan,ritmo,ideal,enCurso,per,hoy:list.filter(f=>f.date===te).length,porDia:quedan?falta/quedan:0};
}
function targetModal(ym){
  if(!isLeader()||!mesaOk)return;
  const cur=targets[ym]||'',S=mesaMes(ym);
  modal({title:`Target de ${esc(mLong(ym))}`,body:`<label class="fld"><span>FTDs de la mesa</span><input name="t" inputmode="numeric" value="${cur}" placeholder="Ej.: 400"></label>
    <p class="note">Van ${plural(S.n,'FTD')}${S.enCurso?` y quedan ${plural(S.quedan,'día hábil','días hábiles')}`:''}. Lo ve toda la mesa en el inicio.</p><div class="ebox" id="tgE"></div>`,
    actions:[...(cur?[{l:'Quitar',cls:'danger l',fn:async()=>{if(await B.setTarget(ym,0))toast('Target quitado.')}}]:[]),{l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
      const n=Math.round(parseNum(api.q('[name=t]').value));if(!(n>0)){api.q('#tgE').textContent='Poné un número de FTDs.';return false}
      if(await B.setTarget(ym,n))toast(`Target de ${esc(mLong(ym))}: <b>${n} FTDs</b>.`);else return false}}],
    onOpen:api=>setTimeout(()=>api.q('[name=t]').select(),0)});
}
function targetBar(S){ // barra hacia el target con la marca de dónde deberíamos ir hoy
  if(!S.T)return '';
  const P=v=>Math.min(100,v/Math.max(S.T,S.n)*100),okR=S.ritmo!=null&&S.ritmo>=S.T;
  return `<div class="tg-bar" role="meter" aria-valuemin="0" aria-valuemax="${S.T}" aria-valuenow="${S.n}" aria-label="FTDs de la mesa hacia el target">
      <div class="tg-rail"><i class="tg-fill${S.n>=S.T?' done':''}" style="width:${P(S.n)}%"></i>${S.enCurso&&S.n<S.T?`<span class="tg-ideal" style="left:${P(S.ideal)}%" title="Para ir al día, hoy cerrar en ${S.ideal}"></span>`:''}</div>
      <div class="tg-leg"><span><b>${S.n}</b> de ${S.T}</span>${S.enCurso&&S.n<S.T?(S.n>=S.ideal?`<span>vamos <b>${S.n-S.ideal}</b> arriba de lo que pide el target</span>`:`<span>para ir al día, hoy hay que cerrar en <b>${S.ideal}</b></span>`):''}<span class="${S.n>=S.T||okR?'ok':'hot'}">${S.n>=S.T?'¡Target cumplido! 🧉':S.enCurso?(S.ritmo==null?'recién arranca el mes':`a este ritmo: ~${S.ritmo}`):S.quedan?'todavía no empezó':`quedaron ${S.T-S.n} abajo`}</span></div></div>`;
}

/* ---------- inicio: la mesa ---------- */
function mesaCard(){
  const ym=ymNow(),S=mesaMes(ym),mes=MES[+ym.slice(5,7)-1],te=todayS(),pos=S.per.findIndex(p=>p.m.id===me),mio=S.per[pos];
  const ws=weekStart(te),sem=team.filter(f=>f.date>=ws&&f.date<=te).length,pw=addDays(ws,-7),semP=team.filter(f=>f.date>=pw&&f.date<=addDays(te,-7)).length;
  const hoyUsd=S.list.filter(f=>f.date===te).reduce((a,f)=>a+(+f.amount||0),0);
  const head=`<div class="card-h"><h3>La mesa</h3><span class="p-sub">${esc(cap(mes))}</span><span class="grow"></span>${isLeader()&&mesaOk?`<button type="button" class="btn sm" data-act="target">${S.T?'Cambiar target':'Fijar target'}</button>`:''}</div>`;
  const big=`<div class="ms-big"><div class="n">${S.n}</div><div class="lab">FTDs de la mesa${S.T?` · target <b>${S.T}</b>`:''}</div>
    <div class="msg">${S.T?(S.falta?`Faltan <b>${S.falta}</b>${S.enCurso&&S.quedan?` · <b>${nf(S.porDia,1)}</b> por día en ${plural(S.quedan,'día hábil','días hábiles')}`:''}`:'<b>¡Target cumplido!</b> Esto merece un mate 🧉'):!mesaOk?'':isLeader()?'Fijá el target del mes para que la mesa vea cuánto falta.':'El team leader todavía no fijó el target del mes.'}</div></div>`;
  const k=(lb,v,s2)=>`<div class="ms-k"><div class="lb">${esc(lb)}</div><div class="v">${v}</div><div class="s">${s2}</div></div>`;
  const kp=k('Hoy',`${S.hoy}`,`${money(hoyUsd)} USD`)+k('Esta semana',`${sem}`,`la pasada a esta altura: ${semP}`)+
    (mio?k('Tu aporte',`${mio.n}`,S.n?`${pct(mio.n/S.n)} de la mesa`:'—')+k('Tu puesto',mio.n?`${pos+1}º`:'—',`de ${S.per.length}`):'');
  const top=S.per.filter(p=>p.n).slice(0,5);
  const podio=top.length?`<div class="ms-top">${top.map((p,i)=>`<button type="button" class="ms-p${p.m.id===me?' mine':''}" data-prof="${esc(p.m.id)}" title="Ver el perfil de ${esc(p.m.name)}"><span class="ps">${i+1}</span>${avatar(p.m.name)}<span class="nm">${esc(p.m.name.split(/\s+/)[0])}</span><b>${p.n}</b></button>`).join('')}</div>`:'';
  return head+`<div class="ms-grid">${big}<div class="ms-kpis">${kp}</div></div>${targetBar(S)}${podio}`;
}

/* ---------- equipo: target y ficha de cada persona ---------- */
function eqTargetCard(ym){
  if(!mesaOk)return `<div class="card-h" style="margin:0"><h3>Target de ${esc(mLong(ym))}</h3><span class="p-sub">falta actualizar la base para poder fijarlo</span></div>`;
  const S=mesaMes(ym);
  return `<div class="card-h"><h3>Target de ${esc(mLong(ym))}</h3><span class="p-sub">${S.T?(S.falta?`faltan ${S.falta}${S.enCurso&&S.quedan?` · ${nf(S.porDia,1)} por día hábil`:''}`:'cumplido'):'sin fijar'}</span><span class="grow"></span>${utOk?`<button type="button" class="btn sm" data-act="utargets" data-ym="${ym}">Por agente</button>`:''}<button type="button" class="btn sm pri" data-act="target" data-ym="${ym}">${S.T?'Cambiar':'Fijar target'}</button></div>`+
    (S.T?targetBar(S):`<p class="p-sub" style="margin:0">Fijá cuántos FTDs tiene que hacer la mesa este mes. Lo ven todos en el inicio.</p>`);
}
function turnoHoy(uid){ // estado del turno de hoy de alguien
  const t=uid===me?(openTurno()||turnos[todayS()]):((teamSh[uid]||{})[todayS()]);
  if(!t||!t.in)return {txt:'—',cls:'dim'};
  if(t.out)return {txt:`salió ${hhmm(t.out)}`,cls:'dim'};
  const b=t.breaks.find(x=>!x.e);if(b)return {txt:`descanso desde ${hhmm(b.s)}`,cls:'warn'};
  return {txt:`en turno desde ${hhmm(t.in)}`,cls:'ok'};
}
function agOf(uid){return uid===me?pend:teamAg.filter(p=>p.uid===uid)}
function agStats(uid){const now=new Date(),te=todayS(),L=agOf(uid).filter(p=>!p.done);return {hoy:L.filter(p=>p.due.slice(0,10)===te).length,venc:L.filter(p=>parseDue(p.due)<=now).length,open:L.length}}
function fichaModal(uid,tab='mes'){
  if(!isLeader())return;
  const m=members.find(x=>x.id===uid);if(!m)return;
  const ym=ymNow(),te=todayS(),mFrom=ym+'-01';
  const L=team.filter(f=>f.uid===uid&&f.date.slice(0,7)===ym),extra=uid===me?(ajustes[ym]||0):((teamAdj[uid]||{})[ym]||0);
  const sh=uid===me?turnos:(teamSh[uid]||{}),days=uid===me?{faltas:cfg.faltas||[]}:(teamDays[uid]||{faltas:[]});
  const draw=(api,t)=>{
    api.box.querySelectorAll('#fiTabs [data-t]').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
    const el=api.q('#fiBody');
    if(t==='mes'){
      const cv=convPeriod(mFrom,te,uid),late=L.filter(isLate).length,dias=new Set(L.map(f=>f.date)).size,fal=(days.faltas||[]).filter(x=>x.d.slice(0,7)===ym);
      const k=(lb,v,s2)=>`<div class="kpi"><div class="lb">${esc(lb)}</div><div class="v">${v}</div><div class="s">${s2}</div></div>`;
      el.innerHTML=`<div class="pf-k">${k('FTDs del mes',L.length+extra,extra?`${L.length} cargados + ${extra} sin detalle`:`${late} late · ${L.length-late} new`)}${k('Depositado',esc(money(L.reduce((a,f)=>a+(+f.amount||0),0))),'USD')}${k('Conversión',cv.rate==null?'—':esc(pct(cv.rate)),`${plural(cv.ftd,'FTD')} de ${plural(cv.leads,'cliente new','clientes new')}`)}
        ${k('Días con ventas',dias,`de ${plural(mesaMes(ym).pas,'día hábil','días hábiles')}`)}${k('Faltas',fal.length,fal.length?fal.map(x=>`${dm(x.d)}${x.j?' (just.)':''}`).join(', '):'ninguna este mes')}${k('Hoy',L.filter(f=>f.date===te).length,esc(turnoHoy(uid).txt))}${(()=>{const t=utOf(uid,ym),n=L.length+extra;return t?k('Target',`${n} de ${t}`,n>=t?'cumplido':`faltan ${t-n}`):''})()}</div>
        <div class="pf-ch"><div class="lb">FTDs por día <span class="pf-lg"><span class="sw"></span>new <span class="sw s2"></span>late</span></div><div id="fiChart"></div></div>
        <div class="fi-acts"><button type="button" class="btn sm" data-fi="ventas">Ver sus ventas</button></div>`;
      const [Y,M]=ym.split('-').map(Number),n=new Date(Y,M,0).getDate(),data=[];
      for(let d=1;d<=n;d++){const k2=`${ym}-${z(d)}`,l=L.filter(f=>f.date===k2),dw=new Date(Y,M-1,d).getDay();data.push({lab:String(d),d,dw,a:l.filter(f=>!isLate(f)).length,b:l.filter(isLate).length,m:l.reduce((s,f)=>s+(+f.amount||0),0),labC:dw===0||dw===6?'color-mix(in srgb,var(--dim) 55%,transparent)':''})}
      colChart(api.q('#fiChart'),data,{h:150,int:true,minTop:3,capMin:14,label:'FTDs por día',empty:'Sin FTDs este mes.',
        tip:d=>({title:`${DIAL[d.dw]} ${z(d.d)}/${z(M)}`,rows:[{v:String(d.a+d.b),l:'FTDs'},{key:'var(--s1)',v:String(d.a),l:'new'},{key:'var(--s2)',v:String(d.b),l:'late'},{v:money(d.m),l:'USD'}]})});
    }else if(t==='agenda'){
      const now=new Date(),A=agOf(uid),open=A.filter(p=>!p.done).sort(byDue),hechos=A.filter(p=>p.done&&p.doneAt&&p.doneAt.slice(0,7)===ym).length;
      const it=p=>{const d=parseDue(p.due),v=d<=now;return `<div class="fi-it${v?' hot':''}"><span class="wh">${esc(whenTxt(d))}</span><b>${esc(p.id)}</b><span class="dim">${esc(p.kw)}</span>${v?'<span class="badge bad">vencido</span>':''}</div>`};
      el.innerHTML=`<p class="p-sub">${plural(open.length,'contacto pendiente','contactos pendientes')} · ${plural(open.filter(p=>parseDue(p.due)<=now).length,'vencido')} · ${plural(hechos,'hecho')} este mes</p>`+
        (open.length?`<div class="fi-list">${open.slice(0,60).map(it).join('')}</div>`:'<div class="p-empty">Nada pendiente.</div>');
    }else if(t==='turnos'){
      const rows=Object.values(sh).filter(x=>x.date&&x.date.slice(0,7)===ym&&x.in).sort((a,b)=>a.date<b.date?1:-1);
      const tot=rows.reduce((a,x)=>a+((x.out||(x.date===te?Date.now():x.in))-x.in),0);
      el.innerHTML=`<p class="p-sub">${plural(rows.length,'día trabajado','días trabajados')} este mes · ${esc(dur(tot))} en total</p>`+(rows.length?`<table class="pt"><thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th class="r">Horas</th><th class="r">Descansos</th></tr></thead><tbody>${rows.map(x=>{
        const end=x.out||(x.date===te?Date.now():null),br=x.breaks||[],bm=br.reduce((a,b)=>a+((b.e||end||b.s)-b.s),0);
        return `<tr><td>${esc(DIA[parseYMD(x.date).getDay()])} ${dm(x.date)}</td><td>${hhmm(x.in)}</td><td>${x.out?hhmm(x.out):x.date===te?'<span class="ok">en turno</span>':'—'}</td><td class="r">${end?esc(durS(end-x.in)):'—'}</td><td class="r">${br.length?`${br.length} · ${esc(dur(bm))}`:'—'}</td></tr>`}).join('')}</tbody></table>`:'<div class="p-empty">Sin turnos marcados este mes.</div>');
    }else if(t==='clientes'){
      const C=leads.filter(l=>leadOwner(l)===uid&&l.date.slice(0,7)===ym).sort((a,b)=>a.date<b.date?1:-1),hoy=C.filter(l=>l.date===te).length,cv=convPeriod(te,te,uid);
      el.innerHTML=`<p class="p-sub">${plural(C.length,'cliente new','clientes new')} este mes · ${hoy} hoy${cv.rate!=null?` · conversión de hoy ${pct(cv.rate)}`:''}</p>`+
        (C.length?`<table class="pt"><thead><tr><th>Día</th><th>ID</th><th>Nombre</th><th>País</th></tr></thead><tbody>${C.slice(0,80).map(l=>`<tr><td>${dm(l.date)}</td><td><b>${esc(l.id)}</b></td><td>${esc(l.name)}</td><td>${esc(l.country)}</td></tr>`).join('')}</tbody></table>`:'<div class="p-empty">Sin clientes new este mes.</div>');
    }else if(t==='tareas'){
      const rows=taskPeople.filter(p=>p.user_id===uid).map(p=>({p,t:taskOf(p.task_id)})).filter(x=>x.t).sort((a,b)=>(!!a.p.done_at-!!b.p.done_at)||b.t.t-a.t.t);
      el.innerHTML=rows.length?`<div class="fi-list">${rows.slice(0,40).map(({p,t})=>`<div class="fi-it"><span class="wh">${esc(tkWhen(t.at))}</span><b>${esc(clip(taskTxt(t),90))}</b>${p.done_at?`<span class="badge">hecha ${esc(tkWhen(p.done_at))}</span>`:`<span class="badge bad">pendiente</span>`}</div>`).join('')}</div>`:'<div class="p-empty">No tiene tareas.</div>';
    }
  };
  const tabs=[['mes','Mes'],['agenda','Agenda'],['turnos','Turnos'],['clientes','Clientes'],['tareas','Tareas']];
  modal({title:'Ficha',wide:true,body:`<div class="pf"><div class="pf-h">${avatar(m.name,'xl')}<div><h2>${esc(m.name)}</h2><p>${esc(roleTxt(m.role))} · ${esc(mLong(ym))} · ${esc(turnoHoy(uid).txt)}</p></div></div>
      <span class="seg fi-tabs" id="fiTabs">${tabs.map(([k,l])=>`<button type="button" data-t="${k}">${l}</button>`).join('')}</span><div id="fiBody" class="fi-body"></div>
      <p class="note">El sueldo de cada uno es privado: acá no aparece.</p></div>`,
    onOpen:api=>{draw(api,tab);api.box.addEventListener('click',e=>{const b=e.target.closest('#fiTabs [data-t]');if(b)return draw(api,b.dataset.t);
      if(e.target.closest('[data-fi=ventas]')){api.close();go('ventas',{who:uid===me?'me':uid,f:{desde:ym,hasta:ym}})}})}});
}

/* ---------- inicio del team leader: la mesa entera ---------- */
function targetTrack(S){ // la pista del hero con el target: el mate avanza con la mesa
  if(!S.T)return '';
  const top=Math.max(S.T*1.05,S.n+1),P=v=>Math.min(100,v/top*100),M=[.25,.5,.75,1].map(q=>[Math.round(S.T*q),q]);
  return `<div class="track" role="meter" aria-valuemin="0" aria-valuemax="${S.T}" aria-valuenow="${S.n}" aria-label="FTDs de la mesa hacia el target">
    <div class="rail"></div><div class="fill" style="width:${P(S.n)}%"></div>
    ${S.enCurso&&S.n<S.T&&S.ideal?`<i class="ideal" style="left:${P(S.ideal)}%" title="Para ir al día, hoy hay que cerrar en ${S.ideal}"></i>`:''}
    ${M.map(([t])=>`<i class="st${S.n>=t?' on':''}" style="left:${P(t)}%"></i>`).join('')}
    ${M.map(([t,q])=>`<span class="lb${q===1?' at':''}" style="left:${P(t)}%"><b>${t}</b><span class="us">${q===1?'target':pct(q)}</span></span>`).join('')}
    <span class="mate" style="left:${P(S.n)}%" title="${plural(S.n,'FTD')}"><svg aria-hidden="true"><use href="#mate"/></svg></span></div>`;
}
function mesaHero(){
  const ym=ymNow(),S=mesaMes(ym),mes=MES[+ym.slice(5,7)-1],usd=S.list.reduce((a,f)=>a+(+f.amount||0),0),con=S.per.filter(p=>p.n).length;
  const msg=S.T?(S.falta?`Faltan <b>${S.falta}</b> para el target de <b>${S.T}</b>${S.enCurso&&S.quedan?` · <b>${nf(S.porDia,1)}</b> por día hábil`:''}`:'<b>¡Target cumplido!</b> Esto merece un mate 🧉')
    :mesaOk?'Fijá el target del mes para que la mesa vea cuánto falta.':'Los FTDs de toda la mesa, al día.';
  const btn=mesaOk?`<button type="button" class="hb" data-act="target">${S.T?'Cambiar target':'Fijar target'}</button>`:'';
  return `<div class="top"><div><div class="n">${S.n}</div><div class="lab">FTDs de la mesa en ${esc(mes)}</div><div class="msg">${msg}</div></div><span class="grow"></span>
    <div class="usd"><div class="v">${money(usd)} <small>USD</small></div><div class="s">${plural(con,'agente')} con ventas de ${S.per.length}${S.enCurso&&S.T&&S.ritmo!=null?` · a este ritmo ~${S.ritmo}`:''}</div>${btn}</div></div>${targetTrack(S)}`;
}
function mesaSide(){
  const te=todayS(),ym=ymNow(),S=mesaMes(ym),hoy=S.list.filter(f=>f.date===te),ws=weekStart(te),pw=addDays(ws,-7);
  const wN=team.filter(f=>f.date>=ws&&f.date<=te).length,pwN=team.filter(f=>f.date>=pw&&f.date<=addDays(te,-7)).length;
  const st=S.per.map(p=>turnoHoy(p.m.id).cls),enT=st.filter(c=>c==='ok'||c==='warn').length,desc=st.filter(c=>c==='warn').length;
  return kpi('En turno ahora',`${enT} <small>de ${S.per.length}</small>`,desc?`${plural(desc,'en descanso','en descanso')}`:'nadie en descanso','click',' data-go="equipo" title="Ver equipo"')+
    kpi('Hoy',`${hoy.length} <small>FTD${hoy.length===1?'':'s'}</small>`,`${money(hoy.reduce((a,f)=>a+(+f.amount||0),0))} USD · ${plural(new Set(hoy.map(f=>f.uid)).size,'agente')}`)+
    kpi('Esta semana',`${wN} <small>FTD${wN===1?'':'s'}</small>`,`A esta altura la semana pasada: ${pwN}`);
}
function mesaBoard(){ // la mesa hoy: cada agente con su turno, sus FTDs y su agenda
  const ym=ymNow(),te=todayS(),S=mesaMes(ym);
  const rows=S.per.map(p=>{const th=turnoHoy(p.m.id),ag=agStats(p.m.id),h=S.list.filter(f=>f.uid===p.m.id&&f.date===te).length;
    return `<button type="button" class="mb-r${p.m.id===me?' mine':''}" data-act="ficha" data-uid="${esc(p.m.id)}" title="Ver la ficha de ${esc(p.m.name)}">${avatar(p.m.name)}
      <span class="who"><span class="nm">${esc(p.m.name)}</span><span class="st ${th.cls}">${esc(th.txt==='—'?'sin entrada':th.txt)}</span></span>
      <span class="ag">${ag.venc?`<span class="hot b">${ag.venc} venc.</span>`:ag.open?`${ag.open} en agenda`:''}</span>
      <span class="c"><b>${h}</b><small>hoy</small></span><span class="c"><b>${p.n}</b><small>${utOf(p.m.id,ym)?'de '+utOf(p.m.id,ym):'mes'}</small></span></button>`}).join('');
  return `<div class="card-h"><h3>La mesa hoy</h3><span class="p-sub">${plural(S.per.length,'agente')} · tocá uno para ver su ficha</span><span class="grow"></span><button type="button" class="btn sm" data-go="equipo">Equipo</button></div>`+
    (rows?`<div class="mboard">${rows}</div>`:'<div class="p-empty">Todavía no hay agentes en la mesa.</div>');
}

/* ---------- inicio: las ventas de hoy de toda la mesa (en vivo) ---------- */
let hoyAll=false;
function hoyMesaCard(){
  const te=todayS(),L=team.filter(f=>f.date===te).sort((a,b)=>-byDate(a,b)),usd=L.reduce((a,f)=>a+(+f.amount||0),0),ag=new Set(L.map(f=>f.uid)).size;
  const per={};for(const f of L)per[f.uid]=(per[f.uid]||0)+1;
  const lead=Object.entries(per).sort((a,b)=>b[1]-a[1])[0];
  const head=`<div class="card-h"><h3>Ventas de hoy</h3><span class="p-sub">${L.length?`toda la mesa · ${plural(L.length,'FTD')} · ${esc(money(usd))} USD · ${plural(ag,'agente')}${lead&&lead[1]>1?` · ${esc(first(lead[0]))} va primero con ${lead[1]}`:''}`:'toda la mesa'}</span><span class="grow"></span>${L.length?`<button type="button" class="btn sm" data-act="hoyVentas">Ver en Ventas</button>`:''}</div>`;
  if(!L.length)return head+'<div class="p-empty">Todavía no hay ventas hoy. La primera pone el mate en marcha 🧉</div>';
  const show=hoyAll?L:L.slice(0,12);
  return head+`<div class="hv">${show.map(f=>{const nm=memberName(f.uid),mine=f.uid===me;
    return `<div class="hv-r${mine?' mine':''}"><span class="t">${esc(f.time||'—')}</span><button type="button" class="who-cell lnkp" data-prof="${esc(f.uid)}" title="Ver el perfil de ${esc(nm)}">${avatar(nm)}<span>${esc(mine?'Vos':nm.split(/\s+/)[0])}</span></button>
      <span class="n" title="${esc(f.name)}${f.camp?' · '+esc(f.camp):''}"><b>${esc(f.id)}</b> ${esc(f.name)}<small>${esc(f.country)}${f.camp?' · '+esc(f.camp):''}</small></span><span class="m">${esc(money(f.amount))}</span><span class="b">${tipoBadge(f)}</span></div>`}).join('')}</div>`+
    (L.length>12?`<button type="button" class="btn sm hv-more" data-act="hoyMas">${hoyAll?'Ver menos':`Ver las ${L.length}`}</button>`:'');
}

/* ---------- target individual (lo fija el team leader; cada uno ve el suyo) ---------- */
function diasQuedan(){ // mis días de trabajo que quedan en el mes (hoy incluido)
  const te=todayS(),[Y,M]=te.split('-').map(Number),last=new Date(Y,M,0).getDate();let n=0;
  for(let d=+te.slice(8);d<=last;d++)if(!noTrabajo(`${te.slice(0,7)}-${z(d)}`))n++;return n;
}
function utLine(n){ // en tu inicio: cómo venís con tu target
  const T=utOf(me);if(!T)return '';
  const q=diasQuedan(),f=T-n;
  return `<div class="msg ut">Tu target: <b>${T} FTDs</b> · ${f>0?`faltan <b>${f}</b>${q?` · <b>${nf(f/q,1)}</b> por día`:''}`:'<b>¡cumplido!</b> 🎯'}</div>`;
}
function utModal(ym,focus){ // el team leader fija el target de cada uno
  if(!isLeader())return;
  if(!utOk)return toast('Los targets por agente se activan en un rato (falta actualizar la base).','warn');
  const list=team.filter(f=>f.date.slice(0,7)===ym),P=sellers(list).filter(m=>m.role!=='leader'||list.some(f=>f.uid===m.id)).sort((a,b)=>a.name.localeCompare(b.name)),T=targets[ym]||0,mes=MES[+ym.slice(5,7)-1];
  let sum=()=>{};
  const row=m=>{const n=list.filter(f=>f.uid===m.id).length,t=utOf(m.id,ym);
    return `<label class="ut-r">${avatar(m.name)}<span class="nm">${esc(m.name)}<small>${plural(n,'FTD')} en ${esc(mes)}</small></span><input data-ut="${esc(m.id)}" inputmode="numeric" maxlength="5" value="${t||''}" placeholder="—" aria-label="Target de ${esc(m.name)}"></label>`};
  modal({title:`Targets de ${esc(mLong(ym))}`,wide:1,body:`<p class="mp">Cuántos FTDs tiene que hacer cada uno en el mes. Cada uno ve el suyo en el inicio. Vacío = sin target.</p><div class="ut-list">${P.map(row).join('')}</div><div class="ut-sum" id="utSum"></div>`,
    actions:[...(T&&P.length?[{l:'Repartir el de la mesa',cls:'l',fn:api=>{const I=[...api.box.querySelectorAll('[data-ut]')],b=Math.floor(T/I.length),r=T-b*I.length;I.forEach((i,k)=>{i.value=b+(k<r?1:0)});sum();return false}}]:[]),
      {l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
        const map={};for(const i of api.box.querySelectorAll('[data-ut]')){const v=Math.max(0,Math.round(parseNum(i.value)||0));if(v!==utOf(i.dataset.ut,ym))map[i.dataset.ut]=v}
        if(!Object.keys(map).length)return;
        if(await B.setUTargets(ym,map))toast(`Targets de ${esc(mLong(ym))} guardados.`);else return false}}],
    onOpen:api=>{
      sum=()=>{let s_=0,c=0;for(const i of api.box.querySelectorAll('[data-ut]')){const v=Math.round(parseNum(i.value)||0);if(v>0){s_+=v;c++}}
        api.q('#utSum').innerHTML=`${plural(c,'agente')} con target · suman <b>${s_}</b>${T?` de los <b>${T}</b> de la mesa${s_<T?` · faltan ${T-s_}`:s_>T?` · ${s_-T} de más`:' · justo'}`:''}`};
      api.box.addEventListener('input',e=>{if(e.target.matches('[data-ut]'))sum()});sum();
      setTimeout(()=>{const f=(focus&&api.q(`[data-ut="${CSS.escape(focus)}"]`))||api.q('[data-ut]');if(f){f.focus();f.select()}},0)}});
}
const utCell=(uid,ym,n)=>{const t=utOf(uid,ym);return `<button type="button" class="ut-c${t?(n>=t?' ok':''):' none'}" data-act="utargets" data-ym="${ym}" data-uid="${esc(uid)}" title="${t?'Cambiar el target':'Fijar un target'}">${t?`${n}/${t}<i style="width:${Math.min(100,n/t*100)}%"></i>`:'Fijar'}</button>`};
