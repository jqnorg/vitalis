/* ============================================================
   Tareas: el team leader (o el admin) las manda a toda la mesa o a algunos;
   cada uno la marca como hecha. Avisos al instante (acá y en la extensión).
   ============================================================ */
let tkPickMode='all';
const T2X=r=>({_id:r.id,by:r.created_by,what:r.what||'',camps:r.campaigns||[],affs:r.affiliates||[],from:r.date_from||'',to:r.date_to||'',st:r.status||'',notes:r.notes||'',due:r.due||'',at:r.created_at,t:+new Date(r.created_at)});
function tkRows(id){return taskPeople.filter(p=>p.task_id===id)}
function myTk(t){return taskPeople.find(p=>p.task_id===t._id&&p.user_id===me)}
function taskOf(id){return tasks.find(t=>t._id===id)}
function pendingTasks(){return tasks.filter(t=>{const r=myTk(t);return r&&!r.done_at})}
const listTxt=a=>a.length<=1?a.join(''):a.slice(0,-1).join(', ')+' y '+a[a.length-1];
function taskTxt(t){
  const p=[t.what];
  if(t.camps.length)p.push((t.camps.length>1?'las campañas ':'la campaña ')+listTxt(t.camps));
  if(t.affs.length)p.push((t.camps.length?(t.affs.length>1?'de los afiliadores ':'del afiliador '):(t.affs.length>1?'los afiliadores ':'el afiliador '))+listTxt(t.affs));
  if(t.from&&t.to)p.push(t.from===t.to?`del ${dm(t.from)}`:`del ${dm(t.from)} al ${dm(t.to)}`);else if(t.from)p.push(`desde el ${dm(t.from)}`);else if(t.to)p.push(`hasta el ${dm(t.to)}`);
  if(t.st)p.push(`en ${t.st}`);
  return p.join(' ');
}
function dueTxt(d){const t=todayS();return d===t?'hoy':d===addDays(t,1)?'mañana':d<t?`el ${dm(d)}`:`el ${DIAL[parseYMD(d).getDay()]} ${dm(d)}`}
function tkWhen(iso){const m=Math.round((Date.now()-new Date(iso))/6e4);return m<1?'recién':m<60?`hace ${m} min`:m<24*60?`hace ${Math.floor(m/60)} h`:m<48*60?'ayer':`hace ${Math.floor(m/1440)} días`}

function tasksLoaded(tk,tp){tasks=tk.filter(r=>r.team_id===profile.team_id).map(T2X).sort((a,b)=>b.t-a.t);taskPeople=tp}
// aviso de tarea nueva (no lo frena el silencio social: es trabajo)
function taskAlert(t){
  if(Date.now()-t.t>30*6e4)return;
  const who=first(t.by);pop();
  toast(`📋 <b>${esc(who)}</b> te mandó una tarea: ${esc(clip(taskTxt(t),180))}${t.due?` <span class="dim">· para ${esc(dueTxt(t.due))}</span>`:''}`,'alert',{sticky:true,key:'tk'+t._id,actions:[{l:'Ver',fn:()=>go('tareas')},{l:'Ya la hice',fn:()=>B.taskDone(t._id,true)}]});
  if(pageAway())extSocial({k:'so:t:'+t._id,title:'Tarea nueva',id:'De '+who,kw:clip(taskTxt(t),200),meta:t.due?`Para ${dueTxt(t.due)}`:'',btns:[['close','Entendido',1],['r:done','Ya la hice']]});
}
// a quien la mandó: cómo viene (sin sonido, una sola tarjeta por tarea)
function taskProgress(t,uid){
  if(t.by!==me||uid===me)return;
  const rows=tkRows(t._id),n=rows.filter(p=>p.done_at).length;
  if(cur==='tareas'&&!document.hidden)return;
  toast(n===rows.length?`✓ Todos hicieron <b>${esc(clip(taskTxt(t),90))}</b>`:`<b>${esc(first(uid))}</b> hizo <b>${esc(clip(taskTxt(t),90))}</b> <span class="dim">· ${n} de ${rows.length}</span>`,'ok',{ms:7000,key:'tkp'+t._id,actions:[{l:'Ver',fn:()=>go('tareas')}]});
}
function taskGone(id){tasks=tasks.filter(t=>t._id!==id);taskPeople=taskPeople.filter(p=>p.task_id!==id);closeToast('tk'+id);extSocialClose('t:'+id);refresh()}
// en vivo
async function taskRow(ev,r,old){
  if(ev==='DELETE'){taskPeople=taskPeople.filter(p=>!(p.task_id===old.task_id&&p.user_id===old.user_id));refresh();return}
  const ex=taskPeople.find(p=>p.task_id===r.task_id&&p.user_id===r.user_id),was=ex&&ex.done_at;
  if(ex)Object.assign(ex,r);else taskPeople.push(r);
  let t=taskOf(r.task_id);
  if(!t){try{const row=await Q(sb.from('tasks').select('*').eq('id',r.task_id).maybeSingle());if(row){t=T2X(row);if(!taskOf(t._id))tasks.unshift(t)}}catch(e){}}
  if(t&&ev==='INSERT'&&r.user_id===me&&!ex)taskAlert(t);
  if(t&&r.done_at&&!was)taskProgress(t,r.user_id);
  refresh();
}
// puesta al día (si el tiempo real se cortó)
async function taskPoll(){
  if(!ready||!sb)return;
  try{
    const [tk,tp]=await Promise.all([Q(sb.from('tasks').select('*').gte('created_at',new Date(Date.now()-60*864e5).toISOString()).order('created_at',{ascending:false}).limit(300)),Q(sb.from('task_people').select('*').limit(5000))]);
    const prev=new Map(taskPeople.map(p=>[p.task_id+'|'+p.user_id,p])),ids=new Set(tk.map(r=>r.id));
    for(const t of tasks.filter(t=>!ids.has(t._id)))taskGone(t._id);
    tasksLoaded(tk,tp);
    for(const r of tp){const o=prev.get(r.task_id+'|'+r.user_id),t=taskOf(r.task_id);if(!t)continue;
      if(!o&&r.user_id===me)taskAlert(t);
      else if(o&&r.done_at&&!o.done_at)taskProgress(t,r.user_id);}
    refresh();
  }catch(e){}
}

