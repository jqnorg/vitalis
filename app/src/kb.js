/* ---------- Knowledgebase: guías para el agente (pedido del dueño, 25/11/2026) ----------
   Artículos por tema, armados con bloques: texto, paso a paso con galería (carrusel de capturas), decir / no decir, video por link,
   checklist y una pregunta para ver si se entendió. Escriben admin, team leader y quien el admin marque (profiles.kb_editor).
   "Tus primeros días": los artículos con `ruta` (orden) son los primeros pasos del agente nuevo; se marcan "Lo leí". */
const KB_TOPICS=[['primer-dia','Primer día'],['crm','El CRM'],['news','Llamar a un new'],['deposito','Cerrar un depósito'],['banking','Banking'],['objeciones','Objeciones y guiones'],['vitalis','Vitalis'],['reglas','Reglas de la mesa']];
const kbTopicName=k=>(KB_TOPICS.find(t=>t[0]===k)||[k,k])[1];
let kb={ok:null,arts:[],reads:new Set(),teamReads:[],votes:{},stats:[],at:0,busy:null},kbTopic='',kbQ='',kbOpen=null,kbCar={}; // kbCar: paso actual de cada carrusel
const kbImgs=new Map();
const kbEd=()=>!!profile&&(isLeader()||!!profile.kb_editor);
const kbArt=id=>kb.arts.find(a=>a.id===id);
const kbRuta=()=>kb.arts.filter(a=>a.ruta!=null&&a.published).sort((a,b)=>a.ruta-b.ruta||a.title.localeCompare(b.title));
const kbPend=()=>kbRuta().filter(a=>!kb.reads.has(a.id)); // lo que me falta de la ruta del nuevo

async function kbFetch(){
  const ed=kbEd();
  const [arts,reads,votes,tr,st]=await Promise.all([
    Q(sb.from('kb_articles').select('id,team_id,global,topic,title,summary,blocks,published,ruta,sort,created_by,created_at,updated_by,updated_at').order('sort').order('title')),
    Q(sb.from('kb_reads').select('article_id,read_at,user_id').eq('user_id',me)),
    Q(sb.from('kb_votes').select('article_id,ok').eq('user_id',me)),
    ed?Q(sb.from('kb_reads').select('article_id,user_id,read_at')):[],
    ed?B.rpc('kb_stats',{}).catch(()=>[]):[],
  ]);
  return {arts:arts||[],reads:reads||[],votes:votes||[],tr:tr||[],st:Array.isArray(st)?st:[]};
}
function kbApply(d){
  kb.arts=d.arts;kb.reads=new Set(d.reads.map(r=>r.article_id));kb.votes=Object.fromEntries(d.votes.map(v=>[v.article_id,v.ok]));kb.teamReads=d.tr;kb.stats=d.st;kb.ok=true;kb.at=Date.now();
}
async function kbLoad(force){
  if(!ready||!me)return;if(kb.busy)return kb.busy;if(!force&&kb.ok&&Date.now()-kb.at<120000)return;
  kb.busy=(async()=>{try{kbApply(await kbFetch())}catch(e){if(kb.ok==null)kb.ok=/does not exist|42P01|PGRST2/.test(String(e&&e.message||e))?false:null;if(kb.ok!==false)toast(esc(errMsg(e)),'err')}finally{kb.busy=null}})();
  await kb.busy;if(cur==='kb')V.kb.render({});else status();
}
// al entrar: si al agente le faltan guías de la ruta del nuevo, un aviso una vez por día
function kbNewbieCheck(){
  if(!kb.ok||kbEd())return;const p=kbPend();if(!p.length)return;
  const k='kbHint',d=local.get(k,'');if(d===todayS())return;local.set(k,todayS());
  toast(`Tenés <b>${plural(p.length,'guía')}</b> para empezar en el Knowledgebase.`,'imp',{actions:[{l:'Ver',fn:()=>{kbOpen=null;go('kb')}}]});
}

