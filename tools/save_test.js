/* node tools/save_test.js — 저장 공간 분리·회전·이전 저장 호환성 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const store = {}, els = {}, noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => k in t ? t[k] : noop, set: (t, k, v) => (t[k] = v, true) });
const el = id => els[id] || (els[id] = {
  innerHTML: '', textContent: '', style: {},
  classList: { add: noop, remove: noop, toggle: noop }, getContext: () => ctx
});
let now = 1000, confirmed = true, confirmations = 0, failWrite = false;
class Clock extends Date { static now() { return now++; } }
const sandbox = {
  console, Date: Clock,
  document: { getElementById: el, querySelectorAll: () => [], createElement: () => el('_') },
  localStorage: {
    getItem: k => store[k] || null,
    setItem(k, v) { if (failWrite) throw new Error('quota'); store[k] = String(v); },
    removeItem: k => delete store[k]
  },
  setTimeout: fn => (fn(), 0), clearTimeout: noop,
  confirm: () => (confirmations++, confirmed)
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(['data.js', 'combat-rules.js', 'strategy-systems.js', 'save-transfer.js', 'game.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')).join('\n'), sandbox);
const { Game } = sandbox;
const key = (n, kind = 'auto') => 'sangokji_save_v1_' + (kind === 'manual' ? 'manual_slot' : 'slot') + n;
const saved = (n, kind) => JSON.parse(store[key(n, kind)]);
const autoEntries = () => Object.fromEntries(Object.entries(store).filter(([k]) => /^sangokji_save_v1_(slot|meta)\d$/.test(k)));
const clear = () => Object.keys(store).forEach(k => delete store[k]);

Game.startNew('cao', '194');
Game.saveGame();
assert.equal(Object.keys(store).length, 0, 'opening the picker must not save');
for (let n = 1; n <= 3; n++) assert(el('modalRoot').innerHTML.includes('id="saveSlot' + n + '"'));
Game.closeModal();
assert.equal(Object.keys(store).length, 0, 'cancelling the picker must not save');
Game.saveGame(false, 0);
Game.saveGame(false, 4);
Game.saveGame(false, 1.5);
assert.equal(Object.keys(store).length, 0, 'invalid slot must not write');

for (const slot of [3, 1, 2]) {
  Game.state.turn = slot * 10;
  Game.saveGame(false, slot);
  assert.equal(saved(slot, 'manual').turn, slot * 10);
}
assert.equal(Object.keys(store).length, 6);
const manualSnapshot = { ...store };
for (let turn = 101; turn <= 108; turn++) { Game.state.turn = turn; Game.saveGame(true); }
for (const [k, v] of Object.entries(manualSnapshot)) assert.equal(store[k], v, 'autosave overwrote manual data or metadata');
assert.deepEqual([1, 2, 3].map(n => saved(n).turn).sort(), [106, 107, 108]);
assert.equal(Object.keys(store).length, 12, 'exactly six data slots and six metadata entries');

const autoSnapshot = autoEntries();
confirmed = false;
Game.saveGame();
const picker = el('modalRoot').innerHTML;
Game.state.turn = 200;
Game.saveGame(false, 2);
assert.equal(store[key(2, 'manual')], manualSnapshot[key(2, 'manual')]);
assert.equal(el('modalRoot').innerHTML, picker, 'declining overwrite should leave picker open');
confirmed = true;
Game.saveGame(false, 2);
assert.equal(saved(2, 'manual').turn, 200);
assert.equal(el('modalRoot').innerHTML, '');
assert.deepEqual(autoEntries(), autoSnapshot, 'manual save changed autosave history');
assert.equal(confirmations, 2, 'only occupied manual slots require overwrite confirmation');

Game.startNew('liubei', '219');
Game.loadGame(3, 'manual');
assert.equal(Game.state.pf, 'cao');
assert.equal(Game.state.turn, 30);
Game.loadGame(2, 'manual');
assert.equal(Game.state.turn, 200);
Game.loadGame(2);
assert.equal(Game.state.turn, saved(2).turn, 'numeric legacy API must still load automatic slots');
Game.loadGame();
assert.equal(Game.state.turn, 200, 'no-argument load must choose latest across both kinds');
Game.openLoad();
assert(el('modalRoot').innerHTML.includes("Game.loadGame(2,'manual')"));
assert(el('modalRoot').innerHTML.includes("Game.loadGame(2,'auto')"));
assert(el('modalRoot').innerHTML.includes('수동저장 (3 / 3)'));
assert(el('modalRoot').innerHTML.includes('자동저장 (3 / 3)'));
Game.reset();
assert(el('modalRoot').innerHTML.includes('data-save-kind="manual"'));
assert(el('modalRoot').innerHTML.includes('data-save-kind="auto"'));

Game.startNew('cao', '194');
const beforeGuards = { ...store };
Game.state.aiRunning = true;
Game.saveGame(false, 1);
Game.state.aiRunning = false;
Game.state.battleActive = true;
Game.saveGame(false, 1);
Game.state.battleActive = false;
assert.deepEqual(store, beforeGuards, 'busy game should not be saved manually');
Game.saveGame();
failWrite = true;
Game.saveGame(false, 1);
failWrite = false;
assert(el('toast').textContent.includes('저장 실패'));
assert(el('modalRoot').innerHTML.includes('id="saveSlot1"'));
assert.deepEqual(store, beforeGuards, 'failed write changed saves');

const oldSlots = autoEntries();
clear(); Object.assign(store, oldSlots);
Game.openLoad();
assert.deepEqual(autoEntries(), oldSlots, 'existing three-slot saves must stay intact');
Game.loadGame(1);
assert.equal(Game.state.turn, saved(1).turn);
const legacy = JSON.stringify(Game.state);
clear(); store.sangokji_save_v1 = legacy;
Game.openLoad();
assert.equal(store[key(1)], legacy, 'single legacy save must migrate to auto slot 1');
assert(!store[key(1, 'manual')]);
Game.loadGame(1);
assert.equal(Game.state.turn, JSON.parse(legacy).turn);
// Hidden honor survives real slots and JSON imports; old saves acquire stable defaults.
Game.startNew('cao','194');
const honored=Game.state.officers.find(o=>o.name==='하후돈');honored.honor=13;honored.loyalty=67;
const prisoner=Game.state.officers.find(o=>o.name==='안량');prisoner.status='pow';prisoner.city='허창';prisoner.captivityMonths=4;
Game.saveGame(false,1);Game.startNew('liubei','219');Game.loadGame(1,'manual');
assert.equal(Game.state.officers.find(o=>o.name==='하후돈').honor,95,'canonical officers use historical values even if an older save stored a generated value');
assert.equal(Game.state.officers.find(o=>o.name==='하후돈').loyalty,67);
assert.equal(Game.state.officers.find(o=>o.name==='안량').captivityMonths,4);
const json=JSON.stringify(Game.state);
assert.equal(Game._debug.parseSaveFile(json).officers.find(o=>o.name==='하후돈').honor,95);
const generatedHonorSave=JSON.parse(json);generatedHonorSave.ver=6;generatedHonorSave.officers.find(o=>o.name==='하후돈').honor=13;
assert.equal(Game._debug.parseSaveFile(JSON.stringify(generatedHonorSave)).officers.find(o=>o.name==='하후돈').honor,95);
assert.equal(Game._debug.parseSaveFile(json).officers.find(o=>o.name==='안량').captivityMonths,4);
const old=JSON.parse(json);old.ver=5;old.officers.forEach(o=>{delete o.honor;delete o.captivityMonths;});
const migrated=Game._debug.parseSaveFile(JSON.stringify(old)),again=Game._debug.parseSaveFile(JSON.stringify(old));
assert(migrated.officers.every(o=>Number.isInteger(o.honor)&&o.honor>=0&&o.honor<=100));
assert.deepEqual(migrated.officers.map(o=>o.honor),again.officers.map(o=>o.honor));
assert.equal(migrated.officers.find(o=>o.name==='하후돈').loyalty,67);
assert.equal(migrated.officers.find(o=>o.name==='안량').captivityMonths,0);
store[key(2,'manual')]=JSON.stringify(old);Game.loadGame(2,'manual');
assert.deepEqual(Game.state.officers.map(o=>o.honor),migrated.officers.map(o=>o.honor));
for (const invalid of [-1,101,1.5,null,'50']) {
  const broken=JSON.parse(json);broken.officers[0].honor=invalid;
  assert.throws(()=>Game._debug.parseSaveFile(JSON.stringify(broken)),/의리/);
}
for (const invalid of [-1,120001,1.5,null,'3']) {
  const broken=JSON.parse(json);broken.officers.find(o=>o.name==='안량').captivityMonths=invalid;
  assert.throws(()=>Game._debug.parseSaveFile(JSON.stringify(broken)),/억류/);
}
console.log('[OK] manual slot selection/cancel/overwrite, independent three-slot autosave rotation, load/title lists, guards/failure, old save compatibility');
