'use strict';
// Release forms: people at a production (or a parent / legal guardian for a minor) give permission to be filmed and
// photographed, on their phone at /release/<key>, with a drawn or loaded signature. Nothing is printed.
//   releaseForm records (Studio → Productions → Release forms): the link, what is asked (raw footage, promotion,
//   minors) and optional own wording.  release records: one per signature, with the wording as it was signed, the
//   choices, the signature, when and from where. They stay on the website (not synced to production PCs) and only
//   Producers and Admins see them, through /api/releases. A person can withdraw: the release is marked withdrawn.
const crypto = require('node:crypto');
const { fail, log, newId } = require('./util');
const { makePdf, loadImage } = require('./pdf');

const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const str = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);

// the standard wording; {company} is filled in
function standardText(company, contact) {
  return [
    `I give ${company} permission to film, photograph and record me (or the minor named on this form) at the production named above, and to use those recordings as I choose below.`,
    '',
    'I understand that:',
    `- My image, voice and likeness may appear in the final production that ${company} makes for its client, including its broadcast, live stream, recordings and copies.`,
    `- Raw footage in which I can be identified is only used beyond that final production if I allow it below. Footage in which nobody can be identified (such as buildings, venues and scenery) is not covered by this form.`,
    '- I am not paid for this unless agreed separately in writing.',
    `- My personal information (name, contact details, signature and the recordings) is processed under the Protection of Personal Information Act (POPIA) only for the purposes on this form, and kept with this release.`,
    `- I may withdraw this consent at any time by contacting ${company}${contact ? ' (' + contact + ')' : ''}. Withdrawal stops future use; it does not undo material already broadcast or published, or productions already delivered.`,
    '- If I sign for a minor, I confirm that I am their parent or legal guardian and may give this consent for them.',
  ].join('\n');
}

