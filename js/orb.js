// "Voice orb": a hollow sphere of grey dots (point cloud) that rotates in 3D and
// pulses with the audio level. Canvas 2D. Robust sizing via ResizeObserver so it
// renders correctly even though it's mounted while the AI tab is hidden.
const Orb = {
  mount(canvas, levelFn) {
    if (!canvas || canvas._orb) return;
    canvas._orb = true;
    const ctx = canvas.getContext('2d');
    const lvFn = levelFn || (() => 0);

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

    let t = 0, rotY = 0, level = 0;
    function frame() {
      requestAnimationFrame(frame);
      if (canvas.offsetParent === null || document.hidden) return; // off-screen
      if (!W || !H) { resize(); if (!W || !H) return; }
      t += 0.008; rotY += 0.0042;
      const target = Math.max(0, Math.min(1, lvFn() || 0));
      level += (target - level) * 0.18;
      const rotX = Math.sin(t * 0.4) * 0.3;
      const scale = (1 + Math.sin(t * 1.5) * 0.02) * (1 + level * 0.34);
      const cyy = Math.cos(rotY), syy = Math.sin(rotY), cxx = Math.cos(rotX), sxx = Math.sin(rotX);
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const x1 = p[0] * cyy - p[2] * syy, z1 = p[0] * syy + p[2] * cyy;
        const y1 = p[1] * cxx - z1 * sxx, z2 = p[1] * sxx + z1 * cxx;
        const depth = (z2 + 1) / 2;                 // 0 back .. 1 front
        const rr = R * scale;
        const px = cx + x1 * rr, py = cy + y1 * rr;
        const size = (0.5 + depth * 1.7) * DPR;
        const alpha = 0.1 + depth * 0.5;
        // Grey dots; a faint blue tint as they come forward.
        const b = 140 + Math.round(depth * 60);
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + (118 + ((b - 140) * 0.2 | 0)) + ',124,' + b + ',' + alpha.toFixed(2) + ')';
        ctx.arc(px, py, size, 0, 6.2832);
        ctx.fill();
      }
    }
    frame();
  },
};
window.Orb = Orb;
