'use strict';
// External producers (1.7.0): someone outside the production team gets one production for a one-time event – they
// manage its live stream and book crew and kit for it (from the team's lists, without rates). They are not members of
// the team: the production keeps its guests (data.guests: [{ email, name, until, by, at }]) and an index per email
// (kv "guest:<email>") lets the Studio list their productions. Access ends by itself after "until" (the event + 7 days
// unless the producer chose another day); an hourly sweep removes ended grants.
const { fail, log } = require('./util');

const normEmail = (e) => String(e || '').trim().toLowerCase();
const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const t = new Date(String(iso) + 'T12:00:00Z'); if (isNaN(t)) return ''; t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
// the production fields an external producer may change
const FIELDS = ['crew', 'equipment', 'contacts', 'crewNotes', 'hospitals', 'streamChannel', 'streamTitle', 'streamSlug', 'streamVisibility', 'streamPublicDays', 'streamPoster', 'streamRecord', 'streamVod', 'streamAudio', 'streamPerMatch', 'streamRestream'];
const active = (g, day = today()) => !!g && okEmail(g.email) && (!g.until || g.until >= day);
const grantOf = (prodData, email) => ((prodData && prodData.guests) || []).find((g) => normEmail(g.email) === normEmail(email) && active(g)) || null;

function makeGuests(app) {
  const kvKey = (email) => 'guest:' + normEmail(email);
  async function index(email) { return (await app.store.kvGet(kvKey(email)).catch(() => null)) || []; }
  async function setIndex(email, list) { await app.store.kvSet(kvKey(email), list.length ? list : null); }
  const site = () => String(app.config.adminUrl || app.config.publicUrl || '').replace(/\/+$/, '');

  // the productions this person may manage now: [{ team, prod, until, name }]
  async function grants(user) {
    if (!user || !user.data || app.isLocal) return [];
    const out = [];
    for (const x of await index(user.data.email)) {
      const p = await app.store.get(x.prod).catch(() => null);
      const g = p && !p.deleted && p.type === 'production' ? grantOf(p.data, user.data.email) : null;
      if (g) out.push({ team: p.team, prod: p.id, until: g.until || '', name: p.data.name || '' });
    }
    return out;
  }
  // the Studio's list of teams: the teams of their productions, as "Guest" (unless they are a member there)
  async function teams(user, memberOf) {
    const seen = new Set(memberOf.map((t) => t.id)), out = [];
    for (const g of await grants(user)) {
      if (seen.has(g.team)) continue;
      seen.add(g.team);
      const org = await app.store.get(g.team).catch(() => null);
      if (org && !org.deleted) out.push({ id: g.team, role: 'Guest', org: org.data });
    }
    return out;
  }
  async function may(user, prodOrId) {
    if (!user || app.isLocal) return false;
    const p = typeof prodOrId === 'string' ? await app.store.get(prodOrId).catch(() => null) : prodOrId;
    return !!(p && !p.deleted && p.type === 'production' && grantOf(p.data, user.data.email));
  }
  async function isGuestIn(user, team) { return (await grants(user)).some((g) => g.team === team); }

  // a Producer gives (or changes) someone access to this production
  async function add(prod, b, by) {
    const email = normEmail(b.email);
    if (!okEmail(email)) fail(400, 'Enter their email address');
    const m = (await app.store.find('member', 'email', email)).find((x) => x.team === prod.team && !x.deleted);
    if (m) fail(409, `${email} is already in your production team (${m.data.role}): they can open this production already. Change their role under Settings → Members if they need more.`);
    const p = prod.data;
    const last = p.date ? addDays(p.date, Math.max(0, (Number(p.days) || 1) - 1)) : today();
    const until = /^\d{4}-\d{2}-\d{2}$/.test(String(b.until || '')) ? String(b.until) : addDays(last, 7);
    if (until < today()) fail(400, 'Access must end today or later');
    const guests = (p.guests || []).filter((g) => normEmail(g.email) !== email);
    const was = (p.guests || []).find((g) => normEmail(g.email) === email);
    const g = { email, name: String(b.name || (was && was.name) || '').trim().slice(0, 80), until, by: (by && by.data.email) || '', at: (was && was.at) || Date.now() };
    guests.push(g);
    const cur = (await app.store.get(prod.id)).data;
    await app.save(prod.team, 'production', prod.id, { ...cur, guests }, by ? by.id : '');
    const idx = (await index(email)).filter((x) => x.prod !== prod.id);
    idx.push({ team: prod.team, prod: prod.id, until });
    await setIndex(email, idx);
    // the invitation
    let mailed = false;
    if (app.mail.enabled() && b.notify !== false) {
      const org = ((await app.store.get(prod.team)) || {}).data || {};
      const known = await app.auth.userByEmail(email).catch(() => null);
      const url = `${site()}/app#/edit/production/${prod.id}`;
      const r = await app.mail.send(email, { kind: 'guest', subject: `${org.name || 'A production team'} invited you to manage ${p.name}`, title: `You can manage ${p.name}`,
        lines: [`${(by && (by.data.name || by.data.email)) || org.name || 'The production team'} gave you access to ${p.name}${p.date ? ' on ' + p.date : ''} as an external producer.`,
          'You can manage its live stream (channel, stream key, title, audio tracks, restreams, master control) and book its crew and equipment.',
          `Your access ends on ${until}.`,
          known ? 'Sign in with this email address.' : `Sign in with Google using ${email} (or ask the team to send you a password).`, String(b.note || '').slice(0, 800)].filter(Boolean),
        button: site() ? { url, label: 'Open the production' } : null, footer: `Sent from ${app.config.name || 'RFP Manager'} for ${org.name || 'a production team'}.` }).catch(() => ({ sent: false }));
      mailed = !!r.sent;
    }
    log(`External producer ${email} can manage ${p.name} until ${until}${by ? ' (given by ' + (by.data.email || '') + ')' : ''}.`);
    return { guest: g, mailed };
  }
  async function remove(prod, email) {
    email = normEmail(email);
    const cur = (await app.store.get(prod.id)).data;
    const guests = (cur.guests || []).filter((g) => normEmail(g.email) !== email);
    if (guests.length === (cur.guests || []).length) fail(404, 'No such external producer');
    await app.save(prod.team, 'production', prod.id, { ...cur, guests }, '');
    await setIndex(email, (await index(email)).filter((x) => x.prod !== prod.id));
    return { ok: true };
  }
  // what an external producer may save on the production: only their fields, crew rates and paid ticks kept as they were
  function merge(cur, incoming) {
    const out = { ...cur };
    for (const k of FIELDS) if (incoming[k] !== undefined) out[k] = incoming[k];
    if (Array.isArray(out.crew)) {
      const old = cur.crew || [];
      out.crew = out.crew.map((r, i) => {
        const { rate, paid, ...row } = r || {};
        const was = old.find((o) => o && o.crewMember && o.crewMember === row.crewMember && o.role === row.role) || old[i] || {};
        return { ...row, ...(was.rate !== undefined ? { rate: was.rate } : {}), ...(was.paid !== undefined ? { paid: was.paid } : {}) };
      });
    }
    return out;
  }
  // hourly: ended grants go
  async function sweep() {
    if (app.isLocal) return 0;
    let n = 0;
    for (const p of await app.store.listType('production').catch(() => [])) {
      if (p.deleted || !(p.data.guests || []).length) continue;
      const keep = p.data.guests.filter((g) => active(g));
      if (keep.length === p.data.guests.length) continue;
      for (const g of p.data.guests.filter((x) => !active(x))) { await setIndex(g.email, (await index(g.email)).filter((x) => x.prod !== p.id)); n++; }
      await app.save(p.team, 'production', p.id, { ...p.data, guests: keep }, '');
    }
    if (n) log(`External producers: ${n} ended access removed.`);
    return n;
  }
  let timer = null;
  const start = () => { if (app.isLocal || timer) return; timer = setInterval(() => sweep().catch(() => {}), 3600e3); timer.unref && timer.unref(); setTimeout(() => sweep().catch(() => {}), 30e3).unref(); };
  const stop = () => { if (timer) clearInterval(timer); timer = null; };

  return { grants, teams, may, isGuestIn, add, remove, merge, sweep, start, stop, FIELDS };
}

module.exports = { makeGuests, grantOf, active, FIELDS };
