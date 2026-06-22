// Wrappers around the browser's free Speech APIs:
//  - SpeechSynthesis  (text -> speech)  for standard pronunciation
//  - SpeechRecognition (speech -> text)  for pronunciation scoring & voice input
const Speech = {
  voices: [],

  init() {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      this.voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
    };
    load();
    speechSynthesis.onvoiceschanged = load;
  },

  // Higher = better quality. iOS marks downloaded high-quality voices as
  // "premium"/"enhanced" and the low-quality default as "compact".
  voiceQuality(v) {
    const u = (v.voiceURI || '').toLowerCase();
    if (/premium|enhanced|neural|siri/.test(u)) return 2;
    if (/compact/.test(u)) return 0;
    return 1;
  },

  rankedVoices() {
    const lang = (v) => /en-US/i.test(v.lang) ? 2 : /en-GB/i.test(v.lang) ? 1 : 0;
    return [...this.voices].sort((a, b) =>
      this.voiceQuality(b) - this.voiceQuality(a) || lang(b) - lang(a));
  },

  pickVoice() {
    const uri = Store.get('voiceURI');
    if (uri) {
      const found = this.voices.find(v => v.voiceURI === uri);
      if (found) return found;
    }
    // Auto-pick the highest-quality English voice available on the device.
    return this.rankedVoices()[0] || null;
  },

  speak(text, rate = 1) {
    // Use Azure neural voice when configured; otherwise the free browser voice.
    if (window.Azure && Azure.ttsConfigured()) {
      return Azure.speak(text, rate).then(() => {
        if (window.toast) toast('🔊 正在用 Azure 自然音 (v10)');
      }).catch((e) => {
        // Make the silent fallback visible so we can see WHY Azure was skipped.
        if (window.toast) toast('⚠️ 退回浏览器音 (v10)：' + ((e && e.message) || e));
        return this._browserSpeak(text, rate);
      });
    }
    if (window.toast) {
      const kl = (Store.get('azureKey') || '').length;
      const rg = Store.get('azureRegion') || '空';
      const hasA = window.Azure ? '有' : '无';
      toast(`ℹ️ 未走Azure (v10)：Azure对象=${hasA}, Key长度=${kl}, 区域=${rg}`);
    }
    return this._browserSpeak(text, rate);
  },

  _browserSpeak(text, rate = 1) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = this.pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
      u.rate = rate;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  },

  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (window.Azure) Azure.stop();
  },

  recognitionSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },

  // Listen once, resolve with recognized transcript (lowercased).
  recognizeOnce() {
    return new Promise((resolve, reject) => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { reject(new Error('not-supported')); return; }
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      let done = false;
      rec.onresult = (e) => {
        done = true;
        resolve((e.results[0][0].transcript || '').trim().toLowerCase());
      };
      rec.onerror = (e) => { if (!done) reject(new Error(e.error || 'error')); };
      rec.onend = () => { if (!done) reject(new Error('no-speech')); };
      try { rec.start(); } catch (err) { reject(err); }
      this._activeRec = rec;
    });
  },

  stopRecognition() {
    if (this._activeRec) { try { this._activeRec.stop(); } catch {} }
  },
};

// Compare spoken transcript against the target sentence -> 0..100 score.
function scorePronunciation(target, heard) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9'\s]/g, '').split(/\s+/).filter(Boolean);
  const t = norm(target);
  const h = norm(heard);
  if (!t.length) return { score: 0, words: [] };
  const heardSet = new Set(h);
  let hit = 0;
  const words = t.map(w => {
    const ok = heardSet.has(w);
    if (ok) hit++;
    return { w, ok };
  });
  return { score: Math.round((hit / t.length) * 100), words };
}
