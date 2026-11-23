/* ============================================================
   Campañas: la unidad es afiliador · campaña · país (en todo Vitalis). Información para todos, dentro de Clientes.
   De los registrados en el período (lo que vio la extensión en el CRM): cuántos atienden, cuántos depositaron
   (en el mismo día o después) y dónde se quedan. Los FTD del período salen de las ventas. Lo que promete el anuncio, de campaign_info.
   ============================================================ */
const camN=c=>{c=String(c??'').trim();return /^(null|undefined|-|—)$/i.test(c)?'':c};
const comboKey=(aff,cp,pais)=>norm(String(aff||''))+'|'+norm(camN(cp))+'|'+norm(paisOf(pais));
const campTxt=(aff,cp,pais)=>[String(aff||'')||'sin afiliador',camN(cp)||'sin campaña',paisOf(pais)||'sin país'].join(' · ');
const ATIENDEN=['callback','call_again','hang_up','low_potential','not_interested','pending','failed','ftd'],NO_ATIENDEN=['na','invalid','dnc'];
const POCOS=10; // con menos registrados, los porcentajes van con "pocos datos"
// dónde se quedan: los grupos de status, en orden y con su color
const CG=[['new','New / Talking'],['gone','Salió de Talking'],['na','NA'],['call_again','Call Again'],['hang_up','Hang Up'],['callback','CallBack'],['pending','Pending'],['low_potential','Low potential'],['not_interested','Not interested'],['failed','Depósito trabado'],['invalid','Inválido'],['dnc','Do Not Call'],['ftd','FTD'],['otro','Otros']];
const CGK=new Set(CG.map(x=>x[0]));
let cmp={key:'',rows:[],info:[],busy:null,at:0,pais:'',aff:'',q:'',open:false};

