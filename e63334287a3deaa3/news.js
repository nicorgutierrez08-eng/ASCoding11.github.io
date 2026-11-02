/*
 * Back Room "What's new".
 *
 *   <script src="/e63334287a3deaa3/news.js" defer></script>
 *
 * Puts a slim "What's new" strip under the page header (above the Party panel) with the
 * latest entry's kind, version, title and day, and, while there are games less than a week
 * old, a "New games!" row of chips that open them. Tapping the strip opens the list of
 * changes as a card per release, grouped by day, five days at a time ("Show older" for more).
 * A dot on the strip marks entries you haven't opened yet; it's remembered only in this
 * browser (localStorage `news:seen`). It takes its colours from the page's CSS variables
 * (--accent, --panel, --ink…), so it fits the light Back Room page and the dark phone page.
 *
 * ---- Adding an entry ----
 * Add an object to the TOP of NEWS below (newest first) when your pull request changes
 * something players will notice:
 *
 *   {date: '2026-10-22', version: '1.7', title: 'Short headline', kind: 'game',
 *    games: ['Deepword'], items: ['One short sentence per change, in plain words.', '…']},
 *
 *   date     the day it went live (the merge date, local time), as YYYY-MM-DD
 *   kind     'game'    a new game                  shows as "New game 1.7"
 *            'feature' a new feature or big update  shows as "Update 1.7"
 *            'fix'     bug fixes and small tweaks   shows as "Bug fix 1.7.1"
 *   version  a new game or a big feature bumps the minor number and drops the patch
 *            (1.6 -> 1.7, and 1.7.2 -> 1.8); a fix-only release adds or bumps a patch
 *            number (1.7 -> 1.7.1 -> 1.7.2). Never reuse a version.
 *            An entry added afterwards for something that already went out (like the four puzzle
 *            games of Oct 23) can leave version out; it then shows as just "New game".
 *   title    a few words; it's what the strip shows while it's the latest entry
 *   games    optional: the names of the brand-new games in this entry, as on their cards. For
 *            NEW_DAYS (7) days after the entry's date, the strip shows a "New games!" row with
 *            them as colourful chips that open the game (each opens the Back Room folder named
 *            like the game in lowercase with dashes, so 'Melon Merge' opens melon-merge/; write
 *            'Name:folder' when the folder is named differently). The open list shows them too.
 *            Leave it out for updates and fixes.
 *   items    the bullet points, written for players, in your own words
 *
 * Several entries can share a date (say 1.7 and then 1.7.1 the same day); they're shown
 * under one day. Text is put on the page as plain text, never as HTML. Leave out anything
 * private or admin-only.
 */
