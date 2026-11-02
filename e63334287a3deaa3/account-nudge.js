/*
 * Back Room sign-in nudge and account save.
 *
 *   <script src="/e63334287a3deaa3/account-nudge.js" defer></script>
 *
 * Two things, both only on the hub pages (the Back Room page, the phone page and the home page
 * after its reveal), never inside a game:
 *
 * 1. The nudge. When the page opens and the site's Google sign-in (account/account.js,
 *    window.SiteAccount) says nobody is signed in, a small card under the What's new strip asks
 *    them to sign in with Google so their skins, records and settings follow them between
 *    devices. "Sign in" opens the normal Google popup (SiteAccount.signIn()); "Not now" hides the
 *    card for 7 days (localStorage `sv:nudge`, the time it was dismissed). It never signs anyone
 *    in by itself, and it does nothing when the page has no sign-in (the phone page opened on its
 *    own; inside the home page's phone frame it uses the home page's sign-in).
 *
 * 2. The save. While someone is signed in with Google, a whitelist of the games' localStorage keys
 *    (KEYS and PREFIXES below: names, skins and colours, bests and records, settings and keybinds)
 *    is mirrored to their own node in the Firebase Realtime Database, the same project and rules
 *    as the games, at rooms/sv-saves/players/<uid> (prefix `sv`, not an invite prefix). The shared
 *    rules only let a browser write its own node, need n, c, x, z, h, ts (x/z/h always 0, n at
 *    most 14 characters), and let anyone signed in read every node, so the node is
 *      n   a name (the Online name, else the party name, else the account's first name)
 *      c   colour (#rrggbb, from the uid, like party.js)      x, z, h   always 0
 *      ts  when it was last written (server time)             v         1
 *      d   { <key>: <localStorage value, a string> }  the saved keys ('.', '#', '$', '/', '[', ']'
 *          and '%' in a key are written as %XX, because Firebase keys can't hold them)
 *      t   { <key>: ms }  when each key last changed, for newest-wins merging; a key in t but
 *          not in d was deleted at that time
 *    Because every signed-in account can read every node, NOTHING PRIVATE goes in: everything in
 *    the whitelist is already shown to other players in-game or on the leaderboards. Secrets stay
 *    out (the Online panel's keys live in IndexedDB anyway, admin codes, feedback drafts,
 *    analytics ids, room codes, in-progress game saves, stats.js's own play-time record, which
 *    already syncs itself).
 *
 *    Merging: on sign-in (and on load when already signed in) the node is read once, then for
 *    every key the newer copy wins (ties keep the local one). A key this browser changed while
 *    this script wasn't running (a game opened on its own) is noticed by comparing a hash of
 *    each value with the one saved at the last sync (localStorage `sv:meta`: {u: uid, t, h}) and
 *    stamped with the current time. A key this browser has never synced for this account has no
 *    time, so the account's saved copy wins over it (that way a new device's random defaults can
 *    never wipe the account's skins and records); if the account has no copy, it's uploaded.
 *    After the merge the node is written back, then changes are watched: `storage` events from
 *    other tabs and from games running in this page's frames, a poll every 15 s, and pagehide;
 *    writes are debounced by a few seconds and skipped when nothing changed. Values over 64 KB
 *    are left out, and the node is kept under about 200 KB (the largest keys are dropped first).
 *    Nodes are read defensively: unknown keys, non-string values, oversized values and bad times
 *    are ignored.
 *
 *    Limitation: a game reads its saves when it opens, so a value restored from the account shows
 *    up the next time that game is opened; the hub pages restore right away on load, which is
 *    normally long before anyone taps a game. There is no live sync between two devices that are
 *    open at the same time; each picks up the other's changes on its next load or sign-in.
 *
 * Firebase comes from party.js (window.Party.boot()), the same sign-in the panels use; it only
 * writes when that account is the Google account SiteAccount shows, and never signs anyone in.
 *
 * 3. The leaderboard link. Signing in with Google makes a new account (the games had signed this
 *    browser in anonymously), so the anonymous account's Leaderboards entry would stay behind as a
 *    second row with the same name. While the page is signed in anonymously this keeps that
 *    anonymous user (party.js's), and when a Google sign-in arrives on this page it loads stats.js
 *    as a library (data-lib) and calls BackRoomStatsLib.link(): the old entry is marked as merged
 *    into the Google one (written as the old account, which only this page can still do) and the
 *    Google entry takes its hours and bests in. Nothing happens for an account signed in when the
 *    page opened, or when the anonymous account has no entry.
 */
