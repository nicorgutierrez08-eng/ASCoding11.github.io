/*
 * Back Room Leaderboards: hours played across all games, and each game's own boards (Elo, kills, best single rounds,
 * Slipstream course records and fastest laps per track…).
 *
 * Loaded like feedback.js: a <script defer> in the <head> of the Back Room page and the phone page, and by the home
 * page's reveal(). It adds a "Leaderboards" section under the games and reads nothing until that section is near the
 * screen (or someone picks a board), then reads rooms/lb-all/players once (Refresh reads it again).
 *
 * The data is written by stats.js inside each game: rooms/lb-all/players/<uid> =
 *   { n, c, x, z, h, ts, v: 1 or 2, st, g: { <game folder>: { s: seconds played, <stat>: number } }, … }
 * (v 2 adds q, lg, al and to; see stats.js). One person, two accounts: an anonymous account whose owner merged it into a
 * Google account says so in its own node (to: <uid>), and the Google node lists it (al: { <uid>: ms }) once it has taken
 * its hours in. Only when both agree is the anonymous entry left out (so nobody can hide someone else's); the admin page
 * can also merge two entries it judges to be one person (a signed `a`, below), which shows them as one row: per game the
 * larger hours and the better bests.
 * Every value is self-reported by the player's own browser, so everything is checked here before it's shown:
 * nodes that are too big, too old, from the future or the wrong shape are skipped, play time can't exceed 24 hours for
 * every day since the boards started (EPOCH), counts can't grow faster than RATE allows for the time played in that game,
 * each stat has a sane range (Elo 100–3000, a lap no quicker than its track allows, and so on), a best single round can't
 * beat the all-time count it's part of (le), and a course record can't beat that track's fastest lap times the laps. Names are cleaned and
 * always shown as text. It signs in through party.js (window.Party), so "You" is the same person as in the panels above.
 *
 * To add a board for a game: give the game a row in GAMES (folder, name, and its stats: key, label, format, unit, range,
 * for running counts a RATE per second played, for a best single round the all-time count it can't exceed), and make
 * sure stats.js publishes that key (README: stats.js).
 *
 * The admin page (d06440218d1813a3/) reads the same nodes and loads this file with data-lib: it then only exposes the
 * checks, the games table and the formatters as window.BackRoomBoards and adds nothing to the page.
 *
 * Hours resets: the admin page can set someone's play time back to zero. Totals only ever grow (stats.js adds each device's
 * new seconds and never lowers a total), so a reset is a zero point instead: the seconds each game had at that moment, which are
 * subtracted from then on. Resets live at rooms/lb-rs/players/<the admin's uid> as { n, c, x, z, h, ts, v: 1, r, sig },
 * where r is the JSON of { <uid>: { t: when, b: { <game folder>: seconds }, h: 1, a: <uid> } } (no b: no reset; h: 1, the account is
 * removed from the boards altogether, for fake or junk accounts; a: the same person as that account, shown as one row with it)
 * and sig is
 * an ECDSA P-256 / SHA-256 signature of r by the admin key (adminkey.js; the same key pair as the ECDH one there). Anyone
 * can write a node there, so only nodes whose signature checks out count; for each uid the latest t wins.
 * Renames show live: social.js and party.js fire `backroom:name` ({ uid, n, mine }) when you rename yourself or when
 * someone's Online name changes, and the row for that uid takes the new name (cleaned and masked like any other) without
 * a new read. Your own rename also fixes n on your entry (social.js), so the next read has it too.
 * Rows show each player's avatar (avatar.js) and status tier badge (miles.js, worked out from the same checked node)
 * when those scripts are here.
 */
