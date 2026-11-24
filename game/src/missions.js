/* missions.js — story missions, objectives, markers and progression. Original story: NEON CITY.
 * Each mission is data-driven: an id, a giver brief, and an ordered list of
 * steps (goto / getvehicle / deliver / killcops / killcount). Advancing a step
 * moves the glowing marker; finishing the last step pays out and unlocks next.
 * Mission state is serialised by NC.Save so progress survives a reload. */
'use strict';
window.NC = window.NC || {};

NC.Missions = (function () {
  const world = NC.World, rng = world.rng;

  /** Mission definitions. Each has: id, title, giver line, steps[] with type + target. */
  const STORY = [
    {
      id: 'm1',
      title: 'Cold Start',
      brief: 'Rook owed the wrong people money. Grab the parked Marlin on Neon Strip and drive it to the garage in Old Verde before the collectors find you.',
      steps: [
        { type: 'goto', label: 'Steal the red Marlin', pick: { kind: 'vehicle', color: 0xc0392b } },
        { type: 'drive', label: 'Drive to the Old Verde garage', dest: () => world.intersections[20], radius: 9 },
      ],
      reward: 400,
    },
    {
      id: 'm2',
      title: 'Package Run',
      brief: 'A courier left a case at Harbor Row. Pick it up, then lose anyone tailing you and stash it at the safehouse.',
      steps: [
        { type: 'goto', label: 'Collect the case at Harbor Row', dest: () => world.intersections[12], radius: 8, onFootOk: true },
        { type: 'wanted', label: 'Get the cops off you (lose your wanted level)', need: 0 },
        { type: 'drive', label: 'Stash the case at the safehouse', dest: () => world.intersections[40], radius: 9 },
      ],
      reward: 650,
    },
    {
      id: 'm3',
      title: 'Badge Problems',
      brief: 'Two of Vex\'s runners are pinned down by NCPD near Glass Heights. Get to the scene and take out the officers blocking the alley.',
      steps: [
        { type: 'goto', label: 'Head to the standoff in Glass Heights', dest: () => world.intersections[58], radius: 14, onFootOk: true },
        { type: 'killcops', label: 'Take out 3 NCPD officers', count: 3 },
      ],
      reward: 900,
    },
    {
      id: 'm4',
      title: 'The Vex Job',
      brief: 'Time to end it. Sable Vex is holed up in a tower on Neon Strip. Reach the plaza and clear her crew. Bring everything you have.',
      steps: [
        { type: 'goto', label: 'Reach the Neon Strip plaza', dest: () => world.intersections[0], radius: 12, onFootOk: true },
        { type: 'killcount', label: 'Eliminate 6 of Vex\'s crew (any hostile on foot)', count: 6 },
        { type: 'wanted', label: 'Survive and lose the heat', need: 0 },
      ],
      reward: 1500,
      finale: true,
    },
  ];

  let idx = 0;            // current mission index
  let step = 0;           // current step index
  let active = false;
  let killTarget = null;  // for kill steps
  let killProgress = 0;
  let markerMesh = null;
  let pickVehicle = null;
  let completed = [];     // ids done this save

  function init(scene) {
    const geo = new THREE.CylinderGeometry(2.2, 2.2, 0.1, 24);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.55 });
    markerMesh = new THREE.Mesh(geo, mat);
    markerMesh.position.y = 0.1;
    markerMesh.visible = false;
    scene.add(markerMesh);
  }

  function start(i) {
    idx = i != null ? i : idx;
    const m = STORY[idx];
    if (!m) { active = false; return; }
    step = 0; killProgress = 0; active = true;
    setupStep();
    NC.Audio.sfx.mission();
    NC.HUD.showBriefing(m);
  }

  function setupStep() {
    const m = STORY[idx]; if (!m) return;
    const s = m.steps[step];
    if (!s) return completeMission();
    if (s.type === 'goto' && s.pick && s.pick.kind === 'vehicle') {
      // spawn a special mission vehicle near the player
      const v = NC.Vehicles.createVehicle(s.pick.color);
      const it = world.nearestRoad(NC.Game.player.x + 18) ;
      NC.Vehicles.placeVehicle(v, it, NC.Game.player.z + 6, 0);
      v.kind = 'mission';
      NC.Game.scene.add(v.mesh);
      NC.Vehicles.getTraffic().push(v);
      pickVehicle = v;
    }
    if (s.type === 'killcops') {
      // pre-dispatch a fixed squad at the objective so there's something to fight
      const d = s.dest ? s.dest() : null;
      const tx = d ? d.x : NC.Game.player.x, tz = d ? d.z : NC.Game.player.z;
      const count = s.count || 3;
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2;
        NC.Police.spawnFootCop(tx + Math.cos(a) * 8, tz + Math.sin(a) * 8);
      }
      baselineCops = count;           // squad size; progress = how many are down
      killProgress = 0;
    }
    if (s.type === 'killcount') {
      baselineKills = NC.Game.stats.kills;
      killProgress = 0;
    }
    updateMarker();
  }

  function currentStep() {
    const m = STORY[idx];
    return m ? m.steps[step] : null;
  }
  function currentMission() { return STORY[idx]; }
  function isActive() { return active; }

  function updateMarker() {
    const s = currentStep();
    if (!markerMesh) return;
    let pos = null;
    if (s) {
      if (s.dest) pos = s.dest();
      else if (s.pick && s.pick.kind === 'vehicle' && pickVehicle) pos = { x: pickVehicle.x, z: pickVehicle.z };
    }
    if (pos) { markerMesh.position.set(pos.x, 0.1, pos.z); markerMesh.visible = true; }
    else markerMesh.visible = false;
  }

  function update(dt) {
    if (!active) return;
    const m = STORY[idx]; const s = m && m.steps[step];
    if (!s) return;
    const p = NC.Game.player;
    let done = false;

    switch (s.type) {
      case 'goto': {
        if (s.pick && s.pick.kind === 'vehicle') {
          done = p.vehicle === pickVehicle;
        } else if (s.dest) {
          const d = s.dest();
          if (dist2(p.x, p.z, d.x, d.z) < s.radius * s.radius) done = true;
        }
        break;
      }
      case 'drive': {
        if (p.vehicle && s.dest) {
          const d = s.dest();
          if (dist2(p.x, p.z, d.x, d.z) < s.radius * s.radius) done = true;
        }
        break;
      }
      case 'wanted': {
        if (NC.Wanted.level <= (s.need || 0)) done = true;
        break;
      }
      case 'killcops': {
        // progress = cops from the dispatched squad that have been taken down
        const alive = NC.Police.getUnits().filter((u) => !u.dead).length;
        killProgress = Math.max(killProgress, baselineCops - alive);
        if (killProgress >= s.count) done = true;
        break;
      }
      case 'killcount': {
        if (killTarget == null) { killTarget = NC.Game.stats.kills + s.count; baselineKills = NC.Game.stats.kills; }
        killProgress = NC.Game.stats.kills - baselineKills;
        if (killProgress >= s.count) done = true;
        break;
      }
    }
    if (done) {
      step++;
      killTarget = null;
      NC.Audio.sfx.pickup();
      NC.FX.spawnFloatText('OBJECTIVE COMPLETE', p.x, 3, p.z);
      setupStep();
    }
    updateMarker();
  }

  let baselineCops = 0;
  let baselineKills = 0;

  function completeMission() {
    const m = STORY[idx];
    active = false;
    NC.Game.player.money += m.reward;
    NC.Audio.sfx.cash();
    NC.FX.spawnFloatText('MISSION PASSED  + $' + m.reward, NC.Game.player.x, 3, NC.Game.player.z);
    if (!completed.includes(m.id)) completed.push(m.id);
    NC.HUD.showMissionPassed(m);
    NC.Save.save();
  }

  /** Called by player combat when something dies; drives kill steps. */
  function notifyKill(t) { /* kill steps read stats directly */ }

  function getProgress() {
    return { idx, step, completed: completed.slice(), active };
  }
  function restore(prog) {
    if (!prog) return;
    idx = prog.idx || 0; step = prog.step || 0;
    completed = prog.completed || [];
    active = prog.active || false;
    if (active) setupStep();
  }
  function hasNext() { return idx < STORY.length - 1; }

  /** Advance to the next mission (called from mission-passed screen). */
  function advance() {
    if (hasNext()) { idx++; start(idx); }
    else { NC.HUD.showFinale(); }
  }

  return {
    init, start, update, currentMission, currentStep, isActive,
    notifyKill, getProgress, restore, advance, hasNext,
    get STORY() { return STORY; },
    get marker() { return markerMesh; },
    get killProgress() { return killProgress; },
  };
})();