(function () {
  var NEWS = [
    {date: '2026-10-29', version: '1.11', title: 'Turbo Trail, Escapade and Spire', kind: 'game', games: ['Turbo Trail', 'Escapade'], items: [
      'Turbo Trail: a speedrun obby with 25 short levels across five worlds. Race the clock for gold medals and your own ghost, try all 25 in one full run, or race up to 12 friends online.',
      'Escapade: parkour your way out of eight escape rooms. Hop the desks over lava, dodge the lasers, find the key and crack the keypad code to reach the EXIT, on your own or with up to 12 in a room.',
      'Spire is back, with a checkpoint at every landing, four new sections, and coins to grab on the way up and spend on hats.'
    ]},
    {date: '2026-10-29', version: '1.10', title: 'New Backrooms every round', kind: 'feature', items: [
      'Backrooms: Level 0 gets a fresh random layout every round, with corridors, offices, pillar halls and dark patches, so no two rounds play the same.',
      'Gridpop: blocks are easier to place. The piece floats above your finger, snaps to the nearest free spot and lands exactly where its outline shows.',
      'Shell Crackers runs smoother on slow laptops, other eggs are never drawn inside walls, and nobody spawns inside a wall or gets launched onto a roof when stuck.',
      'Slipstream: every lap you finish now counts for the fastest-lap boards, and cutting the track only adds time to your race, not to your laps.',
      'Change your name and it now shows everywhere within a few seconds: Online, Party and the Leaderboards.',
      'The site\'s owners now wear a Captain badge, one step above Private Jet.'
    ]},
    {date: '2026-10-29', version: '1.9', title: 'Avatars and status tiers', kind: 'feature', items: [
      'Everyone now has an avatar: a little face drawn from your account, the same wherever your name shows (Online, Party, Leaderboards).',
      'Miles with us: play time and wins add up to a status tier next to your name, from Economy through Business Class and First Class to Private Jet. Your own card says how far you are from the next one.',
      'Tiers come from the same self-reported numbers as the leaderboards, so they\'re for bragging rights.'
    ]},
    {date: '2026-10-28', version: '1.8.1', title: 'Fixes for walls, laps and online play', kind: 'fix', items: [
      'Backrooms: building a wall or floor on someone, standing on an edge or walking up a ramp under a floor can no longer put you inside a wall, and other players are never drawn inside one.',
      'Chromaflage: no more slipping between wall pieces or squeezing under chairs and low furniture.',
      'Slipstream: the fastest-lap board works again, and opens on a new All tracks view with the record for every track.',
      'Shell Crackers, Backrooms and Rumble Karts now count your deaths, and have a K/D board (you need 20 kills to show up).',
      'Online games wait longer for a slow sign-in and say so, Rumble Karts rooms hold up to 12 karts, and Coil and Boostball bots keep moving when the host switches tabs.',
      'Spire has been archived, so it\'s no longer on the games list or in Parties. Your Spire bests stay on the Leaderboards.'
    ]},
    {date: '2026-10-28', version: '1.8', title: 'New maps, modes and weapons', kind: 'feature', items: [
      'Chromaflage: six new maps (a school, an office, a supermarket, a hotel, a leisure centre and a block of flats). Online rooms play three of the nine each day and switch map every 15 minutes.',
      'Rumble Karts: two new weapons, Nico\'s Cream Cannon (slows and splats whoever it hits) and the rare Angry Whip.',
      '2048: new Mega (6 × 6), College and Dessert modes, each with its own best score and leaderboard.',
      'Parties: ask to join someone\'s party from their card, and the leader can remove people. You can also block someone just until you close the tab.'
    ]},
    {date: '2026-10-28', version: '1.7', title: 'Deepword', kind: 'game', games: ['Deepword'], items: [
      'A daily word dive: eight prompts a day, the same for everyone, and the rarer your answer, the deeper you sink.',
      'Blowfish Brawl: up to 12 players get the same prompt, and an answer someone already sent puffs you up. Three puffs and you pop.'
    ]},
    {date: '2026-10-23', title: 'Four puzzle games', kind: 'game', games: ['Gridpop', '2048', 'Stackfall', 'Melon Merge'], items: [
      'Gridpop: drag blocks onto an 8 × 8 grid and pop full rows and columns. Clear again quickly to build a combo.',
      '2048: slide and join number tiles until you make 2048, then keep going.',
      'Stackfall: falling blocks in two modes, Classic line clears and Sand, where pieces crumble and any colour that links wall to wall dissolves.',
      'Melon Merge: drop fruit into a jar and squish matching pairs together, all the way up to a watermelon.'
    ]},
    {date: '2026-10-21', version: '1.6', title: 'Online panel and cabin chat', kind: 'feature', items: [
      'A new Online panel under Party shows who else has the Back Room open, and whether they\'re idle, in a party or in a game.',
      'Tap someone to send a private message, invite them to your party, or invite them into the room you\'re playing in.',
      'Cabin chat: one shared chat for everyone online, with Mute and Block if you need them.',
      'Got an idea or found a bug? The "Tell Arjun" box at the top of the page sends it straight to him.',
      'Smoother online movement: other players glide instead of jumping around on slow school Wi-Fi, in Shell Crackers, Backrooms, Chromaflage, Odd One Out, Spire, Updraft and Coil.',
      'This What\'s new list, so you can see what changed since you last played.'
    ]},
    {date: '2026-10-20', version: '1.5', title: 'Four new games and 4v4 Backrooms', kind: 'game',
     games: ['Spire', 'Updraft', 'Odd One Out', 'Tumble Trials', 'Chromaflage'], items: [
      'New game: Spire, an obby race up a tower stacked from random sections. By the evening it got higher jumps, faster running and a fresh look.',
      'Spire first person: press V (or the eye button on a phone) to climb from your own eyes.',
      'New game: Updraft, a 1,000 m climb from a city street to the edge of space, with no checkpoints.',
      'Updraft slow motion: hold F (or Slow on a phone) in mid-air to line up a tricky landing. The clock keeps running, though.',
      'New game: Odd One Out, Props vs Hunters for up to 16. Turn into anything in the room and keep very still.',
      'New game: Tumble Trials, a wobbly knockout show for up to 16. Last bean standing wins the crown.',
      'New game: Chromaflage, hide and seek where you paint yourself to match the room.',
      'Chromaflage v2: smaller characters that can stick to walls, bigger maps and lots more to hide behind.',
      'Chromaflage v3: a rounder, softer doll and three new maps, Hollyhock Manor, Marlowe Museum and Kirinoya Inn.',
      'Backrooms now has teams: Red vs Blue from 1v1 up to 4v4, in rooms of up to 8.',
      'Rebindable keys: most keyboard games have a Controls button to change any key (and mouse buttons in some).',
      'Boostball: a landing marker shows where the ball will come down, wall driving is smoother, play goes on at 0:00 until the ball lands, kickoffs can\'t squeeze the ball through a car, and braking is softer.',
      'Parties: everyone now joins a game under their party name, and the party game list works again.',
      'Starhop, Quarry, Kartwheel, Abyssal and Hail Mary have been archived to make room for the new games.'
    ]},
    {date: '2026-10-18', version: '1.4', title: 'Parties and a training range', kind: 'feature', items: [
      'Parties: group up with up to 8 friends, and the leader takes everyone into the same game room at once.',
      'Shell Crackers Training range: bullseye boards, balloons and moving dummies to sharpen your aim, with hit and accuracy stats.',
      'Slipstream bots are faster: they brake later, boost out of corners and no longer slow down for nothing.',
      'Slipstream track limits are gentler: running wide only costs you time, and only a corner cut that gains time adds a 1-second penalty.'
    ]},
    {date: '2026-10-17', version: '1.3', title: 'The Back Room on your phone', kind: 'feature', items: [
      'A phone version of the Back Room with every game as a tile. Add it to your home screen and it opens like an app.',
      'Touch controls for Shell Crackers, Backrooms and Quarry.',
      'Touch buttons no longer overlap in Kartwheel, Slipstream and Boostball, and Rumble Karts and Abyssal fit phone screens better.'
    ]},
    {date: '2026-10-15', version: '1.2', title: 'New Shell Crackers maps', kind: 'feature', items: [
      'Shell Crackers has new, bigger maps built from blocks: Farmstead, Yolk Works and Eggsburg, with buildings to go inside, upper floors, rooftops and tunnels underneath.',
      'The Back Room now shows games three to a row on wide screens.'
    ]},
    {date: '2026-10-14', version: '1.1', title: 'Showdown poker and real circuits', kind: 'game', games: ['Showdown'], items: [
      'New game: Showdown, no-limit Texas Hold\'em for up to 8, with bots to fill the table. The bots also stopped folding to every all-in.',
      'Slipstream: real Grand Prix circuits, a V10 engine sound, DRS and F1-style track limits, plus smoother contact between cars online.',
      'Boostball: drive up the walls, with real drifting and quicker stopping.',
      'Shell Crackers ranked: the more real players in a match, the more your rating moves.',
      'Quarry: combat and XP, weather, animals and farming.'
    ]},
    {date: '2026-10-13', version: '1.0', title: 'Trivium arrives', kind: 'game', games: ['Trivium'], items: [
      'New game: Trivium, with about 1,800 questions: a Daily ten, quick play by category, Survival, Blitz and live contests with friends.',
      'The most played games now come first.',
      'Kartwheel: proper power slides, like the old-school kart games.',
      'Quarry: every overworld ore, deepslate, much bigger caves, the Nether and the End, and a smoother frame rate.'
    ]}
  ];

  var KIND = { game: 'New game', feature: 'Update', fix: 'Bug fix' };
  var ICON = { game: '🎮', feature: '✨', fix: '🔧' };
  var PAGE = 5;      // days shown at first, and added by each "Show older"
  var NEW_DAYS = 7;  // how long an entry's games get the "New games!" row on the strip
  var MAX_CHIPS = 6;
  var SEEN = 'news:seen';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var HUES = ['#23946A', '#D9663A', '#4F74D9', '#B14FA5', '#C08D12', '#2A9D9D'];  // chip colours, in turn

  // A game named in `games`: 'Melon Merge' (folder melon-merge) or 'Name:folder'.
  function gameOf(s) {
    if (typeof s !== 'string' || !s.trim()) return null;
    var i = s.lastIndexOf(':'), n = i > 0 ? s.slice(0, i) : s, d = i > 0 ? s.slice(i + 1) : '';
    n = n.trim().slice(0, 40);
    d = (d || n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return n && /^[a-z0-9-]{1,40}$/.test(d) ? { n: n, d: d } : null;
  }
  function gamesOf(e) { return Array.isArray(e.games) ? e.games.map(gameOf).filter(Boolean) : []; }

  // Keep only well-formed entries, newest first.
  var list = NEWS.filter(function (e) {
    return e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.title === 'string' && Array.isArray(e.items);
  }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  window.BackRoomNews = { entries: list.map(function (e) { return { date: e.date, version: e.version, title: e.title, kind: e.kind, games: gamesOf(e).map(function (g) { return g.n; }), items: e.items.slice() }; }) };
  if (!list.length) return;

  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function key(e) { return e.date + '|' + (e.version || ''); }
  function local(d) { var p = d.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function daysAgo(d) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((t - local(d)) / 864e5);
  }
  function short(d) {
    var x = local(d), s = MON[x.getMonth()] + ' ' + x.getDate();
    return x.getFullYear() === new Date().getFullYear() ? s : s + ', ' + x.getFullYear();
  }
  function rel(d) { var n = daysAgo(d); return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : short(d); }
  function kindOf(e) { return KIND[e.kind] ? e.kind : 'feature'; }
  function label(e) { return KIND[kindOf(e)] + (e.version ? ' ' + e.version : ''); }
  function el(tag, cls, text) { var x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; }

  // How many entries at the top haven't been opened in this browser. Nothing saved yet: just the latest.
  function unseen() {
    var s = store(SEEN);
    if (!s) return 1;
    for (var i = 0; i < list.length; i++) if (key(list[i]) === s) return i;
    var d = String(s).split('|')[0];
    return list.filter(function (e) { return e.date > d; }).length;
  }

  // Games from entries of the last NEW_DAYS days, newest first, each once.
  function freshGames() {
    var out = [], seen = {};
    list.forEach(function (e) {
      var n = daysAgo(e.date);
      if (n < 0 || n > NEW_DAYS) return;
      gamesOf(e).forEach(function (g) { if (!seen[g.d]) { seen[g.d] = 1; out.push(g); } });
    });
    return out;
  }

  // Open a game: in the page's game layer when there is one (home page, phone page), else by following the link.
  var BASE = (function () {
    var me = document.currentScript;
    return (me && me.src ? new URL(me.src, location.href).pathname : '/e63334287a3deaa3/news.js').replace(/[^/]*$/, '');
  })();
  function chip(g, i, link) {
    var c = el(link ? 'a' : 'span', 'nws-chip', null);
    c.style.setProperty('--h', HUES[i % HUES.length]);
    if (link) {
      c.href = BASE + g.d + '/';
      var tri = el('span', 'nws-play', '▶'); tri.setAttribute('aria-hidden', 'true');
      c.append(tri, g.n);
      c.setAttribute('aria-label', 'Play ' + g.n);
      c.addEventListener('click', function (ev) {
        var br = window.BackRoom;
        if (br && typeof br.openGame === 'function' && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey) { ev.preventDefault(); br.openGame(c.getAttribute('href'), g.n); }
      });
    } else c.textContent = g.n;
    return c;
  }

  function start() {
    if (document.getElementById('news')) return;
    var head = document.querySelector('header');
    if (!head || !head.parentNode) return;

    // Colours: the page's own variables (light Back Room page, dark phone page). Text on a tint mixes the hue with
    // --ink, so it's darker than the hue on a light page and lighter on a dark one.
    var css = document.createElement('style');
    css.textContent =
      '.nws{--nws-g:var(--accent,#1d6a4b);--nws-w:#C0562F;position:relative;margin:20px 0 0;border:1px solid color-mix(in srgb,var(--nws-g) 32%,var(--line,#d3dad2));border-radius:14px;' +
        'background:linear-gradient(100deg,color-mix(in srgb,var(--nws-g) 10%,var(--panel,#fff)) 0%,var(--panel,#fff) 42%,var(--panel,#fff) 62%,color-mix(in srgb,var(--nws-w) 8%,var(--panel,#fff)) 100%);' +
        'box-shadow:0 8px 22px -16px var(--nws-g);color:var(--ink,#16201b);font-family:var(--body,system-ui,sans-serif);font-size:14px;line-height:1.45}' +
      '#home > .nws{margin:0 0 18px}' +
      '.nws *{box-sizing:border-box}.nws [hidden]{display:none!important}' +
      '.nws.hot{box-shadow:0 0 0 3px color-mix(in srgb,var(--nws-g) 12%,transparent),0 10px 26px -14px var(--nws-g)}' +
      '.nws-bar{display:flex;align-items:center;gap:10px;width:100%;min-height:46px;padding:8px 14px;background:none;border:0;border-radius:14px;color:inherit;font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.nws-bar:hover .nws-t{text-decoration:underline}' +
      '.nws-bar:focus-visible{outline:2px solid var(--nws-g);outline-offset:2px}' +
      '.nws-k{flex:none;display:inline-flex;align-items:center;gap:7px;font-family:var(--mono,monospace);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--nws-g);white-space:nowrap}' +
      '.nws-dot{width:8px;height:8px;border-radius:50%;background:var(--down,#b42318);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--down,#b42318) 25%,transparent);animation:nws-pulse 2s ease-in-out infinite}' +
      '@keyframes nws-pulse{50%{box-shadow:0 0 0 6px color-mix(in srgb,var(--down,#b42318) 0%,transparent)}}' +
      '.nws-v{flex:none;display:inline-flex;align-items:center;gap:5px;font-family:var(--mono,monospace);font-size:12px;font-weight:600;white-space:nowrap;border-radius:999px;padding:2px 9px 2px 6px;' +
        'color:color-mix(in srgb,var(--kc) 55%,var(--ink,#16201b));background:color-mix(in srgb,var(--kc) 14%,transparent);border:1px solid color-mix(in srgb,var(--kc) 35%,transparent)}' +
      '.nws-ic{font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;font-size:14px;line-height:1}' +
      '.nws-t{flex:1 1 auto;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.nws-d{flex:none;font-family:var(--mono,monospace);font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;color:var(--nws-g);background:color-mix(in srgb,var(--nws-g) 13%,transparent);border-radius:999px;padding:3px 9px}' +
      '.nws-chev{flex:none;font-family:var(--mono,monospace);font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2,#4a5751);border:1px solid var(--line,#d3dad2);background:var(--panel,#fff);border-radius:999px;padding:3px 10px}' +
      '.nws-chev i{font-style:normal;display:none}' +
      '.nws-e.k-game,.nws-v.k-game{--kc:var(--nws-g)}.nws-e.k-feature,.nws-v.k-feature{--kc:#3E5BA9}.nws-e.k-fix,.nws-v.k-fix{--kc:#C0562F}' +
      // "New games!" row
      '.nws-fresh{display:flex;flex-wrap:wrap;align-items:center;gap:7px 8px;padding:0 14px 11px}' +
      '.nws-fl{display:inline-flex;align-items:center;gap:6px;margin-right:2px;font-family:var(--display,var(--f-d,"Arial Narrow",sans-serif));font-weight:800;font-size:19px;line-height:1;letter-spacing:.03em;text-transform:uppercase;' +
        'background:linear-gradient(90deg,var(--nws-g),color-mix(in srgb,var(--nws-w) 85%,var(--nws-g)),var(--nws-g));background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:nws-sheen 6s linear infinite}' +
      '.nws-fl .nws-ic{color:initial;-webkit-text-fill-color:initial;font-size:17px}' +
      '@keyframes nws-sheen{to{background-position:-200% 0}}' +
      '.nws-chip{--h:#1D6A4B;display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:4px 12px 4px 10px;border-radius:999px;font-weight:600;font-size:13.5px;line-height:1.1;text-decoration:none;white-space:nowrap;' +
        'color:color-mix(in srgb,var(--h) 45%,var(--ink,#16201b));background:color-mix(in srgb,var(--h) 15%,var(--panel,#fff));border:1px solid color-mix(in srgb,var(--h) 42%,transparent);transition:transform .15s ease,background .15s ease}' +
      'a.nws-chip:hover{transform:translateY(-1px);background:color-mix(in srgb,var(--h) 24%,var(--panel,#fff))}' +
      'a.nws-chip:focus-visible{outline:2px solid var(--h);outline-offset:2px}' +
      '.nws-play{font-size:9px;line-height:1;width:18px;height:18px;border-radius:50%;display:inline-grid;place-items:center;padding-left:1px;background:var(--h);color:#fff}' +
      '.nws-plus{font-size:13px;color:var(--ink-2,#4a5751)}' +
      '@media (max-width:560px){.nws-bar{flex-wrap:wrap;row-gap:5px}.nws-t{flex-basis:100%;order:5;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.nws-d{margin-left:auto}.nws-chev b{display:none}.nws-chev i{display:inline}.nws-chev{padding:2px 8px}' +
        '.nws-fl{flex-basis:100%;font-size:18px}.nws-chip{font-size:13px;min-height:32px}}' +
      // the open list
      '.nws-body{border-top:1px solid color-mix(in srgb,var(--nws-g) 22%,var(--line,#d3dad2));padding:4px 14px 14px}' +
      '.nws-day{padding:12px 0 2px}' +
      '.nws h3.nws-dh{margin:0 0 9px;font-family:var(--mono,monospace);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2,#4a5751)}' +
      '.nws-dh b{color:var(--nws-g);font-weight:600}' +
      '.nws-e{--kc:var(--nws-g);margin:0 0 10px;padding:12px 14px 12px 15px;border-radius:12px;background:var(--panel-2,#f6f8f4);border:1px solid var(--line,#d3dad2);border-left:4px solid var(--kc)}' +
      '.nws-eh{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:0 0 6px}' +
      '.nws-tag{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono,monospace);font-size:11.5px;font-weight:600;letter-spacing:.04em;white-space:nowrap;border-radius:999px;padding:2px 9px 2px 6px;' +
        'color:color-mix(in srgb,var(--kc) 55%,var(--ink,#16201b));background:color-mix(in srgb,var(--kc) 14%,transparent);border:1px solid color-mix(in srgb,var(--kc) 35%,transparent)}' +
      '.nws-et{flex-basis:100%;font-family:var(--display,var(--f-d,"Arial Narrow",sans-serif));font-weight:800;font-size:22px;line-height:1.05;letter-spacing:.02em;text-transform:uppercase;min-width:0;overflow-wrap:anywhere;order:5}' +
      '.nws-new{font-family:var(--mono,monospace);font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:var(--down,#b42318);border-radius:999px;padding:2px 8px}' +
      '.nws-eg{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 8px}' +
      '.nws-eg .nws-chip{min-height:26px;font-size:12.5px;padding:3px 10px}' +
      '.nws ul{margin:0;padding:0 0 0 20px;color:var(--ink-2,#4a5751)}' +
      '.nws li{margin:4px 0;overflow-wrap:anywhere}' +
      '.nws li::marker{color:var(--kc)}' +
      '.nws-acts{display:flex;flex-wrap:wrap;gap:10px;padding-top:6px}' +
      '.nws-acts button{font:inherit;font-weight:600;font-size:14px;min-height:40px;padding:6px 16px;border-radius:999px;border:1px solid var(--line,#d3dad2);background:var(--panel-2,#f6f8f4);color:var(--ink,#16201b);cursor:pointer}' +
      '.nws-acts button:hover{border-color:var(--ink-2,#4a5751)}' +
      '@media (prefers-reduced-motion:reduce){.nws-dot,.nws-fl{animation:none}.nws-chip{transition:none}}';
    document.head.appendChild(css);

    var latest = list[0], fresh = unseen(), shown = 0, games = freshGames();
    var box = el('div', 'nws' + (games.length ? ' hot' : '')); box.id = 'news'; box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'What\'s new');
    var bar = el('button', 'nws-bar'); bar.type = 'button'; bar.setAttribute('aria-expanded', 'false'); bar.setAttribute('aria-controls', 'nws-body');
    var k = el('span', 'nws-k'), dot = el('span', 'nws-dot'), dotTxt = el('span', '', ' (new)');
    dot.setAttribute('aria-hidden', 'true'); dotTxt.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
    k.append(dot, 'What\'s new', dotTxt);
    var v = el('span', 'nws-v k-' + kindOf(latest)), vi = el('span', 'nws-ic', ICON[kindOf(latest)]);
    vi.setAttribute('aria-hidden', 'true');
    v.append(vi, latest.version ? 'v' + latest.version : KIND[kindOf(latest)]);
    v.title = KIND[kindOf(latest)];
    var t = el('span', 'nws-t', latest.title);
    var d = el('span', 'nws-d', rel(latest.date)); d.title = short(latest.date);
    var chev = el('span', 'nws-chev'); chev.setAttribute('aria-hidden', 'true');
    var chevB = el('b', '', 'Open'), chevI = el('i', '', '▾'); chev.append(chevB, chevI);
    bar.append(k, v, t, d, chev);

    // "New games!" and a chip for each game less than a week old (links, so they work as links too).
    var row = null;
    if (games.length) {
      row = el('div', 'nws-fresh');
      var fl = el('span', 'nws-fl'), fi = el('span', 'nws-ic', '🎮'); fi.setAttribute('aria-hidden', 'true');
      fl.append(fi, games.length === 1 ? 'New game!' : 'New games!');
      row.appendChild(fl);
      games.slice(0, MAX_CHIPS).forEach(function (g, i) { row.appendChild(chip(g, i, true)); });
      if (games.length > MAX_CHIPS) row.appendChild(el('span', 'nws-plus', '+' + (games.length - MAX_CHIPS) + ' more'));
    }

    var body = el('div', 'nws-body'); body.id = 'nws-body'; body.hidden = true;
    var days = el('div', 'nws-days');
    var acts = el('div', 'nws-acts'), more = el('button', 'nws-more'), shut = el('button', 'nws-x', 'Close');
    more.type = 'button'; shut.type = 'button'; acts.append(more, shut);
    body.append(days, acts);
    box.append(bar);
    if (row) box.append(row);
    box.append(body);

    function showDot() { dot.hidden = dotTxt.hidden = fresh <= 0; }
    showDot();

    // Group by date (the list is newest first), then draw PAGE more days each time.
    var groups = [];
    list.forEach(function (e, i) {
      var g = groups[groups.length - 1];
      if (!g || g.date !== e.date) groups.push(g = { date: e.date, entries: [] });
      g.entries.push({ e: e, i: i });
    });
    var newUpTo = fresh;  // entries above this index get a "New" tag in the open list
    function drawMore() {
      var end = Math.min(groups.length, shown + PAGE);
      for (; shown < end; shown++) {
        var g = groups[shown], day = el('div', 'nws-day'), h = el('h3', 'nws-dh'), n = daysAgo(g.date), x = local(g.date);
        var full = DAY[x.getDay()] + ', ' + short(g.date);
        if (n === 0 || n === 1) { h.append(el('b', '', n === 0 ? 'Today' : 'Yesterday'), ' · ' + full); } else h.textContent = full;
        day.appendChild(h);
        g.entries.forEach(function (it) {
          var e = it.e, kd = kindOf(e), art = el('article', 'nws-e k-' + kd), eh = el('p', 'nws-eh');
          var tag = el('span', 'nws-tag'), ti = el('span', 'nws-ic', ICON[kd]); ti.setAttribute('aria-hidden', 'true');
          tag.append(ti, label(e));
          eh.append(tag, el('span', 'nws-et', e.title));
          if (it.i < newUpTo) eh.appendChild(el('span', 'nws-new', 'New'));
          art.appendChild(eh);
          var gs = gamesOf(e);
          if (gs.length) {
            var eg = el('div', 'nws-eg'); eg.setAttribute('aria-label', gs.length === 1 ? 'New game' : 'New games');
            gs.forEach(function (gm, j) { eg.appendChild(chip(gm, j, false)); });
            art.appendChild(eg);
          }
          var ul = el('ul');
          e.items.forEach(function (s) { if (typeof s === 'string' && s) ul.appendChild(el('li', '', s)); });
          art.appendChild(ul); day.appendChild(art);
        });
        days.appendChild(day);
      }
      var left = groups.length - shown;
      more.hidden = left <= 0;
      more.textContent = 'Show older (' + left + (left === 1 ? ' more day)' : ' more days)');
    }

    function setOpen(o) {
      if (o && !shown) drawMore();
      body.hidden = !o; box.toggleAttribute('data-open', o);
      bar.setAttribute('aria-expanded', o ? 'true' : 'false');
      chevB.textContent = o ? 'Close' : 'Open'; chevI.textContent = o ? '▴' : '▾';
      if (o && fresh > 0) { fresh = 0; store(SEEN, key(latest)); showDot(); }
      if (!o) bar.focus({ preventScroll: true });
    }
    bar.addEventListener('click', function () { setOpen(body.hidden); });
    shut.addEventListener('click', function () { setOpen(false); });
    more.addEventListener('click', function () {
      var first = shown; drawMore();
      var h = days.children[first] && days.children[first].querySelector('h3');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    });
    box.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !body.hidden) { e.stopPropagation(); setOpen(false); } });

    // Sit right under the header. party.js also inserts its panel right after the header, and may
    // run after this, so move back above it whenever something lands in between.
    function place() {
      var h = document.querySelector('header');
      if (h && h.parentNode && box.previousElementSibling !== h) h.parentNode.insertBefore(box, h.nextSibling);
    }
    place();
    if (window.MutationObserver) new MutationObserver(place).observe(head.parentNode, { childList: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
