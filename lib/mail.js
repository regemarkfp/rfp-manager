'use strict';
// Email: Brevo or Resend over their web APIs (work from Render, which blocks mail ports), or plain SMTP (your own
// server, Gmail / Google Workspace with an app password). Mail never stops the work it is about: failures are logged.
//   config.mail = { provider: 'brevo' | 'resend' | 'smtp' | 'test' | '', from: 'RFP Manager <info@example.com>', apiKey, smtp: 'smtps://user:pass@host:465' }
const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');
const { log } = require('./util');

const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const parseFrom = (from) => { const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(from || '')); return m ? { name: m[1].replace(/^"|"$/g, ''), email: m[2] } : { name: '', email: String(from || '').trim() }; };

// A plain message laid out as a simple email: heading, lines, an optional button.
function layout({ title, lines = [], button, footer }) {
  const text = [title, '', ...lines, button ? `\n${button.label}: ${button.url}` : '', footer ? `\n--\n${footer}` : ''].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f2f2f2;font-family:Segoe UI,Arial,sans-serif;color:#1d1d1d">
<div style="max-width:560px;margin:0 auto;padding:24px"><div style="background:#262626;color:#fff;padding:14px 20px;border-radius:8px 8px 0 0;font-weight:700"><span style="color:#00ff82">●</span> RFP Manager</div>
<div style="background:#fff;padding:22px 20px;border-radius:0 0 8px 8px"><h2 style="margin:0 0 14px;font-size:19px">${esc(title)}</h2>
${lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5">${esc(l)}</p>`).join('')}
${button ? `<p style="margin:18px 0 4px"><a href="${esc(button.url)}" style="background:#00c766;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${esc(button.label)}</a></p>` : ''}</div>
${footer ? `<p style="color:#777;font-size:12px;margin:12px 4px">${esc(footer)}</p>` : ''}</div></body></html>`;
  return { text, html };
}

// ---- SMTP (implicit TLS on 465, STARTTLS on 587 / 25)
function smtpSend(url, from, to, subject, text, html) {
  const u = new URL(url);
  const port = Number(u.port) || (u.protocol === 'smtps:' ? 465 : 587);
  const user = decodeURIComponent(u.username), pass = decodeURIComponent(u.password);
  const boundary = 'rfp' + Date.now().toString(36);
  const enc = (s) => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
  const f = parseFrom(from);
  const body = [`From: ${f.name ? enc(f.name) + ' ' : ''}<${f.email}>`, `To: ${to.join(', ')}`, `Subject: ${enc(subject)}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0',
    `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${f.email.split('@')[1] || 'rfp'}>`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(text).toString('base64').replace(/.{76}/g, '$&\r\n'),
    `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(html).toString('base64').replace(/.{76}/g, '$&\r\n'), `--${boundary}--`, ''].join('\r\n');
  return new Promise((resolve, reject) => {
    let sock, buf = '', waiting = null;
    const timer = setTimeout(() => { fail(new Error('SMTP timed out')); }, 30000);
    const fail = (e) => { clearTimeout(timer); try { sock.destroy(); } catch { /* closed */ } reject(e); };
    const onData = (d) => {
      buf += d.toString();
      const lines = buf.split('\r\n');
      const last = lines.filter(Boolean).pop() || '';
      if (/^\d{3} /.test(last) && waiting) { const w = waiting; waiting = null; const all = buf; buf = ''; w(all, Number(last.slice(0, 3))); }
    };
    const cmd = (line, ok) => new Promise((res, rej) => { waiting = (all, code) => (ok.includes(code) ? res(all) : rej(new Error(`SMTP: ${all.trim().split('\r\n').pop()}`))); if (line !== null) sock.write(line + '\r\n'); });
    const attach = (s) => { sock = s; sock.on('data', onData); sock.on('error', fail); };
    const go = async () => {
      try {
        await cmd(null, [220]);
        const ehlo = await cmd('EHLO ' + os.hostname(), [250]);
        if (u.protocol !== 'smtps:' && /STARTTLS/i.test(ehlo)) {
          await cmd('STARTTLS', [220]);
          sock.removeListener('data', onData);
          attach(tls.connect({ socket: sock, servername: u.hostname }));
          await new Promise((r) => sock.once('secureConnect', r));
          await cmd('EHLO ' + os.hostname(), [250]);
        }
        if (user) { await cmd('AUTH LOGIN', [334]); await cmd(Buffer.from(user).toString('base64'), [334]); await cmd(Buffer.from(pass).toString('base64'), [235]); }
        await cmd(`MAIL FROM:<${f.email}>`, [250]);
        for (const t of to) await cmd(`RCPT TO:<${t}>`, [250, 251]);
        await cmd('DATA', [354]);
        await cmd(body.replace(/\r\n\./g, '\r\n..') + '\r\n.', [250]);
        sock.write('QUIT\r\n'); clearTimeout(timer); sock.end(); resolve();
      } catch (e) { fail(e); }
    };
    attach(u.protocol === 'smtps:' ? tls.connect({ host: u.hostname, port, servername: u.hostname }) : net.connect({ host: u.hostname, port }));
    go();
  });
}

function makeMailer(app) {
  const conf = () => app.config.mail || {};
  const outbox = [];                                   // provider 'test': kept here
  const enabled = () => { const c = conf(); return !!(c.from && (c.provider === 'test' || (c.provider === 'smtp' ? c.smtp : c.apiKey && ['brevo', 'resend'].includes(c.provider)))); };

  async function deliver({ to, subject, text, html }) {
    const c = conf();
    if (c.provider === 'test') { outbox.push({ to, subject, text, html }); return; }
    if (c.provider === 'smtp') return smtpSend(c.smtp, c.from, to, subject, text, html);
    const from = parseFrom(c.from);
    const r = c.provider === 'brevo'
      ? await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': c.apiKey, 'content-type': 'application/json', accept: 'application/json' }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ sender: { email: from.email, name: from.name || 'RFP Manager' }, to: to.map((email) => ({ email })), subject, textContent: text, htmlContent: html }) })
      : await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + c.apiKey, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ from: c.from, to, subject, text, html }) });
    if (!r.ok) throw new Error(`${c.provider} answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }

  // send(to, { title, lines, button, subject }) – to: emails; people who switched email off are skipped
  async function send(to, msg) {
    if (!enabled()) return { sent: 0 };
    const list = [];
    for (const e of [...new Set((Array.isArray(to) ? to : [to]).map((x) => String(x || '').trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))]) {
      const u = await app.auth.userByEmail(e).catch(() => null);
      if (u && u.data.emailOff) continue;
      list.push(e);
    }
    if (!list.length) return { sent: 0 };
    const { text, html } = layout({ ...msg, footer: msg.footer || `You get this because you are in a production team on ${app.config.name || 'RFP Manager'}. Switch emails off under Settings → My account.` });
    let sent = 0;
    for (const t of list) {                             // one message each: nobody sees the others' addresses
      try { await deliver({ to: [t], subject: msg.subject || msg.title, text, html }); sent++; } catch (e) { log(`Email to ${t} not sent: ${e.message}`); }
    }
    return { sent };
  }
  return { enabled, send, outbox, layout };
}

module.exports = { makeMailer, layout, smtpSend };
