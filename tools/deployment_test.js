'use strict';
// Execute the real modal input handlers with a small DOM fixture, without a browser.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const noop = () => {}, els = {}, modalIds = new Set();
const ctx = new Proxy({}, { get: (t, k) => t[k] || noop, set: (t, k, v) => (t[k] = v, true) });
let starts = [], reinforcements = [];
function element(id) {
  return els[id] || (els[id] = { innerHTML: '', textContent: '', value: '', checked: false,
    style: {}, isConnected: true, classList: { add: noop, remove: noop, toggle: noop }, getContext: () => ctx });
}
let modalHTML = '';
Object.defineProperty(element('modalRoot'), 'innerHTML', {
  get: () => modalHTML,
  set(html) {
    modalHTML = html;
    modalIds.forEach(id => delete els[id]); modalIds.clear();
    for (const match of html.matchAll(/<(input|select|b|p)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
      const [, tag, attrs, id] = match;
      const contents = tag === 'input' ? '' : html.slice(match.index + match[0].length).split('</' + tag + '>')[0];
      modalIds.add(id); const el = element(id);
      if (tag === 'select') {
        const options = [...contents.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)];
        const option = options.find(o => /\bselected\b/.test(o[1])) || options[0];
        el.value = option ? (option[1].match(/value="([^"]*)"/)?.[1] ?? option[2]) : '';
      }
      el.textContent = contents.replace(/<[^>]+>/g, '');
      for (const key of ['value', 'max', 'oninput']) {
        const value = attrs.match(new RegExp('\\b' + key + '="([^"]*)"'))?.[1];
        if (value !== undefined) el[key] = value;
      }
      el.checked = /\bchecked\b/.test(attrs);
    }
  }
});
const sandbox = { console,
  document: { getElementById: element, querySelectorAll: () => [], createElement: () => element('_') },
  localStorage: { getItem: () => null, setItem: noop }, setTimeout: () => 0, clearTimeout: noop,
  Battle: { start(opts) { starts.push(opts); }, get active() { return starts.length > 0; },
    reinforce(units, side, opts) { reinforcements.push({ units, side, ...opts }); return true; }, reinforceDays: 3 }
};
sandbox.window = sandbox; vm.createContext(sandbox);
vm.runInContext(['data.js', 'combat-rules.js', 'strategy-systems.js', 'save-transfer.js', 'game.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')).join('\n'), sandbox);
const { Game } = sandbox;
function fixture(troops = 3201) {
  starts = []; reinforcements = []; Game.startNew('cao');
  const g = Game.state;
  const namesAt = city => g.officers.filter(o => o.city === city && o.faction === 'cao' && o.status === 'active').map(o => o.name);
  const cities = Object.values(g.cities).filter(c => c.owner === 'cao' && namesAt(c.name).length >= 2);
  const source = cities[0], support = cities[1];
  assert(source && support);
  const target = Object.values(g.cities).find(c => c.owner !== 'cao');
  source.troops = troops; source.links.push(target.name); support.links.push(target.name);
  target.links = [source.name, support.name];
  return { g, source, support, target, names: namesAt(source.name).slice(0, 2), supportNames: namesAt(support.name) };
}
function input(id, value) {
  const el = els[id]; assert(el && el.oninput, id + ': input handler is missing');
  el.value = String(value); vm.runInContext(el.oninput, sandbox);
}
let f = fixture();
Game.openDeploy(f.source.name, f.target.name, f.names.join('|'));
assert.equal(Number(els.tr_0.value) + Number(els.tr_1.value), 1201);
assert.equal(els.deployTotal_0.textContent, '편성 1,201 · 잔여 2,000');
Game.confirmDeploy(); assert.equal(starts.length, 1); assert.equal(f.source.troops, 2000);
f = fixture(1201);
Game.openDeploy(f.source.name, f.target.name, f.names.join('|'));
assert(modalHTML.includes('현재 병력 1,201</b>'));
assert(!modalHTML.includes('1,201 /'));
assert.equal(Number(els.tr_0.value) + Number(els.tr_1.value), 0);
const emptyCommands = f.g.cmd;
Game.confirmDeploy(); assert.equal(starts.length, 0); assert.equal(f.g.cmd, emptyCommands);
input('tr_1', 600);
const originalInput = els.tr_0, originalModal = modalHTML;
input('tr_0', 100);
assert.equal(Game.state.ui.deploy.amounts[f.names[0]], 100);
assert.equal(els.deployTotal_0.textContent, '편성 700 · 잔여 501');
assert.equal(els.tr_1.max, '1101');
assert.equal(els.tr_0, originalInput); assert.equal(modalHTML, originalModal, 'typing rebuilds the modal');
input('tr_1', 2000);
assert.equal(els.tr_1.value, '1101'); assert.equal(els.tr_0.value, '100');
assert.equal(els.deployTotal_0.textContent, '편성 1,201 · 잔여 0');
input('tr_0', '');
assert.equal(els.tr_0.value, ''); assert.equal(Game.state.ui.deploy.amounts[f.names[0]], 0);
assert.equal(els.tr_1.max, '1201');
input('tr_0', 100);
// Unprocessed over-budget edits at confirmation cannot silently start a different army.
els.tr_0.value = '9999'; const commands = f.g.cmd;
Game.confirmDeploy(); assert.equal(starts.length, 0); assert.equal(f.source.troops, 1201); assert.equal(f.g.cmd, commands);
assert.equal(els.tr_0.value, '1201'); assert.equal(els.tr_1.value, '0');
Game.confirmDeploy(); assert.equal(starts.length, 1); assert.equal(f.source.troops, 0);
assert.equal(starts[0].atk.units.reduce((sum, u) => sum + u.troops, 0), 1201);

