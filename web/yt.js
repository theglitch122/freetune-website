// Shared by FreeTune and FreeReel on the web: the visitor's own YouTube key, calls to the
// YouTube Data API (from their browser, with their key), and the official YouTube player.
// Nothing here talks to any server of ours: there isn't one.
(function () {
  'use strict';
  const API = 'https://www.googleapis.com/youtube/v3/';
  const KEY = 'freeapps.ytkey';
  const store = {
    get(k, fallback) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      } catch {
        return false;
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch {}
    },
  };

  const key = {
    get: () => store.get(KEY, '') || '',
    set: (k) => store.set(KEY, String(k || '').trim()),
    clear: () => store.del(KEY),
    looksValid: (k) => /^AIza[\w-]{30,}$/.test(String(k || '').trim()),
  };

  class YtError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  // Answers kept for a while, so going back to a search or a channel costs nothing.
  const memo = new Map();
  const CACHE = 'freeapps.ytcache';
  const saved = store.get(CACHE, {});
  function cacheGet(url, maxAge) {
    const m = memo.get(url) || saved[url];
    return m && Date.now() - m.at < maxAge ? m.data : null;
  }
  function cachePut(url, data, persist) {
    const e = { at: Date.now(), data };
    memo.set(url, e);
    if (!persist) return;
    saved[url] = e;
    const keys = Object.keys(saved);
    if (keys.length > 120) keys.sort((a, b) => saved[a].at - saved[b].at).slice(0, keys.length - 120).forEach((k) => delete saved[k]);
    if (!store.set(CACHE, saved)) {
      for (const k of Object.keys(saved)) delete saved[k];
      store.set(CACHE, {});
    }
  }

  async function call(path, params, { maxAge = 0, persist = false } = {}) {
    const k = key.get();
    if (!k) throw new YtError('Add your YouTube key in Settings to search and load videos.', 'nokey');
    const q = new URLSearchParams(params);
    const id = path + '?' + q.toString();
    if (maxAge) {
      const hit = cacheGet(id, maxAge);
      if (hit) return hit;
    }
    q.set('key', k);
    let res;
    try {
      res = await fetch(API + path + '?' + q.toString());
    } catch {
      throw new YtError('Couldn’t reach YouTube. Check your internet connection.', 'offline');
    }
    let body = null;
    try {
      body = await res.json();
    } catch {}
    if (!res.ok) {
      const reason = body && body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason;
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')
        throw new YtError('Your YouTube key has used up today’s limit. It resets at midnight Pacific time.', 'quota');
      if (reason === 'keyInvalid' || (res.status === 400 && /API key/i.test(JSON.stringify(body || ''))))
        throw new YtError('YouTube didn’t accept your key. Check it in Settings.', 'badkey');
      if (reason === 'accessNotConfigured' || reason === 'forbidden')
        throw new YtError('Your key isn’t allowed to use the YouTube Data API yet. Turn on “YouTube Data API v3” for it in Google Cloud.', 'badkey');
      throw new YtError(`YouTube said no (${res.status}${reason ? ', ' + reason : ''}).`, 'http');
    }
    if (maxAge) cachePut(id, body, persist);
    return body;
  }

  // "PT1H2M3S" -> seconds
  function isoSeconds(d) {
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || '');
    if (!m) return 0;
    return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
  }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }
  function decode(s) {
    const t = document.createElement('textarea');
    t.innerHTML = s || '';
    return t.value;
  }
  const thumb = (sn, size = 'medium') => {
    const t = (sn && sn.thumbnails) || {};
    return (t[size] || t.high || t.medium || t.default || {}).url || '';
  };
  function videoIdFrom(text) {
    const s = String(text || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    try {
      const u = new URL(s);
      if (/(^|\.)youtu\.be$/.test(u.hostname)) return /^\/([\w-]{11})/.exec(u.pathname)?.[1] || null;
      if (!/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) return null;
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      return /\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname)?.[1] || null;
    } catch {
      return null;
    }
  }

  // ── the official YouTube player (www.youtube-nocookie.com) ──
  let apiPromise = null;
  function playerApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prev) try { prev(); } catch {}
        resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => {
        apiPromise = null;
        reject(new YtError('YouTube’s player didn’t load. Check your connection or ad blocker.', 'player'));
      };
      document.head.appendChild(s);
    });
    return apiPromise;
  }
  const PLAYER_ERRORS = {
    2: 'YouTube didn’t recognize this video.',
    5: 'This video can’t play in your browser.',
    100: 'This video was removed or made private.',
    101: 'The owner doesn’t allow this video to play outside YouTube.',
    150: 'The owner doesn’t allow this video to play outside YouTube.',
    153: 'YouTube refused to play this video here.',
  };

  window.FreeYT = { store, key, call, YtError, isoSeconds, fmtTime, decode, thumb, videoIdFrom, playerApi, PLAYER_ERRORS };
})();
