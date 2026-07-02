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
      return Azure.speak(text, rate).catch((e) => {
        // Only surface a message when Azure actually fails (kept subtle).
        if (window.toast) toast('Azure 朗读失败，暂用手机音：' + ((e && e.message) || e));
        return this._browserSpeak(text, rate);
      });
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
  // `onInterim` (optional) receives the live partial transcript while the
  // user is still talking, so the UI can show words as they're spoken.
  recognizeOnce(onInterim) {
    return new Promise((resolve, reject) => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { reject(new Error('not-supported')); return; }
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      let done = false;
      rec.onresult = (e) => {
        let finalText = '', interim = '';
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript + ' ';
          else interim += r[0].transcript;
        }
        if (finalText.trim()) {
          done = true;
          resolve(finalText.trim().toLowerCase());
          try { rec.stop(); } catch {}
        } else if (onInterim) {
          onInterim(interim.trim());
        }
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
