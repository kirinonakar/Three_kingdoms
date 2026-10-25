'use strict';
// Real tactical decisions and executions, with deterministic combat rolls and no UI timers.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..'), els = {}, noop = () => {};
const ctx = new Proxy({ createLinearGradient: () => ({ addColorStop: noop }),
  createRadialGradient: () => ({ addColorStop: noop }) }, { get: (t, k) => t[k] || noop });
const el = id => els[id] || (els[id] = { innerHTML: '', textContent: '', value: '', style: {},
  classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, getContext: () => ctx,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 572, height: 396 }) });
let rolls = 0, runTimers = false, random = () => .5;
const actionCounts = {};
const math = Object.create(Math); math.random = () => { rolls++; return random(); };
const sandbox = { console, Math: math, document: { getElementById: el, querySelectorAll: () => [], createElement: () => el('_') },
  localStorage: { getItem: () => null, setItem: noop }, setTimeout: fn => { if (runTimers) fn(); return 0; }, clearTimeout: noop,
  recordAiAction: (u, type) => { actionCounts[type] = (actionCounts[type] || 0) + 1; } };
sandbox.window = sandbox;
vm.createContext(sandbox);
const marker = '    start, act, setStrat, setForm, reinforce, retreatTo, clickCell, observation,';
const source = fs.readFileSync(path.join(root, 'js/battle.js'), 'utf8')
  .replace('const { type, target } = action;', 'const { type, target } = action; recordAiAction(u, type);')
  .replace('doVolley(plan.leader, plan.target);', 'recordAiAction(plan.leader, "volley"); doVolley(plan.leader, plan.target);');
assert(source.includes(marker));
vm.runInContext(['data.js', 'combat-rules.js', 'strategy-systems.js', 'save-transfer.js', 'game.js', 'battle-terrain.js'].map(f =>
  fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n') + '\n' + source.replace(marker,
  '    probe: { aiBestAction, aiAttackScore, aiAct, tryAct, aiAcceptDuel, aiNextUnit, aiPlanVolley, aiVolleyPlanStep, aiMoveToAction, aiSwitchForm, aiFormFor, stratChance, stratFireDamage, doStratAct, moveRange, moveStepToward, costField },\n' + marker), sandbox);
const { Game, Battle } = sandbox, p = Battle.probe;
const unit = (name, branch = '보병', troops = 3000) => ({ officer: { name, wu: 80, zhi: 80, skill: '' },
  troops, branch, form: '어린', morale: 80, training: 80 });
function setup(atk = [unit('A')], def = [unit('D')]) {
  Game.startNew('cao');
  Battle.start({ siege: false, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
    atk: { name: '공격', color: '#444', units: atk }, def: { name: '수비', color: '#888', units: def }, onEnd: noop });
  const b = Battle.state;
  b.terrain = Array.from({ length: 9 }, () => Array(13).fill(0)); b.forts = [];
  b.geo = { ...b.geo, terrain: b.terrain, rivers: [], lakes: [], crossings: [], edgeFords: [] };
  b.units.forEach((u, i) => Object.assign(u, { x: 4 + i, y: 4, noOfficer: true }));
  b.busy = false;
  return b;
}
let b = setup([unit('archer', '궁병')], [unit('burning', '보병', 10000), unit('fresh', '보병', 10000)]);
let [a, d, fresh] = b.units;
d.y = 3;
d.burn = 2; d.burnRate = .05;
assert.equal(p.aiBestAction(a).target, fresh, 'spread burns rather than refresh an equal existing burn');
assert.equal(p.aiBestAction(a).type, 'fire');
assert(p.tryAct(a));
assert.equal(a.fire, 1); assert.equal(fresh.burn, 2); assert.equal(d.troops, 10000);