function makeReleases(app) {
  const get = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const site = () => String(app.config.publicUrl || app.config.adminUrl || '').replace(/\/+$/, '');
  const studio = (hash) => String(app.config.adminUrl || app.config.publicUrl || '').replace(/\/+$/, '') + '/app/' + hash;
  const newKey = () => crypto.randomBytes(15).toString('base64url');
  const editors = async (team) => (await app.store.list(team, 'member')).filter((m) => !m.deleted && ['Admin', 'Producer'].includes(m.data.role)).map((m) => m.data.email);

  // the company as the form shows it
  async function company(team) {
    const org = ((await get(team)) || { data: {} }).data, b = app.invoices ? await app.invoices.billing(team) : {};
    return { name: app.config.publicName || b.legalName || org.name || 'us', legal: b.legalName || '', email: b.email || org.email || '', phone: b.phone || org.phone || '', logo: org.image || '' };
  }
  // a release form gets its link key when it is saved (kept on later edits)
  async function prepare(team, cur, data) {
    data.key = (cur && !cur.deleted && cur.data.key) || newKey();
    return data;
  }
  async function linked(team, doc) { if (doc && doc.data.key) await app.store.kvSet('release:' + doc.data.key, { team, form: doc.id }); }
  const linkOf = (form) => `${site()}/release/${form.data.key}`;

  async function byKey(key) {
    if (!/^[\w-]{12,40}$/.test(String(key || ''))) fail(404, 'This link is not valid');
    const k = await app.store.kvGet('release:' + key).catch(() => null);
    const f = k && k.form ? await get(k.form) : null;
    if (!f || f.type !== 'releaseForm' || f.data.key !== key) fail(404, 'This release form is not available (any more).');
    return f;
  }
  async function details(f) {
    const co = await company(f.team);
    const prod = f.data.production ? await get(f.data.production) : null, p = prod ? prod.data : {};
    const venue = p.venue ? ((await get(p.venue)) || { data: {} }).data : {};
    return { co, prod: p, date: f.data.date || p.date || '', where: [venue.name, venue.city].filter(Boolean).join(', '), text: str(f.data.text, 20000) || standardText(co.name, co.email) };
  }

  // ---- the public form
  async function view(key) {
    const f = await byKey(key), d = await details(f);
    return { company: { name: d.co.name, logo: d.co.logo, email: d.co.email }, form: { name: f.data.name, production: d.prod.name || '', date: d.date, where: d.where, open: f.data.active !== false,
      minors: f.data.minors !== false, askRaw: f.data.askRaw !== false, askPromo: f.data.askPromo !== false, text: d.text } };
  }
  async function submit(key, b = {}, ip) {
    const f = await byKey(key);
    if (f.data.active === false) fail(409, 'This release form is closed');
    const d = await details(f);
    const name = str(b.name, 120), email = str(b.email, 160).toLowerCase(), phone = str(b.phone, 40);
    if (name.length < 2) fail(400, 'Type your full name');
    if (email && !okEmail(email)) fail(400, 'Give a valid email address (or leave it empty)');
    const minor = !!b.minor && f.data.minors !== false;
    const minorName = minor ? str(b.minorName, 120) : '', relation = minor ? str(b.relation, 40) || 'Parent' : '';
    if (minor && minorName.length < 2) fail(400, 'Type the name of the child');
    if (b.agree !== true) fail(400, 'Tick that you give permission for the final production');
    const img = String(b.image || '');
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(img) || img.length > 700000) fail(400, 'Sign in the box, or load a picture of your signature');
    const consents = { final: true, raw: f.data.askRaw !== false && !!b.raw, promo: f.data.askPromo !== false && !!b.promo };
    const at = Date.now();
    const body = JSON.stringify({ form: f.id, text: d.text, name, email, minorName, relation, consents, at });
    const rec = await app.save(f.team, 'release', newId('rel_'), { form: f.id, formName: f.data.name, production: f.data.production || '', productionName: d.prod.name || '', date: d.date,
      name, email, phone, minor, minorName, relation, consents, text: d.text, company: d.co.name,
      signature: { image: img, method: b.method === 'upload' ? 'upload' : 'draw', at, ip: str(ip, 60) }, at, hash: crypto.createHash('sha256').update(body).digest('hex') }, '');
    const who = minor ? `${minorName} (signed by ${name}, ${relation.toLowerCase()})` : name;
    const allow = ['final production', consents.raw && 'raw footage', consents.promo && 'promotion'].filter(Boolean).join(', ');
    const to = await editors(f.team);
    if (app.push) app.push.send(to, { kind: 'release_signed', title: `Release signed: ${who}`, body: `${f.data.name} · allows ${allow}`, url: studio('#/edit/releaseForm/' + f.id) }).catch(() => {});
    // their own copy, as a PDF
    if (email && app.mail && app.mail.enabled()) {
      const p = await pdf(f.team, rec.id).catch(() => null);
      app.mail.send(email, { subject: `Your release: ${f.data.name}`, title: 'Thank you: your release is signed', lines: [`You gave ${d.co.name} permission to film${minor ? ' ' + minorName : ' you'} for ${d.prod.name || f.data.name}${d.date ? ' on ' + d.date : ''}. It allows: ${allow}.`, 'Your signed copy is attached. To withdraw it later, reply to this email or contact us.'],
        attachments: p ? [{ filename: p.name, content: p.buf, contentType: 'application/pdf' }] : [] }).catch(() => {});
    }
    log(`Releases: ${f.data.name} signed (${consents.raw ? 'raw ' : ''}${consents.promo ? 'promo' : ''})`);
    return { ok: true, id: rec.id, allows: allow };
  }

  // ---- the Studio
  const shape = (r) => ({ id: r.id, name: r.data.name, email: r.data.email, phone: r.data.phone, minor: r.data.minor, minorName: r.data.minorName, relation: r.data.relation, consents: r.data.consents,
    at: r.data.at, method: r.data.signature && r.data.signature.method, withdrawn: r.data.withdrawn || null });
  async function list(team, formId) {
    const f = await get(formId);
    if (!f || f.team !== team || f.type !== 'releaseForm') fail(404, 'No such release form');
    const all = (await app.store.list(team, 'release')).filter((r) => r.data.form === f.id).sort((a, b) => b.data.at - a.data.at);
    return { link: f.data.key ? linkOf(f) : '', open: f.data.active !== false, releases: all.map(shape) };
  }
  // everyone who signed for a production (any of its forms): who may appear in raw footage or promotion
  async function forProduction(team, prodId) {
    return (await app.store.list(team, 'release')).filter((r) => r.data.production === prodId && !r.data.withdrawn).sort((a, b) => a.data.name.localeCompare(b.data.name)).map(shape);
  }
  async function one(team, id) { const r = await get(id); if (!r || r.team !== team || r.type !== 'release') fail(404, 'No such release'); return r; }
  async function withdraw(team, id, on, by) {
    const r = await one(team, id);
    const data = { ...r.data, withdrawn: on ? { at: Date.now(), by: str(by, 120) } : null };
    await app.save(team, 'release', id, data, '');
    return shape({ id, data });
  }
  async function remove(team, id) { await one(team, id); await app.remove(id, ''); return {}; }
  async function send(team, formId, { to, note } = {}, by) {
    if (!app.mail || !app.mail.enabled()) fail(400, 'Email is not set up on this website yet');
    const f = await get(formId);
    if (!f || f.team !== team || f.type !== 'releaseForm') fail(404, 'No such release form');
    const list = [...new Set(String(to || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (!list.length) fail(400, 'Give at least one email address');
    const bad = list.filter((e) => !okEmail(e)); if (bad.length) fail(400, 'Not an email address: ' + bad.join(', '));
    if (list.length > 200) fail(400, 'Up to 200 addresses at a time');
    const d = await details(f);
    for (const e of list) await app.mail.send(e, { subject: `Please sign: ${f.data.name}`, title: `${d.co.name}: filming release`,
      lines: [`${d.co.name} is filming ${d.prod.name || f.data.name}${d.date ? ' on ' + d.date : ''}${d.where ? ' at ' + d.where : ''}. Please give your permission on the form: it takes a minute on your phone, nothing to print.`, note ? str(note, 1000) : '', f.data.minors !== false ? 'Parents and guardians can sign for children under 18.' : ''].filter(Boolean),
      button: { url: linkOf(f), label: 'Open the release form' } }).catch(() => {});
    log(`Releases: ${f.data.name} sent to ${list.length} by ${by || '?'}`);
    return { sent: list.length };
  }

  async function pdf(team, id) {
    const r = await one(team, id), x = r.data, s = x.signature || {};
    const doc = makePdf({ title: `Release ${x.name}`, footer: `${x.company} · release ${r.id}` });
    const M = doc.left;
    const when = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    doc.para([{ text: 'Release form: filming and photography', bold: true }], { size: 18, after: 4 });
    doc.para([x.formName, x.productionName, x.date].filter(Boolean).join(' · '), { size: 10.5, color: '#444444', after: 14 });
    doc.para([{ text: x.minor ? 'For the minor' : 'Person', bold: true }], { size: 10, after: 2 });
    doc.para(x.minor ? `${x.minorName}, signed by ${x.name} (${x.relation.toLowerCase()})` : x.name, { size: 10.5, after: 2 });
    if (x.email || x.phone) doc.para([x.email, x.phone].filter(Boolean).join(' · '), { size: 9.5, color: '#444444', after: 10 });
    for (const raw of String(x.text || '').split(/\n/)) { const l = raw.trim(); if (!l) { doc.space(4); continue; } if (/^[-•*]\s+/.test(l)) doc.para('•  ' + l.replace(/^[-•*]\s+/, ''), { size: 9.5, x: M + 14, width: doc.width - 14, after: 2 }); else doc.para(l, { size: 9.5, after: 4 }); }
    doc.space(8);
    doc.para([{ text: 'Permission given', bold: true }], { size: 11, after: 4 });
    const c = x.consents || {};
    doc.para(`[X] The final production for ${x.company}'s client`, { size: 10, after: 2 });
    doc.para(`[${c.raw ? 'X' : '  '}] Raw footage in which ${x.minor ? 'the child' : 'I'} can be identified may be kept and used, edited, licensed or sold in other productions, stock footage and archives`, { size: 10, after: 2 });
    doc.para(`[${c.promo ? 'X' : '  '}] Clips and photos may be used to promote ${x.company} (showreel, website, social media)`, { size: 10, after: 10 });
    doc.ensure(130);
    const y0 = doc.y;
    if (s.image) { try { doc.image(loadImage(Buffer.from(s.image.split(',')[1], 'base64')), M, y0, 200, 60); } catch { /* the name below still shows */ } }
    const ly = y0 - 66;
    doc.hline(M, M + 210, ly, '#333333', 0.7); doc.hline(M + 235, M + 400, ly, '#333333', 0.7);
    doc.text(M + 237, ly + 4, x.name, { size: 10 });
    doc.text(M, ly - 11, s.method === 'upload' ? 'Signature (picture loaded)' : 'Signature (drawn)', { size: 8.5, color: '#555555' }); doc.text(M + 235, ly - 11, 'Full name', { size: 8.5, color: '#555555' });
    doc.y = ly - 22;
    doc.para(`Signed electronically on ${when(x.at)}${s.ip ? ' from ' + s.ip : ''}.`, { size: 8.5, color: '#555555', after: 4 });
    if (x.withdrawn) doc.para([{ text: `WITHDRAWN on ${when(x.withdrawn.at)}: no further use.`, bold: true, color: '#b00020' }], { size: 10, after: 4 });
    doc.para(`Fingerprint (SHA-256): ${x.hash}`, { size: 7.5, color: '#777777' });
    return { buf: doc.finish(), name: `Release - ${x.minor ? x.minorName : x.name} - ${x.formName}`.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) + '.pdf' };
  }

  return { standardText, prepare, linked, byKey, view, submit, list, forProduction, withdraw, remove, send, pdf };
}

module.exports = { makeReleases, standardText };
