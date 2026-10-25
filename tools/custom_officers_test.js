'use strict';
// Exercise registration, photo processing and game/save integration without computer use.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const noop = () => {}, store = {}, els = {}, classes = new Set(), downloads = [], blobs = [], draws = [];
let quota = false, confirmed = true, nextUrl = 0;
const photo = 'data:image/jpeg;base64,/9j/2Q==';
const canvas = new Proxy({}, {get:(o,k) => k in o ? o[k] : noop, set:(o,k,v) => (o[k]=v,true)});
const el = id => els[id] ||= {innerHTML:'',textContent:'',value:'',checked:false,disabled:false,style:{},dataset:{},
  classList:{add:noop,remove:noop,toggle:noop},getContext:()=>canvas,setAttribute:noop};
const sandbox = {console, Blob, queueMicrotask,
  document:{getElementById:el,querySelectorAll:()=>[],body:{classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)}},
    createElement(tag) {
      if (tag === 'canvas') return {getContext:()=>({fillRect:noop,drawImage:(...args)=>draws.push(args)}),toDataURL:()=>photo};
      const node = {click:()=>downloads.push(node)}; return node;
    }},
  Image:class {constructor(){this.naturalWidth=600;this.naturalHeight=800;}set src(value){queueMicrotask(()=>this.onload());}},
  URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:test-'+(++nextUrl);},revokeObjectURL:noop},
  localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>{if(quota)throw Error('quota');store[k]=String(v);},removeItem:k=>delete store[k]},
  setTimeout:()=>1,clearTimeout:noop,confirm:()=>confirmed};
sandbox.window=sandbox; vm.createContext(sandbox);
vm.runInContext(['data.js','combat-rules.js','strategy-systems.js','save-transfer.js','custom-officers.js','game.js']
  .map(f=>fs.readFileSync(path.join(__dirname,'..','js',f),'utf8')).join('\n'),sandbox);
const {Game,CustomOfficers:C}=sandbox, d=C._debug, key='sangokji_custom_officers_v1';
const profile=(name='새군주',extra={})=>({name,wu:95,zhi:82,pol:77,cha:90,honor:65,skill:'용맹',city:'진류',ruler:true,portrait:photo,...extra});
const clone=value=>JSON.parse(JSON.stringify(value));
const customIn=()=>Game.state.officers.filter(o=>o.custom);
const form=(p)=>{
  el('customName').value=p.name;el('customSkill').value=p.skill;el('customCity').value=p.city;el('customRuler').checked=p.ruler;
  el('customHonor').value=String(p.honor);
  for(const k of ['wu','zhi','pol','cha'])el('custom-'+k).value=String(p[k]);
};

