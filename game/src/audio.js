/* audio.js — procedural WebAudio engine: engine drone, gunshots, sirens, impacts, music. No files. */
'use strict';
window.NC = window.NC || {};

NC.Audio = (function () {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let engineNodes = null;
  let sirenNodes = null;
  let musicTimer = null;
  let started = false;
  let muted = false;

  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { ctx = null; return; }
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(master);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.32; musicGain.connect(master);
    started = true;
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  /** Short filtered noise burst — the backbone of gunshots/impacts. */
  function noiseBurst({ dur = 0.2, type = 'lowpass', freq = 1200, q = 1, gain = 0.5, decay = true, dest = null }) {
    if (!ctx) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter(); filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    if (decay) g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(dest || sfxGain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /** One-shot pitched tone. */
  function tone({ freq = 440, dur = 0.15, type = 'square', gain = 0.3, slideTo = null, dest = null, delay = 0 }) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ---- sound palette -------------------------------------------------------
  const sfx = {
    pistol() { noiseBurst({ dur: 0.18, freq: 1800, q: 0.7, gain: 0.55 }); tone({ freq: 220, dur: 0.09, type: 'square', gain: 0.18, slideTo: 70 }); },
    smg() { noiseBurst({ dur: 0.08, freq: 2400, q: 0.9, gain: 0.32 }); },
    shotgun() { noiseBurst({ dur: 0.35, freq: 900, q: 0.5, gain: 0.7 }); tone({ freq: 140, dur: 0.18, type: 'sawtooth', gain: 0.2, slideTo: 50 }); },
    empty() { tone({ freq: 1400, dur: 0.04, type: 'square', gain: 0.12 }); },
    reload() { noiseBurst({ dur: 0.09, freq: 3000, q: 2, gain: 0.3 }); tone({ freq: 600, dur: 0.06, type: 'square', gain: 0.1, delay: 0.12 }); },
    hit() { noiseBurst({ dur: 0.1, freq: 700, gain: 0.35 }); },
    hurt() { tone({ freq: 300, dur: 0.18, type: 'sawtooth', gain: 0.22, slideTo: 120 }); },
    crash() { noiseBurst({ dur: 0.4, freq: 500, q: 0.4, gain: 0.6 }); tone({ freq: 110, dur: 0.25, type: 'sawtooth', gain: 0.18, slideTo: 40 }); },
    door() { noiseBurst({ dur: 0.12, freq: 400, gain: 0.3 }); },
    pickup() { tone({ freq: 660, dur: 0.09, type: 'square', gain: 0.2 }); tone({ freq: 990, dur: 0.12, type: 'square', gain: 0.2, delay: 0.09 }); },
    cash() { tone({ freq: 880, dur: 0.07, type: 'triangle', gain: 0.22 }); tone({ freq: 1320, dur: 0.1, type: 'triangle', gain: 0.22, delay: 0.07 }); },
    mission() { tone({ freq: 523, dur: 0.12, type: 'square', gain: 0.2 }); tone({ freq: 659, dur: 0.12, type: 'square', gain: 0.2, delay: 0.12 }); tone({ freq: 784, dur: 0.2, type: 'square', gain: 0.2, delay: 0.24 }); },
    fail() { tone({ freq: 392, dur: 0.2, type: 'sawtooth', gain: 0.2 }); tone({ freq: 262, dur: 0.3, type: 'sawtooth', gain: 0.2, delay: 0.2 }); },
    star() { tone({ freq: 1200, dur: 0.1, type: 'square', gain: 0.2, slideTo: 1600 }); },
  };

  // ---- continuous engine drone --------------------------------------------
  function startEngine() {
    if (!ctx || engineNodes) return;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 30;
    const g = ctx.createGain(); g.gain.value = 0;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 500;
    o1.connect(filt); o2.connect(filt); filt.connect(g); g.connect(master);
    o1.start(); o2.start();
    engineNodes = { o1, o2, g, filt };
  }
  function updateEngine(speedRatio, inCar) {
    if (!engineNodes) return;
    const target = inCar ? 0.05 + speedRatio * 0.09 : 0;
    engineNodes.g.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
    const f = 50 + speedRatio * 180;
    engineNodes.o1.frequency.setTargetAtTime(f, ctx.currentTime, 0.1);
    engineNodes.o2.frequency.setTargetAtTime(f / 2, ctx.currentTime, 0.1);
    engineNodes.filt.frequency.setTargetAtTime(300 + speedRatio * 900, ctx.currentTime, 0.1);
  }
  function stopEngine() {
    if (!engineNodes) return;
    engineNodes.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  }

  // ---- police siren (two-tone wail) ---------------------------------------
  function startSiren() {
    if (!ctx || sirenNodes) return;
    const o = ctx.createOscillator(); o.type = 'triangle';
    const g = ctx.createGain(); g.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.7;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 180;
    lfo.connect(lfoGain); lfoGain.connect(o.frequency);
    o.frequency.value = 720;
    o.connect(g); g.connect(master);
    o.start(); lfo.start();
    sirenNodes = { o, g, lfo };
  }
  function updateSiren(active, proximity) {
    if (!sirenNodes) return;
    const t = ctx.currentTime;
    sirenNodes.g.gain.setTargetAtTime(active ? 0.02 + proximity * 0.06 : 0, t, 0.2);
  }

  // ---- simple looping synthwave backing track ------------------------------
  const PROG = [220, 174.61, 196, 146.83]; // A F G D — moody synth loop
  let step = 0;
  function startMusic() {
    if (!ctx || musicTimer) return;
    const beat = () => {
      if (!ctx || muted) return;
      const root = PROG[Math.floor(step / 4) % PROG.length];
      // bass
      tone({ freq: root / 2, dur: 0.28, type: 'sawtooth', gain: 0.18, dest: musicGain });
      // arp
      const arp = [1, 1.5, 2, 1.5][step % 4];
      tone({ freq: root * arp * 2, dur: 0.18, type: 'triangle', gain: 0.07, dest: musicGain });
      // hat
      if (step % 2 === 1) noiseBurst({ dur: 0.05, type: 'highpass', freq: 6000, gain: 0.06, dest: musicGain });
      step++;
    };
    musicTimer = setInterval(beat, 250);
  }
  function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

  function setMuted(v) {
    muted = v;
    if (master) master.gain.value = v ? 0 : 0.8;
  }

  return {
    init, resume, sfx, startEngine, updateEngine, stopEngine,
    startSiren, updateSiren, startMusic, stopMusic, setMuted,
    get started() { return started; }, get ctx() { return ctx; },
  };
})();
