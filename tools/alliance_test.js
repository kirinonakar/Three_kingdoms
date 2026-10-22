'use strict';
// Exercise the real campaign request UI, tactical arrival and campaign settlement without a browser.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), noop = () => {}, els = {};
const canvas = new Proxy({ createLinearGradient: () => ({ addColorStop: noop }),
  createRadialGradient: () => ({ addColorStop: noop }) },
{ get: (t, k) => t[k] || noop, set: (t, k, v) => (t[k] = v, true) });
const el = id => els[id] || (els[id] = { innerHTML: '', textContent: '', value: '', style: {}, isConnected: true,
  classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, getContext: () => canvas,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 572, height: 396 }) });
let modal = '', runTimers = false;
Object.defineProperty(el('modalRoot'), 'innerHTML', {
  get: () => modal,
  set: html => {
    modal = html;
    for (const m of html.matchAll(/<(input|select)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
      const e = el(m[3]);
      e.value = m[2].match(/\bvalue="([^"]*)"/)?.[1] || '';
      e.checked = /\bchecked\b/.test(m[2]);
      if (m[1] === 'select') {
        const content = html.slice(m.index + m[0].length).split('</select>')[0];
        const options = [...content.matchAll(/<option value="([^"]*)"([^>]*)>/g)];
        e.value = (options.find(o => /selected/.test(o[2])) || options[0])?.[1] || '';
      }
    }
  }
});
const math = Object.create(Math); math.random = () => .99; // No incidental captures in return-path assertions.
const sandbox = { console, Math: math, document: { getElementById: el, querySelectorAll: () => [], createElement: () => el('_') },
  localStorage: { getItem: () => null, setItem: noop }, setTimeout: fn => { if (runTimers) fn(); return 0; }, clearTimeout: noop };
sandbox.window = sandbox; vm.createContext(sandbox);
const root = path.join(__dirname, '..', 'js');
const marker = '    start, act, setStrat, setForm, reinforce, retreatTo, clickCell, observation,';
const battle = fs.readFileSync(path.join(root, 'battle.js'), 'utf8'); assert(battle.includes(marker));
vm.runInContext(['data.js', 'game.js', 'battle-terrain.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') +
  '\n' + battle.replace(marker, '    allianceProbe: { arriveReinforcements, end },\n' + marker), sandbox);
const { Game, Battle } = sandbox, debug = Game._debug;
function unit(g, name, troops = 2000) {
  return { officer: g.officers.find(o => o.name === name), troops, branch: '보병', form: '방원', training: 80, morale: 80 };
}
function fixture(side = 'atk', start = true) {
  Game.startNew('cao', '194');
  const g = Game.state, support = g.cities['건업'];
  g.factions.cao.ally.sunce = true; g.factions.sunce.ally.cao = true;
  g.factions.sunce.rel.cao = 60; g.factions.sunce.food = 100000;
  Object.assign(support, { troops: 10000, training: 80, morale: 80, links: [] });
  const target = g.cities[side === 'atk' ? '낙양' : '허창'];
  const from = side === 'atk' ? '허창' : '낙양';
  target.links = [from, support.name]; support.links = [target.name];
  const ctx = { from, to: target.name, atk: side === 'atk' ? 'cao' : 'lijue',
    def: side === 'atk' ? 'lijue' : 'cao', introShown: true };
  const own = unit(g, '하후돈'), foe = unit(g, '이각');
  if (start) {
    g.cities[from].troops -= 2000;
    debug.beginBattle(ctx, [side === 'atk' ? own : foe], [side === 'def' ? own : foe], side, false);
  }
  return { g, ctx, support, target, own, foe };
}
function finish(winner) {
  runTimers = true; Battle.allianceProbe.end(winner); runTimers = false;
  assert.equal(Battle.state, null);
}
let f = fixture();
Game.selectCity(f.support.name);
assert(el('cityPanel').innerHTML.includes('badge ally">동맹국 도시'));
assert(!el('cityPanel').innerHTML.includes('이 도시 공격'));
assert(el('cityList').innerHTML.includes('건업 (동맹국)'));
assert(!Game.attackTargets(f.target.name).includes(f.support.name));
Game.openReinforce(); assert(modal.includes("Game.requestAllyReinforce('건업')"));
Game.pickReinforce('건업');
assert(modal.includes('승낙')); assert(!modal.includes('reinTroops'));
const sent = f.ctx.allyRequests['건업'].troops;
assert(sent >= 300 && sent < 10000); assert.equal(f.support.troops, 10000 - sent);
assert.equal(Battle.state.pending[0].side, 'atk'); assert.equal(Battle.state.pending[0].due, 4);
const names = Battle.state.pending[0].units.map(u => u.officer.name);
assert(names.every(n => f.g.officers.find(o => o.name === n).used));
Game.requestAllyReinforce('건업'); assert.equal(f.support.troops, 10000 - sent);
assert.equal(Battle.state.pending.length, 1);
Game.requestAllyReinforce('오'); assert.equal(Battle.state.pending.length, 1, 'non-adjacent ally sent troops');
Game.requestAllyReinforce('낙양'); assert.equal(Battle.state.pending.length, 1, 'enemy city sent troops');
finish('defender'); assert.equal(f.support.troops, 10000, 'unarrived allied army did not return');
assert(names.every(n => f.g.officers.find(o => o.name === n).city === '건업'));
console.log('[OK] allied labels, no attack button, request control, autonomous roster, adjacency, duplicate guard, pending return');

