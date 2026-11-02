/*
 * Checks the soccer games' data. Run from anywhere:  node e63334287a3deaa3/football-data/check.js
 * It loads players.js, kit.js and every game's puzzle file the way the browser does, then checks:
 *  - players: known clubs/nations/leagues, no duplicate names, sane years and numbers, careers in order,
 *    every name (with or without accents) and alias finds its player, e.g. "Mbappe" -> Kylian Mbappé
 *  - Deadline Day: each transfer matches the player's career, and no other listed player made the same move that year
 *  - Journeyman, Scout Report: enough puzzles, every career path unique
 *  - Crossbar: every square has at least 3 players, and the whole grid can be filled with 9 different players
 *  - Back Four: 16 different players, each fitting exactly one of the four links
 *  - Stat Duel: enough players per stat; Top Bins: no clashing spellings inside a list
 *  - Teamsheet: 11 starters matching the formation; names that look like a listed player use his exact spelling
 * Prints a summary; exits with code 1 if anything is wrong.
 */
'use strict';
var path = require('path');
var BR = path.join(__dirname, '..');
global.window = global;
if (typeof navigator === 'undefined') { try { global.navigator = {}; } catch (e) { } }
global.location = { search: '' };
require(path.join(BR, 'football-data/players.js'));
require(path.join(BR, 'football-data/kit.js'));
require(path.join(BR, 'football-data/cats.js'));
require(path.join(BR, 'deadline-day/transfers.js'));
require(path.join(BR, 'crossbar/grids.js'));
require(path.join(BR, 'back-four/puzzles.js'));
require(path.join(BR, 'top-bins/lists.js'));
require(path.join(BR, 'teamsheet/lineups.js'));
var F = window.FOOTBALL, K = window.FBK, C = window.FBCAT;
var errors = [], warns = [], info = [];
function err(m) { errors.push(m); }
function warn(m) { warns.push(m); }
var BY = {}; F.players.forEach(function (p) { BY[p.name] = p; });
function fold(s) { return K.norm(s); }

// ---------- players ----------
var seen = {};
F.players.forEach(function (p) {
  if (seen[p.name]) err('duplicate player ' + p.name); seen[p.name] = 1;
  if (!F.NATIONS[p.nat]) err(p.name + ': unknown nation ' + p.nat);
  if (['GK', 'DF', 'MF', 'FW'].indexOf(p.pos) < 0) err(p.name + ': bad position ' + p.pos);
  if (!(p.born >= 1920 && p.born <= 2010)) err(p.name + ': odd birth year ' + p.born);
  if (!(p.no >= 0 && p.no <= 99)) err(p.name + ': odd shirt number ' + p.no);
  if (!p.spells.length) err(p.name + ': no career');
  var lastFrom = 0;
  p.spells.forEach(function (s) {
    if (s.bad) { err(p.name + ': cannot read career part "' + s.bad + '"'); return; }
    if (!F.CLUBS[s.c]) err(p.name + ': unknown club ' + s.c);
    if (s.to != null && s.to < s.from) err(p.name + ': spell ends before it starts at ' + s.c);
    if (s.from < p.born + 14) err(p.name + ': first-team spell at ' + s.c + ' before age 14');
    if (s.from > 2025) err(p.name + ': spell after 2025 at ' + s.c);
    if (!s.loan && s.from < lastFrom) err(p.name + ': career out of order at ' + s.c);
    if (!s.loan) lastFrom = s.from;
  });
  var open = p.spells.filter(function (s) { return s.to == null; });
  if (open.length > 2) err(p.name + ': more than two open-ended spells');
  if (!F.CLUBS[p.main]) err(p.name + ': main club ' + p.main + ' unknown');
  else if (p.clubs.indexOf(p.main) < 0) err(p.name + ': main club ' + p.main + ' not in his career');
  p.wc.forEach(function (y) { if ([1958, 1962, 1966, 1970, 1974, 1978, 1982, 1986, 1990, 1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022].indexOf(y) < 0) err(p.name + ': World Cup year ' + y); if (y < p.born + 15) err(p.name + ': World Cup ' + y + ' too young'); });
  p.bdo.forEach(function (y) { if (y < 1956 || y > 2025) err(p.name + ": Ballon d'Or year " + y); });
  if (p.caps != null && !(p.caps > 0 && p.caps < 250)) err(p.name + ': odd caps ' + p.caps);
  if (p.ig != null && (p.caps == null || p.ig > p.caps * 1.3)) err(p.name + ': international goals without sensible caps');
  if (p.plg != null && p.leagues.indexOf('ENG') < 0) err(p.name + ': Premier League goals but never played in England');
  // Every name finds its player with accents stripped; every alias finds him or is shared (then the list asks to pick).
  if (K.resolvePlayer(fold(p.name)) !== p) err(p.name + ': typing the name does not find him');
  p.aliases.forEach(function (a) {
    var r = K.resolvePlayer(a);
    if (r && r !== p) err(p.name + ': alias "' + a + '" finds ' + r.name);
    if (!r) warn('alias "' + a + '" is shared (' + p.name + ' and someone else), so it shows a pick list');
  });
});
// Club-level checks
var BADWC = { 1966: 'ENG', 1970: 'BRA', 1974: 'GER', 1982: 'ITA', 1986: 'ARG', 1990: 'GER', 1994: 'BRA', 1998: 'FRA', 2002: 'BRA', 2006: 'ITA', 2010: 'ESP', 2014: 'GER', 2018: 'FRA', 2022: 'ARG', 1958: 'BRA', 1962: 'BRA' };
F.players.forEach(function (p) { p.wc.forEach(function (y) { if (BADWC[y] !== p.nat) err(p.name + ': World Cup ' + y + ' was won by ' + BADWC[y]); }); });
['Mbappe', 'mbappe', 'Ozil', 'Muller', 'Thomas Muller', 'Aguero', 'Kante', 'Odegaard', 'Gyokeres', 'Modric', 'Suarez', 'Pique', 'Vinicius', 'CR7', 'Zlatan', 'De Bruyne', 'van dijk', 'Salah', 'Haaland'].forEach(function (t) {
  if (!K.resolvePlayer(t)) err('"' + t + '" does not find a player');
});
info.push('players: ' + F.players.length + ' (' + F.players.filter(function (p) { return p.partial; }).length + ' with careers marked incomplete), clubs: ' + Object.keys(F.CLUBS).length);

