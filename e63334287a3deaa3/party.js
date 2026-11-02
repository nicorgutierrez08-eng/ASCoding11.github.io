/*
 * Back Room parties: group up (up to 8 people), then the leader moves everyone into the same game room.
 *
 * Loaded two ways:
 *   - by the home page right after the secret code reveals the Back Room (its reveal() adds this script and
 *     sets window.BackRoom = { openGame, isOpen, invite } so games open in its full-screen layer), and
 *   - by a <script> tag on e63334287a3deaa3/index.html, for anyone who opens that page directly
 *     (then games open in a small layer of our own).
 *
 * Storage: Firebase Realtime Database (same project and rules as Rumble Karts), one room per party at
 * rooms/pt-<code>. The shared rules only let a browser write its own node, rooms/pt-<code>/players/<uid>,
 * and that node needs the same fields the games write (n, c, x, z, h, ts), so everything lives there:
 *   n  name (14 chars)       c  colour (#rrggbb)     x, z, h  always 0 (required by the rules)
 *   ts last heartbeat         j  when they joined (server time)
 *   pk game the leader has picked (leader only)
 *   go { id, g, r, t }        the leader's latest launch: game key, room code, server time
 *   kick [{ u, t }]           people the leader removed (uid, server time), up to 8, kept for 10 minutes
 * The leader is whoever has been in the party longest (smallest j), so when the leader leaves the next
 * person takes over with nothing to hand over. Closing the tab removes your node (onDisconnect).
 *
 * Kicking: the leader can't delete anyone else's node, so it lists them in kick in its own node. Every member
 * watches the current leader's list (only the leader's counts), and one that finds its own uid there with a
 * time in the last 10 minutes leaves by removing its own node and says who removed it. Joining checks the
 * leader's list first, so a kicked person can't come back for 10 minutes (as long as the same leader is there).
 *
 * "Play together" writes go, and every member's browser opens that game with #<prefix>-<room>, then puts the
 * party name in the game's name box and the room in its room box, and presses its own "Play in room" button for
 * them (the game's menu ids are in GAMES). The game's own saved name is put back afterwards (nk in GAMES).
 * To add a game: add a row to GAMES. If its menu uses other ids than name / room / joinRoom, give them in ids,
 * and give the localStorage key it saves its name under in nk.
 * Names: one name everywhere. The Online name (localStorage ol:name, social.js) is the player's name, then the signed-in
 * account's first name, then the party name (party:name), then any name a game saved: the same order social.js uses, so
 * both panels and the leaderboard say the same thing. Typing in the name box here saves ol:name and party:name and tells
 * social.js (a `backroom:name` event with from: 'party'); a rename there or in another tab (`backroom:name` / storage)
 * is written to our party node at once, so the rest of the party sees it within a second or so.
 * Members show with their avatar (avatar.js) and status tier badge (miles.js) when those scripts are here; without
 * them, a coloured initial and no badge.
 */
