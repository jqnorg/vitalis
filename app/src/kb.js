/* ---------- Knowledgebase: el centro de ayuda de la mesa (pedido del dueño, 25/11/2026; "casi igual a KnowledgeBase by LiveChat") ----------
   Portada con el buscador grande y las categorías en tarjetas (las crea el admin/TL, con nombre e ícono); cada artículo es una página
   de ayuda: autor, minutos de lectura, actualizado, índice del artículo a la derecha y la lista de la categoría a la izquierda,
   "¿Te sirvió?" al pie. Se escribe como un documento (contenteditable + barrita al seleccionar): texto, títulos, listas, links,
   avisos, capturas pegadas donde quieras, video por link, y dos cosas propias: el paso a paso con galería y la pregunta.
   El HTML se limpia al guardar y al mostrar (kbClean). Escriben admin, team leader y quien el admin marque (profiles.kb_editor).
   "Tus primeros días": los artículos con `ruta` son la ruta del agente nuevo; se marcan "Lo leí". */
const KB_ICONS=['book','rocket','phone','card','bank','chat','shield','star','flag','bulb','clock','users','target','tool'];
let kb={ok:null,cats:[],arts:[],reads:new Set(),teamReads:[],votes:{},stats:[],at:0,busy:null};
let kbCat='',kbQ='',kbOpen=null,kbMode='home',kbCar={}; // kbMode: home · cat · art · edit · search
const kbImgs=new Map();
const kbEd=()=>!!profile&&(isLeader()||!!profile.kb_editor);
const kbArt=id=>kb.arts.find(a=>a.id===id);
const kbCatOf=id=>kb.cats.find(c=>c.id===id);
const kbRuta=()=>kb.arts.filter(a=>a.ruta!=null&&a.published).sort((a,b)=>a.ruta-b.ruta||a.title.localeCompare(b.title));
const kbPend=()=>kbRuta().filter(a=>!kb.reads.has(a.id));
const kbVisible=a=>a.published||kbEd();
const kbArtsIn=cid=>kb.arts.filter(a=>kbVisible(a)&&(cid?a.category_id===cid:!a.category_id||!kbCatOf(a.category_id))).sort((a,b)=>a.sort-b.sort||a.title.localeCompare(b.title));
const kbText=html=>{const t=document.createElement('template');t.innerHTML=html||'';return (t.content.textContent||'').replace(/\s+/g,' ').trim()};
const kbMins=a=>Math.max(1,Math.round(kbText(a.body).split(/\s+/).filter(Boolean).length/180));
const kbIcon=k=>`<svg class="ic" aria-hidden="true"><use href="#c-${KB_ICONS.includes(k)?k:'book'}"/></svg>`;

async function kbFetch(){
  const ed=kbEd();
  const [cats,arts,reads,votes,tr,st]=await Promise.all([
    Q(sb.from('kb_categories').select('*').order('sort').order('name')),
    Q(sb.from('kb_articles').select('id,team_id,global,category_id,title,summary,body,published,ruta,sort,created_by,created_at,updated_by,updated_at').order('sort').order('title')),
    Q(sb.from('kb_reads').select('article_id').eq('user_id',me)),
    Q(sb.from('kb_votes').select('article_id,ok').eq('user_id',me)),
    ed?Q(sb.from('kb_reads').select('article_id,user_id,read_at')):[],
    ed?B.rpc('kb_stats',{}).catch(()=>[]):[],
  ]);
  return {cats:cats||[],arts:arts||[],reads:reads||[],votes:votes||[],tr:tr||[],st:Array.isArray(st)?st:[]};
}
function kbApply(d){kb.cats=d.cats;kb.arts=d.arts;kb.reads=new Set(d.reads.map(r=>r.article_id));kb.votes=Object.fromEntries(d.votes.map(v=>[v.article_id,v.ok]));kb.teamReads=d.tr;kb.stats=d.st;kb.ok=true;kb.at=Date.now()}
async function kbLoad(force){
  if(!ready||!me)return;if(kb.busy)return kb.busy;if(!force&&kb.ok&&Date.now()-kb.at<120000)return;
  kb.busy=(async()=>{try{kbApply(await kbFetch())}catch(e){if(kb.ok==null)kb.ok=/does not exist|42P01|PGRST2/.test(String(e&&e.message||e))?false:null;if(kb.ok!==false)toast(esc(errMsg(e)),'err')}finally{kb.busy=null}})();
  await kb.busy;if(cur==='kb'&&kbMode!=='edit')V.kb.render({});else status();
}
function kbNewbieCheck(){ // al entrar: si al agente le faltan guías de la ruta del nuevo, un aviso por día
  if(!kb.ok||kbEd())return;const p=kbPend();if(!p.length)return;
  if(local.get('kbHint','')===todayS())return;local.set('kbHint',todayS());
  toast(`Tenés <b>${plural(p.length,'guía')}</b> para empezar en el Knowledgebase.`,'imp',{actions:[{l:'Ver',fn:()=>{kbGo('home')}}]});
}

/* ---------- fotos (como Banking: achicadas, webp, cache en IndexedDB) ---------- */
async function kbHydrate(root){
  let need=[...new Set([...root.querySelectorAll('img[data-kbimg]')].map(b=>b.dataset.kbimg).filter(id=>id&&!kbImgs.has(id)))];
  if(need.length){const miss=[];for(const id of need){try{const c=await imgCacheGet(id);if(c&&c.data){kbImgs.set(id,`data:${c.mime};base64,${c.data}`);continue}}catch(e){}miss.push(id)}need=miss}
  if(need.length){try{for(const r of await Q(sb.from('kb_files').select('id,mime,data').in('id',need.slice(0,80)))){kbImgs.set(r.id,`data:${r.mime};base64,${r.data}`);imgCachePut(r.id,{mime:r.mime,data:r.data,at:Date.now()})}}catch(e){}}
  root.querySelectorAll('img[data-kbimg]').forEach(im=>{const u=kbImgs.get(im.dataset.kbimg);if(u&&im.src!==u)im.src=u});
}
async function kbUpload(articleId,file){
  const im=await prepImg(file),data=await b64(im.blob);URL.revokeObjectURL(im.url);
  const r=await Q(sb.from('kb_files').insert({article_id:articleId,mime:im.mime,data,w:im.w,h:im.h}).select('id'));
  const id=r[0].id;kbImgs.set(id,`data:${im.mime};base64,${data}`);imgCachePut(id,{mime:im.mime,data,at:Date.now()});return id;
}
function kbLightbox(id){const u=kbImgs.get(id);if(!u)return;modal({title:'Captura',wide:true,body:`<img class="bk-big" src="${u}" alt="Captura">`,actions:[{l:'Cerrar',cls:'pri'}]})}

