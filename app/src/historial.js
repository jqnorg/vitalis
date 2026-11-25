/* ---------- Historial: todo lo que vendió el agente, venta por venta, y sus lates ---------- */
// Pedido del dueño (noviembre 2026): "la pestaña Historial, que para el agente tenga detalladísimo su historial de ventas y de lates".
// Sale todo de `team` (las ventas de la mesa): nada nuevo en la base. El agente ve lo suyo; team leader y admin eligen a quién mirar.
let hiWho='me',hiQ='',hiOpen={},hiTipo='';
const hiList=()=>{const uid=hiWho==='me'?me:hiWho;return team.filter(f=>f.uid===uid)};
const hiMed=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
const hiDays=(a,b)=>Math.round((parseYMD(b)-parseYMD(a))/864e5);
// cuánto tardó el late, en palabras: "1 día", "5 días"
const hiBuckets=[[1,1,'al día siguiente'],[2,3,'a los 2–3 días'],[4,7,'a los 4–7 días'],[8,14,'a las 2 semanas'],[15,1e9,'más de 2 semanas']];
function hiRachaMax(list){ // la racha más larga de días laborables seguidos con FTD
  const days=[...new Set(list.map(f=>f.date))].sort();if(!days.length)return {n:0};
  let best={n:0},cur=0,from=days[0],prev=null;
  for(const d of days){
    let ok=prev!=null;if(ok){let x=addDays(prev,1);while(x<d&&noTrabajo(x))x=addDays(x,1);ok=x===d}
    if(ok)cur++;else{cur=1;from=d}
    if(cur>best.n)best={n:cur,from,to:d};prev=d;
  }
  return best;
}
function hiKpis(list){
  const R=resumen(list),med=hiMed(list.filter(f=>!isLate(f)).map(regHrs).filter(h=>h!=null));
  const rk=hiRachaMax(list),first=list.length?list.reduce((m,f)=>f.date<m?f.date:m,list[0].date):null;
  const paises=groupBy(list,'paises'),p1=paises[0];
  return kpi('FTDs',nf(R.n),first?`desde ${mLabel(first.slice(0,7))} · ${nf(R.porMes,1)} por mes`:'todavía nada','hero')+
    kpi('Lates',`${R.lates} <small>· ${pct(R.latePct)}</small>`,R.lates?`tardan ${nf(R.lateDias,1)} días en promedio`:'todos new')+
    kpi('Mejor mes',R.best?`${R.best[1]} <small>FTDs</small>`:'—',R.best?mLabel(R.best[0]):'')+
    kpi('Racha más larga',`${rk.n} <small>día${rk.n===1?'':'s'}</small>`,rk.n>1?`${dm(rk.from)} al ${dm(rk.to)}`:'días seguidos con FTD')+
    kpi('Del registro al depósito',med==null?'—':med<1?Math.max(1,Math.round(med*60))+' <small>min</small>':nf(med,1)+' <small>h</small>','lo típico en tus new (mediana)')+
    kpi('Tu país',p1?esc(p1.k):'—',p1?`${plural(p1.n,'FTD')} · ${pct(p1.n/R.n)} de todo`:'');
}
function hiMeses(list){ // mes por mes, del más nuevo: FTDs, new, late, monto, target y CR (%)
  const by={};for(const f of list){const o=by[f.date.slice(0,7)]||(by[f.date.slice(0,7)]={n:0,late:0,monto:0,days:new Set()});o.n++;o.monto+=+f.amount||0;o.days.add(f.date);if(isLate(f))o.late++}
  const ms=Object.keys(by).sort().reverse();if(!ms.length)return '';
  const uid=hiWho==='me'?me:hiWho,te=todayS();
  const rows=ms.map((ym,i)=>{const o=by[ym],prev=by[ms[i+1]],ut=utOf(uid,ym),last=ym===te.slice(0,7)?te:addDays(addDays(ym+'-01',32).slice(0,7)+'-01',-1),cr=convPeriod(ym+'-01',last,uid);
    return `<tr><td>${esc(mLabel(ym))}</td><td class="r"><b>${o.n}</b> ${arrow(o.n,prev?prev.n:null)}</td><td class="r">${o.n-o.late}</td><td class="r">${o.late?`${o.late} <span class="d">(${pct(o.late/o.n)})</span>`:'<span class="d">0</span>'}</td><td class="r">${money(o.monto)}</td><td class="r">${o.days.size}</td><td class="r">${ut?`${ut} ${o.n>=ut?'<b class="ok">✓</b>':`<span class="d">faltaron ${ut-o.n}</span>`}`:'<span class="d">—</span>'}</td><td class="r">${cr.rate==null?'<span class="d">—</span>':pct(cr.rate)}</td></tr>`}).join('');
  return `<section class="card"><div class="card-h"><h3>Mes por mes</h3><span class="p-sub">la flecha compara con el mes anterior</span></div><div class="p-tablewrap"><table class="pt"><thead><tr><th>Mes</th><th class="r">FTDs</th><th class="r">New</th><th class="r">Late</th><th class="r">Monto USD</th><th class="r">Días con venta</th><th class="r">Target</th><th class="r">CR (%)</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function hiMesa(){ // la mesa en tablas (pedido del dueño): quién vende más y quién tiene más lates, de todo el historial y de este mes
  const ym=todayS().slice(0,7),uid=hiWho==='me'?me:hiWho;
  const by=list=>{const m=new Map();for(const f of list){let o=m.get(f.uid);if(!o){o={uid:f.uid,n:0,late:0,monto:0};m.set(f.uid,o)}o.n++;o.monto+=+f.amount||0;if(isLate(f))o.late++}return [...m.values()]};
  const all=by(team),mes=by(team.filter(f=>f.date.slice(0,7)===ym));if(!all.length)return '';
  const nm=o=>`<td class="trunc${o.uid===uid?' hi-me':''}">${o.uid===uid?'<b>':''}${esc(memberName(o.uid))}${o.uid===uid?' (vos)</b>':''}</td>`;
  const tV=(rows,t,sub)=>{rows=[...rows].sort((a,b)=>b.n-a.n||b.monto-a.monto);return `<div><h4>${t} <span class="d">· ${sub}</span></h4><div class="p-tablewrap"><table class="pt"><thead><tr><th>#</th><th>Quién</th><th class="r">FTDs</th><th class="r">New</th><th class="r">Late</th><th class="r">Monto USD</th></tr></thead><tbody>${rows.map((o,i)=>`<tr class="${o.uid===uid?'hi-me':''}"><td class="d">${i+1}</td>${nm(o)}<td class="r"><b>${o.n}</b></td><td class="r">${o.n-o.late}</td><td class="r">${o.late}</td><td class="r">${money(o.monto)}</td></tr>`).join('')}</tbody></table></div></div>`};
  const tL=(rows,t,sub)=>{rows=rows.filter(o=>o.late).sort((a,b)=>b.late-a.late||b.late/b.n-a.late/a.n);if(!rows.length)return `<div><h4>${t} <span class="d">· ${sub}</span></h4><p class="note">Sin lates.</p></div>`;
    return `<div><h4>${t} <span class="d">· ${sub}</span></h4><div class="p-tablewrap"><table class="pt"><thead><tr><th>#</th><th>Quién</th><th class="r">Lates</th><th class="r">De sus FTDs</th><th class="r">% late</th></tr></thead><tbody>${rows.map((o,i)=>`<tr class="${o.uid===uid?'hi-me':''}"><td class="d">${i+1}</td>${nm(o)}<td class="r"><b>${o.late}</b></td><td class="r">${o.n}</td><td class="r">${pct(o.late/o.n)}</td></tr>`).join('')}</tbody></table></div></div>`};
  const tot=all.reduce((a,o)=>a+o.n,0),lt=all.reduce((a,o)=>a+o.late,0),top=[...all].sort((a,b)=>b.n-a.n)[0],topL=[...all].sort((a,b)=>b.late-a.late)[0];
  return `<section class="card"><div class="card-h"><h3>La mesa</h3><span class="p-sub">${plural(tot,'FTD')} · ${lt} late${lt===1?'':'s'} (${pct(tot?lt/tot:0)})</span></div>
    <p class="note">El que más vende: <b>${esc(memberName(top.uid))}</b> (${plural(top.n,'FTD')}).${topL&&topL.late?` El que más lates tiene: <b>${esc(memberName(topL.uid))}</b> (${topL.late} de ${topL.n}, ${pct(topL.late/topL.n)}).`:''}</p>
    <div class="hi-mesa">${tV(all,'Más ventas','todo el historial')}${tV(mes,'Más ventas',mLabel(ym))}${tL(all,'Más lates','todo el historial')}${tL(mes,'Más lates',mLabel(ym))}</div></section>`;
}
function hiLates(list){ // tus lates: cuánto tardan, de qué país y afiliador vienen, el que más tardó
  const lat=list.filter(isLate),n=list.length;
  if(!lat.length)return `<section class="card"><div class="card-h"><h3>Tus lates</h3></div><p class="note">Todavía ningún late: todos tus clientes depositaron el mismo día que se registraron.</p></section>`;
  const days=lat.map(lateDays),med=hiMed(days),mx=lat.reduce((m,f)=>lateDays(f)>lateDays(m)?f:m,lat[0]);
  const bk=hiBuckets.map(([a,b,l])=>({l,n:days.filter(d=>d>=a&&d<=b).length})).filter(x=>x.n);
  const bar=bk.map(x=>`<div class="hi-b"><span class="hi-bl">${esc(x.l)}</span><div class="emb-b"><i style="width:${Math.round(x.n/lat.length*100)}%"></i></div><span class="hi-bn"><b>${x.n}</b> <span class="d">${pct(x.n/lat.length)}</span></span></div>`).join('');
  const by=(dim,t)=>{const all=groupBy(list,dim),g=groupBy(lat,dim).slice(0,6);if(!g.length)return '';
    return `<div><h4>${esc(t)}</h4>${g.map(x=>{const tot=all.find(y=>y.k===x.k);return `<div class="rw"><span class="k">${esc(x.k)}</span><span class="d"></span><span class="v"><b>${x.n}</b> <span class="d">de ${tot?tot.n:x.n} · ${tot?pct(x.n/tot.n):''}</span></span></div>`}).join('')}</div>`};
  const dow=[0,0,0,0,0,0,0];for(const f of lat)dow[parseYMD(f.date).getDay()]++;const bd=dow.indexOf(Math.max(...dow));
  return `<section class="card"><div class="card-h"><h3>Tus lates</h3><span class="p-sub">${plural(lat.length,'late')} de ${plural(n,'FTD')} · ${pct(lat.length/n)}</span></div>
    <p class="note">Un late es un cliente que depositó otro día que el del registro. Los tuyos tardan <b>${plural(med,'día')}</b> (mediana) y el que más tardó, <b>${plural(lateDays(mx),'día')}</b> (${esc(mx.name||mx.id)}, ${esc(mx.country||'')}, ${dm(mx.date)}/${mx.date.slice(2,4)}). El día que más lates cobrás: <b>${DIAL[bd]}</b>.</p>
    <div class="hi-bars">${bar}</div>
    <div class="grid2">${by('paises','Por país')}${by('afiliados','Por afiliador')}</div>
  </section>`;
}
function hiDonde(list){ // dónde vendés: país, afiliador · campaña, hora del día y día de la semana
  if(!list.length)return '';
  const n=list.length,top=(dim,t,k)=>{const g=groupBy(list,dim).slice(0,k);return `<div><h4>${esc(t)}</h4>${g.map(x=>`<div class="rw"><span class="k trunc" title="${esc(x.k)}">${esc(x.k)}</span><span class="d"></span><span class="v"><b>${x.n}</b> <span class="d">${pct(x.n/n)}${x.lates?` · ${x.lates} late`:''}</span></span></div>`).join('')}</div>`};
  const hs=new Array(24).fill(0);let nh=0;for(const f of list){const m=/^(\d{1,2}):/.exec(f.time||'');if(m){hs[+m[1]]++;nh++}}
  const dow=[0,0,0,0,0,0,0];for(const f of list)dow[parseYMD(f.date).getDay()]++;
  const hb=nh?`<div><h4>A qué hora depositan</h4><div class="hi-hours">${hs.map((v,h)=>`<div class="hi-h" title="${h}:00 · ${plural(v,'FTD')}"><i style="height:${Math.round(v/Math.max(...hs)*100)}%"></i><span>${h%3?'':h}</span></div>`).join('')}</div><p class="note">Tu mejor hora: <b>${hs.indexOf(Math.max(...hs))}:00</b> (${plural(Math.max(...hs),'FTD')}).</p></div>`:'';
  const db=`<div><h4>Qué día de la semana</h4><div class="hi-hours dow">${[1,2,3,4,5,6,0].map(d=>`<div class="hi-h" title="${DIAL[d]} · ${plural(dow[d],'FTD')}"><i style="height:${Math.round(dow[d]/Math.max(1,...dow)*100)}%"></i><span>${DIA[d]}</span></div>`).join('')}</div></div>`;
  return `<section class="card"><div class="card-h"><h3>Dónde vendés</h3><span class="p-sub">de todos tus FTDs</span></div><div class="grid2">${top('paises','Por país',6)}${top('afiliados','Por afiliador',6)}${top('campanas','Por campaña',6)}${hb}${db}</div></section>`;
}
function hiTimeline(list){ // venta por venta, agrupadas por mes y por día (el mes actual abierto)
  let L=[...list];
  if(hiTipo)L=L.filter(f=>hiTipo==='late'?isLate(f):!isLate(f));
  if(hiQ){const q=norm(hiQ);L=L.filter(f=>[f.name,f.id,f.tx,f.country,f.aff,f.camp].some(x=>x&&norm(String(x)).includes(q)))}
  if(!L.length)return `<section class="card"><div class="card-h"><h3>Venta por venta</h3></div><div class="p-empty">${list.length?'Nada con esa búsqueda.':'Todavía sin ventas.'}</div></section>`;
  L.sort((a,b)=>-byDate(a,b));
  const ym0=todayS().slice(0,7),brands=new Set(L.map(f=>f.brand).filter(Boolean)),mb=brands.size>1;
  const months=new Map();for(const f of L){const k=f.date.slice(0,7);if(!months.has(k))months.set(k,[]);months.get(k).push(f)}
  const row=f=>{const late=isLate(f),dem=demora(f),reg=String(f.reg||'');
    return `<tr class="${late?'late':''}"><td class="d">${esc(f.time||'')}</td><td><button type="button" class="lnk" data-act="ficha" data-id="${esc(f.id)}" title="Ver la ficha"><b>${esc(f.id)}</b></button></td><td>${esc(f.country||'')}</td><td class="trunc" title="${esc((f.aff||'')+' · '+(f.camp||''))}">${esc(f.aff||'—')} <span class="d">· ${esc(f.camp||'—')}</span></td><td class="r"><b>${money(f.amount)}</b></td><td class="d">${reg?`${dm(reg.slice(0,10))}/${reg.slice(2,4)} ${esc(reg.slice(11,16))}`:'—'}</td><td>${late?`<i class="dot"></i>late · ${plural(lateDays(f),'día')}`:`<i class="dot n"></i>new${dem?` <span class="d">· a ${esc(dem)}</span>`:''}`}</td>${mb?`<td class="d">${esc(f.brand||'')}</td>`:''}<td class="d">${esc(f.tx||'')}</td></tr>`};
  const out=[...months.entries()].map(([ym,fs],i)=>{const open=hiOpen[ym]!=null?hiOpen[ym]:(ym===ym0||i===0),lat=fs.filter(isLate).length,monto=fs.reduce((a,f)=>a+(+f.amount||0),0);
    const days=new Map();for(const f of fs){if(!days.has(f.date))days.set(f.date,[]);days.get(f.date).push(f)}
    const body=open?[...days.entries()].map(([d,ds])=>`<tr class="hi-day"><td colspan="${mb?9:8}">${cap(DIAL[parseYMD(d).getDay()])} ${+d.slice(8)} de ${MES[+d.slice(5,7)-1]}<span class="d"> · ${plural(ds.length,'FTD')}${ds.some(isLate)?` · ${ds.filter(isLate).length} late`:''}</span></td></tr>`+ds.map(row).join('')).join(''):'';
    return `<details class="hi-m" data-ym="${ym}"${open?' open':''}><summary><b>${esc(cap(MES[+ym.slice(5,7)-1]))} ${ym.slice(0,4)}</b><span class="d"> · ${plural(fs.length,'FTD')} · ${fs.length-lat} new · ${lat} late · ${money(monto)} USD · ${plural(days.size,'día')} con venta</span></summary>${open?`<div class="p-tablewrap"><table class="pt hi-t"><thead><tr><th>Hora</th><th>Cliente</th><th>País</th><th>Afiliador · campaña</th><th class="r">Monto</th><th>Registro</th><th>Tipo</th>${mb?'<th>Marca</th>':''}<th>Transacción</th></tr></thead><tbody>${body}</tbody></table></div>`:''}</details>`}).join('');
  return `<section class="card"><div class="card-h"><h3>Venta por venta</h3><span class="p-sub">${plural(L.length,'venta')}${hiQ||hiTipo?' con ese filtro':''}</span><span class="grow"></span><span class="seg" id="hiTipo">${[['','Todas'],['new','New'],['late','Late']].map(([k,l])=>`<button type="button" class="${hiTipo===k?'on':''}" data-tipo="${k}">${l}</button>`).join('')}</span></div>${out}</section>`;
}
V.historial={
  build(){
    let qt=null;
    $('#hiQ').addEventListener('input',e=>{clearTimeout(qt);qt=setTimeout(()=>{hiQ=e.target.value.trim();this.render()},180)});
    $('#hiWho').addEventListener('change',e=>{hiWho=e.target.value;hiOpen={};this.render()});
    $('#hiBody').addEventListener('click',e=>{
      const t=e.target.closest('[data-tipo]');if(t){hiTipo=t.dataset.tipo;this.render();return}
      const b=e.target.closest('[data-act=ficha]');if(b){openFicha(b.dataset.id);return}
    });
    $('#hiBody').addEventListener('toggle',e=>{const d=e.target;if(d.matches&&d.matches('details.hi-m')){hiOpen[d.dataset.ym]=d.open;if(d.open&&!d.querySelector('table'))this.render()}},true);
  },
  whoSelect(){
    const sel=$('#hiWho'),lead=isLeader();sel.parentElement.hidden=!lead;if(!lead){hiWho='me';return}
    if(sel===document.activeElement)return;
    const ms=members.filter(m=>m.id!==me&&(m.active||team.some(f=>f.uid===m.id)));
    sel.innerHTML=`<option value="me">Yo</option>`+ms.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}${m.active?'':' (desvinculado)'}</option>`).join('');
    if(![...sel.options].some(o=>o.value===hiWho))hiWho=tlView()&&ms.length?ms[0].id:'me'; // el team leader no vende: arranca en el primero de la mesa
    sel.value=hiWho;
  },
  render(){
    this.whoSelect();
    const list=hiList(),R=resumen(list),who=hiWho==='me'?'Tus ventas':memberName(hiWho);
    $('#hiSub').textContent=list.length?`${who} · ${plural(R.n,'FTD')} · ${R.lates} late${R.lates===1?'':'s'} (${pct(R.latePct)}) · ${money(R.monto)} USD`:`${who} · todavía sin ventas`;
    if($('#hiQ')!==document.activeElement)$('#hiQ').value=hiQ;
    $('#hiKpis').innerHTML=hiKpis(list);
    $('#hiBody').innerHTML=hiMeses(list)+hiMesa()+hiLates(list)+hiDonde(list)+hiTimeline(list);
  },
};
