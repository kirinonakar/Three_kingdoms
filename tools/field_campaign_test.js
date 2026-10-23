'use strict';
// Run the real tactical victory callback into the real campaign/siege transition.
// Only DOM/canvas and the presentation timer are replaced; no battle result is fabricated.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const noop=()=>{},els={},timers=[];
const canvas=new Proxy({createLinearGradient:()=>({addColorStop:noop}),createRadialGradient:()=>({addColorStop:noop})},
  {get:(t,k)=>t[k]||noop,set:(t,k,v)=>(t[k]=v,true)});
const element=id=>els[id]||(els[id]={innerHTML:'',textContent:'',style:{},handlers:{},
  classList:{add:noop,remove:noop,toggle:noop},getContext:()=>canvas,
  addEventListener(type,fn){this.handlers[type]=fn;},getBoundingClientRect:()=>({left:0,top:0,width:572,height:396})});
const sandbox={console,document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('_')},
  localStorage:{getItem:()=>null,setItem:noop},setTimeout:(fn,ms)=>(timers.push({fn,ms}),timers.length),clearTimeout:noop};
sandbox.window=sandbox;vm.createContext(sandbox);
const marker='    start, act, setStrat, setForm, reinforce, retreatTo, clickCell, observation,';
const source=['data.js','combat-rules.js','strategy-systems.js','save-transfer.js','game.js','battle-terrain.js','battle.js']
  .map(file=>fs.readFileSync(path.join(__dirname,'..','js',file),'utf8')).join('\n');
assert(source.includes(marker));
vm.runInContext(source.replace(marker,'    probe: {step,checkForts},\n'+marker),sandbox);
const {Game,Battle}=sandbox;
const completePresentation=()=>{
  const index=timers.findIndex(t=>t.ms===1400);
  assert(index>=0,'victory must schedule the real result callback');
  timers.splice(index,1)[0].fn();
};
for(const side of ['atk','def']) {
  Game.startNew(side==='atk'?'cao':'lijue','194');timers.length=0;
  const g=Game.state;let completed=0;
  const unit=(name,troops)=>({officer:g.officers.find(o=>o.name===name),troops,branch:'보병',form:'어린',training:80,morale:80});
  const ctx={atk:'cao',def:'lijue',from:'허창',to:'낙양',introShown:true,siege:false,after:()=>completed++};
  Game._debug.beginBattle(ctx,[unit('하후돈',6000)],[unit('이각',4000)],side,false);
  const field=Battle.state,fieldMap=JSON.stringify(field.terrain);
  assert.equal(field.opts.siege,false);assert.equal(ctx.defReserve,1000);
  assert.equal(field.units.filter(u=>u.side==='def').reduce((s,u)=>s+u.troops,0)+ctx.defReserve,4000,'reserve must conserve troops');
  for(const u of field.units.filter(u=>u.side==='def')) {u.troops=0;u.alive=false;}
  Battle.probe.step();assert.equal(field.winner,'attacker');completePresentation();
  const siege=Battle.state;
  assert(siege&&siege!==field&&siege.opts.siege,'real field victory must open a fresh siege');
  assert.equal(g.cities['낙양'].owner,'lijue');assert.equal(completed,0);
  assert.notEqual(JSON.stringify(siege.terrain),fieldMap);
  const defenders=siege.units.filter(u=>u.side==='def');
  assert.equal(defenders.reduce((s,u)=>s+u.troops,0),1000);
  assert(defenders.every(u=>u.noOfficer),'destroyed field officers must not return as garrison commanders');
  const attacker=siege.units.find(u=>u.side==='atk');
  const forts=siege.terrain.flatMap((row,y)=>row.map((t,x)=>({t,x,y}))).filter(c=>c.t===3);
  const safe=siege.terrain.flatMap((row,y)=>row.map((t,x)=>({t,x,y}))).find(c=>c.t<3&&c.x!==attacker.x);
  defenders.forEach(u=>{u.x=safe.x;u.y=safe.y;});
  forts.forEach((fort,i)=>{
    attacker.x=fort.x;attacker.y=fort.y;
    assert.equal(Battle.probe.checkForts(),i===2,'sequential castle flags determine siege victory');
  });
  assert.equal(g.cities['낙양'].owner,'lijue','capture waits for the siege result callback');
  completePresentation();
  assert.equal(g.cities['낙양'].owner,'cao');assert.equal(completed,1);assert.equal(Battle.state,null);
}
console.log('[OK] real field annihilation → separate defended siege → three castle flags → city capture, for both player sides');
