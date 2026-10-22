'use strict';
// Real strategic AI and settlement, seeded, without browser rendering or tactical player control.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),noop=()=>{},els={};
const canvas=new Proxy({}, {get:(t,k)=>t[k]||noop,set:(t,k,v)=>(t[k]=v,true)});
const el=id=>els[id]||(els[id]={innerHTML:'',textContent:'',style:{},classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},getContext:()=>canvas});
let seed=731,actions={},departures=0,understaffed=0;
const math=Object.create(Math);math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const sandbox={console,Math:math,document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('_')},
  localStorage:{getItem:()=>null,setItem:noop},setTimeout:(fn,ms=0)=>{if(ms<700)fn();return 0;},clearTimeout:noop,confirm:()=>true,
  recordAction:a=>{const key=a.t==='admin'?a.stat:a.t;actions[key]=(actions[key]||0)+1;},
  recordDeparture:(left,total)=>{departures++;if(left<Math.max(1500,total*.25))understaffed++;}};
sandbox.window=sandbox;vm.createContext(sandbox);
let source=fs.readFileSync(process.env.AI_GAME_SOURCE||path.join(root,'js/game.js'),'utf8');
source=source.replace('function execAIAct(fid, a, cb) {',`function execAIAct(fid, a, cb) {
  const beforeCommands=aiCommands(fid),next=cb;
  cb=()=>{if(G.factions[fid].commands<beforeCommands)recordAction(a);next();};`);
