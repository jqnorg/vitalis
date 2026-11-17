/* ============================================================
   Social: pedir un mate, salir a los 10 o a la media, mensajes cortos.
   Llegan como aviso (acá y, con la extensión, en cualquier pestaña). Se pueden silenciar.
   ============================================================ */
const KIND={
  mate:{label:'Pedir un mate',ask:'pide un mate 🧉',askTo:'te pide un mate 🧉',replies:[['si','Te lo cebo'],['no','Ahora no']],wait:20*6e4},
  d10:{label:'Salir a los 10',ask:'¿alguien sale a los 10?',askTo:'¿salimos a los 10?',replies:[['si','Dale'],['luego','En 5'],['no','Ahora no']],wait:3*6e4},
  d30:{label:'Salir a la media',ask:'¿alguien sale a la media?',askTo:'¿salimos a la media?',replies:[['si','Dale'],['luego','En 5'],['no','Ahora no']],wait:3*6e4},
  msg:{label:'Mensaje',ask:'',askTo:'',replies:[['si','👍']],wait:15e3},
};
const first=uid=>memberName(uid).split(/\s+/)[0];
const replyTxt=(p,r=p.reply)=>{const k=KIND[p.kind]||KIND.msg;const x=k.replies.find(y=>y[0]===r);return x?x[1]:r};
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
      const txt=`<b>${esc(first(p.by))}</b>: ${esc(replyTxt(p))}${p.kind==='msg'?'':' · '+esc(KIND[p.kind].label.toLowerCase())}`;
      toast(txt,'ok',{ms:9000,key:'sor'+p._id});
      if(!quiet()){pop();if(pageAway())extSocial({k:'so:'+p._id,title:'Te contestaron',id:first(p.by)+': '+replyTxt(p),kw:p.kind==='msg'?p.body:KIND[p.kind].label,meta:'',btns:[['close','Ok',1]]})}
    }
  }
}
function socialGone(id){closeToast('so'+id);extSocialClose(id)}
function socialAlert(p){
  const who=first(p.from),q=askTxt(p),k=KIND[p.kind]||KIND.msg;
  pop();
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
  if(d.cmd==='reply'&&['si','no','luego'].includes(d.r))B.replyPing(id,d.r);
  else if(d.cmd==='quiet')setQuiet(36e5);
}
const pendingForMe=()=>pings.filter(p=>forMe(p)&&!p.reply&&Date.now()-new Date(p.at)<60*6e4).length;
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
    $('#soMsgF').addEventListener('submit',async e=>{e.preventDefault();const i=$('#soMsg'),v=i.value.trim();if(!v)return;
      if(await B.ping('msg',soTo||null,v)){i.value='';toast(`Mensaje enviado ${soTo?'a '+esc(first(soTo)):'a toda la mesa'}.`)}});
    $('#soPeople').addEventListener('click',e=>{const b=e.target.closest('[data-to]');if(!b)return;soTo=soTo===b.dataset.to?'':b.dataset.to;this.render({})});
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
    $('#soPeople').innerHTML=`<div class="so-people">${act.map(m=>`<button type="button" class="so-p${m.id===soTo?' on':''}" data-to="${esc(m.id)}" title="${m.id===soTo?'Volver a toda la mesa':'Pedirle a '+esc(m.name)}">${avatar(m.name)}<span class="nm">${esc(m.name)}</span>${quiet(m)?'<span class="q" title="Avisos silenciados">🔕</span>':''}</button>`).join('')}</div>`;
    const list=pings.filter(p=>Date.now()-new Date(p.at)<24*36e5);
    $('#soCount').textContent=list.length?plural(list.length,'pedido'):'';
    $('#soFeed').innerHTML=list.length?`<div class="so-feed">${list.map(p=>{
      const mine=p.from===me,k=KIND[p.kind]||KIND.msg;
      const st=p.reply?`<span class="badge${p.reply==='si'?' paid':''}">${p.by===me?'Vos':esc(first(p.by))}: ${esc(replyTxt(p))}</span>`
        :mine?`<span class="d">Esperando</span><button type="button" class="ib del" data-pr="del" data-id="${esc(p._id)}">Cancelar</button>`
        :forMe(p)?k.replies.map(([r,l],i)=>`<button type="button" class="${i===0?'btn sm pri':'ib'}" data-pr="${r}" data-id="${esc(p._id)}">${esc(l)}</button>`).join(''):'';
      return `<div class="so-it${forMe(p)&&!p.reply?' new':''}">${avatar(memberName(p.from))}<span class="tx">${feedTxt(p)}<small>${agoTxt(p.at)}</small></span><span class="st">${st}</span></div>`}).join('')}</div>`
      :'<div class="p-empty">Nada por hoy. ¿Arrancás la ronda?</div>';
  },
};

// respaldo del tiempo real: cada 20 s traigo lo social de los últimos 15 min (si el tiempo real anda, no cambia nada)
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
setInterval(socialPoll,20e3);
