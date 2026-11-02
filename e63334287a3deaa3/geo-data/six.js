/*
 * The six-guess game shared by Outline (a country's shape) and Unfurl (its flag). Load after geo.js.
 * Geo.six(cfg) runs the page: mode switch, guess rows (distance, direction arrow, proximity), the guess box, the
 * daily record, sharing, and the end card. The page only draws its own picture through cfg hooks:
 *   cfg.slug, cfg.name, cfg.how (html), cfg.pool (answer ids), cfg.max (6)
 *   cfg.draw(st, info)   draw the picture for state st (info.wrong = wrong guesses so far, info.done)
 *   cfg.noun             what the picture is ("outline", "flag") for messages
 * The daily answer is Geo.answerFor(slug, day). Saved progress: '<slug>:day' {day, guesses, done, win, t0, t1}.
 */
(function () {
  'use strict';
  var G = window.Geo, h = G.h, $ = G.$;
  G.six = function (cfg) {
    var SLUG = cfg.slug, MAX = cfg.max || 6;
    var DIST = []; for (var i = 1; i <= MAX; i++) DIST.push([String(i), String(i)]); DIST.push(['X', '✗']);
    var st = null, globe = null, view = 'pic';
    var S = G.shell({ slug: SLUG, name: cfg.name, how: cfg.how, foot: cfg.foot, dist: DIST, shareText: function () { return st && st.done ? shareText() : null; } });
    var panel = $('panel'), list = $('list'), endBox = $('endBox');
    var mb = G.modeBar(panel, function (m) { start(m); });
    panel.insertBefore(mb.el, list);
    var box = G.entry({ parent: panel, onGuess: guess, used: function (id) { return st && st.guesses.indexOf(id) >= 0; }, toast: S.toast, placeholder: 'Which country?' });
    // stage switch shown after the game: the picture or the answer on the globe
    var sw = h('div', { class: 'seg stageSeg', hidden: '' }, [
      h('button', { type: 'button', text: cfg.picLabel || 'Picture', onclick: function () { setView('pic'); } }),
      h('button', { type: 'button', text: 'Globe', onclick: function () { setView('globe'); } })]);
    $('stage').appendChild(sw);
    var gc = h('canvas', { class: 'stage-canvas', hidden: '', 'aria-label': 'Globe showing the answer' });
    $('stage').appendChild(gc);

    function wrong() { return st.guesses.filter(function (id) { return id !== st.answer; }).length; }
    function save() { if (st.mode === 'daily') G.store.set(SLUG + ':day', { day: st.day, guesses: st.guesses, done: st.done, win: st.win, t0: st.t0, t1: st.t1 }); }
    function start(m) {
      if (m === 'daily') {
        var day = G.today(), saved = G.store.get(SLUG + ':day', null);
        st = { mode: 'daily', day: day, answer: G.answerFor(SLUG, day), guesses: [], done: false, win: false, t0: 0, t1: 0 };
        if (saved && saved.day === day && Array.isArray(saved.guesses)) {
          st.guesses = saved.guesses.filter(function (id) { return G.byId[id]; }).slice(0, MAX);
          st.done = !!saved.done; st.win = !!saved.win; st.t0 = saved.t0 || 0; st.t1 = saved.t1 || 0;
        }
      } else {
        var last = st && st.answer, a;
        do { a = cfg.pool[Math.floor(Math.random() * cfg.pool.length)]; } while (a === last && cfg.pool.length > 1);
        st = { mode: 'free', day: '', answer: a, guesses: [], done: false, win: false, t0: 0, t1: 0 };
      }
      mb.set(m, true); view = 'pic';
      box.clear(); render();
    }
    function guess(c) {
      if (!st || st.done) return false;
      if (!st.t0) st.t0 = Date.now();
      st.guesses.push(c.id);
      if (c.id === st.answer) finish(true);
      else if (st.guesses.length >= MAX) finish(false);
      save(); render(c.id);
      if (!st.done) S.toast(c.name + ' isn\'t it: ' + G.fmtKm(G.km(c.id, st.answer)) + ' ' + G.dirName(G.bearing(c.id, st.answer)), 1500);
      return true;
    }
    function finish(win) {
      st.done = true; st.win = win; st.t1 = Date.now();
      var n = st.guesses.length;
      if (st.mode === 'daily') {
        G.Daily.finish(SLUG, st.day, { win: win, score: win ? n : null, tries: n, time: st.t0 ? (st.t1 - st.t0) / 1000 : null, dist: win ? String(n) : 'X' });
        if (win) try { window.BackRoomStats && BackRoomStats.min('tries', n); } catch (e) {}
        setTimeout(function () { if (!S.isOpen()) S.openStats(win ? String(n) : 'X'); }, 1600);
      }
    }
    function squares(p) { var f = Math.floor(p / 20), r = p - f * 20, s = ''; for (var i = 0; i < 5; i++) s += i < f ? '🟩' : i === f && r >= 10 ? '🟨' : '⬛'; return s; }
    function shareText() {
      var lines = st.guesses.map(function (id) {
        if (id === st.answer) return '🟩🟩🟩🟩🟩🎉';
        return squares(G.proximity(G.km(id, st.answer))) + G.arrow(G.bearing(id, st.answer));
      });
      return G.shareText(cfg.name, G.dayNum(st.day || G.today()), (st.win ? st.guesses.length : 'X') + '/' + MAX, lines.join('\n'), st.mode);
    }
    function setView(v) {
      view = v;
      sw.children[0].classList.toggle('on', v === 'pic'); sw.children[1].classList.toggle('on', v === 'globe');
      gc.hidden = v !== 'globe';
      if (cfg.picEl) cfg.picEl().hidden = v === 'globe';
      if (v === 'globe') G.loadShapes().then(function () {
        if (!globe) globe = new G.Globe(gc, { style: gstyle, labels: glabels, fitMax: 6 });
        else globe.resize();
        globe.fit([st.answer], 0, 0.3); globe.draw();
      }).catch(function () { S.toast('Couldn\'t load the map'); });
      else cfg.draw(st, { wrong: wrong(), done: st.done });
    }
    function gstyle(id) {
      if (!st) return null;
      if (id === st.answer) return { fill: st.win ? '#5ef08f' : '#4fe3c1', stroke: '#eafff4', lw: 1.5 };
      if (st.guesses.indexOf(id) >= 0) return { fill: '#ff7a59' };
      return null;
    }
    function glabels() {
      var a = G.byId[st.answer], out = [{ id: st.answer, text: a.name, size: 14, ring: a.area < 30000 ? 10 : 0, ringColor: '#5ef08f' }];
      st.guesses.forEach(function (id) { if (id !== st.answer) out.push({ id: id, text: G.byId[id].name, size: 11, color: '#ffd6c9' }); });
      return out;
    }
    function render(newId) {
      list.innerHTML = '';
      for (var i = 0; i < MAX; i++) {
        var id = st.guesses[i];
        if (!id) { list.appendChild(h('div', { class: 'g empty', 'aria-hidden': 'true' }, [h('span', { class: 'nm', text: '' })])); continue; }
        var c = G.byId[id], win = id === st.answer, d = G.km(id, st.answer), b = G.bearing(id, st.answer);
        list.appendChild(h('div', { class: 'g' + (win ? ' win' : '') + (id === newId ? ' new' : '') }, [
          h('span', { class: 'nm', text: c.name }),
          h('span', { class: 'km', text: win ? '' : G.fmtKm(d) }),
          h('span', { class: 'ar', text: win ? '🎉' : G.arrow(b), title: win ? 'Correct' : 'The answer is ' + G.dirName(b) }),
          h('span', { class: 'pc', text: (win ? 100 : G.proximity(d)) + '%' })]));
      }
      var n = st.guesses.length;
      mb.info.innerHTML = st.done ? '' : '<b>' + (MAX - n) + '</b> guess' + (MAX - n === 1 ? '' : 'es') + ' left';
      box.enable(!st.done);
      endBox.hidden = !st.done; endBox.innerHTML = '';
      sw.hidden = !st.done;
      if (st.done) {
        var a = G.byId[st.answer];
        endBox.className = 'end';
        endBox.append(
          h('h2', { class: st.win ? 'win' : 'lose', text: st.win ? (n === 1 ? 'First try! ' : 'Got it! ') + 'It\'s ' + a.name : 'It was ' + a.name }),
          h('p', { html: st.win ? 'You named the ' + cfg.noun + ' in <b>' + n + '/' + MAX + '</b>.' : 'Out of guesses this time. Have a look at where it is on the globe.' }),
          h('div', { class: 'row' }, [
            h('button', { type: 'button', class: 'cta', text: 'Share', onclick: function () { S.share(); } }),
            h('button', { type: 'button', class: 'ghost', text: st.mode === 'daily' ? 'Play unlimited' : 'Next one', onclick: function () { start('free'); } }),
            st.mode === 'daily' ? h('span', { class: 'next', id: 'nextIn', text: 'Next in ' + G.countdown() }) : null]));
      }
      setView(view);
    }
    setInterval(function () { var e = $('nextIn'); if (e) e.textContent = 'Next in ' + G.countdown(); if (st && st.mode === 'daily' && st.day !== G.today() && !box.input.value) start('daily'); }, 1000);
    window.addEventListener('resize', function () { if (st && view === 'pic') cfg.draw(st, { wrong: wrong(), done: st.done }); });
    start('daily');
    box.focus();
    return { get st() { return st; }, start: start, guess: function (t) { box.submitText(t); }, shareText: shareText, setView: setView, get globe() { return globe; } };
  };
})();
