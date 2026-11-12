'use strict';
// Rocket League on the production PC (ported from the RFP "RL Broadcast" controller).
//   Game data from the SOS plugin (BakkesMod, ws://localhost:49122), Psyonix's official Stats API (WebSocket, default
//   ws://localhost:49125 so it does not clash with the RocketLink voice-chat plugin on 49124, or TCP tcp://localhost:49123),
//   or a relay of either on another PC (any ws:// address; the format is recognised by itself). Everything is turned into
//   the SOS shape, so the pages and templates read one format.
//   The graphics are CasparCG templates (templates/rfp/rocket/overlay.html), one layer per graphic (scorebug, boost bars,
//   player card, minimap, goal / GO / overtime / winner moments, replay transitions, post-game); each layer is taken in
//   and out with CG PLAY / CG STOP and reads the fast data (boost, clock, positions) from /rl/ws itself, so CasparCG is not
//   flooded with updates. The same pages work in OBS as browser sources (/rl/overlay …).
//   Game events go to the game triggers (lib/automation.js) and the live values {rl_…} to the graphics triggers.
const net = require('node:net');
const { accept } = require('./ws');
const { quote } = require('./amcp');
const { log, fail } = require('./util');

const DEFAULT_CONTROL = {
  title: 'REGEMARK INVITATIONAL', subtitle: 'Upper Bracket Final', bestOf: 5, series: [0, 0], autoSeries: true, useGameNames: false,
  teams: [{ name: 'Blue Team', tag: 'BLU', color: '#1f7cff', logo: '' }, { name: 'Orange Team', tag: 'ORG', color: '#ff7a1a', logo: '' }],
  show: { scorebug: true, boost: true, player: true, minimap: false, stinger: true, postgame: false, stats: true, transitions: true, banners: true },
  source: 'sos', sosUrl: 'ws://localhost:49122', officialUrl: 'ws://localhost:49125', relayUrl: '',
  theme: {
    accent: '#00ff82', live: '#ff3b3b', panel: '#141414', text: '#f1f1f1', muted: '#aaaaaa', panelOpacity: 92, font: 'Segoe UI', italic: true, angle: 16, film: true, glow: true,
    logo: '', logoSize: 100, logoScorebug: true, logoTransition: true, logoPostgame: true, logoStats: true, stingerSpeed: 100, colors: {},
  },
  caspar: { on: false, channel: 0, layer: 40 },     // channel 0 = the program channel of Graphics control
};
// the CasparCG layers: part of overlay.html, its show switch (none = always loaded: it only shows on game moments)
const PARTS = [
  ['scorebug', 'Scorebug', 'scorebug'], ['boost', 'Boost bars and event icons', 'boost'], ['player', 'Player card and boost meter', 'player'], ['minimap', 'Minimap', 'minimap'],
  ['moments', 'Goal stinger, GO, overtime, winner', ''], ['transition', 'Replay transitions', ''], ['postgame', 'Post-game scoreboard', 'postgame'],
];
// statfeed names → trigger kinds
const FEED = [[/epicsave/, 'epic_save'], [/save/, 'save'], [/hattrick/, 'hat_trick'], [/aerial/, 'aerial_goal'], [/bicycle/, 'bicycle_goal'], [/demo/, 'demo'], [/shot/, 'shot'],
  [/assist/, 'assist'], [/clear/, 'clear'], [/mvp/, 'mvp'], [/savior/, 'savior'], [/playmaker/, 'playmaker'], [/firsttouch/, 'first_touch'], [/longgoal/, 'long_goal'], [/turtle/, 'turtle_goal'], [/pool/, 'pool_shot'], [/backward/, 'backwards_goal']];
const EVENTS = [['goal', 'Goal'], ['assist', 'Assist'], ['shot', 'Shot on goal'], ['save', 'Save'], ['epic_save', 'Epic save'], ['demo', 'Demolition'], ['aerial_goal', 'Aerial goal'],
  ['hat_trick', 'Hat trick'], ['clear', 'Clear ball'], ['kickoff', 'Kick-off (GO)'], ['replay_start', 'Goal replay starts'], ['replay_end', 'Goal replay ends'], ['overtime', 'Overtime starts'],
  ['match_start', 'A game starts'], ['match_end', 'A game ends'], ['series_point', 'Series point (one win from the series)'], ['clock', 'Game clock reaches a time (At: 1:00)'], ['time', 'Time of day (At: 19:30)']];