/* ---------- el HTML del artículo: solo lo permitido (al guardar y al mostrar) ---------- */
const KB_TAGS={h2:[],h3:[],p:['class'],b:[],strong:[],i:[],em:[],u:[],s:[],ul:[],ol:[],li:[],br:[],hr:[],a:['href'],img:['data-kbimg','alt'],figure:[],figcaption:[],div:['class','data-url','data-ok'],blockquote:[],span:[]};
const KB_DIVS=new Set(['kb-av','kb-steps','kb-quiz','kb-vid']);
function kbClean(html){
  const t=document.createElement('template');t.innerHTML=String(html||'');
  const fix=el=>{for(const c of [...el.children]){
    const tag=c.localName.toLowerCase();
    if(['script','style','iframe','object','embed','svg','button','input','textarea','select','label','form'].includes(tag)){c.remove();continue}
    let x=c;
    if(!KB_TAGS[tag]){x=document.createElement(/^h[1456]$/.test(tag)?'h3':/^(section|article|header|footer|main|nav|table|tbody|tr|td|th|pre|code)$/.test(tag)?'p':'span');while(c.firstChild)x.appendChild(c.firstChild);c.replaceWith(x)}
    const keep=KB_TAGS[x.localName]||[];
    for(const a of [...x.attributes]){
      if(!keep.includes(a.name)){x.removeAttribute(a.name);continue}
      if(a.name==='href'&&!/^https?:\/\//i.test(a.value))x.removeAttribute('href');
      if(a.name==='data-kbimg'&&!/^[0-9a-f-]{36}$/i.test(a.value))x.removeAttribute('data-kbimg');
      if(a.name==='class'){const cls=a.value.split(/\s+/).filter(k=>KB_DIVS.has(k)||k==='kb-qq');if(cls.length)x.setAttribute('class',cls.join(' '));else x.removeAttribute('class')}
      if(a.name==='data-url'&&!/^https?:\/\//i.test(a.value))x.removeAttribute('data-url');
      if(a.name==='data-ok'&&!/^\d{1,2}$/.test(a.value))x.removeAttribute('data-ok');
    }
    if(x.localName==='img'&&!x.dataset.kbimg){x.remove();continue}
    if(x.localName==='div'&&!x.className){const q=document.createElement('p');while(x.firstChild)q.appendChild(x.firstChild);x.replaceWith(q);x=q} // un div pelado es un párrafo
    if(x.localName==='span'&&!x.attributes.length){const f=document.createDocumentFragment();while(x.firstChild)f.appendChild(x.firstChild);x.replaceWith(f);el.normalize();continue} // un span pelado no aporta
    fix(x);
  }};
  fix(t.content);return t.innerHTML;
}
function kbVideo(url){ // YouTube y Loom embebidos; lo demás, un link
  const u=String(url||'').trim();let m;
  if((m=/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{6,})/.exec(u)))return `<div class="kb-vid-f"><iframe src="https://www.youtube.com/embed/${m[1]}" title="Video" allow="fullscreen" loading="lazy"></iframe></div>`;
  if((m=/loom\.com\/(?:share|embed)\/([\w-]{10,})/.exec(u)))return `<div class="kb-vid-f"><iframe src="https://www.loom.com/embed/${m[1]}" title="Video" allow="fullscreen" loading="lazy"></iframe></div>`;
  return /^https?:\/\//.test(u)?`<p><a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener">Ver el video</a></p>`:'';
}
const kbFigs=d=>[...d.querySelectorAll('figure')].map(f=>{const im=f.querySelector('img[data-kbimg]');return {img:im?im.dataset.kbimg:null,txt:(f.querySelector('figcaption')||{}).innerHTML||''}}).filter(s=>s.img||kbText(s.txt));
const kbQuizOf=d=>({q:(d.querySelector('.kb-qq')||{}).textContent||'',opts:[...d.querySelectorAll('li')].map(l=>l.textContent.trim()).filter(Boolean),ok:+(d.dataset.ok||0)});
// de HTML limpio a lo que se ve: paso a paso → carrusel, pregunta → botones, video → embebido, aviso → con ícono, links afuera, títulos con ancla
function kbRender(a){
  const t=document.createElement('template');t.innerHTML=kbClean(a.body);const root=t.content;
  let hi=0;root.querySelectorAll('h2,h3').forEach(h=>{if(!h.closest('.kb-quiz'))h.id='kb-h-'+(hi++)});
  root.querySelectorAll('a[href]').forEach(x=>{x.target='_blank';x.rel='noopener'});
  root.querySelectorAll('div.kb-av').forEach(d=>{d.insertAdjacentHTML('afterbegin','<svg class="ic" aria-hidden="true"><use href="#i-alerta"/></svg>')});
  root.querySelectorAll('div.kb-vid').forEach(d=>{const w=document.createElement('div');w.className='kb-vid';w.innerHTML=kbVideo(d.dataset.url);d.replaceWith(w)});
  [...root.querySelectorAll('div.kb-steps')].forEach((d,i)=>{const w=document.createElement('template');w.innerHTML=kbCarHTML(a.id+':'+i,kbFigs(d));d.replaceWith(w.content)});
  [...root.querySelectorAll('div.kb-quiz')].forEach((d,i)=>{const {q,opts,ok}=kbQuizOf(d),w=document.createElement('template');w.innerHTML=kbQuizHTML(a.id+':'+i,q,opts,ok);d.replaceWith(w.content)});
  root.querySelectorAll('img[data-kbimg]').forEach(im=>{const b=document.createElement('button');b.type='button';b.className='kb-zoom';b.dataset.kbzoom=im.dataset.kbimg;im.replaceWith(b);b.appendChild(im)});
  const w=document.createElement('div');w.appendChild(root);return w.innerHTML;
}
function kbCarHTML(k,its){
  if(!its.length)return '';const cur=Math.min(kbCar[k]||0,its.length-1),s=its[cur];
  return `<div class="kb-car" data-car="${esc(k)}" tabindex="0" aria-label="Paso a paso">
    <div class="kb-car-img">${s.img?`<button type="button" class="kb-zoom" data-kbzoom="${esc(s.img)}" title="Ver grande"><img data-kbimg="${esc(s.img)}" alt="Paso ${cur+1}"></button>`:'<div class="kb-noimg">Sin captura</div>'}
      <button type="button" class="kb-arr l" data-kbnav="-1" aria-label="Paso anterior"${cur?'':' disabled'}>‹</button><button type="button" class="kb-arr r" data-kbnav="1" aria-label="Paso siguiente"${cur<its.length-1?'':' disabled'}>›</button></div>
    <div class="kb-car-cap"><span class="kb-on">${cur+1}</span><div class="grow">${kbClean(s.txt)}</div></div>
    <div class="kb-dots" role="tablist">${its.map((_,j)=>`<button type="button" data-kbdot="${j}" class="${j===cur?'on':''}" aria-label="Paso ${j+1}"></button>`).join('')}<span class="dim">Paso ${cur+1} de ${its.length}</span></div></div>`;
}
function kbQuizHTML(k,q,opts,ok){
  if(!opts.length)return '';const ans=kbCar['q'+k];
  return `<div class="kb-quiz" data-quiz="${esc(k)}"><h3 class="kb-qq">${esc(q||'¿Lo entendiste?')}</h3><div class="kb-qo">${opts.map((o,j)=>`<button type="button" class="btn${ans==null?'':j===ok?' good':j===ans?' bad':''}" data-kbq="${j}"${ans==null?'':' disabled'}>${esc(o)}</button>`).join('')}</div>${ans==null?'':ans===ok?'<p class="kb-qr ok">¡Bien! Esa es.</p>':`<p class="kb-qr no">No: la correcta es <b>${esc(opts[ok]||'')}</b>.</p>`}</div>`;
}
const kbCarItems=(a,i)=>{const t=document.createElement('template');t.innerHTML=kbClean(a.body);const d=t.content.querySelectorAll('div.kb-steps')[i];return d?kbFigs(d):[]};

/* ---------- navegación adentro de la sección ---------- */
function kbGo(mode,id){kbMode=mode;if(mode==='cat')kbCat=id||'';if(mode==='art'){kbOpen=id;kbCar={}}if(mode==='home'){kbCat='';kbOpen=null;kbQ=''}if(cur!=='kb')go('kb');else V.kb.render({});$('#main').scrollTop=0}
function kbCrumbs(parts){return `<nav class="kb-crumbs" aria-label="Dónde estás">${[['Knowledgebase','home',''],...parts].map(([l,m,id],i,arr)=>i<arr.length-1?`<button type="button" class="lnk" data-kbgo="${m}" data-id="${esc(id||'')}">${esc(l)}</button><span>›</span>`:`<span class="cur">${esc(l)}</span>`).join('')}</nav>`}

V.kb={
  build(){
    const v=$('#v-kb');
    v.addEventListener('input',e=>{if(e.target.id==='kbQ'){kbQ=e.target.value;const r=$('#kbRes');if(r)r.innerHTML=kbSearchHTML()}});
    v.addEventListener('keydown',e=>{if(e.target.id==='kbQ'&&e.key==='Enter'){e.preventDefault();kbMode='search';this.render({});const i=$('#kbQ');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}return}
      const c=e.target.closest('.kb-car');if(c&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();kbCarMove(c.dataset.car,e.key==='ArrowLeft'?-1:1)}});
    v.addEventListener('click',async e=>{
      if(kbMode==='edit'&&e.target.closest('#kbEdit'))return; // el editor tiene sus propios clics
      const g=e.target.closest('[data-kbgo]');if(g){kbGo(g.dataset.kbgo,g.dataset.id);return}
      const nv=e.target.closest('[data-kbnav]');if(nv){kbCarMove(nv.closest('.kb-car').dataset.car,+nv.dataset.kbnav);return}
      const dt=e.target.closest('[data-kbdot]');if(dt){kbCarMove(dt.closest('.kb-car').dataset.car,+dt.dataset.kbdot,true);return}
      const z=e.target.closest('[data-kbzoom]');if(z){kbLightbox(z.dataset.kbzoom);return}
      const q=e.target.closest('[data-kbq]');if(q){const box=q.closest('[data-quiz]');kbCar['q'+box.dataset.quiz]=+q.dataset.kbq;this.render({});return}
      const toc=e.target.closest('[data-kbtoc]');if(toc){const h=document.getElementById(toc.dataset.kbtoc);if(h)h.scrollIntoView({behavior:'smooth',block:'start'});return}
      const a=e.target.closest('[data-kba]');if(!a)return;const act=a.dataset.kba,id=a.dataset.id;
      if(act==='new')return kbEditOpen(null,kbCat||null);
      if(act==='edit')return kbEditOpen(kbArt(id));
      if(act==='cat')return kbCatModal(id?kbCatOf(id):null);
      if(act==='read')return kbMarkRead(id);
      if(act==='vote')return kbVote(id,a.dataset.ok==='1');
      if(act==='next'){const p=kbPend();if(p.length)kbGo('art',p[0].id);return}
    });
  },
  render(){
    kbLoad();
    const ed=kbEd();$('#kbTools').innerHTML=ed&&kbMode!=='edit'?`<button type="button" class="btn sm" data-kba="cat">Categoría</button><button type="button" class="btn sm pri" data-kba="new"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg> Artículo</button>`:'';
    const body=$('#kbBody');
    if(kb.ok===false){body.innerHTML='<section class="card"><div class="p-empty">El Knowledgebase se activa en un rato (falta actualizar la base).</div></section>';return}
    if(kb.ok==null){body.innerHTML='<section class="card"><div class="p-empty">Cargando…</div></section>';return}
    if(kbMode==='edit'){if(!$('#kbEdit')){body.innerHTML=kbEditHTML();kbHydrate(body);kbEditWire()}return} // el editor no se redibuja (no se pierde lo escrito)
    if(kbMode==='art'&&kbArt(kbOpen)){body.innerHTML=kbArtHTML(kbArt(kbOpen));kbHydrate(body);return}
    if(kbMode==='cat'&&kbCatOf(kbCat)){body.innerHTML=kbCatHTML(kbCatOf(kbCat));return}
    if(kbMode==='search'){body.innerHTML=kbHeroHTML()+`<section class="kb-wrap"><div id="kbRes">${kbSearchHTML()}</div></section>`;return}
    kbMode='home';body.innerHTML=kbHomeHTML();kbHydrate(body);
  },
};
function kbHeroHTML(){return `<div class="kb-hero"><h2>¿Qué querés saber?</h2><div class="kb-search"><svg class="ic" aria-hidden="true"><use href="#c-search"/></svg><input id="kbQ" type="search" placeholder="Buscá una guía: cómo pedir un boleto, qué decir si…" autocomplete="off" value="${esc(kbQ)}" aria-label="Buscar"></div></div>`}
function kbHomeHTML(){
  const ed=kbEd(),ruta=kbRuta(),pend=kbPend();
  const rutaCard=ruta.length&&(pend.length||ed)?`<section class="card kb-ruta"><div class="card-h"><h3>Tus primeros días</h3><span class="p-sub">${pend.length?`te faltan ${plural(pend.length,'guía')} de ${ruta.length}`:'ya las leíste todas'}</span><span class="grow"></span>${pend.length?`<button type="button" class="btn sm pri" data-kba="next">Seguir</button>`:''}</div>
    <ol class="kb-steps-l">${ruta.map(a=>`<li class="${kb.reads.has(a.id)?'done':''}"><button type="button" class="kb-row" data-kbgo="art" data-id="${esc(a.id)}"><span class="kb-on">${kb.reads.has(a.id)?'✓':a.ruta}</span><span class="grow"><b>${esc(a.title)}</b>${a.summary?`<small class="dim">${esc(a.summary)}</small>`:''}</span><span class="dim">${kbMins(a)} min</span></button></li>`).join('')}</ol>${ed?kbProgressHTML(ruta):''}</section>`:'';
  const cats=kb.cats.map(c=>{const n=kbArtsIn(c.id);return `<button type="button" class="kb-cat" data-kbgo="cat" data-id="${esc(c.id)}"><span class="kb-ci">${kbIcon(c.icon)}</span><b>${esc(c.name)}</b>${c.descr?`<span class="dim">${esc(c.descr)}</span>`:''}<small>${plural(n.length,'artículo')}${c.global?' · todas las mesas':''}</small></button>`}).join('');
  const loose=kbArtsIn('');
  return kbHeroHTML()+`<section class="kb-wrap">${rutaCard}
    ${kb.cats.length?`<div class="kb-cats">${cats}</div>`:`<div class="card"><div class="p-empty">${ed?'Creá la primera categoría con el botón de arriba (por ejemplo: Primer día, El CRM, Banking…).':'Todavía no hay guías.'}</div></div>`}
    ${loose.length?`<section class="card"><div class="card-h"><h3>Sin categoría</h3></div><div class="kb-list">${loose.map(kbRowHTML).join('')}</div></section>`:''}</section>`;
}
function kbRowHTML(a){const st=kb.stats.find(s=>s.id===a.id);return `<button type="button" class="kb-row${a.published?'':' draft'}" data-kbgo="art" data-id="${esc(a.id)}"><span class="grow"><b>${esc(a.title)}</b>${a.summary?`<small class="dim">${esc(a.summary)}</small>`:''}</span>
  ${!a.published?'<span class="badge">Borrador</span>':kb.reads.has(a.id)?'<span class="badge paid">Leído</span>':''}${a.global?'<span class="badge" title="Lo ven todas las mesas">Global</span>':''}${a.ruta!=null?`<span class="badge" title="Ruta del nuevo">Paso ${a.ruta}</span>`:''}${kbEd()&&st?`<span class="dim kb-st" title="Me sirvió / no me quedó claro · leído">${st.ok}👍 ${st.no}👎 · ${st.reads}</span>`:''}<span class="dim">${kbMins(a)} min</span></button>`}
