/* ---------- Banking: procesadores, sus métodos de pago y bancos con su flujo recomendado ----------
   Editan admin y team leader; la mesa mira. Una falla avisa a todos (urgente) y la vuelta, normal. */
const PAISES=['Colombia','México','Chile','Panamá','Guatemala','Costa Rica','Perú']; // los países donde trabaja la mesa
let bk={ok:null,procs:[],methods:[],pm:[],banks:[],inc:[],files:[],at:0,busy:null},bkPais='',bkQ='',bkTipo='',bkWay=''; // bkWay: '' · 'efectivo' · 'otro' (otro banco) · id de un banco
// una ruta (PayPros → Cash, Bank) es un procesador con parent_id: se nombra "PayPros · Cash" y hereda la falla del padre
const procName=p=>{const pa=p&&p.parent_id?bk.procs.find(x=>x.id===p.parent_id):null;return pa?pa.name+' · '+p.name:p?p.name:'Procesador'};
const procParent=p=>p&&p.parent_id?bk.procs.find(x=>x.id===p.parent_id):null;
// el paso anterior: cómo paga el cliente (efectivo, o digital: transferencia o tarjeta)
const KINDS={efectivo:'Efectivo',transferencia:'Transferencia',tarjeta:'Tarjeta'};
const kindGuess=n=>/transf|spei|pse|khipu|wire/i.test(n)?'transferencia':/tarjeta|card|cr[eé]dito|d[eé]bito|visa|master/i.test(n)?'tarjeta':/efectivo|boleto|cash|oxxo|efecty|baloto|pagoefectivo|servipag/i.test(n)?'efectivo':null;
const kindOk=k=>!bkTipo||(bkTipo==='digital'?k==='transferencia'||k==='tarjeta':k===bkTipo);
const kindSel=(v,id)=>`<select${id?` id="${id}"`:''} data-kind aria-label="Tipo de pago"><option value="">Tipo…</option>${Object.entries(KINDS).map(([k,l])=>`<option value="${k}"${v===k?' selected':''}>${l}</option>`).join('')}</select>`;
let bkSeenAt=+local.get('bkSeen',0)||0;
const bkImgs=new Map(); // id → data URL (se piden cuando se muestran)
const bkEd=()=>!!profile&&['admin','leader'].includes(profile.role);
const procOf=id=>bk.procs.find(p=>p.id===id),methOf=id=>bk.methods.find(m=>m.id===id);
const pmOf=pid=>bk.pm.filter(x=>x.processor_id===pid).map(x=>({...x,m:methOf(x.method_id)})).filter(x=>x.m).sort((a,b)=>a.m.sort-b.m.sort||a.m.name.localeCompare(b.m.name));
const bkPaisOk=cs=>!bkPais||!(cs&&cs.length)||cs.includes(bkPais);
const bkName=(pid,mid)=>{const p=procOf(pid),m=mid?methOf(mid):null;return procName(p)+(m?' · '+m.name:'')};
const incName=i=>{const ids=i.method_ids&&i.method_ids.length>1?i.method_ids:null;return ids?procName(procOf(i.processor_id))+' · '+ids.map(id=>(methOf(id)||{}).name||'?').join(', '):bkName(i.processor_id,i.method_id)};
// una falla puede ser en todos los países o solo en algunos (fail_countries): null = anda · [] = falla en todos · [..] = falla ahí
const failCs=r=>r&&r.status==='falla'?(r.fail_countries||[]):null;
const failsIn=(r,pais)=>{const c=failCs(r);return c!=null&&(!c.length||!pais||c.includes(pais))}; // sin país: cualquier falla cuenta
const procFails=(p,pais)=>!!p&&(failsIn(p,pais)||failsIn(procParent(p),pais)); // el procesador, o el padre de la ruta
const effFail=(p,x)=>{const a=failCs(p),b=failCs(x);if(a==null&&b==null)return null;if((a&&!a.length)||(b&&!b.length))return [];return [...new Set([...(a||[]),...(b||[])])]}; // el método con su procesador
const enTxt=c=>c&&c.length?' en '+c.join(', '):'';
// lo que está fallando ahora: procesadores enteros y métodos de un procesador
function bkFallas(){
  const out=[];
  for(const p of bk.procs)if(p.active!==false&&p.status==='falla')out.push({pid:p.id,mid:null,note:p.status_note,at:p.status_at,by:p.status_by,cs:p.countries,fc:failCs(p)});
  for(const x of bk.pm)if(x.status==='falla'){const p=procOf(x.processor_id);if(p&&p.active!==false&&!(failCs(p)&&!failCs(p).length)&&!procFails(procParent(p)||{},''))out.push({pid:p.id,mid:x.method_id,note:x.status_note,at:x.status_at,by:x.status_by,cs:x.countries&&x.countries.length?x.countries:p.countries,fc:failCs(x)})}
  return out.sort((a,b)=>new Date(b.at||0)-new Date(a.at||0));
}
const bkFails=(pid,mid,pais)=>{const p=procOf(pid);if(!p)return false;if(procFails(p,pais))return true;if(!mid)return bk.pm.some(x=>x.processor_id===pid&&failsIn(x,pais));const x=bk.pm.find(y=>y.processor_id===pid&&y.method_id===mid);return failsIn(x,pais)};

