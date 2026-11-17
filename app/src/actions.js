
/* ============================================================
   Acciones: ventas, sin detalle, agenda, turno, CSV, avisos
   ============================================================ */
const uniq=fn=>[...new Set(ftds.map(fn).filter(Boolean).map(String))].sort((a,b)=>a.localeCompare(b));
const dlist=(id,vals)=>`<datalist id="${id}">${vals.map(v=>`<option value="${esc(v)}">`).join('')}</datalist>`;
const tipoBadge=f=>isLate(f)?`<span class="badge late">late ${lateDays(f)} d</span>`:'<span class="badge new">new</span>';
const noRO=()=>{if(readOnly){toast('Solo lectura.','err');return false}return true};

/* ---------- venta: nueva / editar ---------- */
function ftdForm(f){
  if(!ready||!noRO())return;
  const isNew=!f,te=todayS();
  const r=f?{...f}:{date:te,time:nowHM(),brand:last.brand||DEF_BRAND,country:last.country||'',aff:last.aff||'',camp:last.camp||'',reg:te};
  const reg=String(r.reg||r.date),regD=reg.slice(0,10),regT=reg.slice(11,16);
  const v=k=>esc(r[k]??'');
  const body=`<div class="fgrid">
    <label class="fld"><span>Marca</span><input name="brand" list="dlB" value="${v('brand')}"></label>
    <label class="fld"><span>ID <i>*</i></span><input name="id" value="${v('id')}" autofocus></label>
    <label class="fld full"><span>Full Name <i>*</i></span><input name="name" value="${v('name')}"></label>
    <label class="fld"><span>Country</span><input name="country" list="dlC" value="${v('country')}"></label>
    <label class="fld"><span>Amount USD <i>*</i></span><input name="amount" inputmode="decimal" value="${f?esc(String(f.amount).replace('.',',')):''}"></label>
    <label class="fld"><span>Affiliate</span><input name="aff" list="dlA" value="${v('aff')}"></label>
    <label class="fld"><span>Campaign</span><input name="camp" list="dlK" value="${v('camp')}"></label>
    <div class="fld"><span>Fecha FTD</span><div class="frow" style="flex-wrap:nowrap"><input type="date" name="date" max="${te}" value="${v('date')}" style="flex:1" aria-label="Fecha FTD"><input type="time" name="time" value="${v('time')}" aria-label="Hora FTD"></div></div>
    <div class="fld"><span>Registro</span><div class="frow" style="flex-wrap:nowrap"><input type="date" name="regD" max="${te}" value="${esc(regD)}" style="flex:1" aria-label="Fecha de registro"><input type="time" name="regT" value="${esc(regT)}" aria-label="Hora de registro"></div></div>
    <div class="full frow" style="align-items:center"><span class="chips">${[['mismo día',0],['ayer',1],['-2 días',2],['-7 días',7]].map(([l,n])=>`<button type="button" class="chip" data-reg="${n}">${l}</button>`).join('')}</span><span style="flex:1"></span><span id="fTipo"></span></div>
    <label class="fld full"><span>Transacción</span><input name="tx" value="${v('tx')}"></label>
  </div><div class="wbox" id="fDup" hidden></div><div class="ebox" id="fErr"></div>
  ${dlist('dlB',[...new Set([DEF_BRAND,'Trade24Seven',...uniq(x=>x.brand)])])}${dlist('dlC',uniq(x=>x.country))}${dlist('dlA',uniq(x=>x.aff))}${dlist('dlK',uniq(x=>x.camp))}`;
  let dupOk='';
  const read=api=>{
    const g=n=>api.q(`[name=${n}]`).value.trim();
    const rec={brand:g('brand'),id:g('id'),name:g('name'),country:g('country'),aff:g('aff'),camp:g('camp'),date:g('date'),time:g('time'),tx:g('tx')||undefined};
    const amt=parseAmount(g('amount'));
    if(!rec.id)return {err:'Falta el ID.',k:'id'};
    if(!rec.name)return {err:'Falta el nombre.',k:'name'};
    if(isNaN(amt))return {err:'Monto inválido.',k:'amount'};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(rec.date))return {err:'Fecha inválida.',k:'date'};
    if(rec.date>todayS())return {err:'La fecha del FTD no puede ser futura.',k:'date'};
    const rd=g('regD')||rec.date;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(rd))return {err:'Registro inválido.',k:'regD'};
    if(rd>rec.date)return {err:'El registro no puede ser posterior al FTD.',k:'regD'};
    rec.reg=rd+(g('regT')?' '+g('regT'):'');rec.amount=amt;
    if(!rec.camp)rec.camp='';
    return {rec};
  };
  const tipo=api=>{const d=api.q('[name=date]').value,rd=api.q('[name=regD]').value||d;api.q('#fTipo').innerHTML=d?tipoBadge({date:d,reg:rd}):'';
    $$('[data-reg]',api.box).forEach(c=>c.classList.toggle('on',!!d&&rd===addDays(d,-c.dataset.reg)))};
  const save=async(api,again)=>{
    $$('input.bad',api.box).forEach(x=>x.classList.remove('bad'));api.q('#fErr').textContent='';
    const R=read(api);
    if(R.err){api.q('#fErr').textContent=R.err;const el=api.q(`[name=${R.k}]`);el.classList.add('bad');el.focus();return false}
    const rec=R.rec,key=norm(rec.id)+'|'+norm(rec.brand);
    const dup=team.find(x=>x._id!==(f&&f._id)&&norm(x.id)===norm(rec.id)&&norm(x.brand||'')===norm(rec.brand||''));
    if(dup&&dupOk!==key){dupOk=key;const w=api.q('#fDup');w.hidden=false;w.innerHTML=`⚠ Ya existe un FTD de ${esc(rec.brand)} con ID <b>${esc(rec.id)}</b> (${dm(dup.date)} · ${esc(dup.name)}${dup.uid!==me?' · lo cargó '+esc(memberName(dup.uid)):''}). Guardá de nuevo para cargarlo igual.`;return false}
    if(isNew){if(!await commitNew(rec))return false}
    else{if(!await B.updFtd(f,rec))return false;toast(`✔ FTD #${f.n} actualizado · <b>${esc(rec.id)}</b> · ${esc(rec.name)}`)}
    if(again){ // seguir cargando: limpia lo propio de la venta, mantiene marca/país/afiliado/campaña
      for(const n of ['id','name','amount','tx'])api.q(`[name=${n}]`).value='';
      api.q('[name=time]').value=nowHM();api.q('[name=regD]').value=api.q('[name=date]').value;api.q('[name=regT]').value='';
      api.q('#fDup').hidden=true;dupOk='';tipo(api);api.q('[name=id]').focus();return false;
    }
  };
  const acts=isNew?[{l:'cancelar'},{l:'guardar y otra',fn:api=>save(api,true)},{l:'guardar',cls:'pri',fn:api=>save(api)}]
    :[{l:'borrar',cls:'danger l',fn:async()=>{await borrarFtd(f)}},{l:'cancelar'},{l:'guardar',cls:'pri',fn:api=>save(api)}];
  modal({title:isNew?`<span class="u">${esc(who())}@vitalis</span>:<span class="w">~</span>$ nuevo FTD`:`<span class="u">${esc(who())}@vitalis</span>:<span class="w">~</span>$ editar FTD #${f.n}${f.uid!==me?' · '+esc(memberName(f.uid)):''}`,body,actions:acts,wide:1,
    onOpen(api){
      tipo(api);
      api.box.addEventListener('input',e=>{if(['date','regD'].includes(e.target.name))tipo(api);if(e.target.name==='id'||e.target.name==='brand'){api.q('#fDup').hidden=true;dupOk=''}});
      api.box.addEventListener('click',e=>{const c=e.target.closest('[data-reg]');if(!c)return;const d=api.q('[name=date]').value||todayS();api.q('[name=regD]').value=addDays(d,-c.dataset.reg);if(c.dataset.reg==='0')api.q('[name=regT]').value='';tipo(api)});
      if(!isNew)setTimeout(()=>api.q('[name=amount]').focus(),0);
    }});
}
async function commitNew(rec){
  rec.n=nextN();
  last={brand:rec.brand,country:rec.country,aff:rec.aff,camp:rec.camp};local.set('last',last);
  const ym=rec.date.slice(0,7),before=calc(ym);
  if(!await B.addFtd(rec))return false;
  const s=calc(ym);
  toast(`✔ FTD #${rec.n} · <b>${esc(rec.id)}</b> · ${esc(rec.name)} · ${money(rec.amount)} USD${isLate(rec)?' · '+sp('warn','late '+lateDays(rec)+' d'):''}<br><span class="dim">${esc(mLong(ym))}: ${plural(s.n,'FTD')} · ${money(s.usd)} USD${s.next?' · '+progressTxt(s):''}</span>`);
  if(s.tier>before.tier){toast(`🎉 ¡${s.n} FTDs! Bono de ${s.bono} USD desbloqueado.`,'alert',{ms:9000});beep(2)}
  return true;
}
async function borrarFtd(f){
  if(!noRO())return false;
  if(!await confirmar('Borrar venta',`¿Borrar FTD #${f.n} · ${dm(f.date)}/${f.date.slice(0,4)} · <b>${esc(f.id)}</b> · ${esc(f.name)} · ${money(f.amount)} USD?`,'borrar',true))return false;
  if(!await B.delFtd(f))return false;
  toast(`✔ FTD #${f.n} borrado.`);return true;
}

