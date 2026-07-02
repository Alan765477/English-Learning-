// Practice: one screen, three modes (精听 listen / 跟读 shadow / 听写 dict).
// All three share the same lesson + sentence position, so switching modes keeps
// your place. Interaction is deliberately minimal (Apple-HIG style):
//   - tap the card to reveal subtitles step by step: blind → EN → EN+IPA+ZH
//   - swipe the card left/right to change sentence
//   - one speed pill cycles 0.75x / 1.0x / 1.25x
//   - one primary action button per mode
const Practice = {
  mode: 'listen',      // 'listen' | 'shadow' | 'dict'
  lessonIdx: 0,
  i: 0,
  playing: false,

  // recording state (shadow mode)
  active: false,
  recMode: null,       // 'azure' | 'recog' | 'record'
  recog: null,
  heard: '',
  recorder: null,
  chunks: [],
  lastUrl: null,

  RATES: [0.75, 1, 1.25],

  // ---- Small local stores: per-lesson position, weak (low-score) sentences ----
  _pos() { try { return JSON.parse(localStorage.getItem('els_pos') || '{}'); } catch { return {}; } },
  _savePos() {
    try {
      const p = this._pos();
      p[this.lesson().id] = this.i;
      p.__last = this.lesson().id;
      localStorage.setItem('els_pos', JSON.stringify(p));
    } catch {}
  },
  weakList() { try { return JSON.parse(localStorage.getItem('els_weak') || '[]'); } catch { return []; } },
  _saveWeak(l) { try { localStorage.setItem('els_weak', JSON.stringify(l)); } catch {} },

  // Low-score sentences feed a virtual 复习 lesson; scoring ≥80 clears them.
  trackScore(score) {
    const les = this.lesson(), s = this.cur();
    const k = les.id === '__weak' ? s.k : les.id + ':' + this.i;
    if (!k) return;
    let weak = this.weakList().filter(x => x.k !== k);
    if (score < 70 && les.id !== '__numbers') {
      weak.unshift({ k, en: s.en, ipa: s.ipa || '', zh: s.zh || '', score });
      this.status(this.statusText() + '　已加入「需加强」复练列表');
    }
    this._saveWeak(weak.slice(0, 50));
    this.buildLessonSheet();
  },
  statusText() { return document.getElementById('practice-status').textContent; },

  // ---- Number dictation generator (随机数字/电话/金额/确认码) ----
  genNumbers() {
    const D = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const NATO = { A: 'Apple', B: 'Boy', C: 'Cat', D: 'Dog', E: 'Elephant', F: 'Frank', G: 'George', H: 'Henry', J: 'John', K: 'King', L: 'Lion', M: 'Mary', N: 'Nancy', P: 'Peter', R: 'Robert', S: 'Sam', T: 'Tom', V: 'Victor', W: 'William', X: 'X-ray', Y: 'Yellow', Z: 'Zebra' };
    const ri = (n) => Math.floor(Math.random() * n);
    const digits = (n, oh) => Array.from({ length: n }, () => { const d = ri(10); return (oh && d === 0) ? 'oh' : D[d]; });
    const digitsRaw = (words) => words.map(w => w === 'oh' ? '0' : D.indexOf(w)).join('');
    const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const two = (n) => n < 10 ? D[n] : n < 20 ? TEENS[n - 10] : TENS[(n / 10) | 0] + (n % 10 ? '-' + D[n % 10] : '');
    const out = [];
    for (let r = 0; r < 4; r++) {
      { // phone number, 3-3-4
        const a = digits(3), b = digits(3), c = digits(4, true);
        out.push({ en: `My phone number is ${a.join(' ')}, ${b.join(' ')}, ${c.join(' ')}.`,
          alt: `${digitsRaw(a)}-${digitsRaw(b)}-${digitsRaw(c)}`, ipa: '', zh: '听写这个电话号码（格式 xxx-xxx-xxxx）' });
      }
      { // price
        const d = 5 + ri(90), c = ri(100);
        out.push({ en: `That'll be ${two(d)} ${c ? two(c) : ''}${c ? '' : 'dollars'}, please.`.replace('  ', ' '),
          alt: '$' + d + '.' + String(c).padStart(2, '0'), ipa: '', zh: '听写这个金额（格式 $xx.xx）' });
      }
      { // confirmation code: L d d L d
        const Ls = Object.keys(NATO);
        const l1 = Ls[ri(Ls.length)], l2 = Ls[ri(Ls.length)];
        const d1 = ri(10), d2 = ri(10), d3 = ri(10);
        out.push({ en: `Your confirmation number is ${l1} as in ${NATO[l1]}, ${D[d1]}, ${D[d2]}, ${l2} as in ${NATO[l2]}, ${D[d3]}.`,
          alt: `${l1}${d1}${d2}${l2}${d3}`, ipa: '', zh: '听写这个确认码（字母+数字）' });
      }
    }
    return out;
  },

  // Built-in lessons + user-imported custom lessons + virtual lessons
  // (需加强复练、数字听写生成器).
  lessons() {
    const base = LESSONS.concat(window.Importer ? Importer.list() : []);
    if (!this._numCache) this._numCache = this.genNumbers();
    base.push({ id: '__numbers', title: '生成 · 数字听写训练', level: '随机生成', gen: true, sentences: this._numCache });
    const weak = this.weakList();
    if (weak.length) base.push({ id: '__weak', title: '需加强 · 低分句复练', level: '复习', sentences: weak });
    return base;
  },
  lesson() {
    const all = this.lessons();
    if (this.lessonIdx >= all.length) this.lessonIdx = 0;
    return all[this.lessonIdx];
  },
  cur() { return this.lesson().sentences[this.i]; },

  init() {
    // Mode segmented control.
    document.querySelectorAll('#practice-seg .seg-btn').forEach(btn => {
      btn.onclick = () => this.setMode(btn.dataset.mode);
    });

    // Lesson picker (bottom sheet).
    this.buildLessonSheet();
    document.getElementById('practice-lesson').onclick = () => window.Sheet && Sheet.open('sheet-lesson');

    // Speed pill: cycle through preset rates.
    const rateBtn = document.getElementById('practice-rate');
    if (!this.RATES.includes(Store.get('listenRate'))) Store.set('listenRate', 1);
    rateBtn.textContent = this.rateLabel();
    rateBtn.onclick = (e) => {
      e.stopPropagation();
      const idx = (this.RATES.indexOf(Store.get('listenRate')) + 1) % this.RATES.length;
      Store.set('listenRate', this.RATES[idx]);
      rateBtn.textContent = this.rateLabel();
    };

    // Card: tap to reveal, swipe to change sentence.
    const card = document.getElementById('practice-card');
    card.onclick = (e) => {
      if (this.mode === 'dict') return;              // dictation must stay blind
      if (e.target.closest('.word,#practice-rate')) return;
      this.cycleReveal();
    };
    let sx = null, sy = null;
    card.addEventListener('touchstart', (e) => {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    card.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      sx = null;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) this.move(dx < 0 ? 1 : -1);
    }, { passive: true });

    // Listen bar.
    document.getElementById('listen-play').onclick = () => this.play();
    document.getElementById('listen-prev').onclick = () => this.move(-1);
    document.getElementById('listen-next').onclick = () => this.move(1);

    // Shadow bar.
    document.getElementById('shadow-listen').onclick = () => this.play();
    document.getElementById('shadow-replay').onclick = () => this.replay();
    document.getElementById('shadow-record').onclick = () => {
      this.active ? this.stopRecord() : this.startRecord();
    };

    // Dictation bar + input.
    document.getElementById('dict-play').onclick = () => this.play();
    document.getElementById('dict-check').onclick = () => this.checkDictation();
    document.getElementById('dict-next').onclick = () => this.move(1);

    // In-card mini orb: speaks when audio plays, listens while you record.
    if (window.Orb) {
      Orb.mount(document.getElementById('practice-orb'), {
        state: () => this.orbState(),
        level: () => this.orbLevel(),
      });
    }

    // Resume where you left off: last lesson + last sentence.
    const pos = this._pos();
    if (pos.__last) {
      const idx = this.lessons().findIndex(l => l.id === pos.__last);
      if (idx >= 0) this.lessonIdx = idx;
    }
    this.i = Math.min(pos[this.lesson().id] || 0, this.lesson().sentences.length - 1);
    this.buildLessonSheet();
    this.render();
  },

  rateLabel() {
    const r = Store.get('listenRate');
    return (r === 1 ? '1.0' : String(r)) + 'x';
  },

  // ---- Mode switching ----
  setMode(mode) {
    if (this.active) this.stopRecord();
    Speech.stop();
    this.playing = false;
    this.mode = mode;
    document.querySelectorAll('#practice-seg .seg-btn').forEach(b =>
      b.classList.toggle('on', b.dataset.mode === mode));
    document.getElementById('bar-listen').classList.toggle('hidden', mode !== 'listen');
    document.getElementById('bar-shadow').classList.toggle('hidden', mode !== 'shadow');
    document.getElementById('bar-dict').classList.toggle('hidden', mode !== 'dict');
    document.getElementById('dict-row').classList.toggle('hidden', mode !== 'dict');
    this.render();
  },

  // ---- Progressive reveal: 0 blind → 1 EN → 2 EN+IPA+ZH ----
  cycleReveal() {
    Store.set('reveal', ((Store.get('reveal') || 0) + 1) % 3);
    this.render();
  },

  render() {
    const s = this.cur();
    const reveal = Store.get('reveal') || 0;
    const dict = this.mode === 'dict';

    document.getElementById('practice-lesson-title').textContent = this.lesson().title;
    document.getElementById('practice-progress').textContent =
      `${this.i + 1} / ${this.lesson().sentences.length}`;

    const enEl = document.getElementById('practice-en');
    const ipaEl = document.getElementById('practice-ipa');
    const zhEl = document.getElementById('practice-zh');
    const hint = document.getElementById('practice-hint');

    if (dict) {
      enEl.classList.add('hidden'); ipaEl.classList.add('hidden'); zhEl.classList.add('hidden');
      hint.classList.add('hidden');
    } else {
      enEl.classList.remove('hidden');
      if (reveal >= 1) {
        enEl.innerHTML = this.wordify(s.en);
        enEl.classList.remove('blind');
        this.bindWords(enEl);
      } else {
        enEl.textContent = '••• ••• •••';
        enEl.classList.add('blind');
      }
      ipaEl.textContent = s.ipa || '';
      ipaEl.classList.toggle('hidden', reveal < 2);
      zhEl.textContent = s.zh;
      zhEl.classList.toggle('hidden', reveal < 2);
      hint.classList.toggle('hidden', reveal >= 2);
      hint.textContent = reveal === 0 ? '点卡片显示英文 · 左右滑动换句' : '再点一下显示音标和中文';
    }

    // Dictation result area.
    const res = document.getElementById('practice-dict-result');
    res.classList.toggle('hidden', !dict);
    if (dict) res.innerHTML = '<span class="dim">听一遍，把句子打在下面，再点 ✓ 对照</span>';
    if (dict) document.getElementById('dict-input').value = '';

    // Reset transient bits.
    document.getElementById('practice-score').classList.add('hidden');
    document.getElementById('shadow-replay').disabled = !this.lastUrl;
    this.status('');
  },

  wordify(text) {
    return text.split(/(\s+)/).map(tok =>
      /\S/.test(tok) ? `<span class="word">${tok}</span>` : tok
    ).join('');
  },
  bindWords(el) {
    el.querySelectorAll('.word').forEach(w => {
      w.onclick = () => {
        const word = w.textContent.replace(/[^A-Za-z'-]/g, '');
        if (!word) return;
        Speech.speak(word, 0.9);
        this.offerAddWord(word);
      };
    });
  },

  // Tapping a word speaks it and offers a one-tap add to the vocab book.
  offerAddWord(word) {
    const s = document.getElementById('practice-status');
    s.innerHTML = `<button class="add-word" id="add-word">＋ 把 “${word}” 加入生词本</button>`;
    document.getElementById('add-word').onclick = () => {
      if (window.Vocab) Vocab.addWithGloss(word);
      s.textContent = `✓ 已加入生词本：${word}`;
      setTimeout(() => { if (s.textContent.includes(word)) s.textContent = ''; }, 2200);
    };
    clearTimeout(this._wordT);
    this._wordT = setTimeout(() => { if (document.getElementById('add-word')) s.textContent = ''; }, 6000);
  },

  status(msg) { document.getElementById('practice-status').textContent = msg || ''; },

  // ---- Playback ----
  play() {
    Speech.stop();
    this.playing = true;
    this.syncOrb();
    const p = Promise.resolve(Speech.speak(this.cur().en, Store.get('listenRate')));
    p.finally(() => { this.playing = false; this.syncOrb(); });
    return p;
  },

  move(d) {
    if (this.active) this.stopRecord();
    const n = this.lesson().sentences.length;
    this.i = (this.i + d + n) % n;
    this.lastUrl = null;
    if (window.haptic) haptic(6);
    this._savePos();
    this.render();
    this.play();
  },

  // ---- Orb state (shared visual language with the AI screen) ----
  orbState() {
    if (this.active) return 'listening';
    if (this.playing) return 'speaking';
    return 'idle';
  },
  orbLevel() {
    if (this.active) {
      if (window.MicLevel && MicLevel.active) return MicLevel.level();
      return 0.2 + 0.18 * Math.abs(Math.sin(performance.now() / 300));
    }
    if (this.playing) {
      const lv = (window.Azure && Azure.levels) ? Azure.levels(6) : null;
      if (lv) { let s = 0; for (const v of lv) s += v; const a = s / lv.length; if (a > 0.02) return Math.min(1, a * 1.9); }
      return 0.3 + 0.3 * Math.abs(Math.sin(performance.now() / 170));
    }
    return 0;
  },
  syncOrb() {
    document.getElementById('practice-orb').classList.toggle(
      'show', this.active || this.playing);
  },

  // ---- Shadow recording (Azure assessment > browser recognition > plain record) ----
  startRecord() {
    if (this.active) return;
    this.active = true;
    this.heard = '';
    if (window.haptic) haptic(12);
    document.getElementById('shadow-record').classList.add('recording');
    document.getElementById('practice-score').classList.add('hidden');
    this.syncOrb();

    if (window.Azure && Azure.assessConfigured()) {
      this.recMode = 'azure';
      this.azureAborted = false;
      this.status('朗读中… 说完自动评分，或再点一下结束');
      Azure.assess(this.cur().en)
        .then(r => { this.endActive(); this.showAzureScore(r); })
        .catch(() => {
          this.endActive();
          this.status(this.azureAborted ? '已结束（如需评分请重读一次）' : 'Azure 评分失败，请重试或检查 Key。');
        });
      return;
    }
    if (Speech.recognitionSupported()) {
      this.recMode = 'recog';
      if (window.MicLevel) MicLevel.start(); // non-iOS: real level for the orb
      this.startRecognition();
      this.status('听你跟读中… 说完再点一下结束');
      return;
    }
    this.recMode = 'record';
    this.startRecording();
  },

  startRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript + ' ';
      this.heard = t.trim();
    };
    rec.onerror = () => {};
    rec.onend = () => {
      if (this.recMode !== 'recog') return;
      this.endActive();
      if (this.heard) this.showScore(this.heard);
      else this.status('没听清，再试一次：靠近手机、把整句说完。');
    };
    this.recog = rec;
    try { rec.start(); } catch { this.endActive(); this.status('识别启动失败，请重试。'); }
  },

  async startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.endActive();
      this.status('此环境不支持录音，请用 Safari 打开。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (window.MicLevel) MicLevel.attach(stream); // same stream → iOS-safe orb level
      this.chunks = [];
      this.recorder = new MediaRecorder(stream);
      this.recorder.ondataavailable = (e) => this.chunks.push(e.data);
      this.recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (this.lastUrl) URL.revokeObjectURL(this.lastUrl);
        this.lastUrl = URL.createObjectURL(new Blob(this.chunks, { type: 'audio/webm' }));
        document.getElementById('shadow-replay').disabled = false;
      };
      this.recorder.start();
      this.syncOrb();
      this.status('录音中… 说完再点一下结束（此设备无自动打分，可回放对比）');
    } catch (err) {
      this.endActive();
      const name = err && err.name;
      this.status(
        name === 'NotAllowedError' ? '麦克风权限被拒：设置→Safari→麦克风 改为「允许」。'
        : '无法访问麦克风，请用 Safari 打开并允许权限。');
    }
  },

  stopRecord() {
    if (!this.active) return;
    if (window.haptic) haptic(8);
    if (this.recMode === 'recog') {
      this.status('识别中…');
      if (this.recog) { try { this.recog.stop(); } catch {} }  // onend will score
    } else if (this.recMode === 'record') {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
      this.recorder = null;
      this.endActive();
      this.status('已录音，点 ↻ 回放对比你的发音');
    } else if (this.recMode === 'azure') {
      this.azureAborted = true;
      if (window.Azure) Azure.stopAssess();
    }
  },

  endActive() {
    this.active = false;
    if (window.MicLevel) MicLevel.stop();
    document.getElementById('shadow-record').classList.remove('recording');
    this.syncOrb();
  },

  showScore(heard) {
    const { score, words } = scorePronunciation(this.cur().en, heard);
    this.status('你说的：' + heard);
    this.trackScore(score);
    const box = document.getElementById('practice-score');
    box.classList.remove('hidden');
    const num = document.getElementById('practice-score-num');
    num.textContent = score + '%';
    num.style.color = score >= 80 ? 'var(--good)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
    document.getElementById('practice-score-detail').innerHTML =
      words.map(o => `<span class="${o.ok ? 'hit' : 'miss'}">${o.w}</span>`).join(' ');
  },

  showAzureScore(r) {
    this.status('');
    this.trackScore(r.pron);
    const box = document.getElementById('practice-score');
    box.classList.remove('hidden');
    const num = document.getElementById('practice-score-num');
    num.textContent = r.pron + '分';
    num.style.color = r.pron >= 80 ? 'var(--good)' : r.pron >= 60 ? 'var(--warn)' : 'var(--bad)';
    const wordHtml = r.words.map(w => {
      const cls = (w.error && w.error !== 'None') ? 'miss' : 'hit';
      return `<span class="${cls}">${w.word}</span>`;
    }).join(' ');
    document.getElementById('practice-score-detail').innerHTML =
      `准确度 ${r.accuracy} · 流利度 ${r.fluency} · 完整度 ${r.completeness}<br>${wordHtml}`;
  },

  replay() {
    if (!this.lastUrl) return;
    new Audio(this.lastUrl).play();
  },

  // ---- Dictation ----
  checkDictation() {
    const s = this.cur();
    const typed = document.getElementById('dict-input').value;
    const res = document.getElementById('practice-dict-result');
    if (s.alt) {
      // Number/code drills: compare the digits, not the words.
      const norm = (x) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const ok = norm(typed) === norm(s.alt);
      res.innerHTML = `<div class="dict-summary">${ok ? '✅ 全对！' : '还差一点，再听一遍'}</div>答案：<b>${s.alt}</b>`;
      return;
    }
    res.innerHTML = this.diff(s.en, typed);
  },

  diff(target, typed) {
    const clean = (s) => s.toLowerCase().replace(/[^a-z0-9'\s]/g, '');
    const typedWords = new Set(clean(typed).split(/\s+/).filter(Boolean));
    const targetTokens = target.split(/(\s+)/);
    let correct = 0, total = 0;
    const html = targetTokens.map(tok => {
      if (!/\S/.test(tok)) return tok;
      total++;
      const key = clean(tok);
      const ok = typedWords.has(key);
      if (ok) correct++;
      return `<span class="${ok ? 'ok' : 'wrong'}">${tok}</span>`;
    }).join('');
    const pct = total ? Math.round((correct / total) * 100) : 0;
    return `<div class="dict-summary">正确 ${correct}/${total}（${pct}%）</div>${html}`;
  },

  // ---- Lesson sheet (built-ins + custom, with delete for custom) ----
  buildLessonSheet() {
    const el = document.getElementById('lesson-list');
    const all = this.lessons();
    if (this.lessonIdx >= all.length) this.lessonIdx = 0;
    el.innerHTML = all.map((l, idx) => `
      <button class="sheet-row" data-idx="${idx}">
        <span class="sheet-row-main">${l.title}<span class="sheet-row-sub">${l.level} · ${l.sentences.length} 句</span></span>
        <span class="sheet-row-side">
          ${l.custom ? `<span class="lesson-del" data-id="${l.id}">删除</span>` : ''}
          <span class="sheet-check ${idx === this.lessonIdx ? '' : 'hidden'}">✓</span>
        </span>
      </button>`).join('');
    el.querySelectorAll('.sheet-row').forEach(row => {
      row.onclick = (e) => {
        const del = e.target.closest('.lesson-del');
        if (del) {
          e.stopPropagation();
          this.deleteCustom(del.dataset.id);
          return;
        }
        this.openLesson(+row.dataset.idx);
        if (window.Sheet) Sheet.close();
      };
    });
  },

  openLesson(idx) {
    this.lessonIdx = idx;
    const les = this.lesson();
    if (les.gen) { this._numCache = this.genNumbers(); les.sentences = this._numCache; } // fresh drill each visit
    this.i = les.gen ? 0 : Math.min(this._pos()[les.id] || 0, les.sentences.length - 1);
    this.lastUrl = null;
    this._savePos();
    this.buildLessonSheet();
    this.render();
  },

  selectLesson(id) {
    const idx = this.lessons().findIndex(l => l.id === id);
    if (idx >= 0) this.openLesson(idx);
  },

  deleteCustom(id) {
    if (!window.Importer) return;
    if (!confirm('删除这套自定义课程？')) return;
    const cur = this.lesson();
    Importer.remove(id);
    if (cur && cur.id === id) { this.lessonIdx = 0; this.i = 0; this.render(); }
    else if (cur) { this.lessonIdx = Math.max(0, this.lessons().findIndex(l => l.id === cur.id)); }
    this.buildLessonSheet();
  },
};

// Top-level `const` in classic scripts does not become a window property;
// attach explicitly so cross-module `window.Practice` checks work.
window.Practice = Practice;
