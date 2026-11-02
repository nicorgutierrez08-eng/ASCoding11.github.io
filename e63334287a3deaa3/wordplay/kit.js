/*
 * Shared code for the Back Room daily word games: Quartets, Crosslet and Sleight. Sets window.Kit:
 *   page     Kit.$(id), Kit.h(tag, attrs, kids), Kit.store (localStorage wrapped in try/catch), Kit.touch
 *   days     Kit.today() (local YYYYMMDD), Kit.addDays(key, n), Kit.dayNum(key) (2026-11-01 is #1),
 *            Kit.pick(name, length, key, inOrder) the daily puzzle index, Kit.rng(seed), Kit.shuffle(list, rng)
 *   storage  Kit.Daily.load/finish (the daily:<slug> record the Daily hub reads)
 *   shell    Kit.shell({...}) top bar, How to play (shown on the first visit), Stats with countdown, toast, share;
 *            Kit.modeBar(parent, onChange) the Daily #n / Unlimited switch
 *   misc     Kit.countdown(), Kit.copyText(text), Kit.shareText(name, n, line, grid, mode), Kit.fmtTime(seconds)
 * The look (top bar, modals, buttons, keyboard) is in kit.css, the same colours and fonts as Deepword and the
 * geography games. A test hook (window.__kit) exists only when navigator.webdriver is set.
 */
(function () {
  'use strict';
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
  var touch = (function () { try { return matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0); } catch (e) { return false; } })();

  // ------------------------------------------------------------------ days and seeded choices
  var DAY_TEST = (navigator.webdriver && /^\d{8}$/.test(window.__WP_TODAY || '')) ? window.__WP_TODAY : ''; // tests only
  function keyOf(d) { return String(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()); }
  function today() { return DAY_TEST || keyOf(new Date()); }
  function dateOf(k) { return new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), 12); }
  function addDays(k, n) { var d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); }
  function dayNum(k) { return Math.round((dateOf(k) - dateOf(LAUNCH)) / 864e5) + 1; }
  function hash(s) { var x = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function rng(seed) { var a = typeof seed === 'number' ? seed >>> 0 : hash(String(seed)); return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(a, r) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  var orderCache = {};
  function idx(L) { var a = []; for (var i = 0; i < L; i++) a.push(i); return a; }
  // Each time round the list gets a new shuffled order (never the same puzzle twice running across the seam).
  // inOrder: the first time round follows the list as written (used where the list goes from easier to harder).
  function cycleOrder(name, L, c, inOrder) {
    var key = name + ':' + L + ':' + c + ':' + (inOrder ? 1 : 0); if (orderCache[key]) return orderCache[key];
    var o = (inOrder && c === 0) ? idx(L) : shuffle(idx(L), rng(name + '-cycle-' + c));
    if (c > 0 && L > 1) { var prev = cycleOrder(name, L, c - 1, inOrder); if (o[0] === prev[L - 1]) { var t = o[0]; o[0] = o[1]; o[1] = t; } }
    return (orderCache[key] = o);
  }
  function pick(name, L, k, inOrder) {
    var i = dayNum(k) - 1;
    if (i < 0) i = ((i % L) + L) % L; // before launch (previews): wrap round so there's always a puzzle
    var c = Math.floor(i / L);
    return cycleOrder(name, L, c, inOrder)[i - c * L];
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
  function fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); var m = Math.floor(s / 60); s -= m * 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function copyText(t) {
    function fallback() {
      var a = h('textarea', { readonly: '', style: 'position:fixed;left:-9999px;top:0' }); a.value = t; document.body.appendChild(a); a.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} a.remove(); return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fallback(); });
    return Promise.resolve(fallback());
  }
  function shell(o) {
    // o: {slug, name, how: html, foot, dist: [[key,label],...], distTitle, noLose, extra(record) -> node, shareText: fn() -> text|null, onModal(open)}
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
      close(true);
      var box = h('div', { class: 'box', role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title }, [
        h('button', { class: 'pill ico x', 'aria-label': 'Close', html: ICONS.x, onclick: function () { close(); } }),
        h('h2', { text: title }), body]);
      var m = h('div', { class: 'modal', onclick: function (e) { if (e.target === m) close(); } }, [box]);
      lastFocus = document.activeElement; document.body.appendChild(m); open = m; box.querySelector('.x').focus();
      if (o.onModal) o.onModal(true);
      return m;
    }
    function close(quiet) {
      if (!open) return;
      open.remove(); open = null;
      if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
      if (!quiet && o.onModal) o.onModal(false);
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) { e.preventDefault(); close(); } }, true);
    function openHelp() {
      store.set(o.slug + ':seen', 1);
      modal('How to play', h('div', { html: o.how + '<p class="foot">A new puzzle every day at midnight, your time, the same for everyone. Unlimited mode gives you random ones from the whole collection that don\'t count towards your stats. Every puzzle was written for this site.' + (o.foot || '') + ' · <a href="/privacy.html">Privacy</a></p>' }));
    }
    var cdTimer = 0;
    function openStats(meKey) {
      var s = Daily.load(o.slug), max = 1;
      o.dist.forEach(function (d) { max = Math.max(max, s.dist[d[0]] || 0); });
      var played = s.played, pct = played ? Math.round(100 * s.wins / played) : 0;
      var body = h('div', null, [
        h('div', { class: 'st4' }, [
          h('div', { html: '<b>' + played + '</b><small>Played</small>' }),
          h('div', { html: '<b>' + pct + '</b><small>' + (o.winLabel || 'Win %') + '</small>' }),
          h('div', { html: '<b>' + s.streak + '</b><small>Current streak</small>' }),
          h('div', { html: '<b>' + s.maxStreak + '</b><small>Max streak</small>' })]),
        o.extra ? o.extra(s) : null,
        h('h3', { text: o.distTitle || 'Distribution' }),
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
    return { toast: toast, modal: modal, openHelp: openHelp, openStats: openStats, close: close, share: share, isOpen: function () { return !!open; } };
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
  function shareText(name, n, line, grid, mode) {
    return name + (mode === 'free' ? ' (unlimited)' : n >= 1 ? ' #' + n : ' (preview)') + (line ? ' ' + line : '') + (grid ? '\n' + grid : '') + '\nascoding11.github.io';
  }
  // A random puzzle for Unlimited mode, never the one just played.
  function randomIndex(L, not) { var i; do { i = Math.floor(Math.random() * L); } while (i === not && L > 1); return i; }

  window.Kit = {
    $: $, h: h, store: store, touch: touch,
    today: today, addDays: addDays, dayNum: dayNum, keyOf: keyOf, rng: rng, hash: hash, shuffle: shuffle, pick: pick, randomIndex: randomIndex,
    Daily: Daily, shell: shell, modeBar: modeBar, countdown: countdown, copyText: copyText, shareText: shareText, fmtTime: fmtTime, LAUNCH: LAUNCH
  };
  if (navigator.webdriver) window.__kit = { setToday: function (k) { DAY_TEST = /^\d{8}$/.test(k) ? k : ''; }, get dayTest() { return DAY_TEST; } };
})();
