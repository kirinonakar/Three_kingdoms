/* =====================================================
   전투 시스템 헤드리스 테스트 — node sangokji/tools/battle_test.js
   - 실제 battle.js 를 DOM 스텁 위에서 실행
   - 자동 전투 / 수동 조작(클릭 시뮬레이션) / 후퇴 경로 검증
   ===================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ── DOM 스텁 (클릭 핸들러 보관) ────────────────────── */
function makeCtx() {
  return new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}, { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
}
const els = {};
function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', checked: false, disabled: false,
    scrollTop: 0, scrollHeight: 0, width: 594, height: 378, style: {}, dataset: {}, handlers: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, fn) { this.handlers[type] = fn; },
    appendChild() {}, remove() {},
    getContext() { return makeCtx(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 594, height: 378 }; }
  };
}
global.window = global;
global.document = {
  getElementById: id => (els[id] || (els[id] = makeEl(id))),
  createElement: () => makeEl('_'),
  querySelector: () => makeEl('_'),
  querySelectorAll: () => [],
  addEventListener() {},
  body: makeEl('body')
};
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
let pauseTimers = false;
global.setTimeout = fn => { if (!pauseTimers) fn(); return 0; };
global.clearTimeout = () => {};

/* ── 소스 로드 ──────────────────────────────────────── */
const src = ['data.js', 'combat-rules.js', 'strategy-systems.js', 'save-transfer.js', 'game.js', 'battle-terrain.js', 'battle.js']
  .map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n');
eval(src);
const Game = global.Game, Battle = global.Battle;
if (!Game || !Battle) { console.error('FAIL: Game/Battle 로드 실패'); process.exit(1); }
const soundEvents = [];
global.Sound = {
  sfx(name, details) { soundEvents.push({ name, details }); },
  bgm() {}, syncButtons() {}, boot() {}
};

let errors = 0;
const check = (c, m) => { if (!c) { errors++; console.error('  X ' + m); } };
const ri = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

Game.startNew('cao');
const off = n => Game.state.officers.find(o => o.name === n);
const mkU = (name, troops, branch, form, morale) => ({
  officer: name ? off(name) : null, troops, branch: branch || '보병',
  training: ri(60, 85), morale: morale || ri(60, 95), form: form || '어린'
});
function clickTile(x, y) {
  const el = els['battleCanvas'];
  const r = el.getBoundingClientRect();
  if (el && el.handlers.click) el.handlers.click({ clientX: r.left + (x + .5) * r.width / 13, clientY: r.top + (y + .5) * r.height / 9 });
}
function nextQuietRound(b, u) {
  const round = b.round;
  b.units.forEach(x => { x.acted = true; });
  u.acted = false;
  b.sel = u; b.side = b.playerSide; b.mode = 'select'; b.busy = false;
  pauseTimers = false;
  Battle.act('wait');
  pauseTimers = true;
  check(b.round === round + 1 && !u.acted && !u.moved, '횟수 제한: 다음 라운드 진행 실패');
  b.sel = u;
}
function runBattle(tag, atkUnits, defUnits, opt) {
  let res = null, calls = 0;
  Battle.start({
    siege: !(opt && opt.field), city: Game.state.cities['낙양'],
    playerSide: (opt && opt.side) || 'atk', auto: !!(opt && opt.auto),
    atk: { name: '조조군', color: '#4a6fd6', units: atkUnits },
    def: { name: '이각군', color: '#9a5a5a', units: defUnits },
    onEnd: r => { res = r; calls++; }
  });
  check(calls === 1, tag + ': onEnd 호출 ' + calls + '회');
  if (res) {
    check(res.winner === 'attacker' || res.winner === 'defender', tag + ': 승자 값 이상(' + res.winner + ')');
    check(Array.isArray(res.atk) && Array.isArray(res.def), tag + ': 생존 목록 형식 오류');
    res.atk.concat(res.def).forEach(u => check(u.troops >= 0, tag + ': 음수 병력 ' + u.name));
    check(!Battle.state, tag + ': 전투 상태(B) 미정리');
  }
  return res;
}

/* 1) 빈 성(수비 병력 0) → 공격측 승리 확정 */
let r = runBattle('빈성', [mkU('하후돈', 5000, '기병'), mkU('조인', 4000, '보병')],
  [{ officer: null, troops: 0, branch: '보병', training: 50, morale: 60, form: '방원' }], { auto: true });
check(r && r.winner === 'attacker', '빈성: 공격측 승리여야 함');

/* 2) 자동 전투 12회 (병과/진형/병력 랜덤) */
const BR = ['보병', '기병', '궁병'], FM = ['어린', '봉시', '방원', '안행', '학익'];
for (let i = 0; i < 12; i++) {
  const atk = [mkU('하후연', ri(4000, 9000), BR[ri(0, 2)], FM[ri(0, 4)]), mkU('악진', ri(4000, 9000), BR[ri(0, 2)], FM[ri(0, 4)])];
  const def = [mkU('호진', ri(4000, 9000), BR[ri(0, 2)], FM[ri(0, 4)]), mkU('번조', ri(4000, 9000), BR[ri(0, 2)], FM[ri(0, 4)])];
  runBattle('자동#' + (i + 1), atk, def, { auto: true, field: i % 2 === 0 });
}

