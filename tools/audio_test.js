/* node tools/audio_test.js <node-web-audio-api module path>
   테스트 전용 의존성: npm install --prefix <별도 폴더> node-web-audio-api
   네이티브 OfflineAudioContext로 잔향/압축을 포함한 PCM을 렌더링한다.
   브라우저 UI나 실제 장치 청취 검사는 포함하지 않는다. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { OfflineAudioContext } = require(process.argv[2] || 'node-web-audio-api');
const source = fs.readFileSync(path.join(__dirname, '../js/audio.js'), 'utf8');
const sampleSource = fs.readFileSync(path.join(__dirname, '../js/sword-samples.js'), 'utf8');
const names = ['click', 'select', 'cmd', 'coin', 'success', 'fail', 'move', 'march', 'taiko', 'turn',
  'chime', 'save', 'load', 'battleStart', 'slash', 'arrow', 'volley', 'charge', 'fire',
  'confuse', 'duel', 'destroy', 'capture', 'win', 'lose', 'victory', 'defeat'];

function harness(duration, saved = {}) {
  let audio, rendered, id = 0, created = 0, seed = 123456, running = false;
  const timers = new Map(), listeners = {}, elements = {}, live = new Set(), playedSamples = [];
  const store = { sangokji_audio_v1: JSON.stringify(saved) };
  function AudioContext() {
    audio = new OfflineAudioContext(2, Math.ceil(duration * 24000), 24000);
    for (const method of ['createOscillator', 'createBufferSource']) {
      const original = audio[method].bind(audio);
      audio[method] = () => {
        const n = original(); created++; live.add(n);
        n.addEventListener('ended', () => live.delete(n));
        if (method === 'createBufferSource') {
          const start = n.start.bind(n);
          n.start = (...args) => {
            if (n.buffer && n.buffer.sampleRate === 44100) playedSamples.push(n.buffer);
            return start(...args);
          };
        }
        return n;
      };
    }
    // 오프라인 렌더링 정지와 브라우저의 가시성/사용자 입력 상태를 분리한다.
    return new Proxy(audio, { get(target, key) {
      if (key === 'state') return running ? 'running' : 'suspended';
      if (key === 'resume') return () => { running = true; return Promise.resolve(); };
      if (key === 'suspend') return () => { running = false; return Promise.resolve(); };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  const math = Object.create(Math);
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const schedule = (fn, ms, repeat) => {
    const key = ++id;
    timers.set(key, { fn, at: (audio ? audio.currentTime : 0) + ms / 1000, interval: repeat ? ms / 1000 : 0 });
    return key;
  };
  const sandbox = {
    window: { AudioContext }, Math: math, Float32Array, atob,
    localStorage: { getItem: k => store[k], setItem: (k, v) => { store[k] = v; } },
    document: {
      hidden: false,
      getElementById: name => elements[name] || (elements[name] = {
        classList: { toggle() {} }, setAttribute(k, v) { this[k] = v; }
      }),
      addEventListener: (name, fn) => { listeners[name] = fn; }
    },
    setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: key => timers.delete(key),
    setTimeout: (fn, ms) => schedule(fn, ms, false), clearTimeout: key => timers.delete(key)
  };
  vm.runInNewContext(sampleSource + '\n' + source, sandbox, { filename: 'audio.js' });
  const sound = sandbox.window.Sound;
  sound.boot();
  async function render(events = []) {
    if (!events.length && !timers.size) {
      rendered = await audio.startRendering();
      await new Promise(resolve => setImmediate(resolve));
      return;
    }
    let event = 0;
    const pauses = [];
    // 네이티브 구현은 렌더링 시작 전에 정지 시점을 예약해야 한다.
    for (let time = 0.08; time < duration - 0.01; time += 0.08) pauses.push(audio.suspend(time));
    const result = audio.startRendering();
    for (const paused of pauses) {
      await paused;
      while (event < events.length && events[event][0] <= audio.currentTime + 0.006) events[event++][1]();
      for (const [key, task] of [...timers]) {
        if (!timers.has(key) || task.at > audio.currentTime) continue;
        if (task.interval) task.at = audio.currentTime + task.interval;
        else timers.delete(key);
        task.fn();
      }
      await audio.resume();
    }
    rendered = await result;
    await new Promise(resolve => setImmediate(resolve));
  }
  function stats(start = 0, end = duration) {
    let peak = 0, sum = 0, count = 0;
    for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
      const channel = new Float32Array(rendered.length); rendered.copyFromChannel(channel, ch);
      for (let i = Math.ceil(start * rendered.sampleRate); i < Math.min(channel.length, Math.floor(end * rendered.sampleRate)); i++) {
        assert(Number.isFinite(channel[i]), 'non-finite PCM sample');
        peak = Math.max(peak, Math.abs(channel[i])); sum += channel[i] ** 2; count++;
      }
    }
    assert(count > 0);
    return { peak, rms: Math.sqrt(sum / count) };
  }
  return { sound, render, stats, listeners, sandbox, store, timers, live, elements, playedSamples,
    get audio() { return audio; }, get created() { return created; } };
}

async function main() {
  const cases = names.map(name => [name, undefined]).concat([['volley', { count: 2 }]]);
  for (const [name, details] of cases) {
    const h = harness(5, { bgm: false }); h.sound.unlock(); h.sound.sfx(name, details);
    await h.render();
    const s = h.stats();
    assert(s.peak > 0.005 && s.peak < 0.9, `${name}: bad peak ${s.peak}`);
    assert.equal(h.live.size, 0, `${name}: sources not released`);
    if (name === 'move' || name === 'march') {
      assert(s.peak < 0.055, `${name}: footsteps too loud`);
      assert(h.stats(0.55).peak < 1e-5, `${name}: movement leaves a long tail`);
      console.log(`PASS: ${name}, soft dry footsteps; peak ${s.peak.toFixed(3)}`);
    }
    if (['slash', 'arrow', 'charge', 'volley', 'duel'].includes(name))
      console.log(`PASS: ${name}${details ? ' (2 units)' : ''}; peak ${s.peak.toFixed(3)}`);
    const bladeCount = { slash: 1, charge: 1, volley: details ? 2 : 3, duel: 2 }[name];
    if (bladeCount) {
      assert.equal(h.playedSamples.length, bladeCount, `${name}: bundled recordings not played`);
      h.playedSamples.forEach((buffer, i) => {
        assert(buffer.duration >= 0.45 && buffer.duration <= 0.53, 'invalid blade recording');
        if (i) assert.notEqual(buffer, h.playedSamples[i - 1], 'same blade recording repeated');
      });
    }
  }
  console.log(`PASS: ${names.length} effects render finite PCM and release sources`);
  for (const [mood, seconds] of [['title', 122], ['map', 101], ['battle', 74]]) {
    const h = harness(seconds + 3); h.sound.bgm(mood);
    h.sound.setScene({theme:'wet',season:1,tension:1});
    assert.equal(h.audio, undefined, 'music must wait for user gesture');
    h.sound.unlock();
    await h.render([[seconds, () => h.sound.setBgm(false)]]);
    const s = h.stats(1, seconds);
    assert(s.peak > 0.02 && s.peak < 0.9 && s.rms > 0.002, `${mood}: invalid levels`);
    assert(h.stats(seconds + 2).peak < 1e-6, `${mood}: mute leaves audio`);
    assert.equal(h.live.size, 0, `${mood}: mute leaves sources`);
    assert.equal(h.timers.size, 0, `${mood}: mute leaves timers`);
    assert(h.stats(seconds*.6,seconds-.5).rms>0.002,`${mood}: development/release section silent`);
    console.log(`PASS: ${mood}, four arrangement sections; peak ${s.peak.toFixed(3)}, RMS ${s.rms.toFixed(4)}; mute cleans up`);
  }
  {
    const h = harness(13); h.sound.bgm('title'); h.sound.unlock();
    const events = [[1, () => {
      const before = h.created;
      for (let i = 0; i < 20; i++) h.sound.bgm('title');
      assert.equal(h.created, before); assert.equal(h.timers.size, 1);
      h.sound.sfx('battleStart');
      const after = h.created; h.sound.sfx('battleStart');
      assert.equal(h.created, after, 'duplicate battle entry cue');
    }]];
    for (let i = 0; i < 24; i++) events.push([1.5 + i * 0.08, () => {
      h.sound.bgm(i % 2 ? 'battle' : 'map');
      assert(h.timers.size <= 4, 'unbounded transition timers');
    }]);
    events.push([4, () => h.sound.sfx('victory')], [4.3, () => {
      h.sound.setSfx(false); h.sound.setBgm(false);
      for (const id of ['btnBgm', 'bBgm', 'btnSfx', 'bSfx'])
        assert.equal(h.elements[id]['aria-pressed'], 'false');
      assert.deepEqual(JSON.parse(h.store.sangokji_audio_v1), { bgm: false, sfx: false });
    }], [7, () => {
      assert.equal(h.live.size, 0); assert.equal(h.timers.size, 0);
      h.sound.setBgm(true);
    }], [8, () => {
      h.sandbox.document.hidden = true; h.listeners.visibilitychange(); assert(!h.sound.ready);
      h.sandbox.document.hidden = false; h.listeners.visibilitychange(); assert(h.sound.ready);
    }], [9, () => h.sound.setBgm(false)]);
    await h.render(events);
    assert(h.stats(6, 7).peak < 1e-6, 'muting leaves tails');
    assert(h.stats(7.2, 9).peak > 0.005, 'music fails to restart');
    assert.equal(h.live.size, 0); assert.equal(h.timers.size, 0);
    const s = h.stats(); assert(s.peak < 0.9, 'transition clips');
    console.log(`PASS: rapid scene changes, cue cooldown, toggles, persistence, visibility; peak ${s.peak.toFixed(3)}`);
  }
  {
    const h = harness(1, { sfx: false, bgm: false });
    h.sound.bgm('battle'); h.sound.unlock(); h.sound.sfx('fire');
    await h.render();
    assert.equal(h.stats().peak, 0); assert.equal(h.timers.size, 0);
    assert.equal(h.sound.sfxOn, false); assert.equal(h.sound.bgmOn, false);
    console.log('PASS: persisted silence on startup');
  }
  console.log('Audio checks passed (native offline rendering; browser UI and device listening not covered).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
