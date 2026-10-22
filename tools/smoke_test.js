/* =====================================================
   삼국지 : 천하통일 — 헤드리스 스모크 테스트
   실행: node sangokji/tools/smoke_test.js
   - 데이터 무결성 검사 (도시/무장/세력/연결)
   - DOM을 스텁으로 대체해 실제 게임 루프를 수십 개월 진행
   - 저장/불러오기 라운드트립 확인
   ===================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ── 최소 DOM 스텁 ──────────────────────────────────── */
function makeCtx() {
  return new Proxy({}, {
    get: (t, p) => (p in t ? t[p] : () => {}),
    set: (t, p, v) => { t[p] = v; return true; }
  });
}
const els = {};
function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', checked: false, disabled: false,
    scrollTop: 0, scrollHeight: 0, width: 1000, height: 700,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, remove() {}, focus() {},
    getContext() { return makeCtx(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 700 }; }
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
global.setTimeout = fn => { fn(); return 0; };
global.clearTimeout = () => {};
global.requestAnimationFrame = fn => { fn(); return 0; };
global.alert = () => {};

/* ── Battle 스텁 (전술 화면 대신 즉시 판정) ─────────── */
global.Battle = {
  start(opts) {
    const mk = us => us.map(u => ({ name: u.officer ? u.officer.name : '', troops: Math.round(u.troops * (0.35 + Math.random() * 0.55)) }));
    const atk = mk(opts.atk.units || []), def = mk(opts.def.units || []);
    const pa = atk.reduce((s, u) => s + u.troops, 0) * (0.75 + Math.random() * 0.5);
    const pd = def.reduce((s, u) => s + u.troops, 0) * (0.95 + Math.random() * 0.5);
    const winner = pa >= pd ? 'attacker' : 'defender';
    setTimeout(() => opts.onEnd({ winner, atk, def, captured: [] }), 0);
  }
};

/* ── 소스 로드 ──────────────────────────────────────── */
const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
const gameSrc = fs.readFileSync(path.join(ROOT, 'js', 'combat-rules.js'), 'utf8') + '\n' + ['strategy-systems.js','save-transfer.js','game.js'].map(f=>fs.readFileSync(path.join(ROOT,'js',f),'utf8')).join('\n');
const battleSrc = fs.readFileSync(path.join(ROOT, 'js', 'battle.js'), 'utf8');

// 데이터 테이블을 테스트 쪽으로 꺼내온다 (eval 완료값 사용)
const DATA = eval(dataSrc + '\n({ CITY_DEFS, OFFICER_DEFS, FACTIONS, SKILLS, FORMS, BRANCHES, SCENARIO, LEADERS, DIFFICULTY });');
// 게임 본체 로드 (같은 스코프에 데이터 포함) → window.Game 노출
eval(dataSrc + '\n' + gameSrc);
// battle.js 는 로드만 (IIFE 정의 → window.Battle 덮어씀) 후 스텁 복원
try {
  eval(battleSrc);
} catch (e) {
  console.error('battle.js 로드 실패: ' + e.message);
}
if (global.Battle && !global.Battle.start) { /* IIFE 정상 로드 */ }
global.Battle = {
  start(opts) {
    const mk = us => us.map(u => ({ name: u.officer ? u.officer.name : '', troops: Math.round(u.troops * (0.35 + Math.random() * 0.55)) }));
    const atk = mk(opts.atk.units || []), def = mk(opts.def.units || []);
    const pa = atk.reduce((s, u) => s + u.troops, 0) * (0.75 + Math.random() * 0.5);
    const pd = def.reduce((s, u) => s + u.troops, 0) * (0.95 + Math.random() * 0.5);
    const winner = pa >= pd ? 'attacker' : 'defender';
    setTimeout(() => opts.onEnd({ winner, atk, def, captured: [] }), 0);
  }
};

const Game = global.Game;
if (!Game) { console.error('FAIL: Game API를 찾을 수 없습니다'); process.exit(1); }

