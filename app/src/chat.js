/* ============================================================
   Chat: toda la mesa, grupos y privados. En vivo, con no leídos y avisos
   (acá y, con la extensión, en la pestaña que estés). Se silencia por chat.
   ============================================================ */
let chatCur=local.get('chatCur',null),chatSig='',chatSound=0,chatInitT=0;
const chatDrafts={},chatMore={},readSave={};
const EMOJIS=['👍','❤️','😂','😮','😢','🙏','🔥','🧉'];
let reacts={},reactVer=0,reactOk=false,chatReply=null; // reacciones por mensaje: id → [{uid,e}] · el mensaje al que estoy respondiendo
const reactFetch=()=>QN(sb.from('message_reactions').select('message_id,user_id,emoji').gte('created_at',new Date(Date.now()-30*864e5).toISOString()).limit(5000));
function reactApply(rows){if(rows)reactsLoaded(rows);else reactOk=false}
async function loadReacts(){reactApply(await reactFetch())}
function reactsLoaded(rows){reactOk=true;reacts={};for(const r of rows||[])(reacts[r.message_id]||(reacts[r.message_id]=[])).push({uid:r.user_id,e:r.emoji});reactVer++}
function msgById(id){if(!id)return null;for(const k in msgs){const m=msgs[k].find(x=>x._id===id);if(m)return m}return null}
function reactLive(p){ // en vivo
  const r=p.eventType==='DELETE'?p.old:p.new;if(!r||!r.message_id)return;
  const L=reacts[r.message_id]||(reacts[r.message_id]=[]);
  if(p.eventType==='DELETE'){const i=L.findIndex(x=>x.uid===r.user_id&&x.e===r.emoji);if(i<0)return;L.splice(i,1)}
  else{if(L.some(x=>x.uid===r.user_id&&x.e===r.emoji))return;L.push({uid:r.user_id,e:r.emoji});reactEvent(r)}
  reactVer++;refresh();
}
function reactEvent(r){ // reaccionaron a un mensaje mío: aviso suave
  if(r.user_id===me)return;const m=msgById(r.message_id);if(!m||m.uid!==me)return;
  const c=chatOf(m.chat);if(!c||chatViewing(c.id)||muted(c.id))return;
  toast(`<b>${esc(first(r.user_id))}</b> reaccionó ${esc(r.emoji)} a tu mensaje: ${esc(clip(msgTxt(m.body),60))}`,'info',{ms:6000,key:'rx'+m._id,actions:[{l:'Ver',fn:()=>go('chat',{chat:c.id})}]});
}
const isLeadUid=uid=>{const m=members.find(x=>x.id===uid);return !!m&&m.role==='leader'}; // el team leader: sus @ llegan aunque esté silenciado
const todosIn=b=>/(^|\s)@todos\b/i.test(String(b||''));
function teamChat(){return chats.find(c=>c.kind==='team')}
function chatOf(id){return chats.find(c=>c.id===id)}
function chatPeople(c){return c.kind==='team'?members.filter(m=>m.active).map(m=>m.id):chatMem.filter(x=>x.chat_id===c.id).map(x=>x.user_id)}
function dmOther(c){return chatPeople(c).find(u=>u!==me)||me}
function chatName(c){return !c?'':c.kind==='team'?'Toda la mesa':c.kind==='dm'?memberName(dmOther(c)):(c.name||'Grupo')}
function myJoin(c){const r=chatMem.find(x=>x.chat_id===c.id&&x.user_id===me);return r?+new Date(r.added_at):0}
function readT(cid){const r=reads[cid];if(r&&r.read_at)return +new Date(r.read_at);const c=chatOf(cid);return c&&c.kind!=='team'?myJoin(c):chatInitT}
function muted(cid){return !!(reads[cid]&&reads[cid].muted)}
function lastMsg(cid){const l=msgs[cid];return l&&l.length?l[l.length-1]:null}
function unread(cid){const t=readT(cid);return (msgs[cid]||[]).filter(m=>m.uid!==me&&m.t>t).length}
function unreadAll(){return chats.reduce((a,c)=>a+(muted(c.id)?0:unread(c.id)),0)}
function mentionsMe(body){const f=nn((profile&&profile.name||'').split(/\s+/)[0]);return !!f&&(String(body).match(/@[A-Za-zÀ-ÿ]+/g)||[]).some(x=>nn(x.slice(1))===f)}
const clip=(s,n)=>{s=String(s||'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s};
/* imágenes: el mensaje empieza con [img:id:AnchoxAlto]; la imagen va aparte (chat_files) y se trae al verla */
const IMG_RE=/^\[img:([0-9a-f-]{36})(?::(\d+)x(\d+))?\]\s*/i;
const msgImg=b=>{const m=String(b||'').match(IMG_RE);return m?{id:m[1],w:+m[2]||0,h:+m[3]||0,rest:String(b).slice(m[0].length)}:null};
const msgTxt=b=>{const i=msgImg(b);return i?('📷 Foto'+(i.rest?' · '+i.rest:'')):String(b||'')};
const imgs={}; // id → {url} | {err} | {p: promesa}
function imgLoad(id){
  const x=imgs[id];
  if(x&&!(x.err==='net'&&Date.now()-x.t>3e4))return x.p||Promise.resolve(x); // si falló la red, reintento después de 30 s
  const p=(async()=>{try{const [r]=await Q(sb.from('chat_files').select('mime,data').eq('id',id));
      if(!r)return imgs[id]={err:'gone'};
      const bin=atob(r.data),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
      return imgs[id]={url:URL.createObjectURL(new Blob([u8],{type:r.mime}))}}
    catch(e){return imgs[id]={err:'net',t:Date.now()}}})();
  imgs[id]={p};return p;
}
function imgPaint(root){ // pone las imágenes que ya llegaron y pide las que faltan
  for(const el of root.querySelectorAll('[data-img]')){const id=el.dataset.img,x=imgs[id];
    if(x&&x.url){const im=el.querySelector('img');if(im&&im.getAttribute('src')!==x.url)im.src=x.url;el.classList.remove('wait','fail')}
    else if(x&&x.err&&!(x.err==='net'&&Date.now()-x.t>3e4)){el.classList.remove('wait');el.classList.add(x.err==='gone'?'gone':'fail')}
    else if(!el.dataset.w){el.dataset.w=1;imgLoad(id).then(()=>{delete el.dataset.w;if(el.isConnected)imgPaint(root)})}
  }
}
async function prepImg(file){ // la achico (1600 px como mucho) y la paso a webp para que pese poco
  if(!file||!/^image\//.test(file.type))throw new Error('IMG: eso no es una imagen');
  const bmp=await createImageBitmap(file);
  const k=Math.min(1,1600/Math.max(bmp.width,bmp.height)),w=Math.max(1,Math.round(bmp.width*k)),h=Math.max(1,Math.round(bmp.height*k));
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(bmp,0,0,w,h);bmp.close&&bmp.close();
  const enc=(t,q)=>new Promise(r=>cv.toBlob(r,t,q));
  let q=.82,blob=await enc('image/webp',q);
  if(!blob||blob.type!=='image/webp'){const c2=cv.getContext('2d');c2.globalCompositeOperation='destination-over';c2.fillStyle='#fff';c2.fillRect(0,0,w,h);blob=await enc('image/jpeg',q)}
  while(blob&&blob.size>950e3&&q>.35){q-=.15;blob=await enc(blob.type,q)}
  if(!blob||blob.size>1e6)throw new Error('IMG: la imagen es muy pesada');
  return {blob,mime:blob.type,w,h,url:URL.createObjectURL(blob)};
}
const b64=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]||'');r.onerror=rej;r.readAsDataURL(blob)});
let chatAtt=null; // la imagen lista para mandar
const chatViewing=cid=>ready&&cur==='chat'&&chatCur===cid&&!document.hidden&&document.hasFocus();

