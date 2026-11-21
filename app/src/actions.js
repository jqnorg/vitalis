
/* ============================================================
   Acciones: ventas, sin detalle, agenda, turno, CSV, avisos
   ============================================================ */
const uniq=fn=>[...new Set(ftds.map(fn).filter(Boolean).map(String))].sort((a,b)=>a.localeCompare(b));
const dlist=(id,vals)=>`<datalist id="${id}">${vals.map(v=>`<option value="${esc(v)}">`).join('')}</datalist>`;
const tipoBadge=f=>isLate(f)?`<span class="badge late">late ${lateDays(f)} d</span>`:'<span class="badge new">new</span>';
const noRO=()=>{if(readOnly){toast('Solo lectura.','err');return false}return true};
// el team leader carga ventas de toda la mesa: lista de vendedores
const sellerOpts=sel=>members.filter(m=>m.active||m.id===sel).sort((a,b)=>(b.id===me)-(a.id===me)||a.name.localeCompare(b.name))
  .map(m=>`<option value="${esc(m.id)}"${m.id===sel?' selected':''}>${m.id===me?'Yo ('+esc(m.name)+')':esc(m.name)}</option>`).join('');

/* ---------- venta: nueva / editar ---------- */
function ftdForm(f){
  if(!f)return; // las ventas nuevas entran solo desde el CRM con la extensión: acá solo se editan
  if(!ready||!noRO())return;
  const isNew=!f,te=todayS();
  const r=f?{...f}:{date:te,time:nowHM(),brand:last.brand||DEF_BRAND,country:last.country||'',aff:last.aff||'',camp:last.camp||'',reg:te};
  const reg=String(r.reg||r.date),regD=reg.slice(0,10),regT=reg.slice(11,16);
  const v=k=>esc(r[k]??'');
  const seller=isLeader()?(f?f.uid:(local.get('lastSeller','')&&members.some(m=>m.id===local.get('lastSeller','')&&m.active)?local.get('lastSeller',''):me)):null;
  const body=`<div class="fgrid">
    ${seller?`<label class="fld full"><span>Vendedor</span><select name="uid">${sellerOpts(seller)}</select></label>`:''}
    <label class="fld"><span>Marca</span><input name="brand" list="dlB" value="${v('brand')}"></label>
    <label class="fld"><span>ID <i>*</i></span><input name="id" value="${v('id')}" autofocus></label>
    <label class="fld full"><span>Full Name <i>*</i></span><input name="name" value="${v('name')}"></label>
    <label class="fld"><span>Country</span><input name="country" list="dlC" value="${v('country')}"></label>
    <label class="fld"><span>Amount USD <i>*</i></span><input name="amount" inputmode="decimal" value="${f?esc(String(f.amount).replace('.',',')):''}"></label>
    <label class="fld"><span>Affiliate</span><input name="aff" list="dlA" value="${v('aff')}"></label>
    <label class="fld"><span>Campaign</span><input name="camp" list="dlK" value="${v('camp')}"></label>
    <div class="fld"><span>Fecha FTD</span><div class="frow" style="flex-wrap:nowrap"><input type="date" name="date" max="${te}" value="${v('date')}" style="flex:1" aria-label="Fecha FTD"><input type="time" name="time" value="${v('time')}" aria-label="Hora FTD"></div></div>
    <div class="fld"><span>Registro</span><div class="frow" style="flex-wrap:nowrap"><input type="date" name="regD" max="${te}" value="${esc(regD)}" style="flex:1" aria-label="Fecha de registro"><input type="time" name="regT" value="${esc(regT)}" aria-label="Hora de registro"></div></div>
    <div class="full frow" style="align-items:center"><span class="chips">${[['Mismo día',0],['Ayer',1],['2 días antes',2],['7 días antes',7]].map(([l,n])=>`<button type="button" class="chip" data-reg="${n}">${l}</button>`).join('')}</span><span style="flex:1"></span><span id="fTipo"></span></div>
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
    const u=api.q('[name=uid]');if(u)rec.uid=u.value;
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
    else{if(rec.uid&&rec.uid!==f.uid)rec.n=nextNFor(rec.uid);if(!await B.updFtd(f,rec))return false;toast(`Venta #${rec.n||f.n} actualizada: <b>${esc(rec.id)}</b> ${esc(rec.name)}${rec.uid&&rec.uid!==me?' de '+esc(memberName(rec.uid)):''}`)}
    if(again){ // seguir cargando: limpia lo propio de la venta, mantiene marca/país/afiliador/campaña
      for(const n of ['id','name','amount','tx'])api.q(`[name=${n}]`).value='';
      api.q('[name=time]').value=nowHM();api.q('[name=regD]').value=api.q('[name=date]').value;api.q('[name=regT]').value='';
      api.q('#fDup').hidden=true;dupOk='';tipo(api);api.q('[name=id]').focus();return false;
    }
  };
  const acts=isNew?[{l:'Cancelar'},{l:'Guardar y otra',fn:api=>save(api,true)},{l:'Guardar',cls:'pri',fn:api=>save(api)}]
    :[{l:'Borrar',cls:'danger l',fn:async()=>{await borrarFtd(f)}},{l:'Cancelar'},{l:'Guardar',cls:'pri',fn:api=>save(api)}];
  modal({title:isNew?'Nueva venta':`Editar venta #${f.n}${f.uid!==me?' de '+esc(memberName(f.uid)):''}`,body,actions:acts,wide:1,
    onOpen(api){
      tipo(api);
      api.box.addEventListener('input',e=>{if(['date','regD'].includes(e.target.name))tipo(api);if(e.target.name==='id'||e.target.name==='brand'){api.q('#fDup').hidden=true;dupOk=''}});
      api.box.addEventListener('click',e=>{const c=e.target.closest('[data-reg]');if(!c)return;const d=api.q('[name=date]').value||todayS();api.q('[name=regD]').value=addDays(d,-c.dataset.reg);if(c.dataset.reg==='0')api.q('[name=regT]').value='';tipo(api)});
      if(!isNew)setTimeout(()=>api.q('[name=amount]').focus(),0);
    }});
}
async function commitNew(rec){
  const other=rec.uid&&rec.uid!==me;
  if(rec.uid)local.set('lastSeller',rec.uid);
  rec.n=other?nextNFor(rec.uid):nextN();
  last={brand:rec.brand,country:rec.country,aff:rec.aff,camp:rec.camp};local.set('last',last);
  const ym=rec.date.slice(0,7),before=calc(ym);
  if(!await B.addFtd(rec))return false;
  if(other){toast(`Venta cargada a <b>${esc(memberName(rec.uid))}</b>: ${esc(rec.id)} ${esc(rec.name)}, ${money(rec.amount)} USD`);return true}
  const s=calc(ym);
  toast(`✔ FTD #${rec.n} · <b>${esc(rec.id)}</b> · ${esc(rec.name)} · ${money(rec.amount)} USD${isLate(rec)?' · '+sp('warn','late '+lateDays(rec)+' d'):''}<br><span class="dim">${esc(mLong(ym))}: ${plural(s.n,'FTD')} · ${money(s.usd)} USD${s.next?' · '+progressTxt(s):''}</span>`);
  if(s.tier>before.tier){toast(`🎉 ¡${s.n} FTDs! Bono de ${s.bono} USD desbloqueado.`,'win',{ms:9000});beep(2)}
  return true;
}
async function borrarFtd(f){
  if(!noRO())return false;
  if(!await confirmar('Borrar venta',`¿Borrar FTD #${f.n} · ${dm(f.date)}/${f.date.slice(0,4)} · <b>${esc(f.id)}</b> · ${esc(f.name)} · ${money(f.amount)} USD?`,'borrar',true))return false;
  if(!await B.delFtd(f))return false;
  toast(`✔ FTD #${f.n} borrado.`);return true;
}

