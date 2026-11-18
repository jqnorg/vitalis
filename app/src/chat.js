/* ============================================================
   Chat: toda la mesa, grupos y privados. En vivo, con no leídos y avisos
   (acá y, con la extensión, en la pestaña que estés). Se silencia por chat.
   ============================================================ */
let chatCur=local.get('chatCur',null),chatSig='',chatSound=0,chatInitT=0;
const chatDrafts={},chatMore={},readSave={};
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
function chatEvent(m){
  if(m.uid===me)return;
  const c=chatOf(m.chat);if(!c)return;
  if(chatViewing(c.id)){markRead(c.id);return}
  if(Date.now()-m.t>10*6e4)return; // viejo (al reconectar): queda como no leído, sin aviso
  const men=mentionsMe(m.body);
  if(quiet()||(muted(c.id)&&!men))return;
  const n=unread(c.id),who=first(m.uid),where=c.kind==='dm'?'':` en ${esc(chatName(c))}`;
  toast(`<b>${esc(who)}</b>${where}${men?' te nombró':''}: ${esc(clip(m.body,140))}${n>1?` <span class="dim">· ${n} sin leer</span>`:''}`,'ok',{ms:9000,key:'ch'+c.id,actions:[{l:'Abrir',fn:()=>go('chat',{chat:c.id})}]});
  if(Date.now()-chatSound>2500){chatSound=Date.now();pop()}
  if(pageAway())extSocial({k:'so:c:'+c.id,v:m._id,title:c.kind==='dm'?'Mensaje privado':chatName(c),id:who+(men?' te nombró':''),kw:clip(m.body,200),meta:n>1?`${n} sin leer`:'',btns:[['open','Abrir chat',1],['close','Ok']]});
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
    refresh();
  }catch(e){}
}