/* 2-2) AI 상황별 진형 전환 — 전투 중 진형이 바뀌고, 수비대는 성에서 방원을 쓴다 */
{
  const prevTimer = global.setTimeout;
  const seen = new Map(), changes = [];
  let samples = 0;
  global.setTimeout = fn => {
    try {
      const o = Battle.observation();
      if (o && o.units && o.units.length) {
        samples++;
        o.units.forEach(u => {
          const before = seen.get(u.name);
          if (before && before !== u.form) changes.push(u.name + ' ' + before + '→' + u.form);
          seen.set(u.name, u.form);
        });
      }
    } catch (e) { /* 표본 수집 실패는 무시하고 진행 */ }
    fn();
    return 0;
  };
  const atkF = [mkU('하후연', 9000, '기병'), mkU('악진', 9000, '보병'), mkU('이전', 9000, '궁병')];
  const defF = [mkU('호진', 9000, '보병'), mkU('번조', 9000, '궁병'), mkU('우금', 9000, '기병')];
  runBattle('진형전환', atkF, defF, { auto: true });
  global.setTimeout = prevTimer;
  check(samples > 0, 'AI 진형: 전투 상태 표본을 얻지 못함');
  check(changes.length > 0, 'AI 진형: 상황에 따른 진형 전환이 없음');
  if (changes.length) console.log('  AI 진형 전환 예: ' + changes.slice(0, 4).join(' / '));
}

/* 2-3) 진형 전환 비용 — 부대마다 첫 전환은 무료, 두 번째부터 행동 소모 · 최대 15라운드 */
{
  let endForm = null;
  Battle.start({
    siege: false, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
    atk: { name: '조조군', color: '#4a6fd6', units: [mkU('하후돈', 9000, '기병')] },
    def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 9000, '보병')] },
    onEnd: x => { endForm = x; }
  });
  const Bf = Battle.state;
  check(!!Bf, '진형비용: 시작 실패');
  check(Bf && Bf.maxRound === 15, '라운드: 최대 라운드가 15가 아님 (' + (Bf && Bf.maxRound) + ')');
  if (Bf) {
    const u = Bf.units.find(t => t.side === 'atk');
    pauseTimers = true;
    Bf.side = 'atk'; Bf.sel = u; Bf.mode = 'select'; Bf.busy = false; u.acted = false;
    Battle.setForm('봉시');
    check(u.form === '봉시' && u.acted === false, '진형비용: 첫 전환이 행동을 소모함');
    check(Bf.log.some(l => l.indexOf('첫 전환은 행동을 소모하지 않습니다') >= 0), '진형비용: 무료 전환 로그 없음');
    Bf.busy = false; Bf.mode = 'form';
    Battle.setForm('학익');
    check(u.form === '학익' && u.acted === true, '진형비용: 두 번째 전환이 행동을 소모하지 않음');
    pauseTimers = false;
    Bf.busy = false;
    if (Battle.state && !Battle.state.over) Battle.act('auto');
    check(Battle.state === null, '진형비용: 전투 상태 미정리');
  }
}

/* 최대 라운드: 마지막 라운드까지 진행하고, 병력 우세와 무관하게 공격군이 철수한다. */
for (const siege of [false, true]) for (const side of ['atk', 'def']) for (const auto of [false, true]) {
  const tag = '시간 초과/' + (siege ? '공성' : '야전') + '/' + side + '/' + (auto ? '자동' : '수동');
  let result = null, calls = 0;
  pauseTimers = true;
  Battle.start({
    siege, city: Game.state.cities['낙양'], playerSide: side, auto: false,
    atk: { name: '공격', color: '#4a6fd6', units: [mkU('하후돈', 20000, '보병')] },
    def: { name: '수비', color: '#9a5a5a', units: [mkU('이각', 2000, '보병')] },
    onEnd: x => { result = x; calls++; }
  });
  const b = Battle.state;
  b.round = b.maxRound - 1;
  b.side = side; b.busy = false;
  b.units.forEach(u => { u.acted = true; });
  Battle.act('auto');
  check(b.round === b.maxRound && !b.over && calls === 0, tag + ': 마지막 라운드 전에 종료됨');

  b.side = side; b.busy = false; b.auto = false;
  b.units.forEach(u => { u.acted = auto || u.side !== side; });
  pauseTimers = false;
  Battle.act(auto ? 'auto' : 'nextTurn');
  check(calls === 1 && result && result.winner === 'defender', tag + ': 공격군이 우세해도 방어측 승리여야 함');
  check(result && result.rounds === b.maxRound, tag + ': 종료 라운드 오류');
  check(result && result.atk[0].troops === 20000 && result.def[0].troops === 2000, tag + ': 철수 시 잔존 병력 변경');
  check(result && !result.fieldRetreat && !result.retreatTo, tag + ': 수비측 후퇴로 처리됨');
  check(b.log.some(l => l.includes('공격') && l.includes('자동으로 후퇴')), tag + ': 자동 후퇴 안내 없음');
  check(Battle.state === null, tag + ': 전투 상태 미정리');
}

