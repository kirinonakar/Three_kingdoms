'use strict';
// Exercise recruitment selection and execution with real rules and a DOM stub.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const noop = () => {}, els = {};
const canvas = new Proxy({}, {get:(t,k)=>t[k]||noop,set:(t,k,v)=>(t[k]=v,true)});
const el = id => els[id] ||= {innerHTML:'',textContent:'',value:'',style:{},
  classList:{add:noop,remove:noop,toggle:noop},getContext:()=>canvas};
let roll = 0;
const math = Object.create(Math); math.random = () => roll;
const sandbox = {console,Math:math,document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('_')},
  localStorage:{getItem:()=>null,setItem:noop},setTimeout:()=>0,clearTimeout:noop,confirm:()=>true};
sandbox.window = sandbox; vm.createContext(sandbox);
vm.runInContext(['data.js','combat-rules.js','strategy-systems.js','save-transfer.js','game.js']
  .map(f=>fs.readFileSync(path.join(__dirname,'..','js',f),'utf8')).join('\n')+
  '\nthis.hireChance=hireChance;this.scenarios=SCENARIOS;this.applyLoyaltyChange=applyLoyaltyChange;'+
  'this.honorDefs=OFFICER_HONOR;this.officerDefs=OFFICER_DEFS;this.defaultHonor=defaultOfficerHonor;',sandbox);
const {Game} = sandbox, d = Game._debug, home = '허창';
let g, near, far;
function fresh() {
  roll = .5; Game.startNew('cao','194'); g = Game.state;
  near = g.cities[home].links.find(n=>g.cities[n].owner!=='cao');
  far = Object.keys(g.cities).find(n=>n!==home&&!g.cities[home].links.includes(n));
  assert(near && far);
  // Isolate the candidate list from scenario-specific officers.
  g.officers.filter(o=>o.faction!=='cao').forEach(o=>o.status='hidden');
  roll = 0;
}
function target(name, city, faction='free', status='active') {
  const o = {...g.officers[0],name,city,faction,status,loyalty:40,honor:0,used:false};
  g.officers.push(o); return o;
}

assert.deepEqual(Object.keys(sandbox.honorDefs).sort(),Array.from(sandbox.officerDefs,o=>o[0]).sort(),
  'every canonical officer must have an explicit hand-authored honor value');
assert(Object.values(sandbox.honorDefs).every(n=>Number.isInteger(n)&&n>=0&&n<=100));
assert.equal(sandbox.defaultHonor('관우'),100);assert.equal(sandbox.defaultHonor('여포'),5);
assert.equal(sandbox.defaultHonor('황권'),90);assert.equal(sandbox.defaultHonor('위연'),75);
assert.equal(sandbox.defaultHonor('새이름'),70);assert.equal(sandbox.defaultHonor('다른이름'),70);
console.log('[OK] all 229 officers have explicit historical honor values; legacy custom officers use a fixed default');

for (const scenario of sandbox.scenarios) {
  for (const random of [0,.5,.999999]) {
    roll=random; Game.startNew(scenario.id==='virtual'?'xiangyu':'cao',scenario.id);
    for (const o of Game.state.officers.filter(o=>o.status==='active')) {
      assert.equal(o.honor,sandbox.honorDefs[o.name],scenario.id+': historical honor must stay fixed across scenarios/random rolls');
      if (d.isLeader(o.name)) assert.equal(o.loyalty,100);
      else if (o.faction==='free') assert.equal(o.loyalty,0);
      else assert(o.loyalty>=85 && o.loyalty<=95,scenario.id+': '+o.name+' starting loyalty');
    }
  }
}
console.log('[OK] every scenario starts ordinary faction officers at loyalty 85–95, rulers at 100 and free officers at 0');

