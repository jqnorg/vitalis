'use strict';
/* ============================================================
   VITALIS — asistente de ventas para la mesa.
   Datos en Supabase: ventas compartidas en la mesa; sueldo, agenda, turnos y ajustes privados.
   ============================================================ */
const VERSION='1.19.0';
const EXT_VER='__EXT_VER__'; // la extensión que se baja desde Ajustes (la pone build.py)
const $=s=>document.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];

/* ---------- estado ---------- */
const local={
  get(k,d){try{const v=localStorage.getItem('vitalis.'+k);return v==null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{localStorage.setItem('vitalis.'+k,JSON.stringify(v))}catch(e){}}
};
const DEF={base:33500,porftd:20,bonos:[[10,80],[16,150],[21,250],[26,350],[31,450]],tc:0,hora:'09:00',sep:',',tema:'auto',
  fonasa:'nadie',hijos:0,comRecibo:true,bpc:6864,fondoSol:0,tcFecha:'',jornada:450,
  laborables:[1,2,3,4,5],libres:['05-01','08-25'],faltas:[],inicio:'',sinFer:{no:true,lab:true},premios:[],descFalta:0,faltaJust:true};
  // libres: 'MM-DD' todos los años · faltas: [{d:'YYYY-MM-DD',j:true}] · sinFer: feriados que no se cuentan (no laborables / laborables)
  // premios: [{id,ym:'YYYY-MM',c:'concepto',m:monto,cur:'USD'|'UYU'}] · descFalta: UYU por falta (0 = el fijo ÷ 30) · faltaJust: las justificadas también descuentan
let cfg={...DEF};
let ftds=[];    // mis ventas: {_id,uid,n,date,time,id,country,name,aff,camp,amount,tx,reg,brand}
let pend=[];    // {_id,n,id,kw,due:'YYYY-MM-DDTHH:MM',notified,done,doneAt}
let turnos={};  // {'YYYY-MM-DD': {date,in,out,breaks:[{k:10|30,s,e}]}} en ms
let ajustes={}; // {'YYYY-MM': n} FTDs del mes sin detalle
let last=local.get('last',{country:'',aff:'',camp:''});
let ready=false,readOnly=false;

/* ---------- formato y fechas ---------- */
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sp=(cls,t)=>`<span class="${cls}">${esc(t)}</span>`;
const nf=(n,d=0)=>Number(n).toLocaleString('es-UY',{minimumFractionDigits:d,maximumFractionDigits:d});
const money=n=>nf(n,Number.isInteger(+n)?0:2);
const pesos=n=>'$ '+nf(Math.round(n));
const z=n=>String(n).padStart(2,'0');
const ymd=d=>`${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
const todayS=()=>ymd(new Date());
const ymNow=()=>todayS().slice(0,7);
const MES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','setiembre','octubre','noviembre','diciembre'];
const DIA=['dom','lun','mar','mié','jue','vie','sáb'];
const DIAL=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const normC=new Map();
const norm=s=>{s=String(s||'');let r=normC.get(s);if(r===undefined){r=s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');if(normC.size>50000)normC.clear();normC.set(s,r)}return r};
// lo que se calcula muchas veces en un mismo dibujo se guarda hasta el próximo dibujo (pass sube en cada go/refresh/status)
let pass=0;
function perPass(fn){let p=-1,v;return()=>{if(p!==pass){p=pass;v=fn()}return v}}
const dm=s=>{const p=s.split('-');return `${p[2]}/${p[1]}`};
const parseYMD=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const parseDue=s=>{const [a,b]=s.split('T');const d=parseYMD(a);const [h,mi]=(b||'09:00').split(':').map(Number);d.setHours(h,mi,0,0);return d};
const addDays=(s,n)=>{const d=parseYMD(s);d.setDate(d.getDate()+n);return ymd(d)};
const mLabel=ym=>MES[+ym.slice(5,7)-1].slice(0,3)+' '+ym.slice(0,4);
const mLong=ym=>MES[+ym.slice(5,7)-1]+' '+ym.slice(0,4);
const nowHM=()=>{const d=new Date();return `${z(d.getHours())}:${z(d.getMinutes())}`};
const plural=(n,a,b)=>n+' '+(n===1?a:(b||a+'s'));
const pct=v=>nf(v*100,0)+'%';
const WD={dom:0,domingo:0,lun:1,lunes:1,mar:2,martes:2,mie:3,miercoles:3,jue:4,jueves:4,vie:5,viernes:5,sab:6,sabado:6};

function parseDate(tok,dir='future'){ // usado al importar CSV
  if(!tok)return null;
  const t=norm(tok),now=new Date(),base=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const add=n=>{const d=new Date(base);d.setDate(d.getDate()+n);return d};
  if(t==='hoy')return base;if(t==='ayer')return add(-1);if(t==='manana')return add(1);
  if(t in WD){if(dir==='past'){let k=(base.getDay()-WD[t]+7)%7;return add(-(k||7))}let k=(WD[t]-base.getDay()+7)%7;return add(k||7)}
  let m=t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m){const r=new Date(+m[1],m[2]-1,+m[3]);return r.getMonth()===m[2]-1?r:null}
  m=t.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2}|\d{4}))?$/);
  if(m){
    const d=+m[1],mo=+m[2];let y=m[3]?+m[3]:base.getFullYear();if(y<100)y+=2000;
    const r=new Date(y,mo-1,d);if(r.getMonth()!==mo-1||r.getDate()!==d)return null;
    if(!m[3]&&dir==='future'&&r<base)r.setFullYear(y+1);
    if(!m[3]&&dir==='past'&&r>base)r.setFullYear(y-1);
    return r;
  }
  return null;
}
function parseTime(tok){
  const m=norm(tok).match(/^([01]?\d|2[0-3])(?:[:.h]([0-5]\d))?(hs?)?$/);
  return m?`${z(+m[1])}:${m[2]||'00'}`:null;
}
function parseAmount(s){
  s=String(s??'').trim().replace(/us\$|usd|uyu|u\$s|\$|\s/gi,'');
  if(!s||!/^-?[\d.,]+$/.test(s))return NaN;
  const hasC=s.includes(','),hasD=s.includes('.');
  if(hasC&&hasD){s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'')}
  else if(hasC){const p=s.split(',');s=(p.length===2&&p[1].length!==3)?s.replace(',','.'):s.replace(/,/g,'')}
  else if(hasD){const p=s.split('.');if(p.length>2||p[1].length===3)s=s.replace(/\./g,'')}
  const n=Number(s);return isFinite(n)?Math.round(n*100)/100:NaN;
}
function dayLabel(d){
  const t=new Date();t.setHours(0,0,0,0);const x=new Date(d);x.setHours(0,0,0,0);
  const diff=Math.round((x-t)/864e5);
  if(diff===0)return 'hoy';if(diff===1)return 'mañana';if(diff===-1)return 'ayer';
  return `${DIA[d.getDay()]} ${z(d.getDate())}/${z(d.getMonth()+1)}`;
}
const whenTxt=d=>`${dayLabel(d)} ${z(d.getHours())}:${z(d.getMinutes())}`;
function rel(d){
  let ms=d-new Date();const fut=ms>0;ms=Math.abs(ms);const m=Math.round(ms/6e4);let s;
  if(m<1)return 'ahora';
  if(m<60)s=m+' min';
  else if(m<1440){const h=Math.floor(m/60),mm=m%60;s=h+' h'+(mm&&h<5?' '+mm+' min':'')}
  else{const dd=Math.round(m/1440);s=dd+(dd>1?' días':' día')}
  return (fut?'en ':'hace ')+s;
}

/* ---------- base de datos (Supabase) ---------- */
// Ventas: compartidas en la mesa (team). "ftds" = las mías (sueldo, inicio, turnos); "team" = todas.
let sb=null,me=null,profile=null,teamInfo=null,members=[],team=[],chan=null,dl=null,snippets=[],leads=[],pings=[];
let chats=[],chatMem=[],msgs={},reads={};
let avatars={},avOk=false; // fotos de perfil: uid → {url, at}
let tasks=[],taskPeople=[]; // tareas que veo y quién ya las hizo // chat: chats que veo, integrantes de grupos/privados, mensajes por chat, hasta dónde leí
const isAdmin=()=>profile&&profile.role==='admin',isLeader=()=>profile&&(profile.role==='leader'||profile.role==='admin');
const canEdit=f=>f&&(f.uid===me||isLeader());
const memberName=uid=>{const m=members.find(x=>x.id===uid);return m?m.name:'—'};
const S2F=r=>({_id:r.id,uid:r.user_id,n:r.n,date:r.date,time:r.time||'',id:r.client_id,country:r.country||'',name:r.name||'',aff:r.aff||'',camp:r.camp??'',
  amount:+r.amount,tx:r.tx||undefined,reg:r.reg||r.date,brand:r.brand||''});
const F2S=f=>({n:f.n??null,date:f.date,time:f.time||null,client_id:String(f.id),country:f.country||null,name:f.name||null,aff:f.aff||null,camp:f.camp??null,
  amount:+f.amount,tx:f.tx||null,reg:f.reg||null,brand:f.brand||DEF_BRAND,...(f.uid?{user_id:f.uid}:{})}); // el team leader carga a nombre de otro
const A2P=r=>({_id:r.id,n:r.n,id:r.client_id,kw:r.kw||'',due:r.due,notified:!!r.notified,done:!!r.done,doneAt:r.done_at||null});
const P2A=p=>({n:p.n??null,client_id:String(p.id),kw:p.kw||'',due:p.due,notified:!!p.notified,done:!!p.done,done_at:p.doneAt||null});
const N2S=r=>({_id:r.id,uid:r.user_id,shortcut:r.shortcut,title:r.title||'',body:r.body||'',shared:!!r.shared,global:!!r.global,updated:r.updated_at});
const L2C=r=>({_id:r.id,uid:r.user_id,id:r.client_id,name:r.name||'',country:r.country||'',date:r.date,source:r.source});
const G2P=r=>({_id:r.id,from:r.from_id,to:r.to_id||null,kind:r.kind,body:r.body||'',reply:r.reply||null,by:r.reply_by||null,at:r.created_at,rat:r.replied_at||null});
const M2X=r=>({_id:r.id,chat:r.chat_id,uid:r.user_id,body:r.body||'',reply:r.reply_to||null,at:r.created_at,t:+new Date(r.created_at)});
const quiet=(m=profile)=>!!(m&&m.quiet_until&&new Date(m.quiet_until)>new Date()); // avisos sociales silenciados
function mine(){ftds=team.filter(f=>f.uid===me)}
function errMsg(e){
  const m=String(e&&(e.message||e.error_description||e.msg)||e||'');
  const k=m.match(/^[A-Z_]+:\s*(.+)$/);if(k)return k[1];
  if(e&&e.code==='23505')return 'ya existe (misma transacción en la misma marca)';
  if(/pings_kind_check/.test(m))return 'los toques se activan en un rato';
  if(/task_create|relation "public.tasks"/.test(m))return 'las tareas se activan en un rato';
  if(e&&e.code==='42501'||/row-level security|permission denied/i.test(m))return 'no tenés permiso para eso';
  if(/Failed to fetch|NetworkError|fetch failed/i.test(m))return 'sin conexión';
  if(/JWT|session|refresh token/i.test(m))return 'tu sesión venció: volvé a entrar';
  return m||'error desconocido';
}
function dbErr(e){toast('No se pudo guardar: '+esc(errMsg(e)),'err');refresh()}
async function Q(p){const r=await p;if(r.error)throw r.error;return r.data}
async function QO(p){try{return await Q(p)}catch(e){return []}} // opcional: si la tabla todavía no está en la base, sigo sin eso
async function QN(p){try{return await Q(p)}catch(e){return null}} // opcional, pero distingo "no está" (null) de "vacío"

/* ---------- lo último que cargué, guardado en esta computadora (IndexedDB) ----------
   Al abrir Vitalis con la sesión abierta se dibuja al instante con eso y en paralelo se pide lo nuevo.
   Uno por persona; se borra al salir. */
const SNAP_V=2;
const snapDb=(()=>{let p=null;return()=>p||(p=new Promise((ok,no)=>{try{const r=indexedDB.open('vitalis',1);r.onupgradeneeded=()=>r.result.createObjectStore('snap');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)}catch(e){no(e)}}))})();
async function snapOp(mode,fn){try{const db=await snapDb();return await new Promise((ok,no)=>{const t=db.transaction('snap',mode),q=fn(t.objectStore('snap'));t.oncomplete=()=>ok(q&&q.result);t.onerror=t.onabort=()=>no(t.error)})}catch(e){return null}}
const snapGet=k=>snapOp('readonly',s=>s.get(k));
const snapPut=(k,v)=>snapOp('readwrite',s=>s.put(v,k));
const snapClear=()=>snapOp('readwrite',s=>s.clear());
function snapCrm(rows,rot){if(me)snapPut('crm:'+me,{v:SNAP_V,at:Date.now(),rows,rot})}
async function W(fn){try{await fn();return true}catch(e){dbErr(e);return false}}
// todas las filas, de a 1000: las páginas que espero las pido juntas (no una detrás de otra); orden estable con el id
async function fetchAll(table,cols='*',order='created_at',guess=0){
  const page=i=>Q(sb.from(table).select(cols).order(order,{ascending:true}).order('id',{ascending:true}).range(i*1000,i*1000+999));
  const n=Math.max(1,Math.ceil((guess+200)/1000));
  const pages=await Promise.all(Array.from({length:n},(_,i)=>page(i)));
  for(let i=n;pages[pages.length-1].length===1000;i++)pages.push(await page(i));
  return pages.flat();
}
const B={ // todas las escrituras pasan por acá
  async addFtd(r){
    try{const row=await Q(sb.from('sales').insert(F2S(r)).select().single());const f=S2F(row);team=team.filter(x=>x._id!==f._id);team.push(f);mine();Object.assign(r,f);refresh();return true}
    catch(e){dbErr(e);return false}
  },
  async updFtd(f,fields){
    const nf_={...f,...fields};for(const k of Object.keys(nf_))if(nf_[k]===undefined)delete nf_[k];
    try{const row=await Q(sb.from('sales').update(F2S(nf_)).eq('id',f._id).select().single());const g=S2F(row);
      const i=team.findIndex(x=>x._id===f._id);if(i>=0)team[i]=g;for(const k of Object.keys(f))delete f[k];Object.assign(f,g);mine();refresh();return true}
    catch(e){dbErr(e);return false}
  },
  async delFtd(f){
    try{await Q(sb.from('sales').delete().eq('id',f._id));team=team.filter(x=>x._id!==f._id);mine();refresh();return true}
    catch(e){dbErr(e);return false}
  },
  async addMany(list,onProg){ // de a 100; si alguna ya existía, sigue con las demás
    let done=0,dup=0;
    for(let i=0;i<list.length;i+=100){
      const chunk=list.slice(i,i+100);
      let rows=null;
      try{rows=await Q(sb.from('sales').insert(chunk.map(F2S)).select())}
      catch(e){
        if(e.code!=='23505'){dbErr(e);return false}
        rows=[];for(const r of chunk){try{rows.push(await Q(sb.from('sales').insert(F2S(r)).select().single()))}catch(e2){if(e2.code==='23505'){dup++;continue}dbErr(e2);return false}}
      }
      for(const row of rows){const f=S2F(row);team=team.filter(x=>x._id!==f._id);team.push(f)}
      done+=chunk.length;onProg&&onProg(done,list.length);
    }
    mine();refresh();return dup?{dup}:true;
  },
  async addPend(p){
    try{const row=await Q(sb.from('agenda').insert(P2A(p)).select().single());Object.assign(p,A2P(row));pend=pend.filter(x=>x._id!==p._id);pend.push(p);refresh();return true}
    catch(e){dbErr(e);return false}
  },
  async updPend(p,fields){
    Object.assign(p,fields);
    try{await Q(sb.from('agenda').update(P2A(p)).eq('id',p._id));refresh();return true}catch(e){dbErr(e);return false}
  },
  async delPend(p){
    pend=pend.filter(x=>x!==p);
    try{await Q(sb.from('agenda').delete().eq('id',p._id));refresh();return true}catch(e){dbErr(e);return false}
  },
  async setAjuste(ym,n){
    const prev=ajustes[ym];if(n)ajustes[ym]=n;else delete ajustes[ym];
    try{if(n)await Q(sb.from('adjustments').upsert({user_id:me,ym,n}));else await Q(sb.from('adjustments').delete().eq('user_id',me).eq('ym',ym));refresh();return true}
    catch(e){if(prev)ajustes[ym]=prev;else delete ajustes[ym];dbErr(e);return false}
  },
  async saveTurno(t){
    turnos[t.date]=t;
    try{await Q(sb.from('shifts').upsert({user_id:me,date:t.date,data:JSON.parse(JSON.stringify(t))}));refresh();return true}catch(e){dbErr(e);return false}
  },
  async delTurno(date){
    delete turnos[date];
    try{await Q(sb.from('shifts').delete().eq('user_id',me).eq('date',date));refresh();return true}catch(e){dbErr(e);return false}
  },
  async saveCfg(){
    try{await Q(sb.from('settings').upsert({user_id:me,cfg:JSON.parse(JSON.stringify(cfg))}));refresh();return true}catch(e){dbErr(e);return false}
  },
  async saveSnip(sn,fields){ // nuevo (sin _id) o edición
    const row={shortcut:fields.shortcut,title:fields.title||null,body:fields.body,shared:!!fields.shared||!!fields.global};
    if(fields.global||(sn&&sn.global))row.global=!!fields.global; // solo si hace falta (así anda aunque la base no tenga la columna)
    try{
      const r=sn&&sn._id?await Q(sb.from('snippets').update(row).eq('id',sn._id).select().single()):await Q(sb.from('snippets').insert(row).select().single());
      const s=N2S(r);snippets=snippets.filter(x=>x._id!==s._id);snippets.push(s);refresh();return s;
    }catch(e){if(e.code==='23505'){toast(`Ya tenés un snippet /${esc(fields.shortcut)}.`,'err');return false}dbErr(e);return false}
  },
  async delSnip(sn){
    try{await Q(sb.from('snippets').delete().eq('id',sn._id));snippets=snippets.filter(x=>x._id!==sn._id);refresh();return true}catch(e){dbErr(e);return false}
  },
  async addLeads(rows,source='crm'){ // clientes new; los que ya estaban en la mesa se ignoran
    const te=todayS(),body=rows.map(r=>({client_id:String(r.id).slice(0,60),name:r.name?String(r.name).slice(0,120):null,country:r.country?String(r.country).slice(0,60):null,date:r.date||te,source}));
    try{const out=await Q(sb.from('leads').upsert(body,{onConflict:'team_id,client_id',ignoreDuplicates:true}).select());
      for(const r of out){const l=L2C(r);leads=leads.filter(x=>x._id!==l._id);leads.push(l)}refresh();return out.length}
    catch(e){dbErr(e);return false}
  },
  async ping(kind,to,body){ // social: pedir un mate, salir a los 10 / a la media, mensaje
    try{const row=await Q(sb.from('pings').insert({kind,to_id:to||null,body:body||null}).select().single());const g=G2P(row);pings=pings.filter(x=>x._id!==g._id);pings.unshift(g);refresh();return g}
    catch(e){toast(esc(errMsg(e)),String(e.message||'').startsWith('COOLDOWN')?'warn':'err');return null}
  },
  async replyPing(id,r){
    try{const res=await Q(sb.rpc('reply_ping',{pid:id,r}));const p=pings.find(x=>x._id===id);
      if(res&&res.ok){if(p){p.reply=r;p.by=me;p.rat=new Date().toISOString()}refresh();return true}
      if(res&&res.taken){if(p){p.reply=res.reply;p.by=res.by}toast(`Ya contestó ${esc(memberName(res.by).split(/\s+/)[0])}.`,'warn');refresh()}return false}
    catch(e){toast(esc(errMsg(e)),'err');return false}
  },
  async delPing(id){try{await Q(sb.from('pings').delete().eq('id',id));pings=pings.filter(x=>x._id!==id);refresh();return true}catch(e){dbErr(e);return false}},
  async setQuiet(until){
    try{const row=await Q(sb.from('profiles').update({quiet_until:until}).eq('id',me).select().single());profile=row;const i=members.findIndex(x=>x.id===me);if(i>=0)members[i]=row;refresh();return true}catch(e){dbErr(e);return false}
  },
  async delLead(l){
    try{await Q(sb.from('leads').delete().eq('id',l._id));leads=leads.filter(x=>x._id!==l._id);refresh();return true}catch(e){dbErr(e);return false}
  },
  async saveName(name){
    try{await Q(sb.from('profiles').update({name}).eq('id',me));profile.name=name;const m=members.find(x=>x.id===me);if(m)m.name=name;refresh();return true}catch(e){dbErr(e);return false}
  },
  async setMember(id,fields){
    try{const row=await Q(sb.from('profiles').update(fields).eq('id',id).select().single());const i=members.findIndex(x=>x.id===id);if(i>=0)members[i]=row;refresh();return true}catch(e){dbErr(e);return false}
  },
  async rpc(fn,args){ // funciones de la base (PIN, gente de la mesa)
    try{return await Q(sb.rpc(fn,args))}catch(e){toast(esc(errMsg(e)),'err');return null}
  },
};
// el arranque: todo en paralelo (las reglas de la base ya filtran por mesa), y se guarda para la próxima vez
async function bootFetch(hint={}){
  const lead=!!hint.lead,ago=ms=>new Date(Date.now()-ms).toISOString();
  const [prof,tm,mem,sales,ag,adj,sh,st,sn,ld,pg,ch,cm,rd,ms,tk,tp,mesa,av,rx,bkx,fic,cl]=await Promise.all([
    Q(sb.from('profiles').select('*').eq('id',me)),
    Q(sb.from('teams').select('*').limit(1)),
    Q(sb.from('profiles').select('*').order('name')),
    fetchAll('sales','*','date',hint.nSales||0),
    Q(sb.from('agenda').select('*').eq('user_id',me)),
    Q(sb.from('adjustments').select('*').eq('user_id',me)),
    Q(sb.from('shifts').select('*').eq('user_id',me)),
    Q(sb.from('settings').select('*').eq('user_id',me)),
    Q(sb.from('snippets').select('*').order('shortcut')),
    fetchAll('leads','*','date',hint.nLeads||0),
    Q(sb.from('pings').select('*').gte('created_at',ago(36e5*24)).order('created_at',{ascending:false}).limit(300)),
    QO(sb.from('chats').select('*')),
    QO(sb.from('chat_members').select('*')),
    QO(sb.from('chat_reads').select('*').eq('user_id',me)),
    QO(sb.from('messages').select('*').gte('created_at',ago(7*864e5)).order('created_at',{ascending:false}).limit(1500)),
    QO(sb.from('tasks').select('*').gte('created_at',ago(60*864e5)).order('created_at',{ascending:false}).limit(300)),
    QO(sb.from('task_people').select('*').limit(5000)),
    mesaFetch(lead).catch(()=>null),
    avFetch(),
    reactFetch(),
    bkFetch().catch(()=>null),
    ficFetch(),
    callsFetch(),
  ]);
  const raw={prof:prof[0]||null,tm:tm[0]||null,mem,sales,ag,adj,sh,st,sn,ld,pg,ch,cm,rd,ms,tk,tp,mesa,av,rx,bkx,fic,cl};
  if(raw.prof&&['admin','leader'].includes(raw.prof.role)!==lead)raw.mesa=await mesaFetch(!lead).catch(()=>null); // adiviné mal el rol
  return raw;
}
function bootApply(R,quiet){
  if(!R.prof)throw new Error('NO_PROFILE');
  profile=R.prof;
  if(!profile.active)throw new Error('INACTIVE');
  teamInfo=R.tm;members=R.mem.filter(m=>m.team_id===profile.team_id);
  chatsLoaded(R.ch,R.cm,R.rd,R.ms);tasksLoaded(R.tk,R.tp);
  snippets=R.sn.map(N2S);leads=R.ld.map(L2C);pings=R.pg.map(G2P);
  team=R.sales.map(S2F);mine();
  pend=R.ag.map(A2P);
  ajustes=Object.fromEntries(R.adj.map(r=>[r.ym,+r.n||0]));
  turnos=Object.fromEntries(R.sh.map(r=>{const t={...r.data};t.date=t.date||r.date;t.breaks=t.breaks||[];return [r.date,t]}));
  cfg={...DEF,...((R.st[0]&&R.st[0].cfg)||{})};
  if(R.mesa)mesaApply(R.mesa);else mesaOk=false;
  avApply(R.av);reactApply(R.rx);bkApply(R.bkx,quiet);ficOk=R.fic;callsApply(R.cl);
}
async function loadAll(first){
  const snap=me?await snapGet('boot:'+me):null,h=snap&&snap.raw?{lead:snap.raw.prof&&['admin','leader'].includes(snap.raw.prof.role),nSales:snap.raw.sales.length,nLeads:snap.raw.ld.length}:{lead:!!(authPerson&&['admin','leader'].includes(authPerson.role))};
  const R=await bootFetch(h);
  bootApply(R,!!first);
  if(!(profile.login&&!profile.pin_set))snapPut('boot:'+me,{v:SNAP_V,at:Date.now(),ver:VERSION,raw:R});
}
// tiempo real: si el canal se cae, me pongo al día enseguida y sondeo cada 5 s hasta que vuelva
let rtOk=false,rtGen=0,rtWd=null,rtEver=false,lastCatch=0,catching=null;
async function catchUp(force){
  if(!ready||!sb)return;
  if(catching)return catching;
  if(!force&&Date.now()-lastCatch<4e3)return;
  lastCatch=Date.now();
  catching=Promise.all([socialPoll(),chatPoll(),taskPoll(),snipPoll(),mesaPoll(),avPoll(),crmLoad(),bkLoad(),campReqPoll(),callsFetch().then(x=>{if(x){const n=calls.length;callsApply(x);if(calls.length!==n)refresh()}})]).catch(()=>{}).finally(()=>{catching=null});
  return catching;
}
// con el tiempo real andando todo llega solo: ponerse al día es solo una red de seguridad (cada 5 min, o al volver después de un rato).
// Sin tiempo real: cada 5 s con la pestaña a la vista, cada minuto escondida. Los clientes del CRM no van en tiempo real: cada 45 s a la vista.
let hidAt=0;
const needCatch=()=>!rtOk?Date.now()-lastCatch>(document.hidden?60e3:5e3):Date.now()-lastCatch>5*6e4;
setInterval(()=>{if(!ready)return;if(needCatch())catchUp();else if(!document.hidden&&Date.now()-crm.at>45e3)crmLoad()},5e3);
addEventListener('online',()=>catchUp(true));
addEventListener('focus',()=>{if(ready&&needCatch())catchUp()});
document.addEventListener('visibilitychange',()=>{if(document.hidden){hidAt=Date.now();return}if(ready&&(!rtOk||Date.now()-hidAt>2*6e4||needCatch()))catchUp(true);else if(ready&&Date.now()-crm.at>45e3)crmLoad()});
function live(){ // cambios en vivo: lo que carguen los compañeros o yo desde otro dispositivo
  if(chan)sb.removeChannel(chan);
  const gen=++rtGen;rtOk=false;
  const up=(arr,item,key='_id')=>{const i=arr.findIndex(x=>x[key]===item[key]);if(i>=0)arr[i]=item;else arr.push(item)};
  chan=sb.channel('vitalis-'+me)
    .on('postgres_changes',{event:'*',schema:'public',table:'sales'},p=>{
      if(p.eventType==='DELETE'){team=team.filter(x=>x._id!==(p.old&&p.old.id))}
      else{if(p.new.team_id!==profile.team_id)return;up(team,S2F(p.new))}
      mine();refresh();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'agenda',filter:'user_id=eq.'+me},p=>{
      if(p.eventType==='DELETE')pend=pend.filter(x=>x._id!==(p.old&&p.old.id));else up(pend,A2P(p.new));refresh();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'adjustments',filter:'user_id=eq.'+me},p=>{
      if(p.eventType==='DELETE'){if(p.old&&p.old.ym)delete ajustes[p.old.ym]}else ajustes[p.new.ym]=+p.new.n||0;refresh();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'shifts',filter:'user_id=eq.'+me},p=>{
      if(p.eventType==='DELETE'){if(p.old&&p.old.date)delete turnos[p.old.date]}else{const t={...p.new.data};t.date=t.date||p.new.date;t.breaks=t.breaks||[];turnos[p.new.date]=t}refresh();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'settings',filter:'user_id=eq.'+me},p=>{
      if(p.new&&p.new.cfg){cfg={...DEF,...p.new.cfg};applyTheme();refresh()}
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'leads'},p=>{
      if(p.eventType==='DELETE')leads=leads.filter(x=>x._id!==(p.old&&p.old.id));else if(p.new.team_id===profile.team_id)up(leads,L2C(p.new));refresh();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'snippets'},p=>{
      if(p.eventType==='DELETE')snippets=snippets.filter(x=>x._id!==(p.old&&p.old.id));
      else if(p.new.user_id===me||((p.new.shared||p.new.global)&&p.new.team_id===profile.team_id))up(snippets,N2S(p.new));
      else snippets=snippets.filter(x=>x._id!==p.new.id); // dejó de estar compartido
      refresh();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'pings'},p=>{
      if(p.eventType==='DELETE'){const id=p.old&&p.old.id;pings=pings.filter(x=>x._id!==id);socialGone(id);refresh();return}
      if(p.new.team_id!==profile.team_id)return;
      const g=G2P(p.new),old=pings.find(x=>x._id===g._id),prev=old?{...old}:null;
      if(old)Object.assign(old,g);else pings.unshift(g);
      socialEvent(old||g,p.eventType,prev);refresh();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'profiles'},p=>{
      if(p.eventType==='DELETE')return;
      if(p.new.team_id!==profile.team_id&&p.new.id!==me)return;
      up(members,p.new,'id');
      if(p.new.id===me){profile=p.new;if(!p.new.active)return location.reload()}
      refresh();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'messages'},p=>{
      if(p.eventType==='DELETE'){msgGone(p.old&&p.old.id);return}
      if(p.eventType==='INSERT')msgIn(M2X(p.new),true);
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'chats'},p=>{
      if(p.eventType==='DELETE'){chatGone(p.old&&p.old.id);return}
      if(p.new.team_id!==profile.team_id)return;
      up(chats,p.new,'id');refresh();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'chat_members'},p=>{
      if(p.eventType==='DELETE'){const o=p.old||{};chatMem=chatMem.filter(x=>!(x.chat_id===o.chat_id&&x.user_id===o.user_id));if(o.user_id===me)chatGone(o.chat_id);else refresh();return}
      const r=p.new;if(!chatMem.some(x=>x.chat_id===r.chat_id&&x.user_id===r.user_id))chatMem.push(r);
      if(r.user_id===me||!chats.some(c=>c.id===r.chat_id))catchUp(true);else refresh(); // me sumaron a un grupo: lo traigo
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'tasks'},p=>{
      if(p.eventType==='DELETE'){taskGone(p.old&&p.old.id);return}
      if(p.new.team_id!==profile.team_id)return;
      const t=T2X(p.new),ex=taskOf(t._id);if(ex)Object.assign(ex,t);else tasks.unshift(t);refresh();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'task_people'},p=>{taskRow(p.eventType,p.new,p.old||{})});
  if(mesaOk)chan.on('postgres_changes',{event:'*',schema:'public',table:'targets'},p=>mesaLive('targets',p));
  if(utOk)chan.on('postgres_changes',{event:'*',schema:'public',table:'user_targets'},p=>mesaLive('user_targets',p));
  if(avOk)chan.on('postgres_changes',{event:'*',schema:'public',table:'avatars'},avLive);
  if(callsOk)chan.on('postgres_changes',{event:'INSERT',schema:'public',table:'calls'},callLive); // las llamadas de la mesa, en vivo
  chan.on('postgres_changes',{event:'UPDATE',schema:'public',table:'teams'},p=>{if(p.new&&teamInfo&&p.new.id===teamInfo.id){teamInfo={...teamInfo,...p.new};refresh()}}); // tope de la cola, mínimo de llamadas
  if(ficOk){for(const t of ['client_comments','campaign_info'])chan.on('postgres_changes',{event:'*',schema:'public',table:t},fichaLive);if(bkEd())chan.on('postgres_changes',{event:'INSERT',schema:'public',table:'campaign_requests'},()=>campReqPoll())} // la ficha: comentarios y campañas en vivo
  if(bk.ok)for(const t of ['pay_incidents','processors','processor_methods','banks','pay_methods'])chan.on('postgres_changes',{event:'*',schema:'public',table:t},()=>bkLoad(true)); // Banking: una falla avisa al instante
  if(reactOk)chan.on('postgres_changes',{event:'*',schema:'public',table:'message_reactions'},reactLive); // si la base todavía no tiene la tabla, no la pido (se caería el canal)
  // el team leader ve en vivo la agenda, los turnos y los FTDs sin detalle de todos
  if(isLeader())for(const t of ['agenda','shifts','adjustments'])chan.on('postgres_changes',{event:'*',schema:'public',table:t},p=>mesaLive(t,p));
  chan.subscribe(st=>{
      if(gen!==rtGen)return;
      if(st==='SUBSCRIBED'){clearTimeout(rtWd);const again=rtEver;rtOk=true;rtEver=true;if(again)catchUp(true);return}
      rtOk=false;catchUp(true); // CHANNEL_ERROR, TIMED_OUT, CLOSED: me pongo al día y, si no vuelve solo, me vuelvo a suscribir
      clearTimeout(rtWd);rtWd=setTimeout(()=>{if(gen===rtGen&&!rtOk)live()},12e3);
    });
}
// cached: ya se dibujó con lo guardado; acá llega lo nuevo y se vuelve a dibujar
async function connect(cached){
  if(cached)live(); // el tiempo real arranca ya: lo que cambie mientras cargo, llega
  for(let i=0;;i++){
    try{await loadAll(true);break}
    catch(e){
      const m=String(e&&e.message||e);
      if(m==='INACTIVE'||m==='NO_PROFILE'){snapClear();if(cached){ready=false;document.body.classList.add('auth')}return authScreen(m==='INACTIVE'?'inactive':'noprofile')}
      if(!cached)return authScreen('error',errMsg(e));
      if(i===0)toast('Sin conexión: ves lo último que cargó esta computadora. Sigo intentando.','warn',{key:'boot',sticky:true});
      await new Promise(r=>setTimeout(r,Math.min(30e3,3e3*(i+1)))); // con lo guardado a la vista, reintento solo
    }
  }
  closeToast('boot');
  if(profile.login&&!profile.pin_set)return authScreen('newpin'); // primera vez: crear el PIN
  if(cached){applyTheme();$('#navEquipo').hidden=!isLeader();refresh();crmLoad(true);return}
  enter();
}
// arranque instantáneo: con lo guardado de esta persona, antes de que conteste la base
async function bootCached(uid){
  const [s,c]=await Promise.all([snapGet('boot:'+uid),snapGet('crm:'+uid)]);
  if(!s||s.v!==SNAP_V||!s.raw||Date.now()-s.at>14*864e5)return false;
  try{me=uid;bootApply(s.raw,true);if(c&&c.v===SNAP_V&&c.rows)crmApply(c.rows,c.rot);crm.at=0}
  catch(e){return false}
  if(profile.login&&!profile.pin_set)return false;
  enter(true);return true;
}
function enter(cached){
  if(!cached)live();
  // al volver a la pestaña después de un rato, recargo por si se perdió algún cambio en vivo
  let hiddenAt=0;
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hiddenAt=Date.now();else if(hiddenAt&&Date.now()-hiddenAt>10*6e4)loadAll().then(()=>refresh()).catch(()=>{})});
  onReady();
}

/* ---------- conversión: FTDs / clientes new ---------- */
function weekStart(d){const x=parseYMD(d);return addDays(d,-((x.getDay()+6)%7))}
function convPeriod(from,to,uid){ // uid: me | null (toda la mesa) | otro
  if(typeof cohortCovers==='function'&&cohortCovers(from,to)){ // con el registro del CRM: los registrados del período, del primero que los llamó
    const c=cohort(from,to,uid);return {leads:c.n,ftd:c.nw,rate:c.rate,conv:c.nw+c.lt,convRate:c.n?(c.nw+c.lt)/c.n:null};
  }
  const inR=x=>x.date>=from&&x.date<=to,own=x=>uid==null||x.uid===uid,ownL=x=>uid==null||(typeof leadOwner==='function'?leadOwner(x):x.uid)===uid;
  const L=leads.filter(x=>inR(x)&&ownL(x)),F=team.filter(x=>inR(x)&&own(x));
  const sold=new Set(team.filter(own).map(f=>norm(f.id)));
  const conv=L.filter(l=>sold.has(norm(l.id))).length; // de los clientes del período, cuántos ya depositaron
  return {leads:L.length,ftd:F.length,rate:L.length?F.length/L.length:null,conv,convRate:L.length?conv/L.length:null};
}

/* ---------- snippets ---------- */
async function snipPoll(){if(!ready||!sb)return;try{const r=await Q(sb.from('snippets').select('*'));const n=r.map(N2S),sig=a=>a.map(s=>s._id+s.updated).sort().join();if(sig(n)!==sig(snippets)){snippets=n;refresh()}}catch(e){}}
function activeSnips(){
  const own=snippets.filter(s=>s.uid===me),mine_=new Set(own.map(s=>s.shortcut));
  // el tuyo gana; después el global de la mesa; después el compartido más nuevo de un compañero
  const others=snippets.filter(s=>s.uid!==me&&(s.shared||s.global)&&!mine_.has(s.shortcut)).sort((a,b)=>(b.global-a.global)||((a.updated||'')<(b.updated||'')?1:-1));
  const seen=new Set(),out=[...own];for(const s of others)if(!seen.has(s.shortcut)){seen.add(s.shortcut);out.push(s)}
  return out.sort((a,b)=>a.shortcut.localeCompare(b.shortcut));
}
function fillSnip(body){ // variables: {fecha} {hora} {yo} {cursor}
  const d=new Date();
  return body.replace(/\{fecha\}/g,`${z(d.getDate())}/${z(d.getMonth()+1)}/${d.getFullYear()}`).replace(/\{hora\}/g,`${z(d.getHours())}:${z(d.getMinutes())}`)
    .replace(/\{yo\}/g,profile?profile.name:'').replace(/\{cursor\}/g,'');
}

/* ---------- sueldo ---------- */
const tiers=()=>[...cfg.bonos].map(x=>[...x]).sort((a,b)=>a[0]-b[0]);
function porCantidad(n){ // bono no acumulable: vale el escalón más alto alcanzado
  let bono=0,tier=0;for(const [t,b] of tiers())if(n>=t){bono=b;tier=t}
  const next=tiers().find(([t])=>n<t)||null;
  return {n,bono,tier,next,porftd:n*cfg.porftd,usd:n*cfg.porftd+bono};
}
function calc(ym){
  const list=ftds.filter(f=>f.date.slice(0,7)===ym),loaded=list.length,extra=ajustes[ym]||0;
  return {ym,list,loaded,extra,...porCantidad(loaded+extra),monto:list.reduce((a,f)=>a+(+f.amount||0),0)};
}
/* líquido: estimación de la retención mensual, trabajador dependiente, valores BPS 2026 */
const IRPF_ESCALA=[[7,0],[10,.10],[15,.15],[30,.24],[50,.25],[75,.27],[115,.31],[Infinity,.36]];
const FONASA_TASA={nadie:.045,hijos:.06,conyuge:.065,ambos:.08};
function liquido(N){
  const bpc=cfg.bpc||DEF.bpc,fam=FONASA_TASA[cfg.fonasa]?cfg.fonasa:'nadie';
  const rF=N<=2.5*bpc?((fam==='conyuge'||fam==='ambos')?.05:.03):FONASA_TASA[fam];
  const jub=N*.15,fon=N*rF,frl=N*.001,aportes=jub+fon+frl;
  const base=N>10*bpc?N*1.06:N;
  let bruto=0,prev=0;
  for(const [lim,t] of IRPF_ESCALA){const top=lim*bpc;if(base>prev)bruto+=(Math.min(base,top)-prev)*t;prev=top;if(base<=top)break}
  const ded=aportes+(+cfg.hijos||0)*20/12*bpc+(+cfg.fondoSol||0);
  const tasaDed=base<=15*bpc?.14:.08;
  const irpf=Math.max(0,bruto-ded*tasaDed);
  return {N,rF,jub,fon,frl,aportes,base,bruto,ded,tasaDed,irpf,neto:N-aportes-irpf};
}
// premios y faltas del mes: los premios van como las comisiones (en el recibo o aparte); cada falta descuenta del fijo
function extrasMes(ym){
  const pr=(cfg.premios||[]).filter(p=>p.ym===ym);
  const usd=pr.filter(p=>p.cur!=='UYU').reduce((a,p)=>a+(+p.m||0),0),uyu=pr.filter(p=>p.cur==='UYU').reduce((a,p)=>a+(+p.m||0),0);
  const fl=(cfg.faltas||[]).filter(x=>x.d.slice(0,7)===ym),cuentan=fl.filter(x=>cfg.faltaJust!==false||!x.j);
  const porFalta=+cfg.descFalta>0?+cfg.descFalta:Math.round((+cfg.base||0)/30);
  return {pr,usd,uyu,fl,nDesc:cuentan.length,porFalta,desc:Math.min(+cfg.base||0,cuentan.length*porFalta)};
}
function sueldoPesos(s){ // null si falta el dólar y hay dólares que van en el recibo
  const tc=+cfg.tc||0,ex=extrasMes(s.ym||ymNow()),fijo=Math.max(0,(+cfg.base||0)-ex.desc);
  if(cfg.comRecibo){const usd=s.usd+ex.usd;if(usd>0&&!(tc>0))return null;const L=liquido(fijo+usd*tc+ex.uyu);return {...L,tc,ex,fijo,usdAparte:0,uyuAparte:0,total:L.neto}}
  const L=liquido(fijo),usdA=s.usd+ex.usd;
  return {...L,tc,ex,fijo,usdAparte:usdA,uyuAparte:ex.uyu,total:usdA>0?(tc>0?L.neto+usdA*tc+ex.uyu:null):L.neto+ex.uyu};
}
function faltaErr(d){ // por qué no se puede cargar una falta ese día (o null)
  if(!d)return 'Elegí la fecha de la falta.';
  if(d>todayS())return 'Esa fecha todavía no llegó.';
  if((cfg.faltas||[]).some(x=>x.d===d))return 'Esa falta ya está cargada.';
  const r=noTrabajo(d);if(r==='finde')return 'Ese día no es laborable.';if(r==='feriado'||r==='libre')return 'Ese día ya no se cuenta.';
  const n=ftds.filter(f=>f.date===d).length;if(n)return `Ese día tenés ${plural(n,'venta')}.`;
  return null;
}
const parseNum=v=>{v=String(v||'').trim().replace(/\s|\$|usd|uyu/gi,'');if(v.includes(','))v=v.replace(/\./g,'').replace(',','.');else if(/^\d{1,3}(\.\d{3})+$/.test(v))v=v.replace(/\./g,'');const n=Number(v);return isFinite(n)?n:NaN};
const tcTxt=()=>cfg.tc>0?`BROU compra ${nf(cfg.tc,2)}${cfg.tcFecha?' del '+dm(cfg.tcFecha):''}`:'sin cargar';
const tcViejo=()=>cfg.tc>0&&cfg.tcFecha&&(parseYMD(todayS())-parseYMD(cfg.tcFecha))/864e5>=3;
const progressTxt=s=>s.next?`faltan ${s.next[0]-s.n} para ${s.next[1]} USD`:(s.n?'bono máximo 🔥':'');

/* ---------- ventas ---------- */
const DEF_BRAND='Novara Markets';
const isLate=f=>!!(f.reg&&String(f.reg).slice(0,10)<f.date);
const lateDays=f=>isLate(f)?Math.round((parseYMD(f.date)-parseYMD(String(f.reg).slice(0,10)))/864e5):0;
const byDate=(a,b)=>a.date<b.date?-1:a.date>b.date?1:(a.time||'')<(b.time||'')?-1:(a.time||'')>(b.time||'')?1:(a.n||0)-(b.n||0);
const nextN=()=>ftds.reduce((a,f)=>Math.max(a,f.n||0),0)+1;
const nextNFor=uid=>team.reduce((a,f)=>f.uid===uid?Math.max(a,f.n||0):a,0)+1; // numeración de cada vendedor
const nn=s=>norm(s).replace(/[^a-z0-9]+/g,' ').trim();
const agentC={p:-1,m:new Map()};
function agentUid(txt){if(agentC.p!==pass){agentC.p=pass;agentC.m.clear()}const k=String(txt||'');if(agentC.m.has(k))return agentC.m.get(k);const r=agentUid0(k);agentC.m.set(k,r);return r}
function agentUid0(txt){ // nombre del agente en el CRM → persona de la mesa (primero los que están; después los desvinculados)
  const t=nn(txt);if(!t)return null;
  const pick=L=>{
    const m=L.find(x=>x.crm_name&&nn(x.crm_name)===t)||L.find(x=>nn(x.name)===t);if(m)return m.id;
    const F=L.filter(x=>!x.crm_name),one=l=>l.length===1?l[0].id:null; // al que ya tiene su nombre del CRM no se lo adivina
    // "Joaquín Or" en la lista y "Joaquin Ortega" en el CRM (o al revés)
    let r=one(F.filter(x=>{const n=nn(x.name);return t.startsWith(n)||n.startsWith(t)}));if(r)return r;
    // mismo nombre e inicial del apellido (o solo el nombre, si el CRM muestra solo el nombre y no se repite)
    const [f,l]=t.split(' ');
    return one(F.filter(x=>{const [a,b]=nn(x.name).split(' ');return a===f&&(!l||!b||b[0]===l[0])}));
  };
  return pick(members.filter(m=>m.active))||pick(members.filter(m=>!m.active));
}

/* ---------- filtros y estadísticas ---------- */
// desde/hasta: un mes (AAAA-MM) o un día (AAAA-MM-DD)
const lastDay=ym=>{const [y,m]=ym.split('-').map(Number);return ymd(new Date(y,m,0))};
function fRange(f){return {a:f.desde?(f.desde.length===7?f.desde+'-01':f.desde):null,b:f.hasta?(f.hasta.length===7?lastDay(f.hasta):f.hasta):null}}
const spanDays=(a,b)=>Math.round((parseYMD(b)-parseYMD(a))/864e5)+1;
function applyF(list,f){
  const q=f.q?norm(f.q.trim()):'',R=fRange(f);
  return list.filter(x=>{
    if(R.a&&x.date<R.a)return false;
    if(R.b&&x.date>R.b)return false;
    if(f.camp!=null&&f.camp!==''&&x.camp!==f.camp)return false;      // campaña exacta
    if(f.aff!=null&&f.aff!==''&&String(x.aff)!==f.aff)return false;  // afiliado exacto
    if(f.pais&&norm(x.country)!==norm(f.pais))return false;
    if(f.marca&&!norm(x.brand||'').includes(norm(f.marca)))return false;
    if(f.vend&&memberName(x.uid)!==f.vend)return false;
    if(f.late==='si'&&!isLate(x))return false;
    if(f.late==='no'&&isLate(x))return false;
    if(q&&!(norm(x.name).includes(q)||norm(x.id).includes(q)||norm(x.tx||'').includes(q)))return false;
    return true;
  });
}
function fDesc(f){
  const p=[];const q=v=>/\s/.test(v)?`"${v}"`:v;
  const pd=v=>v.length===7?mLabel(v):`${dm(v)}/${v.slice(2,4)}`;
  if(f.desde&&f.desde===f.hasta)p.push((f.desde.length===7?'mes:':'día:')+pd(f.desde));
  else{if(f.desde)p.push('desde:'+pd(f.desde));if(f.hasta)p.push('hasta:'+pd(f.hasta))}
  if(f.camp)p.push('camp:'+q(f.camp));if(f.aff)p.push('aff:'+f.aff);if(f.pais)p.push('pais:'+q(f.pais));
  if(f.marca)p.push('marca:'+q(f.marca));if(f.vend)p.push('vendedor:'+q(f.vend));if(f.late)p.push('tipo:'+(f.late==='si'?'late':'new'));
  if(f.q)p.push('"'+f.q+'"');
  return p.join(' ')||'todo el historial';
}
function resumen(list){
  const n=list.length,monto=list.reduce((a,x)=>a+(+x.amount||0),0),lat=list.filter(isLate);
  const bym={};for(const x of list){const k=x.date.slice(0,7);bym[k]=(bym[k]||0)+1}
  const best=Object.entries(bym).sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?1:-1))[0]||null;
  const meses=Object.keys(bym).length;
  return {n,monto,prom:n?monto/n:0,lates:lat.length,latePct:n?lat.length/n:0,lateDias:lat.length?lat.reduce((a,x)=>a+lateDays(x),0)/lat.length:0,
    meses,porMes:meses?n/meses:0,best};
}
const DIMS={
  campanas:{f:'camp',t:'Campañas',k:x=>x.camp||'(sin campaña)'},
  afiliados:{f:'aff',t:'Afiliados',k:x=>String(x.aff||'—')},
  paises:{f:'pais',t:'Países',k:x=>x.country||'—',norm:1},
  marcas:{f:'marca',t:'Marcas',k:x=>x.brand||'—'},
  vendedores:{f:'vend',t:'Vendedores',k:x=>memberName(x.uid)},
};
function groupBy(list,dim){
  const D=DIMS[dim],m=new Map();
  for(const x of list){const lab=D.k(x),key=D.norm?norm(lab):lab;let g=m.get(key);if(!g){g={k:lab,n:0,monto:0,lates:0};m.set(key,g)}g.n++;g.monto+=+x.amount||0;if(isLate(x))g.lates++}
  return [...m.values()].sort((a,b)=>b.n-a.n||b.monto-a.monto||String(a.k).localeCompare(String(b.k)));
}
function mesesRango(list,f){
  const ms=list.map(x=>x.date.slice(0,7)).sort();
  let a=(f.desde||ms[0]||'').slice(0,7),b=(f.hasta||ms[ms.length-1]||'').slice(0,7);if(!a||!b)return [];
  const out=[];let [y,m]=a.split('-').map(Number);
  while(true){const k=`${y}-${z(m)}`;if(k>b)break;out.push(k);m++;if(m>12){m=1;y++}if(out.length>120)break}
  return out;
}
function porMes(list,f){
  const b={};for(const x of list){const k=x.date.slice(0,7);const o=b[k]||(b[k]={n:0,late:0,monto:0});o.n++;o.monto+=+x.amount||0;if(isLate(x))o.late++}
  return mesesRango(list,f).map(k=>({ym:k,...(b[k]||{n:0,late:0,monto:0})}));
}
const sinFiltros=f=>!Object.values(f).some(v=>v!=null&&v!=='');

/* ---------- días por cantidad de ventas ---------- */
function pascua(y){ // domingo de Pascua (algoritmo de Butcher)
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,
    i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),x=h+l-7*m+114;
  return ymd(new Date(y,Math.floor(x/31)-1,(x%31)+1));
}
const FER={};
function feriadosUY(y){ // feriados nacionales de Uruguay (ley 16.805 con la redacción de la 17.414)
  if(FER[y])return FER[y];
  const F=[],add=(d,n,t)=>F.push({d,n,t});
  const mov=md=>{const d=`${y}-${md}`,w=parseYMD(d).getDay();return w===2||w===3?addDays(d,1-w):w===4||w===5?addDays(d,8-w):d}; // mar/mié → lunes anterior · jue/vie → lunes siguiente
  const P=pascua(y);
  add(`${y}-01-01`,'Año Nuevo','no');add(`${y}-01-06`,'Reyes','lab');
  add(addDays(P,-48),'Carnaval','lab');add(addDays(P,-47),'Carnaval','lab');
  for(let i=-6;i<=-2;i++)add(addDays(P,i),'Turismo','lab');
  add(mov('04-19'),'Desembarco de los 33','lab');add(`${y}-05-01`,'Día de los Trabajadores','no');add(mov('05-18'),'Batalla de Las Piedras','lab');
  add(`${y}-06-19`,'Natalicio de Artigas','lab');add(`${y}-07-18`,'Jura de la Constitución','no');add(`${y}-08-25`,'Independencia','no');
  add(mov('10-12'),'Diversidad Cultural','lab');add(`${y}-11-02`,'Difuntos','lab');add(`${y}-12-25`,'Navidad','no');
  return FER[y]=F;
}
const feriado=d=>feriadosUY(+d.slice(0,4)).find(x=>x.d===d)||null;
function noTrabajo(d){ // por qué ese día no se cuenta ('' = se cuenta)
  if(!(cfg.laborables||DEF.laborables).includes(parseYMD(d).getDay()))return 'finde';
  const fe=feriado(d),sf=cfg.sinFer||DEF.sinFer;if(fe&&sf[fe.t])return 'feriado';
  const L=cfg.libres||[];if(L.includes(d)||L.includes(d.slice(5)))return 'libre';
  if((cfg.faltas||[]).some(x=>x.d===d))return 'falta';
  return '';
}
function diasDist(list,f){
  let first=cfg.inicio||null;if(!first)for(const x of ftds)if(!first||x.date<first)first=x.date;
  if(!first)return null;
  const byDay={};for(const x of list)byDay[x.date]=(byDay[x.date]||0)+1;
  const te=todayS();
  const R=fRange(f);let start=first;if(R.a&&R.a>start)start=R.a;
  let end=te;if(R.b&&R.b<end)end=R.b;
  const h={},lastD={},ex={finde:0,feriado:0,libre:0,falta:0};let dias=0,tot=0,best=null,fuera=0;
  for(let d=start,i=0;d<=end&&i<5000;d=addDays(d,1),i++){
    const n=byDay[d]||0,r=noTrabajo(d);
    if(r){ex[r]++;fuera+=n;continue}  // fines de semana, feriados, días libres y faltas no se cuentan (aunque haya ventas)
    if(!n&&d===te)continue;           // hoy entra cuando tenga ventas
    h[n]=(h[n]||0)+1;lastD[n]=d;dias++;tot+=n;if(n&&(!best||n>=best[1]))best=[d,n];
  }
  const max=Math.max(0,...Object.keys(h).map(Number)),rows=[];
  for(let n=0;n<=max;n++)rows.push({n,d:h[n]||0,last:lastD[n]||null});
  return {rows,dias,cero:h[0]||0,con:dias-(h[0]||0),tot,start,end,best,ex,fuera,fal:ex.falta};
}

/* ---------- CSV ---------- */
const CSV_H=['Date','Time','ID','Country','Full Name','Affiliate','Campaign','Amount','Transaction ID','Registration','Type','Brand'];
function csvText(bom=true){
  const sep=cfg.sep;
  const q=v=>{v=String(v??'');return (v.includes(sep)||/["\r\n]/.test(v))?'"'+v.replace(/"/g,'""')+'"':v};
  const amt=a=>sep===';'?String(a).replace('.',','):String(a);
  const rows=[...ftds].sort(byDate).map(f=>[f.date,f.time||'',f.id,f.country,f.name,f.aff,f.camp,amt(f.amount),f.tx||'',f.reg||'',isLate(f)?'late':'new',f.brand||'']);
  return (bom?'﻿':'')+[CSV_H,...rows].map(r=>r.map(q).join(sep)).join('\r\n')+'\r\n';
}
function parseCSV(text){
  text=text.replace(/^﻿/,'');
  const first=text.split(/\r?\n/)[0];
  const sep=[',',';','\t'].map(s=>[s,first.split(s).length]).sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){if(ch==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=ch}
    else if(ch==='"')q=true;
    else if(ch===sep){row.push(f);f=''}
    else if(ch==='\n'){row.push(f);rows.push(row);row=[];f=''}
    else if(ch!=='\r')f+=ch;
  }
  if(f||row.length){row.push(f);rows.push(row)}
  return rows.filter(r=>r.some(x=>x.trim()));
}
const brandSlug=b=>b==='Trade24Seven'?'t24':(norm(b).replace(/[^a-z0-9]/g,'').slice(0,10)||'x');
function csvToRows(rows){ // filas del CSV (export de la plataforma o de este panel) → ventas
  const H=rows[0].map(h=>norm(h.trim()));
  const ix=(...n)=>H.findIndex(h=>n.includes(h));
  const map={date:ix('date','fecha','time of ftd','ftd time','fecha ftd'),time:ix('time','hora'),id:ix('id','user id','userid'),
    country:ix('country','pais'),name:ix('full name','fullname','name','nombre','nombre completo'),aff:ix('affiliate','afiliado'),
    camp:ix('campaign','campana','user source','source'),amount:ix('amount','monto'),tx:ix('transaction id','transaction','tx','transaccion'),
    reg:ix('registration','registration time','registro','fecha de registro'),brand:ix('brand','marca'),
    agent:ix('agent','agente','sales agent','retention agent','conversion agent','owner','assigned to','assigned agent','asignado','vendedor','employee','rep','sales rep')};
  if(map.date<0||map.id<0||map.amount<0)return null;
  const g=(r,k)=>map[k]>=0?(r[map[k]]||'').trim():'';
  const ok=[];let bad=0;
  for(const r of rows.slice(1)){
    const [dp,tp]=g(r,'date').split(/\s+/);const d=parseDate(dp,'past');const amt=parseAmount(g(r,'amount'));
    if(!d||!g(r,'id')||isNaN(amt)){bad++;continue}
    const date=ymd(d);
    let reg=date;const rr=g(r,'reg');
    if(rr){const [rp,rt]=rr.split(/\s+/);const rd=parseDate(rp,'past');if(rd){const t=rt?parseTime(rt):null;reg=ymd(rd)+(t?' '+t:'')}}
    const camp=g(r,'camp'); // tal cual viene de la plataforma (incluido "null")
    let name=g(r,'name'),deleted=false;if(/^deleted_/i.test(name)){name=name.replace(/^deleted_/i,'');deleted=true}
    const row={date,time:map.time>=0?(parseTime(g(r,'time'))||''):(tp&&parseTime(tp))||'',id:g(r,'id'),country:g(r,'country'),name,
      aff:g(r,'aff'),camp,amount:amt,tx:g(r,'tx'),reg,brand:g(r,'brand'),agent:g(r,'agent')};
    if(deleted)row.deleted=true;
    ok.push(row);
  }
  return {ok,bad};
}

/* ---------- avisos: sonido + destello (+ notificación del sistema si el navegador la permite) ---------- */
let actx=null;
function primeAudio(){try{if(!actx)actx=new (window.AudioContext||window.webkitAudioContext)();if(actx.state==='suspended')actx.resume()}catch(e){}}
function beep(times=3){
  try{
    primeAudio();if(!actx)return;const t=actx.currentTime;
    for(let i=0;i<times;i++)[[0,880],[.16,1320]].forEach(([d,f])=>{
      const o=actx.createOscillator(),g=actx.createGain(),s=t+i*.45+d;o.type='square';o.frequency.value=f;
      g.gain.setValueAtTime(.0001,s);g.gain.exponentialRampToValueAtTime(.1,s+.01);g.gain.exponentialRampToValueAtTime(.0001,s+.14);
      o.connect(g).connect(actx.destination);o.start(s);o.stop(s+.15);
    });
  }catch(e){}
}
function flash(){document.body.classList.remove('flash');void document.body.offsetWidth;document.body.classList.add('flash');setTimeout(()=>document.body.classList.remove('flash'),3800)}
function sysNotify(title,body,tag){
  try{if('Notification' in window&&Notification.permission==='granted'){const nt=new Notification(title,{body,tag,requireInteraction:true});nt.onclick=()=>{window.focus();nt.close()};return true}}catch(e){}
  return false;
}

/* ---------- turno ---------- */
const hhmm=ms=>{const d=new Date(ms);return `${z(d.getHours())}:${z(d.getMinutes())}`};
const mins=ms=>Math.round(ms/6e4);
const dur=ms=>{const m=Math.max(0,mins(ms));return m<60?`${m} min`:`${Math.floor(m/60)} h ${z(m%60)} m`};
const durS=ms=>{const m=Math.max(0,mins(ms));return `${Math.floor(m/60)}h${z(m%60)}`};
const mmss=ms=>{const t=Math.max(0,Math.floor(ms/1e3));return `${z(Math.floor(t/60))}:${z(t%60)}`};
const jorMs=()=>(+cfg.jornada||450)*6e4;
const msAt=(date,hm)=>{const d=parseYMD(date);const [H,M]=hm.split(':').map(Number);d.setHours(H,M,0,0);return d.getTime()};
function openTurno(){ // el de hoy, o el de ayer si cruzó la medianoche
  const t=turnos[todayS()];if(t&&!t.out)return t;
  const ty=turnos[addDays(todayS(),-1)];
  return ty&&!ty.out&&Date.now()-ty.in<16*36e5?ty:null;
}
const breakAbierto=t=>t&&t.breaks.find(b=>!b.e);
function lastMark(t){let m=t.in;for(const b of t.breaks){m=Math.max(m,b.s,b.e||0)}return Math.max(m,t.out||0)}
function metr(t,now=Date.now()){
  const end=t.out||now,total=end-t.in;
  let desc=0,exceso=0;
  const br=t.breaks.map(b=>{const e=b.e||end,d=e-b.s,ex=Math.max(0,d-b.k*6e4);desc+=d;exceso+=ex;return {...b,d,ex}});
  const ftd=ftds.filter(f=>f.date===t.date).length;
  const cont=pend.filter(p=>p.done&&p.doneAt&&ymd(new Date(p.doneAt))===t.date).length;
  const horas=total/36e5;
  return {total,desc,exceso,br,extra:total-jorMs(),ftd,cont,fph:horas>=.25?ftd/horas:null,salidaEst:t.in+jorMs()};
}