/* 3) 플레이어(공격측) 수동 — 대기/이동/공격/계략/진형/일기토 클릭 경로 */
const atk3 = [mkU('하후돈', 9000, '기병'), mkU('이전', 8000, '보병')];
const def3 = [mkU('이각', 8000, '보병'), mkU('곽사', 7000, '궁병')];
let res3 = null;
Battle.start({
  siege: true, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
  atk: { name: '조조군', color: '#4a6fd6', units: atk3 },
  def: { name: '이각군', color: '#9a5a5a', units: def3 },
  onEnd: x => { res3 = x; }
});
check(!!Battle.state && !Battle.state.over, '수동: 전투가 시작되지 않음');
let guard = 0;
while (Battle.state && !Battle.state.over && guard++ < 500) {
  const B = Battle.state;
  if (B.duelRequest) { Battle.act('duelAccept'); continue; }
  if (B.side !== 'atk') break;
  const u = B.sel;
  if (!u) {
    // 시작 직후에는 부대가 자동 선택되지 않으므로 직접 클릭해 고른다
    const mine = B.units.find(t => t.alive && t.side === B.playerSide && !t.acted);
    if (!mine) break;
    clickTile(mine.x, mine.y);
    continue;
  }
  const foes = B.units.filter(t => t.alive && t.side !== u.side);
  const adj = foes.find(t => Math.abs(t.x - u.x) + Math.abs(t.y - u.y) <= 1);
  const near = foes.slice().sort((a, b) =>
    (Math.abs(a.x - u.x) + Math.abs(a.y - u.y)) - (Math.abs(b.x - u.x) + Math.abs(b.y - u.y)))[0];
  const dice = Math.random();
  if (adj && dice < 0.35) { Battle.act('atk'); clickTile(adj.x, adj.y); }         // 공격
  else if (adj && dice < 0.45) { Battle.act('duel'); clickTile(adj.x, adj.y); }   // 일기토
  else if (near && dice < 0.60) { Battle.act('strat'); Battle.setStrat('화계'); clickTile(near.x, near.y); } // 계략
  else if (dice < 0.68) { Battle.setForm('봉시'); }                                // 진형 (행동 소모)
  else if (near) { Battle.act('move'); clickTile(near.x, near.y); }               // 이동
  if (Battle.state && Battle.state.sel === u && u.alive && !u.acted) Battle.act('wait');
}
check(!!res3, '수동: 결과 없음');
check(Battle.state === null, '수동: 상태 미정리');

/* 4) 이동 후 같은 턴에 공격 */
let resMove = null;
Battle.start({
  siege: false, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
  atk: { name: '조조군', color: '#4a6fd6', units: [mkU('하후돈', 9000, '기병')] },
  def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 9000, '보병')] },
  onEnd: x => { resMove = x; }
});
{
  const Bm = Battle.state;
  check(!!Bm, '이동후공격: 시작 실패');
  if (Bm) {
    Bm.terrain[3] = Array(13).fill(0);
    const a = Bm.units.find(u => u.side === 'atk');
    const d = Bm.units.find(u => u.side === 'def');
    a.x = 5; a.y = 3; d.x = 10; d.y = 3;
    Bm.sel = a; Bm.side = 'atk'; Bm.mode = 'move'; Bm.busy = false;
    Battle.act('move');
    clickTile(9, 3);
    check(a.moved === true && a.acted === false, '이동후공격: 이동이 행동을 소모함');
    const before = d.troops;
    Battle.act('atk');
    clickTile(10, 3);
    // 테스트 스텁은 setTimeout을 즉시 실행하므로 공격 후 라운드가 넘어가
    // acted/moved 플래그가 초기화될 수 있다. 로그와 피해량으로 검증한다.
    check(Bm.log.some(l => l.indexOf(a.name + ' → ' + d.name) >= 0), '이동후공격: 공격이 실행되지 않음');
    check(d.troops < before || !d.alive, '이동후공격: 피해가 없음');
  }
  if (Battle.state && !Battle.state.over) Battle.act('auto');
  check(Battle.state === null, '이동후공격: 전투 상태 미정리');
}

/* 4-2) 혼란 상태의 적은 반격하지 못한다 */
let res6 = null;
Battle.start({
  siege: false, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
  atk: { name: '조조군', color: '#4a6fd6', units: [mkU('하후돈', 9000, '기병')] },
  def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 9000, '보병')] },
  onEnd: x => { res6 = x; }
});
{
  const Bc = Battle.state;
  check(!!Bc, '혼란반격: 시작 실패');
  if (Bc) {
    Bc.terrain[3] = Array(13).fill(0);
    const a = Bc.units.find(u => u.side === 'atk');
    const d = Bc.units.find(u => u.side === 'def');
    a.x = 5; a.y = 3; d.x = 6; d.y = 3;
    d.confused = 2; d.confusedNow = true;
    Bc.sel = a; Bc.side = 'atk'; Bc.mode = 'select'; Bc.busy = false;
    clickTile(d.x, d.y);                       // 선택 상태에서 인접한 적 클릭 → 즉시 근접 공격
    check(Bc.log.some(l => l.indexOf('혼란 상태라 반격하지 못했습니다') >= 0), '혼란반격: 반격 차단 로그 없음');
    check(!Bc.log.some(l => l.indexOf(d.name + '의 반격!') >= 0), '혼란반격: 혼란 부대가 반격함');
  }
  if (Battle.state && !Battle.state.over) Battle.act('auto');
  check(Battle.state === null, '혼란반격: 전투 상태 미정리');
}

