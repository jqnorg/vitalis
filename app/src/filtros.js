/* ============================================================
   Filtros: qué se está vendiendo en la mesa, para saber qué filtrar en el CRM.
   Campañas, afiliadores, países y combinaciones que más venden (con tendencia),
   a cuántos días del registro depositan (→ qué fechas de registro filtrar) y a qué hora.
   ============================================================ */
let flDays=local.get('flDays',7),flBrand=local.get('flBrand','all'),flMore={};
const FL_PER=[[1,'Hoy'],[3,'3 días'],[7,'7 días'],[14,'14 días'],[30,'30 días']];
const FL_LAG=[[0,0,'Mismo día'],[1,3,'1 a 3'],[4,7,'4 a 7'],[8,14,'8 a 14'],[15,30,'15 a 30'],[31,90,'31 a 90'],[91,1e9,'Más de 90']];
const flVal=v=>{v=String(v??'').trim().replace(/\s+/g,' ');return !v||/^(null|undefined|-|—|0|n\/a)$/i.test(v)?'':v};
const flWin=(days,back=0)=>{const to=addDays(todayS(),-back*days);return {from:addDays(to,-(days-1)),to}};
const flLag=f=>{const r=String(f.reg||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(r))return null;return Math.max(0,Math.round((parseYMD(f.date)-parseYMD(r))/864e5))};
const flAt=f=>+new Date(`${f.date}T${/^\d{1,2}:\d{2}/.test(f.time||'')?f.time.padStart(5,'0'):'12:00'}`);
function flGroup(list,keyOf){ // agrupa sin importar mayúsculas; muestra la forma más usada
  const m=new Map();
  for(const f of list){const k=keyOf(f);if(!k)continue;const key=norm(k);let g=m.get(key);
    if(!g){g={key,k,forms:{},n:0,usd:0,last:0,who:new Set()};m.set(key,g)}
    g.forms[k]=(g.forms[k]||0)+1;g.n++;g.usd+=+f.amount||0;g.last=Math.max(g.last,flAt(f));g.who.add(f.uid)}
  for(const g of m.values())g.k=Object.entries(g.forms).sort((a,b)=>b[1]-a[1])[0][0];
  return [...m.values()].sort((a,b)=>b.n-a.n||b.last-a.last);
}
function flData(){
  const ok=f=>flBrand==='all'||norm(f.brand)===norm(flBrand);
  const w=flWin(flDays),pw=flWin(flDays,1);
  const list=team.filter(f=>ok(f)&&f.date>=w.from&&f.date<=w.to),prev=team.filter(f=>ok(f)&&f.date>=pw.from&&f.date<=pw.to);
  const dims={camp:f=>flVal(f.camp),aff:f=>flVal(f.aff),pais:f=>flVal(f.country),combo:f=>flVal(f.camp)&&flVal(f.aff)?`${flVal(f.camp)} · ${flVal(f.aff)}`:''};
  const G={},P={};for(const d in dims){G[d]=flGroup(list,dims[d]);P[d]=new Map(flGroup(prev,dims[d]).map(g=>[g.key,g.n]))}
  // a cuántos días del registro depositaron → qué fechas de registro conviene filtrar hoy
  const lags=list.map(flLag).filter(x=>x!=null).sort((a,b)=>a-b);
  const q=p=>lags.length?lags[Math.min(lags.length-1,Math.floor(p*(lags.length-1)+.5))]:null;
  const lo=q(.25),hi=q(.75),te=todayS();
  const reg=lags.length?{lo,hi,med:q(.5),from:addDays(te,-hi),to:addDays(te,-lo)}:null;
  const buckets=FL_LAG.map(([a,b,l])=>({l,a,b,n:lags.filter(x=>x>=a&&x<=b).length}));
  const hours=Array(24).fill(0);for(const f of list){const h=parseInt(f.time,10);if(h>=0&&h<24)hours[h]++}
  return {w,list,prev,G,P,reg,buckets,hours,nLag:lags.length};
}
function flTrend(g,P){
  const p=P.get(g.key)||0,d=g.n-p;
  if(!p)return `<span class="fl-t new" title="No tuvo FTDs en el período anterior">nuevo</span>`;
  return d>0?`<span class="fl-t up" title="${p} en el período anterior">▲ ${d}</span>`:d<0?`<span class="fl-t down" title="${p} en el período anterior">▼ ${-d}</span>`:`<span class="fl-t" title="Igual que el período anterior">=</span>`;
}
function flAgo(t){const d=new Date(t),k=ymd(d),te=todayS();if(k===te)return `hoy ${z(d.getHours())}:${z(d.getMinutes())}`;if(k===addDays(te,-1))return 'ayer';const n=Math.round((parseYMD(te)-parseYMD(k))/864e5);return `hace ${n} días`}
function flRank(id,title,g,P,copy=true){
  const lim=flMore[id]?g.length:6,max=g[0]?g[0].n:1;
  const rows=g.slice(0,lim).map(x=>`<div class="fl-row">
      ${copy?`<button type="button" class="fl-k" data-copy="${esc(x.k)}" title="Copiar ${esc(x.k)}">${esc(x.k)}</button>`:`<span class="fl-k">${esc(x.k)}</span>`}
      <span class="fl-track" title="${x.n} FTDs · ${esc(money(x.usd))} USD"><i style="width:${Math.max(3,x.n/max*100)}%"></i></span>
      <span class="fl-n"><b>${x.n}</b></span>${flTrend(x,P)}<span class="fl-l">${esc(flAgo(x.last))}</span></div>`).join('');
  return `<section class="card fl-card"><div class="card-h"><h3>${esc(title)}</h3><span class="p-sub">${g.length?`${g.length} con FTDs`:''}</span></div>
    ${g.length?`<div class="fl-hd"><span></span><span></span><span>FTDs</span><span>vs antes</span><span>Última</span></div>${rows}`:'<div class="p-empty">Sin datos en este período.</div>'}
    ${g.length>6?`<button type="button" class="btn sm rk-more" data-more="${id}">${flMore[id]?'Ver menos':`Ver todas (${g.length})`}</button>`:''}</section>`;
}
function flRec(D){ // lo que conviene filtrar ahora
  const top=(g,n)=>g.slice(0,n).map(x=>x.k);
  const camps=top(D.G.camp,3),affs=top(D.G.aff,3),paises=top(D.G.pais,2),R=D.reg;
  const chips=v=>v.map(x=>`<button type="button" class="chip fl-c" data-copy="${esc(x)}" title="Copiar">${esc(x)}</button>`).join('');
  const regTxt=R?(R.from===R.to?dm(R.from):`${dm(R.from)} al ${dm(R.to)}`):'';
  const rows=[
    camps.length&&`<div class="fl-rr"><span class="lb">Campañas</span><span class="fl-cs">${chips(camps)}</span></div>`,
    affs.length&&`<div class="fl-rr"><span class="lb">Afiliadores</span><span class="fl-cs">${chips(affs)}</span></div>`,
    R&&`<div class="fl-rr"><span class="lb">Registro</span><span class="fl-cs"><button type="button" class="chip fl-c" data-copy="${esc(regTxt)}" title="Copiar">${esc(regTxt)}</button><span class="p-sub">${R.lo===R.hi?`la mitad depositó a ${plural(R.lo,'día','días')} de registrarse`:`la mitad depositó entre ${R.lo} y ${plural(R.hi,'día','días')} después de registrarse`}</span></span></div>`,
    paises.length&&`<div class="fl-rr"><span class="lb">Países</span><span class="fl-cs">${chips(paises)}</span></div>`].filter(Boolean).join('');
  const per=FL_PER.find(p=>p[0]===flDays)[1].toLowerCase(),txt=[camps.length&&'Campañas: '+camps.join(', '),affs.length&&'Afiliadores: '+affs.join(', '),R&&'Registro: '+regTxt,paises.length&&'Países: '+paises.join(', ')].filter(Boolean).join(' · ');
  return `<section class="card fl-rec"><div class="card-h"><h3>Para filtrar ahora</h3><span class="p-sub">Con ${plural(D.list.length,'FTD')} de la mesa ${flDays===1?'de hoy':`de los últimos ${per}`}${flBrand!=='all'?' · '+esc(flBrand):''}</span></div>
    ${rows||'<div class="p-empty">Sin datos en este período.</div>'}
    ${rows?`<div class="fl-ra"><button type="button" class="btn sm" data-copy="${esc(txt)}">Copiar todo</button>${isLeader()?`<button type="button" class="btn sm pri" id="flTask">Mandar como tarea</button>`:''}</div>`:''}</section>`;
}
V.filtros={
  build(){
    $('#flPer').innerHTML=FL_PER.map(([d,l])=>`<button type="button" data-d="${d}">${l}</button>`).join('');
    $('#flBr').innerHTML=[['all','Todas'],['Trade24Seven','Trade24Seven'],['Novara Markets','Novara']].map(([k,l])=>`<button type="button" data-b="${esc(k)}">${l}</button>`).join('');
    $('#flPer').addEventListener('click',e=>{const b=e.target.closest('[data-d]');if(!b)return;flDays=+b.dataset.d;local.set('flDays',flDays);this.render({})});
    $('#flBr').addEventListener('click',e=>{const b=e.target.closest('[data-b]');if(!b)return;flBrand=b.dataset.b;local.set('flBrand',flBrand);this.render({})});
    $('#v-filtros').addEventListener('click',async e=>{
      const m=e.target.closest('[data-more]');if(m){flMore[m.dataset.more]=!flMore[m.dataset.more];this.render({});return}
      if(e.target.closest('#flTask')){const D=flData();taskNew({what:'Repasar',camps:D.G.camp.slice(0,3).map(x=>x.k),affs:D.G.aff.slice(0,3).map(x=>x.k),from:D.reg&&D.reg.from,to:D.reg&&D.reg.to});return}
      const c=e.target.closest('[data-copy]');
      if(c){try{await navigator.clipboard.writeText(c.dataset.copy);toast(`<b>${esc(clip(c.dataset.copy,80))}</b> copiado.`)}catch(x){toast('No pude copiar.','err')}}
    });
  },
  render(){
    $$('[data-d]',$('#flPer')).forEach(b=>b.classList.toggle('on',+b.dataset.d===flDays));
    $$('[data-b]',$('#flBr')).forEach(b=>b.classList.toggle('on',b.dataset.b===flBrand));
    const D=flData();
    if(!D.list.length){$('#flBody').innerHTML=`<section class="card"><div class="p-empty">${team.length?`Sin FTDs en la mesa ${flDays===1?'hoy':'en este período'}. Probá con más días${flBrand!=='all'?' u otra marca':''}.`:'Cuando la mesa cargue ventas, acá vas a ver qué conviene filtrar.'}</div></section>`;return}
    const few=D.list.length<5?`<p class="note fl-few">Son pocos FTDs: tomalo como pista, o ampliá el período.</p>`:'';
    $('#flBody').innerHTML=few+flRec(D)+
      `<div class="g2">${flRank('camp','Campañas',D.G.camp,D.P.camp)}${flRank('aff','Afiliadores',D.G.aff,D.P.aff)}</div>`+
      `<div class="g2">${flRank('combo','Campaña + afiliador',D.G.combo,D.P.combo,false)}${flRank('pais','Países',D.G.pais,D.P.pais)}</div>`+
      `<div class="g2"><section class="card"><div class="card-h"><h3>A cuántos días del registro depositan</h3><span class="p-sub">Días entre el registro y el FTD${D.reg?' · en color, la franja para filtrar':''}${D.nLag<D.list.length?` · ${D.nLag} con fecha de registro`:''}</span></div><div id="flLagC"></div></section>
        <section class="card"><div class="card-h"><h3>Hora de los FTDs</h3><span class="p-sub">Hora del depósito en el CRM</span></div><div id="flHrC"></div></section></div>`;
    const R=D.reg,hot=b=>R&&b.b>=R.lo&&b.a<=R.hi;
    colChart($('#flLagC'),D.buckets.map(b=>({lab:b.l,a:b.n,b:0,ca:hot(b)?null:'color-mix(in srgb,var(--s1) 38%,var(--panel))',r:b})),{h:200,int:true,capMin:12,every:1,label:'FTDs según los días entre el registro y el depósito',empty:'Sin fechas de registro.',
      tip:d=>({title:d.r.l==='Mismo día'?'El mismo día del registro':`${d.r.l} días después del registro`,rows:[{v:String(d.r.n),l:'FTDs'},...(hot(d.r)?[{v:'',l:'la franja que conviene filtrar'}]:[])]})});
    let h0=D.hours.findIndex(n=>n>0),h1=23-[...D.hours].reverse().findIndex(n=>n>0);if(h0<0){h0=8;h1=20}h0=Math.max(0,Math.min(h0,8));h1=Math.min(23,Math.max(h1,20));
    colChart($('#flHrC'),D.hours.slice(h0,h1+1).map((n,i)=>({lab:String(h0+i),a:n,b:0,h:h0+i})),{h:200,int:true,capMin:16,label:'FTDs por hora',empty:'Sin horas cargadas.',
      tip:d=>({title:`De ${z(d.h)}:00 a ${z(d.h)}:59`,rows:[{v:String(d.a),l:'FTDs'}]})});
  },
};
