/* ============================================================
   Radar: lo que predice ventas (PROPUESTAS.md, 10 ideas).
   Todo sale de las ventas de la mesa (`team`) y de los clientes del CRM: sin tablas nuevas.
   Mientras Novara junta historia (menos de RD_MIN FTDs), los patrones usan también la de Trade24Seven y lo dicen.
   Los números se aprenden de las ventas en cada dibujo (`*Learn`); mientras falten datos, se usa el de respaldo (`*_FIX`),
   que salió de la historia de Trade24Seven.
   El pronóstico del mes y la curva del agente nuevo: solo team leader y admin (en Equipo).
   ============================================================ */
const RD_MIN=400;
const rdBase=perPass(()=>{const nv=team.filter(f=>!isArch(f.brand)),all=nv.length<RD_MIN;return {list:all?team:nv,nv:nv.length,all}});
const rdNote=()=>{const b=rdBase();return (b.all?`Con la historia de Trade24Seven: Novara lleva ${plural(b.nv,'FTD')} y desde ${RD_MIN} se usa sola.`:`Con los ${nf(b.nv)} FTDs de Novara.`)+' Se recalcula con cada venta.'};
const rdHour=f=>{const m=/^(\d{1,2}):/.exec(f.time||'');return m?+m[1]:null};
const rdPais=f=>paisOf(f.country)||'';
const rdFew=n=>`<div class="p-empty">Pocos datos todavía${n!=null?` (${n})`:''}.</div>`;
const hmMin=s=>{const m=/^(\d{1,2}):(\d{2})/.exec(s||'');return m?+m[1]*60+ +m[2]:null};
const quant=(a,q)=>{if(!a.length)return null;const v=[...a].sort((x,y)=>x-y),i=(v.length-1)*q,lo=Math.floor(i);return v[lo]+(v[Math.ceil(i)]-v[lo])*(i-lo)};
const r5=x=>Math.max(5,Math.round(x/5)*5);
const minTxt=m=>m<60?m+' min':Math.floor(m/60)+' h'+(m%60?' '+(m%60)+' min':'');
const tenTxt=p=>{const k=Math.round(p*10);return k<=0?'casi nunca':k>=10?'casi siempre':k+' de cada 10 veces'};
// días hábiles entre dos fechas (los del viernes vuelven el lunes)
function bizDays(a,b){let n=0;const d=parseYMD(a),e=parseYMD(b);while(d<e){d.setDate(d.getDate()+1);const w=d.getDay();if(w!==0&&w!==6)n++}return n}

/* ---------- 1) el reloj del new ---------- */
// de los que depositan el mismo día: minutos del registro al FTD. Ventana fuerte = la mitad (por país); frío = pasado el 85%.
const NEW_FIX={chile:46,colombia:54,mexico:64,peru:66},NEW_FIX_DEF=52,NEW_FIX_COLD=120,NEW_MIN=40,NEW_MIN_PAIS=15;
const newLearn=perPass(()=>{
  const all=[],by=new Map();
  for(const f of rdBase().list){
    const rg=String(f.reg||'');if(rg.length<16||isLate(f))continue; // hace falta la hora del registro
    const a=hmMin(rg.slice(11,16)),b=hmMin(f.time);if(a==null||b==null)continue;
    const m=b-a;if(m<0||m>14*60)continue;
    all.push(m);const p=norm(rdPais(f));if(!p)continue;let L=by.get(p);if(!L)by.set(p,L=[]);L.push(m);
  }
  const ok=all.length>=NEW_MIN,win={};
  if(ok)for(const [p,L] of by)if(L.length>=NEW_MIN_PAIS)win[p]={w:r5(quant(L,.5)),n:L.length};
  return {ok,n:all.length,def:ok?r5(quant(all,.5)):NEW_FIX_DEF,cold:ok?Math.min(240,Math.max(60,r5(quant(all,.85)))):NEW_FIX_COLD,win};
});
function newWin(country){ // {w: ventana fuerte, cold: desde cuándo está frío, n: de cuántas ventas sale (0 = respaldo)}
  const L=newLearn(),p=norm(paisOf(country)),x=L.win[p];
  if(x)return {w:x.w,cold:Math.max(L.cold,x.w+5),n:x.n,pais:1};
  if(L.ok)return {w:L.def,cold:Math.max(L.cold,L.def+5),n:L.n,pais:0};
  return {w:NEW_FIX[p]||NEW_FIX_DEF,cold:NEW_FIX_COLD,n:0,pais:0};
}
function newClock(r){
  if(r.grp!=='new'||!r.reg||r.reg.length<=10)return '';
  const at=regAt(r);if(!at||ymd(at)!==todayS())return '';
  const m=Math.round((Date.now()-at)/6e4);if(m<0)return '';
  const {w,cold,n,pais}=newWin(r.country);
  const t=`La mitad de los que depositan el mismo día lo hace antes de los ${w} min del registro; 85% antes de ${minTxt(cold)}.`+(n?` Sale de ${n} ventas${pais?' de '+(paisOf(r.country)||'su país'):' de la mesa'}.`:'');
  if(m<=w)return `<span class="rl on" title="${esc(t)}">ventana fuerte · ${w-m} min</span>`;
  if(m<=cold)return `<span class="rl mid" title="${esc(t)}">se enfría · ${cold-m} min</span>`;
  return `<span class="rl off" title="${esc(t)}">frío</span>`;
}

