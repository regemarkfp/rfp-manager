'use strict';
// A booking request, followed by the client like a parcel:
//  · every booking has a private link /track/<key> with its steps: Received → Being reviewed → Quote sent → Confirmed
//    → Crew booked → Event day → Completed (or Declined / Cancelled), each with the date it was reached, and the
//    conversation with the company.
//  · the step follows from the work itself (the booking's status, the production made for it, a quote sent, crew
//    confirmed, the date, the production completed); a Producer can also set it by hand ("Client sees").
//  · a new step is sent to the client by email and WhatsApp (unless "Quiet" is on for the booking).
//  · replies: a Producer writes on the booking; it goes to the client by email and WhatsApp at once. The client
//    answers on the tracking page, by WhatsApp (webhook) or by email (to the company); answers land on the booking.
// The conversation is data.messages: [{ id, at, from: 'us' | 'client', by, text, via: [...], email: {ok, error},
// whatsapp: {ok, id, status, error} }]; the steps reached are data.track: [{ stage, at }]; the link key data.trackKey.
const crypto = require('node:crypto');
const { fail, log } = require('./util');

const STAGES = ['Received', 'Being reviewed', 'Quote sent', 'Confirmed', 'Crew booked', 'Event day', 'Completed'];
const ENDS = ['Declined', 'Cancelled'];
const ALL = [...STAGES, ...ENDS];
const SAY = {
  Received: 'We have your request.',
  'Being reviewed': 'A producer is looking at your request.',
  'Quote sent': 'We sent you a quote.',
  Confirmed: 'Your booking is confirmed.',
  'Crew booked': 'The crew for your event is booked.',
  'Event day': 'It is the day of your event.',
  Completed: 'Your event is done. Thank you for booking with us!',
  Declined: 'We are sorry, we cannot take this booking.',
  Cancelled: 'This booking is cancelled.'
};