async function campLoad(from,to,force){
  const key=from+'|'+to;
  if(cmp.busy)return cmp.busy;
  if(!force&&cmp.key===key&&Date.now()-cmp.at<60e3)return;
  cmp.busy=(async()=>{
    try{
      const base=()=>{let q=sb.from('crm_clients').select('*').neq('brand',ARCH);if(from>'0000')q=q.gte('reg',from);if(to<'9999')q=q.lte('reg',to+' 23:59');return q.order('client_id')};
      const [rows,info]=await Promise.all([crmPage(base,30000),ficOk===false?Promise.resolve([]):QO(sb.from('campaign_info').select('*'))]);
      Object.assign(cmp,{key,rows:rows.map(C2X),info,at:Date.now()});
      if(ready&&cur==='campanas')V.campanas.render({});
    }catch(e){}finally{cmp.busy=null}
  })();
  return cmp.busy;
}
const regIn=(r,from,to)=>{const d=regDay(r);return d>=from&&d<=to};
// los números de cada combinación: de los registrados (rows) y de las ventas del período (sales)
function campStats(rows,sales){
  const S=soldIdx(),m=new Map();
  const get=(aff,cp,pais)=>{const k=comboKey(aff,cp,pais);let g=m.get(k);if(!g)m.set(k,g={k,aff:String(aff||''),camp:camN(cp),pais:paisOf(pais),reg:0,at:0,no:0,dep:0,nw:0,lt:0,grp:{},ftd:0,fnw:0,flt:0,rows:[]});return g};
  for(const r of rows){
    const g=get(r.aff,r.camp,r.country),f=S.get(ckey(r.brand,r.id)),paid=!!f||paidCrm(r),grp=paid?'ftd':CGK.has(r.grp)?r.grp:'otro';
    g.reg++;g.rows.push(r);g.grp[grp]=(g.grp[grp]||0)+1;
    if(paid||ATIENDEN.includes(r.grp))g.at++;else if(NO_ATIENDEN.includes(r.grp))g.no++;
    if(paid){g.dep++;const same=f?!isLate(f):!!(r.ftd&&r.ftd.slice(0,10)===regDay(r));if(same)g.nw++;else g.lt++}
  }
  for(const f of sales){const g=get(f.aff,f.camp,f.country);g.ftd++;if(isLate(f))g.flt++;else g.fnw++}
  return [...m.values()];
}
const infoOf=(aff,cp,pais)=>cmp.info.find(i=>comboKey(i.aff,i.camp,i.country)===comboKey(aff,cp,pais))||null;
const pctTxt=(a,b)=>b?Math.round(a/b*100)+'%':'—';
function stBar(g){
  const tot=g.reg||1;
  return `<span class="cb-bar" title="${esc(CG.filter(([k])=>g.grp[k]).map(([k,l])=>`${l}: ${g.grp[k]}`).join(' · '))}">${CG.filter(([k])=>g.grp[k]).map(([k])=>`<i class="cg-${k}" style="width:${(g.grp[k]/tot*100).toFixed(1)}%"></i>`).join('')}</span>`;
}
// la línea de la ficha: "de cada 10 de esta campaña, 6 atienden y 1 deposita"
function campLine(g){
  if(!g||!g.reg)return '';
  if(g.reg<POCOS)return `${plural(g.reg,'registrado')} visto${g.reg===1?'':'s'}: ${g.at} ${g.at===1?'atendió':'atendieron'} y ${g.dep} ${g.dep===1?'depositó':'depositaron'} <span class="d">(pocos datos todavía)</span>`;
  const dec=g.at+g.no,a=dec?Math.round(g.at/dec*10):null,dp=Math.round(g.dep/g.reg*10);
  return `De cada 10 de esta campaña${a!=null?`, ${a} ${a===1?'atiende':'atienden'}`:''} y ${dp} ${dp===1?'deposita':'depositan'}`;
}
// en la ficha: los números de la combinación del cliente (todo lo visto, sin fechas)
async function comboStats(aff,cp,pais){
  if(!aff&&!camN(cp))return null;
  let rows=[];
  if(crm.ok!==false){try{let q=()=>{let x=sb.from('crm_clients').select('*').neq('brand',ARCH);x=aff?x.eq('aff',String(aff)):x;x=camN(cp)?x.eq('camp',camN(cp)):x;return x.order('client_id')};
    rows=(await crmPage(q,5000)).map(C2X).filter(r=>comboKey(r.aff,r.camp,r.country)===comboKey(aff,cp,pais))}catch(e){}}
  pass++;
  const sales=team.filter(f=>!isArch(f.brand)&&comboKey(f.aff,f.camp,f.country)===comboKey(aff,cp,pais));
  const g=campStats(rows,sales).find(x=>x.k===comboKey(aff,cp,pais))||null;
  if(g){g.last=sales.reduce((a,f)=>!a||byDate(f,a)>0?f:a,null);g.f30=sales.filter(f=>f.date>=addDays(todayS(),-29)).length}
  return g;
}
function comboHTML(d){
  const g=d.cs,rw2=(k,v)=>`<div class="fi-r"><span>${k}</span><b>${v}</b></div>`;
  if(!d.aff&&!d.camp)return `<div class="fi-c"><h4>Campaña</h4><p class="p-sub" style="margin:0">El CRM no la muestra en la lista.</p></div>`;
  return `<div class="fi-c fi-combo"><h4>Campaña <span class="fi-v" title="${esc(campTxt(d.aff,d.camp,d.pais))}">${esc(campTxt(d.aff,d.camp,d.pais))}</span></h4>
    ${g&&g.reg?`<p class="fi-cline">${campLine(g)}</p>${stBar(g)}`:''}${(h=>h?`<p class="fi-late">${esc(h)}</p>`:'')(affLateHint(d.aff))}
    ${g&&g.reg?rw2('Registrados vistos',g.reg)+rw2('Atienden',`${g.at} · ${pctTxt(g.at,g.at+g.no)}`)+rw2('Depositaron',`${g.dep} · ${pctTxt(g.dep,g.reg)}${g.dep?` <span class="d">(${g.nw} new · ${g.lt} late)</span>`:''}`):''}
    ${g&&g.ftd?rw2('FTDs en 30 días',g.f30)+rw2('FTDs en total',`${g.ftd} · ${pctTxt(g.flt,g.ftd)} late`)+(g.last?rw2('Último FTD',`${esc(g.last.date===todayS()?'hoy':dm(g.last.date))} ${esc(g.last.time||'')}`):''):(g&&g.reg?'':'<p class="p-sub" style="margin:0">Sin datos de esta campaña todavía.</p>')}${fiCampsHTML(d)}</div>`;
}

