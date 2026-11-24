/* shots.js — headless screenshot driver: exposes NC.Shots.stage(name) to pose the world for
 * automated capture. Not part of normal play; safe to leave in (it is inert unless called).
 * Usage from a headless browser:  await NC.Shots.stage('chase');  then screenshot the canvas.
 * Recognized names: 'city', 'driving', 'chase' (wanted/police), 'mission'.
 * stage() returns a promise that resolves once the pose has settled. */
'use strict';
window.NC = window.NC || {};

NC.Shots = (function () {
  const G = () => NC.Game;

  function lookToward(px, pz, tx, tz) {
    const yaw = Math.atan2(tx - px, tz - pz);
    G().camera.userData.yaw = yaw;
    return yaw;
  }

  /** Pose the game into a named state. Returns after a couple frames so effects settle. */
  async function stage(name) {
    const g = G();
    const p = g.player;
    switch (name) {
      case 'city': {
        // Wide establishing shot: on foot at a corner, camera up high looking down the strip.
        p.x = 4; p.z = 0; p.heading = 0.6; p.vehicle = null; p.h.group.visible = true;
        g.camera.userData.yaw = 0.6;
        g.camera.userData.pitch = 0.42;
        // scatter a few cars near the camera so the street reads as busy
        const tv = NC.Vehicles.getTraffic();
        for (let i = 0; i < 6 && i < tv.length; i++) {
          const v = tv[i];
          NC.Vehicles.placeVehicle(v, p.x + Math.sin(i * 1.7) * 10, p.z + 8 + i * 7, i % 2 ? Math.PI : 0);
        }
        await frames(10);
        break;
      }
      case 'driving': {
        // Player in a car mid-street, chasing traffic ahead.
        const v = NC.Vehicles.getTraffic().find((c) => !c.isPolice) || NC.Vehicles.getTraffic()[0];
        if (v) {
          NC.Player.enterVehicle(p, v);
          v.speed = 22;
          p.x = v.x; p.z = v.z;
        }
        g.camera.userData.yaw = p.vehicle ? p.vehicle.heading : 0;
        g.camera.userData.pitch = 0.2;
        await frames(8);
        break;
      }
      case 'chase': {
        // High wanted level with cruisers swarming — on foot, cops visible in frame.
        NC.Wanted.bumpTo(4);
        p.vehicle = null; p.h.group.visible = true;
        p.x = 0; p.z = 0; p.heading = 0;
        // camera is placed BEHIND the player along -z, looking toward +z at the player.
        g.camera.userData.yaw = 0;
        g.camera.userData.pitch = 0.22;
        g.camera.userData.distBoost = 1.4;
        NC.Police.onCrime(p.x, p.z, 4);
        const cars = NC.Police.getCars();
        // cruisers parked across the road in FRONT of the player (+z), lights blazing,
        // so the camera (behind the player) sees player + cruisers together.
        for (let i = 0; i < cars.length; i++) {
          const c = cars[i];
          const side = (i % 2 ? 1 : -1) * (3 + i * 1.2);
          NC.Vehicles.placeVehicle(c, p.x + side, p.z + 5 + i * 1.5, Math.PI + (i % 2 ? 0.35 : -0.35));
          c.frozen = true;
          c.speed = 0;
        }
        await frames(12);
        break;
      }
      case 'mission': {
        // Mission in progress with objective + marker visible.
        NC.Missions.start(0);
        p.vehicle = null; p.h.group.visible = true;
        p.x = 0; p.z = 6; p.heading = 0;
        g.camera.userData.yaw = 0.1;
        g.camera.userData.pitch = 0.35;
        await frames(8);
        NC.HUD.toast('MISSION — COLD START');
        await frames(4);
        break;
      }
      default: await frames(4);
    }
  }

  function frames(n) {
    return new Promise((res) => {
      let k = 0;
      const step = () => { if (++k >= n) res(); else requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  return { stage };
})();
