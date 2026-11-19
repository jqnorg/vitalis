/* ---------- Banking: procesadores, sus métodos de pago y bancos con su flujo recomendado ----------
   Editan admin y team leader; la mesa mira. Una falla avisa a todos (urgente) y la vuelta, normal. */
const PAISES=['Chile','Colombia','México','Perú','Ecuador','Costa Rica','Guatemala','Panamá','Argentina','Uruguay','España'];
let bk={ok:null,procs:[],methods:[],pm:[],banks:[],inc:[],files:[],at:0,busy:null},bkPais='',bkQ='';
let bkSeenAt=+local.get('bkSeen',0)||0;
const bkImgs=new Map(); // id → data URL (se piden cuando se muestran)
const bkEd=()=>!!profile&&['admin','leader'].includes(profile.role);
const procOf=id=>bk.procs.find(p=>p.id===id),methOf=id=>bk.methods.find(m=>m.id===id);
const pmOf=pid=>bk.pm.filter(x=>x.processor_id===pid).map(x=>({...x,m:methOf(x.method_id)})).filter(x=>x.m).sort((a,b)=>a.m.sort-b.m.sort||a.m.name.localeCompare(b.m.name));
const bkPaisOk=cs=>!bkPais||!(cs&&cs.length)||cs.includes(bkPais);
const bkName=(pid,mid)=>{const p=procOf(pid),m=mid?methOf(mid):null;return (p?p.name:'Procesador')+(m?' · '+m.name:'')};
// lo que está fallando ahora: procesadores enteros y métodos de un procesador
function bkFallas(){
  const out=[];
  for(const p of bk.procs)if(p.active!==false&&p.status==='falla')out.push({pid:p.id,mid:null,note:p.status_note,at:p.status_at,by:p.status_by,cs:p.countries});
  for(const x of bk.pm)if(x.status==='falla'){const p=procOf(x.processor_id);if(p&&p.active!==false&&p.status!=='falla')out.push({pid:p.id,mid:x.method_id,note:x.status_note,at:x.status_at,by:x.status_by,cs:x.countries&&x.countries.length?x.countries:p.countries})}
  return out.sort((a,b)=>new Date(b.at||0)-new Date(a.at||0));
}
const bkFails=(pid,mid)=>{const p=procOf(pid);if(!p)return false;if(p.status==='falla')return true;if(!mid)return bk.pm.some(x=>x.processor_id===pid&&x.status==='falla');const x=bk.pm.find(y=>y.processor_id===pid&&y.method_id===mid);return !!x&&x.status==='falla'};

async function bkLoad(force){
  if(!sb||!me)return;
  if(bk.busy)return bk.busy;
  if(!force&&Date.now()-bk.at<15e3)return;
  bk.busy=(async()=>{
    try{
      const [pr,ms,pm,bn,inc,fl]=await Promise.all([Q(sb.from('processors').select('*').order('sort').order('name')),Q(sb.from('pay_methods').select('*').order('sort').order('name')),
        Q(sb.from('processor_methods').select('*')),Q(sb.from('banks').select('*').order('country').order('name')),
        Q(sb.from('pay_incidents').select('*').order('created_at',{ascending:false}).limit(60)),Q(sb.from('pay_files').select('id,ref_kind,ref_id,w,h,caption,created_at').order('created_at'))]);
      const was=bk.ok;Object.assign(bk,{ok:true,procs:pr,methods:ms,pm,banks:bn,inc,files:fl,at:Date.now()});
      if(was!==true){bkSeenAt=Math.max(bkSeenAt,0,...inc.map(i=>+new Date(i.created_at)));local.set('bkSeen',bkSeenAt)}else bkNotify(inc); // al entrar no avisa lo viejo: las fallas activas se ven arriba del inicio
      if(ready&&['banking','inicio'].includes(cur))refresh();else if(ready)status();
    }catch(e){if(/processors|pay_|PGRST205|42P01|does not exist/.test(String(e&&(e.message||e.code))))bk.ok=false}
    finally{bk.busy=null}
  })();
  return bk.busy;
}
function bkNotify(list){
  const fresh=list.filter(i=>+new Date(i.created_at)>bkSeenAt).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  if(!fresh.length)return;
  bkSeenAt=Math.max(...fresh.map(i=>+new Date(i.created_at)));local.set('bkSeen',bkSeenAt);
  for(const i of fresh){
    if(i.created_by===me)continue;
    const t=bkName(i.processor_id,i.method_id),who=i.created_by?first(i.created_by):'';
    if(i.kind==='falla'){
      beep(2);
      toast(`⚠️ <b>${esc(t)}</b> está fallando${i.note?': '+esc(i.note):''}${who?` <span class="dim">· avisó ${esc(who)}</span>`:''}`,'alert',{sticky:1,key:'bk'+i.id,actions:[{l:'Ver Banking',fn:()=>go('banking')}]});
      if(pageAway())extSocial({k:'so:b:'+i.id,lvl:'urg',title:'Falla de pago',id:t,kw:i.note||'Está fallando: no lo ofrezcas por ahora.',meta:who?'Avisó '+who:'',btns:[['open','Ver Banking',1],['close','Ok']]});
    }else{
      toast(`✓ <b>${esc(t)}</b> volvió a andar${i.note?': '+esc(i.note):''}`,'info',{ms:9000,key:'bk'+i.id});
      if(pageAway())extSocial({k:'so:b:'+i.id,lvl:'info',title:'Volvió a andar',id:t,kw:i.note||'Ya se puede usar.',meta:who?'Avisó '+who:'',btns:[['close','Ok',1]]});
    }
  }
}