/* ---------- 2) campaña caliente ---------- */
const hotCamps=perPass(()=>{
  const te=todayS(),m=new Map();
  for(const f of team){if(f.date!==te||isArch(f.brand))continue;const k=comboKey(f.aff,f.camp,f.country);let o=m.get(k);if(!o)m.set(k,o={k,n:0,txt:campTxt(f.aff,f.camp,f.country)});o.n++}
  return [...m.values()].filter(o=>o.n>=2).sort((a,b)=>b.n-a.n);
});
// de los días en que una campaña llegó a n FTDs, en cuántos llegó otro más
const HOT_MIN=20;
const hotLearn=perPass(()=>{
  const g=new Map();
  for(const f of rdBase().list){if(!f.aff&&!f.camp)continue;const k=f.date+'|'+comboKey(f.aff,f.camp,f.country);g.set(k,(g.get(k)||0)+1)}
  const memo=new Map();
  return n=>{if(memo.has(n))return memo.get(n);let a=0,b=0;for(const c of g.values())if(c>=n){a++;if(c>n)b++}const v=a>=HOT_MIN?b/a:null;memo.set(n,v);return v};
});
function hotChance(n){
  const at=hotLearn();let p=null;
  for(let k=n;k>=2&&p==null;k--)p=at(k); // con 5 hoy y pocos días así de calientes, uso lo que pasa desde 4, 3…
  if(p==null)return n>=3?'casi la mitad de las veces llega otro':'1 de cada 3 veces llega otro';
  return tenTxt(p)+' llega otro';
}
function hotMine(q){ // q: la cola de quien mira; devuelve las campañas calientes con sus clientes sin depositar
  const H=hotCamps();if(!H.length||!q)return [];
  const L=[...q.g1,...q.cb,...q.g3,...q.low];
  return H.map(h=>({...h,cl:L.filter(r=>comboKey(r.aff,r.camp,r.country)===h.k)})).filter(h=>h.cl.length);
}
function hotCard(q){
  const H=hotMine(q);if(!H.length)return '';
  return `<section class="card rd-hot"><div class="card-h"><svg class="ic" aria-hidden="true"><use href="#i-racha"/></svg><h3>Campaña caliente</h3><span class="p-sub">está depositando hoy: llamá primero a los de esa campaña</span></div>
    ${H.map(h=>`<div class="rd-hot-r"><div><b>${esc(h.txt)}</b> <span class="d">lleva ${h.n} FTDs hoy · ${hotChance(h.n)}</span></div>
      <div class="rd-ids">${h.cl.slice(0,14).map(r=>`<button type="button" class="chip" data-ah="ficha" data-id="${esc(r.id)}" title="${esc(r.name)} · ${esc(r.status)}">${esc(r.id)}</button>`).join('')}${h.cl.length>14?`<span class="d">+${h.cl.length-14}</span>`:''}</div></div>`).join('')}</section>`;
}
function hotNotify(){ // un aviso por campaña y por día, cuando llega a 2 y tenés clientes de esa campaña
  if(!ready||!crm.ok||isLeadUid(me))return;
  const H=hotCamps();if(!H.length)return;
  const te=todayS(),seen=local.get('hot',{d:te,k:[]});if(seen.d!==te){seen.d=te;seen.k=[]}
  const fresh=H.filter(h=>!seen.k.includes(h.k));if(!fresh.length)return;
  const mine=hotMine(queueOf(me));
  for(const h of fresh){seen.k.push(h.k);const x=mine.find(y=>y.k===h.k);
    if(x)toast(`<b>Campaña caliente</b>: ${esc(h.txt)} lleva ${h.n} FTDs hoy. Tenés ${plural(x.cl.length,'cliente')} de esa campaña sin depositar.`,'imp',{ms:15000,key:'hot'+h.k,actions:[{l:'Ver la cola',fn:()=>go('ahora')}]})}
  local.set('hot',seen);
}