/* ---------- team leader: cargar ventas de la mesa ---------- */
// list: ventas con .uid (vendedor) o sin uid y con .agent (nombre en el CRM que no se pudo emparejar)
/* ---------- desvinculados: gente del CRM que ya no está en la mesa ---------- */
const NOREP=/^(-+|n\/?a|none|null|undefined|sin asignar|no asignado|unassigned|system|sistema|admin)$/i;
const repName=n=>{n=String(n||'').replace(/\s+/g,' ').trim();return n&&!NOREP.test(n)&&/[a-zà-ÿ].*[a-zà-ÿ]/i.test(n)?n:''};
async function ensureFormers(rows){ // crea (o encuentra) a cada uno y le pasa sus ventas
  const names=[...new Set(rows.filter(x=>!x.uid&&repName(x.agent)).map(x=>repName(x.agent)))].slice(0,300),nuevos=[];
  if(!names.length)return nuevos;
  const {data,error}=await sb.rpc('add_formers',{nms:names}); // todos de una
  if(error){if(/add_former|PGRST202|42883/.test(String(error.message||error.code)))toast('Los desvinculados se activan en un rato (falta actualizar la base).','warn');else toast(esc(errMsg(error)),'err');return nuevos}
  for(const r of data||[])if(r&&r.id){for(const x of rows)if(!x.uid&&repName(x.agent)===r.name)x.uid=r.id;if(r.new)nuevos.push(r.id)}
  if(names.length)try{setMembers(await Q(sb.from('profiles').select('*').eq('team_id',profile.team_id).order('name')))}catch(e){}
  return nuevos;
}
function formersToast(ids,rows){
  const L=ids.map(id=>`<b>${esc(memberName(id))}</b> (${rows.filter(x=>x.uid===id).length})`);
  toast(`${ids.length===1?'Nuevo desvinculado':'Nuevos desvinculados'}: ${L.slice(0,8).join(', ')}${L.length>8?` y ${L.length-8} más`:''}. Sus ventas cuentan para la mesa.`,'ok',{sticky:1,key:'formers',actions:[{l:'¿Alguno es de la mesa?',fn:()=>formersModal(ids)}]});
}
function formersModal(ids){ // un desvinculado que en realidad es alguien de la mesa: se unen sus ventas
  const F=members.filter(m=>m.former&&(!ids||ids.includes(m.id))).sort((a,b)=>a.name.localeCompare(b.name));
  if(!F.length)return toast('No hay desvinculados para revisar.');
  const opts=members.filter(m=>m.active).sort((a,b)=>a.name.localeCompare(b.name)).map(m=>`<option value="${esc(m.id)}">Es ${esc(m.name)}</option>`).join('');
  modal({title:'Desvinculados',wide:1,body:`<p class="mp">Si alguno en realidad es alguien de la mesa (con otro nombre en el CRM), elegilo: sus ventas pasan a esa persona y queda guardado para la próxima.</p>
    <div class="fm-list">${F.map(m=>`<label class="fm-row"><span class="who-cell">${avatar(m.name)}<span><b>${esc(m.name)}</b><small>${plural(team.filter(f=>f.uid===m.id).length,'venta')}${m.crm_name&&m.crm_name!==m.name?' · en el CRM: '+esc(m.crm_name):''}</small></span></span>
      <select data-fm="${esc(m.id)}"><option value="">Desvinculado</option>${opts}</select></label>`).join('')}</div>`,
    actions:[{l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
      const pick=[...api.box.querySelectorAll('[data-fm]')].filter(s=>s.value).map(s=>[s.dataset.fm,s.value]);
      if(!pick.length)return;
      let n=0;for(const [src,dst] of pick){const r=await B.rpc('merge_former',{src,dst});if(r&&r.ok)n+=r.moved}
      await reloadMembers();team=(await fetchAll('sales','*','date')).map(S2F);mine();refresh();
      toast(`Listo: ${plural(n,'venta pasó','ventas pasaron')} a quien corresponde.`);
    }}]});
}
async function addForSellers(list,src){
  const sin=list.filter(x=>!x.uid);
  const ok=list.filter(x=>x.uid);
  let added=0;
  if(ok.length){
    const next={};const rows=ok.sort(byDate).map(f=>{next[f.uid]=next[f.uid]||nextNFor(f.uid);const o={...f,n:next[f.uid]++};delete o.agent;return o});
    const T=toast('Guardando…','ok',{sticky:1});
    const r=await B.addMany(rows,(i,t)=>T.set(`Guardando… ${i}/${t}`));T.close();
    if(!r)return {err:'no se pudo guardar en la base'};
    added=rows.length;
    const per={};for(const x of rows)per[x.uid]=(per[x.uid]||0)+1;
    toast(`${plural(added,'venta nueva','ventas nuevas')} ${esc(src||'')}: ${Object.entries(per).map(([u,n])=>`${esc(memberName(u).split(/\s+/)[0])} ${n}`).join(', ')}`);
  }
  if(sin.length){
    const names=[...new Set(sin.map(x=>x.agent||''))];
    toast(`${plural(sin.length,'venta')} sin vendedor${names.some(Boolean)?': '+names.filter(Boolean).map(n=>`<b>${esc(n)}</b>`).join(', '):''}.`,'warn',{sticky:1,key:'asignar',actions:[{l:'Asignar',fn:()=>assignModal(sin,src)}]});
  }
  return {added,unmatched:sin.length};
}
function assignModal(rows,src){ // "¿quién es «J. Ortega»?" → se guarda como nombre en el CRM y se cargan
  const names=[...new Set(rows.map(x=>x.agent||''))];
  const body=`<p class="mp">Elegí quién es cada uno. Queda guardado para la próxima.</p>`+names.map((n,i)=>`<label class="fld" style="margin-top:10px"><span>${n?`En el CRM: <b>${esc(n)}</b> (${rows.filter(x=>(x.agent||'')===n).length})`:`Sin nombre de agente (${rows.filter(x=>!x.agent).length})`}</span>
    <select data-an="${i}"><option value="">No es de la mesa: no cargar</option>${sellerOpts('')}</select></label>`).join('');
  modal({title:'Asignar ventas',body,actions:[{l:'Cancelar'},{l:'Cargar',cls:'pri',fn:async api=>{
    const pick=names.map((n,i)=>api.q(`[data-an="${i}"]`).value);
    for(let i=0;i<names.length;i++)if(pick[i]&&names[i]){const r=await B.rpc('set_crm_name',{uid:pick[i],nm:names[i]});if(r){const m=members.find(x=>x.id===pick[i]);if(m)m.crm_name=names[i]}}
    const list=rows.map(x=>({...x,uid:pick[names.indexOf(x.agent||'')]||null})).filter(x=>x.uid);
    if(list.length)await addForSellers(list,src);
  }}]});
}

