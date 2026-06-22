// Listening trainer: sentence-by-sentence playback with toggleable
// English / IPA / Chinese subtitles and adjustable speed.
const Listening = {
  lessonIdx: 0,
  i: 0,

  init() {
    const sel = document.getElementById('listen-lesson');
    sel.innerHTML = LESSONS.map((l, idx) => `<option value="${idx}">${l.title}（${l.level}）</option>`).join('');
    sel.onchange = () => { this.lessonIdx = +sel.value; this.i = 0; this.render(); };

    const show = Store.get('show');
    this._setChip('toggle-en', show.en);
    this._setChip('toggle-ipa', show.ipa);
    this._setChip('toggle-zh', show.zh);
    document.getElementById('toggle-en').onclick = () => this._toggle('en', 'toggle-en');
    document.getElementById('toggle-ipa').onclick = () => this._toggle('ipa', 'toggle-ipa');
    document.getElementById('toggle-zh').onclick = () => this._toggle('zh', 'toggle-zh');

    const rate = document.getElementById('listen-rate');
    rate.value = Store.get('listenRate');
    document.getElementById('listen-rate-val').textContent = (+rate.value).toFixed(2) + 'x';
    rate.oninput = () => {
      document.getElementById('listen-rate-val').textContent = (+rate.value).toFixed(2) + 'x';
      Store.set('listenRate', +rate.value);
    };

    document.getElementById('listen-play').onclick = () => this.play();
    document.getElementById('listen-prev').onclick = () => this.move(-1);
    document.getElementById('listen-next').onclick = () => this.move(1);
    this.render();
  },

  _setChip(id, on) { document.getElementById(id).classList.toggle('on', !!on); },
  _toggle(key, id) {
    const show = Store.get('show');
    show[key] = !show[key];
    Store.set('show', show);
    this._setChip(id, show[key]);
    this.render();
  },

  cur() { return LESSONS[this.lessonIdx].sentences[this.i]; },

  render() {
    const lesson = LESSONS[this.lessonIdx];
    const s = this.cur();
    const show = Store.get('show');
    document.getElementById('listen-progress').textContent = `${this.i + 1} / ${lesson.sentences.length}`;
    const enEl = document.getElementById('listen-en');
    enEl.innerHTML = show.en ? this._wordify(s.en) : '••• ••• •••';
    enEl.style.color = show.en ? '' : 'var(--text-dim)';
    if (show.en) this._bindWords(enEl);
    const ipaEl = document.getElementById('listen-ipa');
    ipaEl.textContent = show.ipa ? s.ipa : '';
    ipaEl.classList.toggle('hidden', !show.ipa);
    const zhEl = document.getElementById('listen-zh');
    zhEl.textContent = show.zh ? s.zh : '';
    zhEl.classList.toggle('hidden', !show.zh);
    document.getElementById('listen-hint').classList.toggle('hidden', show.en || show.zh);
  },

  _wordify(text) {
    return text.split(/(\s+)/).map(tok =>
      /\S/.test(tok) ? `<span class="word">${tok}</span>` : tok
    ).join('');
  },

  _bindWords(el) {
    el.querySelectorAll('.word').forEach(w => {
      w.onclick = () => Speech.speak(w.textContent.replace(/[^A-Za-z'-]/g, ''), 0.9);
    });
  },

  play() {
    const p = Speech.speak(this.cur().en, Store.get('listenRate'));
    // Drive the waveform from the real audio when Azure is playing; otherwise
    // fall back to the stylized CSS animation.
    const live = (window.Azure && Azure.ttsConfigured()) ? ((n) => Azure.levels(n)) : null;
    if (window.Wave) Wave.run(document.getElementById('listen-wave'), p, live);
  },

  move(d) {
    const n = LESSONS[this.lessonIdx].sentences.length;
    this.i = (this.i + d + n) % n;
    this.render();
    this.play();
  },
};