/* ---------- 3) segundas oportunidades ---------- */
// de los que depositan otro día (late): 47% al día siguiente, 64% en 3 días, 87% en 7
const SEG_GRP=['pending','failed','callback','call_again','low_potential'];
function segList(q){
  if(!q)return [];
  const te=todayS(),seen=new Set(),out=[];
  for(const r of [...q.cb,...q.g3,...q.low,...q.failed]){
    if(!SEG_GRP.includes(r.grp)||seen.has(r.id))continue;seen.add(r.id);
    const rd=regDay(r);if(!rd||rd>=te)continue;
    const d=bizDays(rd,te);if(d<1||d>10)continue;
    out.push({r,d,w:(d<=1?0:d<=3?10:d<=7?20:30)+SEG_GRP.indexOf(r.grp)});
  }
  return out.sort((a,b)=>a.w-b.w||(regAt(b.r)||0)-(regAt(a.r)||0));
}
// de los que depositan otro día: cuántos días hábiles después del registro
const SEG_FIX={d1:.47,d3:.64,d7:.87},SEG_MIN=40;
const segLearn=perPass(()=>{
  const d=[];
  for(const f of rdBase().list){
    if(!isLate(f))continue;const a=String(f.reg).slice(0,10);
    if((parseYMD(f.date)-parseYMD(a))/864e5>60)continue; // un registro mal cargado no cuenta
    d.push(bizDays(a,f.date));
  }
  if(d.length<SEG_MIN)return {...SEG_FIX,n:0};
  const sh=x=>d.filter(v=>v<=x).length/d.length;
  return {d1:sh(1),d3:sh(3),d7:sh(7),n:d.length};
});
const segTag=d=>d<=1?sp('rl on','hoy es su mejor día'):d<=3?sp('rl mid','todavía a tiempo'):d<=7?sp('rl off','última semana'):sp('rl off','poca chance');
function segCard(q,who){
  const L=segList(q);if(!L.length)return '';
  const row=({r,d})=>`<tr><td><button type="button" class="lnkp" data-ah="ficha" data-id="${esc(r.id)}"><b>${esc(r.id)}</b></button> <span class="ah-nm">${esc(r.name)}</span></td><td>${stBadge(r)}</td><td class="d">hace ${plural(d,'día hábil','días hábiles')}</td><td>${segTag(d)}</td><td>${esc(r.country)}</td>${who?`<td class="trunc">${esc(crmOwner(r)?memberName(crmOwner(r)):r.agent||'—')}</td>`:''}
    <td class="act wr"><button type="button" class="ib" data-ah="ag" data-id="${esc(r.id)}" data-nm="${esc(r.status)}">Agendar</button></td></tr>`;
  return `<section class="card ah-g"><details data-k="seg"${L.some(x=>x.d<=1)?' open':''}><summary class="card-h"><h3>Segundas oportunidades</h3><span class="p-sub">${L.length} que hablaron y no depositaron · ${(S=>`de los que vuelven, ${pct(S.d1)} lo hace al día hábil siguiente y ${pct(S.d7)} antes de los 7 días hábiles`)(segLearn())}</span></summary>
    <div class="p-tablewrap"><table class="pt ah-t"><thead><tr><th>Cliente</th><th>Status</th><th>Registro</th><th>Chance</th><th>País</th>${who?'<th>Agente</th>':''}<th class="act"></th></tr></thead><tbody>${L.slice(0,25).map(row).join('')}</tbody></table></div>
    ${L.length>25?`<p class="p-sub" style="margin-top:8px">y ${L.length-25} más.</p>`:''}</details></section>`;
}

