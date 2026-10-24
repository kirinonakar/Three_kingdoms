'use strict';
// Exercise the actual monthly AI pipeline with queued timers, without browser automation.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const noop = () => {}, els = {}, store = {}, timers = new Map();
let clock = 0, timerId = 0, seed = 31, battleStarts = 0;
const math = Object.create(Math);
math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const ctx = new Proxy({}, {get: (t, k) => t[k] || noop, set: (t, k, v) => (t[k] = v, true)});
function el(id) {
  if (els[id]) return els[id];
  const classes = new Set();
  return els[id] = {innerHTML:'', textContent:'', style:{setProperty:noop}, hidden:false,
    classList:{add:k=>classes.add(k), remove:k=>classes.delete(k), contains:k=>classes.has(k), toggle:(k,on)=>on?classes.add(k):classes.delete(k)},
    querySelectorAll:()=>[], getContext:()=>ctx};
}
const sandbox = {console, Math:math,
  document:{getElementById:id=>id.startsWith('off')&&!el('modalRoot').innerHTML.includes('id="'+id+'"')?null:el(id), querySelectorAll:()=>[], createElement:()=>el('_'), body:el('body')},
  localStorage:{getItem:k=>store[k]||null, setItem:(k,v)=>store[k]=String(v), removeItem:k=>delete store[k]},
  setTimeout:(fn,ms=0)=>{const id=++timerId; timers.set(id,{fn,at:clock+ms}); return id;},
  clearTimeout:id=>timers.delete(id), confirm:()=>true,
  Battle:{start:()=>{battleStarts++;}, active:false}};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(['data.js','combat-rules.js','strategy-systems.js','save-transfer.js','game.js']
  .map(f=>fs.readFileSync(path.join(__dirname,'..','js',f),'utf8')).join('\n'), sandbox);
const {Game} = sandbox, d = Game._debug;
function tick() {
  const next = [...timers].sort((a,b)=>a[1].at-b[1].at || a[0]-b[0])[0];
  if (!next) return false;
  timers.delete(next[0]); clock=next[1].at; next[1].fn(); return true;
}
function until(test, label) {
  for(let i=0;i<50000;i++) {if(test())return; assert(tick(),label+' stalled');}
  assert.fail(label+' exceeded timer limit');
}
function drain() {for(let i=0;i<50000;i++) {if(!tick())return;} assert.fail('unexpected continuous automatic play');}
function fresh() {Game.startNew('cao','194'); return Game.state;}

Game.toTitle();
assert.match(el('modalRoot').innerHTML, /전체 AI 관전/);
for (const scenario of ['194','200','208','219','virtual']) {
  Game.chooseScenario(scenario);
  assert(el('modalRoot').innerHTML.includes("Game.startSpectator('"+scenario+"')"));
  Game.startSpectator(scenario);
  const g=Game.state;
  assert.equal(g.pf,null); assert.equal(g.cmd,0); assert.equal(g.cmdMax,0);
  assert.equal(g.scenario,scenario); assert.equal(el('facName').textContent,'전체 AI 관전');
  assert.equal(el('btnCancelDelegation').hidden,true,'spectator has no faction to take over');
  assert.equal(el('btnAutoPlay').hidden,false,'spectator keeps the pause/resume control');
  const turns=24;
  until(()=>g.turn>=turns||g.over,scenario+' observation');
  Game.toggleAutoPlay();
  drain();
  assert(g.turn>=turns || g.over);
  assert.equal(battleStarts,0,'observation must never open tactical player controls');
  assert(!g.ui.defDeploy && !g.battleActive);
  assert(Object.values(g.factions).filter(f=>f.commandTurn!==undefined).length>=2,'every living faction uses AI orders');
  const turn=g.turn; drain(); assert.equal(g.turn,turn,'pause prevents another month');
  Game.openOfficers(); assert.match(el('modalRoot').innerHTML,/무장 일람 — 전체/); Game.closeModal();
  Game.selectCity(null); assert.match(el('cityPanel').innerHTML,/관전할 도시/);
  Game.openPolicies(); assert.match(el('modalRoot').innerHTML,/전체 AI 관전/); Game.closeModal();
  assert.equal(d.parseSaveFile(JSON.stringify(g)).pf,null);
  console.log('[OK] '+scenario+': all-faction observation, '+g.turn+' months, automatic battles and pause');
}

