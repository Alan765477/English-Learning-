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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

      // Run recognition in parallel for scoring (best-effort).
      this._recognizing = Speech.recognitionSupported();
      if (this._recognizing) {
        Speech.recognizeOnce()
          .then(heard => this.showScore(heard))
          .catch(() => { /* ignore – recording still works */ });
      }
    } catch (err) {
      status.textContent = '无法访问麦克风，请检查权限。';
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

  replay() {
    if (!this.lastUrl) return;
    new Audio(this.lastUrl).play();
  },
};