function requestWith(change) {
  const f = fixture(); change(f); Game.requestAllyReinforce('건업'); return f;
}
const normal = requestWith(noop).ctx.allyRequests['건업'].troops;
const small = requestWith(f => { f.support.troops = 3000; }).ctx.allyRequests['건업'].troops;
const cold = requestWith(f => { f.g.factions.sunce.rel.cao = 0; }).ctx.allyRequests['건업'].troops;
assert(normal > small && normal > cold && small > 0 && cold > 0);
for (const [reason, change] of [
  ['군량', f => { f.g.factions.sunce.food = 0; }],
  ['수비 병력', f => { f.support.troops = 500; }],
  ['사기', f => { f.support.morale = 20; }],
  ['훈련', f => { f.support.training = 20; }],
  ['미행동 무장', f => { f.g.officers.filter(o => o.city === '건업').forEach(o => { o.used = true; }); }],
  ['수비 병력', f => { const threat = f.g.cities['오']; threat.owner = 'yuan'; threat.troops = 100000; f.support.links.push('오'); }],
  ['교전 상대', f => { f.g.factions.sunce.ally.lijue = true; }],
  ['외교 관계', f => { f.g.factions.sunce.rel.cao = -50; }]
]) {
  const f = requestWith(change), before = f.support.troops;
  assert(!f.ctx.allyRequests['건업'].accepted, reason);
  assert(modal.includes(reason)); assert.equal(Battle.state.pending.length, 0);
  Game.requestAllyReinforce('건업'); assert.equal(f.support.troops, before);
}
f = fixture(); Battle.state.round = 14; Game.requestAllyReinforce('건업');
assert.equal(Battle.state.pending.length, 0); assert(!f.ctx.allyRequests);
console.log('[OK] support scales with garrison/relations; supply, threat, readiness, dual-alliance and arrival-time refusals');

// Exercise actual tactical arrival and both settlement outcomes on each player side.
for (const side of ['atk', 'def']) for (const winner of ['attacker', 'defender']) {
  f = fixture(side); Game.requestAllyReinforce('건업');
  const sent = f.ctx.allyRequests['건업'].troops;
  Battle.state.round = 4; Battle.allianceProbe.arriveReinforcements();
  assert.equal(Battle.state.pending.length, 0);
  const helpers = Battle.state.units.filter(u => u.officer.faction === 'sunce');
  assert(helpers.length); assert(helpers.every(u => u.side === side && u.acted));
  helpers.forEach(u => { u.troops = Math.floor(u.troops * .8); });
  const returning = helpers.reduce((s, u) => s + (side === 'def' && winner === 'attacker' ? Math.round(u.troops * .6) : u.troops), 0);
  finish(winner);
  assert.equal(f.support.troops, 10000 - sent + returning, side + '/' + winner);
  assert(helpers.every(u => u.officer.city === '건업' && u.officer.faction === 'sunce'));
  assert.equal(f.target.troops, 2000, 'allied troops became occupation/garrison troops');
}
console.log('[OK] real arrival, both sides, victory/defeat returns, allied ownership and occupation accounting');

f = fixture('def', false);
Game.openDefenseDeploy(f.ctx, [f.foe]);
el('dtr_0').value = '700'; Game.updateDefenseTroops(0);
const planned = JSON.stringify(f.g.ui.defDeploy.amounts);
Game.openDefReinforce(); assert(modal.includes("Game.requestAllyReinforce('건업')"));
Game.defReinfCity('건업'); assert(modal.includes('승낙'));
const pre = f.g.ui.defDeploy.reinf[0]; assert(pre.troops > 0);
assert.equal(JSON.stringify(f.g.ui.defDeploy.amounts), planned, 'request lost defense edits');
Game.closeModal(); assert(modal.includes('수비 편성'));
Game.confirmDefenseDeploy(); assert(Battle.active);
assert.equal(Battle.state.pending[0].due, 3, 'pre-requested ally did not receive two-day arrival');
Game.requestAllyReinforce('건업'); assert.equal(Battle.state.pending.length, 1, 'pre-battle request guard was reset');
finish('defender'); assert.equal(f.support.troops, 10000);
console.log('[OK] defensive pre-request preserves edits, two-day arrival, guard across battle start and full pending refund');
