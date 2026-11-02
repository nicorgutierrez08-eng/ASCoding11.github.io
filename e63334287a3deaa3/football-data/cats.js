/*
 * Categories used by Crossbar (grid headers) and Back Four (group links). Loaded after players.js; sets window.FBCAT.
 * An id is "type:value":
 *   c:MUN   played for that club (any first-team spell, loans included)
 *   n:BRA   plays for that country
 *   l:ESP   played in that country's league (any club in it)
 *   wc      in a World Cup-winning squad (up to 2022)      wy:2010  in that year's World Cup-winning squad
 *   bdo     won the Ballon d'Or (up to 2025)
 *   d:1980  born in that decade                            y:1987   born in that year
 *   p:GK    plays in that position (GK, DF, MF, FW)
 * Everything is judged only against players.js, so a real player who isn't in the list can't be used.
 */
(function () {
  'use strict';
  var F = window.FOOTBALL;
  var POSN = { GK: 'Goalkeepers', DF: 'Defenders', MF: 'Midfielders', FW: 'Forwards' };
  function parts(id) { var i = id.indexOf(':'); return i < 0 ? [id, ''] : [id.slice(0, i), id.slice(i + 1)]; }
  function test(p, id) {
    var a = parts(id), t = a[0], v = a[1];
    switch (t) {
      case 'c': return p.clubs.indexOf(v) >= 0;
      case 'n': return p.nat === v;
      case 'l': return p.leagues.indexOf(v) >= 0;
      case 'wc': return p.wc.length > 0;
      case 'wy': return p.wc.indexOf(+v) >= 0;
      case 'bdo': return p.bdo.length > 0;
      case 'd': return p.born >= +v && p.born < +v + 10;
      case 'y': return p.born === +v;
      case 'p': return p.pos === v;
    }
    return false;
  }
  // Can a player's missing data ("+" in his career) hide a match? Only club and league facts can be incomplete.
  function unsure(p, id) { var t = parts(id)[0]; return p.partial && (t === 'c' || t === 'l'); }
  // [short label, kind] for headers; long() for group names.
  function label(id) {
    var a = parts(id), t = a[0], v = a[1];
    switch (t) {
      case 'c': return [(F.CLUBS[v] || [v])[0], 'Club'];
      case 'n': return [(F.NATIONS[v] || [v])[0], 'Nation'];
      case 'l': return ['Played in ' + (v === 'MLS' ? 'MLS' : F.LEAGUES[v]), 'League'];
      case 'wc': return ['World Cup winner', 'Up to 2022'];
      case 'wy': return [v + ' World Cup winner', 'Squad'];
      case 'bdo': return ["Ballon d'Or winner", 'Up to 2025'];
      case 'd': return ['Born in the ' + v + 's', 'Born'];
      case 'y': return ['Born in ' + v, 'Born'];
      case 'p': return [POSN[v] || v, 'Position'];
    }
    return [id, ''];
  }
  function long(id) {
    var a = parts(id), t = a[0], v = a[1];
    switch (t) {
      case 'c': return 'Played for ' + (F.CLUBS[v] || [v])[0];
      case 'n': return (F.NATIONS[v] || [v])[0] + ' internationals';
      case 'l': return v === 'MLS' ? 'Played in MLS' : 'Played in ' + F.LEAGUES[v];
      case 'wc': return 'World Cup winners';
      case 'wy': return 'Won the ' + v + ' World Cup';
      case 'bdo': return "Ballon d'Or winners";
      case 'y': return 'Born in ' + v;
      case 'd': return 'Born in the ' + v + 's';
      case 'p': return POSN[v] || v;
    }
    return id;
  }
  function players(id) { return F.players.filter(function (p) { return test(p, id); }); }
  window.FBCAT = { test: test, unsure: unsure, label: label, long: long, players: players, parts: parts };
})();