/* ---------- FTDs sin detalle: ya no se cargan (las ventas entran solo desde el CRM con la extensión); los viejos se pueden quitar ---------- */
function quitarAjuste(ym){
  if(!noRO())return;const n=ajustes[ym]||0;if(!n)return;
  modal({title:'Quitar los FTDs sin detalle',body:`<p class="mp">${esc(mLong(ym))} tiene ${plural(n,'FTD')} sin detalle. Si ${n===1?'lo':'los'} quitás, no se ${n===1?'puede':'pueden'} volver a cargar: las ventas entran solo desde el CRM con la extensión.</p>`,
    actions:[{l:'Cancelar'},{l:'Quitar',cls:'pri',fn:async()=>{if(!await B.setAjuste(ym,0))return false;toast(`${esc(mLong(ym))}: sin FTDs sin detalle.`,'ok',{key:'aj'});refresh()}}]});
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
    <label class="fld" style="flex:3 1 200px"><span>Palabra clave <small class="dim">(del cliente)</small></span><input name="kw" value="${esc(p?p.kw:'')}" placeholder="la que acordaste con el cliente"></label>
    <label class="fld" style="flex:0 1 150px"><span>Fecha</span><input type="date" name="pdate" value="${d}"></label>
    <label class="fld" style="flex:0 1 104px"><span>Hora</span><input type="time" name="ptime" value="${t}"></label>
    ${p?'':'<button type="submit" class="btn pri">Agendar</button>'}</div>
    <div class="chips" style="margin-top:8px">${[['Hoy',0],['Mañana',1],['Pasado',2],['En una semana',7]].map(([l,n])=>`<button type="button" class="chip" data-dd="${n}">${l}</button>`).join('')}</div>`;
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
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return {err:'Fecha inválida.',k:'pdate'}; // la palabra clave es opcional (es un dato del cliente)
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
    if(await dncBlock(R.id))return;
    const n=pend.reduce((a,p)=>Math.max(a,p.n||0),0)+1;
    if(!await B.addPend({n,id:R.id,kw:R.kw,due:R.due,notified:false,done:false,created:new Date().toISOString()}))return;
    syncAgKw(R.id,R.kw);
    const dd=parseDue(R.due);
    toast(`✔ Agendado #${n} · <b>${esc(R.id)}</b>${R.kw?' · '+esc(R.kw):''} · ${esc(whenTxt(dd))} <span class="dim">(${esc(rel(dd))})</span>`);
    form.querySelector('[name=pid]').value='';form.querySelector('[name=kw]').value='';
    form.querySelector('[name=pdate]').value=addDays(todayS(),1);form.querySelector('[name=ptime]').value=cfg.hora;F.mark();
    form.querySelector('[name=pid]').focus();primeAudio();check();
  });
}
function pendItem(p,now,compact){
  const d=parseDue(p.due),venc=!p.done&&d<=now,f=!p.done&&soldOf(p.id),cs=!p.done&&crmStatusOf(p.id),dn=cs&&cs.grp==='dnc';
  const st=p.done?'hecho'+(p.doneAt?' '+dayLabel(new Date(p.doneAt)):''):venc?'vencido · '+rel(d):rel(d);
  const tags=(f?`<span class="badge paid" title="${esc(money(f.amount))} USD">Ya depositó ${esc(f.date===todayS()?'hoy':dm(f.date))}${f.uid!==me?' con '+esc(first(f.uid)):''}</span>`:'')+(dn?'<span class="badge bad">Do Not Call</span>':cs&&!f?stBadge(cs):'');
  const acts=p.done?`<button type="button" class="ib" data-act="pDeshacer" title="Volver a pendiente">Deshacer</button><button type="button" class="ib del" data-act="pDel" title="Borrar">Borrar</button>`
    :`<button type="button" class="btn sm pri" data-act="pHecho">${f||dn?'Cerrar':'Hecho'}</button><button type="button" class="ib" data-act="pMas" data-m="60" title="Posponer 1 hora">+1 h</button>`+
     (compact?'':`<button type="button" class="ib" data-act="pManana" title="Pasar a mañana">Mañana</button><button type="button" class="ib" data-act="pEdit" title="Editar">Editar</button><button type="button" class="ib del" data-act="pDel" title="Borrar">Borrar</button>`);
  return `<div class="ai${venc?' venc':''}${p.done?' done':''}" data-pid="${esc(p._id)}"><span class="wh ${venc?'warn':!p.done&&p.due.slice(0,10)===todayS()?'info':'dim'}">${esc(whenTxt(d))}</span><span class="id">${esc(p.id)}</span><span class="kw" title="${esc(p.kw)}">${esc(p.kw)}<small>${esc(st)}</small>${tags?' '+tags:''}</span><span class="ac wr">${acts}</span></div>`;
}
const pendOf=el=>{const r=el.closest('[data-pid]');return r&&pend.find(p=>p._id===r.dataset.pid)};
const clearAlert=p=>{const t=$(`#toasts [data-key="p${p._id}"]`);if(t)t.remove()};
async function pendHecho(p){
  if(!p||!noRO())return;
  if(await B.updPend(p,{done:true,doneAt:new Date().toISOString()})){clearAlert(p);toast(`✔ #${p.n} · <b>${esc(p.id)}</b> · ${esc(p.kw)} → hecho`,'ok',{actions:[{l:'Deshacer',fn:()=>B.updPend(p,{done:false,doneAt:null})}]})}
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
  modal({title:`Editar contacto #${p.n}`,body:`<div class="agform">${agFields(p)}</div>${(h=>h?`<p class="p-sub ag-hint">${esc(h)}</p>`:'')(cobroHint((crmStatusOf(id)||{}).country))}<div class="ebox" id="pErr"></div>`,wide:1,
    actions:[{l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
      const R=readAg(api.box);if(R.err){api.q('#pErr').textContent=R.err;return false}
      const ch={id:R.id,kw:R.kw};if(R.due!==p.due){ch.due=R.due;ch.notified=false}
      if(!await B.updPend(p,ch))return false;syncAgKw(R.id,R.kw);clearAlert(p);toast(`✔ #${p.n} actualizado`);
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
  const brow=b=>`<div class="brow"><select aria-label="Tipo de descanso"><option value="10"${b&&b.k===10?' selected':''}>10'</option><option value="30"${b&&b.k===30?' selected':''}>30'</option></select><input type="time" class="bs" value="${b?hm(b.s):''}" aria-label="Inicio"><input type="time" class="be" value="${b?hm(b.e):''}" aria-label="Fin"><button type="button" class="ib del" data-rm aria-label="Quitar">Quitar</button></div>`;
  const body=`<div class="fgrid">
    ${isNew?`<label class="fld full"><span>Fecha</span><input type="date" name="tdate" max="${todayS()}" value="${d0}"></label>`:''}
    <label class="fld"><span>Entrada</span><input type="time" name="tin" value="${t?hm(t.in):''}"></label>
    <label class="fld"><span>Salida</span><input type="time" name="tout" value="${t?hm(t.out):''}"></label></div>
    <div class="fld" style="margin-top:14px"><span>Descansos: tipo, inicio y fin</span></div>
    <div id="tbRows" style="margin-top:6px">${(t?t.breaks:[]).map(brow).join('')}</div>
    <button type="button" class="btn sm" id="tbAdd">Agregar descanso</button><div class="ebox" id="tErr"></div>`;
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
  const acts=[{l:'Cancelar'},{l:'Guardar',cls:'pri',fn:save}];
  if(t)acts.unshift({l:'Borrar jornada',cls:'danger l',fn:async()=>{if(!await confirmar('Borrar jornada',`¿Borrar la jornada del ${dm(date)}?`,'borrar',true))return false;if(await B.delTurno(date)){toast(`✔ Jornada del ${dm(date)} borrada.`);turnoBar(true)}}});
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
  const ag=s(r.agent,80),u=s(r.uid,40);
  const date=s(r.date,10),reg=s(r.reg,16),amount=+r.amount;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>todayS()||!s(r.id)||!isFinite(amount))return null;
  const o={date,time:/^\d{2}:\d{2}$/.test(s(r.time,5))?s(r.time,5):'',id:s(r.id,40),name:s(r.name),country:s(r.country,60),aff:s(r.aff,60),camp:s(r.camp),amount:Math.round(amount*100)/100,brand:s(r.brand,40)||DEF_BRAND};
  const tx=s(r.tx,60);if(tx)o.tx=tx;
  o.reg=/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(reg)&&reg.slice(0,10)<=date?reg:date;
  if(ag)o.agent=ag;if(u)o.uid=u;if(r.rep)o.rep=1;
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
  if(isLeader()&&nuevas.some(x=>(x.uid&&x.uid!==me)||x.agent||x.rep)){ // team leader: cada venta a su vendedor
    for(const x of nuevas){x.uid=x.uid&&members.some(m=>m.id===x.uid)?x.uid:x.agent?agentUid(x.agent):x.rep?null:me;delete x.rep}
    const nuevos=await ensureFormers(nuevas); // los que ya no están en la mesa quedan como desvinculados
    const r=await addForSellers(nuevas,'desde el CRM');
    if(r.err)return r;
    if(nuevos.length)formersToast(nuevos,nuevas);
    return {added:r.added,dup,bad,unmatched:r.unmatched,formers:nuevos.length,ids:nuevas.filter(x=>x.uid).map(f=>f.id),mes:mesOut()};
  }
  let ajenas=0;
  if(nuevas.some(x=>x.agent)){const mias=nuevas.filter(x=>!x.agent||agentUid(x.agent)===me);ajenas=nuevas.length-mias.length;nuevas.length=0;nuevas.push(...mias)} // un agente: solo las suyas
  if(!nuevas.length)return {added:0,dup,bad,ajenas,mes:mesOut()};
  for(const x of nuevas){delete x.agent;delete x.uid}
  const months=[...new Set(nuevas.map(x=>x.date.slice(0,7)))],before=Object.fromEntries(months.map(m=>[m,calc(m).tier]));
  let n=nextN()-1;const list=nuevas.sort(byDate).map(f=>({...f,n:++n}));
  if(!await B.addMany(list))return {err:'no se pudo guardar en la base'};
  const l=list[list.length-1];last={brand:l.brand,country:l.country,aff:l.aff,camp:l.camp};local.set('last',last);
  toast(`⇪ ${list.length===1?'1 venta nueva':list.length+' ventas nuevas'} desde el CRM: ${list.map(f=>`<b>${esc(f.id)}</b>`).join(', ')}${dup?` · ${dup} ya estaba${dup>1?'n':''}`:''}`);
  for(const m of months){const s=calc(m);if(s.tier>before[m]){toast(`🎉 ¡${s.n} FTDs! Bono de ${s.bono} USD desbloqueado.`,'win',{ms:9000});beep(2)}}
  return {added:list.length,dup,bad,ajenas,ids:list.map(f=>f.id),mes:mesOut()};
}

/* ---------- CSV ---------- */
async function exportar(){
  const name=`ftds_${todayS()}.csv`,data=csvText();auditNote('exportó ventas',{filas:ftds.length});
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
  modal({title:'CSV',body:`<p class="mp ${copied?'ok':'warn'}">${copied?'No se pudo descargar; quedó copiado al portapapeles.':'No se pudo descargar.'}</p><textarea class="csv" readonly>${esc(csvText(false))}</textarea>`,actions:[{l:'Cerrar',cls:'pri'}],wide:1});
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
          actions:[{l:'Cancelar'},{l:'Seguir',cls:'pri',fn:api=>{v=api.q('#imB').value.trim()||DEF_BRAND}}],onClose:()=>res(v)});
      });
      if(brand==null)return;
    }
    for(const x of R.ok)if(!x.brand)x.brand=brand;
    const K=dupKeys();
    const nuevas=R.ok.filter(x=>!isDup(x,K));
    const rep=R.ok.length-nuevas.length;
    if(!nuevas.length)return toast(`${esc(file.name)}: las ${R.ok.length} ventas ya estaban cargadas.`,'warn');
    const lat=nuevas.filter(isLate).length;
    if(isLeader()){ // el team leader elige de quién son (o según la columna de agente del archivo)
      const hasAg=nuevas.some(x=>x.agent);
      const who=await new Promise(res=>{let v=null;
        modal({title:`¿De quién son? · ${esc(file.name)}`,body:`<p class="mp"><b>${plural(nuevas.length,'venta nueva','ventas nuevas')}</b>${lat?` (${lat} late)`:''}${rep?`, ${rep} ya estaba${rep>1?'n':''}`:''}${R.bad?`, ${sp('warn',plural(R.bad,'fila')+' con errores')}`:''}</p>
          <label class="fld"><span>Vendedor</span><select id="imW">${hasAg?'<option value="col">Según la columna de agente del archivo</option>':''}${sellerOpts(me)}</select></label>`,
          actions:[{l:'Cancelar'},{l:'Agregar',cls:'pri',fn:api=>{v=api.q('#imW').value}}],onClose:()=>res(v)});
      });
      if(who==null)return;
      for(const x of nuevas)x.uid=who==='col'?(agentUid(x.agent)||null):who;
      return addForSellers(nuevas,`de ${file.name}`);
    }
    if(!await confirmar(`Importar ${esc(file.name)}`,`<b>${plural(nuevas.length,'venta nueva','ventas nuevas')}</b>${lat?` (${lat} late)`:''}${rep?` · ${rep} ya estaba${rep>1?'n':''}`:''}${R.bad?` · ${sp('warn',plural(R.bad,'fila')+' con errores')}`:''}`,'Agregar'))return;
    let n=nextN()-1;
    const list=nuevas.sort(byDate).map(f=>{const o={...f,n:++n};delete o.agent;delete o.uid;return o});
    const T=toast('Guardando…','ok',{sticky:1});
    const ok=await B.addMany(list,(i,t)=>T.set(`Guardando… ${i}/${t}`));
    T.close();if(ok)toast(`${list.length===1?'Agregada 1 venta':'Agregadas '+list.length+' ventas'}.`);
  };
  fi.click();
}