let g=fresh();
Game.openPolicies(); assert.match(el('modalRoot').innerHTML,/전체위임 시작/); Game.closeModal();
g.cmd=1; // A handover after manual orders must retain only the remaining command.
Game.setFullDelegation(true);
assert(g.fullDelegation); assert(!g.autoPaused);
until(()=>g.turn===1,'delegated player month');
assert(g.factions.cao.commands>=0 && g.factions.cao.commands<=1,'handover cannot grant a new command budget');
assert.equal(g.factions.cao.commandTurn,0);
assert.equal(battleStarts,0);
const food=g.factions.cao.food;
Game.confirmSupply('허창',100); assert.equal(g.factions.cao.food,food,'manual orders are blocked during full delegation');
Game.openPolicies();
assert(g.autoPaused,'opening a menu pauses the automatic clock');
assert.match(el('modalRoot').innerHTML,/전체위임 해제/);
drain(); assert.equal(g.turn,1);
Game.setFullDelegation(false); assert(!g.fullDelegation);
const commands=g.cmd;
Game.confirmSupply('허창',100); assert.equal(g.cmd,commands-1,'direct orders resume after releasing delegation');
drain(); assert.equal(g.turn,1,'direct control must not advance automatically');

// Browsing officers temporarily pauses delegation and resumes it on close.
for (const midMonth of [false,true]) {
  g=fresh(); Game.setFullDelegation(true);
  if(midMonth) Game.endTurn();
  Game.openOfficers(); assert(g.autoPaused); drain();
  const browsing=JSON.stringify(g); drain(); assert.equal(JSON.stringify(g),browsing);
  Game.openOfficers(true); Game.openOfficers(false);
  Game.closeModal(); assert(!g.autoPaused,'closing officers must resume running delegation');
  Game.closeModal(); // Repeated close must not replay a saved AI continuation.
  until(()=>g.turn===1,'delegation after closing officers');
  Game.setFullDelegation(false); drain(); assert.equal(g.turn,1);
}
g=fresh(); Game.setFullDelegation(true); Game.endTurn(); Game.toggleAutoPlay(); drain();
Game.openOfficers(); Game.closeModal();
const manuallyPaused=JSON.stringify(g); drain();
assert(g.autoPaused); assert.equal(JSON.stringify(g),manuallyPaused,'an existing explicit pause must remain paused');
Game.setFullDelegation(false); drain();
g=fresh(); Game.setFullDelegation(true); Game.openOfficers();
g=fresh(); const replacement=JSON.stringify(g); drain();
assert.equal(JSON.stringify(g),replacement,'closing an old officer list must not resume a replacement game');
console.log('[OK] officer list close resumes delegation between and during months, preserves explicit pause, and ignores old games');

// Release control at an AI action boundary, with or without pausing first.
for (const paused of [false,true]) {
  g=fresh(); Game.setFullDelegation(true); Game.endTurn();
  assert(g.aiRunning); assert.equal(el('btnCancelDelegation').hidden,false);
  assert.equal(el('btnAutoPlay').hidden,true,'selected faction shows cancellation instead of pause');
  assert.equal(el('btnCancelDelegation').disabled,false,'cancel remains available while AI is running');
  if(paused) {Game.toggleAutoPlay();drain();}
  const turn=g.turn, remaining=g.factions.cao.commands;
  const used=g.officers.filter(o=>o.faction==='cao'&&o.used).map(o=>o.name);
  assert(remaining>0 && remaining<g.cmdMax,'exercise a partially used command budget');
  assert(used.length>0,'AI must have performed an officer action before cancellation');
  Game.setFullDelegation(false); until(()=>!g.aiRunning,'cancel delegation'); drain();
  assert(!g.fullDelegation && !g.autoPaused); assert.equal(g.turn,turn);
  assert.equal(g.cmd,remaining,'return only unspent commands');
  assert.equal(el('btnCancelDelegation').hidden,true); assert.equal(el('btnEndTurn').disabled,false);
  for(const name of used) assert(g.officers.find(o=>o.name===name).used,'cancellation must not reset officer actions');
  const beforeFood=g.factions.cao.food;
  Game.confirmSupply('허창',100);
  assert.equal(g.cmd,remaining-1); assert.equal(g.factions.cao.food,beforeFood+200);
  Game.saveGame(false,3); Game.loadGame(3,'manual'); g=Game.state; drain();
  assert(!g.fullDelegation); assert.equal(g.cmd,remaining-1); assert.equal(g.turn,turn);
  Game.endTurn(); until(()=>g.turn===turn+1,'manual turn after cancellation'); drain();
  assert.equal(g.turn,turn+1,'cancelled callbacks cannot finish an extra month');
}

