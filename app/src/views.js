
/* ============================================================
   Vistas
   ============================================================ */
function bonoMeter(n){
  const T=tiers();if(!T.length)return '';
  const top=Math.max(T[T.length-1][0]+4,n+1),P=v=>Math.min(100,v/top*100),cur=porCantidad(n).tier;
  return `<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${top}" aria-valuenow="${n}" aria-label="FTDs del mes hacia los bonos"><div class="fill" style="width:${P(n)}%"></div>${T.map(([t])=>`<i class="tk${n>=t?' on':''}" style="left:${P(t)}%"></i>`).join('')}</div>
  <div class="mlab">${T.map(([t,b])=>`<span class="${t===cur?'at':n>=t?'on':''}" style="left:${P(t)}%">${t}<small>${b} USD</small></span>`).join('')}</div>`;
}
const kpi=(lb,v,s,cls='',extra='')=>`<div class="kpi ${cls}"${extra}><div class="lb">${lb}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
const rw=(k,v,cls='')=>`<div class="rw ${cls}"><span class="k">${k}</span><span class="d"></span><span class="v">${v}</span></div>`;

/* ---------- inicio ---------- */
V.inicio={
  k:'',
  build(){bindAgForm($('#iaForm'))},
  render(){
    const now=new Date(),te=todayS(),ym=ymNow(),s=calc(ym),P=sueldoPesos(s);
    $('#iFecha').textContent=`${DIAL[now.getDay()]} ${dm(te)}/${te.slice(0,4)}`;
    const hoy=ftds.filter(f=>f.date===te),t=openTurno()||turnos[te],m=t?metr(t):null;
    const mes=MES[+ym.slice(5,7)-1];
    const sub=s.extra?`${s.loaded} cargado${s.loaded===1?'':'s'} + ${s.extra} sin detalle`:`${money(s.monto)} USD depositados`;
    $('#iKpis').innerHTML=
      `<div class="kpi hero span2"><div class="lb">FTDs · ${esc(mes)}<span class="grow"></span><button type="button" class="btn sm wr" data-act="ajuste" data-ym="${ym}" title="FTDs del mes sin detalle">✎ sin detalle</button></div>
        <div style="display:flex;align-items:baseline;gap:16px;flex-wrap:wrap"><div class="v">${s.n}</div><div class="s" style="white-space:normal;line-height:1.6">${esc(sub)}<br>${s.next?sp('hot b',`faltan ${s.next[0]-s.n} para ${s.next[1]} USD`):s.n?sp('ok b','bono máximo 🔥'):''}</div></div>${bonoMeter(s.n)}</div>`+
      kpi('Variable',`${money(s.usd)} <small>USD</small>`,`${s.n} × ${cfg.porftd}${s.bono?` + bono ${s.bono}`:''}`)+
      kpi('Líquido ≈',P&&P.total!=null?esc(pesos(P.total)):'—',P&&P.total!=null?(tcViejo()?sp('hot','dólar viejo · '+tcTxt()):esc(tcTxt())):sp('hot','cargá el dólar'),'click',' data-go="sueldo" title="Ver sueldo"')+
      kpi('Hoy',`${hoy.length} <small>FTD${hoy.length===1?'':'s'}</small>`,`${money(hoy.reduce((a,f)=>a+(+f.amount||0),0))} USD${m&&m.fph!=null&&hoy.length?' · '+nf(m.fph,2)+' por hora':''}`);
    this.turno(true);
    // agenda
    const open=pend.filter(p=>!p.done&&p.due.slice(0,10)<=te).sort(byDue),next=pend.filter(p=>!p.done&&p.due.slice(0,10)>te).sort(byDue)[0];
    const venc=open.filter(p=>parseDue(p.due)<=now).length;
    $('#iaSub').innerHTML=`${open.length} hoy${venc?' · '+sp('hot',venc+' vencido'+(venc>1?'s':'')):''}`;
    $('#iaList').innerHTML=(open.length?`<div class="alist">${open.map(p=>pendItem(p,now,true)).join('')}</div>`:'<div class="p-empty" style="padding:8px 0">Sin pendientes para hoy.</div>')+
      (next?`<div class="note">próximo: ${esc(whenTxt(parseDue(next.due)))} · <b class="b" style="color:var(--fg)">${esc(next.id)}</b> · ${esc(next.kw)}</div>`:'');
    // FTDs por día
    const [Y,M]=ym.split('-').map(Number),days=new Date(Y,M,0).getDate(),bd={};
    for(const f of s.list){const d=+f.date.slice(8,10),o=bd[d]||(bd[d]={a:0,b:0,m:0});if(isLate(f))o.b++;else o.a++;o.m+=+f.amount||0}
    const data=[];for(let d=1;d<=days;d++){const o=bd[d]||{a:0,b:0,m:0},dw=new Date(Y,M-1,d).getDay();data.push({lab:String(d),a:o.a,b:o.b,m:o.m,d,dw,labC:dw===0||dw===6?'color-mix(in srgb,var(--dim) 55%,transparent)':''})}
    $('#idTitle').textContent=`FTDs POR DÍA · ${mes.toUpperCase()}`;
    colChart($('#iChart'),data,{h:200,capMin:18,label:'FTDs por día',empty:'Sin FTDs este mes.',
      tip:d=>({title:`${DIAL[d.dw]} ${z(d.d)}/${z(M)}`,rows:[{v:String(d.a+d.b),l:'FTDs'},{key:'var(--s1)',v:String(d.a),l:'new'},{key:'var(--s2)',v:String(d.b),l:'late'},{v:money(d.m),l:'USD depositados'}]})});
    // últimas ventas
    const lastF=[...ftds].sort((a,b)=>-byDate(a,b)).slice(0,8);
    $('#iLast').innerHTML=lastF.length?`<div class="lst">${lastF.map(f=>`<div class="li"><span class="t">${esc(f.date===te?'hoy':dm(f.date))} ${esc(f.time||'')}</span><span class="n" title="${esc(f.name)} · ${esc(f.camp)}"><b>${esc(f.id)}</b> ${esc(f.name)}<small>${esc(f.country)} · ${esc(f.camp)}</small></span><span class="m">${money(f.amount)}</span><span>${tipoBadge(f)}</span><span class="wr"><button type="button" class="ib" data-act="editFtd" data-id="${esc(f._id)}" title="editar">✎</button></span></div>`).join('')}</div>`
      :'<div class="p-empty">Todavía no hay ventas.</div>';
  },
  turno(force){
    if(cur!=='inicio')return;
    const {t,b,h,key}=turnoState(),now=Date.now(),day=t||h;
    if(force||key!==this.k){
      this.k=key;let bt='';
      if(!t)bt=h&&h.out?'<button type="button" class="btn" data-act="entrada">▶ reabrir</button>':'<button type="button" class="btn pri big" data-act="entrada">▶ Entrada</button>';
      else if(b)bt='<button type="button" class="btn pri big" data-act="vuelta">↩ Vuelta</button>';
      else bt=`<button type="button" class="btn big" data-act="d10">☕ 10'</button><button type="button" class="btn big" data-act="d30">☕ 30'</button><button type="button" class="btn pri big" data-act="salida">■ Salida</button>`;
      if(day)bt+='<span style="flex:1"></span><button type="button" class="ib" data-act="deshacer" title="Deshacer la última marca">↶ deshacer</button><button type="button" class="ib" data-act="editHoy" title="Editar las horas de hoy">✎ editar</button>';
      $('#itBtns').innerHTML=bt;
    }
    let st='<span class="dim">Sin entrada hoy.</span>';
    if(day){
      const m=metr(day,now);
      if(b){const left=b.s+b.k*6e4-now;st=`<span class="big${left<0?' hot':''}">${left>=0?mmss(left):'+'+mmss(-left)}</span><span>descanso de ${b.k}' · ${left>=0?'volvés '+hhmm(b.s+b.k*6e4):sp('hot','te pasaste')}</span>`}
      else if(t){const rest=m.salidaEst-now;st=`<span class="big">${durS(m.total)}</span><span>${rest>0?`salida ${hhmm(m.salidaEst)} · faltan ${dur(rest)}`:sp('hot','+'+dur(-rest)+' extra')}</span>`}
      else st=`<span class="big">${durS(m.total)}</span><span>✔ ${hhmm(day.in)}–${hhmm(day.out)} · ${Math.abs(m.extra)<6e4?'justo':m.extra>0?sp('hot','+'+dur(m.extra)+' extra'):dur(-m.extra)+' menos'}</span>`;
    }
    $('#itState').innerHTML=st;
    $('#itSub').textContent=day?`${DIA[parseYMD(day.date).getDay()]} ${dm(day.date)} · jornada ${durS(jorMs())}`:`jornada ${durS(jorMs())}`;
    $('#itTl').innerHTML=day?timeline(day,now):'';
    $('#itMarks').innerHTML=day?marksHTML(day):'';
  },
};
function timeline(t,now){
  const end=t.out||now,tgt=t.in+jorMs(),span=Math.max(end,tgt)-t.in||1,P=ms=>Math.max(0,Math.min(100,(ms-t.in)/span*100));
  let s=`<div class="seg wk" style="left:0;width:${P(end)}%"></div>`;
  for(const b of t.breaks){const e=b.e||end,ex=e-b.s>b.k*6e4+6e4;s+=`<div class="seg br${ex?' x':''}" style="left:${P(b.s)}%;width:${Math.max(.8,P(e)-P(b.s))}%" title="descanso ${b.k}' ${hhmm(b.s)}–${b.e?hhmm(b.e):'…'}"></div>`}
  s+=`<div class="seg" style="left:calc(${P(tgt)}% - 2px);width:0;border-left:2px dashed var(--fg);opacity:.7" title="fin de jornada ${hhmm(tgt)}"></div>`;
  if(!t.out)s+=`<div class="now" style="left:calc(${P(now)}% - 1px)"></div>`;
  return `<div class="tl" role="img" aria-label="Jornada desde ${hhmm(t.in)}">${s}</div><div class="tll"><span>${hhmm(t.in)}</span><span>${t.out?'salida '+hhmm(t.out):'fin '+hhmm(tgt)}</span></div>`;
}
function marksHTML(t){
  const p=[`▶ <b>${hhmm(t.in)}</b> entrada`];
  for(const b of t.breaks){const d=(b.e||Date.now())-b.s,ex=d-b.k*6e4;p.push(`☕ <b>${hhmm(b.s)}–${b.e?hhmm(b.e):'…'}</b> ${b.k}'${b.e?` · ${mins(d)} min${ex>=6e4?' '+sp('hot','+'+mins(ex)):''}`:''}`)}
  if(t.out)p.push(`■ <b>${hhmm(t.out)}</b> salida`);
  return p.map(x=>`<span>${x}</span>`).join('');
}