/* ---------- puente con la extensión de Chrome (avisos de agenda) ---------- */
let extSig='',extOk=0,extN=0,extBeat=0,extVer='',extWarned=0;
const extOn=()=>extOk&&Date.now()-extOk<3*6e4;
const vcmp=(a,b)=>{const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);for(let i=0;i<3;i++){const d=(x[i]||0)-(y[i]||0);if(d)return d}return 0};
const extOld=()=>extOn()&&/^\d/.test(EXT_VER)&&vcmp(extVer||'0',EXT_VER)<0; // la extensión instalada es más vieja que la que se baja
function postTop(msg){try{window.postMessage(msg,location.origin);return true}catch(e){return false}} // la extensión escucha en esta misma ventana
function syncExt(){
  if(!ready)return;
  const items=pend.filter(p=>!p.done&&!soldOf(p.id)&&!isDnc(p.id)).map(p=>({k:p._id,n:p.n,id:p.id,kw:p.kw,due:parseDue(p.due).getTime()})).sort((a,b)=>a.due-b.due);
  // ventas que ya están en la mesa: el botón del CRM ofrece solo las nuevas
  const known={ids:team.map(f=>norm(f.brand||'')+'|'+norm(f.id)),txs:team.filter(f=>f.tx).map(f=>norm(f.brand||'')+'|'+f.tx)};
  const snips=activeSnips().map(s=>({s:s.shortcut,t:s.title||'',b:s.body}));
  const leadIds=leads.map(l=>norm(l.id)); // clientes new que ya están en la mesa
  const sig=JSON.stringify(items)+'#'+known.ids.length+'#'+known.ids.join(',').length+'#'+known.txs.length+'#'+JSON.stringify(snips)+'#'+leadIds.length+'#'+profile.role+'#'+members.map(m=>m.id+(m.crm_name||'')+m.active).join(),beat=extOk&&Date.now()-extBeat>6e4;
  if(sig===extSig&&!beat)return;
  extSig=sig;extBeat=Date.now();
  const desk={role:profile.role,me,members:members.filter(m=>m.active||m.former).map(m=>({id:m.id,name:m.name,crm:m.crm_name||'',act:!!m.active}))}; // para el botón del CRM del team leader
  postTop({type:'ftd-agenda',v:1,items,known,snips,leadIds,desk,user:profile&&profile.name,sent:Date.now()});
}
window.addEventListener('message',e=>{
  const d=e.data;
  if(d&&d.type==='ftd-agenda-test-ack'&&d.v===1){
    if(d.ok)toast('La extensión mostró el aviso con tarjeta y sonido.','ok',{ms:6000});
    else toast('La extensión no pudo avisar'+(d.err?': '+esc(d.err):'.'),'err');
    return;
  }
  if(e.source!==window||e.origin!==location.origin)return; // solo la extensión, desde esta misma pestaña
  if(d&&d.type==='ftd-agenda-import'&&d.v===1){ // ventas mandadas desde el botón del CRM
    const src=e.source;
    importFromExt(d.rows).catch(err=>({err:String(err&&err.message||err)})).then(res=>{try{src.postMessage({type:'ftd-agenda-import-ack',v:1,reqId:d.reqId,...res},'*')}catch(x){}});
    return;
  }
  if(d&&d.type==='ftd-agenda-leads'&&d.v===1&&Array.isArray(d.rows)){ // clientes "new" que vio la extensión en el CRM
    const src=e.source;
    addLeadsFromExt(d.rows).then(res=>{try{src.postMessage({type:'ftd-agenda-leads-ack',v:1,reqId:d.reqId,...res},'*')}catch(x){}});
    return;
  }
  if(d&&d.type==='ftd-agenda-cmd'&&d.v===1&&(d.cmd==='reply'||d.cmd==='quiet')){socialCmd(d);return} // desde la tarjeta social de la extensión
  if(d&&d.type==='ftd-agenda-seen'&&d.v===1&&Array.isArray(d.rows)){ // todos los clientes que vio la extensión en el CRM
    const src=e.source;
    crmSeenFromExt(d.rows).then(res=>{try{src.postMessage({type:'ftd-agenda-seen-ack',v:1,reqId:d.reqId,...res},'*')}catch(x){}});
    return;
  }
  if(d&&d.type==='ftd-agenda-station'&&d.v===1&&Array.isArray(d.views)){stationFromExt(d.views);return} // la extensión de esta compu es la estación: cómo le fue con cada vista
  if(d&&d.type==='ftd-agenda-cmd'&&d.v===1&&d.cmd==='nuevo'){fichaNew(String(d.k||'').slice(0,60));return} // entró un new: la ficha se abre cuando entres
  if(d&&d.type==='ftd-agenda-cmd'&&d.v===1&&d.cmd==='actual'){const k=String(d.k||'').slice(0,60),r=String(d.r||'').slice(0,120);if(!k)return;if(ready)setCurrent(k,r,'crm');else{curCl={id:k,name:r,src:'crm',at:Date.now()};local.set('curCl',curCl)}return} // el cliente abierto en el CRM (si Vitalis todavía está arrancando, queda para cuando entre)
  if(d&&d.type==='ftd-agenda-cmd'&&d.v===1&&d.cmd==='banking'){if(ready)go('banking');return} // desde la tarjeta de una falla de pago
  if(d&&d.type==='ftd-agenda-cmd'&&d.v===1&&d.cmd==='chat'){if(ready)go('chat',{chat:String(d.k||'').split(':')[0]});return} // un aviso trae chat:aId
  if(d&&d.type==='ftd-agenda-tick'&&d.v===1){extIdle(d.idle);if(Date.now()-extBeat>6e4){extSig='';syncExt()}if(needCatch())catchUp();return} // la extensión despierta a la pestaña: le confirmo que sigo (así sé que está) y me pongo al día solo si hace falta
  if(d&&d.type==='ftd-agenda-cmd'&&d.v===1&&d.cmd==='done'){ // "✔ hecho" tocado en el aviso de Chrome
    const p=pend.find(x=>x._id===d.k);
    if(p&&!p.done&&!readOnly)B.updPend(p,{done:true,doneAt:new Date().toISOString()}).then(ok=>{if(ok){clearAlert(p);toast(`✔ #${p.n} · <b>${esc(p.id)}</b> · ${esc(p.kw)} → hecho (desde el aviso)`)}});
    return;
  }
  if(!d||d.type!=='ftd-agenda-ack'||d.v!==1)return;
  const was=extOn();extOk=Date.now();extN=+d.scheduled||0;extVer=String(d.ver||'').slice(0,12);
  if(extOld()&&!extWarned){extWarned=1;toast(`Tu extensión de Chrome es vieja${extVer?' ('+esc(extVer)+')':''}: bajá la ${esc(EXT_VER)} en Ajustes, cargala de nuevo y recargá el CRM.`,'warn')}
  if(!was){status();if(cur==='config'||cur==='agenda')V[cur].render({})}
});

