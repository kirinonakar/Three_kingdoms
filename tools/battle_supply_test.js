'use strict';
// 실제 게임·전술 전투의 라운드/종료 경로를 검증한다. 브라우저는 사용하지 않는다.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),els={},noop=()=>{};
const canvas=new Proxy({createLinearGradient:()=>({addColorStop:noop}),createRadialGradient:()=>({addColorStop:noop})},
  {get:(t,k)=>t[k]||noop,set:(t,k,v)=>(t[k]=v,true)});
const el=id=>els[id]||(els[id]={innerHTML:'',textContent:'',value:'',style:{},
  classList:{add:noop,remove:noop,toggle:noop},addEventListener:noop,getContext:()=>canvas,
  getBoundingClientRect:()=>({left:0,top:0,width:572,height:396})});
let timers=false,seed=423;
const math=Object.create(Math);math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const sandbox={console,Math:math,document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('_')},
  localStorage:{getItem:()=>null,setItem:noop},setTimeout:fn=>{if(timers)fn();return 0;},clearTimeout:noop};
sandbox.window=sandbox;vm.createContext(sandbox);
const marker='    start, act, setStrat, setForm, reinforce, retreatTo, clickCell, observation,';
const source=fs.readFileSync(path.join(root,'js/battle.js'),'utf8');assert(source.includes(marker));
vm.runInContext(['data.js','combat-rules.js','strategy-systems.js','save-transfer.js','game.js','battle-terrain.js'].map(f=>fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')+'\n'+
  source.replace(marker,'    supplyProbe: { roundStart, end },\n'+marker),sandbox);
const {Game,Battle}=sandbox,d=Game._debug,p=Battle.supplyProbe;
function fresh(){Game.startNew('cao','194');return Game.state;}
function units(name,troops=6000){return [{officer:{name,wu:80,zhi:70,pol:70,cha:70,skill:''},
  troops,branch:'보병',form:'방원',training:80,morale:80}];}
function setup(food=1000,auto=false,onEnd=noop){
  const g=fresh(),target=g.cities['낙양'];
  target.links.forEach(n=>{g.cities[n].owner='cao';}); // 보급 수치 검사 중 다른 도시 원군을 배제한다
  g.factions.cao.food=food;g.factions.lijue.food=1000;
  const ctx={from:'허창',to:'낙양',atk:'cao',def:'lijue',introShown:true,after:onEnd};
  g.cities['허창'].troops-=6000;
  d.beginBattle(ctx,units('하후돈'),units('이각'),'atk',auto);
  return {g,ctx,b:Battle.state};
}

let g=fresh(),c=g.cities['허창'];c.troops=9000;
assert.equal(d.cityFoodUpkeep(c),100,'peacetime should consume a third less than /60');
c.troops=d.capOf(c)+900;
assert.equal(d.cityFoodUpkeep(c),Math.ceil((c.troops+900)/90));
let ctx={atk:'cao',def:'lijue'};g.factions.cao.food=100;g.factions.lijue.food=100;
for(let round=1;round<=6;round++)d.consumeBattleSupply(ctx,{round,atk:100,def:50});
assert.equal(g.factions.cao.food,99);assert.equal(g.factions.lijue.food,99,'rounding must accumulate across rounds');
assert.equal(d.consumeBattleSupply(ctx,{round:6,atk:10000,def:10000}),null);
assert.equal(g.factions.cao.food,99,'a repeated round must not double-charge');
console.log('[OK] reduced peace upkeep, excess-only penalty, cumulative rounding, duplicate-round guard');

let battle=setup();g=battle.g;ctx=battle.ctx;let b=battle.b;
assert.equal(g.factions.cao.food,990);assert.equal(g.factions.lijue.food,990);
p.roundStart();assert.equal(g.factions.cao.food,990,'UI refresh/round re-entry must not charge twice');
b.units.find(u=>u.side==='atk').troops=3000;
assert(Battle.reinforce(units('하후연',3000),'atk',{from:'진류',delay:3}));
for(let round=2;round<=4;round++){b.round=round;p.roundStart();}
assert.equal(ctx.supply.atk.cost,40,'marching reinforcements must consume alongside active troops');
assert.equal(g.factions.cao.food,960);assert.equal(b.pending.length,0);
assert(Battle.observation().supply.atk.paid===40);
assert(el('bRoundInfo').textContent.includes('전투 군량 -40'));
console.log('[OK] real campaign callback, both armies charged, marching/arrived reinforcements, observation and battle display');

// Initial AI defense requests share the player's two-round preparation benefit.
// A later request or the siege following a field battle keeps the normal march.
for (const siege of [false,true]) for (const request of ['prepared','later','continued']) {
  g=fresh();
  const target=g.cities['낙양'],source=g.cities['장안'];
  const support=g.officers.find(o=>o.name==='곽사');
  g.officers.filter(o=>o.city===source.name).forEach(o=>{o.city=target.name;});
  Object.assign(support,{city:source.name,faction:'lijue',status:'active',used:true});
  source.owner='lijue';source.troops=6000;target.links=[source.name];
  ctx={from:'허창',to:target.name,atk:'cao',def:'lijue',introShown:true,siege,
    preserveReinf:request==='continued'};
  if(request==='later') source.troops=0;
  d.beginBattle(ctx,units('하후돈',20000),units('이각',2000),'atk',false);
  b=Battle.state;
  if(request==='later') {source.troops=6000;b.round=2;p.roundStart();}
  const expected=request==='prepared'?2:3;
  assert.equal(b.pending.length,1,'AI defender should request one reinforcement');
  assert.equal(b.pending[0].days,expected,request+': wrong march duration');
  assert.equal(b.pending[0].due,b.round+expected);
  assert.equal(ctx.foeReinf[support.name],source.name,'reinforcement origin must be tracked');
  assert.equal(ctx.foeSent.def,1);
  assert.equal(source.troops,2400,'reinforcements must be deducted once');
  const due=b.pending[0].due;
  for(let round=b.round+1;round<=due;round++) {
    b.round=round;b.busy=false;p.roundStart();
    const arrived=b.units.find(u=>u.name===support.name);
    if(round<due) {assert(!arrived,'reinforcement arrived early');assert.equal(b.pending.length,1);}
    else {assert(arrived&&arrived.acted,'arrivals must wait until the next round to act');assert.equal(b.pending.length,0);}
  }
  assert.equal(source.troops,2400,'an officer already marching/fighting must not be dispatched twice');
}
console.log('[OK] AI prepared defense arrives after two rounds, later/continued defense after three, used officers and no duplicate dispatch');

battle=setup(0);g=battle.g;b=battle.b;
assert.equal(g.factions.cao.food,0);assert.equal(b.units.find(u=>u.side==='atk').morale,72);
assert.equal(b.units.find(u=>u.side==='def').morale,80);
const supply=b.supply.atk;assert.equal(supply.moraleLoss,8);assert.equal(supply.paid,0);
battle=setup(5);assert.equal(battle.b.units.find(u=>u.side==='atk').morale,76);
assert.equal(battle.g.factions.cao.food,0);
console.log('[OK] empty/partial supply lowers only the affected side morale and never makes food negative');

let ended=0;
timers=true;battle=setup(1000,true,()=>ended++);timers=false;
assert.equal(ended,1);assert.equal(Battle.state,null);
assert(battle.ctx.supply.round>=1&&battle.ctx.supply.round<=15);
assert(battle.ctx.supply.atk.paid>0);assert.equal(battle.g.factions.cao.food,1000-battle.ctx.supply.atk.paid);
assert(battle.g.log.some(l=>l.m.includes('전투 추가 군량')));
console.log('[OK] delegated tactical battle consumes supplies once and reaches campaign result/log');

function quick(food,attack=6000,defend=6000){
  g=fresh();g.factions.cao.food=food;g.factions.lijue.food=1000;seed=423;
  const ctx={atk:'cao',def:'lijue'},a=units('하후돈',attack),def=units('이각',defend);
  const result=d.autoResolve(ctx,a,def,true);
  assert.equal(a[0].morale,80,'quick simulation must not mutate the source army');
  assert.equal(g.factions.cao.food,Math.max(0,food-ctx.supply.atk.cost));
  return {g,ctx,result};
}
const equal=quick(1000),fast=quick(1000,24000),hungry=quick(0);
assert(equal.result.rounds>fast.result.rounds,'an even quick battle should last longer');
assert.equal(equal.ctx.supply.atk.cost,Math.ceil(6000*equal.result.rounds/600));
assert.equal(equal.ctx.supply.def.cost,Math.ceil(6000*equal.result.rounds/600));
assert.equal(hungry.g.factions.cao.food,0);
assert(hungry.result.atk.reduce((s,u)=>s+u.troops,0)<equal.result.atk.reduce((s,u)=>s+u.troops,0));
console.log('[OK] AI quick battle uses the same daily supply formula, duration scaling and shortage effect');
