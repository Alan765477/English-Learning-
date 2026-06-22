// "Voice orb" driver. The orb itself is pure CSS (GPU-accelerated, reliable on
// mobile). This just updates a single CSS variable (--lvl, 0..1) each frame so
// the orb scales/pulses with the audio level. Very cheap — no canvas.
const Orb = {
  mount(el, levelFn) {
    if (!el || el._orb) return;
    el._orb = true;
    const lvFn = levelFn || (() => 0);
    let level = 0;
    function tick() {
      // Skip when the orb isn't on screen (other tab / hidden).
      if (el.offsetParent === null || document.hidden) { requestAnimationFrame(tick); return; }
      const target = Math.max(0, Math.min(1, lvFn() || 0));
      level += (target - level) * 0.2;
      el.style.setProperty('--lvl', level.toFixed(3));
      requestAnimationFrame(tick);
    }
    tick();
  },
};
window.Orb = Orb;
