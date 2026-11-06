'use strict';
// The client portal (/portal/<key>): one page per client with their quotes (to sign), invoices (to pay), productions,
// bookings and reviews, and their adverts. Every person on it has their own key (client.data.portalUsers), so one can
// be removed without the others; anyone on it can add colleagues. Keys are found through kv "portal:<key>".
// Adverts: the team offers ad spaces (adSlot: size, place, price per period, per sport or General); a client loads a
// picture for a space, it waits as Pending until the team approves it, and a paid space gets an invoice to pay here.
const crypto = require('node:crypto');
const { fail, log, newId } = require('./util');

function makePortal(app) {
  const get = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const site = () => String(app.config.publicUrl || app.config.adminUrl || '').replace(/\/+$/, '');
  const normEmail = (e) => String(e || '').trim().toLowerCase();
  const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  const newKey = () => crypto.randomBytes(18).toString('base64url');
  const pays = () => !!(app.pay && app.pay.enabled());
  const studio = (hash) => String(app.config.adminUrl || app.config.publicUrl || '').replace(/\/+$/, '') + '/app/' + hash;
  const editors = async (team) => (await app.store.list(team, 'member')).filter((m) => !m.deleted && ['Admin', 'Producer'].includes(m.data.role)).map((m) => m.data.email);

  // a person on the client's portal (made when missing); returns their link
  async function ensureUser(client, email, name, by) {
    email = normEmail(email);
    if (!okEmail(email)) fail(400, 'Give a valid email address');
    const cur = await get(client.id), users = [...((cur.data.portalUsers) || [])];
    let u = users.find((x) => x.email === email);
    if (!u) {
      if (users.length >= 25) fail(400, 'A portal has room for 25 people');
      u = { email, name: String(name || '').slice(0, 80), key: newKey(), addedBy: String(by || '').slice(0, 120), at: Date.now() };
      users.push(u);
      await app.save(cur.team, 'client', cur.id, { ...cur.data, portalUsers: users }, '');
      await app.store.kvSet('portal:' + u.key, { team: cur.team, client: cur.id });
    }
    return { user: u, url: `${site()}/portal/${u.key}` };
  }
  const linkFor = async (client, email, by) => (await ensureUser(client, email, '', by)).url;
  async function byKey(key) {
    if (!/^[\w-]{16,60}$/.test(String(key || ''))) fail(404, 'This link is not valid');
    const k = await app.store.kvGet('portal:' + key).catch(() => null);
    const c = k && await get(k.client);
    const user = c && (c.data.portalUsers || []).find((u) => u.key === key);
    if (!c || c.type !== 'client' || !user) fail(404, 'This link is not valid (any more). Ask us for a new one.');
    return { client: c, user, team: c.team };
  }
  async function invite(client, email, name, by) {
    const { user, url } = await ensureUser(client, email, name, by);
    const org = ((await get(client.team)) || { data: {} }).data;
    if (app.mail && app.mail.enabled()) await app.mail.send(user.email, { subject: `Your client portal with ${app.config.publicName || org.name || 'us'}`, title: `${client.data.name}: client portal`,
      lines: [`${by ? by + ' gave you' : 'You have'} access to ${client.data.name}'s client portal with ${app.config.publicName || org.name || 'us'}.`, 'Quotes to sign, invoices to pay, your productions and bookings, and your adverts are all there. Keep this email: the link is yours.'],
      button: { url, label: 'Open the portal' } }).catch(() => {});
    return user;
  }

  // ---- what the portal shows
  async function view(key) {
    const { client, user, team } = await byKey(key);
    const c = client.data, org = ((await get(team)) || { data: {} }).data, b = await app.invoices.billing(team);
    const docs = (await app.invoices.list(team, { client: client.id })).filter((x) => x.status !== 'Draft');
    const prods = (await app.store.list(team, 'production')).filter((p) => !p.deleted && p.data.clientRef === client.id).sort((a, b2) => String(b2.data.date || '').localeCompare(String(a.data.date || '')));
    const emails = new Set([c.email, ...(c.contacts || []).map((x) => x.email), ...(c.portalUsers || []).map((x) => x.email)].map(normEmail).filter(Boolean));
    const bookings = (await app.store.list(team, 'booking')).filter((x) => !x.deleted && (x.data.clientRef === client.id || emails.has(normEmail(x.data.email))));
    const ads = (await app.store.list(team, 'advert')).filter((a) => !a.deleted && a.data.client === client.id);
    const sports = new Set(['General', ...prods.map((p) => p.data.type === 'Sport' ? p.data.sport || '' : p.data.type === 'Religion' ? 'Church' : '').filter(Boolean)]);
    const slots = (await app.store.list(team, 'adSlot')).filter((s) => !s.deleted && s.data.active !== false);
    const base = `/api/portal/${encodeURIComponent(key)}`;
    return {
      company: { name: app.config.publicName || b.legalName || org.name || '', logo: org.image || '', email: b.email || org.email || '', phone: b.phone || org.phone || '' },
      client: { name: c.name, logo: c.logo || '', email: c.email || '', phone: c.phone || '', address: c.address || '', vatNo: c.vatNo || '' },
      me: { email: user.email, name: user.name || '' },
      payments: pays(),
      docs: docs.map((x) => ({ id: x.id, kind: x.kind, number: x.number, title: x.title || '', date: x.date, due: x.due, state: x.state, total: x.total, balance: x.balance, paid: x.paid,
        signed: x.signature ? { name: x.signature.name, at: x.signature.at } : null, pdf: `${base}/doc/${encodeURIComponent(x.id)}.pdf`,
        sign: x.kind === 'quote' && !x.signature && ['Sent', 'Expired'].includes(x.state) ? `${base}/sign/${encodeURIComponent(x.id)}` : '',
        pay: pays() && x.kind === 'invoice' && x.balance > 0 && !['Cancelled'].includes(x.status) ? `${base}/pay/${encodeURIComponent(x.id)}` : '' })),
      owed: Math.round(docs.filter((x) => x.kind === 'invoice' && !['Cancelled'].includes(x.status)).reduce((n, x) => n + x.balance, 0) * 100) / 100,
      productions: await Promise.all(prods.slice(0, 60).map(async (p) => ({ name: p.data.name, number: p.data.number || '', date: p.data.date || '', status: p.data.status || '', page: `/client/${await app.crewtools.clientKey(p)}` }))),
      bookings: bookings.sort((a, b2) => String(b2.data.date || '').localeCompare(String(a.data.date || ''))).slice(0, 60).map((x) => ({ service: x.data.service || '', date: x.data.date || '', stage: app.bookings.stageOf(x.data, null),
        track: x.data.trackKey ? `/track/${x.data.trackKey}` : '', rating: x.data.rating ? { stars: x.data.rating.stars, comment: x.data.rating.comment || '' } : null })),
      slots: slots.filter((s) => sports.has(s.data.sport || 'General') || !s.data.sport).sort((a, b2) => (a.data.sport === 'General' ? -1 : 0) - (b2.data.sport === 'General' ? -1 : 0) || String(a.data.name).localeCompare(String(b2.data.name)))
        .concat(slots.filter((s) => !(sports.has(s.data.sport || 'General') || !s.data.sport)))
        .map((s) => ({ id: s.id, name: s.data.name, sport: s.data.sport || 'General', layout: s.data.layout || '', width: Number(s.data.width) || 0, height: Number(s.data.height) || 0, seconds: Number(s.data.duration) || 0,
          formats: s.data.formats || '', price: Number(s.data.price) || 0, period: s.data.period || '', description: s.data.description || '', mine: sports.has(s.data.sport || 'General') })),
      ads: ads.map((a) => ({ id: a.id, name: a.data.name, image: a.data.image || '', slot: a.data.slot || '', approval: a.data.approval || 'Approved', from: a.data.from || '', until: a.data.until || '' })),
      users: (c.portalUsers || []).map((u) => ({ email: u.email, name: u.name || '', me: u.key === user.key })),
    };
  }
  async function docPdf(key, id) {
    const { team, client } = await byKey(key);
    const x = await app.invoices.one(team, id);
    if (x.client !== client.id || x.status === 'Draft') fail(404, 'Not found');
    if (!x.viewedAt) await app.save(team, 'invoice', id, { ...(await get(id)).data, viewedAt: Date.now() }, '').catch(() => {});
    return app.invoices.pdf(team, id);
  }
  async function sign(key, id, body, ip) {
    const { team, client, user } = await byKey(key);
    const x = await app.invoices.one(team, id);
    if (x.client !== client.id) fail(404, 'Not found');
    if (!body || body.agree !== true) fail(400, 'Tick that you accept the quote and its terms');
    return app.invoices.sign(team, id, { name: body.name, image: body.image, email: user.email, ip });
  }
  async function pay(key, id, { base, user: account }) {
    const { team, client, user } = await byKey(key);
    const x = await app.invoices.one(team, id);
    if (x.client !== client.id || x.kind !== 'invoice' || x.status === 'Draft') fail(404, 'No such invoice');
    return app.payments.payDoc(team, id, { email: user.email, name: user.name || client.data.name, base, user: account, returnPath: `/portal/${key}` });
  }
  async function addUser(key, { email, name }) {
    const { client, user } = await byKey(key);
    const u = await invite(await get(client.id), email, name, user.name || user.email);
    return { email: u.email };
  }
  async function removeUser(key, email) {
    const { client } = await byKey(key);
    const cur = await get(client.id), users = cur.data.portalUsers || [], gone = users.find((u) => u.email === normEmail(email));
    if (!gone) fail(404, 'Not on this portal');
    await app.save(cur.team, 'client', cur.id, { ...cur.data, portalUsers: users.filter((u) => u !== gone) }, '');
    await app.store.kvDel('portal:' + gone.key).catch(() => {});
    return { removed: gone.email };
  }
  // the team removes someone (Settings → Clients)
  async function removeByTeam(client, email) {
    const users = client.data.portalUsers || [], gone = users.find((u) => u.email === normEmail(email));
    if (!gone) fail(404, 'Not on this portal');
    await app.save(client.team, 'client', client.id, { ...client.data, portalUsers: users.filter((u) => u !== gone) }, '');
    await app.store.kvDel('portal:' + gone.key).catch(() => {});
    return {};
  }

  // ---- a client's advert for an ad space: waits for approval; a paid space gets an invoice
  async function addAd(key, { slot, name, image, from }) {
    const { team, client, user } = await byKey(key);
    const s = await get(slot);
    if (!s || s.team !== team || s.type !== 'adSlot' || s.data.active === false) fail(404, 'No such ad space');
    const d = s.data;
    const ad = await app.save(team, 'advert', newId('adv_'), { name: String(name || `${client.data.name} – ${d.name}`).slice(0, 120), sponsor: client.data.name, sponsorEmail: user.email, client: client.id, slot: s.id, approval: 'Pending',
      kind: 'Image', image, layout: d.layout || 'Full screen', x: d.x || '', y: d.y || '', width: d.width || '', height: d.height || '', duration: d.duration || '', fit: 'Fit inside', transition: 'Fade',
      from: /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? from : '', notes: `Loaded by ${user.email} from the client portal.` }, '');
    let invoice = null;
    if (Number(d.price) > 0) {
      const inv = await app.invoices.create(team, { kind: 'invoice', client: client.id, title: `Sponsorship: ${d.name}`, lines: [{ item: `Sponsorship – ${d.name}`, description: `Advert space${d.sport && d.sport !== 'General' ? ' (' + d.sport + ')' : ''}${d.layout ? ', ' + d.layout.toLowerCase() : ''}${d.width && d.height ? ` ${d.width}×${d.height}px` : ''}, per ${d.period || 'month'}.`, qty: 1, rate: Number(d.price) }] }, 'Client portal');
      // a sponsorship is not a production: no booking fee on it
      const lines = inv.lines.filter((l) => !l.fee);
      invoice = await app.invoices.update(team, inv.id, { lines, status: 'Sent' });
      await app.save(team, 'advert', ad.id, { ...ad.data, invoice: inv.id }, '');
    }
    const to = await editors(team);
    if (app.push) app.push.send(to, { kind: 'booking', title: `New advert from ${client.data.name}`, body: `${d.name}: approve it under Adverts.${invoice ? ` Invoice ${invoice.number} (${app.invoices.money(invoice.total)}) is in their portal.` : ''}`, url: studio('#/edit/advert/' + ad.id) }).catch(() => {});
    if (app.mail) app.mail.send(to, { subject: `New advert from ${client.data.name}: ${d.name}`, title: 'An advert to approve', lines: [`${user.email} loaded an advert for ${d.name}.`, invoice ? `Invoice ${invoice.number} for ${app.invoices.money(invoice.total)} is waiting in their portal.` : 'This space is free.', 'It plays once you set it to Approved.'], button: { url: studio('#/edit/advert/' + ad.id), label: 'Open the advert' } }).catch(() => {});
    log(`Portal: advert from ${client.data.name} for ${d.name}`);
    return { advert: ad.id, invoice: invoice ? { id: invoice.id, number: invoice.number, total: invoice.total, pay: pays() ? `/api/portal/${encodeURIComponent(key)}/pay/${encodeURIComponent(invoice.id)}` : '' } : null };
  }
  async function removeAd(key, id) {
    const { client, team } = await byKey(key);
    const a = await get(id);
    if (!a || a.team !== team || a.type !== 'advert' || a.data.client !== client.id) fail(404, 'Not found');
    if (a.data.approval === 'Approved') fail(409, 'This advert is approved and in use: ask us to take it off');
    await app.remove(id, '');
    return {};
  }

  return { ensureUser, linkFor, byKey, invite, view, docPdf, sign, pay, addUser, removeUser, removeByTeam, addAd, removeAd };
}

module.exports = { makePortal };
