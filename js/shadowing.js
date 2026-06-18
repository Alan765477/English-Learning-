// Shadowing trainer: play the standard audio, the learner repeats it, and we
// score pronunciation. On iOS the microphone can only feed one consumer at a
// time, so we never run recording and recognition together — we pick one:
//   1. Azure pronunciation assessment (if configured) — professional score
//   2. Browser speech recognition — free word-match score
//   3. Plain recording for replay — only when no recognition is available
const Shadowing = {
  lessonIdx: 0,
  i: 0,
  active: false,
  mode: null,        // 'azure' | 'recog' | 'record'
  recog: null,
  heard: '',
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
    // Tap to start, tap again to stop (toggle).
    recBtn.onclick = () => { this.active ? this.stopRecord() : this.startRecord(); };

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
    document.getElementById('shadow-record').textContent = '🎤 开始跟读';
    document.getElementById('shadow-status').textContent = '点「开始跟读」朗读，再点一下结束看评分';
  },

  move(d) {
    const n = LESSONS[this.lessonIdx].sentences.length;
    this.i = (this.i + d + n) % n;
    this.lastUrl = null;
    this.render();
    Speech.speak(this.cur().en, 0.95);
  },

  status(msg) { document.getElementById('shadow-status').textContent = msg; },
  setBtn(text) { document.getElementById('shadow-record').textContent = text; },
  endActive() {
    this.active = false;
    const btn = document.getElementById('shadow-record');
    btn.classList.remove('recording');
    btn.textContent = '🎤 开始跟读';
  },

  startRecord() {
    if (this.active) return;
    this.active = true;
    this.heard = '';
    document.getElementById('shadow-record').classList.add('recording');
    this.setBtn('⏹ 结束跟读');
    document.getElementById('shadow-score').classList.add('hidden');

    if (window.Azure && Azure.assessConfigured()) {
      this.mode = 'azure';
      this.status('Azure 评分中… 请朗读这句');
      Azure.assess(this.cur().en)
        .then(r => { this.endActive(); this.showAzureScore(r); })
        .catch(() => { this.endActive(); this.status('Azure 评分失败，请重试或检查 Key。'); });
      return;
    }
    if (Speech.recognitionSupported()) {
      this.mode = 'recog';
      this.startRecognition();
      this.status('🎤 听你跟读中… 说完再点一下结束');
      return;
    }
    // No recognition available: record audio so the learner can at least
    // replay and compare.
    this.mode = 'record';
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
      if (this.mode !== 'recog') return;
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
    if (this.mode === 'recog') {
      this.status('识别中…');
      if (this.recog) { try { this.recog.stop(); } catch {} }  // onend will score
    } else if (this.mode === 'record') {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
      this.recorder = null;
      this.endActive();
      this.status('已录音，点「回放」对比你的发音');
    }
    // azure mode auto-stops on silence; nothing to do on release.
  },

  showScore(heard) {
    const { score, words } = scorePronunciation(this.cur().en, heard);
    this.status('你说的：' + heard);
    const box = document.getElementById('shadow-score');
    box.classList.remove('hidden');
    document.getElementById('shadow-score-num').textContent = score + '%';
    document.getElementById('shadow-score-num').style.color =
      score >= 80 ? 'var(--good)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
    document.getElementById('shadow-heard').innerHTML =
      words.map(o => `<span class="${o.ok ? 'hit' : 'miss'}">${o.w}</span>`).join(' ');
  },

  showAzureScore(r) {
    this.status('');
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
