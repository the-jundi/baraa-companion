'use strict';
// رفيق براعة — القائمة الرئيسية + طبقة الشاشة الشفافة + وضع المدرب + التحديث التلقائي.
const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const { Overlay } = require('./src/overlay');
const { Uia } = require('./src/uia');
const { Runner } = require('./src/runner');
const { Trainer } = require('./src/trainer');
const lessons = require('./src/lessons');
const updater = require('./src/updater');
const mouse = require('./src/mouse');

// ---------- args ----------
const argv = process.argv.slice(2);
const argVal = (k, d) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const hasFlag = (k) => argv.includes('--' + k);
const PLAY = argVal('play', '');                 // dev: start a lesson directly, e.g. --play=cc-interface
const LESSON_FILE = argVal('lesson', '');        // dev: play a lesson json file
const START_AT = parseInt(argVal('start', '0'), 10) || 0;
const AUTO_QUIT = parseInt(argVal('auto-quit', '0'), 10) || 0;
const FILM = hasFlag('film');
const LOG_FILE = argVal('log', '');

let logPath = '';
function log(...a) {
  const line = '[' + new Date().toISOString().slice(11, 23) + '] ' + a.join(' ');
  try { console.log(line); } catch (_) { /* no console */ }
  try { fs.appendFileSync(LOG_FILE || logPath, line + '\n'); } catch (_) { /* ignore */ }
}

// one instance only: a second launch just brings the menu forward
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let launcher = null, tray = null;
const overlay = new Overlay(log);
const uia = new Uia(log);
let runner = null, trainer = null;
const isTrainer = () => hasFlag('trainer') || process.env.BARAA_TRAINER === '1' || !!lessons.loadSettings().trainer;

const sendLauncher = (ch, payload) => { if (launcher && !launcher.isDestroyed()) launcher.webContents.send(ch, payload); };
function showLauncher() { if (!launcher || launcher.isDestroyed()) return createLauncher(); if (launcher.isMinimized()) launcher.restore(); launcher.show(); launcher.focus(); }

// ---------- launcher window ----------
function createLauncher() {
  launcher = new BrowserWindow({
    width: 1040, height: 760, minWidth: 760, minHeight: 560, show: false, backgroundColor: '#F7FAF8',
    title: 'رفيق براعة', autoHideMenuBar: true, icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  launcher.removeMenu();
  launcher.loadFile(path.join(__dirname, 'renderer', 'launcher.html'));
  launcher.once('ready-to-show', () => launcher.show());
  launcher.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  launcher.on('closed', () => { launcher = null; if (!(runner && runner.running) && !(trainer && trainer.recording)) app.quit(); });
}

// ---------- tray ----------
function trayIcon() {
  const S = 32, buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 15.5, y - 15.5), o = (y * S + x) * 4;
    let c = null; if (d <= 14.5) c = d > 11.5 ? [0x5A, 0x9B, 0xBA] : [0x56, 0x63, 0x14];
    if (c) { buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255; }
  }
  return nativeImage.createFromBitmap(buf, { width: S, height: S });
}
function createTray() {
  try {
    tray = new Tray(trayIcon()); tray.setToolTip('رفيق براعة');
    const build = () => Menu.buildFromTemplate([
      { label: 'فتح قائمة التدريبات', click: showLauncher },
      { label: 'إنهاء الدرس الحالي  (Ctrl+Alt+Q)', click: () => stopEverything(false) },
      { label: 'إخفاء / إظهار القلم  (Ctrl+Alt+H)', click: () => overlay.toggleHidden() },
      { type: 'separator' },
      { label: 'إغلاق البرنامج', click: () => app.quit() },
    ]);
    tray.setContextMenu(build()); tray.on('click', showLauncher);
  } catch (e) { log('tray failed: ' + e.message); }
}

