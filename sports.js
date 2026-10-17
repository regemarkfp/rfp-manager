/* RFP Manager (from CricketCG) – shared rules engines for "other sports".
 *
 * Event-sourced: a match is { setup, events[] }. compute(setup, events) replays every event through the
 * sport's rules and returns a "view" (scores, periods, timeline, stats, facts) plus a flat key/value map
 * that the server sends to graphics templates. The same file runs in the browser and in Node (tests).
 *
 * Sports: rugby, football, hockey, netball, basketball (timed) · tennis, padel (points/games/sets) ·
 *         badminton, volleyball (rally scoring) · baseball · athletics.
 */
(function () {
  'use strict';

  // ================================================================== helpers
  const U = {
    up: s => String(s == null ? '' : s).toUpperCase(),
    pad: n => String(n).padStart(2, '0'),
    fmtClock(ms) {
      ms = Math.max(0, Math.round(ms || 0));
      const t = Math.floor(ms / 1000), m = Math.floor(t / 60), s = t % 60;
      return `${U.pad(m)}:${U.pad(s)}`;
    },
    ordinal(n) { return n + (n % 10 === 1 && n % 100 !== 11 ? 'ST' : n % 10 === 2 && n % 100 !== 12 ? 'ND' : n % 10 === 3 && n % 100 !== 13 ? 'RD' : 'TH'); },
    other: t => (t === 'A' ? 'B' : 'A'),
    id: () => Math.random().toString(36).slice(2, 10),
    clone: o => JSON.parse(JSON.stringify(o)),
    plural: (n, w) => `${n} ${w}${n === 1 ? '' : 'S'}`,
  };

  const SPORTS = {};
  function register(def) { SPORTS[def.id] = def; }

  function teamOf(setup, k) {
    const t = (setup.teams && setup.teams[k]) || {};
    return { name: t.name || (k === 'A' ? 'HOME' : 'AWAY'), short: t.short || (t.name || k).slice(0, 3).toUpperCase(), logo: t.logo || '',
      color1: t.color1 || (k === 'A' ? '#1f6feb' : '#d92d34'), color2: t.color2 || '#ffffff', coach: t.coach || '', players: t.players || [] };
  }
  function findPlayer(setup, id) {
    if (!id) return null;
    for (const k of ['A', 'B']) {
      const p = (setup.teams && setup.teams[k] && setup.teams[k].players || []).find(x => x.id === id);
      if (p) return Object.assign({ team: k }, p);
    }
    return null;
  }
  const pname = p => (p ? (p.tvName || U.up(p.name)) : '');
  const pnum = p => (p && p.number !== undefined && p.number !== '' ? '#' + p.number + ' ' : '');

  function baseView(def, setup) {
    return {
      sport: def.id, name: def.name, kind: def.kind, variant: setup.variant || def.defaultVariant || '',
      options: resolveOptions(def, setup),
      teams: { A: teamOf(setup, 'A'), B: teamOf(setup, 'B') },
      score: { A: '0', B: '0' }, periodLabel: '', status: '', finished: false, winner: null,
      table: { title: '', cols: [], A: [], B: [], total: ['', ''] },
      timeline: [], teamStats: [], players: [], leaders: [], sinbins: [], lastEvent: null, facts: [],
      clock: { game: null, shot: null }, timing: { periodLenMs: 0, continuous: false, period: 1 },
      extra: {}, flat: {},
    };
  }

  function resolveOptions(def, setup) {
    const v = (def.variants && def.variants[setup.variant || def.defaultVariant]) || {};
    return Object.assign({}, def.options || {}, v.options || {}, setup.options || {});
  }

  // ================================================================== TIMED TEAM SPORTS
  // rugby, hockey, netball, basketball share one engine configured by a table of actions.
  function timedSport(cfg) {
    const def = Object.assign({ kind: 'timed' }, cfg);

    def.init = setup => {
      const o = resolveOptions(def, setup);
      return {
        o, setup, period: 1, finished: false,
        score: { A: 0, B: 0 }, periodScore: [{ A: 0, B: 0 }],
        stats: { A: {}, B: {} }, pstats: {}, timeline: [], sinbins: [], reds: [], last: null,
        shares: {}, lastGt: 0,
        fouls: { A: [0], B: [0] }, timeouts: { A: 0, B: 0 }, shootout: { A: [], B: [] }, goalsInPeriod: [0],
      };
    };

    const actions = o => (typeof def.actions === 'function' ? def.actions(o) : def.actions);
    const act = (o, key) => actions(o).find(a => a.key === key);
    const inc = (obj, k, n = 1) => { obj[k] = (obj[k] || 0) + n; };
    const pst = (st, id) => (st.pstats[id] = st.pstats[id] || {});

    // Time-share stats (possession, territory): each event hands the share to a team from that moment on.
    const shareOf = (st, key) => (st.shares[key] = st.shares[key] || { A: 0, B: 0, cur: '', since: 0 });
    const closeShare = (sh, gt) => { if (sh.cur && gt > sh.since) sh[sh.cur] += gt - sh.since; sh.since = gt; };

    def.apply = (st, ev) => {
      const o = st.o, t = ev.team, p = findPlayer(st.setup, ev.player);
      if (ev.gt != null && ev.gt > st.lastGt) st.lastGt = ev.gt;
      const ps = st.periodScore[st.period - 1] || (st.periodScore[st.period - 1] = { A: 0, B: 0 });
      const stamp = { id: ev.id, period: st.period, ct: ev.ct || '', gt: ev.gt, team: t, player: ev.player || '' };
      const who = p ? ` – ${pnum(p)}${pname(p)}` : '';
      switch (ev.type) {
        case 'score': {
          const a = act(o, ev.key); if (!a) return;
          st.score[t] += a.pts; ps[t] += a.pts;
          inc(st.stats[t], a.stat || a.key);
          if (a.pts) inc(st.stats[t], 'points', a.pts);
          if (a.attempt) inc(st.stats[t], a.attempt);
          if (p) { const s = pst(st, p.id); inc(s, a.stat || a.key); if (a.pts) inc(s, 'points', a.pts); if (a.attempt) inc(s, a.attempt); }
          st.goalsInPeriod[st.period - 1] = (st.goalsInPeriod[st.period - 1] || 0) + 1;
          const text = `${U.up(a.label)}${who}`;
          st.timeline.push(Object.assign(stamp, { kind: 'score', text, icon: a.icon || 'score', pts: a.pts, key: a.key }));
          st.last = { type: 'score', key: a.key, team: t, player: ev.player || '', text, wipe: a.wipe || '' };
          break;
        }
        case 'miss': case 'stat': {
          const a = act(o, ev.key); if (!a) return;
          inc(st.stats[t], a.stat || a.key);
          if (a.attempt) inc(st.stats[t], a.attempt);
          if (a.also) inc(st.stats[t], a.also);
          if (p) { const s = pst(st, p.id); inc(s, a.stat || a.key); if (a.attempt) inc(s, a.attempt); if (a.also) inc(s, a.also); }
          if (a.timeline) {
            const text = `${U.up(a.label)}${who}`;
            st.timeline.push(Object.assign(stamp, { kind: 'stat', text, icon: a.icon || 'stat', key: a.key }));
            st.last = { type: 'stat', key: a.key, team: t, player: ev.player || '', text, wipe: a.wipe || '' };
          }
          break;
        }
        case 'card': {
          const c = (def.cards || []).find(x => x.key === ev.key); if (!c) return;
          inc(st.stats[t], c.key + '_cards');
          if (p) inc(pst(st, p.id), c.key + '_cards');
          const mins = ev.minutes != null ? +ev.minutes : c.min;
          if (c.permanent) st.reds.push({ team: t, player: ev.player || '', name: pname(p), number: p ? p.number : '', card: c.key });
          else if (mins > 0 && ev.gt != null) st.sinbins.push({ team: t, player: ev.player || '', name: pname(p), number: p ? p.number : '', card: c.key, untilGt: ev.gt + mins * 60000 });
          const text = `${U.up(c.label)}${who}`;
          st.timeline.push(Object.assign(stamp, { kind: 'card', text, icon: c.key, key: c.key }));
          st.last = { type: 'card', key: c.key, team: t, player: ev.player || '', text, wipe: '' };
          break;
        }
        case 'foul': {
          inc(st.stats[t], 'fouls');
          st.fouls[t][st.period - 1] = (st.fouls[t][st.period - 1] || 0) + 1;
          let text = `FOUL${who}`;
          if (p) {
            const s = pst(st, p.id); inc(s, 'fouls');
            if (o.foulOut && s.fouls === o.foulOut) text += ` – FOULED OUT (${s.fouls})`;
          }
          st.timeline.push(Object.assign(stamp, { kind: 'foul', text, icon: 'foul' }));
          st.last = { type: 'foul', team: t, player: ev.player || '', text, wipe: '' };
          break;
        }
        case 'timeout': {
          st.timeouts[t]++;
          const text = 'TIMEOUT';
          st.timeline.push(Object.assign(stamp, { kind: 'timeout', text, icon: 'timeout' }));
          st.last = { type: 'timeout', team: t, text, wipe: '' };
          break;
        }
        case 'sub': {
          const on = findPlayer(st.setup, ev.on), off = findPlayer(st.setup, ev.off);
          const text = `ON ${pnum(on)}${pname(on)}${off ? ` · OFF ${pnum(off)}${pname(off)}` : ''}`;
          st.timeline.push(Object.assign(stamp, { kind: 'sub', text, icon: 'sub', on: ev.on || '', off: ev.off || '' }));
          st.last = { type: 'sub', team: t, player: ev.on || '', off: ev.off || '', text, onName: pname(on), offName: pname(off), onNumber: on ? on.number : '', offNumber: off ? off.number : '', wipe: '' };
          break;
        }
        case 'shootout': {
          st.shootout[t].push(!!ev.scored);
          if (p) inc(pst(st, p.id), ev.scored ? 'so_goals' : 'so_miss');
          const text = `SHOOT-OUT ${ev.scored ? 'SCORED' : 'MISSED'}${who}`;
          st.timeline.push(Object.assign(stamp, { kind: 'shootout', text, icon: ev.scored ? 'score' : 'miss' }));
          st.last = { type: 'shootout', team: t, player: ev.player || '', text, wipe: ev.scored ? (def.soWipe || 'GOAL') : '' };
          break;
        }
        case 'share': {
          const sh = shareOf(st, ev.key || 'poss'), gt = ev.gt != null ? ev.gt : st.lastGt;
          closeShare(sh, gt); sh.cur = t === 'A' || t === 'B' ? t : '';
          break;
        }
        case 'period': {
          Object.values(st.shares).forEach(sh => { closeShare(sh, ev.gt != null ? ev.gt : st.lastGt); sh.cur = ''; });
          st.period = Math.max(1, ev.to || st.period + 1);
          while (st.periodScore.length < st.period) st.periodScore.push({ A: 0, B: 0 });
          while (st.fouls.A.length < st.period) { st.fouls.A.push(0); st.fouls.B.push(0); }
          if (def.timeoutsPer === 'half' && st.period === Math.floor(o.periods / 2) + 1) st.timeouts = { A: 0, B: 0 };
          st.timeline.push(Object.assign(stamp, { period: st.period, kind: 'period', text: `START OF ${def.periodName(st.period, o)}`, icon: 'period', team: '' }));
          st.finished = false;
          break;
        }
        case 'end': {
          st.finished = true;
          st.timeline.push(Object.assign(stamp, { kind: 'end', text: 'FULL TIME', icon: 'end', team: '' }));
          break;
        }
        case 'adjust': {
          const d = +ev.delta || 0;
          st.score[t] += d; ps[t] += d;
          st.timeline.push(Object.assign(stamp, { kind: 'adjust', text: `SCORE CORRECTION ${d > 0 ? '+' : ''}${d}`, icon: 'adjust' }));
          break;
        }
        case 'note': {
          st.timeline.push(Object.assign(stamp, { kind: 'note', text: U.up(ev.text || ''), icon: 'note', team: t || '' }));
          st.last = { type: 'note', team: t || '', text: U.up(ev.text || ''), wipe: '' };
          break;
        }
      }
    };

    def.view = (st, setup) => {
      const v = baseView(def, setup), o = st.o;
      v.score = { A: String(st.score.A), B: String(st.score.B) };
      v.periodLabel = st.finished ? 'FULL TIME' : def.periodName(st.period, o);
      v.finished = st.finished;
      v.winner = st.finished ? (st.score.A > st.score.B ? 'A' : st.score.B > st.score.A ? 'B' : null) : null;
      const so = st.shootout.A.length + st.shootout.B.length > 0;
      if (so && st.score.A === st.score.B) {
        const sa = st.shootout.A.filter(Boolean).length, sb = st.shootout.B.filter(Boolean).length;
        v.extra.shootout = { A: st.shootout.A, B: st.shootout.B, sa, sb };
        if (st.finished) v.winner = sa > sb ? 'A' : sb > sa ? 'B' : null;
      }
      const inReg = st.period <= o.periods;
      const periodLenMs = (inReg ? o.periodMin : (o.otMin || o.periodMin)) * 60000;
      const cont = !!o.continuous && inReg && o.clockDir !== 'down';
      v.timing = { periodLenMs, continuous: cont, period: inReg ? st.period : 1 };
      v.clock.game = { dir: o.clockDir === 'down' ? -1 : 1, limitMs: cont ? periodLenMs * st.period : periodLenMs,
        startMs: o.clockDir === 'down' ? periodLenMs : (cont ? periodLenMs * (st.period - 1) : 0), stopAtLimit: !!o.stopAtLimit };
      if (o.shotClock) v.clock.shot = { dir: -1, limitMs: o.shotClock * 1000, startMs: o.shotClock * 1000, stopAtLimit: true, reset2: (o.shotReset2 || 0) * 1000 };

      // period table
      const n = Math.max(st.period, o.periods);
      v.table.title = def.tableTitle || 'SCORE BY PERIOD';
      v.table.cols = Array.from({ length: n }, (_, i) => def.periodShort(i + 1, o));
      v.table.A = Array.from({ length: n }, (_, i) => (i < st.periodScore.length && i < st.period ? String(st.periodScore[i].A) : ''));
      v.table.B = Array.from({ length: n }, (_, i) => (i < st.periodScore.length && i < st.period ? String(st.periodScore[i].B) : ''));
      v.table.total = [String(st.score.A), String(st.score.B)];

      v.timeline = st.timeline;
      v.sinbins = st.sinbins;
      v.extra.reds = st.reds;
      v.lastEvent = st.last;
      v.extra.timeouts = st.timeouts;
      v.extra.teamFouls = { A: st.fouls.A[st.period - 1] || 0, B: st.fouls.B[st.period - 1] || 0 };
      if (o.bonusAt) v.extra.bonus = { A: v.extra.teamFouls.B >= o.bonusAt, B: v.extra.teamFouls.A >= o.bonusAt };
      if (def.centrePass) {
        const first = o.centreFirst || 'A';
        const qStart = st.period % 2 === 1 ? first : U.other(first);
        const g = st.goalsInPeriod[st.period - 1] || 0;
        v.extra.centrePass = g % 2 === 0 ? qStart : U.other(qStart);
      }

      // team stats table (time shares are counted up to the latest event)
      const shares = {};
      Object.keys(st.shares).forEach(key => {
        const sh = st.shares[key], x = { A: sh.A, B: sh.B };
        if (sh.cur && st.lastGt > sh.since) x[sh.cur] += st.lastGt - sh.since;
        const tot = x.A + x.B;
        shares[key] = { A: tot ? Math.round(x.A * 100 / tot) : 0, B: tot ? 100 - Math.round(x.A * 100 / tot) : 0, cur: sh.cur, any: tot > 0 };
      });
      v.extra.shares = shares;
      v.raw = { A: st.stats.A, B: st.stats.B };
      v.shareDefs = def.shares || [];
      const sval = (k, s) => (s.share ? (shares[s.share] && shares[s.share].any ? shares[s.share][k] + '%' : '–') : statVal(st.stats[k], s));
      v.teamStats = (def.teamStats || []).map(s => ({ label: s.label, a: sval('A', s), b: sval('B', s) }));
      if (def.timeoutsMax) v.teamStats.push({ label: 'TIMEOUTS', a: String(st.timeouts.A), b: String(st.timeouts.B) });

      // players
      ['A', 'B'].forEach(k => v.teams[k].players.forEach(pl => {
        const s = st.pstats[pl.id] || {};
        v.players.push({ id: pl.id, team: k, name: pl.name, tvName: pl.tvName || U.up(pl.name), number: pl.number == null ? '' : String(pl.number), position: pl.position || '',
          stats: s, statsText: (def.playerLine ? def.playerLine(s, o) : '') });
      }));
      v.leaders = (def.leaders || []).map(L => {
        const best = v.players.filter(p => (p.stats[L.stat] || 0) > 0).sort((a, b) => (b.stats[L.stat] || 0) - (a.stats[L.stat] || 0))[0];
        return best ? { label: L.label, name: best.tvName, team: best.team, value: best.stats[L.stat] } : null;
      }).filter(Boolean);

      const lead = st.score.A === st.score.B ? 'SCORES LEVEL' : `${v.teams[st.score.A > st.score.B ? 'A' : 'B'].name.toUpperCase()} LEAD BY ${Math.abs(st.score.A - st.score.B)}`;
      v.status = st.finished ? (v.winner ? `${v.teams[v.winner].name.toUpperCase()} WIN` : 'DRAW') : lead;
      if (def.extraView) def.extraView(v, st);
      v.facts = timedFacts(def, v, st);
      return v;
    };
    return def;
  }

  function statVal(obj, s) {
    if (s.sum) return String(s.sum.reduce((n, k) => n + (obj[k] || 0), 0));
    if (s.pct) {
      const made = obj[s.made] || 0, att = obj[s.att] || 0;
      return att ? `${made}/${att} (${Math.round(made * 100 / att)}%)` : '0/0';
    }
    return String(obj[s.key] || 0);
  }

  function timedFacts(def, v, st) {
    const f = [];
    const A = v.teams.A.name.toUpperCase(), B = v.teams.B.name.toUpperCase();
    f.push({ cat: 'SCORE', big: `${v.score.A} – ${v.score.B}`, txt: `${A} v ${B} · ${v.periodLabel}` });
    v.leaders.forEach(l => f.push({ cat: l.label, big: String(l.value), txt: `${l.name} (${v.teams[l.team].short})` }));
    v.teamStats.slice(0, 6).forEach(s => { if (s.a !== '0' || s.b !== '0') f.push({ cat: s.label, big: `${s.a} – ${s.b}`, txt: `${v.teams.A.short} v ${v.teams.B.short}` }); });
    const scores = st.timeline.filter(e => e.kind === 'score');
    if (scores.length) {
      const last = scores[scores.length - 1];
      f.push({ cat: 'LAST SCORE', big: `${last.ct || ''}`.trim() || v.teams[last.team].short, txt: `${last.text} (${v.teams[last.team].short})` });
      let run = 0, k = scores.length - 1;
      while (k >= 0 && scores[k].team === last.team) { run += scores[k].pts || 0; k--; }
      if (run >= (def.runMin || 6)) f.push({ cat: 'UNANSWERED', big: String(run), txt: `unanswered points by ${v.teams[last.team].name.toUpperCase()}` });
    }
    v.sinbins.forEach(s => f.push({ cat: 'SIN BIN', big: `${s.number ? '#' + s.number : ''}`.trim() || 'SIN BIN', txt: `${s.name} (${v.teams[s.team].short}) – ${s.card.toUpperCase()} CARD` }));
    if (v.extra.bonus && (v.extra.bonus.A || v.extra.bonus.B)) f.push({ cat: 'BONUS', big: v.extra.bonus.A ? v.teams.A.short : v.teams.B.short, txt: 'in the bonus – next foul is free throws' });
    return f;
  }

  // ----------------------------------------------------------------- rugby
  const RUGBY_POINTS = {
    union: { try: 5, conv: 2, pen: 3, drop: 3, ptry: 7 },
    sevens: { try: 5, conv: 2, pen: 3, drop: 3, ptry: 7 },
    league: { try: 4, conv: 2, pen: 2, drop: 1, ptry: 6 },
  };
  register(timedSport({
    id: 'rugby', name: 'Rugby',
    defaultVariant: 'union',
    variants: {
      union: { label: 'Rugby union – World Rugby (2 × 40)', options: { periods: 2, periodMin: 40, otMin: 10, points: 'union', sinbinMin: 10 } },
      u19: { label: 'Rugby union U19 (2 × 35)', options: { periods: 2, periodMin: 35, otMin: 10, points: 'union', sinbinMin: 10 } },
      schools: { label: 'Rugby union schools (2 × 30)', options: { periods: 2, periodMin: 30, otMin: 5, points: 'union', sinbinMin: 7 } },
      sevens: { label: 'Rugby sevens (2 × 7)', options: { periods: 2, periodMin: 7, otMin: 5, points: 'sevens', sinbinMin: 2 } },
      sevensfinal: { label: 'Rugby sevens final (2 × 10)', options: { periods: 2, periodMin: 10, otMin: 5, points: 'sevens', sinbinMin: 2 } },
      league: { label: 'Rugby league (2 × 40)', options: { periods: 2, periodMin: 40, otMin: 5, points: 'league', sinbinMin: 10 } },
    },
    options: { clockDir: 'up', continuous: true },
    actions: o => {
      const P = RUGBY_POINTS[o.points] || RUGBY_POINTS.union;
      return [
        { key: 'try', label: 'Try', pts: P.try, player: true, wipe: 'TRY', btn: 'big' },
        { key: 'conv', label: 'Conversion', pts: P.conv, player: true, attempt: 'conv_att' },
        { key: 'pen', label: o.points === 'league' ? 'Penalty goal' : 'Penalty', pts: P.pen, player: true, attempt: 'pen_att' },
        { key: 'drop', label: 'Drop goal', pts: P.drop, player: true, wipe: 'DROP GOAL' },
        { key: 'ptry', label: 'Penalty try', pts: P.ptry, player: false, wipe: 'PENALTY TRY' },
        { key: 'conv_miss', label: 'Conversion missed', type: 'miss', stat: 'conv_att', player: true },
        { key: 'pen_miss', label: 'Penalty missed', type: 'miss', stat: 'pen_att', player: true },
        // match statistics (World Rugby match-stat categories)
        { key: 'carry', label: 'Carry', abbr: 'CAR', cat: 'Attack', type: 'stat', group: 'stats', player: true },
        { key: 'linebreak', label: 'Line break', abbr: 'LB', cat: 'Attack', type: 'stat', group: 'stats', player: true },
        { key: 'offload', label: 'Offload', abbr: 'OFF', cat: 'Attack', type: 'stat', group: 'stats', player: true },
        { key: 'entry22', label: '22m entry', cat: 'Attack', type: 'stat', group: 'stats', player: false },
        { key: 'kick', label: 'Kick from hand', abbr: 'KCK', cat: 'Attack', type: 'stat', group: 'stats', player: true },
        { key: 'error', label: 'Handling error', abbr: 'ERR', cat: 'Attack', type: 'stat', group: 'stats', player: true },
        { key: 'tackle', label: 'Tackle made', abbr: 'TKL', cat: 'Defence', type: 'stat', group: 'stats', player: true, attempt: 'tackle_att' },
        { key: 'tackle_miss', label: 'Tackle missed', abbr: 'MT', cat: 'Defence', type: 'stat', group: 'stats', player: true, also: 'tackle_att' },
        { key: 'to_won', label: 'Turnover won', abbr: 'TOW', cat: 'Defence', type: 'stat', group: 'stats', player: true },
        { key: 'to_con', label: 'Turnover conceded', abbr: 'TOC', cat: 'Defence', type: 'stat', group: 'stats', player: true },
        { key: 'scrum_won', label: 'Scrum won', cat: 'Set piece', type: 'stat', group: 'stats', player: false, attempt: 'scrum_att' },
        { key: 'scrum_lost', label: 'Scrum lost', cat: 'Set piece', type: 'stat', group: 'stats', player: false, also: 'scrum_att' },
        { key: 'lineout_won', label: 'Lineout won', cat: 'Set piece', type: 'stat', group: 'stats', player: false, attempt: 'lineout_att' },
        { key: 'lineout_lost', label: 'Lineout lost', cat: 'Set piece', type: 'stat', group: 'stats', player: false, also: 'lineout_att' },
        { key: 'ruck_won', label: 'Ruck won', cat: 'Set piece', type: 'stat', group: 'stats', player: false, attempt: 'ruck_att' },
        { key: 'ruck_lost', label: 'Ruck lost', cat: 'Set piece', type: 'stat', group: 'stats', player: false, also: 'ruck_att' },
        { key: 'maul_won', label: 'Maul won', cat: 'Set piece', type: 'stat', group: 'stats', player: false },
        { key: 'pen_con', label: 'Penalty conceded', abbr: 'PC', cat: 'Discipline', type: 'stat', group: 'stats', player: true },
        { key: 'fk_con', label: 'Free kick conceded', cat: 'Discipline', type: 'stat', group: 'stats', player: false },
      ];
    },
    shares: [{ key: 'poss', label: 'Possession' }, { key: 'terr', label: 'Territory' }],
    // World Rugby: yellow = 10 minutes in the sin bin (2 in sevens). The 20-minute red card (team may bring on a
    // replacement after 20 minutes) sits alongside the permanent red card for deliberate, dangerous foul play.
    cards: [{ key: 'yellow', label: 'Yellow card', min: 10 }, { key: 'red20', label: '20-min red card', min: 20, color: '#e5484d' }, { key: 'red', label: 'Red card (permanent)', permanent: true }],
    periodName: (p, o) => (p === 1 ? 'FIRST HALF' : p === 2 ? 'SECOND HALF' : p <= 4 ? 'EXTRA TIME' : 'SUDDEN DEATH'),
    // Competition points as most unions award them: 4 win, 2 draw, +1 for four or more tries, +1 for losing by seven or fewer.
    extraView(v, st) {
      if (st.o.points === 'league' || st.o.bonusPoints === false) return;
      const tries = k => (st.stats[k].try || 0) + (st.stats[k].ptry || 0);
      const bp = k => { const o = U.other(k), d = st.score[k] - st.score[o]; return { tries: tries(k), tryBonus: tries(k) >= 4, losingBonus: d < 0 && d >= -7 }; };
      const A = bp('A'), B = bp('B');
      const pts = (x, k) => (st.score[k] > st.score[U.other(k)] ? 4 : st.score.A === st.score.B ? 2 : 0) + (x.tryBonus ? 1 : 0) + (x.losingBonus ? 1 : 0);
      v.extra.bonusPts = { A: Object.assign(A, { log: pts(A, 'A') }), B: Object.assign(B, { log: pts(B, 'B') }) };
    },
    periodShort: p => (p === 1 ? '1H' : p === 2 ? '2H' : 'ET' + (p - 2)),
    tableTitle: 'SCORE BY HALF',
    teamStats: [
      { label: 'TRIES', key: 'try' }, { label: 'CONVERSIONS', pct: true, made: 'conv', att: 'conv_att' },
      { label: 'PENALTY GOALS', pct: true, made: 'pen', att: 'pen_att' }, { label: 'DROP GOALS', key: 'drop' },
      { label: 'POSSESSION', share: 'poss' }, { label: 'TERRITORY', share: 'terr' },
      { label: 'TACKLES MADE', pct: true, made: 'tackle', att: 'tackle_att' }, { label: 'PENALTIES CONCEDED', key: 'pen_con' },
      { label: 'YELLOW CARDS', key: 'yellow_cards' }, { label: 'RED CARDS', key: 'red_all' },
      { label: 'CARRIES', key: 'carry' }, { label: 'LINE BREAKS', key: 'linebreak' }, { label: 'OFFLOADS', key: 'offload' }, { label: '22M ENTRIES', key: 'entry22' },
      { label: 'KICKS FROM HAND', key: 'kick' }, { label: 'HANDLING ERRORS', key: 'error' },
      { label: 'TURNOVERS WON', key: 'to_won' }, { label: 'TURNOVERS CONCEDED', key: 'to_con' },
      { label: 'SCRUMS WON', pct: true, made: 'scrum_won', att: 'scrum_att' }, { label: 'LINEOUTS WON', pct: true, made: 'lineout_won', att: 'lineout_att' },
      { label: 'RUCKS WON', pct: true, made: 'ruck_won', att: 'ruck_att' }, { label: 'MAULS WON', key: 'maul_won' }, { label: 'FREE KICKS CONCEDED', key: 'fk_con' },
    ],
    leaders: [{ label: 'TOP POINTS SCORER', stat: 'points' }, { label: 'MOST TRIES', stat: 'try' }, { label: 'MOST TACKLES', stat: 'tackle' }, { label: 'MOST CARRIES', stat: 'carry' }],
    playerLine: s => [s.try ? `${s.try} TR` : '', s.conv ? `${s.conv} CON` : '', s.pen ? `${s.pen} PEN` : '', s.drop ? `${s.drop} DG` : '', s.points ? `${s.points} PTS` : '', s.tackle ? `${s.tackle} TACKLES` : '', s.carry ? `${s.carry} CARRIES` : ''].filter(Boolean).join(' · '),
    runMin: 10,
  }));
  // yellow card duration follows the variant (sevens: 2 min)
  SPORTS.rugby.cards[0].min = 10;
  const rugbyApply = SPORTS.rugby.apply;
  SPORTS.rugby.apply = (st, ev) => {
    rugbyApply(st, ev.type === 'card' && ev.key === 'yellow' && ev.minutes == null ? Object.assign({}, ev, { minutes: st.o.sinbinMin }) : ev);
    if (ev.type === 'card' && (ev.key === 'red' || ev.key === 'red20')) st.stats[ev.team].red_all = (st.stats[ev.team].red_all || 0) + 1;
  };

  // ----------------------------------------------------------------- hockey (field)
  register(timedSport({
    id: 'hockey', name: 'Hockey (field)',
    defaultVariant: 'quarters',
    variants: {
      quarters: { label: '4 × 15 min', options: { periods: 4, periodMin: 15 } },
      halves: { label: '2 × 35 min', options: { periods: 2, periodMin: 35 } },
    },
    options: { clockDir: 'down', otMin: 0 },
    actions: [
      { key: 'goal', label: 'Field goal', pts: 1, player: true, wipe: 'GOAL', btn: 'big', stat: 'goals' },
      { key: 'pc_goal', label: 'PC goal', pts: 1, player: true, wipe: 'GOAL', stat: 'goals', attempt: 'pc_goal_n' },
      { key: 'ps_goal', label: 'Penalty stroke goal', pts: 1, player: true, wipe: 'GOAL', stat: 'goals' },
      { key: 'pc', label: 'Penalty corner', type: 'stat', player: false, timeline: true },
      { key: 'shot', label: 'Shot on goal', type: 'stat', player: true },
      { key: 'circle', label: 'Circle entry', type: 'stat', player: false },
      { key: 'ps', label: 'Penalty stroke awarded', type: 'stat', player: false, timeline: true },
      // match statistics (FIH match-report categories)
      { key: 'shot_off', label: 'Shot wide', abbr: 'SW', cat: 'Attack', type: 'stat', group: 'stats', player: true },
      { key: 'entry23', label: '23m entry', cat: 'Attack', type: 'stat', group: 'stats', player: false },
      { key: 'long_corner', label: 'Long corner', cat: 'Attack', type: 'stat', group: 'stats', player: false },
      { key: 'aerial', label: 'Aerial', abbr: 'AER', cat: 'Attack', type: 'stat', group: 'stats', player: true },
      { key: 'save', label: 'Save', abbr: 'SV', cat: 'Defence', type: 'stat', group: 'stats', player: true },
      { key: 'intercept', label: 'Interception', abbr: 'INT', cat: 'Defence', type: 'stat', group: 'stats', player: true },
      { key: 'tackle', label: 'Tackle won', abbr: 'TKL', cat: 'Defence', type: 'stat', group: 'stats', player: true },
      { key: 'turnover', label: 'Turnover conceded', abbr: 'TO', cat: 'Defence', type: 'stat', group: 'stats', player: true },
      { key: 'foul_c', label: 'Foul / free hit conceded', abbr: 'FL', cat: 'Discipline', type: 'stat', group: 'stats', player: true },
      { key: 'ref_ok', label: 'Video referral upheld', cat: 'Discipline', type: 'stat', group: 'stats', player: false, attempt: 'ref_att', timeline: true },
      { key: 'ref_lost', label: 'Video referral lost', cat: 'Discipline', type: 'stat', group: 'stats', player: false, also: 'ref_att', timeline: true },
    ],
    shares: [{ key: 'poss', label: 'Possession' }],
    // FIH: green = 2 minutes, yellow = a minimum of 5 minutes (10 for physical offences), red = permanent. The team plays short.
    cards: [{ key: 'green', label: 'Green card (2 min)', min: 2 }, { key: 'yellow', label: 'Yellow card (5 min)', min: 5 }, { key: 'yellow10', label: 'Yellow card (10 min)', min: 10, color: '#f4c20d' }, { key: 'red', label: 'Red card', permanent: true }],
    shootout: true,
    periodName: (p, o) => (p > o.periods ? 'SHOOT-OUT' : o.periods === 2 ? (p === 1 ? 'FIRST HALF' : 'SECOND HALF') : `Q${p}`),
    periodShort: (p, o) => (p > o.periods ? 'SO' : o.periods === 2 ? p + 'H' : 'Q' + p),
    tableTitle: 'SCORE BY PERIOD',
    teamStats: [
      { label: 'GOALS', key: 'goals' }, { label: 'SHOTS ON GOAL', key: 'shot' }, { label: 'PENALTY CORNERS', key: 'pc' },
      { label: 'CIRCLE ENTRIES', key: 'circle' }, { label: 'POSSESSION', share: 'poss' }, { label: 'SAVES', key: 'save' },
      { label: 'GREEN CARDS', key: 'green_cards' }, { label: 'YELLOW CARDS', key: 'yellow_all' }, { label: 'RED CARDS', key: 'red_cards' },
      { label: 'PC CONVERSION', pct: true, made: 'pc_goal_n', att: 'pc' }, { label: 'PENALTY STROKES', key: 'ps' }, { label: 'SHOTS WIDE', key: 'shot_off' },
      { label: '23M ENTRIES', key: 'entry23' }, { label: 'LONG CORNERS', key: 'long_corner' }, { label: 'AERIALS', key: 'aerial' },
      { label: 'INTERCEPTIONS', key: 'intercept' }, { label: 'TACKLES WON', key: 'tackle' }, { label: 'TURNOVERS CONCEDED', key: 'turnover' },
      { label: 'FOULS CONCEDED', key: 'foul_c' }, { label: 'VIDEO REFERRALS', pct: true, made: 'ref_ok', att: 'ref_att' },
    ],
    leaders: [{ label: 'TOP SCORER', stat: 'goals' }, { label: 'MOST SAVES', stat: 'save' }],
    playerLine: s => [s.goals ? `${s.goals} GOAL${s.goals > 1 ? 'S' : ''}` : '', s.shot ? `${s.shot} SHOTS` : '', s.save ? `${s.save} SAVES` : '', s.intercept ? `${s.intercept} INT` : ''].filter(Boolean).join(' · '),
    soWipe: 'GOAL', runMin: 3,
  }));

  const hockeyApply = SPORTS.hockey.apply;
  SPORTS.hockey.apply = (st, ev) => {
    hockeyApply(st, ev);
    if (ev.type === 'card' && (ev.key === 'yellow' || ev.key === 'yellow10')) st.stats[ev.team].yellow_all = (st.stats[ev.team].yellow_all || 0) + 1;
  };

  // ----------------------------------------------------------------- football (IFAB Laws of the Game)
  register(timedSport({
    id: 'football', name: 'Football',
    defaultVariant: 'standard',
    variants: {
      standard: { label: 'IFAB (2 × 45, extra time 2 × 15)', options: { periods: 2, periodMin: 45, otMin: 15 } },
      youth: { label: 'Youth (2 × 35)', options: { periods: 2, periodMin: 35, otMin: 10 } },
      futsal: { label: 'Futsal (2 × 20, clock stops)', options: { periods: 2, periodMin: 20, otMin: 5, clockDir: 'down', continuous: false } },
    },
    options: { clockDir: 'up', continuous: true },
    actions: [
      { key: 'goal', label: 'Goal', pts: 1, player: true, wipe: 'GOAL', btn: 'big', stat: 'goals', attempt: 'sot' },
      { key: 'pen_goal', label: 'Penalty goal', pts: 1, player: true, wipe: 'GOAL', stat: 'goals', attempt: 'sot' },
      { key: 'own_goal', label: 'Own goal (for this team)', pts: 1, player: false, wipe: 'GOAL', stat: 'own_goals' },
      { key: 'shot_on', label: 'Shot on target', type: 'stat', stat: 'sot', player: true },
      { key: 'shot_off', label: 'Shot off target', type: 'stat', player: true },
      { key: 'corner', label: 'Corner', type: 'stat', player: false },
      { key: 'offside', label: 'Offside', type: 'stat', player: false },
      { key: 'foul_c', label: 'Foul', type: 'stat', player: true },
      { key: 'pen_miss', label: 'Penalty missed', type: 'stat', player: true, timeline: true },
      { key: 'shot_blk', label: 'Shot blocked', abbr: 'BLK', cat: 'Attack', type: 'stat', group: 'stats', player: true },
      { key: 'cross', label: 'Cross', abbr: 'CRS', cat: 'Attack', type: 'stat', group: 'stats', player: true },
      { key: 'assist', label: 'Assist', abbr: 'AST', cat: 'Attack', type: 'stat', group: 'stats', player: true },
      { key: 'save', label: 'Save', abbr: 'SV', cat: 'Defence', type: 'stat', group: 'stats', player: true },
      { key: 'tackle', label: 'Tackle won', abbr: 'TKL', cat: 'Defence', type: 'stat', group: 'stats', player: true },
      { key: 'intercept', label: 'Interception', abbr: 'INT', cat: 'Defence', type: 'stat', group: 'stats', player: true },
      { key: 'clearance', label: 'Clearance', abbr: 'CLR', cat: 'Defence', type: 'stat', group: 'stats', player: true },
      { key: 'free_kick', label: 'Free kick won', cat: 'Set piece', type: 'stat', group: 'stats', player: false },
      { key: 'goal_kick', label: 'Goal kick', cat: 'Set piece', type: 'stat', group: 'stats', player: false },
      { key: 'throw_in', label: 'Throw-in', cat: 'Set piece', type: 'stat', group: 'stats', player: false },
    ],
    shares: [{ key: 'poss', label: 'Possession' }],
    // No sin bins in the professional game: a second yellow is a red.
    cards: [{ key: 'yellow', label: 'Yellow card', min: 0 }, { key: 'red', label: 'Red card', permanent: true }],
    shootout: true,
    periodName: (p, o) => (p === 1 ? 'FIRST HALF' : p === 2 ? 'SECOND HALF' : p === 3 ? 'EXTRA TIME 1' : p === 4 ? 'EXTRA TIME 2' : 'PENALTIES'),
    periodShort: p => (p === 1 ? '1H' : p === 2 ? '2H' : p <= 4 ? 'ET' + (p - 2) : 'PEN'),
    tableTitle: 'SCORE BY HALF',
    teamStats: [
      { label: 'GOALS', key: 'goals_all' }, { label: 'SHOTS ON TARGET', key: 'sot' }, { label: 'SHOTS OFF TARGET', key: 'shot_off' }, { label: 'CORNERS', key: 'corner' },
      { label: 'OFFSIDES', key: 'offside' }, { label: 'FOULS', key: 'foul_c' }, { label: 'POSSESSION', share: 'poss' }, { label: 'YELLOW CARDS', key: 'yellow_cards' }, { label: 'RED CARDS', key: 'red_cards' },
      { label: 'TOTAL SHOTS', sum: ['sot', 'shot_off', 'shot_blk'] }, { label: 'SHOTS BLOCKED', key: 'shot_blk' }, { label: 'ASSISTS', key: 'assist' }, { label: 'SAVES', key: 'save' }, { label: 'CROSSES', key: 'cross' },
      { label: 'TACKLES WON', key: 'tackle' }, { label: 'INTERCEPTIONS', key: 'intercept' }, { label: 'CLEARANCES', key: 'clearance' },
      { label: 'FREE KICKS WON', key: 'free_kick' }, { label: 'GOAL KICKS', key: 'goal_kick' }, { label: 'THROW-INS', key: 'throw_in' },
    ],
    leaders: [{ label: 'TOP SCORER', stat: 'goals' }, { label: 'MOST ASSISTS', stat: 'assist' }, { label: 'MOST SAVES', stat: 'save' }],
    playerLine: s => [s.goals ? `${s.goals} GOAL${s.goals > 1 ? 'S' : ''}` : '', s.assist ? `${s.assist} AST` : '', s.save ? `${s.save} SAVES` : '', s.yellow_cards ? 'YELLOW CARD' : '', s.red_cards ? 'RED CARD' : ''].filter(Boolean).join(' · '),
    soWipe: 'GOAL', runMin: 3,
  }));
  const footApply = SPORTS.football.apply;
  SPORTS.football.apply = (st, ev) => {
    // Two yellow cards for the same player = sent off.
    if (ev.type === 'card' && ev.key === 'yellow' && ev.player && ((st.pstats[ev.player] || {}).yellow_cards || 0) >= 1) {
      footApply(st, ev);
      footApply(st, Object.assign({}, ev, { key: 'red', id: ev.id + 'r' }));
    } else footApply(st, ev);
    ['A', 'B'].forEach(k => { st.stats[k].goals_all = (st.stats[k].goals || 0) + (st.stats[k].own_goals || 0); });
  };

  // ----------------------------------------------------------------- netball
  register(timedSport({
    id: 'netball', name: 'Netball',
    defaultVariant: 'standard',
    variants: {
      standard: { label: 'Standard (4 × 15)', options: { periods: 4, periodMin: 15, superShot: false } },
      super: { label: 'Super shot (4 × 15, 2-pt zone)', options: { periods: 4, periodMin: 15, superShot: true } },
      fast5: { label: 'Fast5 (4 × 6)', options: { periods: 4, periodMin: 6, superShot: true } },
    },
    options: { clockDir: 'down', otMin: 7, centreFirst: 'A' },
    actions: o => [
      { key: 'goal', label: 'Goal', pts: 1, player: true, attempt: 'att', btn: 'big', stat: 'goals' },
      ...(o.superShot ? [{ key: 'super', label: 'Super shot', pts: 2, player: true, attempt: 'att', wipe: 'SUPER SHOT', stat: 'supers' }] : []),
      { key: 'miss', label: 'Missed shot', type: 'miss', stat: 'att', player: true },
      { key: 'gain', label: 'Gain / intercept', type: 'stat', player: true },
      { key: 'penalty', label: 'Penalty', type: 'stat', player: true },
      { key: 'turnover', label: 'Turnover', type: 'stat', player: false },
      // match statistics (World Netball / broadcast categories)
      { key: 'cpr', label: 'Centre pass receive', abbr: 'CPR', cat: 'Attack', type: 'stat', group: 'stats', player: true },
      { key: 'feed', label: 'Feed', abbr: 'FD', cat: 'Attack', type: 'stat', group: 'stats', player: true },
      { key: 'goal_assist', label: 'Goal assist', abbr: 'GA', cat: 'Attack', type: 'stat', group: 'stats', player: true, also: 'feed' },
      { key: 'off_reb', label: 'Offensive rebound', abbr: 'OR', cat: 'Attack', type: 'stat', group: 'stats', player: true, also: 'rebound' },
      { key: 'intercept', label: 'Intercept', abbr: 'INT', cat: 'Defence', type: 'stat', group: 'stats', player: true, also: 'gain' },
      { key: 'deflection', label: 'Deflection', abbr: 'DEF', cat: 'Defence', type: 'stat', group: 'stats', player: true },
      { key: 'def_reb', label: 'Defensive rebound', abbr: 'DR', cat: 'Defence', type: 'stat', group: 'stats', player: true, also: 'rebound' },
      { key: 'pickup', label: 'Pick-up', abbr: 'PU', cat: 'Defence', type: 'stat', group: 'stats', player: true },
      { key: 'contact', label: 'Contact penalty', abbr: 'CON', cat: 'Discipline', type: 'stat', group: 'stats', player: true, also: 'penalty' },
      { key: 'obstruction', label: 'Obstruction penalty', abbr: 'OBS', cat: 'Discipline', type: 'stat', group: 'stats', player: true, also: 'penalty' },
      { key: 'bad_pass', label: 'Bad pass', abbr: 'BP', cat: 'Errors', type: 'stat', group: 'stats', player: true, also: 'turnover' },
      { key: 'bad_hands', label: 'Bad hands', abbr: 'BH', cat: 'Errors', type: 'stat', group: 'stats', player: true, also: 'turnover' },
      { key: 'stepping', label: 'Stepping', cat: 'Errors', type: 'stat', group: 'stats', player: true, also: 'turnover' },
      { key: 'held_ball', label: 'Held ball', cat: 'Errors', type: 'stat', group: 'stats', player: true, also: 'turnover' },
      { key: 'offside', label: 'Offside', cat: 'Errors', type: 'stat', group: 'stats', player: true, also: 'turnover' },
    ],
    // World Netball (2024): official warning, then a two-minute suspension, then ordering off.
    cards: [{ key: 'warning', label: 'Warning', min: 0, color: '#f4c20d' }, { key: 'yellow', label: 'Suspension (2 min)', min: 2 }, { key: 'red', label: 'Ordered off', permanent: true }],
    periodName: (p, o) => (p > o.periods ? 'EXTRA TIME' : `Q${p}`),
    periodShort: (p, o) => (p > o.periods ? 'ET' : 'Q' + p),
    tableTitle: 'SCORE BY QUARTER',
    centrePass: true,
    teamStats: [
      { label: 'SHOOTING', pct: true, made: 'shots_made', att: 'att' }, { label: 'SUPER SHOTS', key: 'supers' },
      { label: 'GAINS', key: 'gain' }, { label: 'PENALTIES', key: 'penalty' }, { label: 'TURNOVERS', key: 'turnover' },
      { label: 'WARNINGS', key: 'warning_cards' }, { label: 'SUSPENSIONS', key: 'yellow_cards' },
      { label: 'CENTRE PASS RECEIVES', key: 'cpr' }, { label: 'FEEDS', key: 'feed' }, { label: 'GOAL ASSISTS', key: 'goal_assist' },
      { label: 'INTERCEPTS', key: 'intercept' }, { label: 'DEFLECTIONS', key: 'deflection' }, { label: 'REBOUNDS', key: 'rebound' }, { label: 'PICK-UPS', key: 'pickup' },
      { label: 'CONTACT PENALTIES', key: 'contact' }, { label: 'OBSTRUCTION PENALTIES', key: 'obstruction' },
      { label: 'BAD PASSES', key: 'bad_pass' }, { label: 'BAD HANDS', key: 'bad_hands' },
    ],
    leaders: [{ label: 'TOP SHOOTER', stat: 'points' }, { label: 'MOST GAINS', stat: 'gain' }, { label: 'MOST GOAL ASSISTS', stat: 'goal_assist' }, { label: 'MOST INTERCEPTS', stat: 'intercept' }],
    playerLine: s => [s.att ? `${(s.goals || 0) + (s.supers || 0)}/${s.att} (${Math.round(((s.goals || 0) + (s.supers || 0)) * 100 / s.att)}%)` : '', s.gain ? `${s.gain} GAINS` : '', s.goal_assist ? `${s.goal_assist} GOAL ASSISTS` : '', s.feed ? `${s.feed} FEEDS` : '', s.intercept ? `${s.intercept} INT` : ''].filter(Boolean).join(' · '),
    runMin: 4,
  }));
  // shots made = goals + supers (for shooting %)
  const netView = SPORTS.netball.view;
  SPORTS.netball.view = (st, setup) => {
    ['A', 'B'].forEach(k => { st.stats[k].shots_made = (st.stats[k].goals || 0) + (st.stats[k].supers || 0); });
    return netView(st, setup);
  };

  // ----------------------------------------------------------------- basketball
  register(timedSport({
    id: 'basketball', name: 'Basketball',
    defaultVariant: 'fiba',
    variants: {
      fiba: { label: 'FIBA (4 × 10)', options: { periods: 4, periodMin: 10, otMin: 5, foulOut: 5, bonusAt: 5, shotClock: 24, shotReset2: 14 } },
      nba: { label: 'NBA (4 × 12)', options: { periods: 4, periodMin: 12, otMin: 5, foulOut: 6, bonusAt: 5, shotClock: 24, shotReset2: 14 } },
      '3x3': { label: '3x3 (10 min, to 21)', options: { periods: 1, periodMin: 10, otMin: 0, foulOut: 0, bonusAt: 7, shotClock: 12, shotReset2: 0, threeByThree: true } },
    },
    options: { clockDir: 'down', stopAtLimit: true },
    actions: o => [
      { key: 'ft', label: o.threeByThree ? '1 PT' : 'Free throw', pts: 1, player: true, attempt: 'fta', stat: 'ftm' },
      { key: 'two', label: o.threeByThree ? '1 PT' : '2 PT', pts: o.threeByThree ? 1 : 2, player: true, attempt: 'fga', stat: 'fgm', btn: 'big' },
      { key: 'three', label: o.threeByThree ? '2 PT' : '3 PT', pts: o.threeByThree ? 2 : 3, player: true, attempt: 'fga', stat: 'fgm3', wipe: o.threeByThree ? '' : '3 POINTER', btn: 'big' },
      { key: 'ft_miss', label: 'FT missed', type: 'miss', stat: 'fta', player: true },
      { key: 'fg_miss', label: 'FG missed', type: 'miss', stat: 'fga', player: true },
      { key: 'reb', label: 'Def. rebound', type: 'stat', player: true },
      { key: 'oreb', label: 'Off. rebound', type: 'stat', player: true, also: 'reb' },
      { key: 'ast', label: 'Assist', type: 'stat', player: true },
      { key: 'stl', label: 'Steal', type: 'stat', player: true },
      { key: 'blk', label: 'Block', type: 'stat', player: true },
      { key: 'tov', label: 'Turnover', type: 'stat', player: true },
    ],
    fouls: true, timeoutsMax: true,
    cards: [],
    periodName: (p, o) => (o.threeByThree ? (p > 1 ? 'OVERTIME' : 'GAME') : p <= o.periods ? `Q${p}` : `OT${p - o.periods}`),
    periodShort: (p, o) => (o.threeByThree ? (p > 1 ? 'OT' : 'G') : p <= o.periods ? 'Q' + p : 'OT' + (p - o.periods)),
    tableTitle: 'SCORE BY QUARTER',
    teamStats: [
      { label: 'FIELD GOALS', pct: true, made: 'fg_all', att: 'fga' }, { label: '3 POINTERS', key: 'fgm3' },
      { label: 'FREE THROWS', pct: true, made: 'ftm', att: 'fta' }, { label: 'REBOUNDS', key: 'reb' }, { label: 'ASSISTS', key: 'ast' },
      { label: 'STEALS', key: 'stl' }, { label: 'BLOCKS', key: 'blk' }, { label: 'TURNOVERS', key: 'tov' }, { label: 'FOULS', key: 'fouls' },
      { label: 'OFFENSIVE REBOUNDS', key: 'oreb' }, { label: 'DEFENSIVE REBOUNDS', key: 'dreb' },
    ],
    leaders: [{ label: 'POINTS', stat: 'points' }, { label: 'REBOUNDS', stat: 'reb' }, { label: 'ASSISTS', stat: 'ast' }],
    playerLine: s => [`${s.points || 0} PTS`, s.reb ? `${s.reb} REB` : '', s.ast ? `${s.ast} AST` : '', s.stl ? `${s.stl} STL` : '', s.blk ? `${s.blk} BLK` : '', s.fouls ? `${s.fouls} PF` : ''].filter(Boolean).join(' · '),
    runMin: 8,
    extraView(v, st) {
      ['A', 'B'].forEach(k => { st.stats[k].fg_all = (st.stats[k].fgm || 0) + (st.stats[k].fgm3 || 0); });
      ['A', 'B'].forEach(k => { st.stats[k].dreb = Math.max(0, (st.stats[k].reb || 0) - (st.stats[k].oreb || 0)); });
      v.teamStats = SPORTS.basketball.teamStats.map(s => ({ label: s.label, a: statVal(st.stats.A, s), b: statVal(st.stats.B, s) }));
      v.teamStats.push({ label: 'TIMEOUTS', a: String(st.timeouts.A), b: String(st.timeouts.B) });
      if (st.o.threeByThree && !st.finished && (st.score.A >= 21 || st.score.B >= 21)) v.status = `${v.teams[st.score.A >= 21 ? 'A' : 'B'].name.toUpperCase()} REACH 21`;
    },
  }));
  // basketball players: field goal attempts include 3s (fga counted on both)

  // ================================================================== TENNIS / PADEL
  function racketSport(cfg) {
    const def = Object.assign({ kind: 'sets' }, cfg);
    def.init = setup => {
      const o = resolveOptions(def, setup);
      const st = {
        o, setup, sets: [], cur: { A: 0, B: 0 }, pts: { A: 0, B: 0 }, setsWon: { A: 0, B: 0 },
        server: o.firstServer || 'A', inTB: false, tbTarget: 7, tbFirst: null, tbPlayed: 0, superTB: false,
        finished: false, winner: null, timeline: [], last: null,
        stats: { A: newRS(), B: newRS() }, games: 0,
      };
      return st;
    };
    function newRS() { return { points: 0, aces: 0, df: 0, winners: 0, ue: 0, fe: 0, bpWon: 0, bpChances: 0, svcPlayed: 0, svcWon: 0, games: 0, breaks: 0,
      s1In: 0, s1Won: 0, s2Played: 0, s2Won: 0, netPlayed: 0, netWon: 0, run: 0, bestRun: 0 }; }
    const need = st => Math.floor(st.o.bestOf / 2) + 1;
    const decidingSet = st => st.setsWon.A === need(st) - 1 && st.setsWon.B === need(st) - 1;

    function startSet(st) {
      st.cur = { A: 0, B: 0 }; st.pts = { A: 0, B: 0 }; st.inTB = false; st.superTB = false;
      if (decidingSet(st) && st.o.finalSet === 'super') { st.inTB = true; st.superTB = true; st.tbTarget = 10; st.tbFirst = st.server; st.tbPlayed = 0; }
    }
    function winSet(st, w, tb) {
      const rec = { A: st.cur.A, B: st.cur.B };
      if (tb) { rec[w] += st.superTB ? 1 : 1; rec.tbA = st.pts.A; rec.tbB = st.pts.B; rec.super = st.superTB; if (st.superTB) { rec.A = w === 'A' ? 1 : 0; rec.B = w === 'B' ? 1 : 0; } }
      st.sets.push(rec);
      st.setsWon[w]++;
      if (tb) st.server = U.other(st.tbFirst);
      if (st.setsWon[w] >= need(st)) { st.finished = true; st.winner = w; st.inTB = false; return; }
      startSet(st);
    }
    function winGame(st, w) {
      const broke = w !== st.server;
      st.stats[w].games++;
      if (broke) st.stats[w].breaks++;
      st.cur[w]++; st.pts = { A: 0, B: 0 };
      st.server = U.other(st.server);
      st.games++;
      const l = U.other(w), g = st.o.games;
      if (st.cur[w] >= g && st.cur[w] - st.cur[l] >= 2) return winSet(st, w, false);
      const finalAdv = decidingSet(st) && st.o.finalSet === 'advantage';
      if (st.cur.A === st.o.tiebreakAt && st.cur.B === st.o.tiebreakAt && !finalAdv) {
        st.inTB = true; st.tbTarget = decidingSet(st) && st.o.finalSet === 'tb10' ? 10 : 7; st.tbFirst = st.server; st.tbPlayed = 0;
      }
    }
    function point(st, w) {
      const l = U.other(w);
      if (st.inTB) {
        st.pts[w]++; st.tbPlayed++;
        if (st.pts[w] >= st.tbTarget && st.pts[w] - st.pts[l] >= 2) return winSet(st, w, true);
        st.server = Math.floor((st.tbPlayed + 1) / 2) % 2 === 0 ? st.tbFirst : U.other(st.tbFirst);
        return;
      }
      st.pts[w]++;
      const adv = st.o.scoring === 'ad';
      if (adv) { if (st.pts[w] >= 4 && st.pts[w] - st.pts[l] >= 2) winGame(st, w); }
      else if (st.pts[w] >= 4) winGame(st, w);
      else if (st.pts[w] === 4) winGame(st, w);
    }
    // simulate the next point to flag break / set / match point
    function flags(st) {
      if (st.finished) return {};
      const out = {};
      ['A', 'B'].forEach(w => {
        const sim = U.clone(Object.assign({}, st, { setup: null, timeline: [] }));
        const before = { sets: sim.sets.length, games: sim.cur[w] + sim.sets.length * 100 };
        point(sim, w);
        if (sim.finished) out.match = w;
        else if (sim.sets.length > before.sets) out.set = w;
        else if (!st.inTB && sim.cur[w] > st.cur[w] && w !== st.server) out.brk = w;
      });
      return out;
    }

    def.apply = (st, ev) => {
      if (ev.type === 'point') {
        if (st.finished) return;
        const w = ev.team, l = U.other(w), srv = st.server;
        const f = flags(st);
        if (f.brk && !st.inTB) st.stats[f.brk].bpChances++;
        if (f.brk === w) st.stats[w].bpWon++;
        st.stats[srv].svcPlayed++;
        if (srv === w) st.stats[srv].svcWon++;
        // ev.serve: 1 = played on the first serve, 2 = on the second (a double fault is always the second)
        const second = ev.how === 'df' || +ev.serve === 2;
        if (second) { st.stats[srv].s2Played++; if (srv === w) st.stats[srv].s2Won++; }
        else { st.stats[srv].s1In++; if (srv === w) st.stats[srv].s1Won++; }
        // ev.net: the side(s) that came to the net during the point ('A', 'B' or 'AB')
        String(ev.net || '').split('').forEach(k => { if (st.stats[k]) { st.stats[k].netPlayed++; if (k === w) st.stats[k].netWon++; } });
        st.stats[w].run++; st.stats[l].run = 0;
        if (st.stats[w].run > st.stats[w].bestRun) st.stats[w].bestRun = st.stats[w].run;
        st.stats[w].points++;
        if (ev.how === 'ace') st.stats[w].aces++;
        if (ev.how === 'df') st.stats[l].df++;
        if (ev.how === 'winner') st.stats[w].winners++;
        if (ev.how === 'ue') st.stats[l].ue++;
        if (ev.how === 'fe') st.stats[l].fe++;
        const setsBefore = st.sets.length, gamesBefore = st.games;
        point(st, w);
        const name = st.setup ? teamOf(st.setup, w).name.toUpperCase() : w;
        let text = '';
        if (st.finished) text = `GAME, SET AND MATCH ${name}`;
        else if (st.sets.length > setsBefore) text = `SET ${name}`;
        else if (st.games > gamesBefore) text = f.brk === w ? `BREAK OF SERVE – ${name}` : `GAME ${name}`;
        const hows = { ace: 'ACE', df: 'DOUBLE FAULT', winner: 'WINNER', ue: 'UNFORCED ERROR', fe: 'FORCED ERROR' };
        if (text || ev.how === 'ace') {
          st.timeline.push({ id: ev.id, team: w, kind: text ? 'game' : 'point', text: text || `${hows[ev.how]} – ${name}`, icon: text ? 'game' : 'point', ct: '' });
        }
        st.last = { type: 'point', team: w, text: text || (hows[ev.how] ? `${hows[ev.how]}` : `POINT ${name}`), wipe: ev.how === 'ace' ? 'ACE' : (text.startsWith('GAME, SET') ? 'MATCH' : text.startsWith('BREAK') ? 'BREAK' : '') };
      } else if (ev.type === 'server') {
        st.server = ev.team;
      } else if (ev.type === 'override') {
        // manual fix: set the current set's games and points (points as raw counts)
        if (ev.gamesA != null) st.cur.A = +ev.gamesA; if (ev.gamesB != null) st.cur.B = +ev.gamesB;
        if (ev.pointsA != null) st.pts.A = +ev.pointsA; if (ev.pointsB != null) st.pts.B = +ev.pointsB;
        st.inTB = !!ev.tiebreak;
        if (st.inTB) { st.tbFirst = st.tbFirst || st.server; st.tbTarget = st.tbTarget || 7; st.tbPlayed = st.pts.A + st.pts.B; }
        st.timeline.push({ id: ev.id, team: '', kind: 'adjust', text: 'SCORE CORRECTION', icon: 'adjust' });
      } else if (ev.type === 'end') {
        st.finished = true; st.winner = ev.team || null;
        st.timeline.push({ id: ev.id, team: ev.team || '', kind: 'end', text: U.up(ev.text || 'MATCH ENDED'), icon: 'end' });
      } else if (ev.type === 'note') {
        st.timeline.push({ id: ev.id, team: ev.team || '', kind: 'note', text: U.up(ev.text || ''), icon: 'note' });
        st.last = { type: 'note', team: ev.team || '', text: U.up(ev.text || ''), wipe: '' };
      }
    };

    function ptsDisplay(st) {
      if (st.inTB) return { A: String(st.pts.A), B: String(st.pts.B) };
      const a = st.pts.A, b = st.pts.B, map = ['0', '15', '30', '40'];
      if (st.o.scoring === 'ad' && a >= 3 && b >= 3) {
        if (a === b) return { A: '40', B: '40' };
        return a > b ? { A: 'AD', B: '40' } : { A: '40', B: 'AD' };
      }
      return { A: map[Math.min(a, 3)], B: map[Math.min(b, 3)] };
    }

    def.view = (st, setup) => {
      const v = baseView(def, setup), o = st.o;
      const p = ptsDisplay(st);
      v.score = { A: String(st.setsWon.A), B: String(st.setsWon.B) };
      const setNo = st.sets.length + (st.finished ? 0 : 1);
      v.periodLabel = st.finished ? 'MATCH COMPLETE' : st.superTB ? 'MATCH TIE-BREAK' : st.inTB ? `SET ${setNo} · TIE-BREAK` : `SET ${setNo}`;
      v.finished = st.finished; v.winner = st.winner;
      const f = flags(st);
      const golden = !st.inTB && o.scoring !== 'ad' && st.pts.A === 3 && st.pts.B === 3;
      const flag = f.match ? 'MATCH POINT' : f.set ? 'SET POINT' : golden ? (def.goldenName || 'DECIDING POINT') : f.brk ? 'BREAK POINT' : (st.o.scoring === 'ad' && st.pts.A >= 3 && st.pts.A === st.pts.B && !st.inTB ? 'DEUCE' : '');
      const flagTeam = f.match || f.set || (golden ? '' : f.brk) || '';
      v.extra = { points: p, games: { A: st.cur.A, B: st.cur.B }, sets: st.sets, server: st.server, tiebreak: st.inTB, superTB: st.superTB, flag, flagTeam };
      const cols = Math.max(st.sets.length + (st.finished ? 0 : 1), 1);
      v.table.title = 'SETS';
      v.table.cols = Array.from({ length: cols }, (_, i) => `SET ${i + 1}`);
      const cell = (i, k) => {
        if (i < st.sets.length) { const s = st.sets[i]; const tb = s['tb' + k]; const lost = s[k] < s[U.other(k)]; return `${s[k]}${s.tbA != null && lost && !s.super ? `(${tb})` : s.super ? `(${tb})` : ''}`; }
        return String(st.cur[k]);
      };
      v.table.A = v.table.cols.map((_, i) => cell(i, 'A'));
      v.table.B = v.table.cols.map((_, i) => cell(i, 'B'));
      v.table.total = [String(st.setsWon.A), String(st.setsWon.B)];
      const S = st.stats;
      const pc = (a, b) => (b ? `${Math.round(a * 100 / b)}%` : '–');
      v.teamStats = [
        { label: 'ACES', a: String(S.A.aces), b: String(S.B.aces) },
        { label: 'DOUBLE FAULTS', a: String(S.A.df), b: String(S.B.df) },
        { label: 'WINNERS', a: String(S.A.winners), b: String(S.B.winners) },
        { label: 'UNFORCED ERRORS', a: String(S.A.ue), b: String(S.B.ue) },
        { label: 'BREAK POINTS WON', a: `${S.A.bpWon}/${S.A.bpChances}`, b: `${S.B.bpWon}/${S.B.bpChances}` },
        { label: 'SERVICE POINTS WON', a: pc(S.A.svcWon, S.A.svcPlayed), b: pc(S.B.svcWon, S.B.svcPlayed) },
        { label: 'TOTAL POINTS WON', a: String(S.A.points), b: String(S.B.points) },
        { label: '1ST SERVE IN', a: pc(S.A.s1In, S.A.svcPlayed), b: pc(S.B.s1In, S.B.svcPlayed) },
        { label: '1ST SERVE POINTS WON', a: pc(S.A.s1Won, S.A.s1In), b: pc(S.B.s1Won, S.B.s1In) },
        { label: '2ND SERVE POINTS WON', a: pc(S.A.s2Won, S.A.s2Played), b: pc(S.B.s2Won, S.B.s2Played) },
        { label: 'RECEIVING POINTS WON', a: pc(S.B.svcPlayed - S.B.svcWon, S.B.svcPlayed), b: pc(S.A.svcPlayed - S.A.svcWon, S.A.svcPlayed) },
        { label: 'BREAK POINTS SAVED', a: `${S.B.bpChances - S.B.bpWon}/${S.B.bpChances}`, b: `${S.A.bpChances - S.A.bpWon}/${S.A.bpChances}` },
        { label: 'NET POINTS WON', a: `${S.A.netWon}/${S.A.netPlayed}`, b: `${S.B.netWon}/${S.B.netPlayed}` },
        { label: 'FORCED ERRORS', a: String(S.A.fe), b: String(S.B.fe) },
        { label: 'GAMES WON', a: String(S.A.games), b: String(S.B.games) },
        { label: 'SERVICE BREAKS', a: String(S.A.breaks), b: String(S.B.breaks) },
        { label: 'MOST POINTS IN A ROW', a: String(S.A.bestRun), b: String(S.B.bestRun) },
      ];
      v.timeline = st.timeline; v.lastEvent = st.last;
      ['A', 'B'].forEach(k => v.teams[k].players.forEach(pl => v.players.push({ id: pl.id, team: k, name: pl.name, tvName: pl.tvName || U.up(pl.name), number: pl.number || '', position: pl.position || '', stats: {}, statsText: pl.country || '' })));
      const lead = st.setsWon.A === st.setsWon.B ? '' : v.teams[st.setsWon.A > st.setsWon.B ? 'A' : 'B'].name.toUpperCase() + ' LEAD';
      v.status = st.finished ? `${v.teams[st.winner] ? v.teams[st.winner].name.toUpperCase() : ''} WIN ${st.sets.map(s => `${s[st.winner]}-${s[U.other(st.winner)]}`).join(' ')}`.trim()
        : flag ? `${flag}${flagTeam ? ' – ' + v.teams[flagTeam].name.toUpperCase() : ''}` : lead ? `${lead} ${st.setsWon.A}-${st.setsWon.B} IN SETS` : `${v.teams[st.server].name.toUpperCase()} TO SERVE`;
      v.facts = [
        { cat: 'SCORE', big: v.table.A.map((a, i) => `${a}-${v.table.B[i]}`).join('  '), txt: `${v.periodLabel} · ${v.teams[st.server].name.toUpperCase()} SERVING` },
        ...v.teamStats.filter(s => s.a !== '0' || s.b !== '0').map(s => ({ cat: s.label, big: `${s.a} – ${s.b}`, txt: `${v.teams.A.short} v ${v.teams.B.short}` })),
      ];
      if (flag) v.facts.unshift({ cat: flag, big: `${p.A}–${p.B}`, txt: flagTeam ? v.teams[flagTeam].name.toUpperCase() : '' });
      return v;
    };
    return def;
  }

  register(racketSport({
    id: 'tennis', name: 'Tennis',
    defaultVariant: 'itf3',
    variants: {
      itf3: { label: 'ITF standard: best of 3, tie-break (7) at 6-6 in every set', options: { bestOf: 3, finalSet: 'tiebreak' } },
      itf5: { label: 'ITF standard: best of 5, tie-break (7) at 6-6 in every set', options: { bestOf: 5, finalSet: 'tiebreak' } },
      bo3: { label: 'Grand Slam: best of 3, 10-point tie-break in the final set', options: { bestOf: 3, finalSet: 'tb10' } },
      bo5: { label: 'Grand Slam: best of 5, 10-point tie-break in the final set', options: { bestOf: 5, finalSet: 'tb10' } },
      bo3super: { label: 'Best of 3, match tie-break (10) instead of a 3rd set', options: { bestOf: 3, finalSet: 'super' } },
      noad: { label: 'Tour doubles: no-ad, match tie-break (10) instead of a 3rd set', options: { bestOf: 3, finalSet: 'super', scoring: 'noad' } },
      adv: { label: 'Best of 3, advantage final set (no tie-break)', options: { bestOf: 3, finalSet: 'advantage' } },
      short: { label: 'Short sets: first to 4 games, tie-break at 4-4, no-ad', options: { bestOf: 3, games: 4, tiebreakAt: 4, scoring: 'noad', finalSet: 'super' } },
    },
    options: { games: 6, tiebreakAt: 6, scoring: 'ad', firstServer: 'A' },
  }));
  register(racketSport({
    id: 'padel', name: 'Padel', goldenName: 'GOLDEN POINT',
    defaultVariant: 'golden',
    variants: {
      golden: { label: 'Best of 3, golden point', options: { bestOf: 3, scoring: 'golden', finalSet: 'tiebreak' } },
      adv: { label: 'Best of 3, advantage', options: { bestOf: 3, scoring: 'ad', finalSet: 'tiebreak' } },
      super: { label: 'Best of 3, golden point, super tie-break 3rd', options: { bestOf: 3, scoring: 'golden', finalSet: 'super' } },
    },
    options: { games: 6, tiebreakAt: 6, firstServer: 'A' },
  }));

  // ================================================================== RALLY SCORING (badminton, volleyball)
  function rallySport(cfg) {
    const def = Object.assign({ kind: 'sets' }, cfg);
    def.init = setup => {
      const o = resolveOptions(def, setup);
      return { o, setup, sets: [], cur: { A: 0, B: 0 }, setsWon: { A: 0, B: 0 }, server: o.firstServer || 'A', finished: false, winner: null,
        timeline: [], last: null, stats: { A: {}, B: {} }, timeouts: [{ A: 0, B: 0 }], streak: { team: null, n: 0 }, best: { A: 0, B: 0 } };
    };
    const need = st => Math.floor(st.o.bestOf / 2) + 1;
    const target = st => (st.setsWon.A + st.setsWon.B === st.o.bestOf - 1 ? st.o.deciding : st.o.points);
    function setOver(st, w) {
      const l = U.other(w), t = target(st), a = st.cur[w], b = st.cur[l];
      if (st.o.cap && a >= st.o.cap) return true;
      return a >= t && a - b >= 2;
    }
    function flags(st) {
      const out = {};
      if (st.finished) return out;
      ['A', 'B'].forEach(w => {
        const cur = Object.assign({}, st.cur); cur[w]++;
        const sim = { o: st.o, cur, setsWon: st.setsWon };
        if (setOver(sim, w)) { if (st.setsWon[w] + 1 >= need(st)) out.match = w; else out.set = w; }
      });
      return out;
    }
    def.apply = (st, ev) => {
      const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
      if (ev.type === 'point') {
        if (st.finished) return;
        const w = ev.team, l = U.other(w);
        st.cur[w]++; inc(st.stats[w], 'points');
        // a point won on the other side's mistake is charged to that side: 'error' or one of def.oppHows (service fault, attack error …)
        const opp = (def.oppHows || {})[ev.how];
        if (opp) { inc(st.stats[l], opp); inc(st.stats[l], 'errors'); }
        else if (ev.how) inc(st.stats[ev.how === 'error' ? l : w], ev.how === 'error' ? 'errors' : ev.how);
        if (ev.how === 'ace' || ev.how === 'service') inc(st.stats[w], 'aces');
        if (st.server !== w) inc(st.stats[w], 'sideouts'); else inc(st.stats[w], 'serve_pts');
        st.server = w;
        st.streak = st.streak.team === w ? { team: w, n: st.streak.n + 1 } : { team: w, n: 1 };
        if (st.streak.n > st.best[w]) st.best[w] = st.streak.n;
        const name = teamOf(st.setup, w).name.toUpperCase();
        let text = '';
        if (setOver(st, w)) {
          st.sets.push({ A: st.cur.A, B: st.cur.B });
          st.setsWon[w]++;
          if (st.setsWon[w] >= need(st)) { st.finished = true; st.winner = w; text = `MATCH ${name}`; }
          else { text = `${def.setWord} ${st.sets.length} TO ${name}`; st.cur = { A: 0, B: 0 }; st.timeouts.push({ A: 0, B: 0 }); }
          st.timeline.push({ id: ev.id, team: w, kind: 'game', text, icon: 'game' });
        } else if (ev.how === 'ace' || ev.how === 'block') {
          st.timeline.push({ id: ev.id, team: w, kind: 'point', text: `${U.up(ev.how)} – ${name}`, icon: 'point' });
        }
        st.last = { type: 'point', team: w, text: text || (ev.how ? U.up(ev.how) : `POINT ${name}`), wipe: text && st.finished ? 'MATCH' : ev.how === 'ace' ? 'ACE' : ev.how === 'block' ? 'BLOCK' : '' };
      } else if (ev.type === 'timeout') {
        st.timeouts[st.timeouts.length - 1][ev.team]++;
        st.timeline.push({ id: ev.id, team: ev.team, kind: 'timeout', text: 'TIMEOUT', icon: 'timeout' });
        st.last = { type: 'timeout', team: ev.team, text: 'TIMEOUT', wipe: '' };
      } else if (ev.type === 'server') {
        st.server = ev.team;
      } else if (ev.type === 'override') {
        if (ev.pointsA != null) st.cur.A = +ev.pointsA; if (ev.pointsB != null) st.cur.B = +ev.pointsB;
        st.timeline.push({ id: ev.id, team: '', kind: 'adjust', text: 'SCORE CORRECTION', icon: 'adjust' });
      } else if (ev.type === 'card') {
        const p = findPlayer(st.setup, ev.player);
        const text = `${U.up(ev.key || 'yellow')} CARD${p ? ' – ' + pnum(p) + pname(p) : ''}`;
        st.timeline.push({ id: ev.id, team: ev.team, kind: 'card', text, icon: ev.key || 'yellow' });
        st.last = { type: 'card', key: ev.key || 'yellow', team: ev.team, player: ev.player || '', text, wipe: '' };
      } else if (ev.type === 'end') {
        st.finished = true; st.winner = ev.team || null;
        st.timeline.push({ id: ev.id, team: ev.team || '', kind: 'end', text: U.up(ev.text || 'MATCH ENDED'), icon: 'end' });
      } else if (ev.type === 'note') {
        st.timeline.push({ id: ev.id, team: ev.team || '', kind: 'note', text: U.up(ev.text || ''), icon: 'note' });
        st.last = { type: 'note', team: ev.team || '', text: U.up(ev.text || ''), wipe: '' };
      }
    };
    def.view = (st, setup) => {
      const v = baseView(def, setup), o = st.o;
      v.score = { A: String(st.setsWon.A), B: String(st.setsWon.B) };
      const setNo = st.sets.length + (st.finished ? 0 : 1);
      v.periodLabel = st.finished ? 'MATCH COMPLETE' : `${def.setWord} ${setNo}`;
      v.finished = st.finished; v.winner = st.winner;
      const f = flags(st);
      const flag = f.match ? 'MATCH POINT' : f.set ? `${def.setWord} POINT` : '';
      const flagTeam = f.match || f.set || '';
      const t = target(st);
      const switchAt = def.switchAt ? def.switchAt(st, t) : null;
      v.extra = { points: { A: String(st.cur.A), B: String(st.cur.B) }, games: null, sets: st.sets, server: st.server, flag, flagTeam, target: t,
        timeouts: st.timeouts[st.timeouts.length - 1], note: switchAt };
      const cols = Math.max(st.sets.length + (st.finished ? 0 : 1), 1);
      v.table.title = def.setWord + 'S';
      v.table.cols = Array.from({ length: cols }, (_, i) => `${def.setShort}${i + 1}`);
      v.table.A = v.table.cols.map((_, i) => String(i < st.sets.length ? st.sets[i].A : st.cur.A));
      v.table.B = v.table.cols.map((_, i) => String(i < st.sets.length ? st.sets[i].B : st.cur.B));
      v.table.total = [String(st.setsWon.A), String(st.setsWon.B)];
      const S = st.stats, g = (k, key) => String(S[k][key] || 0);
      v.teamStats = def.statKeys.map(([label, key]) => ({ label, a: g('A', key), b: g('B', key) }));
      v.teamStats.push({ label: 'LONGEST RUN', a: String(st.best.A), b: String(st.best.B) });
      v.timeline = st.timeline; v.lastEvent = st.last;
      ['A', 'B'].forEach(k => v.teams[k].players.forEach(pl => v.players.push({ id: pl.id, team: k, name: pl.name, tvName: pl.tvName || U.up(pl.name), number: pl.number || '', position: pl.position || '', stats: {}, statsText: pl.country || pl.position || '' })));
      v.status = st.finished ? `${v.teams[st.winner] ? v.teams[st.winner].name.toUpperCase() : ''} WIN ${st.sets.map(s => `${s[st.winner]}-${s[U.other(st.winner)]}`).join(', ')}`.trim()
        : flag ? `${flag} – ${v.teams[flagTeam].name.toUpperCase()}` : switchAt || `${v.teams[st.server].name.toUpperCase()} TO SERVE`;
      v.facts = [{ cat: 'SCORE', big: `${st.cur.A} – ${st.cur.B}`, txt: `${v.periodLabel} · ${def.setWord}S ${st.setsWon.A}-${st.setsWon.B}` }];
      if (flag) v.facts.unshift({ cat: flag, big: `${st.cur.A}–${st.cur.B}`, txt: v.teams[flagTeam].name.toUpperCase() });
      if (st.streak.n >= 4) v.facts.push({ cat: 'ON A RUN', big: String(st.streak.n), txt: `straight points for ${v.teams[st.streak.team].name.toUpperCase()}` });
      v.teamStats.forEach(s => { if (s.a !== '0' || s.b !== '0') v.facts.push({ cat: s.label, big: `${s.a} – ${s.b}`, txt: `${v.teams.A.short} v ${v.teams.B.short}` }); });
      return v;
    };
    return def;
  }

  register(rallySport({
    id: 'badminton', name: 'Badminton', setWord: 'GAME', setShort: 'G',
    defaultVariant: 'bwf',
    variants: {
      bwf: { label: 'BWF: best of 3 × 21 (cap 30)', options: { bestOf: 3, points: 21, deciding: 21, cap: 30 } },
      bo5x11: { label: 'Best of 5 × 11 (cap 15)', options: { bestOf: 5, points: 11, deciding: 11, cap: 15 } },
    },
    options: { firstServer: 'A' },
    statKeys: [['POINTS WON', 'points'], ['SMASH WINNERS', 'smash'], ['NET WINNERS', 'net'], ['DROP WINNERS', 'drop'], ['OTHER WINNERS', 'winner'], ['SERVICE WINNERS', 'aces'],
      ['ERRORS', 'errors'], ['SERVICE FAULTS', 'svc_errors'], ['POINTS WON ON SERVE', 'serve_pts'], ['POINTS WON RECEIVING', 'sideouts']],
    hows: [['smash', 'Smash'], ['net', 'Net kill'], ['drop', 'Drop'], ['winner', 'Winner'], ['service', 'Service winner'], ['error', 'Opp. error'], ['svc_err', 'Opp. service fault']],
    oppHows: { svc_err: 'svc_errors' },
    switchAt: (st, t) => {
      const mid = Math.ceil(t / 2);
      const decider = st.setsWon.A + st.setsWon.B === st.o.bestOf - 1;
      if ((st.cur.A === mid || st.cur.B === mid) && Math.max(st.cur.A, st.cur.B) === mid && Math.min(st.cur.A, st.cur.B) < mid) return decider ? 'INTERVAL – CHANGE ENDS' : 'INTERVAL';
      return null;
    },
  }));
  register(rallySport({
    id: 'volleyball', name: 'Volleyball', setWord: 'SET', setShort: 'S',
    defaultVariant: 'indoor',
    variants: {
      indoor: { label: 'Indoor: best of 5 × 25 (5th to 15)', options: { bestOf: 5, points: 25, deciding: 15, cap: 0 } },
      beach: { label: 'Beach: best of 3 × 21 (3rd to 15)', options: { bestOf: 3, points: 21, deciding: 15, cap: 0 } },
    },
    options: { firstServer: 'A', timeoutsPerSet: 2 },
    statKeys: [['POINTS WON', 'points'], ['ATTACK POINTS', 'attack'], ['BLOCK POINTS', 'block'], ['ACES', 'aces'], ['ERRORS', 'errors'],
      ['SERVICE ERRORS', 'svc_errors'], ['ATTACK ERRORS', 'att_errors'], ['RECEPTION ERRORS', 'rec_errors'], ['POINTS WON ON SERVE', 'serve_pts'], ['SIDE-OUTS', 'sideouts']],
    hows: [['attack', 'Attack'], ['block', 'Block'], ['ace', 'Ace'], ['error', 'Opp. error'], ['svc_err', 'Opp. service error'], ['att_err', 'Opp. attack error'], ['rec_err', 'Opp. reception error']],
    oppHows: { svc_err: 'svc_errors', att_err: 'att_errors', rec_err: 'rec_errors' },
    switchAt: (st, t) => {
      const decider = st.setsWon.A + st.setsWon.B === st.o.bestOf - 1;
      const total = st.cur.A + st.cur.B;
      if (decider && t === 15 && Math.max(st.cur.A, st.cur.B) === 8 && Math.min(st.cur.A, st.cur.B) < 8) return 'CHANGE OF COURTS';
      if (st.o.points === 21 && total > 0 && total % (decider ? 5 : 7) === 0) return 'CHANGE OF COURTS';
      return null;
    },
  }));

  // ================================================================== BASEBALL
  register({
    id: 'baseball', name: 'Baseball', kind: 'baseball',
    defaultVariant: 'nine',
    variants: { nine: { label: '9 innings', options: { innings: 9 } }, seven: { label: '7 innings', options: { innings: 7 } } },
    options: {},
    init(setup) {
      const o = resolveOptions(this, setup);
      return { o, setup, inning: 1, half: 0, balls: 0, strikes: 0, outs: 0, bases: [false, false, false],
        line: { A: [0], B: [] }, runs: { A: 0, B: 0 }, hits: { A: 0, B: 0 }, errors: { A: 0, B: 0 }, lob: { A: 0, B: 0 },
        order: { A: 0, B: 0 }, pitcher: { A: '', B: '' }, pitches: {}, finished: false, winner: null, timeline: [], last: null, pstats: {} };
    },
    apply(st, ev) {
      if (st.finished && ev.type !== 'end' && ev.type !== 'note') return;
      const bat = st.half === 0 ? 'A' : 'B', fld = U.other(bat);
      const lineup = teamOf(st.setup, bat).players;
      const batter = lineup.length ? lineup[st.order[bat] % lineup.length] : null;
      const inc = (id, k, n = 1) => { if (!id) return; const s = st.pstats[id] = st.pstats[id] || {}; s[k] = (s[k] || 0) + n; };
      const pitcher = st.pitcher[fld];
      const pitch = () => { if (pitcher) st.pitches[pitcher] = (st.pitches[pitcher] || 0) + 1; };
      const log = (text, icon, wipe, team) => {
        const inn = `${st.half === 0 ? '▲' : '▼'}${st.inning}`;
        st.timeline.push({ id: ev.id, team: team || bat, kind: icon, text, icon, ct: inn });
        st.last = { type: icon, team: team || bat, player: batter ? batter.id : '', text, wipe: wipe || '' };
      };
      const score = n => { if (!n) return; st.runs[bat] += n; st.line[bat][st.inning - 1] = (st.line[bat][st.inning - 1] || 0) + n; this.checkWalkoff(st); };
      const nextBatter = () => { st.order[bat]++; st.balls = 0; st.strikes = 0; };
      const advanceForce = () => {
        const [b1, b2, b3] = st.bases;
        const runs = b1 && b2 && b3 ? 1 : 0;
        st.bases = [true, b2 || b1, b3 || (b1 && b2)];
        return runs;
      };
      const advanceAll = n => {
        let runs = 0; const nb = [false, false, false];
        st.bases.forEach((on, i) => { if (!on) return; const to = i + 1 + n; if (to >= 4) runs++; else nb[to - 1] = true; });
        if (n >= 4) runs++; else nb[n - 1] = true;
        st.bases = nb; return runs;
      };
      const out = (n, text) => {
        st.outs += n;
        log(text, 'out');
        nextBatter();
        if (st.outs >= 3) this.endHalf(st);
      };
      const bname = batter ? `${pnum(batter)}${pname(batter)}` : 'BATTER';
      switch (ev.type) {
        case 'pitch': {
          pitch();
          if (ev.kind === 'ball') {
            st.balls++;
            if (st.balls >= 4) { const r = advanceForce(); inc(batter && batter.id, 'bb'); if (pitcher) inc(pitcher, 'p_bb'); log(`WALK – ${bname}`, 'walk'); score(r); nextBatter(); }
          } else if (ev.kind === 'foul') {
            if (st.strikes < 2) st.strikes++;
          } else { // strike (called / swinging)
            st.strikes++;
            if (st.strikes >= 3) { inc(batter && batter.id, 'ab'); inc(batter && batter.id, 'k'); if (pitcher) inc(pitcher, 'p_k'); out(1, `STRIKEOUT – ${bname}`); }
          }
          break;
        }
        case 'hit': {
          pitch();
          const n = Math.min(4, Math.max(1, +ev.bases || 1));
          const names = { 1: 'SINGLE', 2: 'DOUBLE', 3: 'TRIPLE', 4: 'HOME RUN' };
          st.hits[bat]++; inc(batter && batter.id, 'ab'); inc(batter && batter.id, 'h'); if (n === 4) inc(batter && batter.id, 'hr');
          if (pitcher) inc(pitcher, 'p_h');
          const r = advanceAll(n);
          if (batter) inc(batter.id, 'rbi', r);
          log(`${names[n]} – ${bname}${r ? ` (${r} RBI)` : ''}`, n === 4 ? 'hr' : 'hit', n === 4 ? (r === 4 ? 'GRAND SLAM' : 'HOME RUN') : '');
          nextBatter(); score(r);
          break;
        }
        case 'walk': case 'hbp': {
          pitch();
          const r = advanceForce(); inc(batter && batter.id, 'bb');
          log(`${ev.type === 'hbp' ? 'HIT BY PITCH' : 'WALK'} – ${bname}`, 'walk'); nextBatter(); score(r);
          break;
        }
        case 'out': {
          pitch();
          inc(batter && batter.id, 'ab');
          const how = { fly: 'FLY OUT', ground: 'GROUND OUT', line: 'LINE OUT', k: 'STRIKEOUT', dp: 'DOUBLE PLAY', fc: "FIELDER'S CHOICE" }[ev.how] || 'OUT';
          if (ev.how === 'k') { inc(batter && batter.id, 'k'); if (pitcher) inc(pitcher, 'p_k'); }
          if (ev.how === 'dp') { st.bases[0] = false; out(2, `${how} – ${bname}`); }
          else if (ev.how === 'fc') { st.bases = [true, st.bases[1], st.bases[2]]; out(1, `${how} – ${bname}`); }
          else out(1, `${how} – ${bname}`);
          break;
        }
        case 'error': {
          pitch();
          st.errors[fld]++; inc(batter && batter.id, 'ab');
          const r = advanceAll(1);
          log(`REACHES ON ERROR – ${bname}`, 'error', '', bat); nextBatter(); score(r);
          break;
        }
        case 'run': { score(+ev.n || 1); log(U.up(ev.text || 'RUN SCORES'), 'run'); break; }
        case 'bases': { st.bases = [!!ev.b1, !!ev.b2, !!ev.b3]; break; }
        case 'outs': { st.outs = Math.max(0, Math.min(2, +ev.n || 0)); break; }
        case 'count': { st.balls = Math.max(0, Math.min(3, +ev.balls || 0)); st.strikes = Math.max(0, Math.min(2, +ev.strikes || 0)); break; }
        case 'runner_out': { // caught stealing / picked off
          if (ev.base >= 1 && ev.base <= 3) st.bases[ev.base - 1] = false;
          st.outs++; log('RUNNER OUT', 'out');
          if (st.outs >= 3) this.endHalf(st);
          break;
        }
        case 'halfend': this.endHalf(st); break;
        case 'pitcher': { st.pitcher[ev.team] = ev.player || ''; const p = findPlayer(st.setup, ev.player); if (p) log(`NOW PITCHING – ${pnum(p)}${pname(p)}`, 'sub', '', ev.team); break; }
        case 'batter': { st.order[ev.team] = Math.max(0, +ev.index || 0); break; }
        case 'end': { st.finished = true; st.winner = st.runs.A > st.runs.B ? 'A' : st.runs.B > st.runs.A ? 'B' : null; log('FINAL', 'end', '', ''); break; }
        case 'note': log(U.up(ev.text || ''), 'note', '', ev.team || ''); break;
      }
    },
    checkWalkoff(st) {
      if (st.half === 1 && st.inning >= st.o.innings && st.runs.B > st.runs.A) { st.finished = true; st.winner = 'B'; }
    },
    endHalf(st) {
      const bat = st.half === 0 ? 'A' : 'B';
      st.lob[bat] += st.bases.filter(Boolean).length;
      st.bases = [false, false, false]; st.balls = 0; st.strikes = 0; st.outs = 0;
      if (st.half === 0) {
        if (st.inning >= st.o.innings && st.runs.B > st.runs.A) { st.finished = true; st.winner = 'B'; return; }
        st.half = 1; st.line.B[st.inning - 1] = st.line.B[st.inning - 1] || 0;
      } else {
        if (st.inning >= st.o.innings && st.runs.A !== st.runs.B) { st.finished = true; st.winner = st.runs.A > st.runs.B ? 'A' : 'B'; return; }
        st.half = 0; st.inning++; st.line.A[st.inning - 1] = st.line.A[st.inning - 1] || 0;
      }
    },
    view(st, setup) {
      const v = baseView(this, setup);
      v.score = { A: String(st.runs.A), B: String(st.runs.B) };
      const halfTxt = st.half === 0 ? 'TOP' : 'BOTTOM';
      v.periodLabel = st.finished ? (st.inning > st.o.innings || (st.half === 0 && st.inning > st.o.innings) ? `FINAL/${st.inning}` : 'FINAL') : `${halfTxt} ${U.ordinal(st.inning)}`;
      v.finished = st.finished; v.winner = st.winner;
      const bat = st.half === 0 ? 'A' : 'B', fld = U.other(bat);
      const lineup = v.teams[bat].players;
      const batter = lineup.length ? lineup[st.order[bat] % lineup.length] : null;
      const pitcher = findPlayer(setup, st.pitcher[fld]);
      const bs = batter ? (st.pstats[batter.id] || {}) : {};
      const n = Math.max(st.o.innings, st.inning);
      v.table.title = 'LINESCORE';
      v.table.cols = Array.from({ length: n }, (_, i) => String(i + 1));
      const cell = (k, i) => (st.line[k][i] === undefined ? '' : String(st.line[k][i]));
      v.table.A = v.table.cols.map((_, i) => cell('A', i));
      v.table.B = v.table.cols.map((_, i) => (st.finished && st.half === 0 && i === st.inning - 1 && st.line.B[i] === undefined ? 'X' : cell('B', i)));
      v.table.total = [String(st.runs.A), String(st.runs.B)];
      v.table.extraCols = ['R', 'H', 'E'];
      v.table.extraA = [String(st.runs.A), String(st.hits.A), String(st.errors.A)];
      v.table.extraB = [String(st.runs.B), String(st.hits.B), String(st.errors.B)];
      v.extra = {
        inning: st.inning, half: st.half, balls: st.balls, strikes: st.strikes, outs: st.outs, bases: st.bases, batting: bat,
        batter: batter ? { id: batter.id, name: pname(batter), number: batter.number || '', line: `${bs.h || 0}-${bs.ab || 0}${bs.hr ? `, ${bs.hr} HR` : ''}${bs.rbi ? `, ${bs.rbi} RBI` : ''}${bs.bb ? `, ${bs.bb} BB` : ''}` } : null,
        pitcher: pitcher ? { id: pitcher.id, name: pname(pitcher), number: pitcher.number || '', pitches: st.pitches[pitcher.id] || 0 } : null,
      };
      v.teamStats = [
        { label: 'RUNS', a: String(st.runs.A), b: String(st.runs.B) }, { label: 'HITS', a: String(st.hits.A), b: String(st.hits.B) },
        { label: 'ERRORS', a: String(st.errors.A), b: String(st.errors.B) }, { label: 'LEFT ON BASE', a: String(st.lob.A), b: String(st.lob.B) },
      ];
      v.timeline = st.timeline; v.lastEvent = st.last;
      ['A', 'B'].forEach(k => v.teams[k].players.forEach(pl => {
        const s = st.pstats[pl.id] || {};
        v.players.push({ id: pl.id, team: k, name: pl.name, tvName: pl.tvName || U.up(pl.name), number: pl.number || '', position: pl.position || '', stats: s,
          statsText: [s.ab ? `${s.h || 0}-${s.ab}` : '', s.hr ? `${s.hr} HR` : '', s.rbi ? `${s.rbi} RBI` : '', s.p_k ? `${s.p_k} K` : ''].filter(Boolean).join(' · ') });
      }));
      v.status = st.finished ? `${v.winner ? v.teams[v.winner].name.toUpperCase() + ' WIN' : 'FINAL'} ${st.runs.A}-${st.runs.B}` : `${st.outs} OUT${st.outs === 1 ? '' : 'S'} · ${st.balls}-${st.strikes}`;
      v.facts = [{ cat: 'LINESCORE', big: `${st.runs.A} – ${st.runs.B}`, txt: `${v.periodLabel} · R/H/E ${st.runs.A}/${st.hits.A}/${st.errors.A} v ${st.runs.B}/${st.hits.B}/${st.errors.B}` }];
      if (v.extra.batter) v.facts.push({ cat: 'AT BAT', big: v.extra.batter.name, txt: `${v.extra.batter.line} today` });
      if (v.extra.pitcher) v.facts.push({ cat: 'PITCHING', big: String(v.extra.pitcher.pitches), txt: `pitches for ${v.extra.pitcher.name}` });
      const on = st.bases.filter(Boolean).length;
      if (on) v.facts.push({ cat: 'ON BASE', big: String(on), txt: st.bases[0] && st.bases[1] && st.bases[2] ? 'BASES LOADED' : `runner${on > 1 ? 's' : ''} on ${st.bases.map((b, i) => (b ? ['1ST', '2ND', '3RD'][i] : '')).filter(Boolean).join(' & ')}` });
      return v;
    },
  });

  // ================================================================== ATHLETICS
  const parseMark = (s, kind) => {
    if (s == null) return null;
    s = String(s).trim().toUpperCase();
    if (!s || /DNF|DNS|DQ|NM|NH|^X$|^-$/.test(s)) return null;
    if (kind === 'field') { const n = parseFloat(s.replace(',', '.')); return isNaN(n) ? null : n; }
    const parts = s.replace(',', '.').split(':').map(Number);
    if (parts.some(isNaN)) return null;
    return parts.reduce((a, p) => a * 60 + p, 0);
  };
  register({
    id: 'athletics', name: 'Athletics', kind: 'athletics',
    defaultVariant: 'meet', variants: { meet: { label: 'Track & field meet', options: {} } }, options: {},
    init(setup) {
      const ath = setup.ath || { events: [], current: '' };
      return { setup, results: {}, attempts: {}, notes: {}, reaction: {}, timeline: [], last: null, ath };
    },
    apply(st, ev) {
      const key = `${ev.eventId}|${ev.entry}`;
      if (ev.type === 'result') {
        st.results[key] = ev.value; if (ev.note !== undefined) st.notes[key] = ev.note; if (ev.reaction !== undefined) st.reaction[key] = ev.reaction;
        const e = (st.ath.events || []).find(x => x.id === ev.eventId);
        const en = e && e.entries.find(x => x.id === ev.entry);
        if (en && ev.value) { const text = `${U.up(en.name)} – ${ev.value}${ev.note ? ' ' + U.up(ev.note) : ''}`; st.timeline.push({ id: ev.id, team: '', kind: 'result', text, icon: 'result', ct: e.name }); st.last = { type: 'result', team: '', player: en.id, text, wipe: '' }; }
      } else if (ev.type === 'attempt') {
        (st.attempts[key] = st.attempts[key] || []).push(String(ev.value));
      } else if (ev.type === 'attempt_clear') {
        st.attempts[key] = [];
      } else if (ev.type === 'note') {
        st.timeline.push({ id: ev.id, team: '', kind: 'note', text: U.up(ev.text || ''), icon: 'note' });
        st.last = { type: 'note', team: '', text: U.up(ev.text || ''), wipe: '' };
      }
    },
    eventView(st, e) {
      const kind = e.kind || 'track';
      const vertical = kind === 'field' && (!!e.vertical || /high jump|pole vault/i.test(e.discipline || e.name || ''));
      const rounds = Math.max(1, Math.min(12, Number(e.rounds) || 6));
      const STATUS = /^(DNS|DNF|DQ|NM|NH|RET|R)$/i;
      const order = (r, i) => (+r.lane || +r.bib || 900 + i);
      const rows = (e.entries || []).map((en, i) => {
        const key = `${e.id}|${en.id}`;
        const att = st.attempts[key] || [];
        const override = st.results[key] || '';
        const note = st.notes[key] || '';
        const r = { id: en.id, idx: i, lane: en.lane || '', bib: en.bib || '', name: en.name || '', tvName: en.tvName || U.up(en.name || ''), team: en.team || '', pb: en.pb || '', sb: en.sb || '',
          result: override, note, reaction: st.reaction[key] || '', attempts: att, mark: null, tb: [], out: false };
        r.status = STATUS.test(override) ? U.up(override) : STATUS.test(note) ? U.up(note) : '';
        if (kind === 'field' && !vertical) {
          const marks = att.map(a => parseMark(a, 'field')).filter(x => x != null).sort((a, b) => b - a);
          r.best = marks.length ? marks[0] : null;
          r.tb = marks;
          if (!override && marks.length) r.result = marks[0].toFixed(2);
          else if (!override && att.length >= rounds && att.every(a => /^[X-]$/i.test(String(a).trim()))) r.result = 'NM';
        } else if (vertical) {
          // "1.85 O" / "1.85 X" / "1.85 -": best cleared height; ties: fewer failures at that height, then fewer failures in all
          const tries = att.map(a => { const m = /^\s*(\d+(?:[.,]\d+)?)\s*([OX\-])\s*$/i.exec(String(a)); return m ? { h: parseFloat(m[1].replace(',', '.')), m: m[2].toUpperCase() } : null; }).filter(Boolean);
          const cleared = tries.filter(t => t.m === 'O').map(t => t.h);
          r.best = cleared.length ? Math.max(...cleared) : null;
          let streak = 0; for (const t of tries) { if (t.m === 'X') streak++; else if (t.m === 'O') streak = 0; }
          r.eliminated = streak >= 3;
          r.tries = tries;
          const failsAtBest = r.best == null ? 0 : tries.filter(t => t.h === r.best && t.m === 'X').length;
          r.tb = [-failsAtBest, -tries.filter(t => t.m === 'X').length];
          if (!override && r.best != null) r.result = r.best.toFixed(2);
          else if (!override && tries.length && r.eliminated) r.result = 'NH';
          // what this athlete did at the bar now
          const bar = parseFloat(String(e.bar || '').replace(',', '.'));
          const atBar = isNaN(bar) ? [] : tries.filter(t => Math.abs(t.h - bar) < 1e-6);
          r.atBar = atBar.map(t => t.m).join('');
        }
        r.mark = parseMark(r.result, kind);
        return r;
      });
      // ranking (field: ties broken by the next best marks / failures)
      const cmpTb = (a, b) => { for (let i = 0; i < Math.max(a.tb.length, b.tb.length); i++) { const x = a.tb[i] == null ? -Infinity : a.tb[i], y = b.tb[i] == null ? -Infinity : b.tb[i]; if (x !== y) return y - x; } return 0; };
      const ranked = rows.filter(r => r.mark != null).sort((a, b) => (kind === 'field' ? (b.mark - a.mark) || cmpTb(a, b) : a.mark - b.mark));
      let rank = 0, prev = null;
      ranked.forEach((r, i) => { if (prev === null || (kind === 'field' ? cmpTb(r, prev) !== 0 || r.mark !== prev.mark : r.mark !== prev.mark)) rank = i + 1; r.rank = rank; prev = r; });
      const unranked = rows.filter(r => r.mark == null && r.result);
      const results = ranked.concat(unranked.map(r => Object.assign(r, { rank: '' })));
      const startlist = rows.slice().sort((a, b) => order(a, a.idx) - order(b, b.idx));
      // field events: who is up next (fewest attempts, then the competition order)
      let up = null, round = 0, complete = false, active = [];
      if (kind === 'field') {
        if (!vertical) {
          active = startlist.filter(r => !r.status && r.attempts.length < rounds);
          if (e.cut && rows.filter(r => !r.status).every(r => r.attempts.length >= 3 || r.out)) {
            const top = ranked.slice(0, Number(e.cut) > 1 ? Number(e.cut) : 8).map(r => r.id);
            rows.forEach(r => { if (r.attempts.length >= 3 && !top.includes(r.id)) r.out = true; });
            active = active.filter(r => !r.out);
          }
          const min = active.length ? Math.min(...active.map(r => r.attempts.length)) : 0;
          round = active.length ? min + 1 : rounds;
          up = active.find(r => r.id === e.up) || active.find(r => r.attempts.length === min) || null;
          complete = rows.length > 0 && !active.length;
        } else {
          const bar = parseFloat(String(e.bar || '').replace(',', '.'));
          const stillIn = startlist.filter(r => !r.status && !r.eliminated);
          active = isNaN(bar) ? [] : stillIn.filter(r => !/[O-]/.test(r.atBar || '') && (r.atBar || '').length < 3);
          const min = active.length ? Math.min(...active.map(r => (r.atBar || '').length)) : 0;
          round = active.length ? min + 1 : 0;
          up = active.find(r => r.id === e.up) || active.find(r => (r.atBar || '').length === min) || null;
          complete = rows.some(r => r.attempts.length) && !stillIn.length;
          rows.forEach(r => { r.out = !!r.eliminated; });
        }
      } else complete = rows.length > 0 && rows.every(r => r.result);
      return { id: e.id, name: e.name || '', round: e.round || '', wind: e.wind || '', kind, vertical, rounds, cut: e.cut || 0, bar: e.bar || '', gender: e.gender || '', age: e.age || '', discipline: e.discipline || '',
        rows, startlist, results, hasResults: results.length > 0, up: up ? up.id : '', attemptRound: round, active: active.map(r => r.id), complete };
    },
    view(st, setup) {
      const v = baseView(this, setup);
      const evs = (st.ath.events || []).map(e => this.eventView(st, e));
      const cur = evs.find(e => e.id === st.ath.current) || evs[0] || null;
      v.extra = { events: evs.map(e => ({ id: e.id, name: e.name, round: e.round, kind: e.kind, entries: e.rows.length, results: e.results.length, complete: e.complete })), current: cur, auto: Object.assign({ mode: 'off', delay: 20 }, st.ath.auto || {}) };
      v.periodLabel = cur ? `${U.up(cur.name)}${cur.round ? ' · ' + U.up(cur.round) : ''}` : 'ATHLETICS';
      v.status = cur ? (cur.hasResults ? 'RESULTS' : 'START LIST') : 'NO EVENT';
      v.score = { A: '', B: '' };
      v.timeline = st.timeline; v.lastEvent = st.last;
      if (cur) cur.rows.forEach(r => v.players.push({ id: r.id, team: '', name: r.name, tvName: r.tvName, number: r.bib, position: r.lane ? `${cur.kind === 'field' ? 'ORDER' : 'LANE'} ${r.lane}` : '', stats: {}, statsText: [r.team, r.pb ? 'PB ' + r.pb : '', r.sb ? 'SB ' + r.sb : ''].filter(Boolean).join(' · '), teamName: r.team, result: r.result, rank: r.rank || '',
        lane: r.lane, bib: r.bib, pb: r.pb, sb: r.sb, note: r.note, reaction: r.reaction, attemptsText: (r.attempts || []).join('  '), best: r.best != null ? r.best.toFixed(2) : '', kind: cur.kind }));
      v.clock.game = { dir: 1, limitMs: 0, startMs: 0, stopAtLimit: false };
      v.facts = [];
      if (cur && cur.results.length) {
        const w = cur.results[0];
        v.facts.push({ cat: 'WINNER', big: w.result, txt: `${w.tvName} (${w.team}) – ${cur.name}` });
        cur.results.filter(r => /PB|SB|NR|WR|CR|MR|AR/i.test(r.note)).forEach(r => v.facts.push({ cat: U.up(r.note), big: r.result, txt: `${r.tvName} (${r.team})` }));
      } else if (cur) {
        cur.startlist.slice(0, 8).forEach(r => { if (r.pb) v.facts.push({ cat: `LANE ${r.lane || '-'}`, big: r.tvName, txt: `${r.team}${r.pb ? ' · PB ' + r.pb : ''}${r.sb ? ' · SB ' + r.sb : ''}` }); });
      }
      if (!v.facts.length) v.facts.push({ cat: 'ATHLETICS', big: v.periodLabel, txt: v.status });
      return v;
    },
  });

  // ================================================================== flat map for graphics
  const CARD_COLORS = { yellow: '#f4c20d', yellow10: '#f4c20d', warning: '#f4c20d', red: '#e5484d', red20: '#e5484d', green: '#2ea043', blue: '#2f81f7', white: '#ffffff', black: '#111111' };
  const cardColor = (def, key) => (def && def.color) || CARD_COLORS[key] || (/yellow/.test(key) ? CARD_COLORS.yellow : /red/.test(key) ? CARD_COLORS.red : /green/.test(key) ? CARD_COLORS.green : '');
  function buildFlat(v, setup) {
    const f = {};
    const set = (k, val) => { f[k] = val == null ? '' : String(val); };
    set('sport', v.sport); set('sport_name', U.up(v.name)); set('variant', v.variant);
    set('title', U.up(setup.title || '')); set('competition', U.up(setup.competition || '')); set('venue', U.up(setup.venue || ''));
    const comms = (Array.isArray(setup.commentators) ? setup.commentators : []).map(x => String(x || '').trim()).filter(Boolean);
    set('commentators', U.up(comms.join('  &  '))); set('commentators_count', comms.length);
    for (let i = 0; i < 4; i++) { set(`commentator${i + 1}`, U.up(comms[i] || '')); set(`comm${i + 1}`, U.up(comms[i] || '')); }
    const offs = officialsOf(setup), named = offs.filter(o => o.name);
    for (let i = 0; i < 6; i++) { set(`official${i + 1}_role`, U.up((offs[i] || {}).role || '')); set(`official${i + 1}_name`, U.up((offs[i] || {}).name || '')); }
    set('officials_count', named.length); set('officials', U.up(named.map(o => o.name).join('  ·  ')));
    set('referee', U.up((offs[0] || {}).name || '')); set('referee_title', U.up((offs[0] || {}).role || ''));
    ['A', 'B'].forEach(k => {
      const t = v.teams[k];
      set(`team${k}_name`, U.up(t.name)); set(`team${k}_short`, U.up(t.short)); set(`team${k}_logo`, t.logo);
      set(`team${k}_color1`, t.color1); set(`team${k}_color2`, t.color2); set(`team${k}_coach`, U.up(t.coach));
    });
    set('scoreA', v.score.A); set('scoreB', v.score.B);
    set('period', v.periodLabel); set('status_text', v.status); set('finished', v.finished ? '1' : '');
    set('winner', v.winner || ''); set('winner_name', v.winner ? U.up(v.teams[v.winner].name) : '');
    set('match_line', v.kind === 'athletics' ? v.periodLabel : `${U.up(v.teams.A.name)} ${v.score.A} – ${v.score.B} ${U.up(v.teams.B.name)}`);
    // period / set / inning table
    set('table_title', v.table.title); set('table_cols', v.table.cols.length);
    v.table.cols.forEach((c, i) => { set(`col${i + 1}`, c); set(`col${i + 1}A`, v.table.A[i]); set(`col${i + 1}B`, v.table.B[i]); });
    (v.table.extraCols || []).forEach((c, i) => { set(`xcol${i + 1}`, c); set(`xcol${i + 1}A`, v.table.extraA[i]); set(`xcol${i + 1}B`, v.table.extraB[i]); });
    // team stats
    set('stats_count', v.teamStats.length);
    v.teamStats.forEach((s, i) => { set(`stat${i + 1}_label`, s.label); set(`stat${i + 1}_a`, s.a); set(`stat${i + 1}_b`, s.b); });
    // timeline (latest first)
    const tl = v.timeline.slice().reverse().slice(0, 16);
    set('events_count', tl.length);
    tl.forEach((e, i) => { set(`ev${i + 1}_text`, e.text); set(`ev${i + 1}_time`, e.ct || ''); set(`ev${i + 1}_team`, e.team || ''); set(`ev${i + 1}_icon`, e.icon || ''); });
    // scorers per team (score events, chronological)
    ['A', 'B'].forEach(k => {
      const sc = v.timeline.filter(e => e.kind === 'score' && e.team === k);
      set(`scorers${k}`, sc.map(e => `${e.text.replace(/^[^–]*– /, '')}${e.ct ? ' ' + e.ct : ''}`).join(', '));
    });
    // leaders
    v.leaders.forEach((l, i) => { set(`leader${i + 1}_label`, l.label); set(`leader${i + 1}_name`, l.name); set(`leader${i + 1}_team`, U.up(v.teams[l.team].short)); set(`leader${i + 1}_value`, l.value); });
    // last event
    const le = v.lastEvent;
    set('last_text', le ? le.text : ''); set('last_type', le ? le.type : ''); set('last_team', le ? le.team : '');
    // Cards also give a colour, so a template can tint a strap or a card icon: the card's own colour for a card,
    // the team's colour for anything else. card_* always describe the most recent card of the match.
    const cardOf = (key) => (SPORTS[v.sport].cards || []).find(c => c.key === key) || null;
    set('last_key', le ? le.key || '' : '');
    set('last_color', le && le.type === 'card' ? cardColor(cardOf(le.key), le.key) : le && le.team && v.teams[le.team] ? v.teams[le.team].color1 : '');
    const lastCard = v.timeline.filter(e => e.kind === 'card').pop() || null, lc = lastCard ? cardOf(lastCard.key) : null;
    set('card_key', lastCard ? lastCard.key : ''); set('card_name', lastCard && lc ? U.up(lc.label) : ''); set('card_color', lastCard ? cardColor(lc, lastCard.key) : '');
    set('card_text', lastCard ? lastCard.text : ''); set('card_time', lastCard ? lastCard.ct || '' : ''); set('card_team', lastCard ? lastCard.team || '' : '');
    set('card_team_name', lastCard && lastCard.team ? U.up(v.teams[lastCard.team].name) : ''); set('card_team_color', lastCard && lastCard.team ? v.teams[lastCard.team].color1 : '');
    const cp = lastCard && lastCard.player ? v.players.find(p => p.id === lastCard.player) : null;
    set('card_player', cp ? cp.tvName : ''); set('card_number', cp ? cp.number : '');
    set('last_team_name', le && le.team ? U.up(v.teams[le.team].name) : '');
    if (le && le.type === 'sub') { set('sub_on', le.onName); set('sub_off', le.offName); set('sub_on_number', le.onNumber); set('sub_off_number', le.offNumber); }
    // sport specific
    const x = v.extra;
    if (v.kind === 'timed') {
      set('timeoutsA', x.timeouts.A); set('timeoutsB', x.timeouts.B);
      set('teamfoulsA', x.teamFouls.A); set('teamfoulsB', x.teamFouls.B);
      set('bonusA', x.bonus && x.bonus.A ? 'BONUS' : ''); set('bonusB', x.bonus && x.bonus.B ? 'BONUS' : '');
      set('centre_pass', x.centrePass || '');
      if (x.shootout) { set('shootoutA', x.shootout.sa); set('shootoutB', x.shootout.sb); set('shootout_textA', x.shootout.A.map(s => (s ? '●' : '○')).join('')); set('shootout_textB', x.shootout.B.map(s => (s ? '●' : '○')).join('')); }
      set('reds', (x.reds || []).map(r => `${r.name} (${v.teams[r.team].short})`).join(', '));
      if (x.bonusPts) { set('logptsA', x.bonusPts.A.log); set('logptsB', x.bonusPts.B.log); set('trybonusA', x.bonusPts.A.tryBonus ? 'TRY BONUS' : ''); set('trybonusB', x.bonusPts.B.tryBonus ? 'TRY BONUS' : ''); set('losingbonusA', x.bonusPts.A.losingBonus ? 'LOSING BONUS' : ''); set('losingbonusB', x.bonusPts.B.losingBonus ? 'LOSING BONUS' : ''); }
    }
    if (v.kind === 'sets') {
      set('pointsA', x.points.A); set('pointsB', x.points.B);
      set('gamesA', x.games ? x.games.A : ''); set('gamesB', x.games ? x.games.B : '');
      set('server', x.server); set('serveA', x.server === 'A' ? '●' : ''); set('serveB', x.server === 'B' ? '●' : '');
      set('flag', x.flag); set('flag_team', x.flagTeam); set('tiebreak', x.tiebreak ? 'TIE-BREAK' : '');
      set('sets_played', x.sets.length);
      v.table.cols.forEach((c, i) => { set(`set${i + 1}A`, v.table.A[i]); set(`set${i + 1}B`, v.table.B[i]); });
    }
    if (v.kind === 'baseball') {
      set('inning', x.inning); set('half', x.half === 0 ? 'TOP' : 'BOT'); set('half_arrow', x.half === 0 ? '▲' : '▼');
      set('balls', x.balls); set('strikes', x.strikes); set('outs', x.outs); set('count', `${x.balls}-${x.strikes}`);
      set('base1', x.bases[0] ? '1' : ''); set('base2', x.bases[1] ? '1' : ''); set('base3', x.bases[2] ? '1' : '');
      set('batting', x.batting);
      set('batter_name', x.batter ? x.batter.name : ''); set('batter_number', x.batter ? x.batter.number : ''); set('batter_line', x.batter ? x.batter.line : '');
      set('pitcher_name', x.pitcher ? x.pitcher.name : ''); set('pitcher_number', x.pitcher ? x.pitcher.number : ''); set('pitch_count', x.pitcher ? x.pitcher.pitches : '');
      set('runsA', v.table.extraA[0]); set('hitsA', v.table.extraA[1]); set('errorsA', v.table.extraA[2]);
      set('runsB', v.table.extraB[0]); set('hitsB', v.table.extraB[1]); set('errorsB', v.table.extraB[2]);
    }
    if (v.kind === 'athletics') {
      const c = x.current;
      set('ath_event', c ? U.up(c.name) : ''); set('ath_round', c ? U.up(c.round) : ''); set('ath_wind', c ? c.wind : ''); set('ath_kind', c ? c.kind : '');
      set('ath_status', v.status); set('ath_gender', c ? U.up(c.gender) : ''); set('ath_age', c && c.age && c.age !== 'Open' ? U.up(c.age) : ''); set('ath_discipline', c ? U.up(c.discipline || c.name) : '');
      if (c) {
        set('sl_count', c.startlist.length);
        c.startlist.slice(0, 16).forEach((r, i) => { const p = `sl${i + 1}_`; set(p + 'lane', r.lane); set(p + 'bib', r.bib); set(p + 'name', r.tvName); set(p + 'team', U.up(r.team)); set(p + 'pb', r.pb); set(p + 'sb', r.sb); });
        set('rs_count', c.results.length);
        c.results.slice(0, 16).forEach((r, i) => { const p = `rs${i + 1}_`; set(p + 'rank', r.rank); set(p + 'lane', r.lane); set(p + 'name', r.tvName); set(p + 'team', U.up(r.team)); set(p + 'result', r.result); set(p + 'note', U.up(r.note)); set(p + 'reaction', r.reaction); set(p + 'attempts', r.attempts.join(' ')); });
        const u = c.rows.find(r => r.id === c.up);
        set('ath_up_id', u ? u.id : ''); set('ath_up_name', u ? u.tvName : ''); set('ath_up_team', u ? U.up(u.team) : ''); set('ath_up_order', u ? u.lane : ''); set('ath_up_bib', u ? u.bib : '');
        set('ath_up_attempts', u ? u.attempts.map(a => U.up(a)).join('  ') : ''); set('ath_up_best', u && u.best != null ? u.best.toFixed(2) : ''); set('ath_up_rank', u ? u.rank || '' : '');
        set('ath_attempt_round', c.attemptRound || ''); set('ath_bar', c.bar || ''); set('ath_up_try', u && c.vertical ? (u.atBar || '').length + 1 : u ? u.attempts.length + 1 : '');
        const w = c.results[0];
        set('ath_winner_name', w ? w.tvName : ''); set('ath_winner_team', w ? U.up(w.team) : ''); set('ath_winner_result', w ? w.result : ''); set('ath_winner_note', w ? U.up(w.note) : '');
      }
    }
    return f;
  }

  // ================================================================== public API
  // Match officials by sport, as the federation names them. The names can be changed per match.
  const OFFICIALS = {
    rugby: ['Referee', 'Assistant referee 1', 'Assistant referee 2', 'TMO'],
    rugby7: ['Referee', 'Assistant referee 1', 'Assistant referee 2', 'TMO'],
    football: ['Referee', 'Assistant referee 1', 'Assistant referee 2', 'Fourth official', 'VAR'],
    hockey: ['Umpire 1', 'Umpire 2', 'Video umpire', 'Technical official'],
    netball: ['Umpire 1', 'Umpire 2', 'Reserve umpire'],
    basketball: ['Crew chief', 'Umpire 1', 'Umpire 2', 'Commissioner'],
    volleyball: ['First referee', 'Second referee', 'Scorer'],
    tennis: ['Chair umpire', 'Referee'], padel: ['Chair umpire', 'Referee'],
    badminton: ['Umpire', 'Service judge', 'Referee'],
    baseball: ['Plate umpire', 'First base umpire', 'Second base umpire', 'Third base umpire'],
    athletics: ['Referee', 'Starter', 'Chief judge'],
  };
  const officialRoles = (sportId) => (OFFICIALS[sportId] || OFFICIALS[String(sportId || '').replace(/\d+$/, '')] || ['Referee', 'Assistant 1', 'Assistant 2', 'Fourth official']).slice();
  // What a match has: its own list when one was saved, else the sport's roles with empty names.
  const officialsOf = (setup) => (Array.isArray(setup && setup.officials) && setup.officials.length ? setup.officials.map(o => ({ role: String((o && o.role) || '').trim(), name: String((o && o.name) || '').trim() })).filter(o => o.role || o.name)
    : officialRoles(setup && setup.sport).map(role => ({ role, name: '' })));

  function newSetup(sportId, variant) {
    const def = SPORTS[sportId];
    return {
      sport: sportId, variant: variant || def.defaultVariant, title: '', competition: '', venue: '', commentators: [], officials: officialRoles(sportId).map(role => ({ role, name: '' })), options: {},
      teams: { A: { name: 'HOME', short: 'HOM', logo: '', color1: '#1f6feb', color2: '#ffffff', coach: '', players: [] },
               B: { name: 'AWAY', short: 'AWY', logo: '', color1: '#d92d34', color2: '#ffffff', coach: '', players: [] } },
      ath: sportId === 'athletics' ? { events: [], current: '' } : undefined,
    };
  }

  function compute(setup, events) {
    const def = SPORTS[setup && setup.sport];
    if (!def) throw new Error('Unknown sport ' + (setup && setup.sport));
    const st = def.init(setup);
    (events || []).forEach(ev => { if (!ev.void) def.apply(st, ev); });
    const v = def.view(st, setup);
    v.flat = buildFlat(v, setup);
    return v;
  }

  /** Game time (ms since kick-off, continuous across periods) for a clock reading – must match the server. */
  function gameTime(v, clockMs) {
    const t = v.timing, g = v.clock.game;
    if (!t || !g || !t.periodLenMs) return clockMs || 0;
    const L = t.periodLenMs, p = t.period;
    const inPeriod = g.dir < 0 ? L - clockMs : (t.continuous ? clockMs - (Math.min(p, 99) - 1) * L : clockMs);
    return (p - 1) * L + Math.max(0, inPeriod);
  }

  const Sports = {
    SPORTS, U, compute, newSetup, officialRoles, officialsOf, gameTime, parseMark,
    list: () => Object.values(SPORTS).map(d => ({ id: d.id, name: d.name, kind: d.kind, variants: Object.entries(d.variants || {}).map(([k, x]) => ({ id: k, label: x.label })), defaultVariant: d.defaultVariant })),
    actions: (sportId, variant, options) => {
      const d = SPORTS[sportId];
      if (!d || d.kind !== 'timed') return [];
      const o = resolveOptions(d, { variant, options: options || {} });
      return (typeof d.actions === 'function' ? d.actions(o) : d.actions);
    },
    cards: sportId => (SPORTS[sportId] && SPORTS[sportId].cards) || [],
    cardColor: (sportId, key) => cardColor(((SPORTS[sportId] && SPORTS[sportId].cards) || []).find(c => c.key === key), key),
    hows: sportId => (SPORTS[sportId] && SPORTS[sportId].hows) || [],
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Sports; else window.Sports = Sports;
})();