const { CITY_DEFS, OFFICER_DEFS, FACTIONS, SKILLS, LEADERS } = DATA;

/* ── 데이터 무결성 검사 ─────────────────────────────── */
let errors = 0;
function check(cond, msg) { if (!cond) { errors++; console.error('  X ' + msg); } }

const cityNames = CITY_DEFS.map(c => c[0]);
check(new Set(cityNames).size === cityNames.length, '도시 이름 중복');
const facIds = FACTIONS.map(f => f[0]);
CITY_DEFS.forEach(c => {
  check(facIds.includes(c[4]), '도시 ' + c[0] + ': 알 수 없는 세력 ' + c[4]);
  check(c[3].length > 0, '도시 ' + c[0] + ': 인접 도시 없음');
  c[3].forEach(m => {
    const d = CITY_DEFS.find(x => x[0] === m);
    check(!!d, '도시 ' + c[0] + ': 알 수 없는 인접 ' + m);
    if (d) check(d[3].includes(c[0]), '연결 비대칭: ' + c[0] + ' <-> ' + m);
  });
  check(c[1] >= 0 && c[1] <= 1000 && c[2] >= 0 && c[2] <= 700, '도시 ' + c[0] + ': 좌표 범위 밖');
});
CITY_DEFS.forEach((a, i) => CITY_DEFS.forEach((b, j) => {
  if (i < j) {
    const d = Math.hypot(a[1] - b[1], a[2] - b[2]);
    if (d < 42) console.warn('  ! 도시 근접(겹침 위험): ' + a[0] + ' <-> ' + b[0] + ' (' + Math.round(d) + 'px)');
  }
}));
const offNames = OFFICER_DEFS.map(o => o[0]);
check(new Set(offNames).size === offNames.length, '무장 이름 중복');
OFFICER_DEFS.forEach(o => {
  check(cityNames.includes(o[2]), '무장 ' + o[0] + ': 알 수 없는 도시 ' + o[2]);
  check(facIds.includes(o[1]) || o[1] === 'free', '무장 ' + o[0] + ': 알 수 없는 세력 ' + o[1]);
  check(!!SKILLS[o[7]] || o[7] === '', '무장 ' + o[0] + ': 알 수 없는 특기 ' + o[7]);
});
const perFaction = {};
CITY_DEFS.forEach(c => { perFaction[c[4]] = (perFaction[c[4]] || 0) + 1; });
FACTIONS.forEach(f => check((perFaction[f[0]] || 0) > 0, '세력 ' + f[1] + ': 도시 없음'));
FACTIONS.forEach(f => check(OFFICER_DEFS.some(o => o[1] === f[0]), '세력 ' + f[1] + ': 무장 없음'));
// 초기 병력은 인구 상한(인구 × 1,000)을 넘지 않아야 한다
CITY_DEFS.forEach(c => check(c[10] <= c[9] * 1000,
  '도시 ' + c[0] + ': 초기 병력이 인구 상한 초과 (' + c[10] + ' > ' + c[9] * 1000 + ')'));
console.log('데이터: 도시 ' + CITY_DEFS.length + ' · 세력 ' + FACTIONS.length + ' · 무장 ' + OFFICER_DEFS.length + ' · 오류 ' + errors + '건');
console.log('세력별 도시: ' + FACTIONS.map(f => f[1] + ' ' + (perFaction[f[0]] || 0)).join(' / '));

