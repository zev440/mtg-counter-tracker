const STORAGE_KEY="mtg-counter-tracker-v2";
let state={creatures:[],effects:[],history:[],undoStack:[],selectedCreatureId:null};

const $=s=>document.querySelector(s);
const uid=p=>`${p}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
const clone=x=>JSON.parse(JSON.stringify(x));
const fmt=n=>Number.isInteger(n)?String(n):String(Number(Number(n).toFixed(4)));

function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify({creatures:state.creatures,effects:state.effects,history:state.history}));}
function load(){try{const x=JSON.parse(localStorage.getItem(STORAGE_KEY));if(x){state.creatures=x.creatures||[];state.effects=x.effects||[];state.history=x.history||[];}}catch(e){console.error(e)}}
function snap(){state.undoStack.push({creatures:clone(state.creatures),effects:clone(state.effects),history:clone(state.history)});if(state.undoStack.length>100)state.undoStack.shift();}
function undo(){if(!state.undoStack.length)return;const x=state.undoStack.pop();state.creatures=x.creatures;state.effects=x.effects;state.history=x.history;state.selectedCreatureId=null;save();render();}
function log(text){state.history.unshift({id:uid("h"),time:new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit",second:"2-digit"}),text});if(state.history.length>100)state.history.pop();}
function toast(t){const x=$("#messageToast");x.textContent=t;x.classList.remove("hidden");clearTimeout(toast.timer);toast.timer=setTimeout(()=>x.classList.add("hidden"),2200)}
function creature(id){return state.creatures.find(x=>x.id===id)}
function selected(){return creature(state.selectedCreatureId)}
function effectText(e){return e.type==="add"?`+${fmt(e.amount)}`:`×${fmt(e.amount)}`}

/*
  Replacement engine:
  Each replacement effect is used at most once for a single event.
  The engine evaluates all possible orders (for the small number of
  effects expected in play) and chooses the maximum final amount.
  Multipliers use floor(), including custom multipliers below 1.
*/
function replacementResult(start,effects){
  const usable=effects.filter(e=>Number.isFinite(e.amount));
  if(start<=0||!usable.length)return{amount:Math.max(0,Math.floor(start)),order:[]};

  if(usable.length>10)return greedy(start,usable);

  const memo=new Map();
  function search(amount,remaining){
    if(!remaining.length)return{amount:Math.max(0,Math.floor(amount)),order:[]};
    const key=`${amount}|${remaining.join(",")}`;
    if(memo.has(key))return memo.get(key);
    let best=null;
    for(let i=0;i<remaining.length;i++){
      const idx=remaining[i],e=usable[idx];
      let next=e.type==="add"?amount+e.amount:Math.floor(amount*e.amount);
      next=Math.max(0,Math.floor(next));
      const rest=remaining.filter((_,j)=>j!==i);
      const tail=search(next,rest);
      const candidate={amount:tail.amount,order:[e,...tail.order]};
      if(!best||candidate.amount>best.amount)best=candidate;
    }
    memo.set(key,best);return best;
  }
  return search(Math.max(0,Math.floor(start)),usable.map((_,i)=>i));
}
function greedy(start,effects){
  const ordered=[...effects].sort((a,b)=>{
    const ar=a.type==="add"?0:1,br=b.type==="add"?0:1;
    return ar-br || b.amount-a.amount;
  });
  let amount=Math.max(0,Math.floor(start));
  for(const e of ordered)amount=Math.max(0,Math.floor(e.type==="add"?amount+e.amount:amount*e.amount));
  return{amount,order:ordered};
}
function orderText(order){return order.length?order.map(e=>`${e.name} (${effectText(e)})`).join(" → "):"none";}

function place(creature,requested,description){
  if(!creature||requested<=0)return;
  snap();
  const r=replacementResult(requested,state.effects);
  creature.counters+=r.amount;
  log(`${description}: ${fmt(requested)} would be added → ${fmt(r.amount)} added. Order: ${orderText(r.order)}.`);
  save();render();
}
function addOne(){const c=selected();if(!c)return toast("Select a creature first.");place(c,1,`+1 Counter on ${c.name}`)}
function proliferate(){
  if(!state.creatures.length)return;
  snap();const d=[];
  for(const c of state.creatures){const r=replacementResult(1,state.effects);c.counters+=r.amount;d.push(`${c.name}: +${r.amount}`)}
  log(`Proliferate: ${d.join("; ")}.`);save();render();
}
function doubleOne(){
  const c=selected();if(!c)return toast("Select a creature first.");
  if(c.counters<=0)return toast(`${c.name} has no counters to double.`);
  place(c,c.counters,`Double counters on ${c.name}`);
}
function doubleAllOnce(){
  const targets=state.creatures.filter(c=>c.counters>0);
  const d=[];
  for(const c of targets){const r=replacementResult(c.counters,state.effects);c.counters+=r.amount;d.push(`${c.name}: +${r.amount}`)}
  return d;
}
function doubleAll(){
  if(!state.creatures.length)return;
  const repeat=$("#repeatDoubleToggle").checked?Math.max(1,Math.min(100,Math.floor(Number($("#repeatDoubleCount").value)||1))):1;
  if(!state.creatures.some(c=>c.counters>0))return toast("No creature currently has counters to double.");
  snap();const rounds=[];
  for(let i=1;i<=repeat;i++){const d=doubleAllOnce();rounds.push(`Round ${i}: ${d.join("; ")}`)}
  log(`Double All ×${repeat}: ${rounds.join(" | ")}`);
  save();render();
}
function adjustCounters(id,delta){
  const c=creature(id);if(!c)return;
  if(delta>0)return place(c,delta,`Manual counter addition on ${c.name}`);
  const n=Math.min(c.counters,Math.abs(delta));if(!n)return;
  snap();c.counters-=n;log(`Removed ${n} counter${n===1?"":"s"} from ${c.name}.`);save();render();
}
function damageModal(id){$("#damageCreatureId").value=id;$("#damageAmount").value=1;openModal("damageModal")}
function applyDamage(e){
  e.preventDefault();const c=creature($("#damageCreatureId").value),n=Math.max(0,Math.floor(Number($("#damageAmount").value)));
  if(!c||n<=0)return;snap();c.damage=(c.damage||0)+n;log(`${c.name} takes ${n} damage; ${c.damage} damage marked.`);save();closeModal("damageModal");render();
}
function clearDamage(id){const c=creature(id);if(!c||!c.damage)return;snap();const n=c.damage;c.damage=0;log(`Cleared ${n} damage from ${c.name}.`);save();render()}
function removeCreature(id){
  const c=creature(id);if(!c)return;if(!confirm(`Remove ${c.name}?`))return;
  snap();state.creatures=state.creatures.filter(x=>x.id!==id);if(state.selectedCreatureId===id)state.selectedCreatureId=null;log(`Removed ${c.name}.`);save();render();
}
function addCreature(e){
  e.preventDefault();const name=$("#creatureName").value.trim();if(!name)return;
  const adam=$("#adamantoiseMode").checked;
  snap();
  const c={id:uid("c"),name,counters:Math.max(0,Math.floor(Number($("#creatureCounters").value)||0)),basePower:Number($("#creaturePower").value)||0,baseToughness:Number($("#creatureToughness").value)||0,adamantoise:adam,power:adam?(Number($("#adamantoisePower").value)||0):(Number($("#creaturePower").value)||0),damage:0};
  state.creatures.push(c);state.selectedCreatureId=c.id;log(`Added ${name}.`);save();closeModal("creatureModal");e.target.reset();$("#creatureCounters").value=0;$("#creaturePower").value=0;$("#creatureToughness").value=0;$("#adamantoisePower").value=0;toggleAdamantoise();render();
}
function addEffect(e){
  e.preventDefault();const name=$("#effectName").value.trim(),type=$("#effectType").value,amount=Number($("#effectAmount").value);
  if(!name||!Number.isFinite(amount))return;
  if(type==="multiply"&&amount<0)return toast("Multipliers must be 0 or greater.");
  snap();state.effects.push({id:uid("e"),name,type,amount});log(`Added ${name} (${effectText(state.effects.at(-1))}).`);save();closeModal("effectModal");e.target.reset();$("#effectAmount").value=1;updateExplanation();render();
}
function effectCount(id,delta){
  const e=state.effects.find(x=>x.id===id);if(!e)return;snap();
  if(delta>0)state.effects.push({...clone(e),id:uid("e")});
  else{const i=state.effects.findIndex(x=>x.id===id);state.effects.splice(i,1)}
  log(`${delta>0?"Added another":"Removed one"} ${e.name}.`);save();render();
}
function deleteEffectGroup(first){
  snap();state.effects=state.effects.filter(e=>!(e.name===first.name&&e.type===first.type&&e.amount===first.amount));log(`Removed all ${first.name} effects.`);save();render();
}
function reset(){
  if(!confirm("Reset the entire battlefield, effects, and history?"))return;snap();state.creatures=[];state.effects=[];state.history=[];state.selectedCreatureId=null;save();render();
}
function openModal(id){$(`#${id}`).classList.remove("hidden")}
function closeModal(id){$(`#${id}`).classList.add("hidden")}
function toggleAdamantoise(){$("#adamantoiseFields").classList.toggle("hidden",!$("#adamantoiseMode").checked)}
function updateExplanation(){
  const t=$("#effectType").value,a=Number($("#effectAmount").value);
  $("#effectExplanation").textContent=t==="add"?`N becomes N + ${Number.isFinite(a)?fmt(a):"N"}.`:`N becomes floor(N × ${Number.isFinite(a)?fmt(a):"N"}).`;
}