function kbCatHTML(c){
  const L=kbArtsIn(c.id);
  return `<section class="kb-wrap"><div class="kb-topb"><button type="button" class="btn sm" data-kbgo="home">‹ Volver</button>${kbCrumbs([[c.name,'cat',c.id]])}</div><div class="kb-cat-h"><span class="kb-ci">${kbIcon(c.icon)}</span><div><h2>${esc(c.name)}</h2>${c.descr?`<p class="dim">${esc(c.descr)}</p>`:''}</div><span class="grow"></span>${kbEd()?`<button type="button" class="btn sm" data-kba="cat" data-id="${esc(c.id)}">Editar categoría</button>`:''}</div>
    <div class="kb-list">${L.length?L.map(kbRowHTML).join(''):`<div class="p-empty">${kbEd()?'Todavía no hay artículos acá: escribí uno con "+ Artículo".':'Todavía no hay artículos acá.'}</div>`}</div></section>`;
}
function kbSearchHTML(){
  const q=norm(kbQ).trim();if(!q)return '<p class="dim">Escribí para buscar.</p>';
  const hits=kb.arts.filter(a=>kbVisible(a)&&norm(a.title+' '+(a.summary||'')+' '+kbText(a.body)).includes(q));
  const snip=a=>{const t=kbText(a.body),i=norm(t).indexOf(q);if(i<0)return a.summary||'';const s=Math.max(0,i-60);return (s?'…':'')+t.slice(s,i+100)+'…'};
  return `<h3 class="kb-rh">${plural(hits.length,'resultado')} para «${esc(kbQ)}»</h3><div class="kb-list">${hits.map(a=>`<button type="button" class="kb-row" data-kbgo="art" data-id="${esc(a.id)}"><span class="grow"><b>${esc(a.title)}</b><small class="dim">${esc(snip(a))}</small></span>${a.category_id&&kbCatOf(a.category_id)?`<span class="kb-tp">${esc(kbCatOf(a.category_id).name)}</span>`:''}</button>`).join('')||'<div class="p-empty">Nada con esas palabras.</div>'}</div>`;
}
function kbArtHTML(a){
  const ed=kbEd(),v=kb.votes[a.id],read=kb.reads.has(a.id),who=a.updated_by||a.created_by,c=kbCatOf(a.category_id),sib=kbArtsIn(c?c.id:''),ruta=kbRuta(),ri=ruta.findIndex(x=>x.id===a.id),next=ri>=0?ruta[ri+1]:null;
  const html=kbRender(a),tmp=document.createElement('template');tmp.innerHTML=html;const toc=[...tmp.content.querySelectorAll('h2[id],h3[id]')].map(h=>`<button type="button" class="${h.localName}" data-kbtoc="${h.id}">${esc(h.textContent)}</button>`).join('');
  return `<div class="kb-page">
    <aside class="kb-side"><h4>${c?esc(c.name):'Sin categoría'}</h4><div class="kb-sidel">${sib.map(x=>`<button type="button" class="${x.id===a.id?'on':''}" data-kbgo="art" data-id="${esc(x.id)}">${esc(x.title)}</button>`).join('')}</div></aside>
    <article class="kb-art card"><div class="kb-topb"><button type="button" class="btn sm" data-kbgo="${c?'cat':'home'}" data-id="${esc(c?c.id:'')}">‹ Volver</button>${kbCrumbs(c?[[c.name,'cat',c.id],[a.title]]:[[a.title]])}</div>
      <h1 class="kb-h">${esc(a.title)}</h1>${a.summary?`<p class="kb-sum">${esc(a.summary)}</p>`:''}
      <div class="kb-meta">${who?`<span class="who-cell">${avatar(memberName(who))}${esc(memberName(who))}</span>`:''}<span class="dim">${kbMins(a)} min de lectura · actualizado ${esc(rel(new Date(a.updated_at)))}</span>${a.ruta!=null?`<span class="badge">Paso ${a.ruta} de tus primeros días</span>`:''}${a.published?'':'<span class="badge">Borrador</span>'}${a.global?'<span class="badge">Todas las mesas</span>':''}<span class="grow"></span>${ed?`<button type="button" class="btn sm" data-kba="edit" data-id="${esc(a.id)}">Editar</button>`:''}</div>
      <div class="kb-body">${html||'<p class="dim">Este artículo todavía no tiene contenido.</p>'}</div>
      <div class="kb-foot"><div class="kb-fb"><span>¿Te sirvió?</span><button type="button" class="btn sm${v===true?' on':''}" data-kba="vote" data-ok="1" data-id="${esc(a.id)}">Sí</button><button type="button" class="btn sm${v===false?' on':''}" data-kba="vote" data-ok="0" data-id="${esc(a.id)}">No me quedó claro</button></div>
        <div class="kb-fb">${read?'<span class="badge paid">Leído ✓</span>':`<button type="button" class="btn sm pri" data-kba="read" data-id="${esc(a.id)}">Lo leí</button>`}${next?`<button type="button" class="btn sm" data-kbgo="art" data-id="${esc(next.id)}">Siguiente: ${esc(next.title)} ›</button>`:''}</div></div>
    </article>
    <aside class="kb-toc">${toc?`<h4>En este artículo</h4><div class="kb-tocl">${toc}</div>`:''}</aside></div>`;
}
function kbProgressHTML(ruta){
  const ags=members.filter(m=>m.active&&!m.former&&m.role==='agent'&&!isBot(m.id));if(!ags.length||!ruta.length)return '';
  const of=uid=>ruta.filter(a=>kb.teamReads.some(r=>r.user_id===uid&&r.article_id===a.id)).length;
  const rows=ags.map(m=>({m,n:of(m.id)})).filter(x=>x.n<ruta.length).sort((a,b)=>a.n-b.n||a.m.name.localeCompare(b.m.name));
  return `<details class="kb-prog" data-k="kbprog"><summary>Quién va por dónde <small class="dim">· ${rows.length?plural(rows.length,'agente')+' sin terminar':'todos la terminaron'}</small></summary>
    ${rows.length?`<div class="kb-progl">${rows.map(x=>`<div class="kb-pr"><span class="who-cell">${avatar(x.m.name)}${esc(x.m.name)}</span><span class="kb-bar"><i style="width:${Math.round(100*x.n/ruta.length)}%"></i></span><span class="dim">${x.n} de ${ruta.length}</span></div>`).join('')}</div>`:''}</details>`;
}
function kbCarMove(k,d,abs){const [aid,i]=k.split(':'),a=kbArt(aid);if(!a)return;const its=kbCarItems(a,+i),n=its.length,cur=kbCar[k]||0,to=abs?d:cur+d;if(to<0||to>=n)return;kbCar[k]=to;
  const el=$(`#v-kb .kb-car[data-car="${CSS.escape(k)}"]`);if(!el)return;const tmp=document.createElement('div');tmp.innerHTML=kbCarHTML(k,its);el.replaceWith(tmp.firstElementChild);kbHydrate($('#v-kb'));const c=$(`#v-kb .kb-car[data-car="${CSS.escape(k)}"]`);if(c)c.focus({preventScroll:true})}