function chatsLoaded(ch,cm,rd,ms){
  chats=ch.filter(c=>c.team_id===profile.team_id);chatMem=cm;
  reads=Object.fromEntries(rd.map(r=>[r.chat_id,r]));
  msgs={};for(const r of ms){const m=M2X(r);(msgs[m.chat]||(msgs[m.chat]=[])).push(m)}
  for(const k in msgs)msgs[k].sort((a,b)=>a.t-b.t);
  chatInitT=0;
  if(!rd.length&&chats.length){ // la primera vez, lo anterior cuenta como leído
    chatInitT=Date.now();
    const rows=chats.map(c=>{const l=lastMsg(c.id);return {user_id:me,chat_id:c.id,read_at:new Date(l?l.t:0).toISOString(),muted:false}});
    for(const r of rows)reads[r.chat_id]=r;
    sb.from('chat_reads').upsert(rows,{onConflict:'user_id,chat_id'}).then(()=>{},()=>{});
  }
}
// llega un mensaje (en vivo o al ponerme al día)
function msgIn(m){
  if(!chatOf(m.chat)){catchUp(true);return false} // de un chat que todavía no tengo (me sumaron)
  const l=msgs[m.chat]||(msgs[m.chat]=[]);
  if(l.some(x=>x._id===m._id))return false;
  l.push(m);if(l.length>1&&l[l.length-2].t>m.t)l.sort((a,b)=>a.t-b.t);
  chatEvent(m);refresh();
  return true;
}
function msgGone(id){if(!id)return;for(const k in msgs)msgs[k]=msgs[k].filter(m=>m._id!==id);chatSig='';refresh()}
function chatGone(cid){if(!cid)return;chats=chats.filter(c=>c.id!==cid);chatMem=chatMem.filter(x=>x.chat_id!==cid);delete msgs[cid];if(chatCur===cid)chatCur=null;closeToast('ch'+cid);extSocialClose('c:'+cid);refresh()}
// Vitalis escribe en "Toda la mesa" (felicita una venta o anuncia algo): avisa a todos aunque el chat esté silenciado.
let botAsk=0;
function cheerEvent(m,c){
  if(Date.now()-m.t>10*6e4)return;
  const txt=clip(msgTxt(m.body),160);
  toast(`<b>${esc(memberName(m.uid))}</b>: ${esc(txt)}`,'win',{ms:9000,key:'venta'+m._id,actions:chatViewing(c.id)?[]:[{l:'Abrir',fn:()=>go('chat',{chat:c.id})}]});
  if(Date.now()-chatSound>2500){chatSound=Date.now();pop()}
  if(pageAway())extSocial({k:'so:c:'+c.id,v:m._id,lvl:'info',title:'Vitalis en el chat',id:'Toda la mesa',kw:txt,meta:'',btns:[['open','Abrir chat',1],['close','Ok']]});
}
function chatEvent(m){
  if(m.uid===me)return;
  const c=chatOf(m.chat);if(!c)return;
  if(!isBot(m.uid)&&memberName(m.uid)==='—'&&Date.now()-botAsk>6e4){ // alguien que todavía no conozco (la primera venta crea a Vitalis): traigo la lista y sigo
    botAsk=Date.now();Q(sb.from('profiles').select('*').eq('team_id',profile.team_id).order('name')).then(l=>{setMembers(l);chatEvent(m);refresh()}).catch(()=>{});return;
  }
  if(isBot(m.uid)){cheerEvent(m,c);if(chatViewing(c.id))markRead(c.id);return}
  if(chatViewing(c.id)){markRead(c.id);return}
  if(Date.now()-m.t>10*6e4)return; // viejo (al reconectar): queda como no leído, sin aviso
  // silenciar un chat solo calla ese chat; si te nombran, te responden o el team leader escribe @todos / @vos, avisa igual
  const nm_=mentionsMe(m.body),rp=!!m.reply&&(msgById(m.reply)||{}).uid===me,td=todosIn(m.body);
  const force=isLeadUid(m.uid)&&(nm_||td),men=nm_||rp||force;
  if(muted(c.id)&&!men)return;
  const n=unread(c.id),who=first(m.uid),where=c.kind==='dm'?'':` en ${esc(chatName(c))}`,how=nm_?' te nombró':td&&force?' (a todos)':rp?' te respondió':'';
  toast(`<b>${esc(who)}</b>${where}${how}: ${esc(clip(msgTxt(m.body),140))}${n>1?` <span class="dim">· ${n} sin leer</span>`:''}`,force?'imp':'info',{ms:force?15000:9000,key:'ch'+c.id,actions:[{l:'Abrir',fn:()=>go('chat',{chat:c.id})}]});
  if(Date.now()-chatSound>2500){chatSound=Date.now();if(force)beep(1);else pop()}
  if(pageAway())extSocial({k:'so:c:'+c.id,v:m._id,lvl:force?'imp':'info',title:c.kind==='dm'?'Mensaje privado':chatName(c),id:who+how,kw:clip(msgTxt(m.body),200),meta:n>1?`${n} sin leer`:'',btns:[['open','Abrir chat',1],['close','Ok']]});
}
function markRead(cid){
  const l=lastMsg(cid);if(!l)return;
  const r=reads[cid]||(reads[cid]={user_id:me,chat_id:cid,muted:false});
  if(r.read_at&&+new Date(r.read_at)>=l.t)return;
  r.read_at=new Date(l.t).toISOString();
  closeToast('ch'+cid);extSocialClose('c:'+cid);
  clearTimeout(readSave[cid]);readSave[cid]=setTimeout(()=>sb.from('chat_reads').upsert({user_id:me,chat_id:cid,read_at:r.read_at,muted:!!r.muted},{onConflict:'user_id,chat_id'}).then(()=>{},()=>{}),700);
  status();
}
// puesta al día (si el tiempo real se cortó): chats, integrantes y mensajes nuevos
async function chatPoll(){
  if(!ready||!sb)return;
  try{
    let since=0;for(const k in msgs){const l=lastMsg(k);if(l&&l.t>since)since=l.t}
    const [ch,cm,rows]=await Promise.all([
      Q(sb.from('chats').select('*')),
      Q(sb.from('chat_members').select('*')),
      Q(sb.from('messages').select('*').gte('created_at',new Date(since||Date.now()-7*864e5).toISOString()).order('created_at',{ascending:true}).limit(500)),
    ]);
    const keep=new Set(ch.map(c=>c.id));
    for(const c of chats.filter(c=>!keep.has(c.id)))chatGone(c.id);
    chats=ch.filter(c=>c.team_id===profile.team_id);chatMem=cm;
    for(const r of rows)msgIn(M2X(r));
    if(reactOk)try{ // reacciones de la última semana (por si se perdió alguna en vivo)
      const since7=Date.now()-7*864e5,rx=await Q(sb.from('message_reactions').select('message_id,user_id,emoji').gte('created_at',new Date(since7).toISOString()).limit(3000)),map={};
      for(const r of rx)(map[r.message_id]||(map[r.message_id]=[])).push({uid:r.user_id,e:r.emoji});
      let ch_=false;for(const k in msgs)for(const m of msgs[k])if(m.t>since7||map[m._id]){const a_=JSON.stringify(reacts[m._id]||[]),b_=JSON.stringify(map[m._id]||[]);if(a_!==b_&&(map[m._id]||reacts[m._id])){reacts[m._id]=map[m._id]||[];ch_=true}}
      if(ch_)reactVer++;
    }catch(e){}
    refresh();
  }catch(e){}
}