fresh();
const persuader={cha:80,pol:70,skill:''}, chance=sandbox.hireChance;
const freeTarget=target('확률재야',home), enemyTarget=target('확률적장',near,'yuan'), prisonerTarget=target('확률포로',home,'yuan','pow');
const originalChance=loyalty=>Math.max(.05,Math.min(.92,.18+80/260+70/480-loyalty/380));
for (const loyalty of [0,40,84,85,89,90,95,100]) {
  freeTarget.loyalty=enemyTarget.loyalty=prisonerTarget.loyalty=loyalty;
  assert.equal(chance(home,freeTarget,persuader),originalChance(loyalty));
  assert.equal(chance(home,enemyTarget,persuader),loyalty>=85?0:originalChance(loyalty)*.45);
  assert.equal(chance(home,prisonerTarget,persuader),chance(home,enemyTarget,persuader),'new prisoners start at the enemy officer probability');
}
enemyTarget.loyalty=40;const lowLoyalty=chance(home,enemyTarget,persuader);
enemyTarget.loyalty=95;assert(chance(home,enemyTarget,persuader)<lowLoyalty);
enemyTarget.loyalty=84;
const previewChance=chance(home,enemyTarget,d.bestAvailable(home));
Game.cmdHire(home);
assert(el('modalRoot').innerHTML.includes(near+' · '+g.factions.yuan.name+' · 성공률 '+Math.round(previewChance*100)+'%'));
roll=previewChance+.001;Game.doHire(enemyTarget.name,home);assert.equal(enemyTarget.faction,'yuan','actual recruitment must use the reduced preview probability');
d.availableOfficers(home).forEach(o=>{o.used=false;});
roll=chance(home,enemyTarget,d.bestAvailable(home))-.001;
Game.doHire(enemyTarget.name,home);assert.equal(enemyTarget.faction,'cao');
console.log('[OK] active enemy recruitment uses 45% of previous odds, loyalty still matters, preview matches execution, new prisoners match enemies');

fresh();
const remoteFree=target('원격재야',near);remoteFree.loyalty=0;
const localFree={...remoteFree,city:home};
const remoteBest=d.bestAvailable(home),friendlyChance=chance(home,localFree,remoteBest);
const remoteChance=chance(home,remoteFree,remoteBest);
assert.equal(remoteChance,friendlyChance*.7);
const remoteOwner=g.cities[near].owner;
g.cities[near].owner='cao';assert.equal(chance(home,remoteFree,remoteBest),friendlyChance,'adjacent friendly cities keep full odds');
g.cities[near].owner=remoteOwner;
Game.cmdHire(home);assert(el('modalRoot').innerHTML.includes(near+' · 재야 · 성공률 '+Math.round(remoteChance*100)+'%'));
roll=(remoteChance+friendlyChance)/2;Game.doHire(remoteFree.name,home);assert.equal(remoteFree.faction,'free');
remoteBest.used=false;roll=remoteChance-.001;Game.doHire(remoteFree.name,home);assert.equal(remoteFree.faction,'cao');
console.log('[OK] free officers in enemy cities use 70% of friendly-city odds in both preview and execution');

fresh();
const loyalEnemy=target('고충성적장',near,'yuan'), lowLoyaltyEnemy=target('등용가능적장',near,'yuan');
lowLoyaltyEnemy.loyalty=84;
const loyalPow=target('고충성포로',home,'yuan','pow');loyalPow.loyalty=95;
for(const loyalty of [85,90,95,100]) for(const honor of [0,100]) {
  loyalEnemy.loyalty=loyalty;loyalEnemy.honor=honor;
  const commands=g.cmd,before=JSON.stringify(g.officers);
  Game.cmdHire(home);
  assert(!el('modalRoot').innerHTML.includes("Game.doHire('고충성적장'"));
  assert(el('modalRoot').innerHTML.includes("Game.doHire('등용가능적장'"));
  assert(el('modalRoot').innerHTML.includes("Game.doHire('고충성포로'"));
  assert.equal(chance(home,loyalEnemy,{cha:100,pol:100,skill:'인덕'}),0);
  Game.doHire(loyalEnemy.name,home);assert.equal(g.cmd,commands);assert.equal(JSON.stringify(g.officers),before);
}
loyalPow.captivityMonths=0;assert.equal(chance(home,loyalPow,persuader),0);
loyalPow.captivityMonths=1;assert(chance(home,loyalPow,persuader)>0);
console.log('[OK] loyalty 85+ active enemies are hidden and cannot be recruited regardless of honor; prisoners still progress with captivity');

