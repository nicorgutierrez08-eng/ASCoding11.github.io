/*
 * Back Room "Online": see who else has the Back Room open, send them private messages, invite them to your
 * party or to a game room, and talk to everyone in the cabin chat (the lounge).
 *
 * Loaded after party.js in the same three places (the home page's reveal(), a <script> tag on the Back Room page,
 * and the phone page), and signs in through party.js (window.Party.boot), so both panels are the same person.
 *
 * Storage: Firebase Realtime Database, same project and rules as the games, one shared room: rooms/ol-lobby.
 * The shared rules only let a browser write its own node, rooms/ol-lobby/players/<uid>, and require the
 * fields every game writes (n, c, x, z, h, ts), so everything lives in that node:
 *   n  name (14 chars)   c  colour (#rrggbb)   x, z, h  always 0   ts  last heartbeat (server time)
 *   v  format (1)        pk this browser's ECDH P-256 public key (raw, base64)
 *   p  party size (0 = not in a party)        g  game being played (a key from GAMES below), or absent
 *   pl the party leader's uid while in a party (so a join request can go to the leader), or absent
 *   l  lounge: [{ i, t, x }], the last 20 messages, 200 characters each, dropped after 30 minutes
 *   d  { <recipient uid>: [{ i, t, b }] }  private messages, the last 6 to each of the last 6 people
 *   i  { <recipient uid>: { i, t, b } }    the latest party or room invite to each of the last 6 people
 * b is sealed to the recipient like Showdown's hole cards: AES-GCM with a key from ECDH between the sender's
 * private key and the recipient's pk, so only those two browsers can open it. Inside is JSON:
 *   { f: sender uid, to: recipient uid, k: 'm', x: text } | { ..., k: 'p', c: party code } | { ..., k: 'r', g, r }
 *   and, also in d, the chat-request handshake: k: 'q' (please chat with me), 'a' (yes), 'n' (no), 'e' (I ended our chat),
 *   and the join-request handshake: k: 'j' (please let me into your party), 'y' (yes, with the party code c) and
 *   'x' (no, with why in w: 'no', 'full', 'lead' (only the leader can accept; l and ln are the leader's uid and name) or 'gone').
 * Everyone can see that a message or invite exists, who it's to and when; nobody else can read it.
 * Private messages need a chat request first: you ask (q), they accept (a), and only then does either side show the
 * other's messages (k 'm'); an 'm' from someone who hasn't been accepted is dropped. A request runs out after REQ_TTL
 * if nobody answers. Accepted pairs are remembered in this browser (localStorage ol:chats, uid -> time) so you don't
 * ask again every visit; End chat forgets the pair here and sends 'e' so the other side forgets it too. Party and room
 * invites aren't chat, so they don't need a request. The cabin chat is unchanged.
 * Join requests work the same way: Request to join on the card of someone in a party sends 'j' to that party's leader (or
 * to them, if their leader isn't online); the leader's browser answers 'y' with the code (Let them in), 'x' (Decline), or
 * straight away with 'x' when the party is full, it isn't the leader, or it isn't in a party; a 'y' shows a Join button,
 * and joining goes through party.js. One open request per party, 10 minutes, same rate limit as chat requests.
 * Block (localStorage ol:block) hides someone for good; Block for this session (sessionStorage ol:sblock) does the same
 * until the tab closes.
 * Parties: people in the same party (party.js's member list, minus anyone on the leader's kick list) can send each other
 * private messages without the chat request; outside a party the request is still needed. The party also has its own
 * Party chat, kept in our node as
 *   pc { <member uid>: [{ i, t, b }] }   the last PC_KEEP party-chat messages, sealed separately to each member
 * with b = { f, to, k: 'g', c: party code, x: text }. A copy goes only to the members in the party when it's sent (not to
 * anyone we blocked), and a browser only shows one that names its current party and comes from a current member, so
 * only the party can read it; like a private message, everyone can see that something was sent to whom. Muted and
 * blocked people's party messages are hidden, the same rate limit applies, and they aren't logged; Report in someone's
 * conversation also includes the recent party chat when they wrote in it. The party chat is kept for the tab in
 * sessionStorage ol:pchat ({ c: code, m: [...] }). window.BackRoomChat lets the games' in-game chat (gamechat.js, inside
 * the game's iframe) read and send party chat through this page.
 * The key pair is kept in this browser's IndexedDB so the same identity survives reloads.
 * Closing the tab removes the node (onDisconnect), and nodes without a heartbeat for STALE are ignored.
 * Every browser downloads every node, so this suits tens of people, not thousands.
 *
 * Safety log, for the Back Room admin page: each cabin-chat message is also saved to Firestore `chatlog` as
 * { kind: 'cabin', uid, ts (server time), box }, where box is { name, seat, text, t } sealed to the admin public key
 * (adminkey.js: an ephemeral ECDH key + AES-GCM), so only someone with both admin codes can read it. Private messages
 * are never logged. The Report button in a conversation saves that conversation as the reporter's browser shows it,
 * after asking: { kind: 'report', uid, ts, box: { name, seat, about, aboutName, aboutSeat, text } }.
 * Each browser also keeps one plain `who/<uid>` document { uid, vid, name, seat, ts } (vid is the analytics visitor ID
 * from localStorage an_vid, if any), so the admin page's stats can put a name to a visitor. Not while hidden.
 * Writes go through the Firestore REST API with the signed-in account's ID token, like feedback.js; a failed write
 * (rules not added yet, offline) is silent and never holds up the chat. Rules: see README.md.
 *
 * One name everywhere: the Online name (localStorage ol:name) is the player's name. Typing it here also saves it as the
 * party name (party:name), puts it in the Party node straight away (party.js listens), and fixes the name on the player's
 * leaderboard entry (rooms/lb-all/players/<uid>/n, only that field, only if the entry exists; checked again once after
 * each page load, so an entry left with an old name catches up). Each change fires `backroom:name` on document
 * ({ uid, n, mine }), as does someone else's Online node changing name, so the Leaderboards can rename a row live.
 *
 * Names come with an avatar (avatar.js, drawn from the uid) and a status tier badge (miles.js, from the person's
 * leaderboard node, one read per uid, kept 10 minutes). Both are optional: without them a coloured initial and no badge.
 */