g=fresh(); Game.setFullDelegation(true); Game.endTurn();
assert(g.aiRunning); Game.toggleAutoPlay(); assert(g.autoPaused);
const pausedTurn=g.turn, pausedState=JSON.stringify(g); drain();
assert.equal(g.turn,pausedTurn); assert.equal(JSON.stringify(g),pausedState,'mid-month pause must stop before the next AI action');
assert(g.fullDelegation); assert.equal(el('btnAutoPlay').textContent,'AI 자동 진행 재개');
Game.toggleAutoPlay(); until(()=>g.turn===2,'resume');
Game.toggleAutoPlay(); drain(); assert.equal(g.turn,2);
Game.saveGame(false,1);
const manual=JSON.parse(store.sangokji_save_v1_manual_slot1);
assert(manual.fullDelegation && manual.autoPaused);
fresh(); Game.loadGame(1,'manual');
g=Game.state; assert(g.fullDelegation && g.autoPaused); drain(); assert.equal(g.turn,2);
Game.toggleAutoPlay(); until(()=>g.turn===3,'resume loaded delegation'); Game.toggleAutoPlay(); drain();

Game.startSpectator('219'); g=Game.state;
until(()=>g.turn===1,'observation save'); Game.toggleAutoPlay();
Game.saveGame(false,2); const raw=store.sangokji_save_v1_manual_slot2;
fresh(); Game.loadGame(2,'manual'); assert.equal(Game.state.pf,null); assert(Game.state.autoPaused);
assert(Game.previewImport(raw)); assert.match(el('modalRoot').innerHTML,/전체 AI 관전/);
Game.confirmImport(); assert.equal(Game.state.pf,null);
Game.toggleAutoPlay(); until(()=>Game.state.turn===2,'imported observation resume'); Game.toggleAutoPlay(); drain();

// Neither pending auto-starts nor mid-month callbacks may advance a title/new game.
Game.startSpectator(); g=Game.state; Game.toTitle(); drain(); assert.equal(g.turn,0);
Game.startSpectator(); g=Game.state; Game.endTurn(); assert(g.aiRunning);
Game.toTitle(); const snapshot=JSON.stringify(g); drain(); assert.equal(JSON.stringify(g),snapshot);
assert(el('body').classList.contains('title'));
Game.startSpectator(); Game.endTurn(); g=fresh(); const initial=JSON.stringify(g); drain();
assert.equal(JSON.stringify(g),initial,'stale callbacks must not mutate the replacement game');

// A faction being eliminated does not end observation; the final unifier does.
Game.startSpectator('194'); g=Game.state;
Object.values(g.cities).forEach(c=>{if(c.owner==='cao')c.owner='yuan';});
Game.endTurn(); until(()=>g.turn===1,'eliminated faction'); Game.toggleAutoPlay();
assert(!g.over,'observer has no player defeat condition'); drain();
Object.values(g.cities).forEach(c=>c.owner='yuan');
Game.toggleAutoPlay(); until(()=>g.over,'observation victory'); drain();
assert.match(el('modalRoot').innerHTML,/천하통일!/);
assert.match(el('modalRoot').innerHTML,/원소/);
assert.equal(el('btnAutoPlay').disabled,true);
assert.equal(battleStarts,0);