// Initial attack allocation leaves 2,000 troops, even at the reserve boundary.
for (const troops of [3, 2000, 2003]) {
  f = fixture(troops); Game.openDeploy(f.source.name, f.target.name, f.names.join('|'));
  assert.equal(Number(els.tr_0.value) + Number(els.tr_1.value), Math.max(0, troops - 2000));
}
// The visible count is current garrison, including troops above the population cap.
f = fixture(25000); Game.openDeploy(f.source.name, f.target.name, f.names.join('|'));
assert(modalHTML.includes('현재 병력 25,000</b>')); assert.equal(els.tr_0.max, '10000');

// Joint deployment budgets are independent, and adding/removing a city preserves edits.
f = fixture(3000); f.support.troops = 800;
Game.openDeploy(f.source.name, f.target.name, f.names.join('|')); input('tr_0', 500);
Game.addDeployCity(f.support.name); Game.togglePick(f.supportNames[0]); Game.confirmPick();
assert.equal(els.tr_0.value, '500'); assert.equal(els.tr_2.value, '0');
input('tr_2', 1500); assert.equal(els.tr_2.value, '800');
assert.equal(els.deployTotal_0.textContent, '편성 1,000 · 잔여 2,000');
assert.equal(els.deployTotal_1.textContent, '편성 800 · 잔여 0');
Game.removeDeployCity(f.support.name); assert.equal(els.tr_0.value, '500');
assert.equal(f.g.ui.deploy.parts.length, 1);
Game.addDeployCity(f.support.name); Game.togglePick(f.supportNames[0]); Game.confirmPick();
assert.equal(els.tr_0.value, '500'); assert.equal(els.tr_2.value, '800');
Game.confirmDeploy(); assert.equal(f.source.troops, 2000); assert.equal(f.support.troops, 0);
assert.equal(starts[0].atk.units.reduce((sum, u) => sum + u.troops, 0), 1000);
assert.equal(reinforcements[0].units[0].troops, 800);

// Defense uses the same live limits and reports unassigned troops as reserve.
f = fixture(1201);
Game.openDefenseDeploy({ from: f.target.name, to: f.source.name, atk: f.target.owner, def: 'cao' }, []);
const dd = f.g.ui.defDeploy;
dd.names.forEach((_, i) => input('dtr_' + i, 0));
input('dtr_0', 500); input('dtr_1', 900);
assert.equal(els.dtr_1.value, '701'); assert.equal(els.defTotal.textContent, '1,201');
assert.equal(els.defReserve.textContent, '0'); assert.equal(dd.amounts[dd.names[1]], 701);
input('dtr_0', ''); assert.equal(dd.amounts[dd.names[0]], 0); assert.equal(els.defReserve.textContent, '500');
els.dtr_0.value = '5000'; Game.confirmDefenseDeploy(); assert.equal(starts.length, 0);
input('dtr_0', 400); Game.confirmDefenseDeploy();
assert.equal(starts.length, 1); assert.equal(starts[0].def.units.reduce((s, u) => s + u.troops, 0), 400);
assert.equal(f.g.battleCtx.defReserve, 801);
console.log('[OK] attack/defense live totals, shared city budgets, current-only count, empty input, final guards, joint deployment');

