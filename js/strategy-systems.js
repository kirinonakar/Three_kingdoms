/* 외교·위임·선택 목표. 기존 명령/경제 함수를 통해 실행한다. */
const CITY_POLICIES = {manual:'직접 관리',agri:'농업 중심',comm:'상업 중심',military:'군사 거점',front:'최전선',support:'후방 지원'};
function strategyReady() {return !!G&&!G.over&&!G.aiRunning&&!G.battleActive&&!attackIntro;}
function hasPeace(a,b) {return isAlly(a,b)||!!(G.factions[a]?.truces?.[b]>(G.turn||0))||G.factions[a]?.vassalTo===b||G.factions[b]?.vassalTo===a;}
function makePact(a,b,months=12,type='alliance') {
  for(const [x,y] of [[a,b],[b,a]]) {
    const f=G.factions[x];f.pacts=f.pacts||{};
    if(type==='truce') {f.truces=f.truces||{};f.truces[y]=(G.turn||0)+months;}
    else {f.ally[y]=true;f.pacts[y]=(G.turn||0)+months;f.rel[y]=Math.max(40,f.rel[y]||0);}
  }
}
function aiDiplomacy() {
  const living=Object.keys(G.factions).filter(id=>factionCities(id).length);
  for(const a of living) {
    const f=G.factions[a];
    for(const b of Object.keys(f.pacts||{})) if(G.turn>=f.pacts[b]) {
      delete f.pacts[b];delete f.ally[b];delete G.factions[b]?.ally[a];delete G.factions[b]?.pacts?.[a];
      log(f.name+' · '+G.factions[b].name+'의 12개월 동맹이 만료되었습니다.','war');
    }
    for(const b of Object.keys(f.truces||{})) if(G.turn>=f.truces[b]) {delete f.truces[b];delete G.factions[b]?.truces?.[a];log(f.name+' · '+G.factions[b].name+'의 휴전이 끝났습니다.','');}
  }
  if(living.length<=2) return;
  // 소모된 국경의 휴전과 공통의 적에 대한 협력도 검토한다. 월 명령권과 자기 자금을 쓴다.
  if(G.turn>=6) for(let i=0;i<living.length;i++) for(let j=i+1;j<living.length;j++) {
    const a=living[i],b=living[j],f=G.factions[a],g=G.factions[b];
    if((a===G.pf&&!automatedFaction(a))||(b===G.pf&&!automatedFaction(b))||hasPeace(a,b)||f.vassalTo||g.vassalTo||(f.diploCooldown||0)>G.turn||(g.diploCooldown||0)>G.turn)continue;
    const border=factionCities(a).some(n=>G.cities[n].links.some(k=>G.cities[k].owner===b));
    const enemies=id=>new Set(factionCities(id).flatMap(n=>G.cities[n].links.map(k=>G.cities[k].owner)).filter(k=>k!==id&&!hasPeace(id,k)));
    const common=[...enemies(a)].some(k=>k!==b&&enemies(b).has(k)&&factionTotals(k).troops>Math.min(factionTotals(a).troops,factionTotals(b).troops));
    const exhausted=f.food<factionEconomy(a).foodUpkeep*2&&g.food<factionEconomy(b).foodUpkeep*2;
    const truce=border&&exhausted;
    if(!truce&&(!common||(f.rel[b]||0)<0))continue;
    const cost=truce?300:500;
    if(f.gold<cost||g.gold<cost||aiCommands(a)<=0||aiCommands(b)<=0)continue;
    f.gold-=cost;g.gold-=cost;f.commands--;g.commands--;makePact(a,b,truce?6:12,truce?'truce':'alliance');
    f.diploCooldown=g.diploCooldown=G.turn+(truce?9:15);
    log(f.name+' · '+g.name+(truce?'이(가) 소모된 전선을 정리하고 6개월 휴전했습니다.':'이(가) 공통의 적을 견제하는 12개월 동맹을 맺었습니다.'),'war');
  }
  const dominant=living.slice().sort((a,b)=>factionCities(b).length-factionCities(a).length)[0];
  if(factionCities(dominant).length<15) return;
  // 플레이어의 동맹 수락은 직접 결정한다. AI끼리는 강대국과 국경을 맞댄 세력이 공동 대응한다.
  const threatened=living.filter(a=>(a!==G.pf||automatedFaction(a))&&a!==dominant&&!G.factions[a].vassalTo&&factionCities(a).some(n=>G.cities[n].links.some(k=>G.cities[k].owner===dominant)));
  for(let i=0;i<threatened.length;i++) for(let j=i+1;j<threatened.length;j++) {
    const a=threatened[i],b=threatened[j],f=G.factions[a],g=G.factions[b];
    if(hasPeace(a,b)||isAlly(a,dominant)||isAlly(b,dominant)||(f.diploCooldown||0)>G.turn||(g.diploCooldown||0)>G.turn) continue;
    if(f.gold<500||g.gold<500||aiCommands(a)<=0||aiCommands(b)<=0) continue;
    f.gold-=500;g.gold-=500;f.commands--;g.commands--;makePact(a,b);
    f.diploCooldown=g.diploCooldown=G.turn+12;
    log(f.name+' · '+g.name+'이(가) '+G.factions[dominant].name+' 견제를 위한 12개월 동맹을 맺었습니다.','war');
  }
}