// Save normalization rejects malformed mode flags and preserves old files.
g=fresh(); const old=JSON.parse(JSON.stringify(g)); delete old.fullDelegation; delete old.autoPaused;
assert.equal(d.parseSaveFile(JSON.stringify(old)).pf,'cao');
old.fullDelegation='true'; assert.throws(()=>d.parseSaveFile(JSON.stringify(old)),/위임 설정/);
console.log('[OK] handover budget, manual return, pause/resume, save/import, stale timers, and spectator victory');

g=fresh(); Game.setFullDelegation(true);
const defenseBudget=Object.values(g.cities).filter(c=>c.owner==='lijue').length+2;
let defended=0;
d.execAIAct('lijue',{t:'attack',cn:'낙양',target:'허창',troops:3000},()=>defended++);
until(()=>defended===1,'delegated defense in first month');
assert(!g.ui.defDeploy && !g.battleActive);
assert.equal(g.factions.lijue.commands,defenseBudget-1,'delegation disables the player-only initial attack protection');
until(()=>g.turn>=24||g.over,'long player delegation');
if(!g.over) Game.toggleAutoPlay(); drain();
assert.equal(battleStarts,0,'delegated player must never need a manual tactical battle');
console.log('[OK] full delegation handles early defense and 24 months without player prompts');

// Use the real RAF intro controller to reproduce the full-screen wait/input lock.
// Only canvas drawing is stubbed; no browser or computer-use APIs are used.
Game.startSpectator('194'); g=Game.state;
sandbox.requestAnimationFrame=fn=>sandbox.setTimeout(()=>fn(clock),16);
sandbox.cancelAnimationFrame=id=>timers.delete(id);
sandbox.introCanvas={width:1200,height:1000,isConnected:true}; sandbox.introContext=ctx;
vm.runInContext('cvM=introCanvas;ctxM=introContext;drawMap=()=>{};renderCityPanel=()=>{};',sandbox);
let completed=0; g.aiRunning=true;
d.execAIAct('cao',{t:'attack',cn:'허창',target:'낙양',troops:4000},()=>{completed++;g.aiRunning=false;});
assert.equal(el('attackIntro').hidden,false,'real intro must be running');
assert(el('attackIntro').classList.contains('automated'));
assert.equal(el('app').inert,false,'autoplay intro must leave pause button interactive');
assert.equal(el('btnAutoPlay').disabled,false);
tick(); // Include an animation frame before the user pauses.
Game.toggleAutoPlay();
assert.equal(el('attackIntro').hidden,true,'pausing removes the wait overlay immediately');
assert.equal(el('app').inert,false);
const frozen=JSON.stringify(g); drain();
assert.equal(JSON.stringify(g),frozen); assert.equal(completed,0,'battle continuation must remain paused');
Game.toggleAutoPlay(); until(()=>completed===1,'resume paused intro battle');
Game.toggleAutoPlay(); drain(); assert.equal(completed,1,'resume must resolve the committed battle exactly once');
console.log('[OK] animated attack pause: toolbar stays interactive, overlay clears immediately, battle resumes once');

// Cancelling during a committed attack settles it once before returning command.
vm.runInContext(`
  const originalCancelCandidates=aiActionCandidates, originalCancelFinish=finishBattle;
  let cancelledBattles=0;
  aiActionCandidates=(fid,ledger)=>fid==='cao'&&!ledger['attack:허창']?
    [{t:'attack',cn:'허창',target:'낙양',troops:4000}]:[];
  finishBattle=(ctx,result)=>{cancelledBattles++;originalCancelFinish(ctx,result);};
`,sandbox);
for(const paused of [false,true]) {
  g=fresh(); Game.setFullDelegation(true); Game.endTurn();
  assert(g.ui.attackIntro); assert.equal(el('btnCancelDelegation').disabled,false);
  const beforeBattles=vm.runInContext('cancelledBattles',sandbox), beforeStarts=battleStarts;
  const remaining=g.factions.cao.commands;
  if(paused) {Game.toggleAutoPlay();drain();}
  Game.setFullDelegation(false); until(()=>!g.aiRunning,'cancel committed attack'); drain();
  assert(!g.fullDelegation && !g.ui.attackIntro); assert.equal(g.turn,0);
  assert.equal(g.cmd,remaining); assert.equal(battleStarts,beforeStarts);
  assert.equal(vm.runInContext('cancelledBattles',sandbox),beforeBattles+1);
  const afterCancel=JSON.stringify(g); drain(); assert.equal(JSON.stringify(g),afterCancel);
}
vm.runInContext('aiActionCandidates=originalCancelCandidates;finishBattle=originalCancelFinish;',sandbox);
console.log('[OK] selected-faction cancellation restores unspent commands, keeps used officers, and settles committed attacks once');

