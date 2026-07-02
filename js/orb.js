// Voice orb: a hollow point-cloud sphere (canvas 2D) — the app's shared
// "voice" visual language. Color + motion communicate state, scale follows
// the real audio level (the Jarvis-style ball):
//   idle       grey, slow breathing
//   listening  blue, grows/shrinks with the user's voice
//   thinking   indigo, contracted, spins faster
//   speaking   purple, pulses with the AI/TTS voice
const Orb = {
  COLORS: {
    idle:      [142, 142, 147],   // systemGray
    listening: [10, 132, 255],    // systemBlue
    thinking:  [94, 92, 230],     // systemIndigo
    speaking:  [191, 90, 242],    // systemPurple
  },
  SPIN:     { idle: 1,   listening: 1.5, thinking: 3.2, speaking: 1.3 },
  CONTRACT: { idle: 1,   listening: 1,   thinking: 0.8, speaking: 1 },

  // opts: { level: () => 0..1, state: () => 'idle'|'listening'|'thinking'|'speaking' }
  mount(canvas, opts) {
    if (!canvas || canvas._orb) return;
    canvas._orb = true;
    const ctx = canvas.getContext('2d');
    const lvFn = (opts && opts.level) || (() => 0);
    const stFn = (opts && opts.state) || (() => 'idle');

    // Points evenly spread on a sphere (Fibonacci spiral) → a hollow shell.
    const N = 360;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * 2.3999632;
      pts.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
    }

    let W = 0, H = 0, cx = 0, cy = 0, R = 0, DPR = 1;
    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width), h = Math.round(rect.height);
      if (!w || !h) return;
      canvas.width = w * DPR; canvas.height = h * DPR;
      W = canvas.width; H = canvas.height; cx = W / 2; cy = H / 2;
      R = Math.min(W, H) * 0.42;
    }
    resize();
    if (window.ResizeObserver) { try { new ResizeObserver(resize).observe(canvas); } catch {} }
    window.addEventListener('resize', resize);

    // Smoothed values so state changes glide instead of snapping.
    let t = 0, rotY = 0, level = 0, contract = 1, spin = 1;
    const col = [...this.COLORS.idle];
    const self = this;

    function frame() {
      requestAnimationFrame(frame);
      if (canvas.offsetParent === null || document.hidden) return; // off-screen
      if (!W || !H) { resize(); if (!W || !H) return; }

      const state = stFn() || 'idle';
      const target = Math.max(0, Math.min(1, lvFn() || 0));
      const tc = self.COLORS[state] || self.COLORS.idle;
      level += (target - level) * 0.18;
      contract += ((self.CONTRACT[state] || 1) - contract) * 0.07;
      spin += ((self.SPIN[state] || 1) - spin) * 0.05;
      for (let k = 0; k < 3; k++) col[k] += (tc[k] - col[k]) * 0.07;

      t += 0.008; rotY += 0.0042 * spin;
      const rotX = Math.sin(t * 0.4) * 0.3;
      const scale = (1 + Math.sin(t * 1.5) * 0.02) * (1 + level * 0.34) * contract;
      const cyy = Math.cos(rotY), syy = Math.sin(rotY), cxx = Math.cos(rotX), sxx = Math.sin(rotX);
      const cr = col[0] | 0, cg = col[1] | 0, cb = col[2] | 0;
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const x1 = p[0] * cyy - p[2] * syy, z1 = p[0] * syy + p[2] * cyy;
        const y1 = p[1] * cxx - z1 * sxx, z2 = p[1] * sxx + z1 * cxx;
        const depth = (z2 + 1) / 2;                 // 0 back .. 1 front
        const rr = R * scale;
        const px = cx + x1 * rr, py = cy + y1 * rr;
        const size = (0.5 + depth * 1.7) * DPR;
        const alpha = 0.1 + depth * 0.55;
        // Front dots take the state color fully; back dots fade toward grey.
        const mix = 0.35 + depth * 0.65;
        const r_ = (142 + (cr - 142) * mix) | 0;
        const g_ = (142 + (cg - 142) * mix) | 0;
        const b_ = (147 + (cb - 147) * mix) | 0;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + r_ + ',' + g_ + ',' + b_ + ',' + alpha.toFixed(2) + ')';
        ctx.arc(px, py, size, 0, 6.2832);
        ctx.fill();
      }
    }
    frame();
  },
};
window.Orb = Orb;

// Real microphone level (0..1) for the orb. Two ways in:
//  - attach(stream): reuse a mic stream we already own (safe everywhere,
//    including iOS where the mic is single-consumer)
//  - start(): open our own stream — skipped on iOS so we never steal the mic
//    from SpeechRecognition / the Azure SDK.
const MicLevel = {
  _ctx: null, _an: null, _data: null, _src: null, _stream: null,
  active: false,
  isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),

  attach(stream) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !stream) return;
    try {
      this._ctx = this._ctx || new AC();
      if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
      this._src = this._ctx.createMediaStreamSource(stream);
      this._an = this._ctx.createAnalyser();
      this._an.fftSize = 256;
      this._an.smoothingTimeConstant = 0.7;
      this._src.connect(this._an); // analyser only — never to speakers (no echo)
      this._data = new Uint8Array(this._an.frequencyBinCount);
      this.active = true;
    } catch { /* visualization is optional */ }
  },

  async start() {
    if (this.active || this.isIOS) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.attach(this._stream);
    } catch { /* mic denied: orb falls back to a synthetic pulse */ }
  },

  level() {
    if (!this.active || !this._an) return 0;
    this._an.getByteTimeDomainData(this._data);
    let sum = 0;
    for (let i = 0; i < this._data.length; i++) {
      const d = (this._data[i] - 128) / 128;
      sum += d * d;
    }
    return Math.min(1, Math.sqrt(sum / this._data.length) * 4);
  },

  stop() {
    this.active = false;
    if (this._src) { try { this._src.disconnect(); } catch {} this._src = null; }
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
  },
};
window.MicLevel = MicLevel;

// Tiny haptic tap for key voice moments (Android; iOS PWA silently ignores).
function haptic(ms = 10) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch {} }
window.haptic = haptic;
