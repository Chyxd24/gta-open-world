/* input.js — keyboard + mouse state, pointer lock and a tiny key-binding helper. */
'use strict';
window.NC = window.NC || {};

NC.Input = (function () {
  const down = new Set();
  const pressed = new Set(); // edge-triggered this frame
  let mouseDX = 0, mouseDY = 0;
  let locked = false;
  let enabled = true;
  const listeners = { key: [] };

  const KEYS = {
    forward: ['KeyW', 'ArrowUp'],
    back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    run: ['ShiftLeft', 'ShiftRight'],
    jump: ['Space'],
    enter: ['KeyE', 'KeyF'],
    shoot: ['Mouse0'],
    aim: ['Mouse2'],
    reload: ['KeyR'],
    horn: ['KeyH'],
    pause: ['Escape', 'KeyP'],
    map: ['KeyM'],
    handbrake: ['Space'],
    nextWeapon: ['KeyQ', 'Digit1', 'Digit2', 'Digit3'],
    cheat: ['Backquote'],
  };

  function isDown(action) {
    const keys = KEYS[action] || [];
    return keys.some((k) => down.has(k));
  }
  function wasPressed(action) {
    const keys = KEYS[action] || [];
    return keys.some((k) => pressed.has(k));
  }
  function endFrame() { pressed.clear(); mouseDX = 0; mouseDY = 0; }

  function onKeyDown(e) {
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!down.has(e.code)) pressed.add(e.code);
    down.add(e.code);
    for (const fn of listeners.key) fn(e.code, true);
  }
  function onKeyUp(e) {
    down.delete(e.code);
    for (const fn of listeners.key) fn(e.code, false);
  }
  function onMouseMove(e) {
    if (locked) { mouseDX += e.movementX || 0; mouseDY += e.movementY || 0; }
  }
  function onMouseDown(e) {
    const code = 'Mouse' + e.button;
    if (!down.has(code)) pressed.add(code);
    down.add(code);
  }
  function onMouseUp(e) { down.delete('Mouse' + e.button); }

  function requestLock(el) {
    if (el && el.requestPointerLock) {
      const p = el.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }
  function exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  function attach(canvas) {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => down.clear());
    document.addEventListener('pointerlockchange', () => {
      locked = document.pointerLockElement === canvas;
    });
  }

  return {
    attach, isDown, wasPressed, endFrame, requestLock, exitLock,
    get mouseDX() { return mouseDX; },
    get mouseDY() { return mouseDY; },
    get locked() { return locked; },
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; if (!v) down.clear(); },
    on: (ev, fn) => listeners[ev].push(fn),
    consumeMouse: () => { const d = { dx: mouseDX, dy: mouseDY }; mouseDX = 0; mouseDY = 0; return d; },
  };
})();
