'use strict';
// Plays one lesson: shows each step, finds its target through UI Automation, waits for the learner's real click.
const mouse = require('./mouse');

const STUCK_MS = 22000;

class Runner {
  constructor({ overlay, uia, log, onFinish }) {
    this.overlay = overlay; this.uia = uia; this.log = log; this.onFinish = onFinish || (() => {});
    this.active = false;
  }

  get running() { return this.active; }

  async start(lesson, opts = {}) {
    if (this.active) this.stop(false);
    this.lesson = lesson; this.stars = 0; this.idx = -1; this.step = null; this.rect = null;
    this.token = 0; this.busy = false; this.locked = false; this.finished = false;
    this.film = !!opts.film;
    this.active = true;
    await this.overlay.open();
    const b = this.overlay.bounds;
    this.overlay.send('boot', { title: lesson.title || '', name: (lesson.companion && lesson.companion.name) || 'قلم', total: lesson.steps.length, film: this.film, w: b.width, h: b.height });
    this.unsub = mouse.onDown(() => this.onMouseDown());
    this.poll = setInterval(() => { if (this.step && this.step.target && !this.overlay.hidden) this.refind(false); }, 1800);
    this.goto(opts.startAt || 0);
  }

  stop(completed) {
    if (!this.active) return;
    this.active = false; this.token++;
    clearInterval(this.poll); clearTimeout(this.stuckTimer);
    if (this.unsub) this.unsub();
    this.overlay.close();
    this.onFinish({ lessonId: this.lesson && this.lesson.id, completed: !!completed, stars: this.stars, final: true });
  }

  // ---------- targets ----------
  async resolveTarget(t) {
    if (!t) return { rect: null, none: true };
    const b = this.overlay.bounds;
    if (t.fraction) { const [fx, fy, fw, fh] = t.fraction; return { rect: { x: Math.round(fx * b.width), y: Math.round(fy * b.height), w: Math.round(fw * b.width), h: Math.round(fh * b.height) } }; }
    if (t.rect) { const [x, y, w, h] = t.rect; return { rect: { x, y, w, h } }; }
    let m = null;
    if (t.uia) m = await this.uia.request({ cmd: 'find', process: t.uia.process, window: t.uia.window, name: t.uia.name, type: t.uia.type, index: t.uia.index });
    else if (t.win) m = await this.uia.request({ cmd: 'rel', process: t.win.process, window: t.win.window, rel: t.win.rel });
    else return { rect: null, none: true };
    if (!m || !m.found) return { rect: null, reason: (m && m.reason) || 'unknown' };
    return { rect: this.overlay.physToLocal(m), name: m.name };
  }

  static same(a, b) { return (!a && !b) || (a && b && Math.abs(a.x - b.x) < 3 && Math.abs(a.y - b.y) < 3 && Math.abs(a.w - b.w) < 3 && Math.abs(a.h - b.h) < 3); }

  async refind(force) {
    if (!this.active || !this.step || !this.step.target || this.busy || this.locked) return;
    this.busy = true;
    const my = this.token;
    const res = await this.resolveTarget(this.step.target);
    this.busy = false;
    if (my !== this.token || !this.active) return;
    if (force || !Runner.same(this.rect, res.rect)) {
      this.rect = res.rect;
      this.log('target ' + (this.rect ? JSON.stringify(this.rect) + ' "' + (res.name || '') + '"' : 'NOT FOUND (' + res.reason + ')'));
      this.overlay.send('rect', { rect: this.rect, reason: res.reason || null });
    }
  }

  // ---------- steps ----------
  goto(i) {
    if (!this.active) return;
    if (i < 0) i = 0;
    if (i >= this.lesson.steps.length) return this.finish();
    this.token++; this.busy = false; this.locked = false; this.rect = null;
    clearTimeout(this.stuckTimer);
    this.idx = i; this.step = this.lesson.steps[i];
    const s = this.step;
    this.log('step ' + (i + 1) + '/' + this.lesson.steps.length + (s.target ? ' (target)' : ' (talk)'));
    this.overlay.send('step', {
      index: i, total: this.lesson.steps.length, stars: this.stars,
      step: { say: s.say || '', hint: s.hint || '', wait: s.wait || 'next', mood: s.mood || '', anchor: s.anchor || '', hasTarget: !!s.target, notFound: s.notFound || '', button: s.button || '', copy: !!s.copy },
    });
    this.refind(true);
    if (s.target && (s.wait || 'next') === 'click') this.stuckTimer = setTimeout(() => this.overlay.send('stuck', {}), STUCK_MS);
  }

  finish() {
    this.token++; this.step = null; this.rect = null; this.finished = true;
    clearTimeout(this.stuckTimer);
    this.log('done, stars = ' + this.stars);
    this.overlay.send('done', { stars: this.stars, total: this.lesson.steps.length, outro: this.lesson.outro || '', title: this.lesson.title });
    this.onFinish({ lessonId: this.lesson.id, completed: true, stars: this.stars, final: false });
  }

  currentCopy() { return (this.step && this.step.copy) || ''; }
  next() { this.goto(this.idx + 1); }
  back() { this.goto(this.idx - 1); }
  restart() { this.stars = 0; this.finished = false; this.goto(0); }
  retry() { this.refind(true); this.overlay.send('nudge', {}); clearTimeout(this.stuckTimer); if (this.step && this.step.wait === 'click') this.stuckTimer = setTimeout(() => this.overlay.send('stuck', {}), STUCK_MS); }

  onMouseDown() {
    if (!this.active || this.overlay.hidden || this.locked || !this.step || this.step.wait !== 'click' || !this.rect) return;
    const p = this.overlay.cursorLocal(), r = this.rect, pad = 6;
    const inside = p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
    this.log('click at ' + p.x + ',' + p.y + (inside ? ' INSIDE' : ' outside'));
    if (inside) this.hit(); else this.overlay.send('miss', {});
  }

  hit() {
    if (this.locked) return;
    this.locked = true; this.stars++;
    clearTimeout(this.stuckTimer);
    this.log('HIT on step ' + (this.idx + 1) + ' stars ' + this.stars);
    this.overlay.send('hit', { stars: this.stars });
    const my = this.token;
    setTimeout(() => { if (my === this.token) this.goto(this.idx + 1); }, 1400);
  }
}

module.exports = { Runner };
