/*
 * Name filter: keeps rude words out of the names players pick (game name boxes, team names, party and Online names).
 *
 *   <script src="/namefilter.js"></script>      (plain, not defer, high in <head>, so later scripts can use it)
 *
 * window.NameFilter.clean(name) returns the name to use:
 *   - a rude word at the start of a word is masked after its first letter, the same way social.js and leaderboard.js
 *     mask chat and names ("Fuckface" -> "F***face", "big_sh1t" -> "big_s***"), with the same look-alike digits and
 *     symbols counted as letters (0 o, 1 i, 3 e, 4 a, 5 s, 7 t, @ a, $ s, ! i, | l);
 *   - a name that hides one of the worst words some other way (spaced or dotted out, "f.u.c.k", "f u c k", stretched,
 *     "fuuuck", or inside another word, "xfuckx") becomes "Player";
 *   - anything else comes back exactly as it was, so clean names are never changed.
 * NameFilter.isBad(name) says whether clean() would change it.
 *
 * On its own it also cleans the name boxes on the page: inputs with the ids the games use (#name, #inName, #joinName,
 * #hostName, #newName for Quarry's world names, #ptyName for the Party panel) or a data-name-filter attribute. It cleans them when the page has
 * loaded (and again shortly after, for names a game fills in from saved settings), when a box loses focus or changes,
 * and on any click, Enter or form submit anywhere on the page *before* the game's own handlers run (capture phase),
 * so Play / Join / Host buttons always read a cleaned name. It doesn't clean while someone is typing.
 *
 * The words are stored in ROT13 (like social.js), so the file doesn't read as a list of swear words. To add one, add
 * its ROT13 form (each letter moved 13 places: a<->n, b<->o, ...). WORST words are also looked for hidden inside
 * names; ordinary words that contain one of them go in SAFE (plain text), so they still pass.
 */
(function () {
  'use strict';
  if (window.NameFilter) return;

  function rot(w) { return w.replace(/[a-z]/g, function (c) { return String.fromCharCode((c.charCodeAt(0) - 84) % 26 + 97); }); }
  // The same words as social.js and leaderboard.js, plus a few more for names.
  var WORDS = ['shpx', 'fuvg', 'ovgpu', 'phag', 'fyhg', 'juber', 'avtt', 'snttbg', 'ergneq', 'nffubyr', 'onfgneq', 'gjng', 'jnax',
    'zbgureshpx', 'cravf', 'intvan', 'cbea', 'encr', 'encvfg', 'uvgyre', 'xxx', 'qvyqb', 'fcrez', 'betnfz', 'pyvg',
    'qvpxurnq', 'pbpxfhpx', 'wvmm', 'unaqwbo', 'oybjwbo', 'uragnv', 'shx'].map(rot);
  var WORST = ['shpx', 'fuvg', 'avtt', 'snttbg', 'juber', 'ovgpu', 'zbgureshpx', 'cbea', 'encr', 'encvfg', 'uvgyre', 'pbpxfhpx', 'oybjwbo'].map(rot);
  var WORD_RE = new RegExp('(^|[^a-z])(' + WORDS.join('|') + ')[a-z]*', 'g');
  var LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'l' };

  function norm(s) {
    var low = s.toLowerCase(), out = '';
    for (var i = 0; i < low.length; i++) {
      var c = low.charAt(i);
      out += (c.length === s.charAt(i).length && LEET[c]) || c;
    }
    return out;
  }
  // Letters only, letters repeated three or more times squashed: "F.u.u.u.c k" -> "fuck". Doubles stay, so "Shiitake" is fine.
  function squash(n) { return n.replace(/[^a-z]/g, '').replace(/(.)\1{2,}/g, '$1'); }
  var WORST_SQ = WORST.map(squash);
  // Ordinary words that contain a WORST word; they're taken out before looking for hidden words (grapes, therapist).
  var SAFE = ['grape', 'drape', 'trapez', 'scrape', 'therap', 'parapet'];
  function unsafe(sq) { for (var i = 0; i < SAFE.length; i++) sq = sq.split(SAFE[i]).join('_'); return sq; }

  function clean(name) {
    if (name == null) return name;
    var s = String(name);
    if (!s) return s;
    var n = norm(s);
    var sq = unsafe(squash(n));
    for (var i = 0; i < WORST_SQ.length; i++) if (sq.indexOf(WORST_SQ[i]) !== -1) {
      // Masking can't cover a word spread across the name, so the whole name goes.
      var masked = mask(s, n);
      if (unsafe(squash(norm(masked))).indexOf(WORST_SQ[i]) !== -1 || masked === s) return 'Player';
    }
    return n.length === s.length ? mask(s, n) : s;
  }
  function mask(s, n) {
    if (n.length !== s.length) return s;
    var out = s, m; WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(n))) {
      var st = m.index + m[1].length, len = m[0].length - m[1].length;
      out = out.slice(0, st + 1) + new Array(len).join('*') + out.slice(st + len);
    }
    return out;
  }
  function isBad(name) { return name != null && clean(name) !== String(name); }

  window.NameFilter = { clean: clean, isBad: isBad };

  // ---- Name boxes on the page ----
  var SEL = '#name, #inName, #joinName, #hostName, #newName, #ptyName, input[data-name-filter]';
  function fix(inp) {
    if (!inp || inp.tagName !== 'INPUT' || !inp.value) return;
    var c = clean(inp.value);
    if (c === inp.value) return;
    inp.value = c.slice(0, inp.maxLength > 0 ? inp.maxLength : c.length);
    // Let the game see the new value (games that save the name on input/change save the clean one).
    try { inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
  }
  function fixAll() { var l = document.querySelectorAll(SEL); for (var i = 0; i < l.length; i++) fix(l[i]); }
  function onKey(e) { if (e.key === 'Enter') fixAll(); }
  document.addEventListener('click', fixAll, true);
  document.addEventListener('pointerdown', fixAll, true);
  document.addEventListener('submit', fixAll, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('focusout', function (e) { if (e.target && e.target.matches && e.target.matches(SEL)) fix(e.target); }, true);
  document.addEventListener('change', function (e) { if (e.target && e.target.matches && e.target.matches(SEL)) fix(e.target); }, true);
  function boot() { fixAll(); setTimeout(fixAll, 300); setTimeout(fixAll, 1500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
