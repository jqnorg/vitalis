
/* ============================================================
   UI base: avisos, ventanas, tooltip, gráficos, navegación
   ============================================================ */
function toast(html,kind='ok',o={}){
  const box=$('#toasts');
  if(o.key){const ex=box.querySelector(`[data-key="${o.key}"]`);if(ex)ex.remove()}
  const t=document.createElement('div');t.className='toast '+kind;if(o.key)t.dataset.key=o.key;t.setAttribute('role',kind==='alert'||kind==='err'?'alert':'status');
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
  const all=[...box.children].filter(x=>!x.classList.contains('alert'));while(all.length>3)all.shift().remove();
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
  setTimeout(()=>{const f=box.querySelector('[autofocus]')||box.querySelector('.mb input:not([type=hidden]),.mb select,.mb textarea')||mf.querySelector('.pri');f&&f.focus()},0);
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
const VIEWS=['inicio','ventas','clientes','agenda','turnos','sueldo','snippets','chat','social','config','equipo','tareas','filtros'];
let cur='inicio';
const V={}; // vistas: {build(), render()}
// el menú va por categorías; adentro de cada una, pestañas arriba
const GROUPS={inicio:['inicio'],filtros:['filtros'],ventas:['ventas','clientes'],dia:['agenda','tareas','turnos','snippets'],mesa:['chat','social','equipo'],sueldo:['sueldo'],config:['config']};
const GKEYS=['inicio','filtros','ventas','dia','mesa','sueldo','config'];
const groupOf=v=>GKEYS.find(g=>GROUPS[g].includes(v))||'inicio';
let lastIn=local.get('lastIn',{});
function goG(g){const vs=(GROUPS[g]||['inicio']).filter(v=>v!=='equipo'||isLeader());go(vs.includes(lastIn[g])?lastIn[g]:vs[0])}
function go(v,opts){
  if(!VIEWS.includes(v)||(v==='equipo'&&!isLeader()))v='inicio';
  cur=v;hideTip();document.body.dataset.view=v;
  $$('.view').forEach(s=>s.hidden=s.id!=='v-'+v);
  const g=groupOf(v);lastIn[g]=v;local.set('lastIn',lastIn);
  $$('#nav [data-g]').forEach(b=>b.classList.toggle('on',b.dataset.g===g));
  $$('.subnav').forEach(s=>s.hidden=s.dataset.gsub!==g);
  $$('.subnav [data-v]').forEach(b=>{b.classList.toggle('on',b.dataset.v===v);b.setAttribute('aria-selected',b.dataset.v===v)});
  try{if(location.hash!=='#'+v)history.replaceState(null,'','#'+v)}catch(e){}
  $('#main').scrollTop=0;
  if(ready)V[v].render(opts||{});
}
let rT=null;
function refresh(){clearTimeout(rT);rT=setTimeout(()=>{if(!ready)return status();status();V[cur].render({});syncExt()},60)}

/* ---------- barra de estado ---------- */
const avHue=s=>{let h=0;for(const c of String(s||''))h=(h*31+c.charCodeAt(0))%360;return h};
const initials=n=>String(n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
const avatar=(name,cls='')=>{const m=members.find(x=>x.name===name),a=m&&avatars[m.id]; // con foto, si la subió
  return a?`<span class="av pic ${cls}" aria-hidden="true"><img src="${a.url}" alt=""></span>`:`<span class="av ${cls}" style="--h:${avHue(name)}" aria-hidden="true">${esc(initials(name))}</span>`};
const roleTxt=r=>r==='admin'?'Administrador':r==='leader'?'Team leader':'Agente';
function status(){
  const now=new Date(),te=todayS();
  $('#sClock').textContent=`${z(now.getHours())}:${z(now.getMinutes())}`;$('#sClock').title=`${DIAL[now.getDay()]} ${dm(te)}`;
  if(!ready){$('#sMes').textContent='Cebando…';return}
  const s=calc(ymNow());
  if(tlView()){const S=mesaMes(ymNow());$('#sMes').innerHTML=`<b>${S.n}</b> FTDs de la mesa`+(S.T?` <span class="dim">${S.falta?`faltan ${S.falta} para ${S.T}`:'target cumplido'}</span>`:'')}
  else $('#sMes').innerHTML=`<b>${s.n}</b> FTDs en ${esc(MES[now.getMonth()])}`+(s.next?` <span class="dim">faltan ${s.next[0]-s.n} para ${s.next[1]} USD</span>`:s.n?' <span class="dim">bono máximo</span>':'');
  const P=sueldoPesos(s);
  $('#sLiq').innerHTML=P&&P.total!=null?`Líquido ≈ <b>${esc(pesos(P.total))}</b>${tcViejo()?' <span class="hot">dólar viejo</span>':''}`:`Líquido <span class="hot">cargá el dólar</span>`;
  const open=pend.filter(p=>!p.done),venc=open.filter(p=>parseDue(p.due)<=now).length,hoy=open.filter(p=>p.due.slice(0,10)===te).length;
  $('#sPend').innerHTML=`Agenda <b>${hoy}</b>`+(venc?` <span class="hot b">${plural(venc,'vencido')}</span>`:'');
  $('#nbAg').textContent=venc||'';
  const lh=leads.filter(l=>l.uid===me&&l.date===te).length;$('#nbCl').textContent=lh||'';
  const so=pendingForMe(),ch=unreadAll(),tk=pendingTasks(),tkv=tk.filter(t=>t.due&&t.due<te).length;$('#nbSo').textContent=so||'';$('#nbCh').textContent=ch?(ch>99?'99+':ch):'';
  $('#nbTa').textContent=tk.length||'';
  const ag=+($('#nbAg').textContent||0),cl=+($('#nbCl').textContent||0);
  $('#ngVentas').textContent=cl||'';$('#ngDia').textContent=ag+tk.length||'';$('#ngMesa').textContent=so+ch?(so+ch>99?'99+':so+ch):'';
  $('#sTask').hidden=!tk.length;$('#sTask').innerHTML=`Tareas <b>${tk.length}</b>`+(tkv?` <span class="hot b">${plural(tkv,'vencida')}</span>`:'');
  document.title=(so+ch+tk.length?`(${so+ch+tk.length}) `:'')+'Vitalis';
  $('#sDb').hidden=navigator.onLine;
  $('#sMe').innerHTML=profile?`${avatar(profile.name)}<span style="min-width:0"><span class="nm">${esc(profile.name)}</span><span class="rl">${esc(roleTxt(profile.role))}</span></span>`:'';
  turnoBar();
}
let turnoKey='';
function turnoState(){const t=openTurno(),b=breakAbierto(t),h=turnos[todayS()];return {t,b,h,key:!t?('f'+(h?.out||'')):b?('b'+b.k+b.s):('w'+t.in)}}
function turnoBar(force){
  const el=$('#sTurno');if(!ready){el.innerHTML='';return}
  const {t,b,h,key}=turnoState(),now=Date.now();
  const btn=(act,label,title,cls='')=>`<button type="button" class="tb wr ${cls}" data-act="${act}" title="${title}">${label}</button>`;
  if(force||key!==turnoKey){
    turnoKey=key;
    if(!t)el.innerHTML=h&&h.out?`Turno de hoy <b>${durS(h.out-h.in)}</b>&nbsp;`:`Sin entrada ${btn('entrada','Entrada','Marcar entrada','go')}`;
    else if(b)el.innerHTML=`Descanso ${b.k}' <span class="tLive"></span> ${btn('vuelta','Volví','Volver del descanso','go')}`;
    else el.innerHTML=`<span class="tLive"></span> ${btn('d10',"10'",'Descanso de 10 minutos')}${btn('d30',"30'",'Descanso de 30 minutos')}${btn('salida','Salida','Marcar salida')}`;
  }
  const live=el.querySelector('.tLive');if(!live||!t)return;
  if(b){const left=b.s+b.k*6e4-now;live.innerHTML=left>=0?`<b>${mmss(left)}</b>`:`<b class="hot">+${mmss(-left)}</b>`}
  else{const rest=t.in+jorMs()-now;live.innerHTML=`<b>${durS(now-t.in)}</b> <span class="dim">${rest>0?'salís '+hhmm(t.in+jorMs()):''}</span>${rest>0?'':` <span class="hot">+${durS(-rest)}</span>`}`}
}