source=source.replace('    c.troops -= committed;','    c.troops -= committed;recordDeparture(c.troops,c.troops+committed);');
vm.runInContext(['data.js','combat-rules.js','strategy-systems.js','save-transfer.js'].map(f=>fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')+'\n'+source+'\nthis.scenarios=SCENARIOS;',sandbox);
const {Game}=sandbox,d=Game._debug;

if(process.argv.includes('--report')) {
  const months=Number(process.argv.find(a=>a.startsWith('--months='))?.split('=')[1]||36);
  assert(Number.isInteger(months)&&months>=1&&months<=120);
  const report=[];
  for(const scenario of sandbox.scenarios) {
    const sum={months:0,frontSamples:0,defense:0,training:0,weakDefense:0,famine:0,conquests:0,tailAttacks:0,completed:0};
    actions={};departures=understaffed=0;
    for(const initialSeed of [731,9851,42017]) {
      seed=initialSeed;d.newGame(null,scenario.id);const g=Game.state;
      for(let month=0;month<months&&!g.over;month++) {
        const attacksBefore=departures;
        const owners=Object.fromEntries(Object.values(g.cities).map(c=>[c.name,c.owner]));
        for(const f of Object.values(g.factions))if(Object.values(g.cities).some(c=>c.owner===f.id)) {
          const economy=d.factionEconomy(f.id);if(f.food+economy.foodIncome<economy.foodUpkeep)sum.famine++;
        }
        Game.endTurn();assert(!g.aiRunning,'monthly AI did not finish');sum.months++;
        if(month>=months-12)sum.tailAttacks+=departures-attacksBefore;
        for(const c of Object.values(g.cities)) {
          assert(Number.isFinite(c.troops)&&c.troops>=0);
          if(c.owner!==owners[c.name])sum.conquests++;
          if(d.aiFrontline(c.owner,c)) {sum.frontSamples++;sum.defense+=c.def;sum.training+=c.training;if(c.def<50)sum.weakDefense++;}
        }
        for(const f of Object.values(g.factions))assert(Number.isFinite(f.gold)&&f.gold>=0&&Number.isFinite(f.food)&&f.food>=0);
      }
      if(g.over)sum.completed++;
    }
    report.push({scenario:scenario.id,months:sum.months,frontDefense:+(sum.defense/Math.max(1,sum.frontSamples)).toFixed(1),frontTraining:+(sum.training/Math.max(1,sum.frontSamples)).toFixed(1),frontBelow50:(100*sum.weakDefense/Math.max(1,sum.frontSamples)).toFixed(1)+'%',famineMonths:sum.famine,conquests:sum.conquests,departures,tailAttacks:sum.tailAttacks,completed:sum.completed,lowReserves:understaffed,actions:{...actions}});
  }
  console.log(JSON.stringify(report,null,2));
  if(process.argv.includes('--verify'))for(const row of report) {
    assert(row.frontDefense>=65,row.scenario+': defenses neglected');
    assert(parseFloat(row.frontBelow50)<20,row.scenario+': too many exposed forts');
    assert(row.departures>=row.months*.3,row.scenario+': campaign stalled in domestic development');
    assert(row.tailAttacks>0||row.completed===3,row.scenario+': every campaign stopped attacking in its final year');
    assert.equal(row.lowReserves,0,row.scenario+': unsafe army commitment');
    assert.equal(row.famineMonths,0,row.scenario+': military buildup exhausted supplies');
  }
} else {
  function fresh() {
    actions={};seed=731;Game.startNew('cao','194');const g=Game.state;g.turn=5;
    g.factions.cao.gold=g.factions.cao.food=10000;
    for(const c of Object.values(g.cities))if(c.owner==='cao')Object.assign(c,{def:80,training:85,morale:90,order:80,agri:90,comm:90,troops:9000});
    const own=g.officers.filter(o=>o.faction==='cao'&&o.status==='active');
    own.forEach((o,i)=>{o.city=i<2?'진류':i<4?'복양':'허창';o.used=false;});
    return g;
  }
  let g=fresh(),city=g.cities['허창'];city.def=25;
  const first=d.aiActionCandidates('cao')[0];
  assert.equal(first.t,'admin');assert.equal(first.stat,'def');assert.equal(first.cn,'허창');
  d.runFactionAI('cao',noop);assert(city.def>25);assert(actions.def>=2,'repair must replan for a second command rather than stopping after one city action');
  assert(g.factions.cao.commands>=0&&g.factions.cao.commands<g.cmdMax);

  g=fresh();city=g.cities['허창'];Object.assign(city,{troops:5000,training:90,def:95});g.cities['낙양'].troops=10000;
  const recruitment=d.aiActionCandidates('cao').find(a=>a.t==='recruit'&&a.cn==='허창');
  assert(recruitment);assert.equal(recruitment.mode,'levy','threatened veterans should be able to choose better-quality volunteers');
  d.execAIAct('cao',recruitment,noop);assert(city.training>=75);assert(!city.recruited,'volunteers must not consume the monthly conscription slot');
  assert(d.aiActionCandidates('cao').some(a=>a.t==='train'&&a.cn==='허창'),'recruitment must be followed by a training option');

  g=fresh();for(const c of Object.values(g.cities))if(c.owner==='cao')Object.assign(c,{troops:50000,agri:0});
  g.factions.cao.food=0;const supply=d.aiActionCandidates('cao')[0];assert.equal(supply.t,'buy');
  const gold=g.factions.cao.gold;d.execAIAct('cao',supply,noop);assert(g.factions.cao.food>0&&g.factions.cao.gold<gold);

  g=fresh();city=g.cities['허창'];city.troops=25000;g.cities['낙양'].troops=1500;
  const attack=d.aiAttackPlan('cao',city,1,{});assert(attack,'prepared superior army must attack instead of farming');
  assert(attack.troops<=city.troops-d.aiDepartureReserve('cao',city,attack.target));
  const guardCount=g.officers.filter(o=>o.city==='허창'&&o.status==='active').length;
  const troopBefore=city.troops;d.execAIAct('cao',attack,noop);
  assert(city.troops>=Math.max(1500,troopBefore*.3));
  assert(g.officers.filter(o=>o.city==='허창'&&o.status==='active').length>0);
  assert(guardCount>0&&actions.attack===1);

  g=fresh();g.turn=30;g.factions.cao.quietMonths=9;
  // Keep a commander in each donor city for actual transfer, not just a theoretical army.
  const own=g.officers.filter(o=>o.faction==='cao'&&o.status==='active');own[0].city='진류';own[1].city='복양';
  const rally=d.aiRallyPlans('cao',{});assert(rally.length,'a prolonged standoff needs an actual concentration plan');
  const plan=rally[0],source=g.cities[plan.from],destination=g.cities[plan.cn],before=source.troops,targetBefore=destination.troops;
  d.execAIAct('cao',plan,noop);assert(source.troops>=Math.max(1500,before*.3));assert(destination.troops>targetBefore);
  assert.equal(d.aiActionCandidates('cao',{['move:'+plan.from]:1}).filter(a=>a.t==='move'&&a.from===plan.from).length,0,'same city should not issue repeated transport orders');
  console.log('[OK] repair replanning, veteran recruitment/training, emergency supplies, prepared offensives, minimum reserves, guard retention and rally orders');
}
