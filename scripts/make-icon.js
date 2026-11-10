'use strict';
// Builds the app icon from the real «قلم» pen drawing (same paths as renderer/overlay.html).
// Run:  node_modules\electron\dist\electron.exe scripts\make-icon.js
// Writes build/icon.png (256), build/icon-512.png, build/icon-tray.png (64), build/icon.ico (16..256 PNG entries).
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'build');
const PREVIEW = process.argv.find((a) => a.startsWith('--preview='));

const DEFS = `
  <linearGradient id="gShaft" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#0E4A40"/><stop offset=".38" stop-color="#1F7A69"/><stop offset=".58" stop-color="#2F8A78"/><stop offset="1" stop-color="#0F5044"/></linearGradient>
  <linearGradient id="gGold" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#86692C"/><stop offset=".35" stop-color="#EBD59B"/><stop offset=".62" stop-color="#BA9B5A"/><stop offset="1" stop-color="#7A5F26"/></linearGradient>
  <linearGradient id="gNib" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#0B2A25"/><stop offset=".5" stop-color="#244F46"/><stop offset="1" stop-color="#0B2A25"/></linearGradient>
  <linearGradient id="gTile" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E3EFE9"/></linearGradient>
  <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="7" stdDeviation="8" flood-color="#0B2A25" flood-opacity=".34"/></filter>`;

// same geometry as the character: origin (0,0) = nib tip, body extends upward
const PEN = (simple) => `
  <path d="M -15 -188 Q -16 -140 -11.5 -62 L -8.5 -36 L 8.5 -36 L 11.5 -62 Q 16 -140 15 -188 Z" fill="url(#gShaft)"/>
  <ellipse cx="0" cy="-188" rx="15" ry="5.5" fill="#0B3F36"/>
  ${simple ? '' : '<path d="M -8 -182 Q -9.5 -120 -6.4 -52" stroke="#9FD8C8" stroke-opacity=".45" stroke-width="3" fill="none" stroke-linecap="round"/>'}
  <rect x="-15.6" y="-154" width="31.2" height="12" rx="3" fill="url(#gGold)"/>
  <rect x="-14.2" y="-134" width="28.4" height="4.4" rx="2" fill="url(#gGold)"/>
  <g transform="translate(0,-96)"><rect x="-8" y="-8" width="16" height="16" fill="url(#gGold)"/><rect x="-8" y="-8" width="16" height="16" fill="url(#gGold)" transform="rotate(45)"/><circle r="2.6" fill="#0E4A40"/></g>
  <path d="M -9 -38 L 9 -38 Q 8.4 -22 3.8 -8 L 0 0 L -1.2 -7 Q -7.6 -22 -9 -38 Z" fill="url(#gNib)"/>
  <rect x="-9.6" y="-40" width="19.2" height="3.4" rx="1.6" fill="url(#gGold)"/>
  <circle cx="0" cy="2" r="3.6" fill="#E7CF93"/>`;

function svg(simple) {
  const ring = simple ? 'stroke-width="20"' : 'stroke-width="10"';
  const scale = simple ? 1.86 : 1.66;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs>${DEFS}</defs>
  <rect x="10" y="10" width="492" height="492" rx="116" fill="url(#gTile)"/>
  <rect x="${simple ? 32 : 30}" y="${simple ? 32 : 30}" width="${simple ? 448 : 452}" height="${simple ? 448 : 452}" rx="${simple ? 92 : 96}" fill="none" stroke="#BA9B5A" ${ring}/>
  ${simple ? '' : '<path d="M 132 404 C 182 366 226 430 282 402 S 352 372 396 398" stroke="#BA9B5A" stroke-width="12" fill="none" stroke-linecap="round" opacity=".92"/>'}
  <g transform="translate(256 252) rotate(42) scale(${scale}) translate(0 96)" ${simple ? '' : 'filter="url(#sh)"'}>${PEN(simple)}</g>
</svg>`;
}

async function render(win, simple) {
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg(simple)}</body></html>`));
  await new Promise((r) => setTimeout(r, 350));
  let img = await win.webContents.capturePage();
  const s = img.getSize();
  if (s.width !== 512 || s.height !== 512) img = img.resize({ width: 512, height: 512, quality: 'best' });
  return img;
}

function ico(entries) {            // entries: [{size, png}]
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let off = 6 + entries.length * 16;
  const dirs = entries.map((e) => {
    const d = Buffer.alloc(16);
    d.writeUInt8(e.size >= 256 ? 0 : e.size, 0); d.writeUInt8(e.size >= 256 ? 0 : e.size, 1);
    d.writeUInt8(0, 2); d.writeUInt8(0, 3); d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6);
    d.writeUInt32LE(e.png.length, 8); d.writeUInt32LE(off, 12); off += e.png.length; return d;
  });
  return Buffer.concat([head, ...dirs, ...entries.map((e) => e.png)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, resizable: false, useContentSize: true, backgroundColor: '#00000000', webPreferences: { zoomFactor: 1, offscreen: false } });
  const full = await render(win, false);
  const simple = await render(win, true);
  win.destroy();

  const bmp = full.toBitmap(); // BGRA: corner pixel must be transparent
  console.log('corner alpha (0 = transparent):', bmp[3], '| size', JSON.stringify(full.getSize()));

  const at = (img, n) => img.resize({ width: n, height: n, quality: 'best' }).toPNG();
  fs.writeFileSync(path.join(OUT, 'icon-512.png'), full.toPNG());
  fs.writeFileSync(path.join(OUT, 'icon.png'), at(full, 256));
  fs.writeFileSync(path.join(OUT, 'icon-tray.png'), at(simple, 64));
  const entries = [
    { size: 16, png: at(simple, 16) }, { size: 24, png: at(simple, 24) }, { size: 32, png: at(simple, 32) }, { size: 48, png: at(simple, 48) },
    { size: 64, png: at(full, 64) }, { size: 128, png: at(full, 128) }, { size: 256, png: at(full, 256) },
  ];
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(entries));
  if (PREVIEW) {   // small sizes enlarged on a checker, for eyeballing
    const dir = PREVIEW.split('=')[1];
    fs.mkdirSync(dir, { recursive: true });
    for (const e of entries) fs.writeFileSync(path.join(dir, 'ico-' + e.size + '.png'), e.png);
  }
  console.log('icon files written to', OUT, '| ico bytes', fs.statSync(path.join(OUT, 'icon.ico')).size);
  app.quit();
});