/* ---------- fotos: igual que Banking (achicadas, webp, cacheadas en IndexedDB) ---------- */
async function kbHydrate(root){
  let need=[...new Set([...root.querySelectorAll('[data-kbimg]')].map(b=>b.dataset.kbimg).filter(id=>id&&!kbImgs.has(id)))];
  if(need.length){const miss=[];for(const id of need){try{const c=await imgCacheGet(id);if(c&&c.data){kbImgs.set(id,`data:${c.mime};base64,${c.data}`);continue}}catch(e){}miss.push(id)}need=miss}
  if(need.length){try{for(const r of await Q(sb.from('kb_files').select('id,mime,data').in('id',need.slice(0,60)))){kbImgs.set(r.id,`data:${r.mime};base64,${r.data}`);imgCachePut(r.id,{mime:r.mime,data:r.data,at:Date.now()})}}catch(e){}}
  root.querySelectorAll('[data-kbimg]').forEach(b=>{const u=kbImgs.get(b.dataset.kbimg),im=b.tagName==='IMG'?b:b.querySelector('img');if(u&&im&&im.src!==u)im.src=u});
}
async function kbUpload(articleId,file){ // una foto → id en kb_files
  const im=await prepImg(file),data=await b64(im.blob);URL.revokeObjectURL(im.url);
  const r=await Q(sb.from('kb_files').insert({article_id:articleId,mime:im.mime,data,w:im.w,h:im.h}).select('id'));
  const id=r[0].id;kbImgs.set(id,`data:${im.mime};base64,${data}`);imgCachePut(id,{mime:im.mime,data,at:Date.now()});return id;
}
function kbLightbox(id){const u=kbImgs.get(id);if(!u)return;modal({title:'Captura',wide:true,body:`<img class="bk-big" src="${u}" alt="Captura">`,actions:[{l:'Cerrar',cls:'pri'}]})}

/* ---------- texto con formato chico: **negrita**, ## título, - lista, > aviso, [texto](https://…) ---------- */
function kbMd(src){
  const inl=t=>esc(t).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out=[];let ul=null,p=[];
  const flushP=()=>{if(p.length){out.push(`<p>${inl(p.join(' '))}</p>`);p=[]}},flushU=()=>{if(ul){out.push(`<ul>${ul.map(x=>`<li>${inl(x)}</li>`).join('')}</ul>`);ul=null}};
  for(const raw of String(src||'').split(/\r?\n/)){const l=raw.trim();
    if(!l){flushP();flushU();continue}
    if(/^##\s+/.test(l)){flushP();flushU();out.push(`<h3>${inl(l.replace(/^##\s+/,''))}</h3>`);continue}
    if(/^>\s?/.test(l)){flushP();flushU();out.push(`<div class="kb-av"><svg class="ic" aria-hidden="true"><use href="#i-alerta"/></svg><span>${inl(l.replace(/^>\s?/,''))}</span></div>`);continue}
    if(/^[-•*]\s+/.test(l)){flushP();(ul||(ul=[])).push(l.replace(/^[-•*]\s+/,''));continue}
    flushU();p.push(l)}
  flushP();flushU();return out.join('');
}
function kbVideo(url){ // YouTube y Loom embebidos; lo demás, un link
  const u=String(url||'').trim();let m;
  if((m=/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{6,})/.exec(u)))return `<div class="kb-vid"><iframe src="https://www.youtube.com/embed/${m[1]}" title="Video" allow="fullscreen" loading="lazy"></iframe></div>`;
  if((m=/loom\.com\/(?:share|embed)\/([\w-]{10,})/.exec(u)))return `<div class="kb-vid"><iframe src="https://www.loom.com/embed/${m[1]}" title="Video" allow="fullscreen" loading="lazy"></iframe></div>`;
  return /^https?:\/\//.test(u)?`<p><a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener">Ver el video</a></p>`:'';
}