fresh();
const honorableEnemy=target('의리적장',near,'yuan'), honorableFree=target('의리재야',home), honorablePow=target('의리포로',home,'yuan','pow');
let priorChance=1;
for (const honor of [0,25,50,75,100]) {
  honorableEnemy.honor=honorableFree.honor=honorablePow.honor=honor;
  const p=chance(home,honorableEnemy,persuader);
  assert(p<priorChance); priorChance=p;
  assert(Math.abs(p-originalChance(40)*.45*(1-honor*.0075))<1e-12);
  assert.equal(chance(home,honorableFree,persuader),originalChance(40));
  assert.equal(chance(home,honorablePow,persuader),p);
  let previous=p;
  const freeChance=chance(home,{...honorableFree,loyalty:0},persuader);
  for(let months=1;months<=8;months++) {
    const current=chance(home,{...honorablePow,captivityMonths:months},persuader);
    assert(current>=previous && current<=freeChance+1e-12);
    if(months>=Math.ceil(3+honor*.03)) assert(Math.abs(current-freeChance)<1e-12);
    else assert(current<freeChance);
    previous=current;
  }
}
honorablePow.captivityMonths=3;honorablePow.honor=0;const lowHonorThreeMonths=chance(home,honorablePow,persuader);
honorablePow.honor=100;assert(chance(home,honorablePow,persuader)<lowHonorThreeMonths);
console.log('[OK] prisoner odds rise monotonically to free officer odds over 3–6 months, with higher honor taking longer');

// Conquering the last city releases existing and newly captured prisoners as ordinary free officers.
fresh();
const orphanPow=g.officers.find(o=>o.name==='안량');
Object.assign(orphanPow,{city:home,status:'pow',loyalty:100,captivityMonths:0});
const distantPow=g.officers.find(o=>o.name==='문추');
Object.assign(distantPow,{city:'성도',status:'pow',loyalty:100,captivityMonths:5});
const newPow=g.officers.find(o=>o.name==='고람');
Object.assign(newPow,{city:'업',status:'active',loyalty:100});
assert.equal(chance(home,orphanPow,persuader),0);
Object.values(g.cities).filter(c=>c.owner==='yuan'&&c.name!=='업').forEach(c=>{c.owner='cao';});
assert.equal(chance(home,orphanPow,persuader),0,'one remaining source city must keep normal prisoner odds');
roll=.99;
d.applyBattleResult({atk:'cao',def:'yuan',from:home,to:'업'},
  {winner:'attacker',atk:[],def:[{name:newPow.name,troops:0}],captured:[newPow.name]});
for(const [released,city] of [[orphanPow,home],[distantPow,'성도'],[newPow,'업']]) {
  assert.equal(released.status,'active');assert.equal(released.faction,'free');assert.equal(released.city,city);
  assert.equal(released.loyalty,0);assert.equal(released.captivityMonths,0);
  const ordinaryFree={...released,name:'일반재야',honor:0};
  assert.equal(chance(home,released,persuader),chance(home,ordinaryFree,persuader));
}
const orphanFreeChance=chance(home,{...orphanPow,name:'일반재야',honor:0},persuader);
const orphanPreview=chance(home,orphanPow,d.bestAvailable(home));
Game.cmdHire(home);
assert(el('modalRoot').innerHTML.includes(home+' · 재야 · 성공률 '+Math.round(orphanPreview*100)+'%'));
const saveData=JSON.parse(JSON.stringify(g));
assert(Game.previewImport(JSON.stringify(saveData)));Game.confirmImport();g=Game.state;
const restored=g.officers.find(o=>o.name==='안량');
assert.equal(restored.status,'active');assert.equal(restored.faction,'free');assert.equal(restored.loyalty,0);
assert.equal(chance(home,restored,persuader),orphanFreeChance);
roll=chance(home,restored,d.bestAvailable(home))/2;Game.doHire(restored.name,home);assert.equal(restored.faction,'cao');
console.log('[OK] faction elimination releases prisoners locally as free officers with normal recruitment odds; release survives saving and recruitment');
// Use evenly distributed rolls to measure actual integer loyalty loss, avoiding flaky statistical tests.
for (const honor of [0,50,100]) {
  const officer={name:'검사무장',honor,loyalty:90};let totalLoss=0;
  for(let i=0;i<100;i++) {
    roll=(i+.5)/100;officer.loyalty=90;sandbox.applyLoyaltyChange(officer,-2);totalLoss+=90-officer.loyalty;
  }
  assert.equal(totalLoss,Math.round(200*(1-honor*.008)));
  roll=0;officer.loyalty=90;sandbox.applyLoyaltyChange(officer,1);assert.equal(officer.loyalty,91);
}
// Run both monthly loyalty paths with the same decline attempt and resistance roll.
const originalRandom=math.random;
for (const status of ['active','pow']) for (const honor of [0,100]) {
  vm.runInContext('G={cities:{},factions:{},leaders:{},pf:null,officers:[]};',sandbox);
  const officer={name:'월간검사',faction:'cao',status,loyalty:90,honor};Game.state.officers.push(officer);
  const rolls=[.1,status==='pow'?.99:0,.5];
  math.random=()=>{assert(rolls.length,'unexpected monthly random draw');return rolls.shift();};
  d.monthlyProcess();assert.equal(officer.loyalty,honor===100?90:status==='pow'?88:89);
  if(status==='pow')assert.equal(officer.captivityMonths,1);
  assert.equal(rolls.length,0);
}
math.random=originalRandom;
console.log('[OK] honor resists monthly active/prisoner loyalty loss; monthly settlement advances captivity once');