/* ---------- 5) el mapa del día ---------- */
const H0=8,H1=20;
const dayMap=perPass(()=>{
  const m=new Map();
  for(const f of rdBase().list){const h=rdHour(f),p=rdPais(f);if(h==null||!p)continue;let o=m.get(p);if(!o)m.set(p,o={p,n:0,h:Array(24).fill(0)});o.n++;o.h[h]++}
  return [...m.values()].filter(o=>o.n>=20).sort((a,b)=>b.n-a.n).slice(0,8);
});
function mapCard(){
  const M=dayMap(),hr=new Date().getHours(),hs=[];for(let h=H0;h<=H1;h++)hs.push(h);
  if(!M.length)return `<section class="card"><div class="card-h"><h3>El mapa del día</h3><span class="p-sub">a qué hora deposita cada país</span></div>${rdFew()}</section>`;
  const strong=M.filter(o=>{const mx=Math.max(...o.h);return mx&&o.h[hr]>=mx*.8}).map(o=>o.p);
  return `<section class="card"><div class="card-h"><h3>El mapa del día</h3><span class="p-sub">a qué hora deposita cada país (hora del CRM)</span></div>
    <p class="rd-now">${hr>=H0&&hr<=H1?(strong.length?`Ahora (${hr} h) es hora fuerte de <b>${esc(strong.join(', '))}</b>.`:`Ahora (${hr} h) no es la hora fuerte de ningún país.`):'Fuera del horario de depósitos.'}</p>
    <div class="p-tablewrap"><table class="rd-map"><thead><tr><th></th>${hs.map(h=>`<th class="${h===hr?'now':''}">${h}</th>`).join('')}</tr></thead><tbody>
    ${M.map(o=>{const mx=Math.max(...o.h.slice(H0,H1+1))||1,top=o.h.indexOf(Math.max(...o.h));
      return `<tr><th>${esc(o.p)} <span class="d">${o.n}</span></th>${hs.map(h=>{const v=o.h[h]/mx;return `<td class="${h===hr?'now':''}" title="${esc(o.p)} · ${h} h: ${o.h[h]} FTDs (${pct(o.h[h]/o.n)})"><i style="opacity:${v?Math.max(.08,v).toFixed(2):0}"></i>${h===top?'<b>●</b>':''}</td>`}).join('')}</tr>`}).join('')}
    </tbody></table></div><p class="p-sub rd-foot">Más oscuro = más depósitos. ● la mejor hora de cada país. La Cola pone primero a los de un país en su hora fuerte, y Agendar sugiere esa hora.</p></section>`;
}

// la hora de cada país, del mismo mapa: para la Cola (hora fuerte ahora) y para Agendar (la hora que más deposita)
const HOUR_MIN=20,HOUR_STRONG=.8,HOUR_WEAK=.25;
const hourBy=perPass(()=>{
  const m=new Map();
  for(const f of rdBase().list){const h=rdHour(f),p=rdPais(f);if(h==null||!p)continue;let o=m.get(norm(p));if(!o)m.set(norm(p),o={p,n:0,h:Array(24).fill(0)});o.n++;o.h[h]++}
  for(const o of m.values()){let top=0;for(let h=1;h<24;h++)if(o.h[h]>o.h[top])top=h;o.top=top;o.max=o.h[top]}
  return m;
});
function hourOf(country){const o=hourBy().get(norm(paisOf(country)));return o&&o.n>=HOUR_MIN&&o.max?o:null}
// 2 = ahora es su hora fuerte · -1 = ahora casi no deposita · 0 = normal o sin datos
function hourNow(country,hr=new Date().getHours()){const o=hourOf(country);if(!o)return 0;const v=o.h[hr]/o.max;return v>=HOUR_STRONG?2:v<=HOUR_WEAK?-1:0}
function hourBest(country){const o=hourOf(country);return o?{p:o.p,h:o.top,sh:o.h[o.top]/o.n}:null} // la mejor hora para agendarlo
const hourStrongNow=(hr=new Date().getHours())=>[...hourBy().values()].filter(o=>o.n>=HOUR_MIN&&o.max&&o.h[hr]/o.max>=HOUR_STRONG).map(o=>o.p);