async function kbMarkRead(id){try{await Q(sb.from('kb_reads').upsert({user_id:me,article_id:id},{onConflict:'user_id,article_id'}));kb.reads.add(id);V.kb.render({});const a=kbArt(id);if(a&&a.ruta!=null&&!kbPend().length)toast('Terminaste tus primeros días. ¡Bien ahí!','win')}catch(e){toast(esc(errMsg(e)),'err')}}
async function kbVote(id,ok){try{await Q(sb.from('kb_votes').upsert({user_id:me,article_id:id,ok},{onConflict:'user_id,article_id'}));kb.votes[id]=ok;V.kb.render({});toast(ok?'Gracias.':'Gracias: lo vamos a mejorar.')}catch(e){toast(esc(errMsg(e)),'err')}}

/* ---------- categorías: nombre, ícono, descripción, orden ---------- */
function kbCatModal(c){
  if(!kbEd())return;
  modal({title:c?'Editar categoría':'Nueva categoría',body:`<label class="fld"><span>Nombre</span><input id="kcN" maxlength="60" value="${esc(c&&c.name||'')}" placeholder="Ej.: El CRM" autofocus></label>
    <label class="fld"><span>Una línea de qué va <small class="dim">(opcional)</small></span><input id="kcD" maxlength="200" value="${esc(c&&c.descr||'')}"></label>
    <div class="fld"><span>Ícono</span><div class="kb-icons">${KB_ICONS.map(k=>`<label class="kb-ico"><input type="radio" name="kcI" value="${k}"${(c?c.icon:'book')===k?' checked':''}>${kbIcon(k)}</label>`).join('')}</div></div>
    <div class="bk-row"><label class="fld"><span>Orden</span><input type="number" id="kcS" min="0" max="99" value="${c?c.sort:kb.cats.length}" style="width:80px"></label>${isAdmin()?`<label class="chk"><input type="checkbox" id="kcG"${c&&c.global?' checked':''}>Para todas las mesas</label>`:''}</div><div class="ebox" id="kcE"></div>`,
    actions:[...(c?[{l:'Borrar',cls:'danger',fn:async()=>{if(!await confirmar('Borrar categoría',`¿Borrar <b>${esc(c.name)}</b>? Sus artículos quedan sin categoría (no se borran).`,'borrar',true))return false;try{await Q(sb.from('kb_categories').delete().eq('id',c.id));if(kbCat===c.id)kbMode='home';await kbLoad(true);toast('Categoría borrada.')}catch(e){toast(esc(errMsg(e)),'err');return false}}}]:[]),
      {l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
        const name=api.q('#kcN').value.trim();if(!name){api.q('#kcE').textContent='Poné el nombre.';return false}
        const row={name:name.slice(0,60),descr:api.q('#kcD').value.trim().slice(0,200)||null,icon:(api.box.querySelector('[name=kcI]:checked')||{}).value||'book',sort:+api.q('#kcS').value||0,global:!!(api.q('#kcG')&&api.q('#kcG').checked)};
        try{if(c)await Q(sb.from('kb_categories').update(row).eq('id',c.id));else await Q(sb.from('kb_categories').insert(row));await kbLoad(true);toast(c?'Categoría guardada.':`Categoría <b>${esc(name)}</b> creada.`)}catch(e){toast(esc(errMsg(e)),'err');return false}
      }}]});
}

