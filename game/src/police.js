/* police.js — patrol cars, response to wanted level, foot cops, pursuit and shooting. */
'use strict';
window.NC = window.NC || {};

NC.Police = (function () {
  const C = CFG, world = NC.World, rng = world.rng;
  const V = NC.Vehicles, Ch = NC.Characters;
  let units = [];   // foot cops {x,z,heading,health,dead,h,...}
  let cars = [];    // police cruisers (vehicle objects)
  let spawnTimer = 0;
  let active = false;

  function reset() {
    for (const u of units) if (u.h.group.parent) u.h.group.parent.remove(u.h.group);
    for (const c of cars) if (c.mesh.parent) c.mesh.parent.remove(c.mesh);
    units = []; cars = [];
    spawnTimer = 0; active = false;
  }

  /** Called by Wanted when a crime occurs — dispatch response. */
  function onCrime(x, z, level) {
    active = level > 0;
    if (level >= 1) ensureCars(Math.min(C.police.maxActive, level + 1), x, z);
  }

  function nearestRoadNear(x, z) {
    const rx = world.nearestRoad(x), rz = world.nearestRoad(z);
    // choose the closer of the two road lines
    if (Math.abs(rx - x) < Math.abs(rz - z)) return { x: rx, z };
    return { x, z: rz };
  }

  function spawnCar(nearX, nearZ) {
    const v = V.createVehicle(0xffffff, 'police');
    const spawn = nearestRoadNear(nearX + rng.range(-60, 60), nearZ + rng.range(-60, 60));
    V.placeVehicle(v, spawn.x, spawn.z, rng.range(0, Math.PI * 2));
    v.ai = { mode: 'pursuit', target: null };
    v.mesh.userData.vehicle = v;
    NC.Game.scene.add(v.mesh);
    cars.push(v);
    return v;
  }

  function spawnFootCop(x, z) {
    const h = Ch.makeHumanoid({ shirt: 0x1f3a5f, pants: 0x14202f, skin: rng.pick(Ch.SKIN), isCop: true });
    Ch.giveGun(h);
    const u = {
      h, x, z, heading: 0, health: 60, dead: false,
      isCop: true, fireCooldown: 0, speed: 4.6,
      state: 'pursue', strafe: rng.range(0, Math.PI * 2),
    };
    h.group.userData.isCop = true;
    h.group.position.set(x, 0, z);
    NC.Game.scene.add(h.group);
    units.push(u);
    return u;
  }

  function ensureCars(n, x, z) {
    let guard = 0;
    while (cars.length < n && guard++ < 12) spawnCar(x, z);
  }

  /** Is any cop close enough to see the player (used for wanted decay). */
  function playerVisible() {
    const p = NC.Game.player;
    for (const u of units) {
      if (!u.dead && dist2(u.x, u.z, p.x, p.z) < 30 * 30) return true;
    }
    for (const c of cars) {
      if (!c.occupied && dist2(c.x, c.z, p.x, p.z) < 45 * 45) return true;
    }
    return false;
  }

  function update(dt, player) {
    const level = NC.Wanted.level;
    active = level > 0;
    NC.Audio.updateSiren(active && cars.length > 0, active ? Math.max(0, 1 - nearestCarDist(player) / 60) : 0);

    if (!active) {
      // cops go idle / despawn when far
      for (const c of cars) c.mesh.visible = true;
      return;
    }

    // Maintain the force proportional to wanted level
    spawnTimer -= dt;
    const desiredCars = Math.min(C.police.maxActive, level + 1);
    const desiredCops = level >= 2 ? Math.min(8, (level - 1) * 2) : 0;
    if (spawnTimer <= 0) {
      spawnTimer = C.police.respawn;
      const killMission = NC.Missions.isActive() && NC.Missions.currentStep() && NC.Missions.currentStep().type === 'killcops';
      if (cars.length < desiredCars) spawnCar(player.x, player.z);
      if (!killMission && units.length < desiredCops) {
        // foot cops deploy from a stopped cruiser near the player
        let src = null, best = Infinity;
        for (const c of cars) {
          const d = dist2(c.x, c.z, player.x, player.z);
          if (d < best && d < 40 * 40) { best = d; src = c; }
        }
        if (src) {
          const a = rng.range(0, Math.PI * 2);
          spawnFootCop(src.x + Math.cos(a) * 2.5, src.z + Math.sin(a) * 2.5);
        } else {
          const rp = nearestRoadNear(player.x + rng.range(-30, 30), player.z + rng.range(-30, 30));
          spawnFootCop(rp.x, rp.z);
        }
      }
    }

    // --- cruisers: pursue the player, try to ram / block ---
    for (const c of cars) {
      const d = Math.sqrt(dist2(c.x, c.z, player.x, player.z));
      // strobing light bar while the cruiser is on the job
      if (c.lightBar) {
        const t = (NC.Game.time * 8) % 2 < 1;
        c.lightBar.red.material.color.setHex(t ? 0xff2020 : 0x330000);
        c.lightBar.blue.material.color.setHex(t ? 0x001a66 : 0x2f6bff);
      }
      if (d > 160) { respawnCar(c, player); continue; }
      if (c.occupied) continue;
      // a screenshot/demo can freeze cruisers in a composed pose
      if (c.frozen) { V.stepVehicle(c, 0, 0, dt, true); continue; }
      if (d < 9) {
        // close enough: brake and hold (block)
        V.stepVehicle(c, -0.3, 0, dt, true);
      } else {
        const desired = Math.atan2(player.x - c.x, player.z - c.z);
        const steer = clamp(angleDelta(c.heading, desired), -1, 1);
        const throttle = d < 25 ? 0.8 : 1;
        V.stepVehicle(c, throttle, steer, dt, false);
      }
      // flash siren visually via emissive not needed; audio handles sound
    }

    // --- foot cops: approach, strafe, shoot ---
    for (const u of units) {
      if (u.dead) { u.h.group.rotation.x = Math.PI / 2; continue; }
      u.fireCooldown = Math.max(0, u.fireCooldown - dt);
      const d = Math.sqrt(dist2(u.x, u.z, player.x, player.z));
      if (player.vehicle && d < 6) {
        // player in a car nearby: cops try to yank the door / shoot
      }
      const toP = Math.atan2(player.x - u.x, player.z - u.z);
      u.heading = angleLerp(u.heading, toP, 0.15);
      let mvx = 0, mvz = 0;
      if (d > 12) {
        mvx = Math.sin(toP) * u.speed; mvz = Math.cos(toP) * u.speed;
      } else if (d < 6) {
        mvx = -Math.sin(toP) * u.speed * 0.6; mvz = -Math.cos(toP) * u.speed * 0.6;
      } else {
        u.strafe += dt * 1.4;
        mvx = Math.cos(u.strafe) * u.speed * 0.6; mvz = Math.sin(u.strafe) * u.speed * 0.6;
      }
      let nx = u.x + mvx * dt, nz = u.z + mvz * dt;
      const r = world.resolveCircle(nx, nz, 0.4);
      u.x = r.x; u.z = r.z;
      u.h.group.position.set(u.x, 0, u.z);
      u.h.group.rotation.y = u.heading;
      Ch.animateWalk(u.h, NC.Game.time + u.strafe, Math.sqrt(mvx * mvx + mvz * mvz) * 0.5);
      u.h.armR.rotation.x = -1.4;
      // shoot at player when in range with line of sight (no building check for simplicity)
      if (d < 26 && u.fireCooldown <= 0 && !player.dead) {
        u.fireCooldown = 0.5 + rng.next() * 0.6;
        NC.Audio.sfx.pistol();
        NC.FX.spawnTracer(u.x, 1.3, u.z, player.x, 1.3, player.z, 0xffaa33);
        // accuracy falls with distance
        if (rng.next() < clamp(0.55 - d / 60, 0.12, 0.5)) {
          NC.Player.damagePlayer(player, 8 + rng.next() * 6);
        }
      }
      if (d > 120) removeUnit(u);
    }
  }

  function nearestCarDist(player) {
    let best = Infinity;
    for (const c of cars) best = Math.min(best, Math.sqrt(dist2(c.x, c.z, player.x, player.z)));
    return best;
  }

  function respawnCar(c, player) {
    const rp = nearestRoadNear(player.x + rng.range(-70, 70), player.z + rng.range(-70, 70));
    V.placeVehicle(c, rp.x, rp.z, rng.range(0, Math.PI * 2));
  }

  function removeUnit(u) {
    if (u.h.group.parent) u.h.group.parent.remove(u.h.group);
    units = units.filter((x) => x !== u);
  }
  function removeCar(c) {
    if (c.mesh.parent) c.mesh.parent.remove(c.mesh);
    cars = cars.filter((x) => x !== c);
  }

  function damageUnit(u, dmg) {
    u.health -= dmg;
    if (u.health <= 0 && !u.dead) {
      u.dead = true;
      NC.Game.stats.copsDown++;
      NC.Audio.sfx.hit();
      // drop a small cash reward
      NC.Game.player.money += 50;
      NC.FX.spawnFloatText('+ $50', u.x, 2, u.z);
    }
  }

  function damageCar(c, dmg) {
    c.health -= dmg;
    if (c.health <= 0 && !c.exploded) NC.Game.explodeVehicle(c);
  }

  function getUnits() { return units; }
  function getCars() { return cars; }

  return {
    reset, onCrime, update, playerVisible, damageUnit, damageCar,
    getUnits, getCars, spawnFootCop, spawnCar,
  };
})();
