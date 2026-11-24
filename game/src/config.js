/* ============================================================
 * NEON CITY — an original open-world crime sandbox
 * config.js — tuning constants, city layout and small math helpers
 *
 * Everything the simulation needs to stay deterministic lives here: the seeded
 * RNG, a handful of numeric helpers, and the CFG table that world/police/wanted
 * read instead of scattering magic numbers across modules. Tune the game here.
 * Seed note: the default city seed is fixed so every load reproduces the same layout.
 * ============================================================ */
'use strict';

/** Deterministic RNG so every player sees the same Neon City. */
function makeRNG(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    range: (a, b) => a + next() * (b - a),
    int: (a, b) => Math.floor(a + next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length],
    chance: (p) => next() < p,
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Move `a` toward `b` by at most `d`. */
function approach(a, b, d) {
  return a < b ? Math.min(a + d, b) : Math.max(a - d, b);
}
/** Shortest signed angle from a to b, radians. */
function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function angleLerp(a, b, t) {
  return a + angleDelta(a, b) * t;
}
const dist2 = (ax, az, bx, bz) => {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
};

const CFG = {
  world: {
    /** City is blocks wide/deep; each block is BLOCK meters, streets between them. */
    blocks: 8,
    block: 46,
    street: 14,
    get cell() { return this.block + this.street; },
    get size() { return this.blocks * this.cell; },
    get half() { return this.size / 2; },
  },
  player: {
    walkSpeed: 5.2,
    runSpeed: 10.5,
    accel: 26,
    radius: 0.45,
    maxHealth: 100,
    maxArmor: 100,
    eyeHeight: 1.65,
  },
  car: {
    maxSpeed: 34,
    maxReverse: 11,
    engineForce: 23,
    brakeForce: 42,
    drag: 0.62,
    steering: 2.05,
    grip: 1.9,
  },
  /** Star decay: heat bleeds off slowly while no cop has line of sight. */
  wanted: {
    max: 5,
    decayTime: 26,
    decayRate: 0.12, // heat per second lost while hiding
    crime: { bump: 1, jack: 1, carjack: 1, kill: 2, copKill: 3 },
  },
  traffic: { count: 30, speed: 9 },
  peds: { count: 64 },
  police: { maxActive: 8, respawn: 3.2 },
  camera: { dist: 6.2, carDist: 10.5, height: 2.6, carHeight: 3.9, lerp: 8 },
  colors: {
    sky: 0x8fc3e8,
    fog: 0xbfd8e6,
    sun: 0xffe9c4,
    ground: 0x6f6a63,
    road: 0x3b3b40,
    sidewalk: 0x9c968c,
  },
  districts: [
    { name: 'Neon Strip', x: [0, 3], z: [0, 3], wall: 0xe8c46a, trim: 0xff4f8b, height: [10, 24] },
    { name: 'Harbor Row', x: [4, 7], z: [0, 3], wall: 0x7fa9c4, trim: 0x2fd6d0, height: [8, 18] },
    { name: 'Old Verde', x: [0, 3], z: [4, 7], wall: 0xc98f6b, trim: 0x8fd14f, height: [7, 15] },
    { name: 'Glass Heights', x: [4, 7], z: [4, 7], wall: 0x9fb3c8, trim: 0xb388ff, height: [14, 34] },
  ],
  saveKey: 'neoncity.save.v1',
};
