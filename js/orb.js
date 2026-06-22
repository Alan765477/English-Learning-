// Particle-sphere "voice orb": a rotating Fibonacci sphere of dots that gently
// breathes and pulses with an audio level. Pure canvas 2D — lightweight, no deps.
// Gives the app an "AI" centerpiece instead of empty space.
const Orb = {
  mount(canvas, levelFn) {
    if (!canvas || canvas._orb) return;
    canvas._orb = true;
    const ctx = canvas.getContext('2d');
    const DPR = Math.min(window.devicePixelRatio || 1, 1.5);

    // Evenly distribute points on a sphere (Fibonacci spiral).
    const N = 300;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * 2.3999632; // golden angle
      pts.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
    }

    let W, H, cx, cy, R;
    function resize() {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
      canvas.width = Math.round(w * DPR);
      canvas.height = Math.round(h * DPR);
      W = canvas.width; H = canvas.height; cx = W / 2; cy = H / 2;
      R = Math.min(W, H) * 0.34;
    }
    resize();
    window.addEventListener('resize', resize);

    // Depth 0..1 → blue (#0A84FF) ... indigo (#5E5CE6)
    function col(d) {
      const r = (10 + 84 * d) | 0;
      const g = (132 - 40 * d) | 0;
      const b = (255 - 25 * d) | 0;
      return r + ',' + g + ',' + b;
    }

    let t = 0, rotY = 0, level = 0, raf = 0;
    const lvFn = levelFn || (() => 0);
    function frame() {
      // Skip the heavy draw loop when the orb isn't on screen (other tab).
      if (canvas.offsetParent === null || document.hidden) { raf = requestAnimationFrame(frame); return; }
      t += 0.008;
      rotY += 0.0045;
      const target = Math.max(0, Math.min(1, lvFn() || 0));
      level += (target - level) * 0.18;
      const rotX = Math.sin(t * 0.45) * 0.32;
      const breathe = 1 + Math.sin(t * 1.6) * 0.025;
      const scale = breathe * (1 + level * 0.45);
      const cy_ = Math.cos(rotY), sy_ = Math.sin(rotY), cx_ = Math.cos(rotX), sx_ = Math.sin(rotX);
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const x1 = p[0] * cy_ - p[2] * sy_, z1 = p[0] * sy_ + p[2] * cy_;
        const y1 = p[1] * cx_ - z1 * sx_, z2 = p[1] * sx_ + z1 * cx_;
        const depth = (z2 + 1) / 2;            // 0 (back) .. 1 (front)
        const rr = R * scale;
        const px = cx + x1 * rr, py = cy + y1 * rr;
        const size = (0.5 + depth * 1.9) * DPR;
        const alpha = 0.12 + depth * 0.82;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + col(depth) + ',' + alpha.toFixed(2) + ')';
        ctx.arc(px, py, size, 0, 6.2832);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    frame();
    canvas._stop = () => { if (raf) cancelAnimationFrame(raf); };
  },
};
window.Orb = Orb;
