/*
 * Ninefold's puzzle engine: a seeded sudoku generator, a fast checker for unique solutions, and a step-by-step
 * solver that uses the same techniques a person would, so it can grade puzzles and explain hints.
 * No libraries. Works in the browser (window.Sudoku) and in Node (module.exports) for the validation script.
 *
 * Grids are arrays of 81 numbers, row by row, 0 = empty. Candidates are 9-bit masks (bit d-1 set = d still fits).
 * Techniques and tiers:
 *   1 (Easy)    naked single, hidden single
 *   2 (Medium)  pointing, box/line, naked pair, hidden pair, naked triple, hidden triple
 *   3 (Hard)    X-Wing, XY-Wing, Swordfish, XYZ-Wing, naked quad, hidden quad
 * A puzzle's level is the hardest tier the solver needs, always trying the easiest technique first. Anything the
 * solver can't finish with these is never used, so every puzzle has one solution and every hint has a reason.
 */
(function (root) {
  'use strict';
  var ROW = [], COL = [], BOX = [], UNITS = [], PEERS = [], UNIT_OF = [];
  (function () {
    var r, c, i;
    for (r = 0; r < 9; r++) { ROW.push([]); COL.push([]); BOX.push([]); }
    for (i = 0; i < 81; i++) {
      r = Math.floor(i / 9); c = i % 9;
      ROW[r].push(i); COL[c].push(i); BOX[Math.floor(r / 3) * 3 + Math.floor(c / 3)].push(i);
    }
    for (i = 0; i < 9; i++) UNITS.push({ kind: 'row', n: i, cells: ROW[i] });
    for (i = 0; i < 9; i++) UNITS.push({ kind: 'col', n: i, cells: COL[i] });
    for (i = 0; i < 9; i++) UNITS.push({ kind: 'box', n: i, cells: BOX[i] });
    for (i = 0; i < 81; i++) {
      r = Math.floor(i / 9); c = i % 9;
      var b = Math.floor(r / 3) * 3 + Math.floor(c / 3), set = {};
      ROW[r].concat(COL[c], BOX[b]).forEach(function (x) { if (x !== i) set[x] = 1; });
      PEERS.push(Object.keys(set).map(Number));
      UNIT_OF.push([r, 9 + c, 18 + b]);
    }
  })();
  var ALL = 511;
  var POP = new Uint8Array(512);
  for (var m = 1; m < 512; m++) POP[m] = POP[m >> 1] + (m & 1);
  function digits(mask) { var out = []; for (var d = 1; d <= 9; d++) if (mask & (1 << (d - 1))) out.push(d); return out; }
  function rowOf(i) { return Math.floor(i / 9); }
  function colOf(i) { return i % 9; }
  function boxOf(i) { return Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3); }
  function sees(a, b) { return a !== b && (rowOf(a) === rowOf(b) || colOf(a) === colOf(b) || boxOf(a) === boxOf(b)); }

  // ------------------------------------------------------------------ seeded random numbers (same as the geography games)
  function hash(s) { var x = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function rng(seed) {
    var a = typeof seed === 'number' ? seed >>> 0 : hash(String(seed));
    return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffle(a, r) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ------------------------------------------------------------------ brute force: count solutions (stops at limit)
  function countSolutions(grid, limit, out) {
    limit = limit || 2;
    var g = grid.slice(), rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9), count = 0, i;
    for (i = 0; i < 81; i++) if (g[i]) {
      var bit = 1 << (g[i] - 1), r = rowOf(i), c = colOf(i), b = boxOf(i);
      if ((rows[r] | cols[c] | boxes[b]) & bit) return 0;
      rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
    }
    function go() {
      var best = -1, bestMask = 0, bestN = 10;
      for (var i = 0; i < 81; i++) if (!g[i]) {
        var mk = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]), n = POP[mk];
        if (n < bestN) { bestN = n; best = i; bestMask = mk; if (n <= 1) break; }
      }
      if (best < 0) { count++; if (out && count === 1) for (var k = 0; k < 81; k++) out[k] = g[k]; return count >= limit; }
      if (!bestN) return false;
      var r = rowOf(best), c = colOf(best), b = boxOf(best);
      for (var d = 0; d < 9; d++) {
        var bit = 1 << d; if (!(bestMask & bit)) continue;
        g[best] = d + 1; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
        if (go()) return true;
        rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit; g[best] = 0;
      }
      return false;
    }
    go();
    return count;
  }
  function solve(grid) { var out = new Array(81); return countSolutions(grid, 1, out) ? out : null; }

  // A full, random, valid grid.
  function fullGrid(r) {
    var g = new Array(81).fill(0), rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
    function go() {
      var best = -1, bestMask = 0, bestN = 10;
      for (var i = 0; i < 81; i++) if (!g[i]) {
        var mk = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]), n = POP[mk];
        if (n < bestN) { bestN = n; best = i; bestMask = mk; if (n <= 1) break; }
      }
      if (best < 0) return true;
      if (!bestN) return false;
      var ds = shuffle(digits(bestMask), r), rr = rowOf(best), c = colOf(best), b = boxOf(best);
      for (var k = 0; k < ds.length; k++) {
        var bit = 1 << (ds[k] - 1);
        g[best] = ds[k]; rows[rr] |= bit; cols[c] |= bit; boxes[b] |= bit;
        if (go()) return true;
        rows[rr] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit; g[best] = 0;
      }
      return false;
    }
    go();
    return g;
  }

  // ------------------------------------------------------------------ the human-style solver
  function State(grid) {
    this.v = grid.slice();
    this.c = new Int32Array(81);
    for (var i = 0; i < 81; i++) this.c[i] = this.v[i] ? 0 : ALL;
    for (i = 0; i < 81; i++) if (this.v[i]) this.clearPeers(i, this.v[i]);
  }
  State.prototype.clearPeers = function (i, d) {
    var bit = ~(1 << (d - 1)), p = PEERS[i];
    for (var k = 0; k < p.length; k++) this.c[p[k]] &= bit;
  };
  State.prototype.place = function (i, d) { this.v[i] = d; this.c[i] = 0; this.clearPeers(i, d); };
  State.prototype.empty = function () { var n = 0; for (var i = 0; i < 81; i++) if (!this.v[i]) n++; return n; };
  State.prototype.broken = function () { for (var i = 0; i < 81; i++) if (!this.v[i] && !this.c[i]) return true; return false; };

  function unitName(u) { return u.kind === 'row' ? 'row ' + (u.n + 1) : u.kind === 'col' ? 'column ' + (u.n + 1) : 'box ' + (u.n + 1); }
  function cellName(i) { return 'r' + (rowOf(i) + 1) + 'c' + (colOf(i) + 1); }
  function list(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function orList(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' or ' + a[a.length - 1]; }

  // Each technique returns null or a step: {t: name, tier, place: [cell, digit]} or {t, tier, elim: [[cell, mask], ...]},
  // plus cells (the pattern), unit(s) and why (a sentence) for hints.
  var T = {};
  T.nakedSingle = function (s) {
    for (var i = 0; i < 81; i++) if (!s.v[i] && POP[s.c[i]] === 1) {
      var d = digits(s.c[i])[0], others = [];
      for (var x = 1; x <= 9; x++) if (x !== d) others.push(x);
      return { t: 'Naked single', tier: 1, place: [i, d], cells: [i], units: UNIT_OF[i],
        why: 'Every other number (' + list(others) + ') is already in this cell\'s row, column or box, so ' + cellName(i) + ' can only be ' + d + '.' };
    }
    return null;
  };
  var HS_ORDER = [18, 19, 20, 21, 22, 23, 24, 25, 26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]; // boxes first: easiest to spot
  T.hiddenSingle = function (s) {
    for (var k = 0; k < 27; k++) {
      var u = UNITS[HS_ORDER[k]];
      for (var d = 1; d <= 9; d++) {
        var bit = 1 << (d - 1), at = -1, n = 0, placed = false;
        for (var j = 0; j < 9; j++) { var i = u.cells[j]; if (s.v[i] === d) { placed = true; break; } if (!s.v[i] && (s.c[i] & bit)) { n++; at = i; } }
        if (!placed && n === 1) return { t: 'Hidden single', tier: 1, place: [at, d], cells: [at], units: [HS_ORDER[k]],
          why: 'In ' + unitName(u) + ', ' + cellName(at) + ' is the only cell where a ' + d + ' can go.' };
      }
    }
    return null;
  };
  function cellsWith(s, cells, bit) { var out = []; for (var j = 0; j < cells.length; j++) if (!s.v[cells[j]] && (s.c[cells[j]] & bit)) out.push(cells[j]); return out; }
  function elimFrom(s, cells, mask, keep) {
    var out = [];
    for (var j = 0; j < cells.length; j++) { var i = cells[j]; if (keep.indexOf(i) >= 0 || s.v[i]) continue; var e = s.c[i] & mask; if (e) out.push([i, e]); }
    return out;
  }
  T.pointing = function (s) {
    for (var b = 0; b < 9; b++) for (var d = 1; d <= 9; d++) {
      var bit = 1 << (d - 1), cs = cellsWith(s, BOX[b], bit);
      if (cs.length < 2) continue;
      var r = rowOf(cs[0]), c = colOf(cs[0]), sameR = true, sameC = true;
      for (var j = 1; j < cs.length; j++) { if (rowOf(cs[j]) !== r) sameR = false; if (colOf(cs[j]) !== c) sameC = false; }
      var line = sameR ? UNITS[r] : sameC ? UNITS[9 + c] : null;
      if (!line) continue;
      var el = elimFrom(s, line.cells, bit, cs);
      if (el.length) return { t: 'Pointing', tier: 2, elim: el, cells: cs, units: [18 + b, sameR ? r : 9 + c], digit: d,
        why: 'In box ' + (b + 1) + ', every spot left for ' + d + ' is in ' + unitName(line) + ', so the ' + d + ' for that ' + line.kind.replace('col', 'column') + ' must be inside the box. No other cell of ' + unitName(line) + ' can be ' + d + '.' };
    }
    return null;
  };
  T.boxLine = function (s) {
    for (var k = 0; k < 18; k++) {
      var u = UNITS[k];
      for (var d = 1; d <= 9; d++) {
        var bit = 1 << (d - 1), cs = cellsWith(s, u.cells, bit);
        if (cs.length < 2) continue;
        var b = boxOf(cs[0]), same = true;
        for (var j = 1; j < cs.length; j++) if (boxOf(cs[j]) !== b) { same = false; break; }
        if (!same) continue;
        var el = elimFrom(s, BOX[b], bit, cs);
        if (el.length) return { t: 'Box/line', tier: 2, elim: el, cells: cs, units: [k, 18 + b], digit: d,
          why: 'In ' + unitName(u) + ', every spot left for ' + d + ' is inside box ' + (b + 1) + ', so that box\'s ' + d + ' must be in ' + unitName(u) + '. No other cell of box ' + (b + 1) + ' can be ' + d + '.' };
      }
    }
    return null;
  };
  function combos(arr, k, fn) { // calls fn(combo) for every k-subset; stops when fn returns true
    var idx = []; for (var i = 0; i < k; i++) idx.push(i);
    if (arr.length < k) return false;
    for (;;) {
      if (fn(idx.map(function (j) { return arr[j]; }))) return true;
      var p = k - 1; while (p >= 0 && idx[p] === arr.length - k + p) p--;
      if (p < 0) return false;
      idx[p]++; for (var q = p + 1; q < k; q++) idx[q] = idx[q - 1] + 1;
    }
  }
  var SETNAME = { 2: 'pair', 3: 'triple', 4: 'quad' };
  function nakedSet(k, tier) {
    return function (s) {
      var found = null;
      for (var ui = 0; ui < 27 && !found; ui++) {
        var u = UNITS[ui], open = u.cells.filter(function (i) { return !s.v[i] && POP[s.c[i]] >= 2 && POP[s.c[i]] <= k; });
        if (open.length < k) continue;
        combos(open, k, function (cs) {
          var mk = 0; for (var j = 0; j < cs.length; j++) mk |= s.c[cs[j]];
          if (POP[mk] !== k) return false;
          var el = elimFrom(s, u.cells, mk, cs);
          if (!el.length) return false;
          var ds = digits(mk);
          found = { t: 'Naked ' + SETNAME[k], tier: tier, elim: el, cells: cs, units: [ui], digits: ds,
            why: list(cs.map(cellName)) + ' can only hold ' + orList(ds) + ' between them, so those ' + k + ' numbers belong to those ' + k + ' cells. No other cell of ' + unitName(u) + ' can be ' + orList(ds) + '.' };
          return true;
        });
      }
      return found;
    };
  }
  function hiddenSet(k, tier) {
    return function (s) {
      var found = null;
      for (var ui = 0; ui < 27 && !found; ui++) {
        var u = UNITS[ui], where = {}, ds = [];
        for (var d = 1; d <= 9; d++) {
          var cs = cellsWith(s, u.cells, 1 << (d - 1));
          if (cs.length >= 1 && cs.length <= k) { where[d] = cs; ds.push(d); }
        }
        if (ds.length < k) continue;
        combos(ds, k, function (dd) {
          var cellSet = {}, mk = 0;
          dd.forEach(function (d) { mk |= 1 << (d - 1); where[d].forEach(function (i) { cellSet[i] = 1; }); });
          var cs = Object.keys(cellSet).map(Number);
          if (cs.length !== k) return false;
          var el = [];
          cs.forEach(function (i) { var e = s.c[i] & ~mk; if (e) el.push([i, e]); });
          if (!el.length) return false;
          found = { t: 'Hidden ' + SETNAME[k], tier: tier, elim: el, cells: cs, units: [ui], digits: dd,
            why: 'In ' + unitName(u) + ', ' + list(dd) + ' only fit in ' + list(cs.map(cellName)) + ', so those cells must hold ' + list(dd) + ' and nothing else.' };
          return true;
        });
      }
      return found;
    };
  }
  function fish(size, tier, name) {
    return function (s) {
      for (var d = 1; d <= 9; d++) {
        var bit = 1 << (d - 1);
        for (var dir = 0; dir < 2; dir++) { // 0: base rows, cover columns; 1: base columns, cover rows
          var base = [], spots = {};
          for (var n = 0; n < 9; n++) {
            var cs = cellsWith(s, UNITS[dir * 9 + n].cells, bit);
            if (cs.length >= 2 && cs.length <= size) { base.push(n); spots[n] = cs; }
          }
          var found = null;
          combos(base, size, function (ns) {
            var cover = {}, all = [];
            ns.forEach(function (n) { spots[n].forEach(function (i) { cover[dir ? rowOf(i) : colOf(i)] = 1; all.push(i); }); });
            var cv = Object.keys(cover).map(Number);
            if (cv.length !== size) return false;
            var el = [];
            cv.forEach(function (m) { el = el.concat(elimFrom(s, UNITS[(1 - dir) * 9 + m].cells, bit, all)); });
            if (!el.length) return false;
            var bn = dir ? 'columns' : 'rows', cn = dir ? 'rows' : 'columns';
            found = { t: name, tier: tier, elim: el, cells: all, units: ns.map(function (n) { return dir * 9 + n; }), digit: d,
              why: 'In ' + bn + ' ' + list(ns.map(function (n) { return n + 1; })) + ', the ' + d + 's can only go in ' + cn + ' ' + list(cv.map(function (m) { return m + 1; })) + '. Those ' + bn + ' need ' + size + ' different spots in just ' + size + ' ' + cn + ', so the ' + d + 's of those ' + cn + ' are used up: no other cell in them can be ' + d + '.' };
            return true;
          });
          if (found) return found;
        }
      }
      return null;
    };
  }
  T.xyWing = function (s) {
    for (var p = 0; p < 81; p++) {
      if (s.v[p] || POP[s.c[p]] !== 2) continue;
      var ab = digits(s.c[p]), a = ab[0], b = ab[1], P = PEERS[p];
      for (var i = 0; i < P.length; i++) {
        var x = P[i]; if (s.v[x] || POP[s.c[x]] !== 2 || !(s.c[x] & (1 << (a - 1))) || (s.c[x] & (1 << (b - 1)))) continue;
        var cbit = s.c[x] & ~(1 << (a - 1)); // pincer x = {a, c}
        for (var j = 0; j < P.length; j++) {
          var y = P[j]; if (y === x || s.v[y] || s.c[y] !== ((1 << (b - 1)) | cbit)) continue; // pincer y = {b, c}
          var el = [];
          for (var q = 0; q < 81; q++) if (q !== p && q !== x && q !== y && !s.v[q] && (s.c[q] & cbit) && sees(q, x) && sees(q, y)) el.push([q, cbit]);
          if (el.length) {
            var c = digits(cbit)[0];
            return { t: 'XY-Wing', tier: 3, elim: el, cells: [p, x, y], units: [], digit: c,
              why: cellName(p) + ' is ' + a + ' or ' + b + '. If it\'s ' + a + ', ' + cellName(x) + ' must be ' + c + '; if it\'s ' + b + ', ' + cellName(y) + ' must be ' + c + '. One of them is ' + c + ' either way, so no cell that shares a row, column or box with both of them can be ' + c + '.' };
          }
        }
      }
    }
    return null;
  };
  T.xyzWing = function (s) {
    for (var p = 0; p < 81; p++) {
      if (s.v[p] || POP[s.c[p]] !== 3) continue;
      var P = PEERS[p], pm = s.c[p];
      var pin = P.filter(function (x) { return !s.v[x] && POP[s.c[x]] === 2 && (s.c[x] & pm) === s.c[x]; });
      for (var i = 0; i < pin.length; i++) for (var j = i + 1; j < pin.length; j++) {
        var x = pin[i], y = pin[j];
        if (s.c[x] === s.c[y] || POP[s.c[x] | s.c[y]] !== 3) continue;
        var cbit = s.c[x] & s.c[y];
        if (POP[cbit] !== 1) continue;
        var el = [];
        for (var q = 0; q < 81; q++) if (q !== p && q !== x && q !== y && !s.v[q] && (s.c[q] & cbit) && sees(q, p) && sees(q, x) && sees(q, y)) el.push([q, cbit]);
        if (el.length) {
          var c = digits(cbit)[0];
          return { t: 'XYZ-Wing', tier: 3, elim: el, cells: [p, x, y], units: [], digit: c,
            why: cellName(p) + ' is ' + orList(digits(pm)) + ', ' + cellName(x) + ' is ' + orList(digits(s.c[x])) + ' and ' + cellName(y) + ' is ' + orList(digits(s.c[y])) + '. However you fill them, one of the three is ' + c + ', so no cell that shares a row, column or box with all three can be ' + c + '.' };
        }
      }
    }
    return null;
  };
  T.nakedPair = nakedSet(2, 2); T.hiddenPair = hiddenSet(2, 2);
  T.nakedTriple = nakedSet(3, 2); T.hiddenTriple = hiddenSet(3, 2);
  T.nakedQuad = nakedSet(4, 3); T.hiddenQuad = hiddenSet(4, 3);
  T.xWing = fish(2, 3, 'X-Wing'); T.swordfish = fish(3, 3, 'Swordfish');
  var ORDER = [
    ['nakedSingle', 1], ['hiddenSingle', 1],
    ['pointing', 2], ['boxLine', 2], ['nakedPair', 2], ['hiddenPair', 2], ['nakedTriple', 2], ['hiddenTriple', 2],
    ['xWing', 3], ['xyWing', 3], ['swordfish', 3], ['xyzWing', 3], ['nakedQuad', 3], ['hiddenQuad', 3]
  ];
  function nextStep(s, maxTier) {
    for (var k = 0; k < ORDER.length; k++) {
      if (ORDER[k][1] > maxTier) break;
      var st = T[ORDER[k][0]](s);
      if (st) return st;
    }
    return null;
  }
  function apply(s, st) {
    if (st.place) s.place(st.place[0], st.place[1]);
    else st.elim.forEach(function (e) { s.c[e[0]] &= ~e[1]; });
  }
  // Solve as a person would, up to maxTier. -> {solved, tier (hardest used), used: {technique: count}, steps}
  function rate(grid, maxTier) {
    var s = new State(grid), tier = 0, used = {}, steps = 0;
    maxTier = maxTier || 3;
    if (s.broken()) return { solved: false, tier: 0, used: used, steps: 0 };
    while (s.empty()) {
      var st = nextStep(s, maxTier);
      if (!st) return { solved: false, tier: tier, used: used, steps: steps };
      apply(s, st); steps++;
      if (st.tier > tier) tier = st.tier;
      used[st.t] = (used[st.t] || 0) + 1;
      if (s.broken()) return { solved: false, tier: tier, used: used, steps: steps };
    }
    return { solved: true, tier: tier, used: used, steps: steps };
  }
  // A hint for the board as it is now (only correct digits on it): the steps up to and including the next placement.
  // -> {place: [cell, digit], steps: [the technique steps used, last one places], tier} or null if stuck
  function hint(grid) {
    var s = new State(grid), steps = [];
    if (s.broken()) return null;
    for (var guard = 0; guard < 200 && s.empty(); guard++) {
      var st = nextStep(s, 3);
      if (!st) return null;
      steps.push(st);
      if (st.place) return { place: st.place, steps: steps };
      apply(s, st);
    }
    return null;
  }

  // ------------------------------------------------------------------ making puzzles
  var LEVELS = ['easy', 'medium', 'hard'];
  var TIER = { easy: 1, medium: 2, hard: 3 };
  var FLOOR = { easy: 36, medium: 26, hard: 0 }; // stop taking clues away at this many (Easy stays friendly)
  // One attempt: a random full grid, then clues removed in symmetric pairs (cell i and 80 - i) in random order, keeping
  // each removal only while the person-style solver can still finish using techniques up to the level's tier.
  function attempt(r, level) {
    var sol = fullGrid(r), g = sol.slice(), tier = TIER[level], floor = FLOOR[level], clues = 81;
    var order = []; for (var i = 0; i <= 40; i++) order.push(i);
    order = shuffle(order, r);
    for (var k = 0; k < order.length; k++) {
      var a = order[k], b = 80 - a, n = a === b ? 1 : 2;
      if (clues - n < floor) continue;
      var va = g[a], vb = g[b];
      g[a] = 0; g[b] = 0;
      if (countSolutions(g, 2) === 1 && rate(g, tier).solved) clues -= n; // the quick check first: no point grading a puzzle with two answers
      else { g[a] = va; g[b] = vb; }
    }
    return { puzzle: g, solution: sol, clues: clues };
  }
  // The puzzle for a seed and level. Deterministic: the same seed gives the same puzzle on every device.
  function make(seed, level, maxTries) {
    var tier = TIER[level], best = null;
    maxTries = maxTries || 400;
    for (var t = 0; t < maxTries; t++) {
      var r = rng(seed + '/' + level + '/' + t), a = attempt(r, level), rt = rate(a.puzzle, tier);
      if (!rt.solved) continue; // can't happen, but never hand out a puzzle the solver can't finish
      if (rt.tier === tier) { a.tier = rt.tier; a.used = rt.used; a.tries = t + 1; a.seed = seed; a.level = level; return a; }
      if (!best || rt.tier > best.tier) { best = a; best.tier = rt.tier; best.used = rt.used; }
    }
    best.tries = maxTries; best.seed = seed; best.level = level;
    return best;
  }
  function toStr(g) { return g.map(function (d) { return d || '.'; }).join(''); }
  function fromStr(s) { var g = []; for (var i = 0; i < 81; i++) { var ch = s.charAt(i); g.push(ch >= '1' && ch <= '9' ? +ch : 0); } return g; }

  var API = {
    LEVELS: LEVELS, TIER: TIER, FLOOR: FLOOR, ROW: ROW, COL: COL, BOX: BOX, PEERS: PEERS, UNITS: UNITS, UNIT_OF: UNIT_OF,
    rowOf: rowOf, colOf: colOf, boxOf: boxOf, digits: digits, POP: POP, cellName: cellName, unitName: unitName,
    hash: hash, rng: rng, shuffle: shuffle, countSolutions: countSolutions, solve: solve, fullGrid: fullGrid,
    State: State, rate: rate, hint: hint, nextStep: nextStep, make: make, toStr: toStr, fromStr: fromStr, techniques: ORDER
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Sudoku = API;
})(this);
