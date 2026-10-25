'use strict';
// Deterministic probes run the real rules; browser rendering and timers are stubbed.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..'), els = {}, noop = () => {};
const ctx = new Proxy({ createLinearGradient: () => ({ addColorStop: noop }),
  createRadialGradient: () => ({ addColorStop: noop }) },
  { get: (t, k) => t[k] || noop, set: (t, k, v) => (t[k] = v, true) });
const el = id => els[id] || (els[id] = {
  innerHTML: '', textContent: '', value: '', style: {}, handlers: {},
  classList: { add: noop, remove: noop, toggle: noop },
  addEventListener(t, f) { this.handlers[t] = f; }, getContext: () => ctx,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 572, height: 396 })
});
let random = () => .5, timers = false, pendingTimers = null;
const math = Object.create(Math); math.random = () => random();
const sandbox = { console, Math: math,
  document: { getElementById: el, querySelectorAll: () => [], createElement: () => el('_') },
  localStorage: { getItem: () => null, setItem: noop },
  setTimeout: (fn, ms) => { if (pendingTimers) pendingTimers.push({fn, ms}); else if (timers) fn(); return 0; }, clearTimeout: noop
};
sandbox.window = sandbox;
vm.createContext(sandbox);
const marker = '    start, act, setStrat, setForm, reinforce, retreatTo, clickCell, observation,';
const battle = fs.readFileSync(process.env.BALANCE_BATTLE_SOURCE || path.join(root, 'js/battle.js'), 'utf8');
assert(battle.includes(marker), 'battle probe insertion point changed');
vm.runInContext(['data.js', 'combat-rules.js', 'strategy-systems.js', 'save-transfer.js', 'game.js', 'battle-terrain.js'].map(f =>
  fs.readFileSync(f==='combat-rules.js'&&process.env.BALANCE_RULES_SOURCE?process.env.BALANCE_RULES_SOURCE:path.join(root, 'js', f), 'utf8')).join('\n') + '\n' +
  battle.replace(marker, '    probe: { renderPanel, calcDamage, doFireArrow, doStratAct, doDuel, duelTargets, roundStart, timeUp, end, tryAct, checkForts, syncForts, fortDuty, chargeOptions, attackAct, doCharge, attackTargets, volleyPartners, doVolley, moveRange, costField, fordPath },\n' + marker), sandbox);