// Capturing starts a new clock in both battle outcomes; liberation clears the old clock.
roll=.99;Game.startNew('cao','194');g=Game.state;
const capturedOfficer=g.officers.find(o=>o.name==='하후돈');capturedOfficer.captivityMonths=5;
const battle={atk:'cao',def:'lijue',from:'허창',to:'낙양'};
d.applyBattleResult(battle,{winner:'defender',atk:[{name:capturedOfficer.name,troops:1000}],def:[],captured:[capturedOfficer.name]});
assert.equal(capturedOfficer.status,'pow');assert.equal(capturedOfficer.captivityMonths,0);
capturedOfficer.captivityMonths=4;
d.applyBattleResult(battle,{winner:'attacker',atk:[],def:[],captured:[]});
assert.equal(capturedOfficer.status,'active');assert.equal(capturedOfficer.captivityMonths,0);
g.cities['낙양'].owner='lijue';
const defender=g.officers.find(o=>o.faction==='lijue'&&!d.isLeader(o.name));
defender.city='낙양';defender.captivityMonths=5;
d.applyBattleResult(battle,{winner:'attacker',atk:[],def:[{name:defender.name,troops:0}],captured:[defender.name]});
assert.equal(defender.status,'pow');assert.equal(defender.captivityMonths,0);
console.log('[OK] attacker/defender capture resets captivity and liberation clears the clock');

fresh();
const candidates = [target('현지재야',home),target('현지포로',home,'yuan','pow'),
  target('인접재야',near),target('인접적장',near,'yuan')];
const excluded = [target('먼재야',far),target('먼적장',far,'yuan'),target('인접포로',near,'yuan','pow'),
  target('인접아군',near,'cao'),target('미등장후보',near,'free','hidden'),target('사망후보',near,'yuan','dead')];
const ruler = g.officers.find(o=>o.name==='원소');
Object.assign(ruler,{city:near,status:'active'});
Game.cmdHire(home);
let html = el('modalRoot').innerHTML;
for (const o of candidates) assert(html.includes("Game.doHire('"+o.name+"','"+home+"')"),o.name+' must be selectable with the issuing city');
for (const o of [...excluded,ruler]) assert(!html.includes("Game.doHire('"+o.name+"'"),o.name+' must not be selectable');
assert(html.includes(near+' · '+g.factions.yuan.name+' · 성공률'));
assert(html.includes(near+' · 재야 · 성공률'));
console.log('[OK] local free/prisoner and adjacent free/enemy selection, location/faction labels, ruler/distance/status exclusions');

