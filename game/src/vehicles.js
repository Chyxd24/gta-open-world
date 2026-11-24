/* vehicles.js — car mesh factory, arcade car physics, traffic AI and car stealing. */
'use strict';
window.NC = window.NC || {};

NC.Vehicles = (function () {
  const C = CFG, W = C.world;
  const world = NC.World;
  const rng = world.rng;

  const CAR_COLORS = [0xc0392b, 0x2c7be5, 0x27ae60, 0xf1c40f, 0xe67e22, 0x8e44ad, 0xecf0f1, 0x2c3e50, 0x16a085, 0xd35400];
  const CAR_NAMES = ['Viper GT', 'Marlin', 'Cabbie', 'Bruiser', 'Comet', 'Duke', 'Panda Van', 'Raptor', 'Stinger', 'Nomad'];

  /** Build a low-poly car mesh. Returns {group, wheels, body}. */
  function makeCarMesh(color) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1f });
    const glassMat = new THREE.MeshBasicMaterial({ color: 0x7fb4d8 });

    // chassis
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.4), bodyMat);
    body.position.y = 0.75; body.castShadow = true;
    group.add(body);
    // cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), bodyMat);
    cabin.position.set(0, 1.35, -0.2); cabin.castShadow = true;
    group.add(cabin);
    // windshield / rear glass
    const ws = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.08), glassMat);
    ws.position.set(0, 1.35, 0.95); group.add(ws);
    const rg = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.08), glassMat);
    rg.position.set(0, 1.35, -1.35); group.add(rg);
    // headlights + taillights
    const lightGeo = new THREE.BoxGeometry(0.4, 0.18, 0.06);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    for (const sx of [-0.65, 0.65]) {
      const hl = new THREE.Mesh(lightGeo, headMat); hl.position.set(sx, 0.8, 2.21); group.add(hl);
      const tl = new THREE.Mesh(lightGeo, tailMat); tl.position.set(sx, 0.8, -2.21); group.add(tl);
    }
    // wheels
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheels = [];
    for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
      const w = new THREE.Mesh(wheelGeo, darkMat);
      w.position.set(wx, 0.42, wz); w.castShadow = true;
      group.add(w); wheels.push(w);
    }
    return { group, wheels, body };
  }

  /** Create a drivable vehicle instance. */
  function createVehicle(color, kind) {
    const c = color != null ? color : rng.pick(CAR_COLORS);
    const m = makeCarMesh(c);
    const v = {
      mesh: m.group, wheels: m.wheels,
      x: 0, z: 0, y: 0,
      heading: 0,
      speed: 0,
      steer: 0,
      name: rng.pick(CAR_NAMES),
      color: c,
      kind: kind || 'civilian',
      health: 100,
      isPolice: kind === 'police',
      occupied: false,
      ai: null,      // traffic/pursuit controller
      siren: null,
      width: 2.0, length: 4.4,
    };
    if (v.isPolice) {
      // police livery: white body, blue stripe, light bar
      m.body.material.color.setHex(0xf2f4f7);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.22, 4.42), new THREE.MeshBasicMaterial({ color: 0x1f5fd0 }));
      stripe.position.y = 0.78; v.mesh.add(stripe);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.18, 0.5), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      bar.position.set(0, 1.72, -0.2); v.mesh.add(bar);
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.52), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
      red.position.set(-0.33, 1.72, -0.2); v.mesh.add(red);
      const blue = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.52), new THREE.MeshBasicMaterial({ color: 0x2050ff }));
      blue.position.set(0.33, 1.72, -0.2); v.mesh.add(blue);
      v.lightBar = { red, blue };
    }
    return v;
  }

  function placeVehicle(v, x, z, heading) {
    v.x = x; v.z = z; v.heading = heading; v.speed = 0;
    v.mesh.position.set(x, v.y, z);
    v.mesh.rotation.y = heading;
  }

  /**
   * Arcade car physics step.
   * throttle: -1..1, steerIn: -1..1, dt seconds, brake: bool.
   */
  function stepVehicle(v, throttle, steerIn, dt, handbrake) {
    const P = C.car;
    // engine / brake
    if (throttle > 0) v.speed += throttle * P.engineForce * dt * (1 - Math.abs(v.speed) / P.maxSpeed);
    else if (throttle < 0) {
      if (v.speed > 0.5) v.speed += throttle * P.brakeForce * dt;
      else v.speed += throttle * P.engineForce * dt * 0.5 * (1 - Math.abs(v.speed) / P.maxReverse);
    }
    // drag + rolling resistance
    v.speed -= v.speed * P.drag * dt;
    if (Math.abs(v.speed) < 0.02) v.speed = 0;

    // steering scales down with speed
    const steerAmount = P.steering * (1 / (1 + Math.abs(v.speed) * 0.05));
    v.steer = approach(v.steer, steerIn, dt * 6);
    if (Math.abs(v.speed) > 0.1) {
      const dir = v.speed >= 0 ? 1 : -1;
      v.heading += v.steer * steerAmount * dir * dt * Math.min(1, Math.abs(v.speed) / 6);
    }

    // integrate
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let nx = v.x + fx * v.speed * dt;
    let nz = v.z + fz * v.speed * dt;

    // building collision: circle vs boxes at front and rear axle
    const radius = 1.3;
    const front = world.resolveCircle(nx + fx * 1.2, nz + fz * 1.2, radius);
    const rear = world.resolveCircle(nx - fx * 1.2, nz - fz * 1.2, radius);
    const hit = front.hit || rear.hit;
    const cx = (front.x + rear.x) / 2 - fx * 0;
    const cz = (front.z + rear.z) / 2;
    nx = cx; nz = cz;
    if (hit && Math.abs(v.speed) > 8) {
      NC.Audio.sfx.crash();
      NC.FX.spawnSparks(v.mesh.position.x, 1, v.mesh.position.z, 10);
      NC.Game.onCarCrash && NC.Game.onCarCrash(v, Math.abs(v.speed));
    }
    if (hit) v.speed *= 0.4;

    const cb = world.clampToWorld(nx, nz, 3);
    v.x = cb.x; v.z = cb.z;

    v.mesh.position.set(v.x, 0, v.z);
    v.mesh.rotation.y = v.heading;
    // body roll on turns
    v.mesh.rotation.z = lerp(v.mesh.rotation.z, -v.steer * Math.min(1, Math.abs(v.speed) / 20) * 0.06, 0.1);
    // wheel spin + steer
    for (let i = 0; i < v.wheels.length; i++) {
      v.wheels[i].rotation.x -= v.speed * dt * 2.2;
      if (i < 2) v.wheels[i].rotation.y = v.steer * 0.4;
    }
    return hit;
  }

  // ---- traffic AI -----------------------------------------------------------
  const traffic = [];

  function spawnTraffic(scene, count) {
    for (let i = 0; i < count; i++) {
      const v = createVehicle();
      const lane = rng.pick(world.lanes);
      placeVehicle(v, lane.x, lane.z, lane.dir === 'z+' ? 0 : lane.dir === 'z-' ? Math.PI : lane.dir === 'x+' ? Math.PI / 2 : -Math.PI / 2);
      v.speed = rng.range(4, C.traffic.speed);
      v.ai = { mode: 'lane', lane, timer: 0 };
      v.mesh.userData.vehicle = v;
      scene.add(v.mesh);
      traffic.push(v);
    }
  }

  /** Drive a traffic car along roads; avoid the car ahead; stop for the player. */
  function stepTraffic(v, dt, player) {
    const ai = v.ai;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    // simple avoidance: raycast a probe ahead for cars/player
    const probeX = v.x + fx * 6, probeZ = v.z + fz * 6;
    let blocked = false;
    const pd = dist2(probeX, probeZ, player.x, player.z);
    if (pd < 16) blocked = true;
    for (const o of traffic) {
      if (o === v) continue;
      if (dist2(probeX, probeZ, o.x, o.z) < 20) { blocked = true; break; }
    }
    if (blocked) {
      stepVehicle(v, 0, 0, dt, false);
      v.speed = approach(v.speed, 0, 20 * dt);
      return;
    }
    // steer toward lane centre: pick nearest road and follow it
    let throttle = 0.55;
    if (v.speed < C.traffic.speed * 0.6) throttle = 1;
    else if (v.speed > C.traffic.speed) throttle = -0.2;
    // keep to lane by steering toward the nearest lane waypoint ahead
    const target = laneTarget(v);
    const desired = Math.atan2(target.x - v.x, target.z - v.z);
    const steer = clamp(angleDelta(v.heading, desired), -1, 1);
    stepVehicle(v, throttle, steer, dt, false);
  }

  /** The next lane point ahead of a traffic car, to keep it on the grid. */
  function laneTarget(v) {
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const aheadX = v.x + fx * 8, aheadZ = v.z + fz * 8;
    // snap-ahead: if we'd drive off the grid, route toward nearest road
    const nearRoadX = world.nearestRoad(aheadX), nearRoadZ = world.nearestRoad(aheadZ);
    // choose whichever road the car is closer to following
    if (Math.abs(fx) > Math.abs(fz)) {
      return { x: aheadX, z: nearRoadZ + (fz > 0 ? 3.4 : -3.4) };
    }
    return { x: nearRoadX + (fx > 0 ? 3.4 : -3.4), z: aheadZ };
  }

  function updateAll(dt, player) {
    for (const v of traffic) {
      if (v === player.vehicle) continue;
      if (!v.occupied) stepTraffic(v, dt, player);
    }
  }

  /** Despawn & respawn far traffic to keep density around the player. */
  function recycle(player) {
    for (const v of traffic) {
      if (v.occupied) continue;
      const d = dist2(v.x, v.z, player.x, player.z);
      if (d > (W.size * 0.5) * (W.size * 0.5)) {
        const lane = rng.pick(world.lanes);
        placeVehicle(v, lane.x, lane.z, rng.range(0, Math.PI * 2));
      }
    }
  }

  function getTraffic() { return traffic; }

  return {
    makeCarMesh, createVehicle, placeVehicle, stepVehicle,
    spawnTraffic, stepTraffic, updateAll, recycle, getTraffic,
    CAR_COLORS, CAR_NAMES,
  };
})();
