/*
 * Back Room stats: play time and personal bests for the Leaderboards (leaderboard.js).
 *
 * Every active Back Room game loads it with one line:
 *   <script src="/e63334287a3deaa3/stats.js" data-game="<folder>" defer></script>
 * It runs inside the game page, so it works the same whether the game was opened directly or inside the
 * home page, phone page or party layer (an iframe).
 *
 * Play time: a second counts only while the tab is visible and there was a key, mouse, touch or gamepad input in the
 * last 2 minutes. At most 24 hours a day are counted (all games together, by this browser's date).
 * Personal bests: some come from what the game already saves (READ below), others from one-line hooks in the game:
 *   window.BackRoomStats && BackRoomStats.add('kills', 1)        a running count (at most 100 at a time)
 *   window.BackRoomStats && BackRoomStats.min('lap:monza', 81.2) a best where lower wins (times)
 *   window.BackRoomStats && BackRoomStats.max('height', 812)     a best where higher wins (e.g. most kills in one match)
 * Stat names are short lowercase words (a-z, 0-9, ':' and '-'); a name starting with 'lap:' or 'rec:' (Slipstream's
 * fastest lap and course record per track) or listed in LOWER is a time, where lower wins.
 *
 * Saved in this browser under localStorage 'lbs:v1': { g: { <folder>: { s: seconds, <stat>: number } }, d: day, ds: seconds that day,
 * dy: { YYYYMMDD: { <folder>: seconds } } (the last 30 days, for the admin page's activity view) }.
 * Published (at most once a minute while something changed, and when the page closes) to the Firebase Realtime Database,
 * same project and rules as the games, at rooms/lb-all/players/<uid>. The shared rules only let a browser write its own node
 * and require n, c, x, z, h and ts, so the node is:
 *   n name (14)  c colour  x, z, h 0  ts last publish (server time)  v 1  st seat tag (1A–40F, as in social.js)  g the same g as above
 *   d the same dy as above (at most 30 days, 8 games a day, pruned until the node fits in 7,000 characters)
 *   ga 1 and gn the Google display name (40 characters, no email or photo) when the account is a Google sign-in, else neither
 * The name n is the player's one name, in the order social.js uses: the Online name (ol:name), else the signed-in Google
 * account's first name, else the party name, else a name a game saved. A rename on the Back Room page (Online or Party
 * panel, which also fix n on the node straight away) reaches an open game as a storage event, and the game republishes
 * a few seconds later (at most once every NAME_GAP, and only once it is already connected, so it never starts a sign-in early).
 * The node is never removed on disconnect: it is the player's leaderboard entry. The first publish after each page load
 * reads the node back and keeps the larger total / better best (and the larger seconds for each day and game), so clearing
 * this browser doesn't wipe the board entry. Everything is self-reported, so it isn't cheat-proof; leaderboard.js and the
 * admin page cap and check every value they show.
 * Firebase: when the game is open inside the home, phone or party layer it borrows that page's sign-in (party.js); else it
 * uses the game's own Firebase if the game is online; else it loads the SDK in a hidden same-origin frame (only after a minute
 * of play) and signs in the way party.js does, so it never touches the game's own Firebase.
 */
