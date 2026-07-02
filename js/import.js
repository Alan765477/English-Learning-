// Lesson importer: paste any English text → auto-split into sentences →
// (when AI is connected) batch-translate + add approximate IPA → saved as a
// custom lesson in localStorage. Custom lessons work in all three practice
// modes and can be deleted from the lesson sheet.
const Importer = {
  KEY: 'els_custom_lessons',

  list() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; }
  },
  save(list) { try { localStorage.setItem(this.KEY, JSON.stringify(list)); } catch {} },
  remove(id) { this.save(this.list().filter(x => x.id !== id)); },

  init() {
    document.getElementById('import-open').onclick = () => {
      if (window.Sheet) Sheet.open('sheet-import');
    };
    document.getElementById('import-go').onclick = () => this.generate();
  },

  // Split prose into sentences (max 60 so one import stays practical).
  split(text) {
    const m = text.replace(/\s+/g, ' ')
      .match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g);
    return (m || []).map(s => s.trim()).filter(s => s.length > 1).slice(0, 60);
  },

  async generate() {
    const titleEl = document.getElementById('import-title');
    const textEl = document.getElementById('import-text');
    const status = document.getElementById('import-status');
    const btn = document.getElementById('import-go');
    const text = textEl.value.trim();
    if (!text) { status.textContent = '先把英文课文粘贴进来。'; return; }
    const sents = this.split(text);
    if (!sents.length) { status.textContent = '没有识别出英文句子。'; return; }

    btn.disabled = true;
    const sentences = sents.map(en => ({ en, ipa: '', zh: '' }));
    try {
      if (window.AI && AI.configured()) {
        // Translate + annotate in batches; a failed batch keeps its English.
        for (let i = 0; i < sents.length; i += 10) {
          status.textContent = `翻译与注音中… ${Math.min(i + 10, sents.length)} / ${sents.length} 句`;
          try {
            const ann = await AI.annotate(sents.slice(i, i + 10));
            ann.forEach((a, k) => {
              if (!sentences[i + k]) return;
              sentences[i + k].zh = (a && a.zh) || '';
              sentences[i + k].ipa = (a && a.ipa) || '';
            });
          } catch { /* keep going without gloss for this batch */ }
        }
      }
      const title = titleEl.value.trim() || '我的课文';
      const lesson = {
        id: 'custom-' + Date.now(),
        title: '自定义 · ' + title,
        level: '自定义',
        custom: true,
        sentences,
      };
      const all = this.list();
      all.push(lesson);
      this.save(all);
      titleEl.value = ''; textEl.value = ''; status.textContent = '';
      if (window.Practice) { Practice.buildLessonSheet(); Practice.selectLesson(lesson.id); }
      if (window.Sheet) Sheet.close();
      if (window.toast) toast(`已生成「${lesson.title}」（${sentences.length} 句）` +
        (AI.configured() ? '' : '。连接 AI 外教后导入可自动翻译注音。'));
    } finally {
      btn.disabled = false;
    }
  },
};

// Top-level `const` in classic scripts does not become a window property;
// attach explicitly so cross-module `window.Importer` checks work.
window.Importer = Importer;
