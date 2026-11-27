/* ---------- Banking 3 (el dueño, 26/11/2026): procesadores, sub-procesadores, métodos y bancos, por país ----------
   Tres solapas: ¿Cómo paga el cliente? (la del agente) · Procesadores (cajas con sus métodos adentro; un sub-procesador es una cajita
   adentro de la caja; todo se arrastra) · Bancos (sus pasos y el orden de qué conviene ofrecer con cada uno).
   Un método es un renglón propio del procesador o del sub-procesador, con UN país (tabla methods): "Nequi · Colombia" y
   "Nequi · Panamá" conviven. Editan admin y team leader; la mesa mira. Una falla avisa a todos (urgente) y la vuelta, normal. */
const PAISES=['Colombia','México','Chile','Panamá','Guatemala','Costa Rica','Perú']; // los países donde trabaja la mesa
let bk={ok:null,procs:[],methods:[],banks:[],inc:[],files:[],at:0,busy:null},bkPais='',bkQ='',bkTipo='',bkWay=''; // bkWay: '' · 'efectivo' · 'otro' (otro banco) · id de un banco
const KINDS={efectivo:'Efectivo',transferencia:'Transferencia',tarjeta:'Tarjeta'};
const kindGuess=n=>/transf|spei|pse|khipu|wire|nequi|daviplata|yape|plin/i.test(n)?'transferencia':/tarjeta|card|cr[eé]dito|d[eé]bito|visa|master/i.test(n)?'tarjeta':/efectivo|boleto|cash|oxxo|efecty|baloto|pagoefectivo|servipag/i.test(n)?'efectivo':null;
const kindOkFor=(tipo,k)=>!tipo||(tipo==='digital'?k==='transferencia'||k==='tarjeta':k===tipo);
let bkSeenAt=+local.get('bkSeen',0)||0;
const bkImgs=new Map(); // id → data URL (se piden cuando se muestran)
const bkEd=()=>!!profile&&['admin','leader'].includes(profile.role);
const procOf=id=>bk.procs.find(p=>p.id===id),methOf=id=>bk.methods.find(m=>m.id===id);
const procParent=p=>p&&p.parent_id?bk.procs.find(x=>x.id===p.parent_id):null;
const procName=p=>{const pa=procParent(p);return pa?pa.name+' · '+p.name:p?p.name:'Procesador'}; // "PayPros · Cash"
const bySort=(a,b)=>a.sort-b.sort||a.name.localeCompare(b.name);
const subsOf=p=>bk.procs.filter(r=>r.parent_id===p.id&&r.active!==false).sort(bySort);
const methodsOf=pid=>bk.methods.filter(m=>m.processor_id===pid).sort(bySort);
const famOf=p=>[p,...subsOf(p)]; // el procesador con sus sub-procesadores
const inPais=(m,pais)=>!pais||!m.country||m.country===pais; // sin país en el método: en todos
const bkName=(pid,mid)=>{const p=procOf(pid),m=mid?methOf(mid):null;return procName(p)+(m?' · '+m.name+(m.country?' ('+m.country+')':''):'')};
const incName=i=>{const ids=i.method_ids&&i.method_ids.length>1?i.method_ids:null;return ids?procName(procOf(i.processor_id))+' · '+ids.map(id=>(methOf(id)||{}).name||'?').join(', '):bkName(i.processor_id,i.method_id)};
// una falla del procesador puede ser en todos los países o solo en algunos (fail_countries): null = anda · [] = en todos · [..] = ahí
const failCs=r=>r&&r.status==='falla'?(r.fail_countries||[]):null;
const failsIn=(r,pais)=>{const c=failCs(r);return c!=null&&(!c.length||!pais||c.includes(pais))}; // sin país: cualquier falla cuenta
const procFails=(p,pais)=>!!p&&(failsIn(p,pais)||failsIn(procParent(p),pais)); // la caja, o la caja grande de la cajita
const mFails=(m,pais)=>m.status==='falla'||procFails(procOf(m.processor_id),pais||m.country);
const enTxt=c=>c&&c.length?' en '+c.join(', '):'';
// lo que está fallando ahora (para el inicio y los avisos)
function bkFallas(){
  const out=[];
  for(const p of bk.procs)if(p.active!==false&&p.status==='falla')out.push({pid:p.id,mid:null,note:p.status_note,at:p.status_at,by:p.status_by,fc:failCs(p)});
  for(const m of bk.methods)if(m.status==='falla'){const p=procOf(m.processor_id);if(p&&p.active!==false&&!procFails(p,m.country))out.push({pid:p.id,mid:m.id,note:m.status_note,at:m.status_at,by:m.status_by,fc:m.country?[m.country]:[]})}
  return out.sort((a,b)=>new Date(b.at||0)-new Date(a.at||0));
}

