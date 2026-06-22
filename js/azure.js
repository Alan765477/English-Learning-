// Azure Cognitive Services integration (optional, paid but with a generous
// free tier). Provides:
//   - Neural TTS via the lightweight REST endpoint (human-like voices)
//   - Pronunciation Assessment via the Speech SDK (loaded on demand)
// Everything degrades gracefully: if Azure isn't configured or a call fails,
// the app falls back to the free browser speech features.
const Azure = {
  cur: null,         // currently playing source (Web Audio BufferSource or <audio>)
  _sdkPromise: null,
  _ctx: null,        // shared AudioContext (needed to beat iOS autoplay rules)

  ttsConfigured() {
    return !!(Store.get('azureKey') && Store.get('azureRegion'));
  },

  _audioCtx() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this._ctx = new AC();
    }
    return this._ctx;
  },

  // iOS Safari only lets audio start from inside a user tap. Azure audio is
  // fetched over the network first, so by the time it plays the "tap" is over
  // and iOS blocks it. Resuming the AudioContext during the tap unlocks it for
  // the rest of the session; we wire this to the first touch/click below.
  unlock() {
    const ctx = this._audioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
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

  async speak(text, rate = 1) {
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

    const bytes = await res.arrayBuffer();
    const ctx = this._audioCtx();
    // Preferred path: Web Audio. Once the context is unlocked in a tap it keeps
    // playing even after the network delay, so iOS won't silence Azure.
    if (ctx) {
      try {
        if (ctx.state === 'suspended') await ctx.resume();
        const buf = await ctx.decodeAudioData(bytes.slice(0));
        this.stop();
        return new Promise((resolve) => {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.onended = () => resolve();
          this.cur = src;
          src.start(0);
        });
      } catch (e) {
        // fall through to the <audio> element path on decode/playback failure
      }
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    this.stop();
    return new Promise((resolve) => {
      const a = new Audio(url);
      this.cur = a;
      const done = () => { URL.revokeObjectURL(url); resolve(); };
      a.onended = done;
      a.onerror = done;
      a.play().catch(done);
    });
  },

  stop() {
    if (!this.cur) return;
    try { this.cur.stop ? this.cur.stop() : this.cur.pause(); } catch {}
    this.cur = null;
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
    const audio = SDK.AudioConfig.fromDefaultMicrophoneInput();
    const recognizer = new SDK.SpeechRecognizer(cfg, audio);
    const pa = new SDK.PronunciationAssessmentConfig(
      reference,
      SDK.PronunciationAssessmentGradingSystem.HundredMark,
      SDK.PronunciationAssessmentGranularity.Phoneme,
      true
    );
    pa.applyTo(recognizer);
    return new Promise((resolve, reject) => {
      recognizer.recognizeOnceAsync((result) => {
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
      }, (err) => { recognizer.close(); reject(new Error(err)); });
    });
  },
};

// Unlock audio on the first user interaction so Azure playback isn't blocked by
// iOS Safari's autoplay policy. Runs on every gesture (cheap; no-op once ready).
if (typeof document !== 'undefined') {
  const unlock = () => Azure.unlock();
  document.addEventListener('touchend', unlock, { passive: true });
  document.addEventListener('mousedown', unlock);
}
