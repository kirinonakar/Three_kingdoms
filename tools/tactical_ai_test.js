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
let rolls = 0;
const math = Object.create(Math); math.random = () => { rolls++; return .5; };
const sandbox = { console, Math: math, document: { getElementById: el, querySelectorAll: () => [], createElement: () => el('_') },
  localStorage: { getItem: () => null, setItem: noop }, setTimeout: () => 0, clearTimeout: noop };
sandbox.window = sandbox;
vm.createContext(sandbox);
const marker = '    start, act, setStrat, setForm, reinforce, retreatTo, clickCell, observation,';
const source = fs.readFileSync(path.join(root, 'js/battle.js'), 'utf8');
assert(source.includes(marker));
vm.runInContext(['data.js', 'combat-rules.js', 'strategy-systems.js', 'save-transfer.js', 'game.js', 'battle-terrain.js'].map(f =>
  fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n') + '\n' + source.replace(marker,
  '    probe: { aiBestAction, aiAct, tryAct, aiAcceptDuel, aiNextUnit, aiMoveToAction, aiSwitchForm, stratChance, stratFireDamage, doStratAct, moveRange },\n' + marker), sandbox);
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

// Infantry can start a profitable joint attack before an earlier cavalry mate spends its action.
b = setup([unit('mate', '기병'), unit('leader')]); [fresh, a, d] = b.units;
Object.assign(fresh, { x: 5, y: 3 }); Object.assign(a, { x: 4, y: 4 }); Object.assign(d, { x: 5, y: 4 });
fresh.charge = 0;
assert.equal(p.aiNextUnit([fresh, a]), a);
// A paid formation change must not discard that attack opportunity.
a.noOfficer = false; a.form = '어린'; a.formFreeUsed = true;
assert(!p.aiSwitchForm(a)); assert(!a.acted); assert.equal(a.form, '어린');

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
assert(['화계', '혼란'].includes(p.aiBestAction(a).type));
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
assert.notEqual(p.aiBestAction(a).type, '혼란', 'do not re-confuse an already disabled threat');

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
fresh.morale = 20; d.morale = 15; enemy.x = 10;
assert.equal(p.aiBestAction(a).type, '고무'); assert.equal(p.aiBestAction(a).target, d);
assert(p.tryAct(a)); assert.equal(d.morale, 33); assert.equal(fresh.morale, 20);

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
console.log('[OK] tactical AI: charge, volley opportunity cost, incremental burns, stratagems, rally, duels and deterministic evaluation');