// A legal attack must replace waiting even when every trade has a negative evaluation.
for (const side of ['atk', 'def']) for (const moved of [false, true]) {
  b = setup([unit('outnumbered', '보병', 100)], [unit('strong', '보병', 10000), unit('less dangerous', '보병', 2000)]);
  [a, d, fresh] = b.units;
  a.side = side; d.side = fresh.side = side === 'atk' ? 'def' : 'atk';
  b.side = side; b.playerSide = a.side; // no interactive enemy duel prompts in this fixture
  Object.assign(a, { moved }); Object.assign(fresh, { x: 4, y: 3 });
  assert(p.aiAttackScore(a, d) < 0 && p.aiAttackScore(a, fresh) < 0);
  p.aiAct(a);
  assert(a.acted); assert(d.troops < 10000 || fresh.troops < 2000, 'negative scores must not cause AI waiting');
  assert(!b.log.some(line => line.includes(a.name + ' 부대 대기')));
}
// A defender on a fort must also respond, rather than hold or pay for a formation change.
b = setup([unit('besieger', '보병', 10000)], [unit('guard', '보병', 100)]); [d, a] = b.units;
b.opts.siege = true; b.terrain[a.y][a.x] = 3;
b.forts = [{ x: a.x, y: a.y, owner: 'def' }];
Object.assign(a, { noOfficer: false, form: '어린', formFreeUsed: true });
a.officer.zhi = 20; a.officer.wu = 20;
assert(p.aiAttackScore(a, d) < 0);
const siegeBefore = d.troops;
p.aiAct(a);
assert(d.troops < siegeBefore); assert(a.acted); assert.equal(a.form, '어린');
assert(!b.log.some(line => line.includes(a.name + ' 부대가 성을 지킵니다')));

// Preserve the final arrow when the burn cannot tick, and finish weak targets with normal arrows.
b = setup([unit('archer', '궁병')]); [a, d] = b.units; b.round = b.maxRound;
assert.equal(p.aiBestAction(a).type, 'attack');
b.round = 1; d.troops = 20;
assert.equal(p.aiBestAction(a).type, 'attack');
d.troops = 3000; a.fire = 0;
assert.equal(p.aiBestAction(a).type, 'attack');

// Two-target cavalry charges compete with normal melee immediately, before ordinary movement.
b = setup([unit('rider', '기병')], [unit('D1'), unit('D2')]); [a, d, fresh] = b.units;
assert.equal(p.aiBestAction(a).type, 'charge');
assert(p.tryAct(a));
assert.equal(a.charge, 1); assert.equal(a.x, 7); assert(d.troops < 3000 && fresh.troops < 3000);
// No second movement/charge after an ordinary move, and no charging from non-plain terrain.
b = setup([unit('rider', '기병')], [unit('D1'), unit('D2')]); [a] = b.units;
a.moved = true; assert.notEqual(p.aiBestAction(a)?.type, 'charge');
a.moved = false; b.terrain[a.y][a.x] = 1; assert.notEqual(p.aiBestAction(a)?.type, 'charge');
b = setup([unit('rider', '기병')], [unit('D1'), unit('D2'), unit('ambush', '궁병', 30000)]);
[a, d, fresh] = b.units; b.units[3].x = 8;
assert.notEqual(p.aiBestAction(a)?.type, 'charge', 'reject a landing exposed to overwhelming enemy fire');

// Joint attacks should save retaliation, but must account for every participant's other action.
b = setup([unit('leader'), unit('mate')]); [a, fresh, d] = b.units;
Object.assign(d, { x: 5, y: 4 }); Object.assign(fresh, { x: 5, y: 3 });
assert.equal(p.aiBestAction(a).type, 'volley');
assert(p.tryAct(a)); assert(a.acted && fresh.acted); assert.equal(a.volley, 1); assert.equal(fresh.volley, 1);
b = setup([unit('leader'), unit('mate')]); [a, fresh, d] = b.units;
Object.assign(d, { x: 5, y: 4, troops: 20 }); Object.assign(fresh, { x: 5, y: 3 });
assert.equal(p.aiBestAction(a).type, 'attack', 'do not spend two unit actions to kill a tiny detachment');
assert(p.tryAct(a)); assert(!fresh.acted); assert.equal(fresh.volley, 2);

