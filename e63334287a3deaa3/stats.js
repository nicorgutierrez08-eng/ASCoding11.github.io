/*
 * Back Room stats: play time and personal bests for the Leaderboards (leaderboard.js).
 *
 * Every active Back Room game loads it with one line:
 *   <script src="/e63334287a3deaa3/stats.js" data-game="<folder>" defer></script>
 * It runs inside the game page, so it works the same whether the game was opened directly or inside the home page, phone page
 * or party layer (an iframe). account-nudge.js on the hub pages also loads it with data-lib (no game, nothing counted) to merge
 * an anonymous account's entry into the Google account someone just signed in with (link, below).
 *
 * Play time: a second counts while the tab is visible and there was a key, mouse, touch or gamepad input in the last 30 s
 * (GRACE). A quiet stretch after that (thinking, a cutscene, waiting for the next round) is held back: it counts once the
 * player touches something again within 2 minutes (IDLE), and is dropped if they don't (walked away) or the tab is hidden.
 * Only one tab or window of this browser counts at a time: the one with the latest input (localStorage 'lbs:tab', a claim
 * renewed every second), so two Back Room windows open side by side don't count the same minute twice. At most 24 hours a
 * day are counted (all games together, by this browser's date).
 * Personal bests: some come from what the game already saves (READ below), others from one-line hooks in the game:
 *   window.BackRoomStats && BackRoomStats.add('kills', 1)        a running count (at most 100 at a time)
 *   window.BackRoomStats && BackRoomStats.min('lap:monza', 81.2) a best where lower wins (times)
 *   window.BackRoomStats && BackRoomStats.max('height', 812)     a best where higher wins (e.g. most kills in one match)
 * Stat names are short lowercase words (a-z, 0-9, ':' and '-'); a name starting with 'lap:' or 'rec:' (Slipstream's
 * fastest lap and course record per track) or listed in LOWER is a time, where lower wins.
 *
 * Counting once, and only up. Play seconds are kept in this browser as seconds not yet sent, and sent as a batch that is
 * ADDED to the node's totals in a Firebase transaction (an atomic read-modify-write), never as this browser's own idea of
 * the total. So two devices on one account add up (before, each wrote its own total over the other's, and the board went up
 * and down between them), and a browser never hands its time to the next account it signs in with. Each batch has an id
 * (its time in ms) and the node remembers the last batch id from each device (q), so a batch that reached the database
 * but wasn't marked sent here (the page closed mid-way) is never added twice. The node's totals also never drop below the
 * totals this browser last saw committed (hw), so an older copy of this file still open somewhere can't lower them for good.
 *
 * Saved in this browser under localStorage 'lbs:v2': { un: { <folder>: seconds not sent yet }, ud: { YYYYMMDD: { <folder>:
 * seconds } } (the same, by day), d: day, ds: seconds counted that day, b: { <folder>: { <stat>: best } }, tc: { <folder>:
 * seconds this browser ever counted }, out: the batch being sent { u: uid, id, g, d }, qid: the last batch id, hw: [[uid, { <folder>: seconds }]...]
 * (the last committed totals, 4 accounts), v1: this browser's record from before (below), lk/lkd: anonymous accounts this
 * browser linked to a Google account, still to merge / merged }, 'lbs:dev' (this browser's device id), 'lbs:uid' (the account
 * it last published under; the Leaderboards' "You").
 * Before this version the browser kept totals in 'lbs:v1' ({ g: { <folder>: { s, <stat> } }, d, ds, dy }), shared by every
 * account used in the browser. On the first load of this version its bests become b and its seconds are folded in once, into
 * the account it last published under ('lbs:uid'), keeping the larger (the old rule), or added to the first account it
 * publishes under if it never published. 'lbs:v1' is left alone (an older copy of this file in another open tab still uses it).
 *
 * Published at most once a minute while something changed (and when the tab is hidden or the page closes, if connected) to
 * the Firebase Realtime Database, same project and rules as the games, at rooms/lb-all/players/<uid>. The shared rules only let
 * a browser write its own node and require n, c, x, z, h and ts, so the node is:
 *   n name (14)  c colour  x, z, h 0  ts last publish (server time)  v 2  st seat tag (1A–40F, as in social.js)
 *   g { <folder>: { s: seconds, <stat>: best } } (s is the account's total, every device together)
 *   d { YYYYMMDD: { <folder>: seconds } } the last 30 days, 8 games a day, pruned until the node fits in 7,000 characters
 *   q { <device id>: id of the last batch added from it } (the 12 most recent devices)
 *   lg { <folder>: seconds } the totals as they stood when this version first wrote the node ("legacy" time, from before
 *      batches; it may overlap between accounts used in one browser, so a merge keeps the larger of it instead of adding)
 *   al { <uid>: ms } anonymous accounts merged into this one (at most 8)    to <uid> this account was merged into that one
 *   ga 1 and gn the Google display name (40 characters, no email or photo) when the account is a Google sign-in, else neither
 * Nodes written by the older version (v 1: n, c, x, z, h, ts, v, st, g, d, ga, gn) read the same way; that version overwrote
 * the whole node, so while one is still open it can briefly wipe q, lg and al (the totals come back on this browser's next
 * publish, from hw).
 *
 * Linking (one person, two accounts): the games sign in anonymously; signing in with Google on a hub page makes a new account,
 * and before this version the anonymous account's entry stayed on the board under the same name. Now account-nudge.js keeps
 * the anonymous user it had on that page and, the moment the Google sign-in arrives, calls BackRoomStatsLib.link(): it writes
 * `to: <Google uid>` on the anonymous node while still able to act as that account (a second Firebase app, in memory only,
 * given that user), then the Google node merges it in its next transaction (time since batches added, legacy time the
 * larger, bests the better, al[<anon uid>] set). leaderboard.js hides a node only when both sides say so (its own `to`,
 * written by its owner, and the target's al), so nobody can hide someone else's entry.
 *
 * The name n is the player's one name, in the order social.js uses: the Online name (ol:name), else the signed-in Google
 * account's first name, else the party name, else a name a game saved. A rename on the Back Room page (Online or Party
 * panel, which also fix n on the node straight away) reaches an open game as a storage event, and the game republishes
 * a few seconds later (at most once every NAME_GAP, and only once it is already connected, so it never starts a sign-in early).
 * The node is never removed on disconnect: it is the player's leaderboard entry. Everything is self-reported, so it isn't
 * cheat-proof; leaderboard.js and the admin page cap and check every value they show.
 * Firebase: when the game is open inside the home, phone or party layer it borrows that page's sign-in (party.js); else it
 * uses the game's own Firebase if the game is online; else it loads the SDK in a hidden same-origin frame (only after a minute
 * of play) and signs in the way party.js does, so it never touches the game's own Firebase. The account is looked up again
 * at every publish, so a Google sign-in on the hub page while a game is open is followed.
 */
