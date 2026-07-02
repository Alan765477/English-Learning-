// App shell: 4-tab navigation (练习/陪练/生词/我的), sub-pages with back buttons,
// bottom sheets for lesson picking & settings, module bootstrapping, PWA.
const App = {
  // Sub-pages highlight their parent tab.
  PARENT: { video: 'practice', interp: 'practice' },

  init() {
    Speech.init();
    // Init each module independently so one failure can't break the rest.
    [Practice, Importer, AI, Video, Interpreter, Vocab].forEach(m => {
      try { m.init(); } catch (e) { console.error('init failed', e); }
    });
    try { this.initSettings(); } catch (e) { console.error(e); }
    this.initNav();
    this.initSheets();
    this.registerSW();
    // Voice orb on the AI screen — color/motion follow the conversation state,
    // scale follows the real speaking level.
    if (window.Orb) {
      Orb.mount(document.getElementById('ai-orb'), {
        level: () => (window.AI && AI.orbLevel) ? AI.orbLevel() : 0,
        state: () => (window.AI && AI.orbState) ? AI.orbState() : 'idle',
      });
    }
  },

  initNav() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.onclick = () => this.show(tab.dataset.view);
    });
    // Tool cards & back buttons.
    document.querySelectorAll('[data-goto]').forEach(btn => {
      btn.onclick = () => this.show(btn.dataset.goto);
    });
  },

  show(view) {
    Speech.stop();
    if (window.Video) Video.pause();
    if (window.Interpreter && Interpreter.active && view !== 'interp') Interpreter.stop();
    if (window.Practice && Practice.active) Practice.stopRecord();
    if (window.Sheet) Sheet.close();
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-' + view).classList.remove('hidden');
    const tabView = this.PARENT[view] || view;
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.view === tabView));
    if (view === 'me') this.renderMe();
  },

  renderMe() {
    document.getElementById('me-streak').textContent = Vocab.streak();
    document.getElementById('me-vocab').textContent = Vocab.list().length;
    this.updateRows();
  },

  updateRows() {
    const providerName = Store.get('provider') === 'deepseek' ? 'DeepSeek' : 'Claude';
    document.getElementById('row-ai-val').textContent =
      Store.get('apiKey') ? providerName : '未连接';
    document.getElementById('row-voice-val').textContent =
      (Store.get('azureKey') && Store.get('azureRegion')) ? 'Azure 神经语音' : '手机语音';
  },

  initSheets() {
    document.getElementById('sheet-backdrop').onclick = () => Sheet.close();
    document.getElementById('row-ai').onclick = () => Sheet.open('sheet-ai');
    document.getElementById('row-voice').onclick = () => Sheet.open('sheet-voice');
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
      setTimeout(() => { tip.classList.add('hidden'); Sheet.close(); }, 1200);
      this.updateRows();
      if (window.AI && AI.updateSetup) AI.updateSetup();
    };

    // Azure settings.
    const azKey = document.getElementById('set-azure-key');
    const azRegion = document.getElementById('set-azure-region');
    const azVoice = document.getElementById('set-azure-voice');
    azKey.value = Store.get('azureKey');
    azRegion.value = Store.get('azureRegion');
    azVoice.value = Store.get('azureVoice');
    document.getElementById('set-azure-save').onclick = async () => {
      // Strip ALL whitespace from the key (mobile copy/paste often sneaks in a
      // trailing newline or space, which makes a valid key return 401).
      Store.setAll({
        azureKey: azKey.value.replace(/\s+/g, ''),
        azureRegion: azRegion.value.trim().toLowerCase(),
        azureVoice: azVoice.value,
      });
      this.updateRows();
      const tip = document.getElementById('set-azure-saved');
      const show = (msg, ok) => {
        tip.textContent = msg;
        tip.style.color = ok ? '' : '#d6453d';
        tip.classList.remove('hidden');
      };
      // Test Azure directly (NOT Speech.speak, which silently falls back to the
      // browser voice). This way a wrong key/region surfaces a clear error
      // instead of leaving the user wondering why it still sounds robotic.
      if (!Store.get('azureKey') || !Store.get('azureRegion')) {
        show('已保存。未填 Key 或区域，将使用免费的浏览器语音。', true);
        setTimeout(() => tip.classList.add('hidden'), 3500);
        return;
      }
      show('正在测试 Azure 神经语音…', true);
      try {
        await Azure.speak('Azure neural voice is ready.', 1);
        show('✅ Azure 神经语音可用！以后朗读都会用自然音色。', true);
        setTimeout(() => tip.classList.add('hidden'), 4000);
      } catch (e) {
        show('❌ ' + (e.message || 'Azure 连接失败') + '。（暂时仍用浏览器语音）', false);
      }
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

    this.updateRows();
  },

  registerSW() {
    // The service-worker offline cache kept pinning old builds on iOS, causing
    // endless "still the old version" problems. We now actively REMOVE it and
    // wipe its caches so the app always loads the latest code from the network.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => regs.forEach(r => r.unregister())).catch(() => {});
    }
    if (window.caches && caches.keys) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
    }
  },
};

// iOS-style bottom sheet (single instance open at a time).
const Sheet = {
  cur: null,
  open(id) {
    document.querySelectorAll('.sheet.open').forEach(s => s.classList.remove('open'));
    document.getElementById('sheet-backdrop').classList.add('show');
    document.getElementById(id).classList.add('open');
    this.cur = id;
  },
  close() {
    document.getElementById('sheet-backdrop').classList.remove('show');
    document.querySelectorAll('.sheet.open').forEach(s => s.classList.remove('open'));
    this.cur = null;
  },
};
window.Sheet = Sheet;

// Lightweight on-screen toast so playback/diagnostic messages are visible on
// mobile (where there's no console to inspect).
function toast(msg, ms = 5000) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.style.cssText =
      'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);max-width:90%;' +
      'background:#1f2330;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;' +
      'line-height:1.4;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.3);text-align:center;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.opacity = '0'; }, ms);
}

// ---- Auto-update: silently reload when a newer build is deployed ----
// Keep APP_BUILD in sync with the ?v=NN on the asset URLs in index.html.
const APP_BUILD = 26;
async function checkUpdate() {
  try {
    const html = await (await fetch('./index.html?_=' + Date.now(), { cache: 'no-store' })).text();
    const m = html.match(/style\.css\?v=(\d+)/);
    if (m && +m[1] !== APP_BUILD) location.reload();
  } catch (e) { /* offline: ignore */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
setTimeout(checkUpdate, 4000);

window.addEventListener('DOMContentLoaded', () => App.init());