(function () {
  'use strict';
  if (document.getElementById('party')) return;

  var MAX = 8, STALE = 120000, BEAT = 15000, KICK_TTL = 10 * 60000;
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

  // Party-ready games. pre: what goes before the room code in the game's address (default k + '-').
  // max: most people one of its rooms holds. ids: the game's menu fields, if not name / room / joinRoom.
  // nk: the localStorage key where the game saves its own name (Hail Mary's is a team name), put back after a party launch.
  var GAMES = [
    { k: 'sc', n: 'Shell Crackers', d: 'shell-crackers', max: 8, nk: 'shellcr-name' },
    { k: 'rk', n: 'Rumble Karts', d: 'rumble-karts', max: 8, pre: '', nk: 'rk_name', ids: { name: 'inName', room: 'inRoom', join: 'bOnline' } },
    { k: 'ss', n: 'Slipstream', d: 'slipstream', max: 8, nk: 'ss:name' },
    { k: 'bb', n: 'Boostball', d: 'boostball', max: 6, nk: 'boostball-name', prep: function (doc, n) {
      // Room size comes from whoever opens the room first, so everyone picks the size that fits the party.
      var b = doc.querySelector('#sizeSeg [data-s="' + Math.min(3, Math.max(1, Math.ceil(n / 2))) + '"]'); if (b) b.click();
    } },
    { k: 'cl', n: 'Coil', d: 'coil', max: 8, nk: 'coil:name' },
    { k: 'sd', n: 'Showdown', d: 'showdown', max: 8, nk: 'sd:name' },
    { k: 'br', n: 'Backrooms 1v1–4v4', d: 'backrooms-1v1', max: 8, nk: 'br1v1-name' },
    { k: 'cf', n: 'Chromaflage', d: 'chromaflage', max: 8, nk: 'chroma-name' },
    { k: 'tw', n: 'Spire', d: 'spire', max: 12, nk: 'spire:name' },
    { k: 'sr', n: 'Turbo Trail', d: 'turbo-trail', max: 12, nk: 'turbotrail:name' },
    { k: 'er', n: 'Escapade', d: 'escapade', max: 12, nk: 'escapade:name' },
    { k: 'up', n: 'Updraft', d: 'updraft', max: 12, nk: 'updraft:name' },
    { k: 'ph', n: 'Odd One Out', d: 'odd-one-out', max: 16, nk: 'oddone-name' },
    { k: 'ko', n: 'Tumble Trials', d: 'tumble-trials', max: 16, nk: 'tumble-name' },
    { k: 'dw', n: 'Deepword', d: 'deepword', max: 12, nk: 'deepword-name' },
    { k: 'pf', n: 'Puffer Party', d: 'puffer-party', max: 12, nk: 'pufferparty:name' }
  ];
  var COLORS = ['#1D6A4B', '#C0562F', '#3E5BA9', '#9A3F8F', '#B07A12', '#2A8A8A', '#B42318', '#5B6B2E'];

  var me0 = document.currentScript && document.currentScript.src;
  var BASE = (me0 ? new URL(me0, location.href).pathname : location.pathname).replace(/[^/]*$/, '');
  var BR = window.BackRoom || null;

  function byKey(k) { for (var i = 0; i < GAMES.length; i++) if (GAMES[i].k === k) return GAMES[i]; return null; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function sess(k, v) {
    try {
      if (v === undefined) return sessionStorage.getItem(k);
      if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  // Rude words in names are masked by the shared name filter (/namefilter.js) when the page has loaded it.
  function byFilter(v) { return window.NameFilter ? window.NameFilter.clean(v) : v; }
  function cleanName(s) { return byFilter(String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14)); }
  function cleanCode(s) { return String(s || '').toLowerCase().replace(/^.*#?pt-/, '').replace(/[^a-z0-9]/g, '').slice(0, 8); }
  function rand(n) { var a = 'abcdefghjkmnpqrstuvwxyz23456789', s = ''; for (var i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function colorOf(uid) { var h = 0; for (var i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
  function timeout(p, ms, msg) { var t; return Promise.race([p, new Promise(function (_, rej) { t = setTimeout(function () { rej(new Error(msg)); }, ms); })]).finally(function () { clearTimeout(t); }); }
  var NET = 'Couldn’t reach the game database. If you’re on a school or work network it may be blocking it; try another network.';

  // A name to start from (after the Online name): the signed-in account, then the one used for parties before, then any
  // name a game saved. The same order as social.js's guessName.
  function guessName() {
    var u = window.SiteAccount && SiteAccount.user && SiteAccount.user();
    if (u && (u.displayName || u.email)) return cleanName((u.displayName || u.email).split(/[\s@]/)[0]);
    var s = store('party:name'); if (s) return cleanName(s);
    var keys = ['coil:name', 'ss:name', 'sd:name', 'spire:name', 'updraft:name', 'boostball-name', 'shellcr-name', 'br1v1-name', 'rk_name', 'chroma-name', 'oddone-name', 'tumble-name', 'kw:name', 'quarry:name'];
    for (var i = 0; i < keys.length; i++) {
      var v = store(keys[i]); if (!v) continue;
      try { if (v.charAt(0) === '"') v = JSON.parse(v); } catch (e) {}
      v = cleanName(v); if (v) return v;
    }
    return '';
  }

  // ---------------- Styles ----------------
  var css = document.createElement('style');
  css.textContent =
    '#party{padding-top:32px}' +
    '.pty{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px 16px;display:grid;gap:14px;min-width:0}' +
    '.pty-main{display:grid;gap:14px;min-width:0}' +
    '.pty-top{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap}' +
    '.pty h2{margin:0;font-size:28px;line-height:1}' +
    '.pty-sub{margin:0;color:var(--ink-2);font-size:15px;flex:1 1 260px}' +
    '.pty-row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}' +
    '.pty-row.split{justify-content:space-between}' +
    '.pty label{display:grid;gap:4px;font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);flex:1 1 150px;max-width:260px}' +
    '.pty input{font:inherit;font-family:var(--body);font-size:16px;font-weight:400;letter-spacing:0;text-transform:none;color:var(--ink);background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:9px 12px;min-height:44px;width:100%;min-width:0}' +
    '.pty input:focus{border-color:var(--accent);outline:none}' +
    '.pty .btn{font:inherit;font-weight:600;color:var(--ink);cursor:pointer}' +
    '.pty .btn.primary{color:var(--accent-ink)}' +
    '.pty .btn[disabled]{opacity:.55;cursor:default;filter:none}' +
    '.pty .btn.sm{min-height:36px;padding:6px 12px;font-size:14px}' +
    '.pty-or{font-family:var(--mono);font-size:12px;color:var(--ink-2);text-transform:uppercase;letter-spacing:.08em;align-self:center;padding:0 2px}' +
    '.pty-code{font-family:var(--mono);font-weight:600;font-size:15px;letter-spacing:.12em;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:4px 10px}' +
    '.pty-count{font-family:var(--mono);font-size:13px;color:var(--ink-2)}' +
    '.pty-acts{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}' +
    '.pty-mem{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}' +
    '.pty-mem.pty-lead{grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr))}' +
    '.pty-mem li{display:flex;align-items:center;gap:10px;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:8px 10px;min-width:0}' +
    '.pty-av{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:14px;color:#fff;flex:none}' +
    '.pty-who{display:grid;min-width:0;line-height:1.25;gap:2px}' +
    '.pty-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}' +
    '.pty-tag{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pty-tl{display:flex;min-width:0;line-height:1}' +
    '.pty-tag b{color:var(--accent);font-weight:600}' +
    '.pty-kick{margin-left:auto;flex:none;width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:none;color:var(--ink-2);font:inherit;font-size:16px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0}' +
    '.pty-kick:hover{color:var(--down);border-color:var(--down)}' +
    '.pty-h{font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);margin:0 0 8px}' +
    '.pty-games{display:flex;flex-wrap:wrap;gap:8px}' +
    '.pty-games button{font:inherit;font-size:14px;font-weight:600;color:var(--ink);background:var(--panel-2);border:1px solid var(--line);border-radius:999px;padding:7px 14px;cursor:pointer;min-height:36px}' +
    '.pty-games button:hover{border-color:var(--ink-2)}' +
    '.pty-games button[aria-pressed="true"]{border-color:var(--accent);background:var(--accent);color:var(--accent-ink)}' +
    '.pty-games button[disabled]{opacity:.45;cursor:default;border-color:var(--line)}' +
    '.pty-games small{font-weight:400;opacity:.8}' +
    '.pty-go{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}' +
    '.pty-pick[data-mode="member"] .pty-go{margin-top:8px}' +
    '.pty-wait{margin:0;color:var(--ink-2);font-size:15px}' +
    '.pty-msg{margin:0;font-size:14px;color:var(--ink-2);overflow-wrap:anywhere}' +
    '.pty-msg:empty{display:none}' +
    '.pty-msg.err{color:var(--down)}' +
    '@media (max-width:600px){.pty{padding:16px 14px 14px}.pty-or{display:none}.pty label{max-width:none}.pty-acts{margin-left:0;width:100%}.pty-acts .btn{flex:1;justify-content:center}.pty-row > .btn{flex:1 1 auto;justify-content:center}.pty-mem{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}' +
    '@media (max-width:360px){.pty-mem{grid-template-columns:minmax(0,1fr)}}';
  document.head.appendChild(css);

  // ---------------- Panel ----------------
  var sec = document.createElement('section');
  sec.id = 'party'; sec.setAttribute('aria-label', 'Party');
  sec.innerHTML = '<div class="pty"><div class="pty-top"><h2>Party</h2><p class="pty-sub"></p></div><div class="pty-main"></div><p class="pty-msg" role="status" aria-live="polite"></p></div>';
  var head = document.querySelector('header');
  if (head && head.parentNode) head.parentNode.insertBefore(sec, head.nextSibling); else document.body.appendChild(sec);
  var $sub = sec.querySelector('.pty-sub'), $main = sec.querySelector('.pty-main'), $msg = sec.querySelector('.pty-msg');

  function say(t, err) { $msg.textContent = t || ''; $msg.classList.toggle('err', !!err); }

  // ---------------- State ----------------
  var app = null, auth = null, db = null, uid = null, offset = 0, booting = null;
  var code = '', refs = null, myJ = 0, members = [], picked = '', goId = 0, beat = 0, busy = false;
  var handled = {}, wasConnected = false, connRef = null, lastLeader = '', kicked = [];
  function now() { return Date.now() + offset; }

  function load(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = function () { rej(new Error('Could not reach the game server. Check your connection.')); };
      document.head.appendChild(s);
    });
  }
  // Same project as the games. If account.js already started Firebase (and maybe a Google sign-in), reuse it.
  function boot() {
    if (booting) return booting;
    booting = (async function () {
      if (window.SiteAccount && SiteAccount.boot) { try { await timeout(SiteAccount.boot(), 12000, NET); } catch (e) {} }
      if (!window.firebase || !firebase.auth) { await load(SDK + 'firebase-app-compat.js'); await load(SDK + 'firebase-auth-compat.js'); }
      if (!firebase.database) await load(SDK + 'firebase-database-compat.js');
      app = firebase.apps.filter(function (a) { return a.options.apiKey === CFG.apiKey; })[0] ||
        firebase.initializeApp(CFG, firebase.apps.length ? 'party' : undefined);
      auth = app.auth();
      // Signing in can take 10-20 s on a slow phone on school Wi-Fi: give it 25 s, like the games.
      await timeout(new Promise(function (r) { var s = auth.onAuthStateChanged(function () { s(); r(); }); }), 25000, NET);
      if (!auth.currentUser) {
        try { await timeout(auth.signInAnonymously(), 25000, NET); }
        catch (err) { if (err.message === NET) throw err; throw new Error('Sign-in failed: ' + (err.message || err.code)); }
      }
      uid = auth.currentUser.uid;
      db = app.database(CFG.databaseURL);
      await new Promise(function (res) { setTimeout(res, 3000); db.ref('.info/serverTimeOffset').once('value', function (s) { offset = s.val() || 0; res(); }); });
      db.ref('.info/serverTimeOffset').on('value', function (s) { offset = s.val() || 0; });
      // Signing in with Google in the middle of a party changes who we are: rejoin as the new account.
      auth.onAuthStateChanged(function (u) {
        if (!u || u.uid === uid) return;
        var c = code; uid = u.uid;
        if (c) { teardown(false); join(c, true); }
      });
    })();
    booting.catch(function () { booting = null; });
    return booting;
  }

  function live(val) {
    var out = [], t = now();
    Object.keys(val || {}).forEach(function (k) {
      var v = val[k];
      if (!v || typeof v !== 'object' || t - (+v.ts || 0) > STALE) return;
      out.push({ uid: k, n: cleanName(v.n) || 'Player', c: /^#[0-9a-f]{6}$/i.test(v.c) ? v.c : '#4A5751', j: +v.j || +v.ts || 0, pk: typeof v.pk === 'string' ? v.pk : '', go: v.go && typeof v.go === 'object' ? v.go : null, kick: kickList(v.kick, t) });
    });
    out.sort(function (a, b) { return a.j - b.j || (a.uid < b.uid ? -1 : 1); });
    return out;
  }
  // Someone else's kick list: at most MAX entries of { u: uid, t: time } from the last KICK_TTL; anything else is dropped.
  function kickList(v, t) {
    var a = Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.keys(v).map(function (k) { return v[k]; }) : []), out = [];
    for (var i = 0; i < a.length && i < 16 && out.length < MAX; i++) {
      var e = a[i]; if (!e || typeof e !== 'object' || typeof e.u !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(e.u)) continue;
      var kt = +e.t || 0; if (kt > t - KICK_TTL && kt < t + 30000) out.push({ u: e.u, t: kt });
    }
    return out;
  }
  // When the leader L removed u, or 0. Only the current leader's list counts.
  function kickedBy(L, u) {
    if (!L || L.uid === u || !L.kick) return 0;
    for (var i = 0; i < L.kick.length; i++) if (L.kick[i].u === u) return L.kick[i].t;
    return 0;
  }
  function kickMsg(L, kt) { return 'You were removed from the party by ' + L.n + '. You can join it again in ' + Math.max(1, Math.ceil((kt + KICK_TTL - now()) / 60000)) + ' min.'; }
  function myState() {
    var s = { n: myName(), c: colorOf(uid), x: 0, z: 0, h: 0, ts: Math.round(now()), j: myJ };
    if (picked) s.pk = picked;
    if (goId && lastGo) s.go = lastGo;
    if (kicked.length) s.kick = kicked;
    return s;
  }
  var lastGo = null;
  function typedName() { return cleanName(store('ol:name')) || guessName(); }
  function myName() { return typedName() || 'Player'; }
  // Our name changed somewhere else (the Online panel, another tab): put it in our node and the name box now.
  function nameChanged() {
    var n = myName();
    if (refs && code) {
      members.forEach(function (m) { if (m.uid === uid) m.n = n; });
      refs.me.update({ n: n, ts: Math.round(now()) }).catch(function () {});
      drawParty();
    } else {
      var box = $main.querySelector('#ptyName');
      if (box && document.activeElement !== box) box.value = typedName();
    }
  }
  // Typed in our own name box: save it as the one name and tell the Online panel.
  function setName(n) {
    store('party:name', n || null);
    if (n) store('ol:name', n);
    try { document.dispatchEvent(new CustomEvent('backroom:name', { detail: { uid: uid, n: myName(), mine: true, from: 'party' } })); } catch (e) {}
  }

  // ---------------- Join / leave ----------------
  async function join(c, rejoin) {
    if (busy) return; busy = true; drawIdle(); say(rejoin ? 'Rejoining party ' + c + '…' : 'Connecting…');
    try {
      await boot();
      c = cleanCode(c);
      if (!c) throw new Error('Type a party code first.');
      var players = db.ref('rooms/pt-' + c + '/players');
      var cur = live((await timeout(players.once('value'), 10000, NET)).val()).filter(function (m) { return m.uid !== uid; });
      if (!cur.length && !rejoin) throw new Error('No party is using the code ' + c + ' right now. Check the code, or create a party.');
      if (cur.length >= MAX) throw new Error('That party is full (' + MAX + ' of ' + MAX + '). Ask them to make room, or create your own party.');
      var kt = kickedBy(cur[0], uid); if (kt) throw new Error(kickMsg(cur[0], kt));
      await enter(c);
      say('');
    } catch (err) {
      teardown(false);
      say(err.message || String(err), true);
    } finally {
      busy = false; render();
      var box = !code && $main.querySelector('#ptyCode'); if (box && !box.value) box.value = cleanCode(c);
    }
  }
  async function create() {
    if (busy) return; busy = true; drawIdle(); say('Creating a party…');
    try {
      await boot();
      var c = '';
      for (var i = 0; i < 5 && !c; i++) {
        var t = rand(5);
        var s = await timeout(db.ref('rooms/pt-' + t + '/players').once('value'), 10000, NET);
        if (!live(s.val()).length) c = t;
      }
      if (!c) throw new Error('Couldn’t find a free party code. Try again.');
      await enter(c);
      say('Party created. Send your friends the invite link or the code ' + c + '.');
    } catch (err) {
      teardown(false);
      say(err.message || String(err), true);
    } finally { busy = false; render(); }
  }
  async function enter(c) {
    code = c; myJ = Math.round(now()); picked = ''; goId = 0; lastGo = null; handled = {};
    var room = db.ref('rooms/pt-' + c);
    refs = { players: room.child('players'), me: room.child('players/' + uid) };
    try { await timeout(refs.me.set(myState()), 10000, NET); }
    catch (e) { refs = null; code = ''; throw new Error(e.message === NET ? NET : 'The database rules blocked the party (' + (e.code || e.message || 'denied') + ').'); }
    refs.me.onDisconnect().remove();
    // Two people can squeeze in at once; whoever arrived ninth steps back out.
    var all = live((await timeout(refs.players.once('value'), 10000, NET)).val());
    var idx = all.map(function (m) { return m.uid; }).indexOf(uid);
    if (idx >= MAX) { var r = refs; refs = null; code = ''; try { r.me.onDisconnect().cancel(); await r.me.remove(); } catch (e) {} throw new Error('That party is full (' + MAX + ' of ' + MAX + '). Ask them to make room, or create your own party.'); }
    sess('party:code', c);
    members = all;
    refs.players.on('value', onPlayers);
    connRef = db.ref('.info/connected'); wasConnected = true;
    connRef.on('value', onConnected);
    clearInterval(beat);
    beat = setInterval(function () {
      if (!refs) return;
      var patch = { ts: Math.round(now()) }, fresh = kicked.filter(function (e) { return e.t > now() - KICK_TTL; });
      if (fresh.length !== kicked.length) { kicked = fresh; patch.kick = kicked.length ? kicked : null; }
      refs.me.update(patch).catch(function () {});
    }, BEAT);
    drawParty();
  }
  function onConnected(s) {
    if (!refs) return;
    if (s.val() === true && !wasConnected) { refs.me.onDisconnect().remove(); refs.me.set(myState()).catch(function () {}); }
    wasConnected = s.val() === true;
  }
  function teardown(clear) {
    clearInterval(beat);
    if (connRef) { connRef.off('value', onConnected); connRef = null; }
    if (refs) { var r = refs; try { r.players.off('value', onPlayers); r.me.onDisconnect().cancel(); r.me.remove().catch(function () {}); } catch (e) {} }
    refs = null; code = ''; members = []; picked = ''; lastGo = null; goId = 0; lastLeader = ''; kicked = [];
    if (clear) sess('party:code', null);
  }
  function leave() { teardown(true); say('You left the party.'); render(); }

  // ---------------- Live updates ----------------
  function leader() { return members[0] || null; }
  function onPlayers(s) {
    if (!refs) return;
    var all = live(s.val());
    var L0 = all[0], kt = L0 ? kickedBy(L0, uid) : 0;
    if (kt) { var msg = kickMsg(L0, kt); teardown(true); say(msg, true); render(); return; }
    if (!all.some(function (m) { return m.uid === uid; })) {
      // Our node went missing (a dropped connection removes it); put it back.
      refs.me.set(myState()).catch(function () {});
      all.push({ uid: uid, n: myName(), c: colorOf(uid), j: myJ, pk: picked, go: lastGo });
      all.sort(function (a, b) { return a.j - b.j || (a.uid < b.uid ? -1 : 1); });
    }
    members = all;
    var L = leader();
    if (L && lastLeader && L.uid !== lastLeader) say(L.uid === uid ? 'You’re the party leader now. Pick a game.' : L.n + ' is the party leader now.');
    lastLeader = L ? L.uid : '';
    // A new launch from the leader that happened while we were in the party: go there too.
    if (L && L.uid !== uid && L.go && okRoom(L.go.r)) {
      var key = L.uid + ':' + L.go.id + ':' + L.go.t;
      if (!handled[key] && (+L.go.t || 0) >= myJ - 2000 && now() - (+L.go.t || 0) < 120000) {
        handled[key] = 1;
        var g = byKey(L.go.g);
        if (g) { say(L.n + ' started ' + g.n + '. Joining room ' + L.go.r + '…'); launch(g, L.go.r); }
        else say(L.n + ' started a game this page doesn’t know yet. Reload to update.', true);
      }
    }
    drawParty();
  }

  // ---------------- Games ----------------
  function playTogether() {
    var L = leader(); if (!refs || !L || L.uid !== uid) return;
    var g = byKey(picked);
    if (!g) return say('Pick a game first.', true);
    if (members.length > g.max) return say(g.n + ' rooms hold ' + g.max + ' players, and the party has ' + members.length + '.', true);
    var r = 'p' + rand(6);
    goId += 1; lastGo = { id: goId, g: g.k, r: r, t: Math.round(now()) };
    handled[uid + ':' + goId + ':' + lastGo.t] = 1;
    refs.me.update({ go: lastGo, ts: Math.round(now()) }).catch(function (e) { say('Couldn’t tell the party (' + (e.code || e.message) + ').', true); });
    say('Starting ' + g.n + ' in room ' + r + '…');
    launch(g, r);
  }
  // The leader removes a member: list them in our own node (we can't delete theirs); their browser leaves when it sees it.
  function kick(u) {
    var L = leader(); if (!refs || !L || L.uid !== uid || u === uid) return;
    var m = members.filter(function (x) { return x.uid === u; })[0]; if (!m) return;
    if (!confirm('Remove ' + m.n + ' from the party? They can\u2019t join it again for 10 minutes.')) return;
    var t = Math.round(now());
    kicked = kicked.filter(function (e) { return e.u !== u && e.t > t - KICK_TTL; }).concat({ u: u, t: t }).slice(-MAX);
    refs.me.update({ kick: kicked, ts: t }).then(function () { say('Removed ' + m.n + ' from the party.'); }, function (e) { say('Couldn\u2019t remove them (' + (e.code || e.message) + ').', true); });
    drawParty();
  }
  // Room codes come from another member's node, so only accept the characters the games' invite links allow.
  function okRoom(r) { return typeof r === 'string' && /^[a-z0-9]{1,17}$/.test(r); }
  function hashFor(g, r) { return '#' + (g.pre != null ? g.pre : g.k + '-') + r; }
  var lastRoom = null;
  function launch(g, r) {
    var path = BASE + g.d + '/' + hashFor(g, r);
    lastRoom = { k: g.k, r: r };
    var go = function () {
      var fr = BR ? BR.openGame(path, g.n) : ownOverlay(path, g.n);
      if (fr) autoJoin(fr, g, r);
    };
    if (isOpen()) {
      // Already in a game: close it the usual way (Back), then open the new one.
      var once = function () { removeEventListener('popstate', once); setTimeout(go, 60); };
      addEventListener('popstate', once);
      history.back();
    } else go();
  }
  function isOpen() { return BR ? BR.isOpen() : !!own; }

  // Fill in the game's room box and press its own join button, once its menu is ready.
  function autoJoin(fr, g, r) {
    var ids = g.ids || { name: 'name', room: 'room', join: 'joinRoom' };
    var tries = 0, n = members.length;
    function fire(el, t) { el.dispatchEvent(new Event(t, { bubbles: true })); }
    function tick() {
      if (!fr.isConnected) return;
      var d; try { d = fr.contentDocument; } catch (e) { return; }
      var btn = d && d.getElementById(ids.join), room = d && d.getElementById(ids.room);
      if (!btn || !room || btn.disabled) { if (++tries < 60) setTimeout(tick, 250); return; }
      // Party launches always play under the party name, even over a name the game saved or made up
      // (Egg123, Driver123, Wanderer123, a random Hail Mary team), so the party sees the names it knows.
      var nm = d.getElementById(ids.name), before = g.nk ? store(g.nk) : null, set = '';
      if (nm) { nm.value = set = myName().slice(0, nm.maxLength > 0 ? nm.maxLength : 14); fire(nm, 'input'); fire(nm, 'change'); }
      room.value = r; fire(room, 'input');
      if (g.prep) try { g.prep(d, n); } catch (e) {}
      btn.click();
      // The game saves whatever is in its name box, so give it back the name it had saved before (if it had one):
      // now, once its join has gone through, and when the game closes, unless the player has typed another since.
      if (set && before != null) {
        var put = function () {
          var cur = store(g.nk); if (cur == null || cur === before) return;
          try { if (cur.charAt(0) === '"') cur = JSON.parse(cur); } catch (e) {}
          if (cleanName(cur) === cleanName(set)) store(g.nk, before);
        };
        put(); setTimeout(put, 3000); setTimeout(put, 15000);
        try { fr.contentWindow.addEventListener('pagehide', put); } catch (e) {}
      }
    }
    fr.addEventListener('load', function () { setTimeout(tick, 200); }, { once: true });
  }

  // Direct visits to the Back Room page have no home-page layer, so games open in this one.
  var own = null;
  function ownOverlay(path, name) {
    if (own) return null;
    own = document.createElement('div');
    own.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;background:var(--ground)';
    var bar = document.createElement('div');
    bar.style.cssText = 'flex:0 0 40px;display:flex;align-items:center;gap:12px;padding:0 12px;border-bottom:1px solid var(--line);background:var(--panel);font-family:var(--mono);font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase';
    var back = document.createElement('button'); back.type = 'button'; back.textContent = '← Back';
    back.style.cssText = 'font:inherit;letter-spacing:inherit;text-transform:inherit;color:var(--accent);background:none;border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer';
    back.onclick = function () { history.back(); };
    var lbl = document.createElement('span'); lbl.textContent = name; lbl.style.color = 'var(--ink-2)';
    bar.append(back, lbl);
    var fr = document.createElement('iframe'); fr.src = path; fr.title = name;
    fr.setAttribute('allow', 'fullscreen; autoplay; gamepad; clipboard-write'); fr.setAttribute('allowfullscreen', '');
    fr.style.cssText = 'flex:1;width:100%;border:0;display:block;background:#000';
    fr.addEventListener('load', function () { try { fr.contentWindow.focus(); } catch (e) {} });
    own.append(bar, fr); document.body.appendChild(own); document.body.style.overflow = 'hidden';
    history.pushState({ pty: 1 }, '', location.href);
    return fr;
  }
  if (!BR) addEventListener('popstate', function () { if (own) { own.remove(); own = null; document.body.style.overflow = ''; } });

  // ---------------- Drawing ----------------
  var drawn = '';
  function render() { if (code && refs) drawParty(); else drawIdle(); }

  function drawIdle() {
    $sub.textContent = 'Group up with up to ' + MAX + ' friends, then the leader picks a game and everyone lands in the same room.';
    if (drawn !== 'idle') {
      drawn = 'idle';
      $main.innerHTML =
        '<div class="pty-row">' +
          '<label>Your name<input id="ptyName" maxlength="14" autocomplete="nickname" spellcheck="false" placeholder="Name"></label>' +
          '<button type="button" class="btn primary" data-a="create">Create party</button>' +
          '<span class="pty-or">or</span>' +
          '<label>Party code<input id="ptyCode" maxlength="20" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="e.g. k7m2q"></label>' +
          '<button type="button" class="btn" data-a="join">Join party</button>' +
        '</div>';
      $main.querySelector('#ptyName').value = typedName();
    }
    $main.querySelectorAll('button').forEach(function (b) { b.disabled = busy; });
  }

  function drawParty() {
    if (!refs) return drawIdle();
    var L = leader(), lead = L && L.uid === uid, n = members.length;
    $sub.textContent = lead ? 'You’re the leader: pick a game and press Play together to bring everyone in.' : 'Waiting for the leader to pick a game. When they start, you’ll join them automatically.';
    if (drawn !== 'party:' + code) {
      drawn = 'party:' + code;
      $main.innerHTML =
        '<div class="pty-row split" style="align-items:center">' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="pty-h" style="margin:0">Code</span><span class="pty-code"></span><span class="pty-count"></span></div>' +
          '<div class="pty-acts"><button type="button" class="btn sm" data-a="chat" style="display:none">Party chat<span class="onl-n"></span></button><button type="button" class="btn sm" data-a="copy">Copy invite link</button><button type="button" class="btn sm" data-a="leave">Leave party</button></div>' +
        '</div>' +
        '<ul class="pty-mem" aria-label="Party members"></ul>' +
        '<div class="pty-pick"></div>';
      $main.querySelector('.pty-code').textContent = code;
    }
    $main.querySelector('.pty-count').textContent = n + ' of ' + MAX;
    // Party chat lives in the Online panel (social.js); this button opens it once there's someone to talk to.
    var chatB = $main.querySelector('[data-a="chat"]'); if (chatB) chatB.style.display = n > 1 && window.BackRoomChat ? '' : 'none';
    var t0 = now(); kicked = kicked.filter(function (e) { return e.t > t0 - KICK_TTL; });
    var mem = $main.querySelector('.pty-mem');
    mem.classList.toggle('pty-lead', !!lead);   // wider cards for the leader: the kick button and the tier badge both need room
    mem.innerHTML = members.map(function (m, i) {
      var going = lead && kicked.some(function (e) { return e.u === m.uid; });
      return '<li><span class="pty-av" style="background:' + esc(m.c) + '" aria-hidden="true">' + esc(m.n.charAt(0).toUpperCase()) + '</span>' +
        '<span class="pty-who"><span class="pty-nm">' + esc(m.n) + '</span><span class="pty-tag">' +
        [i === 0 ? '<b>Leader</b>' : 'Member', m.uid === uid ? 'You' : '', going ? 'Removing…' : ''].filter(Boolean).join(' · ') + '</span></span>' +
        (lead && m.uid !== uid && !going ? '<button type="button" class="pty-kick" data-k="' + esc(m.uid) + '" title="Remove from the party" aria-label="Remove ' + esc(m.n) + ' from the party">✕</button>' : '') + '</li>';
    }).join('');
    // The avatar (avatar.js) in place of the initial, and the status tier badge (miles.js) on its own line above Leader / Member.
    Array.prototype.forEach.call(mem.children, function (li, i) {
      var m = members[i]; if (!m) return;
      if (window.BackRoomAvatar) { try { li.replaceChild(BackRoomAvatar.el(m.uid, 32), li.firstChild); } catch (e) {} }
      if (window.BackRoomMiles) { try { var t = BackRoomMiles.peek(m.uid), tag = li.querySelector('.pty-tag'); if (t) { var tl = document.createElement('span'); tl.className = 'pty-tl'; tl.appendChild(BackRoomMiles.badge(t)); tag.parentNode.insertBefore(tl, tag); } } catch (e) {} }
    });

    var box = $main.querySelector('.pty-pick');
    if (lead) {
      if (box.getAttribute('data-mode') !== 'lead') {
        box.setAttribute('data-mode', 'lead');
        box.innerHTML = '<p class="pty-h">Pick a game</p><div class="pty-games" role="group" aria-label="Game">' +
          GAMES.map(function (g) { return '<button type="button" data-g="' + g.k + '" aria-pressed="false">' + esc(g.n) + (g.max < MAX ? ' <small>· up to ' + g.max + '</small>' : '') + '</button>'; }).join('') +
          '</div><div class="pty-go"><button type="button" class="btn primary" data-a="play">▶ Play together</button><span class="pty-wait"></span></div>';
      }
      if (picked && byKey(picked) && byKey(picked).max < n) picked = '';
      box.querySelectorAll('[data-g]').forEach(function (b) {
        var g = byKey(b.getAttribute('data-g'));
        b.disabled = g.max < n; b.title = g.max < n ? g.n + ' rooms hold ' + g.max + ' players' : '';
        b.setAttribute('aria-pressed', String(b.getAttribute('data-g') === picked));
      });
      box.querySelector('[data-a="play"]').disabled = !picked;
      box.querySelector('.pty-wait').textContent = picked ? 'Everyone joins ' + byKey(picked).n + ' in a new room.' : 'Choose one of the games above.';
    } else {
      box.setAttribute('data-mode', 'member');
      var g = L && byKey(L.pk), go = L && L.go, gg = go && byKey(go.g);
      var html = '<p class="pty-wait">' + (L ? esc(L.n) + (g ? ' has picked <b>' + esc(g.n) + '</b>.' : ' hasn’t picked a game yet.') : '') + '</p>';
      if (gg && okRoom(go.r) && now() - (+go.t || 0) < 3 * 3600000)
        html += '<div class="pty-go"><button type="button" class="btn" data-a="rejoin">Join them in ' + esc(gg.n) + '</button><span class="pty-wait">Room ' + esc(go.r) + '</span></div>';
      box.innerHTML = html;
    }
  }

  // ---------------- Events ----------------
  sec.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t || t.disabled) return;
    var a = t.getAttribute('data-a'), gk = t.getAttribute('data-g'), ku = t.getAttribute('data-k');
    if (ku) kick(ku);
    else if (a === 'create' || a === 'join') {
      var nm = cleanName($main.querySelector('#ptyName').value);
      if (!nm) { say('Type your name first, so your party knows who you are.', true); $main.querySelector('#ptyName').focus(); return; }
      if (nm !== typedName()) setName(nm); else store('party:name', nm);
      if (a === 'create') create();
      else {
        var c = cleanCode($main.querySelector('#ptyCode').value);
        if (!c) { say('Type the party code your friend sent you.', true); $main.querySelector('#ptyCode').focus(); return; }
        join(c, false);
      }
    } else if (a === 'leave') leave();
    else if (a === 'chat') { if (window.BackRoomChat) window.BackRoomChat.open(); }
    else if (a === 'copy') {
      var url = location.origin + '/#pt-' + code;
      var done = function (ok) { say(ok ? 'Invite link copied. Friends open it, enter the Back Room code, and join the party.' : 'Invite link: ' + url); };
      try { navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); }); } catch (err) { done(false); }
    } else if (a === 'play') playTogether();
    else if (a === 'rejoin') {
      var L = leader(), g = L && L.go && byKey(L.go.g);
      if (g && okRoom(L.go.r)) launch(g, L.go.r);
    } else if (gk) {
      picked = gk;
      if (refs) refs.me.update({ pk: picked, ts: Math.round(now()) }).catch(function () {});
      drawParty();
    }
  });
  sec.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.matches('input')) return;
    var b = $main.querySelector(e.target.id === 'ptyCode' ? '[data-a="join"]' : '[data-a="create"]');
    if (b) b.click();
  });
  var nameT = 0;
  sec.addEventListener('input', function (e) {
    if (e.target.id !== 'ptyName') return;
    clearTimeout(nameT); var v = cleanName(e.target.value);
    nameT = setTimeout(function () { setName(v); }, 400);
  });
  document.addEventListener('backroom:name', function (e) { if (e.detail && e.detail.mine && e.detail.from !== 'party') nameChanged(); });
  addEventListener('storage', function (e) { if (e.key === 'ol:name' || e.key === 'party:name') nameChanged(); });
  // avatar.js and miles.js may load after the list was drawn, and every finished tier read is a redraw.
  document.addEventListener('backroom:avatar', function () { if (refs) drawParty(); });
  document.addEventListener('backroom:miles', function () { if (refs) drawParty(); });
  if (window.SiteAccount && SiteAccount.onChange) SiteAccount.onChange(function () { if (!code && !store('party:name') && !store('ol:name')) { drawn = ''; drawIdle(); } });

  // ---------------- Start ----------------
  drawIdle();
  // An invite link (#pt-<code>), or a party this tab was in before the page reloaded.
  var inv = BR && BR.invite ? BR.invite : '';
  if (!BR) { var m = /^#pt-([a-z0-9]{1,8})$/.exec(location.hash); if (m) { inv = m[1]; try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} } }
  inv = cleanCode(inv);
  var again = cleanCode(sess('party:code'));
  if (inv) {
    if (!typedName()) {
      $main.querySelector('#ptyCode').value = inv;
      say('You were invited to party ' + inv + '. Type your name and press Join party.');
      $main.querySelector('#ptyName').focus();
    } else join(inv, inv === again);
  } else if (again) join(again, true);

  // For social.js (the Online panel under this one): it signs in through boot(), shows whether you're in a party,
  // and creates, joins or opens games through these, so both panels share one sign-in and one party.
  function openPath(path, name) {
    var go = function () { if (BR) BR.openGame(path, name); else ownOverlay(path, name); };
    if (isOpen()) { var once = function () { removeEventListener('popstate', once); setTimeout(go, 60); }; addEventListener('popstate', once); history.back(); }
    else go();
  }
  window.Party = {
    boot: function () { return boot().then(function () { return { app: app, db: db, uid: uid }; }); },
    now: now,
    get code() { return refs ? code : ''; },
    get size() { return refs ? members.length : 0; },
    get leader() { var L = refs && leader(); return L ? { uid: L.uid, n: L.n } : null; },
    get members() { return refs ? members.map(function (m) { return m.uid; }) : []; },
    // Members with their party names, and the people the current leader has removed (still listed until they go).
    get roster() { return refs ? members.map(function (m) { return { uid: m.uid, n: m.n }; }) : []; },
    get out() {
      var L = refs && leader(); if (!L) return [];
      var t = now(), list = L.uid === uid ? kicked : (L.kick || []);
      return list.filter(function (e) { return e.t > t - KICK_TTL; }).map(function (e) { return e.u; });
    },
    max: MAX,
    get room() { return lastRoom; },
    games: GAMES.map(function (g) { return { k: g.k, n: g.n, d: g.d, pre: g.pre != null ? g.pre : g.k + '-' }; }),
    create: function () { return (refs || busy ? Promise.resolve() : create()).then(function () { return refs ? code : ''; }); },
    join: function (c) {
      c = cleanCode(c);
      if (!c || busy || (refs && c === code)) return Promise.resolve(refs ? code : '');
      if (refs) teardown(true);
      return join(c, false).then(function () { return refs ? code : ''; });
    },
    // Open a party game in room r and press its Play in room button, as a party launch does.
    launch: function (k, r) {
      var g = byKey(k);
      if (!g || !(g.pre === '' ? okRoom(r) : /^[a-z0-9][a-z0-9-]{0,16}$/.test(r))) return false;
      launch(g, r); return true;
    },
    open: function (path, name) { if (typeof path === 'string' && path.indexOf(BASE) === 0) openPath(path, name || ''); }
  };

  // Test hook for the automated checks; harmless in normal play.
  if (navigator.webdriver) window.__party = { get code() { return code; }, get uid() { return uid; }, get members() { return members; }, get kicked() { return kicked; }, leader: leader, GAMES: GAMES, MAX: MAX, db: function () { return db; } };
})();