// ---------- lessons ----------
runner = new Runner({
  overlay, uia, log,
  onFinish: (r) => {
    if (r.final) { showLauncher(); sendLauncher('lessons-changed'); return; }
    if (r.completed && r.lessonId && !String(r.lessonId).startsWith('draft-')) { lessons.markProgress(r.lessonId, { done: true, stars: r.stars }); sendLauncher('lessons-changed'); }
  },
});
trainer = new Trainer({ overlay, uia, log });

async function startLesson(lesson, startAt) {
  if (!lesson) return { ok: false, error: 'lesson-not-found' };
  if (launcher && !launcher.isDestroyed() && !FILM) launcher.minimize();
  await runner.start(lesson, { film: FILM, startAt: startAt || 0 });
  return { ok: true };
}

function stopEverything(quitIfIdle) {
  if (trainer.recording) { finishRecording(); return; }
  if (runner.running) { runner.stop(runner.finished); return; }
  if (quitIfIdle) app.quit();
}

function finishRecording() {
  const draft = trainer.stop();
  showLauncher();
  sendLauncher('draft-recorded', draft ? { id: draft.id } : null);
}

// ---------- IPC: launcher ----------
const handle = (ch, fn) => ipcMain.handle(ch, async (_e, a) => { try { return await fn(a || {}); } catch (e) { log('ipc ' + ch + ' failed: ' + e.message); return { error: e.message }; } });

