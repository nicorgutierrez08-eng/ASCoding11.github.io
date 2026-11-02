/*
 * Shared code for the Back Room's two daily meaning games, Nearword (ranks) and Warmer (scores). Sets window.Sem.
 * Both guess a secret word; every guess is compared with it by meaning, using real word vectors (GloVe, see
 * NOTICE.txt and tools/build.py). The data is made offline: words.txt (the guessable words) and d/NNN.bin, one small
 * file per secret word, so a game only downloads the word list and the one file for the word it's playing.
 *   days      Sem.today(), Sem.dayNum(key) (2026-11-01 is #1), Sem.fileFor(game, key)
 *   data      Sem.loadWords(), Sem.loadPuzzle(n) -> puzzle (see below)
 *   storage   Sem.Daily.load/finish (the daily:<slug> record the Daily hub reads)
 *   page      Sem.game(cfg) runs a whole game page (top bar, How to play, Stats, guess box, list, hints, end card)
 * No libraries. A test hook (window.__sem) exists only when navigator.webdriver is set.
 */
(function () {
  'use strict';
  var LAUNCH = '20261101';
  var COUNT = 430;              // number of d/NNN.bin files (secret words); must match tools/build.py's output
  var BASE = '/e63334287a3deaa3/sem-data/';
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    }
    if (kids) for (var i = 0; i < kids.length; i++) if (kids[i] != null) e.appendChild(typeof kids[i] === 'string' ? document.createTextNode(kids[i]) : kids[i]);
    return e;
  }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // ------------------------------------------------------------------ days
  var DAY_TEST = (navigator.webdriver && /^\d{8}$/.test(window.__SEM_TODAY || '')) ? window.__SEM_TODAY : ''; // tests only
  function keyOf(d) { return String(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()); }
  function today() { return DAY_TEST || keyOf(new Date()); }
  function dateOf(k) { return new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), 12); }
  function addDays(k, n) { var d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); }
  function dayNum(k) { return Math.round((dateOf(k) - dateOf(LAUNCH)) / 864e5) + 1; }
  function hash(s) { var x = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function rng(seed) { var a = typeof seed === 'number' ? seed >>> 0 : hash(String(seed)); return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(a, r) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  // The files are already in a shuffled order, so the first time round the days just walk through them; after that
  // each round uses a new seeded shuffle. Warmer runs half the list ahead of Nearword in the same order, so the two
  // never share a word on a day, and a round never starts with the word that ended the last one (for either game).
  var OFF = Math.floor(COUNT / 2), orders = {};
  function cycleOrder(c) {
    if (c <= 0) { var o = []; for (var i = 0; i < COUNT; i++) o.push(i); return o; }
    if (orders[c]) return orders[c];
    var prev = cycleOrder(c - 1), t = 0, s;
    do { s = shuffle(prev, rng('sem-cycle-' + c + (t ? '-' + t : ''))); t++; } while (t < 50 && (s[0] === prev[COUNT - 1] || s[OFF] === prev[OFF - 1]));
    return (orders[c] = s);
  }
  function fileFor(game, k) {
    var i = dayNum(k) - 1, c = Math.floor(i / COUNT);
    i -= c * COUNT;
    return cycleOrder(c)[(i + (game === 'warmer' ? OFF : 0)) % COUNT];
  }

  // ------------------------------------------------------------------ data: the word list and one secret word's file
  var wordsWait = null;
  // -> {list: [word], num: Map word -> number, hidden: Uint8Array (1 = never shown unless typed)}
  function loadWords() {
    if (wordsWait) return wordsWait;
    wordsWait = fetch(BASE + 'words.txt').then(function (r) { if (!r.ok) throw new Error('words ' + r.status); return r.text(); }).then(function (t) {
      var lines = t.split('\n'), list = [], hidden = [], num = new Map();
      for (var i = 0; i < lines.length; i++) {
        var w = lines[i].trim(); if (!w) continue;
        var star = w.charAt(w.length - 1) === '*'; if (star) w = w.slice(0, -1);
        num.set(w, list.length); list.push(w); hidden.push(star ? 1 : 0);
      }
      return { list: list, num: num, hidden: Uint8Array.from(hidden) };
    });
    wordsWait.catch(function () { wordsWait = null; });
    return wordsWait;
  }
  // A small inflate (RFC 1950/1951) for browsers without DecompressionStream.
  function inflate(src) {
    var pos = 2, bit = 0, out = new Uint8Array(Math.max(1024, src.length * 3)), op = 0;
    function grow(n) { if (op + n > out.length) { var o = new Uint8Array(Math.max(out.length * 2, op + n)); o.set(out); out = o; } }
    function bits(n) { var v = 0; for (var i = 0; i < n; i++) { if (pos >= src.length) throw new Error('inflate: end'); v |= ((src[pos] >> bit) & 1) << i; if (++bit === 8) { bit = 0; pos++; } } return v; }
    function table(len, n) {
      var count = new Uint16Array(16), offs = new Uint16Array(16), sym = new Uint16Array(n), i;
      for (i = 0; i < n; i++) count[len[i]]++;
      count[0] = 0;
      for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
      for (i = 0; i < n; i++) if (len[i]) sym[offs[len[i]]++] = i;
      return { count: count, sym: sym };
    }
    function decode(t) {
      var code = 0, first = 0, index = 0;
      for (var l = 1; l < 16; l++) {
        code |= bits(1); var c = t.count[l];
        if (code - c < first) return t.sym[index + (code - first)];
        index += c; first += c; first <<= 1; code <<= 1;
      }
      throw new Error('inflate: bad code');
    }
    var LB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var LE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    var DB = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var DE = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    var ORD = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    var fixL = null, fixD = null, last = 0;
    while (!last) {
      last = bits(1); var type = bits(2), lt, dt, i;
      if (type === 0) {
        if (bit) { bit = 0; pos++; }
        var n = src[pos] | (src[pos + 1] << 8); pos += 4; grow(n);
        out.set(src.subarray(pos, pos + n), op); op += n; pos += n; continue;
      }
      if (type === 1) {
        if (!fixL) { var l = new Uint8Array(288); for (i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8; fixL = table(l, 288); var d = new Uint8Array(30); d.fill(5); fixD = table(d, 30); }
        lt = fixL; dt = fixD;
      } else if (type === 2) {
        var nl = bits(5) + 257, nd = bits(5) + 1, nc = bits(4) + 4, cl = new Uint8Array(19);
        for (i = 0; i < nc; i++) cl[ORD[i]] = bits(3);
        var ct = table(cl, 19), lens = new Uint8Array(nl + nd);
        for (i = 0; i < nl + nd;) {
          var s = decode(ct), rep = 0, val = 0;
          if (s < 16) { lens[i++] = s; continue; }
          if (s === 16) { if (!i) throw new Error('inflate: repeat'); val = lens[i - 1]; rep = 3 + bits(2); } else if (s === 17) rep = 3 + bits(3); else rep = 11 + bits(7);
          while (rep--) lens[i++] = val;
        }
        lt = table(lens.subarray(0, nl), nl); dt = table(lens.subarray(nl), nd);
      } else throw new Error('inflate: block type');
      for (;;) {
        var sym = decode(lt);
        if (sym < 256) { grow(1); out[op++] = sym; continue; }
        if (sym === 256) break;
        sym -= 257; var len = LB[sym] + bits(LE[sym]), ds = decode(dt), dist = DB[ds] + bits(DE[ds]);
        grow(len); for (i = 0; i < len; i++) { out[op] = out[op - dist]; op++; }
      }
    }
    return out.subarray(0, op);
  }
  function unzip(buf) {
    var bytes = new Uint8Array(buf);
    if (window.DecompressionStream && !FORCE_JS) {
      try {
        var ds = new DecompressionStream('deflate');
        return new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer().then(function (b) { return new Uint8Array(b); }, function () { return inflate(bytes); });
      } catch (e) {}
    }
    return Promise.resolve().then(function () { return inflate(bytes); });
  }
  var FORCE_JS = false;
  // A puzzle: puzzle.secret (word number), puzzle.word, puzzle.info(num) -> {rank, sim, exact}, puzzle.top(i) word
  // number ranked i+1 (i < T), puzzle.sim(i) its similarity. Ranks past T are the middle of the word's level.
  var puzzles = {};
  function loadPuzzle(n) {
    if (puzzles[n]) return puzzles[n];
    var p = Promise.all([loadWords(), fetch(BASE + 'd/' + ('00' + n).slice(-3) + '.bin').then(function (r) { if (!r.ok) throw new Error('file ' + r.status); return r.arrayBuffer(); }).then(unzip)]).then(function (res) {
      var W = res[0], b = res[1], dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      if (b[0] !== 83 || b[1] !== 77 || b[2] !== 2) throw new Error('bad file');
      var V = dv.getUint16(4, true), T = dv.getUint16(6, true), L = b[8];
      if (V !== W.list.length) throw new Error('word list mismatch');
      var o = 12, bounds = [], means = [], i;
      for (i = 0; i <= L; i++) { bounds.push(dv.getUint16(o, true)); o += 2; }
      for (i = 0; i < L; i++) { means.push(dv.getInt16(o, true) / 10000); o += 2; }
      var top = new Uint16Array(T), sims = new Float32Array(T), pos = new Map(), q = 10000;
      for (i = 0; i < T; i++) top[i] = b[o + i] * 256 + b[o + T + i];
      o += 2 * T;
      for (i = 0; i < T; i++) { q -= dv.getUint16(o + 2 * i, true); sims[i] = q / 10000; pos.set(top[i], i); }
      o += 2 * T;
      var lv = b.subarray(o, o + V);
      if (lv.length !== V) throw new Error('short file');
      return {
        n: n, T: T, V: V, words: W, secret: top[0], word: W.list[top[0]],
        top: function (i) { return top[i]; }, sim: function (i) { return sims[i]; },
        info: function (num) {
          var i = pos.get(num);
          if (i != null) return { rank: i + 1, sim: sims[i], exact: true };
          var j = lv[num]; if (j >= L) return { rank: V, sim: -1, exact: false };
          return { rank: Math.round((bounds[j] + 1 + bounds[j + 1]) / 2), sim: means[j], exact: false, lo: bounds[j] + 1, hi: bounds[j + 1] };
        }
      };
    });
    p.catch(function () { delete puzzles[n]; });
    return (puzzles[n] = p);
  }

  // ------------------------------------------------------------------ the daily:<slug> record (read by the Daily hub)
  var Daily = {
    blank: function () { return { v: 1, days: {}, played: 0, wins: 0, streak: 0, maxStreak: 0, last: '', dist: {} }; },
    load: function (slug) {
      var o = store.get('daily:' + slug, null);
      if (!o || typeof o !== 'object' || o.v !== 1) o = Daily.blank();
      ['played', 'wins', 'streak', 'maxStreak'].forEach(function (f) { o[f] = Math.max(0, +o[f] || 0); });
      if (!o.days || typeof o.days !== 'object') o.days = {};
      if (!o.dist || typeof o.dist !== 'object') o.dist = {};
      var t = today(), y = addDays(t, -1);
      if (o.streak && o.last !== t && o.last !== y) { o.streak = 0; store.set('daily:' + slug, o); }
      return o;
    },
    // res: {win, score, tries, time, dist}; called once when a daily game ends.
    finish: function (slug, k, res) {
      var o = Daily.load(slug);
      if (o.days[k] && o.days[k].done) return o;
      var prev = addDays(k, -1);
      o.days[k] = { done: true, win: !!res.win, score: res.score == null ? null : res.score, tries: res.tries == null ? null : res.tries, time: res.time == null ? null : Math.round(res.time) };
      o.played++;
      if (res.win) { o.wins++; o.streak = (o.days[prev] && o.days[prev].win && o.streak > 0) ? o.streak + 1 : 1; }
      else o.streak = 0;
      o.maxStreak = Math.max(o.maxStreak, o.streak);
      if (!o.last || k > o.last) o.last = k;
      if (res.dist != null) o.dist[res.dist] = (o.dist[res.dist] || 0) + 1;
      var cut = addDays(today(), -59);
      Object.keys(o.days).forEach(function (d) { if (d < cut) delete o.days[d]; });
      store.set('daily:' + slug, o);
      try {
        if (window.BackRoomStats) {
          if (res.win) BackRoomStats.add('wins', 1);
          if (o.streak > 0) BackRoomStats.max('streak', o.streak);
        }
      } catch (e) {}
      return o;
    }
  };

  // ------------------------------------------------------------------ page shell: top bar, modals, toast, share
  var ICONS = {
    help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4"/><path d="M12 17.6h.01"/></svg>',
    stats: '<svg viewBox="0 0 24 24"><path d="M5 20V12M12 20V5M19 20v-9"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };
  function countdown() {
    var n = new Date(), m = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1), s = Math.max(0, Math.floor((m - n) / 1000));
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60);
  }
  function copyText(t) {
    function fallback() {
      var a = h('textarea', { readonly: '', style: 'position:fixed;left:-9999px;top:0' }); a.value = t; document.body.appendChild(a); a.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} a.remove(); return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fallback(); });
    return Promise.resolve(fallback());
  }
  var FOOT = 'A new word every day at midnight, your time, the same for everyone. Unlimited mode gives you random words that don\'t count towards your stats. ' +
    'Closeness comes from GloVe word vectors (Stanford NLP, public domain), which learned what words mean from the way they are used in Wikipedia and news stories, so a few neighbours can be surprising.';
  function shell(o) {
    Daily.load(o.slug); // clears a streak that ended before yesterday
    var top = h('header', { id: 'top' }, [
      h('a', { class: 'pill', href: '/e63334287a3deaa3/daily/', id: 'back', text: '‹ Back' }),
      h('h1', { html: o.name + '<span>' + (o.sub || '') + '</span>' }),
      h('span', { class: 'sp' }),
      h('button', { class: 'pill ico', id: 'helpBtn', 'aria-label': 'How to play', title: 'How to play', html: ICONS.help }),
      h('button', { class: 'pill ico', id: 'statsBtn', 'aria-label': 'Statistics', title: 'Statistics', html: ICONS.stats })
    ]);
    document.body.insertBefore(top, document.body.firstChild);
    var toastEl = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastEl);
    var tT = 0;
    function toast(msg, ms) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(tT); tT = setTimeout(function () { toastEl.classList.remove('on'); }, ms || 1800); }
    var open = null, lastFocus = null;
    function modal(title, body, label) {
      close();
      var box = h('div', { class: 'box', role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title }, [
        h('button', { class: 'pill ico x', 'aria-label': 'Close', html: ICONS.x, onclick: close }),
        h('h2', { text: title }), body]);
      var m = h('div', { class: 'modal', onclick: function (e) { if (e.target === m) close(); } }, [box]);
      lastFocus = document.activeElement; document.body.appendChild(m); open = m; box.querySelector('.x').focus();
      return m;
    }
    function close() { if (open) { open.remove(); open = null; if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {} } }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) { e.preventDefault(); close(); } }, true);
    function openHelp() {
      store.set(o.slug + ':seen', 1);
      modal('How to play', h('div', { html: o.how + '<p class="foot">' + FOOT + ' · <a href="/privacy.html">Privacy</a></p>' }));
    }
    var cdTimer = 0;
    function openStats(meKey) {
      var s = Daily.load(o.slug), max = 1;
      o.dist.forEach(function (d) { max = Math.max(max, s.dist[d[0]] || 0); });
      var played = s.played, pct = played ? Math.round(100 * s.wins / played) : 0;
      var body = h('div', null, [
        h('div', { class: 'st4' }, [
          h('div', { html: '<b>' + played + '</b><small>Played</small>' }),
          h('div', { html: '<b>' + pct + '</b><small>Win %</small>' }),
          h('div', { html: '<b>' + s.streak + '</b><small>Current streak</small>' }),
          h('div', { html: '<b>' + s.maxStreak + '</b><small>Max streak</small>' })]),
        h('h3', { text: 'Guesses to find the word' }),
        h('div', { class: 'dist' }, o.dist.map(function (d) {
          var n = s.dist[d[0]] || 0;
          return h('div', null, [h('span', { text: d[1] }), h('i', { class: d[0] === meKey ? 'me' : '', style: 'width:' + Math.max(8, Math.round(100 * n / max)) + '%', text: String(n) })]);
        })),
        h('h3', { text: 'Next word in' }),
        h('div', { class: 'row', style: 'display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap' }, [
          h('span', { class: 'cd', id: 'cd', text: countdown() }),
          o.shareText && o.shareText() ? h('button', { class: 'cta', text: 'Share', onclick: function () { share(); } }) : null])
      ]);
      modal('Statistics', body);
      clearInterval(cdTimer); cdTimer = setInterval(function () { var c = $('cd'); if (!c) { clearInterval(cdTimer); return; } c.textContent = countdown(); }, 1000);
    }
    function share() {
      var t = o.shareText && o.shareText(); if (!t) return;
      copyText(t).then(function (ok) { toast(ok ? 'Copied! Paste it anywhere.' : 'Couldn\'t copy, sorry'); });
    }
    $('helpBtn').addEventListener('click', openHelp);
    $('statsBtn').addEventListener('click', function () { openStats(); });
    if (!store.get(o.slug + ':seen', 0)) setTimeout(openHelp, 250);
    return { toast: toast, modal: modal, openHelp: openHelp, openStats: openStats, close: close, share: share, isOpen: function () { return !!open; } };
  }

  // ------------------------------------------------------------------ guess box: one word, Enter, on-screen keyboard
  var touch = (function () { try { return matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0); } catch (e) { return false; } })();
  function entry(o) {
    // o: {parent, kbParent, onWord(text) -> true if the box should clear}
    var input = h('input', { type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'go', maxlength: '24', placeholder: 'Type a word…', 'aria-label': 'Your guess' });
    var go = h('button', { type: 'button', class: 'cta', text: 'Guess' });
    var wrap = h('div', { class: 'inrow' }, [input, go]), kb = null, sys = false;
    if (touch) {
      input.setAttribute('inputmode', 'none');
      kb = h('div', { class: 'kb', 'aria-hidden': 'true' });
      ['qwertyuiop', 'asdfghjkl', '⌨zxcvbnm⌫'].forEach(function (row) {
        var r = h('div');
        Array.from(row).forEach(function (ch) {
          var b = h('button', { type: 'button', tabindex: '-1', text: ch === '⌨' ? 'abc' : ch });
          if (ch === '⌫' || ch === '⌨') b.className = 'w';
          if (ch === '⌨') b.title = 'Use your phone\'s keyboard';
          b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
          b.addEventListener('click', function () {
            if (ch === '⌫') input.value = input.value.slice(0, -1);
            else if (ch === '⌨') { sys = !sys; input.setAttribute('inputmode', sys ? 'text' : 'none'); input.blur(); setTimeout(function () { input.focus(); }, 30); return; }
            else if (input.value.length < 24) input.value += ch;
          });
          r.appendChild(b);
        });
        kb.appendChild(r);
      });
      (o.kbParent || o.parent).appendChild(kb);
    }
    function bad() { input.classList.remove('bad'); void input.offsetWidth; input.classList.add('bad'); }
    function submit() { var t = input.value; if (!t.trim()) return; if (o.onWord(t) !== false) input.value = ''; else bad(); }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    input.addEventListener('animationend', function () { input.classList.remove('bad'); });
    go.addEventListener('click', submit);
    // physical keyboard typing goes to the box even when it isn't focused (but not while a dialog is open)
    document.addEventListener('keydown', function (e) {
      if (wrap.hidden || !wrap.isConnected || document.activeElement === input || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.modal')) return;
      if (/^[a-zA-Z]$/.test(e.key)) input.focus({ preventScroll: true });
    });
    o.parent.appendChild(wrap);
    return {
      el: wrap, input: input, kb: kb,
      enable: function (on) { wrap.hidden = !on; if (kb) kb.hidden = !on; },
      clear: function () { input.value = ''; },
      focus: function () { if (!touch) try { input.focus({ preventScroll: true }); } catch (e) {} },
      submitText: function (t) { input.value = t; submit(); }
    };
  }

  function shareText(name, n, line, rest, mode) {
    return name + (mode === 'free' ? ' (unlimited)' : n >= 1 ? ' #' + n : ' (preview)') + ' ' + line + (rest ? '\n' + rest : '') + '\nascoding11.github.io';
  }
  function bucket(dist, n) { for (var i = 0; i < dist.length; i++) if (dist[i][2] != null && n <= dist[i][2]) return dist[i][0]; return dist[dist.length - 2][0]; }

  // ------------------------------------------------------------------ the game page both games share
  // cfg: slug, name, how (html), dist [[key, label, maxGuesses]...] with 'X' last, row(g, p) -> [elements],
  //      rowClass(g) extra class, order(a, b) for the sorted list, shareLine(st, p) / shareRest(st, p) share text,
  //      endLine(st, p) -> html, empty (html shown before the first guess), closest(i, p) -> [elements] for the
  //      closest-words list and closestNote above it
  // Saved progress: '<slug>:day' {day, file, g: [[word, hint 0/1]...], done, win, t0, t1} and '<slug>:free' (same, unlimited).
  function game(cfg) {
    var SLUG = cfg.slug, st = null, P = null, gen = 0;
    var S = shell({ slug: SLUG, name: cfg.name, how: cfg.how, dist: cfg.dist, shareText: function () { return st && st.done && P ? shareNow() : null; } });
    var root = $('game');
    var headEl = h('div', { class: 'head' }), listEl = h('div', { class: 'list', id: 'list', 'aria-live': 'polite' }), ctl = h('div', { class: 'ctl' });
    root.append(headEl, h('div', { class: 'listbox' }, [listEl]), ctl);
    var bD = h('button', { type: 'button', text: 'Daily' }), bU = h('button', { type: 'button', text: 'Unlimited' });
    var info = h('span', { class: 'info' });
    headEl.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Mode' }, [bD, bU]), info);
    bD.onclick = function () { start('daily'); }; bU.onclick = function () { start('free'); };
    var lastEl = h('div', { class: 'last', 'aria-live': 'polite' });
    var acts = h('div', { class: 'acts' }), hintB = h('button', { type: 'button', class: 'ghost', text: '💡 Hint' }), quitB = h('button', { type: 'button', class: 'ghost', text: 'Give up' });
    var newB = h('button', { type: 'button', class: 'ghost', text: 'New word', hidden: '' });
    acts.append(hintB, quitB, newB);
    var endBox = h('div', { class: 'end', hidden: '' });
    ctl.append(lastEl);
    var box = entry({ parent: ctl, onWord: guessText });
    ctl.append(acts, endBox);
    if (box.kb) ctl.appendChild(box.kb);
    if (touch) document.body.classList.add('touch');
    hintB.onclick = hint; quitB.onclick = askGiveUp; newB.onclick = function () { start('free', null, true); };

    function key() { return SLUG + ':' + (st.mode === 'daily' ? 'day' : 'free'); }
    function save() { store.set(key(), { day: st.day, file: st.file, g: st.g.map(function (x) { return [P ? P.words.list[x.w] : x.word, x.hint ? 1 : 0]; }), done: st.done, win: st.win, t0: st.t0, t1: st.t1 }); }
    function start(mode, file, fresh) {
      var my = ++gen, saved = null, dn = dayNum(today());
      bD.textContent = dn >= 1 ? 'Daily #' + dn : 'Daily';
      bD.classList.toggle('on', mode === 'daily'); bU.classList.toggle('on', mode === 'free');
      bD.setAttribute('aria-pressed', mode === 'daily'); bU.setAttribute('aria-pressed', mode === 'free');
      if (mode === 'daily') {
        var day = today(); saved = store.get(SLUG + ':day', null);
        st = { mode: 'daily', day: day, file: fileFor(SLUG, day), g: [], done: false, win: false, t0: 0, t1: 0 };
        if (!(saved && saved.day === day && saved.file === st.file)) saved = null;
      } else {
        saved = fresh ? null : store.get(SLUG + ':free', null);
        if (file == null && saved && saved.file >= 0 && saved.file < COUNT && !saved.done) file = saved.file; else saved = null;
        if (file == null) { var avoid = fileFor(SLUG, today()), last = st && st.mode === 'free' ? st.file : -1; do { file = Math.floor(Math.random() * COUNT); } while ((file === avoid || file === last) && COUNT > 2); }
        st = { mode: 'free', day: '', file: file, g: [], done: false, win: false, t0: 0, t1: 0 };
      }
      P = null; lastW = -1; box.clear(); render(); listEl.innerHTML = ''; listEl.appendChild(h('div', { class: 'hint', text: 'Loading the words…' }));
      loadPuzzle(st.file).then(function (p) {
        if (my !== gen) return;
        P = p;
        if (saved && Array.isArray(saved.g)) {
          saved.g.forEach(function (x) { var w = Array.isArray(x) ? x[0] : x, n = p.words.num.get(w); if (n != null && !used(n)) st.g.push({ w: n, hint: !!(Array.isArray(x) && x[1]), info: p.info(n) }); });
          st.done = !!saved.done; st.win = !!saved.win; st.t0 = saved.t0 || 0; st.t1 = saved.t1 || 0;
          if (st.done && !st.win && !used(p.secret)) st.reveal = true;
        }
        if (mode === 'free') save();
        render(); box.focus();
      }).catch(function () {
        if (my !== gen) return;
        listEl.innerHTML = '';
        listEl.appendChild(h('div', { class: 'hint' }, ['Couldn\'t load the words. Check your connection, then ', h('button', { type: 'button', class: 'ghost', text: 'Try again', onclick: function () { start(mode, file); } })]));
      });
    }
    function used(n) { for (var i = 0; i < st.g.length; i++) if (st.g[i].w === n) return st.g[i]; return null; }
    var lastW = -1;
    function guessText(t) {
      if (!st || st.done) return false;
      if (!P) { S.toast('Still loading, one moment'); return false; }
      var w = t.trim().toLowerCase().replace(/[’']/g, '');
      if (!/^[a-z]+$/.test(w)) { S.toast(/\s/.test(w) ? 'Just one word at a time' : 'Letters only, please'); return false; }
      var n = P.words.num.get(w);
      if (n == null) { S.toast('I don\'t know that word'); return false; }
      var had = used(n);
      if (had) { lastW = n; render(); S.toast('You already guessed ' + w); return true; }
      add(n, false);
      return true;
    }
    function add(n, isHint) {
      if (!st.t0) st.t0 = Date.now();
      st.g.push({ w: n, hint: isHint, info: P.info(n) });
      lastW = n;
      if (n === P.secret) finish(true);
      save(); render(true);
    }
    // A hint is the word ranked about halfway between your best guess and the secret (never the secret itself,
    // never a word you've had, never a word the game shouldn't show).
    function hint() {
      if (!st || st.done || !P) return;
      var best = P.T + 1; st.g.forEach(function (x) { best = Math.min(best, x.info.rank); });
      var target = best <= 2 ? 2 : Math.max(2, Math.min(P.T, Math.floor(best / 2)));
      var pick = -1;
      for (var d = 0; d < P.T && pick < 0; d++) {
        var cands = d ? [target + d, target - d] : [target];
        for (var c = 0; c < cands.length; c++) {
          var r = cands[c]; if (r < 2 || r > P.T || (best > 2 && r >= best)) continue;
          var wn = P.top(r - 1); if (!used(wn) && !P.words.hidden[wn]) { pick = wn; break; }
        }
      }
      if (pick < 0) for (var r2 = 2; r2 <= P.T; r2++) { var w2 = P.top(r2 - 1); if (!used(w2) && !P.words.hidden[w2]) { pick = w2; break; } }
      if (pick < 0) { S.toast('No more hints for this word'); return; }
      add(pick, true);
      S.toast('Hint: ' + P.words.list[pick]);
    }
    function askGiveUp() {
      if (!st || st.done || !P) return;
      var m = S.modal('Give up?', h('div', null, [
        h('p', { text: st.mode === 'daily' ? 'You\'ll see the word, and today counts as a loss in your stats.' : 'You\'ll see the word, then you can try another one.' }),
        h('div', { class: 'row', style: 'display:flex;gap:8px;margin-top:12px' }, [
          h('button', { type: 'button', class: 'cta coral', text: 'Show me the word', onclick: function () { S.close(); finish(false); save(); render(); } }),
          h('button', { type: 'button', class: 'ghost', text: 'Keep going', onclick: function () { S.close(); } })])]));
      return m;
    }
    function nGuesses() { return st.g.length; }
    function nHints() { return st.g.filter(function (x) { return x.hint; }).length; }
    function finish(win) {
      st.done = true; st.win = win; st.t1 = Date.now();
      if (!win && !used(P.secret)) st.reveal = true;
      var n = nGuesses();
      if (st.mode === 'daily') {
        Daily.finish(SLUG, st.day, { win: win, score: win ? n : null, tries: n, time: st.t0 ? (st.t1 - st.t0) / 1000 : null, dist: win ? bucket(cfg.dist, n) : 'X' });
        if (win) try { window.BackRoomStats && BackRoomStats.min('guesses', n); } catch (e) {}
        setTimeout(function () { if (!S.isOpen() && st && st.done) S.openStats(win ? bucket(cfg.dist, n) : 'X'); }, 1800);
      }
    }
    function shareNow() { return shareText(cfg.name, dayNum(st.day || today()), cfg.shareLine(st, P), cfg.shareRest(st, P), st.mode); }
    function rowEl(x, isNew) {
      var cls = 'g' + (x.w === P.secret ? ' win' : '') + (x.w === lastW ? ' cur' : '') + (isNew ? ' new' : '') + (cfg.rowClass ? ' ' + cfg.rowClass(x) : '');
      return h('div', { class: cls }, cfg.row(x, P, st));
    }
    function render(fresh) {
      var done = st.done, n = st.g.length;
      info.innerHTML = !P ? '' : done ? '' : n ? '<b>' + n + '</b> guess' + (n === 1 ? '' : 'es') : '';
      box.enable(!done && !!P); acts.hidden = done || !P;
      newB.hidden = st.mode !== 'free' || done || !n; quitB.disabled = !n;
      hintB.disabled = !P;
      lastEl.innerHTML = '';
      var lx = lastW >= 0 && used(lastW);
      if (lx && !done) { lastEl.appendChild(rowEl(lx, fresh)); lastEl.hidden = false; } else lastEl.hidden = true;
      if (!P) return;
      listEl.innerHTML = '';
      if (!n && !done) listEl.appendChild(h('div', { class: 'hint', html: cfg.empty }));
      var rows = st.g.slice().sort(cfg.order);
      if (done && st.reveal) rows.unshift({ w: P.secret, hint: false, info: P.info(P.secret), reveal: true });
      rows.forEach(function (x) { listEl.appendChild(rowEl(x, false)); });
      endBox.hidden = !done; endBox.innerHTML = '';
      if (done) {
        var word = P.word;
        endBox.append(
          h('h2', { class: st.win ? 'win' : 'lose', html: (st.win ? 'You found it: ' : 'The word was ') + '<u>' + word + '</u>' }),
          h('p', { html: cfg.endLine(st, P) }),
          h('div', { class: 'row' }, [
            h('button', { type: 'button', class: 'cta', text: 'Share', onclick: function () { S.share(); } }),
            h('button', { type: 'button', class: 'ghost', text: 'Closest words', onclick: showClosest }),
            h('button', { type: 'button', class: 'ghost', text: st.mode === 'daily' ? 'Play unlimited' : 'Next word', onclick: function () { start('free', null, true); } })]),
          st.mode === 'daily' ? h('div', { class: 'next', id: 'nextIn', text: 'Next word in ' + countdown() }) : null);
        listEl.scrollTop = 0;
      }
      if (fresh && !done) listEl.scrollTop = 0; // best guesses first; the newest one is also shown on its own
    }
    // After the game: the 100 words closest to the secret.
    function showClosest() {
      if (!P) return;
      var lst = h('div', { class: 'closest' }), shown = 0;
      for (var i = 1; i < P.T && shown < 100; i++) {
        var wn = P.top(i); if (P.words.hidden[wn]) continue; shown++;
        lst.appendChild(h('div', { class: 'cw' + (used(wn) ? ' had' : '') }, cfg.closest(i, P)));
      }
      S.modal('Closest to “' + P.word + '”', h('div', null, [h('p', { text: cfg.closestNote }), lst]));
    }
    setInterval(function () {
      var e = $('nextIn'); if (e) e.textContent = 'Next word in ' + countdown();
      if (st && st.mode === 'daily' && st.day !== today() && !box.input.value) start('daily');
    }, 1000);
    start('daily');
    box.focus();
    return {
      get st() { return st; }, get P() { return P; }, start: start, guess: function (t) { box.submitText(t); }, hint: hint,
      giveUp: function () { if (st && !st.done && P) { finish(false); save(); render(); } }, shareText: function () { return st && st.done && P ? shareNow() : null; }, showClosest: showClosest
    };
  }

  window.Sem = {
    $: $, h: h, store: store, fmt: fmt, today: today, addDays: addDays, dayNum: dayNum, fileFor: fileFor, COUNT: COUNT, LAUNCH: LAUNCH,
    loadWords: loadWords, loadPuzzle: loadPuzzle, inflate: inflate, Daily: Daily, game: game, touch: touch, countdown: countdown
  };
  if (navigator.webdriver) window.__sem = { setToday: function (k) { DAY_TEST = /^\d{8}$/.test(k) ? k : ''; }, forceJsInflate: function (on) { FORCE_JS = !!on; }, get dayTest() { return DAY_TEST; } };
})();
