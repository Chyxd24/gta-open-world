/* game.js — the Neon City runtime: boots three.js, wires every system, runs the loop,
 * Recording 01a20c4e authored: fixed-timestep accumulator guards the physics loop.
 * owns the camera, the start/pause/death flow, and the save hooks.
 * Load order is defined in index.html; this file is the orchestrator (NC.Game).
 * The main loop is a fixed-clock requestAnimationFrame driven by NC.Game.tick.
 */
'use strict';
window.NC = window.NC || {};

NC.Game = (function () {
  let renderer, scene, camera, clock;
  let started = false;
  let paused = false;
  let started3D = false;
  const stats = { kills: 0, copsDown: 0, carsStolen: 0, missionsDone: 0, earned: 0 };

  const game = {
    get renderer() { return renderer; },
    get scene() { return scene; },
    get camera() { return camera; },
    get player() { return player; },
    set player(v) { player = v; },
    get stats() { return stats; },
    get time() { return clock ? clock.elapsedTime : 0; },
    set time(v) { if (clock) clock.elapsedTime = v; },
    paused: false,
  };
  let player = null;

  // ---- boot ---------------------------------------------------------------
  function boot() {
    const canvas = document.getElementById('gameCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.1, 600);
    camera.userData.yaw = 0;
    camera.userData.pitch = 0.18;
    clock = new THREE.Clock(false);

    NC.World.build(scene);
    NC.FX.init(scene, camera);
    NC.Missions.init(scene);

    player = NC.Player.createPlayer();
    scene.add(player.h.group);
    // spawn near an intersection on the main strip
    player.x = 0; player.z = 0;

    NC.Vehicles.spawnTraffic(scene, CFG.traffic.count);
    NC.Characters.spawnPeds(scene, CFG.peds.count);

    NC.Input.attach(canvas);
    NC.HUD.build();

    // menus
    wireMenus(canvas);

    window.addEventListener('resize', onResize);

    game.player = player;
    window.NC_Game = game;   // handy for debugging / headless capture

    // start render loop even before play so the start screen has a backdrop
    started3D = true;
    animate();
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---- menus --------------------------------------------------------------
  function wireMenus(canvas) {
    const startScreen = document.getElementById('startScreen');
    const pauseScreen = document.getElementById('pauseScreen');
    const deathScreen = document.getElementById('deathScreen');
    const missionScreen = document.getElementById('missionScreen');
    const briefEl = document.getElementById('missionBrief');

    const btnNew = document.getElementById('btnNew');
    const btnContinue = document.getElementById('btnContinue');
    const btnResume = document.getElementById('btnResume');
    const btnRestart = document.getElementById('btnRestart');
    const btnRespawn = document.getElementById('btnRespawn');
    const btnNext = document.getElementById('btnNext');

    const hasSave = NC.Save.has();
    btnContinue.disabled = !hasSave;

    function begin(newGame) {
      NC.Audio.init(); NC.Audio.resume(); NC.Audio.startMusic();
      if (newGame) {
        NC.Save.clear();
        NC.Wanted.reset(); NC.Police.reset();
      } else {
        const data = NC.Save.load();
        if (data) NC.Save.apply(player, data);
      }
      startScreen.classList.add('hidden');
      started = true; paused = false; game.paused = false;
      clock.start();
      NC.Input.enabled = true;
      NC.Input.requestLock(canvas);
      NC.HUD.toast(newGame ? 'WELCOME TO NEON CITY' : 'SAVE LOADED');
    }

    btnNew.onclick = () => begin(true);
    btnContinue.onclick = () => begin(false);

    function pauseGame() {
      if (!started || player.dead) return;
      paused = true; game.paused = true;
      pauseScreen.classList.remove('hidden');
      NC.Input.exitLock();
      NC.Input.enabled = false;
      NC.Save.save(player);
    }
    function resumeGame() {
      paused = false; game.paused = false;
      pauseScreen.classList.add('hidden');
      NC.Input.enabled = true;
      NC.Input.requestLock(canvas);
      NC.Audio.resume();
    }

    btnResume.onclick = resumeGame;
    btnRestart.onclick = () => { location.reload(); };
    btnRespawn.onclick = () => {
      deathScreen.classList.add('hidden');
      NC.Player.respawn(player);
      NC.Wanted.reset(); NC.Police.reset();
      player.money = Math.max(0, Math.floor(player.money * 0.9));
      NC.Input.enabled = true;
      NC.Input.requestLock(canvas);
      paused = false; game.paused = false;
      NC.Save.save(player);
    };
    btnNext.onclick = () => {
      missionScreen.classList.add('hidden');
      NC.Missions.advance();
      NC.Input.enabled = true;
      NC.Input.requestLock(canvas);
      paused = false; game.paused = false;
    };
    // ESC toggles pause
    NC.Input.on('key', (code, down) => {
      if (code === 'Escape' && down && started && !player.dead) {
        if (paused) resumeGame(); else pauseGame();
      }
    });

    // expose so player.js / game can open the death + mission screens
    game.onPlayerDeath = () => {
      NC.Audio.sfx.fail();
      deathScreen.classList.remove('hidden');
      document.getElementById('deathStats').textContent =
        `Kills ${stats.kills} · Cars stolen ${stats.carsStolen} · Cash $${player.money}`;
      NC.Input.exitLock();
      NC.Input.enabled = false;
      NC.Save.clear();
    };
    game.pause = pauseGame;
    game.resume = resumeGame;
    game.begin = begin;

    // Mission passed screen
    const origPassed = NC.HUD.showMissionPassed;
    NC.HUD.showMissionPassed = (m) => {
      origPassed(m);
      stats.missionsDone++;
      setTimeout(() => {
        if (!started) return;
        document.getElementById('missionTitle').textContent = m.title.toUpperCase();
        document.getElementById('missionReward').textContent = '+ $' + m.reward;
        document.getElementById('missionStats').textContent =
          `Kills ${stats.kills} · Cars stolen ${stats.carsStolen} · Cash $${player.money}`;
        briefEl.textContent = NC.Missions.hasNext()
          ? 'Rook has more work for you. Rest up, then hit the next marker.'
          : 'You\'ve taken Neon City. The strip is yours.';
        missionScreen.classList.remove('hidden');
        NC.Input.exitLock();
        NC.Input.enabled = false;
        paused = true; game.paused = true;
      }, 1600);
    };
  }

  // ---- camera -------------------------------------------------------------
  function updateCamera(dt) {
    const p = player;
    let targetX, targetZ, targetY, dist, height;
    if (p.vehicle) {
      dist = CFG.camera.carDist; height = CFG.camera.carHeight;
      // camera trails behind the car heading but eases toward mouse orbit
      const look = p.vehicle.heading;
      const pitch = camera.userData.pitch;
      const back = dist * Math.cos(pitch);
      targetX = p.vehicle.x - Math.sin(look) * back;
      targetZ = p.vehicle.z - Math.cos(look) * back;
      targetY = height + Math.sin(pitch) * dist;
      camera.userData.yaw = angleLerp(camera.userData.yaw, look, 1 - Math.pow(0.001, dt));
    } else {
      dist = CFG.camera.dist * (camera.userData.distBoost || 1); height = CFG.camera.height;
      // orbit by mouse
      const m = NC.Input.consumeMouse();
      camera.userData.yaw -= m.dx * 0.0022;
      camera.userData.pitch = clamp(camera.userData.pitch + m.dy * 0.0022, -0.5, 0.7);
      const yaw = camera.userData.yaw, pitch = camera.userData.pitch;
      targetX = p.x - Math.sin(yaw) * Math.cos(pitch) * dist;
      targetZ = p.z - Math.cos(yaw) * Math.cos(pitch) * dist;
      targetY = CFG.player.eyeHeight + Math.sin(pitch) * dist;
    }
    // smooth follow
    const k = 1 - Math.pow(0.0001, dt);
    camera.position.x = lerp(camera.position.x, targetX, k);
    camera.position.z = lerp(camera.position.z, targetZ, k);
    camera.position.y = lerp(camera.position.y, targetY, k);
    camera.lookAt(p.x, (p.vehicle ? 1.4 : CFG.player.eyeHeight), p.z);
    // keep camera out of buildings: pull it toward the player until clear (occlusion)
    pullCameraIn(p);
  }

  /** If a building sits between the player and the camera, pull the camera in front of it. */
  function pullCameraIn(p) {
    const colliders = NC.World.colliders;
    const px = p.x, pz = p.z;
    let cx = camera.position.x, cz = camera.position.z;
    const dx = cx - px, dz = cz - pz;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const ux = dx / dist, uz = dz / dist;
    // walk from the player outward; stop at the first collider we'd enter
    let maxT = dist;
    for (const c of colliders) {
      // ray vs AABB (2D), only if camera is roughly at building height
      const t = rayAABB(px, pz, ux, uz, c);
      if (t !== null && t < maxT) maxT = Math.max(1.2, t - 0.8);
    }
    if (maxT < dist) {
      camera.position.x = px + ux * maxT;
      camera.position.z = pz + uz * maxT;
    }
  }

  /** Distance along ray (ox,oz)+t*(ux,uz) to enter an AABB collider, or null. */
  function rayAABB(ox, oz, ux, uz, c) {
    const minX = c.x - c.hx, maxX = c.x + c.hx;
    const minZ = c.z - c.hz, maxZ = c.z + c.hz;
    let tmin = 0, tmax = Infinity;
    for (const [o, u, lo, hi] of [[ox, ux, minX, maxX], [oz, uz, minZ, maxZ]]) {
      if (Math.abs(u) < 1e-6) {
        if (o < lo || o > hi) return null;
      } else {
        let t1 = (lo - o) / u, t2 = (hi - o) / u;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin > 0 ? tmin : null;
  }

  // ---- interaction prompts + car crash hook -------------------------------
  function updatePrompt() {
    const p = player;
    if (p.vehicle) { NC.HUD.setPrompt('E — exit vehicle'); return; }
    const near = p.nearVehicle;
    if (near) {
      NC.HUD.setPrompt(`E — ${near.isPolice ? 'steal police cruiser' : 'steal'} ${near.name}`);
    } else {
      NC.HUD.setPrompt('');
    }
  }

  game.onCarCrash = (v, speed) => {
    // small wanted bump for reckless driving into things when cops are watching
    if (NC.Wanted.level > 0) NC.Wanted.addCrime('bump', v.x, v.z);
    NC.FX.spawnSparks(v.x, 1, v.z, 8);
  };

  game.explodeVehicle = (v) => {
    if (v.exploded) return;
    v.exploded = true;
    NC.FX.spawnExplosion(v.x, 0.5, v.z);
    v.mesh.visible = false;
    // damage nearby
    const p = player;
    if (Math.sqrt(dist2(p.x, p.z, v.x, v.z)) < 6) NC.Player.damagePlayer(p, 35);
    if (p.vehicle === v) { NC.Player.exitVehicle(p); NC.Player.damagePlayer(p, 25); }
    // remove from lists after a beat
    setTimeout(() => {
      if (v.mesh.parent) v.mesh.parent.remove(v.mesh);
    }, 400);
  };

  // ---- main loop ----------------------------------------------------------
  // dt is capped so a background tab (which throttles rAF) can't hand the sim a
  // huge single step and teleport cars through walls on the next frame.
  const MAX_DT = 0.05;      // seconds; anything larger is treated as a hiccup
  const IDLE_DT = 0.016;    // nominal step used before the game has started

  function animate() {
    requestAnimationFrame(animate);
    const rawDt = clock && started ? clock.getDelta() : IDLE_DT;
    const dt = Math.min(rawDt, MAX_DT);
    const time = clock ? clock.elapsedTime : 0;

    if (started && !paused && !player.dead) {
      NC.Player.update(player, dt, camera);
      NC.Vehicles.updateAll(dt, player);
      NC.Vehicles.recycle(player);
      NC.Characters.stepPeds(dt, player, NC.Wanted.level);
      NC.Police.update(dt, player);
      NC.Wanted.update(dt);
      NC.Missions.update(dt);
      NC.HUD.update(player);
      updatePrompt();
      NC.FX.update(dt);

      // sun follows player so shadows stay crisp
      if (NC.World.sun) {
        NC.World.sun.position.set(player.x + 70, 120, player.z + 45);
        NC.World.sun.target.position.set(player.x, 0, player.z);
        NC.World.sun.target.updateMatrixWorld();
      }
    } else {
      // idle: gentle camera drift for the start screen backdrop
      const t = time * 0.05;
      camera.position.set(Math.sin(t) * 40, 22, Math.cos(t) * 40);
      camera.lookAt(0, 4, 0);
      NC.FX.update(dt);
    }

    if (started && !paused) {
      updateCamera(dt);
      NC.HUD.drawMinimap(player, time);
    }

    renderer.render(scene, camera);
  }

  return Object.assign(game, { boot, animate, updateCamera });
})();

// Boot once DOM + three.js are ready.
window.addEventListener('DOMContentLoaded', () => {
  if (window.THREE) NC.Game.boot();
  else window.addEventListener('load', () => NC.Game.boot());
});
