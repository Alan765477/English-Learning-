// Vocabulary book + simple study record. Words are saved locally with an
// optional Chinese gloss (auto-filled via the AI translator when available).
// Review mode is a tap-to-reveal flashcard; study activity feeds a daily
// streak counter.
const Vocab = {
  reviewIdx: 0,
  revealed: false,

  list() {
    try { return JSON.parse(localStorage.getItem('els_vocab') || '[]'); } catch { return []; }
  },
  save(list) { try { localStorage.setItem('els_vocab', JSON.stringify(list)); } catch {} },

  init() {
    document.getElementById('vocab-add').onclick = () => this.add();
    document.getElementById('vocab-word').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.add();
    });
    document.getElementById('vocab-review').onclick = () => this.startReview();
    document.getElementById('vocab-card').onclick = () => this.flip();
    document.getElementById('vocab-known').onclick = () => this.next(true);
    document.getElementById('vocab-again').onclick = () => this.next(false);
    this.render();
  },

  // Public helper so other modules (e.g. listening word-tap) can stash a word.
  addWord(word, zh = '') {
    word = (word || '').trim();
    if (!word) return;
    const list = this.list();
    if (list.some(x => x.w.toLowerCase() === word.toLowerCase())) return;
    list.unshift({ w: word, zh, ts: Date.now() });
    this.save(list);
    this.render();
  },

  async add() {
    const input = document.getElementById('vocab-word');
    const word = input.value.trim();
    if (!word) return;
    input.value = '';
    this.addWord(word);
    // Try to auto-translate the gloss.
    if (AI.configured()) {
      try {
        const zh = await AI.translate(word);
        const list = this.list();
        const item = list.find(x => x.w.toLowerCase() === word.toLowerCase());
        if (item && !item.zh) { item.zh = zh; this.save(list); this.render(); }
      } catch {}
    }
  },

  remove(i) {
    const list = this.list();
    list.splice(i, 1);
    this.save(list);
    this.render();
  },

  render() {
    const list = this.list();
    document.getElementById('vocab-count').textContent = list.length;
    const el = document.getElementById('vocab-list');
    if (!list.length) {
      el.innerHTML = '<p class="hint">还没有生词。在上面输入单词或短语添加，会自动翻译。</p>';
      return;
    }
    el.innerHTML = list.map((x, i) => `
      <div class="vocab-item">
        <div>
          <div class="vocab-w">${x.w} <span class="speak" data-say="${encodeURIComponent(x.w)}">🔊</span></div>
          <div class="vocab-zh">${x.zh || ''}</div>
        </div>
        <button class="vocab-del" data-i="${i}">删除</button>
      </div>`).join('');
    el.querySelectorAll('.speak').forEach(s => {
      s.onclick = () => Speech.speak(decodeURIComponent(s.dataset.say), 0.9);
    });
    el.querySelectorAll('.vocab-del').forEach(b => {
      b.onclick = () => this.remove(+b.dataset.i);
    });
  },

  // ---- Flashcard review ----
  startReview() {
    if (!this.list().length) { return; }
    this.reviewIdx = 0;
    this.revealed = false;
    document.getElementById('vocab-browse').classList.add('hidden');
    document.getElementById('vocab-reviewer').classList.remove('hidden');
    this.showCard();
  },

  endReview() {
    document.getElementById('vocab-reviewer').classList.add('hidden');
    document.getElementById('vocab-browse').classList.remove('hidden');
    this.recordStudy();
    this.render();
  },

  showCard() {
    const list = this.list();
    if (this.reviewIdx >= list.length) { this.endReview(); return; }
    const x = list[this.reviewIdx];
    this.revealed = false;
    document.getElementById('vocab-card-w').textContent = x.w;
    document.getElementById('vocab-card-zh').textContent = x.zh || '（点卡片显示释义）';
    document.getElementById('vocab-card-zh').classList.add('hidden-text');
    document.getElementById('vocab-card-progress').textContent = `${this.reviewIdx + 1} / ${list.length}`;
    Speech.speak(x.w, 0.9);
  },

  flip() {
    this.revealed = !this.revealed;
    document.getElementById('vocab-card-zh').classList.toggle('hidden-text', !this.revealed);
  },

  next() {
    this.reviewIdx++;
    this.showCard();
  },

  // ---- Study record (daily streak) ----
  todayKey() { return new Date().toISOString().slice(0, 10); },

  recordStudy() {
    let rec;
    try { rec = JSON.parse(localStorage.getItem('els_study') || '{}'); } catch { rec = {}; }
    const today = this.todayKey();
    if (rec.last === today) return;
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    rec.streak = (rec.last === yest) ? (rec.streak || 0) + 1 : 1;
    rec.last = today;
    try { localStorage.setItem('els_study', JSON.stringify(rec)); } catch {}
  },

  streak() {
    let rec;
    try { rec = JSON.parse(localStorage.getItem('els_study') || '{}'); } catch { rec = {}; }
    if (!rec.last) return 0;
    const today = this.todayKey();
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    return (rec.last === today || rec.last === yest) ? (rec.streak || 0) : 0;
  },
};

// Top-level `const` in classic scripts does not become a window property;
// attach explicitly so cross-module `window.Vocab` checks work.
window.Vocab = Vocab;