function stagingFixture(branch = '기병', side = 'atk') {
  const battle = setup([unit('partner', branch), unit('infantry leader')]);
  const [mate, leader, target] = battle.units;
  Object.assign(mate, { x: 2, y: 4, side }); Object.assign(leader, { x: 3, y: 3, side });
  Object.assign(target, { x: 6, y: 4, side: side === 'atk' ? 'def' : 'atk' });
  battle.side = side;
  return { battle, mate, leader, target };
}
// Both armies can move two infantry/cavalry units, preserve both actions, then initiate with infantry.
for (const branch of ['보병', '기병']) for (const side of ['atk', 'def']) {
  const f = stagingFixture(branch, side), allies = [f.mate, f.leader];
  const before = JSON.stringify(f.battle.units), beforeRolls = rolls;
  const candidate = p.aiPlanVolley(allies);
  assert(candidate, 'should find a profitable two-move joint attack');
  assert.equal(candidate.steps.filter(step => step.dest).length, 2);
  assert.equal(candidate.leader.branch, '보병');
  assert.equal(JSON.stringify(f.battle.units), before); assert.equal(rolls, beforeRolls);
  const first = p.aiNextUnit(allies);
  const plan = f.battle.aiVolleyPlan;
  assert(plan); assert.equal(first, plan.mate);
  p.aiAct(first);
  assert(first.moved && !first.acted); assert.equal(first.volley, branch === '보병' ? 2 : 0); assert.equal(f.target.troops, 3000);
  const second = p.aiNextUnit(allies);
  assert.equal(second, plan.leader); assert.notEqual(second, first);
  p.aiAct(second);
  assert(second.moved && !second.acted && !first.acted); assert.equal(f.target.troops, 3000);
  const finisher = p.aiNextUnit(allies);
  assert.equal(finisher, plan.leader);
  p.aiAct(finisher);
  assert(first.acted && second.acted); assert.equal(first.volley, branch === '보병' ? 1 : 0); assert.equal(second.volley, 1);
  assert.equal(first.troops, 3000); assert.equal(second.troops, 3000);
  assert(f.target.troops < 3000); assert.equal(f.battle.aiVolleyPlan, null);
  assert(f.battle.log.some(line => line.includes('일제공격!')));
}
for (const disabled of [{ acted: true }, { moved: true }, { confusedNow: true }, { branch: '보병', volley: 0 }, { dying: true }, { branch: '궁병' }]) {
  const f = stagingFixture(); Object.assign(f.mate, disabled);
  assert.equal(p.aiPlanVolley([f.mate, f.leader]), null, 'must not reserve an unavailable partner');
}
{
  const f = stagingFixture(); f.leader.branch = '기병';
  assert.equal(p.aiPlanVolley([f.mate, f.leader]), null, 'cavalry cannot initiate a joint attack');
}
{
  const f = stagingFixture(); f.battle.terrain.forEach(row => { row[4] = 4; });
  assert.equal(p.aiPlanVolley([f.mate, f.leader]), null, 'no staging through an impassable river');
}
{
  const f = stagingFixture();
  for (const point of [{ x: 6, y: 3 }, { x: 6, y: 5 }, { x: 7, y: 4 }]) f.battle.terrain[point.y][point.x] = 4;
  assert.equal(p.aiPlanVolley([f.mate, f.leader]), null, 'two partners cannot reserve the same landing tile');
}
{
  const f = stagingFixture(); f.target.troops = 20;
  assert.equal(p.aiPlanVolley([f.mate, f.leader]), null, 'do not stage a joint attack that wastes actions on overkill');
}
{
  const f = stagingFixture(); f.battle.opts.siege = true;
  f.battle.forts = [{ x: f.mate.x, y: f.mate.y, owner: 'def' }]; f.mate.side = f.leader.side = 'def'; f.target.side = 'atk';
  f.battle.terrain[f.mate.y][f.mate.x] = 3;
  assert.equal(p.aiPlanVolley([f.mate, f.leader]), null, 'staging must not abandon a fort that needs its garrison');
}
// If a reserved ally loses its action, cancel the plan and let the remaining unit attack normally.
{
  const f = stagingFixture(), allies = [f.mate, f.leader];
  const first = p.aiNextUnit(allies); p.aiAct(first); first.acted = true;
  const next = p.aiNextUnit(allies.filter(u => !u.acted));
  assert.equal(f.battle.aiVolleyPlan, null);
  p.aiAct(next);
  assert(next.acted && f.target.troops < 3000, 'a broken plan must not leave the other unit waiting');
}

