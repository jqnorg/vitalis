
/* ============================================================
   Vistas
   ============================================================ */
function bonoTrack(n,lite,tg){ // la pista del mes: el mate avanza con cada FTD (tg: tu target, si hay)
  const T=tiers();if(!T.length)return '';
  const top=Math.max(T[T.length-1][0]+3,n+1,(tg||0)+2),P=v=>Math.min(100,v/top*100),cur=porCantidad(n).tier;
  return `<div class="track${lite?' lite':''}" role="meter" aria-valuemin="0" aria-valuemax="${top}" aria-valuenow="${n}" aria-label="FTDs del mes hacia los bonos">
    <div class="rail"></div><div class="fill" style="width:${P(n)}%"></div>
    ${T.map(([t])=>`<i class="st${n>=t?' on':''}" style="left:${P(t)}%"></i>`).join('')}
    ${T.map(([t,b])=>`<span class="lb${t===cur?' at':''}" style="left:${P(t)}%"><b>${t}</b><span class="us">${b} USD</span></span>`).join('')}
    ${tg?`<i class="ut-tick${n>=tg?' ok':''}" style="left:${P(tg)}%" title="Tu target: ${tg} FTDs"></i><span class="ut-lb${n>=tg?' ok':''}" style="left:${P(tg)}%">target</span>`:''}
    <span class="glow" style="left:${P(n)}%" title="${plural(n,'FTD')}"></span></div>`;
}
const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;
function convCards(uid){ // conversión de hoy, la semana y el mes: FTDs ÷ clientes new
  const te=todayS(),P=[['Hoy',te,te],['Esta semana',weekStart(te),te],['Este mes',te.slice(0,8)+'01',te]];
  return `<div class="conv3">${P.map(([l,a,b])=>{const c=convPeriod(a,b,uid);
    return `<div class="cv"><div class="lb">${l}</div><div class="v${c.rate==null?' none':''}">${c.rate==null?'—':pct(c.rate)}</div><div class="s">${plural(c.ftd,'FTD')} de ${plural(c.leads,'cliente')}</div><div class="bar"><i style="width:${c.rate==null?0:Math.min(100,c.rate*100)}%"></i></div></div>`}).join('')}</div>`;
}
const kpi=(lb,v,s,cls='',extra='')=>`<div class="kpi ${cls}"${extra}><div class="lb">${lb}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
const rw=(k,v,cls='')=>`<div class="rw ${cls}"><span class="k">${k}</span><span class="d"></span><span class="v">${v}</span></div>`;

/* ---------- inicio ---------- */
// la racha: días laborables seguidos con al menos un FTD (si hoy todavía no vendiste, cuenta hasta ayer; los días que no se trabajan no la cortan)
function racha(uid){
  const days=new Set(team.filter(f=>f.uid===uid).map(f=>f.date)),te=todayS();
  let d=te,n=0;const hoy=days.has(te);if(!hoy)d=addDays(te,-1);
  for(let i=0;i<500;i++){if(days.has(d))n++;else if(!noTrabajo(d)||(cfg.faltas||[]).some(x=>x.d===d))break;d=addDays(d,-1)}
  return {n,hoy};
}
V.inicio={
  k:'',
  build(){},
  render(){
    const now=new Date(),te=todayS(),ym=ymNow(),s=calc(ym),P=sueldoPesos(s),h=now.getHours();
    $('#iHola').textContent=`${h<13?'Buen día':h<20?'Buenas tardes':'Buenas noches'}, ${profile.name.split(/\s+/)[0]}`;
    $('#iFecha').textContent=`${cap(DIAL[now.getDay()])} ${+te.slice(8)} de ${MES[now.getMonth()]}`;
    const hoy=ftds.filter(f=>f.date===te),t=openTurno()||turnos[te],m=t?metr(t):null;
    const mes=MES[+ym.slice(5,7)-1];
    const sub=s.extra?`${s.loaded} cargados + ${s.extra} sin detalle`:`tus clientes depositaron ${money(s.monto)} USD`;
    const msg=s.next?`Faltan <b>${s.next[0]-s.n}</b> para el bono de <b>${s.next[1]} USD</b>`:s.n?'<b>Bono máximo.</b> Esto merece un mate 🧉':'La primera venta del mes pone el mate en marcha.';
    const TL=tlView(); // el team leader ve la mesa entera
    const cr=convPeriod(ym+'-01',te,me); // CR (%) del mes: de tus news del mes, cuántos depositaron (el segundo dato del rendimiento)
    if(TL)$('#iHero').innerHTML=mesaHero();else $('#iHero').innerHTML=`<div class="top"><div><div class="n">${s.n}</div><div class="lab">Tus FTDs en ${esc(mes)}</div><div class="msg">${msg}</div>${utLine(s.n)}<div class="cr" title="CR (%): conversión del mes. De tus clientes new del mes, cuántos depositaron."><b class="cr-t">CR (%)</b> <b class="cr-v">${cr.rate==null?'—':esc(pct(cr.rate))}</b> <span class="d">${cr.leads?`${plural(cr.ftd,'FTD')} de ${plural(cr.leads,'new')} este mes`:'sin news este mes todavía'}</span></div></div><span class="grow"></span>
      <div class="usd"><div class="v">${money(s.usd)} <small>USD</small></div><div class="s">${cfg.porftd} USD por FTD${s.bono?` + bono ${s.bono}`:''} · ${esc(sub)}</div></div></div>${bonoTrack(s.n,false,utOf(me))}`;
    const ws=weekStart(te),wN=ftds.filter(f=>f.date>=ws&&f.date<=te).length,pw=addDays(ws,-7),pwN=ftds.filter(f=>f.date>=pw&&f.date<=addDays(te,-7)).length;
    $('#iKpis').innerHTML=TL?mesaSide():
      kpi('Hoy',`${hoy.length} <small>FTD${hoy.length===1?'':'s'}</small>`,`${money(hoy.reduce((a,f)=>a+(+f.amount||0),0))} USD${m&&m.fph!=null&&hoy.length?' · '+nf(m.fph,2)+' por hora':''}`)+
      kpi('Esta semana',`${wN} <small>FTD${wN===1?'':'s'}</small>`,`A esta altura la semana pasada: ${pwN}`)+
      (()=>{const r=racha(me);return kpi('Racha',`<svg class="ic" aria-hidden="true"><use href="#i-racha"/></svg>${r.n} <small>día${r.n===1?'':'s'}</small>`,r.n?(r.hoy?'Vendiendo seguido, hoy incluido':'Vendé hoy para no cortarla'):'Tu primera venta la arranca','racha'+(r.n>=3?' on':''))})();
    $('#iBank').hidden=true; // las fallas de pago ya no van en el Inicio (lo pidió el dueño): quedan en Banking y en la marca del menú
    crmLoad();const ah=TL?ahoraCard():'';$('#iAhora').hidden=!ah;$('#iAhora').innerHTML=ah; // la cola de la mesa (team leader); al agente la franja y el Panel ya se lo dicen
    $('#iMesa').hidden=false;$('#iMesa').innerHTML=TL?mesaBoard():mesaCard(); // la mesa contra su target
    $('#iHoy').innerHTML=hoyMesaCard();
    {const dl=TL?'':diaLine();$('#iDia').hidden=!dl;$('#iDia').innerHTML=dl}hotNotify(); // tu día según a qué hora llegó el primer FTD; campaña caliente
    this.turno(true);
  },
  turno(force){
    if(cur!=='inicio')return;
    const {t,b,h,key}=turnoState(),now=Date.now(),day=t||h;
    if(force||key!==this.k){
      this.k=key;let bt='';
      // los botones del turno están en la barra de arriba (una sola vez); acá, el tiempo y las marcas del día
      if(!t)bt=h&&h.out?'<button type="button" class="btn" data-act="entrada">Reabrir turno</button>':'<button type="button" class="btn pri big" data-act="entrada">Marcar entrada</button>';
      else if(b)bt=`<button type="button" class="btn pri big" data-act="vuelta">Volví ${isBano(b)?'del baño':'del descanso'}</button>`;
      else bt=day?`<span class="marks">${marksHTML(day)}</span>`:'';
      if(day)bt+='<span style="flex:1"></span><button type="button" class="ib" data-go="turnos" title="Ver, deshacer o corregir las marcas en Turnos">Corregir</button>';
      $('#itBtns').innerHTML=bt;
    }
    let st='<span class="dim">Todavía no marcaste entrada hoy.</span>';
    if(day){
      const m=metr(day,now);
      if(b&&isBano(b))st=`<span class="big">${mmss(now-b.s)}</span><span>En el baño desde las ${hhmm(b.s)}</span>`;
      else if(b){const left=b.s+b.k*6e4-now;st=`<span class="big${left<0?' hot':''}">${left>=0?mmss(left):'+'+mmss(-left)}</span><span>Descanso de ${b.k}': ${left>=0?'volvés a las '+hhmm(b.s+b.k*6e4):sp('hot','te pasaste')}</span>`}
      else if(t){const rest=m.salidaEst-now;st=`<span class="big">${durS(m.total)}</span><span>${rest>0?`Salís a las ${hhmm(m.salidaEst)}, faltan ${dur(rest)}`:sp('hot','+'+dur(-rest)+' extra')}</span>`}
      else st=`<span class="big">${durS(m.total)}</span><span>${hhmm(day.in)} a ${hhmm(day.out)}, ${Math.abs(m.extra)<6e4?'justo':m.extra>0?sp('hot','+'+dur(m.extra)+' extra'):dur(-m.extra)+' menos'}</span>`;
    }
    $('#itState').innerHTML=st;
    {const el=$('#itRitmo');if(el){const h=tlView()?'':ritmoLine(me);el.hidden=!h;el.innerHTML=h}} // tu ritmo de hoy: llamadas, tiempo muerto y franja
    $('#itTl').innerHTML=day?timeline(day,now):'';
  },
};
function timeline(t,now){
  const end=t.out||now,tgt=t.in+jorMs(),span=Math.max(end,tgt)-t.in||1,P=ms=>Math.max(0,Math.min(100,(ms-t.in)/span*100));
  let s=`<div class="seg wk" style="left:0;width:${P(end)}%"></div>`;
  for(const b of t.breaks){const e=b.e||end,ex=!isBano(b)&&e-b.s>b.k*6e4+6e4;s+=`<div class="seg br${ex?' x':''}" style="left:${P(b.s)}%;width:${Math.max(.8,P(e)-P(b.s))}%" title="${brTxt(b)} ${hhmm(b.s)}–${b.e?hhmm(b.e):'…'}"></div>`}
  s+=`<div class="seg" style="left:calc(${P(tgt)}% - 2px);width:0;border-left:2px dashed var(--fg);opacity:.7" title="fin de jornada ${hhmm(tgt)}"></div>`;
  if(!t.out)s+=`<div class="now" style="left:calc(${P(now)}% - 1px)"></div>`;
  return `<div class="tl" role="img" aria-label="Jornada desde ${hhmm(t.in)}">${s}</div><div class="tll"><span>${hhmm(t.in)}</span><span>${t.out?'salida '+hhmm(t.out):'fin '+hhmm(tgt)}</span></div>`;
}
function marksHTML(t){
  const p=[`Entrada <b>${hhmm(t.in)}</b>`];
  for(const b of t.breaks){const d=(b.e||Date.now())-b.s,ex=isBano(b)?0:d-b.k*6e4;p.push(`${isBano(b)?'Baño':`Descanso ${b.k}'`} <b>${hhmm(b.s)}–${b.e?hhmm(b.e):'…'}</b>${b.e?` ${mins(d)} min${ex>=6e4?' '+sp('hot','+'+mins(ex)):''}`:''}`)}
  if(t.out)p.push(`Salida <b>${hhmm(t.out)}</b>`);
  return p.map(x=>`<span>${x}</span>`).join('');
}

/* ---------- ventas ---------- */
const PRESETS=[['hoy','hoy'],['ayer','ayer'],['sem','esta semana'],['semp','la semana pasada'],['d7','últimos 7 días'],['mes','este mes'],['mesp','el mes pasado'],['d30','últimos 30 días']];
function presetRange(k){ // [desde, hasta] · null = todo · undefined = fechas elegidas a mano
  const te=todayS(),ws=weekStart(te),ym=te.slice(0,7),pm=addDays(ym+'-01',-1).slice(0,7);
  if(!k)return null;if(k==='x')return undefined;if(k.startsWith('m:'))return [k.slice(2),k.slice(2)];
  return {hoy:[te,te],ayer:[addDays(te,-1),addDays(te,-1)],sem:[ws,te],semp:[addDays(ws,-7),addDays(ws,-1)],d7:[addDays(te,-6),te],mes:[ym+'-01',te],mesp:[pm,pm],d30:[addDays(te,-29),te]}[k]||null;
}
let pF={},pShow=40,pExpand={},pBuiltKey='',pWho='me';
const whoList=()=>pWho==='me'?ftds:pWho==='all'?team:team.filter(f=>f.uid===pWho);
const whoLabel=()=>pWho==='me'?'Mis ventas':pWho==='all'?'Toda la mesa':memberName(pWho);
V.ventas={
  build(){
    let qt=null;
    $('#pQ').addEventListener('input',e=>{clearTimeout(qt);qt=setTimeout(()=>{pF.q=e.target.value.trim()||undefined;pShow=40;this.render({})},180)});
    $('#pChartTblBtn').addEventListener('click',()=>{const t=$('#pChartTbl');t.hidden=!t.hidden;$('#pChartTblBtn').textContent=t.hidden?'Ver tabla':'Ocultar tabla'});
    $('#pMore').addEventListener('click',()=>{pShow+=60;this.render({})});
    $('#pWho').addEventListener('change',e=>{pWho=e.target.value;pShow=40;pBuiltKey='';this.render({})});
  },
  whoSelect(){
    const sel=$('#pWho');if(sel===document.activeElement)return;
    const ms=members.filter(m=>m.id!==me&&(m.active||team.some(f=>f.uid===m.id)));
    sel.innerHTML=`<option value="me">Yo</option><option value="all">Toda la mesa</option>`+ms.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}${m.active?'':' (desvinculado)'}</option>`).join('');
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
        `<label>Período<select id="pPer">${o('','todo')}${PRESETS.map(([k,l])=>o(k,l)).join('')}<optgroup label="Meses">${[...months].reverse().map(m=>o('m:'+m,mLabel(m))).join('')}</optgroup>${o('x','fechas elegidas')}</select></label>`+
        `<label>Desde<input type="date" data-f="desde" max="${todayS()}"></label>`+
        `<label>Hasta<input type="date" data-f="hasta"></label>`+
        `<label>Marca<select data-f="marca">${o('','todas')}${brands.map(b=>o(b,b)).join('')}</select></label>`+
        `<label>Afiliador<input data-f="aff" list="dlAff" placeholder="todos" autocomplete="off"></label>`+
        `<label>Campaña<input data-f="camp" list="dlCamp" placeholder="todas" autocomplete="off"></label>`+
        `<label>País<select data-f="pais">${o('','todos')}${countries.map(p=>o(p,p)).join('')}</select></label>`+
        `<label>Tipo<select data-f="late">${o('','todos')}${o('no','new')}${o('si','late')}</select></label>`+
        `<button class="btn sm" type="button" id="pClear" style="margin-bottom:4px">Limpiar</button>`+
        dlist('dlAff',affs)+dlist('dlCamp',camps);
      $$('[data-f]',$('#pFilters')).forEach(el=>{
        el.addEventListener('change',()=>{const v=el.value.trim();pF[el.dataset.f]=v||undefined;pShow=40;this.render({})});
        if(el.tagName==='INPUT')el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();el.dispatchEvent(new Event('change'))}});
      });
      $('#pClear').addEventListener('click',()=>{pF={};$('#pQ').value='';pShow=40;this.render({})});
      $('#pPer').addEventListener('change',e=>{const r=presetRange(e.target.value);if(r===undefined)return;pF.desde=r?r[0]:undefined;pF.hasta=r?r[1]:undefined;pShow=40;
        const R2=fRange(pF);$('#pFilters [data-f=desde]').value=R2.a||'';$('#pFilters [data-f=hasta]').value=R2.b||'';this.render({})});
    }
    const R=fRange(pF),per=$('#pPer');
    if(per!==document.activeElement){const m=['',...PRESETS.map(x=>x[0]),...months.map(x=>'m:'+x)].find(k=>{const r=presetRange(k);return r===null?!R.a&&!R.b:r&&fRange({desde:r[0],hasta:r[1]}).a===R.a&&fRange({desde:r[0],hasta:r[1]}).b===R.b});per.value=m!=null?m:'x'}
    $$('[data-f]',$('#pFilters')).forEach(el=>{
      if(el===document.activeElement)return;
      const k=el.dataset.f;let v=k==='desde'?(R.a||''):k==='hasta'?(R.b||''):(pF[k]||'');
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
    const FR=fRange(pF),dA=FR.a||(list.length?list.reduce((m,x)=>x.date<m?x.date:m,list[0].date):null),dB=FR.b&&FR.b<todayS()?FR.b:todayS();
    const span=FR.a&&dA&&dB>=dA?spanDays(dA,dB):0,porDia=span&&span<=62; // rango corto: todo por día
    $('#pSub').textContent=whoLabel()+' · '+fDesc(pF);
    const top=dim=>groupBy(list,dim)[0]||null;
    const tc=pF.camp?null:top('campanas'),ta=pF.aff?null:top('afiliados');
    const k=(lb,v,s,hero)=>`<div class="kpi${hero?' hero':''}"><div class="lb">${esc(lb)}</div><div class="v" title="${esc(v)}">${esc(v)}</div><div class="s" title="${esc(s)}">${esc(s)}</div></div>`;
    $('#pKpis').innerHTML=
      k('FTDs',nf(R.n),porDia?`${plural(span,'día')} · ${nf(R.n/span,1)} por día`:`${R.meses} mes${R.meses===1?'':'es'} · ${nf(R.porMes,1)} por mes`,true)+
      k('Monto',money(R.monto)+' USD',`prom ${nf(R.prom,1)} por FTD`)+
      k('Lates',`${R.lates} · ${pct(R.latePct)}`,R.lates?`prom ${nf(R.lateDias,1)} días`:'todos new')+
      (porDia?(()=>{const bd={};for(const x of list)bd[x.date]=(bd[x.date]||0)+1;const b=Object.entries(bd).sort((x,y)=>y[1]-x[1]||(x[0]<y[0]?1:-1))[0];
        return k('Mejor día',b?`${DIA[parseYMD(b[0]).getDay()]} ${dm(b[0])}`:'—',b?`${b[1]} FTDs`:'')})():k('Mejor mes',R.best?mLabel(R.best[0]):'—',R.best?`${R.best[1]} FTDs`:''))+
      (tc?k('Top campaña',tc.k,`${tc.n} FTDs · ${money(tc.monto)} USD`):'')+
      (ta?k('Top afiliador',ta.k,`${ta.n} FTDs · ${money(ta.monto)} USD`):'')+
      (many&&list.length?(()=>{const g=groupBy(list,'vendedores')[0];return k('Top vendedor',g.k,`${g.n} FTDs · ${money(g.monto)} USD`)})():'');
    // por mes (o por día, si el rango es corto)
    const data=porMes(list,pF),plain=sinFiltros(pF);
    $('#pChartH').textContent=porDia?'FTDs por día':'FTDs por mes';
    if(porDia){
      const days=[];for(let d=dA,i=0;d<=dB&&i<70;d=addDays(d,1),i++){const l=list.filter(x=>x.date===d),late=l.filter(isLate).length,w=parseYMD(d).getDay();
        days.push({d,a:l.length-late,b:late,n:l.length,late,monto:l.reduce((s2,x)=>s2+(+x.amount||0),0),lab:String(+d.slice(8)),labC:w===0||w===6?'color-mix(in srgb,var(--dim) 55%,transparent)':''})}
      colChart($('#pChart'),days,{h:230,int:true,capMin:14,label:'FTDs por día',empty:'Sin ventas para estos filtros.',
        tip:d=>({title:`${cap(DIAL[parseYMD(d.d).getDay()])} ${dm(d.d)}`,rows:[{v:String(d.n),l:'FTDs'},{key:'var(--s1)',v:String(d.a),l:'new'},{key:'var(--s2)',v:String(d.b),l:'late'},{v:money(d.monto),l:'USD depositados'}]})});
      $('#pChartTbl').innerHTML=`<table class="pt"><thead><tr><th>Día</th><th class="r">FTDs</th><th class="r">New</th><th class="r">Lates</th><th class="r">Monto USD</th></tr></thead><tbody>`+
        days.map(d=>`<tr><td>${esc(DIA[parseYMD(d.d).getDay()])} ${dm(d.d)}</td><td class="r">${d.n}</td><td class="r">${d.a}</td><td class="r">${d.b}</td><td class="r">${money(d.monto)}</td></tr>`).join('')+'</tbody></table>';
    }else{
    colChart($('#pChart'),data.map(d=>({...d,a:d.n-d.late,b:d.late,lab:MES[+d.ym.slice(5,7)-1].slice(0,3)+(d.ym===data[0].ym||d.ym.endsWith('-01')?" '"+d.ym.slice(2,4):'')})),{h:230,label:'FTDs por mes',empty:'Sin ventas para estos filtros.',
      tip:d=>{const rows=[{v:String(d.n),l:'FTDs'},{key:'var(--s1)',v:String(d.a),l:'new'},{key:'var(--s2)',v:String(d.b),l:'late'},{v:money(d.monto),l:'USD depositados'}];
        if(plain&&pWho==='me')rows.push({v:money(porCantidad(calc(d.ym).n).usd),l:'USD de variable'});return {title:mLong(d.ym),rows}}});
    const pl=plain&&pWho==='me';
    $('#pChartTbl').innerHTML=data.length?`<table class="pt"><thead><tr><th>Mes</th><th class="r">FTDs</th><th class="r">New</th><th class="r">Lates</th><th class="r">Monto USD</th>${pl?'<th class="r">Variable USD</th>':''}</tr></thead><tbody>`+
      data.map(d=>`<tr><td>${esc(mLabel(d.ym))}</td><td class="r">${d.n}</td><td class="r">${d.n-d.late}</td><td class="r">${d.late}</td><td class="r">${money(d.monto)}</td>${pl?`<td class="r">${money(porCantidad(calc(d.ym).n).usd)}</td>`:''}</tr>`).join('')+'</tbody></table>':'';
    }
    $('#dCard').hidden=pWho!=='me';if(pWho==='me')this.dias(list);
    // rankings
    const rk=$('#pRanks');rk.textContent='';
    for(const dim of many?['vendedores','campanas','afiliados','paises']:['campanas','afiliados','paises','marcas']){
      const D=DIMS[dim],g=groupBy(list,dim),max=g[0]?g[0].n:1;
      const card=document.createElement('section');card.className='card';
      card.innerHTML=`<div class="card-h"><h3>${esc(D.t)}</h3><span class="p-sub">${g.length}</span></div>`;
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
      if(g.length>8){const mb=document.createElement('button');mb.type='button';mb.className='btn sm rk-more';mb.textContent=pExpand[dim]?'Ver menos':`Ver todas (${g.length})`;
        mb.addEventListener('click',()=>{pExpand[dim]=!pExpand[dim];this.render({})});card.appendChild(mb)}
      rk.appendChild(card);
    }
    // tabla
    const rows=[...list].sort((a,b)=>-byDate(a,b));
    $('#pCount').textContent=`${plural(rows.length,'venta')} · ${money(R.monto)} USD`;
    $('#pTable').innerHTML=rows.length?`<table class="pt"><thead><tr><th>Fecha</th><th>ID</th><th>Nombre</th><th>País</th><th>Afiliador</th><th>Campaña</th><th class="r">Monto</th><th>Registro</th><th>Tipo</th><th>Marca</th>${pWho!=='me'?'<th>Vendedor</th>':''}<th class="act"></th></tr></thead><tbody>`+
      rows.slice(0,pShow).map(f=>`<tr><td>${esc(dm(f.date))}/${f.date.slice(2,4)} <span class="d">${esc(f.time||'')}</span></td><td>${esc(f.id)}</td><td class="trunc" title="${esc(f.name)}">${esc(f.name)}</td><td>${esc(f.country)}</td><td>${esc(f.aff)}</td><td class="trunc" title="${esc(f.camp)}">${esc(f.camp)}</td><td class="r">${money(f.amount)}</td><td class="d">${esc(f.reg?dm(String(f.reg).slice(0,10)):'')}</td><td title="${esc(demora(f)?'Depositó a '+demora(f)+' del registro':'')}">${isLate(f)?`<i class="dot"></i>late ${lateDays(f)} d`:`<i class="dot n"></i><span class="d">new${demora(f)?' · '+esc(demora(f)):''}</span>`}</td><td class="d">${esc(f.brand||'')}</td>${pWho!=='me'?`<td class="trunc">${esc(memberName(f.uid))}</td>`:''}<td class="act wr">${canEdit(f)?`<button type="button" class="ib" data-act="editFtd" data-id="${esc(f._id)}" title="Editar">Editar</button><button type="button" class="ib del" data-act="delFtd" data-id="${esc(f._id)}" title="Borrar">Borrar</button>`:''}</td></tr>`).join('')+'</tbody></table>'
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
// el team leader ve las agendas de toda la mesa (solo lectura; cada uno maneja las suyas)
function agMesaHTML(now,te){
  if(!isLeader())return '';
  const open=teamAg.filter(p=>!p.done&&p.uid!==me).sort(byDue);if(!open.length)return '';
  const it=p=>`<div class="ai"><span class="wh">${esc(whenTxt(parseDue(p.due)))}</span><span class="id">${esc(p.id)}</span><span class="kw">${esc(p.kw)}<small>${esc(memberName(p.uid))}</small></span><span></span></div>`;
  const venc=open.filter(p=>parseDue(p.due)<now),hoy=open.filter(p=>parseDue(p.due)>=now&&p.due.slice(0,10)===te),prox=open.filter(p=>p.due.slice(0,10)>te);
  const g=(t,l,c='')=>l.length?`<div class="grp"><h4 class="${c}">${t} (${l.length})</h4><div class="alist">${l.slice(0,80).map(it).join('')}</div></div>`:'';
  return `<h3 class="ag-mesa">Agendas de la mesa</h3>`+g('Vencidas',venc,'warn')+g('Hoy',hoy)+g('Próximas',prox);
}
V.agenda={
  build(){bindAgForm($('#agForm'))},
  render(){
    if(agF)agF.slots();
    const now=new Date(),te=todayS();
    const open=pend.filter(p=>!p.done).sort(byDue),done=pend.filter(p=>p.done).sort((a,b)=>(b.doneAt||'').localeCompare(a.doneAt||''));
    const venc=open.filter(p=>parseDue(p.due)<=now),hoy=open.filter(p=>parseDue(p.due)>now&&p.due.slice(0,10)===te),prox=open.filter(p=>p.due.slice(0,10)>te);
    $('#agSub').innerHTML=`${plural(open.length,'pendiente')}${venc.length?' · '+sp('hot b',plural(venc.length,'vencido')):''}${extOn()?' · '+sp('ok','avisos de Chrome activos'):''}`;
    const grp=(t,list,cls='')=>list.length?`<div class="grp"><h4 class="${cls}">${t} (${list.length})</h4><div class="alist">${list.map(p=>pendItem(p,now)).join('')}</div></div>`:'';
    const shown=agAllDone?done:done.slice(0,10);
    $('#agLists').innerHTML=(open.length?'':'<div class="p-empty">Nada pendiente. Buen momento para un mate.</div>')+grp('Vencidos',venc,'warn')+grp('Hoy',hoy)+grp('Próximos',prox)+
      (done.length?`<div class="grp"><h4>Hechos (${done.length})</h4><div class="alist">${shown.map(p=>pendItem(p,now)).join('')}</div>${done.length>10?`<button type="button" class="btn sm rk-more" id="agMore">${agAllDone?'Ver menos':'Ver todos'}</button>`:''}</div>`:'')+agMesaHTML(now,te);
    const mb=$('#agMore');if(mb)mb.onclick=()=>{agAllDone=!agAllDone;this.render({})};
  },
};

/* ---------- turnos ---------- */
let tuPer='semana',tuYm='';
const PER=[['hoy','Hoy'],['semana','Esta semana'],['semanaP','Semana pasada'],['mes','Este mes'],['mesP','Mes anterior']];
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
    $('#tuPer').innerHTML=PER.map(([k,l])=>`<button type="button" data-per="${k}">${l}</button>`).join('');
    $('#tuPer').addEventListener('click',e=>{const c=e.target.closest('[data-per]');if(!c)return;tuPer=c.dataset.per;tuYm='';this.render({})});
    $('#tuMes').addEventListener('change',e=>{tuYm=e.target.value;this.render({})});
  },
  render(){
    $$('[data-per]',$('#tuPer')).forEach(c=>c.classList.toggle('on',!tuYm&&c.dataset.per===tuPer));
    const months=[...new Set(Object.keys(turnos).map(k=>k.slice(0,7)))].sort().reverse();
    $('#tuMes').innerHTML=`<option value="">Otro mes…</option>`+months.map(m=>`<option value="${m}"${m===tuYm?' selected':''}>${esc(mLabel(m))}</option>`).join('');
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
      [...rows].reverse().map(r=>`<tr${r.t.out?'':' class="cur"'}><td>${DIA[parseYMD(r.t.date).getDay()]} ${dm(r.t.date)}</td><td>${hhmm(r.t.in)}</td><td>${r.t.out?hhmm(r.t.out):'<span class="info">en curso</span>'}</td><td class="r">${durS(r.total)}</td><td class="r${r.extra>=6e4&&r.t.out?' hot':''}">${!r.t.out?'':Math.abs(r.extra)<6e4?'0':(r.extra>0?'+':'−')+durS(Math.abs(r.extra))}</td><td class="r${r.exceso>=6e4?' hot':''}">${mins(r.desc)} min${r.exceso>=6e4?' (+'+mins(r.exceso)+')':''}</td><td class="r">${r.ftd}</td><td class="r">${r.fph!=null?nf(r.fph,2):'—'}</td><td class="r d">${r.cont||''}</td><td class="act wr"><button type="button" class="ib" data-act="editTurno" data-d="${r.t.date}" title="Editar">Editar</button></td></tr>`).join('')+'</tbody></table>';
  },
};

/* ---------- sueldo ---------- */
let suYm='',siN=null;
/* ---------- día de cobro: el 5º día hábil del mes ----------
   Hábil: lunes a sábado que se trabaje en la mesa (tus días laborables), sin domingos, feriados que no se trabajan ni días libres (MTSS). */
const ymStep=(ym,d)=>{let [y,m]=ym.split('-').map(Number);m+=d;while(m>12){m-=12;y++}while(m<1){m+=12;y--}return `${y}-${z(m)}`};
function payDays(ym){ // los 5 primeros días hábiles del mes
  const [Y,M]=ym.split('-').map(Number),last=new Date(Y,M,0).getDate(),out=[];
  for(let d=1;d<=last&&out.length<5;d++){const k=`${ym}-${z(d)}`;if(parseYMD(k).getDay()===0)continue;const r=noTrabajo(k);if(r&&r!=='falta')continue;out.push(k)}
  return out;
}
function nextPay(){ // el próximo cobro: este mes (si todavía no pasó) o el que viene
  const te=todayS(),ym=te.slice(0,7);let D=payDays(ym),pay=D[4]||`${ym}-10`;
  if(te<=pay)return {pay,days:D,of:ymStep(ym,-1)};
  const n=ymStep(ym,1);D=payDays(n);return {pay:D[4]||`${n}-10`,days:D,of:ym};
}
function cobroCard(){
  const te=todayS(),N=nextPay(),dd=Math.round((parseYMD(N.pay)-parseYMD(te))/864e5),pd=parseYMD(N.pay);
  let hab=0;for(let d=addDays(te,1),i=0;d<=N.pay&&i<45;d=addDays(d,1),i++){if(parseYMD(d).getDay()===0)continue;const r=noTrabajo(d);if(!r||r==='falta')hab++} // hábiles de acá al cobro
  const P=sueldoPesos(calc(N.of)),liq=P&&P.total!=null?pesos(P.total):null,mesOf=MES[+N.of.slice(5,7)-1];
  const when=`${DIAL[pd.getDay()]} ${pd.getDate()} de ${MES[pd.getMonth()]}`;
  const big=dd===0?'<div class="cb-n hoy">¡Hoy!</div>':`<div class="cb-n">${dd}</div><div class="cb-u">${dd===1?'día':'días'} para cobrar</div>`;
  const strip=N.days.map((d,i)=>{const x=parseYMD(d),st=d<te?' ya':d===te?' hoy':'',last=i===4;
    return `<div class="cb-d${st}${last?' pay':''}" title="${i+1}º día hábil"><span class="o">${i+1}º</span><b>${x.getDate()}</b><span class="w">${DIA[x.getDay()]}</span></div>`}).join('');
  return `<div class="cb-main"><div class="cb-big">${big}</div>
    <div class="cb-info"><div class="cb-t">${dd===0?`Hoy cobrás el sueldo de ${esc(mesOf)} 🧉`:`Cobrás el <b>${esc(when)}</b>`}</div>
      <div class="cb-s">${dd===0?'Es el 5º día hábil.':`Sueldo de ${esc(mesOf)} · 5º día hábil${dd>0&&hab?` · faltan ${plural(hab,'día hábil','días hábiles')}`:''}`}</div>
      <div class="cb-s">${liq?`Líquido ≈ <b>${esc(liq)}</b>`:'<button type="button" class="lnk" data-act="focusTc">Cargá el dólar</button> para ver cuánto cobrás.'}</div></div></div>
    <div class="cb-strip" aria-label="Los cinco primeros días hábiles de ${esc(MES[pd.getMonth()])}">${strip}</div>`;
}
V.sueldo={
  build(){
    $('#suEx').addEventListener('click',e=>{
      const t=e.target;
      if(t.closest('#suPrAdd')){const c=$('#suPrC').value.trim(),m=parseNum($('#suPrM').value),cur=$('#suPrU').value;
        if(!(m>0))return toast('Poné el monto del premio.','err');
        return this.saveEx({premios:[...(cfg.premios||[]),{id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),ym:suYm,c:c||'Premio',m:Math.round(m*100)/100,cur}]},`Premio sumado: ${cur==='UYU'?pesos(m)+' UYU':money(m)+' USD'}.`)}
      const pr=t.closest('[data-prm]');if(pr)return this.saveEx({premios:(cfg.premios||[]).filter(p=>p.id!==pr.dataset.prm)},'Premio quitado.');
      if(t.closest('#suFlAdd')){const d=$('#suFlD').value,er=faltaErr(d);if(er)return toast(esc(er),'err');
        return this.saveEx({faltas:[...(cfg.faltas||[]),{d,j:$('#suFlJ').value==='1'}].sort((a,b)=>a.d<b.d?-1:1)},`Falta del ${dm(d)} cargada.`)}
      const fl=t.closest('[data-fl]');if(fl)return this.saveEx({faltas:(cfg.faltas||[]).filter(x=>x.d!==fl.dataset.fl)},'Falta quitada.');
    });
    $('#suEx').addEventListener('change',e=>{
      if(e.target.id==='suFlP'){const v=e.target.value.trim(),n=v?parseNum(v):0;if(v&&!(n>=0))return toast('Ese descuento no es un número.','err');this.saveEx({descFalta:n||0})}
      if(e.target.id==='suFlJu')this.saveEx({faltaJust:e.target.checked});
    });
    $('#suMes').addEventListener('change',e=>{suYm=e.target.value;this.render({})});
    const step=d=>{const o=[...$('#suMes').options].map(x=>x.value),i=o.indexOf(suYm);const j=i-d;if(j>=0&&j<o.length){suYm=o[j];this.render({})}};
    $('#suPrev').onclick=()=>step(-1);$('#suNext').onclick=()=>step(1);
    $('#suTcSave').onclick=()=>this.saveTc();
    $('#suTc').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();this.saveTc()}});
    $('#suNom').addEventListener('click',e=>{if(e.target.closest('[data-aj0]'))quitarAjuste(suYm)}); // los FTDs entran solo desde el CRM con la extensión; los "sin detalle" viejos se pueden quitar
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
    cfg={...cfg,tc:n,tcFecha:todayS(),tcAuto:false};
    if(await B.saveCfg()){const P=sueldoPesos(calc(ymNow()));toast(`✔ Dólar BROU compra ${nf(n,2)}${P&&P.total!=null?' · líquido de '+esc(MES[new Date().getMonth()])+' ≈ '+sp('ok b',pesos(P.total)):''}`)}
  },
  render(){
    const now=ymNow();
    $('#suCobro').innerHTML=cobroCard();
    const months=[...new Set([now,...ftds.map(f=>f.date.slice(0,7)),...Object.keys(ajustes)])].sort().reverse();
    if(!suYm||!months.includes(suYm))suYm=now;
    $('#suMes').innerHTML=months.map(m=>`<option value="${m}"${m===suYm?' selected':''}>${esc(mLong(m))}</option>`).join('');
    const i=months.indexOf(suYm);$('#suPrev').disabled=i>=months.length-1;$('#suNext').disabled=i<=0;
    const s=calc(suYm),P=sueldoPesos(s),EX=extrasMes(suYm);
    this.extras(suYm);
    $('#suNomSub').textContent=suYm===now?'Este mes':'';$('#suSub').textContent=mLong(suYm);
    $('#suNom').innerHTML=`<div class="rows">`+
      rw('FTDs',`<b>${s.n}</b>`,'big')+
      rw('Cargados',String(s.loaded))+
      (s.extra?rw('Sin detalle (ya no se cargan)',readOnly?String(s.extra):`${s.extra} <button type="button" class="lnk" data-aj0>quitar</button>`):'')+
      rw('Fijo',`${pesos(cfg.base)} UYU`)+
      rw(`Por FTD (${s.n} × ${cfg.porftd} USD)`,`${money(s.porftd)} USD`)+
      rw(s.tier?`Bono (${s.tier}+ FTDs)`:'Bono',`${money(s.bono)} USD`)+
      rw('Variable',`${money(s.usd)} USD`,'tot hl')+
      (EX.usd?rw('+ Premios',`${money(EX.usd)} USD`):'')+(EX.uyu?rw('+ Premios',`${pesos(EX.uyu)} UYU`):'')+
      (EX.desc?rw(`− ${plural(EX.nDesc,'falta')} (× ${pesos(EX.porFalta)})`,`${pesos(EX.desc)} UYU`):'')+
      rw('Total nominal',`${pesos(cfg.base-EX.desc+EX.uyu)} + ${money(s.usd+EX.usd)} USD`)+
      (cfg.tc>0?rw('≈ en pesos',`${pesos(cfg.base-EX.desc+EX.uyu+(s.usd+EX.usd)*cfg.tc)} UYU`):'')+
      `</div>`+(s.monto?`<div class="note">${money(s.monto)} USD depositados por tus FTDs</div>`:'');
    $('#suLiqSub').textContent=P?(cfg.comRecibo?'Comisiones en el recibo':'Comisiones aparte'):'';
    $('#suLiq').innerHTML=!P?`<div class="p-empty">Falta el dólar BROU compra.<br><button type="button" class="btn sm wr" style="margin-top:8px" data-act="focusTc">Cargar dólar</button></div>`:
      `<div class="rows">`+rw(cfg.comRecibo?'Nominal gravado':'Nominal gravado (fijo)',pesos(P.N))+
      rw('− Aporte jubilatorio 15%',pesos(P.jub))+rw(`− FONASA ${nf(P.rF*100,1).replace(',0','')}%`,pesos(P.fon))+rw('− FRL 0,1%',pesos(P.frl))+rw('− IRPF',pesos(P.irpf))+
      rw('Líquido',`${pesos(P.neto)} UYU`,'tot hl big')+
      (P.tc>0&&cfg.comRecibo?rw('≈ en dólares',`${money(Math.round(P.neto/P.tc))} USD`):'')+
      (P.usdAparte?rw(EX.usd?'+ Comisiones y premios aparte':'+ Comisiones aparte',`${money(P.usdAparte)} USD`):'')+(P.uyuAparte?rw('+ Premios aparte',`${pesos(P.uyuAparte)} UYU`):'')+
      (P.usdAparte||P.uyuAparte?(P.total!=null?rw('≈ Total en mano',`${pesos(P.total)} UYU`,'tot hl'):''):'')+`</div>`;
    // bonos
    $('#suBonoSub').textContent=s.next?`Faltan ${s.next[0]-s.n} para ${s.next[1]} USD`:s.n?'Bono máximo 🧉':'';
    const T=tiers();
    $('#suBono').innerHTML=bonoTrack(s.n,true)+`<table class="pt" style="margin-top:10px"><thead><tr><th>FTDs</th><th class="r">Bono</th><th class="r">Variable</th><th class="r">Líquido ≈</th></tr></thead><tbody>`+
      T.map(([t,b])=>{const q=porCantidad(t),L=sueldoPesos(q);return `<tr${t===s.tier?' class="cur"':''}><td>${t}+${t===s.tier?' <span class="badge paid">ahora</span>':''}</td><td class="r">${money(b)} USD</td><td class="r">${money(q.usd)} USD</td><td class="r">${L&&L.total!=null?pesos(L.total):'—'}</td></tr>`}).join('')+'</tbody></table>';
    // dólar
    if($('#suTc')!==document.activeElement)$('#suTc').value=cfg.tc>0?nf(cfg.tc,2):'';
    $('#suTcInfo').innerHTML=cfg.tc>0?(tcViejo()?sp('hot','⚠ '+tcTxt()+' · actualizalo'):esc(tcTxt())):sp('hot','sin cargar');
    // simulador
    if(siN==null)siN=calc(now).n;
    $('#siChips').innerHTML=[calc(now).n,...T.map(t=>t[0])].filter((v,i,a)=>a.indexOf(v)===i).map(n=>`<button type="button" class="chip" data-n="${n}">${n}${n===calc(now).n?' (hoy)':''}</button>`).join('');
    this.sim();
  },
  extras(ym){ // premios y faltas del mes elegido (solo se redibuja si cambió algo, para no borrar lo que estás escribiendo)
    const ex=extrasMes(ym),ro=readOnly,auto=Math.round((+cfg.base||0)/30),te=todayS();
    const sig=JSON.stringify([ym,ex.pr,ex.fl,cfg.descFalta,cfg.faltaJust,cfg.base,ro]);const box=$('#suEx');if(box.dataset.sig===sig)return;box.dataset.sig=sig;
    $('#suExSub').textContent=[ex.usd?`+ ${money(ex.usd)} USD`:'',ex.uyu?`+ ${pesos(ex.uyu)} UYU`:'',ex.desc?`− ${pesos(ex.desc)} UYU`:''].filter(Boolean).join(' · ');
    const end=ym===te.slice(0,7)?te:addDays(ym+'-01',new Date(+ym.slice(0,4),+ym.slice(5,7),0).getDate()-1);
    box.innerHTML=`<div class="g2 ex2">
      <div><div class="ex-h">Premios</div>
        ${ex.pr.length?`<div class="exl">${ex.pr.map(p=>`<div class="exi"><span>${esc(p.c||'Premio')}</span><b>+ ${p.cur==='UYU'?pesos(p.m)+' UYU':money(p.m)+' USD'}</b>${ro?'':`<button type="button" class="ib del" data-prm="${esc(p.id)}" aria-label="Quitar premio">✕</button>`}</div>`).join('')}</div>`:'<p class="p-sub">Sin premios este mes.</p>'}
        ${ro?'':`<div class="frow wr exf"><input id="suPrC" maxlength="60" placeholder="Concepto (ej.: premio 5 FTDs en el día)" aria-label="Concepto del premio"><input id="suPrM" inputmode="decimal" placeholder="Monto" aria-label="Monto" class="exm"><select id="suPrU" aria-label="Moneda"><option>USD</option><option>UYU</option></select><button type="button" class="btn sm pri" id="suPrAdd">Sumar premio</button></div>`}
        <p class="note">${cfg.comRecibo?'Van en el recibo, como las comisiones.':'Van aparte, como las comisiones.'}</p></div>
      <div><div class="ex-h">Faltas</div>
        ${ex.fl.length?`<div class="exl">${ex.fl.map(x=>`<div class="exi"><span>${DIA[parseYMD(x.d).getDay()]} ${dm(x.d)} · ${x.j?'justificada':'sin justificar'}</span><b>${cfg.faltaJust!==false||!x.j?'− '+pesos(ex.porFalta):'no descuenta'}</b>${ro?'':`<button type="button" class="ib del" data-fl="${x.d}" aria-label="Quitar falta">✕</button>`}</div>`).join('')}</div>`:'<p class="p-sub">Sin faltas este mes.</p>'}
        ${ro?'':`<div class="frow wr exf"><input type="date" id="suFlD" min="${ym}-01" max="${end}" aria-label="Fecha de la falta"><select id="suFlJ" aria-label="Tipo de falta"><option value="0">Sin justificar</option><option value="1">Justificada</option></select><button type="button" class="btn sm" id="suFlAdd">Sumar falta</button></div>
        <div class="frow wr exs"><label class="fld"><span>Descuento por falta (UYU)</span><input id="suFlP" inputmode="decimal" placeholder="${nf(auto,0)}" value="${+cfg.descFalta>0?nf(+cfg.descFalta,0):''}" class="exm"></label><label class="tog"><input type="checkbox" id="suFlJu"${cfg.faltaJust!==false?' checked':''}>Las justificadas también descuentan</label></div>`}
        <p class="note">Si no ponés el descuento, cada falta descuenta el fijo ÷ 30 (${pesos(auto)} UYU). También se cargan en Ajustes → Días de trabajo.</p></div></div>`;
  },
  async saveEx(ch,msg){if(!noRO())return;cfg={...cfg,...ch};this.render({});if(await B.saveCfg()&&msg)toast(msg)},
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
const TEMAS=[['auto','Automático'],['claro','Claro'],['oscuro','Oscuro']];
const darkMq=window.matchMedia?matchMedia('(prefers-color-scheme: dark)'):null;
function applyTheme(t){
  t=t||cfg.tema;if(!['claro','oscuro'].includes(t))t='auto';local.set('tema',t);
  const dark=t==='oscuro'||(t==='auto'&&!!(darkMq&&darkMq.matches));
  document.body.classList.toggle('dark',dark);
  const m=document.querySelector('meta[name=theme-color]');if(m)m.content=dark?'#0d1210':'#f1f4ef';
}
if(darkMq&&darkMq.addEventListener)darkMq.addEventListener('change',()=>{applyTheme(ready?cfg.tema:local.get('tema','auto'));if(ready)refresh()});
let bonosDraft=null;
V.config={
  build(){
    $('#cfTemas').innerHTML=TEMAS.map(([t,l])=>`<button type="button" data-tema="${t}">${l}</button>`).join('');
    $('#cfTemas').addEventListener('click',async e=>{const b=e.target.closest('[data-tema]');if(!b)return;cfg={...cfg,tema:b.dataset.tema};applyTheme();refresh();if(!readOnly&&await B.saveCfg())this.saved()});
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
    $('#cfLibAdd').onclick=()=>{if(!noRO())return;const d=$('#cfLibDia').value,m=$('#cfLibMes').value;if(!d||!m)return toast('Elegí el día y el mes.','err');
      if(+d>new Date(2024,+m,0).getDate())return toast(`Ese mes no tiene día ${+d}.`,'err'); // 2024: el 29/2 vale
      const md=`${m}-${d}`,L=cfg.libres||[];if(L.includes(md))return toast('Ese día ya está.','warn');
      $('#cfLibDia').value='';$('#cfLibMes').value='';this.saveDias({libres:[...L,md].sort()})};
    $('#cfLibres').addEventListener('click',e=>{const c=e.target.closest('[data-lib]');if(!c||!noRO())return;this.saveDias({libres:(cfg.libres||[]).filter(x=>x!==c.dataset.lib)})});
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
    $('#cfBonos').innerHTML=bonosDraft.map(([t,u],i)=>`<div class="brow" style="grid-template-columns:auto 1fr auto 1fr auto"><span class="dim">desde</span><input class="bt" inputmode="numeric" value="${esc(t)}" aria-label="FTDs"><span class="dim">FTDs →</span><input class="bu" inputmode="decimal" value="${esc(u)}" aria-label="USD"><button type="button" class="ib del wr" data-rmb="${i}" aria-label="Quitar">Quitar</button></div>`).join('');
  },
  async saveBonos(){
    if(!noRO())return;
    this.readBonos();$('#cfBonoErr').textContent='';
    const b=bonosDraft.filter(([t,u])=>String(t).trim()||String(u).trim()).map(([t,u])=>[parseAmount(t),parseAmount(u)]);
    if(b.some(([t,u])=>isNaN(t)||isNaN(u)||t<1||u<0||!Number.isInteger(t)))return $('#cfBonoErr').textContent='Revisá los valores.';
    if(new Set(b.map(x=>x[0])).size!==b.length)return $('#cfBonoErr').textContent='Hay escalones repetidos.';
    cfg={...cfg,bonos:b.sort((x,y)=>x[0]-y[0])};bonosDraft=null;
    if(await B.saveCfg()){this.saved();toast('Bonos guardados.')}
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
    const tm=['claro','oscuro'].includes(cfg.tema)?cfg.tema:'auto';$$('[data-tema]',$('#cfTemas')).forEach(b=>b.classList.toggle('on',b.dataset.tema===tm));
    const LB=cfg.laborables||DEF.laborables;$$('[data-dow]',$('#cfDow')).forEach(c=>c.classList.toggle('on',LB.includes(+c.dataset.dow)));
    if($('#cfInicio')!==document.activeElement)$('#cfInicio').value=cfg.inicio||'';
    const sf=cfg.sinFer||DEF.sinFer,y=+todayS().slice(0,4),fl=t=>feriadosUY(y).filter(x=>x.t===t).map(x=>`${dm(x.d)} ${x.n}`).join('\n');
    $('#cfFer').innerHTML=`<button type="button" class="chip${sf.no?' on':''}" data-fer="no" title="${esc(fl('no'))}">No laborables</button><button type="button" class="chip${sf.lab?' on':''}" data-fer="lab" title="${esc(fl('lab'))}">Laborables</button>`;
    const L=cfg.libres||[];
    $('#cfLibres').innerHTML=L.length?L.map(x=>`<button type="button" class="chip on" data-lib="${x}" title="Quitar">${+x.slice(3,5)}/${+x.slice(0,2)} ✕</button>`).join(''):'<span class="p-sub">Ninguno</span>';
    $('#cfDiasSub').textContent='';
    $('#cfDb').textContent=teamInfo?teamInfo.name:'';$('#cfSub').textContent=`Vitalis ${VERSION}`;
    V.cuenta.render();
    $('#cfExt').innerHTML=extOn()?sp('ok b','Extensión conectada')+`: ${plural(extN,'aviso programado','avisos programados')}, ${plural(activeSnips().length,'snippet')}.`:'La extensión no está conectada en esta pestaña. Con ella tenés avisos en cualquier pestaña, el botón del CRM, el registro de clientes new y los snippets.';
    datosCard();auditCard();
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
    const act=sellers(list); // agentes: el team leader no cuenta (salvo que venda)
    const [ya,ma]=eqYm.split('-').map(Number),mFrom=eqYm+'-01',mTo=ymd(new Date(ya,ma,0));
    const per=act.map(m=>{const l=list.filter(f=>f.uid===m.id);return {m,n:l.length,late:l.filter(isLate).length,monto:l.reduce((a,f)=>a+(+f.amount||0),0),last:l.reduce((a,f)=>!a||byDate(f,a)>0?f:a,null),cv:convPeriod(mFrom,mTo,m.id)}});
    for(const uid of new Set(list.map(f=>f.uid)))if(!per.some(p=>p.m.id===uid)){const l=list.filter(f=>f.uid===uid);per.push({m:{id:uid,name:memberName(uid)+' (desvinculado)'},n:l.length,late:l.filter(isLate).length,monto:l.reduce((a,f)=>a+(+f.amount||0),0),last:null,cv:convPeriod(mFrom,mTo,uid)})}
    per.sort((a,b)=>b.n-a.n||b.monto-a.monto||a.m.name.localeCompare(b.m.name));
    const conV=per.filter(p=>p.n).length;
    $('#eqSub').textContent=`${teamInfo?teamInfo.name:''} · ${plural(act.length,'agente')}`;
    const k=(lb,v,s2,hero)=>`<div class="kpi${hero?' hero':''}"><div class="lb">${esc(lb)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s2)}</div></div>`;
    const T=targets[eqYm]||0;
    $('#eqTarget').innerHTML=eqTargetCard(eqYm);
    {const pr=eqYm===now?pronCard():'';$('#eqPron').hidden=!pr;$('#eqPron').innerHTML=pr;const cv=eqYm===now?curvaCard():'';$('#eqCurva').hidden=!cv;$('#eqCurva').innerHTML=cv} // pronóstico y curva del agente nuevo: solo team leader y admin
    {const pm=eqYm===now?callsMesaCard():'';$('#eqPool').hidden=!pm;$('#eqPool').innerHTML=pm} // las llamadas de hoy de cada uno
    stDraw();stLoad().then(()=>{if(cur==='equipo')stDraw()}); // la estación: hace cuánto se leyó cada vista del CRM
    crmLoad();const cola=eqYm===now?colaMesaCard():'';$('#eqCola').hidden=!cola;$('#eqCola').innerHTML=cola;
    $('#eqKpis').innerHTML=k('FTDs de la mesa',nf(R.n),T?`de ${T} de target · ${pct(R.n/T)}`:mLong(eqYm),true)+k('Monto',money(R.monto)+' USD',`prom ${nf(R.prom,1)} por FTD`)+
      k('Lates',`${R.lates} · ${pct(R.latePct)}`,R.lates?`prom ${nf(R.lateDias,1)} días`:'todos new')+
      k('Agentes con ventas',`${conV} de ${act.length}`,`${nf(conV?R.n/conV:0,1)} FTDs por agente`)+
      (()=>{const c=convPeriod(mFrom,mTo,null);return k('CR (%) de la mesa',c.rate==null?'—':pct(c.rate),`${plural(c.ftd,'FTD')} de ${plural(c.leads,'cliente new','clientes new')}`)})()+
      (per[0]&&per[0].n?k('Primero',per[0].m.name,plural(per[0].n,'FTD')):'');
    const max=Math.max(1,...per.map(p=>p.n));
    $('#eqRank').innerHTML=`<div class="rk" style="--vw:${Math.max(6,...per.map(p=>(`${p.n} · ${money(p.monto)}${p.late?' · '+p.late+' late':''}`).length))}ch">`+
      per.map(p=>`<button type="button" class="rk-row" data-uid="${esc(p.m.id)}" title="${esc(p.m.name)}: ${p.n} FTDs · ${money(p.monto)} USD"><span class="rk-name">${esc(p.m.name)}${p.m.id===me?' <span class="dim">(vos)</span>':''}</span><span class="rk-track"><span class="rk-bar" style="width:${p.n/max*100}%${p.n?'':';min-width:0'}"></span></span><span class="rk-val">${p.n} <span class="m">· ${money(p.monto)}${p.late?' · '+p.late+' late':''}</span></span></button>`).join('')+'</div>';
    const [Y,M]=eqYm.split('-').map(Number),days=eqYm===now?+todayS().slice(8,10):new Date(Y,M,0).getDate(),bd={};
    for(const f of list){const d=+f.date.slice(8,10),o=bd[d]||(bd[d]={a:0,b:0,m:0});if(isLate(f))o.b++;else o.a++;o.m+=+f.amount||0}
    const data=[];for(let d=1;d<=new Date(Y,M,0).getDate();d++){const o=bd[d]||{a:0,b:0,m:0},dw=new Date(Y,M-1,d).getDay();data.push({lab:String(d),a:o.a,b:o.b,m:o.m,d,dw,labC:dw===0||dw===6?'color-mix(in srgb,var(--dim) 55%,transparent)':''})}
    colChart($('#eqChart'),data,{h:210,capMin:18,int:true,label:'FTDs por día de la mesa',empty:'Sin FTDs este mes.',
      tip:d=>({title:`${DIAL[d.dw]} ${z(d.d)}/${z(M)}`,rows:[{v:String(d.a+d.b),l:'FTDs'},{key:'var(--s1)',v:String(d.a),l:'new'},{key:'var(--s2)',v:String(d.b),l:'late'},{v:money(d.m),l:'USD depositados'}]})});
    $('#eqCount').textContent=`${plural(conV,'agente')} con ventas · ${nf(days?R.n/days:0,2)} FTDs por día`;
    $('#eqTable').innerHTML=`<table class="pt"><thead><tr><th>Agente</th><th>Hoy</th><th class="r">FTDs</th>${utOk?'<th>Target</th>':''}<th class="r">New</th><th class="r">Late</th><th class="r">Monto USD</th><th class="r">Clientes new</th><th class="r" title="CR (%): conversión">CR (%)</th><th class="r">Agenda</th><th>Último FTD</th><th class="act"></th></tr></thead><tbody>`+
      per.map(p=>{const act_=p.m.role!=null,th=act_?turnoHoy(p.m.id):{txt:'',cls:'d'},ag=act_?agStats(p.m.id):null;
        return `<tr${p.m.id===me?' class="cur"':''}><td><button type="button" class="who-cell lnkp" data-prof="${esc(p.m.id)}" title="Ver perfil">${avatar(p.m.name)}${esc(p.m.name)}</button></td><td class="eq-hoy ${th.cls}">${esc(th.txt)}</td><td class="r">${p.n}</td>${utOk?`<td>${act_?utCell(p.m.id,eqYm,p.n):''}</td>`:''}<td class="r">${p.n-p.late}</td><td class="r">${p.late}</td><td class="r">${money(p.monto)}</td><td class="r">${p.cv.leads}</td><td class="r">${p.cv.rate==null?'<span class="d">—</span>':pct(p.cv.rate)}</td><td class="r">${ag?(ag.open?`${ag.open}${ag.venc?` · <span class="hot b">${ag.venc} venc.</span>`:''}`:'<span class="d">0</span>'):''}</td><td class="d">${p.last?`${dm(p.last.date)} ${esc(p.last.time||'')}, ${esc(p.last.id)}`:''}</td><td class="act">${act_?`<button type="button" class="btn sm" data-act="ficha" data-uid="${esc(p.m.id)}">Ficha</button>`:''}</td></tr>`}).join('')+'</tbody></table>';
  },
};

/* ---------- mi cuenta y la mesa (en ajustes) ---------- */
async function reloadMembers(){try{setMembers(await Q(sb.from('profiles').select('*').eq('team_id',profile.team_id).order('name')));refresh()}catch(e){}}
V.cuenta={
  build(){
    $('#cfNameSave').onclick=async()=>{const v=$('#cfName').value.trim();if(!v)return toast('Escribí tu nombre.','err');if(v===profile.name)return;if(await B.saveName(v))toast('Nombre guardado.')};
    $('#cfName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#cfNameSave').click()}});
    $('#cfPin').onclick=()=>pinModal();
    $('#cfAddM').onclick=()=>addMemberModal();
    $('#cfMembers').addEventListener('change',async e=>{
      const c=e.target.closest('[data-crm]');
      if(c){const m=members.find(x=>x.id===c.dataset.crm);if(!m)return;const v=c.value.trim();if(v===(m.crm_name||''))return;
        if(await B.rpc('set_crm_name',{uid:m.id,nm:v})){m.crm_name=v||null;toast(v?`${esc(m.name)} en el CRM: <b>${esc(v)}</b>`:`${esc(m.name)}: sin nombre en el CRM`)}return}
      const s=e.target.closest('[data-role]');if(!s)return;const m=members.find(x=>x.id===s.dataset.role);
      if(m&&await B.setMember(m.id,{role:s.value}))toast(`${esc(m.name)}: ${roleTxt(s.value).toLowerCase()}`);else this.render()});
    $('#cfMembers').addEventListener('click',async e=>{const b=e.target.closest('[data-mact]');if(!b)return;const m=members.find(x=>x.id===b.dataset.id);if(!m)return;
      if(b.dataset.mact==='pin'){
        if(!await confirmar('Resetear PIN',`El PIN de <b>${esc(m.name)}</b> vuelve a ser 0000 y la próxima vez que entre crea uno nuevo.`,'Resetear'))return;
        if(await B.rpc('reset_pin',{uid:m.id})){m.pin_set=false;toast(`PIN de ${esc(m.name)}: 0000.`);this.render()}
        return;
      }
      if(m.active){if(!await confirmar('Dar de baja',`¿Dar de baja a <b>${esc(m.name)}</b>? Deja de aparecer en la lista y no puede entrar. Sus ventas quedan en la mesa.`,'Dar de baja',true))return;if(await B.setMember(m.id,{active:false}))toast(`${esc(m.name)} dado de baja.`)}
      else if(await B.setMember(m.id,{active:true}))toast(`${esc(m.name)} reactivado.`)});
  },
  render(){
    if(!profile)return;
    if($('#cfName')!==document.activeElement)$('#cfName').value=profile.name;
    const ph=!!avatars[me];$('#cfPic').innerHTML=`<button type="button" class="av-edit" data-act="foto" title="${ph?'Cambiar':'Subir'} mi foto">${avatar(profile.name,'xl')}<span>${ph?'Cambiar':'Subir'}</span></button>
      <div><b>Foto de perfil</b><p class="p-sub">${ph?'La ve toda la mesa.':'Subí una y la ve toda la mesa en el chat, Social y Equipo.'}</p>
      <div class="btns"><button type="button" class="btn sm" data-act="foto">${ph?'Cambiar foto':'Subir foto'}</button>${ph?'<button type="button" class="btn sm danger" data-act="fotoX">Sacar</button>':''}</div></div>`;
    $('#cfEmail').textContent=profile.login?`Entrás eligiendo tu nombre y tu PIN${teamInfo?' en '+teamInfo.name:''}.`:(profile.email||'')+(teamInfo?' · '+teamInfo.name:'');
    $('#cfPin').hidden=!profile.login;
    $('#cfRole').textContent=roleTxt(profile.role);
    $('#cfTeamCard').hidden=!isLeader();
    if(!isLeader())return;
    const adm=isAdmin();$('#cfAddM').hidden=!adm;
    {const el=$('#cfLocks');el.hidden=false;el.innerHTML=`<span><b>Privacidad</b> · ${esc(locksTxt())}</span>`}
    $('#cfTeamName').textContent=teamInfo.name;
    const list=members.filter(m=>!m.former).sort((a,b)=>(b.active-a.active)||a.name.localeCompare(b.name)),fm=members.filter(m=>m.former).sort((a,b)=>a.name.localeCompare(b.name));
    const crmIn=document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.crm;if(crmIn)return; // no pisar lo que estás escribiendo
    $('#cfMembers').innerHTML=`<div class="p-tablewrap"><table class="pt"><thead><tr><th>Nombre</th><th>Nombre en el CRM</th><th>Rol</th><th>PIN</th><th class="r">FTDs</th>${adm?'<th class="act"></th>':''}</tr></thead><tbody>`+
      list.map(m=>`<tr${m.active?'':' class="warn"'}><td><span class="who-cell">${avatar(m.name)}${esc(m.name)}${m.id===me?' <span class="dim">(vos)</span>':''}</span></td>
        <td><input data-crm="${esc(m.id)}" value="${esc(m.crm_name||'')}" placeholder="Se busca por «${esc(m.name)}»" aria-label="Nombre de ${esc(m.name)} en el CRM" style="width:190px;padding:4px 8px;font-size:13px"></td>
        <td>${!adm||m.id===me||!m.active?`<span class="d">${roleTxt(m.role)}</span>`:`<select data-role="${esc(m.id)}" aria-label="Rol de ${esc(m.name)}"><option value="agent"${m.role==='agent'?' selected':''}>Agente</option><option value="leader"${m.role==='leader'?' selected':''}>Team leader</option><option value="admin"${m.role==='admin'?' selected':''}>Administrador</option></select>`}</td>
        <td>${!m.login?'<span class="d">Cuenta vieja (email)</span>':m.pin_set?'<span class="badge paid">Creado</span>':'<span class="badge">0000, sin entrar</span>'}</td>
        <td class="r">${team.filter(f=>f.uid===m.id).length}</td>
        ${adm?`<td class="act">${m.login&&m.active&&m.id!==me&&m.pin_set?`<button type="button" class="ib" data-mact="pin" data-id="${esc(m.id)}">Resetear PIN</button>`:''}${m.id===me?'':`<button type="button" class="ib${m.active?' del':''}" data-mact="baja" data-id="${esc(m.id)}">${m.active?'Dar de baja':'Reactivar'}</button>`}</td>`:''}</tr>`).join('')+'</tbody></table></div>';
    $('#cfFormers').hidden=!fm.length;
    if(fm.length)$('#cfFormers').innerHTML=`<div class="card-h" style="margin:18px 0 8px"><h3>Desvinculados</h3><span class="p-sub">${plural(fm.length,'persona')} del CRM que ya no está en la mesa · ${plural(team.filter(f=>fm.some(m=>m.id===f.uid)).length,'venta')}</span><span class="grow"></span><button type="button" class="btn sm" data-act="formers">¿Alguno es de la mesa?</button></div>
      <div class="p-tablewrap"><table class="pt"><thead><tr><th>Nombre</th><th>En el CRM</th><th class="r">FTDs</th><th>Última venta</th></tr></thead><tbody>${fm.map(m=>{const L=team.filter(f=>f.uid===m.id),l=L.reduce((a,f)=>!a||f.date>a.date?f:a,null);
        return `<tr><td><button type="button" class="who-cell lnkp" data-prof="${esc(m.id)}">${avatar(m.name)}${esc(m.name)}</button></td><td class="d">${esc(m.crm_name||'')}</td><td class="r">${L.length}</td><td class="d">${l?esc(dm(l.date)+'/'+l.date.slice(2,4)):''}</td></tr>`}).join('')}</tbody></table></div>`;
  },
};
function pinModal(){
  const f=(id,l)=>`<label class="fld" style="margin-top:10px"><span>${l}</span><input type="password" id="${id}" inputmode="numeric" maxlength="4" autocomplete="off" pattern="[0-9]*"></label>`;
  modal({title:'Cambiar PIN',body:f('pin0','PIN actual')+f('pin1','PIN nuevo (4 números)')+f('pin2','Repetilo')+'<div class="ebox" id="pinErr"></div>',
    actions:[{l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
      const a=api.q('#pin0').value,b=api.q('#pin1').value,c=api.q('#pin2').value,err=t=>{api.q('#pinErr').textContent=t;return false};
      if(!/^\d{4}$/.test(b))return err('El PIN nuevo son 4 números.');if(b!==c)return err('No coinciden.');
      const {error}=await sb.rpc('set_pin',{new_pin:b,old_pin:a});if(error)return err(errMsg(error));toast('PIN cambiado.')}}]});
}
function addMemberModal(){
  modal({title:'Sumar a la mesa',body:`<label class="fld"><span>Nombre (como aparece en la lista)</span><input id="amN" maxlength="40" autofocus></label>
    <label class="fld" style="margin-top:10px"><span>Rol</span><select id="amR"><option value="agent">Agente</option><option value="leader">Team leader</option><option value="admin">Administrador</option></select></label>
    <p class="note">Entra con PIN 0000 la primera vez y crea el suyo.</p><div class="ebox" id="amErr"></div>`,
    actions:[{l:'Cancelar'},{l:'Sumar',cls:'pri',fn:async api=>{
      const n=api.q('#amN').value.trim();if(!n){api.q('#amErr').textContent='Escribí el nombre.';return false}
      const {error}=await sb.rpc('add_member',{nm:n,rl:api.q('#amR').value});if(error){api.q('#amErr').textContent=errMsg(error);return false}
      toast(`${esc(n)} ya está en la lista. Entra con PIN 0000.`);reloadMembers()}}]});
}

/* ---------- clientes new: registro y conversión ---------- */
let clPer='hoy',clWho='me',clQ='',clShow=60;
const CLP=[['hoy','Hoy'],['semana','Semana'],['mes','Mes'],['todo','Todo']];
const clPerTxt=()=>({hoy:'hoy',semana:'esta semana',mes:'este mes',todo:'desde siempre'})[clPer]||'';
function clRange(){const te=todayS();return clPer==='hoy'?[te,te]:clPer==='semana'?[weekStart(te),te]:clPer==='mes'?[te.slice(0,8)+'01',te]:['0000-01-01','9999-12-31']}
const clUid=()=>clWho==='me'?me:clWho==='all'?null:clWho;
function soldMap(){const m=new Map();for(const f of [...team].sort(byDate)){const k=norm(f.id);if(!m.has(k))m.set(k,f)}return m}
V.clientes={
  build(){
    $('#clPer').innerHTML=CLP.map(([k,l])=>`<button type="button" data-clp="${k}">${l}</button>`).join('');
    $('#clPer').addEventListener('click',e=>{const b=e.target.closest('[data-clp]');if(!b)return;clPer=b.dataset.clp;clShow=60;this.render({})});
    $('#clWho').addEventListener('change',e=>{clWho=e.target.value;clShow=60;this.render({})});
    let qt=null;$('#clQ').addEventListener('input',e=>{clearTimeout(qt);qt=setTimeout(()=>{clQ=e.target.value.trim();clShow=60;this.render({})},160)});
    $('#clMore').onclick=()=>{clShow+=100;this.render({})};
    $('#clTable').addEventListener('click',async e=>{const b=e.target.closest('[data-cl]');if(!b)return;const l=leads.find(x=>x._id===b.dataset.id);if(!l)return;
      if(b.dataset.cl==='ficha')return openFicha(l.id);
      if(b.dataset.cl==='ag')return agendarCliente(l.id);
      if(b.dataset.cl==='del'){if(!await confirmar('Borrar cliente',`¿Sacar a <b>${esc(l.id)}</b> ${esc(l.name)} del registro?`,'Borrar',true))return;if(await B.delLead(l))toast('Cliente borrado del registro.')}});
  },
  render(){
    $$('[data-clp]',$('#clPer')).forEach(b=>b.classList.toggle('on',b.dataset.clp===clPer));
    const sel=$('#clWho');
    if(sel!==document.activeElement){
      const ms=members.filter(m=>m.id!==me&&!isLeadUid(m.id)&&(m.active||leads.some(l=>leadOwner(l)===m.id)));
      if(isLeadUid(me)&&clWho==='me')clWho='all'; // el team leader no tiene clientes propios: ve los de la mesa
      sel.innerHTML=(isLeadUid(me)?'':`<option value="me">Mis clientes</option>`)+`<option value="all">Toda la mesa</option>`+ms.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
      if(![...sel.options].some(o=>o.value===clWho))clWho=isLeadUid(me)?'all':'me';sel.value=clWho;
    }
    const uid=clUid(),te=todayS(),[from,to]=clRange(),sold=soldMap();
    $('#clSub').textContent=`${clWho==='me'?'Tus':clWho==='all'?'Los de toda la mesa:':'Los de '+memberName(clWho)+':'} clientes en "new", día por día. La extensión los anota sola desde el CRM.`;
    crmLoad();$('#clKpis').innerHTML=convCardsX(uid).replace(/^<div class="conv3">|<\/div>$/g,'');
    if(crm.ok){const nuevos=crmAll().filter(r=>!isArch(r.brand)&&r.first&&ymd(new Date(r.first))===te).length,fh=team.filter(f=>f.date===te&&!isArch(f.brand)),en=fh.filter(f=>crmStatusOf(f.id)).length;
      $('#clSeen').hidden=false;$('#clSeen').innerHTML=`Hoy entraron al registro ${plural(nuevos,'cliente')} del CRM, con su status.`+(isLeader()&&fh.length?` De los ${plural(fh.length,'FTD')} de hoy, ${en} ${en===1?'estaba':'estaban'} en el registro.`:'')}
    else $('#clSeen').hidden=true;
    // gráfico: últimos 30 días
    const start=addDays(te,-29),own=l=>uid==null||leadOwner(l)===uid,data=[];
    for(let i=0;i<30;i++){const d=addDays(start,i),L=leads.filter(l=>l.date===d&&own(l)),paid=L.filter(l=>sold.has(norm(l.id))).length,dw=parseYMD(d).getDay();
      data.push({lab:String(+d.slice(8)),a:paid,b:L.length-paid,d,dw,ftd:team.filter(f=>f.date===d&&own(f)).length,labC:dw===0||dw===6?'color-mix(in srgb,var(--dim) 55%,transparent)':''})}
    $('#clChartSub').textContent='Últimos 30 días';
    colChart($('#clChart'),data,{h:190,capMin:18,cb:'var(--sx)',label:'Clientes new por día',empty:'Todavía no hay clientes registrados. Abrí el CRM con la extensión instalada o cargalos con + Cliente.',
      tip:x=>({title:`${cap(DIAL[x.dw])} ${dm(x.d)}`,rows:[{v:String(x.a+x.b),l:'clientes new'},{key:'var(--s1)',v:String(x.a),l:'ya depositaron'},{key:'var(--sx)',v:String(x.b),l:'todavía no'},{v:String(x.ftd),l:'FTDs ese día'}]})});
    // registro
    const q=norm(clQ);
    const rows=leads.filter(l=>own(l)&&l.date>=from&&l.date<=to&&(!q||norm(l.name).includes(q)||norm(l.id).includes(q))).sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:(b._id>a._id?1:-1));
    $('#clListT').textContent=clPer==='hoy'?'Clientes de hoy':clPer==='semana'?'Clientes de esta semana':clPer==='mes'?'Clientes de este mes':'Todos los clientes';
    const paidN=rows.filter(l=>sold.has(norm(l.id))).length;
    $('#clCount').textContent=rows.length?`${plural(rows.length,'cliente')}, ${paidN} ${paidN===1?'ya depositó':'ya depositaron'}`:'';
    const many=clWho!=='me';
    $('#clTable').innerHTML=rows.length?`<table class="pt"><thead><tr><th>Día</th><th>ID</th><th>Nombre</th><th>País</th>${many?'<th>Agente</th>':''}<th>Estado</th><th>Origen</th><th class="act"></th></tr></thead><tbody>`+
      rows.slice(0,clShow).map(l=>{const f=sold.get(norm(l.id));return `<tr><td>${l.date===te?'Hoy':`${DIA[parseYMD(l.date).getDay()]} ${dm(l.date)}`}</td><td><button type="button" class="lnkp" data-cl="ficha" data-id="${esc(l._id)}" title="Ver la ficha"><b>${esc(l.id)}</b></button></td><td class="trunc" title="${esc(l.name)}">${esc(l.name)}</td><td class="d">${esc(l.country)}</td>${many?`<td class="trunc">${esc(memberName(l.uid))}</td>`:''}
        <td>${f?`<span class="badge paid" title="${esc(money(f.amount))} USD">Depositó ${f.date===te?'hoy':dm(f.date)}</span>`:'<span class="d">Todavía no</span>'}</td><td class="d">${l.source==='manual'?'A mano':'CRM'}</td>
        <td class="act wr">${f?'':`<button type="button" class="ib" data-cl="ag" data-id="${esc(l._id)}">Agendar</button>`}${l.uid===me||isLeader()?`<button type="button" class="ib del" data-cl="del" data-id="${esc(l._id)}">Borrar</button>`:''}</td></tr>`}).join('')+'</tbody></table>'
      :`<div class="p-empty">${clQ?'No hay clientes con esa búsqueda.':clPer==='hoy'?'Todavía no entró ningún cliente hoy.':'Sin clientes en este período.'}</div>`;
    $('#clMore').hidden=rows.length<=clShow;
  },
};

// Campañas (afiliador · campaña · país), con el mismo período que Clientes
V.campanas={
  build(){
    $('#cmPer').innerHTML=CLP.map(([k,l])=>`<button type="button" data-clp="${k}">${l}</button>`).join('');
    $('#cmPer').addEventListener('click',e=>{const b=e.target.closest('[data-clp]');if(!b)return;clPer=b.dataset.clp;clShow=60;this.render({})});
    const cmpEl=$('#clCamp'),cmpOpen=k=>{const [from,to]=clRange();campDetail(k,from,to,clPerTxt())};
    let cqt=null;
    cmpEl.addEventListener('input',e=>{const f=e.target.closest('[data-cmpf=q]');if(!f)return;clearTimeout(cqt);cqt=setTimeout(()=>{cmp.q=f.value;this.render({})},200)});
    cmpEl.addEventListener('change',e=>{const f=e.target.closest('[data-cmpf]');if(!f||f.dataset.cmpf==='q')return;cmp[f.dataset.cmpf]=f.value;this.render({})});
    cmpEl.addEventListener('click',e=>{if(e.target.closest('[data-cmpm]')){cmp.open=true;this.render({});return}const tr=e.target.closest('tr[data-cmp]');if(tr)cmpOpen(tr.dataset.cmp)});
    cmpEl.addEventListener('keydown',e=>{const tr=e.target.closest&&e.target.closest('tr[data-cmp]');if(tr&&(e.key==='Enter'||e.key===' ')){e.preventDefault();cmpOpen(tr.dataset.cmp)}});
  },
  render(){
    $$('[data-clp]',$('#cmPer')).forEach(b=>b.classList.toggle('on',b.dataset.clp===clPer));
    crmLoad();
    const [from,to]=clRange(),el=$('#clCamp'),qi=el.querySelector('[data-cmpf=q]'),foc=qi&&document.activeElement===qi,cc=campCard(from,to,clPerTxt());
    el.hidden=!cc;el.innerHTML=cc;$('#cmEmpty').hidden=!!cc;
    if(foc){const n=el.querySelector('[data-cmpf=q]');if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length)}} // sin perder lo que escribís
  },
};

/* ---------- snippets ---------- */
let snQ='';
const canEditSnip=s=>s.global?isAdmin():(s.uid===me||(s.shared&&isLeader())); // los globales, solo el admin
V.snippets={
  build(){
    $('#snQ').addEventListener('input',e=>{snQ=e.target.value.trim();this.render({})});
    $('#snList').addEventListener('click',async e=>{
      const b=e.target.closest('[data-sn]');if(!b)return;
      if(b.dataset.sn==='new')return snipModal();
      const sn=snippets.find(x=>x._id===b.dataset.id);if(!sn)return;
      if(b.dataset.sn==='copy'){try{await navigator.clipboard.writeText(fillSnip(sn.body));toast(`/${esc(sn.shortcut)} copiado.`)}catch(x){toast('No pude copiar.','err')}return}
      if(b.dataset.sn==='edit')return snipModal(sn);
      if(b.dataset.sn==='del'){if(!await confirmar('Borrar snippet',`¿Borrar <b>/${esc(sn.shortcut)}</b>${sn.uid!==me?` de ${esc(memberName(sn.uid))}`:''}?`,'Borrar',true))return;if(await B.delSnip(sn))toast(`/${esc(sn.shortcut)} borrado.`)}
    });
  },
  render(){
    const q=norm(snQ),mine_=new Set(snippets.filter(x=>x.uid===me).map(x=>x.shortcut));
    const list=snippets.filter(x=>!q||norm(x.shortcut+' '+x.title+' '+x.body).includes(q))
      .sort((a,b)=>(b.global-a.global)||(a.uid===me?0:1)-(b.uid===me?0:1)||a.shortcut.localeCompare(b.shortcut));
    if(!snippets.length){$('#snList').innerHTML=`<div class="sn-empty"><b>Tu primer snippet</b>Guardá el texto del KYC, el saludo o lo que escribas siempre, y pegalo escribiendo /atajo.<div style="margin-top:14px"><button type="button" class="btn pri wr" data-sn="new">Crear snippet</button></div></div>`;return}
    $('#snList').innerHTML=list.length?list.map(x=>{
      const other=x.uid!==me,shadow=other&&mine_.has(x.shortcut);
      return `<article class="sn${x.global?' glob':''}"><div class="h"><span class="sc">/${esc(x.shortcut)}</span><span class="tt">${esc(x.title)}</span>${x.global?'<span class="badge glob" title="Le funciona a toda la mesa. Solo el admin lo edita.">Global</span>':x.shared&&!other?'<span class="badge">Compartido</span>':''}</div>
        <div class="bd">${esc(x.body).replace(/\{(fecha|hora|yo|cursor)\}/g,'<span class="var">{$1}</span>')}</div>
        <div class="ft">${x.global?`<span class="p-sub">De toda la mesa${shadow?' · usás el tuyo':''}</span>`:other?`<span class="who-cell p-sub">${avatar(memberName(x.uid))}De ${esc(memberName(x.uid).split(/\s+/)[0])}${shadow?', usás el tuyo':''}</span>`:''}<span class="grow"></span>
          <button type="button" class="ib" data-sn="copy" data-id="${esc(x._id)}">Copiar</button>${canEditSnip(x)?`<button type="button" class="ib wr" data-sn="edit" data-id="${esc(x._id)}">Editar</button><button type="button" class="ib del wr" data-sn="del" data-id="${esc(x._id)}">Borrar</button>`:''}</div></article>`}).join('')
      :'<div class="sn-empty">Ningún snippet con esa búsqueda.</div>';
  },
};
function snipModal(sn){
  if(!noRO())return;
  const VARS=[['{fecha}','Fecha de hoy'],['{hora}','Hora'],['{yo}','Tu nombre'],['{cursor}','Dónde queda el cursor']];
  const body=`<div class="fgrid">
      <label class="fld"><span>Atajo</span><span class="scin"><span>/</span><input id="snS" maxlength="30" autocomplete="off" spellcheck="false" placeholder="kyc" value="${esc(sn?sn.shortcut:'')}" data-vitalis-nosnip></span></label>
      <label class="fld"><span>Título (opcional)</span><input id="snT" maxlength="60" value="${esc(sn?sn.title:'')}" data-vitalis-nosnip></label>
      <label class="fld full"><span>Texto</span><textarea id="snB" rows="8" maxlength="20000" data-vitalis-nosnip>${esc(sn?sn.body:'')}</textarea></label></div>
    <div class="vars"><span class="p-sub">Insertar:</span>${VARS.map(([v,l])=>`<button type="button" class="chip" data-var="${v}" title="${l}">${v}</button>`).join('')}</div>
    <label class="tog" style="margin-top:14px"><input type="checkbox" id="snSh"${sn&&(sn.shared||sn.global)?' checked':''}${sn&&(sn.uid!==me||sn.global)?' disabled':''}>Compartir con la mesa</label>
    ${isAdmin()?`<label class="tog" style="margin-top:8px"><input type="checkbox" id="snGl"${sn&&sn.global?' checked':''}>Global: le funciona a toda la mesa y solo el admin lo edita</label>`:''}
    <div class="fld" style="margin-top:14px"><span>Así se pega</span><div class="prev" id="snP"></div></div><div class="ebox" id="snE"></div>`;
  const acts=[{l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
    const sc=api.q('#snS').value.trim().replace(/^\/+/,'').toLowerCase(),b=api.q('#snB').value,err=t=>{api.q('#snE').textContent=t;return false};
    if(!/^[a-z0-9_-]{1,30}$/.test(sc))return err('El atajo va sin espacios ni tildes: letras, números, - o _.');
    if(!b.trim())return err('Falta el texto.');
    const gl=api.q('#snGl')?api.q('#snGl').checked:!!(sn&&sn.global);
    const r=await B.saveSnip(sn,{shortcut:sc,title:api.q('#snT').value.trim(),body:b,global:gl,shared:gl||(sn&&sn.uid!==me?sn.shared:api.q('#snSh').checked)});
    if(!r)return false;toast(gl?`/${esc(sc)} guardado como global: ya le funciona a toda la mesa.`:`/${esc(sc)} guardado.${extOn()?' Ya lo podés usar en cualquier página.':''}`);
  }}];
  if(sn&&canEditSnip(sn))acts.unshift({l:'Borrar',cls:'danger l',fn:async()=>{if(!await confirmar('Borrar snippet',`¿Borrar <b>/${esc(sn.shortcut)}</b>?`,'Borrar',true))return false;await B.delSnip(sn)}});
  modal({title:sn?`Editar /${esc(sn.shortcut)}`:'Nuevo snippet',body,actions:acts,wide:1,onOpen(api){
    const ta=api.q('#snB'),prev=()=>{api.q('#snP').textContent=fillSnip(ta.value)||' '};
    api.box.addEventListener('input',prev);prev();
    const gl=api.q('#snGl'),sh=api.q('#snSh');if(gl)gl.addEventListener('change',()=>{if(gl.checked){sh.checked=true;sh.disabled=true}else sh.disabled=!!(sn&&sn.uid!==me)});
    api.box.addEventListener('click',e=>{const c=e.target.closest('[data-var]');if(!c)return;const v=c.dataset.var,a=ta.selectionStart,z_=ta.selectionEnd;
      ta.setRangeText(v,a,z_,'end');ta.focus();prev()});
    api.q('#snS').addEventListener('input',e=>{const v=e.target.value.replace(/^\/+/,'').toLowerCase().replace(/\s+/g,'-');if(v!==e.target.value)e.target.value=v});
  }});
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
  navRoles();
  go(landing()); // la primera vez del día, Inicio; después, directo al Panel
  status();check();setTimeout(avisoCheck,900);setTimeout(()=>imgCacheTrim(),8000);setInterval(check,15000);setInterval(tick,1000);turnoBar(true);setTimeout(tcAuto,1500);
  if(isLeader()){setTimeout(stationCheck,5000);setInterval(stationCheck,6e4)} // la estación del CRM: avisos a team leader y admin
  addEventListener('online',status);addEventListener('offline',status);
  if(!ftds.length&&!team.length)toast(`Bienvenido a Vitalis, ${esc(profile.name.split(/\s+/)[0])}. Las ventas entran solas desde el CRM con la extensión (se baja en Ajustes).`,'ok',{ms:12000});
}
function boot(){
  applyTheme(local.get('tema','auto'));
  $('#ver').textContent='Vitalis '+VERSION;
  for(const v of VIEWS)V[v].build();
  V.cuenta.build();
  window.addEventListener('hashchange',()=>{if(!ready)return;let h='';try{h=location.hash.slice(1)}catch(e){}if(VIEWS.includes(h)&&h!==cur)go(h)});
  let lastW=0;try{new ResizeObserver(en=>{const w=Math.round(en[0].contentRect.width);if(Math.abs(w-lastW)>8){lastW=w;refresh()}}).observe($('#main'))}catch(e){}
  status();
  start();
}
boot();