/* ---------- el editor: se escribe como un documento ---------- */
let kbE=null; // {a, id, createdDraft, saved, dirty}
function kbEditOpen(a,catId){
  if(!kbEd())return;
  kbE={a:a?{...a}:{title:'',summary:'',body:'',category_id:catId||null,published:false,ruta:null,global:false},id:a?a.id:null,createdDraft:false,saved:false,dirty:false};
  kbMode='edit';if(cur!=='kb')go('kb');else V.kb.render({});$('#main').scrollTop=0;
}
const KB_TB=[['h2','Título','T'],['h3','Subtítulo','t'],['bold','Negrita','<b>B</b>'],['italic','Cursiva','<i>I</i>'],['underline','Subrayado','<u>U</u>'],['ul','Lista','•'],['ol','Lista numerada','1.'],['link','Link','Link'],['av','Aviso','Aviso']];
function kbEditHTML(){
  const a=kbE.a,c=kb.cats,tb=KB_TB.map(([k,l,h])=>`<button type="button" data-kbcmd="${k}" title="${l}">${h}</button>`).join('');
  return `<div class="kb-page kb-editp" id="kbEdit">
    <div class="kb-edmain card">
      <input id="kbEdT" class="kb-edtitle" maxlength="120" value="${esc(a.title)}" placeholder="Título del artículo">
      <input id="kbEdS" class="kb-edsum" maxlength="300" value="${esc(a.summary||'')}" placeholder="Una línea de resumen (se ve en la lista)">
      <div class="kb-edbar"><span class="kb-edgrp">${tb}</span><span class="kb-edgrp"><label class="btn sm" title="Captura o foto"><input type="file" accept="image/*" multiple hidden data-kimg>Imagen</label><button type="button" class="btn sm" data-kbins="steps">Paso a paso</button><button type="button" class="btn sm" data-kbins="video">Video</button><button type="button" class="btn sm" data-kbins="quiz">Pregunta</button></span></div>
      <div id="kbEdBody" class="kb-body kb-edbody" contenteditable="true" spellcheck="true" data-placeholder="Escribí acá. Seleccioná texto para darle formato; pegá o arrastrá capturas donde quieras.">${kbEditBodyHTML(a.body)}</div>
      <div class="kb-bubble" id="kbBub" hidden>${tb}</div>
    </div>
    <aside class="kb-edside card"><h4>${kbE.id?'Editar':'Nuevo artículo'}</h4>
      <label class="fld"><span>Categoría</span><select id="kbEdC"><option value="">Sin categoría</option>${c.map(x=>`<option value="${esc(x.id)}"${a.category_id===x.id?' selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="fld"><span>Estado</span><select id="kbEdP"><option value="1"${a.published?' selected':''}>Publicado</option><option value="0"${a.published?'':' selected'}>Borrador (solo lo ven los que escriben)</option></select></label>
      <label class="fld"><span>Paso de "Tus primeros días" <small class="dim">(vacío: no está en la ruta)</small></span><input type="number" id="kbEdR" min="1" max="99" value="${a.ruta||''}" placeholder="—"></label>
      ${isAdmin()?`<label class="chk"><input type="checkbox" id="kbEdG"${a.global?' checked':''}>Para todas las mesas</label>`:''}
      <div class="ebox" id="kbEdE"></div>
      <div class="kb-edacts"><button type="button" class="btn pri" data-kbed="save">Guardar</button><button type="button" class="btn" data-kbed="cancel">Cancelar</button>${kbE.id?`<button type="button" class="btn danger" data-kbed="del">Borrar</button>`:''}</div>
      <p class="note">Pegá capturas con Ctrl+V donde quieras. "Paso a paso" arma una galería con un paso por captura. Un link de YouTube o Loom pegado solo queda como video.</p></aside></div>`;
}
// el HTML guardado → el editor: las galerías, las preguntas y los videos se vuelven editables
function kbEditBodyHTML(body){
  const t=document.createElement('template');t.innerHTML=kbClean(body);const rep=(d,html)=>{const w=document.createElement('template');w.innerHTML=html;d.replaceWith(w.content)};
  [...t.content.querySelectorAll('div.kb-steps')].forEach(d=>rep(d,kbStepsEdHTML(kbFigs(d))));
  [...t.content.querySelectorAll('div.kb-quiz')].forEach(d=>{const {q,opts,ok}=kbQuizOf(d);rep(d,kbQuizEdHTML(q,opts,ok))});
  [...t.content.querySelectorAll('div.kb-vid')].forEach(d=>rep(d,kbVidEdHTML(d.dataset.url||'')));
  const w=document.createElement('div');w.appendChild(t.content);return w.innerHTML.trim()||'<p><br></p>';
}
const kbStepEdHTML=(s,j)=>`<figure data-j="${j}"><span class="kb-on">${j+1}</span><div class="kb-stimg">${s.img?`<img data-kbimg="${esc(s.img)}" alt="">`:'<span class="dim">Sin captura</span>'}<label class="btn sm"><input type="file" accept="image/*" hidden data-ksimg>${s.img?'Cambiar':'Subir captura'}</label></div><figcaption contenteditable="true" data-placeholder="Qué hacer en este paso">${kbClean(s.txt)}</figcaption><span class="kb-stb"><button type="button" class="ib" data-ksmv="up" title="Subir">▲</button><button type="button" class="ib" data-ksmv="down" title="Bajar">▼</button><button type="button" class="ib del" data-ksdel title="Sacar el paso">✕</button></span></figure>`;
const kbStepsEdHTML=its=>`<div class="kb-steps kb-w" contenteditable="false"><div class="kb-wh"><b>Paso a paso</b><span class="grow"></span><button type="button" class="ib del" data-kwdel title="Sacar la galería">✕</button></div><div class="kb-stl">${(its.length?its:[{txt:'',img:null}]).map(kbStepEdHTML).join('')}</div><button type="button" class="btn sm" data-ksadd>Agregar paso</button></div>`;
const kbQuizOptEd=o=>`<li><button type="button" class="ib" data-kqok title="Es la correcta">✓</button><span contenteditable="true" data-placeholder="Opción">${esc(o)}</span><button type="button" class="ib del" data-kqdel title="Sacar">✕</button></li>`;
const kbQuizEdHTML=(q,opts,ok)=>`<div class="kb-quiz kb-w" contenteditable="false" data-ok="${ok|0}"><div class="kb-wh"><b>Pregunta</b><span class="dim">marcá la correcta con ✓</span><span class="grow"></span><button type="button" class="ib del" data-kwdel title="Sacar la pregunta">✕</button></div><p class="kb-qq" contenteditable="true" data-placeholder="La pregunta">${esc(q)}</p><ul>${(opts.length?opts:['','']).map((o,j)=>kbQuizOptEd(o).replace('<li>',j===(ok|0)?'<li class="ok">':'<li>')).join('')}</ul><button type="button" class="btn sm" data-kqadd>Agregar opción</button></div>`;
const kbVidEdHTML=url=>`<div class="kb-vid kb-w" contenteditable="false" data-url="${esc(url)}"><div class="kb-wh"><b>Video</b><span class="dim">${esc(url)}</span><span class="grow"></span><button type="button" class="ib del" data-kwdel title="Sacar el video">✕</button></div>${kbVideo(url)}</div>`;
function kbEditWire(){
  const root=$('#kbEdit'),ed=$('#kbEdBody'),bub=$('#kbBub');let savedRange=null;
  try{document.execCommand('defaultParagraphSeparator',false,'p')}catch(e){} // Enter hace párrafos, no divs
  const ensureId=async()=>{if(kbE.id)return kbE.id;const r=await Q(sb.from('kb_articles').insert({title:'Borrador',body:'',published:false}).select('id'));kbE.id=r[0].id;kbE.createdDraft=true;return kbE.id};
  const sel=()=>{const s=window.getSelection();return s&&s.rangeCount?s.getRangeAt(0):null};
  const inEd=r=>!!r&&ed.contains(r.commonAncestorContainer);
  const restore=()=>{if(savedRange){const s=window.getSelection();s.removeAllRanges();s.addRange(savedRange)}};
  const blockOf=r=>{let n=r&&r.startContainer;while(n&&n.parentNode!==ed)n=n.parentNode;return n};
  const insertHTML=html=>{ed.focus();restore();const r=sel(),t=document.createElement('template');t.innerHTML=html;const node=t.content.firstElementChild;
    const n=inEd(r)?blockOf(r):null;if(n)n.after(node);else ed.appendChild(node); // los widgets van entre párrafos, después del bloque donde está el cursor
    const p=document.createElement('p');p.innerHTML='<br>';node.after(p);kbHydrate(ed);kbE.dirty=true;
    const s=window.getSelection(),rr=document.createRange();rr.setStart(p,0);rr.collapse(true);s.removeAllRanges();s.addRange(rr);return node};
  const cmd=k=>{ed.focus();restore();const r=sel();
    if(k==='h2'||k==='h3'){const b=r&&(r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement),cur=b&&b.closest&&b.closest('h2,h3');document.execCommand('formatBlock',false,cur&&cur.localName===k?'p':k)}
    else if(k==='bold'||k==='italic'||k==='underline')document.execCommand(k);
    else if(k==='ul')document.execCommand('insertUnorderedList');else if(k==='ol')document.execCommand('insertOrderedList');
    else if(k==='link'){const a=r&&r.startContainer.parentElement&&r.startContainer.parentElement.closest('a'),u=prompt('Dirección del link (https://…)',a?a.href:'https://');if(u==null)return;if(!u||u==='https://')document.execCommand('unlink');else if(/^https?:\/\//.test(u))document.execCommand('createLink',false,u)}
    else if(k==='av'){const b=r&&(r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement),cur=b&&b.closest&&b.closest('.kb-av');
      if(cur){const p=document.createElement('p');p.innerHTML=cur.innerHTML;cur.replaceWith(p)}else{const n=blockOf(r);if(n&&n.nodeType===1&&(n.localName==='p'||(n.localName==='div'&&!n.className))){const d=document.createElement('div');d.className='kb-av';d.innerHTML=kbText(n.innerHTML)?n.innerHTML:'Aviso';n.replaceWith(d)}else insertHTML('<div class="kb-av">Aviso</div>')}}
    kbE.dirty=true;bubble()};
  const bubble=()=>{const r=sel();if(!r||r.collapsed||!inEd(r)||r.startContainer.parentElement&&r.startContainer.parentElement.closest('.kb-w')){bub.hidden=true;return}
    const rc=r.getBoundingClientRect(),pr=root.getBoundingClientRect();if(!rc.width&&!rc.height){bub.hidden=true;return}
    bub.hidden=false;bub.style.left=Math.max(8,rc.left-pr.left+rc.width/2-bub.offsetWidth/2)+'px';bub.style.top=(rc.top-pr.top-bub.offsetHeight-8)+'px';
    bub.querySelectorAll('[data-kbcmd]').forEach(b=>{const k=b.dataset.kbcmd;b.classList.toggle('on',['bold','italic','underline'].includes(k)?document.queryCommandState(k):false)})};
  const onSel=()=>{if(!document.body.contains(ed)){document.removeEventListener('selectionchange',onSel);return}const r=sel();if(inEd(r))savedRange=r.cloneRange();bubble()};
  document.addEventListener('selectionchange',onSel);
  ed.addEventListener('input',()=>{kbE.dirty=true;if(!ed.textContent.trim()&&!ed.querySelector('img,.kb-w'))ed.innerHTML='<p><br></p>'});
  ed.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.closest('figcaption,.kb-qq,li>span')&&!e.target.closest('figcaption')){e.preventDefault();return}
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey){const k=e.key.toLowerCase();if(k==='b'){e.preventDefault();cmd('bold')}else if(k==='i'){e.preventDefault();cmd('italic')}else if(k==='u'){e.preventDefault();cmd('underline')}else if(k==='k'){e.preventDefault();cmd('link')}}});
  const upImgs=async(files,at)=>{const fs=[...files].filter(f=>/^image\//.test(f.type)).slice(0,10);if(!fs.length)return;
    try{const aid=await ensureId();for(const f of fs){const id=await kbUpload(aid,f);if(at)at(id);else insertHTML(`<p><img data-kbimg="${id}" alt=""></p>`)}kbHydrate(ed);kbE.dirty=true}catch(err){toast(esc(errMsg(err)),'err')}};
  ed.addEventListener('paste',e=>{const fs=e.clipboardData&&e.clipboardData.files;if(fs&&fs.length){e.preventDefault();upImgs(fs);return}
    const txt=e.clipboardData?e.clipboardData.getData('text/plain'):'';if(e.clipboardData){e.preventDefault();
      if(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|loom\.com)\/\S+$/.test(txt.trim())){insertHTML(kbVidEdHTML(txt.trim()));return}
      document.execCommand('insertText',false,txt)}});
  ed.addEventListener('drop',e=>{const fs=e.dataTransfer&&e.dataTransfer.files;if(fs&&fs.length){e.preventDefault();upImgs(fs)}});
  ed.addEventListener('dragover',e=>{if(e.dataTransfer&&[...e.dataTransfer.types].includes('Files'))e.preventDefault()});
  root.addEventListener('mousedown',e=>{if(e.target.closest('[data-kbcmd]'))e.preventDefault()}); // que la barrita no robe la selección
  root.addEventListener('click',async e=>{
    const c=e.target.closest('[data-kbcmd]');if(c){cmd(c.dataset.kbcmd);return}
    const ins=e.target.closest('[data-kbins]');if(ins){const k=ins.dataset.kbins;
      if(k==='steps')insertHTML(kbStepsEdHTML([]));else if(k==='quiz')insertHTML(kbQuizEdHTML('',[],0));
      else if(k==='video'){const u=prompt('Link del video (YouTube o Loom)','https://');if(u&&/^https?:\/\/.+/.test(u))insertHTML(kbVidEdHTML(u.trim()))}return}
    const w=e.target.closest('.kb-w');
    if(e.target.closest('[data-kwdel]')&&w){w.remove();kbE.dirty=true;return}
    if(w&&w.classList.contains('kb-steps')){const f=e.target.closest('figure'),L=w.querySelector('.kb-stl');
      const renum=()=>{[...L.children].forEach((x,j)=>{x.dataset.j=j;x.querySelector('.kb-on').textContent=j+1})};
      if(e.target.closest('[data-ksadd]')){L.insertAdjacentHTML('beforeend',kbStepEdHTML({txt:'',img:null},L.children.length));kbE.dirty=true;return}
      if(e.target.closest('[data-ksdel]')&&f){f.remove();renum();kbE.dirty=true;return}
      const mv=e.target.closest('[data-ksmv]');if(mv&&f){const o=mv.dataset.ksmv==='up'?f.previousElementSibling:f.nextElementSibling;if(o){mv.dataset.ksmv==='up'?o.before(f):o.after(f);renum();kbE.dirty=true}return}}
    if(w&&w.classList.contains('kb-quiz')){const li=e.target.closest('li');
      if(e.target.closest('[data-kqadd]')){w.querySelector('ul').insertAdjacentHTML('beforeend',kbQuizOptEd(''));kbE.dirty=true;return}
      if(e.target.closest('[data-kqdel]')&&li){li.remove();kbE.dirty=true;return}
      if(e.target.closest('[data-kqok]')&&li){[...w.querySelectorAll('li')].forEach((x,j)=>{x.classList.toggle('ok',x===li);if(x===li)w.dataset.ok=j});kbE.dirty=true;return}}
    const act=e.target.closest('[data-kbed]');if(!act)return;
    if(act.dataset.kbed==='cancel'){if(kbE.dirty&&!await confirmar('Salir sin guardar','¿Salís sin guardar los cambios?','Salir',true))return;await kbEditClose();return}
    if(act.dataset.kbed==='del'){const a=kbArt(kbE.id);if(!a)return;if(!await confirmar('Borrar artículo',`¿Borrar <b>${esc(a.title)}</b> con sus capturas?`,'borrar',true))return;try{await Q(sb.from('kb_articles').delete().eq('id',a.id));kbE=null;kbMode='home';await kbLoad(true);toast('Artículo borrado.')}catch(err){toast(esc(errMsg(err)),'err')}return}
    if(act.dataset.kbed==='save')await kbEditSave();
  });
  root.addEventListener('change',async e=>{
    const ki=e.target.closest('[data-kimg]');if(ki&&ki.files.length){await upImgs(ki.files);ki.value='';return}
    const si=e.target.closest('[data-ksimg]');if(si&&si.files[0]){const f=si.closest('figure');await upImgs([si.files[0]],id=>{f.querySelector('.kb-stimg').innerHTML=`<img data-kbimg="${id}" alt=""><label class="btn sm"><input type="file" accept="image/*" hidden data-ksimg>Cambiar</label>`});kbHydrate(ed)}
  });
}
// lo del editor → HTML limpio para guardar (sin botones ni src de las fotos; galerías, preguntas y videos en su forma guardada)
function kbEditSerialize(){
  const ed=$('#kbEdBody');if(!ed)return '';const c=ed.cloneNode(true);
  c.querySelectorAll('.kb-steps').forEach(w=>{const d=document.createElement('div');d.className='kb-steps';d.innerHTML=[...w.querySelectorAll('figure')].map(f=>{const im=f.querySelector('img[data-kbimg]');return `<figure>${im?`<img data-kbimg="${esc(im.dataset.kbimg)}" alt="">`:''}<figcaption>${(f.querySelector('figcaption')||{}).innerHTML||''}</figcaption></figure>`}).join('');w.replaceWith(d)});
  c.querySelectorAll('.kb-quiz').forEach(w=>{const d=document.createElement('div');d.className='kb-quiz';d.dataset.ok=w.dataset.ok||'0';d.innerHTML=`<p class="kb-qq">${esc((w.querySelector('.kb-qq')||{}).textContent||'')}</p><ul>${[...w.querySelectorAll('li span')].map(s=>`<li>${esc(s.textContent.trim())}</li>`).join('')}</ul>`;w.replaceWith(d)});
  c.querySelectorAll('.kb-vid').forEach(w=>{const d=document.createElement('div');d.className='kb-vid';d.dataset.url=w.dataset.url||'';w.replaceWith(d)});
  c.querySelectorAll('img').forEach(im=>{im.removeAttribute('src')});
  c.querySelectorAll('[contenteditable],[data-placeholder]').forEach(x=>{x.removeAttribute('contenteditable');x.removeAttribute('data-placeholder')});
  return kbClean(c.innerHTML);
}
async function kbEditSave(){
  const title=$('#kbEdT').value.trim();if(!title){$('#kbEdE').textContent='Poné el título.';return}
  const row={title:title.slice(0,120),summary:$('#kbEdS').value.trim().slice(0,300)||null,body:kbEditSerialize(),category_id:$('#kbEdC').value||null,published:$('#kbEdP').value==='1',ruta:+$('#kbEdR').value||null,global:!!($('#kbEdG')&&$('#kbEdG').checked),updated_by:me,updated_at:new Date().toISOString()};
  try{if(kbE.id)await Q(sb.from('kb_articles').update(row).eq('id',kbE.id));else{const r=await Q(sb.from('kb_articles').insert(row).select('id'));kbE.id=r[0].id}
    const id=kbE.id;kbE=null;kbMode='art';await kbLoad(true);kbGo('art',id);toast(row.published?`<b>${esc(title)}</b> publicado.`:`<b>${esc(title)}</b> guardado como borrador.`)}
  catch(e){toast(esc(errMsg(e)),'err')}
}
async function kbEditClose(){ // cancelar: si se creó el borrador solo para subir capturas y no se guardó, se borra
  if(kbE&&kbE.createdDraft){try{await Q(sb.from('kb_articles').delete().eq('id',kbE.id))}catch(e){}}
  const back=kbE&&kbE.a&&kbE.a.id?['art',kbE.a.id]:kbCat?['cat',kbCat]:['home'];kbE=null;kbMode=back[0];await kbLoad(true);kbGo(...back);
}