async function bkLoad(force){
  if(!sb||!me)return;
  if(bk.busy)return bk.busy;
  if(!force&&Date.now()-bk.at<15e3)return;
  bk.busy=(async()=>{
    try{bkApply(await bkFetch())}
    catch(e){if(/processors|methods|pay_|PGRST205|42P01|does not exist/.test(String(e&&(e.message||e.code))))bk.ok=false}
    finally{bk.busy=null}
  })();
  return bk.busy;
}
async function bkFetch(){
  const [pr,ms,bn,inc,fl]=await Promise.all([Q(sb.from('processors').select('*').order('sort').order('name')),Q(sb.from('methods').select('*').order('sort').order('name')),
    Q(sb.from('banks').select('*').order('country').order('name')),
    Q(sb.from('pay_incidents').select('*').order('created_at',{ascending:false}).limit(60)),Q(sb.from('pay_files').select('id,ref_kind,ref_id,w,h,caption,created_at').order('created_at'))]);
  return {pr,ms,bn,inc,fl};
}
const BK_VIEWS=['banking','bkprocs','bkbancos'];
function bkApply(x,quiet){
  if(!x){bk.ok=false;return}
  const {pr,ms,bn,inc,fl}=x,was=bk.ok;Object.assign(bk,{ok:true,procs:pr,methods:ms,banks:bn,inc,files:fl,at:Date.now()});
  if(was!==true||quiet){bkSeenAt=Math.max(bkSeenAt,0,...inc.map(i=>+new Date(i.created_at)));local.set('bkSeen',bkSeenAt)}else bkNotify(inc); // al entrar no avisa lo viejo
  if(ready&&[...BK_VIEWS,'home'].includes(cur))refresh();else if(ready)status();
}
function bkNotify(list){
  const fresh=list.filter(i=>+new Date(i.created_at)>bkSeenAt).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  if(!fresh.length)return;
  bkSeenAt=Math.max(...fresh.map(i=>+new Date(i.created_at)));local.set('bkSeen',bkSeenAt);
  for(const i of fresh){
    if(i.created_by===me)continue;
    const t=incName(i)+(i.method_id||(i.method_ids||[]).length?'':enTxt(i.countries)),who=i.created_by?first(i.created_by):'';
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
// botones grandes para elegir uno (tipo, país): una sola acción, sin desplegables
const segPick=(name,items,on)=>`<div class="seg wrap" role="group">${items.map(([k,l])=>`<button type="button" data-pick="${esc(name)}" data-val="${esc(k)}" class="${on===k?'on':''}">${esc(l)}</button>`).join('')}</div>`;
const pickWire=api=>api.box.addEventListener('click',e=>{const b=e.target.closest('[data-pick]');if(!b)return;b.parentElement.querySelectorAll('[data-pick]').forEach(x=>x.classList.toggle('on',x===b))});
const pickVal=(api,name)=>{const b=api.box.querySelector(`[data-pick="${name}"].on`);return b?b.dataset.val:''};

/* ---------- las opciones: qué ofrecerle al cliente ---------- */
function bkOptions(pais=bkPais,tipo=bkTipo){ // {p, m, pais, falla}: los métodos que sirven para ese país y tipo de pago (también los usa la ficha del cliente)
  const out=[];
  for(const m of bk.methods){const p=procOf(m.processor_id);if(!p||p.active===false||!inPais(m,pais)||!kindOkFor(tipo,m.kind))continue;
    const top=procParent(p)||p;if(top.active===false)continue;
    out.push({p,m,pais,falla:mFails(m,pais)})}
  return out.sort((a,b)=>(a.falla?1:0)-(b.falla?1:0)||bySort(procParent(a.p)||a.p,procParent(b.p)||b.p)||bySort(a.p,b.p)||bySort(a.m,b.m));
}
const optHit=(c,o)=>c.m===o.m.id;
// lo que conviene ofrecerle según cómo paga: efectivo → los de efectivo; un banco → solo lo que el admin puso como disponible, en su orden; otro banco → todo lo digital. Lo que falla, siempre último.
function bkRecom(pais,way){
  if(!pais||!way)return [];
  if(way==='efectivo')return bkOptions(pais,'efectivo');
  const L=bkOptions(pais,'digital'),b=way==='otro'?null:bk.banks.find(x=>x.id===way);
  if(!b)return L;
  const U=b.use_pm||[];if(!U.length)return L; // sin orden armado: se ve todo
  const rank=o=>U.findIndex(c=>optHit(c,o));
  return L.map((o,i)=>({o,r:rank(o),i})).filter(x=>x.r>=0).sort((a,c)=>(a.o.falla?1:0)-(c.o.falla?1:0)||a.r-c.r||a.i-c.i).map(x=>x.o);
}
const banksIn=pais=>bk.banks.filter(b=>!b.country||b.country===pais).sort((a,b)=>a.name.localeCompare(b.name));
function bkOptHTML(o){
  const {p,m}=o,pf=procFails(p,o.pais),note=pf?(failsIn(p,o.pais)?p.status_note:(procParent(p)||{}).status_note):m.status_note,top=procParent(p)||p;
  const otros=methodsOf(p.id).filter(y=>y.id!==m.id&&inPais(y,o.pais));
  return `<details class="bk-opt${o.falla?' falla':''}" data-k="${esc(m.id)}"><summary>${bkIcon(top.id)}<span>${o.n?`<span class="bk-n">${o.n}</span>`:''}<b>${esc(m.name)}</b> con ${esc(procName(p))}</span><span class="grow"></span>${o.falla?`<span class="badge bad">Falla</span>`:'<span class="badge paid">Anda</span>'}</summary>
    <div class="bk-od">${o.falla?`<p class="hot">⚠ ${esc(note||'Está fallando: no lo ofrezcas por ahora.')}</p>`:''}${m.note?`<div class="bk-mnote"><div class="bk-mnh"><svg class="ic" aria-hidden="true"><use href="#i-info"/></svg><b>${esc(m.name)}</b></div><p>${esc(m.note)}</p></div>`:''}${p.notes?`<p class="bk-notes">${esc(p.notes)}</p>`:''}
      ${otros.length?`<p class="dim">${esc(procName(p))} también tiene: ${otros.map(y=>esc(y.name)).join(', ')}</p>`:''}${bkMini(top.id)}</div></details>`;
}
const comboTxt=x=>{const m=methOf(x.m);return m?m.name+' con '+procName(procOf(m.processor_id)):''};
function bankChips(b){ // los primeros del orden recomendado
  const U=(b.use_pm||[]).filter(x=>methOf(x.m)),u=U.slice(0,4).map((x,i)=>{const m=methOf(x.m),f=mFails(m,b.country||'');return `<span class="bk-chip use${f?' warn':''}" title="${f?'Ahora está fallando':''}">${i+1}. ${esc(comboTxt(x))}${f?' · ⚠ falla':''}</span>`});
  const more=U.length-4;
  return u.join('')+(more>0?`<span class="bk-chip">+${more}</span>`:'');
}
const bkSeg=(lab,items,on,attr)=>`<div class="bk-step"><span class="bk-sn">${lab}</span><div class="seg wrap" role="group" aria-label="${esc(lab)}">${items.map(([k,l])=>`<button type="button" ${attr}="${esc(k)}" class="${on(k)?'on':''}">${esc(l)}</button>`).join('')}</div></div>`;
const bkEmpty=t=>`<section class="card"><div class="p-empty">${t}</div></section>`;
const bkStatus=body=>{if(bk.ok===false){body.innerHTML=bkEmpty('Banking se activa en un rato (falta actualizar la base).');return false}if(bk.ok==null){body.innerHTML=bkEmpty('Cargando…');return false}return true};

/* ---------- solapa 1: ¿Cómo paga el cliente? (la del agente) ---------- */
V.banking={
  build(){
    $('#bkBody').addEventListener('click',e=>{
      const pa=e.target.closest('[data-bkp]');if(pa){bkPais=pa.dataset.bkp;bkWay='';bkTipo='';this.render({});return} // 1: el país
      const w=e.target.closest('[data-bkw]');if(w){bkWay=w.dataset.bkw;bkTipo=bkWay==='efectivo'?'efectivo':bkWay?'digital':'';this.render({});return} // 2: efectivo o el banco
      const v=e.target.closest('[data-bkimg]');if(v)return bkLightbox(v.dataset.bkimg);
    });
  },
  render(){
    bkLoad();const body=$('#bkBody');if(!bkStatus(body))return;
    const bkn=bkPais?banksIn(bkPais):[],bsel=bkWay&&bkWay!=='efectivo'&&bkWay!=='otro'?bk.banks.find(b=>b.id===bkWay):null;
    const opts=bkPais&&bkWay?bkRecom(bkPais,bkWay).map((o,i)=>({...o,n:o.falla?0:i+1})):[];
    const opened=openKeys(body);
    body.innerHTML=`<section class="card bk-paso"><div class="card-h"><h3>¿Cómo paga el cliente?</h3></div>
      ${bkSeg('1. País',PAISES.map(p=>[p,p]),k=>k===bkPais,'data-bkp')}
      ${bkPais?bkSeg('2. Paga con',[['efectivo','Efectivo'],...bkn.map(b=>[b.id,b.name]),['otro','Otro banco']],k=>k===bkWay,'data-bkw'):''}
      ${bsel?`<details class="bk-bsteps" data-k="bsteps"><summary>Cómo pagar con ${esc(bsel.name)}</summary>${(bsel.steps||[]).length?`<ol class="bk-steps">${bsel.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:'<p class="dim">Sin pasos cargados.</p>'}${bsel.notes?`<p class="bk-notes">${esc(bsel.notes)}</p>`:''}</details>`:''}
      ${bkPais&&bkWay?`<div class="bk-opts"><span class="bk-sn">3. Ofrecele, en este orden${opts.some(o=>o.falla)?' <small class="dim">· lo que falla va último, sin número</small>':''}</span>${opts.length?opts.map(bkOptHTML).join(''):`<div class="p-empty" style="padding:8px 0">No hay ${bkWay==='efectivo'?'efectivo':'pago digital'} cargado para ${esc(bkPais)}.${bkEd()?' Cargalo en Procesadores.':''}</div>`}</div>`:bkPais?'':'<p class="p-sub bk-hint">Elegí el país del cliente y te digo qué ofrecerle.</p>'}</section>`;
    reopen(body,opened);bkHydrate(body);
  },
};

/* ---------- solapa 2: Procesadores (cajas que se arrastran) ---------- */
const flag=c=>`<span class="bk-flag">${esc(c||'Todos')}</span>`;
function mRow(m,ed){ // un renglón: nombre · tipo · país · anda/falla · ✎ ⚠
  const f=mFails(m,'');
  return `<div class="bk-mr${f?' falla':''}" data-drag="meth" data-id="${esc(m.id)}"${ed?' draggable="true"':''}>${ed?'<span class="bk-grip" aria-hidden="true">⋮⋮</span>':'<span></span>'}<b>${esc(m.name)}</b><span class="k">${esc(KINDS[m.kind]||'sin tipo')}</span>${flag(m.country)}<span class="st${m.status==='falla'?' f':''}">${m.status==='falla'?'falla':f?'falla (el procesador)':'anda'}</span>
    ${m.note?`<button type="button" class="ib" data-bka="mnote" data-id="${esc(m.id)}" title="Ver la nota" aria-label="Ver la nota de ${esc(m.name)}"><svg class="ic" aria-hidden="true"><use href="#i-info"/></svg></button>`:'<span></span>'}
    ${ed?`<span class="bk-mi2"><button type="button" class="ib" data-bka="medit" data-id="${esc(m.id)}" title="Editar" aria-label="Editar ${esc(m.name)}">✎</button><button type="button" class="ib${m.status==='falla'?' on':''}" data-bka="${m.status==='falla'?'mvuelve':'mfalla'}" data-id="${esc(m.id)}" title="${m.status==='falla'?'Volvió a andar':'Reportar falla'}" aria-label="${m.status==='falla'?'Volvió a andar':'Reportar falla de'} ${esc(m.name)}">⚠</button></span>`:'<span></span>'}</div>`;
}
function procBadge(p,ms){const pf=failCs(p)||(procParent(p)?failCs(procParent(p)):null),here=pf!=null&&(!pf.length||(bkPais?pf.includes(bkPais):false)),nf=ms.filter(m=>m.status==='falla').length;
  return {here,html:here?'<span class="badge bad">Falla</span>':pf&&pf.length&&!bkPais?`<span class="badge bad">Falla en ${esc(isoTxt(pf))}</span>`:nf?`<span class="badge bad">${nf===1?'Falla un método':nf+' métodos fallan'}</span>`:'<span class="badge paid">Anda</span>'}}
function procBox(p,ed,sub){ // la caja de un procesador (o la cajita de un sub-procesador)
  const q=norm(bkQ).trim(),hit=t=>!q||norm(t).includes(q);
  const ms=methodsOf(p.id).filter(m=>inPais(m,bkPais)&&(hit(m.name)||hit(procName(p)))),b=procBadge(p,ms),subs=sub?[]:subsOf(p);
  const head=`<div class="bk-bh">${ed?'<span class="bk-grip" aria-hidden="true">⋮⋮</span>':''}${sub?'':bkIcon(p.id)}<${sub?'h5':'h4'}>${esc(p.name)}</${sub?'h5':'h4'}>${p.countries&&p.countries.length?`<span class="dim bk-iso">${esc(isoTxt(p.countries))}</span>`:''}${b.html}<span class="grow"></span>
    ${ed?`<button type="button" class="btn sm" data-bka="${failCs(p)!=null?'vuelve':'falla'}" data-id="${esc(p.id)}">${failCs(p)!=null?'Volvió':'Falla'}</button><button type="button" class="btn sm" data-bka="edit" data-id="${esc(p.id)}">Editar</button>`:''}</div>`;
  const list=`<div class="bk-ml" data-list="meth" data-pid="${esc(p.id)}">${ms.map(m=>mRow(m,ed)).join('')||(subs.length&&!ed?'':`<div class="bk-mv dim">${bkPais?'Nada en '+esc(bkPais):'Sin métodos'}${ed?' · tocá + Método':''}</div>`)}</div>`;
  const add=ed?`<div class="bk-add"><button type="button" class="btn sm" data-bka="madd" data-id="${esc(p.id)}">+ Método</button>${sub?'':`<button type="button" class="btn sm" data-bka="sadd" data-id="${esc(p.id)}">+ Sub-procesador</button>`}</div>`:'';
  if(sub)return `<section class="bk-sub${b.here?' falla':''}" data-drag="sub" data-id="${esc(p.id)}"${ed?' draggable="true"':''}>${head}${list}${p.notes?`<p class="bk-notes">${esc(p.notes)}</p>`:''}${add}</section>`;
  return `<article class="bk-proc${b.here?' falla':''}" data-drag="proc" data-id="${esc(p.id)}"${ed?' draggable="true"':''}>${head}${list}
    <div class="bk-subs" data-list="sub" data-pid="${esc(p.id)}">${subs.map(r=>procBox(r,ed,true)).join('')}</div>
    ${p.notes?`<p class="bk-notes">${esc(p.notes)}</p>`:''}${bkMini(p.id)}${add}</article>`;
}
V.bkprocs={
  build(){
    const body=$('#bkpBody');
    body.addEventListener('input',e=>{if(e.target.id==='bkQ'){bkQ=e.target.value;bkpDraw()}});
    body.addEventListener('click',e=>{
      const pa=e.target.closest('[data-bkp]');if(pa){bkPais=pa.dataset.bkp;bkpDraw();return}
      const v=e.target.closest('[data-bkimg]');if(v)return bkLightbox(v.dataset.bkimg);
      const b=e.target.closest('[data-bka]');if(!b)return;const a=b.dataset.bka,id=b.dataset.id;
      if(a==='padd')return procModal(null);
      if(a==='sadd')return procModal(null,id);
      if(a==='edit')return procModal(procOf(id));
      if(a==='falla')return reportModal(id,true);
      if(a==='vuelve')return reportModal(id,false);
      if(a==='madd')return methModal(id,null);
      if(a==='medit'){const m=methOf(id);return m&&methModal(m.processor_id,m)}
      if(a==='mfalla'){const m=methOf(id);return m&&reportModal(m.processor_id,true,m.id)}
      if(a==='mvuelve'){const m=methOf(id);return m&&reportModal(m.processor_id,false,m.id)}
      if(a==='mnote'){const m=methOf(id);if(m)modal({title:`${esc(m.name)} · ${esc(procName(procOf(m.processor_id)))}`,body:`<p class="mp" style="white-space:pre-wrap">${esc(m.note||'')}</p>`,actions:[{l:'Cerrar',cls:'pri'}]})}
    });
    bkDragWire(body);
  },
  render(){bkLoad();bkpDraw()},
};
function bkpDraw(){
  const body=$('#bkpBody');if(!bkStatus(body))return;
  const ed=bkEd(),q=norm(bkQ).trim(),hit=t=>!q||norm(t).includes(q);
  const tops=bk.procs.filter(p=>!p.parent_id&&p.active!==false).sort(bySort)
    .filter(p=>famOf(p).some(r=>hit(procName(r))||methodsOf(r.id).some(m=>inPais(m,bkPais)&&hit(m.name))))
    .filter(p=>!bkPais||famOf(p).some(r=>methodsOf(r.id).some(m=>inPais(m,bkPais)))||!bk.methods.some(m=>famOf(p).some(r=>r.id===m.processor_id))); // con un país: solo las cajas que tienen algo ahí (una caja vacía se ve igual)
  const qEl=body.querySelector('#bkQ'),focus=qEl&&document.activeElement===qEl,sel=qEl?[qEl.selectionStart,qEl.selectionEnd]:null;
  body.innerHTML=`<div class="bk-bar"><div class="seg wrap" role="group" aria-label="País"><button type="button" data-bkp="" class="${bkPais?'':'on'}">Todos</button>${PAISES.map(p=>`<button type="button" data-bkp="${esc(p)}" class="${bkPais===p?'on':''}">${esc(p)}</button>`).join('')}</div>
      <input id="bkQ" type="search" placeholder="Buscar" autocomplete="off" aria-label="Buscar procesador o método" value="${esc(bkQ)}"><span class="grow"></span>
      ${ed?`<span class="p-sub bk-hint">Arrastrá <b>⋮⋮</b> para cambiar el orden</span><button type="button" class="btn pri" data-bka="padd">+ Procesador</button>`:''}</div>
    ${tops.length?`<div class="bk-grid" data-list="proc">${tops.map(p=>procBox(p,ed,false)).join('')}${ed?`<button type="button" class="bk-new" data-bka="padd">+ Procesador</button>`:''}</div>`:bkEmpty(bk.procs.length?'Nada con ese filtro.':ed?'Cargá el primer procesador con "+ Procesador".':'Todavía no hay procesadores cargados.')}`;
  if(focus){const n=body.querySelector('#bkQ');n.focus();try{n.setSelectionRange(sel[0],sel[1])}catch(e){}}
  bkHydrate(body);
}
// arrastrar: cajas (procesadores) entre sí, cajitas (sub-procesadores) adentro de su caja y renglones (métodos) entre cualquier caja o cajita
function bkDragWire(root){
  let D=null; // {kind, id, el}
  root.addEventListener('dragstart',e=>{const el=e.target.closest('[data-drag][draggable]');if(!el)return;
    D={kind:el.dataset.drag,id:el.dataset.id,el};el.classList.add('drag');e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',el.dataset.id)}catch(_){}e.stopPropagation()});
  const target=e=>{if(!D)return null;const L=D.kind==='meth'?'meth':D.kind==='sub'?'sub':'proc';
    let list=[...root.querySelectorAll(`[data-list="${L}"]`)].find(l=>l.contains(e.target));
    if(!list&&L==='meth'){const box=e.target.closest('[data-drag="sub"],[data-drag="proc"]');list=box&&box.querySelector(':scope > .bk-ml')} // soltado en la caja, fuera de la lista
    if(!list)return null;
    if(D.kind==='sub'&&list.dataset.pid!==procOf(D.id).parent_id)return null; // una cajita no se cambia de caja arrastrando (se edita)
    const over=e.target.closest(`[data-drag="${D.kind}"]`);return {list,over:over&&list.contains(over)&&over!==D.el?over:null}};
  root.addEventListener('dragover',e=>{const t=target(e);if(!t)return;e.preventDefault();root.querySelectorAll('.over').forEach(x=>x.classList.remove('over'));(t.over||t.list).classList.add('over')});
  root.addEventListener('drop',async e=>{const t=target(e);if(!t)return;e.preventDefault();e.stopPropagation();const d=D;D=null;root.querySelectorAll('.drag,.over').forEach(x=>x.classList.remove('drag','over'));
    const {list,over}=t;if(over){const after=!!(d.el.compareDocumentPosition(over)&Node.DOCUMENT_POSITION_FOLLOWING);over.parentElement.insertBefore(d.el,after?over.nextSibling:over)}else list.appendChild(d.el); // soltado sobre otro: toma su lugar
    const ids=[...list.querySelectorAll(`:scope > [data-drag="${d.kind}"]`)].map(x=>x.dataset.id);
    try{await Q(sb.rpc('pay_order',d.kind==='meth'?{kind:'method',ids,parent:list.dataset.pid}:{kind:'proc',ids}))}
    catch(err){toast(esc(/23505|duplicate/i.test(String(err&&(err.code||err.message)))?'No se pudo mover: esa caja ya tiene un método con ese nombre, tipo y país.':errMsg(err)),'err')}
    await bkLoad(true)});
  root.addEventListener('dragend',()=>{D=null;root.querySelectorAll('.drag,.over').forEach(x=>x.classList.remove('drag','over'))});
}

/* ---------- solapa 3: Bancos ---------- */
V.bkbancos={
  build(){
    const body=$('#bkbBody');
    body.addEventListener('click',e=>{
      const pa=e.target.closest('[data-bkp]');if(pa){bkPais=pa.dataset.bkp;bkOrdB='';bkOrd=null;bkbDraw();return}
      const v=e.target.closest('[data-bkimg]');if(v)return bkLightbox(v.dataset.bkimg);
      const mv=e.target.closest('[data-bkmv]');if(mv){bkOrdMove(mv.closest('.bk-ord').dataset.i|0,mv.dataset.bkmv,mv.closest('[data-lst]').dataset.lst);return}
      const sv=e.target.closest('[data-bkordsave]');if(sv){bkOrdSave();return}
      const b=e.target.closest('[data-bka]');if(!b)return;const a=b.dataset.bka,id=b.dataset.id;
      if(a==='badd')return bankModal(null);
      if(a==='bank')return bankView(bk.banks.find(x=>x.id===id));
      if(a==='bankEd')return bankModal(bk.banks.find(x=>x.id===id));
      if(a==='orden'){bkOrdB=bkOrdB===id?'':id;bkOrd=null;bkbDraw();return}
    });
    bkOrdDrag(body);
  },
  render(){bkLoad();bkbDraw()},
};
function bkbDraw(){
  const body=$('#bkbBody');if(!bkStatus(body))return;
  const ed=bkEd(),banks=bk.banks.filter(b=>!bkPais||!b.country||b.country===bkPais).sort((a,b)=>(a.country||'').localeCompare(b.country||'')||a.name.localeCompare(b.name));
  const bRow=b=>`<section class="card bk-bank2${bkOrdB===b.id?' open':''}"><div class="bk-bh"><h4>${esc(b.name)}</h4>${flag(b.country)}<div class="bk-chips">${bankChips(b)}</div><span class="grow"></span>
      <button type="button" class="btn sm" data-bka="bank" data-id="${esc(b.id)}">Ver pasos</button>${ed?`<button type="button" class="btn sm${bkOrdB===b.id?' on':''}" data-bka="orden" data-id="${esc(b.id)}">${bkOrdB===b.id?'Cerrar el orden':'Ordenar'}</button><button type="button" class="btn sm" data-bka="bankEd" data-id="${esc(b.id)}">Editar</button>`:''}</div>
    ${ed&&bkOrdB===b.id?bkOrdHTML(b):''}</section>`;
  body.innerHTML=`<div class="bk-bar"><div class="seg wrap" role="group" aria-label="País"><button type="button" data-bkp="" class="${bkPais?'':'on'}">Todos</button>${PAISES.map(p=>`<button type="button" data-bkp="${esc(p)}" class="${bkPais===p?'on':''}">${esc(p)}</button>`).join('')}</div><span class="grow"></span>
      ${ed?`<span class="p-sub bk-hint">Con "Ordenar" elegís qué ofrecer a un cliente de ese banco, de mejor a peor</span><button type="button" class="btn pri" data-bka="badd">+ Banco</button>`:''}</div>
    ${banks.length?banks.map(bRow).join(''):bkEmpty(bk.banks.length?'Ningún banco en ese país.':ed?'Cargá un banco con sus pasos con "+ Banco".':'Todavía no hay bancos cargados.')}`;
  bkHydrate(body);
}
// en el inicio: si algo está fallando, arriba de todo (hoy escondido: #iBank)
function bkCard(){
  if(!bk.ok)return '';
  const F=bkFallas();if(!F.length)return '';
  return `<div class="card-h"><h3><svg class="ic" aria-hidden="true"><use href="#i-alerta"/></svg> Fallas de pago</h3><span class="p-sub">no lo ofrezcas hasta que vuelva</span><span class="grow"></span><button type="button" class="btn sm" data-go="banking">Ver Banking</button></div>
    <div class="lst">${F.slice(0,4).map(f=>`<div class="li"><span class="t">${f.at?esc(rel(new Date(f.at))):''}</span><span class="n"><b>${esc(bkName(f.pid,f.mid)+(f.mid?'':enTxt(f.fc)))}</b>${f.note?`<small>${esc(f.note)}</small>`:''}</span><span></span><span></span><span></span></div>`).join('')}</div>`;
}

/* ---------- editores (admin y team leader) ---------- */
async function bkSave(p){try{const r=await Q(p);await bkLoad(true);return r||true}catch(e){toast(esc(/23505|duplicate/i.test(String(e&&(e.code||e.message)))?'Ya hay uno con ese nombre, tipo y país en esa caja.':errMsg(e)),'err');return false}}
function procModal(p,parentId){ // un procesador, o un sub-procesador (parentId: adentro de cuál)
  if(!bkEd())return;
  let savedId=p&&p.id;
  const par=p?procParent(p):parentId?procOf(parentId):null,hasKids=p&&bk.procs.some(x=>x.parent_id===p.id),tops=bk.procs.filter(x=>!x.parent_id&&x.active!==false&&(!p||x.id!==p.id)).sort(bySort);
  const tit=par?(p?'Editar sub-procesador':'Nuevo sub-procesador'):(p?'Editar procesador':'Nuevo procesador');
  modal({title:tit,wide:true,body:`<label class="fld"><span>Nombre</span><input id="bpN" maxlength="60" value="${esc(p&&p.name||'')}" placeholder="${par?'Ej.: Cash, Bank':'Ej.: PayPros'}" autofocus></label>
    ${hasKids?'':`<div class="fld"><span>Dónde va</span><select id="bpP"><option value="">Es un procesador (caja propia)</option>${tops.map(x=>`<option value="${esc(x.id)}"${par&&par.id===x.id?' selected':''}>Adentro de ${esc(x.name)}</option>`).join('')}</select></div>`}
    <div class="fld"><span>Países donde está <small class="dim">(solo informa; cada método tiene el suyo)</small></span>${paisChecks(p&&p.countries,'bpC')}</div>
    <label class="fld"><span>Notas <small class="dim">(cómo se usa, límites, horarios…)</small></span><textarea id="bpNo" rows="3" maxlength="4000">${esc(p&&p.notes||'')}</textarea></label>
    ${par||parentId?'':bkPhotoField('processor',p&&p.id)}<div class="ebox" id="bpE"></div>`,
    onOpen:api=>{api._up=(par||parentId)?async()=>{}:bkPhotoWire(api,'processor',()=>savedId)},
    actions:[...(p?[{l:'Borrar',cls:'danger',fn:async()=>{if(!await confirmar('Borrar',`¿Borrar <b>${esc(procName(p))}</b> con sus métodos${hasKids?', sus sub-procesadores':''}, fotos e historial?`,'borrar',true))return false;
        await bkSave(sb.from('pay_files').delete().eq('ref_kind','processor').eq('ref_id',p.id));if(await bkSave(sb.from('processors').delete().eq('id',p.id)))toast('Borrado.')}}]:[]),
      {l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
        const name=api.q('#bpN').value.trim(),countries=[...api.box.querySelectorAll('[name=bpC]:checked')].map(i=>i.value),notes=api.q('#bpNo').value.trim()||null;
        if(!name){api.q('#bpE').textContent='Poné el nombre.';return false}
        const row={name:name.slice(0,60),countries,notes,parent_id:hasKids?null:((api.q('#bpP')||{}).value||null),updated_at:new Date().toISOString()};
        const r=await bkSave(p?sb.from('processors').update(row).eq('id',p.id).select('id'):sb.from('processors').insert({...row,sort:bk.procs.length+1}).select('id'));if(!r)return false;
        savedId=p?p.id:r[0].id;await api._up();await bkLoad(true);toast(p?'Guardado.':`<b>${esc(name)}</b> cargado.${row.parent_id?'':' Ahora agregale métodos con "+ Método".'}`);
        if(!p&&!row.parent_id)setTimeout(()=>methModal(savedId,null),150); // un procesador nuevo: enseguida su primer método
      }}]});
}
function methModal(pid,m){ // un método de una caja: nombre, tipo, país, nota (y dónde está)
  if(!bkEd())return;
  const p=procOf(pid);if(!p)return;
  const top=procParent(p)||p,boxes=famOf(top);
  modal({title:m?`Editar método · ${esc(procName(p))}`:`Nuevo método en ${esc(procName(p))}`,body:`<label class="fld"><span>Nombre</span><input id="bmN" maxlength="60" value="${esc(m&&m.name||'')}" placeholder="Ej.: Nequi, OXXO, Tarjeta" autofocus></label>
    <div class="fld"><span>¿Cómo paga el cliente?</span>${segPick('kind',Object.entries(KINDS),m&&m.kind||'')}</div>
    <div class="fld"><span>País</span>${segPick('pais',[...PAISES.map(c=>[c,c]),['','Todos']],m?m.country:(bkPais||''))}</div>
    ${boxes.length>1?`<div class="fld"><span>Dónde va</span><select id="bmP">${boxes.map(x=>`<option value="${esc(x.id)}"${x.id===pid?' selected':''}>${esc(procName(x))}</option>`).join('')}</select></div>`:''}
    <label class="fld"><span>Nota <small class="dim">(opcional: cómo se usa, qué le pide al cliente)</small></span><textarea id="bmNo" rows="2" maxlength="1000">${esc(m&&m.note||'')}</textarea></label><div class="ebox" id="bmE"></div>`,
    onOpen:api=>{pickWire(api);api.q('#bmN').addEventListener('input',e=>{if(m||pickVal(api,'kind'))return;const k=kindGuess(e.target.value);if(k)api.box.querySelectorAll('[data-pick=kind]').forEach(b=>b.classList.toggle('on',b.dataset.val===k))})},
    actions:[...(m?[{l:'Borrar',cls:'danger',fn:async()=>{if(!await confirmar('Borrar método',`¿Borrar <b>${esc(m.name)}</b>${m.country?' de '+esc(m.country):''}?`,'borrar',true))return false;if(await bkSave(sb.from('methods').delete().eq('id',m.id)))toast('Método borrado.')}}]:[]),
      {l:'Cancelar'},{l:m?'Guardar':'Agregar',cls:'pri',fn:async api=>{
        const name=api.q('#bmN').value.trim(),kind=pickVal(api,'kind')||kindGuess(name),country=pickVal(api,'pais'),note=api.q('#bmNo').value.trim()||null,where=(api.q('#bmP')||{}).value||pid;
        if(!name){api.q('#bmE').textContent='Poné el nombre.';return false}
        if(!kind){api.q('#bmE').textContent='Elegí cómo paga: efectivo, transferencia o tarjeta.';return false}
        const row={name:name.slice(0,60),kind,country,note,processor_id:where};
        const r=await bkSave(m?sb.from('methods').update(row).eq('id',m.id).select('id'):sb.from('methods').insert({...row,sort:methodsOf(where).length+1}).select('id'));if(!r)return false;
        toast(m?'Método guardado.':`<b>${esc(name)}</b> agregado${country?' en '+esc(country):''}.`);
      }}]});
}
function reportModal(pid,falla,mid0){ // una falla o una vuelta: todo el procesador, o uno o varios métodos
  if(!bkEd())return;
  const p=procOf(pid);if(!p)return;
  const ms=methodsOf(pid).filter(m=>falla?m.status!=='falla':m.status==='falla'),allOk=falla?failCs(p)==null:failCs(p)!=null;
  if(!allOk&&!ms.length)return toast(falla?'Ya está todo marcado como falla.':'No hay nada fallando acá.','warn');
  const pre=new Set(mid0&&ms.some(x=>x.id===mid0)?[mid0]:[]),all=!pre.size&&allOk;
  const scope=p.countries&&p.countries.length?p.countries:PAISES,fc=failCs(p);
  let incId=null;
  modal({title:falla?`Reportar falla · ${esc(procName(p))}`:`Volvió a andar · ${esc(procName(p))}`,body:`<div class="fld"><span>${falla?'¿Qué falla?':'¿Qué volvió?'}${ms.length>1?' <small class="dim">(podés marcar varios)</small>':''}</span>
      ${allOk?`<label class="chk blk"><input type="checkbox" id="brAll"${all?' checked':''}><b>Todo el procesador</b></label>`:''}
      <div id="brMs">${ms.map(m=>`<label class="chk blk"><input type="checkbox" name="brM" value="${esc(m.id)}"${pre.has(m.id)?' checked':''}>${esc(m.name)} <small class="dim">· ${esc(m.country||'todos los países')}</small></label>`).join('')}</div></div>
    <div class="fld" id="brCF"><span>¿En qué países? <small class="dim">(sin marcar: en todos)</small></span><div class="bk-paises" id="brC">${scope.map(c=>`<label class="chk"><input type="checkbox" name="brC" value="${esc(c)}">${esc(c)}</label>`).join('')}</div><p class="p-sub" style="margin:4px 0 0">${fc==null?'':fc.length?'Ahora falla en '+esc(fc.join(', '))+'.':'Ahora falla en todos los países.'}</p></div>
    <label class="fld"><span>${falla?'Qué pasa':'Nota'} <small class="dim">(lo ve toda la mesa)</small></span><textarea id="brN" rows="3" maxlength="1000" placeholder="${falla?'Ej.: rechaza todas las tarjetas desde las 14 h':'Opcional'}"></textarea></label>
    ${falla?bkPhotoField('incident',null):''}<p class="note">${falla?'Le llega a toda la mesa un aviso urgente.':'Le llega a toda la mesa un aviso.'}</p><div class="ebox" id="brE"></div>`,
    onOpen:api=>{
      if(falla)api._up=bkPhotoWire(api,'incident',()=>incId);
      const isAll=()=>!!(api.q('#brAll')||{}).checked,draw=()=>{api.q('#brMs').classList.toggle('off',isAll());api.q('#brCF').hidden=!isAll()}; // los países solo valen para todo el procesador (cada método ya tiene el suyo)
      api.box.addEventListener('change',e=>{if(e.target.id==='brAll'&&e.target.checked)api.box.querySelectorAll('[name=brM]').forEach(i=>{i.checked=false});
        if(e.target.name==='brM'&&e.target.checked&&api.q('#brAll'))api.q('#brAll').checked=false;
        if(e.target.id==='brAll'||e.target.name==='brM')draw()});draw();
    },
    actions:[{l:'Cancelar'},{l:falla?'Avisar la falla':'Avisar que volvió',cls:'pri'+(falla?' danger':''),fn:async api=>{
      const a=!!(api.q('#brAll')||{}).checked,ids=a?[]:[...api.box.querySelectorAll('[name=brM]:checked')].map(i=>i.value),note=api.q('#brN').value.trim(),cs=a?[...api.box.querySelectorAll('[name=brC]:checked')].map(i=>i.value):[];
      if(!a&&!ids.length){api.q('#brE').textContent='Marcá todo el procesador o al menos un método.';return false}
      const r=await B.rpc(ids.length>1?'pay_report_many':'pay_report',ids.length>1?{pid,mids:ids,falla,note:note||null,cs}:{pid,mid:ids[0]||null,falla,note:note||null,cs});if(!r)return false;incId=r.id;
      const t=`<b>${esc((ids.length>1?procName(p)+' · '+ids.map(id=>(methOf(id)||{}).name||'?').join(', '):bkName(pid,ids[0]||null))+(ids.length?'':enTxt(cs)))}</b>`;
      if(falla)await api._up();await bkLoad(true);toast(falla?`Avisé a la mesa que ${t} falla.`:`Avisé que ${t} volvió a andar.`)}}]});
}
function bankModal(b){
  if(!bkEd())return;
  let savedId=b&&b.id;
  modal({title:b?'Editar banco':'Nuevo banco',wide:true,body:`<label class="fld"><span>Banco</span><input id="bbN" maxlength="80" value="${esc(b&&b.name||'')}" placeholder="Ej.: Falabella" autofocus></label>
    <div class="fld"><span>País</span>${segPick('pais',[...PAISES.map(c=>[c,c]),['','Todos']],b?b.country:(bkPais||''))}</div>
    <label class="fld"><span>Pasos para pagar con este banco <small class="dim">(uno por línea)</small></span><textarea id="bbS" rows="5" maxlength="4000" placeholder="1. Pedile que pague con tarjeta de crédito&#10;2. …">${esc((b&&b.steps||[]).join('\n'))}</textarea></label>
    ${b?`<p class="note">Qué conviene ofrecer con este banco se elige con <b>Ordenar</b>, en su tarjeta.</p>`:''}
    <label class="fld"><span>Notas</span><textarea id="bbNo" rows="3" maxlength="4000">${esc(b&&b.notes||'')}</textarea></label>
    ${bkPhotoField('bank',b&&b.id)}<div class="ebox" id="bbE"></div>`,
    onOpen:api=>{pickWire(api);api._up=bkPhotoWire(api,'bank',()=>savedId)},
    actions:[...(b?[{l:'Borrar',cls:'danger',fn:async()=>{if(!await confirmar('Borrar banco',`¿Borrar <b>${esc(b.name)}</b> y sus pasos?`,'borrar',true))return false;
        await bkSave(sb.from('pay_files').delete().eq('ref_kind','bank').eq('ref_id',b.id));if(await bkSave(sb.from('banks').delete().eq('id',b.id)))toast('Banco borrado.')}}]:[]),
      {l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
        const name=api.q('#bbN').value.trim();if(!name){api.q('#bbE').textContent='Poné el nombre del banco.';return false}
        const row={name:name.slice(0,80),country:pickVal(api,'pais'),steps:api.q('#bbS').value.split('\n').map(s=>s.replace(/^\s*\d+[.)-]?\s*/,'').trim()).filter(Boolean).slice(0,30),
          notes:api.q('#bbNo').value.trim()||null,updated_at:new Date().toISOString(),updated_by:me};
        if(!b)Object.assign(row,{use_pm:[],avoid_pm:[]});
        const r=await bkSave(b?sb.from('banks').update(row).eq('id',b.id).select('id'):sb.from('banks').insert(row).select('id'));if(!r)return false;
        savedId=b?b.id:r[0].id;await api._up();await bkLoad(true);toast(b?'Banco guardado.':`Banco <b>${esc(name)}</b> cargado.${bkEd()?' Ahora elegí qué ofrecer con "Ordenar".':''}`);
        if(!b&&cur==='bkbancos'){bkOrdB=savedId;bkOrd=null;bkbDraw()}
      }}]});
}
function bankView(b){
  if(!b)return;
  modal({title:`${esc(b.name)}${b.country?' · '+esc(b.country):''}`,wide:true,body:`${(b.use_pm||[]).length?`<div class="bk-chips" style="margin-bottom:12px">${bankChips(b)}</div>`:''}
    ${(b.steps||[]).length?`<ol class="bk-steps">${b.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:'<p class="dim">Sin pasos cargados.</p>'}
    ${b.notes?`<p class="bk-notes">${esc(b.notes)}</p>`:''}${bkThumbs('bank',b.id)}${b.updated_at?`<p class="note">Actualizado ${esc(rel(new Date(b.updated_at)))}${b.updated_by?' por '+esc(first(b.updated_by)):''}.</p>`:''}`,
    onOpen:api=>{bkHydrate(api.box);api.box.addEventListener('click',e=>{const v=e.target.closest('[data-bkimg]');if(v)bkLightbox(v.dataset.bkimg)})},
    actions:[...(bkEd()?[{l:'Editar',fn:()=>{setTimeout(()=>bankModal(b),0)}}]:[]),{l:'Cerrar',cls:'pri'}]});
}

// ── el orden por banco (admin y team leader): dos listas, Disponibles (de mejor a peor) y No disponibles; se arrastra o con + / ✕ / ▲▼
let bkOrdB='',bkOrd=null; // bkOrd: {b, l, n, dirty}
function bkOrdList(b){ // disponibles con el banco (use_pm, en orden) y no disponibles (todo lo demás digital de su país)
  const L=bkOptions(b.country||bkPais,'digital'),rank=o=>(b.use_pm||[]).findIndex(c=>optHit(c,o));
  const R=L.map((o,i)=>({o,r:rank(o),i}));
  return {l:R.filter(x=>x.r>=0).sort((a,c)=>a.r-c.r||a.i-c.i).map(x=>x.o),n:R.filter(x=>x.r<0).map(x=>x.o)};
}
function bkOrdHTML(b){
  if(!bkOrd||bkOrd.b!==b.id)bkOrd={b:b.id,...bkOrdList(b),dirty:false};
  const pais=b.country||bkPais,li=(o,i,l)=>`<li class="bk-ord${o.falla?' falla':''}" draggable="true" data-i="${i}"><span class="bk-grip" aria-hidden="true">⋮⋮</span>${l?`<span class="bk-on">${i+1}</span>`:''}${bkIcon((procParent(o.p)||o.p).id)}<span class="grow"><b>${esc(o.m.name)}</b> con ${esc(procName(o.p))}${o.m.kind?` <small class="dim">· ${esc(KINDS[o.m.kind])}</small>`:''}${o.m.country?'':' <small class="dim">· todos los países</small>'}</span>
    ${l?`<button type="button" class="ib" data-bkmv="up" title="Subir"${i?'':' disabled'}>▲</button><button type="button" class="ib" data-bkmv="down" title="Bajar"${i<bkOrd.l.length-1?'':' disabled'}>▼</button><button type="button" class="ib" data-bkmv="out" title="No disponible">✕</button>`:`<button type="button" class="ib" data-bkmv="in" title="Disponible">+</button>`}</li>`;
  return `<div class="bk-ord2">
    <div class="bk-ordb"><h4>Disponibles con ${esc(b.name)} <small class="dim">· de mejor a peor</small></h4><ol class="bk-ordl" id="bkOrdL" data-lst="l">${bkOrd.l.length?bkOrd.l.map((o,i)=>li(o,i,true)).join(''):`<li class="dim bk-ordv">Arrastrá acá (o tocá +) lo que anda con ${esc(b.name)}. Si no hay nada, el agente ve todo.</li>`}</ol></div>
    <div class="bk-ordb"><h4>No disponibles <small class="dim">· el agente no los ve</small></h4><ol class="bk-ordl no" id="bkOrdN" data-lst="n">${bkOrd.n.length?bkOrd.n.map((o,i)=>li(o,i,false)).join(''):`<li class="dim bk-ordv">${bkOrd.l.length?'Todo lo digital'+(pais?' de '+esc(pais):'')+' está disponible.':'No hay pago digital cargado'+(pais?' para '+esc(pais):'')+'.'}</li>`}</ol></div></div>
    <div class="bk-row"><button type="button" class="btn pri" data-bkordsave${bkOrd.dirty?'':' disabled'}>Guardar orden</button><span class="dim">${bkOrd.dirty?'Hay cambios sin guardar.':'Así lo ve la mesa.'}</span></div>`;
}
function bkOrdMove(i,dir,from){ // from: 'l' disponibles · 'n' no disponibles; dir: up · down · in · out · 'l:<j>' / 'n:<j>' (soltado en esa posición)
  if(!bkOrd)return;const L=bkOrd.l,N=bkOrd.n;from=from||'l';
  if(dir==='in'){const [o]=N.splice(i,1);if(!o)return;L.push(o)}
  else if(dir==='out'){const [o]=L.splice(i,1);if(!o)return;N.push(o)}
  else if(dir==='up'||dir==='down'){if(from!=='l')return;const j=dir==='up'?i-1:i+1;if(j<0||j>=L.length)return;const [o]=L.splice(i,1);L.splice(j,0,o)}
  else{const m=/^([ln]):(\d+)$/.exec(dir);if(!m)return;const to=m[1],j=+m[2],src=from==='l'?L:N,dst=to==='l'?L:N;if(src===dst&&j===i)return;const [o]=src.splice(i,1);if(!o)return;dst.splice(Math.min(j,dst.length),0,o)}
  bkOrd.dirty=true;bkbDraw();
}
function bkOrdDrag(root){ // arrastrar (HTML5 drag) entre las dos listas del orden y adentro de cada una
  let from=null;
  root.addEventListener('dragstart',e=>{const li=e.target.closest('.bk-ord');if(!li)return;from={i:li.dataset.i|0,l:li.closest('[data-lst]').dataset.lst};li.classList.add('drag');e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain','x')}catch(_){}});
  root.addEventListener('dragover',e=>{const ol=e.target.closest('[data-lst]');if(!ol||!from)return;e.preventDefault();root.querySelectorAll('.over').forEach(x=>x.classList.remove('over'));(e.target.closest('.bk-ord')||ol).classList.add('over')});
  root.addEventListener('dragleave',e=>{const t=e.target.closest('.bk-ord,[data-lst]');if(t)t.classList.remove('over')});
  root.addEventListener('drop',e=>{const ol=e.target.closest('[data-lst]');if(!ol||!from)return;e.preventDefault();const li=e.target.closest('.bk-ord'),to=ol.dataset.lst,j=li?li.dataset.i|0:(to==='l'?bkOrd.l:bkOrd.n).length,f=from;from=null;bkOrdMove(f.i,to+':'+j,f.l)});
  root.addEventListener('dragend',()=>{from=null;root.querySelectorAll('.drag,.over').forEach(x=>x.classList.remove('drag','over'))});
}
async function bkOrdSave(){
  if(!bkOrd||!bkEd())return;const b=bk.banks.find(x=>x.id===bkOrd.b);if(!b)return;
  const use_pm=bkOrd.l.map(o=>({m:o.m.id})).slice(0,120),avoid_pm=bkOrd.n.map(o=>({m:o.m.id})).slice(0,120); // avoid_pm = no disponibles (solo registro)
  if(await bkSave(sb.from('banks').update({use_pm,avoid_pm,updated_at:new Date().toISOString(),updated_by:me}).eq('id',b.id))){bkOrd.dirty=false;toast(`Orden de <b>${esc(b.name)}</b> guardado.`)}
}
