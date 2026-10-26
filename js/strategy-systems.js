/* 외교·위임·선택 목표. 기존 명령/경제 함수를 통해 실행한다. */
const CITY_POLICIES = {manual:'직접 관리',agri:'농업 중심',comm:'상업 중심',military:'군사 거점',front:'최전선',support:'후방 지원'};
// 세력 ID가 아닌 현재 군주를 기준으로 한다. 손책→손권 및 신무장 군주도 구분한다.
const AI_STYLES = {
  balanced:{label:'균형',attack:1,hr:1,recruit:1,defense:1,caution:0,stock:0,rally:4,diplomacy:1},
  '조조':{label:'공세·인재 확보',attack:1.12,hr:1.9,recruit:1,defense:1,caution:-.06,stock:0,rally:3,diplomacy:1},
  '원소':{label:'병력 축적·집중 공세',attack:1.06,hr:1,recruit:1.25,defense:1,caution:.1,stock:.72,rally:2,diplomacy:.9},
  '유비':{label:'외교·등용',attack:.96,hr:2.2,recruit:1,defense:1,caution:.04,stock:0,rally:4,diplomacy:1.4},
  '손권':{label:'수비·유리한 전장',attack:.96,hr:1,recruit:1,defense:1.15,caution:.16,stock:0,rally:4,diplomacy:1.15}
};
function aiStyle(fid) {return AI_STYLES[G.leaders?.[fid]]||AI_STYLES.balanced;}

/* 공성·원군을 포함한 전력 추정. 난수를 쓰거나 실제 전투/자원을 변경하지 않는다. */
function attackForecast(from,target,units=null) {
  const src=G.cities[from],dst=G.cities[target];
  if(!src||!dst||src.owner===dst.owner||hasPeace(src.owner,dst.owner))return null;
  if(!units) {
    const list=availableOfficers(from).slice().sort((a,b)=>PICK_SCORE.attack(b)-PICK_SCORE.attack(a));
    const counts=distribute(Math.max(0,src.troops-2000),list.length);
    units=list.map((o,i)=>({officer:o,troops:Math.min(10000,counts[i]),branch:autoBranch(o),form:defaultForm(autoBranch(o)),training:src.training,morale:src.morale}));
  }
  units=units.filter(u=>u.troops>0);
  const total=defenseTroops(units);if(!total)return null;
  if(dst.troops<=0)return {label:'유리',total,low:0,high:0,empty:true};
  const defenders=defenseUnits(target);
  const power=units.reduce((s,u)=>s+unitPower(u,units,{opponents:defenders})*(u.delayed ? .8 : 1),0);
  const ratio=power/Math.max(1,aiDefensePower(dst,units));
  const field=aiFieldDefense(dst,units);
  const supply=Math.ceil(total*(field?24:12)/600*expeditionRate({atk:src.owner,to:target},'atk'));
  const shortage=G.factions[src.owner].food<supply;
  const assessedRatio=ratio*(shortage ? .75 : 1);
  const label=assessedRatio>=1.25?'유리':assessedRatio<.8?'불리':'대등';
  // 간이 판정의 생존율 두 경우에 ±10% 변동을 적용한다. 대등일 때는 양쪽 결과를 포함한다.
  const share=ratio/(1+ratio),win=.45+.45*share,lose=.15+.5*share;
  const best=label==='불리'?lose:win,worst=label==='유리'?win:lose;
  const low=Math.floor(total*Math.max(0,1-best*1.1)/100)*100;
  const high=Math.min(total,Math.ceil(total*(shortage?1:Math.min(1,1-worst*.9+(field ? .2 : 0)))/100)*100);
  return {label,total,low,high,ratio,field,shortage};
}
function forecastText(p) {
  if(!p)return '편성 병력 없음';
  return p.label+' · 아군 예상 손실 '+commas(p.low)+'~'+commas(p.high)+'명'+
    (p.empty?' · 무주둔 도시':p.shortage?' · 군량 부족 위험':p.field?' · 야전 후 공성 포함':' · 공성 기준');
}
function cityAttackForecast(target) {
  const rows=G.cities[target].links.filter(n=>G.cities[n].owner===G.pf&&availableOfficers(n).length)
    .map(n=>({from:n,p:attackForecast(n,target)})).filter(r=>r.p);
  if(!rows.length)return '';
  return '<div class="enemy-note"><b>공격 전망</b>'+rows.map(r=>'<p>'+r.from+' 출진 '+commas(r.p.total)+'명: '+forecastText(r.p)+'</p>').join('')+
    '</div>';
}