/* 4-3) 혼란 상태의 부대는 이동·공격·계략·진형·대기를 할 수 없다 */
let res7 = null;
Battle.start({
  siege: false, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
  atk: { name: '조조군', color: '#4a6fd6', units: [mkU('하후돈', 9000, '기병')] },
  def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 9000, '보병')] },
  onEnd: x => { res7 = x; }
});
{
  const Bh = Battle.state;
  check(!!Bh, '혼란행동: 시작 실패');
  if (Bh) {
    Bh.terrain[3] = Array(13).fill(0);
    const a = Bh.units.find(u => u.side === 'atk');
    const d = Bh.units.find(u => u.side === 'def');
    a.x = 3; a.y = 3; d.x = 7; d.y = 3;
    a.confused = 2; a.confusedNow = true; a.acted = false;
    Bh.sel = a; Bh.side = 'atk'; Bh.mode = 'select';
    const pos = a.x;
    Battle.act('move');
    Battle.act('atk');
    Battle.act('strat');
    Battle.act('duel');
    Battle.act('form');
    Battle.act('wait');
    Battle.setForm('봉시');
    Battle.setStrat('화계');
    check(Bh.mode === 'select', '혼란행동: 혼란 부대가 행동 모드로 진입함 (' + Bh.mode + ')');
    check(a.x === pos && !a.moved, '혼란행동: 혼란 부대가 이동 명령을 받음');
    check(a.form !== '봉시', '혼란행동: 혼란 부대가 진형을 바꿈');
    check(a.acted === false, '혼란행동: 혼란 부대가 대기 명령으로 턴을 소모함');
    check(Bh.log.some(l => l.indexOf('혼란 상태로 행동할 수 없습니다') >= 0), '혼란행동: 차단 로그 없음');
    Bh.busy = false;
    clickTile(d.x, d.y);                                                // 클릭으로도 공격 불가
    check(Bh.log.filter(l => l.indexOf(a.name + ' → ' + d.name) >= 0).length === 0, '혼란행동: 혼란 부대가 클릭으로 공격함');
  }
  if (Battle.state && !Battle.state.over) { Battle.state.busy = false; Battle.act('auto'); }
  check(Battle.state === null, '혼란행동: 전투 상태 미정리');
}

/* 4-4) 혼란은 지력에 따라 1턴 만에 회복할 수 있다 */
function stubRandom(seq) {
  const orig = Math.random;
  let i = 0;
  Math.random = () => (i < seq.length ? seq[i++] : 0.5);
  return () => { Math.random = orig; };
}
function confuseOnce(seq) {
  Battle.start({
    siege: false, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
    atk: { name: '조조군', color: '#4a6fd6', units: [mkU('하후돈', 9000, '기병')] },
    def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 9000, '보병'), mkU('곽사', 8000, '보병')] },
    onEnd: () => {}
  });
  const Bx = Battle.state;
  if (!Bx) return null;
  Bx.terrain[3] = Array(13).fill(0);
  const a = Bx.units.find(u => u.side === 'atk');
  const d = Bx.units.find(u => u.side === 'def' && u.name === '이각');
  a.x = 3; a.y = 3; d.x = 5; d.y = 3;
  // 행동은 허용하고 후속 타이머만 멈춰 혼란 수치를 그대로 검사한다.
  Bx.sel = a; Bx.side = 'atk'; Bx.mode = 'strat'; Bx.strat = '혼란';
  pauseTimers = true;
  const restore = stubRandom(seq);
  clickTile(d.x, d.y);
  restore();
  const out = { turns: d.confused, zhi: d.officer.zhi };
  pauseTimers = false;
  Bx.busy = false;
  if (Battle.state && !Battle.state.over) Battle.act('auto');
  return out;
}
const escOk = confuseOnce([0, 0]);        // 계략 성공 + 지력 회복 판정 성공
check(escOk && escOk.turns === 1, '혼란회복: 회복 판정 성공 시 1턴이어야 함 (' + (escOk && escOk.turns) + ')');
const escNo = confuseOnce([0, 0.99]);     // 계략 성공 + 회복 판정 실패
check(escNo && escNo.turns === 2, '혼란회복: 회복 판정 실패 시 2턴이어야 함 (' + (escNo && escNo.turns) + ')');

