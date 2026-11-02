/*
 * In-game party chat for the Back Room's multiplayer games.
 *
 * Each game loads it with one line in its <head>:
 *   <script src="/e63334287a3deaa3/gamechat.js" defer></script>
 * and a game that already uses T gives another key by its e.code: data-key="Enter" (or "KeyY", ...). A game with its own
 * HUD along the left edge moves the feed right with data-left="<px>".
 *
 * It does nothing at all unless the game is open inside a Back Room page (the home page's game layer, the phone page or
 * party.js's own layer) whose Online panel (social.js) offers window.BackRoomChat, and the player is in a party with at
 * least one other person. Then:
 *   - messages from the party show as a small feed at the left that fades after a few seconds and never takes clicks;
 *   - T (or the game's key) opens a box to type in, Enter sends, Esc or a click outside closes it; the Chat button that
 *     social.js puts in the game's top bar opens the same box (that's the way in on a phone).
 * Everything goes through social.js (window.parent.BackRoomChat): the party chat's encryption, block, mute, word filter
 * and rate limit are all there, so this file never touches Firebase and only shows what that page already checked.
 *
 * Keeping the game out of the way while typing:
 *   - the keys the game thinks are held (and mouse buttons) get a keyup / mouseup first, so nobody keeps running;
 *   - while the box is open every key event stops here (a capture listener on window, added after the game's own
 *     listeners, so only keybinds.js's capture listener runs before it, and that one only acts while its own panel is
 *     open); typing still works because only propagation is stopped, not the key's default action;
 *   - pointer lock is let go so the mouse can be used, and taken back when the box closes. The game isn't told about
 *     that unlock (its pointerlockchange is held back), so it doesn't pop up its pause menu; if the browser won't give the
 *     lock back (Esc isn't a user gesture), the game is then told the mouse is free and shows its own "click to play";
 *   - a see-through layer covers the game while the box is open, so a stray click or tap doesn't shoot or steer, and
 *     tapping it closes the box.
 * The key isn't taken when the player has moved one of the game's own actions onto it in the game's Controls panel
 * (keybinds.js), or while they're typing in one of the game's own fields; the top-bar Chat button still works then.
 * Nothing is stored: the feed is rebuilt from social.js's copy each time the game opens.
 */
