// Video learning: paste a YouTube or Bilibili link, then study with
// playback-speed control and A–B sentence looping. YouTube uses the
// IFrame Player API (full JS control); Bilibili uses a basic embed.
const Video = {
  source: 'youtube',
  player: null,      // YT player instance
  ytReady: false,
  ytQueue: null,     // videoId waiting for API to load
  loopA: null,
  loopB: null,
  looping: false,
  timer: null,

  init() {
    document.querySelectorAll('.source-toggle .chip').forEach(btn => {
      btn.onclick = () => this.setSource(btn.dataset.src, btn);
    });
    document.getElementById('video-load').onclick = () => this.loadFromInput();
    document.getElementById('video-url').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.loadFromInput();
    });
    document.querySelectorAll('#video-rates .chip').forEach(btn => {
      btn.onclick = () => this.setRate(+btn.dataset.rate, btn);
    });
    document.getElementById('video-back5').onclick = () => this.seekBy(-5);
    document.getElementById('video-mark-a').onclick = () => this.mark('A');
    document.getElementById('video-mark-b').onclick = () => this.mark('B');
    document.getElementById('video-loop').onclick = () => this.toggleLoop();
    this.renderRecent();
    this.updateHint();
  },

  setSource(src, btn) {
    this.source = src;
    document.querySelectorAll('.source-toggle .chip').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    this.updateHint();
  },

  updateHint() {
    document.getElementById('video-hint').innerHTML = this.source === 'youtube'
      ? '支持变速、退5秒、A–B 句子复读。点视频右下角 CC 可开英文字幕。<br>例：youtu.be/xxxx 或 youtube.com/watch?v=xxxx'
      : 'B站用官方播放器嵌入（变速/复读请用其自带控制条）。<br>例：bilibili.com/video/BVxxxx';
  },

  parseId(url) {
    url = url.trim();
    if (this.source === 'youtube') {
      const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
      return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(url) ? url : null);
    } else {
      const m = url.match(/(BV[0-9A-Za-z]{10})/);
      return m ? m[1] : null;
    }
  },

  loadFromInput() {
    const url = document.getElementById('video-url').value;
    const id = this.parseId(url);
    if (!id) {
      document.getElementById('video-status').textContent =
        this.source === 'youtube' ? '没识别出 YouTube 链接，请检查。'
        : '没识别出 B站 BV 号（短链 b23.tv 请先在浏览器打开拿到完整链接）。';
      return;
    }
    document.getElementById('video-status').textContent = '';
    this.saveRecent({ src: this.source, id, url });
    this.open(this.source, id);
  },

  open(src, id) {
    this.source = src;
    const wrap = document.getElementById('video-wrap');
    this.stopLoop();
    if (src === 'bilibili') {
      this.player = null;
      document.getElementById('video-controls').classList.add('hidden');
      wrap.innerHTML = `<iframe src="https://player.bilibili.com/player.html?bvid=${id}&high_quality=1&danmaku=0"
        scrolling="no" frameborder="0" allowfullscreen="true"></iframe>`;
    } else {
      document.getElementById('video-controls').classList.remove('hidden');
      wrap.innerHTML = '<div id="yt-player"></div>';
      this.mountYouTube(id);
    }
  },

  mountYouTube(id) {
    const create = () => {
      this.player = new YT.Player('yt-player', {
        videoId: id,
        playerVars: { cc_load_policy: 1, modestbranding: 1, rel: 0, playsinline: 1 },
      });
    };
    if (window.YT && window.YT.Player) { create(); return; }
    // Load the IFrame API once, then create the player.
    this.ytQueue = create;
    if (!document.getElementById('yt-api')) {
      const tag = document.createElement('script');
      tag.id = 'yt-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
    window.onYouTubeIframeAPIReady = () => { if (this.ytQueue) { this.ytQueue(); this.ytQueue = null; } };
  },

  setRate(rate, btn) {
    document.querySelectorAll('#video-rates .chip').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    if (this.player && this.player.setPlaybackRate) this.player.setPlaybackRate(rate);
  },

  seekBy(sec) {
    if (!this.player || !this.player.getCurrentTime) return;
    this.player.seekTo(Math.max(0, this.player.getCurrentTime() + sec), true);
  },

  mark(which) {
    if (!this.player || !this.player.getCurrentTime) return;
    const t = this.player.getCurrentTime();
    if (which === 'A') this.loopA = t; else this.loopB = t;
    this.showLoopStatus();
  },

  showLoopStatus() {
    const f = (t) => t == null ? '—' : t.toFixed(1) + 's';
    document.getElementById('video-status').textContent =
      `A=${f(this.loopA)}  B=${f(this.loopB)}` + (this.looping ? '（复读中）' : '');
  },

  toggleLoop() {
    if (this.looping) { this.stopLoop(); return; }
    if (this.loopA == null || this.loopB == null || this.loopB <= this.loopA) {
      document.getElementById('video-status').textContent = '请先设好 A 点和 B 点（B 要晚于 A）。';
      return;
    }
    this.looping = true;
    document.getElementById('video-loop').classList.add('recording');
    this.player.seekTo(this.loopA, true);
    this.player.playVideo();
    this.timer = setInterval(() => {
      if (!this.player || !this.player.getCurrentTime) return;
      if (this.player.getCurrentTime() >= this.loopB) this.player.seekTo(this.loopA, true);
    }, 200);
    this.showLoopStatus();
  },

  stopLoop() {
    this.looping = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const btn = document.getElementById('video-loop');
    if (btn) btn.classList.remove('recording');
    this.showLoopStatus();
  },

  pause() {
    if (this.player && this.player.pauseVideo) try { this.player.pauseVideo(); } catch {}
  },

  // Recent links (most recent first, max 6).
  saveRecent(item) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('els_recent') || '[]'); } catch {}
    list = list.filter(x => !(x.src === item.src && x.id === item.id));
    list.unshift(item);
    list = list.slice(0, 6);
    try { localStorage.setItem('els_recent', JSON.stringify(list)); } catch {}
    this.renderRecent();
  },

  renderRecent() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('els_recent') || '[]'); } catch {}
    const el = document.getElementById('video-recent');
    el.innerHTML = list.map((x, i) =>
      `<button class="chip recent" data-i="${i}">${x.src === 'youtube' ? '▶' : 'B'} ${x.id}</button>`
    ).join('');
    el.querySelectorAll('.recent').forEach(btn => {
      btn.onclick = () => { const x = list[+btn.dataset.i]; this.open(x.src, x.id); };
    });
  },
};