// A blocked ford must not make rear units alternate between path-distance and straight-line goals.
function blockedFordFixture(branch = '보병') {
  const battle = setup([unit('rear', branch), unit('front')], [unit('ford guard')]);
  const [rear, front, guard] = battle.units;
  Object.assign(rear, { x: 5, y: 5 }); Object.assign(front, { x: 5, y: 2, acted: true });
  Object.assign(guard, { x: 6, y: 2 });
  battle.terrain.forEach(row => { row[6] = 4; }); battle.terrain[2][6] = 5;
  battle.opts.siege = true; battle.forts = [{ x: 10, y: 4, owner: 'def' }]; battle.terrain[4][10] = 3;
  return { battle, rear, front, guard };
}
for (const branch of ['보병', '기병']) {
  const f = blockedFordFixture(branch);
  let movements = 0;
  for (let turn = 0; turn < 6; turn++) {
    Object.assign(f.rear, { moved: false, acted: false });
    const before = { x: f.rear.x, y: f.rear.y };
    p.aiAct(f.rear);
    if (f.rear.x !== before.x || f.rear.y !== before.y) movements++;
  }
  assert(movements <= 1, 'rear units must not shuttle between a blocked ford and the straight-line target');
  assert(f.rear.x < 6); assert.equal(f.guard.troops, 3000);
  // Once the friendly frontline makes room, advance to a legal attack tile and attack the ford guard.
  Object.assign(f.front, { x: 3, y: 0 }); Object.assign(f.rear, { moved: false, acted: false });
  p.aiAct(f.rear);
  assert(f.guard.troops < 3000, 'attack a ford blocker as soon as the near-bank attack tile opens');
}
for (const branch of ['보병', '기병']) {
  const f = blockedFordFixture(branch), here = f.rear.y * 13 + f.rear.x;
  assert(Number.isFinite(p.costField(f.rear, 10, 4)[here]));
  assert.equal(p.costField(f.rear, 10, 4, true)[here], Infinity, 'enemy-held ford blocks the route to the far bank');
  assert(Number.isFinite(p.costField(f.rear, f.guard.x, f.guard.y, true)[here]), 'the blocking enemy remains approachable as an attack target');
  // A second open ford takes priority over assembling behind the blocked one.
  f.battle.terrain[7][6] = 5;
  const visited = new Set([f.rear.x + ',' + f.rear.y]);
  let crossed = false;
  for (let turn = 0; turn < 10; turn++) {
    f.rear.moved = false;
    assert(p.moveStepToward(f.rear, 10, 4), 'an open alternate ford must remain reachable');
    const key = f.rear.x + ',' + f.rear.y;
    assert(!visited.has(key), 'the alternate route must make progress without revisiting positions'); visited.add(key);
    if (f.rear.x >= 7) { crossed = true; break; }
  }
  assert(crossed); assert.equal(f.guard.troops, 3000);
}
{
  const f = blockedFordFixture();
  p.moveStepToward(f.rear, 10, 4); f.rear.moved = false;
  assert(!p.moveStepToward(f.rear, 10, 4), 'a full near-bank attack position should hold the rear unit in place');
  f.guard.alive = false; f.guard.troops = 0;
  for (let turn = 0; turn < 6 && f.rear.x < 7; turn++) {
    f.rear.moved = false;
    assert(p.moveStepToward(f.rear, 10, 4), 'resume crossing immediately when the ford guard disappears');
  }
  assert(f.rear.x >= 7);
}
{
  const f = blockedFordFixture(); f.battle.terrain[2][6] = 4; Object.assign(f.guard, { x: 10, y: 4 });
  const before = JSON.stringify(f.battle.units);
  assert(!p.moveStepToward(f.rear, 10, 4), 'an unconnected river bank must not trigger straight-line movement');
  assert.equal(JSON.stringify(f.battle.units), before);
}

// Infantry can start a profitable joint attack before an earlier cavalry mate spends its action.
b = setup([unit('mate', '기병'), unit('leader')]); [fresh, a, d] = b.units;
Object.assign(fresh, { x: 5, y: 3 }); Object.assign(a, { x: 4, y: 4 }); Object.assign(d, { x: 5, y: 4 });
fresh.charge = 0;
assert.equal(p.aiNextUnit([fresh, a]), a);
// A paid formation change must not discard that attack opportunity.
a.noOfficer = false; a.form = '어린'; a.formFreeUsed = true;
assert(!p.aiSwitchForm(a)); assert(!a.acted); assert.equal(a.form, '어린');