/* ---------- 6) días de cobro ---------- */
const BUCK=[[1,6],[7,13],[14,17],[18,24],[25,31]];
const payDaysBy=perPass(()=>{
  const m=new Map();
  for(const f of rdBase().list){const p=rdPais(f),d=+String(f.date).slice(8,10);if(!p||!d)continue;let o=m.get(p);if(!o)m.set(p,o={p,n:0,b:BUCK.map(()=>0)});o.n++;o.b[BUCK.findIndex(([a,z])=>d>=a&&d<=z)]++}
  for(const o of m.values())o.ix=o.b.map((v,i)=>{const even=(BUCK[i][1]-BUCK[i][0]+1)/30.4;return {sh:v/o.n,even,ix:v/o.n/even}});
  return [...m.values()].filter(o=>o.n>=40).sort((a,b)=>b.n-a.n).slice(0,8);
});
const bTxt=i=>`del ${BUCK[i][0]} al ${BUCK[i][1]}`;
function cobroHint(country){ // para agendar a un "no tengo la plata": cuándo deposita más su país
  const o=payDaysBy().find(x=>norm(x.p)===norm(paisOf(country)));if(!o)return '';
  const i=o.ix.reduce((bi,x,j)=>x.ix>o.ix[bi].ix?j:bi,0);if(o.ix[i].ix<1.25)return '';
  return `En ${o.p} depositan más ${bTxt(i)} (${pct(o.ix[i].sh)} de sus FTDs; parejo sería ${pct(o.ix[i].even)}).`;
}
function cobroCardRd(){
  const M=payDaysBy(),day=new Date().getDate(),bi=BUCK.findIndex(([a,z])=>day>=a&&day<=z);
  if(!M.length)return `<section class="card"><div class="card-h"><h3>Días de cobro</h3><span class="p-sub">en qué días del mes deposita cada país</span></div>${rdFew()}</section>`;
  const hoy=M.filter(o=>o.ix[bi].ix>=1.25).map(o=>o.p);
  return `<section class="card"><div class="card-h"><h3>Días de cobro</h3><span class="p-sub">en qué días del mes deposita cada país</span></div>
    <p class="rd-now">${hoy.length?`Hoy es ${day}: días fuertes de <b>${esc(hoy.join(', '))}</b>.`:`Hoy es ${day}: ningún país está en sus días fuertes.`} A los "no tengo la plata", agendalos para los días fuertes de su país.</p>
    <div class="p-tablewrap"><table class="pt rd-pay"><thead><tr><th>País</th>${BUCK.map(([a,z],i)=>`<th class="r${i===bi?' now':''}">${a}–${z}</th>`).join('')}</tr></thead><tbody>
    ${M.map(o=>`<tr><td><b>${esc(o.p)}</b> <span class="d">${o.n}</span></td>${o.ix.map((x,i)=>`<td class="r${x.ix>=1.25?' up':x.ix<=.8?' dn':''}" title="${pct(x.sh)} de sus FTDs; parejo sería ${pct(x.even)}">${pct(x.sh)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div><p class="p-sub rd-foot">En verde, los días en que ese país deposita bastante más que lo parejo.</p></section>`;
}

/* ---------- 7) radar de campañas ---------- */
const campRadar=perPass(()=>{
  const te=todayS(),a0=addDays(te,-13),b0=addDays(te,-27),m=new Map();
  for(const f of team){if(isArch(f.brand)||f.date<b0||f.date>te)continue;const k=comboKey(f.aff,f.camp,f.country);let o=m.get(k);if(!o)m.set(k,o={k,txt:campTxt(f.aff,f.camp,f.country),a:0,b:0});if(f.date>=a0)o.a++;else o.b++}
  const L=[...m.values()];
  return {up:L.filter(o=>(o.b===0&&o.a>=2)||(o.b>0&&o.a>=3&&o.a>=o.b*2)).sort((x,y)=>y.a-x.a).slice(0,8),
    dn:L.filter(o=>o.b>=3&&o.a<=o.b/2).sort((x,y)=>y.b-x.b).slice(0,8),n:L.length};
});
function radarCard(){
  const R=campRadar(),li=(o,cls)=>`<li><b>${esc(o.txt)}</b><span class="${cls}">${o.b} → ${o.a}</span></li>`;
  return `<section class="card"><div class="card-h"><h3>Radar de campañas</h3><span class="p-sub">FTDs de las últimas 2 semanas contra las 2 anteriores · Novara</span></div>
    ${!R.n?rdFew():`<div class="rd-2"><div><h4>Nacen o crecen</h4>${R.up.length?`<ul class="rd-l">${R.up.map(o=>li(o,'ok b')).join('')}</ul>`:'<p class="p-sub">Ninguna por ahora.</p>'}</div>
    <div><h4>Se apagan</h4>${R.dn.length?`<ul class="rd-l">${R.dn.map(o=>li(o,'hot b')).join('')}</ul>`:'<p class="p-sub">Ninguna por ahora.</p>'}</div></div>
    <p class="p-sub rd-foot">Una campaña da lo mejor en sus primeras semanas: a las que nacen, llamarlas primero.</p>`}</section>`;
}

/* ---------- 8) tu día ---------- */
// por agente y día: a qué hora llegó el primer FTD y cómo terminó el día
const dayStart=perPass(()=>{
  const m=new Map();
  for(const f of rdBase().list){const h=rdHour(f);if(h==null)continue;const k=f.uid+'|'+f.date;let o=m.get(k);if(!o)m.set(k,o={h:99,n:0});o.n++;if(h<o.h)o.h=h}
  const B=[{l:'antes de las 11',t:h=>h<11},{l:'entre las 11 y las 13',t:h=>h>=11&&h<13},{l:'entre las 13 y las 15',t:h=>h>=13&&h<15},{l:'después de las 15',t:h=>h>=15}].map(b=>({...b,d:0,n2:0,n3:0}));
  for(const o of m.values()){const b=B.find(x=>x.t(o.h));if(!b)continue;b.d++;if(o.n>=2)b.n2++;if(o.n>=3)b.n3++}
  return B;
});
function diaLine(){
  if(isLeadUid(me))return '';
  const te=todayS(),hoy=ftds.filter(f=>f.date===te&&f.time).sort((a,b)=>a.time.localeCompare(b.time)),B=dayStart(),hr=new Date().getHours();
  if(hoy.length){
    const h=rdHour(hoy[0]),b=B.find(x=>x.t(h));if(!b||b.d<20)return '';
    if(hoy.length>=3)return '';
    return `Primer FTD a las ${esc(hoy[0].time)}. De los días que arrancan ${b.l}, <b>${pct(b.n2/b.d)}</b> termina con 2 o más${b.n3?` y ${pct(b.n3/b.d)} con 3 o más`:''}.`;
  }
  if(hr<11&&B[0].d>=20&&!ftds.some(f=>f.date===te))return `Un FTD antes de las 11 cambia el día: <b>${pct(B[0].n2/B[0].d)}</b> de esos días termina con 2 o más.`;
  return '';
}

/* ---------- 9) afiliadores que maduran tarde ---------- */
const affLate=perPass(()=>{
  const m=new Map();let n=0,lt=0;
  for(const f of rdBase().list){const a=String(f.aff||'').trim();n++;const l=isLate(f)?1:0;lt+=l;if(!a)continue;let o=m.get(norm(a));if(!o)m.set(norm(a),o={a,n:0,lt:0});o.n++;o.lt+=l}
  const mesa=n?lt/n:0,L=[...m.values()].filter(o=>o.n>=15).map(o=>({...o,sh:o.lt/o.n,slow:o.lt/o.n>=mesa*1.8&&o.lt/o.n>=mesa+.08})).sort((x,y)=>y.sh-x.sh);
  return {mesa,L,n};
});
function affLateHint(aff){
  const A=affLate(),o=A.L.find(x=>norm(x.a)===norm(String(aff||'').trim()));
  return o&&o.slow?`Este afiliador madura tarde: ${pct(o.sh)} de sus ventas llegan otro día (la mesa: ${pct(A.mesa)}). Conviene insistir varios días.`:'';
}
function lateCard(){
  const A=affLate();
  return `<section class="card"><div class="card-h"><h3>Afiliadores que maduran tarde</h3><span class="p-sub">cuánto de lo que venden llega otro día (late) · la mesa: ${pct(A.mesa)}</span></div>
    ${!A.L.length?rdFew():`<div class="p-tablewrap"><table class="pt"><thead><tr><th>Afiliador</th><th class="r">FTDs</th><th class="r">Late</th><th></th></tr></thead><tbody>
    ${A.L.slice(0,12).map(o=>`<tr><td><b>${esc(o.a)}</b></td><td class="r">${o.n}</td><td class="r${o.slow?' up':''}">${pct(o.sh)}</td><td>${o.slow?sp('rl mid','insistir varios días'):''}</td></tr>`).join('')}
    </tbody></table></div><p class="p-sub rd-foot">Con los que maduran tarde, un "lo pienso" vale más: agendalos y volvé a llamar.</p>`}</section>`;
}

/* ---------- 4) pronóstico del mes (solo team leader y admin) ---------- */
// cuánto del mes lleva la mesa a cada día. Se aprende de los meses cerrados (sin el actual ni el primero, que suele estar a medias,
// y con 30 FTDs o más): la mediana es lo más probable; el rango, del 10% al 90% (con menos de 10 meses, del peor al mejor).
const PACE_FIX=[[10,.34,.21,.41],[15,.52,.34,.61],[20,.70,.52,.82],[25,.85,.70,.98],[31,1,1,1]],PACE_MIN=3;
const paceLearn=perPass(()=>{
  const months=list=>{
    const by=new Map();for(const f of list){const ym=f.date.slice(0,7);let a=by.get(ym);if(!a)by.set(ym,a=Array(32).fill(0));a[+f.date.slice(8,10)]++}
    const now=ymNow(),yms=[...by.keys()].sort(),out=[];
    for(const ym of yms){if(ym>=now||ym===yms[0])continue;const a=by.get(ym),tot=a.reduce((x,v)=>x+v,0);if(tot<30)continue;const c=[0];for(let d=1;d<32;d++)c[d]=c[d-1]+a[d];out.push(c.map(v=>v/tot))}
    return out;
  };
  let M=months(rdBase().list);if(M.length<PACE_MIN)M=months(team); // cómo cierra un mes es de la mesa, no de la marca
  return M.length>=PACE_MIN?M:null;
});
function paceAt(day){
  if(day<8)return null;
  const M=paceLearn();
  if(M){
    const v=M.map(c=>c[Math.min(31,day)]),q=M.length>=10?[.1,.9]:[0,1],cl=x=>Math.min(1,Math.max(.05,x));
    return {mid:cl(quant(v,.5)),lo:cl(quant(v,q[0])),hi:cl(quant(v,q[1])),n:M.length};
  }
  const P=PACE_FIX;
  if(day<=10){const k=day/10;return {mid:P[0][1]*k,lo:P[0][2]*k,hi:P[0][3]*k,n:0}}
  for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i];if(day<=b[0]){const k=(day-a[0])/(b[0]-a[0]),f=j=>a[j]+(b[j]-a[j])*k;return {mid:f(1),lo:f(2),hi:f(3),n:0}}}
  return {mid:1,lo:1,hi:1,n:0};
}
function proj(n,day){const p=paceAt(day);if(!p)return null;return {mid:Math.max(n,Math.round(n/p.mid)),lo:Math.max(n,Math.round(n/p.hi)),hi:Math.max(n,Math.round(n/p.lo)),months:p.n}}
function pronCard(){
  if(!isLeader())return '';
  const ym=ymNow(),day=new Date().getDate(),L=team.filter(f=>f.date.slice(0,7)===ym),tg=+targets[ym]||0,P=proj(L.length,day);
  const head=`<div class="card-h"><h3>Pronóstico del mes</h3><span class="p-sub">solo team leader y admin · según cómo cerraron ${(m=>m?plural(m,'mes','meses')+' de historia':'los meses de historia')((paceAt(Math.max(8,day))||{}).n)}</span></div>`;
  if(!P)return head+`<div class="p-empty">Antes del día 8 es muy temprano para proyectar.</div>`;
  const verdict=(p,t)=>!t?'':p.lo>=t?sp('ok b','llega'):p.hi<t?sp('hot b','no llega a este ritmo'):p.mid>=t?sp('ok','en camino'):sp('warn','justo');
  const rows=sellers(team).filter(m=>!isLeadUid(m.id)||L.some(f=>f.uid===m.id)).map(m=>{const n=L.filter(f=>f.uid===m.id).length;return {m,n,p:proj(n,day),t:utOf(m.id,ym)}}).sort((a,b)=>b.n-a.n);
  return head+`<p class="rd-now">La mesa lleva <b>${L.length}</b> al día ${day}. Los meses así cierran entre <b>${P.lo} y ${P.hi}</b> (lo más probable, ${P.mid}).${tg?` Target ${tg}: ${verdict(P,tg)}.`:''}</p>
    <div class="p-tablewrap"><table class="pt"><thead><tr><th>Agente</th><th class="r">Lleva</th><th class="r">Cierre probable</th><th class="r">Rango</th><th class="r">Target</th><th></th></tr></thead><tbody>
    ${rows.map(({m,n,p,t})=>`<tr><td><span class="eq-who">${avatar(m.name)}<b>${esc(m.name)}</b></span></td><td class="r">${n}</td><td class="r"><b>${p.mid}</b></td><td class="r d">${p.lo}–${p.hi}</td><td class="r">${t||'<span class="d">—</span>'}</td><td>${verdict(p,t)}</td></tr>`).join('')}
    </tbody></table></div><p class="p-sub rd-foot">El rango de un agente solo es más ancho que el de la mesa: tomalo como orientación.</p>`;
}

