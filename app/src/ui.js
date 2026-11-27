
/* ============================================================
   UI base: avisos, ventanas, tooltip, gráficos, navegación
   ============================================================ */
function toast(html,kind='ok',o={}){
  const box=$('#toasts');
  if(o.key){const ex=box.querySelector(`[data-key="${o.key}"]`);if(ex)ex.remove()}
  const t=document.createElement('div');t.className='toast '+kind;if(o.key)t.dataset.key=o.key;t.setAttribute('role',kind==='alert'||kind==='err'?'alert':'status');if(o.sticky)t.dataset.sticky=1;
  const m=document.createElement('div');m.className='tm';m.innerHTML=html;t.appendChild(m);
  let gone=false;const close=()=>{if(gone)return;gone=true;t.classList.add('out');setTimeout(()=>t.remove(),180)};
  if(o.actions&&o.actions.length){
    const a=document.createElement('div');a.className='ta';
    for(const x of o.actions){const b=document.createElement('button');b.type='button';b.className='btn sm';b.textContent=x.l;b.onclick=()=>{close();x.fn&&x.fn()};a.appendChild(b)}
    t.appendChild(a);
  }
  const xb=document.createElement('button');xb.className='tx';xb.type='button';xb.textContent='✕';xb.title='Cerrar';xb.onclick=close;t.appendChild(xb);
  box.appendChild(t);
  if(!o.sticky)setTimeout(close,o.ms||(kind==='err'?7000:kind==='warn'?6000:4200));
  const all=[...box.children].filter(x=>!x.classList.contains('alert')&&!x.classList.contains('imp')&&!x.dataset.sticky);while(all.length>3)all.shift().remove(); // los urgentes, importantes y fijos no se pierden
  return {close,el:t,set:h=>{m.innerHTML=h}};
}

let modals=[];
function modal({title,body,actions=[],onOpen,onClose,wide}){
  const ov=document.createElement('div');ov.className='ov';
  const box=document.createElement('div');box.className='mbox'+(wide?' wide':'');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
  box.innerHTML=`<div class="mh"><span class="mt">${title}</span><button type="button" class="tx" data-x aria-label="Cerrar">✕</button></div><div class="mb"></div><div class="mf"></div>`;
  const mb=box.querySelector('.mb'),mf=box.querySelector('.mf');
  if(typeof body==='string')mb.innerHTML=body;else if(body)mb.appendChild(body);
  const prevFocus=document.activeElement;
  let closed=false;
  const api={box,mb,mf,close(){if(closed)return;closed=true;ov.remove();modals=modals.filter(x=>x!==api);onClose&&onClose();try{prevFocus&&prevFocus.focus&&prevFocus.focus()}catch(e){}},q:s=>box.querySelector(s)};
  for(const a of actions){
    const b=document.createElement('button');b.type='button';b.className='btn'+(a.cls?' '+a.cls:'');b.textContent=a.l;if(a.id)b.id=a.id;
    b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{const r=a.fn?await a.fn(api,b):undefined;if(r!==false)api.close()}finally{b.disabled=false}};
    mf.appendChild(b);
  }
  box.querySelector('[data-x]').onclick=api.close;
  let downOnOv=false;
  ov.addEventListener('mousedown',e=>{downOnOv=e.target===ov});
  ov.addEventListener('click',e=>{if(e.target===ov&&downOnOv)api.close()});
  box.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();api.close()}
    else if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!['TEXTAREA','BUTTON','A'].includes(e.target.tagName)){const p=mf.querySelector('.pri');if(p){e.preventDefault();p.click()}}
  });
  ov.appendChild(box);document.body.appendChild(ov);modals.push(api);
  onOpen&&onOpen(api);
  setTimeout(()=>{ // el primer campo que se pueda usar (los plegados no toman el foco); si no hay, el botón principal
    for(const f of [box.querySelector('[autofocus]'),...box.querySelectorAll('.mb input:not([type=hidden]),.mb select,.mb textarea'),mf.querySelector('.pri')]){if(!f)continue;f.focus();if(document.activeElement===f)break}},0);
  return api;
}
function confirmar(title,html,okL='confirmar',danger){
  return new Promise(res=>{let ok=false;
    modal({title,body:`<p class="mp">${html}</p>`,actions:[{l:'cancelar'},{l:okL,cls:'pri'+(danger?' danger':''),fn:()=>{ok=true}}],onClose:()=>res(ok)});
  });
}