/* 4-5) 기병 돌격 — 적을 뚫고 지나간다 */
let res8 = null;
Battle.start({
  siege: false, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
  atk: { name: '조조군', color: '#4a6fd6', units: [mkU('하후돈', 9000, '기병'), mkU('조인', 8000, '보병')] },
  def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 9000, '보병'), mkU('곽사', 8000, '보병')] },
  onEnd: x => { res8 = x; }
});
{
  const Bq = Battle.state;
  check(!!Bq, '돌격: 시작 실패');
  if (Bq) {
    Bq.terrain[3] = Array(13).fill(0);
    Bq.geo={...Bq.geo,rivers:[],lakes:[],edgeFords:[],crossings:[]};
    const a = Bq.units.find(u => u.side === 'atk' && u.branch === '기병');
    const d = Bq.units.find(u => u.name === '이각');
    const d2 = Bq.units.find(u => u.name === '곽사');
    a.x = 3; a.y = 3; d.x = 4; d.y = 3; d2.x = 5; d2.y = 3;
    Bq.sel = a; Bq.side = 'atk'; Bq.mode = 'select';
    pauseTimers = true;
    const before = d.troops, before2 = d2.troops;
    check(a.charge === 2 && a.volley === 2, '돌격: 새 전투의 사용 횟수가 각각 2회가 아님');
    Battle.act('charge');
    check(Bq.mode === 'charge', '돌격: 돌격 모드로 진입하지 못함 (' + Bq.mode + ')');
    check(Battle.clickCell(7, 3) === false, '돌격: 네 번째 칸까지 허용함');
    check(a.charge === 2, '돌격: 잘못된 목적지에 사용 횟수를 소모함');
    clickTile(6, 3);                                     // 적 2부대를 뚫고 6,3 으로 돌파
    check(a.x === 6 && a.y === 3, '돌격: 적진을 뚫고 이동하지 못함 (' + a.x + ',' + a.y + ')');
    check(a.acted === true, '돌격: 행동을 소모하지 않음');
    check(a.charge === 1 && a.volley === 2, '돌격: 횟수 차감 또는 일제공격과의 독립성 오류');
    check(d.troops < before && d2.troops < before2, '돌격: 관통 피해가 없음');
    check(Bq.log.some(l => l.indexOf('돌격 관통') >= 0) && Bq.log.some(l => l.indexOf('2부대를 뚫고') >= 0), '돌격: 관통 로그 없음');
    check(Bq.busy && Battle.observation().busy, '행동 잠금: 후속 처리 전 busy가 설정되지 않음');
    check(Battle.observation().tiles.every(t => t.action === null), '행동 잠금: 실행 가능한 칸이 남아 있음');
    check(Battle.clickCell(a.x, a.y) === false, '행동 잠금: 칸 조작을 허용함');
    const mate = Bq.units.find(u => u.side === 'atk' && u !== a);
    Bq.sel = mate;
    const previousForm = mate.form;
    Battle.setForm(previousForm === '방원' ? '어린' : '방원');
    check(mate.form === previousForm && !mate.acted, '행동 잠금: 다른 부대의 진형 명령을 허용함');
    nextQuietRound(Bq, a);
    check(a.charge === 1, '돌격: 다음 라운드에 횟수가 회복됨');
    Battle.act('charge');
    check(Bq.mode === 'charge' && Battle.clickCell(3, 3), '돌격: 두 번째 사용 실패');
    check(a.charge === 0 && a.acted, '돌격: 두 번째 사용 후 잔여 횟수 오류');
    nextQuietRound(Bq, a);
    Battle.act('charge');
    check(Bq.mode === 'select' && a.charge === 0, '돌격: 세 번째 명령을 허용함');
    check(/aria-label="돌격"[^>]* disabled/.test(els.bActs.innerHTML), '돌격: 소진 후 버튼이 비활성화되지 않음');
    Bq.mode = 'charge';
    check(Battle.observation().tiles.every(t => t.action !== 'charge'), '돌격: 소진 후 돌격 가능 칸이 있음');
    check(!Battle.clickCell(6, 3) && a.x === 3 && a.charge === 0, '돌격: 클릭으로 세 번째 사용이 가능함');
    Bq.mode = 'select';
    pauseTimers = false; Bq.busy = false;
  }
  if (Battle.state && !Battle.state.over) Battle.act('auto');
  check(Battle.state === null, '돌격: 전투 상태 미정리');
}