Object.assign(B,{
  async taskCreate(f){
    try{const id=await Q(sb.rpc('task_create',{what:f.what,campaigns:f.camps,affiliates:f.affs,dfrom:f.from||null,dto:f.to||null,st:f.st||null,notes:f.notes||null,due:f.due||null,people:f.people||null}));await taskPoll();return id}
    catch(e){toast(esc(errMsg(e)),'err');return null}
  },
  async taskDone(id,done=true){
    try{await Q(sb.rpc('task_done',{tid:id,done}));
      const r=taskPeople.find(p=>p.task_id===id&&p.user_id===me);if(r)r.done_at=done?new Date().toISOString():null;
      closeToast('tk'+id);extSocialClose('t:'+id);refresh();
      if(done)toast('Tarea hecha ✓','ok',{key:'tkd'+id,actions:[{l:'Deshacer',fn:()=>B.taskDone(id,false)}]});
      return true}
    catch(e){toast(esc(errMsg(e)),'err');return false}
  },
  async taskDel(id){try{await Q(sb.from('tasks').delete().eq('id',id));taskGone(id);return true}catch(e){dbErr(e);return false}},
});
function taskCmd(d){const id=String(d.k||'').replace(/^t:/,'');if(d.r==='done')B.taskDone(id,true)}

