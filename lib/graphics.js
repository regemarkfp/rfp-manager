'use strict';
// Graphics playout: builds flat key/value data for each graphic, sends it to CasparCG (CG ADD / UPDATE / STOP),
// mirrors it to the browser outputs, keeps live graphics up to date as the score changes, and runs adverts.
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const Schema = require('../shared/schema');
const Scoring = require('../shared/scoring');
const { Amcp, cmd } = require('./amcp');
const { stable, detId, log, fail } = require('./util');

const SIDE = { k: 'side', l: 'Team', t: 'side' };
const CATALOG = [
  { id: 'scorebug', name: 'Score bug', group: 'Match', template: 'bug', layer: 20, live: true, fixture: true },
  { id: 'score_lt', name: 'Score update', group: 'Match', template: 'lowerthird', layer: 21, live: true, fixture: true },
  { id: 'last_event_lt', name: 'Last event', group: 'Match', template: 'lowerthird', layer: 21, fixture: true },
  { id: 'player_lt', name: 'Player', group: 'Match', template: 'lowerthird', layer: 21, fixture: true, params: [{ k: 'player', l: 'Player', t: 'player' }] },
  { id: 'venue_lt', name: 'Venue', group: 'Match', template: 'lowerthird', layer: 21, fixture: true },
  { id: 'match_ident', name: 'Match ident', group: 'Full screen', template: 'fullframe', layer: 22, live: true, fixture: true },
  { id: 'summary', name: 'Match summary', group: 'Full screen', template: 'fullframe', layer: 22, live: true, fixture: true },
  { id: 'lineup', name: 'Team line-up', group: 'Full screen', template: 'fullframe', layer: 22, fixture: true, params: [SIDE] },
  { id: 'standings', name: 'Log table', group: 'Full screen', template: 'fullframe', layer: 22, fixture: true },
  { id: 'fixtures_fs', name: 'Fixtures & results', group: 'Full screen', template: 'fullframe', layer: 22, fixture: true },
  { id: 'name_lt', name: 'Name super', group: 'Captions', template: 'lowerthird', layer: 21, params: [{ k: 'line1', l: 'Line 1', t: 'text' }, { k: 'line2', l: 'Line 2', t: 'text' }, { k: 'image', l: 'Image', t: 'hidden' }] },
  { id: 'title_fs', name: 'Full screen text', group: 'Captions', template: 'fullframe', layer: 22, params: [{ k: 'title', l: 'Title', t: 'text' }, { k: 'body', l: 'Text', t: 'textarea' }] },
  { id: 'countdown', name: 'Countdown', group: 'Captions', template: 'bug', layer: 23, params: [{ k: 'label', l: 'Label', t: 'text', ph: 'We start in' }, { k: 'time', l: 'Counts down to (HH:MM)', t: 'time' }] },
  { id: 'advert', name: 'Advert', group: 'Advertising', template: 'advert', layer: 30, params: [{ k: 'advert', l: 'Advert', t: 'advert' }] },
];
const AD_LAYER = 30;

