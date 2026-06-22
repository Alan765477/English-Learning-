// AI speaking partner — voice-first. Tap the mic, speak English, the AI replies
// out loud (and shows subtitles + a correction). Provider-agnostic: Claude or
// DeepSeek depending on the key in Settings. Calls run directly from the browser.
const AI = {
  history: [],
  busy: false,
  state: 'idle',      // 'idle' | 'listening' | 'thinking' | 'speaking'
  lastSpoken: '',

  SYSTEM: `You are a warm, encouraging English conversation tutor for a Chinese learner who wants to improve speaking and listening.
Rules:
- ALWAYS start with a spoken English reply of 1-3 natural sentences, and always ask a follow-up question to keep the learner talking. Never leave the spoken reply empty.
- Even if the learner writes in Chinese, answer their question in simple English, then warmly encourage them to try saying it in English.
- Use everyday, idiomatic English at an upper-intermediate level.
- Only AFTER the spoken reply, if the learner's English has grammar or word-choice mistakes, add a line containing only "---" then a brief correction in Chinese (the mistake + the natural version). If there are no mistakes, do NOT add the "---" line at all.
- Never lecture. Be friendly and concise.`,

  DEFAULTS: { claude: 'claude-haiku-4-5-20251001', deepseek: 'deepseek-chat' },

  init() {
    document.getElementById('ai-talk').onclick = () => this.toggleTalk();
    document.getElementById('ai-replay').onclick = () => { if (this.lastSpoken) this.speak(this.lastSpoken); };
    document.getElementById('ai-kb').onclick = () => {
      const row = document.getElementById('ai-text-row');
      row.classList.toggle('hidden');
      if (!row.classList.contains('hidden')) document.getElementById('ai-text').focus();
    };
    document.getElementById('ai-send').onclick = () => this.sendText();
    document.getElementById('ai-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.sendText();
    });
    document.querySelectorAll('.topic.chip').forEach(btn => {
      btn.onclick = () => this.send(btn.dataset.topic);
    });
  },

  configured() { return !!Store.get('apiKey'); },

  setState(s, msg) {
    this.state = s;
    if (msg !== undefined) document.getElementById('ai-state').textContent = msg;
    document.getElementById('ai-talk').classList.toggle('listening', s === 'listening');
  },

  // Orb pulse level (0..1) driven by the current state.
  orbLevel() {
    if (this.state === 'speaking') {
      const lv = (window.Azure && Azure.levels) ? Azure.levels(6) : null;
      if (lv) { let s = 0; for (const v of lv) s += v; const a = s / lv.length; if (a > 0.02) return Math.min(1, a * 1.9); }
      return 0.35 + 0.32 * Math.abs(Math.sin(performance.now() / 170)); // synthetic pulse
    }
    if (this.state === 'listening') return 0.18 + 0.16 * Math.abs(Math.sin(performance.now() / 320));
    if (this.state === 'thinking') return 0.1 + 0.08 * Math.abs(Math.sin(performance.now() / 220));
    return 0;
  },

  toggleTalk() {
    if (this.state === 'listening') { Speech.stopRecognition(); return; }
    if (this.busy) return;
    this.listen();
  },

  async listen() {
    if (!this.configured()) { this.warn('请先在「设置」填入 API Key 才能对话。'); return; }
    if (!Speech.recognitionSupported()) {
      this.warn('此浏览器不支持语音输入，点 ⌨️ 改用打字（建议用 Safari）。');
      return;
    }
    Speech.stop();
    this.warn('');
    this.setState('listening', '🎧 聆听中…（说完停顿一下即可）');
    try {
      const text = await Speech.recognizeOnce();
      if (text) this.send(text);
      else this.setState('idle', '没听清，点麦克风再说一次');
    } catch (e) {
      this.setState('idle', '没听清，点麦克风再说一次');
    }
  },

  sendText() {
    const input = document.getElementById('ai-text');
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    this.send(t);
  },

  async send(text) {
    if (this.busy) return;
    if (!this.configured()) { this.warn('请先在「设置」填入 API Key 才能对话。'); return; }
    this.warn('');
    document.getElementById('ai-topics').classList.add('hidden');
    document.getElementById('ai-sub-user').textContent = '🗣 ' + text;
    document.getElementById('ai-sub-ai').textContent = '';
    document.getElementById('ai-sub-corr').textContent = '';
    this.history.push({ role: 'user', text });

    this.busy = true;
    this.setState('thinking', '💭 思考中…');
    try {
      const reply = await this.callProvider(text);
      this.history.push({ role: 'assistant', text: reply });
      this.renderReply(reply);
    } catch (err) {
      this.setState('idle', '点麦克风再试一次');
      this.warn('请求失败：' + (err.message || err) + '（检查 Key / 额度 / 网络）');
    } finally {
      this.busy = false;
    }
  },

  renderReply(reply) {
    reply = (reply || '').trim();
    let [spoken, correction] = reply.split(/\n?---\n?/);
    spoken = (spoken || '').trim();
    correction = (correction || '').trim();
    if (!spoken) { spoken = correction || reply || 'Sorry, could you say that again?'; correction = ''; }
    document.getElementById('ai-sub-ai').textContent = spoken;
    document.getElementById('ai-sub-corr').textContent = correction ? '📝 ' + correction : '';
    this.speak(spoken);
  },

  speak(text) {
    this.lastSpoken = text;
    this.setState('speaking', '');
    Promise.resolve(Speech.speak(text, 1)).finally(() => {
      if (this.state === 'speaking') this.setState('idle', '点麦克风接着说');
    });
  },

  warn(msg) { document.getElementById('ai-warn').textContent = msg || ''; },

  // ---- Provider calls ----
  callProvider() {
    const provider = Store.get('provider');
    const key = Store.get('apiKey');
    const model = Store.get('model') || this.DEFAULTS[provider];
    return provider === 'deepseek' ? this.callDeepSeek(key, model) : this.callClaude(key, model);
  },

  async callClaude(key, model) {
    const messages = this.history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-api-key': key,
        'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: 300, system: this.SYSTEM, messages }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.content || []).map(c => c.text || '').join('').trim();
  },

  async callDeepSeek(key, model) {
    const messages = [
      { role: 'system', content: this.SYSTEM },
      ...this.history.map(m => ({ role: m.role, content: m.text })),
    ];
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model, max_tokens: 300, messages }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  },

  // One-shot translation to Chinese (used by the real-time interpreter).
  async translate(text) {
    const provider = Store.get('provider');
    const key = Store.get('apiKey');
    if (!key) throw new Error('no-key');
    const model = Store.get('model') || this.DEFAULTS[provider];
    const sys = 'You are a translation engine. Translate the English text to natural, concise Simplified Chinese. Output ONLY the translation, nothing else.';
    if (provider === 'deepseek') {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model, max_tokens: 200, messages: [
          { role: 'system', content: sys }, { role: 'user', content: text },
        ] }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return (await res.json()).choices?.[0]?.message?.content?.trim() || '';
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-api-key': key,
        'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: 200, system: sys, messages: [{ role: 'user', content: text }] }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.content || []).map(c => c.text || '').join('').trim();
  },
};
