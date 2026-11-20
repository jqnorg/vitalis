/* ---------- compartir datos en el chat, y avisos del team leader o un administrador ---------- */
// Cada tarjeta de datos tiene su botón Compartir: al chat va una foto de la tarjeta tal como se ve, con la hora, sin botones ni formularios.
// El team leader y los administradores la pueden mandar como aviso: a todos los del chat les queda hasta que lo cierren, aunque lo tengan silenciado.
const SH_VIEWS=new Set(['inicio','sueldo','turnos','ahora','clientes','ventas','filtros','radar','equipo','cliente','banking']);
const SH_SEL='.card,.hero,.fi-c';
const SH_HTML=new Set('div span p b i small br h2 h3 h4 h5 ul ol li table thead tbody tfoot tr th td section header footer details summary mark sub sup kbd s u'.split(' '));
const SH_SVG=new Set('svg g path rect circle ellipse line polyline polygon text tspan use title'.split(' '));
const SH_CONV={button:'span',a:'span',label:'span',time:'span',strong:'b',em:'i',figure:'div',figcaption:'div',nav:'div',aside:'div',article:'div',main:'div',dl:'div',dt:'div',dd:'div',output:'span',abbr:'span',code:'span',q:'span',cite:'span'};
const SH_DROP=new Set('script style iframe object embed form input select textarea option optgroup img picture source video audio canvas link meta noscript template datalist dialog frame frameset base math'.split(' '));
const SH_ATTR=new Set('class title colspan rowspan open viewBox d x y x1 y1 x2 y2 dx dy cx cy r rx ry width height fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-opacity fill-opacity points transform text-anchor dominant-baseline font-size font-weight opacity preserveAspectRatio aria-hidden aria-label role'.split(' '));
const SH_CSS=new Set('width height min-width max-width min-height max-height flex flex-grow flex-shrink flex-basis grid-column grid-row grid-template-columns background-color background-image color opacity border-color border-left-color border-top-color border-bottom-color text-align font-weight aspect-ratio margin-left padding-left left right top bottom transform'.split(' '));
function shCss(s){ // solo lo que hace falta para barras y colores: nada de url(), posiciones fijas ni capas
  const d=document.createElement('div');d.setAttribute('style',s);const o=[];
  for(let i=0;i<d.style.length;i++){const p=d.style[i],v=d.style.getPropertyValue(p).trim();
    if(!(SH_CSS.has(p)||/^--[a-z0-9-]+$/i.test(p))||!v||/url\s*\(|expression|javascript:|@import|\\|<|>/i.test(v))continue;o.push(p+':'+v)}
  return o.join(';');
}
// limpia el HTML de una tarjeta (al mandarla y otra vez al mostrarla: no se confía en lo guardado)
function shClean(html){
  const t=document.createElement('template');t.innerHTML=String(html||'');
  const SVGNS='http://www.w3.org/2000/svg';
  const fix=el=>{
    for(const c of [...el.children]){
      const svg=c.namespaceURI===SVGNS,tag=svg?c.localName:c.localName.toLowerCase();
      if(svg?!SH_SVG.has(tag):SH_DROP.has(tag)){c.remove();continue}
      let x=c;
      if(!svg&&!SH_HTML.has(tag)){ // lo demás pasa a un span o un div con lo de adentro
        x=document.createElement(SH_CONV[tag]||'span');
        for(const a of c.attributes)x.setAttribute(a.name,a.value);
        while(c.firstChild)x.appendChild(c.firstChild);c.replaceWith(x);
      }
      for(const a of [...x.attributes]){
        const n=a.name;
        if(n==='style'){const v=shCss(a.value);if(v)x.setAttribute('style',v);else x.removeAttribute('style');continue}
        if(n==='href'||n==='xlink:href'){if(!(svg&&tag==='use'&&/^#(i-[a-z0-9-]+|mate)$/i.test(a.value)))x.removeAttribute(n);continue}
        if(n==='data-av'){if(!/^[0-9a-f-]{36}$/i.test(a.value))x.removeAttribute(n);continue} // la foto de alguien de la mesa: se pone al mostrarla
        if(!SH_ATTR.has(n))x.removeAttribute(n);
      }
      fix(x);
    }
  };
  fix(t.content);return t.innerHTML;
}
// la foto de la tarjeta: lo que se ve (lo escondido no va; lo de un desplegable cerrado sí, cerrado)
function shSnap(el,rows=30){
  const rev=new Map();for(const id in avatars){const a=avatars[id];if(a&&a.url)rev.set(a.url,id)}
  const skip=new Set(['script','style','input','select','textarea','form','template','canvas','video','audio','iframe','datalist','dialog']);
  const cp=(n,out,inDet)=>{
    for(const c of n.childNodes){
      if(c.nodeType===3){out.appendChild(document.createTextNode(c.nodeValue));continue}
      if(c.nodeType!==1||skip.has(c.localName)||(c.matches&&c.matches('.sh-btn,.btn,.hb,button[data-act],a[data-act]'))||c.hasAttribute('data-noshare'))continue; // los botones de acción no van
      const det=inDet||(n.localName==='details'&&!n.open&&c.localName!=='summary');
      if(!det&&c.localName!=='br'&&!c.getClientRects().length)continue; // no se ve
      if(c.classList&&c.classList.contains('av')&&c.classList.contains('pic')){ // foto de perfil: va quién es, no la foto
        const img=c.querySelector('img'),uid=img&&rev.get(img.getAttribute('src')),s=document.createElement('span');
        s.className=String(c.className).replace(/\bpic\b/,'').trim();
        if(uid){const nm=memberName(uid);s.dataset.av=uid;s.style.setProperty('--h',avHue(nm));s.textContent=initials(nm)}
        out.appendChild(s);continue;
      }
      const k=c.cloneNode(false);out.appendChild(k);cp(c,k,det);
    }
  };
  const root=el.cloneNode(false);root.classList.remove('sh-abs');cp(el,root,false);
  for(const tb of root.querySelectorAll('tbody')){const L=[...tb.children];if(L.length>rows){L.slice(rows).forEach(r=>r.remove());
    tb.insertAdjacentHTML('beforeend',`<tr><td colspan="99" class="d">… y ${L.length-rows} más</td></tr>`)}}
  return shClean(root.outerHTML);
}
// pone la foto de cada uno donde la tarjeta compartida nombra a alguien de la mesa
function shAvatars(root){for(const s of root.querySelectorAll('[data-av]')){const nm=memberName(s.dataset.av);if(nm&&nm!=='—')s.outerHTML=avatar(nm,String(s.className).replace(/\bav\b/,'').trim())}}
const shTitle=el=>{
  const h=el.querySelector(':scope > .card-h h3,:scope > .card-h h2');
  let t=(h&&h.textContent)||el.getAttribute('aria-label')||((el.querySelector('h3,h4,h2')||{}).textContent)||(VTITLE[cur]||'Datos');
  t=String(t).replace(/\s+/g,' ').trim();
  if(cur==='cliente'&&curCl&&!t.includes(curCl.id))t+=' · '+curCl.id;
  return clip(t,120);
};
const VTITLE={inicio:'Inicio',sueldo:'Sueldo',turnos:'Turnos',ahora:'Cola',clientes:'Campañas',ventas:'Ventas',filtros:'Filtros',radar:'Radar',equipo:'Equipo',cliente:'Cliente',banking:'Banking'};

// el botón Compartir en cada tarjeta de datos (se pone solo cuando una sección se dibuja)
function shMark(){
  if(!ready||!SH_VIEWS.has(cur))return;
  const v=document.getElementById('v-'+cur);if(!v||v.hidden)return;
  for(const el of v.querySelectorAll(SH_SEL)){
    if(el.hidden||!el.getClientRects().length||el.closest('.mbox')||el.parentElement.closest(SH_SEL)||el.querySelector(':scope > .sh-btn'))continue;
    if(el.matches('.wr,.turno-mini')||!el.textContent.trim())continue; // formularios y la franja del turno no
    const b=document.createElement('button');b.type='button';b.className='sh-btn';b.dataset.share='';b.title='Compartir en el chat';b.setAttribute('aria-label','Compartir en el chat');
    b.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-share"/></svg>';
    el.classList.add('sh-abs');el.appendChild(b); // arriba a la derecha, siempre en el mismo lugar
  }
}
let shRaf=0;
new MutationObserver(()=>{if(!shRaf)shRaf=requestAnimationFrame(()=>{shRaf=0;shMark()})}).observe(document.getElementById('main'),{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-share]');if(!b)return;e.preventDefault();e.stopPropagation();const el=b.closest(SH_SEL);if(el)shareModal(el)},true);

function shareModal(el){
  if(!chats.length){toast('El chat todavía no cargó. Probá en un ratito.','warn');return}
  let html=shSnap(el);if(html.length>90000)html=shSnap(el,10);
  if(html.length>90000){toast('Es demasiado grande para compartir. Filtrá un poco o compartí una parte.','warn');return}
  const title=shTitle(el),lead=isLeader();
  const L=[...chats].sort((a,b)=>(a.kind==='team'?0:a.kind==='group'?1:2)-(b.kind==='team'?0:b.kind==='group'?1:2)||chatName(a).localeCompare(chatName(b)));
  const body=`<div class="sh-prev"><div class="ch-card"><div class="chc-b">${html}</div><div class="chc-f">${esc(title)} · datos de las ${hhmm(Date.now())}</div></div></div>
    <div class="fgrid">
      <label class="fld full"><span>Dónde</span><select name="chat">${L.map(c=>`<option value="${esc(c.id)}">${esc(c.kind==='dm'?'Privado con '+first(dmOther(c)):chatName(c))}</option>`).join('')}</select></label>
      <label class="fld full"><span>Comentario <small class="dim">(opcional)</small></span><textarea name="txt" rows="2" maxlength="500" placeholder="Ej.: miren esta campaña"></textarea></label>
      ${lead?`<label class="sh-av"><input type="checkbox" name="aviso"><span><b><svg class="ic" aria-hidden="true"><use href="#i-campana"/></svg> Mandarlo como aviso</b><small>A todos los de ese chat les aparece un aviso que queda hasta que lo cierren, aunque lo tengan silenciado.</small></span></label>`:''}
    </div><div class="ebox" id="shE"></div>`;
  modal({title:'Compartir en el chat',wide:true,body,onOpen:api=>{shAvatars(api.box);
      if(lead){const cb=api.q('[name=aviso]'),go_=api.mf.querySelector('.pri');cb.onchange=()=>{go_.textContent=cb.checked?'Mandar aviso':'Compartir'}}},
    actions:[{l:'Cancelar'},{l:'Compartir',cls:'pri',fn:async api=>{
      const cid=api.q('[name=chat]').value,txt=api.q('[name=txt]').value.trim(),av=lead&&api.q('[name=aviso]')&&api.q('[name=aviso]').checked;
      const ok=await B.shareCard(cid,title,html,txt,av);if(!ok)return false;
      const c=chatOf(cid);toast(`${av?'Aviso mandado':'Compartido'} en ${esc(c?(c.kind==='dm'?'el privado con '+first(dmOther(c)):chatName(c)):'el chat')}.`,'ok',{actions:[{l:'Ver',fn:()=>go('chat',{chat:cid})}]});
    }}]});
}

Object.assign(B,{
  async shareCard(cid,title,html,txt,aviso){
    let k=null;
    try{
      [k]=await Q(sb.from('chat_cards').insert({chat_id:cid,title,html}).select('id,created_at'));
      cards[k.id]={html,at:+new Date(k.created_at)};
      const row={chat_id:cid,body:`[card:${k.id}] ${title}`+(txt?'\n'+txt.slice(0,1500):'')};if(aviso)row.aviso=true;
      const m=await Q(sb.from('messages').insert(row).select().single());msgIn(M2X(m));markRead(cid);return true;
    }catch(e){
      if(k)sb.from('chat_cards').delete().eq('id',k.id).then(()=>{},()=>{}); // el mensaje no salió: la foto no queda suelta
      if(/chat_cards|aviso|PGRST20[45]|42P01|42703/.test(String(e&&(e.message||e.code))))toast('Compartir se activa en un rato (falta actualizar la base).','warn');
      else toast(esc(errMsg(e)),/^SLOW/.test(String(e&&e.message||''))?'warn':'err');
      return false;
    }
  },
});
