/*
 * Shared code for the Back Room daily geography games: Hotspot, Outline, Unfurl and Overland.
 * Load after countries.js (and shapes.js when the game draws maps). Sets window.Geo:
 *   data      Geo.list, Geo.byId, Geo.find(text), Geo.suggest(text, n, filter), Geo.norm(text)
 *   distance  Geo.km(a, b) between label points, Geo.bearing(a, b), Geo.arrow(deg), Geo.borderKm(a, b) nearest borders
 *   shapes    Geo.rings(id) decoded outlines, Geo.loadShapes() (adds shapes.js if the page didn't), Geo.Globe (canvas globe)
 *   days      Geo.today(), Geo.dayNum(key) (2026-11-01 is #1), Geo.answerFor(game, key), Geo.pairFor(key), Geo.rng(seed)
 *   storage   Geo.Daily.load/finish (the daily:<slug> record the hub reads)
 *   page      Geo.shell({...}) top bar, How to play, Stats, toast, share; Geo.entry({...}) guess box + on-screen keyboard
 * Everything runs in the browser with no libraries. A test hook (window.__geo) exists only when navigator.webdriver is set.
 */
(function () {
  'use strict';
  var D2R = Math.PI / 180, R_EARTH = 6371;
  var LAUNCH = '20261101';
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

  // ------------------------------------------------------------------ data
  var RAW = (window.GEO_DATA && window.GEO_DATA.list) || [];
  var list = [], byId = {};
  RAW.forEach(function (r) {
    var c = { id: r[0], name: r[1], aliases: r[2] ? r[2].split('|') : [], cont: r[3], lon: r[4], lat: r[5], level: r[6], area: r[7], nb: r[8] ? r[8].split(' ') : [] };
    list.push(c); byId[c.id] = c;
  });
  var CONT_NAME = { af: 'Africa', as: 'Asia', eu: 'Europe', na: 'North America', sa: 'South America', oc: 'Oceania', an: 'Antarctica' };
  function norm(s) {
    s = String(s || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    s = s.replace(/&/g, ' and ').replace(/\bst\.?\s/g, 'saint ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
    return s;
  }
  var exact = {}, keys = [];
  list.forEach(function (c) {
    [c.name].concat(c.aliases).forEach(function (n, i) {
      var k = norm(n); if (!k) return;
      if (!exact[k]) exact[k] = c.id;
      var k2 = k.replace(/ /g, ''); if (!exact[k2]) exact[k2] = c.id;
      keys.push({ k: k, id: c.id, main: i === 0 });
    });
  });
  function find(text) { var k = norm(text); return (k && byId[exact[k] || exact[k.replace(/ /g, '')]]) || null; }
  // Suggestions: names starting with the text first, then a word starting with it, then containing it anywhere.
  function suggest(text, n, filter) {
    var q = norm(text); if (!q) return [];
    var best = {};
    keys.forEach(function (e) {
      if (filter && !filter(byId[e.id])) return;
      var s = -1;
      if (e.k === q) s = 0;
      else if (e.k.indexOf(q) === 0) s = e.main ? 1 : 2;
      else if ((' ' + e.k).indexOf(' ' + q) >= 0) s = e.main ? 3 : 4;
      else if (q.length >= 3 && e.k.replace(/ /g, '').indexOf(q.replace(/ /g, '')) >= 0) s = 5;
      if (s < 0) return;
      if (!(e.id in best) || s < best[e.id]) best[e.id] = s;
    });
    return Object.keys(best).sort(function (a, b) { return best[a] - best[b] || byId[a].name.length - byId[b].name.length || byId[a].name.localeCompare(byId[b].name); })
      .slice(0, n || 6).map(function (id) { return byId[id]; });
  }
  function pool(minLevel) { return list.filter(function (c) { return c.level >= minLevel; }).map(function (c) { return c.id; }).sort(); }

  // ------------------------------------------------------------------ distance and direction
  function hav(lat1, lon1, lat2, lon2) {
    var a = Math.sin((lat2 - lat1) * D2R / 2), b = Math.sin((lon2 - lon1) * D2R / 2);
    var x = a * a + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * b * b;
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  function km(a, b) { a = byId[a] || a; b = byId[b] || b; return hav(a.lat, a.lon, b.lat, b.lon); }
  function bearing(a, b) { // rhumb-line bearing from a to b (the direction on a flat map), degrees clockwise from north
    a = byId[a] || a; b = byId[b] || b;
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
    if (Math.abs(dl) > Math.PI) dl = dl > 0 ? dl - 2 * Math.PI : dl + 2 * Math.PI;
    var dp = Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
    return (Math.atan2(dl, dp) / D2R + 360) % 360;
  }
  var ARROWS = ['⬆️', '↗️', '➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️'];
  var DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  function arrow(deg) { return ARROWS[Math.round(deg / 45) % 8]; }
  function dirName(deg) { return DIRS[Math.round(deg / 45) % 8]; }
  function proximity(d) { return Math.max(0, Math.round(100 * (1 - d / 20015))); } // 20,015 km is half the world
  function fmtKm(d) { return d < 1 ? '0 km' : Math.round(d).toLocaleString('en-US') + ' km'; }

  // ------------------------------------------------------------------ shapes
  var ringCache = {};
  function decodeRing(s) {
    var out = [], x = 0, y = 0, i = 0, n = s.length;
    function next() { var r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20 && i <= n); return (r & 1) ? ~(r >> 1) : r >> 1; }
    while (i < n) { x += next(); y += next(); out.push(x / 1000, y / 1000); }
    return out;
  }
  function rings(id) { // [[lon,lat,lon,lat,...], ...]
    if (ringCache[id]) return ringCache[id];
    var S = window.GEO_SHAPES; if (!S || !S[id]) return [];
    return (ringCache[id] = S[id].split(' ').map(decodeRing));
  }
  var vecCache = {};
  function vecs(id) { // unit vectors of every outline point, one Float64Array per ring
    if (vecCache[id]) return vecCache[id];
    return (vecCache[id] = rings(id).map(function (r) {
      var v = new Float64Array(r.length / 2 * 3);
      for (var i = 0, j = 0; i < r.length; i += 2, j += 3) {
        var lo = r[i] * D2R, la = r[i + 1] * D2R, c = Math.cos(la);
        v[j] = c * Math.cos(lo); v[j + 1] = c * Math.sin(lo); v[j + 2] = Math.sin(la);
      }
      return v;
    }));
  }
  var bdCache = {};
  // Distance between the nearest points of two countries' borders (0 for land neighbours).
  function borderKm(a, b) {
    if (a === b) return 0;
    var key = a < b ? a + b : b + a; if (key in bdCache) return bdCache[key];
    var A = byId[a], d;
    if (A && A.nb.indexOf(b) >= 0) d = 0;
    else {
      var va = vecs(a), vb = vecs(b), best = -2;
      if (!va.length || !vb.length) d = km(a, b);
      else {
        for (var i = 0; i < va.length; i++) for (var j = 0; j < vb.length; j++) {
          var p = va[i], q = vb[j];
          for (var u = 0; u < p.length; u += 3) {
            var px = p[u], py = p[u + 1], pz = p[u + 2];
            for (var w = 0; w < q.length; w += 3) { var dt = px * q[w] + py * q[w + 1] + pz * q[w + 2]; if (dt > best) best = dt; }
          }
        }
        d = Math.acos(Math.max(-1, Math.min(1, best))) * R_EARTH;
      }
    }
    return (bdCache[key] = d);
  }
  var shapesWait = null;
  function loadShapes() {
    if (window.GEO_SHAPES) return Promise.resolve();
    if (shapesWait) return shapesWait;
    var src = (document.currentScript && document.currentScript.src) || '';
    shapesWait = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = '/e63334287a3deaa3/geo-data/shapes.js';
      s.onload = function () { res(); }; s.onerror = function () { shapesWait = null; rej(new Error('shapes')); };
      document.head.appendChild(s);
    });
    return shapesWait;
  }

  // ------------------------------------------------------------------ days and seeded choices
  var DAY_TEST = (navigator.webdriver && /^\d{8}$/.test(window.__GEO_TODAY || '')) ? window.__GEO_TODAY : ''; // tests only
  function keyOf(d) { return String(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()); }
  function today() { return DAY_TEST || keyOf(new Date()); }
  function dateOf(k) { return new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), 12); }
  function addDays(k, n) { var d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); }
  function dayNum(k) { return Math.round((dateOf(k) - dateOf(LAUNCH)) / 864e5) + 1; }
  function hash(s) { var x = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function rng(seed) { var a = typeof seed === 'number' ? seed >>> 0 : hash(String(seed)); return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(a, r) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  var orderCache = {};
  // The answers go round the pool in a shuffled order, a new order each time round, never the same country twice running.
  function cycleOrder(name, ids, cycle) {
    var key = name + ':' + cycle; if (orderCache[key]) return orderCache[key];
    var o = shuffle(ids, rng(name + '-cycle-' + cycle));
    if (cycle > 0) { var prev = cycleOrder(name, ids, cycle - 1); if (o[0] === prev[prev.length - 1]) { var t = o[0]; o[0] = o[1]; o[1] = t; } }
    return (orderCache[key] = o);
  }
  function slot(ids, name, n, off) { var L = ids.length, i = n - 1, c = Math.floor(i / L); i -= c * L; if (c < 0) c = 0; return cycleOrder(name, ids, c)[(i + (off || 0)) % L]; }
  // Hotspot and Outline share one order per round (Outline 59 places further on, so never the same country on a day); Unfurl has its own
  // larger pool (flags of small island states too) and skips forward if it would match either of the others.
  function answerFor(game, k) {
    var n = dayNum(k), main = pool(2);
    var hs = slot(main, 'geo', n), ol = slot(main, 'geo', n, 59);
    if (game === 'hotspot') return hs;
    if (game === 'outline') return ol;
    if (game === 'unfurl') {
      var fl = pool(1), x = slot(fl, 'unfurl', n), s = 0;
      while ((x === hs || x === ol) && s < 5) { s++; x = slot(fl, 'unfurl', n + s * 97); }
      return x;
    }
    return null;
  }
  // Land graph for Overland: every guessable place and its land neighbours.
  function hops(from) {
    var d = {}; d[from] = 0; var q = [from];
    for (var i = 0; i < q.length; i++) { var c = byId[q[i]]; c.nb.forEach(function (x) { if (byId[x] && !(x in d)) { d[x] = d[c.id] + 1; q.push(x); } }); }
    return d;
  }
  var MIN_STEPS = 3, MAX_STEPS = 6; // countries in between on the shortest route
  var ends = null;
  function pairEnds() { if (!ends) ends = pool(2).filter(function (id) { return byId[id].nb.length > 0 && Object.keys(hops(id)).length >= 10; }); return ends; }
  // Every pair of answer countries whose shortest overland route has MIN_STEPS to MAX_STEPS countries in between,
  // in a fixed order. The daily pair walks through a shuffled copy of the list (a new shuffle each time round), so a
  // pair doesn't come back for years; the direction (which end is the start) is picked from the date.
  var allPairs = null;
  function pairList() {
    if (allPairs) return allPairs;
    var E = pairEnds(); allPairs = [];
    E.forEach(function (a) { var d = hops(a); E.forEach(function (b) { if (a < b && d[b] - 1 >= MIN_STEPS && d[b] - 1 <= MAX_STEPS) allPairs.push([a, b]); }); });
    return allPairs;
  }
  function randomPair(r) { var P = pairList(), p = P[Math.floor(r() * P.length)]; return r() < 0.5 ? [p[0], p[1]] : [p[1], p[0]]; }
  function pairFor(k) {
    var P = pairList(), n = dayNum(k), L = P.length, i = n - 1, c = Math.floor(i / L); i -= c * L; if (c < 0) c = 0;
    var key = 'pairs:' + c, o = orderCache[key] || (orderCache[key] = shuffle(P, rng('overland-cycle-' + c)));
    var p = o[i]; return rng('overland-dir-' + k)() < 0.5 ? [p[0], p[1]] : [p[1], p[0]];
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

  // ------------------------------------------------------------------ page shell
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
  function shell(o) {
    Daily.load(o.slug); // clears a streak that ended before yesterday
    // o: {slug, name, how: html, dist: [[key,label],...], shareText: fn() -> text|null}
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
      modal('How to play', h('div', { html: o.how + '<p class="foot">A new puzzle every day at midnight, your time, the same for everyone. Unlimited mode gives you random ones that don\'t count towards your stats. Country shapes from Natural Earth (public domain).' + (o.foot || '') + ' · <a href="/privacy.html">Privacy</a></p>' }));
    }
    var cdTimer = 0;
    function openStats(meKey) {
      var s = Daily.load(o.slug), max = 1;
      o.dist.forEach(function (d) { max = Math.max(max, s.dist[d[0]] || 0); });
      var played = s.played, pct = played ? Math.round(100 * s.wins / played) : 0;
      var body = h('div', null, [
        h('div', { class: 'st4' }, [
          h('div', { html: '<b>' + played + '</b><small>Played</small>' }),
          h('div', { html: '<b>' + pct + '</b><small>' + (o.noLose ? 'Finished %' : 'Win %') + '</small>' }),
          h('div', { html: '<b>' + s.streak + '</b><small>Current streak</small>' }),
          h('div', { html: '<b>' + s.maxStreak + '</b><small>Max streak</small>' })]),
        h('h3', { text: o.distTitle || 'Guess distribution' }),
        h('div', { class: 'dist' }, o.dist.map(function (d) {
          var n = s.dist[d[0]] || 0;
          return h('div', null, [h('span', { text: d[1] }), h('i', { class: d[0] === meKey ? 'me' : '', style: 'width:' + Math.max(8, Math.round(100 * n / max)) + '%', text: String(n) })]);
        })),
        h('h3', { text: 'Next puzzle in' }),
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
    return { toast: toast, openHelp: openHelp, openStats: openStats, close: close, share: share, isOpen: function () { return !!open; } };
  }
  // Mode switch: Daily #n / Unlimited, plus a small info text on the right.
  function modeBar(parent, onChange) {
    var n = dayNum(today());
    var bD = h('button', { type: 'button', text: n >= 1 ? 'Daily #' + n : 'Daily' }), bU = h('button', { type: 'button', text: 'Unlimited' });
    var info = h('span', { class: 'info' });
    var bar = h('div', { class: 'mode' }, [h('div', { class: 'seg', role: 'group', 'aria-label': 'Mode' }, [bD, bU]), info]);
    function set(m, quiet) { bD.classList.toggle('on', m === 'daily'); bU.classList.toggle('on', m === 'free'); bD.setAttribute('aria-pressed', m === 'daily'); bU.setAttribute('aria-pressed', m === 'free'); if (!quiet) onChange(m); }
    bD.onclick = function () { set('daily'); }; bU.onclick = function () { set('free'); };
    parent.appendChild(bar);
    return { set: set, info: info, el: bar };
  }

  // ------------------------------------------------------------------ guess box: suggestions, Enter, on-screen keyboard
  var touch = (function () { try { return matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0); } catch (e) { return false; } })();
  function entry(o) {
    // o: {parent, onGuess(country) -> true if accepted, used(id) -> bool, filter, placeholder, toast}
    var input = h('input', { type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'go', placeholder: o.placeholder || 'Type a country…', 'aria-label': 'Country name' });
    var go = h('button', { type: 'button', class: 'cta', text: 'Guess' });
    var sugg = h('div', { class: 'sugg', 'aria-live': 'polite' });
    var wrap = h('div', { class: 'entry' }, [sugg, h('div', { class: 'inrow' }, [input, go])]);
    var kb = null, sys = false, items = [], hi = -1;
    if (touch) {
      input.setAttribute('inputmode', 'none');
      kb = h('div', { class: 'kb', 'aria-hidden': 'true' });
      ['qwertyuiop', 'asdfghjkl', '⌨zxcvbnm␣⌫'].forEach(function (row) {
        var r = h('div');
        Array.from(row).forEach(function (ch) {
          var b = h('button', { type: 'button', tabindex: '-1', text: ch === '␣' ? 'space' : ch === '⌨' ? 'abc' : ch });
          if (ch === '␣' || ch === '⌫' || ch === '⌨') b.className = 'w';
          if (ch === '⌨') b.title = 'Use your phone\'s keyboard';
          b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
          b.addEventListener('click', function () {
            if (ch === '⌫') input.value = input.value.slice(0, -1);
            else if (ch === '␣') { if (input.value && !/ $/.test(input.value)) input.value += ' '; }
            else if (ch === '⌨') { sys = !sys; input.setAttribute('inputmode', sys ? 'text' : 'none'); input.blur(); setTimeout(function () { input.focus(); }, 30); return; }
            else input.value += ch;
            refresh();
          });
          r.appendChild(b);
        });
        kb.appendChild(r);
      });
      wrap.appendChild(kb);
    }
    function refresh() {
      var t = input.value.trim();
      items = t ? suggest(t, 6, o.filter) : [];
      hi = items.length && (norm(t).length >= 3 || items.length === 1) ? 0 : -1;
      draw();
    }
    function draw() {
      sugg.innerHTML = '';
      if (!input.value.trim()) { sugg.appendChild(h('span', { class: 'none', text: o.hint || 'Start typing, then pick a country.' })); return; }
      if (!items.length) { sugg.appendChild(h('span', { class: 'none', text: 'No country matches that.' })); return; }
      items.forEach(function (c, i) {
        var b = h('button', { type: 'button', text: c.name, class: (i === hi ? 'hi ' : '') + (o.used && o.used(c.id) ? 'used' : '') });
        b.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') e.preventDefault(); });
        b.addEventListener('click', function () { submit(c); });
        sugg.appendChild(b);
      });
    }
    function bad(msg) { input.classList.remove('bad'); void input.offsetWidth; input.classList.add('bad'); if (msg && o.toast) o.toast(msg); }
    function submit(c) {
      if (!c) { var t = input.value.trim(); if (!t) return; c = find(t) || (hi >= 0 ? items[hi] : null); }
      if (!c) { bad(items.length ? 'Pick one of the suggestions' : 'That isn\'t a country we know'); return; }
      if (o.used && o.used(c.id)) { bad('You already guessed ' + c.name); return; }
      if (o.onGuess(c) !== false) { input.value = ''; refresh(); }
    }
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowRight' && input.selectionStart === input.value.length && items.length) && items.length) { e.preventDefault(); hi = (hi + 1) % items.length; draw(); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); hi = (hi - 1 + items.length) % items.length; draw(); }
      else if (e.key === 'Tab' && items.length && input.value.trim()) { e.preventDefault(); hi = (hi + (e.shiftKey ? items.length - 1 : 1)) % items.length; draw(); }
    });
    go.addEventListener('click', function () { submit(); });
    // physical keyboard typing goes to the box even when it isn't focused (but not while a dialog is open)
    document.addEventListener('keydown', function (e) {
      if (wrap.hidden || !wrap.isConnected || document.activeElement === input || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.modal')) return;
      if (/^[a-zA-Z]$/.test(e.key)) { input.focus({ preventScroll: true }); }
    });
    o.parent.appendChild(wrap);
    refresh();
    return {
      el: wrap, input: input,
      enable: function (on) { wrap.hidden = !on; },
      clear: function () { input.value = ''; refresh(); },
      focus: function () { if (!touch) try { input.focus({ preventScroll: true }); } catch (e) {} },
      refresh: refresh, submitText: function (t) { input.value = t; refresh(); submit(); }
    };
  }

  // ------------------------------------------------------------------ the globe (orthographic projection on a canvas)
  function Globe(canvas, opt) {
    opt = opt || {};
    var g = this, ctx = canvas.getContext('2d');
    g.canvas = canvas; g.lon = opt.lon || 10; g.lat = opt.lat || 20; g.zoom = opt.zoom || 1;
    g.minZoom = opt.minZoom || 0.9; g.maxZoom = opt.maxZoom || 60;
    g.style = opt.style || function () { return null; };
    g.labels = opt.labels || function () { return []; };
    g.land = opt.land || '#2a3f5f'; g.border = opt.borderColor || 'rgba(4,17,31,.85)';
    g.onTap = null; g.onMove = null;
    var ids = Object.keys(window.GEO_SHAPES || {});
    var geo = ids.map(function (id) {
      var vs = vecs(id), rs = rings(id);
      return { id: id, rings: vs.map(function (v, i) {
        var cx = 0, cy = 0, cz = 0, n = v.length / 3, minLo = 999, maxLo = -999, minLa = 99, maxLa = -99, r = rs[i];
        for (var j = 0; j < v.length; j += 3) { cx += v[j]; cy += v[j + 1]; cz += v[j + 2]; }
        var l = Math.hypot(cx, cy, cz) || 1; cx /= l; cy /= l; cz /= l;
        var mind = 1; for (j = 0; j < v.length; j += 3) mind = Math.min(mind, v[j] * cx + v[j + 1] * cy + v[j + 2] * cz);
        for (j = 0; j < r.length; j += 2) { minLo = Math.min(minLo, r[j]); maxLo = Math.max(maxLo, r[j]); minLa = Math.min(minLa, r[j + 1]); maxLa = Math.max(maxLa, r[j + 1]); }
        return { v: v, ll: r, c: [cx, cy, cz], cosr: mind, bb: [minLo, minLa, maxLo, maxLa] };
      }) };
    });
    g.geo = geo;
    var W = 0, H = 0, DPR = 1, M = null, raf = 0, anim = null;
    function base() { return Math.min(W, H) * 0.46; }
    g.R = function () { return base() * g.zoom; };
    g.resize = function () {
      var r = canvas.getBoundingClientRect(); DPR = Math.min(2.5, window.devicePixelRatio || 1);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR); g.draw(true);
    };
    function matrix() {
      var l = g.lon * D2R, p = g.lat * D2R, cl = Math.cos(l), sl = Math.sin(l), cp = Math.cos(p), sp = Math.sin(p);
      // rows give screen X (east), Y (north) and Z (towards the viewer) from a unit vector
      return [-sl, cl, 0, -sp * cl, -sp * sl, cp, cp * cl, cp * sl, sp];
    }
    g.project = function (lon, lat) { // -> [x, y, visible]
      M = matrix(); var lo = lon * D2R, la = lat * D2R, c = Math.cos(la), x = c * Math.cos(lo), y = c * Math.sin(lo), z = Math.sin(la), R = g.R();
      return [W / 2 + R * (M[0] * x + M[1] * y), H / 2 - R * (M[3] * x + M[4] * y + M[5] * z), M[6] * x + M[7] * y + M[8] * z >= 0];
    };
    g.unproject = function (sx, sy) {
      M = matrix(); var R = g.R(), X = (sx - W / 2) / R, Y = -(sy - H / 2) / R, q = X * X + Y * Y; if (q > 1) return null;
      var Z = Math.sqrt(1 - q);
      // inverse of the rotation (transpose)
      var x = M[0] * X + M[3] * Y + M[6] * Z, y = M[1] * X + M[4] * Y + M[7] * Z, z = M[2] * X + M[5] * Y + M[8] * Z;
      return [Math.atan2(y, x) / D2R, Math.asin(Math.max(-1, Math.min(1, z))) / D2R];
    };
    // Trace one ring: points behind the globe are pushed out to the rim, and the rim is followed between them.
    function trace(v, R, cx, cy) {
      var n = v.length / 3, start = -1, i, Xs = new Float64Array(n), Ys = new Float64Array(n), Zs = new Float64Array(n);
      for (i = 0; i < n; i++) {
        var x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
        Xs[i] = M[0] * x + M[1] * y; Ys[i] = M[3] * x + M[4] * y + M[5] * z; Zs[i] = M[6] * x + M[7] * y + M[8] * z;
        if (start < 0 && Zs[i] >= 0) start = i;
      }
      if (start < 0) return;
      ctx.moveTo(cx + R * Xs[start], cy - R * Ys[start]);
      var hidden = false, a0 = 0, sweep = 0, pa = 0;
      for (var k = 1; k <= n; k++) {
        var j = (start + k) % n, pj = (start + k - 1) % n;
        if (!hidden) {
          if (Zs[j] >= 0) { ctx.lineTo(cx + R * Xs[j], cy - R * Ys[j]); continue; }
          var t = Zs[pj] / (Zs[pj] - Zs[j]), ex = Xs[pj] + t * (Xs[j] - Xs[pj]), ey = Ys[pj] + t * (Ys[j] - Ys[pj]);
          a0 = Math.atan2(ey, ex); ctx.lineTo(cx + R * Math.cos(a0), cy - R * Math.sin(a0));
          hidden = true; sweep = 0; pa = a0;
          var aj = Math.atan2(Ys[j], Xs[j]), d = aj - pa; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; sweep += d; pa = aj;
        } else {
          if (Zs[j] < 0) { var aj2 = Math.atan2(Ys[j], Xs[j]), d2 = aj2 - pa; d2 -= Math.round(d2 / (2 * Math.PI)) * 2 * Math.PI; sweep += d2; pa = aj2; continue; }
          var t2 = Zs[pj] / (Zs[pj] - Zs[j]), ix = Xs[pj] + t2 * (Xs[j] - Xs[pj]), iy = Ys[pj] + t2 * (Ys[j] - Ys[pj]);
          var a1 = Math.atan2(iy, ix), d3 = a1 - pa; d3 -= Math.round(d3 / (2 * Math.PI)) * 2 * Math.PI; sweep += d3;
          var steps = Math.ceil(Math.abs(sweep) / 0.08);
          for (var s = 1; s <= steps; s++) { var a = a0 + sweep * s / steps; ctx.lineTo(cx + R * Math.cos(a), cy - R * Math.sin(a)); }
          ctx.lineTo(cx + R * Xs[j], cy - R * Ys[j]);
          hidden = false;
        }
      }
      ctx.closePath();
    }
    function ringVisible(r, R) {
      var z = M[6] * r.c[0] + M[7] * r.c[1] + M[8] * r.c[2];
      var sinr = Math.sqrt(Math.max(0, 1 - r.cosr * r.cosr));
      if (r.cosr < 0) return true;
      if (z < -sinr) return false; // wholly behind
      // wholly off screen when zoomed in
      var x = M[0] * r.c[0] + M[1] * r.c[1], y = M[3] * r.c[0] + M[4] * r.c[1] + M[5] * r.c[2], rad = R * sinr + 2;
      var sx = W / 2 + R * x, sy = H / 2 - R * y;
      return !(sx + rad < 0 || sx - rad > W || sy + rad < 0 || sy - rad > H) || z < 0.2;
    }
    g.draw = function (now) {
      if (!now) { if (!raf) raf = requestAnimationFrame(function () { raf = 0; g.draw(true); }); return; }
      if (!W) return;
      M = matrix();
      var R = g.R(), cx = W / 2, cy = H / 2;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // glow and ocean
      var glow = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.12);
      glow.addColorStop(0, 'rgba(79,227,193,.18)'); glow.addColorStop(1, 'rgba(79,227,193,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, 7); ctx.fill();
      var sea = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      sea.addColorStop(0, '#123a66'); sea.addColorStop(1, '#0a1f3d');
      ctx.fillStyle = sea; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
      // graticule
      ctx.strokeStyle = 'rgba(160,200,255,.07)'; ctx.lineWidth = 1; ctx.beginPath();
      for (var lo = -180; lo < 180; lo += 30) line(function (t) { return [lo, -90 + t * 180]; });
      for (var la = -60; la <= 60; la += 30) line(function (t) { return [-180 + t * 360, la]; });
      ctx.stroke();
      // countries
      var lw = Math.max(0.5, Math.min(1.3, 0.4 + g.zoom * 0.08));
      for (var i = 0; i < geo.length; i++) {
        var c = geo[i], st = g.style(c.id) || {};
        ctx.beginPath(); var any = false;
        for (var j = 0; j < c.rings.length; j++) { var r = c.rings[j]; if (!ringVisible(r, R)) continue; trace(r.v, R, cx, cy); any = true; }
        if (!any) continue;
        ctx.fillStyle = st.fill || (c.id[0] === '_' ? '#22344d' : g.land); ctx.fill('evenodd');
        ctx.strokeStyle = st.stroke || g.border; ctx.lineWidth = st.lw || lw; ctx.stroke();
      }
      ctx.restore();
      // rings around small places and labels
      var marks = g.labels() || [], boxes = [];
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      function free(b) { for (var q = 0; q < boxes.length; q++) { var o = boxes[q]; if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false; } return true; }
      marks.forEach(function (m) {
        var c = byId[m.id]; if (!c) return; var p = g.project(c.lon, c.lat); if (!p[2]) return;
        if (m.ring) { ctx.beginPath(); ctx.arc(p[0], p[1], m.ring, 0, 7); ctx.strokeStyle = m.ringColor || '#fff'; ctx.lineWidth = 2.5; ctx.stroke(); }
        if (m.text) {
          var fs = m.size || 12; ctx.font = '800 ' + fs + 'px Nunito, system-ui, sans-serif';
          var y = p[1] + (m.ring ? -m.ring - 9 : 0), tw = ctx.measureText(m.text).width / 2 + 3, placed = false;
          // labels that would overlap one already drawn try a little lower or higher, else they're left out
          var tries = [0, fs + 2, -(fs + 2), 2 * fs + 4];
          for (var q = 0; q < tries.length; q++) { var bx = [p[0] - tw, y + tries[q] - fs / 2 - 1, p[0] + tw, y + tries[q] + fs / 2 + 1]; if (free(bx)) { boxes.push(bx); y += tries[q]; placed = true; break; } }
          if (!placed) return;
          ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(4,17,31,.9)'; ctx.strokeText(m.text, p[0], y);
          ctx.fillStyle = m.color || '#fff'; ctx.fillText(m.text, p[0], y);
        }
      });
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.strokeStyle = 'rgba(160,200,255,.22)'; ctx.lineWidth = 1; ctx.stroke();
      if (g.onDraw) g.onDraw();
    };
    function line(f) {
      var pen = false;
      for (var s = 0; s <= 48; s++) {
        var q = f(s / 48), lo = q[0] * D2R, la = q[1] * D2R, c = Math.cos(la), x = c * Math.cos(lo), y = c * Math.sin(lo), z = Math.sin(la);
        if (M[6] * x + M[7] * y + M[8] * z < 0) { pen = false; continue; }
        var R = g.R(), px = W / 2 + R * (M[0] * x + M[1] * y), py = H / 2 - R * (M[3] * x + M[4] * y + M[5] * z);
        if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py); pen = true;
      }
    }
    g.pick = function (sx, sy) {
      var ll = g.unproject(sx, sy); if (!ll) return null;
      var x = ll[0], y = ll[1];
      for (var i = 0; i < geo.length; i++) {
        var c = geo[i]; if (c.id[0] === '_') continue; var inside = false;
        for (var j = 0; j < c.rings.length; j++) {
          var r = c.rings[j], b = r.bb; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
          var p = r.ll, n = p.length;
          for (var a = 0, k = n - 2; a < n; k = a, a += 2) {
            if ((p[a + 1] > y) !== (p[k + 1] > y) && x < (p[k] - p[a]) * (y - p[a + 1]) / (p[k + 1] - p[a + 1]) + p[a]) inside = !inside;
          }
        }
        if (inside) return c.id;
      }
      return null;
    };
    function clampZoom(z) { return Math.max(g.minZoom, Math.min(g.maxZoom, z)); }
    g.setView = function (lon, lat, zoom) { anim = null; g.lon = ((lon + 540) % 360) - 180; g.lat = Math.max(-85, Math.min(85, lat)); if (zoom) g.zoom = clampZoom(zoom); g.draw(); if (g.onMove) g.onMove(); };
    g.flyTo = function (lon, lat, zoom, ms) {
      var f = { lon: g.lon, lat: g.lat, zoom: g.zoom }, dl = ((lon - g.lon + 540) % 360) - 180, t0 = performance.now(); ms = ms || 700;
      zoom = clampZoom(zoom || g.zoom);
      anim = function (t) {
        var k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        g.lon = ((f.lon + dl * e + 540) % 360) - 180; g.lat = f.lat + (lat - f.lat) * e; g.zoom = f.zoom * Math.pow(zoom / f.zoom, e);
        g.draw(true); if (g.onMove) g.onMove();
        if (k < 1 && anim) requestAnimationFrame(function (tt) { if (anim) anim(tt); }); else anim = null;
      };
      requestAnimationFrame(anim);
    };
    // View that shows all these places: centre on their middle, zoom so the farthest point fits.
    g.fitView = function (idsToFit, pad) {
      var pts = [];
      idsToFit.forEach(function (id) { vecs(id).forEach(function (v) { for (var j = 0; j < v.length; j += 9) pts.push([v[j], v[j + 1], v[j + 2]]); }); var c = byId[id]; if (c) { var la = c.lat * D2R, lo = c.lon * D2R; pts.push([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]); } });
      if (!pts.length) return { lon: g.lon, lat: g.lat, zoom: 1 };
      var x = 0, y = 0, z = 0; pts.forEach(function (p) { x += p[0]; y += p[1]; z += p[2]; });
      var l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
      var mind = 1; pts.forEach(function (p) { mind = Math.min(mind, p[0] * x + p[1] * y + p[2] * z); });
      var lon = Math.atan2(y, x) / D2R, lat = Math.asin(z) / D2R, th = Math.acos(Math.max(-1, Math.min(1, mind)));
      var need = th >= Math.PI / 2 * 0.95 ? 1 : (Math.min(W, H) * (pad || 0.42)) / (Math.sin(th) * base() || 1);
      return { lon: lon, lat: lat, zoom: clampZoom(Math.max(1, Math.min(need, opt.fitMax || 14))) };
    };
    g.fit = function (idsToFit, ms, pad) { var v = g.fitView(idsToFit, pad); if (ms === 0) g.setView(v.lon, v.lat, v.zoom); else g.flyTo(v.lon, v.lat, v.zoom, ms); };
    g.zoomBy = function (f) { g.setView(g.lon, g.lat, g.zoom * f); };
    // pointer input: drag to turn, pinch or wheel to zoom, tap to pick
    if (opt.interactive !== false) {
      var ptrs = {}, down = null, pinch = null;
      canvas.addEventListener('pointerdown', function (e) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
        ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; anim = null;
        var k = Object.keys(ptrs);
        if (k.length === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
        else if (k.length === 2) { var a = ptrs[k[0]], b = ptrs[k[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: g.zoom }; if (down) down.moved = 99; }
      });
      canvas.addEventListener('pointermove', function (e) {
        var p = ptrs[e.pointerId]; if (!p) return;
        var dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
        var k = Object.keys(ptrs);
        if (k.length >= 2 && pinch) { var a = ptrs[k[0]], b = ptrs[k[1]]; g.setView(g.lon, g.lat, pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.d); return; }
        if (down) down.moved += Math.abs(dx) + Math.abs(dy);
        var R = g.R(), cl = Math.max(0.25, Math.cos(g.lat * D2R));
        g.setView(g.lon - dx / R / D2R / cl, g.lat + dy / R / D2R);
      });
      function up(e) {
        if (!ptrs[e.pointerId]) return;
        delete ptrs[e.pointerId];
        var k = Object.keys(ptrs); if (k.length < 2) pinch = null;
        if (!k.length && down && down.moved < 8 && performance.now() - down.t < 500 && e.type === 'pointerup') {
          var r = canvas.getBoundingClientRect(), id = g.pick(e.clientX - r.left, e.clientY - r.top);
          if (g.onTap) g.onTap(id, e.clientX - r.left, e.clientY - r.top);
        }
        if (!k.length) down = null;
      }
      canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('wheel', function (e) { e.preventDefault(); g.setView(g.lon, g.lat, g.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0016))); }, { passive: false });
      canvas.addEventListener('dblclick', function (e) { e.preventDefault(); g.zoomBy(2); });
    }
    if (window.ResizeObserver) new ResizeObserver(function () { g.resize(); }).observe(canvas);
    window.addEventListener('resize', function () { g.resize(); });
    g.resize();
  }

  // ------------------------------------------------------------------ a country's outline on its own (Outline)
  // Leave out small far-off islands (the Canaries, the Azores, Hawaii, the Galapagos) so the main shape stays big;
  // a part is dropped when it is under 5% of the land and farther from the biggest part than 1.5 times that part's size.
  function nearParts(id, vs) {
    var rs = rings(id), info = rs.map(function (r, i) {
      var a = 0, x = 0, y = 0, z = 0, v = vs[i];
      for (var j = 0, n = r.length; j < n; j += 2) { var k = (j + 2) % n; a += (r[k] - r[j]) * (2 + Math.sin(r[j + 1] * D2R) + Math.sin(r[k + 1] * D2R)); }
      for (j = 0; j < v.length; j += 3) { x += v[j]; y += v[j + 1]; z += v[j + 2]; }
      var l = Math.hypot(x, y, z) || 1;
      return { a: Math.abs(a), c: [x / l, y / l, z / l] };
    });
    var tot = 0, big = 0; info.forEach(function (q, i) { tot += q.a; if (q.a > info[big].a) big = i; });
    var B = info[big], bv = vs[big], rad = 0;
    for (var j = 0; j < bv.length; j += 3) rad = Math.max(rad, Math.acos(Math.min(1, bv[j] * B.c[0] + bv[j + 1] * B.c[1] + bv[j + 2] * B.c[2])));
    var lim = Math.max(1000 / R_EARTH, 1.5 * rad);
    return vs.filter(function (v, i) {
      var q = info[i]; if (i === big || q.a >= 0.05 * tot) return true;
      return Math.acos(Math.min(1, q.c[0] * B.c[0] + q.c[1] * B.c[1] + q.c[2] * B.c[2])) <= lim;
    });
  }
  function drawShape(canvas, id, o) {
    o = o || {};
    var r = canvas.getBoundingClientRect(), DPR = Math.min(2.5, window.devicePixelRatio || 1), W = Math.max(1, r.width), H = Math.max(1, r.height);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    var ctx = canvas.getContext('2d'); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    var vs = vecs(id); if (!vs.length) return;
    if (o.near) vs = nearParts(id, vs);
    // Lambert azimuthal equal-area projection centred on the middle of the country
    var cx = 0, cy = 0, cz = 0; vs.forEach(function (v) { for (var j = 0; j < v.length; j += 3) { cx += v[j]; cy += v[j + 1]; cz += v[j + 2]; } });
    var l = Math.hypot(cx, cy, cz) || 1; cx /= l; cy /= l; cz /= l;
    var e = [-cy, cx, 0], el = Math.hypot(e[0], e[1]) || 1; e[0] /= el; e[1] /= el;
    var n = [cy * e[2] - cz * e[1], cz * e[0] - cx * e[2], cx * e[1] - cy * e[0]];
    var P = vs.map(function (v) {
      var out = new Float64Array(v.length / 3 * 2);
      for (var j = 0, q = 0; j < v.length; j += 3, q += 2) {
        var d = v[j] * cx + v[j + 1] * cy + v[j + 2] * cz, k = Math.sqrt(2 / Math.max(1e-9, 1 + d));
        out[q] = k * (v[j] * e[0] + v[j + 1] * e[1] + v[j + 2] * e[2]); out[q + 1] = k * (v[j] * n[0] + v[j + 1] * n[1] + v[j + 2] * n[2]);
      }
      return out;
    });
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    P.forEach(function (p) { for (var j = 0; j < p.length; j += 2) { x0 = Math.min(x0, p[j]); x1 = Math.max(x1, p[j]); y0 = Math.min(y0, p[j + 1]); y1 = Math.max(y1, p[j + 1]); } });
    var pad = o.pad == null ? 18 : o.pad, mx = o.max || 1e9, s = Math.min((Math.min(W, mx) - 2 * pad) / Math.max(1e-6, x1 - x0), (Math.min(H, mx) - 2 * pad) / Math.max(1e-6, y1 - y0));
    var ox = W / 2 - s * (x0 + x1) / 2, oy = H / 2 + s * (y0 + y1) / 2;
    ctx.beginPath();
    P.forEach(function (p) { for (var j = 0; j < p.length; j += 2) { var X = ox + s * p[j], Y = oy - s * p[j + 1]; if (j) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); } ctx.closePath(); });
    if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = 24; }
    ctx.fillStyle = o.fill || '#f1f7ff'; ctx.fill('evenodd');
    ctx.shadowBlur = 0;
    if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function share(name, n, line, grid, mode) {
    return name + (mode === 'free' ? ' (unlimited)' : n >= 1 ? ' #' + n : ' (preview)') + ' ' + line + (grid ? '\n' + grid : '') + '\nascoding11.github.io';
  }

  window.Geo = {
    $: $, h: h, store: store, list: list, byId: byId, norm: norm, find: find, suggest: suggest, pool: pool, CONT_NAME: CONT_NAME,
    km: km, hav: hav, bearing: bearing, arrow: arrow, dirName: dirName, proximity: proximity, fmtKm: fmtKm,
    rings: rings, vecs: vecs, borderKm: borderKm, loadShapes: loadShapes,
    today: today, addDays: addDays, dayNum: dayNum, rng: rng, hash: hash, shuffle: shuffle, answerFor: answerFor,
    hops: hops, pairFor: pairFor, randomPair: randomPair, pairEnds: pairEnds, pairList: pairList, MIN_STEPS: MIN_STEPS, MAX_STEPS: MAX_STEPS,
    Daily: Daily, shell: shell, modeBar: modeBar, entry: entry, touch: touch, countdown: countdown, copyText: copyText,
    Globe: Globe, drawShape: drawShape, shareText: share, LAUNCH: LAUNCH
  };
  if (navigator.webdriver) window.__geo = { setToday: function (k) { DAY_TEST = /^\d{8}$/.test(k) ? k : ''; }, get dayTest() { return DAY_TEST; } };
})();