handle('app:info', async () => ({
  version: app.getVersion(), packaged: app.isPackaged, trainer: isTrainer(), packVersion: lessons.loadBestPack().version,
  claudeCli: await Trainer.cliAvailable(), clicks: mouse.available(), repo: lessons.OWNER_REPO,
}));
handle('lessons:list', () => lessons.listForLauncher(isTrainer()));
handle('lesson:start', async ({ id, draft }) => startLesson(draft ? lessons.getDraft(id) : lessons.getLesson(id)));
handle('update:state', () => updater.get());
handle('update:check', () => { updater.check(); return updater.get(); });
handle('update:install', () => { updater.installNow(); return true; });
handle('pack:check', async () => { const r = await lessons.checkRemote(); sendLauncher('lessons-changed'); return r; });
handle('trainer:set', ({ on }) => { lessons.saveSettings({ trainer: !!on }); return isTrainer(); });
handle('rec:start', async ({ title }) => { if (launcher && !launcher.isDestroyed()) launcher.minimize(); await trainer.start(title); return { ok: true }; });
handle('draft:get', ({ id }) => lessons.getDraft(id));
handle('draft:save', ({ draft }) => lessons.saveDraft(draft));
handle('draft:delete', ({ id }) => { lessons.deleteDraft(id); return true; });
handle('draft:explain', async ({ id, outline }) => {
  const d = lessons.getDraft(id); if (!d) throw new Error('المسودة غير موجودة');
  d.outline = outline || d.outline || '';
  const r = await trainer.explain(d, d.outline);
  d.summary = r.summary || d.summary || ''; d.outro = r.outro || d.outro || '';
  r.steps.forEach((s, i) => { d.steps[i].say = String(s.say || ''); if (s.hint) d.steps[i].hint = String(s.hint); });
  return lessons.saveDraft(d);
});
handle('draft:export', async ({ id }) => {
  const d = lessons.getDraft(id); if (!d) throw new Error('المسودة غير موجودة');
  const repoSrc = path.join(__dirname, 'lessons', 'src');
  const dir = (!app.isPackaged && fs.existsSync(repoSrc)) ? repoSrc : path.join(app.getPath('documents'), 'Baraa-Companion', 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, d.id.replace(/^draft-/, 'lesson-') + '.json');
  const clean = { ...d }; delete clean.createdAt; delete clean.updatedAt; delete clean.outline;
  clean.id = d.id.replace(/^draft-/, 'lesson-'); clean.steps = d.steps.map((s) => { const c = { ...s }; delete c.rec; return c; });
  fs.writeFileSync(out, JSON.stringify(clean, null, 2));
  shell.showItemInFolder(out);
  return { path: out };
});
handle('open:external', ({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });
handle('app:quit', () => { app.quit(); return true; });

// ---------- IPC: overlay ----------
ipcMain.on('ui:interactive', (_e, on) => overlay.setInteractive(on));
ipcMain.on('ui:next', () => runner.next());
ipcMain.on('ui:skip', () => runner.next());
ipcMain.on('ui:back', () => runner.back());
ipcMain.on('ui:retry', () => runner.retry());
ipcMain.on('ui:restart', () => runner.restart());
ipcMain.on('ui:exit', () => runner.stop(runner.finished));
ipcMain.on('ui:copy', () => { const t = runner.currentCopy(); if (t) clipboard.writeText(t); });
ipcMain.on('ui:rec-stop', () => finishRecording());
ipcMain.on('ui:rec-note', () => trainer.note());

// ---------- app ----------
app.on('second-instance', showLauncher);
app.whenReady().then(async () => {
  logPath = path.join(app.getPath('userData'), 'companion.log');
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); if (fs.existsSync(logPath) && fs.statSync(logPath).size > 400000) fs.unlinkSync(logPath); } catch (_) { /* ignore */ }
  Menu.setApplicationMenu(null);
  log('start v' + app.getVersion() + ' packaged=' + app.isPackaged + ' pack=' + lessons.loadBestPack().version + ' mouse=' + mouse.available());
  createTray();
  const reg = (acc, fn) => { try { log('hotkey ' + acc + ' ' + (globalShortcut.register(acc, fn) ? 'ok' : 'TAKEN')); } catch (e) { log('hotkey ' + acc + ' error ' + e.message); } };
  reg('Control+Alt+Right', () => runner.running && runner.next());
  reg('Control+Alt+N', () => runner.running && runner.next());
  reg('Control+Alt+Left', () => runner.running && runner.back());
  reg('Control+Alt+F', () => runner.running && runner.retry());
  reg('Control+Alt+H', () => overlay.toggleHidden());
  reg('Control+Alt+Q', () => stopEverything(true));
  reg('Control+Alt+S', () => trainer.recording && finishRecording());
  reg('Control+Alt+K', () => trainer.recording && trainer.note());

  updater.init((ch, p) => sendLauncher(ch, p), log);
  setTimeout(() => lessons.checkRemote().then((r) => { log('pack check: ' + JSON.stringify(r)); if (r.updated) sendLauncher('lessons-changed'); }), 3000);

  if (argVal('selftest', '') === 'explain') {     // dev check of the "explain with Claude Code" path, no UI
    const rec = (name) => ({ say: '', target: { uia: {} }, wait: 'click', rec: { name, type: 'Button', process: 'claude', windowTitle: 'Claude' } });
    const d = { id: 'draft-selftest', title: 'فتح لوحات Claude Code', steps: [{ say: '', anchor: 'center', wait: 'next' }, rec('Terminal'), rec('Files'), rec('Changes'), { say: '', anchor: 'center', wait: 'next' }] };
    try { const r = await trainer.explain(d, 'درس قصير يعرّف المتدرب على اللوحات الجانبية في تطبيق Claude Code.'); log('EXPLAIN OK ' + JSON.stringify(r)); } catch (e) { log('EXPLAIN FAIL ' + e.message); }
    app.quit(); return;
  }
  if (LESSON_FILE || PLAY) {
    const lesson = LESSON_FILE ? JSON.parse(fs.readFileSync(path.resolve(LESSON_FILE), 'utf8')) : lessons.getLesson(PLAY);
    if (!lesson) { log('lesson not found'); } else { await startLesson(lesson, START_AT); }
  } else createLauncher();
  if (AUTO_QUIT) setTimeout(() => app.quit(), AUTO_QUIT * 1000);
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); uia.stop(); });
app.on('window-all-closed', () => { /* the overlay and launcher come and go; quitting is explicit */ });