(function () {
  'use strict';
  if (window.BackRoomGameChat || window.parent === window) return;

  var me = document.currentScript;
  var KEY = (me && me.getAttribute('data-key')) || 'KeyT';
  var KEY_NAME = KEY === 'Enter' ? 'Enter' : KEY === 'Slash' ? '/' : KEY === 'Backquote' ? '`' : KEY.replace(/^Key|^Digit/, '');
  var FRESH = 9000, SHOW_CLOSED = 5, SHOW_OPEN = 12, TEXT_MAX = 200;

  function host() { try { var h = window.parent.BackRoomChat; return h && h.v >= 1 ? h : null; } catch (e) { return null; } }
  function touchy() { return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches; }

  // ---------------- Box (in a shadow root, so the game's CSS can't reach it and ours can't reach the game) ----------------
  var hostEl = document.createElement('div');
  hostEl.id = 'bk-gamechat';
  hostEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483600;display:none';
  var root = hostEl.attachShadow ? hostEl.attachShadow({ mode: 'open' }) : hostEl;
  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '.w{position:fixed;inset:0;pointer-events:none;font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;-webkit-text-size-adjust:100%}' +
    '.sh{position:absolute;inset:0;pointer-events:auto;display:none;background:rgba(0,0,0,.08);cursor:default;touch-action:none}' +
    '.open .sh{display:block}' +
    '.bx{position:absolute;left:calc(10px + env(safe-area-inset-left,0px));top:clamp(48px,30%,280px);width:min(360px,calc(100% - 20px));display:flex;flex-direction:column;gap:4px}' +
    '@media (max-height:500px){.bx{top:clamp(44px,22%,120px);width:min(320px,calc(100% - 20px))}}' +
    '.fd{display:flex;flex-direction:column;gap:3px;align-items:flex-start;min-width:0}' +
    '.ln{background:rgba(8,12,18,.66);border-radius:8px;padding:3px 9px;max-width:100%;overflow-wrap:anywhere;text-shadow:0 1px 1px rgba(0,0,0,.7);opacity:1;transition:opacity .8s}' +
    '.ln.old{opacity:0}.open .ln.old{opacity:1}.open .ln{background:rgba(8,12,18,.88)}' +
    '.ln b{font-weight:700;margin-right:5px}.ln.sys{color:#d7dee8;font-style:italic}.ln.err{color:#ffc2b8}' +
    'form{display:none;pointer-events:auto;align-items:center;gap:6px;background:rgba(8,12,18,.9);border:1px solid rgba(255,255,255,.3);border-radius:10px;padding:4px 4px 4px 9px;box-shadow:0 6px 18px rgba(0,0,0,.35)}' +
    '.open form{display:flex}' +
    'form span{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9fd8b8;flex:none}' +
    'input{flex:1;min-width:0;font:inherit;font-size:16px;color:#fff;background:transparent;border:0;outline:0;padding:5px 2px;margin:0}' +
    'input::placeholder{color:#aab4c0}' +
    'button{font:inherit;font-size:13px;font-weight:700;color:#0b1016;background:#e8edf3;border:0;border-radius:7px;min-height:32px;padding:4px 11px;cursor:pointer;flex:none}' +
    'button.x{background:transparent;color:#cfd6df;font-size:20px;line-height:1;padding:2px 9px}' +
    'button[disabled]{opacity:.5}' +
    '</style>' +
    '<div class="w"><div class="sh"></div><div class="bx">' +
    '<form autocomplete="off"><span>Party</span><input type="text" maxlength="' + TEXT_MAX + '" enterkeyhint="send" aria-label="Message your party" spellcheck="true"><button type="submit">Send</button><button type="button" class="x" aria-label="Close chat">×</button></form>' +
    '<div class="fd" role="log" aria-live="polite" aria-label="Party chat"></div></div></div>';
  // data-left="<px>" moves the feed right, for a game with its own HUD along the left edge (Spire's progress bar).
  var LEFT = Math.max(0, Math.min(240, parseInt(me && me.getAttribute('data-left'), 10) || 0));
  if (LEFT) { var bx0 = root.querySelector('.bx'); bx0.style.left = 'calc(' + LEFT + 'px + env(safe-area-inset-left,0px))'; bx0.style.width = 'min(360px,calc(100% - ' + (LEFT + 10) + 'px))'; }
  var wrap = root.querySelector('.w'), shield = root.querySelector('.sh'), form = root.querySelector('form');
  var input = root.querySelector('input'), sendB = root.querySelector('button[type=submit]'), closeB = root.querySelector('.x'), feed = root.querySelector('.fd');

  // ---------------- State ----------------
  var H = null, on = false, party = '', open = false, unlisten = null;
  var lines = [];                  // { id, t (when it arrived here), sys, err, name, color, x }
  var hinted = false, held = {}, mouseHeld = {};
  var lockEl = null, holdUnlock = false, relocking = null;

  function addLine(l) {
    if (l.id && lines.some(function (o) { return o.id === l.id; })) return;
    l.t = l.t || Date.now(); lines.push(l);
    if (lines.length > 40) lines.splice(0, lines.length - 40);
    draw();
  }
  function fromMsg(m, fresh) { return { id: 'm:' + m.u + ':' + m.id, t: fresh ? Date.now() : 1, name: m.mine ? 'You' : m.name, color: m.color, x: m.x, mine: m.mine }; }
  var tick = 0;
  function draw() {
    var now = Date.now(), max = open ? SHOW_OPEN : SHOW_CLOSED;
    // Short screens (a phone on its side) get fewer lines, so the box never runs off the bottom.
    var room = Math.floor((innerHeight - feed.getBoundingClientRect().top - 12) / 26);
    if (room > 0) max = Math.max(2, Math.min(max, room));
    var show = lines.filter(function (l) { return open ? !l.sys || now - l.t < FRESH : now - l.t < FRESH + 1000; }).slice(-max);
    feed.textContent = '';
    show.forEach(function (l) {
      var d = document.createElement('div');
      d.className = 'ln' + (l.sys ? ' sys' : '') + (l.err ? ' err' : '') + (now - l.t > FRESH ? ' old' : '');
      if (l.name) { var b = document.createElement('b'); b.textContent = l.name; b.style.color = lighten(l.color); d.appendChild(b); }
      d.appendChild(document.createTextNode(l.x));
      feed.appendChild(d);
    });
    clearTimeout(tick);
    var next = lines.filter(function (l) { return now - l.t < FRESH + 1000; }).length;
    if (next) tick = setTimeout(draw, 1000);
  }
  // Names in the player's colour, brightened so a dark colour still reads on the dark line.
  function lighten(c) {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ''); if (!m) return '#9fd8b8';
    return 'rgb(' + [m[1], m[2], m[3]].map(function (h) { var v = parseInt(h, 16); return Math.round(v + (255 - v) * 0.55); }).join(',') + ')';
  }

  // ---------------- Is there a party to talk to? ----------------
  function check() {
    var h = host(), st = null;
    try { st = h && h.state(); } catch (e) { st = null; }
    var want = !!(st && st.party && st.mates > 0);
    if (want && (!on || h !== H || st.party !== party)) start(h, st.party);
    else if (!want && on) stop();
  }
  function start(h, code) {
    stop();
    H = h; on = true; party = code; hostEl.style.display = '';
    if (!hostEl.isConnected) (document.body || document.documentElement).appendChild(hostEl);
    try { (H.recent(SHOW_OPEN) || []).forEach(function (m) { lines.push(fromMsg(m, false)); }); } catch (e) {}
    try {
      unlisten = H.listen(function (m) {
        if (!on || document.hidden) return false;
        addLine(fromMsg(m, true));
        return true;
      });
    } catch (e) { unlisten = null; }
    if (!hinted) {
      hinted = true;
      addLine({ sys: true, x: touchy() ? 'Party chat: tap Chat at the top to talk to your party.' : 'Party chat: press ' + KEY_NAME + ' to talk to your party.' });
    }
    draw();
  }
  function stop() {
    if (open) closeBox(true);
    if (unlisten) { try { unlisten(); } catch (e) {} }
    unlisten = null; on = false; party = ''; H = null; lines = [];
    hostEl.style.display = 'none'; draw();
  }
  setInterval(check, 1000);
  check();
  addEventListener('pagehide', function () { if (unlisten) { try { unlisten(); } catch (e) {} unlisten = null; } });
  addEventListener('pageshow', function (e) { if (e.persisted) { on = false; check(); } });

  // ---------------- Opening and closing ----------------
  // Tell the game that every key and mouse button it saw go down has come back up, before we start holding keys back.
  function releaseAll() {
    Object.keys(held).forEach(function (c) {
      var k = held[c], ev;
      try {
        ev = new KeyboardEvent('keyup', { key: k.key, code: c, bubbles: true, cancelable: true });
        try { Object.defineProperty(ev, 'keyCode', { value: k.keyCode }); Object.defineProperty(ev, 'which', { value: k.keyCode }); } catch (e) {}
        (k.target && k.target.isConnected ? k.target : document).dispatchEvent(ev);
      } catch (e) {}
    });
    held = {};
    Object.keys(mouseHeld).forEach(function (b) {
      var t = mouseHeld[b];
      try { (t && t.isConnected ? t : document).dispatchEvent(new MouseEvent('mouseup', { button: +b, bubbles: true, cancelable: true })); } catch (e) {}
    });
    mouseHeld = {};
  }
  function openBox() {
    if (!on || !H) return false;
    if (open) { input.focus(); return true; }
    releaseAll();
    lockEl = document.pointerLockElement || null;
    // (the hold is dropped after 5 s at the latest, so a later Esc in the game is never swallowed by mistake)
    if (lockEl) { holdUnlock = true; setTimeout(function () { holdUnlock = false; }, 5000); try { document.exitPointerLock(); } catch (e) { holdUnlock = false; } }
    open = true; wrap.classList.add('open');
    var why = ''; try { why = H.state().why || ''; } catch (e) {}
    input.placeholder = why || 'Message your party';
    draw();
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    return true;
  }
  // Close the box; give the pointer lock back unless told not to (the game's gone, say).
  function closeBox(noLock) {
    if (!open) return;
    open = false; wrap.classList.remove('open');
    try { input.blur(); } catch (e) {}
    var el = lockEl; lockEl = null;
    if (document.pointerLockElement) holdUnlock = false;
    if (el && !noLock) relock(el);
    else if (el) tellUnlocked();
    draw();
    try { window.focus(); } catch (e) {}
  }
  // Ask for the lock again. A refusal (the promise, or pointerlockerror in browsers without one) tells the game; no timers,
  // because a busy game can take a while to get the lock and an early "you're unlocked" would leave it paused.
  function relock(el) {
    if (!el.isConnected) return tellUnlocked();
    var me = relocking = { el: el, done: false };
    var r; try { r = el.requestPointerLock(); } catch (e) { r = null; return failLock(me); }
    if (r && r.then) r.then(function () { me.done = true; }, function () { failLock(me); });
  }
  function failLock(me) { if (me.done) return; me.done = true; if (document.pointerLockElement !== me.el) tellUnlocked(); }
  // The lock couldn't be taken back: now let the game see that the mouse is free, so it shows its own pause or "click to play".
  function tellUnlocked() { holdUnlock = false; if (document.pointerLockElement) return; try { document.dispatchEvent(new Event('pointerlockchange')); } catch (e) {} }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var x = String(input.value || '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
    if (!x) { closeBox(false); return; }
    if (!H) return;
    var h = H;
    // Close straight away (Enter is a user gesture, so the pointer lock can come back now); a refusal shows in the feed
    // and the text stays in the box for the next try.
    input.value = '';
    closeBox(false);
    var p; try { p = h.send(x); } catch (err) { p = Promise.reject(err); }
    Promise.resolve(p).then(null, function (err) {
      input.value = x;
      addLine({ sys: true, err: true, x: 'Not sent: ' + ((err && err.message) || 'try again') + ' Press ' + KEY_NAME + ' to try again.' });
    });
  });
  closeB.addEventListener('click', function (e) { e.preventDefault(); closeBox(false); });
  // The see-through layer: nothing under it gets the click or tap, which closes the box (and, being a click, can take the lock back).
  ['pointerdown', 'mousedown'].forEach(function (t) {
    shield.addEventListener(t, function (e) { e.preventDefault(); e.stopPropagation(); if (open) closeBox(false); });
  });
  ['pointerup', 'pointermove', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove', 'touchend'].forEach(function (t) {
    shield.addEventListener(t, function (e) { e.stopPropagation(); if (e.cancelable && (t === 'contextmenu' || t === 'touchstart')) e.preventDefault(); }, { passive: false });
  });
  // Typing in the box mustn't bubble out as input/change/key events the game might read.
  ['input', 'change', 'keydown', 'keyup', 'keypress', 'focus', 'blur'].forEach(function (t) { input.addEventListener(t, function (e) { e.stopPropagation(); }); });
  // Focus going somewhere else (the game grabbing it, another window) closes the box.
  input.addEventListener('blur', function () { setTimeout(function () { if (open && (document.activeElement !== hostEl || !document.hasFocus())) closeBox(false); }, 0); });

  // ---------------- Keys ----------------
  function editable(t) {
    if (!t || t === hostEl) return false;
    var tag = (t.tagName || '').toUpperCase();
    return tag === 'INPUT' && !/^(range|checkbox|radio|button|submit)$/i.test(t.type || '') || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  }
  // The player has moved one of the game's own actions onto this key (keybinds.js saves changed bindings as
  // localStorage keybinds:<game folder> = { v: 1, b: { action: [codes] } }): leave the key to the game then.
  var GAME = (location.pathname.match(/\/([a-z0-9-]+)\/(?:index\.html)?$/) || [])[1] || '';
  function gameUses(code) {
    try {
      var s = JSON.parse(localStorage.getItem('keybinds:' + GAME) || 'null'), b = s && s.b;
      if (!b || typeof b !== 'object') return false;
      return Object.keys(b).some(function (k) { return Array.isArray(b[k]) && b[k].indexOf(code) >= 0; });
    } catch (e) { return false; }
  }
  addEventListener('keydown', function (e) {
    if (open) {
      e.stopImmediatePropagation();
      if (e.key === 'Escape' || e.code === 'Escape') { e.preventDefault(); closeBox(false); }
      return;
    }
    if (e.isTrusted) held[e.code] = { key: e.key, keyCode: e.keyCode, target: e.target };
    if (!on || e.code !== KEY || e.repeat || e.ctrlKey || e.metaKey || e.altKey || editable(e.target) || gameUses(KEY)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    delete held[e.code];
    openBox();
  }, true);
  addEventListener('keyup', function (e) { delete held[e.code]; if (open) e.stopImmediatePropagation(); }, true);
  addEventListener('keypress', function (e) { if (open) e.stopImmediatePropagation(); }, true);
  addEventListener('mousedown', function (e) { if (e.isTrusted && !open) mouseHeld[e.button] = e.target; }, true);
  addEventListener('mouseup', function (e) { if (e.isTrusted) delete mouseHeld[e.button]; }, true);
  addEventListener('blur', function () { held = {}; mouseHeld = {}; });
  // Hold back the game's own pointerlockchange for the unlock we asked for, and the error if taking it back fails.
  addEventListener('pointerlockchange', function (e) {
    if (!e.isTrusted) return;
    if (document.pointerLockElement) { holdUnlock = false; if (relocking) relocking.done = true; return; }
    if (holdUnlock) { holdUnlock = false; e.stopImmediatePropagation(); }
  }, true);
  addEventListener('pointerlockerror', function (e) {
    if (relocking && !relocking.done) { e.stopImmediatePropagation(); failLock(relocking); }
  }, true);
  // A game that goes full screen on one of its own elements would hide the feed: follow it in.
  document.addEventListener('fullscreenchange', function () {
    var f = document.fullscreenElement, to = f && f.tagName !== 'CANVAS' && f.tagName !== 'VIDEO' && f !== document.documentElement ? f : document.body;
    if (to && hostEl.parentNode !== to && hostEl.isConnected) to.appendChild(hostEl);
  });
  addEventListener('resize', function () { if (on) draw(); });

  // For social.js's Chat button in the game's top bar.
  window.BackRoomGameChat = { open: function () { check(); return openBox(); }, get active() { return on; }, get isOpen() { return open; }, key: KEY };
})();