const tip=$('#tip');
function hideTip(){tip.hidden=true}
function showTip(x,y,title,rows){
  tip.textContent='';
  const t=document.createElement('div');t.className='tt';t.textContent=title;tip.appendChild(t);
  for(const r of rows){
    const d=document.createElement('div');d.className='tr';
    if(r.key){const k=document.createElement('i');k.className='key';k.style.background=r.key;d.appendChild(k)}
    const v=document.createElement('span');v.className='val';v.textContent=r.v;d.appendChild(v);
    const l=document.createElement('span');l.className='lab';l.textContent=r.l;d.appendChild(l);
    tip.appendChild(d);
  }
  tip.hidden=false;
  const w=tip.offsetWidth,h=tip.offsetHeight;
  let left=x+14,top=y-h-10;
  if(left+w>innerWidth-8)left=x-w-14;if(top<8)top=y+16;
  tip.style.left=left+'px';tip.style.top=top+'px';
}

/* gráfico de columnas: a (new / horas) y b (late) apiladas, línea de referencia opcional */
function niceStep(v){const p=Math.pow(10,Math.floor(Math.log10(v||1))),n=v/p;return (n<=1?1:n<=2?2:n<=5?5:10)*p}
function colPath(x,y,w,h,r){
  if(h<=0)return '';r=Math.min(r,h,w/2);
  return `M${x},${y+h}V${y+r}A${r},${r} 0 0 1 ${x+r},${y}H${x+w-r}A${r},${r} 0 0 1 ${x+w},${y+r}V${y+h}Z`;
}
function colChart(el,data,o={}){
  el.textContent='';hideTip();
  if(!data.length||!data.some(d=>d.a+d.b>0)){el.innerHTML=`<div class="p-empty">${esc(o.empty||'Sin datos.')}</div>`;return}
  const W=Math.max(300,el.clientWidth||800),H=o.h||220,m={t:24,r:8,b:30,l:38},iw=W-m.l-m.r,ih=H-m.t-m.b;
  const max=Math.max(1e-9,...data.map(d=>d.a+d.b),o.ref||0,o.minTop||0),st=o.int?Math.max(1,niceStep(max/4)):niceStep(max/4),top=Math.ceil(max/st-1e-9)*st;
  const y=v=>m.t+ih-(v/top)*ih,band=iw/data.length,bw=Math.max(3,Math.min(26,band*.62));
  const fmt=o.fmt||(v=>String(v));
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width',W);svg.setAttribute('height',H);svg.setAttribute('role','img');svg.setAttribute('aria-label',o.label||'gráfico');
  const grid=getComputedStyle(document.body).getPropertyValue('--dim').trim()||'#5b685f';
  let s='';
  for(let v=0;v<=top+1e-9;v+=st){
    s+=`<line x1="${m.l}" x2="${W-m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${grid}" stroke-opacity="${v?0.18:0.45}" stroke-width="1" shape-rendering="crispEdges"/>`;
    s+=`<text x="${m.l-8}" y="${y(v)+3.5}" text-anchor="end" font-size="11" fill="${grid}" style="font-variant-numeric:tabular-nums">${esc(o.fmtY?o.fmtY(v):nf(v,st<1?1:0))}</text>`;
  }
  const lblEvery=o.every||(band>=30?1:band>=16?2:band>=9?3:6),capAll=band>=(o.capMin||22),tot=data.map(d=>d.a+d.b),mx=Math.max(...tot),maxI=tot.indexOf(mx);
  data.forEach((d,i)=>{
    const x=m.l+i*band+(band-bw)/2,hA=d.a/top*ih,hB=d.b/top*ih,gap=d.a&&d.b?2:0;
    let g=`<g class="col" data-i="${i}">`;
    if(d.a)g+=`<path d="${d.b?`M${x},${y(0)}V${y(0)-hA}H${x+bw}V${y(0)}Z`:colPath(x,y(0)-hA,bw,hA,4)}" style="fill:${d.ca||'var(--s1)'}"/>`;
    if(d.b)g+=`<path d="${colPath(x,y(0)-hA-gap-hB,bw,hB,4)}" style="fill:${o.cb||'var(--s2)'}"/>`;
    s+=g+'</g>';
    const v=d.a+d.b;
    if(v&&(capAll||i===maxI||(o.capLast!==false&&i===data.length-1)))s+=`<text x="${x+bw/2}" y="${y(v)-gap-5}" text-anchor="middle" font-size="11" style="fill:var(--fg);font-variant-numeric:tabular-nums">${esc(fmt(v))}</text>`;
    if(i%lblEvery===0||i===data.length-1)s+=`<text x="${m.l+i*band+band/2}" y="${H-m.b+15}" text-anchor="middle" font-size="11" fill="${d.labC||grid}">${esc(d.lab)}</text>`;
  });
  if(o.ref){s+=`<line x1="${m.l}" x2="${W-m.r}" y1="${y(o.ref)}" y2="${y(o.ref)}" style="stroke:var(--fg)" stroke-opacity=".6" stroke-dasharray="4 4" stroke-width="1" shape-rendering="crispEdges"/>`;
    if(o.refLab)s+=`<text x="${W-m.r}" y="${y(o.ref)-5}" text-anchor="end" font-size="11" style="fill:var(--fg)" fill-opacity=".8">${esc(o.refLab)}</text>`}
  svg.innerHTML=s;el.appendChild(svg);
  const cols=[...svg.querySelectorAll('.col')];let hot=-1;
  svg.addEventListener('pointermove',e=>{
    const r=svg.getBoundingClientRect(),i=Math.floor((e.clientX-r.left-m.l)/band);
    if(i<0||i>=data.length){hideTip();return}
    if(i!==hot){if(hot>=0&&cols[hot])cols[hot].classList.remove('hot');hot=i;cols[i]&&cols[i].classList.add('hot')}
    const t=o.tip(data[i]);showTip(e.clientX,e.clientY,t.title,t.rows);
  });
  svg.addEventListener('pointerleave',()=>{hideTip();if(hot>=0&&cols[hot])cols[hot].classList.remove('hot');hot=-1});
}