/* ---------- la parte de Campañas en Clientes ---------- */
function campCard(from,to,perTxt){
  if(crm.ok===false)return '';
  campLoad(from,to);
  const loading=cmp.key!==from+'|'+to;
  const sales=team.filter(f=>!isArch(f.brand)&&f.date>=from&&f.date<=to);
  const rows=loading?[]:cmp.rows.filter(r=>regIn(r,from,to));
  let L=campStats(rows,sales);
  const affs=[...new Set(L.map(g=>g.aff).filter(Boolean))].sort(),q=norm(cmp.q).trim();
  L=L.filter(g=>(!cmp.pais||g.pais===cmp.pais)&&(!cmp.aff||g.aff===cmp.aff)&&(!q||norm(campTxt(g.aff,g.camp,g.pais)).includes(q)))
    .sort((a,b)=>b.reg-a.reg||b.ftd-a.ftd||a.k.localeCompare(b.k));
  const tot=L.reduce((a,g)=>{a.reg+=g.reg;a.at+=g.at;a.no+=g.no;a.dep+=g.dep;a.ftd+=g.ftd;return a},{reg:0,at:0,no:0,dep:0,ftd:0});
  const few=g=>g.reg&&g.reg<POCOS?' few" title="Pocos datos todavía':'';
  const row=g=>{const i=infoOf(g.aff,g.camp,g.pais);return `<tr data-cmp="${esc(g.k)}" tabindex="0"><td><div class="cmp-n"><b>${esc(g.camp||'sin campaña')}</b><span class="d">${esc(g.aff||'sin afiliador')} · ${esc(g.pais||'sin país')}</span></div></td>
    <td class="num">${g.reg||'<span class="d">—</span>'}</td><td class="num${few(g)}">${g.at+g.no?`${pctTxt(g.at,g.at+g.no)} <span class="d">${g.at}/${g.at+g.no}</span>`:'<span class="d">—</span>'}</td>
    <td class="num${few(g)}">${g.reg?`${pctTxt(g.dep,g.reg)} <span class="d">${g.nw} new · ${g.lt} late</span>`:'<span class="d">—</span>'}</td>
    <td class="num">${g.ftd?`<b>${g.ftd}</b> <span class="d">${g.fnw} · ${g.flt}</span>`:'<span class="d">—</span>'}</td>
    <td>${g.reg?stBar(g):''}</td><td class="trunc">${i&&i.min_amount?esc(i.min_amount):'<span class="d">—</span>'}</td></tr>`};
  const sel=`<select data-cmpf="pais" aria-label="País"><option value="">Todos los países</option>${PAISES.map(p=>`<option${cmp.pais===p?' selected':''}>${esc(p)}</option>`).join('')}</select>
    <select data-cmpf="aff" aria-label="Afiliador"><option value="">Todos los afiliadores</option>${affs.map(a=>`<option${cmp.aff===a?' selected':''}>${esc(a)}</option>`).join('')}</select>
    <input data-cmpf="q" type="search" placeholder="Buscar campaña" value="${esc(cmp.q)}" aria-label="Buscar campaña" autocomplete="off">`;
  return `<div class="card-h"><h3>Campañas</h3><span class="p-sub">afiliador · campaña · país · registrados ${esc(perTxt)}</span><span class="grow"></span><div class="cmp-f">${sel}</div></div>
    ${loading?'<div class="p-empty">Cargando…</div>':L.length?`<p class="note" style="margin:0 0 10px">${tot.reg} registrados: ${pctTxt(tot.at,tot.at+tot.no)} atienden, ${pctTxt(tot.dep,tot.reg)} depositaron · ${tot.ftd} FTDs en el período. Los registrados y su status salen de lo que vio la extensión en el CRM; los FTDs, de las ventas.</p>
      <div class="p-tablewrap"><table class="pt cmp-t"><thead><tr><th>Campaña</th><th class="num">Registrados</th><th class="num" title="De los que ya tienen resultado: atendieron contra NA, número inválido o Do Not Call">Atienden</th><th class="num" title="De los registrados en el período">Depositaron</th><th class="num" title="Ventas del período (new · late)">FTDs</th><th>Dónde se quedan</th><th>Mínimo del anuncio</th></tr></thead><tbody>${L.slice(0,cmp.open?500:40).map(row).join('')}</tbody></table></div>
      ${L.length>40&&!cmp.open?`<button type="button" class="btn sm rk-more" data-cmpm>Ver las ${L.length}</button>`:''}`:'<div class="p-empty">Sin campañas con ese filtro.</div>'}`;
}
function campDetail(k,from,to,perTxt){
  pass++;
  const sales=team.filter(f=>!isArch(f.brand)&&f.date>=from&&f.date<=to);
  const g=campStats(cmp.rows.filter(r=>regIn(r,from,to)),sales).find(x=>x.k===k);if(!g)return;
  const d={aff:g.aff,pais:g.pais,camp:g.camp,camps:[{camp:g.camp,info:infoOf(g.aff,g.camp,g.pais),mine:true}],reqs:[]};
  const i=d.camps[0].info,ed=bkEd();
  const body=()=>`<p class="mp">${esc(g.aff||'sin afiliador')} · ${esc(g.pais||'sin país')} · registrados ${esc(perTxt)}</p>
    ${g.reg?`<p class="fi-cline">${campLine(g)}</p>${stBar(g)}<div class="cmp-leg">${CG.filter(([x])=>g.grp[x]).map(([x,l])=>`<span><i class="cg-${x}"></i>${esc(l)} <b>${g.grp[x]}</b></span>`).join('')}</div>`:'<p class="p-sub">Sin registrados en el período.</p>'}
    <div class="cmp-k"><div><span>Registrados</span><b>${g.reg}</b></div><div><span>Atienden</span><b>${pctTxt(g.at,g.at+g.no)}</b></div><div><span>Depositaron</span><b>${pctTxt(g.dep,g.reg)}</b><small>${g.nw} new · ${g.lt} late</small></div><div><span>FTDs del período</span><b>${g.ftd}</b><small>${g.fnw} new · ${g.flt} late</small></div></div>
    <div class="fi-c"><h4>El anuncio</h4>${g.camp?(i?`<div class="fi-r"><span>Monto mínimo</span><b>${esc(i.min_amount||'—')}</b></div>${i.ad_text?`<p class="fi-ad">${esc(i.ad_text)}</p>`:''}<button type="button" class="lnk" data-cma="${ed?'edit':'req'}">${ed?'Editar':'Pedir un cambio'}</button>`:`<p class="p-sub" style="margin:0 0 6px">Sin datos todavía.</p><button type="button" class="btn sm" data-cma="add">Agregar</button>`):'<p class="p-sub" style="margin:0">Sin campaña.</p>'}</div>
    ${g.rows.length?`<h4 class="cmp-h">Sus clientes</h4><div class="p-tablewrap"><table class="pt"><thead><tr><th>Cliente</th><th>Status</th><th>Registro</th><th>Agente</th></tr></thead><tbody>${g.rows.sort(byRegDesc).slice(0,150).map(r=>`<tr><td><button type="button" class="lnkp" data-cmo="${esc(r.id)}"><b>${esc(r.id)}</b></button> <span class="ah-nm">${esc(r.name)}</span></td><td>${stBadge(r)}</td><td class="d">${esc(r.reg||'')}</td><td class="trunc">${esc(crmOwner(r)?memberName(crmOwner(r)):r.agent||'—')}</td></tr>`).join('')}</tbody></table></div>`:''}`;
  modal({title:esc(g.camp||'Sin campaña'),wide:true,body:body(),
    onOpen:api=>api.box.addEventListener('click',e=>{
      const o=e.target.closest('[data-cmo]');if(o){api.close();openFicha(o.dataset.cmo);return}
      const a=e.target.closest('[data-cma]');if(!a)return;
      const after=async()=>{await campLoad(from,to,true);api.close();campDetail(k,from,to,perTxt)};
      if(a.dataset.cma==='req')return campReqModal(d,g.camp);
      campModal(d,g.camp,a.dataset.cma==='edit',after);
    }),actions:[{l:'Cerrar'}]});
}
