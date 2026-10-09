/* CricketCG – commentator screen for the other sports. Read-only; recomputes from the shared event log. */
(function () {
  'use strict';
  const { $, esc } = CG;
  const REEL_MS = 7000;
  if (!CG.store.get('cgName', '')) CG.store.set('cgName', 'Commentary box');

  const stage = $('#stage');
  function fit() {
    // a phone, or a tablet held upright: one column you scroll, scaled to the screen's width
    // (a phone may report a wider window while the 1920 px stage is still on it: screen.width is the real width)
    const vw = Math.min(window.innerWidth, (window.screen && screen.width) || window.innerWidth), vh = Math.min(window.innerHeight, (window.screen && screen.height) || window.innerHeight);
    const narrow = vw < 900 && vw / vh < 1.3;
    document.body.classList.toggle('narrow', narrow); document.documentElement.classList.toggle('narrow', narrow);
    if (narrow) {
      const k = vw / 600;
      stage.style.width = '600px'; stage.style.transform = `scale(${k})`; stage.style.left = '0px'; stage.style.top = '0px';
    } else {
      const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      stage.style.width = ''; stage.style.transform = `scale(${k})`;
      stage.style.left = ((window.innerWidth - 1920 * k) / 2) + 'px';
      stage.style.top = ((window.innerHeight - 1080 * k) / 2) + 'px';
    }
    sizeReel();
  }
  window.addEventListener('resize', fit);

  setInterval(() => {
    $('#offline').style.display = CG.connected ? 'none' : 'flex';
    document.querySelectorAll('[data-sclock]').forEach(el => {
      const v = CG.sportView();
      el.textContent = CG.fmtClock(CG.clockMs(el.dataset.sclock), el.dataset.sclock === 'shot' ? 10 : (v && v.sport === 'basketball' ? 60 : 0));
    });
  }, 100);

  const sw = (v, k) => (k ? v.teams[k].color1 : '#556');

  CG.on('state', render);
  function render() {
    const v = CG.sportView();
    if (!v) { $('#head').innerHTML = '<div></div><div class="mid"><div class="per">NO SPORT EVENT</div><div class="status">Set one up in the Sports scorer</div></div><div></div>'; return; }
    const x = v.extra, T = v.teams;

    // ---------------- header
    if (v.kind === 'athletics') {
      $('#head').innerHTML = `<div class="tm up">${esc(v.flat.ath_event || 'ATHLETICS')}</div><div class="mid"><div class="per">${esc(v.flat.ath_round || '')}</div><div class="clk num" data-sclock="game" style="margin:0;font-size:90px">--:--</div></div>
        <div class="tm b"><span class="status">${esc(v.status)}${v.flat.ath_wind ? ' · WIND ' + esc(v.flat.ath_wind) : ''}</span></div>`;
    } else {
      const srv = k => (x.server === k ? '<span class="srv">●</span>' : '');
      const clockHtml = v.kind === 'timed' ? `<span class="clk num" data-sclock="game">--:--</span>${v.clock.shot ? ' <span class="clk num" style="color:var(--red)" data-sclock="shot">--</span>' : ''}` : '';
      const flag = x.flag ? `<div class="flag">${esc(x.flag)}${x.flagTeam ? ' – ' + esc(T[x.flagTeam].short) : ''}</div>` : '';
      const pts = v.kind === 'sets' ? `<div class="status" style="font-size:40px;color:var(--text)">${esc(x.points.A)} – ${esc(x.points.B)} ${x.games ? `<span class="muted" style="font-size:26px">· GAMES ${x.games.A}-${x.games.B}</span>` : ''}</div>` : '';
      $('#head').innerHTML = `<div class="tm"><span class="sw" style="background:${esc(T.A.color1)}"></span><span class="up">${esc(T.A.name)}</span>${srv('A')}</div>
        <div class="mid"><div class="score num">${esc(v.score.A)}<span>–</span>${esc(v.score.B)}</div><div><span class="per">${esc(v.periodLabel)}</span>${clockHtml}</div>${pts}${flag}
          <div class="status up">${esc(x.flag ? '' : v.status)}</div></div>
        <div class="tm b">${srv('B')}<span class="up">${esc(T.B.name)}</span><span class="sw" style="background:${esc(T.B.color1)}"></span></div>`;
    }

    // ---------------- left: breakdown
    let left = '';
    if (v.kind === 'athletics') {
      const c = x.current;
      const rows = c ? (c.hasResults ? c.results : c.startlist) : [];
      left = `<div class="ttl">${c && c.hasResults ? 'Results' : 'Start list'}</div><table><tr><th>${c && c.hasResults ? 'POS' : 'LANE'}</th><th class="l">ATHLETE</th><th class="l">TEAM</th><th>${c && c.hasResults ? 'RESULT' : 'PB'}</th></tr>
        ${rows.slice(0, 12).map(r => `<tr><td class="t">${esc(c.hasResults ? r.rank : r.lane)}</td><td class="l up">${esc(r.tvName)}</td><td class="l muted">${esc(r.team)}</td><td>${esc(c.hasResults ? r.result + (r.note ? ' ' + r.note : '') : r.pb)}</td></tr>`).join('')}</table>`;
    } else {
      const xc = v.table.extraCols || [];
      left = `<div class="ttl">${esc(v.table.title)}</div><table><tr><th class="l"></th>${v.table.cols.map(c => `<th>${esc(c)}</th>`).join('')}${v.kind === 'baseball' ? xc.map(c => `<th>${c}</th>`).join('') : '<th>T</th>'}</tr>
        ${['A', 'B'].map(k => `<tr><td class="l up">${esc(T[k].short)}</td>${v.table[k].map(c => `<td>${esc(c)}</td>`).join('')}${v.kind === 'baseball' ? v.table['extra' + k].map(c => `<td class="t">${esc(c)}</td>`).join('') : `<td class="t">${esc(v.score[k])}</td>`}</tr>`).join('')}</table>`;
      if (v.kind === 'timed') {
        left += `<div style="margin-top:14px">${['A', 'B'].map(k => `<div class="kv"><span>${esc(T[k].short)} SCORERS</span><b style="font-size:22px;text-align:right;max-width:80%">${esc(v.flat['scorers' + k] || '–')}</b></div>`).join('')}</div>`;
        const gt = Sports.gameTime(v, CG.clockMs('game'));
        const bins = v.sinbins.filter(s => s.untilGt > gt);
        if (bins.length) left += `<div class="kv"><span>SIN BIN / SUSPENDED</span><b>${bins.map(s => `${esc(s.name)} (${esc(T[s.team].short)}) ${CG.fmtClock(s.untilGt - gt)}`).join(', ')}</b></div>`;
        if (v.sport === 'basketball') left += `<div class="kv"><span>TEAM FOULS</span><b>${x.teamFouls.A} – ${x.teamFouls.B}</b></div><div class="kv"><span>TIMEOUTS USED</span><b>${x.timeouts.A} – ${x.timeouts.B}</b></div>`;
        if (x.centrePass) left += `<div class="kv"><span>CENTRE PASS</span><b>${esc(T[x.centrePass].name)}</b></div>`;
      }
      if (v.kind === 'baseball') {
        left += `<div class="bases"><i class="${x.bases[2] ? 'on' : ''}"></i><i class="${x.bases[1] ? 'on' : ''}" style="margin-top:-40px"></i><i class="${x.bases[0] ? 'on' : ''}"></i>
          <span class="big" style="margin-left:30px">${x.balls}-${x.strikes}</span><span class="big muted" style="margin-left:20px">${x.outs} OUT</span></div>
          <div class="kv"><span>AT BAT</span><b>${x.batter ? esc(x.batter.name) + ' · ' + esc(x.batter.line) : '–'}</b></div>
          <div class="kv"><span>PITCHING</span><b>${x.pitcher ? esc(x.pitcher.name) + ' · ' + x.pitcher.pitches + ' PITCHES' : '–'}</b></div>`;
      }
      if (v.kind === 'sets') left += `<div class="kv" style="margin-top:12px"><span>SERVING</span><b class="up">${esc(T[x.server].name)}</b></div>${x.note ? `<div class="kv"><span>NOTE</span><b>${esc(x.note)}</b></div>` : ''}`;
    }
    $('#left').innerHTML = left;

    // ---------------- timeline
    $('#timeline').innerHTML = '<div class="ttl">Timeline</div>' + v.timeline.slice(-13).reverse().map(e =>
      `<div class="ev"><span class="t">${esc(e.ct || '')}</span><span class="c" style="background:${esc(sw(v, e.team))}"></span><span class="up">${esc(e.text)}${e.team && v.kind !== 'athletics' ? ` <span class="muted">(${esc(T[e.team].short)})</span>` : ''}</span></div>`).join('')
      || '<div class="ttl">Timeline</div><div class="muted" style="font-size:26px">Nothing yet</div>';

    // ---------------- bottom: stats bars / leaders
    const first = s => { const p = String(s || '').match(/\((\d+)%\)/); if (p) return +p[1]; const m = String(s || '').match(/-?\d+(\.\d+)?/); return m ? +m[0] : 0; };
    if (v.kind === 'athletics') {
      $('#bot').innerHTML = `<div class="ttl">Events today</div><div class="grid2">${x.events.map(e => `<div class="kv"><span class="up">${esc(e.name)} ${esc(e.round || '')}</span><b>${e.results}/${e.entries}</b></div>`).join('')}</div>`;
    } else {
      const stats = v.teamStats.slice(0, 8);
      $('#bot').innerHTML = `<div class="ttl">Team stats <span class="sp"></span>${v.leaders.map(l => `<span style="color:var(--text)">${esc(l.label)}: <b>${esc(l.name)}</b> ${esc(l.value)}</span>`).join(' &nbsp; ')}</div>
        <div class="grid2">${stats.map(s => { const a = first(s.a), b = first(s.b), t = Math.max(1, a + b);
          return `<div class="st"><div class="v num">${esc(s.a)}</div><div><div class="lbl">${esc(s.label)}</div><div class="bars"><i style="width:${a * 100 / t}%;background:${esc(T.A.color1)}"></i><i style="width:${b * 100 / t}%;background:${esc(T.B.color1)}"></i></div></div><div class="v num">${esc(s.b)}</div></div>`; }).join('')}</div>`;
    }

    buildReel(v.facts);
  }

  // ---------------- fruit machine reel
  let facts = [], idx = 0, key = '';
  function buildReel(f) {
    const k = JSON.stringify(f);
    if (k === key) return;
    key = k; facts = f.length ? f : [{ cat: 'CRICKETCG', big: '—', txt: 'Waiting for play' }];
    if (idx >= facts.length) idx = 0;
    const strip = $('#strip');
    strip.innerHTML = facts.concat([facts[0]]).map(x => `<div class="card"><div class="cat">${esc(x.cat)}</div><div class="bigt up">${esc(x.big)}</div><div class="txt up">${esc(x.txt)}</div></div>`).join('');
    sizeReel();
    strip.style.transition = 'none'; strip.style.transform = `translateY(${-idx * reelH()}px)`; void strip.offsetHeight; strip.style.transition = '';
    $('#reel-count').textContent = `${idx + 1} / ${facts.length}`;
  }
  const reelH = () => $('#reel').clientHeight;
  function sizeReel() { const r = $('#reel'); if (r) r.style.setProperty('--h', r.clientHeight + 'px'); }
  function spin() {
    if (facts.length < 2) return;
    const strip = $('#strip');
    idx++;
    strip.style.transform = `translateY(${-idx * reelH()}px)`;
    if (idx === facts.length) setTimeout(() => { idx = 0; strip.style.transition = 'none'; strip.style.transform = 'translateY(0)'; void strip.offsetHeight; strip.style.transition = ''; }, 950);
    $('#reel-count').textContent = `${(idx % facts.length) + 1} / ${facts.length}`;
  }
  let paused = false;
  setInterval(() => { if (!paused) spin(); }, REEL_MS);
  document.addEventListener('keydown', e => {
    if (e.key === ' ') { paused = !paused; e.preventDefault(); }
    if (e.key === 'ArrowRight') spin();
    if (e.key.toLowerCase() === 'f' && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  });
  // keep sin-bin countdowns fresh
  setInterval(() => { const v = CG.sportView(); if (v && v.kind === 'timed' && v.sinbins.length) render(); }, 1000);

  new ResizeObserver(() => {
    sizeReel();
    const strip = $('#strip'); if (!strip) return;
    strip.style.transition = 'none'; strip.style.transform = `translateY(${-(idx % Math.max(1, facts.length)) * reelH()}px)`; void strip.offsetHeight; strip.style.transition = '';
  }).observe($('#reel'));
  fit();
  CG.connect('commentary');
})();
