// AI speaking partner — voice-first. Tap the mic, speak English, the AI replies
// out loud (and shows subtitles + a correction). Provider-agnostic: Claude or
// DeepSeek depending on the key in Settings. Calls run directly from the browser.
//
// Latency design: replies STREAM in (SSE). Subtitles appear word by word, and
// speech starts as soon as the FIRST sentence is complete — while the rest is
// still generating — instead of waiting for the whole reply + whole audio.
// With Azure TTS each next sentence is synthesized while the previous one
// plays, so there is no gap between sentences.
const AI = {
  history: [],
  busy: false,
  state: 'idle',      // 'idle' | 'listening' | 'thinking' | 'speaking'
  lastSpoken: '',
  _gen: 0,            // bumped on every new turn; stale speech jobs check it
  _chain: Promise.resolve(),  // sequential sentence-playback queue
  _emitted: 0,        // chars of the spoken part already queued for TTS

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
    document.getElementById('ai-setup').onclick = () => { if (window.Sheet) Sheet.open('sheet-ai'); };
    this.updateSetup();
  },

  configured() { return !!Store.get('apiKey'); },

  // First-run guidance: until an API key is saved, the screen shows a single
  // "connect" button instead of exposing the settings form up front.
  updateSetup() {
    const ok = this.configured();
    document.getElementById('ai-setup').classList.toggle('hidden', ok);
    document.getElementById('ai-topics').classList.toggle('hidden', !ok || this.history.length > 0);
    if (!ok) document.getElementById('ai-state').textContent = '先连接 AI 外教，就能开口对话';
    else if (this.state === 'idle' && !this.history.length) document.getElementById('ai-state').textContent = '点麦克风，开口说英语';
  },

  setState(s, msg) {
    this.state = s;
    if (msg !== undefined) document.getElementById('ai-state').textContent = msg;
    document.getElementById('ai-talk').classList.toggle('listening', s === 'listening');
  },

  // Orb state + pulse level (0..1). Listening uses the real microphone level
  // when MicLevel is running (non-iOS); otherwise a synthetic pulse.
  orbState() { return this.state; },
  orbLevel() {
    if (this.state === 'speaking') {
      const lv = (window.Azure && Azure.levels) ? Azure.levels(6) : null;
      if (lv) { let s = 0; for (const v of lv) s += v; const a = s / lv.length; if (a > 0.02) return Math.min(1, a * 1.9); }
      return 0.35 + 0.32 * Math.abs(Math.sin(performance.now() / 170)); // synthetic pulse
    }
    if (this.state === 'listening') {
      if (window.MicLevel && MicLevel.active) return MicLevel.level();
      return 0.18 + 0.16 * Math.abs(Math.sin(performance.now() / 320));
    }
    if (this.state === 'thinking') return 0.1 + 0.08 * Math.abs(Math.sin(performance.now() / 220));
    return 0;
  },

  toggleTalk() {
    if (this.state === 'listening') { Speech.stopRecognition(); return; }
    if (this.busy) return;
    this.listen();
  },

  async listen() {
    if (!this.configured()) { if (window.Sheet) Sheet.open('sheet-ai'); return; }
    if (!Speech.recognitionSupported()) {
      this.warn('此浏览器不支持语音输入，点键盘图标改用打字（建议用 Safari）。');
      return;
    }
    this._gen++;           // cancel any sentences still queued from the last reply
    Speech.stop();
    this.warn('');
    if (window.haptic) haptic(10);
    this.setState('listening', '聆听中…（说完停顿一下即可）');
    if (window.MicLevel) MicLevel.start(); // non-iOS: the orb follows your voice
    const sub = document.getElementById('ai-sub-user');
    try {
      // Live transcript while you talk — feedback starts immediately.
      const text = await Speech.recognizeOnce((interim) => {
        if (interim) sub.textContent = '🗣 ' + interim;
      });
      if (text) this.send(text);
      else this.setState('idle', '没听清，点麦克风再说一次');
    } catch (e) {
      this.setState('idle', '没听清，点麦克风再说一次');
    } finally {
      if (window.MicLevel) MicLevel.stop();
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
    if (!this.configured()) { if (window.Sheet) Sheet.open('sheet-ai'); return; }
    this.warn('');
    const gen = ++this._gen;
    Speech.stop();
    document.getElementById('ai-topics').classList.add('hidden');
    document.getElementById('ai-sub-user').textContent = '🗣 ' + text;
    document.getElementById('ai-sub-ai').textContent = '';
    document.getElementById('ai-sub-corr').textContent = '';
    this.history.push({ role: 'user', text });

    this.busy = true;
    this.setState('thinking', '思考中…');
    try {
      const reply = await this.callStreaming(gen);
      this.history.push({ role: 'assistant', text: reply });
      this.finishReply(reply, gen);
    } catch (err) {
      if (gen !== this._gen) return;
      this.setState('idle', '点麦克风再试一次');
      this.warn('请求失败：' + (err.message || err) + '（检查 Key / 额度 / 网络）');
    } finally {
      this.busy = false;
    }
  },

  // ---- Streaming pipeline ----

  // Called on every delta with the full text so far; updates the subtitle and
  // queues completed sentences for speech.
  onStreamText(full, gen, done) {
    if (gen !== this._gen) return;
    let spoken = full.split(/\n?---\n?/)[0] || '';
    document.getElementById('ai-sub-ai').textContent = spoken.trim();
    // Once "---" appears the spoken part is final even if the stream continues.
    this.emitSentences(spoken, gen, done || /\n?---\n?/.test(full));
  },

  // Queue every newly-completed sentence for TTS. `flush` also emits the tail.
  emitSentences(spoken, gen, flush) {
    const rest = spoken.slice(this._emitted);
    const re = /[^.!?…\n]*[.!?…\n]+["')\]]*\s*/g;
    let m, consumed = 0;
    while ((m = re.exec(rest))) {
      const s = m[0].trim();
      if (s) this.enqueueSpeak(s, gen);
      consumed = re.lastIndex;
    }
    this._emitted += consumed;
    if (flush) {
      const tail = spoken.slice(this._emitted).trim();
      if (tail) this.enqueueSpeak(tail, gen);
      this._emitted = spoken.length;
    }
  },

  // Sequential playback queue. With Azure, synthesis of THIS sentence starts
  // immediately (in parallel with whatever is playing) and playback happens in
  // order — so sentence N+1's audio is ready the moment sentence N ends.
  enqueueSpeak(sentence, gen) {
    const pre = (window.Azure && Azure.ttsConfigured())
      ? Azure.synth(sentence, 1).catch(() => null)
      : null;
    this._chain = this._chain.then(async () => {
      if (gen !== this._gen) {
        if (pre) pre.then(u => { if (u) URL.revokeObjectURL(u); });
        return;
      }
      this.setState('speaking', '');
      try {
        if (pre) {
          const url = await pre;
          if (gen !== this._gen) { if (url) URL.revokeObjectURL(url); return; }
          if (url) return await Azure.play(url);
          return await Speech._browserSpeak(sentence, 1); // Azure synth failed
        }
        await Speech.speak(sentence, 1);
      } catch { /* keep the queue moving */ }
    });
  },

  finishReply(reply, gen) {
    if (gen !== this._gen) return;
    let [spoken, correction] = (reply || '').trim().split(/\n?---\n?/);
    spoken = (spoken || '').trim();
    correction = (correction || '').trim();
    if (!spoken && !correction) {
      // AI returned nothing — almost always a provider/key mismatch.
      this.setState('idle', '点麦克风再说一次');
      this.warn('AI 没有返回内容：请确认「AI 服务商」和「API Key」是同一家（Claude↔Claude key、DeepSeek↔DeepSeek key），且额度充足。');
      return;
    }
    if (!spoken) {
      // Nothing was streamed as speech; speak the correction instead.
      spoken = correction; correction = '';
      document.getElementById('ai-sub-ai').textContent = spoken;
      if (this._emitted === 0) this.enqueueSpeak(spoken, gen);
    }
    if (correction) document.getElementById('ai-sub-corr').textContent = '📝 ' + correction;
    this.lastSpoken = spoken;
    // When the last queued sentence finishes, come back to rest.
    this._chain = this._chain.then(() => {
      if (gen === this._gen && this.state === 'speaking') this.setState('idle', '点麦克风接着说');
    });
  },

  // Replay button: speak a full text as one utterance.
  speak(text) {
    const gen = ++this._gen;
    Speech.stop();
    this.lastSpoken = text;
    this.setState('speaking', '');
    Promise.resolve(Speech.speak(text, 1)).finally(() => {
      if (gen === this._gen && this.state === 'speaking') this.setState('idle', '点麦克风接着说');
    });
  },

  warn(msg) { document.getElementById('ai-warn').textContent = msg || ''; },

  // ---- Provider calls (streaming with non-streaming fallback) ----

  async callStreaming(gen) {
    const provider = Store.get('provider');
    const key = Store.get('apiKey');
    const model = Store.get('model') || this.DEFAULTS[provider];
    this._emitted = 0;
    let full = '';
    const onDelta = (d) => { if (!d) return; full += d; this.onStreamText(full, gen, false); };
    try {
      if (provider === 'deepseek') await this.streamDeepSeek(key, model, onDelta);
      else await this.streamClaude(key, model, onDelta);
    } catch (e) {
      if (full) throw e; // stream broke mid-reply — surface the error
      // Streaming unavailable (some proxies strip SSE): one-shot fallback.
      full = provider === 'deepseek'
        ? await this.callDeepSeek(key, model)
        : await this.callClaude(key, model);
    }
    this.onStreamText(full, gen, true);
    return full.trim();
  },

  // Minimal SSE reader: calls onData(json) for every `data: {...}` line.
  async _readSSE(res, onData) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (payload === '[DONE]') return;
        try { onData(JSON.parse(payload)); } catch { /* keepalive/partial */ }
      }
    }
  },

  _claudeMessages() {
    return this.history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
  },

  async streamClaude(key, model, onDelta) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-api-key': key,
        'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: 300, system: this.SYSTEM, stream: true, messages: this._claudeMessages() }),
    });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    await this._readSSE(res, (j) => {
      if (j.type === 'content_block_delta' && j.delta && j.delta.text) onDelta(j.delta.text);
    });
  },

  async streamDeepSeek(key, model, onDelta) {
    const messages = [
      { role: 'system', content: this.SYSTEM },
      ...this.history.map(m => ({ role: m.role, content: m.text })),
    ];
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model, max_tokens: 300, stream: true, messages }),
    });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    await this._readSSE(res, (j) => {
      const d = j.choices && j.choices[0] && j.choices[0].delta;
      if (d && d.content) onDelta(d.content);
    });
  },

  async callClaude(key, model) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-api-key': key,
        'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: 300, system: this.SYSTEM, messages: this._claudeMessages() }),
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

  // Generic one-shot call (system + single user message → text).
  async _oneShot(sys, user, maxTokens) {
    const provider = Store.get('provider');
    const key = Store.get('apiKey');
    if (!key) throw new Error('no-key');
    const model = Store.get('model') || this.DEFAULTS[provider];
    if (provider === 'deepseek') {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [
          { role: 'system', content: sys }, { role: 'user', content: user },
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
      body: JSON.stringify({ model, max_tokens: maxTokens, system: sys, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.content || []).map(c => c.text || '').join('').trim();
  },

  // One-shot translation to Chinese (used by the real-time interpreter).
  translate(text) {
    return this._oneShot(
      'You are a translation engine. Translate the English text to natural, concise Simplified Chinese. Output ONLY the translation, nothing else.',
      text, 200);
  },

  // Batch-annotate sentences for the lesson importer:
  // returns [{zh, ipa}] in the same order as the input.
  async annotate(sentences) {
    const sys =
      'You are a JSON API for an English-learning app. For EACH input sentence produce: ' +
      '"zh" — a natural, concise Simplified Chinese translation; ' +
      '"ipa" — an approximate General-American IPA transcription of the whole sentence, wrapped in slashes. ' +
      'Reply with ONLY a JSON array, one object {"zh","ipa"} per input sentence, in the same order. No markdown, no extra text.';
    const raw = await this._oneShot(sys, JSON.stringify(sentences), 2400);
    const m = raw.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : raw);
    if (!Array.isArray(arr)) throw new Error('bad-json');
    return arr;
  },
};

// Top-level `const` in classic scripts does not become a window property;
// attach explicitly so cross-module `window.AI` checks work.
window.AI = AI;
