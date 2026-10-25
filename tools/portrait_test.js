'use strict';
// Exercise actual portrait pointer handlers without controlling a browser.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const documentEvents = {}, windowEvents = {}, attrs = {};
let now = 0, timerId = 0;
const timers = new Map();
function advance(ms) {
  now += ms;
  for (const [id, timer] of [...timers]) if (timers.has(id) && timer.due <= now) {
    timers.delete(id); timer.fn();
  }
}
const tip = { hidden:true, innerHTML:'', style:{},
  getAttribute:key=>attrs[key], setAttribute:(key,value)=>{attrs[key]=value;},
  getBoundingClientRect:()=>({width:254,height:285}) };
const listen = events => (name, fn) => (events[name] ||= []).push(fn);
const sandbox = { console, innerWidth:390, innerHeight:844,
  setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, due:now + ms }); return id; },
  clearTimeout:id=>timers.delete(id),
  document:{getElementById:id=>id==='pfTip'?tip:null, addEventListener:listen(documentEvents)},
  addEventListener:listen(windowEvents) };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(['data.js','combat-rules.js','strategy-systems.js','save-transfer.js','game.js']
  .map(f=>fs.readFileSync(path.join(__dirname,'..','js',f),'utf8')).join('\n'), sandbox);
vm.runInContext('bindPortraitTip()', sandbox);
function officer(name, file) {
  const src = 'assets/portraits/' + file + '.jpg';
  assert(fs.existsSync(path.join(__dirname,'..',src)));
  const host = {getAttribute:key=>({'data-portrait':src,'data-name':name})[key]};
  const card = {querySelector:()=>host};
  const target = {closest:selector=>selector==='[data-portrait]'?null:card};
  host.closest = selector=>selector==='[data-portrait]'?host:card;
  return {target,host,src};
}
const cao = officer('조조','caocao'), guan = officer('관우','guanyu');
const outside = {closest:()=>null};
function emit(type, target=cao.target, extra={}) {
  const event = {target, pointerType:'touch', pointerId:1, isPrimary:true, clientX:370, clientY:800,
    preventDefault:()=>assert.fail('portrait must preserve existing selection actions'),
    stopPropagation:()=>assert.fail('portrait must preserve existing selection actions'), ...extra};
  for (const fn of documentEvents[type] || []) fn(event);
  return event;
}
function windowEvent(type) { for (const fn of windowEvents[type] || []) fn(); }
function tap(target=cao.target) {
  emit('pointerover',target); emit('pointerdown',target); advance(100);
  emit('pointerup',target); emit('pointerout',target); emit('click',target);
}
function longTap(target=cao.target) {
  emit('pointerdown',target); advance(499); assert(tip.hidden,'portrait waits for the long press threshold');
  advance(1);
  emit('pointerup',target); emit('pointerout',target);
  const click = emit('click',target,{
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; }
  });
  assert(click.prevented && click.stopped,'long press must not select a faction or activate its card');
}
tap();
advance(500); assert(tip.hidden,'short taps preserve selection without displaying a portrait');
longTap();
assert.equal(tip.hidden,false,'long press opens the portrait and survives touch pointerout');
assert.match(tip.innerHTML,/caocao.jpg.*조조/);
assert(parseFloat(tip.style.left)>=10 && parseFloat(tip.style.left)+254<=380);
assert(parseFloat(tip.style.top)>=10 && parseFloat(tip.style.top)+285<=834);
tap(); assert(tip.hidden,'a short tap dismisses the portrait and keeps its normal action');
longTap(); longTap(guan.target);
assert.equal(tip.hidden,false); assert.equal(attrs['data-src'],guan.src);
emit('pointerdown',outside); assert(tip.hidden,'tapping outside closes the portrait');
emit('pointerdown'); emit('pointermove',cao.target,{clientY:750});
advance(600); emit('pointerup'); assert(tip.hidden,'dragging and returning to the name must not open a portrait');
emit('pointerdown'); emit('pointerup',cao.target,{clientY:750});
advance(600);
assert(tip.hidden,'a drag ending without a move event is also ignored');
emit('pointerdown'); emit('pointercancel'); advance(600); emit('pointerup'); assert(tip.hidden);
emit('pointerdown'); emit('pointerdown',guan.target,{pointerId:2,isPrimary:false});
advance(600); emit('pointerup'); assert(tip.hidden,'multi-touch is not a portrait tap');
emit('pointerdown'); windowEvent('scroll'); advance(600); emit('pointerup');
assert(tip.hidden,'scrolling cancels pending taps');
longTap(); windowEvent('scroll'); assert(tip.hidden);
longTap(); windowEvent('resize'); assert(tip.hidden);
longTap(); windowEvent('blur'); assert(tip.hidden);
longTap(); emit('keydown',outside,{key:'Escape'}); assert(tip.hidden);
emit('pointerdown'); windowEvent('blur'); advance(600); assert(tip.hidden);
cao.host.isConnected = false;
emit('pointerdown'); advance(600); emit('pointerup'); assert(tip.hidden,'removed cards do not show stale portraits');
delete cao.host.isConnected;
emit('pointerover',cao.target,{pointerType:'mouse'});
assert.equal(tip.hidden,false,'desktop hover still opens the portrait');
emit('pointerout',cao.target,{pointerType:'mouse',relatedTarget:cao.host});
assert.equal(tip.hidden,false,'moving between name and badge keeps the portrait');
emit('pointerout',cao.target,{pointerType:'mouse',relatedTarget:outside}); assert(tip.hidden);
emit('pointerup',cao.target,{pointerType:'mouse'}); assert(tip.hidden);
assert.equal(timers.size,0);
console.log('Portrait long press, short-tap actions, dismissal, gesture cancellation, viewport bounds and desktop hover passed.');
