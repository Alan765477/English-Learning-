// Shadowing trainer: play the standard audio, let the user repeat it,
// record their voice, and score pronunciation via speech recognition.
const Shadowing = {
  lessonIdx: 0,
  i: 0,
  recorder: null,
  chunks: [],
  lastUrl: null,

  init() {
    const sel = document.getElementById('shadow-lesson');
    sel.innerHTML = LESSONS.map((l, idx) => `<option value="${idx}">${l.title}（${l.level}）</option>`).join('');
    sel.onchange = () => { this.lessonIdx = +sel.value; this.i = 0; this.render(); };

    document.getElementById('shadow-listen').onclick = () => Speech.speak(this.cur().en, 0.95);
    document.getElementById('shadow-prev').onclick = () => this.move(-1);
    document.getElementById('shadow-next').onclick = () => this.move(1);
    document.getElementById('shadow-replay').onclick = () => this.replay();

    const recBtn = document.getElementById('shadow-record');
    // Press-and-hold to record (works for mouse and touch).
    const start = (e) => { e.preventDefault(); this.startRecord(); };
    const stop = (e) => { e.preventDefault(); this.stopRecord(); };
    recBtn.addEventListener('mousedown', start);
    recBtn.addEventListener('touchstart', start, { passive: false });
    recBtn.addEventListener('mouseup', stop);
    recBtn.addEventListener('touchend', stop, { passive: false });
    recBtn.addEventListener('mouseleave', () => { if (this.recorder) this.stopRecord(); });

    this.render();
  },

  cur() { return LESSONS[this.lessonIdx].sentences[this.i]; },

  render() {
    const lesson = LESSONS[this.lessonIdx];
    const s = this.cur();
    document.getElementById('shadow-progress').textContent = `${this.i + 1} / ${lesson.sentences.length}`;
    document.getElementById('shadow-en').textContent = s.en;
    document.getElementById('shadow-ipa').textContent = s.ipa;
    document.getElementById('shadow-score').classList.add('hidden');
    document.getElementById('shadow-replay').disabled = !this.lastUrl;
  },

  move(d) {
    const n = LESSONS[this.lessonIdx].sentences.length;
    this.i = (this.i + d + n) % n;
    this.lastUrl = null;
    this.render();
    Speech.speak(this.cur().en, 0.95);
  },

  async startRecord() {
    const status = document.getElementById('shadow-status');
    // Guard against double-trigger from touch + emulated mouse events.
    if (this.recorder || this._starting) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status.textContent = '此环境不支持录音。请用 Safari 浏览器打开（桌面图标的 PWA 模式可能受限）。';
      return;
    }
    this._starting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._starting = false;
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
      document.getElementById('shadow-record').classList.add('recording');
      status.textContent = '录音中… 松开结束';

      // Score the attempt. Prefer Azure's professional assessment; otherwise
      // fall back to the free browser recognition (word-match score).
      if (window.Azure && Azure.assessConfigured()) {
        this._recognizing = true;
        Azure.assess(this.cur().en)
          .then(r => this.showAzureScore(r))
          .catch(() => { document.getElementById('shadow-status').textContent = 'Azure 评分失败，回放对比即可。'; });
      } else if (Speech.recognitionSupported()) {
        this._recognizing = true;
        Speech.recognizeOnce()
          .then(heard => this.showScore(heard))
          .catch(() => { /* ignore – recording still works */ });
      } else {
        this._recognizing = false;
      }
    } catch (err) {
      this._starting = false;
      const name = err && err.name;
      status.textContent =
        name === 'NotAllowedError' ? '麦克风权限被拒：设置→Safari→麦克风 改为「允许」，或点开网页时选「允许」。'
        : name === 'NotFoundError' ? '没找到麦克风设备。'
        : '无法访问麦克风：请改用 Safari 浏览器打开（桌面图标 PWA 模式可能不支持录音）。';
    }
  },

  stopRecord() {
    if (!this.recorder) return;
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
    document.getElementById('shadow-record').classList.remove('recording');
    Speech.stopRecognition();
    const status = document.getElementById('shadow-status');
    status.textContent = this._recognizing ? '识别中…' : '回放对比你的发音（此设备不支持自动打分）';
  },

  showScore(heard) {
    const { score, words } = scorePronunciation(this.cur().en, heard);
    document.getElementById('shadow-status').textContent = '';
    const box = document.getElementById('shadow-score');
    box.classList.remove('hidden');
    document.getElementById('shadow-score-num').textContent = score + '%';
    document.getElementById('shadow-score-num').style.color =
      score >= 80 ? 'var(--good)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
    document.getElementById('shadow-heard').innerHTML =
      words.map(o => `<span class="${o.ok ? 'hit' : 'miss'}">${o.w}</span>`).join(' ');
  },

  showAzureScore(r) {
    document.getElementById('shadow-status').textContent = '';
    const box = document.getElementById('shadow-score');
    box.classList.remove('hidden');
    const num = document.getElementById('shadow-score-num');
    num.textContent = r.pron + '分';
    num.style.color = r.pron >= 80 ? 'var(--good)' : r.pron >= 60 ? 'var(--warn)' : 'var(--bad)';
    const wordHtml = r.words.map(w => {
      const cls = (w.error && w.error !== 'None') ? 'miss' : 'hit';
      return `<span class="${cls}">${w.word}</span>`;
    }).join(' ');
    document.getElementById('shadow-heard').innerHTML =
      `准确度 ${r.accuracy} · 流利度 ${r.fluency} · 完整度 ${r.completeness}<br>${wordHtml}`;
  },

  replay() {
    if (!this.lastUrl) return;
    new Audio(this.lastUrl).play();
  },
};
