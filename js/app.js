// App shell: tab navigation, settings screen, module bootstrapping, PWA.
const App = {
  init() {
    Speech.init();
    Listening.init();
    Shadowing.init();
    Dictation.init();
    AI.init();
    Video.init();
    this.initSettings();
    this.initNav();
    this.registerSW();
  },

  initNav() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.onclick = () => this.show(tab.dataset.view, tab);
    });
  },

  show(view, tab) {
    Speech.stop();
    if (window.Video) Video.pause();
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-' + view).classList.remove('hidden');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    (tab || document.querySelector(`.tab[data-view="${view}"]`)).classList.add('active');
  },

  initSettings() {
    const provider = document.getElementById('set-provider');
    const apikey = document.getElementById('set-apikey');
    const model = document.getElementById('set-model');
    const hint = document.getElementById('set-model-hint');
    provider.value = Store.get('provider');
    apikey.value = Store.get('apiKey');
    model.value = Store.get('model');

    const updateHint = () => {
      hint.textContent = provider.value === 'deepseek'
        ? '默认模型 deepseek-chat。到 platform.deepseek.com 申请 Key（支持国内支付）。'
        : '默认模型 claude-haiku-4-5（快又便宜）。到 console.anthropic.com 申请 Key。注意：Claude MAX 订阅不能用于 API，需单独充值。';
    };
    updateHint();
    provider.onchange = updateHint;

    document.getElementById('set-save').onclick = () => {
      Store.setAll({
        provider: provider.value,
        apiKey: apikey.value.trim(),
        model: model.value.trim(),
      });
      const tip = document.getElementById('set-saved');
      tip.classList.remove('hidden');
      setTimeout(() => tip.classList.add('hidden'), 2000);
    };

    // Voice picker (populated once voices load).
    const voiceSel = document.getElementById('set-voice');
    const fillVoices = () => {
      if (!Speech.voices.length) return;
      const q = { 2: '✨高质量', 1: '', 0: '·精简' };
      voiceSel.innerHTML = Speech.rankedVoices()
        .map(v => `<option value="${v.voiceURI}">${v.name}（${v.lang}）${q[Speech.voiceQuality(v)]}</option>`).join('');
      voiceSel.value = Store.get('voiceURI') || (Speech.pickVoice()?.voiceURI || '');
    };
    fillVoices();
    if ('speechSynthesis' in window) {
      const prev = speechSynthesis.onvoiceschanged;
      speechSynthesis.onvoiceschanged = () => { if (prev) prev(); fillVoices(); };
    }
    voiceSel.onchange = () => {
      Store.set('voiceURI', voiceSel.value);
      Speech.speak('This is the voice you selected.', 1);
    };
  },

  registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