/* ---------- FTDs sin detalle ---------- */
async function setAjusteN(ym,n){
  if(!noRO())return false;
  n=Math.max(0,Math.min(999,Math.round(+n||0)));const cur=ajustes[ym]||0;if(n===cur){refresh();return true}
  const before=calc(ym);if(!await B.setAjuste(ym,n))return false;
  const s=calc(ym);
  toast(`✔ ${esc(mLong(ym))}: ${plural(n,'FTD')} sin detalle → <b>${plural(s.n,'FTD')}</b> · ${money(s.usd)} USD`,'ok',{key:'aj'});
  if(s.tier>before.tier){toast(`🎉 Bono de ${s.bono} USD desbloqueado (${s.tier}+ FTDs).`,'alert',{ms:9000});beep(2)}
  return true;
}
function ajusteModal(ym){
  if(!noRO())return;
  const cur=ajustes[ym]||0;
  const body=`<div class="rows">
    <div class="rw"><span class="k">Cargados</span><span class="d"></span><span class="v">${calc(ym).loaded}</span></div>
    <div class="rw"><span class="k">Sin detalle</span><span class="d"></span><span class="v"><span class="step"><button type="button" data-d="-1" aria-label="menos">−</button><input type="number" id="ajN" min="0" max="999" value="${cur}" aria-label="FTDs sin detalle"><button type="button" data-d="1" aria-label="más">+</button></span></span></div>
    <div class="rw tot hl"><span class="k">Total</span><span class="d"></span><span class="v" id="ajTot"></span></div></div>`;
  modal({title:`FTDs sin detalle · ${esc(mLong(ym))}`,body,actions:[{l:'cancelar'},{l:'guardar',cls:'pri',fn:api=>setAjusteN(ym,api.q('#ajN').value).then(ok=>ok?undefined:false)}],
    onOpen(api){
      const inp=api.q('#ajN'),upd=()=>{const n=calc(ym).loaded+Math.max(0,+inp.value||0),s=porCantidad(n);api.q('#ajTot').textContent=`${plural(n,'FTD')} · ${money(s.usd)} USD`};
      api.box.addEventListener('click',e=>{const b=e.target.closest('[data-d]');if(!b)return;inp.value=Math.max(0,(+inp.value||0)+ +b.dataset.d);upd()});
      inp.addEventListener('input',upd);upd();setTimeout(()=>inp.select(),0);
    }});
}