/* ---------- los bloques, como se ven ---------- */
function kbBlockHTML(b,i,aid){
  if(b.t==='text')return `<div class="kb-txt">${kbMd(b.md)}</div>`;
  if(b.t==='steps'){const its=(b.items||[]).filter(s=>s.txt||s.img);if(!its.length)return '';const k=aid+':'+i,cur=Math.min(kbCar[k]||0,its.length-1),s=its[cur];
    return `<div class="kb-car" data-car="${esc(k)}" tabindex="0" aria-label="Paso a paso">
      ${b.title?`<h3>${esc(b.title)}</h3>`:''}
      <div class="kb-car-img">${s.img?`<button type="button" class="kb-zoom" data-kbzoom="${esc(s.img)}" title="Ver grande"><img data-kbimg="${esc(s.img)}" alt="Paso ${cur+1}"></button>`:'<div class="kb-noimg">Sin captura</div>'}
        <button type="button" class="kb-arr l" data-kbnav="-1" aria-label="Paso anterior"${cur?'':' disabled'}>‹</button><button type="button" class="kb-arr r" data-kbnav="1" aria-label="Paso siguiente"${cur<its.length-1?'':' disabled'}>›</button></div>
      <div class="kb-car-cap"><span class="kb-on">${cur+1}</span><div class="grow">${kbMd(s.txt)}</div></div>
      <div class="kb-dots" role="tablist">${its.map((_,j)=>`<button type="button" data-kbdot="${j}" class="${j===cur?'on':''}" aria-label="Paso ${j+1}"></button>`).join('')}<span class="dim">Paso ${cur+1} de ${its.length}</span></div></div>`}
  if(b.t==='dodont')return `<div class="kb-dd"><div class="kb-do"><h4>Decí</h4><ul>${(b.do||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div><div class="kb-dont"><h4>No digas</h4><ul>${(b.dont||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></div>`;
  if(b.t==='video')return `<div class="kb-v">${b.title?`<h3>${esc(b.title)}</h3>`:''}${kbVideo(b.url)}</div>`;
  if(b.t==='check'){const k='kbChk:'+aid+':'+i,done=new Set(local.get(k,[]));
    return `<div class="kb-chk" data-chk="${esc(k)}">${b.title?`<h3>${esc(b.title)}</h3>`:''}${(b.items||[]).map((x,j)=>`<label class="chk blk"><input type="checkbox" data-kbck="${j}"${done.has(j)?' checked':''}>${esc(x)}</label>`).join('')}</div>`}
  if(b.t==='quiz'){const k=aid+':'+i,ans=kbCar['q'+k];
    return `<div class="kb-quiz" data-quiz="${esc(k)}"><h3>${esc(b.q||'¿Lo entendiste?')}</h3><div class="kb-qo">${(b.opts||[]).map((o,j)=>`<button type="button" class="btn${ans==null?'':j===b.ok?' good':j===ans?' bad':''}" data-kbq="${j}"${ans==null?'':' disabled'}>${esc(o)}</button>`).join('')}</div>${ans==null?'':ans===b.ok?'<p class="kb-qr ok">¡Bien! Esa es.</p>':`<p class="kb-qr no">No: la correcta es <b>${esc((b.opts||[])[b.ok]||'')}</b>.${b.why?' '+esc(b.why):''}</p>`}</div>`}
  return '';
}

