'use strict';
// Campaign integration probes: real strategic rules with a controllable battle boundary.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const noop=()=>{},els={},starts=[],store={};
const canvas=new Proxy({}, {get:(t,k)=>t[k]||noop,set:(t,k,v)=>(t[k]=v,true)});
const el=id=>els[id]||(els[id]={innerHTML:'',textContent:'',value:'',style:{},classList:{add:noop,remove:noop,toggle:noop},getContext:()=>canvas});
const math=Object.create(Math);math.random=()=>.99;
const sandbox={console,Math:math,document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('_')},
  localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]},
  setTimeout:fn=>(fn(),0),clearTimeout:noop,confirm:()=>true,
  Battle:{start:o=>starts.push(o),active:true,reinforce:()=>true,reinforceDays:3}};
sandbox.window=sandbox;vm.createContext(sandbox);
vm.runInContext(['data.js','combat-rules.js','strategy-systems.js','save-transfer.js','game.js'].map(f=>fs.readFileSync(path.join(__dirname,'..','js',f),'utf8')).join('\n')+'\nthis.rules=CombatRules;this.scenarios=SCENARIOS;',sandbox);
const {Game,rules}=sandbox,d=Game._debug;
const fresh=()=>{starts.length=0;Game.startNew('cao','194');return Game.state;};
const unit=(name,troops)=>({officer:Game.state.officers.find(o=>o.name===name),troops,branch:'보병',form:'어린',training:80,morale:80});
const row=(name,troops)=>({name,troops,training:80,morale:70,branch:'보병',form:'어린'});
let g=fresh(),after=0;
let ctx={atk:'cao',def:'lijue',from:'허창',to:'낙양',introShown:true,siege:false,defReserve:1000,after:()=>after++};
g.cities['허창'].troops-=6000;
d.beginBattle(ctx,[unit('하후돈',6000)],[unit('이각',4000)],'atk',false);
assert.equal(starts[0].siege,false);
starts[0].onSupply({round:1,atk:6000,def:4000});
const paid=g.factions.cao.food;
ctx.reinf['하후연']='진류';g.cities['진류'].troops-=500;
starts[0].onEnd({winner:'attacker',rounds:1,atk:[row('하후돈',4200),row('하후연',300)],def:[row('이각',2000)],pending:[{side:'atk',from:'진류',units:[row('악진',200)]}],captured:[]});
assert.equal(g.cities['낙양'].owner,'lijue','field victory must not conquer the city');
assert.equal(starts.length,2);assert(starts[1].siege);assert.equal(starts[1].def.units[0].troops,3000,'only survivors plus reserve defend the siege');
assert.equal(starts[1].atk.units.find(u=>u.officer.name==='하후연').troops,300);
assert.equal(ctx.reinf['하후연'],'진류','arrived reinforcement origins survive the stage transition');
starts[1].onSupply({round:1,atk:4500,def:3000});
assert(g.factions.cao.food<paid,'siege round one must not be mistaken for already-paid field round one');
starts[1].onEnd({winner:'attacker',rounds:1,atk:[row('하후돈',3000),row('하후연',200)],def:[row('이각',1000)],pending:[],captured:[]});
assert.equal(g.cities['낙양'].owner,'cao');assert.equal(g.cities['낙양'].troops,3000);assert.equal(after,1);
assert.equal(g.officers.find(o=>o.name==='하후연').city,'진류');
g=fresh();ctx={atk:'cao',def:'lijue',from:'허창',to:'낙양',introShown:true,siege:false,defReserve:400};
d.beginBattle(ctx,[unit('하후돈',4000)],[unit('이각',4000)],'atk',false);
starts[0].onEnd({winner:'defender',rounds:3,atk:[row('하후돈',1500)],def:[row('이각',3000)],pending:[],captured:[]});
assert.equal(starts.length,1);assert.equal(g.cities['낙양'].owner,'lijue');assert.equal(g.cities['낙양'].troops,3400);
console.log('[OK] field defense, field→siege ownership, survivors/reserves, reinforcement origins, cumulative supply, single campaign completion');
g=fresh();ctx={atk:'cao',def:'lijue',from:'허창',to:'낙양',introShown:true,siege:false};
g.cities['허창'].troops-=4000;
d.beginBattle(ctx,[unit('하후돈',4000)],[unit('이각',4000)],'atk',false);
starts[0].onEnd({winner:'attacker',rounds:3,atk:[row('하후돈',2500)],def:[row('이각',0)],pending:[],captured:[]});
assert.equal(starts.length,1,'a destroyed garrison must not open an empty siege');assert.equal(g.cities['낙양'].owner,'cao');
assert.equal(g.officers.find(o=>o.name==='이각').status,'active');