/* ---------- pantalla ---------- */
function tkField(lb,vals){
  if(!vals.length)return '';
  return `<div class="tk-f"><span class="lb">${esc(lb)}</span><span class="tk-vals">${vals.map(v=>`<button type="button" class="chip tk-c" data-copy="${esc(v)}" title="Copiar">${esc(v)}</button>`).join('')}</span></div>`;
}
function taskCard(t,mode){ // mine | done | sent
  const rows=tkRows(t._id),n=rows.filter(p=>p.done_at).length,r=myTk(t),te=todayS();
  const late=t.due&&t.due<te&&mode!=='done'&&(mode==='mine'||n<rows.length);
  const fechas=t.from||t.to?[t.from&&t.to?(t.from===t.to?dm(t.from):`${dm(t.from)} → ${dm(t.to)}`):t.from?`desde ${dm(t.from)}`:`hasta ${dm(t.to)}`]:[];
  const head=`<div class="tk-h"><b class="tk-what">${esc(t.what)}</b><span class="tk-meta">${mode==='sent'&&t.by===me?'Mandada':'De '+esc(first(t.by))} ${esc(tkWhen(t.at))}</span>${t.due?`<span class="badge${late?' bad':''}">${late?'Vencida':'Para'} ${esc(dueTxt(t.due))}</span>`:''}</div>`;
  const body=`<div class="tk-fs">${tkField(t.camps.length>1?'Campañas':'Campaña',t.camps)}${tkField(t.affs.length>1?'Afiliadores':'Afiliador',t.affs)}${fechas.length?`<div class="tk-f"><span class="lb">Fechas</span><span class="tk-vals"><span class="tk-v">${esc(fechas[0])}</span></span></div>`:''}${tkField('Status',t.st?[t.st]:[])}</div>${t.notes?`<p class="tk-n">${esc(t.notes)}</p>`:''}`;
  let ft='';
  if(mode==='mine')ft=`<span class="p-sub">${rows.length>1?`${n} de ${rows.length} ya la hicieron`:''}</span><span class="grow"></span><button type="button" class="btn pri" data-ta="done" data-id="${esc(t._id)}">✓ Marcar hecha</button>`;
  else if(mode==='done')ft=`<span class="p-sub">Hecha ${esc(tkWhen(r.done_at))}</span><span class="grow"></span><button type="button" class="ib" data-ta="undo" data-id="${esc(t._id)}">Desmarcar</button>`;
  else{
    const ppl=[...rows].sort((a,b)=>(!!b.done_at-!!a.done_at)||memberName(a.user_id).localeCompare(memberName(b.user_id)));
    ft=`<div class="tk-prog"><div class="tk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${rows.length}" aria-valuenow="${n}"><i style="width:${rows.length?Math.round(n/rows.length*100):0}%"></i></div><b>${n} de ${rows.length}</b></div>
      <div class="tk-ppl">${ppl.map(p=>`<button type="button" class="tk-p${p.done_at?' ok':''}" data-prof="${esc(p.user_id)}" title="${esc(memberName(p.user_id))}${p.done_at?' · hecha '+tkWhen(p.done_at):' · pendiente'}">${p.done_at?'✓':'·'} ${esc(first(p.user_id))}</button>`).join('')}</div>
      <div class="tk-act">${t.by===me||isAdmin()?`<button type="button" class="ib del" data-ta="del" data-id="${esc(t._id)}">Borrar</button>`:''}</div>`;
  }
  return `<article class="tk${mode==='done'?' done':''}${late?' late':''}">${head}${body}<div class="tk-ft">${ft}</div></article>`;
}
function topVals(key,n=8){const c={};for(const f of team){const v=String(f[key]??'').trim();if(v&&!/^(null|undefined|-|0)$/i.test(v))c[v]=(c[v]||0)+1}return Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,n).map(x=>x[0])}
function splitList(v){const seen=new Set();return String(v||'').split(/[,;\n]/).map(x=>x.trim().replace(/\s+/g,' ')).filter(x=>x&&!seen.has(x.toLowerCase())&&seen.add(x.toLowerCase()))}
function taskNew(){
  if(!isLeader())return;
  const act=members.filter(m=>m.active&&m.id!==me),camps=topVals('camp'),affs=topVals('aff');
  const sts=[...new Set(tasks.map(t=>t.st).filter(Boolean))].slice(0,12);
  const sug=(name,vals)=>vals.length?`<div class="tk-sug">${vals.map(v=>`<button type="button" class="chip" data-add="${name}" data-v="${esc(v)}">+ ${esc(v)}</button>`).join('')}</div>`:'';
  const body=`<div class="fgrid">
      <label class="fld"><span>Qué hay que hacer</span><input name="what" maxlength="120" value="Repasar" list="tkWhatL" autocomplete="off"></label>
      <label class="fld"><span>Status en el CRM</span><input name="st" maxlength="60" placeholder="Ej.: No answer" list="tkStL" autocomplete="off"></label>
      <label class="fld full"><span>Campañas <small class="dim">(separadas por coma)</small></span><input name="camps" autocomplete="off">${sug('camps',camps)}</label>
      <label class="fld full"><span>Afiliadores <small class="dim">(separados por coma)</small></span><input name="affs" autocomplete="off">${sug('affs',affs)}</label>
      <label class="fld"><span>Desde</span><input type="date" name="from"></label>
      <label class="fld"><span>Hasta</span><input type="date" name="to"></label>
      <label class="fld full"><span>Notas <small class="dim">(opcional)</small></span><textarea name="notes" rows="2" maxlength="2000"></textarea></label>
      <label class="fld"><span>Para cuándo <small class="dim">(opcional)</small></span><input type="date" name="due" min="${todayS()}"></label>
      <div class="fld"><span>Para</span><span class="seg" id="tkTo"><button type="button" data-to="all" class="on">Toda la mesa</button><button type="button" data-to="pick">Elegir</button></span></div>
    </div>
    <datalist id="tkWhatL"><option value="Repasar"><option value="Llamar"><option value="Recontactar"><option value="Revisar"></datalist>
    <datalist id="tkStL">${sts.map(v=>`<option value="${esc(v)}">`).join('')}</datalist>
    <div class="ch-pick" id="tkPick" hidden>${act.map(m=>`<label class="ch-pk"><input type="checkbox" value="${esc(m.id)}">${avatar(m.name)}<span>${esc(m.name)}</span></label>`).join('')}</div>
    <div class="tk-prev"><span class="lb">Así le llega</span><p id="tkPrev"></p></div><div class="ebox" id="tkE"></div>`;
  const read=api=>({what:api.q('[name=what]').value.trim(),st:api.q('[name=st]').value.trim(),camps:splitList(api.q('[name=camps]').value),affs:splitList(api.q('[name=affs]').value),
    from:api.q('[name=from]').value,to:api.q('[name=to]').value,notes:api.q('[name=notes]').value.trim(),due:api.q('[name=due]').value});
  tkPickMode='all';
  modal({title:'Nueva tarea',wide:true,body,actions:[{l:'Cancelar'},{l:'Mandar',cls:'pri',fn:async api=>{
      const f=read(api),err=t=>{api.q('#tkE').textContent=t;return false};
      if(!f.what)return err('Escribí qué hay que hacer.');
      if(f.from&&f.to&&f.from>f.to)return err('La fecha "desde" es después de "hasta".');
      if(tkPickMode==='pick'){f.people=[...api.box.querySelectorAll('#tkPick input:checked')].map(x=>x.value);if(!f.people.length)return err('Elegí al menos a una persona.')}
      const id=await B.taskCreate(f);if(!id)return false;
      const n=tkRows(id).length;toast(`Tarea mandada a ${tkPickMode==='all'?'toda la mesa':plural(n,'persona')}.`);go('tareas');
    }}],
    onOpen:api=>{
      const prev=()=>{api.q('#tkPrev').textContent=taskTxt({...read(api),what:read(api).what||'…'})};
      api.box.addEventListener('input',prev);prev();
      api.box.addEventListener('click',e=>{
        const a=e.target.closest('[data-add]');
        if(a){const i=api.q(`[name=${a.dataset.add}]`),l=splitList(i.value);if(!l.some(x=>x.toLowerCase()===a.dataset.v.toLowerCase()))l.push(a.dataset.v);i.value=l.join(', ');prev();return}
        const s=e.target.closest('#tkTo [data-to]');
        if(s){tkPickMode=s.dataset.to;api.box.querySelectorAll('#tkTo button').forEach(b=>b.classList.toggle('on',b===s));api.q('#tkPick').hidden=tkPickMode!=='pick'}
      });
      setTimeout(()=>api.q('[name=camps]').focus(),0);
    }});
}