/* ---------- fotos ---------- */
const bkFilesOf=(kind,id)=>bk.files.filter(f=>f.ref_kind===kind&&f.ref_id===id);
const bkThumbs=(kind,id,edit)=>{const fs=bkFilesOf(kind,id);if(!fs.length)return '';
  return `<div class="bk-ph">${fs.map(f=>`<figure${edit?' class="ed"':''}><button type="button" class="bk-img" data-bkimg="${esc(f.id)}" title="${esc(f.caption||'Ver la foto')}"><img alt="${esc(f.caption||'Foto')}"></button>${edit?`<input class="bk-cap" data-bkcap="${esc(f.id)}" value="${esc(f.caption||'')}" placeholder="Para qué es" maxlength="200"><button type="button" class="ib" data-bkdelimg="${esc(f.id)}" title="Borrar la foto">✕</button>`:f.caption?`<figcaption>${esc(f.caption)}</figcaption>`:''}</figure>`).join('')}</div>`};
async function bkHydrate(root){
  const need=[...root.querySelectorAll('[data-bkimg]')].map(b=>b.dataset.bkimg).filter(id=>!bkImgs.has(id));
  if(need.length){try{for(const r of await Q(sb.from('pay_files').select('id,mime,data').in('id',[...new Set(need)].slice(0,60))))bkImgs.set(r.id,`data:${r.mime};base64,${r.data}`)}catch(e){}}
  root.querySelectorAll('[data-bkimg]').forEach(b=>{const u=bkImgs.get(b.dataset.bkimg),im=b.querySelector('img');if(u&&im&&im.src!==u)im.src=u});
}
function bkLightbox(id){const u=bkImgs.get(id),f=bk.files.find(x=>x.id===id);if(!u)return;
  modal({title:esc(f&&f.caption||'Foto'),wide:true,body:`<img class="bk-big" src="${u}" alt="${esc(f&&f.caption||'Foto')}">`,actions:[{l:'Cerrar',cls:'pri'}]})}
