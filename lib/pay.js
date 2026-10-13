'use strict';
// Paid streams with PayFast (one PayFast account for the whole website).
//  · A production can have a ticket price (live + its recordings); a channel can sell a pass for N days that covers
//    every paid stream on it. Prices are set by the channel's / production's team (Producers and Admins).
//  · Signed-in viewers: the purchase is on their account (any device). Others give an email address and get a
//    ticket link (…?ticket=tk_…) by email and on the return page.
//  · PayFast tells us about the payment on notify_url (ITN): signature, source address, amount and a confirmation
//    call back to PayFast are checked before a purchase counts as paid.
// Purchases are kept as "purchase" records outside the teams (team ''), with data.team = the team that sold it.
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const { newId, fail, log } = require('./util');

const PAYFAST_HOSTS = ['www.payfast.co.za', 'sandbox.payfast.co.za', 'w1w.payfast.co.za', 'w2w.payfast.co.za'];
const PAYFAST_RANGES = ['197.97.145.144/28', '41.74.179.192/27', '102.216.36.0/28', '102.216.36.128/28', '144.126.193.139/32'];

// PHP urlencode, as PayFast's signature expects: spaces as +, and !'()*~ encoded
const pfEncode = (v) => encodeURIComponent(String(v === undefined || v === null ? '' : v).trim()).replace(/%20/g, '+').replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
// the checkout form: fields in the order sent, blanks left out, passphrase last
function formSignature(pairs, passphrase) {
  const s = pairs.filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => `${k}=${pfEncode(v)}`).join('&');
  return md5(s + (passphrase ? `&passphrase=${pfEncode(passphrase)}` : ''));
}
// the notification: every posted field in the order received except the signature
const itnParamString = (pairs) => pairs.filter(([k]) => k !== 'signature').map(([k, v]) => `${k}=${pfEncode(v)}`).join('&');