(function () {
  'use strict';
  if (document.getElementById('online')) return;

  var PATH = 'rooms/ol-lobby/players';
  var STALE = 75000, BEAT = 15000, POLL = 2000;
  var NAME_MAX = 14, TEXT_MAX = 200;
  var LOUNGE_KEEP = 20, LOUNGE_TTL = 30 * 60000;
  var DM_KEEP = 6, DM_PEERS = 6, INV_PEERS = 6, INV_TTL = 10 * 60000;
  var NODE_MAX = 60000, THREAD_KEEP = 80;
  var GAP = 1500, BURST = 5, BURST_MS = 10000;
  var REPORT_MSGS = 20, REPORT_MAX = 4000, REPORT_BYTES = 8000, REPORT_GAP = 60000;
  var REQ_TTL = 10 * 60000, REQ_BURST = 10, REQ_BURST_MS = 10 * 60000, CHATS_MAX = 60;
  var PC_KEEP = 6, NODE_SOFT = 50000;
  var COLORS = ['#1D6A4B', '#C0562F', '#3E5BA9', '#9A3F8F', '#B07A12', '#2A8A8A', '#B42318', '#5B6B2E'];

  var me0 = document.currentScript && document.currentScript.src;
  var BASE = (me0 ? new URL(me0, location.href).pathname : '/e63334287a3deaa3/social.js').replace(/[^/]*$/, '');

  // Games people can be in. k: the invite prefix (the address of a room is /#<k>-<room>, Rumble Karts' is /#<room>).
  // room: takes room codes in invites (and the pattern a code must match). abs: lives outside the Back Room folder.
  var ROOM = /^[a-z0-9][a-z0-9-]{0,16}$/;
  var GAMES = [
    { k: 'sc', n: 'Shell Crackers', d: 'shell-crackers', room: ROOM },
    { k: 'rk', n: 'Rumble Karts', d: 'rumble-karts', room: /^[a-z0-9]{1,17}$/, pre: '' },
    { k: 'ss', n: 'Slipstream', d: 'slipstream', room: ROOM },
    { k: 'bb', n: 'Boostball', d: 'boostball', room: ROOM },
    { k: 'cl', n: 'Coil', d: 'coil', room: ROOM },
    { k: 'sd', n: 'Showdown', d: 'showdown', room: ROOM },
    { k: 'br', n: 'Backrooms 1v1–4v4', d: 'backrooms-1v1', room: ROOM },
    { k: 'cf', n: 'Chromaflage', d: 'chromaflage', room: ROOM },
    { k: 'tw', n: 'Spire', d: 'spire', room: ROOM },
    { k: 'sr', n: 'Turbo Trail', d: 'turbo-trail', room: ROOM },
    { k: 'er', n: 'Escapade', d: 'escapade', room: ROOM },
    { k: 'up', n: 'Updraft', d: 'updraft', room: ROOM },
    { k: 'ph', n: 'Odd One Out', d: 'odd-one-out', room: ROOM },
    { k: 'ko', n: 'Tumble Trials', d: 'tumble-trials', room: ROOM },
    { k: 'dw', n: 'Deepword', d: 'deepword', room: ROOM },
    { k: 'pf', n: 'Puffer Party', d: 'puffer-party', room: ROOM },
    { k: 'tv', n: 'Trivium', d: 'trivium', room: /^[a-z]{5}$/ },
    { k: 'hm', n: 'Hail Mary', d: 'hail-mary' },
    { k: 'qy', n: 'Quarry', d: 'quarry' },
    { k: 'kw', n: 'Kartwheel', d: 'kartwheel' },
    { k: 'st', n: 'Starhop', d: 'starhop' },
    { k: 'ab', n: 'Abyssal', d: 'abyssal' },
    { k: 'bx', n: 'Boxed', abs: '/boxed/' },
    { k: 'hc', n: 'Hype Cycle Exchange', abs: '/hype-cycle-exchange/' }
  ];
  function gameOf(k) { for (var i = 0; i < GAMES.length; i++) if (GAMES[i].k === k) return GAMES[i]; return null; }
  function okRoom(g, r) { return !!(g && g.room && typeof r === 'string' && g.room.test(r)); }
  function inviteHref(g, r) { return '/#' + (g.pre != null ? g.pre : g.k + '-') + r; }

  // ---------------- Small helpers ----------------
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
  function json(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }
  // Rude words in names are masked by the shared name filter (/namefilter.js) when the page has loaded it.
  function byFilter(v) { return window.NameFilter ? window.NameFilter.clean(v) : v; }
  function cleanName(s) { return byFilter(String(s == null ? '' : s).replace(/[<>\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)); }
  function cleanText(s) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : NaN; }
  function rid() { var a = 'abcdefghijkmnpqrstuvwxyz23456789', s = ''; for (var i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function colorOf(uid) { var h = 0; for (var i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
  // A seat number on our little plane, 1A to 40F, the same for a person everywhere they show up.
  function seatOf(uid) { var h = hash('seat:' + uid); return (1 + h % 40) + 'ABCDEF'.charAt(Math.floor(h / 40) % 6); }
  // A message's time, or NaN if it isn't one or claims to be from more than half a minute ahead (clock drift is a few seconds).
  function when(v, t) { var n = num(v); return n > 0 && n < t + 30000 ? Math.min(n, t + 5000) : NaN; }
  function arr(v, max) {
    if (Array.isArray(v)) return v.slice(-max);
    if (!v || typeof v !== 'object') return [];
    var ks = Object.keys(v); if (ks.length > max * 4) return [];
    return ks.sort(function (a, b) { return (+a) - (+b); }).map(function (k) { return v[k]; }).slice(-max);
  }
  function clock(t) { try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
  function stamp(t) { try { return new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; } catch (e) { return ''; } }

  // A short list of words to blank out (written in ROT13 so the source doesn't spell them out). Matches the start of a word,
  // also when letters are swapped for look-alike digits or symbols, and keeps the first letter: "f***".
  var BAD = ['shpx', 'fuvg', 'ovgpu', 'phag', 'fyhg', 'juber', 'avtt', 'snttbg', 'ergneq', 'nffubyr', 'onfgneq', 'gjng', 'jnax'].map(function (w) {
    return w.replace(/[a-z]/g, function (c) { return String.fromCharCode((c.charCodeAt(0) - 84) % 26 + 97); });
  });
  var BAD_RE = new RegExp('(^|[^a-z])(' + BAD.join('|') + ')[a-z]*', 'g');
  var LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'l' };
  function mask(s) {
    s = String(s);
    var low = s.toLowerCase(), norm = '';
    for (var i = 0; i < low.length; i++) norm += low.charAt(i).length === s.charAt(i).length && LEET[low.charAt(i)] || low.charAt(i);
    if (norm.length !== s.length) return s;
    var out = s, m; BAD_RE.lastIndex = 0;
    while ((m = BAD_RE.exec(norm))) {
      var st = m.index + m[1].length, len = m[0].length - m[1].length;
      out = out.slice(0, st + 1) + new Array(len).join('*') + out.slice(st + len);
    }
    return out;
  }

  // Build elements without ever parsing other people's text as HTML.
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, cls, act) { var b = el('button', 'onl-b' + (cls ? ' ' + cls : ''), text); b.type = 'button'; if (act) b.setAttribute('data-act', act); return b; }
  // The person's avatar (avatar.js), or a coloured initial when that script isn't here.
  function avatarEl(u, name, color, size) {
    if (window.BackRoomAvatar && u) { try { return BackRoomAvatar.el(u, size); } catch (e) {} }
    var av = el('span', 'onl-av', mask(name || '?').charAt(0).toUpperCase() || '?');
    av.style.background = color || colorOf(u || ''); av.style.width = av.style.height = size + 'px'; av.setAttribute('aria-hidden', 'true');
    return av;
  }
  // The person's status tier (miles.js), from the cache; null while it's still being read or when the script isn't here.
  function tierOf(u) { if (!window.BackRoomMiles || !u) return null; try { return BackRoomMiles.peek(u); } catch (e) { return null; } }
  function tierBadge(u) { var t = tierOf(u); return t ? BackRoomMiles.badge(t) : null; }
  function milesLine(t) {
    if (!t) return '';
    if (BackRoomMiles.line) return BackRoomMiles.line(t);
    return t.ok ? BackRoomMiles.fmt(t.miles) + ' miles' + (t.next ? ' · ' + BackRoomMiles.fmt(t.next.miles) + ' to ' + t.next.tier.n : ' · the top tier') : '';
  }

  // ---------------- Styles ----------------
  var css = document.createElement('style');
  css.textContent =
    '#online{padding-top:14px}' +
    '.onl{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 20px;display:grid;gap:12px;min-width:0;color:var(--ink)}' +
    '.onl-top{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap}' +
    '.onl h2,.onl-dr h2{margin:0;font-family:var(--display,var(--f-d,sans-serif));font-weight:800;font-size:28px;line-height:1;letter-spacing:.02em;text-transform:uppercase;color:var(--ink)}' +
    '.onl h2 span{color:var(--ink-2);font-weight:700}' +
    '.onl-live{width:10px;height:10px;border-radius:50%;background:var(--up,#4CC98A);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--up,#4CC98A) 25%,transparent)}' +
    '.onl-sub{margin:0;color:var(--ink-2);font-size:15px;flex:1 1 220px;min-width:0}' +
    '.onl-b{font:inherit;font-family:var(--body,var(--f-b,sans-serif));font-size:14px;font-weight:600;color:var(--ink);background:var(--panel-2);border:1px solid var(--line);border-radius:8px;min-height:36px;padding:6px 12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;text-decoration:none}' +
    '.onl-b:hover{border-color:var(--ink-2)}' +
    '.onl-b.pri{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}' +
    '.onl-b.warn{color:var(--down)}' +
    '.onl-b[disabled]{opacity:.5;cursor:default}' +
    '.onl-n{min-width:20px;height:20px;border-radius:10px;padding:0 6px;background:var(--down,#B42318);color:#fff;font-family:var(--mono,monospace);font-size:12px;font-weight:600;line-height:20px;text-align:center;letter-spacing:0}' +
    '.onl-n:empty{display:none}' +
    '.onl-me{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font-size:14px;color:var(--ink-2)}' +
    '.onl-me label{display:flex;align-items:center;gap:8px;min-width:0}' +
    '.onl-me .onl-lbl{font-family:var(--mono,monospace);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}' +
    '.onl input[type=text],.onl-dr input[type=text],.onl-dr select{font:inherit;font-family:var(--body,var(--f-b,sans-serif));font-size:16px;color:var(--ink);background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:7px 10px;min-height:40px;min-width:0}' +
    '.onl input[type=text]:focus,.onl-dr input[type=text]:focus,.onl-dr select:focus{border-color:var(--accent);outline:none}' +
    '.onl-me input[type=text]{width:13ch}' +
    '.onl-me input[type=checkbox]{width:18px;height:18px;accent-color:var(--accent);margin:0}' +
    '.onl-seat{font-family:var(--mono,monospace);font-size:13px;font-weight:600;color:var(--accent)}' +
    '.onl-meav{display:inline-flex;flex:none;line-height:0}.onl-meav:empty{display:none}' +
    '.onl-tier{display:inline-flex;align-items:center;gap:6px;min-width:0;font-size:13px;color:var(--ink-2)}.onl-tier:empty{display:none}' +
    '.onl-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;max-height:252px;overflow:auto;overscroll-behavior:contain}' +
    '.onl-p{display:flex;align-items:center;gap:10px;width:100%;min-width:0;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font:inherit;color:inherit;text-align:left;cursor:pointer}' +
    '.onl-p:hover{border-color:var(--ink-2)}' +
    '.onl-p.me{cursor:default}.onl-p.me:hover{border-color:var(--line)}' +
    '.onl-av{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:14px;color:#fff;flex:none}' +
    '.onl-who{display:grid;min-width:0;line-height:1.25;flex:1;gap:2px}' +
    '.onl-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}' +
    '.onl-nm small{font-family:var(--mono,monospace);font-size:12px;color:var(--accent);font-weight:600}' +
    '.onl-st{font-family:var(--mono,monospace);font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.onl-tl{display:flex;min-width:0;line-height:1}' +
    '.onl-mi{font-size:12px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.onl-dh h2 .bra-av,.onl-row .onl-who .bra-av,.onl-m .who .bra-av,.onl-t .bra-av{margin-right:6px;vertical-align:-5px}' +
    '.onl-m .who .bra-av{vertical-align:-4px}' +
    '.onl-empty{margin:0;color:var(--ink-2);font-size:14px}' +
    '.onl-msg{margin:0;font-size:14px;color:var(--ink-2);overflow-wrap:anywhere}' +
    '.onl-msg:empty{display:none}.onl-msg.err{color:var(--down)}' +
    '.onl-fine{margin:0;font-size:12.5px;text-align:right}.onl-fine a{color:var(--ink-2)}' +
    // Slide-in drawer for the lounge, a conversation, or the list while a game is open.
    '.onl-dr{position:fixed;top:0;right:0;bottom:0;z-index:1002;width:min(400px,100%);display:flex;flex-direction:column;background:var(--panel);color:var(--ink);border-left:1px solid var(--line);box-shadow:-12px 0 32px rgba(0,0,0,.25);transform:translateX(105%);transition:transform .2s ease,visibility .2s;visibility:hidden;font-family:var(--body,var(--f-b,sans-serif));font-size:15px;line-height:1.45;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) 0}' +
    '.onl-dr.open{transform:none;visibility:visible}' +
    '@media (prefers-reduced-motion:reduce){.onl-dr{transition:none}}' +
    '.onl-dh{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);flex:none;min-width:0}' +
    '.onl-dh h2{font-size:24px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.onl-x{font:inherit;font-size:22px;line-height:1;color:var(--ink-2);background:none;border:1px solid var(--line);border-radius:8px;width:38px;height:38px;cursor:pointer;flex:none}' +
    '.onl-dsub{padding:8px 14px;border-bottom:1px solid var(--line);font-size:13px;color:var(--ink-2);flex:none;display:grid;gap:8px}' +
    '.onl-acts{display:flex;flex-wrap:wrap;gap:6px}' +
    '.onl-db{flex:1;overflow:auto;overscroll-behavior:contain;padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-height:0}' +
    '.onl-db .onl-list{max-height:none;grid-template-columns:minmax(0,1fr)}' +
    '.onl-m{max-width:85%;align-self:flex-start;background:var(--panel-2);border:1px solid var(--line);border-radius:12px;padding:6px 10px;overflow-wrap:anywhere}' +
    '.onl-m.mine{align-self:flex-end;background:color-mix(in srgb,var(--accent) 16%,var(--panel))}' +
    '.onl-m .who{display:block;font-family:var(--mono,monospace);font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--ink-2)}' +
    '.onl-m .who b{color:var(--ink)}' +
    '.onl-card{align-self:stretch;max-width:none;display:grid;gap:8px;border-style:dashed}' +
    '.onl-note{align-self:center;font-size:13px;color:var(--ink-2);text-align:center;margin:0}' +
    '.onl-df{flex:none;border-top:1px solid var(--line);padding:10px 14px;display:grid;gap:8px}' +
    '.onl-row{display:flex;gap:8px;align-items:center;min-width:0}' +
    '.onl-row input[type=text]{flex:1}' +
    '.onl-row select{flex:1 1 50%}' +
    '.onl-count{font-family:var(--mono,monospace);font-size:11px;color:var(--ink-2);text-align:right}' +
    '.onl-h{font-family:var(--mono,monospace);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);margin:6px 0 0}' +
    // Toasts, above any open game.
    '.onl-ts{position:fixed;top:calc(48px + env(safe-area-inset-top,0px));right:12px;z-index:1003;display:grid;gap:8px;width:min(340px,calc(100vw - 24px));pointer-events:none}' +
    '.onl-t{pointer-events:auto;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.25);display:grid;gap:8px;font-family:var(--body,var(--f-b,sans-serif));font-size:14px;line-height:1.4;overflow-wrap:anywhere}' +
    '.onl-t b{font-weight:600}' +
    // The button added to a game's top bar.
    '.onl-bar{font-family:var(--mono,var(--f-m,monospace));font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);background:none;border:1px solid var(--line);border-radius:6px;padding:3px 8px;cursor:pointer;margin-left:auto;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex:none}' +
    '.onl-bar + #turn{margin-left:8px}' +
    '.onl-bar[hidden]{display:none}.onl-pbar:not([hidden]) + .onl-bar{margin-left:0}' +
    '.onl-wn{font:inherit;font-weight:700;color:var(--ink);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px}' +
    '@media (max-width:600px){.onl{padding:14px}.onl-list{grid-template-columns:minmax(0,1fr) minmax(0,1fr);max-height:252px}.onl-sub{font-size:14px;order:3;flex-basis:100%}.onl-top > .onl-b{margin-left:auto}}' +
    '@media (max-width:420px){.onl-list{grid-template-columns:minmax(0,1fr)}.onl-me .onl-lbl{display:none}.onl-me input[type=text]{width:10ch}}' +
    '@media (max-height:500px){.onl-ts{top:calc(40px + env(safe-area-inset-top,0px))}.onl-dh{padding:8px 12px}.onl-db{padding:8px 12px}.onl-df{padding:8px 12px}}';
  document.head.appendChild(css);

  // ---------------- Panel ----------------
  var sec = document.createElement('section');
  sec.id = 'online'; sec.setAttribute('aria-label', 'Online');
  var box = el('div', 'onl');
  var top = el('div', 'onl-top');
  var live = el('span', 'onl-live'); live.setAttribute('aria-hidden', 'true');
  var $title = el('h2'); $title.append('Online ', el('span'));
  var $sub = el('p', 'onl-sub', 'Everyone in the Back Room right now. Tap someone to request a chat (people in your party can message you straight away), invite them to your party or send them a room code, or say hi to the whole cabin.');
  var $loungeBtn = btn('Cabin chat', '', 'lounge'); $loungeBtn.append(el('span', 'onl-n'));
  // Party chat: only while in a party.
  var $partyBtn = btn('Party chat', '', 'pchat'); $partyBtn.append(el('span', 'onl-n')); $partyBtn.style.display = 'none';
  top.append(live, $title, $sub, $partyBtn, $loungeBtn);
  var meRow = el('div', 'onl-me');
  var nameLbl = el('label'); nameLbl.append(el('span', 'onl-lbl', 'You'));
  var $name = el('input'); $name.type = 'text'; $name.maxLength = NAME_MAX; $name.autocomplete = 'nickname'; $name.spellcheck = false; $name.placeholder = 'Your name'; $name.setAttribute('aria-label', 'Your name in the Online list');
  $name.setAttribute('data-name-filter', ''); // /namefilter.js cleans this box too
  nameLbl.append($name);
  var $seat = el('span', 'onl-seat'); $seat.title = 'Your seat: a tag that tells people apart when names match';
  // Your avatar (filled in once we know who you are) and your status tier with your miles.
  var $meAv = el('span', 'onl-meav'), $tier = el('span', 'onl-tier');
  var hideLbl = el('label'); var $hide = el('input'); $hide.type = 'checkbox'; hideLbl.append($hide, 'Hide me');
  meRow.append($meAv, nameLbl, $seat, $tier, hideLbl);
  var $list = el('ul', 'onl-list'); $list.setAttribute('aria-label', 'People online');
  var $msg = el('p', 'onl-msg'); $msg.setAttribute('role', 'status'); $msg.setAttribute('aria-live', 'polite');
  var fine = el('p', 'onl-fine'), plink = el('a', '', 'Privacy'); plink.href = '/privacy.html'; plink.target = '_blank'; plink.rel = 'noopener';
  fine.append(plink);
  box.append(top, meRow, $list, $msg, fine);
  sec.append(box);
  function place() {
    var party = document.getElementById('party'), head = document.querySelector('header');
    var after = party || head;
    if (after && after.parentNode) after.parentNode.insertBefore(sec, after.nextSibling); else document.body.appendChild(sec);
    // The phone page spaces its panels with a bottom margin instead of section padding.
    if (party) { var mb = getComputedStyle(party).marginBottom; if (parseFloat(mb) > 0) { sec.style.paddingTop = '0'; sec.style.marginBottom = mb; } }
  }
  place();
  function say(t, err) { $msg.textContent = t || ''; $msg.classList.toggle('err', !!err); }

  var dr = el('div', 'onl-dr'); dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'false'); dr.setAttribute('aria-label', 'Online');
  var toasts = el('div', 'onl-ts'); toasts.setAttribute('aria-live', 'polite');
  document.body.append(dr, toasts);

  // ---------------- State ----------------
  var P = null, db = null, auth = null, project = 'rumblekarts', uid = '', meRef = null, listRef = null, connRef = null, wasConnected = false;
  var people = {};                         // uid -> parsed node of everyone else
  var mine = { l: [], d: {}, i: {}, pc: {} }; // what's in our own node besides the basics
  var published = false, beat = 0, status = { p: 0, g: '', pl: '' };
  var keys = { pair: null, pub: '', derived: {} };
  var threads = json(sess('ol:threads'), {}); if (!threads || typeof threads !== 'object') threads = {};
  var seen = json(store('ol:seen'), {}); if (!seen || typeof seen !== 'object') seen = {};
  var blocked = json(store('ol:block'), {}); if (!blocked || typeof blocked !== 'object') blocked = {};
  var muted = json(store('ol:mute'), {}); if (!muted || typeof muted !== 'object') muted = {};
  // Blocked for this tab only (sessionStorage): the same as Block, forgotten when the tab closes.
  var sblocked = json(sess('ol:sblock'), {}); if (!sblocked || typeof sblocked !== 'object') sblocked = {};
  function isBlocked(u) { return !!(blocked[u] || sblocked[u]); }
  // People who accepted a chat with us (or whose request we accepted): uid -> when. Only what this browser saw.
  var chats = loadChats();
  // The party chat this tab has seen, for one party code at a time: { c: code, m: [{ id, from, t, x, n, c }] }.
  var pchat = json(sess('ol:pchat'), null);
  if (!pchat || typeof pchat !== 'object' || typeof pchat.c !== 'string' || !Array.isArray(pchat.m)) pchat = { c: '', m: [] };
  var chains = {};                         // uid -> promise: their sealed items are opened in the order they were sent
  var reqSent = [];                        // when we sent chat requests, for the rate limit
  var opened = {};                         // sender:id -> 1 once decrypted (or failed)
  var sent = [];                           // our recent send times, for the rate limit
  var reported = {};                       // uid -> time we last reported them (one report a minute per person)
  var view = null;                         // what the drawer shows: { v: 'people' | 'lounge' | 'dm', u }
  var hidden = store('ol:hidden') === '1';
  var started = Date.now();
  function now() { return P && P.now ? P.now() : Date.now(); }

  function guessName() {
    var u = window.SiteAccount && SiteAccount.user && SiteAccount.user();
    if (u && (u.displayName || u.email)) return cleanName((u.displayName || u.email).split(/[\s@]/)[0]);
    var keysTried = ['party:name', 'coil:name', 'ss:name', 'sd:name', 'spire:name', 'updraft:name', 'boostball-name', 'shellcr-name', 'br1v1-name', 'rk_name', 'chroma-name', 'oddone-name', 'tumble-name'];
    for (var i = 0; i < keysTried.length; i++) {
      var v = store(keysTried[i]); if (!v) continue;
      try { if (v.charAt(0) === '"') v = JSON.parse(v); } catch (e) {}
      v = cleanName(v); if (v) return v;
    }
    return '';
  }
  function myName() { return cleanName(store('ol:name')) || guessName() || 'Guest'; }
  function saveSets() { store('ol:block', JSON.stringify(blocked)); store('ol:mute', JSON.stringify(muted)); sess('ol:sblock', Object.keys(sblocked).length ? JSON.stringify(sblocked) : null); }
  function loadChats() {
    var v = json(store('ol:chats'), {}), out = {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    Object.keys(v).forEach(function (k) { var t = num(v[k]); if (/^[A-Za-z0-9_-]{6,64}$/.test(k) && t > 0) out[k] = t; });
    return out;
  }
  function saveChats() {
    var ks = Object.keys(chats);
    if (ks.length > CHATS_MAX) ks.sort(function (a, b) { return chats[a] - chats[b]; }).slice(0, ks.length - CHATS_MAX).forEach(function (k) { delete chats[k]; });
    store('ol:chats', Object.keys(chats).length ? JSON.stringify(chats) : null);
  }
  function saveSeen() {
    var ks = Object.keys(seen); if (ks.length > 300) ks.sort(function (a, b) { return seen[a] - seen[b]; }).slice(0, ks.length - 300).forEach(function (k) { delete seen[k]; });
    store('ol:seen', JSON.stringify(seen));
  }
  var saveT = 0;
  function saveThreads() { clearTimeout(saveT); saveT = setTimeout(function () { sess('ol:threads', JSON.stringify(threads)); }, 400); }
  var savePT = 0;
  function savePchat() { clearTimeout(savePT); savePT = setTimeout(function () { sess('ol:pchat', pchat.m.length ? JSON.stringify(pchat) : null); }, 400); }

  // ---------------- Keys (ECDH P-256 + AES-GCM, kept in IndexedDB) ----------------
  function b64(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function idb(mode, fn) {
    return new Promise(function (res, rej) {
      var rq; try { rq = indexedDB.open('backroom-online', 1); } catch (e) { return rej(e); }
      rq.onupgradeneeded = function () { rq.result.createObjectStore('keys'); };
      rq.onerror = function () { rej(rq.error); };
      rq.onsuccess = function () {
        var d = rq.result, tx, r;
        try { tx = d.transaction('keys', mode); r = fn(tx.objectStore('keys')); } catch (e) { d.close(); return rej(e); }
        tx.oncomplete = function () { d.close(); res(r && r.result); };
        tx.onerror = tx.onabort = function () { d.close(); rej(tx.error); };
      };
    });
  }
  async function initKeys() {
    if (!(window.crypto && crypto.subtle && window.indexedDB !== undefined)) return false;
    var saved = null;
    try { saved = await idb('readonly', function (s) { return s.get('me'); }); } catch (e) {}
    if (saved && saved.privateKey && saved.publicKey) keys.pair = saved;
    else {
      // The private key can't be exported, even by this page; IndexedDB keeps it as is.
      keys.pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
      try { await idb('readwrite', function (s) { return s.put({ privateKey: keys.pair.privateKey, publicKey: keys.pair.publicKey }, 'me'); }); } catch (e) {}
    }
    keys.pub = b64(await crypto.subtle.exportKey('raw', keys.pair.publicKey));
    return true;
  }
  var PK_RE = /^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$/, BOX_RE = /^[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/=]{24,2400}$/;
  function shared(pub) {
    if (!keys.derived[pub]) {
      keys.derived[pub] = crypto.subtle.importKey('raw', unb64(pub), { name: 'ECDH', namedCurve: 'P-256' }, false, []).then(function (peer) {
        return crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, keys.pair.privateKey, { name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']);
      });
      keys.derived[pub].catch(function () {});
    }
    return keys.derived[pub];
  }
  async function seal(pub, obj) {
    var k = await shared(pub), iv = crypto.getRandomValues(new Uint8Array(12));
    return b64(iv) + '.' + b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(JSON.stringify(obj))));
  }
  async function unseal(pub, box) {
    var p = box.split('.'), k = await shared(pub);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p[0]) }, k, unb64(p[1]))));
  }

  // ---------------- Reading other people's nodes ----------------
  // Everything in a node is typed by someone else's browser, so check, trim and clamp all of it.
  function parse(k, v) {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(k) || !v || typeof v !== 'object' || Array.isArray(v)) return null;
    var size; try { size = JSON.stringify(v).length; } catch (e) { return null; }
    if (size > NODE_MAX) return null;
    var t = now(), ts = num(v.ts);
    if (!(ts > 0)) return null;
    ts = Math.min(ts, t + 5000);
    var p = {
      uid: k, n: cleanName(v.n) || 'Guest', c: /^#[0-9a-f]{6}$/i.test(v.c) ? v.c : colorOf(k), ts: ts, seat: seatOf(k),
      pk: typeof v.pk === 'string' && PK_RE.test(v.pk) ? v.pk : '',
      party: Math.max(0, Math.min(99, Math.floor(num(v.p)) || 0)),
      pl: typeof v.pl === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(v.pl) ? v.pl : '',
      g: typeof v.g === 'string' && gameOf(v.g) ? v.g : '',
      l: [], dm: [], pc: [], inv: null
    };
    arr(v.l, LOUNGE_KEEP).forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      var mt = when(m.t, t), x = cleanText(m.x);
      if (!(mt > t - LOUNGE_TTL) || !x) return;
      p.l.push({ i: typeof m.i === 'string' && /^[a-z0-9]{1,12}$/.test(m.i) ? m.i : 't' + mt, t: mt, x: x });
    });
    if (uid && v.d && typeof v.d === 'object' && !Array.isArray(v.d)) {
      arr(v.d[uid], DM_KEEP).forEach(function (m) {
        if (!m || typeof m !== 'object' || typeof m.b !== 'string' || !BOX_RE.test(m.b) || typeof m.i !== 'string' || !/^[a-z0-9]{1,12}$/.test(m.i)) return;
        var mt = when(m.t, t); if (!(mt > 0)) return;
        p.dm.push({ i: m.i, t: mt, b: m.b });
      });
    }
    if (uid && v.pc && typeof v.pc === 'object' && !Array.isArray(v.pc)) {
      arr(v.pc[uid], PC_KEEP).forEach(function (m) {
        if (!m || typeof m !== 'object' || typeof m.b !== 'string' || !BOX_RE.test(m.b) || typeof m.i !== 'string' || !/^[a-z0-9]{1,12}$/.test(m.i)) return;
        var mt = when(m.t, t); if (!(mt > 0)) return;
        p.pc.push({ i: m.i, t: mt, b: m.b });
      });
    }
    var iv = uid && v.i && typeof v.i === 'object' && !Array.isArray(v.i) ? v.i[uid] : null;
    if (iv && typeof iv === 'object' && typeof iv.b === 'string' && BOX_RE.test(iv.b) && typeof iv.i === 'string' && /^[a-z0-9]{1,12}$/.test(iv.i)) {
      var it = when(iv.t, t);
      if (it > t - INV_TTL) p.inv = { i: iv.i, t: it, b: iv.b };
    }
    return p;
  }
  function alive(p) { return p && now() - p.ts < STALE; }
  function visible(p) { return alive(p) && !isBlocked(p.uid); }

  function onNode(s) {
    var k = s.key;
    if (k === uid) return;
    var p = parse(k, s.val());
    if (!p) { delete people[k]; schedule(); return; }
    var was = people[k];
    people[k] = p;
    if (was && was.n !== p.n) nameEvent(k, p.n, false);
    remember(p);
    if (keys.pair && p.pk) openAll(p);
    schedule();
  }
  function onGone(s) {
    if (s.key === uid) {
      // Our node went missing (another tab of ours closed, or a dropped connection); put it back.
      if (published && !hidden && meRef) meRef.set(nodeState()).catch(function () {});
      return;
    }
    delete people[s.key]; schedule();
  }
  // Keep a name for everyone we have a conversation with, so the thread still says who it was after they leave.
  function remember(p) { var t = threads[p.uid]; if (t && (t.n !== p.n || t.c !== p.c)) { t.n = p.n; t.c = p.c; saveThreads(); } }
  function thread(u) {
    var t = threads[u];
    if (!t || typeof t !== 'object' || !Array.isArray(t.m)) {
      var p = people[u];
      t = threads[u] = { n: p ? p.n : 'Guest', c: p ? p.c : colorOf(u), m: [] };
    }
    ['rq', 'rx', 'rd', 'in', 'nd', 'jq', 'jx', 'jin', 'jnd'].forEach(function (k) { if (!(num(t[k]) > 0)) t[k] = 0; });
    return t;
  }
  function addMsg(u, m) {
    var t = thread(u);
    for (var i = 0; i < t.m.length; i++) if (t.m[i].id === m.id && t.m[i].from === m.from) return false;
    t.m.push(m); t.m.sort(function (a, b) { return a.t - b.t; });
    if (t.m.length > THREAD_KEEP) t.m.splice(0, t.m.length - THREAD_KEEP);
    saveThreads();
    return true;
  }

  // Open the messages and invite this person sealed to us. One person's items are opened in the order they were sent,
  // so an acceptance is always handled before the message that followed it.
  function openAll(p) {
    p.dm.forEach(function (m) { queueOpen(p, m, false); });
    if (p.inv) queueOpen(p, p.inv, true);
    p.pc.forEach(function (m) { queueOpen(p, m, 'pc'); });
  }
  function queueOpen(p, m, isInv) {
    var key = (isInv === 'pc' ? 'g:' : '') + p.uid + ':' + m.i + ':' + p.pk.slice(0, 12);
    if (opened[key]) return; opened[key] = 1;
    chains[p.uid] = (chains[p.uid] || Promise.resolve()).then(function () { return isInv === 'pc' ? openParty(p, m, key) : openOne(p, m, isInv); }).catch(function () {});
  }
  // A party-chat message sealed to us. Only shown when it's for the party we're in now and comes from someone in it;
  // one for our party from someone the member list doesn't show yet (they've only just joined) is tried again a few times.
  var pcRetry = {};
  function openParty(p, m, key) {
    return unseal(p.pk, m.b).then(function (o) {
      if (!o || typeof o !== 'object' || o.k !== 'g' || o.f !== p.uid || o.to !== uid) return;
      var u = p.uid, x = cleanText(o.x);
      if (!x || !P || !P.code || o.c !== P.code) return;
      if (!partyMate(u)) {
        pcRetry[key] = (pcRetry[key] || 0) + 1;
        if (pcRetry[key] <= 5) setTimeout(function () { delete opened[key]; var q = people[u]; if (q && q.pk === p.pk) queueOpen(q, m, 'pc'); }, 2000);
        return;
      }
      var pm = { id: m.i, from: u, t: m.t, x: x, n: p.n, c: p.c };
      if (!addParty(pm)) return;
      if (isBlocked(u) || muted[u]) { schedule(); return; }
      var shown = tellGames(pm);
      if (shown) markParty(m.t);
      else if (m.t > started - 120000 && !(view && view.v === 'party' && dr.classList.contains('open'))) toast(p, { k: 'g', x: x, t: m.t });
      schedule();
    }, function () {});
  }
  function openOne(p, m, isInv) {
    return unseal(p.pk, m.b).then(function (o) {
      if (!o || typeof o !== 'object' || o.f !== p.uid || o.to !== uid) return;
      var u = p.uid, msg = { id: m.i, from: u, t: m.t }, t = now();
      if (!isInv && o.k === 'm') {
        // A message from someone who isn't an accepted chat (an older client, or someone trying their luck) isn't shown,
        // unless they're in our party: party members can message each other without a request.
        if (!chats[u] && !partyMate(u)) return;
        msg.k = 'm'; msg.x = cleanText(o.x); if (!msg.x) return;
      } else if (!isInv && o.k === 'q') {
        // They'd like to chat. Not from someone blocked, and not once it has run out.
        if (isBlocked(u) || m.t < t - REQ_TTL) return;
        var th = thread(u);
        // One pending request per pair: a repeat while theirs is still open, or within REQ_TTL of our no, is ignored.
        if (th.in && (th.in >= m.t || t - th.in < REQ_TTL)) return;
        if (th.nd && m.t < th.nd + REQ_TTL) return;
        msg.k = 'q';
        if (chats[u] || pendingOut(u)) {
          // Already accepted here (they may have lost that), or we asked them at the same time: that's a yes.
          if (!addMsg(u, msg)) return;
          accept(u, true).catch(function () {});
          schedule(); return;
        }
        th.in = m.t;
      } else if (!isInv && o.k === 'a') {
        // Yes, from someone we asked (and only then: a stray yes from anyone else opens nothing).
        var th2 = threads[u];
        if (!th2 || !th2.rq || th2.rx >= th2.rq || m.t < th2.rq - 60000 || m.t > th2.rq + REQ_TTL + 60000) return;
        msg.k = 'a';
        if (!addMsg(u, msg)) return;
        if (!chats[u]) { chats[u] = m.t; saveChats(); }
        th2.rx = m.t; th2.rd = 0; saveThreads();
        if (!muted[u] && m.t > started - 120000) toast(p, msg);
        schedule(); return;
      } else if (!isInv && o.k === 'n') {
        var th3 = threads[u];
        if (!th3 || !pendingOut(u) || m.t < th3.rq - 60000) return;
        msg.k = 'n';
        if (!addMsg(u, msg)) return;
        th3.rd = m.t; th3.rx = m.t; saveThreads();
        if (!muted[u] && m.t > started - 120000) toast(p, msg);
        schedule(); return;
      } else if (!isInv && o.k === 'e') {
        if (!chats[u] || m.t < chats[u] - 60000) return;
        msg.k = 'e';
        if (!addMsg(u, msg)) return;
        delete chats[u]; saveChats();
        var th4 = thread(u); th4.in = 0; if (th4.rq) th4.rx = m.t; saveThreads();
        if (!isBlocked(u) && !muted[u] && m.t > started - 120000) toast(p, msg);
        schedule(); return;
      } else if (!isInv && o.k === 'j') {
        // They'd like to join our party. Not from someone blocked, not once it has run out, one open request per person.
        if (isBlocked(u) || m.t < t - REQ_TTL) return;
        var th5 = thread(u);
        if (th5.jin && (th5.jin >= m.t || t - th5.jin < REQ_TTL)) return;
        if (th5.jnd && m.t < th5.jnd + REQ_TTL) return;
        msg.k = 'j';
        if (!addMsg(u, msg)) return;
        th5.jin = m.t; saveThreads();
        // Only the leader of a party with room can say yes; anything else is answered straight away.
        var no = !P || !P.code ? 'gone' : (P.leader && P.leader.uid !== uid) ? 'lead' : P.size >= (P.max || 8) ? 'full' : '';
        if (no) { answerJoin(u, false, no, true).catch(function () { th5.jin = 0; saveThreads(); schedule(); }); schedule(); return; }
        if (!muted[u] && m.t > started - 120000) toast(p, msg);
        schedule(); return;
      } else if (!isInv && o.k === 'y') {
        // Yes, from a leader we asked (and only then), with the party code.
        var th6 = threads[u];
        if (!th6 || !pendingJoinOut(u) || m.t < th6.jq - 60000 || typeof o.c !== 'string' || !/^[a-z0-9]{1,8}$/.test(o.c)) return;
        msg.k = 'y'; msg.c = o.c;
        if (!addMsg(u, msg)) return;
        th6.jx = Math.max(m.t, th6.jq); th6.jw = 'y'; th6.jc = o.c; saveThreads();
        if (!muted[u] && m.t > started - 120000) toast(p, msg);
        schedule(); return;
      } else if (!isInv && o.k === 'x') {
        var th7 = threads[u];
        if (!th7 || !pendingJoinOut(u) || m.t < th7.jq - 60000) return;
        msg.k = 'x'; msg.w = /^(no|full|lead|gone)$/.test(o.w) ? o.w : 'no';
        if (msg.w === 'lead') { if (typeof o.l === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(o.l)) msg.l = o.l; msg.ln = cleanName(o.ln) || 'the leader'; }
        if (!addMsg(u, msg)) return;
        th7.jx = Math.max(m.t, th7.jq); th7.jw = msg.w; th7.jl = msg.l || ''; th7.jln = msg.ln || ''; saveThreads();
        if (!muted[u] && m.t > started - 120000) toast(p, msg);
        schedule(); return;
      }
      else if (isInv && o.k === 'p' && typeof o.c === 'string' && /^[a-z0-9]{1,8}$/.test(o.c)) { msg.k = 'p'; msg.c = o.c; }
      else if (isInv && o.k === 'r' && okRoom(gameOf(o.g), o.r)) { msg.k = 'r'; msg.g = o.g; msg.r = o.r; }
      else return;
      if (!addMsg(u, msg)) return;
      if (!isBlocked(u) && !muted[u] && m.t > started - 120000 && !(view && view.v === 'dm' && view.u === u && dr.classList.contains('open'))) toast(p, msg);
      schedule();
    }, function () {});
  }
  // Chat-request state for a person, from this tab's thread: rq when we last asked them, rx when that was settled (a yes, a no
  // or the chat ending), rd when they said no, in when they asked us (0 once answered), nd when we said no.
  function pendingOut(u) { var t = threads[u]; return !!(t && t.rq && !(t.rx >= t.rq) && now() - t.rq < REQ_TTL && !chats[u]); }
  function pendingIn(u) { var t = threads[u]; return !!(t && t.in && now() - t.in < REQ_TTL && !chats[u] && !isBlocked(u)); }
  function declined(u) { var t = threads[u]; return !!(t && t.rq && t.rd >= t.rq && now() - t.rq < REQ_TTL && !chats[u]); }
  function canRequest(u) {
    var why = canTalk(u); if (why) return why;
    if (chats[u]) return 'You already chat with them.';
    var t = threads[u], n = now();
    if (t && t.rq && n - t.rq < REQ_TTL) return pendingOut(u) ? 'Waiting for them to accept.' : 'You can ask again in ' + Math.max(1, Math.ceil((REQ_TTL - (n - t.rq)) / 60000)) + ' min.';
    reqSent = reqSent.filter(function (x) { return n - x < REQ_BURST_MS; });
    if (reqSent.length >= REQ_BURST) return 'That’s a lot of requests. Try again in a few minutes.';
    return '';
  }
  async function request(u) {
    var why = canRequest(u); if (why) throw new Error(why);
    var th = thread(u), t = now();
    reqSent.push(t);
    await sendDm(u, { k: 'q' });
    th.rq = Math.max(t, last(thread(u).m)); th.rx = 0; th.rd = 0; saveThreads();
    schedule();
  }
  async function accept(u, auto) {
    var th = thread(u);
    if (!auto && !pendingIn(u)) throw new Error('That request has run out.');
    await sendDm(u, { k: 'a' }, auto);
    th.in = 0; if (th.rq) th.rx = now();
    if (!chats[u]) { chats[u] = now(); saveChats(); }
    saveThreads(); schedule();
  }
  async function decline(u) {
    var th = thread(u);
    if (!pendingIn(u)) throw new Error('That request has run out.');
    await sendDm(u, { k: 'n' });
    th.in = 0; th.nd = now(); saveThreads(); schedule();
  }
  async function endChat(u) {
    var th = thread(u);
    delete chats[u]; saveChats();
    th.in = 0; if (th.rq) th.rx = now(); saveThreads();
    schedule();
    await sendDm(u, { k: 'e' }, true);
  }

  // Join requests, kept in the thread like chat requests: jq when we asked them to let us into their party, jx when that was
  // answered, jw what they said ('y', or why not: 'no', 'full', 'lead', 'gone'), jc the code a yes came with, jl / jln the leader
  // a 'lead' pointed us to; jin when they asked us (0 once answered), jnd when we said no.
  function pendingJoinOut(u) { var t = threads[u]; return !!(t && t.jq && !(t.jx >= t.jq) && now() - t.jq < REQ_TTL); }
  function pendingJoinIn(u) { var t = threads[u]; return !!(t && t.jin && now() - t.jin < REQ_TTL && !isBlocked(u)); }
  function joinAnswer(u) { var t = threads[u]; return t && t.jq && t.jx >= t.jq && now() - t.jq < REQ_TTL ? (t.jw || 'no') : ''; }
  // Where a request to join p's party goes: p when they lead it (or we can't tell), else their leader when that person is online.
  function joinTarget(p) {
    if (!p || !p.party) return null;
    if (!p.pl || p.pl === p.uid) return p;
    var L = people[p.pl]; return L && visible(L) && L.pk ? L : p;
  }
  function inMyParty(u, p) {
    if (!P || !P.code) return false;
    if ((P.members || []).indexOf(u) >= 0) return true;
    return !!(p && p.pl && P.leader && p.pl === P.leader.uid);
  }
  // ---------------- Party chat ----------------
  // The other people in our party, from party.js's own member list (the party nodes), leaving out anyone the leader
  // has removed. Not from what someone says in their Online node, so nobody can talk their way into a party's chat.
  function partyMembers() {
    if (!P || !P.code || !uid) return [];
    var out = P.out || [];
    return (P.members || []).filter(function (u) { return u !== uid && out.indexOf(u) < 0; });
  }
  function partyMate(u) { return !!u && partyMembers().indexOf(u) >= 0; }
  // Members a party message can go to now: online here with a key, and not blocked by us.
  function partyTargets() { return partyMembers().filter(function (u) { var p = people[u]; return visible(p) && p.pk; }); }
  function partyName(u) {
    if (u === uid) return myName();
    var p = people[u]; if (p) return p.n;
    var r = P && P.roster ? P.roster.filter(function (m) { return m.uid === u; })[0] : null;
    return r ? cleanName(r.n) || 'Player' : 'Player';
  }
  // The party chat as it shows here: our current party's messages, without blocked or muted people's.
  function partyMsgs() {
    if (!P || !P.code || pchat.c !== P.code) return [];
    return pchat.m.filter(function (m) { return m.from === uid || (!isBlocked(m.from) && !muted[m.from]); });
  }
  function partyUnread() { if (!P || !P.code) return 0; var s = seen['pt:' + P.code] || 0; return partyMsgs().filter(function (m) { return m.from !== uid && m.t > s; }).length; }
  function markParty(t) { if (!P || !P.code) return false; var k = 'pt:' + P.code; if (t > (seen[k] || 0)) { seen[k] = t; saveSeen(); return true; } return false; }
  function addParty(m) {
    if (!P || !P.code) return false;
    if (pchat.c !== P.code) pchat = { c: P.code, m: [] };
    for (var i = 0; i < pchat.m.length; i++) if (pchat.m[i].id === m.id && pchat.m[i].from === m.from) return false;
    pchat.m.push(m); pchat.m.sort(function (a, b) { return a.t - b.t; });
    if (pchat.m.length > THREAD_KEEP) pchat.m.splice(0, pchat.m.length - THREAD_KEEP);
    savePchat();
    return true;
  }
  function canParty() {
    var why = canTalk(); if (why) return why;
    if (!P || !P.code) return 'You’re not in a party.';
    if (!keys.pair) return 'This browser can’t encrypt, so party chat is off here.';
    if (!partyMembers().length) return 'Nobody else is in your party yet.';
    if (!partyTargets().length) return 'Nobody in your party can get messages right now (they may be hidden or still connecting).';
    return '';
  }
  // Seal the message once for every member (each copy can only be opened by that member) and write them all at once.
  async function sendParty(x) {
    var why = canParty() || limited(); if (why) throw new Error(why);
    var code = P.code, t = Math.round(now()), id = rid(), to = partyTargets(), patch = {};
    var boxes = await Promise.all(to.map(function (u) { return seal(people[u].pk, { f: uid, to: u, k: 'g', c: code, x: x }); }));
    to.forEach(function (u, j) { mine.pc[u] = (mine.pc[u] || []).concat({ i: id, t: t, b: boxes[j] }).slice(-PC_KEEP); patch['pc/' + u] = mine.pc[u]; });
    prunePc(patch);
    await write(patch);
    var pm = { id: id, from: uid, t: t, x: x, n: myName(), c: colorOf(uid) };
    addParty(pm); markParty(t); tellGames(pm);
    schedule();
  }
  // Drop party copies for anyone who isn't in the party any more, and keep the node well under the size other browsers
  // accept (NODE_MAX): the oldest party copies go first, down to one per member.
  function prunePc(patch) {
    var ms = partyMembers();
    Object.keys(mine.pc).forEach(function (u) { if (ms.indexOf(u) < 0) { delete mine.pc[u]; patch['pc/' + u] = null; } });
    var size; try { size = JSON.stringify(nodeState()).length; } catch (e) { size = 0; }
    while (size > NODE_SOFT) {
      var best = '', bt = Infinity;
      Object.keys(mine.pc).forEach(function (u) { var l = mine.pc[u]; if (l.length > 1 && l[0].t < bt) { bt = l[0].t; best = u; } });
      if (!best) break;
      size -= JSON.stringify(mine.pc[best].shift()).length;
      patch['pc/' + best] = mine.pc[best];
    }
    return patch;
  }
  // The party or its members changed (poll() notices): a new party starts a new chat, and copies for anyone who left go.
  function partyChanged() {
    var c = P && P.code || '';
    if (c && pchat.c !== c) { pchat = { c: c, m: [] }; savePchat(); }
    var patch = prunePc({});
    if (Object.keys(patch).length && published) write(patch).catch(function () {});
  }
  // The in-game chat (gamechat.js inside the open game's iframe) listens through window.BackRoomChat. A listener
  // returns true when it showed the message, so it counts as read and no toast is needed.
  var gameSubs = [];
  function partyPublic(m) {
    var isMe = m.from === uid, p = people[m.from];
    return { id: m.id, t: m.t, mine: isMe, u: m.from, name: mask(isMe ? myName() : p ? p.n : cleanName(m.n) || 'Player'), seat: seatOf(m.from), color: isMe ? colorOf(uid) : (p ? p.c : m.c) || colorOf(m.from), x: mask(m.x) };
  }
  function tellGames(m) {
    if (!m || (m.from !== uid && (isBlocked(m.from) || muted[m.from]))) return false;
    var shown = false, pub = partyPublic(m);
    gameSubs = gameSubs.filter(function (fn) { try { if (fn(pub) === true) shown = true; return true; } catch (e) { return false; } });
    return shown;
  }

  function canAskJoin(u) {
    var why = canTalk(u); if (why) return why;
    var p = people[u];
    if (!p.party) return 'They aren’t in a party.';
    if (inMyParty(u, p)) return 'You’re already in their party.';
    var t = threads[u], n = now();
    if (t && t.jq && n - t.jq < REQ_TTL) return pendingJoinOut(u) ? 'Waiting for them to answer.' : 'You can ask again in ' + Math.max(1, Math.ceil((REQ_TTL - (n - t.jq)) / 60000)) + ' min.';
    reqSent = reqSent.filter(function (x) { return n - x < REQ_BURST_MS; });
    if (reqSent.length >= REQ_BURST) return 'That’s a lot of requests. Try again in a few minutes.';
    // One open request per party: not while another member of the same party still has ours.
    var L = p.pl || u;
    for (var k in threads) if (k !== u && pendingJoinOut(k) && people[k] && (people[k].pl || k) === L) return 'You already asked ' + mask(people[k].n) + ' to join that party.';
    return '';
  }
  async function askJoin(u) {
    var why = canAskJoin(u); if (why) throw new Error(why);
    var th = thread(u), t = now();
    reqSent.push(t);
    await sendDm(u, { k: 'j' });
    th.jq = Math.max(t, last(thread(u).m)); th.jx = 0; th.jw = ''; th.jc = ''; th.jl = ''; th.jln = ''; saveThreads();
    schedule();
  }
  // Answer someone's request to join: yes sends the party code; no says why (w), and for 'lead' who the leader is.
  async function answerJoin(u, yes, w, auto) {
    var th = thread(u);
    if (!auto && !pendingJoinIn(u)) throw new Error('That request has run out.');
    var payload;
    if (yes) {
      if (!P || !P.code) throw new Error('You’re not in a party any more.');
      if (P.leader && P.leader.uid !== uid) throw new Error('Only the party leader can let people in.');
      if (P.size >= (P.max || 8)) throw new Error('The party is full.');
      payload = { k: 'y', c: P.code };
    } else {
      payload = { k: 'x', w: w || 'no' };
      if (w === 'lead' && P && P.leader) { payload.l = P.leader.uid; payload.ln = P.leader.n; }
    }
    await sendDm(u, payload, true);
    th.jin = 0; th.jnd = yes ? 0 : now(); saveThreads(); schedule();
  }
  function joinNoText(m) {
    return m.w === 'full' ? '’s party is full, so your request to join was turned down.'
      : m.w === 'lead' ? ' isn’t the leader. Only the leader can accept — ask ' + (m.ln || 'the leader') + '.'
      : m.w === 'gone' ? ' isn’t in a party any more.' : ' declined your request to join.';
  }
  // An "Ask <leader>" button for a 'lead' answer, when that leader is online (and isn't us).
  function askLeaderBtn(m) {
    if (m.w !== 'lead' || !m.l || m.l === uid || !visible(people[m.l]) || !people[m.l].pk) return null;
    var b = btn('Ask ' + mask(people[m.l].n), 'pri', 'joinreq'); b.setAttribute('data-u', m.l); return b;
  }

  // ---------------- Our own node ----------------
  function nodeState() {
    var s = { n: myName(), c: colorOf(uid), x: 0, z: 0, h: 0, ts: Math.round(now()), v: 1, p: status.p };
    if (status.g) s.g = status.g;
    if (status.pl) s.pl = status.pl;
    if (keys.pub) s.pk = keys.pub;
    if (mine.l.length) s.l = mine.l;
    if (Object.keys(mine.d).length) s.d = mine.d;
    if (Object.keys(mine.i).length) s.i = mine.i;
    if (Object.keys(mine.pc).length) s.pc = mine.pc;
    return s;
  }
  function write(patch) {
    if (!published || hidden || !meRef) return Promise.reject(new Error('hidden'));
    patch.ts = Math.round(now());
    return meRef.update(patch);
  }
  async function publish() {
    if (hidden || !meRef) return;
    published = true;
    try {
      await meRef.set(nodeState());
      meRef.onDisconnect().remove();
    } catch (e) { published = false; say('The database didn’t accept your Online status (' + (e.code || e.message) + ').', true); return; }
    clearInterval(beat);
    beat = setInterval(heartbeat, BEAT);
    saveWho();
    syncBoardName();
    schedule();
  }
  function unpublish() {
    clearInterval(beat); published = false;
    if (meRef) { var r = meRef; try { r.onDisconnect().cancel(); } catch (e) {} r.remove().catch(function () {}); }
    mine.l = []; mine.i = {}; mine.pc = {};
    schedule();
  }
  // Drop lounge messages and invites that have run out, along with the heartbeat.
  function heartbeat() {
    if (!published || hidden) return;
    var t = now(), patch = {}, l = mine.l.filter(function (m) { return m.t > t - LOUNGE_TTL; });
    if (l.length !== mine.l.length) { mine.l = l; patch.l = l.length ? l : null; }
    Object.keys(mine.i).forEach(function (u) { if (mine.i[u].t < t - INV_TTL) { delete mine.i[u]; patch['i/' + u] = null; } });
    write(patch).catch(function () {});
    schedule();
  }
  function onConnected(s) {
    if (s.val() === true && !wasConnected && published && !hidden && meRef) { meRef.onDisconnect().remove(); meRef.set(nodeState()).catch(function () {}); }
    wasConnected = s.val() === true;
  }

  // What we're doing: in a party (party.js), and in a game (whichever game is open in the page's game layer).
  function gameFrame() {
    var frs = document.querySelectorAll('iframe');
    for (var i = 0; i < frs.length; i++) {
      var fr = frs[i]; if (!fr.isConnected || fr.closest('[hidden]') || fr.closest('.onl-dr')) continue;
      var path = ''; try { path = fr.contentWindow.location.pathname; } catch (e) {}
      if (!path || path === 'blank') { try { path = new URL(fr.getAttribute('src') || '', location.href).pathname; } catch (e) { continue; } }
      for (var j = 0; j < GAMES.length; j++) {
        var g = GAMES[j], dir = g.abs || BASE + g.d + '/';
        if (path.indexOf(dir) === 0) return { fr: fr, g: g };
      }
    }
    return null;
  }
  function poll() {
    var gf = gameFrame(), p = P ? P.size : 0, g = gf ? gf.g.k : '', pl = p && P.leader ? P.leader.uid : '';
    if (gf) addBarButton(gf.fr);
    if (p !== status.p || g !== status.g || pl !== status.pl) {
      status = { p: p, g: g, pl: pl };
      if (published) write({ p: p, g: g || null, pl: pl || null }).catch(function () {});
      schedule();
    }
    // The party's members changed (someone joined, left or was removed): new copies of the party chat follow the new list.
    var sig = (P && P.code || '') + ':' + partyMembers().join(',');
    if (sig !== status.sig) { status.sig = sig; partyChanged(); schedule(); }
  }
  // The room the game that's open is in, as far as we can tell: the one party.js last opened, or the game's room box.
  function currentRoom() {
    var gf = gameFrame(); if (!gf || !gf.g.room) return null;
    var lr = P && P.room;
    if (lr && lr.k === gf.g.k && okRoom(gf.g, lr.r)) return { g: gf.g.k, r: lr.r };
    try {
      var d = gf.fr.contentDocument, box = d && (d.getElementById('room') || d.getElementById('inRoom') || d.getElementById('joinCode'));
      var r = box && String(box.value || '').toLowerCase().replace(/^[a-z]{2}-/, '');
      if (okRoom(gf.g, r)) return { g: gf.g.k, r: r };
    } catch (e) {}
    return { g: gf.g.k, r: '' };
  }

  // ---------------- Safety log (Firestore chatlog, sealed) and who (plain) ----------------
  // Writes one Firestore document with this account's ID token. The rules check every field and that uid is the account
  // writing it. adminkey.js (the admin public key and BackRoomSeal) is loaded the first time something is sealed.
  var keyP = null;
  function sealer() {
    if (window.BackRoomSeal) return Promise.resolve(window.BackRoomSeal);
    if (!keyP) {
      keyP = new Promise(function (res, rej) {
        var sc = document.createElement('script'); sc.src = BASE + 'adminkey.js';
        sc.onload = function () { if (window.BackRoomSeal) res(window.BackRoomSeal); else rej(new Error('no key')); };
        sc.onerror = function () { rej(new Error('no key')); };
        document.head.appendChild(sc);
      });
      keyP.catch(function () { keyP = null; });
    }
    return keyP;
  }
  function fsWrite(path, fields, mustBeNew) {
    return (async function () {
      var u = auth && auth.currentUser;
      if (!u || !window.fetch) throw new Error('Not signed in.');
      var token = await u.getIdToken();
      var docs = 'projects/' + project + '/databases/(default)/documents', f = {};
      Object.keys(fields).forEach(function (k) { f[k] = { stringValue: String(fields[k]) }; });
      f.uid = { stringValue: u.uid };
      var w = { update: { name: docs + '/' + path.replace('{uid}', u.uid), fields: f }, updateTransforms: [{ fieldPath: 'ts', setToServerValue: 'REQUEST_TIME' }] };
      if (mustBeNew) w.currentDocument = { exists: false };
      var r = await fetch('https://firestore.googleapis.com/v1/' + docs + ':commit', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ writes: [w] })
      });
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    })();
  }
  function docId() {
    var id = '', a = crypto.getRandomValues(new Uint8Array(20)), c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < a.length; i++) id += c[a[i] % c.length];
    return id;
  }
  // kind 'cabin' or 'report'; payload goes inside the sealed box (at most 12000 characters, which the rules check too).
  async function logChat(kind, payload) {
    var seal = await sealer();
    var box = await seal(payload);
    if (box.length > 12000) throw new Error('Too long.');
    return fsWrite('chatlog/' + docId(), { kind: kind, box: box }, true);
  }
  var whoSaved = '';
  // ---------------- One name everywhere ----------------
  function nameEvent(u, n, isMine) { try { document.dispatchEvent(new CustomEvent('backroom:name', { detail: { uid: u, n: n, mine: !!isMine } })); } catch (e) {} }
  // The leaderboard entry's name (stats.js writes the whole entry from inside the games, about once a minute while one is
  // open; this fixes just n from here). Only an entry that exists is touched, at most every BOARD_GAP, the last name wins.
  var BOARD_GAP = 4000, boardT = 0, boardLast = 0, boardSent = '', boardBusy = false;
  function syncBoardName(soon) {
    clearTimeout(boardT);
    if (!db || !uid) return;
    boardT = setTimeout(function () {
      if (boardBusy) return syncBoardName();
      var wait = boardLast + BOARD_GAP - Date.now(); if (wait > 0) { boardT = setTimeout(function () { syncBoardName(true); }, wait); return; }
      var n = myName(), u = uid, ref = db.ref('rooms/lb-all/players/' + u);
      if (boardSent === u + '|' + n) return;
      boardBusy = true; boardLast = Date.now();
      ref.child('n').once('value').then(function (s) {
        if (!s.exists() || u !== uid) return;            // no entry yet: the first game played makes one, with this name
        if (s.val() === n) { boardSent = u + '|' + n; return; }
        return ref.update({ n: n }).then(function () { boardSent = u + '|' + n; });
      }).catch(function () {}).then(function () { boardBusy = false; });
    }, soon ? 0 : 300);
  }
  // Our name changed (typed here, in the Party panel, or in another tab): show it and send it everywhere at once.
  function nameChanged() {
    if (document.activeElement !== $name) $name.value = myName();
    if (published) { write({ n: myName() }).catch(function () {}); saveWho(); }
    if (uid) nameEvent(uid, myName(), true);
    syncBoardName();
    schedule();
  }
  document.addEventListener('backroom:name', function (e) { if (e.detail && e.detail.from === 'party') nameChanged(); });
  addEventListener('storage', function (e) { if (e.key === 'ol:name' || e.key === 'party:name') nameChanged(); });
  function saveWho() {
    if (!uid || hidden) return;
    var vid = String(store('an_vid') || '');
    if (!/^[a-z0-9]{1,40}$/.test(vid)) vid = '';
    var key = uid + '|' + myName() + '|' + vid;
    if (whoSaved === key) return;
    whoSaved = key;
    fsWrite('who/{uid}', { vid: vid, name: myName(), seat: seatOf(uid) }, false).catch(function () {});
  }
  // The conversation with u as this browser has it (the last REPORT_MSGS messages and invites), as plain text.
  function transcript(u) {
    var t = threads[u], p = people[u], msgs = t && Array.isArray(t.m) ? t.m.slice(-REPORT_MSGS) : [];
    var meL = myName() + ' (' + seatOf(uid) + ')', theirs = (cleanName(p ? p.n : t && t.n) || 'Guest') + ' (' + seatOf(u) + ')';
    var lines = msgs.map(function (m) {
      var who = m.from === uid ? meL : theirs, what;
      if (m.k === 'm') what = ': ' + cleanText(m.x);
      else if (m.k === 'p') what = ' sent a party invite';
      else if (m.k === 'r') what = ' sent a room invite (' + (gameOf(m.g) ? gameOf(m.g).n : '?') + ', room ' + String(m.r).slice(0, 17) + ')';
      else if (m.k === 'q') what = ' asked to chat';
      else if (m.k === 'a') what = ' accepted the chat';
      else if (m.k === 'n') what = ' declined the chat';
      else if (m.k === 'e') what = ' ended the chat';
      else if (m.k === 'j') what = ' asked to join the party';
      else if (m.k === 'y') what = ' let them into the party';
      else if (m.k === 'x') what = ' turned down the join request' + (m.w && m.w !== 'no' ? ' (' + m.w + ')' : '');
      else return '';
      return { t: m.t, s: stamp(m.t) + ' ' + who + what };
    }).filter(Boolean);
    // When they wrote in our party chat, its recent messages too (everyone's, as this browser shows them), marked [party].
    var pm = pchat.m.slice(-REPORT_MSGS), inParty = pm.some(function (m) { return m.from === u; });
    if (inParty) {
      pm.forEach(function (m) {
        var w = m.from === uid ? meL : m.from === u ? theirs : (cleanName(people[m.from] ? people[m.from].n : m.n) || 'Guest') + ' (' + seatOf(m.from) + ')';
        lines.push({ t: m.t, s: stamp(m.t) + ' [party] ' + w + ': ' + cleanText(m.x) });
      });
      lines.sort(function (a, b) { return a.t - b.t; });
    }
    lines = lines.map(function (l) { return l.s; });
    var text = lines.join('\n'), bytes = function (x) { return new TextEncoder().encode(x).length; };
    while ((text.length > REPORT_MAX || bytes(text) > REPORT_BYTES) && lines.length > 1) { lines.shift(); text = '(older messages cut)\n' + lines.join('\n'); }
    while (text.length > REPORT_MAX || bytes(text) > REPORT_BYTES) text = text.slice(Math.max(1, Math.floor(text.length / 10)));
    return { text: text || '(no messages in this chat: reporting the person)', n: lines.length, party: inParty };
  }
  async function report(u) {
    if (!uid) throw new Error('Not connected yet.');
    if (reported[u] && Date.now() - reported[u] < REPORT_GAP) throw new Error('You just reported them. Arjun will see it.');
    var t = threads[u], p = people[u], who = (p ? label(p) : mask(cleanName(t && t.n) || 'Someone') + ' · ' + seatOf(u));
    var tr = transcript(u);
    var ok = confirm('Report ' + who + ' to Arjun?\n\n' +
      'This sends Arjun ' + (tr.n ? 'a copy of the last ' + tr.n + ' message' + (tr.n === 1 ? '' : 's') + (tr.party ? ' in this chat and your party chat, as they appear on your screen (yours, theirs and, from the party chat, the other members’)' : ' in this chat, as they appear on your screen (yours and theirs)') : 'a note that you reported them (there are no messages in this chat)') +
      ', with both your names, seats and account IDs. Nothing else is sent. Only Arjun and the site\u2019s admins can read reports.\n\n' +
      'You can also Block them so you stop seeing their messages.');
    if (!ok) return false;
    await logChat('report', { name: myName(), seat: seatOf(uid), about: u, aboutName: cleanName(p ? p.n : t && t.n) || 'Guest', aboutSeat: seatOf(u), text: tr.text });
    reported[u] = Date.now();
    return true;
  }

  // ---------------- Sending ----------------
  function limited() {
    var t = Date.now();
    sent = sent.filter(function (x) { return t - x < BURST_MS; });
    if (sent.length && t - sent[sent.length - 1] < GAP) return 'One moment: you can send a message every second and a half.';
    if (sent.length >= BURST) return 'Slow down a little: that’s ' + BURST + ' messages in ten seconds.';
    sent.push(t); return '';
  }
  function canTalk(u) {
    if (hidden) return 'You’re hidden. Turn off Hide me to chat.';
    if (!published) return 'Not connected yet.';
    if (u) {
      var p = people[u];
      if (isBlocked(u)) return 'You blocked this person.';
      if (!visible(p)) return 'They’ve left the Back Room.';
      if (!keys.pair) return 'This browser can’t encrypt private messages.';
      if (!p.pk) return 'Their browser can’t receive private messages.';
    }
    return '';
  }
  // The chat-request steps (q, a, n, e) have their own limits (canRequest, one answer per request), so they don't count
  // against the message rate limit; quiet marks an automatic one (a yes we owe them) all the same.
  async function sendDm(u, payload, quiet) {
    var step = quiet || /^[qanejyx]$/.test(payload.k);
    var why = canTalk(u) || (step ? '' : limited()); if (why) throw new Error(why);
    if (payload.k === 'm' && !chats[u] && !partyMate(u)) throw new Error(pendingIn(u) ? 'Accept their request to chat.' : 'Request to chat first.');
    var p = people[u], t = Math.round(now()), id = rid();
    var b = await seal(p.pk, Object.assign({ f: uid, to: u }, payload));
    var patch = {}, isInv = payload.k === 'p' || payload.k === 'r';
    if (!isInv) {
      mine.d[u] = (mine.d[u] || []).concat({ i: id, t: t, b: b }).slice(-DM_KEEP);
      patch['d/' + u] = mine.d[u];
      var peers = Object.keys(mine.d);
      if (peers.length > DM_PEERS) {
        peers.sort(function (a, c) { return last(mine.d[a]) - last(mine.d[c]); });
        peers.slice(0, peers.length - DM_PEERS).forEach(function (x) { delete mine.d[x]; patch['d/' + x] = null; });
      }
    } else {
      mine.i[u] = { i: id, t: t, b: b }; patch['i/' + u] = mine.i[u];
      var inv = Object.keys(mine.i);
      if (inv.length > INV_PEERS) {
        inv.sort(function (a, c) { return mine.i[a].t - mine.i[c].t; });
        inv.slice(0, inv.length - INV_PEERS).forEach(function (x) { delete mine.i[x]; patch['i/' + x] = null; });
      }
    }
    await write(patch);
    var m = { id: id, from: uid, t: t, k: payload.k };
    if (payload.k === 'm') m.x = payload.x; else if (payload.k === 'p' || payload.k === 'y') m.c = payload.c; else if (payload.k === 'r') { m.g = payload.g; m.r = payload.r; }
    else if (payload.k === 'x') { m.w = payload.w; if (payload.ln) m.ln = payload.ln; }
    addMsg(u, m);
    seen[u] = Math.max(seen[u] || 0, t); saveSeen();
    schedule();
  }
  function last(list) { return list && list.length ? list[list.length - 1].t : 0; }
  async function sendLounge(x) {
    var why = canTalk() || limited(); if (why) throw new Error(why);
    var t = Math.round(now());
    mine.l = mine.l.filter(function (m) { return m.t > t - LOUNGE_TTL; }).concat({ i: rid(), t: t, x: x }).slice(-LOUNGE_KEEP);
    await write({ l: mine.l });
    seen.lounge = t; saveSeen();
    // A sealed copy for the safety log. Never waits for it, and a refusal (rules not added yet) is ignored.
    logChat('cabin', { name: myName(), seat: seatOf(uid), text: x, t: t }).catch(function () {});
    schedule();
  }
  async function inviteParty(u) {
    var why = canTalk(u); if (why) throw new Error(why);
    if (!P) throw new Error('The Party panel isn’t loaded.');
    if (!store('party:name')) store('party:name', myName());
    var c = P.code;
    if (!c) { say('Creating a party…'); c = await P.create(); }
    if (!c) throw new Error('Couldn’t create a party. See the Party panel for why.');
    await sendDm(u, { k: 'p', c: c });
  }

  // Accepting invites.
  async function joinParty(c, from) {
    if (!P) return say('The Party panel isn’t loaded.', true);
    if (P.code === c) return say('You’re already in that party.');
    if (!store('party:name')) store('party:name', myName());
    say('Joining ' + from + '’s party…');
    var got = await P.join(c);
    if (got === c) {
      say('You joined ' + from + '’s party. When the leader starts a game, you’ll go too.');
      var pe = document.getElementById('party'); if (pe && !gameFrame()) pe.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else say('Couldn’t join that party. The Party panel says why.', true);
  }
  function openRoom(gk, r) {
    var g = gameOf(gk); if (!okRoom(g, r)) return;
    closeDrawer();
    if (P && P.launch && P.launch(g.k, r)) return;
    var path = BASE + g.d + '/' + (g.pre != null ? '#' + g.pre + r : '#' + g.k + '-' + r);
    if (P && P.open) P.open(path, g.n); else location.href = path;
  }

  // ---------------- Drawing ----------------
  var drawT = 0;
  function schedule() { if (!drawT) drawT = setTimeout(function () { drawT = 0; draw(); }, 60); }
  function label(p) { return mask(p.n) + ' · ' + p.seat; }
  function statusText(p) {
    var g = p.g && gameOf(p.g), bits = [];
    if (g) bits.push('In ' + g.n);
    if (p.party) bits.push((p.party > 1 ? 'Party of ' + p.party : 'In a party') + (p.pl && p.pl === p.uid ? ' · leader' : ''));
    return bits.join(' · ') || 'Idle';
  }
  function unreadOf(u) {
    if (isBlocked(u) || muted[u]) return 0;
    var t = threads[u]; if (!t || !Array.isArray(t.m)) return 0;
    var s = seen[u] || 0, n = 0;
    t.m.forEach(function (m) { if (m.from === u && m.t > s) n++; });
    return n;
  }
  function loungeAll() {
    var out = [], t = now();
    Object.keys(people).forEach(function (k) {
      var p = people[k]; if (!visible(p) || muted[k]) return;
      p.l.forEach(function (m) { if (m.t > t - LOUNGE_TTL) out.push({ u: k, p: p, m: m }); });
    });
    if (published && !hidden) mine.l.forEach(function (m) { if (m.t > t - LOUNGE_TTL) out.push({ u: uid, p: null, m: m }); });
    out.sort(function (a, b) { return a.m.t - b.m.t; });
    return out.slice(-80);
  }
  function loungeUnread() { var s = seen.lounge || 0; return loungeAll().filter(function (x) { return x.u !== uid && x.m.t > s; }).length; }
  function others() {
    return Object.keys(people).map(function (k) { return people[k]; }).filter(visible)
      .sort(function (a, b) { return a.n.localeCompare(b.n) || (a.uid < b.uid ? -1 : 1); });
  }
  function meEntry() { return { uid: uid, n: myName(), c: uid ? colorOf(uid) : COLORS[0], seat: uid ? seatOf(uid) : '', party: status.p, pl: status.pl, g: status.g }; }
  function personBtn(p, isMe) {
    var b = el('button', 'onl-p' + (isMe ? ' me' : '')); b.type = 'button';
    if (!isMe) { b.setAttribute('data-u', p.uid); b.setAttribute('aria-label', 'Open ' + label(p)); }
    var av = avatarEl(p.uid, p.n, p.c, 34);
    var who = el('span', 'onl-who'), nm = el('span', 'onl-nm');
    nm.append(mask(p.n) + ' ', el('small', '', '· ' + p.seat + (isMe ? ' · you' : '')));
    var badge = tierBadge(p.uid);
    if (badge) { var tl = el('span', 'onl-tl'); tl.append(badge); who.append(nm, tl); } else who.append(nm);
    who.append(el('span', 'onl-st', (isMe && hidden) ? 'Hidden' : (muted[p.uid] ? 'Muted · ' : '') + statusText(p)));
    // Your own card says how far along you are: "2,340 miles · 7,660 to First Class" (owners: "12,000 miles · flies the plane", next to their Captain badge).
    var t = isMe ? tierOf(p.uid) : null, tl2 = milesLine(t);
    if (tl2) who.append(el('span', 'onl-mi', tl2));
    b.append(av, who);
    var n = isMe ? 0 : unreadOf(p.uid);
    if (n) { var badge = el('span', 'onl-n', String(n)); badge.setAttribute('aria-label', n + ' unread'); b.append(badge); }
    return b;
  }
  function fillList(ul, withMe) {
    ul.textContent = '';
    var me = el('li'); me.append(personBtn(meEntry(), true));
    if (uid && withMe) ul.append(me);
    var os = others();
    os.forEach(function (p) { var li = el('li'); li.append(personBtn(p, false)); ul.append(li); });
    return os.length;
  }

  function draw() {
    var os = others(), n = os.length + (published && !hidden ? 1 : 0);
    $title.lastChild.textContent = uid ? '(' + n + ')' : '';
    if (document.activeElement !== $name) $name.value = myName();
    $seat.textContent = uid ? 'Seat ' + seatOf(uid) + (hidden ? '' : ' · ' + statusText(meEntry())) : '';
    if (uid && $meAv.getAttribute('data-u') !== uid + (window.BackRoomAvatar ? ':a' : '')) {
      $meAv.textContent = ''; $meAv.append(avatarEl(uid, myName(), colorOf(uid), 34)); $meAv.setAttribute('data-u', uid + (window.BackRoomAvatar ? ':a' : ''));
    }
    var mt = uid ? tierOf(uid) : null;
    $tier.textContent = '';
    if (mt) { $tier.append(BackRoomMiles.badge(mt)); var ml = milesLine(mt); if (ml) $tier.append(el('span', '', ml)); }
    $hide.checked = hidden;
    var lu = loungeUnread(); $loungeBtn.lastChild.textContent = lu ? String(lu) : '';
    fillList($list);
    if (uid && !os.length) { var li = el('li'); li.append(el('p', 'onl-empty', hidden ? 'You’re hidden, so nobody can see you. Nobody else is around right now either.' : 'Nobody else is here right now. Leave this open and you’ll see people as they arrive.')); $list.append(li); }
    var dmTotal = 0; Object.keys(threads).forEach(function (u) { dmTotal += unreadOf(u); });
    document.querySelectorAll('.onl-bar:not(.onl-pbar)').forEach(function (b) { b.firstChild.textContent = 'Online ' + n; b.lastChild.textContent = dmTotal + lu ? String(dmTotal + lu) : ''; });
    // Party chat buttons: the Online panel, the Party panel (party.js) and the open game's top bar.
    var inParty = !!(P && P.code), mates = partyMembers().length, pu = partyUnread(), pus = pu ? String(pu) : '';
    $partyBtn.style.display = inParty ? '' : 'none'; $partyBtn.lastChild.textContent = pus;
    document.querySelectorAll('.onl-pbar').forEach(function (b) { b.hidden = !mates; b.lastChild.textContent = pus; });
    var pp = document.querySelector('#party [data-a="chat"]'); if (pp && pp.lastChild && pp.lastChild.className === 'onl-n') pp.lastChild.textContent = pus;
    if (dr.classList.contains('open')) drawDrawer();
  }

  // A button in the open game's top bar, so the list, chats and invites are a tap away mid-game.
  function addBarButton(fr) {
    var bar = fr.previousElementSibling;
    if (!bar || bar.tagName !== 'DIV' || bar.querySelector('.onl-bar')) return;
    var b = el('button', 'onl-bar'); b.type = 'button'; b.append('Online', el('span', 'onl-n'));
    b.setAttribute('aria-label', 'Online: people, chats and invites');
    b.addEventListener('click', function () { openDrawer({ v: 'people' }); });
    // Party chat, while in a party with someone: opens the game's own chat box (gamechat.js) when it has one, so a phone
    // player can talk without leaving the game; otherwise the Party chat drawer.
    var c = el('button', 'onl-bar onl-pbar'); c.type = 'button'; c.append('Chat', el('span', 'onl-n')); c.hidden = true;
    c.setAttribute('aria-label', 'Party chat');
    c.addEventListener('click', function () {
      var gc = null; try { gc = fr.contentWindow && fr.contentWindow.BackRoomGameChat; } catch (e) {}
      var ok = false; try { ok = !!(gc && gc.open()); } catch (e) {}
      if (!ok) openDrawer({ v: 'party' });
    });
    var turn = bar.querySelector('#turn');
    if (turn) { bar.insertBefore(c, turn); bar.insertBefore(b, turn); } else bar.append(c, b);
    schedule();
  }

  // ---------------- Drawer ----------------
  var drawnView = '';
  function openDrawer(v) {
    // The party chat shows everything its toasts said.
    if (v && v.v === 'party') toasts.querySelectorAll('.onl-t[data-k="g"]').forEach(function (t) { t.remove(); });
    view = v; drawnView = ''; dr.classList.add('open'); drawDrawer(); setTimeout(function () { var i = dr.querySelector('.onl-df input[type=text]'); if (i && matchMedia('(pointer: fine)').matches) i.focus(); }, 220); }
  function closeDrawer() { dr.classList.remove('open'); view = null; drawnView = ''; schedule(); }
  function drawDrawer() {
    if (!view) return;
    var key = view.v + ':' + (view.u || '');
    var stick = true, body = dr.querySelector('.onl-db');
    if (body) stick = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    var keep = drawnView === key ? dr.querySelector('.onl-df') : null;
    var prevScroll = body ? body.scrollTop : 0;
    if (!keep) dr.textContent = '';
    else { Array.prototype.slice.call(dr.children).forEach(function (c) { if (c !== keep) c.remove(); }); }
    drawnView = key;
    var head = el('div', 'onl-dh');
    if (view.v !== 'people') { var back = el('button', 'onl-x', '‹'); back.type = 'button'; back.setAttribute('aria-label', 'Back to the list'); back.setAttribute('data-act', 'list'); head.append(back); }
    var h = el('h2'); head.append(h);
    var x = el('button', 'onl-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.setAttribute('data-act', 'close'); head.append(x);
    body = el('div', 'onl-db');
    var parts = [head];
    if (view.v === 'people') {
      h.textContent = 'Online';
      var sub = el('div', 'onl-dsub'), acts = el('div', 'onl-acts'), lb = btn('Cabin chat', '', 'lounge');
      var lu = loungeUnread(); lb.append(el('span', 'onl-n', lu ? String(lu) : ''));
      if (P && P.code) { var pb = btn('Party chat', '', 'pchat'), pu = partyUnread(); pb.append(el('span', 'onl-n', pu ? String(pu) : '')); acts.append(pb); }
      acts.append(lb, btn(hidden ? 'Show me' : 'Hide me', '', 'hide'));
      sub.append(el('span', '', hidden ? 'You’re hidden. Others can’t see or message you.' : 'Tap someone to request a chat or invite them.'), acts);
      parts.push(sub);
      var ul = el('ul', 'onl-list'); fillList(ul, true); body.append(ul);
      var bl = Object.keys(blocked).concat(Object.keys(sblocked).filter(function (u) { return !blocked[u]; }));
      if (bl.length) {
        body.append(el('p', 'onl-h', 'Blocked'));
        bl.forEach(function (u) {
          var t = threads[u], row = el('div', 'onl-row'), p = people[u], bw = el('span', 'onl-who');
          bw.style.display = 'block';
          bw.append(avatarEl(u, p ? p.n : t && t.n, p ? p.c : t && t.c, 22), (p ? label(p) : (t ? mask(cleanName(t.n)) : 'Someone') + ' · ' + seatOf(u)) + (blocked[u] ? '' : ' (this session)'));
          row.append(bw);
          var ub = btn('Unblock', '', 'unblock'); ub.setAttribute('data-u', u); row.append(ub);
          body.append(row);
        });
      }
      parts.push(body);
    } else if (view.v === 'lounge') {
      h.textContent = 'Cabin chat';
      parts.push(Object.assign(el('div', 'onl-dsub'), { textContent: 'One chat for everyone online right now. Shows the last 30 minutes from people who are here. Be kind.' }));
      var all = loungeAll();
      if (!all.length) body.append(el('p', 'onl-note', 'It’s quiet in here. Say hello.'));
      all.forEach(function (it) {
        var mineMsg = it.u === uid, p = it.p || meEntry();
        var m = el('div', 'onl-m' + (mineMsg ? ' mine' : ''));
        var who = el('span', 'who'); who.append(avatarEl(it.u, p.n, p.c, 18), el('b', '', mask(p.n)), ' · ' + p.seat + ' · ' + clock(it.m.t));
        m.append(who, el('span', '', mask(it.m.x)));
        body.append(m);
      });
      parts.push(body);
      if (!keep) keep = composer('Message everyone', 'say');
      var lt = all.length ? all[all.length - 1].m.t : 0; if (lt > (seen.lounge || 0)) { seen.lounge = lt; saveSeen(); }
    } else if (view.v === 'party') {
      h.textContent = 'Party chat';
      var psub = el('div', 'onl-dsub'), ms = partyMembers(), tg = partyTargets();
      if (P && P.code) {
        psub.append(el('span', '', 'Only your party (' + P.code + ') can read this: each message is encrypted separately for every member, and people who join later don’t see earlier ones. Tap a name to message, mute, block or report them.'));
        var off = ms.filter(function (x2) { return tg.indexOf(x2) < 0; });
        if (off.length && !hidden) psub.append(el('span', '', 'Not getting party chat right now: ' + off.map(function (x2) { return mask(partyName(x2)) + (isBlocked(x2) ? ' (blocked)' : ''); }).join(', ') + '.'));
      } else psub.append(el('span', '', 'You’re not in a party. Create or join one in the Party panel, then chat with everyone in it here.'));
      parts.push(psub);
      var pms = partyMsgs();
      if (P && P.code && !pms.length) body.append(el('p', 'onl-note', ms.length ? 'Say hi to your party. In a game, press T or tap Chat at the top to talk without leaving it.' : 'Nobody else is in your party yet.'));
      pms.forEach(function (m) {
        var isMe = m.from === uid, pp = people[m.from], pn = isMe ? myName() : pp ? pp.n : cleanName(m.n) || partyName(m.from);
        var mm = el('div', 'onl-m' + (isMe ? ' mine' : '')), who = el('span', 'who');
        who.append(avatarEl(m.from, pn, isMe ? colorOf(uid) : pp ? pp.c : m.c, 18));
        if (isMe) who.append(el('b', '', 'You'));
        else { var nb = el('button', 'onl-wn', mask(pn)); nb.type = 'button'; nb.setAttribute('data-act', 'opendm'); nb.setAttribute('data-u', m.from); nb.setAttribute('aria-label', 'Open ' + mask(pn) + '’s card'); who.append(nb); }
        who.append(' · ' + seatOf(m.from) + ' · ' + clock(m.t));
        mm.append(who, el('span', '', mask(m.x)));
        body.append(mm);
      });
      parts.push(body);
      if (!keep) keep = composer('Message your party', 'send');
      var pwhy = canParty(), pin = keep.querySelector('input'); if (pin) { pin.disabled = !!pwhy; pin.placeholder = pwhy || 'Message your party'; }
      var psb = keep.querySelector('[data-act=send]'); if (psb) psb.disabled = !!pwhy;
      if (pms.length && markParty(pms[pms.length - 1].t)) schedule();
    } else if (view.v === 'dm') {
      var u = view.u, p = people[u], t = threads[u];
      var nm = p ? label(p) : (t ? mask(cleanName(t.n)) : 'Someone') + ' · ' + seatOf(u);
      h.append(avatarEl(u, p ? p.n : t && t.n, p ? p.c : t && t.c, 26), nm);
      var dsub = el('div', 'onl-dsub'), dline = el('span'), dbadge = tierBadge(u);
      if (dbadge) dline.append(dbadge, ' ');
      dline.append((p && visible(p) ? statusText(p) : 'Not online') + ' · private: only the two of you can read this.');
      dsub.append(dline);
      var da = el('div', 'onl-acts'), why = canTalk(u), theirs = mask(p ? p.n : (t ? cleanName(t.n) : '') || 'them'), mate = partyMate(u);
      if (chats[u]) da.append(btn('End chat', '', 'endchat'));
      else if (!mate && !pendingIn(u) && !isBlocked(u)) {
        var rq = btn(pendingOut(u) ? 'Request sent' : declined(u) ? 'Declined' : 'Request to chat', 'pri', 'request');
        var rwhy = canRequest(u); rq.disabled = !!rwhy; if (rwhy) rq.title = rwhy;
        da.append(rq);
      }
      da.append(btn('Invite to party', 'pri', 'invite'));
      // Request to join their party: goes to its leader (them, or their leader when that person is online).
      var jt = p && visible(p) && p.party && !isBlocked(u) && !inMyParty(u, p) ? joinTarget(p) : null;
      if (jt) {
        var ja = joinAnswer(jt.uid), jwhy = canAskJoin(jt.uid);
        var jb = btn(pendingJoinOut(jt.uid) ? 'Join request sent' : ja === 'y' ? 'Let in' : ja && ja !== 'lead' ? 'Join declined' : 'Request to join', 'pri', 'joinreq');
        jb.setAttribute('data-u', jt.uid); jb.disabled = !!jwhy; if (jwhy) jb.title = jwhy;
        da.append(jb);
      }
      da.append(btn('Send room code', '', 'room'), btn(muted[u] ? 'Unmute' : 'Mute', '', 'mute'));
      if (isBlocked(u)) { var ub2 = btn('Unblock', 'warn', 'unblock'); ub2.setAttribute('data-u', u); da.append(ub2); }
      else da.append(btn('Block', 'warn', 'block'), btn('Block for this session', 'warn', 'sblock'));
      da.append(btn('Report', 'warn', 'report'));
      dsub.append(da);
      if (view.room) { if (!view.roomEl) view.roomEl = roomForm(); dsub.append(view.roomEl); } else view.roomEl = null;
      parts.push(dsub);
      da.querySelectorAll('[data-act=invite],[data-act=room]').forEach(function (b2) { b2.disabled = !!why; });
      var msgs = t && Array.isArray(t.m) ? t.m : [];
      if (isBlocked(u)) body.append(el('p', 'onl-note', 'You blocked this person' + (blocked[u] ? '' : ' for this session') + '. Their messages, invites and chat requests are hidden.'));
      else {
        if (mate && !chats[u]) body.append(el('p', 'onl-note', 'You’re in the same party, so you can message each other without a chat request. Block stops their messages.'));
        if ((chats[u] || mate) && !msgs.some(function (m) { return m.k === 'm'; })) body.append(el('p', 'onl-note', 'Say hi. Messages are end-to-end encrypted: other people online can see that you sent something, but not what.'));
        msgs.forEach(function (m) { body.append(msgEl(u, m)); });
        if (jt && jt.uid !== u) {
          // Their leader is someone else: say where the request goes, and how that is going.
          var jn = el('div', 'onl-m onl-card'), jr = el('div', 'onl-acts'), jtn = mask(jt.n), jth = threads[jt.uid];
          var jtx = pendingJoinOut(jt.uid) ? ' You asked ' + jtn + '. Waiting for an answer.' : ja === 'y' ? ' ' + jtn + ' let you in.' : ja ? ' ' + jtn + joinNoText({ w: ja, ln: jth && jth.jln }) : '';
          jn.append(el('span', '', 'Only the leader can let people in, so requests to join this party go to ' + jtn + '.' + jtx));
          if (ja === 'y' && jth && jth.jc && !(P && P.code === jth.jc)) { var jj = btn('Join party', 'pri', 'joinp'); jj.setAttribute('data-c', jth.jc); jj.setAttribute('data-u', jt.uid); jr.append(jj); }
          var od = btn('Open chat with ' + jtn, '', 'opendm'); od.setAttribute('data-u', jt.uid); jr.append(od);
          jn.append(jr); body.append(jn);
        }
        if (pendingJoinIn(u)) {
          var jc = el('div', 'onl-m onl-card'), jca = el('div', 'onl-acts');
          jc.append(el('span', '', theirs + ' wants to join your party' + (P && P.code ? ' (' + P.code + ')' : '') + '.'));
          jca.append(btn('Let them in', 'pri', 'jaccept'), btn('Decline', '', 'jdecline'));
          jc.append(jca); body.append(jc);
        }
        var mwhy = '';
        if (pendingIn(u)) {
          var rc = el('div', 'onl-m onl-card'), ra = el('div', 'onl-acts');
          rc.append(el('span', '', theirs + ' wants to chat with you. Accept their request to see their messages.'));
          ra.append(btn('Accept', 'pri', 'accept'), btn('Decline', '', 'decline'), btn('Block', 'warn', 'block'));
          rc.append(ra); body.append(rc);
          if (!mate) mwhy = 'Accept their request to chat.';
        } else if (!chats[u] && !mate) {
          if (pendingOut(u)) { body.append(el('p', 'onl-note', 'Request sent. Waiting for ' + theirs + ' to accept.')); mwhy = 'Waiting for them to accept.'; }
          else if (declined(u)) { body.append(el('p', 'onl-note', theirs + ' declined your request.')); mwhy = 'They declined your request.'; }
          else { body.append(el('p', 'onl-note', 'Request to chat with ' + theirs + '. They see your messages once they accept.')); mwhy = 'Request to chat first.'; }
        }
        if (!why && mwhy) why = mwhy;
      }
      parts.push(body);
      if (!keep) keep = composer('Message', 'send');
      var inp = keep.querySelector('input'); if (inp) { inp.disabled = !!why; inp.placeholder = why || 'Message ' + theirs; }
      var sb = keep.querySelector('[data-act=send]'); if (sb) sb.disabled = !!why;
      var lm = msgs.length ? msgs[msgs.length - 1].t : 0; if (lm > (seen[u] || 0)) { seen[u] = lm; saveSeen(); }
    }
    if (keep && keep.parentNode !== dr) parts.push(keep);
    parts.forEach(function (c) { if (c !== keep || keep.parentNode !== dr) dr.insertBefore(c, keep && keep.parentNode === dr ? keep : null); });
    if (stick) body.scrollTop = body.scrollHeight; else body.scrollTop = prevScroll;
  }
  function msgEl(u, m) {
    var isMine = m.from === uid, p = people[u], t = threads[u];
    var theirName = mask(p ? p.n : (t ? cleanName(t.n) : 'They'));
    var who = el('span', 'who', (isMine ? 'You' : theirName) + ' · ' + clock(m.t));
    if (m.k === 'm') { var d = el('div', 'onl-m' + (isMine ? ' mine' : '')); d.append(who, el('span', '', mask(m.x))); return d; }
    if (m.k === 'q' || m.k === 'a' || m.k === 'n' || m.k === 'e') {
      var said = m.k === 'q' ? (isMine ? 'You asked to chat.' : theirName + ' asked to chat.')
        : m.k === 'a' ? (isMine ? 'You accepted. You can chat now.' : theirName + ' accepted. You can chat now.')
        : m.k === 'n' ? (isMine ? 'You declined.' : theirName + ' declined.')
        : (isMine ? 'You ended the chat.' : theirName + ' ended the chat.');
      return el('p', 'onl-note', said + ' · ' + clock(m.t));
    }
    if (m.k === 'j') return el('p', 'onl-note', (isMine ? 'You asked to join their party.' : theirName + ' asked to join your party.') + ' · ' + clock(m.t));
    if (m.k === 'x' && isMine) return el('p', 'onl-note', 'You turned down their request to join' + (m.w === 'full' ? ' (the party is full)' : m.w === 'lead' ? ' (you aren’t the leader)' : m.w === 'gone' ? ' (you aren’t in a party)' : '') + '. · ' + clock(m.t));
    var card = el('div', 'onl-m onl-card' + (isMine ? ' mine' : '')); card.append(who);
    var row = el('div', 'onl-acts');
    if (m.k === 'y') {
      card.append(el('span', '', isMine ? 'You let them into the party (' + m.c + ').' : theirName + ' let you into their party.'));
      if (!isMine) {
        if (P && P.code === m.c) row.append(el('span', 'onl-st', 'You’re in this party'));
        else { var jy = btn('Join party', 'pri', 'joinp'); jy.setAttribute('data-c', m.c); row.append(jy); }
      }
    } else if (m.k === 'x') {
      card.append(el('span', '', theirName + joinNoText(m)));
      var al = askLeaderBtn(m); if (al) row.append(al);
    } else if (m.k === 'p') {
      card.append(el('span', '', isMine ? 'You invited them to your party (' + m.c + ').' : theirName + ' invited you to their party.'));
      if (!isMine) {
        if (P && P.code === m.c) row.append(el('span', 'onl-st', 'You’re in this party'));
        else { var j = btn('Join party', 'pri', 'joinp'); j.setAttribute('data-c', m.c); row.append(j); }
      }
    } else if (m.k === 'r') {
      var g = gameOf(m.g); if (!okRoom(g, m.r)) return el('span');
      card.append(el('span', '', (isMine ? 'You sent a room: ' : theirName + ' sent you a room: ') + g.n + ', room ' + m.r + '.'));
      // Only ever an address we build ourselves from a known game and a checked room code.
      var a = el('a', 'onl-b' + (isMine ? '' : ' pri'), isMine ? 'Open it' : 'Join ' + g.n);
      a.href = inviteHref(g, m.r); a.setAttribute('data-g', g.k); a.setAttribute('data-r', m.r); a.setAttribute('data-act', 'openroom');
      row.append(a, el('span', 'onl-st', location.host + inviteHref(g, m.r)));
    }
    card.append(row);
    return card;
  }
  function composer(ph, act) {
    var f = el('form', 'onl-df'), row = el('div', 'onl-row');
    var i = el('input'); i.type = 'text'; i.maxLength = TEXT_MAX; i.autocomplete = 'off'; i.placeholder = ph; i.setAttribute('aria-label', ph); i.enterKeyHint = 'send';
    var b = btn('Send', 'pri', act); b.type = 'submit';
    row.append(i, b);
    var cnt = el('span', 'onl-count', '');
    i.addEventListener('input', function () { cnt.textContent = i.value.length > TEXT_MAX - 40 ? i.value.length + ' / ' + TEXT_MAX : ''; });
    var err = el('p', 'onl-msg'); err.setAttribute('role', 'status');
    f.append(row, cnt, err);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var x = cleanText(i.value); if (!x) return;
      var u = view && view.u;
      err.textContent = ''; err.classList.remove('err');
      (view.v === 'lounge' ? sendLounge(x) : view.v === 'party' ? sendParty(x) : sendDm(u, { k: 'm', x: x })).then(function () { i.value = ''; cnt.textContent = ''; }, function (e2) { err.textContent = e2.message || String(e2); err.classList.add('err'); });
    });
    return f;
  }
  function roomForm() {
    var f = el('div', 'onl-row'); f.style.flexWrap = 'wrap';
    var sel = el('select'); sel.setAttribute('aria-label', 'Game');
    GAMES.forEach(function (g) { if (!g.room) return; var o = el('option', '', g.n); o.value = g.k; sel.append(o); });
    var code = el('input'); code.type = 'text'; code.maxLength = 17; code.placeholder = 'Room code'; code.setAttribute('aria-label', 'Room code'); code.autocapitalize = 'off'; code.spellcheck = false;
    var cur = currentRoom(); if (cur) { sel.value = cur.g; code.value = cur.r; }
    code.style.flex = '1 1 40%';
    f.append(sel, code, btn('Send', 'pri', 'sendroom'), btn('Cancel', '', 'noroom'));
    f.className = 'onl-row onl-roomf';
    return f;
  }

  // ---------------- Toasts ----------------
  function toast(p, m) {
    var t = el('div', 'onl-t'), line = el('div'), who = el('b', '', label(p));
    var acts = el('div', 'onl-acts'), life = 8000;
    line.append(avatarEl(p.uid, p.n, p.c, 22));
    if (m.k === 'm') {
      line.append(who, ': ' + mask(m.x).slice(0, 120));
      acts.append(btn('Reply', 'pri', 'reply'), btn('Dismiss', '', 'dismiss'));
    } else if (m.k === 'q') {
      line.append(who, ' wants to chat with you.');
      acts.append(btn('Accept', 'pri', 'accept'), btn('Decline', '', 'decline'), btn('Later', '', 'dismiss')); life = 30000;
    } else if (m.k === 'a') {
      line.append(who, ' accepted your chat request.');
      acts.append(btn('Open chat', 'pri', 'reply'), btn('Dismiss', '', 'dismiss')); life = 15000;
    } else if (m.k === 'n') {
      line.append(who, ' declined your chat request.');
      acts.append(btn('Dismiss', '', 'dismiss'));
    } else if (m.k === 'e') {
      line.append(who, ' ended the chat.');
      acts.append(btn('Dismiss', '', 'dismiss'));
    } else if (m.k === 'j') {
      line.append(who, ' wants to join your party.');
      acts.append(btn('Let them in', 'pri', 'jaccept'), btn('Decline', '', 'jdecline'), btn('Later', '', 'dismiss')); life = 30000;
    } else if (m.k === 'y') {
      line.append(who, ' let you into their party.' + (P && P.code && P.code !== m.c ? ' Joining takes you out of your current one.' : ''));
      var jy = btn('Join party', 'pri', 'joinp'); jy.setAttribute('data-c', m.c);
      acts.append(jy, btn('Not now', '', 'dismiss')); life = 30000;
    } else if (m.k === 'x') {
      line.append(who, joinNoText(m));
      var al = askLeaderBtn(m); if (al) { acts.append(al); life = 20000; }
      acts.append(btn('Dismiss', '', 'dismiss'));
    } else if (m.k === 'g') {
      line.append(who, ' to your party: ' + mask(m.x).slice(0, 120));
      acts.append(btn('Reply', 'pri', 'pchat'), btn('Dismiss', '', 'dismiss'));
      t.setAttribute('data-k', 'g');
    } else if (m.k === 'p') {
      line.append(who, ' invited you to their party.' + (P && P.code ? ' Joining takes you out of your current one.' : ''));
      var j = btn('Join', 'pri', 'joinp'); j.setAttribute('data-c', m.c);
      acts.append(j, btn('No thanks', '', 'dismiss')); life = 30000;
    } else {
      var g = gameOf(m.g);
      line.append(who, ' sent you a room: ' + g.n + ', room ' + m.r + '.');
      var a = el('a', 'onl-b pri', 'Join'); a.href = inviteHref(g, m.r); a.setAttribute('data-g', g.k); a.setAttribute('data-r', m.r); a.setAttribute('data-act', 'openroom');
      acts.append(a, btn('Not now', '', 'dismiss')); life = 30000;
    }
    t.setAttribute('data-u', p.uid); t.setAttribute('data-t', String(m.t));
    t.append(line, acts);
    toasts.append(t);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    setTimeout(function () { t.remove(); }, life);
  }

  // ---------------- Events ----------------
  function onAct(e) {
    var b = e.target.closest('[data-act],[data-u]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-act'), host = b.closest('.onl-t');
    if (host && a) {
      var hu = host.getAttribute('data-u'), ht = +host.getAttribute('data-t') || 0;
      if (host.getAttribute('data-k') === 'g') { markParty(ht); schedule(); }
      else if (hu && ht > (seen[hu] || 0)) { seen[hu] = ht; saveSeen(); schedule(); }
    }
    if (!a && b.classList.contains('onl-p')) { openDrawer({ v: 'dm', u: b.getAttribute('data-u') }); return; }
    if (a === 'lounge') openDrawer({ v: 'lounge' });
    else if (a === 'pchat') { if (host) host.remove(); openDrawer({ v: 'party' }); }
    else if (a === 'list') openDrawer({ v: 'people' });
    else if (a === 'close') closeDrawer();
    else if (a === 'hide') setHidden(!hidden);
    else if (a === 'dismiss') { if (host) host.remove(); }
    else if (a === 'reply') { var u0 = host && host.getAttribute('data-u'); if (host) host.remove(); if (u0) openDrawer({ v: 'dm', u: u0 }); }
    else if (a === 'joinp') {
      e.preventDefault(); if (host) host.remove();
      var from = (host && host.getAttribute('data-u')) || (view && view.u), pp = from && people[from];
      joinParty(b.getAttribute('data-c'), pp ? mask(pp.n) : 'their');
    } else if (a === 'openroom') {
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault(); if (host) host.remove();
      openRoom(b.getAttribute('data-g'), b.getAttribute('data-r'));
    } else if (a === 'unblock') { var bu = b.getAttribute('data-u'); delete blocked[bu]; delete sblocked[bu]; saveSets(); drawnView = ''; schedule(); }
    else if (a === 'opendm') { var ou = b.getAttribute('data-u'); if (ou) openDrawer({ v: 'dm', u: ou }); }
    else if (host && (a === 'accept' || a === 'decline')) {
      var hu2 = host.getAttribute('data-u'); host.remove();
      if (hu2) (a === 'accept' ? accept(hu2) : decline(hu2)).then(function () { if (a === 'accept') openDrawer({ v: 'dm', u: hu2 }); }, function (x) { say(x.message || String(x), true); });
    } else if (host && (a === 'jaccept' || a === 'jdecline')) {
      var hu3 = host.getAttribute('data-u'); host.remove();
      if (hu3) answerJoin(hu3, a === 'jaccept', 'no').then(function () { say(a === 'jaccept' ? 'Sent them the party code. They join when they press Join.' : ''); }, function (x) { say(x.message || String(x), true); });
    } else if (host && a === 'joinreq') {
      var hu4 = b.getAttribute('data-u'); host.remove();
      if (hu4) askJoin(hu4).then(function () { say('Asked ' + (people[hu4] ? mask(people[hu4].n) : 'the leader') + ' to let you into the party.'); }, function (x) { say(x.message || String(x), true); });
    } else if (view && view.v === 'dm') {
      var u = view.u, err = dr.querySelector('.onl-df .onl-msg');
      var fail = function (x) { if (err) { err.textContent = x.message || String(x); err.classList.add('err'); } };
      if (a === 'request') { b.disabled = true; request(u).then(function () { drawnView = ''; schedule(); }, fail).finally(function () { b.disabled = false; }); }
      else if (a === 'accept' || a === 'decline') { b.disabled = true; (a === 'accept' ? accept(u) : decline(u)).then(function () { drawnView = ''; schedule(); }, fail).finally(function () { b.disabled = false; }); }
      else if (a === 'jaccept' || a === 'jdecline') { b.disabled = true; answerJoin(u, a === 'jaccept', 'no').then(function () { drawnView = ''; schedule(); }, fail).finally(function () { b.disabled = false; }); }
      else if (a === 'joinreq') {
        var ju = b.getAttribute('data-u') || u; b.disabled = true;
        askJoin(ju).then(function () {
          if (err && ju !== u && people[ju]) { err.textContent = 'Only the leader can let you in, so your request went to ' + mask(people[ju].n) + '.'; err.classList.remove('err'); }
          schedule();
        }, fail).finally(function () { b.disabled = false; });
      }
      else if (a === 'endchat') {
        if (!confirm('End this chat? You both stop seeing each other’s messages until one of you requests a chat again.')) return;
        endChat(u).then(function () { drawnView = ''; schedule(); }, function () { drawnView = ''; schedule(); });
      } else if (a === 'invite') { b.disabled = true; inviteParty(u).then(function () { if (err) { err.textContent = 'Invite sent.'; err.classList.remove('err'); } }, fail).finally(function () { b.disabled = false; }); }
      else if (a === 'room') { view.room = !view.room; drawnView = ''; drawDrawer(); }
      else if (a === 'noroom') { view.room = false; drawnView = ''; drawDrawer(); }
      else if (a === 'sendroom') {
        var f = dr.querySelector('.onl-roomf'), g = gameOf(f.querySelector('select').value);
        var r = String(f.querySelector('input').value || '').toLowerCase().trim().replace(/^#/, '').replace(new RegExp('^' + g.k + '-'), '');
        if (!okRoom(g, r)) return fail(new Error(g.k === 'tv' ? 'Trivium codes are five letters.' : 'Room codes are letters, numbers and dashes (up to 17).'));
        sendDm(u, { k: 'r', g: g.k, r: r }).then(function () { view.room = false; drawnView = ''; drawDrawer(); }, fail);
      } else if (a === 'mute') { if (muted[u]) delete muted[u]; else muted[u] = 1; saveSets(); drawnView = ''; schedule(); }
      else if (a === 'block') { blocked[u] = 1; saveSets(); drawnView = ''; schedule(); }
      else if (a === 'sblock') { sblocked[u] = 1; saveSets(); drawnView = ''; schedule(); }
      else if (a === 'report') {
        b.disabled = true;
        report(u).then(function (done) {
          if (done && err) { err.textContent = 'Reported. Thanks: Arjun will look at it.'; err.classList.remove('err'); }
        }, function (x) {
          var why = x && x.status === 403 ? 'Reports aren’t switched on yet, so nothing was sent. Block them for now.'
            : x && /^(You just|Not connected)/.test(x.message || '') ? x.message : 'Couldn’t send the report. Check your connection and try again.';
          fail(new Error(why));
        }).finally(function () { b.disabled = false; });
      }
    }
  }
  sec.addEventListener('click', onAct);
  dr.addEventListener('click', onAct);
  toasts.addEventListener('click', onAct);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dr.classList.contains('open')) closeDrawer(); });
  var nameT = 0;
  $name.addEventListener('input', function () {
    clearTimeout(nameT);
    nameT = setTimeout(function () {
      var n = cleanName($name.value); store('ol:name', n || null);
      if (n) store('party:name', n);              // one name: the Party panel uses it too
      nameChanged();
    }, 400);
  });
  $name.addEventListener('blur', function () { $name.value = myName(); });
  $hide.addEventListener('change', function () { setHidden($hide.checked); });
  function setHidden(v) {
    hidden = !!v; store('ol:hidden', hidden ? '1' : null);
    if (!uid) return schedule();
    if (hidden) { unpublish(); say('You’re hidden. Nobody can see you online, and you can’t chat until you turn this off.'); }
    else { say(''); publish(); }
    drawnView = ''; schedule();
  }
  addEventListener('pagehide', function () { if (published && meRef) meRef.remove().catch(function () {}); });
  addEventListener('pageshow', function (e) { if (e.persisted && uid && !hidden) publish(); });
  // avatar.js and miles.js may arrive after the first draw (the home page loads them alongside this file), and each
  // finished tier read is a redraw too.
  // A new avatar or tier only changes names and badges: redraw without dropping the open chat's message box, so a
  // half-typed message (and its focus) survives someone coming online or the tiers' 10-minute refresh.
  document.addEventListener('backroom:avatar', function () { schedule(); });
  document.addEventListener('backroom:miles', function () { schedule(); });

  // ---------------- Start ----------------
  function waitParty() {
    return new Promise(function (res) {
      var n = 0;
      (function t() { if (window.Party && window.Party.boot) return res(window.Party); if (++n > 150) return res(null); setTimeout(t, 100); })();
    });
  }
  async function start() {
    draw();
    P = await waitParty();
    if (!P) return say('Online needs the Party panel, which didn’t load. Reload the page to try again.', true);
    if (!document.getElementById('party') || sec.previousElementSibling !== document.getElementById('party')) place();
    say('Connecting…');
    try {
      var b = await P.boot(); db = b.db; uid = b.uid; auth = b.app.auth(); project = b.app.options.projectId || project;
    } catch (e) {
      say((e && e.message) || 'Couldn’t connect.', true);
      var r = btn('Try again', '', ''); r.addEventListener('click', function () { r.remove(); start(); }); box.append(r);
      return;
    }
    try { if (!(await initKeys())) say('This browser can’t encrypt, so private messages and invites are off here. The cabin chat still works.'); } catch (e) { keys.pair = null; keys.pub = ''; }
    if ($msg.textContent === 'Connecting…') say('');
    meRef = db.ref(PATH + '/' + uid);
    listRef = db.ref(PATH);
    listRef.on('child_added', onNode); listRef.on('child_changed', onNode); listRef.on('child_removed', onGone);
    connRef = db.ref('.info/connected'); connRef.on('value', onConnected);
    status = { p: P.size, g: (gameFrame() || { g: { k: '' } }).g.k, pl: P.size && P.leader ? P.leader.uid : '' };
    setInterval(poll, POLL);
    setInterval(schedule, 30000);
    if (!hidden) publish(); else say('You’re hidden. Nobody can see you online, and you can’t chat until you turn this off.');
    // Signing in with Google switches to another uid: show up under the new one.
    auth.onAuthStateChanged(function (u) {
      if (!u || u.uid === uid) return;
      uid = u.uid; meRef = db.ref(PATH + '/' + uid); delete people[uid]; opened = {}; chains = {}; mine.d = {}; mine.i = {}; mine.pc = {};
      listRef.once('value', function (s) { s.forEach(function (c) { onNode(c); }); });
      if (!hidden) publish();
    });
    schedule();
  }
  start();

  // For the in-game chat (gamechat.js), which runs inside the game's iframe and reaches this page as window.parent.
  // It only ever gets party chat that this page already checked, filtered and masked, and sends through sendParty.
  window.BackRoomChat = {
    v: 1,
    state: function () { return { party: P && P.code || '', mates: partyMembers().length, why: canParty(), unread: partyUnread() }; },
    recent: function (n) { return partyMsgs().slice(-Math.max(1, Math.min(40, n || 12))).map(partyPublic); },
    send: function (x) { x = cleanText(x); return x ? sendParty(x).then(function () { return true; }) : Promise.resolve(false); },
    listen: function (fn) {
      if (typeof fn !== 'function') return function () {};
      gameSubs.push(fn);
      return function () { gameSubs = gameSubs.filter(function (f) { return f !== fn; }); };
    },
    seen: function (t) { markParty(num(t) || 0); schedule(); },
    open: function () { openDrawer({ v: 'party' }); }
  };

  // Test hook for the automated checks; harmless in normal play.
  if (navigator.webdriver) window.__social = { get uid() { return uid; }, get people() { return people; }, get threads() { return threads; }, get mine() { return mine; }, get published() { return published; }, get pub() { return keys.pub; }, get chats() { return chats; }, get sent() { return sent; }, get sblocked() { return sblocked; }, get status() { return status; }, seatOf: seatOf, mask: mask, loungeAll: loungeAll, PATH: PATH, transcript: transcript, get pchat() { return pchat; }, partyMembers: partyMembers, sendParty: sendParty, get muted() { return muted; } };
})();