/* ── 시작 상태 · 지휘 체계 · 병력 배분 ───────────────── */
Game.startNew('cao');
{
  const g = Game.state;
  FACTIONS.forEach(f => {
    const leader = g.officers.find(o => o.name === LEADERS[f[0]]);
    check(!!leader && leader.faction === f[0], '세력 ' + f[1] + ': 수장 ' + LEADERS[f[0]] + ' 없음');
    check(leader && leader.loyalty === 100, '세력 ' + f[1] + ': 수장 충성도 100 아님');
  });
  const hc = g.cities['허창'];
  hc.troops = 7777;
  const du = Game._debug.defenseUnits('허창');
  const dsum = du.reduce((s, u) => s + u.troops, 0);
  check(dsum === 7777, '수비 병력 배분 합계 오류 (' + dsum + ' ≠ 7777)');
  du.forEach(u => check(u.troops >= 0, '수비 병력 음수'));
  // 방어전 편성 — 무장별 병과·진형·병력 지정과 예비 병력 계산
  const dp = Game._debug.defensePlan('허창');
  const built = Game._debug.defenseUnitsFrom('허창', dp);
  check(built.units.reduce((s, u) => s + u.troops, 0) + built.reserve === 7777, '수비 편성 병력 합계 오류');
  check(built.units.every(u => DATA.FORMS[u.form] && u.troops > 0), '수비 편성 부대 구성 오류');
  dp.forms[dp.names[0]] = '학익';
  check(Game._debug.defenseUnitsFrom('허창', dp).units[0].form === '학익', '수비 편성 진형 지정 오류');
  const au = Game._debug.aiUnits('허창', 3000);
  const asum = au.reduce((s, u) => s + u.troops, 0);
  check(asum === 3000, 'AI 병력 배분 합계 오류 (' + asum + ' ≠ 3000)');
  const sp = Game._debug.distribute(100, 3);
  check(sp.length === 3 && sp.reduce((s, v) => s + v, 0) === 100, 'distribute 합계 오류');
  console.log('시작 상태 검사: 수장 ' + Object.keys(LEADERS).length + '명 · 병력 배분 OK');
}

/* ── 무장 1개월 1회 행동 ───────────────────────────── */
Game.startNew('cao');
{
  const g = Game.state;
  const o0 = g.officers.find(o => o.faction === 'cao' && o.city === '허창');
  Game._debug.markUsed([o0.name]);
  check(o0.used === true, '무장 행동 플래그 설정 실패');
  check(Game._debug.availableOfficers('허창').every(o => o.name !== o0.name),
    '행동 완료 무장이 선택 가능 목록에 포함됨');
  Game.endTurn();
  check(o0.used === false, '월 변경 시 무장 행동 플래그 초기화 실패');
  console.log('무장 1개월 1회 행동 OK');
}

/* ── 명령별 무장 정렬 ───────────────────────────────── */
Game.startNew('cao');
{
  const S = Game._debug.PICK_SCORE;
  const atk = Game._debug.pickSorted('허창', S.attack);
  check(atk.length > 1 && atk[0].name === '전위', '출진 정렬 오류: ' + (atk[0] && atk[0].name));
  const adm = Game._debug.pickSorted('허창', S.admin);
  check(adm.length > 1 && adm[0].name === '만총', '내정 정렬 오류: ' + (adm[0] && adm[0].name));
  const rec = Game._debug.pickSorted('허창', S.recruit);
  check(rec.length > 1 && rec[0].name === '조조', '징병 정렬 오류: ' + (rec[0] && rec[0].name));
  Game._debug.markUsed(['전위']);
  check(Game._debug.pickSorted('허창', S.attack).every(o => o.name !== '전위'),
    '정렬 목록에 행동 완료 무장 포함');
  console.log('명령별 무장 정렬 OK');
}

/* ── 초반 2개월 플레이어 보호 ───────────────────────── */
Game.startNew('liubei');
Game.endTurn();
Game.endTurn();
check(Game.state && Object.keys(Game.state.cities).some(n => Game.state.cities[n].owner === 'liubei'),
  '초반 2개월 수비 보호 실패 (유비 도시 상실)');

