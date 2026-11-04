'use strict';
// Paying online with PayFast (lib/pay.js) for things other than streams:
//  · an invoice, from the client page (/client/<key>) or the invoice email's "Pay now": the invoice turns Paid
//  · a booking's deposit, from its tracking page (/track/<key>): the booking turns Booked (the client sees Confirmed)
//  · an app on /software/<app> with a price: the buyer's account may download it from then on
// Each paid one tells the team (email and the apps) and the payer gets a receipt (lib/pay.js).
const { fail, log } = require('./util');

function makePayments(app) {
  const get = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const zar = (n) => 'R ' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  const studio = (hash) => String(app.config.adminUrl || app.config.publicUrl || '').replace(/\/+$/, '') + '/app/' + hash;
  const editors = async (team) => (await app.store.list(team, 'member')).filter((m) => !m.deleted && ['Admin', 'Producer'].includes(m.data.role)).map((m) => m.data.email);
  async function tellTeam(to, { title, body, url, subject, lines }) {
    if (!to.length) return;
    if (app.push) app.push.send(to, { kind: 'payment', title, body, url }).catch(() => {});
    await app.mail.send(to, { subject: subject || title, title, lines: lines || [body], button: url ? { url, label: 'Open it' } : null }).catch(() => {});
  }

  // ---- invoices
  async function invoiceFor(key, number) {
    const prod = await app.crewtools.byKey(key);
    const x = (prod.data.invoices || []).find((y) => y.number === number);
    if (!x || x.kind !== 'invoice' || x.status === 'Draft') fail(404, 'No such invoice');
    if (x.status === 'Paid') fail(409, 'This invoice is paid. Thank you!');
    if (x.status === 'Cancelled') fail(409, 'This invoice was cancelled');
    return { prod, x };
  }
  async function payInvoice(key, number, { email, name, base, user }) {
    const { prod, x } = await invoiceFor(key, number);
    const org = ((await get(prod.team)) || { data: {} }).data;
    return app.pay.checkout({ kind: 'invoice', amount: app.invoices.totals(x).total, item: `Invoice ${x.number} – ${org.name || ''}`.trim(), payer: email || prod.data.clientEmail || (user && user.data.email), name: name || prod.data.client || '', user, base,
      returnPath: `/client/${key}`, data: { team: prod.team, production: prod.id, number: x.number } });
  }
  app.pay.onPaid('invoice', async (p) => {
    const prod = await get(p.data.production);
    if (!prod) return;
    const x = (prod.data.invoices || []).find((y) => y.number === p.data.number);
    if (!x || x.status === 'Paid') return;
    await app.invoices.update(prod, x.number, { status: 'Paid' });
    await tellTeam(await editors(prod.team), { title: `Invoice ${x.number} paid online`, body: `${prod.data.client || p.data.email} paid ${zar(p.data.amount)} (${prod.data.name || ''}) through PayFast.`, url: studio('#/invoices/' + prod.id) });
  });

  // ---- booking deposits
  async function payDeposit(key, { base, user }) {
    const b = await app.bookings.byKey(key);
    const d = b.data, amount = Number(d.deposit) || 0;
    if (!(amount > 0)) fail(400, 'This booking has no deposit to pay');
    if (d.depositPaidAt) fail(409, 'The deposit is paid. Thank you!');
    if (d.status === 'Not going ahead') fail(409, 'This booking is not going ahead');
    return app.pay.checkout({ kind: 'deposit', amount, item: `Deposit – ${[d.service, d.date].filter(Boolean).join(' ') || 'booking'}`, payer: d.email || (user && user.data.email), name: d.name || '', user, base,
      returnPath: `/track/${key}`, data: { team: b.team, booking: b.id } });
  }
  app.pay.onPaid('deposit', async (p) => {
    const b = await get(p.data.booking);
    if (!b || b.data.depositPaidAt) return;
    await app.bookings.depositPaid(b, p);
    const to = b.data.producer ? [b.data.producer] : (await app.store.list(b.team, 'member')).filter((m) => !m.deleted && m.data.role === 'Admin').map((m) => m.data.email);
    await tellTeam(to, { title: `Deposit paid: ${b.data.name || 'booking'}`, body: `${zar(p.data.amount)} for ${b.data.service || 'the booking'} through PayFast. The booking is now Booked.`, url: studio('#/edit/booking/' + b.id) });
  });

  // ---- software
  async function buySoftware(slug, { user, base }) {
    if (!user) fail(401, 'Sign in first: the app is kept on your account');
    const p = await app.software.product(slug);
    if (!p || p.visible === false) fail(404, 'No such app');
    if (!(Number(p.price) > 0)) fail(400, `${p.name} is free to download`);
    const email = String(user.data.email || '').toLowerCase();
    if ((p.access || []).includes(email)) fail(409, `You already have ${p.name}`);
    return app.pay.checkout({ kind: 'software', amount: p.price, item: `${p.name} (licence)`, payer: email, name: user.data.name || '', user, base,
      returnPath: `/software/${p.slug}`, data: { team: '', product: p.id, slug: p.slug } });
  }
  app.pay.onPaid('software', async (p) => {
    const doc = await get(p.data.product);
    if (!doc) return;
    const email = String(p.data.email || '').toLowerCase();
    const access = [...new Set([...(doc.data.access || []), email])];
    await app.put({ ...doc, data: { ...doc.data, access }, updatedAt: Math.max(Date.now(), doc.updatedAt + 1) });
    const site = String(app.config.publicUrl || '').replace(/\/+$/, '');
    await app.mail.send(email, { subject: `${doc.data.name} is yours`, title: `Thank you for buying ${doc.data.name}`, lines: [`Download it any time while signed in as ${email}.`], button: site ? { url: `${site}/software/${doc.data.slug}`, label: 'Download' } : null }).catch(() => {});
    const admins = (app.config.siteAdmins || []).map((e) => String(e).toLowerCase());
    await tellTeam(admins, { title: `${doc.data.name} sold`, body: `${email} paid ${zar(p.data.amount)}.`, url: '' });
    log(`Software: ${doc.data.name} bought by ${email}`);
  });

  return { payInvoice, payDeposit, buySoftware };
}

module.exports = { makePayments };
