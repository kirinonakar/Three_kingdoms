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
let random = () => .5, timers = false;
const math = Object.create(Math); math.random = () => random();
const sandbox = { console, Math: math,
  document: { getElementById: el, querySelectorAll: () => [], createElement: () => el('_') },
  localStorage: { getItem: () => null, setItem: noop },
  setTimeout: fn => { if (timers) fn(); return 0; }, clearTimeout: noop
};
sandbox.window = sandbox;
vm.createContext(sandbox);
const marker = '    start, act, setStrat, setForm, reinforce, retreatTo, clickCell, observation,';
const battle = fs.readFileSync(process.env.BALANCE_BATTLE_SOURCE || path.join(root, 'js/battle.js'), 'utf8');
assert(battle.includes(marker), 'battle probe insertion point changed');
vm.runInContext(['data.js', 'game.js', 'battle-terrain.js'].map(f =>
  fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n') + '\n' +
  battle.replace(marker, '    probe: { calcDamage, doFireArrow, doStratAct, doDuel, duelTargets, roundStart, timeUp, end, tryAct },\n' + marker), sandbox);
const { Game, Battle } = sandbox, p = Battle.probe;
const officer = (name, wu = 80, zhi = 80) => ({ name, wu, zhi, pol: 80, cha: 80, skill: '' });
const unit = (name, troops, branch = '보병') => ({ officer: officer(name), troops, branch, training: 80, morale: 80, form: '안행' });
function setup(atk = [unit('A', 3000)], def = [unit('D', 3000)], onEnd = noop) {
  Game.startNew('cao');
  Battle.start({ siege: false, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
    atk: { name: '공격', color: '#444', units: atk }, def: { name: '수비', color: '#888', units: def }, onEnd });
  const b = Battle.state;
  b.terrain = Array.from({ length: 9 }, () => Array(13).fill(0)); b.forts = [];
  b.units.forEach((u, i) => { u.x = 4 + i; u.y = 4; });
  return b;
}
if (!process.argv.includes('--simulate-only')) {
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
// AI uses range-three spells even when no enemy is in its normal melee range.
random = () => 0;
b = setup(); a = b.units[0]; d = b.units[1]; d.x = a.x + 3;
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
// The 1.4-times siege threshold must not leak into open-field battles.
for (const siege of [false, true]) {
  let outcome;
  b = setup([unit('A', 3600)], [unit('D', 3000)], r => { outcome = r; });
  b.opts.siege = siege;
  timers = true; p.timeUp(); timers = false;
  assert.equal(outcome.winner, siege ? 'defender' : 'attacker');
}
Game.startNew('cao'); Game.state.cities['낙양'].def = 0;
Battle.start({ siege: true, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
  atk: { name: '공격', color: '#444', units: [{ ...unit('A', 3000), training: 0 }] },
  def: { name: '수비', color: '#888', units: [unit('D', 3000)] }, onEnd: noop });
assert.equal(Battle.state.cityDef, 0); assert.equal(Battle.state.units[0].training, 0);
console.log('[OK] branch/terrain/general effects, scaled burns, spell chance/range, campaign capture/return, recovery cap, field/siege timeout');
}

if (process.argv.includes('--simulate') || process.argv.includes('--simulate-only')) {
  // Paired seeds across force ratios. These are AI-vs-AI tactical trials, not player win rates.
  const table = [];
  for (const siege of [false, true]) for (const ratio of [.5, 1, 1.5, 2]) {
    let wins = 0, remainingAtk = 0, remainingDef = 0;
    for (let trial = 0; trial < 16; trial++) {
      let seed = 731 + trial;
      random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      Game.startNew('cao');
      const troops = 3000, branches = ['보병', '기병', '궁병'];
      const makeArmy = (side, strength) => branches.map((branch, i) => ({
        ...unit(side + i, Math.round(troops * strength), branch),
        form: side === 'D' ? '방원' : branch === '궁병' ? '학익' : branch === '기병' ? '봉시' : '어린'
      }));
      let outcome;
      timers = true;
      Battle.start({ siege, city: Game.state.cities['낙양'], playerSide: 'atk', auto: true,
        atk: { name: '공격', color: '#444', units: makeArmy('A', ratio) },
        def: { name: '수비', color: '#888', units: makeArmy('D', 1) }, onEnd: r => { outcome = r; } });
      timers = false;
      assert(outcome && !Battle.state, 'seeded tactical battle does not finish');
      wins += outcome.winner === 'attacker' ? 1 : 0;
      remainingAtk += outcome.atk.reduce((sum, u) => sum + u.troops, 0);
      remainingDef += outcome.def.reduce((sum, u) => sum + u.troops, 0);
    }
    table.push({ mode: siege ? 'siege' : 'field', ratio, attackerWins: wins + '/16',
      meanAtkRemaining: Math.round(remainingAtk / 16), meanDefRemaining: Math.round(remainingDef / 16) });
  }
  console.table(table);
}
