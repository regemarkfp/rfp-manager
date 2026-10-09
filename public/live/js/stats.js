/* CricketCG – Stats / scorer surface */
(function () {
  'use strict';
  const { $, $$, esc, h } = CG;

  let extra = '';          // current delivery modifier
  let cardInnings = null;  // innings index shown on the Scorecard tab
  let logInnings = null;   // innings index shown on the Ball Log tab
  let lastWicketSeq = null;

  // ================================================================ tabs
  $$('#tabs .tab').forEach(t => t.onclick = () => showPage(t.dataset.page));
  function showPage(p) {
    $$('#tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.page === p));
    $$('.page').forEach(s => s.classList.toggle('active', s.id === 'page-' + p));
    CG.store.set('statsPage', p);
    render();
  }
  // ================================================================ helpers
  const s = () => CG.state;
  const M = () => CG.state.match;
  const cur = () => CG.currentInnings();
  const curRaw = () => { const st = s(); return st ? CG.rawInnings(st.match.currentInningsIndex) : null; };

  function fill(el, value) {
    if (!el || el === document.activeElement || el.dataset.dirty === '1') return;
    if (el.type === 'checkbox') el.checked = !!value; else el.value = value == null ? '' : value;
  }
  document.addEventListener('input', e => { if (e.target.matches('input,select,textarea') && !e.target.closest('.modal')) e.target.dataset.dirty = '1'; });
  function clean(root) { $$('[data-dirty]', root).forEach(x => delete x.dataset.dirty); }

  function ballChipClass(l) {
    if (l === '•') return 'chip dot';
    if (l.includes('W')) return 'chip w';
    if (l === '4') return 'chip b4';
    if (l === '6') return 'chip b6';
    if (/wd|nb|b|lb|p/.test(l)) return 'chip x';
    return 'chip';
  }
  const chip = l => `<span class="${ballChipClass(l)}">${esc(l)}</span>`;

  // ================================================================ render
  CG.on('state', render);
  CG.on('lists', renderLists);

  function render() {
    if (!s()) return;
    renderHeader();
    const page = CG.store.get('statsPage', 'score');
    if (page === 'score') renderScore();
    if (page === 'setup') renderSetup();
    if (page === 'teams') renderTeams();
    if (page === 'card') renderCard();
    if (page === 'balls') renderBalls();
    if (page === 'dls') renderDls();
  }

  function renderHeader() {
    const m = M(), st = s().stats, c = cur();
    const score = c ? ` — ${c.battingTeamShort || c.battingTeamName} ${c.score} (${c.overs})` : '';
    $('#matchline').innerHTML = `${esc(m.teamA.name)} v ${esc(m.teamB.name)}${esc(score)}<span class="sub">${esc(st.statusText)}</span>`;
    const r = s().rfp || {};
    if (r.pullError) $('#matchline').innerHTML += `<span class="sub" style="color:var(--red)">${esc(r.pullError)}</span>`;
    $('#matchline').title = r.fixtureId ? 'Match in RFP Manager: ' + (r.name || '') : 'No match chosen';
  }

  // ---------------------------------------------------------------- SCORE
  function renderScore() {
    const m = M(), st = s().stats, c = cur(), raw = curRaw();
    const banner = $('#score-banner');
    banner.innerHTML = '';

    if (!c || !raw) {
      const tossBat = m.toss.winner ? (m.toss.decision === 'bat' ? m.toss.winner : (m.toss.winner === 'A' ? 'B' : 'A')) : 'A';
      banner.appendChild(h(`<div class="banner info"><span class="grow">No innings in progress. Who bats first?</span>
        <button class="btn ${tossBat === 'A' ? 'primary' : ''}" data-start="A">${esc(m.teamA.name)} bat</button>
        <button class="btn ${tossBat === 'B' ? 'primary' : ''}" data-start="B">${esc(m.teamB.name)} bat</button></div>`));
    } else if (raw.closed || c.complete) {
      const next = c.battingTeam === 'A' ? 'B' : 'A';
      const msg = raw.closed ? 'Innings closed.' : `Innings complete: ${c.completeReason}.`;
      const canNext = m.innings.length < 2 || st.innings.length < 2 ? true : false;
      banner.appendChild(h(`<div class="banner warn"><span class="grow">${esc(msg)} ${esc(st.resultText || '')}</span>
        ${!raw.closed ? '<button class="btn warn" data-act="end">Close innings</button>' : ''}
        ${canNext && m.innings.length < 2 ? `<button class="btn primary" data-start="${next}">Start ${esc(CG.team(next).name)} innings</button>` : ''}</div>`));
    }
    if (raw && !raw.closed) {
      if (!raw.strikerId || !raw.nonStrikerId) {
        banner.appendChild(h(`<div class="banner bad"><span class="grow">Select ${!raw.strikerId && !raw.nonStrikerId ? 'the opening batters' : 'the new batter'}.</span>
          <button class="btn primary" data-act="newbat">Choose batter</button></div>`));
      } else if (!raw.bowlerId) {
        banner.appendChild(h(`<div class="banner bad"><span class="grow">${c.legalBalls > 0 ? 'End of over – select the next bowler.' : 'Select the opening bowler.'}</span></div>`));
      }
    }
    $$('[data-start]', banner).forEach(b => b.onclick = () => CG.score('startInnings', { battingTeam: b.dataset.start }));
    $$('[data-act=end]', banner).forEach(b => b.onclick = endInnings);
    $$('[data-act=newbat]', banner).forEach(b => b.onclick = () => chooseBatter());

    // scorebox
    const badges = [];
    if (c && c.freeHit) badges.push('<span class="badge fh">FREE HIT</span>');
    if (c && c.powerplay) badges.push('<span class="badge pp">POWERPLAY</span>');
    $('#badges').innerHTML = badges.join(' ');
    if (c) {
      const meta = [`CRR <b>${c.runRate}</b>`];
      if (c.target != null) {
        meta.push(`TARGET <b>${c.target}</b>`, `NEED <b>${c.runsNeeded}</b> off <b>${c.ballsRemaining}</b>`, `RRR <b>${c.requiredRate}</b>`);
      } else if (c.projectedScore) meta.push(`PROJ <b>${c.projectedScore}</b>`);
      const dl = s().stats.dls;
      if (c.index === 1 && dl && dl.par != null && m.dls.enabled) meta.push(`DLS PAR <b>${dl.par}</b> (${dl.diff >= 0 ? '+' : ''}${dl.diff})`);
      meta.push(`EXTRAS <b>${c.extras.total}</b>`);
      const bt = c.battingTeam === 'B' ? m.teamB : m.teamA;
      $('#scorebox').innerHTML = `<div class="team">${CG.badge(bt, 30)}${esc(c.battingTeamName)} · INNINGS ${c.number}</div><div></div>
        <div class="score">${c.runs}/${c.wickets}</div><div class="overs">${c.overs}<span class="muted" style="font-size:13px"> / ${c.maxBalls / m.ballsPerOver}</span></div>
        <div class="meta">${meta.map(x => `<span>${x}</span>`).join('')}</div>`;
    } else {
      $('#scorebox').innerHTML = `<div class="team">${esc(st.tossText || 'MATCH YET TO START')}</div>`;
    }
    {
      const html = `<span class="${c && c.battingTeam === 'A' ? 'bat' : ''}">${CG.badge(m.teamA, 34)} ${esc(m.teamA.name)}</span><span class="muted">v</span><span class="${c && c.battingTeam === 'B' ? 'bat' : ''}">${esc(m.teamB.name)} ${CG.badge(m.teamB, 34)}</span>`;
      $$('.vsline').forEach(el => { el.innerHTML = html; });
    }

    // crease
    const crease = $('#crease');
    if (c && raw) {
      const rowFor = (slot, id) => {
        const b = c.batting.find(x => x.playerId === id);
        const onStrike = slot === 'striker';
        const others = [raw.strikerId, raw.nonStrikerId].filter(x => x && x !== id);
        const out = c.batting.filter(x => x.status === 'out').map(x => x.playerId);
        return `<button class="strike ${onStrike ? 'on' : ''}" data-slot="${slot}" title="${onStrike ? 'On strike' : 'Give strike'}"></button>
          <select data-bat="${slot}">${CG.playerOptions(c.battingTeam, id, { exclude: others.concat(out), blankLabel: '— batter —' })}</select>
          <div class="v big">${b ? b.runs : ''}</div><div class="v">${b ? b.balls : ''}</div>
          <div class="v">${b ? b.fours : ''}</div><div class="v">${b ? b.sixes : ''}</div><div class="v">${b ? b.strikeRate : ''}</div>`;
      };
      if (!crease.contains(document.activeElement)) {
        crease.innerHTML = `<div></div><div class="h">BATTER</div><div class="h">R</div><div class="h">B</div><div class="h">4s</div><div class="h">6s</div><div class="h">SR</div>`
          + rowFor('striker', raw.strikerId) + rowFor('nonStriker', raw.nonStrikerId);
        $$('select[data-bat]', crease).forEach(sel => sel.onchange = () =>
          CG.score(sel.dataset.bat === 'striker' ? 'striker' : 'nonStriker', { id: sel.value }));
        $$('.strike', crease).forEach(b => b.onclick = () => { if (b.dataset.slot !== 'striker') CG.score('swap'); });
      }
    } else crease.innerHTML = '<div class="muted small" style="grid-column:1/-1">—</div>';

    // bowler
    const selB = $('#sel-bowler');
    if (c && raw) {
      if (selB !== document.activeElement) selB.innerHTML = CG.playerOptions(c.bowlingTeam, raw.bowlerId, { blankLabel: '— select bowler —' });
      const bw = c.bowling.find(x => x.playerId === raw.bowlerId);
      $('#bowler-fig').textContent = bw ? `${bw.overs}-${bw.maidens}-${bw.runs}-${bw.wickets}   econ ${bw.economy}   dots ${bw.dots}` : '';
      // don't let the same bowler bowl consecutive overs by accident
      const lastOver = c.overList.length ? c.overList[c.overList.length - 1] : null;
      if (!raw.bowlerId && lastOver && c.legalBalls % m.ballsPerOver === 0) {
        const o = selB.querySelector(`option[value="${lastOver.bowlerId}"]`);
        if (o) o.textContent += '  (bowled last over)';
      }
    } else selB.innerHTML = '';
    selB.onchange = () => CG.score('bowler', { id: selB.value });

    // this over
    $('#this-over').innerHTML = c ? c.thisOver.map(chip).join('') : '';
    $('#over-runs').textContent = c && c.overList.length ? `Over ${c.overList[c.overList.length - 1].over} · ${c.thisOverRuns} runs` : '';

    // partnership
    const p = c && c.partnerships.length ? c.partnerships[c.partnerships.length - 1] : null;
    $('#pship').innerHTML = p ? `<b style="font-size:18px">${p.runs}</b> <span class="muted">(${p.balls} balls) for the ${ordinal(p.forWicket)} wicket${p.current ? '' : ' – ended'}</span><br>
      ${esc(p.batter1Name)} ${p.batter1Runs} (${p.batter1Balls}) · ${esc(p.batter2Name)} ${p.batter2Runs} (${p.batter2Balls})` : '<span class="muted">—</span>';

    // overs
    $('#overs-list').innerHTML = c ? c.overList.slice().reverse().map(o =>
      `<div class="over-row"><span class="no">${o.over}</span><span class="balls">${o.balls.map(chip).join('')}</span><span class="muted">${o.runs} · ${esc(o.bowlerName)} · ${o.cumulative}/${o.cumulativeWickets}</span></div>`).join('') : '';

    // mini cards
    $('#mini-bat').innerHTML = c ? batTable(c, true) : '';
    $('#mini-bowl').innerHTML = c ? bowlTable(c) : '';
    $('#mini-fow').innerHTML = c && c.fow.length ? c.fow.map(f => `<b>${f.wicket}-${f.score}</b> <span class="muted">(${esc(f.name)}, ${f.over})</span>`).join(' &nbsp; ') : '<span class="muted">—</span>';

    // auto prompt for a new batter right after a wicket
    if (raw && !raw.closed && c && !c.complete && (!raw.strikerId || !raw.nonStrikerId) && raw.balls.length) {
      const last = raw.balls[raw.balls.length - 1];
      if (last.wicket && last.seq !== lastWicketSeq && !document.querySelector('.modal')) {
        lastWicketSeq = last.seq;
        setTimeout(() => chooseBatter(), 150);
      }
    }
  }

  function ordinal(n) { return n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'); }

  function batTable(c, compact) {
    let html = `<tr><th>Batter</th>${compact ? '' : '<th></th>'}<th class="n">R</th><th class="n">B</th><th class="n">4s</th><th class="n">6s</th><th class="n">SR</th></tr>`;
    c.batting.forEach(b => {
      const cls = b.status === 'batting' ? 'hl' : (b.status === 'out' ? 'out' : '');
      const star = b.status === 'batting' || b.status === 'notout' ? '*' : '';
      html += `<tr class="${cls}"><td>${b.onStrike ? '▶ ' : ''}${esc(b.tvName)}${b.captain ? ' (c)' : ''}${b.keeper ? ' †' : ''}${compact ? `<div class="how">${esc(b.howOut)}</div>` : ''}</td>
        ${compact ? '' : `<td class="how">${esc(b.howOut)}</td>`}
        <td class="n"><b>${b.runs}${star}</b></td><td class="n">${b.balls}</td><td class="n">${b.fours}</td><td class="n">${b.sixes}</td><td class="n">${b.strikeRate}</td></tr>`;
    });
    return html;
  }

  function bowlTable(c) {
    let html = `<tr><th>Bowler</th><th class="n">O</th><th class="n">M</th><th class="n">R</th><th class="n">W</th><th class="n">Econ</th><th class="n">0s</th><th class="n">Wd</th><th class="n">Nb</th></tr>`;
    c.bowling.forEach(b => {
      html += `<tr class="${b.current ? 'hl' : ''}"><td>${b.current ? '▶ ' : ''}${esc(b.tvName)}</td><td class="n">${b.overs}</td><td class="n">${b.maidens}</td><td class="n">${b.runs}</td><td class="n"><b>${b.wickets}</b></td><td class="n">${b.economy}</td><td class="n">${b.dots}</td><td class="n">${b.wides}</td><td class="n">${b.noBalls}</td></tr>`;
    });
    return html;
  }

  // ---------------------------------------------------------------- scoring input
  const modHints = {
    '': 'Runs off the bat.',
    wd: 'WIDE: pick extra runs taken (0 = just the wide, 4 = boundary wides).',
    nb: 'NO BALL: pick runs off the bat (1-run penalty added automatically). Next ball is a free hit.',
    b: 'BYES: pick the number of byes.',
    lb: 'LEG BYES: pick the number of leg byes.',
  };
  function setExtra(x) {
    extra = extra === x ? '' : x;
    $$('#mods .btn').forEach(b => b.classList.toggle('on', b.dataset.extra === extra));
    $('#mod-hint').textContent = modHints[extra];
  }
  $$('#mods .btn').forEach(b => b.onclick = () => setExtra(b.dataset.extra));

  async function ball(runs, boundary, wicket) {
    if (boundary && $('#chk-allrun').checked) boundary = false;
    const data = { runs, extra, boundary: !!boundary };
    if (wicket) data.wicket = wicket;
    await CG.score('ball', data).then(() => {
      setExtra('');
      $('#chk-allrun').checked = false;
    }).catch(() => { });
  }
  $$('#pad [data-runs]').forEach(b => b.onclick = () => ball(+b.dataset.runs, b.dataset.boundary === '1'));
  $('#btn-wicket').onclick = () => wicketDialog();
  $('#btn-undo').onclick = () => CG.score('undo').then(() => CG.toast('Undone', 'ok')).catch(() => { });
  $('#btn-swap').onclick = () => CG.score('swap');
  $('#btn-penalty').onclick = async () => {
    const r = await CG.modal('Penalty runs', `<label class="f"><span>Runs awarded to the batting side</span><input type="number" name="runs" value="5" min="1"></label>`);
    if (r) CG.score('penalty', { runs: +r.runs || 5 });
  };
  $('#btn-end').onclick = endInnings;
  $('#btn-declare').onclick = async () => {
    const c = cur();
    if (!c) return;
    const r = await CG.modal('Declare', `<p>Declare the ${esc(c.battingTeamName)} innings closed at <b>${c.score}</b>?</p><p class="muted small">Shown as ${c.runs}/${c.wickets}d. You can undo this.</p>`, { ok: 'Declare', danger: true });
    if (r) CG.score('declare');
  };

  async function endInnings() {
    const c = cur();
    if (!c) return;
    const r = await CG.modal('End innings', `<p>Close the ${esc(c.battingTeamName)} innings at <b>${c.score}</b> (${c.overs} ov)?</p><p class="muted small">You can undo this.</p>`, { ok: 'End innings', danger: true });
    if (r) CG.score('endInnings');
  }

  async function wicketDialog() {
    const c = cur(), raw = curRaw();
    if (!c || !raw) return;
    if (!raw.strikerId || !raw.nonStrikerId || !raw.bowlerId) { CG.toast('Set both batters and the bowler first', 'err'); return; }
    const kinds = [['bowled', 'Bowled'], ['caught', 'Caught'], ['lbw', 'LBW'], ['runout', 'Run out'], ['stumped', 'Stumped'], ['caughtbowled', 'Caught & bowled'],
      ['hitwicket', 'Hit wicket'], ['retiredhurt', 'Retired hurt (not out)'], ['retiredout', 'Retired out'], ['obstructing', 'Obstructing the field'], ['timedout', 'Timed out']];
    const body = `
      <div class="pick">${kinds.map(([k, l], i) => `<label><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="form-grid">
        <label class="f"><span>Batter out</span><select name="out">
          <option value="${raw.strikerId}">${esc(CG.pname(raw.strikerId))} (striker)</option>
          <option value="${raw.nonStrikerId}">${esc(CG.pname(raw.nonStrikerId))} (non-striker)</option></select></label>
        <label class="f" data-show="fielder"><span>Fielder</span><select name="fielder">${CG.playerOptions(c.bowlingTeam, '', { blankLabel: '— none —' })}</select></label>
        <label class="f" data-show="runs"><span>Runs completed</span><input type="number" name="runs" value="0" min="0" max="7"></label>
        <label class="f"><span>Delivery</span><select name="extra">
          <option value="" ${extra === '' ? 'selected' : ''}>Legal</option><option value="wd" ${extra === 'wd' ? 'selected' : ''}>Wide</option>
          <option value="nb" ${extra === 'nb' ? 'selected' : ''}>No ball</option><option value="b" ${extra === 'b' ? 'selected' : ''}>Bye</option>
          <option value="lb" ${extra === 'lb' ? 'selected' : ''}>Leg bye</option></select></label>
      </div>
      ${c.freeHit ? '<div class="banner warn">FREE HIT – only run out (and a few rarer modes) can dismiss the batter.</div>' : ''}`;
    const r = await CG.modal('Wicket', body, {
      ok: 'Confirm wicket', danger: true,
      onOpen(form) {
        const upd = () => {
          const k = form.querySelector('input[name=kind]:checked').value;
          form.querySelector('[data-show=fielder]').style.display = ['caught', 'runout', 'stumped'].includes(k) ? '' : 'none';
          form.querySelector('[data-show=runs]').style.display = ['runout', 'retiredhurt', 'retiredout', 'obstructing'].includes(k) ? '' : 'none';
        };
        form.addEventListener('change', upd); upd();
      },
    });
    if (!r) return;
    extra = r.extra || '';
    const runs = ['runout', 'retiredhurt', 'retiredout', 'obstructing'].includes(r.kind) ? (+r.runs || 0) : 0;
    const needsByes = (extra === 'b' || extra === 'lb') && runs === 0;
    if (needsByes) extra = '';
    await ball(runs, false, { kind: r.kind, playerOutId: r.out, fielderId: r.fielder || null });
  }

  async function chooseBatter() {
    const c = cur(), raw = curRaw();
    if (!c || !raw) return;
    const used = new Set(c.batting.map(b => b.playerId));
    [raw.strikerId, raw.nonStrikerId].forEach(x => x && used.add(x));
    const retired = c.batting.filter(b => b.status === 'retired').map(b => b.playerId);
    const team = CG.team(c.battingTeam);
    const avail = team.players.filter(p => !used.has(p.id) || retired.includes(p.id));
    if (!avail.length) { CG.toast('No batters left to select', 'err'); return; }
    const both = !raw.strikerId && !raw.nonStrikerId;
    const body = both
      ? `<p class="muted small">Pick the two openers. First = striker.</p>
         <div class="form-grid"><label class="f"><span>Striker</span><select name="a">${CG.playerOptions(c.battingTeam, avail[0] && avail[0].id)}</select></label>
         <label class="f"><span>Non-striker</span><select name="b">${CG.playerOptions(c.battingTeam, avail[1] && avail[1].id)}</select></label></div>`
      : `<div class="pick">${avail.map((p, i) => `<label><input type="radio" name="id" value="${p.id}" ${i === 0 ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>`;
    const r = await CG.modal(both ? 'Opening batters' : 'New batter', body, { ok: 'Confirm' });
    if (!r) return;
    if (both) {
      if (!r.a || !r.b || r.a === r.b) { CG.toast('Pick two different batters', 'err'); return; }
      await CG.score('striker', { id: r.a }).catch(() => { });
      await CG.score('nonStriker', { id: r.b }).catch(() => { });
    } else if (r.id) CG.score('newBatter', { id: r.id });
  }

  // keyboard
  document.addEventListener('keydown', e => {
    if (CG.store.get('statsPage', 'score') !== 'score') return;
    if (e.target.matches('input,select,textarea') || document.querySelector('.modal')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $('#btn-undo').click(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (/^[0-6]$/.test(k)) { e.preventDefault(); ball(+k, k === '4' || k === '6'); }
    else if (k === 'd') setExtra('wd');
    else if (k === 'n') setExtra('nb');
    else if (k === 'b') setExtra('b');
    else if (k === 'l') setExtra('lb');
    else if (k === 'w') wicketDialog();
    else if (k === 's') CG.score('swap');
    else if (k === 'escape') setExtra('');
  });

  // ---------------------------------------------------------------- SETUP
  function renderSetup() {
    const m = M(), st = s().stats;
    const f = $('#form-setup');
    ['tournament', 'matchTitle', 'matchNumber', 'venue', 'city', 'format', 'oversPerInnings', 'powerplayOvers', 'ballsPerOver'].forEach(k => fill(f.querySelector(`[name=${k}]`), m[k]));
    const tw = $('#toss-winner');
    if (tw !== document.activeElement && tw.dataset.dirty !== '1')
      tw.innerHTML = `<option value="">—</option><option value="A" ${m.toss.winner === 'A' ? 'selected' : ''}>${esc(m.teamA.name)}</option><option value="B" ${m.toss.winner === 'B' ? 'selected' : ''}>${esc(m.teamB.name)}</option>`;
    fill($('#toss-decision'), m.toss.decision);
    $('#toss-text').textContent = st.tossText;
    const of = $('#form-officials');
    ['umpire1', 'umpire2', 'tvUmpire', 'fourthUmpire', 'referee'].forEach(k => fill(of.querySelector(`[name=${k}]`), m.officials[k]));
    fill($('#commentators'), (m.commentators || []).join('\n'));
    fill($('#result-override'), m.resultOverride);
    const raw = curRaw();

    $('#innings-start').innerHTML = `<span class="muted">Start new innings:</span>
      <button class="btn sm" data-start="A">${esc(m.teamA.name)} bat</button><button class="btn sm" data-start="B">${esc(m.teamB.name)} bat</button>
      <span class="muted" style="margin-left:14px">Super over:</span>
      <button class="btn sm" data-so="A">${esc(m.teamA.shortName || m.teamA.name)} bat</button><button class="btn sm" data-so="B">${esc(m.teamB.shortName || m.teamB.name)} bat</button>`;
    $$('#innings-start [data-so]').forEach(b => b.onclick = async () => {
      const ok = await CG.modal('Super over', `<p>Start a super over with <b>${esc(CG.team(b.dataset.so).name)}</b> batting? One over, two wickets. The current innings will be closed.</p>`, { ok: 'Start super over' });
      if (ok) CG.score('superOver', { battingTeam: b.dataset.so });
    });
    $$('#innings-start [data-start]').forEach(b => b.onclick = async () => {
      const ok = await CG.modal('Start innings', `<p>Start a new innings with <b>${esc(CG.team(b.dataset.start).name)}</b> batting? The current innings will be closed.</p>`, { ok: 'Start' });
      if (ok) CG.score('startInnings', { battingTeam: b.dataset.start });
    });
    $('#innings-list').innerHTML = st.innings.map(i => `<button class="btn sm ${i.index === st.currentIndex ? 'on' : ''}" data-sel="${i.index}">${i.number}. ${esc(i.battingTeamShort || i.battingTeamName)} ${i.score} (${i.overs})</button>`).join(' ')
      + (st.innings.length ? '<span class="muted small">Click to make an innings current (re-opens it).</span>' : '');
    $$('#innings-list [data-sel]').forEach(b => b.onclick = () => CG.score('selectInnings', { index: +b.dataset.sel }));
  }

  $('#save-setup').onclick = () => {
    const f = $('#form-setup'), d = {};
    $$('[name]', f).forEach(i => { d[i.name] = i.type === 'number' ? (i.value === '' ? null : +i.value) : i.value; });
    CG.score('setup', d).then(() => { clean(f); CG.toast('Match details saved', 'ok'); });
  };
  $('#save-toss').onclick = () => CG.score('toss', { winner: $('#toss-winner').value, decision: $('#toss-decision').value })
    .then(() => { clean($('#page-setup')); CG.toast('Toss saved', 'ok'); });
  $('#save-officials').onclick = () => {
    const f = $('#form-officials'), d = {};
    $$('[name]', f).forEach(i => d[i.name] = i.value);
    CG.score('officials', d).then(() => { clean(f); CG.toast('Officials saved', 'ok'); });
  };
  $('#save-comms').onclick = () => CG.score('commentators', { list: $('#commentators').value.split('\n') })
    .then(() => { delete $('#commentators').dataset.dirty; CG.toast('Commentators saved', 'ok'); });
  $('#save-result').onclick = () => CG.score('result', { text: $('#result-override').value }).then(() => delete $('#result-override').dataset.dirty);

  function renderLists() {
    const sel = $('#load-name');
    sel.innerHTML = CG.lists.matches.length ? CG.lists.matches.map(n => `<option>${esc(n)}</option>`).join('') : '<option value="">(no saved matches)</option>';
    if (CG.store.get('statsPage', 'score') === 'teams') renderTeams(true);
  }
  $('#btn-save-match').onclick = () => CG.send('store', 'saveMatch', { name: $('#save-name').value }).then(() => CG.toast('Match saved', 'ok')).catch(e => CG.toast(e.message, 'err'));
  $('#btn-load-match').onclick = async () => {
    const name = $('#load-name').value;
    if (!name) return;
    const ok = await CG.modal('Load match', `<p>Replace the current match with <b>${esc(name)}</b>? Save first if you need the current one.</p>`, { ok: 'Load', danger: true });
    if (ok) CG.send('store', 'loadMatch', { name }).then(() => CG.toast('Match loaded', 'ok')).catch(e => CG.toast(e.message, 'err'));
  };
  $('#btn-new-match').onclick = async () => {
    const r = await CG.modal('Start scoring again', `<p>Clear every ball, the toss and the innings of this match and start again?</p>
      <p class="small muted">Teams, squads, competition, venue and format are taken from the match in RFP Manager again. Export first if you want a copy of the current scoring.</p>`, { ok: 'Clear and start again', danger: true });
    if (r) CG.score('newMatch', {}).then(() => { clean(document); CG.toast('Scoring cleared. Match details reloaded.', 'ok'); });
  };
  $('#import-file').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const res = await fetch('api/import' + CG.query, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await file.text() });
    CG.toast(res.ok ? 'Match imported' : 'Import failed: ' + await res.text(), res.ok ? 'ok' : 'err');
    e.target.value = '';
  };

  // ---------------------------------------------------------------- TEAMS
  function renderTeams(force) {
    const wrap = $('#teams-wrap');
    let bar = $('#teams-from');
    const r = s().rfp || {};
    if (!bar && r.fixtureId) {
      bar = h(`<div class="panel" id="teams-from" style="grid-column:1/-1;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span id="teams-from-t"></span><span class="sp" style="flex:1"></span><button class="btn sm" id="teams-reload">Reload teams from the match</button></div>`);
      wrap.parentNode.insertBefore(bar, wrap);
      $('#teams-reload').onclick = () => CG.send('rfp', 'refreshTeams', {}).then(() => { renderTeams(true); CG.toast('Teams reloaded from the match', 'ok'); }).catch(e => CG.toast(e.message, 'err'));
    }
    if (bar) $('#teams-from-t').innerHTML = `Match: <b>${esc(r.name || '')}</b> <span class="muted small">· names, colours, logos and squads come from this match in RFP Manager (Fixtures → Team 1 / Team 2)</span>${r.pullError ? `<div class="small" style="color:var(--red)">Could not read the match: ${esc(r.pullError)}</div>` : ''}`;
    ['A', 'B'].forEach(key => {
      let box = wrap.querySelector(`[data-team="${key}"]`);
      if (!box) {
        box = h(`<div class="panel" data-team="${key}"></div>`);
        wrap.appendChild(box);
      }
      if (!force && box.querySelector('[data-dirty="1"]')) return; // don't clobber edits in progress
      if (!force && box.contains(document.activeElement)) return;
      buildTeamEditor(box, key);
    });
  }

  function buildTeamEditor(box, key) {
    const t = CG.team(key);
    const presetOpts = CG.lists.teams.map(n => `<option>${esc(n)}</option>`).join('');
    box.innerHTML = `
      <h4>Team ${key} <span class="sp"></span>
        <select class="sm" data-preset style="width:auto;max-width:180px"><option value="">Load preset…</option>${presetOpts}</select>
        <button class="btn sm" data-savepreset>Save as preset</button></h4>
      <div class="form-grid">
        <label class="f"><span>Name</span><input type="text" data-k="name" value="${esc(t.name)}"></label>
        <label class="f"><span>Short name</span><input type="text" data-k="shortName" value="${esc(t.shortName)}"></label>
        <label class="f"><span>Logo key (logos/KEY.png)</span><input type="text" data-k="logo" value="${esc(t.logo)}"></label>
        <label class="f"><span>Head coach</span><input type="text" data-k="coach" value="${esc(t.coach)}"></label>
        <label class="f"><span>Colours</span><span class="row"><input type="color" data-k="color1" value="${esc(t.color1 || '#1f6f3f')}"><input type="color" data-k="color2" value="${esc(t.color2 || '#f2c500')}"></span></label>
      </div>
      <hr>
      <table class="t" data-players>
        <tr><th>#</th><th>Full name</th><th>TV name</th><th>Role</th><th title="Captain">C</th><th title="Wicket-keeper">WK</th><th></th></tr>
      </table>
      <div class="row" style="margin-top:8px">
        <button class="btn sm" data-add>+ Player</button>
        <button class="btn sm" data-bulk>Bulk paste…</button>
        <span class="grow"></span>
        <button class="btn primary" data-save>Save team ${key}</button>
      </div>`;
    const tbl = box.querySelector('[data-players]');
    const addRow = p => {
      p = p || { id: '', name: '', tvName: '', role: '', captain: false, keeper: false };
      const tr = h(`<table><tr data-id="${esc(p.id)}">
        <td class="muted n"></td>
        <td><input type="text" data-f="name" value="${esc(p.name)}"></td>
        <td><input type="text" data-f="tvName" value="${esc(p.tvName)}" placeholder="auto"></td>
        <td><input type="text" data-f="role" value="${esc(p.role)}" placeholder="Batter / Bowler / All-rounder"></td>
        <td><input type="checkbox" data-f="captain" ${p.captain ? 'checked' : ''}></td>
        <td><input type="checkbox" data-f="keeper" ${p.keeper ? 'checked' : ''}></td>
        <td><button class="btn sm ghost" data-del title="Remove">✕</button></td></tr></table>`).querySelector('tr');
      tr.querySelector('[data-del]').onclick = () => { tr.remove(); markDirty(); renumber(); };
      tbl.appendChild(tr);
      renumber();
    };
    const renumber = () => $$('tr[data-id]', tbl).forEach((tr, i) => tr.firstElementChild.textContent = i + 1);
    const markDirty = () => { const i = box.querySelector('input'); if (i) i.dataset.dirty = '1'; };
    t.players.forEach(addRow);
    box.querySelector('[data-add]').onclick = () => { addRow(); markDirty(); };
    box.querySelector('[data-bulk]').onclick = async () => {
      const r = await CG.modal(`Bulk paste – Team ${key}`, `<p class="small muted">One player per line. Optional: <span class="mono">Full Name | TV NAME | Role</span>. Add <span class="mono">(c)</span> for captain, <span class="mono">(wk)</span> for keeper. Replaces the current list.</p>
        <textarea name="text" rows="14" placeholder="Quinton de Kock (wk)&#10;Temba Bavuma (c) | BAVUMA | Batter"></textarea>`, { ok: 'Use list' });
      if (!r) return;
      $$('tr[data-id]', tbl).forEach(tr => tr.remove());
      r.text.split('\n').map(x => x.trim()).filter(Boolean).forEach(line => {
        const captain = /\((c|capt|captain)\)/i.test(line), keeper = /\((wk|†)\)/i.test(line) || line.includes('†');
        const parts = line.replace(/\((c|capt|captain|wk|†)\)/ig, '').replace('†', '').split('|').map(x => x.trim());
        const existing = t.players.find(p => p.name.toLowerCase() === parts[0].toLowerCase());
        addRow({ id: existing ? existing.id : '', name: parts[0], tvName: parts[1] || '', role: parts[2] || '', captain, keeper });
      });
      markDirty();
    };
    box.querySelector('[data-save]').onclick = () => {
      const d = { key };
      $$('[data-k]', box).forEach(i => d[i.dataset.k] = i.value);
      d.players = $$('tr[data-id]', tbl).map(tr => ({
        id: tr.dataset.id || '',
        name: tr.querySelector('[data-f=name]').value,
        tvName: tr.querySelector('[data-f=tvName]').value,
        role: tr.querySelector('[data-f=role]').value,
        captain: tr.querySelector('[data-f=captain]').checked,
        keeper: tr.querySelector('[data-f=keeper]').checked,
      })).filter(p => p.name.trim());
      CG.score('team', d).then(() => { CG.toast(`Team ${key} saved`, 'ok'); buildTeamEditor(box, key); });
    };
    box.querySelector('[data-savepreset]').onclick = () =>
      CG.send('store', 'saveTeam', { key, name: CG.team(key).name }).then(() => CG.toast('Preset saved (save the team first if you changed it)', 'ok')).catch(e => CG.toast(e.message, 'err'));
    box.querySelector('[data-preset]').onchange = async e => {
      const name = e.target.value;
      if (!name) return;
      const ok = await CG.modal('Load team preset', `<p>Load <b>${esc(name)}</b> into Team ${key}?</p>`, { ok: 'Load' });
      if (ok) await CG.send('store', 'loadTeam', { key, name }).then(() => { CG.toast('Preset loaded', 'ok'); buildTeamEditor(box, key); }).catch(er => CG.toast(er.message, 'err'));
      else e.target.value = '';
    };
  }

  // ---------------------------------------------------------------- SCORECARD
  function inningsButtons(el, selected, onPick) {
    const st = s().stats;
    el.innerHTML = st.innings.length
      ? st.innings.map(i => `<button class="btn sm ${i.index === selected ? 'on' : ''}" data-i="${i.index}">${i.number}. ${esc(i.battingTeamName)} ${i.score} (${i.overs})</button>`).join(' ')
      : '<span class="muted">No innings yet.</span>';
    $$('[data-i]', el).forEach(b => b.onclick = () => onPick(+b.dataset.i));
  }

  function renderCard() {
    const st = s().stats;
    if (cardInnings == null || cardInnings >= st.innings.length) cardInnings = st.currentIndex;
    inningsButtons($('#card-innings'), cardInnings, i => { cardInnings = i; renderCard(); });
    const c = st.innings[cardInnings];
    if (!c) { ['#full-bat', '#full-bowl', '#full-pship'].forEach(x => $(x).innerHTML = ''); $('#full-fow').innerHTML = ''; $('#full-bat-foot').innerHTML = ''; return; }
    $('#full-bat').innerHTML = batTable(c, false);
    $('#full-bat-foot').innerHTML = `<div class="row"><span>Extras <b>${c.extras.total}</b> <span class="muted">(${esc(c.extras.detail || '-')})</span></span><span class="grow"></span><b style="font-size:16px">TOTAL ${c.score} (${c.overs} ov, RR ${c.runRate})</b></div>
      ${c.yetToBat.length ? `<div class="muted" style="margin-top:6px">Yet to bat: ${c.yetToBat.map(b => esc(b.tvName)).join(', ')}</div>` : ''}`;
    $('#full-bowl').innerHTML = bowlTable(c);
    $('#full-fow').innerHTML = c.fow.length ? c.fow.map(f => `<b>${f.wicket}-${f.score}</b> <span class="muted">(${esc(f.name)} ${f.playerRuns}, ${f.over} ov)</span>`).join(' &nbsp; ') : '<span class="muted">—</span>';
    $('#full-pship').innerHTML = `<tr><th>Wkt</th><th>Batters</th><th class="n">Runs</th><th class="n">Balls</th></tr>` + c.partnerships.map(p =>
      `<tr class="${p.current ? 'hl' : ''}"><td>${ordinal(p.forWicket)}</td><td>${esc(p.batter1Name)} ${p.batter1Runs} (${p.batter1Balls}) · ${esc(p.batter2Name)} ${p.batter2Runs} (${p.batter2Balls})</td><td class="n"><b>${p.runs}</b></td><td class="n">${p.balls}</td></tr>`).join('');
  }


  // ---------------------------------------------------------------- RAIN / DLS
  let dlsInnings = null;
  function renderDls() {
    const st = s().stats, m = M(), d = st.dls || {};
    if (dlsInnings == null || dlsInnings >= st.innings.length) dlsInnings = st.currentIndex;
    inningsButtons($('#dls-innings'), dlsInnings, i => { dlsInnings = i; renderDls(); });
    $('#dls-source').textContent = 'table: ' + (d.tableSource || '');

    const c2 = st.innings[1];
    const rows = [];
    if (!d.available) rows.push('<p class="muted">Available once the first innings has started.</p>');
    else {
      rows.push(`<div class="scorebox" style="margin-bottom:8px"><div class="team">${d.applied ? 'REVISED TARGET (DLS)' : 'TARGET'}</div><div></div>
        <div class="score">${c2 && c2.target != null ? c2.target : d.target}</div><div class="overs">${d.team2Overs}<span class="muted" style="font-size:13px"> ov</span></div>
        <div class="meta"><span>FIRST INNINGS <b>${d.firstInningsTotal}</b></span><span>R1 <b>${d.r1.toFixed(1)}%</b>${d.r1Manual ? ' (manual)' : ''}</span>
        <span>R2 <b>${d.r2.toFixed(1)}%</b>${d.r2Manual ? ' (manual)' : ''}</span><span>G50 <b>${d.g50}</b></span>
        ${c2 && c2.target != null && c2.target !== d.target ? `<span class="badge fh">MANUAL TARGET (DLS calc ${d.target})</span>` : ''}</div></div>`);
      if (d.par != null) rows.push(`<div class="banner ${d.diff >= 0 ? 'info' : 'warn'}"><span class="grow" style="font-size:16px">${esc(d.parText)}${d.parManual ? ' (manual)' : ''}</span>
        ${d.parIfWicket != null ? `<span>Par if a wicket falls: <b>${d.parIfWicket}</b></span>` : ''}</div>
        <p class="small muted">Resources used ${d.r2Used.toFixed(1)}% · remaining ${d.r2Remaining.toFixed(1)}%</p>`);
      rows.push(`<details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">Workings</summary><div class="mono small" style="margin-top:6px">${(d.workings || []).map(esc).join('<br>')}</div></details>`);
    }
    $('#dls-summary').innerHTML = rows.join('');

    const raw = CG.rawInnings(dlsInnings);
    const bpo = m.ballsPerOver;
    const ov = b => `${Math.floor(b / bpo)}${b % bpo ? '.' + (b % bpo) : ''}`;
    $('#int-table').innerHTML = raw && raw.interruptions.length
      ? '<tr><th>#</th><th>At</th><th>Wkts</th><th>Overs</th><th>Note</th><th></th></tr>' + raw.interruptions.map((it, i) =>
        `<tr><td>${i + 1}</td><td class="mono">${ov(it.legalBalls)} ov</td><td>${it.wickets}</td><td>${it.oversBefore} → <b>${it.oversAfter}</b></td><td class="muted">${esc(it.note)}</td>
         <td class="n"><button class="btn sm" data-ied="${i}">Edit</button> <button class="btn sm ghost" data-idel="${i}">✕</button></td></tr>`).join('')
      : '<tr><td class="muted">No overs lost in this innings.</td></tr>';
    $$('[data-idel]', $('#int-table')).forEach(b => b.onclick = () => CG.score('deleteInterruption', { innings: dlsInnings, index: +b.dataset.idel }));
    $$('[data-ied]', $('#int-table')).forEach(b => b.onclick = async () => {
      const it = raw.interruptions[+b.dataset.ied];
      const r = await CG.modal('Edit interruption', `<div class="form-grid">
        <label class="f"><span>Legal balls bowled at stoppage</span><input type="number" name="legalBalls" value="${it.legalBalls}" min="0"></label>
        <label class="f"><span>Wickets down</span><input type="number" name="wickets" value="${it.wickets}" min="0" max="9"></label>
        <label class="f"><span>Overs before</span><input type="number" name="oversBefore" value="${it.oversBefore}" min="1"></label>
        <label class="f"><span>Overs after</span><input type="number" name="oversAfter" value="${it.oversAfter}" min="0"></label>
        <label class="f"><span>Note</span><input type="text" name="note" value="${esc(it.note)}"></label></div>`, { ok: 'Save' });
      if (r) CG.score('editInterruption', { innings: dlsInnings, index: +b.dataset.ied, legalBalls: +r.legalBalls, wickets: +r.wickets, oversBefore: +r.oversBefore, oversAfter: +r.oversAfter, note: r.note });
    });
    fill($('#start-overs'), raw && raw.startOvers);
    fill($('#int-overs'), raw ? (raw.maxOversOverride || raw.startOvers || m.oversPerInnings) : '');

    fill($('#dls-enabled'), m.dls.enabled);
    fill($('#dls-g50'), m.dls.g50);
    fill($('#dls-r1'), m.dls.r1Override);
    fill($('#dls-r2'), m.dls.r2Override);
    fill($('#dls-par'), m.dls.parOverride);
    fill($('#opt-target'), m.innings[1] ? m.innings[1].targetOverride : '');
  }

  $('#int-add').onclick = async () => {
    const overs = $('#int-overs').value;
    if (overs === '') return;
    const ok = await CG.modal('Record overs lost', `<p>Set this innings to <b>${esc(overs)}</b> overs at the current score? The DLS target and par update immediately.</p>`, { ok: 'Record' });
    if (!ok) return;
    CG.score('interruption', { overs: +overs, note: $('#int-note').value, innings: dlsInnings })
      .then(() => { delete $('#int-overs').dataset.dirty; $('#int-note').value = ''; CG.toast('Overs lost recorded', 'ok'); });
  };
  $('#start-overs-save').onclick = () => CG.score('startOvers', { innings: dlsInnings, overs: $('#start-overs').value === '' ? null : +$('#start-overs').value })
    .then(() => { delete $('#start-overs').dataset.dirty; CG.toast('Start overs set', 'ok'); });

  const numOrNull = v => v === '' || v == null ? null : +v;
  async function saveDls(clear) {
    if (clear) ['#dls-r1', '#dls-r2', '#dls-par', '#opt-target'].forEach(x => { $(x).value = ''; });
    await CG.score('dls', {
      enabled: $('#dls-enabled').checked, g50: +$('#dls-g50').value || 245,
      r1Override: numOrNull($('#dls-r1').value), r2Override: numOrNull($('#dls-r2').value), parOverride: numOrNull($('#dls-par').value),
    });
    const t = $('#opt-target').value;
    const cur = M().innings[1] ? M().innings[1].targetOverride : null;
    if (numOrNull(t) !== (cur == null ? null : cur)) await CG.score('target', { target: numOrNull(t) });
    clean($('#page-dls'));
    CG.toast(clear ? 'Manual overrides cleared' : 'DLS settings saved', 'ok');
  }
  $('#dls-save').onclick = () => saveDls(false).catch(() => { });
  $('#dls-clear').onclick = () => saveDls(true).catch(() => { });

  $('#dls-table-btn').onclick = async () => {
    let tbl = { source: '', rows: [] };
    try { tbl = await fetch('api/dls-table' + CG.query).then(r => r.json()); } catch (e) { /* offline */ }
    const preview = tbl.rows.slice().reverse().map((r, i) => `<tr><td class="muted">${50 - i}</td>${r.map(v => `<td class="n">${v.toFixed(1)}</td>`).join('')}</tr>`).join('');
    const r = await CG.modal('DLS resource table', `
      <p class="small muted" style="margin:0">Current: <b>${esc(tbl.source)}</b>. Rows = overs left, columns = wickets lost.</p>
      <div style="max-height:260px;overflow:auto"><table class="t"><tr><th>Ov</th>${[0,1,2,3,4,5,6,7,8,9].map(w => `<th class="n">${w}</th>`).join('')}</tr>${preview}</table></div>
      <label class="f"><span>Paste the official table (51 rows; optional leading "overs left" column; tabs, spaces or commas)</span>
      <textarea name="text" rows="8" placeholder="50 100.0 93.4 85.1 ...&#10;49 99.1 ..."></textarea></label>`,
      { ok: 'Import pasted table', extraButtons: '<button class="btn" data-value="reset">Reset to built-in</button>' });
    if (!r) return;
    if (r.__button === 'reset') CG.score('dlsTableReset').then(() => CG.toast('Built-in table restored', 'ok'));
    else if (r.text && r.text.trim()) CG.score('dlsTable', { text: r.text }).then(() => CG.toast('Official table imported', 'ok'));
  };

  // ---------------------------------------------------------------- BALL LOG
  function renderBalls() {
    const st = s().stats;
    if (logInnings == null || logInnings >= st.innings.length) logInnings = st.currentIndex;
    inningsButtons($('#balls-innings'), logInnings, i => { logInnings = i; renderBalls(); });
    const raw = CG.rawInnings(logInnings);
    if (!raw) { $('#ball-log').innerHTML = ''; return; }
    const bpo = M().ballsPerOver;
    let legal = 0;
    const rows = raw.balls.map(b => {
      const ov = `${Math.floor(legal / bpo)}.${(legal % bpo) + (b.extra === 'wd' || b.extra === 'nb' || b.extra === 'pen' ? 0 : 1)}`;
      if (!(b.extra === 'wd' || b.extra === 'nb' || b.extra === 'pen')) legal++;
      const w = b.wicket ? `${b.wicket.kind} – ${esc(CG.pname(b.wicket.playerOutId))}` : '';
      return `<tr><td class="mono">${ov}</td><td>${esc(CG.pname(b.bowlerId))} → ${esc(CG.pname(b.strikerId))}</td>
        <td class="n">${b.batRuns}</td><td>${b.extra ? `${b.extra} ${b.extraRuns}` : ''}</td><td>${b.boundary ? 'boundary' : ''}</td><td>${w}</td>
        <td class="n"><button class="btn sm" data-edit="${b.seq}">Edit</button> <button class="btn sm ghost" data-del="${b.seq}">✕</button></td></tr>`;
    }).reverse();
    $('#ball-log').innerHTML = `<tr><th>Ball</th><th>Bowler → Batter</th><th class="n">Bat</th><th>Extra</th><th></th><th>Wicket</th><th></th></tr>` + rows.join('');
    $$('[data-del]', $('#ball-log')).forEach(b => b.onclick = async () => {
      const ok = await CG.modal('Delete ball', '<p>Delete this delivery? Figures are recalculated. Check the batters and bowler afterwards.</p>', { ok: 'Delete', danger: true });
      if (ok) CG.score('deleteBall', { innings: logInnings, seq: +b.dataset.del });
    });
    $$('[data-edit]', $('#ball-log')).forEach(b => b.onclick = () => editBall(raw, +b.dataset.edit));
  }

  async function editBall(raw, seq) {
    const b = raw.balls.find(x => x.seq === seq);
    if (!b) return;
    const w = b.wicket || { kind: '', playerOutId: '', fielderId: '' };
    const bt = raw.battingTeam, bw = raw.bowlingTeam;
    const kinds = ['', 'bowled', 'caught', 'caughtbowled', 'lbw', 'runout', 'stumped', 'hitwicket', 'retiredhurt', 'retiredout', 'obstructing', 'timedout'];
    const body = `<div class="form-grid">
      <label class="f"><span>Bowler</span><select name="bowlerId">${CG.playerOptions(bw, b.bowlerId)}</select></label>
      <label class="f"><span>Striker</span><select name="strikerId">${CG.playerOptions(bt, b.strikerId)}</select></label>
      <label class="f"><span>Non-striker</span><select name="nonStrikerId">${CG.playerOptions(bt, b.nonStrikerId)}</select></label>
      <label class="f"><span>Runs off bat</span><input type="number" name="batRuns" value="${b.batRuns}" min="0"></label>
      <label class="f"><span>Extra type</span><select name="extra">${['', 'wd', 'nb', 'b', 'lb', 'pen'].map(x => `<option value="${x}" ${x === b.extra ? 'selected' : ''}>${x || 'none'}</option>`).join('')}</select></label>
      <label class="f"><span>Extra runs (incl. wd/nb penalty)</span><input type="number" name="extraRuns" value="${b.extraRuns}" min="0"></label>
      <label class="chk"><input type="checkbox" name="boundary" ${b.boundary ? 'checked' : ''}> Boundary</label>
    </div><hr><div class="form-grid">
      <label class="f"><span>Wicket</span><select name="kind">${kinds.map(k => `<option value="${k}" ${k === w.kind ? 'selected' : ''}>${k || 'none'}</option>`).join('')}</select></label>
      <label class="f"><span>Batter out</span><select name="out">${CG.playerOptions(bt, w.playerOutId)}</select></label>
      <label class="f"><span>Fielder</span><select name="fielder">${CG.playerOptions(bw, w.fielderId || '', { blankLabel: '— none —' })}</select></label>
    </div>`;
    const r = await CG.modal('Edit delivery', body, { ok: 'Save' });
    if (!r) return;
    CG.score('editBall', {
      innings: logInnings, seq, batRuns: +r.batRuns || 0, extra: r.extra, extraRuns: +r.extraRuns || 0, boundary: !!r.boundary,
      bowlerId: r.bowlerId, strikerId: r.strikerId, nonStrikerId: r.nonStrikerId,
      wicket: r.kind ? { kind: r.kind, playerOutId: r.out || b.strikerId, fielderId: r.fielder || null } : null,
    });
  }

  showPage(CG.store.get('statsPage', 'score'));
  CG.connect('stats');
})();

// RFP Manager: the export link carries the match from the address.
(function () { var a = document.getElementById('export-link'); if (a) a.href = 'api/export' + CG.query; })();