const { Game, Battle } = sandbox, p = Battle.probe;
const rules=vm.runInContext('CombatRules',sandbox);
const officer = (name, wu = 80, zhi = 80) => ({ name, wu, zhi, pol: 80, cha: 80, skill: '' });
const unit = (name, troops, branch = '보병') => ({ officer: officer(name), troops, branch, training: 80, morale: 80, form: '안행' });
function setup(atk = [unit('A', 3000)], def = [unit('D', 3000)], onEnd = noop) {
  Game.startNew('cao');
  Battle.start({ siege: false, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
    atk: { name: '공격', color: '#444', units: atk }, def: { name: '수비', color: '#888', units: def }, onEnd });
  const b = Battle.state;
  b.terrain = Array.from({ length: 9 }, () => Array(13).fill(0)); b.forts = [];
  b.geo={...b.geo,terrain:b.terrain,rivers:[],lakes:[],crossings:[],edgeFords:[]};
  b.units.forEach((u, i) => { u.x = 4 + i; u.y = 4; });
  return b;
}
if (!process.argv.includes('--simulate-only')) {
// The low-defense range must never be weakened by the new high-defense curve.
for(let defense=0;defense<=50;defense++)assert.equal(rules.cityDefenseMultiplier(defense),1+defense/400);
for(let defense=1;defense<=100;defense++)assert(rules.cityDefenseMultiplier(defense)>=rules.cityDefenseMultiplier(defense-1));
assert.equal(rules.cityDefenseMultiplier(0),1);
assert.equal(rules.cityDefenseMultiplier(50),1.125);
assert.equal(rules.cityDefenseMultiplier(100),1.38);
assert.equal(rules.cityDefenseMultiplier(-20),1);
assert.equal(rules.cityDefenseMultiplier(200),1.38);
const guard=unit('guard',3000),attacker=unit('attacker',3000);
assert(rules.damage(attacker,guard,{cityDef:100})<rules.damage(attacker,guard,{cityDef:50}));
assert(rules.power(guard,[guard],{cityDef:100})>rules.power(guard,[guard],{cityDef:50}));
console.log('[OK] unchanged defense 0–50, monotonic high fortification, shared tactical damage and strategic estimates');
let b = setup(), a = b.units[0], d = b.units[1];
const damage = {};
for (const n of [1, 100, 500, 1000, 3000, 6000, 10000]) {
  a.troops = a.max = n; damage[n] = p.calcDamage(a, d);
}
// Current troop count, rather than the initial allocation, must determine strength.
a.troops = 500; a.max = 10000; const depletedDamage = p.calcDamage(a, d);
Game.startNew('cao');
let city = Game.state.cities['허창']; city.training = 100; city.morale = 35;
const cmdBefore = Game.state.cmd;
Game.cmdTrain(city.name);
const trainingAllowed = !!Game.state.ui.pick;
if (trainingAllowed) { Game.togglePick(Game.state.ui.pick.list[0]); Game.confirmPick(); }
const moraleRecovery = city.morale - 35;
const trainingSpent = cmdBefore - Game.state.cmd;
const trainerUsed = Game.state.officers.some(o => o.city === city.name && o.used);

b = setup([unit('A', 3000), unit('ally', 3000)]); a = b.units[0]; d = b.units[1];
random = () => .99; d.morale = 20;
p.doStratAct(a, d, '고무'); const boostAtHighRoll = d.morale - 20;
random = () => 0;
b = setup(); a = b.units[0]; d = b.units[1];
p.doDuel(a, d); const duelRepeatTargets = p.duelTargets(a).length;
// A 100-man detachment must not burn thousands with a fixed-strength stratagem.
b = setup([unit('A', 100)], [unit('D', 10000)]); a = b.units[0]; d = b.units[1];
p.doStratAct(a, d, '화계'); const tinyFireDamage = 10000 - d.troops;
let result;
b = setup([unit('A', 3000), unit('lost', 3000)], [unit('D', 3000)], r => { result = r; });
b.units[1].alive = false; b.units[1].troops = 0;
timers = true; p.end('defender'); timers = false;
const reportsLost = result.atk.some(u => u.name === 'lost' && u.troops === 0);
console.log(JSON.stringify({ damage, depletedDamage, trainingAllowed, moraleRecovery,
  boostAtHighRoll, duelRepeatTargets, tinyFireDamage, reportsLost }, null, 2));
if (process.argv.includes('--report')) process.exit(0);
assert(damage[100] < damage[3000] * .05, 'tiny units retain full damage');
assert(damage[1000] * 3 <= damage[3000] + 3, 'splitting a normal unit creates damage');
assert(damage[6000] > damage[3000] && damage[10000] < damage[3000] * 2, 'large units need a diminishing strength advantage');
assert.equal(depletedDamage, damage[500], 'initial allocation changes equal surviving forces');
assert(trainingAllowed && moraleRecovery >= 5, 'veteran army cannot recover morale');
assert.equal(trainingSpent, 1, 'training must consume a command');
assert(trainerUsed, 'training must consume the officer action');
assert.equal(boostAtHighRoll, 18, 'guaranteed inspiration randomly fails');
assert.equal(duelRepeatTargets, 0, 'player can spam duels while AI cannot');
assert(tinyFireDamage < 100, 'tiny unit retains full fire stratagem damage');
assert(reportsLost, 'destroyed officers disappear from campaign result');
console.log('[OK] troop strength, recovery, inspiration, duel parity, small-force tactics, destroyed roster');

// A human can answer on either army's turn; the popup exposes the real unit values.
for (const playerSide of ['atk','def']) for (const accept of [false,true]) for (const troops of [333,3000]) {
  b=setup([unit('Enemy Challenger',troops)],[unit('Friendly Defender',4321)]);
  a=b.units[0];d=b.units[1];
  a.side=playerSide==='atk'?'def':'atk';d.side=playerSide;
  b.playerSide=playerSide;b.side=a.side;b.sel=a;
  a.officer.wu=91;d.officer.wu=77;a.morale=83;d.morale=86;
  p.doDuel(a,d);
  assert(b.duelRequest&&b.busy,'challenge must pause for the human response');
  assert(a.acted&&a.dueled,'the request must consume the challenger action and one challenge');
  assert.equal(d.troops,4321);assert.equal(d.morale,86);
  const html=els.bDuelPrompt.innerHTML;
  for(const value of ['role="dialog"','아군','적군','Enemy Challenger','Friendly Defender','91','77','83','86','4,321',troops===333?'333':'3,000','수락','거부'])
    assert(html.includes(value),'duel popup missing '+value);
  const observation=Battle.observation();
  assert.equal(observation.duelRequest.refusalMoraleLoss,Math.round(25*Math.min(1,troops/1000))*2);
  assert(observation.tiles.every(t=>t.action===null),'board input must pause while awaiting a response');
  Battle.act('auto');Battle.act('nextTurn');Battle.act('retreat');
  assert(!b.auto&&b.duelRequest&&!b.over,'other commands must not bypass the response');
  Battle.act(accept?'duelAccept':'duelRefuse');
  assert.equal(b.duelRequest,null);assert.equal(els.bDuelPrompt.innerHTML,'');
  assert.equal(!!b.duelScene,accept,'only accepted duels show the portrait animation');
  assert.equal(!!els.bDuelScene.innerHTML,accept);
  const scale=Math.min(1,troops/1000);
  assert.equal(d.troops,accept?4321-Math.round(4321*.1*scale):4321);
  assert.equal(d.morale,86-Math.round(25*scale)*(accept?1:2));
  assert(!d.acted,'answering a challenge must not consume the defender action');
  assert.equal(a.morale,accept?93:83,'refusal must not grant a duel victory bonus');
  const after=[a.troops,a.morale,d.troops,d.morale];
  Battle.act('duelRefuse');Battle.act('duelAccept');
  assert.deepEqual([a.troops,a.morale,d.troops,d.morale],after,'duplicate response applied twice');
  assert.equal(p.duelTargets(a).length,0,'refused challenges must still consume the single request');
}
// Refusal at low morale can rout a unit, but must never remove its soldiers.
b=setup();a=b.units[0];d=b.units[1];b.playerSide='def';d.morale=20;
p.doDuel(a,d);Battle.act('duelRefuse');
assert.equal(d.morale,0);assert.equal(d.troops,3000);assert(!d.alive);
// AI uses the same refusal penalty; auto mode resolves human-side responses too.
for(const auto of [false,true]) {
  b=setup();a=b.units[0];d=b.units[1];a.officer.wu=100;d.officer.wu=30;
  b.auto=auto;if(auto)b.playerSide='def';
  p.doDuel(a,d);
  assert.equal(b.duelRequest,null);assert.equal(d.troops,3000);assert.equal(d.morale,30);
  assert(b.log.some(line=>line.includes('거부했습니다')));
}
console.log('[OK] duel accept/refuse on both armies, comparison popup, paused inputs, double scaled morale loss, no refusal troop loss, AI responses');

// Both outcomes must use the actual winner, hold all input, and finish before play resumes.
for (const roll of [0,.99]) for (const auto of [false,true]) {
  b=setup([unit('하후돈',3000),unit('ally',3000)],[unit('이각',3000)]);
  a=b.units[0];d=b.units[2];d.x=5;b.units[1].x=3;b.sel=a;b.auto=auto;
  random=()=>roll;pendingTimers=[];
  p.doDuel(a,d);
  const winner=roll===0?a:d,loser=roll===0?d:a,scene=b.duelScene;
  assert.equal(scene.winner,winner);assert(b.busy);
  assert.equal(pendingTimers.length,1);assert.equal(pendingTimers[0].ms,2400,'auto mode must preserve the entire duel');
  const html=els.bDuelScene.innerHTML;
  assert(html.includes('xiahoudun.jpg')&&html.includes('lijue.jpg'),'show both existing portraits');
  assert(html.includes('duel-fighter '+(winner===a?'left':'right')+' winner'));
  assert(html.includes('duel-fighter '+(loser===a?'left':'right')+' loser'));
  assert(html.includes(winner.name+' 승리!'));
  // Any panel refresh must preserve the DOM, so CSS animations keep their current time.
  let rewrites=0,storedHtml=html;
  Object.defineProperty(els.bDuelScene,'innerHTML',{configurable:true,get:()=>storedHtml,set:value=>{rewrites++;storedHtml=value;}});
  p.renderPanel();assert.equal(rewrites,0,'panel refresh restarted the portrait animation');
  const before=[b.round,a.troops,d.troops,a.morale,d.morale];
  for(const cmd of ['auto','nextTurn','retreat','duel','duelAccept','duelRefuse'])Battle.act(cmd);
  Battle.clickCell(d.x,d.y);
  assert.equal(b.auto,auto);assert.equal(b.duelScene,scene);
  assert.deepEqual([b.round,a.troops,d.troops,a.morale,d.morale],before);
  assert(Battle.observation().tiles.every(t=>t.action===null));
  pendingTimers.shift().fn();
  assert.equal(b.duelScene,null);assert.equal(els.bDuelScene.innerHTML,'');
  assert(auto?pendingTimers.some(t=>t.ms===430):!b.busy,'turn flow must resume after the scene');
  Object.defineProperty(els.bDuelScene,'innerHTML',{configurable:true,writable:true,value:storedHtml});
  pendingTimers=null;
}
// Custom portraits are reused; a photo-less officer still has a visible fallback.
b=setup([unit('custom <A>',3000)],[unit('no photo',3000)]);a=b.units[0];d=b.units[1];
a.officer.portrait='data:image/png;base64,AAAA';random=()=>0;
p.doDuel(a,d);
assert(els.bDuelScene.innerHTML.includes('data:image/png;base64,AAAA'));
assert(els.bDuelScene.innerHTML.includes('custom &lt;A&gt;'));
assert(els.bDuelScene.innerHTML.includes('duel-initial'));
// A timeout belonging to a replaced battle must not clear the new scene or advance its turn.
b=setup();pendingTimers=[];p.doDuel(b.units[0],b.units[1]);const staleTimer=pendingTimers[0];pendingTimers=null;
b=setup();p.doDuel(b.units[0],b.units[1]);const currentScene=b.duelScene;
staleTimer.fn();assert.equal(b.duelScene,currentScene);assert(b.busy);
console.log('[OK] duel portraits, both winners, custom/fallback faces, stable animation DOM, full auto duration, input lock, cleanup/resume, stale timer isolation');

// Branch counters, terrain and generals must still affect otherwise equal armies.
random = () => .5;
b = setup(); a = b.units[0]; d = b.units[1];
const plain = p.calcDamage(a, d);
d.branch = '기병'; assert(p.calcDamage(a, d) > plain, 'infantry loses its cavalry counter');
d.branch = '보병'; b.terrain[d.y][d.x] = 2;
assert(p.calcDamage(a, d) < plain, 'mountain defense has no effect');
b.terrain[d.y][d.x] = 0; a.officer.wu = 100;
assert(p.calcDamage(a, d) > plain, 'general quality has no effect');

// Small archers cannot attach full-strength percentage burns to a large target.
b = setup([unit('A', 100, '궁병')], [unit('D', 10000)]); a = b.units[0]; d = b.units[1];
p.doFireArrow(a, d);
const beforeBurn = d.troops;
p.roundStart();
assert(beforeBurn - d.troops <= 50, 'tiny archers retain a full 5% burn');
assert.equal(d.burn, 1);
p.roundStart(); assert.equal(d.burn, 0); assert.equal(d.burnRate, 0);

// Normal archers retain two full-strength burning rounds and their ammunition limit.
b = setup([unit('A', 3000, '궁병')], [unit('D', 10000)]); a = b.units[0]; d = b.units[1];
p.doFireArrow(a, d); assert.equal(a.fire, 1);
let previous = d.troops; p.roundStart(); assert.equal(previous - d.troops, Math.round(previous * .05));
previous = d.troops; p.roundStart(); assert.equal(previous - d.troops, Math.round(previous * .05));
p.doFireArrow(a, d); assert.equal(a.fire, 0);
previous = d.troops; a.acted = false; p.doFireArrow(a, d); assert.equal(d.troops, previous);

// A token detachment cannot refresh a normal army's stronger burning effect.
b = setup([unit('A', 3000, '궁병'), unit('small', 100, '궁병')], [unit('D', 10000)]);
a = b.units[0]; d = b.units[2]; p.doFireArrow(a, d); p.roundStart();
assert.equal(d.burn, 1); p.doFireArrow(b.units[1], d);
assert.equal(d.burn, 1); assert.equal(d.burnRate, .05);

// Tiny strategists must also have reduced hostile success chance, not only reduced damage.
b = setup([unit('A', 100)], [unit('D', 10000)]); a = b.units[0]; d = b.units[1];
random = () => .1; p.doStratAct(a, d, '혼란'); assert.equal(d.confused, 0);
// AI uses a reliable range-three spell even when no enemy is in its normal melee range.
random = () => 0;
b = setup(); a = b.units[0]; d = b.units[1]; d.x = a.x + 3;
a.officer.zhi = 100; d.officer.zhi = 50; d.confused = 1;
assert(p.tryAct(a)); assert(d.troops < 3000, 'AI ignores legal range-three fire');
// Inspiration must obey the same range for AI and player.
b = setup([unit('A', 3000), unit('ally', 3000)]); a = b.units[0]; d = b.units[1];
d.x = a.x + 4; d.morale = 20; b.units[2].x = 12;
p.doStratAct(a, d, '고무'); assert.equal(d.morale, 20); assert(!a.acted);
assert(!p.tryAct(a)); assert.equal(d.morale, 20);

// Dead attacking officers must reach the real campaign's relocation/capture paths.
let campaignResult;
b = setup([unit('하후돈', 3000), unit('하후연', 3000)], [unit('이각', 3000)], r => { campaignResult = r; });
const g = Game.state, target = g.cities['낙양'];
const from = g.officers.find(o => o.name === '하후돈').city;
b.units[1].alive = false; b.units[1].troops = 0;
timers = true; p.end('attacker'); timers = false;
Game._debug.applyBattleResult({ from, to: target.name, atk: 'cao', def: target.owner }, campaignResult);
assert.equal(g.officers.find(o => o.name === '하후연').city, target.name, 'destroyed winning officer stranded at home');
b = setup([unit('하후돈', 3000), unit('하후연', 3000)], [unit('이각', 3000)], r => { campaignResult = r; });
b.units[1].alive = false; b.units[1].troops = 0;
timers = true; p.end('defender'); timers = false;
Game._debug.applyBattleResult({ from: Game.state.officers.find(o => o.name === '하후돈').city,
  to: '낙양', atk: 'cao', def: Game.state.cities['낙양'].owner }, campaignResult);
assert.equal(Game.state.officers.find(o => o.name === '하후연').status, 'pow', 'destroyed losing officer bypasses capture');
assert.equal(Game.state.officers.find(o => o.name === '하후연').city, '낙양');

// A fully recovered city must not spend a command or officer on a no-op.
Game.startNew('cao'); city = Game.state.cities['허창']; city.training = city.morale = 100;
const fullCmd = Game.state.cmd; Game.cmdTrain(city.name);
assert(!Game.state.ui.pick); assert.equal(Game.state.cmd, fullCmd);
assert(!Game.state.officers.some(o => o.used));
// Timing out always repels the attacker, in both open-field battles and sieges.
for (const siege of [false, true]) {
  let outcome;
  b = setup([unit('A', 3600)], [unit('D', 3000)], r => { outcome = r; });
  b.opts.siege = siege;
  timers = true; p.timeUp(); timers = false;
  assert.equal(outcome.winner, 'defender');
}
Game.startNew('cao'); Game.state.cities['낙양'].def = 0;
Battle.start({ siege: true, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
  atk: { name: '공격', color: '#444', units: [{ ...unit('A', 3000), training: 0 }] },
  def: { name: '수비', color: '#888', units: [unit('D', 3000)] }, onEnd: noop });
assert.equal(Battle.state.cityDef, 0); assert.equal(Battle.state.units[0].training, 0);
console.log('[OK] branch/terrain/general effects, scaled burns, spell chance/range, campaign capture/return, recovery cap, field/siege timeout');

// Named abilities must change actual actions, not just the roster labels.
random=()=>.5;b=setup();a=b.units[0];d=b.units[1];p.doStratAct(a,d,'혼란');assert.equal(d.confused,0);
b=setup([unit('제갈량',3000)]);a=b.units[0];d=b.units[1];p.doStratAct(a,d,'혼란');assert(d.confused>0);
random=()=>0;b=setup([unit('관우',3000),unit('ally',3000)]);a=b.units[0];d=b.units[2];d.x=a.x;d.y=a.y+1;b.units[1].morale=40;
p.doDuel(a,d);assert.equal(b.units[1].morale,48,'duel victory should rally nearby allied troops');
b=setup();a=b.units[0];d=b.units[1];p.doStratAct(a,d,'화계');const genericFire=3000-d.troops;
b=setup([unit('주유',3000)]);a=b.units[0];d=b.units[1];p.doStratAct(a,d,'화계');assert(3000-d.troops>genericFire);
b=setup();a=b.units[0];d=b.units[1];p.attackAct(a,d);const normalMorale=d.morale;
b=setup([unit('장비',3000)]);a=b.units[0];d=b.units[1];p.attackAct(a,d);assert.equal(d.morale,normalMorale-3);
console.log('[OK] actual unique-general actions');

// A single surviving unit can capture the forts in sequence, and defenders can recapture flags.
b=setup();b.opts.siege=true;a=b.units[0];d=b.units[1];d.x=12;
b.forts=[{x:4,y:4,owner:'def'},{x:6,y:4,owner:'def'},{x:8,y:4,owner:'def'}];
for(const f of b.forts)b.terrain[f.y][f.x]=3;
assert(!p.checkForts());assert.equal(b.forts[0].owner,'atk');
assert.equal(p.fortDuty(a).hold,false,'attack AI should pursue the remaining flags');
a.x=6;assert(!p.checkForts());assert.equal(b.forts[1].owner,'atk');
d.x=4;assert(!p.checkForts());assert.equal(b.forts[0].owner,'def','defenders must recapture empty forts');
d.x=12;a.x=4;assert(!p.checkForts());a.x=8;assert(p.checkForts(),'all three flags should win without simultaneous occupation');

// Every castle on the ray blocks cavalry: enemy-held, friendly-held, empty, or the landing tile.
for(const castle of ['enemy','friendly','empty','landing']) {
  b=setup([unit('A',3000,'기병'),unit('ally',3000)]);a=b.units[0];d=b.units[2];a.x=3;d.x=4;b.units[1].x=10;
  if(castle==='enemy')b.terrain[4][4]=3;
  if(castle==='friendly'){b.units[1].x=5;b.terrain[4][5]=3;}
  if(castle==='empty')b.terrain[4][5]=3;
  if(castle==='landing')b.terrain[4][6]=3;
  assert(!p.chargeOptions(a).some(o=>o.x===6&&o.y===4),castle+' castle was traversable');
  const originalX=a.x,originalTroops=d.troops;p.doCharge(a,{x:6,y:4});assert.equal(a.x,originalX);assert.equal(d.troops,originalTroops);assert(!a.acted);
}
b=setup([unit('A',3000,'기병')]);a=b.units[0];d=b.units[1];a.x=3;d.x=4;
assert(p.chargeOptions(a).some(o=>o.x===5&&o.y===4),'normal field charge must still work');

// Fort cover protects the unit receiving a counterattack, for either army; use pre-hit strength.
random=()=>.5;
for(const side of ['atk','def'])for(const fort of [false,true]) {
  b=setup();a=b.units.find(u=>u.side===side);d=b.units.find(u=>u!==a);b.terrain[a.y][a.x]=fort?3:0;
  const expected=Math.max(1,Math.round(p.calcDamage(d,a)*.45*(fort?.75:1))),before=a.troops;
  p.attackAct(a,d);assert.equal(before-a.troops,expected,'incorrect counter cover for '+side+'/'+fort);
}
b=setup();a=b.units[0];d=b.units[1];b.terrain[a.y][a.x]=3;d.confused=1;
p.attackAct(a,d);assert.equal(a.troops,3000,'fort changes must preserve confusion counter suppression');
console.log('[OK] sequential flag victory/recapture, attack AI flag pursuit, castle-blocked cavalry and 25% received counter reduction for both armies');

// Real regional geometry: a sub-tile river must not permit any melee action.
const geo=vm.runInContext('BattleTerrain',sandbox);
let riverChecks=0;
for(const city of Object.values(Game.state.cities)) for(const siege of [false,true]) {
  b=setup([unit('A',3000,'기병'),unit('ally',3000)],[unit('D',3000)]);
  b.geo=geo.build(city,siege);b.terrain=b.geo.terrain;b.opts.city=city;b.opts.siege=siege;
  a=b.units[0];const mate=b.units[1];d=b.units[2];
  for(const edge of b.geo.edgeFords) for(const side of ['atk','def']) for(const branch of ['보병','기병']) {
    a.side=mate.side=side;d.side=side==='atk'?'def':'atk';a.branch=branch;
    Object.assign(a,side==='atk'?edge.from:edge.to);Object.assign(d,side==='atk'?edge.to:edge.from);
    const free=b.terrain.flatMap((row,y)=>row.map((t,x)=>({t,x,y}))).find(c=>c.t<4&&
      Math.abs(c.x-a.x)+Math.abs(c.y-a.y)>2&&Math.abs(c.x-d.x)+Math.abs(c.y-d.y)>2);
    mate.x=free.x;mate.y=free.y;mate.acted=false;a.acted=false;a.moved=false;
    b.side=b.playerSide=side;b.sel=a;b.mode='select';b.busy=false;
    const tag=city.name+'/'+siege+'/'+side+'/'+branch;
    assert(!p.attackTargets(a).includes(d),tag+': cross-river attack target');
    assert(!p.duelTargets(a).includes(d),tag+': cross-river duel target');
    assert(!p.chargeOptions(a).some(o=>o.through.some(v=>v.unit===d)),tag+': cross-river charge');
    const before=d.troops,attackerBefore=a.troops;
    assert.equal(Battle.clickCell(d.x,d.y),false,tag+': cross-river click accepted');
    p.attackAct(a,d);p.doDuel(a,d);p.doVolley(a,d);
    assert.equal(d.troops,before,tag+': melee damage crossed river');
    assert.equal(a.troops,attackerBefore,tag+': illegal counterattack');
    assert(!a.acted,tag+': blocked attack consumed action');
    const tile=Battle.observation().tiles.find(t=>t.x===a.x&&t.y===a.y);
    assert(tile.fords.length,tag+': ford direction missing from accessible board');
    a.branch='궁병';
    assert(p.attackTargets(a).includes(d),tag+': cross-river archery blocked');
    assert(!p.duelTargets(a).includes(d),tag+': archer can duel across river');
    riverChecks++;
  }
}
// An ally across the river cannot join a same-bank infantry volley, from either side.
for(const side of ['atk','def']) {
  b=setup([unit('A',3000),unit('ally',3000)],[unit('D',3000)]);
  b.geo=geo.build({name:'여남'},true);b.terrain=b.geo.terrain;
  a=b.units[0];const mate=b.units[1];d=b.units[2];
  a.side=mate.side=side;d.side=side==='atk'?'def':'atk';
  Object.assign(a,{x:7,y:4});Object.assign(d,{x:6,y:4});Object.assign(mate,{x:6,y:5});
  assert.equal(p.volleyPartners(a,d).length,0,'cross-river partner joined volley/'+side);
  const before=d.troops;p.doVolley(a,d);assert.equal(d.troops,before);
  Object.assign(mate,{x:6,y:3});assert(p.volleyPartners(a,d).includes(mate),'same-bank volley blocked/'+side);
  // Entering a real ford still permits close combat against an adjacent bank unit.
  const ford=b.geo.crossings[0];Object.assign(a,ford.from);Object.assign(d,ford.cells[0]);
  assert(p.attackTargets(a).includes(d),'ford combat blocked/'+side);
  assert(p.attackTargets(d).includes(a),'reverse ford combat blocked/'+side);
  const hp=d.troops;p.attackAct(a,d);assert(d.troops<hp,'ford attack did not execute/'+side);
}
console.log('[OK] '+riverChecks+' regional river/side/branch cases: melee, charge, volley, duel blocked; archery, same-bank volley and ford combat retained');

// Movement highlights, reverse AI search and animation paths must agree on real costs.
for(const branch of ['보병','기병','궁병']) for(const [terrain,cost] of [[0,1],[1,branch==='기병'?2:1],[2,branch==='기병'?3:2],[5,branch==='기병'?3:2]]) {
  b=setup([unit('A',3000,branch)],[unit('D',3000)]);a=b.units[0];d=b.units[1];
  b.terrain=Array.from({length:9},()=>Array(13).fill(4));b.terrain[4]=Array(13).fill(terrain);
  a.x=0;a.y=4;a.form='안행';d.x=12;d.y=4;
  const budget=branch==='기병'?6:4,reach=Math.floor(budget/cost);
  assert.equal(rules.moveCost(branch,terrain),cost);
  const range=p.moveRange(a);
  assert(range.some(t=>t.x===reach&&t.y===4),branch+'/'+terrain+': legal movement omitted');
  assert(!range.some(t=>t.x>reach),branch+'/'+terrain+': exceeded movement budget');
  assert.equal(p.costField(a,4,4)[a.y*13+a.x],4*cost,'AI uses a different terrain cost');
  assert.equal(p.fordPath(a,0,4,reach,4).length,reach+1,'animation path disagrees with range');
}
b=setup();a=b.units[0];d=b.units[1];
const dry=rules.damage(a,d,{terrain:0,random:1});
assert(rules.damage(a,d,{terrain:5,random:1})>dry,'a unit exposed in a ford must take more damage');
for(const side of ['atk','def']) for(const terrain of [1,2,3,4,5]) {
  b=setup([unit('A',3000,'기병')]);a=b.units[0];d=b.units[1];a.side=side;d.side=side==='atk'?'def':'atk';
  a.x=3;a.y=4;d.x=4;d.y=4;
  assert(p.chargeOptions(a).some(c=>c.x===5&&c.y===4),'plain charge missing');
  b.terrain[4][3]=terrain;
  assert.equal(p.chargeOptions(a).length,0,'charge started on rough terrain/'+side+'/'+terrain);
  b.terrain[4][3]=0;b.terrain[4][4]=terrain;
  assert(!p.chargeOptions(a).some(c=>c.x===5&&c.y===4),'charge traversed rough terrain/'+side+'/'+terrain);
  b.terrain[4][4]=0;b.terrain[4][5]=terrain;
  assert(!p.chargeOptions(a).some(c=>c.x===5&&c.y===4),'charge landed on rough terrain/'+side+'/'+terrain);
}
console.log('[OK] branch-specific terrain costs agree across movement/AI/animation; ford exposure and plain-only charges apply to both armies');
}

