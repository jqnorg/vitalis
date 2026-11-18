/* ============================================================
   Social: pedir un mate, salir a los 10 o a la media, mensajes cortos.
   Llegan como aviso (acá y, con la extensión, en cualquier pestaña). Se pueden silenciar.
   ============================================================ */
const KIND={
  mate:{label:'Pedir un mate',ask:'pide un mate 🧉',askTo:'te pide un mate 🧉',replies:[['si','Te lo cebo'],['no','Ahora no']],wait:20*6e4},
  d10:{label:'Salir a los 10',ask:'¿alguien sale a los 10?',askTo:'¿salimos a los 10?',replies:[['si','Dale'],['luego','En 5'],['no','Ahora no']],wait:3*6e4},
  d30:{label:'Salir a la media',ask:'¿alguien sale a la media?',askTo:'¿salimos a la media?',replies:[['si','Dale'],['luego','En 5'],['no','Ahora no']],wait:3*6e4},
  msg:{label:'Mensaje',ask:'',askTo:'',replies:[['si','👍']],wait:15e3},
  toque:{label:'Dar un toque',ask:'te dio un toque 👉',askTo:'te dio un toque 👉',replies:[['si','Devolver el toque']],wait:2*6e4},
};
const first=uid=>memberName(uid).split(/\s+/)[0];
const replyTxt=(p,r=p.reply)=>{if(p.kind==='toque')return 'te devolvió el toque 👈';const k=KIND[p.kind]||KIND.msg;const x=k.replies.find(y=>y[0]===r);return x?x[1]:r};
const askTxt=p=>p.kind==='msg'?p.body:(p.to?KIND[p.kind].askTo:KIND[p.kind].ask);
const forMe=p=>p.from!==me&&(p.to===me||p.to===null);
const agoTxt=iso=>{const m=Math.round((Date.now()-new Date(iso))/6e4);return m<1?'recién':m<60?`hace ${m} min`:`hace ${Math.floor(m/60)} h`};

function pop(){ // sonido corto y amable para lo social (distinto a la agenda)
  try{primeAudio();if(!actx)return;const t=actx.currentTime;
    [[0,660],[.12,990]].forEach(([d,f])=>{const o=actx.createOscillator(),g=actx.createGain(),s=t+d;o.type='sine';o.frequency.value=f;
      g.gain.setValueAtTime(.0001,s);g.gain.exponentialRampToValueAtTime(.18,s+.015);g.gain.exponentialRampToValueAtTime(.0001,s+.25);o.connect(g).connect(actx.destination);o.start(s);o.stop(s+.26)});
  }catch(e){}
}
const pageAway=()=>document.hidden||!document.hasFocus();
function feedTxt(p){ // "Matias pide un mate", "Le pediste un mate a Sofía", "Sofía → vos: ¿salimos a los 10?"
  const mine=p.from===me,X=`<b>${esc(first(p.from))}</b>`,Y=p.to===me?'vos':`<b>${esc(first(p.to||''))}</b>`;
  if(p.kind==='toque')return mine?`Le diste un toque a ${Y} 👉`:`${X} te dio un toque 👉`;
  if(p.kind==='mate'){
    if(!p.to)return mine?'<b>Vos</b> pediste un mate':`${X} pide un mate`;
    return mine?`Le pediste un mate a ${Y}`:p.to===me?`${X} te pide un mate`:`${X} le pide un mate a ${Y}`;
  }
  const q=p.kind==='msg'?esc(p.body):esc(p.to?KIND[p.kind].askTo:KIND[p.kind].ask);
  return `${mine?'<b>Vos</b>':X}${p.to?' → '+Y:''}: ${q}`;
}