async function main() {
  for (const honor of [-1,101,1.5,null,'50']) assert.throws(()=>C.validate(profile('검사',{honor})),/의리/);
  for (const honor of [0,100]) assert.equal(C.validate(profile('검사',{honor})).honor,honor);
  const legacyProfile=profile();delete legacyProfile.honor;
  assert.equal(d.parse(JSON.stringify({format:'three-kingdoms-officers',version:1,officers:[legacyProfile]}))[0].honor,C.validate(legacyProfile).honor);
  for (const bad of [profile('조조'),profile('<script>'),profile("a'b"),profile('a\\b'),profile('constructor'),profile('__proto__'),profile('test',{wu:101}),profile('test',{zhi:1.5}),
    profile('test',{skill:'constructor'}),profile('test',{city:'가짜'}),profile('test',{portrait:'https://example.com/x.jpg'}),
    profile('test',{portrait:'data:image/svg+xml;base64,PHN2Zz4='}),profile('test',{portrait:'data:image/jpeg;base64,'+'a'.repeat(65536)})]) {
    assert.throws(()=>C.validate(bad));
  }
  assert.throws(()=>d.parse('{"format":"three-kingdoms-officers","version":1,"officers":[],"__proto__":{}}'));
  assert.throws(()=>d.parse(JSON.stringify({format:'three-kingdoms-officers',version:2,officers:[]})));
  assert.throws(()=>d.serialize([profile(),profile()]));
  assert.throws(()=>d.serialize(Array.from({length:21},(_,i)=>profile('신무장'+i))));

  // Actual form/photo handlers, top-aligned crop, browser storage and JSON download.
  Game.reset(); assert.match(el('modalRoot').innerHTML,/CustomOfficers.open\(true\)/);
  C.open(true); C.edit(); assert.match(el('modalRoot').innerHTML,/id="customHonor"[^>]*min="0"[^>]*max="100"/); form(profile());
  await C.selectPhoto({files:[{type:'image/jpeg',size:1000}]});
  assert.deepEqual(draws[0].slice(1),[0,0,600,600,0,0,256,256]);
  assert.match(el('customPhotoPreview').innerHTML,/data:image\/jpeg/);
  C.saveForm(); assert.equal(d.read().length,1); assert.equal(d.read()[0].portrait,photo);
  assert.equal(d.read()[0].honor,65);
  assert.match(el('modalRoot').innerHTML,/새군주/);
  C.exportFile(); const exported=await blobs.at(-1).text();
  assert.equal(downloads.at(-1).download,'삼국지-신무장.json');
  assert.equal(d.parse(exported)[0].portrait,photo);
  assert.equal(d.parse(exported)[0].honor,65);
  C.edit(0);assert.match(el('modalRoot').innerHTML,/id="customHonor"[^>]*value="65"/);
  el('customHonor').value='';C.saveForm();assert.match(el('toast').textContent,/의리/);assert.equal(d.read()[0].honor,65);
  el('customHonor').value='0';C.saveForm();assert.equal(d.read()[0].honor,0);
  C.edit(0);await C.selectPhoto({files:[{type:'image/svg+xml',size:1000}]});
  assert.match(el('toast').textContent,/JPG/);C.saveForm();assert.equal(d.read()[0].portrait,photo);
  C.edit(0);C.clearPhoto();C.saveForm();assert.equal(d.read()[0].portrait,'');
  d.write([profile()]); C.open(true); C.leave();
  assert.match(el('modalRoot').innerHTML,/새군주 세력으로 시작/,'title faction preview must show the custom ruler');
  const library=store[key];

  Game.startNew('cao','194'); let g=Game.state;
  const chief=customIn()[0];
  assert.equal(g.leaders.cao,'새군주');assert.equal(g.factions.cao.name,'새군주');
  assert.equal(chief.faction,'cao');assert.equal(chief.city,'진류');assert.equal(chief.loyalty,100);
  assert.equal(chief.honor,65);
  assert(Game._debug.isLeader(chief.name));assert(!Game._debug.isLeader('조조'));
  assert.equal(g.officers.find(o=>o.name==='조조').status,'active');
  assert.equal(Game._debug.capOf(g.cities['진류']),g.cities['진류'].pop*1500);
  assert.match(vm.runInContext('portraitFace("새군주")',sandbox),/data:image\/jpeg/);

  // Registration import is previewed, merged atomically and independent of the active game.
  C.open(); const beforeGame=JSON.stringify(g);
  const companion=profile('새장수',{city:'업',ruler:false,portrait:''});
  assert(C.previewImport(d.serialize([companion])));assert.equal(store[key],library);assert.equal(JSON.stringify(g),beforeGame);
  C.confirmImport();assert.equal(d.read().length,2);assert.equal(customIn().length,1);
  C.deploy(1);assert.equal(customIn().length,2);assert.equal(customIn()[1].faction,'yuan');assert.equal(customIn()[1].city,'업');
  assert(Number.isInteger(customIn()[1].honor)&&customIn()[1].honor>=0&&customIn()[1].honor<=100);
  customIn()[1].used=true;
  d.write([profile(),{...companion,city:'남피',wu:99,honor:93}]);C.deploy(1);
  assert.equal(customIn()[1].city,'남피');assert.equal(customIn()[1].wu,99);assert(customIn()[1].used);
  assert.equal(customIn()[1].honor,93,'redeploying applies the configured honor');
  const count=customIn().length;C.deploy(1);assert.equal(customIn().length,count,'deployment updates by name');
  const snapshot=JSON.stringify(g);g.aiRunning=true;C.deploy(1);g.aiRunning=false;assert.equal(JSON.stringify(g),snapshot);
  confirmed=false;d.write([profile(),{...companion,city:'업',honor:93}]);C.deploy(1);assert.equal(customIn()[1].city,'남피');confirmed=true;
  assert.throws(()=>d.apply(profile('새군주',{city:'업'}),g));
  assert.throws(()=>d.apply(profile('새군주',{ruler:false}),g));
  customIn()[1].status='pow';assert.throws(()=>d.apply(companion,g));customIn()[1].status='active';

  // Whole-game JSON and manual saves preserve photo, ruler, city and normal game progress.
  const saved=JSON.stringify(g), parsed=Game._debug.parseSaveFile(saved);
  assert.equal(parsed.leaders.cao,'새군주');assert.equal(parsed.factions.cao.name,'새군주');
  assert.equal(parsed.officers.find(o=>o.custom&&o.name==='새군주').portrait,photo);
  Game.saveGame(false,1);const slot=store.sangokji_save_v1_manual_slot1;
  d.write([]);assert.equal(customIn().length,2,'removing library profiles must not delete deployed officers');
  Game.startNew('cao','194');assert.equal(customIn().length,0);Game.loadGame(1,'manual');
  assert.equal(customIn().length,2);assert.equal(Game.state.leaders.cao,'새군주');
  assert.equal(customIn().find(o=>o.name==='새장수').honor,93,'custom honor survives saving and loading');
  assert(Game.previewImport(saved));Game.confirmImport();assert.equal(Game.state.factions.cao.name,'새군주');
  assert.equal(store.sangokji_save_v1_manual_slot1,slot);
  let broken=clone(Game.state);broken.officers.find(o=>o.custom).name='<img src=x>';
  assert.throws(()=>Game._debug.parseSaveFile(JSON.stringify(broken)));
  broken=clone(Game.state);broken.leaders.cao='유비';assert.throws(()=>Game._debug.parseSaveFile(JSON.stringify(broken)));
  broken=clone(Game.state);broken.officers.find(o=>o.name==='새군주').loyalty=90;assert.throws(()=>Game._debug.parseSaveFile(JSON.stringify(broken)));

  // An eliminated/annexed custom ruler may become free or join another faction.
  g=Game.state;Object.values(g.cities).filter(c=>c.owner==='cao').forEach(c=>c.owner='yuan');
  vm.runInContext('destroyFaction("cao")',sandbox);
  assert.equal(g.officers.find(o=>o.name==='새군주').faction,'free');
  assert.equal(Game._debug.parseSaveFile(JSON.stringify(g)).leaders.cao,'새군주');
  d.apply(profile('새군주',{city:'업',ruler:false}),g);
  assert.equal(Game._debug.parseSaveFile(JSON.stringify(g)).officers.find(o=>o.name==='새군주').faction,'yuan');

  // All five scenarios assign through their actual city owner and retain JSON compatibility.
  d.write([profile(),companion]);
  for(const id of ['194','200','208','219','virtual']) {
    Game.startNew(id==='virtual'?'xiangyu':'cao',id);g=Game.state;
    const custom=customIn().find(o=>o.name==='새군주');
    assert.equal(custom.faction,g.cities['진류'].owner);assert.equal(g.leaders[custom.faction],custom.name);
    const data=Game._debug.parseSaveFile(JSON.stringify(g));assert.equal(data.officers.filter(o=>o.custom).length,2);
  }
  C.open(true);const prior=store[key];quota=true;
  assert(C.previewImport(d.serialize([profile('추가장수',{ruler:false})])));C.confirmImport();
  assert.equal(store[key],prior);assert.match(el('toast').textContent,/저장 공간/);quota=false;
  C.confirmImport();assert.equal(d.read().length,3,'quota failure can be retried');
  const priorInvalid=store[key];assert(!C.previewImport('invalid'));assert.equal(store[key],priorInvalid);
  assert(!C.previewImport(d.serialize([profile('겹친군주')])));assert.equal(store[key],priorInvalid);
  d.write([profile(),profile('겹친군주')]);const previous=Game.state;Game.startNew('cao','194');assert.equal(Game.state,previous,'ruler conflicts must not partially start a game');

  // Maximum photo payload still roundtrips through the whole-game file size limit.
  const largePhoto='data:image/jpeg;base64,'+'a'.repeat(64000);
  d.write(Array.from({length:20},(_,i)=>profile('최대무장'+i,{ruler:false,portrait:largePhoto})));
  Game.startNew('cao','194');assert.equal(customIn().length,20);
  assert.equal(Game._debug.parseSaveFile(JSON.stringify(Game.state)).officers.filter(o=>o.custom).length,20);
  C.open();const beforeDelete=customIn().length;C.remove(0);assert.equal(d.read().length,19);assert.equal(customIn().length,beforeDelete);
  assert.throws(()=>d.apply(profile('초과무장',{ruler:false}),Game.state));
  console.log('[OK] custom registration/photo crop, import/export/merge/quota, scenario assignment, ruler replacement, deployment guards, manual/game JSON roundtrip, defeated rulers, limits and invalid data');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
