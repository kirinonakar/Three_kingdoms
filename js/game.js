/* =====================================================
   삼국지 : 천하통일 — 게임 본체
   ===================================================== */
'use strict';
const SAVE_KEY = 'sangokji_save_v1';        // 구버전 단일 슬롯 — 자동저장 슬롯 1로 옮긴다
const SAVE_SLOTS = 3;                       // 수동 3개 + 자동 3개를 별도로 보관한다
const SAVE_VERSION = 7;
const saveSlotKey = (n, kind = 'auto') => SAVE_KEY + (kind === 'manual' ? '_manual_slot' : '_slot') + n;
const saveMetaKey = (n, kind = 'auto') => SAVE_KEY + (kind === 'manual' ? '_manual_meta' : '_meta') + n;
const GRACE_TURNS = 2;      // 초반 2개월은 AI가 플레이어 도시를 공격하지 않는다
const ENEMY_HIRE_LOYALTY_LIMIT = 85;
const ENEMY_CITY_FREE_HIRE_RATE = 0.7;
const HIRED_LOYALTY_MIN = 70, HIRED_LOYALTY_MAX = 85;

const $ = id => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const cl = (v, a, b) => Math.max(a, Math.min(b, v));
const commas = n => Math.round(n).toLocaleString('ko-KR');
const MAP_WIDTH = 1200, MAP_HEIGHT = 1000;

/* 현재 보이는 영역만 고해상도로 저장한다. 제스처 중에는 이전 프레임을 변환해 쓴다. */
function paintViewportRaster(ctx, layer, target, width, height, pixelWidth, pixelHeight) {
  const source=layer.__view, ratio=target.scale/source.scale;
  const sx=pixelWidth/width, sy=pixelHeight/height;
  ctx.save();
  ctx.setTransform(sx*ratio,0,0,sy*ratio,sx*(target.px-source.px*ratio),sy*(target.py-source.py*ratio));
  ctx.drawImage(layer,0,0,width,height);
  ctx.restore();
}

/* 지도와 전장이 공유하는 포인터 탐색. 제스처 뒤의 합성 클릭은 명령으로 넘기지 않는다. */
function bindCanvasNavigation(canvas, { size, read, write, tap, enabled = () => true, begin = () => {}, end = () => {} }) {
  const pointers = new Map();
  let base = null, blocked = false;
  const point = e => {
    const r = canvas.getBoundingClientRect(), s = size();
    return { x: (e.clientX - r.left) * s.width / r.width, y: (e.clientY - r.top) * s.height / r.height,
      clientX: e.clientX, clientY: e.clientY };
  };
  const snapshot = () => {
    const ps = Array.from(pointers.values()).slice(0, 2);
    if (!ps.length) { base = null; return; }
    const a = ps[0], b = ps[1] || a;
    base = { ...read(), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
      distance: Math.hypot(b.x - a.x, b.y - a.y), clientX: a.clientX, clientY: a.clientY };
  };
  canvas.addEventListener('pointerdown', e => {
    if (!enabled() || e.button !== 0) return;
    if (!pointers.size) { blocked = false; begin(); }
    pointers.set(e.pointerId, point(e));
    if (pointers.size > 1) blocked = true;
    snapshot();
    try { canvas.setPointerCapture?.(e.pointerId); } catch (_) { /* 이미 종료된 포인터 */ }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId) || !base || !enabled()) return;
    pointers.set(e.pointerId, point(e));
    const ps = Array.from(pointers.values()).slice(0, 2), a = ps[0], b = ps[1] || a;
    if (ps.length > 1 || Math.hypot(a.clientX - base.clientX, a.clientY - base.clientY) > 6) blocked = true;
    if (!blocked) return;
    const scale = cl(base.scale * (ps.length > 1 && base.distance > 0 ? Math.hypot(b.x - a.x, b.y - a.y) / base.distance : 1), 1, size().maxScale || 3);
    const ratio = scale / base.scale;
    write({ scale, px: (a.x + b.x) / 2 - (base.x - base.px) * ratio,
      py: (a.y + b.y) / 2 - (base.y - base.py) * ratio });
  });
  const finish = (e, cancelled) => {
    if (!pointers.has(e.pointerId)) return;
    const p = point(e), wasTap = !cancelled && !blocked && pointers.size === 1 && enabled();
    pointers.delete(e.pointerId);
    if (cancelled) blocked = true;
    if (pointers.size) { blocked = true; snapshot(); }
    else { base = null; end(); }
    if (wasTap && tap) tap(p, e);
  };
  canvas.addEventListener('pointerup', e => finish(e, false));
  canvas.addEventListener('pointercancel', e => finish(e, true));
  canvas.addEventListener('lostpointercapture', e => finish(e, true));
  canvas.addEventListener('click', e => {
    if (blocked) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  return { get active() { return pointers.size > 0; } };
}

/* 제목은 탭으로 접고, 드래그로 이동한다. 미니맵·세력 패널의 위치는 세션 중 각각 유지한다. */
const minimapPositions = new Map();
function bindMinimapDrag(panel) {
  const handle = panel?.querySelector?.('summary'), parent = panel?.parentElement;
  if (!handle || !parent) return () => {};
  let drag = null, suppressClick = false;
  handle.title = '드래그하여 위치 이동 · 누르면 접기/펼치기';
  const place = (x, y) => {
    if (!parent.clientWidth || !parent.clientHeight) return;
    const position = {
      x: cl(x, 0, Math.max(0, parent.clientWidth - panel.offsetWidth)),
      y: cl(y, 0, Math.max(0, parent.clientHeight - panel.offsetHeight))
    };
    Object.assign(panel.style, { left: position.x + 'px', top: position.y + 'px', right: 'auto', bottom: 'auto' });
    minimapPositions.set(panel.id, position);
  };
  const keepInBounds = () => {
    const position = minimapPositions.get(panel.id);
    if (position) place(position.x, position.y);
  };
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary || drag) return;
    const r = panel.getBoundingClientRect(), p = parent.getBoundingClientRect();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left - p.left, top: r.top - p.top, moved: false };
    suppressClick = false;
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) <= 6) return;
    drag.moved = true;
    suppressClick = true;
    panel.classList.add('is-dragging');
    place(drag.left + dx, drag.top + dy);
    e.preventDefault();
    e.stopPropagation();
  });
  const finish = e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    panel.classList.remove('is-dragging');
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    e.stopPropagation();
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  handle.addEventListener('click', e => {
    if (!suppressClick || e.detail === 0) return;
    suppressClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  panel.addEventListener('toggle', keepInBounds);
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(keepInBounds) : null;
  if (observer) { observer.observe(parent); observer.observe(panel); }
  keepInBounds();
  return () => observer?.disconnect();
}


/* ── 무장 초상화 ───────────────────────────────────
   배지에는 성(姓) 첫 글자를 기본으로 보여 준다.
   assets/portraits/ 에 얼굴 그림이 있는 무장은 마우스를 올리면
   큰 초상화 툴팁(#pfTip)이 커서를 따라 나타난다. */
const PORTRAITS = {
  // 세력 수장
  '조조': 'assets/portraits/caocao.jpg',
  '여포': 'assets/portraits/lvbu.jpg',
  '원소': 'assets/portraits/yuan.jpg',
  '유비': 'assets/portraits/liubei.jpg',
  '손책': 'assets/portraits/sunce.jpg',
  '유표': 'assets/portraits/liubiao.jpg',
  '원술': 'assets/portraits/yuanshu.jpg',
  '유장': 'assets/portraits/liuzhang.jpg',
  '장로': 'assets/portraits/zhanglu.jpg',
  '마등': 'assets/portraits/mateng.jpg',
  '이각': 'assets/portraits/lijue.jpg',
  '장수': 'assets/portraits/jangsu.jpg',
  '공손찬': 'assets/portraits/gongsun.jpg',
  // 여성 무장
  '초선': 'assets/portraits/diaochan.jpg',
  '손상향': 'assets/portraits/sunshangxiang.jpg',
  '대교': 'assets/portraits/daqiao.jpg',
  '소교': 'assets/portraits/xiaoqiao.jpg',
  '견희': 'assets/portraits/zhenji.jpg',
  '황월영': 'assets/portraits/huangyueying.jpg',
  '신헌영': 'assets/portraits/xinxianying.jpg',
  '감부인': 'assets/portraits/ladygan.jpg',
  '미부인': 'assets/portraits/ladymi.jpg',
  '오국태': 'assets/portraits/wuguotai.jpg',
  '채문희': 'assets/portraits/caiwenji.jpg',
  '축융': 'assets/portraits/zhurong.jpg',
  // 주요 무장
  '관우': 'assets/portraits/guanyu.jpg',
  '장비': 'assets/portraits/zhangfei.jpg',
  '조운': 'assets/portraits/zhaoyun.jpg',
  '제갈량': 'assets/portraits/zhugeliang.jpg',
  '손권': 'assets/portraits/sunquan.jpg',
  '주유': 'assets/portraits/zhouyu.jpg',
  '사마의': 'assets/portraits/simayi.jpg',
  '하후돈': 'assets/portraits/xiahoudun.jpg',
  '장료': 'assets/portraits/zhangliao.jpg',
  // 위(魏) 주요 무장
  '순욱': 'assets/portraits/xunyu.jpg',
  '전위': 'assets/portraits/dianwei.jpg',
  '하후연': 'assets/portraits/xiahouyuan.jpg',
  '서황': 'assets/portraits/xuhuang.jpg',
  '조인': 'assets/portraits/caoren.jpg',
  '악진': 'assets/portraits/yuejin.jpg',
  '이전': 'assets/portraits/lidian.jpg',
  '조홍': 'assets/portraits/caohong.jpg',
  '정욱': 'assets/portraits/chengyu.jpg',
  '순유': 'assets/portraits/xunyou.jpg',
  '곽가': 'assets/portraits/guojia.jpg',
  '허저': 'assets/portraits/xuchu.jpg',
  '우금': 'assets/portraits/yujin.jpg',
  // 촉(蜀) 주요 무장
  '마초': 'assets/portraits/machao.jpg',
  '황충': 'assets/portraits/huangzhong.jpg',
  '방통': 'assets/portraits/pangtong.jpg',
  '법정': 'assets/portraits/fazheng.jpg',
  '서서': 'assets/portraits/xushu.jpg',
  '강유': 'assets/portraits/jiangwei.jpg',
  '위연': 'assets/portraits/weiyan.jpg',
  // 오(吳) 주요 무장
  '태사자': 'assets/portraits/taishici.jpg',
  '황개': 'assets/portraits/huanggai.jpg',
  '능통': 'assets/portraits/lingtong.jpg',
  '정보': 'assets/portraits/chengpu.jpg',
  '한당': 'assets/portraits/handang.jpg',
  '감녕': 'assets/portraits/ganning.jpg',
  '주태': 'assets/portraits/zhoutai.jpg',
  '육손': 'assets/portraits/luxun.jpg',
  '여몽': 'assets/portraits/lumeng.jpg',
  '노숙': 'assets/portraits/lusu.jpg',
  // 군웅 · 가상 세력
  '동탁': 'assets/portraits/dongzhuo.jpg',
  '화웅': 'assets/portraits/huaxiong.jpg',
  '장각': 'assets/portraits/zhangjue.jpg',
  '진궁': 'assets/portraits/chengong.jpg',
  '전풍': 'assets/portraits/tianfeng.jpg',
  '저수': 'assets/portraits/jushou.jpg',
  '안량': 'assets/portraits/yanliang.jpg',
  '문추': 'assets/portraits/wenchou.jpg',
  '곽도': 'assets/portraits/guotu.jpg',
  '봉기': 'assets/portraits/fengji.jpg',
  '심배': 'assets/portraits/shenpei.jpg',
  '장합': 'assets/portraits/zhanghe.jpg',
  '가후': 'assets/portraits/jiaxu.jpg',
  '방덕': 'assets/portraits/pangde.jpg',
  '마속': 'assets/portraits/masu.jpg',
  '관평': 'assets/portraits/guanping.jpg',
  '조비': 'assets/portraits/caopi.jpg',
  '사마사': 'assets/portraits/simashi.jpg',
  '등애': 'assets/portraits/dengai.jpg',
  '종회': 'assets/portraits/zhonghui.jpg',
  '제갈근': 'assets/portraits/zhugejin.jpg',
  '육항': 'assets/portraits/lukang.jpg',
  '마량': 'assets/portraits/maliang.jpg',
  '유봉': 'assets/portraits/liufeng.jpg',
  '문앙': 'assets/portraits/wenang.jpg',
  '정봉': 'assets/portraits/dingfeng.jpg',
  '관흥': 'assets/portraits/guanxing.jpg',
  '장포': 'assets/portraits/zhangbao.jpg',
  '허유': 'assets/portraits/xuyou.jpg',
  '진등': 'assets/portraits/chendeng.jpg',
  '미축': 'assets/portraits/mizhu.jpg',
  '왕랑': 'assets/portraits/wanglang.jpg',
  '사마소': 'assets/portraits/simazhao.jpg',
  '종요': 'assets/portraits/zhongyao.jpg',
  '화타': 'assets/portraits/huatuo.jpg',
  '항우': 'assets/portraits/xiangyu.jpg',
  '조휴': 'assets/portraits/caoxiu.jpg',
  '조진': 'assets/portraits/caozhen.jpg',
  '하후패': 'assets/portraits/xiahouba.jpg',
  '가충': 'assets/portraits/jiachong.jpg',
  '제갈각': 'assets/portraits/zhugeke.jpg',
  '유기': 'assets/portraits/liuqi.jpg',
  '유종': 'assets/portraits/liucong.jpg',
  '고순': 'assets/portraits/gaoshun.jpg',
  '원담': 'assets/portraits/yuandan.jpg',
  '원상': 'assets/portraits/yuanshang.jpg',
  '장송': 'assets/portraits/zhangsong.jpg',
  '황권': 'assets/portraits/huangquan.jpg',
  '이엄': 'assets/portraits/liyan.jpg',
  '냉포': 'assets/portraits/lengbao.jpg',
  '장임': 'assets/portraits/zhangren.jpg',
  '오의': 'assets/portraits/wuyi.jpg',
  '손건': 'assets/portraits/sunqian.jpg',
  '장굉': 'assets/portraits/zhanghong.jpg',
  '여범': 'assets/portraits/lufan.jpg',
  '우번': 'assets/portraits/yufan.jpg',
  '장위': 'assets/portraits/zhangwei.jpg',
  '한수': 'assets/portraits/hansui.jpg',
  '곽사': 'assets/portraits/guosi.jpg',
  '채모': 'assets/portraits/caimao.jpg',
  '만총': 'assets/portraits/manchong.jpg',
  '모개': 'assets/portraits/maojie.jpg',
  '여건': 'assets/portraits/lvqian.jpg',
  '임준': 'assets/portraits/renjun.jpg',
  '주치': 'assets/portraits/zhouzhi.jpg',
  '손정': 'assets/portraits/sunjing.jpg',
  '유반': 'assets/portraits/liupan.jpg',
  '왕위': 'assets/portraits/wangwei.jpg',
  '양임': 'assets/portraits/yangren.jpg',
  '염포': 'assets/portraits/yanpu.jpg',
  '번조': 'assets/portraits/fanchou.jpg',
  '괴량': 'assets/portraits/kuailiang.jpg',
  '괴월': 'assets/portraits/kuaiyue.jpg',
  '이적': 'assets/portraits/yiji.jpg',
  '황조': 'assets/portraits/huangzu.jpg',
  '문빙': 'assets/portraits/wenpin.jpg',
  '한현': 'assets/portraits/hanxuan.jpg',
  '기령': 'assets/portraits/jiling.jpg',
  '장훈': 'assets/portraits/zhangxun.jpg',
  '양홍': 'assets/portraits/yanghong.jpg',
  '손향': 'assets/portraits/sunxiang.jpg',
  '교유': 'assets/portraits/qiaorui.jpg',
  '진란': 'assets/portraits/chenlan.jpg',
  '고람': 'assets/portraits/gaolan.jpg',
  '공손월': 'assets/portraits/gongsunyue.jpg',
  '위속': 'assets/portraits/weixu.jpg',
  '후성': 'assets/portraits/houcheng.jpg',
  '장패': 'assets/portraits/zangba.jpg',
  '사마휘': 'assets/portraits/simahui.jpg',
  '관녕': 'assets/portraits/guanning.jpg',
  '유엽': 'assets/portraits/liuye.jpg',
  '장소': 'assets/portraits/zhangzhao.jpg',
  '왕평': 'assets/portraits/wangping.jpg',
  '학소': 'assets/portraits/haozhao.jpg',
  '엄안': 'assets/portraits/yanan.jpg',
  '화흠': 'assets/portraits/huaxin.jpg',
  '진군': 'assets/portraits/chenqun.jpg',
  '양호': 'assets/portraits/yanghu.jpg',
  '두예': 'assets/portraits/duyu.jpg',
  '관구검': 'assets/portraits/guanqiujian.jpg',
  '왕릉': 'assets/portraits/wangling.jpg',
  '비위': 'assets/portraits/feiyi.jpg',
  '동윤': 'assets/portraits/dongyun.jpg',
  '장완': 'assets/portraits/zhangwan.jpg',
  '곽회': 'assets/portraits/guohuai.jpg',
  '왕쌍': 'assets/portraits/wangshuang.jpg',
  '서성': 'assets/portraits/xusheng.jpg',
  '제갈탄': 'assets/portraits/zhugedan.jpg',
  '진규': 'assets/portraits/chengui.jpg',
  '신평': 'assets/portraits/xinping.jpg',
  '국의': 'assets/portraits/guoyi.jpg',
  '신비': 'assets/portraits/xinpi.jpg',
  '미방': 'assets/portraits/mifang.jpg',
  '순심': 'assets/portraits/xunchen.jpg',
  '고간': 'assets/portraits/gaogan.jpg',
  '주창': 'assets/portraits/zhouchang.jpg',
  '요화': 'assets/portraits/yaohua.jpg',
  '간옹': 'assets/portraits/jianyong.jpg',
  '유괴': 'assets/portraits/liukui.jpg',
  '비관': 'assets/portraits/biguan.jpg',
  '양송': 'assets/portraits/yangsong.jpg',
  '성공영': 'assets/portraits/chenggongying.jpg',
  '마대': 'assets/portraits/madai.jpg',
  '장제': 'assets/portraits/zhangji.jpg',
  '이몽': 'assets/portraits/limeng.jpg',
  '호진': 'assets/portraits/huzhen.jpg',
  '호거아': 'assets/portraits/hucheer.jpg',
  '성렴': 'assets/portraits/chenglian.jpg',
  '관정': 'assets/portraits/guanjing.jpg',
  '전해': 'assets/portraits/tiankai.jpg',
  '송헌': 'assets/portraits/songxian.jpg',
  '배원소': 'assets/portraits/peiyuanshao.jpg',
  '주환': 'assets/portraits/zhuhuan.jpg',
  '송겸': 'assets/portraits/songqian.jpg',
  '동습': 'assets/portraits/dongxi.jpg',
  '능조': 'assets/portraits/lingcao.jpg',
  '반장': 'assets/portraits/panzhang.jpg',
  '장흠': 'assets/portraits/zhangqin.jpg',
  '보즐': 'assets/portraits/buzhi.jpg',
  '고옹': 'assets/portraits/guyong.jpg',
  '오란': 'assets/portraits/wulan.jpg',
  '뇌동': 'assets/portraits/leitong.jpg',
  '등현': 'assets/portraits/dengxian.jpg',
  '양앙': 'assets/portraits/yangang.jpg',
  '후선': 'assets/portraits/houxuan.jpg',
  '정은': 'assets/portraits/chengyin.jpg',
  '마철': 'assets/portraits/matie.jpg',
  '마휴': 'assets/portraits/maxiu.jpg',
  '견초': 'assets/portraits/qianzhao.jpg',
  '문대': 'assets/portraits/wendai.jpg',
  '이회': 'assets/portraits/lihui.jpg',
  '등지': 'assets/portraits/dengzhi.jpg',
  '장익': 'assets/portraits/zhangyi.jpg',
  '이숙': 'assets/portraits/lisu.jpg',
  '우보': 'assets/portraits/wubao.jpg',
  '서영': 'assets/portraits/xurong.jpg',
  '장보': 'assets/portraits/zhangbaoyt.jpg',
  '장량': 'assets/portraits/zhangliang.jpg',
  '정원지': 'assets/portraits/zhengyuanzhi.jpg',
  '파재': 'assets/portraits/bocai.jpg',
  '용저': 'assets/portraits/longju.jpg',
  '종리말': 'assets/portraits/zhonglimo.jpg',
  '계포': 'assets/portraits/jibu.jpg',
  '환초': 'assets/portraits/huanchu.jpg',
  '장양': 'assets/portraits/zhangyang.jpg'
};
function portraitSource(name) {
  const titleMode = !!(document.body && document.body.classList.contains('title'));
  if (titleMode && typeof CustomOfficers !== 'undefined') {
    const profile = CustomOfficers.entries().find(o => o.name === name);
    if (profile) return profile.portrait;
  }
  const officer = G && G.officers.find(o => o.name === name && o.custom);
  return (officer && officer.portrait) || PORTRAITS[name] || '';
}
function portraitHtml(name, size) {
  const sz = 'pf s' + (size || 22);
  const initial = name ? name.charAt(0) : '?';
  const src = portraitSource(name);
  const head = '<span class="' + sz + (src ? ' face' : '') + '" data-name="' + name + '"' +
    (src ? ' data-portrait="' + src + '"' : '') + ' aria-hidden="true">';
  return head + '<i>' + initial + '</i></span>';
}
/* 초상화 원본 그림 — 전장 부대 툴팁처럼 사진을 직접 보여 줄 때 쓴다 (없으면 빈 문자열) */
function portraitFace(name) {
  const src = portraitSource(name);
  return src ? '<span class="ut-face"><img src="' + src + '" alt="' + name + '"></span>' : '';
}
/* 이름에 얼굴 그림이 있으면 지정 크기로 그려 준다 — 타이틀 세력 카드처럼 크게 보여 줄 때 (없으면 빈 문자열) */
function portraitPhoto(name, px) {
  const src = portraitSource(name);
  if (!src) return '';
  const d = Math.round(px || 46);
  return '<span class="pf-photo" style="width:' + d + 'px;height:' + d + 'px">' +
    '<img src="' + src + '" alt="' + name + '"></span>';
}
/* 배지뿐 아니라 무장 태그·표의 행 전체를 호버 대상으로 만드는 속성.
   초상화가 없는 무장은 빈 문자열이라 아무 일도 일어나지 않는다. */
function portraitAttr(name) {
  const src = portraitSource(name);
  return src ? ' data-portrait="' + src + '" data-name="' + name + '"' : '';
}
/* 초상화 툴팁 — 마우스 호버 또는 모바일 롱탭으로 표시한다. */
const PF_TIP_SEL = '[data-portrait]';
/* 이름이 적힌 카드(.otag·.row·표 행·전장 툴팁) 안에 초상화 배지가 있으면
   그 카드의 어디를 가리켜도 같은 초상화를 툴팁으로 띄운다. */
const PF_CARD_SEL = '.otag, .row, tr, .ut-who, .ut-head, .frow, .ub';
function portraitHost(target) {
  if (target && !target.closest) target = target.parentElement;
  if (!target || !target.closest) return null;
  if (target.closest('input,select,textarea,.troop-stepper')) return null;
  const own = target.closest(PF_TIP_SEL);
  if (own) return own;
  const card = target.closest(PF_CARD_SEL);
  return card && card.querySelector ? card.querySelector(PF_TIP_SEL) : null;
}
function showPortraitTip(el, x, y) {
  const tip = $('pfTip'); if (!tip) return;
  const src = el.getAttribute('data-portrait'); if (!src) return;
  const name = el.getAttribute('data-name') || '';
  const def = OFFICER_DEFS.find(o => o[0] === name);
  const titleProfile = document.body && document.body.classList.contains('title') && typeof CustomOfficers !== 'undefined' && CustomOfficers.entries().find(o => o.name === name);
  const officer = (titleProfile && {...titleProfile,custom:true}) || (G && G.officers.find(o => o.name === name)) ||
    (def && { name, wu:def[3], zhi:def[4], pol:def[5], cha:def[6], skill:def[7] });
  let content = '<img src="' + src + '" alt="' + name + '"><div class="pf-name">' + name + '</div>';
  if (officer) {
    content += '<div class="pf-stats">' + [['무력','wu'],['지력','zhi'],['정치','pol'],['매력','cha']].map(([label,key]) =>
      '<div><span>' + label + '</span><b>' + officer[key] + '</b></div>').join('') + '</div>';
    if (Number.isFinite(officer.loyalty)) content += '<p class="pf-detail">충성도 <b>' + officer.loyalty + '</b></p>';
    const skill = SKILLS[officer.skill], combat = CombatRules.description(officer);
    if (skill) content += '<p class="pf-detail">' + officer.skill + ': ' + skill.desc + '</p>';
    if (combat) content += '<p class="pf-detail">' + combat + '</p>';
    const faction = G && G.factions[officer.faction];
    const status = officer.status === 'pow' ? (faction ? faction.name + ' 소속 ' : '') + '포로' :
      officer.faction === 'free' ? '재야 무장' : '';
    if (status || officer.used) content += '<p class="pf-detail">' +
      [status, officer.used ? '이번 달 명령 완료' : ''].filter(Boolean).join(' · ') + '</p>';
  }
  if (tip.getAttribute('data-content') !== content) {
    tip.innerHTML = content;
    tip.setAttribute('data-content', content);
    tip.setAttribute('data-src', src);
  }
  tip.hidden = false;
  movePortraitTip(x, y);
}
function movePortraitTip(x, y) {
  const tip = $('pfTip'); if (!tip || tip.hidden) return;
  const r = tip.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  let left = x + 18, top = y + 18;
  if (left + r.width > W - 10) left = x - r.width - 18;
  if (top + r.height > H - 10) top = y - r.height - 18;
  tip.style.left = Math.max(10, Math.min(left, W - r.width - 10)) + 'px';
  tip.style.top = Math.max(10, Math.min(top, H - r.height - 10)) + 'px';
}
function hidePortraitTip() {
  const tip = $('pfTip'); if (tip) tip.hidden = true;
}
function bindPortraitTip() {
  let touch = null, timer = null, suppressClick = false;
  const canHover = e => e.pointerType === 'mouse' &&
    (!window.matchMedia || window.matchMedia('(any-hover: hover)').matches);
  const clearTouch = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null; touch = null;
  };
  const dismiss = () => { clearTouch(); hidePortraitTip(); };
  document.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    if (e.isPrimary !== false) suppressClick = false;
    dismiss();
    const host = portraitHost(e.target);
    if (!host || e.isPrimary === false) return;
    const press = touch = { id:e.pointerId, x:e.clientX, y:e.clientY, src:host.getAttribute('data-portrait') };
    timer = setTimeout(() => {
      timer = null;
      if (touch !== press || host.isConnected === false) return;
      suppressClick = true;
      showPortraitTip(host, press.x, press.y);
    }, 500);
  });
  document.addEventListener('pointerup', e => {
    if (e.pointerType !== 'touch' || !touch || touch.id !== e.pointerId) return;
    const tap = touch; clearTouch();
    const host = portraitHost(e.target);
    if (!host || host.getAttribute('data-portrait') !== tap.src ||
        Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) hidePortraitTip();
  });
  document.addEventListener('click', e => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  document.addEventListener('selectstart', e => {
    if ((touch || suppressClick) && portraitHost(e.target)) e.preventDefault();
  }, true);
  document.addEventListener('contextmenu', e => {
    if (touch || suppressClick || e.pointerType === 'touch' && portraitHost(e.target)) e.preventDefault();
  });
  document.addEventListener('pointercancel', e => {
    if (e.pointerType === 'touch') dismiss();
  });
  document.addEventListener('pointerover', e => {
    if (!canHover(e)) return;
    const el = portraitHost(e.target);
    if (el) showPortraitTip(el, e.clientX, e.clientY);
  });
  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') {
      if (touch && touch.id === e.pointerId && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > 6) dismiss();
      return;
    }
    if (!canHover(e)) return;
    const tip = $('pfTip'); if (!tip || tip.hidden) return;
    if (portraitHost(e.target)) movePortraitTip(e.clientX, e.clientY); else hidePortraitTip();
  });
  document.addEventListener('pointerout', e => {
    if (!canHover(e)) return; // 손을 뗀 직후의 pointerout으로 사진이 닫히지 않게 한다.
    const host = portraitHost(e.target); if (!host) return;
    const to = portraitHost(e.relatedTarget);
    // 같은 초상화(행 → 배지, 배지 → 행)로 움직인 것이면 툴팁을 유지한다
    if (to && to.getAttribute('data-portrait') === host.getAttribute('data-portrait')) return;
    hidePortraitTip();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') dismiss(); });
  window.addEventListener('scroll', dismiss, true);
  window.addEventListener('blur', dismiss);
  window.addEventListener('resize', dismiss);
}
let G = null;              // 게임 상태
let chosenScenario = '194';
let hover = null;          // 마우스 오버 도시
let cvM = null, ctxM = null;
let attackIntro = null;
let modalLocked = false;   // 타이틀 화면처럼 닫기(×·Esc)를 막아야 하는 창
let modalAutoResume = null; // 창을 보기 위해 잠시 멈춘 전체위임
let autoPlayTimer = null;
let campaignEpoch = 0;     // 타이틀 이동·새 게임·불러오기 전의 비동기 작업 무효화
let pausedAI = null;       // 현재 달에서 중단한 AI 행동의 다음 단계
let delegationCancelRequested = false;

function pauseAI(next) {
  if (!G.autoPaused || !G.aiRunning || !(G.fullDelegation || !G.pf)) return false;
  pausedAI = {game:G, epoch:campaignEpoch, next};
  renderTop();
  return true;
}

function automatedFaction(fid) { return !G.pf || (fid === G.pf && G.fullDelegation); }
function clearAutoPlay() {
  if (autoPlayTimer !== null) clearTimeout(autoPlayTimer);
  autoPlayTimer = null;
}
function scheduleAutoPlay() {
  clearAutoPlay();
  if (!G || G.over || G.autoPaused || !(G.fullDelegation || !G.pf)) return;
  const game = G, epoch = campaignEpoch;
  autoPlayTimer = setTimeout(() => {
    autoPlayTimer = null;
    if (G !== game || campaignEpoch !== epoch || G.autoPaused || !strategyReady()) return;
    endTurn();
  }, 700);
}
function resumeAutoPlay() {
  const pending = pausedAI; pausedAI = null;
  if (pending && pending.game === G && pending.epoch === campaignEpoch) {
    setTimeout(() => {
      if (G === pending.game && campaignEpoch === pending.epoch && !pauseAI(pending.next)) pending.next();
    }, 0);
  } else if (!G.aiRunning) scheduleAutoPlay();
}
function toggleAutoPlay() {
  if (!G || G.over || !(G.fullDelegation || !G.pf)) return;
  G.autoPaused = !G.autoPaused;
  clearAutoPlay();
  if (G.autoPaused && attackIntro && attackIntro.next) {
    const next = attackIntro.next;
    stopAttackIntro();
    pauseAI(next);
    drawMap();
  }
  if (!G.autoPaused) {
    closeModal();
    resumeAutoPlay();
  }
  renderTop();
  toast(G.autoPaused ? 'AI 자동 진행을 일시정지했습니다' : 'AI 자동 진행을 재개합니다');
}
function setFullDelegation(on) {
  if (!G || G.over || !G.pf || !!on === G.fullDelegation) return;
  if (!on && G.fullDelegation && G.aiRunning && !G.battleActive) {
    delegationCancelRequested = true;
    G.autoPaused = false;
    clearAutoPlay();
    const pending = pausedAI; pausedAI = null;
    closeModal();
    renderTop();
    // 출진 병력은 이미 차감되었으므로 확정된 전투 하나는 마친 뒤 지휘권을 돌려준다.
    if (attackIntro && attackIntro.next) {
      const next = attackIntro.next;
      stopAttackIntro();
      next();
    } else if (pending && pending.game === G && pending.epoch === campaignEpoch) pending.next();
    return;
  }
  if (!strategyReady()) return;
  G.fullDelegation = !!on;
  G.autoPaused = false;
  clearAutoPlay();
  G.ui = {};
  closeModal();
  log(on ? '전체위임: 내정·외교·군사·전투와 월 진행을 AI에 맡깁니다.' : '전체위임을 해제하고 직접 지휘합니다.', 'good');
  renderAll();
  if (on) scheduleAutoPlay();
}
function returnDirectControl() {
  if (!delegationCancelRequested) return false;
  delegationCancelRequested = false;
  clearAutoPlay(); pausedAI = null; campaignEpoch++;
  G.aiRunning = false;
  G.fullDelegation = false;
  G.autoPaused = false;
  refreshCmd(false);
  const f = G.factions[G.pf];
  G.cmd = cl(f.commandTurn === G.turn ? f.commands : G.cmd, 0, G.cmdMax);
  G.ui = {};
  closeModal();
  log('전체위임을 해제하고 직접 지휘합니다. 남은 명령권 ' + G.cmd + '개.', 'good');
  renderAll();
  return true;
}

/* 사운드 헬퍼 — audio.js 가 없거나 초기화 전이어도 게임 진행에는 영향이 없다 */
const sfx = n => { if (typeof Sound !== 'undefined' && Sound) Sound.sfx(n); };
const bgm = n => { if (typeof Sound !== 'undefined' && Sound) Sound.bgm(n); };

/* 무장 정의 → 게임 상태 객체.
   등장 연도(o[8])가 아직 오지 않았으면 status 'hidden' 으로 숨겨 둔다. */
function makeOfficer(o, year) {
  const debut = o[8] || SCENARIO.year;
  return {
    name: o[0], faction: o[1], city: o[2], wu: o[3], zhi: o[4], pol: o[5], cha: o[6],
    skill: o[7], loyalty: o[1] === 'free' ? 0 : ri(85, 95), honor: defaultOfficerHonor(o[0]),
    status: debut > year ? 'hidden' : 'active', used: false, captivityMonths: 0,
    debut, join: o[9] || ''
  };
}
/* 구버전 저장에 없는(나중에 추가된) 무장 정의를 채워 넣는다 */
function syncOfficers() {
  if (!G) return;
  const known = {};
  G.officers.forEach(o => {
    known[o.name] = true; o.honor = officerHonor(o);
    o.captivityMonths = o.status === 'pow' ? (o.captivityMonths || 0) : 0;
  });
  OFFICER_DEFS.forEach(o => {
    if (!known[o[0]]) {
      const scenario=scenarioById(G.scenario||'194'), entry=scenarioOfficer(o,scenario,scenarioCities(scenario));
      const added = makeOfficer(entry.def, G.year), host = G.cities[added.city];
      if(entry.retired) {added.status='retired';added.faction='free';added.loyalty=0;}
      // 이미 점령된 도시에 이전 소유 세력의 현역 장수를 되살리지 않는다.
      if (added.status === 'active') {
        const faction = added.join || added.faction;
        added.faction = faction !== 'free' && host && host.owner === faction ? faction : 'free';
        added.loyalty = added.faction === 'free' ? 0 : ri(70,90);
      }
      G.officers.push(added);
    }
  });
}

/* ── 상태 생성 ───────────────────────────────────────── */
function newGame(pf, scenarioId = '194') {
  const scenario = scenarioById(scenarioId), cityDefs = scenarioCities(scenario);
  if (pf !== null && !cityDefs.some(c=>c[4]===pf)) return;
  clearAutoPlay(); pausedAI = null; delegationCancelRequested = false; campaignEpoch++;
  stopAttackIntro();
  const factionDefs = scenarioFactions(scenario);
  const factions = {}, cities = {}, officers = [];
  factionDefs.forEach(f => {
    const o = { id: f[0], name: f[1], color: f[2], gold: f[3], food: f[4], ally: {}, rel: {} };
    factionDefs.forEach(g => { if (g[0] !== f[0]) o.rel[g[0]] = 0; });
    factions[f[0]] = o;
    if(scenario.names && scenario.names[f[0]]) o.name=scenario.names[f[0]];
    if(scenario.year>194) { o.gold=Math.round(f[3]*1.5);o.food=f[4]*2; }
    if(scenario.gold) o.gold=scenario.gold;   // 가상 대전처럼 모든 세력을 같은 자금에서 시작
  });
  cityDefs.forEach(c => {
    cities[c[0]] = {
      name: c[0], x: c[1], y: c[2], links: c[3].slice(), owner: c[4],
      agri: c[5], comm: c[6], def: c[7], order: c[8], pop: c[9],
      troops: c[10], training: c[11], morale: 70, recruited: false
    };
  });
  // 등장 연도가 지난 무장만 활성 상태로 시작한다
  OFFICER_DEFS.forEach(o => {
    const entry=scenarioOfficer(o,scenario,cityDefs), officer=makeOfficer(entry.def,scenario.year);
    if(entry.retired) {officer.status='retired';officer.faction='free';officer.loyalty=0;}
    officers.push(officer);
  });
  const leaders = Object.assign({},LEADERS,scenario.leaders || {});
  // 세력 수장은 충성 100 (배신·포로 불가)
  Object.keys(factions).forEach(fid => {
    const leader = officers.find(o => o.name === leaders[fid]);
    if (leader && cityDefs.some(c => c[4] === fid)) leader.loyalty = 100;
  });
  G = {
    year: scenario.year, month: scenario.month, scenario:scenario.id, leaders, pf,
    factions, cities, officers,
    cmd: 0, cmdMax: 0, log: [], sel: null, over: false, battleActive: false, ui: {},
    turn: 0, ver: SAVE_VERSION, aiRunning: false,
    fullDelegation: false, autoPaused: false
  };
  if(scenario.rosters) assignScenarioRosters(scenario);      // 15군웅처럼 편성표를 직접 지정한 시나리오
  else if(scenario.owners) distributeScenarioOfficers(scenario);
  if (typeof CustomOfficers !== 'undefined') CustomOfficers.applyNewGame(G);
  // 시작 비축은 실제 주둔군의 6개월 소비량. 후대 대세력에도 같은 기준을 쓴다.
  Object.values(factions).forEach(f => {
    const upkeep = factionCities(f.id).reduce((s, n) => s + cityFoodUpkeep(cities[n]), 0);
    f.food = Math.max(600, upkeep * 6);
  });
  (scenario.allies || []).forEach(([a,b])=>{factions[a].ally[b]=true;factions[b].ally[a]=true;factions[a].rel[b]=60;factions[b].rel[a]=60;});
  view.scale = 1; view.px = 0; view.py = 0;      // 새 게임은 초기 배율·중앙에서 시작
  stopZoomAnim();                                 // 진행 중인 확대 애니메이션 정리
  refreshCmd(true);
  log('『' + scenario.name + '』 천하가 다시 군웅의 시대로 접어들었다.', 'sep');
  log(pf ? G.factions[pf].name + ' 세력이 천하에 깃발을 세웠다. 도시 ' + factionCities(pf).length + '개, 금 ' + commas(G.factions[pf].gold) + '.' : 'AI 관전: 모든 세력이 AI의 지휘로 천하통일을 겨룹니다.', 'good');
}

function refreshCmd(full) {
  G.cmdMax = G.pf ? factionCities(G.pf).length + 2 : 0;
  if (full) {
    G.cmd = G.cmdMax;
    // 새 달에는 모든 무장이 다시 명령을 수행할 수 있다
    G.officers.forEach(o => { o.used = false; });
    // 도시별 '이번 달 징병 완료' 표시도 새 달에 풀린다 (모병은 제한 없음)
    Object.values(G.cities).forEach(c => { c.recruited = false; });
  }
}

/* ── 조회 헬퍼 ───────────────────────────────────────── */
function off(name) { return G.officers.find(o => o.name === name); }
function factionCities(fid) { return Object.keys(G.cities).filter(n => G.cities[n].owner === fid); }
function officersIn(city) { return G.officers.filter(o => o.status === 'active' && o.city === city && o.faction !== 'free'); }
// 재야(비소속) 무장과 포로 무장 — 도시 정보·등용 후보 표시용
function freeOfficersIn(city) { return G.officers.filter(o => o.faction === 'free' && o.status === 'active' && o.city === city); }
function prisonerOfficersIn(city) { return G.officers.filter(o => o.status === 'pow' && o.city === city); }
function officersOf(fid) { return G.officers.filter(o => o.faction === fid && o.status === 'active'); }
// 이번 달 아직 명령을 수행하지 않은 무장
function availableOfficers(city) { return officersIn(city).filter(o => !o.used); }
function bestAvailable(city) {
  return availableOfficers(city).reduce((a, b) => ((a && a.cha >= b.cha) ? a : b), null);
}
function markUsed(names) {
  (names || []).forEach(n => { const o = off(n); if (o) o.used = true; });
}

/* 명령별 무장 정렬 점수 — 높을수록 해당 명령의 효과가 크다 */
const PICK_SCORE = {
  // 내정: 정치·지력 + 명재(내정 효율) 보정
  admin: o => (o.pol * 0.6 + o.zhi * 0.4) * ((SKILLS[o.skill] || {}).admin || 1),
  // 징병: 매력 + 인덕(등용/징병) 보정
  recruit: o => o.cha * (1 + ((SKILLS[o.skill] || {}).recruit || 0)),
  // 훈련: 무력
  train: o => o.wu * (skillOf(o).train || 1),
  // 이동: 즉효 효과는 없으므로 종합 능력치 순
  move: o => o.wu * 0.4 + o.zhi * 0.3 + o.pol * 0.3,
  // 출진: 무력·지력 + 전투 특기(공격/일기토/계략) 보정
  attack: o => {
    const sk = SKILLS[o.skill] || {};
    return o.wu * 0.7 + o.zhi * 0.3
      + ((sk.atk || 1) - 1) * 100
      + (sk.duel || 0) * 30
      + (sk.strat || 0) * 20;
  }
};
function pickSorted(city, score) {
  const fn = score || PICK_SCORE.move;
  return availableOfficers(city).slice().sort((a, b) =>
    fn(b) - fn(a) || b.wu - a.wu || a.name.localeCompare(b.name));
}
function skillOf(o) { return (o && SKILLS[o.skill]) || {}; }
function isAlly(a, b) {
  if (!a || !b || a === b) return false;
  const f = G.factions[a];
  return !!(f && f.ally[b]);
}
/* 징병·주둔 상한 — 수도는 일반 도시의 1.5배 */
const CAPITAL_CAP_MULT = 1.5;
function capOf(city) {
  const base = city.pop * 1000;
  return Math.round(base * (isCapital(city) ? CAPITAL_CAP_MULT : 1));
}
/* 병력 충원 비용 (1명당 금) — 징병은 한 달에 한 도시 한 번, 모병은 횟수 제한 없이 두 배 비용 */
const RECRUIT_COST = 0.08;
const LEVY_COST = 0.16;
const REWARD_COST = 100;
const FOOD_BUY_RATE = 2; // 금 1로 군량 2 매입 (플레이어·AI 공통)
const FOOD_SELL_RATE = 0.4; // 군량 1 매각 시 금 0.4 (매입가 대비 20% 낮음)
const GARRISON_FOOD_DIVISOR = 90;
const BATTLE_FOOD_DIVISOR = 600; // 병력 600명당 하루(라운드) 추가 군량 1
function cityGoldIncome(c) { return Math.round((c.comm * 1.5 + c.pop * 2) * (0.55 + c.order / 200) * cityRegion(c).gold); }
function cityFoodIncome(c) { return Math.round((c.agri * 2.4 + c.pop * 2) * (0.65 + c.order / 200) * cityRegion(c).food); }
function cityGoldUpkeep(c) { return Math.ceil((c.troops || 0) / 500); }
/* 주둔 군량 소비 — 인구 상한 초과 병력은 2배로 소모 */
function cityFoodUpkeep(c) {
  const troops = c.troops || 0;
  const over = Math.max(0, troops - capOf(c));
  return Math.ceil((troops + over) / GARRISON_FOOD_DIVISOR);
}
function consumeBattleSupply(ctx, request) {
  if (!ctx.supply) ctx.supply = { round: 0, atk: { troopDays:0, cost:0, paid:0 }, def: { troopDays:0, cost:0, paid:0 } };
  const supply = ctx.supply;
  if (request.round <= supply.round) return null;
  supply.round = request.round;
  const report = {};
  for (const side of ['atk','def']) {
    const tally = supply[side], f = G.factions[ctx[side]];
    tally.rate=tally.rate||expeditionRate(ctx,side);
    tally.troopDays += Math.max(0,request[side] || 0)*tally.rate;
    const total = Math.ceil(tally.troopDays / BATTLE_FOOD_DIVISOR - 1e-9);
    const cost = total - tally.cost, paid = f ? Math.min(f.food,cost) : cost;
    if (f) f.food -= paid;
    tally.cost = total; tally.paid += paid;
    report[side] = { cost, total, paid:tally.paid, food:f ? f.food : null,
      rate:tally.rate, moraleLoss:cost > paid ? Math.ceil(8*(cost-paid)/cost) : 0 };
  }
  return report;
}
function battleSupplyHint(troops) {
  const deploy=G.ui.deploy,ctx=G.battleCtx||{atk:G.pf,to:deploy?.target};
  const rate=expeditionRate(ctx,ctx.atk===G.pf?'atk':'def');
  return '전투 추가 군량: 600명당 라운드 1'+(rate>1?' · 원정 거리 가산 +'+Math.round((rate-1)*100)+'%':'')+' · 현재 편성으로 15라운드에 약 ' +
    commas(Math.ceil(troops*rate*15/BATTLE_FOOD_DIVISOR)) + ' (병력 손실·추가 원군에 따라 변동) · 보유 ' +
    commas(G.factions[G.pf].food) + ' · 보급 부족 시 라운드당 사기 최대 -8';
}
function factionEconomy(fid) {
  return factionCities(fid).reduce((s, n) => {
    const c = G.cities[n];
    s.goldIncome += cityGoldIncome(c); s.goldUpkeep += cityGoldUpkeep(c);
    s.foodIncome += cityFoodIncome(c); s.foodUpkeep += cityFoodUpkeep(c);
    s.goldNet = s.goldIncome - s.goldUpkeep; s.foodNet = s.foodIncome - s.foodUpkeep;
    return s;
  }, { goldIncome: 0, goldUpkeep: 0, foodIncome: 0, foodUpkeep: 0, goldNet: 0, foodNet: 0 });
}
// 충원과 도시 간 수송은 숙련병을 복제하지 않고 병력 비율로 훈련·사기를 합친다.
function addGarrison(c, amount, training, morale) {
  if (amount <= 0) return;
  const total = c.troops + amount;
  c.training = Math.round((c.training * c.troops + training * amount) / total);
  c.morale = Math.round((c.morale * c.troops + morale * amount) / total);
  c.troops = total;
}
function isLeader(name) { return Object.entries(G && G.leaders || LEADERS).some(([fid,n])=>n===name && (!G || factionCities(fid).length)); }

function distributeScenarioOfficers(scenario) {
  const capitals={cao:'허창',yuan:'업',sunce:'건업',liubei:scenario.year>=219?'성도':scenario.year>=208?'강하':'여남',liuzhang:'성도',zhanglu:'한중',mateng:'무위',liubiao:'양양'};
  Object.keys(G.factions).forEach(fid=>{
    const cities=factionCities(fid);if(!cities.length)return;
    const chief=off(G.leaders[fid]);
    if(chief && chief.status==='active') {chief.faction=fid;chief.city=capitals[fid]||cities[0];chief.loyalty=100;}
    // 후대 시나리오의 점령지에도 지휘관을 배치해 AI가 후방을 방치하지 않게 한다.
    cities.forEach(n=>{
      if(officersIn(n).length) return;
      const donors=cities.filter(c=>officersIn(c).length>1).sort((a,b)=>officersIn(b).length-officersIn(a).length);
      const donor=donors[0] && officersIn(donors[0]).filter(o=>o.name!==G.leaders[fid]).sort((a,b)=>b.wu-a.wu)[0];
      if(donor) donor.city=n;
    });
  });
}
/* 로스터(군웅별 편성표)로 무장과 주둔지를 지정한다. 수장은 capitals 의 도시에서 시작한다. */
function assignScenarioRosters(scenario) {
  const capitals = scenario.capitals || {};
  Object.keys(scenario.rosters).forEach(fid => {
    const cities = factionCities(fid);
    if (!cities.length) return;
    const seat = cities.includes(capitals[fid]) ? capitals[fid] : cities[0];
    scenario.rosters[fid].forEach((name, i) => {
      const o = off(name);
      if (!o || o.status !== 'active') return;
      o.faction = fid;
      o.city = i === 0 ? seat : cities[i % cities.length];
      if (o.name !== G.leaders[fid]) o.loyalty = ri(85, 95);
    });
  });
}

function isPlayerCity(c) { return c && c.owner === G.pf; }
/* 세력 총계 — 외교 화면 등에서 병력·금·군량을 한눈에 비교하기 위한 집계 */
function factionTotals(fid) {
  const cs = factionCities(fid), f = G.factions[fid] || {};
  let troops = 0;
  cs.forEach(n => { const c = G.cities[n]; if (c) troops += c.troops || 0; });
  return { cities: cs.length, troops, gold: f.gold || 0, food: f.food || 0 };
}

/* ── 부팅 / 시작 화면 ────────────────────────────────── */
function boot() {
  cvM = $('mapCanvas'); ctxM = cvM.getContext('2d');
  cvM.style.cursor = 'grab';
  const minimapPanel = $('mapMinimap');
  bindMinimapDrag(minimapPanel);
  bindMinimapDrag($('mapFactionPanel'));
  if (minimapPanel) minimapPanel.addEventListener('toggle', drawMinimap);
  const mini = $('mapMiniCanvas');
  if (mini) mini.addEventListener('pointerup', e => {
    if (!G || G.battleActive || attackIntro || e.button !== 0) return;
    const r = mini.getBoundingClientRect();
    if (!r.width || !r.height) return;
    stopZoomAnim();
    view.px = MAP_WIDTH / 2 - (e.clientX - r.left) / r.width * MAP_WIDTH * view.scale;
    view.py = MAP_HEIGHT / 2 - (e.clientY - r.top) / r.height * MAP_HEIGHT * view.scale;
    viewClamp(); syncGoal(); hover = null; drawMap();
  });
  if (typeof Sound !== 'undefined') Sound.boot();     // 설정 복원 + 첫 입력에서 오디오 활성화
  bindSfx();                                          // 버튼·목록 클릭 효과음
  bindPortraitTip();                                  // 무장 초상화 호버·터치 미리보기
  migrateLegacySave();                                // 구버전 단일 저장을 슬롯으로 옮긴다
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (G) drawMap(); }).observe(cvM.parentElement);
  }
  window.addEventListener('resize', () => mobilePanel($('app')?.dataset.mobilePanel || 'map'));
  const navigation = bindCanvasNavigation(cvM, {
    size: () => ({ width: MAP_WIDTH, height: MAP_HEIGHT, maxScale: VIEW_MAX }),
    read: () => view,
    write: next => { Object.assign(view, next); viewClamp(); syncGoal(); drawMap(); },
    enabled: () => !attackIntro && !!G && !G.battleActive,
    begin: () => { stopZoomAnim(); dragState = true; hover = null; cvM.style.cursor = 'grabbing'; },
    end: () => { dragState = null; cvM.style.cursor = 'grab'; drawMap(); },
    tap: p => selectMapPoint(p)
  });
  cvM.addEventListener('pointermove', e => {
    if (attackIntro || navigation.active || e.pointerType === 'touch') return;
    const p = toCanvas(e);
    if (!G) return;
    const w = worldFromScreen(p.x, p.y), h = cityAt(w.x, w.y);
    if (h !== hover) { hover = h; drawMap(); }
    cvM.style.cursor = h ? 'pointer' : 'grab';
  });
  const selectMapPoint = p => {
    if (!G) return;
    const w = worldFromScreen(p.x, p.y);
    const c = cityAt(w.x, w.y);
    if (c) {
      /* 목적지 선택 중이면(이동·출진) 지도 클릭을 목적지 선택으로 쓴다 */
      const dp = destPick();
      if (dp) {
        const atk = dp.kind === 'attack', st = dp.st;
        if (c === st.from) { toast('출발 도시입니다 — 다른 ' + (atk ? '적' : '아군') + ' 도시를 클릭하세요'); return; }
        if (dp.cands.indexOf(c) < 0) {
          toast(atk ? '인접한 적 도시만 목적지로 고를 수 있습니다' : '인접한 아군 도시만 목적지로 고를 수 있습니다'); return;
        }
        if (atk) chooseAttackTarget(c); else chooseMoveTarget(c);
        return;
      }
      selectCity(c);
    }
    else { G.sel = null; renderCityPanel(); drawMap(); }
  };
  cvM.addEventListener('pointerleave', () => {
    if (hover) { hover = null; drawMap(); }
  });
  cvM.addEventListener('wheel', e => {
    e.preventDefault();
    if (attackIntro) return;
    const p = toCanvas(e);
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
    const step = e.shiftKey ? 1.0004 : 1.0012;   // Shift+휠은 더 촘촘한 단계
    setZoom(viewGoal.scale * Math.pow(step, -d), p.x, p.y);
  }, { passive: false });
  cvM.addEventListener('dblclick', e => {
    const p = toCanvas(e);
    setZoom(viewGoal.scale * 1.6, p.x, p.y);
  });
  document.addEventListener('keydown', e => {
    if (attackIntro && !(e.target && ['btnAutoPlay','btnTitle'].includes(e.target.id))) { e.preventDefault(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches('[role="button"]')) {
      e.preventDefault(); e.target.click(); return;
    }
    if (e.key === 'Escape') {
      if (modalLocked) return;                 // 닫기 불가 창(타이틀 화면)은 Esc로도 닫지 않는다
      if (document.body && document.body.classList.contains('title')) { toTitle(); return; }   // 타이틀 위에 띄운 창 → 타이틀 화면으로
      if (G && G.ui && G.ui.move) cancelMove();
      else if (G && G.ui && G.ui.attack) cancelAttack();
      else closeModal();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;   // 입력 중에는 단축키를 쓰지 않는다
    if (e.key === '+' || e.key === '=') zoomBy(1.12);
    else if (e.key === '-' || e.key === '_') zoomBy(0.89);
    else if (e.key === '0') zoomReset();
    else if (e.key === 'm' || e.key === 'M') toggleBgm();
    else if (e.key === 'n' || e.key === 'N') toggleSfx();
  });
  startScreen();
}

/* 버튼·목록 클릭 효과음 — 한 곳에서 위임 처리한다 */
function bindSfx() {
  document.addEventListener('pointerdown', e => {
    const el = e.target && e.target.closest ? e.target.closest('button,.frow,.row,.cmd') : null;
    if (!el || el.disabled) return;
    sfx(el.tagName === 'BUTTON' ? 'click' : 'select');
  }, true);
}
function toCanvas(e) {
  const r = cvM.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (MAP_WIDTH / r.width), y: (e.clientY - r.top) * (MAP_HEIGHT / r.height) };
}
/* 월드 좌표 기준 도시 판정. 축소 화면에서도 CSS 24px 반경, 겹치면 가장 가까운 도시. */
function cityAt(x, y) {
  const rect=cvM?.getBoundingClientRect();
  const cssScale=rect?.width?MAP_WIDTH/rect.width:1;
  const screen=screenFromWorld(x,y);
  // 확대된 이름표도 도시 표식과 똑같이 눌러 선택할 수 있다.
  if (cityLabelCache) {
    for (const [name,label] of Object.entries(cityLabelCache.labels)) {
      const box=label.box;
      if (label.visible !== false && box && screen.x>=box.x && screen.x<=box.x+box.w && screen.y>=box.y && screen.y<=box.y+box.h) return name;
    }
  }
  const markerScale = cityMarkerScale();
  const rr = Math.max(24*cssScale, markerScale > 1 ? 32*markerScale : 0) / (view.scale || 1);
  let best=null,dist=rr*rr;
  for (const n of Object.keys(G ? G.cities : {})) {
    const c = G.cities[n];
    const d=(c.x-x)**2+(c.y-y)**2;if(d<=dist){best=n;dist=d;}
  }
  return best;
}
function setTitleMode(on) {
  if (document.body && document.body.classList) document.body.classList[on ? 'add' : 'remove']('title');
  mobilePanel('map');
}
function mobilePanel(panel) {
  if (!['map', 'city', 'log'].includes(panel)) return;
  const app = $('app');
  if (app && app.dataset) app.dataset.mobilePanel = panel;
  const activePanel = isLandscapeLayout() && panel === 'map' ? 'city' : panel;
  ['map', 'city', 'log'].forEach(name => {
    const button = $('mobileTab-' + name);
    if (button && button.setAttribute) button.setAttribute('aria-pressed', String(name === activePanel));
  });
  ['info', 'commands'].forEach(name => {
    const button = $('mobileTab-' + name);
    if (button && button.setAttribute) button.setAttribute('aria-pressed', String(activePanel === 'city' && name === (app?.dataset.cityPanel || 'info')));
  });
  if ((panel === 'map' || isLandscapeLayout()) && app && app.isConnected && cvM && G) drawMap();
}
function mobileCityTab(panel) {
  if (!['info', 'commands'].includes(panel)) return;
  const app = $('app');
  if (!app || !app.dataset) return;
  app.dataset.cityPanel = panel;
  mobilePanel('city');
}
function startScreen() {
  setTitleMode(true);
  bgm('title');                       // 시작 화면 — 차분한 주제곡
  const scenario = scenarioById(chosenScenario), cities = scenarioCities(scenario);
  const customs = typeof CustomOfficers !== 'undefined' ? CustomOfficers.entries() : [];
  const roster = OFFICER_DEFS.map(o=>scenarioOfficer(o,scenario,cities)).filter(o=>!o.retired && (o.def[8]||194)<=scenario.year);
  const rows = scenarioFactions(scenario).filter(f=>cities.some(c=>c[4]===f[0])).map(f => {
    const id = f[0];
    const customRuler = customs.filter(o => o.ruler && cities.some(c => c[0] === o.city && c[4] === id)).slice(-1)[0];
    const cs = cities.filter(c => c[4] === id), name=customRuler ? customRuler.name : scenario.names && scenario.names[id] || f[1];
    const troops = cs.reduce((s, c) => s + c[10], 0);
    const offs = roster.filter(o => o.def[1] === id).length + customs.filter(o => cities.some(c => c[0] === o.city && c[4] === id)).length;
    const d = (scenario.difficulty && scenario.difficulty[id]) || DIFFICULTY[id] || 1;
    const stars = '★'.repeat(d) + '☆'.repeat(5 - d);
    /* 세력 카드에는 세력 색 점만 두고, 수장 얼굴은 카드에 마우스를 올렸을 때 툴팁으로 띄운다.
       시나리오에서 수장이 바뀌면(예: 손책→손권) 그쪽을 우선한다. */
    const chief = customRuler ? customRuler.name : (scenario.leaders && scenario.leaders[id]) || LEADERS[id] || name;
    return '<div class="frow"' + portraitAttr(chief) + ' role="button" tabindex="0" aria-label="' + name + ' 세력으로 시작" data-faction="' + id + '" onclick="Game.startNew(\'' + id + '\',\'' + scenario.id + '\')">' +
      '<span class="dot" style="background:' + f[2] + '"></span>' +
      '<b style="width:64px">' + name + '</b>' +
      '<span class="muted">도시 ' + cs.length + ' · 병력 ' + commas(troops) + ' · 무장 ' + offs + ' · 수도 ' + cs[0][0] + '</span>' +
      '<span class="right diff">' + stars + '</span></div>';
  }).join('');
  showModal('<h2>삼국지 : 천하통일</h2>' +
    '<label class="scenario-label" for="scenarioSelect">시나리오</label><select id="scenarioSelect" onchange="Game.chooseScenario(this.value)">' +
    SCENARIOS.map(s=>'<option value="'+s.id+'"'+(s.id===scenario.id?' selected':'')+'>'+s.name+'</option>').join('')+'</select>' +
    '<p class="muted scenario-desc">'+scenario.desc+'</p>' +
    startSaveRows() +
    '<button class="frow" onclick="Game.startSpectator(\'' + scenario.id + '\')"><b>전체 AI 관전</b><span class="muted">세력 선택 없이 모든 세력을 AI에 맡깁니다</span></button>' +
    rows +
    '<div class="foot"><button onclick="CustomOfficers.open(true)">신무장 등록</button><button onclick="Game.openHelp()">게임 방법</button></div>', { closable: false });
}
function chooseScenario(id) { chosenScenario=scenarioById(id).id;startScreen(); }

/* ── 렌더링 ──────────────────────────────────────────── */
function renderAll() {
  if(G && !G.battleActive && typeof Sound!=='undefined' && Sound.setScene) {
    const city=G.cities[G.sel] || G.cities[factionCities(G.pf)[0]], profile=city && typeof BattleTerrain!=='undefined' && BattleTerrain.profiles[city.name];
    Sound.setScene({theme:profile?profile.theme:'plain',season:Math.floor((G.month%12)/3),tension:Math.min(1,(G.turn||0)/48)});
  }
  renderTop(); syncMoveHint(); drawMap(); renderCityPanel(); renderLog();
}

function renderTop() {
  if (!$('dateInfo')) return;
  const f = G.factions[G.pf] || {name:'전체 AI 관전',color:'transparent',gold:0,food:0};
  $('dateInfo').textContent = G.year + '년 ' + G.month + '월';
  /* 세력 표시 — 이름 앞에 세력색 점을 함께 보여 준다 */
  const facName = $('facName') || $('facInfo');
  if (facName) facName.textContent = f.name;
  const facDot = $('facDot');
  if (facDot) { facDot.style.background = f.color; facDot.style.display = ''; }
  if ($('facInfo')) $('facInfo').title = f.name + ' · 세력색 ' + f.color;
  const economy = factionEconomy(G.pf);
  $('goldInfo').textContent = commas(f.gold) + ' (' + signed(economy.goldNet) + ')';
  $('foodInfo').textContent = commas(f.food) + ' (' + signed(economy.foodNet) + ')';
  $('goldInfo').title = '월 수입 ' + economy.goldIncome + ' · 군 급료 ' + economy.goldUpkeep + ' · 순수입 ' + economy.goldNet;
  $('foodInfo').title = '월 생산 ' + economy.foodIncome + ' · 소비 ' + economy.foodUpkeep + ' · 순증감 ' + economy.foodNet;
  $('cmdInfo').textContent = G.cmd + ' / ' + G.cmdMax;
  $('cityInfo').textContent = factionCities(G.pf).length + ' / ' + Object.keys(G.cities).length;
  const busy = !!G.aiRunning || !!attackIntro;
  ['btnSave', 'btnLoad', 'btnOfficers', 'btnCustomOfficers', 'btnDiplo', 'btnPolicies'].forEach(id => { const el = $(id); if (el) el.disabled = busy; });
  if ($('btnDiplo')) $('btnDiplo').disabled = busy || !G.pf || G.fullDelegation;
  if ($('btnOfficers')) $('btnOfficers').disabled = busy && !G.autoPaused;
  const auto = $('btnAutoPlay');
  if (auto) {
    auto.hidden = !!G.pf;
    auto.disabled = !!G.over || delegationCancelRequested;
    auto.textContent = G.autoPaused ? 'AI 자동 진행 재개' : 'AI 자동 진행 일시정지';
  }
  const cancel = $('btnCancelDelegation');
  if (cancel) {
    cancel.hidden = !G.pf || !G.fullDelegation;
    cancel.disabled = !!G.over || !!G.battleActive || delegationCancelRequested;
  }
  const b = $('btnEndTurn');
  if (b) b.disabled = !!G.over || busy || G.fullDelegation || !G.pf;
}

function hexA(hex, a) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return 'rgba(150,160,150,' + a + ')';
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
function pRound(x, X, Y, Wd, Ht, R) {
  x.beginPath();
  if (x.roundRect) { x.roundRect(X, Y, Wd, Ht, R); return; }
  const r = Math.min(R, Wd / 2, Ht / 2);
  x.moveTo(X + r, Y);
  x.arcTo(X + Wd, Y, X + Wd, Y + Ht, r);
  x.arcTo(X + Wd, Y + Ht, X, Y + Ht, r);
  x.arcTo(X, Y + Ht, X, Y, r);
  x.arcTo(X, Y, X + Wd, Y, r);
  x.closePath();
}
/* 종이 결 — 캐시 레이어 위에 한 겹 덧입혀 인쇄된 지도 같은 질감을 준다 */
let grainCanvas = null;
function grainTileCanvas() {
  if (grainCanvas) return grainCanvas;
  if (typeof document === 'undefined' || !document.createElement) return null;
  const n = 160;
  const c = document.createElement('canvas');
  if (!c || !c.getContext) return null;
  c.width = n; c.height = n;
  const g = c.getContext('2d');
  if (!g || !g.createImageData) return null;
  const img = g.createImageData(n, n);
  if (!img || !img.data) return null;
  const d = img.data;
  let s = 20260101;
  for (let i = 0; i < d.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = 126 + ((s >> 16) & 31);
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainCanvas = c;
  return c;
}
function overlayGrain(x, W, H, alpha, mode) {
  if (!x || !x.createPattern) return;
  const tile = grainTileCanvas();
  if (!tile) return;
  const pat = x.createPattern(tile, 'repeat');
  if (!pat) return;
  x.save();
  if (mode) x.globalCompositeOperation = mode;
  x.globalAlpha = alpha == null ? 0.1 : alpha;
  x.fillStyle = pat;
  x.fillRect(0, 0, W, H);
  x.restore();
}
/* 결정적 난수 — 같은 입력이면 언제나 같은 결과 (지형 결이 흔들리지 않게) */
function jitter(i, s) {
  const v = Math.sin(i * 127.1 + (s || 0) * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
/* ── 지형 렌더링 ──────────────────────────────────────────────────
   실제 경위도 데이터(MAP_TERRAIN)를 그대로 투영해 해안선·산맥·하천·호수를
   그리고, 정적인 부분은 오프스크린 캔버스에 한 번만 그려 캐시한다. */
let terrainLayer = null;
let terrainBaseLayer = null;
const terrainCache = new Map();   // 보이는 영역별 지형 레이어 (최근 두 개만 유지)
let terrainOwnership = '';        // 소유권이 바뀌면 모든 배율의 영토색도 갱신
function terrainFor(tkey, camera, size) {
  let c = terrainCache.get(tkey);
  if (!c) {
    c = buildTerrainLayer(camera);
    c.__key = tkey; c.__size = size;
    terrainCache.set(tkey, c);
    if (terrainCache.size > 2) terrainCache.delete(terrainCache.keys().next().value);
  }
  return c;
}

function projPts(pts) {
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) out[i] = projMap(pts[i][0], pts[i][1]);
  return out;
}

/* 연속 좌표 변환으로 영토 경계를 굽힌다. 같은 점은 언제나 같은 곳으로 옮겨
   인접 구역이 정확히 같은 경계를 공유한다. 기울기를 작게 유지해 접힘을 막는다. */
function territoryWarp(p) {
  const x = p[0], y = p[1];
  return [
    x + 13 * Math.sin(y / 43) + 7 * Math.sin((x + y) / 67) + 3 * Math.sin(y / 17 + x / 89),
    y + 12 * Math.sin(x / 51) + 6 * Math.sin((x - y) / 61) + 3 * Math.sin(x / 23 - y / 97)
  ];
}
/* 도시를 역변환한 위치에서 분할해야 곡선을 적용한 뒤에도 도시가 자기 구역에 남는다. */
function territorySite(city) {
  let p = [city[1], city[2]];
  for (let i = 0; i < 32; i++) {
    const w = territoryWarp(p);
    p = [city[1] - (w[0] - p[0]), city[2] - (w[1] - p[1])];
  }
  return p;
}

/* 공유 경계망은 한 번만 계산한다. 지리적 외곽은 별도 클립으로 처리해
   외곽의 굴곡 때문에 도시 구역이 갈라지거나 긴 직선 테두리가 생기지 않게 한다. */
let territoryGeometry = null;
function mapTerritories() {
  if (territoryGeometry) return territoryGeometry;
  const territories = CITY_DEFS.concat(MAP_TERRITORY_ANCHORS);
  const sites = territories.map(territorySite);
  const outline = [[-100, -100], [MAP_VIEW.W + 100, -100],
    [MAP_VIEW.W + 100, MAP_VIEW.H + 100], [-100, MAP_VIEW.H + 100]];
  const shared = new Map();
  territoryGeometry = territories.map((city, index) => {
    const site = sites[index];
    let pts = outline.slice();
    sites.forEach((other, j) => {
      if (index === j || !pts.length) return;
      const nx = other[0] - site[0], ny = other[1] - site[1];
      const limit = (other[0] ** 2 + other[1] ** 2 - site[0] ** 2 - site[1] ** 2) / 2;
      const clipped = [];
      pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length];
        const da = a[0] * nx + a[1] * ny - limit;
        const db = b[0] * nx + b[1] * ny - limit;
        if (da <= 0) clipped.push(a);
        if ((da <= 0) !== (db <= 0)) {
          const t = da / (da - db);
          clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      });
      pts = clipped;
    });
    const edges = pts.map((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const d = (mx - site[0]) ** 2 + (my - site[1]) ** 2;
      const neighbor = sites.findIndex((other, j) => j !== index &&
        Math.abs((mx - other[0]) ** 2 + (my - other[1]) ** 2 - d) < 0.01);
      const keyA = a.map(v => v.toFixed(5)).join(','), keyB = b.map(v => v.toFixed(5)).join(',');
      const forward = keyA < keyB;
      const key = forward ? keyA + '/' + keyB : keyB + '/' + keyA;
      if (!shared.has(key)) {
        const start = forward ? a : b, end = forward ? b : a;
        const dx = end[0] - start[0], dy = end[1] - start[1];
        const length = Math.hypot(dx, dy);
        const steps = Math.max(2, Math.ceil(length / 3));
        const phase = jitter(start[0] + start[1], end[0] - end[1]) * Math.PI * 2;
        const curve = [];
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const px = start[0] + dx * t, py = start[1] + dy * t;
          const clearance = Math.min(...sites.map(s => Math.hypot(px - s[0], py - s[1])));
          /* 긴 구획은 능선처럼 완만하게 휘고, 도시가 밀집한 곳은 굴곡을 줄인다.
             양 끝의 변위와 기울기는 0으로 만들어 접합부가 벌어지지 않게 한다. */
          const bend = Math.min(24, length * 0.2, clearance * 0.45) * Math.sin(Math.PI * t) ** 2 *
            (0.7 * Math.sin(Math.PI * 2 * t + phase) + 0.3 * Math.sin(Math.PI * 4 * t + phase * 0.7));
          curve.push(territoryWarp([px - dy / (length || 1) * bend, py + dx / (length || 1) * bend]));
        }
        shared.set(key, curve);
      }
      const curve = shared.get(key);
      return { pts: forward ? curve : curve.slice().reverse(),
        neighbor: neighbor < 0 ? null : territories[neighbor][0] };
    });
    return { name: city[0], pts: edges.flatMap(edge => edge.pts.slice(0, -1)), edges };
  });
  return territoryGeometry;
}
function traceTerritory(x, pts) {
  x.beginPath();
  pts.forEach((p, i) => { if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); });
  x.closePath();
}
function drawTerritories(x) {
  if (!G) return;
  x.save();
  tracePath(x, projPts(MAP_TERRAIN.coast), true, 0.35);
  x.clip();
  const extent = projPts(MAP_TERRITORY_EXTENT);
  tracePath(x, extent, true, 0.4);
  x.clip();
  x.lineJoin = 'round';
  x.lineCap = 'round';
  const regions = mapTerritories();
  regions.forEach(region => {
    const city = G.cities[region.name];
    const faction = city && G.factions[city.owner];
    traceTerritory(x, region.pts);
    x.fillStyle = hexA(faction ? faction.color : '#8b9a8e', 0.50);
    x.fill();
  });
  /* 국경은 먹선으로, 같은 세력 안의 도시 구획은 옅은 점선으로 구분한다.
     각 경계는 한 번만 그려 굵기가 중첩되지 않게 한다. */
  [false, true].forEach(frontier => {
    x.beginPath();
    regions.forEach(region => {
      const city = G.cities[region.name];
      region.edges.forEach(edge => {
        const other = edge.neighbor && G.cities[edge.neighbor];
        if (!other || region.name >= edge.neighbor || (city.owner !== other.owner) !== frontier) return;
        edge.pts.forEach((p, i) => { if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); });
      });
    });
    x.setLineDash(frontier ? [] : [2.5, 3]);
    x.strokeStyle = frontier ? 'rgba(38,31,23,.78)' : 'rgba(245,228,188,.26)';
    x.lineWidth = frontier ? 1.65 : 0.65;
    x.stroke();
    if (frontier) {
      x.strokeStyle = 'rgba(245,228,188,.48)'; x.lineWidth = 0.55; x.stroke();
    }
  });
  /* 산지 쪽 외곽은 가는 한 줄로 정리하고 해안선은 지형 레이어에 맡긴다. */
  tracePath(x, extent, true, 0.4);
  x.strokeStyle = 'rgba(41,36,25,.42)'; x.lineWidth = 1.2; x.stroke();
  x.restore();
}
/* Catmull-Rom 스플라인 → 베지어 : 꼭짓점을 지나며 부드럽게 연결 */
function tracePath(x, P, closed, k) {
  const n = P.length;
  x.beginPath();
  if (n < 3) {
    if (n === 1) { x.moveTo(P[0][0], P[0][1]); }
    else if (n === 2) { x.moveTo(P[0][0], P[0][1]); x.lineTo(P[1][0], P[1][1]); }
    return;
  }
  const t = k == null ? 0.5 : k;
  const at = i => closed ? P[(i % n + n) % n] : P[Math.max(0, Math.min(n - 1, i))];
  x.moveTo(P[0][0], P[0][1]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    x.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) * t / 3, p1[1] + (p2[1] - p0[1]) * t / 3,
      p2[0] - (p3[0] - p1[0]) * t / 3, p2[1] - (p3[1] - p1[1]) * t / 3,
      p2[0], p2[1]);
  }
  if (closed) x.closePath();
}
function fillRegion(x, pts, style, blur) {
  x.save();
  if (blur && typeof x.filter === 'string') x.filter = 'blur(' + blur + 'px)';
  tracePath(x, projPts(pts), true, 0.35);
  x.fillStyle = style;
  x.fill();
  x.restore();
}
function resample(P, step) {
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
}
/* 산맥 : 능선을 따라 삼각형 봉우리를 이어 붙인다 (고봉은 설선) */
function drawRangeGeo(x, rg) {
  const P = resample(projPts(rg.pts), Math.max(8, rg.s * 1.1));
  const snow = rg.s >= 7;
  x.save();
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    const f = 0.7 + 0.55 * ((i * 7919) % 11) / 11;
    const h = rg.s * f, w = h * 1.05;
    /* 봉우리 밑동 그림자 — 산이 땅에 앉아 있는 느낌 */
    const sh = x.createLinearGradient(0, p[1] - h * 0.06, 0, p[1] + h * 0.34);
    sh.addColorStop(0, 'rgba(12,10,8,.30)');
    sh.addColorStop(1, 'rgba(12,10,8,0)');
    x.beginPath();
    x.ellipse(p[0], p[1] + h * 0.21, w * 1.12, h * 0.26, 0, 0, Math.PI * 2);
    x.fillStyle = sh;
    x.fill();

    /* 그늘면 */
    const gs = x.createLinearGradient(p[0] - w, p[1] + h * 0.24, p[0], p[1] - h * 0.78);
    gs.addColorStop(0, 'rgba(50,44,36,.88)');
    gs.addColorStop(.55, 'rgba(76,68,54,.86)');
    gs.addColorStop(1, 'rgba(104,95,76,.82)');
    x.beginPath();
    x.moveTo(p[0] - w, p[1] + h * 0.24);
    x.lineTo(p[0], p[1] - h * 0.78);
    x.lineTo(p[0] + w, p[1] + h * 0.24);
    x.closePath();
    x.fillStyle = gs;
    x.fill();

    /* 양지면 */
    const gl = x.createLinearGradient(p[0], p[1] - h * 0.78, p[0] + w, p[1] + h * 0.24);
    gl.addColorStop(0, 'rgba(198,190,166,.92)');
    gl.addColorStop(.7, 'rgba(162,154,130,.88)');
    gl.addColorStop(1, 'rgba(126,118,96,.84)');
    x.beginPath();
    x.moveTo(p[0] - w, p[1] + h * 0.24);
    x.lineTo(p[0], p[1] - h * 0.78);
    x.lineTo(p[0] + w * 0.12, p[1] + h * 0.24);
    x.closePath();
    x.fillStyle = gl;
    x.fill();

    /* 능선 — 빛을 받는 모서리 */
    x.beginPath();
    x.moveTo(p[0] - w * 0.64, p[1] + h * 0.16);
    x.lineTo(p[0], p[1] - h * 0.78);
    x.lineTo(p[0] + w * 0.58, p[1] + h * 0.18);
    x.strokeStyle = 'rgba(248,242,222,.20)';
    x.lineWidth = Math.max(0.6, rg.s * 0.085);
    x.stroke();

    /* 설선 */
    if (snow) {
      const gsn = x.createLinearGradient(p[0], p[1] - h * 0.78, p[0], p[1] - h * 0.34);
      gsn.addColorStop(0, 'rgba(251,254,255,.95)');
      gsn.addColorStop(1, 'rgba(220,231,238,.52)');
      x.beginPath();
      x.moveTo(p[0], p[1] - h * 0.78);
      x.lineTo(p[0] - w * 0.30, p[1] - h * 0.34);
      x.lineTo(p[0] - w * 0.06, p[1] - h * 0.44);
      x.lineTo(p[0] + w * 0.11, p[1] - h * 0.36);
      x.lineTo(p[0] + w * 0.30, p[1] - h * 0.34);
      x.closePath();
      x.fillStyle = gsn;
      x.fill();
    }
  }
  x.restore();
}
function drawRiverGeo(x, rv) {
  const P = projPts(rv.pts);
  x.save();
  x.lineJoin = 'round';
  x.lineCap = 'round';
  /* 강둑 그늘 */
  tracePath(x, P, false, 0.62);
  x.strokeStyle = 'rgba(8,24,28,.5)'; x.lineWidth = rv.w + 7.5; x.stroke();
  /* 물빛 — 은은한 발광 */
  tracePath(x, P, false, 0.62);
  x.strokeStyle = 'rgba(46,106,134,.9)'; x.lineWidth = rv.w + 3.6; x.stroke();
  x.shadowColor = 'rgba(96,186,214,.5)';
  x.shadowBlur = Math.max(4, rv.w * 1.2);
  tracePath(x, P, false, 0.62);
  x.strokeStyle = 'rgba(74,152,184,.95)'; x.lineWidth = rv.w + 1.0; x.stroke();
  x.shadowBlur = 0;
  x.shadowColor = 'transparent';
  /* 물결 하이라이트 */
  tracePath(x, P, false, 0.62);
  x.strokeStyle = 'rgba(168,224,240,.85)'; x.lineWidth = Math.max(0.9, rv.w * 0.42); x.stroke();
  tracePath(x, P, false, 0.62);
  x.strokeStyle = 'rgba(234,250,255,.5)'; x.lineWidth = Math.max(0.5, rv.w * 0.15); x.stroke();
  x.restore();
}
/* 지형 이름 : 선분 방향에 맞춰 기울이되 거꾸로 뒤집히지 않게 보정 */
function drawGeoLabel(x, pts, text, color, size) {
  const P = projPts(pts);
  const i = Math.floor(P.length / 2);
  const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  x.save();
  x.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  x.rotate(Math.abs(ang) < Math.PI / 2 ? ang : ang + Math.PI);
  x.font = (size || 10) + 'px "Batang","바탕",serif';
  x.fillStyle = color;
  x.textAlign = 'center';
  x.textBaseline = 'bottom';
  x.fillText(text, 0, -2);
  x.restore();
}

/* 지형대별 색 : 실제 기후·지형 분포에 맞춘 팔레트 */
const TERRAIN_FILL = {
  steppe:  '#6f6a45',   // 북방 초원
  desert:  '#9a8555',   // 사막·모래
  loess:   '#866b3c',   // 황토고원
  plateau: '#5f5648',   // 티베트 고원
  basin:   '#7e5340',   // 사천 분지(적갈)
  plain:   '#75834a',   // 중원·평야 농경지
  hills:   '#62723f',   // 구릉
  forest:  '#3c5c3b'    // 강남·만주 삼림
};

/* 확대된 세계 전체 대신, 보이는 지형을 화면 픽셀에 직접 그려 캐시한다. */
function buildTerrainLayer(camera) {
  const W = MAP_WIDTH, H = MAP_HEIGHT, T = MAP_TERRAIN;
  const SERIF = '"Batang","바탕",serif';
  const c = document.createElement('canvas');
  c.width = cvM.width;
  c.height = cvM.height;
  c.__view = { ...camera };
  const x = c.getContext('2d');
  const sx=c.width/W,sy=c.height/H;
  x.setTransform(sx*camera.scale,0,0,sy*camera.scale,sx*camera.px,sy*camera.py);

  /* 바다 */
  const og = x.createLinearGradient(0, 0, W * 0.7, H);
  og.addColorStop(0, '#143442');
  og.addColorStop(.55, '#0e2833');
  og.addColorStop(1, '#081c26');
  x.fillStyle = og;
  x.fillRect(0, 0, W, H);

  /* 바다 결 — 잔물결과 깊이 띠를 겹쳐 밋밋한 단색을 피한다 */
  x.save();
  x.strokeStyle = 'rgba(150,208,224,.09)';
  x.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const wx = jitter(i, 1) * W, wy = jitter(i, 2) * H;
    const rw = 7 + jitter(i, 3) * 30;
    x.beginPath();
    x.moveTo(wx - rw, wy);
    x.quadraticCurveTo(wx, wy - rw * 0.3, wx + rw, wy);
    x.stroke();
  }
  x.strokeStyle = 'rgba(6,20,28,.16)';
  x.lineWidth = 26;
  for (let i = 0; i < 5; i++) {
    const wy = H * (0.16 + i * 0.17);
    x.beginPath();
    x.moveTo(0, wy);
    x.lineTo(W, wy + 14);
    x.stroke();
  }
  x.restore();

  /* 경위선 (5° 간격) */
  x.save();
  x.strokeStyle = 'rgba(150,210,220,.06)';
  x.lineWidth = 1;
  x.setLineDash([2, 6]);
  for (let lon = 100; lon < MAP_VIEW.lon1; lon += 5) {
    const p = projMap(lon, 0);
    x.beginPath(); x.moveTo(p[0], 0); x.lineTo(p[0], H); x.stroke();
  }
  for (let lat = 25; lat < MAP_VIEW.lat1; lat += 5) {
    const p = projMap(0, lat);
    x.beginPath(); x.moveTo(0, p[1]); x.lineTo(W, p[1]); x.stroke();
  }
  x.restore();

  /* 대륙 */
  const coast = projPts(T.coast);
  x.save();
  tracePath(x, coast, true, 0.35);
  /* 연안 발광 — 폭을 줄여가며 겹쳐 물빛 번짐을 만든다 */
  const halo = [[70, 0.05], [48, 0.08], [30, 0.11], [14, 0.16]];
  halo.forEach(h => { x.strokeStyle = 'rgba(126,196,214,' + h[1] + ')'; x.lineWidth = h[0]; x.stroke(); });
  x.restore();

  /* 육지 바탕 : 북쪽은 마른 초원, 남쪽은 습윤한 녹색 */
  const lg = x.createLinearGradient(0, MAP_VIEW.oy, 0, MAP_VIEW.oy + MAP_VIEW.ky * (MAP_VIEW.lat1 - MAP_VIEW.lat0));
  lg.addColorStop(0, '#6f6a45');
  lg.addColorStop(.45, '#6f7448');
  lg.addColorStop(.78, '#5d6c40');
  lg.addColorStop(1, '#4c6641');
  x.save();
  x.shadowColor = 'rgba(0,0,0,.55)';
  x.shadowBlur = 18;
  tracePath(x, coast, true, 0.35);
  x.fillStyle = lg;
  x.fill();
  x.restore();

  /* 섬 */
  T.islands.forEach(isl => {
    x.save();
    tracePath(x, projPts(isl.pts), true, 0.3);
    x.fillStyle = '#43583c';
    x.fill();
    x.strokeStyle = 'rgba(206,232,226,.35)';
    x.lineWidth = 1.2;
    x.stroke();
    x.restore();
  });

  /* 기후·지형 구획 : 지형대별 색으로 채운다 (육지로 클리핑) */
  x.save();
  tracePath(x, coast, true, 0.35);
  x.clip();
  T.regions.forEach(r => fillRegion(x, r.pts, TERRAIN_FILL[r.kind] || TERRAIN_FILL.plain, 9));
  /* 고도 명암 */
  const rl = x.createRadialGradient(W * 0.34, H * 0.3, 60, W * 0.52, H * 0.52, W * 0.9);
  rl.addColorStop(0, 'rgba(255,248,220,.10)');
  rl.addColorStop(.55, 'rgba(255,255,255,0)');
  rl.addColorStop(1, 'rgba(0,0,0,.20)');
  x.fillStyle = rl;
  x.fillRect(0, 0, W, H);
  /* 육지 결 — 촘촘한 점묘로 지형에 밀도를 준다 */
  for (let gy = 0; gy < H; gy += 13) {
    for (let gx = 0; gx < W; gx += 13) {
      const f = jitter(gx * 0.37 + gy * 0.11, 7);
      if (f < 0.45) continue;
      const r = 0.5 + f * 1.2;
      x.beginPath();
      x.arc(gx + (f - 0.5) * 9, gy + (jitter(gy * 0.21 + gx * 0.05, 3) - 0.5) * 9, r, 0, Math.PI * 2);
      x.fillStyle = f > 0.82
        ? 'rgba(252,246,222,' + (0.03 + f * 0.05).toFixed(3) + ')'
        : 'rgba(22,30,18,' + (0.02 + f * 0.05).toFixed(3) + ')';
      x.fill();
    }
  }
  x.restore();

  /* 세력 영토 — 지형 바탕 위, 호수·하천·산맥 아래에 채색한다. */
  drawTerritories(x);
  drawLandscapeDetail(x, T);

  /* 호수 */
  T.lakes.forEach(lk => {
    x.save();
    tracePath(x, projPts(lk.pts), true, 0.3);
    const P = projPts(lk.pts);
    tracePath(x, P, true, 0.3);
    const lgd = x.createLinearGradient(0, 0, 0, H);
    lgd.addColorStop(0, 'rgba(78,152,180,.96)');
    lgd.addColorStop(.55, 'rgba(52,122,150,.96)');
    lgd.addColorStop(1, 'rgba(32,90,116,.96)');
    x.fillStyle = lgd;
    x.fill();
    x.strokeStyle = 'rgba(158,212,230,.72)';
    x.lineWidth = 1.1;
    x.stroke();
    x.strokeStyle = 'rgba(234,250,255,.34)';
    x.lineWidth = 0.7;
    x.stroke();
    /* 잔물결 — 호수 안쪽에만 */
    let lx0 = 1e9, lx1 = -1e9, ly0 = 1e9, ly1 = -1e9;
    P.forEach(p => {
      lx0 = Math.min(lx0, p[0]); lx1 = Math.max(lx1, p[0]);
      ly0 = Math.min(ly0, p[1]); ly1 = Math.max(ly1, p[1]);
    });
    x.save();
    tracePath(x, P, true, 0.3);
    x.clip();
    x.strokeStyle = 'rgba(214,244,252,.16)';
    x.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const wy = ly0 + (ly1 - ly0) * (0.18 + i * 0.12);
      x.beginPath();
      x.moveTo(lx0, wy);
      x.quadraticCurveTo((lx0 + lx1) / 2, wy - 3, lx1, wy);
      x.stroke();
    }
    x.restore();
    x.restore();
  });

  /* 하천 · 산맥 */
  T.rivers.forEach(rv => drawRiverGeo(x, rv));
  T.ranges.forEach(rg => drawRangeGeo(x, rg));

  /* 해안선 */
  x.save();
  tracePath(x, coast, true, 0.35);
  x.strokeStyle = 'rgba(6,22,28,.42)'; x.lineWidth = 5.2; x.stroke();
  x.strokeStyle = 'rgba(226,244,240,.38)'; x.lineWidth = 2.4; x.stroke();
  x.strokeStyle = 'rgba(248,253,251,.72)'; x.lineWidth = 0.9; x.stroke();
  x.restore();

  /* 지형 이름 */
  T.rivers.forEach(rv => { if (rv.name) drawGeoLabel(x, rv.pts, rv.name, 'rgba(12,40,54,.62)', 10); });
  T.ranges.forEach(rg => { if (rg.name) drawGeoLabel(x, rg.pts, rg.name, 'rgba(38,32,22,.62)', 9.5); });
  T.lakes.forEach(lk => {
    if (!lk.name) return;
    const P = projPts(lk.pts);
    let sx = 0, sy = 0;
    P.forEach(p => { sx += p[0]; sy += p[1]; });
    x.save();
    x.font = '9px ' + SERIF;
    x.textAlign = 'center';
    x.textBaseline = 'top';
    x.fillStyle = 'rgba(228,244,250,.8)';
    x.fillText(lk.name, sx / P.length, sy / P.length + 4);
    x.restore();
  });
  T.seas.forEach(s => {
    const p = projMap(s.lon, s.lat);
    x.save();
    x.font = '13px ' + SERIF;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = 'rgba(150,206,222,.32)';
    x.fillText(s.name, p[0], p[1]);
    x.restore();
  });
  return c;
}

// 지형 레이어에만 그린다. 확대·이동 완료 후 새 해상도에서 다시 선명하게 그린다.
function drawLandscapeDetail(x, terrain) {
  terrain.regions.forEach((region,ri)=>{
    const P=projPts(region.pts), xs=P.map(p=>p[0]),ys=P.map(p=>p[1]);
    const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
    x.save();tracePath(x,P,true,.3);x.clip();
    for(let gy=top;gy<bottom;gy+=12) for(let gx=left;gx<right;gx+=15) {
      const n=jitter(gx*1.7+gy*.31,ri+14), px=gx+n*8,py=gy+jitter(gx+gy,3)*6;
      if(region.kind==='forest') {
        x.fillStyle='rgba(24,53,34,.25)';x.beginPath();x.ellipse(px+2,py+2,5,2,0,0,7);x.fill();
        x.fillStyle=n>.5?'rgba(100,137,77,.34)':'rgba(37,76,47,.4)';
        x.beginPath();x.moveTo(px,py-5-n*3);x.lineTo(px+4,py+1);x.lineTo(px-4,py+1);x.closePath();x.fill();
      } else if(region.kind==='plain' || region.kind==='basin') {
        if(n<.22) continue;
        x.strokeStyle=n>.65?'rgba(226,205,133,.20)':'rgba(39,72,45,.21)';x.lineWidth=.7;
        for(let k=0;k<3;k++){x.beginPath();x.moveTo(px-5-n*3,py-1+k*1.5);x.bezierCurveTo(px-2,py-3+k*1.5,px+3,py-2+k*1.5,px+5+n*3,py+.3+k*1.5);x.stroke();}
      } else {
        x.strokeStyle=region.kind==='desert'?'rgba(239,213,153,.24)':'rgba(225,211,173,.17)';x.lineWidth=.8;
        for(let k=0;k<3;k++){x.beginPath();x.moveTo(px-7,py+k*2);x.quadraticCurveTo(px,py-5-n*5+k*2,px+8,py-1+k*2);x.stroke();}
      }
    }
    x.restore();
  });
}

function troopLabel(t) {
  const v = t / 1000;
  return v >= 10 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1).replace('.0', '');
}
function isCapital(c) {
  if (!c || !G || !G.officers) return false;
  const name = (G.leaders || LEADERS)[c.owner];
  if (!name) return false;
  const o = G.officers.find(v => v.name === name);
  return !!(o && o.status === 'active' && o.city === c.name);
}

/* ── 화면 변환(확대·이동) ──────────────────────────────────────────
   화면좌표 = 월드좌표 × scale + pan. 지도 요소는 월드, UI는 화면 기준.
   확대·축소는 목표값(viewGoal)을 향해 매 프레임 보간해 부드럽게 움직인다. */
const view = { scale: 1, px: 0, py: 0 };
const viewGoal = { scale: 1, px: 0, py: 0 };     // 휠·버튼 입력이 쌓이는 목표값
const VIEW_MIN = 1, VIEW_MAX = 4;
const ZOOM_TAU = 90;                            // 수렴 시간(ms) — 작을수록 빠릿, 클수록 미끄럽다
const ZOOM_EPS = 4e-4;                          // 배율 수렴 판정 폭 — 단계가 촘촘해도 튀지 않게
let zoomRaf = 0, zoomPrev = 0, zooming = false;
let dragState = null;

function viewClamp() {
  const W = MAP_WIDTH, H = MAP_HEIGHT, s = view.scale;
  view.px = cl(view.px, W - W * s, 0);
  view.py = cl(view.py, H - H * s, 0);
}
/* 목표값도 같은 경계로 묶는다 — 애니메이션 중 가장자리로 튀지 않게 */
function goalClamp() {
  const W = MAP_WIDTH, H = MAP_HEIGHT, s = viewGoal.scale;
  viewGoal.px = cl(viewGoal.px, W - W * s, 0);
  viewGoal.py = cl(viewGoal.py, H - H * s, 0);
}
function syncGoal() {
  viewGoal.scale = view.scale;
  viewGoal.px = view.px;
  viewGoal.py = view.py;
}
function worldFromScreen(sx, sy) {
  return { x: (sx - view.px) / view.scale, y: (sy - view.py) / view.scale };
}
function screenFromWorld(wx, wy) {
  return { x: wx * view.scale + view.px, y: wy * view.scale + view.py };
}
/* 배율은 즉시 바꾸지 않고 목표 배율까지 이어서 움직인다. 앵커(커서·화면 중앙)는
   목표값 기준으로 계산하므로 확대가 끝난 뒤에도 그 점이 제자리에 남는다. */
function setZoom(next, cx, cy) {
  if (!cvM) return;
  const s0 = viewGoal.scale || view.scale;
  const s1 = cl(next, VIEW_MIN, VIEW_MAX);
  const ax = cx == null ? MAP_WIDTH / 2 : cx;
  const ay = cy == null ? MAP_HEIGHT / 2 : cy;
  const k = s1 / s0;
  const gx = ax - (ax - viewGoal.px) * k;
  const gy = ay - (ay - viewGoal.py) * k;
  /* 한계 배율에서 더 밀어도 목표가 그대로면 프레임을 낭비하지 않는다 */
  if (Math.abs(s1 - s0) < 1e-6 && Math.abs(gx - viewGoal.px) < 0.01 && Math.abs(gy - viewGoal.py) < 0.01) return;
  viewGoal.px = gx;
  viewGoal.py = gy;
  viewGoal.scale = s1;
  goalClamp();
  startZoomAnim();
}
function zoomBy(f) { setZoom(viewGoal.scale * f, null, null); }
function zoomReset() { viewGoal.scale = 1; viewGoal.px = 0; viewGoal.py = 0; startZoomAnim(); }

function startZoomAnim() {
  if (zooming) return;
  zooming = true;
  zoomPrev = 0;
  zoomRaf = requestAnimationFrame(zoomStep);
}
/* 진행 중인 확대를 즉시 멈추고 현재 화면에 고정한다 (끌기 시작·새 게임) */
function stopZoomAnim() {
  if (zoomRaf) cancelAnimationFrame(zoomRaf);
  zoomRaf = 0;
  zooming = false;
  syncGoal();
}
function zoomStep(ts) {
  zoomRaf = 0;
  const dt = zoomPrev ? Math.min(64, ts - zoomPrev) : 16.7;
  zoomPrev = ts;
  const k = 1 - Math.exp(-dt / ZOOM_TAU);         // 프레임 간격에 맞춘 지수 보간
  const ds = viewGoal.scale / view.scale;         // 배율은 비율로 다뤄 단계가 촘촘해도 일정하게
  const dx = viewGoal.px - view.px, dy = viewGoal.py - view.py;
  if (Math.abs(ds - 1) < ZOOM_EPS && Math.abs(dx) < 0.15 && Math.abs(dy) < 0.15) {
    view.scale = viewGoal.scale;                  // 남은 오차를 정리하고 또렷한 마지막 프레임
    view.px = viewGoal.px; view.py = viewGoal.py;
    viewClamp();
    zooming = false;
    drawMap();
    return;
  }
  view.scale *= Math.pow(ds, k);                  // 기하 보간 — 체감 속도가 일정하다
  view.px += dx * k;
  view.py += dy * k;
  drawMap();
  zoomRaf = requestAnimationFrame(zoomStep);
}

/* 2차 베지어 위의 점 */
function quadPt(a, q, b, t) {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * q.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * q.y + t * t * b.y
  };
}

/* 군로 : 세력 관계별 색 + 선택/호버 강조 */
function drawLinks(x, sc) {
  const sel = G.sel, hov = hover, pf = G.pf;
  const seen = {};
  const dash = [6 / sc, 6 / sc];
  x.save();
  x.lineCap = 'round';
  Object.keys(G.cities).forEach(n => {
    const c = G.cities[n];
    c.links.forEach(m => {
      const key = n < m ? n + '|' + m : m + '|' + n;
      if (seen[key]) return;
      seen[key] = 1;
      const d = G.cities[m];
      if (!d) return;
      const hotSel = sel === n || sel === m;
      const hotHov = !hotSel && (hov === n || hov === m);
      const mine = c.owner === pf, mine2 = d.owner === pf;
      let rgb, alpha, w;
      if (hotSel) { rgb = '255,226,150'; alpha = .95; w = 2.8; }
      else if (hotHov) { rgb = '255,240,200'; alpha = .85; w = 2.3; }
      else if (mine && mine2) { rgb = '250,206,126'; alpha = .72; w = 2.0; }
      else if (mine || mine2) { rgb = '235,124,86'; alpha = .62; w = 1.9; }
      else { rgb = '236,226,200'; alpha = .40; w = 1.5; }

      const dx = d.x - c.x, dy = d.y - c.y, len = Math.hypot(dx, dy) || 1;
      const bow = len * 0.06;
      const q = { x: (c.x + d.x) / 2 - dy / len * bow, y: (c.y + d.y) / 2 + dx / len * bow };

      x.beginPath(); x.moveTo(c.x, c.y); x.quadraticCurveTo(q.x, q.y, d.x, d.y);
      x.setLineDash([]);
      x.strokeStyle = 'rgba(10,16,12,' + (hotSel ? .55 : .38) + ')';
      x.lineWidth = (w + 3.2) / sc;
      x.stroke();

      x.beginPath(); x.moveTo(c.x, c.y); x.quadraticCurveTo(q.x, q.y, d.x, d.y);
      x.setLineDash(hotSel ? [dash[0] * .7, dash[1] * .7] : dash);
      x.strokeStyle = 'rgba(' + rgb + ',' + alpha + ')';
      x.lineWidth = w / sc;
      if (hotSel) { x.shadowColor = 'rgba(255,224,150,.7)'; x.shadowBlur = 8 / sc; }
      x.stroke();
      x.shadowBlur = 0;
      x.shadowColor = 'transparent';

      /* 선택 도시에서 뻗는 군로에는 진행 방향 표시 */
      if (hotSel) {
        const from = sel === n ? c : d, to = sel === n ? d : c;
        const p1 = quadPt(from, q, to, 0.48), p2 = quadPt(from, q, to, 0.62);
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const sz = 6.5 / sc;
        x.setLineDash([]);
        x.beginPath();
        x.moveTo(p2.x, p2.y);
        x.lineTo(p2.x - sz * Math.cos(ang - 0.45), p2.y - sz * Math.sin(ang - 0.45));
        x.lineTo(p2.x - sz * Math.cos(ang + 0.45), p2.y - sz * Math.sin(ang + 0.45));
        x.closePath();
        x.fillStyle = 'rgba(255,234,170,.95)';
        x.fill();
      }
    });
  });
  x.restore();
}

/* 확대에 따라 성과 병력 표시도 키운다. 모바일에서는 실제 화면 크기도 보정한다. */
function isLandscapeLayout() {
  return typeof window !== 'undefined' && window.innerWidth <= 1180 &&
    window.innerHeight > 0 && window.innerHeight <= 600 && window.innerWidth > window.innerHeight;
}
function isMobileMap() {
  return typeof window !== 'undefined' && window.innerWidth > 0 && (window.innerWidth <= 940 || isLandscapeLayout());
}
function cityMarkerScale(sc = view.scale) {
  const rect = cvM?.getBoundingClientRect();
  if (isMobileMap() && rect?.width > 0) return Math.max(1, MAP_WIDTH / rect.width * (0.32 + 0.16 * (sc - 1)));
  // PC는 최소 배율에서 10% 작게 시작하고 최대 확대 시에는 기존 크기를 유지한다.
  return 0.9 + 1.1 * (Math.sqrt(Math.max(1, sc)) - 1);
}

/* 규모별 성곽: 작은 토성 → 누각과 성벽 → 이중 성벽·쌍루. 병력은 아래에 표시한다. */
function drawCityGlyph(x, c, size, col, scale) {
  x.save(); x.translate(c.x,c.y); x.scale(scale,scale);
  const r=size.rank, w=9+r*3, north=BattleTerrain.profiles[c.name] && ['dry','loess','upland'].includes(BattleTerrain.profiles[c.name].theme);
  x.fillStyle='rgba(0,0,0,.38)'; x.beginPath();x.ellipse(2,7,w+5,5,0,0,Math.PI*2);x.fill();
  if(r===3) {
    x.fillStyle='#343a34';x.fillRect(-w-4,-5,(w+4)*2,14);
    x.strokeStyle=hexA(col,.8);x.lineWidth=1.3;x.strokeRect(-w-4,-5,(w+4)*2,14);
  }
  const wall=x.createLinearGradient(0,-8,0,9);wall.addColorStop(0,north?'#c0a579':'#98a79b');wall.addColorStop(1,north?'#64573e':'#46554e');
  x.fillStyle=wall;x.fillRect(-w,-5,w*2,13);x.strokeStyle=col;x.lineWidth=1.5;x.strokeRect(-w,-5,w*2,13);
  for(let k=-w+1;k<w;k+=5){x.fillStyle=north?'#c9ad7c':'#acb6a7';x.fillRect(k,-8,3,4);}
  x.strokeStyle='rgba(22,27,22,.45)';x.lineWidth=.7;
  for(let y=0;y<8;y+=4){x.beginPath();x.moveTo(-w,y);x.lineTo(w,y);x.stroke();}
  const tower=(tx,ty,wide)=>{
    x.fillStyle=north?'#9b724a':'#8b6048';x.fillRect(tx-wide*.65,ty,wide*1.3,7);
    x.fillStyle=north?'#584633':'#304b49';x.beginPath();x.moveTo(tx-wide,ty+1);x.lineTo(tx,ty-5);x.lineTo(tx+wide,ty+1);x.closePath();x.fill();
    x.strokeStyle='#d2c199';x.lineWidth=.8;x.stroke();
    x.fillStyle='#222a24';x.fillRect(tx-1,ty+2,2,4);
  };
  tower(0,r===1?-9:-13,r===1?7:8);
  if(r>=2){tower(-w+2,-7,5);tower(w-2,-7,5);}
  if(r===3){tower(0,-20,6);x.fillStyle=hexA(col,.8);x.fillRect(-w-3,7,(w+3)*2,2);}
  x.fillStyle='#151c17';x.beginPath();x.moveTo(-3,8);x.lineTo(-3,3);x.quadraticCurveTo(0,-2,3,3);x.lineTo(3,8);x.closePath();x.fill();
  x.strokeStyle='#ceb988';x.lineWidth=.8;x.stroke();
  x.restore();
}

let cityLabelCache = null;
function cityLabelLayout(x, names, labelScale = 1, markerScale = 1) {
  const destinations=destPick()?.cands || [];
  const key=cvM.width+':'+cvM.height+':'+labelScale+':'+markerScale+':'+view.scale+':'+view.px+':'+view.py+':'+G.sel+':'+hover+':'+G.pf+':'+destinations.join(',')+':'+names.map(n=>n+':'+G.cities[n].x+':'+G.cities[n].y+':'+citySize(G.cities[n]).rank+':'+G.cities[n].owner).join('|');
  if(cityLabelCache && cityLabelCache.key===key) return cityLabelCache.labels;
  const taken=names.map(n=>{const c=screenFromWorld(G.cities[n].x,G.cities[n].y),rank=citySize(G.cities[n]).rank,roof=rank===3?25:rank===2?18:14;return {name:n,x:c.x-27*markerScale,y:c.y-roof*markerScale,w:54*markerScale,h:(roof+21)*markerScale};}),labels={};
  const s=v=>v*labelScale;
  x.font='bold '+s(14)+'px "Batang","바탕",Georgia,serif';
  const priority=n=>(n===G.sel?10000:0)+(n===hover?5000:0)+(destinations.includes(n)?1000:0)+(G.cities[n].owner===G.pf?100:0)+citySize(G.cities[n]).rank;
  names.slice().sort((a,b)=>priority(b)-priority(a) || G.cities[a].y-G.cities[b].y || G.cities[a].x-G.cities[b].x).forEach(n=>{
    const c=screenFromWorld(G.cities[n].x,G.cities[n].y),width=x.measureText(n).width;
    const rank=citySize(G.cities[n]).rank;
    // PC에서는 성 지붕 바로 위에 고정한다. 축소 중 충돌 회피로 이름표가 멀어지지 않는다.
    if (labelScale <= 1.4) {
      const dx=-width/2,dy=-(rank===3?25:rank===2?18:14)*markerScale-s(6);
      labels[n]={dx,dy,width,box:{x:c.x+dx-s(6),y:c.y+dy-s(14),w:width+s(12),h:s(20)}};
      return;
    }
    // 이름표의 가장자리를 성에 붙인다. 밀집 지역도 외곽의 빈 공간까지 밀어내지 않는다.
    const roof=rank===3?25:rank===2?18:14;
    const above=-roof*markerScale-2-s(5.5),below=21*markerScale+s(13.5),side=27*markerScale+s(5.5);
    const candidates=[[-width/2,above],[-width/2,below],[side,s(4)],[-width-side,s(4)],
      [-width/2-s(5),above],[-width/2+s(5),above]];
    let best=candidates[0],bestOverlap=Infinity,bestCollision=Infinity;
    for (const [dx,dy] of candidates) {
      const r={x:c.x+dx-s(6),y:c.y+dy-s(14),w:width+s(12),h:s(20)};
      const outside=Math.max(0,-r.x)+Math.max(0,r.x+r.w-MAP_WIDTH)+Math.max(0,-r.y)+Math.max(0,r.y+r.h-MAP_HEIGHT);
      const collision=outside*s(100)+taken.reduce((sum,o)=>o.name===n?sum:sum+Math.max(0,Math.min(r.x+r.w,o.x+o.w)-Math.max(r.x,o.x))*Math.max(0,Math.min(r.y+r.h,o.y+o.h)-Math.max(r.y,o.y)),0);
      const overlap=collision+Math.hypot(dx+width/2,dy-s(4))*.01;
      if(overlap<bestOverlap){bestOverlap=overlap;bestCollision=collision;best=[dx,dy];}
      // 위쪽부터 검사하여 겹침이 없는 첫 위치를 사용한다.
      if (collision < .1) { best=[dx,dy]; bestCollision=collision; break; }
    }
    const box={x:c.x+best[0]-s(6),y:c.y+best[1]-s(14),w:width+s(12),h:s(20)};
    const visible=bestCollision<.1 || n===G.sel || n===hover;
    labels[n]={dx:best[0],dy:best[1],width,box,visible};
    if (visible) taken.push(box);
  });
  cityLabelCache={key,labels};return labels;
}

/* 이름표는 읽기 쉬운 화면 크기를 유지하고 성 표식은 지도 확대 배율을 반영한다. */
function drawCities(x, sc) {
  const W = MAP_WIDTH, H = MAP_HEIGHT;
  const SERIF = '"Batang","바탕",Georgia,serif';
  const SANS = '"Malgun Gothic","맑은 고딕",sans-serif';
  const markerScale = cityMarkerScale(sc);
  const s = v => v * markerScale;
  const rect = cvM.getBoundingClientRect();
  const mobile = isMobileMap();
  const labelScale = mobile && rect.width > 0 ? Math.max(1, 13 / 14 * W / rect.width) : 1;
  const ls = v => v * labelScale;
  const names = Object.keys(G.cities);
  x.save();x.setTransform(cvM.width/W,0,0,cvM.height/H,0,0);
  const labels=cityLabelLayout(x,names,labelScale,markerScale);
  const dp = destPick();                               // 지도에서 고르는 목적지 후보 (이동: 금색 / 출진: 붉은 점선)
  const destCands = dp ? dp.cands : [];
  const destAtk = !!(dp && dp.kind === 'attack');
  const onScreen = c => {
    const p = screenFromWorld(c.x, c.y);
    return p.x > -s(90) && p.x < W + s(90) && p.y > -s(70) && p.y < H + s(70);
  };
  names.slice().sort((a,b)=>Number(a===G.sel)-Number(b===G.sel)).forEach(n => {
    const city=G.cities[n];
    if (!onScreen(city)) return;
    const p=screenFromWorld(city.x,city.y),c=Object.assign({},city,{x:Math.round(p.x),y:Math.round(p.y)});
    const size = citySize(c), R = s(size.radius);
    const f = G.factions[c.owner];
    const col = f ? f.color : '#8b9a8e';
    const isSel = G.sel === n, isHov = hover === n, isCand = destCands.indexOf(n) >= 0;
    const hr = s(isHov ? 46 : 36);
    const halo = x.createRadialGradient(c.x, c.y, s(5), c.x, c.y, hr);
    halo.addColorStop(0, hexA(col, isHov ? .45 : .22));
    halo.addColorStop(.55, hexA(col, isHov ? .16 : .07));
    halo.addColorStop(1, hexA(col, 0));
    x.beginPath(); x.arc(c.x, c.y, hr, 0, 7); x.fillStyle = halo; x.fill();
    if (isSel) {
      x.beginPath(); x.arc(c.x, c.y, R + s(7), 0, 7); x.strokeStyle = '#ffe6a8'; x.lineWidth = s(2); x.stroke();
      x.beginPath(); x.arc(c.x, c.y, R + s(12), 0, 7); x.strokeStyle = 'rgba(255,230,168,.22)'; x.lineWidth = s(1); x.stroke();
    }
    if (isCand) {
      /* 목적지 후보 — 점선 테두리와 위쪽 화살표 (이동: 금색 / 출진: 붉은색) */
      x.save();
      x.beginPath(); x.arc(c.x, c.y, R + s(8), 0, 7);
      x.setLineDash([s(5), s(4)]);
      x.strokeStyle = destAtk ? 'rgba(255,150,132,.95)' : 'rgba(255,226,150,.9)';
      x.lineWidth = s(2.2);
      x.shadowColor = destAtk ? 'rgba(255,110,88,.6)' : 'rgba(255,214,120,.55)'; x.shadowBlur = s(7);
      x.stroke();
      x.restore();
      x.beginPath();
      x.moveTo(c.x, c.y - R - s(9));
      x.lineTo(c.x - s(5.5), c.y - R - s(17));
      x.lineTo(c.x + s(5.5), c.y - R - s(17));
      x.closePath();
      x.fillStyle = destAtk ? 'rgba(255,186,168,.98)' : 'rgba(255,232,168,.95)'; x.fill();
      x.strokeStyle = 'rgba(6,11,8,.75)'; x.lineWidth = s(1); x.stroke();
    }
    drawCityGlyph(x, c, size, col, markerScale);
    x.fillStyle = '#fff'; x.font = 'bold ' + s(10.5) + 'px ' + SANS;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = 'rgba(0,0,0,.8)'; x.shadowBlur = s(2); x.shadowOffsetY = s(0.6);
    x.fillText(troopLabel(c.troops), c.x, c.y + s(15));
    x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetY = 0;
    x.textBaseline = 'alphabetic';
    /* 이름표 — 어두운 판 위에 얹어 어떤 지형에서도 읽히게 */
    const anchor=labels[n],L={x:c.x+anchor.dx,y:c.y+anchor.dy};
    x.textAlign = 'left';
    if (anchor.visible !== false) {
      x.font = 'bold ' + ls(14) + 'px ' + SERIF;
      const nw = anchor.width;
      x.save();
      pRound(x, L.x - ls(5.5), L.y - ls(13.5), nw + ls(11), ls(19), ls(4.5));
      const pg = x.createLinearGradient(0, L.y - ls(13.5), 0, L.y + ls(5.5));
      pg.addColorStop(0, isSel ? 'rgba(60,46,20,.92)' : 'rgba(10,16,12,.86)');
      pg.addColorStop(1, isSel ? 'rgba(32,24,11,.86)' : 'rgba(6,10,8,.72)');
      x.fillStyle = pg; x.fill();
      x.strokeStyle = isSel ? 'rgba(255,216,140,.7)' : hexA(col, .4);
      x.lineWidth = s(1); x.stroke();
      x.restore();
      x.lineWidth = ls(3.5); x.strokeStyle = 'rgba(6,11,8,.92)';
      x.strokeText(n, L.x, L.y);
      x.fillStyle = isSel ? '#ffe6a8' : '#f8f2e2';
      x.fillText(n, L.x, L.y);
    }
    if (isCapital(c)) {
      x.font = s(11.5) + 'px ' + SANS;
      x.lineWidth = s(3); x.strokeStyle = 'rgba(6,11,8,.9)';
      x.strokeText('★', c.x + s(11), c.y - s(8));
      x.fillStyle = '#ffd77a';
      x.fillText('★', c.x + s(11), c.y - s(8));
    }
    if (c.owner === G.pf) {
      x.beginPath(); x.arc(c.x - s(11), c.y - s(9), s(3.6), 0, 7);
      x.fillStyle = '#ffe08a'; x.fill();
      x.strokeStyle = 'rgba(6,11,8,.9)'; x.lineWidth = s(1); x.stroke();
    }
  });
  x.restore();
}

/* 화면 고정 UI : 표제·방위·범례·축척·힌트 */
function drawChrome(x, W, H, SERIF, SANS) {
  /* 지도 테두리 — 이중 금선과 모서리 장식 */
  x.save();
  x.strokeStyle = 'rgba(230,195,124,.26)';
  x.lineWidth = 1;
  x.strokeRect(9.5, 9.5, W - 19, H - 19);
  x.strokeStyle = 'rgba(230,195,124,.12)';
  x.strokeRect(14.5, 14.5, W - 29, H - 29);
  const corner = (cx, cy, sx, sy) => {
    x.beginPath();
    x.moveTo(cx, cy + sy * 26);
    x.lineTo(cx, cy);
    x.lineTo(cx + sx * 26, cy);
    x.stroke();
  };
  x.strokeStyle = 'rgba(236,206,148,.5)';
  x.lineWidth = 1.6;
  corner(19, 19, 1, 1); corner(W - 19, 19, -1, 1);
  corner(19, H - 19, 1, -1); corner(W - 19, H - 19, -1, -1);
  x.restore();

  /* 표제 */
  x.save();
  pRound(x, 18, 16, 104, 38, 8);
  const tg = x.createLinearGradient(0, 16, 0, 54);
  tg.addColorStop(0, 'rgba(30,25,15,.86)');
  tg.addColorStop(1, 'rgba(10,16,12,.68)');
  x.fillStyle = tg; x.fill();
  x.strokeStyle = 'rgba(230,195,124,.32)'; x.lineWidth = 1; x.stroke();
  pRound(x, 22, 20, 96, 30, 6);
  x.strokeStyle = 'rgba(230,195,124,.14)'; x.lineWidth = 1; x.stroke();
  x.fillStyle = '#e8cd97'; x.font = 'bold 17px ' + SERIF;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = 4;
  x.fillText('天下圖', 70, 36);
  x.shadowColor = 'transparent'; x.shadowBlur = 0;
  x.restore();

  /* 방위 */
  x.save();
  x.translate(W - 46, 50);
  /* 나침반 테두리 */
  x.beginPath(); x.arc(0, 0, 17, 0, Math.PI * 2);
  x.strokeStyle = 'rgba(230,195,124,.22)'; x.lineWidth = 1; x.stroke();
  x.beginPath(); x.arc(0, 0, 13.4, 0, Math.PI * 2);
  x.strokeStyle = 'rgba(230,195,124,.12)'; x.stroke();
  [0, 1, 2, 3].forEach(i => {
    const a = i * Math.PI / 2 - Math.PI / 2;
    x.beginPath();
    x.moveTo(Math.cos(a) * 13.4, Math.sin(a) * 13.4);
    x.lineTo(Math.cos(a) * 17, Math.sin(a) * 17);
    x.strokeStyle = 'rgba(230,195,124,.45)';
    x.lineWidth = 1.2;
    x.stroke();
  });
  /* 침 */
  x.beginPath();
  x.moveTo(0, -11); x.lineTo(3.8, 0); x.lineTo(0, 0);
  x.closePath();
  x.fillStyle = 'rgba(240,206,140,.85)'; x.fill();
  x.beginPath();
  x.moveTo(0, 11); x.lineTo(-3.8, 0); x.lineTo(0, 0);
  x.closePath();
  x.fillStyle = 'rgba(240,206,140,.38)'; x.fill();
  x.beginPath(); x.arc(0, 0, 1.7, 0, Math.PI * 2);
  x.fillStyle = 'rgba(255,232,180,.9)'; x.fill();
  x.font = 'bold 9.5px ' + SANS; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.fillStyle = 'rgba(230,195,124,.7)';
  x.fillText('北', 0, -19);
  x.restore();

  /* 축척 : 확대 배율을 반영해 구간을 자동 선택 */
  const pxPerKm = (MAP_VIEW.kx / 96.4) * view.scale;
  const steps = [25, 50, 100, 200, 500];
  let km = steps[steps.length - 1];
  for (let i = 0; i < steps.length; i++) { if (steps[i] * pxPerKm >= 70) { km = steps[i]; break; } }
  const bw = km * pxPerKm, bx = W - 26, by = H - 42;
  x.save();
  pRound(x, bx - bw - 12, by - 15, bw + 24, 33, 7);
  x.fillStyle = 'rgba(8,13,10,.62)'; x.fill();
  x.strokeStyle = 'rgba(230,195,124,.14)'; x.lineWidth = 1; x.stroke();
  /* 교차 눈금 막대 */
  const seg = bw / 4;
  for (let i = 0; i < 4; i++) {
    x.fillStyle = i % 2 ? 'rgba(230,200,150,.28)' : 'rgba(230,200,150,.75)';
    x.fillRect(bx - bw + seg * i, by - 2.5, seg, 5);
  }
  x.strokeStyle = 'rgba(230,200,150,.65)'; x.lineWidth = 1.2;
  x.beginPath();
  x.moveTo(bx - bw, by); x.lineTo(bx, by);
  x.moveTo(bx - bw, by - 5); x.lineTo(bx - bw, by + 5);
  x.moveTo(bx, by - 5); x.lineTo(bx, by + 5);
  x.stroke();
  x.fillStyle = 'rgba(234,216,180,.8)';
  x.font = '10px ' + SANS; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.fillText('0', bx - bw, by + 14);
  x.fillText(km + 'km', bx, by + 14);
  x.restore();

  /* 힌트 */
  x.textAlign = 'right'; x.textBaseline = 'alphabetic';
  x.fillStyle = 'rgba(255,255,255,.45)'; x.font = '11.5px ' + SANS;
  x.fillText('휠·더블클릭 확대 · 드래그 이동 · ★ 수도', W - 16, H - 12);
  x.textAlign = 'left';
}

/* 지도에서 공격 방향을 알린 다음 전투/수비 편성으로 넘긴다. */
function stopAttackIntro() {
  if (!attackIntro) return;
  if (attackIntro.raf) cancelAnimationFrame(attackIntro.raf);
  const app = $('app');
  if (app) app.inert = attackIntro.wasInert;
  const banner = $('attackIntro');
  if (banner) banner.hidden = true;
  if (attackIntro.game.ui) delete attackIntro.game.ui.attackIntro;
  attackIntro = null;
}
function playAttackIntro(ctx, next, intercept = false) {
  if (intercept ? ctx.interceptShown : ctx.introShown) { next(); return; }
  ctx.introShown = true;
  if(intercept) ctx.interceptShown=true;
  // DOM 없는 시뮬레이션은 대기 없이 기존 전투 계산을 사용한다.
  if (!cvM || cvM.isConnected !== true || !ctxM || typeof requestAnimationFrame !== 'function') {
    next(); return;
  }
  const fromName=ctx.from,toName=ctx.to;
  const from = G.cities[fromName], to = G.cities[toName];
  if (!from || !to) { next(); return; }
  stopAttackIntro();
  stopZoomAnim();
  dragState = null; hover = null;
  // 모바일의 도시·명령/전황 기록 탭에서도 지도 위의 진군 연출을 볼 수 있게 한다.
  mobilePanel('map');
  // 확대 지도의 화면 밖에서 시작되는 공격도 출발지와 목적지를 함께 보여 준다.
  const points = [from, to].map(c => screenFromWorld(c.x, c.y));
  if (points.some(p => p.x < 60 || p.y < 60 || p.x > MAP_WIDTH - 60 || p.y > MAP_HEIGHT - 60)) {
    view.scale = 1; view.px = 0; view.py = 0; syncGoal();
  }
  const fid=ctx.atk;
  const faction = G.factions[fid]||{name:'수비',color:'#888'}, app = $('app'), banner = $('attackIntro');
  const defending=G.factions[ctx.def]||{name:'수비',color:'#888'};
  const intro = attackIntro = { game: G, from, to, color: faction.color, intercept, defendColor:defending.color,
    progress: 0, elapsed:0, started: null, raf: 0, wasInert: !!(app && app.inert), next };
  G.ui.attackIntro = { from: fromName, to: toName, faction: fid, kind:intercept?'intercept':'attack' };
  const automated = G.fullDelegation || !G.pf;
  if (app) app.inert = !automated;
  if (banner) {
    banner.classList.toggle('automated', !!automated);
    banner.style.setProperty('--attack-color', faction.color);
    banner.textContent = intercept?'야전 요격 · '+faction.name+'군 ('+fromName+') → ⚔ ← '+defending.name+'군 ('+toName+')':
      faction.name+'군 출진 · '+fromName+' → '+toName;
    banner.hidden = false;
  }
  renderTop(); renderCityPanel(); drawMap();
  const frame = ts => {
    if (attackIntro !== intro || G !== intro.game) return;
    if (intro.started === null) intro.started = ts;
    const elapsed = ts - intro.started;
    intro.elapsed=elapsed;
    intro.progress = cl(elapsed / 820, 0, 1);
    drawMap();
    if (elapsed >= 1120) {
      stopAttackIntro();
      renderTop(); drawMap();
      if (!pauseAI(next)) next();
      return;
    }
    intro.raf = requestAnimationFrame(frame);
  };
  intro.raf = requestAnimationFrame(frame);
}
function drawAttackIntro(x) {
  if (!attackIntro) return;
  const a = screenFromWorld(attackIntro.from.x, attackIntro.from.y);
  const b = screenFromWorld(attackIntro.to.x, attackIntro.to.y);
  if(attackIntro.intercept) {
    const meeting={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    drawIntroArrow(x,a,meeting,attackIntro.color,attackIntro.progress,false);
    drawIntroArrow(x,b,meeting,attackIntro.defendColor,attackIntro.progress,false);
    if(attackIntro.progress>=1) {
      const p=cl((attackIntro.elapsed-820)/300,0,1),radius=12+p*20;
      x.save();x.globalAlpha=1-p;x.strokeStyle='#ffe3a0';x.fillStyle='#fff3cb';
      x.lineWidth=3;x.shadowColor='#ffbb51';x.shadowBlur=18;
      x.beginPath();x.arc(meeting.x,meeting.y,radius,0,Math.PI*2);x.stroke();
      x.beginPath();x.arc(meeting.x,meeting.y,5*(1-p)+2,0,Math.PI*2);x.fill();
      for(let i=0;i<8;i++) {
        const angle=i*Math.PI/4;
        x.beginPath();x.moveTo(meeting.x+Math.cos(angle)*8,meeting.y+Math.sin(angle)*8);
        x.lineTo(meeting.x+Math.cos(angle)*(radius+9),meeting.y+Math.sin(angle)*(radius+9));x.stroke();
      }
      x.restore();
    }
    return;
  }
  drawIntroArrow(x,a,b,attackIntro.color,attackIntro.progress,true);
}
function drawIntroArrow(x,a,b,color,progress,arrivalRing) {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
  const bend = Math.min(45, length * .16);
  const q = { x: (a.x + b.x) / 2 - dy / length * bend,
    y: (a.y + b.y) / 2 + dx / length * bend };
  const t = 1 - Math.pow(1 - progress, 2);
  const tip = quadPt(a, q, b, t);
  const angle = Math.atan2((1-t)*(q.y-a.y)+t*(b.y-q.y), (1-t)*(q.x-a.x)+t*(b.x-q.x));
  x.save();
  x.strokeStyle = color; x.fillStyle = color;
  x.shadowColor = '#000'; x.shadowBlur = 9;
  x.lineCap = 'round'; x.lineJoin = 'round';
  x.lineWidth = 9;
  x.beginPath(); x.moveTo(a.x, a.y);
  for (let i = 1; i <= 48; i++) {
    const p = quadPt(a, q, b, t * i / 48); x.lineTo(p.x, p.y);
  }
  x.stroke();
  if (t > .02) {
    x.save(); x.translate(tip.x, tip.y); x.rotate(angle);
    const head = Math.min(23, length * t * .5);
    x.beginPath(); x.moveTo(3, 0); x.lineTo(-head, -head * .58);
    x.lineTo(-head * .72, 0); x.lineTo(-head, head * .58); x.closePath(); x.fill();
    x.restore();
  }
  x.lineWidth = 3;
  x.beginPath(); x.arc(a.x, a.y, 12, 0, Math.PI * 2); x.stroke();
  if (arrivalRing && progress >= 1) {
    x.beginPath(); x.arc(b.x, b.y, 24, 0, Math.PI * 2); x.stroke();
  }
  x.restore();
}

function renderMapFactionLegend() {
  const factions = Object.keys(G.factions).map(fid => ({f:G.factions[fid],count:factionCities(fid).length}))
    .filter(entry => entry.count).sort((a,b) => b.count-a.count);
  const grid = '<div class="faction-grid">' +
    factions.map(({f,count}) => '<div class="faction-item"><i style="background:' + f.color + '"></i><span>' + f.name + '</span><b>' + count + '</b></div>').join('') + '</div>';
  if (isMobileMap()) {
    const el = $('mapFactionLegend');
    const html = '<div class="legend-heading"><b>세력 일람</b><span>보유 도시 수</span></div>' + grid;
    if (el && el.innerHTML !== html) el.innerHTML = html;
  } else {
    const panel = $('mapFactionPanel'), el = $('mapFactionContent');
    if (panel) panel.classList.toggle('compact', factions.length <= 8);
    const html = '<div class="faction-caption">보유 도시 수</div>' + grid +
      '<div class="faction-routes"><span><i></i>전선</span><span><i class="friendly"></i>아군</span></div>';
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }
}

function drawMinimap() {
  const panel = $('mapMinimap');
  if (panel && !panel.open) return;
  const mini = $('mapMiniCanvas');
  if (!mini || !G || !terrainBaseLayer) return;
  const rect = mini.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1,Math.round(rect.width*ratio)),height = Math.max(1,Math.round(rect.height*ratio));
  if (mini.width !== width) mini.width = width;
  if (mini.height !== height) mini.height = height;
  const x = mini.getContext('2d'),sx = width/MAP_WIDTH,sy = height/MAP_HEIGHT;
  x.setTransform(1,0,0,1,0,0); x.clearRect(0,0,width,height);
  x.drawImage(terrainBaseLayer,0,0,width,height);
  x.setTransform(sx,0,0,sy,0,0);
  Object.values(G.cities).forEach(c => {
    x.beginPath(); x.arc(c.x,c.y,(c.name === G.sel ? 2.5 : 1.6)*ratio/sx,0,Math.PI*2);
    x.fillStyle = G.factions[c.owner]?.color || '#8b9a8e'; x.fill();
  });
  const left = -view.px/view.scale,top = -view.py/view.scale,w = MAP_WIDTH/view.scale,h = MAP_HEIGHT/view.scale;
  x.fillStyle = 'rgba(255,235,168,.12)'; x.fillRect(left,top,w,h);
  x.strokeStyle = '#fff0b0'; x.lineWidth = 1.5*ratio/sx;
  const inset = x.lineWidth/2;
  x.strokeRect(left+inset,top+inset,Math.max(0,w-2*inset),Math.max(0,h-2*inset));
  x.setTransform(1,0,0,1,0,0);
}

function fitMapResolution() {
  const host=cvM.parentElement;
  if (!host || !host.clientWidth || !host.clientHeight) return;
  const width=Math.max(1,Math.floor(Math.min(host.clientWidth,1240,host.clientHeight*MAP_WIDTH/MAP_HEIGHT)));
  const height=Math.max(1,Math.round(width*MAP_HEIGHT/MAP_WIDTH));
  const ratio=Math.min(window.devicePixelRatio || 1,4096/width,4096/height);
  cvM.style.width=width+'px';cvM.style.height=height+'px';
  const pixelWidth=Math.max(1,Math.round(width*ratio)),pixelHeight=Math.max(1,Math.round(height*ratio));
  if (cvM.width!==pixelWidth) cvM.width=pixelWidth;
  if (cvM.height!==pixelHeight) cvM.height=pixelHeight;
}

function drawMap() {
  if (!ctxM || !G) return;
  renderMapFactionLegend();
  fitMapResolution();
  const x = ctxM, W = MAP_WIDTH, H = MAP_HEIGHT;
  const sx=cvM.width/W,sy=cvM.height/H;
  const SERIF = '"Batang","바탕",Georgia,serif';
  const SANS = '"Malgun Gothic","맑은 고딕",sans-serif';
  const sc = view.scale;

  const ownership = CITY_DEFS.map(c => {
    const city = G.cities[c[0]], owner = city && city.owner;
    return owner + ':' + (G.factions[owner] || {}).color;
  }).join('|');
  if (ownership !== terrainOwnership) {
    terrainOwnership = ownership;
    terrainCache.clear();
    terrainLayer = null; terrainBaseLayer = null;
  }

  /* 확대·드래그가 끝나면 현재 영역을 화면 해상도로 다시 그린다.
     이동 중 새로 드러난 영역은 전체 지도 캐시로 채워 빈 틈을 막는다. */
  const tsize=cvM.width+'x'+cvM.height;
  const baseView={scale:1,px:0,py:0},baseKey=tsize+'@1:0:0';
  if (!terrainBaseLayer || terrainBaseLayer.__size!==tsize) terrainBaseLayer=terrainFor(baseKey,baseView,tsize);
  const tkey=tsize+'@'+sc+':'+view.px+':'+view.py;
  let layer = tkey===baseKey?terrainBaseLayer:terrainCache.get(tkey);
  if (!layer) {
    if ((zooming || dragState) && terrainLayer && terrainLayer.__size === tsize) layer = terrainLayer;
    else layer = terrainFor(tkey, view, tsize);
  }
  terrainLayer = layer;

  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, cvM.width, cvM.height);
  paintViewportRaster(x,terrainBaseLayer,view,W,H,cvM.width,cvM.height);
  if (terrainLayer!==terrainBaseLayer) paintViewportRaster(x,terrainLayer,view,W,H,cvM.width,cvM.height);

  /* ── 지도 본체 (월드 좌표) ── */
  x.setTransform(sx*sc, 0, 0, sy*sc, sx*view.px, sy*view.py);
  drawLinks(x, sc);
  drawCities(x, sc);

  /* ── 화면 좌표 UI ── */
  x.setTransform(sx, 0, 0, sy, 0, 0);
  /* 비네트 — 가장자리를 눌러 지도가 화면에 앉은 느낌을 준다 */
  const vg = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(.72, 'rgba(0,0,0,.10)');
  vg.addColorStop(1, 'rgba(0,0,0,.42)');
  x.fillStyle = vg;
  x.fillRect(0, 0, W, H);
  overlayGrain(x, W, H, .07, 'overlay');
  drawChrome(x, W, H, SERIF, SANS);
  drawMinimap();
  drawAttackIntro(x);

  const zl = $('zoomLabel');
  if (zl) zl.textContent = '×' + view.scale.toFixed(2);   // 촘촘한 단계가 눈에 보이도록 소수 둘째 자리까지

  /* 툴팁은 화면 좌표로 변환해 그린다 */
  if (hover && G.cities[hover]) {
    const c = G.cities[hover];
    const p = screenFromWorld(c.x, c.y);
    drawCityTip(x, Object.assign({}, c, { x: p.x, y: p.y }));
  }
}

function drawCityTip(x, c) {
  const f = G.factions[c.owner];
  const col = f ? f.color : '#8b9a8e';
  const SANS = '"Malgun Gothic","맑은 고딕",sans-serif';
  const mw = s => { const m = x.measureText ? x.measureText(s) : null; return (m && m.width) || s.length * 12; };
  const offs = officersIn(c.name), avail = offs.filter(o => !o.used).length;
  const rows = [
    ['병력', commas(c.troops) + ' / ' + commas(capOf(c))],
    ['주둔 무장', offs.length + '명' + (avail < offs.length ? ' · 가용 ' + avail : '')],
    ['훈련 · 사기', c.training + ' · ' + c.morale],
    ['농업 · 상업', c.agri + ' · ' + c.comm],
    ['방어 · 치안', c.def + ' · ' + c.order],
    ['재야 · 포로', freeOfficersIn(c.name).length + ' · ' + prisonerOfficersIn(c.name).length]
  ];
  x.save();
  x.font = '11.5px ' + SANS;
  let w = 168;
  rows.forEach(r => { w = Math.max(w, mw(r[0]) + mw(r[1]) + 52); });
  w = Math.max(w, mw(c.name) + 90);
  const h = 44 + rows.length * 19;
  let tx = c.x + 30;
  if (tx + w > MAP_WIDTH - 12) tx = c.x - w - 30;
  tx = cl(tx, 10, MAP_WIDTH - w - 10);
  const ty = cl(c.y - h / 2, 10, MAP_HEIGHT - h - 10);
  x.shadowColor = '#000d'; x.shadowBlur = 20; x.shadowOffsetY = 7;
  pRound(x, tx, ty, w, h, 10);
  x.fillStyle = 'rgba(11,17,13,.97)'; x.fill();
  x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetY = 0;
  x.strokeStyle = hexA(col, .55); x.lineWidth = 1; x.stroke();
  x.fillStyle = hexA(col, .8);
  x.fillRect(tx, ty + 8, 3, h - 16);
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  x.font = 'bold 14px "Batang","바탕",serif'; x.fillStyle = col;
  x.fillText(c.name, tx + 14, ty + 23);
  x.font = '10.5px ' + SANS; x.fillStyle = 'rgba(238,231,214,.55)'; x.textAlign = 'right';
  x.fillText(f ? f.name : '재야', tx + w - 12, ty + 22);
  x.textAlign = 'left';
  rows.forEach((r, i) => {
    const yy = ty + 45 + i * 19;
    x.font = '11.5px ' + SANS; x.fillStyle = 'rgba(147,161,145,.9)';
    x.fillText(r[0], tx + 14, yy);
    x.fillStyle = '#e9e2cf'; x.textAlign = 'right';
    x.fillText(r[1], tx + w - 12, yy);
    x.textAlign = 'left';
  });
  x.restore();
}

function renderCityList() {
  const el = $('cityList'); if (!el || !G) return;
  const html = '<table><caption>전체 도시 · 병력 · 인접 도시</caption><thead><tr><th>도시</th><th>세력</th><th>병력</th><th>인접</th></tr></thead><tbody>' +
    Object.values(G.cities).map(c => '<tr><td><button type="button" data-city="' + c.name +
      '" aria-pressed="' + (G.sel === c.name) + '" onclick="Game.selectCity(\'' + c.name + '\')">' +
      c.name + (c.owner === G.pf ? ' (아군)' : isAlly(G.pf, c.owner) ? ' (동맹국)' : '') + '</button></td><td>' +
      (G.factions[c.owner] || { name: '재야' }).name + '</td><td>' + commas(c.troops) + '</td><td>' +
      c.links.join(' · ') + '</td></tr>').join('') + '</tbody></table>';
  if (el.innerHTML !== html) el.innerHTML = html;
}
function renderCityPanel() {
  renderCityList();
  const el = $('cityPanel'); if (!el) return;
  if (!G.sel) {
    /* 지도 빈 곳을 클릭하면 보유 도시 목록을 보여 주고 그 자리에서 선택할 수 있게 한다 */
    const mine = G.pf ? factionCities(G.pf) : Object.keys(G.cities);
    const cityRows = mine.map(n => {
      const c = G.cities[n], cf = G.factions[c.owner] || {};
      const offs = officersIn(n), avail = offs.filter(o => !o.used).length;
      return '<button type="button" class="mycity" data-city="' + n + '" onclick="Game.selectCity(\'' + n + '\')" title="' + n +
        ' · 병력 ' + commas(c.troops) + ' · 방어 ' + c.def + ' · 무장 ' + offs.length + '명' + (avail < offs.length ? ' (가용 ' + avail + ')' : '') + '">' +
        '<i class="dot" style="background:' + (cf.color || '#8b9a8e') + '"></i>' +
        '<b class="n">' + n + '</b>' +
        (isCapital(c) ? '<span class="tag">수도</span>' : '') +
        '<span class="t">병력 ' + commas(c.troops) + '</span>' +
        '<span class="o' + (avail ? '' : ' done') + '">무장 ' + offs.length + (avail < offs.length ? ' · 가용 ' + avail : '') + '</span>' +
      '</button>';
    }).join('');
    el.innerHTML = '<div class="empty">' +
      '<div class="empty-seal">令</div>' +
      '<h3>' + (G.pf ? '명령을 내릴 도시를 선택하세요' : '관전할 도시를 선택하세요') + '</h3>' +
      '<p class="muted">' + (G.pf ? '지도에서 도시를 클릭하거나 아래 목록에서 내 도시를 고르세요.<br>지도 빈 곳을 클릭하면 이 목록이 나타납니다.' : '모든 세력이 AI의 지휘로 행동합니다. 지도나 아래 목록에서 도시 현황을 살펴볼 수 있습니다.') + '</p>' +
      '<div class="empty-stats">' +
        '<div class="chip"><span class="k">명령권</span><b>' + G.cmd + ' / ' + G.cmdMax + '</b></div>' +
        '<div class="chip"><span class="k">보유 도시</span><b>' + mine.length + ' / ' + Object.keys(G.cities).length + '</b></div>' +
      '</div>' +
      '<div class="mylist"><div class="mylist-h"><span>' + (G.pf ? '보유 도시' : '전체 도시') + ' · 바로 선택</span><b>' + mine.length + '곳</b></div>' +
        (cityRows || '<p class="muted">보유 도시가 없습니다.</p>') +
      '</div>' +
      '<p class="legend">도시에 마우스를 올리면 상세 정보가 표시됩니다. 인접 도시 이름을 눌러 바로 이동할 수 있습니다. [이동] 명령 중에는 지도에서 목적지 도시를 클릭해 고를 수 있습니다.</p>' +
    '</div>';
    return;
  }
  const c = G.cities[G.sel], f = G.factions[c.owner];
  const offs = officersIn(c.name).sort((a, b) => Number(isLeader(b.name)) - Number(isLeader(a.name)));
  const avail = offs.filter(o => !o.used).length;
  // 재야·포로 무장은 주둔 무장과 별도로 표시한다 (등용 후보)
  const frees = freeOfficersIn(c.name);
  const pows = prisonerOfficersIn(c.name);
  const cap = Math.max(1, capOf(c));
  const mine = isPlayerCity(c);
  const ally = isAlly(G.pf, c.owner);
  const peace = !mine && !ally && hasPeace(G.pf,c.owner);
  let h = '<div class="city-head">' +
    '<div class="city-title"><span class="dot" style="background:' + (f ? f.color : '#8b9a8e') + '"></span>' +
    '<h3>' + c.name + '</h3><span class="fac-chip">' + (f ? f.name : '재야') + '</span><span class="fac-chip" title="인구 9만 미만: 소 · 9만 이상: 중 · 14만 이상: 대">' + citySize(c).label + '</span></div>' +
    '<span class="badge ' + (mine ? 'mine' : ally ? 'ally' : 'foe') + '">' + (!G.pf ? 'AI 운영 도시' : mine ? '내 도시' : ally ? '동맹국 도시' : '적 도시') + '</span></div>';
  /* 좌측 열: 도시 현황 */
  let colA = '<div class="city-management"><p class="muted">'+objectiveStatus().label+'</p><p class="muted">위임: '+(!G.pf || G.fullDelegation ? '전체위임 · AI 운영' : CITY_POLICIES[c.policy]||CITY_POLICIES.manual)+'</p></div><div class="cmdline"><span>명령권</span><b>' + G.cmd + ' / ' + G.cmdMax + '</b></div>';
  colA += '<div class="statlist">' + [['agri', '농업'], ['comm', '상업'], ['def', '방어'], ['order', '치안']].map(([k, label]) =>
    '<div class="srow"><span class="k">' + label + '</span><div class="bar"><i class="barfill ' + k + '" style="width:' + c[k] + '%"></i></div><b class="v">' + c[k] + '</b></div>'
  ).join('') + '</div>';
  colA += '<div class="chipgrid">' +
    '<div class="chip"><span class="k">인구</span><b>' + c.pop + '만</b></div>' +
    '<div class="chip"><span class="k">훈련</span><b>' + c.training + '</b></div>' +
    '<div class="chip"><span class="k">사기</span><b>' + c.morale + '</b></div>' +
    '<div class="chip"><span class="k">병력</span><b>' + commas(c.troops) + '</b></div>' +
  '</div>';
  const overCap = Math.max(0, c.troops - cap);
  const pct = Math.min(100, Math.round(c.troops / cap * 100));
  colA += '<div class="bar troop"><i class="barfill troop" style="width:' + pct + '%"></i></div>' +
    '<div class="bar-cap"><span>병력 상한 ' + commas(cap) + (isCapital(c) ? ' · 수도 1.5배' : '') + (overCap > 0 ? ' · 초과 ' + commas(overCap) : '') +
    '</span><span>' + pct + '%</span></div>';
  if (overCap > 0) colA += '<p class="warn">인구 상한보다 병력이 ' + commas(overCap) + ' 많습니다. 초과 병력은 군량을 2배로 소비합니다.</p>';
  const economy = factionEconomy(c.owner);
  colA += '<p class="muted">'+cityRegion(c).label+'</p><div class="income">' +
    '<div class="ic"><span class="k">도시 월 수입</span><b class="g">금 +' + commas(cityGoldIncome(c)) + '</b><b class="f">군량 +' + commas(cityFoodIncome(c)) + '</b></div>' +
    '<div class="ic"><span class="k">도시 주둔 소비</span><b class="g">금 -' + commas(cityGoldUpkeep(c)) + '</b><b class="f">군량 -' + commas(cityFoodUpkeep(c)) + '</b></div>' +
  '</div>';
  if (mine && economy.foodNet < 0) {
    const reserve = Math.floor(f.food/-economy.foodNet);
    colA += '<p class="' + (reserve < 4 ? 'warn' : 'muted') + '">군량 비축 약 ' + reserve + '개월</p>';
  }
  /* 우측 열: 무장 · 인접 도시 · 경고 */
  let colB = '<div class="sec"><span>주둔 무장</span><b>' + offs.length + '명' + (avail < offs.length ? ' · 가용 ' + avail : '') + '</b></div><div class="otags">' +
    (offs.map(o => '<span class="otag' + (isLeader(o.name) ? ' leader' : '') + (o.used ? ' used' : '') + '">' + portraitHtml(o.name, 16) + o.name +
      (isLeader(o.name) ? '<i class="leader-mark">군주</i>' : '') +
      (o.used ? '<i class="sk">완료</i>' : (o.skill ? '<i class="sk">' + o.skill + '</i>' : '')) + '</span>').join('') || '<span class="muted">없음</span>') +
  '</div>';
  /* 재야 · 포로 무장 — 등용 후보 */
  const otherTag = (o, cls) => {
    const of = cls === 'pow' ? G.factions[o.faction] : null;
    return '<span class="otag ' + cls + '">' + portraitHtml(o.name, 16) + o.name +
      '<i class="sk">' + (of ? '포로' : '재야') + '</i></span>';
  };
  colB += '<div class="sec"><span>재야 무장</span><b>' + frees.length + '명</b></div><div class="otags">' +
    (frees.map(o => otherTag(o, 'free')).join('') || '<span class="muted">없음</span>') + '</div>';
  colB += '<div class="sec"><span>포로 무장</span><b>' + pows.length + '명</b></div><div class="otags">' +
    (pows.map(o => otherTag(o, 'pow')).join('') || '<span class="muted">없음</span>') + '</div>';
  colB += '<div class="sec"><span>인접 도시</span></div><div class="nbs">' + c.links.map(n => {
    const d = G.cities[n], df = G.factions[d.owner];
    return '<span class="nb" role="button" tabindex="0" onclick="Game.selectCity(\'' + n + '\')" title="병력 ' + commas(d.troops) + ' · 방어 ' + d.def + '">' +
      '<span class="dot" style="background:' + (df ? df.color : '#8b9a8e') + '"></span>' +
      '<span class="n">' + n + (isAlly(G.pf, d.owner) ? ' · 동맹국' : '') + '</span><span class="t">' + commas(d.troops) + '</span></span>';
  }).join('') + '</div>';
  const noCmd = G.cmd <= 0 || G.aiRunning || G.fullDelegation;
  const noOff = offs.length === 0;
  // 이 도시 밖에서 아직 명령할 수 있는 내 도시 (명령권이 없으면 소용없으므로 제외)
  const otherReady = noCmd ? [] : factionCities(G.pf).filter(n => n !== c.name && availableOfficers(n).length);
  const tips = {
    agri: '농업을 올려 월 군량 수입을 늘립니다 (기본 금 60·명령 1·선택 시 비용/효과 예고)',
    comm: '상업을 올려 월 금 수입을 늘립니다 (기본 금 60·명령 1·선택 시 투자 회수 예고)',
    order: '치안을 올려 금·군량 생산과 징병 효율을 높입니다 (기본 금 60·명령 1)',
    def: '방어도를 올려 공성전 수비를 강화합니다 (기본 금 60·명령 1)',
    recruit: '1,000명당 금 80·치안 -5·신병 훈련 30/사기 55 — 도시당 월 1회 (명령 1)',
    levy: '1,000명당 금 160·치안 -1·신병 훈련 55/사기 75 — 반복 가능 (명령 1)',
    supply: '금 100/300/600으로 군량 200/600/1,200 매입 (명령 1·무장 불필요)',
    sellFood: '군량 200/600/1,200을 금 80/240/480에 매각 (명령 1·무장 불필요)',
    train: '훈련도와 사기를 올립니다 (명령 1)',
    move: '인접 아군 도시로 무장·병력을 옮깁니다 (명령 1)',
    attack: '인접 적 도시로 출진합니다 — 지도에서 목적지를 고릅니다 (명령 1)',
    hire: '현재 도시의 재야·포로와 인접 도시의 재야·적 무장을 설득합니다 (적 현역 충성 85 미만·군주 제외·명령 1)',
    reward: '금 ' + REWARD_COST + '으로 충성도를 올립니다 (명령 1)'
  };
  let dock = '', commandWarning = '';
  if (mine) {
    if (!offs.length) colB += '<p class="warn">주둔 무장이 없어 내정·군사 명령을 내릴 수 없습니다. [이동]으로 무장을 배치하세요.</p>';
    else if (!avail) {
      if (otherReady.length) {
        colB += '<p class="warn">이 도시의 무장은 이번 달 명령을 모두 마쳤습니다. (포상·군량 매입·매각은 계속 가능)<br>' +
          '다른 도시에서 명령을 계속할 수 있습니다:' + otherReady.map(n =>
            ' <span class="nb" role="button" tabindex="0" onclick="Game.selectCity(\'' + n + '\')" title="명령 가능한 무장 ' + availableOfficers(n).length + '명">' +
            '<span class="n">' + n + '</span><span class="t">' + availableOfficers(n).length + '</span></span>').join('') + '</p>';
      } else {
        colB += '<p class="warn">모든 무장이 이번 달 명령을 마쳤습니다. 포상·군량 매입·매각을 하거나 [턴 종료]로 다음 달로 넘어가세요.</p>';
      }
    }
    if (G.fullDelegation) colB += '<p class="muted">전체위임 중입니다. 직접 명령하려면 [위임·목표]에서 전체위임을 해제하세요.</p>';
    else if (noCmd) {
      commandWarning = '<p class="warn city-command-warning" role="status">명령권이 없습니다. [턴 종료]로 다음 달로 넘어가세요.</p>';
      colB += commandWarning;
    }
    const groups = [
      ['내정', [['agri', '田', '개발'], ['comm', '商', '상업'], ['order', '安', '치안'], ['def', '修', '수복']]],
      ['군사', [['recruit', '兵', '징병'], ['levy', '募', '모병'], ['train', '訓', '훈련'], ['move', '移', '이동'], ['attack', '攻', '출진']]],
      ['인사·보급', [['hire', '用', '등용'], ['reward', '賞', '포상'], ['supply', '糧', '군량 매입'], ['sellFood', '賣', '군량 매각']]]
    ];
    const call = {
      agri: 'Game.cmdAdmin(\'' + c.name + '\',\'agri\')',
      comm: 'Game.cmdAdmin(\'' + c.name + '\',\'comm\')',
      order: 'Game.cmdAdmin(\'' + c.name + '\',\'order\')',
      def: 'Game.cmdAdmin(\'' + c.name + '\',\'def\')',
      recruit: 'Game.cmdRecruit(\'' + c.name + '\')', levy: 'Game.cmdLevy(\'' + c.name + '\')',
      train: 'Game.cmdTrain(\'' + c.name + '\')',
      supply: 'Game.cmdSupply(\'' + c.name + '\')',
      sellFood: 'Game.cmdSellFood(\'' + c.name + '\')',
      move: 'Game.cmdMove(\'' + c.name + '\')', attack: 'Game.cmdAttack(\'' + c.name + '\')',
      hire: 'Game.cmdHire(\'' + c.name + '\')', reward: 'Game.cmdReward(\'' + c.name + '\')'
    };
    const blockedBase = noCmd || noOff;
    dock = '<div class="cmd-dock"><div class="city-command-heading"><b>' + c.name + '</b><span>명령권 ' + G.cmd + ' / ' + G.cmdMax + '</span></div>';
    groups.forEach(([label, list]) => {
      const cols = list.length === 2 ? ' c2' : list.length === 3 ? ' c3' : (list.length === 5 ? ' c5' : '');
      dock += '<div class="cmdgroup"><span class="cg-label">' + label + '</span><div class="cmds' + cols + '">' +
        list.map(([k, ico, text]) => {
          const isTrade = k === 'supply' || k === 'sellFood';
          const noOne = k !== 'reward' && !isTrade && avail === 0;
          const usedRecruit = k === 'recruit' && c.recruited;   // 징병은 한 달에 한 번
          const blockedCmd = (isTrade ? noCmd || (k === 'supply' ? f.gold < 100 : f.food < 200) : blockedBase || noOne || usedRecruit);
          const tip = noCmd ? '명령권이 부족합니다' : isTrade ? tips[k] : (noOff ? '주둔 무장이 필요합니다' : (noOne ? '이번 달 명령을 모두 마쳤습니다' :
            (usedRecruit ? '이번 달 징병은 이미 마쳤습니다 — 모병은 여러 번 가능 (비용 2배)' : tips[k])));
          return '<button class="cmd" aria-label="' + text + '"' + (blockedCmd ? ' disabled' : '') + ' title="' + tip + '"' +
            ' onclick="' + call[k] + '"><i class="ico">' + ico + '</i><span>' + text + '</span></button>';
        }).join('') +
      '</div></div>';
    });
    dock += '</div>';
  } else if (ally || peace) {
    colB += peace?'<div class="enemy-note">휴전 협정에 따라 공격할 수 없습니다. 외교 화면에서 남은 기간을 확인하세요.</div>':'<div class="enemy-note">동맹국 도시입니다. 이 도시에 인접한 전장에서 <b>원군 요청</b>을 할 수 있습니다. 지원 여부와 무장·병력 규모는 동맹국의 주둔 병력·군량·주변 위협·관계에 따라 결정됩니다.</div>';
  } else {
    const adjacent = c.links.some(n => G.cities[n].owner === G.pf);
    const canAtk = c.links.some(n => G.cities[n].owner === G.pf && G.cities[n].troops >= 1000 && availableOfficers(n).length);
    colB += '<div class="enemy-note">' + (canAtk ? '인접한 내 도시에서 <b>출진</b>할 수 있습니다.' : (adjacent ? '인접한 내 도시에 출진 가능한(이번 달 미행동) 무장이 없습니다.' : '인접한 내 도시가 없어 공격할 수 없습니다.')) + '</div>';
    if (canAtk) dock = '<div class="cmd-dock"><div class="city-command-heading"><b>' + c.name + '</b><span>출진 대상</span></div><div class="cmdgroup"><span class="cg-label">군사</span><div class="cmds c2"><button class="cmd"' +
      (noCmd ? ' disabled title="명령권이 부족합니다"' : ' title="이 도시로 출진합니다 (명령 1)"') +
      ' onclick="Game.cmdAttackFrom(\'' + c.name + '\')"><i class="ico">攻</i><span>이 도시 공격</span></button></div></div></div>';
  }
  h += '<div class="city-cols"><div class="city-col">' + colA + '</div><div class="city-col">' + colB + '</div></div>';
  el.innerHTML = commandWarning + '<div class="city-details">' + h + '</div>' + dock +
    (!dock ? '<div class="city-command-empty"><b>' + c.name + '</b><p>이 도시에서 실행할 수 있는 명령이 없습니다. 정보 탭에서 도시 상태를 확인하세요.</p></div>' : '');
}

/* 로그 문구로 효과음을 고른다 — 명령 결과가 전황 기록에 남을 때 소리가 난다 */
function soundForLog(msg, cls) {
  if (typeof Sound === 'undefined' || !msg) return;
  if (cls === 'bad' && /등용했습니다/.test(msg)) return Sound.sfx('fail');
  if (/함락/.test(msg)) return Sound.sfx('capture');
  if (/멸망|바닥났습니다|역병|흉년|떠났습니다/.test(msg)) return Sound.sfx('fail');
  if (/등용했습니다|동맹을 맺었습니다|풍년/.test(msg)) return Sound.sfx('success');
  if (/등용에 실패|거절|파기|공격이 실패/.test(msg)) return Sound.sfx('fail');
  if (/징병|모병|출진|원군/.test(msg)) return Sound.sfx('march');
  if (/훈련/.test(msg)) return Sound.sfx('taiko');
  if (/포상|상인들|월간 수입/.test(msg)) return Sound.sfx('coin');
}
function log(msg, cls) {
  G.log.push({ m: '[' + G.year + '년 ' + G.month + '월] ' + msg, c: cls || '' });
  if (G.log.length > 120) G.log.shift();
  renderLog();
  soundForLog(msg, cls);
}
function renderLog() {
  const el = $('logPanel'); if (!el) return;
  el.innerHTML = G.log.slice(-60).map(l => {
    const m = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(l.m);
    const t = m ? m[1] : '';
    const msg = m ? m[2] : l.m;
    const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const cls=['good','bad','war','sep'].includes(l.c)?l.c:'';
    return '<div class="logline ' + cls + '">' + (t ? '<span class="t">' + escape(t) + '</span>' : '') +
      '<span class="m">' + escape(msg) + '</span></div>';
  }).join('');
  el.scrollTop = el.scrollHeight;
  const n = $('logCount'); if (n) n.textContent = G.log.length + '건';
}
let toastTimer = null;
function toast(msg) {
  const t = $('toast'); if (!t) return;
  // 실패·경고성 안내는 낮은 경고음으로 구분한다
  if (/부족|없습니다|실패|불가|이미|최대|먼저|진행 중|손상/.test(msg)) sfx('fail');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1500);
}
function selectCity(name) {
  if (attackIntro) return;
  if (!G || (name !== null && !Object.prototype.hasOwnProperty.call(G.cities, name))) return;
  const mv=G.ui && G.ui.move;
  if(name && mv && mv.picking && name!==mv.from) { chooseMoveTarget(name);return; }
  const atk=G.ui && G.ui.attack;                 // 출진 목적지 선택 중 — 사이드 목록 클릭도 목적지 선택으로 쓴다
  if(name && atk && atk.picking && name!==atk.from) { chooseAttackTarget(name);return; }
  G.sel = name; renderCityPanel(); drawMap();
  if (name) mobilePanel('city');
}

/* ── 모달 ────────────────────────────────────────────── */
function showModal(html, opts) {
  const m = $('modalRoot'); if (!m) return;
  if (G && !G.over && (G.fullDelegation || !G.pf)) {
    if (G.pf && G.fullDelegation && !G.autoPaused) modalAutoResume = {game:G, epoch:campaignEpoch};
    G.autoPaused = true; clearAutoPlay(); renderTop();
  }
  const titleMode = !!(document.body && document.body.classList.contains('title'));
  // opts.closable:false → 닫기(×) 없는 창. 타이틀 화면 자체와 그 위에 띄운 창도 닫기 버튼을 두지 않는다.
  const closable = !!G && !(opts && opts.closable === false) && !titleMode;
  const top = !!(G && G.battleActive);          // 전투 중에는 전장 위로 띄운다
  modalLocked = !!(opts && opts.closable === false);
  m.innerHTML = '<div class="modal-bg' + (top ? ' top' : '') + (opts && opts.pickPreview ? ' pick-preview' : '') + '"' + (closable ? ' onclick="if(event.target===this)Game.closeModal()"' : '') + '>' +
    '<div class="modal" role="dialog" aria-modal="true">' +
    (closable ? '<button class="mclose" type="button" aria-label="닫기" onclick="Game.closeModal()">×</button>' : '') +
    html + '</div></div>';
}
function closeModal() {
  const m = $('modalRoot'); if (m) m.innerHTML = '';
  modalLocked = false;
  /* 수비 편성 창을 닫으면(×·Esc·바깥 클릭) 자동 편성으로 전투를 시작한다 */
  const dd = G && G.ui ? G.ui.defDeploy : null;
  if (dd) {
    /* 원군 요청 같은 하위 창을 닫으면 편성 창으로 돌아온다 */
    if (dd.sub) { dd.sub = false; dd.rpick = null; renderDefenseDeploy(); return; }
    G.ui.defDeploy = null;
    if (dd.ctx) dd.ctx.defReserve = 0;
    beginBattle(dd.ctx, dd.atkUnits, defenseUnits(dd.city), 'def', !!dd.auto, dd.reinf);
  }
  /* 이동·출진 목적지 확인 창을 닫으면 지도에서 고르는 모드로 되돌아간다 (명령은 유지) */
  const mv = G && G.ui ? G.ui.move : null;
  if (mv && !mv.picking) { mv.picking = true; syncMoveHint(); drawMap(); }
  const at = G && G.ui ? G.ui.attack : null;
  if (at && !at.picking) { at.picking = true; syncMoveHint(); drawMap(); }
  const resume = modalAutoResume; modalAutoResume = null;
  if (resume && resume.game === G && resume.epoch === campaignEpoch &&
      !G.over && G.fullDelegation && G.autoPaused) {
    G.autoPaused = false;
    resumeAutoPlay();
    renderTop();
  }
}

/* ── 무장 선택 모달 ──────────────────────────────────── */
function openPick(cityName, opts, cb) {
  /* 다른 명령을 시작하면 진행 중이던 지도 목적지 선택은 접는다 */
  if (G && G.ui && (G.ui.move || G.ui.attack)) { G.ui.move = null; G.ui.attack = null; syncMoveHint(); drawMap(); }
  const pool = opts.all ? officersIn(cityName) : availableOfficers(cityName);
  const score = opts.score || PICK_SCORE.move;
  const list = pool.filter(o => (opts.filter ? opts.filter(o) : true))
    .sort((a, b) => score(b) - score(a) || b.wu - a.wu || a.name.localeCompare(b.name));
  if (!list.length) { toast(opts.empty || '이 도시에는 이번 달 명령할 수 있는 무장이 없습니다'); return; }
  G.ui.pick = {
    city: cityName, max: opts.max === undefined ? 3 : opts.max, min: opts.min || 1,
    title: opts.title || '무장 선택', sel: [], list: list.map(o => o.name), cb,
    preview: opts.preview || null,
    shown: false, battle: !!opts.battle
  };
  renderPick();
}
function togglePick(name) {
  const p = G.ui.pick; if (!p) return;
  const i = p.sel.indexOf(name);
  if (i >= 0) p.sel.splice(i, 1);
  else {
    if (p.max > 0 && p.sel.length >= p.max) { toast('최대 ' + p.max + '명까지 선택할 수 있습니다'); return; }
    p.sel.push(name);
  }
  syncPick();   // 모달 전체를 다시 그리지 않아 깜박임·스크롤 초기화가 없다
}
function renderPick() {
  const p = G.ui.pick; if (!p) return;
  if (p.shown) { syncPick(); return; }
  const rows = p.list.map((n, i) => {
    const o = off(n); const sel = p.sel.indexOf(n) >= 0;
    const sk = SKILLS[o.skill];
    return '<div class="row' + (sel ? ' picked' : '') + '" role="button" tabindex="0" aria-pressed="' + sel + '" id="pickRow' + i + '" onclick="Game.togglePick(\'' + n + '\')">' +
      '<span class="name">' + portraitHtml(n, 34) + n + '</span>' +
      '<span class="stats">무력 ' + o.wu + ' · 지력 ' + o.zhi + ' · 정치 ' + o.pol + ' · 매력 ' + o.cha +
      (sk ? ' · <b>' + o.skill + '</b>(' + sk.desc + ')' : '') + '</span>' +
      '<span class="right" id="pickMark' + i + '">' + (sel ? '✔ 선택' : '') + '</span></div>';
  }).join('');
  showModal('<h3>' + p.title + '</h3>' +
    '<p class="muted">' + p.city + ' · ' + (p.max > 0 ? p.min + '~' + p.max + '명' : '인원 제한 없음') +
      ' 선택 (현재 <b id="pickCount">' + p.sel.length + '</b>명' +
      (p.battle ? ' · 원군 파견 무장' : ' · 효과가 높은 순서로 정렬 · 이번 달 미행동 무장만 표시') + ')</p>' +
    rows + (p.preview ? '<p id="pickPreview" class="command-preview" aria-live="polite"></p>' : '') +
    '<div class="foot"><button onclick="Game.closeModal()">취소</button>' +
    '<button class="primary" id="pickOk" onclick="Game.confirmPick()">확인</button></div>', { pickPreview: !!p.preview });
  p.shown = true;
  syncPick();
}
function syncPick() {
  const p = G.ui.pick; if (!p) return;
  p.list.forEach((n, i) => {
    const sel = p.sel.indexOf(n) >= 0;
    const row = $('pickRow' + i);
    if (row && row.classList) row.classList.toggle('picked', sel);
    if (row && row.setAttribute) row.setAttribute('aria-pressed', String(sel));
    const mark = $('pickMark' + i);
    if (mark) mark.textContent = sel ? '✔ 선택' : '';
  });
  const cnt = $('pickCount');
  if (cnt) cnt.textContent = String(p.sel.length);
  const ok = $('pickOk');
  const preview = p.preview && p.sel.length ? p.preview(p.sel) : null;
  if ($('pickPreview')) $('pickPreview').textContent = preview ? preview.text : '';
  if (ok) ok.disabled = p.sel.length < p.min || !!(preview && !preview.ok);
}
function confirmPick() {
  const p = G.ui.pick; if (!p) return;
  if (p.sel.length < p.min) { toast('최소 ' + p.min + '명 선택해야 합니다'); return; }
  if (p.preview) { const quote = p.preview(p.sel); if (!quote.ok) { toast(quote.text); return; } }
  const names = p.sel.slice(), cb = p.cb;
  G.ui.pick = null; closeModal(); cb(names);
}

/* ── 명령권 ──────────────────────────────────────────── */
function needCmd() {
  if (!G.pf || G.fullDelegation || G.aiRunning) return false;
  if (G.over) return false;
  if (G.cmd <= 0) { toast('명령권이 부족합니다. [턴 종료]로 다음 달로 넘어가세요'); return false; }
  return true;
}
function spendCmd() {
  if (attackIntro) return false;
  if (G.cmd <= 0) { toast('명령권이 부족합니다'); return false; }
  G.cmd--; renderTop(); renderCityPanel(); return true;
}

/* ── 내정 ────────────────────────────────────────────── */
const ADMIN_LABEL = { agri: '개발', comm: '상업', order: '치안', def: '수복' };
function adminScore(o, stat) {
  const skill = skillOf(o), key = stat === 'def' ? 'fortify' : stat;
  return PICK_SCORE.admin(o) * (skill[key] || 1);
}
function adminQuote(c, stat, names) {
  const officers = names.map(off).filter(Boolean).sort((a,b) => adminScore(b,stat)-adminScore(a,stat));
  const weights = [1, 0.65, 0.4];
  const power = officers.slice(0,3).reduce((s,o,i) => s + adminScore(o,stat) * weights[i], 0);
  const raw = Math.max(2, Math.round(power / 10));
  const gain = Math.max(0, Math.min(100 - c[stat], raw));
  const cost = gain ? Math.ceil((60 + Math.max(0, officers.length-1)*35) * gain / raw) : 0;
  const next = { ...c, [stat]: c[stat] + gain };
  const goldDelta = cityGoldIncome(next)-cityGoldIncome(c), foodDelta = cityFoodIncome(next)-cityFoodIncome(c);
  const ok = !!officers.length && gain > 0 && G.factions[c.owner].gold >= cost;
  return { gain, cost, ok, text: ADMIN_LABEL[stat] + ' +' + gain + ' · 금 -' + cost +
    (goldDelta ? ' · 월 금 +' + goldDelta : '') + (foodDelta ? ' · 월 군량 +' + foodDelta : '') +
    (goldDelta > 0 ? ' · 투자 회수 약 ' + Math.ceil(cost/goldDelta) + '개월' : '') +
    (!ok ? ' · 금 부족 또는 최대치' : '') };
}
function applyAdmin(c, stat, names, quote) {
  G.factions[c.owner].gold -= quote.cost; c[stat] += quote.gain;
  names.forEach(n => { const o = off(n); o.loyalty = cl(o.loyalty+1,0,100); });
  markUsed(names);
}
function cmdAdmin(cityName, stat) {
  const c = G.cities[cityName]; if (!isPlayerCity(c)) return;
  if (!needCmd()) return;
  const label = ADMIN_LABEL[stat];
  if (!label) return;
  if (c[stat] >= 100) { toast(label + ': 이미 최대치(100)입니다'); return; }
  openPick(cityName, { max: 3, min: 1, title: label + ' — 담당 무장 선택 (최대 3명)', score: o => adminScore(o,stat),
    preview: names => adminQuote(c, stat, names) }, names => {
    const quote = adminQuote(c, stat, names); if (!quote.ok) { toast(quote.text); return; }
    if (!spendCmd()) return;
    const before = c[stat];
    applyAdmin(c, stat, names, quote);
    log(c.name + ' ' + label + ': ' + before + ' → ' + c[stat] + ' (금 -' + quote.cost + ', ' + names.join('·') + ')', 'good');
    renderAll();
  });
}

/* ── 병력 충원 ──────────────────────────────────────────
   징병: 저렴하지만 치안·숙련 손실이 크다. 모병: 비싸지만 숙련 지원병을 얻는다. */
function recruitQuote(c, o, mode, budget = G.factions[c.owner].gold) {
  const levy = mode === 'levy', rate = levy ? LEVY_COST : RECRUIT_COST;
  const room = Math.max(0, capOf(c)-c.troops);
  const amount = Math.max(0, Math.min(Math.round((500+o.cha*12+c.order*6)*(1+(skillOf(o).recruit||0))),
    room, Math.floor((budget+1e-9)/rate)));
  const cost = Math.ceil(amount*rate-1e-9), orderLoss = levy ? 1 : 5;
  const next = {...c}; addGarrison(next, amount, levy ? 55 : 30, levy ? 75 : 55);
  next.order = cl(next.order-orderLoss,0,100);
  const ok = amount > 0 && amount >= Math.min(200, room) && (levy || !c.recruited);
  return { amount, cost, orderLoss, training: next.training, morale: next.morale, ok,
    text: (levy ? '모병' : '징병') + ' +' + commas(amount) + '명 · 금 -' + commas(cost) +
      ' · 치안 -' + Math.min(c.order,orderLoss) + ' · 훈련 ' + c.training + '→' + next.training +
      ' · 사기 ' + c.morale + '→' + next.morale + ' · 충원 후 도시 월 금 ' + signed(cityGoldIncome(next)-cityGoldUpkeep(next)) +
      ' / 군량 ' + signed(cityFoodIncome(next)-cityFoodUpkeep(next)) +
      (!ok ? ' · 금 부족·병력 상한 또는 이번 달 징병 완료' : '') };
}
function applyRecruit(c, o, mode, quote) {
  G.factions[c.owner].gold -= quote.cost;
  addGarrison(c, quote.amount, mode === 'levy' ? 55 : 30, mode === 'levy' ? 75 : 55);
  c.order = cl(c.order-quote.orderLoss,0,100);
  if (mode !== 'levy') c.recruited = true;
  markUsed([o.name]);
}
function cmdRecruit(cityName) { enlistCity(cityName, 'conscript'); }
function cmdLevy(cityName) { enlistCity(cityName, 'levy'); }
function enlistCity(cityName, mode) {
  const c = G.cities[cityName]; if (!isPlayerCity(c)) return;
  if (!needCmd()) return;
  const levy = mode === 'levy', label = levy ? '모병' : '징병';
  const rate = levy ? LEVY_COST : RECRUIT_COST;
  const f = G.factions[G.pf], cap = capOf(c);
  const minGold = Math.ceil(Math.min(200, Math.max(0,cap-c.troops)) * rate - 1e-9);
  if (!levy && c.recruited) { toast('이번 달 징병은 이미 마쳤습니다 — 모병은 여러 번 가능하지만 비용이 2배입니다'); return; }
  if (c.troops >= cap) { toast('병력이 이미 상한입니다 (인구 ' + c.pop + '만' + (isCapital(c) ? ' · 수도 1.5배' : '') + ')'); return; }
  if (f.gold < minGold) { toast(label + '할 금이 부족합니다 (최소 금 ' + commas(minGold) + ')'); return; }
  const title = label + ' — 담당 무장 선택 (매력 중시' + (levy ? ' · 비용 2배, 횟수 제한 없음' : ' · 이번 달 1회') + ')';
  openPick(cityName, { max: 1, min: 1, title, score: PICK_SCORE.recruit,
    preview: names => recruitQuote(c, off(names[0]), mode) }, names => {
    const o = off(names[0]);
    const quote = recruitQuote(c, o, mode); if (!quote.ok) { toast(quote.text); return; }
    if (!spendCmd()) return;
    applyRecruit(c, o, mode, quote);
    log(c.name + '에서 ' + quote.text + ' (담당 ' + o.name + ')', 'good');
    renderAll();
  });
}

/* ── 훈련 ────────────────────────────────────────────── */
function cmdTrain(cityName) {
  const c = G.cities[cityName]; if (!isPlayerCity(c)) return;
  if (!needCmd()) return;
  if (c.training >= 100 && c.morale >= 100) { toast('훈련도와 사기가 이미 최대입니다'); return; }
  openPick(cityName, { max: 2, min: 1, title: '훈련 — 담당 무장 선택 (무력 중시, 최대 2명)', score: PICK_SCORE.train }, names => {
    if (!spendCmd()) return;
    const beforeTraining = c.training, beforeMorale = c.morale;
    applyTraining(c, names);
    log(c.name + ' 훈련: 훈련도 +' + (c.training - beforeTraining) + ' (→ ' + c.training +
      ') · 사기 +' + (c.morale - beforeMorale) + ' (→ ' + c.morale + ')', 'good');
    renderAll();
  });
}
function applyTraining(c, names) {
  const sum = names.reduce((s,n) => s + PICK_SCORE.train(off(n)), 0);
  c.training = cl(c.training + Math.max(2,Math.round((2+sum/40)*rnd(.8,1.2))),0,100);
  c.morale = cl(c.morale + Math.round((5+sum/50)*rnd(.8,1.2)),0,100);
  markUsed(names);
}
function signed(n) { return (n >= 0 ? '+' : '') + commas(n); }
function buyFood(f, cost) {
  if (!Number.isInteger(cost) || cost <= 0 || f.gold < cost) return false;
  f.gold -= cost; f.food += cost * FOOD_BUY_RATE; return true;
}
function cmdSupply(cityName) {
  if (!isPlayerCity(G.cities[cityName]) || !needCmd()) return;
  const f = G.factions[G.pf];
  if (f.gold < 100) { toast('군량 매입에는 금 100이 필요합니다'); return; }
  const e = factionEconomy(G.pf);
  showModal('<h3>군량 매입</h3><p>금 1 → 군량 2 · 매입 1회에 명령 1 · 무장 불필요</p>' +
    '<p>현재 군량 ' + commas(f.food) + ' · 세력 월 군량 순증감 ' + signed(e.foodNet) + '</p>' +
    '<div class="foot"><button onclick="Game.closeModal()">취소</button>' +
    [100,300,600].map(cost => '<button class="primary"' + (f.gold<cost?' disabled':'') +
      ' onclick="Game.confirmSupply(\'' + cityName + '\',' + cost + ')">금 ' + cost + ' → 군량 ' + (cost*FOOD_BUY_RATE) + '</button>').join('') + '</div>');
}
function confirmSupply(cityName, cost = 100) {
  if (![100,300,600].includes(cost)) return;
  if (!isPlayerCity(G.cities[cityName]) || !needCmd()) return;
  const f = G.factions[G.pf]; if (f.gold < cost) { toast('금이 부족합니다'); return; }
  if (!spendCmd()) return;
  buyFood(f,cost); closeModal(); log('군량 매입: 금 -' + cost + ' · 군량 +' + (cost*FOOD_BUY_RATE),'good'); renderAll();
}
function cmdSellFood(cityName) {
  if (!isPlayerCity(G.cities[cityName]) || !needCmd()) return;
  const f = G.factions[G.pf];
  if (f.food < 200) { toast('군량 매각에는 군량 200이 필요합니다'); return; }
  const e = factionEconomy(G.pf);
  showModal('<h3>군량 매각</h3><p>군량 200 → 금 80 · 매입가 대비 20% 낮은 가격 · 매각 1회에 명령 1 · 무장 불필요</p>' +
    '<p>현재 군량 ' + commas(f.food) + ' · 금 ' + commas(f.gold) + ' · 세력 월 군량 순증감 ' + signed(e.foodNet) + '</p>' +
    '<div class="foot"><button onclick="Game.closeModal()">취소</button>' +
    [200,600,1200].map(amount => '<button class="primary"' + (f.food<amount?' disabled':'') +
      ' onclick="Game.confirmSellFood(\'' + cityName + '\',' + amount + ')">군량 ' + commas(amount) + ' → 금 ' + commas(Math.round(amount*FOOD_SELL_RATE)) + '</button>').join('') + '</div>');
}
function confirmSellFood(cityName, amount = 200) {
  if (![200,600,1200].includes(amount)) return;
  if (!isPlayerCity(G.cities[cityName]) || !needCmd()) return;
  const f = G.factions[G.pf]; if (f.food < amount) { toast('군량이 부족합니다'); return; }
  if (!spendCmd()) return;
  const gold = Math.round(amount * FOOD_SELL_RATE);
  f.food -= amount; f.gold += gold;
  closeModal(); log('군량 매각: 군량 -' + commas(amount) + ' · 금 +' + commas(gold),'good'); renderAll();
}

/* ── 이동 ────────────────────────────────────────────── */
/* 인접 아군 도시 — 이동 목적지 후보 */
function moveTargets(from) {
  const c = G && G.cities ? G.cities[from] : null;
  if (!c) return [];
  return c.links.filter(n => G.cities[n] && G.cities[n].owner === G.pf);
}
/* 인접 적 도시 — 출진 목적지 후보 (동맹 제외) */
function attackTargets(from) {
  const c = G && G.cities ? G.cities[from] : null;
  if (!c) return [];
  return c.links.filter(n => G.cities[n] && G.cities[n].owner !== G.pf && !hasPeace(G.pf, G.cities[n].owner));
}
/* 지도에서 목적지를 고르는 중인 명령 — 이동·출진 공용 */
function destPick() {
  const ui = G && G.ui; if (!ui) return null;
  if (ui.move && ui.move.picking) return { kind: 'move', st: ui.move, cands: moveTargets(ui.move.from) };
  if (ui.attack && ui.attack.picking) return { kind: 'attack', st: ui.attack, cands: attackTargets(ui.attack.from) };
  return null;
}

/* 지도 아래 안내 띠 — 지도 클릭으로 목적지를 고르는 중임을 알리고 목록·취소를 제공한다 */
let moveHintSig = '';
function syncMoveHint() {
  const el = $('mapHint'); if (!el) return;
  const dp = destPick();
  if (!dp) {
    if (moveHintSig) { el.classList.remove('show'); el.innerHTML = ''; moveHintSig = ''; }
    return;
  }
  el.classList.add('show');
  const mv = dp.st, cands = dp.cands, atk = dp.kind === 'attack';
  const sig = dp.kind + '|' + mv.from + '|' + mv.names.join(',') + '|' + cands.join(',');
  if (sig === moveHintSig) return;             // 같은 내용이면 DOM을 다시 만들지 않는다
  mobilePanel('map');
  moveHintSig = sig;
  el.setAttribute('aria-label', (atk ? '출진' : '이동') + ' 목적지 선택');
  el.innerHTML = '<span class="mh-t">' + (atk ? '출진 목적지' : '이동 목적지') + '</span>' +
    '<span class="mh-b"><b>' + mv.from + '</b> · 무장 ' + mv.names.length + '명 — 지도에서 ' + (atk ? '적 도시' : '아군 도시') +
    ' <b>' + cands.length + '곳</b>을 클릭하세요</span>' +
    '<button type="button" onclick="Game.' + (atk ? 'openAttackTargetList' : 'openMoveTargetList') + '()">목록에서 선택</button>' +
    '<button type="button" onclick="Game.' + (atk ? 'cancelAttack' : 'cancelMove') + '()">취소</button>';
}
function beginMoveTargetPick() {
  const mv = G && G.ui ? G.ui.move : null; if (!mv) return;
  mv.picking = true;
  closeModal();
  syncMoveHint(); drawMap();
  toast('지도에서 이동할 아군 도시를 클릭하세요');
}
function cancelMove() {
  if (!G || !G.ui || !G.ui.move) return;
  G.ui.move = null;                 // closeModal이 지도 선택 모드로 되돌아가지 않게 먼저 비운다
  closeModal();
  syncMoveHint(); drawMap();
  toast('이동 명령을 취소했습니다');
}
function cmdMove(cityName) {
  const c = G.cities[cityName]; if (!isPlayerCity(c)) return;
  if (!needCmd()) return;
  if (!moveTargets(cityName).length) { toast('이동할 인접 아군 도시가 없습니다'); return; }
  openPick(cityName, { max: 0, min: 1, title: '이동 — 무장 선택 (인원 제한 없음)', score: PICK_SCORE.move }, names => {
    G.ui.move = { from: cityName, names, to: null, picking: true };
    selectCity(cityName);           // 출발 도시를 선택해 두면 군로가 함께 강조된다
    syncMoveHint(); drawMap();
    toast('지도에서 이동할 아군 도시를 클릭하세요');
  });
}
function openMoveTargetList() {
  const mv = G.ui.move; if (!mv) return;
  mv.picking = false; syncMoveHint(); drawMap();
  const rows = moveTargets(mv.from).map(t => {
      const d = G.cities[t];
      return '<div class="row" role="button" tabindex="0" onclick="Game.chooseMoveTarget(\'' + t + '\')">' +
        '<span class="name">' + t + '</span>' +
        '<span class="muted">아군 · 병력 ' + commas(d.troops) + ' / ' + commas(capOf(d)) + ' · 무장 ' + officersIn(t).length + '명</span></div>';
  }).join('');
  showModal('<h3>이동 목적지 선택</h3>' + rows +
    '<p class="muted">지도에서 도시를 클릭해 목적지를 고를 수도 있습니다.</p>' +
    '<div class="foot"><button onclick="Game.cancelMove()">취소</button>' +
    '<button onclick="Game.beginMoveTargetPick()">지도에서 선택</button></div>');
}
function chooseMoveTarget(t) {
  const mv = G.ui.move; if (!mv) return;
  if (moveTargets(mv.from).indexOf(t) < 0) { toast('인접한 아군 도시만 목적지로 고를 수 있습니다'); return; }
  mv.to = t; mv.picking = false;
  syncMoveHint(); drawMap();
  const c = G.cities[mv.from], d = G.cities[t];
  const cap = capOf(d), room = Math.max(0, cap - d.troops);
  const maxMove = c.troops;            // 목적지 상한과 무관하게 출발 도시 병력 전부 이동 가능
  const over = Math.max(0, d.troops + maxMove - cap);
  showModal('<h3>' + mv.from + ' → ' + t + ' 이동</h3>' +
    '<p>무장: <b>' + mv.names.join(', ') + '</b></p>' +
    '<p>이동 병력 <input aria-label="이동 병력" type="number" id="mvTroops" value="' + maxMove + '" min="0" max="' + maxMove + '" style="width:110px"> / ' + commas(c.troops) + '</p>' +
    '<p class="muted">목적지 병력 ' + commas(d.troops) + ' / ' + commas(cap) + ' — 수용 가능 ' + commas(room) +
    (d.troops > cap ? ' · 현재 상한 초과' : '') + '</p>' +
    (over > 0 ? '<p class="warn">목적지가 병력 상한을 넘어도 이동할 수 있습니다. 최대 ' + commas(over) + '까지 초과 주둔하게 됩니다 (초과 병력은 징병으로 줄일 수 없고, 군량을 2배로 소비합니다).</p>' : '') +
    '<p class="muted">지도에서 다른 아군 도시를 클릭하면 목적지를 바꿀 수 있습니다.</p>' +
    '<div class="foot"><button onclick="Game.cancelMove()">취소</button>' +
    '<button onclick="Game.beginMoveTargetPick()">지도에서 다시 선택</button>' +
    '<button class="primary" onclick="Game.doMove()">이동 실행</button></div>');
}
function doMove() {
  const mv = G.ui.move; if (!mv || !mv.to) return;
  const c = G.cities[mv.from], d = G.cities[mv.to];
  let amt = parseInt(($('mvTroops') || {}).value, 10); if (isNaN(amt)) amt = 0;
  const cap = capOf(d);
  amt = cl(amt, 0, c.troops);
  if (!spendCmd()) return;
  markUsed(mv.names);
  addGarrison(d, amt, c.training, c.morale); c.troops -= amt;
  const over = Math.max(0, d.troops - cap);
  mv.names.forEach(n => { const o = off(n); if (o) o.city = mv.to; });
  log(mv.from + ' → ' + mv.to + ': ' + mv.names.join(', ') + ' 이동 (병력 ' + commas(amt) +
    (over > 0 ? ', 상한 초과 ' + commas(over) : '') + ')', '');
  G.ui.move = null; closeModal(); renderAll();
  selectCity(mv.to);
}

/* ── 출진(공격) ──────────────────────────────────────── */
function cmdAttack(cityName) {
  const c = G.cities[cityName]; if (!isPlayerCity(c)) return;
  if (!needCmd()) return;
  if (!availableOfficers(cityName).length) { toast('출진할 수 있는 무장이 없습니다 (이번 달 미행동)'); return; }
  if (c.troops < 1000) { toast('병력이 부족합니다 (최소 1,000)'); return; }
  if (!attackTargets(cityName).length) { toast('공격 가능한 인접 적 도시가 없습니다'); return; }
  openPick(cityName, { max: 0, min: 1, title: '출진 — 무장 선택 (인원 제한 없음)', score: PICK_SCORE.attack }, names => {
    /* 무장을 고르면 이동처럼 지도에서 목적지를 클릭해 고른다 */
    G.ui.attack = { from: cityName, names, to: null, picking: true };
    selectCity(cityName);           // 출발 도시를 선택해 두면 군로가 함께 강조된다
    syncMoveHint(); drawMap();
    toast('지도에서 출진할 적 도시를 클릭하세요');
  });
}
/* 지도 아래 띠·목록에서 출진 목적지를 고르는 흐름 (이동과 같은 방식) */
function openAttackTargetList() {
  const at = G.ui.attack; if (!at) return;
  at.picking = false; syncMoveHint(); drawMap();
  const rows = attackTargets(at.from).map(n => {
    const d = G.cities[n], df = G.factions[d.owner];
    return '<div class="row" role="button" tabindex="0" onclick="Game.chooseAttackTarget(\'' + n + '\')">' +
      '<span class="name">' + portraitHtml(n, 34) + n + '</span>' +
      '<span class="muted">' + (df ? df.name : '재야') + ' · 병력 ' + commas(d.troops) + ' · 방어 ' + d.def + ' · 훈련 ' + d.training + '</span></div>';
  }).join('');
  showModal('<h3>출진 목적지 선택</h3>' + rows +
    '<p class="muted">지도에서 적 도시를 클릭해 목적지를 고를 수도 있습니다.</p>' +
    '<div class="foot"><button onclick="Game.cancelAttack()">취소</button>' +
    '<button onclick="Game.beginAttackTargetPick()">지도에서 선택</button></div>');
}
function beginAttackTargetPick() {
  const at = G && G.ui ? G.ui.attack : null; if (!at) return;
  at.picking = true;
  closeModal();
  syncMoveHint(); drawMap();
  toast('지도에서 출진할 적 도시를 클릭하세요');
}
function cancelAttack() {
  if (!G || !G.ui || !G.ui.attack) return;
  G.ui.attack = null;               // closeModal이 지도 선택 모드로 되돌아가지 않게 먼저 비운다
  closeModal();
  syncMoveHint(); drawMap();
  toast('출진 명령을 취소했습니다');
}
function chooseAttackTarget(t) {
  const at = G.ui.attack; if (!at) return;
  if (attackTargets(at.from).indexOf(t) < 0) { toast('인접한 적 도시만 목적지로 고를 수 있습니다'); return; }
  at.to = t; at.picking = false;
  syncMoveHint(); drawMap();
  openDeploy(at.from, t, at.names.join('|'));   // 편성 창을 닫으면 지도 선택으로 되돌아간다
}
function cmdAttackFrom(target) {
  const t = G.cities[target];
  if (!needCmd()) return;
  const froms = t.links.map(n => G.cities[n]).filter(c => c.owner === G.pf && availableOfficers(c.name).length && c.troops >= 1000);
  if (!froms.length) { toast('출진 가능한 인접 아군 도시가 없습니다 (이번 달 미행동 무장·병력 필요)'); return; }
  const rows = froms.map(c => '<div class="row" role="button" tabindex="0" onclick="Game.openDeploy(\'' + c.name + '\',\'' + target + '\',null)">' +
    '<span class="name">' + c.name + '</span>' +
    '<span class="muted">병력 ' + commas(c.troops) + ' · 무장 ' + availableOfficers(c.name).length + '/' + officersIn(c.name).length + '명</span></div>').join('');
  showModal('<h3>' + target + ' 공격 — 출진 도시 선택</h3>' + rows +
    '<div class="foot"><button onclick="Game.closeModal()">취소</button></div>');
}
// 목표 도시에 인접한 아군 도시(합동 출진 후보)
function attackPartners(target) {
  const t = G.cities[target]; if (!t) return [];
  return t.links.map(n => G.cities[n]).filter(c =>
    c && c.owner === G.pf && c.troops >= 200 && availableOfficers(c.name).length > 0);
}
function openDeploy(from, target, namesCsv) {
  const t = G.cities[target];
  if (!t) return;
  if (!namesCsv) {
    openPick(from, { max: 0, min: 1, title: from + ' → ' + target + ' 출진 무장 선택 (인원 제한 없음)', score: PICK_SCORE.attack },
      names => openDeploy(from, target, names.join('|')));
    return;
  }
  const names = String(namesCsv).split('|').filter(Boolean);
  if (!names.length) return;
  G.ui.deploy = {
    target, main: from, parts: [{ city: from, names }],
    amounts: {}, branches: {}, forms: {}, auto: false, mode:'auto', rows: []
  };
  renderDeploy();
}
function renderDeploy() {
  const d = G.ui.deploy; if (!d) return;
  const t = G.cities[d.target];
  if(!t||t.owner===G.pf||hasPeace(G.pf,t.owner)) {toast('현재 공격할 수 없는 도시입니다');return;}
  const rowsInfo = [];
  let body = '';
  d.parts.forEach((p, pi) => {
    const c = G.cities[p.city];
    let remaining = c.troops;
    const defaults = distribute(Math.max(0, c.troops - 2000), p.names.length);
    body += '<div class="sec"><span>' + p.city + ' 합류 부대</span><b>현재 병력 ' +
      commas(c.troops) + '</b></div><p class="muted" id="deployTotal_' + pi + '" aria-live="polite"></p>';
    p.names.forEach((n, ni) => {
      const o = off(n);
      const i = rowsInfo.length;
      rowsInfo.push({ city: p.city, name: n });
      const auto = autoBranch(o);
      const cur = d.branches[n] || auto;
      const opt = b => '<option' + (cur === b ? ' selected' : '') + '>' + b + '</option>';
      const curForm = FORMS[d.forms[n]] ? d.forms[n] : defaultForm(auto);
      const fopt = f => '<option value="' + f + '"' + (curForm === f ? ' selected' : '') + '>' + f + '</option>';
      const wanted = d.amounts[n] !== undefined && !isNaN(d.amounts[n]) ? d.amounts[n] : defaults[ni];
      const per = cl(Math.floor(wanted), 0, Math.min(10000, remaining));
      d.amounts[n] = per;
      remaining -= per;
      body += '<div class="row"><span class="name"' + portraitAttr(n) + '>' + n + '</span>' +
        '<span class="stats">무력 ' + o.wu + ' · 지력 ' + o.zhi + '</span>' +
        '<span>병과 <select aria-label="' + n + ' 병과" id="br_' + i + '">' + opt('보병') + opt('기병') + opt('궁병') + '</select></span>' +
        '<span>진형 <select aria-label="' + n + ' 진형" id="fm_' + i + '" title="' + FORMS[curForm].desc + '">' + Object.keys(FORMS).map(fopt).join('') + '</select></span>' +
        deploymentTroopControl(n, i, per, Math.min(10000, c.troops)) + '</div>';
    });
    if (d.parts.length > 1) {
      body += '<div class="foot" style="margin:2px 0 10px">' +
        '<button class="ghost small" onclick="Game.removeDeployCity(\'' + p.city + '\')">' + p.city + ' 빼기</button></div>';
    }
  });
  d.rows = rowsInfo;
  const cands = attackPartners(d.target).filter(c => !d.parts.some(p => p.city === c.name));
  const total = d.parts.reduce((s, p) => s + p.names.length, 0);
  showModal('<h3>출진 편성 — ' + d.parts.map(p => p.city).join(' + ') + ' → ' + d.target + '</h3>' +
    '<p class="muted">적: ' + (G.factions[t.owner] ? G.factions[t.owner].name : '재야') +
    ' (병력 ' + commas(t.troops) + ', 방어도 ' + t.def + ', 훈련 ' + t.training + ') · 합류 무장 ' + total + '명</p>' +
    (d.parts.length > 1 ? '<p class="muted">합류 도시 부대는 본대보다 늦게 도착하며(원군과 같은 행군 일수), 전투가 끝나면 무장과 잔존 병력이 각자 출발 도시로 복귀합니다.</p>' : '') +
    '<p class="muted">진형은 장수마다 따로 지정합니다 — ' +
      Object.keys(FORMS).map(f => '<b>' + f + '</b> ' + FORMS[f].desc).join(' · ') + '</p>' +
    '<p><label>공략 방식 <select id="battleMode" aria-label="공략 방식" onchange="Game.state.ui.deploy.mode=this.value"><option value="auto"' + (d.mode==='auto'?' selected':'') + '>수비군 판단에 따라 야전 / 공성</option><option value="field"' + (d.mode==='field'?' selected':'') + '>야전 선행</option><option value="siege"' + (d.mode==='siege'?' selected':'') + '>바로 공성</option></select></label></p>' +
    '<p class="muted">야전 승리 후에는 잔존 병력으로 공성을 이어갑니다. 도시 점령은 공성 승리 후 확정됩니다.</p>' +
    '<p><label class="muted"><input type="checkbox" id="autoBattle"' + (d.auto ? ' checked' : '') + '> 자동 전투(지휘 위임)</label></p>' +
    '<p class="muted" id="deploySupplyForecast" aria-live="polite"></p>' +
    body +
    (cands.length ? '<div class="cmdgroup"><span class="cg-label">인접 지역 합류 (원군처럼 늦게 도착)</span><div class="cmds c2">' +
      cands.map(c => '<button class="cmd" onclick="Game.addDeployCity(\'' + c.name + '\')"><span>' + c.name + ' 합류</span></button>').join('') +
      '</div></div>' : '') +
    '<div class="foot"><button onclick="Game.closeModal()">취소</button>' +
    '<button class="primary" onclick="Game.confirmDeploy()">출진!</button></div>');
  captureDeploy();
}
function deploymentTroopControl(name, index, amount, max, defense = false) {
  const prefix = defense ? 'dtr_' : 'tr_';
  const update = defense ? 'updateDefenseTroops' : 'updateDeployTroops';
  const button = (direction, label, arrow) => '<button type="button" aria-label="' + name + ' 병력 500명 ' + label +
    '" title="500명 ' + label + '" onclick="Game.adjustDeployTroops(' + index + ',' + direction + ',' + defense + ')">' + arrow + '</button>';
  return '<span class="deployment-troops">병력 <span class="troop-stepper">' + button(-1, '감소', '◀') +
    '<input class="troop-count" aria-label="' + name + ' 병력" type="number" inputmode="numeric" id="' + prefix + index +
    '" value="' + amount + '" min="0" max="' + max + '" oninput="Game.' + update + '(' + index + ')">' +
    button(1, '증가', '▶') + '</span></span>';
}
function adjustDeployTroops(index, direction, defense = false) {
  const plan = G && G.ui && (defense ? G.ui.defDeploy : G.ui.deploy);
  if (!plan || !Number.isInteger(index) || index < 0 || (direction !== -1 && direction !== 1)) return;
  const rows = defense ? plan.names : plan.rows;
  if (!rows || index >= rows.length) return;
  const input = $((defense ? 'dtr_' : 'tr_') + index);
  if (!input) return;
  const max = Math.min(10000, Math.max(0, parseInt(input.max, 10) || 0));
  input.value = String(cl((parseInt(input.value, 10) || 0) + direction * 500, 0, max));
  if (defense) captureDefenseDeploy(index);
  else captureDeploy(index);
}
/* 편성 입력 공통 처리. 수정한 칸은 다른 부대에 배정하고 남은 병력만 사용한다.
   DOM 전체를 다시 만들지 않아 입력 중 포커스와 커서를 유지한다. */
function syncDeploymentTroops(plan, rows, prefix, changedIndex) {
  const totals = {}, values = rows.map((r, i) => {
    const input = $(prefix + i);
    const raw = input ? input.value : plan.amounts[r.name];
    return Math.max(0, parseInt(raw, 10) || 0);
  });
  const order = rows.map((_, i) => i);
  if (Number.isInteger(changedIndex) && changedIndex >= 0 && changedIndex < rows.length) {
    order.splice(changedIndex, 1); order.push(changedIndex);
  }
  let adjusted = false;
  order.forEach(i => {
    const r = rows[i], c = G.cities[r.city];
    const room = Math.max(0, (c ? c.troops : 0) - (totals[r.city] || 0));
    const amount = Math.min(values[i], 10000, room);
    adjusted = adjusted || amount !== values[i];
    plan.amounts[r.name] = amount;
    totals[r.city] = (totals[r.city] || 0) + amount;
  });
  rows.forEach((r, i) => {
    const input = $(prefix + i); if (!input) return;
    const amount = plan.amounts[r.name], c = G.cities[r.city];
    input.max = String(Math.min(10000, Math.max(0, (c ? c.troops : 0) - totals[r.city] + amount)));
    // 빈 칸은 0명으로 계산하되 사용자가 새 숫자를 입력할 수 있게 비워 둔다.
    if (input.value !== '' && String(amount) !== input.value) input.value = String(amount);
  });
  plan.troopsAdjusted = adjusted;
  return totals;
}
// 편성 화면을 다시 그리기 전에 입력값을 보존한다
function captureDeploy(changedIndex) {
  const d = G.ui.deploy; if (!d) return;
  const a = $('autoBattle'); if (a) d.auto = !!a.checked;
  const mode=$('battleMode');if(mode&&['auto','siege','field'].includes(mode.value))d.mode=mode.value;
  const totals = syncDeploymentTroops(d, d.rows || [], 'tr_', changedIndex);
  (d.rows || []).forEach((r, i) => {
    const b = $('br_' + i);
    if (b) d.branches[r.name] = b.value;
    const fm = $('fm_' + i);
    if (fm && FORMS[fm.value]) d.forms[r.name] = fm.value;
  });
  d.parts.forEach((p, i) => {
    const summary = $('deployTotal_' + i), c = G.cities[p.city];
    if (summary) summary.textContent = '편성 ' + commas(totals[p.city] || 0) +
      ' · 잔여 ' + commas(Math.max(0, c.troops - (totals[p.city] || 0)));
  });
  const forecast = $('deploySupplyForecast');
  if (forecast) forecast.textContent = battleSupplyHint(Object.values(totals).reduce((s,n)=>s+n,0));
}
function addDeployCity(cityName) {
  const d = G.ui.deploy; if (!d) return;
  captureDeploy();
  openPick(cityName, { max: 0, min: 1, title: cityName + ' 합류 무장 선택 (인원 제한 없음)', score: PICK_SCORE.attack }, names => {
    if (d.parts.some(p => p.city === cityName)) return;
    d.parts.push({ city: cityName, names });
    renderDeploy();
  });
}
function removeDeployCity(cityName) {
  const d = G.ui.deploy; if (!d) return;
  captureDeploy();
  if (d.parts.length <= 1) { toast('본대는 뺄 수 없습니다'); return; }
  d.parts = d.parts.filter(p => p.city !== cityName);
  renderDeploy();
}
function confirmDeploy() {
  const d = G.ui.deploy; if (!d) return;
  captureDeploy();
  if (d.troopsAdjusted) { toast('현재 병력에 맞게 편성을 조정했습니다. 병력을 확인하고 다시 출진하세요'); return; }
  const t = G.cities[d.target];
  if(!t||t.owner===G.pf||hasPeace(G.pf,t.owner)) {toast('현재 공격할 수 없는 도시입니다');return;}
  const units = [], extra = [], mainUnits = [], perCity = {}, home = {};
  for (let i = 0; i < (d.rows || []).length; i++) {
    const r = d.rows[i];
    const o = off(r.name), c = G.cities[r.city];
    if (!o || !c || o.used || o.status!=='active' || o.faction!==G.pf || c.owner!==G.pf || o.city!==r.city) continue;
    const br = ($('br_' + i) || {}).value || '보병';
    const fm = ($('fm_' + i) || {}).value || d.forms[r.name] || defaultForm(br);
    const form = FORMS[fm] ? fm : defaultForm(br);
    const tr = d.amounts[r.name] || 0;
    if (tr <= 0) continue;
    const unit = { officer: o, troops: tr, branch: br, training: c.training, morale: c.morale, form };
    units.push(unit);
    perCity[r.city] = (perCity[r.city] || 0) + tr;
    home[r.name] = r.city;
    // 합동 출진 — 본대가 아닌 합류 도시 부대는 원군처럼 늦게 도착한다
    if (r.city !== d.main) {
      let g = extra.find(x => x.from === r.city);
      if (!g) { g = { from: r.city, units: [] }; extra.push(g); }
      g.units.push(unit);
    } else mainUnits.push(unit);
  }
  if (!units.length) { toast('출진 병력이 없습니다'); return; }
  // 본대 병력이 비어 있으면 합류 부대 하나를 본대로 올린다 (그 부대는 점령 도시에 남는다)
  if (!mainUnits.length && extra.length) {
    const g = extra.shift();
    g.units.forEach(u => { mainUnits.push(u); if (u.officer) home[u.officer.name] = d.main; });
  }
  const total = Object.keys(perCity).reduce((s, k) => s + perCity[k], 0);
  if (total < 100) { toast('출진 병력이 너무 적습니다'); return; }
  if (typeof Battle === 'undefined') { toast('전투 모듈을 불러오지 못했습니다'); return; }
  if (!spendCmd()) return;
  markUsed(units.map(u => u.officer.name));
  const auto = !!($('autoBattle') || {}).checked;
  G.ui.attack = null;               // 지도 목적지 선택 상태 정리 — 전투 중 힌트 띠가 남지 않게
  closeModal();
  G.ui.deploy = null;
  const days = (typeof Battle !== 'undefined' && Battle.reinforceDays) || 3;
  const ctx = {
    atk: G.pf, def: t.owner, from: d.main, to: d.target, home,
    siege: d.mode==='field'?false:d.mode==='siege'?true:!aiFieldDefense(t, mainUnits),
    extra: extra.filter(g => g.units.length)          // 합동 출진 부대 (원군처럼 늦게 도착)
  };
  Object.keys(perCity).forEach(k => { G.cities[k].troops -= perCity[k]; });
  log('⚔ ' + Object.keys(perCity).join('·') + '의 ' + G.factions[G.pf].name + '군 ' +
    commas(total) + '명이 ' + t.name + '으로 출진!' +
    (ctx.extra.length ? ' (합류 도시 부대는 행군 ' + days + '일 후 도착 · 전투 후 복귀)' : ''), 'war');
  beginBattle(ctx, mainUnits, defenseUnits(d.target), 'atk', auto);
}

/* ── 부대 편성 헬퍼 ──────────────────────────────────── */
function autoBranch(o) { return (o && o.wu >= 85) ? '기병' : ((o && o.zhi >= 80) ? '궁병' : '보병'); }
// 병과에 어울리는 기본 진형 — 장수마다 다르게 시작한다 (편성 화면에서 개별 변경 가능)
function defaultForm(branch) {
  return branch === '기병' ? '봉시' : (branch === '궁병' ? '학익' : '어린');
}
// 수비에 어울리는 진형 — 보병은 방원(방패), 궁병은 학익, 기병은 봉시
function defForm(branch) {
  return branch === '기병' ? '봉시' : (branch === '궁병' ? '학익' : '방원');
}
// 병력을 부대 수에 맞게 정확히 분배한다 (합계 = total)
function distribute(total, n) {
  const t = Math.max(0, Math.round(total));
  const base = Math.floor(t / n), rem = t - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}
function defenseUnits(cityName) {
  const c = G.cities[cityName];
  // 수비는 무력뿐 아니라 계략(지력)도 중요하므로 함께 평가해 상위 5명을 고른다
  const list = officersIn(cityName).slice()
    .sort((a, b) => (b.wu * 0.7 + b.zhi * 0.3) - (a.wu * 0.7 + a.zhi * 0.3)).slice(0, 5);
  if (!list.length) return [{ officer: null, troops: Math.max(0, c.troops), branch: '보병', training: c.training, morale: c.morale, form: '방원' }];
  const counts = distribute(c.troops, list.length);
  return list.map((o, i) => {
    const br = autoBranch(o);
    return { officer: o, troops: counts[i], branch: br, training: c.training, morale: c.morale, form: defForm(br) };
  });
}

/* ── 수비 편성 (방어전) ──────────────────────────────── */
/* 방어전도 출진처럼 무장·병과·진형·병력을 직접 고른다. */
function defensePlan(cityName) {
  const names = officersIn(cityName).slice().sort((a, b) => b.wu - a.wu).map(o => o.name);
  const amounts = {}, branches = {}, forms = {};
  defenseUnits(cityName).forEach(u => { if (u.officer) amounts[u.officer.name] = u.troops; });
  names.forEach(n => {
    if (!(n in amounts)) amounts[n] = 0;      // 기본은 상위 5명, 나머지는 예비
    branches[n] = autoBranch(off(n));
    forms[n] = defForm(branches[n]);          // 수비 기본 진형 (병과별)
  });
  return { names, amounts, branches, forms };
}
/* 편성 값으로 수비 부대를 만든다 (화면과 무관 — 검증 가능) */
function defenseUnitsFrom(cityName, plan) {
  const c = G.cities[cityName];
  if (!c) return { units: [], reserve: 0 };
  const p = plan || {};
  const units = [];
  let used = 0;
  (p.names || []).forEach(n => {
    const o = off(n); if (!o) return;
    let tr = parseInt((p.amounts || {})[n], 10);
    if (isNaN(tr) || tr <= 0) return;
    tr = cl(tr, 0, Math.min(10000, Math.max(0, c.troops - used)));
    if (tr <= 0) return;
    used += tr;
    const br = (p.branches || {})[n] || autoBranch(o);
    const fm = FORMS[(p.forms || {})[n]] ? p.forms[n] : defForm(br);
    units.push({ officer: o, troops: tr, branch: br, training: c.training, morale: c.morale, form: fm });
  });
  return { units, reserve: Math.max(0, c.troops - used) };
}
/* 적이 우리 성을 공격할 때 — 전투 전에 수비 편성 창을 띄운다 */
function openDefenseDeploy(ctx, atkUnits) {
  if (!G || !G.ui || !ctx) return;
  // 수비 병력이 하나도 없으면 편성 창도 없이 곧바로 자동 후퇴한다
  const guard = G.cities[ctx.to];
  if (guard && Math.max(0, guard.troops || 0) <= 0 && resolveAutoRetreat(ctx, atkUnits)) return;
  if (!ctx.introShown) { playAttackIntro(ctx, () => openDefenseDeploy(ctx, atkUnits)); return; }
  const city = G.cities[ctx.to];
  const list = city ? officersIn(ctx.to) : [];
  // 모달을 띄울 수 없는 환경(헤드리스 테스트 등)은 자동 편성으로 진행한다
  const root = typeof document !== 'undefined' && document.getElementById ? document.getElementById('modalRoot') : null;
  if (!city || !list.length || !root || root.isConnected !== true) {
    beginBattle(ctx, atkUnits, defenseUnits(ctx.to), 'def', false);
    return;
  }
  const plan = defensePlan(ctx.to);
  G.ui.defDeploy = {
    ctx, atkUnits, city: ctx.to, auto: false, mode:'siege',
    names: plan.names, amounts: plan.amounts, branches: plan.branches, forms: plan.forms
  };
  renderDefenseDeploy();
}
function renderDefenseDeploy() {
  const d = G && G.ui ? G.ui.defDeploy : null; if (!d) return;
  const c = G.cities[d.city]; if (!c) { closeModal(); return; }
  const atkTroops = (d.atkUnits || []).reduce((s, u) => s + (u.troops || 0), 0);
  const total = d.names.reduce((s, n) => s + (parseInt(d.amounts[n], 10) || 0), 0);
  const rows = d.names.map((n, i) => {
    const o = off(n) || { wu: 50, zhi: 50 };
    const br = d.branches[n] || autoBranch(o);
    const fm = FORMS[d.forms[n]] ? d.forms[n] : defForm(br);
    const bopt = b => '<option value="' + b + '"' + (br === b ? ' selected' : '') + '>' + b + '</option>';
    const fopt = f => '<option value="' + f + '"' + (fm === f ? ' selected' : '') + '>' + f + '</option>';
    return '<div class="row"><span class="name"' + portraitAttr(n) + '>' + n + '</span>' +
      '<span class="stats">무력 ' + o.wu + ' · 지력 ' + o.zhi + (o.used ? ' · 행동 완료' : '') + '</span>' +
      '<span>병과 <select aria-label="' + n + ' 병과" id="dbr_' + i + '">' + ['보병', '기병', '궁병'].map(bopt).join('') + '</select></span>' +
      '<span>진형 <select aria-label="' + n + ' 진형" id="dfm_' + i + '" title="' + FORMS[fm].desc + '">' +
        Object.keys(FORMS).map(fopt).join('') + '</select></span>' +
      deploymentTroopControl(n, i, parseInt(d.amounts[n], 10) || 0, Math.min(10000, Math.max(0, c.troops)), true) + '</div>';
  }).join('');
  showModal('<h3>수비 편성 — ' + d.city + ' 방어</h3>' +
    '<p class="muted">적: ' + ((d.ctx.atk && G.factions[d.ctx.atk] ? G.factions[d.ctx.atk].name : '적')) + '군 (병력 ' + commas(atkTroops) +
      ') · 우리 병력 ' + commas(c.troops) + ' · 방어도 ' + c.def + ' · 훈련 ' + c.training + '</p>' +
    '<p class="muted">출진처럼 무장마다 병과·진형·병력을 지정합니다 — ' +
      Object.keys(FORMS).map(f => '<b>' + f + '</b> ' + FORMS[f].desc).join(' · ') + '</p>' +
    '<p><label>수비 방침 <select id="defMode" aria-label="수비 방침" onchange="Game.state.ui.defDeploy.mode=this.value"><option value="siege"' + (d.mode==='siege'?' selected':'') + '>농성 — 성과 방어도 활용</option><option value="field"' + (d.mode==='field'?' selected':'') + '>야전 요격 — 패하면 성으로 후퇴</option></select></label></p>' +
    '<p class="muted">야전에서 침공군을 물리치면 도시를 지킵니다. 야전 패배·성으로 후퇴 시 남은 부대와 예비 병력으로 공성을 이어갑니다. 예비 병력 없이 전원 요격을 편성하면 병력의 25%를 성에 남깁니다.</p>' +
    '<p><label class="muted"><input type="checkbox" id="defAuto"' + (d.auto ? ' checked' : '') + '> 자동 전투(지휘 위임)</label></p>' +
    '<p class="muted" id="defSupplyForecast" aria-live="polite">' + battleSupplyHint(total + (d.reinf||[]).reduce((s,r)=>s+r.troops,0)) + '</p>' +
    rows +
    (d.reinf && d.reinf.length ? '<p class="muted"><b>요청한 원군</b> — 편성 중 요청한 원군은 ' + DEF_REINF_DAYS + '일 후 도착합니다.</p>' +
      d.reinf.map(r => '<div class="row"><span class="name">' + r.from + '</span>' +
        '<span class="muted">원군 ' + r.names.join('·') + ' · 병력 ' + commas(r.troops) + '</span></div>').join('') : '') +
    '<p class="muted" aria-live="polite">편성 병력 <b id="defTotal">' + commas(total) + '</b> · 잔여 <b id="defReserve">' + commas(c.troops - total) + '</b>' +
      ' · 병력을 비워 둔 무장은 성에 남아 전투에 나서지 않습니다. 창을 닫으면 자동 편성으로 수비합니다.</p>' +
    '<div class="foot">' +
    (defenderRetreatCities(d.ctx).length ?
      '<button onclick="Game.retreatDefenseDeploy()" title="방어를 포기하고 인접 아군 도시로 잔존 병력을 거둡니다">후퇴</button>' : '') +
    '<button onclick="Game.openDefReinforce()">원군 요청</button>' +
    '<button onclick="Game.autoDefenseDeploy()">자동 편성</button>' +
    '<button class="primary" onclick="Game.confirmDefenseDeploy()">수비!</button></div>');
  captureDefenseDeploy();
}
/* 입력값을 계획에 반영한다 (편성 병력 합계는 성 병력을 넘지 않는다) */
function captureDefenseDeploy(changedIndex) {
  const d = G && G.ui ? G.ui.defDeploy : null; if (!d) return 0;
  const c = G.cities[d.city];
  const a = $('defAuto'); if (a) d.auto = !!a.checked;
  const mode=$('defMode');if(mode&&['siege','field'].includes(mode.value)) d.mode=mode.value;
  const totals = syncDeploymentTroops(d, d.names.map(name => ({ city: d.city, name })), 'dtr_', changedIndex);
  const sum = totals[d.city] || 0;
  d.names.forEach((n, i) => {
    const b = $('dbr_' + i); if (b) d.branches[n] = b.value;
    const fm = $('dfm_' + i); if (fm && FORMS[fm.value]) d.forms[n] = fm.value;
  });
  const tt = $('defTotal'); if (tt) tt.textContent = commas(sum);
  const reserve = $('defReserve'); if (reserve) reserve.textContent = commas(Math.max(0, (c ? c.troops : 0) - sum));
  const forecast = $('defSupplyForecast');
  if (forecast) forecast.textContent = battleSupplyHint(sum + (d.reinf||[]).reduce((s,r)=>s+r.troops,0));
  return sum;
}
/* 자동 편성으로 되돌린다 (수비 상위 무장 · 병과/진형 기본값) */
function autoDefenseDeploy() {
  const d = G && G.ui ? G.ui.defDeploy : null; if (!d) return;
  const a = $('defAuto'); if (a) d.auto = !!a.checked;
  const plan = defensePlan(d.city);
  d.names = plan.names; d.amounts = plan.amounts; d.branches = plan.branches; d.forms = plan.forms;
  renderDefenseDeploy();
}
function confirmDefenseDeploy() {
  const d = G && G.ui ? G.ui.defDeploy : null; if (!d) return;
  captureDefenseDeploy();
  if (d.troopsAdjusted) { toast('현재 병력에 맞게 편성을 조정했습니다. 병력을 확인하고 다시 수비하세요'); return; }
  const built = defenseUnitsFrom(d.city, d);
  if (!built.units.length) { toast('수비에 나설 부대가 없습니다 — 병력을 지정하세요'); return; }
  d.ctx.defReserve = built.reserve;         // 성에 남는 예비 병력
  d.ctx.siege = d.mode !== 'field';
  const ctx = d.ctx, atkUnits = d.atkUnits, auto = d.auto, pre = (d.reinf || []).slice();
  G.ui.defDeploy = null;
  closeModal();
  beginBattle(ctx, atkUnits, built.units, 'def', auto, pre);
}
/* ── 수비 편성 창의 [후퇴] ─────────────────────────────
   방어를 포기하고 성을 내준다. 잔존 병력의 80%는 후퇴지로 거두고,
   편성 중 요청한 원군은 취소해 출발 도시로 돌려준다. */
function retreatDefenseDeploy() {
  const d = G && G.ui ? G.ui.defDeploy : null; if (!d) return;
  const cands = defenderRetreatCities(d.ctx).sort((a, b) => (b.troops || 0) - (a.troops || 0));
  if (!cands.length) { toast('후퇴할 인접 아군 도시가 없습니다'); return; }
  captureDefenseDeploy();                    // 편성 입력을 먼저 보존한다
  d.sub = true; d.rpick = null;
  showModal('<h3>후퇴 — ' + d.city + '</h3>' +
    '<p class="muted">' + d.city + '을(를) 포기하고 잔존 병력의 ' + Math.round(RETREAT_KEEP * 100) +
      '%를 ' + cands[0].name + '(으)로 거둡니다. 성은 적에게 넘어가고 남은 병력은 잃습니다.</p>' +
    (cands.length > 1 ? '<p class="muted">후퇴지 후보: ' +
      cands.map(c => c.name + ' (병력 ' + commas(c.troops) + ')').join(' · ') +
      ' — 병력이 가장 많은 도시로 갑니다.</p>' : '') +
    '<div class="foot"><button onclick="Game.cancelDefRetreat()">취소</button>' +
    '<button class="primary" onclick="Game.doDefRetreat()">후퇴</button></div>');
}
function cancelDefRetreat() {
  const d = G && G.ui ? G.ui.defDeploy : null; if (!d) return;
  d.sub = false; renderDefenseDeploy();
}
function doDefRetreat() {
  const d = G && G.ui ? G.ui.defDeploy : null; if (!d) return;
  const ctx = d.ctx, city = G.cities[d.city];
  if (!ctx || !city) return;
  const dest = defenderRetreatCities(ctx).sort((a, b) => (b.troops || 0) - (a.troops || 0))[0];
  if (!dest) { toast('후퇴할 인접 아군 도시가 없습니다'); return; }
  // 편성 중 요청한 원군은 취소 — 병력과 무장을 출발 도시로 돌려준다
  const asked = (d.reinf || []).slice();
  asked.forEach(r => {
    const home = G.cities[r.from];
    if (home) home.troops += r.troops || 0;
    (r.units || []).forEach(u => { if (u.officer) u.officer.used = false; });
  });
  const pack = list => (list || []).map(u => ({
    name: u.officer ? u.officer.name : '', troops: Math.max(0, Math.round(u.troops || 0))
  }));
  const res = {
    winner: 'attacker', preBattleRetreat: true, retreatTo: dest.name, rounds: 0,
    atk: pack((d.atkUnits || []).concat((ctx.extra || []).flatMap(g => g.units || []))),
    def: pack(defenseUnits(d.city)), captured: [], pending: []
  };
  G.ui.defDeploy = null;
  closeModal();                              // 편성 창을 닫아도 전투가 열리지 않는다
  if (asked.length) log('🪖 요청했던 원군을 취소했습니다 — ' + asked.map(r => r.from).join('·'), '');
  log('🏳 ' + city.name + ' 수비군이 싸우지 않고 후퇴를 결정했습니다.', 'war');
  try { applyBattleResult(ctx, res); } finally { if (ctx.after) ctx.after(); }
}

/* 수비측 후퇴 가능 도시 — 성을 내주고 잔존 병력을 이끌고 갈 인접 아군 도시 */
function defenderRetreatCities(ctx) {
  const city = G.cities[ctx.to];
  if (!city) return [];
  return (city.links || []).map(n => G.cities[n])
    .filter(c => c && c.name !== ctx.to && c.owner === city.owner)
    .map(c => ({ name: c.name, troops: c.troops }));
}

/* 수비 병력이 0인 성이 공격받으면 전투를 열지 않고 자동 후퇴한다.
   성은 내주고 무장은 인접 아군 도시로 거두며, 후퇴할 곳이 없으면 함락된다. */
function defenseTroops(units) {
  return (units || []).reduce((s, u) => s + (u.troops || 0), 0);
}
/* 자동 후퇴 결과 — applyBattleResult 가 그대로 받는 전투 결과 형태로 만든다 */
function autoRetreatResult(ctx, atkUnits) {
  const city = ctx && G.cities[ctx.to];
  if (!city) return null;
  // 후퇴지는 가장 병력이 많은 인접 아군 도시 (없으면 함락)
  const dest = defenderRetreatCities(ctx).sort((a, b) => (b.troops || 0) - (a.troops || 0))[0] || null;
  const atk = (atkUnits || []).concat((ctx.extra || []).flatMap(g => g.units || []))
    .map(u => ({ name: u.officer ? u.officer.name : '', troops: Math.max(0, Math.round(u.troops || 0)) }));
  const res = { winner: 'attacker', atk, def: [], captured: [], pending: [], rounds: 0, autoRetreat: true };
  if (dest) res.retreatTo = dest.name;
  return res;
}
function resolveAutoRetreat(ctx, atkUnits) {
  const city=ctx&&G.cities[ctx.to];
  if(!city || city.troops>0) return false;
  const res = autoRetreatResult(ctx, atkUnits);
  if (!res) return false;
  G.battleActive = false; G.battleCtx = null;
  try { applyBattleResult(ctx, res); } finally { if (ctx.after) ctx.after(); }
  return true;
}

function prepareFieldDefense(ctx, defUnits) {
  // 야전 전멸이 성의 무혈 함락으로 이어지지 않도록 실제 주둔군 일부를 성에 남긴다.
  // 수동 편성에서 이미 남긴 예비 병력은 그대로 쓰고, 새 병력을 생성하지 않는다.
  if(ctx.siege===false && !ctx.fieldPrepared) {
    ctx.fieldPrepared=true;
    const total=defenseTroops(defUnits);
    if(!(ctx.defReserve>0) && total>1) {
      ctx.defReserve=Math.min(total-1,Math.max(1,Math.floor(total*.25)));
      const fieldTotal=total-ctx.defReserve;
      let assigned=0, cumulative=0;
      defUnits=defUnits.map(u=>{
        cumulative+=u.troops;
        const next=Math.floor(cumulative*fieldTotal/total),troops=next-assigned;
        assigned=next;return {...u,troops};
      }).filter(u=>u.troops>0);
      log('🏯 '+ctx.to+' 수비군 '+commas(ctx.defReserve)+'명이 성에 남아 공성을 대비합니다.','war');
    }
  }
  return defUnits;
}

function beginBattle(ctx, atkUnits, defUnits, playerSide, auto, preReinf) {
  defUnits=prepareFieldDefense(ctx,defUnits);
  // 수비측 병력이 0이면 싸울 수 없다 — 전투 없이 자동 후퇴
  if (defenseTroops(defUnits) <= 0 && resolveAutoRetreat(ctx, atkUnits)) return;
  if(ctx.siege===false && !ctx.interceptShown) {
    playAttackIntro(ctx,()=>beginBattle(ctx,atkUnits,defUnits,playerSide,auto,preReinf),true);
    return;
  }
  if (!ctx.introShown) {
    playAttackIntro(ctx, () => beginBattle(ctx, atkUnits, defUnits, playerSide, auto, preReinf));
    return;
  }
  const aF = G.factions[ctx.atk], dF = G.factions[ctx.def] || { name: '재야', color: '#888' };
  G.battleActive = true;
  if (typeof Battle === 'undefined') { G.battleActive = false; return; }
  if(!ctx.preserveReinf) ctx.reinf = {};                       // 원군 무장 → 출발 도시
  if(!ctx.preserveReinf) ctx.foeReinf = {};                    // 적 원군 무장 → 출발 도시
  G.battleCtx = ctx;
  bgm('battle');                        // 전투 — 북이 앞서는 장단
  sfx('battleStart');
  Battle.start({
    siege: ctx.siege !== false, city: G.cities[ctx.to], playerSide, auto: !!auto,
    approach:G.cities[ctx.from]?{x:G.cities[ctx.from].x-G.cities[ctx.to].x,y:G.cities[ctx.from].y-G.cities[ctx.to].y}:null,
    atk: { name: aF.name, color: aF.color, units: atkUnits },
    def: { name: dF.name, color: dF.color, units: defUnits },
    retreatCities: playerSide === 'def' ? defenderRetreatCities(ctx) : [],
    onReinforce: openReinforce,
    onAiReinforce: battleAiReinforce,
    onSupply: request => consumeBattleSupply(ctx, {...request, round:request.round+(ctx.roundOffset||0)}),
    onEnd: res => {
      if(ctx.siege===false && res.winner==='attacker') {
        continueSiege(ctx,res,atkUnits,defUnits,playerSide,auto); return;
      }
      finishBattle(ctx,res);
    }
  });
  // 합동 출진(인접 도시 합류) 부대 — 본대와 달리 원군처럼 행군 일수 뒤에 도착한다
  if (ctx.extra && ctx.extra.length && Battle.active) {
    const days = (typeof Battle.reinforceDays === 'number' ? Battle.reinforceDays : 3);
    ctx.extra.forEach(g => {
      if (!g.units || !g.units.length) return;
      Battle.reinforce(g.units, 'atk', { from: g.from, delay: days });
    });
  }
  // 수비 편성 창에서 미리 요청한 원군 — 전투 시작과 함께 출발해 이틀 뒤 도착한다
  if (preReinf && preReinf.length) applyDefReinforce(ctx, preReinf);
}

function finishBattle(ctx,res) {
  for(const side of ['atk','def']) {
    for(const lost of (ctx.fieldLost?.[side]||[])) if(!res[side].some(u=>u.name===lost.name)) res[side].push(lost);
  }
  G.battleActive=false;G.battleCtx=null;
  try {applyBattleResult(ctx,res);} finally {if(ctx.after)ctx.after();}
}

// 야전에서는 도시 소유권을 바꾸지 않는다. 실제 생존 부대와 성의 예비 병력만 공성에 참가한다.
function siegeSurvivors(ctx,res,originalAtk,originalDef) {
  const rebuild=(side,original)=>res[side].filter(u=>u.troops>0).map(u=>{
    const source=original.find(x=>(x.officer?.name||'수비병')===u.name);
    return {...source,officer:off(u.name)||source?.officer||null,troops:u.troops,
      training:u.training??source?.training??60,morale:Math.max(20,u.morale??60),
      branch:u.branch||source?.branch||'보병',form:u.form||source?.form||'방원'};
  });
  const atk=rebuild('atk',originalAtk),def=rebuild('def',originalDef);
  const reserve=ctx.defReserve||0;
  if(reserve && def.length) {
    const counts=distribute(reserve,def.length),city=G.cities[ctx.to];
    def.forEach((u,i)=>{const total=u.troops+counts[i];u.training=Math.round((u.training*u.troops+city.training*counts[i])/total);u.morale=Math.round((u.morale*u.troops+city.morale*counts[i])/total);u.troops=total;});
  }
  else if(reserve) {
    const city=G.cities[ctx.to];
    // 야전에서 전멸한 장수를 다시 살리지 않고 성에 남아 있던 수비병이 농성한다.
    def.push({officer:null,troops:reserve,branch:'보병',form:'방원',training:city.training,morale:city.morale});
  }
  ctx.defReserve=0;
  ctx.fieldLost={atk:res.atk.filter(u=>u.troops<=0),def:res.def.filter(u=>u.troops<=0)};
  // 야전 종료 시 아직 도착하지 않은 원군은 출발지로 돌아간다. 도착한 원군은 공성에도 참가한다.
  for(const p of res.pending||[]) {const city=G.cities[p.from];if(city) city.troops+=p.units.reduce((s,u)=>s+u.troops,0);}
  ctx.extra=[];
  ctx.siege=true;ctx.roundOffset=(ctx.roundOffset||0)+(res.rounds||0);
  ctx.preserveReinf=true;
  return {atk,def};
}

function continueSiege(ctx,res,originalAtk,originalDef,playerSide,auto) {
  const {atk,def}=siegeSurvivors(ctx,res,originalAtk,originalDef);
  if(!atk.length || !def.length) {
    const pack=units=>units.map(u=>({name:u.officer?.name||'',troops:u.troops}));
    finishBattle(ctx,{winner:atk.length?'attacker':'defender',atk:pack(atk),def:pack(def),captured:[],pending:[]});return;
  }
  log('⚔ '+G.cities[ctx.to].name+' 야전 종료 — 수비군이 성으로 물러나 공성을 이어갑니다.','war');
  beginBattle(ctx,atk,def,playerSide,auto);
}

function aiFieldDefense(city,atkUnits) {
  const defenders=defenseUnits(city.name),p=(us,opponents)=>us.reduce((s,u)=>s+CombatRules.power(u,us,{opponents}),0);
  return city.def<75 && city.morale>=65 && p(defenders,atkUnits)>p(atkUnits,defenders)*1.1;
}


/* 출진·원군 부대의 출발 도시 (합동 출진 대응) */
function reinforcementHome(ctx, name) {
  return (ctx.reinf && ctx.reinf[name]) || (ctx.foeReinf && ctx.foeReinf[name]);
}
function homeCity(ctx, name) {
  return reinforcementHome(ctx, name) || (ctx.home && ctx.home[name]) || ctx.from;
}

/* ── 원군 파견 (전투 중 인접 아군 도시에서 합류) ─────── */
/* 수비측 원군은 무장이 이번 달 행동을 마쳤어도 파견할 수 있다 */
function reinfFreeOfficer(o, side) {
  return !!o && (!o.used || side === 'def');
}
function reinfSide() {
  return (typeof Battle !== 'undefined' && Battle.state && Battle.state.playerSide) || 'atk';
}
/* 동맹군은 도시별로 전투당 한 번 요청하며, 파견 편성은 해당 세력이 결정한다. */
function alliedReinforceCities(ctx) {
  const target = ctx && G.cities[ctx.to];
  if (!target) return [];
  return (target.links || []).map(n => G.cities[n]).filter(c =>
    c && isAlly(G.pf, c.owner) && !(ctx.allyRequests && ctx.allyRequests[c.name]));
}
function alliedReinforcePlan(c, ctx, side) {
  const fid = c.owner, f = G.factions[fid], enemy = ctx[side === 'atk' ? 'def' : 'atk'];
  const refuse = reason => ({ reason, troops: 0, units: [] });
  if (fid === enemy || hasPeace(fid, enemy)) return refuse('교전 상대와도 동맹·휴전 관계여서 참전할 수 없습니다.');
  if (c.morale < 40 || c.training < 30) return refuse('부대의 사기·훈련을 회복해야 합니다.');
  const assigned = new Set(Object.keys(ctx.reinf || {}).concat(Object.keys(ctx.foeReinf || {})));
  const dd = G.ui.defDeploy;
  ((dd && dd.reinf) || []).forEach(r => r.names.forEach(n => assigned.add(n)));
  const list = officersIn(c.name).filter(o => o.faction === fid && !o.used && !assigned.has(o.name))
    .sort((a, b) => (b.wu * .7 + b.zhi * .3) - (a.wu * .7 + a.zhi * .3));
  if (!list.length) return refuse('파견할 수 있는 미행동 무장이 없습니다.');
  const threats = (c.links || []).map(n => G.cities[n]).filter(t =>
    t && t.name !== ctx.to && t.owner !== fid && !hasPeace(fid, t.owner));
  const danger = threats.reduce((s, t) => s + t.troops, 0);
  const reserve = Math.max(800, Math.ceil(danger * .65 / (1 + c.def / 120)));
  if (c.troops - reserve < 300) return refuse('주변 적군에 대비할 수비 병력이 부족합니다.');
  const economy = factionEconomy(fid);
  const foodReserve = Math.max(100, economy.foodUpkeep * 2);
  if (f.food < foodReserve) return refuse('자국 주둔군을 유지할 군량이 부족합니다.');
  const pressure = cl(aiTroopRatio(fid, factionCities(fid)), .35, 1);
  const relation = cl(f.rel[G.pf] || 0, -100, 100);
  if (relation < -20) return refuse('외교 관계가 악화되어 지원을 거절했습니다.');
  const share = cl(.3 + relation / 500, .15, .5) * pressure * (danger ? .75 : 1);
  const troops = Math.floor(Math.min(c.troops - reserve, c.troops * share,
    (f.food - foodReserve) * BATTLE_FOOD_DIVISOR / 15));
  if (troops < 300) return refuse('자국 전선과 군량 사정을 고려하면 파견할 여력이 없습니다.');
  // 여러 장수가 있으면 한 명은 도시에 남겨 내정·방어를 지휘한다.
  const selected = list.slice(0, Math.min(3, Math.max(1, list.length - 1), Math.max(1, Math.floor(troops / 1000))));
  const counts = distribute(troops, selected.length);
  return { troops, units: selected.map((o, i) => {
    const branch = autoBranch(o);
    return { officer: o, troops: counts[i], branch, training: c.training, morale: c.morale,
      form: side === 'def' ? defForm(branch) : defaultForm(branch) };
  }) };
}
function requestAllyReinforce(cityName) {
  const d = G && G.ui.defDeploy, ctx = d ? d.ctx : G && G.battleCtx;
  const active = typeof Battle !== 'undefined' && Battle.active && Battle.state && !Battle.state.over;
  if (!ctx || (!d && !active)) return;
  const c = alliedReinforceCities(ctx).find(c => c.name === cityName);
  if (!c) { toast('요청 가능한 인접 동맹국 도시가 아닙니다 (도시별 전투당 1회)'); return; }
  const side = d ? 'def' : reinfSide(), days = d ? DEF_REINF_DAYS : (Battle.reinforceDays || 3);
  if (!d && Battle.state.round + days > Battle.state.maxRound) {
    toast('전투가 끝나기 전에 원군이 도착할 수 없습니다'); return;
  }
  const plan = alliedReinforcePlan(c, ctx, side);
  const names = plan.units.map(u => u.officer.name);
  if (plan.troops && !d && !Battle.reinforce(plan.units, side, { from: c.name, delay: days })) {
    toast('원군 파견에 실패했습니다'); return;
  }
  if (!ctx.allyRequests) ctx.allyRequests = {};
  ctx.allyRequests[c.name] = { accepted: plan.troops > 0, troops: plan.troops, reason: plan.reason || '' };
  let message;
  if (plan.troops) {
    c.troops -= plan.troops;
    markUsed(names);
    if (d) {
      if (!d.reinf) d.reinf = [];
      d.reinf.push({ from: c.name, names, troops: plan.troops, units: plan.units });
    } else {
      if (!ctx.reinf) ctx.reinf = {};
      names.forEach(n => { ctx.reinf[n] = c.name; });
    }
    message = G.factions[c.owner].name + ' · ' + c.name + '에서 원군 요청을 승낙했습니다. ' +
      names.join('·') + ' · 병력 ' + commas(plan.troops) + ' · ' + days + '일 후 도착';
  } else message = G.factions[c.owner].name + ' · ' + c.name + '에서 원군 요청을 거절했습니다. ' + plan.reason;
  log('🪖 ' + message, plan.troops ? 'good' : '');
  if (d) { d.sub = true; d.rpick = null; }
  showModal('<h3>동맹국 원군 응답</h3><p>' + message + '</p>' +
    '<p class="muted">동맹국은 주둔 병력·군량·주변 위협·관계를 고려해 파견 여부와 규모를 정합니다. 도시별로 한 전투에 한 번 요청할 수 있습니다.</p>' +
    '<div class="foot"><button class="primary" onclick="Game.' + (d ? 'closeModal' : 'openReinforce') + '()">확인</button></div>');
}
function reinforceCandidates() {
  const ctx = G.battleCtx;
  if (!ctx || typeof Battle === 'undefined' || !Battle.active) return [];
  const city = G.cities[ctx.to];
  if (!city) return [];
  const side = reinfSide();
  return city.links.map(n => G.cities[n]).filter(c =>
    c && c.owner === G.pf && c.name !== ctx.from && c.troops >= 100 &&
    officersIn(c.name).filter(o => reinfFreeOfficer(o, side) && !(ctx.reinf && ctx.reinf[o.name])).length > 0);
}
function openReinforce() {
  const ctx = G.battleCtx;
  if (!ctx || typeof Battle === 'undefined' || !Battle.active) { toast('진행 중인 전투가 없습니다'); return; }
  const cands = reinforceCandidates();
  const allies = alliedReinforceCities(ctx);
  if (!cands.length && !allies.length) { toast('원군을 요청할 수 있는 인접 아군·동맹국 도시가 없습니다'); return; }
  const rows = cands.map(c => '<div class="row" role="button" tabindex="0" onclick="Game.pickReinforce(\'' + c.name + '\')">' +
    '<span class="name">' + c.name + '</span>' +
    '<span class="muted">아군 · 병력 ' + commas(c.troops) + ' · 무장 ' + officersIn(c.name).length + '명 · 거리 1</span></div>').join('');
  showModal('<h3>원군 파견 → ' + ctx.to + '</h3>' +
    '<p class="muted">인접 아군 도시에서 전장으로 원군을 보냅니다. 파견 무장은 이번 달 행동을 마치고, 병력은 파견 도시에서 차감됩니다. 행군에 ' +
      ((typeof Battle !== 'undefined' && Battle.reinforceDays) || 3) +
      '일(라운드)이 걸려 도착하며, 도착한 다음 라운드부터 움직일 수 있습니다. 진군 상황은 전장 위쪽 상태바에 표시됩니다.' +
      (reinfSide() === 'def' ? ' 수비측은 이번 달 이미 행동한 무장도 원군으로 보낼 수 있습니다.' : '') + '</p>' +
    rows + alliedReinforceRows(allies) + '<div class="foot"><button onclick="Game.closeModal()">취소</button></div>');
}
function alliedReinforceRows(cities) {
  if (!cities.length) return '';
  return '<p class="muted">동맹국에 요청 — 승낙 여부와 무장·병력 규모는 동맹국이 결정합니다 (도시별 전투당 1회).</p>' +
    cities.map(c => '<div class="row" role="button" tabindex="0" onclick="Game.requestAllyReinforce(\'' + c.name + '\')">' +
      '<span class="name">' + c.name + ' · 원군 요청</span><span class="muted">동맹국 ' + G.factions[c.owner].name +
      ' · 병력 ' + commas(c.troops) + ' · 거리 1</span></div>').join('');
}
function pickReinforce(cityName) {
  const ctx = G.battleCtx;
  if (!ctx) return;
  if (G.cities[cityName] && isAlly(G.pf, G.cities[cityName].owner)) { requestAllyReinforce(cityName); return; }
  if (!reinforceCandidates().some(c => c.name === cityName)) return;
  const side = reinfSide();
  openPick(cityName, {
    max: 0, min: 1, all: true, battle: true, score: PICK_SCORE.attack,
    title: '원군 무장 선택 — ' + cityName,
    empty: cityName + '에 파견할 수 있는 무장이 없습니다',
    filter: o => reinfFreeOfficer(o, side) && !(ctx.reinf && ctx.reinf[o.name])
  }, names => {
    const c = G.cities[cityName];
    G.ui.reinf = { from: cityName, names, forms: {} };
    const unitRows = names.map((n, i) => {
      const o = off(n) || { wu: 50, zhi: 50 };
      const br = autoBranch(o);
      const fm = defaultForm(br);
      G.ui.reinf.forms[n] = fm;
      const fopt = f => '<option value="' + f + '"' + (f === fm ? ' selected' : '') + '>' + f + '</option>';
      return '<div class="row"><span class="name">' + n + '</span>' +
        '<span class="muted">' + br + ' · 무력 ' + o.wu + '</span>' +
        '<span>진형 <select aria-label="' + n + ' 원군 진형" id="rf_' + i + '" title="' + FORMS[fm].desc + '">' +
        Object.keys(FORMS).map(fopt).join('') + '</select></span></div>';
    }).join('');
    showModal('<h3>원군 파견 — ' + cityName + ' → ' + ctx.to + '</h3>' +
      unitRows +
      '<p>파견 병력 <input aria-label="파견 병력" type="number" id="reinTroops" value="' + Math.max(100, Math.floor(c.troops * 0.5)) +
        '" min="100" max="' + c.troops + '" style="width:110px"> / ' + commas(c.troops) + '</p>' +
      '<p class="muted">파견한 병력은 ' + cityName + '에서 차감됩니다. 행군에 ' +
        ((typeof Battle !== 'undefined' && Battle.reinforceDays) || 3) +
        '일(라운드)이 걸리며, 도착한 다음 라운드부터 행동합니다.' +
        (side === 'def' ? ' 수비측은 이번 달 행동을 마친 무장도 파견할 수 있습니다.' : '') + '</p>' +
      '<div class="foot"><button onclick="Game.closeModal()">취소</button>' +
      '<button class="primary" onclick="Game.doReinforce()">파견</button></div>');
  });
}
function doReinforce() {
  const r = G.ui.reinf, ctx = G.battleCtx;
  if (!r || !ctx || typeof Battle === 'undefined' || !Battle.active) return;
  const c = G.cities[r.from];
  if (!c || c.owner !== G.pf) return;
  let amt = parseInt(($('reinTroops') || {}).value, 10); if (isNaN(amt)) amt = 0;
  amt = cl(amt, 0, c.troops);
  if (amt < 100) { toast('원군 병력이 너무 적습니다 (최소 100)'); return; }
  const side = (Battle.state && Battle.state.playerSide) || 'atk';
  const counts = distribute(amt, r.names.length);
  const units = r.names.map((n, i) => {
    const o = off(n);
    const br = autoBranch(o);
    const picked = ($('rf_' + i) || {}).value || (r.forms && r.forms[n]) || defaultForm(br);
    return {
      officer: o, troops: counts[i], branch: br, training: c.training, morale: c.morale,
      form: FORMS[picked] ? picked : defaultForm(br)
    };
  });
  const days = (typeof Battle !== 'undefined' && Battle.reinforceDays) || 3;
  if (!Battle.reinforce(units, side, { from: r.from, delay: days })) { toast('원군 파견에 실패했습니다'); return; }
  c.troops -= amt;
  r.names.forEach(n => {
    const o = off(n); if (o) o.used = true;
    if (!ctx.reinf) ctx.reinf = {};
    ctx.reinf[n] = r.from;
  });
  log('🪖 ' + r.from + '에서 ' + ctx.to + '으로 원군 파견 — ' + r.names.join('·') + ' (병력 ' + commas(amt) + ' · ' + days + '일 후 도착)', 'war');
  G.ui.reinf = null; closeModal(); renderAll();
}

/* ── 수비 편성 중 원군 요청 ─────────────────────────── */
/* 편성 창에서 바로 요청한 원군은 전투 시작과 함께 출발해 이틀 만에 도착한다 */
const DEF_REINF_DAYS = 2;

/* 편성 창에서 원군을 보낼 수 있는 인접 아군 도시 (파견할 무장이 남아 있는 곳) */
function defReinforceCandidates(cityName) {
  const city = cityName && G && G.cities ? G.cities[cityName] : null;
  if (!city) return [];
  const busy = {};
  const dd = G.ui && G.ui.defDeploy ? G.ui.defDeploy : null;
  ((dd && dd.reinf) || []).forEach(r => (r.names || []).forEach(n => { busy[n] = true; }));
  return (city.links || []).map(n => G.cities[n]).filter(c =>
    c && c.name !== cityName && c.owner === G.pf && c.troops >= 100 &&
    officersIn(c.name).some(o => reinfFreeOfficer(o, 'def') && !busy[o.name]));
}
/* 수비 편성 창의 [원군 요청] — 편성을 유지한 채 하위 창을 연다 */
function openDefReinforce() {
  const d = G && G.ui ? G.ui.defDeploy : null;
  if (!d) { openReinforce(); return; }            // 편성 창이 아니면 전투 중 원군 창
  captureDefenseDeploy();                         // 지금까지 지정한 편성을 보존한다
  d.sub = true; d.rpick = null;
  const cands = defReinforceCandidates(d.city);
  const allies = alliedReinforceCities(d.ctx);
  if (!cands.length && !allies.length) {
    d.sub = false;
    toast('원군을 요청할 수 있는 인접 아군·동맹국 도시가 없습니다');
    renderDefenseDeploy();
    return;
  }
  const rows = cands.map(c => '<div class="row" role="button" tabindex="0" onclick="Game.defReinfCity(\'' + c.name + '\')">' +
    '<span class="name">' + c.name + '</span>' +
    '<span class="muted">아군 · 병력 ' + commas(c.troops) + ' · 무장 ' + officersIn(c.name).length + '명 · 거리 1</span></div>').join('');
  showModal('<h3>원군 요청 → ' + d.city + '</h3>' +
    '<p class="muted">수비 편성 중에 미리 원군을 청합니다. 전투가 시작되면 출발해 <b>' + DEF_REINF_DAYS +
      '일(라운드)</b> 만에 전장에 도착하며, 병력은 파견 도시에서 차감됩니다.</p>' +
    rows + alliedReinforceRows(allies) + '<div class="foot"><button onclick="Game.closeModal()">취소</button></div>');
}
/* 원군 파견 도시의 무장·병력 지정 */
function defReinfCity(cityName) {
  const d = G && G.ui ? G.ui.defDeploy : null;
  const c = d && cityName ? G.cities[cityName] : null;
  if (!c) return;
  if (isAlly(G.pf, c.owner)) { requestAllyReinforce(cityName); return; }
  if (!defReinforceCandidates(d.city).some(c => c.name === cityName)) return;
  const list = officersIn(cityName).filter(o => reinfFreeOfficer(o, 'def')).sort((a, b) => b.wu - a.wu);
  if (!list.length) { toast(cityName + '에 파견할 수 있는 무장이 없습니다'); return; }
  const rows = list.map((o, i) => '<div class="row" role="button" tabindex="0" id="drRow' + i + '" aria-pressed="false" onclick="Game.toggleDefReinf(\'' + o.name + '\')">' +
    '<span class="name">' + portraitHtml(o.name, 22) + o.name + '</span>' +
    '<span class="stats">무력 ' + o.wu + ' · 지력 ' + o.zhi + ' · ' + autoBranch(o) + '</span>' +
    '<span class="right" id="drMark' + i + '"></span></div>').join('');
  d.rpick = { city: cityName, list: list.map(o => o.name), sel: [] };
  d.sub = true;
  showModal('<h3>원군 무장 — ' + cityName + ' → ' + d.city + '</h3>' +
    '<p class="muted">파견할 무장을 고르세요 (여러 명 가능 · 병과 자동 · 진형은 수비 기본값) — 현재 <b id="drCount">0</b>명</p>' +
    rows +
    '<p>파견 병력 <input aria-label="원군 병력" type="number" id="drTroops" value="' + Math.max(100, Math.floor(c.troops * 0.5)) +
      '" min="100" max="' + c.troops + '" style="width:110px"> / ' + commas(c.troops) + '</p>' +
    '<div class="foot"><button onclick="Game.openDefReinforce()">뒤로</button>' +
    '<button class="primary" onclick="Game.doDefReinforce()">요청</button></div>');
}
function toggleDefReinf(name) {
  const d = G && G.ui ? G.ui.defDeploy : null;
  const r = d && d.rpick ? d.rpick : null; if (!r) return;
  const i = r.sel.indexOf(name);
  if (i >= 0) r.sel.splice(i, 1); else r.sel.push(name);
  const on = r.sel.indexOf(name) >= 0;
  const idx = r.list.indexOf(name);
  const row = $('drRow' + idx);
  if (row && row.classList) row.classList.toggle('picked', on);
  if (row && row.setAttribute) row.setAttribute('aria-pressed', String(on));
  const mark = $('drMark' + idx); if (mark) mark.textContent = on ? '✔ 선택' : '';
  const cnt = $('drCount'); if (cnt) cnt.textContent = String(r.sel.length);
}
/* 요청 확정 — 병력은 파견 도시에서 차감하고 편성 창으로 돌아간다 */
function doDefReinforce() {
  const d = G && G.ui ? G.ui.defDeploy : null;
  const r = d && d.rpick ? d.rpick : null; if (!r) return;
  const c = G.cities[r.city]; if (!c) return;
  if (c.owner !== G.pf) return;
  if (!r.sel.length) { toast('파견할 무장을 선택하세요'); return; }
  let amt = parseInt(($('drTroops') || {}).value, 10); if (isNaN(amt)) amt = 0;
  amt = cl(amt, 0, c.troops);
  if (amt < 100) { toast('원군 병력이 너무 적습니다 (최소 100)'); return; }
  const counts = distribute(amt, r.sel.length);
  const units = r.sel.map((n, i) => {
    const o = off(n), br = autoBranch(o);
    return { officer: o, troops: counts[i], branch: br, training: c.training, morale: c.morale, form: defForm(br) };
  });
  c.troops -= amt;
  r.sel.forEach(n => { const o = off(n); if (o) o.used = true; });
  if (!d.reinf) d.reinf = [];
  d.reinf.push({ from: r.city, names: r.sel.slice(), troops: amt, units });
  d.rpick = null;
  log('🪖 ' + r.city + '에 원군을 요청 — ' + r.sel.join('·') + ' (병력 ' + commas(amt) + ' · ' + DEF_REINF_DAYS + '일 후 도착)', 'war');
  renderDefenseDeploy();
}
/* 전투 시작 직후 — 요청해 둔 원군을 예약 도착시킨다 */
function applyDefReinforce(ctx, list) {
  if (!ctx || !list || !list.length) return;
  if (typeof Battle === 'undefined' || !Battle.active) return;
  list.forEach(r => {
    const units = (r.units || []).filter(u => u && u.officer && u.troops > 0);
    if (!units.length) return;
    if (!Battle.reinforce(units, 'def', { from: r.from, delay: DEF_REINF_DAYS })) {
      const c = G.cities[r.from];                 // 예약에 실패하면 병력을 돌려준다
      if (c) c.troops += r.troops || 0;
      return;
    }
    if (!ctx.reinf) ctx.reinf = {};
    units.forEach(u => { ctx.reinf[u.officer.name] = r.from; });
  });
}

/* ── 적(AI) 원군 — 전투 중 필요하면 인접 자기 도시에서 증원을 보낸다 ─── */
const AI_REINF_MIN = 300;        // 원군 최소 병력
const AI_REINF_LIMIT = 3;        // 한 전투에서 한 진영이 보낼 수 있는 횟수
const AI_REINF_DEFICIT = 1.1;    // 원군까지 포함한 전력이 이 비율보다 불리하면 원군을 요청한다
const RETREAT_KEEP = 0.8;        // 수비측이 후퇴할 때 거둬들이는 잔존 병력 비율

function battleAiReinforce(req) {
  const ctx = G.battleCtx;
  if (!ctx || typeof Battle === 'undefined' || !Battle.active) return;
  const st = Battle.state;
  if (!st || st.over) return;
  const side = (req && req.side) || (st.playerSide === 'atk' ? 'def' : 'atk');
  const fid = side === 'atk' ? ctx.atk : ctx.def;
  if (!fid || fid === G.pf) return;                 // 우리 군은 플레이어가 [원군]으로 직접 보낸다
  if (!ctx.foeReinf) ctx.foeReinf = {};
  if (!ctx.foeSent) ctx.foeSent = {};
  if ((ctx.foeSent[side] || 0) >= AI_REINF_LIMIT) return;
  const pending = st.pending || [];
  const other = side === 'atk' ? 'def' : 'atk';
  // 이미 두 부대 이상 오고 있으면 더 보내지 않는다
  if (pending.filter(p => p.side === side).length >= 2) return;
  // "필요할 때"만 — 오고 있는 원군까지 포함해 아직 밀리지 않았으면 요청하지 않는다
  const sum = s => (st.units || []).filter(u => u.alive && u.side === s).reduce((t, u) => t + u.troops, 0);
  const wait = s => pending.filter(p => p.side === s)
    .reduce((t, p) => t + (p.units || []).reduce((x, u) => x + (u.troops || 0), 0), 0);
  const mine = sum(side) + wait(side), foe = sum(other) + wait(other);
  if (!foe || mine >= foe * AI_REINF_DEFICIT) return;
  const maxRound = (req && req.maxRound) || st.maxRound || 15;
  const left = maxRound - st.round;
  if (left < 1) return;                             // 도착할 라운드가 남아 있지 않다
  // 첫 전투 시작 시 수비 AI가 미리 청한 원군은 수비 편성과 같은 이틀을 적용한다.
  // 야전에서 이어진 공성은 새 편성 단계가 아니므로 일반 행군 일수를 쓴다.
  const preparedDefense = side === 'def' && st.round === 1 && !ctx.preserveReinf;
  const days = Math.max(1, Math.min(preparedDefense ? DEF_REINF_DAYS :
    (typeof Battle.reinforceDays === 'number' ? Battle.reinforceDays : 3), left));
  const target = G.cities[ctx.to];
  if (!target) return;
  // 전장에 이미 나와 있는 무장은 다시 파견하지 않는다
  const busy = {};
  (st.units || []).forEach(u => { if (u.alive && !u.noOfficer) busy[u.name] = true; });
  pending.forEach(p => (p.units || []).forEach(u => { if (u.officer) busy[u.officer.name] = true; }));
  const cands = (target.links || []).map(n => G.cities[n]).filter(c => {
    if (!c || c.owner !== fid) return false;
    if (side === 'atk' && c.name === ctx.from) return false;   // 이미 출진한 본대 도시
    if (c.troops < AI_REINF_MIN + 200) return false;
    return officersIn(c.name).some(o => reinfFreeOfficer(o, side) && !busy[o.name]);
  }).sort((a, b) => b.troops - a.troops);
  const src = cands[0];
  if (!src) return;
  // 수비 원군은 방어·계략에 강한 무장을, 공격 원군은 무공이 높은 무장을 고른다
  const rank = side === 'def'
    ? (a, b) => (b.wu * 0.7 + b.zhi * 0.3) - (a.wu * 0.7 + a.zhi * 0.3)
    : (a, b) => b.wu - a.wu;
  const list = officersIn(src.name)
    .filter(o => reinfFreeOfficer(o, side) && !busy[o.name])
    .sort(rank)
    .slice(0, 3);
  if (!list.length) return;
  const share = mine < foe * 0.7 ? 0.6 : 0.45;      // 크게 밀리면 더 많이 보낸다
  const amt = Math.min(Math.max(AI_REINF_MIN, Math.round(src.troops * share)), src.troops - 200);
  if (amt < AI_REINF_MIN) return;
  const counts = distribute(amt, list.length);
  const units = list.map((o, i) => ({
    officer: o, troops: counts[i], branch: autoBranch(o),
    training: src.training, morale: src.morale,
    form: side === 'def' ? defForm(autoBranch(o)) : defaultForm(autoBranch(o))
  }));
  if (!Battle.reinforce(units, side, { from: src.name, delay: days })) return;
  src.troops -= amt;
  list.forEach(o => { o.used = true; ctx.foeReinf[o.name] = src.name; });
  ctx.foeSent[side] = (ctx.foeSent[side] || 0) + 1;
  log('🪖 ' + src.name + '의 ' + ((G.factions[fid] || {}).name || '적') + '군이 원군을 보냈습니다 — ' +
    list.map(o => o.name).join('·') + ' (병력 ' + commas(amt) + ' · ' + days + '일 후 도착)', 'war');
}

/* ── 전투 결과 반영 ──────────────────────────────────── */
function applyBattleResult(ctx, res) {
  const fAtk = G.factions[ctx.atk] || { name: '재야' };
  const from = G.cities[ctx.from], to = G.cities[ctx.to];
  if (ctx.supply && (ctx.atk===G.pf || ctx.def===G.pf)) {
    const supply=ctx.supply[ctx.atk===G.pf?'atk':'def'];
    log('전투 추가 군량: -' + commas(supply.paid) + ' (' + ctx.supply.round + '라운드' +
      (supply.cost>supply.paid ? ' · 미지급 ' + commas(supply.cost-supply.paid) : '') + ')','');
  }
  const atkTroops = res.atk.reduce((s, u) => s + u.troops, 0);
  const defTroops = res.def.reduce((s, u) => s + u.troops, 0);
  const cap = Array.from(new Set(res.captured || []));
  // 패배측 무장 포로 판정 — 세력 수장은 포로가 되지 않는다
  // 싸우지 않고 후퇴한 경우엔 포로도 잡히지 않는다
  const losers = (res.autoRetreat || res.preBattleRetreat) ? [] : (res.winner === 'attacker' ? res.def : res.atk);
  losers.forEach(u => {
    if (!u.name || cap.indexOf(u.name) >= 0 || isLeader(u.name)) return;
    const o = off(u.name); if (!o) return;
    const p = u.troops <= 0 ? 0.65 : 0.25;
    if (Math.random() < p) cap.push(o.name);
  });
  const prevOwner = to.owner;
  // 수비측 후퇴 — 성을 내주는 대신 잔존 병력을 지정한 아군 도시로 옮긴다
  const retreatTo = (res.winner === 'attacker' && res.retreatTo && res.retreatTo !== ctx.to &&
    G.cities[res.retreatTo] && G.cities[res.retreatTo].owner === prevOwner) ? G.cities[res.retreatTo] : null;

  const helpBack = [];      // 도와주러 온 합동 출진·원군 무장 (전투 후 출발 도시로 복귀)
  if (res.winner === 'attacker') {
    // 본대만 점령 도시에 남고, 도와준 도시의 무장은 자기 도시로 돌아간다
    let stay = 0;
    res.atk.forEach(u => {
      const o = off(u.name), h = homeCity(ctx, u.name);
      if (h && h !== ctx.to && h !== ctx.from) {
        const hc = G.cities[h];
        if (hc && hc.owner === (o ? o.faction : ctx.atk)) hc.troops += (u.troops || 0);
        if (o) { o.city = h; o.status = 'active'; }
        if (u.name) helpBack.push(u.name);
        return;
      }
      stay += (u.troops || 0);
      if (o) { o.city = ctx.to; o.status = 'active'; }
    });
    to.owner = ctx.atk;to.policy='manual';
    to.def = Math.max(20, Math.round(to.def * 0.6));
    to.order = Math.max(10, Math.round(to.order * 0.6));
    to.troops = stay;
    to.training = from.training; // 점령군은 패한 도시의 높은 훈련도를 물려받지 않는다
    to.morale = cl(60 + ri(-5, 10), 30, 100);
    // 이 도시에 갇혀 있던 공격측 포로는 해방된다
    G.officers.filter(o => o.city === ctx.to && o.status === 'pow' && o.faction === ctx.atk).forEach(o => {
      o.status = 'active';
      o.captivityMonths = 0;
      o.loyalty = Math.max(o.loyalty, 60);
    });
    // 방어측 무장: 포로 / 후퇴 도시 또는 인접 아군 도시로 도피 / 재야
    G.officers.filter(o => o.faction === prevOwner && o.city === ctx.to && o.status === 'active').forEach(o => {
      if (cap.indexOf(o.name) >= 0) { o.status = 'pow'; o.captivityMonths = 0; return; }
      const esc = to.links.filter(n => G.cities[n].owner === prevOwner);
      const anyOwn = factionCities(prevOwner);
      const dest = (retreatTo ? retreatTo.name : '') || esc[0] || (isLeader(o.name) ? anyOwn[0] : null);
      if (dest) o.city = dest;
      else { o.faction = 'free'; o.loyalty = 0; }
    });
    // 수비측 원군은 패주해 출발 도시로 돌아가고, 후퇴를 명했다면 본대도 후퇴 도시로 병력을 거둔다
    let fled = 0;
    res.def.forEach(u => {
      if (u.name && cap.indexOf(u.name) >= 0) return;      // 포로가 된 무장의 병력은 남지 않는다
      const home = u.name && reinforcementHome(ctx, u.name);
      if (home) {
        const hc = G.cities[home], o = off(u.name);
        if (hc && hc.owner === (o ? o.faction : prevOwner)) hc.troops += Math.round((u.troops || 0) * 0.6);
        if (o && o.status === 'active') o.city = home;
        return;
      }
      if (!retreatTo) return;
      const moved = Math.round((u.troops || 0) * RETREAT_KEEP);
      if (moved > 0) { retreatTo.troops += moved; fled += moved; }
      const o = off(u.name); if (o && o.status === 'active') o.city = retreatTo.name;
    });
    if (retreatTo) {
      retreatTo.morale = cl(retreatTo.morale - 5, 20, 100);
      if (!res.autoRetreat) log('🏳 ' + to.name + ' 수비군이 ' + (res.preBattleRetreat ? '싸우지 않고 ' : '') +
        retreatTo.name + '으로 후퇴했습니다. (거둔 병력 ' + commas(fled) + ')', 'war');
    }
    if (res.autoRetreat) {
      log('🏳 ' + to.name + '은(는) 수비 병력이 없어 ' +
        (retreatTo ? retreatTo.name + '(으)로 자동 후퇴했습니다.' : '싸우지 못하고 성을 내주었습니다.'), 'war');
    }
    if (res.autoRetreat || res.preBattleRetreat) {
      toast(prevOwner === G.pf
        ? to.name + ' 수비군이 ' + (retreatTo ? retreatTo.name + '(으)로 ' : '') + '후퇴했습니다'
        : to.name + '은(는) 수비 병력이 없어 성을 내주었습니다');
    }
    cap.forEach(n => { const o = off(n); if (o) { o.status = 'pow'; o.city = ctx.to; o.captivityMonths = 0; } });
    log('⚔ ' + fAtk.name + '군이 ' + to.name + '을(를) 함락했습니다! (잔존 병력 ' + commas(atkTroops) + ')', 'war');
    if (helpBack.length) log('🪖 ' + to.name + ' 공격을 도운 합동 부대가 출발지로 복귀했습니다 — ' + helpBack.join('·'), '');
    if (factionCities(ctx.def).length === 0) destroyFaction(ctx.def);
  } else {
    // 수비측 원군은 자기 출발 도시로 복귀한다 (병력·무장)
    let keep = defTroops;
    const backDef = [];
    res.def.forEach(u => {
      const home = u.name && reinforcementHome(ctx, u.name);
      if (!home) return;
      const hc = G.cities[home], tr = u.troops || 0, o = off(u.name);
      if (hc && hc.owner === (o ? o.faction : ctx.def)) hc.troops += tr;
      keep = Math.max(0, keep - tr);
      if (o) o.city = home;
      backDef.push(u.name);
    });
    // 편성에서 비워 둔 예비 병력은 성에 남아 있다
    to.troops = Math.max(0, keep) + (ctx.defReserve || 0);
    to.morale = cl(to.morale - 8, 20, 100);
    res.atk.forEach(u => {
      const o = off(u.name); if (!o) return;
      o.city = homeCity(ctx, u.name);     // 원군·합동 출진 부대는 각자 출발 도시로 복귀
    });
    // 잔존 병력도 각 출발 도시로 복귀
    res.atk.forEach(u => {
      const hc = G.cities[homeCity(ctx, u.name)];
      if (hc) hc.troops += (u.troops || 0);
    });
    cap.forEach(n => { const o = off(n); if (o) { o.status = 'pow'; o.city = ctx.to; o.captivityMonths = 0; } });
    log('⚔ ' + fAtk.name + '군의 ' + to.name + ' 공격이 실패했습니다. (잔존 병력 ' + commas(atkTroops) + ')', 'war');
    if (backDef.length) log('🪖 ' + to.name + ' 수비에 참전한 원군이 출발지로 복귀했습니다 — ' + backDef.join('·'), '');
  }
  // 도착하지 못한 원군 — 병력·무장을 출발 도시로 되돌린다
  const pend = res.pending || [];
  if (pend.length) {
    const back = [];
    pend.forEach(p => {
      let sum = 0;
      (p.units || []).forEach(u => {
        sum += u.troops || 0;
        if (u.name) back.push(u.name);
        const o = off(u.name);
        if (o && p.from) { o.city = p.from; o.status = 'active'; }
      });
      const home = G.cities[p.from];
      if (home && sum > 0) home.troops += sum;
    });
    if (back.length) log('🪖 미도착 원군이 출발지로 복귀했습니다 — ' + back.join('·'), '');
  }
  renderAll();
  victoryCheck();
}
function destroyFaction(fid) {
  const f = G.factions[fid]; if (!f) return;
  log(f.name + ' 세력이 멸망했습니다.', 'bad');
  G.officers.filter(o => o.faction === fid).forEach(o => {
    o.faction = 'free'; o.loyalty = 0; o.status = 'active'; o.captivityMonths = 0;
  });
}

/* ── AI 전투 자동 판정 ───────────────────────────────── */
function unitPower(u, allies=[], options={}) {
  return CombatRules.power(u, allies, options);
}

function autoResolve(ctx, atkUnits, defUnits, defBonus) {
  // 간이 전투는 전력 차이로 3~12일을 추산하고, 같은 일일 보급 규칙을 적용한다.
  atkUnits = atkUnits.map(u=>({...u})); defUnits = defUnits.map(u=>({...u}));
  const city=G.cities[ctx.to],siege=defBonus&&ctx.siege!==false;
  let terrain=1;
  if(typeof BattleTerrain!=='undefined' && city) {
    const tiles=BattleTerrain.build(city,siege).terrain.flat().filter(t=>t!==4);
    terrain=tiles.reduce((s,t)=>s+([1,1.15,1.25,1.4,1,1][t]||1),0)/Math.max(1,tiles.length);
  }
  const aj=rnd(.9,1.1), dj=terrain*(siege?1.12:1)*rnd(.9,1.1);
  const power=(units,defense)=>units.reduce((sum,u)=>sum+unitPower(u,units,{cityDef:defense&&siege?(city?.def??50):0,opponents:defense?atkUnits:defUnits}),0);
  const ap=power(atkUnits,false)*aj, dp=power(defUnits,true)*dj;
  const rounds = cl(Math.round(12/Math.max(ap/Math.max(1,dp),dp/Math.max(1,ap),1)),3,12);
  const troops = us => us.reduce((s,u)=>s+u.troops,0);
  for(let round=1;round<=rounds;round++) {
    const supply=consumeBattleSupply(ctx,{round:round+(ctx.roundOffset||0),atk:troops(atkUnits),def:troops(defUnits)});
    for(const [side,units] of [['atk',atkUnits],['def',defUnits]]) {
      if(supply && supply[side].moraleLoss) units.forEach(u=>{u.morale=cl((u.morale??70)-supply[side].moraleLoss,0,100);});
    }
  }
  const pa = power(atkUnits,false) * aj;
  const pd = power(defUnits,true) * dj;
  const winner = pa >= pd ? 'attacker' : 'defender';
  const r = pa / (pa + pd);
  const asr = winner === 'attacker' ? cl(0.45 + 0.45 * r, 0.35, 0.92) : cl(0.15 + 0.5 * r, 0.05, 0.6);
  const dsr = winner === 'defender' ? cl(0.45 + 0.45 * (1 - r), 0.35, 0.92) : cl(0.15 + 0.5 * (1 - r), 0.05, 0.6);
  const atk = atkUnits.map(u => ({ name: u.officer ? u.officer.name : '', troops: Math.round(u.troops * asr * rnd(0.9, 1.1)),morale:u.morale,training:u.training,branch:u.branch,form:u.form }));
  const def = defUnits.map(u => ({ name: u.officer ? u.officer.name : '', troops: Math.round(u.troops * dsr * rnd(0.9, 1.1)),morale:u.morale,training:u.training,branch:u.branch,form:u.form }));
  return { winner, atk, def, captured: [], rounds };
}

/* ── 등용 ────────────────────────────────────────────── */
function canHireFrom(cityName, o) {
  const c = G.cities[cityName];
  if (!c || !o || isLeader(o.name)) return false;
  if (o.city === cityName) return (o.faction === 'free' && o.status === 'active') || o.status === 'pow';
  return c.links.includes(o.city) && o.status === 'active' && o.faction !== c.owner &&
    (o.faction === 'free' || o.loyalty < ENEMY_HIRE_LOYALTY_LIMIT);
}
function hireChance(cityName, o, by) {
  const best = by || bestAvailable(cityName);
  const cha = best ? best.cha : 30, pol = best ? best.pol : 30;
  const base = 0.18 + cha / 260 + pol / 480 + ((SKILLS[best ? best.skill : ''] || {}).recruit || 0);
  const p = cl(base - o.loyalty / 380, 0.05, 0.92);
  const honor = officerHonor(o), enemyChance = o.loyalty >= ENEMY_HIRE_LOYALTY_LIMIT ? 0 : p * 0.45 * (1 - honor * 0.0075);
  if (o.status === 'pow') {
    // 의리가 낮으면 3개월, 높으면 6개월에 걸쳐 재야(충성 0)의 확률로 접근한다.
    const progress = cl((o.captivityMonths || 0) / (3 + honor * 0.03), 0, 1);
    const freeChance = cl(base, 0.05, 0.92);
    return progress >= 1 ? freeChance : enemyChance + (freeChance - enemyChance) * progress;
  }
  const enemy = o.status === 'active' && o.faction !== 'free' && o.faction !== G.cities[cityName].owner;
  // 소속 세력을 떠나야 하는 현역 적장은 재야·포로보다 설득하기 어렵다.
  if (enemy) return enemyChance;
  const host = G.cities[o.city];
  return o.status === 'active' && o.faction === 'free' && host && host.owner !== G.cities[cityName].owner
    ? p * ENEMY_CITY_FREE_HIRE_RATE : p;
}
function cmdHire(cityName) {
  const c = G.cities[cityName]; if (!isPlayerCity(c)) return;
  if (!needCmd()) return;
  const cands = G.officers.filter(o => canHireFrom(cityName, o));
  if (!cands.length) { toast(cityName + ' 및 인접 도시에 등용할 무장이 없습니다'); return; }
  const best = bestAvailable(cityName);
  if (!best) { toast('이번 달 등용에 나설 무장이 없습니다'); return; }
  const rows = cands.slice().sort((a, b) =>
    hireChance(cityName, b) - hireChance(cityName, a) ||
    (b.wu + b.zhi + b.pol + b.cha) - (a.wu + a.zhi + a.pol + a.cha) ||
    a.name.localeCompare(b.name)
  ).map(o => {
    const p = hireChance(cityName, o);
    const sk = SKILLS[o.skill];
    const affiliation = o.status === 'pow' ? '포로 ' + (o.captivityMonths || 0) + '개월' : o.faction === 'free' ? '재야' : (G.factions[o.faction] || {}).name || o.faction;
    return '<div class="row" role="button" tabindex="0" onclick="Game.doHire(\'' + o.name + '\',\'' + cityName + '\')">' +
      '<span class="name">' + portraitHtml(o.name, 22) + o.name + '</span>' +
      '<span class="stats">무력 ' + o.wu + ' · 지력 ' + o.zhi + ' · 정치 ' + o.pol + ' · 매력 ' + o.cha + (sk ? ' · ' + o.skill : '') + '</span>' +
      '<span class="right">' + o.city + ' · ' + affiliation + ' · 성공률 ' + Math.round(p * 100) + '%</span></div>';
  }).join('');
  showModal('<h3>등용 — ' + cityName + '</h3>' +
    '<p class="muted">설득 담당: ' + best.name + ' (매력 ' + best.cha + ') · 명령권 1 소모<br>현재 도시의 재야·포로와 인접 도시의 재야·적 무장(군주 제외)을 설득합니다. 적 소속 현역 무장은 충성도 85 미만만 대상에 표시됩니다. 적 도시의 재야는 아군 도시 대비 성공률 70%가 적용됩니다. 포로는 처음에는 적 무장과 같고, 억류 3~6개월에 걸쳐 점차 설득하기 쉬워집니다. 성공하면 ' + cityName + '(으)로 합류합니다.</p>' +
    rows + '<div class="foot"><button onclick="Game.closeModal()">닫기</button></div>');
}
function doHire(name, cityName) {
  const o = off(name); if (!o) return;
  cityName = cityName || o.city;
  if (!isPlayerCity(G.cities[cityName])) return;
  if (!canHireFrom(cityName, o)) { toast('현재 등용할 수 없는 무장입니다'); return; }
  const best = bestAvailable(cityName);
  if (!best) { toast('이번 달 등용에 나설 무장이 없습니다'); return; }
  if (!spendCmd()) return;
  best.used = true;
  const p = hireChance(cityName, o, best);
  if (Math.random() < p) {
    o.faction = G.pf; o.status = 'active'; o.city = cityName; o.loyalty = ri(HIRED_LOYALTY_MIN, HIRED_LOYALTY_MAX); o.captivityMonths = 0;
    log(o.name + '을(를) 등용했습니다! (' + cityName + ')', 'good');
  } else {
    log(o.name + ' 등용에 실패했습니다. (성공률 ' + Math.round(p * 100) + '%)', 'bad');
  }
  closeModal(); renderAll();
}

/* ── 포상 ────────────────────────────────────────────── */
function cmdReward(cityName) {
  const c = G.cities[cityName]; if (!isPlayerCity(c)) return;
  if (!needCmd()) return;
  const f = G.factions[G.pf];
  const list = officersIn(cityName).slice().sort((a, b) => a.loyalty - b.loyalty);
  if (!list.length) { toast('무장이 없습니다'); return; }
  const rows = list.map(o => '<div class="row" role="button" tabindex="0" onclick="Game.doReward(\'' + o.name + '\')">' +
    '<span class="name">' + portraitHtml(o.name, 22) + o.name + '</span>' +
    '<span class="stats">충성도 ' + o.loyalty + (o.skill ? ' · ' + o.skill : '') + '</span>' +
    '<span class="right">금 ' + REWARD_COST + '</span></div>').join('');
  showModal('<h3>포상 — ' + cityName + '</h3>' +
    '<p class="muted">보유 금 ' + commas(f.gold) + ' · 1회 ' + REWARD_COST + '금, 충성도 +10~15 (충성도가 낮으면 배신 위험) · 포상은 무장 행동을 소모하지 않습니다.</p>' +
    rows + '<div class="foot"><button onclick="Game.closeModal()">닫기</button></div>');
}
function doReward(name) {
  const f = G.factions[G.pf];
  const o = off(name); if (!o) return;
  if (f.gold < REWARD_COST) { toast('금이 부족합니다'); return; }
  if (o.loyalty >= 100) { toast(o.name + '의 충성도는 이미 최대입니다'); return; }
  if (!spendCmd()) return;
  f.gold -= REWARD_COST;
  o.loyalty = cl(o.loyalty + ri(10, 15), 0, 100);
  log(o.name + '에게 포상 (충성도 → ' + o.loyalty + ')', 'good');
  closeModal(); renderAll();
}

/* ── 외교 ────────────────────────────────────────────── */
function openDiplo() {
  if (!G) { toast('먼저 세력을 선택하세요'); return; }
  if (!G.pf || G.fullDelegation) return;
  const f = G.factions[G.pf];
  const mine = factionTotals(G.pf);
  /* 도시 · 병력 · 금 · 군량을 세력마다 같은 형식으로 표시 */
  const nums = t => '<span class="kv">도시 <b>' + t.cities + '</b></span>' +
    '<span class="kv">병력 <b>' + commas(t.troops) + '</b></span>' +
    '<span class="kv">금 <b>' + commas(t.gold) + '</b></span>' +
    '<span class="kv">군량 <b>' + commas(t.food) + '</b></span>';
  const rows = Object.keys(G.factions).filter(id => id !== G.pf && factionCities(id).length)
    .sort((a, b) => factionTotals(b).troops - factionTotals(a).troops)   // 병력 많은 세력부터
    .map(id => {
      const g = G.factions[id], t = factionTotals(id);
      const ally = isAlly(G.pf, id);
      const rel = f.rel[id] || 0;
      const relCol = rel >= 60 ? 'var(--good)' : (rel <= -40 ? 'var(--bad)' : '#b9c4b4');
      return '<div class="row"><span class="dot" style="background:' + g.color + '"></span>' +
        '<span class="name">' + g.name + '</span>' +
        '<span class="nums">' + nums(t) +
          '<span class="kv">관계 <b style="color:' + relCol + '">' + rel + '</b></span>' +
          '<span class="kv">' + (g.vassalTo===G.pf?'종속 세력':ally ? '<b style="color:#7fc98a">동맹</b>'+ (f.pacts?.[id]?' '+Math.max(0,f.pacts[id]-G.turn)+'개월':'') : (f.truces?.[id]>G.turn?'휴전 '+(f.truces[id]-G.turn)+'개월':'중립')) + '</span>' +
        '</span>' +
        '<span class="right">'+(g.vassalTo===G.pf?'<button class="small" onclick="Game.diploAnnex(\''+id+'\')">영토 편입</button>': ally
          ? '<button class="small" onclick="Game.diploBreak(\'' + id + '\')">동맹 해지</button> <button class="small" onclick="Game.diploJoint(\''+id+'\')">공동 출진(300)</button>'
          : '<button class="small" onclick="Game.diploGift(\'' + id + '\')">선물(300)</button> ' +
            '<button class="small" onclick="Game.diploAlly(\'' + id + '\')">12개월 동맹(500)</button> <button class="small" onclick="Game.diploTruce(\''+id+'\')">휴전(300)</button>') +
        (surrenderChance(id)>0?'<button class="small" onclick="Game.diploSurrender(\''+id+'\')">항복 권고(500) '+Math.round(surrenderChance(id)*100)+'%</button>':'')+'</span></div>';
    }).join('');
  showModal('<h3>외교</h3>' +
    '<p class="muted">내 세력 <span class="nums">' + nums(mine) + '</span></p>' +
    '<p class="muted">선물로 관계를 높이고, 관계가 좋으면 동맹이 성사됩니다. 동맹은 12개월, 휴전은 6개월 유지됩니다. 종속 세력은 영토 편입이 가능합니다.</p>' +
    rows + '<div class="foot"><button onclick="Game.closeModal()">닫기</button></div>');
}
function diploGift(id) {
  const f = G.factions[G.pf];
  if (f.gold < 300) { toast('금이 부족합니다'); return; }
  f.gold -= 300;
  f.rel[id] = cl((f.rel[id] || 0) + ri(8, 18), -100, 100);
  G.factions[id].rel[G.pf] = f.rel[id];
  log(G.factions[id].name + '에게 사신과 선물을 보냈습니다. (관계 ' + f.rel[id] + ')', '');
  renderTop(); openDiplo();
}
function diploAlly(id) {
  const f = G.factions[G.pf];
  if(!strategyReady()||!G.factions[id]||hasPeace(G.pf,id))return;
  if (f.gold < 500) { toast('금이 부족합니다'); return; }
  const rel = f.rel[id] || 0;
  const myC = factionCities(G.pf).length, otC = factionCities(id).length;
  const p = cl(0.08 + rel / 180 + (myC >= otC ? 0.10 : 0), 0.05, 0.85);
  f.gold -= 500;
  if (Math.random() < p) {
    makePact(G.pf,id);
    log(G.factions[id].name + '와 동맹을 맺었습니다!', 'good');
  } else {
    f.rel[id] = cl(rel - 5, -100, 100); G.factions[id].rel[G.pf] = f.rel[id];
    log(G.factions[id].name + '가 동맹 제안을 거절했습니다.', 'bad');
  }
  renderAll(); openDiplo();
}
function diploBreak(id) {
  const f = G.factions[G.pf];
  if(!strategyReady()||!G.factions[id]||f.vassalTo===id||G.factions[id].vassalTo===G.pf)return;
  delete f.ally[id]; delete G.factions[id].ally[G.pf];
  delete f.pacts?.[id];delete G.factions[id].pacts?.[G.pf];
  f.rel[id] = cl((f.rel[id] || 0) - 25, -100, 100);
  G.factions[id].rel[G.pf] = f.rel[id];
  log(G.factions[id].name + '와의 동맹을 파기했습니다.', 'bad');
  renderAll(); openDiplo();
}

/* ── 게임 시작 / 재시작 ──────────────────────────────── */
function startNew(fid, scenarioId = chosenScenario) {
  const scenario = scenarioById(scenarioId);
  if (!scenarioCities(scenario).some(c=>c[4]===fid)) { toast('이 시나리오에는 해당 세력이 없습니다'); return; }
  if (typeof CustomOfficers !== 'undefined' && !CustomOfficers.checkNewGame(scenario)) return;
  closeModal();
  setTitleMode(false);
  bgm('map');                          // 세력 운영 — 지도 배경음악
  sfx('success');
  chosenScenario = scenario.id;
  newGame(fid, scenario.id);
  renderAll();
  const cs = factionCities(fid);
  if (cs.length) selectCity(cs[0]);
  toast('새 게임 시작: ' + G.factions[fid].name + ' 세력');
}
function startSpectator(scenarioId = chosenScenario) {
  const scenario = scenarioById(scenarioId);
  if (typeof CustomOfficers !== 'undefined' && !CustomOfficers.checkNewGame(scenario)) return;
  closeModal(); setTitleMode(false); bgm('map'); sfx('success');
  chosenScenario = scenario.id;
  newGame(null, scenario.id);
  G.sel = Object.keys(G.cities)[0];
  renderAll();
  toast('전체 AI 관전을 시작합니다');
  scheduleAutoPlay();
}
function reset() {
  clearAutoPlay(); pausedAI = null; delegationCancelRequested = false; campaignEpoch++;
  stopAttackIntro();
  closeModal();
  G = null;
  hover = null;
  const br = $('battleRoot'); if (br) br.innerHTML = '';
  if ($('cityPanel')) $('cityPanel').innerHTML = '';
  if ($('logPanel')) $('logPanel').innerHTML = '';
  renderTopSafe();
  startScreen();
}
function toTitle() {
  clearAutoPlay(); pausedAI = null; delegationCancelRequested = false; campaignEpoch++;
  stopAttackIntro();
  if (G) G.autoPaused = true;
  closeModal();
  startScreen();
}
function renderTopSafe() {
  if (!$('dateInfo')) return;
  $('dateInfo').textContent = '-';
  const facName = $('facName') || $('facInfo');
  if (facName) facName.textContent = '-';
  const facDot = $('facDot');
  if (facDot) { facDot.style.background = 'transparent'; facDot.style.display = 'none'; }
  if ($('facInfo')) $('facInfo').title = '세력을 선택하세요';
  $('goldInfo').textContent = '0';
  $('foodInfo').textContent = '0';
  $('cmdInfo').textContent = '0';
  $('cityInfo').textContent = '0';
  ['btnSave', 'btnLoad', 'btnOfficers', 'btnDiplo', 'btnPolicies', 'btnEndTurn'].forEach(id => { const el = $(id); if (el) el.disabled = false; });
}

/* ── 턴 종료 → AI 행동 → 월간 정산 ──────────────────── */
function endTurn() {
  if (!G) { toast('먼저 세력을 선택하세요'); return; }
  if (G.autoPaused && (G.fullDelegation || !G.pf)) return;
  if (attackIntro) return;
  if (G.over) return;
  if (G.battleActive) { toast('전투가 진행 중입니다'); return; }
  if (G.aiRunning) { toast('AI 세력이 행동 중입니다'); return; }
  clearAutoPlay();
  const game = G, epoch = campaignEpoch;
  const delegated = !!G.pf && G.fullDelegation;
  if (!delegated && G.pf) runPolicies();
  if (!delegated && G.cmd > 0) log('명령권 ' + G.cmd + '개가 소멸합니다.', '');
  if (delegated) {
    const f = G.factions[G.pf];
    f.commandTurn = G.turn; f.commands = G.cmd;
  }
  G.ui.move = null; G.ui.attack = null; syncMoveHint();
  closeModal();
  G.cmd = 0;
  G.aiRunning = true;
  aiDiplomacy();
  campaignDiplomacy();
  sfx('turn');
  renderTop(); renderCityPanel();
  log(G.pf ? '— ' + G.factions[G.pf].name + (delegated ? ' 세력 전체위임 —' : ' 세력의 명령이 끝났습니다 —') : '— 전체 AI 세력 행동 —', 'sep');
  const ids = Object.keys(G.factions).filter(id => id !== G.pf && factionCities(id).length);
  if (delegated) ids.unshift(G.pf);
  let i = 0;
  const next = () => {
    if (G !== game || campaignEpoch !== epoch) return;
    if (returnDirectControl()) return;
    if (G.over) { G.aiRunning = false; renderTop(); return; }
    if (pauseAI(next)) return;
    if (i >= ids.length) { finishTurn(); return; }
    const fid = ids[i++];
    runFactionAI(fid, () => setTimeout(next, 30));
  };
  next();
}
function finishTurn() {
  G.aiRunning = false;
  monthlyProcess();
  G.month++;
  if (G.month > 12) { G.month = 1; G.year++; }
  G.turn = (G.turn || 0) + 1;
  debutOfficers();                       // 등장 연도가 된 인물을 깨운다
  refreshCmd(true);
  sfx('chime');                          // 새 달 — 종소리
  renderAll();
  saveGame(true);
  victoryCheck();
  toast(G.year + '년 ' + G.month + '월 — 명령권 ' + G.cmd + '개');
  scheduleAutoPlay();
}

/* ── AI 세력 행동 ────────────────────────────────────── */
const AI_RECRUIT_GOLD = 200;         // 징병에 투입하기 시작하는 최소 금
const AI_MOVE_MIN = 500;             // 후방에서 최전선으로 넘길 최소 병력
const AI_REAR_RESERVE = 1500;        // 후방 도시에 남겨 두는 병력

// 최종 양강이 영구 동맹 때문에 멈추지 않게 한다. 반드시 3개월 전에 알린다.
function campaignDiplomacy() {
  if((G.turn||0)<24) return;
  const living=Object.keys(G.factions).filter(fid=>factionCities(fid).length);
  if(living.length!==2) return;
  const partner = G.pf || living[0];
  const rival=living.find(fid=>fid!==partner), f=G.factions[rival];
  if(!f || f.vassalTo===partner || !isAlly(rival,partner)) return;
  if(!f.pactWarning) {
    f.pactWarning={target:partner,until:(G.turn||0)+3};
    log(f.name+'이(가) 천하의 패권을 요구합니다. 3개월 뒤 동맹을 종료하겠다고 통보했습니다.','war');
  } else if((G.turn||0)>=f.pactWarning.until) {
    delete f.ally[partner];delete G.factions[partner].ally[rival];delete f.pactWarning;
    f.rel[partner]=-35;G.factions[partner].rel[rival]=-35;
    log(f.name+'와의 동맹이 예고대로 끝났습니다. 천하를 건 마지막 전선이 열립니다.','war');
  }
}

/* 적과 국경을 맞댄 도시인가 — 인접한 타 세력 도시에 병력이 있으면 최전선 */
function aiFrontline(fid, c) {
  return (c.links || []).some(n => {
    const t = G.cities[n];
    return t && t.owner !== fid && !hasPeace(fid, t.owner);
  });
}
/* 동맹 원군 규모 판단에 쓰는 세력 병력 / 인접 적 병력. */
function aiTroopRatio(fid, cities) {
  const own = {};
  let mine = 0, foe = 0;
  cities.forEach(cn => { const c = G.cities[cn]; if (!c) return; own[cn] = true; mine += c.troops || 0; });
  const seen = {};
  cities.forEach(cn => {
    const c = G.cities[cn]; if (!c) return;
    (c.links || []).forEach(n => {
      const t = G.cities[n];
      if (!t || own[n] || seen[n]) return;
      seen[n] = true;
      if (!hasPeace(fid, t.owner)) foe += t.troops || 0;
    });
  });
  return foe > 0 ? mine / foe : 99;
}
/* 수비 도시의 방어력 — 전투 중 인접 도시에서 올 수 있는 원군까지 포함한다 */
function aiDefensePower(target, opponents=[]) {
  const army=defenseUnits(target.name);
  const base = Math.max(1,army.reduce((s,u)=>s+unitPower(u,army,{cityDef:target.def,opponents}),0)*1.12);
  let extra = 0;
  (target.links || []).forEach(n => {
    const c = G.cities[n];
    if (!c || c.owner !== target.owner || c.name === target.name) return;
    if (c.troops < 1600 || !officersIn(c.name).length) return;
    const help=defenseUnits(n).map(u=>({...u,troops:Math.round(u.troops*Math.min(6000,c.troops*.45)/Math.max(1,c.troops))}));
    extra += help.reduce((s,u)=>s+unitPower(u,help),0);
  });
  return base + Math.min(base * .4, extra * .35); // 실제 파견 상한·행군 지연 반영
}
/* 계획·실행 모두 플레이어와 동일한 장수·단가·숙련·치안 규칙을 쓴다. */
function aiRecruitPlan(c, budget, mode = c.recruited ? 'levy' : 'conscript') {
  const o = pickSorted(c.name, PICK_SCORE.recruit)[0]; if (!o) return null;
  const q = recruitQuote(c, o, mode, budget);
  return q.ok ? { amt: q.amount, cost: q.cost } : null;
}
/* 후방 잉여 병력을 인접 최전선 도시로 집결시킨다 */
function aiMovePlans(fid, cities) {
  const plans = [];
  const fronts = cities.map(cn => G.cities[cn]).filter(c => c && aiFrontline(fid, c));
  if (!fronts.length) return plans;
  // 최전선까지의 아군 도로 거리. 후방 깊숙한 곳에서도 한 달에 한 도시씩 전진한다.
  const distance = {}, queue = fronts.map(c => c.name), projected = {};
  queue.forEach(n => { distance[n] = 0; });
  cities.forEach(n => { projected[n] = G.cities[n].troops; });
  for(let i=0;i<queue.length;i++) G.cities[queue[i]].links.forEach(n => {
    if (G.cities[n].owner === fid && distance[n] === undefined) { distance[n] = distance[queue[i]]+1; queue.push(n); }
  });
  cities.slice().sort((a,b) => (distance[a] || 0)-(distance[b] || 0)).forEach(cn => {
    const src = G.cities[cn];
    if (!src || aiFrontline(fid, src)) return;               // 후방 도시의 잉여분만 보낸다
    const spare = Math.floor(src.troops - AI_REAR_RESERVE);
    if (spare < AI_MOVE_MIN) return;
    const dests = (src.links || []).map(n => G.cities[n]).filter(d =>
      d && d.owner === fid && distance[d.name] < distance[src.name] && projected[d.name] < aiLogisticsCap(fid,d));
    if (!dests.length) return;
    const dst = dests.slice().sort((a, b) => (projected[a.name] / capOf(a)) - (projected[b.name] / capOf(b)))[0];
    const amt = Math.min(spare, Math.max(0, aiLogisticsCap(fid,dst)-projected[dst.name]));
    if (amt < AI_MOVE_MIN) return;
    plans.push({ t: 'move', cn: dst.name, from: src.name, troops: amt });
    projected[src.name]-=amt; projected[dst.name]+=amt;
  });
  // 최전선끼리도 병력 격차가 크면 몰아준다
  const rank = fronts.slice().sort((a, b) => (a.troops / capOf(a)) - (b.troops / capOf(b)));
  const weak = rank[0], strong = rank[rank.length - 1];
  if (weak && strong && weak !== strong && (strong.links || []).includes(weak.name)) {
    const gap = strong.troops / capOf(strong) - weak.troops / capOf(weak);
    const amt = Math.min(Math.floor(strong.troops * 0.3), Math.max(0,aiLogisticsCap(fid,weak)-projected[weak.name]));
    if (gap > 0.35 && strong.troops > 3000 && amt >= AI_MOVE_MIN) {
      plans.push({ t: 'move', cn: weak.name, from: strong.name, troops: amt });
    }
  }
  return plans;
}
function aiLogisticsCap(fid,c) {
  const late=(G.turn||0)>=24 || factionCities(G.pf).length>=12;
  const mobilized=(G.factions[fid].quietMonths||0)>=4 && c.training>=75 && c.def>=65;
  const economy=factionEconomy(fid),food=G.factions[fid].food;
  const supplied=economy.foodNet>=0 || food>=Math.max(economy.foodUpkeep*4,-economy.foodNet*6);
  return Math.floor(capOf(c)*((late||mobilized) && supplied && aiFrontline(fid,c)?2:1));
}

/* 다음 달 적의 출진까지 고려한다. 이번 달 행동 완료 여부로 국경 위협을 지우지 않는다. */
function aiCityThreat(fid,c,exclude) {
  const enemies=c.links.map(n=>G.cities[n]).filter(t=>t.owner!==fid&&!hasPeace(fid,t.owner)&&t.name!==exclude);
  const forces=enemies.map(t=>Math.min(t.troops*.7,Math.max(1,officersIn(t.name).length)*10000)).sort((a,b)=>b-a);
  return {enemies,incoming:(forces[0]||0)+(forces[1]||0)*.25};
}
function aiGarrisonReserve(fid,c,exclude) {
  const threat=aiCityThreat(fid,c,exclude);
  if(!threat.enemies.length)return AI_REAR_RESERVE;
  const fortification=1+Math.max(0,c.def-50)*.006;
  return Math.ceil(Math.max(1800,Math.min(capOf(c)*.35,3500),threat.incoming/fortification));
}

// 준비된 성은 모든 인접 적군을 각각 완벽하게 막으려다 영구 대치하지 않도록 일부 위험을 감수한다.
function aiDepartureReserve(fid,c,exclude) {
  return Math.ceil(Math.max(AI_REAR_RESERVE,c.troops*.3,Math.min(aiGarrisonReserve(fid,c,exclude),c.troops*.55)));
}

function aiRallyPlans(fid,ledger) {
  const f=G.factions[fid];if((f.quietMonths||0)<4)return [];
  const fronts=factionCities(fid).map(n=>G.cities[n]).filter(c=>aiFrontline(fid,c)&&c.def>=65&&c.training>=75&&officersIn(c.name).length>=2);
  const score=c=>{
    const targets=aiCityThreat(fid,c).enemies;
    const weakest=targets.slice().sort((a,b)=>aiDefensePower(a)-aiDefensePower(b))[0];
    return Math.min(aiLogisticsCap(fid,c),c.troops+c.links.filter(n=>G.cities[n].owner===fid).reduce((sum,n)=>sum+G.cities[n].troops*.4,0))-
      (weakest?aiGarrisonReserve(fid,c,weakest.name)*.7+weakest.troops*.25:0);
  };
  const focus=fronts.sort((a,b)=>score(b)-score(a))[0];if(!focus)return [];
  const distance={[focus.name]:0},queue=[focus.name],plans=[];
  for(let i=0;i<queue.length;i++)for(const n of G.cities[queue[i]].links)if(G.cities[n].owner===fid&&distance[n]===undefined){distance[n]=distance[queue[i]]+1;queue.push(n);}
  for(const src of factionCities(fid).map(n=>G.cities[n]).filter(c=>distance[c.name]>0&&c.training>=70&&c.morale>=70)) {
    if(aiFrontline(fid,src)&&officersIn(src.name).length<2)continue;
    if(ledger['move:'+src.name]||ledger['attack:'+src.name]||ledger['support:'+src.name]||!availableOfficers(src.name).length)continue;
    const dst=src.links.map(n=>G.cities[n]).filter(c=>c.owner===fid&&distance[c.name]<distance[src.name]&&c.troops<aiLogisticsCap(fid,c)).sort((a,b)=>a.troops/aiLogisticsCap(fid,a)-b.troops/aiLogisticsCap(fid,b))[0];
    if(!dst)continue;
    const amount=Math.min(aiLogisticsCap(fid,dst)-dst.troops,Math.max(0,src.troops-aiDepartureReserve(fid,src)));
    if(amount<AI_MOVE_MIN)continue;
    plans.push({t:'move',cn:dst.name,from:src.name,troops:amount,safe:true,rally:true,score:130+Math.min(15,(f.quietMonths||0))-Math.min(12,distance[src.name]*3)});
  }
  return plans;
}

function aiAttackPlan(fid,c,pressure,ledger) {
  if(!availableOfficers(c.name).length||c.troops<2800)return null;
  const f=G.factions[fid],economy=factionEconomy(fid);
  if(c.training<70||c.morale<70||c.def<60)return null;
  const targets=c.links.map(n=>G.cities[n]).filter(t=>t.owner!==fid&&!hasPeace(fid,t.owner)&&
    !(t.owner===G.pf&&!automatedFaction(t.owner)&&(G.turn||0)<GRACE_TURNS));
  const priority=t=>t.name===f.warTarget?.city&&f.warTarget.until>G.turn;
  const plans=[];
  for(const target of targets) {
    const reserve=aiDepartureReserve(fid,c,target.name);
    const commit=Math.min(Math.floor(c.troops*.7),Math.max(0,c.troops-reserve));
    if(commit<1000)continue;
    const army=aiUnits(c.name,commit,{guard:true});if(!army.length)continue;
    const defenders=defenseUnits(target.name),power=us=>us.reduce((s,u)=>s+unitPower(u,us,{opponents:defenders}),0);
    const myP=power(army),defP=aiDefensePower(target,army),threshold=1.02+target.def/500-pressure*.22;
    const extra=[];
    if(myP<=defP*threshold&&(G.turn||0)>=12)for(const src of target.links.map(n=>G.cities[n]).filter(src=>
      src.owner===fid&&src.name!==c.name&&src.training>=70&&src.morale>=70&&src.def>=60&&!(ledger['attack:'+src.name]||ledger['support:'+src.name]))) {
      const spare=Math.min(Math.floor(src.troops*.4),Math.max(0,src.troops-Math.max(src.troops*.35,aiDepartureReserve(fid,src,target.name))));
      const units=aiUnits(src.name,spare,{guard:true,limit:2});
      const amount=units.reduce((s,u)=>s+u.troops,0);
      if(amount>=500)extra.push({from:src.name,troops:amount,power:power(units)*.8});
      if(extra.length>=2)break;
    }
    const ratio=(myP+extra.reduce((s,e)=>s+e.power,0))/Math.max(1,defP);
    const total=army.reduce((s,u)=>s+u.troops,0)+extra.reduce((s,e)=>s+e.troops,0);
    const supply=Math.ceil(total*12/600*expeditionRate({atk:fid,to:target.name},'atk'));
    if(ratio<=threshold || f.food<Math.max(0,-economy.foodNet)+supply)continue;
    plans.push({t:'attack',cn:c.name,target:target.name,troops:army.reduce((s,u)=>s+u.troops,0),extra,safe:true,
      score:100+pressure*15+Math.min(35,(ratio-threshold)*35)+(priority(target)?12:0)});
  }
  return plans.sort((a,b)=>b.score-a.score)[0]||null;
}

/* 명령 하나가 끝날 때마다 새 상태로 후보를 평가한다. 보급·국경 복구를 먼저 하고 성장·출진을 고른다. */
function aiActionCandidates(fid,ledger={}) {
  const cities=factionCities(fid),f=G.factions[fid],economy=factionEconomy(fid),acts=[];
  if(!cities.length)return acts;
  const budget=Math.max(0,f.gold-Math.max(economy.goldUpkeep,120));
  const foodStress=economy.foodNet<0&&f.food<Math.max(economy.foodUpkeep*3,-economy.foodNet*6);
  const foodNeed=Math.max(economy.foodUpkeep*2,Math.max(0,-economy.foodNet)*4);
  const add=a=>{const source=a.t==='move'?a.from:a.cn;a.score-=(ledger['city:'+source]||0)*12+(ledger[a.t+':'+source]||0)*16;acts.push(a);};
  if(f.food<foodNeed&&(ledger.buy||0)<2) {
    const cost=Math.min(600,Math.ceil((foodNeed-f.food)/FOOD_BUY_RATE),Math.max(0,f.gold-economy.goldUpkeep));
    if(cost>=50)add({t:'buy',cn:cities[0],cost,score:f.food+economy.foodNet<0?220:foodStress?145:75});
  }
  const late=(G.turn||0)>=24||factionCities(G.pf).length>=12,pressure=Math.max(late?.65:0,Math.min(1,Math.max(0,(f.quietMonths||0)-3)/9));
  for(const cn of cities) {
    const c=G.cities[cn],available=availableOfficers(cn),threat=aiCityThreat(fid,c),front=threat.enemies.length>0;
    if(!officersIn(cn).length) {
      const donor=c.links.map(n=>G.cities[n]).find(src=>src.owner===fid&&availableOfficers(src.name).length>1);
      if(donor)add({t:'relocate',cn,from:donor.name,score:195});
    }
    if(!available.length)continue;
    const reserve=aiGarrisonReserve(fid,c),critical=front&&c.troops<reserve*.55;
    const develop=(stat,score)=>{const admin=pickSorted(cn,o=>adminScore(o,stat))[0];const q=adminQuote(c,stat,[admin.name]);if(q.ok&&q.cost<=budget)add({t:'admin',cn,stat,score});};
    if(c.order<65)develop('order',c.order<45?180:c.order<55?130:85);
    const defenseTarget=front?(threat.incoming>c.troops?90:75):40;
    if(c.def<defenseTarget)develop('def',front?(c.def<50?165:c.def<65?125:85)+(defenseTarget-c.def)*.15:45);
    if(c.agri<100&&(foodStress||economy.foodNet<cities.length*12))develop('agri',foodStress?155:55+(100-c.agri)*.2);
    if(c.comm<100&&economy.goldNet<cities.length*65)develop('comm',economy.goldNet<cities.length*25?135:70+(100-c.comm)*.2);
    const trainTarget=front?(late?90:85):70,moraleTarget=front?85:75;
    if(c.training<trainTarget||c.morale<moraleTarget) {
      const deficit=Math.max(trainTarget-c.training,moraleTarget-c.morale);
      add({t:'train',cn,score:(front?95:40)+deficit*.7+(front&&(c.training<60||c.morale<55)?30:0)});
    }
    const target=front?Math.min(capOf(c)*.95,Math.max(capOf(c)*.8,reserve)):capOf(c)*.3;
    if(c.troops<target&&budget>=AI_RECRUIT_GOLD&&(!foodStress||critical)) {
      const quality=front&&c.training>=80&&threat.incoming>=c.troops*.65&&budget>=600;
      const mode=c.recruited||quality?'levy':'conscript';
      const quote=recruitQuote(c,pickSorted(cn,PICK_SCORE.recruit)[0],mode,Math.min(budget,600));
      const amount=Math.min(quote.amount,Math.ceil(target-c.troops));
      if(quote.ok&&amount>=Math.min(200,capOf(c)-c.troops))add({t:'recruit',cn,amt:amount,mode,
        score:critical?185:front?(c.troops<reserve?130:75):30});
    }
    if(!(ledger['attack:'+cn]||ledger['support:'+cn])) {const attack=aiAttackPlan(fid,c,pressure,ledger);if(attack)add(attack);}
    const free=G.officers.filter(o=>o.city===cn&&((o.faction==='free'&&o.status==='active')||o.status==='pow'));
    if(free.length&&!(ledger['hr:'+cn])&&budget>=300) {
      const candidate=free.sort((a,b)=>PICK_SCORE.attack(b)-PICK_SCORE.attack(a))[0];
      add({t:'hr',cn,name:candidate.name,score:officersIn(cn).length<2?120:35});
    }
    const low=officersIn(cn).filter(o=>!isLeader(o.name)&&o.loyalty<55).sort((a,b)=>a.loyalty-b.loyalty)[0];
    if(low&&budget>=REWARD_COST)add({t:'reward',cn,name:low.name,score:low.loyalty<40?150:40});
    if(c.order>=65&&!foodStress&&economy.goldNet>=cities.length*65) {
      if(c.agri<90)develop('agri',35+(90-c.agri)*.2);
      if(c.comm<90)develop('comm',35+(90-c.comm)*.2);
    }
  }
  for(const move of aiMovePlans(fid,cities)) {
    const src=G.cities[move.from],dst=G.cities[move.cn];
    if(aiFrontline(fid,src)&&officersIn(src.name).length<2)continue;
    if(ledger['move:'+src.name]||ledger['attack:'+src.name]||ledger['support:'+src.name]||!availableOfficers(src.name).length)continue;
    const reserve=aiGarrisonReserve(fid,src),spare=Math.max(0,src.troops-reserve);
    const troops=Math.min(move.troops,spare);if(troops<AI_MOVE_MIN)continue;
    const deficit=aiGarrisonReserve(fid,dst)-dst.troops;
    add({...move,troops,safe:true,score:aiFrontline(fid,dst)?(deficit>dst.troops?175:deficit>0?135:100+pressure*10):65});
  }
  for(const rally of aiRallyPlans(fid,ledger))add(rally);
  return acts.sort((a,b)=>b.score-a.score||a.cn.localeCompare(b.cn)||a.t.localeCompare(b.t));
}

function runFactionAI(fid, done) {
  if (!G || G.over || !G.factions[fid] || !factionCities(fid).length) { done(); return; }
  const game=G,epoch=campaignEpoch,f=G.factions[fid],ledger={},blocked=new Set();
  f.quietMonths=(f.quietMonths||0)+1;
  let attempts=0;
  const limit=(factionCities(fid).length+2)*4+10;
  const key=a=>[a.t,a.cn,a.stat||a.target||a.from||a.name||''].join(':');
  const step=()=>{
    if(G!==game||campaignEpoch!==epoch)return;
    if(returnDirectControl())return;
    if(G.over){done();return;}
    if(pauseAI(step))return;
    if(aiCommands(fid)<=0||attempts++>=limit){done();return;}
    const action=aiActionCandidates(fid,ledger).find(a=>!blocked.has(key(a)));
    if(!action){done();return;}
    const before=f.commands;
    execAIAct(fid,action,()=>{
      if(f.commands<before) {
        const source=action.t==='move'?action.from:action.cn;
        ledger['city:'+source]=(ledger['city:'+source]||0)+1;
        ledger[action.t+':'+source]=(ledger[action.t+':'+source]||0)+1;
        if(action.t==='buy')ledger.buy=(ledger.buy||0)+1;
        if(action.t==='attack')for(const e of action.extra||[])ledger['support:'+e.from]=1;
        blocked.clear();
      } else blocked.add(key(action));
      setTimeout(step,0);
    });
  };
  step();
}

function aiUnits(cn, troops, options={}) {
  const c = G.cities[cn];
  const officers=officersIn(cn);
  const guards=officers.filter(o=>o.wu>=55||o.zhi>=65);
  const guard=options.guard&&officers.length>1?(guards.length?guards:officers).slice().sort((a,b)=>PICK_SCORE.attack(a)-PICK_SCORE.attack(b))[0]:null;
  const list = availableOfficers(cn).filter(o=>o!==guard).sort((a,b)=>PICK_SCORE.attack(b)-PICK_SCORE.attack(a)).slice(0,options.limit||5);
  const total = Math.min(list.length*10000,Math.max(0, Math.round(troops)));
  if (!list.length) return [];
  const counts = distribute(total, list.length);
  return list.map((o, i) => ({
    officer: o, troops: counts[i], branch: autoBranch(o), training: c.training, morale: c.morale,
    form: defaultForm(autoBranch(o))
  }));
}

function execAIAct(fid, a, cb) {
  if (!G || G.over) { cb(); return; }
  const f = G.factions[fid];
  if(f.commandTurn!==G.turn) {f.commandTurn=G.turn;f.commands=factionCities(fid).length+2;}
  if(f.commands<=0) {cb();return;}
  const spend=()=>{f.commands--;};
  const c = G.cities[a.cn];
  if (a.t === 'reward') {
    const o = off(a.name);
    if (o && o.faction === fid && o.loyalty < 100 && f.gold >= REWARD_COST) {
      spend();f.gold -= REWARD_COST;
      o.loyalty = cl(o.loyalty + ri(8, 15), 0, 100);
    }
    cb(); return;
  }
  if (!c || c.owner !== fid) { cb(); return; }
  if(a.t==='buy') {if(a.cost>0&&f.gold>=a.cost) {spend();buyFood(f,a.cost);}cb();return;}
  if(a.t==='relocate') {const src=G.cities[a.from];const o=src&&src.owner===fid&&src.links.includes(c.name)&&availableOfficers(src.name).length>1?availableOfficers(src.name).find(o=>!isLeader(o.name)):null;if(o){spend();o.city=c.name;o.used=true;}cb();return;}
  if (a.t === 'admin') {
    const o = pickSorted(c.name,o=>adminScore(o,a.stat))[0];
    if (o && ADMIN_LABEL[a.stat]) {
      const quote = adminQuote(c,a.stat,[o.name]);
      if (quote.ok) {spend();applyAdmin(c,a.stat,[o.name],quote);}
    }
    cb(); return;
  }
  if (a.t === 'train') {
    const o = pickSorted(c.name,PICK_SCORE.train)[0];
    if (o && (c.training<100 || c.morale<100)) {spend();applyTraining(c,[o.name]);}
    cb(); return;
  }
  if (a.t === 'recruit') {
    // 징병은 도시당 한 달 한 번, 이후 충원은 모병(두 배 비용)으로 처리한다
    const mode = c.recruited || a.mode==='levy' ? 'levy' : 'conscript';
    const o = pickSorted(c.name,PICK_SCORE.recruit)[0];
    if (o) {
      const budget = a.amt ? Math.min(f.gold,Math.ceil(a.amt*(mode==='levy'?LEVY_COST:RECRUIT_COST)-1e-9)) : f.gold;
      const quote = recruitQuote(c,o,mode,budget);
      if (quote.ok) {spend();applyRecruit(c,o,mode,quote);}
    }
    cb(); return;
  }
  if (a.t === 'move') {
    // 후방 도시의 잉여 병력(과 무장)을 최전선 도시로 옮긴다
    const src = G.cities[a.from];
    if (!src || src.owner !== fid) { cb(); return; }
    if (!src.links.includes(c.name)) { cb(); return; }
    const reserve=a.safe?(a.rally?aiDepartureReserve(fid,src):aiGarrisonReserve(fid,src)):AI_REAR_RESERVE;
    const amt = Math.min(Math.round(a.troops || 0), Math.max(0,src.troops-reserve), Math.max(0,aiLogisticsCap(fid,c)-c.troops));
    const movers=availableOfficers(src.name).sort((x,y)=>y.wu-x.wu);
    // 최전선에는 수비 지휘관을 남긴다. 후방의 마지막 무장은 수송 후 다음 달 재배치할 수 있다.
    const keep=a.safe&&aiFrontline(fid,src)?1:0;
    const spare=a.safe?Math.min(2,movers.length,Math.max(0,officersIn(src.name).length-keep)):Math.min(2,Math.max(1,movers.length-1));
    if(amt<=0||spare<=0){cb();return;}
    spend();
    addGarrison(c,amt,src.training,src.morale);src.troops-=amt;
    movers.slice(0, spare).forEach(o => { o.city = c.name; o.used=true; });
    cb(); return;
  }
  if (a.t === 'hr') {
    const o = off(a.name);
    const valid = o && o.city === a.cn && ((o.faction === 'free' && o.status === 'active') || o.status === 'pow');
    if (!valid) { cb(); return; }
    const best=bestAvailable(a.cn);if(!best){cb();return;}
    const p=hireChance(a.cn,o,best);spend();best.used=true;
    if (Math.random() < p) {
      const playerLoss = !!G.pf && o.faction === G.pf && fid !== G.pf;
      o.faction = fid; o.status = 'active'; o.loyalty = ri(HIRED_LOYALTY_MIN, HIRED_LOYALTY_MAX); o.captivityMonths = 0;
      log(f.name + '이(가) ' + (playerLoss ? '아군 무장 ' : '') + o.name + '을(를) 등용했습니다.', playerLoss ? 'bad' : '');
    }
    cb(); return;
  }
  if (a.t === 'attack') {
    const t = G.cities[a.target];
    if (!t || t.owner === fid || hasPeace(fid, t.owner) || !c.links.includes(a.target)) { cb(); return; }
    if (t.owner === G.pf && !automatedFaction(t.owner) && (G.turn || 0) < GRACE_TURNS) { cb(); return; }
    const reserve=a.safe?aiDepartureReserve(fid,c,t.name):0;
    const commit = Math.min(a.troops || c.troops, Math.max(0,c.troops-reserve));
    const atkUnits = aiUnits(a.cn, commit,{guard:!!a.safe});
    const committed = atkUnits.reduce((s, u) => s + u.troops, 0);
    if (committed < 100) { cb(); return; }
    spend();markUsed(atkUnits.map(u=>u.officer?.name));
    f.quietMonths = 0;
    c.troops -= committed;
    const ctx = { atk: fid, def: t.owner, from: a.cn, to: a.target, home:{}, extra:[] };
    (a.extra||[]).forEach(e=>{
      const src=G.cities[e.from];
      if(!src || src.owner!==fid || !t.links.includes(src.name) || src.name===a.cn) return;
      const reserve=a.safe?Math.max(src.troops*.35,aiDepartureReserve(fid,src,t.name)):AI_REAR_RESERVE;
      const amount=Math.min(e.troops,Math.max(0,src.troops-reserve),Math.min(2,availableOfficers(src.name).length)*10000);
      if(amount<500 || !availableOfficers(src.name).length) return;
      const units=aiUnits(src.name,amount,{guard:!!a.safe,limit:2});if(!units.length)return;
      const actual=units.reduce((s,u)=>s+u.troops,0),counts=distribute(actual,units.length);
      units.forEach((u,i)=>{u.troops=counts[i];if(u.officer)ctx.home[u.officer.name]=src.name;});
      markUsed(units.map(u=>u.officer?.name));src.troops-=actual;ctx.extra.push({from:src.name,units});
    });
    if (t.owner === G.pf && !automatedFaction(t.owner)) {
      // 플레이어와의 전투 → 수비 편성 창을 띄운 뒤 전술 화면(플레이어가 수비)
      ctx.after = cb;
      log('⚔ ' + f.name + '군이 ' + t.name + '으로 출진했습니다!', 'war');
      openDefenseDeploy(ctx, atkUnits);
    } else {
      const units = atkUnits.concat(ctx.extra.flatMap(e=>e.units));
      ctx.siege=!aiFieldDefense(t,units);
      const defenders=prepareFieldDefense(ctx,defenseUnits(a.target));
      playAttackIntro(ctx, () => {
        // 수비 병력이 없는 성 — 전투 없이 자동 후퇴
        // 자동 후퇴 결과는 내부에서 합동 부대를 따로 더하므로 본대만 넘긴다 (병력 중복 합산 방지)
        if (!resolveAutoRetreat(ctx, atkUnits)) {
          let result=autoResolve(ctx,units,defenders,ctx.siege);
          if(!ctx.siege&&result.winner==='attacker') {
            const survivors=siegeSurvivors(ctx,result,units,defenders);
            result=autoResolve(ctx,survivors.atk,survivors.def,true);
          }
          finishBattle(ctx,result);
        }
        setTimeout(cb, 0);
      },ctx.siege===false);
    }
    return;
  }
  cb();
}

/* ── 시기별 무장 등장 ────────────────────────────────────
   등장 연도가 된 'hidden' 무장을 깨운다. 등장 도시를 합류 세력이
   지배하고 있으면 그 세력에 들어가고, 아니면 재야로 남는다. */
function debutOfficers() {
  if (!G || G.over) return;
  const year = G.year;
  G.officers.forEach(o => {
    if (o.status !== 'hidden') return;
    if ((o.debut || SCENARIO.year) > year) return;
    const c = G.cities[o.city];
    const host = (o.join && c && c.owner === o.join && G.factions[o.join]) ? o.join : '';
    o.status = 'active';
    o.used = false;
    if (host) {
      o.faction = host;
      o.loyalty = isLeader(o.name) ? 100 : ri(80, 95);
      log(o.name + '이(가) ' + G.factions[host].name + ' 세력에 합류했습니다. (' + o.city + ')', 'good');
    } else {
      o.faction = 'free';
      o.loyalty = 0;
      const big = (o.wu + o.zhi + o.pol + o.cha) >= 340;
      log(o.name + '이(가) ' + o.city + '에서 이름을 드러냈습니다.' + (big ? ' — 재야의 인재' : ''), big ? 'good' : '');
    }
  });
}

/* ── 월간 정산 ───────────────────────────────────────── */
function applyLoyaltyChange(o, delta) {
  // 정수 충성도를 유지하면서 의리 100이면 감소 시도의 80%를 막는다.
  if (delta < 0 && Math.random() < officerHonor(o) * 0.008) return;
  o.loyalty = cl(o.loyalty + delta, 0, 100);
}
function monthlyProcess() {
  Object.keys(G.factions).forEach(fid => {
    const cs = factionCities(fid);
    if (!cs.length) return;
    const f = G.factions[fid];
    let gold = 0, food = 0, upkeep = 0, wages = 0;
    cs.forEach(cn => {
      const c = G.cities[cn];
      gold += cityGoldIncome(c);
      food += cityFoodIncome(c);
      upkeep += cityFoodUpkeep(c);
      wages += cityGoldUpkeep(c);
      if (c.order < 100 && Math.random() < 0.40) c.order = cl(c.order + 1, 0, 100);
      if (Math.random() < 0.12) c.order = cl(c.order - 1, 0, 100);
      if (c.order >= 70 && Math.random() < 0.20) c.pop = Math.round((c.pop + 0.05) * 100) / 100;
      if (c.morale < 100 && Math.random() < 0.7) c.morale = cl(c.morale + 1, 0, 100);
    });
    const goldNet = gold - wages;
    f.gold += goldNet;
    const net = food - upkeep;
    f.food += net;
    if (fid === G.pf) log('월간 정산: 금 ' + signed(goldNet) + ' (수입 ' + gold + '·급료 ' + wages +
      ') · 군량 ' + signed(net) + ' (생산 ' + food + '·소비 ' + upkeep + ')', '');
    if (f.gold < 0) {
      const unpaid = Math.min(1,-f.gold/Math.max(1,wages)); f.gold = 0;
      cs.forEach(cn => { const c=G.cities[cn]; c.morale=cl(c.morale-Math.ceil(4*unpaid),20,100); });
      if (fid===G.pf) log('군 급료가 부족해 사기가 하락했습니다. 상업·치안을 개발해 세입을 확보하세요.','bad');
    }
    if (f.food < 0) {
      const shortage = Math.min(1,-f.food/Math.max(1,upkeep));
      f.food = 0;
      cs.forEach(cn => {
        const c = G.cities[cn];
        c.troops = Math.round(c.troops * (1 - .12*shortage));
        c.morale = cl(c.morale - Math.ceil(12*shortage), 20, 100);
      });
      if (fid === G.pf) log('군량이 부족합니다! 미지급 ' + Math.round(shortage*100) +
        '%에 비례해 병력·사기가 감소했습니다. 농업 개발·군량 매입·병력 분산으로 보급을 확보하세요.', 'bad');
    }
  });

  // 무장 충성도 · 이탈 (수장은 충성 100 고정)
  G.officers.forEach(o => {
    if (o.status === 'pow') {
      o.captivityMonths = Math.min(120000, (o.captivityMonths || 0) + 1);
      if (o.loyalty > 0 && Math.random() < 0.35) applyLoyaltyChange(o, -ri(0, 2));
      return;
    }
    if (o.faction === 'free') return;
    if (o.status !== 'active') return;
    if (isLeader(o.name)) { o.loyalty = 100; return; }
    if (o.loyalty < 100 && Math.random() < 0.5) applyLoyaltyChange(o, ri(-1, 1));
    if (o.loyalty < 45 && Math.random() < 0.06) {
      if (o.faction === G.pf) log(o.name + '이(가) 불만을 품고 재야로 떠났습니다. (' + o.city + ')', 'bad');
      o.faction = 'free'; o.loyalty = 0;
    }
  });

  // 관계 자연 회복
  Object.keys(G.factions).forEach(a => {
    const ra = G.factions[a].rel;
    Object.keys(ra).forEach(b => {
      if (ra[b] < 0 && Math.random() < 0.25) ra[b] = Math.min(0, ra[b] + 1);
    });
  });

  monthlyEvents();
}

/* ── 월간 랜덤 이벤트 ────────────────────────────────── */
function monthlyEvents() {
  if (!G || G.over) return;
  const f = G.factions[G.pf];
  const cs = factionCities(G.pf);
  if (!cs.length) return;
  if (Math.random() > 0.30) return;
  const r = ri(1, 5);
  if (r === 1) {
    const add = Math.max(80,Math.round(factionEconomy(G.pf).foodIncome * .75));
    f.food += add;
    log('풍년이 들었습니다! 군량 +' + commas(add), 'good');
  } else if (r === 2) {
    const loss = Math.min(f.food,Math.max(80,Math.round(factionEconomy(G.pf).foodIncome * .75)));
    f.food = Math.max(0, f.food - loss);
    log('흉년이 들었습니다… 군량 -' + commas(loss), 'bad');
  } else if (r === 3) {
    const add = Math.max(60,Math.round(factionEconomy(G.pf).goldIncome*.75));
    f.gold += add;
    log('상인들이 찾아와 금 +' + commas(add) + '을 남기고 갔습니다.', 'good');
  } else if (r === 4) {
    const cn = cs[ri(0, cs.length - 1)];
    const c = G.cities[cn];
    const loss = Math.round(c.troops * 0.10);
    c.troops -= loss;
    c.morale = cl(c.morale - 5, 20, 100);
    log(cn + '에 역병이 돌아 병력 -' + commas(loss), 'bad');
  } else {
    const free = G.officers.filter(o => o.faction === 'free' && o.status === 'active');
    if (free.length) {
      const o = free[ri(0, free.length - 1)];
      o.faction = G.pf;
      o.city = cs[ri(0, cs.length - 1)];
      o.loyalty = ri(HIRED_LOYALTY_MIN, HIRED_LOYALTY_MAX);
      log('인재 ' + o.name + '이(가) 투항해 왔습니다! (' + o.city + ')', 'good');
    }
  }
}

/* ── 승리/패배 판정 ──────────────────────────────────── */
function victoryCheck() {
  if (!G || G.over) return;
  if (!G.pf) {
    const winner = Object.keys(G.factions).find(id => factionCities(id).length === Object.keys(G.cities).length);
    if (!winner) return;
    G.over = true; clearAutoPlay(); sfx('victory'); renderTop();
    showModal('<h2>천하통일!</h2><p style="text-align:center">' + G.year + '년 ' + G.month + '월 — ' + G.factions[winner].name + '이(가) 모든 도시를 통일했습니다!</p><div class="foot"><button class="primary" onclick="Game.reset()">새 게임</button></div>');
    return;
  }
  const mine = factionCities(G.pf).length;
  const total = Object.keys(G.cities).length;
  if (mine === 0) {
    G.over = true;
    sfx('defeat');
    renderTop();
    showModal('<h2>패배</h2>' +
      '<p style="text-align:center">' + G.year + '년 — ' + G.factions[G.pf].name + ' 세력은 역사의 뒤안길로 사라졌습니다.</p>' +
      '<div class="foot"><button class="primary" onclick="Game.reset()">새 게임</button></div>');
    return;
  }
  const objective=objectiveStatus();
  if(objective.failed) {G.over=true;renderTop();sfx('defeat');showModal('<h2>목표 기한 종료</h2><p>'+objective.label+'</p><div class="foot"><button onclick="Game.reset()">새 게임</button></div>');return;}
  if (mine === total || objective.done) {
    G.over = true;
    sfx('victory');
    renderTop();
    const offs = officersOf(G.pf).length;
    showModal('<h2>'+ (mine===total?'천하통일!':'목표 달성!')+'</h2>' +
      '<p style="text-align:center">' + G.year + '년 ' + G.month + '월 — ' + G.factions[G.pf].name +
      '이(가) '+(mine===total?total+'개 도시를 모두 손에 넣고 천하를 통일했습니다!':objective.label+' 목표를 달성했습니다!')+'</p>' +
      '<p class="muted" style="text-align:center">재야를 포함한 휘하 무장 ' + offs + '명 · 금 ' + commas(G.factions[G.pf].gold) + '</p>' +
      '<div class="foot"><button class="primary" onclick="Game.reset()">새 게임</button></div>');
  }
}

/* ── 무장 일람 ───────────────────────────────────────── */
/* 무장 일람 정렬 — 보기(내 무장/전체)별로 선택 상태를 따로 기억한다 */
let offAllView = false;
const OFF_SORTS = { all: { key: 'faction', dir: 1 }, mine: { key: 'city', dir: 1 } };
const OFF_KEYS = {
  name: { label: '이름', text: true, get: o => o.name },
  faction: { label: '소속', text: true, get: o => (G.factions[o.faction] ? G.factions[o.faction].name : '재야') },
  city: { label: '도시', text: true, get: o => o.city },
  wu: { label: '무력', get: o => o.wu },
  zhi: { label: '지력', get: o => o.zhi },
  pol: { label: '정치', get: o => o.pol },
  cha: { label: '매력', get: o => o.cha },
  tot: { label: '합계', get: o => o.wu + o.zhi + o.pol + o.cha },
  loyalty: { label: '충성', get: o => o.loyalty },
  skill: { label: '특기', text: true, get: o => o.skill || '' }
};
function officerSortKeys(all) {
  return all ? ['faction', 'name', 'city', 'wu', 'zhi', 'pol', 'cha', 'tot', 'skill']
             : ['name', 'city', 'wu', 'zhi', 'pol', 'cha', 'tot', 'loyalty', 'skill'];
}
function sortOfficers(list, all) {
  const st = OFF_SORTS[all ? 'all' : 'mine'];
  const spec = OFF_KEYS[st.key] || OFF_KEYS.city;
  const rank = {};
  const order = (G && G.factions) ? Object.keys(G.factions) : FACTIONS.map(f => f[0]);
  order.forEach((fid, i) => { rank[fid] = i; });
  rank[G.pf] = -1;                                 // 내 세력은 항상 위
  const tie = o => (rank[o.faction] === undefined ? 900 : rank[o.faction]);
  return list.slice().sort((a, b) => {
    const va = spec.get(a), vb = spec.get(b);
    const d = spec.text ? String(va).localeCompare(String(vb)) : (va - vb);
    if (d) return d * st.dir;
    // 동률: 소속 순 → 능력치 합 → 이름
    return (tie(a) - tie(b)) ||
      ((b.wu + b.zhi + b.pol + b.cha) - (a.wu + a.zhi + a.pol + a.cha)) ||
      a.name.localeCompare(b.name);
  });
}
function officerSortBar(all) {
  return '<div class="sortbar"><span class="lb">정렬</span>' + officerSortKeys(all).map(k =>
    '<button class="small" data-ok="' + k + '" onclick="Game.officerSort(\'' + k + '\')">' +
      OFF_KEYS[k].label + '<i class="ar"></i></button>').join('') + '</div>';
}
/* 정렬 바는 새로 그리지 않고 활성 표시만 갱신 — 버튼 깜박임 방지 */
function refreshSortBar(all) {
  const st = OFF_SORTS[all ? 'all' : 'mine'];
  const bar = $('offSort'); if (!bar) return;
  bar.querySelectorAll('button[data-ok]').forEach(b => {
    const on = b.getAttribute('data-ok') === st.key;
    b.classList.toggle('on', on);
    const ar = b.querySelector('.ar');
    if (ar) ar.textContent = on ? (st.dir > 0 ? '▲' : '▼') : '';
  });
}
function officerSort(key) {
  if (!OFF_KEYS[key]) return;
  const all = offAllView;
  const st = OFF_SORTS[all ? 'all' : 'mine'];
  if (st.key === key) st.dir = -st.dir;          // 같은 열을 다시 누르면 오름/내림 전환
  else { st.key = key; st.dir = OFF_KEYS[key].text ? 1 : -1; }
  const body = $('offBody');
  if (!body) { openOfficers(all); return; }      // 모달이 닫혀 있으면 새로 연다
  body.innerHTML = officerBodyHtml(all);         // 표만 교체 (모달 재생성·애니메이션 없음)
  refreshSortBar(all);
}
// 재야·포로·소속 무장의 현재 상태 표시용
function officerState(o) {
  if (o.status === 'pow') return ['포로', 'var(--bad)'];
  if (o.status === 'hidden') return ['미등장', 'var(--muted)'];
  if (o.faction === 'free') return ['재야', 'var(--gold)'];
  return ['활동', 'var(--muted)'];
}
/* 아직 등장하지 않은 무장은 목록·집계에서 제외한다 */
function visibleOfficers() { return G.officers.filter(o => o.status === 'active' || o.status === 'pow'); }
// 모달 본문(표)만 다시 그린다 — 정렬할 때 모달을 재생성하지 않아 깜박임이 없다
function officerBodyHtml(all) {
  if (all) {
    const allList = sortOfficers(visibleOfficers(), true);
    const rows = allList.map(o => {
      const f = G.factions[o.faction], st = officerState(o);
      return '<tr' + portraitAttr(o.name) + '><td class="officer-name">' + portraitHtml(o.name, 22) + o.name + (isLeader(o.name) ? ' ★' : '') + '</td>' +
        '<td>' + (f ? '<i class="fdot" style="background:' + f.color + '"></i>' + f.name : '재야') + '</td>' +
        '<td class="officer-city">' + o.city + '</td><td>' + o.wu + '</td><td>' + o.zhi + '</td><td>' + o.pol + '</td><td>' + o.cha + '</td>' +
        '<td><b>' + (o.wu + o.zhi + o.pol + o.cha) + '</b></td><td>' + (o.skill || '-') + (CombatRules.description(o)?'<br><span class="muted">'+CombatRules.description(o)+'</span>':'') + '</td>' +
        '<td style="color:' + st[1] + '">' + st[0] + '</td></tr>';
    }).join('');
    const vis = visibleOfficers();
    const freeN = vis.filter(o => o.faction === 'free').length;
    const powN = vis.filter(o => o.status === 'pow').length;
    return '<p class="muted" style="margin:0 0 8px">소속 ' + (allList.length - freeN - powN) + ' · 재야 ' + freeN + ' · 포로 ' + powN +
      ' — 위 정렬 버튼으로 열을 바꿀 수 있습니다. [등용]으로 현재 도시의 재야·포로와 인접 도시의 재야·적 무장(군주 제외)을 설득합니다.</p>' +
      '<div class="officer-table-scroll" role="region" aria-label="전체 무장 목록 · 좌우로 스크롤" tabindex="0"><table class="officer-table"><tr><th>이름</th><th>소속</th><th>도시</th><th>무력</th><th>지력</th><th>정치</th><th>매력</th><th>합계</th><th>특기</th><th>상태</th></tr>' +
      rows + '</table></div>';
  }
  const list = sortOfficers(officersOf(G.pf), false);
  const rows = list.map(o => '<tr' + portraitAttr(o.name) + '><td class="officer-name">' + portraitHtml(o.name, 22) + o.name + (isLeader(o.name) ? ' ★' : '') + '</td><td class="officer-city">' + o.city + '</td><td>' + o.wu + '</td><td>' + o.zhi +
    '</td><td>' + o.pol + '</td><td>' + o.cha + '</td><td>' + (o.skill || '-') + (CombatRules.description(o)?'<br><span class="muted">'+CombatRules.description(o)+'</span>':'') + '</td>' +
    '<td style="color:' + (o.loyalty < 45 ? 'var(--bad)' : (o.loyalty >= 80 ? 'var(--good)' : 'inherit')) + '">' + o.loyalty + '</td>' +
    '<td>' + (o.used ? '<span style="color:var(--muted)">완료</span>' : '<span style="color:var(--good)">가능</span>') + '</td></tr>').join('');
  const myCities = factionCities(G.pf);
  const pows = G.officers.filter(o => o.status === 'pow' && myCities.indexOf(o.city) >= 0);
  let ph = '';
  if (pows.length) {
    ph = '<h3 style="margin-top:12px">포로 (' + pows.length + '명)</h3>' +
      '<div class="officer-table-scroll" role="region" aria-label="포로 목록 · 좌우로 스크롤" tabindex="0"><table class="officer-table"><tr><th>이름</th><th>도시</th><th>원소속</th><th>무력</th><th>지력</th><th>특기</th></tr>' +
      pows.map(o => '<tr' + portraitAttr(o.name) + '><td class="officer-name">' + portraitHtml(o.name, 22) + o.name + '</td><td class="officer-city">' + o.city + '</td><td>' +
        (G.factions[o.faction] ? G.factions[o.faction].name : '재야') + '</td><td>' + o.wu + '</td><td>' + o.zhi +
        '</td><td>' + (o.skill || '-') + '</td></tr>').join('') + '</table></div>';
  }
  return '<div class="officer-table-scroll" role="region" aria-label="내 무장 목록 · 좌우로 스크롤" tabindex="0"><table class="officer-table"><tr><th>이름</th><th>도시</th><th>무력</th><th>지력</th><th>정치</th><th>매력</th><th>특기</th><th>충성</th><th>행동</th></tr>' +
    rows + '</table></div>' + ph +
    '<p class="muted" style="margin-top:8px">★ = 세력 수장 (충성 100, 포로·배신 불가) · 포로는 해당 도시에서 [등용]으로 설득할 수 있습니다.<br>행동이 "완료"인 무장은 그 달 다른 명령에 참여할 수 없습니다. (포상·외교 제외) 정렬 버튼으로 열을 바꿀 수 있습니다.</p>';
}
function officerTitleText(all) {
  return all ? '무장 일람 — 전체 ' + visibleOfficers().length + '명'
             : '무장 일람 — ' + G.factions[G.pf].name + ' (' + officersOf(G.pf).length + '명)';
}
function officerSegHtml(all) {
  return '<div class="segbar">' +
    '<button class="small' + (all ? '' : ' on') + '" onclick="Game.openOfficers(false)">내 무장 · ' + officersOf(G.pf).length + '명</button>' +
    '<button class="small' + (all ? ' on' : '') + '" onclick="Game.openOfficers(true)">전체 무장 · ' + visibleOfficers().length + '명</button>' +
  '</div>';
}
/* 모달이 이미 열려 있으면 필요한 부분만 교체 — 재생성/애니메이션 없음(깜박임 방지) */
function refreshOfficers() {
  const t = $('offTitle'), s = $('offSeg'), b = $('offSort'), d = $('offBody');
  if (!t || !s || !b || !d) return false;
  t.textContent = officerTitleText(offAllView);
  s.innerHTML = officerSegHtml(offAllView);
  b.innerHTML = officerSortBar(offAllView);
  d.innerHTML = officerBodyHtml(offAllView);
  refreshSortBar(offAllView);
  return true;
}
function openOfficers(all) {
  if (G && !G.pf) all = true;
  if (!G) { toast('먼저 세력을 선택하세요'); return; }
  offAllView = !!all;                              // 정렬 버튼이 현재 보기를 알 수 있게
  if (refreshOfficers()) return;                   // 이미 열려 있으면 제자리 갱신만
  showModal('<h3 id="offTitle">' + officerTitleText(offAllView) + '</h3>' +
    '<div id="offSeg">' + officerSegHtml(offAllView) + '</div>' +
    '<div id="offSort">' + officerSortBar(offAllView) + '</div>' +
    '<div id="offBody">' + officerBodyHtml(offAllView) + '</div>' +
    '<div class="foot"><button onclick="Game.closeModal()">닫기</button></div>');
  refreshSortBar(offAllView);
}

/* ── 도움말 ──────────────────────────────────────────── */
function openHelp() {
  showModal('<h3>게임 방법 — 삼국지 : 천하통일</h3>' +
    '<p><b>신무장</b> : 시작 화면이나 상단 [신무장]에서 이름·능력치·의리·특기·전투 속성·사진·도시와 군주 교체를 설정합니다. 무쌍·인덕 등 특기 20종 중 1개와 비장·신산 등 전투 속성 16종 중 1개를 함께 선택할 수 있습니다. 등록부는 모든 새 게임에 반영됩니다. 진행 중인 게임에는 [배치]로 적용하고 게임도 저장하세요. 신무장 JSON과 전체 게임 저장 JSON에 선택한 특기·전투 속성이 유지됩니다.</p>' +
    '<p><b>파일 이전</b> : [저장]의 JSON 내보내기, [불러오기]의 JSON 가져오기를 이용합니다. 파일을 검사한 뒤 미리보기에서 [이어 하기]로 적용합니다.</p>' +
    '<p><b>목표</b> : 기본 목표는 모든 도시 점령입니다. 새 게임 첫 명령 전 [위임·목표] → [승리 목표]에서 패권·24개월 도전·시나리오 목표도 선택할 수 있습니다.</p>' +
    '<p><b>야전과 공성</b> : 출진 편성의 [공략 방식]에서 야전 선행 / 바로 공성 / 수비군 판단을 고릅니다. 수비 편성에서는 [수비 방침]으로 야전 요격 또는 농성을 선택합니다. 야전에서 수비군이 이기면 침공을 막습니다. 공격군 승리 또는 [성으로 후퇴] 시 생존 부대와 예비 병력으로 공성을 이어가며, 군량은 누적 차감됩니다. 예비 병력을 지정하지 않았다면 기존 수비군의 25%를 성에 남겨 공성을 대비합니다. 야전 승리 후에는 공성에서 승리해야 도시를 점령합니다.</p>' +
    '<p><b>도시 위임</b> : [위임·목표]에서 농업·상업·군사·최전선·후방 지원을 지정합니다. 턴 종료 시 남은 명령권으로 도시당 한 번 실행하며 금·무장 행동을 사용합니다.</p>' +
    '<p><b>전체위임·AI 관전</b> : [위임·목표] → [전체위임 시작]으로 내정·외교·군사·전투와 월 진행을 AI에 맡길 수 있습니다. 세력을 선택했다면 상단 [전체위임 해제] 또는 위임 메뉴에서 직접 지휘로 돌아올 수 있으며, 이미 실행한 행동과 소모한 명령권은 유지됩니다. 타이틀의 [전체 AI 관전]은 세력 선택 없이 모든 세력을 AI가 운영합니다. 관전에서는 상단 버튼으로 일시정지·재개할 수 있습니다. 전체위임 중 창을 열면 잠시 멈추고 닫으면 이어서 진행합니다.</p>' +
    '<p><b>장수 개성</b> : 제갈량·관우·장비·조조·주유·여포는 고유 능력이 있습니다. 무장 일람과 부대 설명에서 확인합니다. 12개 관계 조합은 같은 전장의 병력 1,000명 이상인 상대 장수가 있어야 보너스를 제공합니다.</p>' +
    '<p><b>턴 진행</b> : 한 달에 명령권 = 보유 도시 수 + 2. 명령을 쓰고 [턴 종료]를 누르면 AI 세력이 움직이고 월간 수입·이벤트가 처리됩니다. <b>첫 2개월은 AI가 공격해 오지 않습니다.</b></p>' +
    '<p><b>무장 행동</b> : 각 무장은 한 달에 한 번만 명령에 참여할 수 있습니다(내정·군사·등용). 이미 참여한 무장은 도시 패널에서 흐리게 표시되며, 다음 달에 다시 활동할 수 있습니다. 포상·외교는 무장 행동을 소모하지 않습니다.</p>' +
    '<p><b>내정</b> : 개발(농업→군량) · 상업(→금) · 치안(금·군량 생산/징병 효율) · 수복(방어도). <b>방어도 0~50의 보정은 기존대로 유지하고, 50 초과부터 추가로 강화됩니다. 방어력 보정은 50에서 +12.5%, 100에서 +38%입니다.</b> 1/2/3명 배치에 금 60/95/130과 명령 1이 들고, 추가 무장의 효과는 65%/40%로 줄어듭니다. 정치·지력과 명재 특기가 효과를 높입니다. 선택 화면에 정확한 비용·효과·월 생산 증가를 표시하며, 최대치 근처에서는 실제 상승분만큼 비용도 줄어듭니다.</p>' +
    '<p><b>재정·보급</b> : 매달 병력 500명당 금 1, 평시 90명당 군량 1을 소비합니다(도시별 올림). 인구 상한 초과 병력의 군량은 2배입니다. 치안은 금·군량 생산 모두에 영향을 줍니다. 상단바의 금·군량 괄호에서 세력 전체의 월 순증감을, 도시 패널에서 군량 지속 기간을 확인하세요. [군량 매입]은 금 100/300/600으로 군량 200/600/1,200을 얻습니다. [군량 매각]은 군량 200/600/1,200을 금 80/240/480에 팝니다(매입가 대비 20% 낮음). 매입·매각 모두 명령 1을 쓰며 무장은 필요 없습니다. 군량 부족 시 미지급 비율에 따라 병력·사기가 감소하고, 급료 부족 시 사기가 감소합니다. 전투에서는 참가 병력과 행군 중인 원군 600명당 매 라운드 군량 1을 추가 소비합니다. 보급이 부족하면 해당 진영의 사기가 라운드당 최대 8 내려갑니다. 편성 화면에서 예상 소모를, 전장에서 누적 소모·잔여 군량을 확인하세요. 새 게임은 평시 주둔군 6개월분(최소 600)을 비축합니다.</p>' +
    '<p><b>군사</b> : 징병(1,000명당 금 80·치안 -5·신병 훈련 30/사기 55, <b>도시당 월 1회</b>) · 모병(1,000명당 금 160·치안 -1·신병 훈련 55/사기 75, 같은 달에 반복 가능). 충원·이동 시 기존 병력과 훈련·사기를 인원 비율로 합산합니다. 훈련(훈련도·사기↑) · 이동(아군 도시로, <b>무장 인원 제한 없음</b>, 출발 도시 병력 전부 이동 가능 — 목적지 인구 상한을 넘겨도 주둔 가능. 무장을 고르면 <b>목적지 후보 도시가 지도에 금색 점선으로 표시되고, 지도에서 클릭해 목적지를 고를 수 있습니다</b>. 지도 아래 띠의 [목록에서 선택]으로 목록 선택도 가능) · 출진(적 도시 공격 — 무장을 고르면 <b>목적지 후보 적 도시가 지도에 붉은 점선으로 표시되고, 지도에서 클릭해 목적지를 고를 수 있습니다</b>(지도 아래 띠의 [목록에서 선택]도 가능). 인접 아군 도시와 <b>합동 출진</b> → 전술 전투. 합류 도시 부대는 원군처럼 늦게 도착하고, 전투가 끝나면 무장·잔존 병력이 각자 출발 도시로 복귀).</p>' +
    '<p><b>전투</b> : 부대별로 이동/공격/계략(화계·혼란·고무)/일기토/진형을 사용합니다. <b>이동한 뒤에도 같은 턴에 공격할 수 있지만, 일반 공격·불화살의 직접 피해는 20% 감소합니다. 일제공격도 참가 부대별 이동 여부에 따라 피해가 줄어듭니다.</b> 다음 라운드에는 해제되며, 반격·기병 돌격·계략·화상 지속 피해에는 적용하지 않습니다. 병과 상성(기병→궁병→보병→기병), 진형, 지형(숲·산·성)을 활용하세요. <b>기병은 부대당 한 전투에 2회 [돌격]</b>으로 최대 3칸까지 적 부대를 뚫고 반대편으로 빠져나올 수 있지만 <b>출발점·경로·착지점이 모두 평지여야 하며 숲·산·성·물·여울에서는 돌격할 수 없습니다.</b>  <b>보병은 같은 적에 인접한 보병·기병과 2부대 이상으로 [일제공격]</b>하여 함께 공격합니다(반격 없음, 명령은 보병이 시작). <b>보병은 한 전투에 일제공격을 2회까지 시작·참여</b>할 수 있으며, 참여할 때마다 1회씩 소모합니다. <b>기병은 참여 횟수 제한이 없으며</b>, 참여할 때 해당 턴의 행동을 소모합니다. <b>궁병은 [불화살]</b>로 적을 불태워 2라운드간 화상 피해를 남길 수 있고(부대당 2회, 숲에서 1.5배), <b>궁병이 아닌 부대가 근접 공격하면 상대의 반격</b>으로 아군도 피해를 입습니다. <b>성에서 공격하면 받는 반격 피해가 지형 방어에 더해 25% 줄어듭니다.</b> 전투 중에는 인접 아군 도시에서 <b>원군</b>을 보낼 수 있고, 원군은 행군에 며칠이 걸려 도착합니다(진군 상황은 전장 위쪽 상태바에 표시). <b>적도 병력이 불리해지면 원군을 보내므로</b> 상태바의 적 원군 표시를 확인하세요. <b>수비 편성 중 미리 요청한 원군은 플레이어·AI 모두 2라운드 뒤 도착</b>합니다. 적이 우리 성을 공격하면 전투 전에 <b>수비 편성</b> 창이 열려 출진처럼 무장·병과·진형·병력을 직접 지정할 수 있습니다(창을 닫으면 자동 편성). <b>AI도 매 라운드 상황에 맞춰 진형을 바꿉니다</b>(성 수비=방원, 궁병=학익, 기병=봉시, 보병=거리별 방원·안행·어린). 진형 전환은 <b>부대마다 첫 1회가 행동을 소모하지 않습니다</b>(이후 전환은 행동 소모, AI도 동일). 전투는 최대 <b>15라운드</b>입니다. <b>최대 라운드가 끝나면 공격군이 자동으로 후퇴하고 방어군이 승리합니다.</b> 공성전에서 <b>세 성의 깃발이 모두 공격군으로 바뀌면 방어측 패배</b>입니다. <b>수비측은 후퇴할 인접 아군 도시가 있으면 [후퇴]</b>로 성을 내주고 잔존 병력의 80%를 이끌고 빠져나갈 수 있습니다(무장도 함께 이동). <b>수비 편성 창에서도 [후퇴]</b>를 눌러 싸우지 않고 성을 내주고 빠져나갈 수 있습니다(편성 중 요청한 원군은 취소되어 출발 도시로 돌아갑니다). <b>[다음 턴]</b> 버튼으로 남은 부대를 대기시키고 턴을 넘길 수 있습니다.</p>' +
    '<p><b>병력과 회복</b> : 현재 병력이 많을수록 공격·반격이 강해지며, 3,000명을 넘는 대부대는 증가폭이 완만해집니다. 1,000명 미만 부대는 사기·화상 효과와 적 계략 성공률이 낮고, 화계 피해도 병력에 비례해 줄어듭니다. 일기토는 3판 2승제로 먼저 2승을 거둔 무장이 승리하며, 판마다 결과와 점수를 표시합니다. 병력·사기 변화와 승리 특기는 최종 승패에 한 번만 적용합니다. 일기토 신청은 부대당 전투 중 1회입니다. <b>일기토를 신청받으면 양측 무장의 이름·무력·사기·병력을 확인하고 수락하거나 거부</b>할 수 있습니다. <b>거부하면 병력 손실 없이 패배 시의 2배만큼 사기가 감소</b>합니다(기본 50, 신청 부대가 1,000명 미만이면 병력에 비례해 감소). 사기가 0이 되면 병력을 보존한 채 전장에서 도주합니다. 거부당해도 신청한 부대의 행동과 신청 기회는 소모됩니다. 자동 진행과 AI는 승산과 남은 사기에 따라 응답합니다. 고무는 반드시 성공하며, 훈련도가 100이어도 [훈련]으로 사기를 회복할 수 있습니다.</p>' +
    '<p><b>인사</b> : 등용(현재 도시의 재야·포로 및 인접 도시의 재야·적 무장 설득, 성공 시 명령 도시로 합류) · 포상(금 100, 충성도↑). 충성도가 45 미만이면 배신할 수 있습니다. 세력 수장(★)은 충성 100으로 등용·배신·포로가 없습니다.</p>' +
    '<p><b>시기별 등장</b> : 194년 이후 인물(제갈량·사마의·강유 등)은 <b>역사적 등장 시기</b>에 맞춰 해당 지역에 나타납니다. 등장한 달에는 전황 기록에 알림이 뜨고, 그 도시를 지배하는 세력이 있으면 곧바로 합류하며, 아니면 재야로 남아 [등용]으로 설득할 수 있습니다. 아직 등장하지 않은 인물은 무장 일람에 표시되지 않습니다.</p>' +
    '<p><b>포로</b> : 전투에서 사로잡은 무장은 해당 도시에 머물며, 그 도시를 원래 세력이 되찾으면 자동으로 풀려납니다. 등용 성공률은 처음에는 적 소속일 때와 같고, 억류 기간에 따라 점차 높아져 보통 3~6개월이면 재야 무장과 비슷해집니다. 원래 세력이 멸망하면 포로도 현재 도시에서 재야로 풀리고 충성도는 0이 됩니다. 이후에는 같은 도시에 있는 다른 재야 무장과 동일한 등용 확률이 적용됩니다.</p>' +
    '<p><b>외교</b> : 동맹은 12개월, 휴전은 6개월입니다. 공동 출진은 동맹국에 3개월 동안 특정 도시 공격을 우선 검토하도록 요청합니다. 상대가 3도시 이하이고 병력·도시가 각각 4배 우세하면 항복 권고가 가능하며 종속 세력의 영토를 편입할 수 있습니다. AI도 공동의 적과 보급 사정에 따라 동맹·휴전을 선택합니다. 선물로 관계를 올리고 동맹을 맺으면 서로 공격하지 않습니다. 동맹국 도시는 별도로 표시되며, 수비 편성·전투 중 원군 목록에서 전장에 인접한 동맹국 도시에 원군을 요청할 수 있습니다(도시별 전투당 1회). 동맹국이 주둔 병력·미행동 무장·훈련·사기·군량·주변 위협·관계를 보고 승낙 여부와 파견 규모를 정하며, 교전 상대와도 동맹이면 참전하지 않습니다. 지원 부대는 전투 후 출발 도시로 복귀합니다(패전·포로 손실 적용).</p>' +
    '<p><b>사운드</b> : 상단바의 <b>♪</b>(배경음악) · <b>🔊</b>(효과음) 버튼 또는 <b>M</b> · <b>N</b> 키로 언제든 켜고 끌 수 있습니다. 설정은 브라우저에 저장되어 다음 실행에도 유지됩니다.</p>' +
    '<p class="muted">저장은 브라우저(localStorage)에 됩니다. [저장]에서 수동저장 슬롯 3개 중 원하는 위치를 고를 수 있습니다. 매달 자동저장은 별도 슬롯 3개에 최근 순으로 보관되며 수동저장을 덮어쓰지 않습니다. [불러오기]에서 수동저장 또는 자동저장을 골라 이어 할 수 있습니다. ESC로 창을 닫을 수 있습니다.</p>' +
    '<div class="foot">' +
    (G && !document.body.classList.contains('title') ? '<button onclick="Game.closeModal()">닫기</button>' : '<button class="primary" onclick="Game.toTitle()">돌아가기</button>') + '</div>');
}

/* ── 저장 / 불러오기 (수동 3개 + 자동 3개) ────────────── */
function saveMetaOf(data, savedAt) {
  const f = data && data.factions ? data.factions[data.pf] : null;
  let cities = 0;
  if (data && data.cities) {
    Object.keys(data.cities).forEach(n => { const c = data.cities[n]; if (c && c.owner === data.pf) cities++; });
  }
  return {
    savedAt: typeof savedAt === 'number' ? savedAt : 0,
    year: data ? data.year : 0, month: data ? data.month : 0,
    turn: data && typeof data.turn === 'number' ? data.turn : 0,
    faction: f ? f.name + (data.fullDelegation ? ' · 전체위임' : '') : data && data.pf === null ? '전체 AI 관전' : '?', cities
  };
}
function readSaveData(n, kind = 'auto') {
  try {
    const raw = localStorage.getItem(saveSlotKey(n, kind));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.cities || !data.factions || !data.officers) return null;
    return data;
  } catch (e) { return null; }
}
function readSaveMeta(n, kind = 'auto') {
  try {
    const raw = localStorage.getItem(saveMetaKey(n, kind));
    if (raw) {
      const meta = JSON.parse(raw);
      if (meta && typeof meta === 'object') return meta;
    }
  } catch (e) { /* 메타가 깨졌으면 본문에서 다시 만든다 */ }
  const data = readSaveData(n, kind);
  return data ? saveMetaOf(data, 0) : null;
}
/* 최근 저장부터 정렬한 슬롯 목록 */
function saveSlots(kind) {
  const list = [];
  for (const type of kind ? [kind] : ['manual', 'auto']) {
    for (let n = 1; n <= SAVE_SLOTS; n++) {
      const meta = readSaveMeta(n, type);
      if (meta) list.push(Object.assign({}, meta, { slot: n, kind: type }));
    }
  }
  return list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}
/* 다음 자동저장 슬롯 — 수동저장 키에는 접근하지 않는다 */
function nextSaveSlot() {
  const used = [];
  for (let n = 1; n <= SAVE_SLOTS; n++) {
    if (!localStorage.getItem(saveSlotKey(n))) return n;
    used.push({ slot: n, savedAt: (readSaveMeta(n) || {}).savedAt || 0 });
  }
  used.sort((a, b) => a.savedAt - b.savedAt);
  return used.length ? used[0].slot : 1;
}
function saveTimeLabel(t) {
  if (!t) return '-';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '-';
  const p = v => (v < 10 ? '0' : '') + v;
  return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function saveSlotLabel(m) {
  return m.year + '년 ' + m.month + '월 · ' + m.faction + ' · 도시 ' + m.cities + ' · ' + saveTimeLabel(m.savedAt);
}
/* 기존 슬롯 3개는 그대로 유지하고, 구버전 단일 저장은 자동 슬롯 1로 옮긴다 */
function migrateLegacySave() {
  try {
    for (let n = 1; n <= SAVE_SLOTS; n++) if (localStorage.getItem(saveSlotKey(n))) return;
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || !data.cities || !data.factions || !data.officers) return;
    localStorage.setItem(saveSlotKey(1), raw);
    localStorage.setItem(saveMetaKey(1), JSON.stringify(saveMetaOf(data, Date.now())));
  } catch (e) { /* 이전에 실패해도 새 저장은 슬롯에 기록된다 */ }
}
/* 수동은 고정 위치 순서, 자동은 최근 저장 순서로 표시한다. */
function loadSaveRows(list, withIds) {
  return ['manual', 'auto'].map(kind => {
    const title = kind === 'manual' ? '수동저장' : '자동저장';
    const entries = list.filter(m => m.kind === kind);
    if (kind === 'manual') entries.sort((a, b) => a.slot - b.slot);
    const rows = entries.map(m => {
      const label = title + ' ' + m.slot;
      return '<div class="frow save-row" role="button" tabindex="0"' +
        (withIds ? ' id="loadRow' + list.indexOf(m) + '"' : '') +
        ' data-slot="' + m.slot + '" data-save-kind="' + kind + '" aria-label="' + label + ' · ' + saveSlotLabel(m) + ' 불러오기" onclick="Game.loadGame(' + m.slot + ',\'' + kind + '\')">' +
        '<b>' + label + '</b><span class="muted">' + saveSlotLabel(m) + '</span></div>';
    }).join('');
    return '<p class="muted" style="margin:12px 0 4px">' + title + ' (' + entries.length + ' / ' + SAVE_SLOTS + ')</p>' +
      (rows || '<p class="muted">저장된 게임이 없습니다.</p>');
  }).join('');
}
/* 시작 화면 — 수동/자동 저장 목록 */
function startSaveRows() {
  const list = saveSlots();
  if (!list.length) return '<button onclick="Game.importSave()">JSON 가져오기</button>';
  return '<button onclick="Game.importSave()">JSON 가져오기</button><p class="muted" style="margin:12px 0 4px">저장된 게임 — 이어서 하기</p>' + loadSaveRows(list, false);
}
/* 불러오기 — 수동/자동 저장을 구분해 고른다 */
function openLoad() {
  migrateLegacySave();
  const list = saveSlots();
  if (!list.length) {showModal('<h3>불러오기</h3><p>저장된 슬롯이 없습니다.</p><button onclick="Game.importSave()">JSON 가져오기</button>');return;}
  showModal('<h3>불러오기</h3>' +
    '<button onclick="Game.importSave()">JSON 가져오기</button><p class="muted">불러올 수동저장 또는 자동저장을 고르세요.</p>' + loadSaveRows(list, true) +
    '<div class="foot"><button onclick="Game.closeModal()">닫기</button></div>');
}
function saveGame(silent, manualSlot) {
  if (attackIntro) return;
  if (!G) { if (!silent) toast('게임을 시작한 뒤 저장할 수 있습니다'); return; }
  if (G.aiRunning && !silent) { toast('AI 행동 중에는 저장할 수 없습니다'); return; }
  if (G.battleActive) { if (!silent) toast('전투 중에는 저장할 수 없습니다'); return; }
  if (!silent && manualSlot === undefined) {
    const rows = [];
    for (let n = 1; n <= SAVE_SLOTS; n++) {
      const meta = readSaveMeta(n, 'manual');
      rows.push('<button class="frow save-row" id="saveSlot' + n + '" onclick="Game.saveGame(false,' + n + ')">' +
        '<b>수동저장 ' + n + '</b><span class="muted">' + (meta ? saveSlotLabel(meta) : '빈 슬롯') + '</span></button>');
    }
    showModal('<h3>수동저장</h3><button onclick="Game.exportSave()">JSON 내보내기</button><button onclick="Game.importSave()">JSON 가져오기</button><p class="muted">저장할 슬롯을 고르세요. 자동저장은 별도 슬롯 3개에 보관됩니다.</p>' + rows.join('') +
      '<div class="foot"><button onclick="Game.closeModal()">취소</button></div>');
    return;
  }
  if (!silent && (!Number.isInteger(manualSlot) || manualSlot < 1 || manualSlot > SAVE_SLOTS)) {
    toast('저장할 슬롯을 다시 고르세요'); return;
  }
  const kind = silent ? 'auto' : 'manual';
  try {
    const slot = silent ? nextSaveSlot() : manualSlot;
    if (!silent && localStorage.getItem(saveSlotKey(slot, kind)) &&
        typeof confirm === 'function' && !confirm('수동저장 ' + slot + '을 현재 진행 상황으로 덮어쓸까요?')) return;
    G.battleActive = false;
    G.ver = SAVE_VERSION;
    localStorage.setItem(saveSlotKey(slot, kind), JSON.stringify(G));
    localStorage.setItem(saveMetaKey(slot, kind), JSON.stringify(saveMetaOf(G, Date.now())));
    if (typeof localStorage.removeItem === 'function') localStorage.removeItem(SAVE_KEY);   // 구버전 단일 저장 정리
    sfx('save');
    if (!silent) {
      closeModal();
      toast('저장했습니다 — 수동저장 ' + slot + ' (' + G.year + '년 ' + G.month + '월)');
    }
  } catch (e) {
    if (!silent) toast('저장 실패: ' + e.message);
  }
}
function loadGame(slot, kind = 'auto') {
  migrateLegacySave();
  if (kind !== 'auto' && kind !== 'manual') { toast('불러올 저장 종류가 올바르지 않습니다'); return; }
  let n = Number.isInteger(slot) && slot >= 1 && slot <= SAVE_SLOTS ? slot : 0;
  if (!n) {
    const list = saveSlots();
    if (!list.length) { toast('저장된 게임이 없습니다'); return; }
    n = list[0].slot;                                  // 슬롯 지정이 없으면 가장 최근 저장
    kind = list[0].kind;
  }
  if (!localStorage.getItem(saveSlotKey(n, kind))) { toast('저장된 게임이 없습니다'); return; }
  const data = readSaveData(n, kind);
  if (!data) { toast('불러오기 실패: 저장 데이터가 손상되었습니다'); return; }
  if (data.pf !== null && !data.factions[data.pf]) { toast('불러오기 실패: 저장 데이터 형식이 올바르지 않습니다'); return; }
  if (G && typeof confirm === 'function' && !confirm('현재 진행 상황을 덮어쓰고 불러옵니다. 계속할까요?')) return;
  restoreSave(data,(kind === 'manual' ? '수동저장 ' : '자동저장 ') + n);
}
function restoreSave(data,label) {
  const previous=G;
  try {
    clearAutoPlay(); pausedAI = null; delegationCancelRequested = false; campaignEpoch++;
    stopAttackIntro();
    G = data;
    G.scenario = G.scenario || '194';
    G.leaders = G.leaders || Object.assign({},LEADERS,scenarioById(G.scenario).leaders || {});
    chosenScenario = G.scenario;
    // 구버전 저장 보정
    G.ver = G.ver || 1;
    G.turn = typeof G.turn === 'number' ? G.turn : 12;
    G.battleActive = false;
    G.aiRunning = false;
    G.ui = {};
    G.over = !!G.over;
    G.fullDelegation = !!G.pf && data.fullDelegation === true;
    G.autoPaused = data.autoPaused === true;
    if (!Array.isArray(G.log)) G.log = [];
    G.officers.forEach(o => { if (!o.status) o.status = 'active'; });
    G.officers.forEach(o => { if (typeof o.debut !== 'number') o.debut = SCENARIO.year; });
    syncOfficers();                       // 새로 추가된 무장 정의 보충
    debutOfficers();                      // 이미 시기가 지난 인물은 바로 등장
    G.cmdMax = G.pf ? G.cmdMax || (factionCities(G.pf).length + 2) : 0;
    G.cmd = cl(G.cmd || 0, 0, G.cmdMax);
    if (!G.cities[G.sel]) G.sel = null;
    setTitleMode(false);
    closeModal();
    renderAll();
    selectCity(G.sel);
    bgm('map');
    sfx('load');
    toast('불러왔습니다 — ' + G.year + '년 ' + G.month + '월 (' + label + ')');
    victoryCheck();
    scheduleAutoPlay();
  } catch (e) {
    G=previous;toast('불러오기 실패: ' + e.message);
  }
}

/* ── 사운드 토글 (상단바 버튼 · M / N 단축키) ─────────── */
function toggleBgm() {
  if (typeof Sound === 'undefined') return;
  Sound.toggleBgm();
  sfx('click');
  toast('배경음악 ' + (Sound.bgmOn ? '켜짐' : '꺼짐'));
}
function toggleSfx() {
  if (typeof Sound === 'undefined') return;
  Sound.toggleSfx();
  toast('효과음 ' + (Sound.sfxOn ? '켜짐' : '꺼짐'));
}

/* ── Game API ────────────────────────────────────────── */
const Game = {
  boot, startNew, startSpectator, setFullDelegation, toggleAutoPlay, reset, endTurn, chooseScenario,
  openOfficers, officerSort, openDiplo, openHelp,
  openPolicies,setPolicy,openObjectives,setObjective,diploTruce,diploJoint,diploSurrender,diploAnnex,exportSave,importSave,previewImport,confirmImport,cancelImport,
  saveGame, loadGame, openLoad, toggleBgm, toggleSfx,
  closeModal, togglePick, confirmPick,
  cmdAdmin, cmdRecruit, cmdLevy, cmdTrain, cmdSupply, confirmSupply, cmdSellFood, confirmSellFood, cmdMove, cmdAttack, cmdAttackFrom,
  chooseMoveTarget, openMoveTargetList, beginMoveTargetPick, cancelMove, moveTargets, doMove, openDeploy, confirmDeploy,
  chooseAttackTarget, openAttackTargetList, beginAttackTargetPick, cancelAttack, attackTargets,
  addDeployCity, removeDeployCity,
  updateDeployTroops: captureDeploy, updateDefenseTroops: captureDefenseDeploy, adjustDeployTroops,
  openDefenseDeploy, confirmDefenseDeploy, autoDefenseDeploy,
  retreatDefenseDeploy, doDefRetreat, cancelDefRetreat,
  openDefReinforce, defReinfCity, toggleDefReinf, doDefReinforce,
  openReinforce, pickReinforce, doReinforce, requestAllyReinforce,
  cmdHire, doHire, cmdReward, doReward,
  diploGift, diploAlly, diploBreak,
  selectCity, toTitle, zoomBy, zoomReset, setZoom, mobilePanel, mobileCityTab,
  get state() { return G; },
  get view() { return view; },
  _debug: {
    newGame, applyBattleResult, autoResolve, defenseUnits, defenseUnitsFrom, defensePlan, defReinforceCandidates, aiUnits, runFactionAI,
    applyDefReinforce,aiFieldDefense,continueSiege,unitPower,aiDiplomacy,makePact,hasPeace,policyPlan,runPolicies,objectiveStatus,parseSaveFile,validateSave,cityAt,
    aiMovePlans, execAIAct, aiDefensePower, aiFrontline, aiCityThreat, aiGarrisonReserve, aiDepartureReserve, aiRallyPlans, aiActionCandidates, aiAttackPlan, campaignDiplomacy,
    debutOfficers, syncOfficers, makeOfficer, visibleOfficers,
    distribute, cityGoldIncome, cityFoodIncome, cityFoodUpkeep, cityGoldUpkeep, capOf, factionEconomy,
    adminQuote, recruitQuote, aiRecruitPlan, monthlyProcess, addGarrison, buyFood, consumeBattleSupply, beginBattle, isLeader,
    availableOfficers, bestAvailable, markUsed, refreshCmd, cityRegion,expeditionRate,
    PICK_SCORE, pickSorted,
    get log() { return G ? G.log : []; }
  }
};
window.Game = Game;
