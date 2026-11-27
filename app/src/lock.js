/* ============================================================
   Privacidad: un candado para Vitalis y otro para el chat, a mano (pedido del dueño: nada se tapa solo).
   - El candado de la barra tapa Vitalis y pide el PIN. Por detrás sigue andando: lo que llega del CRM,
     los avisos y la estación no se cortan. Recargar no lo destapa.
   - El candado del chat lo cierra: pide el PIN para verlo, y queda cerrado hasta que lo pongas (también al recargar).
   - Al entrar: la primera vez del día, Inicio; después, directo al Panel.
   ============================================================ */
const LK='lock',CLK='chatLock'; // en esta compu, mientras está tapado: {uid, name} (así recargar no lo destapa); el chat cerrado: uid
let locked=false,lkName='',chatShutOn=false,chatPadOn=false,chatWant=null;
function extIdle(){} // la extensión manda hace cuánto no se usa la compu: ya no se tapa solo (candado a mano)
function lockCheck(){}

/* ---------- tapar y destapar ---------- */
function lockNow(){
  if(locked||!ready||!profile)return;
  locked=true;lkName=profile.name;local.set(LK,{uid:me,name:profile.name});
  try{document.activeElement&&document.activeElement.blur()}catch(e){}
  lockDraw();dockSync();
}
function lockBoot(uid){chatShutOn=local.get(CLK,null)===uid;const v=local.get(LK,null);if(!v||!uid||v.uid!==uid)return;locked=true;lkName=v.name||'';lockDraw()} // al abrir: si quedó tapado (o el chat cerrado), sigue así
function lockClear(){locked=false;local.set(LK,null);document.body.classList.remove('locked');const L=$('#lock');if(L)L.remove()}
function lockDraw(){
  document.body.classList.add('locked');
  let L=$('#lock');if(!L){L=document.createElement('div');L.id='lock';L.setAttribute('role','dialog');L.setAttribute('aria-modal','true');L.setAttribute('aria-label','Vitalis cerrado');document.body.appendChild(L)}
  const nm=(profile&&profile.name)||lkName||'';
  L.innerHTML=`<div class="abox"><div class="brand"><svg class="mark" aria-hidden="true"><use href="#logo"/></svg><span class="word">vitalis</span></div><div class="lk-box"></div></div>`;
  pinPad(L.querySelector('.lk-box'),{
    head:`<div class="who-big">${avatar(nm)}<div><h2>${esc(nm.split(/\s+/)[0]||'Hola')}</h2><p class="lead" style="margin:0">Vitalis está cerrado. Poné tu PIN para volver.</p></div></div>`,
    back:['No soy yo',lockOut],
    done:(pin,ui)=>pinCheck(pin,ui,unlock),
  });
}
function unlock(){
  lockClear();chatOpen();chatPadOff(); // acaba de poner el PIN: el chat también queda abierto
  if(ready){go(landing());status()}
  dockSoon();
}
async function lockOut(){lockClear();postTop({type:'ftd-agenda-dock',v:1,d:{off:1}});try{await sb.auth.signOut()}catch(e){}location.reload()} // otra persona: sale del todo
// otra pestaña de Vitalis en esta compu se tapó o se destapó
addEventListener('storage',e=>{
  if(e.key!=='vitalis.'+LK)return;let v=null;try{v=JSON.parse(e.newValue)}catch(x){}
  if(v&&v.uid===me&&!locked){locked=true;lkName=v.name||'';lockDraw();dockSync()}
  else if(!v&&locked){locked=false;document.body.classList.remove('locked');const L=$('#lock');if(L)L.remove();chatShutOn=false;if(ready){go(landing());status()}}
});
// el PIN se revisa en la base (con el mismo freno de intentos que la entrada)
async function pinCheck(pin,ui,ok){
  const uid=me||(local.get(LK,null)||{}).uid;if(!uid||!sb)return ui.fail('Sin sesión. Recargá la página.');
  ui.busy(true);
  try{
    const {data,error}=await sb.rpc('pin_login',{uid,pin});
    if(error)throw error;
    if(!data||!data.ok){
      if(data&&data.error==='locked')return ui.fail(`Demasiados intentos. Probá de nuevo en ${plural(data.minutes,'minuto')}.`);
      if(data&&data.error==='nouser')return lockOut();
      return ui.fail(data&&data.left<=2?`PIN incorrecto. ${data.left===1?'Te queda 1 intento.':`Te quedan ${data.left} intentos.`}`:'PIN incorrecto.');
    }
    ok();
  }catch(x){ui.fail(authErr(x))}finally{ui.busy(false)}
}

/* ---------- el chat: su candado ---------- */
const chatLocked=()=>chatShutOn;
function chatShutNow(){if(!ready||chatShutOn)return;chatShutOn=true;local.set(CLK,me);chatPadOff();if(cur==='chat')V.chat.render({});else refresh()} // el candado del chat
function chatOpen(){chatShutOn=false;local.set(CLK,null)}
function chatGate(o){ // true: el chat está cerrado y pide el PIN (se muestra el teclado en vez del chat)
  const C=$('#vChat'),L=$('#chLock');
  if(!chatLocked()){chatPadOff();return false}
  if(o&&o.chat)chatWant=o.chat;
  C.hidden=true;
  if(locked||chatPadOn)return true; // tapado, el teclado es el de Vitalis; y si ya está a la vista, no se borra lo que vas tecleando
  chatPadOn=true;L.hidden=false;
  L.innerHTML=`<div class="abox"><div class="lk-box"></div></div>`;
  pinPad(L.querySelector('.lk-box'),{
    head:`<div class="lk-ic" aria-hidden="true"><svg class="ic"><use href="#i-candado"/></svg></div><h2>Chat cerrado</h2><p class="lead">Poné tu PIN para ver el chat.</p>`,
    back:['Volver',()=>{chatPadOff();go('home')}],
    done:(pin,ui)=>pinCheck(pin,ui,()=>{chatOpen();chatPadOff();const w=chatWant;chatWant=null;if(cur==='chat')V.chat.render(w?{chat:w}:{})}),
  });
  return true;
}
function chatPadOff(){ // saca el teclado del chat (su escucha de teclas se apaga sola al no estar en la página)
  chatPadOn=false;
  const L=$('#chLock');if(L&&!L.hidden){L.hidden=true;L.innerHTML=''}const C=$('#vChat');if(C)C.hidden=false;
}
const padUp=()=>locked||chatPadOn; // con un teclado de PIN a la vista, las teclas son para el PIN

/* ---------- a dónde se entra ---------- */
// la primera vez del día, Inicio (tu mes, el turno); después, directo al Panel. Tapado no cuenta: cuenta cuando entrás de verdad.
function landing(){const k='dia:'+me,te=todayS();if(local.get(k,'')!==te){if(!locked)local.set(k,te);return isDirector()?'gerencia':'home'}return isDirector()?'gerencia':'home'} // el team leader, a su Manager; el agente, a su agenda

// Ajustes: ya no hay tiempos (los candados son a mano); queda la línea para que se sepa
function locksTxt(){return 'Nada se bloquea solo: el candado de la barra bloquea Vitalis y el del chat bloquea el chat. Los dos piden tu PIN.'}