/* 4-6) 보병이 보병·기병과 일제공격 — 함께 때리고 반격받지 않는다 */
for (const partnerBranch of ['보병', '기병']) {
let res9 = null;
Battle.start({
  siege: false, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
  atk: { name: '조조군', color: '#4a6fd6', units: [mkU('조인', 9000, '보병'), mkU('이전', 9000, partnerBranch)] },
  def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 9000, '보병'), mkU('곽사', 8000, '보병')] },
  onEnd: x => { res9 = x; }
});
{
  const Bv = Battle.state;
  check(!!Bv, '일제공격: 시작 실패');
  if (Bv) {
    Bv.terrain[3] = Array(13).fill(0);
    Bv.terrain[4] = Array(13).fill(0);
    Bv.geo={...Bv.geo,rivers:[],lakes:[],edgeFords:[],crossings:[]};
    const mine = Bv.units.filter(u => u.side === 'atk');
    const a = mine[0], mate = mine[1];
    const d = Bv.units.find(u => u.name === '이각');
    d.troops = d.max = 50000;
    a.x = 4; a.y = 3; mate.x = 5; mate.y = 4; d.x = 5; d.y = 3;
    Bv.sel = a; Bv.side = 'atk'; Bv.mode = 'select';
    pauseTimers = true;
    check(a.volley === 2 && mate.volley === 2, '일제공격: 새 전투의 참여 횟수가 2회가 아님');
    for (const blocked of ['행동 완료', '혼란', '궁병', '비인접', '횟수 소진']) {
      mate.acted = blocked === '행동 완료';
      mate.confused = blocked === '혼란' ? 1 : 0;
      mate.branch = blocked === '궁병' ? '궁병' : partnerBranch;
      mate.x = blocked === '비인접' ? 7 : 5;
      mate.volley = blocked === '횟수 소진' ? 0 : 2;
      Battle.act('volley');
      check(Bv.mode === 'select', '일제공격/' + partnerBranch + ': ' + blocked + ' 동료와 공격을 허용함');
      check(a.volley === 2, '일제공격: 실패한 명령에 사용 횟수를 소모함');
    }
    mate.acted = false; mate.confused = 0; mate.branch = partnerBranch; mate.x = 5; mate.volley = 2;
    if (partnerBranch === '기병') {
      check(Battle.clickCell(mate.x, mate.y), '일제공격: 기병 선택 실패');
      check(!els.bActs.innerHTML.includes('aria-label="일제공격"'), '일제공격: 기병에게 시작 버튼이 표시됨');
      check(els.bUnit.innerHTML.includes('일제공격 참여 2회 남음'), '일제공격: 기병의 참여 전용 표시가 없음');
      Battle.act('volley');
      check(Bv.mode === 'select', '일제공격: 기병이 직접 명령을 시작함');
      const beforeBlocked = d.troops;
      Bv.mode = 'volley';
      check(Battle.observation().tiles.every(t => t.action !== 'volley'), '일제공격: 기병이 시작할 수 있는 칸이 있음');
      check(!Battle.clickCell(d.x, d.y) && d.troops === beforeBlocked && mate.volley === 2 && !mate.acted,
        '일제공격: 기병의 직접 시작으로 피해 또는 횟수 소모가 발생함');
      Bv.mode = 'select';
      check(Battle.clickCell(a.x, a.y), '일제공격: 보병 재선택 실패');
    }
    const before = d.troops;
    const ownBefore = [a.troops, mate.troops];
    Battle.act('volley');
    check(Bv.mode === 'volley', '일제공격: 모드 진입 실패 (' + Bv.mode + ')');
    clickTile(d.x, d.y);
    check(d.troops < before, '일제공격: 피해가 없음');
    check(a.acted && mate.acted, '일제공격: 참가 부대의 행동이 소모되지 않음');
    check(a.volley === 1 && mate.volley === 1, '일제공격: 참가 부대 모두 1회씩 소모해야 함');
    if (partnerBranch === '기병') check(mate.charge === 2, '일제공격: 기병의 돌격 횟수까지 소모함');
    check(a.troops === ownBefore[0] && mate.troops === ownBefore[1], '일제공격: 참가 부대가 반격 피해를 받음');
    check(Bv.log.some(l => l.indexOf('일제공격!') >= 0), '일제공격: 로그 없음');
    check(!Bv.log.some(l => l.indexOf(d.name + '의 반격!') >= 0), '일제공격: 반격이 발생함');
    const cue = soundEvents.filter(e => e.name === 'volley').pop();
    check(cue && cue.details && cue.details.count === 2, '일제공격: 실제 참가 부대 수가 효과음에 전달되지 않음');
    nextQuietRound(Bv, a);
    check(a.volley === 1 && mate.volley === 1, '일제공격: 다음 라운드에 횟수가 회복됨');
    Battle.act('volley');
    check(Bv.mode === 'volley' && Battle.clickCell(d.x, d.y), '일제공격: 두 번째 사용 실패');
    check(a.volley === 0 && mate.volley === 0, '일제공격: 두 번째 참여 후 횟수 오류');
    nextQuietRound(Bv, a);
    const afterSecond = d.troops;
    Battle.act('volley');
    check(Bv.mode === 'select' && !a.acted, '일제공격: 세 번째 명령을 허용함');
    check(/aria-label="일제공격"[^>]* disabled/.test(els.bActs.innerHTML), '일제공격: 소진 후 버튼이 비활성화되지 않음');
    Bv.mode = 'volley';
    check(Battle.observation().tiles.every(t => t.action !== 'volley'), '일제공격: 소진 후 공격 가능 칸이 있음');
    check(!Battle.clickCell(d.x, d.y) && d.troops === afterSecond, '일제공격: 클릭으로 세 번째 사용이 가능함');
    Bv.mode = 'select';
    pauseTimers = false; Bv.busy = false;
  }
  if (Battle.state && !Battle.state.over) Battle.act('auto');
  check(Battle.state === null, '일제공격: 전투 상태 미정리');
}
}

/* 4-7) 궁병 불화살 — 사거리 2에서 불을 지르고 화상을 남긴다 */
let res10 = null;
Battle.start({
  siege: false, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
  atk: { name: '조조군', color: '#4a6fd6', units: [mkU('곽사', 9000, '궁병')] },
  def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 9000, '보병')] },
  onEnd: x => { res10 = x; }
});
{
  const Bf = Battle.state;
  check(!!Bf, '불화살: 시작 실패');
  if (Bf) {
    Bf.terrain[3] = Array(13).fill(0);
    const a = Bf.units.find(u => u.side === 'atk');
    const d = Bf.units.find(u => u.side === 'def');
    a.x = 3; a.y = 3; d.x = 5; d.y = 3;              // 사거리 2 (궁병 사거리)
    Bf.sel = a; Bf.side = 'atk'; Bf.mode = 'select';
    pauseTimers = true; // 화상 직후를 검사한다. 동기 타이머로 다음 라운드까지 진행시키지 않는다.
    const before = d.troops, arrows = a.fire;
    check(arrows === 2, '불화살: 궁병 부대의 불화살이 2발이 아님 (' + arrows + ')');
    Battle.act('fire');
    check(Bf.mode === 'fire', '불화살: 모드 진입 실패 (' + Bf.mode + ')');
    clickTile(d.x, d.y);
    check(d.troops < before, '불화살: 피해가 없음');
    check(a.fire === arrows - 1, '불화살: 사용 횟수가 줄지 않음 (' + a.fire + ')');
    check(d.burn > 0, '불화살: 화상이 걸리지 않음');
    check(Bf.log.some(l => l.indexOf('불화살!') >= 0), '불화살: 로그 없음');
    check(soundEvents.some(e => e.name === 'fire'), '불화살: 화염 효과음 없음');
    pauseTimers = false; Bf.busy = false;
  }
  if (Battle.state && !Battle.state.over) Battle.act('auto');
  check(Battle.state === null, '불화살: 전투 상태 미정리');
}

