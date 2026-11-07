'use strict';
// WhatsApp messages from the website through Meta's WhatsApp Business Cloud API (graph.facebook.com).
//  · Set up once by a site admin (Settings → Server → WhatsApp): the phone number ID, an access token, the name of an
//    approved message template, and Meta's webhook pointed at <site>/api/whatsapp/webhook with the verify token shown.
//  · WhatsApp lets a business send ordinary text only within 24 hours of the person's last message to it. Outside
//    that window a message must be an approved template: "booking_update" with four values
//      {{1}} the person's first name, {{2}} what the booking is, {{3}} the message, {{4}} the link to follow the booking
//  · Replies people send come in through the webhook: they reach the booking they belong to (lib/bookings.js), and
//    delivery ticks (sent, delivered, read, failed) are kept on the message.
// Settings are kept in kv "wa:config"; the token and app secret never go back to the browser.
// Or, mode "linked": the business's own WhatsApp linked like WhatsApp Web (lib/walinked.js, unofficial: see there).
const crypto = require('node:crypto');
const { log } = require('./util');

const WINDOW = 24 * 3600e3;

// a phone number as WhatsApp wants it: digits with the country code, no plus (068 641 … → 2768641…)
function normalize(phone, country = '27') {
  let s = String(phone || '').trim();
  if (!s) return '';
  const plus = s.startsWith('+') || s.startsWith('00');
  s = s.replace(/\D/g, '');
  if (s.startsWith('00')) s = s.slice(2);
  else if (!plus && s.startsWith('0')) s = String(country || '27').replace(/\D/g, '') + s.slice(1);
  return s.length >= 8 && s.length <= 15 ? s : '';
}
// template values may not hold new lines, tabs or more than four spaces in a row
const flat = (s, n = 900) => String(s || '').replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').trim().slice(0, n) || '-';

