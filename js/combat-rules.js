/* 전술전과 전략 AI가 공유하는 전투 규칙. DOM·게임 상태에 의존하지 않는다. */
const CombatRules = (() => {
  const bonds = [
    ['관우','장비','도원 결의','atk'], ['유비','관우','의형제','def'],
    ['유비','장비','의형제','def'], ['제갈량','조운','군신의 신뢰','resist'],
    ['조조','하후돈','창업 공신','atk'], ['하후돈','하후연','하후 형제','atk'],
    ['손책','주유','강동의 벗','atk'], ['주유','황개','적벽의 계책','resist'],
    ['손권','노숙','강동 수성','def'], ['장료','악진','합비의 수호','def'],
    ['마초','마대','서량 기병','atk'], ['황충','위연','한중 공략','atk']
  ];
  const talents = {
    '신산': {desc:'혼란 성공률 +12%p · 계략 저항 +12%p', confuse:.12, resist:.12},
    '무신의 위엄': {desc:'일기토 승리 시 2칸 내 아군 사기 +8', rally:8},
    '장판의 포효': {desc:'근접 공격 시 적 사기 추가 -3', fear:3},
    '난세의 지휘': {desc:'2칸 내 다른 아군의 공격 +8%', command:.08},
    '화공 도독': {desc:'화계 피해 +20% · 강·여울 인접 시 추가 +10%', fire:1.2},
    '비장': {desc:'돌격 피해 +25% · 일기토 승률 +8%p', charge:1.25, duel:.08},
    '백마 선봉': {desc:'돌격 피해 +20% · 계략 저항 +8%p', charge:1.20, resist:.08},
    '금강불괴': {desc:'계략 저항 +18%p · 일기토 승률 +4%p', resist:.18, duel:.04},
    '패왕': {desc:'근접 공격 시 적 사기 추가 -2 · 일기토 승률 +6%p', fear:2, duel:.06},
    '선봉장': {desc:'돌격 피해 +15% · 일기토 승리 시 2칸 내 아군 사기 +5', charge:1.15, rally:5},
    '군략': {desc:'혼란 성공률 +8%p · 계략 저항 +8%p', confuse:.08, resist:.08},
    '침착한 지휘': {desc:'계략 저항 +14%p · 2칸 내 다른 아군의 공격 +5%', resist:.14, command:.05},
    '화공 명수': {desc:'화계 피해 +15% · 강·여울 인접 시 추가 +10%', fire:1.15},
    '독려': {desc:'2칸 내 다른 아군의 공격 +6% · 일기토 승리 시 2칸 내 아군 사기 +5', command:.06, rally:5},
    '기략': {desc:'혼란 성공률 +15%p', confuse:.15},
    '불굴': {desc:'계략 저항 +12%p · 일기토 승리 시 2칸 내 아군 사기 +6', resist:.12, rally:6}
  };
  for (const [label, t] of Object.entries(talents)) t.label = label;
  const unique = {};
  const holders = {
    '신산':'제갈량', '무신의 위엄':'관우', '장판의 포효':'장비', '난세의 지휘':'조조',
    '화공 도독':'주유', '비장':'여포',
    '백마 선봉':'조운 마초 공손찬 마대 방덕',
    '금강불괴':'전위 허저 주태 학소',
    '패왕':'항우 손책 화웅 문앙',
    '선봉장':'하후돈 하후연 감녕 태사자 위연 장료',
    '군략':'사마의 순유 저수 여몽 강유 두예',
    '침착한 지휘':'조인 서황 왕평 육항 황권',
    '화공 명수':'육손 황개',
    '독려':'유비 손권 정보 양호',
    '기략':'곽가 가후 방통 법정 진궁',
    '불굴':'황충 엄안 장임 요화'
  };
  for (const [label, names] of Object.entries(holders)) for (const name of names.split(' ')) unique[name] = talents[label];
  function officerTalent(o) {
    if (!o) return {};
    return o.custom ? (Object.hasOwn(talents,o.talent) ? talents[o.talent] : {}) : (unique[o.name] || {});
  }
  function talent(u) { return officerTalent(u.officer); }
  function strength(u) { const r=Math.max(0,u.troops)/3000; return Math.min(r,Math.sqrt(r)); }
  // 방어도 0~50은 기존 보정 유지. 50 초과의 수복 투자에만 점진적인 추가 방호를 준다.
  function cityDefenseMultiplier(value=0) {
    const defense=Math.max(0,Math.min(100,Number.isFinite(value)?value:0));
    const fortified=Math.max(0,defense-50)/50;
    return 1+defense/400+.13*fortified*fortified;
  }
  function counter(a,b) { return a==='기병'&&b==='궁병'?1.3:a==='궁병'&&b==='보병'||a==='보병'&&b==='기병'?1.2:1; }
  function moveCost(branch, terrain) {
    if(terrain===4) return Infinity;
    if(terrain===5) return branch==='기병'?3:2;
    if(terrain===2) return branch==='기병'?3:2;
    if(terrain===1 && branch==='기병') return 2;
    return 1;
  }
  function bonuses(u, allies = [], nearby = allies) {
    const name=(u.officer||{}).name, names=new Set(allies.filter(a=>a.troops>=1000&&a.alive!==false).map(a=>(a.officer||{}).name));
    const out={atk:1,def:1,resist:talent(u).resist||0,labels:[]};
    for(const [a,b,label,kind] of bonds) if((name===a&&names.has(b))||(name===b&&names.has(a))) {
      if(kind==='resist') out.resist+=.06; else out[kind]+=.06;
      out.labels.push(label);
    }
    const commander=nearby.filter(a=>a!==u&&a.troops>=1000&&a.alive!==false&&talent(a).command)
      .sort((a,b)=>talent(b).command-talent(a).command)[0];
    if(commander) {out.atk+=talent(commander).command;out.labels.push(talent(commander).label);}
    out.atk=Math.min(out.atk,1.2);out.def=Math.min(out.def,1.2);out.resist=Math.min(out.resist,.24);
    return out;
  }
  function ratings(u, allies, nearby) {
    const o=u.officer||{wu:55}, sk=SKILLS[o.skill]||{}, f=FORMS[u.form]||FORMS['안행'], br=BRANCHES[u.branch]||BRANCHES['보병'];
    const b=bonuses(u,allies,nearby), training=u.training??60,morale=u.morale??70;
    return {attack:((o.wu??55)*.55+training*.35+morale*.1)*(sk.atk||1)*f.atk*br.atk*
      (u.branch==='기병'?(f.cav||1):u.branch==='궁병'?(f.bow||1):1)*b.atk,
      defense:((o.wu??55)*.45+training*.35+morale*.2)*(sk.def||1)*f.def*br.def*b.def};
  }
  function damage(a,d,opt={}) {
    const ar=ratings(a,opt.alliesA,opt.nearbyA),dr=ratings(d,opt.alliesD,opt.nearbyD);
    const terrain=[1,1.15,1.25,1.4,1,.85][opt.terrain||0]||1;
    const defense=dr.defense*terrain*cityDefenseMultiplier(opt.cityDef);
    const raw=(ar.attack*counter(a.branch,d.branch)*.9-defense*.45)*34.5*(opt.random??1)*(opt.ranged?.85:1);
    return Math.max(1,Math.round(Math.max(90,raw)*strength(a)));
  }
  function power(u, allies=[], opt={}) {
    const r=ratings(u,allies),t=talent(u),o=u.officer||{};
    const opponents=(opt.opponents||[]).filter(x=>x.troops>0),total=opponents.reduce((s,x)=>s+x.troops,0);
    const matchup=total?opponents.reduce((s,x)=>s+x.troops*counter(u.branch,x.branch),0)/total:1;
    return strength(u)*3000*(r.attack*matchup*.6+r.defense*.4*cityDefenseMultiplier(opt.cityDef))/80*
      (1+(o.zhi??50)/1000+(t.confuse||0)+(t.fire? .04:0));
  }
  function description(o) { const t=officerTalent(o);return t.label?t.label+': '+t.desc:''; }
  return {strength,cityDefenseMultiplier,counter,moveCost,damage,power,ratings,bonuses,talent,description,bonds,unique,talents};
})();
