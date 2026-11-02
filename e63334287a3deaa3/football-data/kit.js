/*
 * Shared kit for the daily soccer games (loaded after players.js). Sets window.FBK.
 *
 * - Top bar (‹ Back to the daily hub, the game's name, How to play, Stats), the two modals and a toast.
 * - The daily: today is the player's LOCAL date as YYYYMMDD; puzzle #1 is 2026-11-01 and the number goes up by one a day.
 *   dailyIndex(n, salt) walks a fixed shuffled order of the n puzzles, so nothing repeats until all n have been used.
 * - The storage contract the daily hub reads: localStorage 'daily:<slug>' =
 *   { v:1, days:{ YYYYMMDD:{done,win,score,tries,time} } (last 60 days), played, wins, streak, maxStreak, last, dist:{} }.
 *   streak counts consecutive daily wins ending today or yesterday (it is reset to 0 on load once it has lapsed).
 *   Anything else a game keeps (in-progress boards, unlimited stats) lives under '<slug>:...'.
 * - Leaderboard hooks (stats.js): add('wins',1) on a daily win, max('streak',n), plus the game's own best via finish({best}).
 * - picker(): the player-name box with suggestions; accents, case and punctuation never matter, and unique surnames work.
 * Test hook (automated browsers only): ?day=YYYYMMDD fakes today's date, and window.__fb exposes the helpers.
 */