function inRange(ip, cidr) {
  const [base, bits] = cidr.split('/'), n = (a) => a.split('.').reduce((x, y) => (x << 8) + (Number(y) & 255), 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (n(ip) & mask) === (n(base) & mask);
}
const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

function makePay(app) {
  const conf = () => app.config.payfast || {};
  const enabled = () => !!(conf().merchantId && conf().merchantKey);
  const host = () => (conf().sandbox ? 'sandbox.payfast.co.za' : 'www.payfast.co.za');
  const processUrl = () => conf().processUrl || `https://${host()}/eng/process`;
  const validateUrl = () => conf().validateUrl || `https://${host()}/eng/query/validate`;
  const data = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const key = () => app.streaming && app.streaming.signKey ? app.streaming.signKey() : (app.payKey || (app.payKey = crypto.randomBytes(32).toString('hex')));
  const sign = (s) => crypto.createHmac('sha256', 'ticket:' + key()).update(s).digest('base64url').slice(0, 24);
  const ticketOf = (purchaseId) => `tk_${purchaseId}.${sign(purchaseId)}`;
  function purchaseIdOf(t) {
    const m = /^tk_([\w-]{6,80})\.([\w-]{24})$/.exec(String(t || ''));
    if (!m) return null;
    const a = Buffer.from(m[2]), b = Buffer.from(sign(m[1]));
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1] : null;
  }

  // what a stream costs: { ticket, pass: {amount, days} | null } (0 / null = not sold)
  function prices(prod, ch) {
    const ticket = Number(prod && prod.data.streamPrice) || 0;
    const pp = Number(ch && ch.data.passPrice) || 0;
    return { ticket: ticket > 0 ? Number(money(ticket)) : 0, pass: pp > 0 && ticket > 0 ? { amount: Number(money(pp)), days: Math.max(1, Math.round(Number(ch.data.passDays) || 30)) } : null, currency: 'ZAR' };
  }
  const isPaid = (prod, ch) => prices(prod, ch).ticket > 0 && (ch.data.access || 'Public') === 'Public';

  // Does this person (signed in, and/or with ticket links) have a paid ticket or a pass for this stream?
  async function entitled(prod, ch, user, tickets = []) {
    const now = Date.now();
    const email = user ? String(user.data.email || '').toLowerCase() : '';
    const fromTickets = new Set((Array.isArray(tickets) ? tickets : [tickets]).map(purchaseIdOf).filter(Boolean));
    const fits = (p) => p.data.status === 'Paid' && ((p.data.kind === 'ticket' && p.data.production === prod.id) || (p.data.kind === 'pass' && p.data.channel === ch.id && Number(p.data.expiresAt) > now));
    const mine = (p) => fromTickets.has(p.id) || (user && (p.data.userId === user.id || (email && String(p.data.email || '').toLowerCase() === email)));
    for (const p of await app.store.find('purchase', 'production', prod.id)) if (fits(p) && mine(p)) return p;
    for (const p of await app.store.find('purchase', 'channel', ch.id)) if (p.data.kind === 'pass' && fits(p) && mine(p)) return p;
    return null;
  }

  // Start paying: a purchase waiting for PayFast, and the form the browser posts to PayFast.
  async function start({ slug, kind, user, email, name, base }) {
    if (!enabled()) fail(400, 'Payments are not set up on this website yet');
    const s = await app.streaming.streamOf(slug);
    if (!s || s.ch.data.disabled) fail(404, 'There is no stream at this address');
    const { prod, ch } = s;
    const pr = prices(prod, ch);
    if (!isPaid(prod, ch)) fail(400, 'This stream is free to watch');
    if (kind === 'pass' && !pr.pass) fail(400, 'This channel does not sell passes');
    if (kind !== 'pass') kind = 'ticket';
    email = String((user && user.data.email) || email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Type your email address: the ticket is sent there');
    if (await entitled(prod, ch, user, [])) fail(409, 'You already have a ticket for this stream');
    const amount = kind === 'pass' ? pr.pass.amount : pr.ticket;
    const id = newId('pur_') + crypto.randomBytes(6).toString('hex');
    const title = prod.data.streamTitle || prod.data.name || 'Live stream';
    const item = kind === 'pass' ? `${ch.data.name} pass (${pr.pass.days} days)` : `${title} – ticket`;
    await app.save('', 'purchase', id, { kind, team: kind === 'pass' ? ch.team : prod.team, channel: ch.id, production: kind === 'ticket' ? prod.id : '', slug: prod.data.streamSlug,
      item, amount, currency: 'ZAR', email, name: String(name || (user && user.data.name) || '').slice(0, 80), userId: user ? user.id : '', status: 'Pending', createdAt: Date.now(), days: kind === 'pass' ? pr.pass.days : 0 }, user ? user.id : '');
    base = String(base || '').replace(/\/+$/, '');
    const c = conf();
    const [first, ...rest] = String(name || (user && user.data.name) || '').trim().split(/\s+/);
    const pairs = [
      ['merchant_id', c.merchantId], ['merchant_key', c.merchantKey],
      ['return_url', `${base}/watch/${encodeURIComponent(prod.data.streamSlug)}?paid=${id}`], ['cancel_url', `${base}/watch/${encodeURIComponent(prod.data.streamSlug)}`],
      ['notify_url', `${base}/api/pay/payfast/itn`],
      ['name_first', (first || '').slice(0, 100)], ['name_last', rest.join(' ').slice(0, 100)], ['email_address', email],
      ['m_payment_id', id], ['amount', money(amount)], ['item_name', item.slice(0, 100)],
    ].filter(([, v]) => v !== '' && v !== undefined);
    pairs.push(['signature', formSignature(pairs, c.passphrase)]);
    return { id, url: processUrl(), fields: pairs };
  }

  // PayFast's notification (ITN). pairs: [[name, value]] in the order posted.
  async function notify(pairs, ip) {
    const f = Object.fromEntries(pairs);
    const c = conf();
    const p = await data(f.m_payment_id);
    if (!p || p.type !== 'purchase') { log('PayFast: notification for an unknown payment', f.m_payment_id); return { ok: false, why: 'unknown' }; }
    const paramString = itnParamString(pairs);
    const want = md5(paramString + (c.passphrase ? `&passphrase=${pfEncode(c.passphrase)}` : ''));
    if (!f.signature || f.signature !== want) { log('PayFast: wrong signature for', p.id); return { ok: false, why: 'signature' }; }
    if (c.checkIp !== false && !(await fromPayfast(ip))) { log('PayFast: notification from an unknown address', ip); return { ok: false, why: 'ip' }; }
    if (Math.abs(Number(f.amount_gross) - Number(p.data.amount)) > 0.01) { log('PayFast: amount does not match for', p.id); return { ok: false, why: 'amount' }; }
    if (String(f.merchant_id || '') !== String(c.merchantId)) return { ok: false, why: 'merchant' };
    try {
      const r = await fetch(validateUrl(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: paramString, signal: AbortSignal.timeout(15000) });
      const txt = (await r.text()).trim();
      if (txt !== 'VALID') { log('PayFast: confirmation said', txt.slice(0, 40), 'for', p.id); return { ok: false, why: 'confirm' }; }
    } catch (e) { log('PayFast: could not confirm', p.id, e.message); return { ok: false, why: 'confirm' }; }
    const status = { COMPLETE: 'Paid', FAILED: 'Failed', CANCELLED: 'Cancelled', PENDING: 'Pending' }[String(f.payment_status || '').toUpperCase()] || p.data.status;
    if (p.data.status === 'Paid' && status !== 'Paid') return { ok: true, status: 'Paid' };          // never undo a paid ticket by a late message
    const was = p.data.status;
    const next = { ...p.data, status, pfPaymentId: String(f.pf_payment_id || ''), fee: Number(f.amount_fee) || 0, net: Number(f.amount_net) || 0 };
    if (status === 'Paid' && was !== 'Paid') { next.paidAt = Date.now(); if (p.data.kind === 'pass') next.expiresAt = Date.now() + (Number(p.data.days) || 30) * 86400e3; }
    await app.save('', 'purchase', p.id, next, p.updatedBy);
    if (status === 'Paid' && was !== 'Paid') { log(`PayFast: ${p.data.item} paid by ${p.data.email} (${money(p.data.amount)})`); sendTicket({ ...p, data: next }).catch((e) => log('Ticket email:', e.message)); }
    return { ok: true, status };
  }

  let ipCache = { at: 0, ips: new Set() };
  async function fromPayfast(ip) {
    ip = String(ip || '').replace(/^::ffff:/, '');
    if (PAYFAST_RANGES.some((r) => inRange(ip, r))) return true;
    if (Date.now() - ipCache.at > 3600e3) {
      const ips = new Set();
      for (const h of PAYFAST_HOSTS) { try { for (const a of await dns.lookup(h, { all: true })) ips.add(a.address); } catch { /* not resolvable now */ } }
      ipCache = { at: Date.now(), ips };
    }
    return ipCache.ips.has(ip);
  }

  async function sendTicket(p) {
    if (!app.mail || !app.mail.enabled()) return;
    const base = String(app.config.publicUrl || '').replace(/\/+$/, '');
    const ch = await data(p.data.channel);
    const t = ticketOf(p.id);
    const url = p.data.kind === 'pass' && ch ? `${base}/c/${ch.data.slug}?ticket=${t}` : `${base}/watch/${p.data.slug}?ticket=${t}`;
    await app.mail.send(p.data.email, { subject: p.data.kind === 'pass' ? `Your pass: ${ch ? ch.data.name : 'channel'}` : `Your ticket: ${p.data.item.replace(/ – ticket$/, '')}`,
      title: p.data.kind === 'pass' ? 'Your channel pass' : 'Your ticket',
      lines: [p.data.item, `Paid: ZAR ${money(p.data.amount)}`, p.data.kind === 'pass' ? `Valid until ${new Date(p.data.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} for every paid stream on this channel.` : 'Watch it live, and the recordings afterwards.',
        'Keep this email: the button below opens it on any device. Please do not share it.'],
      button: base ? { url, label: p.data.kind === 'pass' ? 'Open the channel' : 'Watch' } : null,
      footer: `You get this because you paid for it on ${app.config.publicName || app.config.name || 'RFP Manager'}.` });
  }

  // after the PayFast page: the buyer comes back with ?paid=<id>
  async function statusOf(id) {
    const p = await data(id);
    if (!p || p.type !== 'purchase') fail(404, 'Payment not found');
    return { status: p.data.status, kind: p.data.kind, ticket: p.data.status === 'Paid' ? ticketOf(p.id) : '', expiresAt: p.data.expiresAt || 0 };
  }

  // sales of a team (Producers and Admins), newest first
  async function sales(team) {
    const list = (await app.store.find('purchase', 'team', team)).filter((p) => p.data.status !== 'Pending' || Date.now() - (p.data.createdAt || 0) < 86400e3);
    return list.sort((a, b) => (b.data.createdAt || 0) - (a.data.createdAt || 0)).map((p) => ({ id: p.id, ...p.data }));
  }

  return { enabled, prices, isPaid, entitled, start, notify, statusOf, sales, ticketOf, purchaseIdOf, sandbox: () => !!conf().sandbox };
}

module.exports = { makePay, formSignature, itnParamString, pfEncode, inRange };
