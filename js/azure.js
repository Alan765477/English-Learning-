// Azure Cognitive Services integration (optional, paid but with a generous
// free tier). Provides:
//   - Neural TTS via the lightweight REST endpoint (human-like voices)
//   - Pronunciation Assessment via the Speech SDK (loaded on demand)
// Everything degrades gracefully: if Azure isn't configured or a call fails,
// the app falls back to the free browser speech features.
const Azure = {
  cur: null,         // currently playing Audio element
  _sdkPromise: null,

  ttsConfigured() {
    return !!(Store.get('azureKey') && Store.get('azureRegion'));
  },
  assessConfigured() {
    return this.ttsConfigured();
  },

  _escape(s) {
    return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  },

  async speak(text, rate = 1) {
    const key = Store.get('azureKey');
    const region = Store.get('azureRegion');
    const voice = Store.get('azureVoice') || 'en-US-AvaMultilingualNeural';
    const pct = Math.round((rate - 1) * 100);
    const rateStr = (pct >= 0 ? '+' : '') + pct + '%';
    const ssml =
      `<speak version='1.0' xml:lang='en-US'><voice name='${voice}'>` +
      `<prosody rate='${rateStr}'>${this._escape(text)}</prosody></voice></speak>`;
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      },
      body: ssml,
    });
    if (!res.ok) throw new Error('Azure TTS ' + res.status);
    const url = URL.createObjectURL(await res.blob());
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
    if (this.cur) { try { this.cur.pause(); } catch {} this.cur = null; }
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
    const cfg = SDK.SpeechConfig.fromSubscription(Store.get('azureKey'), Store.get('azureRegion'));
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
