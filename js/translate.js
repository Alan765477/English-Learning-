// Real-time interpreter: listen to English speech, transcribe it live, and
// translate each finished sentence to Chinese. Modes control whether the
// Chinese is shown as subtitles and/or read aloud.
//
// Note: continuous speech recognition support varies by browser (best on
// Chrome; iOS Safari is limited). The app auto-restarts recognition to keep
// it going through pauses.
const Interpreter = {
  rec: null,
  active: false,
  mode: 'subtitle', // 'subtitle' | 'voice' | 'both'

  init() {
    document.querySelectorAll('#interp-modes .chip').forEach(btn => {
      btn.onclick = () => {
        this.mode = btn.dataset.mode;
        document.querySelectorAll('#interp-modes .chip').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
      };
    });
    document.getElementById('interp-toggle').onclick = () => this.toggle();
    document.getElementById('interp-clear').onclick = () => {
      document.getElementById('interp-list').innerHTML = '';
    };
  },

  toggle() { this.active ? this.stop() : this.start(); },

  start() {
    if (!Speech.recognitionSupported()) {
      this.status('此浏览器不支持语音识别，建议用 Chrome；iOS 上支持有限。');
      return;
    }
    if (!AI.configured()) {
      this.status('请先在「设置」填好 AI 的 API Key（翻译用它完成）。');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'en-US';
    // Per-utterance mode: recognition ends on each pause, we translate that
    // chunk immediately, then auto-restart. Far more real-time than continuous
    // mode, which batches many sentences before finalizing (esp. iOS Safari).
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => this.onResult(e);
    rec.onerror = () => {};
    rec.onend = () => {
      if (this._idle) { clearTimeout(this._idle); this._idle = null; }
      // Commit whatever was heard but never finalized (iOS sometimes ends
      // without a final result).
      if (this._pending) { this.addLine(this._pending); this._pending = ''; }
      if (this.active) { try { rec.start(); } catch {} }
    };
    this.rec = rec;
    this._pending = '';
    this.active = true;
    try { rec.start(); } catch {}
    document.getElementById('interp-toggle').textContent = '⏹ 停止';
    document.getElementById('interp-toggle').classList.add('recording');
    this.status('正在听… 对着手机说英语');
  },

  stop() {
    this.active = false;
    if (this._idle) { clearTimeout(this._idle); this._idle = null; }
    this._pending = '';
    if (this.rec) { try { this.rec.stop(); } catch {} this.rec = null; }
    document.getElementById('interp-toggle').textContent = '🎤 开始';
    document.getElementById('interp-toggle').classList.remove('recording');
    document.getElementById('interp-interim').textContent = '';
    this.status('');
  },

  onResult(e) {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        const text = r[0].transcript.trim();
        if (text) { this.addLine(text); this._pending = ''; }
      } else {
        interim += r[0].transcript;
      }
    }
    document.getElementById('interp-interim').textContent = interim;
    this._pending = interim.trim();
    // If the speaker pauses ~1.4s without a final result, commit the interim
    // text now instead of waiting (keeps translation flowing in real time).
    if (this._idle) clearTimeout(this._idle);
    if (this._pending) {
      this._idle = setTimeout(() => {
        if (this.rec) { try { this.rec.stop(); } catch {} } // triggers onend → commit + restart
      }, 1400);
    }
  },

  async addLine(en) {
    const list = document.getElementById('interp-list');
    const row = document.createElement('div');
    row.className = 'interp-row';
    const showZh = this.mode !== 'voice-only';
    row.innerHTML = `<div class="interp-en">${en}</div><div class="interp-zh">翻译中…</div>`;
    list.insertBefore(row, list.firstChild);
    try {
      const zh = await AI.translate(en);
      row.querySelector('.interp-zh').textContent = zh;
      if (this.mode === 'voice' || this.mode === 'both') {
        // Read the Chinese translation aloud using the browser voice.
        this.speakZh(zh);
      }
    } catch (err) {
      row.querySelector('.interp-zh').textContent = '（翻译失败，检查 Key/网络）';
    }
  },

  speakZh(text) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    const zh = speechSynthesis.getVoices().find(v => /zh/i.test(v.lang));
    if (zh) u.voice = zh;
    speechSynthesis.speak(u);
  },

  status(msg) { document.getElementById('interp-status').textContent = msg; },
};