function cityRegion(c) {
  if(['성도','수춘','여남','평원','오','회계','강릉','양양'].includes(c.name))return {label:'곡창 지대 · 군량 생산 +15%',gold:1,food:1.15};
  if(['낙양','허창','업','건업','하비','장안','진류'].includes(c.name))return {label:'상업 거점 · 금 생산 +15%',gold:1.15,food:1};
  return {label:'지역 거점 · 금·군량 생산 +5%',gold:1.05,food:1.05};
}
function expeditionRate(ctx,side) {
  const fid=ctx[side],leader=off(G.leaders?.[fid]),target=G.cities[ctx.to];
  if(!leader||!target||!G.cities[leader.city]||G.cities[leader.city].owner!==fid)return 1;
  const queue=[[leader.city,0]],seen=new Set([leader.city]);
  while(queue.length) {
    const [n,d]=queue.shift();if(n===target.name)return 1+Math.min(.36,Math.max(0,d-2)*.12);
    for(const k of G.cities[n].links)if(!seen.has(k)&&(k===target.name||G.cities[k].owner===fid||isAlly(fid,G.cities[k].owner))) {seen.add(k);queue.push([k,d+1]);}
  }
  return 1.36;
}
function aiCommands(fid) {
  const f=G.factions[fid];
  if(f.commandTurn!==G.turn) {f.commandTurn=G.turn;f.commands=factionCities(fid).length+2;}
  return f.commands;
}
function diploTruce(id) {
  if(!strategyReady()||!G.factions[id]||id===G.pf||hasPeace(G.pf,id)) return;
  const f=G.factions[G.pf],g=G.factions[id];
  if(f.gold<300) {toast('휴전 제안에는 금 300이 필요합니다');return;}
  if((f.truceOffer?.[id]??-1)>G.turn) {toast('이 세력에는 3개월 뒤 다시 제안할 수 있습니다');return;}
  f.truceOffer=f.truceOffer||{};f.truceOffer[id]=G.turn+3;f.gold-=300;
  const exhausted=Object.values(factionEconomy(id)).every(Number.isFinite)&&g.food<factionEconomy(id).foodUpkeep*3;
  const p=cl(.2+(f.rel[id]||0)/250+(exhausted?.35:0)+(factionTotals(G.pf).troops>factionTotals(id).troops?.2:0),.1,.85);
  if(Math.random()<p) {makePact(G.pf,id,6,'truce');log(g.name+'와 6개월 휴전했습니다.','good');}
  else log(g.name+'이(가) 휴전을 거절했습니다.','bad');
  renderAll();openDiplo();
}
function diploJoint(id,target) {
  if(!strategyReady()||!isAlly(G.pf,id)||!G.factions[id]) return;
  const g=G.factions[id],f=G.factions[G.pf];
  if(!target) {
    const cities=Object.values(G.cities).filter(c=>c.owner!==G.pf&&c.owner!==id&&!hasPeace(id,c.owner)&&!hasPeace(G.pf,c.owner)&&c.links.some(n=>G.cities[n].owner===id));
    showModal('<h3>공동 출진 요청</h3><p class="muted">금 300 · 동맹국이 3개월 동안 목표를 우선 검토합니다. 전력·보급과 월 명령권이 충분할 때 출진합니다.</p>'+cities.map(c=>'<button class="frow" onclick="Game.diploJoint(\''+id+'\',\''+c.name+'\')">'+c.name+' 공격 요청</button>').join('')+'<div class="foot"><button onclick="Game.openDiplo()">돌아가기</button></div>');return;
  }
  const c=G.cities[target];
  if(!c||c.owner===G.pf||c.owner===id||hasPeace(id,c.owner)||hasPeace(G.pf,c.owner)||!c.links.some(n=>G.cities[n].owner===id)) return;
  if(f.gold<300) {toast('금 300이 필요합니다');return;}
  if(g.warTarget&&g.warTarget.until>G.turn) {toast('이미 검토 중인 공동 출진 요청이 있습니다');return;}
  f.gold-=300;g.warTarget={city:target,until:G.turn+3};log(g.name+'에게 '+target+' 공동 출진을 요청했습니다.','war');renderAll();openDiplo();
}
function surrenderChance(id) {
  const a=factionTotals(G.pf),b=factionTotals(id),g=G.factions[id];
  if(b.cities>3||a.cities<b.cities*4||a.troops<Math.max(1,b.troops)*4||g.vassalTo) return 0;
  return cl(.15+(a.troops/Math.max(1,b.troops)-4)*.05+(G.factions[G.pf].rel[id]||0)/500,.05,.8);
}
function diploSurrender(id) {
  if(!strategyReady()||!G.factions[id]||!factionCities(id).length) return;
  const f=G.factions[G.pf],g=G.factions[id],chance=surrenderChance(id);
  if(!chance||f.gold<500||(g.surrenderUntil||0)>G.turn) {toast('병력 4배·도시 4배 우세, 상대 3도시 이하, 금 500이 필요합니다. 재권고는 12개월 뒤 가능합니다.');return;}
  f.gold-=500;g.surrenderUntil=G.turn+12;
  if(Math.random()<chance) {
    g.vassalTo=G.pf;makePact(G.pf,id);delete f.pacts[id];delete g.pacts[G.pf];
    log(g.name+'이(가) 항복하여 종속 세력이 되었습니다. 외교에서 영토를 편입할 수 있습니다.','good');
  } else log(g.name+'이(가) 항복 권고를 거절했습니다.','bad');
  renderAll();victoryCheck();if(!G.over)openDiplo();
}
function diploAnnex(id) {
  if(!strategyReady()||G.factions[id]?.vassalTo!==G.pf) return;
  factionCities(id).forEach(n=>{G.cities[n].owner=G.pf;G.cities[n].policy='manual';});
  G.officers.filter(o=>o.faction===id).forEach(o=>{o.faction=G.pf;o.loyalty=Math.max(70,o.loyalty);});
  delete G.factions[id].vassalTo;log(G.factions[id].name+'의 영토를 평화적으로 편입했습니다.','good');renderAll();victoryCheck();if(!G.over)openDiplo();
}
function openPolicies() {
  if(!strategyReady()) return;
  const automation = '<h3>' + (G.pf ? '전체위임' : '전체 AI 관전') + '</h3><p class="muted">내정·외교·등용·병력 이동·출진·수비·전투와 다음 달 진행까지 AI가 처리합니다. 상단 버튼으로 일시정지하거나 재개할 수 있습니다.</p>' +
    (G.pf ? '<button class="primary" onclick="Game.setFullDelegation(' + !G.fullDelegation + ')">' + (G.fullDelegation ? '전체위임 해제 · 직접 지휘' : '전체위임 시작') + '</button>' : '<button class="primary" onclick="Game.toggleAutoPlay()">AI 자동 진행 재개</button>');
  showModal(automation + (G.pf ? '<h3>도시 위임</h3><p class="muted">턴 종료 시 남은 명령권으로 도시당 1회 실행합니다. 직접 명령과 같은 금·무장 행동을 사용합니다. 후방 지원은 인접한 전방 방향 도시로 수송합니다. 전체위임 중에는 AI가 모든 도시의 운영 방침을 결정합니다.</p>'+factionCities(G.pf).map(n=>{
    const c=G.cities[n];return '<div class="row"><b>'+n+'</b><select aria-label="'+n+' 위임 방침" onchange="Game.setPolicy(\''+n+'\',this.value)">'+Object.entries(CITY_POLICIES).map(([id,label])=>'<option value="'+id+'"'+((c.policy||'manual')===id?' selected':'')+'>'+label+'</option>').join('')+'</select><span class="muted" id="policyPreview_'+n+'">'+policyPlan(c).label+'</span></div>';
  }).join('') : '')+'<div class="foot">' + (G.pf ? '<button onclick="Game.openObjectives()">승리 목표</button>' : '') + '<button onclick="Game.closeModal()">닫기</button></div>');
}
function setPolicy(city,id) {
  if(!strategyReady()||G.cities[city]?.owner!==G.pf||!CITY_POLICIES[id])return;
  G.cities[city].policy=id;const preview=$('policyPreview_'+city);if(preview)preview.textContent=policyPlan(G.cities[city]).label;renderCityPanel();
}
function policyPlan(c) {
  const p=c.policy,o=pickSorted(c.name,PICK_SCORE.admin)[0];
  if(!p||p==='manual') return {label:'직접 명령'};
  if(!availableOfficers(c.name).length) return {label:'가용 무장 없음'};
  if(p==='support') {
    const move=aiMovePlans(G.pf,factionCities(G.pf)).find(a=>a.from===c.name);
    return move?{...move,label:move.cn+'에 병력 '+commas(move.troops)+' 수송'}:{label:'수송할 병력·목적지 없음'};
  }
  let stat=c.order<65?'order':p==='agri'?'agri':p==='comm'?'comm':p==='front'&&c.def<90?'def':null;
  if(stat&&c[stat]<100&&o) {
    const q=adminQuote(c,stat,[o.name]);if(q.ok)return {t:'admin',cn:c.name,stat,officer:o.name,quote:q,label:q.text};
  }
  if((p==='military'||p==='front')&&(c.training<85||c.morale<85)) return {t:'train',cn:c.name,label:'훈련·사기 회복'};
  if((p==='military'||p==='front')&&c.troops<capOf(c)*.8&&factionEconomy(G.pf).foodNet>=0) {
    const q=aiRecruitPlan(c,Math.min(600,G.factions[G.pf].gold));if(q)return {t:'recruit',cn:c.name,amt:q.amt,label:'병력 '+commas(q.amt)+' 충원'};
  }
  return {label:'현재 방침 목표 충족 / 예산 부족'};
}
function runPolicies() {
  for(const n of factionCities(G.pf)) {
    if(G.cmd<=0) break;
    const c=G.cities[n],a=policyPlan(c);if(!a.t)continue;
    // 공통 실행기를 통해 검증한다. 플레이어 예산을 먼저 맞추고 실제 실행된 경우만 차감한다.
    const f=G.factions[G.pf],old=f.commands,turn=f.commandTurn;
    f.commandTurn=G.turn;f.commands=G.cmd;const before=f.commands;
    execAIAct(G.pf,a,()=>{});const spent=before-f.commands;
    f.commands=old;f.commandTurn=turn;G.cmd-=spent;
    if(spent) log('위임 · '+n+' — '+a.label+' (명령 1)','');
  }
}
function challengeTargets() {
  const starts=factionCities(G.pf),seen=new Set(starts),queue=[...starts],targets=[];
  while(queue.length) {const n=queue.shift();for(const next of G.cities[n].links) if(!seen.has(next)){seen.add(next);queue.push(next);if(G.cities[next].owner!==G.pf) targets.push(next);}}
  return targets.slice(0,5);
}
function objectiveStatus() {
  if (!G.pf) return {label:'AI 관전: 모든 세력의 천하통일 경쟁',done:false};
  const goal=G.goal||{type:'unification'},mine=factionCities(G.pf).length;
  if(goal.type==='hegemony') return {label:'패권: 24도시 + 남은 모든 세력의 항복',done:mine>=24&&Object.keys(G.factions).every(id=>id===G.pf||!factionCities(id).length||G.factions[id].vassalTo===G.pf)};
  if(goal.type==='challenge'||goal.type==='scenario') {
    const targets=goal.targets||[],held=targets.filter(n=>G.cities[n].owner===G.pf).length;
    const hold=goal.hold,deadline=goal.deadline??24;
    return {label:(hold?'남하 저지: ':'목표 점령: ')+targets.join(' · ')+' ('+held+'/'+targets.length+') · '+Math.max(0,deadline-G.turn)+'개월 남음',
      done:targets.length>0&&held===targets.length&&(!hold||G.turn>=deadline)&&G.turn<=deadline,failed:G.turn>=deadline&&held<targets.length};
  }
  return {label:'천하통일: '+mine+'/30도시',done:mine===30};
}
function openObjectives() {
  if(!strategyReady()||!G.pf)return;
  const editable=G.turn===0&&G.cmd===G.cmdMax;
  showModal('<h3>승리 목표</h3><p>'+objectiveStatus().label+'</p><p class="muted">새 게임 첫 명령 전 목표를 선택할 수 있습니다. 기본 목표는 천하통일입니다. 단기 도전은 24개월 안에 지정된 가까운 적 도시 5곳 점령, 시나리오 목표는 주요 거점 점령 또는 남하 저지입니다.</p>'+['unification','hegemony','challenge','scenario'].map((id,i)=>'<button class="frow"'+(!editable?' disabled':'')+' onclick="Game.setObjective(\''+id+'\')">'+['천하통일','패권 승리','24개월 단기 도전','시나리오 목표'][i]+'</button>').join('')+'<div class="foot"><button onclick="Game.closeModal()">닫기</button></div>');
}
function setObjective(type) {
  if(!strategyReady()||!G.pf||G.turn!==0||G.cmd!==G.cmdMax||!['unification','hegemony','challenge','scenario'].includes(type))return;
  const goal={type};
  if(type==='challenge') {goal.targets=challengeTargets();goal.deadline=24;}
  if(type==='scenario') {
    goal.deadline=24;
    if(G.scenario==='208'&&['liubei','sunce'].includes(G.pf)) {goal.targets=factionCities(G.pf);goal.hold=true;}
    else {const key=G.scenario==='200'?['업','허창']:G.scenario==='219'?['한중','장안','건업']:['낙양','장안','허창'];goal.targets=key.filter(n=>G.cities[n].owner!==G.pf);if(!goal.targets.length)goal.targets=challengeTargets().slice(0,3);}
  }
  G.goal=goal;log('승리 목표 설정 — '+objectiveStatus().label,'good');openObjectives();
}
