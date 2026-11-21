/* ============================================================
   Privacidad.
   - Tras un rato sin usar la compu (teclado o mouse en cualquier programa, lo dice la extensión;
     sin extensión, lo que se toque en Vitalis), Vitalis se tapa y pide el PIN. Por detrás sigue
     andando: lo que llega del CRM, los avisos y la estación no se cortan. Recargar no lo destapa.
   - El chat pide el PIN si hace un rato que no lo mirás.
   - Al entrar: la primera vez del día, Inicio; después, directo al Panel.
   Los tiempos los fija el administrador (teams.idle_min y teams.chat_lock_min).
   ============================================================ */
const LK='lock'; // en esta compu, mientras está tapado: {uid, name} (así recargar no lo destapa)
const idleMin=()=>+(teamInfo&&teamInfo.idle_min)||15,chatMin=()=>+(teamInfo&&teamInfo.chat_lock_min)||10;
let locked=false,lkName='',lastAct=Date.now(),chatOkAt=0,chatPadOn=false,chatWant=null;

/* ---------- uso ---------- */
const actNow=()=>{if(!locked)lastAct=Date.now()};
for(const ev of ['pointerdown','keydown','wheel','touchstart'])document.addEventListener(ev,actNow,{capture:true,passive:true});
{let mm=0;document.addEventListener('mousemove',()=>{const t=Date.now();if(t-mm>5e3){mm=t;actNow()}},{passive:true})}
function extIdle(ms){if(typeof ms==='number'&&isFinite(ms)&&ms>=0)lastAct=Math.max(lastAct,Date.now()-ms)} // la extensión: hace cuánto no se toca la compu
function lockCheck(){
  if(!ready||!profile)return;
  if(!locked&&Date.now()-lastAct>=idleMin()*6e4)return lockNow();
  if(!locked&&cur==='chat'&&!chatPadOn&&!document.hidden&&chatOkAt)chatOkAt=Date.now(); // mirando el chat, no se vence
}

/* ---------- tapar y destapar ---------- */
function lockNow(){
  if(locked||!ready||!profile)return;
  locked=true;chatOkAt=0;lkName=profile.name;local.set(LK,{uid:me,name:profile.name});
  try{document.activeElement&&document.activeElement.blur()}catch(e){}
  lockDraw();
}
function lockBoot(uid){const v=local.get(LK,null);if(!v||!uid||v.uid!==uid)return;locked=true;lkName=v.name||'';lockDraw()} // al abrir: si quedó tapado, sigue tapado
function lockClear(){locked=false;local.set(LK,null);document.body.classList.remove('locked');const L=$('#lock');if(L)L.remove()}
function lockDraw(){
  document.body.classList.add('locked');
  let L=$('#lock');if(!L){L=document.createElement('div');L.id='lock';L.setAttribute('role','dialog');L.setAttribute('aria-modal','true');L.setAttribute('aria-label','Vitalis cerrado');document.body.appendChild(L)}
  const nm=(profile&&profile.name)||lkName||'';
  L.innerHTML=`<div class="abox"><div class="brand"><svg class="mark" aria-hidden="true"><use href="#logo"/></svg><span class="word">vitalis</span></div><div class="lk-box"></div></div>`;
  pinPad(L.querySelector('.lk-box'),{
    head:`<div class="who-big">${avatar(nm)}<div><h2>${esc(nm.split(/\s+/)[0]||'Hola')}</h2><p class="lead" style="margin:0">Vitalis se cerró porque no se usó un rato. Poné tu PIN para volver.</p></div></div>`,
    back:['No soy yo',lockOut],
    done:(pin,ui)=>pinCheck(pin,ui,unlock),
  });
}
function unlock(){
  lockClear();lastAct=Date.now();chatOkAt=Date.now();chatPadOff(); // acaba de poner el PIN: el chat también queda abierto
  if(ready){go(landing());status()}
}
async function lockOut(){lockClear();try{await sb.auth.signOut()}catch(e){}location.reload()} // otra persona: sale del todo
// otra pestaña de Vitalis en esta compu se tapó o se destapó
addEventListener('storage',e=>{
  if(e.key!=='vitalis.'+LK)return;let v=null;try{v=JSON.parse(e.newValue)}catch(x){}
  if(v&&v.uid===me&&!locked){locked=true;chatOkAt=0;lkName=v.name||'';lockDraw()}
  else if(!v&&locked){locked=false;document.body.classList.remove('locked');const L=$('#lock');if(L)L.remove();lastAct=Date.now();chatOkAt=Date.now();if(ready){go(landing());status()}}
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

/* ---------- el chat ---------- */
const chatLocked=()=>Date.now()-chatOkAt>chatMin()*6e4;
function chatGate(o){ // true: el chat pide el PIN (se muestra el teclado en vez del chat)
  const C=$('#vChat'),L=$('#chLock');
  if(!chatLocked()){chatOkAt=Date.now();chatPadOff();return false}
  if(o&&o.chat)chatWant=o.chat;
  C.hidden=true;
  if(locked||chatPadOn)return true; // tapado, el teclado es el de Vitalis; y si ya está a la vista, no se borra lo que vas tecleando
  chatPadOn=true;L.hidden=false;
  L.innerHTML=`<div class="abox"><div class="lk-box"></div></div>`;
  pinPad(L.querySelector('.lk-box'),{
    head:`<div class="lk-ic" aria-hidden="true"><svg class="ic"><use href="#i-candado"/></svg></div><h2>Chat</h2><p class="lead">Poné tu PIN para ver el chat.</p>`,
    back:['Volver',()=>{chatPadOff();go('ahora')}],
    done:(pin,ui)=>pinCheck(pin,ui,()=>{chatOkAt=Date.now();chatPadOff();const w=chatWant;chatWant=null;if(cur==='chat')V.chat.render(w?{chat:w}:{})}),
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
function landing(){const k='dia:'+me,te=todayS();if(local.get(k,'')!==te){if(!locked)local.set(k,te);return 'inicio'}return 'ahora'}

/* ---------- Ajustes: los tiempos (solo el administrador) ---------- */
function locksTxt(){return `Vitalis se tapa a los ${idleMin()} min sin usar la compu · el chat pide el PIN a los ${chatMin()} min sin mirarlo`}
function locksModal(){
  if(!isAdmin())return;
  modal({title:'Privacidad',body:`<p class="mp">Tras ese rato sin usar la compu, Vitalis se tapa y pide el PIN (lo que llega del CRM y los avisos siguen andando). El chat pide el PIN si hace ese rato que no lo mirás.</p>
    <div class="fgrid"><label class="fld"><span>Vitalis se tapa a los (minutos)</span><input id="lkI" inputmode="numeric" value="${idleMin()}"></label><label class="fld"><span>El chat pide el PIN a los (minutos)</span><input id="lkC" inputmode="numeric" value="${chatMin()}"></label></div><div class="ebox" id="lkE"></div>`,
    actions:[{l:'Cancelar'},{l:'Guardar',cls:'pri',fn:async api=>{
      const i=parseInt(api.q('#lkI').value,10),c=parseInt(api.q('#lkC').value,10);
      if(!(i>=5&&i<=240)){api.q('#lkE').textContent='Vitalis: entre 5 y 240 minutos.';return false}
      if(!(c>=1&&c<=240)){api.q('#lkE').textContent='El chat: entre 1 y 240 minutos.';return false}
      const r=await B.rpc('set_locks',{idle:i,chat:c});if(!r)return false;teamInfo.idle_min=i;teamInfo.chat_lock_min=c;toast('Listo: '+locksTxt()+'.');refresh()}}]});
}
