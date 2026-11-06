// FreeTune Web: search and play any song on YouTube, with Liked Songs and playlists kept in
// this browser. Songs play in YouTube's official player. Downloads and your Spotify library
// are in the FreeTune app, so those buttons send you to it.
(function () {
  'use strict';
  const Y = window.FreeYT;
  const $ = (s, r = document) => r.querySelector(s);
  const APP_URL = '../index.html#get-freetune';
  const DATA = 'freetune.web';

  // ── tiny DOM helper ──
  function h(tag, attrs, ...kids) {
    const [name, ...cls] = tag.split('.');
    const el = document.createElement(name || 'div');
    if (cls.length) el.className = cls.join(' ');
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      kids.unshift(attrs);
      attrs = null;
    }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" class="fill"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.2-8.6C1.4 8.5 3.2 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5c3.4 0 5.2 3.5 3.8 6.4C19 15.6 12 20 12 20z"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" class="fill"/><circle cx="12" cy="12" r="1.6" class="fill"/><circle cx="19" cy="12" r="1.6" class="fill"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24"><path d="M4 7h3c4 0 6 10 10 10h3M4 17h3c1.6 0 2.8-1.6 4-3.5M13 9.5C14.2 7.6 15.4 7 17 7h3M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
    download: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v8m0 0-3.5-3.5M12 15.5l3.5-3.5"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M5 12h12M13 6l6 6-6 6"/></svg>',
    queue: '<svg viewBox="0 0 24 24"><path d="M4 6h12M4 11h12M4 16h7M17 14v6l4-3z"/></svg>',
    yt: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3.5"/><path d="M10.5 9.5v5l4-2.5z" class="fill"/></svg>',
    pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  };
  const icon = (n) => h('span', { style: 'display:contents', html: ICON[n] });

  // ── saved in this browser ──
  const db = Object.assign({ liked: [], playlists: [], recent: [], volume: 80, shuffle: false, repeat: 'off' }, Y.store.get(DATA, {}));
  let saveTimer = null;
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!Y.store.set(DATA, db)) toast('Your browser’s storage is full, so changes weren’t saved.', true);
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 150);
  }
  // Leaving or reloading the page saves straight away.
  window.addEventListener('pagehide', () => { if (saveTimer) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) flush(); });
  const likedIds = () => new Set(db.liked.map((t) => t.id));
  const isLiked = (t) => db.liked.some((x) => x.id === t.id);
  const slim = (t) => ({ id: t.id, name: t.name, artist: t.artist, image: t.image || '', durationMs: t.durationMs || 0 });
  const newId = () => Math.random().toString(36).slice(2, 10);

  // ── YouTube results → songs ──
  const NOISE = /\s*[\(\[](?:official\s*)?(?:music\s*)?(?:video|audio|lyric(?:s)?(?:\s*video)?|visuali[sz]er|hd|4k|mv|m\/v|audio\s*only|official)[^\)\]]*[\)\]]/gi;
  function toTrack(v) {
    const sn = v.snippet || {};
    let title = Y.decode(sn.title || '');
    let channel = Y.decode(sn.channelTitle || '').replace(/VEVO$/i, '').trim();
    let artist = channel;
    let name = title;
    if (/ - Topic$/.test(channel)) artist = channel.replace(/ - Topic$/, '');
    else {
      const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title);
      if (m) {
        artist = m[1];
        name = m[2];
      }
    }
    name = name.replace(NOISE, '').replace(/\s{2,}/g, ' ').trim() || title;
    const id = typeof v.id === 'string' ? v.id : v.id && v.id.videoId;
    return { id, name, artist, image: Y.thumb(sn, 'medium'), durationMs: v.contentDetails ? Y.isoSeconds(v.contentDetails.duration) * 1000 : 0 };
  }
  async function details(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await Y.call('videos', { part: 'snippet,contentDetails', id: ids.slice(i, i + 50).join(',') }, { maxAge: 7 * 864e5, persist: true });
      out.push(...(r.items || []));
    }
    return out;
  }
  async function searchSongs(q) {
    const r = await Y.call('search', { part: 'snippet', type: 'video', videoCategoryId: '10', videoEmbeddable: 'true', videoSyndicated: 'true', maxResults: '25', q }, { maxAge: 12 * 3600e3, persist: true });
    const ids = (r.items || []).map((x) => x.id && x.id.videoId).filter(Boolean);
    if (!ids.length) return [];
    const byId = new Map((await details(ids)).map((v) => [v.id, v]));
    return ids.map((id) => byId.get(id)).filter(Boolean).map(toTrack).filter((t) => t.durationMs === 0 || t.durationMs > 60000);
  }
  async function songFromLink(link) {
    const id = Y.videoIdFrom(link);
    if (!id) throw new Error('That isn’t a YouTube or YouTube Music link.');
    if (Y.key.get()) {
      const v = (await details([id]))[0];
      if (!v) throw new Error('YouTube couldn’t find that video.');
      return toTrack(v);
    }
    try {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
      const j = await r.json();
      return toTrack({ id, snippet: { title: j.title, channelTitle: j.author_name, thumbnails: { medium: { url: j.thumbnail_url } } } });
    } catch {
      return { id, name: 'YouTube video', artist: id, image: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, durationMs: 0 };
    }
  }

  // ── the player (YouTube's official one) ──
  const queue = { tracks: [], order: [], pos: -1, source: '', name: '' };
  let yt = null;
  let ytReady = null;
  let skipStreak = 0;
  let tick = null;
  function ensurePlayer() {
    if (ytReady) return ytReady;
    document.body.classList.add('has-video');
    ytReady = Y.playerApi().then(
      (YT) =>
        new Promise((resolve) => {
          yt = new YT.Player('yt', {
            host: 'https://www.youtube-nocookie.com',
            width: '100%',
            height: '100%',
            playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, origin: location.origin },
            events: {
              onReady: () => {
                yt.setVolume(db.volume);
                resolve(yt);
              },
              onStateChange: (e) => onState(e.data),
              onError: (e) => onError(e.data),
            },
          });
        })
    );
    ytReady.catch((e) => {
      ytReady = null;
      toast(e.message, true);
    });
    return ytReady;
  }
  const current = () => (queue.pos >= 0 ? queue.tracks[queue.order[queue.pos]] : null);
  function onState(s) {
    if (s === 1) {
      document.body.classList.add('playing');
      skipStreak = 0;
      const t = current();
      if (t && (!t.durationMs || t.durationMs < 1000)) {
        const d = yt.getDuration();
        if (d) t.durationMs = d * 1000;
      }
      startTick();
    } else if (s === 2 || s === -1 || s === 5) {
      document.body.classList.remove('playing');
    } else if (s === 0) {
      document.body.classList.remove('playing');
      if (db.repeat === 'one') return play(queue.pos);
      next(true);
    }
  }
  function onError(code) {
    const t = current();
    toast(`${t ? `“${t.name}”: ` : ''}${Y.PLAYER_ERRORS[code] || 'YouTube couldn’t play this.'} Skipped.`, true);
    skipStreak++;
    if (skipStreak >= 3) {
      skipStreak = 0;
      document.body.classList.remove('playing');
      return toast('Several songs in a row wouldn’t play, so playback stopped.', true);
    }
    next(true);
  }
  function startTick() {
    clearInterval(tick);
    tick = setInterval(() => {
      if (!yt || !yt.getCurrentTime) return;
      const cur = yt.getCurrentTime() || 0;
      const dur = yt.getDuration() || 0;
      if (!seeking) {
        $('#t-cur').textContent = Y.fmtTime(cur);
        $('#t-dur').textContent = Y.fmtTime(dur);
        const v = dur ? Math.round((cur / dur) * 1000) : 0;
        $('#seek').value = v;
        $('#seek').style.setProperty('--pct', v / 10 + '%');
      }
    }, 500);
  }
  function makeOrder(start) {
    const n = queue.tracks.length;
    const order = [...Array(n).keys()];
    if (db.shuffle) {
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const k = order.indexOf(start);
      order.splice(k, 1);
      order.unshift(start);
      return { order, pos: 0 };
    }
    return { order, pos: start };
  }
  async function playList(tracks, index, source, name) {
    if (!tracks.length) return;
    queue.tracks = tracks.slice();
    const o = makeOrder(index);
    queue.order = o.order;
    queue.source = source || '';
    queue.name = name || '';
    await play(o.pos);
  }
  async function play(pos) {
    if (pos < 0 || pos >= queue.order.length) return;
    queue.pos = pos;
    const t = current();
    showNowPlaying(t);
    try {
      const p = await ensurePlayer();
      if (current() !== t) return;
      p.loadVideoById(t.id);
    } catch {}
    db.recent = [slim(t), ...db.recent.filter((x) => x.id !== t.id)].slice(0, 30);
    save();
  }
  function next(auto) {
    if (queue.pos + 1 < queue.order.length) return play(queue.pos + 1);
    if (db.repeat === 'all' && queue.order.length) return play(0);
    if (auto) {
      document.body.classList.remove('playing');
      queue.pos = queue.order.length - 1;
    }
  }
  function prev() {
    if (yt && yt.getCurrentTime && yt.getCurrentTime() > 3) return yt.seekTo(0, true);
    if (queue.pos > 0) play(queue.pos - 1);
    else if (yt) yt.seekTo(0, true);
  }
  function toggle() {
    if (!current()) {
      const list = db.liked.length ? db.liked : db.recent;
      if (list.length) return playList(list, 0, db.liked.length ? 'liked' : 'recent', db.liked.length ? 'Liked Songs' : 'Recently played');
      return go('search');
    }
    if (!yt) return play(queue.pos);
    if (document.body.classList.contains('playing')) yt.pauseVideo();
    else yt.playVideo();
  }
  function playNext(t) {
    if (!current()) return playList([t], 0, '', '');
    queue.tracks.push(t);
    queue.order.splice(queue.pos + 1, 0, queue.tracks.length - 1);
    toast('Plays next');
  }
  function enqueue(t) {
    if (!current()) return playList([t], 0, '', '');
    queue.tracks.push(t);
    queue.order.push(queue.tracks.length - 1);
    toast('Added to queue');
  }

  function showNowPlaying(t) {
    $('#np-title').textContent = t.name;
    $('#np-artist').textContent = t.artist;
    if (t.image) $('#np-art').src = t.image;
    else $('#np-art').removeAttribute('src');
    $('#np-like').hidden = false;
    syncLike();
    document.title = `${t.name} – ${t.artist}`;
    $('#t-dur').textContent = t.durationMs ? Y.fmtTime(t.durationMs / 1000) : '0:00';
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: t.name, artist: t.artist, artwork: t.image ? [{ src: t.image, sizes: '320x180', type: 'image/jpeg' }] : [] });
      } catch {}
    }
    markCurrent();
  }
  function syncLike() {
    const t = current();
    const on = !!(t && isLiked(t));
    $('#np-like').setAttribute('aria-pressed', String(on));
    $('#np-like').setAttribute('aria-label', on ? 'Remove from Liked Songs' : 'Save to Liked Songs');
    document.querySelectorAll('.row .like').forEach((b) => b.setAttribute('aria-pressed', String(likedIds().has(b.dataset.id))));
  }
  function markCurrent() {
    const t = current();
    document.querySelectorAll('.row').forEach((r) => r.classList.toggle('current', !!t && r.dataset.id === t.id));
    document.querySelectorAll('.lib-item').forEach((a) => a.classList.toggle('playing', a.dataset.source === queue.source));
  }

  // ── liking and playlists ──
  function toggleLike(t) {
    if (isLiked(t)) {
      db.liked = db.liked.filter((x) => x.id !== t.id);
      toast('Removed from Liked Songs');
    } else {
      db.liked.unshift({ ...slim(t), addedAt: new Date().toISOString() });
      toast('Saved to Liked Songs');
    }
    save();
    syncLike();
    renderLibrary();
    if (route.name === 'liked') render(true);
  }
  function addTo(p, tracks) {
    let added = 0;
    for (const t of tracks) {
      if (p.tracks.some((x) => x.id === t.id)) continue;
      p.tracks.push({ ...slim(t), addedAt: new Date().toISOString() });
      added++;
    }
    save();
    renderLibrary();
    toast(added ? `Added to “${p.name}”` : `Already in “${p.name}”`);
    if (route.name === 'playlist' && route.arg === p.id) render(true);
  }
  async function newPlaylist(tracks) {
    const name = await ask({ title: 'New playlist', label: 'Name', value: `My playlist #${db.playlists.length + 1}`, confirm: 'Create' });
    if (!name) return null;
    const p = { id: newId(), name: name.slice(0, 100), tracks: [], createdAt: Date.now() };
    db.playlists.unshift(p);
    save();
    renderLibrary();
    if (tracks && tracks.length) addTo(p, tracks);
    else go('playlist/' + p.id);
    return p;
  }
  async function addLink(p) {
    const link = await ask({ title: 'Add a song from YouTube', body: 'Paste a YouTube or YouTube Music link.', label: 'YouTube link', placeholder: 'https://www.youtube.com/watch?v=…', confirm: 'Add song' });
    if (!link) return;
    try {
      const t = await songFromLink(link);
      if (p === 'liked') {
        if (isLiked(t)) return toast('Already in Liked Songs');
        toggleLike(t);
      } else addTo(p, [t]);
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ── menus, dialogs, toasts ──
  let toastTimer = null;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!err);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), err ? 5000 : 2400);
  }
  function openMenu(x, y, items) {
    const m = $('#menu');
    m.replaceChildren(
      ...items.filter(Boolean).map((it) =>
        it === '-'
          ? h('hr')
          : it.head
          ? h('div.mh', { text: it.head })
          : it.href
          ? h('a', { href: it.href, target: '_blank', rel: 'noopener', role: 'menuitem', onclick: closeMenu }, it.icon ? icon(it.icon) : null, h('span', { text: it.label }))
          : h('button', { role: 'menuitem', onclick: () => { if (!it.keep) closeMenu(); it.run(); } }, it.icon ? icon(it.icon) : null, h('span', { text: it.label }))
      )
    );
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    m.querySelector('button, a')?.focus();
  }
  function closeMenu() {
    $('#menu').hidden = true;
  }
  document.addEventListener('mousedown', (e) => { if (!$('#menu').contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  $('#main').addEventListener('scroll', closeMenu, { passive: true });

  function ask({ title, body, label, value = '', placeholder = '', confirm = 'OK' }) {
    const d = $('#dlg');
    return new Promise((resolve) => {
      const input = h('input', { id: 'dlg-input', 'aria-label': label, value, placeholder });
      const form = h('form', { method: 'dialog' },
        h('h2', { text: title }),
        body ? h('p', { text: body }) : null,
        input,
        h('div.dlg-actions',
          h('button.pill', { type: 'button', text: 'Cancel', onclick: () => d.close('') }),
          h('button.pill.primary', { type: 'submit', text: confirm })
        )
      );
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        d.close(input.value.trim());
      });
      d.replaceChildren(form);
      d.onclose = () => resolve(d.returnValue || '');
      d.returnValue = '';
      d.showModal();
      input.select();
    });
  }
  function confirmDlg({ title, body, confirm }) {
    const d = $('#dlg');
    return new Promise((resolve) => {
      d.replaceChildren(
        h('h2', { text: title }),
        h('p', { text: body }),
        h('div.dlg-actions',
          h('button.pill', { text: 'Cancel', onclick: () => d.close('') }),
          h('button.pill.primary', { text: confirm, onclick: () => d.close('yes') })
        )
      );
      d.onclose = () => resolve(d.returnValue === 'yes');
      d.returnValue = '';
      d.showModal();
    });
  }

  function trackMenu(t, x, y, ctx) {
    openMenu(x, y, [
      { icon: 'plus', label: 'Add to playlist', keep: true, run: () => addMenu([t], x, y) },
      ctx && ctx.remove ? { icon: 'trash', label: 'Remove from this playlist', run: ctx.remove } : null,
      { icon: 'heart', label: isLiked(t) ? 'Remove from Liked Songs' : 'Save to Liked Songs', run: () => toggleLike(t) },
      { icon: 'next', label: 'Play next', run: () => playNext(t) },
      { icon: 'queue', label: 'Add to queue', run: () => enqueue(t) },
      '-',
      { icon: 'download', label: 'Download (in the FreeTune app)', href: APP_URL },
      { icon: 'yt', label: 'Open on YouTube', href: `https://www.youtube.com/watch?v=${t.id}` },
    ]);
  }
  function addMenu(tracks, x, y) {
    openMenu(x, y, [
      { icon: 'plus', label: 'New playlist', run: () => newPlaylist(tracks) },
      db.playlists.length ? '-' : null,
      ...db.playlists.slice(0, 50).map((p) => ({ icon: 'note', label: p.name, run: () => addTo(p, tracks) })),
    ]);
  }

  // ── songs list ──
  function fmtAdded(iso) {
    const d = new Date(iso || 0);
    if (!iso || isNaN(d)) return '';
    const days = Math.floor((Date.now() - d) / 864e5);
    if (days < 1) return 'Today';
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    if (days < 30) { const w = Math.floor(days / 7); return `${w} week${w === 1 ? '' : 's'} ago`; }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function trackList(list, { source, name, dated = false, remove } = {}) {
    const liked = likedIds();
    const cur = current();
    return h(`div.tracks${dated ? '.with-date' : ''}`, { role: 'table', 'aria-label': name || 'Songs' },
      h('div.head', { role: 'row' }, h('span', { text: '#', style: 'text-align:right' }), h('span', { text: 'Title' }), dated ? h('span', { text: 'Date added' }) : null, h('span'), h('span', { text: '⏱', 'aria-label': 'Duration', style: 'text-align:right' }), h('span')),
      list.map((t, i) => {
        const row = h('div.row', { role: 'row', tabindex: '0', dataset: { id: t.id },
          ondblclick: () => playList(list, i, source, name),
          onkeydown: (e) => { if (e.key === 'Enter') playList(list, i, source, name); },
          oncontextmenu: (e) => { e.preventDefault(); trackMenu(t, e.clientX, e.clientY, remove ? { remove: () => remove(t) } : null); },
        },
          h('div.n', h('span.num', { text: String(i + 1) }), h('button.pb', { 'aria-label': `Play ${t.name}`, onclick: (e) => { e.stopPropagation(); playList(list, i, source, name); }, html: ICON.play })),
          h('div.main', { onclick: () => { if (matchMedia('(max-width: 760px)').matches) playList(list, i, source, name); } }, h('img', { src: t.image || '', alt: '', loading: 'lazy' }), h('div.tt', h('div.name', { text: t.name }), h('div.by', { text: t.artist }))),
          dated ? h('div.added', { text: fmtAdded(t.addedAt) }) : null,
          h('button.icon-btn.like', { 'aria-label': 'Save to Liked Songs', 'aria-pressed': String(liked.has(t.id)), dataset: { id: t.id }, onclick: (e) => { e.stopPropagation(); toggleLike(t); }, html: ICON.heart }),
          h('div.dur', { text: t.durationMs ? Y.fmtTime(t.durationMs / 1000) : '' }),
          h('button.icon-btn.more', { 'aria-label': `More options for ${t.name}`, onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); trackMenu(t, r.left - 200, r.bottom, remove ? { remove: () => remove(t) } : null); }, html: ICON.more })
        );
        if (cur && cur.id === t.id) row.classList.add('current');
        return row;
      })
    );
  }
  function coverEl(p, cls = 'cov') {
    if (p === 'liked') return h(`div.${cls}.liked`, { html: ICON.heart });
    const imgs = [...new Set(p.tracks.map((t) => t.image).filter(Boolean))].slice(0, 4);
    if (imgs.length >= 4) return h(`div.${cls}.mosaic`, imgs.map((src) => h('img', { src, alt: '' })));
    if (imgs.length) return h(`div.${cls}`, h('img', { src: imgs[0], alt: '' }));
    return h(`div.${cls}`, { html: ICON.note });
  }
  const downloadLink = () => h('a.act', { href: APP_URL, target: '_blank', rel: 'noopener', title: 'Downloads are in the FreeTune app', 'aria-label': 'Download (opens the FreeTune app page)', html: ICON.download });

  // ── library (sidebar and the phone's Library tab) ──
  function libItems() {
    return [
      h('a.lib-item', { href: '#liked', dataset: { source: 'liked' } }, coverEl('liked'), h('div', h('div.nm', { text: 'Liked Songs' }), h('div.sb', { text: `Playlist • ${db.liked.length} song${db.liked.length === 1 ? '' : 's'}` }))),
      ...db.playlists.map((p) => h('a.lib-item', { href: '#playlist/' + p.id, dataset: { source: 'pl:' + p.id } }, coverEl(p), h('div', h('div.nm', { text: p.name }), h('div.sb', { text: `Playlist • ${p.tracks.length} song${p.tracks.length === 1 ? '' : 's'}` })))),
    ];
  }
  function renderLibrary() {
    $('#lib-list').replaceChildren(...libItems());
    markNav();
    markCurrent();
  }
  $('#new-pl').onclick = () => newPlaylist();

  // ── views ──
  const route = { name: 'home', arg: '' };
  function go(hash) {
    if (location.hash === '#' + hash) render();
    else location.hash = hash;
  }
  function markNav() {
    const name = route.name === 'playlist' || route.name === 'liked' ? 'library' : route.name;
    document.querySelectorAll('[data-view]').forEach((a) => a.toggleAttribute('aria-current', a.dataset.view === name));
    document.querySelectorAll('[data-view]').forEach((a) => { if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page'); });
    const here = location.hash || '#home';
    document.querySelectorAll('.lib-item').forEach((a) => { if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }
  function setView(...nodes) {
    const v = h('div.view', nodes);
    $('#main').replaceChildren(v);
    return v;
  }
  function render(keepScroll) {
    const top = $('#main').scrollTop;
    const [name, arg] = (location.hash.slice(1) || 'home').split('/');
    route.name = name;
    route.arg = arg || '';
    closeMenu();
    ({ home: viewHome, search: viewSearch, liked: viewLiked, playlist: viewPlaylist, library: viewLibrary, settings: viewSettings }[name] || viewHome)(arg);
    markNav();
    if (keepScroll) $('#main').scrollTop = top;
    else $('#main').scrollTop = 0;
  }
  window.addEventListener('hashchange', () => render());

  function greeting() {
    const hr = new Date().getHours();
    return hr < 5 ? 'Good evening' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  }
  function viewHome() {
    const quick = [
      h('a.qtile', { href: '#liked' }, coverEl('liked'), h('span', { text: 'Liked Songs' })),
      ...db.playlists.slice(0, 7).map((p) => h('a.qtile', { href: '#playlist/' + p.id }, coverEl(p), h('span', { text: p.name }))),
    ];
    setView(
      h('h1', { text: greeting() }),
      h('div.quick', quick),
      h('div.banner',
        h('div', h('h2', { text: 'Want your Spotify playlists and Liked Songs?' }), h('p', { text: 'The FreeTune app shows your whole Spotify library with no ads, and downloads songs for when you’re offline.' })),
        h('a.pill.primary', { href: APP_URL, target: '_blank', rel: 'noopener', text: 'Get the app' })
      ),
      db.recent.length
        ? [h('h2', { text: 'Recently played' }), trackList(db.recent, { source: 'recent', name: 'Recently played' })]
        : h('div.empty', h('h2', { text: 'Play anything on YouTube' }), h('p', { text: 'Search for a song, artist or album. Like songs and make playlists; they’re saved in this browser.' }), h('a.pill.primary', { href: '#search', text: 'Search' }))
    );
  }

  let lastQuery = '';
  let lastResults = null;
  function viewSearch() {
    const input = h('input', { id: 'q', type: 'search', placeholder: 'What do you want to play?', 'aria-label': 'Search', value: lastQuery, autocomplete: 'off' });
    const out = h('div');
    const box = h('form.search-box', { role: 'search', onsubmit: (e) => { e.preventDefault(); run(input.value); } }, h('span', { html: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>' }), input);
    setView(h('h1', { text: 'Search' }), box, h('p.note', { text: 'Press Enter to search. Each search uses your YouTube key’s daily limit (about 100 a day), so results are remembered.' }), out);
    if (!Y.key.get()) out.append(keyNeeded());
    else if (lastResults) draw(lastResults);
    setTimeout(() => input.focus(), 0);
    async function run(q) {
      q = q.trim();
      if (!q) return;
      const id = Y.videoIdFrom(q);
      if (id) {
        try { const t = await songFromLink(q); draw([t]); } catch (e) { toast(e.message, true); }
        return;
      }
      if (!Y.key.get()) return out.replaceChildren(keyNeeded());
      lastQuery = q;
      out.replaceChildren(h('p.note', { text: 'Searching…' }));
      try {
        lastResults = await searchSongs(q);
        draw(lastResults);
      } catch (e) {
        out.replaceChildren(h('div.empty', h('h2', { text: 'Search didn’t work' }), h('p', { text: e.message }), e.code === 'badkey' || e.code === 'nokey' ? h('a.pill', { href: '#settings', text: 'Open Settings' }) : null));
      }
    }
    function draw(list) {
      out.replaceChildren(list.length ? trackList(list, { source: 'search', name: `Search: ${lastQuery}` }) : h('div.empty', h('h2', { text: 'No songs found' }), h('p', { text: 'Check the spelling, or try fewer words.' })));
    }
  }
  function keyNeeded() {
    return h('div.card',
      h('h2', { text: 'Add your YouTube key to search' }),
      h('p', { text: 'FreeTune Web searches YouTube with your own free key from Google, so there’s no shared limit. It takes about two minutes and stays in this browser.' }),
      h('a.pill.primary', { href: '#settings', text: 'Set it up' }),
      h('p.note', { text: 'You can still play songs by pasting a YouTube link into the search box.' })
    );
  }

  function collectionHeader({ title, meta, cover, tint, editable }) {
    const t = h('h1', { text: title });
    if (editable) { t.classList.add('edit'); t.title = 'Rename'; t.onclick = editable; }
    const hero = h('div.hero', cover, h('div', h('div.kind', { text: 'Playlist' }), t, h('div.meta', { text: meta })));
    hero.style.setProperty('--tint', tint);
    return hero;
  }
  const totalTime = (list) => {
    const ms = list.reduce((a, t) => a + (t.durationMs || 0), 0);
    if (!ms) return '';
    const m = Math.round(ms / 60000);
    return m >= 60 ? `, about ${Math.floor(m / 60)} hr ${m % 60} min` : `, ${m} min`;
  };
  function viewLiked() {
    const list = db.liked;
    setView(
      collectionHeader({ title: 'Liked Songs', meta: `${list.length} song${list.length === 1 ? '' : 's'}${totalTime(list)} • saved in this browser`, cover: coverEl('liked', 'cov.cover'), tint: '80 56 160' }),
      h('div.actions',
        h('button.big-play', { 'aria-label': 'Play', onclick: () => playList(list, 0, 'liked', 'Liked Songs'), html: ICON.play }),
        h('button.act', { 'aria-label': 'Shuffle play', title: 'Shuffle play', onclick: () => { setShuffle(true); playList(list, Math.floor(Math.random() * list.length), 'liked', 'Liked Songs'); }, html: ICON.shuffle }),
        downloadLink(),
        h('button.act.small', { title: 'Like a song from a YouTube link', 'aria-label': 'Like a song from a YouTube link', onclick: () => addLink('liked'), html: ICON.link })
      ),
      list.length ? trackList(list, { source: 'liked', name: 'Liked Songs', dated: true }) : h('div.empty', h('h2', { text: 'Songs you like will appear here' }), h('p', { text: 'Save songs with the heart button.' }), h('a.pill', { href: '#search', text: 'Find songs' }))
    );
  }
  function viewPlaylist(id) {
    const p = db.playlists.find((x) => x.id === id);
    if (!p) return setView(h('div.empty', h('h2', { text: 'This playlist doesn’t exist' }), h('p', { text: 'It may have been deleted, or it was made in another browser.' }), h('a.pill', { href: '#home', text: 'Go home' })));
    const source = 'pl:' + p.id;
    const remove = (t) => {
      p.tracks = p.tracks.filter((x) => x.id !== t.id);
      save();
      renderLibrary();
      render(true);
      toast(`Removed from “${p.name}”`);
    };
    const rename = async () => {
      const name = await ask({ title: 'Rename playlist', label: 'Name', value: p.name, confirm: 'Save' });
      if (!name) return;
      p.name = name.slice(0, 100);
      save();
      renderLibrary();
      render(true);
    };
    const more = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      openMenu(r.left, r.bottom + 4, [
        { icon: 'pencil', label: 'Rename', run: rename },
        { icon: 'link', label: 'Add a song from a YouTube link', run: () => addLink(p) },
        { icon: 'download', label: 'Download (in the FreeTune app)', href: APP_URL },
        '-',
        { icon: 'trash', label: 'Delete playlist', run: async () => {
          if (!(await confirmDlg({ title: 'Delete playlist?', body: `“${p.name}” will be deleted from this browser.`, confirm: 'Delete' }))) return;
          db.playlists = db.playlists.filter((x) => x.id !== p.id);
          save();
          renderLibrary();
          go('home');
        } },
      ]);
    };
    setView(
      collectionHeader({ title: p.name, meta: `${p.tracks.length} song${p.tracks.length === 1 ? '' : 's'}${totalTime(p.tracks)} • saved in this browser`, cover: coverEl(p, 'cov.cover'), tint: '72 72 80', editable: rename }),
      h('div.actions',
        h('button.big-play', { 'aria-label': 'Play', onclick: () => playList(p.tracks, 0, source, p.name), html: ICON.play }),
        h('button.act', { 'aria-label': 'Shuffle play', title: 'Shuffle play', onclick: () => { setShuffle(true); playList(p.tracks, Math.floor(Math.random() * p.tracks.length), source, p.name); }, html: ICON.shuffle }),
        downloadLink(),
        h('button.act.small', { title: 'Add a song from a YouTube link', 'aria-label': 'Add a song from a YouTube link', onclick: () => addLink(p), html: ICON.link }),
        h('button.act.small', { title: 'More options', 'aria-label': 'More options', onclick: more, html: ICON.more })
      ),
      p.tracks.length ? trackList(p.tracks, { source, name: p.name, dated: true, remove }) : h('div.empty', h('h2', { text: 'Let’s add some songs' }), h('p', { text: 'Search for songs and choose Add to playlist, or paste a YouTube link with the link button.' }), h('a.pill', { href: '#search', text: 'Find songs' }))
    );
  }
  function viewLibrary() {
    setView(h('h1', { text: 'Your Library' }), h('div', { class: 'lib-list', style: 'padding:0' }, libItems()), h('button.pill', { onclick: () => newPlaylist(), html: ICON.plus + 'New playlist' }), h('a.banner', { href: APP_URL, target: '_blank', rel: 'noopener' }, h('div', h('h2', { text: 'Your Spotify library is in the app' }), h('p', { text: 'Playlists, Liked Songs, podcasts and downloads, with no ads.' })), h('span.pill.primary', { text: 'Get the app' })));
  }
  function viewSettings() {
    const k = Y.key.get();
    const input = h('input', { id: 'key', type: 'password', placeholder: 'AIza…', value: k, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'YouTube key' });
    const status = h('p', { class: k ? 'ok' : '', text: k ? 'Key saved in this browser.' : '' });
    const saveKey = async () => {
      const v = input.value.trim();
      if (!v) { Y.key.clear(); status.className = ''; status.textContent = 'Key removed.'; return; }
      if (!Y.key.looksValid(v)) { status.className = 'bad'; status.textContent = 'That doesn’t look like a Google API key. It starts with “AIza”.'; return; }
      Y.key.set(v);
      status.className = ''; status.textContent = 'Checking…';
      try {
        await Y.call('videos', { part: 'id', id: 'dQw4w9WgXcQ' });
        status.className = 'ok'; status.textContent = 'Key works. You can search now.';
      } catch (e) {
        status.className = 'bad'; status.textContent = e.message;
      }
    };
    setView(
      h('h1', { text: 'Settings' }),
      h('div.card',
        h('h2', { text: 'Your YouTube key' }),
        h('p', { text: 'Searching needs a free key from Google. It’s yours alone, stays in this browser, and is only sent to YouTube.' }),
        h('div.field', input, h('button.pill.primary', { text: 'Save', onclick: saveKey }), k ? h('button.pill', { text: 'Remove', onclick: () => { input.value = ''; saveKey(); } }) : null),
        status,
        h('ol',
          h('li', { html: 'Open <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener"><b>YouTube Data API v3</b> in Google Cloud</a> and sign in. Make a project if it asks.' }),
          h('li', { html: 'Click <b>Enable</b>.' }),
          h('li', { html: 'Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener"><b>Credentials</b></a>, click <b>Create credentials → API key</b>, and copy it.' }),
          h('li', { html: 'Optional but safer: click the key, and under <b>API restrictions</b> pick <b>YouTube Data API v3</b>.' }),
          h('li', { html: 'Paste it above and click <b>Save</b>.' })
        ),
        h('p.note', { text: 'A free key allows about 100 searches a day. Playing songs and repeat searches don’t count.' })
      ),
      h('div.card',
        h('h2', { text: 'Your songs and playlists' }),
        h('p', { text: `${db.liked.length} liked song${db.liked.length === 1 ? '' : 's'} and ${db.playlists.length} playlist${db.playlists.length === 1 ? '' : 's'} are saved in this browser only. Clearing your browser’s site data removes them.` }),
        h('div.field',
          h('button.pill', { text: 'Clear recently played', onclick: () => { db.recent = []; save(); toast('Cleared'); } }),
          h('button.pill', { text: 'Delete everything', onclick: async () => {
            if (!(await confirmDlg({ title: 'Delete everything?', body: 'Liked Songs, playlists and history in this browser will be deleted.', confirm: 'Delete' }))) return;
            db.liked = []; db.playlists = []; db.recent = []; save(); renderLibrary(); toast('Deleted');
          } })
        )
      ),
      h('div.card',
        h('h2', { text: 'About FreeTune Web' }),
        h('p', { text: 'Songs play in YouTube’s official player, so YouTube may show its own ads and the player stays on screen. The FreeTune app has no ads, plays your Spotify library and downloads songs.' }),
        h('div.field', h('a.pill.primary', { href: APP_URL, target: '_blank', rel: 'noopener', text: 'Get the FreeTune app' }), h('a.pill', { href: '../index.html', text: 'FreeApps home' }))
      )
    );
  }

  // ── player controls ──
  function setShuffle(on) {
    db.shuffle = on;
    $('#shuffle').setAttribute('aria-pressed', String(on));
    save();
    const t = current();
    if (t && queue.tracks.length) {
      const idx = queue.order[queue.pos];
      const o = makeOrder(idx);
      queue.order = o.order;
      queue.pos = o.pos;
    }
  }
  function setRepeat(mode) {
    db.repeat = mode;
    const b = $('#repeat');
    b.setAttribute('aria-pressed', String(mode !== 'off'));
    b.dataset.mode = mode;
    b.setAttribute('aria-label', mode === 'one' ? 'Repeat one' : mode === 'all' ? 'Repeat all' : 'Repeat');
    save();
  }
  $('#play').onclick = toggle;
  $('#next').onclick = () => next(false);
  $('#prev').onclick = prev;
  $('#shuffle').onclick = () => setShuffle(!db.shuffle);
  $('#repeat').onclick = () => setRepeat(db.repeat === 'off' ? 'all' : db.repeat === 'all' ? 'one' : 'off');
  $('#np-like').onclick = () => { const t = current(); if (t) toggleLike(t); };
  $('#queue-btn').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const up = queue.order.slice(queue.pos + 1, queue.pos + 16).map((i) => queue.tracks[i]);
    openMenu(r.left - 260, r.top - 20, [
      { head: queue.name ? `Playing from ${queue.name}` : 'Queue' },
      ...(up.length ? up.map((t, k) => ({ icon: 'note', label: `${t.name} – ${t.artist}`, run: () => play(queue.pos + 1 + k) })) : [{ head: 'Nothing up next' }]),
    ]);
  };
  let seeking = false;
  const seek = $('#seek');
  seek.addEventListener('input', () => { seeking = true; seek.style.setProperty('--pct', seek.value / 10 + '%'); const d = yt && yt.getDuration ? yt.getDuration() : 0; $('#t-cur').textContent = Y.fmtTime((seek.value / 1000) * d); });
  seek.addEventListener('change', () => { if (yt && yt.getDuration) yt.seekTo((seek.value / 1000) * yt.getDuration(), true); seeking = false; });
  const vol = $('#vol');
  vol.value = db.volume;
  vol.style.setProperty('--pct', db.volume + '%');
  vol.addEventListener('input', () => { db.volume = +vol.value; vol.style.setProperty('--pct', vol.value + '%'); if (yt && yt.setVolume) yt.setVolume(db.volume); save(); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
  });
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => yt && yt.playVideo());
      navigator.mediaSession.setActionHandler('pause', () => yt && yt.pauseVideo());
      navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
      navigator.mediaSession.setActionHandler('previoustrack', prev);
    } catch {}
  }

  // ── start ──
  $('#shuffle').setAttribute('aria-pressed', String(db.shuffle));
  setRepeat(db.repeat);
  renderLibrary();
  render();
  window.__ft = { db, queue, play, playList }; // for testing
})();