async function bkLoad(force){
  if(!sb||!me)return;
  if(bk.busy)return bk.busy;
  if(!force&&Date.now()-bk.at<15e3)return;
  bk.busy=(async()=>{
    try{bkApply(await bkFetch())}
    catch(e){if(/processors|pay_|PGRST205|42P01|does not exist/.test(String(e&&(e.message||e.code))))bk.ok=false}
    finally{bk.busy=null}
  })();
  return bk.busy;
}
async function bkFetch(){
  const [pr,ms,pm,bn,inc,fl]=await Promise.all([Q(sb.from('processors').select('*').order('sort').order('name')),Q(sb.from('pay_methods').select('*').order('sort').order('name')),
    Q(sb.from('processor_methods').select('*')),Q(sb.from('banks').select('*').order('country').order('name')),
    Q(sb.from('pay_incidents').select('*').order('created_at',{ascending:false}).limit(60)),Q(sb.from('pay_files').select('id,ref_kind,ref_id,w,h,caption,created_at').order('created_at'))]);
  return {pr,ms,pm,bn,inc,fl};
}
function bkApply(x,quiet){
  if(!x){bk.ok=false;return}
  const {pr,ms,pm,bn,inc,fl}=x,was=bk.ok;Object.assign(bk,{ok:true,procs:pr,methods:ms,pm,banks:bn,inc,files:fl,at:Date.now()});
  if(was!==true||quiet){bkSeenAt=Math.max(bkSeenAt,0,...inc.map(i=>+new Date(i.created_at)));local.set('bkSeen',bkSeenAt)}else bkNotify(inc); // al entrar no avisa lo viejo: las fallas activas se ven arriba del inicio
  if(ready&&['banking','inicio'].includes(cur))refresh();else if(ready)status();
}
function bkNotify(list){
  const fresh=list.filter(i=>+new Date(i.created_at)>bkSeenAt).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  if(!fresh.length)return;
  bkSeenAt=Math.max(...fresh.map(i=>+new Date(i.created_at)));local.set('bkSeen',bkSeenAt);
  for(const i of fresh){
    if(i.created_by===me)continue;
    const t=incName(i)+enTxt(i.countries),who=i.created_by?first(i.created_by):'';
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
// la foto de un procesador va chica, como un ícono (la primera, al lado del nombre; las demás, en miniatura)
const bkIcon=pid=>{const f=bkFilesOf('processor',pid)[0];return f?`<button type="button" class="bk-ico" data-bkimg="${esc(f.id)}" title="${esc(f.caption||'Ver la foto')}"><img alt=""></button>`:''};
const bkMini=pid=>{const fs=bkFilesOf('processor',pid).slice(1);return fs.length?`<div class="bk-mini">${fs.map(f=>`<button type="button" class="bk-ico sm" data-bkimg="${esc(f.id)}" title="${esc(f.caption||'Ver la foto')}"><img alt=""></button>`).join('')}</div>`:''};
const bkThumbs=(kind,id,edit)=>{const fs=bkFilesOf(kind,id);if(!fs.length)return '';
  return `<div class="bk-ph${kind==='processor'?' ico':''}">${fs.map(f=>`<figure${edit?' class="ed"':''}><button type="button" class="bk-img" data-bkimg="${esc(f.id)}" title="${esc(f.caption||'Ver la foto')}"><img alt="${esc(f.caption||'Foto')}"></button>${edit?`<input class="bk-cap" data-bkcap="${esc(f.id)}" value="${esc(f.caption||'')}" placeholder="Para qué es" maxlength="200"><button type="button" class="ib" data-bkdelimg="${esc(f.id)}" title="Borrar la foto">✕</button>`:f.caption?`<figcaption>${esc(f.caption)}</figcaption>`:''}</figure>`).join('')}</div>`};
async function bkHydrate(root){
  let need=[...new Set([...root.querySelectorAll('[data-bkimg]')].map(b=>b.dataset.bkimg).filter(id=>!bkImgs.has(id)))];
  if(need.length){const miss=[]; // primero las que ya bajé antes en esta compu
    for(const id of need){try{const c=await imgCacheGet(id);if(c&&c.data){bkImgs.set(id,`data:${c.mime};base64,${c.data}`);continue}}catch(e){}miss.push(id)}
    need=miss;}
  if(need.length){try{for(const r of await Q(sb.from('pay_files').select('id,mime,data').in('id',need.slice(0,60)))){bkImgs.set(r.id,`data:${r.mime};base64,${r.data}`);imgCachePut(r.id,{mime:r.mime,data:r.data,at:Date.now()})}}catch(e){}}
  root.querySelectorAll('[data-bkimg]').forEach(b=>{const u=bkImgs.get(b.dataset.bkimg),im=b.querySelector('img');if(u&&im&&im.src!==u)im.src=u});
}
function bkLightbox(id){const u=bkImgs.get(id),f=bk.files.find(x=>x.id===id);if(!u)return;
  modal({title:esc(f&&f.caption||'Foto'),wide:true,body:`<img class="bk-big" src="${u}" alt="${esc(f&&f.caption||'Foto')}">`,actions:[{l:'Cerrar',cls:'pri'}]})}
async function bkUpload(kind,id,files){ // las achica (1600 px, webp) y las guarda
  let n=0;
  for(const file of [...files].slice(0,10)){
    try{const im=await prepImg(file),data=await b64(im.blob);URL.revokeObjectURL(im.url);
      const r=await Q(sb.from('pay_files').insert({ref_kind:kind,ref_id:id,mime:im.mime,data,w:im.w,h:im.h}).select('id,ref_kind,ref_id,w,h,caption,created_at'));
      if(r&&r[0]){bk.files.push(r[0]);bkImgs.set(r[0].id,`data:${im.mime};base64,${data}`);imgCachePut(r[0].id,{mime:im.mime,data,at:Date.now()});n++}}
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
const ISO={Chile:'CL',Colombia:'CO','México':'MX','Perú':'PE',Ecuador:'EC','Costa Rica':'CR',Guatemala:'GT','Panamá':'PA',Argentina:'AR',Uruguay:'UY','España':'ES'};
const isoTxt=cs=>cs.map(c=>ISO[c]||c).join(' · ');

/* ---------- las opciones del paso a paso ---------- */
const paisOkFor=(pais,cs)=>!pais||!(cs&&cs.length)||cs.includes(pais);
const kindOkFor=(tipo,k)=>!tipo||(tipo==='digital'?k==='transferencia'||k==='tarjeta':k===tipo);
function bkOptions(pais=bkPais,tipo=bkTipo){ // procesador + método que sirven para ese país y tipo de pago (también los usa la ficha del cliente)
  const out=[];
  for(const p of bk.procs){if(p.active===false||!paisOkFor(pais,p.countries))continue;
    for(const x of pmOf(p.id))if(paisOkFor(pais,x.countries&&x.countries.length?x.countries:p.countries)&&kindOkFor(tipo,x.m.kind))out.push({p,x,pais,falla:procFails(p,pais)||failsIn(x,pais)})}
  return out.sort((a,b)=>(a.falla?1:0)-(b.falla?1:0)||a.p.sort-b.p.sort||procName(a.p).localeCompare(procName(b.p)));
}
// ¿una opción (procesador · método) entra en un combo del banco {p, m, k}?
const comboHit=(c,o)=>(!c.p||c.p===o.p.id)&&(c.k?o.x.m.kind===c.k:!c.m||c.m===o.x.method_id);
// lo que conviene ofrecerle según cómo paga: efectivo → los de efectivo; un banco → su orden recomendado, después el resto, al final lo que ese banco no recomienda; otro banco → todo lo digital. Lo que falla, siempre último.
function bkRecom(pais,way){
  if(!pais||!way)return [];
  if(way==='efectivo')return bkOptions(pais,'efectivo');
  const L=bkOptions(pais,'digital'),b=way==='otro'?null:bk.banks.find(x=>x.id===way);
  if(!b)return L;
  const U=b.use_pm||[];if(!U.length)return L; // sin orden armado: se ve todo
  const rank=o=>U.findIndex(c=>comboHit(c,o));
  return L.map((o,i)=>({o,r:rank(o),i})).filter(x=>x.r>=0).sort((a,c)=>(a.o.falla?1:0)-(c.o.falla?1:0)||a.r-c.r||a.i-c.i).map(x=>x.o); // lo que el admin no puso como disponible no se ofrece
}
const banksIn=pais=>bk.banks.filter(b=>!b.country||b.country===pais).sort((a,b)=>a.name.localeCompare(b.name));
function bkOptHTML(o){
  const {p,x}=o,note=procFails(p,o.pais)?(failsIn(p,o.pais)?p.status_note:(procParent(p)||{}).status_note):x.status_note,otros=pmOf(p.id).filter(y=>y.method_id!==x.method_id&&bkPaisOk(y.countries&&y.countries.length?y.countries:p.countries));
  return `<details class="bk-opt${o.falla?' falla':''}" data-k="${esc(p.id+'|'+x.method_id)}"><summary>${bkIcon(p.id)}<span>${o.n?`<span class="bk-n">${o.n}</span>`:''}<b>${esc(x.m.name)}</b> con ${esc(procName(p))}</span><span class="grow"></span>${o.falla?`<span class="badge bad">Falla</span>`:'<span class="badge paid">Anda</span>'}</summary>
    <div class="bk-od">${o.falla?`<p class="hot">⚠ ${esc(note||'Está fallando: no lo ofrezcas por ahora.')}</p>`:''}${x.note?`<div class="bk-mnote"><div class="bk-mnh"><svg class="ic" aria-hidden="true"><use href="#i-info"/></svg><b>${esc(x.m.name)}</b></div><p>${esc(x.note)}</p></div>`:''}${p.notes?`<p class="bk-notes">${esc(p.notes)}</p>`:''}
      ${otros.length?`<p class="dim">${esc(procName(p))} también tiene: ${otros.map(y=>esc(y.m.name)).join(', ')}</p>`:''}${bkMini(p.id)}</div></details>`;
}

/* ---------- la vista ---------- */
const comboTxt=x=>{const pn=x.p?procName(procOf(x.p)):'';
  if(x.k)return (KINDS[x.k]||x.k)+(pn?' con '+pn:' (cualquier procesador)');
  return x.p&&x.m?bkName(x.p,x.m):x.p?pn+' (cualquier método)':x.m?(methOf(x.m)?methOf(x.m).name:'Método')+' (cualquier procesador)':''};
const comboFails=(x,pais)=>{ // pais: el del banco (vacío: cualquier falla cuenta)
  const fy=y=>failsIn(y,pais)||failsIn(procOf(y.processor_id),pais);
  if(x.k){const l=bk.pm.filter(y=>(methOf(y.method_id)||{}).kind===x.k&&(!x.p||y.processor_id===x.p));return l.length>0&&l.every(fy)}
  return x.p?bkFails(x.p,x.m,pais):x.m?bk.pm.some(y=>y.method_id===x.m&&fy(y)):false};
function bankChips(b){ // los primeros del orden recomendado
  const u=(b.use_pm||[]).slice(0,4).map((x,i)=>{const f=comboFails(x,b.country||'');return `<span class="bk-chip use${f?' warn':''}" title="${f?'Ahora está fallando':''}">${i+1}. ${esc(comboTxt(x))}${f?' · ⚠ falla':''}</span>`});
  const more=(b.use_pm||[]).length-4;
  return u.join('')+(more>0?`<span class="bk-chip">+${more}</span>`:'');
}
let bkMiOpen=''; // la nota de método abierta: procesador|método
V.banking={
  build(){
    $('#bkQ').addEventListener('input',e=>{bkQ=e.target.value;this.render({})});
    $('#bkTools').addEventListener('click',e=>{const b=e.target.closest('[data-bk]');if(!b)return;
      if(b.dataset.bk==='proc')procModal();else if(b.dataset.bk==='met')methodsModal();else if(b.dataset.bk==='bank')bankModal()});
    $('#bkBody').addEventListener('click',e=>{
      const pa=e.target.closest('[data-bkp]');if(pa){bkPais=pa.dataset.bkp;bkWay='';bkTipo='';this.render({});return} // paso 1: el país
      const w=e.target.closest('[data-bkw]');if(w){bkWay=w.dataset.bkw;bkTipo=bkWay==='efectivo'?'efectivo':bkWay?'digital':'';this.render({});return} // paso 2: efectivo o el banco
      const oc=e.target.closest('[data-bko]');if(oc){bkOrdC=oc.dataset.bko;bkOrdB='';this.render({});return} // el orden por banco (admin): país
      const ob=e.target.closest('[data-bkob]');if(ob){bkOrdB=ob.dataset.bkob;this.render({});return} // y banco
      const mv=e.target.closest('[data-bkmv]');if(mv){bkOrdMove(mv.closest('.bk-ord').dataset.i|0,mv.dataset.bkmv,mv.closest('[data-lst]').dataset.lst);return}
      const sv=e.target.closest('[data-bkordsave]');if(sv){bkOrdSave();return}
      const v=e.target.closest('[data-bkimg]');if(v)return bkLightbox(v.dataset.bkimg);
      const mi=e.target.closest('[data-bkmi]');if(mi){bkMiOpen=bkMiOpen===mi.dataset.bkmi?'':mi.dataset.bkmi;this.render({});return} // la ⓘ: abre o cierra la nota del método
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
    $('#bkTools').innerHTML=bkEd()?`<button type="button" class="btn sm" data-bk="met">Métodos</button><button type="button" class="btn sm" data-bk="bank">Banco</button><button type="button" class="btn sm pri" data-bk="proc">Procesador</button>`:'';
    const body=$('#bkBody');
    if(bk.ok===false){body.innerHTML='<section class="card"><div class="p-empty">Banking se activa en un rato (falta actualizar la base).</div></section>';return}
    if(bk.ok==null){body.innerHTML='<section class="card"><div class="p-empty">Cargando…</div></section>';return}
    const q=norm(bkQ).trim(),hit=t=>!q||norm(t).includes(q),ed=bkEd(),F=bkFallas().filter(f=>bkPaisOk(f.fc&&f.fc.length?f.fc:f.cs)&&(!f.mid||kindOk((methOf(f.mid)||{}).kind)));
    // ¿Cómo paga el cliente? 1) país · 2) efectivo, o con qué banco · y lo que conviene ofrecerle, en orden (se despliegan)
    const seg=(lab,items,on,attr)=>`<div class="bk-step"><span class="bk-sn">${lab}</span><div class="seg" role="group" aria-label="${esc(lab)}">${items.map(([k,l])=>`<button type="button" ${attr}="${esc(k)}" class="${on(k)?'on':''}">${esc(l)}</button>`).join('')}</div></div>`;
    const bkn=bkPais?banksIn(bkPais):[],bsel=bkWay&&bkWay!=='efectivo'&&bkWay!=='otro'?bk.banks.find(b=>b.id===bkWay):null;
    const opts=bkPais&&bkWay?bkRecom(bkPais,bkWay).map((o,i)=>({...o,n:o.falla?0:i+1})):[];
    const paso=`<section class="card bk-paso"><div class="card-h"><h3>¿Cómo paga el cliente?</h3></div>
      ${seg('1. País',PAISES.map(p=>[p,p]),k=>k===bkPais,'data-bkp')}
      ${bkPais?seg('2. ¿Efectivo o con qué banco?',[['efectivo','Efectivo'],...bkn.map(b=>[b.id,b.name]),['otro','Otro banco']],k=>k===bkWay,'data-bkw'):''}
      ${bsel?`<details class="bk-bsteps" data-k="bsteps"><summary>Cómo pagar con ${esc(bsel.name)}</summary>${(bsel.steps||[]).length?`<ol class="bk-steps">${bsel.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:'<p class="dim">Sin pasos cargados.</p>'}${bsel.notes?`<p class="bk-notes">${esc(bsel.notes)}</p>`:''}</details>`:''}
      ${bkPais&&bkWay?`<div class="bk-opts"><span class="bk-sn">${bkWay==='efectivo'?'Efectivo':bsel?'Lo que conviene con '+esc(bsel.name):'Opciones'} en ${esc(bkPais)}${opts.length?' <small class="dim">· primero lo mejor</small>':''}</span>${opts.length?opts.map(bkOptHTML).join(''):`<div class="p-empty" style="padding:8px 0">No hay ${bkWay==='efectivo'?'efectivo':'pago digital'} cargado para ${esc(bkPais)}.</div>`}</div>`:''}</section>`;
    const fallas='';const _F=F.length?`<section class="card bk-fallas"><div class="card-h"><h3><svg class="ic" aria-hidden="true"><use href="#i-alerta"/></svg> Fallando ahora</h3><span class="p-sub">no lo ofrezcas hasta que vuelva</span></div>${F.map(f=>`<div class="bk-f"><b>${esc(bkName(f.pid,f.mid))}</b>${f.fc&&f.fc.length?` <span class="badge bad">${esc(f.fc.join(', '))}</span>`:''}${f.mid?'':' <span class="badge bad">todo el procesador</span>'}${f.note?`<span class="bk-fn">${esc(f.note)}</span>`:''}<span class="dim">${f.at?esc(rel(new Date(f.at))):''}${f.by?' · '+esc(first(f.by)):''}</span><span class="grow"></span>${ed?`<button type="button" class="btn sm" data-bka="vuelve" data-id="${esc(f.pid)}" data-m="${esc(f.mid||'')}">Volvió a andar</button>`:''}</div>`).join('')}</section>`:'';
    const fam=p=>[p,...bk.procs.filter(r=>r.parent_id===p.id)]; // el procesador con sus rutas
    const procs=bk.procs.filter(p=>!p.parent_id&&p.active!==false&&bkPaisOk(p.countries)&&fam(p).some(q=>hit(procName(q))||pmOf(q.id).some(x=>hit(x.m.name)))&&(!bkTipo||fam(p).some(q=>pmOf(q.id).some(x=>kindOk(x.m.kind))))).sort((a,b)=>a.sort-b.sort||a.name.localeCompare(b.name));
    const msHTML=(p,ms)=>`<div class="bk-ms">${ms.length?ms.map(x=>{const k=p.id+'|'+x.method_id,on=bkMiOpen===k;const ef=effFail(p,x),off=ef!=null&&(!ef.length||(bkPais&&ef.includes(bkPais))),part=ef!=null&&ef.length&&!bkPais;
          return `<span class="bk-m ${off?'falla':'ok'}${on?' open':''}" title="${esc((KINDS[x.m.kind]||'Sin tipo')+(ef!=null?' · Falla'+enTxt(ef)+(x.status_note?': '+x.status_note:''):x.countries&&x.countries.length?' · solo en '+x.countries.join(', '):''))}">${esc(x.m.name)}${!bkPais&&x.countries&&x.countries.length?` <small>${esc(isoTxt(x.countries))}</small>`:''}${part?` <small class="bk-fc">⚠ ${esc(isoTxt(ef))}</small>`:''}${x.note?`<button type="button" class="bk-mi" data-bkmi="${esc(k)}" aria-expanded="${on}" aria-label="${on?'Cerrar':'Ver'} la nota de ${esc(x.m.name)}"><svg class="ic" aria-hidden="true"><use href="#i-info"/></svg></button>`:''}</span>`}).join(''):'<span class="dim">Sin métodos cargados</span>'}</div>
        ${(x=>x&&x.note?`<div class="bk-mnote"><div class="bk-mnh"><b>${esc(x.m.name)}</b><span class="dim">${esc(procName(p))}</span><span class="grow"></span><button type="button" class="ib" data-bkmi="${esc(p.id+'|'+x.method_id)}" aria-label="Cerrar la nota">✕</button></div><p>${esc(x.note)}</p></div>`:'')(ms.find(x=>bkMiOpen===p.id+'|'+x.method_id))}`;
    const msOf=p=>pmOf(p.id).filter(x=>bkPaisOk(x.countries&&x.countries.length?x.countries:p.countries)&&kindOk(x.m.kind));
    const badge=(p,ms)=>{const pf=failCs(p)||(procParent(p)?failCs(procParent(p)):null),pHere=pf!=null&&(!pf.length||(bkPais?pf.includes(bkPais):false)),nf=ms.filter(x=>failsIn(x,bkPais)).length; // con un país elegido, solo cuenta la falla de ese país y los métodos de ese país
      return {pHere,html:pHere?'<span class="badge bad">Falla</span>':pf&&pf.length&&!bkPais?`<span class="badge bad">Falla en ${esc(isoTxt(pf))}</span>`:nf?`<span class="badge bad">${nf===1?'Falla un método':nf+' métodos fallan'}</span>`:'<span class="badge paid">Anda</span>'}};
    const acts=p=>ed?`<div class="bk-act"><button type="button" class="btn sm" data-bka="falla" data-id="${esc(p.id)}">Reportar falla</button>${failCs(p)!=null||pmOf(p.id).some(x=>failCs(x)!=null)?`<button type="button" class="btn sm" data-bka="vuelve" data-id="${esc(p.id)}">Volvió a andar</button>`:''}<button type="button" class="btn sm" data-bka="edit" data-id="${esc(p.id)}">Editar</button></div>`:'';
    // los subprocesadores (rutas: PayPros → Método Bank, Método Cash) van como cajitas adentro del procesador, cada una con los métodos que se le asignaron
    const sub=r=>{const ms=msOf(r),b=badge(r,ms);return `<section class="bk-sub${b.pHere?' falla':''}" data-sub="${esc(r.id)}"><div class="bk-sub-h"><h5>${esc(r.name)}</h5>${b.html}${r.countries&&r.countries.length?`<span class="dim">${esc(isoTxt(r.countries))}</span>`:''}</div>${msHTML(r,ms)}${r.notes?`<p class="bk-notes">${esc(r.notes)}</p>`:''}${acts(r)}</section>`};
    const pc=p=>{const ms=msOf(p),b=badge(p,ms),subs=bk.procs.filter(r=>r.parent_id===p.id&&r.active!==false&&bkPaisOk(r.countries)).sort((a,c)=>a.sort-c.sort||a.name.localeCompare(c.name));
      return `<article class="bk-proc${b.pHere?' falla':''}${subs.length?' con-sub':''}"><div class="bk-ph-h">${bkIcon(p.id)}<h4>${esc(p.name)}</h4>${b.html}</div>
        <div class="dim bk-cs">${esc(paisesTxt(p.countries))}</div>
        ${ms.length||!subs.length?msHTML(p,ms):''}
        ${subs.map(sub).join('')}
        ${p.notes?`<p class="bk-notes">${esc(p.notes)}</p>`:''}${bkMini(p.id)}
        ${acts(p)}</article>`};
    const banks=bk.banks.filter(b=>(!bkPais||!b.country||b.country===bkPais)&&(hit(b.name)||hit(b.country)));
    const bRow=b=>`<div class="bk-bank"><div class="bk-bn"><b>${esc(b.name)}</b><span class="dim">${esc(b.country||'Todos los países')}</span></div><div class="bk-chips">${bankChips(b)}</div><span class="grow"></span><button type="button" class="btn sm" data-bka="bank" data-id="${esc(b.id)}">Ver flujo</button>${ed?`<button type="button" class="btn sm" data-bka="bankEd" data-id="${esc(b.id)}">Editar</button>`:''}</div>`;
    const hist=bk.inc.slice(0,30);
    const opened=openKeys(body);
    body.innerHTML=paso+fallas+(!bkPais?`<section class="card"><div class="p-empty">Elegí el país para ver los procesadores y los bancos.</div></section>`:
      `<section class="card"><div class="card-h"><h3>Procesadores</h3><span class="p-sub">${plural(procs.length,'procesador','procesadores')}${bkTipo?' para '+esc(bkTipo==='digital'?'pago digital':KINDS[bkTipo].toLowerCase()):''}${bkPais?' en '+esc(bkPais):''}</span></div>${procs.length?`<div class="bk-grid">${procs.map(pc).join('')}</div>`:`<div class="p-empty">${bk.procs.length?'Nada con ese filtro.':ed?'Cargá el primer procesador con el botón de arriba.':'Todavía no hay procesadores cargados.'}</div>`}</section>`+
      `<section class="card"><div class="card-h"><h3>Bancos</h3><span class="p-sub">cómo conviene pagar según el banco del cliente</span></div>${banks.length?banks.map(bRow).join(''):`<div class="p-empty">${bk.banks.length?'Ningún banco con ese filtro.':ed?'Cargá un banco con sus pasos; el orden de lo que conviene se arma en "Orden por banco".':'Todavía no hay bancos cargados.'}</div>`}</section>`)+
      (ed?bkOrdCard():'')+
      (hist.length?`<details class="card bk-hist" data-k="bkhist"><summary class="card-h"><h3>Historial</h3><span class="p-sub">fallas y vueltas</span></summary><div class="lst">${hist.map(i=>`<div class="li"><span class="t">${esc(whenTxt(new Date(i.created_at)))}</span><span class="n"><b>${esc(incName(i)+enTxt(i.countries))}</b> ${i.kind==='falla'?'<span class="badge bad">falla</span>':'<span class="badge paid">volvió</span>'}${i.note?`<small>${esc(i.note)}</small>`:''}</span><span class="d">${i.created_by?esc(first(i.created_by)):''}</span><span></span><span></span></div>${bkThumbs('incident',i.id)}`).join('')}</div></details>`:'');
    reopen(body,opened);bkHydrate(body);bkOrdDrag(body);
  },
};
// en el inicio: si algo está fallando, arriba de todo
function bkCard(){
  if(!bk.ok)return '';
  const F=bkFallas();if(!F.length)return '';
  return `<div class="card-h"><h3><svg class="ic" aria-hidden="true"><use href="#i-alerta"/></svg> Fallas de pago</h3><span class="p-sub">no lo ofrezcas hasta que vuelva</span><span class="grow"></span><button type="button" class="btn sm" data-go="banking">Ver Banking</button></div>
    <div class="lst">${F.slice(0,4).map(f=>`<div class="li"><span class="t">${f.at?esc(rel(new Date(f.at))):''}</span><span class="n"><b>${esc(bkName(f.pid,f.mid)+enTxt(f.fc))}</b>${f.note?`<small>${esc(f.note)}</small>`:''}</span><span></span><span></span><span></span></div>`).join('')}</div>`;
}

/* ---------- editores (admin y team leader) ---------- */
async function bkSave(p){try{const r=await Q(p);await bkLoad(true);return r||true}catch(e){toast(esc(errMsg(e)),'err');return false}}
function procModal(p){
  if(!bkEd())return;
  const have=new Set(p?bk.pm.filter(x=>x.processor_id===p.id).map(x=>x.method_id):[]);
  let savedId=p&&p.id;
  const tops=bk.procs.filter(x=>!x.parent_id&&(!p||x.id!==p.id)),hasKids=p&&bk.procs.some(x=>x.parent_id===p.id);
  modal({title:p?'Editar procesador':'Nuevo procesador',wide:true,body:`<div class="bk-row"><label class="fld grow"><span>Nombre</span><input id="bpN" maxlength="60" value="${esc(p&&p.name||'')}" autofocus></label>
      ${hasKids?'':`<label class="fld"><span>Es una ruta de <small class="dim">(ej.: Cash de PayPros)</small></span><select id="bpP"><option value="">No, es un procesador</option>${tops.map(x=>`<option value="${esc(x.id)}"${p&&p.parent_id===x.id?' selected':''}>${esc(x.name)}</option>`).join('')}</select></label>`}</div>
    <div class="fld"><span>Países <small class="dim">(sin marcar: todos)</small></span>${paisChecks(p&&p.countries,'bpC')}</div>
    <div class="fld"><span>Métodos de este procesador</span><div class="bk-paises" id="bpM">${bk.methods.map(m=>`<label class="chk"><input type="checkbox" value="${esc(m.id)}"${have.has(m.id)?' checked':''}>${esc(m.name)}</label>`).join('')||'<span class="dim">No hay métodos: agregá uno abajo.</span>'}</div>
      <div class="bk-row"><input id="bpNew" maxlength="60" placeholder="Método nuevo (ej.: Transferencia, Tarjeta, Boleto)">${kindSel('','bpNewK')}<button type="button" class="btn sm" id="bpAdd">Agregar</button></div></div>
    <div class="fld"><span>Cada método: en qué países está <small class="dim">(sin marcar: en todos los del procesador)</small> y su nota</span><div id="bpMC"></div></div>
    <label class="fld"><span>Notas <small class="dim">(cómo se usa, límites, horarios…)</small></span><textarea id="bpNo" rows="4" maxlength="4000">${esc(p&&p.notes||'')}</textarea></label>
    ${bkPhotoField('processor',p&&p.id)}<div class="ebox" id="bpE"></div>`,
    onOpen:api=>{
      api._up=bkPhotoWire(api,'processor',()=>savedId);
      // países de cada método: solo los del procesador (o todos si el procesador no tiene)
      const mc={},mn={};for(const x of p?bk.pm.filter(y=>y.processor_id===p.id):[]){mc[x.method_id]=new Set(x.countries||[]);mn[x.method_id]=x.note||''}
      api._mc=mc;api._mn=mn;
      const drawMC=()=>{
        api.box.querySelectorAll('#bpMC input:checked').forEach(i=>{(mc[i.dataset.m]||(mc[i.dataset.m]=new Set())).add(i.value)});
        api.box.querySelectorAll('#bpMC input:not(:checked)').forEach(i=>{if(mc[i.dataset.m])mc[i.dataset.m].delete(i.value)});
        api.box.querySelectorAll('#bpMC [data-mnote]').forEach(t=>{mn[t.dataset.mnote]=t.value}); // lo escrito no se pierde al redibujar
        const base=[...api.box.querySelectorAll('[name=bpC]:checked')].map(i=>i.value),cs=base.length?base:PAISES;
        const ms=[...api.q('#bpM').querySelectorAll('input:checked')].map(i=>methOf(i.value)||{id:i.value,name:i.parentElement.textContent.trim()});
        api.q('#bpMC').innerHTML=ms.length?ms.map(m=>`<div class="bk-mc"><b>${esc(m.name)}</b><div class="bk-paises">${cs.map(c=>`<label class="chk"><input type="checkbox" data-m="${esc(m.id)}" value="${esc(c)}"${mc[m.id]&&mc[m.id].has(c)?' checked':''}>${esc(c)}</label>`).join('')}</div>
          <textarea class="bk-mnin" data-mnote="${esc(m.id)}" rows="2" maxlength="1000" placeholder="Nota de ${esc(m.name)} (opcional): cómo se usa, qué le pide al cliente…" aria-label="Nota de ${esc(m.name)}">${esc(mn[m.id]||'')}</textarea></div>`).join(''):'<span class="dim">Marcá los métodos de arriba.</span>';
      };
      api._drawMC=drawMC;drawMC();
      api.box.addEventListener('change',e=>{if(e.target.closest('#bpM')||e.target.name==='bpC')drawMC()});
      api.q('#bpAdd').onclick=async()=>{const n=api.q('#bpNew').value.trim();if(!n)return;
        const r=await bkSave(sb.from('pay_methods').insert({name:n.slice(0,60),kind:api.q('#bpNewK').value||kindGuess(n),sort:bk.methods.length}).select('*'));if(!r)return;api.q('#bpNewK').value='';
        const m=r[0];api.q('#bpNew').value='';const box=api.q('#bpM');if(box.querySelector('.dim'))box.innerHTML='';
        box.insertAdjacentHTML('beforeend',`<label class="chk"><input type="checkbox" value="${esc(m.id)}" checked>${esc(m.name)}</label>`);api._drawMC()};
    },
    actions:[...(p?[{l:'Borrar',cls:'danger',fn:async()=>{if(!await confirmar('Borrar procesador',`¿Borrar <b>${esc(procName(p))}</b> con sus métodos${hasKids?', sus rutas':''}, fotos e historial?`,'borrar',true))return false;
        await bkSave(sb.from('pay_files').delete().eq('ref_kind','processor').eq('ref_id',p.id));if(await bkSave(sb.from('processors').delete().eq('id',p.id)))toast('Procesador borrado.')}}]:[]),
      {l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
        const name=api.q('#bpN').value.trim(),countries=[...api.box.querySelectorAll('[name=bpC]:checked')].map(i=>i.value),notes=api.q('#bpNo').value.trim()||null;
        if(!name){api.q('#bpE').textContent='Poné el nombre.';return false}
        const row={name:name.slice(0,60),countries,notes,parent_id:(api.q('#bpP')||{}).value||null,updated_at:new Date().toISOString()};
        if(row.parent_id&&hasKids)row.parent_id=null;
        const r=await bkSave(p?sb.from('processors').update(row).eq('id',p.id).select('id'):sb.from('processors').insert({...row,sort:bk.procs.length}).select('id'));if(!r)return false;
        savedId=p?p.id:r[0].id;
        const want=new Set([...api.q('#bpM').querySelectorAll('input:checked')].map(i=>i.value));
        api._drawMC();const base=countries.length?countries:PAISES;
        const csOf=id=>{const s=api._mc[id];const l=s?base.filter(c=>s.has(c)):[];return l.length===base.length?[]:l}; // todos marcados = como el procesador
        const noteOf=id=>(api._mn[id]||'').trim().slice(0,1000)||null;
        const add=[...want].filter(id=>!have.has(id)).map(method_id=>({processor_id:savedId,method_id,countries:csOf(method_id),note:noteOf(method_id)})),del=[...have].filter(id=>!want.has(id));
        if(add.length&&!await bkSave(sb.from('processor_methods').insert(add)))return false;
        for(const id of [...want].filter(id=>have.has(id))){const now=bk.pm.find(x=>x.processor_id===savedId&&x.method_id===id),cs=csOf(id);
          if(now&&(JSON.stringify(now.countries||[])!==JSON.stringify(cs)||(now.note||null)!==noteOf(id))&&!await bkSave(sb.from('processor_methods').update({countries:cs,note:noteOf(id)}).eq('processor_id',savedId).eq('method_id',id)))return false}
        if(del.length&&!await bkSave(sb.from('processor_methods').delete().eq('processor_id',savedId).in('method_id',del)))return false;
        await api._up();await bkLoad(true);toast(p?'Procesador guardado.':`Procesador <b>${esc(name)}</b> cargado.`);
      }}]});
}
function methodsModal(){
  if(!bkEd())return;
  const row=m=>`<div class="bk-row" data-mid="${esc(m.id)}"><input value="${esc(m.name)}" maxlength="60" aria-label="Nombre del método">${kindSel(m.kind||'')}<span class="dim">${plural(bk.pm.filter(x=>x.method_id===m.id).length,'procesador','procesadores')}</span><button type="button" class="ib" data-mdel title="Borrar">✕</button></div>`;
  modal({title:'Métodos de pago',body:`<p class="mp">Un método puede estar en varios procesadores. Cambiale el nombre o el tipo (efectivo, transferencia o tarjeta) acá y se cambia en todos.</p><div id="bmL">${bk.methods.map(row).join('')||'<p class="dim">Todavía no hay métodos.</p>'}</div>
    <div class="bk-row"><input id="bmN" maxlength="60" placeholder="Método nuevo">${kindSel('','bmK')}<button type="button" class="btn sm" id="bmA">Agregar</button></div>`,
    onOpen:api=>{
      api.q('#bmA').onclick=async()=>{const n=api.q('#bmN').value.trim();if(!n)return;const r=await bkSave(sb.from('pay_methods').insert({name:n.slice(0,60),kind:api.q('#bmK').value||kindGuess(n),sort:bk.methods.length}).select('*'));if(r){api.q('#bmN').value='';api.q('#bmK').value='';const l=api.q('#bmL');if(l.querySelector('p.dim'))l.innerHTML='';l.insertAdjacentHTML('beforeend',row(r[0]))}};
      api.box.addEventListener('change',async e=>{const w=e.target.closest('[data-mid]');if(!w)return;
        if(e.target.matches('[data-kind]'))return bkSave(sb.from('pay_methods').update({kind:e.target.value||null}).eq('id',w.dataset.mid));
        if(e.target.tagName!=='INPUT')return;const n=e.target.value.trim();if(n)await bkSave(sb.from('pay_methods').update({name:n.slice(0,60)}).eq('id',w.dataset.mid))});
      api.box.addEventListener('click',async e=>{const d=e.target.closest('[data-mdel]');if(!d)return;const w=d.closest('[data-mid]'),m=methOf(w.dataset.mid);
        if(!await confirmar('Borrar método',`¿Borrar <b>${esc(m?m.name:'')}</b> de todos los procesadores?`,'borrar',true))return;if(await bkSave(sb.from('pay_methods').delete().eq('id',w.dataset.mid)))w.remove()});
    },actions:[{l:'Listo',cls:'pri',fn:()=>{refresh()}}]});
}
function reportModal(pid,falla,mid0){
  if(!bkEd())return;
  const p=procOf(pid);if(!p)return;
  const ms=pmOf(pid).filter(x=>falla?true:failCs(x)!=null),allOk=falla||failCs(p)!=null;
  if(!allOk&&!ms.length)return toast('No hay nada fallando en este procesador.','warn');
  // qué se marca: todo el procesador, o uno o varios métodos (se marcan y desmarcan de a uno)
  const pre=new Set(mid0&&ms.some(x=>x.method_id===mid0)?[mid0]:[]),all=!pre.size&&allOk;
  const rowOf=w=>w?bk.pm.find(y=>y.processor_id===pid&&y.method_id===w):p;
  const scopeOf=w=>{const r=rowOf(w),base=w&&r&&r.countries&&r.countries.length?r.countries:p.countries&&p.countries.length?p.countries:PAISES;if(falla)return base;const fc=failCs(r);return fc&&fc.length?fc:base};
  let incId=null;
  modal({title:falla?`Reportar falla · ${esc(procName(p))}`:`Volvió a andar · ${esc(procName(p))}`,body:`<div class="fld"><span>${falla?'¿Qué falla?':'¿Qué volvió?'}${ms.length>1?' <small class="dim">(podés marcar varios)</small>':''}</span>
      ${allOk?`<label class="chk blk"><input type="checkbox" id="brAll"${all?' checked':''}><b>Todo el procesador</b></label>`:''}
      <div id="brMs">${ms.map(x=>`<label class="chk blk"><input type="checkbox" name="brM" value="${esc(x.method_id)}"${pre.has(x.method_id)?' checked':''}>${esc(x.m.name)}${failCs(x)!=null?' <small class="dim">· falla ahora</small>':''}</label>`).join('')}</div></div>
    <div class="fld"><span>¿En qué países? <small class="dim">(sin marcar: en todos)</small></span><div class="bk-paises" id="brC"></div><p class="p-sub" id="brCs" style="margin:4px 0 0"></p></div>
    <label class="fld"><span>${falla?'Qué pasa':'Nota'} <small class="dim">(lo ve toda la mesa)</small></span><textarea id="brN" rows="3" maxlength="1000" placeholder="${falla?'Ej.: rechaza todas las tarjetas desde las 14 h':'Opcional'}"></textarea></label>
    ${falla?bkPhotoField('incident',null):''}<p class="note">${falla?'Le llega a toda la mesa un aviso urgente.':'Le llega a toda la mesa un aviso.'}</p><div class="ebox" id="brE"></div>`,
    onOpen:api=>{
      if(falla)api._up=bkPhotoWire(api,'incident',()=>incId);
      const picked=()=>[...api.box.querySelectorAll('[name=brM]:checked')].map(i=>i.value),isAll=()=>!!(api.q('#brAll')||{}).checked;
      const draw=()=>{const a=isAll(),ids=picked();api.q('#brMs').classList.toggle('off',a);
        const cs=a||!ids.length?scopeOf(''):[...new Set(ids.flatMap(scopeOf))],fc=a?failCs(p):ids.length===1?failCs(rowOf(ids[0])):null;
        const was=new Set([...api.box.querySelectorAll('[name=brC]:checked')].map(i=>i.value));
        api.q('#brC').innerHTML=cs.map(c=>`<label class="chk"><input type="checkbox" name="brC" value="${esc(c)}"${was.has(c)?' checked':''}>${esc(c)}</label>`).join('');
        api.q('#brCs').textContent=fc==null?'':fc.length?'Ahora falla en '+fc.join(', ')+'.':'Ahora falla en todos los países.'};
      api.box.addEventListener('change',e=>{if(e.target.id==='brAll'&&e.target.checked)api.box.querySelectorAll('[name=brM]').forEach(i=>{i.checked=false});
        if(e.target.name==='brM'&&e.target.checked&&api.q('#brAll'))api.q('#brAll').checked=false;
        if(e.target.id==='brAll'||e.target.name==='brM')draw()});draw();
    },
    actions:[{l:'Cancelar'},{l:falla?'Avisar la falla':'Avisar que volvió',cls:'pri'+(falla?' danger':''),fn:async api=>{
      const a=!!(api.q('#brAll')||{}).checked,ids=a?[]:[...api.box.querySelectorAll('[name=brM]:checked')].map(i=>i.value),note=api.q('#brN').value.trim(),cs=[...api.box.querySelectorAll('[name=brC]:checked')].map(i=>i.value);
      if(!a&&!ids.length){api.q('#brE').textContent='Marcá todo el procesador o al menos un método.';return false}
      const r=await B.rpc(ids.length>1?'pay_report_many':'pay_report',ids.length>1?{pid,mids:ids,falla,note:note||null,cs}:{pid,mid:ids[0]||null,falla,note:note||null,cs});if(!r)return false;incId=r.id;
      const t=`<b>${esc((ids.length>1?procName(p)+' · '+ids.map(id=>(methOf(id)||{}).name||'?').join(', '):bkName(pid,ids[0]||null))+enTxt(cs))}</b>`;
      if(falla)await api._up();await bkLoad(true);toast(falla?`Avisé a la mesa que ${t} falla.`:`Avisé que ${t} volvió a andar.`)}}]});
}
function bankModal(b){
  if(!bkEd())return;
  let savedId=b&&b.id;
  modal({title:b?'Editar banco':'Nuevo banco',wide:true,body:`<div class="bk-row"><label class="fld grow"><span>Banco</span><input id="bbN" maxlength="80" value="${esc(b&&b.name||'')}" placeholder="Ej.: Falabella" autofocus></label>
      <label class="fld"><span>País</span><select id="bbC"><option value="">Todos</option>${PAISES.map(p=>`<option${b&&b.country===p?' selected':''}>${esc(p)}</option>`).join('')}</select></label></div>
    <label class="fld"><span>Pasos recomendados <small class="dim">(uno por línea)</small></span><textarea id="bbS" rows="5" maxlength="4000" placeholder="1. Pedile que pague con tarjeta de crédito&#10;2. …">${esc((b&&b.steps||[]).join('\n'))}</textarea></label>
    ${b?`<p class="note">Qué conviene ofrecer con este banco se ordena en <b>Orden por banco</b>, arrastrando.</p>`:''}
    <label class="fld"><span>Notas</span><textarea id="bbNo" rows="3" maxlength="4000">${esc(b&&b.notes||'')}</textarea></label>
    ${bkPhotoField('bank',b&&b.id)}<div class="ebox" id="bbE"></div>`,
    onOpen:api=>{
      api._up=bkPhotoWire(api,'bank',()=>savedId);
    },
    actions:[...(b?[{l:'Borrar',cls:'danger',fn:async()=>{if(!await confirmar('Borrar banco',`¿Borrar <b>${esc(b.name)}</b> y su flujo?`,'borrar',true))return false;
        await bkSave(sb.from('pay_files').delete().eq('ref_kind','bank').eq('ref_id',b.id));if(await bkSave(sb.from('banks').delete().eq('id',b.id)))toast('Banco borrado.')}}]:[]),
      {l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
        const name=api.q('#bbN').value.trim();if(!name){api.q('#bbE').textContent='Poné el nombre del banco.';return false}
        const row={name:name.slice(0,80),country:api.q('#bbC').value,steps:api.q('#bbS').value.split('\n').map(s=>s.replace(/^\s*\d+[.)-]?\s*/,'').trim()).filter(Boolean).slice(0,30),
          notes:api.q('#bbNo').value.trim()||null,updated_at:new Date().toISOString(),updated_by:me};
        if(!b)Object.assign(row,{use_pm:[],avoid_pm:[]});
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

// ── Orden por banco (admin y team leader): por país y banco, arrastrar lo que conviene ofrecer
let bkOrdC='',bkOrdB='',bkOrd=null; // bkOrd: lista ordenada de opciones {p,x} del banco a la vista (null = recién armada del banco)
const ordKey=o=>o.p.id+'|'+o.x.method_id;
function bkOrdList(b){ // disponibles con el banco (use_pm, en orden) y no disponibles (todo lo demás digital de su país)
  const L=bkOptions(b.country||bkOrdC,'digital').map(o=>({p:o.p,x:o.x})),rank=o=>(b.use_pm||[]).findIndex(c=>comboHit(c,{p:o.p,x:o.x}));
  const R=L.map((o,i)=>({o,r:rank(o),i}));
  return {l:R.filter(x=>x.r>=0).sort((a,c)=>a.r-c.r||a.i-c.i).map(x=>x.o),n:R.filter(x=>x.r<0).map(x=>x.o)};
}
function bkOrdCard(){
  const cs=PAISES,bs=bkOrdC?banksIn(bkOrdC):[],b=bkOrdB?bk.banks.find(x=>x.id===bkOrdB):null;
  if(b&&(!bkOrd||bkOrd.b!==b.id))bkOrd={b:b.id,...bkOrdList(b),dirty:false};
  const seg=(items,on,attr)=>`<div class="seg" role="group">${items.map(([k,l])=>`<button type="button" ${attr}="${esc(k)}" class="${on(k)?'on':''}">${esc(l)}</button>`).join('')}</div>`;
  return `<section class="card bk-ordc"><div class="card-h"><h3>Orden por banco</h3><span class="p-sub">lo que le ofrecés a un cliente de cada banco, de mejor a peor: arrastrá para cambiarlo</span></div>
    <div class="bk-step"><span class="bk-sn">País</span>${seg(cs.map(c=>[c,c]),k=>k===bkOrdC,'data-bko')}</div>
    ${bkOrdC?`<div class="bk-step"><span class="bk-sn">Banco</span>${bs.length?seg(bs.map(x=>[x.id,x.name]),k=>k===bkOrdB,'data-bkob'):`<span class="dim">No hay bancos de ${esc(bkOrdC)}: cargá uno en Bancos.</span>`}</div>`:''}
    ${b?`<div class="bk-ord2">
      <div class="bk-ordb"><h4>Disponibles con ${esc(b.name)} <small class="dim">· de mejor a peor</small></h4><ol class="bk-ordl" id="bkOrdL" data-lst="l">${bkOrd.l.length?bkOrd.l.map((o,i)=>`<li class="bk-ord${bkFails(o.p.id,o.x.method_id,b.country||bkOrdC)?' falla':''}" draggable="true" data-i="${i}"><span class="bk-grip" aria-hidden="true">⋮⋮</span><span class="bk-on">${i+1}</span>${bkIcon(o.p.id)}<span class="grow"><b>${esc(o.x.m.name)}</b> con ${esc(procName(o.p))}${o.x.m.kind?` <small class="dim">· ${esc(KINDS[o.x.m.kind]||o.x.m.kind)}</small>`:''}</span><button type="button" class="ib" data-bkmv="up" title="Subir"${i?'':' disabled'}>▲</button><button type="button" class="ib" data-bkmv="down" title="Bajar"${i<bkOrd.l.length-1?'':' disabled'}>▼</button><button type="button" class="ib" data-bkmv="out" title="No disponible">✕</button></li>`).join(''):`<li class="dim bk-ordv">Arrastrá acá (o tocá +) lo que anda con ${esc(b.name)}. Si no hay nada, el agente ve todo.</li>`}</ol></div>
      <div class="bk-ordb"><h4>No disponibles <small class="dim">· el agente no los ve</small></h4><ol class="bk-ordl no" id="bkOrdN" data-lst="n">${bkOrd.n.length?bkOrd.n.map((o,i)=>`<li class="bk-ord" draggable="true" data-i="${i}"><span class="bk-grip" aria-hidden="true">⋮⋮</span>${bkIcon(o.p.id)}<span class="grow"><b>${esc(o.x.m.name)}</b> con ${esc(procName(o.p))}${o.x.m.kind?` <small class="dim">· ${esc(KINDS[o.x.m.kind]||o.x.m.kind)}</small>`:''}</span><button type="button" class="ib" data-bkmv="in" title="Disponible">+</button></li>`).join(''):`<li class="dim bk-ordv">${bkOrd.l.length?'Todo lo digital de '+esc(b.country||bkOrdC)+' está disponible.':'No hay pago digital cargado para '+esc(b.country||bkOrdC)+'.'}</li>`}</ol></div></div>
      <div class="bk-row"><button type="button" class="btn pri" data-bkordsave${bkOrd.dirty?'':' disabled'}>Guardar orden</button><span class="dim">${bkOrd.dirty?'Hay cambios sin guardar.':'Así lo ve la mesa.'}</span></div>`:''}</section>`;
}
function bkOrdMove(i,dir,from){ // from: 'l' disponibles · 'n' no disponibles; dir: up · down · in · out · 'l:<j>' / 'n:<j>' (soltado en esa posición)
  if(!bkOrd)return;const L=bkOrd.l,N=bkOrd.n;from=from||'l';
  if(dir==='in'){const [o]=N.splice(i,1);if(!o)return;L.push(o)}
  else if(dir==='out'){const [o]=L.splice(i,1);if(!o)return;N.push(o)}
  else if(dir==='up'||dir==='down'){if(from!=='l')return;const j=dir==='up'?i-1:i+1;if(j<0||j>=L.length)return;const [o]=L.splice(i,1);L.splice(j,0,o)}
  else{const m=/^([ln]):(\d+)$/.exec(dir);if(!m)return;const to=m[1],j=+m[2],src=from==='l'?L:N,dst=to==='l'?L:N;if(src===dst&&j===i)return;const [o]=src.splice(i,1);if(!o)return;dst.splice(Math.min(j,dst.length),0,o)}
  bkOrd.dirty=true;refresh();
}
function bkOrdDrag(root){ // arrastrar (HTML5 drag) entre las dos listas del orden y adentro de cada una
  const W=root.querySelector('.bk-ord2');if(!W||W._drag)return;W._drag=1;let from=null;
  W.addEventListener('dragstart',e=>{const li=e.target.closest('.bk-ord');if(!li)return;from={i:li.dataset.i|0,l:li.closest('[data-lst]').dataset.lst};li.classList.add('drag');e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain','x')}catch(_){}});
  W.addEventListener('dragover',e=>{const ol=e.target.closest('[data-lst]');if(!ol||!from)return;e.preventDefault();W.querySelectorAll('.over').forEach(x=>x.classList.remove('over'));(e.target.closest('.bk-ord')||ol).classList.add('over')});
  W.addEventListener('dragleave',e=>{const t=e.target.closest('.bk-ord,[data-lst]');if(t)t.classList.remove('over')});
  W.addEventListener('drop',e=>{const ol=e.target.closest('[data-lst]');if(!ol||!from)return;e.preventDefault();const li=e.target.closest('.bk-ord'),to=ol.dataset.lst,j=li?li.dataset.i|0:(to==='l'?bkOrd.l:bkOrd.n).length,f=from;from=null;bkOrdMove(f.i,to+':'+j,f.l)});
  W.addEventListener('dragend',()=>{from=null;W.querySelectorAll('.drag,.over').forEach(x=>x.classList.remove('drag','over'))});
}
async function bkOrdSave(){
  if(!bkOrd||!bkEd())return;const b=bk.banks.find(x=>x.id===bkOrd.b);if(!b)return;
  const use_pm=bkOrd.l.map(o=>({p:o.p.id,m:o.x.method_id})).slice(0,120),avoid_pm=bkOrd.n.map(o=>({p:o.p.id,m:o.x.method_id})).slice(0,120); // avoid_pm = no disponibles (solo registro)
  if(await bkSave(sb.from('banks').update({use_pm,avoid_pm,updated_at:new Date().toISOString(),updated_by:me}).eq('id',b.id))){bkOrd.dirty=false;toast(`Orden de <b>${esc(b.name)}</b> guardado.`)}
}