/* ---------- navegación ---------- */
const VIEWS=['gerencia','home','inicio','historial','banking','bkprocs','bkbancos','kb','ventas','clientes','campanas','agenda','turnos','sueldo','snippets','chat','social','config','equipo','tareas','filtros','radar'];
let cur='home';
const V={}; // vistas: {build(), render()}
// el menú: pocas secciones; las que tienen varias partes, con solapas arriba (recuerda la última que usaste)
function cliBadge(){const c=$('#nbCli');if(c){c.textContent=curCl?curCl.id:'';c.title=curCl?'Cliente actual: '+(curCl.name||curCl.id):''}} // el cliente actual, en el botón del menú
// el menú (27/11/2026, lo definió el dueño): home · yo (rendimiento · turnos · agenda · sueldo) · la mesa (rendimiento · campañas · tareas) · chat · banking · knowledgebase
const GROUPS=[
  {g:'home',views:['home']}, // lo de hoy, tuyo y de la mesa: para hacer ahora, el turno, la mesa hoy y (team leader/admin) para atender ya
  {g:'rend',views:['inicio','historial'],tabs:['tu mes','historial']}, // yo → rendimiento
  {g:'turnos',views:['turnos']},
  {g:'agenda',views:['agenda']},
  {g:'sueldo',views:['sueldo']},
  {g:'mesa',views:['equipo','gerencia','ventas','clientes','filtros','radar'],tabs:['la mesa','gerencia','ventas','clientes','filtros','radar'],def:'equipo'}, // la mesa → rendimiento (equipo, gerencia y clientes son de team leader y admin)
  {g:'campanas',views:['campanas']},
  {g:'tareas',views:['tareas']},
  {g:'chat',views:['chat','social'],tabs:['chat','mate y toques']},
  {g:'banking',views:['banking','bkprocs','bkbancos'],tabs:['¿cómo paga el cliente?','procesadores','bancos'],def:'banking'},
  {g:'kb',views:['kb']},
  {g:'gerencia',views:['gerencia']}, // el director solo ve esto (su botón propio)
  {g:'ajustes',views:['config','snippets'],tabs:['ajustes','snippets']},
];
// lo del menú que depende del rol: Equipo y el Manager (team leader y admin); el team leader no tiene Cliente (no tiene clientes)
function navRoles(){$('#navGer').hidden=!isDirector();document.body.classList.toggle('dir',isDirector());$('#navMesa').dataset.v=isLeader()?'equipo':'ventas';$('#navSueldo').hidden=tlView();const t=$('#navMesaT');if(t)t.textContent=teamInfo?teamInfo.name:'la mesa'}
const groupOf=v=>GROUPS.find(G=>G.views.includes(v))||GROUPS[0];
let lastTab=local.get('tabs',{});
function goGroup(g){const G=GROUPS.find(x=>x.g===g);if(!G)return;const v=lastTab[g];go(G.views.includes(v)?v:G.def||G.views[0])}
const NAVKEYS={1:'home',2:'agenda',3:'tareas',4:'chat',5:'banking',6:'kb',7:'mesa',0:'ajustes'}; // grupos; letras: L Cliente, B Banking, T Tareas, C Chat, F Filtros, E Equipo (Cliente es la L)
function go(v,opts){
  pass++;
  if(!VIEWS.includes(v)||(v==='equipo'&&!isLeader())||(v==='gerencia'&&!isMgmt()))v=VIEWS.includes(v)&&v!=='gerencia'?'ventas':'home';
  if(v==='callman')v='home'; // el Manager vive en home
  if(isDirector()&&v!=='gerencia'&&v!=='config')v='gerencia'; // el director solo ve Gerencia (y sus Ajustes)
  if(v==='clientes'&&!isLeader())v='campanas'; // la solapa Clientes es del team leader (y el admin)
  if(v!=='chat'&&typeof chatPadOff==='function')chatPadOff(); // el teclado del PIN del chat no se queda escuchando en otra sección
  cur=v;hideTip();document.body.dataset.view=v;
  $$('.view').forEach(s=>s.hidden=s.id!=='v-'+v);
  const G=groupOf(v);lastTab[G.g]=v;local.set('tabs',lastTab);
  $$('#nav [data-g]').forEach(b=>{const on=b.dataset.g===G.g;b.classList.toggle('on',on);if(on){b.dataset.v=v;b.setAttribute('aria-current','page')}else b.removeAttribute('aria-current')});
  {const a=$('#navAjustes');if(a)a.classList.toggle('on',G.g==='ajustes')}
  const sn=$('#subnav'),tabs=G.views.filter(x=>((x!=='equipo'&&x!=='clientes')||isLeader())&&(x!=='gerencia'||isMgmt()));sn.hidden=tabs.length<2;
  sn.innerHTML=tabs.length<2?'':tabs.map((x,i)=>`<button type="button" role="tab" data-tab="${x}" aria-selected="${x===v}"${x===v?' class="on"':''}>${esc(G.tabs[G.views.indexOf(x)])}</button>`).join('');
  try{if(location.hash!=='#'+v)history.replaceState(null,'','#'+v)}catch(e){}
  $('#main').scrollTop=0;
  if(ready){V[v].render(opts||{});hoyBand();lowerize($('#main'))}
}
// todo en minúscula salvo las siglas (el dueño, 27/11/2026): baja las palabras que empiezan con mayúscula seguida de minúscula ("New" → "new", "Joaquín" → "joaquín");
// lo que es todo mayúsculas (FTD, CR, RMO, ID, USD, FB-01, PIN) queda. No toca lo que escribe la gente: chat, snippets, guías, comentarios, campos.
const LOW_SKIP='input,textarea,select,option,datalist,[contenteditable],pre,code,.ch-m,.ch-pv,.sn .bd,.kb-body,.kb-edmain,.chc-b,.fi-cm,.keep,script,style';
const LOW_RE=/(^|[^\p{L}\p{N}])(\p{Lu})(\p{Ll}+)/gu;
function lowerize(root){
  if(!root)return;
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>{const p=n.parentElement;return p&&!p.closest(LOW_SKIP)&&/\p{Lu}\p{Ll}/u.test(n.nodeValue)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT}});
  const l=[];while(w.nextNode())l.push(w.currentNode);
  for(const n of l){const v=n.nodeValue.replace(LOW_RE,(m,a,b,c)=>a+b.toLowerCase()+c);if(v!==n.nodeValue)n.nodeValue=v}
  for(const el of root.querySelectorAll?root.querySelectorAll('[title],[placeholder],[aria-label]'):[])for(const at of ['title','placeholder','aria-label']){const v=el.getAttribute(at);if(v&&/\p{Lu}\p{Ll}/u.test(v)&&!el.closest(LOW_SKIP))el.setAttribute(at,v.replace(LOW_RE,(m,a,b,c)=>a+b.toLowerCase()+c))}
}
// lo que aparece después (avisos, modales, lo que se redibuja) también baja, en el mismo microtask de la mutación, antes de pintar: si no, el texto "tiembla" (se vio el 27/11)
new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes){if(!n.isConnected)continue;if(n.nodeType===1)lowerize(n);else if(n.nodeType===3&&n.parentElement)lowerize(n.parentElement)}}).observe(document.documentElement,{childList:true,subtree:true});
let rT=null;
// con la pestaña escondida no se dibuja la sección (nadie la ve): se dibuja al volver. La barra y la extensión sí se actualizan.
let rDirty=false;
// lo que estaba desplegado sigue desplegado después de volver a dibujar
const openKeys=el=>new Set([...el.querySelectorAll('details[data-k][open]')].map(d=>d.dataset.k));
function reopen(el,keys){if(keys.size)for(const d of el.querySelectorAll('details[data-k]'))if(keys.has(d.dataset.k))d.open=true}
function refresh(){clearTimeout(rT);rT=setTimeout(()=>{pass++;if(!ready)return status();status();if(document.hidden)rDirty=true;else{rDirty=false;V[cur].render({})}syncExt();dockSoon()},60)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&rDirty&&ready){rDirty=false;V[cur].render({})}});