/* ---------- agenda ---------- */
const dueStr=d=>`${ymd(d)}T${z(d.getHours())}:${z(d.getMinutes())}`;
const byDue=(a,b)=>a.due<b.due?-1:a.due>b.due?1:0;
function suggestTime(date){ // hora por defecto; si ya pasó hoy, la próxima media hora
  if(date!==todayS())return cfg.hora;
  const d=new Date();if(nowHM()<cfg.hora)return cfg.hora;
  d.setMinutes(d.getMinutes()+30-(d.getMinutes()%30)+30,0,0);return `${z(d.getHours())}:${z(d.getMinutes())}`;
}
function agFields(p){
  const d=p?p.due.slice(0,10):addDays(todayS(),1),t=p?p.due.slice(11,16):cfg.hora;
  return `<div class="frow">
    <label class="fld" style="flex:1 1 120px"><span>ID</span><input name="pid" value="${esc(p?p.id:'')}"></label>
    <label class="fld" style="flex:3 1 200px"><span>Palabra clave</span><input name="kw" value="${esc(p?p.kw:'')}"></label>
    <label class="fld" style="flex:0 1 150px"><span>Fecha</span><input type="date" name="pdate" value="${d}"></label>
    <label class="fld" style="flex:0 1 104px"><span>Hora</span><input type="time" name="ptime" value="${t}"></label>
    ${p?'':'<button type="submit" class="btn pri">agendar</button>'}</div>
    <div class="chips" style="margin-top:8px">${[['hoy',0],['mañana',1],['pasado',2],['+1 semana',7]].map(([l,n])=>`<button type="button" class="chip" data-dd="${n}">${l}</button>`).join('')}</div>`;
}
function bindAgFields(root){
  const date=root.querySelector('[name=pdate]'),time=root.querySelector('[name=ptime]');
  const mark=()=>$$('[data-dd]',root).forEach(c=>c.classList.toggle('on',date.value===addDays(todayS(),+c.dataset.dd)));
  root.addEventListener('click',e=>{const c=e.target.closest('[data-dd]');if(!c)return;date.value=addDays(todayS(),+c.dataset.dd);if(+c.dataset.dd===0&&(!time.value||time.value<=nowHM()))time.value=suggestTime(date.value);mark()});
  date.addEventListener('input',mark);mark();
  return {mark};
}
function readAg(root){
  const g=n=>root.querySelector(`[name=${n}]`).value.trim();
  const id=g('pid'),kw=g('kw'),d=g('pdate'),t=g('ptime')||cfg.hora;
  if(!id)return {err:'Falta el ID.',k:'pid'};
  if(!kw)return {err:'Falta la palabra clave.',k:'kw'};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return {err:'Fecha inválida.',k:'pdate'};
  const due=`${d}T${t}`;
  return {id,kw,due};
}
function bindAgForm(form){
  form.innerHTML=agFields(null);
  const F=bindAgFields(form);
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(!noRO())return;
    $$('input.bad',form).forEach(x=>x.classList.remove('bad'));
    const R=readAg(form);
    if(R.err){toast(R.err,'err');const el=form.querySelector(`[name=${R.k}]`);el.classList.add('bad');el.focus();return}
    if(parseDue(R.due)<new Date(Date.now()-6e4)){toast('Esa fecha y hora ya pasó.','err');form.querySelector('[name=ptime]').classList.add('bad');return}
    const n=pend.reduce((a,p)=>Math.max(a,p.n||0),0)+1;
    if(!await B.addPend({n,id:R.id,kw:R.kw,due:R.due,notified:false,done:false,created:new Date().toISOString()}))return;
    const dd=parseDue(R.due);
    toast(`✔ Agendado #${n} · <b>${esc(R.id)}</b> · ${esc(R.kw)} · ${esc(whenTxt(dd))} <span class="dim">(${esc(rel(dd))})</span>`);
    form.querySelector('[name=pid]').value='';form.querySelector('[name=kw]').value='';
    form.querySelector('[name=pdate]').value=addDays(todayS(),1);form.querySelector('[name=ptime]').value=cfg.hora;F.mark();
    form.querySelector('[name=pid]').focus();primeAudio();check();
  });
}
function pendItem(p,now,compact){
  const d=parseDue(p.due),venc=!p.done&&d<=now;
  const st=p.done?'hecho'+(p.doneAt?' '+dayLabel(new Date(p.doneAt)):''):venc?'vencido · '+rel(d):rel(d);
  const acts=p.done?`<button type="button" class="ib" data-act="pDeshacer" title="volver a pendiente">↶</button><button type="button" class="ib del" data-act="pDel" title="borrar">✕</button>`
    :`<button type="button" class="btn sm" data-act="pHecho">✔ hecho</button><button type="button" class="ib" data-act="pMas" data-m="60" title="posponer 1 hora">+1h</button>`+
     (compact?'':`<button type="button" class="ib" data-act="pManana" title="pasar a mañana">mañana</button><button type="button" class="ib" data-act="pEdit" title="editar">✎</button><button type="button" class="ib del" data-act="pDel" title="borrar">✕</button>`);
  return `<div class="ai${venc?' venc':''}${p.done?' done':''}" data-pid="${esc(p._id)}"><span class="wh ${venc?'warn':!p.done&&p.due.slice(0,10)===todayS()?'info':'dim'}">${esc(whenTxt(d))}</span><span class="id">${esc(p.id)}</span><span class="kw" title="${esc(p.kw)}">${esc(p.kw)}<small>${esc(st)}</small></span><span class="ac wr">${acts}</span></div>`;
}
const pendOf=el=>{const r=el.closest('[data-pid]');return r&&pend.find(p=>p._id===r.dataset.pid)};
const clearAlert=p=>{const t=$(`#toasts [data-key="p${p._id}"]`);if(t)t.remove()};
async function pendHecho(p){
  if(!p||!noRO())return;
  if(await B.updPend(p,{done:true,doneAt:new Date().toISOString()})){clearAlert(p);toast(`✔ #${p.n} · <b>${esc(p.id)}</b> · ${esc(p.kw)} → hecho`,'ok',{actions:[{l:'deshacer',fn:()=>B.updPend(p,{done:false,doneAt:null})}]})}
}
async function posponer(p,minutes,toDate){
  if(!p||!noRO())return;
  let d;
  if(toDate){d=parseDue(p.due);const n=parseYMD(toDate);d.setFullYear(n.getFullYear(),n.getMonth(),n.getDate())}
  else{d=new Date(Date.now()+minutes*6e4);d.setSeconds(0,0)}
  if(await B.updPend(p,{due:dueStr(d),notified:false})){clearAlert(p);toast(`↷ #${p.n} · <b>${esc(p.id)}</b> → ${esc(whenTxt(d))}`)}
}
function pendEdit(p){
  if(!p||!noRO())return;
  modal({title:`Editar contacto #${p.n}`,body:`<div class="agform">${agFields(p)}</div><div class="ebox" id="pErr"></div>`,wide:1,
    actions:[{l:'cancelar'},{l:'guardar',cls:'pri',fn:async api=>{
      const R=readAg(api.box);if(R.err){api.q('#pErr').textContent=R.err;return false}
      const ch={id:R.id,kw:R.kw};if(R.due!==p.due){ch.due=R.due;ch.notified=false}
      if(!await B.updPend(p,ch))return false;clearAlert(p);toast(`✔ #${p.n} actualizado`);
    }}],onOpen:api=>bindAgFields(api.box)});
}
async function pendDel(p){
  if(!p||!noRO())return;
  if(!await confirmar('Borrar contacto',`¿Borrar #${p.n} · <b>${esc(p.id)}</b> · ${esc(p.kw)}?`,'borrar',true))return;
  if(await B.delPend(p)){clearAlert(p);toast(`✔ #${p.n} borrado.`)}
}

