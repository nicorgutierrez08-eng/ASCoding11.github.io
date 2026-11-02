/*
 * Poopdle's word-ladder engine. Load after words.js. Works in the browser (window.Ladder) and in Node (module.exports)
 * for the validation script.
 *   Ladder.isWord(w), Ladder.isCommon(w), Ladder.neighbours(w)   words one letter apart
 *   Ladder.from(target)  -> {all: {word: steps}, common: {word: steps}}  shortest distances to the target, over every
 *                           word and over everyday words only (cached per target)
 *   Ladder.starts(target, min, max)  everyday words whose shortest ladder to the target has min..max steps and can be
 *                           done with everyday words only (so par never needs a rare word)
 *   Ladder.daily(n)       the start word for daily puzzle #n (target POOP)
 *   Ladder.next(word, target)  the best next words on a shortest ladder (everyday words first), Ladder.path(word, target)
 *   Ladder.randomPair(r)  a random target and start for Unlimited's "any word" mode
 */
(function (root) {
  'use strict';
  var W = root.POOPDLE_WORDS || (typeof require === 'function' ? require('./words.js') : null);
  var split = function (s) { return String(s || '').trim().split(/\s+/).filter(Boolean); };
  var COMMON = split(W.common), RARE = split(W.rare), ALL = COMMON.concat(RARE).sort();
  var isC = {}, isW = {};
  COMMON.forEach(function (w) { isC[w] = 1; isW[w] = 1; });
  RARE.forEach(function (w) { isW[w] = 1; });
  // words one letter apart share a pattern like "p_op"
  var bucket = {};
  ALL.forEach(function (w) { for (var i = 0; i < 4; i++) { var k = w.slice(0, i) + '_' + w.slice(i + 1); (bucket[k] || (bucket[k] = [])).push(w); } });
  var nbCache = {};
  function neighbours(w) {
    if (nbCache[w]) return nbCache[w];
    var out = [];
    for (var i = 0; i < 4; i++) { var b = bucket[w.slice(0, i) + '_' + w.slice(i + 1)] || []; for (var j = 0; j < b.length; j++) if (b[j] !== w) out.push(b[j]); }
    return (nbCache[w] = out.sort());
  }
  function bfs(t, onlyCommon) {
    var d = {}; d[t] = 0; var q = [t];
    for (var i = 0; i < q.length; i++) {
      var w = q[i], nb = neighbours(w);
      for (var j = 0; j < nb.length; j++) { var x = nb[j]; if (x in d || (onlyCommon && !isC[x])) continue; d[x] = d[w] + 1; q.push(x); }
    }
    return d;
  }
  var distCache = {};
  function from(t) { return distCache[t] || (distCache[t] = { all: bfs(t, false), common: bfs(t, true) }); }
  function starts(t, min, max) {
    var D = from(t);
    return COMMON.filter(function (w) { var d = D.all[w]; return d >= min && d <= max && D.common[w] === d; });
  }
  // ------------------------------------------------------------------ the daily start word
  var TARGET = 'poop', MIN = 4, MAX = 8;
  function hash(s) { var x = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function rng(seed) { var a = typeof seed === 'number' ? seed >>> 0 : hash(String(seed)); return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(a, r) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  var pool = null, orders = {};
  function dailyPool() { return pool || (pool = starts(TARGET, MIN, MAX)); }
  // The start words go round the pool in a shuffled order (a new shuffle each time round, never the same word twice in a row).
  function cycle(c) {
    if (orders[c]) return orders[c];
    var o = shuffle(dailyPool(), rng('poopdle-cycle-' + c));
    if (c > 0) { var prev = cycle(c - 1); if (o[0] === prev[prev.length - 1]) { var t = o[0]; o[0] = o[1]; o[1] = t; } }
    return (orders[c] = o);
  }
  function daily(n) {
    var P = dailyPool(), L = P.length, i = Math.max(0, n - 1), c = Math.floor(i / L);
    return cycle(c)[i - c * L];
  }
  // ------------------------------------------------------------------ hints and answers
  function next(w, t) {
    var D = from(t), d = D.all[w];
    if (d == null || d === 0) return [];
    var nb = neighbours(w).filter(function (x) { return D.all[x] === d - 1; });
    var score = function (x) { return (D.common[x] === d - 1 || x === t) ? 0 : isC[x] ? 1 : 2; };
    return nb.sort(function (a, b) { return score(a) - score(b) || (a < b ? -1 : 1); });
  }
  function path(w, t) {
    var out = [w], guard = 0;
    while (w !== t && guard++ < 40) { var n = next(w, t); if (!n.length) return null; w = n[0]; out.push(w); }
    return w === t ? out : null;
  }
  // Unlimited "any word": a random everyday target with at least a few start words 4 to 7 steps away.
  function randomPair(r) {
    for (var k = 0; k < 60; k++) {
      var t = COMMON[Math.floor(r() * COMMON.length)];
      if (neighbours(t).length < 2) continue;
      var s = starts(t, MIN, 7);
      if (s.length < 5) continue;
      return { target: t, start: s[Math.floor(r() * s.length)] };
    }
    var p = dailyPool(); return { target: TARGET, start: p[Math.floor(r() * p.length)] };
  }
  var API = {
    TARGET: TARGET, MIN: MIN, MAX: MAX, COMMON: COMMON, RARE: RARE, ALL: ALL,
    isWord: function (w) { return !!isW[w]; }, isCommon: function (w) { return !!isC[w]; },
    neighbours: neighbours, from: from, starts: starts, dailyPool: dailyPool, daily: daily, next: next, path: path,
    randomPair: randomPair, rng: rng, hash: hash, shuffle: shuffle
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Ladder = API;
})(this);