g=fresh();const source=g.cities['건업'],target=g.cities['오'];
const mover=g.officers.find(o=>o.city==='건업'&&o.faction==='sunce');
g.officers.filter(o=>o.city==='건업'&&o!==mover).forEach(o=>o.used=true);
d.execAIAct('sunce',{t:'move',from:'건업',cn:'오',troops:500},noop);
assert(mover.used);assert.equal(mover.city,'오');
g.officers.filter(o=>o.city==='오').forEach(o=>o.used=true);
const troops=target.troops,commands=g.factions.sunce.commands;
d.execAIAct('sunce',{t:'attack',cn:'오',target:'회계',troops:2000},noop);
assert.equal(target.troops,troops);assert.equal(g.factions.sunce.commands,commands);
g=fresh();g.factions.sunce.commandTurn=g.turn;g.factions.sunce.commands=1;
d.execAIAct('sunce',{t:'train',cn:'건업'},noop);
assert.equal(g.factions.sunce.commands,0);const before=g.cities['오'].training;
d.execAIAct('sunce',{t:'train',cn:'오'},noop);assert.equal(g.cities['오'].training,before);
console.log('[OK] AI movement uses an officer, used officers cannot attack, monthly command exhaustion blocks further orders');

g=fresh();const city=g.cities['허창'];city.agri=20;city.order=90;Game.setPolicy('허창','agri');
g.cmd=1;const gold=g.factions.cao.gold;
d.runPolicies();assert(city.agri>20);assert.equal(g.cmd,0);assert(g.factions.cao.gold<gold);assert(g.officers.some(o=>o.city==='허창'&&o.used));
const agri=city.agri;d.runPolicies();assert.equal(city.agri,agri);
Game.saveGame(true);Game.loadGame();assert.equal(Game.state.cities['허창'].policy,'agri');
console.log('[OK] delegation spends real command/gold/officer once and persists through saving');
g=fresh();Object.values(g.cities).forEach(c=>c.owner='cao');g.cities['낙양'].owner='lijue';
g.officers.find(o=>o.name==='조조').city='북평';
ctx={atk:'cao',def:'lijue',to:'낙양'};const rate=d.expeditionRate(ctx,'atk');assert(rate>1&&rate<=1.36);
g.factions.cao.food=1000;
for(let round=1;round<=25;round++)d.consumeBattleSupply(ctx,{round,atk:600,def:0});
assert.equal(ctx.supply.atk.cost,Math.ceil(25*rate-1e-9));assert.equal(g.factions.cao.food,1000-ctx.supply.atk.cost);
assert(d.cityRegion({name:'성도'}).food>d.cityRegion({name:'허창'}).food);
console.log('[OK] regional production and bounded expedition costs accumulate without floating-point overcharge');

g=fresh();d.makePact('cao','yuan');assert(d.hasPeace('cao','yuan'));
g.turn=12;d.aiDiplomacy();assert(!g.factions.cao.ally.yuan);
d.makePact('cao','lijue',6,'truce');assert(d.hasPeace('cao','lijue'));assert(!g.factions.cao.ally.lijue);
const home=g.cities['허창'].troops;d.execAIAct('cao',{t:'attack',cn:'허창',target:'낙양',troops:4000},noop);assert.equal(g.cities['허창'].troops,home);
g.turn=18;d.aiDiplomacy();assert(!d.hasPeace('cao','lijue'));
g=fresh();Object.values(g.cities).forEach(c=>c.owner='cao');g.cities['북평'].owner='gongsun';g.cities['무위'].owner='mateng';g.turn=4;
for(const id of ['gongsun','mateng'])g.factions[id].gold=2000;
d.aiDiplomacy();assert(g.factions.gongsun.ally.mateng);assert.equal(g.factions.gongsun.commands,2);
console.log('[OK] pact expiry, truce attack protection without allied reinforcements, anti-dominant AI coalition and diplomatic command cost');

const a={...unit('관우',3000),officer:{name:'관우',wu:80,skill:''}},b={...a,officer:{name:'장비',wu:80,skill:''}};
assert(rules.power(a,[a,b])>rules.power(a,[a]));
const cavalry={...a,branch:'기병'},archer={...b,branch:'궁병'};
assert(rules.damage(cavalry,archer)>rules.damage(cavalry,{...archer,branch:'기병'}));
assert(rules.damage(a,b,{terrain:3,cityDef:100})<rules.damage(a,b));
console.log('[OK] shared strength model retains branch counters, fort defenses and named general combinations');

for(const s of sandbox.scenarios) {
  Game.startNew(s.id==='virtual'?'xiangyu':'cao',s.id);
  const parsed=d.parseSaveFile(JSON.stringify(Game.state));assert.equal(parsed.scenario,s.id);assert.equal(parsed.officers.length,217);
}
g=fresh();const original=Game.state;
assert(!Game.previewImport('{"cities":{}}'));assert.equal(Game.state,original);
let save=JSON.parse(JSON.stringify(g));save.cities['허창'].troops=-1;
assert.throws(()=>d.parseSaveFile(JSON.stringify(save)));
save=JSON.parse(JSON.stringify(g));save.officers[0].name='<img src=x>';
assert.throws(()=>d.parseSaveFile(JSON.stringify(save)));
assert(Game.previewImport(JSON.stringify(g)));Game.confirmImport();assert.equal(Game.state.pf,'cao');
g=fresh();Game.setObjective('challenge');assert.equal(g.goal.targets.length,5);g.turn=24;assert(d.objectiveStatus().failed);
g=fresh();Game.setObjective('hegemony');Object.values(g.cities).forEach((c,i)=>{c.owner=i<24?'cao':'yuan';});g.factions.yuan.vassalTo='cao';assert(d.objectiveStatus().done);
console.log('[OK] five-scenario JSON roundtrip, invalid import preserves game, preview/confirm, challenge deadline and hegemony victory');
