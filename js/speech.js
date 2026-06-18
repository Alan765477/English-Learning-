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

  pickVoice() {
    const uri = Store.get('voiceURI');
    if (uri) {
      const found = this.voices.find(v => v.voiceURI === uri);
      if (found) return found;
    }
    // Prefer a natural en-US / en-GB voice.
    return this.voices.find(v => /en-US/i.test(v.lang))
        || this.voices.find(v => /en-GB/i.test(v.lang))
        || this.voices[0] || null;
  },

  speak(text, rate = 1) {
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