function renderBattlefield(){
  const box=$("#battlefield");box.innerHTML="";$("#emptyBattlefield").classList.toggle("hidden",state.creatures.length>0);
  for(const c of state.creatures){
    const p=c.adamantoise?c.power:c.basePower+c.counters,t=c.baseToughness+c.counters,d=c.damage||0;
    const card=document.createElement("article");card.className=`creature-card ${state.selectedCreatureId===c.id?"selected":""}`;
    card.innerHTML=`<div class="creature-top"><div><h3 class="creature-name"></h3>${c.adamantoise?'<span class="creature-badge">SEPARATE POWER / DAMAGE</span>':""}</div><button class="icon-button remove">×</button></div>
      <div class="pt-display">${fmt(p)} / ${fmt(t)}</div>
      <div class="stat-grid"><div class="stat"><span class="stat-label">Counters</span><span class="stat-value">${fmt(c.counters)}</span></div><div class="stat"><span class="stat-label">Damage</span><span class="stat-value">${c.adamantoise?fmt(d):"—"}</span></div></div>
      <div class="creature-actions"><button class="button button-primary add">+1 Counter</button><button class="button button-secondary minus">−1 Counter</button>${c.adamantoise?'<button class="button button-secondary dmg">+ Damage</button><button class="button button-secondary clear">Clear Damage</button>':'<button class="button button-secondary select full">Select</button>'}</div>`;
    card.querySelector(".creature-name").textContent=c.name;
    card.querySelector(".remove").onclick=e=>{e.stopPropagation();removeCreature(c.id)};
    card.querySelector(".add").onclick=e=>{e.stopPropagation();state.selectedCreatureId=c.id;addOne()};
    card.querySelector(".minus").onclick=e=>{e.stopPropagation();state.selectedCreatureId=c.id;adjustCounters(c.id,-1)};
    if(c.adamantoise){card.querySelector(".dmg").onclick=e=>{e.stopPropagation();state.selectedCreatureId=c.id;damageModal(c.id)};card.querySelector(".clear").onclick=e=>{e.stopPropagation();clearDamage(c.id)}}else card.querySelector(".select").onclick=e=>{e.stopPropagation();state.selectedCreatureId=c.id;render()};
    card.onclick=()=>{state.selectedCreatureId=c.id;render()};box.appendChild(card);
  }
}
function renderEffects(){
  const box=$("#effectsList");box.innerHTML="";$("#emptyEffects").classList.toggle("hidden",state.effects.length>0);
  const groups=new Map();
  for(const e of state.effects){const k=`${e.name}|${e.type}|${e.amount}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e)}
  for(const g of groups.values()){
    const f=g[0],row=document.createElement("div");row.className="effect-row";
    row.innerHTML=`<div class="effect-info"><div class="effect-name"></div><div class="effect-description"></div></div><div class="effect-controls"><button class="icon-button minus">−</button><span class="count-badge">${g.length}</span><button class="icon-button plus">+</button><button class="icon-button del">×</button></div>`;
    row.querySelector(".effect-name").textContent=f.name;row.querySelector(".effect-description").textContent=effectText(f);
    row.querySelector(".minus").onclick=()=>effectCount(f.id,-1);row.querySelector(".plus").onclick=()=>effectCount(f.id,1);row.querySelector(".del").onclick=()=>{if(confirm(`Remove all ${f.name} effects?`))deleteEffectGroup(f)};
    box.appendChild(row);
  }
}
function renderHistory(){
  const box=$("#history");box.innerHTML="";$("#emptyHistory").classList.toggle("hidden",state.history.length>0);
  for(const h of state.history){const x=document.createElement("div");x.className="history-entry";x.innerHTML='<div class="history-time"></div><div></div>';x.querySelector(".history-time").textContent=h.time;x.lastElementChild.textContent=h.text;box.appendChild(x)}
}
function render(){
  renderBattlefield();renderEffects();renderHistory();
  const has=state.creatures.length>0,sel=!!selected();
  $("#addCounterBtn").disabled=!sel;$("#doubleOneBtn").disabled=!sel;$("#proliferateBtn").disabled=!has;$("#doubleAllBtn").disabled=!has;$("#undoBtn").disabled=!state.undoStack.length;
}
function wire(){
  $("#addCreatureBtn").onclick=()=>{ $("#creatureForm").reset();$("#creatureCounters").value=0;$("#creaturePower").value=0;$("#creatureToughness").value=0;$("#adamantoisePower").value=0;toggleAdamantoise();openModal("creatureModal") };
  $("#addEffectBtn").onclick=()=>{ $("#effectForm").reset();$("#effectAmount").value=1;updateExplanation();openModal("effectModal") };
  $("#addCounterBtn").onclick=addOne;$("#proliferateBtn").onclick=proliferate;$("#doubleOneBtn").onclick=doubleOne;$("#doubleAllBtn").onclick=doubleAll;$("#undoBtn").onclick=undo;$("#resetGameBtn").onclick=reset;
  $("#creatureForm").onsubmit=addCreature;$("#effectForm").onsubmit=addEffect;$("#damageForm").onsubmit=applyDamage;
  $("#adamantoiseMode").onchange=toggleAdamantoise;$("#effectType").onchange=updateExplanation;$("#effectAmount").oninput=updateExplanation;
  $("#repeatDoubleToggle").onchange=()=>$("#repeatCountWrap").classList.toggle("hidden",!$("#repeatDoubleToggle").checked);
  document.querySelectorAll(".close-modal").forEach(b=>b.onclick=()=>closeModal(b.dataset.modal));
  document.querySelectorAll(".damage-preset").forEach(b=>b.onclick=()=>$("#damageAmount").value=b.dataset.value);
  document.querySelectorAll(".modal").forEach(m=>m.onclick=e=>{if(e.target===m)m.classList.add("hidden")});
  document.onkeydown=e=>{if(e.key==="Escape")document.querySelectorAll(".modal").forEach(m=>m.classList.add("hidden"))};
}
load();wire();render();