// llega algo nuevo o una respuesta
function socialEvent(p,type,prev){
  if(type==='INSERT'){
    if(!forMe(p)||p.reply)return;
    if(Date.now()-new Date(p.at)>10*6e4)return; // viejo (por ejemplo al reconectar)
    if(quiet())return;
    socialAlert(p);
    return;
  }
  if(type==='UPDATE'&&p.reply&&!(prev&&prev.reply)){
    closeToast('so'+p._id);extSocialClose(p._id);
    if(p.from===me&&p.by!==me){ // me contestaron
      const txt=p.kind==='toque'?`<b>${esc(first(p.by))}</b> te devolvió el toque 👈`:`<b>${esc(first(p.by))}</b>: ${esc(replyTxt(p))}${p.kind==='msg'?'':' · '+esc(KIND[p.kind].label.toLowerCase())}`;
      toast(txt,'ok',{ms:9000,key:'sor'+p._id});
      if(!quiet()){pop();if(pageAway())extSocial({k:'so:'+p._id,title:'Te contestaron',id:first(p.by)+': '+replyTxt(p),kw:p.kind==='msg'?p.body:KIND[p.kind].label,meta:'',btns:[['close','Ok',1]]})}
    }
  }
}
function socialGone(id){closeToast('so'+id);extSocialClose(id)}
function socialAlert(p){
  const who=first(p.from),q=askTxt(p),k=KIND[p.kind]||KIND.msg;
  pop();
  if(p.kind==='toque'){ // liviano: no queda fijo
    toast(`<b>${esc(who)}</b> te dio un toque 👉`,'ok',{ms:12000,key:'so'+p._id,actions:[{l:'Devolver el toque',fn:()=>B.replyPing(p._id,'si')},{l:'Ver perfil',fn:()=>openProfile(p.from)}]});
    if(pageAway())extSocial({k:'so:'+p._id,title:'Toque',id:who+' te dio un toque 👉',kw:'',meta:'',btns:[['r:si','Devolver el toque',1],['close','Ok']]});
    return;
  }
  toast(`<b>${esc(who)}</b> ${p.kind==='msg'?'te escribe: '+esc(q):esc(q)}`,'alert',{sticky:1,key:'so'+p._id,
    actions:[...k.replies.map(([r,l])=>({l,fn:()=>B.replyPing(p._id,r)})),{l:'Silenciar 1 h',fn:()=>setQuiet(36e5)}]});
  if(pageAway())extSocial({k:'so:'+p._id,title:p.kind==='mate'?'Piden un mate':p.kind==='msg'?'Mensaje':'Descanso',id:who+(p.kind==='msg'?'':' '+q),kw:p.kind==='msg'?q:'',meta:p.to?'Para vos':'Para toda la mesa',
    btns:[...k.replies.map(([r,l],i)=>['r:'+r,l,i===0?1:0]),['quiet','Silenciar 1 h']]});
}
function closeToast(key){const t=document.querySelector(`#toasts [data-key="${CSS.escape(key)}"]`);if(t)t.remove()}
// con la extensión, el aviso aparece en la pestaña que estés
function extSocial(card){if(extOn())postTop({type:'ftd-agenda-social',v:1,card})}
function extSocialClose(id){if(extOn())postTop({type:'ftd-agenda-social-close',v:1,k:'so:'+id})}
async function setQuiet(ms){
  const until=ms==null?null:ms==='siempre'?'2100-01-01T00:00:00Z':ms==='manana'?(()=>{const d=new Date();d.setDate(d.getDate()+1);d.setHours(8,0,0,0);return d.toISOString()})():new Date(Date.now()+ms).toISOString();
  if(await B.setQuiet(until))toast(until?`Avisos sociales silenciados ${ms==='siempre'?'hasta que los actives':ms==='manana'?'hasta mañana a las 8':'por 1 hora'}.`:'Avisos sociales activados.',ms==null?'ok':'warn',{key:'quiet'});
}
// comandos que vienen de la tarjeta de la extensión
function socialCmd(d){
  const id=String(d.k||'');
  if(id.startsWith('t:'))return taskCmd(d); // "Ya la hice" desde la tarjeta de la extensión
  if(d.cmd==='reply'&&['si','no','luego'].includes(d.r))B.replyPing(id,d.r);
  else if(d.cmd==='quiet')setQuiet(36e5);
}
const pendingForMe=()=>pings.filter(p=>p.kind!=='toque'&&forMe(p)&&!p.reply&&Date.now()-new Date(p.at)<60*6e4).length;
function cooldownLeft(kind,to){
  const k=KIND[kind];const last=pings.filter(p=>p.from===me&&p.kind===kind&&(kind==='mate'||p.to===(to||null))).reduce((a,p)=>Math.max(a,+new Date(p.at)),0);
  return Math.max(0,last+k.wait-Date.now());
}

