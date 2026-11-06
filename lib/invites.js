'use strict';
// Email invitations to a production team: the "You have been added" email carries a signed link (/join/<token>) that
// is good for 14 days. Opening it shows the team and the role; the person sets a password there (no Google account
// needed) and is signed in, or uses Google with the same email. The link stops working when they are removed from
// the team, once they have a password, or when it runs out (an Admin can send a new one from Settings → Members).
const crypto = require('node:crypto');
const { fail } = require('./util');
const { hashPassword, normEmail } = require('./auth');

const DAYS = 14;

function makeInvites(app) {
  const site = () => String(app.config.adminUrl || app.config.publicUrl || '').replace(/\/+$/, '');
  async function secret() {
    let s = await app.store.kvGet('invite:secret').catch(() => null);
    if (!s) { s = crypto.randomBytes(24).toString('hex'); await app.store.kvSet('invite:secret', s); }
    return s;
  }
  const sign = async (x) => crypto.createHmac('sha256', await secret()).update(x).digest('base64url').slice(0, 27);

  // the link for a member record (null when the website address is not known, or on a production PC)
  async function link(member) {
    if (app.isLocal || !site() || !member || !member.data.email) return null;
    const body = Buffer.from(`${member.id}|${normEmail(member.data.email)}|${Date.now() + DAYS * 86400e3}`).toString('base64url');
    return `${site()}/join/${body}.${await sign(body)}`;
  }

  // what the link is for: { member, team, email, role, teamName, hasPassword, user }
  async function peek(token) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig || sig.length !== 27 || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(await sign(body)))) fail(403, 'This invitation link is not valid. Ask the person who invited you to send a new one.');
    const [memberId, email, exp] = Buffer.from(body, 'base64url').toString().split('|');
    if (!(Number(exp) > Date.now())) fail(410, 'This invitation has expired. Ask the person who invited you to send a new one.');
    const m = await app.store.get(memberId);
    if (!m || m.deleted || m.type !== 'member' || normEmail(m.data.email) !== email) fail(410, 'This invitation was cancelled: you are no longer on that production team.');
    const org = await app.store.get(m.team);
    const user = await app.auth.userByEmail(email);
    return { member: m, team: m.team, email, role: m.data.role || 'Crew', name: m.data.name || (user && user.data.name) || '', teamName: (org && !org.deleted && org.data.name) || 'a production team', hasPassword: !!(user && user.data.passwordHash), user };
  }

  // accept: set the password (and name) for this email; the caller starts the session
  async function accept(token, { name, password }) {
    const v = await peek(token);
    if (v.hasPassword) fail(409, 'You already have a password for this email: sign in with it.');
    if (String(password || '').length < 8) fail(400, 'Use a password of at least 8 characters');
    const nm = String(name || v.name || '').trim().slice(0, 80);
    if (!nm) fail(400, 'Enter your name');
    const user = await app.auth.ensureUser({ email: v.email, name: nm, passwordHash: hashPassword(String(password)) });
    if (!v.member.data.name) await app.save(v.team, 'member', v.member.id, { ...v.member.data, name: nm }, user.id);
    return { user, teamName: v.teamName, team: v.team, member: v.member, role: v.role };
  }

  return { link, peek, accept, DAYS };
}

module.exports = { makeInvites };
