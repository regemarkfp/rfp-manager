'use strict';
// Following teams and clubs on the public website (like following a team on Google): a fan picks teams or whole
// clubs, and gets match updates for them — line-ups, kick-off, every score, half and full time, red cards and big
// moments — in the RFP Manager app, in their browser and in their inbox. user.data.follows: [{ id, alerts }].
// The updates are worked out on the website from the match as the scorer saves it (it reaches the website by sync),
// so it does not matter which machine scores. What was already told is kept per match (kv "malert:<fixture>").
const Sports = require('../shared/sports');
const Cricket = require('../shared/cricket');
const Schema = require('../shared/schema');
const { log } = require('./util');

const ALERTS = [['lineups', 'Line-ups'], ['start', 'Kick-off / start'], ['scores', 'Every score'], ['breaks', 'Half time & full time'], ['big', 'Red cards & big moments']];
const allOn = () => Object.fromEntries(ALERTS.map(([k]) => [k, true]));
const cleanAlerts = (a) => { const out = allOn(); for (const [k] of ALERTS) if (a && a[k] !== undefined) out[k] = !!a[k]; return out; };
// how often scores come: every one, only when the lead changes (or it is level), or at most one per 10 / 15 / 30 minutes
const SCORE_RATES = [['every', 'Every score'], ['lead', 'Only when the lead changes'], ['10', 'At most every 10 minutes'], ['15', 'At most every 15 minutes'], ['30', 'At most every 30 minutes']];
const cleanFollow = (f) => ({ id: f.id, alerts: cleanAlerts(f.alerts), live: f.live !== false, digest: f.digest !== false, scoreRate: SCORE_RATES.some((r) => r[0] === f.scoreRate) ? f.scoreRate : 'every', at: f.at || 0 });
// the fan's own rhythm: a score digest (off, daily, weekly, on match days), when, how, and a pause for everything live
const DIGESTS = [['off', 'No digest'], ['matchday', 'Evening of a match day'], ['daily', 'Every day'], ['weekly', 'Once a week']];
function cleanPrefs(p = {}) {
  const t = (x, d) => (/^\d\d:\d\d$/.test(String(x || '')) ? String(x) : d);
  let tz = String(p.tz || ''); try { if (tz) new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch { tz = ''; }
  return { digest: DIGESTS.some((d) => d[0] === p.digest) ? p.digest : 'off', time: t(p.time, '19:00'), day: Math.max(0, Math.min(6, Number.isFinite(Number(p.day)) ? Number(p.day) : 1)), fixtures: p.fixtures !== false,
    push: p.push !== false, email: !!p.email, tz, pausedUntil: Number(p.pausedUntil) > Date.now() ? Number(p.pausedUntil) : 0, quietMatches: p.quietMatches !== false };
}
const cap = (s) => String(s || '').toLowerCase().replace(/(^|\s|-)\S/g, (m) => m.toUpperCase());

function makeFollows(app) {
  const get = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const site = () => String(app.config.publicUrl || app.config.adminUrl || '').replace(/\/+$/, '');
  const publicOrgs = async () => (await app.store.listType('org')).filter((o) => !o.deleted && o.data.publicMatches);

  // ---- what can be followed: the clubs and teams of production teams that show their matches on the website
  async function catalog() {
    const clubs = [], squads = [];
    for (const o of await publicOrgs()) {
      const cl = new Map((await app.store.list(o.id, 'club')).filter((d) => !d.deleted && !d.data.archived).map((d) => [d.id, d]));
      for (const c of cl.values()) clubs.push({ id: c.id, kind: 'club', name: c.data.name || '', logo: c.data.image || '', color: c.data.primaryColor || '', company: o.data.name || '' });
      for (const s of (await app.store.list(o.id, 'squad')).filter((d) => !d.deleted && !d.data.archived)) {
        const c = cl.get(s.data.club), r = Schema.resolveSquad(s.data, c ? c.data : null);
        squads.push({ id: s.id, kind: 'team', name: [r.name, s.data.ageGroup].filter(Boolean).join(' '), club: c ? c.id : '', clubName: c ? c.data.name || '' : '', sport: s.data.sport || '', gender: s.data.gender || '', logo: r.image || '', color: r.primaryColor || '' });
      }
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    return { clubs: clubs.sort(byName), teams: squads.sort(byName) };
  }
  async function item(id) {
    const d = await get(id);
    if (!d || !['club', 'squad'].includes(d.type)) return null;
    const org = await get(d.team);
    if (!org || !org.data.publicMatches) return null;
    if (d.type === 'club') return { id: d.id, kind: 'club', team: d.team, name: d.data.name || '', logo: d.data.image || '', color: d.data.primaryColor || '', company: org.data.name || '' };
    const c = await get(d.data.club), r = Schema.resolveSquad(d.data, c ? c.data : null);
    return { id: d.id, kind: 'team', team: d.team, name: [r.name, d.data.ageGroup].filter(Boolean).join(' '), club: c ? c.id : '', clubName: c ? c.data.name || '' : '', sport: d.data.sport || '', logo: r.image || '', color: r.primaryColor || '', company: org.data.name || '' };
  }
  // a club's or team's page: who it is, its teams (a club), and its matches
  async function page(id, matches) {
    const it = await item(id);
    if (!it) return null;
    let squadIds = [id];
    if (it.kind === 'club') {
      const teams = (await app.store.list(it.team, 'squad')).filter((d) => !d.deleted && d.data.club === id && !d.data.archived);
      squadIds = teams.map((d) => d.id);
      it.teams = await Promise.all(teams.map((d) => item(d.id)));
      it.teams = it.teams.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    }
    const ids = new Set(squadIds);
    const mine = matches.filter((m) => (m.teamIds || []).some((x) => ids.has(x)));
    const today = new Date().toISOString().slice(0, 10);
    it.matches = {
      live: mine.filter((m) => m.status === 'Live'),
      upcoming: mine.filter((m) => m.status !== 'Live' && m.date >= today && !['Completed', 'Cancelled'].includes(m.status)).sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time))).slice(0, 20),
      results: mine.filter((m) => m.status === 'Completed' || (m.date < today && m.score)).sort((a, b) => String(b.date + b.time).localeCompare(String(a.date + a.time))).slice(0, 20) };
    it.followers = (await app.store.listType('user')).filter((u) => !u.deleted && (u.data.follows || []).some((f) => f && f.id === id)).length;
    return it;
  }

  // ---- a fan's follows
  const followsOf = (u) => (u && Array.isArray(u.data.follows) ? u.data.follows.filter((f) => f && f.id) : []);
  async function list(user) {
    const out = [];
    for (const f of followsOf(user)) { const it = await item(f.id); if (it) out.push({ ...it, ...cleanFollow(f) }); }
    return out;
  }
  // follow / unfollow / change: alerts, live (as it happens, or only in the digest), digest, scoreRate
  async function set(user, id, { follow = true, alerts, live, digest, scoreRate } = {}) {
    const it = await item(id);
    if (!it) throw Object.assign(new Error('That team is not on the website'), { status: 404 });
    let fs = followsOf(user).filter((f) => f.id !== id);
    const cur = followsOf(user).find((f) => f.id === id) || {};
    if (follow) fs = [...fs, cleanFollow({ id, alerts: alerts || cur.alerts, live: live !== undefined ? live : cur.live, digest: digest !== undefined ? digest : cur.digest, scoreRate: scoreRate || cur.scoreRate, at: cur.at || Date.now() })].slice(-100);
    await app.save('', 'user', user.id, { ...user.data, follows: fs }, user.id);
    return { following: !!follow, follows: fs.map(cleanFollow) };
  }
  const prefsOf = (u) => cleanPrefs((u && u.data.followPrefs) || {});
  async function setPrefs(user, p) {
    const next = cleanPrefs({ ...prefsOf(user), ...(p || {}) });
    await app.save('', 'user', user.id, { ...user.data, followPrefs: next }, user.id);
    return next;
  }
  // a match the fan does not want to hear about (any more), whoever they follow
  const mutedOf = (u) => (u && Array.isArray(u.data.mutedMatches) ? u.data.mutedMatches : []);
  async function mute(user, fixture, on = true) {
    const list = mutedOf(user).filter((x) => x !== fixture);
    const next = on ? [...list, fixture].slice(-200) : list;
    await app.save('', 'user', user.id, { ...user.data, mutedMatches: next }, user.id);
    return { muted: !!on };
  }

  // ---- match updates
  // fans of a match, per kind of alert: those who follow either team, or the club of either team
  // who follows a match (either team, or the club of either team), with the combined choice of their follows:
  // [{ user, alerts, scoreRate }] — live updates only (not muted, not paused, not digest-only)
  async function fansOf(f) {
    const ids = new Set();
    for (const sid of [f.data.team1, f.data.team2]) { if (!sid) continue; ids.add(sid); const s = await get(sid); if (s && s.data.club) ids.add(s.data.club); }
    if (!ids.size) return [];
    const order = SCORE_RATES.map((r) => r[0]), out = [];
    for (const u of await app.store.listType('user')) {
      if (u.deleted || mutedOf(u).includes(f.id) || prefsOf(u).pausedUntil > Date.now()) continue;
      const mine = followsOf(u).map(cleanFollow).filter((x) => ids.has(x.id) && x.live);
      if (!mine.length) continue;
      const alerts = {}; for (const [k] of ALERTS) alerts[k] = mine.some((x) => x.alerts[k]);
      const scoreRate = mine.map((x) => x.scoreRate).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
      out.push({ user: u, alerts, scoreRate });
    }
    return out;
  }
  const lastScore = new Map();          // user:fixture → when they last heard a score (for "at most every N minutes")
  const busy = new Map(), timers = new Map();
  function onDoc(d) {
    if (app.isLocal || d.type !== 'fixture' || d.deleted || !d.data || !d.data.live) return;
    clearTimeout(timers.get(d.id));
    timers.set(d.id, setTimeout(() => { timers.delete(d.id); run(d.id).catch((e) => log('Match updates:', e.message)); }, Number((app.config.push || {}).alertDelayMs) || 1500));
  }
  async function run(fid) {
    if (busy.get(fid)) { busy.set(fid, 'again'); return; }
    busy.set(fid, true);
    try { await check(fid); } finally { const again = busy.get(fid) === 'again'; busy.delete(fid); if (again) await run(fid); }
  }
  // what a match looks like now, as the things fans are told about
  function facts(f) {
    const live = f.data.live, out = { kind: '', phase: 'pre', events: [], lineups: [], score: '', teams: ['', ''], status: '' };
    if (live.kind === 'sport' && live.setup && live.setup.sport) {
      const v = Sports.compute(live.setup, live.events || []);
      out.kind = 'timed'; out.phase = (v.extra && v.extra.phase) || (v.finished ? 'final' : (live.events || []).length ? 'live' : 'pre');
      out.teams = [v.teams.A.name, v.teams.B.name]; out.score = `${v.teams.A.name} ${v.score.A} – ${v.score.B} ${v.teams.B.name}`;
      { const a = Number(v.score.A) || 0, b = Number(v.score.B) || 0; out.lead = a > b ? 'A' : b > a ? 'B' : 'level'; } out.period = v.periodLabel || ''; out.status = v.status || '';
      out.events = (v.timeline || []).filter((t) => t.id && (t.kind === 'score' || (t.kind === 'card' && /^red/.test(t.key || t.icon || '')))).map((t) => ({ id: 't' + t.id, alert: t.kind === 'score' ? 'scores' : 'big', team: t.team, text: t.text || '', ct: t.ct || '' }));
      for (const k of ['A', 'B']) { const ps = (live.setup.teams[k].players || []).filter((p) => p.lineup === 'start'); if (ps.length) out.lineups.push({ team: v.teams[k].name, names: ps.map((p) => p.tvName || p.name).filter(Boolean) }); }
    } else if (live.kind === 'cricket' && live.match) {
      const m = live.match, s = Cricket.compute(m);
      out.kind = 'cricket'; out.teams = [m.teamA.name, m.teamB.name]; out.status = s.statusText || '';
      out.phase = s.matchComplete ? 'final' : s.innings.some((i) => i.ballCount > 0) ? 'live' : 'pre';
      const cur = s.innings[s.currentIndex];
      out.score = cur ? `${cur.battingTeamName} ${cur.score} (${cur.overs} ov)` : '';
      for (const i of s.innings) {
        const tag = `${i.battingTeamName} ${i.score} (${i.overs} ov)`;
        for (const w of i.fow) out.events.push({ id: `w${i.number}:${w.wicket}`, alert: 'scores', title: `Wicket! ${i.battingTeamName} ${w.score}/${w.wicket}`, text: `${w.name} out for ${w.playerRuns} · ${w.over} ov` });
        for (const b of i.batting) for (const n of [50, 100, 150, 200]) if (b.runs >= n) out.events.push({ id: `m${i.number}:${b.playerId}:${n}`, alert: 'big', title: `${n === 50 ? 'Fifty' : n === 100 ? 'Hundred' : n} for ${b.tvName || b.name}`, text: `${b.runs} off ${b.balls} · ${tag}` });
        if (i.complete && !s.matchComplete) out.events.push({ id: `i${i.number}`, alert: 'breaks', title: `End of the innings: ${i.battingTeamName} ${i.score}`, text: `${i.overs} overs` });
      }
      for (const t of [m.teamA, m.teamB]) { const ps = (t.players || []).filter((p) => !p.reserve); if (ps.length >= 2) out.lineups.push({ team: t.name, names: ps.map((p) => p.tvName || p.name).filter(Boolean) }); }
    }
    return out;
  }
  async function check(fid) {
    const f = await get(fid);
    if (!f || !f.data.live) return;
    if (!app.matchcentre || !(await app.matchcentre.isPublic(f))) return;
    // only matches of now: not one that is being fixed up days later
    if (f.data.startDate && Date.parse(f.data.startDate + 'T00:00:00Z') < Date.now() - 2 * 86400e3) return;
    let x; try { x = facts(f); } catch { return; }
    if (!x.kind) return;
    const key = 'malert:' + fid, was = await app.store.kvGet(key).catch(() => null);
    const now = { phase: x.phase, lead: x.lead || '', seen: x.events.map((e) => e.id).slice(-500), lineups: x.lineups.length > 0 && (was ? was.lineups || x.phase === 'pre' : true), at: Date.now() };
    const name = f.data.name || f.data.autoName || x.teams.join(' v '), url = site() + '/match/' + encodeURIComponent(fid);
    const out = [];
    const lineups = () => ({ alert: 'lineups', title: `Line-ups: ${name}`, body: x.lineups.map((l) => `${l.team}: ${l.names.slice(0, 15).join(', ')}`).join(' · ').slice(0, 280), tag: 'lu:' + fid });
    if (!was) {                                   // first time seen: nothing has happened for fans yet, except a line-up before the start
      await app.store.kvSet(key, now);
      if (x.phase === 'pre' && x.lineups.length) return tell(f, [lineups()], url);
      return;
    }
    if (!was.lineups && now.lineups && x.phase === 'pre') out.push(lineups());
    if (was.phase === 'pre' && x.phase !== 'pre') out.push({ alert: 'start', title: x.kind === 'cricket' ? `Under way: ${name}` : `Kick-off: ${name}`, body: x.kind === 'cricket' ? x.status : x.period || 'The match has started', tag: 'ko:' + fid });
    const seen = new Set(was.seen || []);
    for (const e of x.events.filter((ev) => !seen.has(ev.id)).slice(-4)) {
      if (x.kind === 'timed') out.push({ leadChange: e.alert !== 'scores' || (x.lead || '') !== (was.lead || 'level'), alert: e.alert, title: `${cap((e.text.split(/\s+[–-]\s+/)[0] || 'Score').replace(/\s*\([^)]*\)/g, ''))}${e.team ? ' – ' + x.teams[e.team === 'A' ? 0 : 1] : ''}`, body: `${x.score}${e.ct ? ' · ' + e.ct : ''}${/[–-]\s+/.test(e.text) ? ' · ' + cap(e.text.split(/\s+[–-]\s+/).slice(1).join(' ')) : ''}`, tag: `ev:${fid}:${e.id}` });
      else out.push({ alert: e.alert, title: e.title, body: `${e.text}${x.score && e.alert !== 'breaks' ? ' · ' + x.score : ''}`, tag: `ev:${fid}:${e.id}` });
    }
    if (x.kind === 'timed' && was.phase === 'live' && x.phase === 'break') out.push({ alert: 'breaks', title: `${cap(x.period || 'Half time')}: ${x.score}`, body: name, tag: `br:${fid}:${Math.floor(Date.now() / 60000)}` });
    if (x.kind === 'timed' && was.phase === 'break' && x.phase === 'live') out.push({ alert: 'breaks', title: `Back under way: ${name}`, body: `${cap(x.period)} · ${x.score}`, tag: `rs:${fid}:${Math.floor(Date.now() / 60000)}` });
    if (was.phase !== 'final' && x.phase === 'final') out.push({ alert: 'breaks', title: x.kind === 'cricket' ? `Result: ${name}` : `Full time: ${x.score}`, body: x.kind === 'cricket' ? x.status : x.status || name, tag: 'ft:' + fid });
    await app.store.kvSet(key, now);
    return tell(f, out, url);
  }
  async function tell(f, out, url) {
    if (!out.length || !app.push) return;
    const fans = await fansOf(f);
    // several scores at once: one message per fan who wants them less often (the latest score says it all)
    for (const n of out) {
      const to = fans.filter((x) => {
        if (!x.alerts[n.alert]) return false;
        if (n.alert !== 'scores') return true;
        if (x.scoreRate === 'every') return true;
        if (x.scoreRate === 'lead') return n.leadChange !== false;
        const k = x.user.id + ':' + f.id, mins = Number(x.scoreRate) || 0, last = lastScore.get(k) || 0;
        if (Date.now() - last < mins * 60e3) return false;
        lastScore.set(k, Date.now());
        return true;
      }).map((x) => x.user);
      if (lastScore.size > 20000) lastScore.clear();
      if (to.length) await app.push.send(to, { kind: 'team_updates', title: n.title, body: n.body, url, tag: n.tag });
    }
  }

  // ---- score digests: the results, live matches and coming fixtures of the teams a fan follows, at the fan's time
  async function digestFor(user, { since = Date.now() - 7 * 86400e3, days = 7, matches } = {}) {
    const fs = followsOf(user).map(cleanFollow).filter((x) => x.digest);
    if (!fs.length) return null;
    const ids = new Set(fs.map((x) => x.id));
    for (const x of fs) { const d = await get(x.id); if (d && d.type === 'club') for (const sq of (await app.store.list(d.team, 'squad')).filter((q) => !q.deleted && q.data.club === d.id)) ids.add(sq.id); }
    const all = (matches || []).filter((m) => (m.teamIds || []).some((t) => ids.has(t)));
    const today = new Date().toISOString().slice(0, 10), sinceDay = new Date(since).toISOString().slice(0, 10), until = new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);
    const results = all.filter((m) => m.score && (m.status === 'Completed' || m.date < today) && m.date >= sinceDay).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const live = all.filter((m) => m.status === 'Live');
    const coming = all.filter((m) => m.status !== 'Live' && m.status !== 'Completed' && m.date >= today && m.date <= until).sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)));
    return { results, live, coming };
  }
  const line = (m) => `${(m.teams[0] || {}).name || ''} ${m.score || 'v'} ${(m.teams[1] || {}).name || ''}`.replace(/\s+/g, ' ').trim().replace(' | ', ' v ');
  // is it the fan's digest time now (in their time zone), and has this one not gone yet?
  function due(p, last, now = new Date()) {
    if (p.digest === 'off') return false;
    const tz = p.tz || app.config.timezone || 'Africa/Johannesburg';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
    const hm = `${parts.hour}:${parts.minute}`, day = `${parts.year}-${parts.month}-${parts.day}`, wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    if (hm < p.time) return false;                                      // not yet today
    if (last && last.day === day) return false;                         // sent today
    if (p.digest === 'weekly' && wd !== p.day) return false;
    return { day, local: parts };
  }
  async function sendDigest(user, { force } = {}) {
    const p = prefsOf(user), key = 'digest:' + user.id, last = await app.store.kvGet(key).catch(() => null);
    const when = force ? { day: new Date().toISOString().slice(0, 10) } : due(p, last);
    if (!when) return null;
    const span = p.digest === 'weekly' ? 7 : 1;
    const d = await digestFor(user, { since: last && last.at ? Math.max(last.at, Date.now() - span * 86400e3) : Date.now() - span * 86400e3, days: p.digest === 'weekly' ? 7 : 3, matches: app.publicMatches ? await app.publicMatches() : [] });
    await app.store.kvSet(key, { day: when.day, at: Date.now() });
    if (!d || (!d.results.length && !d.live.length && !(p.fixtures && d.coming.length))) return { sent: false, empty: true };
    if (p.digest === 'matchday' && !force && !d.results.some((m) => m.date === when.day) && !d.live.length) return { sent: false, empty: true };
    const parts = [d.results.length ? 'Results: ' + d.results.slice(0, 6).map(line).join(' · ') : '', d.live.length ? 'Live: ' + d.live.map(line).join(' · ') : '', p.fixtures && d.coming.length ? 'Coming up: ' + d.coming.slice(0, 4).map((m) => `${line({ ...m, score: '' })} ${m.date.slice(5)}${m.time ? ' ' + m.time : ''}`).join(' · ') : ''].filter(Boolean);
    const title = d.results.length ? `Your teams: ${d.results.length} result${d.results.length === 1 ? '' : 's'}` : d.live.length ? 'Your teams are playing' : 'Your teams: coming up';
    const url = site() + '/following';
    if (p.push && app.push) await app.push.send([user], { kind: 'team_digest', title, body: parts.join('\n').slice(0, 300), url, tag: `dg:${user.id}:${when.day}` });
    if (p.email && app.mail && app.mail.enabled()) {
      const row = (m) => [m.date, line(m), [m.competition && m.competition.name, m.status === 'Completed' ? 'Full time' : m.status].filter(Boolean).join(' · ')];
      await app.mail.send(user.data.email, { kind: 'digest', subject: title, title, lines: ['The latest for the teams you follow.'],
        sections: [{ heading: 'Results', rows: d.results.slice(0, 20).map(row) }, { heading: 'Live now', rows: d.live.map(row) }, { heading: 'Coming up', rows: p.fixtures ? d.coming.slice(0, 20).map((m) => [`${m.date} ${m.time || ''}`.trim(), line({ ...m, score: '' }), m.venue || '']) : [] }],
        button: url ? { url, label: 'Your teams' } : null, footer: 'You get this because you follow these teams. Change how often under Following.' }).catch(() => {});
    }
    return { sent: true, ...d };
  }
  let digestTimer = null;
  async function digestTick() {
    for (const u of await app.store.listType('user')) {
      if (u.deleted || !(u.data.follows || []).length || !u.data.followPrefs || cleanPrefs(u.data.followPrefs).digest === 'off') continue;
      try { await sendDigest(u); } catch (e) { log('Digest:', e.message); }
    }
  }

  if (!app.isLocal) { app.on('doc', onDoc); digestTimer = setInterval(() => digestTick().catch(() => {}), 60000); digestTimer.unref(); }
  return { ALERTS, SCORE_RATES, DIGESTS, catalog, item, page, list, set, prefsOf, setPrefs, mute, mutedOf, digestFor, sendDigest, digestTick, due, followsOf, check, facts, idle: async () => { while (timers.size || busy.size) await new Promise((r) => setTimeout(r, 30)); } };
}

module.exports = { makeFollows, ALERTS, SCORE_RATES, DIGESTS, cleanPrefs };
