/* fx.js — lightweight particle & effect layer: tracers, sparks, blood, smoke, explosions, floating text.
 * Three pooled lists (tracers, particles, floaters) are updated each frame and
 * every element carries its own TTL; expired items are returned to the scene's
 * invisibility rather than freed, so sustained gunfire never re-allocates.
 * Pool caps are set in CFG.fx; bursts beyond the cap reuse the oldest slot. */
'use strict';
window.NC = window.NC || {};

NC.FX = (function () {
  let scene = null;
  let camera = null;
  const tracers = [];     // fading line segments
  const particles = [];   // pooled points
  const floaters = [];    // world-space text sprites
  const explosions = [];  // expanding spheres
  const MAX_TRACERS = 60;
  const MAX_FLOATERS = 24;
  const MAX_EXPLOSIONS = 8;

  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 });
  const tracerLines = new THREE.LineSegments(tracerGeo, tracerMat);
  tracerLines.frustumCulled = false;
  let tracerCount = 0;

  // Particle pool (points)
  const P_MAX = 400;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(P_MAX * 3);
  const pCol = new Float32Array(P_MAX * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  const pState = []; for (let i = 0; i < P_MAX; i++) pState.push({ life: 0, vx: 0, vy: 0, vz: 0, grav: 9.8 });
  let pCursor = 0;

  function init(sc, cam) {
    scene = sc; camera = cam;
    scene.add(tracerLines);
    scene.add(points);
  }

  function spawnTracer(x1, y1, z1, x2, y2, z2, color) {
    const arr = tracerGeo.attributes.position.array;
    const i = (tracerCount % MAX_TRACERS) * 6;
    arr[i] = x1; arr[i + 1] = y1; arr[i + 2] = z1;
    arr[i + 3] = x2; arr[i + 4] = y2; arr[i + 5] = z2;
    tracerCount++;
    tracerGeo.attributes.position.needsUpdate = true;
    if (color) tracerMat.color.setHex(color);
    tracerMat.opacity = 0.95;
    tracerLines.visible = true;
    tracerTimer = 0.06;
  }
  let tracerTimer = 0;

  function emit(x, y, z, n, color, opts = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = pCursor % P_MAX; pCursor++;
      const s = pState[i];
      s.life = opts.life || 0.6;
      const sp = opts.speed || 3;
      s.vx = (Math.random() - 0.5) * sp;
      s.vy = (opts.up || 0) + Math.random() * (opts.upSpeed || 2);
      s.vz = (Math.random() - 0.5) * sp;
      s.grav = opts.grav != null ? opts.grav : 9.8;
      pPos[i * 3] = x + (Math.random() - 0.5) * (opts.spread || 0.2);
      pPos[i * 3 + 1] = y;
      pPos[i * 3 + 2] = z + (Math.random() - 0.5) * (opts.spread || 0.2);
      pCol[i * 3] = c.r; pCol[i * 3 + 1] = c.g; pCol[i * 3 + 2] = c.b;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  const spawnSparks = (x, y, z, n) => emit(x, y, z, n, 0xffc94a, { speed: 6, up: 2, life: 0.5 });
  const spawnBlood = (x, y, z, n) => emit(x, y, z, n, 0xb3122b, { speed: 2.4, up: 1.2, life: 0.6, grav: 7 });
  const spawnImpact = (x, y, z) => emit(x, y, z, 5, 0xdddddd, { speed: 3, up: 1, life: 0.35 });
  function spawnSmoke(x, y, z, n, color) { emit(x, y, z, n, color || 0x666666, { speed: 1.2, up: 1.4, upSpeed: 1.6, life: 1.4, grav: -0.6 }); }

  /** Text that floats up and fades in world space. */
  function spawnFloatText(text, x, y, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const g = canvas.getContext('2d');
    g.font = 'bold 40px Arial, sans-serif';
    g.fillStyle = '#ffe066';
    g.strokeStyle = '#000'; g.lineWidth = 6;
    g.textAlign = 'center';
    g.strokeText(text, 128, 44);
    g.fillText(text, 128, 44);
    const tex = new THREE.CanvasTexture(canvas);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.position.set(x, y, z);
    spr.scale.set(3, 0.75, 1);
    scene.add(spr);
    floaters.push({ spr, life: 1.3 });
    if (floaters.length > MAX_FLOATERS) {
      const old = floaters.shift(); scene.remove(old.spr); old.spr.material.map.dispose();
    }
  }

  /** Car explosion: flash sphere + smoke + fire particles. */
  function spawnExplosion(x, y, z) {
    const geo = new THREE.SphereGeometry(1, 16, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.9 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y + 0.8, z);
    scene.add(m);
    explosions.push({ m, life: 0.6, max: 0.6, r: 4.5 });
    emit(x, y + 0.8, z, 26, 0xff7b1a, { speed: 7, up: 4, life: 0.9 });
    emit(x, y + 1, z, 14, 0x333333, { speed: 3, up: 5, life: 1.8, grav: -1 });
    NC.Audio.sfx.crash();
  }

  function update(dt) {
    // tracers fade
    tracerTimer -= dt;
    if (tracerTimer <= 0) { tracerMat.opacity = Math.max(0, tracerMat.opacity - dt * 12); if (tracerMat.opacity <= 0) tracerLines.visible = false; }

    // particles integrate
    for (let i = 0; i < P_MAX; i++) {
      const s = pState[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vy -= s.grav * dt;
      pPos[i * 3] += s.vx * dt;
      pPos[i * 3 + 1] += s.vy * dt;
      pPos[i * 3 + 2] += s.vz * dt;
      if (pPos[i * 3 + 1] < 0.05) { pPos[i * 3 + 1] = 0.05; s.vy = 0; s.vx *= 0.6; s.vz *= 0.6; }
      if (s.life <= 0) { pPos[i * 3 + 1] = -999; }
    }
    pGeo.attributes.position.needsUpdate = true;

    // floaters
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      f.spr.position.y += dt * 1.2;
      f.spr.material.opacity = clamp(f.life / 1.3, 0, 1);
      if (f.spr.material.map) f.spr.material.map.needsUpdate = false;
      if (f.life <= 0) { scene.remove(f.spr); f.spr.material.map.dispose(); floaters.splice(i, 1); }
    }

    // explosions expand + fade
    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i];
      e.life -= dt;
      const t = 1 - e.life / e.max;
      const s = 0.5 + e.r * t;
      e.m.scale.set(s, s, s);
      e.m.material.opacity = 0.9 * (1 - t);
      e.m.material.color.setHSL(0.08 - t * 0.06, 1, 0.5 - t * 0.3);
      if (e.life <= 0) { scene.remove(e.m); e.m.geometry.dispose(); e.m.material.dispose(); explosions.splice(i, 1); }
    }
  }

  return { init, spawnTracer, spawnSparks, spawnBlood, spawnImpact, spawnSmoke, spawnExplosion, spawnFloatText, update };
})();