// ---------- Deadline Day ----------
var tr = window.FB_TRANSFERS, trKeys = {};
tr.forEach(function (t) {
  var p = BY[t[0]], from = t[1], to = t[2], y = t[3];
  if (!p) { err('transfer: unknown player ' + t[0]); return; }
  if (!F.CLUBS[from] || !F.CLUBS[to]) err('transfer ' + t[0] + ': unknown club');
  var key = t.slice(0, 4).join('|'); if (trKeys[key]) err('duplicate transfer ' + key); trKeys[key] = 1;
  if (!/\S/.test(t[4] || '')) err('transfer ' + t[0] + ': no fee');
  var ti = -1, fi = -1;
  p.spells.forEach(function (s, i) { if (ti < 0 && s.c === to && s.from === y) ti = i; });
  p.spells.forEach(function (s, i) { if (s.c === from && s.from <= y && (s.to == null || s.to >= y - 1) && (i < ti)) fi = i; });
  if (ti < 0 || fi < 0) err('transfer ' + key + ' does not match ' + p.name + "'s career");
  // Nobody else listed joined the same club that year from the same club.
  F.players.forEach(function (q) {
    if (q === p) return;
    var a = q.spells.some(function (s, i) { return s.c === to && s.from === y && q.spells.slice(0, i).some(function (r) { return r.c === from && (r.to == null || r.to >= y - 1); }); });
    if (a) warn('transfer ' + key + ': ' + q.name + ' also went ' + from + ' to ' + to + ' around then; the fee shown tells them apart');
  });
});
info.push('Deadline Day: ' + tr.length + ' transfers (daily for ' + tr.length + ' days before any repeat)');

// ---------- Journeyman ----------
var sig = function (p) { return p.spells.map(function (s) { return (s.loan ? '~' : '') + s.c; }).join('>'); };
var sigs = {}; F.players.forEach(function (p) { var k = sig(p); sigs[k] = (sigs[k] || 0) + 1; });
var jm = F.players.filter(function (p) { return !p.partial && p.spells.length >= 4 && p.clubs.length >= 3 && sigs[sig(p)] === 1; });
if (jm.length < 60) err('Journeyman: only ' + jm.length + ' careers');
info.push('Journeyman: ' + jm.length + ' careers');