/* ---------- turno ---------- */
const alerted={};
function markTime(hv,min){
  let ms=Date.now();
  if(hv){const [H,M]=hv.split(':').map(Number);const d=new Date();d.setHours(H,M,0,0);ms=d.getTime();if(ms>Date.now()+6e4)return {err:'Esa hora todavía no llegó.'}}
  if(min&&ms<min-6e4)return {err:`Esa hora es anterior a tu última marca (${hhmm(min)}).`};
  return {ms};
}
async function marcar(kind,hv=''){
  if(!ready||!noRO())return;primeAudio();
  const t=openTurno();let r,nt,msg;
  if(kind==='entrada'){
    if(t)return toast(`Ya marcaste entrada a las ${hhmm(t.in)}.`,'warn');
    const h=turnos[todayS()];
    if(h&&h.out){
      if(!await confirmar('Reabrir turno',`Ya cerraste el turno de hoy (${hhmm(h.in)}–${hhmm(h.out)}). ¿Reabrirlo?`,'reabrir'))return;
      if(await B.saveTurno({...h,out:null}))toast(`▶ Turno reabierto (entrada ${hhmm(h.in)}).`);turnoBar(true);return;
    }
    r=markTime(hv);if(r.err)return toast(r.err,'err');
    nt={date:todayS(),in:r.ms,out:null,breaks:[]};msg=`▶ Entrada <b>${hhmm(r.ms)}</b> · salida ${hhmm(r.ms+jorMs())}`;
  }else if(kind==='d10'||kind==='d30'){
    const k=kind==='d10'?10:30;
    if(!t)return toast('Sin entrada marcada.','warn');
    const b=breakAbierto(t);if(b)return toast(`Ya estás en el descanso de ${b.k}' (desde ${hhmm(b.s)}).`,'warn');
    r=markTime(hv,lastMark(t));if(r.err)return toast(r.err,'err');
    nt={...t,breaks:[...t.breaks,{k,s:r.ms,e:null}]};
    if(hv&&r.ms+k*6e4<=Date.now())alerted[t.date+':'+r.ms]=Date.now(); // marca hacia atrás: sin alarma inmediata
    const ya=t.breaks.filter(x=>x.k===k).length;
    msg=`☕ Descanso de ${k}' desde <b>${hhmm(r.ms)}</b> · hasta ${hhmm(r.ms+k*6e4)}${ya?` · ${sp('warn',(ya+1)+'º de '+k+"' hoy")}`:''}`;
  }else if(kind==='vuelta'){
    const b=breakAbierto(t);if(!b)return toast(t?'No estás en un descanso.':'No hay un turno abierto.','warn');
    r=markTime(hv,b.s);if(r.err)return toast(r.err,'err');
    nt={...t,breaks:t.breaks.map(x=>x===b?{...x,e:r.ms}:x)};
    const d=r.ms-b.s,ex=d-b.k*6e4;msg=`↩ Volviste <b>${hhmm(r.ms)}</b> · descanso de ${b.k}': ${mins(d)} min${ex>=6e4?' '+sp('warn','(+'+mins(ex)+' min)'):''}`;
    const a=$('#toasts [data-key="brk"]');if(a)a.remove();
  }else if(kind==='salida'){
    if(!t){const h=turnos[todayS()];return toast(h&&h.out?`Ya marcaste salida a las ${hhmm(h.out)}.`:'Sin entrada marcada.','warn')}
    r=markTime(hv,lastMark(t));if(r.err)return toast(r.err,'err');
    nt={...t,out:r.ms,breaks:t.breaks.map(x=>x.e?x:{...x,e:r.ms})};
    const m=metr(nt);
    msg=`■ Salida <b>${hhmm(r.ms)}</b> · ${dur(m.total)}${Math.abs(m.extra)<6e4?'':m.extra>0?' · '+sp('warn','+'+dur(m.extra)+' extra'):' · '+dur(-m.extra)+' menos'} · ${plural(m.ftd,'FTD')}${m.fph!=null?' · '+nf(m.fph,2)+'/h':''}`;
    const a=$('#toasts [data-key="brk"]');if(a)a.remove();
  }
  if(!await B.saveTurno(nt))return;
  const hi=$('#itHora');if(hi)hi.value='';
  turnoBar(true);toast(msg);
}
async function deshacer(){
  if(!noRO())return;
  const t=openTurno()||turnos[todayS()];
  if(!t)return toast('Nada para deshacer.','warn');
  let nt={...t,breaks:t.breaks.map(b=>({...b}))},txt;
  const lb=nt.breaks[nt.breaks.length-1];
  if(nt.out){txt=`salida ${hhmm(nt.out)}`;for(const x of nt.breaks)if(x.e===nt.out)x.e=null;nt.out=null}
  else if(lb&&lb.e){txt=`vuelta del descanso de ${lb.k}' (${hhmm(lb.e)})`;lb.e=null}
  else if(lb){txt=`descanso de ${lb.k}' (${hhmm(lb.s)})`;nt.breaks.pop()}
  else{
    if(!await confirmar('Borrar jornada',`¿Borrar la entrada de las ${hhmm(t.in)} (el turno entero)?`,'borrar',true))return;
    if(await B.delTurno(t.date))toast('✔ Turno borrado.');turnoBar(true);return;
  }
  if(await B.saveTurno(nt))toast(`↶ Deshecho: ${esc(txt)}`);
  turnoBar(true);
}
function editTurno(date){
  if(!noRO())return;
  const isNew=!date,t=date?turnos[date]:null,d0=date||todayS();
  const hm=ms=>ms?hhmm(ms):'';
  const brow=b=>`<div class="brow"><select aria-label="Tipo de descanso"><option value="10"${b&&b.k===10?' selected':''}>10'</option><option value="30"${b&&b.k===30?' selected':''}>30'</option></select><input type="time" class="bs" value="${b?hm(b.s):''}" aria-label="Inicio"><input type="time" class="be" value="${b?hm(b.e):''}" aria-label="Fin"><button type="button" class="ib del" data-rm aria-label="Quitar">✕</button></div>`;
  const body=`<div class="fgrid">
    ${isNew?`<label class="fld full"><span>Fecha</span><input type="date" name="tdate" max="${todayS()}" value="${d0}"></label>`:''}
    <label class="fld"><span>Entrada</span><input type="time" name="tin" value="${t?hm(t.in):''}"></label>
    <label class="fld"><span>Salida</span><input type="time" name="tout" value="${t?hm(t.out):''}"></label></div>
    <div class="fld" style="margin-top:14px"><span>Descansos · tipo · inicio · fin</span></div>
    <div id="tbRows" style="margin-top:6px">${(t?t.breaks:[]).map(brow).join('')}</div>
    <button type="button" class="btn sm" id="tbAdd">+ descanso</button><div class="ebox" id="tErr"></div>`;
  const save=async api=>{
    const err=m=>{api.q('#tErr').textContent=m;return false};
    const date=isNew?api.q('[name=tdate]').value:date0;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>todayS())return err('Fecha inválida.');
    if(isNew&&turnos[date])return err(`Ya hay una jornada el ${dm(date)}; editala desde la tabla.`);
    const vin=api.q('[name=tin]').value,vout=api.q('[name=tout]').value;
    if(!vin)return err('Falta la entrada.');
    const inMs=msAt(date,vin);if(inMs>Date.now()+6e4)return err('La entrada todavía no llegó.');
    let outMs=null;
    if(vout){outMs=msAt(date,vout);if(outMs<=inMs)outMs+=864e5;if(outMs>Date.now()+6e4)return err('La salida todavía no llegó.')}
    else if(date!==todayS()&&!(t&&!t.out&&openTurno()===t))return err('Falta la salida.');
    const fix=ms=>ms<inMs?ms+864e5:ms;
    const breaks=[];let open=0;
    for(const row of $$('.brow',api.box)){
      const k=+row.querySelector('select').value,s=row.querySelector('.bs').value,e=row.querySelector('.be').value;
      if(!s&&!e)continue;if(!s)return err('A un descanso le falta el inicio.');
      const sMs=fix(msAt(date,s));let eMs=e?fix(msAt(date,e)):null;
      if(eMs!=null&&eMs<sMs)return err(`El descanso de las ${s} termina antes de empezar.`);
      if(outMs&&sMs>outMs)return err(`El descanso de las ${s} es posterior a la salida.`);
      if(eMs==null){if(outMs)eMs=outMs;else open++}
      if(outMs&&eMs>outMs)return err(`El descanso de las ${s} termina después de la salida.`);
      breaks.push({k,s:sMs,e:eMs});
    }
    if(open>1)return err('Solo puede haber un descanso abierto.');
    breaks.sort((a,b)=>a.s-b.s);
    if(!await B.saveTurno({date,in:inMs,out:outMs,breaks}))return false;
    turnoBar(true);toast(`✔ Jornada del ${dm(date)} guardada.`);
  };
  const date0=date;
  const acts=[{l:'cancelar'},{l:'guardar',cls:'pri',fn:save}];
  if(t)acts.unshift({l:'borrar jornada',cls:'danger l',fn:async()=>{if(!await confirmar('Borrar jornada',`¿Borrar la jornada del ${dm(date)}?`,'borrar',true))return false;if(await B.delTurno(date)){toast(`✔ Jornada del ${dm(date)} borrada.`);turnoBar(true)}}});
  modal({title:isNew?'Cargar jornada':`Jornada · ${DIAL[parseYMD(date).getDay()]} ${dm(date)}`,body,actions:acts,
    onOpen(api){
      api.q('#tbAdd').onclick=()=>{api.q('#tbRows').insertAdjacentHTML('beforeend',brow(null));const r=$$('.brow',api.box).pop();r.querySelector('.bs').focus()};
      api.box.addEventListener('click',e=>{const x=e.target.closest('[data-rm]');if(x)x.closest('.brow').remove()});
    }});
}

