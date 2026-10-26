/* JSON 이전: 파싱·검증·미리보기 후 현재 게임에 적용한다. 슬롯은 덮어쓰지 않는다. */
let importedSave = null;
function transferReady() {return !G||(!G.aiRunning&&!G.battleActive&&!attackIntro);}
function validateSave(data) {
  if(!data||typeof data!=='object'||Array.isArray(data)||!data.cities||!data.factions||!Array.isArray(data.officers)) throw Error('게임 저장 형식이 아닙니다');
  const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
  if(!finite(data.ver??1,1,SAVE_VERSION)) throw Error('지원하지 않는 저장 버전입니다');
  if(!finite(data.year,1,9999)||!finite(data.month,1,12)||!Number.isInteger(data.month)||!finite(data.turn??0,0,120000))throw Error('날짜가 잘못되었습니다');
  const scenario=scenarioById(data.scenario||'194'),defs=scenarioCities(scenario),factionDefs=scenarioFactions(scenario),fids=new Set(factionDefs.map(f=>f[0]));
  if((data.scenario&&!SCENARIOS.some(s=>s.id===data.scenario))||Object.keys(data.factions).length!==factionDefs.length)throw Error('시나리오 또는 세력 목록이 잘못되었습니다');
  if((data.pf!==null&&(!fids.has(data.pf)||!data.factions[data.pf]))||Object.keys(data.cities).length!==defs.length) throw Error('세력 또는 도시 목록이 잘못되었습니다');
  for(const key of ['fullDelegation','autoPaused']) if(data[key]!==undefined&&typeof data[key]!=='boolean') throw Error('AI 위임 설정이 잘못되었습니다');
  const canonical=new Map(defs.map(c=>[c[0],c]));
  for(const [n,c] of Object.entries(data.cities)) {
    if(!canonical.has(n)||!c||c.name!==n||!data.factions[c.owner]||!fids.has(c.owner))throw Error('도시 소속이 잘못되었습니다');
    for(const k of ['agri','comm','def','order','training','morale'])if(!finite(c[k]??(k==='morale'?70:NaN),0,100))throw Error('도시 능력치가 잘못되었습니다');
    if(!finite(c.troops,0,1e8)||!finite(c.pop,.01,10000))throw Error('병력 또는 인구가 잘못되었습니다');
    const base=canonical.get(n);c.x=base[1];c.y=base[2];c.links=base[3].slice();c.morale=c.morale??70;
    c.policy=CITY_POLICIES[c.policy]?c.policy:'manual';
  }
  for(const [id,f] of Object.entries(data.factions)) {
    const base=factionDefs.find(f=>f[0]===id);if(!base||!f||!finite(f.gold,0,1e12)||!finite(f.food,0,1e12))throw Error('세력 자원이 잘못되었습니다');
    f.id=id;f.name=scenario.names?.[id]||base[1];f.color=base[2];f.ally=f.ally||{};f.rel=f.rel||{};
    for(const k of ['ally','rel','pacts','truces','truceOffer']) {
      if(f[k]&&(typeof f[k]!=='object'||Array.isArray(f[k])||Object.keys(f[k]).some(id=>!fids.has(id))))throw Error('외교 정보가 잘못되었습니다');
    }
    for(const value of Object.values(f.rel)) if(!finite(value,-100,100))throw Error('외교 관계가 잘못되었습니다');
    for(const k of ['pacts','truces','truceOffer'])for(const value of Object.values(f[k]||{}))if(!finite(value,0,120000))throw Error('외교 기간이 잘못되었습니다');
    if(f.vassalTo&&!fids.has(f.vassalTo))throw Error('종속 세력이 잘못되었습니다');
  }
  const known=new Set(OFFICER_DEFS.map(o=>o[0])),names=new Set();
  const custom = typeof CustomOfficers !== 'undefined' ? CustomOfficers : null;
  if(data.officers.length>OFFICER_DEFS.length+(custom ? custom.MAX : 0))throw Error('무장 목록이 잘못되었습니다');
  let customCount=0;
  for(const o of data.officers) {
    if(!o||(!known.has(o.name)&&o.custom!==true)||names.has(o.name)||!canonical.has(o.city)||(!fids.has(o.faction)&&o.faction!=='free')||!['active','pow','hidden','retired'].includes(o.status||'active'))throw Error('무장 정보가 잘못되었습니다');
    if(o.custom===true) {
      if(!custom || ++customCount>custom.MAX)throw Error('신무장 목록이 잘못되었습니다');
      o.talent=custom.validate({...o,ruler:false}).talent;
    } else if(o.portrait!==undefined) delete o.portrait;
    names.add(o.name);
    for(const k of ['wu','zhi','pol','cha'])if(!finite(o[k],0,100))throw Error('무장 능력치가 잘못되었습니다');
    if(!finite(o.loyalty,0,100)||(o.skill&&!SKILLS[o.skill]))throw Error('무장 특기 또는 충성이 잘못되었습니다');
    if(o.honor===undefined) o.honor=defaultOfficerHonor(o.name);
    if(!finite(o.honor,0,100)||!Number.isInteger(o.honor))throw Error('무장 의리가 잘못되었습니다');
    if(o.custom!==true) o.honor=defaultOfficerHonor(o.name); // 이전 자동 산출값도 역사별 고정값으로 갱신.
    if(o.captivityMonths===undefined) o.captivityMonths=0;
    if(!finite(o.captivityMonths,0,120000)||!Number.isInteger(o.captivityMonths))throw Error('포로 억류 기간이 잘못되었습니다');
    if(o.status!=='pow') o.captivityMonths=0;
  }
  if(!finite(data.cmd??0,0,100)||!finite(data.cmdMax??32,0,100))throw Error('명령권이 잘못되었습니다');
  // 이전 파일에 저장된 HTML·UI 콜백·로그를 그대로 렌더링하지 않는다.
  data.ui={};data.battleCtx=null;data.log=Array.isArray(data.log)?data.log.filter(l=>l&&typeof l.m==='string').slice(-120).map(l=>({m:l.m.slice(0,2000),c:['good','bad','war','sep'].includes(l.c)?l.c:''})):[];
  const leaders={...LEADERS,...scenario.leaders};
  if(data.leaders!==undefined) {
    if(!data.leaders||typeof data.leaders!=='object'||Array.isArray(data.leaders))throw Error('군주 정보가 잘못되었습니다');
    for(const [fid,name] of Object.entries(data.leaders)) {
      if(!fids.has(fid)||typeof name!=='string')throw Error('군주 정보가 잘못되었습니다');
      if(name===leaders[fid])continue;
      const alive=Object.values(data.cities).some(c=>c.owner===fid);
      const chief=data.officers.find(o=>o.name===name&&o.custom===true&&(!alive||(o.faction===fid&&o.status==='active'&&o.loyalty===100)));
      if(!chief)throw Error('신무장 군주 정보가 잘못되었습니다');
      leaders[fid]=name;data.factions[fid].name=name;
    }
  }
  data.leaders=leaders;
  if(data.stats!==undefined) {
    const s=data.stats,object=v=>v&&typeof v==='object'&&!Array.isArray(v);
    const count=(v,max=1e7)=>finite(v,0,max)&&Number.isInteger(v);
    if(!object(s)||!count(s.since,data.turn||0)||typeof s.partial!=='boolean'||typeof s.assisted!=='boolean'||
      !object(s.factions)||Object.keys(s.factions).length!==fids.size||!Array.isArray(s.battles)||s.battles.length>30)throw Error('전역 통계가 잘못되었습니다');
    const factions={};
    for(const [id,r] of Object.entries(s.factions)) {
      if(!fids.has(id)||!object(r)||!count(r.wins)||!count(r.losses)||!count(r.peak,canonical.size)||!object(r.merit)||Object.keys(r.merit).length>names.size)throw Error('세력 전적이 잘못되었습니다');
      const merit={};
      for(const [name,points] of Object.entries(r.merit)) {
        if(!names.has(name)||!count(points,r.wins))throw Error('무장 전공이 잘못되었습니다');
        merit[name]=points;
      }
      factions[id]={wins:r.wins,losses:r.losses,peak:r.peak,merit};
    }
    const battles=s.battles.map(b=>{
      if(!object(b)||!count(b.turn,data.turn||0)||!canonical.has(b.city)||!fids.has(b.atk)||!fids.has(b.def)||b.atk===b.def||
        ![b.atk,b.def].includes(b.winner)||typeof b.unopposed!=='boolean')throw Error('전투 기록이 잘못되었습니다');
      return {turn:b.turn,city:b.city,atk:b.atk,def:b.def,winner:b.winner,unopposed:b.unopposed};
    });
    data.stats={since:s.since,partial:s.partial,assisted:s.assisted,factions,battles};
  }
  if(data.goal) {
    if(!['unification','hegemony','challenge','scenario'].includes(data.goal.type))throw Error('승리 목표가 잘못되었습니다');
    if(data.goal.targets&&(!Array.isArray(data.goal.targets)||data.goal.targets.some(n=>!canonical.has(n))))throw Error('목표 도시가 잘못되었습니다');
    if(data.goal.deadline!==undefined&&!finite(data.goal.deadline,1,120000))throw Error('목표 기한이 잘못되었습니다');
  }
  return data;
}
function parseSaveFile(text) {
  if(typeof text!=='string'||text.length>2*1024*1024)throw Error('저장 파일은 2MB 이하여야 합니다');
  return validateSave(JSON.parse(text,(key,value)=>{
    if(['__proto__','prototype','constructor'].includes(key))throw Error('허용되지 않는 저장 필드입니다');return value;
  }));
}
function exportSave() {
  if(!G||!transferReady()) {toast('세력 운영 화면에서 저장 파일을 내보낼 수 있습니다');return;}
  const text=JSON.stringify({...G,ver:SAVE_VERSION,ui:{},battleCtx:null},null,2);
  const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='삼국지-'+G.year+'-'+G.month+'-'+G.pf+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);toast('저장 JSON 파일을 내보냈습니다');
}
function importSave() {
  if(!transferReady())return;
  const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
  input.onchange=async()=>{
    const file=input.files?.[0];if(!file)return;
    try {if(file.size>2*1024*1024)throw Error('저장 파일은 2MB 이하여야 합니다');previewImport(await file.text());}
    catch(e){toast('가져오기 실패: '+e.message);}
  };input.click();
}
function previewImport(text) {
  try {
    if(!transferReady())return false;
    importedSave=parseSaveFile(text);const d=importedSave;
    showModal('<h3>저장 파일 가져오기</h3><p>'+scenarioById(d.scenario||'194').name+' · '+d.year+'년 '+d.month+'월 · '+(d.pf ? d.factions[d.pf].name : '전체 AI 관전')+'</p><p>'+(d.pf ? '보유 도시 '+Object.values(d.cities).filter(c=>c.owner===d.pf).length+'개' : '전체 도시 '+Object.keys(d.cities).length+'개')+' · 무장 '+d.officers.length+'명</p><p class="muted">[이어 하기]를 누르면 현재 진행 상황을 이 파일로 교체합니다. 기존 저장 슬롯은 유지됩니다.</p><div class="foot"><button onclick="Game.cancelImport()">취소</button><button class="primary" onclick="Game.confirmImport()">이어 하기</button></div>');return true;
  } catch(e) {importedSave=null;toast('가져오기 실패: '+e.message);return false;}
}
function cancelImport(){importedSave=null;closeModal();}
function confirmImport(){if(!importedSave||!transferReady())return;const data=importedSave;importedSave=null;restoreSave(data,'JSON 파일');}
