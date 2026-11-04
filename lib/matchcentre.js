'use strict';
// The public match centre: everything a viewer may see about one match, live or finished, from the match as the
// scorer saved it (fixture.data.live). Used by the match page on the public website (/match/<id>) and under the
// video on watch pages. Never names who scored it, and nothing that is not on air anyway.
const Cricket = require('../shared/cricket');
const Sports = require('../shared/sports');
const Scoring = require('../shared/scoring');

const clockNow = (c, now) => { if (!c) return 0; const base = Number(c.baseMs) || 0; return c.running ? base + (c.direction < 0 ? -1 : 1) * (now - (Number(c.startedAt) || now)) : base; };

function makeMatchCentre(app) {
  const get = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };

  // may the public see this match? Its team shows matches on the website, or it is in a production that streams.
  async function isPublic(f) {
    const org = await get(f.team);
    if (org && org.data.publicMatches) return true;
    for (const p of await app.store.list(f.team, 'production')) if (!p.deleted && p.data.streamChannel && (p.data.fixtures || []).some((r) => r && r.fixture === f.id)) return true;
    return false;
  }

  function cricketPart(live) {
    const m = live.match, s = Cricket.compute(m);
    const name = (k) => (k === 'A' ? m.teamA : m.teamB).name;
    return {
      kind: 'cricket', statusText: s.statusText || '', finished: !!s.matchComplete,
      innings: s.innings.map((i) => ({
        team: i.battingTeam, title: `${name(i.battingTeam)}${i.superOver ? ' (super over)' : ` – innings ${i.number}`}`, score: i.score, overs: i.overs, runRate: i.runRate,
        target: i.target, runsNeeded: i.runsNeeded, requiredRate: i.requiredRate, complete: !!i.complete,
        batting: i.batting.map((b) => ({ name: b.tvName || b.name, howOut: b.howOut || '', runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, sr: b.strikeRate, batting: b.status === 'batting', onStrike: !!b.onStrike })),
        yetToBat: i.yetToBat.map((b) => b.tvName || b.name),
        extras: i.extras ? { total: i.extras.total, detail: i.extras.detail } : null,
        bowling: i.bowling.map((b) => ({ name: b.tvName || b.name || '', overs: b.overs, maidens: b.maidens, runs: b.runs, wickets: b.wickets, econ: b.economy, current: !!b.current })),
        fow: i.fow.map((w) => ({ wicket: w.wicket, score: w.score, over: w.over, name: w.name })),
        thisOver: (i.thisOver || []).map((x) => (typeof x === 'string' ? x : x && (x.label || x.text) ? x.label || x.text : '')).filter(Boolean),
      })),
    };
  }

  function sportPart(live, now) {
    const v = Sports.compute(live.setup, live.events || []);
    const g = live.clocks && live.clocks.game;
    const timeline = (v.timeline || []).filter((t) => ['score', 'card', 'sub', 'status', 'period', 'stat'].includes(t.kind) || t.kind === 'shootout').map((t) => ({ kind: t.kind, team: t.team || '', text: t.text || '', ct: t.ct || '', icon: t.icon || '' })).reverse();
    const labels = { points: 'Points' };
    try { for (const a of Sports.actions(v.sport, v.variant, v.options)) if (a.player) labels[a.stat || a.key] = labels[a.stat || a.key] || a.label; } catch { /* no actions */ }
    try { for (const c of Sports.cards(v.sport, v.options)) labels[c.key + '_cards'] = c.label.replace(/\s*\(.*\)/, '') + 's'; } catch { /* no cards */ }
    const players = (k) => v.players.filter((p) => p.team === k).map((p) => ({ number: p.number || '', name: p.tvName || p.name || '', position: p.position || '', lineup: p.lineup || '',
      stats: Object.entries(p.stats || {}).filter(([key, n]) => typeof n === 'number' && n > 0 && labels[key]).map(([key, n]) => [labels[key], n]), statsText: p.statsText || '' }));
    return {
      kind: v.kind || 'timed', statusText: v.status || '', finished: !!v.finished, phase: (v.extra && v.extra.phase) || '',
      clock: g ? { ms: Math.max(0, Math.round(clockNow(g, now))), running: !!g.running, dir: g.direction < 0 ? -1 : 1, at: now } : null,
      teamStats: (v.teamStats || []).filter((s) => s && s.label),
      timeline: timeline.slice(0, 120),
      leaders: (v.leaders || []).slice(0, 8).map((l) => ({ label: l.label || l.cat || '', name: l.name || '', team: l.team || '', value: l.value !== undefined ? String(l.value) : l.big || '' })),
      players: { A: players('A'), B: players('B') },
    };
  }

  async function build(fid) {
    const f = await get(fid);
    if (!f || f.type !== 'fixture' || !(await isPublic(f))) return null;
    const d = f.data, now = Date.now();
    let teams = [{}, {}]; try { teams = await app.domain.snapshotTeams(d); } catch { /* teams gone */ }
    const comp = await get(d.competition), venue = await get(d.venue);
    const sum = d.result || Scoring.summary(d.live);
    const out = {
      id: f.id, name: d.name || d.autoName || '', sport: d.sport || '', date: d.startDate || '', time: d.startTime || '', status: d.status || 'Upcoming',
      competition: comp ? [comp.data.name, comp.data.season].filter(Boolean).join(' ') : '', venue: venue ? [venue.data.name, venue.data.city].filter(Boolean).join(', ') : '',
      teams: teams.slice(0, 2).map((t, i) => ({ id: [d.team1, d.team2][i] || '', name: t.name || '', short: t.short || '', logo: t.logo || '', color: t.color1 || '' })),
      score: sum && sum.started ? (sum.kind === 'cricket' ? String(sum.text || '').split(' | ') : [String(sum.a), String(sum.b)]) : null,
      period: sum && sum.started ? sum.period || '' : '', commentators: String(d.commentators || '').split('\n').map((x) => x.trim()).filter(Boolean),
      officials: String(d.officials || '').split('\n').map((x) => x.trim()).filter(Boolean), updated: f.updatedAt || '',
    };
    try {
      if (d.live && d.live.kind === 'cricket' && d.live.match) Object.assign(out, cricketPart(d.live));
      else if (d.live && d.live.kind === 'sport' && d.live.setup && d.live.setup.sport) Object.assign(out, sportPart(d.live, now));
    } catch (e) { out.error = 'The match details could not be read'; }
    return out;
  }

  // the match to show under a stream: the one asked for, else the one that is live, else the first of the production
  async function forStream(prod, matchId) {
    const ids = prod.fixtureId ? [prod.fixtureId] : (prod.data.fixtures || []).map((r) => r && r.fixture).filter(Boolean);
    if (matchId && ids.includes(matchId)) return matchId;
    for (const id of ids) { const f = await get(id); if (f && f.data.status === 'Live') return id; }
    return ids[0] || '';
  }

  return { build, isPublic, forStream };
}

module.exports = { makeMatchCentre };
