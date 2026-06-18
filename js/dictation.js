// Dictation trainer: play a sentence, the user types what they hear,
// then we diff word-by-word against the original.
const Dictation = {
  lessonIdx: 0,
  i: 0,

  init() {
    const sel = document.getElementById('dict-lesson');
    sel.innerHTML = LESSONS.map((l, idx) => `<option value="${idx}">${l.title}（${l.level}）</option>`).join('');
    sel.onchange = () => { this.lessonIdx = +sel.value; this.i = 0; this.render(); };

    document.getElementById('dict-play').onclick = () => Speech.speak(this.cur().en, 0.9);
    document.getElementById('dict-check').onclick = () => this.check();
    document.getElementById('dict-prev').onclick = () => this.move(-1);
    document.getElementById('dict-next').onclick = () => this.move(1);
    this.render();
  },

  cur() { return LESSONS[this.lessonIdx].sentences[this.i]; },

  render() {
    const lesson = LESSONS[this.lessonIdx];
    document.getElementById('dict-progress').textContent = `${this.i + 1} / ${lesson.sentences.length}`;
    document.getElementById('dict-result').innerHTML = '<span style="color:var(--text-dim)">点「再听一遍」开始</span>';
    document.getElementById('dict-input').value = '';
  },

  move(d) {
    const n = LESSONS[this.lessonIdx].sentences.length;
    this.i = (this.i + d + n) % n;
    this.render();
    Speech.speak(this.cur().en, 0.9);
  },

  check() {
    const target = this.cur().en;
    const typed = document.getElementById('dict-input').value;
    document.getElementById('dict-result').innerHTML = this.diff(target, typed);
  },

  // Word-level diff: mark correct words green, show the full correct sentence.
  diff(target, typed) {
    const clean = (s) => s.toLowerCase().replace(/[^a-z0-9'\s]/g, '');
    const typedWords = new Set(clean(typed).split(/\s+/).filter(Boolean));
    const targetTokens = target.split(/(\s+)/);
    let correct = 0, total = 0;
    const html = targetTokens.map(tok => {
      if (!/\S/.test(tok)) return tok;
      total++;
      const key = clean(tok);
      const ok = typedWords.has(key);
      if (ok) correct++;
      return `<span class="${ok ? 'ok' : 'wrong'}">${tok}</span>`;
    }).join('');
    const pct = total ? Math.round((correct / total) * 100) : 0;
    return `<div style="margin-bottom:8px;font-size:15px;color:var(--text-dim)">正确 ${correct}/${total}（${pct}%）</div>${html}`;
  },
};
