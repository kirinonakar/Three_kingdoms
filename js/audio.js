/* 삼국지 : 천하통일 — 오프라인에서도 동작하는 Web Audio 실시간 악보.
   고쟁 계열 발현음 · 대나무 관악음 · 현악 패드 · 전고 · 칼날 충돌 녹음.
   기존 Sound API와 sangokji_audio_v1 설정을 유지한다. */
const Sound = (function () {
  'use strict';
  const KEY = 'sangokji_audio_v1';
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  const TICK = 80, LOOKAHEAD = 0.24;
  const opt = { sfx: true, bgm: true };
  let ctx, master, sfxBus, bladeBus, movementBus, sfxOutput, musicBus, noiseBuf, roomBuffer, stringWave;
  let bladeSamples = [], lastBlade = -1;
  let mood = null, score = null, timer = null, booted = false;
  let scene = { theme:'plain', season:0, tension:0 };
  const lastAt = {}, bursts = [], routes = new Set(), owners = new WeakMap();

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (typeof v.sfx === 'boolean') opt.sfx = v.sfx;
      if (typeof v.bgm === 'boolean') opt.bgm = v.bgm;
    } catch (_) { /* 설정 손상 시 기본값 */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(opt)); } catch (_) { /* 저장 불가 */ }
  }
  function glide(param, value, t, seconds) {
    // 연속 토글/장면 전환에서도 진행 중인 자동화를 현재 값에서 이어 간다.
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
    else { const v = param.value; param.cancelScheduledValues(t); param.setValueAtTime(v, t); }
    param.linearRampToValueAtTime(value, t + seconds);
  }
  function noise(seconds, stereo, decay) {
    const b = ctx.createBuffer(stereo ? 2 : 1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      // 잔향 앞부분을 부드럽게 열어 노이즈성 어택을 억제한다.
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * (decay
          ? Math.min(1, i / (ctx.sampleRate * 0.018)) * Math.exp(-7 * i / d.length) : 1);
      }
    }
    return b;
  }
  function output(node, bus, pan, nodes) {
    if (ctx.createStereoPanner && pan) {
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      node.connect(p); p.connect(bus); nodes.push(p);
    } else node.connect(bus);
  }
  function voice(sources, nodes, bus, start, end) {
    const owner = owners.get(bus);
    const v = { sources, end };
    if (owner) owner.voices.add(v);
    let remaining = sources.length;
    sources.forEach(s => {
      s.onended = () => {
        s.disconnect();
        if (--remaining === 0) {
          nodes.forEach(n => n.disconnect());
          if (owner) owner.voices.delete(v);
        }
      };
      s.start(start); s.stop(end);
    });
  }
  function envelope(g, t, dur, vol, attack) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.015);
  }
  function tone(f, to, t, dur, vol, bus = sfxBus, pan = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f, t);
    if (to !== f) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    envelope(g, t, dur, vol, Math.min(0.012, dur / 4));
    o.connect(g); const nodes = [g]; output(g, bus, pan, nodes);
    voice([o], nodes, bus, t, t + dur + 0.02);
  }
  function air(t, dur, vol, f0, f1, q = 0.7, bus = sfxBus, pan = 0, attack = 0.012) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    s.playbackRate.value = 0.91 + Math.random() * 0.18;
    f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    envelope(g, t, dur, vol, Math.min(attack, dur / 4));
    s.connect(f); f.connect(g); const nodes = [f, g]; output(g, bus, pan, nodes);
    voice([s], nodes, bus, t, t + dur + 0.02);
  }
  function pluck(f, t, dur, vol, bus = sfxBus, pan = -0.22) {
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.setPeriodicWave(stringWave);
    o.frequency.setValueAtTime(f * 1.002, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
    lp.type = 'lowpass'; lp.Q.value = 0.55;
    lp.frequency.setValueAtTime(Math.min(6500, f * 9), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(240, f * 1.3), t + dur * 0.65);
    envelope(g, t, dur, vol, 0.006);
    o.connect(lp); lp.connect(g); const nodes = [lp, g]; output(g, bus, pan, nodes);
    voice([o], nodes, bus, t, t + dur + 0.02);
    air(t, 0.032, vol * 0.13, 2600, 1100, 0.6, bus, pan);
  }
  function flute(f, t, dur, vol, bus, pan = 0.26) {
    const o = ctx.createOscillator(), h = ctx.createOscillator(), vibrato = ctx.createOscillator();
    const vg = ctx.createGain(), hg = ctx.createGain(), g = ctx.createGain();
    o.type = h.type = 'sine'; o.frequency.value = f; h.frequency.value = f * 2;
    vibrato.frequency.value = 4.7; vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.003, t + Math.min(0.5, dur / 2));
    vibrato.connect(vg); vg.connect(o.frequency);
    hg.gain.value = 0.17; o.connect(g); h.connect(hg); hg.connect(g);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.13);
    g.gain.setValueAtTime(vol * 0.8, t + dur * 0.65);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const nodes = [vg, hg, g]; output(g, bus, pan, nodes);
    voice([o, h, vibrato], nodes, bus, t, t + dur + 0.02);
    air(t + 0.035, dur * 0.85, vol * 0.16, 1700, 1100, 0.5, bus, pan);
  }
  function pad(f, t, dur, vol, bus, pan) {
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    const lp = ctx.createBiquadFilter(), g = ctx.createGain();
    a.type = 'triangle'; b.type = 'sine';
    a.frequency.value = f; b.frequency.value = f; b.detune.value = 5;
    lp.type = 'lowpass'; lp.frequency.value = 740; lp.Q.value = 0.5;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.7);
    g.gain.linearRampToValueAtTime(vol * 0.75, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    a.connect(lp); b.connect(lp); lp.connect(g);
    const nodes = [lp, g]; output(g, bus, pan, nodes);
    voice([a, b], nodes, bus, t, t + dur + 0.02);
  }
  function drum(t, vol, pitch = 92, bus = sfxBus, pan = 0) {
    // 낮은 몸통 울림 + 북가죽의 배음 + 채가 닿는 소리.
    tone(pitch * 1.45, pitch * 0.54, t, 0.52, vol, bus, pan);
    tone(pitch * 2.13, pitch * 1.12, t, 0.19, vol * 0.26, bus, pan);
    air(t, 0.085, vol * 0.48, 1400, 390, 0.65, bus, pan);
  }
  function wood(t, vol, bus = sfxBus, pan = 0) {
    tone(760, 610, t, 0.045, vol, bus, pan);
    tone(1210, 1030, t, 0.028, vol * 0.32, bus, pan);
    air(t, 0.025, vol * 0.35, 1500, 900, 1.4, bus, pan);
  }
  function footstep(t, vol, pan, ground = 'plain') {
    // 북의 저음 대신 짧은 바닥 접촉과 부드러운 가죽 마찰을 사용한다.
    const variation=.92+Math.random()*.16, wet=ground==='wet', hard=ground==='stone';
    tone((hard?340:190)*variation, hard?220:130, t, 0.065, vol * 0.45, movementBus, pan);
    air(t, wet?.14:.08, vol, wet?1900:1050, wet?700:420, 0.65, movementBus, pan);
    if(wet) air(t+.025,.085,vol*.4,3400,1500,.9,movementBus,pan);
  }
  function metal(f, t, dur, vol, bus = sfxBus, pan = 0) {
    [1, 1.48, 2.09, 2.71, 3.94].forEach((r, i) =>
      tone(f * r, f * r * 0.998, t, dur / (1 + i * 0.48), vol / (2 + i * 2.8), bus, pan));
  }
  function loadBladeSamples() {
    if (typeof SwordSamples === 'undefined') return;
    bladeSamples = SwordSamples.pcm16.map(encoded => {
      const bytes = atob(encoded), data = new Float32Array(bytes.length / 2);
      for (let i = 0; i < data.length; i++) {
        const value = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
        data[i] = (value >= 32768 ? value - 65536 : value) / 32768;
      }
      const buffer = ctx.createBuffer(1, data.length, SwordSamples.sampleRate);
      buffer.copyToChannel(data, 0);
      return buffer;
    });
  }
  function steelClash(t, strength = 1, pan = 0) {
    if (!bladeSamples.length) {
      // 누락된 음원 스크립트 때문에 전투가 중단되지는 않는다.
      air(t, 0.035, 0.23 * strength, 4800, 2200, 0.7, sfxBus, pan, 0.001);
      air(t + 0.012, 0.12, 0.12 * strength, 3300, 1700, 2, sfxBus, pan, 0.002);
      return;
    }
    // 실제 칼날 녹음을 교대로 선택한다. 같은 타격을 연달아 반복하지 않는다.
    const count = bladeSamples.length;
    const offset = Math.floor(Math.random() * (lastBlade < 0 ? count : count - 1));
    const index = lastBlade < 0 || count === 1 ? offset : (lastBlade + 1 + offset) % count;
    lastBlade = index;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = bladeSamples[index];
    src.playbackRate.value = 0.985 + Math.random() * 0.03;
    g.gain.value = 0.88 * strength;
    src.connect(g); const nodes = [g]; output(g, bladeBus, pan, nodes);
    voice([src], nodes, bladeBus, t, t + src.buffer.duration / src.playbackRate.value + 0.02);
  }
  function bowShot(t, strength, pan) {
    // 시위의 짧은 탄성 → 깃의 비행음 → 목표에 박히는 둔탁한 소리.
    const tuning = 0.96 + Math.random() * 0.08;
    pluck(220 * tuning, t, 0.14, 0.085 * strength, sfxBus, pan);
    air(t, 0.026, 0.085 * strength, 2600, 1200, 0.9, sfxBus, pan, 0.002);
    air(t + 0.025, 0.33, 0.1 * strength, 4200, 1300, 2.2, sfxBus, -pan);
    const hit = t + 0.45;
    wood(hit, 0.055 * strength, sfxBus, -pan);
    tone(230, 120, hit, 0.1, 0.065 * strength, sfxBus, -pan);
    air(hit, 0.055, 0.055 * strength, 1800, 600, 0.7, sfxBus, -pan, 0.002);
  }
  function hoof(t, strength, pan) {
    // 말굽의 단단한 접촉과 지면의 낮은 울림. 북보다 짧고 마른 음색.
    tone(420, 260, t, 0.055, 0.055 * strength, sfxBus, pan);
    tone(145, 88, t, 0.1, 0.075 * strength, sfxBus, pan);
    air(t, 0.04, 0.09 * strength, 1300, 430, 0.8, sfxBus, pan, 0.002);
  }
  const pitch = (root, semitone) => root * Math.pow(2, semitone / 12);
  // 공개 API의 오음계 degree 변환은 기존 호출용으로 유지.
  function note(root, degree) {
    return pitch(root, [0, 2, 4, 7, 9][((degree % 5) + 5) % 5] + 12 * Math.floor(degree / 5));
  }
  function flourish(t, notes, vol = 0.085, spacing = 0.13) {
    notes.forEach((n, i) => pluck(pitch(293.665, n), t + i * spacing, 1.15, vol, sfxBus, (i % 3 - 1) * 0.16));
  }
  const LIB = {
    click(t) { wood(t, 0.06); },
    select(t) {
      // 현의 날카로운 어택과 높은 배음을 빼고, 잔향 없이 가까운 촉감만 남긴다.
      tone(360, 335, t, 0.10, 0.025, sfxOutput);
      tone(530, 510, t + 0.004, 0.065, 0.004, sfxOutput);
      air(t, 0.045, 0.012, 1000, 650, 0.5, sfxOutput);
    },
    cmd(t) { wood(t, 0.09); tone(146, 98, t, 0.17, 0.07); },
    coin(t) { metal(1174, t, 0.32, 0.08, sfxBus, -0.1); metal(1760, t + 0.055, 0.38, 0.06, sfxBus, 0.1); },
    success(t) { flourish(t, [0, 7, 14], 0.075); },
    fail(t) { pluck(220, t, 0.3, 0.065); pluck(196, t + 0.13, 0.4, 0.055); },
    move(t, details = {}) {
      const steps=Math.max(2,Math.min(8,details.steps||2)), gap=details.gap||.115;
      for(let i=0;i<steps;i++) {
        const pan=(details.pan||0)+(i%2?.07:-.07), at=t+i*gap;
        footstep(at,.05+(i%2?.004:.012),pan,details.ground);
        if(details.branch==='기병') {
          tone(380,240,at+.025,.045,.025,movementBus,pan);
          tone(130,88,at,.07,.025,movementBus,pan);
        }
      }
    },
    march(t) {
      footstep(t, 0.075, -0.1); footstep(t + 0.14, 0.06, 0.1); footstep(t + 0.28, 0.045, -0.05);
      air(t + 0.025, 0.24, 0.028, 650, 1000, 0.5, movementBus, 0);
    },
    taiko(t) { drum(t, 0.23, 90); },
    turn(t) { wood(t, 0.08); flourish(t + 0.07, [0, 7, 9], 0.065, 0.16); },
    chime(t) { metal(587, t, 1.5, 0.085); pluck(880, t + 0.16, 0.8, 0.04); },
    save(t) { flourish(t, [7, 12], 0.065, 0.12); },
    load(t) { flourish(t, [12, 7], 0.065, 0.12); },
    battleStart(t) {
      metal(146.83, t, 2.2, 0.14);
      [0, 0.25, 0.57].forEach((d, i) => drum(t + d, 0.16 + i * 0.025, 90 - i * 8));
      pad(146.83, t, 1.8, 0.055, sfxBus, -0.18);
      pad(220, t + 0.05, 1.6, 0.035, sfxBus, 0.18);
    },
    slash(t) { steelClash(t, 1, (Math.random() - 0.5) * 0.18); },
    arrow(t) {
      [1, 0.62, 0.48].forEach((strength, i) => bowShot(t + i * 0.045, strength, -0.24 + i * 0.24));
    },
    volley(t, details = {}) {
      // 보병 협공: 실제 참가 부대 수와 화면의 170ms 공격 간격에 맞춘다.
      const count = details.count === 2 ? 2 : 3;
      for (let i = 0; i < count; i++) {
        const pan = -0.3 + i * 0.6 / (count - 1), hit = t + i * 0.17;
        steelClash(hit, i === count - 1 ? 1.05 : 0.82, pan);
        air(hit + 0.025, 0.08, 0.075, 950, 310, 0.8, sfxBus, pan, 0.003);
      }
    },
    charge(t) {
      [0, 0.05, 0.14, 0.18, 0.26, 0.295, 0.36, 0.39].forEach((d, i) =>
        hoof(t + d, 0.65 + i * 0.06, i % 2 ? 0.22 : -0.22));
      air(t + 0.04, 0.43, 0.1, 650, 1400, 0.6, sfxBus, 0);
      steelClash(t + 0.45, 0.9, 0);
      tone(125, 58, t + 0.45, 0.2, 0.14);
      air(t + 0.46, 0.22, 0.12, 1100, 260);
    },
    fire(t) {
      air(t, 0.95, 0.22, 650, 170); tone(85, 38, t, 0.48, 0.11);
      for (let i = 0; i < 7; i++) air(t + 0.06 + i * 0.105, 0.045, 0.065, 2400 + Math.random() * 900, 900, 1.2, sfxBus, (i % 3 - 1) * 0.25);
    },
    confuse(t) { [0, 3, 9, 14].forEach((n, i) => metal(pitch(294, n), t + i * 0.1, 0.75, 0.05, sfxBus, i % 2 ? 0.3 : -0.3)); },
    duel(t) { steelClash(t, 1.1, -0.14); steelClash(t + 0.17, 0.72, 0.14); },
    destroy(t) { drum(t, 0.2, 74); air(t, 0.65, 0.23, 1100, 150); wood(t + 0.08, 0.08, sfxBus, -0.23); wood(t + 0.19, 0.05, sfxBus, 0.23); },
    capture(t) { metal(196, t, 1.8, 0.13); flourish(t + 0.16, [0, 7, 12], 0.075, 0.18); },
    win(t) { flourish(t, [0, 4, 7, 14, 12], 0.085, 0.16); drum(t, 0.14); },
    lose(t) { flourish(t, [7, 3, 2, -5], 0.075, 0.25); },
    victory(t) { metal(146.83, t, 2.8, 0.15); flourish(t + 0.2, [0, 4, 7, 9, 14, 19, 24], 0.085, 0.19); drum(t + 0.2, 0.17); drum(t + 0.96, 0.13); },
    defeat(t) { flourish(t, [0, -2, -5, -12], 0.075, 0.32); pad(73.416, t, 2.6, 0.055, sfxBus, 0); }
  };
  const GAP = { click: 0.045, select: 0.11, move: 0.18, march: 0.24, slash: 0.075, arrow: 0.14, charge: 0.35, volley: 0.28, coin: 0.16, battleStart: 1.8, victory: 3, defeat: 3 };
  const ACCENT = { battleStart: 1.2, capture: 0.85, win: 1.1, lose: 1.1, victory: 2, defeat: 1.8 };
  function play(name, details) {
    if (!opt.sfx || !ctx || ctx.state !== 'running' || !LIB[name]) return;
    const now = ctx.currentTime, gap = GAP[name] || 0.12;
    if (lastAt[name] !== undefined && now - lastAt[name] < gap) return;
    while (bursts.length && bursts[0] < now - 0.12) bursts.shift();
    if (bursts.length >= 6 && !ACCENT[name]) return;
    lastAt[name] = now; bursts.push(now);
    LIB[name](now + 0.008, details);
    if (ACCENT[name]) {
      glide(musicBus.gain, 0.48, now, 0.06);
      musicBus.gain.setValueAtTime(0.48, now + ACCENT[name]);
      musicBus.gain.linearRampToValueAtTime(1, now + ACCENT[name] + 0.8);
    }
  }

  // 8분음표 64칸 = 8마디. 숫자는 반음 간격, null은 의도한 쉼표.
  // 같은 D 중심음을 공유해 장면 크로스페이드에서도 조성이 안정된다.
  const MOOD = {
    title: { bpm: 64, root: 146.832, level: 0.76, pad: 0.017,
      harmony: [0, -5, -3, 0],
      phrases: [
        [0, null, null, null, 7, null, 9, null, 12, null, null, 9, 7, null, null, null],
        [4, null, 7, null, 9, null, null, null, 7, null, 4, null, 2, null, null, null],
        [0, null, 4, 7, 9, null, 12, null, 14, null, null, 12, 9, null, 7, null],
        [4, null, null, 2, 0, null, -5, null, 0, null, null, null, null, null, null, null]
      ] },
    map: { bpm: 78, root: 146.832, level: 0.72, pad: 0.014,
      harmony: [0, -3, -5, 0],
      phrases: [
        [0, null, 4, null, 7, null, null, 9, 7, null, 4, null, 2, null, null, null],
        [4, null, 7, 9, 12, null, 9, null, 7, null, null, 4, 2, null, 4, null],
        [9, null, 12, null, 14, null, 12, 9, 7, null, 9, null, 4, null, null, null],
        [7, null, 4, null, 2, null, -5, null, 0, null, null, null, null, null, 2, null]
      ] },
    battle: { bpm: 108, root: 146.832, level: 0.66, pad: 0.017,
      harmony: [0, -2, -5, 0],
      phrases: [
        [0, null, 0, 7, 0, null, 3, null, 5, null, 3, 0, -2, null, -5, null],
        [0, null, 7, null, 10, 7, 5, null, 3, null, 5, 7, 3, null, 0, null],
        [12, null, 10, 7, 5, null, 7, null, 10, null, 12, 10, 7, null, 5, null],
        [3, null, 5, null, 7, 5, 3, null, 0, null, -5, null, 0, null, null, null]
      ] }
  };
  // A(주제) → B(관악 응답) → C(새 선율·분산화음) → D(여백과 종지).
  // 단순 음색 교체에 그치지 않고 32마디 단위로 선율·반주·타악 밀도가 바뀐다.
  const DEVELOPMENT = {
    title: [
      [12,null,9,null,7,null,4,null,2,null,4,7,9,null,null,null],
      [7,null,9,12,14,null,12,null,9,null,7,null,4,null,null,null],
      [4,null,2,null,0,4,7,null,9,null,7,4,2,null,null,null],
      [7,null,4,null,2,null,-5,null,0,null,null,null,null,null,null,null]],
    map: [
      [12,null,7,9,12,null,14,null,16,null,14,12,9,null,7,null],
      [9,null,7,4,2,null,4,null,7,9,12,null,9,null,null,null],
      [4,7,9,null,12,null,9,7,4,null,2,null,4,7,null,null],
      [9,null,7,null,4,2,null,-5,0,null,null,null,7,null,2,null]],
    battle: [
      [0,3,7,null,10,null,7,5,3,null,0,3,5,null,7,null],
      [12,null,10,12,15,null,12,10,7,null,5,3,0,null,null,null],
      [7,5,3,null,0,null,-2,0,3,5,7,null,10,7,5,null],
      [3,null,0,-2,-5,null,-2,null,0,null,null,null,7,null,0,null]]
  };
  function setScene(details) {
    if(!details) return;
    scene={...scene,...details};
    scene.tension=Math.max(0,Math.min(1,Number(scene.tension)||0));
    scene.season=Math.max(0,Math.min(3,Number(scene.season)||0));
  }
  function makeRoute(destination, wet, level) {
    const input = ctx.createGain(), out = ctx.createGain(), dry = ctx.createGain();
    const verb = ctx.createConvolver(), send = ctx.createGain(), low = ctx.createBiquadFilter();
    dry.gain.value = 0.9; send.gain.value = wet; out.gain.value = level;
    verb.buffer = roomBuffer; low.type = 'lowpass'; low.frequency.value = 3400;
    input.connect(dry); dry.connect(out);
    input.connect(verb); verb.connect(low); low.connect(send); send.connect(out); out.connect(destination);
    const r = { input, out, nodes: [input, out, dry, verb, send, low], voices: new Set(), cleanup: null };
    owners.set(input, r);
    return r;
  }
  function dispose(r) {
    if (r.cleanup !== null) clearTimeout(r.cleanup);
    r.voices.forEach(v => v.sources.forEach(s => { try { s.stop(); } catch (_) {} }));
    r.nodes.forEach(n => n.disconnect()); routes.delete(r);
  }
  function retire(r, seconds) {
    const end = ctx.currentTime + seconds;
    glide(r.out.gain, 0, ctx.currentTime, seconds);
    r.voices.forEach(v => v.sources.forEach(s => { try { s.stop(Math.min(v.end, end + 0.02)); } catch (_) {} }));
    r.cleanup = setTimeout(() => dispose(r), (seconds + 0.1) * 1000);
  }
  function playStep(s, t) {
    const m = MOOD[s.name], i = s.step % 64, beat = i % 8, phrase = Math.floor(i / 16);
    const cycle = Math.floor(s.step / 64), eighth = 30 / m.bpm, bus = s.input;
    const battle = s.name === 'battle', root = m.root;
    const section=cycle%4, open=section===3, developing=section>=2;
    const vel = 0.96 + Math.random() * 0.08;
    if (i % 16 === 0) {
      const bass = pitch(root / 2, m.harmony[phrase]);
      pad(bass, t, eighth * 17, m.pad, bus, -0.24);
      pad(bass * 3, t + 0.035, eighth * 16.5, m.pad * 0.48, bus, 0.24);
      pluck(bass * 2, t, 2, 0.052, bus, -0.1);
    }
    const n = (developing?DEVELOPMENT[s.name]:m.phrases)[phrase][i % 16];
    if (n !== null) {
      const f = pitch(root * 2, n);
      if(section!==1 || beat%2===0) pluck(f, t + (beat % 2 ? 0.012 : 0), battle ? 0.75 : 1.65,
        (battle ? 0.058 : 0.064) * vel * (beat === 0 ? 1.08 : 0.92), bus, -0.25);
      if(section===1 || (developing && i%8===0)) flute(f,t+.025,eighth*(open?3.6:2.4),battle?.026:.034,bus);
      // 두 번째 순환에서는 관악기가 응답하고 쉼표를 남겨 전개한다.
      if (!battle && section===0 && i % 8 === 0 && scene.season===1)
        flute(f, t + 0.045, eighth * 3.2, 0.037, bus);
    }
    if (!battle && cycle % 2 === 0 && (i === 8 || i === 40))
      flute(pitch(root * 2, i === 8 ? 7 : 9), t + 0.025, eighth * 5.5, 0.04, bus);
    if (battle) {
      if (beat === 0 || (!open && (beat === 3 || beat === 6)))
        drum(t, (beat === 0 ? 0.16 : 0.09) * vel * (1+scene.tension*.12), beat === 0 ? 85 : 110, bus, beat === 3 ? 0.2 : -0.12);
      if (beat === 2 || beat === 7) wood(t + 0.008, 0.035 * vel, bus, 0.3);
      if (i % (open?4:2) === 0) pluck(pitch(root, [0,7,12,7][Math.floor(beat/2)] + m.harmony[phrase]), t, 0.32, 0.029, bus, 0.16);
      if (i === 62 || i === 63) drum(t, i === 63 ? 0.095 : 0.065, 125, bus, 0.15);
      if (i === 0 && cycle % 2 === 0) metal(root, t, 2.6, 0.055, bus, -0.25);
    } else {
      if (beat === 0 && (s.name === 'map' || i % 16 === 0))
        drum(t, s.name === 'map' ? 0.078 : 0.055, 82, bus, -0.1);
      if (s.name === 'map' && beat === 4) wood(t, 0.029, bus, 0.25);
      if (i === 48 && cycle % 2 === 1) metal(root * 4, t, 1.8, 0.032, bus, 0.3);
    }
    if(developing && !open && beat%2===1) {
      const chord=battle?[0,3,7,10]:[0,4,7,9];
      pluck(pitch(root,m.harmony[phrase]+chord[Math.floor(beat/2)]),t+.018,eighth*2,.023,bus,.35);
    }
    // 하천의 숨결·건조한 바람을 낮게 깔아 장소감을 준다. 음악 버스로 보내 음소거도 함께 적용한다.
    if(i%16===0 && s.name!=='title') {
      const wet=['wet','gorge','basin'].includes(scene.theme);
      air(t,eighth*12,wet?.018:.011,wet?1450:480,wet?950:280,.5,bus,.4,.6);
    }
  }
  function tick() {
    if (!ctx || ctx.state !== 'running' || !score || !opt.bgm) return;
    if (score.nextAt < ctx.currentTime) score.nextAt = ctx.currentTime + 0.035;
    while (score.nextAt < ctx.currentTime + LOOKAHEAD) {
      playStep(score, score.nextAt);
      score.nextAt += 30 / MOOD[score.name].bpm; score.step++;
    }
  }
  function applyMusic() {
    if (!ctx) return;
    if (!opt.bgm || !mood) {
      if (score) { retire(score, 0.22); score = null; }
      if (timer !== null) { clearInterval(timer); timer = null; }
      routes.forEach(r => glide(r.out.gain, 0, ctx.currentTime, 0.22));
      return;
    }
    if (!score || score.name !== mood) {
      if (score) retire(score, 1.1);
      // 빠른 장면 전환으로 잔향 그래프가 무한히 쌓이지 않게 한다.
      while (routes.size >= 3) dispose(routes.values().next().value);
      score = makeRoute(musicBus, mood === 'battle' ? 0.18 : 0.3, 0);
      Object.assign(score, { name: mood, step: 0, nextAt: ctx.currentTime + 0.045 });
      routes.add(score);
      glide(score.out.gain, MOOD[mood].level, ctx.currentTime, 0.85);
    }
    if (timer === null) timer = setInterval(tick, TICK);
    tick();
  }
  function bgm(name) { if (MOOD[name]) { mood = name; applyMusic(); } }

  function init() {
    if (ctx || !AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.82;
    const high = ctx.createBiquadFilter(), low = ctx.createBiquadFilter(), comp = ctx.createDynamicsCompressor();
    high.type = 'highpass'; high.frequency.value = 32; high.Q.value = 0.5;
    low.type = 'lowpass'; low.frequency.value = 10000; low.Q.value = 0.5;
    comp.threshold.value = -15; comp.knee.value = 18; comp.ratio.value = 3;
    comp.attack.value = 0.006; comp.release.value = 0.24;
    master.connect(high); high.connect(low); low.connect(comp); comp.connect(ctx.destination);
    noiseBuf = noise(2, false, false); roomBuffer = noise(1.65, true, true);
    stringWave = ctx.createPeriodicWave(new Float32Array(9), new Float32Array([0, 1, 0.52, 0.29, 0.16, 0.1, 0.065, 0.035, 0.02]));
    sfxOutput = ctx.createGain(); sfxOutput.gain.value = opt.sfx ? 0.9 : 0; sfxOutput.connect(master);
    sfxBus = makeRoute(sfxOutput, 0.14, 1).input;
    // 녹음 자체의 짧은 잔진동을 살리고 합성 잔향은 최소화한다.
    bladeBus = makeRoute(sfxOutput, 0.025, 1).input;
    loadBladeSamples();
    // 이동은 잔향 없는 가까운 소리로 처리해 연속 조작에도 울림이 쌓이지 않는다.
    movementBus = ctx.createGain(); movementBus.gain.value = 0.85; movementBus.connect(sfxOutput);
    musicBus = ctx.createGain(); musicBus.gain.value = 1; musicBus.connect(master);
  }
  function unlock() {
    if (!AC) return;
    try {
      init();
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        const p = ctx.resume();
        if (p && p.then) p.then(applyMusic).catch(() => {});
      }
      applyMusic();
    } catch (_) { /* 오디오가 지원되지 않아도 게임 진행은 유지 */ }
  }
  function syncButtons() {
    if (typeof document === 'undefined') return;
    [['btnBgm', 'bBgm'], ['btnSfx', 'bSfx']].forEach((ids, kind) => ids.forEach(id => {
      const el = document.getElementById(id); if (!el) return;
      const on = kind ? opt.sfx : opt.bgm;
      el.classList.toggle('on', on); el.classList.toggle('off', !on);
      el.setAttribute('aria-pressed', String(on));
      if (kind) el.textContent = on ? '🔊' : '🔇';
      el.title = (kind ? '효과음 ' : '배경음악 ') + (on ? '켜짐' : '꺼짐') + (kind ? ' (N)' : ' (M)');
    }));
  }
  function setBgm(on) { opt.bgm = !!on; save(); if (on) unlock(); applyMusic(); syncButtons(); }
  function setSfx(on) {
    opt.sfx = !!on; save(); if (on) unlock();
    if (ctx && sfxOutput) glide(sfxOutput.gain, on ? 0.9 : 0, ctx.currentTime, 0.035);
    if (on) play('click'); syncButtons();
  }
  function boot() {
    if (booted) return;
    load(); syncButtons();
    if (typeof document === 'undefined') return;
    booted = true;
    const kick = () => { if (!ctx || ctx.state !== 'running') unlock(); };
    document.addEventListener('pointerdown', kick, true);
    document.addEventListener('keydown', kick, true);
    document.addEventListener('touchstart', kick, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) {
        if (ctx.suspend) { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); }
      } else unlock();
    });
  }
  return {
    boot, unlock, bgm, note, sfx: play, play, setBgm, setSfx, syncButtons, setScene,
    toggleBgm() { setBgm(!opt.bgm); }, toggleSfx() { setSfx(!opt.sfx); },
    get sfxOn() { return opt.sfx; }, get bgmOn() { return opt.bgm; },
    get ready() { return !!ctx && ctx.state === 'running'; }
  };
})();
if (typeof window !== 'undefined') window.Sound = Sound;