async function bkUpload(kind,id,files){ // las achica (1600 px, webp) y las guarda
  let n=0;
  for(const file of [...files].slice(0,10)){
    try{const im=await prepImg(file),data=await b64(im.blob);URL.revokeObjectURL(im.url);
      const r=await Q(sb.from('pay_files').insert({ref_kind:kind,ref_id:id,mime:im.mime,data,w:im.w,h:im.h}).select('id,ref_kind,ref_id,w,h,caption,created_at'));
      if(r&&r[0]){bk.files.push(r[0]);bkImgs.set(r[0].id,`data:${im.mime};base64,${data}`);n++}}
    catch(e){toast(esc(errMsg(e)),'err')}
  }
  return n;
}
// en los editores: fotos ya guardadas (con su para qué) y las nuevas que se suben al guardar
function bkPhotoField(kind,id){
  return `<div class="fld"><span>Fotos <small class="dim">(podés subir varias; escribí para qué es cada una)</small></span><div class="bk-phs">${id?bkThumbs(kind,id,true):''}</div>
    <label class="btn sm bk-up"><input type="file" accept="image/*" multiple hidden data-bkfiles>Agregar fotos</label><span class="dim bk-pend"></span></div>`;
}
function bkPhotoWire(api,kind,getId){
  const inp=api.q('[data-bkfiles]'),pend=api.q('.bk-pend');
  inp&&inp.addEventListener('change',()=>{pend.textContent=inp.files.length?`${plural(inp.files.length,'foto')} para subir al guardar`:''});
  api.box.addEventListener('click',async e=>{
    const v=e.target.closest('[data-bkimg]');if(v){e.preventDefault();return bkLightbox(v.dataset.bkimg)}
    const d=e.target.closest('[data-bkdelimg]');if(!d)return;
    if(!await confirmar('Borrar foto','¿Borrar esta foto?','borrar',true))return;
    try{await Q(sb.from('pay_files').delete().eq('id',d.dataset.bkdelimg));bk.files=bk.files.filter(f=>f.id!==d.dataset.bkdelimg);d.closest('figure').remove()}catch(err){toast(esc(errMsg(err)),'err')}
  });
  api.box.addEventListener('change',async e=>{const c=e.target.closest('[data-bkcap]');if(!c)return;
    try{await Q(sb.from('pay_files').update({caption:c.value.trim().slice(0,200)||null}).eq('id',c.dataset.bkcap));const f=bk.files.find(x=>x.id===c.dataset.bkcap);if(f)f.caption=c.value.trim()||null}catch(err){toast(esc(errMsg(err)),'err')}});
  bkHydrate(api.box);
  return async()=>{const id=getId();if(id&&inp&&inp.files.length)await bkUpload(kind,id,inp.files)};
}
const paisChecks=(sel,name)=>`<div class="bk-paises">${PAISES.map(p=>`<label class="chk"><input type="checkbox" name="${name}" value="${esc(p)}"${(sel||[]).includes(p)?' checked':''}>${esc(p)}</label>`).join('')}</div>`;
const paisesTxt=cs=>cs&&cs.length?cs.join(', '):'Todos los países';

