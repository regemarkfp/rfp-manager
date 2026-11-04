'use strict';
// For fans and viewers on the public website:
//  · predictions before kick-off (home win, draw, away win) and the fans' player of the match (from the start of play
//    until two days after), one vote per signed-in person, kept per match (kv "fans:<fixture>")
//  · player profiles (/player/<id>), only for teams that switch them on: season numbers from completed matches, teams,
//    recent matches (school sport: off unless the team chooses)
//  · the sermon archive of a church channel: services with a title, preacher, scripture and series, with the recording
const Scoring = require('../shared/scoring');
const { fail } = require('./util');

function makeFanZone(app) {
  const get = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };

  // ---- predictions and player of the match
  async function fans(fid, user) {
    const m = app.matchcentre ? await app.matchcentre.build(fid) : null;
    if (!m) fail(404, 'Match not found');
    const v = (await app.store.kvGet('fans:' + fid).catch(() => null)) || { pred: {}, potm: {} };
    const started = !!m.score || ['Live', 'Completed'].includes(m.status);
    const day = m.date ? Date.parse(m.date + 'T00:00:00Z') : 0;
    const predOpen = !started && m.status !== 'Cancelled';
    const potmOpen = started && (!day || Date.now() < day + 3 * 86400e3);
    const options = [];
    if (m.players) for (const k of ['A', 'B']) for (const p of m.players[k] || []) if (p.lineup !== 'bench' || p.stats.length) options.push({ key: `${k}:${p.number}:${p.name}`, name: p.name, team: (m.teams[k === 'A' ? 0 : 1] || {}).name || '' });
    if (m.innings) { const seen = new Set(); for (const i of m.innings) for (const b of [...i.batting, ...i.bowling]) { const k = `${i.team}:${b.name}`; if (!seen.has(b.name)) { seen.add(b.name); options.push({ key: k, name: b.name, team: (m.teams[i.team === 'A' ? 0 : 1] || {}).name || '' }); } } }
    const count = (o) => Object.values(o).reduce((acc, x) => { acc[x] = (acc[x] || 0) + 1; return acc; }, {});
    const pc = count(v.pred), qc = count(v.potm);
    return { predict: { open: predOpen, counts: { A: pc.A || 0, D: pc.D || 0, B: pc.B || 0 }, total: Object.keys(v.pred).length, mine: user ? v.pred[user.id] || '' : '' },
      potm: { open: potmOpen, options, counts: qc, total: Object.keys(v.potm).length, mine: user ? v.potm[user.id] || '' : '', leader: Object.entries(qc).sort((a, b) => b[1] - a[1])[0] || null },
      teams: m.teams.map((t) => t.name), signedIn: !!user };
  }
  const queue = new Map();
  async function vote(fid, user, { predict, potm }) {
    const now = await fans(fid, user);
    const run = async () => {
      const v = (await app.store.kvGet('fans:' + fid).catch(() => null)) || { pred: {}, potm: {} };
      if (predict !== undefined) { if (!now.predict.open) fail(409, 'Predictions closed at kick-off'); if (!['A', 'D', 'B'].includes(predict)) fail(400, 'Home, draw or away?'); v.pred[user.id] = predict; }
      if (potm !== undefined) { if (!now.potm.open) fail(409, 'Voting for the player of the match is not open'); if (!now.potm.options.some((o) => o.key === potm)) fail(400, 'Pick a player from the match'); v.potm[user.id] = potm; }
      await app.store.kvSet('fans:' + fid, v);
    };
    const p = (queue.get(fid) || Promise.resolve()).then(run, run);
    queue.set(fid, p.catch(() => {}));
    await p;
    return fans(fid, user);
  }

  // ---- player profiles
  async function player(id) {
    const p = await get(id);
    if (!p || p.type !== 'player') fail(404, 'Player not found');
    const org = await get(p.team);
    if (!org || !org.data.publicMatches || !org.data.publicPlayers) fail(404, 'Player not found');
    const squads = (await app.store.list(p.team, 'squad')).filter((s) => !s.deleted && (s.data.players || []).some((r) => r && r.player === id));
    const teams = [];
    for (const s of squads) { const c = await get(s.data.club); teams.push({ id: s.id, name: [s.data.name || (c && c.data.name) || '', s.data.ageGroup].filter(Boolean).join(' '), sport: s.data.sport || '', club: c ? c.data.name || '' : '', number: ((s.data.players || []).find((r) => r.player === id) || {}).number || '' }); }
    const fx = (await app.store.list(p.team, 'fixture')).filter((f) => !f.deleted && f.data.live);
    const played = fx.filter((f) => { try { const L = f.data.live; return L.kind === 'sport' ? (L.setup.teams.A.players || []).concat(L.setup.teams.B.players || []).some((x) => x.id === id) : [L.match.teamA, L.match.teamB].some((t) => (t.players || []).some((x) => x.id === id)); } catch { return false; } });
    const stats = (Scoring.playerStats(played.map((f) => ({ ...f.data, status: f.data.status === 'Completed' || (f.data.result && f.data.result.finished) ? 'Completed' : f.data.status }))) || {})[id] || { matches: 0, stats: {} };
    const recent = played.sort((a, b) => String(b.data.startDate).localeCompare(String(a.data.startDate))).slice(0, 10).map((f) => { const r = f.data.result || Scoring.summary(f.data.live); return { id: f.id, name: f.data.name || f.data.autoName || '', date: f.data.startDate || '', score: r && r.started ? r.text : '', status: f.data.status || '' }; });
    return { id, name: [p.data.name, p.data.surname].filter(Boolean).join(' '), image: p.data.image || '', position: p.data.position || '', teams, matches: stats.matches || 0, stats: stats.stats || {}, recent, company: org.data.name || '' };
  }

  // ---- the sermon archive of a channel
  async function sermons(slug, { q = '' } = {}) {
    const ch = await app.streaming.channelBySlug(slug);
    if (!ch || ch.data.disabled || (ch.data.access || 'Public') !== 'Public') fail(404, 'No such channel');
    const w = String(q || '').trim().toLowerCase(), out = [];
    for (const p of await app.streaming.allStreams()) {
      const d = p.data;
      if (d.streamChannel !== ch.id || p.parentId || !d.streamSlug || d.streamVod === false || !(d.sermonTitle || d.type === 'Religion')) continue;
      if (d.streamPrice > 0) continue;                                           // paid streams are not in the free archive
      const vids = app.streaming.videosOf(d.streamSlug);
      if (!vids.length) continue;
      const item = { title: d.sermonTitle || d.streamTitle || d.name, preacher: d.preacher || '', scripture: d.scripture || '', series: d.series || '', notes: d.sermonNotes || '', date: d.date || '',
        url: `/watch/${d.streamSlug}?v=${encodeURIComponent(vids[vids.length - 1].start)}`, duration: Math.round(vids.reduce((n, v) => n + (Number(v.duration) || 0), 0)), poster: d.streamPoster || '' };
      if (w && ![item.title, item.preacher, item.scripture, item.series, item.notes].some((x) => String(x).toLowerCase().includes(w))) continue;
      out.push(item);
    }
    out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { channel: ch.data.name, list: out.slice(0, 200), series: [...new Set(out.map((x) => x.series).filter(Boolean))], preachers: [...new Set(out.map((x) => x.preacher).filter(Boolean))] };
  }
  return { fans, vote, player, sermons };
}

module.exports = { makeFanZone };