async function addLeadsFromExt(rows){
  if(!ready||readOnly)return {err:'Vitalis todavía está cargando'};
  const s=v=>String(v??'').replace(/\s+/g,' ').trim(),te=todayS(),have=new Set(leads.map(l=>norm(l.id))),seen=new Set(),list=[];
  for(const r of rows.slice(0,300)){
    const id=s(r.id).slice(0,60),name=s(r.name).slice(0,120);if(!id&&!name)continue;
    const key=id||('n:'+norm(name)),k=norm(key);
    if(have.has(k)||seen.has(k)){seen.add(k);continue}
    seen.add(k);list.push({id:key,name,country:s(r.country).slice(0,60),date:/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.date<=te?r.date:te});
  }
  const keys=[...seen];
  if(!list.length)return {added:0,keys};
  const n=await B.addLeads(list,'crm');if(n===false)return {err:'no se pudo guardar'};
  if(n)toast(`${n===1?'Nuevo cliente':n+' clientes nuevos'} en el registro: ${list.slice(0,4).map(l=>`<b>${esc(l.id.startsWith('n:')?l.name:l.id)}</b>`).join(', ')}${list.length>4?'…':''}`,'imp',{key:'leads'});
  return {added:n,keys};
}
// al agendar, si pusiste una palabra clave distinta a la del cliente, se guarda como palabra clave del cliente (vacía no la borra)
async function syncAgKw(id,kw){kw=(kw||'').trim();if(kw&&kw!==clientKw(id)){try{await setClientKw(id,clientBrand(id),kw)}catch(e){}}}
function agendarModal(id,kw){
  if(!noRO())return;
  const p={id,kw:kw!=null?kw:clientKw(id),due:`${addDays(todayS(),1)}T${cfg.hora}`}; // arranca con la palabra clave del cliente
  modal({title:`Agendar a ${esc(id)}`,body:`<div class="agform">${agFields(p)}</div><div class="ebox" id="pErr"></div>`,wide:1,
    actions:[{l:'Cancelar'},{l:'Agendar',cls:'pri',fn:async api=>{
      const R=readAg(api.box);if(R.err){api.q('#pErr').textContent=R.err;return false}
      if(parseDue(R.due)<new Date(Date.now()-6e4)){api.q('#pErr').textContent='Esa fecha y hora ya pasó.';return false}
      const n=pend.reduce((a,x)=>Math.max(a,x.n||0),0)+1;
      if(!await B.addPend({n,id:R.id,kw:R.kw,due:R.due,notified:false,done:false}))return false;
      syncAgKw(R.id,R.kw);
      toast(`Agendado <b>${esc(R.id)}</b> para ${esc(whenTxt(parseDue(R.due)))}.`);check();
    }}],onOpen:api=>bindAgFields(api.box)});
}
function clienteModal(){
  if(!noRO())return;
  modal({title:'Registrar cliente new',body:`<div class="fgrid"><label class="fld"><span>ID <i>*</i></span><input id="ncI" autofocus></label><label class="fld"><span>Día</span><input type="date" id="ncD" max="${todayS()}" value="${todayS()}"></label>
    <label class="fld full"><span>Nombre</span><input id="ncN"></label><label class="fld"><span>País</span><input id="ncP"></label></div><div class="ebox" id="ncE"></div>`,
    actions:[{l:'Cancelar'},{l:'Registrar',cls:'pri',fn:async api=>{
      const id=api.q('#ncI').value.trim(),d=api.q('#ncD').value||todayS();if(!id){api.q('#ncE').textContent='Falta el ID.';return false}
      const ya=leads.find(l=>norm(l.id)===norm(id));if(ya){api.q('#ncE').textContent=`Ya está registrado (${ya.uid===me?'lo anotaste vos':'lo anotó '+memberName(ya.uid)} el ${dm(ya.date)}).`;return false}
      const n=await B.addLeads([{id,name:api.q('#ncN').value.trim(),country:api.q('#ncP').value.trim(),date:d}],'manual');
      if(n===false)return false;if(!n){api.q('#ncE').textContent='Ya estaba registrado en la mesa.';return false}
      toast(`Cliente <b>${esc(id)}</b> registrado.`);
    }}]});
}

