'use strict';
(() => {
  const api = window.companion;
  const $ = (id) => document.getElementById(id);
  const el = {
    ring: $('ring'), char: $('char'), fxs: document.querySelector('.fx-state'), bubble: $('bubble'),
    say: $('say'), hint: $('hint'), chip: $('chip'), who: $('who'),
    next: $('next'), back: $('back'), skip: $('skip'), retry: $('retry'), close: $('close'), copy: $('copy'),
    hud: $('hud'), hudStep: $('hudStep'), hudStars: $('hudStars'), hSkip: $('hSkip'), hExit: $('hExit'), cv: $('fx'),
    rec: $('rec'), recTitle: $('recTitle'), recCount: $('recCount'), recLast: $('recLast'), recNote: $('recNote'), recStop: $('recStop'),
  };
  let W = innerWidth, H = innerHeight;
  const M = 14;            // screen margin
  const PEN = 155;         // pen length on screen (190 * 0.8 svg scale), tip -> top
  const GAP = 9;           // gap between the nib and the target edge

  let cur = null, rect = null, mode = 'step', angle = 0, revealTimer = null, stars = 0, total = 1;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const inside = (p) => p.x >= M && p.x <= W - M && p.y >= M && p.y <= H - M;
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const angDist = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  const show = (e, on) => e.classList.toggle('off', !on);

  // ---------- text ----------
  // Latin key combos (Ctrl+Alt+N) must keep their own direction inside Arabic text
  const COMBO = /([A-Za-z][A-Za-z0-9]*(?:\+[A-Za-z0-9→←]+)+)/g;
  function appendBidi(parent, text) {
    String(text).split(COMBO).forEach((seg, i) => {
      if (!seg) return;
      if (i % 2) { const b = document.createElement('bdi'); b.setAttribute('dir', 'ltr'); b.textContent = seg; parent.appendChild(b); }
      else parent.appendChild(document.createTextNode(seg));
    });
  }

  // one span per word so words can appear one by one; punctuation stuck to a bold word stays glued to it
  function buildWords(text) {
    el.say.textContent = '';
    const parts = String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    const spans = [];
    let last = null, prevTrail = true;
    parts.forEach((p) => {
      const bold = /^\*\*[^*]+\*\*$/.test(p);
      const t = bold ? p.slice(2, -2) : p;
      const lead = /^\s/.test(t), trail = /\s$/.test(t);
      t.split(/\s+/).filter(Boolean).forEach((word, wi) => {
        const node = bold ? Object.assign(document.createElement('b'), { textContent: word }) : document.createTextNode(word);
        if (wi === 0 && !lead && !prevTrail && last) { last.appendChild(node); return; }
        if (last) el.say.appendChild(document.createTextNode(' '));
        const s = document.createElement('span');
        s.className = 'w';
        s.appendChild(node);
        el.say.appendChild(s);
        spans.push(s);
        last = s;
      });
      prevTrail = trail;
    });
    return spans;
  }

  function reveal(spans) {
    clearInterval(revealTimer);
    let i = 0;
    setState('talk', true);
    revealTimer = setInterval(() => {
      if (i < spans.length) spans[i++].classList.add('on');
      if (i >= spans.length) { clearInterval(revealTimer); setTimeout(() => setState('talk', false), 250); }
    }, 55);
  }

  function setState(name, on) { el.fxs.classList.toggle(name, !!on); }
  function pulseState(name, ms) {
    el.fxs.classList.remove('talk', 'happy', 'miss', 'hello');
    void el.fxs.offsetWidth;
    el.fxs.classList.add(name);
    setTimeout(() => el.fxs.classList.remove(name), ms);
  }
  function setHint(text, cls) {
    el.hint.textContent = '';
    appendBidi(el.hint, text || '');
    el.hint.className = 'hint' + (cls ? ' ' + cls : '');
  }

  // ---------- placement ----------
  function placeChar(tipX, tipY, rotDeg) {
    const d = ((rotDeg - angle) % 360 + 540) % 360 - 180;
    angle += d;
    el.char.style.transform = `translate(${Math.round(tipX)}px, ${Math.round(tipY)}px) rotate(${angle.toFixed(1)}deg)`;
  }
  function placeBubble(x, y) { el.bubble.style.left = Math.round(x) + 'px'; el.bubble.style.top = Math.round(y) + 'px'; }

  // choose the direction the pen points from, so pen + bubble fit on screen and never cover the target
  function pointPlacement(r, bw, bh) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const target = { x: r.x - 14, y: r.y - 14, w: r.w + 28, h: r.h + 28 };
    let best = null;
    for (let a = 0; a < 360; a += 15) {
      const rad = a * Math.PI / 180, ux = Math.cos(rad), uy = Math.sin(rad);
      const tx = Math.abs(ux) < 1e-6 ? Infinity : (r.w / 2) / Math.abs(ux);
      const ty = Math.abs(uy) < 1e-6 ? Infinity : (r.h / 2) / Math.abs(uy);
      const t = Math.min(tx, ty);
      const tip = { x: cx - ux * (t + GAP), y: cy - uy * (t + GAP) };
      const end = { x: tip.x - ux * PEN, y: tip.y - uy * PEN };
      const ext = Math.abs(ux) * bw / 2 + Math.abs(uy) * bh / 2 + 12;
      const bx = end.x - ux * ext - bw / 2, by = end.y - uy * ext - bh / 2;
      const cbx = clamp(bx, M, W - bw - M), cby = clamp(by, M, H - bh - M);
      const box = { x: cbx, y: cby, w: bw, h: bh };
      let cost = angDist(a, 115) / 180 * 40 + Math.hypot(cbx - bx, cby - by) * 0.6;
      if (!inside(tip) || !inside(end)) cost += 1000;
      if (overlap(box, target)) cost += 1000;
      for (let k = 1; k <= 8; k++) {
        const f = k / 9, p = { x: tip.x - ux * PEN * f, y: tip.y - uy * PEN * f };
        if (overlap(box, { x: p.x - 8, y: p.y - 8, w: 16, h: 16 })) { cost += 400; break; }
      }
      if (!best || cost < best.cost) best = { cost, tip, ux, uy, bx: cbx, by: cby };
    }
    return best;
  }

  function layout() {
    const bw = el.bubble.offsetWidth, bh = el.bubble.offsetHeight;
    if (rect && mode === 'step') {
      const p = pointPlacement(rect, bw, bh);
      placeChar(p.tip.x, p.tip.y, Math.atan2(-p.ux, p.uy) * 180 / Math.PI);
      placeBubble(p.bx, p.by);
      return;
    }
    const anchor = (cur && cur.step && cur.step.anchor) || (mode === 'done' ? 'center' : 'bottom-left');
    if (anchor === 'center') {
      const bx = W / 2 - bw / 2 + 110, by = H / 2 - bh / 2 - 30;
      placeBubble(bx, by); placeChar(bx - 80, by + bh / 2 + 150, 12);
    } else if (anchor === 'bottom-right') {
      const bx = W - bw - 40, by = H - bh - 110;
      placeBubble(bx, by); placeChar(bx + bw + 4, by + bh / 2 + 120, -14);
    } else {
      const bx = M + 150, by = H - bh - 110;
      placeBubble(bx, by); placeChar(bx - 74, by + bh / 2 + 130, 12);
    }
  }

  // ---------- target ring ----------
  function applyRect() {
    if (!cur || mode !== 'step') return;
    const s = cur.step;
    if (rect) {
      const pad = 6;
      el.ring.classList.remove('hidden', 'done');
      el.ring.style.left = (rect.x - pad) + 'px'; el.ring.style.top = (rect.y - pad) + 'px';
      el.ring.style.width = (rect.w + pad * 2) + 'px'; el.ring.style.height = (rect.h + pad * 2) + 'px';
      if (s.wait === 'click') setHint('اضغط على الزر المضيء بنفسك، وأنا أنتظرك.', 'ok'); else setHint(s.hint || '', '');
      if (s.wait !== 'click') show(el.retry, false);
    } else {
      el.ring.classList.add('hidden');
      if (s.hasTarget) { setHint(s.notFound || 'ما لقيت الزر على الشاشة. تأكد أن البرنامج ظاهر قدامك وأنا أعيد البحث تلقائيًا، أو تخطَّ الخطوة.', 'warn'); show(el.retry, true); }
      else setHint(s.hint || '', '');
    }
    layout();
  }

  // ---------- fx: sparkles ----------
  const ctx = el.cv.getContext('2d');
  let parts = [], raf = 0;
  function sizeCanvas() { el.cv.width = W; el.cv.height = H; }
  function burst(x, y, n) {
    const cols = ['#E7CF93', '#BA9B5A', '#FFFFFF', '#3FAE8F', '#F3E5BE'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 7;
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4, g: 0.22, life: 1, size: 3 + Math.random() * 7, rot: Math.random() * 3, vr: (Math.random() - .5) * .3, col: cols[i % cols.length], star: Math.random() < .55 });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function drawStar(s) {
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot); ctx.globalAlpha = Math.max(0, s.life); ctx.fillStyle = s.col;
    if (s.star) {
      const r = s.size, q = r * 0.28; ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(q, -q); ctx.lineTo(r, 0); ctx.lineTo(q, q); ctx.lineTo(0, r); ctx.lineTo(-q, q); ctx.lineTo(-r, 0); ctx.lineTo(-q, -q); ctx.closePath(); ctx.fill();
    } else { ctx.beginPath(); ctx.arc(0, 0, s.size * 0.45, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function tick() {
    ctx.clearRect(0, 0, W, H);
    parts = parts.filter((s) => s.life > 0);
    parts.forEach((s) => { s.x += s.vx; s.y += s.vy; s.vy += s.g; s.vx *= 0.985; s.rot += s.vr; s.life -= 0.016; drawStar(s); });
    raf = parts.length ? requestAnimationFrame(tick) : 0;
    if (!parts.length) ctx.clearRect(0, 0, W, H);
  }

  // ---------- hud ----------
  function updateHud() {
    el.hudStep.textContent = mode === 'done' ? 'اكتملت الجولة' : `الخطوة ${cur.index + 1} من ${total}`;
    el.hudStars.textContent = String(stars);
    show(el.hSkip, mode !== 'done');
  }
  function popBubble() { el.bubble.classList.remove('hidden', 'fadein'); void el.bubble.offsetWidth; el.bubble.classList.add('fadein'); }

  // ---------- messages from main ----------
  api.on('boot', (m) => {
    W = m.w || innerWidth; H = m.h || innerHeight; total = m.total;
    sizeCanvas();
    el.who.textContent = m.name;
    document.body.classList.toggle('film', !!m.film);
    el.char.style.transition = 'none';
    el.char.style.transform = `translate(-160px, ${H + 320}px) rotate(20deg)`;
    angle = 20;
    void el.char.offsetWidth;
    el.char.style.transition = '';
  });

  api.on('step', (m) => {
    cur = m; mode = 'step'; rect = null; stars = m.stars; total = m.total;
    const s = m.step;
    el.ring.classList.add('hidden');
    el.rec.classList.add('hidden');
    el.chip.textContent = `${m.index + 1} من ${m.total}`;
    const spans = buildWords(s.say);
    setHint(s.wait === 'click' && s.hasTarget ? 'أبحث عن الزر…' : (s.hint || ''), '');
    el.next.textContent = s.button || (m.index === m.total - 1 ? 'إنهاء' : 'التالي');
    show(el.next, s.wait !== 'click');
    el.back.textContent = 'السابق'; show(el.back, m.index > 0);
    show(el.skip, s.wait === 'click');
    show(el.retry, false);
    el.copy.textContent = '📋 انسخ الـ Prompt'; show(el.copy, !!s.copy);
    popBubble();
    el.hud.classList.remove('hidden');
    updateHud();
    layout();
    if (s.mood === 'hello') pulseState('hello', 1200);
    reveal(spans);
  });

  api.on('rect', (m) => { rect = m.rect; applyRect(); });

  api.on('stuck', () => {
    if (!cur || mode !== 'step') return;
    setHint('تحتاج مساعدة؟ اضغط «أرني من جديد» أو تخطَّ هذه الخطوة إن كنت تعرفها.', 'warn');
    show(el.retry, true);
  });
  api.on('nudge', () => { pulseState('hello', 1200); el.ring.classList.remove('done'); });

  api.on('hit', (m) => {
    stars = m.stars; updateHud();
    el.ring.classList.add('done');
    setHint('أحسنت! ★', 'ok');
    show(el.retry, false);
    pulseState('happy', 1100);
    if (rect) burst(rect.x + rect.w / 2, rect.y + rect.h / 2, 44);
  });

  api.on('miss', () => {
    pulseState('miss', 500);
    setHint('قريب! اضغط على الزر المضيء بالضبط.', 'warn');
    setTimeout(() => { if (cur && mode === 'step' && rect && !el.ring.classList.contains('done')) setHint('اضغط على الزر المضيء بنفسك، وأنا أنتظرك.', 'ok'); }, 2200);
  });

  api.on('done', (m) => {
    mode = 'done'; rect = null; stars = m.stars;
    el.ring.classList.add('hidden');
    const text = (m.outro || 'أحسنت! أكملت الدرس وجمعت **{stars}** نجوم.').replace('{stars}', String(m.stars));
    const spans = buildWords(text);
    el.chip.textContent = '★ ' + m.stars;
    setHint('', '');
    el.next.textContent = 'العودة للقائمة'; show(el.next, true);
    el.back.textContent = 'أعد الدرس'; show(el.back, true);
    show(el.skip, false); show(el.retry, false); show(el.copy, false);
    popBubble();
    updateHud();
    layout();
    pulseState('happy', 1100);
    burst(W / 2, H / 2 - 40, 90);
    reveal(spans);
  });

  // ---------- recording pill (trainer) ----------
  api.on('rec:start', (m) => {
    el.bubble.classList.add('hidden'); el.hud.classList.add('hidden'); el.ring.classList.add('hidden');
    el.recTitle.textContent = m.title || 'تسجيل'; el.recCount.textContent = 'لا خطوات بعد'; el.recLast.textContent = '';
    el.rec.classList.remove('hidden');
    placeChar(W / 2 - 360, 150, 14);
  });
  api.on('rec:count', (m) => { el.recCount.textContent = `${m.n} خطوة`; el.recLast.textContent = m.last ? '« ' + String(m.last).slice(0, 28) + ' »' : ''; pulseState('hello', 600); });
  api.on('rec:stop', () => { el.rec.classList.add('hidden'); });

  // ---------- buttons ----------
  el.next.addEventListener('click', () => api.send(mode === 'done' ? 'ui:exit' : 'ui:next'));
  el.back.addEventListener('click', () => api.send(mode === 'done' ? 'ui:restart' : 'ui:back'));
  el.skip.addEventListener('click', () => api.send('ui:skip'));
  el.hSkip.addEventListener('click', () => api.send('ui:skip'));
  el.retry.addEventListener('click', () => api.send('ui:retry'));
  el.copy.addEventListener('click', () => { api.send('ui:copy'); el.copy.textContent = 'تم النسخ ✓ الصقه بـ Ctrl+V'; });
  el.close.addEventListener('click', () => api.send('ui:exit'));
  el.hExit.addEventListener('click', () => api.send('ui:exit'));
  el.recStop.addEventListener('click', () => api.send('ui:rec-stop'));
  el.recNote.addEventListener('click', () => api.send('ui:rec-note'));

  // the overlay is click-through; only the buttons capture the mouse
  let interactive = false;
  document.addEventListener('mousemove', (e) => {
    const on = !!(e.target && e.target.closest && e.target.closest('.btn, .hbtn, .xbtn'));
    if (on !== interactive) { interactive = on; api.send('ui:interactive', on); }
  });
})();
