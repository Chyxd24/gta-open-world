/* hud.js — DOM overlay: health/armor/money/wanted, weapon, minimap, objective, prompts, menus.
 * The HUD never touches three.js — it is pure DOM driven by NC.Game each frame.
 * The minimap is a small 2D canvas that redraws roads, the player arrow and
 * nearby blips (cops red, mission marker gold) so you can navigate at a glance.
 * HUD updates are throttled to the DOM only when values actually change. */
'use strict';
window.NC = window.NC || {};

NC.HUD = (function () {
  let el = {};
  let minimapCtx = null;
  let minimapCanvas = null;
  let stars = [];
  let built = false;

  function build() {
    if (built) return;
    const root = document.getElementById('hud');
    root.innerHTML = `
      <div id="mmWrap"><canvas id="minimap" width="200" height="200"></canvas>
        <div id="mmLabel">NEON CITY</div></div>
      <div id="statPanel">
        <div class="barRow"><span class="lbl">HP</span><div class="bar"><div id="hpFill"></div></div></div>
        <div class="barRow"><span class="lbl">ARM</span><div class="bar"><div id="armFill"></div></div></div>
        <div id="cash">$0</div>
      </div>
      <div id="wanted"><div id="stars"></div><div id="wantedLbl">WANTED</div></div>
      <div id="weapon"><div id="wName">—</div><div id="wAmmo">—</div></div>
      <div id="objective"><div id="objTitle">NEON CITY</div><div id="objText"></div></div>
      <div id="prompt"></div>
      <div id="toast"></div>
      <div id="controlsHint">
        WASD move · Shift run · Mouse look · LMB shoot · RMB aim · R reload · Q swap<br>
        E enter/exit car · Space handbrake · H horn · Esc pause
      </div>
    `;
    minimapCanvas = document.getElementById('minimap');
    minimapCtx = minimapCanvas.getContext('2d');
    el = {
      hpFill: document.getElementById('hpFill'),
      armFill: document.getElementById('armFill'),
      cash: document.getElementById('cash'),
      stars: document.getElementById('stars'),
      wanted: document.getElementById('wanted'),
      wName: document.getElementById('wName'),
      wAmmo: document.getElementById('wAmmo'),
      objective: document.getElementById('objective'),
      objTitle: document.getElementById('objTitle'),
      objText: document.getElementById('objText'),
      prompt: document.getElementById('prompt'),
      toast: document.getElementById('toast'),
    };
    for (let i = 0; i < CFG.wanted.max; i++) {
      const s = document.createElement('span');
      s.className = 'star';
      s.textContent = '★';
      el.stars.appendChild(s);
      stars.push(s);
    }
    built = true;
  }

  function update(player) {
    if (!built) return;
    el.hpFill.style.width = clamp(player.health, 0, 100) + '%';
    el.armFill.style.width = clamp(player.armor, 0, 100) + '%';
    el.cash.textContent = '$' + player.money.toLocaleString();

    const lvl = NC.Wanted.level;
    for (let i = 0; i < stars.length; i++) {
      stars[i].classList.toggle('on', i < lvl);
    }
    el.wanted.classList.toggle('active', lvl > 0);

    const w = NC.Player.getWeapon(player);
    el.wName.textContent = w.name;
    el.wAmmo.textContent = w.id === 'fists' ? '∞' : (player.reloading > 0 ? 'RELOADING' : `${w.loaded} / ${w.mag}`);

    // objective text
    const m = NC.Missions.currentMission();
    if (NC.Missions.isActive() && m) {
      const s = NC.Missions.currentStep();
      el.objective.style.display = 'block';
      el.objTitle.textContent = m.title.toUpperCase();
      let txt = s ? s.label : 'Mission passed!';
      if (s && (s.type === 'killcops' || s.type === 'killcount')) txt += `  (${NC.Missions.killProgress}/${s.count})`;
      el.objText.textContent = txt;
    } else if (m && !NC.Missions.isActive()) {
      el.objective.style.display = 'block';
      el.objTitle.textContent = 'NEXT: ' + m.title.toUpperCase();
      el.objText.textContent = 'Drive to the yellow marker to start';
    }
  }

  /** Prompt for nearby interactable. */
  function setPrompt(text) {
    if (!built) return;
    if (el.prompt.textContent !== text) el.prompt.textContent = text;
    el.prompt.style.display = text ? 'block' : 'none';
  }

  let toastTimer = null;
  function toast(text) {
    if (!built) return;
    el.toast.textContent = text;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
  }

  function showBriefing(m) {
    toast('NEW MISSION — ' + m.title);
  }
  function showMissionPassed(m) {
    toast('MISSION PASSED — $' + m.reward);
  }
  function showFinale() {
    toast('ALL MISSIONS COMPLETE — NEON CITY IS YOURS');
  }

  /** Draw the minimap: roads, blocks, player arrow, cops, peds, mission marker. */
  function drawMinimap(player, time) {
    if (!built) return;
    const ctx = minimapCtx;
    const W = 200, H = 200;
    ctx.clearRect(0, 0, W, H);
    // background
    ctx.fillStyle = '#20242b';
    ctx.fillRect(0, 0, W, H);

    const range = 90; // meters visible radius
    const scale = W / (range * 2);
    const cx = W / 2, cy = H / 2;
    const toMap = (wx, wz) => ({
      x: cx + (wx - player.x) * scale,
      y: cy + (wz - player.z) * scale,
    });

    // blocks (lighter) 
    const Wc = CFG.world;
    ctx.fillStyle = '#343a44';
    const half = Wc.half;
    for (let bx = 0; bx < Wc.blocks; bx++) {
      for (let bz = 0; bz < Wc.blocks; bz++) {
        const blockX = -half + bx * Wc.cell + Wc.street;
        const blockZ = -half + bz * Wc.cell + Wc.street;
        const a = toMap(blockX, blockZ);
        const b = toMap(blockX + Wc.block, blockZ + Wc.block);
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
    }
    // mission marker
    const marker = NC.Missions.marker;
    if (marker && marker.visible) {
      const m = toMap(marker.position.x, marker.position.z);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2); ctx.fill();
    }
    // police
    ctx.fillStyle = '#3d8bff';
    for (const c of NC.Police.getCars()) {
      const p = toMap(c.x, c.z);
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    // peds (dim)
    ctx.fillStyle = '#8a8f99';
    for (const pd of NC.Characters.getPeds()) {
      if (pd.dead) continue;
      const p = toMap(pd.x, pd.z);
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
    // traffic
    ctx.fillStyle = '#b9bec7';
    for (const v of NC.Vehicles.getTraffic()) {
      if (v.occupied) continue;
      const p = toMap(v.x, v.z);
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    // player arrow (rotates with heading)
    const heading = player.vehicle ? player.vehicle.heading : player.heading;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-heading + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // border
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
  }

  return {
    build, update, setPrompt, toast, drawMinimap,
    showBriefing, showMissionPassed, showFinale,
  };
})();