Object.assign(B,{
  async react(mid,e){ // pone o saca mi reacción
    const L=reacts[mid]||(reacts[mid]=[]),had=L.some(x=>x.uid===me&&x.e===e),undo=()=>{const l=reacts[mid]||[];reacts[mid]=had?[...l,{uid:me,e}]:l.filter(x=>!(x.uid===me&&x.e===e));reactVer++;refresh()};
    reacts[mid]=had?L.filter(x=>!(x.uid===me&&x.e===e)):[...L,{uid:me,e}];reactVer++;refresh();
    try{if(had)await Q(sb.from('message_reactions').delete().eq('message_id',mid).eq('user_id',me).eq('emoji',e));else await Q(sb.from('message_reactions').insert({message_id:mid,emoji:e}));return true}
    catch(err){undo();if(/message_reactions|PGRST205|42P01/.test(String(err&&(err.message||err.code))))toast('Las reacciones se activan en un rato (falta actualizar la base).','warn');else if(err&&err.code!=='23505')toast(esc(errMsg(err)),'err');return false}
  },
  async sendImg(cid,att,text,reply){
    try{const [f]=await Q(sb.from('chat_files').insert({chat_id:cid,mime:att.mime,w:att.w,h:att.h,data:await b64(att.blob)}).select('id'));
      imgs[f.id]={url:att.url};
      return await B.sendMsg(cid,`[img:${f.id}:${att.w}x${att.h}]`+(text?' '+text.slice(0,1900):''),reply);
    }catch(e){if(/chat_files|PGRST205|42P01/.test(String(e&&(e.message||e.code))))toast('Las imágenes se activan en un rato (falta actualizar la base).','warn');else dbErr(e);return false}
  },
  async sendMsg(cid,body,reply){
    try{const row=await Q(sb.from('messages').insert(reply?{chat_id:cid,body,reply_to:reply}:{chat_id:cid,body}).select().single());msgIn(M2X(row));markRead(cid);return true}
    catch(e){toast(esc(errMsg(e)),/^SLOW/.test(String(e.message||''))?'warn':'err');return false}
  },
  async delMsg(id){try{await Q(sb.from('messages').delete().eq('id',id));msgGone(id);return true}catch(e){dbErr(e);return false}},
  async chatCreate(nm,people){try{const id=await Q(sb.rpc('chat_create',{nm,people}));await chatPoll();return id}catch(e){toast(esc(errMsg(e)),'err');return null}},
  async chatAdd(cid,people){try{await Q(sb.rpc('chat_add',{cid,people}));await chatPoll();return true}catch(e){toast(esc(errMsg(e)),'err');return false}},
  async chatLeave(cid,uid){
    try{await Q(sb.rpc('chat_leave',{cid,uid:uid||null}));
      if(!uid||uid===me)chatGone(cid);else{chatMem=chatMem.filter(x=>!(x.chat_id===cid&&x.user_id===uid));refresh()}return true}
    catch(e){toast(esc(errMsg(e)),'err');return false}
  },
  async chatRename(cid,nm){try{await Q(sb.rpc('chat_rename',{cid,nm}));const c=chatOf(cid);if(c)c.name=nm.trim().replace(/\s+/g,' ');refresh();return true}catch(e){toast(esc(errMsg(e)),'err');return false}},
  async chatDm(uid){try{const id=await Q(sb.rpc('chat_dm',{uid}));if(!chatOf(id))await chatPoll();return id}catch(e){toast(esc(errMsg(e)),'err');return null}},
  async chatMute(cid,v){
    const l=lastMsg(cid),r=reads[cid]||(reads[cid]={user_id:me,chat_id:cid,read_at:new Date(l?l.t:0).toISOString()});
    try{await Q(sb.from('chat_reads').upsert({user_id:me,chat_id:cid,read_at:r.read_at,muted:v},{onConflict:'user_id,chat_id'}));r.muted=v;refresh();return true}catch(e){dbErr(e);return false}
  },
  async olderMsgs(cid){
    const l=msgs[cid]||(msgs[cid]=[]),o=l[0];
    try{let q=sb.from('messages').select('*').eq('chat_id',cid);if(o)q=q.lt('created_at',o.at);
      const rows=await Q(q.order('created_at',{ascending:false}).limit(100));
      for(const r of rows){const m=M2X(r);if(!l.some(x=>x._id===m._id))l.push(m)}
      l.sort((a,b)=>a.t-b.t);chatMore[cid]=rows.length===100;
      if(reactOk&&rows.length)try{const rx=await Q(sb.from('message_reactions').select('message_id,user_id,emoji').in('message_id',rows.map(r=>r.id)));
        for(const r of rows)reacts[r.id]=[];for(const r of rx)reacts[r.message_id].push({uid:r.user_id,e:r.emoji});reactVer++}catch(e){}
      return rows.length}
    catch(e){dbErr(e);return 0}
  },
});