(function () {
  'use strict';
  if (window.BackRoomStats) return;

  var me0 = document.currentScript;
  var GAME = (me0 && me0.getAttribute('data-game')) || '';
  if (!/^[a-z0-9-]{1,30}$/.test(GAME)) GAME = ((/\/e63334287a3deaa3\/([a-z0-9-]{1,30})\//.exec(location.pathname)) || [])[1] || '';
  if (!GAME) return;

  var KEY = 'lbs:v1', PATH = 'rooms/lb-all/players';
  var IDLE = 120000, SAVE_MS = 15000, PUB_MS = 60000, DAY_MAX = 86400;
  var MAX_GAMES = 40, MAX_STATS = 120;
  var DAYS = 30, DAY_GAMES = 8, NODE_CAP = 7000;    // per-day history: how many days and games a day are kept, and how big the node may get
  var NAME_WAIT = 1500, NAME_GAP = 10000;            // a rename republishes after NAME_WAIT, at most once every NAME_GAP
  var LOWER = { tower: 1, summit: 1, obby: 1 };
  LOWER.total = 1;   // Escapade's fastest total of all eight levels (min('total', seconds)) is a time too
  var CFG = {
    apiKey: 'AIzaSyDZD_Ku8cixteXfwkDYzGv3GKiZFF8sRSM',
    authDomain: 'rumblekarts.firebaseapp.com',
    databaseURL: 'https://rumblekarts-default-rtdb.firebaseio.com',
    projectId: 'rumblekarts',
    storageBucket: 'rumblekarts.firebasestorage.app',
    messagingSenderId: '910009166464',
    appId: '1:910009166464:web:cb0f8872c8f06749fc9465'
  };
  var SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var COLORS = ['#1D6A4B', '#C0562F', '#3E5BA9', '#9A3F8F', '#B07A12', '#2A8A8A', '#B42318', '#5B6B2E'];

  // ---------------- Helpers ----------------
  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function json(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function num(v) { var n = Number(v); return isFinite(n) ? n : NaN; }
  function okKey(k) { return typeof k === 'string' && /^[a-z][a-z0-9:-]{0,39}$/.test(k); }
  function lower(k) { return k.indexOf('lap:') === 0 || k.indexOf('rec:') === 0 || LOWER[k] === 1; }
  // Rude words in names are masked by the shared name filter (/namefilter.js) when the page has loaded it.
  function byFilter(v) { return window.NameFilter ? window.NameFilter.clean(v) : v; }
  function cleanName(s, n) { return byFilter(String(s == null ? '' : s).replace(/[<>\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, n || 14)); }
  // The same seat and colour social.js (Online) gives a uid, so a name reads the same everywhere.
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function seatOf(uid) { var h = hash('seat:' + uid); return (1 + h % 40) + 'ABCDEF'.charAt(Math.floor(h / 40) % 6); }
  function colorOf(uid) { var h = 0; for (var i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  // The per-day history's keys: this browser's local date as YYYYMMDD (so they sort as text); dayAgo(1) is yesterday.
  function dayKey(d) { return String(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()); }
  function dayAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); }
  // The Online name, else the Google account's first name (u: the Google user we publish as, if any), else the party name,
  // else any name a game saved: the same order as social.js, so the board says what the Online panel says.
  function myName(u) {
    var v0 = cleanName(lsName('ol:name'));
    if (v0) return v0;
    if (u && (u.displayName || u.email)) { var g = cleanName(String(u.displayName || u.email).split(/[\s@]/)[0]); if (g) return g; }
    var keys = ['party:name', 'coil:name', 'ss:name', 'sd:name', 'spire:name', 'updraft:name', 'boostball-name', 'shellcr-name', 'br1v1-name', 'rk_name', 'chroma-name', 'oddone-name', 'tumble-name', 'trivium.name'];
    for (var i = 0; i < keys.length; i++) { var v = cleanName(lsName(keys[i])); if (v) return v; }
    return 'Player';
  }
  function lsName(k) {
    var v = ls(k); if (!v) return '';
    if (v.charAt(0) === '"') { var j = json(v); if (typeof j === 'string') v = j; }
    return v;
  }

  // A stat value worth keeping: a finite number in a sane range, rounded (times to the millisecond).
  function clean(k, v) {
    v = num(v);
    if (!(v > 0) || v > 1e9) return NaN;
    return lower(k) ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100;
  }
  // Keep the better of two values for a stat ('s' and counts: the larger; times: the smaller).
  function better(k, a, b) {
    if (!(a > 0)) return b; if (!(b > 0)) return a;
    return lower(k) ? Math.min(a, b) : Math.max(a, b);
  }
  // Rebuild a g object field by field (used on local data and on what we read back from our node).
  function cleanG(g) {
    var out = {}, n = 0;
    if (!g || typeof g !== 'object') return out;
    Object.keys(g).slice(0, MAX_GAMES * 2).forEach(function (gk) {
      if (n >= MAX_GAMES || !/^[a-z0-9-]{1,30}$/.test(gk)) return;
      var src = g[gk], o = {}, m = 0;
      if (!src || typeof src !== 'object') return;
      Object.keys(src).slice(0, MAX_STATS * 2).forEach(function (k) {
        if (m >= MAX_STATS || !(k === 's' || okKey(k))) return;
        var v = k === 's' ? Math.floor(num(src[k])) : clean(k, src[k]);
        if (v > 0 && v < 1e9) { o[k] = v; m++; }
      });
      if (m) { out[gk] = o; n++; }
    });
    return out;
  }

  // Rebuild the per-day history field by field: the last 30 days only (tomorrow is allowed, for a device in another time zone),
  // at most DAY_GAMES games a day, whole seconds, and no more than 24 hours in a day.
  function cleanDays(src) {
    var out = {};
    if (!src || typeof src !== 'object') return out;
    var lo = dayAgo(DAYS - 1), hi = dayAgo(-1);
    Object.keys(src).filter(function (k) { return /^\d{8}$/.test(k) && k >= lo && k <= hi; }).sort().slice(-DAYS).forEach(function (k) {
      var g = src[k], o = {}, m = 0, tot = 0;
      if (!g || typeof g !== 'object') return;
      Object.keys(g).slice(0, DAY_GAMES * 2).forEach(function (gk) {
        if (m >= DAY_GAMES || tot >= DAY_MAX || !/^[a-z0-9-]{1,30}$/.test(gk)) return;
        var v = Math.floor(num(g[gk]));
        if (!(v > 0)) return;
        v = Math.min(v, DAY_MAX - tot); o[gk] = v; tot += v; m++;
      });
      if (m) out[k] = o;
    });
    return out;
  }

  // ---------------- What the games already save ----------------
  // Each reader returns { stat: value } for its game, from the game's own localStorage keys. Missing or broken keys give nothing.
  function sj(k) { var v = ls(k); return v == null ? null : json(v); }
  var READ = {
    'coil': function () { return { best: sj('coil:best') }; },
    'shell-crackers': function () { var r = sj('shellcr-rank'); return r && (r.g | 0) > 0 ? { elo: Math.round(num(r.r)) } : {}; },
    'updraft': function () { var b = sj('updraft:best') || {}; return { height: b.h, summit: b.time, summits: b.wins }; },
    'spire': function () { var p = sj('spire:profile') || {}; return { tower: p.best && p.best.tower, towers: p.towers }; },
    'tumble-trials': function () { var s = sj('tumble-stats') || {}; return { crowns: s.w, shows: s.g }; },
    'showdown': function () { var s = sj('sd:pstats') || {}; return { pot: s.big, hands: s.h }; },
    'trivium': function () {
      var best = 0, st = sj('trivium.streak') || {};
      try {
        for (var i = 0; i < localStorage.length && i < 5000; i++) {
          var k = localStorage.key(i);
          if (!k || k.indexOf('trivium.daily.') !== 0) continue;
          var d = sj(k); if (d && d.done && num(d.pts) > best) best = num(d.pts);
        }
      } catch (e) {}
      return { daily: best, streak: st.best };
    }
  };

  // ---------------- Local store ----------------
  function load() {
    var o = json(ls(KEY)) || {};
    return { g: cleanG(o.g), d: typeof o.d === 'string' ? o.d.slice(0, 12) : '', ds: Math.max(0, Math.min(DAY_MAX, num(o.ds) || 0)), dy: cleanDays(o.dy) };
  }
  function save(o) { ls(KEY, JSON.stringify(o)); }
  // Change the stored data in one read-modify-write, so two tabs never undo each other's time.
  function change(fn) { var o = load(); fn(o); save(o); return o; }
  function mine(o) { return o.g[GAME] || (o.g[GAME] = {}); }

  var pending = 0, lastInput = 0, lastTick = Date.now();
  function flush() {
    if (pending < 1) return;
    var add = Math.floor(pending); pending -= add;
    change(function (o) {
      var d = today(); if (o.d !== d) { o.d = d; o.ds = 0; }
      add = Math.min(add, DAY_MAX - o.ds); if (add <= 0) return;
      o.ds += add; var g = mine(o); g.s = (g.s | 0) + add;
      // The same seconds under today's date, for the admin page's activity view.
      var day = o.dy[dayAgo(0)] || (o.dy[dayAgo(0)] = {});
      if (day[GAME] != null || Object.keys(day).length < DAY_GAMES) day[GAME] = Math.min(DAY_MAX, (day[GAME] | 0) + add);
      o.dy = cleanDays(o.dy);
    });
  }

  // ---------------- Engaged time ----------------
  // Only real input counts: not events a script made up, and not the still "mouse moves" browsers send when the page changes under the pointer.
  var mx = -1, my = -1;
  function mark(e) {
    if (!e.isTrusted) return;
    if (e.type === 'mousemove' || e.type === 'pointermove') {
      var moved = e.movementX || e.movementY || (mx >= 0 && (e.screenX !== mx || e.screenY !== my));
      mx = e.screenX; my = e.screenY;
      if (!moved) return;
    }
    lastInput = Date.now();
  }
  ['keydown', 'pointerdown', 'pointermove', 'mousemove', 'touchstart', 'wheel'].forEach(function (t) {
    addEventListener(t, mark, { capture: true, passive: true });
  });
  function padActive() {
    try {
      var ps = navigator.getGamepads ? navigator.getGamepads() : [];
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i]; if (!p) continue;
        for (var b = 0; b < p.buttons.length; b++) if (p.buttons[b] && p.buttons[b].pressed) return true;
        for (var a = 0; a < p.axes.length; a++) if (Math.abs(p.axes[a]) > 0.3) return true;
      }
    } catch (e) {}
    return false;
  }
  function engaged(t) { return document.visibilityState === 'visible' && t - lastInput < IDLE; }
  var lastSave = Date.now(), lastPub = Date.now();
  function tick() {
    var t = Date.now(), dt = Math.min(5000, Math.max(0, t - lastTick)); lastTick = t;
    if (padActive()) lastInput = t;
    if (engaged(t)) pending += dt / 1000;
    if (t - lastSave >= SAVE_MS) { lastSave = t; flush(); }
    if (t - lastPub >= PUB_MS) { lastPub = t; publish(false); }
  }
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', function () { tick(); if (document.visibilityState === 'hidden') { flush(); publish(true); } });
  addEventListener('pagehide', function () { tick(); flush(); publish(true); });
  // A rename on the Back Room page (another document, so it arrives as a storage event): republish soon, if connected.
  var nameT = 0, lastNamePub = 0;
  addEventListener('storage', function (e) {
    if (e.key !== 'ol:name' && e.key !== 'party:name') return;
    clearTimeout(nameT);
    nameT = setTimeout(function () {
      if (!conn || !merged) return;                   // not connected yet: the next regular publish carries the name
      lastNamePub = Date.now(); publish(false);
    }, Math.max(NAME_WAIT, lastNamePub + NAME_GAP - Date.now()));
  });

  // ---------------- Firebase ----------------
  // { db, uid, now(), J, user() } where J is the JSON of the window that owns db (another page's, when we borrow its connection)
  // and user() is the Google account behind uid, if it is one (null for the anonymous sign-ins the games make).
  var conn = null, connecting = null, merged = false, lastSent = '';
  function waitFor(test, ms) {
    return new Promise(function (res, rej) {
      var t0 = Date.now();
      (function poll() { if (test()) return res(); if (Date.now() - t0 > ms) return rej(new Error('timeout')); setTimeout(poll, 250); })();
    });
  }
  function ours(F) { return F && F.apps && F.database && F.auth ? F.apps.filter(function (a) { return a.options && a.options.apiKey === CFG.apiKey && a.name === '[DEFAULT]'; })[0] : null; }
  // wait: the game itself is signing in, so give it a moment rather than making a second anonymous account at the same time.
  function fromApp(app, J, wait) {
    var auth = app.auth(), offset = 0;
    return new Promise(function (res) { var s = auth.onAuthStateChanged(function () { s(); res(); }); })
      .then(function () { return auth.currentUser || !wait ? null : waitFor(function () { return auth.currentUser; }, 15000).catch(function () {}); })
      .then(function () { return auth.currentUser || auth.signInAnonymously().then(function (c) { return c.user; }); })
      .then(function (u) {
        // The same database instance the game uses (asking for it by another URL spelling would start a second one, which Firebase refuses).
        var db = app.database();
        db.ref('.info/serverTimeOffset').on('value', function (s) { offset = s.val() || 0; });
        return { db: db, uid: u.uid, now: function () { return Date.now() + offset; }, J: J, user: function () { return googleUser(auth.currentUser, u.uid); } };
      });
  }
  // A hidden same-origin frame with its own copy of the SDK, so we never touch the game's Firebase globals (it may load its
  // own later, or, like Trivium, use another project). Same origin means the same saved sign-in, so the same uid.
  function sidecar() {
    return new Promise(function (res, rej) {
      var fr = document.createElement('iframe');
      fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1; fr.title = 'stats';
      fr.style.cssText = 'position:fixed;left:-20px;top:-20px;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
      fr.onload = function () {
        var w = fr.contentWindow, left = 3;
        ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js'].forEach(function (n) {
          var sc = w.document.createElement('script'); sc.src = SDK + n; sc.async = false;
          sc.onload = function () { if (--left === 0) res(w); };
          sc.onerror = function () { rej(new Error('sdk')); };
          w.document.head.appendChild(sc);
        });
      };
      fr.srcdoc = '<!doctype html><html><head><title>stats</title></head><body></body></html>';
      (document.body || document.documentElement).appendChild(fr);
    }).then(function (w) { return fromApp(ours(w.firebase) || w.firebase.initializeApp(CFG), w.JSON, false); });
  }
  function getConn() {
    if (conn) return Promise.resolve(conn);
    if (connecting) return connecting;
    var p, P = null, PW = null, app = ours(window.firebase);
    try { if (window.parent !== window && window.parent.Party && window.parent.Party.boot) { P = window.parent.Party; PW = window.parent; } } catch (e) {}
    // 1. Inside the home, phone or party layer: borrow the hub page's sign-in (party.js), the account its panels show as "You".
    if (P) p = P.boot().then(function (b) {
      // The hub page's account: Google when account.js signed it in there (party.js reuses that sign-in), else anonymous.
      var user = function () {
        var u = null;
        try { u = b.app ? b.app.auth().currentUser : null; if (!u && PW.SiteAccount && PW.SiteAccount.user) u = PW.SiteAccount.user(); } catch (e) { u = null; }
        return googleUser(u, b.uid);
      };
      return { db: b.db, uid: b.uid, now: P.now, J: PW.JSON, user: user };
    });
    // 2. The game already has our project's Firebase running (it's online): use it.
    else if (app) p = fromApp(app, JSON, true);
    // 3. Otherwise a frame of our own.
    else p = sidecar();
    connecting = p.then(function (c) { conn = c; connecting = null; return c; }, function (e) { connecting = null; throw e; });
    return connecting;
  }

  // u, when it is the account we publish under and not one of the games' anonymous sign-ins.
  function googleUser(u, uid) { return u && u.uid === uid && u.isAnonymous === false ? u : null; }

  // Fold in this game's own saved records, then the node as it stands online, once per page load.
  function readGame(o) {
    var f = READ[GAME]; if (!f) return;
    var r = {}; try { r = f() || {}; } catch (e) {}
    Object.keys(r).forEach(function (k) { var v = clean(k, r[k]); if (v > 0) { var g = mine(o); g[k] = better(k, g[k], v); } });
  }
  function mergeRemote(o, val) {
    var rg = cleanG(val && val.g);
    Object.keys(rg).forEach(function (gk) {
      if (!o.g[gk] && Object.keys(o.g).length >= MAX_GAMES) return;
      var g = o.g[gk] || (o.g[gk] = {});
      Object.keys(rg[gk]).forEach(function (k) { if (g[k] != null || Object.keys(g).length < MAX_STATS) g[k] = better(k, g[k], rg[gk][k]); });
    });
    // The per-day history the same way: the larger seconds for each day and game (two devices on one account keep the higher, not the sum).
    var rd = cleanDays(val && val.d);
    Object.keys(rd).forEach(function (k) {
      var day = o.dy[k] || (o.dy[k] = {});
      Object.keys(rd[k]).forEach(function (gk) { if (day[gk] != null || Object.keys(day).length < DAY_GAMES) day[gk] = Math.max(day[gk] | 0, rd[k][gk]); });
    });
    o.dy = cleanDays(o.dy);
  }
  function node(c, o) {
    var u = null; try { u = c.user ? c.user() : null; } catch (e) { u = null; }
    var nd = { n: myName(u), c: colorOf(c.uid), x: 0, z: 0, h: 0, ts: Math.round(c.now()), v: 1, st: seatOf(c.uid), g: o.g, d: o.dy };
    // A Google account: say so, with its display name (never the email or photo), so the admin page can tell accounts apart.
    if (u) { nd.ga = 1; var gn = cleanName(u.displayName, 40); if (gn) nd.gn = gn; }
    // Keep the node small enough for leaderboard.js (8,000 characters): drop the oldest days first.
    var days = Object.keys(nd.d).sort();
    while (days.length && JSON.stringify(nd).length > NODE_CAP) delete nd.d[days.shift()];
    if (!days.length) delete nd.d;
    return nd;
  }
  function send(c, o, force) {
    var nd = node(c, o), sig = JSON.stringify([nd.n, nd.g, nd.d, nd.ga, nd.gn]);
    if (!force && sig === lastSent) return;
    lastSent = sig;
    ls('lbs:uid', c.uid);
    try { c.db.ref(PATH + '/' + c.uid).set(c.J.parse(JSON.stringify(nd))).catch(function () { lastSent = ''; }); } catch (e) { lastSent = ''; }
  }
  // closing: the page is going away, so only write if we're already connected and merged (no waiting).
  function publish(closing) {
    flush();
    var o = change(readGame);
    if (!Object.keys(o.g).length) return;
    if (closing) { if (conn && merged) send(conn, o, false); return; }
    getConn().then(function (c) {
      if (merged) return send(c, load(), false);
      return c.db.ref(PATH + '/' + c.uid).once('value').then(function (s) {
        var o2 = change(function (x) { mergeRemote(x, s.val()); readGame(x); });
        merged = true; send(c, o2, true);
      });
    }).catch(function () {});
  }

  // ---------------- API for the games' hooks ----------------
  function bump(k, v, how) {
    if (!okKey(k) || k === 's') return;
    v = num(v); if (!(v > 0)) return;
    change(function (o) {
      var g = mine(o);
      if (!(k in g) && Object.keys(g).length >= MAX_STATS) return;
      if (how === 'add') g[k] = clean(k, (num(g[k]) || 0) + Math.min(100, v)) || g[k];
      else { var c = clean(k, v); if (!(c > 0)) return; g[k] = how === 'min' ? (g[k] > 0 ? Math.min(g[k], c) : c) : Math.max(num(g[k]) || 0, c); }
    });
  }
  window.BackRoomStats = {
    game: GAME,
    add: function (k, n) { bump(k, n == null ? 1 : n, 'add'); },
    min: function (k, v) { bump(k, v, 'min'); },
    max: function (k, v) { bump(k, v, 'max'); }
  };
  // Test hook for the automated checks; harmless in normal play.
  if (navigator.webdriver) window.__lbs = {
    get pending() { return pending; }, get lastInput() { return lastInput; }, get merged() { return merged; }, get uid() { return conn && conn.uid; },
    load: load, flush: flush, publish: function () { return publish(false); }, engaged: function () { return engaged(Date.now()); },
    node: function () { return conn ? node(conn, load()) : null; }, cleanDays: cleanDays,
    setIdle: function (ms) { IDLE = ms; }, setPub: function (ms) { PUB_MS = ms; }
  };
})();