/* ---------- duplicados (por marca: el mismo número de transacción puede existir en las dos) ---------- */
const dupKeys=()=>({tx:new Set(team.filter(f=>f.tx).map(f=>norm(f.brand||'')+'|'+f.tx)),id:new Set(team.map(f=>norm(f.id)+'|'+norm(f.brand||'')))}); // toda la mesa
const isDup=(x,K)=>!!((x.tx&&K.tx.has(norm(x.brand||'')+'|'+x.tx))||K.id.has(norm(x.id)+'|'+norm(x.brand||'')));

/* ---------- ventas que llegan desde el CRM (botón de la extensión) ---------- */
function cleanExtRow(r){
  if(!r||typeof r!=='object')return null;
  const s=(v,n=120)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,n);
  const date=s(r.date,10),reg=s(r.reg,16),amount=+r.amount;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>todayS()||!s(r.id)||!isFinite(amount))return null;
  const o={date,time:/^\d{2}:\d{2}$/.test(s(r.time,5))?s(r.time,5):'',id:s(r.id,40),name:s(r.name),country:s(r.country,60),aff:s(r.aff,60),camp:s(r.camp),amount:Math.round(amount*100)/100,brand:s(r.brand,40)||DEF_BRAND};
  const tx=s(r.tx,60);if(tx)o.tx=tx;
  o.reg=/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(reg)&&reg.slice(0,10)<=date?reg:date;
  return o;
}
async function importFromExt(rows){
  if(!ready)return {err:'el panel todavía está cargando'};
  if(readOnly)return {err:'el panel está en solo lectura'};
  if(!Array.isArray(rows))return {err:'datos inválidos'};
  const K=dupKeys(),seen=new Set(),nuevas=[];let dup=0,bad=0;
  for(const r of rows.slice(0,500)){
    const o=cleanExtRow(r);if(!o){bad++;continue}
    const k=norm(o.id)+'|'+norm(o.brand);
    if(isDup(o,K)||seen.has(k)){dup++;continue}
    seen.add(k);nuevas.push(o);
  }
  const mesOut=()=>{const s=calc(ymNow());return {n:s.n,usd:s.usd,next:s.next}};
  if(!nuevas.length)return {added:0,dup,bad,mes:mesOut()};
  const months=[...new Set(nuevas.map(x=>x.date.slice(0,7)))],before=Object.fromEntries(months.map(m=>[m,calc(m).tier]));
  let n=nextN()-1;const list=nuevas.sort(byDate).map(f=>({...f,n:++n}));
  if(!await B.addMany(list))return {err:'no se pudo guardar en la base'};
  const l=list[list.length-1];last={brand:l.brand,country:l.country,aff:l.aff,camp:l.camp};local.set('last',last);
  toast(`⇪ ${list.length===1?'1 venta nueva':list.length+' ventas nuevas'} desde el CRM: ${list.map(f=>`<b>${esc(f.id)}</b>`).join(', ')}${dup?` · ${dup} ya estaba${dup>1?'n':''}`:''}`);
  for(const m of months){const s=calc(m);if(s.tier>before[m]){toast(`🎉 ¡${s.n} FTDs! Bono de ${s.bono} USD desbloqueado.`,'alert',{ms:9000});beep(2)}}
  return {added:list.length,dup,bad,ids:list.map(f=>f.id),mes:mesOut()};
}