for (const kind of ['free','enemy','prisoner']) {
  fresh(); const o = target('등용후보',kind==='prisoner'?home:near,kind==='free'?'free':'yuan',kind==='prisoner'?'pow':'active');
  const best = d.bestAvailable(home), commands = g.cmd;
  const enemyUsed = g.officers.filter(x=>x!==o&&x.city===near).map(x=>[x,x.used]);
  Game.cmdHire(home); Game.doHire(o.name,home);
  assert.equal(o.faction,'cao'); assert.equal(o.city,home); assert.equal(o.status,'active');
  assert.equal(o.captivityMonths,0);
  assert(o.loyalty>=70 && o.loyalty<=85); assert(best.used); assert.equal(g.cmd,commands-1);
  for (const [x,used] of enemyUsed) assert.equal(x.used,used,'persuasion must use the issuing city officer');
  Game.doHire(o.name,home); assert.equal(g.cmd,commands-1,'a completed recruitment cannot be replayed');
}
fresh(); let o = target('실패후보',near,'yuan'), best = d.bestAvailable(home), commands = g.cmd;
const previous = {...o}; roll = .99;
Game.doHire(o.name,home);
assert.deepEqual(o,previous); assert(best.used); assert.equal(g.cmd,commands-1);
console.log('[OK] successful candidates join the issuing city; failure retains affiliation/location; both spend one command and the local persuader');

for (const invalid of ['distance','own','hidden','ruler','loyalty','source','exhausted','commands']) {
  fresh(); o = target('변경후보',near,'yuan'); Game.cmdHire(home);
  if (invalid==='distance') o.city=far;
  if (invalid==='own') o.faction='cao';
  if (invalid==='hidden') o.status='hidden';
  if (invalid==='ruler') g.leaders.yuan=o.name;
  if (invalid==='loyalty') o.loyalty=85;
  if (invalid==='source') g.cities[home].owner='yuan';
  if (invalid==='exhausted') d.availableOfficers(home).forEach(x=>x.used=true);
  if (invalid==='commands') g.cmd=0;
  commands=g.cmd; const before=JSON.stringify(g.officers);
  Game.doHire(o.name,home);
  assert.equal(g.cmd,commands,invalid+' must not spend a command');
  assert.equal(JSON.stringify(g.officers),before,invalid+' must not change officers');
}
fresh(); o=target('출발지없는후보',near,'yuan'); commands=g.cmd;
Game.doHire(o.name); assert.equal(g.cmd,commands); assert.equal(o.faction,'yuan');
console.log('[OK] execution revalidates candidate, city ownership, available persuader and command budget');

// Real AI recruitment must distinguish losing our officer from unrelated successful hiring.
const cues=[];sandbox.Sound={sfx:cue=>cues.push(cue),bgm:noop};
for(const kind of ['playerLoss','free','otherFaction','playerDelegation','spectator','failure']) {
  roll=.5;Game.startNew('cao','194');g=Game.state;
  const fid=kind==='playerDelegation'?'cao':'yuan',city=kind==='playerDelegation'?home:'업';
  const previousFaction=kind==='free'?'free':kind==='otherFaction'||kind==='playerDelegation'?'liubei':'cao';
  const hired=target('경고검사무장',city,previousFaction,kind==='free'?'active':'pow');
  hired.captivityMonths=6;
  if(kind==='spectator')g.pf=null;
  const beforeLog=g.log.length;let completed=0;cues.length=0;
  roll=kind==='failure'?.99:0;
  d.execAIAct(fid,{t:'hr',cn:city,name:hired.name},()=>completed++);
  assert.equal(completed,1);
  if(kind==='failure') {
    assert.equal(hired.faction,previousFaction);assert.equal(g.log.length,beforeLog);assert.deepEqual(cues,[]);
  } else {
    assert.equal(hired.faction,fid);
    const entry=g.log.at(-1),lost=kind==='playerLoss';
    assert.equal(entry.c,lost?'bad':'');assert.equal(entry.m.includes('아군 무장'),lost);
    assert.deepEqual(cues,[lost?'fail':'success'],'player loss must play only the warning cue, never the success cue');
    if(lost)assert.match(el('logPanel').innerHTML,/class="logline bad"[^]*아군 무장 경고검사무장/);
  }
}
console.log('[OK] losing a player officer to AI hiring renders a red log and warning sound; unrelated hiring, delegation, spectator and failure do not warn');
