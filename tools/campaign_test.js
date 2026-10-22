'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),store={},els={};
const noop=()=>{}, context=new Proxy({}, {get:(t,k)=>k in t?t[k]:noop,set:(t,k,v)=>(t[k]=v,true)});
const el=id=>els[id]||(els[id]={innerHTML:'',textContent:'',style:{},classList:{add:noop,remove:noop,toggle:noop},getContext:()=>context});
let seed=9851,battles=0;
const math=Object.create(Math);math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const sandbox={console,Math:math,document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('_')},
  localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k]},
  setTimeout:fn=>(fn(),0),clearTimeout:noop,confirm:()=>true,
  Battle:{start(opts){battles++;opts.onEnd({winner:'defender',atk:opts.atk.units.map(u=>({name:u.officer?.name||'',troops:Math.round(u.troops*.55)})),def:opts.def.units.map(u=>({name:u.officer?.name||'',troops:Math.round(u.troops*.9)})),captured:[]});}}};
sandbox.window=sandbox;
vm.createContext(sandbox);vm.runInContext(['data.js','game.js'].map(f=>fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')+'\nthis.data={SCENARIOS,scenarioCities,OFFICER_DEFS,citySize};',sandbox);
const {Game,data}=sandbox,d=Game._debug;
const rosterSize=data.OFFICER_DEFS.length;
assert.equal(new Set(data.OFFICER_DEFS.map(o=>o[0])).size,rosterSize);
for(const scenario of data.SCENARIOS) {
  const cities=data.scenarioCities(scenario),owners=[...new Set(cities.map(c=>c[4]))];
  assert.equal(cities.length,30);assert(!owners.includes(undefined));
  for(const fid of owners) {
    Game.startNew(fid,scenario.id);const g=Game.state;
    assert.equal(g.year,scenario.year);assert.equal(g.month,scenario.month);assert.equal(g.scenario,scenario.id);
    assert.equal(g.officers.length,rosterSize);
    for(const o of g.officers.filter(o=>o.status==='active'&&o.faction!=='free')) assert.equal(g.cities[o.city].owner,o.faction,`${scenario.id}: ${o.name} stranded in enemy city`);
    for(const owner of owners) {
      const chief=g.officers.find(o=>o.name===g.leaders[owner]);assert.equal(chief.status,'active');assert.equal(chief.faction,owner);assert.equal(chief.loyalty,100);
      if(scenario.id!=='194') for(const c of Object.values(g.cities).filter(c=>c.owner===owner)) assert(g.officers.some(o=>o.status==='active'&&o.faction===owner&&o.city===c.name),`${scenario.id}: ${c.name} has no commander`);
    }
    assert(!d.visibleOfficers().some(o=>o.status==='retired'));
    for(let month=0;month<18&&!g.over;month++) Game.endTurn();
    assert(!g.aiRunning);assert(Object.values(g.cities).every(c=>c.troops>=0&&Number.isFinite(c.troops)));
  }
  console.log(`[OK] ${scenario.id}: ${owners.length} playable factions, roster/leadership/deployment, 18 months each`);
}
Game.startNew('liubei','219');
{
  const g=Game.state;g.officers=g.officers.filter(o=>o.name!=='장익');g.officers.find(o=>o.name==='조운').loyalty=67;
  Game.saveGame(true);Game.startNew('cao','194');Game.loadGame();
  assert.equal(Game.state.scenario,'219');assert.equal(Game.state.leaders.sunce,'손권');assert.equal(Game.state.officers.length,rosterSize);
  assert.equal(Game.state.officers.find(o=>o.name==='조운').loyalty,67);
  assert.equal(Game.state.officers.find(o=>o.name==='여포').status,'retired');
}
Game.startNew('liubei','194');
{
  const g=Game.state;Object.values(g.cities).forEach(c=>{c.owner='cao';c.troops=2000;});g.cities['성도'].owner='liubei';
  g.cities['북평'].troops=8000;g.cities['남피'].troops=9500;
  const plans=d.aiMovePlans('cao',Object.keys(g.cities).filter(n=>g.cities[n].owner==='cao'));
  const plan=plans.find(p=>p.from==='북평');assert(plan);assert.equal(plan.cn,'남피');assert(plan.troops<=6500);
  plans.forEach(p=>d.execAIAct('cao',p,noop));assert(g.cities['남피'].troops<=11000);assert(g.cities['북평'].troops>=1500);
  g.cities['남피'].troops=0;g.cities['남피'].owner='liubei';assert(d.aiFrontline('cao',g.cities['북평']));
}
Game.startNew('liubei','194');
{
  const g=Game.state;Object.values(g.cities).forEach(c=>{c.owner='liubei';c.troops=15000;c.def=100;});
  Object.assign(g.cities['북평'],{owner:'yuan',troops:10000,pop:12,training:90,morale:90});
  Object.assign(g.cities['남피'],{troops:6500,def:70,training:80});
  g.officers.forEach(o=>{if(o.faction==='yuan'&&o.status==='active')o.city='북평';});
  g.turn=40;g.factions.yuan.quietMonths=6;
  const before=battles;d.runFactionAI('yuan',noop);assert(battles>before,'late rival never attacks a comparable border army');
  g.factions.yuan.ally.liubei=true;g.factions.liubei.ally.yuan=true;
  d.campaignDiplomacy();assert(g.factions.yuan.ally.liubei);g.turn+=2;d.campaignDiplomacy();assert(g.factions.yuan.ally.liubei);
  g.turn++;d.campaignDiplomacy();assert(!g.factions.yuan.ally.liubei);assert(!g.factions.liubei.ally.yuan);
}
assert.equal(data.citySize({pop:8.99}).rank,1);assert.equal(data.citySize({pop:9}).rank,2);assert.equal(data.citySize({pop:14}).rank,3);
Game.startNew('cao','194');
{
  const g=Game.state,source=g.cities['건업'],support=g.cities['오'],target=g.cities['회계'];
  target.owner='yuanshu';target.troops=500;g.officers.filter(o=>o.city==='회계'&&o.status==='active'&&o.faction==='sunce').forEach(o=>o.faction='yuanshu');
  const helpers=g.officers.filter(o=>o.city==='오'&&o.status==='active'&&o.faction==='sunce').sort((a,b)=>b.wu-a.wu).slice(0,2);
  const before=support.troops;
  d.execAIAct('sunce',{t:'attack',cn:'건업',target:'회계',troops:7000,extra:[{from:'오',troops:3000}]},noop);
  assert.equal(target.owner,'sunce');assert.equal(source.troops,4000);
  // 합동 출진은 지원 도시에서 최대 3000만 빼내고 늘리지 않는다.
  // 수비군이 싸우지 않고 후퇴하면 합동 부대가 손실 없이 복귀하므로 병력이 그대로일 수 있다.
  assert(support.troops>=before-3000&&support.troops<=before,'joint offensive draws at most 3000 from the support city');
  assert(helpers.every(o=>o.city==='오'),'joint offensive strands supporting officers in conquered city');
  // 본대 장수가 점령지로 떠난 뒤에는 훈련을 지휘할 장수를 다시 배치한다.
  source.morale=30;const trainer=g.officers.find(o=>o.city==='오'&&o.faction==='sunce'&&o.status==='active');
  assert(trainer);trainer.city=source.name;trainer.used=false;
  d.execAIAct('sunce',{t:'train',cn:'건업'},noop);assert(source.morale>30,'AI training does not recover depleted morale');assert(trainer.used);
}
console.log('[OK] existing-save roster merge, multi-hop capped logistics, empty enemy city, late offensive, announced alliance expiry, city sizes');
console.log('[OK] joint offensive conserves supporting army origins; training restores morale');
