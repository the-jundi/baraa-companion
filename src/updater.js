'use strict';
// App updates through GitHub Releases (electron-updater). Only active in the installed build.
const { app } = require('electron');

let state = { state: 'idle' };
let sender = () => {};
let started = false;

function set(s) { state = s; sender('update-state', s); }

function init(send, log) {
  sender = send;
  if (!app.isPackaged) { set({ state: 'dev' }); return; }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => set({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => set({ state: 'none', version: app.getVersion() }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', version: state.version, percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => { log('updater error: ' + (e && e.message)); set({ state: 'error', message: String((e && e.message) || e).slice(0, 160) }); });
  started = true;
  const check = () => autoUpdater.checkForUpdates().catch((e) => log('check failed: ' + e.message));
  setTimeout(check, 6000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

function check() {
  if (!started) return state;
  require('electron-updater').autoUpdater.checkForUpdates().catch(() => {});
  return state;
}
function installNow() { if (started) require('electron-updater').autoUpdater.quitAndInstall(false, true); }
const get = () => state;

module.exports = { init, check, installNow, get };