/* ---------- CSV ---------- */
async function exportar(){
  const name=`ftds_${todayS()}.csv`,data=csvText();
  if(dl){
    try{await dl.save({filename:name,data});toast(`✔ ${name} · ${plural(ftds.length,'FTD')}`);return}
    catch(e){const code=e&&e.code;if(code==='declined')return toast('Descarga cancelada.','warn');if(code==='rate_limited')return toast('Ya hay una descarga esperando que la confirmes.','warn')}
  }
  if(!window.claude){
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));
    a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    toast(`✔ Descargado ${name}`);return;
  }
  let copied=false;try{await navigator.clipboard.writeText(csvText(false));copied=true}catch(e){}
  modal({title:'CSV',body:`<p class="mp ${copied?'ok':'warn'}">${copied?'No se pudo descargar; quedó copiado al portapapeles.':'No se pudo descargar.'}</p><textarea class="csv" readonly>${esc(csvText(false))}</textarea>`,actions:[{l:'cerrar',cls:'pri'}],wide:1});
}
function importar(){
  if(!ready||!noRO())return;
  const fi=$('#file');fi.value='';
  fi.onchange=async()=>{
    const file=fi.files[0];if(!file)return;
    let rows;try{rows=parseCSV(await file.text())}catch(e){return toast('No pude leer el archivo: '+esc(e.message),'err')}
    if(rows.length<2)return toast('El archivo está vacío.','err');
    const R=csvToRows(rows);
    if(!R)return toast(`No reconozco las columnas de ${esc(file.name)}.`,'err');
    if(!R.ok.length)return toast(`Sin FTDs válidos en ${esc(file.name)}.`,'err');
    let brand='';
    if(R.ok.some(x=>!x.brand)){
      brand=await new Promise(res=>{let v=null;
        modal({title:`Marca · ${esc(file.name)}`,body:`<label class="fld"><span>${plural(R.ok.length,'venta')} sin marca</span><input id="imB" list="dlB2" value="${esc(last.brand||DEF_BRAND)}"></label>${dlist('dlB2',[...new Set([DEF_BRAND,'Trade24Seven',...uniq(x=>x.brand)])])}`,
          actions:[{l:'cancelar'},{l:'seguir',cls:'pri',fn:api=>{v=api.q('#imB').value.trim()||DEF_BRAND}}],onClose:()=>res(v)});
      });
      if(brand==null)return;
    }
    for(const x of R.ok)if(!x.brand)x.brand=brand;
    const K=dupKeys();
    const nuevas=R.ok.filter(x=>!isDup(x,K));
    const rep=R.ok.length-nuevas.length;
    if(!nuevas.length)return toast(`${esc(file.name)}: las ${R.ok.length} ventas ya estaban cargadas.`,'warn');
    const lat=nuevas.filter(isLate).length;
    if(!await confirmar(`Importar ${esc(file.name)}`,`<b>${plural(nuevas.length,'venta nueva','ventas nuevas')}</b>${lat?` (${lat} late)`:''}${rep?` · ${rep} ya estaba${rep>1?'n':''}`:''}${R.bad?` · ${sp('warn',plural(R.bad,'fila')+' con errores')}`:''}`,'agregar'))return;
    let n=nextN()-1;
    const list=nuevas.sort(byDate).map(f=>({...f,n:++n}));
    const T=toast('guardando…','ok',{sticky:1});
    const ok=await B.addMany(list,(i,t)=>T.set(`guardando… ${i}/${t}`));
    T.close();if(ok)toast(`✔ ${list.length===1?'Agregada 1 venta':'Agregadas '+list.length+' ventas'}.`);
  };
  fi.click();
}


