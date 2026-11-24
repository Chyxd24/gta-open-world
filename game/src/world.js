/* world.js — procedural city geometry, road network, collision grid and sky.
 * Recording 01a20c4e authored: city growth is fully seeded so the layout is reproducible.
 * The whole city is grown from a single seeded RNG (seed 1337) so every player
 * walks the identical Neon City: blocks, sidewalks, buildings per district,
 * streetlights and props are all placed deterministically from CFG.world.
 * Collision is a uniform grid of cell size CFG.world.cellSize. */
'use strict';
window.NC = window.NC || {};

NC.World = (function () {
  const C = CFG, W = C.world;
  const rng = makeRNG(1337);

  /** Static box colliders the player/cars slide against: {x,z,hx,hz}. */
  const colliders = [];
  /** Road centres along each axis, in world meters. */
  const roadCoords = [];
  /** Intersection centres {x,z} where two roads cross. */
  const intersections = [];
  /** Lane waypoints the traffic AI drives between. */
  const lanes = [];

  function districtAt(bx, bz) {
    for (const d of C.districts) {
      if (bx >= d.x[0] && bx <= d.x[1] && bz >= d.z[0] && bz <= d.z[1]) return d;
    }
    return C.districts[0];
  }

  function addCollider(x, z, hx, hz) {
    colliders.push({ x, z, hx, hz });
  }

  /** True when (x,z) sits on a street (not inside a block). */
  function onRoad(x, z) {
    const half = W.half;
    const fx = (x + half) % W.cell;
    const fz = (z + half) % W.cell;
    return fx < W.street || fz < W.street;
  }

  /** Nearest road centreline coordinate to a value. */
  function nearestRoad(v) {
    const half = W.half;
    const t = Math.round((v + half) / W.cell) * W.cell - half;
    return t;
  }

  function build(scene) {
    const size = W.size, half = W.half;
    for (let i = 0; i <= W.blocks; i++) roadCoords.push(-half + i * W.cell);
    for (const rx of roadCoords) for (const rz of roadCoords) intersections.push({ x: rx, z: rz });

    // Sky dome + lights
    scene.background = new THREE.Color(C.colors.sky);
    scene.fog = new THREE.Fog(C.colors.fog, 90, 320);
    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a48, 0.95);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(C.colors.sun, 1.35);
    sun.position.set(70, 120, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 320;
    scene.add(sun);
    scene.add(sun.target);
    NC.World.sun = sun;

    // Ground + roads as one big plane then painted strips
    const groundMat = new THREE.MeshLambertMaterial({ color: C.colors.ground });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size + 60, size + 60), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Road network strips (dark) with lane dashes (yellow) and crosswalks (white)
    const roadMat = new THREE.MeshLambertMaterial({ color: C.colors.road });
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xe8d24a });
    const crossMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
    const roadW = W.street;
    for (const c of roadCoords) {
      const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(roadW, size), roadMat);
      vRoad.rotation.x = -Math.PI / 2; vRoad.position.set(c, 0.02, 0); vRoad.receiveShadow = true;
      scene.add(vRoad);
      const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(size, roadW), roadMat);
      hRoad.rotation.x = -Math.PI / 2; hRoad.position.set(0, 0.021, c); hRoad.receiveShadow = true;
      scene.add(hRoad);
      // centre dashes along the full length
      const dashGeo = new THREE.PlaneGeometry(0.35, 3);
      const nDashes = Math.floor(size / 7);
      for (let k = 0; k < nDashes; k++) {
        const z = -half + k * 7 + 3.5;
        const d1 = new THREE.Mesh(dashGeo, dashMat);
        d1.rotation.x = -Math.PI / 2; d1.position.set(c, 0.04, z);
        scene.add(d1);
        const d2 = new THREE.Mesh(dashGeo, dashMat);
        d2.rotation.x = -Math.PI / 2; d2.rotation.z = Math.PI / 2; d2.position.set(z, 0.04, c);
        scene.add(d2);
      }
    }
    // Crosswalks at each intersection
    for (const it of intersections) {
      for (let k = 0; k < 5; k++) {
        const o = -4 + k * 2;
        const a = new THREE.Mesh(new THREE.PlaneGeometry(1, 3), crossMat);
        a.rotation.x = -Math.PI / 2; a.position.set(it.x + o, 0.045, it.z + roadW / 2 + 2);
        scene.add(a);
        const b = new THREE.Mesh(new THREE.PlaneGeometry(1, 3), crossMat);
        b.rotation.x = -Math.PI / 2; b.position.set(it.x + o, 0.045, it.z - roadW / 2 - 2);
        scene.add(b);
      }
    }

    // City blocks: sidewalk slab + 1..4 buildings + props
    const cityGroup = new THREE.Group();
    scene.add(cityGroup);
    const sidewalkMat = new THREE.MeshLambertMaterial({ color: C.colors.sidewalk });
    const windowMat = new THREE.MeshBasicMaterial({ color: 0x2b3a48 });
    const windowMatLit = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    const materials = C.districts.map((d) => ({
      wall: new THREE.MeshLambertMaterial({ color: d.wall }),
      trim: new THREE.MeshLambertMaterial({ color: d.trim }),
    }));

    for (let bx = 0; bx < W.blocks; bx++) {
      for (let bz = 0; bz < W.blocks; bz++) {
        const cx = -half + bx * W.cell + W.street + W.block / 2;
        const cz = -half + bz * W.cell + W.street + W.block / 2;
        const d = districtAt(bx, bz);
        const mat = materials[C.districts.indexOf(d)];

        // Sidewalk slab
        const slab = new THREE.Mesh(new THREE.BoxGeometry(W.block, 0.3, W.block), sidewalkMat);
        slab.position.set(cx, 0.15, cz); slab.receiveShadow = true;
        cityGroup.add(slab);

        // Subdivide block into 2x2 lots
        const lot = W.block / 2 - 2;
        for (let lx = 0; lx < 2; lx++) {
          for (let lz = 0; lz < 2; lz++) {
            const px = cx - W.block / 4 + lx * (W.block / 2);
            const pz = cz - W.block / 4 + lz * (W.block / 2);
            // A few lots stay open (plazas / parks)
            const roll = rng.next();
            if (roll < 0.14) {
              // Small park: grass + trees
              const grass = new THREE.Mesh(new THREE.BoxGeometry(lot, 0.1, lot), new THREE.MeshLambertMaterial({ color: 0x5f9e4a }));
              grass.position.set(px, 0.32, pz); cityGroup.add(grass);
              for (let t = 0; t < 3; t++) {
                const tx = px + rng.range(-lot / 3, lot / 3), tz = pz + rng.range(-lot / 3, lot / 3);
                const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0x6b4a2f }));
                trunk.position.set(tx, 1.5, tz); trunk.castShadow = true; cityGroup.add(trunk);
                const leaf = new THREE.Mesh(new THREE.SphereGeometry(rng.range(1.4, 2.1), 8, 6), new THREE.MeshLambertMaterial({ color: 0x3f8a3a }));
                leaf.position.set(tx, 3.3, tz); leaf.castShadow = true; cityGroup.add(leaf);
                addCollider(tx, tz, 0.4, 0.4);
              }
              continue;
            }
            const h = rng.range(d.height[0], d.height[1]);
            const w = lot - rng.range(0, 1.5), dep = lot - rng.range(0, 1.5);
            const bld = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), mat.wall);
            bld.position.set(px, h / 2, pz); bld.castShadow = true; bld.receiveShadow = true;
            cityGroup.add(bld);
            addCollider(px, pz, w / 2, dep / 2);

            // Rooftop accent / trim band
            const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 1.2, dep + 0.4), mat.trim);
            trim.position.set(px, h, pz); trim.castShadow = true; cityGroup.add(trim);

            // Neon signage on the street-facing faces: a bright emissive panel + a glowing band
            const neonColors = [0xff2d7a, 0x2de1ff, 0xffe23f, 0x9d4dff, 0x3dff88];
            const neonMat = new THREE.MeshBasicMaterial({ color: rng.pick(neonColors) });
            const signH = Math.min(2.4, h * 0.18);
            const signW = Math.min(w * 0.6, 6);
            // pick a face toward a street
            const face = rng.int(0, 3);
            const sign = new THREE.Mesh(new THREE.BoxGeometry(signW, signH, 0.2), neonMat);
            const signY = Math.min(h * 0.55, 9);
            if (face === 0) { sign.position.set(px, signY, pz + dep / 2 + 0.12); }
            else if (face === 1) { sign.position.set(px, signY, pz - dep / 2 - 0.12); }
            else if (face === 2) { sign.rotation.y = Math.PI / 2; sign.position.set(px + w / 2 + 0.12, signY, pz); }
            else { sign.rotation.y = Math.PI / 2; sign.position.set(px - w / 2 - 0.12, signY, pz); }
            cityGroup.add(sign);
            // vertical neon strip climbing a corner for that sun-soaked city glow
            if (rng.chance(0.5)) {
              const stripMat = new THREE.MeshBasicMaterial({ color: rng.pick(neonColors) });
              const strip = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, 0.22), stripMat);
              strip.position.set(px + w / 2 + 0.05, h / 2, pz + dep / 2 + 0.05);
              cityGroup.add(strip);
            }

            // Window grid on the tall faces (lit at random) — cheap, baked once
            const floors = Math.floor(h / 3.4);
            const cols = Math.max(2, Math.floor(w / 2.6));
            const winGeo = new THREE.PlaneGeometry(1.1, 1.6);
            for (let f = 1; f < floors; f++) {
              for (let cc = 0; cc < cols; cc++) {
                if (!rng.chance(0.55)) continue;
                const lit = rng.chance(0.35);
                const wm = lit ? windowMatLit : windowMat;
                const wy = f * 3.4;
                const off = -w / 2 + (cc + 0.5) * (w / cols);
                const p1 = new THREE.Mesh(winGeo, wm);
                p1.position.set(px + off, wy, pz + dep / 2 + 0.02); cityGroup.add(p1);
                const p2 = new THREE.Mesh(winGeo, wm);
                p2.position.set(px + off, wy, pz - dep / 2 - 0.02); p2.rotation.y = Math.PI; cityGroup.add(p2);
              }
            }
          }
        }
      }
    }

    // Street lamps along intersections for night-time glow anchors
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x33363b });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6a8 });
    for (const it of intersections) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 6, 6), poleMat);
      pole.position.set(it.x + W.street / 2 - 1, 3, it.z + W.street / 2 - 1); cityGroup.add(pole);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lampMat);
      head.position.set(it.x + W.street / 2 - 1, 6.1, it.z + W.street / 2 - 1); cityGroup.add(head);
    }

    // Build lane graph for traffic: two lanes per road segment between intersections
    const laneOff = 3.4;
    for (let i = 0; i < roadCoords.length - 1; i++) {
      const a = roadCoords[i], b = roadCoords[i + 1];
      const mid = (a + b) / 2;
      for (const rc of roadCoords) {
        // vertical roads (constant x), two directions
        lanes.push({ x: a + laneOff, z: mid, dir: 'z+' });
        lanes.push({ x: b - laneOff, z: mid, dir: 'z-' });
        lanes.push({ x: mid, z: a + laneOff, dir: 'x+' });
        lanes.push({ x: mid, z: b - laneOff, dir: 'x-' });
        // anchor each lane to its road coordinate properly
        lanes[lanes.length - 4].road = rc; lanes[lanes.length - 3].road = rc;
        lanes[lanes.length - 2].road = rc; lanes[lanes.length - 1].road = rc;
      }
    }
    NC.World.roadCoords = roadCoords;
  }

  /** Resolve a circle (x,z,r) out of building colliders. Returns corrected {x,z,hit}. */
  function resolveCircle(x, z, r) {
    let hit = false;
    for (const c of colliders) {
      const closestX = clamp(x, c.x - c.hx, c.x + c.hx);
      const closestZ = clamp(z, c.z - c.hz, c.z + c.hz);
      const dx = x - closestX, dz = z - closestZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        const d = Math.sqrt(d2) || 0.0001;
        if (d2 > 0.00001) {
          const push = (r - d);
          x += (dx / d) * push;
          z += (dz / d) * push;
        } else {
          // centre inside the box: push out along the shallowest axis
          const toEdges = [c.x + c.hx - x, x - (c.x - c.hx), c.z + c.hz - z, z - (c.z - c.hz)];
          const m = Math.min(...toEdges);
          if (m === toEdges[0]) x = c.x + c.hx + r;
          else if (m === toEdges[1]) x = c.x - c.hx - r;
          else if (m === toEdges[2]) z = c.z + c.hz + r;
          else z = c.z - c.hz - r;
        }
      }
    }
    return { x, z, hit };
  }

  /** Keep a position inside the map bounds. */
  function clampToWorld(x, z, pad = 4) {
    const b = W.half - pad;
    return { x: clamp(x, -b, b), z: clamp(z, -b, b) };
  }

  /** A random point on a road for spawning cars/peds. */
  function randomRoadPoint() {
    const rx = rng.pick(roadCoords), rz = rng.pick(roadCoords);
    // pick a point along one of the two roads
    if (rng.chance(0.5)) return { x: rx + rng.range(-4, 4), z: rng.range(-W.half, W.half) };
    return { x: rng.range(-W.half, W.half), z: rz + rng.range(-4, 4) };
  }

  return {
    build, resolveCircle, clampToWorld, onRoad, nearestRoad, randomRoadPoint,
    districtAt, get colliders() { return colliders; }, get lanes() { return lanes; },
    get intersections() { return intersections; }, rng,
  };
})();
