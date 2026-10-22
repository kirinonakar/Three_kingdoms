'use strict';
// 실제 명령·월 정산을 고정 난수로 실행한다. DOM 스텁이며 브라우저 UI 검사는 아니다.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), root = path.join(__dirname, '..');
const noop = () => {}, els = {}, store = {};
const canvas = new Proxy({}, { get: (t,k) => t[k] || noop, set: (t,k,v) => (t[k]=v,true) });
const el = id => els[id] || (els[id] = { innerHTML:'', textContent:'', value:'', style:{}, disabled:false,
  classList:{add:noop,remove:noop,toggle:noop}, getContext:()=>canvas });
let seed = 7721, fixed = true;
const math = Object.create(Math);
math.random = () => fixed ? .99 : ((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const sandbox = {console, Math:math, document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('_')},
  localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v)},
  setTimeout:()=>0,clearTimeout:noop,confirm:()=>true};
sandbox.window = sandbox; vm.createContext(sandbox);
vm.runInContext(['data.js','combat-rules.js','strategy-systems.js','save-transfer.js','game.js'].map(f=>fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')+
  '\nthis.scenarios=SCENARIOS;',sandbox);
const {Game} = sandbox, d = Game._debug;
const fresh = () => { Game.startNew('cao','194'); return Game.state; };
const pick = name => { Game.togglePick(name); Game.confirmPick(); };
const general = city => d.pickSorted(city,d.PICK_SCORE.admin)[0];

let g = fresh(), c = g.cities['허창'], f = g.factions.cao, o = general(c.name);
let q = d.adminQuote(c,'comm',[o.name]);
const team = d.pickSorted(c.name,d.PICK_SCORE.admin).slice(0,3).map(o=>o.name);
const three = d.adminQuote(c,'comm',team);
assert(q.gain>0 && q.cost===60);
assert(three.gain>q.gain && three.gain<q.gain*3,'team effort should have diminishing returns');
assert.equal(three.cost,130);
const before = { gold:f.gold,cmd:g.cmd,stat:c.comm };
Game.cmdAdmin(c.name,'comm'); Game.togglePick(o.name);
assert(el('pickPreview').textContent.includes('투자 회수'));
assert.equal(f.gold,before.gold,'selection must only preview');
Game.confirmPick();
assert.equal(f.gold,before.gold-q.cost); assert.equal(c.comm,before.stat+q.gain);
assert.equal(g.cmd,before.cmd-1); assert(o.used);
g=fresh();c=g.cities['허창'];f=g.factions.cao;o=general(c.name);f.gold=0;
Game.cmdAdmin(c.name,'agri');Game.togglePick(o.name);Game.confirmPick();
assert(el('pickOk').disabled);assert.equal(g.cmd,g.cmdMax);assert(!o.used);assert.equal(f.gold,0);
f.gold=1000;c.agri=99;q=d.adminQuote(c,'agri',[o.name]);
assert.equal(q.gain,1);assert(q.cost>0&&q.cost<60,'near-cap improvements must be prorated');
c.agri=100;assert(!d.adminQuote(c,'agri',[o.name]).ok);
console.log('[OK] priced development, diminishing teams, exact live quote, affordability/no-op guards, cap proration');

const recruitment = {};
for (const mode of ['conscript','levy']) {
  g=fresh();c=g.cities['허창'];f=g.factions.cao;
  Object.assign(c,{troops:4000,training:90,morale:90});
  o=d.pickSorted(c.name,d.PICK_SCORE.recruit)[0];q=d.recruitQuote(c,o,mode);
  const gold=f.gold,cmd=g.cmd,order=c.order;
  Game[mode==='levy'?'cmdLevy':'cmdRecruit'](c.name);pick(o.name);
  assert.equal(c.troops,4000+q.amount);assert.equal(f.gold,gold-q.cost);
  assert.equal(c.training,q.training);assert.equal(c.morale,q.morale);
  assert.equal(c.order,order-q.orderLoss);assert(o.used);assert.equal(g.cmd,cmd-1);
  assert.equal(c.recruited,mode==='conscript');assert(c.training<90,'new soldiers must dilute veterans');
  recruitment[mode]=q;
}
assert.equal(recruitment.levy.cost,recruitment.conscript.cost*2);
assert(recruitment.levy.training>recruitment.conscript.training);
assert(recruitment.levy.morale>recruitment.conscript.morale);
g=fresh();c=g.cities['허창'];c.troops=4000;
Game.cmdRecruit(c.name);pick(g.ui.pick.list[0]);const troops=c.troops,cmd=g.cmd;
Game.cmdRecruit(c.name);assert.equal(c.troops,troops);assert.equal(g.cmd,cmd);
for(let i=0;i<2;i++){Game.cmdLevy(c.name);assert(g.ui.pick);pick(g.ui.pick.list[0]);}
assert(c.troops>troops,'volunteers should be repeatable with fresh officers');
g=fresh();c=g.cities['허창'];f=g.factions.cao;c.troops=d.capOf(c)-99;
Game.cmdRecruit(c.name);pick(g.ui.pick.list[0]);assert.equal(c.troops,d.capOf(c));
assert.equal(f.gold,2600-8,'round cost up without leaving a permanent sub-200 gap');
g=fresh();c=g.cities['허창'];f=g.factions.cao;c.troops=0;f.gold=15;
Game.cmdRecruit(c.name);assert(!g.ui.pick);assert.equal(c.troops,0);assert.equal(g.cmd,g.cmdMax);
console.log('[OK] conscript/volunteer cost-quality tradeoff, training/morale dilution, monthly limit, repeat volunteers, small cap gaps');

g=fresh();c=g.cities['진류'];let target=g.cities['복양'];
Object.assign(c,{troops:1000,training:20,morale:40});
Object.assign(target,{troops:1000,training:100,morale:100});
o=general(c.name);g.ui.move={from:c.name,to:target.name,names:[o.name]};el('mvTroops').value='1000';Game.doMove();
assert.equal(target.troops,2000);assert.equal(target.training,60);assert.equal(target.morale,70);assert.equal(c.troops,0);
g=fresh();c=g.cities['진류'];target=g.cities['낙양'];c.training=25;target.training=100;
d.applyBattleResult({from:c.name,to:target.name,atk:'cao',def:target.owner},
  {winner:'attacker',atk:[{name:'하후돈',troops:2000}],def:[],captured:[]});
assert.equal(target.training,25,'conquest must not launder recruits through the defeated training value');
console.log('[OK] movement blends army quality; conquest retains attacking training');

g=fresh();c=g.cities['허창'];f=g.factions.cao;
const e=d.factionEconomy('cao'),gold=f.gold,food=f.food;
d.monthlyProcess();assert.equal(f.gold,gold+e.goldNet);assert.equal(f.food,food+e.foodNet);
c.troops=d.capOf(c);const atCap=d.cityFoodUpkeep(c);c.troops+=900;
assert.equal(d.cityFoodUpkeep(c)-atCap,20,'only excess soldiers consume double rations');
assert(d.cityGoldUpkeep(c)>0);
const plain={...c,agri:50,comm:50,order:60};
assert(d.cityFoodIncome({...plain,agri:60})>d.cityFoodIncome(plain));
assert(d.cityGoldIncome({...plain,comm:60})>d.cityGoldIncome(plain));
assert(d.cityGoldIncome({...plain,order:80})>d.cityGoldIncome(plain));
assert(d.cityFoodIncome({...plain,order:80})>d.cityFoodIncome(plain));
function starve(missing) {
  g=fresh();c=g.cities['허창'];f=g.factions.cao;
  for(const city of Object.values(g.cities)) if(city!==c) city.owner='yuan';
  Object.assign(c,{troops:24000,morale:90,training:90,agri:0,order:0});
  const e=d.factionEconomy('cao');f.food=-e.foodNet-missing;
  d.monthlyProcess();return {troops:c.troops,morale:c.morale,food:f.food};
}
const little=starve(1),large=starve(200);
assert(little.troops>large.troops);assert(little.morale>large.morale);assert.equal(little.food,0);
g=fresh();c=g.cities['허창'];f=g.factions.cao;
Object.assign(c,{troops:1000000,morale:90,agri:100,comm:0,order:0});f.gold=0;
d.monthlyProcess();assert.equal(f.gold,0);assert(c.morale<90);assert(f.food>=0);
console.log('[OK] forecast equals settlement, marginal over-cap upkeep, production/order effects, proportional starvation, unpaid wages');

g=fresh();c=g.cities['허창'];f=g.factions.cao;f.food=0;
g.officers.filter(o=>o.city===c.name).forEach(o=>o.used=true);
const cmdSupply=g.cmd, supplyGold=f.gold;Game.cmdSupply(c.name);
assert(el('modalRoot').innerHTML.includes('금 600'));
assert.equal(f.gold,supplyGold);Game.confirmSupply(c.name,300);
assert.equal(f.gold,supplyGold-300);assert.equal(f.food,600);assert.equal(g.cmd,cmdSupply-1);
Game.confirmSupply(c.name,-100);assert.equal(f.food,600);
f.gold=99;const cmdPoor=g.cmd;Game.confirmSupply(c.name,100);assert.equal(g.cmd,cmdPoor);
g.cmd=0;f.gold=500;Game.confirmSupply(c.name,100);assert.equal(f.food,600);
console.log('[OK] grain purchase preview, denominations, no officer requirement, affordability and command guards');

for (const [amount, proceeds] of [[200,80],[600,240],[1200,480]]) {
  g=fresh();c=g.cities['허창'];f=g.factions.cao;f.food=amount;
  g.officers.filter(o=>o.city===c.name).forEach(o=>{o.city='진류';});
  const gold=f.gold,cmd=g.cmd;
  Game.selectCity(c.name);
  assert.match(el('cityPanel').innerHTML, /<button class="cmd" aria-label="군량 매각" title=/);
  Game.cmdSellFood(c.name);
  assert(el('modalRoot').innerHTML.includes('매입가 대비 20%'));
  assert(el('modalRoot').innerHTML.includes('→ 금 '+proceeds));
  if(amount===200) assert.match(el('modalRoot').innerHTML, /class="primary" disabled onclick="Game.confirmSellFood\('허창',600\)/);
  Game.closeModal();assert.equal(f.food,amount);assert.equal(f.gold,gold);assert.equal(g.cmd,cmd);
  Game.cmdSellFood(c.name);Game.confirmSellFood(c.name,amount);
  assert.equal(f.food,0);assert.equal(f.gold,gold+proceeds);assert.equal(g.cmd,cmd-1);
  assert.equal(el('modalRoot').innerHTML,'');
  assert(g.log.some(l=>l.m.includes('군량 매각:')));
  assert.match(el('cityPanel').innerHTML, /aria-label="군량 매각" disabled/);
  Game.confirmSupply(c.name,amount/2);
  assert.equal(f.food,amount);assert.equal(f.gold,gold+proceeds-amount/2,'buy/sell round trip must lose gold');
}
g=fresh();c=g.cities['허창'];f=g.factions.cao;f.food=600;
Game.cmdSellFood(c.name);f.food=199;
const saleGold=f.gold,saleCmd=g.cmd;
Game.confirmSellFood(c.name,600);
for(const invalid of [-200,0,201,NaN,Infinity,'200']) Game.confirmSellFood(c.name,invalid);
assert.equal(f.food,199);assert.equal(f.gold,saleGold);assert.equal(g.cmd,saleCmd);
f.food=1200;g.cmd=0;Game.confirmSellFood(c.name,200);
g.cmd=saleCmd;Game.confirmSellFood('낙양',200);Game.confirmSellFood('없는 도시',200);
assert.equal(f.food,1200);assert.equal(f.gold,saleGold);assert.equal(g.cmd,saleCmd);
g.over=true;Game.confirmSellFood(c.name,200);assert.equal(f.food,1200);
console.log('[OK] grain sales: all prices, round-trip loss, no officers, preview/cancel, stock/command/ownership guards');

g=fresh();c=g.cities['허창'];f=g.factions.cao;c.comm=50;o=general(c.name);
q=d.adminQuote(c,'comm',[o.name]);const aiGold=f.gold;
d.execAIAct('cao',{t:'admin',cn:c.name,stat:'comm'},noop);
assert.equal(f.gold,aiGold-q.cost);assert.equal(c.comm,50+q.gain);assert(o.used);
g=fresh();c=g.cities['허창'];f=g.factions.cao;c.troops=4000;
o=d.pickSorted(c.name,d.PICK_SCORE.recruit)[0];q=d.recruitQuote(c,o,'conscript');
d.execAIAct('cao',{t:'recruit',cn:c.name},noop);
assert.equal(f.gold,2600-q.cost);assert.equal(c.training,q.training);assert(o.used);assert(c.recruited);
const trained=c.training;g.officers.filter(o=>o.city===c.name).forEach(o=>o.used=true);
d.execAIAct('cao',{t:'train',cn:c.name},noop);assert.equal(c.training,trained,'AI needs an unused commander');
console.log('[OK] AI uses shared development/recruitment costs, quality and officer actions');

// 시나리오 전 세력의 초기 경제와 동맹 상태의 36개월 운영을 측정한다. 승률 측정은 아니다.
const report=[];
fixed=false;
for(const scenario of sandbox.scenarios) {
  Game.startNew('cao',scenario.id);g=Game.state;
  const owners=Object.keys(g.factions).filter(fid=>Object.values(g.cities).some(c=>c.owner===fid));
  const initial=owners.map(fid=>({fid,...d.factionEconomy(fid),food:g.factions[fid].food}));
  for(const a of owners)for(const b of owners)if(a!==b)g.factions[a].ally[b]=true;
  let shortages=0;
  for(let month=0;month<36;month++) {
    for(const fid of owners) d.runFactionAI(fid,noop);
    for(const fid of owners) {
      const e=d.factionEconomy(fid);if(g.factions[fid].food+e.foodNet<0)shortages++;
    }
    d.monthlyProcess();d.refreshCmd(true);g.turn++;
    for(const fid of owners) {
      const f=g.factions[fid];assert(f.gold>=0&&f.food>=0&&Number.isFinite(f.gold+f.food));
    }
    assert(Object.values(g.cities).every(c=>Number.isFinite(c.troops+c.training+c.morale)&&c.troops>=0));
  }
  assert.equal(shortages,0,scenario.id+': peacetime AI must resolve supply problems');
  report.push({scenario:scenario.id,factions:owners.length,minInitialGoldNet:Math.min(...initial.map(e=>e.goldNet)),
    minInitialFoodNet:Math.min(...initial.map(e=>e.foodNet)),shortagesIn36Months:shortages,
    finalMinFood:Math.min(...owners.map(fid=>g.factions[fid].food))});
}
console.table(report);
console.log('[OK] ' + report.length + ' scenarios / ' + report.reduce((s, r) => s + r.factions, 0) +
  ' faction starts; 36-month peacetime economy remains solvent without starvation');
if(process.argv.includes('--report')) {
  g=fresh();
  console.table(Object.values(g.cities).filter(c=>c.owner==='cao').map(c=>({city:c.name,
    gold:d.cityGoldIncome(c),wages:d.cityGoldUpkeep(c),food:d.cityFoodIncome(c),rations:d.cityFoodUpkeep(c)})));
  console.log(JSON.stringify({recruitment},null,2));
}