Object.assign(B,{
  async sendMsg(cid,body){
    try{const row=await Q(sb.from('messages').insert({chat_id:cid,body}).select().single());msgIn(M2X(row));markRead(cid);return true}
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
      l.sort((a,b)=>a.t-b.t);chatMore[cid]=rows.length===100;return rows.length}
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
    i.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();this.send()}});
    i.addEventListener('input',()=>{if(chatCur)chatDrafts[chatCur]=i.value;growIn(i)});
    $('#chMsgs').addEventListener('click',async e=>{
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
    chatCur=cid;local.set('chatCur',cid);chatSig='';this.render({});
    if(chatMore[cid]===undefined&&(msgs[cid]||[]).length<40)B.olderMsgs(cid).then(()=>{chatSig='';if(cur==='chat'&&chatCur===cid)this.render({})});
    setTimeout(()=>{const i=$('#chIn');if(i&&!matchMedia('(pointer:coarse)').matches)i.focus()},0);
  },
  async send(){
    const i=$('#chIn'),v=i.value.trim(),cid=chatCur;if(!v||!cid)return;
    i.value='';chatDrafts[cid]='';growIn(i);
    const ok=await B.sendMsg(cid,v);
    if(!ok&&!i.value){i.value=v;chatDrafts[cid]=v;growIn(i)}
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
      return `<button type="button" class="ch-it${c.id===chatCur?' on':''}${n&&!mu?' un':''}" data-chat="${esc(c.id)}">${chatIcon(c)}<span class="ch-li"><span class="ch-nm">${esc(chatName(c))}${mu?' <span class="q" title="Silenciado">🔕</span>':''}</span><span class="ch-pv">${l?`${l.uid===me?'Vos':esc(first(l.uid))}: ${esc(clip(l.body,60))}`:c.kind==='team'?'Toda la mesa junta':'Sin mensajes todavía'}</span></span><span class="ch-mt">${l?`<span class="ch-tm">${l.t>+parseYMD(todayS())?hhmm(l.t):esc(dm(ymd(new Date(l.t))))}</span>`:''}${n?`<span class="nb${mu?'':' hot'}">${n>99?'99+':n}</span>`:''}</span></button>`}).join('')||'<div class="p-empty">Cargando…</div>';
    const c=chatOf(chatCur),i=$('#chIn');
    $('#chMain').hidden=!c;
    if(!chats.length)$('#chList').innerHTML='<div class="p-empty">El chat se está activando. Probá de nuevo en un rato.</div>';
    if(!c){chatSig='';return}
    // encabezado
    const ppl=chatPeople(c),sub=c.kind==='team'?plural(ppl.length,'persona'):c.kind==='dm'?(quiet(members.find(m=>m.id===dmOther(c)))?'🔕 avisos silenciados':'Privado'):
      clip(ppl.map(u=>u===me?'vos':first(u)).sort((a,b)=>a==='vos'?1:b==='vos'?-1:a.localeCompare(b)).join(', '),70);
    const hd=`<button type="button" class="ib ch-back" data-ch="back" aria-label="Volver a los chats">←</button>${chatIcon(c)}<div class="ch-ti"><b>${esc(chatName(c))}</b><small>${esc(sub)}</small></div><span class="grow"></span>`+
      (c.kind==='dm'?`<button type="button" class="btn sm" data-prof="${esc(dmOther(c))}">Ver perfil</button>`:'')+
      (c.kind==='group'?`<button type="button" class="btn sm" data-ch="people">Gente</button>`:'')+
      `<button type="button" class="btn sm" data-ch="mute" title="${muted(c.id)?'Volver a recibir avisos de este chat':'No recibir avisos de este chat'}">${muted(c.id)?'🔔 Activar avisos':'🔕 Silenciar'}</button>`;
    if($('#chHead').dataset.h!==hd){$('#chHead').innerHTML=hd;$('#chHead').dataset.h=hd}
    if(i.dataset.c!==c.id){i.dataset.c=c.id;i.value=chatDrafts[c.id]||'';growIn(i);i.placeholder=c.kind==='dm'?`Escribile a ${first(dmOther(c))}`:`Escribí en ${chatName(c)}`}
    // mensajes
    const el=$('#chMsgs'),l=msgs[c.id]||[];
    const sig=c.id+'|'+l.length+'|'+(l.length?l[l.length-1]._id:'')+'|'+chatMore[c.id]+'|'+todayS();
    if(sig!==chatSig){
      const same=chatSig.split('|')[0]===c.id,atBottom=!same||el.scrollHeight-el.scrollTop-el.clientHeight<90;
      chatSig=sig;
      let h=chatMore[c.id]!==false&&l.length?`<div class="ch-older"><button type="button" class="btn sm" data-older>Ver anteriores</button></div>`:'';
      if(!l.length)h+=`<div class="ch-empty">${c.kind==='team'?'El chat de toda la mesa. Arrancá vos 🧉':c.kind==='dm'?`Tu chat privado con ${esc(first(dmOther(c)))}.`:'Grupo nuevo. Mandá el primero.'}</div>`;
      let pd='',pu=null,pt=0;
      for(const m of l){
        const d=ymd(new Date(m.t));
        if(d!==pd){h+=`<div class="ch-day"><span>${esc(chDay(d))}</span></div>`;pd=d;pu=null}
        const mine=m.uid===me,head=m.uid!==pu||m.t-pt>5*6e4,nm=memberName(m.uid);
        h+=`<div class="ch-m${mine?' mine':''}${head?' head':''}">`+
          (mine?'':head?`<button type="button" class="avb" data-prof="${esc(m.uid)}" title="Ver el perfil de ${esc(nm)}">${avatar(nm)}</button>`:'<span class="ch-sp"></span>')+
          `<div class="ch-b">${!mine&&head&&c.kind!=='dm'?`<button type="button" class="ch-who" data-prof="${esc(m.uid)}" style="--h:${avHue(nm)}">${esc(nm)}</button>`:''}<div class="ch-tx">${fmtBody(m.body)}<span class="ch-tm">${hhmm(m.t)}</span></div></div>`+
          (mine?`<button type="button" class="ch-del" data-del="${esc(m._id)}" title="Borrar mensaje" aria-label="Borrar mensaje">✕</button>`:'')+`</div>`;
        pu=m.uid;pt=m.t;
      }
      el.innerHTML=h;
      if(atBottom)el.scrollTop=el.scrollHeight;
    }
    if(chatViewing(c.id)&&el.scrollHeight-el.scrollTop-el.clientHeight<90)markRead(c.id);
  },
};
