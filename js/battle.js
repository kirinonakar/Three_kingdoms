/* =====================================================
   삼국지 : 천하통일 — 전술 전투 (삼국지5 스타일 격자 전투)
   ===================================================== */
const Battle = (function () {
  'use strict';
  const COLS = 13, ROWS = 9;
  const WATER = 4, FORD = 5;          // 0 평지 · 1 숲 · 2 산 · 3 성 · 4 물 · 5 여울
  const STRATS = ['화계', '혼란', '고무'];
  let TILE = 44, DPR = 1;
  // 부대 카드 배율 — 54 기준 카드가 타일 밖으로 튀어나오지 않게 살짝 줄인다
  const CARD_FIT = 0.86;
  let B = null, cv = null, ctx = null;
  const camera = { scale: 1, px: 0, py: 0 };
  let navigation = null, canvasObserver = null;
  let fittedViewport = '';

  function setCamera(next) {
    Object.assign(camera, next);
    camera.scale = cl(camera.scale, 1, 4);
    camera.px = cl(camera.px, COLS * TILE * (1 - camera.scale), 0);
    camera.py = cl(camera.py, ROWS * TILE * (1 - camera.scale), 0);
    const label = $('bZoomLabel');
    if (label) label.textContent = '×' + camera.scale.toFixed(2);
    hideUnitTooltip();
    draw();
  }
  function zoomBy(factor) {
    const scale = cl(camera.scale * factor, 1, 4), ratio = scale / camera.scale;
    setCamera({ scale, px: COLS * TILE / 2 - (COLS * TILE / 2 - camera.px) * ratio,
      py: ROWS * TILE / 2 - (ROWS * TILE / 2 - camera.py) * ratio });
  }
  function zoomReset() { setCamera({ scale: 1, px: 0, py: 0 }); }
  function boardPoint(e) {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width * COLS * TILE - camera.px) / camera.scale / TILE,
      y: ((e.clientY - r.top) / r.height * ROWS * TILE - camera.py) / camera.scale / TILE };
  }

  /* 사운드 — audio.js 가 없으면 조용히 넘어간다 */
  const sfx = (n, details) => { if (typeof Sound !== 'undefined' && Sound) Sound.sfx(n, details); };
  const bgm = n => { if (typeof Sound !== 'undefined' && Sound) Sound.bgm(n); };

  /* ── 유틸 ──────────────────────────────────────────── */
  function mdist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
  function alive(side) { return B.units.filter(u => u.alive && u.side === side); }
  function troopsOf(side) { return alive(side).reduce((s, u) => s + u.troops, 0); }
  function selUnit() { return B && B.sel && B.sel.alive ? B.sel : null; }
  // 혼란 상태 — 이동·공격·계략·일기토·진형 전부 불가 (반격도 불가)
  function isConfused(u) { return !!u && (u.confused > 0 || u.confusedNow); }
  function unitAt(x, y) { return B.units.find(u => u.alive && u.x === x && u.y === y); }


  // 3,000명 기준 전투력. 그 아래는 병력에 비례하고, 대부대는 점차 완만하게 증가한다.
  // 최초 편성 병력(max)에 기대지 않아 병력을 쪼개거나 재편성해도 전투력이 복제되지 않는다.
  function troopStrength(u) {
    return CombatRules.strength(u);
  }
  // 소수 별동대가 대군의 사기를 깎거나 계략으로 무력화하는 효과를 제한한다.
  function tacticalScale(u) { return Math.min(1, Math.max(0, u.troops) / 1000); }


  /* 도시별 북향 전술 약도 — 강안 도형과 이동 지형을 같은 데이터로 생성한다. */
  const buildTerrain = (city, siege, approach) => BattleTerrain.build(city, siege, approach);

  /* ── 전투 개시 ─────────────────────────────────────── */
  function start(opts) {
    Object.assign(camera, { scale: 1, px: 0, py: 0 });
    B = {
      opts, cityDef: opts.siege && opts.city ? (opts.city.def ?? 50) : 0,
      round: 1, maxRound: 15, over: false, auto: !!opts.auto,
      playerSide: opts.playerSide, side: 'atk', sel: null, autoSel: false, mode: 'select', strat: null,
      log: [], floats: [], fx: [], busy: false, duelRequest: null, units: [], terrain: [], pending: [], supply: null, supplyRound: 0
    };
    // 도시별 지리 약도에서 하천·산지·숲·성곽 생성
    B.geo = buildTerrain(opts.city || { name: opts.atk.name, x: 560, y: 360 }, !!opts.siege, opts.approach);
    B.terrain = B.geo.terrain;
    if(typeof Sound!=='undefined' && Sound.setScene) Sound.setScene({theme:B.geo.theme,tension:.35});
    (opts.atk.units || []).forEach(u => B.units.push(mkUnit('atk', u)));
    (opts.def.units || []).forEach(u => B.units.push(mkUnit('def', u)));
    B.units.forEach(u => { if (u.troops <= 0) { u.alive = false; } });
    place();
    buildUI();
    bLog('⚔ ' + opts.atk.name + '군 vs ' + opts.def.name + '군 — ' + opts.city.name + (opts.siege ? ' 공성전' : ' 야전') + ' 개시!');
    bLog('🗺 '+B.geo.site+' — '+B.geo.tactics);
    sfx('battleStart');
    bgm('battle');
    roundStart();
  }

  function mkUnit(side, u) {
    const o = u.officer || { name: '수비병', wu: 55, zhi: 50, pol: 50, cha: 50, skill: '' };
    const tr = Math.max(0, Math.round(u.troops || 0));
    const br = BRANCHES[u.branch] ? u.branch : '보병';
    const fm = FORMS[u.form] ? u.form : '어린';
    return {
      side, name: o.name, officer: o, noOfficer: !u.officer,
      color: side === 'atk' ? B.opts.atk.color : B.opts.def.color,
      troops: tr, max: Math.max(1, tr),
      training: u.training ?? 60, morale: cl(u.morale ?? 70, 20, 100),
      branch: br, form: fm,
      x: 0, y: 0, acted: false, moved: false, confused: 0, confusedNow: false, dueled: false, alive: true,
      charge: br === '기병' ? CHARGE_MAX : 0,
      volley: br === '보병' || br === '기병' ? VOLLEY_MAX : 0,
      fire: br === '궁병' ? FIRE_ARROWS_MAX : 0, burn: 0, burnRate: 0
    };
  }

  // 통행 가능한 가장 가까운 칸 (물·부대 점유 회피)
  function landSpot(x, y) {
    let best = null, bd = 1e9;
    for (let yy = 0; yy < ROWS; yy++) {
      for (let xx = 0; xx < COLS; xx++) {
        if (B.terrain[yy][xx] === WATER || unitAt(xx, yy)) continue;
        const d = Math.abs(xx - x) + Math.abs(yy - y);
        if (d < bd) { bd = d; best = { x: xx, y: yy }; }
      }
    }
    return best || { x: cl(x, 0, COLS - 1), y: cl(y, 0, ROWS - 1) };
  }

  function place() {
    // 중앙 줄부터 바깥으로 채운다 (격자 크기가 바뀌어도 그대로 동작)
    const mid = (ROWS - 1) / 2;
    const rowSeq = Array.from({ length: ROWS }, (_, i) => i)
      .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
    const atk = B.units.filter(u => u.side === 'atk');
    const def = B.units.filter(u => u.side === 'def');
    const fort = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (B.terrain[y][x] === 3) fort.push({ x, y });
    atk.forEach((u, i) => {
      const p = landSpot(i % 2, rowSeq[i % rowSeq.length]);
      u.x = p.x; u.y = p.y;
    });
    def.forEach((u, i) => {
      // Each strongpoint gets a garrison first; extra defenders deploy around it.
      const f = fort.length ? fort[i % fort.length] : null;
      const p = landSpot(f ? f.x : COLS - 1 - (i % 2), f ? f.y : rowSeq[i % rowSeq.length]);
      u.x = p.x; u.y = p.y;
    });
  }


  /* ── 원군 합류 ─────────────────────────────────────── */
  // 원군은 출발 도시에서 전장까지 며칠(라운드)에 걸쳐 도착한다
  const REINF_DAYS = 3;

  function reinforce(units, side, opt) {
    if (!B || B.over || !units || !units.length) return false;
    const s = side === 'def' ? 'def' : 'atk';
    const o = opt || {};
    const days = Math.max(1, Math.round(o.delay == null ? REINF_DAYS : o.delay));
    const list = units.filter(u => u && u.troops > 0);
    if (!list.length) return false;
    if (!B.pending) B.pending = [];
    B.pending.push({
      side: s, from: o.from || '', days, due: B.round + days,
      units: list.map(u => ({
        officer: u.officer || null, troops: Math.round(u.troops), branch: u.branch,
        training: u.training, morale: u.morale, form: u.form
      }))
    });
    bLog('🪖 ' + list.map(u => (u.officer ? u.officer.name : '병사')).join('·') + ' 원군 출발' +
      (o.from ? ' (' + o.from + ' → ' + B.opts.city.name + ')' : '') + ' — ' + days + '일 후 도착');
    renderPanel();
    return true;
  }

  /* 도착 예정일이 된 원군을 전장에 합류시킨다 (도착한 라운드에는 행동 완료) */
  function arriveReinforcements() {
    if (!B || !B.pending || !B.pending.length) return;
    const due = B.pending.filter(p => p.due <= B.round);
    if (!due.length) return;
    B.pending = B.pending.filter(p => p.due > B.round);
    due.forEach(p => {
      const added = [];
      (p.units || []).forEach(u => {
        if (!u || !(u.troops > 0)) return;
        const nu = mkUnit(p.side, u);
        nu.acted = true;                  // 도착한 라운드에는 이동·공격 불가
        // Defensive reinforcements join around a strongpoint as well.
        const forts = p.side === 'def' ? fortTiles() : [];
        const anchor = forts.length ? forts.slice().sort((a,b) => {
          const crowd = f => B.units.filter(u => u.alive && u.side === 'def' && mdist(u,f) <= 2).length;
          return (a.owner === 'def' ? 0 : 10) + crowd(a) - (b.owner === 'def' ? 0 : 10) - crowd(b);
        })[0] : null;
        const spot = landSpot(anchor ? anchor.x : p.side === 'atk' ? 0 : COLS - 1, anchor ? anchor.y : (ROWS - 1) / 2);
        nu.x = spot.x; nu.y = spot.y;
        B.units.push(nu);
        added.push(nu.name);
      });
      syncForts(true);
      if (added.length) {
        bLog('🪖 ' + (p.side === 'atk' ? B.opts.atk.name : B.opts.def.name) + '군 원군 도착 — ' +
          added.join('·') + (p.from ? ' (' + p.from + '에서)' : '') + ' (다음 라운드부터 행동)');
      }
    });
  }

  /* 적(AI) 원군 — 라운드가 바뀔 때마다 호스트가 증원 필요 여부를 판단한다 */
  function askAiReinforce() {
    if (!B || B.over) return;
    if (typeof B.opts.onAiReinforce !== 'function') return;
    const foe = B.playerSide === 'atk' ? 'def' : 'atk';
    try {
      B.opts.onAiReinforce({ side: foe, round: B.round, maxRound: B.maxRound });
    } catch (e) { /* 원군 판단 실패는 전투 진행에 영향을 주지 않는다 */ }
  }

  /* ── UI 구성 ───────────────────────────────────────── */
  function buildUI() {
    const root = $('battleRoot');
    if (!root) return;
    root.innerHTML =
      '<div class="battle-bg"><div class="battle-wrap">' +
        '<div class="battle-head">' +
          '<div class="bh-details" role="region" aria-label="전투 정보 · 좌우로 스크롤" tabindex="0">' +
          '<b>' + B.opts.city.name + (B.opts.siege ? ' 공성전' : ' 야전') + '</b>' +
          '<span class="bh-vs"><span class="side">' + B.opts.atk.name + '군</span><span class="vs">VS</span><span class="side">' + B.opts.def.name + '군</span></span>' +
          '<span class="muted">숲 +15% · 산 +25%' + (B.opts.siege?' · 성 +40%':'') + (B.opts.siege ? ' · 방어도 ' + (B.opts.city.def || 50) : '') + '</span>' +
          '<span id="bReinfInfo" class="bh-reinf"></span>' +
          '<span id="bRoundInfo"></span>' +
          '</div>' +
          '<span class="bh-sound">' +
            '<button type="button" id="bBgm" class="on" onclick="Battle.toggleBgm()" title="배경음악 켜짐 (M)" aria-label="배경음악 켜기/끄기" aria-pressed="true">♪</button>' +
            '<button type="button" id="bSfx" class="on" onclick="Battle.toggleSfx()" title="효과음 켜짐 (N)" aria-label="효과음 켜기/끄기" aria-pressed="true">🔊</button>' +
          '</span>' +
        '</div>' +
        '<div class="battle-body">' +
          '<div class="battle-map">' +
            '<div id="bMapScore" class="bscore battle-map-score" role="status" aria-label="전장 병력 현황"></div>' +
            '<div id="bMapReinfInfo" class="bh-reinf battle-map-reinf" role="status" aria-label="원군 진군 현황"></div>' +
            '<div class="battle-geography"><div><b>' + B.geo.region + ' · '+B.geo.site+'</b><span>' + (B.opts.siege?B.geo.detail:B.geo.tactics) + '</span></div><span class="north">↑ 북</span></div>' +
            '<div class="battle-viewport" id="bViewport"><canvas id="battleCanvas" aria-label="' + B.opts.city.name + ' 전술 전장" width="' + (COLS * TILE) + '" height="' + (ROWS * TILE) + '"></canvas>' +
              '<details id="bMinimap" class="minimap-panel battle-minimap" open><summary>전장 미니맵<span class="minimap-fold" aria-hidden="true"></span></summary>' +
                '<canvas id="bMiniCanvas" width="296" height="205" role="img" aria-label="전장 전체 지도 · 파란 원은 아군, 붉은 마름모는 적군" title="전체 전장 · 누르면 해당 위치로 이동"></canvas>' +
                '<div class="battle-minimap-legend"><span class="friendly">● 아군 <b id="bMiniFriendly">0</b></span><span class="hostile">◆ 적군 <b id="bMiniHostile">0</b></span></div></details></div>' +
            '<div class="terrain-legend"><span><i class="land"></i>평지</span><span><i class="forest"></i>숲 +15%</span><span><i class="mountain"></i>산 +25%</span>' + (B.opts.siege?'<span><i class="fort"></i>성 +40%</span>':'') + '<span><i class="water"></i>물 · 진입 불가</span><span><i class="ford"></i>여울 · 방어 -15% · 이동 2~3</span></div>' +
            '<div class="map-hint" id="bTerrainInfo"></div>' +
            '<details class="text-board battle-directory" id="bDirectory"><summary>전장 목록 · 좌표로 조작</summary><div id="bTextBoard"></div></details>' +
            '<div class="battle-map-footer"><div class="gesture-hint" title="두 손가락으로 확대·축소 · 드래그로 이동 · 부대를 눌러 선택">두 손가락으로 확대·축소 · 드래그로 이동 · 부대를 눌러 선택</div>' +
            '<div class="battle-zoom" role="group" aria-label="전장 배율"><button type="button" onclick="Battle.zoomBy(1.25)" aria-label="전장 확대">＋</button><button type="button" onclick="Battle.zoomBy(.8)" aria-label="전장 축소">－</button><button type="button" onclick="Battle.zoomReset()" aria-label="전장 전체 보기">⟲</button><span id="bZoomLabel">×1.00</span></div></div>' +
          '</div>' +
          '<div class="battle-side">' +
            '<div id="bScore" class="bscore"></div>' +
            '<div class="battle-details"><div id="bUnit"></div><div id="bLog"></div></div>' +
            '<div class="battle-commands"><div id="bActs"></div>' +
            '<div class="battle-foot">' +
              '<button id="bReinf" onclick="Battle.act(\'reinforce\')">원군</button>' +
              '<button id="bAuto" onclick="Battle.act(\'auto\')">자동 진행</button>' +
              ((B.playerSide === 'atk' || !B.opts.siege || retreatCities().length) ?
                '<button id="bRetreat" onclick="Battle.act(\'retreat\')"' +
                  (B.playerSide === 'def' ? ' title="잔존 병력을 이끌고 다른 도시로 후퇴"' : '') + '>후퇴</button>' : '') +
              '<button id="bNext" onclick="Battle.act(\'nextTurn\')" title="남은 부대를 대기시키고 다음 턴으로">다음 턴 ▶</button>' +
            '</div></div>' +
          '</div>' +
        '</div>' +
        '<div id="bUnitTooltip" class="battle-unit-tooltip" role="tooltip" hidden></div>' +
        '<div id="bDuelPrompt"></div>' +
      '</div></div>';
    cv = $('battleCanvas');
    ctx = cv.getContext('2d');
    $('bMinimap').addEventListener('toggle', drawMinimap);
    const mini = $('bMiniCanvas');
    if (mini) mini.addEventListener('pointerup', e => {
      if (!B || e.button !== 0) return;
      const r = mini.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setCamera({
        px: COLS*TILE/2 - (e.clientX-r.left)/r.width*COLS*TILE*camera.scale,
        py: ROWS*TILE/2 - (e.clientY-r.top)/r.height*ROWS*TILE*camera.scale
      });
    });
    navigation = bindCanvasNavigation(cv, {
      size: () => ({ width: COLS * TILE, height: ROWS * TILE, maxScale: 4 }),
      read: () => camera, write: setCamera,
      begin: hideUnitTooltip, end: () => draw()
    });
    cv.addEventListener('click', onClick);
    cv.addEventListener('pointermove', e => { if (!navigation.active && e.pointerType !== 'touch') inspectTerrain(e); });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const p = boardPoint(e), scale = cl(camera.scale * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1) * .0012), 1, 4);
      const ax = p.x * TILE * camera.scale + camera.px, ay = p.y * TILE * camera.scale + camera.py;
      setCamera({ scale, px: ax - p.x * TILE * scale, py: ay - p.y * TILE * scale });
    }, { passive: false });
    cv.addEventListener('mouseleave', () => { const el=$('bTerrainInfo'); if(el) el.textContent='';hideUnitTooltip(); });
    const board=$('bTextBoard');
    board.addEventListener('mousemove',e=>{
      const cell=e.target.closest('[data-battle-x]');
      showUnitTooltip(cell?unitAt(Number(cell.dataset.battleX),Number(cell.dataset.battleY)):null,e);
    });
    board.addEventListener('mouseleave',hideUnitTooltip);
    $('bDirectory').addEventListener('toggle', fitCanvas);
    syncSound();                        // 저장된 음악·효과음 설정을 버튼에 반영
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', fitCanvas);
      window.addEventListener('orientationchange', fitCanvas);
    }
    renderBlog();
    if (typeof ResizeObserver !== 'undefined') {
      canvasObserver = new ResizeObserver(fitCanvas);
      canvasObserver.observe($('bViewport'));
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fitCanvas);
    else fitCanvas();
  }

  function inspectTerrain(e) {
    if(!B||!cv) return;
    const p=boardPoint(e), x=Math.floor(p.x), y=Math.floor(p.y);
    if(x<0||y<0||x>=COLS||y>=ROWS) {hideUnitTooltip();return;}
    const names=['평지 · 이동 1 · 기병 돌격 가능','숲 · 방어 +15% · 보병/궁병 이동 1 · 기병 이동 2 · 돌격 불가','산 · 방어 +25% · 보병/궁병 이동 2 · 기병 이동 3 · 돌격 불가','성 · 방어 +40%','물 · 진입 불가','여울 · 방어 -15% · 보병/궁병 이동 2 · 기병 이동 3 · 돌격 불가'];
    const fords=fordDirections(x,y);
    const el=$('bTerrainInfo');if(el) el.textContent=(x+1)+'열 '+(y+1)+'행 · '+names[B.terrain[y][x]]+
      (fords.length?' · '+fords.join('·')+' 여울로 도하 가능':'');
    const moving=B.units.find(u=>{const a=u.alive&&animPos(u);return a && Math.abs(a.x+.5-p.x)<.44 && Math.abs(a.y+.5-p.y)<.44;});
    showUnitTooltip(moving || unitAt(x,y),e);
  }

  function fordDirections(x,y) {
    return B.geo.edgeFords.flatMap(c=>{
      const other=c.from.x===x&&c.from.y===y?c.to:c.to.x===x&&c.to.y===y?c.from:null;
      return other?[other.x>x?'동쪽':other.x<x?'서쪽':other.y>y?'남쪽':'북쪽']:[];
    });
  }

  function hideUnitTooltip() {const el=$('bUnitTooltip');if(el)el.hidden=true;}
  function showUnitTooltip(u,e) {
    const el=$('bUnitTooltip');if(!el)return;
    if(!B || B.over || !u || !u.alive) {el.hidden=true;return;}
    const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const o=u.officer,sk=SKILLS[o.skill],army=B.opts[u.side];
    const statuses=[u.acted?'행동 완료':u.moved?'이동 완료 · 공격 가능':'미행동'];
    if(isConfused(u))statuses.push('혼란');if(u.burn>0)statuses.push('화상 '+u.burn+'일');
    const face=portraitFace(u.name), sideTxt=(u.side===B.playerSide?'아군':'적군')+' · '+escape(army.name)+'군';
    const head=face
      ? '<div class="ut-head face-head">'+face+'<span class="ut-who"><b>'+escape(u.name)+'</b></span><span class="ut-army">'+sideTxt+'</span></div>'
      : '<div class="ut-head"><span class="ut-who">'+portraitHtml(u.name,22)+'<b>'+escape(u.name)+'</b></span><span class="ut-army">'+sideTxt+'</span></div>';
    const html=head+
      '<div class="ut-sub">'+escape(u.branch)+' · '+escape(u.form)+'진 · '+statuses.join(' · ')+'</div>'+
      '<div class="ut-grid"><span>병력</span><b>'+commas(u.troops)+' / '+commas(u.max)+'</b><span>훈련 · 사기</span><b>'+u.training+' · '+u.morale+'</b>'+
      '<span>무력 · 지력</span><b>'+o.wu+' · '+o.zhi+'</b><span>정치 · 매력</span><b>'+o.pol+' · '+o.cha+'</b></div>'+
      (sk?'<p class="ut-skill">'+escape(o.skill)+' · '+escape(sk.desc)+'</p>':'')+
      (CombatRules.description(o)?'<p class="ut-skill">'+escape(CombatRules.description(o))+'</p>':'')+
      '<p>'+CombatRules.bonuses(u,alive(u.side),alive(u.side).filter(a=>mdist(a,u)<=2)).labels.join(' · ')+'</p>'+
      '<p>'+escape(BRANCHES[u.branch].desc)+'</p><p>'+escape((FORMS[u.form]||{}).desc||'')+'</p>'+
      (u.branch==='기병'?'<p>돌격 '+chargeLeft(u)+'회 남음</p>':'')+
      (u.branch==='보병'?'<p>일제공격 '+volleyLeft(u)+'회 남음 (시작·참여 시 1회 소모)</p>':'')+
      (u.branch==='기병'?'<p>일제공격 참여 '+volleyLeft(u)+'회 남음 (보병이 시작할 때 참여만 가능)</p>':'')+
      (u.branch==='궁병'?'<p>불화살 '+fireLeft(u)+'회 남음</p>':'')+
      (fortAt(u.x,u.y)?'<p class="ut-skill">성 주둔 · 지형 방어 +40% · 받는 반격 피해 -25%</p>':'');
    if(el.innerHTML!==html)el.innerHTML=html;
    el.hidden=false;
    const box=el.getBoundingClientRect(),width=window.innerWidth,height=window.innerHeight;
    let left=e.clientX+18,top=e.clientY+16;
    if(left+box.width>width-12)left=e.clientX-box.width-16;
    if(top+box.height>height-12)top=e.clientY-box.height-16;
    el.style.left=Math.max(12,Math.min(left,width-box.width-12))+'px';
    el.style.top=Math.max(12,Math.min(top,height-box.height-12))+'px';
  }

  /* 전장 캔버스를 화면(전체화면)에 꽉 채운다 — 칸 수가 많을수록 타일은 작아진다 */
  function fitCanvas() {
    if (!cv || !B) return;
    const host = cv.parentElement;
    if (!host || !host.clientWidth) return;
    const style = getComputedStyle(host);
    const paddingH = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const paddingW = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const availW = Math.max(120, host.clientWidth - paddingW - 2);
    const availH = Math.max(1, host.clientHeight - paddingH - 2);
    const pixelRatio = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1,4096/availW,4096/availH);
    const signature = availW + ':' + availH + ':' + pixelRatio;
    // 부모 작업 영역만 측정한다. 동일한 크기의 알림으로 캔버스를 다시 줄이지 않는다.
    if (signature === fittedViewport) return;
    fittedViewport = signature;
    // 정사각 타일 기준 크기
    const previousTile = TILE;
    TILE = Math.max(24, Math.floor(Math.min(availW / COLS, availH / ROWS)));
    camera.px *= TILE / previousTile;
    camera.py *= TILE / previousTile;
    const bw = COLS * TILE, bh = ROWS * TILE;
    // Preserve square cells and geographic proportions at every viewport size.
    const sx = Math.min(availW / bw, availH / bh), sy = sx;
    DPR = pixelRatio;
    cv.width = Math.round(bw * sx * DPR);
    cv.height = Math.round(bh * sy * DPR);
    cv.style.width = Math.round(bw * sx) + 'px';
    cv.style.height = Math.round(bh * sy) + 'px';
    if (ctx && ctx.setTransform) ctx.setTransform(DPR * sx, 0, 0, DPR * sy, 0, 0);
    draw();
  }

  function destroyUI() {
    if (canvasObserver) canvasObserver.disconnect();
    canvasObserver = null; navigation = null; fittedViewport = '';
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('resize', fitCanvas);
      window.removeEventListener('orientationchange', fitCanvas);
    }
    if (fxRaf != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(fxRaf);
    fxRaf = null;
    cv = null; ctx = null;
    const root = $('battleRoot'); if (root) root.innerHTML = '';
  }

  function bLog(m) {
    if (!B) return;
    B.log.push(m);
    renderBlog();
  }
  function renderBlog() {
    const el = $('bLog');
    if (!el || !B) return;
    el.innerHTML = B.log.slice(-50).map(l => {
      let cls = '';
      if (/^──/.test(l)) cls = 'sep';
      else if (/승리|전멸|도주|일기토/.test(l)) cls = 'hot';
      else if (/실패/.test(l)) cls = 'bad';
      else if (/이동|대기|라운드|자동/.test(l)) cls = 'dim';
      return '<div class="l ' + cls + '">' + l + '</div>';
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  /* ── 턴 진행 ───────────────────────────────────────── */
  function consumeRoundSupply() {
    if (typeof B.opts.onSupply !== 'function' || B.supplyRound >= B.round ||
      !alive('atk').length || !alive('def').length) return;
    const troops = side => troopsOf(side) + (B.pending || []).filter(p=>p.side===side)
      .reduce((s,p)=>s+p.units.reduce((n,u)=>n+u.troops,0),0);
    const supply = B.opts.onSupply({round:B.round,atk:troops('atk'),def:troops('def')});
    B.supplyRound = B.round;
    if (!supply) return;
    B.supply = supply;
    for(const side of ['atk','def']) {
      const ration = supply[side]; if (!ration) continue;
      B.log.push('군량: ' + B.opts[side].name + ' -' + ration.cost +
        (ration.moraleLoss ? ' · 보급 부족, 사기 -' + ration.moraleLoss : ''));
      if (!ration.moraleLoss) continue;
      alive(side).forEach(u=>{u.morale=cl(u.morale-ration.moraleLoss,0,100);});
      (B.pending || []).filter(p=>p.side===side).forEach(p=>p.units.forEach(u=>{
        u.morale=cl((u.morale??70)-ration.moraleLoss,0,100);
      }));
    }
    B.units.forEach(u=>checkAlive(u));
  }
  function roundStart() {
    if(typeof Sound!=='undefined' && Sound.setScene) Sound.setScene({tension:Math.min(1,(B.round-1)/10)});
    if (!B || B.over) return;
    if (B.round > B.maxRound) { timeUp(); return; }
    B.log.push('── ' + B.round + '라운드 ──');
    B.units.forEach(u => {
      u.acted = false;
      u.moved = false;
      u.confusedNow = false;
      if (u.alive && u.confused > 0) {
        u.confusedNow = true;              // 이번 라운드도 혼란 상태 (행동·반격 불가)
        u.confused--;
        u.acted = true;
        B.log.push('💫 ' + u.name + ' 부대는 혼란 상태로 이동·공격·계략을 쓰지 못합니다.');
      }
      // 화상 — 불화살에 맞은 부대는 라운드가 시작될 때마다 병력이 조금씩 준다
      if (u.alive && u.burn > 0) {
        const dmg = Math.max(1, Math.round(u.troops * u.burnRate));
        u.troops = Math.max(0, u.troops - dmg);
        u.morale = cl(u.morale - Math.round(2 * u.burnRate / FIRE_BURN_RATE), 0, 100);
        u.burn--;
        if (!u.burn) u.burnRate = 0;
        B.log.push('🔥 ' + u.name + ' 부대가 화상으로 병력 -' + commas(dmg) +
          (u.burn > 0 ? ' (화상 ' + u.burn + '라운드 남음)' : ' — 화상이 진정되었습니다.'));
        checkAlive(u);
      }
    });
    B.side = 'atk'; B.sel = null; B.mode = 'select';
    arriveReinforcements();
    askAiReinforce();
    consumeRoundSupply();
    renderBlog();
    step();
  }

  function step() {
    if (!B || B.over || B.duelRequest) return;
    if (!alive('atk').length) { end('defender'); return; }
    if (!alive('def').length) { end('attacker'); return; }
    if (checkForts()) return;
    const unacted = s => B.units.filter(u => u.alive && u.side === s && !u.acted && !isConfused(u));
    let guard = 0;
    while (guard++ < 8) {
      if (!unacted(B.side).length) {
        const other = B.side === 'atk' ? 'def' : 'atk';
        if (!unacted(other).length) { B.round++; roundStart(); return; }
        B.side = other;
      }
      if (B.side === B.playerSide && !B.auto) {
        if (B.autoSel) {
          if (!B.sel || !B.sel.alive || B.sel.acted) B.sel = unacted(B.side)[0] || null;
        } else {
          // 전투를 시작한 첫 내 차례에는 아무 부대도 자동 선택하지 않는다
          B.sel = null;
          B.autoSel = true;
        }
        B.mode = 'select';
        renderPanel();
        return;
      }
      const u = unacted(B.side)[0];
      if (!u) { B.side = B.side === 'atk' ? 'def' : 'atk'; continue; }
      if (B.busy) return;
      B.busy = true;
      B.mode = 'select';
      renderPanel();
      setTimeout(() => {
        if (!B || B.over) return;
        B.busy = false;
        aiAct(u);
      }, 430);
      return;
    }
  }

  // ms — 공격 연출이 끝날 무렵 다음 행동으로 넘어간다
  function afterAction(ms) {
    if (!B || B.over) return;
    B.busy = true;
    renderPanel();
    // 전멸한 부대가 있으면 연출이 끝날 때까지 기다린다 (자동 진행 단축 없음)
    const fast = B.auto && !anyDying();
    const wait = Math.max(160, Math.round((ms || 260) * (fast ? 0.62 : 1)));
    setTimeout(() => {
      if (!B || B.over) return;
      B.busy = false;
      B.floats = [];
      resolveDeaths();
      step();
    }, wait);
  }

  /* 이동 연출이 아직 남아 있는 시간(ms) — 연출을 못 쓰는 환경이면 0 */
  function moveAnimLeft(u) {
    const a = u && u.anim;
    if (!a || !fxOn()) return 0;
    return Math.max(0, a.t0 + a.dur - fnow());
  }

  /* 이동 연출이 끝난 뒤에 후속 동작(공격 연출·효과음)을 시작한다 */
  function afterMoveAnim(u, fn) {
    const wait = moveAnimLeft(u);
    if (wait <= 0) { fn(); return; }
    B.busy = true;
    renderPanel();
    setTimeout(() => {
      if (!B || B.over) return;
      B.busy = false;
      fn();
    }, Math.round(wait) + 90);
  }

  /* 부대가 이 연출에 붙어 있는 남은 재생 시간(ms) */
  function fxRemain(u) {
    if (!B || !B.fx || !B.fx.length) return 0;
    const t = fnow();
    let m = 0;
    B.fx.forEach(e => {
      if (e.to !== u && e.from !== u) return;
      const end = e.t0 + e.dur - t;
      if (end > m) m = end;
    });
    return m;
  }
  function anyDying() {
    return !!(B && B.units.some(u => u.alive && u.dying));
  }

  // 병력이 다하거나 사기가 0이 되면 곧바로 지우지 않고,
  // 공격 연출이 재생 중이면 연출이 끝난 뒤에 부대를 없앤다
  function checkAlive(u) {
    if (!u || !u.alive || u.dying) return;
    if (u.troops > 0 && u.morale > 0) return;
    const wait = fxRemain(u);
    if (wait > 60) {
      u.dying = true;
      u.dyingAt = fnow();
      u.dyingDur = wait;
      u.troops = Math.max(0, u.troops);
      return;
    }
    finishUnit(u);
  }

  // 실제 전투 불능 처리 — 연출이 끝난 뒤 호출된다
  function finishUnit(u, preserveRoutTroops = false) {
    if (!u || !u.alive) return;
    u.dying = false;
    if (u.troops <= 0) {
      u.troops = 0;
      u.alive = false;
      bLog('💥 ' + u.name + ' 부대 전멸!');
      sfx('destroy');
      afterKill(u);
      return;
    }
    if (u.morale <= 0) {
      if (!preserveRoutTroops) u.troops = Math.round(u.troops * 0.3);
      u.alive = false;
      bLog('🏳 ' + u.name + ' 부대가 도주했습니다!');
      sfx('destroy');
      afterKill(u);
    }
  }

  /* 연출이 끝난 뒤 죽은 부대를 한꺼번에 정리한다 */
  function resolveDeaths() {
    if (!B) return;
    B.units.forEach(u => { if (u.alive && u.dying) finishUnit(u); });
  }
  function afterKill(u) {
    B.units.filter(x => x.alive && x.side !== u.side).forEach(x => { x.morale = cl(x.morale + 5, 0, 100); });
    B.units.filter(x => x.alive && x.side === u.side).forEach(x => { x.morale = cl(x.morale - 8, 0, 100); });
  }

  /* ── 행동 ──────────────────────────────────────────── */
  function moveRange(u) {
    const movMax = BRANCHES[u.branch].mov + ((FORMS[u.form] || {}).mov || 0);
    const seen = {}; seen[u.y * COLS + u.x] = 0;
    const q = [{ x: u.x, y: u.y, d: 0 }], out = [];
    while (q.length) {
      const cur = q.shift();
      if (cur.d >= movMax) continue;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => {
        const nx = cur.x + d[0], ny = cur.y + d[1];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return;
        const t = B.terrain[ny][nx];
        if (t === WATER) return;                 // 강·바다는 여울로만 건넌다
        const cost = CombatRules.moveCost(u.branch,t);
        const nd = cur.d + cost;
        if (nd > movMax) return;
        const key = ny * COLS + nx;
        if (seen[key] !== undefined && seen[key] <= nd) return;
        const occ = unitAt(nx, ny);
        if (occ && occ.side !== u.side) return;      // 적 부대는 막는다
        seen[key] = nd;
        q.push({ x: nx, y: ny, d: nd });
        if (!occ) out.push({ x: nx, y: ny });        // 아군 위로는 지나갈 수 있지만 멈출 수는 없다
      });
    }
    return out;
  }

  /* ── 기병 돌격 — 적진을 뚫고 지나간다 ───────────────── */
  const CHARGE_MAX = 2;        // 부대당 한 전투의 돌격 사용 횟수
  const CHARGE_PIERCE = 2;      // 한 번에 뚫을 수 있는 적 부대 수
  const CHARGE_RANGE = 3;       // 돌격으로 달릴 수 있는 최대 거리(칸)
  const CHARGE_RATE = 0.35;     // 뚫은 적에게 주는 피해 비율

  function chargeLeft(u) { return u && u.charge > 0 ? u.charge : 0; }

  // 여울 칸 안에서는 접전할 수 있지만, 양안 사이의 물길을 넘어 때릴 수는 없다.
  function meleeReachable(a, d) {
    if (mdist(a,d)!==1) return false;
    const at=B.terrain[a.y][a.x], dt=B.terrain[d.y][d.x];
    if (at===WATER||dt===WATER) return false;
    return at===FORD||dt===FORD||!BattleTerrain.waterBetween(B.geo,a,d);
  }

  // 돌격 착지점 — 직선으로 적을 뚫고 나간 자리
  function chargeOptions(u) {
    if (!u || u.branch !== '기병' || chargeLeft(u) <= 0) return [];
    if(B.terrain[u.y][u.x]!==0) return [];
    const movMax = BRANCHES['기병'].mov + ((FORMS[u.form] || {}).mov || 0);
    const range = Math.min(movMax, CHARGE_RANGE);   // 아무리 빨라도 세 칸까지만
    const out = [];
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(dir => {
      const through = [];
      for (let step = 1; step <= range; step++) {
        const nx = u.x + dir[0] * step, ny = u.y + dir[1] * step;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) break;
        const terrain = B.terrain[ny][nx];
        if (terrain !== 0) break; // 숲·산·성·물·여울에서는 대형을 유지한 돌격 불가
        if (!meleeReachable({x:nx-dir[0],y:ny-dir[1]},{x:nx,y:ny})) break;
        const occ = unitAt(nx, ny);
        if (occ) {
          if (occ.side === u.side) continue;           // 아군 위로는 지나갈 수 있다 (피해 없음)
          if (through.length >= CHARGE_PIERCE) break;  // 너무 두꺼운 진은 못 뚫는다
          through.push({ x: nx, y: ny, unit: occ });
          continue;
        }
        if (through.length) out.push({ x: nx, y: ny, through: through.slice() });
      }
    });
    return out;
  }

  function doCharge(u, dest) {
    if (!B || B.over || !u || !u.alive || u.acted) return;
    const opt = chargeOptions(u).find(o => o.x === dest.x && o.y === dest.y);
    if (!opt) return;
    u.charge = chargeLeft(u) - 1;
    moveUnitTo(u, opt.x, opt.y, true);
    u.moved = true;
    u.acted = true;
    // 돌격 관통 연출은 이동 연출이 끝난 뒤부터 차례로 터진다
    const ride = moveAnimLeft(u);
    bLog('🐎 ' + u.name + ' 부대 돌격! 적 ' + opt.through.length + '부대를 뚫고 돌파합니다. [돌격 ' + chargeLeft(u) + '회 남음]');
    sfx('charge');
    opt.through.forEach((p, i) => {
      const foe = p.unit;
      if (!foe || !foe.alive) return;
      const dmg = Math.max(1, Math.round(calcDamage(u, foe) * CHARGE_RATE * (CombatRules.talent(u).charge || 1)));
      foe.troops = Math.max(0, foe.troops - dmg);
      foe.morale = cl(foe.morale - Math.round(ri(2, 6) * tacticalScale(u)), 0, 100);
      fx('slash', u, foe, { delay: ride + 60 + i * 180 });
      B.floats.push({ x: p.x, y: p.y, text: '돌격 -' + commas(dmg) });
      bLog('💥 돌격 관통 — ' + foe.name + ' 부대 병력 -' + commas(dmg));
      checkAlive(foe);
    });
    if (checkForts()) return;
    afterAction(940 + Math.round(ride));
  }

  /* ── 보병 일제공격 — 보병·기병 2부대 이상이 함께 공격한다 ─ */
  const VOLLEY_MAX = 2;        // 부대당 한 전투의 일제공격 참여 횟수
  const VOLLEY_PARTNERS = 2;    // 함께 공격할 수 있는 동료 부대 수
  const VOLLEY_RATE = 0.6;      // 동료 1부대당 피해 비율

  function volleyLeft(u) { return u && u.volley > 0 ? u.volley : 0; }

  function volleyPartners(u, target) {
    if (!u || u.branch !== '보병' || volleyLeft(u) <= 0 || !target || !target.alive) return [];
    if (!meleeReachable(u, target)) return [];
    return B.units.filter(x => x !== u && x.alive && x.side === u.side &&
      (x.branch === '보병' || x.branch === '기병') && volleyLeft(x) > 0 && !x.acted && !isConfused(x) && meleeReachable(x, target))
      .slice(0, VOLLEY_PARTNERS);
  }
  function volleyTargets(u) {
    if (!u || u.branch !== '보병') return [];
    return B.units.filter(t => t.alive && t.side !== u.side && mdist(u, t) === 1 &&
      volleyPartners(u, t).length > 0);
  }
  function doVolley(u, target) {
    if (!B || B.over || !u || !u.alive || u.branch !== '보병' || u.acted || isConfused(u) || !target || !target.alive) return;
    const mates = volleyPartners(u, target);
    if (!mates.length) return;
    const group = [u].concat(mates);
    let total = 0;
    group.forEach((x, i) => {
      total += Math.round(calcDamage(x, target) * (i === 0 ? 1 : VOLLEY_RATE));
      x.volley = volleyLeft(x) - 1;
      x.acted = true;
      fx('slash', x, target, { delay: i * 170 });
    });
    target.troops = Math.max(0, target.troops - total);
    const impact = Math.min(1, group.reduce((sum, x) => sum + x.troops, 0) / 1000);
    target.morale = cl(target.morale - Math.round(ri(5, 12) * impact), 0, 100);
    B.floats.push({ x: target.x, y: target.y, text: '-' + commas(total) });
    bLog('⚔ 일제공격! ' + group.map(x => x.name).join('·') + ' → ' + target.name +
      ' : 병력 -' + commas(total) + ' (반격 없음)');
    sfx('volley', { count: group.length });
    checkAlive(target);
    afterAction(940);
  }


  /* ── 궁병 불화살 — 적을 불태우고 화상을 남긴다 ─────────
     직접 피해는 일반 사격보다 조금 적지만 사기를 크게 떨어뜨리고,
     라운드가 시작될 때마다 화상 피해를 준다. 숲에서는 불길이 번진다. */
  const FIRE_ARROWS_MAX = 2;     // 부대당 불화살 사용 횟수
  const FIRE_ARROW_RATE = 0.85;  // 일반 사격 대비 직접 피해 비율
  const FIRE_BURN_TURNS = 2;     // 화상 지속 라운드
  const FIRE_BURN_RATE = 0.05;   // 라운드 시작마다 화상 피해 비율

  function fireLeft(u) { return u && u.fire > 0 ? u.fire : 0; }

  function fireTargets(u) {
    if (!u || u.branch !== '궁병' || fireLeft(u) <= 0) return [];
    return attackTargets(u);
  }

  function doFireArrow(u, d) {
    if (!B || B.over || !u || !u.alive || !d || !d.alive || u.acted) return;
    if (fireLeft(u) <= 0) return;
    if (fireTargets(u).indexOf(d) < 0) return;
    u.fire = fireLeft(u) - 1;
    u.acted = true;
    // 숲(지형 1)에서는 불길이 크게 번진다
    const wood = B.terrain[d.y][d.x] === 1;
    const dmg = Math.round(calcDamage(u, d) * FIRE_ARROW_RATE * (wood ? 1.5 : 1));
    const drop = Math.round(ri(6, 14) * tacticalScale(u));
    d.troops = Math.max(0, d.troops - dmg);
    d.morale = cl(d.morale - drop, 0, 100);
    const burnRate = FIRE_BURN_RATE * tacticalScale(u) * (B.terrain[d.y][d.x]===3?.5:1);
    if (!d.burn || burnRate >= d.burnRate) {
      d.burn = FIRE_BURN_TURNS;
      d.burnRate = burnRate;
    }
    fx('fireArrow', u, d);
    fx('fire', u, d, { delay: 460 });          // 착탄 뒤 번지는 불길
    sfx('arrow');
    sfx('fire');
    B.floats.push({ x: d.x, y: d.y, text: '불화살 -' + commas(dmg) });
    bLog('🔥 ' + u.name + ' 부대의 불화살! ' + d.name + ' 부대 병력 -' + commas(dmg) +
      ', 사기 -' + drop + ' — 화상 ' + d.burn + '라운드 (매 라운드 ' + Math.round(d.burnRate * 1000) / 10 + '%)' +
      (wood ? ' (숲이라 불길이 번졌습니다!)' : '') +
      ' [불화살 ' + fireLeft(u) + '발 남음]');
    checkAlive(d);
    afterAction(1060);
  }
  function attackTargets(u) {
    return B.units.filter(t => t.alive && t.side !== u.side && mdist(t, u) <= BRANCHES[u.branch].range &&
      (u.branch==='궁병'||meleeReachable(u,t)));
  }
  // 인접(상하좌우 1칸)한 적 부대 — 일기토 판정과 안내 문구가 같은 기준을 쓴다
  function adjacentFoes(u) {
    if (!u) return [];
    return B.units.filter(t => t.alive && t.side !== u.side && meleeReachable(u,t));
  }
  function duelTargets(u) {
    if (!u || u.dueled || u.noOfficer) return [];
    return adjacentFoes(u).filter(t => !t.noOfficer);
  }
  // 일기토를 걸 수 없을 때 이유를 정확히 알려준다 — "인접하지 않음"으로 뭉뚱그리지 않는다
  function duelBlockedReason(u) {
    if (!u) return '일기토를 걸 부대를 먼저 선택하세요.';
    if (u.noOfficer) return u.name + ' 부대는 무장이 없어 일기토를 걸 수 없습니다.';
    if (u.dueled) return u.name + ' 부대는 이미 일기토를 신청했습니다 (부대당 전투 중 1회).';
    const adj = adjacentFoes(u);
    if (!adj.length) return '일기토를 걸 상대가 인접(상하좌우 1칸)해 있지 않거나 사이에 강이 있습니다.';
    return '인접한 ' + adj.map(t => t.name).join('·') + ' 부대는 무장이 없어 일기토를 걸 수 없습니다.';
  }
  function stratRange(u, t) { return mdist(u, t) <= 3; }
  function stratTargets(u, type) {
    if (!type) return [];
    if (type === '고무') return B.units.filter(t => t.alive && t.side === u.side && stratRange(u, t) && t.morale < 100);
    return B.units.filter(t => t.alive && t.side !== u.side && stratRange(u, t));
  }

  function calcDamage(a, d) {
    const alliesA=alive(a.side),alliesD=alive(d.side);
    return CombatRules.damage(a,d,{terrain:B.terrain[d.y][d.x],cityDef:d.side==='def'?B.cityDef:0,
      random:rnd(.8,1.2),ranged:mdist(a,d)>1,alliesA,alliesD,
      nearbyA:alliesA.filter(u=>mdist(u,a)<=2),nearbyD:alliesD.filter(u=>mdist(u,d)<=2)});
  }

  // 궁병이 아닌 부대가 근접 공격하면 상대의 반격을 받는다
  const COUNTER_RATE = 0.45;
  const FORT_COUNTER_TAKEN = 0.75; // 성에서 공격한 부대는 지형 방어에 더해 받는 반격 피해 25% 경감

  function attackAct(a, d) {
    if (!B || B.over || !a.alive || !d.alive || !attackTargets(a).includes(d)) return;
    const dmg = calcDamage(a, d);
    // 원거리(궁병·사거리 밖)는 화살 세례, 근접은 칼자국 연출
    const ranged = a.branch === '궁병' || mdist(a, d) > 1;
    // 반격 피해 — 상대가 이 공격으로 전멸·도주해도 적용되도록
    // 공격 전 전력으로 미리 계산해 둔다
    // 혼란 상태의 부대는 반격할 수 없다
    const counterOk = a.branch !== '궁병' && meleeReachable(d, a);
    const noCounter = counterOk && (d.confused > 0 || d.confusedNow);
    const fortCover = B.terrain[a.y][a.x] === 3;
    const back = (counterOk && !noCounter)
      ? Math.max(1, Math.round(calcDamage(d, a) * COUNTER_RATE * (fortCover ? FORT_COUNTER_TAKEN : 1))) : 0;
    const counterImpact = tacticalScale(d);
    d.troops = Math.max(0, d.troops - dmg);
    d.morale = cl(d.morale - Math.round(ri(3, 8) * tacticalScale(a)), 0, 100);
    const fear=Math.round((CombatRules.talent(a).fear||0)*tacticalScale(a));
    if(!ranged&&fear) {d.morale=cl(d.morale-fear,0,100);bLog('장판의 포효 — '+d.name+' 사기 -'+fear);}
    a.acted = true;
    fx(ranged ? 'arrow' : 'slash', a, d);
    sfx(ranged ? 'arrow' : 'slash');
    B.floats.push({ x: d.x, y: d.y, text: '-' + commas(dmg) });
    bLog('🗡 ' + a.name + ' → ' + d.name + ' : 병력 -' + commas(dmg));
    checkAlive(d);
    if (noCounter) bLog('💫 ' + d.name + ' 부대는 혼란 상태라 반격하지 못했습니다.');
    // 반격 — 상대가 전멸(도주)한 뒤에도 공격측은 피해를 입는다
    let countered = false;
    if (back > 0 && a.alive) {
      a.troops = Math.max(0, a.troops - back);
      a.morale = cl(a.morale - Math.round(ri(1, 4) * counterImpact), 0, 100);
      B.floats.push({ x: a.x, y: a.y, text: '반격 -' + commas(back) });
      bLog('↩ ' + d.name + '의 반격! ' + a.name + ' 병력 -' + commas(back) +
        (fortCover ? ' (성 방호 · 반격 피해 -25%)' : '') +
        (d.alive && !d.dying ? '' : ' (최후의 반격)'));
      fx(d.branch === '궁병' ? 'arrow' : 'slash', d, a, { delay: 330 });
      countered = true;
      checkAlive(a);
    }
    afterAction(countered ? 940 : (ranged ? 700 : 620));
  }

  function duelWinChance(a, d) {
    const sa = SKILLS[a.officer.skill] || {}, sd = SKILLS[d.officer.skill] || {};
    return cl(0.5 + (a.officer.wu - d.officer.wu) * 0.012 + (sa.duel || 0) - (sd.duel || 0) + (CombatRules.talent(a).duel || 0) - (CombatRules.talent(d).duel || 0), 0.08, 0.92);
  }
  function duelMoraleLoss(winner) { return Math.round(25 * tacticalScale(winner)); }
  function doDuel(a, d) {
    if (!B || B.over || B.duelRequest || !a.alive || !d.alive || a.acted || !duelTargets(a).includes(d)) return;
    a.dueled = true;
    a.acted = true;
    bLog('⚔ ' + a.name + ' → ' + d.name + ' : 일기토 신청!');
    if (d.side === B.playerSide && !B.auto) {
      B.duelRequest = { attacker: a, defender: d };
      B.busy = true;
      renderPanel();
      return;
    }
    // 승산이 매우 낮고 거부해도 도주하지 않는 경우에는 병력을 보존한다.
    const accept = duelWinChance(d, a) >= 0.25 || d.morale <= duelMoraleLoss(a) * 2;
    resolveDuel(a, d, accept);
  }
  function resolveDuel(a, d, accept) {
    if (!accept) {
      const moraleLoss = duelMoraleLoss(a) * 2;
      d.morale = cl(d.morale - moraleLoss, 0, 100);
      B.floats.push({ x: d.x, y: d.y, text: '일기토 거부 · 사기 -' + moraleLoss });
      bLog('🏳 ' + d.name + ' 부대가 ' + a.name + '의 일기토를 거부했습니다. 병력 손실 없음, 사기 -' + moraleLoss + ' (패배 시의 2배)');
      sfx('fail');
      // 거부로 사기가 0이 되어 도주하더라도 병력은 잃지 않는다.
      if (d.morale <= 0) finishUnit(d, true);
      afterAction(820);
      return;
    }
    const win = Math.random() < duelWinChance(a, d);
    const w = win ? a : d, l = win ? d : a;
    const impact = tacticalScale(w);
    const loss = Math.round(l.troops * 0.10 * impact);
    l.troops = Math.max(0, l.troops - loss);
    const moraleLoss = duelMoraleLoss(w);
    l.morale = cl(l.morale - moraleLoss, 0, 100);
    w.morale = cl(w.morale + 10, 0, 100);
    const rally=CombatRules.talent(w).rally||0;
    if(rally) {alive(w.side).filter(x=>x!==w&&mdist(x,w)<=2).forEach(x=>{x.morale=cl(x.morale+Math.round(rally*impact),0,100);});bLog('관우의 무신의 위엄 — 인접 아군 사기 상승');}
    a.acted = true;
    fx('duel', a, d);
    B.floats.push({ x: l.x, y: l.y, text: '일기토 패!' });
    bLog('⚔ 일기토! ' + a.name + '(' + a.officer.wu + ') vs ' + d.name + '(' + d.officer.wu + ') → ' + w.name + ' 승리! ' +
      l.name + ' 병력 -' + commas(loss) + ', 사기 -' + moraleLoss);
    sfx('duel');
    checkAlive(l);
    afterAction(820);
  }

  function doStratAct(u, d, type) {
    if (!B || B.over || !u.alive || !d.alive || u.acted || !stratTargets(u, type).includes(d)) return;
    u.acted = true;
    const sa = SKILLS[u.officer.skill] || {}, sd = SKILLS[d.officer.skill] || {};
    let p = 0.42 + (u.officer.zhi - d.officer.zhi) * 0.010 + (sa.strat || 0) - (sd.resist || 0);
    if (type === '화계') p -= 0.05;
    if(type==='혼란') p+=CombatRules.talent(u).confuse||0;
    p-=CombatRules.bonuses(d,alive(d.side)).resist;
    if(type!=='고무'&&B.terrain[d.y][d.x]===3)p-=.10;
    p = type === '고무' ? 1 : cl(p, 0.08, 0.93) * tacticalScale(u);
    if (Math.random() > p) {
      bLog('✖ ' + u.name + '의 ' + type + ' 실패! (성공률 ' + Math.round(p * 100) + '%)');
      sfx('fail');
      afterAction();
      return;
    }
    if (type === '화계') {
      const t = B.terrain[d.y][d.x];
      let dmg = Math.round((u.officer.zhi * 18 + ri(100, 400)) * (t === 1 ? 1.5 : 1) * Math.min(1, troopStrength(u)));
      const water=[[0,0],[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>[4,5].includes(B.terrain[u.y+dy]?.[u.x+dx]));
      dmg=Math.round(dmg*(CombatRules.talent(u).fire||1)*(CombatRules.talent(u).fire&&water?1.1:1));
      if(B.terrain[d.y][d.x]===3) dmg=Math.round(dmg*.65);
      dmg = Math.min(dmg, Math.round(d.troops * 0.85));
      d.troops = Math.max(0, d.troops - dmg);
      d.morale = cl(d.morale - Math.round(ri(5, 12) * tacticalScale(u)), 0, 100);
      fx('fire', u, d);
      sfx('fire');
      B.floats.push({ x: d.x, y: d.y, text: '화계 -' + commas(dmg) });
      bLog('🔥 ' + u.name + '의 화계! ' + d.name + ' 부대 병력 -' + commas(dmg) + (t === 1 ? ' (숲이라 화세 확대!)' : ''));
      checkAlive(d);
    } else if (type === '혼란') {
      // 지력이 높은 무장은 혼란을 1턴 만에 벗어날 수 있다 (계략저항 특기 보정)
      const zhi = (d.officer && d.officer.zhi) || 50;
      const escape = cl(0.08 + (zhi - 45) * 0.011 + (sd.resist || 0), 0.05, 0.75);
      const shortConfuse = Math.random() < escape;
      const turns = shortConfuse ? 1 : 2;
      d.confused = Math.max(d.confused || 0, turns);
      d.acted = true;                        // 혼란에 빠진 즉시 이번 라운드 행동을 잃는다
      fx('confuse', u, d);
      sfx('confuse');
      B.floats.push({ x: d.x, y: d.y, text: shortConfuse ? '혼란! (1턴)' : '혼란!' });
      bLog('💫 ' + u.name + '의 혼란! ' + d.name + ' 부대(지력 ' + zhi + ') — ' +
        (shortConfuse
          ? '1턴 만에 회복합니다 (지력 회복 판정 성공 · 확률 ' + Math.round(escape * 100) + '%)'
          : '2턴간 이동·공격·계략 불가 (반격도 불가 · 회복 확률 ' + Math.round(escape * 100) + '%)'));
    } else {
      const gain = Math.min(100 - d.morale, Math.round(18 * tacticalScale(u)));
      d.morale = cl(d.morale + gain, 0, 100);
      fx('boost', u, d);
      sfx('taiko');
      B.floats.push({ x: d.x, y: d.y, text: '사기+' });
      bLog('🥁 ' + u.name + '의 고무! ' + d.name + ' 부대 사기 +' + gain + ' (→ ' + d.morale + ')');
    }
    afterAction(type === '화계' ? 1000 : (type === '혼란' ? 1020 : 960));
  }

  /* ── 사운드 토글 — 전투 화면에서도 바로 켜고 끌 수 있게 ── */
  function syncSound() {
    if (typeof Sound !== 'undefined' && Sound && Sound.syncButtons) Sound.syncButtons();
  }
  function toggleBgm() {
    if (typeof Sound === 'undefined' || !Sound) return;
    Sound.toggleBgm();
    syncSound();
    if (typeof toast === 'function') toast('배경음악 ' + (Sound.bgmOn ? '켜짐' : '꺼짐'));
  }
  function toggleSfx() {
    if (typeof Sound === 'undefined' || !Sound) return;
    Sound.toggleSfx();
    syncSound();
    if (typeof toast === 'function') toast('효과음 ' + (Sound.sfxOn ? '켜짐' : '꺼짐'));
  }

  /* ── 후퇴 ─────────────────────────────────────────────
     공격측은 철수하고, 수비측은 성을 내주는 대신 잔존 병력을
     인접한 아군 도시로 이끌고 빠져나간다. 후퇴할 도시가 없으면 불가. */
  function retreatCities() {
    const list = (B && B.opts && B.opts.retreatCities) || [];
    return list.filter(c => c && c.name);
  }
  function retreat() {
    if (!B || B.over) return;
    if (B.playerSide === 'def') {
      if(!B.opts.siege) {bLog('수비군이 성 안으로 물러나 농성합니다.');end('attacker',{fieldRetreat:true});return;}
      const cands = retreatCities();
      if (!cands.length) { bLog('🏳 후퇴할 다른 도시가 없습니다.'); return; }
      if (cands.length === 1) { retreatTo(cands[0].name); return; }
      B.mode = 'retreat'; B.strat = null;
      bLog('🏳 후퇴할 도시를 고르세요 — ' + cands.map(c => c.name).join(' · '));
      renderPanel();
      return;
    }
    bLog('🏳 ' + B.opts.atk.name + '군이 후퇴합니다…');
    sfx('fail');
    end('defender');
  }
  // 수비측 후퇴 — 성을 내주고 잔존 병력을 지정 도시로 옮긴다
  function retreatTo(cityName) {
    if (!B || B.over || B.duelRequest || B.playerSide !== 'def') return;
    const dest = retreatCities().find(c => c.name === cityName);
    if (!dest) { bLog('후퇴할 수 없는 도시입니다.'); return; }
    B.mode = 'select'; B.sel = null; B.strat = null;
    bLog('🏳 ' + B.opts.def.name + '군이 ' + dest.name + '으로 후퇴합니다 — ' + B.opts.city.name + '은(는) 내줍니다.');
    sfx('fail');
    end('attacker', { retreatTo: dest.name });
  }

  /* 내 턴을 마치고 다음 턴으로 넘긴다 — 남은 아군 부대는 대기 처리 */
  function passTurn() {
    if (!B || B.over) return;
    if (B.auto) { bLog('자동 진행 중에는 넘길 수 없습니다.'); return; }
    if (B.busy) return;
    if (B.side !== B.playerSide) { bLog('상대 군이 행동 중입니다.'); return; }
    const left = B.units.filter(u => u.alive && u.side === B.playerSide && !u.acted);
    if (!left.length) { bLog('모든 부대가 이미 행동했습니다.'); return; }
    left.forEach(u => { u.acted = true; });
    bLog('⏭ 다음 턴으로 — ' + left.map(u => u.name).join('·') + ' 부대 대기');
    B.sel = null; B.mode = 'select'; B.strat = null;
    afterAction();
  }

  /* ── AI 행동 ───────────────────────────────────────── */
  /* 상황별 진형 — 성을 지키면 방원, 궁병은 학익, 기병은 봉시, 보병은 거리에 맞춘다 */
  function aiFormFor(u) {
    if (!u || u.noOfficer) return null;
    const foeAt = r => B.units.some(x => x.alive && x.side !== u.side && mdist(u, x) <= r);
    const adjacent = foeAt(1);
    const onFort = u.side === 'def' && !!fortAt(u.x, u.y);   // 수비측이 성을 지키는 중
    if (u.branch === '궁병') return adjacent ? '방원' : '학익';   // 근접당하면 버티고, 아니면 사격
    if (onFort) return '방원';                                   // 성을 내주지 않는 방패진
    if (u.branch === '기병') return '봉시';                       // 돌격·기동
    if (adjacent) return '방원';                                 // 보병 접근전
    const far = B.units.filter(x => x.alive && x.side !== u.side)
      .reduce((m, x) => Math.min(m, mdist(u, x)), 99);
    return far > BRANCHES['보병'].mov + 1 ? '안행' : '어린';      // 멀면 행군형, 사거리 안이면 쐐기
  }
  /* 진형 전환 — 라운드당 1회. 부대마다 첫 전환은 무료, 이후에는 행동을 쓴다 (플레이어와 같은 규칙) */
  function aiSwitchForm(u) {
    if (!u || u.noOfficer || isConfused(u) || u.formRound === B.round) return false;
    const want = aiFormFor(u);
    if (!want || u.form === want || !FORMS[want]) return false;
    u.formRound = B.round;
    if (!u.formFreeUsed) {                    // 부대마다 첫 전환은 행동을 소모하지 않는다
      u.form = want; u.formFreeUsed = true;
      bLog('🎌 ' + u.name + ' 부대가 상황에 맞춰 ' + want + ' 진형으로 전환 (' + FORMS[want].desc + ')');
      return false;
    }
    // 두 번째부터는 행동을 쓴다 — 버티는 것이 급할 때(방원)만 전환하고 이번 턴을 마친다
    if (want !== '방원') return false;
    u.form = want; u.acted = true;
    bLog('🎌 ' + u.name + ' 부대가 ' + want + ' 진형으로 전환하며 이번 턴을 마칩니다 (' + FORMS[want].desc + ')');
    return true;
  }
  function aiAct(u) {
    if (!B || B.over || !u || !u.alive || u.acted) { if (B && !B.over) afterAction(); return; }
    if (isConfused(u)) {                  // 혼란 — 이동·공격·계략 모두 불가
      u.acted = true;
      bLog('💫 ' + u.name + ' 부대는 혼란 상태로 아무것도 하지 못합니다.');
      afterAction();
      return;
    }
    if (aiSwitchForm(u)) { afterAction(); return; }   // 행동을 써서 진형을 바꾼 경우 이번 턴 종료
    // 성 임무 — 수비대는 성을 비우지 않고, 그 자리에서 응전한다
    const duty = fortDuty(u);
    if (duty && duty.hold) {
      if (tryAct(u)) return;                // 성 위에서 응전
      u.acted = true;
      if (!u.holdLogged) {
        u.holdLogged = true;
        bLog('🏯 ' + u.name + ' 부대가 성을 지킵니다.');
      }
      afterAction();
      return;
    }
    if (tryAct(u)) return;                // 사거리 내 적 → 계략/일기토/공격
    if (!u.moved) moveToward(u);          // 적에게 접근
    if (!u.moved && u.branch === '기병') {
      // 길이 막혔으면 적진을 뚫고 돌격한다
      const opts = chargeOptions(u);
      if (opts.length) {
        const foes = B.units.filter(x => x.alive && x.side !== u.side);
        const near = foes.slice().sort((a, b) => mdist(u, a) - mdist(u, b))[0];
        let best = opts[0], bd = 1e9;
        opts.forEach(o => {
          const d = near ? Math.abs(o.x - near.x) + Math.abs(o.y - near.y) : 0;
          if (d < bd) { bd = d; best = o; }
        });
        doCharge(u, best);
        return;
      }
    }
    // 이동 후 같은 턴 공격 — 이동 연출이 끝난 뒤에 공격 연출·효과음이 시작된다
    if (u.moved) {
      afterMoveAnim(u, () => {
        if (!B || B.over) return;
        if (tryAct(u)) return;              // 이동 후 같은 턴에 공격
        u.acted = true;
        bLog('⏭ ' + u.name + ' 부대 대기');
        afterAction();
      });
      return;
    }
    if (!u.acted) {
      u.acted = true;
      bLog('⏭ ' + u.name + ' 부대 대기');
    }
    afterAction();
  }

  // 공격 가능한 적이 있으면 행동을 수행하고 true 반환
  function tryAct(u) {
    const sa = SKILLS[u.officer.skill] || {};
    // 아군 사기가 낮으면 고무로 지원
    const lowAlly = stratTargets(u, '고무').filter(x => x.morale < 45);
    if (!u.noOfficer && lowAlly.length && u.officer.zhi >= 70 && Math.random() < 0.35) {
      doStratAct(u, lowAlly[0], '고무');
      return true;
    }
    const stratFoes = stratTargets(u, '혼란').sort((a, b) => a.troops - b.troops);
    const stratFoe = stratFoes.find(x => !isConfused(x)) || stratFoes[0];
    if (!u.noOfficer && stratFoe && u.officer.zhi >= stratFoe.officer.zhi - 8 && Math.random() < 0.22 + (sa.strat || 0)) {
      doStratAct(u, stratFoe, isConfused(stratFoe) || Math.random() < 0.6 ? '화계' : '혼란');
      return true;
    }
    const foes = attackTargets(u);
    if (!foes.length) return false;
    const weak = foes.slice().sort((a, b) => a.troops - b.troops)[0];
    const adj = duelTargets(u);
    if (adj.length && !u.dueled && !u.noOfficer && Math.random() < 0.35 && u.officer.wu > adj[0].officer.wu + 5) {
      doDuel(u, adj[0]);
      return true;
    }
    // 궁병은 불화살로 적을 불태운다 (숲에 있는 적을 우선 노린다)
    if (u.branch === '궁병' && fireLeft(u) > 0 && Math.random() < 0.5) {
      const ft = fireTargets(u);
      if (ft.length) {
        const woodScore = t => (B.terrain[t.y][t.x] === 1 ? 0 : 1);
        doFireArrow(u, ft.slice().sort((a, b) => woodScore(a) - woodScore(b) || a.troops - b.troops)[0]);
        return true;
      }
    }
    // 보병은 인접한 보병·기병 동료와 함께 일제공격할 수 있다
    const vol = volleyTargets(u);
    if (vol.length && Math.random() < 0.45) {
      doVolley(u, vol.slice().sort((a, b) => a.troops - b.troops)[0]);
      return true;
    }
    attackAct(u, weak);
    return true;
  }

  // 성 임무 — 수비측은 성을 비우지 않고, 공격측은 점령한 성에 머물지 않고 남은 성을 계속 노린다
  function fortDuty(u) {
    const forts = fortTiles();
    if (!forts.length) return null;
    const foe = u.side === 'atk' ? 'def' : 'atk';
    const here = fortAt(u.x, u.y);
    if (here && here.owner === u.side) {
      // 공격측 — 성 하나를 먹고 그 자리에 멈추면 남은 성을 두고 서로 마주 보기만 한다
      if (u.side === 'atk') {
        const rest = forts.filter(f => f.owner !== u.side)
          .sort((a, b) => mdist(u, a) - mdist(u, b));
        return rest[0] ? { hold: false, fort: rest[0] } : null;
      }
      // 수비 중이어도 적이 비워둔 빼앗긴 성이 가까우면 되찾으러 간다 (성은 비어도 깃발이 유지된다)
      const stray = forts.filter(f => f.owner === foe && !unitAt(f.x, f.y))
        .sort((a, b) => mdist(u, a) - mdist(u, b))[0];
      if (stray && mdist(u, stray) <= 2 && !B.units.some(e=>e.alive&&e.side!==u.side&&mdist(e,here)<=3)) return { hold: false, fort: stray };
      return { hold: true, fort: here };                                    // 수비 중
    }
    const lost = forts.filter(f => f.owner === foe);                       // 빼앗긴 성
    const empty = u.side === 'def'
      ? forts.filter(f => f.owner === u.side && !unitAt(f.x, f.y))         // 주인 없는 아군 성
      : [];
    const opts = empty.concat(lost)
      .filter(f => !(f.x === u.x && f.y === u.y))                          // 이미 선 칸은 목적지가 아니다
      .sort((a, b) => mdist(u, a) - mdist(u, b));
    return opts[0] ? { hold: false, fort: opts[0] } : null;
  }

  // 목표 칸까지의 이동 비용 지도 — 강·호수는 여울로만 건너고, 부대는 장애물로 보지 않는다
  function costField(u, tx, ty) {
    const N = COLS * ROWS, cost = new Array(N).fill(Infinity);
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return cost;
    cost[ty * COLS + tx] = 0;
    const done = new Array(N).fill(false);
    for (let it = 0; it < N; it++) {
      let cur = -1;
      for (let i = 0; i < N; i++)
        if (!done[i] && Number.isFinite(cost[i]) && (cur < 0 || cost[i] < cost[cur])) cur = i;
      if (cur < 0) break;
      done[cur] = true;
      const cx = cur % COLS, cy = (cur - cx) / COLS;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => {
        const nx = cx + d[0], ny = cy + d[1];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || done[ny * COLS + nx]) return;
        const t = B.terrain[ny][nx];
        if (t === WATER) return;                     // 여울이 아니면 강을 건널 수 없다
        // 역방향 탐색이므로 현재 칸에 진입하는 비용을 더한다.
        const nd = cost[cur] + CombatRules.moveCost(u.branch,B.terrain[cy][cx]);
        if (nd < cost[ny * COLS + nx]) cost[ny * COLS + nx] = nd;
      });
    }
    return cost;
  }

  // 지정한 칸을 향해 최단 경로를 따라 한 번 이동한다 (행동을 소모하지 않음)
  function moveStepToward(u, tx, ty, msg) {
    const rng = moveRange(u);
    if (!rng.length) return false;
    // 맨해튼 거리만 줄이면 여울 쪽으로 돌아가야 할 때 제자리에 멈춘다 — 경로 거리로 한 칸씩 나아간다
    const field = costField(u, tx, ty), dist = p => field[p.y * COLS + p.x];
    const self = field[u.y * COLS + u.x];
    let best = null, bd = Infinity;
    rng.forEach(p => { const d = dist(p); if (d < bd) { bd = d; best = p; } });
    if (best && !(bd < self)) best = null;           // 더 가까워지는 칸이 없으면 제자리
    if (!best) {
      // 경로가 막혔으면(강 건너 고립 등) 눈앞의 거리라도 줄인다
      bd = Infinity;
      rng.forEach(p => {
        const d = Math.abs(p.x - tx) + Math.abs(p.y - ty);
        if (d < bd) { bd = d; best = p; }
      });
      if (!best || bd >= Math.abs(u.x - tx) + Math.abs(u.y - ty)) return false;
    }
    moveUnitTo(u, best.x, best.y);
    u.moved = true;
    syncForts(true);              // 성에 올라서면 깃발이 그 편으로 바뀐다
    bLog('🚩 ' + (msg || (u.name + ' 부대 이동')));
    return true;
  }

  // 성 임무가 있으면 그 성으로, 없으면 가장 가까운 적에게 한 번 이동한다
  function moveToward(u) {
    const duty = fortDuty(u);
    if (duty && duty.hold) return false;                  // 수비대는 성을 비우지 않는다
    if (duty) {
      const f = duty.fort;
      return moveStepToward(u, f.x, f.y,
        u.name + ' 부대가 ' + (f.owner === u.side ? '성을 지키러' : '성을 빼앗으러') + ' 이동');
    }
    const foes = B.units.filter(x => x.alive && x.side !== u.side);
    if (!foes.length) return false;
    const target = foes.slice().sort((a, b) => mdist(u, a) - mdist(u, b))[0];
    return moveStepToward(u, target.x, target.y);
  }

  /* 성곽(성) 타일 — 점령한 편의 깃발이 꽂히고, 전부 넘어가면 방어측 패배 */
  function fortTiles() {
    if (!B || !B.opts.siege) return [];
    if (!B.forts) {
      B.forts = [];
      for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++) if (B.terrain[y][x] === 3) B.forts.push({ x, y, owner: 'def' });
    }
    return B.forts;
  }
  function fortAt(x, y) {
    return fortTiles().find(f => f.x === x && f.y === y) || null;
  }
  function fortOwner(x, y) {
    const f = fortAt(x, y);
    return f ? f.owner : 'def';
  }
  function fortTaken() {
    return fortTiles().filter(f => f.owner === 'atk').length;
  }
  // 부대 이름은 이미 '조조군'처럼 군호를 포함하므로 그대로 쓴다
  function fortSideName(side) {
    return side === 'atk' ? B.opts.atk.name : B.opts.def.name;
  }
  // 성 위에 올라선 부대의 편으로 깃발이 바뀐다.
  // 한 번 점령하면 부대가 떠나도 유지되고, 상대가 다시 올라서면 되돌아간다.
  function syncForts(log) {
    if (!B) return false;
    let changed = false;
    fortTiles().forEach(f => {
      const o = unitAt(f.x, f.y);
      if (!o || !o.alive || o.dying || f.owner === o.side) return;
      f.owner = o.side;
      changed = true;
      if (log) {
        bLog((o.side === 'atk' ? '🏯 ' : '⚑ ') + o.name + ' 부대가 성 점령 — ' +
          fortSideName(o.side) + ' 깃발 (' + fortTaken() + '/' + fortTiles().length + ')');
        sfx('capture');
      }
    });
    return changed;
  }
  // 성이 하나라도 남아 있으면 계속, 모두 공격측 깃발이 되면 공격측 승리
  function checkForts() {
    if (!B || B.over) return false;
    const forts = fortTiles();
    if (!forts.length) return false;
    syncForts(true);
    if (!forts.every(f => f.owner === 'atk')) return false;
    bLog('🏯 세 성의 깃발이 모두 공격군으로 바뀌었습니다 — ' + B.opts.def.name + ' 패배!');
    end('attacker');
    return true;
  }

  /* ── 종료 ──────────────────────────────────────────── */
  function timeUp() {
    bLog('⏳ 최대 ' + B.maxRound + '라운드 경과 — ' + B.opts.atk.name + '군이 자동으로 후퇴합니다. 방어에 성공했습니다.');
    end('defender');
  }
  function end(winner, extra) {
    if (!B || B.over) return;
    B.over = true;
    B.winner = winner;
    B.retreatTo = (extra && extra.retreatTo) || '';
    // 도착하지 못한 원군 — 전투 종료 시 출발 도시로 복귀시킨다
    const pending = (B.pending || []).map(p => ({
      from: p.from, side: p.side,
      units: (p.units || []).map(u => ({ name: u.officer ? u.officer.name : '', troops: u.troops }))
    }));
    const res = {
      winner, fieldRetreat: !!(extra && extra.fieldRetreat),
      // 전멸 무장도 0명으로 보고해야 전략 지도의 포로·귀환 처리가 누락되지 않는다.
      atk: B.units.filter(u => u.side === 'atk').map(u => ({ name: u.name, troops: u.troops, morale:u.morale, training:u.training, branch:u.branch, form:u.form })),
      def: B.units.filter(u => u.side === 'def').map(u => ({ name: u.name, troops: u.troops, morale:u.morale, training:u.training, branch:u.branch, form:u.form })),
      captured: [], pending, rounds: Math.min(B.round,B.maxRound), supply: B.supply
    };
    if (B.retreatTo) res.retreatTo = B.retreatTo;
    bLog('=== ' + (winner === 'attacker' ? B.opts.atk.name : B.opts.def.name) + '군 승리! 전투 종료 ===');
    bLog('📊 잔존 병력 — ' + B.opts.atk.name + ' ' + commas(troopsOf('atk')) + ' / ' + B.opts.def.name + ' ' + commas(troopsOf('def')));
    // 승패 효과음 + 지도 배경음악으로 복귀
    sfx(((winner === 'attacker') === (B.playerSide === 'atk')) ? 'win' : 'lose');
    bgm('map');
    renderPanel();
    const cb = B.opts.onEnd;
    setTimeout(() => {
      destroyUI();
      B = null;
      if (cb) cb(res);
    }, 1400);
  }

  /* ── 입력 ──────────────────────────────────────────── */
  function act(cmd) {
    if (!B || B.over) return;
    if (B.duelRequest) {
      if (cmd === 'duelAccept' || cmd === 'duelRefuse') {
        const { attacker, defender } = B.duelRequest;
        B.duelRequest = null;
        B.busy = false;
        B.mode = 'select';
        resolveDuel(attacker, defender, cmd === 'duelAccept');
      }
      return;
    }
    if (cmd === 'auto') {
      B.auto = !B.auto;
      bLog(B.auto ? '⏩ 자동 진행을 시작합니다.' : '⏸ 자동 진행을 멈춥니다.');
      if (B.auto) step();
      renderPanel();
      return;
    }
    if (B.busy) return;
    if (cmd === 'reinforce') {
      if (B.opts.onReinforce) B.opts.onReinforce();
      else bLog('원군을 보낼 수 있는 연결이 없습니다.');
      return;
    }
    if (cmd === 'retreat') { retreat(); return; }
    if (cmd === 'nextTurn') { passTurn(); return; }
    const u = selUnit();
    if (!u || u.acted || B.side !== B.playerSide || B.auto) return;
    // 혼란 상태 — 이동·공격·계략·일기토·진형·대기 어떤 명령도 받지 않는다
    if (isConfused(u)) { bLog('💫 ' + u.name + ' 부대는 혼란 상태로 행동할 수 없습니다.'); return; }
    if (cmd === 'move') {
      if (u.moved) { bLog('이미 이동했습니다. 공격하거나 대기하세요.'); return; }
      if (!moveRange(u).length) { bLog('이동할 수 있는 칸이 없습니다.'); return; }
      B.mode = 'move'; renderPanel(); return;
    }
    if (cmd === 'charge') {
      if (u.branch !== '기병') { bLog('돌격은 기병 부대만 할 수 있습니다.'); return; }
      if (chargeLeft(u) <= 0) { bLog(u.name + ' 부대는 이번 전투의 돌격 2회를 모두 썼습니다.'); return; }
      if (u.moved) { bLog('돌격은 이동 전에만 할 수 있습니다.'); return; }
      if (B.terrain[u.y][u.x]!==0) { bLog('돌격은 평지에서 출발해야 합니다. 숲·산·성·여울에서는 대형을 갖출 수 없습니다.'); return; }
      if (!chargeOptions(u).length) { bLog('뚫고 나갈 적진이 없습니다.'); return; }
      B.mode = 'charge'; renderPanel(); return;
    }
    if (cmd === 'volley') {
      if (u.branch !== '보병') { bLog('일제공격은 보병만 시작할 수 있습니다. 기병은 보병의 일제공격에 참여만 할 수 있습니다.'); return; }
      if (volleyLeft(u) <= 0) { bLog(u.name + ' 부대는 이번 전투의 일제공격 2회를 모두 썼습니다.'); return; }
      if (!volleyTargets(u).length) { bLog('함께 공격할 수 있는 보병·기병 부대가 적에 인접해 있지 않습니다. 일제공격 횟수가 남아 있어야 합니다.'); return; }
      B.mode = 'volley'; renderPanel(); return;
    }
    if (cmd === 'fire') {
      if (u.branch !== '궁병') { bLog('불화살은 궁병 부대만 쏠 수 있습니다.'); return; }
      if (fireLeft(u) <= 0) { bLog(u.name + ' 부대는 불화살을 모두 썼습니다.'); return; }
      if (!fireTargets(u).length) { bLog('불화살을 쏠 적이 사거리 안에 없습니다.'); return; }
      B.mode = 'fire'; renderPanel(); return;
    }
    if (cmd === 'atk') {
      if (!attackTargets(u).length) { bLog('사거리 안에 적이 없습니다.'); return; }
      B.mode = 'atk'; renderPanel(); return;
    }
    if (cmd === 'strat') {
      if (!STRATS.some(s => stratTargets(u, s).length > 0)) { bLog('계략을 걸 대상이 없습니다.'); return; }
      B.mode = 'strat'; B.strat = null; bLog('계략을 고른 뒤 대상(아군 포함)을 클릭하세요.'); renderPanel(); return;
    }
    if (cmd === 'form') { B.mode = 'form'; renderPanel(); return; }
    if (cmd === 'duel') {
      if (!duelTargets(u).length) { bLog('⚔ ' + duelBlockedReason(u)); return; }
      B.mode = 'duel'; renderPanel(); return;
    }
    if (cmd === 'wait') { u.acted = true; bLog('⏭ ' + u.name + ' 부대 대기'); afterAction(); return; }
  }
  function setStrat(s) {
    const u = selUnit();
    if (!B || B.over || B.busy || B.auto || B.side !== B.playerSide || !u || u.acted || isConfused(u) || !STRATS.includes(s)) return;
    B.strat = s; B.mode = 'strat'; renderPanel();
  }
  function setForm(f) {
    const u = selUnit();
    if (!B || B.over || B.busy || B.auto || B.side !== B.playerSide || !u || u.acted || isConfused(u)) return;
    if (!FORMS[f]) return;
    // 부대마다 첫 진형 전환은 행동을 소모하지 않는다 (AI도 같은 규칙)
    if (!u.formFreeUsed) {
      u.form = f; u.formFreeUsed = true;
      bLog('🎌 ' + u.name + ' 부대 진형 변경 → ' + f + ' (' + FORMS[f].desc + ') — 첫 전환은 행동을 소모하지 않습니다');
      B.mode = 'select'; B.strat = null;
      renderPanel();
      return;
    }
    u.form = f;
    u.acted = true;
    bLog('🎌 ' + u.name + ' 부대 진형 변경 → ' + f + ' (' + FORMS[f].desc + ')');
    afterAction();
  }

  function onClick(e) {
    if (!B || B.over || !cv) return;
    const p = boardPoint(e), x = Math.floor(p.x), y = Math.floor(p.y);
    clickCell(x, y);
  }

  // 캔버스, 키보드용 표, 에이전트가 같은 합법 행동과 실행 경로를 공유한다.
  function cellActions() {
    const actions = new Map();
    if (!B || B.over || B.busy || B.auto || B.side !== B.playerSide) return actions;
    const add = (p, action) => actions.set(p.x + ',' + p.y, action);
    alive(B.playerSide).filter(t => !t.acted || isConfused(t)).forEach(t => add(t, 'select'));
    const u = selUnit();
    if (!u || u.acted || isConfused(u)) return actions;
    if ((B.mode === 'select' || B.mode === 'move') && !u.moved) moveRange(u).forEach(p => add(p, 'move'));
    if (['select', 'move', 'atk'].includes(B.mode)) attackTargets(u).forEach(p => add(p, 'attack'));
    if (B.mode === 'charge' && !u.moved) chargeOptions(u).forEach(p => add(p, 'charge'));
    if (B.mode === 'volley') volleyTargets(u).forEach(p => add(p, 'volley'));
    if (B.mode === 'fire') fireTargets(u).forEach(p => add(p, 'fire'));
    if (B.mode === 'strat' && B.strat) stratTargets(u, B.strat).forEach(p => add(p, B.strat));
    if (B.mode === 'duel') duelTargets(u).forEach(p => add(p, 'duel'));
    return actions;
  }

  function clickCell(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !cellActions().has(x + ',' + y)) return false;
    performCell(x, y);
    return true;
  }

  function performCell(x, y) {
    const target = B.units.find(t => t.alive && t.x === x && t.y === y);
    const u = selUnit();
    if (B.side === B.playerSide && !B.auto) {
      // 대상 지정 중(공격·계략·일기토)에 유효한 대상을 클릭한 것이면
      // 부대 선택으로 가로채지 않고 행동으로 넘긴다 — 아군 대상 계략(고무) 대응
      const targeting = !!u && !!target && (
        (B.mode === 'atk' && target.side !== u.side && attackTargets(u).indexOf(target) >= 0) ||
        (B.mode === 'strat' && !!B.strat && stratTargets(u, B.strat).indexOf(target) >= 0) ||
        (B.mode === 'duel' && duelTargets(u).indexOf(target) >= 0) ||
        (B.mode === 'fire' && target.side !== u.side && fireTargets(u).indexOf(target) >= 0)
      );
      // 부대 선택 — 혼란 부대도 상태 확인용으로 선택은 허용 (행동은 불가)
      if (!targeting && target && target.side === B.playerSide && (!target.acted || isConfused(target))) {
        B.sel = target; B.mode = 'select'; B.strat = null; sfx('select'); renderPanel(); return;
      }
    }
    if (!u || B.auto) return;
    // 혼란 상태의 부대는 이동·공격·계략·일기토를 할 수 없다
    const canAct = B.side === B.playerSide && !u.acted && !isConfused(u);
    // 선택 상태에서도 사거리 안의 적을 클릭하면 바로 공격한다
    if (canAct && (B.mode === 'select' || B.mode === 'atk' || B.mode === 'move') &&
        target && target.side !== u.side && attackTargets(u).indexOf(target) >= 0) {
      attackAct(u, target); return;
    }
    if (B.mode === 'atk') return;          // 공격 지정 중에는 사거리 밖 클릭을 무시
    // 선택 상태에서도 파란 이동 영역을 클릭하면 바로 이동한다
    if (B.mode === 'move' || B.mode === 'select') {
      if (u.moved || !canAct) return;
      if (moveRange(u).some(p => p.x === x && p.y === y)) {
        moveUnitTo(u, x, y); u.moved = true;
        if (checkForts()) return;
        const canHit = attackTargets(u).length > 0;
        B.mode = canHit ? 'atk' : 'select';
        bLog('🚩 ' + u.name + ' 부대 이동' + (canHit ? ' — 공격할 대상을 선택하세요.' : ''));
        renderPanel();
      }
      return;
    }
    if (B.mode === 'charge') {
      if (!canAct || u.moved) return;
      if (chargeOptions(u).some(o => o.x === x && o.y === y)) doCharge(u, { x, y });
      return;
    }
    if (B.mode === 'volley') {
      if (!canAct) return;
      if (target && volleyTargets(u).indexOf(target) >= 0) doVolley(u, target);
      return;
    }
    if (B.mode === 'fire') {
      if (!canAct) return;
      if (target && fireTargets(u).indexOf(target) >= 0) doFireArrow(u, target);
      return;
    }
    if (B.mode === 'strat') {
      if (!B.strat) { bLog('먼저 계략을 선택하세요.'); return; }
      if (target && stratTargets(u, B.strat).indexOf(target) >= 0) doStratAct(u, target, B.strat);
      return;
    }
    if (B.mode === 'duel') {
      // dueled 표시는 doDuel 이 직접 한다 — 여기서 먼저 세우면 doDuel 의 검증에 걸려 실행되지 않는다
      if (target && duelTargets(u).indexOf(target) >= 0) doDuel(u, target);
      else if (target && target.side !== u.side) bLog('⚔ ' + duelBlockedReason(u));
      return;
    }
  }

  function observation() {
    if (!B) return null;
    const actions = cellActions();
    return {
      city: B.opts.city.name, siege:!!B.opts.siege, geography:{region:B.geo.region,site:B.geo.site,kind:B.geo.kind,tactics:B.geo.tactics}, round: B.round, maxRound: B.maxRound,
      playerSide: B.playerSide, side: B.side, auto: B.auto, busy: B.busy,
      over: B.over, winner: B.winner || null, mode: B.mode, strat: B.strat,
      duelRequest: B.duelRequest ? {
        attacker: B.units.indexOf(B.duelRequest.attacker), defender: B.units.indexOf(B.duelRequest.defender),
        refusalMoraleLoss: duelMoraleLoss(B.duelRequest.attacker) * 2
      } : null,
      supply: B.supply ? { atk:{...B.supply.atk}, def:{...B.supply.def} } : null,
      selectedUnit: B.sel ? B.units.indexOf(B.sel) : null,
      cols: COLS, rows: ROWS,
      units: B.units.filter(u => u.alive).map(u => ({
        id: B.units.indexOf(u), name: u.name, side: u.side, x: u.x, y: u.y,
        troops: u.troops, training: u.training, morale: u.morale, branch: u.branch, form: u.form,
        wu: u.officer.wu, zhi: u.officer.zhi, skill: u.officer.skill,
        acted: u.acted, moved: u.moved, confused: isConfused(u), burn: u.burn, fire: u.fire,
        charge: chargeLeft(u), volley: volleyLeft(u)
      })),
      tiles: B.terrain.flatMap((row, y) => row.map((terrain, x) => ({
        x, y, terrain: ['평지', '숲', '산', '성', '물', '여울'][terrain],
        fords: fordDirections(x,y),
        passable: terrain !== WATER, fortOwner: terrain === 3 ? fortOwner(x, y) : null,
        action: actions.get(x + ',' + y) || null
      }))),
      reinforcements: (B.pending || []).map(p => ({ side: p.side, from: p.from, due: p.due,
        troops: p.units.reduce((sum, u) => sum + u.troops, 0) })),
      log: B.log.slice(-20)
    };
  }

  function renderTextBoard() {
    const el = $('bTextBoard'); if (!el || !B) return;
    const state = observation();
    const labels = { select: '선택', move: '이동', attack: '공격', charge: '돌격', volley: '일제공격', fire: '불화살', duel: '일기토', retreat: '후퇴' };
    const modes = { ...labels, atk: '공격', strat: B.strat || '계략 선택', form: '진형 변경' };
    const html = '<p>좌표는 0부터 시작합니다. 현재 선택: ' + (B.sel ? B.sel.name : '없음') +
      ' · ' + modes[B.mode] + '</p><table><caption>13열 × 9행 전장 · 가능한 칸만 활성화</caption><tbody>' +
      Array.from({ length: ROWS }, (_, y) => '<tr>' + state.tiles.filter(t => t.y === y).map(t => {
        const u = state.units.find(u => u.x === t.x && u.y === t.y);
        const label = '(' + t.x + ',' + t.y + ') ' + t.terrain +
          (t.fords.length ? ' · '+t.fords.join('·')+' 여울로 도하 가능' : '') +
          (t.fortOwner ? ' · ' + (t.fortOwner === 'atk' ? '공격군' : '수비군') + ' 점유' : '') +
          (u ? ' · ' + (u.side === B.playerSide ? '아군 ' : '적군 ') + u.name + ' 병력 ' + u.troops +
            ' 사기 ' + u.morale + (u.acted ? ' 행동 완료' : '') + (u.confused ? ' 혼란' : '') : '') +
          (t.action ? ' · ' + (labels[t.action] || t.action) : '');
        return '<td data-battle-x="'+t.x+'" data-battle-y="'+t.y+'"><button type="button" aria-label="' + label + '" title="' + label +
          '" onclick="Battle.clickCell(' + t.x + ',' + t.y + ')"' + (t.action ? '' : ' disabled') + '>' +
          t.x + ',' + t.y + '<br>' + (u ? u.name : t.terrain) + '</button></td>';
      }).join('') + '</tr>').join('') + '</tbody></table>';
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  /* ── 그리기 ────────────────────────────────────────── */
  function lg(x0, y0, x1, y1, stops) {
    let g = null;
    try { g = ctx.createLinearGradient(x0, y0, x1, y1); } catch (e) { g = null; }
    if (!g || typeof g.addColorStop !== 'function') return stops[0][1];
    stops.forEach(s => g.addColorStop(s[0], s[1]));
    return g;
  }
  function hash2(x, y, s) {
    const n = Math.sin(x * 127.1 + y * 311.7 + s * 43.3) * 43758.5453;
    return n - Math.floor(n);
  }

  /* ── 진형별 카드 실루엣 ─────────────────────────────────
     본체 크기를 맞추고, 끝과 어깨에 작은 차이를 주어 진형의 흐름을 살린다.
     어린=유선형 쐐기 · 봉시=창끝 · 방원=둥근 방패 · 안행=사선 · 학익=펼친 날개 */
  const FORM_LOOK = {
    '어린': { glyph: '鱗', tint: 'rgba(255,198,120,.92)' },
    '봉시': { glyph: '鋒', tint: 'rgba(255,152,120,.92)' },
    '방원': { glyph: '圓', tint: 'rgba(140,200,255,.92)' },
    '안행': { glyph: '雁', tint: 'rgba(150,230,170,.92)' },
    '학익': { glyph: '翼', tint: 'rgba(212,170,255,.92)' }
  };
  function formLook(f) { return FORM_LOOK[f] || FORM_LOOK['어린']; }

  /* 46×46 본체에 최대 2만큼의 여유를 두고 매끈한 윤곽을 만든다. 선택·성곽 테두리도
     같은 정규화 경로를 확대하므로 꼭짓점이나 날개만 과하게 솟지 않는다.
     경로는 save/restore 뒤에도 남고, 선 두께는 호출부의 배율을 따른다. */
  function formPath(x, form, X, Y, W, H, g) {
    g = g || 0;
    x.save();
    x.translate(X - g, Y - g);
    x.scale((W + g * 2) / 46, (H + g * 2) / 46);
    x.beginPath();
    if (form === '봉시') {
      // 몸체에서 자연스럽게 모이는 창끝 — 따로 붙인 삼각 장식을 없앤다.
      x.moveTo(9, 0);
      x.lineTo(33, 0);
      x.bezierCurveTo(38, 0, 40, 3, 41, 8);
      x.bezierCurveTo(42, 14, 48, 20, 48, 23);
      x.bezierCurveTo(48, 26, 42, 32, 41, 38);
      x.bezierCurveTo(40, 43, 38, 46, 33, 46);
      x.lineTo(9, 46);
      x.quadraticCurveTo(0, 46, 0, 37);
      x.lineTo(0, 9);
      x.quadraticCurveTo(0, 0, 9, 0);
    } else if (form === '방원') {
      x.moveTo(16, 0);
      x.lineTo(30, 0);
      x.quadraticCurveTo(46, 0, 46, 16);
      x.lineTo(46, 30);
      x.bezierCurveTo(46, 41, 36, 48, 23, 48);
      x.bezierCurveTo(10, 48, 0, 41, 0, 30);
      x.lineTo(0, 16);
      x.quadraticCurveTo(0, 0, 16, 0);
    } else if (form === '안행') {
      // 모난 계단 대신 비스듬히 흐르는, 모서리를 둥글린 종대.
      x.moveTo(12, -2);
      x.lineTo(37, -2);
      x.quadraticCurveTo(49, -2, 47, 10);
      x.lineTo(41, 38);
      x.quadraticCurveTo(40, 47, 32, 47);
      x.lineTo(7, 47);
      x.quadraticCurveTo(-3, 47, -1, 35);
      x.lineTo(4.5, 8);
      x.quadraticCurveTo(5.5, -2, 12, -2);
    } else if (form === '학익') {
      // 양쪽 어깨에서 중앙으로 내려오는 완만한 날개 곡선.
      x.moveTo(7, 0);
      x.bezierCurveTo(13, 0, 17, 6, 23, 6);
      x.bezierCurveTo(29, 6, 33, 0, 39, 0);
      x.quadraticCurveTo(48, 0, 48, 8);
      x.lineTo(44, 36);
      x.quadraticCurveTo(43.5, 46, 34, 46);
      x.lineTo(12, 46);
      x.quadraticCurveTo(2.5, 46, 2, 36);
      x.lineTo(-2, 8);
      x.quadraticCurveTo(-2, 0, 7, 0);
    } else {
      x.moveTo(23, -2);
      x.bezierCurveTo(27, -2, 39, 3, 43, 7);
      x.quadraticCurveTo(46, 9, 46, 13);
      x.lineTo(46, 37);
      x.quadraticCurveTo(46, 43, 40, 44);
      x.quadraticCurveTo(23, 48, 6, 44);
      x.quadraticCurveTo(0, 43, 0, 37);
      x.lineTo(0, 13);
      x.quadraticCurveTo(0, 9, 3, 7);
      x.bezierCurveTo(7, 3, 19, -2, 23, -2);
    }
    x.closePath();
    x.restore();
  }


  /* ── 전투 연출 — 화살 · 칼자국 · 화염 · 혼란 · 고무 ──── */
  const FX_MS = { arrow: 680, fireArrow: 720, slash: 600, duel: 780, fire: 980, confuse: 1000, boost: 940 };
  let fxRaf = null;
  // 헤드리스(테스트) 환경에서는 requestAnimationFrame 이 없으므로 연출을 쌓지 않는다
  function fxOn() { return typeof requestAnimationFrame === 'function'; }
  function fnow() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  // 연출 등록 — delay(ms) 를 주면 그 시점부터 재생된다 (반격 등 후속타)
  function fx(type, from, to, opt) {
    if (!B || !fxOn()) return;
    if (!B.fx) B.fx = [];
    const o = opt || {}, at = from || null, tt = to || null;
    B.fx.push({
      type, from: at, to: tt,
      x0: at ? at.x : (o.x0 || 0), y0: at ? at.y : (o.y0 || 0),
      x1: tt ? tt.x : (at ? at.x : (o.x1 || 0)),
      y1: tt ? tt.y : (at ? at.y : (o.y1 || 0)),
      t0: fnow() + (o.delay || 0), dur: o.dur || FX_MS[type] || 600,
      seed: Math.random() * 91
    });
    fxPump();
  }

  // 이동 애니메이션이 재생 중인 부대가 있는가
  function moveAnimOn() {
    return !!(B && B.units && B.units.some(u => u.anim));
  }

  // 연출이나 이동 애니메이션이 남아 있는 동안 프레임을 돌려 다시 그린다
  function fxPump() {
    if (fxRaf != null || !B || !fxOn()) return;
    if (!(B.fx && B.fx.length) && !moveAnimOn()) return;
    const tick = () => {
      fxRaf = null;
      if (!B) return;
      const t = fnow();
      B.fx = (B.fx || []).filter(e => t - e.t0 < e.dur);
      // 이동이 끝난 부대는 연출을 지우고 제자리에 그린다
      B.units.forEach(x => { if (x.anim && t - x.anim.t0 >= x.anim.dur) x.anim = null; });
      draw();
      if (B && ((B.fx && B.fx.length) || moveAnimOn())) fxRaf = requestAnimationFrame(tick);
    };
    fxRaf = requestAnimationFrame(tick);
  }

  /* ── 이동 애니메이션 — 논리 좌표는 즉시, 화면은 칸을 따라 미끄러진다 ── */
  const MOVE_STEP_MS = 145;                // 칸마다 일정한 행군 속도
  const MOVE_MIN_MS = 180, MOVE_MAX_MS = 1100;

  // 이동 범위와 같은 진입 비용으로 실제 경로를 찾는다. 아군은 통과, 적은 장애물.
  function fordPath(u, x0, y0, x1, y1) {
    if (!B || !B.terrain) return null;
    const start = y0 * COLS + x0, end = y1 * COLS + x1, N = COLS * ROWS;
    const cost = Array(N).fill(Infinity), prev = Array(N).fill(-1), done = new Set();
    cost[start] = 0;
    for (let i = 0; i < N; i++) {
      let cur = -1;
      for (let n = 0; n < N; n++) if (!done.has(n) && (cur < 0 || cost[n] < cost[cur])) cur = n;
      if (cur < 0 || !Number.isFinite(cost[cur])) break;
      if (cur === end) break;
      done.add(cur);
      const cx = cur % COLS, cy = Math.floor(cur / COLS);
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy]) => {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS || B.terrain[y][x] === WATER) return;
        const occ = unitAt(x,y);
        if (occ && occ !== u && occ.side !== u.side) return;
        const t = B.terrain[y][x], next = y * COLS + x;
        const nd = cost[cur] + CombatRules.moveCost(u.branch,t);
        if (nd < cost[next]) { cost[next] = nd; prev[next] = cur; }
      });
    }
    if (!Number.isFinite(cost[end])) return null;
    const path = [];
    for (let n = end; n >= 0; n = prev[n]) path.push({ x:n % COLS, y:Math.floor(n / COLS) });
    return path.reverse();
  }

  // 부대를 (x, y)로 옮기고 이동 연출을 시작한다 (연출이 불가한 환경이면 즉시 이동)
  function moveUnitTo(u, x, y, charge = false) {
    if (!u) return;
    const x0 = u.x, y0 = u.y;
    // 돌격만 적진을 관통한다. 일반 이동은 반드시 합법적인 경로를 확보한 뒤 확정한다.
    let path = charge ? null : fordPath(u, x0, y0, x, y);
    if (!charge && !path) return;
    if (charge) {
      path = [{ x:x0, y:y0 }];
      const dx = Math.sign(x-x0), dy = Math.sign(y-y0), steps = Math.abs(x-x0)+Math.abs(y-y0);
      for (let i=1;i<=steps;i++) path.push({x:x0+dx*i,y:y0+dy*i});
    }
    u.x = x; u.y = y;
    if(!charge && path.length>1) {
      const steps=Math.min(8,(path.length-1)*2), dur=cl((path.length-1)*MOVE_STEP_MS,MOVE_MIN_MS,MOVE_MAX_MS);
      sfx('move',{steps,gap:dur/steps/1000,branch:u.branch,
        ground:B.terrain[y][x]===FORD?'wet':B.terrain[y][x]===2||B.terrain[y][x]===3?'stone':B.geo.theme,
        pan:(x/COLS-.5)*.7});
    }
    if (!fxOn() || (x0 === x && y0 === y)) { u.anim = null; return; }
    const steps = path.length - 1;
    u.anim = {
      x0: x0, y0: y0, x1: x, y1: y,
      path: path,
      dx: x === x0 ? 0 : (x > x0 ? 1 : -1),
      dy: y === y0 ? 0 : (y > y0 ? 1 : -1),
      t0: fnow(), dur: cl(steps * (charge ? 105 : MOVE_STEP_MS), MOVE_MIN_MS, MOVE_MAX_MS)
    };
    fxPump();
  }

  // 이동 중인 화면 좌표(칸 단위) — 애니메이션이 없으면 null
  function animPos(u) {
    const a = u && u.anim;
    if (!a) return null;
    const q = cl((fnow() - a.t0) / a.dur, 0, 1);
    if (q >= 1) { u.anim = null; return null; }
    const e = q; // 가속 후 날아가는 느낌 없이 칸을 따라 일정한 속도로 걷는다
    // 여울을 경유하는 경로가 있으면 칸을 따라 걷는다 (물 위를 가로지르지 않는다)
    if (a.path && a.path.length > 1) {
      const n = a.path.length - 1, f = e * n;
      const i = Math.min(n - 1, Math.floor(f)), t = f - i;
      const p = a.path[i], s = a.path[i + 1];
      return {
        x: p.x + (s.x - p.x) * t, y: p.y + (s.y - p.y) * t, q: q,
        dx: s.x === p.x ? 0 : (s.x > p.x ? 1 : -1),
        dy: s.y === p.y ? 0 : (s.y > p.y ? 1 : -1)
      };
    }
    return { x: a.x0 + (a.x1 - a.x0) * e, y: a.y0 + (a.y1 - a.y0) * e, q: q, dx: a.dx, dy: a.dy };
  }

  // 진행도 0~1 (아직 시작 전이면 -1)
  function fxP(e, t) { return t < e.t0 ? -1 : cl((t - e.t0) / e.dur, 0, 1); }
  function fxXY(x, y) { return [x * TILE + TILE / 2, y * TILE + TILE / 2]; }

  function fxStar(x, y, r, col) {
    ctx.save();
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = -Math.PI / 2 + i * Math.PI / 4, rr = i % 2 === 0 ? r : r * 0.34;
      const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // 타격 지점 — 확산 링과 파편
  function fxImpact(cx, cy, q, rgb, n) {
    if (q <= 0 || q >= 1) return;
    const a = 1 - q, cnt = n || 8;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.5 * a).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, TILE * 0.06 * a);
    ctx.beginPath(); ctx.arc(cx, cy, TILE * (0.1 + q * 0.55), 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < cnt; i++) {
      const ang = (i / cnt) * Math.PI * 2 + hash2(i, 2.7, 1.3);
      const d = TILE * (0.12 + q * 0.55) * (0.6 + hash2(i, 4.1, 2.2) * 0.75);
      ctx.fillStyle = 'rgba(' + rgb + ',' + (0.8 * a).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d,
        Math.max(1, TILE * 0.042 * a), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 칼자국 — 부채꼴 호
  function fxArc(cx, cy, a0, a1, q, alpha) {
    if (q <= 0 || q >= 1 || alpha <= 0) return;
    const r = TILE * 0.44, end = a0 + (a1 - a0) * q;
    const w = Math.max(1.2, TILE * 0.1 * Math.sin(q * Math.PI));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, end);
    ctx.strokeStyle = 'rgba(255,186,96,' + (0.34 * alpha).toFixed(3) + ')';
    ctx.lineWidth = w * 2.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, end);
    ctx.strokeStyle = 'rgba(255,248,228,' + (0.9 * alpha).toFixed(3) + ')';
    ctx.lineWidth = w; ctx.stroke();
    ctx.restore();
  }

  // 칼자국 — 직선 긋기 (일기토)
  function fxLine(cx, cy, ang, len, q, alpha) {
    if (q <= 0 || q >= 1 || alpha <= 0) return;
    const half = len / 2 * q, w = Math.max(1.2, TILE * 0.085 * Math.sin(q * Math.PI));
    const dx = Math.cos(ang), dy = Math.sin(ang);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - dx * half, cy - dy * half);
    ctx.lineTo(cx + dx * half, cy + dy * half);
    ctx.strokeStyle = 'rgba(255,190,100,' + (0.34 * alpha).toFixed(3) + ')';
    ctx.lineWidth = w * 2.2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,250,232,' + (0.92 * alpha).toFixed(3) + ')';
    ctx.lineWidth = w; ctx.stroke();
    ctx.restore();
  }

  /* 화살 세례 — 궁병·원거리 공격 (hot = 불화살) */
  function fxArrows(e, p, hot) {
    const s = fxXY(e.x0, e.y0), t = fxXY(e.x1, e.y1);
    for (let i = 0; i < 5; i++) {
      const q = cl((p - i * 0.06) / 0.66, 0, 1);
      if (q <= 0 || q >= 1) continue;
      const sx = s[0] + (hash2(i, e.seed, 1.7) - 0.5) * TILE * 0.55;
      const sy = s[1] + (hash2(i, e.seed, 3.3) - 0.5) * TILE * 0.4;
      const tx = t[0] + (hash2(i, e.seed, 5.1) - 0.5) * TILE * 0.5;
      const ty = t[1] + (hash2(i, e.seed, 7.2) - 0.5) * TILE * 0.45;
      const mx = (sx + tx) / 2, my = Math.min(sy, ty) - TILE * 0.72;
      const u = 1 - q;
      const bx = u * u * sx + 2 * u * q * mx + q * q * tx;
      const by = u * u * sy + 2 * u * q * my + q * q * ty;
      const ang = Math.atan2(2 * u * (my - sy) + 2 * q * (ty - my),
        2 * u * (mx - sx) + 2 * q * (tx - mx));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = q > 0.86 ? (1 - q) / 0.14 : 1;
      ctx.translate(bx, by); ctx.rotate(ang);
      // 잔상
      ctx.strokeStyle = hot ? 'rgba(255,170,84,.42)' : 'rgba(255,232,180,.28)';
      ctx.lineWidth = Math.max(1, TILE * 0.02);
      ctx.beginPath(); ctx.moveTo(-TILE * 0.42, 0); ctx.lineTo(TILE * 0.02, 0); ctx.stroke();
      // 불화살 — 화살대를 감싸는 불꽃 자락
      if (hot) {
        ctx.strokeStyle = 'rgba(255,126,40,.55)';
        ctx.lineWidth = Math.max(1.6, TILE * 0.06);
        ctx.beginPath(); ctx.moveTo(-TILE * 0.3, 0); ctx.lineTo(-TILE * 0.04, 0); ctx.stroke();
      }
      // 화살대
      ctx.strokeStyle = hot ? '#ffbe78' : '#e9d9b0';
      ctx.lineWidth = Math.max(1, TILE * 0.028);
      ctx.beginPath(); ctx.moveTo(-TILE * 0.24, 0); ctx.lineTo(TILE * 0.06, 0); ctx.stroke();
      // 촉
      ctx.fillStyle = hot ? '#fff3c4' : '#f6f9ff';
      ctx.beginPath();
      ctx.moveTo(TILE * 0.14, 0);
      ctx.lineTo(TILE * 0.03, -TILE * 0.05);
      ctx.lineTo(TILE * 0.03, TILE * 0.05);
      ctx.closePath(); ctx.fill();
      // 깃
      ctx.strokeStyle = hot ? 'rgba(255,198,124,.9)' : 'rgba(190,215,255,.85)';
      ctx.lineWidth = Math.max(1, TILE * 0.019);
      ctx.beginPath();
      ctx.moveTo(-TILE * 0.23, 0); ctx.lineTo(-TILE * 0.13, -TILE * 0.05);
      ctx.moveTo(-TILE * 0.23, 0); ctx.lineTo(-TILE * 0.13, TILE * 0.05);
      ctx.stroke();
      ctx.restore();
    }
    // 착탄
    if (p > 0.66) fxImpact(t[0], t[1], cl((p - 0.66) / 0.3, 0, 1), hot ? '255,158,66' : '255,238,196', 7);
  }

  /* 칼질 — 근접 공격 */
  function fxSlash(e, p) {
    const s = fxXY(e.x0, e.y0), t = fxXY(e.x1, e.y1);
    // 공격자에서 대상으로 미끄러지는 잔상
    const run = cl(p / 0.42, 0, 1);
    if (run > 0 && run < 1) {
      const gx = s[0] + (t[0] - s[0]) * run, gy = s[1] + (t[1] - s[1]) * run;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,226,160,' + (0.22 * (1 - run)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(gx, gy, TILE * 0.26, TILE * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const sp = cl((p - 0.12) / 0.5, 0, 1), fade = 1 - sp;
    fxArc(t[0], t[1], Math.PI * 1.02, Math.PI * 1.62, sp, fade);
    fxArc(t[0], t[1], Math.PI * 0.18, Math.PI * 0.78, cl(sp * 1.3, 0, 1), fade);
    if (p > 0.26) fxImpact(t[0], t[1], cl((p - 0.26) / 0.34, 0, 1), '255,228,150', 9);
  }

  /* 일기토 — 두 장수가 맞부딪히는 교차 칼자국 */
  function fxDuel(e, p) {
    const s = fxXY(e.x0, e.y0), t = fxXY(e.x1, e.y1);
    const mx = (s[0] + t[0]) / 2, my = (s[1] + t[1]) / 2 - TILE * 0.14;
    const q1 = cl((p - 0.08) / 0.34, 0, 1), q2 = cl((p - 0.3) / 0.34, 0, 1);
    fxLine(mx, my, -Math.PI * 0.3, TILE * 0.92, q1, 1 - q1 * 0.35);
    fxLine(mx, my, Math.PI * 0.3, TILE * 0.92, q2, 1 - q2 * 0.35);
    if (p > 0.28) fxImpact(mx, my, cl((p - 0.28) / 0.3, 0, 1), '255,236,170', 11);
    for (let i = 0; i < 4; i++) {
      const q = cl((p - 0.35) / 0.5, 0, 1);
      if (q <= 0 || q >= 1) continue;
      const ang = -Math.PI * 0.75 + (i / 3) * Math.PI * 0.5;
      const d = TILE * (0.3 + q * 0.5);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,244,206,' + (0.85 * (1 - q)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(mx + Math.cos(ang) * d, my + Math.sin(ang) * d,
        Math.max(1, TILE * 0.045 * (1 - q)), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* 화염 — 화계 */
  function fxFire(e, p) {
    const t = fxXY(e.x1, e.y1);
    const grow = cl(p / 0.22, 0, 1), fade = cl((1 - p) / 0.32, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    let g = null;
    try { g = ctx.createRadialGradient(t[0], t[1], 0, t[0], t[1], TILE * 0.8); } catch (err) { g = null; }
    if (g && typeof g.addColorStop === 'function') {
      g.addColorStop(0, 'rgba(255,170,60,' + (0.45 * fade * grow).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(t[0], t[1], TILE * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    // 불꽃 혀
    for (let i = 0; i < 7; i++) {
      const hx = hash2(i, e.seed, 1.9);
      const bx = t[0] + (hx - 0.5) * TILE * 0.72;
      const by = t[1] + TILE * 0.3;
      const fh = TILE * (0.5 + hx * 0.55) * grow * (0.82 + 0.18 * Math.sin(p * 17 + i * 1.7));
      const sway = Math.sin(p * 11 + i * 2.1) * TILE * 0.07;
      ctx.beginPath();
      ctx.moveTo(bx - TILE * 0.1, by);
      ctx.quadraticCurveTo(bx - TILE * 0.14 + sway, by - fh * 0.55, bx + sway, by - fh);
      ctx.quadraticCurveTo(bx + TILE * 0.14 + sway, by - fh * 0.55, bx + TILE * 0.1, by);
      ctx.closePath();
      let fg = null;
      try { fg = ctx.createLinearGradient(bx, by, bx, by - fh); } catch (err) { fg = null; }
      if (fg && typeof fg.addColorStop === 'function') {
        fg.addColorStop(0, 'rgba(255,86,18,' + (0.55 * fade).toFixed(3) + ')');
        fg.addColorStop(0.55, 'rgba(255,168,48,' + (0.6 * fade).toFixed(3) + ')');
        fg.addColorStop(1, 'rgba(255,246,206,' + (0.18 * fade).toFixed(3) + ')');
        ctx.fillStyle = fg;
      } else ctx.fillStyle = 'rgba(255,150,40,' + (0.5 * fade).toFixed(3) + ')';
      ctx.fill();
    }
    // 불티
    for (let i = 0; i < 9; i++) {
      const hx = hash2(i, e.seed + 4.2, 3.7);
      const q = cl(p * 1.5 - hx * 0.7, 0, 1);
      if (q <= 0 || q >= 1) continue;
      const px = t[0] + (hx - 0.5) * TILE * 0.8 + Math.sin(q * 9 + i) * TILE * 0.08;
      const py = t[1] + TILE * 0.3 - q * TILE * 0.95;
      ctx.fillStyle = 'rgba(255,214,128,' + (0.8 * (1 - q)).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(px, py, Math.max(1, TILE * 0.028 * (1 - q)), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /* 혼란 — 머리 위로 도는 별과 소용돌이 */
  function fxConfuse(e, p) {
    const t = fxXY(e.x1, e.y1);
    const cy = t[1] - TILE * 0.34;
    const fade = cl((1 - p) / 0.25, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(226,168,255,' + (0.42 * fade).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, TILE * 0.045);
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) {
      const rr = TILE * 0.1 + i * TILE * 0.0055;
      const ang = p * Math.PI * 5 + i * 0.34;
      const px = t[0] + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr * 0.52;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    for (let k = 0; k < 3; k++) {
      const ph = p * Math.PI * 4 + k * (Math.PI * 2 / 3);
      const sx = t[0] + Math.cos(ph) * TILE * 0.34;
      const sy = cy + Math.sin(ph) * TILE * 0.14;
      fxStar(sx, sy, TILE * (0.075 + 0.025 * Math.sin(p * 12 + k)),
        'rgba(244,198,255,' + (0.9 * fade).toFixed(3) + ')');
    }
    ctx.restore();
  }

  /* 고무 — 아군 사기를 북돋우는 황금 기운 */
  function fxBoost(e, p) {
    const t = fxXY(e.x1, e.y1);
    const fade = cl((1 - p) / 0.3, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const q = cl(p * 1.2 - k * 0.2, 0, 1);
      if (q <= 0 || q >= 1) continue;
      const r = TILE * (0.16 + q * 0.6);
      ctx.strokeStyle = 'rgba(255,226,150,' + (0.62 * (1 - q)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, TILE * 0.05 * (1 - q));
      ctx.beginPath();
      ctx.ellipse(t[0], t[1] + TILE * 0.22, r, r * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const hx = hash2(i, e.seed + 5.3, 2.1);
      const q = cl(p * 1.5 - hx * 0.75, 0, 1);
      if (q <= 0 || q >= 1) continue;
      const px = t[0] + (hx - 0.5) * TILE * 0.7 + Math.sin(q * 8 + i) * TILE * 0.06;
      const py = t[1] + TILE * 0.24 - q * TILE * 0.85;
      const sz = TILE * (0.055 - 0.03 * q);
      if (i % 3 === 0) {
        fxStar(px, py, sz * 1.6, 'rgba(255,238,182,' + (0.85 * (1 - q) * fade).toFixed(3) + ')');
      } else {
        ctx.fillStyle = 'rgba(255,214,126,' + (0.8 * (1 - q) * fade).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(px, py, Math.max(1, sz), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawFx() {
    if (!B || !B.fx || !B.fx.length || !ctx) return;
    const t = fnow();
    B.fx.forEach(e => {
      const p = fxP(e, t);
      if (p < 0 || p >= 1) return;
      if (e.type === 'arrow') fxArrows(e, p);
      else if (e.type === 'fireArrow') fxArrows(e, p, true);
      else if (e.type === 'slash') fxSlash(e, p);
      else if (e.type === 'duel') fxDuel(e, p);
      else if (e.type === 'fire') fxFire(e, p);
      else if (e.type === 'confuse') fxConfuse(e, p);
      else if (e.type === 'boost') fxBoost(e, p);
    });
  }

  // 피격 연출 — 맞은 부대가 흔들리고 번쩍인다 (0~1, 없으면 -1)
  function fxHit(u) {
    if (!B || !B.fx || !B.fx.length) return -1;
    const t = fnow();
    let best = -1;
    B.fx.forEach(e => {
      if (e.to !== u) return;
      if (e.type !== 'arrow' && e.type !== 'fireArrow' && e.type !== 'slash' && e.type !== 'fire' && e.type !== 'duel') return;
      const p = fxP(e, t);
      if (p < 0 || p >= 1) return;
      const from = (e.type === 'arrow' || e.type === 'fireArrow') ? 0.6 : (e.type === 'fire' ? 0.12 : 0.16);
      if (p < from) return;
      best = Math.max(best, cl((p - from) / Math.max(0.001, 1 - from), 0, 1));
    });
    return best;
  }

  function drawMinimap() {
    const panel = $('bMinimap');
    if (panel && !panel.open) return;
    const mini = $('bMiniCanvas');
    if (!mini || !B || !B.backdropBase) return;
    const r = mini.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const ratio = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
    const width = Math.max(1,Math.round(r.width*ratio)),height = Math.max(1,Math.round(r.height*ratio));
    if (mini.width !== width) mini.width = width;
    if (mini.height !== height) mini.height = height;
    const x = mini.getContext('2d');
    // CSS 크기를 기준으로 그려 작은 화면에서도 표식과 테두리가 같은 크기로 보인다.
    x.setTransform(ratio,0,0,ratio,0,0);
    x.clearRect(0,0,r.width,r.height);
    x.drawImage(B.backdropBase,0,0,r.width,r.height);
    const W = COLS*TILE,H = ROWS*TILE;
    const sx = r.width/COLS,sy = r.height/ROWS;
    const friend = B.playerSide === 'def' ? 'def' : 'atk';
    const color = side => side === friend ? '#6ab9ff' : '#ff7a68';
    fortTiles().forEach(f => {
      x.fillStyle = color(f.owner);x.strokeStyle = '#172219';x.lineWidth = 1;
      x.fillRect((f.x+.5)*sx-3,(f.y+.5)*sy-3,6,6);
      x.strokeRect((f.x+.5)*sx-3,(f.y+.5)*sy-3,6,6);
    });
    const left = -camera.px/camera.scale/W*r.width,top = -camera.py/camera.scale/H*r.height;
    const w = r.width/camera.scale,h = r.height/camera.scale;
    x.fillStyle = 'rgba(255,235,168,.10)';x.fillRect(left,top,w,h);
    x.strokeStyle = '#fff0b0';x.lineWidth = 1.2;
    x.strokeRect(left+.6,top+.6,Math.max(0,w-1.2),Math.max(0,h-1.2));
    const units = B.units.filter(u => u.alive && u.troops > 0);
    // 선택 부대를 맨 위에 그린다. 행군 중에는 본 전장과 같은 보간 좌표를 사용한다.
    units.slice().sort((a,b) => Number(a === B.sel)-Number(b === B.sel)).forEach(u => {
      const p = animPos(u) || u,cx = (p.x+.5)*sx,cy = (p.y+.5)*sy;
      const mine = u.side === friend,size = u === B.sel ? 3.5 : 2.8;
      if (u === B.sel) {
        x.beginPath();x.arc(cx,cy,size+2,0,Math.PI*2);
        x.strokeStyle = '#ffe6a8';x.lineWidth = 1.5;x.stroke();
      }
      x.beginPath();
      if (mine) x.arc(cx,cy,size,0,Math.PI*2);
      else {x.moveTo(cx,cy-size-1);x.lineTo(cx+size+1,cy);x.lineTo(cx,cy+size+1);x.lineTo(cx-size-1,cy);x.closePath();}
      x.fillStyle = color(u.side);x.fill();x.strokeStyle = '#0a1514';x.lineWidth = 1;x.stroke();
    });
    const friendly = $('bMiniFriendly'),hostile = $('bMiniHostile');
    if (friendly) friendly.textContent = String(units.filter(u => u.side === friend).length);
    if (hostile) hostile.textContent = String(units.filter(u => u.side !== friend).length);
  }

  function draw() {
    if (!B || !ctx) return;
    const W = COLS * TILE, H = ROWS * TILE;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const sx = cv.width / W, sy = cv.height / H;
    ctx.setTransform(sx * camera.scale, 0, 0, sy * camera.scale, sx * camera.px, sy * camera.py);
    ctx.clearRect(0, 0, W, H);
    drawBackdrop(W,H);
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) if(B.terrain[y][x]===3) drawFort(x*TILE,y*TILE,fortOwner(x,y));
    // 행동 범위/대상
    const u = selUnit();
    if (u) {
      const mark = (list, fill, stroke) => list.forEach(p => {
        pRound(ctx, p.x * TILE + 3, p.y * TILE + 3, TILE - 6, TILE - 6, Math.max(4, TILE * 0.13));
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
      });
      // 부대를 선택만 해도 이동·공격 가능 영역을 자동으로 보여준다
      const myTurn = B.side === B.playerSide && !B.auto && !u.acted;
      const point = myTurn && (B.mode === 'select' || B.mode === 'move');
      if ((B.mode === 'move' || (B.mode === 'select' && myTurn)) && !u.moved) {
        mark(moveRange(u), 'rgba(120,200,255,.16)', 'rgba(120,200,255,.45)');
      }
      if (B.mode === 'atk' || point) mark(attackTargets(u), 'rgba(255,90,60,.20)', 'rgba(255,110,80,.65)');
      if (B.mode === 'strat' && B.strat) mark(stratTargets(u, B.strat), 'rgba(230,190,90,.18)', 'rgba(240,200,110,.6)');
      if (B.mode === 'duel') mark(duelTargets(u), 'rgba(230,120,220,.18)', 'rgba(235,150,225,.6)');
      if (B.mode === 'charge') mark(chargeOptions(u), 'rgba(255,180,70,.22)', 'rgba(255,200,100,.7)');
      if (B.mode === 'volley') mark(volleyTargets(u), 'rgba(150,235,140,.20)', 'rgba(175,240,165,.65)');
      if (B.mode === 'fire') mark(fireTargets(u), 'rgba(255,146,58,.22)', 'rgba(255,170,90,.7)');
    }
    B.units.forEach(x => { if (x.alive) drawUnit(x); });
    drawFx();
    // 피해 숫자
    B.floats.forEach(f => {
      ctx.font = 'bold ' + Math.max(12, Math.round(TILE * 0.26)) + 'px "Malgun Gothic"';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 3; ctx.strokeStyle = '#000';
      ctx.strokeText(f.text, f.x * TILE + TILE / 2, f.y * TILE + TILE * 0.4);
      ctx.fillStyle = '#ffd98a';
      ctx.fillText(f.text, f.x * TILE + TILE / 2, f.y * TILE + TILE * 0.4);
      ctx.textAlign = 'left';
    });
    /* 비네트 — 전장이 한 장의 그림처럼 보이도록 테두리를 눌러준다 */
    if (ctx.createRadialGradient) {
      const vg = ctx.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.74);
      if (vg && vg.addColorStop) {
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(0.7, 'rgba(0,0,0,.10)');
        vg.addColorStop(1, 'rgba(0,0,0,.44)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
      }
    }
    drawMinimap();
  }

  /* 연속된 지면 — 타일마다 명암을 초기화하지 않고 지형과 경작지로 표면을 나눈다. */
  function drawBackdrop(W,H) {
    const key=TILE+':'+cv.width+':'+cv.height;
    const rasterize=target=>{
      const canvas=document.createElement('canvas'), current=ctx;
      canvas.width=cv.width;canvas.height=cv.height;
      canvas.__view={...target};
      const sx=canvas.width/W,sy=canvas.height/H;
      ctx=canvas.getContext('2d');
      ctx.setTransform(sx*target.scale,0,0,sy*target.scale,sx*target.px,sy*target.py);
      try { drawGround(W,H);drawScenery();drawWater(W,H);drawProps();drawRiverNames();drawGrid(W,H); }
      finally { ctx=current; }
      return canvas;
    };
    if (!B.backdropBase || B.backdropKey!==key) {
      B.backdropBase=rasterize({scale:1,px:0,py:0});
      B.backdrop=B.backdropBase; B.backdropKey=key;
    }
    const old=B.backdrop.__view;
    if (!(navigation && navigation.active) && (old.scale!==camera.scale || old.px!==camera.px || old.py!==camera.py)) {
      B.backdrop=camera.scale===1?B.backdropBase:rasterize(camera);
    }
    paintViewportRaster(ctx,B.backdropBase,camera,W,H,cv.width,cv.height);
    if (B.backdrop!==B.backdropBase) paintViewportRaster(ctx,B.backdrop,camera,W,H,cv.width,cv.height);
  }
  function geoPath(pts) {
    ctx.beginPath();
    pts.forEach((p,i) => { if(i) ctx.lineTo(p[0]*TILE,p[1]*TILE); else ctx.moveTo(p[0]*TILE,p[1]*TILE); });
    ctx.closePath();
  }
  function geoLine(pts) {
    ctx.beginPath();
    pts.forEach((p,i) => { if(i) ctx.lineTo(p[0]*TILE,p[1]*TILE); else ctx.moveTo(p[0]*TILE,p[1]*TILE); });
  }
  function drawGround(W, H) {
    const g=B.geo, p=g.palette;
    ctx.fillStyle=lg(0,0,W,H,[[0,p.light],[.48,p.ground],[1,p.dark]]);
    ctx.fillRect(0,0,W,H);
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) {
      const t=B.terrain[y][x], px=x*TILE, py=y*TILE, n=hash2(x,y,g.seed);
      if(t===WATER||t===FORD) continue;
      if(t===1||t===2) {
        const shade=ctx.createRadialGradient(px+TILE*.5,py+TILE*.6,TILE*.08,px+TILE*.5,py+TILE*.6,TILE*.7);
        shade.addColorStop(0,t===1?'rgba(16,47,32,.22)':'rgba(53,54,40,.16)');shade.addColorStop(1,'rgba(20,40,26,0)');ctx.fillStyle=shade;
        ctx.fillRect(px,py,TILE,TILE);
      }
      if(t===0) {
        for(let i=0;i<5;i++) {
          const gx=px+TILE*(.1+hash2(x+i,y,3.1)*.8), gy=py+TILE*(.15+hash2(x,y+i,4.3)*.75);
          ctx.strokeStyle=i%2?'rgba(211,223,167,.20)':'rgba(34,59,36,.22)';ctx.lineWidth=Math.max(.7,TILE*.014);
          ctx.beginPath();ctx.moveTo(gx,gy);ctx.lineTo(gx+TILE*.035,gy-TILE*.055);ctx.stroke();
        }
      }
    }
    // Contour lines follow whole ridges, tying individual mountain symbols together.
    g.ridges.forEach(r=>{
      ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
      [1.5,1,.6].forEach((k,i)=>{geoLine(r.pts);ctx.strokeStyle=['rgba(27,39,30,.07)','rgba(27,39,30,.10)','rgba(24,34,26,.12)'][i];ctx.lineWidth=r.w*TILE*k;ctx.stroke();});
      ctx.restore();
    });
  }

  /* 하나로 이어진 강안 다각형. 수면·연안선·물결 모두 같은 도형을 사용한다. */
  function drawWater(W, H) {
    const g=B.geo, bodies=g.rivers.concat(g.lakes);
    if(!bodies.length) return;
    // Fill all bodies first so confluences have no seam across the channel.
    bodies.forEach(r=>{geoPath(r.polygon);ctx.fillStyle='#293d34';ctx.fill();ctx.strokeStyle='rgba(25,37,29,.65)';ctx.lineWidth=TILE*.13;ctx.lineJoin='round';ctx.stroke();});
    bodies.forEach(r=>{geoPath(r.polygon);ctx.fillStyle=lg(0,0,W,H,[[0,'#608b8a'],[.5,g.palette.water],[1,'#254d59']]);ctx.fill();});
    ctx.save();
    ctx.beginPath();
    bodies.forEach(r=>{r.polygon.forEach((p,i)=>{if(i)ctx.lineTo(p[0]*TILE,p[1]*TILE);else ctx.moveTo(p[0]*TILE,p[1]*TILE);});ctx.closePath();});
    ctx.clip();
    // Skip the banks submerged by another river/lake at a confluence.
    const shoreLine=(pts,body)=>{
      ctx.beginPath();let pen=false;
      pts.forEach(p=>{
        if(bodies.some(other=>other!==body&&BattleTerrain.inside(p[0],p[1],other.polygon))) {pen=false;return;}
        if(pen)ctx.lineTo(p[0]*TILE,p[1]*TILE);else ctx.moveTo(p[0]*TILE,p[1]*TILE);
        pen=true;
      });
    };
    // Banks follow the flowing centerline, never the outline of individual squares.
    g.rivers.forEach(r=>{
      [r.left,r.right].forEach(bank=>{shoreLine(bank,r);ctx.strokeStyle='rgba(195,206,164,.42)';ctx.lineWidth=TILE*.085;ctx.stroke();
        shoreLine(bank,r);ctx.strokeStyle='rgba(205,230,215,.38)';ctx.lineWidth=Math.max(.8,TILE*.018);ctx.stroke();});
      shoreLine(r.pts,r);ctx.strokeStyle='rgba(12,58,72,.24)';ctx.lineWidth=r.w*TILE*.36;ctx.stroke();
      for(let i=3;i<r.pts.length-3;i+=7) {
        const a=r.pts[i-2], b=r.pts[i+2], p=r.pts[i], dx=b[0]-a[0], dy=b[1]-a[1], len=Math.hypot(dx,dy)||1;
        const off=(hash2(i,g.seed,2)-.5)*r.w*.55, nx=-dy/len*off, ny=dx/len*off;
        ctx.strokeStyle='rgba(192,224,216,.25)';ctx.lineWidth=Math.max(.7,TILE*.013);
        ctx.beginPath();ctx.moveTo((p[0]+nx-dx/len*.2)*TILE,(p[1]+ny-dy/len*.2)*TILE);
        ctx.lineTo((p[0]+nx+dx/len*.25)*TILE,(p[1]+ny+dy/len*.25)*TILE);ctx.stroke();
      }
    });
    g.lakes.forEach(l=>{
      shoreLine(l.polygon.concat([l.polygon[0]]),l);ctx.strokeStyle='rgba(192,210,172,.45)';ctx.lineWidth=TILE*.07;ctx.stroke();
      for(let y=0;y<ROWS;y+=.42) for(let x=0;x<COLS;x+=.9) if(BattleTerrain.inside(x,y,l.polygon)) {
        ctx.strokeStyle='rgba(187,220,217,.17)';ctx.lineWidth=Math.max(.8,TILE*.012);
        ctx.beginPath();ctx.moveTo((x+.1)*TILE,y*TILE);ctx.lineTo((x+.43)*TILE,(y-.035)*TILE);ctx.stroke();
      }
    });
    ctx.restore();
    // A tiny center marker makes the passability of partly flooded tiles unambiguous.
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) if(B.terrain[y][x]===WATER) {
      ctx.strokeStyle='rgba(189,222,219,.26)';ctx.lineWidth=Math.max(.8,TILE*.013);
      ctx.beginPath();ctx.moveTo((x+.44)*TILE,(y+.5)*TILE);ctx.lineTo((x+.56)*TILE,(y+.5)*TILE);ctx.stroke();
    }
  }

  function drawProps() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = B.terrain[y][x], px = x * TILE, py = y * TILE;
        if (t === 1) drawForest(px, py, x, y);
        else if (t === 2) drawMountain(px, py, x, y);
        // 성곽은 점령 시 깃발이 바뀌므로 정적 배경과 분리해 그린다.
        else if (t === FORD) drawFord(px, py, x, y);
      }
    }
    B.geo.edgeFords.forEach(c=>drawFordBed(
      (c.from.x+c.to.x+1)*TILE*.5,(c.from.y+c.to.y+1)*TILE*.5,
      c.axis==='x',-.6,.6,c.from.x,c.from.y));
  }

  // 장식은 통행 판정을 바꾸지 않고 부대보다 낮은 대비로 그린다.
  function drawScenery() {
    const g=B.geo, style=g.style;
    drawCultivatedGround();
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) {
      if(B.terrain[y][x]!==0) continue;
      const n=hash2(x,y,g.seed), px=(x+.5)*TILE, py=(y+.5)*TILE;
      ctx.save();ctx.translate(px+TILE*(n-.5)*.16,py+TILE*(hash2(y,x,g.seed)-.5)*.13);ctx.rotate(style.angle+(n-.5)*.35);
      if(style.surface==='orchard' && n>.72) {
        for(let i=0;i<4;i++) drawTree((hash2(x+i,y,g.seed)-.5)*TILE*.65,(hash2(x,y+i,g.seed)-.5)*TILE*.55,TILE*(.1+n*.05));
      } else if(style.surface==='dunes' || style.surface==='sandbars') {
        ctx.strokeStyle='rgba(227,202,141,.25)';ctx.lineWidth=TILE*.024;
        for(let i=0;i<2+Math.floor(n*3);i++){const shift=(n-.5)*TILE*.3;ctx.beginPath();ctx.moveTo(-TILE*(.22+n*.18),TILE*(i*.1-.15)+shift);ctx.bezierCurveTo(-TILE*.15,TILE*(i*.1-.3),TILE*.08,TILE*(i*.1-.27),TILE*(.25+n*.16),TILE*(i*.1-.12)+shift);ctx.stroke();}
        if(n>.7){ctx.fillStyle='#6b684d';ctx.fillRect(-TILE*.12,0,TILE*.18,TILE*.05);}
      } else if(style.surface==='ruins' && n>.55) {
        ctx.fillStyle='rgba(178,153,113,.45)';
        for(let i=0;i<4;i++)ctx.fillRect(TILE*(-.3+i*.16),TILE*(i%2*.1),TILE*.13,TILE*.1);
      } else {
        ctx.strokeStyle='rgba(180,190,137,.33)';ctx.lineWidth=Math.max(1,TILE*.02);
        for(let i=0;i<8;i++){const a=hash2(x+i,y,9)*TILE*.8-TILE*.4,b=hash2(x,y+i,6)*TILE*.65-TILE*.3;ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(a+TILE*.025,b-TILE*(style.surface==='reeds'?.18:.06));ctx.stroke();}
      }
      // 작은 농가 군락. 도시마다 다른 위치, 남방 기와·북방 토벽을 구분한다.
      if(n>.88 && x>1 && x<11) {
        const s=TILE*.21;
        for(let i=0;i<2+(g.scale.rank===3?1:0);i++) {
          const bx=(i-1)*s, by=(i%2)*s*.7;
          ctx.fillStyle=style.wall==='earth'?'#a38c65':'#a8afa0';ctx.fillRect(bx,by,s*.7,s*.55);
          ctx.fillStyle=style.wall==='earth'?'#62533b':'#394c4b';ctx.beginPath();ctx.moveTo(bx-s*.1,by);ctx.lineTo(bx+s*.35,by-s*.35);ctx.lineTo(bx+s*.85,by);ctx.closePath();ctx.fill();
          ctx.fillStyle='#374336';ctx.fillRect(bx+s*.25,by+s*.2,s*.15,s*.35);
        }
      }
      ctx.restore();
    }
  }

  function drawCultivatedGround() {
    const g=B.geo, wet=g.style.surface==='paddy', terrace=g.style.surface==='terraces';
    g.fields.forEach(f=>{
      const outline=()=>{
        const P=f.pts, last=P[P.length-1],first=P[0];
        ctx.beginPath();ctx.moveTo((last[0]+first[0])*.5*TILE,(last[1]+first[1])*.5*TILE);
        P.forEach((p,i)=>{const q=P[(i+1)%P.length];ctx.quadraticCurveTo(p[0]*TILE,p[1]*TILE,(p[0]+q[0])*.5*TILE,(p[1]+q[1])*.5*TILE);});ctx.closePath();
      };
      ctx.save();outline();
      const color=lg((f.x-1)*TILE,(f.y-1)*TILE,(f.x+1)*TILE,(f.y+1)*TILE,wet?
        [[0,'rgba(139,169,133,.12)'],[.45,'rgba(120,164,144,.28)'],[1,'rgba(81,125,99,.08)']]:
        [[0,'rgba(204,181,108,.08)'],[.5,'rgba(180,163,92,.23)'],[1,'rgba(161,154,94,.06)']]);
      ctx.fillStyle=color;ctx.fill();
      ctx.strokeStyle=wet?'rgba(185,192,140,.26)':'rgba(155,155,104,.16)';ctx.lineWidth=TILE*.022;ctx.stroke();
      ctx.clip();ctx.translate(f.x*TILE,f.y*TILE);ctx.rotate(f.angle);
      // 얇은 논둑과 작물 줄만 남기고 네모 테두리·판 모양 그림자를 없앤다.
      for(let k=-10;k<=10;k++) {
        const y=k*TILE*.14, bend=TILE*(terrace?.38:.1),off=Math.sin(k*.45+f.seed)*TILE*.06;
        ctx.beginPath();ctx.moveTo(-TILE*2,y+off);
        ctx.bezierCurveTo(-TILE*.65,y-bend,TILE*.65,y-bend*.6,TILE*2,y+off*.5);
        ctx.strokeStyle=k%3===0?(wet?'rgba(203,204,151,.40)':'rgba(207,188,123,.30)'):(wet?'rgba(72,113,75,.35)':'rgba(89,109,59,.27)');
        ctx.lineWidth=Math.max(.65,TILE*(k%3===0?.018:.011));ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawRiverNames() {
    B.geo.rivers.forEach(r=>{
      const candidates=r.pts.filter(p=>p[0]>1&&p[0]<COLS-1&&p[1]>.8&&p[1]<ROWS-.8);
      const p=candidates[Math.floor(candidates.length*.6)];
      if(!p) return;
      ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font='600 '+Math.max(10,Math.round(TILE*.16))+'px "Malgun Gothic"';
      ctx.lineWidth=3;ctx.strokeStyle='rgba(26,61,66,.7)';ctx.strokeText(r.name,p[0]*TILE,p[1]*TILE);
      ctx.fillStyle='rgba(224,236,219,.85)';ctx.fillText(r.name,p[0]*TILE,p[1]*TILE);ctx.restore();
    });
  }

  function drawTree(px, py, s) {
    const kind=B.geo.style.tree;
    if(kind==='pine' || kind==='poplar' || kind==='bamboo' || kind==='willow') {
      ctx.fillStyle='rgba(5,24,19,.23)';ctx.beginPath();ctx.ellipse(px+s*.2,py+s*.6,s*.65,s*.2,0,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#73634b';ctx.lineWidth=Math.max(1,s*.12);ctx.beginPath();ctx.moveTo(px,py+s*.6);ctx.lineTo(px,py-s*.7);ctx.stroke();
      if(kind==='pine') {
        for(let i=0;i<3;i++){const h=py-s*(.95-i*.34),w=s*(.35+i*.17);ctx.fillStyle=['#64826d','#446b59','#305744'][i];ctx.beginPath();ctx.moveTo(px,h);ctx.lineTo(px+w,h+s*.58);ctx.lineTo(px-w,h+s*.58);ctx.closePath();ctx.fill();}
      } else if(kind==='bamboo') {
        for(let i=-1;i<=1;i++){ctx.strokeStyle='#8d9d61';ctx.lineWidth=Math.max(1,s*.07);ctx.beginPath();ctx.moveTo(px+i*s*.2,py+s*.6);ctx.lineTo(px+i*s*.14,py-s*.9);ctx.stroke();
          for(let j=0;j<4;j++){const yy=py-s*.7+j*s*.26;ctx.strokeStyle=j%2?'#76915c':'#3d7050';ctx.beginPath();ctx.moveTo(px+i*s*.15,yy);ctx.lineTo(px+(i*s*.15)+(j%2?1:-1)*s*.45,yy-s*.2);ctx.stroke();}}
      } else {
        ctx.fillStyle=kind==='poplar'?'#879561':'#618868';ctx.beginPath();ctx.ellipse(px,py-s*.22,s*(kind==='poplar'?.38:.8),s*(kind==='poplar'?1:.6),0,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle='rgba(34,68,40,.45)';ctx.lineWidth=s*.06;
        for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(px+i*s*.18,py-s*.45);ctx.quadraticCurveTo(px+i*s*.28,py,px+i*s*.23,py+s*(kind==='willow'?.55:.12));ctx.stroke();}
      }
      return;
    }
    /* 그림자 · 줄기 */
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(px + s * 0.2, py + s * 0.76, s * 0.72, s * 0.26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a3a26';
    ctx.fillRect(px - s * 0.08, py + s * 0.1, s * 0.16, s * 0.64);
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(px + s * 0.02, py + s * 0.1, s * 0.06, s * 0.64);
    /* 비대칭 수관과 면 단위 명암 — 같은 원을 층층이 쌓는 나무를 피한다. */
    const n=hash2(px/TILE,py/TILE,B.geo.seed), crown=[];
    for(let i=0;i<9;i++) {
      const a=i/9*Math.PI*2, r=s*(.48+hash2(i,n,3.1)*.16);
      crown.push([px+Math.cos(a)*r,py-s*.23+Math.sin(a)*r*.95]);
    }
    const crownPath=()=>{ctx.beginPath();crown.forEach((p,i)=>{if(i)ctx.lineTo(p[0],p[1]);else ctx.moveTo(p[0],p[1]);});ctx.closePath();};
    crownPath();ctx.fillStyle=lg(px-s*.5,py-s*.8,px+s*.4,py+s*.4,[[0,'#69875a'],[.45,'#3c6845'],[1,'#244937']]);ctx.fill();
    ctx.save();crownPath();ctx.clip();
    ctx.beginPath();ctx.moveTo(px-s*.7,py-s*.23);ctx.lineTo(px+s*.1,py-s*.06);ctx.lineTo(px+s*.5,py+s*.45);ctx.lineTo(px-s*.7,py+s*.45);ctx.closePath();
    ctx.fillStyle='rgba(20,52,35,.25)';ctx.fill();ctx.restore();
  }
  function drawForest(px, py, x, y) {
    const count=3+Math.floor(hash2(x,y,B.geo.seed)*3);
    for (let i = 0; i < count; i++) {
      const hx = hash2(x * 3 + i, y * 5, B.geo.seed), hy = hash2(x * 7, y * 3 + i, B.geo.seed+1);
      drawTree(px + TILE * (0.24 + hx * 0.52), py + TILE * (0.28 + hy * 0.46),
        TILE * (0.18 + hash2(x + i, y, B.geo.seed+2) * 0.16));
    }
  }

  function drawMountain(px, py, x, y) {
    const n = hash2(x, y, B.geo.seed);
    const elevation=B.geo.elevation[y][x];
    const peaks = elevation>.55 ? [[0.28,0.88,0.53,0.3],[0.73,0.9,0.43,0.25],[0.52,0.82,0.7,0.3]] : [[0.3,0.86,0.33,0.3],[0.66,0.88,0.43,0.34]];
    peaks.forEach((p, i) => {
      const cx = px + TILE * (p[0] + (n - 0.5) * 0.05);
      const by = py + TILE * p[1];
      const h = TILE * p[2] * (.65 + elevation * .35);
      const w = TILE * (p[3] + ((n + i * 0.3) % 0.14));
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(cx, by, w * 1.05, TILE * 0.07, 0, 0, Math.PI * 2); ctx.fill();
      const tip=cx+w*(n-.5)*.45;
      ctx.beginPath();
      ctx.moveTo(cx-w,by);ctx.lineTo(cx-w*.71,by-h*.28);ctx.lineTo(cx-w*.48,by-h*(.46+n*.19));
      ctx.lineTo(tip-w*.13,by-h*.77);ctx.lineTo(tip,by-h);ctx.lineTo(tip+w*.26,by-h*.69);
      ctx.lineTo(cx+w*.56,by-h*(.33+n*.13));ctx.lineTo(cx+w,by);
      ctx.closePath();
      ctx.fillStyle = lg(cx - w, by, cx + w, by - h, [[0, B.geo.style.rockDark], [0.45, B.geo.style.rockLight], [1, B.geo.style.rockDark]]);
      ctx.fill();
      ctx.beginPath();ctx.moveTo(tip,by-h);ctx.lineTo(tip-w*.1,by-h*.65);ctx.lineTo(cx-w*.3,by-h*.24);ctx.lineTo(cx-w*.65,by);ctx.lineTo(cx-w,by);ctx.closePath();
      ctx.fillStyle='rgba(220,222,182,.15)';ctx.fill();
      ctx.beginPath();ctx.moveTo(tip+w*.26,by-h*.69);ctx.lineTo(cx+w*.1,by-h*.29);ctx.lineTo(cx+w*.35,by);ctx.lineTo(cx+w,by);ctx.closePath();ctx.fillStyle='rgba(24,41,34,.19)';ctx.fill();
      /* 능선 하이라이트 */
      ctx.beginPath();
      ctx.moveTo(cx, by - h);
      ctx.lineTo(cx - w * 0.16, by - h * 0.34);
      ctx.lineTo(cx + w * 0.2, by - h * 0.52);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, by - h);
      ctx.lineTo(cx - w * 0.58, by - h * 0.04);
      ctx.strokeStyle = 'rgba(240,246,236,.16)';
      ctx.lineWidth = Math.max(1, TILE * 0.018);
      ctx.stroke();
      if(B.geo.style.surface==='cliffs' || B.geo.theme==='loess') {
        ctx.strokeStyle='rgba(226,219,189,.23)';ctx.lineWidth=Math.max(.7,TILE*.014);
        for(let j=1;j<5;j++){const yy=by-h*j*.16,ww=w*(1-j*.16);ctx.beginPath();ctx.moveTo(cx-ww,yy);ctx.lineTo(cx+ww,yy+TILE*.02);ctx.stroke();}
      }
      /* 바위 결 */
      ctx.strokeStyle = 'rgba(18,22,18,.18)';
      ctx.lineWidth = Math.max(1, TILE * 0.014);
      ctx.beginPath();
      ctx.moveTo(cx + w * 0.18, by - h * 0.08);
      ctx.lineTo(cx + w * 0.42, by - h * 0.42);
      ctx.stroke();
    });
  }

  function drawFort(px, py, owner) {
    const s = TILE;
    const rank=B.geo.scale.rank, factor=.65+rank*.115;
    ctx.save();ctx.translate(px+s*.5,py+s*.88);ctx.scale(factor,factor);ctx.translate(-px-s*.5,-py-s*.88);
    // 점령한 편의 깃발 색 — 공격측이 차지하면 아군 색으로 바뀐다
    const side = owner === 'atk' ? 'atk' : 'def';
    const flag = ((B && B.opts && B.opts[side]) || {}).color || (side === 'atk' ? '#4a6fd6' : '#9a5a5a');
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(px + s * 0.06, py + s * 0.22, s * 0.9, s * 0.72);
    /* 성벽 본체 */
    ctx.fillStyle = lg(px, py + s * 0.2, px, py + s * 0.92, [[0, '#736146'], [0.55, '#5c4e37'], [1, '#3a3226']]);
    ctx.fillRect(px + s * 0.1, py + s * 0.24, s * 0.8, s * 0.66);
    /* 돌 결 — 가로 줄눈과 세로 이음 */
    ctx.strokeStyle = 'rgba(24,20,14,.28)'; ctx.lineWidth = Math.max(1, s * 0.014);
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(px + s * 0.1, py + s * (0.24 + i * 0.165));
      ctx.lineTo(px + s * 0.9, py + s * (0.24 + i * 0.165));
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(222,206,172,.13)';
    for (let i = 0; i < 5; i++) {
      const jx = px + s * (0.16 + i * 0.16);
      ctx.beginPath();
      ctx.moveTo(jx, py + s * 0.28);
      ctx.lineTo(jx, py + s * 0.86);
      ctx.stroke();
    }
    /* 여장 */
    ctx.fillStyle = '#7d6a4b';
    for (let i = 0; i < 4; i++) ctx.fillRect(px + s * (0.12 + i * 0.2), py + s * 0.16, s * 0.12, s * 0.1);
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    for (let i = 0; i < 4; i++) ctx.fillRect(px + s * (0.12 + i * 0.2), py + s * 0.16, s * 0.12, s * 0.025);
    /* 성문 */
    ctx.fillStyle = '#14110c';
    ctx.beginPath();
    ctx.moveTo(px + s * 0.38, py + s * 0.9);
    ctx.lineTo(px + s * 0.38, py + s * 0.58);
    ctx.quadraticCurveTo(px + s * 0.5, py + s * 0.44, px + s * 0.62, py + s * 0.58);
    ctx.lineTo(px + s * 0.62, py + s * 0.9);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(230,195,124,.18)';
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.stroke();
    /* 성문 안쪽에서 새어 나오는 불빛 */
    ctx.fillStyle = 'rgba(240,196,110,.09)';
    ctx.beginPath();
    ctx.moveTo(px + s * 0.43, py + s * 0.88);
    ctx.lineTo(px + s * 0.43, py + s * 0.62);
    ctx.quadraticCurveTo(px + s * 0.5, py + s * 0.53, px + s * 0.57, py + s * 0.62);
    ctx.lineTo(px + s * 0.57, py + s * 0.88);
    ctx.closePath(); ctx.fill();
    // 성벽 아래 소유 표시 띠 — 어느 편 깃발인지 한눈에 보이게
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = flag;
    ctx.fillRect(px + s * 0.1, py + s * 0.85, s * 0.8, s * 0.055);
    ctx.restore();
    // 깃대
    ctx.strokeStyle = '#8a7350'; ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.beginPath(); ctx.moveTo(px + s * 0.78, py + s * 0.18); ctx.lineTo(px + s * 0.78, py - s * 0.02); ctx.stroke();
    // 깃발 — 점령한 편의 색으로 펄럭인다
    ctx.fillStyle = flag;
    ctx.beginPath();
    ctx.moveTo(px + s * 0.79, py - s * 0.02);
    ctx.quadraticCurveTo(px + s * 0.9, py + s * 0.005, px + s * 0.99, py + s * 0.04);
    ctx.lineTo(px + s * 0.79, py + s * 0.1);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = Math.max(1, s * 0.014);
    ctx.stroke();
    /* 깃발 하이라이트 — 바람에 접힌 부분 */
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath();
    ctx.moveTo(px + s * 0.79, py - s * 0.015);
    ctx.quadraticCurveTo(px + s * 0.88, py + s * 0.008, px + s * 0.96, py + s * 0.035);
    ctx.lineTo(px + s * 0.79, py + s * 0.045);
    ctx.closePath(); ctx.fill();
    // 중·대도시는 기와 누각, 대도시는 양쪽 망루까지 갖춘다.
    if(rank>=2) {
      const tower=(cx,yy,w)=>{
        ctx.fillStyle=B.geo.style.wall==='earth'?'#a5885c':'#9aa18d';ctx.fillRect(cx-w*.6,yy,w*1.2,s*.14);
        ctx.fillStyle=B.geo.style.wall==='earth'?'#5c4934':'#314e4c';ctx.beginPath();ctx.moveTo(cx-w,yy);ctx.lineTo(cx,yy-s*.13);ctx.lineTo(cx+w,yy);ctx.closePath();ctx.fill();
        ctx.strokeStyle='#c8ba8d';ctx.lineWidth=s*.015;ctx.stroke();
      };
      tower(px+s*.5,py+s*.14,s*.28);
      if(rank===3){tower(px+s*.14,py+s*.24,s*.17);tower(px+s*.86,py+s*.24,s*.17);tower(px+s*.5,py+s*.03,s*.19);}
    }
    ctx.restore();
  }

  function drawFord(px, py, x, y) {
    const route=B.geo.crossings.find(c=>c.cells.some(p=>p.x===x&&p.y===y));
    const crossing=(xx,yy)=>yy>=0&&yy<ROWS&&xx>=0&&xx<COLS&&B.terrain[yy][xx]===FORD;
    const dry=(xx,yy)=>yy>=0&&yy<ROWS&&xx>=0&&xx<COLS&&B.terrain[yy][xx]!==WATER;
    const horizontal=route ? route.axis==='x' : crossing(x-1,y)||crossing(x+1,y)||(!crossing(x,y-1)&&!crossing(x,y+1)&&dry(x-1,y)&&dry(x+1,y));
    const index=route ? route.cells.findIndex(p=>p.x===x&&p.y===y) : -1;
    const start=route&&index===0?-1:-.5, end=route&&index===route.cells.length-1?1:.5;
    drawFordBed(px+TILE*.5,py+TILE*.5,horizontal,start,end,x,y);
  }

  function drawFordBed(cx, cy, horizontal, start, end, x, y) {
    ctx.save();
    // The shallow bed reaches both banks, but its paint stays inside the actual water outline.
    ctx.beginPath();
    B.geo.rivers.concat(B.geo.lakes).forEach(r=>{
      r.polygon.forEach((p,i)=>{if(i)ctx.lineTo(p[0]*TILE,p[1]*TILE);else ctx.moveTo(p[0]*TILE,p[1]*TILE);});ctx.closePath();
    });
    ctx.clip();ctx.translate(cx,cy);
    if(!horizontal) ctx.rotate(Math.PI/2);
    const bed=lg(0,-TILE*.26,0,TILE*.26,[[0,'rgba(134,171,154,0)'],[.25,'rgba(156,181,151,.27)'],[.52,'rgba(189,190,147,.52)'],[.78,'rgba(145,176,152,.25)'],[1,'rgba(134,171,154,0)']]);
    ctx.fillStyle=bed;
    ctx.beginPath();ctx.moveTo(start*TILE,-TILE*.23);
    ctx.bezierCurveTo(-TILE*.2,-TILE*.34,TILE*.12,-TILE*.15,end*TILE,-TILE*.23);
    ctx.lineTo(end*TILE,TILE*.23);
    ctx.bezierCurveTo(TILE*.13,TILE*.3,-TILE*.16,TILE*.16,start*TILE,TILE*.23);
    ctx.closePath();ctx.fill();
    // Submerged gravel varies in size, spacing and direction; there is no deck or railing.
    const count=Math.ceil((end-start)*9);
    for(let i=0;i<count;i++) {
      const n=hash2(x*17+i,y*13,B.geo.seed), m=hash2(y+i,x,6.3);
      const sx=TILE*(start+(i+.2+n*.55)/count*(end-start)), sy=TILE*(m-.5)*.26;
      const size=TILE*(.018+n*.025);
      ctx.beginPath();
      for(let k=0;k<6;k++) {
        const a=k/6*Math.PI*2, radius=size*(.7+hash2(i,k,x+y)*.5);
        const xx=sx+Math.cos(a)*radius, yy=sy+Math.sin(a)*radius*.65;
        if(k)ctx.lineTo(xx,yy);else ctx.moveTo(xx,yy);
      }
      ctx.closePath();ctx.fillStyle=n>.55?'rgba(207,202,163,.78)':'rgba(152,165,139,.72)';ctx.fill();
      if(n>.45) {
        ctx.beginPath();ctx.moveTo(sx-size*1.8,sy+size);ctx.quadraticCurveTo(sx,sy+size*1.5,sx+size*1.6,sy+size*.6);
        ctx.strokeStyle='rgba(219,235,216,.4)';ctx.lineWidth=Math.max(.6,TILE*.01);ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawGrid(W, H) {
    ctx.save();
    /* 음각 격자 */
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(x * TILE + 0.5, 0); ctx.lineTo(x * TILE + 0.5, H); ctx.stroke(); }
    for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * TILE + 0.5); ctx.lineTo(W, y * TILE + 0.5); ctx.stroke(); }
    /* 양각 격자 — 어두운 바탕에서도 칸이 또렷하게 */
    ctx.strokeStyle = 'rgba(212,232,206,.055)';
    for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(x * TILE + 1.5, 0); ctx.lineTo(x * TILE + 1.5, H); ctx.stroke(); }
    for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * TILE + 1.5); ctx.lineTo(W, y * TILE + 1.5); ctx.stroke(); }
    /* 테두리 — 이중 금선 + 모서리 장식 */
    ctx.strokeStyle = 'rgba(230,195,124,.24)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.strokeStyle = 'rgba(230,195,124,.12)'; ctx.lineWidth = 1;
    ctx.strokeRect(5.5, 5.5, W - 11, H - 11);
    ctx.strokeStyle = 'rgba(240,214,158,.55)'; ctx.lineWidth = 2;
    const c = 18, m = 3;
    [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(k => {
      ctx.beginPath();
      ctx.moveTo(k[0] + k[2] * 0, k[1] + k[3] * c);
      ctx.lineTo(k[0], k[1]);
      ctx.lineTo(k[0] + k[2] * c, k[1] + k[3] * 0);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawUnit(u) {
    // 카드·글자·게이지를 한 배율로 묶어 축소 (진형 실루엣 장식까지 함께 줄어든다)
    const k = TILE / 54 * CARD_FIT;
    const ap = animPos(u);                  // 이동 중이면 화면 좌표를 보간한다
    const px = (ap ? ap.x : u.x) * TILE + TILE / 2, py = (ap ? ap.y : u.y) * TILE + TILE / 2;
    const mine = u.side === B.playerSide;
    const CW = 46 * k, CH = 46 * k, cx = px - CW / 2, cy = py - CH / 2;
    const form = FORMS[u.form] ? u.form : '어린';        // 진형마다 카드 생김새가 다르다
    // 성(성곽) 위에 선 부대 — 성벽에 묻혀도 테두리로 '성 안'임을 알린다
    const inFort = !!fortAt(u.x, u.y);
    ctx.save();
    // 피격 중에는 카드가 좌우로 흔들린다
    const hit = fxHit(u);
    if (hit >= 0) ctx.translate(Math.sin(hit * Math.PI * 7) * (1 - hit) * 4 * k, 0);
    // 전멸 직전 — 연출이 마무리 될 때 카드가 옅어지며 사라진다
    if (u.dying) {
      const q = cl((fnow() - (u.dyingAt || 0)) / Math.max(1, u.dyingDur || 1), 0, 1);
      ctx.globalAlpha = Math.max(0.12, 1 - 0.88 * cl((q - 0.55) / 0.45, 0, 1));
    }
    /* 접지 그림자 + 카드 그림자 */
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.beginPath();
    if (ctx.ellipse) ctx.ellipse(px, py + CH * 0.42, CW * 0.58, CH * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // 이동 중 발밑에서 일어나는 흙먼지 — 그림자처럼 지면에 남는다
    if (ap) {
      for (let i = 0; i < 3; i++) {
        const back = TILE * (0.15 + i * 0.12) * (1 - ap.q * 0.35);
        const jx = (hash2(i, ap.q * 17, 3.1) - 0.5) * TILE * 0.16;
        const jy = (hash2(i, ap.q * 11, 1.7) - 0.5) * TILE * 0.1;
        ctx.fillStyle = 'rgba(206,198,170,' + (0.18 * (1 - ap.q)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(px - ap.dx * back + jx, py + TILE * 0.26 - ap.dy * back + jy,
          TILE * (0.055 + i * 0.03), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,.38)';
    formPath(ctx, form, cx + 1 * k, cy + 3 * k, CW, CH, 0); ctx.fill();
    if (B.sel === u) {
      formPath(ctx, form, cx, cy, CW, CH, 3 * k);
      ctx.strokeStyle = 'rgba(255,233,168,.20)'; ctx.lineWidth = 4.5 * k; ctx.stroke();
      ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 1.3 * k; ctx.stroke();
    }
    /* 카드 본체 — 위에서 빛을 받는 금속판 */
    formPath(ctx, form, cx, cy, CW, CH, 0);
    ctx.fillStyle = lg(cx, cy, cx, cy + CH, [[0, '#1a2a1f'], [0.45, '#0f1a13'], [1, '#070d09']]);
    ctx.fill();
    ctx.strokeStyle = u.color; ctx.lineWidth = 2 * k; ctx.stroke();
    // 가는 안쪽 하이라이트가 외곽의 곡면을 살린다.
    formPath(ctx, form, cx + 1.8 * k, cy + 1.8 * k, CW - 3.6 * k, CH - 3.6 * k, 0);
    ctx.strokeStyle = 'rgba(235,243,225,.12)'; ctx.lineWidth = 0.65 * k; ctx.stroke();
    if (inFort) {
      /* 성 안(강화) 표시 — 실루엣 바깥에 금빛 점선 테두리를 두른다 */
      ctx.save();
      formPath(ctx, form, cx, cy, CW, CH, 3.5 * k);
      ctx.strokeStyle = 'rgba(255,206,120,.16)';
      ctx.lineWidth = 5 * k; ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([4.6 * k, 3 * k]);
      ctx.strokeStyle = '#ffd479';
      ctx.lineWidth = 2.2 * k; ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.restore();
      // 城 패 — 카드 아래 왼쪽 모서리에 달아 한눈에 알아보게 한다
      const fr = 6.2 * k, fx = cx + CW * 0.13, fy = cy + CH + 1 * k;
      ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,16,12,.94)'; ctx.fill();
      ctx.strokeStyle = '#ffd479'; ctx.lineWidth = 1.4 * k; ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + (7.4 * k).toFixed(1) + 'px "Batang","바탕",serif';
      ctx.fillStyle = '#ffd479';
      ctx.fillText('城', fx, fy + 0.4 * k);
    }
    /* 세력 띠 + 유리 광택 */
    ctx.save();
    formPath(ctx, form, cx, cy, CW, CH, 0);
    if (ctx.clip) ctx.clip();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = u.color;
    ctx.fillRect(cx, cy, CW, 2.4 * k);
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = u.color;
    ctx.fillRect(cx, cy, CW, CH * 0.55);
    ctx.globalAlpha = 1;
    ctx.fillStyle = lg(cx, cy, cx, cy + CH * 0.6, [[0, 'rgba(255,255,255,.10)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fillRect(cx, cy, CW, CH * 0.6);
    ctx.restore();
    /* 상단 명판 */
    pRound(ctx, cx + 2.6 * k, cy + 5.5 * k, CW - 5.2 * k, CH * 0.4, 7 * k);
    ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    /* 병종 표식 — 작은 원 안의 한자 */
    const brk = 5.6 * k, brx = cx + 9 * k, bry = cy + 9.5 * k;
    ctx.beginPath(); ctx.arc(brx, bry, brk, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,14,10,.92)'; ctx.fill();
    ctx.strokeStyle = 'rgba(230,195,124,.45)'; ctx.lineWidth = 1 * k; ctx.stroke();
    const ic = u.branch === '기병' ? '騎' : (u.branch === '궁병' ? '弓' : '步');
    ctx.font = 'bold ' + (7.8 * k).toFixed(1) + 'px "Batang","바탕",serif';
    ctx.fillStyle = '#e6c37c';
    ctx.fillText(ic, brx, bry + 0.4 * k);

    /* 진형 표식 — 카드 안쪽에 넣어 윤곽과 겹치는 돌출부를 없앤다. */
    const look = formLook(form);
    const tw = 13 * k, th = 8.6 * k;
    const tx = cx + CW - tw - 4 * k, ty = cy + 4.5 * k;
    pRound(ctx, tx, ty, tw, th, 3.4 * k);
    ctx.fillStyle = 'rgba(10,16,12,.92)'; ctx.fill();
    ctx.strokeStyle = look.tint; ctx.lineWidth = 1.2 * k; ctx.stroke();
    ctx.font = 'bold ' + (7.4 * k).toFixed(1) + 'px "Batang","바탕",serif';
    ctx.fillStyle = look.tint;
    ctx.fillText(look.glyph, tx + tw / 2, ty + th * 0.58);
    if (u.confused > 0 || u.confusedNow) {
      ctx.font = (9 * k).toFixed(1) + 'px sans-serif'; ctx.fillStyle = '#ffc2e0';
      ctx.fillText('✳', cx + 22 * k, cy + 9.5 * k);
    }
    // 화상 표식 — 불화살에 맞아 아직 타고 있는 부대
    if (u.burn > 0) {
      ctx.font = 'bold ' + (9 * k).toFixed(1) + 'px "Batang","바탕",serif';
      ctx.fillStyle = '#ff9d5c';
      ctx.fillText('火', cx + 7 * k, cy + CH - 7 * k);
    }
    /* 이름 · 병력 */
    ctx.font = 'bold ' + (11 * k).toFixed(1) + 'px "Malgun Gothic"';
    ctx.fillStyle = mine ? '#ffffff' : '#f0e9d8';
    ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 2.4 * k;
    ctx.fillText(u.name, px, py - 4.5 * k, CW - 6 * k);
    ctx.font = 'bold ' + (10 * k).toFixed(1) + 'px "Malgun Gothic"';
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(commas(u.troops), px, py + 6 * k);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    /* 병력·사기 게이지 */
    const bw = 30 * k, bx = px - bw / 2;
    const hp = cl(u.troops / u.max, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    pRound(ctx, bx - 0.7 * k, py + 11.3 * k, bw + 1.4 * k, 4.9 * k, 2.5 * k); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    pRound(ctx, bx, py + 12 * k, bw, 3.5 * k, 2 * k); ctx.fill();
    ctx.fillStyle = hp > 0.5 ? '#7fc08d' : (hp > 0.25 ? '#e3b75f' : '#ef8b78');
    pRound(ctx, bx, py + 12 * k, Math.max(1, bw * hp), 3.5 * k, 2 * k); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.26)';
    pRound(ctx, bx + 0.5 * k, py + 12.3 * k, Math.max(1, bw * hp - 1 * k), 1.1 * k, 0.9 * k); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    pRound(ctx, bx - 0.6 * k, py + 16.4 * k, bw + 1.2 * k, 3.7 * k, 1.9 * k); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    pRound(ctx, bx, py + 17 * k, bw, 2.5 * k, 1.5 * k); ctx.fill();
    ctx.fillStyle = '#6aa8e0';
    pRound(ctx, bx, py + 17 * k, Math.max(1, bw * u.morale / 100), 2.5 * k, 1.5 * k); ctx.fill();
    if (hit >= 0) {
      // 피격 섬광
      formPath(ctx, form, cx, cy, CW, CH, 0);
      ctx.fillStyle = 'rgba(255,240,206,' + (0.5 * (1 - hit)).toFixed(3) + ')';
      ctx.fill();
    }
    // 상태 배지 — 카드 우하단 (명령 완료 ✓ / 이동 완료 移)
    const badge = (txt, ring, ink) => {
      const br = 7.2 * k;
      const bx2 = cx + CW - br * 0.55, by2 = cy + CH - br * 0.55;
      ctx.beginPath(); ctx.arc(bx2, by2, br, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,14,10,.92)'; ctx.fill();
      ctx.strokeStyle = ring; ctx.lineWidth = 1.2 * k; ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold ' + (9 * k).toFixed(1) + 'px "Malgun Gothic"';
      ctx.fillStyle = ink;
      ctx.fillText(txt, bx2, by2 + 0.4 * k);
    };
    if (u.acted) {
      formPath(ctx, form, cx, cy, CW, CH, 0);
      ctx.fillStyle = 'rgba(3,7,5,.42)'; ctx.fill();
      badge('✓', 'rgba(150,200,168,.8)', 'rgba(196,232,206,.95)');
    } else if (u.moved) {
      // 이동만 마친 부대 — 같은 턴에 공격할 수 있는 상태
      badge('移', 'rgba(226,180,104,.88)', 'rgba(250,220,158,.95)');
    }
    ctx.restore();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  /* 상단 상태바 — 원군이 어디까지 진군했는지 (도착까지 남은 일수 · 진행률) */
  function reinfStrip() {
    if (!B || !B.pending || !B.pending.length) return '';
    const infos = B.pending.map(p => {
      const left = Math.max(0, p.due - B.round);
      const gone = Math.max(0, Math.min(p.days, p.days - left));
      const pct = Math.round(gone / Math.max(1, p.days) * 100);
      const mine = p.side === B.playerSide;
      const names = (p.units || []).map(u => (u.officer ? u.officer.name : '병사')).join('·');
      const where = p.from ? p.from + ' → ' + B.opts.city.name : B.opts.city.name;
      return '<span class="ri ' + (mine ? 'mine' : 'foe') + '" title="' + names + '">' +
        '🪖 ' + (mine ? '아군' : '적') + ' 원군 ' + where + ' · ' +
        (left > 0 ? left + '일 남음' : '도착') +
        '<span class="ribar"><i style="width:' + pct + '%"></i></span></span>';
    });
    return infos.join('');
  }

  /* ── 패널 ──────────────────────────────────────────── */
  function renderDuelPrompt() {
    const el = $('bDuelPrompt');
    if (!el) return;
    const request = !B.over && B.duelRequest;
    if (!request) { el.innerHTML = ''; return; }
    const { attacker, defender } = request;
    const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const loss = duelMoraleLoss(attacker) * 2;
    const html = '<div class="modal-bg top"><div class="modal duel-prompt" role="dialog" aria-modal="true" aria-labelledby="bDuelTitle" aria-describedby="bDuelCost">' +
      '<h2 id="bDuelTitle">일기토 신청</h2><p>' + escape(attacker.name) + ' 장수가 일기토를 신청했습니다.</p>' +
      '<table class="duel-compare"><thead><tr><th scope="col">정보</th><th scope="col">아군 · 응답</th><th scope="col">적군 · 신청</th></tr></thead><tbody>' +
      '<tr><th scope="row">무장</th><td>' + escape(defender.name) + '</td><td>' + escape(attacker.name) + '</td></tr>' +
      '<tr><th scope="row">무력</th><td>' + defender.officer.wu + '</td><td>' + attacker.officer.wu + '</td></tr>' +
      '<tr><th scope="row">사기</th><td>' + defender.morale + '</td><td>' + attacker.morale + '</td></tr>' +
      '<tr><th scope="row">병력</th><td>' + commas(defender.troops) + '</td><td>' + commas(attacker.troops) + '</td></tr></tbody></table>' +
      '<p id="bDuelCost">거부하면 병력 손실 없이 아군 사기가 ' + loss + ' 감소합니다(일기토 패배 시의 2배, ' + defender.morale + ' → ' + Math.max(0, defender.morale - loss) + ').' +
      (defender.morale <= loss ? ' 사기가 0이 되어 이 부대는 병력을 보존한 채 전장에서 도주합니다.' : '') + '</p>' +
      '<div class="foot"><button id="bDuelAccept" onclick="Battle.act(\'duelAccept\')">수락</button><button id="bDuelRefuse" onclick="Battle.act(\'duelRefuse\')">거부 · 사기 -' + loss + '</button></div></div></div>';
    if (el.innerHTML !== html) {
      el.innerHTML = html;
      const accept = $('bDuelAccept'), refuse = $('bDuelRefuse');
      if (accept && accept.focus) accept.focus();
      el.onkeydown = e => {
        if (e.key !== 'Tab') return;
        e.preventDefault();
        const next = document.activeElement === accept ? refuse : accept;
        if (next && next.focus) next.focus();
      };
    }
  }

  function renderPanel() {
    hideUnitTooltip();
    if (!B) return;
    renderDuelPrompt();
    const info = $('bRoundInfo');
    if (info) {
      const forts = fortTiles();
      // 성 점령 현황 — 모두 넘어가면 공격측 승리
      const fInfo = forts.length ? ' · 성 ' + fortTaken() + '/' + forts.length : '';
      info.textContent = B.round + ' / ' + B.maxRound + '라운드 · ' +
        (B.over ? '전투 종료' : (B.side === B.playerSide ? '내 차례' : B.opts.atk.name + '군 행동 중…')) +
        (B.auto ? ' · 자동' : '') + fInfo + (B.supply ? ' · 전투 군량 -' + B.supply[B.playerSide].paid +
          ' (잔여 ' + commas(B.supply[B.playerSide].food) + ')' : '');
    }
    const rinfo = $('bReinfInfo');
    const mapRinfo = $('bMapReinfInfo');
    if (rinfo || mapRinfo) {
      const reinforcements = reinfStrip();
      if (rinfo) rinfo.innerHTML = reinforcements;
      if (mapRinfo) mapRinfo.innerHTML = reinforcements;
    }
    const me = B.playerSide, foe = me === 'atk' ? 'def' : 'atk';
    const score = $('bScore');
    const mapScore = $('bMapScore');
    if (score || mapScore) {
      const cMe = (B.opts[me] || {}).color || '#8b9a8e';
      const cFoe = (B.opts[foe] || {}).color || '#8b9a8e';
      const scoreHTML =
        '<div class="scard" style="--c:' + cMe + '"><span class="k">내 군</span><b>' + commas(troopsOf(me)) + '</b><span class="n">' + alive(me).length + '부대</span></div>' +
        '<div class="scard" style="--c:' + cFoe + '"><span class="k">적군</span><b>' + commas(troopsOf(foe)) + '</b><span class="n">' + alive(foe).length + '부대</span></div>';
      if (score) score.innerHTML = scoreHTML;
      if (mapScore) mapScore.innerHTML = scoreHTML;
    }
    const u = selUnit();
    const el = $('bUnit');
    if (B.over) {
      if (el) el.innerHTML = '<div class="bn">' + (B.winner === 'attacker' ? B.opts.atk.name : B.opts.def.name) + '군 승리</div>' +
        (B.retreatTo ? '<div class="muted">🏳 잔존 병력이 ' + B.retreatTo + '으로 후퇴합니다</div>' : '') +
        '<div class="kv"><span>공격군 잔존</span><b>' + commas(troopsOf('atk')) + '</b><span>수비군 잔존</span><b>' + commas(troopsOf('def')) + '</b></div>';
      const acts = $('bActs'); if (acts) acts.innerHTML = '';
      draw(); return;
    }
    if (el) {
      if (!u) {
        el.innerHTML = '<div class="bn">부대를 선택하세요</div><div class="muted">내 부대를 클릭하거나 [자동 진행]으로 위임할 수 있습니다.</div>';
      } else {
        const sk = SKILLS[u.officer.skill];
        const trait=[CombatRules.description(u.officer),...CombatRules.bonuses(u,alive(u.side),alive(u.side).filter(a=>mdist(a,u)<=2)).labels].filter(Boolean).join(' · ');
        // 클릭 즉시 행동 안내 — 선택만 해도 이동·공격 영역이 보인다
        const canPoint = !u.acted && !isConfused(u) && B.side === B.playerSide && !B.auto && (B.mode === 'select' || B.mode === 'move');
        const clicks = [];
        if (canPoint && attackTargets(u).length) clicks.push('붉은 칸 = 공격');
        if (canPoint && !u.moved && moveRange(u).length) clicks.push('파란 칸 = 이동');
        if (canPoint && !u.moved && u.branch === '기병' && chargeOptions(u).length) clicks.push('[돌격]으로 적진 관통');
        if (canPoint && u.branch === '보병' && volleyTargets(u).length) clicks.push('[일제공격] 가능');
        if (canPoint && u.branch === '궁병' && fireTargets(u).length) clicks.push('[불화살] ' + fireLeft(u) + '발 남음');
        const hp = Math.max(0, Math.min(1, u.troops / u.max));
        const hpCol = hp > .5 ? '#7fc08d' : (hp > .25 ? '#e3b75f' : '#ef8b78');
        const face = portraitFace(u.name);
        el.innerHTML =
          '<div class="b-unit-summary"><div class="b-unit-info">' +
          '<div class="bn">' + u.name + ' 부대</div>' +
          '<div class="badges"><span class="badge2">' + u.branch + '</span><span class="badge2">' + u.form + '</span>' +
            (u.acted ? '<span class="badge2">행동 완료</span>' : '') +
            ((u.confused > 0 || u.confusedNow) ? '<span class="badge2" style="color:#ffb0c8">혼란</span>' : '') +
            (u.burn > 0 ? '<span class="badge2" style="color:#ff9d5c">화상</span>' : '') +
            (u.branch === '기병' ? '<span class="badge2">돌격 ' + chargeLeft(u) + '회 남음</span>' : '') +
            (u.branch === '보병' ? '<span class="badge2">일제공격 ' + volleyLeft(u) + '회 남음</span>' : '') +
            (u.branch === '기병' ? '<span class="badge2">일제공격 참여 ' + volleyLeft(u) + '회 남음</span>' : '') +
            (u.branch === '궁병' ? '<span class="badge2" style="color:#ffb070">불화살 ' + fireLeft(u) + '</span>' : '') +
            (fortAt(u.x, u.y) ? '<span class="badge2" style="color:#ffd479">성 안 · 방어 +40% · 반격 피해 -25%</span>' : '') +
            (sk ? '<span class="badge2" style="color:var(--gold)">' + u.officer.skill + '</span>' : '') + '</div>' +
          (trait?'<p class="muted">'+trait+'</p>':'') +
          '<div class="kv"><span>병력</span><b>' + commas(u.troops) + ' / ' + commas(u.max) + '</b>' +
            '<span>사기·훈련</span><b>' + u.morale + ' · ' + u.training + '</b>' +
            '<span>무력·지력</span><b>' + u.officer.wu + ' · ' + u.officer.zhi + '</b></div>' +
          '</div>' + (face ? '<div class="b-unit-portrait">' + face + '</div>' : '') + '</div>' +
          '<div class="meter"><i style="width:' + Math.round(hp * 100) + '%;background:' + hpCol + '"></i></div>' +
          '<div class="meter"><i style="width:' + u.morale + '%;background:#6aa8e0"></i></div>' +
          '<div class="muted" style="font-size:10.5px">' + BRANCHES[u.branch].desc + ' · ' + (FORMS[u.form] || {}).desc + '</div>' +
          // 안내 문구 슬롯은 항상 2줄 고정 — 문구가 나타났다 사라져도 아래 버튼이 움직이지 않는다
          '<div class="hints">' +
            '<div class="hint">' + (isConfused(u) ? '혼란 상태 — 이동·공격·계략·일기토·진형 불가 (반격도 불가)' :
              (!u.acted && u.moved ? '이동 완료 — 같은 턴에 공격할 수 있습니다.' : '')) + '</div>' +
            '<div class="hint">' + (clicks.length ? '클릭으로 바로 행동 — ' + clicks.join(' · ') : '') + '</div>' +
          '</div>';
      }
    }
    const acts = $('bActs');
    if (acts) {
      const can = !!u && !u.acted && !isConfused(u) && B.side === B.playerSide && !B.auto && !B.busy && !B.over;
      const okMove = can && !u.moved && moveRange(u).length > 0;
      const okAtk = can && attackTargets(u).length > 0;
      const okStrat = can && STRATS.some(s => stratTargets(u, s).length > 0);
      const okDuel = can && duelTargets(u).length > 0;
      const okCharge = can && !u.moved && u.branch === '기병' && chargeOptions(u).length > 0;
      const okVolley = can && u.branch === '보병' && volleyTargets(u).length > 0;
      const okFire = can && u.branch === '궁병' && fireLeft(u) > 0 && fireTargets(u).length > 0;
      const btn = (cmd, ico, label, ok) => '<button aria-label="' + label + '" onclick="Battle.act(\'' + cmd + '\')"' + (ok ? '' : ' disabled') + '><i class="ico">' + ico + '</i><span>' + label + '</span></button>';
      let h = btn('move', '移', '이동', okMove) +
        btn('atk', '攻', '공격', okAtk) +
        (u && u.branch === '기병' ? btn('charge', '突', '돌격', okCharge) : '') +
        (u && u.branch === '보병' ? btn('volley', '齊', '일제공격', okVolley) : '') +
        (u && u.branch === '궁병' ? btn('fire', '火', '불화살', okFire) : '') +
        btn('strat', '策', '계략', okStrat) +
        btn('duel', '鬪', '일기토', okDuel) + btn('form', '陣', '진형', can) + btn('wait', '待', '대기', can);
      if (B.mode === 'strat' && !B.auto) {
        h += STRATS.map(s => '<button onclick="Battle.setStrat(\'' + s + '\')"' + (B.strat === s ? ' class="on"' : '') + '>' + s + '</button>').join('');
      }
      if (B.mode === 'form' && !B.auto) {
        h += Object.keys(FORMS).map(f => '<button onclick="Battle.setForm(\'' + f + '\')">' + f + '</button>').join('');
      }
      if (B.mode === 'retreat' && !B.auto) {
        h += retreatCities().map(c => '<button onclick="Battle.retreatTo(\'' + c.name + '\')">' + c.name + '으로 후퇴</button>').join('');
      }
      acts.innerHTML = h;
    }
    const autoBtn = $('bAuto');
    if (autoBtn) autoBtn.disabled = B.over || !!B.duelRequest;
    if (autoBtn) autoBtn.innerHTML = '<svg class="auto-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="' +
      (B.auto ? 'M4 3h3v10H4zM9 3h3v10H9z' : 'M1 3v10l7-5zM8 3v10l7-5z') +
      '"></path></svg>' + (B.auto ? '자동 멈춤' : '자동 진행');
    const nextBtn = $('bNext');
    if (nextBtn) {
      const left = B.units.filter(x => x.alive && x.side === B.playerSide && !x.acted).length;
      nextBtn.disabled = B.over || B.auto || B.busy || B.side !== B.playerSide || !left;
      nextBtn.title = left ? '남은 아군 ' + left + '부대를 대기시키고 다음 턴으로' : '모든 부대가 행동했습니다';
    }
    const reinfBtn = $('bReinf');
    if (reinfBtn) reinfBtn.disabled = B.over || B.busy || B.auto || !B.opts.onReinforce;
    const retBtn = $('bRetreat');
    if (retBtn) retBtn.textContent=B.playerSide==='def'&&!B.opts.siege?'성으로 후퇴':'후퇴';
    if (retBtn) retBtn.disabled = B.over || B.busy || B.auto || (B.playerSide === 'def' && B.opts.siege && !retreatCities().length);
    renderTextBoard();
    draw();
  }

  return {
    start, act, setStrat, setForm, reinforce, retreatTo, clickCell, observation,
    toggleBgm, toggleSfx, syncSound, zoomBy, zoomReset,
    reinforceDays: REINF_DAYS,
    get active() { return !!B && !B.over; },
    get state() { return B; }
  };
})();
window.Battle = Battle;
