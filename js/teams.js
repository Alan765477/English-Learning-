// Teams meeting live translator — the content page of the Teams side-panel app
// (also works as a standalone page in any browser next to a meeting).
//
// Two audio sources:
//   'system' — capture the meeting audio itself via getDisplayMedia (share a
//              tab/window/screen WITH audio). Hears every remote speaker
//              clearly, headphones or not. Requires an Azure Speech key,
//              because only the Speech SDK accepts a custom MediaStream.
//   'mic'    — the microphone. With an Azure key it streams through the
//              TranslationRecognizer (partial translations appear while the
//              person is still talking); without one it falls back to the
//              browser SpeechRecognition + AI.translate pipeline, same as the
//              in-app interpreter.
//
// Subtitles only — nothing is read aloud, so it never talks over the meeting.
const TeamsInterp = {
  active: false,
  source: 'system',   // 'system' | 'mic'
  dir: 'auto',        // 'auto' (Azure continuous language ID) | 'en2zh' | 'zh2en'
  rec: null,          // Azure TranslationRecognizer OR browser SpeechRecognition
  engine: null,       // 'azure' | 'webspeech'
  stream: null,       // display-capture stream (system mode)
  fontIdx: 1,         // 0 small, 1 medium, 2 large
  FONTS: ['cap-s', 'cap-m', 'cap-l'],

  init() {
    // Teams SDK handshake — required inside Teams or the tab shows a spinner
    // forever. Outside Teams (plain browser) it throws; that's fine.
    if (window.microsoftTeams && microsoftTeams.app) {
      microsoftTeams.app.initialize().then(() => {
        try { microsoftTeams.app.notifyAppLoaded(); microsoftTeams.app.notifySuccess(); } catch {}
      }).catch(() => {});
    }

    this.dir = Store.get('teamsDir') || 'auto';
    document.querySelectorAll('#ti-dir .chip').forEach(btn => {
      if (btn.dataset.dir === this.dir) btn.classList.add('on');
      btn.onclick = () => {
        if (this.active) this.stop();
        this.dir = btn.dataset.dir;
        Store.setAll({ teamsDir: this.dir });
        document.querySelectorAll('#ti-dir .chip').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        this.hint();
      };
    });

    document.querySelectorAll('#ti-source .chip').forEach(btn => {
      btn.onclick = () => {
        if (this.active) this.stop();
        this.source = btn.dataset.source;
        document.querySelectorAll('#ti-source .chip').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        this.hint();
      };
    });
    // System-audio capture needs getDisplayMedia — absent on phones and in
    // some embedded webviews. Fall back to mic-only when unavailable.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      const sys = document.querySelector('#ti-source [data-source="system"]');
      if (sys) { sys.classList.add('hidden'); }
      this.source = 'mic';
      const mic = document.querySelector('#ti-source [data-source="mic"]');
      if (mic) { mic.classList.add('on'); }
    } else {
      const sys = document.querySelector('#ti-source [data-source="system"]');
      if (sys) sys.classList.add('on');
    }

    document.getElementById('ti-toggle').onclick = () => this.toggle();
    document.getElementById('ti-clear').onclick = () => {
      document.getElementById('ti-list').innerHTML = '';
    };
    document.getElementById('ti-font').onclick = () => {
      this.fontIdx = (this.fontIdx + 1) % this.FONTS.length;
      const list = document.getElementById('ti-list');
      list.classList.remove(...this.FONTS);
      list.classList.add(this.FONTS[this.fontIdx]);
    };
    document.getElementById('ti-list').classList.add(this.FONTS[this.fontIdx]);

    // Settings drawer.
    document.getElementById('ti-gear').onclick = () => this.openSettings();
    document.getElementById('ti-set-close').onclick = () => {
      document.getElementById('ti-settings').classList.add('hidden');
    };
    document.getElementById('ti-set-save').onclick = () => this.saveSettings();

    this.hint();
  },

  azureConfigured() { return !!(Store.get('azureKey') && Store.get('azureRegion')); },

  // Contextual guidance shown before starting.
  hint() {
    if (this.active) return;
    let msg;
    if (this.source === 'system') {
      msg = this.azureConfigured()
        ? '点开始后选「整个屏幕」或 Teams 所在标签页，并勾选「共享音频」'
        : '系统声音模式需要 Azure Speech Key（免费额度每月 5 小时）→ 点右上 ⚙️ 填写';
    } else {
      msg = this.azureConfigured()
        ? '麦克风模式：外放开会或现场会议时使用（戴耳机时收不到对方声音）'
        : (window.AI && AI.configured())
          ? '麦克风模式（浏览器识别）：外放开会或现场会议时使用'
          : '先点右上 ⚙️ 填写 Azure Key（推荐）或 AI Key';
    }
    if (this.dir === 'auto' && !this.azureConfigured()) {
      msg = '「双向自动」需要 Azure Key；没有的话请手动选「英→中」或「中→英」。' + msg;
    }
    this.status(msg);
  },

  toggle() { this.active ? this.stop() : this.start(); },

  async start() {
    try {
      if (this.source === 'system') {
        if (!this.azureConfigured()) { this.openSettings(); this.status('系统声音模式需要 Azure Speech Key'); return; }
        // Chrome only exposes tab/system audio alongside a video track;
        // we drop the video immediately and keep just the audio.
        const disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const tracks = disp.getAudioTracks();
        if (!tracks.length) {
          disp.getTracks().forEach(t => t.stop());
          this.status('没拿到声音——共享时要勾选左下角「共享标签页/系统音频」，再试一次');
          return;
        }
        disp.getVideoTracks().forEach(t => t.stop());
        this.stream = new MediaStream(tracks);
        // If the user hits the browser's own "stop sharing" bar, shut down too.
        tracks[0].onended = () => { if (this.active) this.stop(); };
        await this.startAzure(this.stream);
      } else if (this.azureConfigured()) {
        await this.startAzure(null);
      } else if (window.Speech && Speech.recognitionSupported() && window.AI && AI.configured()) {
        this.startWebSpeech();
      } else {
        this.openSettings();
        this.status('请先填写 Azure Key，或（仅麦克风模式）AI Key');
        return;
      }
    } catch (err) {
      this.cleanup();
      this.status('启动失败：' + (err && err.message ? err.message : '请重试'));
      return;
    }
    this.active = true;
    const btn = document.getElementById('ti-toggle');
    btn.textContent = '⏹ 停止';
    btn.classList.add('recording');
    this.status(this.source === 'system' ? '正在听会议声音…' : '正在听麦克风…');
  },

  // Azure streaming speech translation with partial results — the same
  // engine behind Teams' own live captions. Direction:
  //   'en2zh' / 'zh2en'  — fixed recognition language, one target.
  //   'auto'             — continuous language ID over en-US + zh-CN (needs
  //                        the v2 universal endpoint), both targets requested;
  //                        we pick which translation to show per sentence.
  async startAzure(stream) {
    await Azure.loadSDK();
    const SDK = window.SpeechSDK;
    const key = (Store.get('azureKey') || '').replace(/\s+/g, '');
    const region = (Store.get('azureRegion') || '').trim().toLowerCase();
    let cfg;
    if (this.dir === 'auto') {
      cfg = SDK.SpeechTranslationConfig.fromEndpoint(
        new URL('wss://' + region + '.stt.speech.microsoft.com/speech/universal/v2'), key);
      try { cfg.setProperty(SDK.PropertyId.SpeechServiceConnection_LanguageIdMode, 'Continuous'); } catch {}
      cfg.addTargetLanguage('zh-Hans');
      cfg.addTargetLanguage('en');
    } else {
      cfg = SDK.SpeechTranslationConfig.fromSubscription(key, region);
      if (this.dir === 'zh2en') {
        cfg.speechRecognitionLanguage = 'zh-CN';
        cfg.addTargetLanguage('en');
      } else {
        cfg.speechRecognitionLanguage = 'en-US';
        cfg.addTargetLanguage('zh-Hans');
      }
    }
    // Finalize a sentence ~0.6s after the speaker pauses (default ~2s lags).
    try { cfg.setProperty(SDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '600'); } catch {}
    const audio = stream
      ? SDK.AudioConfig.fromStreamInput(stream)
      : SDK.AudioConfig.fromDefaultMicrophoneInput();
    let rec;
    if (this.dir === 'auto') {
      const autoLang = SDK.AutoDetectSourceLanguageConfig.fromLanguages(['en-US', 'zh-CN']);
      rec = SDK.TranslationRecognizer.FromConfig(cfg, autoLang, audio);
    } else {
      rec = new SDK.TranslationRecognizer(cfg, audio);
    }
    this.engine = 'azure';
    this.rec = rec;
    // Which translation to show: a Chinese sentence gets its English
    // translation and vice versa. CJK presence in the recognized text tells
    // the source language apart more reliably than SDK metadata.
    const transOf = (r) => {
      try {
        const target = /[一-鿿]/.test(r.text || '') ? 'en' : 'zh-Hans';
        return r.translations.get(target) || '';
      } catch { return ''; }
    };
    rec.recognizing = (s, e) => {
      if (e.result && e.result.text) this.interim(e.result.text, transOf(e.result));
    };
    rec.recognized = (s, e) => {
      const r = e.result;
      if (r && r.reason === SDK.ResultReason.TranslatedSpeech && r.text.trim()) {
        this.interim('', '');
        this.addLine(r.text.trim(), transOf(r).trim());
      }
    };
    rec.canceled = (s, e) => {
      if (e.reason === SDK.CancellationReason.Error) {
        const detail = /401|Authentication/i.test(e.errorDetails || '') ? 'Key 或区域不对' : (e.errorDetails || '连接中断');
        this.stop();
        this.status('Azure 出错：' + detail);
      }
    };
    await new Promise((resolve, reject) =>
      rec.startContinuousRecognitionAsync(resolve, (err) => reject(new Error(err || 'start-failed'))));
  },

  // Free fallback (mic only): browser recognition per utterance, then a
  // one-shot AI translation — identical flow to the in-app interpreter.
  startWebSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    // Browser recognition can't auto-detect language, so 'auto' listens for
    // English here; the AI prompt still translates either direction.
    rec.lang = this.dir === 'zh2en' ? 'zh-CN' : 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          if (text) { this.addLineAI(text); this._pending = ''; }
        } else {
          interimText += r[0].transcript;
        }
      }
      this.interim(interimText, '');
      this._pending = interimText.trim();
      if (this._idle) clearTimeout(this._idle);
      if (this._pending) {
        this._idle = setTimeout(() => {
          if (this.rec) { try { this.rec.stop(); } catch {} }
        }, 1400);
      }
    };
    rec.onerror = () => {};
    rec.onend = () => {
      if (this._idle) { clearTimeout(this._idle); this._idle = null; }
      if (this._pending) { this.addLineAI(this._pending); this._pending = ''; }
      if (this.active) { try { rec.start(); } catch {} }
    };
    this.engine = 'webspeech';
    this.rec = rec;
    this._pending = '';
    rec.start();
  },

  stop() {
    this.active = false;
    this.cleanup();
    const btn = document.getElementById('ti-toggle');
    btn.textContent = '▶ 开始翻译';
    btn.classList.remove('recording');
    this.interim('', '');
    this.hint();
  },

  cleanup() {
    if (this._idle) { clearTimeout(this._idle); this._idle = null; }
    this._pending = '';
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      try {
        if (this.engine === 'azure') rec.stopContinuousRecognitionAsync(() => { try { rec.close(); } catch {} }, () => {});
        else rec.stop();
      } catch {}
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.engine = null;
  },

  // Live (unfinished) line pinned under the list.
  interim(en, zh) {
    document.getElementById('ti-interim-en').textContent = en;
    document.getElementById('ti-interim-zh').textContent = zh;
  },

  // Finalized sentence with its translation already available (Azure path).
  addLine(en, zh) {
    const list = document.getElementById('ti-list');
    const row = document.createElement('div');
    row.className = 'ti-row';
    row.innerHTML = '<div class="ti-zh"></div><div class="ti-en"></div>';
    row.querySelector('.ti-zh').textContent = zh || '…';
    row.querySelector('.ti-en').textContent = en;
    list.appendChild(row);
    this.trimAndScroll(list);
  },

  // Finalized sentence that still needs translating (web-speech path).
  async addLineAI(en) {
    const list = document.getElementById('ti-list');
    const row = document.createElement('div');
    row.className = 'ti-row';
    row.innerHTML = '<div class="ti-zh">翻译中…</div><div class="ti-en"></div>';
    row.querySelector('.ti-en').textContent = en;
    list.appendChild(row);
    this.trimAndScroll(list);
    try {
      const zh = await AI.translateAuto(en);
      row.querySelector('.ti-zh').textContent = zh;
    } catch {
      row.querySelector('.ti-zh').textContent = '（翻译失败，检查 Key/网络）';
    }
    this.trimAndScroll(list);
  },

  // Keep the DOM bounded during hour-long meetings and pin scroll to bottom.
  trimAndScroll(list) {
    while (list.children.length > 200) list.removeChild(list.firstChild);
    const wrap = document.getElementById('ti-scroll');
    wrap.scrollTop = wrap.scrollHeight;
  },

  openSettings() {
    document.getElementById('set-azure-key').value = Store.get('azureKey') || '';
    document.getElementById('set-azure-region').value = Store.get('azureRegion') || '';
    document.getElementById('set-provider').value = Store.get('provider') || 'claude';
    document.getElementById('set-api-key').value = Store.get('apiKey') || '';
    document.getElementById('ti-settings').classList.remove('hidden');
  },

  saveSettings() {
    Store.setAll({
      azureKey: document.getElementById('set-azure-key').value.trim(),
      azureRegion: document.getElementById('set-azure-region').value.trim(),
      provider: document.getElementById('set-provider').value,
      apiKey: document.getElementById('set-api-key').value.trim(),
    });
    document.getElementById('ti-settings').classList.add('hidden');
    this.hint();
  },

  status(msg) { document.getElementById('ti-status').textContent = msg; },
};

window.TeamsInterp = TeamsInterp;
document.addEventListener('DOMContentLoaded', () => TeamsInterp.init());