/* ---------- 10) curva del agente nuevo (solo team leader y admin) ---------- */
const newCurve=perPass(()=>{
  const by=new Map();for(const f of team){let o=by.get(f.uid);if(!o)by.set(f.uid,o={first:f.date.slice(0,7),m:new Map()});const ym=f.date.slice(0,7);if(ym<o.first)o.first=ym;o.m.set(ym,(o.m.get(ym)||0)+1)}
  const now=ymNow(),idx=(a,b)=>(+b.slice(0,4)-+a.slice(0,4))*12+(+b.slice(5,7)-+a.slice(5,7)),nxt=(ym,k)=>{const d=new Date(+ym.slice(0,4),+ym.slice(5,7)-1+k,1);return d.getFullYear()+'-'+z(d.getMonth()+1)};
  const start=[...by.values()].reduce((a,o)=>o.first<a?o.first:a,now); // quien ya vendía en el primer mes de la historia no es "nuevo": no se sabe cuándo entró
  const curve=[];
  for(let k=0;k<6;k++){let s=0,c=0;for(const o of by.values()){if(o.first===start)continue;const ym=nxt(o.first,k);if(ym>=now)continue;s+=o.m.get(ym)||0;c++}curve.push({k:k+1,avg:c?s/c:null,c})}
  const fresh=[];for(const [uid,o] of by){const k=idx(o.first,now);if(o.first!==start&&k<=2){const m=members.find(x=>x.id===uid);if(m&&m.active)fresh.push({m,k:k+1,n:o.m.get(now)||0})}}
  return {curve,fresh};
});
function curvaCard(){
  if(!isLeader())return '';
  const C=newCurve(),day=new Date().getDate(),ok=C.curve.filter(x=>x.c>=3),mx=Math.max(1,...ok.map(x=>x.avg));
  const head=`<div class="card-h"><h3>Curva del agente nuevo</h3><span class="p-sub">solo team leader y admin · FTDs por mes desde su primera venta</span></div>`;
  if(!ok.length)return head+rdFew();
  const ref=k=>{const x=C.curve[k-1];return x&&x.c>=3?x.avg:null};
  return head+`<div class="rd-curve">${ok.map(x=>`<div class="rd-cb" title="${x.c} agentes"><i style="height:${Math.round(x.avg/mx*100)}%"></i><b>${nf(x.avg,1)}</b><span>mes ${x.k}</span></div>`).join('')}</div>
    ${C.fresh.length?`<div class="p-tablewrap"><table class="pt"><thead><tr><th>Agente</th><th class="r">Va por su</th><th class="r">Lleva este mes</th><th class="r">Lo normal al cierre</th><th></th></tr></thead><tbody>
    ${C.fresh.map(({m,k,n})=>{const r=ref(k),p=proj(n,day),v=r==null||!p?'':p.mid>=r?sp('ok b','arriba de la curva'):p.hi>=r?sp('warn','en la curva'):sp('hot b','debajo de la curva');
      return `<tr><td><span class="eq-who">${avatar(m.name)}<b>${esc(m.name)}</b></span></td><td class="r">mes ${k}</td><td class="r"><b>${n}</b></td><td class="r">${r==null?'—':nf(r,1)}</td><td>${v}</td></tr>`}).join('')}</tbody></table></div>`
      :'<p class="p-sub" style="margin-top:10px">Ahora no hay agentes en sus primeros 3 meses.</p>'}
    ${ref(1)!=null&&ref(2)!=null&&ref(1)<ref(2)*.75?'<p class="p-sub rd-foot">El primer mes rinde bastante menos que el segundo: es lo normal.</p>':''}`;
}

/* ---------- la sección Radar (en Análisis) ---------- */
V.radar={
  build(){},
  render(){
    $('#rdSub').textContent=rdNote();
    $('#rdBody').innerHTML=`<div class="rd-grid">${mapCard()}${cobroCardRd()}${radarCard()}${lateCard()}</div>`;
  },
};