(function () {
  'use strict';
  var me0 = document.currentScript;
  var LIB = !!(me0 && me0.hasAttribute('data-lib'));
  if (LIB ? window.BackRoomStatsLib : window.BackRoomStats) return;

  var GAME = LIB ? '' : (me0 && me0.getAttribute('data-game')) || '';
  if (!LIB && !/^[a-z0-9-]{1,30}$/.test(GAME)) GAME = ((/\/e63334287a3deaa3\/([a-z0-9-]{1,30})\//.exec(location.pathname)) || [])[1] || '';
  if (!LIB && !GAME) return;

  var KEY = 'lbs:v2', OLD_KEY = 'lbs:v1', DEV_KEY = 'lbs:dev', TAB_KEY = 'lbs:tab', PATH = 'rooms/lb-all/players';
  var IDLE = 120000, GRACE = 30000, SAVE_MS = 15000, PUB_MS = 60000, DAY_MAX = 86400, TAB_FRESH = 3500;
  var MAX_GAMES = 80, MAX_STATS = 120;   // 80 games: the Back Room has 21, plus 21 daily puzzles and their hub (was 40)
  var DAYS = 30, DAY_GAMES = 8, NODE_CAP = 7000;    // per-day history: how many days and games a day are kept, and how big the node may get
  var MAX_DEV = 12, MAX_AL = 8, MAX_HW = 4, MAX_LK = 8;
  var NAME_WAIT = 1500, NAME_GAP = 10000;            // a rename republishes after NAME_WAIT, at most once every NAME_GAP
  var LOWER = { tower: 1, summit: 1, obby: 1 };
  LOWER.total = 1;   // Escapade's fastest total of all eight levels (min('total', seconds)) is a time too
  // The daily puzzles' fewest-guess and fastest bests (LOWER is one list for every game, so these names stay lower-wins everywhere):
  // fewest (Hunch, Fourcast), guesses (Hotspot, Nearword, Warmer), tries (Outline, Unfurl), fastest (Crosslet), fast-<level> (Ninefold).
  LOWER.fewest = 1; LOWER.guesses = 1; LOWER.tries = 1; LOWER.fastest = 1;
  LOWER['fast-easy'] = 1; LOWER['fast-medium'] = 1; LOWER['fast-hard'] = 1;
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
  function obj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : NaN; }
  function okKey(k) { return typeof k === 'string' && /^[a-z][a-z0-9:-]{0,39}$/.test(k); }
  function okGame(k) { return typeof k === 'string' && /^[a-z0-9-]{1,30}$/.test(k); }
  function okUid(u) { return typeof u === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(u); }
  function lower(k) { return k.indexOf('lap:') === 0 || k.indexOf('rec:') === 0 || LOWER[k] === 1; }
  // Rude words in names are masked by the shared name filter (/namefilter.js) when the page has loaded it.
  function byFilter(v) { return window.NameFilter ? window.NameFilter.clean(v) : v; }
  function cleanName(s, n) { return byFilter(String(s == null ? '' : s).replace(/[<>\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, n || 14)); }
  function rid(n) { var s = ''; try { var a = new Uint8Array(n); crypto.getRandomValues(a); for (var i = 0; i < n; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(a[i] % 36); } catch (e) { while (s.length < n) s += Math.random().toString(36).slice(2); } return s.slice(0, n); }
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
  // Keep the better of two values for a stat (counts: the larger; times: the smaller).
  function better(k, a, b) {
    if (!(a > 0)) return b; if (!(b > 0)) return a;
    return lower(k) ? Math.min(a, b) : Math.max(a, b);
  }
  // Rebuild a g object field by field (used on local data and on what we read from a node). noS: bests only.
  function cleanG(g, noS) {
    var out = {}, n = 0;
    if (!obj(g)) return out;
    Object.keys(g).slice(0, MAX_GAMES * 2).forEach(function (gk) {
      if (n >= MAX_GAMES || !okGame(gk)) return;
      var src = g[gk], o = {}, m = 0;
      if (!obj(src)) return;
      Object.keys(src).slice(0, MAX_STATS * 2).forEach(function (k) {
        if (m >= MAX_STATS || !(k === 's' ? !noS : okKey(k))) return;
        var v = k === 's' ? Math.floor(num(src[k])) : clean(k, src[k]);
        if (v > 0 && v < 1e9) { o[k] = v; m++; }
      });
      if (m) { out[gk] = o; n++; }
    });
    return out;
  }
  // { <folder>: whole seconds } (unsent seconds, a batch, legacy totals, a watermark).
  function cleanSecs(src) {
    var out = {}, n = 0;
    if (!obj(src)) return out;
    Object.keys(src).slice(0, MAX_GAMES * 2).forEach(function (gk) {
      if (n >= MAX_GAMES || !okGame(gk)) return;
      var v = Math.floor(num(src[gk]));
      if (v > 0 && v < 1e9) { out[gk] = v; n++; }
    });
    return out;
  }
  // { <uid or device id>: ms }, the newest `max` entries.
  function cleanStamps(src, max, keyOk) {
    var out = {};
    if (!obj(src)) return out;
    Object.keys(src).slice(0, max * 4).filter(function (k) { return keyOk(k) && num(src[k]) > 0; })
      .sort(function (a, b) { return num(src[b]) - num(src[a]); }).slice(0, max)
      .forEach(function (k) { out[k] = Math.round(num(src[k])); });
    return out;
  }
  function okDev(k) { return typeof k === 'string' && /^[a-z0-9]{6,16}$/.test(k); }

  // Rebuild the per-day history field by field: the last 30 days only (tomorrow is allowed, for a device in another time zone),
  // at most DAY_GAMES games a day, whole seconds, and no more than 24 hours in a day.
  function cleanDays(src) {
    var out = {};
    if (!obj(src)) return out;
    var lo = dayAgo(DAYS - 1), hi = dayAgo(-1);
    Object.keys(src).filter(function (k) { return /^\d{8}$/.test(k) && k >= lo && k <= hi; }).sort().slice(-DAYS).forEach(function (k) {
      var g = src[k], o = {}, m = 0, tot = 0;
      if (!obj(g)) return;
      Object.keys(g).slice(0, DAY_GAMES * 2).forEach(function (gk) {
        if (m >= DAY_GAMES || tot >= DAY_MAX || !okGame(gk)) return;
        var v = Math.floor(num(g[gk]));
        if (!(v > 0)) return;
        v = Math.min(v, DAY_MAX - tot); o[gk] = v; tot += v; m++;
      });
      if (m) out[k] = o;
    });
    return out;
  }
  // Add one day history into another (how: 'add' for this browser's new seconds, 'max' for an account being merged in).
  function addDays(into, src, how) {
    Object.keys(src).forEach(function (k) {
      var day = into[k] || (into[k] = {});
      Object.keys(src[k]).forEach(function (gk) {
        if (day[gk] == null && Object.keys(day).length >= DAY_GAMES) return;
        day[gk] = how === 'max' ? Math.max(day[gk] | 0, src[k][gk]) : (day[gk] | 0) + src[k][gk];
      });
    });
    return cleanDays(into);
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
  // This browser's device id, kept for good (a fresh one per page when storage is blocked).
  var DEV = ls(DEV_KEY);
  if (!okDev(DEV)) { DEV = rid(10); ls(DEV_KEY, DEV); }
  function cleanBatch(b) {
    if (!obj(b) || !okUid(b.u) || !(num(b.id) > 0)) return null;
    return { u: b.u, id: Math.round(num(b.id)), g: cleanSecs(b.g), d: cleanDays(b.d) };
  }
  function cleanHw(a) {
    var out = [];
    (Array.isArray(a) ? a : []).slice(0, MAX_HW).forEach(function (e) { if (Array.isArray(e) && okUid(e[0])) out.push([e[0], cleanSecs(e[1])]); });
    return out;
  }
  function cleanLinks(src) {
    var out = {};
    if (!obj(src)) return out;
    Object.keys(src).slice(0, MAX_LK).forEach(function (u) { if (okUid(u) && okUid(src[u]) && u !== src[u]) out[u] = src[u]; });
    return out;
  }
  // The first load of this version: start from the older record (lbs:v1), if there is one.
  function fromV1() {
    var o = json(ls(OLD_KEY));
    if (!obj(o)) return {};
    var g = cleanG(o.g), s = {};
    Object.keys(g).forEach(function (gk) { if (g[gk].s > 0) s[gk] = g[gk].s; });
    var u = ls('lbs:uid');
    return { d: o.d, ds: o.ds, b: cleanG(o.g, true), v1: Object.keys(s).length ? { u: okUid(u) ? u : '', g: s } : null };
  }
  function load() {
    var raw = ls(KEY), o = json(raw);
    if (!obj(o)) o = fromV1();
    var v1 = obj(o.v1) ? { u: okUid(o.v1.u) ? o.v1.u : '', g: cleanSecs(o.v1.g) } : null;
    return {
      un: cleanSecs(o.un), ud: cleanDays(o.ud), d: typeof o.d === 'string' ? o.d.slice(0, 12) : '', ds: Math.max(0, Math.min(DAY_MAX, num(o.ds) || 0)),
      b: cleanG(o.b, true), tc: cleanSecs(o.tc), out: cleanBatch(o.out), hw: cleanHw(o.hw),
      v1: v1 && Object.keys(v1.g).length ? v1 : null, lk: cleanLinks(o.lk), lkd: cleanLinks(o.lkd), qid: Math.max(0, Math.round(num(o.qid)) || 0)
    };
  }
  function save(o) { ls(KEY, JSON.stringify(o)); }
  // Change the stored data in one read-modify-write, so two tabs never undo each other's time.
  function change(fn) { var o = load(); fn(o); save(o); return o; }
  function hwOf(o, uid) { for (var i = 0; i < o.hw.length; i++) if (o.hw[i][0] === uid) return o.hw[i][1]; return {}; }
  function has(m) { return Object.keys(m).length > 0; }

  var pending = 0, held = 0, lastInput = 0, lastTick = Date.now();
  // A batch id: its time, but always above this browser's last one (kept in the store), so a clock set back can't make a new
  // batch look already sent.
  function newId(o) { o.qid = Math.max(Date.now(), (o.qid || 0) + 1); return o.qid; }
  function flush() {
    if (pending < 1 || !GAME) return;
    var add = Math.floor(pending); pending -= add;
    change(function (o) {
      var d = today(); if (o.d !== d) { o.d = d; o.ds = 0; }
      add = Math.min(add, DAY_MAX - o.ds); if (add <= 0) return;
      if (o.un[GAME] == null && Object.keys(o.un).length >= MAX_GAMES) return;
      o.ds += add; o.un[GAME] = (o.un[GAME] || 0) + add;
      if (o.tc[GAME] != null || Object.keys(o.tc).length < MAX_GAMES) o.tc[GAME] = (o.tc[GAME] || 0) + add;
      // The same seconds under today's date, for the admin page's activity view.
      var day = o.ud[dayAgo(0)] || (o.ud[dayAgo(0)] = {});
      if (day[GAME] != null || Object.keys(day).length < DAY_GAMES) day[GAME] = Math.min(DAY_MAX, (day[GAME] | 0) + add);
      o.ud = cleanDays(o.ud);
    });
  }

  // ---------------- Engaged time ----------------
  // Only real input counts: not events a script made up, and not the still "mouse moves" browsers send when the page changes under the pointer.
  var mx = -1, my = -1, TAB = rid(8);
  function mark(e) {
    if (!e.isTrusted) return;
    if (e.type === 'mousemove' || e.type === 'pointermove') {
      var moved = e.movementX || e.movementY || (mx >= 0 && (e.screenX !== mx || e.screenY !== my));
      mx = e.screenX; my = e.screenY;
      if (!moved) return;
    }
    lastInput = Date.now();
  }
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
  // Only one tab of this browser counts: this one, unless another tab claimed the last few seconds with newer input.
  function claim(t) {
    var c = json(ls(TAB_KEY));
    if (obj(c) && c.id !== TAB && t - num(c.at) < TAB_FRESH && num(c.li) > lastInput) return false;
    ls(TAB_KEY, JSON.stringify({ id: TAB, li: lastInput, at: t }));
    return true;
  }
  var lastSave = Date.now(), lastPub = Date.now();
  function tick() {
    var t = Date.now(), dt = Math.min(5000, Math.max(0, t - lastTick)) / 1000; lastTick = t;
    if (padActive()) lastInput = t;
    if (!engaged(t)) held = 0;                         // hidden, or nothing for IDLE: the quiet stretch before doesn't count
    else if (claim(t)) {
      if (t - lastInput < GRACE) { pending += held + dt; held = 0; }
      else held += dt;                                // quiet: counts if they're back within IDLE
    }
    if (t - lastSave >= SAVE_MS) { lastSave = t; flush(); }
    if (t - lastPub >= PUB_MS) { lastPub = t; publish(false); }
  }
  if (!LIB) {
    ['keydown', 'pointerdown', 'pointermove', 'mousemove', 'touchstart', 'wheel'].forEach(function (t) {
      addEventListener(t, mark, { capture: true, passive: true });
    });
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', function () { tick(); if (document.visibilityState === 'hidden') { held = 0; flush(); publish(true); } });
    addEventListener('pagehide', function () { tick(); flush(); publish(true); });
  }
  // A rename on the Back Room page (another document, so it arrives as a storage event): republish soon, if connected.
  var nameT = 0, lastNamePub = 0;
  if (!LIB) addEventListener('storage', function (e) {
    if (e.key !== 'ol:name' && e.key !== 'party:name') return;
    clearTimeout(nameT);
    nameT = setTimeout(function () {
      if (!conn || !merged) return;                   // not connected yet: the next regular publish carries the name
      lastNamePub = Date.now(); publish(false);
    }, Math.max(NAME_WAIT, lastNamePub + NAME_GAP - Date.now()));
  });

  // ---------------- Firebase ----------------
  // { db, uid(), now(), J, user() } where J is the JSON of the window that owns db (another page's, when we borrow its connection),
  // uid() the account signed in right now and user() the Google account behind it, if it is one (null for the games' anonymous sign-ins).
  var conn = null, connecting = null, merged = false, lastSent = '', busy = false;
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
        var cur = function () { return auth.currentUser || u; };
        return { db: db, uid: function () { return cur().uid; }, now: function () { return Date.now() + offset; }, J: J, user: function () { var x = cur(); return googleUser(x, x.uid); } };
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
  // A hub page's party.js (window.Party, here or in the page around this frame) as a connection: its account, live.
  function fromParty(P, PW) {
    return P.boot().then(function (b) {
      var auth = null; try { auth = b.app ? b.app.auth() : null; } catch (e) { auth = null; }
      var uid = function () { var u = auth && auth.currentUser; return u ? u.uid : b.uid; };
      // The hub page's account: Google when account.js signed it in there (party.js reuses that sign-in), else anonymous.
      var user = function () {
        var u = null;
        try { u = auth ? auth.currentUser : null; if (!u && PW.SiteAccount && PW.SiteAccount.user) u = PW.SiteAccount.user(); } catch (e) { u = null; }
        return googleUser(u, uid());
      };
      return { db: b.db, uid: uid, now: P.now, J: PW.JSON, user: user, auth: auth };
    });
  }
  function getConn() {
    if (conn) return Promise.resolve(conn);
    if (connecting) return connecting;
    var p, P = null, PW = null, app = ours(window.firebase);
    if (LIB && window.Party && window.Party.boot) { P = window.Party; PW = window; }
    try { if (!P && window.parent !== window && window.parent.Party && window.parent.Party.boot) { P = window.parent.Party; PW = window.parent; } } catch (e) {}
    // 1. Inside the home, phone or party layer: borrow the hub page's sign-in (party.js), the account its panels show as "You".
    if (P) p = fromParty(P, PW);
    // 2. The game already has our project's Firebase running (it's online): use it.
    else if (app) p = fromApp(app, JSON, true);
    // 3. Otherwise a frame of our own (never on a hub page, which always has party.js).
    else if (!LIB) p = sidecar();
    else p = Promise.reject(new Error('no party'));
    connecting = p.then(function (c) { conn = c; connecting = null; return c; }, function (e) { connecting = null; throw e; });
    return connecting;
  }

  // u, when it is the account we publish under and not one of the games' anonymous sign-ins.
  function googleUser(u, uid) { return u && u.uid === uid && u.isAnonymous === false ? u : null; }

  // ---------------- The node ----------------
  function readGame(o) {
    var f = READ[GAME]; if (!f) return;
    var r = {}; try { r = f() || {}; } catch (e) {}
    Object.keys(r).forEach(function (k) {
      var v = clean(k, r[k]); if (!(v > 0)) return;
      var g = o.b[GAME]; if (!g) { if (Object.keys(o.b).length >= MAX_GAMES) return; g = o.b[GAME] = {}; }
      if (g[k] != null || Object.keys(g).length < MAX_STATS) g[k] = better(k, g[k], v);
    });
  }
  // The node after this publish, from the node as it stands (cur, which may be null or from the older version).
  // x: { uid, dev, batch, b (bests), hw (watermark), v1, abs: [{ uid, node }] to merge in, keep: [uids] already merged, n, u, now }
  function apply(cur, x) {
    cur = obj(cur) ? cur : {};
    var g = cleanG(cur.g), d = cleanDays(cur.d), q = cleanStamps(cur.q, MAX_DEV, okDev), al = cleanStamps(cur.al, MAX_AL, okUid);
    var lg = cur.v === 2 ? cleanSecs(cur.lg) : null;          // (an empty lg isn't stored: a v 2 node without one has no legacy time)
    function S(gk) { return (g[gk] && g[gk].s) || 0; }
    function addS(gk, n) {
      n = Math.floor(n); if (!(n > 0)) return;
      if (!g[gk]) { if (Object.keys(g).length >= MAX_GAMES) return; g[gk] = {}; }
      g[gk].s = Math.min(1e9 - 1, S(gk) + n);
    }
    function best(gk, k, v) {
      if (!g[gk]) { if (Object.keys(g).length >= MAX_GAMES) return; g[gk] = {}; }
      if (g[gk][k] != null || Object.keys(g[gk]).length < MAX_STATS) g[gk][k] = better(k, g[gk][k], v);
    }
    // Never below what this browser last saw committed (an older copy of this file may have written a smaller total).
    Object.keys(x.hw).forEach(function (gk) { if (S(gk) < x.hw[gk]) addS(gk, x.hw[gk] - S(gk)); });
    // A node from the older version (or none): everything in it so far is legacy time.
    if (!lg) { lg = {}; Object.keys(g).forEach(function (gk) { if (S(gk) > 0) lg[gk] = S(gk); }); }
    // This browser's record from before, once: the larger, as the older version did, for the account it last published
    // under; added, if it never published (then it's only this browser's own time).
    if (x.v1) Object.keys(x.v1.g).forEach(function (gk) {
      var v = x.v1.g[gk], l = lg[gk] || 0;
      if (!x.v1.u) { addS(gk, v); lg[gk] = l + v; }
      else if (v > l) { addS(gk, v - l); lg[gk] = v; }
    });
    // This browser's new seconds, unless this batch was already added.
    if (x.batch && !(q[DEV] >= x.batch.id)) {
      Object.keys(x.batch.g).forEach(function (gk) { addS(gk, x.batch.g[gk]); });
      d = addDays(d, x.batch.d, 'add');
      q[DEV] = x.batch.id;
    }
    // Anonymous accounts their owner merged into this one: time since batches added, legacy time the larger, bests the better.
    x.abs.forEach(function (a) {
      if (al[a.uid]) return;
      var xg = cleanG(a.node.g), xlg = a.node.v === 2 ? cleanSecs(a.node.lg) : null;
      Object.keys(xg).forEach(function (gk) {
        var xs = xg[gk].s || 0, xl = xlg ? Math.min(xs, xlg[gk] || 0) : xs, l = lg[gk] || 0;
        addS(gk, (xs - xl) + Math.max(0, xl - l));
        if (xl > l) lg[gk] = xl;
        Object.keys(xg[gk]).forEach(function (k) { if (k !== 's') best(gk, k, xg[gk][k]); });
      });
      d = addDays(d, cleanDays(a.node.d), 'max');
      al[a.uid] = Math.round(x.now);
    });
    x.keep.forEach(function (u) { if (!al[u]) al[u] = Math.round(x.now); });
    // Bests from this browser.
    Object.keys(x.b).forEach(function (gk) { Object.keys(x.b[gk]).forEach(function (k) { best(gk, k, x.b[gk][k]); }); });
    Object.keys(lg).forEach(function (gk) { if (!g[gk]) delete lg[gk]; else lg[gk] = Math.min(lg[gk], S(gk)); });
    q = cleanStamps(q, MAX_DEV, okDev); al = cleanStamps(al, MAX_AL, okUid);
    var nd = { n: x.n, c: colorOf(x.uid), x: 0, z: 0, h: 0, ts: Math.round(x.now), v: 2, st: seatOf(x.uid), g: g, d: d, lg: lg, q: q };
    if (has(al)) nd.al = al;
    if (okUid(cur.to) && cur.to !== x.uid) nd.to = cur.to;     // this account was merged into another (its owner said so)
    // A Google account: say so, with its display name (never the email or photo), so the admin page can tell accounts apart.
    if (x.u) { nd.ga = 1; var gn = cleanName(x.u.displayName, 40); if (gn) nd.gn = gn; }
    // Keep the node small enough for leaderboard.js (8,000 characters): drop the oldest days first.
    var days = Object.keys(nd.d).sort();
    while (days.length && JSON.stringify(nd).length > NODE_CAP) delete nd.d[days.shift()];
    if (!has(nd.d)) delete nd.d;
    if (!has(nd.lg)) delete nd.lg;
    return nd;
  }
  function totals(nd) { var out = {}; Object.keys((nd && nd.g) || {}).forEach(function (gk) { if (nd.g[gk].s > 0) out[gk] = nd.g[gk].s; }); return out; }
  function readNode(c, uid) { return c.db.ref(PATH + '/' + uid).once('value').then(function (s) { return s.val(); }); }

  // One publish: batch the unsent seconds, then add them (and the bests, the name, any account to merge) in one transaction.
  // force: send even if nothing changed (the first publish of a page, a link).
  function run(c, force) {
    var uid = c.uid(), u = null;
    try { u = c.user ? c.user() : null; } catch (e) { u = null; }
    var o = change(function (x) {
      if (!x.out && has(x.un)) { x.out = { u: uid, id: newId(x), g: x.un, d: x.ud }; x.un = {}; x.ud = {}; }
    });
    var n = myName(u), sig = JSON.stringify([uid, n, o.b, !!u, u && u.displayName]);
    var lk = Object.keys(o.lk).filter(function (k) { return o.lk[k] === uid; });
    if (!force && !o.out && !lk.length && !(o.v1 && (!o.v1.u || o.v1.u === uid)) && sig === lastSent && merged) return Promise.resolve(false);
    // A batch made while signed in as another account (a sign-in or sign-out since): give it to this one, unless it already
    // reached that account's node.
    var pre = Promise.resolve(o.out);
    if (o.out && o.out.u !== uid) pre = c.db.ref(PATH + '/' + o.out.u + '/q/' + DEV).once('value').then(function (s) {
      var done = num(s.val()) >= o.out.id, old = o.out.id;
      var o2 = change(function (x) { if (x.out && x.out.id === old) x.out = done ? null : { u: uid, id: newId(x), g: x.out.g, d: x.out.d }; });
      return o2.out && o2.out.u === uid ? o2.out : null;
    });
    // Anonymous accounts this browser linked to this one: merge each whose own node says so.
    var abs = [];
    var pre2 = pre.then(function (batch) {
      return Promise.all(lk.map(function (xu) {
        return readNode(c, xu).then(function (v) { if (obj(v) && v.to === uid) abs.push({ uid: xu, node: v }); else change(function (x) { delete x.lk[xu]; }); });
      })).then(function () { return batch; });
    });
    return pre2.then(function (batch) {
      var keep = Object.keys(o.lkd).filter(function (k) { return o.lkd[k] === uid; });
      var v1 = o.v1 && (!o.v1.u || o.v1.u === uid) ? o.v1 : null;
      var x = { uid: uid, batch: batch, b: o.b, hw: hwOf(o, uid), v1: v1, abs: abs, keep: keep, n: n, u: u, now: c.now() };
      return c.db.ref(PATH + '/' + uid).transaction(function (cur) {
        x.now = c.now();
        return c.J.parse(JSON.stringify(apply(cur, x)));
      }, null, false).then(function (r) {
        if (!r || !r.committed) { lastSent = ''; return false; }
        var nd = r.snapshot.val();
        change(function (y) {
          if (batch && y.out && y.out.id === batch.id) y.out = null;
          if (v1) y.v1 = null;
          abs.forEach(function (a) { delete y.lk[a.uid]; y.lkd[a.uid] = uid; });
          y.hw = [[uid, totals(nd)]].concat(y.hw.filter(function (e) { return e[0] !== uid; })).slice(0, MAX_HW);
        });
        ls('lbs:uid', uid);
        lastSent = sig; merged = true;
        return true;
      });
    });
  }
  // closing: the page is going away or out of sight: only if already connected (the batch is saved here either way, and
  // goes with the next publish of any game in this browser if this one doesn't finish).
  function publish(closing, force) {
    flush();
    change(readGame);
    var o = load();
    if (!has(o.un) && !o.out && !has(o.b) && !o.v1 && !has(o.lk)) return Promise.resolve(false);
    if (closing && !conn) return Promise.resolve(false);
    if (busy) return Promise.resolve(false);
    busy = true;
    return getConn().then(function (c) { return run(c, force || !merged); })
      .catch(function () { lastSent = ''; return false; })
      .then(function (r) { busy = false; return r; });
  }

  // ---------------- Linking an anonymous account to the Google account that just signed in (hub pages) ----------------
  // old: the anonymous firebase user the page had before the Google sign-in; P: the page's party.js; G: the Google uid.
  // Writes `to: G` on the old node as the old account (a second app, in memory only), then lets G's next publish merge it.
  function asUser(user, fn) {
    var F = window.firebase;
    if (!F || !F.initializeApp || !F.auth) return Promise.reject(new Error('no sdk'));
    var app2 = F.initializeApp(CFG, 'lbs-link-' + rid(6)), a2 = app2.auth();
    return a2.setPersistence(F.auth.Auth.Persistence.NONE)
      .then(function () { return a2.updateCurrentUser(user); })
      .then(function () { if (!a2.currentUser || a2.currentUser.uid !== user.uid) throw new Error('not linked'); return fn(app2.database(CFG.databaseURL)); })
      .then(function (r) { app2.delete().catch(function () {}); return r; }, function (e) { app2.delete().catch(function () {}); throw e; });
  }
  var anyTarget = false;     // tests only (no Google account in a test browser): let an anonymous account be the target
  function link(old, P, G) {
    if (!old || !okUid(old.uid) || old.isAnonymous !== true || !P || !P.boot) return Promise.resolve('skip');
    var X = old.uid, t0 = Date.now();
    // party.js follows the sign-in a moment later (on the phone page in the home page's frame, through saved storage).
    function ready() {
      return P.boot().then(function (b) {
        var cu = null; try { cu = b.app.auth().currentUser; } catch (e) { cu = null; }
        if (cu && (!cu.isAnonymous || anyTarget) && cu.uid !== X && (!G || cu.uid === G)) return b;
        if (Date.now() - t0 > 15000) throw new Error('no google');
        return new Promise(function (r) { setTimeout(r, 500); }).then(ready);
      });
    }
    return ready().then(function (b) {
      var gu = b.app.auth().currentUser.uid;
      return b.db.ref(PATH + '/' + X).once('value').then(function (s) {
        var xv = s.val();
        if (!obj(xv) || !obj(xv.g)) return 'none';                  // nothing on the board to move
        if (okUid(xv.to) && xv.to !== gu) return 'elsewhere';         // already merged into another account
        var mark = xv.to === gu ? Promise.resolve() : asUser(old, function (db2) { return db2.ref(PATH + '/' + X).update({ to: gu, ts: Math.round(P.now ? P.now() : Date.now()) }); });
        return mark.then(function () {
          change(function (o) { o.lk[X] = gu; });
          return getConn().then(function (c) { return run(c, true); }).then(function () { return 'linked'; });
        });
      });
    });
  }

  // ---------------- API ----------------
  if (LIB) {
    window.BackRoomStatsLib = { link: link, apply: apply, PATH: PATH };
  } else {
    var bump = function (k, v, how) {
      if (!okKey(k) || k === 's') return;
      v = num(v); if (!(v > 0)) return;
      change(function (o) {
        var g = o.b[GAME]; if (!g) { if (Object.keys(o.b).length >= MAX_GAMES) return; g = o.b[GAME] = {}; }
        if (!(k in g) && Object.keys(g).length >= MAX_STATS) return;
        if (how === 'add') g[k] = clean(k, (num(g[k]) || 0) + Math.min(100, v)) || g[k];
        else { var c = clean(k, v); if (!(c > 0)) return; g[k] = how === 'min' ? (g[k] > 0 ? Math.min(g[k], c) : c) : Math.max(num(g[k]) || 0, c); }
      });
    };
    window.BackRoomStats = {
      game: GAME,
      add: function (k, n) { bump(k, n == null ? 1 : n, 'add'); },
      min: function (k, v) { bump(k, v, 'min'); },
      max: function (k, v) { bump(k, v, 'max'); }
    };
  }
  // Test hook for the automated checks; harmless in normal play.
  if (navigator.webdriver) window[LIB ? '__lbsLib' : '__lbs'] = {
    get pending() { return pending; }, get held() { return held; }, get lastInput() { return lastInput; }, get merged() { return merged; },
    get uid() { return conn && conn.uid(); }, get dev() { return DEV; },
    load: load, flush: flush, publish: function () { return publish(false); }, engaged: function () { return engaged(Date.now()); },
    local: function (gk) { flush(); var t = load().tc; return gk ? t[gk] || 0 : t; }, apply: apply, cleanDays: cleanDays,
    setIdle: function (ms) { IDLE = ms; }, setGrace: function (ms) { GRACE = ms; }, setPub: function (ms) { PUB_MS = ms; }, setSave: function (ms) { SAVE_MS = ms; },
    link: link, anyTarget: function () { anyTarget = true; }
  };
})();
