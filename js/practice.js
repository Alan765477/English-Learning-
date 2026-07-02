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

  // Built-in lessons + user-imported custom lessons.
  lessons() { return LESSONS.concat(window.Importer ? Importer.list() : []); },
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
      w.onclick = () => Speech.speak(w.textContent.replace(/[^A-Za-z'-]/g, ''), 0.9);
    });
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
    const target = this.cur().en;
    const typed = document.getElementById('dict-input').value;
    document.getElementById('practice-dict-result').innerHTML = this.diff(target, typed);
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
        this.lessonIdx = +row.dataset.idx;
        this.i = 0;
        this.lastUrl = null;
        this.buildLessonSheet();
        this.render();
        if (window.Sheet) Sheet.close();
      };
    });
  },

  selectLesson(id) {
    const idx = this.lessons().findIndex(l => l.id === id);
    if (idx < 0) return;
    this.lessonIdx = idx;
    this.i = 0;
    this.lastUrl = null;
    this.buildLessonSheet();
    this.render();
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