/* ---------- la sección ---------- */
V.kb={
  build(){
    $('#kbQ').addEventListener('input',e=>{kbQ=e.target.value;kbOpen=null;this.render({})});
    $('#v-kb').addEventListener('keydown',e=>{const c=e.target.closest('.kb-car');if(!c)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();kbCarMove(c.dataset.car,e.key==='ArrowLeft'?-1:1)}});
    $('#v-kb').addEventListener('change',e=>{const c=e.target.closest('[data-kbck]');if(!c)return;const box=c.closest('[data-chk]'),k=box.dataset.chk;local.set(k,[...box.querySelectorAll('[data-kbck]:checked')].map(i=>+i.dataset.kbck))});
    $('#v-kb').addEventListener('click',async e=>{
      const t=e.target.closest('[data-kbtopic]');if(t){kbTopic=t.dataset.kbtopic;kbOpen=null;this.render({});return}
      const o=e.target.closest('[data-kbopen]');if(o){kbOpenArt(o.dataset.kbopen);return}
      const bk=e.target.closest('[data-kbback]');if(bk){kbOpen=null;this.render({});return}
      const nv=e.target.closest('[data-kbnav]');if(nv){kbCarMove(nv.closest('.kb-car').dataset.car,+nv.dataset.kbnav);return}
      const dt=e.target.closest('[data-kbdot]');if(dt){kbCarMove(dt.closest('.kb-car').dataset.car,+dt.dataset.kbdot,true);return}
      const z=e.target.closest('[data-kbzoom]');if(z){kbLightbox(z.dataset.kbzoom);return}
      const q=e.target.closest('[data-kbq]');if(q){const box=q.closest('[data-quiz]');kbCar['q'+box.dataset.quiz]=+q.dataset.kbq;this.render({});return}
      const a=e.target.closest('[data-kba]');if(!a)return;const act=a.dataset.kba,id=a.dataset.id;
      if(act==='new')return kbEditor(null);
      if(act==='edit')return kbEditor(kbArt(id));
      if(act==='read')return kbMarkRead(id);
      if(act==='vote')return kbVote(id,a.dataset.ok==='1');
      if(act==='next'){const p=kbPend();if(p.length)kbOpenArt(p[0].id);return}
    });
  },
  render(){
    kbLoad();
    const ed=kbEd();$('#kbTools').innerHTML=ed?`<button type="button" class="btn sm pri" data-kba="new"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Artículo</button>`:'';
    const body=$('#kbBody');
    if(kb.ok===false){body.innerHTML='<section class="card"><div class="p-empty">El Knowledgebase se activa en un rato (falta actualizar la base).</div></section>';return}
    if(kb.ok==null){body.innerHTML='<section class="card"><div class="p-empty">Cargando…</div></section>';return}
    if(kbOpen&&kbArt(kbOpen)){body.innerHTML=kbArtHTML(kbArt(kbOpen));kbHydrate(body);return}
    kbOpen=null;
    const q=norm(kbQ).trim(),hit=a=>!q||norm(a.title+' '+(a.summary||'')+' '+kbBlocksText(a.blocks)).includes(q);
    const list=kb.arts.filter(a=>(a.published||ed)&&(!kbTopic||a.topic===kbTopic)&&hit(a));
    const ruta=kbRuta(),pend=kbPend();
    const rutaCard=ruta.length&&(pend.length||ed)?`<section class="card kb-ruta"><div class="card-h"><h3>Tus primeros días</h3><span class="p-sub">${pend.length?`te faltan ${plural(pend.length,'guía')} de ${ruta.length}`:'ya las leíste todas'}</span><span class="grow"></span>${pend.length?`<button type="button" class="btn sm pri" data-kba="next">Seguir</button>`:''}</div>
      <ol class="kb-steps">${ruta.map(a=>`<li class="${kb.reads.has(a.id)?'done':''}"><button type="button" class="kb-row" data-kbopen="${esc(a.id)}"><span class="kb-on">${kb.reads.has(a.id)?'✓':a.ruta}</span><span class="grow"><b>${esc(a.title)}</b>${a.summary?`<small class="dim">${esc(a.summary)}</small>`:''}</span></button></li>`).join('')}</ol>
      ${ed?kbProgressHTML(ruta):''}</section>`:'';
    const topics=`<div class="kb-topics"><button type="button" data-kbtopic="" class="${kbTopic?'':'on'}">Todo</button>${KB_TOPICS.map(([k,n])=>{const c=kb.arts.filter(a=>a.topic===k&&(a.published||ed)).length;return c?`<button type="button" data-kbtopic="${k}" class="${kbTopic===k?'on':''}">${esc(n)} <small>${c}</small>`:''}).join('')}</div>`;
    const row=a=>{const st=kb.stats.find(s=>s.id===a.id);return `<button type="button" class="kb-row${a.published?'':' draft'}" data-kbopen="${esc(a.id)}"><span class="kb-tp">${esc(kbTopicName(a.topic))}</span><span class="grow"><b>${esc(a.title)}</b>${a.summary?`<small class="dim">${esc(a.summary)}</small>`:''}</span>
      ${!a.published?'<span class="badge">Borrador</span>':kb.reads.has(a.id)?'<span class="badge paid">Leído</span>':''}${a.global?'<span class="badge" title="Lo ven todas las mesas">Global</span>':''}${a.ruta!=null?`<span class="badge" title="Ruta del nuevo">Paso ${a.ruta}</span>`:''}${ed&&st?`<span class="dim kb-st" title="Me sirvió / no me quedó claro · leído">${st.ok}👍 ${st.no}👎 · ${st.reads}</span>`:''}</button>`};
    body.innerHTML=rutaCard+`<section class="card"><div class="card-h"><h3>${kbTopic?esc(kbTopicName(kbTopic)):'Guías'}</h3><span class="p-sub">${plural(list.length,'artículo')}${q?' con «'+esc(kbQ)+'»':''}</span></div>${topics}
      <div class="kb-list">${list.length?list.map(row).join(''):`<div class="p-empty">${kb.arts.length?'Nada con ese filtro.':ed?'Escribí el primer artículo con el botón de arriba.':'Todavía no hay guías.'}</div>`}</div></section>`;
  },
};
const kbBlocksText=bl=>(bl||[]).map(b=>b.t==='text'?b.md:b.t==='steps'?(b.title||'')+' '+(b.items||[]).map(s=>s.txt).join(' '):b.t==='dodont'?[...(b.do||[]),...(b.dont||[])].join(' '):b.t==='check'?(b.title||'')+' '+(b.items||[]).join(' '):b.t==='quiz'?b.q:b.title||'').join(' ');
function kbArtHTML(a){
  const ed=kbEd(),v=kb.votes[a.id],read=kb.reads.has(a.id),who=a.updated_by||a.created_by,ruta=kbRuta(),ri=ruta.findIndex(x=>x.id===a.id),next=ri>=0?ruta[ri+1]:null;
  const rel2=a.blocks.length?a.blocks.map((b,i)=>kbBlockHTML(b,i,a.id)).join(''):'<p class="dim">Este artículo todavía no tiene contenido.</p>';
  const related=kb.arts.filter(x=>x.id!==a.id&&x.published&&x.topic===a.topic).slice(0,4);
  return `<section class="card kb-art"><div class="kb-top"><button type="button" class="btn sm" data-kbback>‹ Guías</button><span class="kb-tp">${esc(kbTopicName(a.topic))}</span>${a.ruta!=null?`<span class="badge">Paso ${a.ruta} de tus primeros días</span>`:''}${a.published?'':'<span class="badge">Borrador: solo lo ven los que escriben</span>'}<span class="grow"></span>${ed?`<button type="button" class="btn sm" data-kba="edit" data-id="${esc(a.id)}">Editar</button>`:''}</div>
    <h2 class="kb-h">${esc(a.title)}</h2>${a.summary?`<p class="kb-sum">${esc(a.summary)}</p>`:''}
    <div class="kb-body">${rel2}</div>
    <div class="kb-foot"><div class="kb-fb"><span>${read?'Leído ✓':'¿Terminaste?'}</span>${read?'':`<button type="button" class="btn sm pri" data-kba="read" data-id="${esc(a.id)}">Lo leí</button>`}</div>
      <div class="kb-fb"><span>¿Te sirvió?</span><button type="button" class="btn sm${v===true?' on':''}" data-kba="vote" data-ok="1" data-id="${esc(a.id)}">Sí</button><button type="button" class="btn sm${v===false?' on':''}" data-kba="vote" data-ok="0" data-id="${esc(a.id)}">No me quedó claro</button></div>
      ${next?`<button type="button" class="btn sm" data-kbopen="${esc(next.id)}">Siguiente: ${esc(next.title)} ›</button>`:''}</div>
    <p class="note">Actualizado ${esc(rel(new Date(a.updated_at)))}${who?' por '+esc(first(who)):''}.</p>
    ${related.length?`<div class="kb-rel"><span class="dim">También en ${esc(kbTopicName(a.topic))}:</span>${related.map(x=>`<button type="button" class="lnk" data-kbopen="${esc(x.id)}">${esc(x.title)}</button>`).join('')}</div>`:''}</section>`;
}
function kbProgressHTML(ruta){ // para el que escribe: quién va por dónde (agentes activos de la mesa)
  const ags=members.filter(m=>m.active&&!m.former&&m.role==='agent'&&!isBot(m.id));if(!ags.length||!ruta.length)return '';
  const of=uid=>ruta.filter(a=>kb.teamReads.some(r=>r.user_id===uid&&r.article_id===a.id)).length;
  const rows=ags.map(m=>({m,n:of(m.id)})).filter(x=>x.n<ruta.length).sort((a,b)=>a.n-b.n||a.m.name.localeCompare(b.m.name));
  return `<details class="kb-prog" data-k="kbprog"><summary>Quién va por dónde <small class="dim">· ${rows.length?plural(rows.length,'agente')+' sin terminar':'todos la terminaron'}</small></summary>
    ${rows.length?`<div class="kb-progl">${rows.map(x=>`<div class="kb-pr"><span class="who-cell">${avatar(x.m.name)}${esc(x.m.name)}</span><span class="kb-bar"><i style="width:${Math.round(100*x.n/ruta.length)}%"></i></span><span class="dim">${x.n} de ${ruta.length}</span></div>`).join('')}</div>`:''}</details>`;
}
function kbOpenArt(id){kbOpen=id;kbCar={};go('kb');if(cur==='kb')V.kb.render({});$('#main').scrollTop=0}
function kbCarMove(k,d,abs){const [aid,i]=k.split(':'),a=kbArt(aid);if(!a)return;const b=a.blocks[+i];if(!b)return;const n=(b.items||[]).filter(s=>s.txt||s.img).length,cur=kbCar[k]||0,to=abs?d:cur+d;if(to<0||to>=n)return;kbCar[k]=to;
  const el=$(`#v-kb .kb-car[data-car="${CSS.escape(k)}"]`);if(!el)return;const tmp=document.createElement('div');tmp.innerHTML=kbBlockHTML(b,+i,aid);el.replaceWith(tmp.firstElementChild);kbHydrate($('#v-kb'));const c=$(`#v-kb .kb-car[data-car="${CSS.escape(k)}"]`);if(c)c.focus({preventScroll:true})}