(function () {
  'use strict';
  var F = window.FOOTBALL;
  var $ = function (id) { return document.getElementById(id); };
  var HUB = '/e63334287a3deaa3/daily/';
  var LAUNCH = new Date(2026, 10, 1);
  var SITE = 'ascoding11.github.io';
  var NOTE = 'Stats from public records as of 2025; spotted a mistake? ';

  // ---------- small helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function shuffle(a, rng) { rng = rng || Math.random; for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function norm(s) {
    s = String(s == null ? '' : s).toLowerCase()
      .replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/đ/g, 'd').replace(/ł/g, 'l').replace(/ı/g, 'i').replace(/œ/g, 'oe')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/&/g, ' and ').replace(/['’`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    return s;
  }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { } }
  };

  // ---------- dates ----------
  var TEST_DAY = '';
  try { if (navigator.webdriver) { var m0 = /[?&]day=(\d{8})\b/.exec(location.search); if (m0) TEST_DAY = m0[1]; } } catch (e) { }
  function dayKey(d) { return String(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()); }
  function today() { return TEST_DAY || dayKey(new Date()); }
  function keyDate(k) { return new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)); }
  function addDays(k, n) { var d = keyDate(k); d.setDate(d.getDate() + n); return dayKey(d); }
  function dayNo(k) { return Math.round((keyDate(k || today()) - LAUNCH) / 864e5) + 1; }
  var permCache = {};
  function dailyIndex(n, salt, k) {
    if (!(n > 0)) return 0;
    var ck = salt + ':' + n;
    if (!permCache[ck]) { var a = []; for (var i = 0; i < n; i++) a.push(i); permCache[ck] = shuffle(a, mulberry32(hash('fb:' + salt))); }
    var d = dayNo(k) - 1;
    return permCache[ck][((d % n) + n) % n];
  }
  function label(k) { var n = dayNo(k); return n >= 1 ? '#' + n : 'Preview'; }
  function dateText(k) { return keyDate(k || today()).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }

  // ---------- players ----------
  var PL = F.players;
  var surnameCount = {};
  PL.forEach(function (p) { var w = norm(p.name).split(' '); var last = w[w.length - 1]; surnameCount[last] = (surnameCount[last] || 0) + 1; });
  var exact = {};    // normalised name/alias -> [player ids]
  function addExact(t, id) { if (!t) return; (exact[t] = exact[t] || []); if (exact[t].indexOf(id) < 0) exact[t].push(id); }
  PL.forEach(function (p) {
    var n = norm(p.name); p.key = n; addExact(n, p.id);
    var w = n.split(' '); if (w.length > 1 && surnameCount[w[w.length - 1]] === 1) addExact(w[w.length - 1], p.id);
    if (w.length > 2) addExact(w.slice(1).join(' '), p.id);
    p.aliases.forEach(function (a) { addExact(norm(a), p.id); });
    p.terms = [n].concat(p.aliases.map(norm));
  });
  function resolvePlayer(text) {
    var ids = exact[norm(text)];
    if (ids && ids.length === 1) return PL[ids[0]];
    return null;
  }
  var playerItems = PL.map(function (p) { return { key: p.id, label: p.name, terms: p.terms, p: p }; });

  // ---------- clubs and nations ----------
  function club(c) { return F.CLUBS[c] || [c, '', '#888', '#555']; }
  function chip(c, txt) {
    var k = club(c);
    return '<span class="chip"><i style="background:linear-gradient(135deg,' + k[2] + ' 50%,' + k[3] + ' 50%)"></i><span>' + esc(txt == null ? k[0] : txt) + '</span></span>';
  }
  function nation(code) { return (F.NATIONS[code] || [code])[0]; }
  function continent(code) { return (F.NATIONS[code] || ['', ''])[1]; }
  function league(code) { return F.LEAGUES[code] || code; }
  var POS = { GK: 'Goalkeeper', DF: 'Defender', MF: 'Midfielder', FW: 'Forward' };

  // ---------- page chrome ----------
  var cfg = {};
  var SVG_STATS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z"/></svg>';
  function setup(c) {
    cfg = c;
    document.title = c.name;
    var top = document.createElement('div'); top.id = 'top';
    top.innerHTML = '<a class="pill" id="fbBack" href="' + HUB + '" target="_top">‹ Back</a>' +
      '<div id="topName">' + esc(c.name) + '<small>' + esc(c.kicker || 'Daily soccer') + '</small></div>' +
      '<button class="pill ico" id="fbHelp" type="button" aria-label="How to play" title="How to play">?</button>' +
      '<button class="pill ico" id="fbStats" type="button" aria-label="Stats" title="Stats">' + SVG_STATS + '</button>';
    document.body.insertBefore(top, document.body.firstChild);
    var how = document.createElement('div'); how.className = 'modal'; how.id = 'fbHow'; how.hidden = true;
    how.setAttribute('role', 'dialog'); how.setAttribute('aria-modal', 'true'); how.setAttribute('aria-labelledby', 'fbHowT');
    how.innerHTML = '<div class="box"><button class="pill ico x" type="button" aria-label="Close" data-close>×</button><h2 id="fbHowT">How to play</h2>' + c.how +
      '<p class="eg">' + esc(NOTE) + 'Tell Arjun. Everything is checked against this game\'s own list of about ' + Math.round(PL.length / 10) * 10 + ' well-known players.</p>' +
      '<div class="row c" style="margin-top:14px"><button class="cta" type="button" data-close>Let\'s play</button></div></div>';
    document.body.appendChild(how);
    var st = document.createElement('div'); st.className = 'modal'; st.id = 'fbSt'; st.hidden = true;
    st.setAttribute('role', 'dialog'); st.setAttribute('aria-modal', 'true'); st.setAttribute('aria-labelledby', 'fbStT');
    st.innerHTML = '<div class="box"><button class="pill ico x" type="button" aria-label="Close" data-close>×</button><h2 id="fbStT">Your stats</h2>' +
      '<div class="st4"><div><b id="fbP">0</b><small>Played</small></div><div><b id="fbW">0</b><small>Win %</small></div><div><b id="fbS">0</b><small>Streak</small></div><div><b id="fbM">0</b><small>Best streak</small></div></div>' +
      '<span class="lbl" id="fbDL">' + esc(c.distLabel || 'Guess distribution') + '</span><div class="dist" id="fbD"></div>' +
      '<div class="next"><div><span class="lbl" style="margin:0">Next puzzle in</span><b id="fbCd">--:--:--</b></div><button class="cta" type="button" id="fbShare2">Share</button></div>' +
      '<p class="pmsg" id="fbStMsg"></p></div>';
    document.body.appendChild(st);
    var t = document.createElement('div'); t.id = 'toast'; t.setAttribute('aria-live', 'polite'); document.body.appendChild(t);
    [how, st].forEach(function (mo) {
      mo.addEventListener('click', function (e) { if (e.target === mo || (e.target.closest && e.target.closest('[data-close]'))) closeModal(mo); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (!how.hidden) closeModal(how); if (!st.hidden) closeModal(st); } });
    $('fbHelp').addEventListener('click', function () { openModal(how); });
    $('fbStats').addEventListener('click', openStats);
    $('fbShare2').addEventListener('click', function () { if (cfg.shareText) share(cfg.shareText(), $('fbStMsg')); });
    var wrap = document.querySelector('.wrap');
    if (wrap) { var n = document.createElement('p'); n.className = 'note'; n.innerHTML = esc(NOTE) + '<a href="/e63334287a3deaa3/" target="_top">Tell Arjun</a>.'; wrap.appendChild(n); }
    if (!store.get(c.slug + ':seen', false)) { store.set(c.slug + ':seen', true); openModal(how); }
    normaliseDaily(c.slug);
  }
  var lastFocus = null;
  function openModal(mo) { lastFocus = document.activeElement; mo.hidden = false; var b = mo.querySelector('[data-close]'); if (b) b.focus({ preventScroll: true }); }
  function closeModal(mo) { mo.hidden = true; if (mo.id === 'fbSt') clearInterval(cdT); if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) { } }
  var cdT = 0;
  function countdown() {
    var now = new Date(), nx = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), s = Math.max(0, Math.floor((nx - now) / 1000));
    var h = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
  }
  function openStats() {
    var o = loadDaily(cfg.slug), t = today();
    $('fbP').textContent = o.played; $('fbW').textContent = o.played ? Math.round(100 * o.wins / o.played) : 0;
    $('fbS').textContent = o.streak; $('fbM').textContent = o.maxStreak;
    var keys = cfg.distKeys || [], max = 1, mine = o.days[t] && o.days[t].done ? String(o.days[t].dist) : null, html = '';
    keys.forEach(function (k) { max = Math.max(max, o.dist[k] || 0); });
    keys.forEach(function (k) {
      var v = o.dist[k] || 0, w = Math.max(8, Math.round(100 * v / max));
      html += '<span>' + esc(cfg.distName ? cfg.distName(k) : k) + '</span><div><i' + (k === mine ? ' class="me"' : '') + ' style="width:' + w + '%">' + v + '</i></div>';
    });
    $('fbD').innerHTML = html;
    var done = !!(o.days[t] && o.days[t].done);
    $('fbShare2').hidden = !done || !cfg.shareText; $('fbStMsg').textContent = '';
    $('fbCd').textContent = countdown(); clearInterval(cdT); cdT = setInterval(function () { $('fbCd').textContent = countdown(); }, 1000);
    openModal($('fbSt'));
  }

  // ---------- storage contract ----------
  function blank() { return { v: 1, days: {}, played: 0, wins: 0, streak: 0, maxStreak: 0, last: '', dist: {} }; }
  function loadDaily(slug) {
    var o = store.get('daily:' + slug, null);
    if (!o || o.v !== 1 || typeof o !== 'object') o = blank();
    if (!o.days || typeof o.days !== 'object') o.days = {};
    if (!o.dist || typeof o.dist !== 'object') o.dist = {};
    ['played', 'wins', 'streak', 'maxStreak'].forEach(function (k) { o[k] = Math.max(0, Math.floor(+o[k] || 0)); });
    return o;
  }
  function normaliseDaily(slug) {
    var o = loadDaily(slug), t = today(), y = addDays(t, -1);
    if (o.streak && o.last !== t && o.last !== y) { o.streak = 0; store.set('daily:' + slug, o); }
  }
  // res: {win, score, tries, time, dist (distribution key), best: function(BackRoomStats)}
  function finish(res) {
    var slug = cfg.slug, o = loadDaily(slug), t = today(), y = addDays(t, -1);
    if (o.days[t] && o.days[t].done) return o;
    o.days[t] = { done: true, win: !!res.win, score: res.score == null ? null : res.score, tries: res.tries == null ? null : res.tries, time: res.time == null ? null : Math.round(res.time), dist: res.dist == null ? null : String(res.dist) };
    o.played++;
    if (res.win) { o.wins++; o.streak = (o.last === y || o.last === t ? o.streak : 0) + 1; } else o.streak = 0;
    o.maxStreak = Math.max(o.maxStreak, o.streak);
    o.last = t;
    if (res.dist != null) o.dist[String(res.dist)] = (o.dist[String(res.dist)] || 0) + 1;
    var cut = addDays(t, -59);
    Object.keys(o.days).forEach(function (k) { if (!/^\d{8}$/.test(k) || k < cut || k > t) delete o.days[k]; });
    store.set('daily:' + slug, o);
    var S = window.BackRoomStats;
    if (S) {
      try {
        if (res.win) S.add('wins', 1);
        if (o.streak > 0) S.max('streak', o.streak);
        if (res.best) res.best(S);
      } catch (e) { }
    }
    return o;
  }
  function todayDone() { var o = loadDaily(cfg.slug), d = o.days[today()]; return d && d.done ? d : null; }
  // Unlimited mode keeps its own small record and never touches the daily stats.
  function unlimited(win) {
    var k = cfg.slug + ':unl', u = store.get(k, null) || { played: 0, wins: 0, streak: 0, best: 0 };
    if (win != null) { u.played++; if (win) { u.wins++; u.streak++; u.best = Math.max(u.best, u.streak); } else u.streak = 0; store.set(k, u); }
    return u;
  }

  // ---------- share and toast ----------
  function toast(msg, ms) {
    var t = $('toast'); if (!t) return; t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('on'); }, ms || 1800);
  }
  function share(text, msgEl) {
    var ok = function () { if (msgEl) msgEl.textContent = 'Copied! Paste it anywhere.'; toast('Copied to clipboard'); };
    var fallback = function () {
      try {
        var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
        var good = document.execCommand('copy'); document.body.removeChild(ta); if (good) { ok(); return; }
      } catch (e) { }
      if (msgEl) msgEl.textContent = text;
    };
    window.__fbLastShare = text;
    if (navigator.share && window.matchMedia && matchMedia('(pointer: coarse)').matches && !navigator.webdriver) { navigator.share({ text: text }).catch(function () { }); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
  }
  function shareHead(n) { return cfg.name + ' ' + (n || label(today())); }

  // ---------- picker ----------
  // opts: {items (default: every player), placeholder, button, used: function(item)->bool, onPick(item) -> true to clear}
  function picker(host, opts) {
    opts = opts || {};
    var items = opts.items || playerItems;
    host.classList.add('pick');
    host.innerHTML = '<form autocomplete="off"><input type="text" enterkeyhint="go" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="40" aria-autocomplete="list" role="combobox" aria-expanded="false"><button class="cta" type="submit">' + esc(opts.button || 'Guess') + '</button></form><ul class="sugg" role="listbox" hidden></ul><p class="pmsg"></p>';
    var form = host.querySelector('form'), inp = host.querySelector('input'), ul = host.querySelector('ul'), msg = host.querySelector('.pmsg');
    inp.placeholder = opts.placeholder || 'Type a player…';
    inp.setAttribute('aria-label', opts.placeholder || 'Player name');
    var list = [], hi = -1;
    function score(it, q) {
      var best = 0;
      for (var i = 0; i < it.terms.length; i++) {
        var t = it.terms[i];
        if (t === q) return 100;
        if (t.indexOf(q) === 0) best = Math.max(best, 80 - Math.min(20, t.length - q.length) / 2);
        else if (t.indexOf(' ' + q) >= 0) best = Math.max(best, 60);
        else if (q.length >= 3 && t.indexOf(q) >= 0) best = Math.max(best, 30);
      }
      return best;
    }
    function render() {
      var q = norm(inp.value);
      if (!q) { list = []; ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); return; }
      var sc = [];
      items.forEach(function (it) { var s = score(it, q); if (s > 0) sc.push([s, it]); });
      sc.sort(function (a, b) { return b[0] - a[0] || (a[1].label < b[1].label ? -1 : 1); });
      list = sc.slice(0, 8).map(function (x) { return x[1]; });
      hi = list.length ? 0 : -1;
      ul.innerHTML = list.map(function (it, i) {
        var used = opts.used && opts.used(it);
        return '<li role="option" data-i="' + i + '"' + (i === hi ? ' class="on"' : '') + (used ? ' class="used"' : '') + '>' + esc(it.label) + (it.sub ? '<small>' + esc(it.sub) + '</small>' : '') + (used ? '<small>already used</small>' : '') + '</li>';
      }).join('') || '<li style="cursor:default;color:var(--ink-3)">No match in our list</li>';
      ul.hidden = false; inp.setAttribute('aria-expanded', 'true');
      // Open upwards when the on-screen keyboard leaves no room below the box.
      var r = inp.getBoundingClientRect(), vh = (window.visualViewport ? visualViewport.height : innerHeight);
      ul.classList.toggle('up', vh - r.bottom < 200 && r.top > vh - r.bottom);
    }
    function mark() { Array.prototype.forEach.call(ul.children, function (li, i) { li.classList.toggle('on', i === hi); if (i === hi && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' }); }); }
    function choose(it) {
      if (!it) return;
      if (opts.used && opts.used(it)) { setMsg('You already used ' + it.label + '.', 'bad'); return; }
      var r = opts.onPick(it);
      if (r !== false) { inp.value = ''; render(); }
      if (!matchMedia('(pointer: coarse)').matches) inp.focus();
    }
    function setMsg(t, cls) { msg.textContent = t || ''; msg.className = 'pmsg' + (cls ? ' ' + cls : ''); }
    inp.addEventListener('input', function () { setMsg(''); render(); });
    inp.addEventListener('focus', function () {
      render();
      if (matchMedia('(pointer: coarse)').matches) setTimeout(function () { try { host.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { } }, 300);
    });
    inp.addEventListener('blur', function () { setTimeout(function () { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); }, 150); });
    inp.addEventListener('keydown', function (e) {
      if (ul.hidden || !list.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); hi = (hi + 1) % list.length; mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hi = (hi - 1 + list.length) % list.length; mark(); }
      else if (e.key === 'Escape') { ul.hidden = true; }
    });
    ul.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    ul.addEventListener('click', function (e) { var li = e.target.closest('li[data-i]'); if (li) choose(list[+li.getAttribute('data-i')]); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = norm(inp.value); if (!q) return;
      var ex = items.filter(function (it) { return it.terms.indexOf(q) >= 0; });
      if (ex.length === 1) return choose(ex[0]);
      var rp = resolvePlayer(q);
      if (rp) { var hit = items.filter(function (it) { return it.p === rp; })[0]; if (hit) return choose(hit); }
      if (!ul.hidden && hi >= 0 && list[hi]) return choose(list[hi]);
      if (list.length === 1) return choose(list[0]);
      setMsg(list.length ? 'Pick a name from the list.' : 'That name isn\'t in our list of players.', 'bad');
      host.classList.remove('shake'); void host.offsetWidth; host.classList.add('shake');
    });
    return { input: inp, msg: setMsg, disable: function (on) { inp.disabled = on; form.querySelector('button').disabled = on; if (on) ul.hidden = true; }, focus: function () { inp.focus(); }, refresh: render };
  }

  var api = {
    F: F, PL: PL, esc: esc, norm: norm, hash: hash, rng: mulberry32, shuffle: shuffle, store: store,
    today: today, dayKey: dayKey, addDays: addDays, dayNo: dayNo, dailyIndex: dailyIndex, label: label, dateText: dateText,
    resolvePlayer: resolvePlayer, playerItems: playerItems, club: club, chip: chip, nation: nation, continent: continent, league: league, POS: POS,
    setup: setup, openStats: openStats, openModal: openModal, finish: finish, todayDone: todayDone, loadDaily: loadDaily, unlimited: unlimited,
    toast: toast, share: share, shareHead: shareHead, picker: picker, SITE: SITE, $: $,
    cfg: function () { return cfg; }
  };
  window.FBK = api;
  if (navigator.webdriver) window.__fb = { api: api, setToday: function (k) { TEST_DAY = /^\d{8}$/.test(k) ? k : ''; }, exact: exact };
})();
