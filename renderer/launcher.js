'use strict';
(async () => {
  const api = window.companion;
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  let info = await api.invoke('app:info');
  let data = { tracks: [], lessons: [], drafts: [], packVersion: 0 };
  let upd = { state: 'idle' };
  let view = { name: 'home', draftId: null };
  let busyMsg = '';

  // tiny DOM builder: h('div', {class:'x', onclick:fn}, 'text', childNode...)  — only textContent is ever used, so lesson/draft text can't inject markup
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => { if (c == null || c === false) return; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  const num = (n) => String(n);

  // ---------- data ----------
  async function reload() {
    info = await api.invoke('app:info');
    data = await api.invoke('lessons:list');
    render();
  }

  // ---------- update banner ----------
  function renderBanner() {
    const b = $('banner'); b.className = 'banner hidden'; b.textContent = '';
    const s = upd;
    if (s.state === 'downloading') { b.className = 'banner'; b.appendChild(h('span', { class: 'grow' }, `ينزّل تحديث البرنامج ${s.version || ''} … ${num(s.percent || 0)}%`)); }
    else if (s.state === 'ready') { b.className = 'banner good'; b.appendChild(h('span', { class: 'grow' }, `التحديث ${s.version} جاهز.`)); b.appendChild(h('button', { onclick: () => api.invoke('update:install') }, 'أعد التشغيل الآن')); }
    else if (busyMsg) { b.className = 'banner good'; b.appendChild(h('span', { class: 'grow' }, busyMsg)); }
  }

  // ---------- home ----------
  function lessonCard(l, idx) {
    return h('div', { class: 'card' },
      h('span', { class: 'no' }, 'تدريب ' + num(idx)),
      h('h3', {}, l.title),
      h('p', {}, l.summary),
      l.requires ? h('div', { class: 'req' }, 'يحتاج: ' + l.requires) : null,
      h('div', { class: 'meta' }, h('span', {}, '⏱ ' + num(l.minutes) + ' دقائق تقريبًا'), h('span', {}, num(l.steps) + ' خطوة')),
      h('div', { class: 'row' },
        l.done ? h('span', { class: 'done' }, '✓ أكملته ★ ' + num(l.stars)) : null,
        h('button', { class: 'btn', onclick: () => startLesson(l.id) }, l.done ? 'أعد التدريب' : 'ابدأ التدريب')));
  }

  async function startLesson(id, draft) {
    const r = await api.invoke('lesson:start', { id, draft: !!draft });
    if (r && r.error) alert('تعذّر بدء الدرس: ' + r.error);
  }

  function trainerBox() {
    const title = h('input', { type: 'text', placeholder: 'اسم الدرس الجديد، مثل: إنشاء مفتاح في OpenRouter', id: 'recTitle' });
    return h('section', { class: 'trainer' },
      h('h2', {}, 'وضع المدرب'),
      h('p', { class: 'hint' }, 'سجّل درسًا بنفسك: اضغط «ابدأ التسجيل» ثم نفّذ الخطوات على الشاشة كما تفعل عادة، وأنا أحفظ كل ضغطة باسم الزر ومكانه. لا أسجّل ما تكتبه بلوحة المفاتيح. بعدها اكتب شرحك العام وأطلب من Claude Code أن يشرح كل خطوة بالتفصيل.'),
      h('div', { class: 'rec' }, title, h('button', { class: 'btn', onclick: async () => { await api.invoke('rec:start', { title: title.value.trim() || 'درس جديد' }); } }, '⏺ ابدأ التسجيل')),
      data.drafts.length ? h('div', { class: 'drafts' }, data.drafts.map((d) => h('div', { class: 'drow' },
        h('span', { class: 't' }, d.title), h('span', { class: 's' }, num(d.steps) + ' خطوة'),
        h('button', { class: 'btn ghost small', onclick: () => { view = { name: 'editor', draftId: d.id }; render(); } }, 'فتح وتحرير'),
        h('button', { class: 'btn small', onclick: () => startLesson(d.id, true) }, 'تجربة'),
        h('button', { class: 'btn danger small', onclick: async () => { if (confirm('حذف المسودة «' + d.title + '»؟')) { await api.invoke('draft:delete', { id: d.id }); reload(); } } }, 'حذف')))) : null);
  }

  function renderHome() {
    app.textContent = '';
    const byTrack = new Map();
    data.lessons.forEach((l) => { const k = l.track || 'other'; if (!byTrack.has(k)) byTrack.set(k, []); byTrack.get(k).push(l); });
    let n = 0;
    const order = data.tracks.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    order.forEach((t) => {
      const items = byTrack.get(t.id); if (!items) return; byTrack.delete(t.id);
      app.appendChild(h('section', { class: 'track' }, h('h2', {}, t.title), t.summary ? h('p', { class: 'sub' }, t.summary) : null, h('div', { class: 'grid' }, items.map((l) => lessonCard(l, ++n)))));
    });
    byTrack.forEach((items) => app.appendChild(h('section', { class: 'track' }, h('div', { class: 'grid' }, items.map((l) => lessonCard(l, ++n))))));
    if (!data.lessons.length) app.appendChild(h('div', { class: 'empty' }, 'لا توجد تدريبات بعد.'));
    if (info.trainer) app.appendChild(trainerBox());
  }

  // ---------- editor (trainer) ----------
  async function renderEditor() {
    app.textContent = '';
    const d = await api.invoke('draft:get', { id: view.draftId });
    if (!d || d.error) { view = { name: 'home' }; return render(); }
    const status = h('div', { class: 'status hidden' });
    const say = (msg, err) => { status.className = 'status' + (err ? ' err' : ''); status.textContent = msg; };
    const f = {
      title: h('input', { type: 'text', value: d.title }),
      summary: h('input', { type: 'text', value: d.summary || '' }),
      outline: h('textarea', { rows: '4', placeholder: 'اشرح الدرس بكلامك: ما الهدف؟ وماذا يخرج به المتدرب؟ (اختياري لكنه يرفع جودة الشرح)' }),
      outro: h('textarea', { rows: '2' }),
    };
    f.outline.value = d.outline || ''; f.outro.value = d.outro || '';
    const stepBoxes = d.steps.map((s, i) => {
      const ta = h('textarea', { rows: '3', placeholder: 'نص قلم لهذه الخطوة' }); ta.value = s.say || '';
      const hint = h('input', { type: 'text', value: s.hint || '', placeholder: 'سطر صغير تحت النص (اختياري)' });
      const wait = h('select', {}, h('option', { value: 'click' }, 'ينتظر ضغطة المتدرب'), h('option', { value: 'next' }, 'ينتقل بزر التالي'));
      wait.value = s.wait || 'next';
      const label = s.rec ? `${s.rec.name || '(زر بلا اسم)'} · ${s.rec.type || ''} · ${s.rec.process || ''}` : (i === 0 ? 'ترحيب' : 'شرح');
      const box = h('div', { class: 'step' },
        h('div', { class: 'head' }, h('b', {}, 'خطوة ' + num(i + 1)), h('span', { class: 'grow' }, label),
          s.target ? wait : null,
          h('button', { class: 'btn danger small', onclick: () => { d.steps.splice(i, 1); persist(false).then(renderEditor); } }, 'حذف')),
        ta, hint);
      box._get = () => { const o = { ...s, say: ta.value.trim(), hint: hint.value.trim() }; if (!o.hint) delete o.hint; if (s.target) o.wait = wait.value; return o; };
      return box;
    });
    async function persist(read = true) {
      if (read) { d.title = f.title.value.trim() || d.title; d.summary = f.summary.value.trim(); d.outline = f.outline.value; d.outro = f.outro.value.trim(); d.steps = stepBoxes.map((b) => b._get()); }
      return api.invoke('draft:save', { draft: d });
    }
    const explainBtn = h('button', { class: 'btn', disabled: !info.claudeCli, title: info.claudeCli ? '' : 'يحتاج Claude Code مثبّتًا على جهازك', onclick: async () => {
      explainBtn.disabled = true; say('Claude Code يكتب الشرح الآن… قد يأخذ دقيقة أو أكثر.');
      await persist(true);
      const r = await api.invoke('draft:explain', { id: d.id, outline: f.outline.value });
      if (r && r.error) { say('تعذّر الشرح: ' + r.error, true); explainBtn.disabled = false; return; }
      say('تمت كتابة الشرح. راجعه وعدّله كما تريد ثم احفظ.'); renderEditor().then(() => { /* fresh values */ });
    } }, '✨ اشرح الخطوات بـ Claude Code');
    app.appendChild(h('section', { class: 'editor' },
      h('h2', {}, 'تحرير الدرس'),
      h('div', { class: 'bar' },
        h('button', { class: 'btn ghost', onclick: () => { view = { name: 'home' }; render(); } }, '→ رجوع'),
        explainBtn,
        h('button', { class: 'btn', onclick: async () => { await persist(true); say('تم الحفظ.'); } }, 'حفظ'),
        h('button', { class: 'btn ghost', onclick: async () => { await persist(true); startLesson(d.id, true); } }, 'جرّب الدرس'),
        h('button', { class: 'btn ghost', onclick: async () => { await persist(true); const r = await api.invoke('draft:export', { id: d.id }); say(r && r.path ? 'صُدّر إلى: ' + r.path : 'تعذّر التصدير', !(r && r.path)); } }, 'تصدير للنشر')),
      status,
      h('label', {}, 'عنوان الدرس'), f.title,
      h('label', {}, 'ملخص من سطر واحد'), f.summary,
      h('label', {}, 'شرحك العام للدرس (يقرؤه Claude عند كتابة الخطوات)'), f.outline,
      h('label', {}, 'الخطوات'), ...stepBoxes,
      h('label', {}, 'ختام الدرس'), f.outro));
  }

  function render() {
    renderBanner();
    $('ver').textContent = `البرنامج ${info.version}${info.packaged ? '' : ' (تطوير)'} · الدروس ${num(data.packVersion || info.packVersion)}${info.trainer ? ' · وضع المدرب' : ''}`;
    if (view.name === 'editor') renderEditor(); else renderHome();
  }

  // ---------- events ----------
  api.on('update-state', (s) => { upd = s; renderBanner(); });
  api.on('lessons-changed', () => reload());
  api.on('draft-recorded', (d) => { if (d && d.id) { view = { name: 'editor', draftId: d.id }; reload(); } });

  $('btnUpdate').addEventListener('click', async () => {
    busyMsg = 'أبحث عن تحديثات…'; renderBanner();
    api.invoke('update:check');
    const r = await api.invoke('pack:check');
    busyMsg = r && r.updated ? `نزلت دروس جديدة (الإصدار ${r.version}).` : (r && r.error ? 'تعذّر الاتصال بالإنترنت لفحص الدروس.' : 'الدروس محدّثة.');
    renderBanner(); setTimeout(() => { busyMsg = ''; renderBanner(); }, 4000);
  });
  document.addEventListener('keydown', async (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') { await api.invoke('trainer:set', { on: !info.trainer }); view = { name: 'home' }; reload(); }
  });

  upd = (await api.invoke('update:state')) || upd;
  await reload();
})();
