/* wanted.js — crime tracking, star rating, heat decay and police dispatch triggers.
 * Heat is a continuous 0..5+ value; the integer part is the star the HUD shows.
 * Decay only kicks in after CFG.wanted.decayTime seconds without a crime AND
 * while no officer has line of sight, so hiding genuinely cools you down.
 * Stars flash while heat is rising and lock solid once it plateaus. */
'use strict';
window.NC = window.NC || {};

NC.Wanted = (function () {
  const C = CFG;
  let level = 0;
  let heat = 0;         // continuous 0..5+
  let lastCrimeAt = 0;
  let starsDirty = true;

  function reset() { level = 0; heat = 0; lastCrimeAt = 0; starsDirty = true; }

  /** Register a crime at a world position. name is a key in CFG.wanted.crime. */
  function addCrime(name, x, z) {
    const pts = (C.wanted.crime[name] || 1);
    heat += pts * 0.6;
    lastCrimeAt = NC.Game ? NC.Game.time : 0;
    starsDirty = true;
    recompute();
    NC.Police.onCrime(x, z, level);
  }

  function recompute() {
    const nl = Math.min(C.wanted.max, Math.floor(heat));
    if (nl !== level) {
      level = nl;
      starsDirty = true;
      if (level > 0) NC.Audio.sfx.star();
    }
  }

  function update(dt) {
    if (level <= 0 && heat <= 0) return;
    // Heat decays once no crime for a while and no cop has eyes on the player.
    const since = (NC.Game ? NC.Game.time : 0) - lastCrimeAt;
    if (since > C.wanted.decayTime && !NC.Police.playerVisible()) {
      heat -= dt * (C.wanted.decayRate || 0.12);
      if (heat < 0) heat = 0;
      recompute();
    }
  }

  /** Force the rating up to at least n stars. */
  function bumpTo(n) { heat = Math.max(heat, n); recompute(); }

  return {
    reset, addCrime, update, bumpTo,
    get level() { return level; },
    get heat() { return heat; },
    get starsDirty() { return starsDirty; },
    clearDirty() { starsDirty = false; },
  };
})();