// A field choice after the invasion preview needs both armies meeting in the middle.
g=fresh();timers.clear();
const beforeField=battleStarts;
const fieldCtx={atk:'cao',def:'lijue',from:'허창',to:'낙양',introShown:true,siege:false};
const fieldUnit=(name,troops)=>({officer:g.officers.find(o=>o.name===name),troops,branch:'보병',form:'어린',training:80,morale:80});
const arrowStyles={};el('attackIntro').style.setProperty=(key,value)=>{arrowStyles[key]=value;};
d.beginBattle(fieldCtx,[fieldUnit('하후돈',4000)],[fieldUnit('이각',4000)],'atk',false);
assert.equal(g.ui.attackIntro.kind,'intercept');assert.equal(g.ui.attackIntro.from,'허창');assert.equal(g.ui.attackIntro.to,'낙양');
assert.equal(g.ui.attackIntro.faction,'cao');assert.equal(arrowStyles['--attack-color'],g.factions.cao.color);
assert.match(el('attackIntro').textContent,/야전 요격.*허창.*→ ⚔ ←.*낙양/);
assert.equal(battleStarts,beforeField,'field battle must wait for the intercept animation');
tick();tick();
assert(vm.runInContext('attackIntro.progress>0&&attackIntro.progress<1',sandbox),'intercept arrow must animate over time');
const arrowMoves=[],arrowTips=[],arrowColors=[];
sandbox.arrowDrawing=new Proxy({moveTo:(x,y)=>arrowMoves.push({x,y}),translate:(x,y)=>arrowTips.push({x,y}),
  stroke:()=>arrowColors.push(sandbox.arrowDrawing.strokeStyle)},{get:(t,k)=>t[k]||noop,set:(t,k,v)=>(t[k]=v,true)});
vm.runInContext('drawAttackIntro(arrowDrawing)',sandbox);
const attacking=vm.runInContext("screenFromWorld(G.cities['허창'].x,G.cities['허창'].y)",sandbox);
const defending=vm.runInContext("screenFromWorld(G.cities['낙양'].x,G.cities['낙양'].y)",sandbox);
assert(arrowMoves.some(p=>p.x===attacking.x&&p.y===attacking.y),'attack arrow starts at the attacking city');
assert(arrowMoves.some(p=>p.x===defending.x&&p.y===defending.y),'defense arrow starts at the defending city');
assert(arrowColors.includes(g.factions.cao.color)&&arrowColors.includes(g.factions.lijue.color),'both faction colors must be drawn');
assert.equal(arrowTips.length,2,'both arrowheads advance in the same animation frame');
arrowTips.length=0;
vm.runInContext('attackIntro.progress=1;attackIntro.elapsed=820;drawAttackIntro(arrowDrawing)',sandbox);
assert.equal(arrowTips.length,2);
for(const tip of arrowTips) {
  assert.equal(tip.x,(attacking.x+defending.x)/2,'arrows collide at the midpoint horizontally');
  assert.equal(tip.y,(attacking.y+defending.y)/2,'arrows collide at the midpoint vertically');
}
assert(arrowColors.includes('#ffe3a0'),'collision must draw the flash');
until(()=>battleStarts===beforeField+1,'intercept animation completes');
assert.equal(el('attackIntro').hidden,true);assert(!g.ui.attackIntro);assert(fieldCtx.interceptShown);
assert.equal(fieldCtx.defReserve,1000,'animation reentry must not withhold reserves twice');
console.log('[OK] field interception: both faction arrows animate from their cities, meet at the same midpoint with a flash, and start the battle once');
