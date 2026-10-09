/* CricketCG – commentator stats screen ("fruit machine").
 * Read-only monitor: everything is derived from the shared match state, so it updates on every ball. */
(function () {
  'use strict';
  const { $, esc } = CG;
  const REEL_MS = 7000;

  if (!CG.store.get('cgName', '')) CG.store.set('cgName', 'Commentary box');

  // ------------------------------------------------------------ fit 1920x1080 stage to any screen
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
    $('#clock').textContent = new Date().toTimeString().slice(0, 8);
    $('#offline').style.display = CG.connected ? 'none' : 'flex';
  }, 500);

  // ------------------------------------------------------------ helpers
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 'S'}`;
  const ovStr = (legal, bpo) => `${Math.floor(legal / bpo)}${legal % bpo ? '.' + (legal % bpo) : ''}`;
  const rate = (r, legal, bpo) => legal ? (r * bpo / legal).toFixed(2) : '0.00';
  const pct = (a, b) => b ? Math.round(a * 100 / b) + '%' : '–';
  function label(b) {
    let s;
    switch (b.extra) {
      case 'wd': s = b.extraRuns <= 1 ? 'wd' : b.extraRuns + 'wd'; break;
      case 'nb': s = b.batRuns > 0 ? 'nb' + b.batRuns : (b.extraRuns > 1 ? b.extraRuns + 'nb' : 'nb'); break;
      case 'b': s = b.extraRuns + 'b'; break;
      case 'lb': s = b.extraRuns + 'lb'; break;
      case 'pen': s = b.extraRuns + 'p'; break;
      default: s = b.batRuns === 0 ? '•' : String(b.batRuns);
    }
    if (b.wicket && b.wicket.kind !== 'retiredhurt') s = s === '•' ? 'W' : s + 'W';
    return s;
  }
  function chip(l) {
    let c = 'chip';
    if (l === '•') c += ' dot'; else if (l.includes('W')) c += ' w'; else if (l === '4') c += ' b4'; else if (l === '6') c += ' b6'; else if (/wd|nb|b|lb|p/.test(l)) c += ' x';
    return `<span class="${c}">${esc(l)}</span>`;
  }

  /** Ball-by-ball analysis of one innings (things the server's stats don't carry). */
  function analyse(inn, bpo) {
    const A = { bat: {}, legal: 0, runs: 0, wk: 0, dots: 0, fours: 0, sixes: 0, bRuns: 0, sinceBoundary: 0, sinceWicket: 0, cum: [{ runs: 0, wk: 0 }], lastBoundaryOver: null };
    for (const b of inn.balls) {
      if (b.extra === 'pen') { A.runs += b.extraRuns; continue; }
      const total = b.batRuns + b.extraRuns;
      A.runs += total;
      const s = A.bat[b.strikerId] || (A.bat[b.strikerId] = { c: [0, 0, 0, 0, 0, 0, 0], faced: 0, seq: [], since: 0 });
      if (b.extra !== 'wd') {
        s.faced++;
        if (b.batRuns <= 6) s.c[b.batRuns]++;
        s.seq.push(label(b));
        s.since = b.boundary ? 0 : s.since + 1;
      }
      if (b.boundary && b.batRuns === 4) { A.fours++; A.bRuns += 4; }
      if (b.boundary && b.batRuns === 6) { A.sixes++; A.bRuns += 6; }
      const legal = b.extra !== 'wd' && b.extra !== 'nb';
      if (b.wicket && b.wicket.kind !== 'retiredhurt') { A.wk++; A.sinceWicket = 0; }
      if (legal) {
        A.legal++;
        if (total === 0) A.dots++;
        A.sinceBoundary = b.boundary ? 0 : A.sinceBoundary + 1;
        if (!b.wicket) A.sinceWicket++;
        A.cum[A.legal] = { runs: A.runs, wk: A.wk };
      } else {
        if (b.boundary) A.sinceBoundary = 0;
        A.cum[A.legal] = { runs: A.runs, wk: A.wk };
      }
    }
    return A;
  }

  function phaseOf(over, pp, max, deathOvers) {
    if (over <= pp) return 0;
    if (over > max - deathOvers) return 2;
    return 1;
  }

  // ------------------------------------------------------------ render
  let facts = [];
  let reelIndex = 0;
  let reelKey = '';

  CG.on('state', render);

  function render() {
    const S = CG.state, m = S.match, st = S.stats;
    const c = CG.currentInnings() || (st.innings.length ? st.innings[st.innings.length - 1] : null);
    const bpo = m.ballsPerOver;
    $('#h-match').textContent = `${m.tournament}${m.matchNumber ? ' · MATCH ' + m.matchNumber : ''}`.toUpperCase();
    if (!c) {
      $('#h-team').textContent = `${m.teamA.name} v ${m.teamB.name}`;
      $('#h-status').textContent = st.statusText;
      return;
    }
    const raw = m.innings[c.index];
    const team = CG.team(c.battingTeam);
    const A = analyse(raw, bpo);
    const maxOvers = c.maxBalls / bpo;
    const dls = st.dls || {};
    const chase = c.target != null;
    const showPar = c.index === 1 && dls.par != null && m.dls.enabled;

    // ---- header
    stage.style.setProperty('--team', team.color1 || '#12305c');
    $('#head').style.setProperty('--team', team.color1 || '#12305c');
    $('#h-team').textContent = team.name;
    $('#h-inn').textContent = `INNINGS ${c.number} · ${maxOvers} OVERS${c.target != null && c.targetRevised ? ' · REVISED' : ''}`;
    $('#h-score').textContent = `${c.runs}/${c.wickets}`;
    $('#h-ov').textContent = `${c.overs} ov`;
    $('#h-status').textContent = st.statusText;
    $('#badges').innerHTML = (c.freeHit ? '<span class="badge fh">FREE HIT</span>' : '') + (c.powerplay ? '<span class="badge pp">POWERPLAY</span>' : '');

    const last5 = c.overList.slice(-5).reduce((a, o) => ({ r: a.r + o.runs, w: a.w + o.wickets }), { r: 0, w: 0 });
    const pNow = c.partnerships.length && c.partnerships[c.partnerships.length - 1].current ? c.partnerships[c.partnerships.length - 1] : null;
    const kpis = [[c.runRate, 'CRR', '']];
    if (chase) {
      kpis.push([c.target, c.targetRevised ? 'TARGET (DLS)' : 'TARGET', ''], [`${c.runsNeeded}`, `NEED OFF ${c.ballsRemaining}`, 'hl'], [c.requiredRate, 'RRR', +c.requiredRate > +c.runRate ? 'bad' : 'good']);
      if (showPar) kpis.push([`${dls.par}`, `DLS PAR ${dls.diff >= 0 ? '+' : ''}${dls.diff}`, dls.diff >= 0 ? 'good' : 'bad']);
    } else {
      kpis.push([c.projectedScore || '–', 'PROJECTED', 'hl'], [`${last5.r}/${last5.w}`, 'LAST 5 OV', '']);
    }
    kpis.push([pNow ? `${pNow.runs}(${pNow.balls})` : '–', 'PARTNERSHIP', '']);
    $('#kpis').innerHTML = kpis.map(([v, l, cl]) => `<div class="kpi ${cl}"><b class="num">${esc(v)}</b><span>${esc(l)}</span></div>`).join('');

    // ---- batters (fixed order: senior batter on top)
    const atCrease = c.batting.filter(b => b.status === 'batting').sort((a, b) => a.order - b.order);
    ['bat1', 'bat2'].forEach((id, i) => renderBatter($('#' + id), atCrease[i], A, c));

    // ---- partnership
    if (pNow) {
      const t = Math.max(1, pNow.batter1Runs + pNow.batter2Runs);
      const extras = pNow.runs - pNow.batter1Runs - pNow.batter2Runs;
      const best = c.partnerships.reduce((mx, p) => Math.max(mx, p.runs), 0);
      $('#pship').innerHTML = `<div class="ttl">Partnership · ${ordinal(pNow.forWicket)} wicket<span class="sp"></span>${pNow.runs >= best && c.partnerships.length > 1 ? '<span class="gold">BEST OF INNINGS</span>' : ''}</div>
        <div style="display:flex;align-items:baseline;gap:14px"><span class="big num">${pNow.runs}</span><span class="muted" style="font-size:26px">off ${pNow.balls} balls · RR ${rate(pNow.runs, pNow.balls, bpo)}${extras ? ` · extras ${extras}` : ''}</span></div>
        <div class="bar"><i style="width:${pNow.batter1Runs * 100 / t}%;background:var(--gold)"></i><i style="width:${pNow.batter2Runs * 100 / t}%;background:var(--cyan)"></i></div>
        <div style="display:flex;justify-content:space-between;font-size:22px;font-weight:700"><span class="gold up">${esc(pNow.batter1Name)} ${pNow.batter1Runs} (${pNow.batter1Balls})</span><span style="color:var(--cyan)" class="up">${esc(pNow.batter2Name)} ${pNow.batter2Runs} (${pNow.batter2Balls})</span></div>`;
    } else $('#pship').innerHTML = '<div class="ttl">Partnership</div><div class="muted" style="font-size:26px">New batter to come</div>';

    // ---- bowler
    renderBowler(c, raw, bpo);

    // ---- overs
    $('#overs').innerHTML = '<div class="ttl">Recent overs</div>' + c.overList.slice(-5).reverse().map(o =>
      `<div class="over-row"><span class="no num">${o.over}</span><span class="up muted" style="width:170px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(o.bowlerName)}</span>
       <span style="display:flex;gap:4px;flex-wrap:wrap">${o.balls.map(chip).join('')}</span><span class="r num">${o.runs}${o.wickets ? `<span style="color:var(--red)"> ${o.wickets}w</span>` : ''}</span></div>`).join('');

    // ---- quick numbers
    const last10 = c.overList.slice(-10).reduce((a, o) => ({ r: a.r + o.runs, w: a.w + o.wickets }), { r: 0, w: 0 });
    const q = [
      ['4s / 6s', `${A.fours} / ${A.sixes}`], ['IN BOUNDARIES', `${A.bRuns} (${pct(A.bRuns, A.runs)})`],
      ['DOT BALLS', `${A.dots} (${pct(A.dots, A.legal)})`], ['EXTRAS', `${c.extras.total}`],
      ['LAST 5 OVERS', `${last5.r}/${last5.w}`], ['LAST 10 OVERS', `${last10.r}/${last10.w}`],
      ['BALLS SINCE 4/6', `${A.sinceBoundary}`], ['BALLS SINCE WKT', c.wickets ? `${A.sinceWicket}` : '–'],
    ];
    $('#quick').innerHTML = q.map(([k, v]) => `<div><span>${k}</span><b class="num">${esc(v)}</b></div>`).join('');

    // ---- phases (both innings)
    const pp = m.powerplayOvers || 0;
    const death = maxOvers >= 40 ? 10 : maxOvers >= 15 ? 4 : 0;
    const names = [`POWERPLAY 1–${pp}`, `MIDDLE ${pp + 1}–${maxOvers - death}`, `DEATH ${maxOvers - death + 1}–${maxOvers}`];
    const cols = st.innings.slice(0, 2);
    const ph = cols.map(inn => {
      const acc = [0, 1, 2].map(() => ({ r: 0, w: 0, o: 0 }));
      inn.overList.forEach(o => { const p = phaseOf(o.over, pp, inn.maxBalls / bpo, death); acc[p].r += o.runs; acc[p].w += o.wickets; acc[p].o++; });
      return acc;
    });
    $('#phase-note').textContent = death ? '' : 'short match';
    $('#phases').innerHTML = `<tr><th>PHASE</th>${cols.map(i => `<th colspan="2">${esc(i.battingTeamShort || i.battingTeamName)}</th>`).join('')}</tr>` +
      [0, 1, 2].filter(p => (p !== 0 || pp) && (p !== 2 || death)).map(p => `<tr><td class="m">${names[p]}</td>${ph.map(a =>
        `<td>${a[p].o ? `${a[p].r}/${a[p].w}` : '–'}</td><td class="m">${a[p].o ? 'RR ' + (a[p].r / a[p].o).toFixed(1) : ''}</td>`).join('')}</tr>`).join('');

    // ---- FOW
    $('#fow').innerHTML = c.fow.length ? c.fow.map(f => `<b>${f.wicket}-${f.score}</b> <span class="up">${esc(f.name)} ${f.playerRuns}</span> <span class="muted">(${f.over})</span>`).join(' &nbsp; ')
      : '<span class="muted">No wickets yet</span>';

    // ---- projections / compare
    const left = Math.max(0, c.maxBalls - c.legalBalls) / bpo;
    let compare = '';
    if (chase) {
      $('#proj-title').textContent = 'Chase';
      const need = c.runsNeeded, balls = c.ballsRemaining;
      const next5 = Math.min(5, Math.ceil(balls / bpo));
      const cells = [[need, 'NEED'], [balls, 'BALLS'], [c.requiredRate, 'RRR'], [next5 ? (need / Math.max(1, balls) * bpo).toFixed(1) : '–', 'PER OVER'],
        [showPar ? (dls.parIfWicket != null ? dls.parIfWicket : '–') : '–', showPar ? 'PAR IF WKT' : 'DLS']];
      $('#proj').innerHTML = cells.map(([v, l]) => `<div><b class="num">${esc(v)}</b><span>${l}</span></div>`).join('');
      const i1 = m.innings[0] ? analyse(m.innings[0], bpo) : null;
      const at = i1 && i1.cum[Math.min(c.legalBalls, i1.legal)];
      if (at && c.legalBalls <= i1.legal) compare = `At ${c.overs} ov ${esc(st.innings[0].battingTeamShort || st.innings[0].battingTeamName)} were ${at.runs}/${at.wk}`;
    } else {
      $('#proj-title').textContent = 'Projected total';
      const rates = [+c.runRate, 6, 8, 10, 12];
      $('#proj').innerHTML = rates.map((r, i) => `<div><b class="num">${Math.round(c.runs + r * left)}</b><span>${i === 0 ? 'AT CRR' : 'AT ' + r}</span></div>`).join('');
      if (st.innings.length > 1 && c.index === 0) compare = '';
    }
    $('#compare').innerHTML = compare;

    // ---- fruit machine facts
    buildFacts(S, c, raw, A, bpo, pNow, showPar, dls);
  }

  function ordinal(n) { return n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'); }

  function milestoneNote(runs) {
    for (const t of [50, 100, 150, 200]) if (runs < t && t - runs <= 10) return `NEEDS ${t - runs} FOR ${t}`;
    return '';
  }

  function renderBatter(el, b, A, c) {
    if (!b) { el.className = 'panel bat'; el.innerHTML = '<div class="ttl">Batter</div><div class="muted" style="font-size:30px">—</div>'; return; }
    const x = A.bat[b.playerId] || { c: [0, 0, 0, 0, 0, 0, 0], faced: 0, seq: [], since: 0 };
    const scoring = x.faced - x.c[0];
    el.className = 'panel bat' + (b.onStrike ? ' on' : '');
    const note = [milestoneNote(b.runs), x.since >= 10 && b.balls >= 10 ? `${x.since} BALLS WITHOUT A BOUNDARY` : ''].filter(Boolean).join(' · ');
    el.innerHTML = `<div class="nm up">${esc(b.tvName)}${b.onStrike ? '<span class="st">▶ ON STRIKE</span>' : ''}${b.captain ? '<span class="muted" style="font-size:24px">(C)</span>' : ''}</div>
      <div style="display:flex;align-items:flex-end;gap:26px">
        <div class="rb num">${b.runs}<small>(${b.balls})</small></div>
        <div class="grid4" style="flex:1">
          <div class="stat"><b class="num">${b.fours}/${b.sixes}</b><span>4s / 6s</span></div>
          <div class="stat"><b class="num">${b.strikeRate}</b><span>STRIKE RATE</span></div>
          <div class="stat"><b class="num">${pct(x.c[0], x.faced)}</b><span>DOT %</span></div>
          <div class="stat"><b class="num">${x.c[1]}/${x.c[2]}/${x.c[3]}</b><span>1s / 2s / 3s</span></div>
        </div>
      </div>
      <div class="last"><span class="lbl">LAST 10</span>${x.seq.slice(-10).map(chip).join('')}<span class="lbl" style="margin-left:auto">SCORING SHOTS ${pct(scoring, x.faced)}</span></div>
      <div class="note up">${esc(note)}</div>`;
  }

  function renderBowler(c, raw, bpo) {
    let id = raw.bowlerId;
    if (!id) { for (let i = raw.balls.length - 1; i >= 0; i--) if (raw.balls[i].extra !== 'pen' && raw.balls[i].bowlerId) { id = raw.balls[i].bowlerId; break; } }
    const b = c.bowling.find(x => x.playerId === id);
    const el = $('#bowler');
    if (!b) { el.innerHTML = '<div class="ttl">Bowling</div><div class="muted" style="font-size:30px">—</div>'; return; }
    // current spell = consecutive own overs two apart
    const own = c.overList.filter(o => o.bowlerId === id);
    const spell = [];
    for (let i = own.length - 1; i >= 0; i--) {
      if (spell.length && spell[0].over - own[i].over !== 2) break;
      spell.unshift(own[i]);
    }
    const sp = spell.reduce((a, o) => ({ r: a.r + o.runs, w: a.w + o.wickets, n: a.n + 1 }), { r: 0, w: 0, n: 0 });
    const prevOver = own.length ? own[own.length - 1] : null;
    const other = c.overList.length > 1 ? c.bowling.find(x => x.playerId === c.overList[c.overList.length - 1].bowlerId && x.playerId !== id)
      || c.bowling.find(x => x.playerId === (c.overList[c.overList.length - 2] || {}).bowlerId && x.playerId !== id) : null;
    const hauls = [3, 4, 5].find(t => b.wickets === t - 1);
    el.innerHTML = `<div class="ttl">${raw.bowlerId ? 'Bowling' : 'Last bowler'}<span class="sp"></span>${hauls ? `<span class="gold">ONE FROM ${hauls}-FOR</span>` : ''}</div>
      <div class="nm up">${esc(b.tvName)}</div>
      <div class="fig num">${b.wickets}-${b.runs}<small>${b.overs} OV · ECON ${b.economy}</small></div>
      <div class="grid4" style="margin-top:10px">
        <div class="stat"><b class="num">${b.maidens}</b><span>MAIDENS</span></div>
        <div class="stat"><b class="num">${b.dots}</b><span>DOTS</span></div>
        <div class="stat"><b class="num">${b.foursConceded}/${b.sixesConceded}</b><span>4s / 6s</span></div>
        <div class="stat"><b class="num">${b.wides}/${b.noBalls}</b><span>WD / NB</span></div>
      </div>
      <div class="grid4" style="margin-top:8px">
        <div class="stat" style="grid-column:span 2"><b class="num">${sp.n}-${sp.r}-${sp.w}</b><span>THIS SPELL (O-R-W)</span></div>
        <div class="stat" style="grid-column:span 2"><b class="num">${prevOver ? prevOver.runs + (prevOver.wickets ? ' & ' + prevOver.wickets + 'w' : '') : '–'}</b><span>LAST OVER (RUNS)</span></div>
      </div>
      ${other ? `<div class="muted up" style="font-size:22px;margin-top:10px">OTHER END: <b style="color:var(--text)">${esc(other.tvName)} ${other.wickets}-${other.runs} (${other.overs})</b></div>` : ''}`;
  }

  // ------------------------------------------------------------ fruit machine
  function buildFacts(S, c, raw, A, bpo, pNow, showPar, dls) {
    const m = S.match, st = S.stats, f = [];
    const add = (cat, big, txt) => f.push({ cat, big: String(big), txt });
    const team = (c.battingTeamShort || c.battingTeamName).toUpperCase();

    if (c.target != null) add('THE CHASE', `${c.runsNeeded} off ${c.ballsRemaining}`, `${team} need ${plural(c.runsNeeded, 'run')} at ${c.requiredRate} an over (currently ${c.runRate})`);
    if (showPar) add('DLS PAR', dls.par, `${dls.parText}${dls.parIfWicket != null ? ` · par jumps to ${dls.parIfWicket} if a wicket falls now` : ''}`);
    if (c.target == null && c.projectedScore) add('PROJECTED', c.projectedScore, `${team} are heading for ${c.projectedScore} at ${c.runRate} an over`);

    c.batting.filter(b => b.status === 'batting').forEach(b => {
      const ms = milestoneNote(b.runs);
      if (ms) add('MILESTONE WATCH', `${b.runs}*`, `${b.tvName} ${ms.toLowerCase()}`);
      const x = A.bat[b.playerId];
      if (x && x.faced >= 12) add('STRIKE RATE', b.strikeRate, `${b.tvName}: ${b.runs} off ${b.balls}, ${b.fours} fours & ${b.sixes} sixes, dot % ${pct(x.c[0], x.faced)}`);
    });
    const top = c.batting.slice().sort((a, b) => b.runs - a.runs)[0];
    if (top && top.runs > 0) add('TOP SCORER', top.runs + (top.status === 'batting' ? '*' : ''), `${top.tvName} ${top.runs} (${top.balls}) · ${top.status === 'batting' ? 'still batting' : top.howOut}`);
    const bestB = c.bowling.slice().sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];
    if (bestB && bestB.legalBalls) add('BEST BOWLING', `${bestB.wickets}-${bestB.runs}`, `${bestB.tvName}: ${bestB.overs} overs, economy ${bestB.economy}, ${bestB.dots} dots`);
    const econ = c.bowling.filter(b => b.legalBalls >= 12).sort((a, b) => +a.economy - +b.economy)[0];
    if (econ) add('MOST ECONOMICAL', econ.economy, `${econ.tvName}: ${econ.overs}-${econ.maidens}-${econ.runs}-${econ.wickets}`);

    if (pNow && pNow.runs >= 20) add('PARTNERSHIP', `${pNow.runs} (${pNow.balls})`, `${pNow.batter1Name} & ${pNow.batter2Name} for the ${ordinal(pNow.forWicket)} wicket`);
    const bestP = c.partnerships.slice().sort((a, b) => b.runs - a.runs)[0];
    if (bestP && bestP !== pNow && bestP.runs >= 20) add('BEST STAND', bestP.runs, `${bestP.batter1Name} & ${bestP.batter2Name} (${ordinal(bestP.forWicket)} wicket, ${bestP.balls} balls)`);

    if (A.sinceBoundary >= 12) add('BOUNDARY DROUGHT', A.sinceBoundary, `balls since ${team} last found the rope`);
    if (A.runs > 0) add('BOUNDARIES', `${A.fours} × 4 · ${A.sixes} × 6`, `${pct(A.bRuns, A.runs)} of ${team}'s runs have come in boundaries`);
    if (A.legal >= 12) add('DOT BALLS', pct(A.dots, A.legal), `${A.dots} of ${A.legal} legal balls have been dots`);
    const big = c.overList.slice().sort((a, b) => b.runs - a.runs)[0];
    if (big && big.runs >= 12) add('BIGGEST OVER', big.runs, `over ${big.over}, bowled by ${big.bowlerName}: ${big.balls.join(' ')}`);
    const last5 = c.overList.slice(-5), prev5 = c.overList.slice(-10, -5);
    if (last5.length === 5 && prev5.length === 5) {
      const a = last5.reduce((s, o) => s + o.runs, 0), b = prev5.reduce((s, o) => s + o.runs, 0);
      add('MOMENTUM', `${a} v ${b}`, `runs in the last 5 overs compared with the 5 before`);
    }
    const nextTeam = [50, 100, 150, 200, 250].find(t => c.runs < t && t - c.runs <= 12);
    if (nextTeam) add('TEAM MILESTONE', nextTeam, `${team} need ${plural(nextTeam - c.runs, 'run')} to reach ${nextTeam}`);
    if (c.extras.total >= 5) add('EXTRAS', c.extras.total, c.extras.detail);
    if (c.index === 1 && st.innings[0]) {
      const i1 = analyse(m.innings[0], bpo);
      const at = i1.cum[Math.min(c.legalBalls, i1.legal)];
      if (at && c.legalBalls <= i1.legal) add('SAME STAGE', `${at.runs}/${at.wk}`, `${st.innings[0].battingTeamShort || st.innings[0].battingTeamName} at ${c.overs} overs – ${team} are ${c.runs >= at.runs ? c.runs - at.runs + ' ahead' : at.runs - c.runs + ' behind'}`);
    }
    if (st.tossText && c.legalBalls < 18) add('TOSS', (m.toss.winner ? (CG.team(m.toss.winner).shortName || CG.team(m.toss.winner).name) : 'TOSS'), st.tossText);
    if (!f.length) add('CRICKETCG', '—', 'Stats will appear once play starts');

    const key = f.map(x => x.cat + x.big + x.txt).join('|');
    if (key === reelKey) return;
    reelKey = key;
    facts = f;
    if (reelIndex >= facts.length) reelIndex = 0;
    drawReel();
  }

  function drawReel() {
    const strip = $('#strip');
    const cards = facts.concat([facts[0]]); // clone of first at the end for a seamless loop
    strip.innerHTML = cards.map(x => `<div class="card"><div class="cat">${esc(x.cat)}</div><div class="big num up">${esc(x.big)}</div><div class="txt up">${esc(x.txt)}</div></div>`).join('');
    $('#reel-count').textContent = `${reelIndex + 1} / ${facts.length}`;
    $('#dots').innerHTML = facts.map((_, i) => `<i class="${i === reelIndex ? 'on' : ''}"></i>`).join('');
    sizeReel();
    strip.style.transition = 'none';
    strip.style.transform = `translateY(${-reelIndex * reelH()}px)`;
    void strip.offsetHeight;
    strip.style.transition = '';
  }
  const reelH = () => $('#reel').clientHeight;
  function sizeReel() { const r = $('#reel'); if (r) r.style.setProperty('--h', r.clientHeight + 'px'); }

  function spin() {
    if (!facts.length || facts.length === 1) return;
    const strip = $('#strip');
    reelIndex++;
    strip.style.transform = `translateY(${-reelIndex * reelH()}px)`;
    if (reelIndex === facts.length) {
      setTimeout(() => { reelIndex = 0; strip.style.transition = 'none'; strip.style.transform = 'translateY(0)'; void strip.offsetHeight; strip.style.transition = ''; mark(); }, 950);
    }
    mark();
  }
  function mark() {
    const i = reelIndex % facts.length;
    $('#reel-count').textContent = `${i + 1} / ${facts.length}`;
    Array.from($('#dots').children).forEach((d, k) => d.classList.toggle('on', k === i));
  }
  let paused = false;
  setInterval(() => { if (!paused) spin(); }, REEL_MS);
  document.addEventListener('keydown', e => {
    if (e.key === ' ') { paused = !paused; e.preventDefault(); }
    if (e.key === 'ArrowRight') spin();
    if (e.key.toLowerCase() === 'f') document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  });

  new ResizeObserver(() => {
    sizeReel();
    const strip = $('#strip'); if (!strip) return;
    strip.style.transition = 'none'; strip.style.transform = `translateY(${-(reelIndex % Math.max(1, facts.length)) * reelH()}px)`; void strip.offsetHeight; strip.style.transition = '';
  }).observe($('#reel'));
  fit();
  CG.connect('commentary');
})();