/* ---------- puente con la extensión de Chrome (avisos de agenda) ---------- */
let extSig='',extOk=0,extN=0,extBeat=0;
const extOn=()=>extOk&&Date.now()-extOk<3*6e4;
function postTop(msg){try{window.postMessage(msg,location.origin);return true}catch(e){return false}} // la extensión escucha en esta misma ventana
function syncExt(){
  if(!ready)return;
  const items=pend.filter(p=>!p.done).map(p=>({k:p._id,n:p.n,id:p.id,kw:p.kw,due:parseDue(p.due).getTime()})).sort((a,b)=>a.due-b.due);
  // ventas que ya están en la mesa: el botón del CRM ofrece solo las nuevas
  const known={ids:team.map(f=>norm(f.brand||'')+'|'+norm(f.id)),txs:team.filter(f=>f.tx).map(f=>norm(f.brand||'')+'|'+f.tx)};
  const sig=JSON.stringify(items)+'#'+known.ids.length+'#'+known.ids.join(',').length+'#'+known.txs.length,beat=extOk&&Date.now()-extBeat>6e4;
  if(sig===extSig&&!beat)return;
  extSig=sig;extBeat=Date.now();
  postTop({type:'ftd-agenda',v:1,items,known,user:profile&&profile.name,sent:Date.now()});
}
window.addEventListener('message',e=>{
  const d=e.data;
  if(d&&d.type==='ftd-agenda-test-ack'&&d.v===1){
    if(d.ok)toast('🔔 La extensión mostró el aviso (tarjeta + sonido).','ok',{ms:6000});
    else toast('✖ La extensión no pudo avisar'+(d.err?': '+esc(d.err):'.'),'err');
    return;
  }
  if(e.source!==window||e.origin!==location.origin)return; // solo la extensión, desde esta misma pestaña
  if(d&&d.type==='ftd-agenda-import'&&d.v===1){ // ventas mandadas desde el botón del CRM
    const src=e.source;
    importFromExt(d.rows).catch(err=>({err:String(err&&err.message||err)})).then(res=>{try{src.postMessage({type:'ftd-agenda-import-ack',v:1,reqId:d.reqId,...res},'*')}catch(x){}});
    return;
  }
  if(d&&d.type==='ftd-agenda-cmd'&&d.v===1&&d.cmd==='done'){ // "✔ hecho" tocado en el aviso de Chrome
    const p=pend.find(x=>x._id===d.k);
    if(p&&!p.done&&!readOnly)B.updPend(p,{done:true,doneAt:new Date().toISOString()}).then(ok=>{if(ok){clearAlert(p);toast(`✔ #${p.n} · <b>${esc(p.id)}</b> · ${esc(p.kw)} → hecho (desde el aviso)`)}});
    return;
  }
  if(!d||d.type!=='ftd-agenda-ack'||d.v!==1)return;
  const was=extOn();extOk=Date.now();extN=+d.scheduled||0;
  if(!was){status();if(cur==='config'||cur==='agenda')V[cur].render({})}
});

/* ---------- avisos ---------- */
function fire(p){
  const d=parseDue(p.due),late=Date.now()-d>5*6e4;
  toast(`⏰ CONTACTAR <b>${esc(p.id)}</b> · ${esc(p.kw)}<br><span style="font-weight:400">#${p.n} · ${esc(whenTxt(d))}${late?' · atrasado':''}</span>`,'alert',
    {sticky:1,key:'p'+p._id,actions:[{l:'✔ hecho',fn:()=>pendHecho(p)},{l:'+15 min',fn:()=>posponer(p,15)},{l:'+1 h',fn:()=>posponer(p,60)}]});
  flash();
  if(extOn())return; // la extensión de Chrome ya avisa con sonido en la pestaña que estés
  beep(3);
  sysNotify(`📞 Contactar ${p.id}`,`${p.kw} · ${whenTxt(d)}${late?' (atrasado)':''}`,'ftdc-'+p._id);
}
function check(){
  if(!ready)return;
  const now=new Date();
  for(const p of pend){
    if(p.done||p.notified)continue;
    const d=parseDue(p.due);if(d<=now){fire(p);if(!readOnly)B.updPend(p,{notified:true});else p.notified=true}
  }
  status();syncExt();
}
function tick(){
  if(!ready)return;
  const now=new Date();$('#sClock').textContent=`${z(now.getHours())}:${z(now.getMinutes())}`;
  turnoBar();if(cur==='inicio')V.inicio.turno();
  const t=openTurno(),b=breakAbierto(t);if(!b)return;
  const end=b.s+b.k*6e4,ms=Date.now();if(ms<end)return;
  const key=t.date+':'+b.s;
  if(alerted[key]&&ms-alerted[key]<5*6e4)return;
  const first=!alerted[key];alerted[key]=ms;
  toast(first?`⏰ Terminó el descanso de ${b.k}' (${hhmm(b.s)})`:`⏰ Descanso de ${b.k}': +${mins(ms-end)} min`,'alert',{sticky:1,key:'brk',actions:[{l:'↩ vuelta',fn:()=>marcar('vuelta')}]});
  beep(3);flash();sysNotify(`☕ Terminó el descanso de ${b.k}'`,hhmm(b.s),'ftdc-break');
}

