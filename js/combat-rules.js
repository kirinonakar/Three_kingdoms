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
  const unique = {
    '제갈량': {label:'신산', desc:'혼란 성공률 +12%p · 계략 저항 +12%p', confuse:.12, resist:.12},
    '관우': {label:'무신의 위엄', desc:'일기토 승리 시 2칸 내 아군 사기 +8', rally:8},
    '장비': {label:'장판의 포효', desc:'근접 공격 시 적 사기 추가 -3', fear:3},
    '조조': {label:'난세의 지휘', desc:'2칸 내 다른 아군의 공격 +8%', command:.08},
    '주유': {label:'화공 도독', desc:'화계 피해 +20% · 강·여울 인접 시 추가 +10%', fire:1.2},
    '여포': {label:'비장', desc:'돌격 피해 +25% · 일기토 승률 +8%p', charge:1.25, duel:.08}
  };
  function talent(u) { return unique[(u.officer || {}).name] || {}; }
  function strength(u) { const r=Math.max(0,u.troops)/3000; return Math.min(r,Math.sqrt(r)); }
  function counter(a,b) { return a==='기병'&&b==='궁병'?1.3:a==='궁병'&&b==='보병'||a==='보병'&&b==='기병'?1.2:1; }
  function bonuses(u, allies = [], nearby = allies) {
    const name=(u.officer||{}).name, names=new Set(allies.filter(a=>a.troops>=1000&&a.alive!==false).map(a=>(a.officer||{}).name));
    const out={atk:1,def:1,resist:talent(u).resist||0,labels:[]};
    for(const [a,b,label,kind] of bonds) if((name===a&&names.has(b))||(name===b&&names.has(a))) {
      if(kind==='resist') out.resist+=.06; else out[kind]+=.06;
      out.labels.push(label);
    }
    if(nearby.some(a=>a!==u&&a.troops>=1000&&a.alive!==false&&talent(a).command)) {out.atk+=.08;out.labels.push('난세의 지휘');}
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
    const terrain=[1,1.15,1.25,1.4,1,1][opt.terrain||0]||1;
    const defense=dr.defense*terrain*(1+(opt.cityDef||0)/400);
    const raw=(ar.attack*counter(a.branch,d.branch)*.9-defense*.45)*34.5*(opt.random??1)*(opt.ranged?.85:1);
    return Math.max(1,Math.round(Math.max(90,raw)*strength(a)));
  }
  function power(u, allies=[], opt={}) {
    const r=ratings(u,allies),t=talent(u),o=u.officer||{};
    const opponents=(opt.opponents||[]).filter(x=>x.troops>0),total=opponents.reduce((s,x)=>s+x.troops,0);
    const matchup=total?opponents.reduce((s,x)=>s+x.troops*counter(u.branch,x.branch),0)/total:1;
    return strength(u)*3000*(r.attack*matchup*.6+r.defense*.4*(1+(opt.cityDef||0)/400))/80*
      (1+(o.zhi??50)/1000+(t.confuse||0)+(t.fire? .04:0));
  }
  function description(o) { const t=unique[o?.name];return t?t.label+': '+t.desc:''; }
  return {strength,counter,damage,power,ratings,bonuses,talent,description,bonds,unique};
})();