if (process.argv.includes('--simulate') || process.argv.includes('--simulate-only')) {
  // Paired seeds across force ratios. These are AI-vs-AI tactical trials, not player win rates.
  const table = [];
  const trials = Math.max(1,Math.min(256,Number(process.argv.find(a=>a.startsWith('--trials='))?.split('=')[1])||16));
  const cities = (process.argv.find(a=>a.startsWith('--cities='))?.slice('--cities='.length)||'낙양').split(',');
  const ratios=(process.argv.find(a=>a.startsWith('--ratios='))?.slice('--ratios='.length)||'0.5,1,1.5,2').split(',').map(Number);
  assert(ratios.every(r=>Number.isFinite(r)&&r>0&&r<=10),'invalid troop ratios');
  const defenseArg=process.argv.find(a=>a.startsWith('--defense='))?.slice('--defense='.length);
  const defense=defenseArg===undefined?null:Number(defenseArg);
  assert(defense===null||Number.isFinite(defense)&&defense>=0&&defense<=100,'invalid city defense');
  const modes=process.argv.includes('--siege-only')?[true]:[false,true];
  const seedStart=Number(process.argv.find(a=>a.startsWith('--seed='))?.slice('--seed='.length)??731);
  assert(Number.isSafeInteger(seedStart),'invalid simulation seed');
  for (const city of cities) for (const siege of modes) for (const ratio of ratios) {
    let wins = 0, remainingAtk = 0, remainingDef = 0;
    for (let trial = 0; trial < trials; trial++) {
      let seed = seedStart + trial;
      random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      Game.startNew('cao');
      const troops = 3000, branches = ['보병', '기병', '궁병'];
      const makeArmy = (side, strength) => branches.map((branch, i) => ({
        ...unit(side + i, Math.round(troops * strength), branch),
        form: side === 'D' ? '방원' : branch === '궁병' ? '학익' : branch === '기병' ? '봉시' : '어린'
      }));
      let outcome;
      timers = true;
      assert(Game.state.cities[city],'unknown simulation city: '+city);
      if(defense!==null)Game.state.cities[city].def=defense;
      Battle.start({ siege, city: Game.state.cities[city], playerSide: 'atk', auto: true,
        atk: { name: '공격', color: '#444', units: makeArmy('A', ratio) },
        def: { name: '수비', color: '#888', units: makeArmy('D', 1) }, onEnd: r => { outcome = r; } });
      timers = false;
      assert(outcome && !Battle.state, 'seeded tactical battle does not finish');
      wins += outcome.winner === 'attacker' ? 1 : 0;
      remainingAtk += outcome.atk.reduce((sum, u) => sum + u.troops, 0);
      remainingDef += outcome.def.reduce((sum, u) => sum + u.troops, 0);
    }
    table.push({ city, defense:defense??Game.state.cities[city].def, mode: siege ? 'siege' : 'field', ratio, attackerWins: wins + '/'+trials,
      meanAtkRemaining: Math.round(remainingAtk / trials), meanDefRemaining: Math.round(remainingDef / trials) });
  }
  if(process.argv.includes('--json'))console.log(JSON.stringify(table));
  else console.table(table);
}
