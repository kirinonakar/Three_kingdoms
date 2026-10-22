/* 실제 브라우저에서 GameAgent의 공개 관찰/행동만으로 플레이한다.
   node tools/agent_test.js (PLAYWRIGHT_MODULE로 설치된 Playwright 경로 지정 가능) */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('dialog', d => d.accept());          // 불러오기 확인 창은 승인한다
    const url = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
    await page.goto(url);
    assert.equal(page.url(), url);
    assert.equal(await page.title(), '삼국지 : 천하통일');
    const observe = () => page.evaluate(() => GameAgent.observe());
    const screenshot = async name => {
      if (process.env.AGENT_SCREENSHOT_DIR) await page.screenshot({
        path: path.join(process.env.AGENT_SCREENSHOT_DIR, 'three-kingdoms-agent-' + name + '.png')
      });
    };
    const act = async (query, value) => {
      const r = await page.evaluate(({ query, value }) => {
        const o = GameAgent.observe();
        const a = o.actions.find(a => Object.entries(query).every(([k, v]) => a[k] === v));
        if (!a) throw Error('행동 없음: ' + JSON.stringify(query));
        return GameAgent.act({ revision: o.revision, id: a.id, value });
      }, { query, value });
      assert.equal(r.ok, true, JSON.stringify(r.error));
      return r.observation;
    };
    const ready = async () => {
      const r = await page.evaluate(() => GameAgent.waitForReady({ timeoutMs: 30000 }));
      assert.equal(r.ok, true, JSON.stringify(r.error));
      return r.observation;
    };
    const pick = async () => {
      await act({ domId: 'pickRow0' });
      return act({ domId: 'pickOk' });
    };
    assert.equal((await observe()).phase, 'title');
    await act({ name: '조조 세력으로 시작' });
    let o = await observe();
    assert.equal(o.phase, 'strategy');
    assert.equal(o.strategy.cities.length, 30);
    assert(!o.strategy.officers.some(o => o.name === '제갈량'));
    assert.equal(o.strategy.selectedCity, '진류');

    // 원본 상태 보호, 모달 뒤 행동 차단, 오래된 관찰 재사용 거부.
    assert(await page.evaluate(() => {
      const o = GameAgent.observe(), original = o.strategy.cities[0].troops;
      o.strategy.cities[0].troops = -1;
      return GameAgent.observe().strategy.cities[0].troops === original;
    }));
    const stale = await page.evaluate(() => {
      const o = GameAgent.observe();
      GameAgent.act({ revision: o.revision, id: 'city:허창' });
      return GameAgent.act({ revision: o.revision, id: 'city:진류' });
    });
    assert.equal(stale.error.code, 'STALE_OBSERVATION');
    await act({ id: 'city:진류' });
    const beforeAdmin = (await observe()).strategy;
    await act({ name: '개발' });
    o = await observe();
    assert(o.dialog.title.includes('개발'));
    assert(!o.actions.some(a => a.type === 'city'));
    assert(o.controls.find(c => c.domId === 'pickOk').disabled);
    const blocked = await page.evaluate(() => {
      const o = GameAgent.observe();
      return GameAgent.act({ revision: o.revision, id: 'city:허창' });
    });
    assert.equal(blocked.error.code, 'UNAVAILABLE_ACTION');
    // 커스텀 선택 행도 키보드로 실행 가능하다.
    await page.locator('#pickRow0').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#pickRow0').getAttribute('aria-pressed'), 'true');
    await act({ domId: 'pickOk' });
    o = await observe();
    assert.equal(o.strategy.commands, beforeAdmin.commands - 1);
    assert(o.strategy.cities.find(c => c.name === '진류').agri > beforeAdmin.cities.find(c => c.name === '진류').agri);

    await act({ name: '이동' });
    await pick();
    o = await observe();
    const destination = o.actions.find(a => a.name.startsWith('허창'));
    assert(destination);
    await act({ id: destination.id });
    const amount = (await observe()).controls.find(c => c.domId === 'mvTroops');
    assert.equal(amount.name, '이동 병력');
    for (const value of [-1, 0.5, 'NaN', 'Infinity', amount.max + 1]) {
      const invalid = await page.evaluate(value => {
        const o = GameAgent.observe(), a = o.actions.find(a => a.domId === 'mvTroops');
        return GameAgent.act({ revision: o.revision, id: a.id, value });
      }, value);
      assert.equal(invalid.error.code, 'INVALID_VALUE');
      assert.equal(invalid.observation.controls.find(c => c.domId === 'mvTroops').value, amount.value);
    }
    await act({ domId: 'mvTroops' }, 0);
    const troops = (await observe()).strategy.cities.find(c => c.name === '진류').troops;
    await act({ name: '이동 실행' });
    o = await observe();
    assert.equal(o.strategy.selectedCity, '허창');
    assert.equal(o.strategy.cities.find(c => c.name === '진류').troops, troops);
    // 이름은 행 전체의 접근성 텍스트에 붙어 있으므로 이동한 무장 수로 검증한다.
    assert.equal(o.strategy.officers.filter(o => o.city === '허창' && o.faction === 'cao').length,
      beforeAdmin.officers.filter(o => o.city === '허창' && o.faction === 'cao').length + 1);

    await act({ domId: 'btnSave' });
    assert((await observe()).dialog.title.includes('수동저장'));
    await act({ domId: 'saveSlot2' });
    const saved = (await observe()).strategy;
    o = await act({ domId: 'btnEndTurn' });
    assert.equal(o.status, 'waiting');
    assert(!o.actions.some(a => a.type === 'city'));
    o = await ready();
    assert.equal(o.strategy.turn, saved.turn + 1);
    assert.equal(o.strategy.commands, o.strategy.maxCommands);
    // 月 자동 저장을 포함해 불러오기도 공개 UI를 통해 실행한다.
    await act({ domId: 'btnLoad' });
    o = await observe();
    assert(o.dialog && o.dialog.title.includes('불러오기'), '불러오기 슬롯 선택 창이 열리지 않음');
    await act({ domId: 'loadRow0' });             // 가장 최근 저장
    assert.equal((await observe()).strategy.turn, saved.turn + 1);

    o = await observe();
    const from = o.strategy.cities.find(c => c.owner === 'cao' && c.troops >= 1000 &&
      c.availableOfficers.length && c.links.some(n => o.strategy.cities.find(t => t.name === n).owner !== 'cao'));
    assert(from);
    await act({ id: 'city:' + from.name });
    await act({ name: '출진' });
    await pick();
    o = await observe();
    const targetName = from.links.find(n=>{
      const c=o.strategy.cities.find(t=>t.name===n);
      return c.owner!=='cao'&&!o.strategy.factions.find(f=>f.id==='cao').ally[c.owner];
    });
    assert(targetName);
    await act({id:'city:'+targetName});
    assert((await observe()).dialog.title.includes('출진 편성'));
    await act({ domId: 'br_0' }, '궁병');
    await act({ domId: 'fm_0' }, '학익');
    await act({ domId: 'tr_0' }, 2000);
    await act({ domId: 'autoBattle' }, false);
    o = await act({ name: '출진!' });
    if(o.status==='waiting')o=await ready();
    assert.equal(o.phase, 'battle');
    assert.equal(o.battle.tiles.length, 117);
    assert(o.battle.tiles.filter(t => t.terrain !== '성').every(t => t.fortOwner === null));
    assert(!o.actions.some(a => a.type === 'city'));
    const selection = o.actions.find(a => a.type === 'tile' && a.name === 'select');
    assert(selection);
    o = await act({ id: selection.id });
    assert.equal(o.battle.units.find(u => u.id === o.battle.selectedUnit).branch, '궁병');
    const move = o.actions.find(a => a.type === 'tile' && a.name === 'move');
    assert(move);
    o = await act({ id: move.id });
    const unit = o.battle.units.find(u => u.id === o.battle.selectedUnit);
    assert(unit.moved && !unit.acted);
    assert.equal(unit.x, move.x);
    assert.equal(unit.y, move.y);

    await act({ name: '전장 목록 · 좌표로 조작' });
    assert.equal(await page.locator('#bTextBoard button').count(), 117);
    assert(await page.locator('#bTextBoard button:enabled').count() > 0);
    await page.locator('.battle-bg').evaluate(async el => {
      await Promise.all(el.getAnimations().map(animation => animation.finished));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert(await page.evaluate(() => {
      const host = document.querySelector('.battle-map').getBoundingClientRect();
      const board = document.querySelector('.battle-directory').getBoundingClientRect();
      const canvas = document.getElementById('battleCanvas').getBoundingClientRect();
      return canvas.top >= host.top && canvas.bottom <= board.top && board.bottom <= host.bottom;
    }), '전장 표를 펼쳤을 때 캔버스/표가 패널 밖으로 벗어남');
    await screenshot('battle');
    o = await act({ name: '대기' });
    assert.equal(o.status, 'waiting');
    assert(!o.actions.some(a => a.type === 'tile'));
    await ready();
    await act({ name: '후퇴' });
    o = await ready();
    assert.equal(o.phase, 'strategy');
    await act({ name: '도시 목록 · 이름으로 선택' });
    assert.equal(await page.locator('#cityList button').count(), 30);
    await page.getByRole('button', { name: '허창 (아군)', exact: true }).click();
    assert.equal((await observe()).strategy.selectedCity, '허창');
    await screenshot('desktop');

    await page.setViewportSize({ width: 390, height: 844 });
    const beforeTraining = (await observe()).strategy.commands;
    await page.getByRole('button', { name: '훈련', exact: true }).click();
    assert((await observe()).dialog.title.includes('훈련'));
    await pick();
    assert.equal((await observe()).strategy.commands, beforeTraining - 1);
    await screenshot('mobile');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('[OK] Chromium file://: agent-only admin/move/month/save/load/deploy/battle, keyboard/DOM, stale/invalid/modal/busy guards, 390px layout, no console errors');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
