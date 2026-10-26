/* 신무장 원본은 게임 저장과 별도로 보관한다. 게임에 배치한 뒤에는 게임 상태가 독립한다. */
'use strict';
const CustomOfficers = (() => {
  const KEY = 'sangokji_custom_officers_v1', MAX = 20, PHOTO_SIZE = 512, PHOTO_MAX = 65536;
  let atTitle = true, editing = null, photo = '', photoBusy = false, photoEpoch = 0, pending = null;
  const html = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeName = name => typeof name === 'string' && name === name.trim() && !Object.hasOwn(Object.prototype,name) && name !== 'prototype' && /^[\p{L}\p{N} .·_-]{1,20}$/u.test(name);
  const validPhoto = src => typeof src === 'string' && (src === '' || (src.length <= PHOTO_MAX && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)));
  function validate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !safeName(raw.name) || OFFICER_DEFS.some(o => o[0] === raw.name)) throw Error('이름은 기존 무장과 겹치지 않는 1~20자의 문자·숫자·공백으로 입력하세요');
    for (const k of ['wu','zhi','pol','cha']) if (!Number.isInteger(raw[k]) || raw[k] < 1 || raw[k] > 100) throw Error('능력치는 1~100의 정수여야 합니다');
    const honor = raw.honor === undefined ? defaultOfficerHonor(raw.name) : raw.honor;
    if (!Number.isInteger(honor) || honor < 0 || honor > 100) throw Error('의리는 0~100의 정수여야 합니다');
    if (typeof raw.skill !== 'string' || (raw.skill !== '' && !Object.hasOwn(SKILLS, raw.skill))) throw Error('지원하지 않는 특기입니다');
    const talent = raw.talent === undefined ? '' : raw.talent;
    if (typeof talent !== 'string' || (talent !== '' && !Object.hasOwn(CombatRules.talents, talent))) throw Error('지원하지 않는 전투 속성입니다');
    if (!CITY_DEFS.some(c => c[0] === raw.city)) throw Error('배속 도시가 잘못되었습니다');
    if (typeof raw.ruler !== 'boolean' || !validPhoto(raw.portrait)) throw Error('군주 설정 또는 사진 형식이 잘못되었습니다');
    return {name:raw.name, wu:raw.wu, zhi:raw.zhi, pol:raw.pol, cha:raw.cha, honor, skill:raw.skill, talent, city:raw.city, ruler:raw.ruler, portrait:raw.portrait};
  }
  function validateList(list) {
    if (!Array.isArray(list) || list.length > MAX) throw Error('신무장은 최대 ' + MAX + '명까지 등록할 수 있습니다');
    const result = list.map(validate), names = new Set(result.map(o => o.name));
    if (names.size !== result.length) throw Error('중복된 신무장 이름이 있습니다');
    return result;
  }
  function parse(text) {
    if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw Error('신무장 JSON은 2MB 이하여야 합니다');
    const data = JSON.parse(text, (key, value) => {
      if (['__proto__','prototype','constructor'].includes(key)) throw Error('허용되지 않는 필드입니다');
      return value;
    });
    if (!data || data.format !== 'three-kingdoms-officers' || data.version !== 1) throw Error('지원하는 신무장 JSON 형식이 아닙니다');
    return validateList(data.officers);
  }
  function read() {
    const saved = localStorage.getItem(KEY);
    return saved ? parse(saved) : [];
  }
  const serialize = list => JSON.stringify({format:'three-kingdoms-officers', version:1, officers:validateList(list)}, null, 2);
  function write(list) {
    const text = serialize(list);
    try { localStorage.setItem(KEY, text); }
    catch (_) { throw Error('브라우저 저장 공간이 부족합니다. 저장 파일을 정리하거나 사진 크기를 줄이세요'); }
  }
  function checkAssignments(list, cityDefs) {
    const rulers = new Map();
    for (const o of list.filter(o => o.ruler)) {
      const fid = cityDefs.find(c => c[0] === o.city)?.[4];
      if (!fid) throw Error(o.city + '에는 배치할 수 없습니다');
      if (rulers.has(fid)) throw Error(rulers.get(fid) + '·' + o.name + '의 군주 설정이 같은 세력에 겹칩니다. 한 명만 군주로 설정하세요');
      rulers.set(fid,o.name);
    }
  }
  function checkNewGame(s) {
    try { checkAssignments(read(),scenarioCities(s)); return true; }
    catch (e) { toast('신무장 설정 확인: ' + e.message); return false; }
  }
  function entries() { try { return read(); } catch (_) { return []; } }
  const scenario = () => scenarioById(atTitle ? chosenScenario : G.scenario);
  function ready() { return atTitle || !!(G && !G.aiRunning && !G.battleActive && !attackIntro && !G.over && !G.ui.move && !G.ui.attack && !G.ui.defDeploy); }
  function guard() { if (ready()) return true; toast('전투·월 진행·명령을 마친 뒤 신무장을 관리하세요'); return false; }
  function open(title = false) {
    atTitle = !!title;
    if (!guard()) return;
    pending = null; photoEpoch++;
    try { render(); } catch (e) { toast('신무장 열기 실패: ' + e.message); }
  }
  function leave() { photoEpoch++; pending = null; if (atTitle) startScreen(); else closeModal(); }
  function render() {
    const list = read();
    showModal('<h3>신무장 등록 · ' + list.length + ' / ' + MAX + '명</h3>' +
      '<p class="muted">등록한 무장은 모든 새 게임에 자동 배치됩니다. 도시 소유 세력에 합류하며, 군주 교체 시 기존 군주는 일반 무장으로 남습니다. 진행 중인 게임에는 [배치]로 반영하세요.</p>' +
      '<div class="custom-toolbar"><button class="primary" onclick="CustomOfficers.edit()">새 무장 등록</button><button onclick="CustomOfficers.importFile()">JSON 가져오기</button><button onclick="CustomOfficers.exportFile()"' + (!list.length ? ' disabled' : '') + '>JSON 내보내기</button></div>' +
      '<div class="custom-list">' + (list.map((o, i) => '<article class="custom-card">' +
        (o.portrait ? '<img class="custom-thumb" src="' + o.portrait + '" alt="' + html(o.name) + ' 초상화">' : '<span class="custom-thumb custom-initial" aria-hidden="true">' + html(o.name[0]) + '</span>') +
        '<div class="custom-info"><b>' + html(o.name) + '</b><p>' + html(o.city) + ' · ' + (o.ruler ? '군주 교체' : '일반 무장') + ' · ' + html(o.skill || '특기 없음') + ' · ' + html(o.talent || '전투 속성 없음') + '</p><p>무 ' + o.wu + ' · 지 ' + o.zhi + ' · 정 ' + o.pol + ' · 매 ' + o.cha + ' · 의리 ' + o.honor + '</p></div>' +
        '<div class="custom-actions"><button onclick="CustomOfficers.edit(' + i + ')">수정</button>' + (!atTitle ? '<button onclick="CustomOfficers.deploy(' + i + ')">배치</button>' : '') + '<button onclick="CustomOfficers.remove(' + i + ')">삭제</button></div></article>').join('') || '<p class="muted">아직 등록한 신무장이 없습니다.</p>') + '</div>' +
      '<p class="muted">사진도 JSON에 포함됩니다. 등록부 삭제·가져오기는 이미 진행 중인 게임의 무장을 변경하지 않습니다.</p>' +
      '<div class="foot"><button onclick="CustomOfficers.leave()">' + (atTitle ? '시작 화면으로' : '닫기') + '</button></div>', {closable:false});
  }
  function edit(index) {
    if (!guard()) return;
    try {
      const list = read();
      if (index !== undefined && !list[index]) return;
      if (index === undefined && list.length >= MAX) throw Error('신무장은 최대 ' + MAX + '명입니다');
      editing = index === undefined ? null : list[index].name;
      const s = scenario(), cities = scenarioCities(s);
      const o = index === undefined ? {name:'',wu:70,zhi:70,pol:70,cha:70,honor:70,skill:'',talent:'',city:(!atTitle && G.sel) || cities[0][0],ruler:false,portrait:''} : list[index];
      photoEpoch++; photo = o.portrait; photoBusy = false;
      showModal('<h3>' + (editing ? '신무장 수정' : '새 무장 등록') + '</h3><form id="customForm" onsubmit="event.preventDefault();CustomOfficers.saveForm()">' +
        '<div class="custom-editor"><div class="custom-photo"><div id="customPhotoPreview">' + previewHtml() + '</div>' +
        '<label for="customPhoto">사진 선택 (JPG · PNG · WebP)</label><input id="customPhoto" type="file" accept="image/jpeg,image/png,image/webp" onchange="CustomOfficers.selectPhoto(this)">' +
        '<button type="button" onclick="CustomOfficers.clearPhoto()">사진 제거</button><p class="muted">최대 10MB · 사진 위쪽을 기준으로 정사각형으로 잘라 512×512로 저장합니다.</p></div>' +
        '<div class="custom-fields"><label for="customName">이름</label><input id="customName" maxlength="20" required value="' + html(o.name) + '"' + (editing ? ' readonly' : '') + ' placeholder="신무장 이름">' +
        '<div class="custom-stats">' + [['wu','무력'],['zhi','지력'],['pol','정치'],['cha','매력']].map(([key,label]) => '<label for="custom-' + key + '">' + label + '<input id="custom-' + key + '" type="number" required min="1" max="100" step="1" value="' + o[key] + '"></label>').join('') + '</div>' +
        '<label for="customHonor">의리 (0~100)</label><input id="customHonor" type="number" required min="0" max="100" step="1" value="' + o.honor + '">' +
        '<p class="muted">높을수록 충성도가 덜 떨어지고 적 소속일 때 등용이 어렵습니다. 포로가 된 뒤에도 설득이 쉬워지기까지 더 오래 걸립니다. 플레이 중 무장 정보에는 표시하지 않습니다.</p>' +
        '<label for="customSkill">특기</label><select id="customSkill" onchange="CustomOfficers.updateTraits()"><option value="">없음</option>' + Object.keys(SKILLS).map(k => '<option' + (k === o.skill ? ' selected' : '') + '>' + html(k) + '</option>').join('') + '</select>' +
        '<p id="customSkillDesc" class="muted">' + html(SKILLS[o.skill]?.desc || '특기 효과 없음') + '</p>' +
        '<label for="customTalent">전투 속성</label><select id="customTalent" onchange="CustomOfficers.updateTraits()"><option value="">없음</option>' + Object.keys(CombatRules.talents).map(k => '<option' + (k === o.talent ? ' selected' : '') + '>' + html(k) + '</option>').join('') + '</select>' +
        '<p id="customTalentDesc" class="muted">' + html(CombatRules.talents[o.talent]?.desc || '전투 속성 효과 없음') + '</p>' +
        '<p class="muted">무쌍·인덕 등의 특기 1개와 비장·신산 등의 전투 속성 1개를 함께 설정할 수 있습니다. 전투 속성은 해당 행동을 할 때 발동하며, 주변 지휘 효과는 가장 강한 하나만 적용됩니다.</p>' +
        '<label for="customCity">배속 도시 · ' + html(s.name) + '</label><select id="customCity">' + cities.map(c => {
          const owner = atTitle ? c[4] : G.cities[c[0]].owner;
          const name = atTitle ? (s.names?.[owner] || scenarioFactions(s).find(f => f[0] === owner)?.[1]) : G.factions[owner].name;
          return '<option value="' + html(c[0]) + '"' + (c[0] === o.city ? ' selected' : '') + '>' + html(c[0] + ' · ' + name) + '</option>';
        }).join('') + '</select><label class="custom-ruler"><input id="customRuler" type="checkbox"' + (o.ruler ? ' checked' : '') + '> 이 도시 소유 세력의 군주를 교체</label>' +
        '<p class="muted">군주가 되면 충성도 100, 세력명은 신무장 이름으로 바뀝니다. 새 게임은 선택한 시나리오의 도시 소유 세력을 따릅니다.</p></div></div>' +
        '<div class="foot"><button type="button" onclick="CustomOfficers.open(' + atTitle + ')">취소</button><button id="customSubmit" type="submit" class="primary">등록부 저장</button></div></form>', {closable:false});
    } catch (e) { toast(e.message); }
  }
  function updateTraits() {
    $('customSkillDesc').textContent = SKILLS[$('customSkill').value]?.desc || '특기 효과 없음';
    $('customTalentDesc').textContent = CombatRules.talents[$('customTalent').value]?.desc || '전투 속성 효과 없음';
  }
  function previewHtml() { return photo ? '<img class="custom-preview" src="' + photo + '" alt="선택한 무장 사진">' : '<span class="custom-preview custom-initial">사진 없음</span>'; }
  function updatePhoto() { const el = $('customPhotoPreview'); if (el) el.innerHTML = previewHtml(); }
  function clearPhoto() { photoEpoch++; photoBusy = false; photo = ''; if ($('customPhoto')) $('customPhoto').value = ''; if ($('customSubmit')) $('customSubmit').disabled = false; updatePhoto(); }
  async function selectPhoto(input) {
    const file = input.files?.[0]; if (!file) return;
    const token = ++photoEpoch;
    photoBusy = true; $('customSubmit').disabled = true;
    let url;
    try {
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw Error('10MB 이하의 JPG·PNG·WebP 사진을 선택하세요');
      url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(Error('사진을 읽을 수 없습니다')); img.src = url; });
      if (token !== photoEpoch) return;
      if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 40000000) throw Error('사진은 4천만 화소 이하여야 합니다');
      const cv = document.createElement('canvas'); cv.width = cv.height = PHOTO_SIZE;
      const ctx = cv.getContext('2d'), side = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.fillStyle = '#1c271f'; ctx.fillRect(0,0,PHOTO_SIZE,PHOTO_SIZE);
      ctx.drawImage(img,(img.naturalWidth-side)/2,0,side,side,0,0,PHOTO_SIZE,PHOTO_SIZE);
      let src = cv.toDataURL('image/jpeg', .82);
      if (src.length > PHOTO_MAX) src = cv.toDataURL('image/jpeg', .55);
      if (!validPhoto(src)) throw Error('사진 용량을 줄일 수 없습니다. 다른 사진을 선택하세요');
      photo = src; updatePhoto();
    } catch (e) { if (token === photoEpoch) toast(e.message); }
    finally { if (url) URL.revokeObjectURL(url); if (token === photoEpoch) { photoBusy = false; if ($('customSubmit')) $('customSubmit').disabled = false; } }
  }
  function saveForm() {
    if (!guard() || photoBusy) return;
    try {
      const raw = {name:$('customName').value.trim(), skill:$('customSkill').value, talent:$('customTalent').value, city:$('customCity').value, ruler:$('customRuler').checked, portrait:photo};
      raw.honor = $('customHonor').value === '' ? NaN : Number($('customHonor').value);
      for (const k of ['wu','zhi','pol','cha']) raw[k] = Number($('custom-' + k).value);
      const o = validate(raw), list = read(), index = list.findIndex(p => p.name === editing);
      if (editing && o.name !== editing) throw Error('등록한 무장의 이름은 변경할 수 없습니다');
      if (index < 0 && list.some(p => p.name === o.name)) throw Error('이미 등록한 이름입니다');
      if (index < 0) list.push(o); else list[index] = o;
      if (atTitle) checkAssignments(list,scenarioCities(scenario()));
      write(list); photoEpoch++; render(); toast('등록부에 저장했습니다' + (atTitle ? ' · 새 게임 시작 시 반영됩니다' : ' · [배치]를 눌러 현재 게임에 반영하세요'));
    } catch (e) { toast('등록 실패: ' + e.message); }
  }
  function remove(index) {
    if (!guard()) return;
    try { const list = read(), o = list[index]; if (!o) return;
      if (!confirm(o.name + '을(를) 등록부에서 삭제할까요? 현재 게임에 배치된 무장은 유지됩니다.')) return;
      list.splice(index,1); write(list); render();
    } catch (e) { toast('삭제 실패: ' + e.message); }
  }
  function apply(raw, game) {
    const p = validate(raw), city = game.cities[p.city], old = game.officers.find(o => o.name === p.name);
    if (!city || !game.factions[city.owner]) throw Error('배속할 도시 또는 세력이 없습니다');
    if (old && !old.custom) throw Error('기존 무장과 이름이 겹칩니다');
    if (old && (old.status === 'pow' || old.status === 'retired')) throw Error('포로·은퇴 상태의 신무장은 다시 배치할 수 없습니다');
    if (!old && game.officers.filter(o => o.custom).length >= MAX) throw Error('현재 게임의 신무장은 최대 ' + MAX + '명입니다');
    const leading = old && Object.entries(game.leaders).find(([fid,name]) => name === old.name && Object.values(game.cities).some(c => c.owner === fid));
    if (leading && (leading[0] !== city.owner || !p.ruler)) throw Error('현재 군주는 다른 세력으로 옮기거나 일반 무장으로 배치할 수 없습니다. 먼저 새 군주로 교체하세요');
    const officer = {name:p.name, wu:p.wu, zhi:p.zhi, pol:p.pol, cha:p.cha, skill:p.skill, talent:p.talent, portrait:p.portrait, custom:true,
      faction:city.owner, city:p.city, loyalty:p.ruler ? 100 : (old && old.faction === city.owner ? old.loyalty : 90),
      honor:p.honor,
      status:'active', used:old ? old.used : false, captivityMonths:0, debut:game.year, join:''};
    if (p.ruler) {
      const previous = game.officers.find(o => o.name === game.leaders[city.owner]);
      if (previous && previous.name !== p.name) previous.loyalty = Math.min(previous.loyalty,90);
      game.leaders[city.owner] = p.name;
      game.factions[city.owner].name = p.name;
    }
    if (old) Object.assign(old,officer); else game.officers.push(officer);
    return officer;
  }
  function deploy(index) {
    if (atTitle || !guard()) return;
    try { const p = read()[index]; if (!p) return;
      const fid = G.cities[p.city].owner;
      if (!confirm(p.name + '을(를) ' + p.city + '에 배치합니다.' + (p.ruler ? '\n' + G.leaders[fid] + ' → ' + p.name + ' 군주 교체 (기존 군주는 일반 무장으로 남음)' : '') + '\n현재 게임에 적용할까요?')) return;
      apply(p,G); G.sel = p.city; log('신무장 ' + p.name + ': ' + p.city + ' 배속' + (p.ruler ? ' · 군주 취임' : ''),'good'); renderAll(); render(); toast('현재 게임에 배치했습니다. 진행 상황을 저장하세요');
    } catch (e) { toast('배치 실패: ' + e.message); }
  }
  function applyNewGame(game) {
    try { for (const o of read()) apply(o,game); }
    catch (e) { toast('신무장 자동 배치: ' + e.message); }
  }
  function exportFile() {
    try {
      const blob = new Blob([serialize(read())],{type:'application/json'}), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = '삼국지-신무장.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
      toast('사진을 포함한 신무장 JSON을 내보냈습니다');
    } catch (e) { toast('내보내기 실패: ' + e.message); }
  }
  function previewImport(text) {
    if (!guard()) return false;
    try {
      const imported = parse(text), list = read(), map = new Map(list.map(o => [o.name,o]));
      for (const o of imported) map.set(o.name,o);
      const merged = validateList([...map.values()]), duplicates = imported.filter(o => list.some(p => p.name === o.name)).length;
      if (atTitle) checkAssignments(merged,scenarioCities(scenario()));
      pending = merged;
      showModal('<h3>신무장 JSON 가져오기</h3><p>' + imported.length + '명 · 새 등록 ' + (imported.length-duplicates) + '명 · 같은 이름 갱신 ' + duplicates + '명</p>' +
        '<p>' + imported.map(o => html(o.name)).join(' · ') + '</p><p class="muted">사진·능력치·특기·전투 속성·배속 설정을 등록부에 합칩니다. 현재 게임에는 [배치]로 반영하세요.</p>' +
        '<div class="foot"><button onclick="CustomOfficers.open(' + atTitle + ')">취소</button><button class="primary" onclick="CustomOfficers.confirmImport()">등록부에 가져오기</button></div>',{closable:false});
      return true;
    } catch (e) { pending = null; toast('가져오기 실패: ' + e.message); return false; }
  }
  function confirmImport() {
    if (!pending || !guard()) return;
    try { write(pending); pending = null; render(); toast('신무장 등록부를 가져왔습니다'); }
    catch (e) { toast('가져오기 실패: ' + e.message); }
  }
  function importFile() {
    if (!guard()) return;
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    const context = atTitle, game = G;
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      try { if (file.size > 2 * 1024 * 1024) throw Error('신무장 JSON은 2MB 이하여야 합니다');
        const text = await file.text(); if (context !== atTitle || game !== G) return; previewImport(text);
      } catch (e) { toast('가져오기 실패: ' + e.message); }
    }; input.click();
  }
  return {open, leave, edit, saveForm, updateTraits, selectPhoto, clearPhoto, remove, deploy, exportFile, importFile, previewImport, confirmImport,
    applyNewGame, checkNewGame, entries, validate, validPhoto, safeName, MAX, _debug:{read,write,parse,serialize,apply}};
})();
window.CustomOfficers = CustomOfficers;
