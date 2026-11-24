/* player.js — third-person player controller: on-foot movement, camera, vehicle entry/exit, shooting. */
'use strict';
window.NC = window.NC || {};

NC.Player = (function () {
  const C = CFG, world = NC.World, Input = NC.Input;
  const V = NC.Vehicles, Ch = NC.Characters;

  /** Weapons the player can carry. */
  const WEAPONS = [
    { id: 'fists', name: 'Fists', dmg: 12, rate: 0.4, range: 1.8, ammo: Infinity, auto: false, spread: 0, sound: null },
    { id: 'pistol', name: 'Sidearm 9', dmg: 26, rate: 0.28, range: 70, ammo: 120, auto: false, spread: 0.012, sound: 'pistol' },
    { id: 'smg', name: 'Vector SMG', dmg: 16, rate: 0.08, range: 60, ammo: 200, auto: true, spread: 0.03, sound: 'smg' },
    { id: 'shotgun', name: 'Breacher 12', dmg: 20, rate: 0.75, range: 30, ammo: 40, auto: false, pellets: 6, spread: 0.07, sound: 'shotgun' },
  ];

  function createPlayer() {
    const h = Ch.makeHumanoid({ shirt: 0x111318, pants: 0x1b1d24, skin: 0xd9a07a, isCop: false });
    Ch.giveGun(h);
    // Distinct look: crimson jacket trim
    h.torso.material = new THREE.MeshLambertMaterial({ color: 0xb3202f });
    const player = {
      h,
      x: 0, z: 0, y: 0,
      heading: 0,
      speed: 0,
      health: C.player.maxHealth,
      armor: 0,
      money: 250,
      wanted: 0,
      wantedTimer: 0,
      weaponIndex: 1,
      weapons: WEAPONS.map((w) => ({ ...w, mag: w.ammo, loaded: w.id === 'fists' ? Infinity : 12 })),
      fireCooldown: 0,
      reloading: 0,
      aiming: false,
      vehicle: null,
      nearVehicle: null,
      invuln: 0,
      dead: false,
      walkPhase: 0,
    };
    return player;
  }

  function getWeapon(p) { return p.weapons[p.weaponIndex]; }

  function cycleWeapon(p, dir) {
    const n = p.weapons.length;
    for (let i = 1; i <= n; i++) {
      const idx = (p.weaponIndex + dir * i + n) % n;
      const w = p.weapons[idx];
      if (w.id === 'fists' || w.mag > 0) { p.weaponIndex = idx; NC.Audio.sfx.reload(); return; }
    }
  }

  function damagePlayer(p, amount) {
    if (p.invuln > 0 || p.dead) return;
    let dmg = amount;
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, dmg * 0.6);
      p.armor -= absorbed; dmg -= absorbed;
    }
    p.health -= dmg;
    p.invuln = 0.12;
    NC.Audio.sfx.hurt();
    NC.FX.spawnBlood(p.x, 1.2, p.z, 4);
    if (p.health <= 0) {
      p.health = 0; p.dead = true;
      NC.Game.onPlayerDeath && NC.Game.onPlayerDeath();
    }
  }

  /** Fire the current weapon. dir is a unit heading; returns true if a shot fired. */
  function shoot(p, dirX, dirZ, dt) {
    const w = getWeapon(p);
    if (p.fireCooldown > 0 || p.reloading > 0) return false;
    if (w.id === 'fists') {
      p.fireCooldown = w.rate;
      // melee: hit nearest ped/cop in front
      const targets = NC.Police.getUnits().concat(Ch.getPeds());
      for (const t of targets) {
        if (t.dead) continue;
        const d = Math.sqrt(dist2(t.x, t.z, p.x, p.z));
        if (d < w.range) {
          const toT = Math.atan2(t.x - p.x, t.z - p.z);
          if (Math.abs(angleDelta(p.heading, toT)) < 1.0) {
            hurtTarget(t, w.dmg, p);
            NC.Audio.sfx.hit();
            NC.FX.spawnBlood(t.x, 1.2, t.z, 3);
            return true;
          }
        }
      }
      NC.Audio.sfx.empty();
      return false;
    }
    if (w.loaded <= 0) {
      NC.Audio.sfx.empty();
      p.fireCooldown = 0.3;
      return false;
    }
    p.fireCooldown = w.rate;
    w.loaded--;
    NC.Audio.sfx[w.sound]();
    const pellets = w.pellets || 1;
    let hitSomething = false;
    for (let i = 0; i < pellets; i++) {
      const spread = (Math.random() - 0.5) * w.spread * (pellets > 1 ? 4 : 1);
      const a = Math.atan2(dirX, dirZ) + spread;
      const sx = Math.sin(a), sz = Math.cos(a);
      // trace: nearest target within range along the ray
      const res = raycast(p.x, p.z, sx, sz, w.range, p);
      NC.FX.spawnTracer(p.x + sx * 0.6, 1.3, p.z + sz * 0.6, p.x + sx * (res.dist || w.range * 0.6), 1.3, p.z + sz * (res.dist || w.range * 0.6));
      if (res.hit) {
        hurtTarget(res.target, w.dmg, p);
        NC.FX.spawnBlood(res.target.x, 1.2, res.target.z, 5);
        NC.FX.spawnImpact(res.hitX, 1.2, res.hitZ);
        hitSomething = true;
      }
    }
    return true;
  }

  function hurtTarget(t, dmg, by) {
    if (t.isCop) {
      NC.Police.damageUnit(t, dmg);
      NC.Wanted.addCrime('copKill', t.x, t.z);
    } else if (t.h && t.h.group && t.h.group.userData && t.h.group.userData.isCop) {
      NC.Police.damageUnit(t, dmg);
      NC.Wanted.addCrime('copKill', t.x, t.z);
    } else {
      t.health -= dmg;
      if (t.health <= 0 && !t.dead) {
        t.dead = true;
        NC.Wanted.addCrime('kill', t.x, t.z);
        NC.Game.stats.kills++;
        NC.Missions.notifyKill(t);
      } else if (!t.dead) {
        NC.Wanted.addCrime('bump', t.x, t.z);
      }
    }
  }

  /** Simple 2D raycast against peds/cops. */
  function raycast(ox, oz, dx, dz, range, shooter) {
    let best = { hit: false, dist: range, target: null };
    const units = NC.Police.getUnits().map((u) => ({ ...u, isCop: true })).concat(Ch.getPeds());
    for (const t of units) {
      if (t.dead || (t === shooter)) continue;
      const tx = t.x - ox, tz = t.z - oz;
      const proj = tx * dx + tz * dz;
      if (proj < 0 || proj > range) continue;
      const perp = Math.abs(tx * dz - tz * dx);
      if (perp < 0.6) {
        const d = proj;
        if (d < best.dist) best = { hit: true, dist: d, target: t, hitX: ox + dx * d, hitZ: oz + dz * d };
      }
    }
    // also check vehicle the shooter is not in
    for (const v of V.getTraffic().concat(NC.Police.getCars())) {
      if (v === shooter.vehicle) continue;
      const tx = v.x - ox, tz = v.z - oz;
      const proj = tx * dx + tz * dz;
      if (proj < 0 || proj > range) continue;
      const perp = Math.abs(tx * dz - tz * dx);
      if (perp < 1.4 && proj < best.dist) {
        best = { hit: false, dist: proj, target: null, hitX: ox + dx * proj, hitZ: oz + dz * proj };
        // damage the vehicle a bit
        v.health -= 4;
        if (v.health <= 0 && !v.exploded) { NC.Game.explodeVehicle && NC.Game.explodeVehicle(v); }
      }
    }
    return best;
  }

  function reload(p) {
    const w = getWeapon(p);
    if (w.id === 'fists' || p.reloading > 0) return;
    if (w.loaded >= 12 || w.mag <= 0) return;
    p.reloading = 1.1;
    NC.Audio.sfx.reload();
  }

  /** Nearest stealable vehicle within range. */
  function findNearVehicle(p) {
    let best = null, bestD = 3.6 * 3.6;
    const all = V.getTraffic().concat(NC.Police.getCars());
    for (const v of all) {
      if (v.occupied) continue;
      const d = dist2(v.x, v.z, p.x, p.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  function enterVehicle(p, v) {
    if (!v) return;
    const wasCarjack = v.kind !== 'parked' && !v.isPolice;
    p.vehicle = v;
    v.occupied = true;
    if (v.ai) v.ai.mode = 'player';
    p.h.group.visible = false;
    NC.Audio.sfx.door();
    NC.Audio.startEngine();
    NC.Wanted.addCrime(wasCarjack ? 'carjack' : 'jack', v.x, v.z);
    NC.Game.stats.carsStolen++;
  }

  function exitVehicle(p) {
    const v = p.vehicle;
    if (!v) return;
    // place player beside the car
    const ox = Math.cos(v.heading) * 2.0;
    const oz = -Math.sin(v.heading) * 2.0;
    p.x = v.x + ox; p.z = v.z + oz;
    p.vehicle = null;
    v.occupied = false;
    v.speed *= 0.2;
    if (v.ai) v.ai.mode = 'idle';
    p.h.group.visible = true;
    NC.Audio.sfx.door();
    NC.Audio.stopEngine();
  }

  /** Main player update. cameraDir is the yaw the camera is looking (radians). */
  function update(p, dt, camera) {
    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    if (p.reloading > 0) {
      p.reloading -= dt;
      if (p.reloading <= 0) {
        const w = getWeapon(p);
        const need = 12 - w.loaded;
        const take = Math.min(need, w.mag);
        w.loaded += take; w.mag -= take;
        p.reloading = 0;
      }
    }
    if (p.dead) { animateDeath(p, dt); return; }

    if (p.vehicle) {
      // --- driving ---
      const throttle = (Input.isDown('forward') ? 1 : 0) - (Input.isDown('back') ? 1 : 0);
      const steer = (Input.isDown('right') ? 1 : 0) - (Input.isDown('left') ? 1 : 0);
      const hb = Input.isDown('handbrake');
      V.stepVehicle(p.vehicle, throttle, steer, dt, hb);
      p.x = p.vehicle.x; p.z = p.vehicle.z;
      p.heading = p.vehicle.heading;
      NC.Audio.updateEngine(Math.abs(p.vehicle.speed) / C.car.maxSpeed, true);
      if (Input.wasPressed('enter')) exitVehicle(p);
      // shooting from car (drive-by) — simple forward/aim fire
      p.aiming = false;
    } else {
      // --- on foot ---
      const camYaw = camera.userData.yaw || 0;
      let mx = 0, mz = 0;
      if (Input.isDown('forward')) { mx += Math.sin(camYaw); mz += Math.cos(camYaw); }
      if (Input.isDown('back')) { mx -= Math.sin(camYaw); mz -= Math.cos(camYaw); }
      if (Input.isDown('right')) { mx += Math.cos(camYaw); mz -= Math.sin(camYaw); }
      if (Input.isDown('left')) { mx -= Math.cos(camYaw); mz += Math.sin(camYaw); }
      const len = Math.sqrt(mx * mx + mz * mz);
      const running = Input.isDown('run');
      const target = len > 0 ? (running ? C.player.runSpeed : C.player.walkSpeed) : 0;
      p.speed = approach(p.speed, target, C.player.accel * dt);
      if (len > 0) {
        mx /= len; mz /= len;
        p.heading = angleLerp(p.heading, Math.atan2(mx, mz), 1 - Math.pow(0.0001, dt));
        let nx = p.x + mx * p.speed * dt;
        let nz = p.z + mz * p.speed * dt;
        const r = world.resolveCircle(nx, nz, C.player.radius);
        const cb = world.clampToWorld(r.x, r.z, 2);
        p.x = cb.x; p.z = cb.z;
      }
      p.aiming = Input.isDown('aim');
      if (p.aiming) {
        p.heading = angleLerp(p.heading, camYaw, 1 - Math.pow(0.0001, dt));
      }
      p.h.group.position.set(p.x, 0, p.z);
      p.h.group.rotation.y = p.heading;
      Ch.animateWalk(p.h, (p.walkPhase += dt), p.speed);
      // arm pose when aiming
      p.h.armR.rotation.x = p.aiming ? -1.5 : 0;
      p.h.armR.rotation.y = p.aiming ? 0 : 0;

      NC.Audio.updateEngine(0, false);
      // enter vehicle
      p.nearVehicle = findNearVehicle(p);
      if (Input.wasPressed('enter') && p.nearVehicle) enterVehicle(p, p.nearVehicle);
      // weapons
      if (Input.wasPressed('nextWeapon') || Input.wasPressed('reload')) {
        if (Input.wasPressed('reload')) reload(p);
      }
    }

    // shooting (works on foot and drive-by)
    const fire = Input.isDown('shoot');
    if (fire) {
      const w = getWeapon(p);
      const yaw = camera.userData.yaw || p.heading;
      if (w.auto || !p._fireHeld) {
        shoot(p, Math.sin(yaw), Math.cos(yaw), dt);
      }
      p._fireHeld = true;
    } else p._fireHeld = false;

    if (Input.wasPressed('nextWeapon')) cycleWeapon(p, 1);
    if (Input.wasPressed('reload')) reload(p);
  }

  function animateDeath(p, dt) {
    p.h.group.rotation.x = Math.PI / 2;
  }

  function respawn(p) {
    p.health = C.player.maxHealth;
    p.dead = false;
    p.h.group.rotation.x = 0;
    p.vehicle = null;
    p.h.group.visible = true;
    // respawn at nearest intersection
    const rx = world.nearestRoad(p.x), rz = world.nearestRoad(p.z);
    p.x = rx; p.z = rz;
    p.wanted = 0; p.wantedTimer = 0;
  }

  return {
    createPlayer, update, getWeapon, cycleWeapon, damagePlayer, shoot, reload,
    enterVehicle, exitVehicle, respawn, WEAPONS,
  };
})();