// Drive animation frames explicitly: committing an army must not open or resolve
// its battle before the map arrow reaches its destination and finishes its hold.
let frameId = 0;
const frames = new Map(), colors = [];
sandbox.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
sandbox.cancelAnimationFrame = id => frames.delete(id);
element('attackIntro').style.setProperty = (key, value) => colors.push(value);
vm.runInContext(`
  cvM = { isConnected: true, width: 1200, height: 1000 };
  ctxM = document.getElementById('mapCanvas').getContext('2d');
  drawMap = () => drawAttackIntro(ctxM);
`, sandbox);
function frame(time) {
  const callbacks = [...frames.values()]; frames.clear();
  callbacks.forEach(fn => fn(time));
}
f = fixture();
Game.openDeploy(f.source.name, f.target.name, f.names.join('|'));
Game.confirmDeploy();
assert.equal(starts.length, 0); assert.equal(f.g.battleActive, false);
assert.equal(f.g.ui.attackIntro.from, f.source.name);
assert.equal(f.g.ui.attackIntro.to, f.target.name);
assert.equal(colors.at(-1), f.g.factions.cao.color);
assert.equal(element('app').inert, true); assert.equal(element('btnEndTurn').disabled, true);
const introCommands = f.g.cmd, introMonth = f.g.month;
Game.endTurn(); Game.confirmDeploy();
assert.equal(f.g.cmd, introCommands); assert.equal(f.g.month, introMonth);
frame(0); frame(410); frame(820); frame(1119);
assert.equal(starts.length, 0, 'battle opened before arrival hold completed');
frame(1120);
assert.equal(starts.length, 1); assert.equal(f.g.ui.attackIntro, undefined);
assert.equal(element('app').inert, false); assert.equal(element('attackIntro').hidden, true);
assert.equal(frames.size, 0);

// Enemy attacks announce the correct faction and open defense deployment once.
f = fixture(); f.g.turn = 4;
f.target.links.push(f.source.name);
let resumed = 0;
Game._debug.execAIAct(f.target.owner, { t: 'attack', cn: f.target.name,
  target: f.source.name, troops: 1000 }, () => resumed++);
assert(f.g.ui.attackIntro); assert.equal(f.g.ui.defDeploy, undefined);
assert.equal(colors.at(-1), f.g.factions[f.target.owner].color);
frame(2000); frame(3120);
assert(f.g.ui.defDeploy); assert.equal(starts.length, 0);
Game.confirmDefenseDeploy();
assert.equal(starts.length, 1); assert.equal(frames.size, 0, 'defense replayed the intro');
assert.equal(resumed, 0, 'AI resumed before the player battle ended');

// AI versus AI also waits to change ownership/casualties until after the arrow.
f = fixture();
const attackOwner = f.source.owner, previousTroops = f.target.troops;
f.g.pf = 'sunce';
Game._debug.execAIAct(attackOwner, { t: 'attack', cn: f.source.name,
  target: f.target.name, troops: 1000 }, noop);
assert(f.g.ui.attackIntro); assert.equal(f.target.troops, previousTroops);
frame(4000); frame(5120);
assert.equal(f.g.ui.attackIntro, undefined);
assert.equal(starts.length, 0);

// Starting another game cancels the pending battle and restores input.
f = fixture();
Game.openDeploy(f.source.name, f.target.name, f.names.join('|')); Game.confirmDeploy();
const staleFrame = [...frames.values()][0];
Game.startNew('liubei'); staleFrame(9000);
assert.equal(starts.length, 0); assert.equal(frames.size, 0);
assert.equal(element('app').inert, false); assert.equal(element('attackIntro').hidden, true);
console.log('[OK] faction arrow timing, attack/defense/AI battle ordering, input lock, stale-frame cancellation (DOM/canvas fixture)');