function deepMerge(a, b) {
  if (Array.isArray(b)) return b.map((v, i) => (v && typeof v === 'object' && a && a[i] && typeof a[i] === 'object' ? deepMerge(a[i], v) : v));
  if (b && typeof b === 'object') {
    const out = { ...(a || {}) };
    for (const k of Object.keys(b)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a && typeof a[k] === 'object' ? deepMerge(a[k], b[k]) : Array.isArray(b[k]) && a && Array.isArray(a[k]) ? deepMerge(a[k], b[k]) : b[k];
    }
    return out;
  }
  return b;
}
// several JSON objects in one frame or TCP read: { complete: [...], rest }
function splitJson(str) {
  const out = []; let depth = 0, start = -1, inStr = false, esc = false, end = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}') { if (--depth === 0 && start >= 0) { out.push(str.slice(start, i + 1)); start = -1; end = i + 1; } }
  }
  return { complete: out, rest: depth > 0 && start >= 0 ? str.slice(start) : str.slice(end).trim().startsWith('{') ? str.slice(end) : '' };
}
const pk = (o, ...keys) => { if (!o || typeof o !== 'object') return undefined; for (const k of keys) { if (o[k] !== undefined) return o[k]; const f = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase()); if (f) return o[f]; } return undefined; };
function deepParse(v) { let n = 0; while (typeof v === 'string' && n++ < 3) { const t = v.trim(); if (!t.startsWith('{') && !t.startsWith('[')) break; try { v = JSON.parse(t); } catch { break; } } return v; }
const pid = (p) => `${pk(p, 'Name') ?? 'Player'}_${pk(p, 'Shortcut') ?? 0}`;
const loc = (l) => (l ? { X: +pk(l, 'X') || 0, Y: +pk(l, 'Y') || 0, Z: +pk(l, 'Z') || 0 } : null);
const who = (p) => (p ? { name: pk(p, 'Name') || '', id: pid(p), teamnum: pk(p, 'TeamNum'), team_num: pk(p, 'TeamNum'), shortcut: pk(p, 'Shortcut') } : {});
const toKmh = (v) => { v = +v || 0; return v > 400 ? Math.round(v * 0.036) : Math.round(v); };   // uu/s → km/h when needed
const clockText = (g) => { const s = Math.max(0, Math.round((g && g.time_seconds) ?? 300)); return (g && g.isOT ? '+' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const secondsOf = (at) => { const m = /^\+?(\d{1,2}):(\d{2})$/.exec(String(at || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : /^\d+$/.test(String(at || '').trim()) ? Number(at) : null; };

function makeRocket(app) {
  const on = app.isLocal || !!(app.config.rocket && app.config.rocket.enabled);   // the game is on this PC's network
  let control = structuredClone(DEFAULT_CONTROL);
  let status = 'disconnected', lastUpdate = null, postgame = null, matchCounted = false, lastGoal = null;
  const clients = new Set();
  let src = null, retry = null, started = false, saveT = null;
  const loaded = app.store.kvGet('rl:control').then((v) => { if (v && typeof v === 'object') control = deepMerge(control, v); control.show.postgame = false; }).catch(() => {});
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => app.store.kvSet('rl:control', control).catch(() => {}), 300); if (saveT.unref) saveT.unref(); };

  // ---------------------------------------------------------------- pages and templates (/rl/ws)
  const send = (c, obj) => { try { c.sock.send(obj); } catch { /* gone */ } };
  function broadcast(obj) { const s = JSON.stringify(obj); for (const c of clients) send(c, s); }
  async function upgrade(req, sock) {
    const user = await app.auth.userFromReq(req).catch(() => null);
    const ws = accept(req, sock); if (!ws) return;
    // CasparCG and OBS read without signing in; changing anything needs a signed-in team member
    const c = { sock: ws, canControl: !!user, user };
    clients.add(c);
    ws.on('close', () => clients.delete(c));
    ws.on('message', (text) => { let m; try { m = JSON.parse(text); } catch { return; } if (!c.canControl) return send(c, { t: 'error', error: 'Sign in to RFP Manager to change the graphics' }); handle(m).catch((e) => send(c, { t: 'error', error: e.message })); });
    send(c, { t: 'hello', control, sos: status, canControl: c.canControl, parts: PARTS.map(([id, label, key]) => ({ id, label, key })) });
    if (lastUpdate) send(c, { t: 'update', d: lastUpdate });
    if (postgame) send(c, { t: 'postgame', d: postgame });
  }
  async function handle(m) {
    await loaded;
    if (m.t === 'control') return patch(m.patch || {});
    if (m.t === 'action') return action(m.name, m);
    return null;
  }

  // ---------------------------------------------------------------- operator changes
  const sourceSig = () => [control.source, control.sosUrl, control.officialUrl, control.relayUrl].join('|');
  function patch(p) {
    const prev = sourceSig(), prevCaspar = JSON.stringify(control.caspar);
    if (p && typeof p === 'object') { delete p.demo; control = deepMerge(control, p); }
    control.bestOf = [1, 3, 5, 7, 9].includes(Number(control.bestOf)) ? Number(control.bestOf) : 5;
    control.series = [0, 1].map((i) => Math.max(0, Math.min(Math.ceil(control.bestOf / 2), Number((control.series || [])[i]) | 0)));
    if (!['sos', 'official', 'relay'].includes(control.source)) control.source = 'sos';
    control.caspar = { on: !!control.caspar.on, channel: Math.max(0, Math.min(99, Number(control.caspar.channel) | 0)), layer: Math.max(1, Math.min(9900, Number(control.caspar.layer) | 0 || 40)) };
    save();
    broadcast({ t: 'control', control });
    if (sourceSig() !== prev) restartSource();
    if (JSON.stringify(control.caspar) !== prevCaspar) casparReset(prevCaspar);
    sync().catch(() => {});
    return control;
  }
  function action(name, m = {}) {
    const team = m.team === 1 || m.team === '1' || m.team === 'B' ? 1 : 0;
    switch (name) {
      case 'testGoal': {
        const players = Object.values((lastUpdate && lastUpdate.players) || {}).filter((p) => p.team === team);
        const s = players[0] || { name: control.teams[team].name, team };
        broadcast({ t: 'ev', e: 'game:goal_scored', d: { scorer: { name: s.name, teamnum: team }, assister: players[1] ? { name: players[1].name } : {}, goalspeed: 87.4 } });
        break;
      }
      case 'testIcons': {
        const ps = Object.values((lastUpdate && lastUpdate.players) || {});
        ['Save', 'Epic Save', 'Shot on Goal', 'Demolition', 'Assist', 'Clear Ball', 'Aerial Goal', 'Save'].forEach((n, i) => { const p = ps[(i * 2 + 1) % (ps.length || 1)]; if (p) setTimeout(() => broadcast({ t: 'ev', e: 'game:statfeed_event', d: { event_name: n, type: n, main_target: { name: p.name, team_num: p.team } } }), i * 350); });
        break;
      }
      case 'testTransition': case 'transition': broadcast({ t: 'ev', e: 'ui:transition', d: {} }); break;
      case 'testOT': case 'overtime': broadcast({ t: 'ev', e: 'ui:ot', d: {} }); break;
      case 'testGo': case 'go': broadcast({ t: 'ev', e: 'ui:go', d: {} }); break;
      case 'testWinner': case 'winner': broadcast({ t: 'ev', e: 'ui:winner', d: { team } }); break;
      case 'swapTeams': control.teams.reverse(); control.series.reverse(); save(); broadcast({ t: 'control', control }); break;
      case 'resetSeries': control.series = [0, 0]; save(); broadcast({ t: 'control', control }); break;
      case 'snapshotPostgame': if (lastUpdate) { postgame = makePostgame(lastUpdate, null); broadcast({ t: 'postgame', d: postgame }); } break;
      case 'fromMatch': fromMatch(); break;
      case 'reload': casparReset(null, true); sync().catch(() => {}); break;
      default: fail(400, 'Unknown action ' + name);
    }
    return { ok: true };
  }
  // the match on air in Graphics control (a Rocket League fixture): its teams' names, short names, colours and logos
  function fromMatch() {
    if (!app.gfx) fail(400, 'Graphics control is not running');
    const v = app.gfx.liveValues();
    if (!v.teamA_name && !v.teamB_name) fail(400, 'Put a match on air first (Graphics control → Production)');
    control.teams = ['A', 'B'].map((k, i) => ({ ...control.teams[i], name: v[`team${k}_name`] || control.teams[i].name, tag: (v[`team${k}_short`] || control.teams[i].tag || '').slice(0, 5), color: /^#[0-9a-f]{6}$/i.test(v[`team${k}_color1`] || '') ? v[`team${k}_color1`] : control.teams[i].color, logo: v[`team${k}_logo`] || control.teams[i].logo }));
    if (v.competition_name || v.tournament) control.title = v.competition_name || v.tournament;
    save(); broadcast({ t: 'control', control });
  }
  const makePostgame = (d, winner) => {
    const g = d.game || {}, teams = g.teams || [];
    const s = [(teams[0] && teams[0].score) ?? 0, (teams[1] && teams[1].score) ?? 0];
    return { players: d.players || {}, teams, score: s, winner: winner ?? (s[0] === s[1] ? null : s[0] > s[1] ? 0 : 1), arena: g.arena, time: Date.now() };
  };

  // ---------------------------------------------------------------- game events → pages, series, triggers
  const AB = (n) => (n === 1 || n === '1' ? 'B' : n === 0 || n === '0' ? 'A' : '');
  function trigger(kind, o = {}) {
    if (!app.automation || !app.gfx) return;
    app.automation.gameEvent({ kind, team: o.team || '', fixtureId: app.gfx.fixtureId || '', text: o.text || '', player: o.player || '', sport: 'rocketleague', seconds: o.seconds }).catch?.(() => {});
  }
  let wasOT = false, lastSec = null, wasReplay = false;
  function onGame(event, data) {
    if (event === 'game:update_state') {
      lastUpdate = data;
      broadcast({ t: 'update', d: data });
      const g = (data && data.game) || {};
      if (g.isOT && !wasOT) trigger('overtime');
      wasOT = !!g.isOT;
      const sec = Math.round(g.time_seconds ?? -1);
      if (sec >= 0 && sec !== lastSec && !g.isReplay) { lastSec = sec; trigger('clock', { seconds: sec, text: clockText(g) }); }
      return;
    }
    if (event === 'game:match_created' || event === 'game:initialized') { if (!matchCounted || event === 'game:match_created') { matchCounted = false; wasOT = false; lastSec = null; } if (event === 'game:match_created') trigger('match_start'); }
    if (event === 'game:match_ended') {
      const winner = data && data.winner_team_num;
      if (lastUpdate) postgame = makePostgame(lastUpdate, winner);
      if (control.autoSeries && !matchCounted && (winner === 0 || winner === 1)) {
        matchCounted = true;
        control.series[winner] = Math.min(Math.ceil(control.bestOf / 2), control.series[winner] + 1);
        save(); broadcast({ t: 'control', control });
        if (control.bestOf > 1 && control.series[winner] === Math.ceil(control.bestOf / 2) - 1) trigger('series_point', { team: AB(winner) });
      }
      if (postgame) broadcast({ t: 'postgame', d: postgame });
      trigger('match_end', { team: AB(winner) });
    }
    broadcast({ t: 'ev', e: event, d: data });
    if (event === 'game:goal_scored') {
      lastGoal = data;
      const s = (data && data.scorer) || {};
      trigger('goal', { team: AB(s.teamnum ?? s.team_num), player: s.name || '', text: `${s.name || ''}${data.goalspeed ? ' · ' + Math.round(data.goalspeed) + ' KM/H' : ''}` });
    } else if (event === 'game:statfeed_event') {
      const n = String((data && (data.event_name || data.type)) || '').toLowerCase().replace(/[\s_]/g, ''), t = (data && data.main_target) || {};
      const f = FEED.find(([re]) => re.test(n));
      if (f && f[1] !== 'goal') trigger(f[1], { team: AB(t.team_num ?? t.teamnum), player: t.name || '', text: data.type || data.event_name || '' });
    } else if (event === 'game:round_started_go') trigger('kickoff');
    else if (event === 'game:replay_start') { wasReplay = true; trigger('replay_start'); }
    else if ((event === 'game:replay_end' || event === 'game:replay_will_end') && wasReplay) { wasReplay = false; trigger('replay_end'); }
  }

  // ---------------------------------------------------------------- the official Stats API → the SOS shape
  let lastBallLoc = null;
  const seen = {};
  const officialReset = () => { lastBallLoc = null; for (const k of Object.keys(seen)) delete seen[k]; };
  function markSeen(p, l, srcName) {
    if (!p || !l) return;
    const id = pid(p), prev = seen[id];
    let yaw = prev ? prev.yaw : null;
    if (prev) { const dx = l.X - prev.X, dy = l.Y - prev.Y; if (Math.hypot(dx, dy) > 150) yaw = Math.atan2(dy, dx) / Math.PI * 32768; }
    seen[id] = { X: l.X, Y: l.Y, Z: l.Z, t: Date.now(), src: srcName, yaw };
  }
  const playersIn = (d) => { const a = deepParse(pk(d, 'Players')); if (Array.isArray(a)) return a; const one = pk(d, 'Player'); return one ? [one] : []; };
  function onOfficial(ev, d) {
    if (!ev) return;
    d = deepParse(d) || {};
    switch (ev) {
      case 'UpdateState': {
        const g = deepParse(pk(d, 'Game')) || {}, players = {};
        for (const p of deepParse(pk(d, 'Players')) || []) {
          const boost = +pk(p, 'Boost') || 0, s = seen[pid(p)];
          players[pid(p)] = {
            name: pk(p, 'Name'), id: pid(p), primaryID: pk(p, 'PrimaryId'), shortcut: pk(p, 'Shortcut'), team: pk(p, 'TeamNum'),
            score: pk(p, 'Score') ?? 0, goals: pk(p, 'Goals') ?? 0, shots: pk(p, 'Shots') ?? 0, assists: pk(p, 'Assists') ?? 0, saves: pk(p, 'Saves') ?? 0,
            touches: pk(p, 'Touches') ?? 0, cartouches: pk(p, 'CarTouches') ?? 0, demos: pk(p, 'Demos') ?? 0,
            hasCar: pk(p, 'bHasCar'), speed: toKmh(pk(p, 'Speed')), boost: boost <= 1 && boost > 0 ? boost * 100 : boost,
            isBoosting: !!pk(p, 'bBoosting'), onGround: pk(p, 'bOnGround'), onWall: !!pk(p, 'bOnWall'), isPowersliding: !!pk(p, 'bPowersliding'),
            isDead: !!pk(p, 'bDemolished'), isSonic: !!pk(p, 'bSupersonic'), attacker: pk(pk(p, 'Attacker'), 'Name') || '',
            ...(s ? { location: { X: s.X, Y: s.Y, Z: s.Z, pitch: 0, roll: 0, yaw: s.yaw ?? (pk(p, 'TeamNum') === 1 ? -16384 : 16384) }, locAge: Date.now() - s.t, locSrc: s.src, locEstimated: true } : {}),
          };
        }
        const tgt = pk(g, 'Target'), ball = pk(g, 'Ball') || {};
        const teams = (deepParse(pk(g, 'Teams')) || []).map((t) => ({ name: pk(t, 'Name'), team_num: pk(t, 'TeamNum'), score: pk(t, 'Score') ?? 0,
          color_primary: String(pk(t, 'ColorPrimary') ?? '').replace('#', ''), color_secondary: String(pk(t, 'ColorSecondary') ?? '').replace('#', '') })).sort((a, b) => (a.team_num ?? 0) - (b.team_num ?? 0));
        onGame('game:update_state', { event: 'gamestate', hasGame: true, source: 'official', players, game: {
          arena: pk(g, 'Arena'), isOT: !!pk(g, 'bOvertime'), isReplay: !!pk(g, 'bReplay'), hasWinner: !!pk(g, 'bHasWinner'), winner: pk(g, 'Winner'),
          time_seconds: pk(g, 'TimeSeconds') ?? 0, hasTarget: !!pk(g, 'bHasTarget'), target: tgt && pk(tgt, 'Name') ? pid(tgt) : '',
          ball: { speed: toKmh(pk(ball, 'Speed')), team: pk(ball, 'TeamNum') ?? 255, location: lastBallLoc, locEstimated: true }, teams } });
        break;
      }
      case 'BallHit': {
        const b = deepParse(pk(d, 'Ball')), l = loc(pk(b, 'Location') || pk(d, 'Location'));
        if (l) { lastBallLoc = l; for (const p of playersIn(d)) markSeen(p, l, 'touch'); }
        onGame('game:ball_hit', { ball: { location: l, pre_hit_speed: toKmh(pk(b, 'PreHitSpeed')), post_hit_speed: toKmh(pk(b, 'PostHitSpeed')) }, players: playersIn(d).map(who) });
        break;
      }
      case 'BoostPickup': { const l = loc(pk(d, 'Location') || pk(deepParse(pk(d, 'Boost')), 'Location') || pk(deepParse(pk(d, 'Pickup')), 'Location')); for (const p of playersIn(d)) markSeen(p, l, 'boost'); break; }
      case 'GoalScored':
        onGame('game:goal_scored', { scorer: who(pk(d, 'Scorer')), assister: who(pk(d, 'Assister')), ball_last_touch: who(pk(d, 'BallLastTouch')), goalspeed: toKmh(pk(d, 'GoalSpeed')), goaltime: pk(d, 'GoalTime'), impact_location: loc(pk(d, 'ImpactLocation')) });
        lastBallLoc = loc(pk(d, 'ImpactLocation')) || lastBallLoc;
        break;
      case 'StatfeedEvent': onGame('game:statfeed_event', { event_name: pk(d, 'EventName'), type: pk(d, 'Type'), main_target: who(pk(d, 'MainTarget')), secondary_target: who(pk(d, 'SecondaryTarget')) }); break;
      case 'GoalReplayStart': onGame('game:replay_start', d); break;
      case 'GoalReplayWillEnd': onGame('game:replay_will_end', d); break;
      case 'GoalReplayEnd': onGame('game:replay_end', d); break;
      case 'MatchCreated': officialReset(); onGame('game:match_created', d); break;
      case 'MatchInitialized': onGame('game:initialized', d); break;
      case 'CountdownBegin': lastBallLoc = { X: 0, Y: 0, Z: 93 }; for (const k of Object.keys(seen)) delete seen[k]; onGame('game:pre_countdown_begin', d); break;
      case 'RoundStarted': onGame('game:round_started_go', d); break;
      case 'MatchEnded': onGame('game:match_ended', { winner_team_num: pk(d, 'WinnerTeamNum') ?? pk(pk(d, 'Winner'), 'TeamNum') }); break;
      case 'PodiumStart': onGame('game:podium_start', d); break;
      case 'MatchDestroyed': onGame('game:match_destroyed', d); break;
      default: onGame('official:' + ev, d);
    }
  }
  // one JSON message from any source: SOS ({event, data}) or the official API ({Event, Data})
  function onMessage(chunk) {
    let msg; try { msg = JSON.parse(chunk); } catch { return; }
    msg = deepParse(msg);
    if (!msg || typeof msg !== 'object') return;
    if (msg.Event !== undefined || (msg.event === undefined && pk(msg, 'Event') !== undefined)) return onOfficial(pk(msg, 'Event'), pk(msg, 'Data'));
    let data = msg.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch { /* text */ } }
    if (typeof msg.event === 'string') onGame(msg.event, data);
  }

  // ---------------------------------------------------------------- the connection to the game
  function setStatus(s) { if (s !== status) { status = s; broadcast({ t: 'status', sos: s }); log('Rocket League:', s, s === 'connected' ? sourceUrl() : ''); } }
  const sourceUrl = () => (control.source === 'official' ? control.officialUrl : control.source === 'relay' ? control.relayUrl : control.sosUrl);
  function stopSource() {
    clearTimeout(retry);
    if (src) { const s = src; src = null; try { s.close ? s.close() : s.destroy(); } catch { /* gone */ } }
  }
  function restartSource() { stopSource(); if (started) connect(); }
  function connect() {
    const url = String(sourceUrl() || '').trim();
    if (!url) { setStatus('disconnected'); return; }
    setStatus('connecting');
    const again = () => { if (src === mine || src === null) { src = null; setStatus('disconnected'); clearTimeout(retry); retry = setTimeout(() => { if (started) connect(); }, 3000); if (retry.unref) retry.unref(); } };
    let mine;
    if (/^tcp:\/\//i.test(url)) {                    // the official API's TCP port: a stream of JSON objects
      const u = new URL(url);
      let buf = '';
      mine = net.connect({ host: u.hostname || '127.0.0.1', port: Number(u.port) || 49123 });
      mine.setEncoding('utf8');
      mine.on('connect', () => { if (src === mine) { setStatus('connected'); officialReset(); } });
      mine.on('data', (d) => { buf += d; const r = splitJson(buf); buf = r.rest.length > 4 * 1024 * 1024 ? '' : r.rest; r.complete.forEach(onMessage); });
      mine.on('error', () => {});
      mine.on('close', again);
      mine.close = () => mine.destroy();
    } else {
      if (typeof WebSocket === 'undefined') { setStatus('disconnected'); log('Rocket League: Node.js 22 or newer is needed'); return; }
      try { mine = new WebSocket(url); } catch { again(); return; }
      mine.onopen = () => { if (src === mine) { setStatus('connected'); officialReset(); } };
      mine.onmessage = (e) => { const raw = typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString(); splitJson(raw).complete.forEach(onMessage); };
      mine.onerror = () => {};
      mine.onclose = again;
    }
    src = mine;
  }

  // ---------------------------------------------------------------- CasparCG: a layer per graphic
  const layers = new Map();                // part → { loaded, playing }
  const channel = () => control.caspar.channel || Number(app.config.caspar && app.config.caspar.channel) || 1;
  const folder = () => { try { return (app.gfx && typeof app.gfx.templateFolder === 'function' && app.gfx.templateFolder()) || (app.config.caspar && app.config.caspar.templateFolder) || 'rfp'; } catch { return 'rfp'; } };
  const wsUrl = () => String((app.config.caspar && app.config.caspar.httpBase) || `http://127.0.0.1:${app.config.port}`).replace(/^http/, 'ws').replace(/\/+$/, '') + '/rl/ws';
  const amcp = () => (app.gfx && app.gfx.amcp) || null;
  const layerOf = (i) => control.caspar.layer + i;
  async function casparSend(c) { const a = amcp(); if (!a || !a.connected) throw new Error('CasparCG is not connected'); return a.send(c); }
  function casparReset(prevJson, keep) {
    // the old layers go (CasparCG switched off, or moved to another channel / layer)
    const prev = prevJson ? JSON.parse(prevJson) : control.caspar;
    if (layers.size && (prev.on || keep)) {
      const ch = prev.channel || Number(app.config.caspar && app.config.caspar.channel) || 1;
      PARTS.forEach((p, i) => { if (layers.has(p[0])) casparSend(`CLEAR ${ch}-${prev.layer + i}`).catch(() => {}); });
    }
    layers.clear();
  }
  let syncing = Promise.resolve();
  function sync() {
    syncing = syncing.then(async () => {
      if (!control.caspar.on) return;
      const a = amcp(); if (!a || !a.connected) return;
      const ch = channel(), tpl = folder().replace(/\/+$/, '') + '/rocket/overlay';
      for (let i = 0; i < PARTS.length; i++) {
        const [part, , key] = PARTS[i], want = key ? !!control.show[key] : true, L = layers.get(part) || { loaded: false, playing: false };
        try {
          if (!L.loaded) {
            await casparSend(`CG ${ch}-${layerOf(i)} ADD 1 ${quote(tpl)} ${want ? 1 : 0} ${quote(JSON.stringify({ part, ws: wsUrl() }))}`);
            Object.assign(L, { loaded: true, playing: want });
          } else if (want !== L.playing) {
            await casparSend(`CG ${ch}-${layerOf(i)} ${want ? 'PLAY' : 'STOP'} 1`);
            L.playing = want;
          }
          layers.set(part, L);
        } catch (e) { log(`Rocket League: CasparCG layer ${layerOf(i)} (${part}):`, e.message); return; }
      }
    }).catch(() => {});
    return syncing;
  }
  let wasConnected = false;
  function watchCaspar() {
    const a = amcp(), now = !!(a && a.connected);
    if (now && !wasConnected) { layers.clear(); sync(); }          // CasparCG (re)started: load the layers again
    wasConnected = now;
  }

  // ---------------------------------------------------------------- live values {rl_…} for graphics triggers, dashboards and templates
  function values() {
    const d = lastUpdate || {}, g = d.game || {}, ts = g.teams || [], ps = d.players || {};
    const tp = g.target ? ps[g.target] || Object.values(ps).find((p) => p.id === g.target || p.name === g.target) : null;
    const name = (i) => (control.useGameNames && ts[i] && ts[i].name) || (control.teams[i] && control.teams[i].name) || '';
    const s = (lastGoal && lastGoal.scorer) || {};
    const out = {
      rl_connected: status === 'connected' ? '1' : '', rl_source: control.source, rl_title: control.title, rl_subtitle: control.subtitle,
      rl_team_a: name(0), rl_team_b: name(1), rl_tag_a: (control.teams[0] || {}).tag || '', rl_tag_b: (control.teams[1] || {}).tag || '',
      rl_score_a: String((ts[0] && ts[0].score) ?? 0), rl_score_b: String((ts[1] && ts[1].score) ?? 0),
      rl_series_a: String(control.series[0]), rl_series_b: String(control.series[1]), rl_best_of: String(control.bestOf),
      rl_game_no: String(Math.min(control.bestOf, control.series[0] + control.series[1] + 1)),
      rl_clock: lastUpdate ? clockText(g) : '', rl_seconds: lastUpdate ? String(Math.round(g.time_seconds ?? 0)) : '', rl_ot: g.isOT ? '1' : '', rl_replay: g.isReplay ? '1' : '',
      rl_arena: g.arena || '', rl_ball_speed: String((g.ball && g.ball.speed) || 0),
      rl_target: tp ? tp.name || '' : '', rl_target_team: tp ? (tp.team === 1 ? 'B' : 'A') : '', rl_target_boost: tp ? String(Math.round(tp.boost || 0)) : '', rl_target_speed: tp ? String(Math.round(tp.speed || 0)) : '',
      rl_last_goal: s.name || '', rl_last_goal_team: AB(s.teamnum ?? s.team_num), rl_last_goal_speed: lastGoal && lastGoal.goalspeed ? String(Math.round(lastGoal.goalspeed)) : '',
      rl_winner: g.hasWinner ? name(g.winner === 1 || g.winner === '1' ? 1 : 0) : '',
    };
    return out;
  }

  // ---------------------------------------------------------------- the action for buttons, macros and triggers: { do: 'rocket', method, target }
  //   method: show / hide / toggle (target: scorebug, boost, player, minimap, stinger, stats, transitions, banners, postgame),
  //   transition, go, overtime, winner (target A / B), goal (target A / B, a test stinger), snapshot, series+ / series- (target A / B), reset
  async function run(method, target) {
    await loaded;
    const keys = Object.keys(DEFAULT_CONTROL.show), t = String(target || '').trim().toLowerCase(), team = t === 'b' || t === '1' || t === 'orange' ? 1 : 0;
    switch (String(method || '').toLowerCase()) {
      case 'show': case 'hide': case 'toggle':
        if (!keys.includes(t)) fail(400, `No Rocket League graphic called "${target}" (${keys.join(', ')})`);
        return patch({ show: { [t]: method === 'toggle' ? !control.show[t] : method === 'show' } });
      case 'transition': return action('transition');
      case 'go': return action('go');
      case 'overtime': return action('overtime');
      case 'winner': return action('winner', { team });
      case 'goal': return action('testGoal', { team });
      case 'snapshot': return action('snapshotPostgame');
      case 'series+': case 'series-': { const s = [...control.series]; s[team] += method === 'series+' ? 1 : -1; return patch({ series: s }); }
      case 'reset': return action('resetSeries');
      default: fail(400, 'Unknown Rocket League action ' + method);
    }
  }

  let watch = null;
  async function start() {
    if (!on || started) return;
    await loaded;
    started = true;
    connect();
    watch = setInterval(watchCaspar, 2000); if (watch.unref) watch.unref();
  }
  function stop() { started = false; stopSource(); clearInterval(watch); for (const c of clients) { try { c.sock.end(); } catch { /* gone */ } } clients.clear(); }
  const view = async () => { await loaded; return { on, status, control, parts: PARTS.map(([id, label, key], i) => ({ id, label, key, layer: layerOf(i), loaded: !!(layers.get(id) || {}).loaded, playing: !!(layers.get(id) || {}).playing })), wsUrl: wsUrl(), template: folder() + '/rocket/overlay', players: lastUpdate ? Object.keys(lastUpdate.players || {}).length : 0 }; };

  return { on, start, stop, upgrade, patch: async (p) => { await loaded; return patch(p); }, action: async (n, m) => { await loaded; return action(n, m); }, run, values, view, EVENTS, PARTS,
    get status() { return status; }, get control() { return control; }, _onMessage: onMessage, _sync: sync };
}

module.exports = { makeRocket, EVENTS, PARTS, splitJson, secondsOf };
