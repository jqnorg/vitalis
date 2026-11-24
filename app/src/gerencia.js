/* ============================================================
   Gerencia: la mesa para los de arriba (pedido del dueño, noviembre 2026: "más análisis sobre el rendimiento y más resultados").
   Sin tablas nuevas: sale de las ventas (`team`), los clientes del CRM (`crm_clients`, por rango de registro: `campLoad`),
   el RMO guardado por día (`rmo_days`) y el de hoy (`ritmo`).
   Período: Hoy · cada semana del mes · el mes (y el mes anterior con ‹ ›). Cada número va con el del período anterior y una flecha.
   1) La tabla de la mesa: por agente, FTDs · CR (%) · RMO · velocidad al new.   2) El embudo: news → llamados → depositaron (new · late).
   3) Lead Quality: por afiliador (y adentro campaña · país): llamados, depositan, late, días al depósito y en qué quedaron sus leads.
   La ven team leader y admin (botón Gerencia) y el rol `director`, que solo ve esto (sin clientes, chat ni cola).
   ============================================================ */
let gerP={ym:ymNow(),k:'mes'},gerBusy=false;
const monthEnd=ym=>{const d=parseYMD(ym+'-01');d.setMonth(d.getMonth()+1);d.setDate(0);return ymd(d)};
const minDate=(a,b)=>a<b?a:b;
function gerWeeks(ym){ // las semanas del mes (lunes a domingo, cortadas al mes), hasta hoy
  const te=todayS(),first=ym+'-01',last=minDate(monthEnd(ym),te),out=[];let a=first,i=1;
  while(a<=last){const ws=weekStart(a),we=addDays(ws,6),b=minDate(we,last);out.push({k:'w'+i,l:`Sem ${i}`,from:a,to:b,t:`${dm(a)} al ${dm(b)}`});a=addDays(we,1);i++}
  return out;
}
function gerRange(){ // el período elegido y el anterior (para comparar)
  const te=todayS(),ym=gerP.ym,W=gerWeeks(ym);
  if(ym!==ymNow()&&gerP.k==='hoy')gerP.k='mes';
  if(gerP.k==='hoy'){let ayer=addDays(te,-1);for(let i=0;i<7&&noTrabajo(ayer)&&noTrabajo(ayer)!=='falta';i++)ayer=addDays(ayer,-1);return {k:'hoy',from:te,to:te,l:'Hoy',t:dm(te),prev:{from:ayer,to:ayer,l:'ayer'}}}
  const w=W.find(x=>x.k===gerP.k);
  if(w){const i=W.indexOf(w),p=W[i-1]||(()=>{const pe=addDays(w.from,-1);return {from:weekStart(pe),to:pe}})();return {...w,prev:{from:p.from,to:p.to,l:'la semana anterior'}}}
  gerP.k='mes';const pm=ymStep(ym,-1);return {k:'mes',from:ym+'-01',to:minDate(monthEnd(ym),te),l:mLong(ym),t:`del 1 al ${+minDate(monthEnd(ym),te).slice(8)}`,prev:{from:pm+'-01',to:monthEnd(pm),l:mLong(pm)}};
}
const gerAgents=()=>members.filter(m=>m.active&&m.role!=='leader'&&m.role!=='director').sort((a,b)=>a.name.localeCompare(b.name));
const arrow=(a,b,inv)=>{if(a==null||b==null)return '';const d=a-b;if(!d)return '<span class="ar eq" title="igual que el período anterior">=</span>';const up=inv?d<0:d>0;return `<span class="ar ${up?'up':'dn'}" title="período anterior: ${typeof b==='number'&&b<=1&&b>=0&&!Number.isInteger(b)?pct(b):b}">${d>0?'▲':'▼'}</span>`};
function rmoOf(uid,R,rows){ // el RMO de alguien en el período: hoy en vivo; en un rango, el promedio de los días guardados
  if(R.k==='hoy'){const r=ritmo(uid);if(r&&!r.young)return {q:r.q,dead:r.dead,n:r.n,days:1,live:true}} // el director no tiene turnos ni llamadas: usa lo guardado (rmo_days)
  const mine=rows.filter(r=>r.user_id===uid);if(!mine.length)return null;
  const dead=mine.reduce((a,r)=>a+r.dead_ms,0)/mine.length,n=mine.reduce((a,r)=>a+(+r.n||0),0);
  return {q:dead<Q_MIN[0]?1:dead<Q_MIN[1]?2:3,dead,n,days:mine.length};
}
const rmoTxt=r=>!r?'<span class="d">—</span>':`<span class="qb q${r.q}">Q${r.q}</span> <span class="d">${esc(minsTxt(r.dead))}${r.days>1?'/día':''} muertos · ${nf(r.n)} llamadas${r.days>1?` · ${r.days} días`:''}</span>`;
function gerTabla(R,rows,prevRows){
  const A=gerAgents(),inR=(f,a,b)=>f.date>=a&&f.date<=b;
  const per=A.map(m=>{const ftd=team.filter(f=>f.uid===m.id&&inR(f,R.from,R.to)).length,pf=team.filter(f=>f.uid===m.id&&inR(f,R.prev.from,R.prev.to)).length;
    const c=convPeriod(R.from,R.to,m.id),pc=convPeriod(R.prev.from,R.prev.to,m.id);
    return {m,ftd,pf,c,pc,rmo:rmoOf(m.id,R,rows),prmo:rmoOf(m.id,{k:R.k==='hoy'?'prev':R.k},prevRows)}}).filter(p=>p.ftd||p.pf||p.c.leads||p.rmo).sort((a,b)=>b.ftd-a.ftd||(b.c.rate||0)-(a.c.rate||0)||a.m.name.localeCompare(b.m.name));
  const T={ftd:team.filter(f=>inR(f,R.from,R.to)&&!isLeadUid(f.uid)).length,pf:team.filter(f=>inR(f,R.prev.from,R.prev.to)&&!isLeadUid(f.uid)).length,c:convPeriod(R.from,R.to,null),pc:convPeriod(R.prev.from,R.prev.to,null)};
  const deadAll=per.filter(p=>p.rmo).map(p=>p.rmo.dead),dAvg=deadAll.length?deadAll.reduce((a,b)=>a+b,0)/deadAll.length:null;
  const cr=(c,pc)=>c.rate==null?'<span class="d">—</span>':`<b>${pct(c.rate)}</b> ${arrow(c.rate,pc.rate)}<span class="d"> ${c.ftd} de ${c.leads}</span>`;
  const tr=per.map(p=>`<tr><td><span class="eq-who">${avatar(p.m.name)}${esc(p.m.name)}</span></td>
    <td class="r"><b>${p.ftd}</b> ${arrow(p.ftd,p.pf)}</td><td class="r">${cr(p.c,p.pc)}</td><td>${rmoTxt(p.rmo)}${p.rmo&&p.prmo?` ${arrow(p.rmo.dead,p.prmo.dead,true)}`:''}</td></tr>`).join('');
  return `<section class="card ger-t"><div class="card-h"><h3>La mesa, por agente</h3><span class="p-sub">${esc(R.l)} · ${esc(R.t)} · la flecha compara con ${esc(R.prev.l)}</span></div>
    ${per.length?`<div class="p-tablewrap"><table class="pt"><thead><tr><th>Agente</th><th class="r">FTDs</th><th class="r" title="CR (%): de los registrados en el período, cuántos depositaron el mismo día">CR (%)</th><th title="RMO: el ritmo del día (Q1 la mejor franja, Q3 la peor) y el tiempo muerto">RMO</th></tr></thead>
    <tbody>${tr}</tbody><tfoot><tr><td><b>La mesa</b></td><td class="r"><b>${T.ftd}</b> ${arrow(T.ftd,T.pf)}</td><td class="r">${cr(T.c,T.pc)}</td><td>${dAvg==null?'<span class="d">—</span>':`<span class="qb q${dAvg<Q_MIN[0]?1:dAvg<Q_MIN[1]?2:3}">Q${dAvg<Q_MIN[0]?1:dAvg<Q_MIN[1]?2:3}</span> <span class="d">${esc(minsTxt(dAvg))}${R.k==='hoy'?'':'/día'} muertos en promedio</span>`}</td></tr></tfoot></table></div>`
    :'<div class="p-empty">Sin datos en el período.</div>'}</section>`;
}
/* ---------- el embudo ---------- */
function embudoDe(rows){
  const S=soldIdx(),o={reg:0,at:0,ftd:0,nw:0,lt:0,no:0};
  for(const r of rows){const f=S.get(ckey(r.brand,r.id)),paid=!!f||paidCrm(r);o.reg++;
    if(paid){o.at++;o.ftd++;const same=f?!isLate(f):!!(r.ftd&&r.ftd.slice(0,10)===regDay(r));if(same)o.nw++;else o.lt++;continue}
    if(llamado(r))o.at++;else o.no++}
  return o;
}
function gerEmbudo(R,rows,prev){
  const E=embudoDe(rows),P=embudoDe(prev),st=[['News',E.reg,P.reg,null],['Llamados',E.at,P.at,E.reg],['Depositaron',E.ftd,P.ftd,E.at]];
  const mx=E.reg||1;
  const steps=st.map(([l,v,pv,base],i)=>`<div class="emb-s"><div class="emb-l"><span>${l}</span><b>${nf(v)}</b> ${arrow(v,pv)}</div><div class="emb-b"><i style="width:${Math.max(v?2:0,v/mx*100)}%"></i></div><div class="emb-p">${i?`${E.reg?pct(v/E.reg):'—'} de los news${base?` · ${pct(v/base)} del paso anterior`:''}${i===2&&E.ftd?` · ${E.nw} el mismo día, ${E.lt} late`:''}`:`${E.no?`${pct(E.no/E.reg)} todavía sin llamar`:'todos llamados'}`}</div></div>`).join('');
  // por agente
  const by=new Map();for(const r of rows){const u=convOwner(r)||'';(by.get(u)||by.set(u,[]).get(u)).push(r)}
  const A=gerAgents().map(m=>({m,e:embudoDe(by.get(m.id)||[])})).filter(x=>x.e.reg).sort((a,b)=>b.e.ftd-a.e.ftd||b.e.reg-a.e.reg);
  const pc=(a,b)=>b?`<b>${pct(a/b)}</b> <span class="d">${a}</span>`:'<span class="d">—</span>';
  const tr=A.map(({m,e})=>`<tr><td><span class="eq-who">${avatar(m.name)}${esc(m.name)}</span></td><td class="r">${e.reg}</td><td class="r">${pc(e.at,e.reg)}</td><td class="r">${pc(e.ftd,e.reg)}</td><td class="r">${e.ftd?`${e.nw} · ${e.lt}`:'<span class="d">—</span>'}</td></tr>`).join('');
  return `<section class="card"><div class="card-h"><h3>El embudo</h3><span class="p-sub">de los news del período: cuántos se llamaron y cuántos depositaron · ${esc(R.l)}</span></div>
    ${E.reg?`<div class="emb">${steps}</div>${A.length?`<details class="ger-d" data-k="emb-ag"><summary>Por agente <span class="d">(del primero que lo llamó)</span></summary><div class="p-tablewrap"><table class="pt"><thead><tr><th>Agente</th><th class="r">News</th><th class="r">Llamados</th><th class="r">Depositaron</th><th class="r">New · late</th></tr></thead><tbody>${tr}</tbody></table></div></details>`:''}`
    :'<div class="p-empty">Sin news en el período.</div>'}</section>`;
}
/* ---------- Lead Quality ---------- */
function lqGroups(rows){ // por afiliador, y adentro por campaña · país
  const S=soldIdx(),m=new Map();
  const mk=(k,aff,camp,pais)=>({k,aff,camp,pais,reg:0,at:0,no:0,dep:0,lt:0,days:[],grp:{},sub:new Map()});
  const add=(g,r)=>{const f=S.get(ckey(r.brand,r.id)),paid=!!f||paidCrm(r),grp=cgOf(r,paid);
    g.reg++;g.grp[grp]=(g.grp[grp]||0)+1;
    if(paid||llamado(r))g.at++;else g.no++;
    if(paid){g.dep++;const same=f?!isLate(f):!!(r.ftd&&r.ftd.slice(0,10)===regDay(r));if(!same)g.lt++;const fd=f?f.date:r.ftd&&r.ftd.slice(0,10),rd=regDay(r);if(fd&&rd)g.days.push(Math.max(0,Math.round((parseYMD(fd)-parseYMD(rd))/864e5)))}};
  for(const r of rows){const aff=String(r.aff||'').trim()||'sin afiliador';let g=m.get(norm(aff));if(!g)m.set(norm(aff),g=mk(norm(aff),aff,'','' ));add(g,r);
    const sk=comboKey(aff,r.camp,r.country);let s=g.sub.get(sk);if(!s)g.sub.set(sk,s=mk(sk,aff,camN(r.camp)||'sin campaña',paisOf(r.country)||'sin país'));add(s,r)}
  const fin=g=>{g.atP=g.reg?g.at/g.reg:null;g.ltP=g.dep?g.lt/g.dep:0;g.depP=g.reg?g.dep/g.reg:0;g.dmed=g.days.length?quant(g.days,.5):null;g.subs=[...g.sub.values()].sort((a,b)=>b.reg-a.reg);g.subs.forEach(fin);return g};
  return [...m.values()].map(fin).sort((a,b)=>b.reg-a.reg);
}
const lqDays=d=>d==null?'<span class="d">—</span>':d===0?'el mismo día':d===1?'1 día':`${nf(d,0)} días`;
function lqRow(g,avg,sub){
  const few=g.reg<POCOS,cls=v=>few?'':v>=avg*1.25?'ok':v<=avg*.6?'hot':'';
  return `<tr class="${sub?'lq-sub':'lq-aff'}"><td>${sub?`<span class="d">${esc(g.camp)} · ${esc(g.pais)}</span>`:`<b>${esc(g.aff)}</b>${g.subs.length>1?` <span class="d">${g.subs.length} campañas</span>`:''}`}</td>
    <td class="r">${g.reg}${few?' <span class="d" title="con menos de 10 registrados, los porcentajes dicen poco">*</span>':''}</td>
    <td class="r">${g.atP==null?'<span class="d">—</span>':pct(g.atP)}</td>
    <td class="r"><b class="${cls(g.depP)}">${pct(g.depP)}</b> <span class="d">${g.dep}</span></td><td class="r">${g.dep?pct(g.ltP):'<span class="d">—</span>'}</td><td class="r">${lqDays(g.dmed)}</td>
    <td>${stBar(g)}<div class="lq-leg">${CG.filter(([k])=>g.grp[k]).map(([k,l])=>`<span><i class="cg-${k}"></i>${esc(l)} <b>${pct(g.grp[k]/g.reg)}</b></span>`).join('')}</div></td></tr>`;
}
function gerLQ(R,rows){
  const G=lqGroups(rows),tot=rows.length,avg=tot?G.reduce((a,g)=>a+g.dep,0)/tot:0;
  const body=G.map(g=>lqRow(g,avg)+(g.subs.length>1?g.subs.map(s=>lqRow(s,avg,true)).join(''):'')).join('');
  return `<section class="card ger-lq"><div class="card-h"><h3>Lead Quality</h3><span class="p-sub">por afiliador y campaña: qué leads mandan y dónde terminan · ${esc(R.l)} · la mesa deposita ${tot?pct(avg):'—'} de sus leads</span></div>
    ${G.length?`<div class="p-tablewrap"><table class="pt lq-t"><thead><tr><th>Afiliador · campaña · país</th><th class="r">Leads</th><th class="r" title="de los news, cuántos ya se llamaron">Llamados</th><th class="r">Depositan</th><th class="r" title="de los que depositan, cuántos otro día que el del registro">Late</th><th class="r" title="mediana de días del registro al depósito">Depositan a los</th><th>En qué quedaron</th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="p-sub" style="margin:8px 2px 0">En verde, deposita bastante más que la mesa; en rojo, bastante menos. * pocos leads. Los porcentajes de "dónde terminan" son sobre los leads del afiliador.</p>`
    :'<div class="p-empty">Sin leads en el período.</div>'}</section>`;
}
/* ---------- todas las mesas (el dueño y los directores) ---------- */
const isGlobal=()=>!!profile&&!!profile.global;
const MESA_URL=slug=>`https://vitalis-${slug}.joaquin-or24.workers.dev`;
let gerCo={k:'',at:0,data:null},gerTeams=null;
async function companyLoad(R){ // ger_company: los números de cada mesa en el período (cache de 2 min)
  const k=R.from+'|'+R.to;if(gerCo.k===k&&Date.now()-gerCo.at<12e4)return gerCo.data;
  try{gerCo={k,at:Date.now(),data:await Q(sb.rpc('ger_company',{d1:R.from,d2:R.to}))}}catch(e){gerCo={k,at:Date.now(),data:null}}
  return gerCo.data;
}
async function teamsLoad(){try{gerTeams=await Q(sb.rpc('teams_list'))}catch(e){gerTeams=gerTeams||[]}return gerTeams}
const dPct=(a,b)=>b?pct(a/b):'<span class="d">—</span>';
function companyCard(R,C){
  if(!C||!C.teams)return `<section class="card"><div class="card-h"><h3>Todas las mesas</h3></div><div class="p-empty">No se pudo cargar.</div></section>`;
  const T=C.teams,S=T.reduce((o,t)=>{for(const k of ['ftd','ftd_new','reg','atend','dep','agents'])o[k]=(o[k]||0)+(+t[k]||0);return o},{});
  const q=d=>d==null?'<span class="d">—</span>':`<span class="qb q${d<Q_MIN[0]?1:d<Q_MIN[1]?2:3}">Q${d<Q_MIN[0]?1:d<Q_MIN[1]?2:3}</span> <span class="d">${esc(minsTxt(+d))}/día</span>`;
  const row=t=>`<tr${t.id===profile.team_id?' class="cur"':''}><td><b>${esc(t.name)}</b>${t.id===profile.team_id?' <span class="d">(estás acá)</span>':`<button type="button" class="ib" data-gerin="${esc(t.slug)}" title="Pasar a esta mesa">Entrar</button>`}<div class="d">${plural(+t.agents,'agente')}</div></td>
    <td class="r"><b>${t.ftd}</b></td><td class="r"><b>${dPct(+t.ftd_new,+t.reg)}</b> <span class="d">${t.ftd_new} de ${t.reg}</span></td><td>${q(t.dead)}</td>
    <td class="r">${nf(+t.reg)}</td><td class="r">${dPct(+t.atend,+t.reg)}</td><td class="r">${dPct(+t.dep,+t.reg)}</td></tr>`;
  const lq=new Map();for(const t of T)for(const a of t.affs||[]){const k=norm(a.aff);const o=lq.get(k)||lq.set(k,{aff:a.aff,reg:0,dep:0,at:0,by:[]}).get(k);for(const f of ['reg','dep','at'])o[f]+=+a[f]||0;o.by.push([t.name,+a.reg,+a.dep])}
  const L=[...lq.values()].sort((a,b)=>b.reg-a.reg).slice(0,15),avg=S.reg?S.dep/S.reg:0;
  return `<section class="card ger-co"><div class="card-h"><h3>Todas las mesas</h3><span class="p-sub">${esc(R.l)} · ${esc(R.t)} · mesa contra mesa</span></div>
    <div class="p-tablewrap"><table class="pt"><thead><tr><th>Mesa</th><th class="r">FTDs</th><th class="r" title="de los registrados en el período, cuántos depositaron el mismo día">CR (%)</th><th title="tiempo muerto promedio por agente y día">RMO</th><th class="r">Leads</th><th class="r" title="news que ya se llamaron">Llamados</th><th class="r">Depositan</th></tr></thead>
    <tbody>${T.map(row).join('')}</tbody><tfoot><tr><td><b>La empresa</b> <span class="d">${plural(S.agents,'agente')}</span></td><td class="r"><b>${S.ftd}</b></td><td class="r"><b>${dPct(S.ftd_new,S.reg)}</b></td><td></td><td class="r">${nf(S.reg)}</td><td class="r">${dPct(S.atend,S.reg)}</td><td class="r">${dPct(S.dep,S.reg)}</td></tr></tfoot></table></div>
    ${L.length?`<details class="ger-d" data-k="co-lq"><summary>Lead Quality de la empresa <span class="d">(por afiliador, todas las mesas juntas)</span></summary><div class="p-tablewrap"><table class="pt"><thead><tr><th>Afiliador</th><th class="r">Leads</th><th class="r">Llamados</th><th class="r">Depositan</th><th>Por mesa</th></tr></thead><tbody>
      ${L.map(a=>`<tr><td><b>${esc(a.aff)}</b></td><td class="r">${a.reg}</td><td class="r">${dPct(a.at,a.reg)}</td><td class="r"><b class="${a.reg>=POCOS?(a.dep/a.reg>=avg*1.25?'ok':a.dep/a.reg<=avg*.6?'hot':''):''}">${dPct(a.dep,a.reg)}</b></td><td class="d">${a.by.map(([n,r,d])=>`${esc(n)} ${d}/${r}`).join(' · ')}</td></tr>`).join('')}</tbody></table></div></details>`:''}</section>`;
}
function mesasCard(T){ // las mesas (solo el dueño): la lista con su link y "Nueva mesa"
  if(!T)return '';
  return `<section class="card ger-mesas"><div class="card-h"><h3>Mesas</h3><span class="p-sub">${plural(T.length,'mesa')} · cada una entra por su propio dominio</span><span class="grow"></span><button type="button" class="btn sm pri" data-act="mesaNueva">Nueva mesa</button></div>
    <div class="p-tablewrap"><table class="pt"><thead><tr><th>Mesa</th><th>Team leader</th><th class="r">Personas</th><th>Dominio</th><th class="act"></th></tr></thead><tbody>
    ${T.map(t=>`<tr><td><b>${esc(t.name)}</b>${t.mine?' <span class="d">(estás acá)</span>':''}</td><td>${esc(t.leader||'—')}</td><td class="r">${t.people}</td><td><a href="${MESA_URL(t.slug)}" target="_blank" rel="noopener" class="lnk">${esc(MESA_URL(t.slug).replace('https://',''))}</a></td><td class="act">${t.mine?'':`<button type="button" class="btn sm" data-gerin="${esc(t.slug)}">Entrar</button>`}</td></tr>`).join('')}</tbody></table></div>
    <p class="p-sub" style="margin:8px 2px 0">Para que el dominio ande, en Cloudflare se crea un Worker llamado <b>vitalis-&lt;nombre corto&gt;</b> con este mismo repo (está en el README). Mientras tanto, la mesa entra por vitalis.joaquin-or24.workers.dev eligiéndola en la lista.</p></section>`;
}
function mesaNuevaModal(){
  modal({title:'Nueva mesa',wide:1,body:`<label class="fld"><span>Nombre de la mesa</span><input id="mnN" maxlength="40" placeholder="Team Sofía" autofocus></label>
    <label class="fld" style="margin-top:10px"><span>Nombre corto (va en el dominio: vitalis-<b>sofia</b>.joaquin-or24.workers.dev)</span><input id="mnS" maxlength="30" placeholder="sofia"></label>
    <label class="fld" style="margin-top:10px"><span>Team leader (opcional)</span><input id="mnL" maxlength="40" placeholder="Nombre Apellido"></label>
    <label class="fld" style="margin-top:10px"><span>Agentes, uno por línea (opcional)</span><textarea id="mnA" rows="5" placeholder="Nombre Ap\nOtro Ap"></textarea></label>
    <p class="note">Todos entran con PIN 0000 la primera vez. Después podés sumar o sacar gente desde esa mesa, en Ajustes → Mesa.</p><div class="ebox" id="mnErr"></div>`,
    actions:[{l:'Cancelar'},{l:'Crear la mesa',cls:'pri',fn:async api=>{
      const nm=api.q('#mnN').value.trim();if(!nm){api.q('#mnErr').textContent='Escribí el nombre de la mesa.';return false}
      const agents=api.q('#mnA').value.split(/\n/).map(s=>s.trim()).filter(Boolean);
      const {data,error}=await sb.rpc('team_create',{nm,slug:api.q('#mnS').value.trim(),leader:api.q('#mnL').value.trim()||null,agents});
      if(error){api.q('#mnErr').textContent=errMsg(error);return false}
      toast(`Mesa <b>${esc(nm)}</b> creada${data&&data.people?` con ${plural(data.people,'persona')}`:''}. Dominio: ${esc(MESA_URL(data.slug))}`,'ok',{ms:12000});
      gerTeams=null;gerCo={k:'',at:0,data:null};V.gerencia.render({})}}]});
  const n=$('#mnN'),s=$('#mnS');if(n&&s)n.addEventListener('input',()=>{if(!s.dataset.touched)s.value=n.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/^team\s+/,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')});
  if(s)s.addEventListener('input',()=>{s.dataset.touched='1'});
}
/* ---------- las mesas de prueba (la extensión sola, para otras mesas): el dueño las crea y ve cómo les va; los directores las ven ---------- */
const PRUEBA_URL=location.origin.replace(/\/$/,'')+'/prueba/';
let gerTrial=null;
async function trialLoad(){try{gerTrial=await Q(sb.rpc('trial_desks_list'))}catch(e){gerTrial=gerTrial||[]}return gerTrial}
function trialCard(T){
  if(!T)return '';
  const ago=iso=>{if(!iso)return 'nunca';const m=Math.round((Date.now()-new Date(iso))/6e4);return m<1?'recién':m<60?`hace ${m} min`:m<1440?`hace ${Math.round(m/60)} h`:`hace ${Math.round(m/1440)} días`};
  return `<section class="card ger-trial"><div class="card-h"><h3>Mesas de prueba</h3><span class="p-sub">la extensión sola, sin Vitalis: solo news y velocidad al new</span><span class="grow"></span><a class="btn sm" href="${PRUEBA_URL}" target="_blank" rel="noopener">Ver la invitación</a><button type="button" class="btn sm pri" data-act="trialNueva">Nueva mesa de prueba</button></div>
    ${T.length?`<div class="p-tablewrap"><table class="pt"><thead><tr><th>Mesa</th><th>Código</th><th class="r">Personas</th><th class="r">News hoy</th><th class="r">En New</th><th class="r" title="mediana de hoy del registro a la primera llamada">Al new en</th><th>Última señal</th></tr></thead><tbody>
    ${T.map(t=>`<tr><td><b>${esc(t.name)}</b></td><td><code class="trial-code">${esc(t.code)}</code> <button type="button" class="ib" data-copy="${esc(t.code)}" title="Copiar el código">Copiar</button></td><td class="r">${t.people}</td><td class="r">${t.news_today}</td><td class="r">${t.in_new?`<b class="hot">${t.in_new}</b>`:0}</td><td class="r">${t.med==null?'<span class="d">—</span>':`<b class="${t.med>5?'hot':'ok'}">${Math.round(t.med)} min</b>`}</td><td class="d">${ago(t.last)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="p-empty">Todavía no hay ninguna. Creá una, pasale el código y el link de la invitación al team leader de esa mesa.</div>'}
    <p class="p-sub" style="margin:8px 2px 0">Cada persona instala la extensión desde la invitación (vTL o vAgente) y entra con el código de la mesa y su nombre tal como aparece en el CRM. La extensión solo lee el CRM.</p></section>`;
}
function trialNuevaModal(){
  modal({title:'Nueva mesa de prueba',body:`<label class="fld"><span>Nombre de la mesa</span><input id="tnN" maxlength="40" placeholder="Mesa de Carlos" autofocus></label>
    <p class="note">Te doy un código de 6 letras y números: se lo pasás al team leader junto con el link de la invitación.</p><div class="ebox" id="tnErr"></div>`,
    actions:[{l:'Cancelar'},{l:'Crear',cls:'pri',fn:async api=>{
      const nm=api.q('#tnN').value.trim();if(!nm){api.q('#tnErr').textContent='Escribí el nombre de la mesa.';return false}
      const {data,error}=await sb.rpc('trial_desk_create',{nm});
      if(error||!data||!data.ok){api.q('#tnErr').textContent=error?errMsg(error):'No se pudo crear.';return false}
      toast(`Mesa de prueba <b>${esc(nm)}</b> creada. Código: <b class="trial-code">${esc(data.code)}</b> · invitación: ${esc(PRUEBA_URL)}`,'ok',{ms:20000});
      gerTrial=null;V.gerencia.render({})}}]});
}
async function mesaEntrar(slug){ // pasar a otra mesa: el perfil cambia de mesa y Vitalis arranca de nuevo ahí
  if(!await B.rpc('switch_team',{slug}))return;
  local.set('mesa',slug);await snapClear();location.reload();
}

/* ---------- la sección ---------- */
function gerHead(R){
  const W=gerWeeks(gerP.ym),cur=gerP.ym===ymNow();
  return `<div class="ger-per"><div class="seg">${cur?`<button type="button" data-ger="hoy"${R.k==='hoy'?' class="on"':''}>Hoy</button>`:''}${W.map(w=>`<button type="button" data-ger="${w.k}"${R.k===w.k?' class="on"':''} title="${esc(w.t)}">${w.l}</button>`).join('')}<button type="button" data-ger="mes"${R.k==='mes'?' class="on"':''}>Mes</button></div>
    <span class="ger-m"><button type="button" class="ib" data-germ="-1" aria-label="Mes anterior">‹</button><b>${esc(mLong(gerP.ym))}</b><button type="button" class="ib" data-germ="1" aria-label="Mes siguiente"${cur?' disabled':''}>›</button></span></div>`;
}
V.gerencia={
  build(){
    const b=$('#gerBody');
    b.addEventListener('click',e=>{const p=e.target.closest('[data-ger]');if(p){gerP.k=p.dataset.ger;this.render({});return}
      const i=e.target.closest('[data-gerin]');if(i){mesaEntrar(i.dataset.gerin);return}
      const a=e.target.closest('[data-act=mesaNueva]');if(a){mesaNuevaModal();return}
      const tn=e.target.closest('[data-act=trialNueva]');if(tn){trialNuevaModal();return}
      const cp=e.target.closest('[data-copy]');if(cp){navigator.clipboard.writeText(cp.dataset.copy).then(()=>toast('Código copiado.','ok'),()=>toast('No pude copiar.','err'));return}
      const m=e.target.closest('[data-germ]');if(m){gerP.ym=ymStep(gerP.ym,+m.dataset.germ);if(gerP.ym>ymNow())gerP.ym=ymNow();gerP.k='mes';this.render({})}});
    setInterval(()=>{if(ready&&cur==='gerencia'&&!document.hidden)this.render({})},6e4);
  },
  async render(){
    const b=$('#gerBody');if(!b||!isMgmt())return;
    const R=gerRange(),op=openKeys(b);
    const from=minDate(R.prev.from,R.from),to=R.to;
    if(!gerBusy){gerBusy=true;try{await Promise.all([campLoad(from,to),rmoLoad(from,to)])}catch(e){}finally{gerBusy=false}}
    if(cur!=='gerencia')return;
    const all=cmp.rows||[],rows=all.filter(r=>regIn(r,R.from,R.to)),prev=all.filter(r=>regIn(r,R.prev.from,R.prev.to));
    const rm=(rmoRows[from+'|'+to]||[]),rmR=rm.filter(r=>r.date>=R.from&&r.date<=R.to),rmP=rm.filter(r=>r.date>=R.prev.from&&r.date<=R.prev.to);
    const pron=R.k==='mes'&&gerP.ym===ymNow()?`<section class="card">${pronCard()}</section>`:'';
    let top='';
    if(isGlobal()||isDirector()){ // todas las mesas, comparadas; y las mesas (solo el dueño)
      const [C,T,P]=await Promise.all([companyLoad(R),isGlobal()&&isAdmin()?teamsLoad():Promise.resolve(null),trialLoad()]);
      if(cur!=='gerencia')return;
      top=companyCard(R,C)+(T?mesasCard(T):'')+((isGlobal()&&isAdmin())||P&&P.length?trialCard(P):'');
    }
    const mesa=members.length||teamInfo?`<h2 class="ger-h2">${esc(teamInfo&&teamInfo.name||'Esta mesa')}</h2>`:'';
    b.innerHTML=gerHead(R)+top+(top?mesa:'')+gerTabla(R,rmR,rmP)+pron+gerEmbudo(R,rows,prev)+gerLQ(R,rows);
    reopen(b,op);
  }
};