function makeGraphics(app) {
  const amcp = new Amcp(() => app.config.caspar);
  const onAir = new Map();
  let fixtureId = null, playlist = null, adTimer = null, refreshTimer = null;
  const listeners = new Set();

  const doc = (id) => { const d = id && app.cache.get(id); return d && !d.deleted ? d : null; };
  const get = (id) => { const d = doc(id); return d ? d.data : null; };
  const list = (team, type) => [...app.cache.values()].filter((d) => !d.deleted && d.team === team && d.type === type);
  const img = (id) => (id ? 'img:' + id : '');
  const niceDate = (iso) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || ''; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };
  const name = (f) => f.name || f.autoName || 'Match';

  function teamsOf(f) {
    if (f.live && f.live.meta.teams) return f.live.meta.teams;
    return [Schema.snapshotTeam(get, f.team1, 'Home'), Schema.snapshotTeam(get, f.team2, 'Away')];
  }

  function table(o, title, subtitle, headers, rows) {
    Object.assign(o, { layout: 'table', title, subtitle, cols: String(headers.length), rows: String(rows.length) });
    headers.forEach((h, i) => { o['h' + (i + 1)] = h; });
    rows.forEach((r, i) => {
      r.cells.forEach((c, j) => { o[`r${i + 1}_c${j + 1}`] = String(c === undefined || c === null ? '' : c); });
      o[`r${i + 1}_logo`] = img(r.logo); o[`r${i + 1}_hl`] = r.hl ? '1' : '';
    });
  }

  function common(team, fx, now) {
    const org = get(team) || {};
    const o = { org_name: org.name || '', accent: org.accentColor || '#00ff82', color1: '#101010', color2: '#262626', kind: '' };
    if (!fx) return { o, view: null, teams: [] };
    const f = fx.data, comp = get(f.competition) || {}, venue = get(f.venue) || {};
    const teams = teamsOf(f);
    Object.assign(o, { competition: comp.name || '', season: comp.season || '', competition_logo: img(comp.logo), color1: comp.primaryColor || o.color1, color2: comp.secondaryColor || o.color2,
      venue: venue.name || '', venue_city: [venue.city, venue.country].filter(Boolean).join(', '), sport: f.sport || '', match_name: name(f), date: niceDate(f.startDate), time: f.startTime || '' });
    ['A', 'B'].forEach((L, i) => {
      const t = teams[i] || {};
      Object.assign(o, { [`team${L}_name`]: t.name || '', [`team${L}_full`]: t.full || t.name || '', [`team${L}_short`]: t.short || '', [`team${L}_color1`]: t.color1 || '#ffffff', [`team${L}_color2`]: t.color2 || '#262626', [`team${L}_logo`]: img(t.logo) });
    });
    const view = f.live ? Scoring.compute(f.live, now) : null;
    if (!view) return { o: Object.assign(o, { scoreA: '0', scoreB: '0', score_line: '0 - 0', period_text: f.status || 'Upcoming', status_text: f.startTime ? 'Starts ' + f.startTime : '', state: 'pre', clock_show: '' }), view, teams, f, comp, venue };
    Object.assign(o, { kind: view.kind, scoreA: String(view.score[0]), scoreB: String(view.score[1]), score_line: `${view.score[0]} - ${view.score[1]}`, period_text: view.periodText,
      status_text: view.statusText || view.periodText, state: view.state, last_text: view.last || '' });
    if (view.kind === 'timed') {
      const c = f.live.ctl;
      Object.assign(o, { clock_show: '1', clock_ms: String(Math.round(view.clockMs)), clock_running: view.running ? '1' : '', clock_dir: view.clockDir, clock_text: view.clockText,
        clock_sig: [c.period, c.baseMs, c.startedAt, c.running ? 1 : 0, c.state].join('|'),
        sinbinsA: String(view.sinbins.filter((s) => s.side === 0).length || ''), sinbinsB: String(view.sinbins.filter((s) => s.side === 1).length || '') });
    } else if (view.kind === 'sets') {
      const S = view.sets, cur = S.done ? null : S.tennis !== false && view.def.tennis ? S.games : S.pt;
      Object.assign(o, { setsA: String(S.setsWon[0]), setsB: String(S.setsWon[1]), pointsA: S.pointText[0], pointsB: S.pointText[1], gamesA: String(S.games[0]), gamesB: String(S.games[1]),
        serverA: !S.done && S.server === 0 ? '1' : '', serverB: !S.done && S.server === 1 ? '1' : '', flag: S.flag, tennis: view.def.tennis ? '1' : '', set_count: String(S.sets.length + (cur ? 1 : 0)) });
      [...S.sets, ...(cur ? [cur] : [])].forEach((s, i) => { o[`set${i + 1}A`] = String(s[0]); o[`set${i + 1}B`] = String(s[1]); });
    } else if (view.kind === 'cricket') {
      const C = view.cricket, cur = C.current;
      Object.assign(o, { bat_short: (teams[C.batting] || {}).short || '', bat_name: (teams[C.batting] || {}).name || '', bat_score: cur ? `${cur.runs}/${cur.wkts}` : '0/0', overs: cur ? cur.overs : '0.0', crr: C.crr,
        target: C.target ? String(C.target) : '', this_over: cur ? cur.over.join(' ') : '', need_text: view.statusText, scoreA: C.text[0] || '', scoreB: C.text[1] || '', score_line: `${C.text[0] || '-'} | ${C.text[1] || '-'}` });
    }
    return { o, view, teams, f, comp, venue };
  }

  const scorerText = (list) => list.map((s) => `${s.name} ${s.items.map((i) => i.min + "'").join(', ')}`).join('\n');

  const BUILD = {
    scorebug: ({ o }) => Object.assign(o, { layout: 'score' }),
    score_lt: ({ o, view }) => Object.assign(o, { line1: `${o.teamA_name}  ${o.scoreA} – ${o.scoreB}  ${o.teamB_name}`, line2: [o.competition, view ? o.status_text : o.period_text].filter(Boolean).join(' · ') }),
    last_event_lt: ({ o }) => Object.assign(o, { line1: o.last_text || o.match_name, line2: `${o.teamA_short} ${o.scoreA} – ${o.scoreB} ${o.teamB_short}` }),
    venue_lt: ({ o }) => Object.assign(o, { line1: o.venue || 'Venue', line2: o.venue_city }),
    match_ident: ({ o }) => Object.assign(o, { layout: 'ident', title: o.competition || o.match_name, subtitle: [o.date, o.time].filter(Boolean).join(' · ') }),
    summary: ({ o, view }) => Object.assign(o, { layout: 'summary', title: o.competition || o.match_name, subtitle: o.period_text,
      scorersA: view && view.scorers ? scorerText(view.scorers[0]) : '', scorersB: view && view.scorers ? scorerText(view.scorers[1]) : '',
      periods_text: view && view.periodScores ? view.periodScores.map((p, i) => `${Scoring.ord(i + 1)}: ${p[0]}-${p[1]}`).join('   ') : '' }),
    lineup: ({ o, teams }, p) => {
      const i = Number(p.side) === 1 ? 1 : 0, t = teams[i] || { players: [] };
      table(o, t.full || t.name, t.coach ? 'Coach: ' + t.coach : 'Line-up', ['', '', ''], t.players.map((pl) => ({ cells: [pl.number, pl.name + (pl.captain ? ' (c)' : ''), pl.position] })));
      return Object.assign(o, { noheader: '1', logo: img(t.logo), team_color: t.color1 || '' });
    },
    player_lt: ({ o, teams, view }, p) => {
      const [si, pid] = String(p.player || '').split(':');
      const t = teams[Number(si)] || { players: [] }, pl = t.players.find((x) => x.id === pid);
      if (!pl) fail(400, 'Pick a player');
      const mine = view ? view.log.filter((e) => e.pid === pid && (e.k === 'score' || e.k === 'event')) : [];
      const counts = {};
      for (const e of mine) counts[e.label] = (counts[e.label] || 0) + 1;
      const stats = Object.entries(counts).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ');
      return Object.assign(o, { line1: `${pl.number ? pl.number + '  ' : ''}${pl.name}`, line2: [t.full || t.name, pl.position, stats].filter(Boolean).join(' · '), logo: img(t.logo), photo: img(pl.image), team_color: t.color1 || '' });
    },
    standings: ({ o, f, comp }, p, team) => {
      const fx = list(team, 'fixture').map((d) => d.data).filter((x) => x.competition && x.competition === f.competition);
      const rows = Scoring.standings(fx, { win: comp.pointsWin === undefined || comp.pointsWin === '' ? 3 : Number(comp.pointsWin), draw: comp.pointsDraw === undefined || comp.pointsDraw === '' ? 1 : Number(comp.pointsDraw), loss: Number(comp.pointsLoss) || 0 });
      table(o, o.competition || 'Log', [comp.season, 'Log'].filter(Boolean).join(' · '), ['', 'Team', 'P', 'W', 'D', 'L', '+/-', 'Pts'],
        rows.slice(0, 12).map((r, i) => ({ cells: [i + 1, r.name, r.P, r.W, r.D, r.L, r.PD > 0 ? '+' + r.PD : r.PD, r.Pts], hl: r.id === f.team1 || r.id === f.team2 })));
      return Object.assign(o, { logo: o.competition_logo });
    },
    fixtures_fs: ({ o, f }, p, team, fx, now) => {
      const all = list(team, 'fixture').filter((d) => (f.competition ? d.data.competition === f.competition : d.data.startDate === f.startDate))
        .sort((a, b) => String(a.data.startDate + a.data.startTime).localeCompare(String(b.data.startDate + b.data.startTime)));
      const sameDay = all.filter((d) => d.data.startDate === f.startDate);
      const use = (sameDay.length > 1 ? sameDay : all).slice(0, 10);
      table(o, o.competition || 'Fixtures', sameDay.length > 1 ? o.date : 'Fixtures & Results', ['', '', ''], use.map((d) => {
        const t = teamsOf(d.data), v = d.data.live ? Scoring.compute(d.data.live, now) : null;
        const mid = v && d.data.status !== 'Upcoming' ? (v.kind === 'cricket' ? `${v.cricket.text[0] || '-'} | ${v.cricket.text[1] || '-'}` : `${v.score[0]} - ${v.score[1]}`) : (d.data.startTime || 'vs');
        return { cells: [t[0].name, mid, t[1].name], hl: d.id === fx.id };
      }));
      return Object.assign(o, { noheader: '1', center: '1', logo: o.competition_logo });
    },
    name_lt: ({ o }, p) => Object.assign(o, { line1: p.line1 || '', line2: p.line2 || '', photo: img(p.image) }),
    title_fs: ({ o }, p) => Object.assign(o, { layout: 'title', title: p.title || '', body: p.body || '' }),
    countdown: ({ o }, p, team, fx, now) => {
      let target = 0;
      const m = /^(\d{1,2}):(\d{2})$/.exec(p.time || '');
      if (m) { const d = new Date(now); d.setHours(Number(m[1]), Number(m[2]), 0, 0); if (d.getTime() < now - 12 * 3600000) d.setDate(d.getDate() + 1); target = d.getTime(); }
      return Object.assign(o, { layout: 'countdown', label: p.label || 'Starting in', countdown_ms: String(Math.max(0, target - now)), countdown_sig: String(target), target_text: p.time || '' });
    },
    advert: ({ o }, p) => {
      const a = get(p.advert);
      if (!a) fail(400, 'Pick an advert');
      return Object.assign(o, { layout: ({ 'Full screen': 'full', 'Lower banner': 'lower', 'Corner bug': 'bug', 'Side panel': 'side' })[a.layout] || 'full', image: img(a.image), sponsor: a.sponsor || '', name: a.name || '', text: a.text || '', clip: '' });
    },
  };

  function folderFor(team, fx) {
    const comp = fx && get(fx.data.competition), theme = comp && get(comp.theme);
    const org = get(team) || {};
    const f = (theme && theme.templateFolder) || org.templateFolder || app.config.caspar.templateFolder || 'rfp';
    return String(f).replace(/[^\w/-]/g, '') || 'rfp';
  }

  function build(id, team, params, overrides, now = Date.now()) {
    const g = CATALOG.find((x) => x.id === id);
    if (!g) fail(404, 'Unknown graphic');
    const fx = doc(fixtureId);
    if (g.fixture && !fx) fail(400, 'Choose a match first');
    const useTeam = g.fixture ? fx.team : team;
    if (!useTeam || !get(useTeam)) fail(400, 'Choose a production team');
    const ctx = common(useTeam, g.fixture || (fx && fx.team === team) ? fx : null, now);
    const data = BUILD[id](ctx, params || {}, useTeam, fx, now);
    data.graphic_id = id;
    for (const [k, v] of Object.entries(overrides || {})) if (/^\w+$/.test(k) && v !== undefined && v !== null) data[k] = String(v);
    for (const k of Object.keys(data)) data[k] = data[k] === undefined || data[k] === null ? '' : String(data[k]);
    return { g, data, team: useTeam, template: folderFor(useTeam, fx) + '/' + g.template };
  }

  function resolve(data, mode) {
    const out = {};
    const c = app.config.caspar || {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v !== 'string' || !v.startsWith('img:')) { out[k] = v; continue; }
      const id = v.slice(4), d = doc(id);
      if (!d) { out[k] = ''; continue; }
      if (mode === 'web') { out[k] = '/media/' + id; continue; }
      const p = c.images === 'http' ? null : app.blobs.localPath(d);
      out[k] = p && fs.existsSync(p) ? pathToFileURL(p).href : `${c.httpBase || 'http://127.0.0.1:' + app.config.port}/media/${id}`;
    }
    return out;
  }

  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function encode(data) {
    if ((app.config.caspar || {}).format === 'xml') {
      return '<templateData>' + Object.entries(data).map(([k, v]) => `<componentData id="${xmlEsc(k)}"><data id="text" value="${xmlEsc(v)}"/></componentData>`).join('') + '</templateData>';
    }
    return JSON.stringify(data);
  }
  const sig = (data) => stable({ ...data, clock_ms: '', clock_text: '', countdown_ms: '' });
  const ch = () => Number((app.config.caspar || {}).channel) || 1;

  async function caspar(command) {
    if (!amcp.enabled) return;
    try { await amcp.send(command); } catch (e) { emit({ type: 'gfx-warn', text: e.message }); }
  }
  function emit(msg) { for (const fn of listeners) { try { fn(msg); } catch { /* ignore */ } } }
  const changed = () => emit({ type: 'gfx-state', state: state() });

  async function take({ id, team, params, overrides }) {
    const b = build(id, team, params, overrides);
    const entry = { id, name: b.g.name, layer: b.g.layer, template: b.template, team: b.team, params: params || {}, overrides: overrides || {}, data: b.data, live: !!b.g.live, since: Date.now() };
    const prev = onAir.get(entry.layer);
    if (prev && prev.clip) await caspar(cmd.stop(ch(), entry.layer));
    if (entry.layer === AD_LAYER && !playlist) clearTimeout(adTimer);
    onAir.set(entry.layer, entry);
    await caspar(cmd.cgAdd(ch(), entry.layer, entry.template, encode(resolve(entry.data, 'caspar'))));
    emit({ type: 'gfx', op: 'add', layer: entry.layer, template: entry.template, data: resolve(entry.data, 'web') });
    changed();
    return entry;
  }

  async function update({ id, team, params, overrides }) {
    const g = CATALOG.find((x) => x.id === id);
    const entry = g && onAir.get(g.layer);
    if (!entry || entry.id !== id) return take({ id, team, params, overrides });
    const b = build(id, team || entry.team, params || entry.params, overrides || entry.overrides);
    Object.assign(entry, { params: params || entry.params, overrides: overrides || entry.overrides, data: b.data });
    await caspar(cmd.cgUpdate(ch(), entry.layer, encode(resolve(entry.data, 'caspar'))));
    emit({ type: 'gfx', op: 'update', layer: entry.layer, data: resolve(entry.data, 'web') });
    changed();
    return entry;
  }

  async function out(layer, { keepPlaylist } = {}) {
    layer = Number(layer);
    const entry = onAir.get(layer);
    if (layer === AD_LAYER && !keepPlaylist) { playlist = null; clearTimeout(adTimer); }
    if (!entry) { changed(); return; }
    onAir.delete(layer);
    await caspar(entry.clip ? cmd.stop(ch(), layer) : cmd.cgStop(ch(), layer));
    emit({ type: 'gfx', op: 'stop', layer });
    changed();
  }

  async function clearAll() {
    playlist = null; clearTimeout(adTimer);
    onAir.clear();
    await caspar(cmd.clear(ch()));
    emit({ type: 'gfx', op: 'clear' });
    changed();
  }

  // Live graphics follow the data: when a score, clock or team record changes, on-air graphics get a CG UPDATE.
  async function refresh() {
    for (const entry of [...onAir.values()]) {
      if (!entry.live) continue;
      let b;
      try { b = build(entry.id, entry.team, entry.params, entry.overrides); } catch { continue; }
      if (sig(b.data) === sig(entry.data)) continue;
      entry.data = b.data;
      await caspar(cmd.cgUpdate(ch(), entry.layer, encode(resolve(entry.data, 'caspar'))));
      emit({ type: 'gfx', op: 'update', layer: entry.layer, data: resolve(entry.data, 'web') });
    }
  }
  app.on('doc', () => { if (!onAir.size) return; clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh().catch((e) => log('Graphics refresh:', e.message)), 40); });

  // ---- adverts --------------------------------------------------------------------------------
  async function logPlay(team, advertId, a, seconds) {
    const date = new Date().toLocaleDateString('en-CA');
    const id = detId('adlog_', team, date, app.config.machineId || '');
    const cur = app.cache.get(id);
    const entries = [...((cur && !cur.deleted && cur.data.entries) || []), { advert: advertId, name: a.name || '', sponsor: a.sponsor || '', at: Date.now(), seconds }].slice(-2000);
    await app.save(team, 'adlog', id, { date, machine: app.config.machineName || '', entries }, '');
  }

  async function playAdvert(team, advertId, { hold, seconds } = {}) {
    const a = get(advertId), d = doc(advertId);
    if (!a) fail(404, 'Advert not found');
    const secs = Math.max(1, Number(seconds) || Number(a.duration) || 10);
    clearTimeout(adTimer);
    if (a.kind === 'CasparCG clip' && a.clip) {
      const entry = { id: 'advert', name: 'Ad: ' + a.name, layer: AD_LAYER, template: '', team: d.team, params: { advert: advertId }, overrides: {}, data: {}, live: false, since: Date.now(), clip: a.clip };
      onAir.set(AD_LAYER, entry);
      await caspar(cmd.play(ch(), AD_LAYER, a.clip));
      emit({ type: 'gfx', op: 'add', layer: AD_LAYER, template: folderFor(d.team, null) + '/advert', data: { layout: 'clip', name: a.name || '', sponsor: a.sponsor || '', clip: a.clip, accent: (get(d.team) || {}).accentColor || '#00ff82' } });
      changed();
    } else {
      const entry = await take({ id: 'advert', team: d.team, params: { advert: advertId } });
      entry.name = 'Ad: ' + a.name;
      changed();
    }
    await logPlay(d.team, advertId, a, secs);
    if (playlist) adTimer = setTimeout(() => nextAd().catch((e) => log('Ad playlist:', e.message)), secs * 1000);
    else if (!hold) adTimer = setTimeout(() => out(AD_LAYER).catch(() => {}), secs * 1000);
  }

  async function nextAd() {
    if (!playlist) return;
    const p = get(playlist.id);
    const items = ((p && p.items) || []).filter((i) => get(i.advert));
    if (!items.length) { playlist = null; return out(AD_LAYER); }
    playlist.index++;
    if (playlist.index >= items.length) {
      if (!p.loop) { playlist = null; return out(AD_LAYER); }
      playlist.index = 0;
    }
    const it = items[playlist.index];
    await playAdvert(playlist.team, it.advert, { seconds: it.duration });
  }

  async function startPlaylist(team, id) {
    const p = get(id);
    if (!p) fail(404, 'Playlist not found');
    playlist = { id, team, index: -1, name: p.name };
    await nextAd();
  }
  async function stopPlaylist() { playlist = null; clearTimeout(adTimer); await out(AD_LAYER); }

  // ---- state ----------------------------------------------------------------------------------
  function state() {
    return { caspar: amcp.status(), fixtureId, format: (app.config.caspar || {}).format || 'json',
      onAir: [...onAir.values()].sort((a, b) => a.layer - b.layer).map((e) => ({ id: e.id, name: e.name, layer: e.layer, live: e.live, since: e.since, clip: e.clip || '', team: e.team })),
      playlist: playlist ? { ...playlist } : null };
  }
  function snapshot() {
    return [...onAir.values()].map((e) => (e.clip
      ? { type: 'gfx', op: 'add', layer: e.layer, template: folderFor(e.team, null) + '/advert', data: { layout: 'clip', name: e.name, clip: e.clip } }
      : { type: 'gfx', op: 'add', layer: e.layer, template: e.template, data: resolve(e.data, 'web') }));
  }
  function preview(req) {
    const b = build(req.id, req.team, req.params, req.overrides);
    return { template: b.template, data: resolve(b.data, 'web'), layer: b.g.layer };
  }
  async function setFixture(id) {
    const d = id ? doc(id) : null;
    if (id && (!d || d.type !== 'fixture')) fail(404, 'Match not found');
    fixtureId = id || null;
    await app.store.kvSet('gfx:fixture', fixtureId);
    await refresh();
    changed();
  }

  async function start() {
    fixtureId = (await app.store.kvGet('gfx:fixture')) || null;
    if (fixtureId && !doc(fixtureId)) fixtureId = null;
    amcp.on('state', changed);
    amcp.start();
  }
  function stop() { clearTimeout(adTimer); clearTimeout(refreshTimer); amcp.stop(); }

  return { CATALOG, amcp, start, stop, take, update, out, clearAll, refresh, playAdvert, startPlaylist, stopPlaylist, state, snapshot, preview, setFixture,
    build, resolve, encode, onMessage: (fn) => listeners.add(fn), fixtureTeam: () => { const d = doc(fixtureId); return d ? d.team : null; } };
}

module.exports = { makeGraphics, CATALOG };