/* 5) 후퇴 */
const atk4 = [mkU('조인', 6000, '보병')];
let res4 = null;
Battle.start({
  siege: true, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
  atk: { name: '조조군', color: '#4a6fd6', units: atk4 },
  def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 8000, '보병')] },
  onEnd: x => { res4 = x; }
});
Battle.act('retreat');
check(res4 && res4.winner === 'defender', '후퇴: 방어측 승리 처리 필요');
check(res4 && res4.atk.length === 1 && res4.atk[0].troops === 6000, '후퇴: 공격측 부대 보존 실패');

/* 5) 플레이어(수비측) — 적 AI 선공 후 내 차례 확인 + 자동 위임 */
let res5 = null;
Battle.start({
  siege: true, city: Game.state.cities['낙양'], playerSide: 'def', auto: false,
  atk: { name: '조조군', color: '#4a6fd6', units: [mkU('하후연', 9000, '기병'), mkU('서황', 8000, '보병')] },
  def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 8000, '보병'), mkU('곽사', 7000, '보병')] },
  onEnd: x => { res5 = x; }
});
check(!!Battle.state, '수비: 시작 실패');
if (Battle.state) {
  check(Battle.state.side === 'def', '수비: AI 선공 후 내 차례여야 함 (현재 ' + Battle.state.side + ')');
  Battle.act('auto');   // 자동 진행으로 끝까지
}
check(!!res5, '수비: 결과 없음');

/* 6) 수비측 후퇴 — 다른 도시가 있으면 성을 내주고 병력을 거둔다 */
let dres1 = null, dres2 = null, dres3 = null;
Battle.start({
  siege: true, city: Game.state.cities['낙양'], playerSide: 'def', auto: false,
  retreatCities: [{ name: '홍농', troops: 1200 }],
  atk: { name: '조조군', color: '#4a6fd6', units: [mkU('하후연', 9000, '기병')] },
  def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 8000, '보병')] },
  onEnd: x => { dres1 = x; }
});
check(!!Battle.state, '수비 후퇴: 시작 실패');
Battle.act('retreat');       // 후퇴 도시가 하나면 곧바로 후퇴한다
check(dres1 && dres1.winner === 'attacker', '수비 후퇴: 공격측 승리 처리 필요');
check(dres1 && dres1.retreatTo === '홍농', '수비 후퇴: 후퇴 도시가 결과에 없음');
check(!Battle.state, '수비 후퇴: 전투 상태 미정리');

/* 7) 후퇴 도시가 여럿이면 골라서, 없으면 후퇴 불가 */
Battle.start({
  siege: true, city: Game.state.cities['낙양'], playerSide: 'def', auto: false,
  retreatCities: [{ name: '홍농', troops: 1200 }, { name: '장안', troops: 900 }],
  atk: { name: '조조군', color: '#4a6fd6', units: [mkU('하후연', 9000, '기병')] },
  def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 8000, '보병')] },
  onEnd: x => { dres2 = x; }
});
Battle.act('retreat');
check(Battle.state && Battle.state.mode === 'retreat', '수비 후퇴: 도시 선택 모드로 전환되지 않음');
Battle.retreatTo('장안');
check(dres2 && dres2.retreatTo === '장안', '수비 후퇴: 고른 도시로 후퇴하지 않음');

Battle.start({
  siege: true, city: Game.state.cities['낙양'], playerSide: 'def', auto: false,
  atk: { name: '조조군', color: '#4a6fd6', units: [mkU('하후연', 9000, '기병')] },
  def: { name: '이각군', color: '#9a5a5a', units: [mkU('이각', 8000, '보병')] },
  onEnd: x => { dres3 = x; }
});
Battle.act('retreat');       // 후퇴할 다른 도시가 없으면 전투가 계속된다
check(!!Battle.state && !Battle.state.over, '수비 후퇴: 도시가 없는데 후퇴됨');
Battle.act('auto');
check(!!dres3, '수비 후퇴: 도시 없음 전투 결과 없음');
console.log('수비측 후퇴 경로 실행 완료');
console.log('자동/수동/후퇴/수비 전투 경로 실행 완료');