/* ---------- ventas ---------- */
let pF={},pShow=40,pExpand={},pBuiltKey='',pWho='me';
const whoList=()=>pWho==='me'?ftds:pWho==='all'?team:team.filter(f=>f.uid===pWho);
const whoLabel=()=>pWho==='me'?'mis ventas':pWho==='all'?'toda la mesa':memberName(pWho);
V.ventas={
  build(){
    let qt=null;
    $('#pQ').addEventListener('input',e=>{clearTimeout(qt);qt=setTimeout(()=>{pF.q=e.target.value.trim()||undefined;pShow=40;this.render({})},180)});
    $('#pChartTblBtn').addEventListener('click',()=>{const t=$('#pChartTbl');t.hidden=!t.hidden;$('#pChartTblBtn').textContent=t.hidden?'ver tabla':'ocultar tabla'});
    $('#pMore').addEventListener('click',()=>{pShow+=60;this.render({})});
    $('#pWho').addEventListener('change',e=>{pWho=e.target.value;pShow=40;pBuiltKey='';this.render({})});
  },
  whoSelect(){
    const sel=$('#pWho');if(sel===document.activeElement)return;
    const ms=members.filter(m=>m.id!==me&&(m.active||team.some(f=>f.uid===m.id)));
    sel.innerHTML=`<option value="me">yo</option><option value="all">toda la mesa</option>`+ms.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}${m.active?'':' (baja)'}</option>`).join('');
    if(![...sel.options].some(o=>o.value===pWho))pWho='me';
    sel.value=pWho;
  },
  filters(){
    const src=whoList(),u=fn=>[...new Set(src.map(fn).filter(Boolean).map(String))].sort((a,b)=>a.localeCompare(b));
    const months=[...new Set(src.map(f=>f.date.slice(0,7)))].sort();
    const brands=u(f=>f.brand);
    const cmap=new Map();for(const f of src){const k=norm(f.country);if(k&&!cmap.has(k))cmap.set(k,f.country)}
    const countries=[...cmap.values()].sort((a,b)=>a.localeCompare(b));
    const affs=u(f=>f.aff),camps=u(f=>f.camp);
    const key=[pWho,months.join(),brands.join(),countries.join(),affs.length,camps.length].join('|');
    if(key!==pBuiltKey){
      pBuiltKey=key;
      const o=(v,l)=>`<option value="${esc(v)}">${esc(l)}</option>`;
      $('#pFilters').innerHTML=
        `<label>Desde<select data-f="desde">${o('','inicio')}${months.map(m=>o(m,mLabel(m))).join('')}</select></label>`+
        `<label>Hasta<select data-f="hasta">${o('','hoy')}${months.map(m=>o(m,mLabel(m))).join('')}</select></label>`+
        `<label>Marca<select data-f="marca">${o('','todas')}${brands.map(b=>o(b,b)).join('')}</select></label>`+
        `<label>Afiliado<input data-f="aff" list="dlAff" placeholder="todos" autocomplete="off"></label>`+
        `<label>Campaña<input data-f="camp" list="dlCamp" placeholder="todas" autocomplete="off"></label>`+
        `<label>País<select data-f="pais">${o('','todos')}${countries.map(p=>o(p,p)).join('')}</select></label>`+
        `<label>Tipo<select data-f="late">${o('','todos')}${o('no','new')}${o('si','late')}</select></label>`+
        `<button class="btn sm" type="button" id="pClear" style="margin-bottom:3px">limpiar</button>`+
        dlist('dlAff',affs)+dlist('dlCamp',camps);
      $$('[data-f]',$('#pFilters')).forEach(el=>{
        el.addEventListener('change',()=>{const v=el.value.trim();pF[el.dataset.f]=v||undefined;pShow=40;this.render({})});
        if(el.tagName==='INPUT')el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();el.dispatchEvent(new Event('change'))}});
      });
      $('#pClear').addEventListener('click',()=>{pF={};$('#pQ').value='';pShow=40;this.render({})});
    }
    $$('[data-f]',$('#pFilters')).forEach(el=>{
      if(el===document.activeElement)return;
      const k=el.dataset.f;let v=pF[k]||'';
      if(k==='marca'&&v){const b=[...el.options].find(op=>op.value&&norm(op.value).includes(norm(v)));v=b?b.value:''}
      if(k==='pais'&&v){const b=[...el.options].find(op=>op.value&&norm(op.value)===norm(v));v=b?b.value:''}
      el.value=v;
    });
    if($('#pQ')!==document.activeElement)$('#pQ').value=pF.q||'';
  },
  render(opts){
    if(opts&&opts.f){pF={...opts.f};pShow=40}
    if(opts&&opts.who){pWho=opts.who;pBuiltKey=''}
    this.whoSelect();
    this.filters();
    const list=applyF(whoList(),pF),R=resumen(list),many=pWho==='all';
    $('#pSub').textContent=whoLabel()+' · '+fDesc(pF);
    const top=dim=>groupBy(list,dim)[0]||null;
    const tc=pF.camp?null:top('campanas'),ta=pF.aff?null:top('afiliados');
    const k=(lb,v,s,hero)=>`<div class="kpi${hero?' hero':''}"><div class="lb">${esc(lb)}</div><div class="v" title="${esc(v)}">${esc(v)}</div><div class="s" title="${esc(s)}">${esc(s)}</div></div>`;
    $('#pKpis').innerHTML=
      k('FTDs',nf(R.n),`${R.meses} mes${R.meses===1?'':'es'} · ${nf(R.porMes,1)} por mes`,true)+
      k('Monto',money(R.monto)+' USD',`prom ${nf(R.prom,1)} por FTD`)+
      k('Lates',`${R.lates} · ${pct(R.latePct)}`,R.lates?`prom ${nf(R.lateDias,1)} días`:'todos new')+
      k('Mejor mes',R.best?mLabel(R.best[0]):'—',R.best?`${R.best[1]} FTDs`:'')+
      (tc?k('Top campaña',tc.k,`${tc.n} FTDs · ${money(tc.monto)} USD`):'')+
      (ta?k('Top afiliado',ta.k,`${ta.n} FTDs · ${money(ta.monto)} USD`):'')+
      (many&&list.length?(()=>{const g=groupBy(list,'vendedores')[0];return k('Top vendedor',g.k,`${g.n} FTDs · ${money(g.monto)} USD`)})():'');
    // por mes
    const data=porMes(list,pF),plain=sinFiltros(pF);
    colChart($('#pChart'),data.map(d=>({...d,a:d.n-d.late,b:d.late,lab:MES[+d.ym.slice(5,7)-1].slice(0,3)+(d.ym===data[0].ym||d.ym.endsWith('-01')?" '"+d.ym.slice(2,4):'')})),{h:230,label:'FTDs por mes',empty:'Sin ventas para estos filtros.',
      tip:d=>{const rows=[{v:String(d.n),l:'FTDs'},{key:'var(--s1)',v:String(d.a),l:'new'},{key:'var(--s2)',v:String(d.b),l:'late'},{v:money(d.monto),l:'USD depositados'}];
        if(plain&&pWho==='me')rows.push({v:money(porCantidad(calc(d.ym).n).usd),l:'USD de variable'});return {title:mLong(d.ym),rows}}});
    const pl=plain&&pWho==='me';
    $('#pChartTbl').innerHTML=data.length?`<table class="pt"><thead><tr><th>Mes</th><th class="r">FTDs</th><th class="r">New</th><th class="r">Lates</th><th class="r">Monto USD</th>${pl?'<th class="r">Variable USD</th>':''}</tr></thead><tbody>`+
      data.map(d=>`<tr><td>${esc(mLabel(d.ym))}</td><td class="r">${d.n}</td><td class="r">${d.n-d.late}</td><td class="r">${d.late}</td><td class="r">${money(d.monto)}</td>${pl?`<td class="r">${money(porCantidad(calc(d.ym).n).usd)}</td>`:''}</tr>`).join('')+'</tbody></table>':'';
    $('#dCard').hidden=pWho!=='me';if(pWho==='me')this.dias(list);
    // rankings
    const rk=$('#pRanks');rk.textContent='';
    for(const dim of many?['vendedores','campanas','afiliados','paises']:['campanas','afiliados','paises','marcas']){
      const D=DIMS[dim],g=groupBy(list,dim),max=g[0]?g[0].n:1;
      const card=document.createElement('section');card.className='card';
      card.innerHTML=`<div class="card-h"><h3>${esc(D.t.toUpperCase())}</h3><span class="p-sub">${g.length}</span></div>`;
      const box=document.createElement('div');box.className='rk';
      const lim=pExpand[dim]?g.length:8;
      box.style.setProperty('--vw',Math.max(4,...g.slice(0,lim).map(x=>(`${x.n} · ${money(x.monto)}${x.lates?' · '+x.lates+' late':''}`).length))+'ch');
      for(const x of g.slice(0,lim)){
        const sel=pF[D.f]&&(D.f==='pais'?norm(pF.pais)===norm(x.k):D.f==='marca'?norm(x.k).includes(norm(pF.marca)):pF[D.f]===x.k);
        const b=document.createElement('button');b.type='button';b.className='rk-row'+(sel?' sel':'');
        b.innerHTML=`<span class="rk-name" title="${esc(x.k)}">${esc(x.k)}</span><span class="rk-track"><span class="rk-bar" style="width:${x.n/max*100}%"></span></span><span class="rk-val">${x.n} <span class="m">· ${money(x.monto)}${x.lates?' · '+x.lates+' late':''}</span></span>`;
        b.title=`${x.k}: ${x.n} FTDs · ${money(x.monto)} USD · prom ${nf(x.monto/x.n,0)}${x.lates?` · ${x.lates} lates (${pct(x.lates/x.n)})`:''}`;
        b.addEventListener('click',()=>{if(sel)delete pF[D.f];else pF[D.f]=x.k;pShow=40;this.render({})});
        box.appendChild(b);
      }
      if(!g.length)box.innerHTML='<div class="p-empty">Sin datos</div>';
      card.appendChild(box);
      if(g.length>8){const mb=document.createElement('button');mb.type='button';mb.className='btn sm rk-more';mb.textContent=pExpand[dim]?'ver menos':`ver todas (${g.length})`;
        mb.addEventListener('click',()=>{pExpand[dim]=!pExpand[dim];this.render({})});card.appendChild(mb)}
      rk.appendChild(card);
    }
    // tabla
    const rows=[...list].sort((a,b)=>-byDate(a,b));
    $('#pCount').textContent=`${plural(rows.length,'venta')} · ${money(R.monto)} USD`;
    $('#pTable').innerHTML=rows.length?`<table class="pt"><thead><tr><th>Fecha</th><th>ID</th><th>Nombre</th><th>País</th><th>Afiliado</th><th>Campaña</th><th class="r">Monto</th><th>Registro</th><th>Tipo</th><th>Marca</th>${pWho!=='me'?'<th>Vendedor</th>':''}<th class="act"></th></tr></thead><tbody>`+
      rows.slice(0,pShow).map(f=>`<tr><td>${esc(dm(f.date))}/${f.date.slice(2,4)} <span class="d">${esc(f.time||'')}</span></td><td>${esc(f.id)}</td><td class="trunc" title="${esc(f.name)}">${esc(f.name)}</td><td>${esc(f.country)}</td><td>${esc(f.aff)}</td><td class="trunc" title="${esc(f.camp)}">${esc(f.camp)}</td><td class="r">${money(f.amount)}</td><td class="d">${esc(f.reg?dm(String(f.reg).slice(0,10)):'')}</td><td>${isLate(f)?`<i class="dot"></i>late ${lateDays(f)} d`:'<i class="dot n"></i><span class="d">new</span>'}</td><td class="d">${esc(f.brand||'')}</td>${pWho!=='me'?`<td class="trunc">${esc(memberName(f.uid))}</td>`:''}<td class="act wr">${canEdit(f)?`<button type="button" class="ib" data-act="editFtd" data-id="${esc(f._id)}" title="editar">✎</button><button type="button" class="ib del" data-act="delFtd" data-id="${esc(f._id)}" title="borrar">✕</button>`:''}</td></tr>`).join('')+'</tbody></table>'
      :'<div class="p-empty">Sin ventas para estos filtros.</div>';
    $('#pMore').hidden=rows.length<=pShow;
  },
};

V.ventas.dias=function(list){
  const D=diasDist(list,pF);
  if(!D||!D.dias){$('#dSub').textContent='';$('#dChart').innerHTML='<div class="p-empty">Sin días trabajados en este período.</div>';$('#dTbl').innerHTML='';$('#dNote').textContent='';return}
  const fd=d=>`${dm(d)}/${d.slice(2,4)}`;
  $('#dSub').textContent=`${plural(D.dias,'día contado','días contados')} · ${fd(D.start)} → ${fd(D.end)}`;
  colChart($('#dChart'),D.rows.map(r=>({lab:String(r.n),a:r.d,b:0,ca:r.n?null:'var(--dim)',r})),{h:210,capMin:12,label:'Días por cantidad de ventas',empty:'Sin datos.',
    tip:d=>({title:d.r.n?`${plural(d.r.n,'venta')} en el día`:'días sin ventas',rows:[{key:d.r.n?'var(--s1)':'var(--dim)',v:plural(d.r.d,'día'),l:pct(d.r.d/D.dias)+' de los días contados'},...(d.r.last?[{v:`${DIA[parseYMD(d.r.last).getDay()]} ${fd(d.r.last)}`,l:'el último'}]:[])]})});
  let acc=D.dias;
  $('#dTbl').innerHTML=`<table class="pt"><thead><tr><th>Ventas en el día</th><th class="r">Días</th><th class="r">%</th><th class="r">Días con N o más</th></tr></thead><tbody>`+
    D.rows.map(r=>{const row=`<tr><td>${r.n===0?'<span class="d">0 · sin ventas</span>':r.n}</td><td class="r">${r.d}</td><td class="r">${pct(r.d/D.dias)}</td><td class="r d">${r.n?acc:''}</td></tr>`;acc-=r.d;return row}).join('')+
    `<tr><td><b>Total</b></td><td class="r"><b>${D.dias}</b></td><td class="r">100%</td><td></td></tr></tbody></table>`;
  const L=(cfg.libres||[]).map(x=>`${+x.slice(3,5)}/${+x.slice(0,2)}`),sf=cfg.sinFer||DEF.sinFer;
  const lab=(cfg.laborables||DEF.laborables).slice().sort((a,b)=>((a+6)%7)-((b+6)%7)).map(w=>DIA[w]).join(' ');
  const fer=sf.no&&sf.lab?'sin feriados':sf.no?'sin feriados no laborables':sf.lab?'sin feriados laborables':'con feriados';
  $('#dNote').innerHTML=`${sp('b',plural(D.con,'día'))} con ventas (${pct(D.con/D.dias)}) · ${plural(D.cero,'día')} sin ventas · ${nf(D.tot/D.dias,2)} FTDs por día contado${D.best?` · mejor día ${DIA[parseYMD(D.best[0]).getDay()]} ${fd(D.best[0])} (${D.best[1]})`:''}<br>`+
    `cuenta ${esc(lab)} desde ${fd(D.start)} · ${fer}${L.length?` · sin ${esc(L.join(', '))}`:''}${D.fal?` · sin ${plural(D.fal,'falta')}`:''}${D.fuera?` · ${plural(D.fuera,'venta')} en días que no se cuentan`:''} · hoy entra cuando tenga ventas`;
};

/* ---------- agenda ---------- */
let agAllDone=false;
V.agenda={
  build(){bindAgForm($('#agForm'))},
  render(){
    const now=new Date(),te=todayS();
    const open=pend.filter(p=>!p.done).sort(byDue),done=pend.filter(p=>p.done).sort((a,b)=>(b.doneAt||'').localeCompare(a.doneAt||''));
    const venc=open.filter(p=>parseDue(p.due)<=now),hoy=open.filter(p=>parseDue(p.due)>now&&p.due.slice(0,10)===te),prox=open.filter(p=>p.due.slice(0,10)>te);
    $('#agSub').innerHTML=`${plural(open.length,'pendiente')}${venc.length?' · '+sp('hot',venc.length+' vencido'+(venc.length>1?'s':'')):''}${extOn()?' · '+sp('ok','🔔 avisos de Chrome'):''}`;
    const grp=(t,list,cls='')=>list.length?`<div class="grp"><h4 class="${cls}">${t} · ${list.length}</h4><div class="alist">${list.map(p=>pendItem(p,now)).join('')}</div></div>`:'';
    const shown=agAllDone?done:done.slice(0,10);
    $('#agLists').innerHTML=(open.length?'':'<div class="p-empty">Sin pendientes.</div>')+grp('⚠ vencidos',venc,'warn')+grp('hoy',hoy)+grp('próximos',prox)+
      (done.length?`<div class="grp"><h4>hechos · ${done.length}</h4><div class="alist">${shown.map(p=>pendItem(p,now)).join('')}</div>${done.length>10?`<button type="button" class="btn sm rk-more" id="agMore">${agAllDone?'ver menos':'ver todos'}</button>`:''}</div>`:'');
    const mb=$('#agMore');if(mb)mb.onclick=()=>{agAllDone=!agAllDone;this.render({})};
  },
};

/* ---------- turnos ---------- */
let tuPer='semana',tuYm='';
const PER=[['hoy','hoy'],['semana','esta semana'],['semanaP','semana pasada'],['mes','este mes'],['mesP','mes anterior']];
function perDates(){
  const te=todayS();
  if(tuYm)return Object.keys(turnos).filter(k=>k.startsWith(tuYm)).sort();
  if(tuPer==='hoy'){const t=openTurno();return [t?t.date:te]}
  if(tuPer==='semana'||tuPer==='semanaP'){
    const d=new Date();const off=(d.getDay()+6)%7;let mon=addDays(te,-off-(tuPer==='semanaP'?7:0));
    const out=[];for(let i=0;i<7;i++){const x=addDays(mon,i);if(x<=te)out.push(x)}return out;
  }
  let ym=ymNow();if(tuPer==='mesP'){const [y,m]=ym.split('-').map(Number);ym=m===1?`${y-1}-12`:`${y}-${z(m-1)}`}
  return Object.keys(turnos).filter(k=>k.startsWith(ym)).sort();
}
V.turnos={
  build(){
    $('#tuPer').innerHTML=PER.map(([k,l])=>`<button type="button" class="chip" data-per="${k}">${l}</button>`).join('');
    $('#tuPer').addEventListener('click',e=>{const c=e.target.closest('[data-per]');if(!c)return;tuPer=c.dataset.per;tuYm='';this.render({})});
    $('#tuMes').addEventListener('change',e=>{tuYm=e.target.value;this.render({})});
  },
  render(){
    $$('[data-per]',$('#tuPer')).forEach(c=>c.classList.toggle('on',!tuYm&&c.dataset.per===tuPer));
    const months=[...new Set(Object.keys(turnos).map(k=>k.slice(0,7)))].sort().reverse();
    $('#tuMes').innerHTML=`<option value="">mes…</option>`+months.map(m=>`<option value="${m}"${m===tuYm?' selected':''}>${esc(mLabel(m))}</option>`).join('');
    const rows=perDates().map(d=>turnos[d]).filter(Boolean).sort((a,b)=>a.date<b.date?-1:1).map(t=>({t,...metr(t)}));
    $('#tuSub').textContent=tuYm?mLong(tuYm):PER.find(p=>p[0]===tuPer)[1];
    const n=rows.length;
    if(!n){$('#tuKpis').innerHTML='';$('#tuChart').innerHTML='<div class="p-empty">Sin jornadas en este período.</div>';$('#tuTable').innerHTML='';$('#tuCount').textContent='';return}
    const tot=rows.reduce((a,r)=>a+r.total,0),cerr=rows.filter(r=>r.t.out),extra=cerr.reduce((a,r)=>a+r.extra,0),ftdT=rows.reduce((a,r)=>a+r.ftd,0);
    const entP=rows.reduce((a,r)=>{const d=new Date(r.t.in);return a+d.getHours()*60+d.getMinutes()},0)/n;
    const exc=rows.filter(r=>r.exceso>=6e4),excT=exc.reduce((a,r)=>a+r.exceso,0),descP=rows.reduce((a,r)=>a+r.desc,0)/n;
    const best=rows.reduce((m,r)=>!m||r.ftd>m.ftd?r:m,null);
    $('#tuKpis').innerHTML=
      kpi('Horas',esc(durS(tot)),`${plural(n,'día')} · ${esc(durS(tot/n))} por día`,'hero')+
      kpi('Extra',cerr.length?(Math.abs(extra)<6e4?'0':(extra>0?'+':'−')+esc(durS(Math.abs(extra)))):'—',cerr.length?`${plural(cerr.length,'día cerrado','días cerrados')}`:'sin días cerrados')+
      kpi('Entrada prom.',`${z(Math.floor(entP/60))}:${z(Math.round(entP%60)%60)}`,`descansos ${mins(descP)} min por día`)+
      kpi('Excesos',exc.length?sp('hot',`+${mins(excT)} min`):'0',exc.length?`${plural(exc.length,'día')} con descanso largo`:'descansos en tiempo')+
      kpi('FTDs',String(ftdT),`${nf(ftdT/n,1)} por día · ${nf(tot?ftdT/(tot/36e5):0,2)} por hora`)+
      (best&&best.ftd?kpi('Mejor día',`${DIA[parseYMD(best.t.date).getDay()]} ${dm(best.t.date)}`,plural(best.ftd,'FTD')):'');
    colChart($('#tuChart'),rows.map(r=>({a:r.total/36e5,b:0,lab:`${DIA[parseYMD(r.t.date).getDay()]} ${+r.t.date.slice(8,10)}`,r})),{h:200,ref:jorMs()/36e5,refLab:'jornada '+durS(jorMs()),capMin:34,label:'Horas por día',
      fmt:v=>durS(v*36e5),fmtY:v=>nf(v,v%1?1:0)+'h',
      tip:d=>({title:`${DIAL[parseYMD(d.r.t.date).getDay()]} ${dm(d.r.t.date)}`,rows:[{key:'var(--s1)',v:dur(d.r.total),l:'trabajadas'},{v:`${hhmm(d.r.t.in)}–${d.r.t.out?hhmm(d.r.t.out):'…'}`,l:''},{v:mins(d.r.desc)+' min',l:'descansos'+(d.r.exceso>=6e4?` (+${mins(d.r.exceso)})`:'')},{v:String(d.r.ftd),l:'FTDs'}]})});
    $('#tuCount').textContent=plural(n,'jornada');
    $('#tuTable').innerHTML=`<table class="pt"><thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th class="r">Horas</th><th class="r">Extra</th><th class="r">Descansos</th><th class="r">FTDs</th><th class="r">FTD/h</th><th class="r">Contactos</th><th class="act"></th></tr></thead><tbody>`+
      [...rows].reverse().map(r=>`<tr${r.t.out?'':' class="cur"'}><td>${DIA[parseYMD(r.t.date).getDay()]} ${dm(r.t.date)}</td><td>${hhmm(r.t.in)}</td><td>${r.t.out?hhmm(r.t.out):'<span class="info">en curso</span>'}</td><td class="r">${durS(r.total)}</td><td class="r${r.extra>=6e4&&r.t.out?' hot':''}">${!r.t.out?'':Math.abs(r.extra)<6e4?'0':(r.extra>0?'+':'−')+durS(Math.abs(r.extra))}</td><td class="r${r.exceso>=6e4?' hot':''}">${mins(r.desc)} min${r.exceso>=6e4?' (+'+mins(r.exceso)+')':''}</td><td class="r">${r.ftd}</td><td class="r">${r.fph!=null?nf(r.fph,2):'—'}</td><td class="r d">${r.cont||''}</td><td class="act wr"><button type="button" class="ib" data-act="editTurno" data-d="${r.t.date}" title="editar">✎</button></td></tr>`).join('')+'</tbody></table>';
  },
};

/* ---------- sueldo ---------- */
let suYm='',siN=null;
V.sueldo={
  build(){
    $('#suMes').addEventListener('change',e=>{suYm=e.target.value;this.render({})});
    const step=d=>{const o=[...$('#suMes').options].map(x=>x.value),i=o.indexOf(suYm);const j=i-d;if(j>=0&&j<o.length){suYm=o[j];this.render({})}};
    $('#suPrev').onclick=()=>step(-1);$('#suNext').onclick=()=>step(1);
    $('#suTcSave').onclick=()=>this.saveTc();
    $('#suTc').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();this.saveTc()}});
    $('#suNom').addEventListener('click',e=>{const b=e.target.closest('[data-aj]');if(!b)return;setAjusteN(suYm,(ajustes[suYm]||0)+ +b.dataset.aj)});
    $('#suNom').addEventListener('change',e=>{if(e.target.id==='suAj')setAjusteN(suYm,e.target.value)});
    const setN=n=>{siN=Math.max(0,Math.min(999,Math.round(+n||0)));this.sim()};
    $('#siR').addEventListener('input',e=>setN(e.target.value));
    $('#siN').addEventListener('input',e=>{if(e.target.value!=='')setN(e.target.value)});
    $('#siMinus').onclick=()=>setN(siN-1);$('#siPlus').onclick=()=>setN(siN+1);
    $('#siChips').addEventListener('click',e=>{const c=e.target.closest('[data-n]');if(c)setN(c.dataset.n)});
  },
  async saveTc(){
    if(!noRO())return;
    const n=parseAmount($('#suTc').value);
    if(isNaN(n)||n<10||n>200){$('#suTc').classList.add('bad');return toast('Cotización inválida.','err')}
    $('#suTc').classList.remove('bad');
    cfg={...cfg,tc:n,tcFecha:todayS()};
    if(await B.saveCfg()){const P=sueldoPesos(calc(ymNow()));toast(`✔ Dólar BROU compra ${nf(n,2)}${P&&P.total!=null?' · líquido de '+esc(MES[new Date().getMonth()])+' ≈ '+sp('ok b',pesos(P.total)):''}`)}
  },
  render(){
    const now=ymNow();
    const months=[...new Set([now,...ftds.map(f=>f.date.slice(0,7)),...Object.keys(ajustes)])].sort().reverse();
    if(!suYm||!months.includes(suYm))suYm=now;
    $('#suMes').innerHTML=months.map(m=>`<option value="${m}"${m===suYm?' selected':''}>${esc(mLong(m))}</option>`).join('');
    const i=months.indexOf(suYm);$('#suPrev').disabled=i>=months.length-1;$('#suNext').disabled=i<=0;
    const s=calc(suYm),P=sueldoPesos(s);
    $('#suNomSub').textContent=suYm===now?'este mes':'';
    $('#suNom').innerHTML=`<div class="rows">`+
      rw('FTDs',`<b>${s.n}</b>`,'big')+
      rw('&nbsp;&nbsp;cargados',String(s.loaded))+
      rw('&nbsp;&nbsp;sin detalle',readOnly?String(s.extra):`<span class="step"><button type="button" data-aj="-1" aria-label="menos">−</button><input type="number" id="suAj" min="0" max="999" value="${s.extra}" aria-label="FTDs sin detalle"><button type="button" data-aj="1" aria-label="más">+</button></span>`)+
      rw('Fijo',`${pesos(cfg.base)} UYU`)+
      rw(`Por FTD (${s.n} × ${cfg.porftd} USD)`,`${money(s.porftd)} USD`)+
      rw(s.tier?`Bono (${s.tier}+ FTDs)`:'Bono',`${money(s.bono)} USD`)+
      rw('Variable',`${money(s.usd)} USD`,'tot hl')+
      rw('Total nominal',`${pesos(cfg.base)} + ${money(s.usd)} USD`)+
      (cfg.tc>0?rw('≈ en pesos',`${pesos(cfg.base+s.usd*cfg.tc)} UYU`):'')+
      `</div>`+(s.monto?`<div class="note">${money(s.monto)} USD depositados por tus FTDs</div>`:'');
    $('#suLiqSub').textContent=P?(cfg.comRecibo?'comisiones en el recibo':'comisiones aparte'):'';
    $('#suLiq').innerHTML=!P?`<div class="p-empty">Falta el dólar BROU compra.<br><button type="button" class="btn sm wr" style="margin-top:8px" data-act="focusTc">cargar dólar</button></div>`:
      `<div class="rows">`+rw(cfg.comRecibo?'Nominal gravado':'Nominal gravado (fijo)',pesos(P.N))+
      rw('− Aporte jubilatorio 15%',pesos(P.jub))+rw(`− FONASA ${nf(P.rF*100,1).replace(',0','')}%`,pesos(P.fon))+rw('− FRL 0,1%',pesos(P.frl))+rw('− IRPF',pesos(P.irpf))+
      rw('Líquido',`${pesos(P.neto)} UYU`,'tot hl big')+
      (P.tc>0&&cfg.comRecibo?rw('≈ en dólares',`${money(Math.round(P.neto/P.tc))} USD`):'')+
      (P.usdAparte?rw('+ Comisiones aparte',`${money(P.usdAparte)} USD`)+(P.total!=null?rw('≈ Total en mano',`${pesos(P.total)} UYU`,'tot hl'):''):'')+`</div>`;
    // bonos
    $('#suBonoSub').textContent=s.next?`faltan ${s.next[0]-s.n} para ${s.next[1]} USD`:s.n?'bono máximo 🔥':'';
    const T=tiers();
    $('#suBono').innerHTML=bonoMeter(s.n)+`<table class="pt" style="margin-top:6px"><thead><tr><th>FTDs</th><th class="r">Bono</th><th class="r">Variable</th><th class="r">Líquido ≈</th></tr></thead><tbody>`+
      T.map(([t,b])=>{const q=porCantidad(t),L=sueldoPesos(q);return `<tr${t===s.tier?' class="cur"':''}><td>${t}+${t===s.tier?' <span class="ok">◂</span>':''}</td><td class="r">${money(b)} USD</td><td class="r">${money(q.usd)} USD</td><td class="r">${L&&L.total!=null?pesos(L.total):'—'}</td></tr>`}).join('')+'</tbody></table>';
    // dólar
    if($('#suTc')!==document.activeElement)$('#suTc').value=cfg.tc>0?nf(cfg.tc,2):'';
    $('#suTcInfo').innerHTML=cfg.tc>0?(tcViejo()?sp('hot','⚠ '+tcTxt()+' · actualizalo'):esc(tcTxt())):sp('hot','sin cargar');
    // simulador
    if(siN==null)siN=calc(now).n;
    $('#siChips').innerHTML=[calc(now).n,...T.map(t=>t[0])].filter((v,i,a)=>a.indexOf(v)===i).map(n=>`<button type="button" class="chip" data-n="${n}">${n}${n===calc(now).n?' (hoy)':''}</button>`).join('');
    this.sim();
  },
  sim(){
    const n=siN,q=porCantidad(n),L=sueldoPesos(q),curS=calc(ymNow()),Lc=sueldoPesos(curS);
    $('#siR').max=Math.max(50,n);$('#siR').value=n;if($('#siN')!==document.activeElement||+$('#siN').value!==n)$('#siN').value=n;
    $$('[data-n]',$('#siChips')).forEach(c=>c.classList.toggle('on',+c.dataset.n===n));
    const d=L&&L.total!=null&&Lc&&Lc.total!=null?L.total-Lc.total:null;
    $('#siOut').innerHTML=`<div class="rows">`+rw('FTDs',`<b>${n}</b>`,'big')+rw(q.tier?`Bono (${q.tier}+)`:'Bono',`${money(q.bono)} USD`)+rw('Variable',`${money(q.usd)} USD`,'hl')+
      (cfg.tc>0?rw('Nominal',`${pesos(cfg.base+q.usd*cfg.tc)} UYU`):'')+
      (L&&L.total!=null?rw('Líquido',`${pesos(L.total)} UYU`,'tot hl big')+rw('≈ en dólares',`${money(Math.round(L.total/cfg.tc))} USD`):rw('Líquido',sp('hot','falta el dólar')))+
      `</div><div class="note">${n===curS.n?'= lo que llevás este mes':`vs. este mes (${plural(curS.n,'FTD')}): ${d!=null?`${d>=0?'+':'−'} ${pesos(Math.abs(d))}`:`${q.usd-curS.usd>=0?'+':'−'} ${money(Math.abs(q.usd-curS.usd))} USD`}${n>curS.n?` · te faltan ${n-curS.n}`:''}`}${q.next?` · con ${q.next[0]} cobrás bono de ${q.next[1]}`:''}</div>`;
    const ns=[...new Set([Math.max(0,n-1),n,n+1,...(q.next?[q.next[0]]:[])])].sort((a,b)=>a-b);
    $('#siTbl').innerHTML=`<table class="pt"><thead><tr><th>FTDs</th><th class="r">Variable</th><th class="r">Líquido ≈</th><th class="r">Δ por FTD</th></tr></thead><tbody>`+
      ns.map((x,i)=>{const qq=porCantidad(x),LL=sueldoPesos(qq),prev=i?sueldoPesos(porCantidad(ns[i-1])):null,dd=LL&&prev&&LL.total!=null&&prev.total!=null?(LL.total-prev.total)/Math.max(1,x-ns[i-1]):null;
        return `<tr${x===n?' class="cur"':''}><td>${x}</td><td class="r">${money(qq.usd)} USD</td><td class="r">${LL&&LL.total!=null?pesos(LL.total):'—'}</td><td class="r d">${dd!=null?'+'+pesos(dd):''}</td></tr>`}).join('')+'</tbody></table>';
  },
};

/* ---------- config ---------- */
const TEMAS=[['verde','#7dff8a','#060a07'],['ambar','#ffcf87','#0b0703'],['hielo','#d7e3fa','#080b10']];
function applyTheme(){document.body.classList.remove('ambar','hielo');if(cfg.tema&&cfg.tema!=='verde')document.body.classList.add(cfg.tema)}
let bonosDraft=null;
V.config={
  build(){
    $('#cfTemas').innerHTML=TEMAS.map(([t,fg,bg])=>`<button type="button" class="th" data-tema="${t}"><i style="background:${bg};box-shadow:inset 0 0 0 3px ${fg}"></i>${t}</button>`).join('');
    $('#cfTemas').addEventListener('click',async e=>{const b=e.target.closest('[data-tema]');if(!b)return;cfg={...cfg,tema:b.dataset.tema};applyTheme();this.render({});if(!readOnly&&await B.saveCfg())this.saved()});
    $$('[data-c]',$('#v-config')).forEach(el=>el.addEventListener('change',()=>this.set(el)));
    $('#cfBonoAdd').onclick=()=>{this.readBonos();bonosDraft.push(['','']);this.drawBonos()};
    $('#cfBonoSave').onclick=()=>this.saveBonos();
    $('#cfBonos').addEventListener('click',e=>{const x=e.target.closest('[data-rmb]');if(!x)return;this.readBonos();bonosDraft.splice(+x.dataset.rmb,1);this.drawBonos()});
    // días de trabajo
    $('#cfDow').innerHTML=[1,2,3,4,5,6,0].map(w=>`<button type="button" class="chip" data-dow="${w}">${DIA[w]}</button>`).join('');
    $('#cfDow').addEventListener('click',e=>{const c=e.target.closest('[data-dow]');if(!c||!noRO())return;const w=+c.dataset.dow,L=new Set(cfg.laborables||DEF.laborables);
      if(L.has(w))L.delete(w);else L.add(w);if(!L.size)return toast('Tiene que quedar al menos un día.','err');this.saveDias({laborables:[...L].sort()})});
    $('#cfInicio').addEventListener('change',e=>{if(!noRO())return;const v=e.target.value;if(!v||v>todayS())return toast('Fecha inválida.','err');this.saveDias({inicio:v})});
    $('#cfFer').addEventListener('click',e=>{const c=e.target.closest('[data-fer]');if(!c||!noRO())return;const sf={...(cfg.sinFer||DEF.sinFer)};sf[c.dataset.fer]=!sf[c.dataset.fer];this.saveDias({sinFer:sf})});
    $('#cfLibAdd').onclick=()=>{if(!noRO())return;const v=$('#cfLibD').value;if(!v)return toast('Elegí la fecha del feriado.','err');const md=v.slice(5),L=cfg.libres||[];
      if(L.includes(md))return toast('Ese feriado ya está.','warn');$('#cfLibD').value='';this.saveDias({libres:[...L,md].sort()})};
    $('#cfLibres').addEventListener('click',e=>{const c=e.target.closest('[data-lib]');if(!c||!noRO())return;this.saveDias({libres:(cfg.libres||[]).filter(x=>x!==c.dataset.lib)})});
    $('#cfFalAdd').onclick=()=>{if(!noRO())return;const d=$('#cfFalD').value;if(!d)return toast('Elegí la fecha de la falta.','err');
      if(d>todayS())return toast('Esa fecha todavía no llegó.','err');
      const F=cfg.faltas||[];if(F.some(x=>x.d===d))return toast('Esa falta ya está cargada.','warn');
      const r=noTrabajo(d);if(r==='finde')return toast('Ese día no es laborable.','warn');if(r==='feriado'||r==='libre')return toast('Ese día ya no se cuenta.','warn');
      const n=ftds.filter(f=>f.date===d).length;if(n)return toast(`Ese día tenés ${plural(n,'venta')}.`,'err');
      $('#cfFalD').value='';this.saveDias({faltas:[...F,{d,j:$('#cfFalJ').value==='1'}].sort((a,b)=>a.d<b.d?-1:1)})};
    $('#cfFaltas').addEventListener('click',e=>{const c=e.target.closest('[data-fal]');if(!c||!noRO())return;
      const F=(cfg.faltas||[]).map(x=>({...x}));const it=F.find(x=>x.d===c.dataset.fal);if(!it)return;
      if(c.dataset.op==='rm')this.saveDias({faltas:F.filter(x=>x!==it)});else{it.j=!it.j;this.saveDias({faltas:F})}});
  },
  async saveDias(ch){cfg={...cfg,...ch};this.render({});if(await B.saveCfg())this.saved()},
  saved(){const s=$('#cfSaved');s.classList.add('on');clearTimeout(this.st);this.st=setTimeout(()=>s.classList.remove('on'),1600)},
  async set(el){
    if(!noRO())return this.render({});
    const k=el.dataset.c,v=el.value.trim();let val;
    const bad=m=>{el.classList.add('bad');toast(m,'err')};
    el.classList.remove('bad');
    switch(k){
      case 'base':case 'porftd':case 'bpc':case 'fondoSol':case 'hijos':{
        const n=parseAmount(v);
        if(isNaN(n)||n<0)return bad('Número inválido.');
        if(k==='bpc'&&n<1000)return bad('BPC inválida (2026: 6.864).');
        if(k==='hijos'&&n>20)return bad('Número inválido.');
        val=n;break}
      case 'fonasa':val=v;break;
      case 'comRecibo':val=v==='1';break;
      case 'jornada':{const m=norm(v).replace(/\s|hs?$/g,'').match(/^(\d{1,2})(?:([:h.,])(\d{1,2}))?$/);
        if(!m)return bad('Ej: 7:30');let mm=+m[1]*60;if(m[3])mm+=(m[2]===','||m[2]==='.')&&m[3].length===1?+m[3]*6:+m[3];
        if(mm<60||mm>16*60)return bad('Ej: 7:30');val=mm;break}
      case 'hora':{const h=parseTime(v);if(!h)return bad('Hora inválida.');val=h;break}
      case 'sep':val=v===';'?';':',';break;
      default:return;
    }
    cfg={...cfg,[k]:val};
    if(await B.saveCfg())this.saved();
  },
  readBonos(){bonosDraft=$$('.brow',$('#cfBonos')).map(r=>[r.querySelector('.bt').value,r.querySelector('.bu').value])},
  drawBonos(){
    $('#cfBonos').innerHTML=bonosDraft.map(([t,u],i)=>`<div class="brow" style="grid-template-columns:auto 1fr auto 1fr auto"><span class="dim">desde</span><input class="bt" inputmode="numeric" value="${esc(t)}" aria-label="FTDs"><span class="dim">FTDs →</span><input class="bu" inputmode="decimal" value="${esc(u)}" aria-label="USD"><button type="button" class="ib del wr" data-rmb="${i}" aria-label="Quitar">✕</button></div>`).join('');
  },
  async saveBonos(){
    if(!noRO())return;
    this.readBonos();$('#cfBonoErr').textContent='';
    const b=bonosDraft.filter(([t,u])=>String(t).trim()||String(u).trim()).map(([t,u])=>[parseAmount(t),parseAmount(u)]);
    if(b.some(([t,u])=>isNaN(t)||isNaN(u)||t<1||u<0||!Number.isInteger(t)))return $('#cfBonoErr').textContent='Revisá los valores.';
    if(new Set(b.map(x=>x[0])).size!==b.length)return $('#cfBonoErr').textContent='Hay escalones repetidos.';
    cfg={...cfg,bonos:b.sort((x,y)=>x[0]-y[0])};bonosDraft=null;
    if(await B.saveCfg()){this.saved();toast('✔ Bonos guardados.')}
  },
  render(){
    $$('[data-c]',$('#v-config')).forEach(el=>{
      if(el===document.activeElement)return;const k=el.dataset.c;
      if(k==='comRecibo')el.value=cfg.comRecibo?'1':'0';
      else if(k==='jornada')el.value=`${Math.floor(jorMs()/36e5)}:${z(Math.round(jorMs()/6e4)%60)}`;
      else if(['base','bpc','fondoSol'].includes(k))el.value=nf(cfg[k]);
      else el.value=String(cfg[k]??'').replace('.',',');
      el.disabled=readOnly;
    });
    if(!bonosDraft||!$('#cfBonos').contains(document.activeElement)){bonosDraft=tiers().map(([t,u])=>[String(t),String(u)]);this.drawBonos()}
    $$('[data-tema]',$('#cfTemas')).forEach(b=>b.classList.toggle('on',b.dataset.tema===(cfg.tema||'verde')));
    const LB=cfg.laborables||DEF.laborables;$$('[data-dow]',$('#cfDow')).forEach(c=>c.classList.toggle('on',LB.includes(+c.dataset.dow)));
    if($('#cfInicio')!==document.activeElement)$('#cfInicio').value=cfg.inicio||'';
    const sf=cfg.sinFer||DEF.sinFer,y=+todayS().slice(0,4),fl=t=>feriadosUY(y).filter(x=>x.t===t).map(x=>`${dm(x.d)} ${x.n}`).join('\n');
    $('#cfFer').innerHTML=`<button type="button" class="chip${sf.no?' on':''}" data-fer="no" title="${esc(fl('no'))}">no laborables</button><button type="button" class="chip${sf.lab?' on':''}" data-fer="lab" title="${esc(fl('lab'))}">laborables</button>`;
    const L=cfg.libres||[];
    $('#cfLibres').innerHTML=L.length?L.map(x=>`<button type="button" class="chip on" data-lib="${x}" title="Quitar">${+x.slice(3,5)}/${+x.slice(0,2)} ✕</button>`).join(''):'<span class="p-sub">ninguno</span>';
    const F=cfg.faltas||[],fj=F.filter(x=>x.j).length;
    $('#cfFaltas').innerHTML=F.length?`<div class="alist">${F.map(x=>`<div class="ai" style="grid-template-columns:auto 1fr auto"><span class="wh">${DIA[parseYMD(x.d).getDay()]} ${dm(x.d)}/${x.d.slice(0,4)}</span><button type="button" class="chip${x.j?' on':''}" data-fal="${x.d}" data-op="j" title="Cambiar" style="justify-self:start">${x.j?'justificada':'sin justificar'}</button><button type="button" class="ib del wr" data-fal="${x.d}" data-op="rm" title="Quitar">✕</button></div>`).join('')}</div>`:'<span class="p-sub">ninguna</span>';
    $('#cfDiasSub').textContent=F.length?`${plural(F.length,'falta')} · ${fj} justificada${fj===1?'':'s'}`:'';
    $('#cfDb').textContent=teamInfo?'Vitalis · '+teamInfo.name:'';
    V.cuenta.render();
    $('#cfExt').innerHTML=extOn()?sp('ok','🔔 extensión de Chrome conectada · '+plural(extN,'aviso programado','avisos programados')):'sin extensión de Chrome';
    const lat=ftds.filter(isLate).length;
    $('#cfCount').textContent=`${plural(ftds.length,'venta')} (${lat} late) · ${plural(pend.length,'contacto')} · ${plural(Object.keys(turnos).length,'jornada')} · ${Object.keys(ajustes).length?Object.entries(ajustes).map(([k,v])=>`${mLabel(k)}: ${v} sin detalle`).join(' · '):'sin ajustes'}`;
  },
};

/* ---------- equipo (team leader y admin) ---------- */
let eqYm='';
V.equipo={
  build(){
    $('#eqMes').addEventListener('change',e=>{eqYm=e.target.value;this.render({})});
    const step=d=>{const o=[...$('#eqMes').options].map(x=>x.value),i=o.indexOf(eqYm),j=i-d;if(j>=0&&j<o.length){eqYm=o[j];this.render({})}};
    $('#eqPrev').onclick=()=>step(-1);$('#eqNext').onclick=()=>step(1);
    $('#eqRank').addEventListener('click',e=>{const b=e.target.closest('[data-uid]');if(b)go('ventas',{who:b.dataset.uid===me?'me':b.dataset.uid,f:{desde:eqYm,hasta:eqYm}})});
  },
  render(){
    if(!isLeader())return go('inicio');
    const now=ymNow(),months=[...new Set([now,...team.map(f=>f.date.slice(0,7))])].sort().reverse();
    if(!eqYm||!months.includes(eqYm))eqYm=now;
    $('#eqMes').innerHTML=months.map(m=>`<option value="${m}"${m===eqYm?' selected':''}>${esc(mLong(m))}</option>`).join('');
    const i=months.indexOf(eqYm);$('#eqPrev').disabled=i>=months.length-1;$('#eqNext').disabled=i<=0;
    const list=team.filter(f=>f.date.slice(0,7)===eqYm),R=resumen(list);
    const act=members.filter(m=>m.active);
    const per=act.map(m=>{const l=list.filter(f=>f.uid===m.id);return {m,n:l.length,late:l.filter(isLate).length,monto:l.reduce((a,f)=>a+(+f.amount||0),0),last:l.reduce((a,f)=>!a||byDate(f,a)>0?f:a,null)}});
    for(const uid of new Set(list.map(f=>f.uid)))if(!per.some(p=>p.m.id===uid)){const l=list.filter(f=>f.uid===uid);per.push({m:{id:uid,name:memberName(uid)+' (baja)'},n:l.length,late:l.filter(isLate).length,monto:l.reduce((a,f)=>a+(+f.amount||0),0),last:null})}
    per.sort((a,b)=>b.n-a.n||b.monto-a.monto||a.m.name.localeCompare(b.m.name));
    const conV=per.filter(p=>p.n).length;
    $('#eqSub').textContent=`${teamInfo?teamInfo.name:''} · ${plural(act.length,'integrante')}`;
    const k=(lb,v,s2,hero)=>`<div class="kpi${hero?' hero':''}"><div class="lb">${esc(lb)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s2)}</div></div>`;
    $('#eqKpis').innerHTML=k('FTDs de la mesa',nf(R.n),mLong(eqYm),true)+k('Monto',money(R.monto)+' USD',`prom ${nf(R.prom,1)} por FTD`)+
      k('Lates',`${R.lates} · ${pct(R.latePct)}`,R.lates?`prom ${nf(R.lateDias,1)} días`:'todos new')+
      k('Agentes con ventas',`${conV} de ${act.length}`,`${nf(conV?R.n/conV:0,1)} FTDs por agente`)+
      (per[0]&&per[0].n?k('Primero',per[0].m.name,plural(per[0].n,'FTD')):'');
    const max=Math.max(1,...per.map(p=>p.n));
    $('#eqRank').innerHTML=`<div class="rk" style="--vw:${Math.max(6,...per.map(p=>(`${p.n} · ${money(p.monto)}${p.late?' · '+p.late+' late':''}`).length))}ch">`+
      per.map(p=>`<button type="button" class="rk-row" data-uid="${esc(p.m.id)}" title="${esc(p.m.name)}: ${p.n} FTDs · ${money(p.monto)} USD"><span class="rk-name">${esc(p.m.name)}${p.m.id===me?' <span class="dim">(vos)</span>':''}</span><span class="rk-track"><span class="rk-bar" style="width:${p.n/max*100}%${p.n?'':';min-width:0'}"></span></span><span class="rk-val">${p.n} <span class="m">· ${money(p.monto)}${p.late?' · '+p.late+' late':''}</span></span></button>`).join('')+'</div>';
    const [Y,M]=eqYm.split('-').map(Number),days=eqYm===now?+todayS().slice(8,10):new Date(Y,M,0).getDate(),bd={};
    for(const f of list){const d=+f.date.slice(8,10),o=bd[d]||(bd[d]={a:0,b:0,m:0});if(isLate(f))o.b++;else o.a++;o.m+=+f.amount||0}
    const data=[];for(let d=1;d<=new Date(Y,M,0).getDate();d++){const o=bd[d]||{a:0,b:0,m:0},dw=new Date(Y,M-1,d).getDay();data.push({lab:String(d),a:o.a,b:o.b,m:o.m,d,dw,labC:dw===0||dw===6?'color-mix(in srgb,var(--dim) 55%,transparent)':''})}
    colChart($('#eqChart'),data,{h:210,capMin:18,label:'FTDs por día de la mesa',empty:'Sin FTDs este mes.',
      tip:d=>({title:`${DIAL[d.dw]} ${z(d.d)}/${z(M)}`,rows:[{v:String(d.a+d.b),l:'FTDs'},{key:'var(--s1)',v:String(d.a),l:'new'},{key:'var(--s2)',v:String(d.b),l:'late'},{v:money(d.m),l:'USD depositados'}]})});
    $('#eqCount').textContent=`${plural(conV,'agente')} con ventas · ${nf(days?R.n/days:0,2)} FTDs por día`;
    $('#eqTable').innerHTML=`<table class="pt"><thead><tr><th>Agente</th><th>Rol</th><th class="r">FTDs</th><th class="r">New</th><th class="r">Late</th><th class="r">Monto USD</th><th>Último FTD</th></tr></thead><tbody>`+
      per.map(p=>`<tr${p.m.id===me?' class="cur"':''}><td>${esc(p.m.name)}</td><td class="d">${p.m.role==='admin'?'admin':p.m.role==='leader'?'team leader':p.m.role?'agente':''}</td><td class="r">${p.n}</td><td class="r">${p.n-p.late}</td><td class="r">${p.late}</td><td class="r">${money(p.monto)}</td><td class="d">${p.last?`${dm(p.last.date)} ${esc(p.last.time||'')} · ${esc(p.last.id)}`:''}</td></tr>`).join('')+'</tbody></table>';
  },
};

/* ---------- mi cuenta y la mesa (en config) ---------- */
const who=()=>(profile&&profile.name?norm(profile.name.split(/\s+/)[0]).replace(/[^a-z0-9]/g,''):'')||'vitalis';
V.cuenta={
  build(){
    $('#cfNameSave').onclick=async()=>{const v=$('#cfName').value.trim();if(!v)return toast('Escribí tu nombre.','err');if(v===profile.name)return;if(await B.saveName(v))toast('✔ Nombre guardado.')};
    $('#cfName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#cfNameSave').click()}});
    $('#cfPass').onclick=()=>passModal();
    $('#cfCodeCopy').onclick=()=>navigator.clipboard.writeText(teamInfo.invite_code).then(()=>toast('✔ Código copiado.'),()=>toast('No pude copiar.','err'));
    $('#cfCodeNew').onclick=async()=>{if(await confirmar('Cambiar código','El código actual deja de servir para registrarse. Los que ya están siguen entrando normal.','cambiar'))if(await B.newCode())toast('✔ Nuevo código: <b>'+esc(teamInfo.invite_code)+'</b>')};
    $('#cfMembers').addEventListener('change',async e=>{const s=e.target.closest('[data-role]');if(!s)return;const m=members.find(x=>x.id===s.dataset.role);
      if(m&&await B.setMember(m.id,{role:s.value}))toast(`✔ ${esc(m.name)}: ${s.value==='admin'?'admin':s.value==='leader'?'team leader':'agente'}`);else this.render()});
    $('#cfMembers').addEventListener('click',async e=>{const b=e.target.closest('[data-act-m]');if(!b)return;const m=members.find(x=>x.id===b.dataset.id);if(!m)return;
      if(m.active){if(!await confirmar('Dar de baja',`¿Dar de baja a <b>${esc(m.name)}</b>? Deja de poder entrar a Vitalis. Sus ventas quedan en la mesa.`,'dar de baja',true))return;if(await B.setMember(m.id,{active:false}))toast(`✔ ${esc(m.name)} dado de baja.`)}
      else if(await B.setMember(m.id,{active:true}))toast(`✔ ${esc(m.name)} reactivado.`)});
  },
  render(){
    if(!profile)return;
    if($('#cfName')!==document.activeElement)$('#cfName').value=profile.name;
    $('#cfEmail').textContent=(profile.email||'')+(teamInfo?' · '+teamInfo.name:'');
    $('#cfRole').textContent=profile.role==='admin'?'administrador':profile.role==='leader'?'team leader':'agente';
    $('#cfTeamCard').hidden=!isAdmin();
    if(!isAdmin())return;
    $('#cfTeamName').textContent=teamInfo.name;$('#cfCode').textContent=teamInfo.invite_code;
    const list=[...members].sort((a,b)=>(b.active-a.active)||a.name.localeCompare(b.name));
    $('#cfMembers').innerHTML=`<div class="p-tablewrap"><table class="pt"><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th class="r">FTDs</th><th class="act"></th></tr></thead><tbody>`+
      list.map(m=>`<tr${m.active?'':' class="warn"'}><td>${esc(m.name)}${m.id===me?' <span class="dim">(vos)</span>':''}</td><td class="d trunc">${esc(m.email||'')}</td><td>${m.id===me||!m.active?`<span class="d">${m.role==='admin'?'admin':m.role==='leader'?'team leader':'agente'}</span>`:`<select data-role="${esc(m.id)}" aria-label="Rol de ${esc(m.name)}"><option value="agent"${m.role==='agent'?' selected':''}>agente</option><option value="leader"${m.role==='leader'?' selected':''}>team leader</option><option value="admin"${m.role==='admin'?' selected':''}>admin</option></select>`}</td><td class="r">${team.filter(f=>f.uid===m.id).length}</td><td class="act">${m.id===me?'':`<button type="button" class="btn sm${m.active?' danger':''}" data-act-m="1" data-id="${esc(m.id)}">${m.active?'dar de baja':'reactivar'}</button>`}</td></tr>`).join('')+'</tbody></table></div>';
  },
};
function passModal(){
  modal({title:'Cambiar contraseña',body:`<label class="fld"><span>Nueva contraseña (mínimo 6)</span><input type="password" id="np1" autocomplete="new-password"></label><label class="fld" style="margin-top:10px"><span>Repetila</span><input type="password" id="np2" autocomplete="new-password"></label><div class="ebox" id="npErr"></div>`,
    actions:[{l:'cancelar'},{l:'guardar',cls:'pri',fn:async api=>{const a=api.q('#np1').value,b=api.q('#np2').value;
      if(a.length<6){api.q('#npErr').textContent='Tiene que tener al menos 6 caracteres.';return false}if(a!==b){api.q('#npErr').textContent='No coinciden.';return false}
      const {error}=await sb.auth.updateUser({password:a});if(error){api.q('#npErr').textContent=errMsg(error);return false}toast('✔ Contraseña cambiada.')}}]});
}

/* ---------- respaldo del panel anterior ---------- */
function importarRespaldo(){
  const fi=$('#file');fi.value='';fi.accept='.json,application/json';
  fi.onchange=async()=>{
    fi.accept='.csv,text/csv,text/plain';
    const file=fi.files[0];if(!file)return;
    let J;try{J=JSON.parse(await file.text())}catch(e){return toast('Ese archivo no es un respaldo válido.','err')}
    if(!J||J.app!=='ftd-panel'||!Array.isArray(J.ftds))return toast('Ese archivo no es un respaldo del panel FTD.','err');
    const K=dupKeys(),rows=J.ftds.map(cleanExtRow).filter(Boolean),nuevas=rows.filter(x=>!isDup(x,K));
    const pendN=(J.pend||[]).filter(p=>p&&p.id&&p.due&&!pend.some(x=>x.id===p.id&&x.due===p.due));
    const tu=Object.keys(J.turnos||{}).filter(d=>!turnos[d]);
    const html=`<b>${plural(nuevas.length,'venta nueva','ventas nuevas')}</b>${rows.length-nuevas.length?` · ${rows.length-nuevas.length} ya estaban`:''}<br>${plural(pendN.length,'contacto')} de agenda · ${plural(tu.length,'jornada')} · ${plural(Object.keys(J.ajustes||{}).length,'mes','meses')} con FTDs sin detalle<br>${J.cfg?'y tu configuración (sueldo, bonos, dólar, días de trabajo, faltas)':''}`;
    if(!await confirmar(`Importar respaldo · ${esc(file.name)}`,html,'importar'))return;
    const T=toast('importando…','ok',{sticky:1});
    try{
      if(J.cfg){cfg={...DEF,...cfg,...J.cfg};applyTheme();await B.saveCfg()}
      for(const [ym,n] of Object.entries(J.ajustes||{}))if(+n>0)await Q(sb.from('adjustments').upsert({user_id:me,ym,n:+n}));
      Object.assign(ajustes,Object.fromEntries(Object.entries(J.ajustes||{}).map(([k,v])=>[k,+v])));
      for(const d of tu){const t=J.turnos[d];await Q(sb.from('shifts').upsert({user_id:me,date:d,data:t}));turnos[d]={...t,breaks:t.breaks||[]}}
      if(pendN.length){const rws=await Q(sb.from('agenda').insert(pendN.map(p=>P2A({n:p.n,id:p.id,kw:p.kw,due:p.due,notified:!!p.notified,done:!!p.done,doneAt:p.doneAt||null}))).select());pend.push(...rws.map(A2P))}
      if(nuevas.length){const keep=new Map(J.ftds.filter(f=>f&&f.n).map(f=>[norm(f.brand||'')+'|'+norm(f.id),f.n]));
        let n=nextN()-1;const list=nuevas.sort(byDate).map(f=>({...f,n:keep.get(norm(f.brand)+'|'+norm(f.id))||++n}));
        await B.addMany(list,(i,t)=>T.set(`importando ventas… ${i}/${t}`))}
      T.close();toast('✔ Respaldo importado.');refresh();
    }catch(e){T.close();dbErr(e)}
  };
  fi.click();
}

/* ---------- arranque ---------- */

function onReady(){
  ready=true;applyTheme();
  document.body.classList.remove('auth');const A=$('#auth');if(A)A.remove();
  $$('.who').forEach(e=>e.textContent=who());
  $('#navEquipo').hidden=!isLeader();
  let h='';try{h=location.hash.slice(1)}catch(e){}
  go(VIEWS.includes(h)?h:'inicio');
  status();check();setInterval(check,15000);setInterval(tick,1000);turnoBar(true);
  addEventListener('online',status);addEventListener('offline',status);
  if(!ftds.length&&!team.length)toast(`👋 Bienvenido a Vitalis, ${esc(profile.name)}. Cargá tu primera venta con <b>+ FTD</b> o importá tu historial en config.`,'ok',{ms:12000});
}
function boot(){
  $('#ver').textContent='v'+VERSION;
  for(const v of VIEWS)V[v].build();
  V.cuenta.build();
  window.addEventListener('hashchange',()=>{if(!ready)return;let h='';try{h=location.hash.slice(1)}catch(e){}if(VIEWS.includes(h)&&h!==cur)go(h)});
  let lastW=0;try{new ResizeObserver(en=>{const w=Math.round(en[0].contentRect.width);if(Math.abs(w-lastW)>8){lastW=w;refresh()}}).observe($('#main'))}catch(e){}
  status();
  start();
}
boot();
