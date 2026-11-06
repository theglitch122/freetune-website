// FreeReel Web: YouTube through its official player, with subscriptions, Watch later,
// history and where-you-left-off kept in this browser. No Google account, no
// recommendations, no Shorts. Downloads are in the FreeReel app.
(function () {
  'use strict';
  const Y = window.FreeYT;
  const $ = (s, r = document) => r.querySelector(s);
  const APP_URL = '../index.html#get-freereel';
  const DATA = 'freereel.web';

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
    later: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
    yt: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3.5"/><path d="M10.5 9.5v5l4-2.5z" class="fill"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 20h14"/></svg>',
  };

  // ── saved in this browser ──
  const db = Object.assign({ subs: [], later: [], history: [], progress: {}, keepHistory: true }, Y.store.get(DATA, {}));
  let saveTimer = null;
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!Y.store.set(DATA, db)) toast('Your browser’s storage is full, so changes weren’t saved.', true);
  }
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 200); };
  window.addEventListener('pagehide', () => { if (saveTimer) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) flush(); });
  const isSubbed = (id) => db.subs.some((s) => s.id === id);
  const inLater = (id) => db.later.some((v) => v.id === id);
  const slim = (v) => ({ id: v.id, title: v.title, channel: v.channel, channelId: v.channelId, thumb: v.thumb, seconds: v.seconds || 0, published: v.published || '' });

  // ── helpers ──
  let toastTimer = null;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!err);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), err ? 5000 : 2400);
  }
  function ago(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!iso || isNaN(s)) return '';
    const u = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [n, w] of u) if (s >= n) { const k = Math.floor(s / n); return `${k} ${w}${k === 1 ? '' : 's'} ago`; }
    return 'just now';
  }
  function count(n, word) {
    n = Number(n);
    if (!isFinite(n)) return '';
    const f = n >= 1e9 ? (n / 1e9).toFixed(n < 1e10 ? 1 : 0) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'K' : String(n);
    return `${f.replace('.0', '')} ${word}${n === 1 ? '' : 's'}`;
  }
  // replaceChildren() would print "null" for skipped parts; this leaves them out.
  const fill = (el, ...nodes) => el.replaceChildren(...nodes.flat(Infinity).filter((x) => x != null && x !== false));
  const avatar = (url, name) => (url ? h('img.av', { src: url, alt: '', loading: 'lazy' }) : h('div.av', { text: (name || '?').trim().charAt(0).toUpperCase() }));

  // ── YouTube data ──
  function toVideo(v) {
    const sn = v.snippet || {};
    return {
      id: typeof v.id === 'string' ? v.id : (v.id && v.id.videoId) || (v.contentDetails && v.contentDetails.videoId) || (sn.resourceId && sn.resourceId.videoId),
      title: Y.decode(sn.title || ''),
      channel: Y.decode(sn.videoOwnerChannelTitle || sn.channelTitle || ''),
      channelId: sn.videoOwnerChannelId || sn.channelId || '',
      thumb: Y.thumb(sn, 'medium'),
      published: (v.contentDetails && v.contentDetails.videoPublishedAt) || sn.publishedAt || '',
      seconds: v.contentDetails && v.contentDetails.duration ? Y.isoSeconds(v.contentDetails.duration) : 0,
      live: sn.liveBroadcastContent === 'live' || sn.liveBroadcastContent === 'upcoming',
      views: v.statistics ? v.statistics.viewCount : null,
      description: sn.description || '',
    };
  }
  async function videos(ids, maxAge = 6 * 3600e3) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await Y.call('videos', { part: 'snippet,contentDetails,statistics', id: ids.slice(i, i + 50).join(',') }, { maxAge, persist: true });
      out.push(...(r.items || []).map(toVideo));
    }
    return out;
  }
  const notShort = (v) => !(v.seconds && v.seconds <= 60) && !/#shorts\b/i.test(v.title);
  async function uploads(channelId, max = 12) {
    if (!/^UC[\w-]{22}$/.test(channelId)) return [];
    const r = await Y.call('playlistItems', { part: 'contentDetails', playlistId: 'UU' + channelId.slice(2), maxResults: String(max) }, { maxAge: 30 * 60e3, persist: true });
    const ids = (r.items || []).map((x) => x.contentDetails && x.contentDetails.videoId).filter(Boolean);
    return ids.length ? (await videos(ids)).filter(notShort) : [];
  }
  const channelMemo = new Map();
  async function channels(ids) {
    const need = ids.filter((id) => !channelMemo.has(id));
    for (let i = 0; i < need.length; i += 50) {
      const r = await Y.call('channels', { part: 'snippet,statistics,brandingSettings', id: need.slice(i, i + 50).join(',') }, { maxAge: 24 * 3600e3, persist: true });
      for (const c of r.items || []) channelMemo.set(c.id, { id: c.id, name: Y.decode(c.snippet.title), avatar: Y.thumb(c.snippet, 'default'), subs: c.statistics && !c.statistics.hiddenSubscriberCount ? c.statistics.subscriberCount : null, description: c.snippet.description || '', banner: (c.brandingSettings && c.brandingSettings.image && c.brandingSettings.image.bannerExternalUrl) || '' });
    }
    return ids.map((id) => channelMemo.get(id)).filter(Boolean);
  }

  // ── subscribing ──
  function toggleSub(ch) {
    if (isSubbed(ch.id)) {
      db.subs = db.subs.filter((s) => s.id !== ch.id);
      toast(`Unsubscribed from ${ch.name}`);
    } else {
      db.subs.push({ id: ch.id, name: ch.name, avatar: ch.avatar || '' });
      toast(`Subscribed to ${ch.name}`);
    }
    feedCache = null;
    save();
  }
  function subButton(ch) {
    const b = h('button.btn', { onclick: () => { toggleSub(ch); paint(); } });
    const paint = () => {
      const on = isSubbed(ch.id);
      b.className = on ? 'btn subbed' : 'btn primary';
      b.innerHTML = on ? ICON.check + 'Subscribed' : 'Subscribe';
    };
    paint();
    return b;
  }
  function toggleLater(v) {
    if (inLater(v.id)) {
      db.later = db.later.filter((x) => x.id !== v.id);
      toast('Removed from Watch later');
    } else {
      db.later.unshift({ ...slim(v), addedAt: Date.now() });
      toast('Saved to Watch later');
    }
    save();
  }
  // Google Takeout's subscriptions.csv: "Channel Id,Channel Url,Channel Title"
  function importCsv(file) {
    const r = new FileReader();
    r.onload = () => {
      const lines = String(r.result || '').split(/\r?\n/);
      let added = 0;
      for (const line of lines) {
        const m = /^(UC[\w-]{22}),[^,]*,(.*)$/.exec(line.trim());
        if (!m || isSubbed(m[1])) continue;
        db.subs.push({ id: m[1], name: m[2].replace(/^"|"$/g, '').replace(/""/g, '"'), avatar: '' });
        added++;
      }
      feedCache = null;
      save();
      toast(added ? `Added ${added} subscription${added === 1 ? '' : 's'}` : 'No new channels in that file', !added);
      render();
    };
    r.readAsText(file);
  }
  const importButton = () => {
    const input = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: (e) => { if (e.target.files[0]) importCsv(e.target.files[0]); } });
    return h('label.btn', { role: 'button', tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') input.click(); } }, h('span', { style: 'display:contents', html: ICON.upload }), 'Import subscriptions.csv', input);
  };

  // ── cards ──
  function videoCard(v, { showChannel = true } = {}) {
    const p = db.progress[v.id];
    const pct = p && p.d ? Math.min(100, Math.round((p.t / p.d) * 100)) : 0;
    return h('div.card',
      h('a.thumb', { href: '#watch/' + v.id, 'aria-label': v.title }, h('img', { src: v.thumb, alt: '', loading: 'lazy' }), v.seconds ? h('span.dur', { text: Y.fmtTime(v.seconds) }) : null, pct > 2 ? h('div.prog', h('i', { style: `width:${pct}%` })) : null),
      h(`div.meta${showChannel ? '' : '.no-av'}`,
        showChannel ? h('a', { href: '#channel/' + v.channelId }, avatar((channelMemo.get(v.channelId) || db.subs.find((s) => s.id === v.channelId) || {}).avatar, v.channel)) : null,
        h('div', h('a.title', { href: '#watch/' + v.id, text: v.title }),
          h('div.sub', showChannel ? h('a', { href: '#channel/' + v.channelId, text: v.channel }) : null, showChannel ? h('br') : null, [v.views ? count(v.views, 'view') : '', ago(v.published)].filter(Boolean).join(' · ')))
      )
    );
  }
  const grid = (list, o) => h('div.grid', list.map((v) => videoCard(v, o)));
  const skeleton = (n = 8) => h('div.grid', Array.from({ length: n }, () => h('div.card', h('div.thumb.skel'), h('div.skel', { style: 'height:16px;width:80%' }), h('div.skel', { style: 'height:12px;width:50%' }))));

  // ── views ──
  const route = { name: 'home', arg: '' };
  let player = null;
  let progressTimer = null;
  function leaveWatch() {
    clearInterval(progressTimer);
    if (player) {
      saveProgress();
      try { player.destroy(); } catch {}
      player = null;
    }
  }
  function setView(...nodes) {
    const v = h('div.view', nodes);
    $('#main').replaceChildren(v);
    return v;
  }
  function render() {
    const raw = location.hash.slice(1) || 'home';
    const i = raw.indexOf('/');
    const name = i < 0 ? raw : raw.slice(0, i);
    const arg = i < 0 ? '' : decodeURIComponent(raw.slice(i + 1));
    leaveWatch();
    route.name = name;
    route.arg = arg;
    document.querySelectorAll('#nav [data-view]').forEach((a) => { if (a.dataset.view === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    window.scrollTo(0, 0);
    ({ home: viewHome, search: viewSearch, watch: viewWatch, channel: viewChannel, subs: viewSubs, later: viewLater, history: viewHistory, settings: viewSettings }[name] || viewHome)(arg);
  }
  window.addEventListener('hashchange', render);
  const live = () => {
    const at = location.hash;
    return () => location.hash === at;
  };
  function errorBox(e) {
    return h('div.empty', h('h2', { text: e.code === 'nokey' ? 'Add your YouTube key' : 'That didn’t load' }), h('p', { text: e.message }), e.code === 'nokey' || e.code === 'badkey' ? h('a.btn.hot', { href: '#settings', text: 'Open Settings' }) : h('button.btn', { text: 'Try again', onclick: render }));
  }
  function keyPanel() {
    return h('div.panel',
      h('h2', { text: 'Add your YouTube key to start' }),
      h('p', { text: 'FreeReel Web reads YouTube with your own free key from Google, so there’s no shared limit and no account. It takes about two minutes and stays in this browser.' }),
      h('div.row-btns', h('a.btn.hot', { href: '#settings', text: 'Set it up' })),
      h('p.note', { text: 'You can already watch any video by pasting its link into the search box.' })
    );
  }

  let feedCache = null; // { at, list }
  async function viewHome() {
    const ok = live();
    if (!Y.key.get()) return setView(h('h1', { text: 'Home' }), keyPanel());
    if (!db.subs.length)
      return setView(h('h1', { text: 'Home' }), h('div.empty',
        h('h2', { text: 'Your subscriptions show up here' }),
        h('p', { text: 'Search for a channel and subscribe, or bring your YouTube subscriptions: in Google Takeout, export only “YouTube and YouTube Music → subscriptions”, unzip it and choose subscriptions.csv. YouTube never learns who you follow.' }),
        h('div.row-btns', importButton(), h('a.btn', { href: 'https://takeout.google.com/', target: '_blank', rel: 'noopener', text: 'Open Google Takeout' }))
      ));
    const v = setView(h('h1', { text: 'Home' }), h('p.lede', { text: `Newest videos from your ${db.subs.length} subscription${db.subs.length === 1 ? '' : 's'}. No Shorts, nothing picked for you.` }), feedCache ? grid(feedCache.list) : skeleton());
    if (feedCache && Date.now() - feedCache.at < 10 * 60e3) return;
    try {
      const subs = db.subs.slice(0, 150);
      const all = [];
      let failed = null;
      for (let i = 0; i < subs.length; i += 6) {
        const got = await Promise.all(subs.slice(i, i + 6).map((s) => uploads(s.id, 8).catch((e) => { failed = e; return []; })));
        got.forEach((l) => all.push(...l));
        if (failed && (failed.code === 'quota' || failed.code === 'badkey' || failed.code === 'nokey')) throw failed;
      }
      // channel pictures (cheap, and remembered for a day)
      const cs = await channels(subs.map((s) => s.id)).catch(() => []);
      for (const c of cs) { const s = db.subs.find((x) => x.id === c.id); if (s && c.avatar && s.avatar !== c.avatar) { s.avatar = c.avatar; save(); } }
      const seen = new Set();
      const list = all.filter((x) => !x.live && !seen.has(x.id) && seen.add(x.id)).sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).slice(0, 120);
      feedCache = { at: Date.now(), list };
      if (ok()) v.lastChild.replaceWith(list.length ? grid(list) : h('div.empty', h('h2', { text: 'Nothing new' }), h('p', { text: 'Your channels haven’t posted any videos lately.' })));
    } catch (e) {
      if (ok()) v.lastChild.replaceWith(errorBox(e));
    }
  }

  async function viewSearch(q) {
    const ok = live();
    $('#q').value = q;
    const id = Y.videoIdFrom(q);
    if (id) return (location.hash = 'watch/' + id);
    const v = setView(h('h1', { text: `Results for “${q}”` }), h('div.list', Array.from({ length: 4 }, () => h('div.lrow', h('div.thumb.skel'), h('div', h('div.skel', { style: 'height:18px;width:70%' }))))));
    if (!Y.key.get()) return v.lastChild.replaceWith(keyPanel());
    try {
      const r = await Y.call('search', { part: 'snippet', type: 'video,channel', maxResults: '25', q, safeSearch: 'none' }, { maxAge: 12 * 3600e3, persist: true });
      const chIds = (r.items || []).filter((x) => x.id.kind === 'youtube#channel').map((x) => x.id.channelId);
      const vidIds = (r.items || []).filter((x) => x.id.kind === 'youtube#video').map((x) => x.id.videoId);
      const [chs, vids] = await Promise.all([chIds.length ? channels(chIds) : [], vidIds.length ? videos(vidIds) : []]);
      if (!ok()) return;
      const rows = [
        ...chs.slice(0, 3).map((c) => h('div.chan-row', h('a', { href: '#channel/' + c.id }, avatar(c.avatar, c.name)), h('a', { href: '#channel/' + c.id }, h('div.name', { text: c.name }), h('div.sub', { text: [c.subs ? count(c.subs, 'subscriber') : '', c.description.slice(0, 120)].filter(Boolean).join(' · ') })), subButton(c))),
        ...vids.filter(notShort).map((x) => h('div.lrow',
          h('a.thumb', { href: '#watch/' + x.id }, h('img', { src: x.thumb, alt: '', loading: 'lazy' }), x.seconds ? h('span.dur', { text: Y.fmtTime(x.seconds) }) : null),
          h('div.info', h('a.title', { href: '#watch/' + x.id, text: x.title }), h('div.sub', [x.views ? count(x.views, 'view') : '', ago(x.published)].filter(Boolean).join(' · ')), h('a.sub', { href: '#channel/' + x.channelId, text: x.channel }), h('div.desc', { text: x.description.split('\n')[0] }))
        )),
      ];
      v.lastChild.replaceWith(rows.length ? h('div.list', rows) : h('div.empty', h('h2', { text: 'No results' }), h('p', { text: 'Try different words.' })));
    } catch (e) {
      if (ok()) v.lastChild.replaceWith(errorBox(e));
    }
  }

  function saveProgress() {
    if (!player || !player.getCurrentTime || !route.arg) return;
    const t = player.getCurrentTime();
    const d = player.getDuration();
    if (!d || t < 5) return;
    if (d - t < 20) delete db.progress[route.arg];
    else db.progress[route.arg] = { t: Math.floor(t), d: Math.floor(d), at: Date.now() };
    const keys = Object.keys(db.progress);
    if (keys.length > 400) keys.sort((a, b) => db.progress[a].at - db.progress[b].at).slice(0, keys.length - 400).forEach((k) => delete db.progress[k]);
    save();
  }
  async function viewWatch(id) {
    if (!/^[\w-]{11}$/.test(id)) return viewHome();
    const ok = live();
    const p = db.progress[id];
    const start = p && p.t > 10 && p.d - p.t > 20 ? p.t : 0;
    const host = h('div', { id: 'yt-player' });
    const info = h('div', h('div.w-title.skel', { style: 'height:26px;width:60%' }));
    const side = h('div.side-list');
    setView(h('div.watch', h('div', h('div.player-wrap', h('div.player', host)), info), side));
    // the player starts straight away; details load beside it
    Y.playerApi().then((YT) => {
      if (!ok()) return;
      player = new YT.Player(host, {
        host: 'https://www.youtube-nocookie.com',
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, start, origin: location.origin },
        events: {
          onError: (e) => toast(Y.PLAYER_ERRORS[e.data] || 'YouTube couldn’t play this video.', true),
          onStateChange: (e) => { if (e.data === 0) { delete db.progress[id]; save(); } },
        },
      });
      clearInterval(progressTimer);
      progressTimer = setInterval(saveProgress, 5000);
    }).catch((e) => toast(e.message, true));
    if (!Y.key.get()) {
      fill(info, h('div.row-btns', { style: 'margin-top:14px' }, h('a.btn', { href: `https://www.youtube.com/watch?v=${id}`, target: '_blank', rel: 'noopener', html: ICON.yt + 'Open on YouTube' }), h('a.btn', { href: APP_URL, target: '_blank', rel: 'noopener', html: ICON.download + 'Download' })), h('p.note', { style: 'margin-top:12px', text: 'Add your YouTube key in Settings to see the title, channel and more videos here.' }));
      return;
    }
    try {
      const v = (await videos([id], 30 * 60e3))[0];
      if (!ok()) return;
      if (!v) return fill(info, h('div.empty', h('h2', { text: 'This video isn’t available' }), h('p', { text: 'It may have been removed or made private.' })));
      if (db.keepHistory) {
        db.history = [{ ...slim(v), watchedAt: Date.now() }, ...db.history.filter((x) => x.id !== v.id)].slice(0, 300);
        save();
      }
      document.title = v.title + ' – FreeReel Web';
      const [ch] = await channels([v.channelId]).catch(() => []);
      if (!ok()) return;
      const c = ch || { id: v.channelId, name: v.channel, avatar: '' };
      const laterBtn = h('button.btn', { 'aria-pressed': String(inLater(v.id)), onclick: () => { toggleLater(v); laterBtn.setAttribute('aria-pressed', String(inLater(v.id))); laterBtn.innerHTML = ICON.later + (inLater(v.id) ? 'Saved' : 'Watch later'); } });
      laterBtn.innerHTML = ICON.later + (inLater(v.id) ? 'Saved' : 'Watch later');
      const desc = h('div.desc-box',
        h('div.stats', { text: [v.views ? count(v.views, 'view') : '', v.published ? new Date(v.published).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''].filter(Boolean).join(' · ') }),
        h('div.text', linkify(v.description)),
        v.description.length > 160 || v.description.split('\n').length > 3 ? h('button.more', { text: '…more', onclick: (e) => { const open = desc.classList.toggle('open'); e.currentTarget.textContent = open ? 'Show less' : '…more'; } }) : null
      );
      fill(info, 
        h('h1.w-title', { text: v.title }),
        h('div.w-bar',
          h('div.w-chan', h('a', { href: '#channel/' + c.id }, avatar(c.avatar, c.name)), h('div', h('a.nm', { href: '#channel/' + c.id, text: c.name }), c.subs ? h('div.subs', { text: count(c.subs, 'subscriber') }) : null), subButton(c)),
          h('div.row-btns', laterBtn,
            h('a.btn', { href: APP_URL, target: '_blank', rel: 'noopener', title: 'Downloads are in the FreeReel app', html: ICON.download + 'Download' }),
            h('a.btn', { href: `https://www.youtube.com/watch?v=${id}`, target: '_blank', rel: 'noopener', html: ICON.yt + 'YouTube' }))
        ),
        start ? h('p.resume', `Resumed from ${Y.fmtTime(start)}.`, h('button', { text: 'Start over', onclick: () => player && player.seekTo(0, true) })) : null,
        desc
      );
      fill(side, h('h2', { text: `More from ${c.name}` }), h('div.skel', { style: 'height:94px' }));
      const more = await uploads(c.id, 15).catch(() => []);
      if (!ok()) return;
      fill(side, h('h2', { text: `More from ${c.name}` }), ...more.filter((x) => x.id !== id).slice(0, 12).map((x) => h('a.mini', { href: '#watch/' + x.id }, h('div.thumb', h('img', { src: x.thumb, alt: '', loading: 'lazy' }), x.seconds ? h('span.dur', { text: Y.fmtTime(x.seconds) }) : null), h('div', h('div.title', { text: x.title }), h('div.sub', { text: [x.views ? count(x.views, 'view') : '', ago(x.published)].filter(Boolean).join(' · ') })))));
    } catch (e) {
      if (ok()) fill(info, errorBox(e));
    }
  }
  function linkify(text) {
    const frag = document.createDocumentFragment();
    const re = /(https?:\/\/[^\s]+)|(\b\d{1,2}:\d{2}(?::\d{2})?\b)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      frag.append(text.slice(last, m.index));
      if (m[1]) {
        const vid = Y.videoIdFrom(m[1]);
        frag.append(h('a', vid ? { href: '#watch/' + vid, text: m[1] } : { href: m[1], target: '_blank', rel: 'noopener nofollow', text: m[1] }));
      } else {
        const secs = m[2].split(':').reduce((a, n) => a * 60 + +n, 0);
        frag.append(h('a', { href: '#', text: m[2], onclick: (e) => { e.preventDefault(); if (player) { player.seekTo(secs, true); window.scrollTo({ top: 0, behavior: 'smooth' }); } } }));
      }
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    return frag;
  }

  async function viewChannel(id) {
    const ok = live();
    const v = setView(h('div.skel', { style: 'height:120px' }), skeleton());
    try {
      const [c] = await channels([id]);
      if (!ok()) return;
      if (!c) return fill(v, h('div.empty', h('h2', { text: 'Channel not found' })));
      document.title = c.name + ' – FreeReel Web';
      fill(v, 
        c.banner ? h('img.banner-img', { src: c.banner + '=w1600-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', alt: '' }) : null,
        h('div.ch-head', avatar(c.avatar, c.name), h('div', h('h1', { text: c.name }), h('div.sub', { text: c.subs ? count(c.subs, 'subscriber') : '' }), h('div.row-btns', { style: 'margin-top:12px' }, subButton(c)))),
        c.description ? h('p.lede', { text: c.description.slice(0, 280) + (c.description.length > 280 ? '…' : '') }) : null,
        h('h2', { text: 'Latest videos' }),
        skeleton(4)
      );
      const list = await uploads(id, 30);
      if (ok()) v.lastChild.replaceWith(list.length ? grid(list, { showChannel: false }) : h('p.note', { text: 'No videos yet.' }));
    } catch (e) {
      if (ok()) fill(v, errorBox(e));
    }
  }

  function viewSubs() {
    setView(
      h('h1', { text: 'Subscriptions' }),
      h('p.lede', { text: 'Kept in this browser. YouTube doesn’t know who you follow: FreeReel reads each channel’s public uploads.' }),
      h('div.row-btns', importButton()),
      db.subs.length
        ? h('div.list', db.subs.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => h('div.chan-row', h('a', { href: '#channel/' + s.id }, avatar(s.avatar, s.name)), h('a', { href: '#channel/' + s.id }, h('div.name', { text: s.name })), subButton(s))))
        : h('div.empty', h('h2', { text: 'No subscriptions yet' }), h('p', { text: 'Search for a channel and press Subscribe, or import subscriptions.csv from Google Takeout.' }))
    );
  }
  function savedList(title, list, empty, onRemove) {
    return [
      h('h1', { text: title }),
      list.length
        ? h('div.list', list.map((x) => h('div.lrow',
            h('a.thumb', { href: '#watch/' + x.id }, h('img', { src: x.thumb, alt: '', loading: 'lazy' }), x.seconds ? h('span.dur', { text: Y.fmtTime(x.seconds) }) : null),
            h('div.info', h('a.title', { href: '#watch/' + x.id, text: x.title }), h('a.sub', { href: '#channel/' + x.channelId, text: x.channel })),
            h('button.btn', { text: 'Remove', onclick: () => onRemove(x) })
          )))
        : h('div.empty', h('h2', { text: empty[0] }), h('p', { text: empty[1] })),
    ];
  }
  function viewLater() {
    setView(...savedList('Watch later', db.later, ['Nothing saved yet', 'Press Watch later under any video to keep it here.'], (x) => { db.later = db.later.filter((y) => y.id !== x.id); save(); render(); }));
  }
  function viewHistory() {
    const v = setView(...savedList('History', db.history, [db.keepHistory ? 'Nothing watched yet' : 'History is paused', db.keepHistory ? 'Videos you watch show up here. Only this browser keeps them.' : 'Turn it back on in Settings.'], (x) => { db.history = db.history.filter((y) => y.id !== x.id); save(); render(); }));
    if (db.history.length) v.insertBefore(h('div.row-btns', h('button.btn', { text: 'Clear history', onclick: () => { db.history = []; db.progress = {}; save(); render(); toast('History cleared'); } })), v.children[1]);
  }
  function viewSettings() {
    const k = Y.key.get();
    const input = h('input', { id: 'key', type: 'password', placeholder: 'AIza…', value: k, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'YouTube key' });
    const status = h('p', { class: k ? 'ok' : '', text: k ? 'Key saved in this browser.' : '' });
    const saveKey = async () => {
      const val = input.value.trim();
      if (!val) { Y.key.clear(); status.className = ''; status.textContent = 'Key removed.'; return; }
      if (!Y.key.looksValid(val)) { status.className = 'bad'; status.textContent = 'That doesn’t look like a Google API key. It starts with “AIza”.'; return; }
      Y.key.set(val);
      status.className = ''; status.textContent = 'Checking…';
      try {
        await Y.call('videos', { part: 'id', id: 'dQw4w9WgXcQ' });
        status.className = 'ok'; status.textContent = 'Key works.';
        feedCache = null;
      } catch (e) {
        status.className = 'bad'; status.textContent = e.message;
      }
    };
    const histBtn = h('button.btn', { onclick: () => { db.keepHistory = !db.keepHistory; save(); paintHist(); } });
    const paintHist = () => { histBtn.textContent = db.keepHistory ? 'Pause history' : 'Turn history back on'; };
    paintHist();
    setView(
      h('h1', { text: 'Settings' }),
      h('div.panel',
        h('h2', { text: 'Your YouTube key' }),
        h('p', { text: 'Needed to search and to load your subscriptions. It’s yours alone, stays in this browser, and is only sent to YouTube.' }),
        h('div.field', input, h('button.btn.hot', { text: 'Save', onclick: saveKey })),
        status,
        h('ol',
          h('li', { html: 'Open <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener"><b>YouTube Data API v3</b> in Google Cloud</a> and sign in. Make a project if it asks.' }),
          h('li', { html: 'Click <b>Enable</b>.' }),
          h('li', { html: 'Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener"><b>Credentials</b></a>, click <b>Create credentials → API key</b>, and copy it.' }),
          h('li', { html: 'Optional but safer: click the key, and under <b>API restrictions</b> pick <b>YouTube Data API v3</b>.' }),
          h('li', { html: 'Paste it above and click <b>Save</b>.' })
        ),
        h('p.note', { text: 'A free key allows about 100 searches a day; loading your subscriptions costs very little. Answers are remembered, so going back costs nothing.' })
      ),
      h('div.panel',
        h('h2', { text: 'History' }),
        h('p', { text: 'Your history and where you left off in each video are kept in this browser only.' }),
        h('div.row-btns', histBtn, h('button.btn', { text: 'Clear history', onclick: () => { db.history = []; db.progress = {}; save(); toast('History cleared'); } }))
      ),
      h('div.panel',
        h('h2', { text: 'About FreeReel Web' }),
        h('p', { text: 'Videos play in YouTube’s official player (the privacy-enhanced youtube-nocookie.com one), so YouTube may show its own ads. The FreeReel app has no ads, plays up to 4K and downloads videos to watch offline.' }),
        h('div.row-btns', h('a.btn.hot', { href: APP_URL, target: '_blank', rel: 'noopener', text: 'Get the FreeReel app' }), h('a.btn', { href: '../index.html', text: 'FreeApps home' }))
      )
    );
  }

  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#q').value.trim();
    if (!q) return;
    const id = Y.videoIdFrom(q);
    location.hash = id ? 'watch/' + id : 'search/' + encodeURIComponent(q);
  });
  render();
  window.__fr = { db }; // for testing
})();
