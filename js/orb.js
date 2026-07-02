// Voice nebula: a living cloud of glowing particles (canvas 2D) — the app's
// shared "voice" visual language. A tilted, slowly-precessing disc of dust
// with differential rotation (inner particles orbit faster), a soft core
// glow and twinkling grains, so it never reads as a static image.
// Color + motion communicate state, scale/brightness follow the audio level:
//   idle       grey, slow drift and breathing
//   listening  blue, expands and brightens with the user's voice
//   thinking   indigo, contracted, spins faster
//   speaking   purple, pulses with the AI/TTS voice
const Orb = {
  COLORS: {   // core tint
    idle:      [148, 154, 178],
    listening: [10, 132, 255],
    thinking:  [94, 92, 230],
    speaking:  [191, 90, 242],
  },
  ACCENTS: {  // secondary dust tint (adds depth)
    idle:      [110, 118, 148],
    listening: [100, 214, 255],
    thinking:  [170, 148, 255],
    speaking:  [255, 148, 216],
  },
  SPEED:  { idle: 1, listening: 1.6, thinking: 3.0, speaking: 1.7 },
  SPREAD: { idle: 1, listening: 1.06, thinking: 0.7, speaking: 1.02 },

  // Soft radial glow sprite, tinted to a color (regenerated as states blend).
  _makeSprite(rgb) {
    const s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
    grad.addColorStop(0.3, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},.55)`);
    grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return s;
  },

  // opts: { level: () => 0..1, state: () => 'idle'|'listening'|'thinking'|'speaking' }
  mount(canvas, opts) {
    if (!canvas || canvas._orb) return;
    canvas._orb = true;
    const ctx = canvas.getContext('2d');
    const lvFn = (opts && opts.level) || (() => 0);
    const stFn = (opts && opts.state) || (() => 'idle');
    const dark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;

    // Particle cloud. Radius is biased toward a dense core with a wispy rim.
    const N = 280;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const u = Math.random();
      pts.push({
        a: Math.random() * 6.2832,          // base orbital angle
        r: Math.pow(u, 0.72),               // 0 core .. 1 rim (core-dense)
        sp: 0.5 + Math.random(),            // per-particle speed factor
        sz: 0.45 + Math.random() * Math.random() * 1.4,
        ph: Math.random() * 6.2832,         // wobble/twinkle phase
        wf: 0.5 + Math.random() * 1.4,      // wobble frequency
        mix: Math.random(),                 // core↔accent color mix
        lift: (Math.random() - 0.5),        // out-of-plane float
      });
    }

    let W = 0, H = 0, cx = 0, cy = 0, R = 0, DPR = 1;
    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width), h = Math.round(rect.height);
      if (!w || !h) return;
      canvas.width = w * DPR; canvas.height = h * DPR;
      W = canvas.width; H = canvas.height; cx = W / 2; cy = H / 2;
      R = Math.min(W, H) * 0.46;
    }
    resize();
    if (window.ResizeObserver) { try { new ResizeObserver(resize).observe(canvas); } catch {} }
    window.addEventListener('resize', resize);

    // Smoothed values so state changes glide instead of snapping.
    const self = this;
    let t = 0, level = 0, spin = 1, spread = 1;
    const col = [...this.COLORS.idle];
    const acc = [...this.ACCENTS.idle];
    let spriteA = null, spriteB = null, spriteKey = '';

    function refreshSprites() {
      const key = (col[0] | 0) + ',' + (col[1] | 0) + ',' + (acc[0] | 0);
      if (key === spriteKey) return;
      spriteKey = key;
      spriteA = self._makeSprite([col[0] | 0, col[1] | 0, col[2] | 0]);
      spriteB = self._makeSprite([acc[0] | 0, acc[1] | 0, acc[2] | 0]);
    }

    function frame() {
      requestAnimationFrame(frame);
      if (canvas.offsetParent === null || document.hidden) return; // off-screen
      if (!W || !H) { resize(); if (!W || !H) return; }

      const state = stFn() || 'idle';
      const target = Math.max(0, Math.min(1, lvFn() || 0));
      const tc = self.COLORS[state] || self.COLORS.idle;
      const ta = self.ACCENTS[state] || self.ACCENTS.idle;
      // Fast attack, slow release — feels responsive to the voice.
      level += (target - level) * (target > level ? 0.4 : 0.08);
      spin += ((self.SPEED[state] || 1) - spin) * 0.05;
      spread += ((self.SPREAD[state] || 1) - spread) * 0.06;
      for (let k = 0; k < 3; k++) {
        col[k] += (tc[k] - col[k]) * 0.07;
        acc[k] += (ta[k] - acc[k]) * 0.07;
      }
      refreshSprites();

      t += 0.016;
      const isDark = dark ? dark.matches : true;
      const breath = 1 + Math.sin(t * 0.9) * 0.025;
      const grow = spread * breath * (1 + level * 0.3);
      const prec = t * 0.1;                     // slow precession of the disc
      const cp = Math.cos(prec), sp_ = Math.sin(prec);

      ctx.clearRect(0, 0, W, H);

      // Core glow.
      const coreR = R * (0.5 + level * 0.22) * breath;
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      const coreA = (isDark ? 0.4 : 0.26) * (0.8 + level * 0.5);
      cg.addColorStop(0, `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${coreA.toFixed(2)})`);
      cg.addColorStop(1, `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},0)`);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = cg;
      ctx.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2);

      // Dust — additive in dark mode for a real glow; normal blend on light.
      ctx.globalCompositeOperation = isDark ? 'lighter' : 'source-over';
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        // Differential rotation: inner dust orbits faster than the rim.
        const ang = p.a + t * (0.12 + 0.42 * (1.25 - p.r)) * p.sp * spin;
        const rad = R * (0.14 + 0.86 * p.r) * grow
                  + Math.sin(t * p.wf + p.ph) * R * 0.055;
        // Tilted disc (squashed y) + precession + gentle out-of-plane float.
        const x = Math.cos(ang) * rad;
        const y = Math.sin(ang) * rad * 0.6;
        const px = cx + x * cp - y * sp_;
        const py = cy + x * sp_ + y * cp
                 + Math.sin(t * 0.8 + p.ph * 2) * R * 0.05 * (1 + p.lift);
        const tw = 0.68 + 0.32 * Math.sin(t * (1.3 + p.wf) + p.ph * 3);
        const alpha = (0.12 + (1 - p.r) * 0.36) * (0.7 + level * 0.55) * tw
                    * (isDark ? 1 : 0.72);
        const d = R * (0.06 + 0.19 * p.sz * (1.15 - p.r * 0.6)) * (1 + level * 0.15);
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.drawImage(p.mix < 0.62 ? spriteA : spriteB, px - d / 2, py - d / 2, d, d);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
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
