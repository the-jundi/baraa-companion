'use strict';
// Global left-button press detector (GetAsyncKeyState via koffi). One 20 ms poll shared by the lesson runner and the recorder.
let getKey = null;
let loadError = '';
try {
  const koffi = require('koffi');
  getKey = koffi.load('user32.dll').func('short __stdcall GetAsyncKeyState(int vKey)');
} catch (e) { loadError = e.message; }

const subs = new Set();
let prev = false;
let timer = null;

function tick() {
  if (!getKey) return;
  const down = (getKey(0x01) & 0x8000) !== 0;
  const edge = down && !prev;
  prev = down;
  if (edge) for (const fn of [...subs]) { try { fn(); } catch (_) { /* a bad subscriber must not stop the poll */ } }
}

function onDown(fn) {
  subs.add(fn);
  if (!timer) timer = setInterval(tick, 20);
  return () => { subs.delete(fn); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}

module.exports = { onDown, available: () => !!getKey, error: () => loadError };