(function () {
  'use strict';
  var me = document.currentScript;
  if (document.getElementById('leaderboards')) return;

  var PATH = 'rooms/lb-all/players', RS_PATH = 'rooms/lb-rs/players', RESETS = {}, SHOW_HIDDEN = false;
  // STALE: an entry nobody has updated for 180 days is skipped before anything else is read from it (entries are never
  // removed from the database, so this is what keeps old ones cheap to parse: a timestamp check, no JSON.stringify or
  // stats; they are still downloaded).
  var TOP = 25, MAX_NODES = 3000, NODE_MAX = 8000, MAX_STATS = 120, STALE = 180 * 86400000;
  var EPOCH = Date.UTC(2026, 9, 21);            // the day stats.js started counting
  var NAME_MAX = 14;

  // Stat formats: n (a count), elo, time (seconds to the millisecond, lower wins), dur (seconds, higher wins), m (metres), days, chips.
  // low: 1 ranks a count lowest first (fewest guesses); the key must be in stats.js's LOWER too, so devices merge to the smaller.
  // u: the unit a count is shown with ('kill' → '12 kills'). lo/hi: the sane range (anything outside is dropped).
  // rate: most per second played in that game (running counts only; rateOf: 'daily' uses the seconds of every game in the
  // Daily Puzzles group together). le: a best single round, which can't be more than
  // this all-time count (and is dropped without it). hide: checked and kept (the admin page shows it) but not a board.
  // kd: a ratio worked out here from two checked counts, kills / max(1, deaths) to 2 decimals and at most `hi`, ranked
  // only with at least `min` kills; the node's own kd is never read. Its kills are `kdkills`, counted from the same
  // moment as deaths (so kills from before deaths were counted can't inflate it), and no more than the all-time count.
  // Boards show in this order, after Hours.
  var GAMES = [
    { d: 'rumble-karts', n: 'Rumble Karts', st: [
      { k: 'rwrecks', l: 'Most wrecks in a round', f: 'n', u: 'wreck', hi: 60, le: 'wrecks' },
      { k: 'wrecks', l: 'Wrecks (all time)', f: 'n', u: 'wreck', rate: 0.5 },
      { k: 'kdkills', l: 'Wrecks counted for K/D', f: 'n', u: 'wreck', rate: 0.5, le: 'wrecks', hide: true },
      { k: 'deaths', l: 'Times wrecked', f: 'n', u: 'time', rate: 0.5, hide: true },
      { k: 'kd', l: 'K/D (all time)', chip: 'K/D', f: 'kd', kd: ['kdkills', 'deaths'], min: 20, hi: 100 },
      { k: 'wins', l: 'Round wins', f: 'n', u: 'win', rate: 1 / 60 }] },
    { d: 'shell-crackers', n: 'Shell Crackers', st: [
      { k: 'elo', l: 'Elo', f: 'elo', lo: 100, hi: 3000 },
      { k: 'mkills', l: 'Most kills in a match', f: 'n', u: 'kill', hi: 30, le: 'kills' },
      { k: 'kills', l: 'Kills (all time)', f: 'n', u: 'kill', rate: 0.5 },
      { k: 'kdkills', l: 'Kills counted for K/D', f: 'n', u: 'kill', rate: 0.5, le: 'kills', hide: true },
      { k: 'deaths', l: 'Deaths', f: 'n', u: 'death', rate: 0.5, hide: true },
      { k: 'kd', l: 'K/D (all time)', chip: 'K/D', f: 'kd', kd: ['kdkills', 'deaths'], min: 20, hi: 100 }] },
    { d: 'backrooms-1v1', n: 'Backrooms 1v1–4v4', st: [
      { k: 'mkills', l: 'Most kills in a match', f: 'n', u: 'kill', hi: 80, le: 'kills' },
      { k: 'kills', l: 'Kills (all time)', f: 'n', u: 'kill', rate: 0.5 },
      { k: 'kdkills', l: 'Kills counted for K/D', f: 'n', u: 'kill', rate: 0.5, le: 'kills', hide: true },
      { k: 'deaths', l: 'Deaths', f: 'n', u: 'death', rate: 0.5, hide: true },
      { k: 'kd', l: 'K/D (all time)', chip: 'K/D', f: 'kd', kd: ['kdkills', 'deaths'], min: 20, hi: 100 },
      { k: 'wins', l: 'Match wins', f: 'n', u: 'win', rate: 1 / 20 }] },
    { d: 'slipstream', n: 'Slipstream', laps: true, st: [] },
    { d: 'boostball', n: 'Boostball', st: [
      { k: 'mgoals', l: 'Most goals in a match', f: 'n', u: 'goal', hi: 40, le: 'goals' },
      { k: 'goals', l: 'Goals (all time)', f: 'n', u: 'goal', rate: 0.2 },
      { k: 'wins', l: 'Match wins', f: 'n', u: 'win', rate: 1 / 30 }] },
    { d: 'coil', n: 'Coil', st: [{ k: 'best', l: 'Longest snake', f: 'n', hi: 100000 }, { k: 'kills', l: 'Cut-offs (all time)', f: 'n', u: 'cut-off', rate: 0.5 }] },
    { d: 'trivium', n: 'Trivium', st: [{ k: 'daily', l: 'Best Daily score', f: 'n', u: 'pt', hi: 20000 }, { k: 'streak', l: 'Best Daily streak', f: 'days', hi: 3650 }] },
    { d: 'showdown', n: 'Showdown', st: [{ k: 'pot', l: 'Biggest pot (practice)', f: 'chips', hi: 1e7 }, { k: 'hands', l: 'Hands played (practice)', f: 'n', u: 'hand', hi: 1e7 }] },
    { d: 'chromaflage', n: 'Chromaflage', st: [
      { k: 'rfound', l: 'Most hiders found in a round', f: 'n', u: 'hider', hi: 7, le: 'found' },
      { k: 'found', l: 'Hiders found (all time)', f: 'n', u: 'hider', rate: 0.2 },
      { k: 'hidden', l: 'Rounds stayed hidden', f: 'n', u: 'round', rate: 1 / 20 }] },
    { d: 'spire', n: 'Spire', st: [
      { k: 'tower', l: 'Fastest tower', f: 'time', lo: 20, hi: 36000 },
      { k: 'obby', l: 'Fastest obby (all 49 stages)', chip: 'Fastest obby', f: 'time', lo: 120, hi: 360000 },
      { k: 'towers', l: 'Towers climbed', f: 'n', u: 'tower', hi: 1e6 }] },
    { d: 'turbo-trail', n: 'Turbo Trail', st: [
      { k: 'obby', l: 'Fastest full run (all 25 levels)', chip: 'Fastest full run', f: 'time', lo: 150, hi: 360000 },
      { k: 'stars', l: 'Most stars', f: 'n', u: 'star', hi: 75 },
      { k: 'levels', l: 'Levels cleared (all time)', chip: 'Levels cleared', f: 'n', u: 'level', rate: 1 / 4 },
      { k: 'wins', l: 'Races won', f: 'n', u: 'win', rate: 1 / 30 }] },
    { d: 'escapade', n: 'Escapade', st: [
      { k: 'stars', l: 'Stars (of 24)', f: 'n', u: 'star', hi: 24 },
      { k: 'total', l: 'Fastest total (all 8 levels)', chip: 'Fastest total', f: 'time', lo: 60, hi: 36000 },
      { k: 'escapes', l: 'Escapes', f: 'n', u: 'escape', rate: 1 / 8 }] },
    { d: 'updraft', n: 'Updraft', st: [{ k: 'summit', l: 'Fastest summit', f: 'time', lo: 120, hi: 1e7 }, { k: 'height', l: 'Best height', f: 'm', hi: 1005 }] },
    { d: 'odd-one-out', n: 'Odd One Out', st: [
      { k: 'rfound', l: 'Most props found in a round', f: 'n', u: 'prop', hi: 15, le: 'found' },
      { k: 'survive', l: 'Longest survival as a prop', f: 'dur', hi: 900 },
      { k: 'found', l: 'Props found (all time)', f: 'n', u: 'prop', rate: 0.5 },
      { k: 'wins', l: 'Rounds won', f: 'n', u: 'round', rate: 1 / 20 }] },
    { d: 'tumble-trials', n: 'Tumble Trials', st: [
      { k: 'crowns', l: 'Crowns', f: 'n', u: 'crown', hi: 1e5 },
      { k: 'crownrun', l: 'Most crowns in a row', f: 'n', u: 'crown', hi: 1000, le: 'crowns' },
      { k: 'shows', l: 'Shows played', f: 'n', u: 'show', hi: 1e6 }] },
    { d: 'deepword', n: 'Deepword', st: [
      { k: 'depth', l: 'Deepest daily dive', f: 'm', hi: 10935 },
      { k: 'dives', l: 'Daily dives', f: 'n', u: 'dive', rate: 1 / 30 },
      { k: 'brawlwins', l: 'Blowfish Brawl wins', f: 'n', u: 'win', rate: 1 / 30 }] },
    { d: 'puffer-party', n: 'Puffer Party', st: [
      { k: 'wins', l: 'Online wins', f: 'n', u: 'win', rate: 1 / 45 },
      { k: 'answers', l: 'Answers given (all time)', chip: 'Answers', f: 'n', u: 'answer', rate: 1 / 2 },
      { k: 'streak', l: 'Longest answer streak', chip: 'Best streak', f: 'n', u: 'answer', hi: 1000, le: 'answers' }] },
    { d: 'gridpop', n: 'Gridpop', st: [{ k: 'score', l: 'Best score', f: 'n', u: 'pt', hi: 1e8 }, { k: 'lines', l: 'Lines cleared (all time)', f: 'n', u: 'line', rate: 2 }] },
    { d: '2048', n: '2048', st: [{ k: 'best', l: 'Best score (Classic)', chip: 'Classic', f: 'n', u: 'pt', hi: 4000000 }, { k: 'tile', l: 'Biggest tile (Classic)', chip: 'Biggest tile', f: 'n', hi: 131072 },
      { k: 'best-mega', l: 'Best score (Mega 6 × 6)', chip: 'Mega', f: 'n', u: 'pt', hi: 1e10 }, { k: 'best-college', l: 'Best score (College)', chip: 'College', f: 'n', u: 'pt', hi: 4000000 },
      { k: 'best-dessert', l: 'Best score (Dessert)', chip: 'Dessert', f: 'n', u: 'pt', hi: 4000000 }] },
    { d: 'stackfall', n: 'Stackfall', st: [{ k: 'classic', l: 'Best score (Classic)', chip: 'Classic', f: 'n', u: 'pt', hi: 1e8 }, { k: 'sand', l: 'Best score (Sand)', chip: 'Sand', f: 'n', u: 'pt', hi: 1e8 }, { k: 'lines', l: 'Most lines in a game (Classic)', chip: 'Most lines', f: 'n', u: 'line', hi: 100000 }] },
    { d: 'melon-merge', n: 'Melon Merge', st: [{ k: 'score', l: 'Best score', f: 'n', u: 'pt', hi: 1e7 }, { k: 'melons', l: 'Watermelons grown (all time)', chip: 'Watermelons', f: 'n', u: 'watermelon', rate: 0.05 }] },
    // Daily Puzzles: grp puts them in their own group in the Board menu. The hub's `done` (one per puzzle finished, counted
    // on the hub page) is checked against the time played in every daily game together (rateOf), as the hub itself is only
    // open for a few seconds between puzzles.
    { d: 'daily', n: 'Daily Puzzles', grp: 'Daily Puzzles', st: [
      { k: 'streak', l: 'Best daily streak (any puzzle)', chip: 'Streak', f: 'days', hi: 3660 },
      { k: 'done', l: 'Daily puzzles finished', chip: 'Finished', f: 'n', u: 'puzzle', rate: 1 / 10, rateOf: 'daily' }] },
    { d: 'hunch', n: 'Hunch', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'fewest', l: 'Fewest guesses in a daily win', chip: 'Fewest guesses', f: 'n', u: 'guess', lo: 1, hi: 6, low: 1 }] },
    { d: 'fourcast', n: 'Fourcast', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'fewest', l: 'Fewest guesses in a daily win', chip: 'Fewest guesses', f: 'n', u: 'guess', lo: 4, hi: 9, low: 1 }] },
    { d: 'quartets', n: 'Quartets', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'perfect', l: 'Perfect days (no mistakes)', chip: 'Perfect days', f: 'n', u: 'day', rate: 1 / 10 }] },
    { d: 'crosslet', n: 'Crosslet', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Clean daily solves', f: 'n', u: 'solve', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'fastest', l: 'Fastest clean daily solve', chip: 'Fastest', f: 'time', lo: 5, hi: 36000 }] },
    { d: 'sleight', n: 'Sleight', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Daily clues solved', f: 'n', u: 'clue', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'clean', l: 'Solved with no hints', chip: 'No hints', f: 'n', u: 'clue', rate: 1 / 10 }] },
    { d: 'nearword', n: 'Nearword', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'guesses', l: 'Fewest guesses (daily)', chip: 'Fewest guesses', f: 'n', u: 'guess', lo: 1, hi: 2000, low: 1 }] },
    { d: 'warmer', n: 'Warmer', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'guesses', l: 'Fewest guesses (daily)', chip: 'Fewest guesses', f: 'n', u: 'guess', lo: 1, hi: 2000, low: 1 }] },
    { d: 'hotspot', n: 'Hotspot', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'guesses', l: 'Fewest guesses (daily)', chip: 'Fewest guesses', f: 'n', u: 'guess', lo: 1, hi: 230, low: 1 }] },
    { d: 'outline', n: 'Outline', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'tries', l: 'Fewest guesses (daily)', chip: 'Fewest guesses', f: 'n', u: 'guess', lo: 1, hi: 6, low: 1 }] },
    { d: 'unfurl', n: 'Unfurl', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'tries', l: 'Fewest guesses (daily)', chip: 'Fewest guesses', f: 'n', u: 'guess', lo: 1, hi: 6, low: 1 }] },
    { d: 'overland', n: 'Overland', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'perfect', l: 'Perfect routes', chip: 'Perfect routes', f: 'n', u: 'route', rate: 1 / 10 }] },
    { d: 'ninefold', n: 'Ninefold', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Daily puzzles solved', f: 'n', u: 'puzzle', rate: 1 / 5 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'fast-easy', l: 'Fastest Easy (no hints)', chip: 'Fastest Easy', f: 'time', lo: 30, hi: 36000 },
      { k: 'fast-medium', l: 'Fastest Medium (no hints)', chip: 'Fastest Medium', f: 'time', lo: 60, hi: 36000 },
      { k: 'fast-hard', l: 'Fastest Hard (no hints)', chip: 'Fastest Hard', f: 'time', lo: 90, hi: 36000 }] },
    { d: 'poopdle', n: 'Poopdle', grp: 'Daily Puzzles', st: [
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 },
      { k: 'perfect', l: 'Par days (no hints)', chip: 'Par days', f: 'n', u: 'day', rate: 1 / 10 }] },
    { d: 'deadline-day', n: 'Deadline Day', grp: 'Daily Puzzles', st: [
      { k: 'spare', l: 'Most guesses to spare (of 6)', chip: 'Guesses to spare', f: 'n', hi: 6 },
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 }] },
    { d: 'journeyman', n: 'Journeyman', grp: 'Daily Puzzles', st: [
      { k: 'spare', l: 'Most guesses to spare (of 6)', chip: 'Guesses to spare', f: 'n', hi: 6 },
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 }] },
    { d: 'scout-report', n: 'Scout Report', grp: 'Daily Puzzles', st: [
      { k: 'spare', l: 'Most guesses to spare (of 8)', chip: 'Guesses to spare', f: 'n', hi: 8 },
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 }] },
    { d: 'crossbar', n: 'Crossbar', grp: 'Daily Puzzles', st: [
      { k: 'cells', l: 'Most squares filled (of 9)', chip: 'Squares', f: 'n', hi: 9 },
      { k: 'wins', l: 'Daily wins (6+ squares)', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 }] },
    { d: 'teamsheet', n: 'Teamsheet', grp: 'Daily Puzzles', st: [
      { k: 'spare', l: 'Most guesses to spare (of 5)', chip: 'Guesses to spare', f: 'n', hi: 5 },
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 }] },
    { d: 'back-four', n: 'Back Four', grp: 'Daily Puzzles', st: [
      { k: 'clean', l: 'Most mistakes to spare (of 4)', chip: 'Mistakes to spare', f: 'n', hi: 4 },
      { k: 'wins', l: 'Daily wins', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 }] },
    { d: 'stat-duel', n: 'Stat Duel', grp: 'Daily Puzzles', st: [
      { k: 'run', l: 'Best daily run (of 10)', chip: 'Daily run', f: 'n', hi: 10 },
      { k: 'streakbest', l: 'Best unlimited streak', chip: 'Unlimited streak', f: 'n', hi: 500 },
      { k: 'wins', l: 'Daily wins (5+)', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 }] },
    { d: 'top-bins', n: 'Top Bins', grp: 'Daily Puzzles', st: [
      { k: 'found', l: 'Most entries found', chip: 'Found', f: 'n', hi: 10 },
      { k: 'wins', l: 'Daily wins (half or more)', f: 'n', u: 'win', rate: 1 / 10 },
      { k: 'streak', l: 'Best daily streak', f: 'days', hi: 3660 }] }
  ];
  // Slipstream circuits: short name and the quickest lap we accept, the track's length (as the game builds it) at 120 m/s,
  // the game's hard speed cap (VMAX 92 m/s × 1.3, which boost and DRS can't pass), so no real lap can be that quick: the
  // best real laps average 60–80 m/s. A course record (rec:<track>:<laps>) is the full race time, track-cut penalties
  // included, of a race that ran every lap.
  var TRACKS = {
    'au-1953': ['Melbourne', 43], 'cn-2004': ['Shanghai', 45], 'bh-2002': ['Bahrain', 45], 'sa-2021': ['Jeddah', 51], 'us-2022': ['Miami', 45],
    'ca-1978': ['Montréal', 36], 'mc-1929': ['Monaco', 27], 'es-1991': ['Barcelona', 38], 'at-1969': ['Spielberg', 35], 'gb-1948': ['Silverstone', 48],
    'be-1925': ['Spa', 58], 'hu-1986': ['Budapest', 36], 'nl-1948': ['Zandvoort', 35], 'it-1922': ['Monza', 48], 'es-2026': ['Madrid', 45],
    'az-2016': ['Baku', 49], 'sg-2008': ['Singapore', 41], 'us-2012': ['Austin', 45], 'mx-1962': ['Mexico City', 35], 'br-1940': ['São Paulo', 35],
    'us-2023': ['Las Vegas', 51], 'qa-2004': ['Lusail', 45], 'ae-2009': ['Abu Dhabi', 44], 'lakeside': ['Lakeside', 33], 'harbour': ['Harbour', 29], 'mesa': ['Mesa', 32]
  };
  var TRACK_IDS = Object.keys(TRACKS), STD_LAPS = [3, 5, 10];   // the race lengths the game offers
  var BY = {}; GAMES.forEach(function (g) { BY[g.d] = g; });

  // ---------------- Helpers ----------------
  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function num(v) { var n = typeof v === 'number' ? v : NaN; return isFinite(n) ? n : NaN; }
  // Rude words in names are masked by the shared name filter (/namefilter.js) when the page has loaded it.
  function byFilter(v) { return window.NameFilter ? window.NameFilter.clean(v) : v; }
  function cleanName(s) { return byFilter(String(s == null ? '' : s).replace(/[<>\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)); }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  // The same seat social.js (Online) shows, worked out from the uid, so nobody can claim someone else's.
  function seatOf(uid) { var h = hash('seat:' + uid); return (1 + h % 40) + 'ABCDEF'.charAt(Math.floor(h / 40) % 6); }
  // The same short word filter as social.js (ROT13 so the source doesn't spell them out).
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
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmtN(v) { try { return Math.round(v).toLocaleString('en-US'); } catch (e) { return String(Math.round(v)); } }
  function fmtHours(s) { return s < 3600 ? Math.max(1, Math.round(s / 60)) + ' min' : (s / 3600).toFixed(s < 360000 ? 1 : 0) + ' h'; }
  function fmtTime(s, ms) {
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s - Math.floor(s / 60) * 60;
    var ss = ms ? sec.toFixed(3) : sec.toFixed(s < 600 ? 1 : 0);
    if (parseFloat(ss) < 10) ss = '0' + ss;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + ss;
  }
  function fmtDur(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function fmt(st, v) {
    if (st.f === 'lap' || st.f === 'time') return fmtTime(v, true);
    if (st.f === 'kd') return v.toFixed(2);
    if (st.f === 'dur') return fmtDur(v);
    if (st.f === 'm') return fmtN(v) + ' m';
    if (st.f === 'days') return fmtN(v) + (Math.round(v) === 1 ? ' day' : ' days');
    if (st.f === 'chips') return fmtN(v) + ' chips';
    if (st.u) return fmtN(v) + ' ' + st.u + (Math.round(v) === 1 ? '' : /(s|sh|ch|x)$/.test(st.u) ? 'es' : 's');   // 2 guesses
    return fmtN(v);
  }
  function low(st) { return st.f === 'time' || st.f === 'lap' || st.low === 1; }

  // ---------------- Reading the boards ----------------
  // One player's node, checked field by field. Returns null for anything stale or malformed.
  function okUid(u) { return typeof u === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(u); }
  // Seconds played in all the Daily Puzzles games together (each capped like any game's hours), for rateOf: 'daily'.
  function dailySecs(g, cap) {
    var t = 0;
    GAMES.forEach(function (m) { if (m.grp !== 'Daily Puzzles') return; var o = g[m.d], x = o && typeof o === 'object' ? Math.floor(num(o.s)) : 0; if (x > 0 && x <= cap) t += x; });
    return t;
  }
  function parse(uid, v, now) {
    if (!okUid(uid) || !v || typeof v !== 'object' || Array.isArray(v)) return null;
    var ts = num(v.ts);
    if (!(ts >= EPOCH - 86400000) || ts > now + 600000 || now - ts > STALE) return null;
    var size; try { size = JSON.stringify(v).length; } catch (e) { return null; }
    if (size > NODE_MAX || !v.g || typeof v.g !== 'object' || Array.isArray(v.g)) return null;
    var cap = Math.max(86400, (now - EPOCH) / 1000 + 86400);   // 24 hours a day since the boards started
    var p = { uid: uid, n: mask(cleanName(v.n)) || 'Player', seat: seatOf(uid), total: 0, top: '', topS: 0, g: {} };
    // Merged accounts (stats.js): the one this was merged into, by its owner, and the ones merged into this.
    if (okUid(v.to) && v.to !== uid) p.to = v.to;
    if (v.al && typeof v.al === 'object' && !Array.isArray(v.al)) {
      var al = Object.keys(v.al).filter(function (u) { return okUid(u) && u !== uid && num(v.al[u]) > 0; }).slice(0, 8);
      if (al.length) { p.al = {}; al.forEach(function (u) { p.al[u] = 1; }); }
    }
    var keys = Object.keys(v.g); if (keys.length > 80) return null;   // stats.js keeps at most 80 games (MAX_GAMES)
    for (var i = 0; i < keys.length; i++) {
      var meta = BY[keys[i]], src = v.g[keys[i]];
      if (!meta || !src || typeof src !== 'object' || Array.isArray(src)) continue;
      var sk = Object.keys(src); if (sk.length > MAX_STATS) return null;
      var s = Math.floor(num(src.s));
      if (!(s > 0)) s = 0;
      if (s > cap) return null;
      var o = { s: s };
      meta.st.forEach(function (st) {
        var x = num(src[st.k]);
        if (!(x > 0) || x < (st.lo || 0) || x > (st.hi || 1e6)) return;
        if (st.rate) { var rs = st.rateOf ? dailySecs(v.g, cap) : s; x = Math.floor(x); if (x > st.rate * rs + 5) x = Math.floor(st.rate * rs + 5); if (!(x > 0)) return; }
        if (st.le || st.f === 'dur') { x = Math.floor(x); if (!(x > 0)) return; }   // whole rounds and seconds, so equal shows as a tie
        o[st.k] = x;
      });
      // A best single round can't beat the all-time count it's part of (and needs one).
      meta.st.forEach(function (st) { if (st.le && o[st.k] != null) { if (o[st.le] > 0) o[st.k] = Math.min(o[st.k], o[st.le]); else delete o[st.k]; } });
      // K/D from the checked counts (never from the node itself), with enough kills, capped at hi.
      meta.st.forEach(function (st) {
        if (!st.kd) return;
        var k = o[st.kd[0]] || 0, d = o[st.kd[1]] || 0;
        delete o[st.k];
        if (k >= st.min) o[st.k] = Math.min(st.hi, Math.round(k / Math.max(1, d) * 100) / 100);
      });
      if (meta.laps) {
        sk.forEach(function (k) {
          var m = /^lap:([a-z0-9-]{1,20})$/.exec(k), t = m && TRACKS[m[1]], x = num(src[k]);
          if (t && x >= t[1] && x <= 900) o[k] = x;
        });
        // Course records: 1–20 laps, no quicker than the track allows, and no quicker than this driver's own fastest lap
        // there times the laps (every lap of a race also counts as a lap, so a record with no lap time is dropped).
        sk.forEach(function (k) {
          var m = /^rec:([a-z0-9-]{1,20}):([1-9]|1[0-9]|20)$/.exec(k), t = m && TRACKS[m[1]], x = num(src[k]);
          var n = m ? +m[2] : 0, lap = m ? o['lap:' + m[1]] : 0;
          if (t && lap > 0 && x >= t[1] * n && x >= (lap - 0.001) * n && x <= 900 * n) o[k] = x;
        });
      }
      p.g[keys[i]] = o; p.total += s;
      if (s > p.topS) { p.topS = s; p.top = meta.n; }
    }
    if (p.total > cap) return null;
    // An hours reset: count from the zero point (personal bests stay; the checks above used the full totals).
    var rs = RESETS[uid];
    // Removed from the boards by the admin (fake or junk accounts). The admin page still sees them, marked, to undo it.
    if (rs && rs.h) { if (!SHOW_HIDDEN) return null; p.hidden = rs.t; }
    if (rs && rs.b) {
      p.reset = rs.t; p.total = 0; p.top = ''; p.topS = 0;
      Object.keys(p.g).forEach(function (k) {
        var o = p.g[k]; o.s = Math.max(0, o.s - (rs.b[k] || 0)); p.total += o.s;
        if (o.s > p.topS) { p.topS = o.s; p.top = BY[k].n; }
      });
    }
    return p;
  }

  // One row per person where that's proven: an entry whose owner merged it into another (its to, and the other's al) is left
  // out (the other already has its hours); an entry the admin merged into another (a signed a) is folded into it, per game
  // the larger hours and the better bests. Left-out entries are kept, marked with `into`, only when hidden ones are shown
  // (the admin page). One step only: an entry that is itself merged into another isn't a target.
  function better(st, a, b) { return !(a > 0) ? b : !(b > 0) ? a : low(st) ? Math.min(a, b) : Math.max(a, b); }
  function fold(t, p) {
    Object.keys(p.g).forEach(function (k) {
      var o = p.g[k], to = t.g[k] || (t.g[k] = { s: 0 }), meta = BY[k];
      to.s = Math.max(to.s, o.s);
      Object.keys(o).forEach(function (sk) {
        if (sk === 's') return;
        var st = meta && meta.st.filter(function (x) { return x.k === sk; })[0];
        to[sk] = better(st || { f: /^(lap|rec):/.test(sk) ? 'lap' : 'n' }, to[sk], o[sk]);
      });
    });
    t.total = 0; t.top = ''; t.topS = 0;
    Object.keys(t.g).forEach(function (k) { var s = t.g[k].s; t.total += s; if (s > t.topS) { t.topS = s; t.top = BY[k].n; } });
  }
  function collapse(list) {
    var by = {};
    list.forEach(function (p) { by[p.uid] = p; });
    function target(p) {
      var t = p.to && by[p.to];
      if (t && t.al && t.al[p.uid] && !t.to) return { t: t, own: true };
      var a = RESETS[p.uid] && RESETS[p.uid].a, ta = a && by[a];
      if (ta && ta !== p && !ta.to && !(RESETS[ta.uid] && RESETS[ta.uid].a)) return { t: ta, own: false };
      return null;
    }
    return list.filter(function (p) {
      var m = target(p);
      if (!m) return true;
      if (!m.own) fold(m.t, p);
      p.into = m.t.uid; p.intoOwn = m.own;
      return SHOW_HIDDEN;
    });
  }

  // ---------------- Hours resets (signed by the admin key) ----------------
  function loadKey() {
    if (window.BackRoomAdminKey) return Promise.resolve(window.BackRoomAdminKey);
    return new Promise(function (res) {
      var s = document.createElement('script'); s.src = '/e63334287a3deaa3/adminkey.js';
      s.onload = function () { res(window.BackRoomAdminKey || null); }; s.onerror = function () { res(null); };
      document.head.appendChild(s);
    });
  }
  function unb64(t) { var s = atob(t), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  // The reset nodes' value -> { uid: { t, b } } for the resets in force, keeping only nodes signed by the admin key.
  async function checkResets(val) {
    var out = {}, K = await loadKey();
    if (!K || !window.crypto || !crypto.subtle || !val || typeof val !== 'object') return out;
    var pub = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: K.pub.x, y: K.pub.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    var latest = {};
    var keys = Object.keys(val).slice(0, 20);
    for (var i = 0; i < keys.length; i++) {
      var v = val[keys[i]];
      if (!v || typeof v.r !== 'string' || typeof v.sig !== 'string' || v.r.length > 60000 || v.sig.length > 200) continue;
      var ok = false;
      try { ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64(v.sig), new TextEncoder().encode(v.r)); } catch (e) { ok = false; }
      if (!ok) continue;
      var m; try { m = JSON.parse(v.r); } catch (e) { continue; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
      Object.keys(m).forEach(function (u) {
        var e = m[u], t = e && num(e.t);
        if (!okUid(u) || !(t > 0) || (latest[u] && latest[u].t >= t)) return;
        var b = null;
        if (e.b && typeof e.b === 'object' && !Array.isArray(e.b)) { b = {}; Object.keys(e.b).forEach(function (k) { var x = Math.floor(num(e.b[k])); if (BY[k] && x > 0) b[k] = x; }); }
        latest[u] = { t: t, b: b, h: e.h === 1, a: okUid(e.a) && e.a !== u ? e.a : '' };
      });
    }
    return latest;
  }
  // Read and check the resets with a database connection; on any failure keep the ones we had.
  function readResets(db) {
    return db.ref(RS_PATH).once('value').then(function (s) { return checkResets(s.val()); }).then(function (r) { RESETS = r; return r; }, function () { return RESETS; });
  }

  // Slipstream: how many drivers have a time on each track, the tracks in that order (then the game's), and which race
  // lengths each track has a course record for.
  function trackStats(people) {
    var c = {}, laps = {};
    people.forEach(function (p) {
      var o = p.g.slipstream; if (!o) return;
      var seen = {};
      Object.keys(o).forEach(function (k) {
        var m = /^(?:lap|rec):([a-z0-9-]+)(?::(\d+))?$/.exec(k); if (!m || !TRACKS[m[1]]) return;
        if (!seen[m[1]]) { seen[m[1]] = 1; c[m[1]] = (c[m[1]] || 0) + 1; }
        if (m[2]) (laps[m[1]] || (laps[m[1]] = {}))[m[2]] = 1;
      });
    });
    var order = TRACK_IDS.slice().sort(function (a, b) { return (c[b] || 0) - (c[a] || 0) || TRACK_IDS.indexOf(a) - TRACK_IDS.indexOf(b); });
    return { order: order, count: c, laps: laps };
  }
  // The boards a game has: its hours, then its stats. Slipstream: every track's fastest lap at a glance, then the chosen
  // track's course records (3, 5 and 10 laps, the lengths the game offers, plus any other length someone has a record for)
  // and its fastest lap.
  function boardsFor(d, people, track) {
    var meta = BY[d]; if (!meta) return [];
    var out = [{ k: 's', l: 'Hours played', chip: 'Hours', f: 'hours' }];
    if (!meta.laps) return out.concat(meta.st.filter(function (st) { return !st.hide; }));
    var ts = trackStats(people), t = TRACKS[track] ? track : ts.order[0], nm = TRACKS[t][0];
    // Every track at once: the fastest lap on each (and who set it), "no times yet" where nobody has one.
    out.push({ k: 'laps', id: 'laps', l: 'Fastest lap · every track', chip: 'All tracks', f: 'lap', all: true });
    var laps = STD_LAPS.slice();
    Object.keys(ts.laps[t] || {}).forEach(function (n) { n = +n; if (laps.indexOf(n) < 0) laps.push(n); });
    laps.sort(function (a, b) { return a - b; }).forEach(function (n) {
      var ln = n + (n === 1 ? ' lap' : ' laps');
      out.push({ k: 'rec:' + t + ':' + n, id: 'rec' + n, l: 'Course record · ' + nm + ' · ' + ln, chip: n + '-lap record', f: 'lap', laps: n, track: nm });
    });
    out.push({ k: 'lap:' + t, id: 'lap', l: 'Fastest lap · ' + nm, chip: 'Fastest lap', f: 'lap', track: nm });
    return out;
  }
  // Slipstream's every-track board: one row per track, tracks with times first (most drivers first, as in the Track menu),
  // each with its fastest lap and who set it; a track nobody has lapped yet is kept, with no time.
  function trackRows(people) {
    var ts = trackStats(people);
    return ts.order.map(function (id) {
      var best = null, v = 0;
      people.forEach(function (p) {
        var o = p.g.slipstream, x = o ? o['lap:' + id] : 0;
        if (x > 0 && (!best || x < v || (x === v && (p.n < best.n || (p.n === best.n && p.uid < best.uid))))) { best = p; v = x; }
      });
      return { t: id, name: TRACKS[id][0], p: best, v: v, n: ts.count[id] || 0 };
    });
  }
  // Rows for one board, best first, with shared ranks for ties.
  function rows(view, people) {
    var list = [];
    people.forEach(function (p) {
      var v, extra = '';
      if (view.g === 'all') { v = p.total; extra = p.top ? 'Most: ' + p.top : ''; }
      else { var o = p.g[view.g]; v = o ? o[view.st ? view.st.k : 's'] : NaN; }
      if (v > 0) list.push({ p: p, v: v, extra: extra });
    });
    var st = view.st, asc = st && low(st);
    list.sort(function (a, b) { return (asc ? a.v - b.v : b.v - a.v) || (a.p.n < b.p.n ? -1 : a.p.n > b.p.n ? 1 : (a.p.uid < b.p.uid ? -1 : 1)); });
    for (var i = 0; i < list.length; i++) list[i].rank = i && list[i].v === list[i - 1].v ? list[i - 1].rank : i + 1;
    return list;
  }

  // For the admin page: the same checks and names, so what it shows is what the boards would show. With data-lib, that's all.
  window.BackRoomBoards = { RS_PATH: RS_PATH, readResets: readResets, get resets() { return RESETS; }, showHidden: function (v) { SHOW_HIDDEN = !!v; }, parse: parse, collapse: collapse, GAMES: GAMES, BY: BY, TRACKS: TRACKS, trackRows: trackRows, EPOCH: EPOCH, PATH: PATH, MAX_NODES: MAX_NODES, NODE_MAX: NODE_MAX, fmt: fmt, fmtHours: fmtHours, cleanName: cleanName, mask: mask, seatOf: seatOf };
  if (me && me.hasAttribute('data-lib')) return;

  // ---------------- Styles ----------------
  var css = document.createElement('style');
  css.textContent =
    '#leaderboards{padding-top:32px}' +
    '.lbd{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px 16px;display:grid;gap:12px;min-width:0;color:var(--ink)}' +
    '.lbd-top{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap}' +
    '.lbd h2{margin:0;font-family:var(--display,var(--f-d,sans-serif));font-weight:800;font-size:28px;line-height:1;letter-spacing:.02em;text-transform:uppercase;color:var(--ink)}' +
    '.lbd-sub{margin:0;color:var(--ink-2);font-size:15px;flex:1 1 260px;min-width:0}' +
    '.lbd-b{font:inherit;font-family:var(--body,var(--f-b,sans-serif));font-size:14px;font-weight:600;color:var(--ink);background:var(--panel-2);border:1px solid var(--line);border-radius:8px;min-height:36px;padding:6px 12px;cursor:pointer;white-space:nowrap}' +
    '.lbd-b:hover{border-color:var(--ink-2)}.lbd-b[disabled]{opacity:.5;cursor:default}' +
    '.lbd-ctl{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}' +
    '.lbd-ctl label{display:flex;align-items:center;gap:8px;font-family:var(--mono,var(--f-m,monospace));font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);min-width:0;flex:1 1 260px;max-width:420px}' +
    '.lbd select{flex:1;min-width:0;font:inherit;font-family:var(--body,var(--f-b,sans-serif));font-size:16px;font-weight:400;letter-spacing:0;text-transform:none;color:var(--ink);background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:7px 10px;min-height:40px}' +
    '.lbd select:focus{border-color:var(--accent);outline:none}' +
    '.lbd-chips{display:flex;flex-wrap:wrap;gap:8px}' +
    '.lbd-chips:empty{display:none}' +
    '.lbd-chips button{font:inherit;font-family:var(--body,var(--f-b,sans-serif));font-size:14px;font-weight:600;color:var(--ink);background:var(--panel-2);border:1px solid var(--line);border-radius:999px;padding:6px 14px;cursor:pointer;min-height:36px}' +
    '.lbd-chips button:hover{border-color:var(--ink-2)}' +
    '.lbd-chips button[aria-pressed="true"]{border-color:var(--accent);background:var(--accent);color:var(--accent-ink)}' +
    '.lbd-chips button{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.lbd-ctl label[hidden]{display:none}' +
    '.lbd-h{margin:2px 0 0;font-family:var(--mono,var(--f-m,monospace));font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}' +
    '.lbd-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}' +
    '.lbd-r{display:grid;grid-template-columns:2.6em minmax(0,1fr) auto;align-items:center;gap:10px;background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:7px 12px;min-width:0}' +
    '.lbd-r.av{grid-template-columns:2.6em 30px minmax(0,1fr) auto}' +
    '.lbd-ex .bra-tier{margin-right:6px;vertical-align:-1px}' +
    '.lbd-r.me{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--panel))}' +
    '.lbd-rk{font-family:var(--mono,var(--f-m,monospace));font-size:14px;font-weight:600;color:var(--ink-2);text-align:right}' +
    '.lbd-r:nth-child(-n+3) .lbd-rk{color:var(--accent)}' +
    '.lbd-who{display:grid;min-width:0;line-height:1.3}' +
    '.lbd-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}' +
    '.lbd-nm small{font-family:var(--mono,var(--f-m,monospace));font-size:12px;font-weight:600;color:var(--accent)}' +
    '.lbd-you{display:inline-block;margin-left:6px;font-family:var(--mono,var(--f-m,monospace));font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-ink);background:var(--accent);border-radius:4px;padding:1px 5px;vertical-align:2px}' +
    '.lbd-ex{font-family:var(--mono,var(--f-m,monospace));font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.lbd-v{font-family:var(--mono,var(--f-m,monospace));font-size:15px;font-weight:600;text-align:right;white-space:nowrap}' +
    '.lbd-gap{text-align:center;color:var(--ink-2);font-size:14px;line-height:1;padding:2px 0;letter-spacing:.3em}' +
    '.lbd-r.trk{grid-template-columns:minmax(0,1fr) auto;cursor:pointer}.lbd-r.trk:hover{border-color:var(--ink-2)}' +
    '.lbd-r.trk .lbd-nm{font-weight:700}.lbd-r.trk .lbd-ex{text-transform:none;letter-spacing:0;font-size:12px}' +
    '.lbd-r.none .lbd-v{color:var(--ink-2);font-weight:400;font-size:13px}' +
    '.lbd-msg,.lbd-note{margin:0;font-size:14px;color:var(--ink-2);overflow-wrap:anywhere}' +
    '.lbd-msg:empty{display:none}.lbd-msg.err{color:var(--down,#B42318)}' +
    '.lbd-note{font-size:13px}' +
    '@media (max-width:600px){.lbd{padding:14px}.lbd-sub{font-size:14px;order:3;flex-basis:100%}.lbd-top > .lbd-b{margin-left:auto}.lbd-ctl label{max-width:none}.lbd-ctl label span{display:none}.lbd-chips{gap:6px}.lbd-chips button{font-size:13px;padding:5px 11px;min-height:34px}.lbd-r{gap:8px;padding:7px 10px;grid-template-columns:2.2em minmax(0,1fr) auto}.lbd-r.av{grid-template-columns:2.2em 28px minmax(0,1fr) auto}.lbd-v{font-size:14px}}' +
    '@media (max-width:420px){.lbd h2{font-size:24px}}';
  document.head.appendChild(css);

  // ---------------- Section ----------------
  var sec = el('section'); sec.id = 'leaderboards'; sec.setAttribute('aria-label', 'Leaderboards');
  var box = el('div', 'lbd');
  var top = el('div', 'lbd-top');
  var $refresh = el('button', 'lbd-b', 'Refresh'); $refresh.type = 'button';
  top.append(el('h2', '', 'Leaderboards'), el('p', 'lbd-sub', 'Most hours played across the Back Room, and the best in each game.'), $refresh);
  var ctl = el('div', 'lbd-ctl');
  var lbl = el('label'); lbl.append(el('span', '', 'Board'));
  var $sel = el('select'); $sel.setAttribute('aria-label', 'Leaderboard');
  $sel.append(new Option('Hours (all games)', 'all'));
  // Games without a grp first, under "Games", then each group (Daily Puzzles) as its own optgroup, in GAMES order.
  var groups = {}, gorder = [];
  GAMES.forEach(function (g) { var k = g.grp || 'Games'; if (!groups[k]) { groups[k] = el('optgroup'); groups[k].label = k; gorder.push(k); } groups[k].append(new Option(g.n, g.d)); });
  gorder.forEach(function (k) { $sel.append(groups[k]); });
  lbl.append($sel); ctl.append(lbl);
  // Slipstream only: which track's course records and fastest lap to show.
  var tlbl = el('label'); tlbl.append(el('span', '', 'Track')); tlbl.hidden = true;
  var $trk = el('select'); $trk.setAttribute('aria-label', 'Track');
  tlbl.append($trk); ctl.append(tlbl);
  var $chips = el('div', 'lbd-chips'); $chips.setAttribute('role', 'group'); $chips.setAttribute('aria-label', 'Board');
  var $h = el('h3', 'lbd-h');
  var $list = el('ol', 'lbd-list'); $list.setAttribute('aria-label', 'Leaderboard');
  var $msg = el('p', 'lbd-msg'); $msg.setAttribute('role', 'status'); $msg.setAttribute('aria-live', 'polite');
  var $note = el('p', 'lbd-note', 'Play time counts while a game is open and you’re playing. Scores are reported by each player’s own browser, so they’re for bragging rights, not prizes.');
  // Slipstream's course-record boards only: what the time includes.
  var $rule = el('p', 'lbd-note', 'Race times include any track-cut penalties (+2.5 s each).'); $rule.hidden = true;
  box.append(top, ctl, $chips, $h, $list, $msg, $rule, $note);
  sec.append(box);

  function place() {
    var games = document.querySelector('section[aria-label="Games"]'), lists = document.getElementById('lists');
    var after = games || lists, foot = document.querySelector('.wrap > footer') || document.querySelector('footer');
    if (after && after.parentNode) after.parentNode.insertBefore(sec, after.nextSibling);
    else if (foot && foot.parentNode) foot.parentNode.insertBefore(sec, foot);
    else document.body.appendChild(sec);
    if (lists && !games) sec.style.paddingTop = '22px';
  }
  place();
  function say(t, err) { $msg.textContent = t || ''; $msg.classList.toggle('err', !!err); }

  // ---------------- State ----------------
  // g: 'all' or a game folder. b: the board (its stat key, 's' for hours, or for Slipstream 'laps' (every track), 'rec3', 'rec5'… or 'lap'),
  // '' for the game's first board that has anyone on it. t: the Slipstream track.
  var view = { g: 'all', b: 's', t: '' };
  try {
    var sv = JSON.parse(ls('lb:view') || 'null');
    if (sv && (sv.g === 'all' || BY[sv.g])) view = { g: sv.g, b: typeof sv.b === 'string' ? sv.b.slice(0, 40) : 's', t: typeof sv.t === 'string' && TRACKS[sv.t] ? sv.t : '' };
  } catch (e) {}
  $sel.value = view.g;
  var people = null, myUid = '', loading = false, lastLoad = 0;

  function waitParty() {
    return new Promise(function (res) {
      var n = 0;
      (function t() { if (window.Party && window.Party.boot) return res(window.Party); if (++n > 150) return res(null); setTimeout(t, 100); })();
    });
  }
  function timeout(p, ms) { var t; return Promise.race([p, new Promise(function (_, rej) { t = setTimeout(function () { rej(new Error('timeout')); }, ms); })]).finally(function () { clearTimeout(t); }); }

  async function load() {
    if (loading || Date.now() - lastLoad < 8000) return;
    loading = true; $refresh.disabled = true; say(people ? 'Refreshing…' : 'Loading the leaderboards…');
    try {
      var P = await waitParty();
      if (!P) throw new Error('The leaderboards need the Party panel, which didn’t load. Reload the page to try again.');
      var b = await P.boot(); myUid = b.uid;
      var snap = (await timeout(Promise.all([b.db.ref(PATH).once('value'), readResets(b.db)]), 15000))[0];
      var val = snap.val() || {}, now = P.now ? P.now() : Date.now(), out = [], keys = Object.keys(val);
      // MAX_NODES counts players shown, not nodes read: stale nodes (which pile up, as nothing removes them) cost one
      // comparison each in parse and mustn't crowd out current players further down the list.
      for (var i = 0; i < keys.length && out.length < MAX_NODES; i++) { var p = parse(keys[i], val[keys[i]], now); if (p) out.push(p); }
      people = collapse(out); lastLoad = Date.now();
      say('');
    } catch (e) {
      say(e && e.message && e.message !== 'timeout' ? e.message : 'Couldn’t reach the leaderboards. If you’re on a school or work network it may be blocking the game database.', true);
    } finally {
      loading = false; $refresh.disabled = false; draw();
    }
  }
  function isMe(uid) { return uid === myUid || uid === ls('lbs:uid'); }

  // ---------------- Drawing ----------------
  function bid(b) { return b.id || b.k; }
  function chip(b) {
    var c = el('button', '', b.chip || b.l); c.type = 'button'; c.title = b.l;
    c.setAttribute('data-b', bid(b)); c.setAttribute('aria-pressed', String(bid(b) === view.b));
    return c;
  }
  // The track menu: tracks with times first (most drivers first, with the count), then the rest.
  var trkSig = '';
  function fillTracks() {
    var ts = trackStats(people || []), sig = JSON.stringify(ts.count);
    // The first pick is the track most people have a time on, so it waits for the data (before that, the first track
    // in the list would be chosen and kept, even once the boards had loaded).
    if (!TRACKS[view.t] && people) view.t = ts.order[0];
    if (sig !== trkSig) {
      trkSig = sig; $trk.textContent = '';
      var withT = el('optgroup'), without = el('optgroup');
      withT.label = 'Tracks with times'; without.label = people ? 'No times yet' : 'Tracks';
      ts.order.forEach(function (id) {
        var n = ts.count[id] || 0;
        (n ? withT : without).append(new Option(TRACKS[id][0] + (n ? ' · ' + n + (n === 1 ? ' driver' : ' drivers') : ''), id));
      });
      if (withT.children.length) $trk.append(withT);
      if (without.children.length) $trk.append(without);
    }
    $trk.value = view.t;
  }
  // Someone is on this board.
  function filled(b) { return !!b.all || (people || []).some(function (p) { var o = p.g[view.g]; return o && o[b.k] > 0; }); }
  function row(r) {
    var li = el('li', 'lbd-r' + (isMe(r.p.uid) ? ' me' : ''));
    var who = el('span', 'lbd-who'), nm = el('span', 'lbd-nm');
    nm.append(r.p.n + ' ', el('small', '', '· ' + r.p.seat));
    if (isMe(r.p.uid)) nm.append(el('b', 'lbd-you', 'You'));
    who.append(nm);
    // The status tier (miles.js) from this same checked node, then "Most: <game>" on the Hours board.
    var ex = el('span', 'lbd-ex'), badge = null;
    if (window.BackRoomMiles) { try { badge = BackRoomMiles.badge(BackRoomMiles.of(r.p)); } catch (e) { badge = null; } }
    if (badge) ex.append(badge);
    if (r.extra) ex.append(r.extra);
    if (badge || r.extra) who.append(ex);
    li.append(el('span', 'lbd-rk', String(r.rank)));
    if (window.BackRoomAvatar) { try { li.append(BackRoomAvatar.el(r.p.uid, 30)); li.classList.add('av'); } catch (e) {} }
    li.append(who, el('span', 'lbd-v', r.fmt));
    return li;
  }
  function trackRow(r) {
    var me = r.p && isMe(r.p.uid);
    var li = el('li', 'lbd-r trk' + (me ? ' me' : '') + (r.p ? '' : ' none'));
    li.setAttribute('data-t', r.t); li.title = 'Show ' + r.name;
    var who = el('span', 'lbd-who'), nm = el('span', 'lbd-nm', r.name);
    who.append(nm);
    if (r.p) {
      var ex = el('span', 'lbd-ex'); ex.append(r.p.n + ' ', el('small', '', '· ' + r.p.seat));
      if (me) ex.append(el('b', 'lbd-you', 'You'));
      ex.append(' · ' + r.n + (r.n === 1 ? ' driver' : ' drivers'));
      who.append(ex);
    }
    li.append(who, el('span', 'lbd-v', r.p ? fmtTime(r.v, true) : 'no times yet'));
    return li;
  }
  // picked: a board was chosen on this page by hand, so an empty one is left alone; a remembered or default board with
  // nobody on it gives way to the game's first board that has someone.
  var picked = false;
  function draw() {
    $chips.textContent = '';
    var slip = view.g !== 'all' && BY[view.g].laps;
    tlbl.hidden = !slip;
    if (slip) fillTracks();
    var boards = view.g === 'all' ? [] : boardsFor(view.g, people || [], view.t);
    var st = null;
    for (var i = 0; i < boards.length; i++) if (bid(boards[i]) === view.b) st = boards[i];
    if (st && people && !picked && st.k !== 's' && !filled(st)) st = null;
    // No board picked yet (a game was just chosen, or the remembered one is empty): the first one with anyone on it
    // (Slipstream: every track's fastest lap), else the first after Hours.
    if (view.g !== 'all' && !st) {
      if (!people) st = boards[1] || boards[0];
      else { st = boards.slice(1).filter(filled)[0] || boards[1] || boards[0]; view.b = bid(st); }
    }
    boards.forEach(function (b) { $chips.append(chip(b)); });
    view.st = st && st.k !== 's' ? st : null;
    $rule.hidden = !(view.st && view.st.laps);
    $h.textContent = view.g === 'all' ? 'Hours played · all games' : BY[view.g].n + ' · ' + st.l;
    $list.textContent = '';
    if (!people) return;
    if (view.st && view.st.all) {
      var trs = trackRows(people), have = trs.filter(function (r) { return r.p; }).length;
      trs.forEach(function (r) { $list.append(trackRow(r)); });
      say(have ? 'Fastest lap on ' + have + ' of ' + trs.length + ' tracks so far. Pick a track for its full board.' : 'No lap times on any track yet. Race to set one.');
      return;
    }
    var list = rows(view, people), hours = !view.st;
    list.forEach(function (r) { r.fmt = hours ? fmtHours(r.v) : fmt(view.st, r.v); });
    var mine = -1; for (var j = 0; j < list.length; j++) if (isMe(list[j].p.uid)) { mine = j; break; }
    list.slice(0, TOP).forEach(function (r) { $list.append(row(r)); });
    if (mine >= TOP) { var gap = el('li', 'lbd-gap', '···'); gap.setAttribute('aria-hidden', 'true'); $list.append(gap, row(list[mine])); }
    if (!list.length) say(view.g === 'all' ? 'Nobody’s on the board yet. Play any game for a minute to get on it.'
      : view.st && view.st.laps ? 'No course record at ' + view.st.track + ' over ' + view.st.laps + (view.st.laps === 1 ? ' lap' : ' laps') + ' yet. Finish a race of that length there to set one.'
      : view.st && view.st.track ? 'No lap times at ' + view.st.track + ' yet. Race there to set one.'
      : 'Nobody has a score here yet. Play ' + BY[view.g].n + ' to be the first.');
    else if (mine < 0 && myUid) say(list.length + (list.length === 1 ? ' player' : ' players') + '. You’re not on this board yet.');
    else say(list.length + (list.length === 1 ? ' player' : ' players') + (mine >= 0 ? '. You’re #' + list[mine].rank + '.' : '.'));
  }
  function save() { ls('lb:view', JSON.stringify({ g: view.g, b: view.b, t: view.t || '' })); }

  $sel.addEventListener('change', function () { view.g = $sel.value === 'all' || BY[$sel.value] ? $sel.value : 'all'; view.b = view.g === 'all' ? 's' : ''; save(); draw(); if (!people) load(); });
  $trk.addEventListener('change', function () { if (TRACKS[$trk.value]) { view.t = $trk.value; if (view.b === 'laps') view.b = 'lap'; picked = true; save(); draw(); } });
  $chips.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-b]'); if (!b) return;
    view.b = b.getAttribute('data-b'); picked = true; save(); draw();
  });
  // A track on the every-track board opens that track's fastest-lap board.
  $list.addEventListener('click', function (e) {
    var li = e.target.closest('li[data-t]'); if (!li || !TRACKS[li.getAttribute('data-t')]) return;
    view.t = li.getAttribute('data-t'); view.b = 'lap'; picked = true; save(); draw();
  });
  $refresh.addEventListener('click', function () { lastLoad = 0; load(); });
  // avatar.js and miles.js may load after the boards were drawn (the home page loads them alongside this file).
  document.addEventListener('backroom:avatar', function () { if (people) draw(); });
  document.addEventListener('backroom:miles', function (e) { if (people && e.detail && !e.detail.uid) draw(); });

  // A rename (ours, or someone's Online name changing): rename their row now rather than at the next read.
  var nameT = 0;
  document.addEventListener('backroom:name', function (e) {
    var d = e.detail; if (!people || !d || typeof d.uid !== 'string' || !d.uid) return;
    var n = mask(cleanName(d.n)) || 'Player', hit = false;
    people.forEach(function (p) { if ((p.uid === d.uid || (d.mine && isMe(p.uid))) && p.n !== n) { p.n = n; hit = true; } });
    if (hit) { clearTimeout(nameT); nameT = setTimeout(draw, 50); }
  });

  // Read nothing until the section is near the screen.
  draw(); say('The boards load when you scroll down to them.');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); load(); }
    }, { rootMargin: '200px 0px' });
    io.observe(sec);
  } else load();

  // Test hook for the automated checks; harmless in normal play.
  if (navigator.webdriver) window.__lb = { get people() { return people; }, get view() { return view; }, get myUid() { return myUid; }, parse: parse, collapse: collapse, rows: rows, trackRows: trackRows, boardsFor: boardsFor, fmt: fmt, BY: BY, load: function () { lastLoad = 0; return load(); }, draw: draw, set top(n) { TOP = n; }, PATH: PATH, EPOCH: EPOCH };
})();