function makeBookings(app) {
  const get = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const site = () => String(app.config.publicUrl || '').replace(/\/+$/, '');
  const today = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);       // South African date
  const newKey = () => crypto.randomBytes(12).toString('base64url');
  const link = (b) => (b.data.trackKey && site() ? `${site()}/track/${b.data.trackKey}` : '');
  const what = (d) => [d.service || 'your booking', d.date ? fmtDate(d.date) : ''].filter(Boolean).join(' on ');
  const first = (d) => String(d.name || '').trim().split(/\s+/)[0] || 'there';
  const company = async (team) => app.config.publicName || ((await get(team)) || { data: {} }).data.name || 'us';
  function fmtDate(d) { const t = new Date(String(d) + 'T12:00:00Z'); return isNaN(t) ? String(d) : t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }

  // where the booking stands, from the work done on it
  function stageOf(d, prod) {
    if (d.clientStage && ALL.includes(d.clientStage)) return d.clientStage;
    const p = (prod && prod.data) || {};
    const reached = (s) => (d.track || []).some((t) => t.stage === s);
    if (d.status === 'Not going ahead' || p.status === 'Cancelled') return reached('Confirmed') || p.status === 'Cancelled' ? 'Cancelled' : 'Declined';
    if (p.status === 'Completed') return 'Completed';
    const confirmed = d.status === 'Booked' || p.status === 'Confirmed';
    const date = p.date || d.date;
    if (confirmed && date && date <= today()) return 'Event day';
    if (confirmed && (p.crew || []).some((c) => c && c.crewMember && c.confirmed)) return 'Crew booked';
    if (confirmed) return 'Confirmed';
    if (d.status === 'Quoted' || (p.invoices || []).some((x) => x.kind === 'quote' && x.status && x.status !== 'Draft')) return 'Quote sent';
    if (['Assigned', 'Accepted', 'Declined by producer'].includes(d.status)) return 'Being reviewed';
    return 'Received';
  }

  // the client's message of a new step, by email and WhatsApp
  async function tell(b, text, { subject, title } = {}) {
    const d = b.data, url = link(b), name = await company(b.team), out = { email: null, whatsapp: null };
    if (d.email && app.mail.enabled()) {
      const r = await app.mail.send(d.email, { subject: subject || `Your booking: ${what(d)} – ${name}`, title: title || 'An update on your booking',
        lines: [`Hi ${first(d)},`, ...String(text).split(/\n{2,}/)], button: url ? { url, label: 'Follow your booking' } : null,
        footer: `${name} · you get this because you sent a booking request${url ? '. Reply on ' + url : ''}.` });
      out.email = { ok: !!r.sent, error: r.error || '' };
    }
    if (d.phone && app.whatsapp && (await app.whatsapp.ready())) {
      const r = await app.whatsapp.send(d.phone, { text, name: first(d), what: what(d), link: url });
      out.whatsapp = r.ok ? { ok: true, id: r.id, kind: r.kind, status: 'sent', to: r.to } : { ok: false, error: r.error, to: r.to || '' };
      if (r.ok && r.to) await app.store.kvSet('wa:to:' + r.to, b.id);
    }
    return out;
  }

  // keep the steps up to date (and tell the client of a new one)
  // one change at a time per booking (steps, replies, answers and ticks all write its messages)
  const queue = new Map();
  function lock(id, fn) {
    const p = (queue.get(id) || Promise.resolve()).then(fn, fn);
    const tail = p.catch((e) => log('Booking:', e.message)).finally(() => { if (queue.get(id) === tail) queue.delete(id); });
    queue.set(id, tail);
    return p;
  }
  function refresh(id) {
    const run = async () => {
      const b = await get(id);
      if (!b || b.type !== 'booking') return null;
      const d = { ...b.data }, prod = await get(d.production);
      let changed = false;
      if (!d.trackKey) { d.trackKey = newKey(); changed = true; }
      const track = Array.isArray(d.track) ? [...d.track] : [];
      if (!track.length) { track.push({ stage: 'Received', at: Date.parse(String(d.received || '').replace(' ', 'T') + ':00Z') || b.updatedAt || Date.now() }); changed = true; }
      const now = stageOf({ ...d, track }, prod), last = track[track.length - 1].stage;
      let told = null;
      if (now !== last) {
        track.push({ stage: now, at: Date.now() });
        changed = true;
        if (!d.quiet && now !== 'Received') told = now;
      }
      if (!changed) return b;
      d.track = track;
      let saved = await app.save(b.team, 'booking', b.id, d, '');
      if (told) {
        const msg = SAY[told] + (told === 'Quote sent' ? ' You will find it in your email.' : '');
        const res = await tell(saved, msg, { subject: `${told}: ${what(d)}` });
        const m = { id: newKey().slice(0, 10), at: Date.now(), from: 'us', by: 'Update', stage: told, text: msg, ...res };
        saved = await app.save(b.team, 'booking', b.id, { ...saved.data, messages: [...(saved.data.messages || []), m] }, '');
      }
      return saved;
    };
    return lock(id, run);
  }

  // a reply from the company: by email and WhatsApp at once, kept on the booking
  async function reply(b, user, { text, email = true, whatsapp = true }) {
    const t = String(text || '').trim().slice(0, 3000);
    if (!t) fail(400, 'Write a message first');
    if (!b.data.trackKey) b = await refresh(b.id);
    const d = b.data;
    if (!(email && d.email) && !(whatsapp && d.phone)) fail(400, 'This client has no email address or phone number to send it to');
    const res = await tell({ ...b, data: { ...d, email: email ? d.email : '', phone: whatsapp ? d.phone : '' } }, t, { subject: `Re: your booking – ${what(d)}`, title: `A message about your booking` });
    const m = { id: newKey().slice(0, 10), at: Date.now(), from: 'us', by: user.data.name || user.data.email, byEmail: user.data.email, text: t, ...res };
    return lock(b.id, async () => { const cur = await get(b.id); return app.save(b.team, 'booking', b.id, { ...cur.data, messages: [...(cur.data.messages || []), m] }, user.id); });
  }

  // an answer from the client (tracking page or WhatsApp): kept on the booking, the Producer (or the Admins) told
  async function fromClient(b, text, via) {
    let m = null, cur = null;
    const saved = await lock(b.id, async () => {
      cur = await get(b.id);
      m = { id: newKey().slice(0, 10), at: Date.now(), from: 'client', by: cur.data.name || 'Client', text: String(text).slice(0, 3000), via };
      return app.save(cur.team, 'booking', cur.id, { ...cur.data, messages: [...(cur.data.messages || []), m], unread: true }, '');
    });
    const members = (await app.store.list(cur.team, 'member')).filter((x) => !x.deleted);
    const to = cur.data.producer ? [cur.data.producer] : members.filter((x) => x.data.role === 'Admin').map((x) => x.data.email);
    const studio = String(app.config.adminUrl || app.config.publicUrl || '').replace(/\/+$/, '');
    const url = studio + '/app/#/edit/booking/' + cur.id;
    if (app.push) app.push.send(to, { kind: 'booking', title: `${cur.data.name || 'Client'} replied`, body: m.text.slice(0, 140), url }).catch(() => {});
    await app.mail.send(to, { subject: `${cur.data.name || 'Client'} replied: ${what(cur.data)}`, title: `A reply on a booking (${via === 'whatsapp' ? 'WhatsApp' : 'tracking page'})`, lines: [m.text], button: { url, label: 'Open the booking' } });
    return saved;
  }

  // ---- the tracking page
  async function byKey(key) {
    if (!/^[\w-]{12,40}$/.test(String(key || ''))) fail(404, 'This link is not valid');
    const b = (await app.store.find('booking', 'trackKey', String(key))).find((d) => !d.deleted);
    if (!b) fail(404, 'This link is not valid (any more)');
    return b;
  }
  async function track(key) {
    let b = await byKey(key);
    b = (await refresh(b.id)) || b;          // "Event day" comes by the date
    const d = b.data, prod = await get(d.production), org = ((await get(b.team)) || { data: {} }).data;
    const now = stageOf(d, prod), ended = ENDS.includes(now);
    const at = (s) => { const t = (d.track || []).filter((x) => x.stage === s).pop(); return t ? t.at : 0; };
    const steps = (ended ? [...STAGES.slice(0, Math.max(1, STAGES.indexOf((d.track || []).filter((x) => STAGES.includes(x.stage)).map((x) => x.stage).pop() || 'Received') + 1)), now] : STAGES)
      .map((s) => ({ stage: s, at: at(s), done: ended ? true : STAGES.indexOf(s) <= STAGES.indexOf(now), now: s === now, say: SAY[s] }));
    const docs = prod ? (prod.data.invoices || []).filter((x) => x.status && x.status !== 'Draft' && prod.data.clientKey).map((x) => ({ kind: x.kind, number: x.number, url: `/api/client/${prod.data.clientKey}/doc/${encodeURIComponent(x.number)}.pdf` })) : [];
    return { company: app.config.publicName || org.name || '', logo: org.logo || '', name: first(d), service: d.service || '', date: d.date || '', venue: d.venue || '', ref: 'B-' + b.id.slice(-6).toUpperCase(),
      stage: now, say: SAY[now], ended, steps, client: prod && prod.data.clientKey ? `/client/${prod.data.clientKey}` : '', docs,
      messages: (d.messages || []).map((m) => ({ at: m.at, from: m.from, by: m.from === 'us' ? (m.stage ? 'Update' : String(m.by || '').split(/\s+/)[0]) : 'You', text: m.text, stage: m.stage || '' })) };
  }
  async function trackReply(key, text) {
    const t = String(text || '').trim();
    if (!t) fail(400, 'Write a message first');
    const b = await byKey(key);
    if ((b.data.messages || []).filter((m) => m.from === 'client' && m.at > Date.now() - 3600e3).length >= 10) fail(429, 'That is a lot of messages: please wait a while, or call us');
    await fromClient(b, t, 'page');
    return track(key);
  }

  // ---- WhatsApp: replies reach their booking, ticks go on the message
  if (app.whatsapp) {
    app.whatsapp.on('message', async (m) => {
      let id = await app.store.kvGet('wa:to:' + m.from).catch(() => null);
      let b = id ? await get(id) : null;
      if (!b) {   // a number we never wrote to: the newest booking with this phone number
        const c = await app.whatsapp.conf();
        b = (await app.store.listType('booking')).filter((x) => !x.deleted && app.whatsapp.normalize(x.data.phone, c.country) === m.from).sort((x, y) => y.updatedAt - x.updatedAt)[0] || null;
      }
      if (!b) { log(`WhatsApp from ${m.from}: no booking with this number`); return; }
      await fromClient(b, m.text, 'whatsapp');
    });
    app.whatsapp.on('status', async (s) => {
      const id = s.to ? await app.store.kvGet('wa:to:' + s.to).catch(() => null) : null;
      if (!id) return;
      await lock(id, async () => {
      const b = await get(id);
      if (!b) return;
      const order = ['sent', 'delivered', 'read'];
      let hit = false;
      const msgs = (b.data.messages || []).map((m) => {
        if (!m.whatsapp || m.whatsapp.id !== s.id) return m;
        hit = true;
        if (s.status === 'failed') return { ...m, whatsapp: { ...m.whatsapp, ok: false, status: 'failed', error: s.error || 'not delivered' } };
        return order.indexOf(s.status) > order.indexOf(m.whatsapp.status) ? { ...m, whatsapp: { ...m.whatsapp, status: s.status } } : m;
      });
      if (hit) await app.save(b.team, 'booking', b.id, { ...b.data, messages: msgs }, '');
      });
    });
  }

  // steps follow the production (quote sent, crew confirmed, completed) and the booking itself
  const pending = new Set();
  let timer = null;
  function onDoc(doc) {
    if (doc.deleted) return;
    const id = doc.type === 'booking' ? doc.id : doc.type === 'production' && doc.data && doc.data.booking ? doc.data.booking : null;
    if (!id || pending.has(id)) return;
    pending.add(id);
    setTimeout(() => { pending.delete(id); refresh(id).catch(() => {}); }, 300);
  }
  // "Event day" by the calendar: once an hour, the bookings dated today or earlier that are confirmed
  async function tick() {
    for (const b of await app.store.listType('booking')) {
      if (b.deleted || !b.data.date || b.data.date > today()) continue;
      const last = ((b.data.track || []).slice(-1)[0] || {}).stage;
      if (['Confirmed', 'Crew booked'].includes(last)) await refresh(b.id).catch(() => {});
    }
  }
  if (!app.isLocal) { app.on('doc', onDoc); timer = setInterval(() => tick().catch(() => {}), 3600e3); timer.unref(); }
  const idle = async () => { while (pending.size || queue.size) await new Promise((r) => setTimeout(r, 30)); };
  return { STAGES, ENDS, SAY, stageOf, refresh, reply, fromClient, track, trackReply, byKey, tick, idle, link, stop: () => clearInterval(timer) };
}

module.exports = { makeBookings, STAGES, ENDS };
