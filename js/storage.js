// Simple localStorage-backed settings + progress store.
const Store = {
  KEY: 'els_settings_v1',
  defaults: {
    provider: 'claude',
    apiKey: '',
    model: '',
    voiceURI: '',
    listenRate: 1,
    show: { en: false, ipa: false, zh: false },
  },
  _cache: null,

  load() {
    if (this._cache) return this._cache;
    try {
      const raw = localStorage.getItem(this.KEY);
      this._cache = raw ? { ...this.defaults, ...JSON.parse(raw) } : { ...this.defaults };
    } catch {
      this._cache = { ...this.defaults };
    }
    return this._cache;
  },

  get(key) { return this.load()[key]; },

  set(key, value) {
    const s = this.load();
    s[key] = value;
    try { localStorage.setItem(this.KEY, JSON.stringify(s)); } catch {}
    return s;
  },

  setAll(patch) {
    const s = { ...this.load(), ...patch };
    this._cache = s;
    try { localStorage.setItem(this.KEY, JSON.stringify(s)); } catch {}
    return s;
  },
};