/* 전역 기록: 야전→공성은 최종 결과 하나만 집계. 승리 참전 1회 = 전공 1점. */
const CAMPAIGN_BEST_KEY='sangokji_campaign_best_v1';
const recordEscape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ensureCampaignStats(partial=true) {
  if(!G.stats)G.stats={since:G.turn||0,partial,assisted:!!G.fullDelegation,factions:{},battles:[]};
  for(const id of Object.keys(G.factions))if(!G.stats.factions[id])G.stats.factions[id]={wins:0,losses:0,peak:0,merit:{}};
  updateCampaignPeaks();return G.stats;
}
function updateCampaignPeaks() {
  if(!G.stats)return;
  for(const [id,s] of Object.entries(G.stats.factions))s.peak=Math.max(s.peak,factionCities(id).length);
}
function recordCampaignBattle(ctx,res) {
  if(ctx.statsRecorded)return;
  const stats=ensureCampaignStats(),winner=res.winner==='attacker'?ctx.atk:ctx.def,loser=winner===ctx.atk?ctx.def:ctx.atk;
  stats.factions[winner].wins++;stats.factions[loser].losses++;
  const unopposed=!!(res.autoRetreat||res.preBattleRetreat);
  if(!unopposed)for(const name of new Set(res[winner===ctx.atk?'atk':'def'].map(u=>u.name).filter(n=>off(n)))) {
    const merit=stats.factions[winner].merit;merit[name]=(merit[name]||0)+1;
  }
  stats.battles.push({turn:G.turn||0,city:ctx.to,atk:ctx.atk,def:ctx.def,winner,unopposed});
  stats.battles=stats.battles.slice(-30);ctx.statsRecorded=true;
}
function campaignRecordKey(fid) {
  return [G.scenario,fid,G.goal?.type||'unification',G.pf===null?'spectator':G.stats.assisted?'delegated':'player',G.officers.some(o=>o.custom)?'custom':'historical'].join(':');
}
function readCampaignBests() {
  try {
    const data=JSON.parse(localStorage.getItem(CAMPAIGN_BEST_KEY)||'{}');
    if(!data||typeof data!=='object'||Array.isArray(data))return {};
    return Object.fromEntries(Object.entries(data).filter(([k,v])=>/^[\w:]+$/.test(k)&&Number.isInteger(v)&&v>=0&&v<=120000));
  } catch(e) {return {};}
}
function campaignSummary(fid=G.pf,completed=false) {
  const stats=ensureCampaignStats(),s=stats.factions[fid],months=G.turn||0;
  const bestOfficers=Object.entries(s.merit).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  const rivals=Object.entries(stats.factions).filter(([id])=>id!==fid).sort((a,b)=>b[1].peak-a[1].peak);
  const top=bestOfficers[0],enemy=rivals[0],key=campaignRecordKey(fid),bests=readCampaignBests();
  let saved='',best=bests[key];
  if(completed&&!stats.partial) {
    if(best===undefined||months<best) {
      best=months;bests[key]=months;
      try {localStorage.setItem(CAMPAIGN_BEST_KEY,JSON.stringify(bests));saved=' · 최고 기록 갱신';}
      catch(e){saved=' · 로컬 기록 저장 실패';}
    }
  }
  return '<div class="sec"><b>전역 통계 · '+recordEscape(G.factions[fid].name)+'</b></div><p>경과 '+months+'개월 · 승전 '+s.wins+'회 / 패전 '+s.losses+'회</p>'+
    '<p>최다 전공: '+(top?recordEscape(bestOfficers.filter(r=>r[1]===top[1]).map(r=>r[0]).join(' · '))+' ('+top[1]+'점)':'없음')+'</p>'+
    '<p>최대 영토의 적: '+(enemy&&enemy[1].peak?recordEscape(G.factions[enemy[0]].name)+' ('+enemy[1].peak+'도시)':'없음')+'</p>'+
    '<p class="muted">승리한 전역 참전 1회당 전공 1점. 무혈 점령·전투 전 후퇴는 전공에서 제외. '+(stats.partial?'이전 기록 없음: '+stats.since+'개월째부터 집계.':'야전과 이어지는 공성은 1회로 집계.')+'</p>'+
    '<p class="muted">동일 시나리오·세력·목표·운영 방식·신무장 유무의 최단 달성: '+(best===undefined?'없음':best+'개월')+saved+'</p>';
}
function openCampaignRecords() {
  if(!G||G.battleActive||attackIntro)return;
  const fid=G.pf||Object.keys(G.factions).sort((a,b)=>factionCities(b).length-factionCities(a).length)[0];
  const stats=ensureCampaignStats();
  showModal('<h3>전역 기록</h3>'+campaignSummary(fid)+'<h3>최근 주요 전투 (최대 30회)</h3>'+
    stats.battles.slice().reverse().map(b=>'<p>'+b.turn+'개월째 · '+recordEscape(b.city)+' · '+recordEscape(G.factions[b.atk].name)+' → '+recordEscape(G.factions[b.def].name)+' · '+recordEscape(G.factions[b.winner].name)+' 승리'+(b.unopposed?' (무혈 점령/사전 후퇴)':'')+'</p>').join('')+
    (!stats.battles.length?'<p class="muted">아직 기록된 전투가 없습니다.</p>':'')+'<div class="foot"><button onclick="Game.closeModal()">닫기</button></div>');
}
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
    const willingness=(aiStyle(a).diplomacy+aiStyle(b).diplomacy)/2;
    const common=[...enemies(a)].some(k=>k!==b&&enemies(b).has(k)&&factionTotals(k).troops>Math.min(factionTotals(a).troops,factionTotals(b).troops)/willingness);
    const exhausted=f.food<factionEconomy(a).foodUpkeep*2&&g.food<factionEconomy(b).foodUpkeep*2;
    const truce=border&&exhausted;
    if(!truce&&(!common||(f.rel[b]||0)<-(willingness-1)*40))continue;
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
  if(G?.over){openCampaignRecords();return;}
  if(!strategyReady()) return;
  const automation = '<h3>' + (G.pf ? '전체위임' : '전체 AI 관전') + '</h3><p class="muted">내정·외교·등용·병력 이동·출진·수비·전투와 다음 달 진행까지 AI가 처리합니다. ' + (G.pf ? '상단 [전체위임 해제]를 누르면 남은 명령권으로 직접 지휘할 수 있습니다.' : '상단 버튼으로 일시정지하거나 재개할 수 있습니다.') + '</p>' +
    (G.pf ? '<button class="primary" onclick="Game.setFullDelegation(' + !G.fullDelegation + ')">' + (G.fullDelegation ? '전체위임 해제 · 직접 지휘' : '전체위임 시작') + '</button>' : '<button class="primary" onclick="Game.toggleAutoPlay()">AI 자동 진행 재개</button>');
  showModal(automation + (G.pf ? '<h3>도시 위임</h3><p class="muted">턴 종료 시 남은 명령권으로 도시당 1회 실행합니다. 직접 명령과 같은 금·무장 행동을 사용합니다. 후방 지원은 인접한 전방 방향 도시로 수송합니다. 전체위임 중에는 AI가 모든 도시의 운영 방침을 결정합니다.</p>'+factionCities(G.pf).map(n=>{
    const c=G.cities[n];return '<div class="row"><b>'+n+'</b><select aria-label="'+n+' 위임 방침" onchange="Game.setPolicy(\''+n+'\',this.value)">'+Object.entries(CITY_POLICIES).map(([id,label])=>'<option value="'+id+'"'+((c.policy||'manual')===id?' selected':'')+'>'+label+'</option>').join('')+'</select><span class="muted" id="policyPreview_'+n+'">'+policyPlan(c).label+'</span></div>';
  }).join('') : '')+'<div class="foot"><button onclick="Game.openCampaignRecords()">전역 기록</button>' + (G.pf ? '<button onclick="Game.openObjectives()">승리 목표</button>' : '') + '<button onclick="Game.closeModal()">닫기</button></div>');
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