/* ---------- la vista ---------- */
const comboTxt=x=>x.p&&x.m?bkName(x.p,x.m):x.p?(procOf(x.p)?procOf(x.p).name:'Procesador')+' (cualquier método)':x.m?(methOf(x.m)?methOf(x.m).name:'Método')+' (cualquier procesador)':'';
const comboFails=x=>x.p?bkFails(x.p,x.m):x.m?bk.pm.some(y=>y.method_id===x.m&&(y.status==='falla'||(procOf(y.processor_id)||{}).status==='falla')):false;
function bankChips(b){
  const u=(b.use_pm||[]).map(x=>`<span class="bk-chip use${comboFails(x)?' warn':''}" title="${comboFails(x)?'Ahora está fallando':''}">✓ ${esc(comboTxt(x))}${comboFails(x)?' · ⚠ falla':''}</span>`),
    a=(b.avoid_pm||[]).map(x=>`<span class="bk-chip avoid">✕ ${esc(comboTxt(x))}</span>`);
  return u.concat(a).join('');
}
V.banking={
  build(){
    $('#bkPais').addEventListener('change',e=>{bkPais=e.target.value;this.render({})});
    $('#bkQ').addEventListener('input',e=>{bkQ=e.target.value;this.render({})});
    $('#bkTools').addEventListener('click',e=>{const b=e.target.closest('[data-bk]');if(!b)return;
      if(b.dataset.bk==='proc')procModal();else if(b.dataset.bk==='met')methodsModal();else if(b.dataset.bk==='bank')bankModal()});
    $('#bkBody').addEventListener('click',e=>{
      const v=e.target.closest('[data-bkimg]');if(v)return bkLightbox(v.dataset.bkimg);
      const b=e.target.closest('[data-bka]');if(!b)return;const a=b.dataset.bka,id=b.dataset.id;
      if(a==='falla')return reportModal(id,true);
      if(a==='vuelve')return reportModal(id,false,b.dataset.m||'');
      if(a==='edit')return procModal(procOf(id));
      if(a==='bank')return bankView(bk.banks.find(x=>x.id===id));
      if(a==='bankEd')return bankModal(bk.banks.find(x=>x.id===id));
    });
  },
  render(){
    bkLoad();
    const sel=$('#bkPais');if(sel!==document.activeElement){sel.innerHTML=`<option value="">Todos los países</option>`+PAISES.map(p=>`<option${p===bkPais?' selected':''}>${esc(p)}</option>`).join('')}
    $('#bkTools').innerHTML=bkEd()?`<button type="button" class="btn sm" data-bk="met">Métodos</button><button type="button" class="btn sm" data-bk="bank">Banco</button><button type="button" class="btn sm pri" data-bk="proc">Procesador</button>`:'';
    const body=$('#bkBody');
    if(bk.ok===false){body.innerHTML='<section class="card"><div class="p-empty">Banking se activa en un rato (falta actualizar la base).</div></section>';return}
    if(bk.ok==null){body.innerHTML='<section class="card"><div class="p-empty">Cargando…</div></section>';return}
    const q=norm(bkQ).trim(),hit=t=>!q||norm(t).includes(q),ed=bkEd(),F=bkFallas().filter(f=>bkPaisOk(f.cs));
    const fallas=F.length?`<section class="card bk-fallas"><div class="card-h"><h3>⚠️ Fallando ahora</h3><span class="p-sub">no lo ofrezcas hasta que vuelva</span></div>${F.map(f=>`<div class="bk-f"><b>${esc(bkName(f.pid,f.mid))}</b>${f.mid?'':' <span class="badge bad">todo el procesador</span>'}${f.note?`<span class="bk-fn">${esc(f.note)}</span>`:''}<span class="dim">${f.at?esc(rel(new Date(f.at))):''}${f.by?' · '+esc(first(f.by)):''}</span><span class="grow"></span>${ed?`<button type="button" class="btn sm" data-bka="vuelve" data-id="${esc(f.pid)}" data-m="${esc(f.mid||'')}">Volvió a andar</button>`:''}</div>`).join('')}</section>`:'';
    const procs=bk.procs.filter(p=>p.active!==false&&bkPaisOk(p.countries)&&(hit(p.name)||pmOf(p.id).some(x=>hit(x.m.name))));
    const pc=p=>{const ms=pmOf(p.id).filter(x=>bkPaisOk(x.countries&&x.countries.length?x.countries:p.countries));
      return `<article class="bk-proc${p.status==='falla'?' falla':''}"><div class="bk-ph-h"><h4>${esc(p.name)}</h4>${(()=>{const nf=pmOf(p.id).filter(x=>x.status==='falla').length;return p.status==='falla'?'<span class="badge bad">Falla</span>':nf?`<span class="badge bad">${nf===1?'Falla un método':nf+' métodos fallan'}</span>`:'<span class="badge paid">Anda</span>'})()}</div>
        <div class="dim bk-cs">${esc(paisesTxt(p.countries))}</div>
        <div class="bk-ms">${ms.length?ms.map(x=>`<span class="bk-m ${x.status==='falla'||p.status==='falla'?'falla':'ok'}" title="${esc(x.status==='falla'?(x.status_note||'Falla'):(x.countries&&x.countries.length?x.countries.join(', '):''))}">${esc(x.m.name)}</span>`).join(''):'<span class="dim">Sin métodos cargados</span>'}</div>
        ${p.notes?`<p class="bk-notes">${esc(p.notes)}</p>`:''}${bkThumbs('processor',p.id)}
        ${ed?`<div class="bk-act"><button type="button" class="btn sm" data-bka="falla" data-id="${esc(p.id)}">Reportar falla</button>${p.status==='falla'||pmOf(p.id).some(x=>x.status==='falla')?`<button type="button" class="btn sm" data-bka="vuelve" data-id="${esc(p.id)}">Volvió a andar</button>`:''}<button type="button" class="btn sm" data-bka="edit" data-id="${esc(p.id)}">Editar</button></div>`:''}</article>`};
    const banks=bk.banks.filter(b=>(!bkPais||!b.country||b.country===bkPais)&&(hit(b.name)||hit(b.country)));
    const bRow=b=>`<div class="bk-bank"><div class="bk-bn"><b>${esc(b.name)}</b><span class="dim">${esc(b.country||'Todos los países')}</span></div><div class="bk-chips">${bankChips(b)}</div><span class="grow"></span><button type="button" class="btn sm" data-bka="bank" data-id="${esc(b.id)}">Ver flujo</button>${ed?`<button type="button" class="btn sm" data-bka="bankEd" data-id="${esc(b.id)}">Editar</button>`:''}</div>`;
    const hist=bk.inc.slice(0,30);
    body.innerHTML=fallas+
      `<section class="card"><div class="card-h"><h3>Procesadores</h3><span class="p-sub">${plural(procs.length,'procesador','procesadores')}${bkPais?' en '+esc(bkPais):''}</span></div>${procs.length?`<div class="bk-grid">${procs.map(pc).join('')}</div>`:`<div class="p-empty">${bk.procs.length?'Nada con ese filtro.':ed?'Cargá el primer procesador con el botón de arriba.':'Todavía no hay procesadores cargados.'}</div>`}</section>`+
      `<section class="card"><div class="card-h"><h3>Bancos</h3><span class="p-sub">cómo conviene pagar según el banco del cliente</span></div>${banks.length?banks.map(bRow).join(''):`<div class="p-empty">${bk.banks.length?'Ningún banco con ese filtro.':ed?'Cargá un banco con su flujo recomendado (por ejemplo, Falabella Chile: no transferencia).':'Todavía no hay bancos cargados.'}</div>`}</section>`+
      (hist.length?`<section class="card"><div class="card-h"><h3>Historial</h3><span class="p-sub">fallas y vueltas</span></div><div class="lst">${hist.map(i=>`<div class="li"><span class="t">${esc(whenTxt(new Date(i.created_at)))}</span><span class="n"><b>${esc(bkName(i.processor_id,i.method_id))}</b> ${i.kind==='falla'?'<span class="badge bad">falla</span>':'<span class="badge paid">volvió</span>'}${i.note?`<small>${esc(i.note)}</small>`:''}</span><span class="d">${i.created_by?esc(first(i.created_by)):''}</span><span></span><span></span></div>${bkThumbs('incident',i.id)}`).join('')}</div></section>`:'');
    bkHydrate(body);
  },
};
// en el inicio: si algo está fallando, arriba de todo
function bkCard(){
  if(!bk.ok)return '';
  const F=bkFallas();if(!F.length)return '';
  return `<div class="card-h"><h3>⚠️ Fallas de pago</h3><span class="p-sub">no lo ofrezcas hasta que vuelva</span><span class="grow"></span><button type="button" class="btn sm" data-go="banking">Ver Banking</button></div>
    <div class="lst">${F.slice(0,4).map(f=>`<div class="li"><span class="t">${f.at?esc(rel(new Date(f.at))):''}</span><span class="n"><b>${esc(bkName(f.pid,f.mid))}</b>${f.note?`<small>${esc(f.note)}</small>`:''}</span><span></span><span></span><span></span></div>`).join('')}</div>`;
}