// ---------- Scout Report ----------
var sc = F.players.filter(function (p) { return p.no > 0 && p.main; });
if (sc.length < 60) err('Scout Report: only ' + sc.length + ' mystery players');
info.push('Scout Report: ' + sc.length + ' mystery players (every listed player can be guessed)');

// ---------- Crossbar ----------
var VALID_T = { c: 1, n: 1, l: 1, wc: 1, wy: 1, bdo: 1, d: 1, y: 1, p: 1 };
function catOk(id) {
  var a = C.parts(id), t = a[0], v = a[1];
  if (!VALID_T[t]) return false;
  if (t === 'c') return !!F.CLUBS[v]; if (t === 'n') return !!F.NATIONS[v]; if (t === 'l') return !!F.LEAGUES[v];
  return true;
}
function matching(cells) { // cells: arrays of player ids; can every cell get a different player?
  var owner = {};
  function aug(i, seenP) { for (var k = 0; k < cells[i].length; k++) { var pid = cells[i][k]; if (seenP[pid]) continue; seenP[pid] = 1; if (owner[pid] == null || aug(owner[pid], seenP)) { owner[pid] = i; return true; } } return false; }
  for (var i = 0; i < cells.length; i++) if (!aug(i, {})) return false;
  return true;
}
var minCell = 99, gk = {};
window.FB_GRIDS.forEach(function (g, gi) {
  var rows = g[0], cols = g[1], all = rows.concat(cols);
  if (rows.length !== 3 || cols.length !== 3) { err('grid ' + gi + ': not 3x3'); return; }
  all.forEach(function (id) { if (!catOk(id)) err('grid ' + gi + ': bad category ' + id); });
  if (new Set(all).size !== 6) err('grid ' + gi + ': repeated category');
  var key = all.slice().sort().join('|'); if (gk[key]) warn('grid ' + gi + ' repeats grid ' + gk[key]); gk[key] = gi;
  var cells = [];
  rows.forEach(function (r) { cols.forEach(function (c) { var ps = F.players.filter(function (p) { return C.test(p, r) && C.test(p, c); }).map(function (p) { return p.id; }); cells.push(ps); minCell = Math.min(minCell, ps.length); if (ps.length < 3) err('grid ' + gi + ': ' + r + ' x ' + c + ' has only ' + ps.length + ' players'); }); });
  if (!matching(cells)) err('grid ' + gi + ': cannot be filled with 9 different players');
});
info.push('Crossbar: ' + window.FB_GRIDS.length + ' grids, every square has at least ' + minCell + ' players, every grid fillable');

// ---------- Back Four ----------
var bk = {};
window.FB_BACKFOUR.forEach(function (pz, i) {
  if (pz.length !== 4) { err('back four ' + i + ': not 4 groups'); return; }
  var names = [], cats = pz.map(function (g) { return g[0]; });
  cats.forEach(function (id) { if (!catOk(id)) err('back four ' + i + ': bad link ' + id); });
  pz.forEach(function (g, gi) {
    if (g[1].length !== 4) err('back four ' + i + ': group ' + gi + ' has ' + g[1].length + ' names');
    g[1].forEach(function (n) {
      names.push(n); var p = BY[n];
      if (!p) { err('back four ' + i + ': unknown player ' + n); return; }
      if (p.partial) err('back four ' + i + ': ' + n + ' has an incomplete career');
      cats.forEach(function (id, ci) { var t = C.test(p, id); if (ci === gi && !t) err('back four ' + i + ': ' + n + ' does not fit ' + id); if (ci !== gi && t) err('back four ' + i + ': ' + n + ' also fits ' + id); });
    });
  });
  if (new Set(names).size !== 16) err('back four ' + i + ': repeated name');
  var key = cats.join('|'); if (bk[key]) warn('back four ' + i + ' repeats the links of ' + bk[key]); bk[key] = i;
});
info.push('Back Four: ' + window.FB_BACKFOUR.length + ' puzzles');