/* ---------- la sección ---------- */
let soTo='';
V.social={
  build(){
    $('#soQuiet').innerHTML=[['on','Avisos activados'],['1h','Silenciar 1 h'],['manana','Hasta mañana'],['siempre','Siempre']].map(([k,l])=>`<button type="button" data-q="${k}">${l}</button>`).join('');
    $('#soQuiet').addEventListener('click',e=>{const b=e.target.closest('[data-q]');if(!b)return;const q=b.dataset.q;setQuiet(q==='on'?null:q==='1h'?36e5:q)});
    $('#soTo').addEventListener('change',e=>{soTo=e.target.value;this.render({})});
    $('#soActs').addEventListener('click',async e=>{const b=e.target.closest('[data-ping]');if(!b||b.disabled)return;
      primeAudio();const g=await B.ping(b.dataset.ping,soTo||null);
      if(g)toast(`${b.dataset.ping==='mate'?'Pediste un mate':'Preguntaste'} ${soTo?'a '+esc(first(soTo)):'a toda la mesa'}.${soTo&&quiet(members.find(m=>m.id===soTo))?' '+sp('hot','Tiene los avisos silenciados.'):''}`)});
    $('#soChat').addEventListener('click',()=>go('chat',{chat:teamChat()&&teamChat().id}));
    $('#soFeed').addEventListener('click',async e=>{const b=e.target.closest('[data-pr]');if(!b)return;
      if(b.dataset.pr==='del'){if(await B.delPing(b.dataset.id))toast('Pedido cancelado.');return}
      B.replyPing(b.dataset.id,b.dataset.pr)});
    setInterval(()=>{if(ready&&cur==='social')this.render({})},3e4); // esperas y "hace x min"
  },
  render(){
    const q=quiet(),qu=profile.quiet_until?new Date(profile.quiet_until):null;
    const qk=!q?'on':qu.getFullYear()>2090?'siempre':qu-Date.now()>2*36e5?'manana':'1h';
    $$('[data-q]',$('#soQuiet')).forEach(b=>b.classList.toggle('on',b.dataset.q===qk));
    $('#soSub').innerHTML=q?sp('hot',`Avisos sociales silenciados${qu.getFullYear()>2090?'':' hasta las '+z(qu.getHours())+':'+z(qu.getMinutes())}.`)+' Igual ves todo acá.':'Pedí un mate o arreglá para salir. Les llega como aviso.';
    const act=members.filter(m=>m.active&&m.id!==me);
    if(soTo&&!act.some(m=>m.id===soTo))soTo='';
    const sel=$('#soTo');if(sel!==document.activeElement){sel.innerHTML=`<option value="">Toda la mesa</option>`+act.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');sel.value=soTo}
    $('#soActs').innerHTML=['mate','d10','d30'].map(k=>{const left=cooldownLeft(k,soTo);
      return `<button type="button" class="so-act" data-ping="${k}"${left?' disabled':''}><span class="ic">${k==='mate'?'<svg aria-hidden="true"><use href="#mate"/></svg>':k==='d10'?'10\'':'30\''}</span><span><b>${KIND[k].label}</b><small>${left?`Podés de nuevo en ${left>=6e4?Math.ceil(left/6e4)+' min':Math.ceil(left/1e3)+' s'}`:soTo?'A '+esc(first(soTo)):'A toda la mesa'}</small></span></button>`}).join('');
    $('#soPeople').innerHTML=`<div class="so-people">${act.map(m=>`<button type="button" class="so-p" data-prof="${esc(m.id)}" title="Ver el perfil de ${esc(m.name)}">${avatar(m.name)}<span class="nm">${esc(m.name)}</span>${quiet(m)?'<span class="q" title="Avisos silenciados">🔕</span>':''}</button>`).join('')}</div>`;
    const list=pings.filter(p=>Date.now()-new Date(p.at)<24*36e5);
    $('#soCount').textContent=list.length?plural(list.length,'pedido'):'';
    $('#soFeed').innerHTML=list.length?`<div class="so-feed">${list.map(p=>{
      const mine=p.from===me,k=KIND[p.kind]||KIND.msg;
      const st=p.reply?`<span class="badge${p.reply==='si'?' paid':''}">${p.by===me?'Vos':esc(first(p.by))}: ${esc(replyTxt(p))}</span>`
        :mine?`<span class="d">Esperando</span><button type="button" class="ib del" data-pr="del" data-id="${esc(p._id)}">Cancelar</button>`
        :forMe(p)?k.replies.map(([r,l],i)=>`<button type="button" class="${i===0?'btn sm pri':'ib'}" data-pr="${r}" data-id="${esc(p._id)}">${esc(l)}</button>`).join(''):'';
      return `<div class="so-it${forMe(p)&&!p.reply&&p.kind!=='toque'?' new':''}"><button type="button" class="avb" data-prof="${esc(p.from)}" title="Ver el perfil de ${esc(memberName(p.from))}">${avatar(memberName(p.from))}</button><span class="tx">${feedTxt(p)}<small>${agoTxt(p.at)}</small></span><span class="st">${st}</span></div>`}).join('')}</div>`
      :'<div class="p-empty">Nada por hoy. ¿Arrancás la ronda?</div>';
  },
};

// puesta al día de lo social (si el tiempo real se cortó): lo de los últimos 15 min
async function socialPoll(){
  if(!ready||!sb||document.hidden&&!extOn())return;
  try{
    const rows=await Q(sb.from('pings').select('*').gte('created_at',new Date(Date.now()-15*6e4).toISOString()).order('created_at',{ascending:false}).limit(100));
    let ch=false;
    for(const r of rows){
      if(r.team_id!==profile.team_id)continue;
      const g=G2P(r),old=pings.find(x=>x._id===g._id);
      if(!old){pings.unshift(g);socialEvent(g,'INSERT',null);ch=true}
      else if(old.reply!==g.reply){const prev={...old};Object.assign(old,g);socialEvent(old,'UPDATE',prev);ch=true}
    }
    if(ch){pings.sort((a,b)=>a.at<b.at?1:-1);refresh()}
  }catch(e){}
}

/* ---------- perfil de cada uno: estadísticas y toques ---------- */
function profStats(uid){
  const L=team.filter(f=>f.uid===uid),te=todayS(),ym=ymNow(),ws=weekStart(te);
  const mes=L.filter(f=>f.date.slice(0,7)===ym);
  const act=sellers(team.filter(f=>f.date.slice(0,7)===ym)),cnt=act.map(m=>team.filter(f=>f.uid===m.id&&f.date.slice(0,7)===ym).length);
  const last=L.reduce((a,f)=>!a||byDate(f,a)>0?f:a,null);
  const days=[];for(let i=13;i>=0;i--){const d=addDays(te,-i),l=L.filter(f=>f.date===d),x=parseYMD(d);days.push({lab:String(x.getDate()),d:x.getDate(),m0:x.getMonth()+1,dw:x.getDay(),a:l.filter(f=>!isLate(f)).length,b:l.filter(isLate).length,m:l.reduce((s,f)=>s+(+f.amount||0),0),labC:x.getDay()===0||x.getDay()===6?'color-mix(in srgb,var(--dim) 55%,transparent)':''})}
  return {hoy:L.filter(f=>f.date===te).length,sem:L.filter(f=>f.date>=ws&&f.date<=te).length,mes:mes.length,usd:mes.reduce((s,f)=>s+(+f.amount||0),0),
    pos:mes.length?1+cnt.filter(n=>n>mes.length).length:null,of:act.length,cv:convPeriod(ym+'-01',te,uid),last,total:L.length,days};
}
function openProfile(uid){
  const m=members.find(x=>x.id===uid);if(!m)return;
  const own=uid===me,S=profStats(uid);
  const lastTxt=S.last?(()=>{const n=Math.round((parseYMD(todayS())-parseYMD(S.last.date))/864e5);return n===0?'hoy':n===1?'ayer':`hace ${n} días`})():'—';
  const k=(lb,v,s2)=>`<div class="kpi"><div class="lb">${esc(lb)}</div><div class="v">${v}</div><div class="s">${s2}</div></div>`;
  const body=`<div class="pf">
    <div class="pf-h">${own?`<button type="button" class="av-edit" data-own data-act="foto" title="Cambiar mi foto">${avatar(m.name,'xl')}<span>Cambiar</span></button>`:avatar(m.name,'xl')}<div><h2>${esc(m.name)}</h2><p>${esc(roleTxt(m.role))}${own?' · vos':''}${quiet(m)?' · <span class="hot">🔕 avisos silenciados</span>':''}${m.active?'':' · de baja'}</p></div></div>
    <div class="pf-k">${k('Hoy',S.hoy,'FTDs')}${k('Esta semana',S.sem,'FTDs')}${k(MES[new Date().getMonth()][0].toUpperCase()+MES[new Date().getMonth()].slice(1),S.mes,`FTDs · ${esc(money(S.usd))} USD`)}
      ${k('Puesto del mes',S.pos?`${S.pos}º`:'—',S.pos?`de ${S.of}`:'sin FTDs todavía')}${k('Conversión del mes',S.cv.rate==null?'—':esc(pct(S.cv.rate)),`${plural(S.cv.ftd,'FTD')} de ${plural(S.cv.leads,'cliente new','clientes new')}`)}${k('Último FTD',lastTxt,`${plural(S.total,'FTD')} en total`)}</div>
    <div class="pf-ch"><div class="lb">FTDs de los últimos 14 días <span class="pf-lg"><span class="sw"></span>new <span class="sw s2"></span>late</span></div><div id="pfChart"></div></div>
    ${own?'':`<div class="pf-acts" id="pfActs"></div>`}
  </div>`;
  let tm=null;
  const acts=api=>{const el=api.q('#pfActs');if(!el)return;
    const lt=cooldownLeft('toque',uid),lm=cooldownLeft('mate',uid),t=ms=>ms>=6e4?Math.ceil(ms/6e4)+' min':Math.ceil(ms/1e3)+' s';
    el.innerHTML=`<button type="button" class="btn pri" data-pa="toque"${lt?' disabled':''}>👉 ${lt?'Toque en '+t(lt):'Dar un toque'}</button>
      <button type="button" class="btn" data-pa="mate"${lm?' disabled':''}>${lm?'Mate en '+t(lm):'Pedirle un mate'}</button>
      <button type="button" class="btn" data-pa="d10"${cooldownLeft('d10',uid)?' disabled':''}>¿Salimos a los 10?</button>
      <button type="button" class="btn" data-pa="d30"${cooldownLeft('d30',uid)?' disabled':''}>¿A la media?</button>
      <button type="button" class="btn" data-pa="chat">Mensaje</button>${isLeader()?'<button type="button" class="btn" data-pa="ficha">Ver ficha</button>':''}`};
  modal({title:'Perfil',wide:true,body,onOpen:api=>{
      const ch=api.q('#pfChart');
      colChart(ch,S.days,{h:150,capMin:14,int:true,minTop:3,label:'FTDs por día, últimos 14 días',empty:'Sin FTDs en estos 14 días.',
        tip:d=>({title:`${DIAL[d.dw]} ${z(d.d)}/${z(d.m0)}`,rows:[{v:String(d.a+d.b),l:'FTDs'},{key:'var(--s1)',v:String(d.a),l:'new'},{key:'var(--s2)',v:String(d.b),l:'late'},{v:money(d.m),l:'USD depositados'}]})});
      acts(api);tm=setInterval(()=>acts(api),1000);
      const el=api.q('#pfActs');if(el)el.addEventListener('click',async e=>{const b=e.target.closest('[data-pa]');if(!b||b.disabled)return;primeAudio();
        const a=b.dataset.pa,who=esc(first(uid));
        if(a==='chat'){const id=await B.chatDm(uid);if(id){api.close();go('chat',{chat:id})}return}
        if(a==='ficha'){api.close();fichaModal(uid);return}
        b.disabled=true;const g=await B.ping(a,uid);acts(api);
        if(g)toast((a==='toque'?`Le diste un toque a ${who} 👉`:a==='mate'?`Le pediste un mate a ${who}.`:`Le preguntaste a ${who}.`)+(quiet(m)?' '+sp('hot','Tiene los avisos silenciados.'):''));
      });
    },onClose:()=>clearInterval(tm)});
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-prof]');if(!b||!ready)return;e.preventDefault();openProfile(b.dataset.prof)});

/* ---------- fotos de perfil: cada uno sube la suya (recortada cuadrada y achicada); la ve toda la mesa ---------- */
function b64Blob(b,mime){const bin=atob(b),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);return new Blob([u8],{type:mime})}
function avSet(r){
  const at=+new Date(r.updated_at),o=avatars[r.user_id];if(o&&o.at===at)return false;
  if(o)URL.revokeObjectURL(o.url);avatars[r.user_id]={url:URL.createObjectURL(b64Blob(r.data,r.mime)),at};return true;
}
function avDrop(uid){const o=avatars[uid];if(!o)return false;URL.revokeObjectURL(o.url);delete avatars[uid];return true}
async function loadAvatars(){
  try{const rows=await Q(sb.from('avatars').select('user_id,mime,data,updated_at'));avOk=true;
    const ids=new Set(rows.map(r=>r.user_id));for(const u in avatars)if(!ids.has(u))avDrop(u);for(const r of rows)avSet(r)}
  catch(e){avOk=false}
}
async function avPoll(){ // al ponerme al día: solo traigo las que cambiaron
  if(!ready||!sb)return;if(!avOk){await loadAvatars();if(avOk)refresh();return}
  try{const rows=await Q(sb.from('avatars').select('user_id,updated_at'));let ch=false;
    const ids=new Set(rows.map(r=>r.user_id));for(const u in avatars)if(!ids.has(u))ch=avDrop(u)||ch;
    const need=rows.filter(r=>!avatars[r.user_id]||avatars[r.user_id].at!==+new Date(r.updated_at)).map(r=>r.user_id);
    if(need.length)for(const r of await Q(sb.from('avatars').select('user_id,mime,data,updated_at').in('user_id',need)))ch=avSet(r)||ch;
    if(ch)refresh()}catch(e){}
}
function avLive(p){if(p.eventType==='DELETE'){if(avDrop(p.old&&p.old.user_id))refresh();return}if(p.new&&p.new.data&&avSet(p.new))refresh()}
async function prepAvatar(file){ // cuadrada, del centro, 320 px, webp
  if(!file||!/^image\//.test(file.type))throw new Error('IMG: eso no es una imagen');
  const bmp=await createImageBitmap(file),s=Math.min(bmp.width,bmp.height),S=Math.min(320,s);
  const cv=document.createElement('canvas');cv.width=cv.height=S;const cx=cv.getContext('2d');
  cx.drawImage(bmp,(bmp.width-s)/2,(bmp.height-s)/2,s,s,0,0,S,S);bmp.close&&bmp.close();
  const enc=(t,q)=>new Promise(r=>cv.toBlob(r,t,q));
  let q=.86,b=await enc('image/webp',q);
  if(!b||b.type!=='image/webp'){cx.globalCompositeOperation='destination-over';cx.fillStyle='#fff';cx.fillRect(0,0,S,S);b=await enc('image/jpeg',q)}
  while(b&&b.size>180e3&&q>.4){q-=.15;b=await enc(b.type,q)}
  if(!b||b.size>210e3)throw new Error('IMG: la foto es muy pesada');
  return b;
}
Object.assign(B,{
  async setAvatar(blob){
    try{const [r]=await Q(sb.from('avatars').upsert({user_id:me,mime:blob.type,data:await b64(blob)},{onConflict:'user_id'}).select('user_id,updated_at'));
      avDrop(me);avatars[me]={url:URL.createObjectURL(blob),at:+new Date(r.updated_at)};avOk=true;refresh();return true}
    catch(e){if(/avatars|PGRST205|42P01/.test(String(e&&(e.message||e.code))))toast('Las fotos se activan en un rato (falta actualizar la base).','warn');else dbErr(e);return false}
  },
  async delAvatar(){try{await Q(sb.from('avatars').delete().eq('user_id',me));avDrop(me);refresh();return true}catch(e){dbErr(e);return false}},
});
function avPick(){const i=$('#avFile');i.value='';i.click()}
$('#avFile').addEventListener('change',async e=>{const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;
  try{const b=await prepAvatar(f);if(await B.setAvatar(b)){toast('Foto de perfil lista 📸');closeProfileModal()}}catch(err){toast(esc(errMsg(err)),'err')}});
function closeProfileModal(){for(const m of [...modals])if(m.box.querySelector('.pf-h [data-own]'))m.close()}