(function () {
  'use strict';
  if (window.__acctNudge || document.getElementById('acct-nudge')) return;
  window.__acctNudge = true;

  var PATH = 'rooms/sv-saves/players';
  var DISMISS = 'sv:nudge', META = 'sv:meta', DAYS = 7;
  var MAX_VAL = 64000, MAX_NODE = 200000, MAX_KEYS = 400;
  var POLL = 15000, DEBOUNCE = 2500, WAIT = 8000;
  var COLORS = ['#1D6A4B', '#C0562F', '#3E5BA9', '#9A3F8F', '#B07A12', '#2A8A8A', '#B42318', '#5B6B2E'];

  // ---- What gets saved. Only things other players can already see in a game or on a leaderboard. ----
  var KEYS = [
    // shared
    'party:name', 'ol:name', 'ol:block', 'ol:mute',
    // Rumble Karts
    'rk_name', 'rk_color', 'rk_mode', 'rk_sound',
    // Shell Crackers
    'shellcr-name', 'shellcr-color', 'shellcr-diff', 'shellcr-gfx', 'shellcr-loadout', 'shellcr-rank', 'shellcr-sens', 'shellcr-vol',
    // Backrooms 1v1–4v4
    'br1v1-name', 'br1v1-diff', 'br1v1-sens',
    // Slipstream
    'ss:name', 'ss:cam', 'ss:diff', 'ss:laps', 'ss:muted', 'ss:trackId',
    // Boostball
    'boostball-name', 'boostball-accent', 'boostball-body', 'boostball-ballcam', 'boostball-bots', 'boostball-diff', 'boostball-gfx',
    'boostball-marker', 'boostball-shake', 'boostball-size', 'boostball-teams', 'boostball-vol',
    // Coil
    'coil:name', 'coil:best', 'coil:diff', 'coil:muted', 'coil:skin',
    // Showdown
    'sd:name', 'sd:av', 'sd:coach', 'sd:four', 'sd:muted', 'sd:prefs', 'sd:pstats',
    // Chromaflage
    'chroma-name', 'chroma-color', 'chroma-paint', 'chroma-shape', 'chroma-size', 'chroma-rough', 'chroma-recent', 'chroma-bsize',
    'chroma-diff', 'chroma-gfx', 'chroma-sens', 'chroma-vol', 'chroma-pmap', 'chroma-hostset',
    // Spire
    'spire:name', 'spire:color', 'spire:profile', 'spire:gfx', 'spire:sens', 'spire:invY', 'spire:vol', 'spire:mus', 'spire:zoom',
    'spire:view', 'spire:slock', 'spire:pracD', 'spire:climbed',
    // Updraft
    'updraft:name', 'updraft:color', 'updraft:best', 'updraft:gfx', 'updraft:sens', 'updraft:inv', 'updraft:vol', 'updraft:mus',
    'updraft:zoom', 'updraft:view',
    // Odd One Out
    'oddone-name', 'oddone-color', 'oddone-diff', 'oddone-gfx', 'oddone-sens', 'oddone-invY', 'oddone-vol', 'oddone-volFx',
    'oddone-volMu', 'oddone-pmap', 'oddone-hostset',
    // Tumble Trials
    'tumble-name', 'tumble-look', 'tumble-stats', 'tumble-bots', 'tumble-gfx', 'tumble-sens', 'tumble-invY', 'tumble-mus',
    'tumble-sfx', 'tumble-muted', 'tumble-pmap',
    // Trivium
    'trivium.name', 'trivium.mute', 'trivium.streak', 'trivium.best.survival', 'trivium.best.blitz', 'trivium.quickCats',
    'trivium.quickDiff', 'trivium.quickLen', 'trivium.quickTime', 'trivium.hostCfg',
    // 2048, Gridpop, Stackfall, Melon Merge
    'g48:best', 'g48:opts',
    'gridpop:best', 'gridpop:mute', 'gridpop:seen',
    'stackfall:mute', 'stackfall:sandColours',
    'melon-merge:best', 'melon-merge:mute', 'melon-merge:faces'
  ];
  var PREFIXES = ['keybinds:', 'tumble-best-', 'trivium.daily.', 'stackfall:best:', 'g48:best:'];
  var KEYSET = Object.create(null); KEYS.forEach(function (k) { KEYSET[k] = 1; });
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  // Own keys only: a node could name 'constructor' or 'toString', which every plain object "has".
  function keyOk(k) {
    if (typeof k !== 'string' || !k || k.length > 80) return false;
    if (has(KEYSET, k)) return true;
    for (var i = 0; i < PREFIXES.length; i++) if (k.indexOf(PREFIXES[i]) === 0 && /^[\w:.\-]+$/.test(k)) return true;
    return false;
  }

  // ---- Small helpers ----
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function json(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }
  function el(tag, cls, text) { var x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; }
  function cleanName(s) { return String(s == null ? '' : s).replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14); }
  function colorOf(uid) { var h = 0; for (var i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
  // FNV-1a over the value plus its length: cheap, and only used to notice that a value changed.
  function hash(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36) + ':' + s.length; }
  // Firebase keys can't hold . # $ / [ ] (and % is the escape), so they go as %XX.
  function enc(k) { return k.replace(/[%.#$\/\[\]]/g, function (c) { return '%' + ('0' + c.charCodeAt(0).toString(16).toUpperCase()).slice(-2); }); }
  function dec(k) { return String(k).replace(/%([0-9A-Fa-f]{2})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); }); }
  function waitFor(get, ms) {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function tick() { var v = get(); if (v) return res(v); if (Date.now() - t0 > ms) return res(null); setTimeout(tick, 100); })();
    });
  }
  function timeout(p, ms) { var t; return Promise.race([p, new Promise(function (_, rej) { t = setTimeout(function () { rej(new Error('timeout')); }, ms); })]).finally(function () { clearTimeout(t); }); }
  // The site's sign-in: on this page, or on the home page when this is its phone frame (same origin).
  function account() {
    if (window.SiteAccount && window.SiteAccount.boot) return window.SiteAccount;
    try { var p = window.parent; if (p && p !== window && p.SiteAccount && p.SiteAccount.boot) return p.SiteAccount; } catch (e) {}
    return null;
  }

  // ---- Styles ----
  var css = document.createElement('style');
  css.textContent =
    '#acct-nudge{margin:20px 0 0;font-family:var(--body,var(--f-b,system-ui,sans-serif));font-size:14px;line-height:1.45;color:var(--ink,#16201b)}' +
    '#acct-nudge:empty{display:none}' +
    '#home > #acct-nudge{margin:0 0 18px}' +
    '#acct-nudge *{box-sizing:border-box}#acct-nudge [hidden]{display:none!important}' +
    '.svn{display:flex;align-items:center;gap:12px 14px;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--line,#d3dad2);border-radius:12px;background:var(--panel,#fff)}' +
    '.svn-ic{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:var(--accent,#1d6a4b);background:color-mix(in srgb,var(--accent,#1d6a4b) 14%,transparent)}' +
    '.svn-ic svg{width:20px;height:20px;display:block}' +
    '.svn-t{flex:1 1 240px;min-width:0;color:var(--ink-2,#4a5751)}' +
    '.svn-t b{color:var(--ink,#16201b);font-weight:600}' +
    '.svn-acts{display:flex;gap:8px;flex:none;margin-left:auto}' +
    '.svn-acts button{font:inherit;font-weight:600;font-size:14px;min-height:40px;padding:6px 16px;border-radius:8px;border:1px solid var(--line,#d3dad2);background:var(--panel-2,#f6f8f4);color:var(--ink,#16201b);cursor:pointer;white-space:nowrap}' +
    '.svn-acts button:hover{border-color:var(--ink-2,#4a5751)}' +
    '.svn-acts button[disabled]{opacity:.55;cursor:default}' +
    '.svn-acts .go{background:var(--accent,#1d6a4b);border-color:var(--accent,#1d6a4b);color:var(--accent-ink,#fff)}' +
    '.svn-acts .go:hover{filter:brightness(1.08)}' +
    '@media (max-width:560px){.svn-acts{width:100%;margin-left:0}.svn-acts button{flex:1 1 0}}' +
    '.svs{display:flex;align-items:center;gap:8px;min-height:20px;padding:0 2px;font-family:var(--mono,var(--f-m,monospace));font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2,#4a5751)}' +
    '.svs svg{width:14px;height:14px;flex:none}' +
    '.svs.err{color:var(--down,#b42318)}' +
    '.svt{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));transform:translateX(-50%) translateY(8px);z-index:9;max-width:min(440px,calc(100vw - 32px));' +
      'background:var(--ink,#16201b);color:var(--ground,var(--bg,#fff));border-radius:10px;padding:10px 14px;font-family:var(--body,var(--f-b,system-ui,sans-serif));font-size:14px;line-height:1.4;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;transition:opacity .25s,transform .25s;pointer-events:none}' +
    '.svt[data-on]{opacity:1;transform:translateX(-50%) translateY(0)}';
  document.head.appendChild(css);

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 9.5 3.5 3.5 0 0 1 18 18H7z"/></svg>';
  var TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 9.5 3.5 3.5 0 0 1 18 18H7z"/><path d="M9 13l2 2 4-4"/></svg>';

  // ---- The slot under the What's new strip ----
  var box = el('div'); box.id = 'acct-nudge';
  var A = null, card = null, status = null, toast = null, statusTimer = 0, toastTimer = 0;

  // Sit right under the What's new strip (which keeps itself right under the header), above the Party panel.
  function anchor() { return document.getElementById('news') || document.querySelector('header'); }
  function place() {
    var a = anchor();
    if (!a || !a.parentNode) return;
    if (box.previousElementSibling !== a || box.parentNode !== a.parentNode) a.parentNode.insertBefore(box, a.nextSibling);
  }

  function dismissed() { var d = +(store(DISMISS) || 0); return d > 0 && Date.now() - d < DAYS * 864e5; }

  function showCard() {
    if (card || dismissed()) return;
    hideStatus();
    card = el('div', 'svn'); card.setAttribute('role', 'region'); card.setAttribute('aria-label', 'Sign in to save your progress');
    var ic = el('span', 'svn-ic'); ic.innerHTML = ICON;
    var t = el('p', 'svn-t'); t.style.margin = '0';
    t.append(el('b', '', 'Sign in with Google'), ' to save your skins, records and settings across devices.');
    var acts = el('div', 'svn-acts');
    var go = el('button', 'go', 'Sign in'), no = el('button', '', 'Not now');
    go.type = 'button'; no.type = 'button';
    acts.append(go, no);
    card.append(ic, t, acts);
    box.appendChild(card);
    go.addEventListener('click', function () {
      if (!A) return;
      go.disabled = true;
      // The popup has to open from the click; account.js has the SDK ready by now (boot() resolved before the card showed).
      A.signIn().catch(function () {}).then(function () { if (go.isConnected) go.disabled = false; });
    });
    no.addEventListener('click', function () { store(DISMISS, String(Date.now())); hideCard(); });
  }
  function hideCard() { if (card) { card.remove(); card = null; } }

  function showStatus(text, err) {
    if (!status) { status = el('p', 'svs'); status.style.margin = '0'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); }
    status.innerHTML = (err ? ICON : TICK);
    status.appendChild(document.createTextNode(text));
    status.classList.toggle('err', !!err);
    if (!status.parentNode) box.appendChild(status);
  }
  function hideStatus() { if (status) { status.remove(); } clearTimeout(statusTimer); }
  function ago(ms) {
    var s = Math.round(ms / 1000);
    if (s < 45) return 'just now';
    var m = Math.round(s / 60); if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    var h = Math.round(m / 60); return h + (h === 1 ? ' hour ago' : ' hours ago');
  }
  function showSaved() {
    clearTimeout(statusTimer);
    if (!SY.on) return;
    showStatus('Saved to your account · ' + ago(Date.now() - SY.lastSave), false);
    statusTimer = setTimeout(showSaved, 30000);
  }
  function showToast(text) {
    if (!toast) { toast = el('div', 'svt'); toast.setAttribute('role', 'status'); document.body.appendChild(toast); }
    toast.textContent = text;
    clearTimeout(toastTimer);
    requestAnimationFrame(function () { toast.setAttribute('data-on', ''); });
    toastTimer = setTimeout(function () { toast.removeAttribute('data-on'); }, 6000);
  }

  // ---- The save ----
  var SY = { on: false, uid: '', user: null, conn: null, meta: null, timer: 0, poll: 0, busy: false, lastSave: 0, lastSig: '', restored: false, pending: null };

  function localKeys() {
    var out = [];
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (keyOk(k)) out.push(k); } } catch (e) {}
    return out;
  }
  function loadMeta(uid) {
    var m = json(store(META), null);
    if (!m || typeof m !== 'object' || m.u !== uid || !m.t || typeof m.t !== 'object' || !m.h || typeof m.h !== 'object') m = { u: uid, t: {}, h: {} };
    // Keep only whitelisted keys, on prototype-less maps, so nothing inherited can be mistaken for a saved key.
    var t = Object.create(null), h = Object.create(null);
    Object.keys(m.t).forEach(function (k) { if (keyOk(k) && +m.t[k] >= 0) t[k] = +m.t[k]; });
    Object.keys(m.h).forEach(function (k) { if (keyOk(k) && typeof m.h[k] === 'string') h[k] = m.h[k]; });
    return { u: uid, t: t, h: h };
  }
  function saveMeta() { if (SY.meta) store(META, JSON.stringify(SY.meta)); }
  // Stamp every key whose value differs from the hash saved at the last sync. Returns how many changed.
  // A key that was never synced for this account gets time 0 ("unknown"), so a saved copy wins over it.
  function noteLocal(now) {
    var m = SY.meta, seen = {}, n = 0;
    localKeys().forEach(function (k) {
      seen[k] = 1;
      var v = store(k); if (v == null) return;
      var h = hash(v);
      if (m.h[k] === h) return;
      m.t[k] = (m.h[k] == null && m.t[k] == null) ? 0 : now;
      m.h[k] = h; n++;
    });
    Object.keys(m.h).forEach(function (k) { if (!seen[k]) { delete m.h[k]; m.t[k] = now; n++; } });  // deleted here since the last sync
    return n;
  }
  // Everything the node says, checked: only whitelisted keys, string values within size, sane times.
  function cleanNode(v, now) {
    var d = Object.create(null), t = Object.create(null), bad = Object.create(null), size = 0;
    if (!v || typeof v !== 'object') return { d: d, t: t };
    var vd = v.d && typeof v.d === 'object' ? v.d : {}, vt = v.t && typeof v.t === 'object' ? v.t : {};
    Object.keys(vd).slice(0, MAX_KEYS * 2).forEach(function (ek) {
      var k = dec(ek), s = vd[ek];
      if (!keyOk(k)) return;
      if (typeof s !== 'string' || s.length > MAX_VAL || size + s.length > MAX_NODE) { bad[k] = 1; return; }
      size += s.length; d[k] = s;
    });
    Object.keys(vt).slice(0, MAX_KEYS * 2).forEach(function (ek) {
      var k = dec(ek), ms = +vt[ek];
      if (!keyOk(k) || bad[k] || !isFinite(ms) || !(ms > 0)) return;
      t[k] = Math.min(ms, now + 864e5);
    });
    return { d: d, t: t };
  }
  // Newest wins, key by key. Returns how many local values the account changed.
  function merge(remote, now) {
    var m = SY.meta, changed = 0, keys = {};
    Object.keys(m.t).concat(Object.keys(remote.t), Object.keys(remote.d), localKeys()).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var lv = store(k), rv = remote.d[k] == null ? null : remote.d[k];
      var lt = m.t[k], rt = remote.t[k];
      if (lt == null) lt = lv == null ? -1 : 0;           // nothing known locally; 0 = here but never synced
      if (rt == null) rt = rv == null ? -1 : 0;
      if (rt > lt || (rt === lt && lt === 0 && rv != null && rv !== lv)) {
        // The account's copy is newer (or this browser never synced this key): take it.
        if (rv == null) { if (lv != null) { store(k, null); changed++; } }
        else if (rv !== lv) { store(k, rv); changed++; }
        m.t[k] = rt > 0 ? rt : now; m.h[k] = rv == null ? null : hash(rv);
        if (m.h[k] == null) delete m.h[k];
      } else {
        // Ours stands. An unsynced key with no saved copy is uploaded as of now.
        if (lt <= 0 && lv != null) m.t[k] = now;
        if (lv == null && lt < 0) delete m.t[k];
        if (lv != null) m.h[k] = hash(lv); else delete m.h[k];
      }
    });
    return changed;
  }
  function myName() {
    var u = SY.user;
    return cleanName(store('ol:name')) || cleanName(store('party:name')) ||
      cleanName(((u && (u.displayName || u.email)) || '').split(/[\s@]/)[0]) || 'Player';
  }
  // The node as it should be now: every whitelisted key with a value, within the size caps.
  function buildNode(c) {
    var m = SY.meta, d = {}, t = {}, parts = [], size = 0;
    localKeys().forEach(function (k) {
      var v = store(k); if (v == null || v.length > MAX_VAL) return;
      parts.push({ k: k, v: v });
    });
    parts.sort(function (a, b) { return a.v.length - b.v.length; });      // smallest first, so big ones are the ones dropped
    parts.forEach(function (p) {
      if (Object.keys(d).length >= MAX_KEYS || size + p.v.length + p.k.length > MAX_NODE) return;
      size += p.v.length + p.k.length; d[enc(p.k)] = p.v;
    });
    Object.keys(m.t).forEach(function (k) {
      var ms = m.t[k];
      if (!(ms > 0)) return;
      if (store(k) == null || d[enc(k)] != null) t[enc(k)] = ms;        // tombstones and saved keys only
    });
    return { n: myName(), c: colorOf(c.uid), x: 0, z: 0, h: 0, ts: Math.round(c.now()), v: 1, d: d, t: t };
  }
  function write(c, force) {
    var nd = buildNode(c), sig = JSON.stringify([nd.d, nd.t, nd.n]);
    if (!force && sig === SY.lastSig) return Promise.resolve(false);
    SY.lastSig = sig;
    return c.db.ref(PATH + '/' + c.uid).set(JSON.parse(JSON.stringify(nd))).then(function () {
      SY.lastSave = Date.now(); saveMeta(); showSaved(); return true;
    }, function (e) { SY.lastSig = ''; showStatus('Couldn’t save to your account. It’ll try again.', true); throw e; });
  }

  function connect() {
    return waitFor(function () { return window.Party && window.Party.boot ? window.Party : null; }, 15000).then(function (P) {
      if (!P) throw new Error('no-party');
      return timeout(P.boot(), 20000).then(function (b) { return { db: b.db, uid: b.uid, now: P.now || Date.now }; });
    });
  }
  // Read the account's node, merge, write back. Once per sign-in.
  function sync() {
    if (SY.busy || !SY.on) return;
    SY.busy = true;
    var uid = SY.uid;
    connect().then(function (c) {
      if (!SY.on || SY.uid !== uid) return;
      if (c.uid !== uid) throw new Error('other-account');     // the panels are signed in as someone else: never write there
      SY.conn = c;
      return timeout(c.db.ref(PATH + '/' + uid).once('value'), 15000).then(function (s) {
        if (!SY.on || SY.uid !== uid) return;
        var now = c.now();
        noteLocal(now);
        var changed = merge(cleanNode(s.val(), now), now);
        saveMeta();
        if (changed > 0 && !SY.restored) { SY.restored = true; showToast('Restored your skins and records from your account'); }
        return write(c, true).then(function () { watch(); });
      });
    }).catch(function (e) {
      if (!SY.on) return;
      var why = e && e.message;
      if (why === 'other-account') showStatus('Account save is paused: the panels are signed in as someone else.', true);
      else if (why === 'no-party') showStatus('Account save needs the Party panel, which didn’t load.', true);
      else showStatus('Couldn’t reach your account save. Check your connection.', true);
    }).then(function () { SY.busy = false; });
  }
  // After the first sync: notice changes and write them, debounced.
  function check(now) {
    if (!SY.on || !SY.conn) return 0;
    var n = noteLocal(now || SY.conn.now());
    if (n) { saveMeta(); schedule(); }
    return n;
  }
  function schedule() {
    clearTimeout(SY.timer);
    SY.timer = setTimeout(function () { SY.timer = 0; flush(); }, DEBOUNCE);
  }
  function flush() {
    clearTimeout(SY.timer); SY.timer = 0;
    if (!SY.on || !SY.conn) return Promise.resolve(false);
    return write(SY.conn, false).catch(function () {});
  }
  function onStorage(e) { if (!e || e.key === null || keyOk(e.key)) check(); }
  function onHide() { if (document.visibilityState === 'hidden' || !document.visibilityState) { check(); flush(); } }
  function watch() {
    if (SY.poll) return;
    SY.poll = setInterval(function () { check(); }, POLL);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
  }
  function unwatch() {
    clearInterval(SY.poll); SY.poll = 0; clearTimeout(SY.timer); SY.timer = 0;
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
  }
  function startSave(u) {
    if (SY.on && SY.uid === u.uid) return;
    stopSave();
    SY.on = true; SY.uid = u.uid; SY.user = u; SY.meta = loadMeta(u.uid); SY.lastSig = ''; SY.restored = false;
    sync();
  }
  function stopSave() {
    unwatch();
    SY.on = false; SY.uid = ''; SY.user = null; SY.conn = null; SY.meta = null; SY.lastSig = '';
    hideStatus();
  }

  // ---- The leaderboard link ----
  var ANON = null, anonWatch = false;
  function watchAnon() {
    if (anonWatch) return;
    anonWatch = true;
    waitFor(function () { return window.Party && window.Party.boot ? window.Party : null; }, 15000).then(function (P) {
      if (!P) { anonWatch = false; return; }
      return P.boot().then(function (b) {
        var a = b.app && b.app.auth ? b.app.auth() : null; if (!a) return;
        var keep = function (u) { if (u && u.isAnonymous) ANON = u; };
        keep(a.currentUser); a.onAuthStateChanged(keep);
      });
    }).catch(function () { anonWatch = false; });
  }
  function statsLib() {
    if (window.BackRoomStatsLib) return Promise.resolve(window.BackRoomStatsLib);
    return new Promise(function (res) {
      var s = document.createElement('script'); s.src = '/e63334287a3deaa3/stats.js'; s.setAttribute('data-lib', '');
      s.onload = function () { res(window.BackRoomStatsLib || null); }; s.onerror = function () { res(null); };
      document.head.appendChild(s);
    });
  }
  function linkAnon(u) {
    var old = ANON; ANON = null;
    if (!old || old.uid === u.uid || !window.Party) return;
    statsLib().then(function (L) { return L && L.link(old, window.Party, u.uid); }).catch(function () {});
  }

  // ---- Wire it up ----
  function onUser(u) {
    if (u && u.uid && !u.isAnonymous) { hideCard(); startSave(u); linkAnon(u); }
    else { stopSave(); showCard(); watchAnon(); }
  }
  function start() {
    var head = document.querySelector('header');
    if (!head || !head.parentNode) return;
    place();
    if (window.MutationObserver) new MutationObserver(place).observe(head.parentNode, { childList: true });
    // account.js may load after this script (it sits at the end of the Back Room page), so give it a moment.
    waitFor(account, WAIT).then(function (acc) {
      if (!acc) return;                       // no sign-in on this page: nothing to show or save
      A = acc;
      A.onChange(onUser);
      A.boot().then(onUser, function () {});   // boot() only loads the SDK and reports who's signed in; it signs nobody in
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // Test hook for the automated checks; harmless in normal play.
  if (navigator.webdriver) window.__acctNudgeT = {
    PATH: PATH, KEYS: KEYS, PREFIXES: PREFIXES, keyOk: keyOk, enc: enc, dec: dec, hash: hash, cleanNode: cleanNode,
    get state() { return { on: SY.on, uid: SY.uid, busy: SY.busy, lastSave: SY.lastSave, restored: SY.restored, meta: SY.meta, conn: !!SY.conn }; },
    get card() { return !!card; }, get status() { return status && status.parentNode ? status.textContent : ''; },
    check: function () { return check(); }, flush: flush, sync: sync, onUser: onUser, stop: stopSave, place: place,
    get anon() { return ANON ? ANON.uid : ''; }, statsLib: statsLib,
    setLimits: function (v, n) { if (v) MAX_VAL = v; if (n) MAX_NODE = n; }
  };
})();
