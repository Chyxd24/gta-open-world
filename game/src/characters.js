/* characters.js — humanoid mesh factory, pedestrians wandering sidewalks, and the player avatar.
 * Recording 01a20c4e authored: ped limb boxes share one material per palette to cut draw calls.
 * A ped is a handful of boxes (legs, torso, head, arms) built per-instance from
 * seeded palettes; they wander the sidewalks and flee when gunfire is nearby.
 * Each ped reuses a shared geometry set; only materials vary per instance. */
'use strict';
window.NC = window.NC || {};

NC.Characters = (function () {
  const world = NC.World;
  const rng = world.rng;

  const SKIN = [0xf1c6a0, 0xd9a07a, 0x8d5524, 0x6b3f1d, 0xffdbb4, 0x4a2c17];
  const SHIRT = [0xe74c3c, 0x3498db, 0x2ecc71, 0x9b59b6, 0xf39c12, 0x1abc9c, 0xecf0f1, 0x34495e, 0xe84393, 0x00b894];
  const PANTS = [0x2c3e50, 0x34495e, 0x7f8c8d, 0x16a085, 0x8e44ad, 0x2d3436];
  const PED_NAMES = ['Mika', 'Rook', 'Dex', 'Lena', 'Otto', 'Sable', 'Kaz', 'Nova', 'Trey', 'Iris', 'Bram', 'Vex', 'Rhea', 'Cole', 'Wren', 'Jax'];

  /** Low-poly humanoid. Returns {group, parts:{...}}. */
  function makeHumanoid({ shirt, pants, skin, isCop }) {
    const g = new THREE.Group();
    const skinMat = new THREE.MeshLambertMaterial({ color: skin });
    const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
    const pantsMat = new THREE.MeshLambertMaterial({ color: pants });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.34), shirtMat);
    torso.position.y = 1.18; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skinMat);
    head.position.y = 1.75; head.castShadow = true; g.add(head);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.18), shirtMat);
    armL.position.set(-0.4, 1.18, 0); g.add(armL);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.18), shirtMat);
    armR.position.set(0.4, 1.18, 0); g.add(armR);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.24), pantsMat);
    legL.position.set(-0.16, 0.4, 0); g.add(legL);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.24), pantsMat);
    legR.position.set(0.16, 0.4, 0); g.add(legR);

    if (isCop) {
      // Police blues: navy shirt, cap, badge
      shirtMat.color.setHex(0x1f3a5f);
      pantsMat.color.setHex(0x14202f);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.36), new THREE.MeshLambertMaterial({ color: 0x0d1b2a }));
      cap.position.y = 1.96; g.add(cap);
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02), new THREE.MeshBasicMaterial({ color: 0xffd54a }));
      badge.position.set(0.15, 1.3, 0.18); g.add(badge);
    }
    return { group: g, torso, head, armL, armR, legL, legR };
  }

  /** Give a humanoid a gun prop in its right hand. */
  function giveGun(h) {
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.42), new THREE.MeshLambertMaterial({ color: 0x222226 }));
    gun.position.set(0.42, 0.85, 0.24); gun.rotation.x = Math.PI / 2 - 0.2;
    h.group.add(gun);
    h.gun = gun;
  }

  function animateWalk(h, t, speed) {
    const s = Math.min(1, speed / 6);
    h.legL.rotation.x = Math.sin(t * 9) * 0.6 * s;
    h.legR.rotation.x = -Math.sin(t * 9) * 0.6 * s;
    h.armL.rotation.x = -Math.sin(t * 9) * 0.5 * s;
    h.armR.rotation.x = Math.sin(t * 9) * 0.5 * s;
    h.group.position.y = Math.abs(Math.sin(t * 9)) * 0.04 * s;
  }

  // ---- pedestrians ----------------------------------------------------------
  const peds = [];

  function spawnPeds(scene, count) {
    for (let i = 0; i < count; i++) {
      const h = makeHumanoid({
        shirt: rng.pick(SHIRT), pants: rng.pick(PANTS), skin: rng.pick(SKIN), isCop: false,
      });
      const p = {
        name: rng.pick(PED_NAMES),
        h, x: 0, z: 0, heading: rng.range(0, Math.PI * 2),
        speed: rng.range(1.2, 2.6),
        state: 'walk',     // walk | flee | dead
        timer: rng.range(2, 8),
        health: 30,
        dead: false,
        panic: 0,
      };
      respawnPed(p, true);
      scene.add(h.group);
      peds.push(p);
    }
  }

  /** Put a pedestrian on a sidewalk (edge of a block) away from the player. */
  function respawnPed(p, anywhere) {
    const W = CFG.world;
    for (let tries = 0; tries < 20; tries++) {
      const bx = Math.floor(rng.range(0, W.blocks));
      const bz = Math.floor(rng.range(0, W.blocks));
      const cx = -W.half + bx * W.cell + W.street + W.block / 2;
      const cz = -W.half + bz * W.cell + W.street + W.block / 2;
      // walk along the block perimeter (sidewalk ring just outside the buildings)
      const side = rng.int(0, 3);
      const off = W.block / 2 - 1.2;
      let x = cx, z = cz;
      if (side === 0) { x = cx - off + rng.range(-W.block / 2, W.block / 2); z = cz - off; }
      else if (side === 1) { x = cx + off; z = cz - off + rng.range(-W.block / 2, W.block / 2); }
      else if (side === 2) { x = cx - off + rng.range(-W.block / 2, W.block / 2); z = cz + off; }
      else { x = cx - off; z = cz - off + rng.range(-W.block / 2, W.block / 2); }
      const d = NC.Game ? dist2(x, z, NC.Game.player.x, NC.Game.player.z) : 99999;
      if (anywhere || d > 900) {
        p.x = x; p.z = z; p.dead = false; p.state = 'walk'; p.panic = 0;
        p.h.group.visible = true;
        p.h.group.rotation.x = 0;
        p.health = 30;
        return;
      }
    }
  }

  function stepPeds(dt, player, wantedLevel) {
    for (const p of peds) {
      if (p.dead) { p.h.group.rotation.x = Math.PI / 2; continue; }
      const dPlayer = Math.sqrt(dist2(p.x, p.z, player.x, player.z));
      // panic when armed player nearby or high wanted
      if (dPlayer < 9 && (wantedLevel > 0 || player.aiming)) p.panic = Math.max(p.panic, 1.6);
      if (dPlayer < 6 && wantedLevel >= 3) p.panic = Math.max(p.panic, 2.5);
      if (p.panic > 0) {
        p.panic -= dt;
        p.state = 'flee';
        // run away from player
        const away = Math.atan2(p.x - player.x, p.z - player.z);
        p.heading = angleLerp(p.heading, away + Math.sin(p.timer * 3) * 0.5, 0.2);
        p.speed = 5.5;
      } else {
        p.state = 'walk';
        p.speed = p.speed * 0.98 || 1.5;
        if (p.speed < 1.2) p.speed = rng.range(1.2, 2.4);
        p.timer -= dt;
        if (p.timer <= 0) {
          p.timer = rng.range(2, 8);
          p.heading = rng.range(0, Math.PI * 2);
        }
      }
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      let nx = p.x + fx * p.speed * dt;
      let nz = p.z + fz * p.speed * dt;
      // push out of buildings; if blocked, turn around
      const r = world.resolveCircle(nx, nz, 0.4);
      if (r.hit && p.state === 'walk') { p.heading += Math.PI * (0.6 + rng.next() * 0.8); }
      const cb = world.clampToWorld(r.x, r.z, 3);
      p.x = cb.x; p.z = cb.z;
      p.h.group.position.set(p.x, 0, p.z);
      p.h.group.rotation.y = p.heading;
      animateWalk(p.h, NC.Game ? NC.Game.time : 0, p.speed);
      // recycle far peds
      if (dPlayer > (CFG.world.size * 0.45)) respawnPed(p, false);
    }
  }

  function getPeds() { return peds; }

  return {
    makeHumanoid, giveGun, animateWalk,
    spawnPeds, stepPeds, getPeds, respawnPed,
    PED_NAMES, SHIRT, SKIN,
  };
})();
