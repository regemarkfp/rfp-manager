'use strict';
// One stream key per production, one video per match: while a production streams, each of its matches is marked
// in the recording when it starts (the scorer's first event turns the match Live) and when it ends (Completed).
// A match video is that stretch of the production's recording, played by MediaMTX's playback server – nothing is
// cut or copied. Producers can set or correct the times by hand on the production.
// Kept as "streamclip" records: { production, fixture, slug, start, end, auto, title }  (start/end ISO times)
const { newId, fail } = require('./util');

function makeClips(app) {
  const conf = () => app.config.streaming || {};
  const pre = () => Number.isFinite(Number(conf().clipPreroll)) ? Number(conf().clipPreroll) : 30;     // seconds before the start
  const post = () => Number.isFinite(Number(conf().clipPostroll)) ? Number(conf().clipPostroll) : 30;  // seconds after the end
  const data = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const iso = (ms) => new Date(ms).toISOString();

  async function clipsOf(prodId) { return (await app.store.find('streamclip', 'production', prodId)).sort((a, b) => String(a.data.start || '').localeCompare(String(b.data.start || ''))); }
  async function clipOf(prodId, fixtureId) { return (await clipsOf(prodId)).find((c) => c.data.fixture === fixtureId) || null; }
  const titleOf = (f) => (f && (f.data.name || f.data.autoName)) || 'Match';

  // productions that stream and list this match
  async function productionsOf(fixture) {
    return (await app.store.list(fixture.team, 'production')).filter((p) => !p.deleted && p.data.streamSlug && p.data.streamChannel && (p.data.fixtures || []).some((r) => r.fixture === fixture.id));
  }

  async function mark(prod, fixture, edge, atMs, { auto = true, by = '' } = {}) {
    const cur = await clipOf(prod.id, fixture.id);
    const d = cur ? { ...cur.data } : { production: prod.id, fixture: fixture.id, slug: prod.data.streamSlug, auto };
    if (auto && cur && cur.data.auto === false) return cur;                       // set by hand: leave it alone
    if (edge === 'start') { if (auto && d.start) return cur; d.start = iso(atMs - (auto ? pre() * 1000 : 0)); if (auto) delete d.end; }
    else { if (!d.start) return cur; if (auto && d.end) return cur; d.end = iso(atMs + (auto ? post() * 1000 : 0)); }
    d.title = titleOf(fixture);
    d.slug = prod.data.streamSlug;
    if (!auto) d.auto = false;
    return app.save(prod.team, 'streamclip', cur ? cur.id : newId('clip_'), d, by);
  }

  // the website notices a match going Live / Completed (from the production PC's scorer, or edited on the website)
  const seen = new Map();          // fixture id → last status seen
  app.on('doc', (doc) => {
    if (app.isLocal || doc.type !== 'fixture' || doc.deleted) return;
    const was = seen.get(doc.id), now = doc.data.status;
    seen.set(doc.id, now);
    if (was === now || (now !== 'Live' && now !== 'Completed')) return;
    const at = Number.isFinite(doc.updatedAt) && doc.updatedAt <= Date.now() && doc.updatedAt > Date.now() - 6 * 3600e3 ? doc.updatedAt : Date.now();
    (async () => {
      for (const p of await productionsOf(doc)) {
        if (now === 'Live') await mark(p, doc, 'start', at);
        else { if (!(await clipOf(p.id, doc.id))) continue; await mark(p, doc, 'end', at); }
      }
    })().catch(() => {});
  });

  // by hand (Producers): start / end now, or a time; clear
  async function set(prod, fixtureId, { start, end, clear } = {}, userId = '') {
    if (!(prod.data.fixtures || []).some((r) => r.fixture === fixtureId)) fail(400, 'That match is not part of this production');
    const fx = await data(fixtureId);
    if (!fx) fail(404, 'Match not found');
    const cur = await clipOf(prod.id, fixtureId);
    if (clear) { if (cur) await app.put({ ...cur, deleted: true, updatedAt: Math.max(Date.now(), cur.updatedAt + 1), updatedBy: userId }); return null; }
    const when = (v) => (v === 'now' ? Date.now() : Date.parse(v));
    const d = cur ? { ...cur.data } : { production: prod.id, fixture: fixtureId, slug: prod.data.streamSlug };
    if (start !== undefined) { const t = when(start); if (!Number.isFinite(t)) fail(400, 'Bad start time'); d.start = iso(t); }
    if (end !== undefined) { if (end === '' || end === null) delete d.end; else { const t = when(end); if (!Number.isFinite(t)) fail(400, 'Bad end time'); d.end = iso(t); } }
    if (!d.start) fail(400, 'Set when the match starts first');
    if (d.end && Date.parse(d.end) <= Date.parse(d.start)) fail(400, 'The end is before the start');
    d.auto = false; d.title = titleOf(fx); d.slug = prod.data.streamSlug;
    return app.save(prod.team, 'streamclip', cur ? cur.id : newId('clip_'), d, userId);
  }

  // the match videos of a production: clips that lie in its recordings. vods: [{start, duration}] of the stream.
  function videos(clips, vods, live) {
    const out = [];
    for (const c of clips) {
      const s = Date.parse(c.data.start), e = c.data.end ? Date.parse(c.data.end) : (live ? Date.now() : NaN);
      if (!Number.isFinite(s)) continue;
      // the recording it falls in (the one covering its start)
      const rec = vods.find((v) => { const a = Date.parse(v.start); return s >= a - 5000 && s < a + v.duration * 1000; });
      if (!rec) { if (live && !c.data.end) out.push({ fixture: c.data.fixture, title: c.data.title, start: c.data.start, duration: 0, live: true }); continue; }
      const recEnd = Date.parse(rec.start) + rec.duration * 1000;
      const from = Math.max(s, Date.parse(rec.start));
      const to = Number.isFinite(e) ? Math.min(e, recEnd) : recEnd;
      if (to - from < 20000) continue;
      out.push({ fixture: c.data.fixture, title: c.data.title, start: iso(from), duration: Math.round((to - from) / 1000), live: !c.data.end && !!live });
    }
    return out;
  }

  return { clipsOf, clipOf, mark, set, videos, productionsOf };
}

module.exports = { makeClips };
