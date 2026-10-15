'use strict';
// Video analytics: the watch page tells the website every 30 seconds that someone is watching (a "beat"), live or a
// video. Per stream and day that becomes: viewers (different browsers), watch time, the most watching at once (live),
// and the same per video. Kept as "viewstat" records in the production's team: { slug, production, day, viewers:
// [short ids], seconds, peak, videos: { key: { title, viewers, seconds } } }   (key: live | v:<start> | m:<fixture>)
const crypto = require('node:crypto');
const { log } = require('./util');

const BEAT = 30;                      // seconds between beats (the watch page)
const MAX_IDS = 20000;                // different viewers remembered per stream and day
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const short = (s) => crypto.createHash('sha256').update(String(s)).digest('base64url').slice(0, 10);
const docId = (slug, d) => 'vs_' + crypto.createHash('sha256').update(slug + '|' + d).digest('hex').slice(0, 20);

function makeAnalytics(app) {
  const buckets = new Map();          // doc id → { team, data, ids:Set, vids: Map(key → Set) , dirty }
  const lastBeat = new Map();         // sid → { at, key }
  const liveNow = new Map();          // slug → Map(sid → at)
  let timer = null;

  async function bucket(prod, slug, d) {
    const id = docId(slug, d);
    let b = buckets.get(id);
    if (b) return b;
    const cur = await app.store.get(id);
    const data = cur && !cur.deleted ? { ...cur.data, videos: { ...(cur.data.videos || {}) } } : { slug, production: prod.id, day: d, viewers: [], seconds: 0, peak: 0, videos: {} };
    b = { id, team: prod.team, data, ids: new Set(data.viewers || []), vids: new Map(Object.entries(data.videos).map(([k, v]) => [k, new Set(v.viewers || [])])), dirty: false };
    buckets.set(id, b);
    return b;
  }

  // one beat from a watch page. kind: live | vod | match; start / match say which video
  async function beat(slug, { sid, kind, start, match, title } = {}) {
    sid = String(sid || '').slice(0, 64);
    if (!/^[\w-]{8,64}$/.test(sid)) return { ok: false };
    const s = await app.streaming.streamOf(slug);
    if (!s) return { ok: false };
    const key = kind === 'match' && match ? 'm:' + String(match).slice(0, 60) : kind === 'vod' && start ? 'v:' + String(start).slice(0, 40) : 'live';
    const now = Date.now();
    if (key === 'live') { let m = liveNow.get(slug); if (!m) { m = new Map(); liveNow.set(slug, m); } m.set(sid, now); }
    const prev = lastBeat.get(sid);
    if (prev && prev.key === key && now - prev.at < BEAT * 1000 * 0.5) return { ok: true };       // too soon: ignore
    const secs = prev && prev.key === key ? Math.min(BEAT + 10, Math.round((now - prev.at) / 1000)) : 0;
    lastBeat.set(sid, { at: now, key });
    if (lastBeat.size > 50000) { for (const [k, v] of lastBeat) if (now - v.at > 5 * 60000) lastBeat.delete(k); }
    const b = await bucket(s.prod, s.prod.data.streamSlug, day(now));
    const id = short(sid);
    b.ids.add(id); if (b.ids.size > MAX_IDS) b.ids.delete(b.ids.values().next().value);
    b.data.seconds = (b.data.seconds || 0) + secs;
    let vs = b.vids.get(key); if (!vs) { vs = new Set(); b.vids.set(key, vs); }
    vs.add(id); if (vs.size > MAX_IDS) vs.delete(vs.values().next().value);
    const v = b.data.videos[key] || { title: '', viewers: [], seconds: 0, peak: 0 };
    v.seconds = (v.seconds || 0) + secs;
    if (title) v.title = String(title).slice(0, 120);
    if (key === 'live') {
      const m = liveNow.get(slug);
      for (const [k, at] of m) if (now - at > (BEAT + 15) * 1000) m.delete(k);
      v.peak = Math.max(v.peak || 0, m.size);
      b.data.peak = Math.max(b.data.peak || 0, m.size);
    }
    b.data.videos[key] = v;
    b.dirty = true;
    return { ok: true };
  }

  const watchingNow = (slug) => { const m = liveNow.get(slug); if (!m) return 0; const now = Date.now(); let n = 0; for (const at of m.values()) if (now - at <= (BEAT + 15) * 1000) n++; return n; };

  async function flush() {
    for (const b of buckets.values()) {
      if (!b.dirty) continue;
      b.dirty = false;
      b.data.viewers = [...b.ids];
      for (const [k, s] of b.vids) if (b.data.videos[k]) b.data.videos[k].viewers = [...s];
      try { await app.save(b.team, 'viewstat', b.id, b.data, ''); } catch (e) { b.dirty = true; log('Analytics not saved:', e.message); }
    }
    const today = day();
    for (const [id, b] of buckets) if (b.data.day < today && !b.dirty) buckets.delete(id);   // yesterday's are written: let go
  }

  // the numbers for a production team: per day, per stream, per video
  async function report(team, days = 30) {
    await flush();
    const from = day(Date.now() - (Math.max(1, Math.min(366, days)) - 1) * 86400e3);
    const stats = (await app.store.list(team, 'viewstat')).filter((d) => !d.deleted && d.data.day >= from);
    const prods = new Map((await app.streaming.allStreams(team)).map((p) => [p.id, p]));
    const perDay = new Map(), perStream = new Map();
    for (let t = Date.parse(from + 'T12:00:00Z'); day(t) <= day(); t += 86400e3) perDay.set(day(t), { day: day(t), viewers: 0, seconds: 0, peak: 0 });
    for (const d of stats) {
      const x = d.data, pd = perDay.get(x.day) || { day: x.day, viewers: 0, seconds: 0, peak: 0 };
      pd.viewers += (x.viewers || []).length; pd.seconds += x.seconds || 0; pd.peak = Math.max(pd.peak, x.peak || 0); perDay.set(x.day, pd);
      const p = prods.get(x.production);
      const st = perStream.get(x.slug) || { slug: x.slug, production: x.production, title: p ? p.data.streamTitle || p.data.name : x.slug, date: p ? p.data.date || '' : '', ids: new Set(), seconds: 0, peak: 0, videos: new Map() };
      for (const i of x.viewers || []) st.ids.add(i);
      st.seconds += x.seconds || 0; st.peak = Math.max(st.peak, x.peak || 0);
      for (const [k, v] of Object.entries(x.videos || {})) {
        const sv = st.videos.get(k) || { key: k, title: v.title || '', ids: new Set(), seconds: 0, peak: 0 };
        for (const i of v.viewers || []) sv.ids.add(i);
        sv.seconds += v.seconds || 0; sv.peak = Math.max(sv.peak, v.peak || 0); if (v.title) sv.title = v.title;
        st.videos.set(k, sv);
      }
      perStream.set(x.slug, st);
    }
    const streams = [...perStream.values()].map((s) => ({ slug: s.slug, production: s.production, title: s.title, date: s.date, viewers: s.ids.size, seconds: s.seconds, peak: s.peak, watchingNow: watchingNow(s.slug),
      videos: [...s.videos.values()].map((v) => ({ key: v.key, title: v.title, viewers: v.ids.size, seconds: v.seconds, peak: v.peak })).sort((a, b) => b.seconds - a.seconds) }))
      .sort((a, b) => b.seconds - a.seconds);
    const all = new Set(); for (const s of perStream.values()) for (const i of s.ids) all.add(s.slug + i);
    return { from, to: day(), days: [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day)), streams,
      totals: { viewers: all.size, seconds: streams.reduce((n, s) => n + s.seconds, 0), peak: Math.max(0, ...streams.map((s) => s.peak)), watchingNow: streams.reduce((n, s) => n + s.watchingNow, 0) } };
  }

  // the numbers of one stream's videos (for its recordings list)
  async function forStream(team, slug) {
    const r = await report(team, 366);
    const s = r.streams.find((x) => x.slug === slug);
    return new Map(((s && s.videos) || []).map((v) => [v.key, v]));
  }

  function start() { if (app.isLocal) return; timer = setInterval(() => flush().catch(() => {}), 60000); timer.unref(); }
  async function stop() { clearInterval(timer); await flush().catch(() => {}); }
  return { beat, flush, report, forStream, watchingNow, start, stop };
}

module.exports = { makeAnalytics, BEAT };