// Infantry only switches to marching formation when its extra movement is necessary to arrive in time.
b = setup(); [a, d] = b.units; a.noOfficer = false; Object.assign(a, { x: 0, y: 4 }); d.x = 8;
assert.equal(p.aiFormFor(a), '어린', 'a distant enemy alone is not a reason to march');
b.round = b.maxRound - 1;
assert.equal(p.aiFormFor(a), '안행', 'two remaining rounds require movement 4 to cover seven tiles');
assert(!p.aiSwitchForm(a)); assert.equal(a.form, '안행'); assert(!a.acted);
a.form = '어린'; a.formRound = undefined;
assert.equal(p.aiFormFor(a), '어린', 'never spend a used free formation change on marching');
a.formFreeUsed = false; b.round = b.maxRound;
assert.equal(p.aiFormFor(a), '어린', 'do not switch when marching still cannot arrive in time');
d.x = 5; b.round = b.maxRound - 1;
assert.equal(p.aiFormFor(a), '어린', 'ordinary movement already arrives within the remaining rounds');
d.x = 7;
// A full mountain column makes the shortest approach cost seven, rather than six.
b.terrain.forEach(row => { row[3] = 2; });
assert.equal(p.aiFormFor(a), '안행', 'arrival estimates must account for terrain movement costs');
b.terrain.forEach(row => { row[3] = 0; });
d.x = 8; a.moved = true;
assert.equal(p.aiFormFor(a), '어린', 'marching cannot help after movement has already been used');
a.moved = false; b.terrain.forEach(row => { row[4] = 4; });
assert.equal(p.aiFormFor(a), '어린', 'do not switch for an unreachable enemy');

// Movement finds a legal firing position and acts in the same turn.
b = setup([unit('archer', '궁병')]); [a, d] = b.units; d.x = 9;
const reachable = p.moveRange(a), enemyBefore = JSON.stringify(d), moveRolls = rolls;
assert.equal(p.aiBestAction(a), null);
p.aiAct(a);
assert(reachable.some(point => point.x === a.x && point.y === a.y));
assert(a.moved && a.acted); assert(d.troops < 3000);
assert(rolls > moveRolls, 'only the executed attack should roll damage');
// A failed position search restores the actor and has no side effects or RNG use.
b = setup(); [a, d] = b.units; d.x = 12;
const unmoved = JSON.stringify(b.units), searchRolls = rolls;
assert(!p.aiMoveToAction(a)); assert.equal(JSON.stringify(b.units), unmoved); assert.equal(rolls, searchRolls);
// Having a weak range-three spell must not stop a large melee unit from closing for a better attack.
b = setup([unit('fighter', '보병', 8000)]); [a, d] = b.units;
a.noOfficer = false; d.x = 7;
assert.equal(p.aiBestAction(a), null, 'low probability range-three spells should not stop the advance');
p.aiAct(a);
assert(a.moved && a.acted); assert.equal(Math.abs(a.x - d.x) + Math.abs(a.y - d.y), 1);
assert(d.troops < 3000);

// High intellect should disable a dangerous army instead of choosing the smallest target.
b = setup([unit('strategist', '보병', 1000)], [unit('large', '기병', 10000), unit('token', '보병', 100)]);
[a, d, fresh] = b.units;
Object.assign(a, { noOfficer: false }); Object.assign(a.officer, { wu: 20, zhi: 100 });
Object.assign(d, { x: 7, y: 4 }); Object.assign(d.officer, { wu: 95, zhi: 20 });
Object.assign(fresh, { x: 4, y: 7 }); fresh.officer.zhi = 20;
assert.equal(p.aiBestAction(a).type, '혼란'); assert.equal(p.aiBestAction(a).target, d);
assert(p.tryAct(a)); assert(d.confused > 0); assert(d.acted);
a.acted = false;
assert.notEqual(p.aiBestAction(a)?.type, '혼란', 'do not re-confuse an already disabled threat');

// Special fire talents, resistance and castle cover must use the actual execution formula.
b = setup(); [a, d] = b.units; a.noOfficer = false;
a.officer.name = '주유'; a.officer.zhi = 100; d.officer.zhi = 40;
b.terrain[a.y - 1][a.x] = 5; b.terrain[d.y][d.x] = 1;
const forecast = p.stratFireDamage(a, d, 250), chance = p.stratChance(a, d, '화계');
p.doStratAct(a, d, '화계'); assert.equal(3000 - d.troops, forecast);
a.acted = false; d.troops = 3000; b.terrain[d.y][d.x] = 3; d.officer.skill = '지장';
assert(p.stratChance(a, d, '화계') < chance); assert(p.stratFireDamage(a, d, 250) < forecast);

