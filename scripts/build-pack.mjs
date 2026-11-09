// Merge lessons/src/*.json into lessons/pack.json, validate, bump the version, and sign it (Ed25519).
// Usage: node scripts/build-pack.mjs [--keep-version]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'lessons', 'src');
const packFile = path.join(root, 'lessons', 'pack.json');
const sigFile = path.join(root, 'lessons', 'pack.sig');
const keyFile = path.join(os.homedir(), '.baraa-companion', 'pack-signing.pem');

const meta = JSON.parse(fs.readFileSync(path.join(src, '_meta.json'), 'utf8'));
const lessons = fs.readdirSync(src).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .map((f) => ({ f, l: JSON.parse(fs.readFileSync(path.join(src, f), 'utf8')) }));

const problems = [];
const ids = new Set();
for (const { f, l } of lessons) {
  const where = f + ': ';
  for (const k of ['id', 'track', 'title', 'summary', 'steps']) if (!l[k]) problems.push(where + 'missing ' + k);
  if (ids.has(l.id)) problems.push(where + 'duplicate id ' + l.id); ids.add(l.id);
  if (!meta.tracks.find((t) => t.id === l.track)) problems.push(where + 'unknown track ' + l.track);
  (l.steps || []).forEach((s, i) => {
    const w = where + 'step ' + (i + 1) + ': ';
    if (!s.say || !String(s.say).trim()) problems.push(w + 'empty say');
    if (s.say && String(s.say).length > 330) problems.push(w + 'say too long (' + String(s.say).length + ')');
    if (s.wait === 'click' && !s.target) problems.push(w + 'click step without target');
    if (s.target && s.target.uia && !s.target.uia.process && !s.target.uia.window) problems.push(w + 'uia target needs process or window');
    if (((s.say || '').match(/\*\*/g) || []).length % 2) problems.push(w + 'unbalanced ** markup');
  });
}
if (problems.length) { console.error('PACK NOT BUILT:\n - ' + problems.join('\n - ')); process.exit(1); }

let version = 1;
if (fs.existsSync(packFile)) { try { version = JSON.parse(fs.readFileSync(packFile, 'utf8')).version + (process.argv.includes('--keep-version') ? 0 : 1); } catch { /* first build */ } }
const pack = { version, updated: new Date().toISOString().slice(0, 10), tracks: meta.tracks, lessons: lessons.map((x) => x.l).sort((a, b) => (a.order || 0) - (b.order || 0)) };
const raw = Buffer.from(JSON.stringify(pack, null, 1) + '\n', 'utf8');
fs.writeFileSync(packFile, raw);

const priv = crypto.createPrivateKey(fs.readFileSync(keyFile, 'utf8'));
fs.writeFileSync(sigFile, crypto.sign(null, raw, priv).toString('base64') + '\n');
const pub = crypto.createPublicKey(fs.readFileSync(path.join(root, 'src', 'pack-public.pem'), 'utf8'));
const ok = crypto.verify(null, raw, pub, Buffer.from(fs.readFileSync(sigFile, 'utf8').trim(), 'base64'));
console.log(`pack v${version}: ${pack.lessons.length} lessons, ${pack.lessons.reduce((n, l) => n + l.steps.length, 0)} steps, signature ${ok ? 'VERIFIED' : 'FAILED'}`);
if (!ok) process.exit(1);