/* ---------- ayuda ---------- */
function ayuda(){
  const fon=nf((FONASA_TASA[cfg.fonasa]||.045)*100,1).replace(',0','');
  modal({title:`<span class="u">${esc(who())}@vitalis</span>:<span class="w">~</span>$ ayuda`,wide:1,actions:[{l:'cerrar',cls:'pri'}],body:`<div class="help">
  <h4>VENTAS</h4><dl>
    <dt>new / late</dt><dd>new = se registró y depositó el mismo día · late = el registro es de un día anterior al FTD</dd>
    <dt>filtros</dt><dd>campaña y afiliado exactos (mayúsculas cuentan) · país sin importar tildes · click en un ranking filtra, otro click lo saca</dd>
    <dt>buscar</dt><dd>nombre, ID o transacción</dd>
    <dt>duplicados</dt><dd>mismo ID y misma marca: avisa antes de guardar</dd></dl>
  <h4>SUELDO</h4><dl>
    <dt>bonos</dt><dd>no acumulables: cobrás solo el escalón más alto que alcanzaste</dd>
    <dt>sin detalle</dt><dd>FTDs del mes que suman al sueldo pero no están en ventas ni en el CSV</dd>
    <dt>dólar</dt><dd>BROU compra · avisa cuando tiene más de 3 días</dd>
    <dt>líquido</dt><dd>estimación con valores BPS 2026: jubilatorio 15% · FONASA ${fon}% (3% hasta 2,5 BPC) · FRL 0,1% · IRPF por franjas, +6% a la base arriba de 10 BPC, deducciones al 14% (8% arriba de 15 BPC) · sin aguinaldo ni vacacional</dd></dl>
  <h4>TURNO</h4><dl>
    <dt>jornada</dt><dd>${dur(jorMs())} desde la entrada · los descansos cuentan como trabajados</dd>
    <dt>otra hora</dt><dd>completá "hora" en la tarjeta de turno antes de tocar el botón · ✎ editar corrige cualquier marca</dd>
    <dt>alarma</dt><dd>al terminar el descanso, y cada 5 min si seguís</dd></dl>
  <h4>AGENDA</h4><dl>
    <dt>avisos</dt><dd>tarjeta + sonido + destello en esta pestaña · con la extensión Vitalis, también en la pestaña que estés y con la pestaña cerrada</dd></dl>
  <h4>EXTENSIÓN DE CHROME</h4><dl>
    <dt>qué hace</dt><dd>avisos de agenda con sonido en cualquier pestaña · botón en el CRM para pasar ventas · aviso de clientes nuevos en "new"</dd>
    <dt>instalar</dt><dd>config → ⇩ extensión de Chrome · descomprimí el zip · chrome://extensions → Modo de desarrollador → Cargar descomprimida → elegí la carpeta · recargá Vitalis</dd></dl>
  <h4>DATOS</h4><dl>
    <dt>guardado</dt><dd>en la base de Vitalis · las ventas las ve toda la mesa (${esc(teamInfo?teamInfo.name:'')}) · sueldo, agenda, turnos y faltas son solo tuyos</dd>
    <dt>editar</dt><dd>cada uno edita y borra sus ventas · el team leader y el admin pueden corregir cualquiera</dd>
    <dt>CSV</dt><dd>exportar incluye registro, tipo y marca · importar acepta el export de tu plataforma y no duplica · si Excel lo muestra en una columna, usá separador ;</dd></dl>
  <h4>ATAJOS</h4><dl>
    <dt><kbd>1</kbd>–<kbd>${isLeader()?7:6}</kbd></dt><dd>secciones</dd><dt><kbd>N</kbd></dt><dd>nueva venta</dd><dt><kbd>A</kbd></dt><dd>agendar</dd><dt><kbd>/</kbd></dt><dd>buscar ventas</dd><dt><kbd>?</kbd></dt><dd>ayuda</dd><dt><kbd>Esc</kbd></dt><dd>cerrar</dd></dl>
  </div>`});
}

/* ---------- clicks y teclas ---------- */
const hv=el=>el.closest('#iTurno')?($('#itHora').value||''):'';
const ACT={
  nueva:()=>ftdForm(),importar:()=>importar(),exportar:()=>exportar(),ayuda:()=>ayuda(),
  entrada:el=>marcar('entrada',hv(el)),d10:el=>marcar('d10',hv(el)),d30:el=>marcar('d30',hv(el)),vuelta:el=>marcar('vuelta',hv(el)),salida:el=>marcar('salida',hv(el)),
  deshacer:()=>deshacer(),editHoy:()=>{const t=openTurno()||turnos[todayS()];editTurno(t?t.date:null)},
  cargarJornada:()=>editTurno(null),editTurno:el=>editTurno(el.dataset.d),
  editFtd:el=>{const f=team.find(x=>x._id===el.dataset.id);if(f&&canEdit(f))ftdForm(f)},
  delFtd:el=>{const f=team.find(x=>x._id===el.dataset.id);if(f&&canEdit(f))borrarFtd(f)},
  salir:async()=>{if(await confirmar('Salir','¿Cerrar la sesión en este navegador?','salir'))await sb.auth.signOut().catch(()=>{}),location.reload()},
  importarRespaldo:()=>importarRespaldo(),
  ajuste:el=>ajusteModal(el.dataset.ym||ymNow()),focusTc:()=>{const i=$('#suTc');i.focus();i.select()},
  pHecho:el=>pendHecho(pendOf(el)),pDeshacer:el=>{const p=pendOf(el);if(p&&noRO())B.updPend(p,{done:false,doneAt:null})},
  pMas:el=>posponer(pendOf(el),+el.dataset.m||60),pManana:el=>posponer(pendOf(el),0,addDays(todayS(),1)),
  pEdit:el=>pendEdit(pendOf(el)),pDel:el=>pendDel(pendOf(el)),
  probarAviso:()=>{primeAudio();beep(1);flash();
    if(extOn()&&postTop({type:'ftd-agenda-test',v:1}))toast('🔊 Aviso del panel · pidiendo la notificación a Chrome…');
    else toast('🔊 Así suenan los avisos del panel · '+sp('hot','sin extensión de Chrome conectada'))},
};
document.addEventListener('click',e=>{
  const v=e.target.closest('#nav [data-v]');if(v){go(v.dataset.v);return}
  const g=e.target.closest('[data-go]');if(g){e.preventDefault();go(g.dataset.go);return}
  const a=e.target.closest('[data-act]');if(a&&ACT[a.dataset.act]){e.preventDefault();primeAudio();ACT[a.dataset.act](a)}
});
document.addEventListener('pointerdown',primeAudio);
document.addEventListener('mousedown',e=>{if(e.target.closest('.chip'))e.preventDefault()}); // los chips no se quedan con el foco: Enter sigue guardando
document.addEventListener('keydown',e=>{
  primeAudio();
  if(modals.length)return;
  const tg=e.target,typing=tg&&tg.matches&&tg.matches('input,select,textarea');
  if(e.key==='Escape'){if(typing)tg.blur();hideTip();return}
  if(typing||e.ctrlKey||e.metaKey||e.altKey||!ready)return;
  if(/^[1-7]$/.test(e.key)){e.preventDefault();go(VIEWS[+e.key-1]);return}
  const k=e.key.toLowerCase();
  if(k==='n'){e.preventDefault();ftdForm();return}
  if(k==='a'){e.preventDefault();go('agenda');setTimeout(()=>{const i=$('#agForm [name=pid]');i&&i.focus()},0);return}
  if(e.key==='/'){e.preventDefault();go('ventas');setTimeout(()=>$('#pQ').focus(),0);return}
  if(e.key==='?'){e.preventDefault();ayuda();return}
});