// ---------- Stat Duel ----------
['caps', 'ig', 'plg'].forEach(function (s) {
  var n = F.players.filter(function (p) { return p[s] != null; }).length;
  if (n < 20) err('Stat Duel: only ' + n + ' players with ' + s);
  info.push('Stat Duel: ' + n + ' players with ' + s);
});

// ---------- Top Bins ----------
window.FB_TOPLISTS.forEach(function (l, i) {
  if (!l.e.length || l.e.length > 10) err('top list ' + i + ': ' + l.e.length + ' entries');
  var terms = {};
  l.e.forEach(function (e) {
    var t = [K.norm(e[1])].concat(String(e[2] || '').split('|').filter(Boolean).map(K.norm));
    if (l.type === 'player') {
      var p = BY[e[1]];
      if (!p) { var r = K.resolvePlayer(e[1]); if (r) err('top list "' + l.t + '": "' + e[1] + '" should be spelled "' + r.name + '"'); else warn('top list "' + l.t + '": ' + e[1] + ' is not in players.js (accepted by its own spellings)'); }
      if (p) t = t.concat(p.terms);
    }
    t.forEach(function (x) { if (terms[x] && terms[x] !== e[1]) err('top list "' + l.t + '": "' + x + '" fits ' + terms[x] + ' and ' + e[1]); terms[x] = e[1]; });
  });
});
info.push('Top Bins: ' + window.FB_TOPLISTS.length + ' lists (the daily list repeats every ' + window.FB_TOPLISTS.length + ' days)');

// ---------- Teamsheet ----------
var tsPool = 0, folded = {}; F.players.forEach(function (p) { folded[K.norm(p.name)] = p; });
window.FB_LINEUPS.forEach(function (l, i) {
  var n = 0; l.rows.forEach(function (r) { n += r.length; });
  if (n !== 11) err('line-up ' + l.team + ' ' + l.year + ': ' + n + ' players');
  if (l.rows[0].length !== 1) err('line-up ' + l.team + ' ' + l.year + ': first row should be the goalkeeper');
  var fsum = l.f.split('-').map(Number).reduce(function (a, b) { return a + b; }, 0);
  if (fsum !== 10) err('line-up ' + l.team + ' ' + l.year + ': formation ' + l.f + ' is not 10 outfield players');
  var rowsF = l.f.split('-').map(Number), lens = l.rows.slice(1).map(function (r) { return r.length; });
  if (rowsF.join() !== lens.join()) err('line-up ' + l.team + ' ' + l.year + ': rows ' + lens.join('-') + ' do not match ' + l.f);
  if (l.club && !F.CLUBS[l.club]) err('line-up ' + l.team + ': unknown club ' + l.club);
  if (!l.club && !(l.c && l.c.length === 2)) err('line-up ' + l.team + ': no colours');
  l.rows.forEach(function (r) { r.forEach(function (nm) {
    if (BY[nm]) tsPool++;
    else if (folded[K.norm(nm)]) err('line-up ' + l.team + ' ' + l.year + ': write "' + folded[K.norm(nm)].name + '" exactly as in players.js');
  }); });
});
if (tsPool < 60) err('Teamsheet: only ' + tsPool + ' puzzles');
info.push('Teamsheet: ' + window.FB_LINEUPS.length + ' line-ups, ' + tsPool + ' puzzles (one hidden starter each)');

// ---------- Daily rotation ----------
[['deadline-day', tr.length], ['journeyman', jm.length], ['scout-report', sc.length], ['crossbar', window.FB_GRIDS.length], ['back-four', window.FB_BACKFOUR.length], ['top-bins', window.FB_TOPLISTS.length], ['teamsheet', tsPool]].forEach(function (g) {
  var used = {}, first = -1;
  for (var d = 0; d < 400; d++) { var k = K.addDays('20261101', d), ix = K.dailyIndex(g[1], g[0], k); if (used[ix] != null && first < 0) first = d; used[ix] = d; }
  if (first >= 0 && first < Math.min(g[1], 365)) err(g[0] + ': a daily puzzle repeats after ' + first + ' days');
});

console.log(info.join('\n'));
if (warns.length) console.log('\nNotes (' + warns.length + '):\n  ' + warns.join('\n  '));
if (errors.length) { console.log('\nPROBLEMS (' + errors.length + '):\n  ' + errors.join('\n  ')); process.exit(1); }
console.log('\nAll checks passed.');