// Rally saves the large endangered ally rather than choosing by roster order or intellect threshold.
b = setup([unit('support', '보병', 1000), unit('small', '보병', 100), unit('front', '보병', 6000)]);
[a, fresh, d] = b.units; const enemy = b.units[3];
a.noOfficer = false; a.officer.zhi = 40; a.officer.wu = 20;
fresh.morale = 20; d.morale = 15; enemy.x = 9;
assert.equal(p.aiBestAction(a).type, '고무'); assert.equal(p.aiBestAction(a).target, d);
assert(p.tryAct(a)); assert.equal(d.morale, 33); assert.equal(fresh.morale, 20);

// Hostile stratagems must exceed 60% success, including the exact boundary.
b = setup(); [a, d] = b.units; a.noOfficer = false; d.x = 7; d.confused = 1;
a.officer.zhi = 80; d.officer.zhi = 57;
assert.equal(p.stratChance(a, d, '화계'), .6); assert.equal(p.aiBestAction(a), null);
d.officer.zhi = 56;
assert.equal(p.aiBestAction(a).type, '화계', '61% fire remains eligible');
random = () => .99;
assert(p.tryAct(a)); assert.equal(a.aiStratRound, b.round); assert.equal(d.troops, 3000, 'failed spell still consumes AI cooldown');
random = () => .5;
a.acted = false; assert.equal(p.aiBestAction(a), null);
b.round++; assert.equal(p.aiBestAction(a), null, 'do not chain stratagems on consecutive rounds');
b.round++; assert.equal(p.aiBestAction(a), null, 'cooldown expiry must not allow the same stratagem on the same target twice');
// Changing targets permits that stratagem, even when both officers share a name.
fresh = { ...d, officer: { ...d.officer }, x: 4, y: 7 };
b.units.push(fresh);
assert.equal(p.aiBestAction(a).type, '화계'); assert.equal(p.aiBestAction(a).target, fresh);
assert(p.tryAct(a)); assert.equal(a.aiLastStratTarget, b.units.indexOf(fresh));
a.acted = false; b.round += 2;
assert.equal(p.aiBestAction(a).target, d, 'a different target between casts permits the original pair again');
// Moving the original target does not turn it into a new target.
b.units.pop(); a.aiLastStratTarget = b.units.indexOf(d); d.x = 4; d.y = 7;
assert.equal(p.aiBestAction(a), null);
// A different stratagem on that target is allowed after the existing cooldown.
d.confused = 0; d.officer.zhi = 20;
assert.equal(p.aiBestAction(a).type, '혼란'); assert.equal(p.aiBestAction(a).target, d);
assert(p.tryAct(a)); assert.equal(a.aiLastStratType, '혼란');
a.acted = false; b.round += 2;
assert.equal(p.aiBestAction(a).type, '화계', 'another stratagem between casts permits the original type again');

b = setup(); [a, d] = b.units; a.noOfficer = false; d.x = 7;
a.officer.zhi = 80; d.officer.zhi = 62;
assert.equal(p.stratChance(a, d, '혼란'), .6); assert.equal(p.aiBestAction(a), null);
d.officer.zhi = 61;
assert.equal(p.aiBestAction(a).type, '혼란', '61% confusion remains eligible');
// Apply the same cutoff to castle resistance, troop scaling and officer skills.
b.terrain[d.y][d.x] = 3; assert.equal(p.aiBestAction(a), null);
b.terrain[d.y][d.x] = 0; d.officer.zhi = 10; a.troops = 600;
assert(p.stratChance(a, d, '혼란') < .6); assert.equal(p.aiBestAction(a), null);
a.troops = 3000; d.officer.zhi = 61; d.officer.skill = '지장';
assert.equal(p.aiBestAction(a), null);

// Morale 50 is eligible for rally; 51 is not, even after the cooldown expires.
b = setup([unit('support'), unit('front', '보병', 6000)]); [a, d, fresh] = b.units;
a.noOfficer = false; fresh.x = 8; d.morale = 50;
assert.equal(p.stratChance(a, d, '고무'), 1); assert.equal(p.aiBestAction(a).type, '고무');
d.morale = 51; assert.equal(p.aiBestAction(a), null);
d.morale = 50; fresh.x = 12; assert.equal(p.aiBestAction(a), null, 'do not stall the rear army with unnecessary rally');
// Emergency rally must also respect the same-target repetition rule.
fresh.x = 8; d.morale = 15;
assert(p.tryAct(a)); assert.equal(a.aiLastStratType, '고무');
a.acted = false; d.morale = 15;
assert.equal(p.aiBestAction(a), null, 'emergency rally must not repeat on the same unit');
b.round += 2; assert.equal(p.aiBestAction(a), null);

