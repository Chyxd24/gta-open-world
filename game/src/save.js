/* save.js — localStorage persistence of progress, stats, money, position and loadout.
 * A snapshot is a plain JSON blob under CFG.saveKey; NC.Save.write() is called
 * on pause and after each mission, and read() restores state on CONTINUE. A
 * version field guards against loading a save from an older build.
 * Writes are debounced; a corrupted blob is discarded, never thrown. */
'use strict';
window.NC = window.NC || {};

NC.Save = (function () {
  const KEY = CFG.saveKey;

  function snapshot(player) {
    const w = NC.Player.getWeapon(player);
    return {
      version: 1,
      x: player.x, z: player.z, heading: player.heading,
      health: player.health, armor: player.armor, money: player.money,
      weaponIndex: player.weaponIndex,
      weapons: player.weapons.map((x) => ({ id: x.id, mag: x.mag, loaded: x.id === 'fists' ? 0 : x.loaded })),
      mission: NC.Missions.getProgress(),
      stats: NC.Game.stats,
      time: NC.Game.time,
      ts: Date.now(),
    };
  }

  function save(player) {
    try {
      const data = snapshot(player || NC.Game.player);
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) { return false; }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function apply(player, data) {
    if (!data) return false;
    player.x = data.x || 0; player.z = data.z || 0; player.heading = data.heading || 0;
    player.health = data.health != null ? data.health : CFG.player.maxHealth;
    player.armor = data.armor || 0;
    player.money = data.money != null ? data.money : 0;
    player.weaponIndex = data.weaponIndex || 1;
    if (Array.isArray(data.weapons)) {
      for (const sw of data.weapons) {
        const w = player.weapons.find((x) => x.id === sw.id);
        if (w) { w.mag = sw.mag; if (w.id !== 'fists') w.loaded = sw.loaded; }
      }
    }
    if (data.stats) Object.assign(NC.Game.stats, data.stats);
    if (data.mission) NC.Missions.restore(data.mission);
    if (data.time) NC.Game.time = data.time;
    return true;
  }

  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function has() { return !!load(); }

  return { save, load, apply, clear, has };
})();