V.tareas={
  build(){
    $('#tkNew').addEventListener('click',taskNew);
    $('#v-tareas').addEventListener('click',async e=>{
      const c=e.target.closest('[data-copy]');
      if(c){try{await navigator.clipboard.writeText(c.dataset.copy);toast(`<b>${esc(c.dataset.copy)}</b> copiado.`)}catch(x){toast('No pude copiar.','err')}return}
      const b=e.target.closest('[data-ta]');if(!b)return;const id=b.dataset.id,a=b.dataset.ta;
      if(a==='done'){b.disabled=true;await B.taskDone(id,true)}
      else if(a==='undo')await B.taskDone(id,false);
      else if(a==='del'){const t=taskOf(id);if(t&&await confirmar('Borrar tarea',`¿Borrar <b>${esc(clip(taskTxt(t),100))}</b> para todos?`,'Borrar',true)&&await B.taskDel(id))toast('Tarea borrada.')}
    });
  },
  render(){
    const lead=isLeader();
    $('#tkNew').hidden=!lead;
    const te=todayS(),mine=pendingTasks().sort((a,b)=>(a.due||'9')<(b.due||'9')?-1:(a.due||'9')>(b.due||'9')?1:b.t-a.t);
    const done=tasks.filter(t=>{const r=myTk(t);return r&&r.done_at}).sort((a,b)=>+new Date(myTk(b).done_at)-+new Date(myTk(a).done_at)).slice(0,20);
    const sent=lead?tasks.filter(t=>t.by===me||!myTk(t)):[];
    $('#tkSub').textContent=lead?'Mandá tareas a la mesa y mirá quién ya las hizo.':'Lo que te pide el team leader. Marcala cuando la termines.';
    let h=`<section class="tk-sec"><h2>Para hacer${mine.length?` <span class="nb hot">${mine.length}</span>`:''}</h2>${mine.length?mine.map(t=>taskCard(t,'mine')).join(''):`<div class="p-empty">${tasks.some(myTk)?'Nada pendiente. 🧉':'Todavía no te mandaron tareas.'}</div>`}</section>`;
    if(done.length)h+=`<details class="tk-sec tk-donel"><summary>Hechas <span class="dim">(${done.length})</span></summary>${done.map(t=>taskCard(t,'done')).join('')}</details>`;
    if(lead)h+=`<section class="tk-sec"><h2>Mandadas</h2>${sent.length?sent.map(t=>taskCard(t,'sent')).join(''):'<div class="p-empty">Todavía no mandaste tareas. Tocá <b>Tarea</b> para mandar la primera.</div>'}</section>`;
    $('#tkList').innerHTML=h;
  },
};