function makeWhatsApp(app) {
  const fetcher = () => (app.config.whatsapp && app.config.whatsapp.fetch) || fetch;
  const api = () => ((app.config.whatsapp && app.config.whatsapp.api) || 'https://graph.facebook.com/v21.0').replace(/\/+$/, '');
  let cache = null;
  async function conf() { if (!cache) cache = (await app.store.kvGet('wa:config').catch(() => null)) || {}; return cache; }
  const handlers = { message: [], status: [] };
  const linked = require('./walinked').makeLinked(app, {
    onMessage: async (m) => { for (const h of handlers.message) await h(m).catch((e) => log('WhatsApp reply:', e.message)); },
    onStatus: async (s) => { for (const h of handlers.status) await h(s).catch(() => {}); }
  });
  const ready = (c) => (c.mode === 'linked' ? linked.ready() : !!(c.phoneNumberId && c.token));

  // what the settings screen sees (no secrets)
  async function view() {
    const c = await conf();
    if (!c.verifyToken) { c.verifyToken = crypto.randomBytes(16).toString('hex'); await app.store.kvSet('wa:config', c); }
    const site = String(app.config.publicUrl || '').replace(/\/+$/, '');
    return { on: ready(c), mode: c.mode || 'cloud', linked: linked.status(), phoneNumberId: c.phoneNumberId || '', template: c.template || 'booking_update', lang: c.lang || 'en', country: c.country || '27', hasToken: !!c.token, hasSecret: !!c.appSecret,
      verifyToken: c.verifyToken, webhook: site ? site + '/api/whatsapp/webhook' : '/api/whatsapp/webhook', number: c.number || '' };
  }
  async function setConfig(b = {}) {
    const c = { ...(await conf()) };
    const str = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
    if (b.phoneNumberId !== undefined) { const v = str(b.phoneNumberId, 40); if (v && !/^[1-9]\d{9,29}$/.test(v)) throw Object.assign(new Error('The phone number ID is the long number under WhatsApp → API setup (not the phone number itself)'), { status: 400 }); c.phoneNumberId = v; }
    if (b.token !== undefined && b.token !== '') c.token = str(b.token, 1000);
    if (b.clearToken) delete c.token;
    if (b.appSecret !== undefined && b.appSecret !== '') c.appSecret = str(b.appSecret, 200);
    if (b.clearSecret) delete c.appSecret;
    if (b.template !== undefined) c.template = str(b.template, 100).toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'booking_update';
    if (b.lang !== undefined) c.lang = str(b.lang, 10) || 'en';
    if (b.country !== undefined) c.country = str(b.country, 4).replace(/\D/g, '') || '27';
    if (b.number !== undefined) c.number = str(b.number, 30);
    if (b.mode !== undefined) c.mode = b.mode === 'linked' ? 'linked' : 'cloud';
    if (!c.verifyToken) c.verifyToken = crypto.randomBytes(16).toString('hex');
    await app.store.kvSet('wa:config', c);
    cache = c;
    return view();
  }

  async function post(c, body) {
    const r = await fetcher()(`${api()}/${c.phoneNumberId}/messages`, { method: 'POST', headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.messages || !j.messages[0]) {
      const e = new Error((j.error && (j.error.error_user_msg || j.error.message)) || 'WhatsApp said no (' + r.status + ')');
      e.code = j.error && j.error.code;
      throw e;
    }
    return j.messages[0].id;
  }
  const lastIn = async (to) => Number(await app.store.kvGet('wa:in:' + to).catch(() => 0)) || 0;

  // one message to one person: plain text inside the 24-hour window, else the approved template
  //   msg = { text, name, what, link }  → { ok, id, to, kind: 'text' | 'template', error }
  async function send(phone, msg) {
    const c = await conf();
    if (!ready(c)) return { ok: false, error: 'WhatsApp is not set up (Settings → Server)' };
    const to = normalize(phone, c.country);
    if (!to) return { ok: false, error: 'Not a phone number WhatsApp can use' };
    if (c.mode === 'linked') {
      const r = await linked.send(to, [msg.text, msg.link ? 'Follow your booking: ' + msg.link : ''].filter(Boolean).join('\n\n').slice(0, 4000));
      if (!r.ok) log('WhatsApp to ' + to + ' failed: ' + r.error);
      return { ...r, to };
    }
    const open = Date.now() - (await lastIn(to)) < WINDOW - 5 * 60e3;
    const text = [msg.text, msg.link ? 'Follow your booking: ' + msg.link : ''].filter(Boolean).join('\n\n').slice(0, 4000);
    const template = () => post(c, { messaging_product: 'whatsapp', to, type: 'template', template: { name: c.template || 'booking_update', language: { code: c.lang || 'en' },
      components: [{ type: 'body', parameters: [flat(msg.name || 'there', 60), flat(msg.what || 'your booking', 120), flat(msg.text), flat(msg.link || '-', 300)].map((t) => ({ type: 'text', text: t })) }] } });
    try {
      if (open) return { ok: true, to, kind: 'text', id: await post(c, { messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: true } }) };
      return { ok: true, to, kind: 'template', id: await template() };
    } catch (e) {
      // 131047: the 24-hour window closed after all → the template
      if (open && e.code === 131047) { try { return { ok: true, to, kind: 'template', id: await template() }; } catch (e2) { e = e2; } }
      log('WhatsApp to ' + to + ' failed: ' + e.message);
      return { ok: false, to, error: e.message };
    }
  }

  // ---- the webhook (Meta calls it): replies and delivery ticks
  function verify(params) {
    const c = cache || {};
    if (params.get('hub.mode') === 'subscribe' && c.verifyToken && params.get('hub.verify_token') === c.verifyToken) return String(params.get('hub.challenge') || '');
    return null;
  }
  function signed(raw, header) {
    const c = cache || {};
    if (!c.appSecret) return true;
    const want = 'sha256=' + crypto.createHmac('sha256', c.appSecret).update(raw).digest('hex');
    const got = String(header || '');
    return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  }
  async function incoming(body) {
    await conf();
    for (const e of (body && body.entry) || []) for (const ch of e.changes || []) {
      const v = ch.value || {};
      for (const m of v.messages || []) {
        const from = String(m.from || '').replace(/\D/g, '');
        if (!from) continue;
        await app.store.kvSet('wa:in:' + from, Date.now());
        const text = m.type === 'text' ? (m.text && m.text.body) || '' : m.type === 'button' ? (m.button && m.button.text) || '' : m.type === 'interactive' ? JSON.stringify(m.interactive || {}).slice(0, 200) : `[${m.type}]`;
        const name = ((v.contacts || []).find((x) => x.wa_id === m.from) || { profile: {} }).profile.name || '';
        for (const h of handlers.message) await h({ from, id: m.id, quoted: (m.context && m.context.id) || '', text: String(text).slice(0, 4000), name, at: Number(m.timestamp) * 1000 || Date.now() }).catch((err) => log('WhatsApp reply:', err.message));
      }
      for (const s of v.statuses || []) for (const h of handlers.status) await h({ id: s.id, status: s.status, to: s.recipient_id, error: s.errors && s.errors[0] ? s.errors[0].title || s.errors[0].message || '' : '' }).catch(() => {});
    }
  }
  const on = (kind, fn) => handlers[kind].push(fn);
  // the linked phone: link (QR or code), its state, unlink
  async function link({ phone = '' } = {}) {
    if (app.isLocal) throw Object.assign(new Error('WhatsApp is linked on the website, not on a production PC'), { status: 400 });
    const c = await conf();
    if (c.mode !== 'linked') await setConfig({ mode: 'linked' });
    linked.start({ fresh: true, phone: phone ? normalize(phone, c.country || '27') : '' }).catch((e) => log('WhatsApp link:', e.message));
    return linked.status();
  }
  if (!app.isLocal) conf().then((c) => { if (c.mode === 'linked') linked.resume(); }).catch(() => {});
  return { normalize, view, setConfig, send, verify, signed, incoming, on, conf, ready: async () => ready(await conf()), link, linkStatus: () => linked.status(), unlink: () => linked.unlink(), stop: () => linked.stop() };
}

module.exports = { makeWhatsApp, normalize, flat };