/* ── 게임 진행 시뮬레이션 ───────────────────────────── */
function invariants(tag) {
  const G = Game.state;
  Object.keys(G.cities).forEach(n => {
    const c = G.cities[n];
    check(!!G.factions[c.owner], tag + ' 도시 ' + n + ' 소유자 이상: ' + c.owner);
    check(c.troops >= 0, tag + ' 도시 ' + n + ' 병력 음수');
    check(c.agri >= 0 && c.agri <= 100 && c.comm >= 0 && c.comm <= 100 && c.def >= 0 && c.def <= 100 && c.order >= 0 && c.order <= 100,
      tag + ' 도시 ' + n + ' 내정 수치 범위 이탈');
  });
  G.officers.forEach(o => {
    if (o.status === 'active') check(!!G.cities[o.city], tag + ' 무장 ' + o.name + ' 위치 이상: ' + o.city);
    check(!!G.factions[o.faction] || o.faction === 'free', tag + ' 무장 ' + o.name + ' 소속 이상: ' + o.faction);
  });
  check(G.cmd >= 0, tag + ' 명령권 음수');
}

function run(seedFaction, months) {
  Game.startNew(seedFaction);
  for (let i = 0; i < months; i++) {
    if (Game.state.over) break;
    Game.endTurn();
    invariants(seedFaction + ' ' + (i + 1) + '개월');
  }
  const G = Game.state;
  const counts = {};
  Object.keys(G.cities).forEach(n => { const o = G.cities[n].owner; counts[o] = (counts[o] || 0) + 1; });
  const mine = counts[seedFaction] || 0;
  const rank = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 4)
    .map(id => (G.factions[id] ? G.factions[id].name : id) + '(' + counts[id] + ')').join(' · ');
  console.log('[' + seedFaction + '] ' + months + '개월 → ' + G.year + '년 ' + G.month + '월 · 내 도시 ' + mine +
    ' · 순위: ' + rank + (G.over ? ' [게임 종료]' : ''));
}

run('cao', 36);
run('liubei', 24);
run('gongsun', 24);

/* ── 저장/불러오기 라운드트립 ───────────────────────── */
Game.saveGame(true);
const size = JSON.stringify(Game.state).length;
Game.loadGame();
check(!!Game.state && !!Game.state.cities, '불러오기 실패');
console.log('저장/불러오기 OK (JSON ' + size.toLocaleString() + ' bytes)');

/* ── 아군 포로 해방 ─────────────────────────────────── */
Game.startNew('cao');
{
  const g = Game.state;
  const host = g.officers.find(o => o.faction === 'lijue' && o.city === '낙양' && o.status === 'active');
  host.faction = 'cao'; host.status = 'pow'; host.city = '낙양';
  const atk = g.officers.find(o => o.faction === 'cao' && o.name === '조조');
  Game._debug.applyBattleResult({ atk: 'cao', def: 'lijue', from: '허창', to: '낙양' },
    { winner: 'attacker', atk: [{ name: atk.name, troops: 5000 }], def: [], captured: [] });
  check(g.cities['낙양'].owner === 'cao', '전투 결과: 도시 소유권 미반영');
  check(host.status === 'active', '아군 포로가 해방되지 않음');
  console.log('포로 해방 OK');
}

/* ── 시기별 무장 등장 ───────────────────────────────── */
Game.startNew('cao');
{
  const g = Game.state;
  const zgl = g.officers.find(o => o.name === '제갈량');
  const gj = g.officers.find(o => o.name === '강유');
  check(!!zgl && zgl.status === 'hidden', '제갈량이 194년에 이미 등장함');
  check(!!gj && gj.status === 'hidden', '강유가 194년에 이미 등장함');
  g.year = 207;
  Game._debug.debutOfficers();
  check(zgl.status === 'active', '제갈량이 207년에 등장하지 않음');
  check(zgl.faction === 'free' || zgl.faction === 'liubei', '제갈량 소속 이상: ' + zgl.faction);
  check(gj.status === 'hidden', '강유가 207년에 등장함');
  g.year = 228;
  Game._debug.debutOfficers();
  check(gj.status === 'active', '강유가 228년에 등장하지 않음');
  console.log('시기별 무장 등장 OK');
}

console.log(errors === 0 ? '\n[OK] 모든 검사 통과' : '\n[FAIL] 오류 ' + errors + '건');
process.exit(errors === 0 ? 0 : 1);
