'use strict';
// Lesson packs: a signed lessons/pack.json shipped inside the app AND refreshed from GitHub without reinstalling.
const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OWNER_REPO = 'the-jundi/baraa-companion';
const REMOTE_BASE = 'https://raw.githubusercontent.com/' + OWNER_REPO + '/main/lessons/';
const PUBLIC_KEY = crypto.createPublicKey(fs.readFileSync(path.join(__dirname, 'pack-public.pem'), 'utf8'));

const builtinDir = () => path.join(__dirname, '..', 'lessons');
const dataDir = (...p) => path.join(app.getPath('userData'), ...p);
const ensure = (d) => { fs.mkdirSync(d, { recursive: true }); return d; };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } };

function verify(buf, sigB64) {
  try { return crypto.verify(null, buf, PUBLIC_KEY, Buffer.from(String(sigB64).trim(), 'base64')); } catch (_) { return false; }
}

function loadPackFrom(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, 'pack.json'));
    const sig = fs.readFileSync(path.join(dir, 'pack.sig'), 'utf8');
    if (!verify(raw, sig)) return null;
    const pack = JSON.parse(raw.toString('utf8'));
    return Array.isArray(pack.lessons) ? pack : null;
  } catch (_) { return null; }
}

function loadBestPack() {
  const a = loadPackFrom(builtinDir()), b = loadPackFrom(dataDir('pack'));
  const best = [a, b].filter(Boolean).sort((x, y) => (y.version || 0) - (x.version || 0))[0];
  return best || { version: 0, tracks: [], lessons: [] };
}

async function fetchText(url, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await net.fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); }
  finally { clearTimeout(t); }
}

// returns { updated, version, error }
async function checkRemote() {
  try {
    const cur = loadBestPack().version || 0;
    const raw = await fetchText(REMOTE_BASE + 'pack.json?t=' + Date.now(), 9000);
    const sig = (await fetchText(REMOTE_BASE + 'pack.sig?t=' + Date.now(), 9000)).toString('utf8');
    if (!verify(raw, sig)) return { updated: false, error: 'signature-invalid' };
    const pack = JSON.parse(raw.toString('utf8'));
    if (!(pack.version > cur)) return { updated: false, version: cur };
    const d = ensure(dataDir('pack'));
    fs.writeFileSync(path.join(d, 'pack.json'), raw); fs.writeFileSync(path.join(d, 'pack.sig'), sig);
    return { updated: true, version: pack.version };
  } catch (e) { return { updated: false, error: e.message }; }
}

// ---------- progress ----------
const progressFile = () => dataDir('progress.json');
const loadProgress = () => readJson(progressFile(), { lessons: {} });
function markProgress(id, patch) {
  const p = loadProgress(); p.lessons[id] = { ...(p.lessons[id] || {}), ...patch, at: new Date().toISOString() };
  ensure(path.dirname(progressFile())); fs.writeFileSync(progressFile(), JSON.stringify(p, null, 2));
}

// ---------- settings ----------
const settingsFile = () => dataDir('settings.json');
const loadSettings = () => readJson(settingsFile(), {});
function saveSettings(patch) { const s = { ...loadSettings(), ...patch }; ensure(path.dirname(settingsFile())); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); return s; }

// ---------- drafts (trainer) ----------
const draftsDir = () => ensure(dataDir('drafts'));
const listDrafts = () => fs.readdirSync(draftsDir()).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(draftsDir(), f), null)).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
const getDraft = (id) => readJson(path.join(draftsDir(), path.basename(id) + '.json'), null);
const saveDraft = (d) => { d.updatedAt = new Date().toISOString(); fs.writeFileSync(path.join(draftsDir(), path.basename(d.id) + '.json'), JSON.stringify(d, null, 2)); return d; };
const deleteDraft = (id) => { try { fs.unlinkSync(path.join(draftsDir(), path.basename(id) + '.json')); } catch (_) { /* ignore */ } };

function listForLauncher(trainer) {
  const pack = loadBestPack(), prog = loadProgress();
  const lessons = pack.lessons.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((l) => ({
    id: l.id, track: l.track, order: l.order, title: l.title, summary: l.summary || '', minutes: l.minutes || 0, requires: l.requires || '', steps: l.steps.length,
    done: !!(prog.lessons[l.id] && prog.lessons[l.id].done), stars: (prog.lessons[l.id] && prog.lessons[l.id].stars) || 0,
  }));
  return { packVersion: pack.version, tracks: pack.tracks || [], lessons, drafts: trainer ? listDrafts().map((d) => ({ id: d.id, title: d.title, steps: d.steps.length, updatedAt: d.updatedAt })) : [] };
}

function getLesson(id) { return loadBestPack().lessons.find((l) => l.id === id) || null; }

module.exports = { loadBestPack, checkRemote, markProgress, loadProgress, loadSettings, saveSettings, listDrafts, getDraft, saveDraft, deleteDraft, listForLauncher, getLesson, OWNER_REPO };
