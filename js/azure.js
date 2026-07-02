// Azure Cognitive Services integration (optional, paid but with a generous
// free tier). Provides:
//   - Neural TTS via the lightweight REST endpoint (human-like voices)
//   - Pronunciation Assessment via the Speech SDK (loaded on demand)
// Everything degrades gracefully: if Azure isn't configured or a call fails,
// the app falls back to the free browser speech features.
// A tiny silent WAV used to "prime" the audio element inside a user gesture.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

const Azure = {
  cur: null,         // currently playing <audio> element
  _sdkPromise: null,
  _el: null,         // single reused <audio> element
  _ctx: null, _analyser: null, _freq: null, _assessRec: null,

  ttsConfigured() {
    return !!(Store.get('azureKey') && Store.get('azureRegion'));
  },

  _audioEl() {
    if (!this._el) {
      const a = new Audio();
      a.setAttribute('playsinline', '');
      a.crossOrigin = 'anonymous';
      this._el = a;
    }
    return this._el;
  },

  // Route the audio element through a Web Audio AnalyserNode so the on-screen
  // waveform can react to the real voice. (Note: routing through Web Audio means
  // playback follows the iOS mute switch — keep the ringer on to hear it.)
  _graph() {
    if (this._analyser !== null) return; // already attempted
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this._analyser = false; return; }
    try {
      this._ctx = this._ctx || new AC();
      const src = this._ctx.createMediaElementSource(this._audioEl());
      const an = this._ctx.createAnalyser();
      an.fftSize = 64;
      an.smoothingTimeConstant = 0.78;
      src.connect(an);
      an.connect(this._ctx.destination);
      this._analyser = an;
      this._freq = new Uint8Array(an.frequencyBinCount);
    } catch (e) { this._analyser = false; }
  },

  // Real-time bar levels (0..1) for the waveform, or null if unavailable.
  levels(n) {
    const an = this._analyser;
    if (!an || an === false) return null;
    an.getByteFrequencyData(this._freq);
    const usable = Math.floor(this._freq.length * 0.72);
    const out = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor((i / n) * usable);
      out.push(Math.min(1, this._freq[idx] / 190));
    }
    return out;
  },

  // iOS only lets audio start from inside a user tap. Prime the element with a
  // silent clip during the first tap and resume the audio graph.
  unlock() {
    this._graph();
    if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
    const a = this._audioEl();
    if (a._unlocked) return;
    try {
      a.src = SILENT_WAV;
      const p = a.play();
      if (p && p.then) {
        p.then(() => { a.pause(); a.currentTime = 0; a._unlocked = true; }).catch(() => {});
      } else {
        a._unlocked = true;
      }
    } catch (e) { /* ignore */ }
  },
  assessConfigured() {
    return this.ttsConfigured();
  },

  _escape(s) {
    return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  },

  // Turn an Azure HTTP status into a plain-language Chinese reason so failures
  // are visible instead of silently falling back to the robotic browser voice.
  _httpReason(status) {
    const map = {
      400: '请求有误(400)——音色名可能拼错',
      401: 'Key 无效(401)——检查 Key 是否复制完整、有没有多余空格',
      403: '没权限/额度用尽(403)——确认区域(Region)和 Key 是同一个资源，且免费额度未用完',
      404: '区域不存在(404)——区域名拼错了，如 eastus、southeastasia',
      429: '请求太频繁(429)——稍等几秒再试',
    };
    return map[status] || ('Azure 请求失败(' + status + ')');
  },

  // Synthesize `text` to an audio blob URL (no playback). Split from play()
  // so the AI partner can prefetch the NEXT sentence while one is playing.
  async synth(text, rate = 1) {
    const key = (Store.get('azureKey') || '').replace(/\s+/g, '');
    const region = Store.get('azureRegion');
    const voice = Store.get('azureVoice') || 'en-US-AvaMultilingualNeural';
    const pct = Math.round((rate - 1) * 100);
    const rateStr = (pct >= 0 ? '+' : '') + pct + '%';
    const ssml =
      `<speak version='1.0' xml:lang='en-US'><voice name='${voice}'>` +
      `<prosody rate='${rateStr}'>${this._escape(text)}</prosody></voice></speak>`;
    let res;
    try {
      res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        },
        body: ssml,
      });
    } catch (err) {
      // fetch 直接抛错 = 网络打不通（区域名拼错会导致域名解析失败，最常见）
      throw new Error('连不上 Azure——多半是区域(Region)填错，或网络问题');
    }
    if (!res.ok) throw new Error(this._httpReason(res.status));
    return URL.createObjectURL(await res.blob());
  },

  async play(url) {
    this.stop();
    if (this._ctx && this._ctx.state === 'suspended') { try { await this._ctx.resume(); } catch {} }
    // Reuse the element primed during unlock() so playback survives the network
    // delay; it's routed through the analyser graph for the live waveform.
    const a = this._audioEl();
    a.src = url;
    return new Promise((resolve, reject) => {
      this.cur = a;
      let settled = false;
      const done = () => { if (settled) return; settled = true; a._settle = null; URL.revokeObjectURL(url); resolve(); };
      a._settle = done; // stop() calls this so awaiting callers never hang
      a.onended = done;
      a.onerror = done;
      // iOS can interrupt the audio session (e.g. after using the mic for
      // recognition). Resume the context and retry once before giving up.
      const tryPlay = (retry) => a.play().catch(async () => {
        if (settled) return;
        if (retry) {
          try { if (this._ctx) await this._ctx.resume(); } catch {}
          return tryPlay(false);
        }
        settled = true; a._settle = null; URL.revokeObjectURL(url);
        reject(new Error('iPhone 拦截了播放（请确认已先点过屏幕、且未静音）'));
      });
      tryPlay(true);
    });
  },

  async speak(text, rate = 1) {
    const url = await this.synth(text, rate);
    return this.play(url);
  },

  stop() {
    if (!this.cur) return;
    const a = this.cur;
    this.cur = null;
    try { a.pause(); } catch {}
    if (a._settle) a._settle(); // resolve the pending play() promise
  },

  loadSDK() {
    if (window.SpeechSDK) return Promise.resolve();
    if (this._sdkPromise) return this._sdkPromise;
    this._sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('SDK load failed'));
      document.head.appendChild(s);
    });
    return this._sdkPromise;
  },

  // Score the learner's pronunciation of `reference` from the microphone.
  async assess(reference) {
    await this.loadSDK();
    const SDK = window.SpeechSDK;
    const cfg = SDK.SpeechConfig.fromSubscription(
      (Store.get('azureKey') || '').replace(/\s+/g, ''),
      (Store.get('azureRegion') || '').trim().toLowerCase());
    cfg.speechRecognitionLanguage = 'en-US';
    // Finish quickly once the learner stops talking (default is ~2s).
    try { cfg.setProperty(SDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '700'); } catch {}
    const audio = SDK.AudioConfig.fromDefaultMicrophoneInput();
    const recognizer = new SDK.SpeechRecognizer(cfg, audio);
    this._assessRec = recognizer;
    const pa = new SDK.PronunciationAssessmentConfig(
      reference,
      SDK.PronunciationAssessmentGradingSystem.HundredMark,
      SDK.PronunciationAssessmentGranularity.Phoneme,
      true
    );
    pa.applyTo(recognizer);
    return new Promise((resolve, reject) => {
      recognizer.recognizeOnceAsync((result) => {
        this._assessRec = null;
        try {
          const r = SDK.PronunciationAssessmentResult.fromResult(result);
          const words = ((r.detailResult && r.detailResult.Words) || []).map(w => ({
            word: w.Word,
            accuracy: w.PronunciationAssessment ? w.PronunciationAssessment.AccuracyScore : null,
            error: w.PronunciationAssessment ? w.PronunciationAssessment.ErrorType : 'None',
          }));
          resolve({
            accuracy: Math.round(r.accuracyScore),
            fluency: Math.round(r.fluencyScore),
            completeness: Math.round(r.completenessScore),
            pron: Math.round(r.pronunciationScore),
            words,
          });
        } catch (e) {
          reject(e);
        } finally {
          recognizer.close();
        }
      }, (err) => { this._assessRec = null; recognizer.close(); reject(new Error(err)); });
    });
  },

  // Abort an in-flight pronunciation assessment (manual "stop" button).
  stopAssess() {
    if (this._assessRec) { try { this._assessRec.close(); } catch {} this._assessRec = null; }
  },
};

// `const Azure` does NOT become a property of window, so other scripts that
// check `window.Azure` (e.g. speech.js) saw it as missing and always fell back
// to the browser voice. Attach it explicitly so those checks work.
window.Azure = Azure;

// Unlock audio on the first user interaction so Azure playback isn't blocked by
// iOS Safari's autoplay policy. Runs on every gesture (cheap; no-op once ready).
if (typeof document !== 'undefined') {
  const unlock = () => Azure.unlock();
  document.addEventListener('touchend', unlock, { passive: true });
  document.addEventListener('mousedown', unlock);
}
