/* AI 에이전트용 관찰/조작 어댑터. 실제 화면의 컨트롤과 게임 입력 경로를 사용한다. */
window.GameAgent = (function () {
  'use strict';
  const ids = new WeakMap();
  let nextId = 1, revision = 0, signature = '', targets = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));
  const text = el => el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden';

  function strategy(g) {
    if (!g) return null;
    return clone({
      year: g.year, month: g.month, turn: g.turn, scenario:g.scenario || '194', playerFaction: g.pf,
      commands: g.cmd, maxCommands: g.cmdMax, selectedCity: g.sel, over: g.over,
      factions: Object.values(g.factions),
      economy: factionEconomy(g.pf),
      cities: Object.values(g.cities).map(c => ({
        name: c.name, owner: c.owner, links: c.links, agri: c.agri, comm: c.comm,
        def: c.def, order: c.order, pop: c.pop, troops: c.troops, training: c.training,
        morale: c.morale, size:citySize(c).label, troopCap: capOf(c),
        goldIncome: cityGoldIncome(c), foodIncome: cityFoodIncome(c),
        foodConsumption: cityFoodUpkeep(c),
        goldConsumption: cityGoldUpkeep(c),
        recruited: !!c.recruited,
        availableOfficers: g.officers.filter(o => o.city === c.name && o.status === 'active' &&
          o.faction === c.owner && !o.used).map(o => o.name)
      })),
      // 아직 등장하지 않은 인물과 UI 콜백/저장 내부 필드는 관찰에 포함하지 않는다.
      officers: g.officers.filter(o => o.status === 'active' || o.status === 'pow').map(o => ({
        name: o.name, faction: o.faction, city: o.city, status: o.status, used: o.used,
        wu: o.wu, zhi: o.zhi, pol: o.pol, cha: o.cha, skill: o.skill, loyalty: o.loyalty
      })),
      log: g.log.slice(-20)
    });
  }

  function observe() {
    const g = Game.state;
    const b = typeof Battle !== 'undefined' ? Battle.observation() : null;
    const title = document.body.classList.contains('title');
    const modal = document.querySelector('#modalRoot .modal');
    const phase = title || !g ? 'title' : b ? 'battle' : g.over ? 'gameOver' : 'strategy';
    // 방어 편성 창은 AI 턴 도중에 뜨지만 플레이어(또는 에이전트)가 직접 조작해야 한다
    const defDeploy = !!(g && g.ui && g.ui.defDeploy);
    const waiting = !title && (b ? b.busy || b.auto || b.over : !!(g &&
      ((g.ui && g.ui.attackIntro) || (g.aiRunning && !defDeploy))));
    const root = modal || (b ? document.getElementById('battleRoot') : document.getElementById('app'));
    const controls = [], actions = [];
    const currentTargets = new Map();
    if (root) root.querySelectorAll('button, input, select, summary, [role="button"]').forEach(el => {
      if (!visible(el) || el.closest('#bTextBoard') || el.hasAttribute('data-city')) return;
      if (el.tagName === 'INPUT' && !['number', 'text', 'checkbox', 'range'].includes(el.type)) return;
      if (!ids.has(el)) ids.set(el, 'ui:' + nextId++);
      const id = ids.get(el);
      const type = el.tagName === 'SELECT' ? 'select' : el.tagName !== 'INPUT' ? 'click' :
        el.type === 'checkbox' ? 'check' : 'fill';
      const row = el.closest('.row');
      const label = el.labels && Array.from(el.labels).map(text).join(' ');
      const name = el.getAttribute('aria-label') || label || text(el) || el.title || el.id;
      const disabled = !!el.disabled || el.getAttribute('aria-disabled') === 'true' ||
        (waiting && !['bAuto', 'bBgm', 'bSfx'].includes(el.id));
      const c = { id, type, name, disabled };
      if (el.id) c.domId = el.id;
      if (row) c.context = text(row);
      if (el.title) c.hint = el.title;
      if (el.hasAttribute('aria-pressed')) c.pressed = el.getAttribute('aria-pressed') === 'true';
      if (type === 'fill' || type === 'select') c.value = el.value;
      if (type === 'fill') {
        c.inputType = el.type;
        if (el.min !== '') c.min = Number(el.min);
        if (el.max !== '') c.max = Number(el.max);
        if (el.step) c.step = el.step;
      }
      if (type === 'check') c.value = el.checked;
      if (type === 'select') c.options = Array.from(el.options).map(o => ({ value: o.value, label: o.label, disabled: o.disabled }));
      if (el.tagName === 'SUMMARY') c.expanded = el.parentElement.open;
      controls.push(c);
      if (!disabled) { actions.push(c); currentTargets.set(id, { type, el }); }
    });
    if (!modal && !waiting && phase === 'strategy') Object.values(g.cities).forEach(c => {
      const id = 'city:' + c.name;
      actions.push({ id, type: 'city', name: c.name + ' 선택' });
      currentTargets.set(id, { type: 'city', city: c.name });
    });
    if (!modal && !waiting && b) b.tiles.filter(t => t.action).forEach(t => {
      const id = 'tile:' + t.x + ',' + t.y;
      actions.push({ id, type: 'tile', name: t.action, x: t.x, y: t.y });
      currentTargets.set(id, { type: 'tile', x: t.x, y: t.y });
    });
    const toast = document.getElementById('toast');
    const out = {
      version: 1, phase, status: waiting ? 'waiting' : phase === 'gameOver' ? 'finished' : 'ready',
      objective: '30개 도시를 모두 점령해 천하통일. 보유 도시가 0개면 패배.',
      dialog: modal ? { title: text(modal.querySelector('h2, h3')), text: text(modal) } : null,
      message: toast && toast.classList.contains('show') ? text(toast) : '',
      strategy: title ? null : strategy(g), battle: b,
      controls, actions
    };
    const next = JSON.stringify(out);
    if (next !== signature) { signature = next; revision++; }
    targets = currentTargets;
    return { revision, ...out };
  }

  function failure(code, message, observation) {
    return { ok: false, error: { code, message }, observation: observation || observe() };
  }

  // 한 번에 한 행동. 각 응답의 최신 revision/actions로 다음 행동을 결정한다.
  function act(request) {
    const before = observe();
    if (!request || request.revision !== before.revision)
      return failure('STALE_OBSERVATION', '최신 observe()의 revision으로 다시 요청하세요.', before);
    const target = targets.get(request.id);
    if (!target) return failure('UNAVAILABLE_ACTION', '현재 actions에 없는 행동입니다.', before);
    const el = target.el;
    if (target.type === 'fill') {
      const value = request.value;
      if (!['string', 'number'].includes(typeof value)) return failure('INVALID_VALUE', '문자열 또는 숫자를 입력하세요.', before);
      if (el.type === 'number' || el.type === 'range') {
        const n = Number(value);
        if (String(value).trim() === '' || !Number.isFinite(n) ||
          (el.min !== '' && n < Number(el.min)) || (el.max !== '' && n > Number(el.max)))
          return failure('INVALID_VALUE', '입력 범위 안의 유한한 숫자가 필요합니다.', before);
        const step = el.step === 'any' ? 0 : Number(el.step || 1);
        const base = Number(el.min || 0);
        if (step > 0 && Math.abs((n - base) / step - Math.round((n - base) / step)) > 1e-8)
          return failure('INVALID_VALUE', '입력 단위(step)에 맞는 값이 필요합니다.', before);
      }
      el.value = el.type === 'number' || el.type === 'range' ? String(Number(value)) : String(value);
    } else if (target.type === 'select') {
      if (!Array.from(el.options).some(o => !o.disabled && o.value === request.value))
        return failure('INVALID_VALUE', 'options에 있는 값을 선택하세요.', before);
      el.value = request.value;
    } else if (target.type === 'check') {
      if (typeof request.value !== 'boolean') return failure('INVALID_VALUE', 'true 또는 false가 필요합니다.', before);
      // 네이티브 클릭을 사용해 체크박스의 이벤트 순서도 UI와 같게 유지한다.
      if (el.checked !== request.value) el.click();
    } else if (target.type === 'city') {
      // 지도 클릭과 같은 경로 — 이동 목적지를 고르는 중이면 도시 클릭이 목적지 선택이 된다
      const mv = Game.state && Game.state.ui ? Game.state.ui.move : null;
      if (mv && mv.picking) {
        if (mv.from === target.city || Game.moveTargets(mv.from).indexOf(target.city) < 0)
          return failure('UNAVAILABLE_ACTION', '이동 목적지로 고를 수 없는 도시입니다.', before);
        Game.chooseMoveTarget(target.city);
      } else {
        Game.selectCity(target.city);
      }
    } else if (target.type === 'tile') {
      if (!Battle.clickCell(target.x, target.y)) return failure('UNAVAILABLE_ACTION', '전장 상태가 변경되었습니다.');
    } else {
      el.click();
    }
    if (target.type === 'fill' || target.type === 'select') {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, observation: observe() };
  }

  async function waitForReady(options = {}) {
    const timeoutMs = options.timeoutMs === undefined ? 15000 : options.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 60000)
      return failure('INVALID_TIMEOUT', 'timeoutMs는 0~60000 사이여야 합니다.');
    const until = Date.now() + timeoutMs;
    let observation = observe();
    while (observation.status === 'waiting' && Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(0, until - Date.now()))));
      observation = observe();
    }
    return observation.status === 'waiting' ? failure('TIMEOUT', '아직 진행 중입니다.', observation) : { ok: true, observation };
  }

  return Object.freeze({ version: 1, observe, act, waitForReady });
})();