// Duel targets are all compared using skill/talent bonuses, not the first adjacent enemy's wu.
b = setup([unit('champion', '보병', 1000)], [unit('master', '보병', 10000), unit('weak', '보병', 10000)]);
[a, d, fresh] = b.units;
a.noOfficer = d.noOfficer = fresh.noOfficer = false;
Object.assign(a.officer, { wu: 90, zhi: 20, skill: '용맹' });
Object.assign(d.officer, { wu: 100, zhi: 100, skill: '천하무쌍' });
Object.assign(fresh, { x: 4, y: 5 }); Object.assign(fresh.officer, { wu: 50, zhi: 100 });
assert.equal(p.aiBestAction(a).type, 'duel'); assert.equal(p.aiBestAction(a).target, fresh);
assert(p.tryAct(a)); assert(a.dueled); assert.equal(fresh.troops, 10000, 'hopeless AI opponent should refuse');
assert.equal(fresh.morale, 30);
a.acted = false; assert.notEqual(p.aiBestAction(a)?.type, 'duel');
fresh.morale = 40; assert(p.aiAcceptDuel(a, fresh), 'accept when refusal would rout the army');

// Evaluation is repeatable, has no combat RNG draws and leaves every unit untouched.
b = setup([unit('leader'), unit('mate', '기병')], [unit('D1'), unit('D2')]);
[a, fresh, d] = b.units; Object.assign(fresh, { x: 5, y: 3 }); Object.assign(d, { x: 5, y: 4 });
b.units.forEach(u => { u.noOfficer = false; });
const before = JSON.stringify(b.units), beforeRolls = rolls, first = p.aiBestAction(a);
for (let i = 0; i < 20; i++) {
  const next = p.aiBestAction(a);
  assert.equal(next.type, first.type); assert.equal(next.target, first.target); assert.equal(next.score, first.score);
}
assert.equal(rolls, beforeRolls); assert.equal(JSON.stringify(b.units), before);
a.confusedNow = true; assert.equal(p.aiBestAction(a), null); assert(!p.tryAct(a));
a.confusedNow = false; a.acted = true; assert(!p.tryAct(a));
console.log('[OK] tactical AI: staged volleys, selective marching, mandatory attacks, specials, stratagems and deterministic evaluation');

if (process.argv.includes('--simulate')) {
  for (const key of Object.keys(actionCounts)) delete actionCounts[key];
  let battles = 0;
  for (const city of ['낙양', '건업', '양양']) for (const siege of [false, true]) for (let trial = 0; trial < 8; trial++) {
    let seed = 731 + trial;
    random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    Game.startNew('cao');
    const army = side => ['보병', '기병', '궁병'].map((branch, i) => {
      const value = unit(side + i, branch);
      if (process.argv.includes('--specialists')) {
        Object.assign(value.officer, [{ wu: 80, zhi: 70 }, { wu: 95, zhi: 45 }, { wu: 60, zhi: 95, skill: '모사' }][i]);
      }
      return value;
    });
    let result;
    runTimers = true;
    Battle.start({ siege, city: Game.state.cities[city], playerSide: 'atk', auto: true,
      atk: { name: '공격', color: '#444', units: army('A') }, def: { name: '수비', color: '#888', units: army('D') },
      onEnd: value => { result = value; } });
    runTimers = false;
    assert(result && !Battle.state, 'seeded tactical battle must finish'); battles++;
  }
  const total = Object.values(actionCounts).reduce((sum, value) => sum + value, 0);
  const stratagems = ['화계', '혼란', '고무'].reduce((sum, type) => sum + (actionCounts[type] || 0), 0);
  assert(total > 0 && stratagems / total < .35, 'direct attacks should dominate representative army actions');
  console.log(JSON.stringify({ battles, actionCounts, stratagemPercent: Math.round(stratagems / total * 1000) / 10 }));
}