/* 모든 도시: 다섯 수비 부대는 세 성 및 그 주변에 분산 배치된다. */
for (const city of Object.values(Game.state.cities)) {
  Battle.start({
    siege: true, city, playerSide: 'atk', auto: false,
    atk: { name: '공격', color: '#4a6fd6', units: [mkU('하후돈', 8000, '기병')] },
    def: { name: '수비', color: '#9a5a5a', units: Array.from({ length: 5 }, () => mkU(null, 6000, '보병')) },
    onEnd() {}
  });
  const b = Battle.state, forts = [];
  b.terrain.forEach((row,y) => row.forEach((t,x) => { if(t===3) forts.push({x,y}); }));
  const defenders = b.units.filter(u => u.side === 'def');
  check(new Set(b.units.map(u => u.x + ',' + u.y)).size === b.units.length, city.name + ': 부대 중복 배치');
  forts.forEach(f => check(defenders.some(u => u.x===f.x && u.y===f.y), city.name + ': 성 수비군 누락'));
  defenders.forEach(u => {
    check(b.terrain[u.y][u.x] !== 4, city.name + ': 수비군이 물 위에 배치됨');
    check(forts.some(f => Math.abs(f.x-u.x)+Math.abs(f.y-u.y)<=2), city.name + ': 성에서 벗어난 수비군');
  });
  if (city.name === '합비') {
    const count = b.units.length;
    check(Battle.reinforce([mkU(null, 6000, '보병')], 'def', { delay: 1 }), '수비 원군: 파견 실패');
    Battle.act('nextTurn');
    const arrived = b.units[count];
    check(!!arrived, '수비 원군: 다음 라운드 도착 실패');
    if (arrived) {
      check(arrived.acted, '수비 원군: 도착 라운드 행동 제한 누락');
      check(forts.some(f => Math.abs(f.x-arrived.x)+Math.abs(f.y-arrived.y)<=2), '수비 원군: 성 주변에 합류하지 않음');
      check(b.terrain[arrived.y][arrived.x] !== 4, '수비 원군: 물 위에 배치');
    }
  }
  Battle.act('retreat');
}
console.log('30개 도시의 성·주변 수비군 배치 검사 완료');

/* 좁은 강 때문에 기존 연결 검사에서는 여울이 생기지 않던 낙양: 실제 이동으로 양안 도하. */
Battle.start({
  siege: false, city: Game.state.cities['낙양'], playerSide: 'atk', auto: false,
  atk: { name: '공격', color: '#4a6fd6', units: [mkU('하후돈', 8000, '기병')] },
  def: { name: '수비', color: '#9a5a5a', units: [mkU(null, 6000, '보병')] }, onEnd() {}
});
{
  const b=Battle.state, c=b.geo.crossings[0], a=b.units.find(u=>u.side==='atk'), d=b.units.find(u=>u.side==='def');
  a.x=c.from.x;a.y=c.from.y;
  const away=b.terrain.flatMap((row,y)=>row.map((t,x)=>({t,x,y}))).find(p=>p.t<4&&Math.abs(p.x-a.x)+Math.abs(p.y-a.y)>6);
  d.x=away.x;d.y=away.y;
  clickTile(a.x,a.y);Battle.act('move');clickTile(c.to.x,c.to.y);
  check(a.x===c.to.x&&a.y===c.to.y&&a.moved,'낙양 여울: 실제 부대의 양안 도하 실패');
  check(!a.acted,'낙양 여울: 도하가 공격 행동까지 소모함');
  Battle.act('retreat');
}
console.log('여울을 통한 양안 이동 검사 완료');

/* 애니메이션을 켠 실제 입력 경로: 물·적을 피해 직교 경로로, 이동 한도 안에서 행군한다. */
global.requestAnimationFrame=()=>1;global.cancelAnimationFrame=()=>{};pauseTimers=true;
for(const weighted of [false,true]) {
  Battle.start({siege:false,city:Game.state.cities['낙양'],playerSide:'atk',auto:false,
    atk:{name:'공격',color:'#4a6fd6',units:[mkU('하후돈',8000,'기병','봉시')]},
    def:{name:'수비',color:'#9a5a5a',units:[mkU(null,6000,'보병')]},onEnd(){}});
  const b=Battle.state,u=b.units.find(u=>u.side==='atk'),foe=b.units.find(u=>u.side==='def');
  b.terrain=Array.from({length:9},()=>Array(13).fill(0));u.x=0;u.y=1;
  foe.x=weighted?12:1;foe.y=weighted?8:0;
  if(weighted) [1,2,3].forEach(x=>b.terrain[1][x]=2);else b.terrain[1][1]=4;
  const tx=weighted?4:2;Battle.clickCell(0,1);Battle.act('move');Battle.clickCell(tx,1);
  check(!!u.anim && Array.isArray(u.anim.path),'행군 경로 애니메이션 누락');
  if(u.anim) {
    const path=u.anim.path;let cost=0;
    check(path[0].x===0&&path[0].y===1&&path.at(-1).x===tx&&path.at(-1).y===1,'행군 시작·도착 좌표 오류');
    path.forEach((p,i)=>{
      check(b.terrain[p.y][p.x]!==4,'행군 경로가 물 위를 통과');check(!(p.x===foe.x&&p.y===foe.y),'일반 행군이 적 부대를 관통');
      if(i){check(Math.abs(p.x-path[i-1].x)+Math.abs(p.y-path[i-1].y)===1,'행군 중 대각선 비행');cost+=b.terrain[p.y][p.x]===2?2:1;}
    });
    check(cost<=6,'화면 경로가 실제 이동 한도를 초과');check(u.moved&&!u.acted,'행군 후 공격 가능 상태가 사라짐');
    if(weighted)check(path.every(p=>b.terrain[p.y][p.x]!==2),'비싼 산길 대신 도달 가능한 우회로를 선택해야 함');
  }
}
pauseTimers=false;delete global.requestAnimationFrame;delete global.cancelAnimationFrame;
console.log('장애물·지형 비용을 반영한 행군 경로 검사 완료');

console.log(errors === 0 ? '\n[OK] 전투 테스트 통과' : '\n[FAIL] 오류 ' + errors + '건');
process.exit(errors === 0 ? 0 : 1);