/* ---------- pantalla ---------- */
function fmtBody(t){
  let h=esc(t);
  h=h.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g,u=>`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  h=h.replace(/(^|\s)@([A-Za-zÀ-ÿ]+)/g,(x,s,n)=>`${s}<span class="ch-at">@${n}</span>`);
  return h.replace(/\n/g,'<br>');
}
function chDay(d){const t=todayS();return d===t?'Hoy':d===addDays(t,-1)?'Ayer':`${DIAL[parseYMD(d).getDay()]} ${dm(d)}`}
function chatIcon(c){
  if(c.kind==='team')return `<span class="ch-ic team"><svg aria-hidden="true"><use href="#mate"/></svg></span>`;
  if(c.kind==='dm')return avatar(memberName(dmOther(c)));
  return `<span class="ch-ic" style="--h:${avHue(c.name)}">${esc(initials(c.name))}</span>`;
}
function growIn(i){i.style.height='auto';i.style.height=Math.min(170,i.scrollHeight+2)+'px'}
function chatNew(){
  const act=members.filter(m=>m.active&&m.id!==me);
  modal({title:'Nuevo chat',body:`<label class="fld"><span>Nombre del grupo</span><input name="nm" maxlength="40" placeholder="Ej.: Los del fondo"></label>
    <p class="note">Elegí una persona para hablar en privado, o varias para armar un grupo.</p>
    <div class="ch-pick">${act.map(m=>`<label class="ch-pk"><input type="checkbox" value="${esc(m.id)}">${avatar(m.name)}<span>${esc(m.name)}</span></label>`).join('')}</div>`,
    actions:[{l:'cancelar'},{l:'crear',cls:'pri',fn:async api=>{
      const ids=[...api.box.querySelectorAll('.ch-pick input:checked')].map(x=>x.value),nm=api.q('[name=nm]').value.trim();
      if(!ids.length){toast('Elegí al menos una persona.','warn');return false}
      if(ids.length===1&&!nm){const id=await B.chatDm(ids[0]);if(id)go('chat',{chat:id});return !!id}
      if(!nm){toast('Ponele un nombre al grupo.','warn');api.q('[name=nm]').focus();return false}
      const id=await B.chatCreate(nm,ids);if(id){go('chat',{chat:id});toast(`Grupo <b>${esc(nm)}</b> creado.`)}return !!id}}]});
}
function chatPeopleModal(c){
  const draw=api=>{
    const ppl=chatPeople(c),own=c.created_by===me,out=members.filter(m=>m.active&&!ppl.includes(m.id));
    api.mb.innerHTML=`<div class="frow"><label class="fld" style="flex:1"><span>Nombre</span><input name="nm" maxlength="40" value="${esc(c.name||'')}"></label><button type="button" class="btn sm" data-g="ren">Guardar</button></div>
      <div class="ch-ppl">${ppl.map(u=>`<div class="ch-pp"><button type="button" class="avb" data-prof="${esc(u)}" title="Ver perfil">${avatar(memberName(u))}</button><span class="nm">${esc(memberName(u))}${u===me?' <span class="dim">(vos)</span>':''}${u===c.created_by?' <span class="dim">· lo creó</span>':''}</span>${own&&u!==me?`<button type="button" class="ib del" data-g="rm" data-u="${esc(u)}">Sacar</button>`:''}</div>`).join('')}</div>
      ${out.length?`<div class="frow" style="margin-top:12px"><select name="add" style="flex:1" aria-label="Sumar a alguien"><option value="">Sumar a…</option>${out.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select><button type="button" class="btn sm" data-g="add">Sumar</button></div>`:''}`;
  };
  modal({title:esc(chatName(c)),body:'',actions:[
      {l:'Salir del grupo',cls:'danger',fn:async()=>{if(!await confirmar('Salir del grupo',`¿Salís de <b>${esc(chatName(c))}</b>?`,'salir',true))return false;const ok=await B.chatLeave(c.id);if(ok)toast(`Saliste de <b>${esc(chatName(c))}</b>.`);return ok}},
      {l:'listo',cls:'pri'}],
    onOpen:api=>{draw(api);api.mb.addEventListener('click',async e=>{const b=e.target.closest('[data-g]');if(!b)return;const g=b.dataset.g;
      if(g==='ren'){const v=api.q('[name=nm]').value;if(await B.chatRename(c.id,v)){toast('Nombre guardado.');api.box.querySelector('.mt').textContent=chatName(c);draw(api)}}
      else if(g==='add'){const v=api.q('[name=add]').value;if(v&&await B.chatAdd(c.id,[v])){toast(`${esc(memberName(v))} se sumó al grupo.`);draw(api)}}
      else if(g==='rm'){const u=b.dataset.u;if(await B.chatLeave(c.id,u)){toast(`Sacaste a ${esc(memberName(u))} del grupo.`);draw(api)}}
    })}});
}

V.chat={
  build(){
    $('#chList').addEventListener('click',e=>{const b=e.target.closest('[data-chat]');if(b)this.open(b.dataset.chat)});
    $('#chNew').addEventListener('click',chatNew);
    $('#chForm').addEventListener('submit',e=>{e.preventDefault();this.send()});
    const i=$('#chIn');
    i.addEventListener('keydown',e=>{
      if(this.menKey(e))return;
      if(e.key==='Escape'&&chatReply){e.preventDefault();e.stopPropagation();this.reply(null);return}
      if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();this.send()}});
    i.addEventListener('input',()=>{if(chatCur)chatDrafts[chatCur]=i.value;growIn(i);this.men()});
    i.addEventListener('click',()=>this.men());
    i.addEventListener('blur',()=>setTimeout(()=>this.men(true),150));
    $('#chMen').addEventListener('mousedown',e=>{const b=e.target.closest('[data-men]');if(!b)return;e.preventDefault();this.menPut(b.dataset.men)});
    $('#chRep').addEventListener('click',e=>{if(e.target.closest('[data-repx]'))this.reply(null)});
    i.addEventListener('paste',e=>{const it=[...(e.clipboardData&&e.clipboardData.items||[])].find(x=>x.kind==='file'&&/^image\//.test(x.type));
      if(!it)return;const f=it.getAsFile();if(!f)return;
      if(!e.clipboardData.types.includes('text/plain'))e.preventDefault();
      this.attFile(f)});
    $('#chPic').addEventListener('click',()=>$('#chFile').click());
    $('#chFile').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];e.target.value='';if(f)this.attFile(f)});
    $('#chAtt').addEventListener('click',e=>{if(e.target.closest('[data-attx]'))this.att(null)});
    const mn=$('#chMain');
    mn.addEventListener('dragover',e=>{if([...(e.dataTransfer&&e.dataTransfer.items||[])].some(x=>x.kind==='file')){e.preventDefault();mn.classList.add('drop')}});
    mn.addEventListener('dragleave',e=>{if(!mn.contains(e.relatedTarget))mn.classList.remove('drop')});
    mn.addEventListener('drop',e=>{mn.classList.remove('drop');const f=[...(e.dataTransfer&&e.dataTransfer.files||[])].find(x=>/^image\//.test(x.type));if(!f)return;e.preventDefault();this.attFile(f)});
    $('#chMsgs').addEventListener('click',async e=>{
      const rx=e.target.closest('[data-rx]');if(rx){B.react(rx.dataset.mid,rx.dataset.rx);return}
      const rp=e.target.closest('[data-reply]');if(rp){const m=msgById(rp.dataset.reply);if(m)this.reply(m);return}
      const pk=e.target.closest('[data-rpick]');if(pk){this.pick(pk);return}
      const q=e.target.closest('[data-goto]');if(q){this.goto(q.dataset.goto);return}
      const pic=e.target.closest('[data-img]');
      if(pic){const x=imgs[pic.dataset.img];if(x&&x.url)imgView(x.url);return}
      const d=e.target.closest('[data-del]');
      if(d){if(await confirmar('Borrar mensaje','¿Lo borro para todos?','borrar',true))B.delMsg(d.dataset.del);return}
      const o=e.target.closest('[data-older]');
      if(o){o.disabled=true;const el=$('#chMsgs'),h=el.scrollHeight;await B.olderMsgs(chatCur);chatSig='';this.render({});el.scrollTop=el.scrollHeight-h}
    });
    $('#chHead').addEventListener('click',async e=>{const b=e.target.closest('[data-ch]');if(!b)return;const c=chatOf(chatCur),a=b.dataset.ch;
      if(a==='back'){chatCur=null;local.set('chatCur',null);this.render({});return}
      if(!c)return;
      if(a==='mute'){const v=!muted(c.id);if(await B.chatMute(c.id,v))toast(v?`Silenciaste <b>${esc(chatName(c))}</b>: no te llegan avisos (salvo que te nombren con @).`:`Avisos de <b>${esc(chatName(c))}</b> activados.`,v?'warn':'ok')}
      else if(a==='people')chatPeopleModal(c);
    });
    $('#chMsgs').addEventListener('scroll',()=>{const el=$('#chMsgs');if(chatCur&&el.scrollHeight-el.scrollTop-el.clientHeight<40&&chatViewing(chatCur))markRead(chatCur)},{passive:true});
  },
  open(cid){
    if(chatReply&&chatReply.chat!==cid)this.reply(null);
    chatCur=cid;local.set('chatCur',cid);chatSig='';this.render({});
    if(chatMore[cid]===undefined&&(msgs[cid]||[]).length<40)B.olderMsgs(cid).then(()=>{chatSig='';if(cur==='chat'&&chatCur===cid)this.render({})});
    setTimeout(()=>{const i=$('#chIn');if(i&&!matchMedia('(pointer:coarse)').matches)i.focus()},0);
  },
  async send(){
    const i=$('#chIn'),v=i.value.trim(),cid=chatCur,att=chatAtt,rep=chatReply&&chatReply.chat===cid?chatReply._id:null;if((!v&&!att)||!cid)return;
    i.value='';chatDrafts[cid]='';growIn(i);this.men(true);const back=chatReply;this.reply(null);
    if(att){this.att(null,true);const sb_=$('#chForm .pri');sb_.disabled=true;
      const ok=await B.sendImg(cid,att,v,rep);sb_.disabled=false;
      if(!ok){this.att(att);this.reply(back);if(!i.value){i.value=v;chatDrafts[cid]=v;growIn(i)}}return}
    const ok=await B.sendMsg(cid,v,rep);
    if(!ok){this.reply(back);if(!i.value){i.value=v;chatDrafts[cid]=v;growIn(i)}}
  },
  reply(m){ // responder a un mensaje
    chatReply=m||null;const el=$('#chRep');el.hidden=!m;
    el.innerHTML=m?`<span class="ic">↩</span><span class="tx">Respondiendo a <b>${esc(m.uid===me?'vos':first(m.uid))}</b>: ${esc(clip(msgTxt(m.body),90))}</span><button type="button" class="ib" data-repx aria-label="No responder">✕</button>`:'';
    if(m)$('#chIn').focus();
  },
  goto(id){ // ir al mensaje respondido
    const el=$('#chMsgs').querySelector(`[data-mid="${CSS.escape(id)}"]`);
    if(!el)return toast('Ese mensaje es más viejo: tocá <b>Ver anteriores</b>.','warn');
    el.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),1400);
  },
  pick(btn){ // elegir una reacción
    document.querySelectorAll('.rx-pick').forEach(x=>x.remove());
    const mid=btn.dataset.rpick,mine=(reacts[mid]||[]).filter(x=>x.uid===me).map(x=>x.e);
    const p=document.createElement('div');p.className='rx-pick';p.setAttribute('role','menu');
    p.innerHTML=EMOJIS.map(e=>`<button type="button" role="menuitem" class="${mine.includes(e)?'on':''}" data-e="${e}" aria-label="Reaccionar ${e}">${e}</button>`).join('');
    document.body.appendChild(p);
    const r=btn.getBoundingClientRect(),w=p.offsetWidth,h=p.offsetHeight;
    p.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left+r.width/2-w/2))+'px';p.style.top=(r.top-h-8<8?r.bottom+8:r.top-h-8)+'px';
    const close=()=>{p.remove();document.removeEventListener('mousedown',out,true);document.removeEventListener('keydown',esc_,true)};
    const out=e=>{if(!p.contains(e.target))close()},esc_=e=>{if(e.key==='Escape'){e.stopPropagation();close()}};
    p.addEventListener('click',e=>{const b=e.target.closest('[data-e]');if(!b)return;B.react(mid,b.dataset.e);close()});
    setTimeout(()=>{document.addEventListener('mousedown',out,true);document.addEventListener('keydown',esc_,true)},0);
    p.querySelector('button').focus();
  },
  /* @ con sugerencias: los del chat (y @todos para el team leader) */
  menState:null,
  men(hide){
    const i=$('#chIn'),box=$('#chMen'),c=chatOf(chatCur);
    const mm=!hide&&c&&i.selectionStart===i.selectionEnd?i.value.slice(0,i.selectionStart).match(/(^|\s)@([A-Za-zÀ-ÿ]{0,20})$/):null;
    if(!mm){this.menState=null;box.hidden=true;return}
    const q=nn(mm[2]),ppl=chatPeople(c).filter(u=>u!==me).map(u=>members.find(m=>m.id===u)).filter(m=>m&&m.active);
    let L=ppl.map(m=>({k:m.name.split(/\s+/)[0],sub:m.name,m})).filter(x=>!q||nn(x.k).startsWith(q)||nn(x.sub).startsWith(q)).sort((a,b)=>a.k.localeCompare(b.k));
    if(profile.role==='leader'&&c.kind!=='dm'&&(!q||'todos'.startsWith(q)))L.unshift({k:'todos',sub:'Avisa a todos los del chat, aunque lo tengan silenciado'});
    L=L.slice(0,7);
    if(!L.length){this.menState=null;box.hidden=true;return}
    const prev=this.menState,sel=prev&&prev.q===q?Math.min(prev.sel,L.length-1):0;
    this.menState={q,L,sel,start:i.selectionStart-mm[2].length-1};
    box.innerHTML=L.map((x,j)=>`<button type="button" role="option" aria-selected="${j===sel}" class="${j===sel?'on':''}" data-men="${j}">${x.m?avatar(x.m.name):'<span class="av all" aria-hidden="true">@</span>'}<span><b>@${esc(x.k)}</b><small>${esc(x.sub)}</small></span></button>`).join('');
    box.hidden=false;
    const mn=$('#chMain').getBoundingClientRect(),top=Math.min(...['#chRep','#chAtt','#chForm'].map(q=>$(q)).filter(x=>!x.hidden).map(x=>x.getBoundingClientRect().top));
    box.style.bottom=Math.max(8,mn.bottom-top+6)+'px';
  },
  menKey(e){
    const st=this.menState;if(!st||$('#chMen').hidden)return false;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();st.sel=(st.sel+(e.key==='ArrowDown'?1:-1)+st.L.length)%st.L.length;
      $$('#chMen [data-men]').forEach((b,j)=>{b.classList.toggle('on',j===st.sel);b.setAttribute('aria-selected',j===st.sel)});return true}
    if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();this.menPut(st.sel);return true}
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.men(true);return true}
    return false;
  },
  menPut(j){
    const st=this.menState,i=$('#chIn');if(!st)return;const x=st.L[+j];if(!x)return;
    const ins='@'+x.k+' ',pos=i.selectionStart;
    i.value=i.value.slice(0,st.start)+ins+i.value.slice(pos);const p=st.start+ins.length;i.setSelectionRange(p,p);
    if(chatCur)chatDrafts[chatCur]=i.value;growIn(i);this.men(true);i.focus();
  },
  att(a,keep){ // la imagen que va con el próximo mensaje
    if(chatAtt&&chatAtt!==a&&!keep)URL.revokeObjectURL(chatAtt.url);
    chatAtt=a;const el=$('#chAtt');el.hidden=!a;
    el.innerHTML=a?`<img src="${a.url}" alt=""><span>Imagen lista · <b>Enviar</b> la manda${a.w?` <span class="dim">(${a.w}×${a.h})</span>`:''}</span><button type="button" class="ib" data-attx aria-label="Sacar la imagen">✕</button>`:'';
    if(a)$('#chIn').focus();
  },
  async attFile(f){
    try{const a=await prepImg(f);this.att(a)}catch(e){toast(esc(errMsg(e)),'err')}
  },
  render(o){
    if(o&&o.chat&&chatOf(o.chat)&&o.chat!==chatCur){this.open(o.chat);return}
    if(chatCur&&!chatOf(chatCur))chatCur=null;
    const wide=matchMedia('(min-width:821px)').matches;
    if(!chatCur&&wide&&teamChat())chatCur=teamChat().id;
    $('#vChat').classList.toggle('open',!!chatCur);
    // lista
    const list=[...chats].sort((a,b)=>(a.kind==='team'?-1:0)-(b.kind==='team'?-1:0)||((lastMsg(b.id)||{t:+new Date(b.created_at)}).t-(lastMsg(a.id)||{t:+new Date(a.created_at)}).t));
    $('#chList').innerHTML=list.map(c=>{const l=lastMsg(c.id),n=unread(c.id),mu=muted(c.id);
      return `<button type="button" class="ch-it${c.id===chatCur?' on':''}${n&&!mu?' un':''}" data-chat="${esc(c.id)}">${chatIcon(c)}<span class="ch-li"><span class="ch-nm">${esc(chatName(c))}${mu?' <span class="q" title="Silenciado"><svg class="ic" aria-hidden="true"><use href="#i-mudo"/></svg></span>':''}</span><span class="ch-pv">${l?`${l.uid===me?'Vos':esc(first(l.uid))}: ${esc(clip(msgTxt(l.body),60))}`:c.kind==='team'?'Toda la mesa junta':'Sin mensajes todavía'}</span></span><span class="ch-mt">${l?`<span class="ch-tm">${l.t>+parseYMD(todayS())?hhmm(l.t):esc(dm(ymd(new Date(l.t))))}</span>`:''}${n?`<span class="nb${mu?'':' hot'}">${n>99?'99+':n}</span>`:''}</span></button>`}).join('')||'<div class="p-empty">Cargando…</div>';
    const c=chatOf(chatCur),i=$('#chIn');
    $('#chMain').hidden=!c;
    if(!chats.length)$('#chList').innerHTML='<div class="p-empty">El chat se está activando. Probá de nuevo en un rato.</div>';
    if(!c){chatSig='';return}
    // encabezado
    const ppl=chatPeople(c),sub=c.kind==='team'?plural(ppl.length,'persona'):c.kind==='dm'?(quiet(members.find(m=>m.id===dmOther(c)))?'<svg class="ic" aria-hidden="true"><use href="#i-mudo"/></svg> avisos silenciados':'Privado'):
      clip(ppl.map(u=>u===me?'vos':first(u)).sort((a,b)=>a==='vos'?1:b==='vos'?-1:a.localeCompare(b)).join(', '),70);
    const hd=`<button type="button" class="ib ch-back" data-ch="back" aria-label="Volver a los chats">←</button>${chatIcon(c)}<div class="ch-ti"><b>${esc(chatName(c))}</b><small>${esc(sub)}</small></div><span class="grow"></span>`+
      (c.kind==='dm'?`<button type="button" class="btn sm" data-prof="${esc(dmOther(c))}">Ver perfil</button>`:'')+
      (c.kind==='group'?`<button type="button" class="btn sm" data-ch="people">Gente</button>`:'')+
      `<button type="button" class="btn sm" data-ch="mute" title="${muted(c.id)?'Volver a recibir avisos de este chat':'No recibir avisos de este chat'}">${muted(c.id)?'<svg class="ic" aria-hidden="true"><use href="#i-campana"/></svg> Activar avisos':'<svg class="ic" aria-hidden="true"><use href="#i-mudo"/></svg> Silenciar'}</button>`;
    if($('#chHead').dataset.h!==hd){$('#chHead').innerHTML=hd;$('#chHead').dataset.h=hd}
    if(i.dataset.c!==c.id){i.dataset.c=c.id;i.value=chatDrafts[c.id]||'';growIn(i);i.placeholder=c.kind==='dm'?`Escribile a ${first(dmOther(c))}`:`Escribí en ${chatName(c)}`}
    // mensajes
    const el=$('#chMsgs'),l=msgs[c.id]||[];
    const sig=c.id+'|'+l.length+'|'+(l.length?l[l.length-1]._id:'')+'|'+chatMore[c.id]+'|'+todayS()+'|'+reactVer;
    if(sig!==chatSig){
      const same=chatSig.split('|')[0]===c.id,atBottom=!same||el.scrollHeight-el.scrollTop-el.clientHeight<90;
      chatSig=sig;
      let h=chatMore[c.id]!==false&&l.length?`<div class="ch-older"><button type="button" class="btn sm" data-older>Ver anteriores</button></div>`:'';
      if(!l.length)h+=`<div class="ch-empty">${c.kind==='team'?'El chat de toda la mesa. Arrancá vos 🧉':c.kind==='dm'?`Tu chat privado con ${esc(first(dmOther(c)))}.`:'Grupo nuevo. Mandá el primero.'}</div>`;
      let pd='',pu=null,pt=0;
      for(const m of l){
        const d=ymd(new Date(m.t));
        if(d!==pd){h+=`<div class="ch-day"><span>${esc(chDay(d))}</span></div>`;pd=d;pu=null}
        const mine=m.uid===me,head=m.uid!==pu||m.t-pt>5*6e4,nm=memberName(m.uid),im=msgImg(m.body);
        const rq=m.reply?msgById(m.reply):null,quote=m.reply?`<button type="button" class="ch-q" data-goto="${esc(m.reply)}" title="Ir al mensaje"><b>${rq?esc(rq.uid===me?'Vos':first(rq.uid)):'Mensaje'}</b><span>${rq?esc(clip(msgTxt(rq.body),90)):'más viejo'}</span></button>`:'';
        const RX=reacts[m._id]||[],grp=EMOJIS.map(e=>({e,u:RX.filter(x=>x.e===e).map(x=>x.uid)})).filter(g=>g.u.length);
        const rxs=grp.length?`<div class="ch-rx">${grp.map(g=>`<button type="button" class="rx${g.u.includes(me)?' on':''}" data-rx="${g.e}" data-mid="${esc(m._id)}" title="${esc(g.u.map(u=>u===me?'vos':first(u)).join(', '))}">${g.e}<b>${g.u.length}</b></button>`).join('')}</div>`:'';
        const tools=`<div class="ch-act"><button type="button" data-reply="${esc(m._id)}" title="Responder" aria-label="Responder">↩</button><button type="button" data-rpick="${esc(m._id)}" title="Reaccionar" aria-label="Reaccionar">☺</button>${mine?`<button type="button" class="del" data-del="${esc(m._id)}" title="Borrar mensaje" aria-label="Borrar mensaje">✕</button>`:''}</div>`;
        h+=`<div class="ch-m${mine?' mine':''}${head?' head':''}" data-mid="${esc(m._id)}">`+
          (mine?'':head?(isBot(m.uid)?`<span class="avb">${avatar(nm)}</span>`:`<button type="button" class="avb" data-prof="${esc(m.uid)}" title="Ver el perfil de ${esc(nm)}">${avatar(nm)}</button>`):'<span class="ch-sp"></span>')+
          `<div class="ch-b">${!mine&&head&&c.kind!=='dm'?(isBot(m.uid)?`<span class="ch-who" style="--h:${avHue(nm)}">${esc(nm)}</span>`:`<button type="button" class="ch-who" data-prof="${esc(m.uid)}" style="--h:${avHue(nm)}">${esc(nm)}</button>`):''}<div class="ch-tx${im?' pic':''}">${quote}${im?`<button type="button" class="ch-img${imgs[im.id]&&imgs[im.id].url?'':' wait'}" data-img="${esc(im.id)}" title="Ver la imagen" style="${im.w?`width:min(100%,${Math.min(300,im.w)}px);aspect-ratio:${im.w}/${im.h}`:''}"><img alt="Imagen"${imgs[im.id]&&imgs[im.id].url?` src="${imgs[im.id].url}"`:''}></button>${im.rest?`<span class="ch-cap">${fmtBody(im.rest)}</span>`:''}`:fmtBody(m.body)}<span class="ch-tm">${hhmm(m.t)}</span></div>${rxs}</div>${tools}</div>`;
        pu=m.uid;pt=m.t;
      }
      el.innerHTML=h;imgPaint(el);
      if(atBottom){el.scrollTop=el.scrollHeight;for(const im of el.querySelectorAll('.ch-img img'))im.addEventListener('load',()=>{if(el.scrollHeight-el.scrollTop-el.clientHeight<400)el.scrollTop=el.scrollHeight},{once:true})}
    }
    if(chatViewing(c.id)&&el.scrollHeight-el.scrollTop-el.clientHeight<90)markRead(c.id);
  },
};

function imgView(url){
  modal({title:'Imagen',wide:true,body:`<div class="imgv"><img src="${url}" alt="Imagen del chat"></div>`,actions:[
    {l:'Copiar',fn:async()=>{try{const im=new Image();im.src=url;await im.decode();const cv=document.createElement('canvas');cv.width=im.naturalWidth;cv.height=im.naturalHeight;cv.getContext('2d').drawImage(im,0,0);
      const png=await new Promise(r=>cv.toBlob(r,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);toast('Imagen copiada: pegala donde quieras.')}catch(e){toast('No se pudo copiar. Usá Descargar.','err')}return false}},
    {l:'Descargar',fn:()=>{const a=document.createElement('a');a.href=url;a.download='vitalis-'+ymd(new Date())+'.webp';document.body.appendChild(a);a.click();a.remove();return false}},
    {l:'Cerrar',cls:'pri'}]});
}
