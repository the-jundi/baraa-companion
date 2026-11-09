'use strict';
// The transparent, click-through, never-focused window that carries the pen character, bubbles and rings.
const { BrowserWindow, screen } = require('electron');
const path = require('path');

class Overlay {
  constructor(log) { this.log = log; this.win = null; this.display = null; this.hidden = false; }

  get open_() { return !!(this.win && !this.win.isDestroyed()); }
  get bounds() { return this.display.bounds; }

  async open() {
    if (this.open_) return;
    this.display = screen.getPrimaryDisplay();
    const b = this.display.bounds;
    this.win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true, show: false,
      webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.hidden = false;
    await this.win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
    this.win.showInactive();
    this.log('overlay ' + b.width + 'x' + b.height + ' scale ' + this.display.scaleFactor);
  }

  close() { if (this.open_) this.win.destroy(); this.win = null; }
  send(ch, payload) { if (this.open_) this.win.webContents.send(ch, payload); }
  setInteractive(on) { if (this.open_) this.win.setIgnoreMouseEvents(!on, { forward: true }); }
  toggleHidden() { if (!this.open_) return; this.hidden = !this.hidden; if (this.hidden) this.win.hide(); else this.win.showInactive(); }

  // physical px (what UI Automation reports) -> overlay-local DIP
  physToLocal(r) {
    const a = screen.screenToDipPoint({ x: r.x, y: r.y });
    const z = screen.screenToDipPoint({ x: r.x + r.w, y: r.y + r.h });
    const b = this.display.bounds;
    return { x: Math.round(a.x - b.x), y: Math.round(a.y - b.y), w: Math.round(z.x - a.x), h: Math.round(z.y - a.y) };
  }
  cursorLocal() { const p = screen.getCursorScreenPoint(), b = this.display.bounds; return { x: p.x - b.x, y: p.y - b.y }; }
  cursorPhysical() { return screen.dipToScreenPoint(screen.getCursorScreenPoint()); }
}

module.exports = { Overlay };
