'use strict';
// Trainer mode: record the clicks the trainer makes, turn them into a lesson draft, and let Claude Code write the explanations.
const { app } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const mouse = require('./mouse');
const lessons = require('./lessons');

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class Trainer {
  constructor({ overlay, uia, log }) { this.overlay = overlay; this.uia = uia; this.log = log; this.rec = null; }

  get recording() { return !!this.rec; }

  async start(title) {
    if (this.rec) return;
    await this.overlay.open();
    const b = this.overlay.bounds;
    this.rec = { title: title || 'درس جديد', clicks: [], t0: Date.now(), last: 0 };
    this.overlay.send('boot', { title, name: 'قلم', total: 0, film: false, w: b.width, h: b.height });
    this.overlay.send('rec:start', { title: this.rec.title });
    this.uia.request({ cmd: 'ping' });                 // warm the helper so the first click is answered fast
    this.unsub = mouse.onDown(() => this.onDown());
    this.log('recording started: ' + this.rec.title);
  }

  async onDown() {
    if (!this.rec) return;
    const now = Date.now();
    if (now - this.rec.last < 350) return;             // ignore double-click bounce
    const cl = this.overlay.cursorLocal(), b = this.overlay.bounds;
    const pillL = b.width / 2 - 330, pillR = b.width / 2 + 330;
    if (cl.y < 76 && cl.x > pillL && cl.x < pillR) return;   // the recording pill itself
    this.rec.last = now;
    const p = this.overlay.cursorPhysical();
    const at = await this.uia.request({ cmd: 'at', x: p.x, y: p.y }, 6000);
    const c = { x: p.x, y: p.y, at: Date.now() - this.rec.t0 };
    if (at && at.found) Object.assign(c, { process: at.process, windowTitle: at.windowTitle, name: at.name || '', type: at.type || '', rect: at.rect || null, winRect: at.winRect || null });
    this.rec.clicks.push(c);
    this.log('rec click #' + this.rec.clicks.length + ' ' + (c.process || '?') + ' / ' + (c.type || '-') + ' / ' + (c.name || '(no name)'));
    this.overlay.send('rec:count', { n: this.rec.clicks.length, last: c.name || c.type || (c.process || 'click') });
  }

  note() {
    if (!this.rec) return;
    this.rec.clicks.push({ note: true, at: Date.now() - this.rec.t0 });
    this.overlay.send('rec:count', { n: this.rec.clicks.length, last: 'نقطة شرح' });
  }

  stop() {
    if (!this.rec) return null;
    if (this.unsub) this.unsub();
    const r = this.rec; this.rec = null;
    this.overlay.send('rec:stop', {});
    this.overlay.close();
    const steps = [{ say: '', anchor: 'center', wait: 'next', button: 'يلا نبدأ', mood: 'hello' }];
    r.clicks.forEach((c) => {
      if (c.note) { steps.push({ say: '', wait: 'next' }); return; }
      steps.push({ say: '', target: this.targetFrom(c), wait: 'click', rec: { name: c.name, type: c.type, process: c.process, windowTitle: c.windowTitle } });
    });
    steps.push({ say: '', anchor: 'center', wait: 'next', button: 'إنهاء' });
    const draft = {
      id: 'draft-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14),
      title: r.title, summary: '', minutes: Math.max(2, Math.ceil(r.clicks.length * 0.6)), track: 'custom', order: 99, requires: '',
      companion: { name: 'قلم' }, steps, outro: '', createdAt: new Date().toISOString(), outline: '',
    };
    lessons.saveDraft(draft);
    this.log('recording saved: ' + draft.id + ' (' + steps.length + ' steps)');
    return draft;
  }

  targetFrom(c) {
    const proc = c.process ? '^' + esc(c.process) + '$' : undefined;
    const INTERACTIVE = ['Button', 'Hyperlink', 'TabItem', 'MenuItem', 'ListItem', 'CheckBox', 'RadioButton', 'ComboBox', 'Edit', 'SplitButton', 'TreeItem'];
    if (c.name && INTERACTIVE.includes(c.type)) return { uia: { process: proc, name: '^' + esc(c.name) + '$', type: c.type } };
    // unnamed icon: remember where it sits inside its window
    const w = c.winRect, r = c.rect || [c.x - 12, c.y - 12, 24, 24];
    if (w && w[2] > 0 && w[3] > 0) return { win: { process: proc, rel: [+((r[0] - w[0]) / w[2]).toFixed(4), +((r[1] - w[1]) / w[3]).toFixed(4), +(r[2] / w[2]).toFixed(4), +(r[3] / w[3]).toFixed(4)] } };
    return { rect: [c.x - 12, c.y - 12, 24, 24] };
  }

  // ---------- explain with the local Claude Code CLI ----------
  static cliAvailable() {
    return new Promise((res) => execFile('where', ['claude'], { windowsHide: true }, (e) => res(!e)));
  }

  async explain(draft, outline) {
    if (!(await Trainer.cliAvailable())) throw new Error('Claude Code غير مثبّت على هذا الجهاز (أمر claude غير موجود).');
    const recorded = draft.steps.map((s, i) => ({ n: i + 1, kind: s.target ? 'click' : 'talk', control: s.rec ? { name: s.rec.name || '(بدون اسم)', type: s.rec.type, app: s.rec.process, window: s.rec.windowTitle } : null, current: s.say || '' }));
    const prompt = [
      'أنت تكتب نصوص درس تفاعلي تقوده شخصية «قلم» (قلم قصب بلا وجه) فوق الشاشة. المدرّب سجّل خطواته بنفسه والمطلوب شرحها للمتدرب المبتدئ.',
      '', 'عنوان الدرس: ' + draft.title, 'شرح المدرّب العام بكلامه: ' + (outline || '(لم يكتب شيئًا)'),
      '', 'الخطوات المسجّلة (JSON): ' + JSON.stringify(recorded),
      '', 'اكتب لكل خطوة نصًا تشرح فيه: ماذا يسوي هذا العنصر، ولماذا نضغطه الآن، وماذا سيظهر بعده إن كان واضحًا من السياق. الخطوة الأولى (kind=talk في أولها) ترحيب وتعريف بهدف الدرس، والأخيرة (talk في آخرها) ختام قصير.',
      'الأسلوب: لهجة سعودية بيضاء بسيطة تخاطب المتدرب بصيغة المفرد، جملتان على الأكثر لكل خطوة (أقل من 220 حرفًا)، بلا رموز تعبيرية، بلا مبالغة ولا مدح فارغ. اسم الزر أو القائمة يبقى بالإنجليزية كما هو داخل **علامتي نجمة** مثل **Terminal**. قل «تيرمينال» ولا تقل «الطرفية». لا تخترع معلومة لا تعرفها من الخطوات أو من كلام المدرّب، وإن لم تتأكد فاكتب الوصف العام للعنصر فقط.',
      'إن بدت الخطوة في شاشة تسجيل دخول أو دفع فاطلب من المتدرب أن يُدخل بياناته بنفسه، ولا تطلب منه أن يعطيها لأحد.',
      '',
      'أجب بـ JSON فقط دون أي نص قبله أو بعده ولا علامات ```: {"summary":"سطر واحد يصف الدرس","steps":[{"n":1,"say":"...","hint":""}],"outro":"ختام الدرس في جملة أو جملتين"} وعدد عناصر steps يساوي عدد الخطوات المسجّلة بالضبط وبنفس الترتيب. الحقل hint اختياري (سطر قصير يظهر تحت النص، مثل تنبيه أو اختصار مفيد) واتركه فارغًا في الغالب، ولا تكرر فيه اسم الزر.',
    ].join('\n');

    const cwd = path.join(app.getPath('userData'), 'explain-cwd'); fs.mkdirSync(cwd, { recursive: true });
    const out = await new Promise((resolve, reject) => {
      const p = spawn('claude', ['-p', '--model', 'sonnet', '--output-format', 'json', '--max-turns', '1', '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task'], { cwd, shell: true, windowsHide: true });
      let so = '', se = '';
      const t = setTimeout(() => { try { p.kill(); } catch (_) { /* ignore */ } reject(new Error('انتهت المهلة (3 دقائق).')); }, 180000);
      p.stdout.on('data', (d) => { so += d; }); p.stderr.on('data', (d) => { se += d; });
      p.on('error', (e) => { clearTimeout(t); reject(e); });
      p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(so) : reject(new Error('Claude أرجع خطأ: ' + (se || so).slice(0, 300))); });
      p.stdin.end(prompt, 'utf8');
    });
    let text = out;
    try { const j = JSON.parse(out); text = j.result || j.text || out; } catch (_) { /* plain text */ }
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('لم أستطع قراءة رد Claude.');
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed.steps) || parsed.steps.length !== draft.steps.length) throw new Error('عدد الخطوات في رد Claude (' + (parsed.steps || []).length + ') لا يطابق المسجّل (' + draft.steps.length + '). أعد المحاولة.');
    return parsed;
  }
}

module.exports = { Trainer };