async function kbMarkRead(id){try{await Q(sb.from('kb_reads').upsert({user_id:me,article_id:id},{onConflict:'user_id,article_id'}));kb.reads.add(id);V.kb.render({});const p=kbPend();if(kbArt(id).ruta!=null&&!p.length)toast('Terminaste tus primeros días. ¡Bien ahí!','win')}catch(e){toast(esc(errMsg(e)),'err')}}
async function kbVote(id,ok){try{await Q(sb.from('kb_votes').upsert({user_id:me,article_id:id,ok},{onConflict:'user_id,article_id'}));kb.votes[id]=ok;V.kb.render({});toast(ok?'Gracias.':'Gracias: lo vamos a mejorar.')}catch(e){toast(esc(errMsg(e)),'err')}}

/* ---------- el editor: título, tema, resumen, y los bloques (se agregan, se ordenan, se sacan) ---------- */
const KB_BLOCKS=[['text','Texto'],['steps','Paso a paso con capturas'],['dodont','Decir / no decir'],['video','Video (link)'],['check','Checklist'],['quiz','Pregunta']];
function kbBlockEd(b,i){
  const h=`<div class="kb-bh"><b>${esc((KB_BLOCKS.find(x=>x[0]===b.t)||['','Bloque'])[1])}</b><span class="grow"></span><button type="button" class="ib" data-bmv="up" title="Subir">▲</button><button type="button" class="ib" data-bmv="down" title="Bajar">▼</button><button type="button" class="ib del" data-bdel title="Sacar">✕</button></div>`;
  let body='';
  if(b.t==='text')body=`<textarea data-f="md" rows="6" maxlength="8000" placeholder="Escribí acá. **negrita**, ## Título, - lista, > aviso, [texto](https://…)">${esc(b.md||'')}</textarea>`;
  else if(b.t==='steps')body=`<input data-f="title" maxlength="120" value="${esc(b.title||'')}" placeholder="Título del paso a paso (opcional)"><div class="kb-sted">${(b.items||[]).map((s,j)=>`<div class="kb-st" data-j="${j}"><span class="kb-on">${j+1}</span><div class="kb-stimg">${s.img?`<img data-kbimg="${esc(s.img)}" alt="">`:'<span class="dim">Sin captura</span>'}<label class="btn sm"><input type="file" accept="image/*" hidden data-simg="${j}">${s.img?'Cambiar':'Subir captura'}</label></div><textarea data-stxt="${j}" rows="3" maxlength="2000" placeholder="Qué hacer en este paso">${esc(s.txt||'')}</textarea><div class="kb-stb"><button type="button" class="ib" data-smv="up" title="Subir">▲</button><button type="button" class="ib" data-smv="down" title="Bajar">▼</button><button type="button" class="ib del" data-sdel title="Sacar el paso">✕</button></div></div>`).join('')}</div><button type="button" class="btn sm" data-sadd>Agregar paso</button>`;
  else if(b.t==='dodont')body=`<div class="kb-dd"><label class="fld"><span>Decí <small class="dim">(una por línea)</small></span><textarea data-f="do" rows="5" maxlength="4000">${esc((b.do||[]).join('\n'))}</textarea></label><label class="fld"><span>No digas <small class="dim">(una por línea)</small></span><textarea data-f="dont" rows="5" maxlength="4000">${esc((b.dont||[]).join('\n'))}</textarea></label></div>`;
  else if(b.t==='video')body=`<input data-f="title" maxlength="120" value="${esc(b.title||'')}" placeholder="Título (opcional)"><input data-f="url" maxlength="500" value="${esc(b.url||'')}" placeholder="Link de YouTube o Loom">`;
  else if(b.t==='check')body=`<input data-f="title" maxlength="120" value="${esc(b.title||'')}" placeholder="Título (opcional)"><textarea data-f="items" rows="5" maxlength="4000" placeholder="Una cosa por línea">${esc((b.items||[]).join('\n'))}</textarea>`;
  else if(b.t==='quiz')body=`<input data-f="q" maxlength="200" value="${esc(b.q||'')}" placeholder="La pregunta"><textarea data-f="opts" rows="4" maxlength="2000" placeholder="Una opción por línea">${esc((b.opts||[]).join('\n'))}</textarea><div class="bk-row"><label class="fld"><span>La correcta es la opción</span><input type="number" data-f="ok" min="1" max="10" value="${(b.ok|0)+1}" style="width:80px"></label><label class="fld grow"><span>Por qué (opcional)</span><input data-f="why" maxlength="300" value="${esc(b.why||'')}"></label></div>`;
  return `<div class="kb-bed" data-i="${i}" data-t="${b.t}">${h}${body}</div>`;
}
function kbEditor(a){
  if(!kbEd())return;
  let art=a?JSON.parse(JSON.stringify(a)):{title:'',topic:'vitalis',summary:'',blocks:[],published:false,ruta:null,global:false},id=a&&a.id,createdDraft=false,saved=false;
  const ensureId=async()=>{if(id)return id;const r=await Q(sb.from('kb_articles').insert({title:'Borrador',topic:art.topic,blocks:[],published:false}).select('id'));id=r[0].id;createdDraft=true;return id}; // para subir capturas hace falta el artículo
  const draw=api=>{api.q('#kbBl').innerHTML=art.blocks.map(kbBlockEd).join('')||'<p class="dim">Agregá un bloque abajo: texto, paso a paso con capturas, decir / no decir…</p>';kbHydrate(api.box)};
  const pull=api=>{ // lo escrito → art.blocks
    api.box.querySelectorAll('.kb-bed').forEach(el=>{const b=art.blocks[+el.dataset.i];if(!b)return;const f=n=>{const x=el.querySelector(`[data-f="${n}"]`);return x?x.value:''},lines=n=>f(n).split('\n').map(s=>s.trim()).filter(Boolean).slice(0,30);
      if(b.t==='text')b.md=f('md');else if(b.t==='steps'){b.title=f('title').trim();el.querySelectorAll('[data-stxt]').forEach(t=>{const s=b.items[+t.dataset.stxt];if(s)s.txt=t.value})}
      else if(b.t==='dodont'){b.do=lines('do');b.dont=lines('dont')}else if(b.t==='video'){b.title=f('title').trim();b.url=f('url').trim()}
      else if(b.t==='check'){b.title=f('title').trim();b.items=lines('items')}else if(b.t==='quiz'){b.q=f('q').trim();b.opts=lines('opts').slice(0,10);b.ok=Math.max(0,Math.min(b.opts.length-1,(+f('ok')||1)-1));b.why=f('why').trim()}});
    art.title=api.q('#kbT').value.trim();art.topic=api.q('#kbTp').value;art.summary=api.q('#kbS').value.trim();art.published=api.q('#kbPub').checked;art.ruta=+api.q('#kbR').value||null;if(api.q('#kbG'))art.global=api.q('#kbG').checked;
  };
  modal({title:a?'Editar artículo':'Nuevo artículo',wide:true,body:`<div class="bk-row"><label class="fld grow"><span>Título</span><input id="kbT" maxlength="120" value="${esc(art.title)}" placeholder="Ej.: Cómo pedir un boleto en efectivo" autofocus></label>
      <label class="fld"><span>Tema</span><select id="kbTp">${KB_TOPICS.map(([k,n])=>`<option value="${k}"${art.topic===k?' selected':''}>${esc(n)}</option>`).join('')}</select></label></div>
    <label class="fld"><span>Resumen <small class="dim">(una línea, se ve en la lista)</small></span><input id="kbS" maxlength="300" value="${esc(art.summary||'')}"></label>
    <div class="fld"><span>Contenido</span><div id="kbBl"></div><div class="kb-add">${KB_BLOCKS.map(([k,n])=>`<button type="button" class="btn sm" data-badd="${k}">+ ${esc(n)}</button>`).join('')}</div></div>
    <div class="bk-row"><label class="chk"><input type="checkbox" id="kbPub"${art.published?' checked':''}>Publicado <small class="dim">(sin marcar, solo lo ven los que escriben)</small></label>
      <label class="fld"><span>Paso de "Tus primeros días"</span><input type="number" id="kbR" min="1" max="99" value="${art.ruta||''}" placeholder="—" style="width:90px"></label>
      ${isAdmin()?`<label class="chk"><input type="checkbox" id="kbG"${art.global?' checked':''}>Para todas las mesas</label>`:''}</div><div class="ebox" id="kbE"></div>`,
    onOpen:api=>{draw(api);
      api.box.addEventListener('click',async e=>{
        const ad=e.target.closest('[data-badd]');if(ad){pull(api);const t=ad.dataset.badd;art.blocks.push(t==='steps'?{t,title:'',items:[{txt:'',img:null}]}:t==='dodont'?{t,do:[],dont:[]}:t==='check'?{t,title:'',items:[]}:t==='quiz'?{t,q:'',opts:[],ok:0,why:''}:t==='video'?{t,title:'',url:''}:{t,md:''});draw(api);return}
        const bd=e.target.closest('.kb-bed');if(!bd)return;const i=+bd.dataset.i,b=art.blocks[i];
        if(e.target.closest('[data-bdel]')){pull(api);art.blocks.splice(i,1);draw(api);return}
        const mv=e.target.closest('[data-bmv]');if(mv){pull(api);const j=mv.dataset.bmv==='up'?i-1:i+1;if(j<0||j>=art.blocks.length)return;[art.blocks[i],art.blocks[j]]=[art.blocks[j],art.blocks[i]];draw(api);return}
        if(b.t==='steps'){const st=e.target.closest('.kb-st'),j=st?+st.dataset.j:-1;
          if(e.target.closest('[data-sadd]')){pull(api);b.items.push({txt:'',img:null});draw(api);return}
          if(e.target.closest('[data-sdel]')){pull(api);b.items.splice(j,1);draw(api);return}
          const sm=e.target.closest('[data-smv]');if(sm){pull(api);const k=sm.dataset.smv==='up'?j-1:j+1;if(k<0||k>=b.items.length)return;[b.items[j],b.items[k]]=[b.items[k],b.items[j]];draw(api);return}}
      });
      api.box.addEventListener('change',async e=>{const inp=e.target.closest('[data-simg]');if(!inp||!inp.files[0])return;const bd=inp.closest('.kb-bed'),b=art.blocks[+bd.dataset.i],j=+inp.dataset.simg;
        pull(api);try{const aid=await ensureId();b.items[j].img=await kbUpload(aid,inp.files[0]);draw(api)}catch(err){toast(esc(errMsg(err)),'err')}});
    },
    onClose:async()=>{if(createdDraft&&!saved){try{await Q(sb.from('kb_articles').delete().eq('id',id))}catch(e){}kbLoad(true)}},
    actions:[...(a?[{l:'Borrar',cls:'danger',fn:async()=>{if(!await confirmar('Borrar artículo',`¿Borrar <b>${esc(a.title)}</b> con sus capturas?`,'borrar',true))return false;try{await Q(sb.from('kb_articles').delete().eq('id',a.id));kbOpen=null;await kbLoad(true);toast('Artículo borrado.')}catch(e){toast(esc(errMsg(e)),'err');return false}}}]:[]),
      {l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
        pull(api);if(!art.title){api.q('#kbE').textContent='Poné el título.';return false}
        const row={title:art.title.slice(0,120),topic:art.topic,summary:art.summary.slice(0,300)||null,blocks:art.blocks,published:art.published,ruta:art.ruta,global:!!art.global,updated_by:me,updated_at:new Date().toISOString()};
        try{if(id){await Q(sb.from('kb_articles').update(row).eq('id',id))}else{const r=await Q(sb.from('kb_articles').insert(row).select('id'));id=r[0].id}saved=true;
          await kbLoad(true);kbOpen=id;V.kb.render({});toast(a?'Artículo guardado.':`<b>${esc(art.title)}</b> ${art.published?'publicado':'guardado como borrador'}.`)}catch(e){toast(esc(errMsg(e)),'err');return false}
      }}]});
}