/* ---------- avisos ---------- */
function fire(p){
  const d=parseDue(p.due),late=Date.now()-d>5*6e4;
  toast(`⏰ Contactar a <b>${esc(p.id)}</b>: ${esc(p.kw)}<br><span style="font-weight:500">${esc(whenTxt(d))}${late?', atrasado':''}</span>`,'alert',
    {sticky:1,key:'p'+p._id,actions:[{l:'Hecho',fn:()=>pendHecho(p)},{l:'+15 min',fn:()=>posponer(p,15)},{l:'+1 h',fn:()=>posponer(p,60)}]});
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
    const d=parseDue(p.due);if(d<=now){if(!soldOf(p.id)&&!isDnc(p.id))fire(p);if(!readOnly)B.updPend(p,{notified:true});else p.notified=true}
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
  toast(first?`⏰ Terminó el descanso de ${b.k}' (${hhmm(b.s)})`:`⏰ Descanso de ${b.k}': +${mins(ms-end)} min`,'alert',{sticky:1,key:'brk',actions:[{l:'Volví',fn:()=>marcar('vuelta')}]});
  beep(3);flash();sysNotify(`☕ Terminó el descanso de ${b.k}'`,hhmm(b.s),'ftdc-break');
}

/* ---------- ayuda ---------- */
function ayuda(){
  const fon=nf((FONASA_TASA[cfg.fonasa]||.045)*100,1).replace(',0','');
  modal({title:'Cómo funciona Vitalis',wide:1,actions:[{l:'Listo',cls:'pri'}],body:`<div class="help">
  <h4>Entrar</h4><dl>
    <dt>Nombre y PIN</dt><dd>Elegís tu nombre. La primera vez el PIN es 0000 y creás el tuyo. Si te lo olvidás, el administrador lo vuelve a 0000.</dd>
    <dt>Bloqueo</dt><dd>5 errores seguidos bloquean 15 minutos; si se repite, cada bloqueo dura el doble.</dd></dl>
  <h4>Inicio</h4><dl>
    <dt>Lo tuyo</dt><dd>Tus FTDs del mes, cuánto falta para el próximo bono y para tu target (si el team leader te puso uno), el líquido, tu turno y tu agenda de hoy.</dd>
    <dt>La mesa</dt><dd>Cuántos FTDs lleva la mesa, cuánto falta para el target, cuántos por día hábil y a qué ritmo vamos. La marca en la barra es dónde hay que cerrar hoy para ir al día.</dd>
    <dt>Ventas de hoy</dt><dd>Todas las de la mesa, en vivo: hora, quién, cliente, campaña y monto. <b>Ver en Ventas</b> las abre con los filtros.</dd>
    <dt>Team leader</dt><dd>Su inicio es el de toda la mesa: el target en la pista, quién está en turno y cada agente con sus FTDs de hoy y del mes. El team leader no cuenta como agente.</dd></dl>
  <h4>Ventas</h4><dl>
    <dt>New y late</dt><dd>New: se registró y depositó el mismo día. Late: el registro es de un día anterior al FTD.</dd>
    <dt>Fechas</dt><dd>En <b>Período</b>: hoy, ayer, la semana, el mes o un mes entero. O días exactos en Desde y Hasta. Con un rango de hasta dos meses, el gráfico va por día.</dd>
    <dt>Filtros</dt><dd>Campaña y afiliador exactos. País sin importar tildes. Tocar un ranking filtra; otro toque lo saca.</dd>
    <dt>Duplicados</dt><dd>Mismo ID y misma marca en la mesa: avisa antes de guardar.</dd></dl>
  <h4>Ahora</h4><dl>
    <dt>El orden</dt><dd>1) los new sin depositar, del más nuevo al más viejo; 2) las agendas de hoy y vencidas; 3) Call Again, Hang Up y NA (No Answer, NA-2 a NA-5). Si los del 3 son más que el tope (60, lo cambia el team leader), van solo los registrados en el mes.</dd>
    <dt>Fuera</dt><dd>Not interested y Low potential (estos se pueden agendar). Do Not Call no aparece nunca y no se puede agendar. Los que ya depositaron salen solos.</dd>
    <dt>Ficha</dt><dd>Tocá un ID para ver al cliente, su campaña, afiliador y país con sus números. Cuando entra un new, la ficha se abre sola al volver a Vitalis.</dd></dl>
  <h4>Clientes</h4><dl>
    <dt>Registro</dt><dd>Con la extensión, todos los clientes que ves en cualquier pestaña del CRM se guardan con su status, registro y agente. Una sola pestaña se actualiza sola: la que elegís con <b>Actualizar esta pestaña</b>; esa avisa cuando entra un new.</dd>
    <dt>Conversión</dt><dd>De los registrados en el período, cuántos depositaron el mismo día (new) y cuántos después (late). Late es cuando el FTD cae otro día calendario que el registro.</dd></dl>
  <h4>Banking</h4><dl>
    <dt>Procesadores</dt><dd>Qué procesadores y métodos de pago andan, por país. Si algo falla, aparece arriba del inicio y te llega un aviso urgente; cuando vuelve, un aviso normal.</dd>
    <dt>Bancos</dt><dd>Cómo conviene pagar según el banco del cliente: pasos, qué usar y qué evitar (por ejemplo, Falabella Chile: no transferencia). Lo cargan el administrador y el team leader, con fotos.</dd></dl>
  <h4>Snippets</h4><dl>
    <dt>Usarlos</dt><dd>Escribí /atajo en cualquier campo de cualquier página de Chrome (con la extensión) y se reemplaza por el texto. Si otro atajo empieza igual, se completa al tocar espacio o Tab.</dd>
    <dt>Clic derecho</dt><dd>Si en alguna página el /atajo no anda: clic derecho en el campo → <b>Snippets de Vitalis</b> → el que quieras.</dd>
    <dt>Variables</dt><dd>{fecha}, {hora}, {yo} (tu nombre) y {cursor} (dónde queda el cursor).</dd>
    <dt>Compartidos</dt><dd>Los ve toda la mesa. Si tenés uno tuyo con el mismo atajo, se usa el tuyo.</dd></dl>
  <h4>Chat</h4><dl>
    <dt>Chats</dt><dd>Uno de toda la mesa, grupos (Nuevo → varias personas y un nombre) y privados (Nuevo → una persona, o Mensaje en su perfil).</dd>
    <dt>Grupos</dt><dd>Cualquiera de adentro suma gente y le cambia el nombre. Quien lo creó puede sacar a alguien. Si se van todos, se borra.</dd>
    <dt>Imágenes</dt><dd>Pegalas con Ctrl+V, arrastralas o tocá el ícono al lado del mensaje. Van achicadas para que carguen rápido. Tocá una para verla grande, copiarla o bajarla.</dd>
    <dt>Responder y reaccionar</dt><dd>Pasá por un mensaje: ↩ para responderlo, ☺ para reaccionar. Tocá la cita para ir al mensaje original.</dd>
    <dt>@</dt><dd>Escribí @ y elegí a quién nombrar (flechas y Enter). El team leader tiene @todos.</dd>
    <dt>Compartir datos</dt><dd>Cada tarjeta con datos tiene el botón <svg class="ic" aria-hidden="true"><use href="#i-share"/></svg> arriba a la derecha: va al chat que elijas una foto de la tarjeta tal como la ves, con la hora, y un comentario si querés.</dd>
    <dt>Avisos del team leader</dt><dd>El team leader y los administradores pueden mandar lo que comparten como aviso: a todos los de ese chat les queda hasta que lo cierren, aunque lo tengan silenciado.</dd>
    <dt>/vitalis <small class="dim">(admin y team leader)</small></dt><dd>Escribí <b>/vitalis</b> y tu mensaje en el chat para que lo mande Vitalis. Sin elegir chat va a toda la mesa.</dd>
    <dt>Avisos</dt><dd>Llegan al instante, acá y (con la extensión) en la pestaña que estés. Silenciar un chat (desde su encabezado) solo calla ese chat. Si te nombran o te responden, el aviso llega igual; si es el team leader con @todos o @vos, llega aunque tengas todo silenciado.</dd>
    <dt>Colores</dt><dd>Rojo: urgente (agenda, descansos). Cuero: importante (tareas, clientes new, el team leader). Celeste: chat y social. Verde: logros.</dd></dl>
  <h4>Filtros</h4><dl>
    <dt>Qué muestra</dt><dd>Con las ventas de toda la mesa en el período que elijas: campañas, afiliadores, países y combinaciones que más venden, si suben o bajan contra el período anterior y cuándo fue la última.</dd>
    <dt>Lates</dt><dd>Qué campañas y afiliadores convierten lates (clientes que se registraron otro día y depositaron después), y de cuántos FTDs de cada una.</dd>
    <dt>Usarlo</dt><dd>Tocá un valor para copiarlo y pegarlo en el filtro del CRM. El team leader lo puede mandar como tarea.</dd></dl>
  <h4>Tareas</h4><dl>
    <dt>Para hacer</dt><dd>Las que te manda el team leader (campañas, afiliadores, fechas y status). Tocá un valor para copiarlo y pegarlo en el filtro del CRM. Cuando la termines, <b>Marcar hecha</b>.</dd>
    <dt>Team leader</dt><dd><b>Tarea</b> manda una a toda la mesa o a quienes elijas. En <b>Mandadas</b> ves quién ya la hizo.</dd></dl>
  <h4>Social</h4><dl>
    <dt>Pedidos</dt><dd>Pedir un mate (cada 20 min) o salir a los 10 o a la media, a toda la mesa o a alguien. Le llega como aviso; el primero que contesta se lo lleva.</dd>
    <dt>Perfiles</dt><dd>Tocá a alguien (en Social, en el chat o en Equipo) para ver sus números y darle un toque 👉 (uno cada 2 min por persona).</dd>
    <dt>Tu foto</dt><dd>En Ajustes → Mi cuenta (o tocando tu foto en tu perfil). Se recorta cuadrada y la ve toda la mesa.</dd>
    <dt>Silenciar</dt><dd>En Social: por 1 hora, hasta mañana o siempre. Solo calla los pedidos sociales (mate, salidas, toques), no el chat ni los clientes new. Los demás ven 🔕 al lado de tu nombre.</dd></dl>
  <h4>Team leader</h4><dl>
    <dt>Ventas de la mesa</dt><dd>En Nueva venta elegís el vendedor. En el CRM, si la tabla tiene la columna Sales Rep, las ventas nuevas se pasan solas a cada vendedor; las de alguien que ya no está en la mesa entran a su nombre como <b>desvinculado</b> (cuentan para la mesa; en Ajustes se ven aparte y, si alguno era de la mesa con otro nombre, se une) y las que no tienen vendedor quedan para asignar. Sin esa columna, el botón las pasa a quien elijas en "De". En Ajustes → Mesa ponés cómo figura cada uno en el CRM.</dd></dl>
  <h4>Equipo (team leader)</h4><dl>
    <dt>Target</dt><dd><b>Fijar target</b> (en Equipo o en el inicio): los FTDs que tiene que hacer la mesa en el mes. Lo ve toda la mesa.</dd>
    <dt>Por agente</dt><dd>En Equipo → <b>Por agente</b> (o tocando la columna Target): el target de cada uno. <b>Repartir el de la mesa</b> lo divide parejo. Cada uno ve el suyo en el inicio; los demás no.</dd>
    <dt>Ficha</dt><dd>De cada uno: el mes (FTDs, sin detalle, conversión, faltas), su agenda de clientes, turnos, clientes new y tareas. El sueldo no aparece.</dd></dl>
  <h4>Sueldo</h4><dl>
    <dt>Cobro</dt><dd>El 5º día hábil del mes (sin domingos, sin feriados ni días que no se trabajan, según tus días de trabajo en Ajustes). Arriba en Sueldo está la cuenta regresiva.</dd>
    <dt>Bonos</dt><dd>No acumulables: cobrás solo el escalón más alto que alcanzaste.</dd>
    <dt>Ventas</dt><dd>Entran solas desde el CRM con la extensión. Ya no se cargan FTDs sin detalle.</dd>
    <dt>Líquido</dt><dd>Estimación con valores BPS 2026: jubilatorio 15%, FONASA ${fon}% (3% hasta 2,5 BPC), FRL 0,1% e IRPF por franjas. Sin aguinaldo ni vacacional.</dd></dl>
  <h4>Turno y agenda</h4><dl>
    <dt>Jornada</dt><dd>${dur(jorMs())} desde la entrada. Los descansos cuentan como trabajados.</dd>
    <dt>Avisos</dt><dd>Tarjeta, sonido y destello acá. Con la extensión, también en la pestaña que estés y con Vitalis cerrado.</dd></dl>
  <h4>Extensión de Chrome</h4><dl>
    <dt>Qué hace</dt><dd>Avisos de agenda, botón en el CRM para pasar ventas, registro y aviso de clientes new, y los snippets en cualquier página. Las páginas del CRM con tabla se actualizan solas cada 10 s (si la estás usando, espera).</dd>
    <dt>Actualizar</dt><dd>Bajá el zip nuevo, descomprimilo en la misma carpeta y tocá ↻ en chrome://extensions.</dd>
    <dt>Instalar</dt><dd>Ajustes → Descargar extensión. Descomprimí el zip, abrí chrome://extensions, activá Modo de desarrollador, tocá Cargar descomprimida y elegí la carpeta. Recargá Vitalis.</dd></dl>
  <h4>Datos</h4><dl>
    <dt>Qué ve la mesa</dt><dd>Ventas, clientes, snippets compartidos y el target. Tu sueldo es solo tuyo. Tu agenda, turnos, faltas y FTDs sin detalle los ves vos y el team leader.</dd>
    <dt>CSV</dt><dd>Exportar incluye registro, tipo y marca. Importar acepta el export de la plataforma y no duplica.</dd></dl>
  <h4>Atajos de teclado</h4><dl>
    <dt><kbd>1</kbd>–<kbd>6</kbd>, <kbd>0</kbd></dt><dd>Secciones del menú, en orden (Inicio, Panel, Tareas, Chat, Banking, Análisis; 0 Ajustes)</dd><dt><kbd>L</kbd></dt><dd>Cliente: el que tenés abierto en el CRM</dd><dt><kbd>B</kbd></dt><dd>Banking</dd><dt><kbd>E</kbd></dt><dd>Equipo (team leader)</dd><dt><kbd>C</kbd></dt><dd>Chat</dd><dt><kbd>F</kbd></dt><dd>Filtros</dd><dt><kbd>T</kbd></dt><dd>Tareas</dd><dt><kbd>A</kbd></dt><dd>Agendar</dd><dt><kbd>/</kbd></dt><dd>Buscar ventas</dd><dt><kbd>?</kbd></dt><dd>Esta ayuda</dd></dl>
  </div>`});
}