/* ---------- editores (admin y team leader) ---------- */
async function bkSave(p){try{const r=await Q(p);await bkLoad(true);return r||true}catch(e){toast(esc(errMsg(e)),'err');return false}}
function procModal(p){
  if(!bkEd())return;
  const have=new Set(p?bk.pm.filter(x=>x.processor_id===p.id).map(x=>x.method_id):[]);
  let savedId=p&&p.id;
  modal({title:p?'Editar procesador':'Nuevo procesador',wide:true,body:`<label class="fld"><span>Nombre</span><input id="bpN" maxlength="60" value="${esc(p&&p.name||'')}" autofocus></label>
    <div class="fld"><span>Países <small class="dim">(sin marcar: todos)</small></span>${paisChecks(p&&p.countries,'bpC')}</div>
    <div class="fld"><span>Métodos de este procesador</span><div class="bk-paises" id="bpM">${bk.methods.map(m=>`<label class="chk"><input type="checkbox" value="${esc(m.id)}"${have.has(m.id)?' checked':''}>${esc(m.name)}</label>`).join('')||'<span class="dim">No hay métodos: agregá uno abajo.</span>'}</div>
      <div class="bk-row"><input id="bpNew" maxlength="60" placeholder="Método nuevo (ej.: Transferencia, Tarjeta, Efectivo)"><button type="button" class="btn sm" id="bpAdd">Agregar</button></div></div>
    <label class="fld"><span>Notas <small class="dim">(cómo se usa, límites, horarios…)</small></span><textarea id="bpNo" rows="4" maxlength="4000">${esc(p&&p.notes||'')}</textarea></label>
    ${bkPhotoField('processor',p&&p.id)}<div class="ebox" id="bpE"></div>`,
    onOpen:api=>{
      api._up=bkPhotoWire(api,'processor',()=>savedId);
      api.q('#bpAdd').onclick=async()=>{const n=api.q('#bpNew').value.trim();if(!n)return;
        const r=await bkSave(sb.from('pay_methods').insert({name:n.slice(0,60),sort:bk.methods.length}).select('*'));if(!r)return;
        const m=r[0];api.q('#bpNew').value='';const box=api.q('#bpM');if(box.querySelector('.dim'))box.innerHTML='';
        box.insertAdjacentHTML('beforeend',`<label class="chk"><input type="checkbox" value="${esc(m.id)}" checked>${esc(m.name)}</label>`)};
    },
    actions:[...(p?[{l:'Borrar',cls:'danger',fn:async()=>{if(!await confirmar('Borrar procesador',`¿Borrar <b>${esc(p.name)}</b> con sus métodos, fotos e historial?`,'borrar',true))return false;
        await bkSave(sb.from('pay_files').delete().eq('ref_kind','processor').eq('ref_id',p.id));if(await bkSave(sb.from('processors').delete().eq('id',p.id)))toast('Procesador borrado.')}}]:[]),
      {l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
        const name=api.q('#bpN').value.trim(),countries=[...api.box.querySelectorAll('[name=bpC]:checked')].map(i=>i.value),notes=api.q('#bpNo').value.trim()||null;
        if(!name){api.q('#bpE').textContent='Poné el nombre.';return false}
        const row={name:name.slice(0,60),countries,notes,updated_at:new Date().toISOString()};
        const r=await bkSave(p?sb.from('processors').update(row).eq('id',p.id).select('id'):sb.from('processors').insert({...row,sort:bk.procs.length}).select('id'));if(!r)return false;
        savedId=p?p.id:r[0].id;
        const want=new Set([...api.q('#bpM').querySelectorAll('input:checked')].map(i=>i.value));
        const add=[...want].filter(id=>!have.has(id)).map(method_id=>({processor_id:savedId,method_id})),del=[...have].filter(id=>!want.has(id));
        if(add.length&&!await bkSave(sb.from('processor_methods').insert(add)))return false;
        if(del.length&&!await bkSave(sb.from('processor_methods').delete().eq('processor_id',savedId).in('method_id',del)))return false;
        await api._up();await bkLoad(true);toast(p?'Procesador guardado.':`Procesador <b>${esc(name)}</b> cargado.`);
      }}]});
}
function methodsModal(){
  if(!bkEd())return;
  const row=m=>`<div class="bk-row" data-mid="${esc(m.id)}"><input value="${esc(m.name)}" maxlength="60" aria-label="Nombre del método"><span class="dim">${plural(bk.pm.filter(x=>x.method_id===m.id).length,'procesador','procesadores')}</span><button type="button" class="ib" data-mdel title="Borrar">✕</button></div>`;
  modal({title:'Métodos de pago',body:`<p class="mp">Un método puede estar en varios procesadores. Cambiale el nombre acá y se cambia en todos.</p><div id="bmL">${bk.methods.map(row).join('')||'<p class="dim">Todavía no hay métodos.</p>'}</div>
    <div class="bk-row"><input id="bmN" maxlength="60" placeholder="Método nuevo"><button type="button" class="btn sm" id="bmA">Agregar</button></div>`,
    onOpen:api=>{
      api.q('#bmA').onclick=async()=>{const n=api.q('#bmN').value.trim();if(!n)return;const r=await bkSave(sb.from('pay_methods').insert({name:n.slice(0,60),sort:bk.methods.length}).select('*'));if(r){api.q('#bmN').value='';const l=api.q('#bmL');if(l.querySelector('p.dim'))l.innerHTML='';l.insertAdjacentHTML('beforeend',row(r[0]))}};
      api.box.addEventListener('change',async e=>{const w=e.target.closest('[data-mid]');if(!w||e.target.tagName!=='INPUT')return;const n=e.target.value.trim();if(n)await bkSave(sb.from('pay_methods').update({name:n.slice(0,60)}).eq('id',w.dataset.mid))});
      api.box.addEventListener('click',async e=>{const d=e.target.closest('[data-mdel]');if(!d)return;const w=d.closest('[data-mid]'),m=methOf(w.dataset.mid);
        if(!await confirmar('Borrar método',`¿Borrar <b>${esc(m?m.name:'')}</b> de todos los procesadores?`,'borrar',true))return;if(await bkSave(sb.from('pay_methods').delete().eq('id',w.dataset.mid)))w.remove()});
    },actions:[{l:'Listo',cls:'pri',fn:()=>{refresh()}}]});
}
function reportModal(pid,falla,mid0){
  if(!bkEd())return;
  const p=procOf(pid);if(!p)return;
  const ms=pmOf(pid).filter(x=>falla?true:x.status==='falla');
  const opts=(falla||p.status==='falla'?[{v:'',l:'Todo el procesador'}]:[]).concat(ms.map(x=>({v:x.method_id,l:'Solo '+x.m.name})));
  if(!opts.length)return toast('No hay nada fallando en este procesador.','warn');
  const pick=mid0!=null&&opts.some(o=>o.v===mid0)?mid0:opts[0].v;
  let incId=null;
  modal({title:falla?`Reportar falla · ${esc(p.name)}`:`Volvió a andar · ${esc(p.name)}`,body:`<div class="fld"><span>${falla?'¿Qué falla?':'¿Qué volvió?'}</span>${opts.map(o=>`<label class="chk blk"><input type="radio" name="brW" value="${esc(o.v)}"${o.v===pick?' checked':''}>${esc(o.l)}</label>`).join('')}</div>
    <label class="fld"><span>${falla?'Qué pasa':'Nota'} <small class="dim">(lo ve toda la mesa)</small></span><textarea id="brN" rows="3" maxlength="1000" placeholder="${falla?'Ej.: rechaza todas las tarjetas desde las 14 h':'Opcional'}"></textarea></label>
    ${falla?bkPhotoField('incident',null):''}<p class="note">${falla?'Le llega a toda la mesa un aviso urgente.':'Le llega a toda la mesa un aviso.'}</p>`,
    onOpen:api=>{if(falla)api._up=bkPhotoWire(api,'incident',()=>incId)},
    actions:[{l:'Cancelar'},{l:falla?'Avisar la falla':'Avisar que volvió',cls:'pri'+(falla?' danger':''),fn:async api=>{
      const w=(api.box.querySelector('[name=brW]:checked')||{}).value||'',note=api.q('#brN').value.trim();
      const r=await B.rpc('pay_report',{pid,mid:w||null,falla,note:note||null});if(!r)return false;incId=r.id;
      if(falla)await api._up();await bkLoad(true);toast(falla?`Avisé a la mesa que <b>${esc(bkName(pid,w||null))}</b> falla.`:`Avisé que <b>${esc(bkName(pid,w||null))}</b> volvió a andar.`)}}]});
}
function comboRow(x,kind){
  const po=`<option value="">Cualquier procesador</option>`+bk.procs.map(p=>`<option value="${esc(p.id)}"${x&&x.p===p.id?' selected':''}>${esc(p.name)}</option>`).join('');
  const mo=`<option value="">Cualquier método</option>`+bk.methods.map(m=>`<option value="${esc(m.id)}"${x&&x.m===m.id?' selected':''}>${esc(m.name)}</option>`).join('');
  return `<div class="bk-row bk-combo" data-k="${kind}"><select data-cp aria-label="Procesador">${po}</select><select data-cm aria-label="Método">${mo}</select><button type="button" class="ib" data-cdel title="Sacar">✕</button></div>`;
}
function bankModal(b){
  if(!bkEd())return;
  let savedId=b&&b.id;
  modal({title:b?'Editar banco':'Nuevo banco',wide:true,body:`<div class="bk-row"><label class="fld grow"><span>Banco</span><input id="bbN" maxlength="80" value="${esc(b&&b.name||'')}" placeholder="Ej.: Falabella" autofocus></label>
      <label class="fld"><span>País</span><select id="bbC"><option value="">Todos</option>${PAISES.map(p=>`<option${b&&b.country===p?' selected':''}>${esc(p)}</option>`).join('')}</select></label></div>
    <label class="fld"><span>Pasos recomendados <small class="dim">(uno por línea)</small></span><textarea id="bbS" rows="5" maxlength="4000" placeholder="1. Pedile que pague con tarjeta de crédito&#10;2. …">${esc((b&&b.steps||[]).join('\n'))}</textarea></label>
    <div class="fld"><span>Conviene usar</span><div id="bbU">${(b&&b.use_pm||[]).map(x=>comboRow(x,'use')).join('')}</div><button type="button" class="btn sm" data-cadd="use">Agregar</button></div>
    <div class="fld"><span>Mejor no usar</span><div id="bbA">${(b&&b.avoid_pm||[]).map(x=>comboRow(x,'avoid')).join('')}</div><button type="button" class="btn sm" data-cadd="avoid">Agregar</button></div>
    <label class="fld"><span>Notas</span><textarea id="bbNo" rows="3" maxlength="4000">${esc(b&&b.notes||'')}</textarea></label>
    ${bkPhotoField('bank',b&&b.id)}<div class="ebox" id="bbE"></div>`,
    onOpen:api=>{
      api._up=bkPhotoWire(api,'bank',()=>savedId);
      api.box.addEventListener('click',e=>{const a=e.target.closest('[data-cadd]');if(a){api.q(a.dataset.cadd==='use'?'#bbU':'#bbA').insertAdjacentHTML('beforeend',comboRow(null,a.dataset.cadd));return}
        const d=e.target.closest('[data-cdel]');if(d)d.closest('.bk-combo').remove()});
    },
    actions:[...(b?[{l:'Borrar',cls:'danger',fn:async()=>{if(!await confirmar('Borrar banco',`¿Borrar <b>${esc(b.name)}</b> y su flujo?`,'borrar',true))return false;
        await bkSave(sb.from('pay_files').delete().eq('ref_kind','bank').eq('ref_id',b.id));if(await bkSave(sb.from('banks').delete().eq('id',b.id)))toast('Banco borrado.')}}]:[]),
      {l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
        const name=api.q('#bbN').value.trim();if(!name){api.q('#bbE').textContent='Poné el nombre del banco.';return false}
        const combos=sel=>[...api.q(sel).querySelectorAll('.bk-combo')].map(r=>({p:r.querySelector('[data-cp]').value||null,m:r.querySelector('[data-cm]').value||null})).filter(x=>x.p||x.m).slice(0,20);
        const row={name:name.slice(0,80),country:api.q('#bbC').value,steps:api.q('#bbS').value.split('\n').map(s=>s.replace(/^\s*\d+[.)-]?\s*/,'').trim()).filter(Boolean).slice(0,30),
          use_pm:combos('#bbU'),avoid_pm:combos('#bbA'),notes:api.q('#bbNo').value.trim()||null,updated_at:new Date().toISOString(),updated_by:me};
        const r=await bkSave(b?sb.from('banks').update(row).eq('id',b.id).select('id'):sb.from('banks').insert(row).select('id'));if(!r)return false;
        savedId=b?b.id:r[0].id;await api._up();await bkLoad(true);toast(b?'Banco guardado.':`Banco <b>${esc(name)}</b> cargado.`);
      }}]});
}
function bankView(b){
  if(!b)return;
  modal({title:`${esc(b.name)}${b.country?' · '+esc(b.country):''}`,wide:true,body:`${(b.use_pm||[]).length||(b.avoid_pm||[]).length?`<div class="bk-chips" style="margin-bottom:12px">${bankChips(b)}</div>`:''}
    ${(b.steps||[]).length?`<ol class="bk-steps">${b.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:'<p class="dim">Sin pasos cargados.</p>'}
    ${b.notes?`<p class="bk-notes">${esc(b.notes)}</p>`:''}${bkThumbs('bank',b.id)}${b.updated_at?`<p class="note">Actualizado ${esc(rel(new Date(b.updated_at)))}${b.updated_by?' por '+esc(first(b.updated_by)):''}.</p>`:''}`,
    onOpen:api=>{bkHydrate(api.box);api.box.addEventListener('click',e=>{const v=e.target.closest('[data-bkimg]');if(v)bkLightbox(v.dataset.bkimg)})},
    actions:[...(bkEd()?[{l:'Editar',fn:()=>{setTimeout(()=>bankModal(b),0)}}]:[]),{l:'Cerrar',cls:'pri'}]});
}
