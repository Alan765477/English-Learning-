// AI speaking partner. Provider-agnostic: works with either Claude or
// DeepSeek depending on the key configured in Settings. Calls run directly
// from the browser, so no backend is needed for personal use.
const AI = {
  history: [], // { role: 'user'|'assistant', text }
  busy: false,

  SYSTEM: `You are a warm, encouraging English conversation tutor for a Chinese learner who wants to improve speaking and listening.
Rules:
- Keep your spoken reply short and natural: 1-3 sentences, like a real conversation. Always ask a follow-up question to keep the learner talking.
- Use everyday, idiomatic English at an upper-intermediate level.
- If the learner's message has grammar or word-choice mistakes, after your reply add a line containing only "---" and then a brief correction in Chinese (point out the mistake and give the natural version). If there are no mistakes, do NOT add the "---" line.
- Never lecture. Be friendly and concise.`,

  DEFAULTS: { claude: 'claude-haiku-4-5-20251001', deepseek: 'deepseek-chat' },

  init() {
    document.getElementById('ai-send').onclick = () => this.sendText();
    document.getElementById('ai-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.sendText();
    });
    document.getElementById('ai-mic').onclick = () => this.voiceInput();
    document.querySelectorAll('.topic.chip').forEach(btn => {
      btn.onclick = () => this.send(btn.dataset.topic);
    });
  },

  sendText() {
    const input = document.getElementById('ai-text');
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    this.send(t);
  },

  async voiceInput() {
    const mic = document.getElementById('ai-mic');
    if (!Speech.recognitionSupported()) {
      this.warn('此浏览器不支持语音输入，请用 Safari/Chrome 或直接打字。');
      return;
    }
    mic.classList.add('on');
    this.warn('请说…');
    try {
      const text = await Speech.recognizeOnce();
      mic.classList.remove('on');
      this.warn('');
      if (text) this.send(text);
    } catch {
      mic.classList.remove('on');
      this.warn('没听清，再试一次。');
    }
  },

  async send(text) {
    if (this.busy) return;
    const key = Store.get('apiKey');
    if (!key) {
      this.warn('请先在「设置」里填入 API Key，才能使用 AI 陪练。');
      return;
    }
    this.warn('');
    document.getElementById('ai-empty')?.remove();
    this.addBubble('user', text);
    this.history.push({ role: 'user', text });

    const typing = this.addBubble('ai', '正在思考…');
    typing.classList.add('typing');
    this.busy = true;
    try {
      const reply = await this.callProvider(text);
      typing.remove();
      this.history.push({ role: 'assistant', text: reply });
      this.renderReply(reply);
    } catch (err) {
      typing.remove();
      this.warn('请求失败：' + (err.message || err) + '（可能是 Key 错误、额度不足或网络/跨域限制）');
    } finally {
      this.busy = false;
    }
  },

  async callProvider(text) {
    const provider = Store.get('provider');
    const key = Store.get('apiKey');
    const model = Store.get('model') || this.DEFAULTS[provider];
    return provider === 'deepseek'
      ? this.callDeepSeek(key, model)
      : this.callClaude(key, model);
  },

  async callClaude(key, model) {
    const messages = this.history.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
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

  renderReply(reply) {
    const [spoken, correction] = reply.split(/\n?---\n?/);
    const bubble = this.addBubble('ai', '');
    const span = document.createElement('span');
    span.textContent = spoken.trim();
    bubble.appendChild(span);
    const speak = document.createElement('span');
    speak.className = 'speak';
    speak.textContent = '🔊';
    speak.onclick = () => Speech.speak(spoken.trim(), 1);
    bubble.appendChild(speak);
    if (correction && correction.trim()) {
      const c = document.createElement('span');
      c.className = 'correction';
      c.textContent = '📝 ' + correction.trim();
      bubble.appendChild(c);
    }
    // Auto-read the reply aloud (good for listening practice).
    Speech.speak(spoken.trim(), 1);
  },

  addBubble(who, text) {
    const chat = document.getElementById('ai-chat');
    const b = document.createElement('div');
    b.className = 'bubble ' + who;
    b.textContent = text;
    chat.appendChild(b);
    chat.scrollTop = chat.scrollHeight;
    return b;
  },

  warn(msg) { document.getElementById('ai-warn').textContent = msg; },
};