/* ---------- barra de estado ---------- */
const avHue=s=>{let h=0;for(const c of String(s||''))h=(h*31+c.charCodeAt(0))%360;return h};
const initials=n=>String(n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
const avatar=(name,cls='')=>{const m=members.find(x=>x.name===name)||(botU&&botU.name===name?botU:null),a=m&&avatars[m.id]; // con foto, si la subió (Vitalis también)
  return a?`<span class="av pic ${cls}" aria-hidden="true"><img src="${a.url}" alt=""></span>`:`<span class="av ${cls}" style="--h:${avHue(name)}" aria-hidden="true">${esc(initials(name))}</span>`};
const roleTxt=r=>r==='admin'?'Administrador':r==='leader'?'Team leader':r==='director'?'Director':'Agente';
function status(){
  {const t=$('#navMesaT'),n=teamInfo?teamInfo.name:'la mesa';if(t&&t.textContent.toLowerCase()!==n.toLowerCase())t.textContent=n} // el titulito de la mesa en el menú
  pass++;
  const now=new Date(),te=todayS();
  $('#sClock').textContent=`${z(now.getHours())}:${z(now.getMinutes())}`;$('#sClock').title=`${DIAL[now.getDay()]} ${dm(te)}`;
  if(!ready){$('#sMes').textContent='Cebando…';return}
  const s=calc(ymNow());
  if(tlView()){const S=mesaMes(ymNow());$('#sMes').innerHTML=`<b>${S.n}</b> FTDs de la mesa`+(S.T?` <span class="dim">${S.falta?`faltan ${S.falta} para ${S.T}`:'target cumplido'}</span>`:'')}
  else $('#sMes').innerHTML=`<b>${s.n}</b> FTDs en ${esc(MES[now.getMonth()])}`+(s.next?` <span class="dim">faltan ${s.next[0]-s.n} para ${s.next[1]} USD</span>`:s.n?' <span class="dim">bono máximo</span>':'');
  if(!tlView()&&utOf(me))$('#sMes').insertAdjacentHTML('beforeend',` <span class="dim">· target ${utOf(me)}</span>`);
  const P=sueldoPesos(s);
  liqDraw(P); // el líquido va escondido hasta que se toca el ojo
  const open=pend.filter(p=>!p.done),venc=open.filter(p=>parseDue(p.due)<=now).length,hoy=open.filter(p=>p.due.slice(0,10)===te).length;
  $('#sPend').innerHTML=`Agenda <b>${hoy}</b>`+(venc?` <span class="hot b">${plural(venc,'vencido')}</span>`:'');
  $('#nbAg').textContent=venc||'';
  const lh=leads.filter(l=>l.date===te&&(isLeadUid(me)||leadOwner(l)===me)).length;$('#nbCl').textContent=lh||'';
  const so=pendingForMe(),ch=unreadAll(),tk=pendingTasks(),tkv=tk.filter(t=>t.due&&t.due<te).length;$('#nbSo').textContent=so||'';$('#nbCh').textContent=ch?(ch>99?'99+':ch):'';
  $('#nbTa').textContent=tk.length||'';
  if(crm.ok){const n=newsOf(tlView()||isLeadUid(me)?null:me).filter(inNew).length;$('#nbAh').textContent=n||''}
  if(isLeader())cmBadge(); // Manager: lo que hay que atender ya
  // una sola marca por sección, y solo si hay algo que hacer: Agenda = agendas vencidas; Chat = no leídos + pedidos para vos
  cliBadge();
  {$('#nbPanel').textContent=venc||'';$('#nbPanel').title=venc?plural(venc,'agenda vencida','agendas vencidas'):'';
   const cs=ch+so;$('#nbChat').textContent=cs?(cs>99?'99+':cs):''}
  // sin marca en Banking: siempre hay algo fallando y molestaba a la vista (lo pidió el dueño); las fallas viven en Banking
  $('#sAyuda').hidden=!profile||profile.role==='leader';
  $('#sTask').hidden=!tk.length;$('#sTask').innerHTML=`Tareas <b>${tk.length}</b>`+(tkv?` <span class="hot b">${plural(tkv,'vencida')}</span>`:'');
  document.title=(so+ch+tk.length?`(${so+ch+tk.length}) `:'')+'Vitalis';
  $('#sDb').hidden=navigator.onLine;
  $('#sMe').innerHTML=profile?`${avatar(profile.name)}<span style="min-width:0"><span class="nm">${esc(profile.name)}</span><span class="rl">${esc(roleTxt(profile.role))}</span></span>`:'';
  turnoBar();hoyBand();
}
let turnoKey='';
function turnoState(){const t=openTurno(),b=breakAbierto(t),h=turnos[todayS()];return {t,b,h,key:!t?('f'+(h?.out||'')):b?('b'+b.k+b.s):('w'+t.in)}}
function turnoBar(force){
  const el=$('#sTurno');if(!ready){el.innerHTML='';return}
  const {t,b,h,key}=turnoState(),now=Date.now();
  const btn=(act,label,title,cls='')=>`<button type="button" class="tb wr ${cls}" data-act="${act}" title="${title}">${label}</button>`;
  if(force||key!==turnoKey){
    turnoKey=key;dockSoon();
    if(!t)el.innerHTML=h&&h.out?`Turno de hoy <b>${durS(h.out-h.in)}</b>&nbsp;`:btn('entrada','Marcar entrada','Marcar la entrada de hoy','go');
    else if(b)el.innerHTML=`${isBano(b)?'En el baño':`Descanso ${b.k}'`} <span class="tLive"></span> ${btn('vuelta','Volví','Volver','go')}`;
    else el.innerHTML=`<span class="tLive"></span> ${btn('bano','Baño','Ir al baño')}${btn('d10','10 min','Descanso de 10 minutos')}${btn('d30','30 min','Descanso de media hora')}${btn('salida','Salida','Marcar salida')}`;
  }
  const live=el.querySelector('.tLive');if(!live||!t)return;
  if(b&&isBano(b)){live.innerHTML=`<b>${mmss(now-b.s)}</b>`;return}
  if(b){const left=b.s+b.k*6e4-now;live.innerHTML=left>=0?`<b>${mmss(left)}</b>`:`<b class="hot">+${mmss(-left)}</b>`}
  else{const rest=t.in+jorMs()-now;live.innerHTML=`<b>${durS(now-t.in)}</b> <span class="dim">${rest>0?'salís '+hhmm(t.in+jorMs()):''}</span>${rest>0?'':` <span class="hot">+${durS(-rest)}</span>`}`}
}

// el líquido del mes en la barra: escondido por defecto, el ojo lo muestra (queda en `local` liqShow)
let liqLast=null;
function liqDraw(P){
  if(P!==undefined)liqLast=P;const P2=liqLast,show=local.get('liqShow',false)===true,v=$('#sLiq .liq-v'),eye=$('#sLiqEye');if(!v)return;
  v.innerHTML=!show?'Líquido <span class="dim">••••</span>':P2&&P2.total!=null?`Líquido ≈ <b>${esc(pesos(P2.total))}</b>${tcViejo()?' <span class="hot">dólar viejo</span>':''}`:`Líquido <span class="hot">cargá el dólar</span>`;
  if(eye){eye.innerHTML=`<svg class="ic"><use href="#i-${show?'ojo-off':'ojo'}"/></svg>`;eye.title=show?'Ocultar el líquido':'Mostrar el líquido'}
}
document.addEventListener('click',e=>{const b=e.target.closest('#sLiqEye');if(!b)return;e.stopPropagation();local.set('liqShow',local.get('liqShow',false)!==true);liqDraw()});