/* ---------- clicks y teclas ---------- */
const hv=el=>el.closest('#iTurno')&&$('#itHora')?($('#itHora').value||''):'';
const ACT={
  locks:()=>locksModal(), // Ajustes: privacidad (solo el administrador)
  importar:()=>importar(),exportar:()=>exportar(),ayuda:()=>ayuda(),
  entrada:el=>marcar('entrada',hv(el)),d10:el=>marcar('d10',hv(el)),d30:el=>marcar('d30',hv(el)),vuelta:el=>marcar('vuelta',hv(el)),salida:el=>marcar('salida',hv(el)),
  deshacer:()=>deshacer(),editHoy:()=>{const t=openTurno()||turnos[todayS()];editTurno(t?t.date:null)},
  cargarJornada:()=>editTurno(null),editTurno:el=>editTurno(el.dataset.d),
  editFtd:el=>{const f=team.find(x=>x._id===el.dataset.id);if(f&&canEdit(f))ftdForm(f)},
  delFtd:el=>{const f=team.find(x=>x._id===el.dataset.id);if(f&&canEdit(f))borrarFtd(f)},
  salir:async()=>{if(await confirmar('Salir','¿Cerrar la sesión en esta computadora? Para volver elegís tu nombre y ponés tu PIN.','Salir'))await sb.auth.signOut().catch(()=>{}),location.reload()},
  nuevoCliente:()=>clienteModal(),nuevoSnip:()=>snipModal(),
  importarRespaldo:()=>importarRespaldo(),
  target:el=>targetModal(el.dataset.ym||ymNow()),foto:()=>avPick(),formers:()=>formersModal(null),hoyMas:()=>{hoyAll=!hoyAll;refresh()},utargets:el=>utModal(el.dataset.ym||ymNow(),el.dataset.uid),hoyVentas:()=>go('ventas',{who:'all',f:{desde:todayS(),hasta:todayS()}}),fotoX:async()=>{if(await confirmar('Sacar la foto','¿Saco tu foto de perfil? Vuelven a aparecer tus iniciales.','Sacar',true)&&await B.delAvatar())toast('Foto sacada.')},ficha:el=>fichaModal(el.dataset.uid),focusTc:()=>{const i=$('#suTc');i.focus();i.select()},
  fichaCl:el=>openFicha(el.dataset.id),
  pHecho:el=>pendHecho(pendOf(el)),pDeshacer:el=>{const p=pendOf(el);if(p&&noRO())B.updPend(p,{done:false,doneAt:null})},
  pMas:el=>posponer(pendOf(el),+el.dataset.m||60),pManana:el=>posponer(pendOf(el),0,addDays(todayS(),1)),
  pEdit:el=>pendEdit(pendOf(el)),pDel:el=>pendDel(pendOf(el)),
  probarAviso:()=>{primeAudio();beep(1);flash();
    if(extOn()&&postTop({type:'ftd-agenda-test',v:1}))toast('Así suena el aviso. Ahora le pido la tarjeta a Chrome…');
    else toast('Así suenan los avisos. '+sp('hot','La extensión de Chrome no está conectada.'))},
};
document.addEventListener('click',e=>{
  const v=e.target.closest('#nav [data-g]');if(v){goGroup(v.dataset.g);return}
  const tb=e.target.closest('#subnav [data-tab]');if(tb){go(tb.dataset.tab);return}
  const g=e.target.closest('[data-go]');if(g){e.preventDefault();go(g.dataset.go);return}
  const a=e.target.closest('[data-act]');if(a&&ACT[a.dataset.act]){e.preventDefault();primeAudio();ACT[a.dataset.act](a)}
});
document.addEventListener('pointerdown',primeAudio);
document.addEventListener('mousedown',e=>{if(e.target.closest('.chip'))e.preventDefault()}); // los chips no se quedan con el foco: Enter sigue guardando
document.addEventListener('keydown',e=>{
  primeAudio();
  if(padUp())return;
  if(modals.length)return;
  const tg=e.target,typing=tg&&tg.matches&&tg.matches('input,select,textarea');
  if(e.key==='Escape'){if(typing)tg.blur();hideTip();return}
  if(typing||e.ctrlKey||e.metaKey||e.altKey||!ready)return;
  if(NAVKEYS[e.key]){e.preventDefault();goGroup(NAVKEYS[e.key]);return} // los números siguen el orden del menú
  const k=e.key.toLowerCase();
  if(k==='t'){e.preventDefault();go('tareas');return}
  if(k==='b'){e.preventDefault();go('banking');return}
  if(k==='l'){e.preventDefault();go('cliente');return}
  if(k==='c'){e.preventDefault();go('chat');return}
  if(k==='f'){e.preventDefault();go('filtros');return}
  if(k==='e'&&isLeader()){e.preventDefault();go('equipo');return}
  if(k==='a'){e.preventDefault();go('agenda');setTimeout(()=>{const i=$('#agForm [name=pid]');i&&i.focus()},0);return}
  if(e.key==='/'){e.preventDefault();go('ventas');setTimeout(()=>$('#pQ').focus(),0);return}
  if(e.key==='?'){e.preventDefault();ayuda();return}
});
