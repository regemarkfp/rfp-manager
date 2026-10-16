'use strict';
// What sends a push notification, and to whom (see lib/push.js for how; Settings → Notifications for each person's choice):
//  · streams: live (the team, and viewers who follow the channel), ended, dropped, a restream that stops
//  · crew & bookings (with the emails, in lib/notify.js), and a reminder the day before a production
//  · matches: key moments from the scorers (tries, goals, wickets, half / full time) for the team and the followers
//  · chat: new live-chat messages for the team; sales: tickets and passes sold
const Schema = require('../shared/schema');
const { log } = require('./util');

function wirePush(app) {
  if (app.isLocal) return { stop() {} };
  const push = app.push;
  const studio = () => String(app.config.adminUrl || app.config.publicUrl || '').replace(/\/+$/, '');
  const site = () => String(app.config.publicUrl || '').replace(/\/+$/, '');
  const members = async (team, roles) => (await app.store.list(team, 'member')).filter((m) => !m.deleted && (!roles || roles.includes(m.data.role || 'Crew'))).map((m) => m.data.email);
  const followers = async (channelId) => (await app.store.listType('user')).filter((u) => !u.deleted && Array.isArray(u.data.subscriptions) && u.data.subscriptions.includes(channelId));
  const later = (fn) => Promise.resolve().then(fn).catch((e) => log('Push:', e.message));

  // ---- streams
  const lastLive = new Map();
  app.on('stream', (slug, view, wasLive) => {
    if (/--[a-z-]+$/.test(slug)) return;                           // restream copies
    later(async () => {
      const s = await app.streaming.streamOf(slug);
      if (!s) return;
      const title = s.prod.data.streamTitle || s.prod.data.name, team = await members(s.prod.team, ['Admin', 'Producer', 'Scorer', 'Crew']);
      const watch = site() + '/watch/' + slug;
      if (view && view.live && !wasLive) {
        if ((lastLive.get(slug) || 0) > Date.now() - 20 * 60e3) return;          // a short drop and back: once
        lastLive.set(slug, Date.now());
        const fans = (s.ch.data.access || 'Public') === 'Public' ? await followers(s.ch.id) : [];
        await push.send([...team, ...fans], { kind: 'stream_live', title: `${s.ch.data.name || 'Live'}: ${title} is live`, body: 'Tap to watch.', url: watch, tag: 'live:' + slug });
      } else if (wasLive && !(view && view.live)) {
        const ended = !!s.prod.data.streamClosed;
        await push.send(team, ended
          ? { kind: 'stream_ended', title: `${title} has ended`, body: 'The stream key is closed.', url: studio() + '/app/#/streams', tag: 'end:' + slug }
          : { kind: 'stream_dropped', title: `${title}: the signal dropped`, body: 'Viewers see the technical difficulties slate until it comes back.', url: studio() + '/app/#/streams', tag: 'drop:' + slug });
      }
    });
  });
  app.on('restreamfail', (slug, name, error) => later(async () => {
    const s = await app.streaming.streamOf(slug);
    if (!s) return;
    await push.send(await members(s.prod.team, ['Admin', 'Producer']), { kind: 'restream_failed', title: `Restream to ${name} stopped`, body: `${s.prod.data.streamTitle || s.prod.data.name}: ${String(error || '').slice(0, 140)}. Trying again.`, url: studio() + '/app/#/streams', tag: `rs:${slug}:${name}` });
  }));

  // ---- matches: key moments only (not every ball)
  const KEY = { try: 'Try', goal: 'Goal', wicket: 'Wicket', hundred: 'Hundred', fifty: 'Fifty', red: 'Red card', innings: 'End of the innings', period: 'New half / period', dropgoal: 'Drop goal', penalty: 'Penalty' };
  app.on('matchevent', (team, e) => later(async () => {
    const kinds = [e.kind, ...(e.also || [])].map((k) => String(k).toLowerCase());
    const k = kinds.find((x) => KEY[x]);
    if (!k) return;
    const fx = await app.store.get(e.fixtureId);
    if (!fx || fx.deleted) return;
    const f = fx.data, name = f.name || f.autoName || 'Match';
    const side = e.team === 'A' ? f.team1 : e.team === 'B' ? f.team2 : '';
    const sq = side ? await app.store.get(side) : null;
    const who = sq && !sq.deleted ? sq.data.name || '' : '';
    // who follows it: the production team, and viewers who follow a channel streaming this match
    const to = new Set(await members(team, ['Admin', 'Producer', 'Scorer', 'Crew', 'Coach']));
    let url = '';
    for (const p of await app.streaming.allStreams(team)) {
      if (!(p.fixtureId === fx.id || (p.data.fixtures || []).some((r) => r && r.fixture === fx.id)) || !p.data.streamChannel) continue;
      if (!url && p.data.streamSlug) url = site() + '/watch/' + p.data.streamSlug;
      const ch = await app.store.get(p.data.streamChannel);
      if (ch && !ch.deleted && (ch.data.access || 'Public') === 'Public') for (const u of await followers(ch.id)) to.add(u.data.email);
    }
    await push.send([...to], { kind: 'match_moments', title: `${KEY[k]}${who ? ' – ' + who : ''}`, body: `${name}${e.text && !/^(ball|event)$/i.test(e.text) ? ' · ' + String(e.text).slice(0, 80) : ''}`, url, tag: `mm:${fx.id}:${k}:${Math.floor(Date.now() / 15000)}` });
  }));

  // ---- chat: the production team hears about new messages (a summary at most once a minute per stream)
  const chatQ = new Map();
  app.on('comment', (slug, c) => {
    const q = chatQ.get(slug) || { n: 0, last: null, t: null };
    q.n++; q.last = c; chatQ.set(slug, q);
    if (q.t) return;
    q.t = setTimeout(() => later(async () => {
      chatQ.delete(slug);
      const s = await app.streaming.streamOf(slug);
      if (!s) return;
      const title = s.prod.data.streamTitle || s.prod.data.name;
      await push.send(await members(s.prod.team, ['Admin', 'Producer', 'Scorer', 'Crew']), { kind: 'chat', title: q.n > 1 ? `${q.n} new messages on ${title}` : `${q.last.name} on ${title}`, body: q.n > 1 ? `Latest – ${q.last.name}: ${q.last.text}` : q.last.text, url: site() + '/watch/' + slug }, { except: q.last.userId });
    }), 20000);
    q.t.unref && q.t.unref();
  });

  // ---- sales
  app.on('purchase', (p) => later(async () => {
    const d = p.data, team = d.team;
    if (!team) return;
    await push.send(await members(team, ['Admin', 'Producer']), { kind: 'sales', title: `${d.kind === 'pass' ? 'Pass' : 'Ticket'} sold: ${d.item || ''}`, body: `${d.name || d.email || 'Someone'} · ZAR ${(Number(d.amount) || 0).toFixed(2)}`, url: studio() + '/app/#/sales' });
  }));

  // ---- the day before a production: a reminder for its confirmed crew (checked every half hour, sent once, after 17:00)
  let timer = null;
  async function reminders() {
    const tz = app.config.timezone || 'Africa/Johannesburg';
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour < 17) return;
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(now.getTime() + 86400e3));
    for (const p of await app.store.listType('production')) {
      if (p.deleted || p.data.date !== tomorrow || p.data.reminded === tomorrow) continue;
      const emails = [];
      for (const r of p.data.crew || []) { if (!r.crewMember) continue; const cm = await app.store.get(r.crewMember); if (cm && !cm.deleted && cm.data.email) emails.push({ email: cm.data.email, call: r.callTime || '' }); }
      for (const x of emails) await push.send([x.email], { kind: 'reminder', title: `Tomorrow: ${p.data.name}`, body: [x.call && 'Call time ' + x.call, p.data.txTime && 'TX ' + p.data.txTime].filter(Boolean).join(' · ') || 'Your call sheet is in the app.', url: studio() + '/app/#/callsheet/' + p.id });
      await app.save(p.team, 'production', p.id, { ...p.data, reminded: tomorrow }, '');
    }
  }
  timer = setInterval(() => reminders().catch((e) => log('Reminders:', e.message)), 30 * 60e3);
  timer.unref();
  return { stop() { clearInterval(timer); }, reminders, KEY };
}

module.exports = { wirePush };
